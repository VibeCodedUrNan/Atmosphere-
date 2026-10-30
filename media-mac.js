// Now playing on macOS: macOS has no public "what's playing anywhere" API, so this asks Spotify and
// Apple Music directly through AppleScript (osascript), once a second, in the same report shape as media.ps1.
// macOS asks once for permission to control each app.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadImage } = require('./image');
const { startPolling } = require('./poll-loop');

// JavaScript for Automation. running() is checked first because asking a closed app would launch it.
// Everything is inside try: Application('Spotify') itself throws when Spotify isn't installed.
const STATUS = `function run() {
  const out = [];
  for (const name of ['Spotify', 'Music']) {
    try {
      const app = Application(name);
      if (!app.running()) continue;
      const state = app.playerState();
      if (state === 'stopped') continue;
      const t = app.currentTrack();
      out.push({ name, playing: state === 'playing', title: t.name(), artist: t.artist(),
        duration: name === 'Music' ? t.duration() * 1000 : t.duration(), // Music: seconds, Spotify: ms
        position: app.playerPosition() * 1000, artUrl: name === 'Spotify' ? t.artworkUrl() : '' });
    } catch (e) {}
  }
  return JSON.stringify(out);
}`;

const osascript = args => new Promise((resolve, reject) =>
  cp.execFile('osascript', args, { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))));

// Apple Music has no cover URL; its artwork is written to a temporary file (one per call, so two
// quick track changes can't read each other's half-written file) and read back.
async function musicCover() {
  const file = path.join(os.tmpdir(), `music-visualizer-cover-${process.pid}-${Date.now()}`);
  const script = [
    'tell application "Music"',
    '  if (count of artworks of current track) is 0 then return ""',
    '  set d to raw data of artwork 1 of current track',
    'end tell',
    `set f to open for access (POSIX file "${file}") with write permission`,
    'write d to f',
    'close access f',
    'return "ok"',
  ];
  try { return (await osascript(script.flatMap(line => ['-e', line]))) === 'ok' ? await loadImage(file) : ''; }
  catch { return ''; }
  finally { fs.rm(file, { force: true }, () => {}); }
}

exports.start = report => {
  let current = null, lastKey = '', art = { key: '' };

  async function read() {
    const players = JSON.parse(await osascript(['-l', 'JavaScript', '-e', STATUS]) || '[]');
    // Like the other platforms, prefer the app that's actually playing.
    const p = players.find(x => x.name === current && x.playing) || players.find(x => x.playing)
      || players.find(x => x.name === current) || players[0];
    current = p?.name || null;
    if (!p) { lastKey = ''; return { active: false }; }
    const out = {
      active: true, app: p.name === 'Music' ? 'Apple Music' : p.name, title: p.title || '', artist: p.artist || '',
      playing: p.playing, position: p.position, duration: p.duration, updated: Date.now(),
    };
    // A new track's cover is fetched in the background, so a slow download never holds up the song info,
    // and goes out with the first report after it arrives (main.js remembers the current one).
    const key = `${out.app}|${out.title}|${out.artist}`;
    if (key !== art.key) {
      const a = art = { key, data: '', ready: false, sent: false };
      (p.artUrl ? loadImage(p.artUrl) : p.name === 'Music' ? musicCover() : Promise.resolve(''))
        .then(data => { a.data = data; a.ready = true; });
    }
    if (key !== lastKey) art.sent = false; // a new track, or the same one coming back, needs its cover again
    if (art.ready && !art.sent) { out.art = art.data; art.sent = true; }
    lastKey = key;
    return out;
  }

  const polling = startPolling(read, report, () => { lastKey = ''; });
  return {
    control: async cmd => {
      const method = { toggle: 'playpause', next: 'nextTrack', prev: 'previousTrack' }[cmd];
      if (!method || !current) return;
      await osascript(['-l', 'JavaScript', '-e', `Application(${JSON.stringify(current)}).${method}()`])
        .catch(e => console.error('[media]', e.message));
      polling.wake(); // show the new state promptly
    },
    stop: () => polling.stop(),
  };
};
