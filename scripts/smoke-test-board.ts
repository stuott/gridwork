/**
 * Headless checks for src/renderer/src/render/board.ts.
 *
 * board.ts is the largest module in the project and was the only one with no
 * test at all -- the 2026-08-31 audit found two real bugs in it (a solved
 * puzzle wiping the timer button's icon, and an `afterEdit` option that was
 * accepted and discarded). Everything it does that isn't literally painting
 * pixels is testable: which cells a click selects, what a digit key writes,
 * when a shortcut must NOT fire, whether conflicts are displayed, whether the
 * timer stops on a win, and whether destroy() actually detaches.
 *
 * scripts/smoke-test-selection.ts already covers the pure selection *rules*
 * (state/selection.ts). This covers the plumbing around them: the DOM the
 * board builds, the events it listens to, and how model edits flow back into
 * a re-render.
 *
 * Needs a DOM, so unlike the other suites this one runs against jsdom and
 * imports board.ts dynamically, after the globals are in place -- settings.ts
 * reads localStorage at module-evaluation time, so importing any of this
 * before the stubs exist would capture the wrong state.
 *
 * Run with: npm run test:board
 */
import { JSDOM } from "jsdom";

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failed = true;
}

// --- DOM setup -------------------------------------------------------------

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: "https://localhost/",
  pretendToBeVisual: true,
});

const w = dom.window as unknown as Record<string, unknown>;
// Node already defines some of these as getter-only globals (navigator), so
// assign through defineProperty rather than plain assignment.
for (const key of [
  "window", "document", "localStorage", "getComputedStyle",
  "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement",
  "SVGElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent",
]) {
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom.window : w[key],
    configurable: true,
    writable: true,
  });
}

const { document } = dom.window;

// --- imports (after the globals above exist) -------------------------------

const { SudokuBoard } = await import("../src/renderer/src/render/board");
const { createEmptyGrid } = await import("../src/renderer/src/model/types");
const { setVerificationPrefs, getVerificationPrefs } = await import("../src/renderer/src/settings");
const { saveProgress } = await import("../src/renderer/src/state/persistence");
type PuzzleModel = import("../src/renderer/src/model/types").PuzzleModel;
type Constraint = import("../src/renderer/src/model/types").Constraint;

const CELL = 64; // must match board.ts's own constant

function model(size = 4, extra: Partial<PuzzleModel> = {}): PuzzleModel {
  return { size, grid: createEmptyGrid(size), constraints: [], globalRules: {}, ...extra };
}

let boardSeq = 0;
interface Mounted {
  board: InstanceType<typeof SudokuBoard>;
  container: HTMLElement;
  svg: SVGSVGElement;
}

/** Mounts a board into a fresh container and stubs the SVG's box so pointer coordinates map to real cells (jsdom does no layout, so every rect would otherwise measure 0x0 at the origin). */
function mount(m: PuzzleModel, puzzleId = `test-${boardSeq++}`): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const board = new SudokuBoard(container, m, { puzzleId, rawInput: puzzleId });
  // Must be .sudoku-svg, not just "svg" -- the toolbar's icon buttons are
  // inline SVGs and come first in document order.
  const svg = container.querySelector("svg.sudoku-svg") as unknown as SVGSVGElement;
  (svg as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({
    left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
  });
  return { board, container, svg };
}

function unmount(m: Mounted) {
  m.board.destroy(); // also stops the Timer interval, or the process never exits
  m.container.remove();
}

interface ClickOpts { shiftKey?: boolean; ctrlKey?: boolean }

/** Where the last synthetic pointer event landed, so dragTo can emit one move per cell crossed the way a real mouse would. */
let lastPointer = { r: 0, c: 0 };

/** A left-button pointerdown on the centre of cell (r, c). The board hit-tests from coordinates rather than per-rect listeners, so this is the real path. */
function clickCell(mounted: Mounted, r: number, c: number, opts: ClickOpts = {}) {
  const margin = marginOf(mounted);
  mounted.svg.dispatchEvent(
    new dom.window.MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: margin + c * CELL + CELL / 2,
      clientY: margin + r * CELL + CELL / 2,
      shiftKey: opts.shiftKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
    }),
  );
  lastPointer = { r, c };
}

