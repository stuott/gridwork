# Variant Sudoku Import & Solver — Background + Build Pipeline

A prototype plan for a modern-web-tech tool that can pull a variant sudoku from
a link found online (SudokuPad, f-puzzles.com, etc.), parse its rules, and
solve it locally — no dependency on the original site once the puzzle is
loaded.

Everything under **"Confirmed"** below was verified firsthand in this
investigation (we fetched a real puzzle, decompressed it, and inspected the
resulting JSON). Everything under **"Believed / needs verification"** is
inference from reading the surrounding code, not something we tested — treat
it as a to-do for Phase 1, not settled fact.

---

## 1. Background

### 1.1 What "f-puzzles format" is

[f-puzzles.com](https://www.f-puzzles.com/) is a browser-based variant-sudoku
_constructor_ — you build a puzzle visually and it produces a shareable link.
It's not a formally specified standard; there's no spec document anywhere.
What happened instead is that its JSON export shape became a **de facto
interchange format** because it was an early, widely-used tool in the
variant-sudoku community, and other tools (notably SudokuPad) built importers
for it to stay compatible. _(Exactly who built f-puzzles.com and when isn't
something we've verified — treat that origin story as community lore, not a
confirmed fact.)_

### 1.2 The schema (confirmed — this is real, decoded puzzle data)

Top-level keys are named after constraint types. Each is an array of "parts,"
so a puzzle can have several of the same constraint kind.

```json
{
  "size": 9,
  "title": "...",
  "author": "...",
  "ruleset": "free-text rules description",
  "grid": [
    [ {}, {}, { "value": 5, "given": true }, ... ],
    ...
  ],
  "antiknight": true,
  "killercage":      [{ "cells": ["R1C1","R1C2"], "value": "10" }],
  "renban":          [{ "lines": [["R4C5","R5C5","R5C6","R4C6"]] }],
  "ratio":           [{ "cells": ["R5C4","R4C4"] }],
  "difference":      [{ "cells": ["R5C3","R5C2"] }],
  "littlekillersum": [{ "cell": "R0C5", "direction": "DR", "value": "6" }],
  "solution": [1,9,6,7,5,2, "...81 digits total"]
}
```

Conventions:

- Cells are `R<row>C<col>`, **1-indexed**, top-left origin.
- Blank grid cells are `{}` — no `value`/`given` keys at all.
- `ratio` = Kropki white dot (consecutive); `difference` = Kropki black dot
  (2:1 ratio) — the meaning lives in _which key_ the pair is filed under, not
  in a field inside the object.
- There is no closed list of possible keys. New variant types get added by
  new keys; a parser that doesn't recognize a key should skip it, not error.

### 1.3 The SudokuPad layer on top (confirmed)

SudokuPad wraps f-puzzles data (and a couple of its own formats) in a
compression + ID scheme so puzzles fit in short URLs:

- **Puzzle ID → data.** For an ID under 20 characters, SudokuPad calls
  `GET /api/puzzle/<id>` and reads the `.result` field of the JSON response.
  IDs over 20 characters _are_ the compressed payload directly (no fetch
  needed).
- **Format prefix.** The payload string starts with a prefix telling the
  client which decoder to use: `fpuz`/`fpuzzles` (f-puzzles JSON), `scl`/`ctc`
  (SudokuPad's own compact schema — "Sudoku Community Library" per the
  variable naming, unconfirmed), or `scf` (a third, less common format).
- **Compression.** After stripping the prefix and URL-decoding, the remaining
  string is compressed with an **LZ-string variant** (see §1.4). `scl`/`ctc`
  payloads go through a second, different codec (`LZipper`, a 16-bit LZ
  variant) plus a bespoke key-shortening pass (`PuzzleZipper` — renames
  `cells`→`ce`, `wayPoints`→`wp`, etc. — this is minification, not
  compression).
- **Fallback URLs.** If the local API fails, SudokuPad tries a legacy proxy
  (`sudokupad.svencodes.com/ctclegacy/<id>`) and then a legacy Firebase
  Storage bucket. Believed to be there for old puzzle links predating the
  current backend — not verified firsthand.

### 1.4 The compression codec (confirmed, with one caveat)

The decompressor we extracted and ran successfully is a hand-inlined copy of
**[lz-string](https://github.com/pieroxy/lz-string)** (the popular
`compressToBase64` / `decompressFromBase64` algorithm) — recognizable by its
exact bit-packing structure (`resetValue = 32`, growing dictionary, etc.).

**Caveat, not yet verified:** SudokuPad's copy of the base64 alphabet ends in
a literal backslash (`...0123456789+/\`) where the standard lz-string
alphabet ends in `=` (used only as _post-hoc padding_, appended after
compression, never read during decompression). Because decompression never
reads that trailing padding, this swap is very likely inert — our hand-rolled
decompressor worked using it as-is, and there's a good chance the _stock_ npm
`lz-string` package's `decompressFromBase64` would produce identical output
without needing to reimplement anything. **This should be the first thing
Phase 1 verifies** — if true, it removes ~150 lines of code you'd otherwise
have to maintain yourself.

---

## 2. Architecture for a modern-web prototype

### 2.1 Stack suggestion

| Concern         | Suggestion                                       | Why                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language        | TypeScript                                       | The data model (constraint types, cell refs) benefits a lot from static typing — easy to typo `"ratio"` vs `"ratios"` otherwise.                                                                                                                                   |
| Build tool      | Vite                                             | Fast dev server, trivial static-site output, works well with a Web Worker for the solver.                                                                                                                                                                          |
| Solver location | Web Worker                                       | Backtracking search can spike CPU; keep it off the UI thread from day one so the board stays responsive.                                                                                                                                                           |
| Rendering       | SVG (hand-built, not the scraped one)            | You already have real cell/constraint coordinates from the parsed JSON — render your own board rather than reusing SudokuPad's stylesheet-dependent SVG from earlier in this conversation. Canvas is fine too if you want candidate-highlighting animations later. |
| Storage         | IndexedDB (or just localStorage for a prototype) | Cache fetched/decoded puzzles by ID so repeat loads don't hit the network.                                                                                                                                                                                         |
| Fetching        | Native `fetch`                                   | No need for anything heavier at this stage.                                                                                                                                                                                                                        |

### 2.2 The CORS problem (important — check this first)

`https://sudokupad.app/api/puzzle/<id>` is same-origin _for SudokuPad's own
page_. A static site you build and host elsewhere calling that same endpoint
from browser JS will likely hit a CORS block unless SudokuPad's server sends
permissive `Access-Control-Allow-Origin` headers for that route — **this is
unverified; test it before designing around either answer.**

Two outcomes:

- **If CORS is open:** great, this can be a 100%-static client-side app.
- **If CORS is blocked:** you need _something_ server-side to proxy the
  fetch — this can be extremely minimal (a single serverless function / edge
  route that fetches server-to-server and returns the JSON with permissive
  CORS headers added). This doesn't change the rest of the architecture, it
  just means "Phase 1 importer" has a thin server leg instead of being pure
  client JS.

Test this in five minutes with a throwaway `fetch()` from a local dev server
before committing to either path.

### 2.3 Module layout

```
src/
  importer/
    fetchPuzzle.ts        # ID → raw payload string (handles the CORS answer from §2.2)
    decode.ts             # strip prefix, lz-string decompress, (scl: also LZipper + PuzzleZipper unshorten)
    formats/
      fpuzzles.ts          # fpuz/fpuzzles → normalized model
      scl.ts                # scl/ctc → normalized model
  model/
    types.ts              # PuzzleModel, Cell, Constraint union types
  constraints/
    normalSudoku.ts        # rows/cols/boxes AllDifferent
    killerCage.ts
    kropki.ts               # ratio + difference
    renban.ts
    thermo.ts
    arrow.ts
    littleKiller.ts
    antiKnight.ts
    ...                     # one file per constraint family, added incrementally
  solver/
    engine.ts              # core search loop
    propagators.ts         # naked/hidden singles, per-constraint pruning
    worker.ts               # Web Worker entry point
  render/
    board.ts               # SVG board renderer, built from the normalized model
    overlays.ts             # cages, lines, dots, little-killer clues
  ui/
    App.tsx (or vanilla)    # paste a link/ID, show board, "Solve" button
```

The important design point: **the normalized model in `model/types.ts` is the
seam.** Both `fpuzzles.ts` and `scl.ts` parsers target the same internal
shape, so the solver and renderer never need to know which source format a
puzzle came from.

---

## 3. Suggested build phases

**Phase 0 — Parse & render, no network.**
Paste a raw f-puzzles JSON blob (skip fetching entirely) → normalize → render
a static SVG board with clue overlays. This validates the schema
understanding and the renderer before touching networking or solving at all.
Use the puzzle already decoded in this conversation as your first fixture.

**Phase 1 — Importer.**
Add `fetchPuzzle.ts` + `decode.ts`. Resolve the CORS question (§2.2) here.
Verify the stock `lz-string` package's `decompressFromBase64` against the
hand-rolled decompressor's output for the same input — if they match, delete
the hand-rolled version and depend on the library instead.

**Phase 2 — Normal-sudoku solver core.**
Bitmask-based backtracking solver for plain rows/cols/boxes only. Validate
against the `solution` field already present in decoded puzzles — that field
is a free correctness oracle, no need to hand-verify solutions yourself.

**Phase 3 — Constraints, one at a time.**
Add propagators incrementally, each with its own test puzzle: killer cages →
kropki (ratio/difference) → anti-knight → renban → little-killer sums →
arrows → thermometers. Each constraint is a self-contained pruning function
over candidate bitmasks, so they compose without touching each other's code.

**Phase 4 — UI polish.**
Solve button, step-by-step reveal (nice-to-have), paste-a-link input that
auto-detects SudokuPad vs raw-JSON vs a bare puzzle ID.

---

## 4. Open questions to resolve early (don't guess — test)

1. Does `sudokupad.app/api/puzzle/*` send CORS headers permissive enough for
   a third-party origin? (§2.2)
2. Does stock `lz-string`'s `decompressFromBase64` produce byte-identical
   output to the hand-rolled decompressor on a real payload? (§1.4)
3. What does f-puzzles.com's _own_ share-link format look like — is it the
   same `fpuz`-prefixed compressed payload, or does it inline plain JSON in
   the URL? Not checked in this conversation at all.
4. Is there a rate limit on the SudokuPad API worth respecting/caching
   against, given you're using an undocumented, unofficial endpoint?

---

## 5. Scope note

This whole pipeline reverse-engineers an undocumented API and an unspecified
data format from a third-party site. Fine for personal tooling and learning,
but worth being a considerate citizen about it if this grows beyond a
prototype: cache aggressively so you're not hammering their API, and don't
redistribute other authors' puzzle content beyond what you'd already do by
linking to it.

---

## 6. Reframing: this is a solving *assistant*, not an auto-solver

The project brief is: build a local tool to help **the user** solve puzzles
they find online — the computer does not solve the puzzle for them. Sections
2–5 above (written during the reverse-engineering investigation) frame the
solver engine as the point of the app, with a "Solve" button in Phase 4. That
framing is superseded by this section. The importer/decode architecture in
§2.3 is unchanged and still the right foundation — only the *purpose* of the
`solver/` module and the later phases change:

- The parser, decoder, and normalized model (§1–2) are exactly as useful for
  an assist tool as for an auto-solver — keep all of it as-is.
- A full backtracking `solver/engine.ts` is still worth building, but its
  output is used for **validation and candidate computation**, never to fill
  in the user's grid. Concretely: comparing the user's entries against the
  puzzle's `solution` field (win detection), computing legal candidates per
  cell for auto-pencil-marks, and (later, optional) a hint system that names
  a technique rather than a digit.
- There is no "Solve" button in the base app. If a hint system is added
  later (see §6.3), it explains *why* a cell is forced, it doesn't just fill
  it in.

### 6.1 Revised phases

**Phase 0 — Parse & render, no network.** *(unchanged from §3)* Paste a raw
f-puzzles JSON blob → normalize → render a static SVG/DOM board with clue
overlays. Validates the schema understanding and renderer before networking.

**Phase 1 — Importer.** *(unchanged from §3)* `fetchPuzzle.ts` + `decode.ts`,
resolving the CORS question (§2.2) — for a local-only tool, the simplest fix
is a Vite dev-server proxy (same-origin from the browser's point of view, so
no CORS headers are needed from SudokuPad at all). Verify stock `lz-string`'s
`decompressFromBase64` against real payloads.

**Phase 2 — Playable grid (this is the core of the app).** Digit entry,
manual pencil marks, auto-computed candidates (derived from classic
row/col/box rules plus whatever constraints are already parsed), conflict
highlighting (duplicate digits in a row/col/box/cage, and per-constraint
violations as they're added in Phase 3), win detection by comparing the
filled grid against the puzzle's `solution` field. No solving on the user's
behalf — highlighting a conflict is not the same as telling them the answer.

**Phase 3 — Common-variant support. DONE (2026-08-29).** Render + validate:
killer cages, thermometers, arrows, kropki dots (ratio/difference), odd/even
cells. "Validate" means extending conflict-highlighting to these constraint
types (e.g. a thermo cell lower than its neighbor toward the bulb lights up
red) — still not solving. `solver/validate.ts`'s `findConflicts` now checks
all five constraint types alongside the classic row/col/box/cage rules it
already had; `board.ts`'s generic per-cell conflict highlighting picked
these up automatically since it keys off `Conflict.cells`, not a hardcoded
constraint-type list. Regression-tested in `scripts/smoke-test-validate.ts`
(`npm run test:validate`) — 19 cases, one valid/invalid pair per constraint
type plus a two-cell "pill" arrow case. Auto-candidate pruning (the
pencil-mark auto-toggle) still only prunes by row/col/box, not by any of
these constraints -- that was already true for killer cages too, so it's
not a new gap, just an unstarted enhancement (see §6.3's toolkit wishlist).

**Phase 4 — Solving-assist toolkit. DONE (2026-08-29, keyboard shortcuts
completed 2026-08-30).** Timer (pausable, `state/timer.ts`), undo/redo
including pencil marks and highlight colors (`state/history.ts`, Ctrl+Z /
Ctrl+Shift+Z), colored cell highlighting (`Cell.highlightColor` +
`HIGHLIGHT_COLORS` in model/types.ts), save/resume via localStorage
(`state/persistence.ts`, keyed by a hash of the pasted input), import
history ("Recent puzzles" in main.ts), "what's forced here" hints for naked
single / hidden single / naked pair / pointing pair (`solver/hints.ts`),
mistake-checking-on-demand (a "Live conflict checking" toggle plus a
"Check now" button, `liveChecking`/`manualConflicts` in board.ts), and
zoom controls, all wired into render/board.ts. Every §6.3 wishlist item is
covered except literal click-and-drag panning (zoomed boards pan via
native scroll inside `.board-scroll-wrap` instead, which was judged
sufficient). Keyboard-first input now also covers the toolbar itself, not
just digit entry/navigation: P toggles pencil mode, H requests a hint, C
runs an on-demand check, Alt+1..6 sets the selected cell's highlight color
and Alt+0 clears it -- all guarded against stealing keystrokes from the
puzzle-import text field. Regression-tested in `scripts/smoke-test-phase4.ts`
(`npm run test:phase4`). See §9 for how this phase was built (concurrently
with Phase 5, which caused a real file-collision incident worth reading
before editing model/types.ts, render/board.ts, or style.css again).

**Phase 5 — Remaining variant coverage. DONE (2026-08-29).** See §6.2 for
the full list of what's now covered vs. still deferred. Everything except
`scl`/`ctc` decoding (tracked separately, see scl-format-roadmap.md),
region-sum lines, the row/column/box indexers, X-sum/skyscraper clues, the
entropic/modular/nabner/zipper/double-arrow/slow-thermometer line variants,
and the "negative constraint" forms of kropki/XV/nonconsecutive (those
imply a rule about *every* unmarked pair, not just the marked ones -- a
different validation shape than everything else here) is now parsed,
rendered, and conflict-checked.

### 6.2 Variant coverage: common set vs. what's left

**Covered by Phase 3 (common variants):** killer cages, thermometers,
arrows, kropki dots (ratio/difference = white/black dots, now with support
for a custom ratio/difference `value` when the puzzle overrides the
default), odd/even cells.

**Covered by Phase 5 (2026-08-29), all confirmed against
dclamage/SudokuSolver's FPuzzlesBoard.cs schema and SolverFactory.cs
wiring, same cross-verification method as Phase 3:**
- Renban lines, German whisper lines (custom minimum difference honored,
  defaulting to floor((size+1)/2)), palindrome lines -- one `LineConstraint`
  type (`model/types.ts`), distinguished by `kind`.
- Between lines (interior cells strictly between the two endpoint values).
- Little killer sums -- diagonal path resolved from the outside-grid clue
  cell + direction (`littleKillerPath` in fpuzzles.ts).
- XV pairs (X = sum 10, V = sum 5).
- Sandwich sums -- clue resolved to the full row or column it applies to
  (`sandwichPath`), sum checked between the 1 and the max-digit "crusts".
- Extra regions (an additional all-different region, like an extra box).
- Clone regions (paired cells that must match digit-for-digit).
- Quadruple circles (required digits checked as multiset containment once
  every cell in the group is filled, so a repeated required digit like two
  5s is handled correctly).
- Min/max cells (strictly less/greater than every orthogonal neighbor).
- Anti-knight / anti-king, disjoint groups (all three were already parsed
  into `globalRules` by the importer but never validated -- Phase 5 wired
  them into `findConflicts`), plus two new global rules: both diagonals
  (`diagonal+`/`diagonal-`) and nonconsecutive (no orthogonally-adjacent
  consecutive digits anywhere in the grid).

**Still documented but deliberately deferred** (kept as `unsupported` raw
data, not parsed):
- Region-sum lines (`regionsumline`) -- each segment within a box must sum
  equally; needs box-boundary-aware segmentation, more involved than the
  other line types.
- Row/column/box indexers (`rowindexer`/`columnindexer`/`boxindexer`).
- X-sum and skyscraper outside-grid clues (`xsum`/`skyscraper`) -- both
  need "how many cells are visible/counted from the edge" logic, not just
  a sum.
- Entropic lines, modular lines, nabner lines, double arrows, zipper
  lines, slow thermometers (`entropicline`/`modularline`/`nabner`/
  `doublearrow`/`zipperline`/`slowthermometer`).
- "Negative constraint" forms of kropki/XV/nonconsecutive (f-puzzles'
  `negative` array) -- these assert a rule about *every* unmarked adjacent
  pair in the grid, not just the explicitly marked ones, which is a
  different validation shape (a whole-grid scan, not a per-constraint
  check) from everything else `findConflicts` does today.
- Even/odd is covered above; **parity-adjacent but distinct and still not
  done:** even-only or odd-only *regions* rather than single cells (no
  confirmed f-puzzles JSON key for this was found during Phase 5's source
  research, unlike everything above).
- `scl`/`ctc` SudokuPad-native format: **decodes and renders as of
  2026-08-30, validates only partly** (see §7.6, and read it before changing
  this code — a first pass got the codec wrong and was corrected against a
  real payload). Decoding is done and confirmed against a real puzzle. An
  `scl` puzzle imports its grid/givens, killer cages, extra regions, and
  whole-grid rules as validated constraints, and its `lines`/`overlays`
  render faithfully as *decorations* — drawn, but deliberately not
  conflict-checked, because scl records no machine-readable meaning for
  them (that finding is now confirmed by real data, not inferred). So a
  variant like thermometers arrives visible-but-unvalidated when it comes
  from `scl`, while the same variant from f-puzzles is fully validated.

**Status (2026-08-29): built as Phase 4, except mistake-checking-on-demand.**
See §6.1's Phase 4 entry for what shipped and where. This list is kept
as-written (not rewritten with strikethroughs) since it's still the
reference for what each item was meant to do.

Beyond Phase 2's baseline (manual pencil marks, auto-candidates, conflict
highlighting, win detection), a fuller toolkit — not built now, listed so
it's easy to pick up later — would add:

- **Undo/redo** and a move history, including for pencil-mark edits.
- **Timer**, pausable, shown alongside the board.
- **Save/resume** — persist in-progress grids (IndexedDB/localStorage) keyed
  by puzzle ID so closing the tab doesn't lose progress.
- **Colored pencil marks / cell highlighting** for the user's own scratch
  work (a common technique aid in variant-sudoku communities), independent
  of the app's own candidate computation.
- **"What's forced here" hints** — name a technique (naked single, hidden
  pair, pointing pair, etc.) and highlight the cells/candidates involved,
  without revealing the digit. This is the one place the backtracking
  solver's internals get surfaced to the user, and only as an explanation.
- **Mistake checking on demand** ("check my grid so far") vs. always-on
  conflict highlighting — some solvers prefer to turn off live validation.
- **Zoom/pan** for large or visually dense variant boards.
- **Keyboard-first input** (arrow-key navigation, number-row entry, a
  toggle key for pencil-mark mode) as an alternative to mouse/touch.
- **Import history** — remember recently-solved/opened puzzle links.

## 7. Findings from actually building the scaffold

Section 6 was written before any code existed. Building the Phase 0-2 scaffold
turned up real answers to several of the open questions from section 4 --
recorded here rather than editing section 4's history away.

### 7.1 f-puzzles.com's own share-link format is now confirmed

Open question 3 asked what f-puzzles.com's own share links look like.
Confirmed by reading `dclamage/SudokuSolver`'s `SolverFactory.cs` (an
independent, actively-maintained f-puzzles-compatible solver, which includes
its own f-puzzles link *generator*, not just a parser):

```csharp
string fpuzzlesBase64 = LZString.CompressToBase64(fpuzzlesJson);
return justBase64 ? fpuzzlesBase64 : $"https://www.f-puzzles.com/?load={fpuzzlesBase64}";
```

So: `https://www.f-puzzles.com/?load=<payload>`, where `<payload>` is a
**bare** `LZString.compressToBase64(json)` -- no `fpuz`/`fpuzzles` prefix at
all, unlike every SudokuPad payload. `src/importer/decode.ts` now has a
fallback: if a payload doesn't start with `{` and doesn't match a known
prefix, it tries decompressing it unprefixed before giving up. Verified
against a synthetic payload in `scripts/smoke-test-importer.ts`.

### 7.2 Constraint field shapes cross-verified against a second real parser

The same `dclamage/SudokuSolver` repo's `PuzzleFormats/FPuzzlesBoard.cs` is a
complete, typed C# model of the f-puzzles JSON schema (it's the file the
solver deserializes into). Reading it confirmed every field-shape guess this
app had made:

- `killercage`: `{ cells: string[], value: string }` -- as assumed.
- `thermometer`: `{ lines: string[][], value: string }` -- as assumed.
- `arrow`: `{ lines: string[][], cells: string[] }`, where **`lines[i][0]` is
  the circle cell itself** (confirmed by `SolverFactory.cs`'s link-generator
  code, which builds `lines` as `[startCell, ...arrowCells]`) -- this app's
  `arrowCells` intentionally includes that leading circle cell so the
  rendered line starts at the circle.
- `odd` / `even`: `{ cell: string, value: string }` (singular `cell`) -- as
  assumed.
- `ratio` / `difference`: `{ cells: string[], value: string }` -- as assumed.
- `antiknight` / `antiking` / `disjointgroups`: plain booleans -- as assumed.

One assumption this *disproved*: there's a separate top-level `cage` key
(distinct from `killercage`) that looked like it might be a same-shape alias
worth also parsing as a killer cage. It isn't -- `SolverFactory.cs` shows
`cage` entries are matched against a `DR(\d+)` pattern in their `value` field
and treated as a "digit root" style constraint, not a sum cage. Left
unparsed (falls into `unsupported`) rather than mis-parsed as a cage.

### 7.3 A real SudokuPad puzzle sampled during testing was `scl`, not `fpuz`

Testing the fetch path against a real, current puzzle link
(`https://sudokupad.app/94Qq6qGjh2`, "Classic Sudoku by Cracking The
Cryptic") returned a payload starting with `scl` -- the unimplemented native
format -- not `fpuzzles`. This was only one sample, not a survey, but it's a
signal that puzzles created or re-saved directly in SudokuPad (as opposed to
imported from f-puzzles.com) may commonly use `scl`, which would make Phase
5's "implement the scl/ctc codec" more load-bearing than section 6.2 implied.
Worth re-prioritizing once real usage (which links people actually paste)
gives a better signal.

### 7.4 Known gap: jigsaw regions are detected and declined, not solved

`FPuzzlesGridEntry` (in the same schema file) has a `region` field on every
cell, letting a puzzle override the default 3x3 box shape per cell (jigsaw
sudoku). This app's `boxDims()` helper and everything downstream of it
(conflict validation, candidate computation, box grid-line rendering) assumes
uniform `boxW x boxH` tiling, so it still cannot *solve against* an irregular
layout.

What changed on 2026-08-31 (audit issue 1) is that it no longer pretends
otherwise. Both importers now read the layout well enough to answer one
question -- "is this the ordinary box grid?" -- and set
`PuzzleModel.irregularRegions` when it isn't: `fpuzzles.ts`'s
`hasIrregularRegions()` from the per-cell `region` field, `scl.ts` from a
non-empty `regions` array that its `regionsAreDefaultBoxes()` rejects. Both
compare *partitions*, not region indexes, so an ordinary grid that numbers
its boxes unusually is not mistaken for a jigsaw.

When the flag is set, `boxesAreChecked()` (model/types.ts) returns false and
every box-based path switches off together: box conflicts and disjoint
groups in `validate.ts`, box elimination in `candidates.ts`, box units and
pointing pairs in `hints.ts`, and the box outlines plus box peer-shading in
`board.ts`. The puzzle is checked on rows and columns only, and an import
note says so in as many words. That is CLAUDE.md's "never validate a rule the
puzzle might not have": before this, a jigsaw imported clean, rendered with
3x3 box lines it doesn't have, and was conflict-checked against regions that
are not its own -- silently.

Real jigsaw *support* (reading the region membership into the model and
validating against it) is still open, and is the natural next step now that
the layout is already being read.

### 7.5 Runtime interop note (doesn't affect the shipped app)

`lz-string`'s package has no clean ESM named exports -- under Vite (which
bundles it via esbuild, proven by `npm run build` succeeding) this is
invisible, but a plain Node ESM script that does
`import { decompressFromBase64 } from "lz-string"` fails at runtime with
"does not provide an export named...". `scripts/smoke-test-importer.ts`
works around this with `createRequire` + `require("lz-string")` rather than
changing `decode.ts`'s import style, since `decode.ts` only ever runs through
Vite in this app. Worth knowing if this code is ever reused outside a
Vite-bundled context (an SSR script, a CLI, a plain Node test runner).

### 7.6 scl/ctc format decoding -- implemented, then corrected against a real payload (2026-08-30)

**Read this section's second half before touching the scl code.** The first
implementation pass was built entirely from other projects' source code
(sudocle, penpa-to-scl) because no real `scl` payload could be fetched from
the dev sandbox. When a real one was finally obtained -- the user opened
`https://sudokupad.app/api/puzzle/70njbfg1zs` in a browser and pasted the
response back -- two of that pass's core conclusions turned out to be wrong.
Both are corrected below. The fixture now lives at
`scripts/fixtures/scl-70njbfg1zs.txt` and `npm run test:scl` runs against it.

**Correction 1: `scl`/`ctc` uses the SAME lz-string codec as `fpuz`.** The
first pass shipped `importer/formats/lzipper.ts`, a hand-ported LZW decoder,
on the assumption (from design.md 1.3 and the roadmap) that scl used a
different "LZipper" codec. It does not. The real payload decompresses
correctly with the stock `lz-string` `decompressFromBase64` this app already
depends on, and the ported decoder was verified to produce **byte-identical**
output -- they are the same algorithm, two implementations. The clue was
present and misread: sudocle's own file comment describes its decoder as
decompressing "an f-puzzles compressed buffer," and sudocle uses that one
decoder for both formats. `lzipper.ts` has been deleted; `decode.ts` now
decompresses both formats through the same call.

**Correction 2: real payloads are not necessarily PuzzleZipper-minified.**
The first pass ran the key-un-shortening pass unconditionally. The real
payload arrived as plain, valid, long-form JSON (`wayPoints`,
`backgroundColor`, `metadata` -- nothing shortened). Worse, running that pass
unconditionally is actively unsafe: its color-repair regex cannot distinguish
an unquoted color from an ordinary number, so it rewrites `{"value":123456}`
into `{"value":"#123456"}`. (The reference implementation it was ported from
has the same flaw.) `decode.ts` now tries strict `JSON.parse` first and only
falls back to `unshortenPuzzleZipper` when that fails, which keeps the
corruption away from every payload that doesn't need un-minifying.
`puzzleZipper.ts` is retained as that fallback -- sudocle applying it
unconditionally implies some payloads really are minified -- and
`smoke-test-scl.ts` asserts the corruption hazard directly so the ordering
can't be "simplified" away later.

**Confirmed, and the reason the scl work is shaped the way it is:** scl's
`lines`/`overlays` arrays are a *rendering* description, not a
semantically-tagged constraint list. The real payload settles what was
previously an inference: 47 lines and 23 overlays carrying only geometry plus
style. Its thermometers are white 0.35-cell lines with grey circle overlays
at the bulbs; its entropic lines are peach (`#fcaf`) at 0.15; its region
outlines are black hairlines at 0.01; three concentric blue lines frame the
board from -0.375 to 9.375. **Nothing anywhere says what rule any line
means** -- the distinction is visual convention only.

**So the parser splits scl content two ways** (`importer/formats/scl.ts`):
1. Unambiguous data becomes real, validated `Constraint`s -- grid/givens
   (`cells`), killer cages and extra regions (`cages`, whose `value`/`unique`
   fields are semantic rather than visual), whole-grid rules (`global`).
2. `lines`/`overlays` become `model.decorations` (`model/types.ts`), drawn
   faithfully by `board.ts`'s `drawDecorations()` but never validated.

That second channel is what makes scl puzzles usable at all. The real puzzle
here ("Sort by Size" by Marty Sears) is an **ISOFILL** puzzle -- a variant
this app has no concept of, with *zero given digits* -- yet once its markings
are drawn the board is fully legible and a human can solve it. That matches
what this app is for (design.md 6): a solving assistant, not an auto-solver.
Inferring constraint types from visual style was deliberately NOT done: it
would let the app claim it validates a rule it may have mis-identified, which
is worse than honestly not validating it.

**Coordinate/scale conventions, confirmed from the real payload:**
- Decoration coordinates are `[row, col]` in grid units where an integer is a
  cell *boundary* and X.5 is a cell *center*. Pixels are `margin + coord *
  CELL` -- exactly `gx`/`gy` with a fractional argument.
- Overlay `width`/`height` are already fractions of a cell; `thickness` is in
  the puzzle's own `cellSize` units and is normalized to a cell-fraction at
  parse time, so the renderer never needs the source scale.
- **`cellSize` defaults to 64**, derived rather than guessed: the real payload
  omits it, and every thickness resolves to a clean 2-decimal cell-fraction
  against 64 (22.4 -> 0.35, 9.6 -> 0.15, 0.64 -> 0.01, 3.84 -> 0.06) but to
  messy values against any other base. (sudocle assumes 50; that would be
  wrong here.)
- Decorations can extend outside the grid, so `board.ts` reserves margin from
  their bounding box (`decorationOverhangPx()`). Without it that blue frame is
  silently clipped away.

**Two UI fixes this exposed.** The imported `ruleset` text was parsed but
never displayed anywhere -- survivable while every supported constraint was
machine-validated, not survivable for scl puzzles where the prose rules are
the only thing explaining what the drawn shapes mean; it now renders as a
collapsible "Rules" panel (the CSS for one already existed, unused). And the
"unsupported constraint types" note was reporting pure noise -- `id`
(plumbing) and keys whose value was an *empty array*, i.e. telling the user a
puzzle was missing features it never had. It now reports only unhandled keys
that actually carry content, and separately states that scl markings are
drawn-but-not-checked.

**Still not done:** inferring real constraints from decoration style (a
thermometer is arguably identifiable by "bulb overlay at the end of a thick
line" -- the clearest signature available, but still a heuristic); jigsaw
`regions` (Section 7.4's gap, empty in this payload); the `scf` format. Also
unverified: `global`'s rule-name spelling, since this payload has no `global`
array.

### 7.7 A second real scl payload -- three things 7.6 got wrong (2026-08-30)

Puzzle `futilytnf4`, "Number 2" by Tom Fry: a penpa-converted Slow-Thermo
sudoku (`id: "penpa2d6cf4f..."`). Imported, it showed no title, no author, no
rules and bare grey lines with no bulbs. Three separate causes, all now
fixed; fixture `scripts/fixtures/scl-futilytnf4.txt`, covered by
`npm run test:scl`.

**1. Metadata lives in cell-less CAGES, not in `metadata`.** This is
SudokuPad's real convention, and section 7.6's fixture just happened not to
use it:

    cages: [{value: "solution: 123567894..."}, {value: "title: Number 2"},
            {value: "author: Tom Fry"},
            {value: "rules: Slow-Thermo Sudoku\n\n..."},
            {value: "msgcorrect: Hip-hip-pooray!!!"}]

`parseScl`'s cage loop skips any cage without `cells`, so all five were
dropped silently -- including the solution, which is what win-detection and
solution-checking need. `parseCageMetadata` now reads them, and every lookup
tries `metadata.<key>` first, then the cage carrying `<key>:`, then a
top-level key. Known keys so far: `title`, `author`, `rules`, `solution`,
`msgcorrect`.

**2. PuzzleZipper minification is real and common.** This payload is
minified (`ce`/`re`/`ca`/`l`/`u`/`v`/`th`/`wp`), so it is the first real
payload to take decode.ts's fallback branch. That branch turned out to be
correct as written -- including `c:CCCCCC` -> `"#CCCCCC"` and `r:t` ->
`true` -- and the JSON.parse-first ordering held. The "no real minified
payload has been captured yet" caveat in 7.6 is now closed.

**3. `underlays` was ignored entirely.** scl's `underlays` uses the same
shape vocabulary as `overlays` but draws *beneath* the lines, and it is where
thermometer bulbs live. All twelve bulbs were being dropped (and the array
reported as "unsupported"), which is why the board showed lines with no
bulbs. `PuzzleModel.decorations` now has a third array, `underlays`, drawn in
a pass before the lines.

**Thermometers are now real constraints -- the one sanctioned exception to
"never infer from style".** It isn't a style guess: SudokuPad tags the bulb
explicitly as `underlays: [{role: "thermobulb", ...}]`, and the bulb's centre
sits exactly on the first (or last) way-point of its line. `inferThermometers`
matches on that declared role plus an exact coordinate match, expands each
line's corner way-points into the full run of cells it crosses (way-points
record corners only -- `[[8.5,2.5],[8.5,8.5]]` is seven cells, not two), and
removes the consumed line and bulbs from `decorations` so nothing is drawn
twice. A line with no bulb, or whose way-points aren't a clean orthogonal or
diagonal cell path, is left alone as an unvalidated decoration.

**What the geometry genuinely cannot say: strict vs "slow".** A slow
thermometer (repeats allowed, values just mustn't decrease) is drawn exactly
like an ordinary one. Only the prose rules distinguish them, so
`rulesSaySlowThermo()` reads the ruleset text, `ThermoConstraint.slow`
carries the answer into `validate.ts`, and `PuzzleModel.importNotes` tells
the solver in the board's notes line which reading was used. Getting this
backwards is the expensive direction -- a strict check on a slow thermo flags
the solver's *correct* digits as mistakes -- so the app states its assumption
rather than hiding it.

**Two smaller noise fixes:** a `regions` array that merely restates the
default boxes (penpa conversions always emit one) is no longer reported as an
unsupported key -- true jigsaw regions still are, and since 2026-08-31 they
also switch box checking off entirely (Section 7.4). And SudokuPad's transparent full-grid `{class: "board-position"}`
underlay is dropped as plumbing, so the board doesn't claim an unexplained
marking when it has none.

**Verified end-to-end** with the headless-playwright recipe (serve
`out/renderer`, paste the payload into `#puzzle-input`): title/author header,
rules panel, 12 thermo lines + 12 bulbs, zero leftover decorations, no
console errors -- and the rendered board matches sudokupad.app's own drawing
of the same puzzle shape-for-shape.

**Process note.** Re-typing the ~1500-character payload into a shell
corrupted it (a greedy single-character repair search then started fitting
noise -- it "converges" on garbage; don't trust it). WebFetch reaches
sudokupad.app but won't echo a payload verbatim, and `device_bash` has no
network. What worked: the in-app browser on the user's machine, opening the
puzzle page and running `fetch('/api/puzzle/<id>')` with an inline lz-string
decoder, then writing the fixture back with a per-line SHA-256 check against
the live string.

## 8. Phase 6: Electron -- this is now a desktop app, not a browser tab

Added 2026-08-29 at the user's request, out of the original phase order in section 6.1 (retroactively, this is Phase 6). The app is now packaged with
[electron-vite](https://electron-vite.org/) rather than being a plain Vite
web app opened in a browser tab. This changes the project layout and,
usefully, resolves the CORS workaround from section 2.2 more cleanly than
the original dev-only proxy did.

### 8.1 What changed

- Project layout is now electron-vite's standard three-target shape:
  - `src/main/index.ts` -- the Electron main process. Creates the app
    window and owns the one privileged operation this app needs: fetching a
    puzzle from SudokuPad's API.
  - `src/preload/index.ts` -- a `contextBridge`-based preload script. The
    renderer has `contextIsolation: true` and `nodeIntegration: false`, so
    this is the *only* door between the renderer and anything privileged.
    It exposes exactly one function, `window.api.fetchText(url)`.
  - `src/renderer/` -- everything that used to be the whole app (`src/`) now
    lives at `src/renderer/src/`: `importer/`, `model/`, `render/`,
    `solver/`, `main.ts` (renderer entry, not to be confused with
    `src/main/index.ts`), `style.css`. `src/renderer/index.html` is the
    renderer's HTML entry (was the project-root `index.html`).
  - `electron.vite.config.ts` replaces the old `vite.config.ts`.
- **The CORS workaround from section 2.2 is now solved properly, not just
  worked around.** A fetch from the Electron *main* process (Node) has no
  CORS restriction at all -- in dev or in a packaged build. `src/main/index.ts`
  exposes a `fetch-text` IPC handler (restricted to an allow-list of the same
  three SudokuPad hostnames the importer already recognized), and
  `fetchPuzzle.ts`'s `fetchRaw()` calls it via `window.api.fetchText(...)`
  when present. The old same-origin dev-proxy path (`/api/puzzle/*`,
  `changeOrigin: true`) is kept as a fallback in `electron.vite.config.ts`'s
  `renderer.server.proxy` -- electron-vite's dev server serves the renderer
  at its own `http://localhost:...` URL alongside launching the Electron
  window, and that URL can also be opened directly in a regular browser for
  faster UI iteration, where `window.api` doesn't exist. Both paths are
  exercised by the same `fetchFromSudokuPadApi()` function.
- Security defaults: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` on the `BrowserWindow`, plus a restrictive CSP meta tag in
  `src/renderer/index.html` (`script-src 'self'`). The main process also
  checks the IPC-requested URL's hostname against an allow-list before
  fetching, rather than trusting the renderer's input blindly.
- `npm run dev` now runs `electron-vite dev` (opens the app window with
  hot-reload); `npm run build` runs `electron-vite build` (bundles all three
  targets to `out/`); `npm run typecheck` runs `tsc --noEmit` across all
  three targets from one shared `tsconfig.json` (a pragmatic simplification
  -- a stricter setup would split Node-context and DOM-context tsconfigs the
  way electron-vite's own project template does; not done here to keep this
  scaffold's surface area smaller).

### 8.2 What ISN'T done yet -- next phase (Phase 7: packaging/distribution)

This makes the app *runnable* as an Electron app in dev, and buildable, but
does not yet produce a distributable installer. That's a distinct phase:

- Add `electron-builder` and its config (per-OS targets: NSIS/portable for
  Windows, dmg for macOS, AppImage/deb for Linux).
- App icons in the sizes/formats each platform's packager wants.
- Code signing (or an explicit decision to ship unsigned for personal use --
  unsigned Windows/macOS builds trigger SmartScreen/Gatekeeper warnings).
- Auto-update, if wanted -- electron-updater is the common pairing with
  electron-builder.
- An actual `app.setName(...)`/`app.setAppUserModelId(...)` pass and a real
  window icon (currently just the favicon.svg carried over from the web
  version).

### 8.3 Verification note -- I could build this but not launch it

`npm run build` (`electron-vite build`) succeeded end to end: main, preload,
and renderer all bundle cleanly, and `npx tsc --noEmit` is clean across all
three. I could *not* verify the app actually opens a window, because the
sandboxed environment this was built in has restricted network egress that
blocks Electron's binary download (`@electron/get` fetches it from GitHub
Releases, and `github.com`/release-asset hosts aren't reachable from that
sandbox -- confirmed directly: `node node_modules/electron/install.js`
fails with a raw `fetch failed`, and `npx electron-vite dev` gets all the way
through building main/preload and starting the renderer dev server before
failing at the literal last step with `Error: Electron uninstall`, i.e. it
found no local Electron binary to launch). This is specific to the sandbox,
not the code -- a normal `npm install` on a machine with regular internet
access downloads the Electron binary as part of installing the `electron`
package, the same way any npm package with a postinstall download works.
**First thing to check when you run this yourself:** `npm install`, then
`npm run dev`, and confirm a window actually opens. If it doesn't, that's the
one part of this phase that's genuinely unverified rather than just
untested-by-me.

## 9. Concurrent-session collision (2026-08-29) -- Phase 4 vs Phase 5, and how it was recovered

Phase 4 (solving-assist toolkit) and Phase 5 (remaining variant coverage)
were implemented **at the same time by two different sessions** working on
this project on the user's machine, without either one knowing about the
other. This is the same class of risk the theme-system work flagged
earlier (see the "Collision and fix" note this file doesn't carry but
project memory's sudoku_theme_system.md does) -- but this time it was
worse: it silently broke the build, not just visually reverted a feature.

**What happened:** the Phase 4 session wrote `state/history.ts`,
`state/timer.ts`, `state/persistence.ts`, `solver/hints.ts`, and
`scripts/smoke-test-phase4.ts` (all self-contained, untouched by the other
session), then updated `model/types.ts` (adding `Cell.highlightColor` and
`HIGHLIGHT_COLORS`) and `main.ts` (calling `SudokuBoard` with a new 3rd
`{puzzleId, rawInput}` options argument), and was about to update
`render/board.ts` next to wire the timer/undo-redo/highlight/hint UI in.
Meanwhile the Phase 5 session read the *old* `model/types.ts` and
`render/board.ts` at the start of its work, did its research, then wrote
full-file replacements for both -- overwriting the Phase 4 session's
`types.ts` change and shipping a `board.ts` with the old 2-argument
constructor, before the Phase 4 session got to `board.ts` itself. Net
effect: `npm run typecheck` broke (`Cell.highlightColor` didn't exist,
`SudokuBoard` rejected the 3rd argument) even though neither session's
code was wrong in isolation.

**Why it wasn't caught sooner:** the Phase 5 session didn't run
`find src -newer package.json` (the exact check this file already
recommended after the *first* collision, in project memory) before
starting its edits. It was only caught afterward, when a routine
`npm run typecheck` came back with errors the Phase 5 session hadn't
caused directly.

**How it was recovered, without a git history to fall back on (this
project still has no version control -- see the Phase 3 memory note):**
every Phase 4 *module* had survived untouched (history.ts, timer.ts,
persistence.ts, hints.ts, main.ts, and critically `style.css`'s already-
complete Phase 4 CSS section with every class name -- `.board-timer-row`,
`.highlight-swatch.hl-<color>`, `.hint-panel`, `.zoom-controls`, etc. --
already defined). Reading those surviving files gave a complete, precise
contract for what `types.ts` and `board.ts` needed to expose, so the
missing pieces were reconstructed to match that contract (not guessed)
and `scripts/smoke-test-phase4.ts` -- also untouched -- served as the
verification oracle. All three smoke-test suites plus `npm run build`
passed after reconstruction with zero changes needed to the surviving
Phase 4 files themselves.

**Lesson for next time, stated plainly:** before writing to any file in
this project -- not just when something *looks* reverted -- run
`find src scripts -type f -newer package.json` (or a similarly-recent
reference file) and read anything unexpected in that list before touching
shared files (`model/types.ts`, `render/board.ts`, `style.css`, `main.ts`
have all been collision casualties at least once now). If a full-file
rewrite is about to replace a file, re-read it immediately beforehand,
not just at the start of the session -- concurrent sessions on this
project are a confirmed, recurring risk, not a one-off.

---

## 10. Multi-cell selection (2026-08-30)

The board used to hold a single `selected: {r, c} | null`. Everything that acted
on "the selection" -- digit entry, pencil marks, delete, the six highlight
swatches -- therefore acted on exactly one cell, which is the wrong shape for
variant solving: colouring a cage, pencilling the same pair into a whisper line,
or clearing a botched region are all multi-cell actions, and doing them one cell
at a time is the single most repetitive thing about using this app.

### 10.1 Where the state lives

`src/renderer/src/state/selection.ts` -- a `CellSelection` class holding a `Set`
of `"r,c"` keys plus an **anchor**: the most recently touched cell, which is what
arrow keys move from and what Shift+click rectangles are measured against. The
anchor is null exactly when nothing is selected. `delete()` deliberately leaves
the anchor alone, so rubbing a cell out doesn't move the origin the next
Shift+click measures from.

Splitting this out of `render/board.ts` is what makes it testable:
`scripts/smoke-test-selection.ts` (`npm run test:selection`) pins down all of it
-- plain click replaces, drag adds, Ctrl+click toggles, Shift+click fills a
rectangle in either direction and *adds* rather than replacing, select-all keeps
an existing anchor, clear drops it. `render/board.ts` keeps only the pointer and
keyboard plumbing, which needs a DOM.

### 10.2 Input model

| Gesture | Effect |
| --- | --- |
| Click | Select that cell alone |
| Click + drag | Paint a selection across cells |
| Ctrl/Cmd + click | Toggle one cell in/out; a drag continues in that direction |
| Shift + click | Add the rectangle from the anchor to the clicked cell |
| Arrow keys | Move the single selection |
| Shift + arrows | Extend the selection as you go |
| Ctrl/Cmd + A | Select the whole grid |
| Escape | Clear the selection |

Hit testing is done from **pointer coordinates** (`cellAt()`), not from a
listener on each cell `<rect>`. This matters: every selection change re-renders
the whole SVG, which destroys the very rect a drag is in the middle of, so
per-rect `pointerenter` handlers would drop cells mid-drag. The SVG is drawn at
`viewBox` size x zoom, so client pixels convert to grid units with one divide,
and the reserved little-killer/sandwich margin counts as outside the grid.
`setPointerCapture` on the `<svg>` keeps a drag alive when it wanders off the
board; `pointerup`/`pointercancel` on the document ends it wherever it ends.

### 10.3 What "apply to the selection" means per action

- **Digits**: written to every selected cell that isn't a given. Givens simply
  drop out of the target list, so a selection that mixes them still works.
- **Pencil marks**: fill-first toggle. The mark is added everywhere unless
  *every* target already carries it, in which case it's removed everywhere --
  the only reading of "toggle" that behaves predictably across several cells.
- **Delete/Backspace/0**: clears value and pencil marks on every editable
  selected cell.
- **Highlight colors**: same fill-first toggle, and a swatch only shows as
  active when every selected cell already carries that color.
- **Undo/redo**: unchanged. `HistoryManager` snapshots the whole grid, so a
  twenty-cell edit is one undo step for free.

Peer shading (the row/column/box tint) is switched off past a single selected
cell -- the union of every peer of a multi-cell selection covers most of the
grid and reads as noise. In its place, `drawSelectionOutline()` strokes the
perimeter of the selection (interior edges omitted, so a block reads as one
shape) over the grid lines, which keeps the selection legible on top of
highlight colors and cages.

### 10.4 Two incidental fixes

- Board shortcuts now also stand down while the settings modal is open, the same
  way section 9's fix made them stand down for text inputs. Without this,
  Escape would close the modal *and* clear the board selection underneath it.
- The board is centered in the app column (`.board-scroll-wrap { align-self:
  center }`) instead of hugging the left edge. The header and toolbar above it
  stay left-aligned; when the board is wider than the column the rule is a no-op
  and the wrapper just scrolls as before.

Note the tradeoff in `touch-action: none` on `.sudoku-svg`: drag-to-select now
owns touch gestures on the board, so on a touchscreen the board can no longer be
panned by dragging it directly (scroll the wrapper around it instead). This is
the same tradeoff f-puzzles and SudokuPad make.

## 11. Fog of war (2026-08-31)

Fog puzzles start with the board almost entirely covered. Cells are uncovered
("lit") by the lights the puzzle declares, and then by the solver's own
*correct* digits as they go. Until 2026-08-31 this app had no concept of fog
at all: a fog puzzle imported with its fog data silently discarded and the
whole board on show, which is not a harder version of the puzzle -- it's a
different, trivial one.

### 11.1 Where fog lives in the two formats

| Source | Key | Meaning |
| --- | --- | --- |
| f-puzzles | `fogofwar: ["R1C1", ...]` | each listed cell lights the 3x3 around itself |
| f-puzzles | `foglight: ["R1C1", ...]` | each listed cell lights only itself |
| scl/ctc | `cages: [{cells, value: "fow"}]` | as `fogofwar` (3x3 per cell) |
| scl/ctc | `cages: [{cells, value: "foglight"}]` | as `foglight` (single cell) |
| scl/ctc | top-level `fogofwar` / `foglight` | same two meanings |

The scl cage spelling is the same trick section 7.7 documented for
title/author/rules/solution: SudokuPad routes puzzle metadata through cages
whose `value` is a keyword rather than a sum. `scl.ts` therefore has to take
a fog cage out of the running *before* the killer-cage path reads `value`,
or a "fow" cage would be parsed as a sum-less cage outline.

Source for all of the above: sudocle's `fpuzzlesconverter.ts` /
`ctcpuzzleconverter.ts` (michel-kraemer/sudocle), which normalize every fog
spelling in both formats down to one `{center, size: 1 | 3}` shape -- the
shape `FogLight` copies.

**One row of that table is now confirmed against a real payload; the rest
is still research.** See 11.5. `foglight` on the f-puzzles side is settled.
`fogofwar` has not turned up in a real payload, and neither has any
scl-side fog spelling. Both importers accept `[row, col]` pairs *and*
"R1C1" strings in the scl fog lists for that reason -- which spelling scl
uses there isn't settled, the two are trivially distinguishable, and an
off-by-one on fog hides the wrong part of the puzzle rather than merely
looking wrong.

### 11.2 The reveal rule, and why fog is the one exception to the hard rule

CLAUDE.md's hard rule is that the app never solves a puzzle for the user, and
`solution` is used for win detection only. Fog reads `solution` for something
else: a digit is compared against it, and if it matches, its 3x3 patch
clears. That comparison is the variant's own rule -- fog that lifted for any
digit would make the puzzle trivially unfoggable -- so it is a deliberate,
documented exception rather than a drift. It stays within the spirit of the
rule in that the app still never shows a digit the solver hasn't earned: the
fog lifting confirms what they placed, it doesn't place anything.

The rule as implemented (`state/fog.ts`, matching sudocle's `makeFogLights`):

- a correct digit in a **non-given** cell lights the 3x3 centred on it,
  clipped at the grid edge;
- a wrong digit lights nothing;
- a **given** lights only itself and only once something else has uncovered
  it, so givens never extend the lit area and are simply skipped;
- with no `solution`, only the declared lights apply and the rest stays
  covered forever -- the importer says so in a note rather than letting the
  board look broken.

**One deliberate difference from sudocle:** it latches a given as
"discovered", so an uncovered given stays visible after the digit that
revealed it is erased. This app latches nothing. The mask is a pure function
of (declared lights + current grid + solution), which buys undo/redo and
save-and-resume for free -- erasing a digit puts its fog back, no fog state
is stored anywhere, and a resumed session re-derives exactly the same view.

### 11.3 Drawing it: one rect, drawn last

`render()` paints one opaque `.fog-cell` rect per covered cell *after* the
digits and every constraint/decoration layer. That single mechanism hides
everything the fog is supposed to hide -- givens, entries, pencil marks,
highlight colours, cage outlines, thermos, scl decorations, the grid lines
themselves -- and means no other draw routine in `board.ts` has to learn
about fog. The rects are edge-to-edge and stroked in their own fill colour so
a covered region reads as one bank of fog; any inset or corner rounding would
let the lines underneath show through and outline the very cells being
hidden. The selection outline is redrawn on top of the fog afterwards,
because a covered cell is still fully selectable and typeable -- fog hides
what's there, it doesn't lock the cell.

`.fog-cell` derives its colour from `--ink`/`--surface` with `color-mix`
rather than taking a token per theme: fog is "the board, obscured", so it
should follow whatever each of the six themes already sets those to.

### 11.4 Fog beats the solving aids

Everything that reasons about the grid runs against `revealedModel()` -- a
copy whose fogged cells hold no digit -- rather than the real grid:

- **conflicts**: otherwise a hidden given would flag a red cell and announce
  itself. This is the leak that most obviously breaks a fog puzzle, and
  `smoke-test-fog.ts` pins both halves of it (real grid conflicts, revealed
  view doesn't).
- **auto-candidates**: computed on the view, then the resulting sets are
  copied back onto the real cells, so a hidden digit never eliminates a
  candidate and thereby gives itself away.
- **hints**: found on the view, and a hint whose cells or elimination cells
  are still fogged is suppressed entirely with its own message. Even saying
  "there's a naked single here" would tell the solver that a covered cell is
  empty and placeable.

On a non-fog puzzle `computeFogMask` returns null and `revealedModel` hands
back the model itself, so none of this allocates or behaves differently from
before fog existed.

### 11.5 The real fixture, and the two noise bugs it caught (2026-08-31)

`scripts/fixtures/fpuz-fog-c74ujud2wz.txt` -- puzzle c74ujud2wz,
"Fogs-n-Dots-n-Knights" by Meggen033. Captured through the desktop app's
browser pane, since `sudokupad.app` is blocked from both the cloud sandbox
and `device_bash` (403 at the proxy on both), and verified byte-for-byte
against the server's own response: 2234 characters and two independent
hashes computed in the page and re-computed on disk. Worth repeating for the
next format question: **the payload came from a browser, not from curl**, and
transcription was checked rather than trusted.

It arrives as an **f-puzzles** payload despite the sudokupad.app URL, which
is itself worth knowing -- a "SudokuPad puzzle" is not automatically scl.

What it settled:

- **`foglight` is the single-cell light.** Its nine cells are exactly the
  central box (R4C4..R6C6) and the board lights exactly those nine. Read as
  3x3 lights they would have lit a 5x5 block of 25. One count, question
  closed.
- **The 3x3-on-a-correct-digit rule is right.** The puzzle has *zero
  givens*: nine lit empty cells plus that rule is the entire starting
  position. Nothing else would make it solvable, and the fixture check
  confirms a correct digit at R1C1 lights its clipped 2x2 corner while a
  wrong one lights nothing.
- **What it did not settle**: `fogofwar` and every scl-side spelling. Still
  research.

Two unrelated bugs it exposed in `fpuzzles.ts`, both in the "what isn't
supported" note rather than in solving:

1. `disabledlogic` and `truecandidatesoptions` are f-puzzles' own
   editor/solver settings, and were being reported to the solver as
   unsupported *constraints* -- the app claiming not to enforce rules the
   puzzle never had. Now filtered by a `PLUMBING_KEYS` set.
2. An **empty** value was reported the same way, so `truecandidatesoptions:
   []` announced a missing feature the puzzle doesn't use. `scl.ts` has
   skipped empty values since 7.7 for exactly this reason; the rule had
   never been carried across to the f-puzzles parser.

Still reported, and arguably still noise: f-puzzles' cosmetic `line` array.
In this puzzle it is a duplicate rendering of the `renban` lines that *are*
parsed and drawn, so the note reads oddly next to visible renban lines. The
accurate fix is to render f-puzzles cosmetic shapes (`line`, `circle`,
`rectangle`, `text`) through the same decorations channel scl uses, rather
than to stop mentioning them -- deferred, not forgotten.
