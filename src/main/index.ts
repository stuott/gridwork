import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { join } from "node:path";

/**
 * Electron main process. Three jobs:
 *  1. Create the app window and load the renderer (dev server in dev, the
 *     built renderer/index.html in production).
 *  2. Expose a single "fetch-text" IPC handler (see src/preload/index.ts)
 *     that does the actual network fetch of a SudokuPad puzzle from here,
 *     in Node, instead of from the renderer's browser context.
 *  3. Expose the window-minimize/maximize/close IPC handlers the custom
 *     titlebar needs (see src/renderer/src/titlebar.ts), since the window
 *     is created with frame: false below -- no OS titlebar, no default
 *     application menu, so the renderer is the only source of those
 *     controls and has to ask the main process to actually perform them.
 *
 * That second point matters: fetching from the main process has no CORS
 * restriction at all, in dev OR in the packaged app. This replaces the
 * vite-dev-server-proxy workaround from the pre-Electron version of this app
 * (see design.md section 2.2/8), which only worked while `vite dev` was
 * running and would have needed a different answer for a packaged build.
 */

// Puzzle data only ever needs to come from these two hosts. The renderer
// asks for a URL by string (see fetchPuzzle.ts), but the main process is the
// one place that's actually trusted to make network requests, so it checks
// the destination itself rather than trusting the renderer's input blindly.
const ALLOWED_HOSTS = new Set([
  "sudokupad.app",
  "app.crackingthecryptic.com",
  "sudokupad.svencodes.com",
]);

ipcMain.handle("fetch-text", async (_event, urlString: string) => {
  const url = new URL(urlString);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to fetch from disallowed host: ${url.hostname}`);
  }
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, text: await res.text() };
});

// Window controls for the custom titlebar. Resolved against event.sender
// (the window that actually asked) rather than a single module-level
// reference, so this keeps working correctly if the app ever grows more
// than one window.
ipcMain.on("window-minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window-maximize-toggle", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on("window-close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("window-is-maximized", (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    // No OS titlebar/menu at all -- src/renderer/src/titlebar.ts draws a
    // custom one instead. The app has no title or icon yet on purpose
    // (blank brand slate); this is just the minimize/maximize/close
    // controls a frameless window still needs to stay usable.
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keeps the titlebar's maximize/restore icon in sync when the window is
  // maximized or restored some way other than clicking that button --
  // double-clicking the drag region, an OS keyboard shortcut, or dragging
  // to a screen edge.
  win.on("maximize", () => win.webContents.send("window-maximized-change", true));
  win.on("unmaximize", () => win.webContents.send("window-maximized-change", false));

  // electron-vite injects these env vars in dev; in a built app ELECTRON_RENDERER_URL
  // is undefined and we load the built HTML file instead.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Belt-and-suspenders alongside frame: false above: makes sure no native
  // File/Edit/View/Window/Help menu strip can appear above the custom
  // titlebar on any platform.
  Menu.setApplicationMenu(null);

  createWindow();

  app.on("activate", () => {
    // macOS convention: clicking the dock icon with no windows open re-creates one.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Windows/Linux convention: quit when the last window closes. macOS apps
  // conventionally stay running in the dock instead -- not done here yet,
  // kept simple for the scaffold (see design.md's Electron phase notes).
  if (process.platform !== "darwin") app.quit();
});
