import { isRecord } from '../util/guards';
import type { OwedWipe, WipeAccount, WipeMarkerStore } from './progressPersistence';

const WIPE_MARKER_KEY = 'kcm.wipeOwed';

function parseWipeAccount(raw: unknown): WipeAccount | null {
  if (!isRecord(raw)) return null;
  const { id, label } = raw;
  return typeof id === 'string' && typeof label === 'string' ? { id, label } : null;
}

/**
 * Reads the marker as owed whenever the key is present, even when its contents
 * cannot be parsed: a garbled marker still means a wipe was started, and
 * finishing it with no account check is safer than resuming the run it erased.
 */
function parseOwedWipe(text: string): OwedWipe {
  try {
    const raw: unknown = JSON.parse(text);
    return { account: isRecord(raw) ? parseWipeAccount(raw.account) : null };
  } catch {
    return { account: null };
  }
}

/** The device's record of a wipe still owed, in `localStorage` beside the save it erases. */
export const LOCAL_WIPE_MARKER: WipeMarkerStore = {
  read() {
    try {
      const text = localStorage.getItem(WIPE_MARKER_KEY);
      return text === null ? null : parseOwedWipe(text);
    } catch {
      return null;
    }
  },
  write(owed) {
    try {
      localStorage.setItem(WIPE_MARKER_KEY, JSON.stringify(owed));
    } catch {
      // Storage unavailable: the wipe still runs, it just cannot outlive this page.
    }
  },
  clear() {
    try {
      localStorage.removeItem(WIPE_MARKER_KEY);
    } catch {
      // Nothing reachable to clear.
    }
  },
};

/** Whether a previous page left a wipe unfinished; no save may be loaded while one is. */
export function wipeOwed(): boolean {
  return LOCAL_WIPE_MARKER.read() !== null;
}
