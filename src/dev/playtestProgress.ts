import type { LevelId } from '../levels/levelIds';
import type { AchievementId } from '../core/progression/achievementSave';
import type { AdviceObjectiveId } from '../story/adviceObjectiveIds';
import type { DebriefBossType } from '../core/mobs/debriefBossTypes';
import type { GearId } from '../loot/gearPools';
import { STORY_BEAT_ORDER, type StoryBeatId } from '../story/storyBeatIds';

/**
 * How far through a run a playtest preset stands, and everything a player who
 * walked there would have behind them: the story Dave and Caroline have told,
 * the objectives Caroline has briefed, the bosses killed, the achievements
 * earned and where the run's gear came from. Pure data, like the preset table
 * that names one per preset; `playtestBoot.ts` turns it into managers, gear
 * and floor state.
 *
 * Each point is what a party has heard and earned on *arriving* there, so a
 * preset dropped into a safe room has already had the talk its arrival
 * triggers; `?story=<beatId>` replays any one beat on its own.
 */
export const RUN_MILESTONES = [
  /** Out of the tutorial and down the stairs onto floor 1. */
  'floor1_start',
  /** In the safe room guarding the Trash Gremlin. */
  'floor1_before_trash_gremlin',
  /** The Trash Gremlin dead, standing in the goblin mother's nursery with her wave still to play. */
  'floor1_nursery',
  /** The nursery held, in the safe room guarding the Kraken. */
  'floor1_before_kraken',
  /** Both of floor 1's bosses dead, the stairwell ahead. */
  'floor1_past_kraken',
  /** Just down the stairs onto floor 2. */
  'floor2_start',
  /** In the safe room guarding the Current Goblin. */
  'floor2_before_current_goblin',
  /** The Current Goblin dead and his exit room walked through, the stealth gate still locked ahead. */
  'floor2_past_current_goblin',
  /** Through the stealth gate and floor 2's nursery, in the safe room guarding Big Rooster. */
  'floor2_before_big_rooster',
  /** Just down the stairs into the town on floor 3, the Sleeping Cat Inn not yet visited. */
  'floor3_arrival',
  /** A while on floor 3: the inn's safe room visited enough times for all of Dave's floor-3 talks. */
  'floor3_settled',
] as const;

export type RunMilestone = (typeof RUN_MILESTONES)[number];

/** The dungeon floors whose bosses and chests a run passes through before the town. */
export type DungeonFloor = 1 | 2;

/** The floor each boss is fought on. */
export const BOSS_FLOOR = {
  trash_gremlin: 1,
  kraken: 1,
  electric_goblin: 2,
  big_rooster: 2,
} as const satisfies Record<DebriefBossType, DungeonFloor>;

/** What a party standing at one {@link RunMilestone} has already done. */
export interface RunProgress {
  readonly levelId: Extract<LevelId, 'level1' | 'level2' | 'level3'>;
  /** The newest beat heard; every beat before it in play order has been heard too. */
  readonly lastBeatHeard: StoryBeatId;
  /** Objectives Caroline has briefed, each one the party has since put behind it. */
  readonly objectivesBriefed: readonly AdviceObjectiveId[];
  /** Every boss killed so far, on any floor, in the order they fell. */
  readonly bossesDefeated: readonly DebriefBossType[];
  /**
   * Achievements a party this far along has all but certainly earned through
   * how it plays. A crawler earns only those its `playerType` allows. Those
   * that follow from the rest of this record — Boss Slayer, Guardian Angel,
   * the kill ladder — are derived from it instead of listed here.
   */
  readonly playAchievements: readonly AchievementId[];
  /** The party's dungeon kill tally, which decides the kill-ladder achievements. */
  readonly dungeonKills: number;
  /** Goblin mothers' nurseries held, one per floor: the first pays Guardian Angel, each later one a quest chest. */
  readonly nurseriesHeld: number;
  /** Gear paid by quests finished so far, each to the crawler who can wear it. */
  readonly questGear: readonly GearId[];
  /** Wooden chests opened on each dungeon floor, each one rolled for gear as the floor's own chests are. */
  readonly woodenChestsOpened: Readonly<Record<DungeonFloor, number>>;
}

/**
 * Played instead of the tutorial's own beats by a run that skipped it. Every
 * preset's run played the tutorial, so this one was never needed.
 */
const SKIPPED_TUTORIAL_BEAT: StoryBeatId = 'skipped_tutorial_dave_intro';

const FLOOR1_START = {
  levelId: 'level1',
  lastBeatHeard: 'floor1_caroline_arrival',
  objectivesBriefed: [],
  bossesDefeated: [],
  playAchievements: ['first_kill', 'up_close', 'magic_touch', 'safe_haven', 'entered_dungeon'],
  dungeonKills: 0,
  nurseriesHeld: 0,
  questGear: [],
  woodenChestsOpened: { 1: 0, 2: 0 },
} as const satisfies RunProgress;

const FLOOR1_BEFORE_TRASH_GREMLIN = {
  ...FLOOR1_START,
  lastBeatHeard: 'floor1_dave_how_it_began',
  playAchievements: [...FLOOR1_START.playAchievements, 'flat_out'],
  dungeonKills: 70,
  woodenChestsOpened: { 1: 5, 2: 0 },
} as const satisfies RunProgress;

