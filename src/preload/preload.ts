import { contextBridge, ipcRenderer } from 'electron';

/** The only bridge between the UI and the main process. No Node APIs are exposed. */
contextBridge.exposeInMainWorld('adp', {
  call: (method: string, args?: unknown) => ipcRenderer.invoke('api', method, args),
  onDataChanged: (cb: (method: string) => void) => {
    const listener = (_e: unknown, method: string) => cb(method);
    ipcRenderer.on('data:changed', listener);
    return () => ipcRenderer.removeListener('data:changed', listener);
  },
});
