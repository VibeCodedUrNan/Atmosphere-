// Turns images into data: URLs the page can show.
const fs = require('fs/promises');

const toDataUrl = (bytes, type) => {
  if (!type || !type.startsWith('image/')) {
    type = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0x42 ? 'image/bmp' : bytes[0] === 0x47 ? 'image/gif'
      : bytes[0] === 0x52 ? 'image/webp' : 'image/jpeg';
  }
  return `data:${type};base64,${bytes.toString('base64')}`;
};

// A cover from a file:// or http(s):// address, or a plain file path; '' if it can't be had.
async function loadImage(url) {
  try {
    if (/^https?:\/\//.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      return r.ok ? toDataUrl(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type')) : '';
    }
    return toDataUrl(await fs.readFile(url.startsWith('file://') ? new URL(url) : url));
  } catch { return ''; }
}

module.exports = { toDataUrl, loadImage };
