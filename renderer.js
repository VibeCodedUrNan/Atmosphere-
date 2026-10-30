'use strict';
const $ = id => document.getElementById(id);

// ---------- Settings ----------
const DEFAULTS = { mode: 'bars', bars: 96, mirror: true, spin: 0.3, glow: 14, trails: 0.35, bg: 'album',
  bgColor: '#0b1a33', bgBright: 0.6, colorSource: 'album', c1: '#1db954', c2: '#4fc3f7', c3: '#e040fb', sensitivity: 1.2, smoothing: 0.75, showTrack: true };
let S = load();
function load() {
  let s; try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('viz.settings') || '{}') }; } catch { s = { ...DEFAULTS }; }
  // Above ~0.85 the 8-bit fade gets stuck and leaves a permanent faint ghost (older versions allowed 0.95).
  s.trails = Math.min(s.trails, 0.85);
  return s;
}
function save() { try { localStorage.setItem('viz.settings', JSON.stringify(S)); } catch {} }

function bindSettings() {
  document.querySelectorAll('[data-key]').forEach(el => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') el.checked = S[k]; else el.value = S[k];
    el.oninput = () => {
      S[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
      save(); applySettings();
      if (k === 'bg') syncWindow();
    };
  });
}
function applySettings() {
  $('track').classList.toggle('hidden', !S.showTrack || !track);
  $('rowBgColor').classList.toggle('hidden', S.bg !== 'color');
  $('rowBgImage').classList.toggle('hidden', S.bg !== 'image');
  for (const b of $('bgSwatches').children) b.classList.toggle('on', b.dataset.color === S.bgColor);
  updatePalette();
}

// ---------- Background: colour swatches and your own image ----------
// Mostly dark shades, so the visuals stand out; the colour picker covers anything else.
const BG_SWATCHES = { '#000000': 'Black', '#15171c': 'Charcoal', '#2a3340': 'Slate', '#0b1a33': 'Midnight blue',
  '#062a30': 'Deep teal', '#0a2618': 'Forest', '#1f0b33': 'Deep purple', '#33091a': 'Wine', '#331505': 'Ember',
  '#3d0b2e': 'Plum', '#14283d': 'Navy', '#f2f2f2': 'White' };
for (const [color, name] of Object.entries(BG_SWATCHES)) {
  const b = document.createElement('button');
  b.className = 'swatch'; b.title = name; b.dataset.color = color; b.style.background = color;
  b.onclick = () => { S.bgColor = color; save(); bindSettings(); applySettings(); };
  $('bgSwatches').append(b);
}

let bgImg = null;
function showBackgroundImage(url) {
  if (!url) { bgImg = null; return; }
  const img = new Image();
  img.onload = () => { bgImg = img; };
  img.src = url;
}
// The picked file is shrunk to at most 3840 px and re-encoded as JPEG before main.js saves it: small to store
// and draw, and only images the page can actually decode get through.
async function pickBackgroundImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, 3840 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    const jpeg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    const url = await window.appWindow.setBackgroundImage(new Uint8Array(await jpeg.arrayBuffer()));
    if (!url) throw new Error();
    showBackgroundImage(url);
    S.bg = 'image'; save(); bindSettings(); applySettings(); syncWindow();
    status('');
  } catch { status('That file couldn’t be used as a background. Choose a JPEG or PNG image.'); }
}
$('btnBgImage').onclick = () => $('bgFile').click();
$('bgFile').onchange = () => { const f = $('bgFile').files[0]; $('bgFile').value = ''; if (f) pickBackgroundImage(f); };

