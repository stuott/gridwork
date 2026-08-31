import { resolvePuzzleInput } from "./fetchPuzzle";
import { decodePayload } from "./decode";
import { parseFPuzzles } from "./formats/fpuzzles";
import { parseScl } from "./formats/scl";
import type { PuzzleModel } from "../model/types";

/**
 * Full import pipeline: whatever the user pasted (a SudokuPad link, an
 * f-puzzles link, a bare puzzle ID, or raw f-puzzles JSON) -> a normalized
 * PuzzleModel ready for the board renderer. See design.md sections 1-2.
 */
export async function importPuzzle(rawInput: string): Promise<PuzzleModel> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error(
      "Paste a SudokuPad link, an f-puzzles link, a bare puzzle ID, or raw f-puzzles JSON.",
    );
  }

  // Raw JSON pasted directly skips fetching entirely (the Phase 0 path).
  const payload = trimmed.startsWith("{") ? trimmed : await resolvePuzzleInput(trimmed);
  const decoded = decodePayload(payload);

  switch (decoded.format) {
    case "fpuzzles":
    case "raw-json":
      return parseFPuzzles(decoded.json);
    case "scl":
    case "scf":
      return parseScl(decoded.json);
  }
}
