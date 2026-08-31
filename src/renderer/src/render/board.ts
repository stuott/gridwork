import {
  boxDims,
  cellRefToIndex,
  HIGHLIGHT_COLORS,
  type CellRef,
  type PuzzleModel,
  type SclDecorationOverlay,
} from "../model/types";
import { findConflicts, conflictCellKeySet, type Conflict } from "../solver/validate";
import { computeCandidates } from "../solver/candidates";
import { findHint, type Hint } from "../solver/hints";
import { HistoryManager } from "../state/history";
import { CellSelection } from "../state/selection";
import { Timer, formatElapsed } from "../state/timer";
import { loadProgress, saveProgress, applyProgress, type SavedProgress } from "../state/persistence";
import { getVerificationPrefs, subscribeVerification } from "../settings";
import { iconButton, iconSvg, setButtonIcon } from "../ui/icons";

const SVG_NS = "http://www.w3.org/2000/svg";
const CELL = 64;
/** Reserved outside-grid band for little killer arrows and sandwich sums (design.md Phase 5). Zero when the puzzle has none, so most puzzles render exactly as before. */
const MARGIN = 30;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/** Thin vertical rule separating groups of related toolbar buttons. */
function toolbarDivider(): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "toolbar-divider";
  el.setAttribute("aria-hidden", "true");
  return el;
}

export interface SudokuBoardOptions {
  /** Stable id for this puzzle's saved progress/history, derived from exactly what the user pasted (state/persistence.ts's hashInput). */
  puzzleId: string;
  /** The raw text the user pasted to load this puzzle -- kept so a resumed/re-opened entry can re-import it. */
  rawInput: string;
}

/**
 * Renders a PuzzleModel as an interactive SVG board. This is design.md
 * section 6.1's Phase 2 + Phase 3 + Phase 5 (entry, pencil marks,
 * auto-candidates, conflict highlighting across every constraint type the
 * importer parses) plus Phase 6.3's solving-assist toolkit (Phase 4):
 * a pausable timer, undo/redo (including pencil marks and highlight
 * colors), colored cell highlighting, "what's forced here" hints, and
 * save/resume via state/persistence.ts. Still no auto-solve -- hints name
 * a technique and point at cells, they never fill in a digit.
 *
 * Cell selection is multi-cell throughout: click, click-and-drag, Ctrl/Cmd+click
 * to toggle individual cells, Shift+click for a rectangle, Shift+arrows to
 * extend, Ctrl/Cmd+A for the whole grid, Escape to clear. Digits, pencil marks,
 * deletion and highlight colors all apply to every selected cell at once.
 */
export class SudokuBoard {
  private container: HTMLElement;
  private model: PuzzleModel;
  private options: SudokuBoardOptions;
  private svg: SVGSVGElement;
  private svgWrap: HTMLElement;
  private statusEl: HTMLElement;
  private pencilBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private hintBtn: HTMLButtonElement;
  private timerDisplay: HTMLElement;
  private timerToggleBtn: HTMLButtonElement;
  private resumeNote: HTMLElement;
  private hintPanel: HTMLElement;
  private hintTechniqueEl: HTMLElement;
  private hintMessageEl: HTMLElement;
  private zoomLevelEl: HTMLElement;
  private highlightSwatches: HTMLButtonElement[] = [];
  /**
   * Multi-cell selection. Stored as a Set of "r,c" keys plus an `anchor` --
   * the cell arrow-key navigation moves from, and the corner Shift+click
   * rectangles are measured against. A single-cell selection is just a
   * selection of size 1, so every action below (digits, pencil marks,
   * highlight colors, clearing) works identically whether one cell or twenty
   * are selected.
   */
  private selection = new CellSelection();
  /** Drag-paint state: null when no drag is in progress, otherwise whether the drag is adding or removing cells. */
  private dragMode: "add" | "remove" | null = null;
  private pencilMode = false;
  private autoCandidates = false;
  /** Design.md section 9 / the paused Phase 4 session's toolkit: live vs. on-demand mistake checking. */
  private liveChecking = true;
  private manualConflicts: Conflict[] | null = null;
  private margin = 0;
  private zoom = 1;
  private history: HistoryManager;
  private timer: Timer;
  private currentHint: Hint | null = null;
  private boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  /** A drag that ends off the board still has to end, so pointerup is watched on the document. */
  private boundPointerUp = () => this.endDrag();
  /** Detaches this board from the shared Verification settings (settings.ts). */
  private unsubscribeSettings: () => void = () => {};

