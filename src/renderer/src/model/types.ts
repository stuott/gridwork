// Normalized puzzle model. Every importer (f-puzzles JSON, SudokuPad scl/ctc,
// or a puzzle typed in by hand) targets this shape, so the renderer and the
// validation/candidate logic never need to know where a puzzle came from.
// See design.md sections 1-2 for the source formats this is normalized from,
// and section 6.2/Phase 5 for the "remaining variant coverage" this file's
// constraint union now covers.

/** 1-indexed row/col, matching the "R<row>C<col>" convention of f-puzzles. */
export interface CellRef {
  row: number;
  col: number;
}

/** A single cell's fixed content, if any (a "given" clue) plus solving state. */
export interface Cell {
  /** The clue value baked into the puzzle, if this cell starts filled. */
  given?: number;
  /** The user's current entry, if they've filled this cell in. Never set for given cells. */
  value?: number;
  /** Manually-toggled pencil marks (user's own scratch work). */
  pencilMarks: Set<number>;
  /** Auto-computed legal candidates, recomputed after each edit. Empty until computed. */
  candidates: Set<number>;
  /**
   * The user's own colored cell highlighting -- one of HIGHLIGHT_COLORS'
   * names (design.md section 6.3's "colored pencil marks / cell
   * highlighting" toolkit item), independent of conflict/selection
   * highlighting. Plain `string` rather than a union of those names, so it
   * matches state/history.ts's CellSnapshot and state/persistence.ts's
   * CellProgress, which round-trip it through JSON.
   */
  highlightColor?: string;
}

/**
 * The user's own cell-highlighting palette (design.md 6.3), independent of
 * the app's conflict/selection colors. Board rendering pairs each name with
 * a `.hl-<name>` CSS class and a `--hl-<name>` theme token (style.css's
 * Phase 4 section) -- both already defined for all six names below.
 */
export const HIGHLIGHT_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;

export type CageConstraint = {
  type: "cage";
  cells: CellRef[];
  /** Cage total, when given. Killer cages are sometimes left without a sum. */
  sum?: number;
};

export type ThermoConstraint = {
  type: "thermo";
  /** Ordered from bulb to tip; digits must increase along this path. */
  cells: CellRef[];
  /**
   * "Slow" thermometer: values must merely never *decrease* from bulb to
   * tip, so repeats are legal. Absent/false means the normal strictly-
   * increasing rule.
   *
   * Nothing in a source payload's geometry distinguishes the two -- a slow
   * thermo is drawn exactly like an ordinary one (see scl.ts's
   * inferThermometers). Only the puzzle's prose rules say which it is, so
   * this flag is set from the ruleset text and the board reports which
   * reading it used rather than silently picking one.
   */
  slow?: boolean;
};

export type ArrowConstraint = {
  type: "arrow";
  /** The circle cell(s) at the arrow's base; their sum equals the arrow sum. */
  circleCells: CellRef[];
  /** Ordered path from base to tip. */
  arrowCells: CellRef[];
};

export type KropkiConstraint = {
  type: "kropki";
  kind: "ratio" | "difference"; // ratio = white dot (consecutive), difference = black dot (1:2)
  cells: [CellRef, CellRef];
  /**
   * Custom ratio/difference value, when the puzzle overrides the default
   * (confirmed against dclamage/SudokuSolver's SolverFactory.cs: an empty
   * f-puzzles "value" field means "use the default", not zero). Defaults
   * are applied at parse time in fpuzzles.ts, so this is always populated
   * by the time a KropkiConstraint reaches validate.ts/board.ts.
   */
  value: number;
};

export type OddEvenConstraint = {
  type: "oddEven";
  kind: "odd" | "even";
  cell: CellRef;
};

/**
 * Renban (digits form a consecutive run, any order, no repeats), German
 * whisper lines (adjacent digits differ by at least minDifference), and
 * palindrome lines (the line reads the same digit-for-digit from each end)
 * all share the "ordered path of cells" shape, so they're one constraint
 * type distinguished by `kind`. Field shapes and default whisper difference
 * (floor((size+1)/2), i.e. 5 on a 9x9 grid) confirmed against
 * dclamage/SudokuSolver's RenbanConstraint.cs/WhispersConstraint.cs/
 * PalindromeConstraint.cs and their SolverFactory.cs wiring.
 */
export type LineConstraint = {
  type: "line";
  kind: "renban" | "whisper" | "palindrome";
  cells: CellRef[];
  /** Only meaningful for kind "whisper". */
  minDifference?: number;
};

