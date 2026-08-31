/**
 * Turns whatever the user pasted -- a SudokuPad URL, an f-puzzles.com URL, a
 * bare puzzle ID, or a raw payload string -- into the raw payload string that
 * decode.ts knows how to decompress/parse.
 *
 * See design.md section 1.3 for the ID-vs-payload rule this implements. The
 * actual network fetch (fetchRaw, below) goes through the Electron main
 * process over IPC when running as the packaged/dev Electron app -- no CORS
 * restriction applies there at all -- with a same-origin dev-proxy fallback
 * (electron.vite.config.ts) for the case of opening the renderer directly in
 * a plain browser tab. See design.md sections 2.2 and 8.
 */

const SUDOKUPAD_HOSTS = [
  "sudokupad.app",
  "app.crackingthecryptic.com",
  "sudokupad.svencodes.com",
];

const FPUZZLES_HOSTS = ["f-puzzles.com", "www.f-puzzles.com"];

/** SudokuPad's own rule (design.md 1.3): payload strings this long or longer are the compressed data itself, not an ID to look up. */
const ID_LENGTH_CUTOFF = 20;

export type InputKind = "sudokupad-link" | "fpuzzles-link" | "bare-id-or-payload";

export interface ResolvedInput {
  kind: InputKind;
  /** The extracted ID (if short) or payload (if long) -- not yet fetched/decoded. */
  idOrPayload: string;
}

function stripQueryAndHash(pathPart: string): string {
  return pathPart.split("?")[0]!.split("#")[0]!;
}

/** Pull the puzzle ID/payload out of whatever the user pasted, without fetching anything yet. */
export function extractIdOrPayload(rawInput: string): ResolvedInput {
  const input = rawInput.trim();

  let url: URL | null = null;
  try {
    url = new URL(input);
  } catch {
    url = null;
  }

  if (url && SUDOKUPAD_HOSTS.includes(url.hostname)) {
    // SudokuPad links put the ID/payload as the last path segment, e.g.
    // sudokupad.app/<id> or app.crackingthecryptic.com/sudoku/<id>.
    const segments = stripQueryAndHash(url.pathname).split("/").filter(Boolean);
    const last = segments.at(-1);
    if (!last) {
      throw new Error(`Couldn't find a puzzle ID in this SudokuPad link: ${input}`);
    }
    return { kind: "sudokupad-link", idOrPayload: decodeURIComponent(last) };
  }

  if (url && FPUZZLES_HOSTS.includes(url.hostname)) {
    // Confirmed (design.md section 6.4, cross-checked against
    // dclamage/SudokuSolver's own f-puzzles link generator): f-puzzles.com
    // share links are `?load=<payload>`, where payload is a *bare*
    // LZString.compressToBase64(json) with no format prefix -- unlike
    // SudokuPad's fpuz/fpuzzles-prefixed payloads. decode.ts's fallback
    // path handles the unprefixed case.
    //
    // BUG FOUND AND FIXED (2026-08-29): must NOT use url.searchParams.get("load")
    // here. URLSearchParams follows the application/x-www-form-urlencoded
    // decoding algorithm, which silently turns literal "+" characters into
    // spaces -- and standard base64 (lz-string's alphabet included) uses "+"
    // as a real character. Real f-puzzles links commonly contain "+" in the
    // payload, so searchParams.get() was corrupting otherwise-valid payloads
    // into ones that fail to decompress/parse, surfacing as a confusing
    // "unrecognized puzzle payload" error further downstream. Parsing the
    // query string manually and decoding with plain decodeURIComponent
    // (which only touches %XX escapes, never "+") avoids the corruption.
    const rawQuery = url.search.startsWith("?") ? url.search.slice(1) : url.search;
    const loadPair = rawQuery.split("&").find((kv) => kv.startsWith("load="));
    if (!loadPair) {
      throw new Error(`Couldn't find a "load" query param in this f-puzzles.com link: ${input}.`);
    }
    const payload = decodeURIComponent(loadPair.slice("load=".length));
    return { kind: "fpuzzles-link", idOrPayload: payload };
  }

  // Not a recognized URL at all -- treat as a bare ID or an already-extracted payload.
  return { kind: "bare-id-or-payload", idOrPayload: input };
}

