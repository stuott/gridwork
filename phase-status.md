# Gridwork — Progress Overview

_Last updated: August 31, 2026_

A plain-language summary of what's been built so far and what's still left. For technical detail on any item below, see `design.md` in this same folder.

## What this app is

A desktop app that helps you solve variant sudoku puzzles you find online — it does not solve puzzles for you. You paste in a puzzle link (or ID), it loads the puzzle onto a board, and gives you tools to work through it yourself: pencil marks, highlighting, hints that explain a technique rather than hand you an answer, and so on.

## Completed so far

**Importing puzzles.** You can paste a link from SudokuPad or f-puzzles.com (or a raw puzzle ID) and the app fetches, decodes, and loads it automatically. Recently opened puzzles are remembered in a history list. SudokuPad's own native puzzle format is now handled too — though the markings those puzzles carry are drawn on the board without the app knowing what rule each one means, so it can't check them for you (the puzzle's written rules are shown above the board for that reason).

**The playable board.** Digit entry, manual pencil marks, and automatic conflict highlighting when something breaks the rules. The app can tell you when your grid matches the puzzle's real solution (win detection) — but it never fills anything in for you.

**Common variant rules.** Killer cages, thermometers, arrows, kropki dots, and odd/even cells are all fully understood by the app — placing a digit that breaks one of these lights it up red, the same as a normal row/column conflict.

**Broader variant rules.** A much longer list of puzzle styles is also covered: renban/whisper/palindrome lines, between lines, little killer sums, XV pairs, sandwich sums, extra regions, clone cells, quadruple clues, min/max cells, anti-knight/anti-king rules, diagonal rules, and non-consecutive rules.

**Solving-assist toolkit.** A full set of aids for actually working the puzzle: a pausable timer, undo/redo (including pencil marks and highlight colors), colored cell highlighting for your own notes, "what's forced here" hints that name a technique instead of giving the answer, save-and-resume so progress isn't lost on close, zoom controls, a toggle between live mistake-checking and check-on-demand, and keyboard shortcuts for everything above.

**Selecting several cells at once.** You can select a group of cells — drag across them, Ctrl+click to pick out individual ones, Shift+click to grab a rectangle, or Ctrl+A for the whole grid — and then type a digit, add a pencil mark, clear them, or color them in one go, instead of repeating yourself cell by cell. The selected group is outlined so it stays visible on top of highlighting and cage markings.

**Appearance / themes.** A settings panel with six color themes (three color families, each in a light and dark version) so you can pick the look you prefer.

**SudokuPad markings drawn in full.** As of 2026-08-31 the board also draws the arrows and the printed numbers/letters those puzzles carry — cage sums, X and V markers, little-killer clues, quadruple digits. Both were being dropped before, so an arrow puzzle arrived with its arrows missing and every cage sum showed as an empty shape. As with the rest of these markings the app draws them but doesn't check them; the puzzle's written rules are shown above the board so you can apply them yourself.

**A name and a logo.** The app is called **Gridwork** as of 2026-08-31 — the grid you solve on, plus *-work* the way latticework and brickwork use it: something assembled by hand, one piece at a time. The logo is four bars woven over and under. It shows in the window title bar, above the puzzle input, and as the taskbar and browser-tab icon; because it's drawn in a single colour that follows the theme, one copy covers all six themes. The project also has a README now, with a banner image. Six candidate logos were drawn before picking this one — they're kept in `assets/brand/` along with the presentation sheet.

One thing deliberately *not* renamed: the keys the app saves your progress, history and settings under still start with `sudoku:`. Changing them would make every saved puzzle and your theme choice disappear on first launch, which isn't worth a tidier name in a file nobody sees.

**Desktop app conversion.** The app now runs as a real Windows desktop application with its own window and title bar, rather than a browser tab — which also cleaned up some networking issues that only came up when running in a browser.

## Not started yet / left to do

**Packaging & distribution.** Right now the app runs from source code. Turning it into a proper installable program — a real installer, auto-updates — hasn't been done yet. The logo exists, but it hasn't been turned into the `.ico`/`.icns` files an installer needs.

**Irregular ("jigsaw") box shapes.** Puzzles where the 9 regions aren't standard 3x3 boxes still aren't solvable in the app — but as of 2026-08-31 it recognizes them and says so instead of quietly checking the wrong regions. A jigsaw now loads with a note explaining that only rows and columns are being checked, and the board stops drawing 3x3 box outlines the puzzle doesn't have. Previously it looked like an ordinary puzzle and flagged correct digits as mistakes.

**A handful of rarer variant types.** Some less-common puzzle styles are still unsupported: region-sum lines, row/column/box "indexer" clues, X-sum and skyscraper clues, a few exotic line types (entropic, modular, nabner, zipper, double-arrow, slow-thermometer lines), and "negative constraint" rules, which apply to every unmarked pair in the grid rather than just the ones with a symbol on them.

---

This file is meant to stay high-level and non-technical. See `design.md` for architecture, file names, and implementation notes behind any item above.
