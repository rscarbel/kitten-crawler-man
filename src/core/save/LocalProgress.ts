import type { GameProgress, GameProgressInput } from '../../auth/AuthClient';
import { parseGameProgress, stampGameProgress } from './saveFormat';
import { PAGE_SAVE_LATCH, type ProgressStorage } from './progressPersistence';
import { wipeOwed } from './wipeMarker';

const STORAGE_KEY = 'kcw.progress';

/**
 * The last checkpoint written on this device, or `null` when there is none.
 * One that fails validation is discarded with a warning and the run starts
 * fresh. `localStorage` throws outright in some privacy modes, so every access
 * is guarded and a failure simply means there is nothing to resume.
 */
export function readLocalProgress(): GameProgress | null {
  if (wipeOwed()) return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const progress = parseStoredSave(raw);
  if (progress === null) console.warn('The save on this device failed validation; starting fresh.');
  return progress;
}

function parseStoredSave(text: string): GameProgress | null {
  try {
    return parseGameProgress(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeLocalProgress(data: GameProgressInput): void {
  if (PAGE_SAVE_LATCH.engaged) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stampGameProgress(data)));
  } catch {
    // Storage unavailable or full; the run continues, it just won't be resumable.
  }
}

/**
 * The device's save slot for {@link ProgressPersistence}. Unlike the helpers
 * above, both calls reject on failure: a save that could not be written must
 * say so to a caller waiting on it, and a wipe must keep retrying until the
 * slot is really empty.
 */
export const LOCAL_PROGRESS_STORAGE: ProgressStorage = {
  write(progress: GameProgress): Promise<void> {
    if (PAGE_SAVE_LATCH.engaged) return Promise.resolve();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  },
  remove(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  },
};
