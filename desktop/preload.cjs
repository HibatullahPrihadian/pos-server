const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posPrinter', {
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  getSelectedPrinter: () => ipcRenderer.invoke('printer:selected'),
  selectPrinter: (payload) => ipcRenderer.invoke('printer:select', payload),
  clearSelectedPrinter: () => ipcRenderer.invoke('printer:clear'),
  print: (payload) => ipcRenderer.invoke('printer:print', payload),
  testPrint: () => ipcRenderer.invoke('printer:test'),
});