/**
 * Between line: the two path endpoints are the "bulbs"; every interior cell
 * must be strictly between the two endpoint values (order-independent).
 * Shape/semantics confirmed against BetweenLineConstraint.cs.
 */
export type BetweenLineConstraint = {
  type: "betweenLine";
  /** Full ordered path, endpoints included (cells[0] and cells[cells.length-1] are the bulbs). */
  cells: CellRef[];
};

/**
 * Little killer: a diagonal sum clue anchored just outside the grid.
 * `clueCell` is the outer anchor position as given in the source puzzle
 * (may have row/col index 0 or size+1, i.e. outside the 1..size range);
 * `cells` is the resolved diagonal path through the grid in reading order.
 * Direction/path-walking algorithm confirmed against
 * dclamage/SudokuSolver's LittleKillerConstraint.cs.
 */
export type LittleKillerConstraint = {
  type: "littleKiller";
  clueCell: CellRef;
  direction: "UL" | "UR" | "DL" | "DR";
  cells: CellRef[];
  sum: number;
};

/** XV: two orthogonally-adjacent cells joined by an "X" (sum 10) or "V" (sum 5) marker. */
export type XVConstraint = {
  type: "xv";
  cells: [CellRef, CellRef];
  kind: "X" | "V";
};

/**
 * Sandwich sum: the clue sum is the total of the digits strictly between
 * the 1 and the size (the "crusts") in a full row or column. `cells` is
 * the resolved full row/column in order; `clueCell` is the outer clue
 * position as given in the source puzzle, kept for rendering the clue text
 * outside the grid. Shape confirmed against SandwichConstraint.cs.
 */
export type SandwichConstraint = {
  type: "sandwich";
  cells: CellRef[];
  clueCell: CellRef;
  sum: number;
};

/** Extra region: an additional set of cells (not a row/col/box) that must contain each digit at most once, like an extra box. */
export type ExtraRegionConstraint = {
  type: "extraRegion";
  cells: CellRef[];
};

/** Clone: paired cell groups that must match digit-for-digit, position by position. */
export type CloneConstraint = {
  type: "clone";
  pairs: Array<[CellRef, CellRef]>;
};

/**
 * Quadruple: the listed digits (which may repeat, e.g. two 5s) must all
 * appear among the cells at a 4-way (or more) intersection once every cell
 * in the group is filled. Multiset-containment check confirmed as the
 * correct full-grid interpretation of QuadrupleConstraint.cs's mask logic.
 */
export type QuadrupleConstraint = {
  type: "quadruple";
  cells: CellRef[];
  values: number[];
};

/**
 * Min/max cell: must be strictly less than (min) or greater than (max)
 * every orthogonally-adjacent cell in the grid. Shape confirmed against
 * MinimumConstraint.cs/MaximumConstraint.cs (both just an AdjacentCells
 * comparison, no line/region geometry).
 */
export type MinMaxConstraint = {
  type: "minMax";
  kind: "min" | "max";
  cell: CellRef;
};

/**
 * Constraint types not yet parsed/rendered by this app. Kept as raw data so a
 * puzzle with unsupported constraints still imports (and the UI can say what
 * it's not enforcing) instead of failing outright. See design.md section 6.2
 * for the list of what's behind this catch-all today (region-sum lines,
 * row/column/box indexers, X-sum/skyscraper clues, entropic/modular/nabner/
 * zipper lines, double arrows, slow thermometers, and negative-constraint
 * variants of kropki/XV/nonconsecutive).
 */
export type UnsupportedConstraint = {
  type: "unsupported";
  /** The original f-puzzles/SudokuPad key, e.g. "regionsumline", "xsum". */
  sourceKey: string;
  raw: unknown;
};

export type Constraint =
  | CageConstraint
  | ThermoConstraint
  | ArrowConstraint
  | KropkiConstraint
  | OddEvenConstraint
  | LineConstraint
  | BetweenLineConstraint
  | LittleKillerConstraint
  | XVConstraint
  | SandwichConstraint
  | ExtraRegionConstraint
  | CloneConstraint
  | QuadrupleConstraint
  | MinMaxConstraint
  | UnsupportedConstraint;