// ---------- Audio ----------
let actx, analyser, freq, wave, audioStream, audioSource = null, audioCall = 0;
async function startAudio(kind) {
  const call = ++audioCall;
  if (audioStream) audioStream.getTracks().forEach(t => t.stop());
  audioStream = null; analyser = null; // without an analyser, readAudio() falls back to demo motion
  if (kind === 'none') { status('No audio source — showing demo motion. Click “Audio” to pick one.'); return true; }
  const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const stream = kind !== 'system' ? await navigator.mediaDevices.getUserMedia({ audio: constraints })
    : window.appWindow?.platform === 'win32' ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: constraints }) // main.js answers with the audio loopback
    : await systemAudioInput(constraints);
  stream.getVideoTracks().forEach(t => t.stop()); // only the audio is needed
  // A newer pick (e.g. a double-click) superseded this one while it was starting: don't leave it capturing.
  if (call !== audioCall) { stream.getTracks().forEach(t => t.stop()); return false; }
  if (!stream.getAudioTracks().length) throw new Error('System audio isn’t available.');
  actx = actx || new AudioContext();
  await actx.resume();
  analyser = actx.createAnalyser();
  analyser.fftSize = 4096;
  actx.createMediaStreamSource(stream).connect(analyser);
  freq = new Uint8Array(analyser.frequencyBinCount);
  wave = new Uint8Array(analyser.fftSize);
  audioStream = stream;
  stream.getAudioTracks()[0].onended = () => {
    if (audioStream !== stream) return;
    audioStream = null; analyser = null; status('Audio stopped. Click “Audio” to reconnect.');
  };
  status('');
  return true;
}
// Outside Windows, system audio arrives as an ordinary input device:
// - Linux: sound servers (PulseAudio, PipeWire) list each output's "Monitor of …" source as an input;
//   prefer the default output's.
// - macOS: the free BlackHole driver, with a Multi-Output Device sending sound to the speakers and BlackHole.
async function systemAudioInput(constraints) {
  let inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  if (!inputs.some(d => d.label)) { // labels only show once audio input has been allowed once
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop());
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  }
  let device;
  if (window.appWindow.platform === 'darwin') {
    device = inputs.find(d => /blackhole/i.test(d.label));
    if (!device) throw new Error('BlackHole isn’t installed. See MAC-SETUP.md to set it up (about 5 minutes, once).');
  } else {
    const preferred = await window.appWindow.getMonitorName();
    device = inputs.find(d => preferred && d.label === preferred) || inputs.find(d => d.label.startsWith('Monitor of'));
    if (!device) throw new Error('No system-audio monitor found. Is PulseAudio or PipeWire running?');
  }
  return navigator.mediaDevices.getUserMedia({ audio: { ...constraints, deviceId: { exact: device.deviceId } } });
}
async function pickSource(kind) {
  try { if (await startAudio(kind)) { audioSource = kind; $('start').classList.add('hidden'); } }
  catch (e) { status(e.name === 'NotAllowedError' ? 'Permission was denied.' : e.message); }
}

// Log-spaced bands (30 Hz – 16 kHz), 0..1, plus bass level.
let bands = new Float32Array(0), bass = 0, demoT = 0, quietFor = 0;
function readAudio(n, dt) {
  if (bands.length !== n) bands = new Float32Array(n);
  if (analyser) {
    // 2016 does its own fall-off, so it keeps the analyser snappy to land on the beat.
    analyser.smoothingTimeConstant = S.mode === '2016' ? Math.min(S.smoothing, 0.3) : S.smoothing;
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    const hz = actx.sampleRate / analyser.fftSize, lo = Math.log(30), hi = Math.log(16000);
    for (let i = 0; i < n; i++) {
      const a = Math.max(1, Math.floor(Math.exp(lo + (hi - lo) * i / n) / hz));
      const b = Math.max(a + 1, Math.floor(Math.exp(lo + (hi - lo) * (i + 1) / n) / hz));
      let m = 0; for (let j = a; j < b && j < freq.length; j++) m = Math.max(m, freq[j]);
      bands[i] = Math.min(1, Math.pow(m / 255, 1.6) * S.sensitivity * (1 + i / n * 0.8));
    }
    let sum = 0; const bEnd = Math.ceil(150 / hz);
    for (let j = 1; j < bEnd; j++) sum += freq[j];
    bass = Math.min(1, (sum / Math.max(1, bEnd - 1) / 255) ** 2 * S.sensitivity * 1.4);
    quietFor = Math.max(...freq.subarray(0, 512)) > 20 ? 0 : quietFor + dt;
  } else { // demo motion so the screen is never dead
    demoT += dt;
    const beat = Math.pow(Math.max(0, Math.sin(demoT * Math.PI * 2 * 2)), 8);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      bands[i] = Math.min(1, (0.35 + 0.25 * Math.sin(demoT * 2 + x * 9) + 0.15 * Math.sin(demoT * 5.3 - x * 23)) * (1 - x * 0.5) + beat * (1 - x) * 0.4) * S.sensitivity * 0.8;
    }
    bass = beat * 0.8;
    if (!wave) wave = new Uint8Array(2048);
    for (let i = 0; i < wave.length; i++) wave[i] = 128 + 50 * Math.sin(i / 40 + demoT * 6) * Math.sin(i / 300 + demoT) * (0.5 + bass);
  }
}

