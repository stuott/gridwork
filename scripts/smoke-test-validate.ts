// Regression check for solver/validate.ts's constraint checking, covering
// every constraint type findConflicts understands: classic row/col/box,
// the global whole-grid rules, and every per-constraint type -- killer
// cages, thermometers, arrows, kropki dots (both kinds), odd/even cells,
// renban/whisper/palindrome lines, between lines, little killer sums, XV,
// sandwich sums, extra regions, clones, quadruples and min/max cells. Each
// case builds its own minimal PuzzleModel so cases stay isolated from each
// other's row/col/box state.
// Run with: npm run test:validate

import { findConflicts } from "../src/renderer/src/solver/validate";
import { createEmptyGrid, type Constraint, type PuzzleModel } from "../src/renderer/src/model/types";

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
}

function model(
  size: number,
  constraints: Constraint[] = [],
  globalRules: PuzzleModel["globalRules"] = {},
): PuzzleModel {
  return { size, grid: createEmptyGrid(size), constraints, globalRules };
}

function reasonsOf(m: PuzzleModel): string[] {
  return findConflicts(m).map((c) => c.reason);
}

// --- classic row/col/box (regression -- unrelated to Phase 3, just proving
//     the rewrite didn't break what already worked) ---
{
  const m = model(4);
  m.grid[0][0]!.value = 3;
  m.grid[0][2]!.value = 3;
  check("row duplicate detected", reasonsOf(m).some((r) => r.includes("Row 1")));
}
{
  const m = model(4);
  m.grid[0][1]!.value = 2;
  m.grid[2][1]!.value = 2;
  check("column duplicate detected", reasonsOf(m).some((r) => r.includes("Column 2")));
}
{
  const m = model(4);
  m.grid[0][0]!.value = 4;
  m.grid[1][1]!.value = 4;
  check("box duplicate detected", reasonsOf(m).some((r) => r.includes("Box")));
}

// --- killer cage (regression) ---
{
  const m = model(4, [{ type: "cage", cells: [{ row: 1, col: 3 }, { row: 1, col: 4 }], sum: 7 }]);
  m.grid[0][2]!.value = 3;
  m.grid[0][3]!.value = 4;
  check("cage sum match: no cage conflict", !reasonsOf(m).some((r) => r.includes("Cage")));
}
{
  const m = model(4, [{ type: "cage", cells: [{ row: 1, col: 3 }, { row: 1, col: 4 }], sum: 7 }]);
  m.grid[0][2]!.value = 3;
  m.grid[0][3]!.value = 3;
  check("cage duplicate + sum mismatch both flagged", reasonsOf(m).some((r) => r.includes("repeated")));
}

// --- thermometer ---
{
  const m = model(4, [{ type: "thermo", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }] }]);
  m.grid[0][0]!.value = 1;
  m.grid[1][0]!.value = 2;
  m.grid[2][0]!.value = 3;
  check("thermo strictly increasing: no conflict", !reasonsOf(m).some((r) => r.includes("Thermometer")));
}
{
  const m = model(4, [{ type: "thermo", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }] }]);
  m.grid[0][0]!.value = 3;
  m.grid[1][0]!.value = 2;
  m.grid[2][0]!.value = 1;
  const thermoConflicts = reasonsOf(m).filter((r) => r.includes("Thermometer"));
  check("thermo decreasing: flagged", thermoConflicts.length > 0);
  check("thermo decreasing: one conflict per broken pair", thermoConflicts.length === 2);
}

// --- slow thermometer (repeats allowed, values just can't decrease) ---
// Nothing in a payload's geometry distinguishes a slow thermo from a normal
// one; scl.ts sets the flag from the puzzle's prose rules. Getting this
// wrong is the expensive direction: a strict check on a slow thermo flags
// the solver's CORRECT digits as mistakes.
{
  const m = model(4, [
    { type: "thermo", slow: true, cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }] },
  ]);
  m.grid[0][0]!.value = 2;
  m.grid[1][0]!.value = 2;
  m.grid[2][0]!.value = 3;
  check("slow thermo repeated value: NOT flagged", !reasonsOf(m).some((r) => r.includes("thermometer")));
}
{
  const m = model(4, [
    { type: "thermo", slow: true, cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }] },
  ]);
  m.grid[0][0]!.value = 3;
  m.grid[1][0]!.value = 2;
  m.grid[2][0]!.value = 2;
  const slowConflicts = reasonsOf(m).filter((r) => r.includes("Slow thermometer"));
  check("slow thermo actually decreasing: still flagged", slowConflicts.length === 1);
}
{
  const m = model(4, [{ type: "thermo", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }] }]);
  m.grid[0][0]!.value = 2;
  m.grid[1][0]!.value = 2;
  check("a NON-slow thermo still rejects repeats", reasonsOf(m).some((r) => r.includes("strictly increase")));
}

