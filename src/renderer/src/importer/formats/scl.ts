import {
  boxDims,
  createEmptyGrid,
  type CellRef,
  type Constraint,
  type PuzzleModel,
  type ThermoConstraint,
  type SclDecorationArrow,
  type SclDecorationLine,
  type SclDecorationOverlay,
  type FogLight,
} from "../../model/types";
import { fogImportNotes } from "../../state/fog";

/**
 * SudokuPad's native "scl"/"ctc" format.
 *
 * By the time a payload reaches this function, decode.ts has already
 * decompressed it (plain lz-string -- the same codec as fpuz, confirmed
 * against a real payload; see design.md 7.6) and parsed it to JSON. `raw`
 * here is a plain JS value with long-form keys, the same relationship
 * parseFPuzzles has to JSON.parse's output.
 *
 * CONFIRMED AGAINST A REAL PAYLOAD (puzzle 70njbfg1zs, "Sort by Size" by
 * Marty Sears, decoded 2026-08-30): scl's `lines`/`overlays` arrays are a
 * *rendering* description, not a semantically-tagged constraint list. That
 * puzzle's 47 lines and 23 overlays carry only geometry plus style --
 * way-points, a color, a thickness; or a center, a size, an angle. Nothing
 * anywhere says "this line is a thermometer". The thermometers in it are
 * white 0.35-cell-thick lines with grey circles at the bulb ends; its
 * entropic lines are peach; its region borders are black hairlines. The
 * distinction is *visual convention only*.
 *
 * So this parser splits scl's content two ways:
 *
 *  1. Things whose meaning is unambiguous in the data become real,
 *     validated `Constraint`s: the grid and its givens (`cells`), killer
 *     cages and extra regions (`cages` -- `value`/`unique` are semantic
 *     fields, not visual ones), and whole-grid rules (`global`).
 *  2. `lines` and `overlays` become `model.decorations` -- drawn faithfully
 *     by the renderer but never validated. This app is a solving
 *     *assistant*, so showing the user the real picture and letting them
 *     apply the rule themselves is genuinely useful, and it works for every
 *     scl puzzle regardless of which exotic variant it uses (that real
 *     puzzle is an "ISOFILL" puzzle, a variant this app has no concept of
 *     at all -- yet its board is still fully legible once drawn).
 *
 * Deliberately NOT done: inferring constraint types from visual style
 * (thickness/color/bulb-shape heuristics). That would let the app claim it
 * validates a rule it might have mis-identified, which is worse than
 * honestly not validating it -- consistent with design.md 1.2's "skip what
 * you don't recognize, never guess" convention that fpuzzles.ts follows.
 *
 * ONE EXCEPTION, added 2026-08-30 after puzzle futilytnf4: thermometers.
 * SudokuPad tags the bulb explicitly (`underlays: [{role: "thermobulb",
 * ...}]`) and puts it exactly on one end-point of its line, so recognizing
 * a thermo is a declared-role plus exact-coordinate match, not a look-alike
 * guess. See inferThermometers. The one thing the geometry genuinely can't
 * say is whether repeats are allowed ("slow" thermos look identical), so
 * that reading comes from the rules text and is stated to the user in
 * `importNotes` rather than assumed silently.
 */

function asNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * scl's coordinate system, confirmed from the real payload: [row, col] in
 * grid units where an integer lands on a cell *boundary* and X.5 is a cell
 * *center* (a 9x9 puzzle's cell centers run 0.5 .. 8.5). Cell refs in
 * `cages`, by contrast, are plain 0-indexed integer [row, col] pairs.
 * Converted here to this app's 1-indexed CellRef convention.
 */
function rcToCellRef(pair: unknown): CellRef {
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw new Error("Expected a [row, col] coordinate pair");
  }
  const row = Number(pair[0]);
  const col = Number(pair[1]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    throw new Error("Non-numeric coordinate in [row, col] pair");
  }
  return { row: row + 1, col: col + 1 };
}

function parseRCs(v: unknown): CellRef[] {
  if (!Array.isArray(v)) throw new Error("Expected an array of [row, col] pairs");
  return v.map(rcToCellRef);
}

