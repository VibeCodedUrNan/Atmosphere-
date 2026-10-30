// Now playing on Linux: once a second, asks MPRIS (the D-Bus interface Linux media players publish:
// Spotify, browsers, VLC, Rhythmbox...) what's playing, in the same report shape as media.ps1.
const dbus = require('@jellybrick/dbus-next'); // maintained fork of dbus-next
const { loadImage } = require('./image');
const { startPolling } = require('./poll-loop');

const PREFIX = 'org.mpris.MediaPlayer2.', PATH = '/org/mpris/MediaPlayer2', PLAYER = 'org.mpris.MediaPlayer2.Player';

exports.start = report => {
  let bus = null, players = new Map(), current = null;
  let lastKey = '', art = { url: null, data: '', ready: true };

  function reset() { bus?.disconnect(); bus = null; players = new Map(); current = null; lastKey = ''; } // reconnect next time
  function connect() {
    bus = dbus.sessionBus();
    bus.on('error', e => { console.error('[media]', e.message); reset(); });
  }

  // Proxy objects cost a round trip to set up, so each player's is kept until it goes away.
  async function player(name) {
    if (!players.has(name)) {
      const obj = await bus.getProxyObject(name, PATH), props = obj.getInterface('org.freedesktop.DBus.Properties');
      const identity = await props.Get('org.mpris.MediaPlayer2', 'Identity').then(v => v.value, () => '');
      players.set(name, { props, control: obj.getInterface(PLAYER), app: identity || name.slice(PREFIX.length) });
    }
    return players.get(name);
  }

  // Like Windows, prefer a player that's actually playing over one that's merely open.
  async function pick() {
    const dbusIface = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
    const names = (await dbusIface.ListNames()).filter(n => n.startsWith(PREFIX) && !n.includes('playerctld'));
    for (const n of players.keys()) if (!names.includes(n)) players.delete(n);
    const status = {};
    for (const n of names) {
      try { status[n] = (await (await player(n)).props.Get(PLAYER, 'PlaybackStatus')).value; } catch {}
    }
    const known = names.filter(n => n in status);
    current = (status[current] === 'Playing' && current) || known.find(n => status[n] === 'Playing')
      || (known.includes(current) && current) || known[0] || null;
  }

  async function read() {
    if (!bus) connect();
    await pick();
    if (!current) { lastKey = ''; return { active: false }; }
    const p = await player(current), all = await p.props.GetAll(PLAYER);
    const md = all.Metadata?.value || {}, v = k => md[k]?.value;
    const out = {
      active: true, app: p.app, title: v('xesam:title') || '',
      artist: [].concat(v('xesam:artist') || v('xesam:albumArtist') || []).join(', '),
      playing: all.PlaybackStatus?.value === 'Playing',
      position: Number(all.Position?.value || 0) / 1000, // MPRIS uses microseconds
      duration: Number(v('mpris:length') || 0) / 1000,
      updated: Date.now(),
    };
    // Covers are fetched in the background, so a slow download never holds up the song info, and go out
    // when they change or with a new track (main.js remembers the current one).
    const key = `${out.app}|${out.title}|${out.artist}`, url = v('mpris:artUrl') || '';
    if (url !== art.url) {
      const a = art = { url, data: '', ready: !url };
      if (url) loadImage(url).then(data => { a.data = data; a.ready = true; });
    }
    if (key !== lastKey) art.sentFor = null; // a new track, or the same one coming back, needs its cover again
    if (art.ready && art.sentFor !== key) { out.art = art.data; art.sentFor = key; }
    lastKey = key;
    return out;
  }

  const polling = startPolling(read, report, reset);
  return {
    control: async cmd => {
      const method = { toggle: 'PlayPause', next: 'Next', prev: 'Previous' }[cmd];
      if (!method || !current || !bus) return;
      try { await (await player(current)).control[method](); } catch (e) { console.error('[media]', e.message); }
      polling.wake(); // show the new state promptly
    },
    stop: () => { polling.stop(); bus?.disconnect(); },
  };
};