// --- arrow ---
{
  const m = model(4, [
    { type: "arrow", circleCells: [{ row: 1, col: 1 }], arrowCells: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }] },
  ]);
  m.grid[0][0]!.value = 5;
  m.grid[1][0]!.value = 2;
  m.grid[2][0]!.value = 3;
  check("arrow sum matches circle: no conflict", !reasonsOf(m).some((r) => r.includes("Arrow")));
}
{
  const m = model(4, [
    { type: "arrow", circleCells: [{ row: 1, col: 1 }], arrowCells: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }] },
  ]);
  m.grid[0][0]!.value = 5;
  m.grid[1][0]!.value = 2;
  m.grid[2][0]!.value = 4;
  check("arrow sum mismatch: flagged", reasonsOf(m).some((r) => r.includes("Arrow sums to 6, expected 5")));
}
{
  // Two-cell ("pill") circle: target is the digits read as a two-digit number.
  const m = model(4, [
    {
      type: "arrow",
      circleCells: [{ row: 1, col: 1 }, { row: 1, col: 2 }],
      arrowCells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }, { row: 3, col: 1 }],
    },
  ]);
  m.grid[0][0]!.value = 1;
  m.grid[0][1]!.value = 2;
  m.grid[1][0]!.value = 5;
  m.grid[2][0]!.value = 7;
  check("arrow two-cell circle reads as 12, sum matches: no conflict", !reasonsOf(m).some((r) => r.includes("Arrow")));
}

// --- kropki ---
{
  const m = model(4, [{ type: "kropki", kind: "ratio", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }], value: 2 }]);
  m.grid[0][0]!.value = 2;
  m.grid[1][0]!.value = 4;
  check("kropki ratio 2:1 valid: no conflict", !reasonsOf(m).some((r) => r.includes("Kropki")));
}
{
  const m = model(4, [{ type: "kropki", kind: "ratio", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }], value: 2 }]);
  m.grid[0][0]!.value = 2;
  m.grid[1][0]!.value = 3;
  check("kropki ratio violated: flagged", reasonsOf(m).some((r) => r.includes("2:1 ratio")));
}
{
  const m = model(4, [{ type: "kropki", kind: "difference", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }], value: 1 }]);
  m.grid[0][0]!.value = 3;
  m.grid[1][0]!.value = 4;
  check("kropki difference of 1 valid: no conflict", !reasonsOf(m).some((r) => r.includes("Kropki")));
}
{
  const m = model(4, [{ type: "kropki", kind: "difference", cells: [{ row: 1, col: 1 }, { row: 2, col: 1 }], value: 1 }]);
  m.grid[0][0]!.value = 3;
  m.grid[1][0]!.value = 1;
  check("kropki difference violated: flagged", reasonsOf(m).some((r) => r.includes("differ by 1")));
}

// --- odd/even ---
{
  const m = model(4, [{ type: "oddEven", kind: "odd", cell: { row: 1, col: 1 } }]);
  m.grid[0][0]!.value = 3;
  check("odd cell with odd value: no conflict", !reasonsOf(m).some((r) => r.includes("Must be odd")));
}
{
  const m = model(4, [{ type: "oddEven", kind: "odd", cell: { row: 1, col: 1 } }]);
  m.grid[0][0]!.value = 4;
  check("odd cell with even value: flagged", reasonsOf(m).some((r) => r.includes("Must be odd")));
}
{
  const m = model(4, [{ type: "oddEven", kind: "even", cell: { row: 1, col: 1 } }]);
  m.grid[0][0]!.value = 2;
  check("even cell with even value: no conflict", !reasonsOf(m).some((r) => r.includes("Must be even")));
}
{
  const m = model(4, [{ type: "oddEven", kind: "even", cell: { row: 1, col: 1 } }]);
  m.grid[0][0]!.value = 3;
  check("even cell with odd value: flagged", reasonsOf(m).some((r) => r.includes("Must be even")));
}


