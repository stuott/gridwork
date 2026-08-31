# CLAUDE.md

Guidance for working in this repo. Read this before writing code here.

## What this app is

**Gridwork** — a local Electron app for **solving** variant sudoku puzzles the
user finds online. The user solves; the computer assists.

**The hard rule: this app never solves a puzzle for the user.** Hints name a
*technique* and point at cells — for a placement technique they deliberately do
not state the digit. Auto-candidates show what the classic rules still allow;
they are display-only and never write into the grid. `solution` is used for win
detection only and is never shown. Any feature that would hand over an answer
is out of scope, however convenient.

## Commands

```bash
npm run dev          # electron-vite dev (Electron window + renderer dev server)
npm run build        # production build into out/
npm test             # typecheck + all six smoke suites -- run this before finishing
npm run typecheck    # tsc --noEmit (strict is ON; keep it at zero errors)
```

Individual suites: `test:importer`, `test:scl`, `test:validate`, `test:phase4`,
`test:selection`, `test:board`.

## Before you edit: check for a concurrent session

```bash
find src scripts -type f -newer package.json
```

Two separate collisions have already broken this repo — a session read a file,
went off to research, then wrote a full-file replacement over another session's
in-flight work. Run the check at the start of a session **and again immediately
before any full-file rewrite** if real time has passed. If it turns up files you
didn't touch, read them fully before writing anything.

Highest-risk shared files: `model/types.ts`, `render/board.ts`, `style.css`,
`main.ts`.

## Layout

```
src/main/         Electron main: window, IPC (network fetch, window controls)
src/preload/      contextBridge -> window.api. The renderer's only privileged door.
src/renderer/src/
  importer/       paste -> PuzzleModel
    fetchPuzzle.ts   URL/ID -> raw payload (network via IPC)
    decode.ts        payload -> JSON + format detection
    formats/         fpuzzles.ts, scl.ts, puzzleZipper.ts
  model/types.ts  PuzzleModel + the Constraint union. The contract everything shares.
  solver/         validate.ts (conflicts), candidates.ts, hints.ts. No auto-solving.
  state/          selection, history (undo), timer, persistence (save/resume)
  render/board.ts The interactive SVG board. Largest file; see its section below.
  ui/             icons.ts, settingsModal.ts
  settings.ts     app-wide VerificationPrefs (load/save + pub/sub)
  theme.ts        theme pref load/save/apply
scripts/          smoke tests, one per area, plus real payload fixtures
assets/brand/     the mark, its rejected alternates, and the README banner
```

`design.md` is the deep technical reference. `phase-status.md` is the
non-technical progress summary — **update it when you finish a feature.**
`audit-2026-08-31.md` lists the known open issues; check it before assuming
something is a new bug.

## Invariants — get these wrong and things break quietly

**Cell coordinates.** Constraints store **1-indexed** `CellRef {row, col}`
(matching "R1C1"). `model.grid` is **0-indexed** `grid[row][col]`.
`cellRefToIndex()` is the only place that conversion should happen. Mixing
these produces an off-by-one that silently validates the wrong cells.

**Importers skip what they don't recognize; they never guess.** An unknown key
becomes an `unsupported` constraint so the board can tell the user what it
isn't enforcing. Never infer a constraint from how something *looks* — the one
exception is scl thermometers, and that earns it by matching a declared
`role: "thermobulb"` plus exact coordinates, not by colour or thickness.

**scl `decorations` are drawn, never validated.** SudokuPad's `lines`/
`overlays`/`underlays` are a rendering description with no semantic tagging, so
they're drawn faithfully and excluded from `Constraint`. Do not promote them
into the validated union — showing the user the real picture so they can apply
the rule themselves is the whole design. Corollary: anything scl draws that we
drop is a bug, because the picture is then incomplete (see the audit's open
items on `arrows` and overlay `text`).

**Never validate a rule the puzzle might not have.** If a layout can't be read
with confidence — jigsaw regions being the live example — report it as
unsupported rather than falling back to the default assumption. Silently
checking the wrong rule is worse than checking nothing.

**Preferences that outlive a board go in `settings.ts`.** A new `SudokuBoard`
is constructed on every puzzle load, and the settings modal is built
independently of any board, so shared state needs the load/save + `subscribe()`
shape `settings.ts` already has. `board.ts` subscribes in its constructor and
`destroy()` unsubscribes — keep that pairing.

