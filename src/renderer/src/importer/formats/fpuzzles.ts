import {
  boxDims,
  createEmptyGrid,
  type CellRef,
  type Constraint,
  type FogLight,
  type PuzzleModel,
} from "../../model/types";
import { fogImportNotes } from "../../state/fog";

function parseCellRef(ref: string): CellRef {
  const m = /^R(\d+)C(\d+)$/i.exec(ref.trim());
  if (!m) throw new Error(`Not a cell reference: "${ref}"`);
  return { row: Number(m[1]), col: Number(m[2]) };
}

function parseCellRefs(refs: unknown): CellRef[] {
  if (!Array.isArray(refs)) throw new Error("Expected an array of cell refs");
  return refs.map((r) => parseCellRef(String(r)));
}

function asNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Little killer diagonal path: the clue cell sits just outside the grid
 * (e.g. row 0 or row size+1 in 1-indexed terms); the clue's diagonal runs
 * from the first in-grid cell in `direction` to the edge. Algorithm
 * confirmed against dclamage/SudokuSolver's LittleKillerConstraint.cs
 * (NextCell stepping from cellStart, which is the clue cell itself
 * advanced one step if the raw clue ref is already out of bounds -- true
 * for every real puzzle, since the clue always sits outside the grid).
 */
const LITTLE_KILLER_DELTA: Record<string, [number, number]> = {
  UR: [-1, 1],
  UL: [-1, -1],
  DR: [1, 1],
  DL: [1, -1],
};

function littleKillerPath(clue: CellRef, direction: string, size: number): CellRef[] {
  const delta = LITTLE_KILLER_DELTA[direction.toUpperCase()];
  if (!delta) throw new Error(`Unknown little killer direction: "${direction}"`);
  const [dr, dc] = delta;
  const inBounds = (r: number, c: number) => r >= 0 && r < size && c >= 0 && c < size;
  let r = clue.row - 1;
  let c = clue.col - 1;
  if (!inBounds(r, c)) {
    r += dr;
    c += dc;
  }
  const cells: CellRef[] = [];
  while (inBounds(r, c)) {
    cells.push({ row: r + 1, col: c + 1 });
    r += dr;
    c += dc;
  }
  if (cells.length === 0) throw new Error("Little killer diagonal never enters the grid");
  return cells;
}

/**
 * Sandwich sum clue: the clue cell sits outside the grid on exactly one
 * axis (row OR col out of [1, size]) -- whichever axis is out of range
 * tells you whether this is a row clue (fixed row, all columns) or a
 * column clue (fixed column, all rows). Confirmed against
 * SandwichConstraint.cs's isRow/isCol logic.
 */
function sandwichPath(clue: CellRef, size: number): CellRef[] {
  const rowOOB = clue.row < 1 || clue.row > size;
  const colOOB = clue.col < 1 || clue.col > size;
  if (rowOOB === colOOB) {
    throw new Error("Sandwich clue must be outside the grid on exactly one axis");
  }
  const cells: CellRef[] = [];
  if (rowOOB) {
    // Column clue: column is valid, sum runs down every row of that column.
    for (let r = 1; r <= size; r++) cells.push({ row: r, col: clue.col });
  } else {
    // Row clue: row is valid, sum runs across every column of that row.
    for (let c = 1; c <= size; c++) cells.push({ row: clue.row, col: c });
  }
  return cells;
}

/**
 * True when this payload declares an irregular (jigsaw) region layout.
 *
 * f-puzzles records regions as a per-cell `region` index on
 * `grid[r][c]` -- the same field dclamage/SolverFactory reads to build its
 * groups -- and an ordinary puzzle either omits it entirely or writes out
 * the index its default box already has. This parser previously never
 * looked at the field at all, so a jigsaw imported clean and was then
 * conflict-checked against 3x3 boxes that are not its regions, with no
 * warning anywhere (audit-2026-08-31 issue 1). scl.ts already guarded the
 * equivalent case via its own regionsAreDefaultBoxes.
 *
 * The comparison is deliberately *partition* equality, not index equality:
 * a puzzle that numbers its ordinary boxes in some other order is still an
 * ordinary puzzle, and flagging it would switch box-checking off on a
 * normal grid. So each region id's cell set must be exactly one default
 * box; anything else -- a partial `region` field, the wrong number of
 * groups, a group that straddles two boxes, or a grid size with no default
 * box layout to compare against -- reads as irregular, which is the safe
 * direction to be wrong in.
 */
