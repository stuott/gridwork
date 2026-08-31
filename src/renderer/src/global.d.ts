import type { Api } from "../../preload/index.ts";

/**
 * Shared with src/renderer/src/importer/fetchPuzzle.ts (window.api is how
 * both the puzzle importer and titlebar.ts reach the main process). Kept in
 * one place so the two don't declare conflicting shapes for window.api --
 * TypeScript errors if two `declare global` blocks in the same program
 * disagree on a merged interface member's type.
 */
declare global {
  interface Window {
    /** Present only inside the Electron renderer -- see src/preload/index.ts. */
    api?: Api;
  }
}

export {};
