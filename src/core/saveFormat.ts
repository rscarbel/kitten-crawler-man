import type { GameProgress, GameProgressInput } from '../auth/AuthClient';
import { parseSavedWorld } from './SavedWorld';
import { parseGameStatsSnapshot } from './GameStats';
import { isRecord } from './guards';
import type { PlayerSnapshot } from './PlayerSnapshot';
import { AchievementManager } from './AchievementManager';
import type { SerializedAchievements } from './AchievementManager';
import { parsePartyCraftsState } from './partyCrafts';

/**
 * The version of the save payload's shape, stamped on every save.
 *
 * Semantic versioning, read from the point of view of a build loading a save:
 * - PATCH — no change to the shape (a fix to how a value is interpreted).
 * - MINOR — optional fields added. Any build of the same major loads it: an
 *   older build ignores the new fields, a newer build treats them as absent.
 * - MAJOR — a field removed, renamed, or re-meant. Builds of another major
 *   refuse the save rather than resume a run from misread state.
 */
export const SAVE_FORMAT_VERSION = '1.0.0';

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

const SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * What an unversioned save is taken to be. Saves predating semantic versioning
 * carry either the local store's integer `1` or, from the server, no version at
 * all — both hold the shape that `1.0.0` names.
 */
const PRE_SEMVER_SAVE_VERSION = '1.0.0';
const PRE_SEMVER_LOCAL_VERSION = 1;

function parseSemanticVersion(text: string): SemanticVersion | null {
  const match = SEMANTIC_VERSION_PATTERN.exec(text);
  if (match === null) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

function formatSemanticVersion({ major, minor, patch }: SemanticVersion): string {
  return `${major}.${minor}.${patch}`;
}

function normalizeSaveVersion(raw: unknown): SemanticVersion | null {
  const isPreSemverSave = raw === undefined || raw === PRE_SEMVER_LOCAL_VERSION;
  if (isPreSemverSave) return parseSemanticVersion(PRE_SEMVER_SAVE_VERSION);
  return typeof raw === 'string' ? parseSemanticVersion(raw) : null;
}

/**
 * The save's version, normalised, when this build can load it; `null` when the
 * version is unreadable or belongs to another major. The place to add a
 * migration is here, once a major bump has an older major worth upgrading.
 */
function loadableSaveVersion(raw: unknown): string | null {
  const saveVersion = normalizeSaveVersion(raw);
  const buildVersion = parseSemanticVersion(SAVE_FORMAT_VERSION);
  if (saveVersion === null || buildVersion === null) return null;
  if (saveVersion.major !== buildVersion.major) return null;
  return formatSemanticVersion(saveVersion);
}

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

/**
 * A stored save screened into a `GameProgress`, or `null` when it is not one or
 * was written in a format this build cannot load. Used for both the device's
 * own save and the one the server hands back, which arrives as it was stored.
 */
export function parseGameProgress(raw: unknown): GameProgress | null {
  if (!isRecord(raw)) return null;
  const version = loadableSaveVersion(raw.version);
  if (version === null) return null;
  const { levelId, humanSnap, catSnap, savedAt, abilityStates } = raw;
  if (typeof levelId !== 'string' || typeof savedAt !== 'string') return null;
  if (!isPlayerSnapshot(humanSnap) || !isPlayerSnapshot(catSnap)) return null;
  return {
    version,
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
    crafts: parsePartyCraftsState(raw.crafts),
  };
}

/** A save as it is written: this build's format version and the time of writing. */
export function stampGameProgress(data: GameProgressInput): GameProgress {
  return { ...data, version: SAVE_FORMAT_VERSION, savedAt: new Date().toISOString() };
}
