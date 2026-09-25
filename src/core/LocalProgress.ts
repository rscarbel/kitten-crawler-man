import type { GameProgress, GameProgressInput } from '../auth/AuthClient';
import { parseGameProgress, stampGameProgress } from './saveFormat';

const STORAGE_KEY = 'kcm.progress';

/**
 * The last checkpoint written on this device, or `null` when there is none or
 * it cannot be trusted. `localStorage` throws outright in some privacy modes, so
 * every access is guarded and a failure simply means there is nothing to resume.
 */
export function readLocalProgress(): GameProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return parseGameProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeLocalProgress(data: GameProgressInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stampGameProgress(data)));
  } catch {
    // Storage unavailable or full; the run continues, it just won't be resumable.
  }
}

export function clearLocalProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored that we could reach, so nothing to clear.
  }
}
