const STORAGE_KEY = "ha-kit-split-panes";

type SplitPaneStore = Record<string, number>;

function readStore(): SplitPaneStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SplitPaneStore;
  } catch {
    return {};
  }
}

function writeStore(store: SplitPaneStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Load persisted start-pane ratio (0–1). Falls back to defaultRatio when missing or invalid. */
export function loadSplitPaneRatio(id: string, defaultRatio: number): number {
  const value = readStore()[id];
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultRatio;
  return Math.min(0.92, Math.max(0.08, value));
}

export function saveSplitPaneRatio(id: string, ratio: number) {
  const clamped = Math.min(0.92, Math.max(0.08, ratio));
  const store = readStore();
  store[id] = clamped;
  writeStore(store);
}
