/**
 * The board's multi-cell selection, kept out of render/board.ts so the rules
 * for growing/shrinking a selection can be tested headlessly (see
 * scripts/smoke-test-selection.ts) -- board.ts owns pointer/keyboard plumbing
 * and rendering, this owns "which cells are selected".
 *
 * Cells are stored as "r,c" keys in a Set. Alongside them sits the *anchor*:
 * the cell arrow-key navigation moves from and that Shift+click rectangles are
 * measured against. It is always the most recently touched cell, and it is
 * null exactly when nothing is selected.
 */
export interface SelectedCell {
  r: number;
  c: number;
}

const key = (r: number, c: number) => `${r},${c}`;

export class CellSelection {
  private keys = new Set<string>();
  private anchorCell: SelectedCell | null = null;

  get size(): number {
    return this.keys.size;
  }

  get anchor(): SelectedCell | null {
    return this.anchorCell;
  }

  has(r: number, c: number): boolean {
    return this.keys.has(key(r, c));
  }

  cells(): SelectedCell[] {
    return [...this.keys].map((k) => {
      const [r, c] = k.split(",");
      return { r: Number(r), c: Number(c) };
    });
  }

  /** The one selected cell, or null when zero or several are selected. */
  sole(): SelectedCell | null {
    return this.keys.size === 1 ? this.cells()[0]! : null;
  }

  /** Replaces the whole selection with a single cell (a plain click, or a bare arrow key). */
  selectOnly(r: number, c: number) {
    this.keys = new Set([key(r, c)]);
    this.anchorCell = { r, c };
  }

  add(r: number, c: number) {
    this.keys.add(key(r, c));
    this.anchorCell = { r, c };
  }

  delete(r: number, c: number) {
    this.keys.delete(key(r, c));
    // The anchor deliberately stays put: it is where the *next* Shift+click or
    // arrow key measures from, and removing a cell shouldn't move that origin
    // somewhere the user never pointed at.
  }

  /** Ctrl/Cmd+click: flips one cell, reporting which way it went so a drag can keep doing the same thing. */
  toggle(r: number, c: number): "added" | "removed" {
    if (this.has(r, c)) {
      this.delete(r, c);
      this.anchorCell = { r, c };
      return "removed";
    }
    this.add(r, c);
    return "added";
  }

  /**
   * Shift+click: adds the rectangle spanned by the anchor and (r, c). Adds
   * rather than replaces, so several shift-clicks build up a shape. With
   * nothing selected yet there is no anchor to measure from, so this falls
   * back to selecting the clicked cell alone.
   */
  addRange(r: number, c: number) {
    const from = this.anchorCell;
    if (!from) {
      this.selectOnly(r, c);
      return;
    }
    for (let rr = Math.min(from.r, r); rr <= Math.max(from.r, r); rr++) {
      for (let cc = Math.min(from.c, c); cc <= Math.max(from.c, c); cc++) {
        this.keys.add(key(rr, cc));
      }
    }
    this.anchorCell = { r, c };
  }

  selectAll(size: number) {
    this.keys = new Set<string>();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) this.keys.add(key(r, c));
    }
    this.anchorCell ??= { r: 0, c: 0 };
  }

  clear() {
    this.keys.clear();
    this.anchorCell = null;
  }
}