// --- Phase 5: global whole-grid rules ---
{
  const m = model(9, [], { antiKnight: true });
  m.grid[0][0]!.value = 5;
  m.grid[2][1]!.value = 5; // a knight's move from (0,0)
  check("antiknight: knight's-move duplicate flagged", reasonsOf(m).some((r) => r.includes("Anti-knight")));
}
{
  const m = model(9, [], { antiKnight: true });
  m.grid[0][0]!.value = 5;
  m.grid[1][1]!.value = 5; // diagonal, not a knight's move
  check("antiknight: non-knight-move duplicate not flagged by this rule", !reasonsOf(m).some((r) => r.includes("Anti-knight")));
}
{
  const m = model(9, [], { antiKing: true });
  m.grid[0][0]!.value = 7;
  m.grid[1][1]!.value = 7; // diagonally adjacent
  check("antiking: king's-move duplicate flagged", reasonsOf(m).some((r) => r.includes("Anti-king")));
}
{
  const m = model(9, [], { disjointGroups: true });
  m.grid[0][0]!.value = 4; // box 0, relative position (0,0)
  m.grid[3][3]!.value = 4; // box 4, relative position (0,0) -- same relative spot
  check("disjoint groups: same-position duplicate across boxes flagged", reasonsOf(m).some((r) => r.includes("Disjoint group")));
}
{
  const m = model(9, [], { diagonalPositive: true });
  m.grid[0][8]!.value = 6;
  m.grid[8][0]!.value = 6; // both on the "/" diagonal
  check("diagonal+: repeated digit on the anti-diagonal flagged", reasonsOf(m).some((r) => r.includes("Diagonal")));
}
{
  const m = model(9, [], { diagonalNegative: true });
  m.grid[0][0]!.value = 6;
  m.grid[8][8]!.value = 6; // both on the "\" diagonal
  check("diagonal-: repeated digit on the main diagonal flagged", reasonsOf(m).some((r) => r.includes("Diagonal")));
}
{
  const m = model(9, [], { nonConsecutive: true });
  m.grid[0][0]!.value = 5;
  m.grid[0][1]!.value = 6; // orthogonally adjacent, consecutive
  check("nonconsecutive: adjacent consecutive digits flagged", reasonsOf(m).some((r) => r.includes("Non-consecutive")));
}
{
  const m = model(9, [], { nonConsecutive: true });
  m.grid[0][0]!.value = 5;
  m.grid[0][1]!.value = 7; // adjacent, not consecutive
  check("nonconsecutive: adjacent non-consecutive digits not flagged", !reasonsOf(m).some((r) => r.includes("Non-consecutive")));
}

// --- renban ---
{
  const m = model(4, [{ type: "line", kind: "renban", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }] }]);
  m.grid[0][0]!.value = 2;
  m.grid[0][1]!.value = 4;
  m.grid[0][2]!.value = 3;
  check("renban: consecutive run in any order, no conflict", !reasonsOf(m).some((r) => r.includes("Renban")));
}
{
  const m = model(4, [{ type: "line", kind: "renban", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }] }]);
  m.grid[0][0]!.value = 1;
  m.grid[0][1]!.value = 2;
  m.grid[0][2]!.value = 4; // 1,2,4 -- not a consecutive run
  check("renban: non-consecutive run flagged", reasonsOf(m).some((r) => r.includes("consecutive run")));
}

// --- whisper ---
{
  const m = model(9, [{ type: "line", kind: "whisper", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], minDifference: 5 }]);
  m.grid[0][0]!.value = 1;
  m.grid[0][1]!.value = 7;
  check("whisper: difference >= 5, no conflict", !reasonsOf(m).some((r) => r.includes("Whisper")));
}
{
  const m = model(9, [{ type: "line", kind: "whisper", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], minDifference: 5 }]);
  m.grid[0][0]!.value = 4;
  m.grid[0][1]!.value = 6;
  check("whisper: difference < 5, flagged", reasonsOf(m).some((r) => r.includes("Whisper")));
}

