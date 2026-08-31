import type { PuzzleModel } from "../model/types";

/**
 * Undo/redo for the solving-assist toolkit (design.md section 6.3). Snapshot
 * based rather than a command pattern: grids here are small (81 cells for a
 * standard puzzle, rarely much more for a variant board), so cloning the
 * per-cell solving state (value, pencil marks, highlight color -- never the
 * `given` clues, which are immutable) on every recorded action is cheap and
 * much simpler than modeling every edit as an invertible command. Includes
 * pencil-mark edits and highlight-color edits, not just digit entry, per the
 * wishlist's "including for pencil-mark edits."
 */
export interface CellSnapshot {
  value?: number;
  pencilMarks: number[];
  highlightColor?: string;
}

export type GridSnapshot = CellSnapshot[][];

const MAX_HISTORY = 500;

export class HistoryManager {
  private model: PuzzleModel;
  private undoStack: GridSnapshot[] = [];
  private redoStack: GridSnapshot[] = [];

  constructor(model: PuzzleModel) {
    this.model = model;
  }

  private snapshot(): GridSnapshot {
    return this.model.grid.map((row) =>
      row.map((cell) => ({
        value: cell.value,
        pencilMarks: [...cell.pencilMarks],
        highlightColor: cell.highlightColor,
      })),
    );
  }

  private restore(snap: GridSnapshot): void {
    for (let r = 0; r < this.model.grid.length; r++) {
      const row = this.model.grid[r]!;
      const snapRow = snap[r];
      if (!snapRow) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]!;
        const s = snapRow[c];
        if (!s) continue;
        cell.value = s.value;
        cell.pencilMarks = new Set(s.pencilMarks);
        cell.highlightColor = s.highlightColor;
      }
    }
  }

  /**
   * Call BEFORE mutating the model for a user-initiated edit. Pushes the
   * current (pre-edit) state onto the undo stack and clears any pending
   * redo, same as any standard editor's undo model.
   */
  record(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    return true;
  }

}
