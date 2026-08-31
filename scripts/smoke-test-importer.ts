// Quick regression check for the importer pipeline (decode.ts + fpuzzles.ts) against
// synthetic puzzles covering every constraint type this app currently parses.
// Run with: npm run test:importer

// Runs under plain Node via tsx, which has stricter CJS/ESM interop than
// Vite's bundler, so lz-string is required() directly here rather than
// imported the way the shipped decode.ts does it (decode.ts's import style
// is proven separately by `npm run build` succeeding, which is the code
// path the real app actually runs through in the browser).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LZString = require("lz-string") as typeof import("lz-string");

import { parseFPuzzles } from "../src/renderer/src/importer/formats/fpuzzles";
import { extractIdOrPayload } from "../src/renderer/src/importer/fetchPuzzle";

const puzzle = {
  size: 4,
  title: "Smoke Test Puzzle",
  author: "test-harness",
  ruleset: "Normal sudoku rules apply. Cage/thermo/arrow/kropki/odd rules apply.",
  grid: [
    [{ value: 1, given: true }, {}, {}, {}],
    [{}, {}, {}, {}],
    [{}, {}, {}, {}],
    [{}, {}, {}, { value: 4, given: true }],
  ],
  antiknight: true,
  killercage: [{ cells: ["R1C2", "R1C3"], value: "7" }],
  thermometer: [{ lines: [["R2C1", "R2C2", "R2C3"]] }],
  arrow: [{ cells: ["R3C1"], lines: [["R3C1", "R3C2", "R3C3"]] }],
  ratio: [{ cells: ["R4C1", "R4C2"] }], // no explicit value -- parser should default to 2
  odd: [{ cell: "R2C4" }],
  renban: [{ lines: [["R1C1", "R2C1"]] }], // Phase 5: now really parsed (used to be the "unsupported" regression case)
  whispers: [{ lines: [["R1C4", "R2C4"]], value: "3" }],
  palindrome: [{ lines: [["R1C2", "R4C2"]] }],
  betweenline: [{ lines: [["R1C1", "R2C2", "R3C3"]] }],
  littlekillersum: [{ cell: "R0C1", direction: "DR", value: "5" }],
  xv: [{ cells: ["R1C3", "R1C4"], value: "V" }],
  sandwichsum: [{ cell: "R0C3", value: "2" }],
  extraregion: [{ cells: ["R1C1", "R2C2", "R3C3", "R4C4"] }],
  clone: [{ cells: ["R1C1", "R1C2"], cloneCells: ["R2C1", "R2C2"] }],
  quadruple: [{ cells: ["R2C2", "R2C3", "R3C2", "R3C3"], values: [1, 2] }],
  minimum: [{ cell: "R3C4" }],
  maximum: [{ cell: "R4C3" }],
  "diagonal+": true,
  "diagonal-": true,
  nonconsecutive: true,
  solution: [1, 2, 3, 4, 2, 3, 4, 1, 3, 4, 1, 2, 4, 1, 2, 4],
};
const json = JSON.stringify(puzzle);

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
}

// --- Replicate decode.ts's exact algorithm (prefix strip -> decompress -> JSON.parse),
//     using require()'d lz-string, to verify the round-trip design is correct. ---
function decodeLikeDecodeTs(payload: string) {
  const trimmed = payload.trim();
  if (trimmed.startsWith("{")) return { format: "raw-json", json: JSON.parse(trimmed) };
  const prefixes = ["fpuzzles", "fpuz"];
  const hit = prefixes.find((p) => trimmed.startsWith(p));
  if (hit) {
    const body = trimmed.slice(hit.length);
    const decompressed = LZString.decompressFromBase64(decodeURIComponent(body));
    if (!decompressed) throw new Error("decompression failed");
    return { format: "fpuzzles", json: JSON.parse(decompressed) };
  }
  const bare = LZString.decompressFromBase64(trimmed);
  if (bare) return { format: "fpuzzles", json: JSON.parse(bare) };
  throw new Error("unrecognized payload");
}

// Case 1: SudokuPad-style "fpuzzles"-prefixed payload
const prefixed = "fpuzzles" + LZString.compressToBase64(json);
const decoded1 = decodeLikeDecodeTs(prefixed);
check("prefixed payload round-trips through compress/decompress", decoded1.format === "fpuzzles");
check("prefixed payload JSON matches original", JSON.stringify(decoded1.json) === json);

