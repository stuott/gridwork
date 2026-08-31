import { boxDims, cellRefToIndex, type CellRef, type PuzzleModel } from "../model/types";

export interface Conflict {
  reason: string;
  cells: Array<{ r: number; c: number }>;
}

/**
 * Finds every rule violation in the current grid state. Covers classic
 * row/col/box duplicates; the global whole-grid rules (antiknight, antiking,
 * disjoint groups, both diagonals, nonconsecutive); and every per-constraint
 * type the renderer draws: killer cages, thermometers, arrows, kropki dots,
 * odd/even cells, renban/whisper/palindrome lines, between lines, little
 * killer sums, XV, sandwich sums, extra regions, clones, quadruples, and
 * min/max cells. This is design.md section 6.1's Phase 3 (common variants)
 * plus Phase 5 (remaining variant coverage) -- every constraint type the
 * importer parses is now also validated.
 */
export function findConflicts(model: PuzzleModel): Conflict[] {
  const { size, grid } = model;
  const { boxW, boxH } = boxDims(size);
  const conflicts: Conflict[] = [];

  const valueAt = (r: number, c: number): number | undefined =>
    grid[r]?.[c]?.given ?? grid[r]?.[c]?.value;
  const valueAtRef = (ref: CellRef): number | undefined => {
    const { r, c } = cellRefToIndex(ref);
    return valueAt(r, c);
  };
  const sameCell = (a: CellRef, b: CellRef) => a.row === b.row && a.col === b.col;

  for (let r = 0; r < size; r++) {
    const seen = new Map<number, number[]>();
    for (let c = 0; c < size; c++) {
      const v = valueAt(r, c);
      if (v === undefined) continue;
      seen.set(v, [...(seen.get(v) ?? []), c]);
    }
    for (const [v, cols] of seen) {
      if (cols.length > 1) {
        conflicts.push({ reason: `Row ${r + 1}: ${v} repeated`, cells: cols.map((c) => ({ r, c })) });
      }
    }
  }

  for (let c = 0; c < size; c++) {
    const seen = new Map<number, number[]>();
    for (let r = 0; r < size; r++) {
      const v = valueAt(r, c);
      if (v === undefined) continue;
      seen.set(v, [...(seen.get(v) ?? []), r]);
    }
    for (const [v, rows] of seen) {
      if (rows.length > 1) {
        conflicts.push({ reason: `Column ${c + 1}: ${v} repeated`, cells: rows.map((r) => ({ r, c })) });
      }
    }
  }

  if (boxW < size) {
    for (let boxRow = 0; boxRow < size / boxH; boxRow++) {
      for (let boxCol = 0; boxCol < size / boxW; boxCol++) {
        const seen = new Map<number, Array<{ r: number; c: number }>>();
        for (let dr = 0; dr < boxH; dr++) {
          for (let dc = 0; dc < boxW; dc++) {
            const r = boxRow * boxH + dr;
            const c = boxCol * boxW + dc;
            const v = valueAt(r, c);
            if (v === undefined) continue;
            seen.set(v, [...(seen.get(v) ?? []), { r, c }]);
          }
        }
        for (const [v, cells] of seen) {
          if (cells.length > 1) conflicts.push({ reason: `Box: ${v} repeated`, cells });
        }
      }
    }
  }

  // --- global whole-grid rules (design.md Phase 5) ---
  const { antiKnight, antiKing, disjointGroups, diagonalPositive, diagonalNegative, nonConsecutive } = model.globalRules;

  if (antiKnight) {
    const deltas: Array<[number, number]> = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = valueAt(r, c);
        if (v === undefined) continue;
        for (const [dr, dc] of deltas) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < r || (nr === r && nc <= c)) continue; // count each pair once
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          if (valueAt(nr, nc) === v) {
            conflicts.push({ reason: `Anti-knight: ${v} a knight's move apart`, cells: [{ r, c }, { r: nr, c: nc }] });
          }
        }
      }
    }
  }

  if (antiKing) {
    const deltas: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = valueAt(r, c);
        if (v === undefined) continue;
        for (const [dr, dc] of deltas) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < r || (nr === r && nc <= c)) continue;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          if (valueAt(nr, nc) === v) {
            conflicts.push({ reason: `Anti-king: ${v} a king's move apart`, cells: [{ r, c }, { r: nr, c: nc }] });
          }
        }
      }
    }
  }

  if (disjointGroups && boxW < size) {
    for (let pr = 0; pr < boxH; pr++) {
      for (let pc = 0; pc < boxW; pc++) {
        const seen = new Map<number, Array<{ r: number; c: number }>>();
        for (let boxRow = 0; boxRow < size / boxH; boxRow++) {
          for (let boxCol = 0; boxCol < size / boxW; boxCol++) {
            const r = boxRow * boxH + pr;
            const c = boxCol * boxW + pc;
            const v = valueAt(r, c);
            if (v === undefined) continue;
            seen.set(v, [...(seen.get(v) ?? []), { r, c }]);
          }
        }
        for (const [v, cells] of seen) {
          if (cells.length > 1) conflicts.push({ reason: `Disjoint group: ${v} repeated`, cells });
        }
      }
    }
  }

  if (diagonalPositive) {
    const seen = new Map<number, Array<{ r: number; c: number }>>();
    for (let r = 0; r < size; r++) {
      const c = size - 1 - r;
      const v = valueAt(r, c);
      if (v === undefined) continue;
      seen.set(v, [...(seen.get(v) ?? []), { r, c }]);
    }
    for (const [v, cells] of seen) {
      if (cells.length > 1) conflicts.push({ reason: `Diagonal: ${v} repeated`, cells });
    }
  }

  if (diagonalNegative) {
    const seen = new Map<number, Array<{ r: number; c: number }>>();
    for (let r = 0; r < size; r++) {
      const v = valueAt(r, r);
      if (v === undefined) continue;
      seen.set(v, [...(seen.get(v) ?? []), { r, c: r }]);
    }
    for (const [v, cells] of seen) {
      if (cells.length > 1) conflicts.push({ reason: `Diagonal: ${v} repeated`, cells });
    }
  }

  if (nonConsecutive) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = valueAt(r, c);
        if (v === undefined) continue;
        for (const [dr, dc] of [[0, 1], [1, 0]] as Array<[number, number]>) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= size || nc >= size) continue;
          const nv = valueAt(nr, nc);
          if (nv === undefined) continue;
          if (Math.abs(v - nv) === 1) {
            conflicts.push({ reason: `Non-consecutive: ${v} and ${nv} are adjacent`, cells: [{ r, c }, { r: nr, c: nc }] });
          }
        }
      }
    }
  }

  for (const constraint of model.constraints) {
    if (constraint.type === "cage") {
      const cellsIdx = constraint.cells.map(cellRefToIndex);
      const seen = new Map<number, Array<{ r: number; c: number }>>();
      let filledCount = 0;
      let total = 0;
      for (const { r, c } of cellsIdx) {
        const v = valueAt(r, c);
        if (v === undefined) continue;
        filledCount++;
        total += v;
        seen.set(v, [...(seen.get(v) ?? []), { r, c }]);
      }
      for (const [v, cells] of seen) {
        if (cells.length > 1) conflicts.push({ reason: `Cage: ${v} repeated`, cells });
      }
      if (constraint.sum !== undefined && filledCount === cellsIdx.length && total !== constraint.sum) {
        conflicts.push({ reason: `Cage sums to ${total}, expected ${constraint.sum}`, cells: cellsIdx });
      }
      continue;
    }

    if (constraint.type === "thermo") {
      // Digits increase from the bulb (index 0) to the tip -- strictly on an
      // ordinary thermometer, or merely never decreasing on a "slow" one,
      // where repeats are legal (see ThermoConstraint.slow).
      for (let i = 0; i < constraint.cells.length - 1; i++) {
        const a = constraint.cells[i]!;
        const b = constraint.cells[i + 1]!;
        const va = valueAtRef(a);
        const vb = valueAtRef(b);
        if (va === undefined || vb === undefined) continue;
        const violated = constraint.slow ? va > vb : va >= vb;
        if (violated) {
          conflicts.push({
            reason: constraint.slow
              ? `Slow thermometer: values must never decrease from bulb to tip`
              : `Thermometer: values must strictly increase from bulb to tip`,
            cells: [cellRefToIndex(a), cellRefToIndex(b)],
          });
        }
      }
      continue;
    }

    if (constraint.type === "arrow") {
      // arrowCells' path starts at the circle cell(s) (design.md 7.2), so
      // the shaft is whatever's left once the circle cells are excluded.
      const shaftCells = constraint.arrowCells.filter(
        (cell) => !constraint.circleCells.some((circle) => sameCell(circle, cell)),
      );
      const circleValues = constraint.circleCells.map(valueAtRef);
      const shaftValues = shaftCells.map(valueAtRef);
      if (circleValues.every((v) => v !== undefined) && shaftValues.every((v) => v !== undefined)) {
        const target =
          constraint.circleCells.length === 1
            ? circleValues[0]!
            : Number(circleValues.join(""));
        const sum = shaftValues.reduce((acc, v) => acc + v!, 0);
        if (sum !== target) {
          conflicts.push({
            reason: `Arrow sums to ${sum}, expected ${target}`,
            cells: [...constraint.circleCells, ...shaftCells].map(cellRefToIndex),
          });
        }
      }
      continue;
    }

    if (constraint.type === "kropki") {
      const [a, b] = constraint.cells;
      const va = valueAtRef(a);
      const vb = valueAtRef(b);
      if (va === undefined || vb === undefined) continue;
      const isValid =
        constraint.kind === "ratio"
          ? va === vb * constraint.value || vb === va * constraint.value
          : Math.abs(va - vb) === constraint.value;
      if (!isValid) {
        conflicts.push({
          reason:
            constraint.kind === "ratio"
              ? `Kropki dot: values must have a ${constraint.value}:1 ratio`
              : `Kropki dot: values must differ by ${constraint.value}`,
          cells: [cellRefToIndex(a), cellRefToIndex(b)],
        });
      }
      continue;
    }

    if (constraint.type === "oddEven") {
      const v = valueAtRef(constraint.cell);
      if (v === undefined) continue;
      const isOdd = v % 2 === 1;
      if ((constraint.kind === "odd") !== isOdd) {
        conflicts.push({
          reason: constraint.kind === "odd" ? `Must be odd` : `Must be even`,
          cells: [cellRefToIndex(constraint.cell)],
        });
      }
      continue;
    }

    if (constraint.type === "line") {
      const { kind, cells, minDifference } = constraint;
      if (kind === "renban") {
        const idx = cells.map(cellRefToIndex);
        const seen = new Map<number, Array<{ r: number; c: number }>>();
        const filled: Array<{ v: number; cell: { r: number; c: number } }> = [];
        for (const cell of idx) {
          const v = valueAt(cell.r, cell.c);
          if (v === undefined) continue;
          seen.set(v, [...(seen.get(v) ?? []), cell]);
          filled.push({ v, cell });
        }
        let hasDup = false;
        for (const [v, dupCells] of seen) {
          if (dupCells.length > 1) {
            hasDup = true;
            conflicts.push({ reason: `Renban: ${v} repeated`, cells: dupCells });
          }
        }
        if (!hasDup && filled.length === idx.length && idx.length > 0) {
          const values = filled.map((f) => f.v);
          const range = Math.max(...values) - Math.min(...values);
          if (range !== idx.length - 1) {
            conflicts.push({ reason: `Renban: values must form a consecutive run`, cells: idx });
          }
        }
        continue;
      }
      if (kind === "whisper") {
        const diff = minDifference ?? 5;
        for (let i = 0; i < cells.length - 1; i++) {
          const a = cells[i]!;
          const b = cells[i + 1]!;
          const va = valueAtRef(a);
          const vb = valueAtRef(b);
          if (va === undefined || vb === undefined) continue;
          if (Math.abs(va - vb) < diff) {
            conflicts.push({
              reason: `Whisper line: adjacent values must differ by at least ${diff}`,
              cells: [cellRefToIndex(a), cellRefToIndex(b)],
            });
          }
        }
        continue;
      }
      if (kind === "palindrome") {
        const n = cells.length;
        for (let i = 0; i < Math.floor(n / 2); i++) {
          const a = cells[i]!;
          const b = cells[n - 1 - i]!;
          const va = valueAtRef(a);
          const vb = valueAtRef(b);
          if (va === undefined || vb === undefined) continue;
          if (va !== vb) {
            conflicts.push({
              reason: `Palindrome: mirrored cells must match`,
              cells: [cellRefToIndex(a), cellRefToIndex(b)],
            });
          }
        }
        continue;
      }
      continue;
    }

    if (constraint.type === "betweenLine") {
      const { cells } = constraint;
      const a = cells[0]!;
      const b = cells[cells.length - 1]!;
      const va = valueAtRef(a);
      const vb = valueAtRef(b);
      if (va === undefined || vb === undefined) continue;
      const lo = Math.min(va, vb);
      const hi = Math.max(va, vb);
      for (let i = 1; i < cells.length - 1; i++) {
        const inner = cells[i]!;
        const v = valueAtRef(inner);
        if (v === undefined) continue;
        if (v <= lo || v >= hi) {
          conflicts.push({
            reason: `Between line: interior values must fall strictly between the two ends`,
            cells: [cellRefToIndex(a), cellRefToIndex(inner), cellRefToIndex(b)],
          });
        }
      }
      continue;
    }

    if (constraint.type === "littleKiller") {
      const values = constraint.cells.map(valueAtRef);
      if (values.every((v) => v !== undefined)) {
        const total = values.reduce((acc, v) => acc + v!, 0);
        if (total !== constraint.sum) {
          conflicts.push({
            reason: `Little killer sums to ${total}, expected ${constraint.sum}`,
            cells: constraint.cells.map(cellRefToIndex),
          });
        }
      }
      continue;
    }

    if (constraint.type === "xv") {
      const [a, b] = constraint.cells;
      const va = valueAtRef(a);
      const vb = valueAtRef(b);
      if (va === undefined || vb === undefined) continue;
      const target = constraint.kind === "X" ? 10 : 5;
      if (va + vb !== target) {
        conflicts.push({
          reason: `${constraint.kind}: values must sum to ${target}`,
          cells: [cellRefToIndex(a), cellRefToIndex(b)],
        });
      }
      continue;
    }

    if (constraint.type === "sandwich") {
      const values = constraint.cells.map(valueAtRef);
      const idx1 = values.findIndex((v) => v === 1);
      const idxN = values.findIndex((v) => v === model.size);
      if (idx1 === -1 || idxN === -1) continue;
      const lo = Math.min(idx1, idxN);
      const hi = Math.max(idx1, idxN);
      const between = constraint.cells.slice(lo + 1, hi);
      const betweenValues = between.map(valueAtRef);
      if (betweenValues.every((v) => v !== undefined)) {
        const total = betweenValues.reduce((acc, v) => acc + v!, 0);
        if (total !== constraint.sum) {
          conflicts.push({
            reason: `Sandwich sums to ${total}, expected ${constraint.sum}`,
            cells: between.map(cellRefToIndex),
          });
        }
      }
      continue;
    }

    if (constraint.type === "extraRegion") {
      const idx = constraint.cells.map(cellRefToIndex);
      const seen = new Map<number, Array<{ r: number; c: number }>>();
      for (const { r, c } of idx) {
        const v = valueAt(r, c);
        if (v === undefined) continue;
        seen.set(v, [...(seen.get(v) ?? []), { r, c }]);
      }
      for (const [v, cells] of seen) {
        if (cells.length > 1) conflicts.push({ reason: `Extra region: ${v} repeated`, cells });
      }
      continue;
    }

    if (constraint.type === "clone") {
      for (const [a, b] of constraint.pairs) {
        const va = valueAtRef(a);
        const vb = valueAtRef(b);
        if (va === undefined || vb === undefined) continue;
        if (va !== vb) {
          conflicts.push({
            reason: `Clone: paired cells must match`,
            cells: [cellRefToIndex(a), cellRefToIndex(b)],
          });
        }
      }
      continue;
    }

    if (constraint.type === "quadruple") {
      const idx = constraint.cells.map(cellRefToIndex);
      const values = idx.map(({ r, c }) => valueAt(r, c));
      if (values.every((v) => v !== undefined) && constraint.values.length > 0) {
        const have = new Map<number, number>();
        for (const v of values as number[]) have.set(v, (have.get(v) ?? 0) + 1);
        const need = new Map<number, number>();
        for (const v of constraint.values) need.set(v, (need.get(v) ?? 0) + 1);
        let ok = true;
        for (const [v, count] of need) {
          if ((have.get(v) ?? 0) < count) ok = false;
        }
        if (!ok) {
          conflicts.push({
            reason: `Quadruple: must include ${constraint.values.join(", ")}`,
            cells: idx,
          });
        }
      }
      continue;
    }

    if (constraint.type === "minMax") {
      const { r, c } = cellRefToIndex(constraint.cell);
      const v = valueAt(r, c);
      if (v === undefined) continue;
      const neighbors: Array<[number, number]> = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const nv = valueAt(nr, nc);
        if (nv === undefined) continue;
        const violated = constraint.kind === "min" ? nv <= v : nv >= v;
        if (violated) {
          conflicts.push({
            reason: constraint.kind === "min" ? `Must be less than every neighbor` : `Must be greater than every neighbor`,
            cells: [{ r, c }, { r: nr, c: nc }],
          });
        }
      }
      continue;
    }
  }

  return conflicts;
}

export function conflictCellKeySet(conflicts: Conflict[]): Set<string> {
  const set = new Set<string>();
  for (const conflict of conflicts) {
    for (const { r, c } of conflict.cells) set.add(`${r},${c}`);
  }
  return set;
}
