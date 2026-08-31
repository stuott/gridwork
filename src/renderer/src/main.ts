import { importPuzzle } from "./importer";
import { SudokuBoard } from "./render/board";
import {
  clearProgress,
  hashInput,
  loadHistory,
  recordHistory,
  removeHistoryEntry,
  type HistoryEntry,
} from "./state/persistence";
import "./style.css";
import { applyThemePref, loadThemePref } from "./theme";
import { initTitlebar } from "./titlebar";
import { SettingsModal } from "./ui/settingsModal";

applyThemePref(loadThemePref());

const settingsModal = new SettingsModal();
initTitlebar({ onOpenSettings: () => settingsModal.open() });

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="app-shell">
    <h1>Sudoku Solving Assistant</h1>
    <form id="import-form" class="import-form">
      <input
        id="puzzle-input"
        type="text"
        placeholder="https://sudokupad.app/... or paste JSON"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit">Load puzzle</button>
    </form>
    <div id="import-error" class="import-error" hidden></div>
    <div id="import-history" class="import-history"></div>
    <div id="board-container"></div>
  </div>
`;

const form = document.querySelector<HTMLFormElement>("#import-form")!;
const input = document.querySelector<HTMLInputElement>("#puzzle-input")!;
const errorEl = document.querySelector<HTMLDivElement>("#import-error")!;
const historyEl = document.querySelector<HTMLDivElement>("#import-history")!;
const boardContainer =
  document.querySelector<HTMLDivElement>("#board-container")!;

let currentBoard: SudokuBoard | null = null;

async function loadPuzzle(value: string): Promise<void> {
  errorEl.hidden = true;
  errorEl.textContent = "";

  const submitBtn = form.querySelector("button")!;
  submitBtn.disabled = true;
  submitBtn.textContent = "Loading...";

  try {
    const model = await importPuzzle(value);
    currentBoard?.destroy();
    const puzzleId = hashInput(value);
    currentBoard = new SudokuBoard(boardContainer, model, {
      puzzleId,
      rawInput: value,
    });
    recordHistory({
      puzzleId,
      rawInput: value,
      title: model.title,
      lastOpened: Date.now(),
    });
    renderHistory();
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Load puzzle";
  }
}

function relativeTime(epochMs: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

function renderHistory(): void {
  const entries = loadHistory();
  historyEl.innerHTML = "";
  if (entries.length === 0) {
    historyEl.hidden = true;
    return;
  }
  historyEl.hidden = false;

  const label = document.createElement("div");
  label.className = "import-history-label";
  label.textContent = "Recent puzzles";
  historyEl.appendChild(label);

  const list = document.createElement("ul");
  list.className = "import-history-list";
  for (const entry of entries) {
    list.appendChild(renderHistoryItem(entry));
  }
  historyEl.appendChild(list);
}

function renderHistoryItem(entry: HistoryEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "import-history-item";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "import-history-open";
  openBtn.textContent = entry.title || entry.rawInput.slice(0, 60);
  openBtn.title = entry.rawInput;
  openBtn.onclick = () => {
    input.value = entry.rawInput;
    void loadPuzzle(entry.rawInput);
  };

  const when = document.createElement("span");
  when.className = "import-history-when";
  when.textContent = relativeTime(entry.lastOpened);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "import-history-remove";
  removeBtn.setAttribute(
    "aria-label",
    `Remove ${entry.title || "this puzzle"} from recent puzzles`,
  );
  removeBtn.textContent = "×";
  removeBtn.onclick = () => {
    // Drop the saved grid too. The recent-puzzles list is the only route
    // back to a puzzle's progress, so leaving it behind just accumulates
    // unreachable localStorage entries.
    removeHistoryEntry(entry.puzzleId);
    clearProgress(entry.puzzleId);
    renderHistory();
  };

  item.append(openBtn, when, removeBtn);
  return item;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = input.value.trim();
  if (!value) return;
  await loadPuzzle(value);
});

renderHistory();