/**
 * Drag the pointer to cell (r, c), emitting a move for every cell along the
 * way. A real drag fires a move per cell crossed, and the board paints each
 * one it is told about -- jumping straight to the far end would only ever
 * select the two ends.
 */
function dragTo(mounted: Mounted, r: number, c: number) {
  const margin = marginOf(mounted);
  let { r: cr, c: cc } = lastPointer;
  while (cr !== r || cc !== c) {
    cr += Math.sign(r - cr);
    cc += Math.sign(c - cc);
    mounted.svg.dispatchEvent(
      new dom.window.MouseEvent("pointermove", {
        bubbles: true,
        clientX: margin + cc * CELL + CELL / 2,
        clientY: margin + cr * CELL + CELL / 2,
      }),
    );
  }
  lastPointer = { r, c };
}

/** The board reserves an outside-grid band for some puzzles; derive it from the rendered viewBox rather than duplicating the rule. */
function marginOf(mounted: Mounted): number {
  const viewBox = mounted.svg.getAttribute("viewBox") ?? "0 0 0 0";
  const px = Number(viewBox.split(" ")[2]);
  const size = Number(mounted.svg.querySelectorAll("rect.cell-bg").length) ** 0.5;
  return (px - size * CELL) / 2;
}

interface KeyOpts { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }
function press(key: string, opts: KeyOpts = {}) {
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }),
  );
}

const selectedKeys = (m: Mounted): string[] =>
  [...m.svg.querySelectorAll("rect.cell-bg")]
    .map((el, i) => (el.classList.contains("selected") ? i : -1))
    .filter((i) => i >= 0)
    .map(String);

/** `.hidden` reflects `boolean | "until-found"`, so compare it explicitly rather than relying on truthiness. */
const isHidden = (el: HTMLElement): boolean => el.hidden === true;

const digitsOn = (m: Mounted): string[] =>
  [...m.svg.querySelectorAll("text.value-digit, text.given-digit")].map((t) => t.textContent ?? "");

// --- structure -------------------------------------------------------------

{
  const m = model(4);
  m.grid[0]![0]!.given = 3;
  const mounted = mount(m);

  check("board renders one background rect per cell", mounted.svg.querySelectorAll("rect.cell-bg").length === 16);
  check("a given renders as a given-digit", mounted.svg.querySelectorAll("text.given-digit").length === 1);
  check("viewBox has no reserved margin for a plain puzzle", mounted.svg.getAttribute("viewBox") === `0 0 ${4 * CELL} ${4 * CELL}`);
  check("grid lines are drawn", mounted.svg.querySelectorAll("line.grid-line-thick, line.grid-line-thin").length === 10);
  check("nothing is selected on a fresh board", selectedKeys(mounted).length === 0);
  unmount(mounted);
}

{
  // Little killer / sandwich clues live outside the grid, so the board has to
  // reserve a band for them or they're clipped away by the viewBox.
  const constraints: Constraint[] = [
    { type: "littleKiller", clueCell: { row: 0, col: 1 }, direction: "DR", cells: [{ row: 1, col: 1 }], sum: 5 },
  ];
  const mounted = mount(model(4, { constraints }));
  check("a little killer clue reserves an outside-grid margin", mounted.svg.getAttribute("viewBox") === `0 0 ${4 * CELL + 60} ${4 * CELL + 60}`);
  check("the little killer sum is drawn", [...mounted.svg.querySelectorAll("text.little-killer-sum")].some((t) => t.textContent === "5"));
  unmount(mounted);
}

{
  // Real scl payloads draw outside the grid (border frames run to -0.375 on a
  // 9x9), so the margin has to grow to fit decorations too, not just clues.
  const mounted = mount(
    model(4, {
      decorations: {
        lines: [{ wayPoints: [[-0.5, 0.5], [-0.5, 3.5]] }],
        overlays: [],
        underlays: [],
        arrows: [],
      },
    }),
  );
  check("decorations reaching outside the grid widen the viewBox", mounted.svg.getAttribute("viewBox") === `0 0 ${4 * CELL + 64} ${4 * CELL + 64}`);
  check("decoration lines are drawn", mounted.svg.querySelectorAll("polyline.scl-decoration-line").length === 1);
  unmount(mounted);
}

