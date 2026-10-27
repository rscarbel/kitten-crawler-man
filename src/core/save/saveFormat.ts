import type { GameProgress, GameProgressInput } from '../../auth/AuthClient';
import { parseSavedWorld } from './SavedWorld';
import { parseGameStatsSnapshot } from '../progression/GameStats';
import { isNonNegativeFinite, isRecord } from '../util/guards';
import { parsePlayerSnapshot } from './PlayerSnapshot';
import { AchievementManager } from '../progression/AchievementManager';
import { parsePartyCraftsState } from '../labour/partyCrafts';
import {
  parsePendingWheelOutcome,
  parseWheelFreeSpinBet,
  parseWheelOwedFreeze,
  parseWheelPrizesWon,
  parseWheelQuestFreeSpins,
} from './WheelLedger';
import { parseDoubleDamageRemaining } from './doubleDamageSave';
import { parseAttackCowHp } from '../state/AttackCowState';
import { MusicLibrary } from '../music/MusicLibrary';
import { parseViewerFavor } from '../progression/viewerFavor';
import { parseSerializedAbilityStates } from '../skills/AbilityManager';
import { isLevelId } from '../../levels/index';

/**
 * The fields of a save that belong to the whole run rather than to the floor it
 * was written on. Every save carries all of them — a save that leaves one out
 * wipes it, because a save replaces the stored one whole.
 */
type RunSaveFieldKey =
  | 'abilityStates'
  | 'crafts'
  | 'gameStats'
  | 'humanAchievements'
  | 'catAchievements'
  | 'mongoUnlocked'
  | 'mongoPetHp'
  | 'mongoPetResting'
  | 'wheelPrizesWon'
  | 'pendingWheelOutcome'
  | 'wheelFreeSpinBet'
  | 'wheelOwedFreeze'
  | 'wheelQuestFreeSpins'
  | 'doubleDamageRemaining'
  | 'attackCowOwned'
  | 'attackCowHp'
  | 'attackCowResting'
  | 'musicLibrary'
  | 'viewerFavor';

/**
 * Run fields whose absence means something, so their keys must be written but
 * their values may be `undefined`: the cow's HP (full, not yet measured) and
 * the viewers' favour (the AI has not moved it yet).
 */
type RunSaveFieldAbsentWhenUnmeasured = 'attackCowHp' | 'viewerFavor';

/**
 * The run-level fields every save path must write, built in one place so that a
 * save forgetting one is a type error rather than a silently dropped record.
 */
export type RunSaveFields = Required<
  Pick<GameProgressInput, Exclude<RunSaveFieldKey, RunSaveFieldAbsentWhenUnmeasured>>
> & {
  [K in RunSaveFieldAbsentWhenUnmeasured]: GameProgressInput[K];
};

/**
 * A stored save screened into a `GameProgress`, or `null` when any part of it
 * is missing or is not something this build writes. Used for both the
 * device's own save and the one the server hands back, which arrives as it
 * was stored.
 */
export function parseGameProgress(raw: unknown): GameProgress | null {
  if (!isRecord(raw)) return null;
  const { levelId, savedAt } = raw;
  if (typeof levelId !== 'string' || !isLevelId(levelId) || typeof savedAt !== 'string') {
    return null;
  }
  const humanSnap = parsePlayerSnapshot(raw.humanSnap, 'human');
  const catSnap = parsePlayerSnapshot(raw.catSnap, 'cat');
  const world = raw.world === undefined ? undefined : parseSavedWorld(raw.world);
  if (raw.world !== undefined && world === undefined) return null;
  const abilityStates = parseSerializedAbilityStates(raw.abilityStates);
  const humanAchievements = AchievementManager.parse(raw.humanAchievements)?.serialize();
  const catAchievements = AchievementManager.parse(raw.catAchievements)?.serialize();
  const gameStats = parseGameStatsSnapshot(raw.gameStats);
  const crafts = parsePartyCraftsState(raw.crafts);
  const wheelPrizesWon = parseWheelPrizesWon(raw.wheelPrizesWon);
  const pendingWheelOutcome = parsePendingWheelOutcome(raw.pendingWheelOutcome);
  const wheelFreeSpinBet = parseWheelFreeSpinBet(raw.wheelFreeSpinBet);
  const wheelOwedFreeze = parseWheelOwedFreeze(raw.wheelOwedFreeze);
  const wheelQuestFreeSpins = parseWheelQuestFreeSpins(raw.wheelQuestFreeSpins);
  const doubleDamageRemaining = parseDoubleDamageRemaining(raw.doubleDamageRemaining);
  const musicLibrary = MusicLibrary.parse(raw.musicLibrary);
  const { mongoUnlocked, mongoPetHp, mongoPetResting, attackCowOwned, attackCowResting } = raw;
  const attackCowHp = raw.attackCowHp === undefined ? undefined : parseAttackCowHp(raw.attackCowHp);
  const viewerFavor = raw.viewerFavor === undefined ? undefined : parseViewerFavor(raw.viewerFavor);
  if (
    humanSnap === undefined ||
    catSnap === undefined ||
    abilityStates === undefined ||
    humanAchievements === undefined ||
    catAchievements === undefined ||
    gameStats === undefined ||
    crafts === undefined ||
    wheelPrizesWon === undefined ||
    pendingWheelOutcome === undefined ||
    wheelFreeSpinBet === undefined ||
    wheelOwedFreeze === undefined ||
    wheelQuestFreeSpins === undefined ||
    doubleDamageRemaining === undefined ||
    musicLibrary === undefined ||
    typeof mongoUnlocked !== 'boolean' ||
    !isNonNegativeFinite(mongoPetHp) ||
    typeof mongoPetResting !== 'boolean' ||
    typeof attackCowOwned !== 'boolean' ||
    typeof attackCowResting !== 'boolean' ||
    (raw.attackCowHp !== undefined && attackCowHp === undefined) ||
    (raw.viewerFavor !== undefined && viewerFavor === undefined)
  ) {
    return null;
  }
  return {
    levelId,
    humanSnap,
    catSnap,
    abilityStates,
    mongoUnlocked,
    mongoPetHp,
    mongoPetResting,
    humanAchievements,
    catAchievements,
    world,
    gameStats,
    crafts,
    wheelPrizesWon,
    pendingWheelOutcome,
    wheelFreeSpinBet,
    wheelOwedFreeze,
    wheelQuestFreeSpins,
    doubleDamageRemaining,
    attackCowOwned,
    attackCowHp,
    attackCowResting,
    musicLibrary,
    viewerFavor,
    savedAt,
  };
}

/** A save as it is written, stamped with the time of writing. */
export function stampGameProgress(data: GameProgressInput): GameProgress {
  return { ...data, savedAt: new Date().toISOString() };
}
