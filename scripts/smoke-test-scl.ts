// Regression check for the scl/ctc import pipeline (decode.ts's scl branch +
// formats/puzzleZipper.ts + formats/scl.ts). Run with: npm run test:scl
//
// Unlike the first version of this file, the primary fixture here is a REAL
// captured SudokuPad payload (puzzle 70njbfg1zs, "Sort by Size" by Marty
// Sears), stored in scripts/fixtures/. That closes the roadmap's "real
// fixtures, not synthetic" item for the decode path. A second, synthetic
// case still covers the PuzzleZipper-minified fallback, since no real
// minified payload has been captured yet.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// NOTE: deliberately does NOT import decode.ts. decode.ts imports lz-string,
// whose package has no clean ESM named exports under plain Node (fine under
// Vite's bundler) -- the same gotcha smoke-test-importer.ts works around.
// decode.ts's scl branch is replicated below instead, and kept in sync by
// hand; `npm run build` proves the real file compiles.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LZString = require("lz-string") as typeof import("lz-string");

import { parseScl } from "../src/renderer/src/importer/formats/scl";
import { unshortenPuzzleZipper } from "../src/renderer/src/importer/formats/puzzleZipper";
import type {
  CageConstraint,
  ExtraRegionConstraint,
  ThermoConstraint,
  UnsupportedConstraint,
} from "../src/renderer/src/model/types";

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
}

/** Mirrors decode.ts's scl/ctc branch: decompress, strict JSON first, un-shorten only as fallback. */
function decodeSclLikeDecodeTs(payload: string): unknown {
  const trimmed = payload.trim();
  const prefix = ["ctc", "scl"].find((p) => trimmed.startsWith(p));
  const body = prefix ? trimmed.slice(prefix.length) : trimmed;
  const decompressed = LZString.decompressFromBase64(decodeURIComponent(body).replace(/ /g, "+"));
  if (!decompressed) throw new Error("decompression failed");
  try {
    return JSON.parse(decompressed);
  } catch {
    return unshortenPuzzleZipper(decompressed);
  }
}

// ---------------------------------------------------------------------------
// Case 1: the real captured payload.
// ---------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const realPayload = readFileSync(join(here, "fixtures", "scl-70njbfg1zs.txt"), "utf8").trim();

const realJson = decodeSclLikeDecodeTs(realPayload) as Record<string, unknown>;
check("[real] scl payload decompresses with plain lz-string (same codec as fpuz)", typeof realJson === "object" && realJson !== null);
check("[real] decompressed payload is already long-form JSON (no PuzzleZipper minification)", Array.isArray(realJson.cells));

const real = parseScl(realJson);
check("[real] 9x9 grid", real.size === 9);
check("[real] title from metadata", real.title === "Sort by Size");
check("[real] author from metadata", real.author === "Marty Sears");
check("[real] ruleset text captured (needed by the UI -- the shapes have no machine-readable meaning)", (real.ruleset ?? "").includes("ISOFILL"));
check("[real] solution parsed to 9 rows", real.solution?.length === 9);
check("[real] solution first row matches the payload's own digits", JSON.stringify(real.solution?.[0]) === JSON.stringify([8, 8, 8, 9, 9, 9, 9, 6, 1]));
check(
  "[real] this puzzle genuinely has NO givens (that's why the board looks blank -- it's correct)",
  real.grid.every((row) => row.every((cell) => cell.given === undefined)),
);

// The whole point of the decorations channel: this puzzle's content.
check("[real] decorations extracted", !!real.decorations);
check("[real] 47 decoration lines", real.decorations?.lines.length === 47);
check("[real] 23 decoration overlays", real.decorations?.overlays.length === 23);
check(
  "[real] line thickness normalized to a fraction of a cell (22.4/64 = 0.35, a thermo-width line)",
  Math.abs((real.decorations!.lines[0]!.thickness ?? 0) - 0.35) < 1e-9,
);
check("[real] line color preserved verbatim for faithful rendering", real.decorations!.lines[0]!.color === "#FFFFFF");
check(
  "[real] hairline region borders survive normalization (0.64/64 = 0.01)",
  real.decorations!.lines.some((l) => Math.abs((l.thickness ?? 0) - 0.01) < 1e-9),
);
check(
  "[real] overlay geometry preserved (rounded bulb, 0.76-cell wide)",
  real.decorations!.overlays.some((o) => o.rounded === true && Math.abs(o.width - 0.76) < 1e-9),
);

