import type { GameProgress, GameProgressInput } from '../../auth/AuthClient';
import { parseSavedWorld } from './SavedWorld';
import { parseGameStatsSnapshot } from '../progression/GameStats';
import { isNonNegativeFinite, isRecord } from '../util/guards';
import { parsePlayerSnapshot } from './playerSnapshotFormat';
import { parseSerializedAchievements } from '../progression/achievementSave';
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
import { parseSerializedAbilityStates } from '../skills/AbilityManager';
import { isLevelId } from '../../levels/levelIds';
import { parseObjectivesBriefed, parseStoryBeatsSeen } from '../../story/storySave';
import { parseSavedPetNames } from '../party/petNames';
import { parseSavedPlayerIdentity } from './playerIdentitySave';

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
  | 'deinonychusUnlocked'
  | 'deinonychusPetHp'
  | 'deinonychusPetResting'
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
  | 'storyBeatsSeen'
  | 'objectivesBriefed'
  | 'petNames'
  | 'playerIdentity';

/**
 * Run fields whose absence means something, so their keys must be written but
 * their values may be `undefined`: the cow's HP (full, not yet measured).
 */
type RunSaveFieldAbsentWhenUnmeasured = 'attackCowHp';

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
  const humanAchievements = parseSerializedAchievements(raw.humanAchievements);
  const catAchievements = parseSerializedAchievements(raw.catAchievements);
  const gameStats = parseGameStatsSnapshot(raw.gameStats);
  const crafts = parsePartyCraftsState(raw.crafts);
  const wheelPrizesWon = parseWheelPrizesWon(raw.wheelPrizesWon);
  const pendingWheelOutcome = parsePendingWheelOutcome(raw.pendingWheelOutcome);
  const wheelFreeSpinBet = parseWheelFreeSpinBet(raw.wheelFreeSpinBet);
  const wheelOwedFreeze = parseWheelOwedFreeze(raw.wheelOwedFreeze);
  const wheelQuestFreeSpins = parseWheelQuestFreeSpins(raw.wheelQuestFreeSpins);
  const doubleDamageRemaining = parseDoubleDamageRemaining(raw.doubleDamageRemaining);
  const musicLibrary = MusicLibrary.parse(raw.musicLibrary);
  const storyBeatsSeen = parseStoryBeatsSeen(raw.storyBeatsSeen);
  const objectivesBriefed = parseObjectivesBriefed(raw.objectivesBriefed);
  const petNames = parseSavedPetNames(raw.petNames);
  const playerIdentity = parseSavedPlayerIdentity(raw.playerIdentity);
  const {
    deinonychusUnlocked,
    deinonychusPetHp,
    deinonychusPetResting,
    attackCowOwned,
    attackCowResting,
  } = raw;
  const attackCowHp = raw.attackCowHp === undefined ? undefined : parseAttackCowHp(raw.attackCowHp);
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
    storyBeatsSeen === undefined ||
    objectivesBriefed === undefined ||
    petNames === undefined ||
    playerIdentity === undefined ||
    typeof deinonychusUnlocked !== 'boolean' ||
    !isNonNegativeFinite(deinonychusPetHp) ||
    typeof deinonychusPetResting !== 'boolean' ||
    typeof attackCowOwned !== 'boolean' ||
    typeof attackCowResting !== 'boolean' ||
    (raw.attackCowHp !== undefined && attackCowHp === undefined)
  ) {
    return null;
  }
  return {
    levelId,
    humanSnap,
    catSnap,
    abilityStates,
    deinonychusUnlocked,
    deinonychusPetHp,
    deinonychusPetResting,
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
    storyBeatsSeen,
    objectivesBriefed,
    petNames,
    playerIdentity,
    savedAt,
  };
}

/** A save as it is written, stamped with the time of writing. */
export function stampGameProgress(data: GameProgressInput): GameProgress {
  return { ...data, savedAt: new Date().toISOString() };
}
