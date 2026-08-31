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
// The last block runs against a REAL fog payload (puzzle c74ujud2wz,
// "Fogs-n-Dots-n-Knights" by Meggen033), which is what turns the rest of
// this file from research into fact -- see the comment on that block for
// what it confirmed and what it still doesn't.
//
// Run with: npm run test:fog

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// decode.ts imports lz-string, which has no clean ESM named exports under
// plain Node (fine under Vite) -- same workaround smoke-test-scl.ts and
// smoke-test-importer.ts use. The fpuz branch of decode.ts is replicated in
// the fixture block below rather than imported.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LZString = require("lz-string") as typeof import("lz-string");

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

// --- the real payload -------------------------------------------------------
// Puzzle c74ujud2wz, "Fogs-n-Dots-n-Knights" by Meggen033, captured
// 2026-08-31 from https://sudokupad.app/api/puzzle/c74ujud2wz (verified
// byte-for-byte against the server's response: 2234 chars, two independent
// hashes). It arrives as an f-puzzles payload, not scl.
//
// WHAT IT CONFIRMS:
//  - `foglight` really is a list of "R1C1" strings, and really is the
//    SINGLE-cell light. Its nine cells are exactly the central box, and the
//    board lights exactly those nine. Read as 3x3 lights they would have lit
//    a 5x5 block of 25 -- so this one number settles the size question.
//  - a correct digit lights its 3x3, clipped at the corner (4 cells at
//    R1C1), and a wrong one lights nothing.
//  - the puzzle has ZERO givens: without fog handling it loads as a blank
//    grid, and the nine lit cells are the entire starting position.
//
// WHAT IT STILL DOESN'T CONFIRM: `fogofwar` (the 3x3-light key) appears in
// no real payload yet, and neither does any scl-side fog spelling. Those
// remain research -- see state/fog.ts and design.md 11.1.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "fixtures", "fpuz-fog-c74ujud2wz.txt"), "utf8").trim();
  check("fixture is an fpuz payload", raw.startsWith("fpuz"));
  // decode.ts's fpuz branch: strip the prefix, URL-decode, lz-string, JSON.
  const json = JSON.parse(LZString.decompressFromBase64(decodeURIComponent(raw.slice("fpuz".length)))!);
  const m = parseFPuzzles(json);

  check("real fog puzzle: title/author survive the import", m.title === "Fogs-n-Dots-n-Knights" && m.author === "Meggen033");
  check("real fog puzzle: fog is detected", m.fog !== undefined);
  check("real fog puzzle: nine foglight cells", m.fog?.lights.length === 9);
  check("real fog puzzle: foglight is the single-cell light", m.fog?.lights.every((l) => l.size === 1) === true);
  check("real fog puzzle: it carries a solution to check against", m.solution !== undefined);
  check("real fog puzzle: it has no givens at all", m.grid.flat().every((cell) => cell.given === undefined));

  const mask = computeFogMask(m);
  check("real fog puzzle: 72 of 81 cells start covered", foggedCount(mask) === 72);
  const lit: string[] = [];
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (!isFogged(mask, r, c)) lit.push(`R${r + 1}C${c + 1}`);
  check(
    "real fog puzzle: the lit start is exactly the central box",
    lit.join(" ") === "R4C4 R4C5 R4C6 R5C4 R5C5 R5C6 R6C4 R6C5 R6C6",
  );

  m.grid[0]![0]!.value = m.solution![0]![0]!;
  check("real fog puzzle: a correct corner digit lights its clipped 3x3", foggedCount(computeFogMask(m)) === 68);
  m.grid[0]![0]!.value = m.solution![0]![0]! === 5 ? 6 : 5;
  check("real fog puzzle: a wrong digit lights nothing", foggedCount(computeFogMask(m)) === 72);
  m.grid[0]![0]!.value = undefined;

  // Noise this fixture caught: f-puzzles editor/solver settings were being
  // reported to the solver as unsupported *constraints*, i.e. the app
  // claiming not to enforce rules the puzzle never had.
  const unsupported = m.constraints
    .filter((c): c is Extract<typeof c, { type: "unsupported" }> => c.type === "unsupported")
    .map((c) => c.sourceKey);
  check("real fog puzzle: solver settings are not reported as constraints", !unsupported.includes("disabledlogic"));
  check("real fog puzzle: an empty key is not reported as a missing feature", !unsupported.includes("truecandidatesoptions"));
  check("real fog puzzle: its real constraints still parse", m.constraints.some((c) => c.type === "littleKiller") && m.constraints.some((c) => c.type === "kropki"));
}

console.log(failed ? "\nSMOKE TEST: FAILED" : "\nAll fog checks passed.");
process.exitCode = failed ? 1 : 0;
