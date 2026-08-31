import { boxDims, boxesAreChecked, type PuzzleModel } from "../model/types";
import { computeCandidates } from "./candidates";

/**
 * "What's forced here" hints (design.md section 6.3). This is the one place
 * the backtracking-adjacent solver logic is surfaced to the user, and only
 * as an explanation of a *technique* -- never a filled-in answer. For a
 * placement technique (naked/hidden single) the hint points at a cell and
 * names the technique without stating the digit, so the user still has to
 * look at the candidates themselves and conclude the value. For an
 * elimination technique (naked pair / pointing pair) naming the digit(s)
 * being eliminated doesn't hand anyone a cell's answer -- it just narrows
 * candidates the way a human solver would explain it out loud -- so those
 * messages do name the digit(s).
 *
 * Candidates are computed via the same classic row/col/box logic as the
 * auto-candidates toggle (solver/candidates.ts) -- like that feature, these
 * techniques don't yet account for variant constraints (killer cages,
 * thermos, kropki, etc.), only the classic grid rules. A hint is still
 * always logically valid against the classic rules; it just won't notice
 * eliminations a variant constraint would also allow. See design.md 6.1's
 * Phase 3 note and 6.3's toolkit wishlist -- extending candidate pruning to
 * variant constraints is separate, unstarted future work this doesn't
 * attempt to solve.
 */

export type HintTechnique = "Naked single" | "Hidden single" | "Naked pair" | "Pointing pair";

export interface Hint {
  technique: HintTechnique;
  message: string;
  /** Primary cell(s) the hint is about (a placement site, or a pair). */
  cells: Array<{ r: number; c: number }>;
  /** For elimination techniques, the cells whose candidates the digit(s) can be removed from. */
  eliminationCells?: Array<{ r: number; c: number }>;
}

interface Unit {
  label: string;
  cells: Array<{ r: number; c: number }>;
}

function buildUnits(model: PuzzleModel): Unit[] {
  const { size } = model;
  const { boxW, boxH } = boxDims(size);
  const units: Unit[] = [];

  for (let r = 0; r < size; r++) {
    units.push({ label: `Row ${r + 1}`, cells: Array.from({ length: size }, (_, c) => ({ r, c })) });
  }
  for (let c = 0; c < size; c++) {
    units.push({ label: `Column ${c + 1}`, cells: Array.from({ length: size }, (_, r) => ({ r, c })) });
  }
  if (boxesAreChecked(model)) {
    for (let boxRow = 0; boxRow < size / boxH; boxRow++) {
      for (let boxCol = 0; boxCol < size / boxW; boxCol++) {
        const cells: Array<{ r: number; c: number }> = [];
        for (let dr = 0; dr < boxH; dr++) {
          for (let dc = 0; dc < boxW; dc++) cells.push({ r: boxRow * boxH + dr, c: boxCol * boxW + dc });
        }
        units.push({ label: `Box ${boxRow * (size / boxW) + boxCol + 1}`, cells });
      }
    }
  }
  return units;
}

function isEmpty(model: PuzzleModel, r: number, c: number): boolean {
  const cell = model.grid[r]?.[c];
  return !!cell && cell.given === undefined && cell.value === undefined;
}

function findNakedSingle(model: PuzzleModel): Hint | null {
  for (let r = 0; r < model.size; r++) {
    for (let c = 0; c < model.size; c++) {
      if (!isEmpty(model, r, c)) continue;
      const cell = model.grid[r]![c]!;
      if (cell.candidates.size === 1) {
        return {
          technique: "Naked single",
          message: `R${r + 1}C${c + 1} has only one legal candidate left -- check its candidate marks.`,
          cells: [{ r, c }],
        };
      }
    }
  }
  return null;
}

function findHiddenSingle(model: PuzzleModel, units: Unit[]): Hint | null {
  for (const unit of units) {
    for (let n = 1; n <= model.size; n++) {
      const spots = unit.cells.filter(({ r, c }) => isEmpty(model, r, c) && model.grid[r]![c]!.candidates.has(n));
      if (spots.length === 1) {
        const { r, c } = spots[0]!;
        return {
          technique: "Hidden single",
          message: `${unit.label}: one candidate digit only fits in R${r + 1}C${c + 1} within this unit -- check which one.`,
          cells: [{ r, c }],
        };
      }
    }
  }
  return null;
}