// Case 2: f-puzzles.com bare (unprefixed) payload -- the fallback path added after
// confirming (via dclamage/SudokuSolver's own link generator) that f-puzzles.com
// share links carry no format prefix at all.
const bare = LZString.compressToBase64(json);
const decoded2 = decodeLikeDecodeTs(bare);
check("bare payload round-trips via the no-prefix fallback", decoded2.format === "fpuzzles");
check("bare payload JSON matches original", JSON.stringify(decoded2.json) === json);

// Case 3: REGRESSION for a real bug (2026-08-29) -- an f-puzzles.com URL whose
// bare payload contains literal "+" characters. extractIdOrPayload() used to pull
// the "load" param via URLSearchParams.get(), which silently turns "+" into " "
// (application/x-www-form-urlencoded semantics) -- corrupting otherwise-valid
// base64 and causing decompression to silently produce garbage instead of the
// real puzzle. This is a real user-submitted link (www.f-puzzles.com), not synthetic.
const realFPuzzlesUrl =
  "https://www.f-puzzles.com/?load=N4IgzglgXgpiBcBOANCALhNAbO8QDEBaABQFcoocRUBDUtACwHsAnBEMrANxheggB2Ac2I0BAYxoBrOKhakcYGGnYA5VgFsaWAARhSAEyZTSO+Yp00ADlawBPAHQ6A6pgaCdRtGhgGdkoRgwZE8IIUwwHQ1SMDQ9Ug0dNCYkhhgdLm1SdI9GdOSrQhwAMzjxVgFeHSZi1PSAmCcAETCIqJo7HQEmOJYYKxgaOI8GsCcAFTT2lhk/AwgaISYBbSiYsuW0Gg9B8QZQ8LjiliZEgEYklMQdGAAPGnFsTuXxRp0AYRgsLEjGIcs+pZ/GkwJEpAIwgw0ABySIaJg8SxWGgsOJaTrdDYCLa5KZgGgadLzQ4OaggIR8AwIADa1OAAF9kAymYzmWzWRyWQBdZB0znslmCgUMnl8oX8iXi0XCyUy7m8uWKiXS2WqqUKtVK+VirVKlXig16nkgeaLZbaADUCDQ8hgtGxEHBkJU8Bt2VQUgg314DRpoFe3zANJAACUACzvABsZJDAFYoyBjZksNl2GcAAwgVkgAM/YMhgDM7zDMYjJdQ4fesZj8fLocjxZjDerFYb0aTWVwIALmezuaD8GpobOjYrI+jFYATKPQ9OW7OE1P3gB2GNF9uoZOpvA9rNMnNfPOD4crmMjgAcZ/eiBj05vFaLl4f19LL47Ka7u77h4HQ5DiBnf8q0TTdO3YaNv0DfMG0nJt3gLECQC3LszjOPd/R/fNpzQpdYPfbcQBvSCjz/c8XwrACb3wlDe33ft8zIhCKzIktqLTWiMKg48QzInDQzIvDQI/dhL2I39Q2Xd4n3409mKkxDkLTat6S5ekgA==";
const extracted = extractIdOrPayload(realFPuzzlesUrl);
check("real f-puzzles URL classified as fpuzzles-link", extracted.kind === "fpuzzles-link");
check("extracted payload has no corrupted spaces", !extracted.idOrPayload.includes(" "));
const decodedReal = decodeLikeDecodeTs(extracted.idOrPayload);
check("real payload decompresses+parses despite containing literal + chars", decodedReal.format === "fpuzzles");
check(
  "real payload's JSON has the expected title",
  (decodedReal.json as { title?: string }).title === "F-Puzzle",
);