// Warning-noise regressions: these were all reported as "unsupported" before.
const unsupportedKeys = new Set(
  real.constraints.filter((c): c is UnsupportedConstraint => c.type === "unsupported").map((c) => c.sourceKey),
);
check('[real] "id" is no longer reported as an unsupported constraint (it is plumbing, not content)', !unsupportedKeys.has("id"));
check('[real] "lines" is no longer reported as unsupported (now drawn as decorations)', !unsupportedKeys.has("lines"));
check('[real] "overlays" is no longer reported as unsupported (now drawn as decorations)', !unsupportedKeys.has("overlays"));
check('[real] empty "regions" array is not reported (the puzzle has none to skip)', !unsupportedKeys.has("regions"));
check('[real] empty "cages" array is not reported', !unsupportedKeys.has("cages"));
check("[real] nothing at all is reported as unsupported for this puzzle", unsupportedKeys.size === 0);

// ---------------------------------------------------------------------------
// Case 2: a second REAL payload -- minified, cage-carried metadata, thermos.
// ---------------------------------------------------------------------------
// futilytnf4, "Number 2" by Tom Fry: a penpa-converted Slow-Thermo sudoku.
// Everything it exercises was broken when it was first imported (2026-08-30):
// it is PuzzleZipper-minified (the fallback path had never seen a real
// payload), its title/author/rules/solution live in cell-less CAGES rather
// than a `metadata` object, and its thermometer bulbs live in `underlays`,
// which the importer ignored entirely.
const fryPayload = readFileSync(join(here, "fixtures", "scl-futilytnf4.txt"), "utf8").trim();
const fryDecompressed = LZString.decompressFromBase64(fryPayload.slice(3))!;
let fryIsStrictJson = true;
try {
  JSON.parse(fryDecompressed);
} catch {
  fryIsStrictJson = false;
}
check("[fry] a REAL payload does take the PuzzleZipper-minified path (not just synthetic ones)", !fryIsStrictJson);

const fry = parseScl(decodeSclLikeDecodeTs(fryPayload));
check("[fry] 9x9 grid", fry.size === 9);
check("[fry] title read from a cell-less cage, not from `metadata`", fry.title === "Number 2");
check("[fry] author read from a cell-less cage", fry.author === "Tom Fry");
check("[fry] rules text read from a cell-less cage", (fry.ruleset ?? "").startsWith("Slow-Thermo Sudoku"));
check("[fry] solution read from a cell-less cage and parsed to 9 rows", fry.solution?.length === 9);
check(
  "[fry] solution first row matches the payload",
  JSON.stringify(fry.solution?.[0]) === JSON.stringify([1, 2, 3, 5, 6, 7, 8, 9, 4]),
);
check(
  "[fry] no givens (correct for this puzzle -- it is solved from the thermometers alone)",
  fry.grid.every((row) => row.every((cell) => cell.given === undefined)),
);
check("[fry] metadata cages are NOT mistaken for killer cages", !fry.constraints.some((c) => c.type === "cage"));

const fryThermos = fry.constraints.filter((c): c is ThermoConstraint => c.type === "thermo");
check("[fry] all 12 thermometers recovered from role:'thermobulb' + line geometry", fryThermos.length === 12);
check('[fry] "slow thermo" detected from the rules text, so repeats are allowed', fryThermos.every((t) => t.slow === true));
check(
  "[fry] way-points are expanded into every cell crossed, not just the corners",
  // wayPoints [[8.5,2.5],[8.5,8.5]] is one straight run of SEVEN cells, R9C3..R9C9.
  fryThermos.some(
    (t) =>
      t.cells.length === 7 &&
      JSON.stringify(t.cells[0]) === JSON.stringify({ row: 9, col: 3 }) &&
      JSON.stringify(t.cells[6]) === JSON.stringify({ row: 9, col: 9 }),
  ),
);
check(
  "[fry] every thermo starts at its bulb (bulb center == first way-point)",
  fryThermos.every((t) => t.cells.length >= 2),
);
check(
  "[fry] every shape on this board is accounted for, so no unexplained-marking note is shown",
  // 12 lines + 12 bulbs became thermo constraints; the 13th underlay is
  // SudokuPad's own transparent board-bounds rect, which is plumbing.
  fry.decorations === undefined,
);
check(
  "[fry] the solver is told the thermos were inferred, and how they were read",
  (fry.importNotes ?? []).some((n) => n.includes("thermometer") && n.includes("slow")),
);
const fryUnsupported = new Set(
  fry.constraints.filter((c): c is UnsupportedConstraint => c.type === "unsupported").map((c) => c.sourceKey),
);
check('[fry] "underlays" is no longer reported as an unsupported key', !fryUnsupported.has("underlays"));
check(
  '[fry] "regions" that merely restate the default 3x3 boxes are not reported as unsupported',
  !fryUnsupported.has("regions"),
);
check("[fry] nothing is reported as unsupported for this puzzle", fryUnsupported.size === 0);

