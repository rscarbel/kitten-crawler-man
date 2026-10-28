/**
 * Where the governor keeps each floor's spent allowance between page loads,
 * so reloading a save cannot refill what the AI already used on that floor.
 * Keyed by floor id and world seed: the same save reloads the same seed, and
 * a new run rolls a new one and starts fresh.
 */
import { AI_BUDGET_POOLS, type AIBudgetPool } from './types';

export interface FloorLedgerSnapshot {
  readonly actionCounts: Readonly<Record<string, number>>;
  readonly spent: Readonly<Partial<Record<AIBudgetPool, number>>>;
}

export interface FloorLedgerStore {
  load(floorKey: string): FloorLedgerSnapshot | null;
  save(floorKey: string, snapshot: FloorLedgerSnapshot): void;
}

/** A store that remembers nothing, for harnesses and a browser with no storage. */
export const MEMORY_ONLY_LEDGER_STORE: FloorLedgerStore = {
  load: () => null,
  save: () => undefined,
};

const STORAGE_KEY = 'kcw.aiFloorLedgers';
/** Ledgers kept, newest first; an abandoned run's floors age out. */
const MAX_STORED_FLOORS = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function countsOf(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!isCount(count)) return null;
    counts[key] = count;
  }
  return counts;
}

function isBudgetPool(value: string): value is AIBudgetPool {
  return AI_BUDGET_POOLS.some((pool) => pool === value);
}

function parseSnapshot(value: unknown): FloorLedgerSnapshot | null {
  if (!isRecord(value)) return null;
  const actionCounts = countsOf(value.actionCounts);
  const spentCounts = countsOf(value.spent);
  if (actionCounts === null || spentCounts === null) return null;
  const spent: Partial<Record<AIBudgetPool, number>> = {};
  for (const [pool, amount] of Object.entries(spentCounts)) {
    if (!isBudgetPool(pool)) return null;
    spent[pool] = amount;
  }
  return { actionCounts, spent };
}

interface StoredEntry {
  readonly key: string;
  readonly snapshot: FloorLedgerSnapshot;
}

function parseEntries(parsed: unknown): StoredEntry[] | null {
  if (!Array.isArray(parsed)) return null;
  const entries: StoredEntry[] = [];
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.key !== 'string') return null;
    const snapshot = parseSnapshot(item.snapshot);
    if (snapshot === null) return null;
    entries.push({ key: item.key, snapshot });
  }
  return entries;
}

/** The stored ledgers; a list that fails validation is discarded with a warning. */
function readEntries(): StoredEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let entries: StoredEntry[] | null;
  try {
    entries = parseEntries(JSON.parse(raw));
  } catch {
    entries = null;
  }
  if (entries === null)
    console.warn('The stored AI floor ledgers failed validation; discarding them.');
  return entries ?? [];
}

/** The browser's `localStorage`; reads and writes that fail leave the governor in memory only. */
export const LOCAL_LEDGER_STORE: FloorLedgerStore = {
  load(floorKey) {
    return readEntries().find((entry) => entry.key === floorKey)?.snapshot ?? null;
  },
  save(floorKey, snapshot) {
    try {
      const others = readEntries().filter((entry) => entry.key !== floorKey);
      const entries = [{ key: floorKey, snapshot }, ...others].slice(0, MAX_STORED_FLOORS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: the allowance still holds for this page's life.
    }
  },
};

/** The store a browser page should use: local storage when the page has it. */
export function defaultLedgerStore(): FloorLedgerStore {
  return typeof localStorage === 'undefined' ? MEMORY_ONLY_LEDGER_STORE : LOCAL_LEDGER_STORE;
}