// ---------- Colour ----------
let albumColors = null, palette = [];
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function updatePalette() { palette = (S.colorSource === 'album' && albumColors) ? albumColors : [S.c1, S.c2, S.c3].map(hexToRgb); }
function colorAt(t, alpha = 1) {
  t = Math.min(1, Math.max(0, t)) * (palette.length - 1);
  const i = Math.min(palette.length - 2, Math.floor(t)), f = t - i, a = palette[i], b = palette[i + 1];
  return `rgba(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')},${alpha})`;
}
// Pick 3 vivid, distinct hues from the album cover.
function extractColors(img) {
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 40, 40);
  const d = g.getImageData(0, 0, 40, 40).data, bins = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    const [r, gg, b] = [d[i], d[i + 1], d[i + 2]], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx ? (mx - mn) / mx : 0, val = mx / 255, w = sat * sat * val + 0.02;
    let h = 0;
    if (mx !== mn) h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4;
    const bin = bins[Math.floor(((h * 60 + 360) % 360) / 20)];
    bin.w += w; bin.r += r * w; bin.g += gg * w; bin.b += b * w;
  }
  const top = bins.filter(b => b.w > 0).sort((a, b) => b.w - a.w).slice(0, 3)
    .map(b => brighten([b.r / b.w, b.g / b.w, b.b / b.w]));
  while (top.length < 3) top.push(top.length ? brighten(top[0].map(v => 255 - v)) : [29, 185, 84]);
  return top;
}
function brighten(rgb) { const m = Math.max(...rgb, 1), k = Math.max(1, 200 / m); return rgb.map(v => Math.min(255, Math.round(v * k))); }

// ---------- Rendering ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, artImg = null, particles = [], angle = 0, last = performance.now();
function resize() { const dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
addEventListener('resize', resize); resize();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // Moving to a monitor with a different scale setting changes the pixel ratio without a resize event.
  if (cv.width !== Math.round(W * Math.min(2, devicePixelRatio || 1))) resize();
  readAudio(S.mirror && S.mode === 'bars' ? S.bars / 2 | 0 : S.bars, dt); // mirrored bars draw each band twice

  // background with trails
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1 - S.trails;
  if (S.bg === 'transparent') { // fade the last frame towards see-through instead of towards black
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  } else if (S.bg === 'album' && artImg) {
    ctx.filter = 'blur(40px) brightness(0.35)';
    const s = Math.max(W, H) * (1.15 + bass * 0.05);
    ctx.drawImage(artImg, (W - s) / 2, (H - s) / 2, s, s);
    ctx.filter = 'none';
  } else if (S.bg === 'image' && bgImg) { // fills the window, cropping like a wallpaper set to "fill"
    ctx.filter = `brightness(${S.bgBright})`;
    const k = Math.max(W / bgImg.width, H / bgImg.height), w = bgImg.width * k, h = bgImg.height * k;
    ctx.drawImage(bgImg, (W - w) / 2, (H - h) / 2, w, h);
    ctx.filter = 'none';
  } else { ctx.fillStyle = S.bg === 'color' ? S.bgColor : '#000'; ctx.fillRect(0, 0, W, H); }
  ctx.globalAlpha = 1;

  ctx.shadowBlur = S.glow; ctx.lineCap = 'round';
  ({ bars: drawBars, radial: drawRadial, wave: drawWave, particles: drawParticles, 2016: draw2016 })[S.mode](dt);
  progressTick();
  // "Waiting for music" once the listened-to audio has been silent for a while and nothing is playing.
  $('idle').style.opacity = analyser && quietFor > 2 && !prog.playing ? 1 : 0;
  requestAnimationFrame(frame);
}