  constructor(container: HTMLElement, model: PuzzleModel, options: SudokuBoardOptions) {
    this.container = container;
    this.model = model;
    this.options = options;
    this.margin = Math.max(this.needsMargin() ? MARGIN : 0, this.decorationOverhangPx());
    this.history = new HistoryManager(model);
    this.container.innerHTML = "";
    this.container.classList.add("board-root");

    const header = document.createElement("div");
    header.className = "board-header";
    const titleBits = [model.title, model.author ? `by ${model.author}` : undefined]
      .filter(Boolean)
      .join(" — ");
    header.textContent = titleBits || "Untitled puzzle";

    // --- ruleset text (collapsed by default) ---
    // Previously the imported `ruleset` was parsed but never shown, which was
    // survivable while every supported constraint was machine-validated. It
    // isn't survivable for scl/ctc puzzles: their markings are drawn without
    // known meaning (see drawDecorations), so the prose rules are the only
    // thing telling the solver what the shapes on the board actually do.
    const rules = document.createElement("details");
    rules.className = "board-rules";
    if (model.ruleset) {
      const summary = document.createElement("summary");
      summary.textContent = "Rules";
      const body = document.createElement("div");
      body.className = "board-rules-text";
      body.textContent = model.ruleset;
      rules.append(summary, body);
    } else {
      rules.hidden = true;
    }

    // --- resume-progress banner (hidden unless saved progress exists) ---
    this.resumeNote = document.createElement("div");
    this.resumeNote.className = "board-resume-note";
    this.resumeNote.hidden = true;

    // --- timer row ---
    const timerRow = document.createElement("div");
    timerRow.className = "board-timer-row";
    this.timerDisplay = document.createElement("span");
    this.timerDisplay.className = "timer-display";
    this.timerToggleBtn = iconButton("pause", {
      title: "Pause timer",
      className: "timer-toggle-btn",
      size: 14,
    });
    this.timerToggleBtn.onclick = () => {
      this.timer.toggle();
      const running = this.timer.isRunning();
      setButtonIcon(this.timerToggleBtn, running ? "pause" : "play", 14);
      const label = running ? "Pause timer" : "Resume timer";
      this.timerToggleBtn.title = label;
      this.timerToggleBtn.setAttribute("aria-label", label);
    };
    timerRow.append(this.timerDisplay, this.timerToggleBtn);
    this.timer = new Timer((seconds) => {
      this.timerDisplay.textContent = formatElapsed(seconds);
    });
    // Seed the readout: Timer only fires its callback on the first tick, so
    // without this the display sits blank for a second on every puzzle load.
    this.timerDisplay.textContent = formatElapsed(0);

    // --- action toolbar: entry mode, assists, undo/redo, clear ---
    // "Show auto-candidates" and "Live conflict checking" used to sit here as
    // bare checkboxes. They're preferences, not actions, so they now live in
    // the settings modal's Verification tab (settings.ts) and this row is
    // purely buttons you press.
    const toolbar = document.createElement("div");
    toolbar.className = "board-toolbar";

    this.pencilBtn = iconButton("pencil", {
      label: "Pencil",
      title: "Toggle pencil-mark entry (shortcut: P)",
      onClick: () => this.togglePencilMode(),
    });
    this.pencilBtn.setAttribute("aria-pressed", "false");

    this.hintBtn = iconButton("lightbulb", {
      label: "Hint",
      title: "Show what technique applies next, without revealing a digit (shortcut: H)",
      onClick: () => this.showHint(),
    });

    const checkNowBtn = iconButton("check", {
      label: "Check",
      title: "Check the grid for mistakes right now (shortcut: C)",
      onClick: () => this.checkNow(),
    });

    this.undoBtn = iconButton("undo", {
      title: "Undo (Ctrl+Z)",
      onClick: () => {
        if (this.history.undo()) this.afterEdit();
      },
    });

    this.redoBtn = iconButton("redo", {
      title: "Redo (Ctrl+Shift+Z)",
      onClick: () => {
        if (this.history.redo()) this.afterEdit();
      },
    });

    const clearBtn = iconButton("trash", {
      title: "Clear every entry and pencil mark",
      className: "icon-btn-danger",
      onClick: () => {
        this.history.record();
        for (const row of this.model.grid) {
          for (const cell of row) {
            cell.value = undefined;
            cell.pencilMarks.clear();
          }
        }
        this.afterEdit();
      },
    });

    toolbar.append(
      this.pencilBtn,
      this.hintBtn,
      checkNowBtn,
      toolbarDivider(),
      this.undoBtn,
      this.redoBtn,
      toolbarDivider(),
      clearBtn,
    );

    // --- highlight-color row ---
    const highlightRow = document.createElement("div");
    highlightRow.className = "highlight-row";
    const highlightLabel = document.createElement("span");
    highlightLabel.className = "highlight-row-label";
    highlightLabel.innerHTML = iconSvg("droplet", 15);
    const highlightLabelText = document.createElement("span");
    highlightLabelText.textContent = "Highlight";
    highlightLabel.appendChild(highlightLabelText);
    highlightRow.appendChild(highlightLabel);
    HIGHLIGHT_COLORS.forEach((color, i) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = `highlight-swatch hl-${color}`;
      swatch.setAttribute("aria-label", `Highlight the selected cells ${color} (shortcut: Alt+${i + 1})`);
      // .title (not aria-label) is also read back in updateHighlightSwatchState() to
      // identify which swatch this is -- keep it as the bare color name.
      swatch.title = color;
      swatch.onclick = () => this.setSelectedHighlight(color);
      this.highlightSwatches.push(swatch);
      highlightRow.appendChild(swatch);
    });
    const highlightClearBtn = iconButton("ban", {
      title: "Clear the highlight on the selected cells (shortcut: Alt+0)",
      className: "highlight-clear-btn",
      size: 15,
      onClick: () => this.setSelectedHighlight(undefined),
    });
    highlightRow.appendChild(highlightClearBtn);

    // --- hint panel (hidden until a hint is requested) ---
    this.hintPanel = document.createElement("div");
    this.hintPanel.className = "hint-panel";
    this.hintPanel.hidden = true;
    this.hintTechniqueEl = document.createElement("span");
    this.hintTechniqueEl.className = "hint-technique";
    this.hintMessageEl = document.createElement("span");
    this.hintMessageEl.className = "hint-message";
    const hintDismiss = iconButton("close", {
      title: "Dismiss hint",
      className: "hint-dismiss",
      size: 14,
      onClick: () => {
        this.currentHint = null;
        this.hintPanel.hidden = true;
        this.render();
      },
    });
    this.hintPanel.append(this.hintTechniqueEl, this.hintMessageEl, hintDismiss);

    // --- zoom controls ---
    const zoomControls = document.createElement("div");
    zoomControls.className = "zoom-controls";
    const zoomOutBtn = iconButton("minus", {
      title: "Zoom out",
      size: 15,
      onClick: () => this.adjustZoom(-ZOOM_STEP),
    });
    this.zoomLevelEl = document.createElement("span");
    this.zoomLevelEl.className = "zoom-level";
    const zoomInBtn = iconButton("plus", {
      title: "Zoom in",
      size: 15,
      onClick: () => this.adjustZoom(ZOOM_STEP),
    });
    zoomControls.append(zoomOutBtn, this.zoomLevelEl, zoomInBtn);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "board-status";

