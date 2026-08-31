import type { PuzzleModel } from "../model/types";

/**
 * Save/resume and import history (design.md section 6.3). Both keyed off a
 * stable-ish id derived from exactly what the user pasted into the import
 * box (the URL, bare ID, or raw JSON) -- not from decoded puzzle content --
 * so re-pasting the same link resumes the same saved grid. This means two
 * different links to the same underlying puzzle (e.g. a SudokuPad link and
 * an f-puzzles link for the same variant) won't share progress; documented
 * limitation, not a bug -- there's no reliable content-identity to hash
 * instead (puzzles don't carry a canonical ID in the normalized model).
 */

const PROGRESS_PREFIX = "sudoku:progress:";
const HISTORY_KEY = "sudoku:history";
const MAX_HISTORY_ENTRIES = 20;

/** Small non-cryptographic string hash (FNV-1a, 32-bit) -- plenty for a local dedup/lookup key, no need for anything stronger. */
export function hashInput(raw: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export interface CellProgress {
  value?: number;
  pencilMarks: number[];
  highlightColor?: string;
}

export interface SavedProgress {
  puzzleId: string;
  rawInput: string;
  title?: string;
  savedAt: number;
  elapsedSeconds: number;
  cells: CellProgress[][];
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable/full -- progress just won't persist this session
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function saveProgress(
  puzzleId: string,
  rawInput: string,
  title: string | undefined,
  elapsedSeconds: number,
  model: PuzzleModel,
): void {
  const progress: SavedProgress = {
    puzzleId,
    rawInput,
    title,
    savedAt: Date.now(),
    elapsedSeconds,
    cells: model.grid.map((row) =>
      row.map((cell) => ({
        value: cell.value,
        pencilMarks: [...cell.pencilMarks],
        highlightColor: cell.highlightColor,
      })),
    ),
  };
  safeSetItem(PROGRESS_PREFIX + puzzleId, JSON.stringify(progress));
}

export function loadProgress(puzzleId: string): SavedProgress | null {
  const raw = safeGetItem(PROGRESS_PREFIX + puzzleId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedProgress;
    if (!Array.isArray(parsed?.cells)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearProgress(puzzleId: string): void {
  safeRemoveItem(PROGRESS_PREFIX + puzzleId);
}

/** Applies a saved progress snapshot onto a freshly-imported model (which starts with no user values). Skips cells the saved grid doesn't cover, e.g. if the puzzle size somehow differs. */
export function applyProgress(model: PuzzleModel, progress: SavedProgress): void {
  for (let r = 0; r < model.grid.length; r++) {
    const row = model.grid[r]!;
    const savedRow = progress.cells[r];
    if (!savedRow) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]!;
      const saved = savedRow[c];
      if (!saved || cell.given !== undefined) continue;
      cell.value = saved.value;
      cell.pencilMarks = new Set(saved.pencilMarks);
      cell.highlightColor = saved.highlightColor;
    }
  }
}

export interface HistoryEntry {
  puzzleId: string;
  rawInput: string;
  title?: string;
  lastOpened: number;
}

export function loadHistory(): HistoryEntry[] {
  const raw = safeGetItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        typeof e?.puzzleId === "string" && typeof e?.rawInput === "string" && typeof e?.lastOpened === "number",
    );
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  safeSetItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)));
}

/** Records (or bumps to the front of) the recently-opened-puzzles list. */
export function recordHistory(entry: HistoryEntry): void {
  const existing = loadHistory().filter((e) => e.puzzleId !== entry.puzzleId);
  saveHistory([entry, ...existing]);
}

export function removeHistoryEntry(puzzleId: string): void {
  saveHistory(loadHistory().filter((e) => e.puzzleId !== puzzleId));
}
