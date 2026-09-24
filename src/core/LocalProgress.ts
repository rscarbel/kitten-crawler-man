import type { GameProgress, GameProgressInput } from '../auth/AuthClient';
import { parseSavedWorld } from './SavedWorld';
import { parseGameStatsSnapshot } from './GameStats';
import { isRecord } from './guards';
import type { PlayerSnapshot } from './PlayerSnapshot';
import { AchievementManager } from './AchievementManager';
import type { SerializedAchievements } from './AchievementManager';

const STORAGE_KEY = 'kcm.progress';
const LOCAL_PROGRESS_VERSION = 1;

/**
 * Shallow shape check: the fields a restore cannot survive without. Item ids and
 * numeric ranges are re-screened by `restorePlayer` itself, so this only has to
 * reject a blob that is not a snapshot at all (a hand-edited or truncated save).
 */
function isPlayerSnapshot(value: unknown): value is PlayerSnapshot {
  if (!isRecord(value)) return false;
  const numericFields = [
    value.hp,
    value.maxHp,
    value.level,
    value.xp,
    value.unspentPoints,
    value.strength,
    value.intelligence,
    value.constitution,
    value.coins,
    value.facingX,
    value.facingY,
    value.juggJuiceHpBoost,
  ];
  const arrayFields = [
    value.inventorySlots,
    value.inventoryHotbar,
    value.equippedEntries,
    value.statusEffects,
  ];
  return (
    numericFields.every((field) => typeof field === 'number') && arrayFields.every(Array.isArray)
  );
}

function parseAchievements(value: unknown): SerializedAchievements | undefined {
  return value === undefined ? undefined : AchievementManager.fromSerialized(value).serialize();
}

function parseProgress(raw: unknown): GameProgress | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== LOCAL_PROGRESS_VERSION) return null;
  const { levelId, humanSnap, catSnap, savedAt, abilityStates } = raw;
  if (typeof levelId !== 'string' || typeof savedAt !== 'string') return null;
  if (!isPlayerSnapshot(humanSnap) || !isPlayerSnapshot(catSnap)) return null;
  return {
    levelId,
    humanSnap,
    catSnap,
    savedAt,
    abilityStates: Array.isArray(abilityStates) ? abilityStates : undefined,
    mongoUnlocked: typeof raw.mongoUnlocked === 'boolean' ? raw.mongoUnlocked : undefined,
    mongoPetHp: typeof raw.mongoPetHp === 'number' ? raw.mongoPetHp : undefined,
    mongoPetResting: typeof raw.mongoPetResting === 'boolean' ? raw.mongoPetResting : undefined,
    humanAchievements: parseAchievements(raw.humanAchievements),
    catAchievements: parseAchievements(raw.catAchievements),
    world: parseSavedWorld(raw.world),
    gameStats: parseGameStatsSnapshot(raw.gameStats),
  };
}

/**
 * The last checkpoint written on this device, or `null` when there is none or
 * it cannot be trusted. `localStorage` throws outright in some privacy modes, so
 * every access is guarded and a failure simply means there is nothing to resume.
 */
export function readLocalProgress(): GameProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return parseProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeLocalProgress(data: GameProgressInput): void {
  try {
    const payload = { ...data, version: LOCAL_PROGRESS_VERSION, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
