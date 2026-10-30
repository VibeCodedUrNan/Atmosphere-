# Atmosphere 

A customizable desktop music visualizer. It listens to whatever is playing on your computer (Spotify,
YouTube in a browser, Apple Music, VLC...) and shows the song, cover and playback controls.

## Features

- **Five modes:** Bars, Radial, Waveform, Particles and **2016**, a glowing sphere of dots whose surface
  ripples with the music.
- **Customizable:** bar count, mirroring, spin, glow, trails, sensitivity, smoothing, and colours taken
  from the album art or picked yourself.
- **Now playing:** song, artist, cover, progress, and previous / play-pause / next.
- **Backgrounds:** black, a colour (12 presets or any colour), blurred album art, **your own image** (JPEG
  or PNG, with a brightness slider), or **transparent**, to see your desktop through it. In transparent
  fullscreen it shows just your wallpaper, without desktop icons or the taskbar.
- **Mini player:** a small always-on-top window in the corner of the screen.

Keys: `H` settings · `F` fullscreen · `N` mini player · `M` next mode · `Space` play/pause · `←`/`→` previous/next.

## Platforms

| | System audio | Now playing | Status |
|---|---|---|---|
| **Windows 10/11** | Built in | Any app in Windows' media controls | Tested |
| **Linux** | PulseAudio / PipeWire monitor input | Any MPRIS player | Untested on real hardware: feedback welcome |
| **macOS** | Needs the free [BlackHole](https://existential.audio/blackhole/) driver | Spotify and Apple Music | Untested: see [MAC-SETUP.md](MAC-SETUP.md) |

## Run from source

Needs [Node.js](https://nodejs.org) 22.12 or newer.

```sh
npm install
npm start
```

## Build the app

| Platform | Command | Output |
|---|---|---|
| Windows | `npm run package` | `dist/Music Visualizer-win32-x64/` |
| Linux | `npm run package:linux` | `dist/Music Visualizer-linux-x64/` |
| macOS (on a Mac) | `npm run package:mac` | `dist/Music Visualizer-darwin-*/Music Visualizer.app` |

**Linux:** a build copied from Windows loses its "executable" permission: run `chmod +x "Music Visualizer"`.
If it exits with a sandbox error (common on Ubuntu 24.04), either run
`sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` once, or start it with `--no-sandbox`.

**macOS:** the build is ad-hoc signed, not notarized, so macOS warns on first open. Full steps, including
the BlackHole setup, are in [MAC-SETUP.md](MAC-SETUP.md).

## Privacy

Everything stays on your computer. The app listens to your system audio only to draw the visuals; nothing
is recorded or sent anywhere. The only network requests are for cover images, when a player (such as
Spotify on macOS or Linux) gives a web address for one.

## How it's built

An [Electron](https://www.electronjs.org) app.

| File | Role |
|---|---|
| `index.html`, `style.css`, `renderer.js` | The visualizer page: audio analysis, drawing, settings |
| `main.js` | Windows, audio capture permission, mini player, transparent mode |
| `preload.js` | The few functions the page may call in `main.js` |
| `media-win.js` + `media.ps1` | Now playing on Windows (System Media Transport Controls) |
| `media-linux.js` | Now playing on Linux (MPRIS over D-Bus) |
| `media-mac.js` | Now playing on macOS (AppleScript: Spotify, Apple Music) |
| `poll-loop.js`, `image.js`, `wallpaper.js` | Shared helpers |

## Known limitations

- macOS shows song info only for Spotify and Apple Music (macOS has no public API for other apps).
- Spotify on Linux reports a wrong playback position (a Spotify bug), so its progress bar may be off.
- Transparent mode on Linux needs a desktop with a compositor (most have one).

## License

[MIT](LICENSE)
