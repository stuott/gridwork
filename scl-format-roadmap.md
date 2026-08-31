# Roadmap: supporting SudokuPad's native `scl`/`ctc` format

Status (updated 2026-08-30, second pass): **decoding is DONE and confirmed
against a real payload.** A real `scl` puzzle now loads, renders its markings,
and shows its rules. See design.md section 7.6 for the full writeup --
including two conclusions from this roadmap that turned out to be WRONG once
a real payload was available, corrected there and summarized in Section 3.1
below. Test fixture: `scripts/fixtures/scl-70njbfg1zs.txt`, exercised by
`npm run test:scl`.

Short version of what changed: there is no separate "LZipper" codec -- scl
uses the same lz-string codec as fpuz. PuzzleZipper minification is optional
and was absent from the real payload. What IS real, and confirmed rather than
merely suspected, is that scl's `lines`/`overlays` carry no semantic tags, so
they are drawn but not validated.

Originally written 2026-08-29 after a real puzzle load failed on ID
`70njbfg1zs` -- that same puzzle is now the regression fixture. See
`sudoku_scaffold.md` project memory and design.md sections 1.3-1.4, 6.2, 7.3
and 7.6 for context.

## 1. Why this matters now

Two different real SudokuPad puzzle links sampled during this project have
both turned out to be `scl`, not the `fpuz` format the importer already
handles (`94Qq6qGjh2` during initial testing, `70njbfg1zs` from today's bug
report). That's a small sample, but combined with how SudokuPad's own editor
saves puzzles, it's a strong signal that **any puzzle created or re-saved
directly in SudokuPad -- as opposed to imported from f-puzzles.com --
probably defaults to `scl`.** Since the whole point of this app is loading
puzzles you find online, this is very likely the single biggest gap between
"the importer handles f-puzzles-sourced puzzles" and "the importer handles
puzzles you'll actually paste in."

## 2. What's confirmed (CORRECTED 2026-08-30 against a real payload)

⚠️ The original version of this section stated the scl codec was a distinct
"LZipper" algorithm. **That was wrong** and it misled the first
implementation pass into writing a decoder that wasn't needed. Corrected:

- SudokuPad payloads are `<prefix><compressed-data>`. **Both `fpuz`/`fpuzzles`
  and `scl`/`ctc` use the same `lz-string` `compressToBase64` codec** --
  verified by decompressing a real `scl` payload with stock `lz-string`, and
  separately by confirming a hand-ported "LZipper" decoder produced
  byte-identical output. There is one codec here, not two.
- `PuzzleZipper` key-shortening (`cells` -> `ce`, `wayPoints` -> `wp`) is a
  **separate and optional** step. The real payload examined had none of it --
  plain long-form JSON. `decode.ts` therefore tries strict `JSON.parse` first
  and un-shortens only on failure (which also avoids a regex hazard that
  corrupts 6-digit numbers; see design.md 7.6).
- `decode.ts` handles `scl`/`ctc` fully now; `formats/scl.ts`'s `parseScl()`
  is implemented. The "not supported yet" error remains only for `scf`.
- `scf` is a third, rarer format, structurally unrelated to whether `scl`
  gets solved -- out of scope for this roadmap, tracked separately.

**Lesson worth carrying:** every wrong conclusion in this document came from
reasoning about the format via other people's source code, and every one was
settled in minutes by one real payload. For a format question, get a real
sample first; treat source-reading as a hypothesis generator only.

## 3. What this research session found (new)

Searched for public source code or documentation of `LZipper` and
`PuzzleZipper` specifically, since design.md flagged both as unverified
guesses. Findings, in order of usefulness:

