// Desktop shell for the visualizer: grants system-audio capture without a picker and relays
// now-playing info and playback controls between the system (media-win/-mac/-linux.js) and the page.
const { app, BrowserWindow, desktopCapturer, session, ipcMain, screen } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const media = require({ win32: './media-win', darwin: './media-mac' }[process.platform] || './media-linux');
const wallpaper = require('./wallpaper');
const { toDataUrl } = require('./image');

// Linux needs this for the see-through window (Background: Transparent); it also needs a compositor.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

let win, player;
let lastMedia = null, nowPlaying = { key: '', art: '' }; // latest now-playing report, and the current track's cover

// Mini player: a small always-on-top window in the screen's corner. While it's on, `mini` holds
// the normal window's size and position to go back to.
let mini = null;
const MINI_SIZE = { width: 380, height: 240 };
const minSize = () => (mini ? [240, 140] : [480, 320]);

// A window can't switch transparency after it's created, so the choice is saved here
// (read at startup) and switching replaces the window.
const statePath = () => path.join(app.getPath('userData'), 'window.json');
function loadTransparent() { try { return !!JSON.parse(fs.readFileSync(statePath(), 'utf8')).transparent; } catch { return false; } }

function createWindow(transparent, bounds) {
  const old = win;
  win = new BrowserWindow({
    ...(bounds || { width: 1280, height: 760 }), minWidth: minSize()[0], minHeight: minSize()[1], alwaysOnTop: !!mini,
    // Transparent windows must be frameless; the page then draws its own drag strip and window buttons.
    transparent, frame: !transparent, backgroundColor: transparent ? '#00000000' : '#000000', title: 'Music Visualizer',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.removeMenu();

  // The page has no links; this stops e.g. a file dropped on the window from replacing the visualizer.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // A replacement window starts empty: give it the current track and cover straight away.
  const contents = win.webContents;
  contents.on('did-finish-load', () => {
    if (lastMedia) contents.send('media', { ...lastMedia, art: nowPlaying.art });
  });

  const query = {};
  if (transparent) query.transparent = '1';
  if (mini) query.mini = '1';
  win.loadFile(path.join(__dirname, 'index.html'), { query });
  old?.destroy(); // after the new window exists, so 'window-all-closed' doesn't quit the app
}

ipcMain.on('set-transparent', (_e, on) => {
  const transparent = !!on;
  try { fs.writeFileSync(statePath(), JSON.stringify({ transparent })); } catch {}
  // Swap at the normal size: while fullscreen the window reports the screen's size, so leave fullscreen
  // first; a maximized window is re-maximized after the swap.
  const swap = () => {
    const maximized = win.isMaximized();
    createWindow(transparent, win.getNormalBounds());
    if (maximized) win.maximize();
  };
  if (win.isFullScreen()) { win.once('leave-full-screen', () => setTimeout(swap, 100)); win.setFullScreen(false); }
  else swap();
});

ipcMain.on('mini', (_e, on) => {
  if (!!on === !!mini) return;
  if (on) {
    mini = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    if (mini.maximized) win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setMinimumSize(...minSize());
    win.setBounds({ ...MINI_SIZE, x: area.x + area.width - MINI_SIZE.width - 16, y: area.y + area.height - MINI_SIZE.height - 16 });
    win.setAlwaysOnTop(true);
  } else {
    const back = mini;
    mini = null;
    win.setAlwaysOnTop(false);
    win.setMinimumSize(...minSize());
    win.setBounds(back.bounds);
    if (back.maximized) win.maximize();
  }
});
ipcMain.handle('wallpaper', () => wallpaper.get(app.getPath('appData')));

// Background image the user picked (Background: Your image). The page sends it already resized and
// re-encoded as JPEG; it's kept in the app's data folder because it's too big for the page's settings storage.
const bgImagePath = () => path.join(app.getPath('userData'), 'background.jpg');
ipcMain.handle('set-background-image', (_e, bytes) => {
  const b = Buffer.from(bytes);
  if (b.length < 3 || b.length > 15 * 1024 * 1024 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return ''; // JPEG only
  try { fs.writeFileSync(bgImagePath(), b); } catch { return ''; }
  return toDataUrl(b, 'image/jpeg');
});
ipcMain.handle('background-image', () => { try { return toDataUrl(fs.readFileSync(bgImagePath()), 'image/jpeg'); } catch { return ''; } });

// Linux: the "Monitor of …" input the page should listen to for system audio is the one belonging to
// the default output. pactl gives that output's description; the page matches it against device labels.
ipcMain.handle('monitor-name', () => {
  if (process.platform !== 'linux') return '';
  const run = args => { // LC_ALL=C: untranslated "Name:"/"Description:" labels to match on
    try { return execFileSync('pactl', args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }); } catch { return ''; }
  };
  const sink = run(['get-default-sink']).trim() || (run(['info']).match(/^Default Sink: (.+)$/m) || [])[1];
  if (!sink) return '';
  const block = run(['list', 'sinks']).split(/^Sink #/m).find(b => b.includes(`Name: ${sink}\n`));
  const desc = block && (block.match(/^\s*Description: (.+)$/m) || [])[1];
  return desc ? `Monitor of ${desc.trim()}` : '';
});

ipcMain.on('window', (_e, action) => {
  if (action === 'minimize') win.minimize();
  else if (action === 'close') win.close();
});

// One report per second from the platform's now-playing source.
function onReport(m) {
  // Covers are sent only when they change; remember the current one so a replacement window can be given it.
  const key = `${m.app}|${m.title}|${m.artist}`;
  if (key !== nowPlaying.key) nowPlaying = { key, art: '' };
  if (m.art) nowPlaying.art = m.art;
  lastMedia = m;
  win?.webContents.send('media', m);
}

ipcMain.on('media-control', (_e, cmd) => {
  if (['toggle', 'next', 'prev'].includes(cmd)) player?.control(cmd);
});

// One copy at a time: a second launch just brings the existing window forward
// (two copies would both capture audio and fight over the saved window type).
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

app.whenReady().then(() => {
  // getDisplayMedia() in the page gets the whole-system audio loopback, no share dialog.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: screen, audio: 'loopback' });
    } catch (e) {
      console.error('[capture]', e.message);
      callback({}); // reject, so the page shows an error instead of waiting forever
    }
  });

  createWindow(loadTransparent());
  player = media.start(onReport);
});

app.on('window-all-closed', () => {
  player?.stop();
  app.quit();
});