interface FetchTextResult {
  ok: boolean;
  status: number;
  text: string;
}

// window.api's type (including windowControls, used by titlebar.ts) is
// declared once in src/renderer/src/global.d.ts -- not here -- so this
// file's shape can't drift out of sync with a second `declare global` block
// and conflict at typecheck time.

/**
 * Fetches the SudokuPad puzzle-lookup API and returns the raw response text.
 * Two ways this can happen, tried in order:
 *
 *  1. Running inside Electron (window.api is present): the main process does
 *     the fetch (src/main/index.ts) and hands the result back over IPC. No
 *     CORS restriction applies here at all, in dev or in the packaged app --
 *     this is the primary path now that this app runs as an Electron app
 *     (see design.md's Electron phase notes).
 *  2. Running as a plain web page (window.api absent, e.g. testing with
 *     `vite dev` directly against src/renderer without Electron): falls back
 *     to the same-origin /api/puzzle path, proxied to sudokupad.app by
 *     electron.vite.config.ts's dev-only proxy (design.md section 2.2).
 *     This only works while `npm run dev`'s renderer dev server is up, not
 *     against a production static build of the renderer alone.
 */
async function fetchRaw(targetUrl: string): Promise<FetchTextResult> {
  if (window.api) {
    return window.api.fetchText(targetUrl);
  }
  // Same-origin relative path so the browser's request actually goes through
  // vite's dev proxy instead of being blocked by CORS.
  const res = await fetch(new URL(targetUrl).pathname);
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function fetchFromSudokuPadApi(id: string): Promise<string> {
  const targetUrl = `https://sudokupad.app/api/puzzle/${encodeURIComponent(id)}`;
  const { ok, status, text } = await fetchRaw(targetUrl);

  if (!ok) {
    throw new Error(
      `SudokuPad API returned ${status} for puzzle ID "${id}". ` +
        `Check that you're online${window.api ? "" : " and that the vite dev server is running (the proxy only works in dev)"}.`,
    );
  }

  // A 200 with an HTML body (rather than the expected JSON) almost always means
  // the request never actually reached sudokupad.app -- e.g. (web-fallback path
  // only) the page is being served by `vite preview` or a static build, where
  // the dev-only proxy doesn't apply, so the request falls through to the
  // app's own index.html instead.
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      `Got an HTML page back instead of JSON for puzzle ID "${id}". ` +
        (window.api
          ? "That's unexpected inside the Electron app -- please report this."
          : `This usually means the /api/puzzle proxy isn't active -- it's configured in electron.vite.config.ts ` +
            `and only runs under "npm run dev", not "npm run preview" or a static build.`),
    );
  }

  let body: { result?: string };
  try {
    body = JSON.parse(text) as { result?: string };
  } catch {
    // Confirmed against a real response (a "scl"-format puzzle, ID
    // 70njbfg1zs): the API doesn't always wrap the payload in
    // {"result": "<payload>"} JSON -- sometimes the body IS the raw payload
    // string already (e.g. starts with "scl..."). Treat non-JSON text as
    // the raw payload directly instead of failing; decode.ts validates it
    // properly downstream and gives a clear error if it's actually garbage.
    return text;
  }
  if (!body.result) {
    throw new Error(`SudokuPad API response for "${id}" had no "result" field.`);
  }
  return body.result;
}

/**
 * Resolve any user-pasted input all the way to a raw payload string, ready
 * for decode.ts. Fetches the SudokuPad API only when the extracted ID is
 * short enough that it can't already be the payload (design.md section 1.3).
 */
export async function resolvePuzzleInput(rawInput: string): Promise<string> {
  const { idOrPayload } = extractIdOrPayload(rawInput);

  if (idOrPayload.length >= ID_LENGTH_CUTOFF) {
    return idOrPayload;
  }

  return fetchFromSudokuPadApi(idOrPayload);
}
