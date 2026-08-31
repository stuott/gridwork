import { decompressFromBase64 } from "lz-string";
import { unshortenPuzzleZipper } from "./formats/puzzleZipper";

export type SourceFormat = "fpuzzles" | "scl" | "scf" | "raw-json";

const FORMAT_PREFIXES: Array<{ prefix: string; format: SourceFormat }> = [
  // Longer prefixes first so "fpuzzles" isn't mis-tested as "fpuz"-then-leftover.
  { prefix: "fpuzzles", format: "fpuzzles" },
  { prefix: "fpuz", format: "fpuzzles" },
  { prefix: "ctc", format: "scl" },
  { prefix: "scl", format: "scl" },
  { prefix: "scf", format: "scf" },
];

export interface DecodedPayload {
  format: SourceFormat;
  json: unknown;
}

/**
 * Base64's alphabet uses "+", which a lossy URL-decoding step upstream can
 * turn into a literal space. This project already hit that once on the
 * f-puzzles side (see fetchPuzzle.ts's query-string bug write-up); SudokuPad
 * clients defend against it for scl/ctc payloads too, so do the same here.
 */
function repairBase64Spaces(body: string): string {
  return body.replace(/ /g, "+");
}

/**
 * Turn a raw SudokuPad/f-puzzles payload string (already resolved from a link
 * or puzzle ID -- see fetchPuzzle.ts) into parsed JSON, detecting which of
 * the source formats it is. See design.md sections 1.2-1.4 and 6.4 for how
 * each format is structured, design.md section 6.2 for what isn't handled
 * yet, and design.md 7.6 for the scl/ctc pipeline below.
 */
export function decodePayload(payload: string): DecodedPayload {
  const trimmed = payload.trim();

  // Someone pasted raw JSON directly (the Phase 0 path: no network at all).
  if (trimmed.startsWith("{")) {
    return { format: "raw-json", json: JSON.parse(trimmed) };
  }

  const match = FORMAT_PREFIXES.find((f) => trimmed.startsWith(f.prefix));

  if (match) {
    const body = trimmed.slice(match.prefix.length);

    if (match.format === "scf") {
      // A third, rarer SudokuPad-native format, structurally unrelated to
      // scl/ctc -- explicitly out of scope (scl-format-roadmap.md section 2),
      // tracked separately.
      throw new Error(
        `SudokuPad's native "scf" format isn't supported yet (see design.md section 6.2). ` +
          `Try finding an f-puzzles link/ID for this puzzle instead.`,
      );
    }

    const decompressed = decompressFromBase64(repairBase64Spaces(decodeURIComponent(body)));
    if (!decompressed) {
      throw new Error(
        "Decompression failed -- the payload may be malformed, or SudokuPad's " +
          "compression may not exactly match stock lz-string (see design.md section 1.4).",
      );
    }

    if (match.format === "scl") {
      // CONFIRMED against a real payload (puzzle 70njbfg1zs, design.md 7.6):
      // scl/ctc uses the SAME lz-string codec as fpuz -- an earlier version of
      // this file carried a separate hand-ported LZW decoder for scl on the
      // assumption the codecs differed. They don't; that decoder produced
      // byte-identical output and was deleted.
      //
      // The remaining scl-specific step is PuzzleZipper's key-shortening
      // minification -- but that same real payload arrived as plain, valid,
      // long-form JSON with no minification at all. So parse strict JSON
      // first and only fall back to the un-shortening pass when that fails.
      // This ordering matters for correctness, not just speed: the fallback
      // is regex-based and would rewrite an innocent 6-digit numeric value
      // (e.g. `"value":123456`) into a color string `"#123456"`. Running it
      // only on input that isn't already valid JSON keeps that away from
      // every payload that doesn't actually need it.
      try {
        return { format: "scl", json: JSON.parse(decompressed) };
      } catch {
        // Not plain JSON -- presumably PuzzleZipper-minified (shortened,
        // unquoted keys). Try the un-shortening path before giving up.
      }
      try {
        return { format: "scl", json: unshortenPuzzleZipper(decompressed) };
      } catch (err) {
        throw new Error(
          "Decompressed successfully, but the result was neither valid JSON nor " +
            "parseable as PuzzleZipper-minified JSON (see design.md section 7.6). " +
            `First 200 characters of decompressed data: ${decompressed.slice(0, 200)} ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }

    try {
      return { format: "fpuzzles", json: JSON.parse(decompressed) };
    } catch {
      throw new Error(
        "Decompressed successfully, but the result wasn't valid JSON -- SudokuPad's compression " +
          "may not exactly match stock lz-string for this puzzle (see design.md section 1.4). " +
          `First 200 characters of decompressed data: ${decompressed.slice(0, 200)}`,
      );
    }
  }

  // No recognized prefix. f-puzzles.com's OWN share links (confirmed --
  // design.md section 6.4) are `?load=<payload>` where payload is
  // LZString.compressToBase64(json) with NO format prefix at all, unlike
  // SudokuPad's fpuz/fpuzzles-prefixed payloads. Try that before giving up.
  const bareDecompressed = decompressFromBase64(trimmed);
  if (bareDecompressed) {
    try {
      return { format: "fpuzzles", json: JSON.parse(bareDecompressed) };
    } catch {
      // Decompressed to something that wasn't valid JSON -- fall through to the error below.
    }
  }

  throw new Error(
    `Unrecognized puzzle payload: doesn't start with "{", a known prefix ` +
      `(fpuzzles/fpuz/ctc/scl/scf), or decompress as an unprefixed f-puzzles payload. ` +
      `Got: "${trimmed.slice(0, 24)}..."`,
  );
}
