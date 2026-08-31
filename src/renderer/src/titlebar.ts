/**
 * Custom window chrome for the frameless BrowserWindow (src/main/index.ts
 * sets frame: false to remove the OS titlebar and default menu entirely).
 * Left to right: the Gridwork mark and wordmark, an appearance-settings
 * entry point, the draggable strip, and the minimize/maximize/close buttons
 * a frameless window still needs to stay usable. See src/preload/index.ts
 * for the IPC calls the window-control buttons make.
 */

/**
 * The Gridwork mark: four bars woven over and under, checkerboard fashion.
 * The breaks in each path are the weave -- a bar stops 0.8 units short of
 * the crossing it passes *under* and resumes on the far side, so it must be
 * drawn with butt caps. Round caps would extend 2 units past each endpoint
 * (half the stroke width) and close the gaps back up.
 *
 * Same contract as ui/icons.ts: 32-unit box, stroke="currentColor", so the
 * titlebar's `color` token drives it and all six themes work off one copy.
 * The full mark set and the alternates it was chosen from live in
 * assets/brand/.
 */
const BRAND_MARK = `<svg viewBox="0 0 32 32" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="butt"><path d="M3 11H8.2M13.8 11H29"/><path d="M3 21H18.2M23.8 21H29"/><path d="M11 3V18.2M11 23.8V29"/><path d="M21 3V8.2M21 13.8V29"/></svg>`;

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
    <div class="titlebar-brand">
      ${BRAND_MARK}
      <span class="titlebar-brand-name">Gridwork</span>
    </div>
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
