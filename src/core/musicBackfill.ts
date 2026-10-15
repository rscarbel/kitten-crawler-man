import type { GameProgressInput } from '../auth/AuthClient';
import {
  CASINO_MUSIC_TRACKS,
  CIRCUS_MUSIC_TRACKS,
  CLUB_MUSIC_TRACKS,
  DEFAULT_BUILDING_MUSIC_TRACKS,
  TAVERN_MUSIC_TRACKS,
  TEMPLE_MUSIC_TRACKS,
  TOWER_MUSIC_TRACKS,
  TOWN_MUSIC_TRACKS,
  WILDS_MUSIC_TRACKS,
  type MusicTrackId,
} from '../audio/sounds';
import { AchievementManager, type AchievementId } from './AchievementManager';
import {
  DEFEND_QUEST_PHASE_ORDER,
  SPIDER_QUEST_PHASE_ORDER,
  type PersistedWorldState,
} from './PersistedWorldState';
import { CIRCUS_QUEST_STAGE_ORDER, type CircusQuestStage } from './CircusQuestProgress';
import { MURDER_QUEST_STAGE_ORDER, type MurderQuestStage } from './MurderQuestProgress';
import { phaseAtLeast, type VillageQuestPhase } from './villageQuestPhase';
import { blueprintsPhaseAtLeast } from './blueprintsQuestPhase';
import { JACKPOT_FLOOR } from '../systems/casino/slots/slotBets';
import { parseCraftSkillsSnapshot } from './CraftSkills';
import type { PlayerSnapshot } from './PlayerSnapshot';
import { allResidents, type ResidentId } from '../systems/townResidents';
import {
  DESPERADO_CLUB_NAME,
  PLANNED_BUILDING_NAMES,
  TAVERN_BUILDING_NAMES,
  TOWN_TOWER_NAME,
} from '../map/town/townPlan';
import { SKY_TEMPLE_NAME } from '../systems/interiorStoryOwnership';
import { buildingNameOfRoomKey } from './TownMemory';
import type { CloggedBathroomPhase } from '../systems/cloggedBathroom/cloggedBathroomCheckpoint';
import type { StealthKeySnatchPhase } from '../systems/stealthKeySnatch/stealthKeySnatchCheckpoint';

const TUTORIAL_LEVEL_ID = 'tutorial';
const LEVEL_1_ID = 'level1';
const LEVEL_2_ID = 'level2';
const LEVEL_3_ID = 'level3';
const DUNGEON_FLOOR_IDS: ReadonlySet<string> = new Set([LEVEL_1_ID, LEVEL_2_ID, LEVEL_3_ID]);
const FLOORS_PAST_LEVEL_1: ReadonlySet<string> = new Set([LEVEL_2_ID, LEVEL_3_ID]);

/** Floor 1's two boss rooms, by their index in the boss-room checkpoint. */
const FLOOR_1_FIRST_BOSS_ROOM_INDEX = 0;
const FLOOR_1_SECOND_BOSS_ROOM_INDEX = 1;

/** The quests the wheel ledger records a free spin under, by their quest ids. */
const SPIDER_LAB_QUEST_ID = 'grotesque_spider';
const BRIAR_HOLLOW_QUEST_ID = 'briar_hollow_plea';

/** Kill tallies are keyed by each creature's display name. */
const GROTESQUE_SPIDER_NAME = 'Grotesque Spider';
const BALL_OF_SWINE_NAME = 'Ball of Swine';
const MISS_QUILL_NAME = 'Miss Quill';
const RUINS_GHOUL_NAME = 'Ruins Ghoul';
const SHRINE_VERMIN_NAME = 'Shrine Vermin';

const CLUB_ACHIEVEMENTS: readonly AchievementId[] = [
  'desperado_member',
  'merc_hired',
  'club_bodyguards',
  'ask_for_it_dirty',
  'casino_jackpot',
];
const DOOMSDAY_ACHIEVEMENTS: readonly AchievementId[] = ['doomsday_contained', 'city_evacuated'];

const INNKEEPER_IDS: ReadonlySet<ResidentId> = new Set([
  'innkeep_ossie',
  'innkeep_brend',
  'innkeep_marlow',
]);
const TEMPLE_DEACON_ID = 'deacon_aviel' satisfies ResidentId;