/** A raw [row, col] point kept in scl's own units, for decorations (which are drawn, not validated, so they keep sub-cell precision instead of snapping to a CellRef). */
function rawPoint(pair: unknown): [number, number] | undefined {
  if (!Array.isArray(pair) || pair.length !== 2) return undefined;
  const row = Number(pair[0]);
  const col = Number(pair[1]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return undefined;
  return [row, col];
}

/**
 * SudokuPad expresses stroke widths in the puzzle's own `cellSize` units,
 * while overlay `width`/`height` are already fractions of a cell. Dividing
 * thickness by cellSize here means the renderer only ever deals in
 * "fraction of one cell" and never has to know the source puzzle's scale.
 *
 * Default 64 is derived, not guessed: the real payload omits `cellSize`,
 * and every thickness in it resolves to a clean 2-decimal fraction against
 * 64 (22.4 -> 0.35 thermo, 9.6 -> 0.15 line, 0.64 -> 0.01 hairline,
 * 3.84 -> 0.06 border) but to messy values against any other base.
 */
const DEFAULT_SCL_CELL_SIZE = 64;

function parseDecorationLines(raw: unknown, cellSize: number): SclDecorationLine[] {
  if (!Array.isArray(raw)) return [];
  const out: SclDecorationLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const wayPoints = Array.isArray(it.wayPoints)
      ? (it.wayPoints.map(rawPoint).filter(Boolean) as Array<[number, number]>)
      : [];
    if (wayPoints.length < 2) continue; // nothing drawable
    const thickness = asNumber(it.thickness);
    out.push({
      wayPoints,
      color: typeof it.color === "string" ? it.color : undefined,
      thickness: thickness === undefined ? undefined : thickness / cellSize,
      fill: typeof it.fill === "string" ? it.fill : undefined,
    });
  }
  return out;
}

/**
 * Normalize a length field whose scale scl doesn't state consistently.
 *
 * One scl object mixes both scales already: an overlay's `width`/`height`
 * are fractions of a cell (0.76, 0.85 in the real payloads) while its
 * `thickness` is in the puzzle's own cellSize px units (3.84, 21, 22.4).
 * `fontSize` and an arrow's `headLength` are the two fields no payload
 * this project has on hand pins down, so they're read by magnitude: a
 * value too large to be a sane fraction of one cell is cellSize units and
 * gets divided; anything smaller already is a fraction.
 *
 * The two readings are far apart for every plausible real value -- a
 * 0.3-cell arrowhead is either 0.3 or ~19, a half-cell glyph either 0.5 or
 * ~32 -- so the split is unambiguous in practice, and being wrong only
 * mis-sizes a decoration rather than mis-stating a rule. Replace this with
 * a plain divide the moment a real arrow/text payload settles the question.
 */
function asCellFraction(v: unknown, cellSize: number): number | undefined {
  const n = asNumber(v);
  if (n === undefined) return undefined;
  return Math.abs(n) > 1.5 ? n / cellSize : n;
}

/**
 * scl's `arrows` array: the same way-point path as `lines`, drawn with an
 * arrowhead on the final way-point. It's a first-class key in SudokuPad's
 * own minifier table (`a` -> arrows, `hl` -> headLength; see
 * puzzleZipper.ts), but this parser never read it until 2026-08-31, so
 * every arrow-variant puzzle rendered with its arrows missing --
 * `arrows` merely got reported as an unsupported *constraint*, which is
 * both the wrong category and no help to someone trying to solve.
 *
 * Like lines and overlays these stay decorations, never constraints:
 * nothing in the payload says a given arrow means the arrow-sum rule
 * rather than, say, a direction marker for some bespoke variant.
 */
function parseDecorationArrows(raw: unknown, cellSize: number): SclDecorationArrow[] {
  if (!Array.isArray(raw)) return [];
  const out: SclDecorationArrow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const wayPoints = Array.isArray(it.wayPoints)
      ? (it.wayPoints.map(rawPoint).filter(Boolean) as Array<[number, number]>)
      : [];
    if (wayPoints.length < 2) continue; // nothing drawable
    const thickness = asNumber(it.thickness);
    out.push({
      wayPoints,
      color: typeof it.color === "string" ? it.color : undefined,
      thickness: thickness === undefined ? undefined : thickness / cellSize,
      headLength: asCellFraction(it.headLength, cellSize),
    });
  }
  return out;
}

