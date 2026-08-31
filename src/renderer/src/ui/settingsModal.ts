import {
  THEME_FAMILIES,
  applyThemePref,
  loadThemePref,
  saveThemePref,
  type ThemeFamily,
  type ThemeMode,
  type ThemePref,
} from "../theme";
import {
  getVerificationPrefs,
  setVerificationPrefs,
  subscribeVerification,
  type VerificationPrefs,
} from "../settings";
import { iconButton, iconSvg, type IconName } from "./icons";

interface TabDef {
  id: string;
  label: string;
  icon: IconName;
  build: () => HTMLElement;
}

/**
 * Settings modal, tabbed. "Theme" is the original appearance panel (theme
 * family x light/dark, six combinations); "Verification" holds the solving
 * aids that used to sit as bare checkboxes in the board toolbar --
 * auto-candidates and live conflict checking -- which are preferences
 * rather than per-move actions and were crowding the action buttons.
 * Everything applies immediately and persists (theme.ts / settings.ts).
 */
export class SettingsModal {
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;
  private tabList: HTMLDivElement;
  private tabPanels: HTMLDivElement;
  private pref: ThemePref;
  private familyButtons = new Map<ThemeFamily, HTMLButtonElement>();
  private modeButtons = new Map<ThemeMode, HTMLButtonElement>();
  private tabButtons = new Map<string, HTMLButtonElement>();
  private tabBodies = new Map<string, HTMLElement>();
  private verificationInputs = new Map<keyof VerificationPrefs, HTMLInputElement>();
  private activeTab = "theme";
  private lastFocused: HTMLElement | null = null;
  private boundKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !this.overlay.hidden) this.close();
  };

  constructor() {
    this.pref = loadThemePref();

    this.overlay = document.createElement("div");
    this.overlay.className = "settings-overlay";
    this.overlay.hidden = true;

    this.panel = document.createElement("div");
    this.panel.className = "settings-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-labelledby", "settings-title");

    this.tabList = document.createElement("div");
    this.tabList.className = "settings-tablist";
    this.tabList.setAttribute("role", "tablist");
    this.tabList.setAttribute("aria-label", "Settings sections");

    this.tabPanels = document.createElement("div");
    this.tabPanels.className = "settings-tabpanels";

    const tabs: TabDef[] = [
      { id: "theme", label: "Theme", icon: "palette", build: () => this.buildThemeTab() },
      { id: "verification", label: "Verification", icon: "shield-check", build: () => this.buildVerificationTab() },
    ];

    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-tab";
      btn.id = `settings-tab-${tab.id}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", `settings-panel-${tab.id}`);
      btn.innerHTML = iconSvg(tab.icon, 15);
      const label = document.createElement("span");
      label.textContent = tab.label;
      btn.appendChild(label);
      btn.onclick = () => this.selectTab(tab.id);
      btn.onkeydown = (e) => this.handleTabKey(e, tabs, tab.id);
      this.tabButtons.set(tab.id, btn);
      this.tabList.appendChild(btn);

      const body = tab.build();
      body.id = `settings-panel-${tab.id}`;
      body.setAttribute("role", "tabpanel");
      body.setAttribute("aria-labelledby", `settings-tab-${tab.id}`);
      this.tabBodies.set(tab.id, body);
      this.tabPanels.appendChild(body);
    }

    this.panel.append(this.buildHeader(), this.tabList, this.tabPanels);
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.addEventListener("keydown", this.boundKeyDown);

    // Keyboard shortcuts on the board can flip the same prefs, so mirror
    // external changes back into the checkboxes instead of going stale.
    subscribeVerification((prefs) => this.syncVerification(prefs));

    this.selectTab(this.activeTab);
    this.syncButtons();
  }

  open(): void {
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.overlay.hidden = false;
    this.tabButtons.get(this.activeTab)?.focus();
  }

  close(): void {
    this.overlay.hidden = true;
    this.lastFocused?.focus();
  }

  private selectTab(id: string): void {
    this.activeTab = id;
    for (const [tabId, btn] of this.tabButtons) {
      const active = tabId === id;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
      btn.tabIndex = active ? 0 : -1;
    }
    for (const [tabId, body] of this.tabBodies) {
      body.hidden = tabId !== id;
    }
  }

  /** Left/Right arrow keys move between tabs, as expected of a real tablist. */
  private handleTabKey(e: KeyboardEvent, tabs: TabDef[], currentId: string): void {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.id === currentId);
    const next = tabs[(idx + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    this.selectTab(next.id);
    this.tabButtons.get(next.id)?.focus();
  }

  private buildHeader(): HTMLDivElement {
    const header = document.createElement("div");
    header.className = "settings-header";

    const title = document.createElement("h2");
    title.id = "settings-title";
    title.textContent = "Settings";

    const closeBtn = iconButton("close", {
      title: "Close settings",
      className: "settings-close",
      onClick: () => this.close(),
      size: 15,
    });

    header.append(title, closeBtn);
    return header;
  }

  private buildThemeTab(): HTMLElement {
    const tab = document.createElement("div");
    tab.className = "settings-tabpanel";
    tab.append(this.buildThemeSection(), this.buildModeSection());
    return tab;
  }

  private buildVerificationTab(): HTMLElement {
    const tab = document.createElement("div");
    tab.className = "settings-tabpanel";

    const section = document.createElement("div");
    section.className = "settings-section";

    const label = document.createElement("div");
    label.className = "settings-section-label";
    label.textContent = "Solving aids";
    section.appendChild(label);

    section.appendChild(
      this.buildCheckRow(
        "autoCandidates",
        "Show auto-candidates",
        "Fill every empty cell with the candidates the solver can still see, instead of your own pencil marks.",
      ),
    );
    section.appendChild(
      this.buildCheckRow(
        "liveChecking",
        "Live conflict checking",
        "Flag rule violations the moment you enter a digit. With this off, the board only reports mistakes when you press Check.",
      ),
    );

    tab.appendChild(section);
    return tab;
  }

  private buildCheckRow(key: keyof VerificationPrefs, title: string, description: string): HTMLLabelElement {
    const row = document.createElement("label");
    row.className = "settings-check-row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "settings-checkbox";
    input.checked = getVerificationPrefs()[key];
    input.onchange = () => setVerificationPrefs({ [key]: input.checked } as Partial<VerificationPrefs>);
    this.verificationInputs.set(key, input);

    const text = document.createElement("span");
    text.className = "settings-check-text";
    const name = document.createElement("span");
    name.className = "settings-check-name";
    name.textContent = title;
    const desc = document.createElement("span");
    desc.className = "settings-check-desc";
    desc.textContent = description;
    text.append(name, desc);

    row.append(input, text);
    return row;
  }

  private syncVerification(prefs: VerificationPrefs): void {
    for (const [key, input] of this.verificationInputs) {
      input.checked = prefs[key];
    }
  }

  private buildThemeSection(): HTMLDivElement {
    const section = document.createElement("div");
    section.className = "settings-section";

    const label = document.createElement("div");
    label.className = "settings-section-label";
    label.textContent = "Palette";

    const grid = document.createElement("div");
    grid.className = "theme-swatch-grid";

    for (const info of THEME_FAMILIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-swatch";
      btn.setAttribute("aria-pressed", "false");

      const preview = document.createElement("span");
      preview.className = `theme-preview theme-preview-${info.family}`;
      const light = document.createElement("span");
      light.className = "swatch-half swatch-light";
      const dot = document.createElement("span");
      dot.className = "swatch-accent-dot";
      const dark = document.createElement("span");
      dark.className = "swatch-half swatch-dark";
      preview.append(light, dot, dark);

      const textWrap = document.createElement("span");
      textWrap.className = "theme-swatch-text";

      const nameRow = document.createElement("span");
      nameRow.className = "theme-swatch-name";
      nameRow.textContent = info.label;
      if (info.experimental) {
        const tag = document.createElement("span");
        tag.className = "experimental-tag";
        tag.textContent = "Experimental";
        nameRow.appendChild(tag);
      }

      const desc = document.createElement("span");
      desc.className = "theme-swatch-desc";
      desc.textContent = info.description;

      textWrap.append(nameRow, desc);
      btn.append(preview, textWrap);
      btn.onclick = () => this.selectFamily(info.family);
      this.familyButtons.set(info.family, btn);
      grid.appendChild(btn);
    }

    section.append(label, grid);
    return section;
  }

  private buildModeSection(): HTMLDivElement {
    const section = document.createElement("div");
    section.className = "settings-section";

    const label = document.createElement("div");
    label.className = "settings-section-label";
    label.textContent = "Mode";

    const group = document.createElement("div");
    group.className = "mode-toggle";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Light or dark mode");

    (["light", "dark"] as ThemeMode[]).forEach((mode) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mode-btn";
      btn.textContent = mode === "light" ? "Light" : "Dark";
      btn.setAttribute("aria-pressed", "false");
      btn.onclick = () => this.selectMode(mode);
      this.modeButtons.set(mode, btn);
      group.appendChild(btn);
    });

    section.append(label, group);
    return section;
  }

  private selectFamily(family: ThemeFamily): void {
    this.pref = { ...this.pref, family };
    this.commit();
  }

  private selectMode(mode: ThemeMode): void {
    this.pref = { ...this.pref, mode };
    this.commit();
  }

  private commit(): void {
    applyThemePref(this.pref);
    saveThemePref(this.pref);
    this.syncButtons();
  }

  private syncButtons(): void {
    for (const [family, btn] of this.familyButtons) {
      const active = family === this.pref.family;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    for (const [mode, btn] of this.modeButtons) {
      const active = mode === this.pref.mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }
}
