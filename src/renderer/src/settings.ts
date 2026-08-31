/**
 * Solving-behavior preferences that used to live as loose checkboxes in the
 * board toolbar ("Show auto-candidates", "Live conflict checking"). They're
 * settings, not per-move actions, so they moved into the settings modal's
 * Verification tab -- which means they have to outlive any single
 * SudokuBoard instance (a new board is constructed on every puzzle load)
 * and be observable, since the modal and the board are built independently.
 *
 * Same shape as theme.ts: load/save through localStorage, plus a tiny
 * subscribe() so an open board re-renders the moment a checkbox flips.
 */

export interface VerificationPrefs {
  /** Fill empty cells with the solver's computed candidates instead of the user's own pencil marks. */
  autoCandidates: boolean;
  /** Highlight rule conflicts as they happen, rather than only when "Check" is pressed. */
  liveChecking: boolean;
}

const STORAGE_KEY = "sudoku:verification";

const DEFAULTS: VerificationPrefs = {
  autoCandidates: false,
  liveChecking: true,
};

type Listener = (prefs: VerificationPrefs) => void;
const listeners = new Set<Listener>();

function read(): VerificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<VerificationPrefs>;
    return {
      autoCandidates: typeof parsed.autoCandidates === "boolean" ? parsed.autoCandidates : DEFAULTS.autoCandidates,
      liveChecking: typeof parsed.liveChecking === "boolean" ? parsed.liveChecking : DEFAULTS.liveChecking,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: VerificationPrefs = read();

export function getVerificationPrefs(): VerificationPrefs {
  return { ...current };
}

export function setVerificationPrefs(patch: Partial<VerificationPrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // A full/blocked localStorage shouldn't stop the setting from applying
    // to this session -- persistence is the nice-to-have here.
  }
  for (const fn of listeners) fn({ ...current });
}

/** Subscribe to preference changes. Returns an unsubscribe function. */
export function subscribeVerification(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