function drawBars() {
  const n = bands.length, total = S.mirror ? n * 2 : n, gap = Math.max(1, W / total * 0.2), bw = W / total - gap;
  const base = H * 0.82, maxH = H * 0.65;
  for (let k = 0; k < total; k++) {
    const i = S.mirror ? (k < n ? n - 1 - k : k - n) : k, v = bands[i], h = Math.max(2, v * maxH);
    const col = colorAt(i / n); ctx.fillStyle = col; ctx.shadowColor = col;
    const x = k * (bw + gap) + gap / 2;
    ctx.beginPath(); ctx.roundRect(x, base - h, bw, h, Math.min(bw / 2, 6)); ctx.fill();
    ctx.globalAlpha = 0.18; ctx.fillRect(x, base + 4, bw, h * 0.25); ctx.globalAlpha = 1; // reflection
  }
}

function drawRadial(dt) {
  angle += dt * S.spin;
  const n = bands.length, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.2 * (1 + bass * 0.12), maxL = Math.min(W, H) * 0.25;
  ctx.lineWidth = Math.max(2, (2 * Math.PI * R / n) * 0.55);
  for (let k = 0; k < n; k++) {
    const i = S.mirror ? (k < n / 2 ? k * 2 : (n - 1 - k) * 2) : k, v = bands[Math.min(n - 1, i)];
    const a = angle + k / n * Math.PI * 2 - Math.PI / 2, l = 4 + v * maxL;
    const col = colorAt(Math.min(n - 1, i) / n); ctx.strokeStyle = col; ctx.shadowColor = col;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); ctx.stroke();
  }
  ctx.save(); ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2); ctx.clip();
  if (artImg) { ctx.translate(cx, cy); ctx.rotate(angle * 0.5); ctx.drawImage(artImg, -R, -R, R * 2, R * 2); }
  else { ctx.fillStyle = colorAt(0, 0.25); ctx.fill(); }
  ctx.restore();
}

function drawWave() {
  const len = wave.length, step = Math.max(1, Math.floor(len / W));
  for (let layer = 2; layer >= 0; layer--) {
    const col = colorAt(layer / 2, layer ? 0.5 : 1), amp = H * 0.35 * S.sensitivity * (1 + layer * 0.35);
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.lineWidth = 3 - layer;
    ctx.beginPath();
    for (let x = 0, j = layer * 40; x <= W; x += 2, j += step * 2) {
      const y = H / 2 + ((wave[j % len] - 128) / 128) * amp;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    if (S.mirror) { ctx.save(); ctx.translate(0, H); ctx.scale(1, -1); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.restore(); }
  }
}

function drawParticles(dt) {
  const cx = W / 2, cy = H / 2, n = bands.length, spawn = Math.floor(2 + bass * 30 + S.bars / 32);
  for (let s = 0; s < spawn && particles.length < 2500; s++) {
    const i = Math.random() * n | 0, a = Math.random() * Math.PI * 2, sp = 40 + bands[i] * 500 + bass * 300;
    particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, t: i / n, r: 1 + bands[i] * 4 });
  }
  ctx.shadowBlur = 0; // per-particle shadow is too slow; fake glow with a bigger faint dot
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k];
    p.x += p.vx * dt * (1 + bass); p.y += p.vy * dt * (1 + bass); p.life -= dt * 0.6;
    if (p.life <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { particles.splice(k, 1); continue; }
    if (S.glow) { ctx.fillStyle = colorAt(p.t, p.life * 0.15); ctx.beginPath(); ctx.arc(p.x, p.y, p.r + S.glow * 0.3, 0, 7); ctx.fill(); }
    ctx.fillStyle = colorAt(p.t, p.life); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
  }
  const R = 20 + bass * 60; ctx.fillStyle = colorAt(0, 0.3 + bass * 0.5);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
}

