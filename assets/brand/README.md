# Gridwork brand marks

Six candidate logo marks. All drawn on a 32-unit viewBox with
`stroke="currentColor"`, matching the contract in `src/renderer/src/ui/icons.ts`
so any of them drops into the icon set with no per-theme variant.

Accent-coloured parts use `fill="var(--accent, currentColor)"`: inline in the app
they pick up the live theme token, standalone they collapse to a single colour.

- `mark-lattice.svg`   -- 01 Latticework (woven bars)
- `mark-cell.svg`      -- 02 Working Cell (3x3 box, three pencil marks)
- `mark-nine.svg`      -- 03 Nine Points (dot matrix, three resolved)
- `mark-center.svg`    -- 04 Centre Box (box dividers only)
- `mark-g.svg`         -- 05 The G Grid (letterform cut from the lattice)
- `mark-table.svg`     -- 06 On the Table (grid in perspective)

`logo-concepts.html` is the full presentation sheet with size proofs and
theme swatches. Open it in a browser.

- `header-light.png` / `header-dark.png` -- README banner, 1280x300 at 2x.
  Regenerate from `header.src.html` (instructions in its comment).