/**
 * Raw scl/ctc visual data (design.md 7.6 / project memory
 * "sudoku_scl_implementation"): SudokuPad's own `lines`/`overlays` arrays
 * turned out to be a *rendering* description (way-points/color/thickness,
 * or center/size/shape), not a semantically-tagged constraint list -- see
 * importer/formats/scl.ts's file comment. Rather than force these into the
 * validated `Constraint` union (which would wrongly imply they're checked
 * for conflicts), they're kept as a separate "draw this, but don't
 * validate it" channel that board.ts renders literally, the same way
 * SudokuPad's own player would, so a human solver can at least see and
 * apply the rule manually (this app's "solving assistant, not
 * auto-solver" stance). Coordinates are already normalized to 0-indexed
 * [row, col] grid units where an integer is a cell edge and X.5 is a cell
 * center (scl's own convention, confirmed against a real payload) -- and
 * thickness/width/height are normalized to "fraction of one cell" at parse
 * time in scl.ts, so board.ts never needs to know the source puzzle's own
 * `cellSize`.
 */
export interface SclDecorationLine {
  wayPoints: Array<[number, number]>;
  color?: string;
  /** Stroke width as a fraction of one cell (already divided by the source's cellSize in scl.ts). */
  thickness?: number;
  /** When present, this "line" is actually a filled shape (a closed outline) rather than a stroked path. */
  fill?: string;
}

export interface SclDecorationOverlay {
  center: [number, number];
  /** Fraction of one cell -- already in scl's native 0-1-ish scale, unlike `thickness`. */
  width: number;
  height: number;
  angle?: number;
  rounded?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  /** Border stroke width as a fraction of one cell (already divided by cellSize in scl.ts). */
  thickness?: number;
  /**
   * Text drawn inside the shape. This is how SudokuPad renders every
   * number or letter on a board that isn't a grid digit: killer cage sums,
   * X/V letters, little-killer clues, quadruple digits, sandwich clues.
   * Discarding it (as this app did until 2026-08-31) left every one of
   * those shapes on the board empty -- the incomplete-picture failure the
   * decorations channel exists to prevent.
   */
  text?: string;
  /** Text size as a fraction of one cell (normalized in scl.ts). */
  fontSize?: number;
  /** Text fill color, when the source names one. */
  color?: string;
}

/**
 * scl's `arrows`: a stroked path exactly like SclDecorationLine, plus an
 * arrowhead drawn at the LAST way-point. SudokuPad keeps arrows in their
 * own array rather than as a flag on `lines`, so a parser that only reads
 * `lines` drops them silently -- which is what this app did until
 * 2026-08-31, leaving arrow-variant puzzles with their arrows missing from
 * the drawing. Like every other decoration these are drawn but never
 * validated: an scl arrow carries no statement that it means the
 * arrow-sum rule (see importer/formats/scl.ts's file comment).
 */
export interface SclDecorationArrow {
  wayPoints: Array<[number, number]>;
  color?: string;
  /** Stroke width as a fraction of one cell (normalized in scl.ts). */
  thickness?: number;
  /** Arrowhead length as a fraction of one cell (normalized in scl.ts). */
  headLength?: number;
}

/**
 * One cleared patch of fog: a cell whose surroundings are lit.
 *
 * `size` is SudokuPad's own vocabulary and only ever takes two values --
 * 3 lights the 3x3 block centred on `cell` (clipped at the grid edge), 1
 * lights that single cell. Confirmed against sudocle's fpuzzles/ctc
 * converters, which normalize every fog source in both formats down to
 * this one shape.
 */
export interface FogLight {
  /** 1-indexed, like every other CellRef in this file. */
  cell: CellRef;
  size: 1 | 3;
}