function parseDecorationOverlays(raw: unknown, cellSize: number): SclDecorationOverlay[] {
  if (!Array.isArray(raw)) return [];
  const out: SclDecorationOverlay[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const center = rawPoint(it.center);
    if (!center) continue;
    const text = it.text === undefined || it.text === null ? undefined : String(it.text);
    const width = asNumber(it.width);
    const height = asNumber(it.height);
    // A shape needs a size to be drawable, but a *label* doesn't: SudokuPad
    // writes bare text overlays (cage sums, little-killer clues) with no
    // width/height at all, and the old size check dropped those outright.
    if ((width === undefined || height === undefined) && text === undefined) continue;
    const thickness = asNumber(it.thickness);
    out.push({
      center,
      width: width ?? 0,
      height: height ?? 0,
      angle: asNumber(it.angle),
      rounded: it.rounded === true,
      backgroundColor: typeof it.backgroundColor === "string" ? it.backgroundColor : undefined,
      borderColor: typeof it.borderColor === "string" ? it.borderColor : undefined,
      thickness: thickness === undefined ? undefined : thickness / cellSize,
      text: text === undefined || text === "" ? undefined : text,
      fontSize: asCellFraction(it.fontSize, cellSize),
      color: typeof it.color === "string" ? it.color : undefined,
    });
  }
  return out;
}

/**
 * True when a payload's `regions` array is just the ordinary box layout
 * written out explicitly (which penpa-converted puzzles always do).
 *
 * Jigsaw/irregular regions are a real gap (design.md 7.4) and stay reported
 * as unsupported, because ignoring them would silently mis-check the puzzle.
 * But most payloads carry `regions` purely as a restatement of the default
 * 3x3 boxes, and warning "regions unsupported" there tells the solver their
 * puzzle is missing something it isn't -- the same class of noise the
 * empty-array filter below was written to stop.
 */
function regionsAreDefaultBoxes(raw: unknown, size: number): boolean {
  if (!Array.isArray(raw) || raw.length !== size) return false;
  const { boxW, boxH } = boxDims(size);
  const seen = new Set<string>();
  for (const region of raw) {
    if (!Array.isArray(region) || region.length !== size) return false;
    const cells: Array<[number, number]> = [];
    for (const pair of region) {
      const point = rawPoint(pair);
      if (!point || !Number.isInteger(point[0]) || !Number.isInteger(point[1])) return false;
      cells.push(point);
    }
    // Every cell of a box shares one (row-band, col-band) pair.
    const band = `${Math.floor(cells[0]![0] / boxH)},${Math.floor(cells[0]![1] / boxW)}`;
    if (!cells.every(([r, c]) => `${Math.floor(r / boxH)},${Math.floor(c / boxW)}` === band)) return false;
    if (seen.has(band)) return false;
    seen.add(band);
  }
  return seen.size === size;
}

/**
 * SudokuPad stores a puzzle's title, author, rules text and solution as
 * *cell-less cages* whose `value` is a "key: value" string, NOT in a
 * `metadata` object:
 *
 *   cages: [{value: "title: Number 2"}, {value: "author: Tom Fry"},
 *           {value: "rules: Slow-Thermo Sudoku\n\n..."},
 *           {value: "solution: 12356789476..."},
 *           {value: "msgcorrect: Hip-hip-pooray!!!"}]
 *
 * Confirmed against puzzle futilytnf4 ("Number 2" by Tom Fry, 2026-08-30).
 * The first real payload this project examined (70njbfg1zs) happened to use
 * a `metadata` object instead, so the cage convention went unnoticed and the
 * cage loop -- which skips anything without a `cells` array -- silently
 * dropped all five values: no title, no author, no rules panel, and no
 * solution to check against. Both spellings are now read, `metadata` first.
 */
function parseCageMetadata(cages: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(cages)) return out;
  for (const item of cages) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    // Only cell-less cages: a cage with cells is a real killer cage/region.
    if (Array.isArray(it.cells)) continue;
    if (typeof it.value !== "string") continue;
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/.exec(it.value);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    if (out[key] === undefined) out[key] = match[2]!.trim();
  }
  return out;
}

