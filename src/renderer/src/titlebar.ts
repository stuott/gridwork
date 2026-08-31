/**
 * Custom window chrome for the frameless BrowserWindow (src/main/index.ts
 * sets frame: false to remove the OS titlebar and default menu entirely).
 * No app title or icon -- just a draggable strip, an appearance-settings
 * entry point on the left, and the minimize/maximize/close buttons a
 * frameless window still needs to stay usable. See src/preload/index.ts for
 * the IPC calls the window-control buttons make.
 */

const SETTINGS_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94a7.14 7.14 0 0 0 .06-.94 7.14 7.14 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.66.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.24.1.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64ZM12 15.38a3.38 3.38 0 1 1 0-6.76 3.38 3.38 0 0 1 0 6.76Z"/></svg>`;

const MAXIMIZE_ICON = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

const RESTORE_ICON = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="2.5" y="1" width="6.5" height="6.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M1 3.5V9h5.5" fill="var(--paper)" stroke="currentColor" stroke-width="1"/></svg>`;

const MINIMIZE_ICON = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M0.5 5h9" stroke="currentColor" stroke-width="1"/></svg>`;

const CLOSE_ICON = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" stroke-width="1"/></svg>`;

export interface TitlebarOptions {
  /** Called when the settings button in the titlebar is clicked. */
  onOpenSettings: () => void;
}

export function initTitlebar(options: TitlebarOptions): void {
  const el = document.querySelector<HTMLDivElement>("#titlebar");
  if (!el) return;

  el.innerHTML = `
    <div class="titlebar-left">
      <button type="button" id="titlebar-settings-btn" class="titlebar-btn" aria-label="Open appearance settings" title="Appearance settings">${SETTINGS_ICON}</button>
    </div>
    <div class="titlebar-drag"></div>
    <div class="titlebar-buttons"></div>
  `;

  el.querySelector<HTMLButtonElement>("#titlebar-settings-btn")!.onclick = options.onOpenSettings;

  // Outside Electron (e.g. opening the renderer's dev URL directly in a
  // plain browser tab -- see electron.vite.config.ts's dev proxy) there's
  // no window to control. Leave the minimize/maximize/close buttons out
  // rather than showing controls that would do nothing, but keep the drag
  // strip and settings button -- those work (or are harmless) either way.
  if (!window.api) return;

  const controls = window.api.windowControls;
  const buttonsEl = el.querySelector<HTMLDivElement>(".titlebar-buttons")!;

  buttonsEl.innerHTML = `
    <button type="button" class="titlebar-btn" data-action="minimize" aria-label="Minimize">${MINIMIZE_ICON}</button>
    <button type="button" class="titlebar-btn" data-action="maximize" aria-label="Maximize">${MAXIMIZE_ICON}</button>
    <button type="button" class="titlebar-btn titlebar-btn-close" data-action="close" aria-label="Close">${CLOSE_ICON}</button>
  `;

  const minimizeBtn = buttonsEl.querySelector<HTMLButtonElement>('[data-action="minimize"]')!;
  const maximizeBtn = buttonsEl.querySelector<HTMLButtonElement>('[data-action="maximize"]')!;
  const closeBtn = buttonsEl.querySelector<HTMLButtonElement>('[data-action="close"]')!;

  minimizeBtn.addEventListener("click", () => controls.minimize());
  maximizeBtn.addEventListener("click", () => controls.toggleMaximize());
  closeBtn.addEventListener("click", () => controls.close());

  function setMaximized(isMaximized: boolean): void {
    maximizeBtn.innerHTML = isMaximized ? RESTORE_ICON : MAXIMIZE_ICON;
    maximizeBtn.setAttribute("aria-label", isMaximized ? "Restore" : "Maximize");
  }

  controls.isMaximized().then(setMaximized);
  controls.onMaximizedChange(setMaximized);
}