**Toolbar buttons are icon buttons.** Build them with `iconButton()` and change
them with `setButtonIcon()`. Assigning `.textContent` to one deletes its `<svg>`
— that was a real shipped bug. Update `title` **and** `aria-label` together when
a button's meaning changes.

**The brand mark is one drawing, not a set.** The Gridwork mark lives in two
places on purpose: `titlebar.ts` (`BRAND_MARK`, inline SVG on
`stroke="currentColor"`, so `--ink` drives it and all six themes work off one
copy) and `public/favicon.svg` (a standalone asset the theme tokens can't
reach, so its two colours are literals — that's the only place a brand colour
is allowed to be hard-coded). Its weave gaps depend on `stroke-linecap="butt"`;
round caps extend half a stroke width past each endpoint and close them up.
`assets/brand/` holds the source SVGs and the alternates it was chosen from.

**Don't rename the `sudoku:` localStorage keys.** `settings.ts`,
`theme.ts` and `state/persistence.ts` all key off that prefix. It predates the
Gridwork name and is deliberately left alone: renaming it silently discards
every user's saved progress, history and theme choice on first launch.

**Colors live in CSS, never inline.** Elements set a class; `style.css` maps it
to a theme token. Six themes (`cool`/`warm`/`nebula` × light/dark) all key off
`data-theme`, so an inline color silently breaks five of them. Icons rely on
`stroke="currentColor"` for the same reason.

## render/board.ts

One class that owns the DOM, the SVG, the event plumbing and every draw
routine. Things to know:

- **Selection is handled on the `<svg>`, not per-rect.** Every selection change
  re-renders the whole SVG, which would destroy the very rect a drag is over.
  Hit testing goes through `cellAt()` from pointer coordinates. Don't add
  per-cell listeners.
- **Selection is always multi-cell.** A single cell is a selection of size 1, so
  digits, pencil marks, deletion and highlights all take the same path. For
  toggles across several cells, fill-first: only remove when *every* target
  already has it.
- **Keyboard shortcuts are on `document`,** so they must stay inert while focus
  is in a text input and while the settings overlay is open. Both guards exist
  because both were real bugs; `smoke-test-board.ts` pins them down.
- `render()` tears down and rebuilds the whole SVG. It runs on every selection
  change including each pointermove of a drag, so keep per-render work cheap.

## Testing

Every area has a `scripts/smoke-test-*.ts`: plain `tsx`, a hand-rolled
`check(label, condition)`, `process.exitCode = 1` on failure. No test
framework — match the existing style rather than introducing one.

- Pure logic gets a direct unit test (`selection`, `validate`, `phase4`).
- Anything needing a DOM goes in `smoke-test-board.ts`, which sets up jsdom
  globals and then **dynamically imports** the modules — `settings.ts` reads
  `localStorage` at module-evaluation time, so a static import would capture
  the wrong state.
- Board tests must `destroy()` every board they mount, or the `Timer` interval
  keeps the process alive.
- Format work needs a **real payload fixture** in `scripts/fixtures/`, not a
  synthetic one. Format research has been wrong here before; a real payload
  settled it every time.

Add tests in the same commit as the behavior. `npm test` must be green.

## Traps that have already cost time

- **`URLSearchParams` corrupts f-puzzles payloads.** It decodes `+` as a space,
  and base64 uses `+`. Parse the `load=` query manually with
  `decodeURIComponent`.
- **PuzzleZipper un-shortening is a fallback, not the normal path.** Its repair
  regex rewrites any bare 6-digit number into a colour string, so it must only
  run after strict `JSON.parse` has already failed. Don't hoist it.
- **scl and fpuz use the same lz-string codec.** An earlier hand-ported decoder
  for scl was deleted after producing byte-identical output.
- **SudokuPad puts title/author/rules/solution in cell-less `cages`,** not in a
  `metadata` object. Both spellings are read; don't drop the cage path.
- **`npm run build` needs file-deletion permission** when run through the agent
  sandbox — vite empties `out/` first and fails with `EPERM ... unlink`. That's
  the sandbox, not the code.

## Style

- TypeScript strict is on and the codebase compiles clean. Keep it that way.
- Comments explain *why*, especially where a decision looks arbitrary or where
  a format quirk was confirmed against a real payload — that's the house style
  throughout, and it's load-bearing given how much of this is reverse-engineered
  format handling. Don't strip it.
- No dependency should be added without a reason that a short helper can't meet.