// --- Now verify the actual shipped parser (no lz-string dependency, imports cleanly) ---
function runAssertions(model: ReturnType<typeof parseFPuzzles>, label: string) {
  check(`[${label}] size is 4`, model.size === 4);
  check(`[${label}] title parsed`, model.title === "Smoke Test Puzzle");
  check(`[${label}] given R1C1=1`, model.grid[0]![0]!.given === 1);
  check(`[${label}] given R4C4=4`, model.grid[3]![3]!.given === 4);
  check(`[${label}] antiKnight global rule`, model.globalRules.antiKnight === true);

  const cage = model.constraints.find((c) => c.type === "cage");
  check(`[${label}] cage found with sum 7`, cage?.type === "cage" && cage.sum === 7);
  check(
    `[${label}] cage cells are R1C2,R1C3 (1-indexed refs preserved)`,
    cage?.type === "cage" &&
      cage.cells.length === 2 &&
      cage.cells[0]!.row === 1 && cage.cells[0]!.col === 2 &&
      cage.cells[1]!.row === 1 && cage.cells[1]!.col === 3,
  );

  const thermo = model.constraints.find((c) => c.type === "thermo");
  check(`[${label}] thermo found with 3 cells`, thermo?.type === "thermo" && thermo.cells.length === 3);

  const arrow = model.constraints.find((c) => c.type === "arrow");
  check(
    `[${label}] arrow found: 1 circle cell, 3 path cells (path includes circle per dclamage source)`,
    arrow?.type === "arrow" && arrow.circleCells.length === 1 && arrow.arrowCells.length === 3,
  );

  const kropki = model.constraints.find((c) => c.type === "kropki");
  check(`[${label}] kropki ratio found`, kropki?.type === "kropki" && kropki.kind === "ratio");

  const oddEven = model.constraints.find((c) => c.type === "oddEven");
  check(
    `[${label}] odd cell found at R2C4`,
    oddEven?.type === "oddEven" && oddEven.kind === "odd" && oddEven.cell.row === 2 && oddEven.cell.col === 4,
  );

  check(`[${label}] kropki ratio defaults to value 2 when blank`, kropki?.type === "kropki" && kropki.value === 2);

  const lines = model.constraints.filter((c): c is Extract<typeof c, { type: "line" }> => c.type === "line");
  const renban = lines.find((l) => l.kind === "renban");
  check(`[${label}] renban now really parsed (Phase 5), not left unsupported`, renban?.cells.length === 2);
  const whisper = lines.find((l) => l.kind === "whisper");
  check(`[${label}] whisper line parsed with custom minDifference 3`, whisper?.minDifference === 3);
  const palindrome = lines.find((l) => l.kind === "palindrome");
  check(`[${label}] palindrome line parsed`, palindrome?.cells.length === 2);

  const betweenLine = model.constraints.find((c) => c.type === "betweenLine");
  check(`[${label}] between line parsed with 3 cells`, betweenLine?.type === "betweenLine" && betweenLine.cells.length === 3);

  const littleKiller = model.constraints.find((c) => c.type === "littleKiller");
  check(
    `[${label}] little killer diagonal resolved from outside-grid clue`,
    littleKiller?.type === "littleKiller" &&
      littleKiller.sum === 5 &&
      littleKiller.cells.length === 3 &&
      littleKiller.cells[0]!.row === 1 &&
      littleKiller.cells[0]!.col === 2,
  );

  const xv = model.constraints.find((c) => c.type === "xv");
  check(`[${label}] xv parsed as V (sum 5)`, xv?.type === "xv" && xv.kind === "V");

  const sandwich = model.constraints.find((c) => c.type === "sandwich");
  check(
    `[${label}] sandwich clue resolved to a full column`,
    sandwich?.type === "sandwich" && sandwich.sum === 2 && sandwich.cells.length === 4,
  );

  const extraRegion = model.constraints.find((c) => c.type === "extraRegion");
  check(`[${label}] extra region parsed with 4 cells`, extraRegion?.type === "extraRegion" && extraRegion.cells.length === 4);

  const clone = model.constraints.find((c) => c.type === "clone");
  check(`[${label}] clone parsed with 2 pairs`, clone?.type === "clone" && clone.pairs.length === 2);

  const quadruple = model.constraints.find((c) => c.type === "quadruple");
  check(
    `[${label}] quadruple parsed with required values [1,2]`,
    quadruple?.type === "quadruple" && quadruple.values.join(",") === "1,2",
  );

  const minMaxes = model.constraints.filter((c): c is Extract<typeof c, { type: "minMax" }> => c.type === "minMax");
  check(`[${label}] minimum + maximum both parsed`, minMaxes.some((m) => m.kind === "min") && minMaxes.some((m) => m.kind === "max"));

  check(
    `[${label}] diagonal+/diagonal-/nonconsecutive global rules parsed`,
    model.globalRules.diagonalPositive === true && model.globalRules.diagonalNegative === true && model.globalRules.nonConsecutive === true,
  );

  check(`[${label}] solution parsed, [0][0]=1 and [3][3]=4`, model.solution?.[0]?.[0] === 1 && model.solution?.[3]?.[3] === 4);
}

runAssertions(parseFPuzzles(decoded1.json), "prefixed");
runAssertions(parseFPuzzles(decoded2.json), "bare");
runAssertions(parseFPuzzles(JSON.parse(json)), "raw-json");

console.log(failed ? "\nSMOKE TEST: FAILED" : "\nSMOKE TEST: ALL PASSED");
process.exitCode = failed ? 1 : 0;