{
  // audit-2026-08-31 issue 2: scl `arrows` were parsed by nothing and drawn
  // by nothing, so an arrow puzzle rendered with part of its picture gone.
  const mounted = mount(
    model(4, {
      decorations: {
        lines: [],
        overlays: [],
        underlays: [],
        arrows: [{ wayPoints: [[0.5, 0.5], [0.5, 2.5]], color: "#ff0000", thickness: 0.05, headLength: 0.3 }],
      },
    }),
  );
  const arrowParts = [...mounted.svg.querySelectorAll(".scl-decoration-line")];
  check("an arrow decoration draws its shaft as a polyline", arrowParts.filter((e) => e.tagName === "polyline").length === 1);
  check("an arrow decoration draws a two-stroke arrowhead at the tip", arrowParts.filter((e) => e.tagName === "line").length === 2);
  check("an arrow keeps the source color rather than a theme color", arrowParts.every((e) => e.getAttribute("stroke") === "#ff0000"));
  // Head strokes must start at the LAST way-point (r0.5,c2.5), not the first.
  const head = arrowParts.find((e) => e.tagName === "line")!;
  check(
    "the arrowhead sits on the final way-point",
    Number(head.getAttribute("x1")) === 2.5 * CELL && Number(head.getAttribute("y1")) === 0.5 * CELL,
  );
  const notes = mounted.container.querySelector(".board-notes")?.textContent ?? "";
  check("arrows count toward the 'drawn but not checked' shape total", notes.includes("(1 shape)"));
  unmount(mounted);
}

{
  // audit-2026-08-31 issue 3: overlay `text` was discarded, so cage sums,
  // X/V letters and little-killer clues rendered as empty shapes.
  const mounted = mount(
    model(4, {
      decorations: {
        lines: [],
        overlays: [
          { center: [0.5, 0.5], width: 0.3, height: 0.3, text: "15", fontSize: 0.4, color: "#123456" },
          { center: [1.5, 1.5], width: 0, height: 0, text: "X" },
        ],
        underlays: [],
        arrows: [],
      },
    }),
  );
  const labels = [...mounted.svg.querySelectorAll("text.scl-decoration-text")];
  check("overlay text is drawn", labels.map((t) => t.textContent).join(",") === "15,X");
  check("overlay text uses the source font size and color", labels[0]!.getAttribute("font-size") === String(0.4 * CELL) && labels[0]!.getAttribute("fill") === "#123456");
  check("a text overlay with no size draws no stray 0x0 shape", mounted.svg.querySelectorAll("rect.scl-decoration-overlay, ellipse.scl-decoration-overlay").length === 1);
  unmount(mounted);
}

{
  // audit-2026-08-31 issue 1: a jigsaw's boxes are not its regions, so the
  // board must not draw box outlines it can't stand behind.
  const plain = mount(model(4));
  const plainThick = plain.svg.querySelectorAll("line.grid-line-thick").length;
  unmount(plain);
  const jigsaw = mount(model(4, { irregularRegions: true }));
  const jigsawThick = jigsaw.svg.querySelectorAll("line.grid-line-thick").length;
  check("an ordinary 4x4 draws its box outlines heavy", plainThick > 4);
  check("an irregular-region puzzle draws only the outer border heavy", jigsawThick === 4);
  unmount(jigsaw);
}

{
  const constraints: Constraint[] = [{ type: "unsupported", sourceKey: "xsum", raw: null }];
  const mounted = mount(model(4, { constraints, importNotes: ["thermos were inferred"] }));
  const notes = mounted.container.querySelector(".board-notes")?.textContent ?? "";
  check("unsupported constraint types are named in the notes", notes.includes("xsum"));
  check("import notes are shown", notes.includes("thermos were inferred"));
  unmount(mounted);
}

