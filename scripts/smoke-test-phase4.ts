// Regression check for the Phase 4 solving-assist toolkit's pure-logic
// pieces: solver/hints.ts (technique detection) and state/history.ts
// (undo/redo). state/persistence.ts needs `localStorage`, which doesn't
// exist under plain Node/tsx -- a tiny in-memory stub is installed below so
// hashInput/save/load/history can be exercised the same way the smoke-test
// scripts for the importer and validator already stub out what the DOM
// would otherwise provide.
// Run with: npm run test:phase4

import { createEmptyGrid, type Constraint, type PuzzleModel } from "../src/renderer/src/model/types";
import { findHint } from "../src/renderer/src/solver/hints";
import { HistoryManager } from "../src/renderer/src/state/history";

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
}

function model(size: number, constraints: Constraint[] = []): PuzzleModel {
  return { size, grid: createEmptyGrid(size), constraints, globalRules: {} };
}

// --- hints: naked single ---
{
  // 4x4, row 0 fully determined except one cell forced to the last digit.
  const m = model(4);
  m.grid[0][0]!.value = 1;
  m.grid[0][1]!.value = 2;
  m.grid[0][2]!.value = 3;
  // grid[0][3] has no other row/col/box constraint filled -- give it peers
  // via column so only one candidate remains (4).
  m.grid[1][3]!.value = 1;
  m.grid[2][3]!.value = 2;
  m.grid[3][3]!.value = 3;
  const hint = findHint(m);
  check("naked single found", hint?.technique === "Naked single");
  check("naked single points at the forced cell", !!hint && hint.cells.some((c) => c.r === 0 && c.c === 3));
  // Note: can't just check the message doesn't contain "4" -- cell refs like "C3"/"R1C4" legitimately
  // contain digits. What matters is hints.ts never interpolates the *candidate value* into the string,
  // which is a property of the source (see solver/hints.ts's findNakedSingle/findHiddenSingle), not
  // something a substring check here can prove either way -- skip a redundant, fragile assertion.
}

// --- hints: hidden single ---
{
  // 4x4 box 0 (top-left 2x2): digit 4 can only go in one cell of the box
  // once other cells in that box's row/col are excluded by placed digits
  // elsewhere, even though more than one cell in the box is still empty.
  const m = model(4);
  // Fill row 0 and row 1 elsewhere so digit 4 is only a row-candidate at (0,0)... 
  // Simpler construction: box 0 = (0,0)(0,1)(1,0)(1,1). Place 4 in row 1's
  // other box (so row1 already has a 4 outside the box, ruling out (1,0)/(1,1)),
  // and place 4 in column 1 elsewhere (ruling out (0,1)), leaving only (0,0).
  m.grid[1][2]!.value = 4; // row 1, box 1 -- removes 4 from (1,0) and (1,1)
  m.grid[3][1]!.value = 4; // column 1, box 2 -- removes 4 from (0,1)
  const hint = findHint(m);
  check("hidden single found", hint?.technique === "Hidden single");
  check("hidden single points at (0,0)", !!hint && hint.cells.some((c) => c.r === 0 && c.c === 0));
}

// --- hints: none found on an empty grid (too many candidates everywhere) ---
{
  const m = model(9);
  const hint = findHint(m);
  check("no hint on a fully empty 9x9 grid", hint === null);
}

// --- history: undo/redo round-trips value + pencil marks + highlight ---
{
  const m = model(4);
  const history = new HistoryManager(m);

  history.record();
  m.grid[0][0]!.value = 2;

  history.record();
  m.grid[0][0]!.pencilMarks.add(3);
  m.grid[0][0]!.pencilMarks.add(4);

  history.record();
  m.grid[0][0]!.highlightColor = "blue";

  check("canUndo true after edits", history.canUndo());
  check("canRedo false before any undo", !history.canRedo());

  history.undo();
  check("undo removes highlight, keeps pencil marks", m.grid[0][0]!.highlightColor === undefined && m.grid[0][0]!.pencilMarks.size === 2);

  history.undo();
  check("second undo removes pencil marks, keeps value", m.grid[0][0]!.pencilMarks.size === 0 && m.grid[0][0]!.value === 2);

  history.undo();
  check("third undo removes value entirely", m.grid[0][0]!.value === undefined);
  check("canUndo false once the stack is exhausted", !history.canUndo());

  history.redo();
  check("redo restores the value", m.grid[0][0]!.value === 2);

  history.redo();
  history.redo();
  check("redoing back to the end restores the highlight", m.grid[0][0]!.highlightColor === "blue");
  check("canRedo false once fully redone", !history.canRedo());

  history.undo();
  history.record(); // a fresh edit after undoing should drop the old redo branch
  check("a new record() after undo clears the stale redo stack", !history.canRedo());
}

// --- persistence: hashInput + save/load round trip (needs a localStorage stub) ---
{
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  const { hashInput, saveProgress, loadProgress, applyProgress, clearProgress, recordHistory, loadHistory, removeHistoryEntry } =
    await import("../src/renderer/src/state/persistence");

  const idA = hashInput("https://sudokupad.app/abc123");
  const idB = hashInput("https://sudokupad.app/xyz789");
  check("hashInput is deterministic", hashInput("https://sudokupad.app/abc123") === idA);
  check("hashInput differs for different input", idA !== idB);

  const m = model(4);
  m.grid[0][0]!.value = 3;
  m.grid[1][1]!.pencilMarks.add(2);
  saveProgress(idA, "https://sudokupad.app/abc123", "Test Puzzle", 42, m);

  const loaded = loadProgress(idA);
  check("saved progress round-trips", loaded?.elapsedSeconds === 42 && loaded?.title === "Test Puzzle");
  check("no progress under an unrelated id", loadProgress(idB) === null);

  const fresh = model(4);
  if (loaded) applyProgress(fresh, loaded);
  check("applyProgress restores the value", fresh.grid[0][0]!.value === 3);
  check("applyProgress restores pencil marks", fresh.grid[1][1]!.pencilMarks.has(2));

  clearProgress(idA);
  check("clearProgress removes it", loadProgress(idA) === null);

  recordHistory({ puzzleId: idA, rawInput: "a", title: "A", lastOpened: 1 });
  recordHistory({ puzzleId: idB, rawInput: "b", title: "B", lastOpened: 2 });
  recordHistory({ puzzleId: idA, rawInput: "a", title: "A (re-opened)", lastOpened: 3 });
  const hist = loadHistory();
  check("re-opening a puzzle bumps it to the front, not duplicated", hist.length === 2 && hist[0]!.puzzleId === idA);
  check("re-opening updates the stored title", hist[0]!.title === "A (re-opened)");

  removeHistoryEntry(idB);
  check("removeHistoryEntry drops just that entry", loadHistory().length === 1 && loadHistory()[0]!.puzzleId === idA);
}

if (failed) {
  console.error("\nSome phase4 checks FAILED.");
  process.exit(1);
} else {
  console.log("\nAll phase4 checks passed.");
}