// "2016": a glowing sphere of dots whose surface flows like liquid. Smooth waves (3D noise) roll across it;
// the music sets how tall they are (bass: big waves, mids: ripples, treble: shimmer) and how fast they flow
// (overall loudness). Dots add up where they overlap, which makes the bright rim.
// Unit directions in rows of latitude; rows get fewer dots towards the poles so they don't bunch up there.
const sphereDirs = (() => {
  const rows = 110, out = [];
  for (let i = 0; i < rows; i++) {
    const phi = Math.PI * (i + 0.5) / rows, y = Math.cos(phi), ring = Math.sin(phi), cols = Math.max(6, Math.round(220 * ring));
    for (let j = 0; j < cols; j++) { const th = 2 * Math.PI * j / cols; out.push(ring * Math.cos(th), y, ring * Math.sin(th)); }
  }
  return new Float32Array(out);
})();
// Smooth 3D noise (Ken Perlin's improved noise): roughly -1..1, changing gently through space.
const PERM = (() => {
  const p = [...Array(256).keys()];
  for (let i = 255, s = 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  return Uint8Array.from([...p, ...p]);
})();
const fade = t => t * t * t * (t * (t * 6 - 15) + 10), lerp = (t, a, b) => a + t * (b - a);
function grad(h, x, y, z) { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return (h & 1 ? -u : u) + (h & 2 ? -v : v); }
function noise3(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z), X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx; y -= fy; z -= fz;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(w,
    lerp(v, lerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z)), lerp(u, grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z))),
    lerp(v, lerp(u, grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1)), lerp(u, grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1))));
}
// Music levels for the sphere: each jumps up the instant the music gets louder and falls back over ~0.3 s.
const sphereLevel = { low: 0, mid: 0, high: 0 };
const dots = document.createElement('canvas'), dotsCtx = dots.getContext('2d');
let sphereT = 0, flow = 0;
function draw2016(dt) {
  sphereT += dt;
  const t = sphereT, n = bands.length;
  const peak = (a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, bands[i]); return m; };
  const mean = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += bands[i]; return s / Math.max(1, b - a); };
  const now = { low: peak(0, Math.max(1, n * 0.12 | 0)), mid: mean(n * 0.12 | 0, n * 0.5 | 0), high: mean(n * 0.5 | 0, n) };
  for (const k in now) sphereLevel[k] = Math.max(now[k], sphereLevel[k] - dt * 3);
  const { low, mid, high } = sphereLevel;
  flow += dt * (0.15 + 1.6 * (low + mid + high) / 3); // quiet: a slow drift; busy music: the waves roll faster
  const aLow = 0.03 + low * 0.2, aMid = mid * 0.1, aHigh = high * 0.05, f = flow;
  const size = Math.min(W, H), R = size * 0.32 * (1 + low * 0.05), half = Math.ceil(R * 1.6), dot = Math.max(1.3, size / 600);
  const dpr = Math.min(2, devicePixelRatio || 1), px = Math.ceil(half * 2 * dpr); // full resolution on scaled displays
  if (dots.width !== px) dots.width = dots.height = px; // resizing also clears it
  else dotsCtx.clearRect(0, 0, px, px);
  dotsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const yaw = t * (0.04 + S.spin * 0.15), pitch = 0.35 + Math.sin(t * 0.2) * 0.08, D = 4; // a slow turn; D: camera distance in radii
  const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cpit = Math.cos(pitch), spit = Math.sin(pitch);
  const back = new Path2D(), front = new Path2D(), rim = new Path2D(), big = dot * 1.8;
  for (let k = 0; k < sphereDirs.length; k += 3) {
    const x = sphereDirs[k], y = sphereDirs[k + 1], z = sphereDirs[k + 2];
    // The noise field drifts through the sphere along different directions per layer, so waves roll and fold.
    let disp = 1 + aLow * noise3(x * 1.4 + f * 0.5, y * 1.4 - f * 0.3, z * 1.4 + f * 0.7);
    if (aMid > 0.002) disp += aMid * noise3(x * 3 - f * 0.9, y * 3 + f * 0.6, z * 3 + 10);
    if (aHigh > 0.002) disp += aHigh * noise3(x * 6 + f * 1.5, y * 6 + 20, z * 6 - f * 1.2);
    const x1 = x * cyaw + z * syaw, z1 = z * cyaw - x * syaw; // turn around the vertical axis
    const y2 = y * cpit - z1 * spit, z2 = y * spit + z1 * cpit; // then tilt towards the viewer
    const s = disp * R * D / (D - z2 * disp), px = half + x1 * s, py = half - y2 * s;
    if (Math.abs(z2) < 0.2) rim.rect(px - big / 2, py - big / 2, big, big); // edge-on dots form the bright rim
    else (z2 < 0 ? back : front).rect(px - dot / 2, py - dot / 2, dot, dot);
  }
  const [r, g, b] = palette[0];
  dotsCtx.fillStyle = `rgba(${r},${g},${b},0.3)`; dotsCtx.fill(back); // far side shows through, dimmer
  dotsCtx.fillStyle = `rgba(${r},${g},${b},0.9)`; dotsCtx.fill(front);
  dotsCtx.fillStyle = `rgb(${r},${g},${b})`; dotsCtx.fill(rim);

  const x0 = W / 2 - half, y0 = H / 2 - half;
  ctx.save(); ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'lighter';
  const side = half * 2;
  if (S.glow) { ctx.filter = `blur(${S.glow * 0.8}px)`; ctx.drawImage(dots, x0, y0, side, side); ctx.drawImage(dots, x0, y0, side, side); ctx.filter = 'none'; }
  ctx.drawImage(dots, x0, y0, side, side);
  ctx.restore();
}