{
  const mounted = mount(model(4, { ruleset: "Normal sudoku rules apply." }));
  const rules = mounted.container.querySelector(".board-rules");
  check("a ruleset renders a rules panel", !!rules && !isHidden(rules as HTMLElement));
  check("the ruleset text is present", (mounted.container.querySelector(".board-rules-text")?.textContent ?? "").includes("Normal sudoku"));
  unmount(mounted);
}

// --- selection via pointer -------------------------------------------------

{
  const mounted = mount(model(4));
  clickCell(mounted, 1, 2);
  check("a click selects exactly the clicked cell", selectedKeys(mounted).join() === String(1 * 4 + 2));

  dragTo(mounted, 1, 3);
  check("dragging extends the selection", selectedKeys(mounted).length === 2);

  clickCell(mounted, 0, 0);
  check("a plain click replaces the selection", selectedKeys(mounted).join() === "0");

  clickCell(mounted, 1, 1, { shiftKey: true });
  check("shift+click fills the rectangle to the anchor", selectedKeys(mounted).length === 4);

  clickCell(mounted, 0, 0, { ctrlKey: true });
  check("ctrl+click removes an already-selected cell", selectedKeys(mounted).length === 3);
  unmount(mounted);
}

{
  const mounted = mount(model(4));
  clickCell(mounted, 0, 0);
  press("ArrowRight");
  check("a bare arrow key moves the selection", selectedKeys(mounted).join() === "1");
  press("ArrowDown", { shiftKey: true });
  check("shift+arrow extends instead of moving", selectedKeys(mounted).length === 2);
  press("a", { ctrlKey: true });
  check("ctrl+A selects the whole grid", selectedKeys(mounted).length === 16);
  press("Escape");
  check("Escape clears the selection", selectedKeys(mounted).length === 0);
  unmount(mounted);
}

// --- digit entry -----------------------------------------------------------

{
  const m = model(4);
  m.grid[0]![0]!.given = 3;
  const mounted = mount(m);

  clickCell(mounted, 1, 1);
  press("2");
  check("a digit key writes into the selected cell", m.grid[1]![1]!.value === 2);
  check("the digit is rendered", digitsOn(mounted).includes("2"));

  clickCell(mounted, 0, 0);
  press("4");
  check("a given cell is read-only", m.grid[0]![0]!.given === 3 && m.grid[0]![0]!.value === undefined);

  press("5");
  check("a digit larger than the grid size is ignored", m.grid[0]![0]!.value === undefined);

  clickCell(mounted, 2, 0);
  dragTo(mounted, 2, 3);
  press("1");
  check("a digit fills every selected cell at once", m.grid[2]!.every((cell) => cell.value === 1));

  press("Backspace");
  check("Backspace clears every selected cell", m.grid[2]!.every((cell) => cell.value === undefined));
  unmount(mounted);
}

{
  const m = model(4);
  const mounted = mount(m);

  clickCell(mounted, 0, 0);
  press("p");
  check("P turns on pencil mode", mounted.container.querySelector(".board-toolbar .icon-btn")?.getAttribute("aria-pressed") === "true");

  press("3");
  check("in pencil mode a digit becomes a pencil mark", m.grid[0]![0]!.pencilMarks.has(3) && m.grid[0]![0]!.value === undefined);
  check("the pencil mark is rendered", [...mounted.svg.querySelectorAll("text.pencil-mark")].some((t) => t.textContent === "3"));

  press("3");
  check("pressing the same digit again removes the mark", !m.grid[0]![0]!.pencilMarks.has(3));

  // Fill-first across a mixed selection: the mark is only removed when every
  // target already carries it.
  m.grid[0]![0]!.pencilMarks.add(2);
  clickCell(mounted, 0, 0);
  dragTo(mounted, 0, 1);
  press("2");
  check("a mixed selection fills in rather than toggling off", m.grid[0]![0]!.pencilMarks.has(2) && m.grid[0]![1]!.pencilMarks.has(2));
  press("2");
  check("once every target carries the mark, it toggles off", !m.grid[0]![0]!.pencilMarks.has(2) && !m.grid[0]![1]!.pencilMarks.has(2));
  unmount(mounted);
}

