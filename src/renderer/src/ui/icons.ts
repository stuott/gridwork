/**
 * Inline SVG icon set for the toolbar, settings modal and board chrome.
 *
 * Everything is drawn with `stroke="currentColor"` on a 24x24 viewBox, so a
 * button only has to set `color` (which the theme tokens already do) for the
 * icon to follow along -- no per-theme icon variants, same trick board.ts
 * uses for the grid itself. Titlebar icons stay in titlebar.ts: they're
 * window chrome sized to the OS convention, not part of this set.
 */

export type IconName =
  | "pencil"
  | "check"
  | "undo"
  | "redo"
  | "lightbulb"
  | "trash"
  | "play"
  | "pause"
  | "minus"
  | "plus"
  | "droplet"
  | "ban"
  | "close"
  | "palette"
  | "shield-check"
  | "grid";

const PATHS: Record<IconName, string> = {
  pencil: `<path d="M4 20h4L20 8a2.4 2.4 0 0 0-4-4L4 16v4Z"/><path d="M14.5 5.5l4 4"/>`,
  check: `<path d="M20 6.5 9.4 17.5 4 12"/>`,
  undo: `<path d="M9 5.5 3.5 11 9 16.5"/><path d="M3.5 11h10.75A6.25 6.25 0 0 1 14.25 23.5H10"/>`,
  redo: `<path d="M15 5.5 20.5 11 15 16.5"/><path d="M20.5 11H9.75A6.25 6.25 0 0 0 9.75 23.5H14"/>`,
  lightbulb: `<path d="M12 2.5a6.2 6.2 0 0 0-3.7 11.2c.7.5 1.2 1.3 1.2 2.2v1h5v-1c0-.9.5-1.7 1.2-2.2A6.2 6.2 0 0 0 12 2.5Z"/><path d="M9.5 19h5"/><path d="M10.5 21.5h3"/>`,
  trash: `<path d="M3.5 6.5h17"/><path d="M9 6.5V4h6v2.5"/><path d="M6 6.5 7 20.5h10l1-14"/><path d="M10.5 10.5v6M13.5 10.5v6"/>`,
  play: `<path d="M7 4.5 19 12 7 19.5Z"/>`,
  pause: `<path d="M8.5 4.5v15M15.5 4.5v15"/>`,
  minus: `<path d="M5 12h14"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  droplet: `<path d="M12 2.8s6.2 6.6 6.2 10.4a6.2 6.2 0 0 1-12.4 0C5.8 9.4 12 2.8 12 2.8Z"/>`,
  ban: `<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  palette: `<path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.9-.8 1.9-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7h1.6A4.8 4.8 0 0 0 21 10.4C21 6.3 16.9 3 12 3Z"/><circle cx="7.8" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.6" cy="8.4" r="1.1" fill="currentColor" stroke="none"/>`,
  "shield-check": `<path d="M12 2.8 4.5 5.9v5.6c0 4.4 3.1 8.4 7.5 9.7 4.4-1.3 7.5-5.3 7.5-9.7V5.9L12 2.8Z"/><path d="M8.8 11.9 11.2 14.3 15.6 9.9"/>`,
  grid: `<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.17 3.5v17M14.83 3.5v17M3.5 9.17h17M3.5 14.83h17"/>`,
};

/** Icon markup as a string, for innerHTML/template use. */
export function iconSvg(name: IconName, size = 16): string {
  return (
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" ` +
    `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    `${PATHS[name]}</svg>`
  );
}

export interface IconButtonOptions {
  /** Visible text next to the icon. Omit for an icon-only (square) button. */
  label?: string;
  /** Tooltip + accessible name. Required when there's no visible label. */
  title: string;
  className?: string;
  onClick?: () => void;
  size?: number;
}

/** Builds a `<button>` carrying an icon and, optionally, a visible label. */
export function iconButton(name: IconName, opts: IconButtonOptions): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = ["icon-btn", opts.label ? undefined : "icon-only", opts.className]
    .filter(Boolean)
    .join(" ");
  btn.title = opts.title;
  btn.setAttribute("aria-label", opts.title);
  btn.innerHTML = iconSvg(name, opts.size ?? 16);
  if (opts.label) {
    const span = document.createElement("span");
    span.className = "icon-btn-label";
    span.textContent = opts.label;
    btn.appendChild(span);
  }
  if (opts.onClick) btn.onclick = opts.onClick;
  return btn;
}

/** Swaps the icon inside a button built by iconButton(), keeping its label. */
export function setButtonIcon(btn: HTMLButtonElement, name: IconName, size = 16): void {
  const svg = btn.querySelector("svg");
  if (svg) svg.outerHTML = iconSvg(name, size);
}