const FLOOR1_NURSERY = {
  ...FLOOR1_BEFORE_TRASH_GREMLIN,
  lastBeatHeard: 'floor1_dave_the_morning',
  objectivesBriefed: ['trash_gremlin'],
  bossesDefeated: ['trash_gremlin'],
  playAchievements: [...FLOOR1_BEFORE_TRASH_GREMLIN.playAchievements, 'two_birds_one_stick'],
  dungeonKills: 120,
  woodenChestsOpened: { 1: 8, 2: 0 },
} as const satisfies RunProgress;

const FLOOR1_BEFORE_KRAKEN = {
  ...FLOOR1_NURSERY,
  objectivesBriefed: [...FLOOR1_NURSERY.objectivesBriefed, 'defend_goblin_mother'],
  dungeonKills: 150,
  nurseriesHeld: 1,
  woodenChestsOpened: { 1: 10, 2: 0 },
} as const satisfies RunProgress;

const FLOOR1_PAST_KRAKEN = {
  ...FLOOR1_BEFORE_KRAKEN,
  lastBeatHeard: 'floor1_caroline_motive',
  objectivesBriefed: [...FLOOR1_BEFORE_KRAKEN.objectivesBriefed, 'kraken'],
  bossesDefeated: [...FLOOR1_BEFORE_KRAKEN.bossesDefeated, 'kraken'],
  dungeonKills: 190,
  woodenChestsOpened: { 1: 14, 2: 0 },
} as const satisfies RunProgress;

const FLOOR2_START = {
  ...FLOOR1_PAST_KRAKEN,
  levelId: 'level2',
  lastBeatHeard: 'floor2_caroline_arrival',
  playAchievements: [...FLOOR1_PAST_KRAKEN.playAchievements, 'wrecking_ball'],
  dungeonKills: 220,
} as const satisfies RunProgress;

const FLOOR2_BEFORE_CURRENT_GOBLIN = {
  ...FLOOR2_START,
  lastBeatHeard: 'floor2_dave_his_story',
  dungeonKills: 280,
  woodenChestsOpened: { 1: 14, 2: 6 },
} as const satisfies RunProgress;

const FLOOR2_PAST_CURRENT_GOBLIN = {
  ...FLOOR2_BEFORE_CURRENT_GOBLIN,
  lastBeatHeard: 'floor2_caroline_current',
  objectivesBriefed: [...FLOOR2_BEFORE_CURRENT_GOBLIN.objectivesBriefed, 'electric_goblin'],
  bossesDefeated: [...FLOOR2_BEFORE_CURRENT_GOBLIN.bossesDefeated, 'electric_goblin'],
  playAchievements: [...FLOOR2_BEFORE_CURRENT_GOBLIN.playAchievements, 'finish_with_a_blow'],
  dungeonKills: 330,
  woodenChestsOpened: { 1: 14, 2: 9 },
} as const satisfies RunProgress;

const FLOOR2_BEFORE_BIG_ROOSTER = {
  ...FLOOR2_PAST_CURRENT_GOBLIN,
  objectivesBriefed: [...FLOOR2_PAST_CURRENT_GOBLIN.objectivesBriefed, 'stealth_gate'],
  dungeonKills: 380,
  nurseriesHeld: 2,
  questGear: ['prowler_mantle'],
  woodenChestsOpened: { 1: 14, 2: 13 },
} as const satisfies RunProgress;

const FLOOR3_ARRIVAL = {
  ...FLOOR2_BEFORE_BIG_ROOSTER,
  levelId: 'level3',
  lastBeatHeard: 'floor3_caroline_arrival',
  objectivesBriefed: [...FLOOR2_BEFORE_BIG_ROOSTER.objectivesBriefed, 'big_rooster'],
  bossesDefeated: [...FLOOR2_BEFORE_BIG_ROOSTER.bossesDefeated, 'big_rooster'],
  playAchievements: [...FLOOR2_BEFORE_BIG_ROOSTER.playAchievements, 'pecking_order'],
  dungeonKills: 430,
  woodenChestsOpened: { 1: 14, 2: 16 },
} as const satisfies RunProgress;

const FLOOR3_SETTLED = {
  ...FLOOR3_ARRIVAL,
  lastBeatHeard: 'floor3_caroline_chosen_first',
} as const satisfies RunProgress;

export const RUN_PROGRESS: Readonly<Record<RunMilestone, RunProgress>> = {
  floor1_start: FLOOR1_START,
  floor1_before_trash_gremlin: FLOOR1_BEFORE_TRASH_GREMLIN,
  floor1_nursery: FLOOR1_NURSERY,
  floor1_before_kraken: FLOOR1_BEFORE_KRAKEN,
  floor1_past_kraken: FLOOR1_PAST_KRAKEN,
  floor2_start: FLOOR2_START,
  floor2_before_current_goblin: FLOOR2_BEFORE_CURRENT_GOBLIN,
  floor2_past_current_goblin: FLOOR2_PAST_CURRENT_GOBLIN,
  floor2_before_big_rooster: FLOOR2_BEFORE_BIG_ROOSTER,
  floor3_arrival: FLOOR3_ARRIVAL,
  floor3_settled: FLOOR3_SETTLED,
};

/** Every beat a party at `progress` has heard, in play order. */
export function beatsHeardBy(progress: RunProgress): StoryBeatId[] {
  const lastHeardIdx = STORY_BEAT_ORDER.indexOf(progress.lastBeatHeard);
  const throughLast = STORY_BEAT_ORDER.slice(0, lastHeardIdx + 1);
  return throughLast.filter((id) => id !== SKIPPED_TUTORIAL_BEAT);
}
