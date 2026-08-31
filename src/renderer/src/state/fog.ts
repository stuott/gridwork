import { cellRefToIndex, type FogLight, type PuzzleModel } from "../model/types";

/**
 * Fog of war.
 *
 * A fog puzzle starts almost entirely covered. Cells are uncovered
 * ("lit") two ways: the lights the puzzle itself declares
 * (`model.fog.lights`), and -- as the solver works -- a 3x3 patch around
 * every digit they have entered *correctly*. A wrong digit lights
 * nothing, which is the whole point of the variant: the fog lifting is
 * the confirmation.
 *
 * Semantics confirmed against sudocle's makeFogLights/makeFogRaster
 * (michel-kraemer/sudocle, components/hooks/useGame.tsx), which is the
 * closest thing to a written spec for what SudokuPad does:
 *
 *  - a correct entry in a NON-given cell lights a 3x3 patch centred on it;
 *  - a given lights only itself, and only once something else has already
 *    uncovered it -- i.e. givens never extend the lit area, so they are
 *    simply skipped here;
 *  - with no `solution` in the puzzle, only the declared lights apply and
 *    the rest of the board stays covered forever (the importer says so in
 *    an import note rather than letting the board look broken).
 *
 * ONE DELIBERATE DIFFERENCE from sudocle: it latches a given as
 * "discovered" once uncovered, so that cell stays visible even after the
 * digit that revealed it is erased. This app doesn't latch anything --
 * the mask is a pure function of (declared lights + current grid +
 * solution). That keeps fog consistent with undo/redo and with
 * save-and-resume for free: erasing the digit puts the fog back, exactly
 * as SudokuPad's own player does, and nothing about fog needs storing.
 *
 * TODO(fixture): every rule above comes from reading sudocle's converter,
 * not from a real fog payload -- this repo's own hard-won lesson is that
 * format research is a hypothesis until a real payload confirms it (see
 * project memory "sudoku_scl_implementation"). A real fog puzzle from
 * https://sudokupad.app/api/puzzle/<id> is still owed here, and belongs
 * in scripts/fixtures/ alongside the other two.
 */

/**
 * The board's plain-language notes for a fog puzzle. Lives here rather
 * than in either importer because both formats carry fog and the wording
 * has to match; both call it at the end of parsing, once they know
 * whether the puzzle shipped a solution.
 *
 * The first note exists because fog is the single place this app compares
 * the solver's digits against the stored solution, and a tool that
 * quietly checks your answers is worth being told about even when that's
 * exactly what the variant asks for.
 */
export function fogImportNotes(hasSolution: boolean): string[] {
  if (!hasSolution) {
    return [
      "This is a fog-of-war puzzle, but the source didn't include a solution, so there is nothing to " +
        "check your digits against and the fog can never lift. Only the cells the puzzle lights itself " +
        "are visible. Re-importing from a source that carries a solution will fix it.",
    ];
  }
  return [
    "Fog of war: covered cells stay hidden until you light them. A digit you place correctly clears the " +
      "3x3 around it; a wrong one clears nothing, and erasing a digit puts its fog back. This is the one " +
      "feature that compares your entries against the puzzle's solution — it is the variant's own rule — " +
      "and it still never shows you a digit you haven't earned.",
  ];
}

/** `mask[r][c] === true` means that cell is still covered. 0-indexed, like `model.grid`. */
export type FogMask = boolean[][];

function applyLight(mask: FogMask, light: FogLight, size: number): void {
  const { r, c } = cellRefToIndex(light.cell);
  if (r < 0 || c < 0 || r >= size || c >= size) return;
  if (light.size === 1) {
    mask[r]![c] = false;
    return;
  }
  // size 3: the 3x3 block centred on the cell, clipped at the grid edge.
  // (sudocle's own raster relies on JS tolerating a write to index -1;
  // clipping explicitly is the same result without the trap.)
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      mask[rr]![cc] = false;
    }
  }
}

/**
 * The current fog cover, or null when this isn't a fog puzzle (in which
 * case every other function here is a no-op and no fog code runs).
 */
export function computeFogMask(model: PuzzleModel): FogMask | null {
  if (!model.fog) return null;
  const { size, grid, solution } = model;
  const mask: FogMask = Array.from({ length: size }, () => Array<boolean>(size).fill(true));

  for (const light of model.fog.lights) applyLight(mask, light, size);

  if (solution) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = grid[r]![c]!;
        // Givens are skipped on purpose -- see the file comment. Only a
        // digit the solver placed themselves, and placed correctly, lights
        // new ground.
        if (cell.given !== undefined) continue;
        if (cell.value === undefined) continue;
        if (cell.value !== solution[r]?.[c]) continue;
        applyLight(mask, { cell: { row: r + 1, col: c + 1 }, size: 3 }, size);
      }
    }
  }

  return mask;
}

export function isFogged(mask: FogMask | null, r: number, c: number): boolean {
  return mask?.[r]?.[c] === true;
}

export function foggedCount(mask: FogMask | null): number {
  if (!mask) return 0;
  let n = 0;
  for (const row of mask) for (const covered of row) if (covered) n++;
  return n;
}

/**
 * The puzzle as the solver can actually see it: a copy whose fogged cells
 * hold no digit at all.
 *
 * Every solving aid runs against this rather than the real grid, so
 * nothing under the fog can leak back out -- no conflict flagged against
 * a hidden given, no auto-candidate eliminated by a digit the solver
 * hasn't uncovered, no hint that quietly depends on one. Anything else
 * would hand over information the fog exists to withhold.
 *
 * Returns the model itself (not a copy) for non-fog puzzles, so the
 * overwhelmingly common path allocates nothing and behaves exactly as it
 * did before fog existed. On a fog puzzle EVERY cell is copied, fogged or
 * not, because callers like findHint/computeCandidates write candidate
 * sets back into the cells they're given and must not touch the real grid.
 */
export function revealedModel(model: PuzzleModel, mask: FogMask | null): PuzzleModel {
  if (!mask) return model;
  return {
    ...model,
    grid: model.grid.map((row, r) =>
      row.map((cell, c) =>
        mask[r]?.[c]
          ? { ...cell, given: undefined, value: undefined }
          : { ...cell },
      ),
    ),
  };
}