/**
 * A cell reference in one of scl's fog lists.
 *
 * Which spelling those lists use isn't settled from a real payload yet:
 * scl's own `cages` use 0-indexed [row, col] pairs, while the f-puzzles
 * side of the same feature uses "R1C1" strings, and SudokuPad's converters
 * pass fog lists through the same cell parser as everything else. Both are
 * accepted here rather than guessing one, since the two are trivially
 * distinguishable and getting it wrong would fog the wrong cells (an
 * off-by-one on fog is not a cosmetic bug -- it hides a different part of
 * the puzzle). Anything unrecognizable returns undefined and is skipped.
 */
function parseFogCellRef(v: unknown): CellRef | undefined {
  if (Array.isArray(v) && v.length === 2) {
    const row = Number(v[0]);
    const col = Number(v[1]);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return undefined;
    return { row: row + 1, col: col + 1 };
  }
  if (typeof v === "string") {
    const m = /^\s*R(\d+)C(\d+)\s*$/i.exec(v);
    if (!m) return undefined;
    return { row: Number(m[1]), col: Number(m[2]) };
  }
  return undefined;
}

/**
 * SudokuPad emits a full-grid `{class: "board-position"}` underlay -- a
 * transparent rect marking the board's own bounds. It's layout plumbing,
 * not a puzzle marking, so keeping it would make the board tell the solver
 * it has an unexplained shape on it when it has none.
 */
function isBoardPositionRect(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  return (item as Record<string, unknown>).class === "board-position";
}

/** A thermometer's cells run bulb -> tip; scl lines record only the *corners* of the path, so the cells between two way-points are implied. */
function expandSegment(from: [number, number], to: [number, number]): Array<[number, number]> | undefined {
  const dr = to[0] - from[0];
  const dc = to[1] - from[1];
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return [];
  const stepR = dr / steps;
  const stepC = dc / steps;
  // Only orthogonal or perfectly diagonal runs are unambiguous; anything
  // else isn't a cell path and shouldn't be promoted to a constraint.
  if (!Number.isInteger(stepR) || !Number.isInteger(stepC)) return undefined;
  const points: Array<[number, number]> = [];
  for (let i = 1; i <= steps; i++) points.push([from[0] + stepR * i, from[1] + stepC * i]);
  return points;
}

/** scl cell *centers* are half-integers (0.5 .. size-0.5). Convert to a 1-indexed CellRef, or undefined if the point isn't a cell center inside the grid. */
function centerToCellRef(point: [number, number], size: number): CellRef | undefined {
  const [r, c] = point;
  if (Math.abs(r - Math.floor(r) - 0.5) > 1e-9 || Math.abs(c - Math.floor(c) - 0.5) > 1e-9) return undefined;
  const row = Math.floor(r);
  const col = Math.floor(c);
  if (row < 0 || col < 0 || row >= size || col >= size) return undefined;
  return { row: row + 1, col: col + 1 };
}