const BATHROOM_SOLVED_PHASES: ReadonlySet<CloggedBathroomPhase> = new Set(['solved', 'thanked']);
const STEALTH_KEY_TAKEN_PHASES: ReadonlySet<StealthKeySnatchPhase> = new Set(['keyHeld', 'opened']);
const POST_SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set([
  'repelled_failed',
  'repair_bell',
  'victory',
  'complete',
]);

function atLeast<T>(order: readonly T[], value: T, threshold: T): boolean {
  return order.indexOf(value) >= order.indexOf(threshold);
}

function circusStageAtLeast(stage: CircusQuestStage, threshold: CircusQuestStage): boolean {
  return atLeast(CIRCUS_QUEST_STAGE_ORDER, stage, threshold);
}

function murderStageAtLeast(stage: MurderQuestStage, threshold: MurderQuestStage): boolean {
  return atLeast(MURDER_QUEST_STAGE_ORDER, stage, threshold);
}

/**
 * The songs a building plays as its party walks in, or nothing for a name that
 * is not a town building (a dungeon floor's rooms play the floor's own music).
 */
function buildingMusic(name: string): ReadonlyArray<MusicTrackId> {
  if (TAVERN_BUILDING_NAMES.has(name)) return TAVERN_MUSIC_TRACKS;
  if (name === SKY_TEMPLE_NAME) return TEMPLE_MUSIC_TRACKS;
  if (name === TOWN_TOWER_NAME) return TOWER_MUSIC_TRACKS;
  if (name === DESPERADO_CLUB_NAME) return CLUB_MUSIC_TRACKS;
  const isTownBuilding = PLANNED_BUILDING_NAMES.some((planned) => planned === name);
  return isTownBuilding ? DEFAULT_BUILDING_MUSIC_TRACKS : [];
}

/** A tattoo from the parlour; the Desperado Pass tattoo is the Juicer's reward, not the parlour's. */
function hasParlourTattoo(snap: PlayerSnapshot): boolean {
  return snap.tattooStat !== null || (snap.skillTattoo ?? null) !== null;
}

function hasLearnedResourcing(snap: PlayerSnapshot): boolean {
  return parseCraftSkillsSnapshot(snap.craftSkillStates)?.resourcing.learned === true;
}

/**
 * The songs a save had already earned before the music library existed, read
 * off its progress: every song whose place or activity the evidence proves,
 * or makes likely where a wrong guess costs little. A playlist unlocks whole
 * once its place is proven, as a claim of it would.
 *
 * `persisted` is the save's floor state read straight from its JSON, whatever
 * generator wrote it, so a save whose floor is about to be regenerated still
 * records what the party did there. It describes only the floor the save is
 * on, so floor-specific evidence is read only on that floor. A save written on
 * the stairs has neither it nor achievements and is read from `levelId` and
 * the run-level fields alone.
 */
