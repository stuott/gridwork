// Checks for fog of war: the mask computation in state/fog.ts, the revealed
// view every solving aid runs against, and the fog parsing in both
// importers.
//
// Fog is the one feature that reads `solution` for something other than win
// detection, so these checks pin down exactly how much it is allowed to
// give away: a correct digit lights its 3x3, a wrong one lights nothing, a
// given lights nothing, and nothing under the fog can reach a conflict, a
// candidate or a hint.
//
// NOTE: the format side of this (which keys carry fog, and what the two
// light sizes mean) comes from sudocle's converters, not yet from a real
// fog payload -- see state/fog.ts's TODO. These checks lock in the
// behaviour so a real fixture can confirm or correct it in one place.
//
// Run with: npm run test:fog

import { computeFogMask, foggedCount, isFogged, revealedModel, fogImportNotes } from "../src/renderer/src/state/fog";
import { findConflicts } from "../src/renderer/src/solver/validate";
import { parseFPuzzles } from "../src/renderer/src/importer/formats/fpuzzles";
import { parseScl } from "../src/renderer/src/importer/formats/scl";
import { createEmptyGrid, type FogLight, type PuzzleModel } from "../src/renderer/src/model/types";

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
}

/** A 4x4 model whose solution is a valid Latin square, so "correct digit" cases are real. */
const SOLUTION_4 = [
  [1, 2, 3, 4],
  [3, 4, 1, 2],
  [2, 1, 4, 3],
  [4, 3, 2, 1],
];

function model(lights: FogLight[] | undefined, withSolution = true): PuzzleModel {
  return {
    size: 4,
    grid: createEmptyGrid(4),
    constraints: [],
    globalRules: {},
    solution: withSolution ? SOLUTION_4.map((row) => [...row]) : undefined,
    fog: lights ? { lights } : undefined,
  };
}

/** The set of uncovered cells, as "r,c" strings, for readable assertions. */
function litCells(m: PuzzleModel): Set<string> {
  const mask = computeFogMask(m);
  const out = new Set<string>();
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) if (!isFogged(mask, r, c)) out.add(`${r},${c}`);
  }
  return out;
}

// --- not a fog puzzle: nothing happens at all ---
{
  const m = model(undefined);
  check("no fog declared: mask is null", computeFogMask(m) === null);
  check("no fog declared: revealedModel hands back the same object", revealedModel(m, null) === m);
  check("no fog declared: foggedCount is 0", foggedCount(null) === 0);
}

// --- declared lights ---
{
  const m = model([{ cell: { row: 1, col: 1 }, size: 3 }]);
  const lit = litCells(m);
  check("size-3 light clears the 3x3 around it", ["0,0", "0,1", "1,0", "1,1"].every((k) => lit.has(k)));
  check("size-3 light is clipped at the grid edge, not wrapped", lit.size === 4);
  check("everything else stays covered", foggedCount(computeFogMask(m)) === 12);
}
{
  const m = model([{ cell: { row: 2, col: 2 }, size: 1 }]);
  check("size-1 light clears exactly one cell", litCells(m).size === 1 && litCells(m).has("1,1"));
}
{
  const m = model([]);
  check("fog with no declared lights covers the whole grid", foggedCount(computeFogMask(m)) === 16);
}

// --- what the solver's own digits light ---
{
  const m = model([]);
  m.grid[1]![1]!.value = SOLUTION_4[1]![1]!; // correct
  const lit = litCells(m);
  check("a correct entry lights the 3x3 around it", lit.size === 9 && lit.has("0,0") && lit.has("2,2"));
}
{
  const m = model([]);
  m.grid[1]![1]!.value = SOLUTION_4[1]![1]! === 1 ? 2 : 1; // wrong
  check("a wrong entry lights nothing", litCells(m).size === 0);
}
{
  const m = model([]);
  m.grid[1]![1]!.given = SOLUTION_4[1]![1]!;
  check("a given lights nothing on its own", litCells(m).size === 0);
}
{
  // The pure-function property: fog is derived from the live grid, so undo
  // (which just restores cell values) puts it back with no fog bookkeeping.
  const m = model([]);
  m.grid[0]![0]!.value = SOLUTION_4[0]![0]!;
  check("correct entry lights ground", litCells(m).size > 0);
  m.grid[0]![0]!.value = undefined;
  check("erasing it fogs that ground back over", litCells(m).size === 0);
}

// --- a puzzle with fog but no solution ---
{
  const m = model([{ cell: { row: 1, col: 1 }, size: 1 }], false);
  m.grid[2]![2]!.value = 4;
  check("without a solution only the declared lights apply", litCells(m).size === 1);
  check("...and the import note says why", fogImportNotes(false)[0]!.includes("didn't include a solution"));
  check("with a solution the note explains the reveal rule", fogImportNotes(true)[0]!.includes("3x3"));
}

