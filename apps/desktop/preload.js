const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tally", {
  testConnection: (ip, port) => ipcRenderer.invoke("tally:test", { ip, port }),
  fetchStock: (ip, port, company) =>
    ipcRenderer.invoke("tally:stock", { ip, port, company }),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("sync:progress", listener);
    return () => ipcRenderer.removeListener("sync:progress", listener);
  },
  getSyncRuns: () => ipcRenderer.invoke("sync:runs"),
});