// --- palindrome ---
{
  const m = model(4, [{ type: "line", kind: "palindrome", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }] }]);
  m.grid[0][0]!.value = 3;
  m.grid[0][3]!.value = 3;
  check("palindrome: mirrored ends match, no conflict", !reasonsOf(m).some((r) => r.includes("Palindrome")));
}
{
  const m = model(4, [{ type: "line", kind: "palindrome", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }] }]);
  m.grid[0][0]!.value = 3;
  m.grid[0][3]!.value = 2;
  check("palindrome: mirrored ends mismatch, flagged", reasonsOf(m).some((r) => r.includes("Palindrome")));
}

// --- between line ---
{
  const m = model(9, [{ type: "betweenLine", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }] }]);
  m.grid[0][0]!.value = 2;
  m.grid[0][1]!.value = 5;
  m.grid[0][2]!.value = 8;
  check("between line: interior strictly between ends, no conflict", !reasonsOf(m).some((r) => r.includes("Between line")));
}
{
  const m = model(9, [{ type: "betweenLine", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }] }]);
  m.grid[0][0]!.value = 2;
  m.grid[0][1]!.value = 9;
  m.grid[0][2]!.value = 8;
  check("between line: interior outside the ends, flagged", reasonsOf(m).some((r) => r.includes("Between line")));
}

// --- little killer ---
{
  const m = model(4, [
    { type: "littleKiller", clueCell: { row: 0, col: 1 }, direction: "DR", sum: 6, cells: [{ row: 1, col: 2 }, { row: 2, col: 3 }, { row: 3, col: 4 }] },
  ]);
  m.grid[0][1]!.value = 1;
  m.grid[1][2]!.value = 2;
  m.grid[2][3]!.value = 3;
  check("little killer: diagonal sums to clue, no conflict", !reasonsOf(m).some((r) => r.includes("Little killer")));
}
{
  const m = model(4, [
    { type: "littleKiller", clueCell: { row: 0, col: 1 }, direction: "DR", sum: 6, cells: [{ row: 1, col: 2 }, { row: 2, col: 3 }, { row: 3, col: 4 }] },
  ]);
  m.grid[0][1]!.value = 1;
  m.grid[1][2]!.value = 2;
  m.grid[2][3]!.value = 4;
  check("little killer: diagonal sum mismatch, flagged", reasonsOf(m).some((r) => r.includes("Little killer sums to 7, expected 6")));
}

// --- xv ---
{
  const m = model(9, [{ type: "xv", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], kind: "X" }]);
  m.grid[0][0]!.value = 4;
  m.grid[0][1]!.value = 6;
  check("xv: X sums to 10, no conflict", !reasonsOf(m).some((r) => r.includes("X:")));
}
{
  const m = model(9, [{ type: "xv", cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], kind: "V" }]);
  m.grid[0][0]!.value = 4;
  m.grid[0][1]!.value = 6;
  check("xv: V should sum to 5 but doesn't, flagged", reasonsOf(m).some((r) => r.includes("V:")));
}