// ---------- Now playing (any app Windows knows about, via main.js / media.ps1) ----------
let track = null, prog = { ms: 0, dur: 0, at: 0, playing: false };

// "Spotify.exe" -> "Spotify", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" -> "Media Player"
function appName(id = '') {
  const n = id.split('!').pop().replace(/\.exe$/i, '').split('.').pop();
  if (/^[0-9A-F]{16}$/i.test(n)) return ''; // some apps (e.g. Firefox) report an opaque id
  return { ZuneMusic: 'Media Player', MSEdge: 'Edge' }[n] || n;
}
function onMedia(m) {
  if (!m.active || !m.title) {
    if (track) { track = null; prog.playing = false; artImg = null; albumColors = null; document.title = 'Music Visualizer'; }
  } else {
    const key = `${m.app}|${m.title}|${m.artist}`;
    if (!track || track.key !== key) {
      track = { key };
      $('tTitle').textContent = m.title; $('tArtist').textContent = m.artist || '';
      const src = appName(m.app); $('tSrc').textContent = src ? 'via ' + src : '';
      document.title = m.artist ? `${m.title} — ${m.artist}` : m.title;
      artImg = null; albumColors = null; $('art').removeAttribute('src');
    }
    if (m.art) loadArt(m.art); // sent only when the track changes
    const now = Date.now();
    // updated <= 0 means the player never reported a timestamp (it comes through as year 0001)
    prog = { ms: m.position + (m.playing && m.updated > 0 ? now - m.updated : 0), dur: m.duration, at: performance.now(), playing: m.playing };
  }
  applySettings();
}
function loadArt(url) {
  const img = new Image(), forTrack = track;
  img.onload = () => {
    if (track !== forTrack) return; // the track changed while this cover was decoding
    artImg = img; albumColors = extractColors(img); updatePalette();
  };
  img.src = url; $('art').src = url;
}
function progressTick() {
  if (!track) return;
  $('tBar').classList.toggle('hidden', !(prog.dur > 0)); // browsers often don't report a length
  const ms = prog.ms + (prog.playing ? performance.now() - prog.at : 0);
  $('tProg').style.width = Math.min(100, ms / prog.dur * 100) + '%';
}
function control(action) {
  if (!window.media || !track) return;
  window.media.control(action);
  if (action === 'toggle') { prog.ms += performance.now() - prog.at; prog.at = performance.now(); prog.playing = !prog.playing; }
}

