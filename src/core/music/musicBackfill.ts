import type { LevelId } from '../../levels/levelIds';
import { TUTORIAL_LEVEL_ID } from '../../levels/tutorial';
import type { QuestId } from '../quests/QuestManager';
import type { GameProgressInput } from '../../auth/AuthClient';
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
} from '../../audio/sounds';
import { AchievementManager, type AchievementId } from '../progression/AchievementManager';
import {
  DEFEND_QUEST_PHASE_ORDER,
  SPIDER_QUEST_PHASE_ORDER,
  type PersistedWorldState,
} from '../save/PersistedWorldState';
import { MURDER_QUEST_STAGE_ORDER, type MurderQuestStage } from '../quests/MurderQuestProgress';
import { phaseAtLeast, type VillageQuestPhase } from '../quests/villageQuestPhase';
import { blueprintsPhaseAtLeast } from '../quests/blueprintsQuestPhase';
import { JACKPOT_FLOOR } from '../../systems/casino/slots/slotBets';
import type { PlayerSnapshot } from '../save/PlayerSnapshot';
import { allResidents, type ResidentId } from '../../systems/townResidents';
import { TAVERN_BUILDING_IDS } from '../../map/town/townPlan';
import { PLANNED_BUILDING_IDS, type BuildingId } from '../../map/buildingIds';
import { buildingOfRoomKey } from '../state/TownMemory';
import type { CloggedBathroomPhase } from '../../systems/cloggedBathroom/cloggedBathroomCheckpoint';
import type { StealthKeySnatchPhase } from '../../systems/stealthKeySnatch/stealthKeySnatchCheckpoint';

const LEVEL_1_ID = 'level1' satisfies LevelId;
const LEVEL_2_ID = 'level2' satisfies LevelId;
const LEVEL_3_ID = 'level3' satisfies LevelId;
const DUNGEON_FLOOR_IDS: ReadonlySet<LevelId> = new Set([LEVEL_1_ID, LEVEL_2_ID, LEVEL_3_ID]);
const FLOORS_PAST_LEVEL_1: ReadonlySet<LevelId> = new Set([LEVEL_2_ID, LEVEL_3_ID]);

/** Floor 1's two boss rooms, by their index in the boss-room checkpoint. */
const FLOOR_1_FIRST_BOSS_ROOM_INDEX = 0;
const FLOOR_1_SECOND_BOSS_ROOM_INDEX = 1;

/** The quests the wheel ledger records a free spin under, by their quest ids. */
const SPIDER_LAB_QUEST_ID = 'grotesque_spider' as const satisfies QuestId;
const BRIAR_HOLLOW_QUEST_ID = 'briar_hollow_plea' as const satisfies QuestId;

/** Kill tallies are keyed by each creature's display name. */
const GROTESQUE_SPIDER_NAME = 'Grotesque Spider';
const BALL_OF_SWINE_NAME = 'Ball of Swine';
const MISS_QUILL_NAME = 'Miss Quill';
const KRAKAREN_CLONE_NAME = 'Krakaren Clone';
const RUINS_GHOUL_NAME = 'Ruins Ghoul';
const SHRINE_VERMIN_NAME = 'Shrine Vermin';

const CLUB_ACHIEVEMENTS: readonly AchievementId[] = [
  'on_retainer',
  'bartenders_choice',
  'casino_jackpot',
];
const DOOMSDAY_ACHIEVEMENTS: readonly AchievementId[] = ['disaster_averted', 'out_before_the_fall'];

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

function murderStageAtLeast(stage: MurderQuestStage, threshold: MurderQuestStage): boolean {
  return atLeast(MURDER_QUEST_STAGE_ORDER, stage, threshold);
}

/**
 * The songs a building plays as its party walks in, or nothing for a building
 * outside the town (the Starlight Tent and the prison have their own music).
 */