function hasIrregularRegions(rawGrid: unknown, size: number): boolean {
  if (!Array.isArray(rawGrid)) return false;
  const groups = new Map<number, Array<[number, number]>>();
  let withRegion = 0;
  for (let r = 0; r < size; r++) {
    const row = (rawGrid as unknown[])[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < size; c++) {
      const cd = (row as unknown[])[c] as Record<string, unknown> | null | undefined;
      if (!cd || typeof cd !== "object") continue;
      const region = asNumber(cd.region);
      if (region === undefined) continue;
      withRegion++;
      groups.set(region, [...(groups.get(region) ?? []), [r, c]]);
    }
  }
  if (groups.size === 0) return false; // no region data at all: an ordinary puzzle
  const { boxW, boxH } = boxDims(size);
  if (boxW >= size) return true; // nothing to compare against, so we can't confirm it's ordinary
  if (withRegion !== size * size) return true; // partial region data isn't readable
  if (groups.size !== size) return true;
  const seen = new Set<string>();
  for (const cells of groups.values()) {
    if (cells.length !== size) return true;
    const band = `${Math.floor(cells[0]![0] / boxH)},${Math.floor(cells[0]![1] / boxW)}`;
    if (!cells.every(([r, c]) => `${Math.floor(r / boxH)},${Math.floor(c / boxW)}` === band)) return true;
    if (seen.has(band)) return true;
    seen.add(band);
  }
  return false;
}

const KNOWN_KEYS = new Set([
  "size", "title", "author", "ruleset", "grid", "solution",
  "killercage", "thermometer", "arrow", "ratio", "difference",
  "odd", "even", "antiknight", "antiking", "disjointgroups",
  "renban", "whispers", "palindrome", "betweenline",
  "littlekillersum", "xv", "sandwichsum", "extraregion",
  "clone", "quadruple", "minimum", "maximum",
  "diagonal+", "diagonal-", "nonconsecutive",
  "fogofwar", "foglight",
]);

/**
 * Keys that are f-puzzles' own editor/solver settings rather than puzzle
 * content. Reporting these as "unsupported constraint types" told the
 * solver the app wasn't enforcing rules the puzzle never had -- the same
 * noise bug scl.ts fixed on its side (design.md 7.6). Found by the real
 * fog fixture, which carries `disabledlogic: ["contradictions"]` and an
 * empty `truecandidatesoptions`.
 */
const PLUMBING_KEYS = new Set(["disabledlogic", "truecandidatesoptions", "highlightconflicts", "successmessage"]);

/**
 * Parse one already-JSON-decoded f-puzzles puzzle object into the app's
 * normalized PuzzleModel.
 *
 * Confirmed multiple ways (design.md sections 1.2, 6.4, and the Phase 5
 * variant-coverage pass): first against a real decoded SudokuPad puzzle,
 * and repeatedly by cross-checking field shapes against
 * dclamage/SudokuSolver's FPuzzlesBoard.cs (the JSON schema) and
 * SolverFactory.cs (how each field is turned into a solver constraint --
 * this is where defaults like "blank kropki value means 2 for ratio / 1
 * for difference" and "blank whisper value means floor((size+1)/2)" come
 * from). That source also confirms arrow.lines[i][0] is the circle cell
 * itself (the path's start), followed by the shaft cells, which is why
 * arrowCells below includes it.
 *
 * Still unimplemented (present in real puzzles but not parsed here -- kept
 * as raw "unsupported" data instead, per design.md 1.2's "a parser that
 * doesn't recognize a key should skip it, not error"): regionsumline,
 * rowindexer/columnindexer/boxindexer, xsum, skyscraper, entropicline,
 * modularline, nabner, doublearrow, zipperline, slowthermometer, and the
 * "negative" constraint variants (negative kropki/XV/nonconsecutive imply
 * a rule about *every* unmarked adjacent pair, which needs a different
 * validation shape than "check the marked pairs") -- see design.md section
 * 6.2/Phase 5 for the full list and why they're deferred. A "cage" key
 * also exists in real puzzles but is NOT a killercage alias --
 * dclamage's source shows it's a distinct, less common "digit root" style
 * constraint, so it's deliberately left unparsed here too.
 */