**A real, standalone library literally named `LZipper` exists and is
public:** [github.com/blindman67/LZipper](https://github.com/blindman67/LZipper)
(`LZipperLite.js`, author Mark Spronck). It's genuine LZW compression
(dictionary/`Map`-based, not the lz-string algorithm), bit-packs into
16-bit accumulated values with a growing dictionary, and includes
`data16to8Bit()`/`data8to16Bit()` helpers specifically to make Unicode
output Base64-safe. This lines up well with design.md's "16-bit LZ variant"
description and is a strong candidate for what SudokuPad inlined or
adapted -- **but this is a lead, not a confirmed match.** The same project
already learned once (with `lz-string`/`fpuz`) that SudokuPad's copy of a
third-party codec can have a small deliberate tweak (the swapped trailing
alphabet character noted in design.md 1.4), so this needs byte-for-byte
verification against real payloads before being trusted, not just a
"looks similar" judgment.

**`PuzzleZipper`'s exact key-mapping table was not found publicly
documented anywhere.** No dedicated open-source repo, gist, or file
turned up containing the literal shortened-key table. This is the
single biggest unknown in this whole effort and the main cost driver.

**Four concrete leads worth investigating first**, before reverse-engineering
blind:

1. [github.com/SudokuPad/puzzleformats](https://github.com/SudokuPad/puzzleformats)
   -- the SudokuPad org's own "documentation for puzzle data encoding...
   formats" repo. An automated fetch only surfaced the README's title, not
   its full content -- this needs an actual read (clone it or browse it
   directly), not another automated summary pass.
2. [github.com/SudokuPad/puzzle-features](https://github.com/SudokuPad/puzzle-features)
   -- planning/discussion repo, already flagged in design.md 5, not yet
   actually read.
3. [github.com/marktekfan/penpa-to-scl](https://github.com/marktekfan/penpa-to-scl)
   (npm: `@sudokupad/penpa-to-scl`) -- an **officially `@sudokupad`-scoped**
   package that *builds* scl-format puzzle objects (from Penpa+ puzzles).
   Its source necessarily encodes the full, un-shortened scl schema's field
   names as a converter target, which makes it a strong schema reference
   even if it turns out not to perform the final PuzzleZipper shortening
   step itself. Worth cloning and reading its `src/` directly -- this
   session's remote file-fetch attempts hit 404s on guessed paths (no
   working directory listing was reachable through the tools available
   here), so this needs a real `git clone` and `ls`, which the implementer
   should do locally rather than repeating blind URL guesses.
4. [github.com/michel-kraemer/sudocle](https://github.com/michel-kraemer/sudocle)
   -- an independent, actively developed modern Sudoku web client
   explicitly "inspired by Cracking the Cryptic" (the org that runs
   SudokuPad). If it imports real SudokuPad puzzle links -- plausible for a
   client positioned this way -- its source is likely the best available
   real-world reference implementation of `scl` decoding. Its
   `package.json` lists no separate compression-library dependency, which
   suggests that *if* it handles `scl`, the decompressor is hand-inlined in
   its own source (the same pattern this project used for `lz-string`) --
   worth cloning and grepping for `scl`/`lzipper`/`decompress` directly.

**Fallback if none of the above pan out:** read `sudokupad.app`'s own
deployed client bundle directly (browser devtools / view-source, searching
for the literal strings `"PuzzleZipper"` and `"LZipper"`). This is exactly
how the `lz-string`-based `fpuz` decompressor was originally extracted
earlier in this project (design.md 1.4) -- it's a proven fallback, just
more labor-intensive than reading an existing open-source implementation.

### 3.1 CONFIRMED by real payload (2026-08-30): scl lines/overlays are rendering data, not semantic constraints

This started as an inference from other projects' source. A real payload
(`scripts/fixtures/scl-70njbfg1zs.txt`) confirms it directly. That puzzle's
47 lines and 23 overlays carry geometry plus style and nothing else:

- Thermometers: white 0.35-cell lines, with grey circle overlays sitting at
  the bulb ends. The "bulb" is a separate overlay entity, not a property of
  the line.
- Entropic lines: peach (`#fcaf`), 0.15 cells thick.
- Region outlines: black hairlines (0.01 cells) tracing cell boundaries.
- Board frame: three concentric blue lines outside the grid.

No field anywhere names a rule. Two independent reference implementations
behave consistently with this: `penpa-to-scl` (an official `@sudokupad`-scoped
converter) builds these arrays from Penpa+ puzzles, which have no
constraint-type concept to carry; and `sudocle`, which loads real SudokuPad
puzzles, makes no attempt to distinguish thermo/renban/whisper for
scl-sourced puzzles.

**What this means going forward.** Decoding scl is solved. Recovering
*validated* constraints from it is a different problem -- pattern-matching
visual conventions -- and it is not blocked on fixtures or research, it's
blocked on accepting a heuristic. The most tractable case is thermometers:
"a rounded overlay centered on the first waypoint of a thick line" is a
fairly strong signature. Even so, a mis-identified constraint would make the
app confidently flag correct digits as conflicts, which is worse for a
solving assistant than drawing the line and staying quiet. If this is
attempted, it should be per-pattern, opt-in, and cross-checked against
several real puzzles -- not a blanket inference pass.

> **UPDATE 2026-08-30 (see design.md 7.7).** A second real payload
> (`futilytnf4`) settled the thermometer case *without* a heuristic. The
> bulbs are not just "rounded overlays" -- they are `underlays` entries
> carrying an explicit `role: "thermobulb"`, sitting exactly on a line's
> end way-point. That is a declared role plus an exact coordinate match, so
> thermometers are now promoted to real, validated constraints. The caution
> above still holds for every other line type. The residual ambiguity turned
> out to be elsewhere: strict vs "slow" thermometers are drawn identically,
> so that reading comes from the rules text and is stated to the user in
> `importNotes` rather than assumed.

Meanwhile the decorations channel means every scl puzzle is *playable*
regardless of variant: the markings are visible and the rules text is shown,
so the solver applies the rule themselves. The fixture puzzle is an ISOFILL
puzzle with zero givens -- a variant this app models not at all -- and it
still renders correctly and legibly.

## 4. Proposed phases

**Phase A -- Research spike. STATUS: done, but note that research-only conclusions proved unreliable -- the decisive step was obtaining one real payload (see design.md 7.6). Two conclusions drawn from reading other projects' source were wrong.**
Goal: come out with either (a) a decompression function that reproduces a
known-good decompressed payload byte-for-byte from a real `scl` string, or
(b) a clear "here's exactly why this is harder than expected" writeup.
Steps:
1. Pull a handful of real `scl` payloads to use as fixtures (the app can
   already fetch these now that today's JSON-wrapping bug is fixed --
   grab several different puzzles, not just one, to catch key-mapping
   variety across constraint types).
2. Chase leads 1-4 above, in that order (official docs first, inlined
   client-bundle extraction last).
3. Confirm or refute the `LZipperLite.js` hypothesis against a real payload.
4. Extract or empirically reconstruct the `PuzzleZipper` key table. If a
   literal table isn't found, the empirical method that already worked for
   this project once (comparing decompressed-but-still-shortened JSON
   against the known long-form `fpuzzles.ts` schema and `penpa-to-scl`'s
   schema to infer what each short key must mean) is the fallback --
   slower, but it doesn't require finding source code, just enough real
   fixture puzzles covering enough constraint types.

**Phase B -- Decompression codec. STATUS: done, then DELETED as unnecessary. scl uses the same lz-string codec as fpuz; the hand-ported decoder produced byte-identical output and `importer/formats/lzipper.ts` is gone. This phase should never have existed.**
Implement (or adopt, if lead 1/4 above hands us working code)
`importer/formats/lzipper.ts`, mirroring how `decode.ts` already isolates
the lz-string step. Add it as its own testable unit -- a pure function,
string in, string out -- so it can be verified against Phase A's fixtures
independent of anything JSON-shaped.

**Phase C -- Key un-shortening + `parseScl()`. STATUS: done, with un-shortening demoted to a fallback (real payloads may not be minified at all, and running the pass unconditionally corrupts 6-digit numbers). `parseScl()` splits content into validated constraints vs. drawn-only decorations -- see Section 3.1.**
Two sub-steps, deliberately kept separate the same way compression and
key-shortening are separate on SudokuPad's side:
1. An "un-PuzzleZipper" pass: shortened-key JSON -> long-form-key JSON,
   using Phase A's table.
2. `parseScl()` itself: long-form JSON -> the same normalized
   `PuzzleModel` that `parseFPuzzles()` already targets. This is the
   payoff of the "normalized model is the seam" decision from design.md
   2.3 -- the solver/renderer don't need to know or care that this puzzle
   came in as `scl`.

**Phase D -- Validation. STATUS: done for decoding -- `npm run test:scl` runs 31 checks against the real captured payload plus a synthetic minified case and a regression test for the un-shortening corruption hazard. Still open: constraint-level validation of scl variants, which is blocked on semantics, not on fixtures (Section 3.1).**
Extend `scripts/smoke-test-importer.ts` with real (not synthetic) `scl`
fixture puzzles covering a spread of constraint types, the same way the
`fpuz` path is tested today. Cross-check parsed output's `solution` field
against the rendered board the same way Phase 2 of the original build did.

**Phase E -- Wire it in. STATUS: done. The "not supported yet" throw is gone for `scl`/`ctc` (still in place for `scf`, out of scope per Section 2). Renderer draws decorations; the ruleset text is now displayed (it never was before); the "unsupported" note no longer reports empty arrays or plumbing keys as missing features.**
Remove the "not supported yet" throw in `decode.ts` and the placeholder
error in `formats/scl.ts` once Phase D fixtures are green. Update
design.md section 6.2 to move `scl`/`ctc` from "not yet scheduled" to
"covered," and update this file's status line.

## 5. Effort and risk

This is genuinely uncertain-sized work, not a routine feature -- the honest
range:

- **If Phase A's leads pan out** (an existing open-source implementation
  covers both the codec and the key table, or is close enough to adapt):
  Phases B-E are mostly porting and testing, a small-to-medium chunk of
  work, similar in shape to the original `fpuz` importer build.
- **If Phase A comes up empty** and the fallback (client-bundle extraction
  + empirical key-table reconstruction) is needed: meaningfully larger,
  open-ended by nature -- reverse-engineering a minification scheme from
  scratch, one constraint type at a time, is exactly the kind of task that
  can turn up a new surprise key per session. Budget for it the way
  design.md's own "Remaining variant coverage" phases are already budgeted
  -- incrementally, one constraint family at a time, not as a single
  monolithic milestone.

**Biggest risk:** `PuzzleZipper`'s table might not be static/global -- if
it's versioned, or varies by which constraint types a specific puzzle uses,
Phase A's fixture sample needs to be broad enough to catch that, or Phase C
will silently mis-parse puzzles using constraint types the fixtures didn't
cover. Mitigation: same posture `fpuzzles.ts` already takes -- an unknown
key should be skipped into "unsupported," never guessed at or silently
dropped from validation.

**Smaller risk:** the compression codec guess (`LZipperLite.js`) turns out
to not match, the same way the `lz-string` alphabet had one swapped
character. Mitigation: Phase A explicitly budgets time to verify
byte-for-byte before Phase B is considered "done," exactly the caveat
design.md 1.4 already flagged for the `fpuz` codec.

## 6. Interim mitigation (already partly done)

Until this is built, `scl`/`ctc` puzzles fail with an explicit, actionable
error rather than a confusing one (fixed today alongside the JSON-wrapping
bug). Worth considering as a cheap near-term UX improvement, independent of
this roadmap: surface that error in the UI with a concrete suggestion
("this puzzle was shared in SudokuPad's native format, which isn't
supported yet -- try finding an f-puzzles.com link or ID for it instead"),
since f-puzzles-sourced links are confirmed to work today.

## 7. Definition of done

- [x] A real `scl`-format puzzle loads and renders end to end (`70njbfg1zs`,
      captured 2026-08-30 and kept as `scripts/fixtures/scl-70njbfg1zs.txt`).
      Its markings draw correctly and its rules text is shown.
- [x] Real (not synthetic) `scl` fixture in the test script and passing --
      `npm run test:scl`, 31 checks including decode, decoration geometry,
      thickness normalization, and warning-noise regressions.
- [x] `npm run typecheck`, `npm run build`, `test:importer`, `test:validate`,
      `test:phase4` and `test:scl` all pass (2026-08-30).
- [x] design.md updated (section 6.2 + section 7.6, the latter rewritten to
      correct the codec mistake).
- [x] Section 3.1's semantic-tagging question resolved: confirmed that scl
      carries NO rule semantics for lines/overlays. Answered, though not in
      the hoped-for direction.
- [x] Thermometers ARE now inferred and conflict-checked -- via the explicit
      `role: "thermobulb"` underlay, not a style heuristic (design.md 7.7).
      Other line types still draw-only.
- [x] `underlays` handled (thermo bulbs, cell shading) -- it was silently
      dropped until 2026-08-30.
- [x] Title/author/rules/solution read from cell-less "key: value" cages,
      SudokuPad's actual convention (design.md 7.7).
- [x] A real PuzzleZipper-minified payload captured at last
      (`scripts/fixtures/scl-futilytnf4.txt`); the fallback branch was
      correct as written.
- [ ] Confirm `global`'s rule-name spelling against a payload that has one.
- [ ] Jigsaw `regions` support (design.md 7.4) -- empty in this payload,
      still unmodeled.
