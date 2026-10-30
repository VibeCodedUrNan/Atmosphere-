// Gives the page now-playing updates, playback controls and window controls from main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('media', {
  onUpdate: cb => ipcRenderer.on('media', (_e, data) => cb(data)),
  control: cmd => ipcRenderer.send('media-control', cmd),
});

contextBridge.exposeInMainWorld('appWindow', {
  platform: process.platform,
  getMonitorName: () => ipcRenderer.invoke('monitor-name'),
  setTransparent: on => ipcRenderer.send('set-transparent', on),
  getWallpaper: () => ipcRenderer.invoke('wallpaper'),
  getBackgroundImage: () => ipcRenderer.invoke('background-image'),
  setBackgroundImage: jpegBytes => ipcRenderer.invoke('set-background-image', jpegBytes),
  setMini: on => ipcRenderer.send('mini', on),
  minimize: () => ipcRenderer.send('window', 'minimize'),
  close: () => ipcRenderer.send('window', 'close'),
});