export function musicUnlocksFromProgress(
  progress: GameProgressInput,
  persisted: PersistedWorldState | undefined,
): ReadonlySet<MusicTrackId> {
  const unlocks = new Set<MusicTrackId>();
  const unlock = (ids: Iterable<MusicTrackId>): void => {
    for (const id of ids) unlocks.add(id);
  };

  const { levelId } = progress;
  const onLevel3 = levelId === LEVEL_3_ID;
  const floorState = (floorId: string): PersistedWorldState | undefined =>
    levelId === floorId ? persisted : undefined;
  const level1State = floorState(LEVEL_1_ID);
  const level2State = floorState(LEVEL_2_ID);

  const achievementManagers = [progress.humanAchievements, progress.catAchievements]
    .filter((serialized) => serialized !== undefined)
    .map((serialized) => AchievementManager.fromSerialized(serialized));
  const achieved = (ids: readonly AchievementId[]): boolean =>
    achievementManagers.some((manager) => ids.some((id) => manager.isUnlocked(id)));

  const kills = new Map(progress.gameStats?.killsByType ?? []);
  const killed = (name: string): boolean => (kills.get(name) ?? 0) > 0;

  const freeSpinsEarnedBy = progress.wheelQuestFreeSpins?.earnedBy ?? [];
  const earnedFreeSpin = (questId: string): boolean => freeSpinsEarnedBy.includes(questId);
  const snaps = [progress.humanSnap, progress.catSnap];

  const circusStage = persisted?.circusQuestProgress.stage ?? 'not_started';
  const murderStage = persisted?.murderQuestProgress.stage ?? 'not_started';
  const villagePhase = persisted?.briarHollow?.quest.phase ?? 'unmet';
  const blueprintsPhase = persisted?.briarHollow?.blueprints.phase ?? 'unoffered';
  const doomsdayStarted = (persisted?.doomsday?.stage ?? 'inactive') !== 'inactive';
  const bountiesCompleted = (persisted?.bountyProgress.bountiesCompleted ?? 0) > 0;
  const villageQuestBegun = villagePhase !== 'unmet';
  const briarHollowPleaPaid = earnedFreeSpin(BRIAR_HOLLOW_QUEST_ID);

  const tools = progress.crafts?.tools;
  const hasToolTier = tools !== undefined && (tools.axeTier !== null || tools.pickaxeTier !== null);

  const townMemory = persisted?.townMemory;
  const talkedTo = new Set(
    (townMemory?.residentTalks ?? []).filter(([, count]) => count > 0).map(([id]) => id),
  );
  const residentHomes = allResidents()
    .filter((resident) => talkedTo.has(resident.id))
    .map((resident) => resident.home);
  const rememberedBuildings = [
    ...(townMemory?.clearedRooms ?? []),
    ...(townMemory?.paidOutInteriorProps ?? []),
  ].map(buildingNameOfRoomKey);
  const rememberedBuilding = (name: string): boolean => rememberedBuildings.includes(name);

  // A run past the tutorial can never return to it, whether it played it or skipped it.
  if (levelId === TUTORIAL_LEVEL_ID || DUNGEON_FLOOR_IDS.has(levelId)) unlock(['tutorial_island']);

  if (DUNGEON_FLOOR_IDS.has(levelId)) unlock(['bg_level_1']);
  if (FLOORS_PAST_LEVEL_1.has(levelId)) unlock(['bg_level_2', 'boss_music_1', 'boss_music_2']);

  const floor1BossRoomsEntered = level1State?.bossRoom.enteredRoomIndices ?? [];
  if (floor1BossRoomsEntered.includes(FLOOR_1_FIRST_BOSS_ROOM_INDEX)) unlock(['boss_music_1']);
  if (floor1BossRoomsEntered.includes(FLOOR_1_SECOND_BOSS_ROOM_INDEX)) unlock(['boss_music_2']);
  if (progress.humanSnap.desperadoPassTattoo === true) unlock(['boss_music_2']);

  if (onLevel3) unlock(['boss_music_3', 'fix_the_plumbing_music', 'stealth_music']);
  if (progress.mongoUnlocked === true) unlock(['boss_music_3']);
  const bathroomPhase = level2State?.cloggedBathroom?.phase;
  if (bathroomPhase !== undefined && BATHROOM_SOLVED_PHASES.has(bathroomPhase)) {
    unlock(['fix_the_plumbing_music']);
  }
  const stealthGate = level2State?.stealthKeySnatch;
  if (
    stealthGate !== undefined &&
    (STEALTH_KEY_TAKEN_PHASES.has(stealthGate.phase) || stealthGate.explainerSeen)
  ) {
    unlock(['stealth_music']);
  }

  const bountyBossNames = Object.values(persisted?.bountyProgress.namesByType ?? {}).flatMap(
    (names) => names ?? [],
  );
  const killedBossOnBossMusic3 =
    killed(GROTESQUE_SPIDER_NAME) ||
    killed(BALL_OF_SWINE_NAME) ||
    killed(MISS_QUILL_NAME) ||
    bountyBossNames.some(killed);
  if (killedBossOnBossMusic3 || bountiesCompleted || persisted?.arena.arenaLocked === true) {
    unlock(['boss_music_3']);
  }

  const spiderLab = level2State?.spiderQuest;
  const labHacked =
    spiderLab !== undefined &&
    (spiderLab.hackingDone || atLeast(SPIDER_QUEST_PHASE_ORDER, spiderLab.phase, 'hacking'));
  if (earnedFreeSpin(SPIDER_LAB_QUEST_ID) || killed(GROTESQUE_SPIDER_NAME) || labHacked) {
    unlock(['keyboard_hero_music_track_1']);
  }

  const defendPhase = persisted?.defendQuest.phase ?? 'inactive';
  if (
    achieved(['quest_defend_npc']) ||
    atLeast(DEFEND_QUEST_PHASE_ORDER, defendPhase, 'countdown') ||
    murderStageAtLeast(murderStage, 'cult_hideout') ||
    blueprintsPhaseAtLeast(blueprintsPhase, 'midge_delivered')
  ) {
    unlock(['brace_for_the_horde']);
  }

  if (onLevel3) unlock(TOWN_MUSIC_TRACKS);
  const wildsVisited =
    hasToolTier ||
    villageQuestBegun ||
    circusStage !== 'not_started' ||
    (townMemory?.clearedCamps.length ?? 0) > 0 ||
    bountiesCompleted ||
    killed(RUINS_GHOUL_NAME) ||
    briarHollowPleaPaid;
  if (onLevel3 && wildsVisited) unlock(WILDS_MUSIC_TRACKS);

  const briarHollowVisited =
    hasToolTier ||
    snaps.some(hasLearnedResourcing) ||
    villageQuestBegun ||
    Object.values(persisted?.briarHollow?.talkCounts ?? {}).some((count) => count > 0) ||
    briarHollowPleaPaid;
  if (briarHollowVisited) unlock(['briar_hollow_theme']);
  if (phaseAtLeast(villagePhase, 'report_tikka')) unlock(['medieval_harvest_theme']);
  const siegeFought =
    (persisted?.briarHollow?.quest.lastSiege ?? null) !== null ||
    POST_SIEGE_PHASES.has(villagePhase) ||
    briarHollowPleaPaid;
  if (siegeFought) unlock(['siege_theme']);

  if (circusStage !== 'not_started') unlock(CIRCUS_MUSIC_TRACKS);
  if (circusStageAtLeast(circusStage, 'ritual_defense')) unlock(['circus_battle']);

  const club = persisted?.clubMembership;
  const wheelPlayed =
    (progress.wheelPrizesWon ?? []).length > 0 ||
    (progress.wheelQuestFreeSpins?.used ?? 0) > 0 ||
    progress.attackCowOwned === true;
  const casinoPlayed =
    achieved(['casino_jackpot']) ||
    (club?.casinoShoe ?? null) !== null ||
    Object.keys(club?.pokerReads ?? {}).length > 0 ||
    (club?.slotsJackpotPool ?? JACKPOT_FLOOR) > JACKPOT_FLOOR ||
    wheelPlayed;
  const clubVisited =
    achieved(CLUB_ACHIEVEMENTS) || club?.hasDesperadoPass === true || casinoPlayed;
  if (clubVisited) unlock(CLUB_MUSIC_TRACKS);
  if (casinoPlayed) unlock(CASINO_MUSIC_TRACKS);

  for (const home of residentHomes) unlock(buildingMusic(home));
  for (const building of rememberedBuildings) unlock(buildingMusic(building));
  if ([...talkedTo].some((id) => INNKEEPER_IDS.has(id))) unlock(TAVERN_MUSIC_TRACKS);
  const anchorQuest = persisted?.anchorQuestProgress;
  if ((anchorQuest?.hilda ?? 'offered') !== 'offered' || snaps.some(hasParlourTattoo)) {
    unlock(DEFAULT_BUILDING_MUSIC_TRACKS);
  }

  const templeVisited =
    (anchorQuest?.temple ?? 'offered') !== 'offered' ||
    talkedTo.has(TEMPLE_DEACON_ID) ||
    rememberedBuilding(SKY_TEMPLE_NAME) ||
    killed(SHRINE_VERMIN_NAME);
  if (templeVisited) unlock(TEMPLE_MUSIC_TRACKS);

  const towerClimbed =
    murderStageAtLeast(murderStage, 'quill_slain') ||
    rememberedBuilding(TOWN_TOWER_NAME) ||
    doomsdayStarted;
  if (towerClimbed) unlock(TOWER_MUSIC_TRACKS);

  const lichFought =
    murderStageAtLeast(murderStage, 'lich_slain') ||
    doomsdayStarted ||
    achieved(DOOMSDAY_ACHIEVEMENTS);
  if (lichFought) unlock(['boss_music_2']);

  return unlocks;
}