// ---------------------------------------------------------------------------
// Case 3: synthetic PuzzleZipper-minified payload (the shortened-key table).
// ---------------------------------------------------------------------------
const minified =
  '{ce:[[{v:1,given:t},{}],[{},{v:2,given:t}]],' +
  'ca:[{ce:[[0,0],[0,1]],v:"3",c1:ABCDEF},{ce:[[1,0],[1,1]],unique:t}],' +
  'u:[{ct:[0.5,0.5],w:0.8,h:0.8,r:t,c2:ABCDEF}],' +
  'global:["antiknight","some-future-rule"],' +
  'metadata:{t:"Two by Two",rules:"Test rules.",solution:"1234"}}';
const minifiedPayload = "scl" + LZString.compressToBase64(minified);

const minModel = parseScl(decodeSclLikeDecodeTs(minifiedPayload));
check("[minified] falls back to the un-shortening path and parses", minModel.size === 2);
check("[minified] shortened keys un-shortened (givens found)", minModel.grid[0]![0]!.given === 1 && minModel.grid[1]![1]!.given === 2);
check("[minified] title un-shortened from t -> title", minModel.title === "Two by Two");

const cage = minModel.constraints.find((c): c is CageConstraint => c.type === "cage");
check("[minified] killer cage parsed with sum 3", cage?.sum === 3 && cage?.cells.length === 2);
check(
  "[minified] cage cells converted to 1-indexed CellRefs",
  JSON.stringify(cage?.cells) === JSON.stringify([{ row: 1, col: 1 }, { row: 1, col: 2 }]),
);
const extraRegion = minModel.constraints.find((c): c is ExtraRegionConstraint => c.type === "extraRegion");
check("[minified] sumless unique:true cage becomes an extraRegion", extraRegion?.cells.length === 2);
check("[minified] antiknight recognized as a global rule", minModel.globalRules.antiKnight === true);
check(
  "[minified] an underlay that isn't a thermo bulb is kept and drawn (u -> decorations.underlays)",
  minModel.decorations?.underlays.length === 1 && minModel.decorations.underlays[0]!.rounded === true,
);
const unmatched = minModel.constraints.find(
  (c): c is UnsupportedConstraint => c.type === "unsupported" && c.sourceKey === "global",
);
check(
  "[minified] unrecognized global-rule string kept as unsupported (not silently dropped)",
  Array.isArray(unmatched?.raw) && (unmatched!.raw as unknown[]).includes("some-future-rule"),
);