// --- highlight colors ------------------------------------------------------

{
  const m = model(4);
  const mounted = mount(m);
  clickCell(mounted, 0, 0);

  press("1", { altKey: true });
  check("Alt+1 applies the first highlight color", m.grid[0]![0]!.highlightColor === "red");
  check("the highlight is rendered", mounted.svg.querySelectorAll("rect.cell-highlight.hl-red").length === 1);
  check("the matching swatch reads as active", mounted.container.querySelector(".highlight-swatch.hl-red")?.classList.contains("active") === true);

  press("1", { altKey: true });
  check("pressing the same color again clears it", m.grid[0]![0]!.highlightColor === undefined);

  press("3", { altKey: true });
  press("0", { altKey: true });
  check("Alt+0 clears the highlight", m.grid[0]![0]!.highlightColor === undefined);
  unmount(mounted);
}

// --- undo / redo -----------------------------------------------------------

{
  const m = model(4);
  const mounted = mount(m);
  const undoBtn = mounted.container.querySelector('[title="Undo (Ctrl+Z)"]') as HTMLButtonElement;
  const redoBtn = mounted.container.querySelector('[title="Redo (Ctrl+Shift+Z)"]') as HTMLButtonElement;

  check("undo starts disabled", undoBtn.disabled && redoBtn.disabled);

  clickCell(mounted, 1, 1);
  press("2");
  check("undo becomes available after an edit", !undoBtn.disabled);

  press("z", { ctrlKey: true });
  check("ctrl+Z reverts the edit", m.grid[1]![1]!.value === undefined);
  check("redo becomes available after an undo", !redoBtn.disabled);

  press("z", { ctrlKey: true, shiftKey: true });
  check("ctrl+shift+Z reapplies it", m.grid[1]![1]!.value === 2);

  // Highlight edits are undoable too, not just digits.
  press("2", { altKey: true });
  check("a highlight edit is recorded", m.grid[1]![1]!.highlightColor === "orange");
  press("z", { ctrlKey: true });
  check("undo reverts a highlight edit", m.grid[1]![1]!.highlightColor === undefined);
  check("undoing a highlight leaves the digit alone", m.grid[1]![1]!.value === 2);
  unmount(mounted);
}

{
  const m = model(4);
  m.grid[0]![0]!.given = 1;
  const mounted = mount(m);
  clickCell(mounted, 1, 1);
  press("2");
  const clearBtn = mounted.container.querySelector('[title="Clear every entry and pencil mark"]') as HTMLButtonElement;
  clearBtn.click();
  check("Clear wipes the user's entries", m.grid[1]![1]!.value === undefined);
  check("Clear leaves the givens", m.grid[0]![0]!.given === 1);
  press("z", { ctrlKey: true });
  check("Clear is undoable", m.grid[1]![1]!.value === 2);
  unmount(mounted);
}

// --- shortcut guards -------------------------------------------------------
// Both of these are regressions: a global keydown listener meant for the board
// was stealing keystrokes from the import box, and firing underneath the
// settings modal.

{
  const m = model(4);
  const mounted = mount(m);
  clickCell(mounted, 1, 1);

  const input = document.createElement("input");
  input.type = "text";
  document.body.appendChild(input);
  input.focus();

  press("7");
  check("a digit typed into a focused text input never reaches the board", m.grid[1]![1]!.value === undefined);
  press("Escape");
  check("Escape in a text input does not clear the board selection", selectedKeys(mounted).length === 1);

  input.remove();
  (document.body as HTMLElement).focus();
  press("3");
  check("the same key works once focus leaves the input", m.grid[1]![1]!.value === 3);
  unmount(mounted);
}

{
  const m = model(4);
  const mounted = mount(m);
  clickCell(mounted, 1, 1);

  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  document.body.appendChild(overlay);

  press("2");
  check("board shortcuts are inert while the settings modal is open", m.grid[1]![1]!.value === undefined);

  (overlay as HTMLElement).hidden = true;
  press("2");
  check("they resume once it is closed", m.grid[1]![1]!.value === 2);
  overlay.remove();
  unmount(mounted);
}

