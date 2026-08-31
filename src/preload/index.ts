import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export interface FetchTextResult {
  ok: boolean;
  status: number;
  text: string;
}

/**
 * Custom window chrome support: src/main/index.ts creates the BrowserWindow
 * with frame: false (no OS titlebar, no default menu), so the renderer's
 * custom titlebar (src/renderer/src/titlebar.ts) has no direct way to
 * minimize/maximize/close the window -- it has to ask the main process to
 * do it, over IPC, same as the puzzle-fetching API below.
 */
const windowControls = {
  minimize: (): void => ipcRenderer.send("window-minimize"),
  toggleMaximize: (): void => ipcRenderer.send("window-maximize-toggle"),
  close: (): void => ipcRenderer.send("window-close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window-is-maximized"),
  /**
   * Fires whenever the window's maximized state changes for any reason --
   * clicking the titlebar button, double-clicking the drag region, an OS
   * shortcut, or dragging to a screen edge -- so the titlebar can keep its
   * maximize/restore icon in sync. Returns an unsubscribe function.
   */
  onMaximizedChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, isMaximized: boolean): void => callback(isMaximized);
    ipcRenderer.on("window-maximized-change", listener);
    return () => ipcRenderer.removeListener("window-maximized-change", listener);
  },
};

/**
 * The only things exposed to the renderer: ask the main process to fetch a
 * URL and hand back the raw text, and the window controls above.
 * contextIsolation is on and nodeIntegration is off (see
 * src/main/index.ts's BrowserWindow config), so this contextBridge call is
 * the renderer's only door to anything privileged -- it can't reach
 * ipcRenderer, Node, or the filesystem directly.
 */
const api = {
  fetchText: (url: string): Promise<FetchTextResult> => ipcRenderer.invoke("fetch-text", url),
  windowControls,
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
