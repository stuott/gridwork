/**
 * Headless checks for the board's multi-cell selection rules
 * (src/renderer/src/state/selection.ts). The pointer/keyboard plumbing in
 * render/board.ts needs a DOM, but the selection rules themselves -- what a
 * plain click, a Ctrl+click toggle, a Shift+click rectangle, an arrow key and
 * a select-all each do to the set and to the anchor -- are pure, and this is
 * where they get pinned down.
 *
 * Run with: npm run test:selection
 */
import { CellSelection } from "../src/renderer/src/state/selection";

let failures = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures++;
  }
}

function keysOf(sel: CellSelection): string[] {
  return sel
    .cells()
    .map(({ r, c }) => `${r},${c}`)
    .sort();
}

// --- plain click ----------------------------------------------------------
{
  const sel = new CellSelection();
  sel.selectOnly(4, 4);
  check("plain click selects exactly one cell", sel.size === 1 && sel.has(4, 4));
  check("plain click sets the anchor", sel.anchor?.r === 4 && sel.anchor?.c === 4);
  sel.selectOnly(0, 8);
  check("a second plain click replaces the selection", sel.size === 1 && sel.has(0, 8) && !sel.has(4, 4));
  check("sole() reports the single selected cell", sel.sole()?.c === 8);
}

// --- drag / additive selection --------------------------------------------
{
  const sel = new CellSelection();
  sel.selectOnly(0, 0);
  sel.add(0, 1);
  sel.add(0, 2);
  check("dragging adds cells to the selection", keysOf(sel).join(" ") === "0,0 0,1 0,2");
  check("dragging moves the anchor to the last cell", sel.anchor?.c === 2);
  check("sole() is null with several cells selected", sel.sole() === null);
}

// --- ctrl/cmd+click toggle ------------------------------------------------
{
  const sel = new CellSelection();
  sel.selectOnly(2, 2);
  check("ctrl+click on an unselected cell adds it", sel.toggle(5, 5) === "added" && sel.size === 2);
  check("ctrl+click on a selected cell removes it", sel.toggle(2, 2) === "removed" && sel.size === 1 && !sel.has(2, 2));
  check("the surviving cell is untouched", sel.has(5, 5));
}

// --- shift+click rectangle ------------------------------------------------
{
  const sel = new CellSelection();
  sel.selectOnly(1, 1);
  sel.addRange(3, 2);
  check("shift+click fills the rectangle between anchor and target", keysOf(sel).join(" ") === "1,1 1,2 2,1 2,2 3,1 3,2");
  check("shift+click moves the anchor to the target", sel.anchor?.r === 3 && sel.anchor?.c === 2);

  // Backwards (target above/left of the anchor) must give the same rectangle.
  const back = new CellSelection();
  back.selectOnly(3, 2);
  back.addRange(1, 1);
  check("a backwards shift+click gives the same rectangle", keysOf(back).join(" ") === keysOf(sel).join(" "));

  // Shift+click adds rather than replacing, so shapes can be built up.
  sel.addRange(3, 5);
  check("a second shift+click adds to what was already selected", sel.has(1, 1) && sel.has(3, 5));

  const empty = new CellSelection();
  empty.addRange(4, 4);
  check("shift+click with nothing selected just selects that cell", empty.size === 1 && empty.has(4, 4));
}

// --- removal keeps the anchor as a stable origin --------------------------
{
  const sel = new CellSelection();
  sel.selectOnly(6, 6);
  sel.add(6, 7);
  sel.delete(6, 7);
  check("removing a cell does not clear the rest", sel.size === 1 && sel.has(6, 6));
  check("removing a cell leaves an anchor to measure from", sel.anchor !== null);
}

// --- select all / clear ---------------------------------------------------
{
  const sel = new CellSelection();
  sel.selectOnly(4, 4);
  sel.selectAll(9);
  check("select-all covers a 9x9 grid", sel.size === 81 && sel.has(0, 0) && sel.has(8, 8));
  check("select-all keeps the existing anchor", sel.anchor?.r === 4 && sel.anchor?.c === 4);

  const fresh = new CellSelection();
  fresh.selectAll(6);
  check("select-all on an empty selection covers the grid and seeds an anchor", fresh.size === 36 && fresh.anchor?.r === 0);

  sel.clear();
  check("clear empties the selection", sel.size === 0 && sel.cells().length === 0);
  check("clear drops the anchor", sel.anchor === null);
}

if (failures > 0) {
  console.error(`\n${failures} selection check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll selection checks passed.");