// --- conflicts: live vs. on demand -----------------------------------------

{
  setVerificationPrefs({ liveChecking: true, autoCandidates: false });
  const m = model(4);
  const mounted = mount(m);

  clickCell(mounted, 0, 0);
  press("2");
  clickCell(mounted, 0, 1);
  press("2");
  check("live checking flags a duplicate immediately", mounted.svg.querySelectorAll("rect.cell-bg.conflict").length === 2);
  check("the status line counts the conflict", (mounted.container.querySelector(".board-status")?.textContent ?? "").includes("conflict"));

  setVerificationPrefs({ liveChecking: false });
  check("turning live checking off clears the display on an open board", mounted.svg.querySelectorAll("rect.cell-bg.conflict").length === 0);

  const checkBtn = mounted.container.querySelector('[title^="Check the grid"]') as HTMLButtonElement;
  checkBtn.click();
  check("Check reveals the conflict on demand", mounted.svg.querySelectorAll("rect.cell-bg.conflict").length === 2);

  clickCell(mounted, 2, 2);
  press("1");
  check("a later edit clears the on-demand result", mounted.svg.querySelectorAll("rect.cell-bg.conflict").length === 0);

  setVerificationPrefs({ liveChecking: true });
  unmount(mounted);
}

{
  setVerificationPrefs({ autoCandidates: false });
  const m = model(4);
  m.grid[0]![0]!.given = 1;
  const mounted = mount(m);
  check("no candidate marks are shown by default", mounted.svg.querySelectorAll("text.pencil-mark").length === 0);

  setVerificationPrefs({ autoCandidates: true });
  check("turning auto-candidates on fills empty cells on an open board", mounted.svg.querySelectorAll("text.pencil-mark").length > 0);
  check("a filled cell gets no candidate marks", m.grid[0]![0]!.candidates.size === 0);

  setVerificationPrefs({ autoCandidates: false });
  check("turning it back off removes them", mounted.svg.querySelectorAll("text.pencil-mark").length === 0);
  unmount(mounted);
}

// --- hints -----------------------------------------------------------------

{
  const m = model(4);
  // Leaves exactly one legal candidate in R1C1 -> a naked single.
  m.grid[0]![1]!.given = 2;
  m.grid[0]![2]!.given = 3;
  m.grid[1]![0]!.given = 4;
  const mounted = mount(m);

  const panel = mounted.container.querySelector(".hint-panel") as HTMLElement;
  check("the hint panel starts hidden", isHidden(panel));

  press("h");
  check("H opens the hint panel", !isHidden(panel));
  check("a technique is named", (mounted.container.querySelector(".hint-technique")?.textContent ?? "").length > 0);
  check("the hint never states the digit for a placement", !/\bis\s+1\b/.test(mounted.container.querySelector(".hint-message")?.textContent ?? ""));
  check("the hinted cell is highlighted on the board", mounted.svg.querySelectorAll("rect.hint-cell").length > 0);

  clickCell(mounted, 3, 3);
  press("1");
  check("making an edit dismisses the hint", isHidden(panel) && mounted.svg.querySelectorAll("rect.hint-cell").length === 0);
  unmount(mounted);
}

// --- win detection (and the timer button that used to break on it) ---------

{
  const solution = [
    [1, 2, 3, 4],
    [3, 4, 1, 2],
    [2, 1, 4, 3],
    [4, 3, 2, 1],
  ];
  const mounted = mount(model(4, { solution }));
  const timerBtn = mounted.container.querySelector(".timer-toggle-btn") as HTMLButtonElement;

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      clickCell(mounted, r, c);
      press(String(solution[r]![c]));
    }
  }

  const status = mounted.container.querySelector(".board-status") as HTMLElement;
  check("a completed grid matching the solution reports a win", status.textContent?.startsWith("Solved!") === true);
  check("the win state is styled as solved", status.classList.contains("solved"));

  // The audit bug: renderStatus() assigned .textContent to this icon button,
  // which deletes its <svg> and leaves the bare word "Resume" behind.
  check("winning keeps the timer button an icon button", !!timerBtn.querySelector("svg"));
  check("winning does not replace the icon with text", (timerBtn.textContent ?? "").trim() === "");
  check("the timer button relabels itself to Resume", timerBtn.title === "Resume timer");
  check("the accessible name is relabelled too", timerBtn.getAttribute("aria-label") === "Resume timer");
  unmount(mounted);
}

