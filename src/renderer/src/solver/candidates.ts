import { boxDims, type PuzzleModel } from "../model/types";

/**
 * Legal-candidate computation using classic row/col/box rules only.
 * Extending this to killer cages, kropki, thermo etc. is future work --
 * see design.md section 6.1, Phase 3. Mutates each cell's `candidates`
 * set in place; this is display-only (auto-pencil-marks), never used to
 * fill in the user's grid.
 */
export function computeCandidates(model: PuzzleModel): void {
  const { size, grid } = model;
  const { boxW, boxH } = boxDims(size);
  const all: number[] = [];
  for (let n = 1; n <= size; n++) all.push(n);

  const valueAt = (r: number, c: number): number | undefined =>
    grid[r]?.[c]?.given ?? grid[r]?.[c]?.value;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = grid[r]![c]!;
      if (valueAt(r, c) !== undefined) {
        cell.candidates = new Set();
        continue;
      }
      const used = new Set<number>();
      for (let cc = 0; cc < size; cc++) {
        const v = valueAt(r, cc);
        if (v !== undefined) used.add(v);
      }
      for (let rr = 0; rr < size; rr++) {
        const v = valueAt(rr, c);
        if (v !== undefined) used.add(v);
      }
      if (boxW < size) {
        const boxRowStart = Math.floor(r / boxH) * boxH;
        const boxColStart = Math.floor(c / boxW) * boxW;
        for (let dr = 0; dr < boxH; dr++) {
          for (let dc = 0; dc < boxW; dc++) {
            const v = valueAt(boxRowStart + dr, boxColStart + dc);
            if (v !== undefined) used.add(v);
          }
        }
      }
      cell.candidates = new Set(all.filter((n) => !used.has(n)));
    }
  }
}
