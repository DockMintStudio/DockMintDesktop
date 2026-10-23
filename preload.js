const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dockmintAPI", Object.freeze({
  chooseFile: () => ipcRenderer.invoke("dockmint:choose-file"),
  chooseFolder: () => ipcRenderer.invoke("dockmint:choose-folder"),
  openPath: (selectedPath) => ipcRenderer.invoke("dockmint:open-path", selectedPath),
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