// --- the revealed view: what every solving aid is allowed to see ---
{
  const m = model([{ cell: { row: 1, col: 1 }, size: 1 }]);
  m.grid[0]![0]!.given = 1; // lit
  m.grid[3]![3]!.given = 9; // fogged
  m.grid[3]![0]!.value = 7; // fogged (wrong, so it lights nothing)
  const view = revealedModel(m, computeFogMask(m));
  check("revealed view keeps a lit given", view.grid[0]![0]!.given === 1);
  check("revealed view drops a fogged given", view.grid[3]![3]!.given === undefined);
  check("revealed view drops a fogged entry", view.grid[3]![0]!.value === undefined);
  check("revealed view never touches the real grid", m.grid[3]![3]!.given === 9 && m.grid[3]![0]!.value === 7);
  check("revealed view copies every cell, lit ones included", view.grid[0]![0] !== m.grid[0]![0]);
}
{
  // The leak this exists to prevent: a hidden given must not be able to
  // flag a conflict, because the red cell would announce the hidden digit.
  const m = model([{ cell: { row: 1, col: 1 }, size: 1 }]);
  m.grid[0]![3]!.given = 2; // fogged
  m.grid[0]![0]!.value = 2; // lit, duplicates the hidden given in row 1
  check("conflicts on the real grid would expose the hidden given", findConflicts(m).length > 0);
  check(
    "conflicts on the revealed view do not",
    findConflicts(revealedModel(m, computeFogMask(m))).length === 0,
  );
}

// --- importer: f-puzzles ---
{
  const raw = {
    size: 4,
    grid: [
      [{ value: 1, given: true }, {}, {}, {}],
      [{}, {}, {}, {}],
      [{}, {}, {}, {}],
      [{}, {}, {}, {}],
    ],
    solution: SOLUTION_4.flat(),
    fogofwar: ["R1C1"],
    foglight: ["R4C4"],
  };
  const m = parseFPuzzles(raw);
  check("fpuzzles: fog is detected", m.fog !== undefined);
  check("fpuzzles: fogofwar cells are size-3 lights", m.fog?.lights[0]?.size === 3);
  check("fpuzzles: foglight cells are size-1 lights", m.fog?.lights[1]?.size === 1);
  check(
    "fpuzzles: fog cell refs are 1-indexed CellRefs",
    m.fog?.lights[1]?.cell.row === 4 && m.fog?.lights[1]?.cell.col === 4,
  );
  check(
    "fpuzzles: fog keys are not reported as unsupported",
    !m.constraints.some((c) => c.type === "unsupported" && (c.sourceKey === "fogofwar" || c.sourceKey === "foglight")),
  );
  check("fpuzzles: the board gets a fog note", (m.importNotes ?? []).some((n) => n.includes("Fog of war")));
}
{
  const m = parseFPuzzles({ size: 4, grid: [], fogofwar: ["R1C1"] });
  check(
    "fpuzzles: fog without a solution is called out",
    (m.importNotes ?? []).some((n) => n.includes("didn't include a solution")),
  );
}

// --- importer: scl/ctc ---
{
  const cells = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({})));
  const m = parseScl({
    cells,
    cages: [
      { cells: [[0, 0], [0, 1]], value: "fow" },
      { cells: [[3, 3]], value: "FogLight" },
      { cells: [[1, 0], [1, 1]], value: 7 },
      { value: `solution: ${SOLUTION_4.flat().join("")}` },
    ],
  });
  check("scl: a fow cage becomes fog", m.fog !== undefined);
  check("scl: fow cells are size-3 lights", m.fog?.lights.filter((l) => l.size === 3).length === 2);
  check("scl: foglight cells are size-1 lights (keyword is case-insensitive)", m.fog?.lights.filter((l) => l.size === 1).length === 1);
  check(
    "scl: fog cage [row, col] pairs become 1-indexed CellRefs",
    m.fog?.lights[0]?.cell.row === 1 && m.fog?.lights[0]?.cell.col === 1,
  );
  check("scl: a fog cage is not mistaken for a killer cage", m.constraints.filter((c) => c.type === "cage").length === 1);
  check("scl: the real killer cage still parses", m.constraints.some((c) => c.type === "cage" && c.sum === 7));
}
{
  const cells = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({})));
  const m = parseScl({ cells, foglight: [[2, 2]], fogofwar: ["R1C1"] });
  check("scl: top-level foglight list is read", m.fog?.lights.some((l) => l.size === 1 && l.cell.row === 3) === true);
  check("scl: top-level fogofwar list is read, in either spelling", m.fog?.lights.some((l) => l.size === 3 && l.cell.row === 1) === true);
  check(
    "scl: fog keys are not reported as unsupported",
    !m.constraints.some((c) => c.type === "unsupported" && (c.sourceKey === "fogofwar" || c.sourceKey === "foglight")),
  );
}

console.log(failed ? "\nSMOKE TEST: FAILED" : "\nAll fog checks passed.");
process.exitCode = failed ? 1 : 0;