function buildingMusic(buildingId: BuildingId): ReadonlyArray<MusicTrackId> {
  if (TAVERN_BUILDING_IDS.has(buildingId)) return TAVERN_MUSIC_TRACKS;
  if (buildingId === 'taloncrest_temple') return TEMPLE_MUSIC_TRACKS;
  if (buildingId === 'taloncrest_tower') return TOWER_MUSIC_TRACKS;
  if (buildingId === 'taloncrest_nightclub') return CLUB_MUSIC_TRACKS;
  const isTownBuilding = PLANNED_BUILDING_IDS.some((planned) => planned === buildingId);
  return isTownBuilding ? DEFAULT_BUILDING_MUSIC_TRACKS : [];
}

/** Whether either of the parlour's tattoos has been inked. */
function hasParlourTattoo(snap: PlayerSnapshot): boolean {
  return snap.tattoo !== null || snap.skillTattoo !== null;
}

function hasLearnedResourcing(snap: PlayerSnapshot): boolean {
  return snap.craftSkillStates.resourcing.learned;
}

/**
 * The songs a run's progress has already earned, read off that progress:
 * every song whose place or activity the evidence proves, or makes likely
 * where a wrong guess costs little. A playlist unlocks whole once its place is
 * proven, as a claim of it would. A dev boot onto a later floor runs it over
 * its starting state, so the library matches the ground it skipped.
 *
 * `persisted` describes only the floor the progress is on, so floor-specific
 * evidence is read only on that floor.
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
  const floorState = (floorId: LevelId): PersistedWorldState | undefined =>
    levelId === floorId ? persisted : undefined;
  const level1State = floorState(LEVEL_1_ID);
  const level2State = floorState(LEVEL_2_ID);

  const achievementManagers = [progress.humanAchievements, progress.catAchievements].map(
    (serialized) => AchievementManager.fromSerialized(serialized),
  );
  const achieved = (ids: readonly AchievementId[]): boolean =>
    achievementManagers.some((manager) => ids.some((id) => manager.isUnlocked(id)));

  const kills = new Map(progress.gameStats.killsByType);
  const killed = (name: string): boolean => (kills.get(name) ?? 0) > 0;

  const freeSpinsEarnedBy = progress.wheelQuestFreeSpins.earnedBy;
  const earnedFreeSpin = (questId: string): boolean => freeSpinsEarnedBy.includes(questId);
  const snaps = [progress.humanSnap, progress.catSnap];

  const murderStage = persisted?.murderQuestProgress.stage ?? 'not_started';
  const villagePhase = persisted?.briarHollow.quest.phase ?? 'unmet';
  const blueprintsPhase = persisted?.briarHollow.blueprints.phase ?? 'unoffered';
  const doomsdayStarted = (persisted?.doomsday.stage ?? 'inactive') !== 'inactive';
  const bountiesCompleted = (persisted?.bountyProgress.bountiesCompleted ?? 0) > 0;
  const villageQuestBegun = villagePhase !== 'unmet';
  const briarHollowPleaPaid = earnedFreeSpin(BRIAR_HOLLOW_QUEST_ID);

  const { tools } = progress.crafts;
  const hasToolTier = tools.axeTier !== null || tools.pickaxeTier !== null;

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
  ]
    .map(buildingOfRoomKey)
    .filter((id) => id !== undefined);
  const rememberedBuilding = (id: BuildingId): boolean => rememberedBuildings.includes(id);
  const visitedPlaces = new Set(townMemory?.visitedPlaces ?? []);

  // A run past the tutorial can never return to it, whether it played it or skipped it.
  if (levelId === TUTORIAL_LEVEL_ID || DUNGEON_FLOOR_IDS.has(levelId)) unlock(['tutorial_island']);

  if (DUNGEON_FLOOR_IDS.has(levelId)) unlock(['bg_level_1']);
  if (FLOORS_PAST_LEVEL_1.has(levelId)) unlock(['bg_level_2', 'boss_music_1', 'boss_music_2']);

  const floor1BossRoomsEntered = level1State?.bossRoom.enteredRoomIndices ?? [];
  if (floor1BossRoomsEntered.includes(FLOOR_1_FIRST_BOSS_ROOM_INDEX)) unlock(['boss_music_1']);
  if (floor1BossRoomsEntered.includes(FLOOR_1_SECOND_BOSS_ROOM_INDEX)) unlock(['boss_music_2']);
  if (level1State?.bigRoosterKilled === true) unlock(['boss_music_2']);

  if (onLevel3) unlock(['boss_music_3', 'fix_the_plumbing_music', 'stealth_music']);
  if (killed(KRAKAREN_CLONE_NAME) || persisted?.krakarenKilled === true) unlock(['boss_music_3']);
  const bathroomPhase = level2State?.cloggedBathroom.phase;
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
    visitedPlaces.has('circus_grounds') ||
    (townMemory?.clearedCamps.length ?? 0) > 0 ||
    bountiesCompleted ||
    killed(RUINS_GHOUL_NAME) ||
    briarHollowPleaPaid;
  if (onLevel3 && wildsVisited) unlock(WILDS_MUSIC_TRACKS);

  const briarHollowVisited =
    hasToolTier ||
    snaps.some(hasLearnedResourcing) ||
    villageQuestBegun ||
    Object.values(persisted?.briarHollow.talkCounts ?? {}).some((count) => count > 0) ||
    briarHollowPleaPaid;
  if (briarHollowVisited) unlock(['briar_hollow_theme']);
  if (phaseAtLeast(villagePhase, 'gather_stone')) unlock(['under_the_willows']);
  if (blueprintsPhaseAtLeast(blueprintsPhase, 'build_fence')) unlock(['hayfield_afternoon']);
  if (phaseAtLeast(villagePhase, 'report_tikka')) unlock(['medieval_harvest_theme']);
  const siegeFought =
    (persisted?.briarHollow.quest.lastSiege ?? null) !== null ||
    POST_SIEGE_PHASES.has(villagePhase) ||
    briarHollowPleaPaid;
  if (siegeFought) unlock(['siege_theme']);

  if (visitedPlaces.has('circus_grounds')) unlock(CIRCUS_MUSIC_TRACKS);
  if (visitedPlaces.has('starlight_tent')) unlock(['circus_battle']);

  const club = persisted?.casinoState;
  const wheelPlayed =
    progress.wheelPrizesWon.length > 0 ||
    progress.wheelQuestFreeSpins.used > 0 ||
    progress.attackCowOwned;
  const casinoPlayed =
    achieved(['casino_jackpot']) ||
    (club?.casinoShoe ?? null) !== null ||
    Object.keys(club?.pokerReads ?? {}).length > 0 ||
    (club?.slotsJackpotPool ?? JACKPOT_FLOOR) > JACKPOT_FLOOR ||
    wheelPlayed;
  const clubVisited = achieved(CLUB_ACHIEVEMENTS) || casinoPlayed;
  if (clubVisited) unlock(CLUB_MUSIC_TRACKS);
  if (casinoPlayed) unlock(CASINO_MUSIC_TRACKS);

  for (const home of residentHomes) unlock(buildingMusic(home));
  for (const building of rememberedBuildings) unlock(buildingMusic(building));
  if ([...talkedTo].some((id) => INNKEEPER_IDS.has(id))) unlock(TAVERN_MUSIC_TRACKS);
  const anchorQuest = persisted?.anchorQuestProgress;
  if ((anchorQuest?.lori ?? 'offered') !== 'offered' || snaps.some(hasParlourTattoo)) {
    unlock(DEFAULT_BUILDING_MUSIC_TRACKS);
  }

  const templeVisited =
    (anchorQuest?.temple ?? 'offered') !== 'offered' ||
    talkedTo.has(TEMPLE_DEACON_ID) ||
    rememberedBuilding('taloncrest_temple') ||
    killed(SHRINE_VERMIN_NAME);
  if (templeVisited) unlock(TEMPLE_MUSIC_TRACKS);

  const towerClimbed =
    murderStageAtLeast(murderStage, 'quill_slain') ||
    rememberedBuilding('taloncrest_tower') ||
    doomsdayStarted;
  if (towerClimbed) unlock(TOWER_MUSIC_TRACKS);

  const lichFought =
    murderStageAtLeast(murderStage, 'lich_slain') ||
    doomsdayStarted ||
    achieved(DOOMSDAY_ACHIEVEMENTS);
  if (lichFought) unlock(['boss_music_2']);

  return unlocks;
}
