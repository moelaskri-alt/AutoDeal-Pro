import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('adpPrint', {
  savePdf: () => ipcRenderer.invoke('print:savePdf'),
});