const SLOW_THERMO_PATTERNS = [
  /\bslow[-\s]?thermo/i,
  /must\s*(?:n['’]?t|\s+not)\s+decrease/i,
  /\bnon-?decreasing\b/i,
  /\bincrease\s+or\s+stay\s+the\s+same\b/i,
];

/** True when the puzzle's prose says its thermometers allow repeats ("slow thermo"). */
function rulesSaySlowThermo(ruleset: string | undefined): boolean {
  if (!ruleset) return false;
  return SLOW_THERMO_PATTERNS.some((re) => re.test(ruleset));
}

export interface InferredThermos {
  constraints: ThermoConstraint[];
  /** The raw `lines`/`underlays` entries consumed, so the caller can keep them out of `decorations` and avoid drawing each thermo twice. */
  consumed: Set<unknown>;
}

/**
 * Promote drawn thermometers to real, validated constraints.
 *
 * This is the ONE exception to this file's "never infer a constraint from
 * how it looks" rule, and it earns the exception by not being a visual
 * guess: SudokuPad tags the bulb explicitly as `{role: "thermobulb"}` in
 * `underlays`, and a bulb's center coincides with the first (or last)
 * way-point of the line it belongs to. That's a declared role plus an exact
 * coordinate match -- no thickness/color heuristics involved. A line with no
 * bulb at either end, or whose way-points aren't a clean cell path, is left
 * alone as an unvalidated decoration exactly as before.
 *
 * Branching thermometers share one bulb: the payload repeats the bulb
 * underlay once per branch, and each branch line becomes its own thermo,
 * which is the correct reading of the rule.
 */
function inferThermometers(
  rawLines: unknown[],
  rawUnderlays: unknown[],
  size: number,
  slow: boolean,
): InferredThermos {
  const consumed = new Set<unknown>();
  const constraints: ThermoConstraint[] = [];

  const bulbs: Array<{ item: unknown; center: [number, number] }> = [];
  for (const item of rawUnderlays) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (it.role !== "thermobulb") continue;
    const center = rawPoint(it.center);
    if (center) bulbs.push({ item, center });
  }
  if (bulbs.length === 0) return { constraints, consumed };

  const samePoint = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

  for (const item of rawLines) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (!Array.isArray(it.wayPoints)) continue;
    const wayPoints = it.wayPoints.map(rawPoint).filter(Boolean) as Array<[number, number]>;
    if (wayPoints.length < 2 || wayPoints.length !== it.wayPoints.length) continue;

    const headIsBulb = bulbs.some((b) => samePoint(b.center, wayPoints[0]!));
    const tailIsBulb = bulbs.some((b) => samePoint(b.center, wayPoints[wayPoints.length - 1]!));
    if (!headIsBulb && !tailIsBulb) continue;
    const ordered = headIsBulb ? wayPoints : [...wayPoints].reverse();

    // Expand corner way-points into the full run of cells they pass through.
    const path: Array<[number, number]> = [ordered[0]!];
    let usable = true;
    for (let i = 0; i < ordered.length - 1; i++) {
      const segment = expandSegment(ordered[i]!, ordered[i + 1]!);
      if (!segment) {
        usable = false;
        break;
      }
      path.push(...segment);
    }
    if (!usable) continue;

    const cells: CellRef[] = [];
    for (const point of path) {
      const ref = centerToCellRef(point, size);
      if (!ref) {
        usable = false;
        break;
      }
      cells.push(ref);
    }
    if (!usable || cells.length < 2) continue;

    constraints.push(slow ? { type: "thermo", cells, slow: true } : { type: "thermo", cells });
    consumed.add(item);
    const bulbEnd = ordered[0]!;
    for (const bulb of bulbs) if (samePoint(bulb.center, bulbEnd)) consumed.add(bulb.item);
  }

  return { constraints, consumed };
}

/**
 * Whole-grid rule names scl's `global` array is believed to use, guessed
 * from f-puzzles' own vocabulary for the same rules since the one real
 * payload examined so far has no `global` array to confirm spelling
 * against. Anything in `global` that matches none of these is kept as raw
 * "unsupported" data rather than dropped, so a mismatch is visible and
 * debuggable rather than silent.
 */
const GLOBAL_RULE_ALIASES: Array<{
  key: keyof PuzzleModel["globalRules"];
  aliases: string[];
}> = [
  { key: "antiKnight", aliases: ["antiknight", "anti-knight"] },
  { key: "antiKing", aliases: ["antiking", "anti-king"] },
  { key: "disjointGroups", aliases: ["disjointgroups", "disjoint groups", "disjoint"] },
  { key: "diagonalPositive", aliases: ["diagonal+", "diagonalpos", "positivediagonal", "diagonalup"] },
  { key: "diagonalNegative", aliases: ["diagonal-", "diagonalneg", "negativediagonal", "diagonaldown"] },
  { key: "nonConsecutive", aliases: ["nonconsecutive", "non-consecutive"] },
];

/**
 * Keys that are fully accounted for and must never be reported to the user
 * as "unsupported". `id`/`settings`/`cellSize`/`source` are plumbing, not
 * puzzle content -- reporting them was pure noise. `lines`/`overlays` are
 * now rendered as decorations.
 */
const HANDLED_KEYS = new Set([
  "cells",
  "cages",
  "global",
  "metadata",
  "lines",
  "overlays",
  "underlays",
  "arrows",
  "id",
  "cellSize",
  "settings",
  "source",
  "fogofwar",
  "foglight",
]);