{
  const solution = [
    [1, 2, 3, 4],
    [3, 4, 1, 2],
    [2, 1, 4, 3],
    [4, 3, 2, 1],
  ];
  const mounted = mount(model(4, { solution }));
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      clickCell(mounted, r, c);
      // Swap two digits in the last row so the grid is full but wrong.
      const value = r === 3 ? solution[3]![3 - c]! : solution[r]![c]!;
      press(String(value));
    }
  }
  const status = mounted.container.querySelector(".board-status") as HTMLElement;
  check("a full but incorrect grid is not reported as solved", !status.textContent?.startsWith("Solved!"));
  check("it says the grid does not match instead", (status.textContent ?? "").includes("doesn't match"));
  unmount(mounted);
}

// --- save / resume ---------------------------------------------------------

{
  const m = model(4);
  const mounted = mount(m, "persist-me");
  clickCell(mounted, 2, 2);
  press("4");
  unmount(mounted);

  const reopened = mount(model(4), "persist-me");
  const note = reopened.container.querySelector(".board-resume-note") as HTMLElement;
  check("re-opening a puzzle with saved progress offers to resume", !isHidden(note));
  check("the offer is not applied until it is accepted", reopened.svg.querySelectorAll("text.value-digit").length === 0);

  (reopened.container.querySelector(".resume-btn") as HTMLButtonElement).click();
  check("accepting the offer restores the saved digits", digitsOn(reopened).includes("4"));
  check("the banner goes away once accepted", isHidden(note));
  unmount(reopened);
}

{
  const mounted = mount(model(4), "never-touched");
  check("no resume banner without saved progress", isHidden(mounted.container.querySelector(".board-resume-note") as HTMLElement));
  unmount(mounted);
}

{
  // An empty saved grid is not worth offering to resume.
  const empty = model(4);
  saveProgress("empty-save", "empty-save", undefined, 0, empty);
  const mounted = mount(model(4), "empty-save");
  check("an empty saved grid does not trigger a resume offer", isHidden(mounted.container.querySelector(".board-resume-note") as HTMLElement));
  unmount(mounted);
}

// --- zoom ------------------------------------------------------------------

{
  const mounted = mount(model(4));
  const level = mounted.container.querySelector(".zoom-level") as HTMLElement;
  const [zoomOut, zoomIn] = [...mounted.container.querySelectorAll(".zoom-controls .icon-btn")] as HTMLButtonElement[];
  check("zoom starts at 100%", level.textContent === "100%");

  zoomIn!.click();
  check("zooming in steps up", level.textContent === "110%");
  check("zooming in scales the rendered size", mounted.svg.getAttribute("width") === String(4 * CELL * 1.1));

  for (let i = 0; i < 20; i++) zoomOut!.click();
  check("zoom clamps at its minimum", level.textContent === "50%");
  unmount(mounted);
}

// --- teardown --------------------------------------------------------------

{
  const first = model(4);
  const mountedFirst = mount(first);
  clickCell(mountedFirst, 0, 0);
  unmount(mountedFirst);

  const second = model(4);
  const mountedSecond = mount(second);
  clickCell(mountedSecond, 1, 1);
  press("3");
  check("a destroyed board no longer reacts to keystrokes", first.grid[0]![0]!.value === undefined);
  check("the live board still does", second.grid[1]![1]!.value === 3);

  const before = getVerificationPrefs().autoCandidates;
  unmount(mountedSecond);
  setVerificationPrefs({ autoCandidates: !before });
  check("a destroyed board unsubscribes from settings", second.grid[0]![0]!.candidates.size === 0);
  setVerificationPrefs({ autoCandidates: before });
}

console.log(failed ? "\nSMOKE TEST: FAILED" : "\nAll board checks passed.");
process.exitCode = failed ? 1 : 0;