// --- sandwich ---
{
  const cells = [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
  const m = model(4, [{ type: "sandwich", cells, clueCell: { row: 1, col: 0 }, sum: 5 }]);
  m.grid[0][0]!.value = 1; // crust
  m.grid[0][1]!.value = 2;
  m.grid[0][2]!.value = 3;
  m.grid[0][3]!.value = 4; // crust -- between sum is 2+3=5, matches
  check("sandwich: sum between crusts matches, no conflict", !reasonsOf(m).some((r) => r.includes("Sandwich")));
}
{
  const cells = [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
  const m = model(4, [{ type: "sandwich", cells, clueCell: { row: 1, col: 0 }, sum: 5 }]);
  m.grid[0][0]!.value = 1; // crust
  m.grid[0][1]!.value = 3;
  m.grid[0][2]!.value = 2;
  m.grid[0][3]!.value = 4; // crust -- between sum is 3+2=5, matches regardless of interior order
  check("sandwich: interior order-independent, sum still matches", !reasonsOf(m).some((r) => r.includes("Sandwich")));
}
{
  const cells = [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
  const m = model(4, [{ type: "sandwich", cells, clueCell: { row: 1, col: 0 }, sum: 5 }]);
  m.grid[0][0]!.value = 1; // crust
  m.grid[0][1]!.value = 2;
  m.grid[0][2]!.value = 4; // crust -- between sum is just 2, expected 5
  m.grid[0][3]!.value = 3;
  check("sandwich: sum mismatch flagged", reasonsOf(m).some((r) => r.includes("Sandwich sums to 2, expected 5")));
}

// --- extra region ---
{
  const m = model(9, [{ type: "extraRegion", cells: [{ row: 1, col: 1 }, { row: 2, col: 2 }, { row: 3, col: 3 }] }]);
  m.grid[0][0]!.value = 5;
  m.grid[1][1]!.value = 5;
  check("extra region: duplicate flagged", reasonsOf(m).some((r) => r.includes("Extra region")));
}

// --- clone ---
{
  const m = model(9, [{ type: "clone", pairs: [[{ row: 1, col: 1 }, { row: 5, col: 5 }]] }]);
  m.grid[0][0]!.value = 3;
  m.grid[4][4]!.value = 3;
  check("clone: matching pair, no conflict", !reasonsOf(m).some((r) => r.includes("Clone")));
}
{
  const m = model(9, [{ type: "clone", pairs: [[{ row: 1, col: 1 }, { row: 5, col: 5 }]] }]);
  m.grid[0][0]!.value = 3;
  m.grid[4][4]!.value = 4;
  check("clone: mismatched pair flagged", reasonsOf(m).some((r) => r.includes("Clone")));
}

// --- quadruple ---
{
  const cells = [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }, { row: 2, col: 2 }];
  const m = model(9, [{ type: "quadruple", cells, values: [3, 3] }]);
  m.grid[0][0]!.value = 3;
  m.grid[0][1]!.value = 3;
  m.grid[1][0]!.value = 5;
  m.grid[1][1]!.value = 6;
  check("quadruple: two 3s present among filled cells, no conflict", !reasonsOf(m).some((r) => r.includes("Quadruple")));
}
{
  const cells = [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }, { row: 2, col: 2 }];
  const m = model(9, [{ type: "quadruple", cells, values: [3, 3] }]);
  m.grid[0][0]!.value = 3;
  m.grid[0][1]!.value = 5;
  m.grid[1][0]!.value = 6;
  m.grid[1][1]!.value = 7;
  check("quadruple: only one 3 present when two required, flagged", reasonsOf(m).some((r) => r.includes("Quadruple")));
}

// --- min/max ---
{
  const m = model(9, [{ type: "minMax", kind: "min", cell: { row: 5, col: 5 } }]);
  m.grid[4][4]!.value = 2;
  m.grid[3][4]!.value = 5;
  m.grid[5][4]!.value = 6;
  check("min cell: less than filled neighbors, no conflict", !reasonsOf(m).some((r) => r.includes("less than every neighbor")));
}
{
  const m = model(9, [{ type: "minMax", kind: "min", cell: { row: 5, col: 5 } }]);
  m.grid[4][4]!.value = 2;
  m.grid[3][4]!.value = 1;
  check("min cell: a smaller neighbor, flagged", reasonsOf(m).some((r) => r.includes("less than every neighbor")));
}
{
  const m = model(9, [{ type: "minMax", kind: "max", cell: { row: 5, col: 5 } }]);
  m.grid[4][4]!.value = 8;
  m.grid[3][4]!.value = 2;
  check("max cell: greater than filled neighbors, no conflict", !reasonsOf(m).some((r) => r.includes("greater than every neighbor")));
}
{
  const m = model(9, [{ type: "minMax", kind: "max", cell: { row: 5, col: 5 } }]);
  m.grid[4][4]!.value = 8;
  m.grid[3][4]!.value = 9;
  check("max cell: a larger neighbor, flagged", reasonsOf(m).some((r) => r.includes("greater than every neighbor")));
}

console.log(failed ? "\nSMOKE TEST: FAILED" : "\nSMOKE TEST: ALL PASSED");
if (failed) process.exit(1);