export function parseScl(raw: unknown): PuzzleModel {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("scl/ctc payload did not decode to an object");
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.cells)) {
    throw new Error('scl/ctc payload has no "cells" grid');
  }
  const rows = obj.cells as unknown[];
  const size = rows.length;
  const grid = createEmptyGrid(size);

  rows.forEach((row, r) => {
    if (!Array.isArray(row)) return;
    row.forEach((cellData, c) => {
      if (c >= size) return;
      const cd = cellData as Record<string, unknown> | null;
      if (!cd || typeof cd !== "object") return;
      const v = asNumber(cd.value);
      if (v === undefined) return;
      if (cd.given === true) grid[r]![c]!.given = v;
      else grid[r]![c]!.value = v;
    });
  });

  const constraints: Constraint[] = [];
  const globalRules: PuzzleModel["globalRules"] = {};

  const pushUnsupported = (key: string, value: unknown) => {
    constraints.push({ type: "unsupported", sourceKey: key, raw: value });
  };

  const tryParse = (key: string, fn: () => void) => {
    try {
      fn();
    } catch {
      pushUnsupported(key, obj[key]);
    }
  };

  // Fog of war. scl carries it two ways and a puzzle may use either:
  // top-level `fogofwar`/`foglight` lists, or -- more commonly, since
  // SudokuPad routes most puzzle metadata through cages -- a cage whose
  // `value` is the literal string "fow" or "foglight". A "fow" cell lights
  // the 3x3 around itself; a "foglight" cell lights only itself.
  // Confirmed against sudocle's fpuzzlesconverter.ts/ctcpuzzleconverter.ts;
  // no real fog payload has been read yet (see state/fog.ts's TODO).
  let fogLights: FogLight[] | undefined;
  const addFogCells = (cells: unknown, size: 1 | 3) => {
    fogLights ??= [];
    if (!Array.isArray(cells)) return;
    for (const raw of cells) {
      const cell = parseFogCellRef(raw);
      if (cell) fogLights.push({ cell, size });
    }
  };
  if (Array.isArray(obj.fogofwar)) addFogCells(obj.fogofwar, 3);
  if (Array.isArray(obj.foglight)) addFogCells(obj.foglight, 1);

  if (Array.isArray(obj.cages)) {
    tryParse("cages", () => {
      for (const item of obj.cages as unknown[]) {
        const it = item as Record<string, unknown>;
        if (!it || typeof it !== "object" || !Array.isArray(it.cells)) continue;
        // A fog cage is not a killer cage: its `value` is a keyword, not a
        // sum, so it has to be taken out of the running before the cage
        // parsing below reads `value`/`unique`.
        const keyword = typeof it.value === "string" ? it.value.trim().toLowerCase() : "";
        if (keyword === "fow" || keyword === "foglight") {
          addFogCells(it.cells, keyword === "fow" ? 3 : 1);
          continue;
        }
        const cells = parseRCs(it.cells);
        const sum = asNumber(it.value);
        if (sum !== undefined) {
          constraints.push({ type: "cage", cells, sum });
        } else if (it.unique === true) {
          // A cage with no sum but an explicit uniqueness rule is an "extra region".
          constraints.push({ type: "extraRegion", cells });
        }
        // Otherwise: a decorative cage outline (no sum, not marked unique) --
        // e.g. penpa-to-scl emits a `{cells, unique: false, hidden: true}`
        // bounding box for its own layout purposes. Nothing to validate.
      }
    });
  }

  if (Array.isArray(obj.global)) {
    const unmatched: string[] = [];
    for (const entry of obj.global as unknown[]) {
      const normalized = String(entry).trim().toLowerCase();
      const match = GLOBAL_RULE_ALIASES.find((r) => r.aliases.includes(normalized));
      if (match) globalRules[match.key] = true;
      else unmatched.push(String(entry));
    }
    if (unmatched.length > 0) pushUnsupported("global", unmatched);
  }

  const metadata =
    obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : {};
  // Real SudokuPad puzzles put title/author/rules/solution in cell-less
  // cages, not in `metadata` -- see parseCageMetadata.
  const cageMeta = parseCageMetadata(obj.cages);
  const pickString = (key: string, ...extraKeys: string[]): string | undefined => {
    if (typeof metadata[key] === "string") return metadata[key] as string;
    for (const k of [key, ...extraKeys]) {
      if (typeof cageMeta[k] === "string") return cageMeta[k];
    }
    if (typeof obj[key] === "string") return obj[key] as string;
    return undefined;
  };

  const title = pickString("title");
  const author = pickString("author");
  const ruleset = pickString("rules", "ruleset");

  const cellSize = asNumber(obj.cellSize) ?? DEFAULT_SCL_CELL_SIZE;
  const rawLines = Array.isArray(obj.lines) ? (obj.lines as unknown[]) : [];
  const rawUnderlays = Array.isArray(obj.underlays) ? (obj.underlays as unknown[]) : [];

  // A `regions` array that isn't a restatement of the default boxes is a
  // jigsaw layout this app can't validate. It was already reported as
  // unsupported; `irregularRegions` is what actually stops the box checks
  // running against regions that aren't the puzzle's (see PuzzleModel).
  const regionsAreBoxes = regionsAreDefaultBoxes(obj.regions, size);
  const irregularRegions =
    Array.isArray(obj.regions) && (obj.regions as unknown[]).length > 0 && !regionsAreBoxes;

  // Thermometers are recoverable as real constraints because the bulb is
  // explicitly tagged (see inferThermometers). Whether they're *strict* or
  // *slow* thermos is only ever stated in prose, so that comes from the
  // rules text and is reported back to the solver in importNotes.
  const slowThermo = rulesSaySlowThermo(ruleset);
  const thermos = inferThermometers(rawLines, rawUnderlays, size, slowThermo);
  constraints.push(...thermos.constraints);

  const importNotes: string[] = [];
  if (irregularRegions) {
    importNotes.push(
      "This puzzle has irregular (jigsaw) regions. This app can't read that layout yet, so it is checking " +
        "rows and columns only — no region checking at all — rather than checking the ordinary boxes, which " +
        "are not this puzzle's regions. Box outlines are hidden for the same reason.",
    );
  }
  if (thermos.constraints.length > 0) {
    importNotes.push(
      `${thermos.constraints.length} thermometer${thermos.constraints.length === 1 ? "" : "s"} were read from the drawing and ARE being checked, as ` +
        (slowThermo
          ? `"slow" thermometers (values may repeat, they just can't decrease) — the rules text says so.`
          : `strict thermometers (values must increase). If this puzzle is a "slow" thermo variant, ignore those warnings.`),
    );
  }

  const decorationLines = parseDecorationLines(
    rawLines.filter((item) => !thermos.consumed.has(item)),
    cellSize,
  );
  const decorationOverlays = parseDecorationOverlays(obj.overlays, cellSize);
  const decorationArrows = parseDecorationArrows(obj.arrows, cellSize);
  const decorationUnderlays = parseDecorationOverlays(
    rawUnderlays.filter((item) => !thermos.consumed.has(item) && !isBoardPositionRect(item)),
    cellSize,
  );

  let solution: number[][] | undefined;
  const solutionStr = pickString("solution");
  if (solutionStr && solutionStr.length === size * size) {
    solution = [];
    let i = 0;
    for (let r = 0; r < size; r++) {
      const solutionRow: number[] = [];
      for (let c = 0; c < size; c++) {
        solutionRow.push(asNumber(solutionStr[i++]) ?? 0);
      }
      solution.push(solutionRow);
    }
  }

  // Report only keys that are both unhandled AND actually carry content.
  // An empty array means the puzzle simply doesn't use that feature -- the
  // earlier version flagged those anyway, which told the user a puzzle was
  // missing things it never had (e.g. "regions" on a puzzle whose `regions`
  // was `[]`).
  for (const key of Object.keys(obj)) {
    if (HANDLED_KEYS.has(key)) continue;
    if (key === "regions" && regionsAreBoxes) continue;
    const value = obj[key];
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) continue;
    pushUnsupported(key, value);
  }

  if (fogLights) importNotes.push(...fogImportNotes(solution !== undefined));

  return {
    size,
    title,
    author,
    ruleset,
    grid,
    constraints,
    globalRules,
    fog: fogLights ? { lights: fogLights } : undefined,
    irregularRegions: irregularRegions ? true : undefined,
    solution,
    importNotes: importNotes.length > 0 ? importNotes : undefined,
    decorations:
      decorationLines.length > 0 ||
      decorationOverlays.length > 0 ||
      decorationUnderlays.length > 0 ||
      decorationArrows.length > 0
        ? {
            lines: decorationLines,
            overlays: decorationOverlays,
            underlays: decorationUnderlays,
            arrows: decorationArrows,
          }
        : undefined,
  };
}
