const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  selectPDF: () => ipcRenderer.invoke('select-pdf'),
  selectSaveLocation: (defaultName) => ipcRenderer.invoke('select-save-location', defaultName),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  
  // Menu event listeners
  onNewProject: (callback) => ipcRenderer.on('menu-new-project', callback),
  onOpenProject: (callback) => ipcRenderer.on('menu-open-project', (event, path) => callback(path)),
  onSave: (callback) => ipcRenderer.on('menu-save', callback),
  onExport: (callback) => ipcRenderer.on('menu-export', callback),
  onUndo: (callback) => ipcRenderer.on('menu-undo', callback),
  onRedo: (callback) => ipcRenderer.on('menu-redo', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // Platform info
  platform: process.platform,
  isElectron: true
});

// Notify that preload is ready
window.addEventListener('DOMContentLoaded', () => {
  console.log('KorrekturPro: Electron preload ready');
});
