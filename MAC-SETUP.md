# Music Visualizer on a Mac

## 1. Build the app (once)

You need Node.js from https://nodejs.org (the LTS installer). Copy this whole folder to the Mac, open
Terminal in it, and run:

    sh build-mac.sh

When it finishes it prints where the app is (in `dist/`). Drag `Music Visualizer.app` to Applications.

## 2. Let it hear your Mac's sound (once, about 5 minutes)

macOS doesn't let apps listen to system sound, so a free virtual audio device, BlackHole, passes it along.

1. Install BlackHole 2ch from https://existential.audio/blackhole/ (or `brew install blackhole-2ch`).
   Restart the Mac if the installer asks.
2. Open **Audio MIDI Setup** (in Applications → Utilities).
3. Click **+** at the bottom left → **Create Multi-Output Device**.
4. In the list on the right, tick your speakers or headphones **and** **BlackHole 2ch**. Put your
   speakers first and tick **Drift Correction** next to BlackHole.
5. Open **System Settings → Sound → Output** and choose **Multi-Output Device**.

Sound now plays as normal and also goes to BlackHole, where the visualizer picks it up when you choose
**System audio**. (macOS doesn't allow volume keys on a Multi-Output Device; set the volume in the apps,
or switch the output back to your speakers when you're not using the visualizer.)

## 3. First launch

- macOS asks to allow **microphone** access: allow it. (BlackHole counts as a microphone.)
- When Spotify or Apple Music is playing, macOS asks to let Music Visualizer **control** it: allow it, so
  the song, cover and play/pause/skip work.
- For the wallpaper in transparent fullscreen, macOS asks to let it control **System Events**: allow it.

Changed your mind? System Settings → Privacy & Security → Microphone / Automation.

## What works on a Mac

Everything in the visualizer: all modes, settings, mini player, transparent mode, fullscreen.
Song info and controls come from **Spotify** and **Apple Music** only; other players (browsers, YouTube...)
still make the visuals move, but their song names don't show.
