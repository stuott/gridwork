export type ThemeFamily = "cool" | "warm" | "nebula";
export type ThemeMode = "light" | "dark";

export interface ThemeFamilyInfo {
  family: ThemeFamily;
  label: string;
  description: string;
  experimental?: boolean;
}

/**
 * The theme catalog shown in the settings modal. Each family has a light
 * and a dark variant (see style.css `[data-theme="<family>-<mode>"]`
 * blocks) -- six combinations total. "nebula" is the experimental one:
 * a violet/cyan palette with a soft animated background and glow accents.
 */
export const THEME_FAMILIES: ThemeFamilyInfo[] = [
  { family: "cool", label: "Cool", description: "Calm blues and slate." },
  { family: "warm", label: "Warm", description: "Amber, terracotta, warm neutrals." },
  {
    family: "nebula",
    label: "Nebula",
    description: "Violet and cyan, with a soft glow.",
    experimental: true,
  },
];

export interface ThemePref {
  family: ThemeFamily;
  mode: ThemeMode;
}

const STORAGE_KEY = "sudoku:theme";
const DEFAULT_FAMILY: ThemeFamily = "cool";

function isFamily(v: unknown): v is ThemeFamily {
  return v === "cool" || v === "warm" || v === "nebula";
}

function isMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark";
}

function systemMode(): ThemeMode {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function loadThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isFamily(parsed?.family) && isMode(parsed?.mode)) {
        return { family: parsed.family, mode: parsed.mode };
      }
    }
  } catch {
    // corrupt or unavailable storage -- fall through to the default
  }
  return { family: DEFAULT_FAMILY, mode: systemMode() };
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // storage unavailable (e.g. disabled) -- theme still applies this session
  }
}

export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", `${pref.family}-${pref.mode}`);
  root.setAttribute("data-theme-family", pref.family);
  root.setAttribute("data-theme-mode", pref.mode);
}