function findNakedPair(model: PuzzleModel, units: Unit[]): Hint | null {
  for (const unit of units) {
    const withTwo = unit.cells.filter(
      ({ r, c }) => isEmpty(model, r, c) && model.grid[r]![c]!.candidates.size === 2,
    );
    for (let i = 0; i < withTwo.length; i++) {
      for (let j = i + 1; j < withTwo.length; j++) {
        const a = withTwo[i]!;
        const b = withTwo[j]!;
        const candA = model.grid[a.r]![a.c]!.candidates;
        const candB = model.grid[b.r]![b.c]!.candidates;
        if (candA.size !== 2 || ![...candA].every((n) => candB.has(n))) continue;
        const pairDigits = [...candA];
        const eliminationCells = unit.cells.filter(({ r, c }) => {
          if ((r === a.r && c === a.c) || (r === b.r && c === b.c)) return false;
          if (!isEmpty(model, r, c)) return false;
          const cand = model.grid[r]![c]!.candidates;
          return pairDigits.some((n) => cand.has(n));
        });
        if (eliminationCells.length === 0) continue;
        return {
          technique: "Naked pair",
          message: `${unit.label}: R${a.r + 1}C${a.c + 1} and R${b.r + 1}C${b.c + 1} can only be {${pairDigits.join(", ")}} between them, so those digits can be removed from this unit's other candidate marks.`,
          cells: [a, b],
          eliminationCells,
        };
      }
    }
  }
  return null;
}

function findPointingPair(model: PuzzleModel): Hint | null {
  const { size } = model;
  const { boxW, boxH } = boxDims(size);
  // No usable box structure: a non-square-root size, or a jigsaw layout
  // whose real regions this app can't read (PuzzleModel.irregularRegions).
  if (!boxesAreChecked(model)) return null;

  for (let boxRow = 0; boxRow < size / boxH; boxRow++) {
    for (let boxCol = 0; boxCol < size / boxW; boxCol++) {
      const boxCells: Array<{ r: number; c: number }> = [];
      for (let dr = 0; dr < boxH; dr++) {
        for (let dc = 0; dc < boxW; dc++) boxCells.push({ r: boxRow * boxH + dr, c: boxCol * boxW + dc });
      }
      for (let n = 1; n <= size; n++) {
        const spots = boxCells.filter(({ r, c }) => isEmpty(model, r, c) && model.grid[r]![c]!.candidates.has(n));
        if (spots.length < 2) continue;

        const rows = new Set(spots.map((s) => s.r));
        const cols = new Set(spots.map((s) => s.c));

        if (rows.size === 1) {
          const r = [...rows][0]!;
          const eliminationCells = Array.from({ length: size }, (_, c) => ({ r, c })).filter(
            ({ c }) => !boxCells.some((b) => b.r === r && b.c === c) && isEmpty(model, r, c) && model.grid[r]![c]!.candidates.has(n),
          );
          if (eliminationCells.length > 0) {
            return {
              technique: "Pointing pair",
              message: `Box ${boxRow * (size / boxW) + boxCol + 1}: digit ${n} only fits in Row ${r + 1} within this box, so it can be removed from digit ${n}'s candidate marks elsewhere in that row.`,
              cells: spots,
              eliminationCells,
            };
          }
        }

        if (cols.size === 1) {
          const c = [...cols][0]!;
          const eliminationCells = Array.from({ length: size }, (_, r) => ({ r, c })).filter(
            ({ r }) => !boxCells.some((b) => b.r === r && b.c === c) && isEmpty(model, r, c) && model.grid[r]![c]!.candidates.has(n),
          );
          if (eliminationCells.length > 0) {
            return {
              technique: "Pointing pair",
              message: `Box ${boxRow * (size / boxW) + boxCol + 1}: digit ${n} only fits in Column ${c + 1} within this box, so it can be removed from digit ${n}'s candidate marks elsewhere in that column.`,
              cells: spots,
              eliminationCells,
            };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Tries each technique from cheapest/most-obvious to most involved, returns
 * the first hint found (or null if none of these techniques apply to the
 * current grid state). Recomputes classic-rule candidates fresh each call
 * so the hint always reflects the live grid, independent of whether the
 * user has the auto-candidates display toggle on.
 */
export function findHint(model: PuzzleModel): Hint | null {
  computeCandidates(model);
  const units = buildUnits(model);
  return (
    findNakedSingle(model) ?? findHiddenSingle(model, units) ?? findPointingPair(model) ?? findNakedPair(model, units)
  );
}
