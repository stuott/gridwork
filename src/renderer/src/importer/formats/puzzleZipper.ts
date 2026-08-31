// Undoes SudokuPad's "PuzzleZipper" minification pass on a decompressed
// "scl"/"ctc" payload.
//
// IMPORTANT -- this is a FALLBACK, not the normal path (design.md 7.6).
// The one real scl payload this project has examined (puzzle 70njbfg1zs)
// arrived as plain, valid, long-form JSON with no minification whatsoever,
// so decode.ts tries strict `JSON.parse` first and only calls in here when
// that fails. This module exists because SudokuPad clients (e.g. sudocle,
// whose implementation this is ported from) apply the un-shortening pass
// unconditionally, which implies some payloads -- older ones, or ones from
// a different editor -- really are minified. Treat "we hit this path" as
// interesting: it means a payload shape we haven't actually seen yet.
//
// PuzzleZipper isn't a general-purpose algorithm; it's a specific minifier
// for this one JSON shape:
//
//  1. Property names are shortened ("cells" -> "ce", "wayPoints" -> "wp",
//     etc.) using the fixed table below.
//  2. The shortened names are written *unquoted* -- so the result isn't
//     strict JSON, it's closer to a JS object literal (hence JSON5).
//  3. `true`/`false` are written as bare `t`/`f`.
//  4. Common colors are written unquoted (`#FFFFFF` -> bare `#F`,
//     `#000000` -> bare `#0`, any other 6-hex-digit color unquoted).
//  5. Sparse-array gaps come through as bare double-commas / a leading
//     comma, which plain JSON parsers reject outright.
//
// KNOWN HAZARD, and the reason decode.ts gates this behind a failed
// JSON.parse rather than always running it: rule 4's repair regex can't
// distinguish an unquoted color from an ordinary 6-digit number, so on
// input that didn't need un-minifying it would silently rewrite
// `{"value":123456}` into `{"value":"#123456"}`. The reference
// implementation this is ported from has the same flaw. Gating on
// "strict JSON.parse already failed" keeps it away from well-formed input,
// where that corruption would otherwise be both silent and wrong.
//
// The table and regex fixups are ported from michel-kraemer/sudocle's
// ctcpuzzleconverter.ts (MIT). Note it covers generic *rendering* keys
// (cells/cages/lines/arrows/overlays/wayPoints) -- there is no key here
// naming a line as a specific rule type like "thermometer" or "renban",
// which is consistent with what a real payload turned out to look like
// (see importer/formats/scl.ts's file comment).
import JSON5 from "json5";

/** Short key -> long key, exactly as used by SudokuPad's own renderer (ported from sudocle's ctcpuzzleconverter.ts KEYS table). */
const KEYS: Record<string, string> = {
  c: "color",
  ca: "cages",
  ct: "center",
  c1: "borderColor",
  c2: "backgroundColor",
  ce: "cells",
  cs: "cellSize",
  a: "arrows",
  o: "overlays",
  u: "underlays",
  w: "width",
  h: "height",
  v: "value",
  l: "lines",
  r: "rounded",
  re: "regions",
  fs: "fontSize",
  th: "thickness",
  hl: "headLength",
  wp: "wayPoints",
  t: "title",
  te: "text",
  d: "duration",
  d2: "d",
};

/**
 * Reverse PuzzleZipper's textual minification tricks (sparse-array gaps,
 * unquoted booleans, unquoted colors) so the result is parseable. The
 * result still has *shortened and unquoted* keys -- JSON5 (not plain
 * JSON.parse) is required for the unquoted-identifier-key part; the
 * renaming pass happens separately, after parsing.
 */
function repairMinifiedSyntax(data: string): string {
  /* eslint-disable no-useless-escape */
  return data
    .replace(/,(?=[,\]])/g, ",{}")
    .replace(/\[,/g, "[{},")
    .replace(/:t(?=[,}\]])/g, ":true")
    .replace(/:f(?=[,}\]])/g, ":false")
    .replace(/:#F(?=[,}\]])/g, ':"#FFFFFF"')
    .replace(/:#0(?=[,}\]])/g, ':"#000000"')
    .replace(/:([a-fA-F0-9]{6})(?=[,}\]])/g, ':"#$1"');
  /* eslint-enable no-useless-escape */
}

/** Recursively rename every object key found anywhere in the structure using KEYS, leaving unrecognized keys (there will be some -- this table isn't exhaustive, see the file comment) untouched rather than dropping them. */
function renameKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[KEYS[key] ?? key] = renameKeysDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * Full "un-PuzzleZipper" pass: a decompressed scl/ctc payload string (still
 * shortened) -> a plain JS value with long-form keys, ready for parseScl
 * (scl.ts) the same way JSON.parse's output feeds parseFPuzzles.
 */
export function unshortenPuzzleZipper(decompressed: string): unknown {
  const repaired = repairMinifiedSyntax(decompressed);
  const parsed: unknown = JSON5.parse(repaired);
  return renameKeysDeep(parsed);
}
