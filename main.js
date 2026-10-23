const { app, BrowserWindow, session, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");

let updateState = { status: "checking", currentVersion: app.getVersion(), availableVersion: null, progress: 0, message: "Checking for updates…" };
function broadcastUpdateState() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("dockmint:update-state", updateState);
  }
}
function setUpdateState(next) { updateState = { ...updateState, ...next }; broadcastUpdateState(); }

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
autoUpdater.allowDowngrade = false;

autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", message: "Checking for updates…", progress: 0 }));
autoUpdater.on("update-available", info => setUpdateState({ status: "out-of-date", availableVersion: info.version, message: `Version ${info.version} is available.`, progress: 0 }));
autoUpdater.on("update-not-available", info => setUpdateState({ status: "up-to-date", availableVersion: null, message: `DockMint is up to date (v${info.version}).`, progress: 0 }));
autoUpdater.on("download-progress", progress => setUpdateState({ status: "downloading", progress: Math.round(progress.percent), message: `Downloading update… ${Math.round(progress.percent)}%` }));
autoUpdater.on("update-downloaded", info => setUpdateState({ status: "downloaded", availableVersion: info.version, progress: 100, message: `Version ${info.version} is ready to install.` }));
autoUpdater.on("error", error => {
  console.error("DockMint update check failed:", error);
  setUpdateState({ status: "error", message: "Could not check for updates. Try again later." });
});

async function checkForUpdates() {
  if (!app.isPackaged) { setUpdateState({ status: "dev", message: "Updates are available in the installed app." }); return updateState; }
  try { await autoUpdater.checkForUpdates(); } catch (error) { console.error(error); }
  return updateState;
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1420, height: 920, minWidth: 900, minHeight: 620,
    title: "DockMint Desktop", backgroundColor: "#111318", autoHideMenuBar: true,
    icon: path.join(__dirname, "DockMint.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, spellcheck: true
    }
  });
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith("file://")) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("dockmint:update-state", () => ({ ...updateState, packaged: app.isPackaged }));
ipcMain.handle("dockmint:check-updates", async () => checkForUpdates());
ipcMain.handle("dockmint:download-update", async () => {
  if (!app.isPackaged || updateState.status !== "out-of-date") return { ...updateState, packaged: app.isPackaged };
  try { await autoUpdater.downloadUpdate(); } catch (error) { setUpdateState({ status: "error", message: "Update download failed. Please try again." }); }
  return updateState;
});
ipcMain.handle("dockmint:install-update", () => {
  if (updateState.status !== "downloaded") return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle("dockmint:choose-file", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"] });
  if (result.canceled || !result.filePaths.length) return null;
  const chosen = result.filePaths[0];
  const stat = await fs.stat(chosen);
  if (!stat.isFile()) throw new Error("Please choose a file.");
  return { path: chosen, name: path.basename(chosen), kind: "file", ext: path.extname(chosen).slice(1).toUpperCase() || "FILE" };
});

ipcMain.handle("dockmint:choose-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths.length) return null;
  const chosen = result.filePaths[0];
  const stat = await fs.stat(chosen);
  if (!stat.isDirectory()) throw new Error("Please choose a folder.");
  return { path: chosen, name: path.basename(chosen) || chosen, kind: "folder", ext: "DIR" };
});

// This handler only asks Windows to open a user-selected path. DockMint has no
// IPC commands for writing, moving, renaming, or deleting user files.
ipcMain.handle("dockmint:open-path", async (_event, requestedPath) => {
  if (typeof requestedPath !== "string" || !path.isAbsolute(requestedPath)) throw new Error("Invalid file link.");
  const resolved = path.resolve(requestedPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || (!stat.isFile() && !stat.isDirectory())) throw new Error("That file or folder is no longer available.");
  const error = await shell.openPath(resolved);
  if (error) throw new Error(error);
  return true;
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  if (app.isPackaged) {
    setTimeout(() => { checkForUpdates(); }, 5000);
    setInterval(() => { checkForUpdates(); }, 6 * 60 * 60 * 1000);
  } else {
    setUpdateState({ status: "dev", message: "Updates are available in the installed app." });
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
