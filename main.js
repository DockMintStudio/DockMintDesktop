const { app, BrowserWindow, session, ipcMain, dialog, shell, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
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

ipcMain.handle("dockmint:open-external", async (_event, url) => {
  if (typeof url !== "string" || url !== "https://ollama.com/settings/usage") throw new Error("Only the official Ollama usage page can be opened here.");
  await shell.openExternal(url); return true;
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



const aiKeyPath = () => path.join(app.getPath("userData"), "ollama-cloud-key.enc");
async function readCloudKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = await fs.readFile(aiKeyPath());
    return safeStorage.decryptString(encrypted);
  } catch { return null; }
}
ipcMain.handle("dockmint:ai-key-status", async () => {
  const key = await readCloudKey();
  return { configured: !!key, secureStorage: safeStorage.isEncryptionAvailable(), masked: key ? `••••••••${key.slice(-4)}` : "" };
});
ipcMain.handle("dockmint:test-ai-key", async () => {
  const key = await readCloudKey();
  if (!key) throw new Error("No saved API key. Add and save a key first.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gemma4:31b", messages: [{ role: "user", content: "Reply with only: DockMint connection test passed." }], stream: false }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ollama returned HTTP ${response.status}.`);
    if (typeof data?.message?.content !== "string") throw new Error("Ollama responded, but the reply format was unexpected.");
    return { ok: true, model: data.model || "gemma4:31b" };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Connection test timed out. Try again later.");
    throw new Error(error.message || "Connection test failed.");
  } finally { clearTimeout(timer); }
});
ipcMain.handle("dockmint:save-ai-key", async (_event, key) => {
  if (typeof key !== "string" || key.trim().length < 10 || key.length > 500) throw new Error("Enter a valid Ollama Cloud API key.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable on this system. The key was not saved.");
  await fs.writeFile(aiKeyPath(), safeStorage.encryptString(key.trim()));
  return { saved: true };
});
ipcMain.handle("dockmint:remove-ai-key", async () => { await fs.rm(aiKeyPath(), { force: true }); return { removed: true }; });
ipcMain.handle("dockmint:ai-chat", async (event, payload) => {
  if (!payload || typeof payload.message !== "string" || payload.message.length > 12000) throw new Error("Message is empty or too long.");
  const provider = payload.provider === "cloud" ? "cloud" : "local";
  const model = typeof payload.model === "string" ? payload.model.trim().slice(0,100) : (provider === "cloud" ? "gemma4:31b" : "qwen3:4b");
  const messages = [{ role: "system", content: "You are DockMint AI, the built-in assistant inside DockMint Desktop. Be helpful, accurate, and clear. Do not claim you can browse, search, read, create, edit, route, or classify the user's real files unless the app explicitly provides that capability in this conversation. DockMint's current assistant can answer questions and help the user plan; it does not automatically have access to their files or dashboard data. Never invent DockMint features or pretend to have performed actions. If unsure, say so. Use clean Markdown: headings, short paragraphs, and lists only when useful. Do not overuse headings or bold text." }];
  if (Array.isArray(payload.messages)) messages.push(...payload.messages.slice(-20).filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string").map(m=>({role:m.role,content:m.content.slice(0,12000)})));
  messages.push({ role: "user", content: payload.message });
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), 120000);
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  try {
    let url, headers = { "Content-Type": "application/json" };
    if (provider === "cloud") {
      const key = await readCloudKey();
      if (!key) throw new Error("Connect an Ollama Cloud API key in AI settings first.");
      url = "https://ollama.com/api/chat"; headers.Authorization = `Bearer ${key}`;
    } else url = "http://127.0.0.1:11434/api/chat";
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: model || (provider === "cloud" ? "gemma4:31b" : "qwen3:4b"), messages, stream: true }), signal: controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(()=>({}));
      if (response.status === 401) throw new Error("Ollama Cloud rejected the API key. Open AI settings and test or replace the saved key.");
      if (provider === "local" && response.status === 404) throw new Error(`Local model “${model}” isn't installed. Install it in Ollama or choose an installed model.`);
      throw new Error(data.error || `AI request failed (${response.status}).`);
    }
    if (!response.body) throw new Error("This AI provider did not return a streaming response.");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", answer = "", actualModel = model;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let item; try { item = JSON.parse(line); } catch { continue; }
        if (item.model) actualModel = item.model;
        const chunk = item?.message?.content;
        if (typeof chunk === "string" && chunk) {
          answer += chunk;
          if (requestId && !event.sender.isDestroyed()) event.sender.send("dockmint:ai-stream", { requestId, chunk });
        }
        if (item.error) throw new Error(item.error);
      }
      if (done) break;
    }
    if (buffer.trim()) { try { const item=JSON.parse(buffer); const chunk=item?.message?.content; if(typeof chunk==="string"&&chunk){answer+=chunk;if(requestId&&!event.sender.isDestroyed())event.sender.send("dockmint:ai-stream",{requestId,chunk})} if(item.model)actualModel=item.model; } catch {} }
    if (!answer) throw new Error("The AI provider returned an empty response.");
    return { answer, model: actualModel, provider };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The AI request timed out. Try a shorter message or a smaller model.");
    if (provider === "local" && (error.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(error.message))) throw new Error("Can't reach local Ollama. Open Ollama and make sure the selected model is installed.");
    throw new Error(error.message || "Could not contact the AI provider.");
  } finally { clearTimeout(timer); }
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
