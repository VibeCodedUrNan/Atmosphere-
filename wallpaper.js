// The desktop wallpaper, so transparent fullscreen can show the bare wallpaper over the desktop icons
// and taskbar/panels. Returns { image (data: URL or ''), style (fill|fit|stretch|center|tile|span), color }.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { toDataUrl } = require('./image');

const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true }).trim(); } catch { return ''; } };
const readImage = file => { try { return file && fs.existsSync(file) ? toDataUrl(fs.readFileSync(file)) : ''; } catch { return ''; } };

function windows(appData) {
  const reg = (key, name) => (run('reg', ['query', key, '/v', name]).match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`)) || [])[1]?.trim() || '';
  const desk = 'HKCU\\Control Panel\\Desktop';
  // Windows keeps a copy of the current picture here; the WallPaper value is the original file.
  const transcoded = path.join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  const image = readImage(fs.existsSync(transcoded) ? transcoded : reg(desk, 'WallPaper'));
  const style = reg(desk, 'TileWallpaper') === '1' ? 'tile'
    : { 0: 'center', 2: 'stretch', 6: 'fit', 10: 'fill', 22: 'span' }[reg(desk, 'WallpaperStyle')] || 'fill';
  const rgb = (reg('HKCU\\Control Panel\\Colors', 'Background') || '0 0 0').split(/\s+/).join(',');
  return { image, style, color: `rgb(${rgb})` };
}

// GNOME (and desktops built on its settings), then KDE Plasma; anything else falls back to black.
function linux() {
  const gs = key => run('gsettings', ['get', ...key.split(' ')]).replace(/^'|'$/g, '');
  const dark = gs('org.gnome.desktop.interface color-scheme') === 'prefer-dark';
  const uri = (dark && gs('org.gnome.desktop.background picture-uri-dark')) || gs('org.gnome.desktop.background picture-uri');
  if (uri) {
    const options = gs('org.gnome.desktop.background picture-options');
    const style = { zoom: 'fill', scaled: 'fit', stretched: 'stretch', centered: 'center', wallpaper: 'tile', spanned: 'span' }[options] || 'fill';
    const file = uri.startsWith('file://') ? decodeURIComponent(new URL(uri).pathname) : uri;
    return { image: options === 'none' ? '' : readImage(file), style, color: gs('org.gnome.desktop.background primary-color') || '#000' };
  }
  try {
    const config = fs.readFileSync(path.join(os.homedir(), '.config', 'plasma-org.kde.plasma.desktop-appletsrc'), 'utf8');
    const image = (config.match(/^Image=(.+)$/m) || [])[1];
    if (image) return { image: readImage(image.startsWith('file://') ? decodeURIComponent(new URL(image).pathname) : image), style: 'fill', color: '#000' };
  } catch {}
  return { image: '', style: 'fill', color: '#000' };
}

// macOS reports the current desktop picture's file. Dynamic wallpapers are HEIC, which the page can't
// show, so anything else is converted to JPEG with the built-in sips tool.
function mac() {
  const file = run('osascript', ['-e', 'tell application "System Events" to get picture of current desktop']);
  let image = '';
  if (file) {
    if (/\.(jpe?g|png|gif|bmp|webp)$/i.test(file)) image = readImage(file);
    else {
      const jpeg = path.join(os.tmpdir(), 'music-visualizer-wallpaper.jpg');
      fs.rmSync(jpeg, { force: true }); // a failed conversion must not show the last wallpaper's leftover file
      run('sips', ['-s', 'format', 'jpeg', file, '--out', jpeg]);
      image = readImage(jpeg);
    }
  }
  return { image, style: 'fill', color: '#000' };
}

exports.get = appData => ({ win32: windows, darwin: mac }[process.platform] || linux)(appData);