export function parseFPuzzles(raw: unknown): PuzzleModel {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("f-puzzles payload did not decode to a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const size = asNumber(obj.size) ?? 9;
  const grid = createEmptyGrid(size);

  if (Array.isArray(obj.grid)) {
    (obj.grid as unknown[]).forEach((row, r) => {
      if (!Array.isArray(row) || r >= size) return;
      row.forEach((cellData: unknown, c: number) => {
        if (c >= size) return;
        const cd = cellData as Record<string, unknown> | null;
        if (cd && typeof cd === "object" && cd.value !== undefined) {
          const v = asNumber(cd.value);
          if (v === undefined) return;
          if (cd.given) grid[r]![c]!.given = v;
          else grid[r]![c]!.value = v;
        }
      });
    });
  }

  const constraints: Constraint[] = [];
  const globalRules: PuzzleModel["globalRules"] = {};
  const importNotes: string[] = [];

  // Jigsaw guard -- see hasIrregularRegions. Reported to the user two ways:
  // as an `unsupported` marker (so the board's "not validated" line names
  // it) and as an import note saying plainly what is and isn't being
  // checked, because "region" on its own doesn't tell a solver that box
  // checking just went away.
  const irregularRegions = hasIrregularRegions(obj.grid, size);
  if (irregularRegions) {
    constraints.push({ type: "unsupported", sourceKey: "region", raw: undefined });
    importNotes.push(
      "This puzzle has irregular (jigsaw) regions. This app can't read that layout yet, so it is checking " +
        "rows and columns only — no region checking at all — rather than checking the ordinary boxes, which " +
        "are not this puzzle's regions. Box outlines are hidden for the same reason.",
    );
  }

  const pushUnsupported = (key: string) => {
    constraints.push({ type: "unsupported", sourceKey: key, raw: obj[key] });
  };

  const tryParse = (key: string, fn: () => void) => {
    try {
      fn();
    } catch {
      pushUnsupported(key);
    }
  };

  if (Array.isArray(obj.killercage)) {
    tryParse("killercage", () => {
      for (const item of obj.killercage as unknown[]) {
        const it = item as Record<string, unknown>;
        constraints.push({ type: "cage", cells: parseCellRefs(it.cells), sum: asNumber(it.value) });
      }
    });
  }

  if (Array.isArray(obj.thermometer)) {
    tryParse("thermometer", () => {
      for (const item of obj.thermometer as unknown[]) {
        const it = item as Record<string, unknown>;
        for (const line of (it.lines as unknown[] | undefined) ?? []) {
          constraints.push({ type: "thermo", cells: parseCellRefs(line) });
        }
      }
    });
  }

  if (Array.isArray(obj.arrow)) {
    tryParse("arrow", () => {
      for (const item of obj.arrow as unknown[]) {
        const it = item as Record<string, unknown>;
        const circleCells = parseCellRefs(it.cells ?? []);
        for (const line of (it.lines as unknown[] | undefined) ?? []) {
          constraints.push({ type: "arrow", circleCells, arrowCells: parseCellRefs(line) });
        }
      }
    });
  }

  if (Array.isArray(obj.ratio)) {
    tryParse("ratio", () => {
      for (const item of obj.ratio as unknown[]) {
        const it = item as Record<string, unknown>;
        const cells = parseCellRefs(it.cells);
        if (cells.length !== 2) throw new Error("kropki constraint needs exactly 2 cells");
        constraints.push({ type: "kropki", kind: "ratio", cells: [cells[0]!, cells[1]!], value: asNumber(it.value) ?? 2 });
      }
    });
  }

  if (Array.isArray(obj.difference)) {
    tryParse("difference", () => {
      for (const item of obj.difference as unknown[]) {
        const it = item as Record<string, unknown>;
        const cells = parseCellRefs(it.cells);
        if (cells.length !== 2) throw new Error("kropki constraint needs exactly 2 cells");
        constraints.push({ type: "kropki", kind: "difference", cells: [cells[0]!, cells[1]!], value: asNumber(it.value) ?? 1 });
      }
    });
  }

  if (Array.isArray(obj.odd)) {
    tryParse("odd", () => {
      for (const item of obj.odd as unknown[]) {
        const it = item as Record<string, unknown>;
        constraints.push({ type: "oddEven", kind: "odd", cell: parseCellRef(String(it.cell)) });
      }
    });
  }

  if (Array.isArray(obj.even)) {
    tryParse("even", () => {
      for (const item of obj.even as unknown[]) {
        const it = item as Record<string, unknown>;
        constraints.push({ type: "oddEven", kind: "even", cell: parseCellRef(String(it.cell)) });
      }
    });
  }

  const parseLineFamily = (key: string, kind: "renban" | "whisper" | "palindrome") => {
    if (!Array.isArray(obj[key])) return;
    tryParse(key, () => {
      for (const item of obj[key] as unknown[]) {
        const it = item as Record<string, unknown>;
        const minDifference = kind === "whisper" ? asNumber(it.value) ?? Math.floor((size + 1) / 2) : undefined;
        for (const line of (it.lines as unknown[] | undefined) ?? []) {
          constraints.push({ type: "line", kind, cells: parseCellRefs(line), minDifference });
        }
      }
    });
  };
  parseLineFamily("renban", "renban");
  parseLineFamily("whispers", "whisper");
  parseLineFamily("palindrome", "palindrome");

  if (Array.isArray(obj.betweenline)) {
    tryParse("betweenline", () => {
      for (const item of obj.betweenline as unknown[]) {
        const it = item as Record<string, unknown>;
        for (const line of (it.lines as unknown[] | undefined) ?? []) {
          const cells = parseCellRefs(line);
          if (cells.length < 3) throw new Error("between line needs at least 3 cells (2 bulbs + 1 interior)");
          constraints.push({ type: "betweenLine", cells });
        }
      }
    });
  }

  if (Array.isArray(obj.littlekillersum)) {
    tryParse("littlekillersum", () => {
      for (const item of obj.littlekillersum as unknown[]) {
        const it = item as Record<string, unknown>;
        const sum = asNumber(it.value);
        const direction = String(it.direction).toUpperCase();
        if (sum === undefined) throw new Error("little killer clue missing a sum");
        const clueCell = parseCellRef(String(it.cell));
        constraints.push({
          type: "littleKiller",
          clueCell,
          direction: direction as "UL" | "UR" | "DL" | "DR",
          cells: littleKillerPath(clueCell, direction, size),
          sum,
        });
      }
    });
  }

  if (Array.isArray(obj.xv)) {
    tryParse("xv", () => {
      for (const item of obj.xv as unknown[]) {
        const it = item as Record<string, unknown>;
        const cells = parseCellRefs(it.cells);
        if (cells.length !== 2) throw new Error("xv constraint needs exactly 2 cells");
        const rawKind = String(it.value ?? "").toUpperCase();
        const kind = rawKind === "X" ? "X" : rawKind === "V" ? "V" : undefined;
        if (!kind) throw new Error(`Unrecognized XV value: "${it.value}"`);
        constraints.push({ type: "xv", cells: [cells[0]!, cells[1]!], kind });
      }
    });
  }

  if (Array.isArray(obj.sandwichsum)) {
    tryParse("sandwichsum", () => {
      for (const item of obj.sandwichsum as unknown[]) {
        const it = item as Record<string, unknown>;
        const sum = asNumber(it.value);
        if (sum === undefined) continue; // FPuzzlesCell.AddConstraint skips blank/non-numeric values too
        const clueCell = parseCellRef(String(it.cell));
        constraints.push({ type: "sandwich", cells: sandwichPath(clueCell, size), clueCell, sum });
      }
    });
  }

  if (Array.isArray(obj.extraregion)) {
    tryParse("extraregion", () => {
      for (const item of obj.extraregion as unknown[]) {
        const it = item as Record<string, unknown>;
        constraints.push({ type: "extraRegion", cells: parseCellRefs(it.cells) });
      }
    });
  }

  if (Array.isArray(obj.clone)) {
    tryParse("clone", () => {
      for (const item of obj.clone as unknown[]) {
        const it = item as Record<string, unknown>;
        const cells = parseCellRefs(it.cells);
        const cloneCells = parseCellRefs(it.cloneCells);
        if (cells.length !== cloneCells.length) throw new Error("clone cells/cloneCells length mismatch");
        const pairs: Array<[CellRef, CellRef]> = [];
        for (let i = 0; i < cells.length; i++) {
          const a = cells[i]!;
          const b = cloneCells[i]!;
          if (a.row === b.row && a.col === b.col) continue; // self-pairs are inert, per dclamage's CloneConstraint
          pairs.push([a, b]);
        }
        if (pairs.length > 0) constraints.push({ type: "clone", pairs });
      }
    });
  }

  if (Array.isArray(obj.quadruple)) {
    tryParse("quadruple", () => {
      for (const item of obj.quadruple as unknown[]) {
        const it = item as Record<string, unknown>;
        const values = Array.isArray(it.values) ? (it.values as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n)) : [];
        constraints.push({ type: "quadruple", cells: parseCellRefs(it.cells), values });
      }
    });
  }

  if (Array.isArray(obj.minimum)) {
    tryParse("minimum", () => {
      for (const item of obj.minimum as unknown[]) {
        const it = item as Record<string, unknown>;
        constraints.push({ type: "minMax", kind: "min", cell: parseCellRef(String(it.cell)) });
      }
    });
  }

  if (Array.isArray(obj.maximum)) {
    tryParse("maximum", () => {
      for (const item of obj.maximum as unknown[]) {
        const it = item as Record<string, unknown>;
        constraints.push({ type: "minMax", kind: "max", cell: parseCellRef(String(it.cell)) });
      }
    });
  }

  // --- fog of war ---
  // Two separate keys, both lists of "R1C1" refs, and they mean different
  // sizes of light: `fogofwar` cells light the 3x3 around themselves,
  // `foglight` cells light only themselves. Confirmed against sudocle's
  // fpuzzlesconverter.ts, which is the only written-down account of this
  // pair either format has. `fog` is set whenever EITHER key is present,
  // including when the list is empty -- an empty list is a puzzle that
  // starts fully covered, not a puzzle without fog.
  let fogLights: FogLight[] | undefined;
  const addFogLights = (key: string, size: 1 | 3) => {
    if (!Array.isArray(obj[key])) return;
    fogLights ??= [];
    const lights = fogLights;
    tryParse(key, () => {
      for (const ref of obj[key] as unknown[]) {
        lights.push({ cell: parseCellRef(String(ref)), size });
      }
    });
  };
  addFogLights("fogofwar", 3);
  addFogLights("foglight", 1);

  if (obj.antiknight === true) globalRules.antiKnight = true;
  if (obj.antiking === true) globalRules.antiKing = true;
  if (obj.disjointgroups === true) globalRules.disjointGroups = true;
  if (obj["diagonal+"] === true) globalRules.diagonalPositive = true;
  if (obj["diagonal-"] === true) globalRules.diagonalNegative = true;
  if (obj.nonconsecutive === true) globalRules.nonConsecutive = true;

  // Anything else isn't parsed at all yet -- kept so the UI can report what
  // the puzzle uses that this app doesn't currently enforce. Two things are
  // deliberately NOT reported: editor/solver settings (PLUMBING_KEYS), and
  // keys whose value is empty, which mean the puzzle simply doesn't use that
  // feature. scl.ts has skipped empty values since 2026-08-30 for exactly
  // this reason; the rule never made it across to this parser until the real
  // fog fixture showed an empty `truecandidatesoptions` being reported as a
  // missing feature.
  for (const key of Object.keys(obj)) {
    if (KNOWN_KEYS.has(key) || PLUMBING_KEYS.has(key.toLowerCase())) continue;
    const value = obj[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) continue;
    pushUnsupported(key);
  }

  let solution: number[][] | undefined;
  if (Array.isArray(obj.solution) && obj.solution.length === size * size) {
    solution = [];
    for (let r = 0; r < size; r++) {
      const row: number[] = [];
      for (let c = 0; c < size; c++) {
        row.push(Number((obj.solution as unknown[])[r * size + c]));
      }
      solution.push(row);
    }
  }

  if (fogLights) importNotes.push(...fogImportNotes(solution !== undefined));

  return {
    size,
    fog: fogLights ? { lights: fogLights } : undefined,
    irregularRegions: irregularRegions ? true : undefined,
    importNotes: importNotes.length > 0 ? importNotes : undefined,
    title: typeof obj.title === "string" ? obj.title : undefined,
    author: typeof obj.author === "string" ? obj.author : undefined,
    ruleset: typeof obj.ruleset === "string" ? obj.ruleset : undefined,
    grid,
    constraints,
    globalRules,
    solution,
  };
}