    const size = model.size;
    const px = size * CELL + this.margin * 2;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${px} ${px}`);
    this.svg.classList.add("sudoku-svg");
    this.svgWrap = document.createElement("div");
    this.svgWrap.className = "board-scroll-wrap";
    this.svgWrap.appendChild(this.svg);

    const notes = document.createElement("div");
    notes.className = "board-notes";
    const unsupportedKeys = [
      ...new Set(
        model.constraints
          .filter((c): c is Extract<typeof c, { type: "unsupported" }> => c.type === "unsupported")
          .map((c) => c.sourceKey),
      ),
    ];
    const noteLines: string[] = [];
    // scl/ctc puzzles carry their variant markings as raw shapes with no
    // machine-readable meaning (importer/formats/scl.ts) -- they're drawn
    // faithfully, but conflict-checking can't see them, and saying so
    // plainly is better than letting the board imply it's checking rules
    // it isn't. Nothing to say when every shape was recognized (thermos) or
    // was plumbing (the board-bounds rect) and none are left over.
    const shapeCount = model.decorations
      ? model.decorations.lines.length +
        model.decorations.overlays.length +
        model.decorations.underlays.length
      : 0;
    if (shapeCount > 0) {
      noteLines.push(
        `This puzzle's markings (${shapeCount} ${shapeCount === 1 ? "shape" : "shapes"}) are drawn from the source but not checked ` +
          `— SudokuPad's format doesn't record what rule each one means. Read the rules above and apply them yourself.`,
      );
    }
    if (unsupportedKeys.length > 0) {
      noteLines.push(`Not rendered/validated (unsupported constraint types in this puzzle): ${unsupportedKeys.join(", ")}`);
    }
    // Notes about how the import read the puzzle (e.g. thermometers
    // recovered from the drawing, and whether they were taken as strict or
    // "slow"). These say what IS being checked, so they go after the two
    // notes about what isn't.
    if (model.importNotes) noteLines.push(...model.importNotes);
    if (noteLines.length > 0) {
      notes.textContent = noteLines.join(" ");
    }

    // One control bar instead of three stacked rows: actions on the left,
    // status-ish readouts (timer, zoom) pushed to the right.
    const controlBar = document.createElement("div");
    controlBar.className = "board-controlbar";
    const controlBarRight = document.createElement("div");
    controlBarRight.className = "board-controlbar-right";
    controlBarRight.append(timerRow, zoomControls);
    controlBar.append(toolbar, controlBarRight);

    this.container.append(
      header,
      rules,
      this.resumeNote,
      controlBar,
      highlightRow,
      this.hintPanel,
      this.svgWrap,
      this.statusEl,
      notes,
    );
    document.addEventListener("keydown", this.boundKeyDown);
    // Selection is driven from the <svg> itself rather than from a listener on
    // every cell rect: each selection change re-renders the whole SVG, which
    // would destroy the very rect a drag is in the middle of, so hit testing
    // is done from pointer coordinates instead (see cellAt).
    this.svg.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    this.svg.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    document.addEventListener("pointerup", this.boundPointerUp);
    document.addEventListener("pointercancel", this.boundPointerUp);

    // Verification prefs are app-wide (settings modal -> Verification tab),
    // not per-board, so pick up the current values and stay subscribed --
    // a board that's already open must react when the user flips a checkbox.
    const prefs = getVerificationPrefs();
    this.autoCandidates = prefs.autoCandidates;
    this.liveChecking = prefs.liveChecking;
    if (this.autoCandidates) computeCandidates(this.model);
    this.unsubscribeSettings = subscribeVerification((next) => {
      this.autoCandidates = next.autoCandidates;
      this.liveChecking = next.liveChecking;
      if (this.autoCandidates) computeCandidates(this.model);
      if (this.liveChecking) this.manualConflicts = null;
      this.render();
    });

    this.setupResume();
    this.timer.start();
    this.updateUndoRedoButtons();
    this.render();
  }

  destroy() {
    document.removeEventListener("keydown", this.boundKeyDown);
    document.removeEventListener("pointerup", this.boundPointerUp);
    document.removeEventListener("pointercancel", this.boundPointerUp);
    this.unsubscribeSettings();
    this.saveProgress();
    this.timer.destroy();
  }

  private needsMargin(): boolean {
    return this.model.constraints.some((c) => c.type === "littleKiller" || c.type === "sandwich");
  }

  /**
   * How far outside the grid this puzzle's scl/ctc decorations reach, in
   * pixels. Real payloads do draw outside the grid: puzzle 70njbfg1zs frames
   * its board with three concentric border lines running from -0.375 to
   * 9.375 on a 9x9 grid. Without room reserved for them they're simply
   * clipped off by the SVG viewBox, silently losing part of the picture --
   * which is the whole thing decorations exist to preserve.
   */
  private decorationOverhangPx(): number {
    const deco = this.model.decorations;
    if (!deco) return 0;
    const size = this.model.size;
    let overhang = 0;
    const consider = (row: number, col: number, pad: number) => {
      overhang = Math.max(overhang, pad - row, pad - col, row - size + pad, col - size + pad);
    };
    for (const line of deco.lines) {
      const half = (line.thickness ?? 0) / 2;
      for (const [r, c] of line.wayPoints) consider(r, c, half);
    }
    for (const o of [...deco.overlays, ...deco.underlays]) {
      consider(o.center[0], o.center[1], Math.max(o.width, o.height) / 2);
    }
    return overhang > 0 ? Math.ceil(overhang * CELL) : 0;
  }

  private setupResume() {
    const saved = loadProgress(this.options.puzzleId);
    const hasContent = !!saved && saved.cells.some((row) => row.some((c) => c.value !== undefined || c.pencilMarks.length > 0));
    if (!saved || !hasContent) return;

    this.resumeNote.innerHTML = "";
    const label = document.createElement("span");
    const when = new Date(saved.savedAt).toLocaleString();
    label.textContent = `Resume progress saved ${when} (${formatElapsed(saved.elapsedSeconds)} elapsed)?`;
    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "resume-btn";
    resumeBtn.textContent = "Resume";
    resumeBtn.onclick = () => this.resumeProgress(saved);
    const dismissBtn = iconButton("close", {
      title: "Dismiss",
      className: "resume-note-dismiss",
      size: 13,
      onClick: () => {
        this.resumeNote.hidden = true;
      },
    });
    this.resumeNote.append(label, resumeBtn, dismissBtn);
    this.resumeNote.hidden = false;
  }

  private resumeProgress(saved: SavedProgress) {
    this.history.record();
    applyProgress(this.model, saved);
    this.timer.setSeconds(saved.elapsedSeconds);
    this.resumeNote.hidden = true;
    this.afterEdit();
  }

  private saveProgress() {
    saveProgress(this.options.puzzleId, this.options.rawInput, this.model.title, this.timer.getSeconds(), this.model);
  }

  /** Grid-space x/y for a 0-indexed cell center, honoring the reserved outside-grid margin. */
  private gx(c: number): number {
    return this.margin + c * CELL;
  }
  private gy(r: number): number {
    return this.margin + r * CELL;
  }

  /**
   * Display position for a clue cell that may sit outside the grid (little
   * killer / sandwich clues use out-of-range row or col indices -- see
   * design.md Phase 5's littleKillerPath/sandwichPath). In-range coordinates
   * map to the normal cell center; out-of-range coordinates map to the
   * middle of the reserved margin band on that side.
   */
  private marginPos(i: number): number {
    const size = this.model.size;
    if (i < 0) return this.margin / 2;
    if (i >= size) return this.margin + size * CELL + this.margin / 2;
    return this.gx(i) + CELL / 2;
  }

  private adjustZoom(delta: number) {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((this.zoom + delta) * 100) / 100));
    this.render();
  }

  private togglePencilMode() {
    this.pencilMode = !this.pencilMode;
    this.pencilBtn.classList.toggle("active", this.pencilMode);
    this.pencilBtn.setAttribute("aria-pressed", String(this.pencilMode));
    const label = `Pencil-mark entry: ${this.pencilMode ? "on" : "off"} (shortcut: P)`;
    this.pencilBtn.title = label;
    this.pencilBtn.setAttribute("aria-label", label);
  }

  private checkNow() {
    this.manualConflicts = findConflicts(this.model);
    this.render();
  }

  // ---- selection ----------------------------------------------------------

  /** Every selected cell, as model objects. */
  private selectedCellObjects() {
    return this.selection
      .cells()
      .map(({ r, c }) => this.model.grid[r]?.[c])
      .filter((cell): cell is NonNullable<typeof cell> => !!cell);
  }

  /** Selected cells the user may actually write into -- givens stay read-only. */
  private editableSelection() {
    return this.selectedCellObjects().filter((cell) => cell.given === undefined);
  }

  /**
   * Which cell a pointer event is over, or null when it is outside the grid
   * (the reserved margin band for little-killer/sandwich clues counts as
   * outside). The SVG is drawn at viewBox size x zoom, so client pixels
   * convert to grid units with a single divide.
   */
  private cellAt(e: PointerEvent): { r: number; c: number } | null {
    const box = this.svg.getBoundingClientRect();
    const x = (e.clientX - box.left) / this.zoom - this.margin;
    const y = (e.clientY - box.top) / this.zoom - this.margin;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r < 0 || c < 0 || r >= this.model.size || c >= this.model.size) return null;
    return { r, c };
  }

  private handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const at = this.cellAt(e);
    if (!at) return;
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+click: extend from the anchor to here, as a rectangle.
      this.selection.addRange(at.r, at.c);
      this.dragMode = "add";
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle this cell, and let the drag that follows keep
      // doing whatever the first cell did (add more, or rub more out).
      this.dragMode = this.selection.toggle(at.r, at.c) === "added" ? "add" : "remove";
    } else {
      // Plain click: start a fresh selection, and paint more cells if dragged.
      this.selection.selectOnly(at.r, at.c);
      this.dragMode = "add";
    }
    // Capture so a drag that wanders off the board keeps reporting moves --
    // cellAt() ignores anything outside the grid anyway.
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a convenience; selection still works without it */
    }
    this.render();
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.dragMode) return;
    const at = this.cellAt(e);
    if (!at) return;
    // Re-rendering on every pointermove that lands on an already-correct cell
    // would rebuild the SVG dozens of times per drag for no visible change.
    if (this.selection.has(at.r, at.c) === (this.dragMode === "add")) return;
    if (this.dragMode === "add") this.selection.add(at.r, at.c);
    else this.selection.delete(at.r, at.c);
    this.render();
  }

  private endDrag() {
    this.dragMode = null;
  }

  private setSelectedHighlight(color: string | undefined) {
    const cells = this.selectedCellObjects();
    if (cells.length === 0) return;
    // Toggle semantics carried over from single-cell selection: pressing the
    // color a cell already has clears it. Across several cells that only reads
    // as a toggle when they *all* already have that color -- a mixed selection
    // gets painted instead.
    const allSame = color !== undefined && cells.every((cell) => cell.highlightColor === color);
    const next = allSame ? undefined : color;
    this.history.record();
    for (const cell of cells) cell.highlightColor = next;
    this.afterEdit();
  }

  private showHint() {
    this.currentHint = findHint(this.model);
    this.hintPanel.hidden = false;
    if (this.currentHint) {
      this.hintTechniqueEl.textContent = this.currentHint.technique;
      this.hintMessageEl.textContent = this.currentHint.message;
    } else {
      this.hintTechniqueEl.textContent = "";
      this.hintMessageEl.textContent = "No hint available from the techniques this app knows -- try a different part of the grid, or work it out by hand.";
    }
    this.render();
  }

  private handleKeyDown(e: KeyboardEvent) {
    // Real bug found while reconstructing Phase 4 (design.md section 9): a global
    // keydown listener meant only for board shortcuts was also stealing keystrokes
    // from the puzzle-import text field (and any other text input) whenever a cell
    // happened to be selected. Ignore board shortcuts entirely while focus is on a
    // text input/textarea elsewhere on the page.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    // Same idea for the settings modal: while it's open its own Escape handler
    // and its controls own the keyboard, and board shortcuts (Escape clearing
    // the selection, P/H/C) have no business firing underneath it.
    const settingsOverlay = document.querySelector(".settings-overlay");
    if (settingsOverlay instanceof HTMLElement && !settingsOverlay.hidden) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        if (this.history.redo()) this.afterEdit();
      } else if (this.history.undo()) {
        this.afterEdit();
      }
      return;
    }

    // Keyboard-first shortcuts for the rest of the Phase 4 toolbar (design.md
    // section 6.3's "keyboard-first input" item) -- none of these need a
    // selected cell except the highlight shortcuts, which no-op via
    // setSelectedHighlight()'s own guard when nothing is selected.
    const noMod = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (noMod && e.key.toLowerCase() === "p") {
      e.preventDefault();
      this.togglePencilMode();
      return;
    }
    if (noMod && e.key.toLowerCase() === "h") {
      e.preventDefault();
      this.showHint();
      return;
    }
    if (noMod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      this.checkNow();
      return;
    }
    if (e.altKey && e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      const idx = Number(e.key);
      if (idx === 0) this.setSelectedHighlight(undefined);
      else {
        const color = HIGHLIGHT_COLORS[idx - 1];
        if (color) this.setSelectedHighlight(color);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.selection.selectAll(this.model.size);
      this.render();
      return;
    }
    if (e.key === "Escape" && this.selection.size > 0) {
      e.preventDefault();
      this.selection.clear();
      this.render();
      return;
    }

    const anchor = this.selection.anchor;
    if (!anchor || this.selection.size === 0) return;
    const { r, c } = anchor;

    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[e.key];
    if (delta) {
      const nr = Math.min(Math.max(r + delta[0], 0), this.model.size - 1);
      const nc = Math.min(Math.max(c + delta[1], 0), this.model.size - 1);
      // Shift+arrow grows the selection along the way; a bare arrow moves.
      if (e.shiftKey) this.selection.add(nr, nc);
      else this.selection.selectOnly(nr, nc);
      this.render();
      e.preventDefault();
      return;
    }

    // Givens aren't editable, so they simply drop out of the target list --
    // a selection that mixes givens and empty cells still works, it just
    // writes to the empty ones.
    const targets = this.editableSelection();
    if (targets.length === 0) return;

    if (e.key >= "1" && e.key <= "9") {
      const n = Number(e.key);
      if (n > this.model.size) return;
      this.history.record();
      if (this.pencilMode) {
        // A mixed selection fills in first: the mark is only removed when every
        // target already carries it, which is the only reading of "toggle" that
        // makes sense for more than one cell.
        const allHave = targets.every((target) => target.pencilMarks.has(n));
        for (const target of targets) {
          if (allHave) target.pencilMarks.delete(n);
          else target.pencilMarks.add(n);
        }
      } else {
        for (const target of targets) target.value = n;
      }
      this.afterEdit();
      e.preventDefault();
    } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      this.history.record();
      for (const target of targets) {
        target.value = undefined;
        target.pencilMarks.clear();
      }
      this.afterEdit();
      e.preventDefault();
    }
  }

  private afterEdit() {
    this.manualConflicts = null;
    this.currentHint = null;
    this.hintPanel.hidden = true;
    if (this.autoCandidates) computeCandidates(this.model);
    this.updateUndoRedoButtons();
    this.saveProgress();
    this.render();
  }

  private updateUndoRedoButtons() {
    this.undoBtn.disabled = !this.history.canUndo();
    this.redoBtn.disabled = !this.history.canRedo();
  }

  private el<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>,
  ): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }

  private render() {
    const { model, svg } = this;
    const { size, grid } = model;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const conflicts = findConflicts(model);
    const displayConflicts = this.liveChecking ? conflicts : this.manualConflicts ?? [];
    const conflictKeys = conflictCellKeySet(displayConflicts);
    const { boxW, boxH } = boxDims(size);

    const px = size * CELL + this.margin * 2;
    svg.setAttribute("width", String(px * this.zoom));
    svg.setAttribute("height", String(px * this.zoom));
    this.zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;

    // --- extra region / clone tints, drawn first so everything else layers on top ---
    this.drawExtraRegions(svg);
    this.drawCloneMarkers(svg);

    // --- cell backgrounds (click targets, selection/peer/conflict highlight) ---
    // Peer shading only means something for a single cell: the union of every
    // peer of a multi-cell selection covers most of the grid and reads as
    // noise, so it switches off past one selected cell.
    const solePeerSource = this.selection.sole();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const key = `${r},${c}`;
        const isSelected = this.selection.has(r, c);
        const isPeer =
          !!solePeerSource &&
          !isSelected &&
          (solePeerSource.r === r ||
            solePeerSource.c === c ||
            (Math.floor(solePeerSource.r / boxH) === Math.floor(r / boxH) &&
              Math.floor(solePeerSource.c / boxW) === Math.floor(c / boxW)));
        const classes = ["cell-bg"];
        if (isSelected) classes.push("selected");
        else if (isPeer) classes.push("peer");
        if (conflictKeys.has(key)) classes.push("conflict");

        const rect = this.el("rect", {
          x: this.gx(c),
          y: this.gy(r),
          width: CELL,
          height: CELL,
          class: classes.join(" "),
        });
        // No per-rect click listener: selection is handled on the <svg> (see
        // handlePointerDown) so it survives the re-render each change causes.
        svg.appendChild(rect);
      }
    }

    // --- user highlight colors (Phase 4) ---
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const color = grid[r]![c]!.highlightColor;
        if (!color) continue;
        svg.appendChild(
          this.el("rect", { x: this.gx(c), y: this.gy(r), width: CELL, height: CELL, class: `cell-highlight hl-${color}` }),
        );
      }
    }

    // --- hint overlay (Phase 4) ---
    if (this.currentHint) {
      for (const { r, c } of this.currentHint.eliminationCells ?? []) {
        svg.appendChild(this.el("rect", { x: this.gx(c), y: this.gy(r), width: CELL, height: CELL, class: "hint-elimination-cell" }));
      }
      for (const { r, c } of this.currentHint.cells) {
        svg.appendChild(this.el("rect", { x: this.gx(c), y: this.gy(r), width: CELL, height: CELL, class: "hint-cell" }));
      }
    }

    // --- diagonals, drawn under the grid lines ---
    this.drawDiagonals(svg);

    // --- variant overlays, drawn under the grid lines/digits ---
    this.drawCages(svg);
    this.drawKropkiDots(svg);
    this.drawThermos(svg);
    this.drawArrows(svg);
    this.drawOddEven(svg);
    this.drawLines(svg);
    this.drawBetweenLines(svg);
    this.drawXV(svg);
    this.drawMinMax(svg);
    this.drawQuadruples(svg);
    this.drawLittleKillers(svg);
    this.drawSandwiches(svg);

    // --- grid lines (thin, then thick box borders on top) ---
    for (let i = 0; i <= size; i++) {
      const thick = i % boxH === 0;
      svg.appendChild(
        this.el("line", {
          x1: this.gx(0),
          y1: this.gy(i),
          x2: this.gx(size),
          y2: this.gy(i),
          class: thick ? "grid-line-thick" : "grid-line-thin",
        }),
      );
    }
    for (let i = 0; i <= size; i++) {
      const thick = i % boxW === 0;
      svg.appendChild(
        this.el("line", {
          x1: this.gx(i),
          y1: this.gy(0),
          x2: this.gx(i),
          y2: this.gy(size),
          class: thick ? "grid-line-thick" : "grid-line-thin",
        }),
      );
    }

    // --- selection outline, over the grid lines so it stays readable ---
    this.drawSelectionOutline(svg);

    // --- scl/ctc decorations: drawn ON TOP of the grid lines (SudokuPad
    // draws thermos/lines over gridlines too) but under the digits. ---
    this.drawDecorations(svg);

    // --- digits / pencil marks (drawn last, on top) ---
    const notesCols = Math.ceil(Math.sqrt(size));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = grid[r]![c]!;
        const cx = this.gx(c) + CELL / 2;
        const cy = this.gy(r) + CELL / 2;

        if (cell.given !== undefined) {
          svg.appendChild(this.textEl(cx, cy, String(cell.given), "given-digit"));
        } else if (cell.value !== undefined) {
          svg.appendChild(this.textEl(cx, cy, String(cell.value), "value-digit"));
        } else {
          const marks = this.autoCandidates ? cell.candidates : cell.pencilMarks;
          for (const n of marks) {
            const idx = n - 1;
            const col = idx % notesCols;
            const row = Math.floor(idx / notesCols);
            const nx = this.gx(c) + (CELL / (notesCols + 1)) * (col + 1);
            const ny = this.gy(r) + (CELL / (notesCols + 1)) * (row + 1) + 4;
            svg.appendChild(this.textEl(nx, ny, String(n), "pencil-mark", 13));
          }
        }
      }
    }

    // --- status: win detection / conflict count ---
    this.renderStatus(conflicts, displayConflicts);
    this.updateHighlightSwatchState();
  }

  /**
   * Outlines the perimeter of the selection. The fill alone is hard to pick out
   * once several cells are selected over highlight colors or a killer cage, and
   * the outline makes the shape of a multi-cell selection obvious at a glance.
   */
  private drawSelectionOutline(svg: SVGSVGElement) {
    if (this.selection.size === 0) return;
    for (const { r, c } of this.selection.cells()) {
      const x0 = this.gx(c);
      const y0 = this.gy(r);
      const x1 = this.gx(c + 1);
      const y1 = this.gy(r + 1);
      // Only edges facing a cell that isn't selected: interior edges are left
      // out so a block of cells reads as one shape.
      const edges: [boolean, number, number, number, number][] = [
        [!this.selection.has(r - 1, c), x0, y0, x1, y0],
        [!this.selection.has(r + 1, c), x0, y1, x1, y1],
        [!this.selection.has(r, c - 1), x0, y0, x0, y1],
        [!this.selection.has(r, c + 1), x1, y0, x1, y1],
      ];
      for (const [draw, ax, ay, bx, by] of edges) {
        if (!draw) continue;
        svg.appendChild(this.el("line", { x1: ax, y1: ay, x2: bx, y2: by, class: "selection-edge" }));
      }
    }
  }

  private updateHighlightSwatchState() {
    // A swatch reads as "active" only when every selected cell already carries
    // that color -- matching what pressing it would toggle off.
    const cells = this.selectedCellObjects();
    const colors = new Set(cells.map((cell) => cell.highlightColor));
    const shared = cells.length > 0 && colors.size === 1 ? [...colors][0] : undefined;
    for (const swatch of this.highlightSwatches) {
      swatch.classList.toggle("active", shared !== undefined && shared === swatch.title);
    }
  }

  private textEl(x: number, y: number, content: string, className: string, size = 34) {
    const t = this.el("text", {
      x,
      y,
      class: className,
      "font-size": size,
      "text-anchor": "middle",
      "dominant-baseline": "central",
    });
    t.textContent = content;
    return t;
  }

  private drawCages(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "cage") continue;
      const cellsIdx = constraint.cells.map(cellRefToIndex);
      const cellSet = new Set(cellsIdx.map(({ r, c }) => `${r},${c}`));
      const inset = 5;
      for (const { r, c } of cellsIdx) {
        const x0 = this.gx(c) + inset;
        const y0 = this.gy(r) + inset;
        const x1 = this.gx(c + 1) - inset;
        const y1 = this.gy(r + 1) - inset;
        const hasNeighbor = (dr: number, dc: number) => cellSet.has(`${r + dr},${c + dc}`);
        if (!hasNeighbor(-1, 0)) svg.appendChild(this.el("line", { x1: x0, y1: y0, x2: x1, y2: y0, class: "cage-line" }));
        if (!hasNeighbor(1, 0)) svg.appendChild(this.el("line", { x1: x0, y1: y1, x2: x1, y2: y1, class: "cage-line" }));
        if (!hasNeighbor(0, -1)) svg.appendChild(this.el("line", { x1: x0, y1: y0, x2: x0, y2: y1, class: "cage-line" }));
        if (!hasNeighbor(0, 1)) svg.appendChild(this.el("line", { x1: x1, y1: y0, x2: x1, y2: y1, class: "cage-line" }));
      }
      if (constraint.sum !== undefined) {
        const top = cellsIdx.reduce((best, cur) =>
          cur.r < best.r || (cur.r === best.r && cur.c < best.c) ? cur : best,
        );
        const label = this.el("text", {
          x: this.gx(top.c) + inset + 4,
          y: this.gy(top.r) + inset + 11,
          class: "cage-sum",
          "font-size": 13,
        });
        label.textContent = String(constraint.sum);
        svg.appendChild(label);
      }
    }
  }

  private drawThermos(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "thermo" || constraint.cells.length === 0) continue;
      const pts = constraint.cells.map(cellRefToIndex).map(({ r, c }) => [this.gx(c) + CELL / 2, this.gy(r) + CELL / 2]);
      const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
      svg.appendChild(this.el("polyline", { points, class: "thermo-line" }));
      const [bx, by] = pts[0]!;
      svg.appendChild(this.el("circle", { cx: bx, cy: by, r: CELL * 0.32, class: "thermo-bulb" }));
    }
  }

  private drawArrows(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "arrow" || constraint.arrowCells.length === 0) continue;
      const pts = constraint.arrowCells
        .map(cellRefToIndex)
        .map(({ r, c }) => [this.gx(c) + CELL / 2, this.gy(r) + CELL / 2]);
      const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
      svg.appendChild(this.el("polyline", { points, class: "arrow-line" }));

      const last = pts.at(-1);
      const prev = pts.at(-2) ?? pts[0]!;
      if (last) {
        const [lx, ly] = last;
        const [px, py] = prev;
        const angle = Math.atan2(ly - py, lx - px);
        const size = 8;
        const p1 = [lx - size * Math.cos(angle - Math.PI / 6), ly - size * Math.sin(angle - Math.PI / 6)];
        const p2 = [lx - size * Math.cos(angle + Math.PI / 6), ly - size * Math.sin(angle + Math.PI / 6)];
        svg.appendChild(
          this.el("polygon", { points: `${lx},${ly} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`, class: "arrow-head" }),
        );
      }

      for (const ref of constraint.circleCells) {
        const { r, c } = cellRefToIndex(ref);
        svg.appendChild(
          this.el("circle", { cx: this.gx(c) + CELL / 2, cy: this.gy(r) + CELL / 2, r: CELL * 0.32, class: "arrow-circle" }),
        );
      }
    }
  }

  private drawKropkiDots(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "kropki") continue;
      const [a, b] = constraint.cells.map(cellRefToIndex);
      if (!a || !b) continue;
      const ax = this.gx(a.c) + CELL / 2;
      const ay = this.gy(a.r) + CELL / 2;
      const bx = this.gx(b.c) + CELL / 2;
      const by = this.gy(b.r) + CELL / 2;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      svg.appendChild(
        this.el("circle", {
          cx: mx,
          cy: my,
          r: 7,
          class: constraint.kind === "ratio" ? "kropki-ratio" : "kropki-difference",
        }),
      );
    }
  }

  private drawOddEven(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "oddEven") continue;
      const { r, c } = cellRefToIndex(constraint.cell);
      const cx = this.gx(c) + CELL / 2;
      const cy = this.gy(r) + CELL / 2;
      if (constraint.kind === "odd") {
        svg.appendChild(this.el("circle", { cx, cy, r: CELL * 0.36, class: "odd-marker" }));
      } else {
        const s = CELL * 0.62;
        svg.appendChild(
          this.el("rect", { x: cx - s / 2, y: cy - s / 2, width: s, height: s, class: "even-marker" }),
        );
      }
    }
  }

  /** Renban / German whisper / palindrome lines -- one path style per kind (design.md Phase 5). */
  private drawLines(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "line" || constraint.cells.length === 0) continue;
      const pts = constraint.cells.map(cellRefToIndex).map(({ r, c }) => [this.gx(c) + CELL / 2, this.gy(r) + CELL / 2]);
      const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
      const cls =
        constraint.kind === "renban" ? "renban-line" : constraint.kind === "whisper" ? "whisper-line" : "palindrome-line";
      svg.appendChild(this.el("polyline", { points, class: cls }));
    }
  }

  /** Between line: open circles ("bulbs") at both ends, thin connecting line. */
  private drawBetweenLines(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "betweenLine" || constraint.cells.length < 2) continue;
      const pts = constraint.cells.map(cellRefToIndex).map(({ r, c }) => [this.gx(c) + CELL / 2, this.gy(r) + CELL / 2]);
      const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
      svg.appendChild(this.el("polyline", { points, class: "between-line" }));
      for (const [x, y] of [pts[0]!, pts.at(-1)!]) {
        svg.appendChild(this.el("circle", { cx: x, cy: y, r: CELL * 0.3, class: "between-line-bulb" }));
      }
    }
  }

  /** XV: a small lettered marker at the midpoint of the two cells it joins. */
  private drawXV(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "xv") continue;
      const [a, b] = constraint.cells.map(cellRefToIndex);
      const mx = (this.gx(a.c) + CELL / 2 + this.gx(b.c) + CELL / 2) / 2;
      const my = (this.gy(a.r) + CELL / 2 + this.gy(b.r) + CELL / 2) / 2;
      svg.appendChild(this.el("circle", { cx: mx, cy: my, r: 10, class: "xv-marker-bg" }));
      svg.appendChild(this.textEl(mx, my + 1, constraint.kind, "xv-marker-text", 13));
    }
  }

  /** Min/max: a small chevron in the cell corner -- down-left for min, up-right for max. */
  private drawMinMax(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "minMax") continue;
      const { r, c } = cellRefToIndex(constraint.cell);
      const x0 = this.gx(c);
      const y0 = this.gy(r);
      const s = 11;
      const cls = constraint.kind === "min" ? "minmax-min" : "minmax-max";
      const points =
        constraint.kind === "min"
          ? `${x0 + 6},${y0 + CELL - 6} ${x0 + 6 + s},${y0 + CELL - 6} ${x0 + 6},${y0 + CELL - 6 - s}`
          : `${x0 + CELL - 6},${y0 + 6} ${x0 + CELL - 6 - s},${y0 + 6} ${x0 + CELL - 6},${y0 + 6 + s}`;
      svg.appendChild(this.el("polygon", { points, class: cls }));
    }
  }

  /** Quadruple: a filled circle straddling the shared corner, listing the required digits. */
  private drawQuadruples(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "quadruple" || constraint.cells.length === 0) continue;
      const idx = constraint.cells.map(cellRefToIndex);
      const cx = idx.reduce((sum, { c }) => sum + this.gx(c) + CELL / 2, 0) / idx.length;
      const cy = idx.reduce((sum, { r }) => sum + this.gy(r) + CELL / 2, 0) / idx.length;
      svg.appendChild(this.el("circle", { cx, cy, r: 16, class: "quadruple-circle" }));
      const label = constraint.values.join("");
      svg.appendChild(this.textEl(cx, cy + 1, label, "quadruple-text", label.length > 2 ? 10 : 12));
    }
  }

  /** Little killer: a diagonal arrow just outside the grid, with the target sum. */
  private drawLittleKillers(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "littleKiller") continue;
      const idx = cellRefToIndex(constraint.clueCell);
      const x = this.marginPos(idx.c);
      const y = this.marginPos(idx.r);
      svg.appendChild(this.textEl(x, y, String(constraint.sum), "little-killer-sum", 15));

      const dr = constraint.direction[0] === "U" ? -1 : 1;
      const dc = constraint.direction[1] === "L" ? -1 : 1;
      const len = 7;
      const x1 = x - dc * len;
      const y1 = y - dr * len - 12;
      const x2 = x + dc * len;
      const y2 = y + dr * len - 12;
      svg.appendChild(this.el("line", { x1, y1, x2, y2, class: "little-killer-arrow" }));
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headSize = 4;
      const h1 = [x2 - headSize * Math.cos(angle - Math.PI / 6), y2 - headSize * Math.sin(angle - Math.PI / 6)];
      const h2 = [x2 - headSize * Math.cos(angle + Math.PI / 6), y2 - headSize * Math.sin(angle + Math.PI / 6)];
      svg.appendChild(
        this.el("polygon", { points: `${x2},${y2} ${h1[0]},${h1[1]} ${h2[0]},${h2[1]}`, class: "little-killer-arrow" }),
      );
    }
  }

  /** Sandwich sum: the clue number just outside the grid, on the row/column it applies to. */
  private drawSandwiches(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "sandwich") continue;
      const idx = cellRefToIndex(constraint.clueCell);
      const x = this.marginPos(idx.c);
      const y = this.marginPos(idx.r);
      svg.appendChild(this.textEl(x, y, String(constraint.sum), "sandwich-sum", 15));
    }
  }

  /** Extra regions: a subtle background tint behind the region's cells, drawn before the normal cell backgrounds. */
  private drawExtraRegions(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "extraRegion") continue;
      for (const ref of constraint.cells) {
        const { r, c } = cellRefToIndex(ref);
        svg.appendChild(
          this.el("rect", { x: this.gx(c), y: this.gy(r), width: CELL, height: CELL, class: "extra-region-cell" }),
        );
      }
    }
  }

  /** Clone: a small corner marker on every clone cell, with a tooltip naming its partner. */
  private drawCloneMarkers(svg: SVGSVGElement) {
    for (const constraint of this.model.constraints) {
      if (constraint.type !== "clone") continue;
      for (const [a, b] of constraint.pairs) {
        for (const [self, partner] of [[a, b], [b, a]] as Array<[CellRef, CellRef]>) {
          const { r, c } = cellRefToIndex(self);
          const x0 = this.gx(c);
          const y0 = this.gy(r);
          const s = 10;
          const marker = this.el("polygon", {
            points: `${x0 + 3},${y0 + 3} ${x0 + 3 + s},${y0 + 3} ${x0 + 3},${y0 + 3 + s}`,
            class: "clone-marker",
          });
          const title = document.createElementNS(SVG_NS, "title");
          title.textContent = `Clone of R${partner.row}C${partner.col}`;
          marker.appendChild(title);
          svg.appendChild(marker);
        }
      }
    }
  }

  /**
   * Draws `model.decorations` -- the raw visual data from an scl/ctc puzzle
   * (see importer/formats/scl.ts). These are rendered literally, the way
   * SudokuPad itself would draw them, and are deliberately NOT validated:
   * nothing in the source data says what rule any given line means. The
   * point is to make the puzzle legible so a human can apply the rules from
   * the ruleset text, which is what a solving assistant is for.
   *
   * scl coordinates are [row, col] in grid units where an integer is a cell
   * boundary and X.5 is a cell center, so a coordinate maps to pixels as
   * `margin + coord * CELL` -- exactly this.gx/this.gy's formula with a
   * fractional argument. Sizes/thicknesses arrive as fractions of one cell
   * (normalized in scl.ts), so they just multiply by CELL.
   */
  private drawDecorations(svg: SVGSVGElement) {
    const deco = this.model.decorations;
    if (!deco) return;

    const px = (col: number) => this.margin + col * CELL;
    const py = (row: number) => this.margin + row * CELL;

    // scl draws underlays beneath the lines and overlays above them; that
    // stacking is load-bearing (a thermo bulb is an underlay that would
    // otherwise hide the line's rounded cap, cell shading would paint over
    // the lines, etc.), so keep the three passes in this order.
    for (const u of deco.underlays) this.drawDecorationShape(svg, u);

    for (const line of deco.lines) {
      const points = line.wayPoints.map(([r, c]) => `${px(c)},${py(r)}`).join(" ");
      const attrs: Record<string, string | number> = {
        points,
        class: "scl-decoration-line",
        fill: line.fill ?? "none",
        stroke: line.color ?? "currentColor",
        "stroke-width": (line.thickness ?? 0.02) * CELL,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      };
      svg.appendChild(this.el("polyline", attrs));
    }

    for (const o of deco.overlays) this.drawDecorationShape(svg, o);
  }

  /** Draws one scl overlay/underlay shape (they share a shape vocabulary; only their stacking order differs). */
  private drawDecorationShape(svg: SVGSVGElement, o: SclDecorationOverlay) {
    const cx = this.margin + o.center[1] * CELL;
    const cy = this.margin + o.center[0] * CELL;
    const w = o.width * CELL;
    const h = o.height * CELL;
    const stroke = o.borderColor ?? "none";
    const strokeWidth = (o.thickness ?? 0) * CELL;

    // `rounded` means an ellipse (SudokuPad's circles/bulbs); otherwise a
    // rectangle -- which is also how region borders arrive, as very thin
    // rotated rects rather than as lines.
    const shape = o.rounded
      ? this.el("ellipse", {
          cx,
          cy,
          rx: w / 2,
          ry: h / 2,
          class: "scl-decoration-overlay",
          fill: o.backgroundColor ?? "none",
          stroke,
          "stroke-width": strokeWidth,
        })
      : this.el("rect", {
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          // A zero-height rect would be invisible; scl uses height 0.01 for
          // hairline region borders, so floor it at something drawable.
          height: Math.max(h, 1),
          class: "scl-decoration-overlay",
          fill: o.backgroundColor ?? "none",
          stroke,
          "stroke-width": strokeWidth,
        });

    if (o.angle) {
      shape.setAttribute("transform", `rotate(${o.angle} ${cx} ${cy})`);
    }
    svg.appendChild(shape);
  }

  private drawDiagonals(svg: SVGSVGElement) {
    const { size, globalRules } = this.model;
    if (globalRules.diagonalNegative) {
      svg.appendChild(
        this.el("line", { x1: this.gx(0), y1: this.gy(0), x2: this.gx(size), y2: this.gy(size), class: "diagonal-line" }),
      );
    }
    if (globalRules.diagonalPositive) {
      svg.appendChild(
        this.el("line", { x1: this.gx(0), y1: this.gy(size), x2: this.gx(size), y2: this.gy(0), class: "diagonal-line" }),
      );
    }
  }

  /**
   * `conflicts` is always the real, fully-live conflict list (used for win
   * detection, which shouldn't depend on whether live display is on).
   * `displayConflicts` is what's actually shown/highlighted -- equal to
   * `conflicts` when live checking is on, or just the last "Check now"
   * result (or nothing) when it's off.
   */
  private renderStatus(conflicts: Conflict[], displayConflicts: Conflict[]) {
    const { model } = this;
    const allFilled = model.grid.every((row) => row.every((cell) => cell.given !== undefined || cell.value !== undefined));

    if (!allFilled) {
      const bits: string[] = [];
      if (this.selection.size > 1) bits.push(`${this.selection.size} cells selected`);
      if (displayConflicts.length > 0) bits.push(`${displayConflicts.length} conflict(s) found.`);
      this.statusEl.textContent = bits.join(" · ");
      this.statusEl.className = displayConflicts.length > 0 ? "board-status has-conflicts" : "board-status";
      return;
    }

    if (model.solution) {
      const matches = model.grid.every((row, r) =>
        row.every((cell, c) => (cell.given ?? cell.value) === model.solution![r]![c]),
      );
      if (matches && conflicts.length === 0) {
        this.statusEl.textContent = "Solved! Every cell matches the puzzle's solution.";
        this.statusEl.className = "board-status solved";
        this.timer.pause();
        // Swap the icon, never the text: this is an icon button, and
        // assigning .textContent here used to delete its <svg> outright and
        // leave a bare word in the middle of an icon-only toolbar.
        setButtonIcon(this.timerToggleBtn, "play", 14);
        this.timerToggleBtn.title = "Resume timer";
        this.timerToggleBtn.setAttribute("aria-label", "Resume timer");
        return;
      }
      this.statusEl.textContent = "Grid is full, but it doesn't match the solution yet.";
      this.statusEl.className = "board-status has-conflicts";
      return;
    }

    this.statusEl.textContent =
      displayConflicts.length === 0
        ? "Grid is full with no detected conflicts (this puzzle didn't include a solution to verify against)."
        : `${displayConflicts.length} conflict(s) found.`;
    this.statusEl.className = displayConflicts.length === 0 ? "board-status solved" : "board-status has-conflicts";
  }
}