// ---------- Window (transparent mode needs a different window, which main.js swaps in) ----------
const TRANSPARENT = new URLSearchParams(location.search).has('transparent');
document.documentElement.classList.toggle('transparent', TRANSPARENT);
async function syncWindow() {
  const want = S.bg === 'transparent';
  if (!window.appWindow || want === TRANSPARENT) return;
  // Leave fullscreen first so the replacement window gets the normal size (a transparent window's
  // fullscreen isn't visible to main.js, so it can't do this itself); give the window a moment to settle.
  if (document.fullscreenElement) { await document.exitFullscreen(); await new Promise(r => setTimeout(r, 300)); }
  if (audioSource) localStorage.setItem('viz.resumeSource', audioSource); // the new window picks it up
  window.appWindow.setTransparent(want);
}
// In transparent fullscreen, paint the desktop wallpaper behind the visuals: the window then covers
// the desktop icons and taskbar with the bare wallpaper. Windowed transparent mode stays see-through.
const WALLPAPER_SIZE = { fill: 'cover', span: 'cover', fit: 'contain', stretch: '100% 100%', center: 'auto', tile: 'auto' };
async function updateWallpaper() {
  const root = document.documentElement.style;
  if (!TRANSPARENT || !document.fullscreenElement || !window.appWindow) { root.background = ''; return; }
  const w = await window.appWindow.getWallpaper();
  if (!document.fullscreenElement) return; // left fullscreen while it was loading
  root.background = w.image
    ? `${w.color} url("${w.image}") ${w.style === 'tile' ? '0 0' : 'center'} / ${WALLPAPER_SIZE[w.style]} ${w.style === 'tile' ? 'repeat' : 'no-repeat'}`
    : w.color;
}
document.addEventListener('fullscreenchange', updateWallpaper);

// Mini player: main.js resizes the window and keeps it on top; the page switches to the compact layout.
// The query flag carries the state across a window swap (switching transparency while mini).
let mini = new URLSearchParams(location.search).has('mini');
function showMini() {
  document.documentElement.classList.toggle('mini', mini);
  $('btnMini').title = mini ? 'Back to full size (N)' : 'Mini player (N)';
}
showMini();
async function toggleMini() {
  if (!window.appWindow) return;
  if (document.fullscreenElement) await document.exitFullscreen(); // a fullscreen window can't be resized
  mini = !mini;
  showMini();
  window.appWindow.setMini(mini);
}

// ---------- UI ----------
function status(msg) { $('status').textContent = msg; }
function openPanel(force) { $('panel').classList.toggle('hidden', force === undefined ? undefined : !force); }
$('btnPanel').onclick = () => openPanel(); $('btnClose').onclick = () => openPanel(false);
$('btnFs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
$('btnAudio').onclick = () => $('start').classList.remove('hidden');
$('srcSystem').onclick = () => pickSource('system');
$('srcMic').onclick = () => pickSource('mic');
$('srcNone').onclick = () => pickSource('none');
$('bPlay').onclick = () => control('toggle'); $('bNext').onclick = () => control('next'); $('bPrev').onclick = () => control('prev');
$('btnReset').onclick = () => { S = { ...DEFAULTS }; save(); bindSettings(); applySettings(); syncWindow(); };
$('btnMini').onclick = toggleMini;
$('btnMin').onclick = () => window.appWindow?.minimize();
$('btnQuit').onclick = () => window.appWindow?.close();
addEventListener('keydown', e => {
  if (e.target.matches('input, select')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') openPanel();
  else if (k === 'f' && !mini) $('btnFs').click();
  else if (k === 'n') toggleMini();
  else if (k === ' ') { e.preventDefault(); control('toggle'); }
  else if (k === 'arrowright') control('next');
  else if (k === 'arrowleft') control('prev');
  else if (k === 'm') { const m = ['bars', 'radial', 'wave', 'particles', '2016']; S.mode = m[(m.indexOf(S.mode) + 1) % m.length]; save(); bindSettings(); }
});

bindSettings(); applySettings();
window.appWindow?.getBackgroundImage().then(showBackgroundImage);
window.media?.onUpdate(onMedia);
syncWindow(); // e.g. the saved window type and the saved background disagree
const resume = localStorage.getItem('viz.resumeSource');
if (resume) { localStorage.removeItem('viz.resumeSource'); pickSource(resume); } // just switched window type
else $('srcSystem').focus(); // the picker stays open until a choice; Enter picks System audio
requestAnimationFrame(frame);