// ---------------------------------------------------------------------------
// Case 3b: arrows, overlay text, and the jigsaw guard
// (audit-2026-08-31 issues 1-3). All three were silent losses: `arrows` was
// never parsed or drawn, overlay `text` was dropped so every cage sum and
// X/V letter rendered as an empty shape, and an irregular `regions` array
// was reported but didn't actually stop the box checks.
// ---------------------------------------------------------------------------
const withArrows = parseScl({
  cells: [[{}, {}], [{}, {}]],
  cellSize: 64,
  arrows: [
    { wayPoints: [[0.5, 0.5], [0.5, 1.5]], color: "#000000", thickness: 6.4, headLength: 19.2 },
    { wayPoints: [[1.5, 0.5]] }, // single point: nothing drawable
  ],
  overlays: [
    { center: [0, 0], width: 0.25, height: 0.25, text: "12", fontSize: 32 },
    { center: [1, 1], text: "X" }, // a bare label, no width/height at all
  ],
});
check("[arrows] the arrows array is parsed into decorations", withArrows.decorations?.arrows.length === 1);
check(
  "[arrows] thickness is normalized to a fraction of one cell, like lines",
  Math.abs((withArrows.decorations!.arrows[0]!.thickness ?? 0) - 0.1) < 1e-9,
);
check(
  "[arrows] headLength given in cellSize units is normalized to 0.3 of a cell",
  Math.abs((withArrows.decorations!.arrows[0]!.headLength ?? 0) - 0.3) < 1e-9,
);
check(
  '[arrows] "arrows" is no longer reported as an unsupported constraint',
  !withArrows.constraints.some((c) => c.type === "unsupported" && c.sourceKey === "arrows"),
);
check(
  "[text] overlay text is kept",
  withArrows.decorations!.overlays.map((o) => o.text ?? "").join(",") === "12,X",
);
check(
  "[text] fontSize in cellSize units is normalized to a fraction of one cell",
  Math.abs((withArrows.decorations!.overlays[0]!.fontSize ?? 0) - 0.5) < 1e-9,
);
check(
  "[text] a text overlay with no width/height survives instead of being dropped",
  withArrows.decorations!.overlays.length === 2 && withArrows.decorations!.overlays[1]!.width === 0,
);

// The same two fields written as plain cell fractions must read the same way
// -- payloads disagree on the scale, so scl.ts normalizes by magnitude.
const fractionScale = parseScl({
  cells: [[{}, {}], [{}, {}]],
  arrows: [{ wayPoints: [[0.5, 0.5], [0.5, 1.5]], headLength: 0.3 }],
  overlays: [{ center: [0, 0], width: 0.25, height: 0.25, text: "12", fontSize: 0.5 }],
});
check(
  "[arrows/text] values already given as cell fractions are left alone",
  Math.abs((fractionScale.decorations!.arrows[0]!.headLength ?? 0) - 0.3) < 1e-9 &&
    Math.abs((fractionScale.decorations!.overlays[0]!.fontSize ?? 0) - 0.5) < 1e-9,
);

const jigsawScl = parseScl({
  cells: [[{}, {}, {}, {}], [{}, {}, {}, {}], [{}, {}, {}, {}], [{}, {}, {}, {}]],
  regions: [
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 3], [1, 1], [1, 2], [1, 3]],
    [[2, 0], [2, 1], [3, 0], [3, 1]],
    [[2, 2], [2, 3], [3, 2], [3, 3]],
  ],
});
check("[jigsaw] an irregular regions array sets irregularRegions", jigsawScl.irregularRegions === true);
check(
  "[jigsaw] the solver is told region checking is off, not just that regions are unsupported",
  (jigsawScl.importNotes ?? []).some((n) => n.includes("jigsaw") && n.includes("rows and columns only")),
);
check(
  "[jigsaw] regions restating the default boxes still don't set the flag",
  parseScl({
    cells: [[{}, {}, {}, {}], [{}, {}, {}, {}], [{}, {}, {}, {}], [{}, {}, {}, {}]],
    regions: [
      [[0, 0], [0, 1], [1, 0], [1, 1]],
      [[0, 2], [0, 3], [1, 2], [1, 3]],
      [[2, 0], [2, 1], [3, 0], [3, 1]],
      [[2, 2], [2, 3], [3, 2], [3, 3]],
    ],
  }).irregularRegions === undefined,
);
check(
  "[jigsaw] an empty regions array is not an irregular layout",
  parseScl({ cells: [[{}, {}], [{}, {}]], regions: [] }).irregularRegions === undefined,
);

// ---------------------------------------------------------------------------
// Case 4: the un-shortening pass must never touch already-valid JSON.
// ---------------------------------------------------------------------------
// Its color-repair regex can't tell an unquoted color from an ordinary
// 6-digit number, so running it on valid JSON would corrupt `123456` into
// "#123456". decode.ts gates it behind a failed JSON.parse for exactly this
// reason; this asserts the hazard is real so the gate never gets "simplified"
// away by a future change.
const hazard = unshortenPuzzleZipper('{"value":123456}') as Record<string, unknown>;
check(
  "[hazard] un-shortening a 6-digit number DOES corrupt it -- proving why decode.ts tries strict JSON first",
  hazard.value === "#123456",
);

console.log(failed ? "\nSMOKE TEST FAILED" : "\nAll scl smoke tests passed.");
process.exit(failed ? 1 : 0);
