const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dockmintAPI", Object.freeze({
  chooseFile: () => ipcRenderer.invoke("dockmint:choose-file"),
  chooseFolder: () => ipcRenderer.invoke("dockmint:choose-folder"),
  openPath: (selectedPath) => ipcRenderer.invoke("dockmint:open-path", selectedPath),
  openExternal: (url) => ipcRenderer.invoke("dockmint:open-external", url),
  aiChat: (payload) => ipcRenderer.invoke("dockmint:ai-chat", payload),
  onAiStream: (callback) => { if (typeof callback !== "function") return () => {}; const listener = (_event, data) => callback(data); ipcRenderer.on("dockmint:ai-stream", listener); return () => ipcRenderer.removeListener("dockmint:ai-stream", listener); },
  aiKeyStatus: () => ipcRenderer.invoke("dockmint:ai-key-status"),
  testAiKey: () => ipcRenderer.invoke("dockmint:test-ai-key"),
  saveAiKey: (key) => ipcRenderer.invoke("dockmint:save-ai-key", key),
  removeAiKey: () => ipcRenderer.invoke("dockmint:remove-ai-key"),
  getUpdateState: () => ipcRenderer.invoke("dockmint:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("dockmint:check-updates"),
  downloadUpdate: () => ipcRenderer.invoke("dockmint:download-update"),
  installUpdate: () => ipcRenderer.invoke("dockmint:install-update"),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("dockmint:update-state", listener);
    return () => ipcRenderer.removeListener("dockmint:update-state", listener);
  }
}));