export interface PuzzleModel {
  size: number;
  title?: string;
  author?: string;
  ruleset?: string;
  grid: Cell[][]; // grid[row][col], 0-indexed internally
  constraints: Constraint[];
  /** Raw scl/ctc visual data this app can draw but not validate (see SclDecorationLine's doc comment). Undefined for fpuzzles-sourced puzzles -- only scl.ts populates this. */
  decorations?: {
    lines: SclDecorationLine[];
    overlays: SclDecorationOverlay[];
    /**
     * scl's `underlays`: the same shape vocabulary as `overlays`, but drawn
     * *beneath* the lines rather than on top. Thermometer bulbs, cell
     * shading and board-background rects all arrive here, so dropping them
     * (as this app did until 2026-08-30) leaves thermos as bare lines with
     * no visible bulb.
     */
    underlays: SclDecorationOverlay[];
    /** scl's `arrows`: stroked paths that end in an arrowhead. */
    arrows: SclDecorationArrow[];
  };
  /** Whole-grid rules that aren't tied to specific cells/lines. */
  globalRules: {
    antiKnight?: boolean;
    antiKing?: boolean;
    disjointGroups?: boolean;
    /** "/" diagonal, bottom-left to top-right (f-puzzles "diagonal+"). */
    diagonalPositive?: boolean;
    /** "\" diagonal, top-left to bottom-right (f-puzzles "diagonal-"). */
    diagonalNegative?: boolean;
    /** No two orthogonally-adjacent cells may hold consecutive digits, grid-wide. */
    nonConsecutive?: boolean;
  };
  /**
   * Set when the source puzzle declares a region layout that is NOT the
   * ordinary box grid -- a jigsaw/irregular puzzle. This app has no jigsaw
   * support yet (design.md 7.4), and the regions it *would* check are then
   * simply the wrong ones, so every box-based check (conflicts, auto
   * candidates, hints, disjoint groups) switches off and the board stops
   * drawing box outlines it can't stand behind. See `boxesAreChecked`.
   *
   * This is CLAUDE.md's "never validate a rule the puzzle might not have"
   * invariant: checking nothing is honest, checking the wrong regions is
   * not. Both importers set it -- fpuzzles.ts from the per-cell `region`
   * field, scl.ts from a `regions` array that isn't a restatement of the
   * default boxes.
   */
  irregularRegions?: boolean;
  /** The full solution digits, when the source puzzle included one (used for win detection only -- never shown to the user). */
  solution?: number[][];
  /**
   * Fog of war. Present (even with an empty `lights`) exactly when the
   * source puzzle declares fog; absent means "not a fog puzzle" and no
   * fog code path runs at all.
   *
   * `lights` holds only the fog the *puzzle* declares -- what is lit the
   * moment it loads, before a single digit is entered. Everything the
   * solver uncovers as they go is derived from the live grid by
   * state/fog.ts and deliberately not stored here, so fog stays a pure
   * function of (puzzle + current digits): undo puts the fog back exactly
   * as it was, and a resumed session re-derives the same view without
   * saving a fog snapshot.
   *
   * NOTE -- this is the one feature that reads `solution` for something
   * other than win detection, because clearing fog on a *correct* digit
   * IS the fog variant's rule; a fog puzzle where any digit lifted the fog
   * would be no puzzle at all. It still never shows a digit the user
   * hasn't earned. See CLAUDE.md's "the hard rule" and its fog exception.
   */
  fog?: {
    lights: FogLight[];
  };
  /**
   * Short, user-facing notes about *how this puzzle was imported* -- things
   * the solver should know that aren't the puzzle's own rules, e.g. "these
   * thermometers were inferred from the drawing". Rendered in the board's
   * notes line. Kept separate from `ruleset` (the setter's prose) and from
   * "unsupported" constraints (things we dropped).
   */
  importNotes?: string[];
}

export function emptyCell(): Cell {
  return { pencilMarks: new Set(), candidates: new Set() };
}

export function createEmptyGrid(size: number): Cell[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => emptyCell()),
  );
}

/** Box (3x3 block) dimensions for a given grid size, assuming a square-of-square-root layout like 9x9. Falls back to a single box covering everything for sizes without a clean sqrt. */
export function boxDims(size: number): { boxW: number; boxH: number } {
  const root = Math.sqrt(size);
  if (Number.isInteger(root)) {
    return { boxW: root, boxH: root };
  }
  return { boxW: size, boxH: size };
}

/**
 * Whether this puzzle's boxes may be conflict-checked / used as units.
 *
 * False in two cases: a grid size with no clean square-root box layout
 * (`boxDims` falls back to one box covering everything, which is not a
 * real unit), and a puzzle whose regions are irregular and therefore
 * unknown to this app. Every box-based code path goes through this rather
 * than testing `boxW < size` itself, so the jigsaw case can never be
 * forgotten at one of them. See PuzzleModel.irregularRegions.
 */
export function boxesAreChecked(model: Pick<PuzzleModel, "size" | "irregularRegions">): boolean {
  const { boxW } = boxDims(model.size);
  return boxW < model.size && model.irregularRegions !== true;
}

/** Cage/thermo/etc. constraints store 1-indexed CellRefs (matching "R1C1"); the grid array itself is 0-indexed. This is the only place that conversion should happen. */
export function cellRefToIndex(ref: CellRef): { r: number; c: number } {
  return { r: ref.row - 1, c: ref.col - 1 };
}
