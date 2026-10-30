import { MAGIC_MISSILE_SPARK_LEVEL } from '../abilities/magicMissile';
import { ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import {
  ACHIEVEMENT_DEFS,
  AchievementManager,
  DUNGEON_KILLS_A_THOUSAND_CUTS,
  DUNGEON_KILLS_BODY_COUNT,
  DUNGEON_KILLS_SOMETHING_HATCHED,
  DUNGEON_KILLS_WARMING_UP,
  crawlerCanEarn,
  type FixedReward,
} from '../core/progression/AchievementManager';
import { emptyAchievementCounters, type AchievementId } from '../core/progression/achievementSave';
import { rarityRank, type Rarity } from '../core/items/defs/rarity';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { DebriefBossType } from '../core/mobs/debriefBossTypes';
import {
  isGearId,
  partyOwnsGear,
  rollBossGear,
  rollChestGear,
  type GearId,
} from '../loot/gearPools';
import { gearRecipient } from '../loot/questGear';
import { rollRewardChest } from '../loot/rewardChest';
import { StoryDirector } from '../story/StoryDirector';
import { unwornGear, type DaveDebriefCheckpoint } from '../systems/daveDebrief';
import type { Player } from '../Player';
import { BOSS_FLOOR, beatsHeardBy, type DungeonFloor, type RunProgress } from './playtestProgress';
import type { PlaytestPreset } from './playtestPresets';

/**
 * Turns a preset's {@link RunProgress} into the run state a player who walked
 * there would carry: both achievement managers, the story heard, Dave's
 * debriefs, and the gear the run paid out along the way.
 *
 * The gear is rolled fresh on every boot through the game's own rolls — each
 * boss's drop, each achievement's chest and fixed pieces, repeat-boss and
 * quest chests, every wooden chest opened — so a preset's kit is a plausible
 * run's rather than a hand-picked one, and a different one each time.
 */

/** Both crawlers mid-build, before their stats and health are settled. */
export interface PlaytestParty {
  readonly human: Player;
  readonly cat: Player;
}

const CRAWLER_KINDS: ReadonlyArray<CrawlerKind> = ['human', 'cat'];

/** The kill-ladder rungs, each unlocked once the party's tally reaches it. */
const KILL_LADDER: ReadonlyArray<readonly [number, AchievementId]> = [
  [DUNGEON_KILLS_WARMING_UP, 'dungeon_kills_50'],
  [DUNGEON_KILLS_SOMETHING_HATCHED, 'dungeon_kills_200'],
  [DUNGEON_KILLS_BODY_COUNT, 'dungeon_kills_500'],
  [DUNGEON_KILLS_A_THOUSAND_CUTS, 'dungeon_kills_1000'],
];

/** The chest each crawler earns for every boss after Boss Slayer, as the scene pays it. */
const BOSS_REPEAT_CHEST_RARITY = ACHIEVEMENT_DEFS.boss_slayer.reward.rarity;
/** The chest each crawler earns for every nursery held after Guardian Angel, as the scene pays it. */
const NURSERY_REPEAT_CHEST_RARITY = ACHIEVEMENT_DEFS.quest_defend_npc.reward.rarity;

const DUNGEON_FLOORS: ReadonlyArray<DungeonFloor> = [1, 2];

/** Below every rung of the rarity ladder. */
const UNRANKED = -1;

/** Every achievement the party's run has earned, before each crawler's own `playerType` filter. */
function runAchievements(preset: PlaytestPreset, progress: RunProgress): AchievementId[] {
  const earned = new Set<AchievementId>(progress.playAchievements);
  if (progress.bossesDefeated.length > 0) earned.add('boss_slayer');
  if (progress.nurseriesHeld > 0) earned.add('quest_defend_npc');
  for (const [kills, id] of KILL_LADDER) {
    if (progress.dungeonKills >= kills) earned.add(id);
  }
  if ((preset.abilityLevels.magic_missile ?? 0) >= MAGIC_MISSILE_SPARK_LEVEL) {
    earned.add('spark_to_flame');
  }
  if (preset.hire !== undefined) earned.add('on_retainer');
  return [...earned];
}

/** `kind`'s achievements, already opened: nothing waits behind the reward chip. */
function achievementManagerFor(
  kind: CrawlerKind,
  earned: readonly AchievementId[],
  progress: RunProgress,
): AchievementManager {
  // The kill tally is a party counter, which only the human's manager keeps.
  const dungeonKills = kind === 'human' ? progress.dungeonKills : 0;
  return AchievementManager.fromSerialized({
    unlocked: earned.filter((id) => crawlerCanEarn(ACHIEVEMENT_DEFS[id], kind)),
    presentations: [],
    recentEvents: [],
    menuUnseen: 0,
    counters: { ...emptyAchievementCounters(), dungeonKills },
    aiAchievements: [],
  });
}

function randomCrawler(): CrawlerKind {
  return Math.random() < 1 / CRAWLER_KINDS.length ? 'human' : 'cat';
}

/**
 * Hands `id` to the crawler it belongs to. A piece the party already owns is
 * skipped, as the game pays a duplicate in coins the presets' purses already
 * account for.
 */
function grantGear(party: PlaytestParty, id: GearId, earner: CrawlerKind): void {
  if (partyOwnsGear([party.human, party.cat], id)) return;
  party[gearRecipient(id, earner)].inventory.addItem(id, 1);
}

/** Where `id` sits on the rarity ladder; every piece of gear carries a rarity, so the fallback never ranks one. */
function rarityRankOf(id: GearId): number {
  const rarity = ITEM_DEF[id].rarity;
  return rarity === undefined ? UNRANKED : rarityRank(rarity);
}

/**
 * Puts on each crawler's paid-out gear, rarest first, wherever a sub-slot is
 * still empty, so the preset's own worn pieces stay and every other slot gets
 * the best the run turned up. The human's weapons stay in the bag: the
 * presets' own loadouts decide what he fights with. The cat's claws are worn.
 */
function wearBestOf(owner: Player, kind: CrawlerKind, paid: readonly GearId[]): void {
  const rarestFirst = [...paid].sort((a, b) => rarityRankOf(b) - rarityRankOf(a));
  const { equipment } = owner.inventory;
  for (const id of rarestFirst) {
    const item = { ...ITEM_DEF[id], quantity: 1 };
    if (!equipment.canEquip(item)) continue;
    if (kind === 'human' && item.equipSlot === 'Weapon') continue;
    if (equipment.getEquippedItem(equipment.keyFor(item)) !== null) continue;
    equipment.equip(item);
  }
}

/** The gear `owner` holds that the preset's own loadout did not hand over. */
function gearBeyond(owner: Player, loadoutIds: ReadonlySet<ItemId>): GearId[] {
  const held = [...owner.inventory.actionBar.slots, ...owner.inventory.bag.slots];
  const paid: GearId[] = [];
  for (const stack of held) {
    if (stack === null || !isGearId(stack.id) || loadoutIds.has(stack.id)) continue;
    paid.push(stack.id);
  }
  return paid;
}

function owns(party: PlaytestParty): (id: GearId) => boolean {
  return (id) => partyOwnsGear([party.human, party.cat], id);
}

/** The gear in a reward chest's fixed rewards; its potions and tomes are the preset's own kit. */
function fixedGear(fixed: ReadonlyArray<FixedReward>): Array<{ id: GearId; to?: CrawlerKind }> {
  const gear: Array<{ id: GearId; to?: CrawlerKind }> = [];
  for (const reward of fixed) {
    if (reward.kind !== 'item' || !isGearId(reward.id)) continue;
    const to = reward.to === 'active' ? undefined : reward.to;
    gear.push({ id: reward.id, to });
  }
  return gear;
}

/** The gear lines of one reward chest of `rarity` rolled for `kind`, paid into the party. */
function openRewardChest(
  party: PlaytestParty,
  kind: CrawlerKind,
  rarity: Rarity,
  reserved: readonly ItemId[] = [],
): void {
  const lines = rollRewardChest(rarity, kind, Math.random, {
    owns: owns(party),
    coinMultiplier: 1,
    reserved,
  });
  for (const line of lines) {
    if (line.kind === 'item' && isGearId(line.id)) grantGear(party, line.id, kind);
  }
}

/**
 * Pays each crawler's achievements: the tutorial's First Kill hands over only
 * its tutorial kit, and every other achievement its fixed pieces and a chest
 * of its rarity.
 */
function payAchievements(party: PlaytestParty, earned: readonly AchievementId[]): void {
  for (const kind of CRAWLER_KINDS) {
    for (const id of earned) {
      const def = ACHIEVEMENT_DEFS[id];
      if (!crawlerCanEarn(def, kind)) continue;
      const fixed = fixedGear(def.tutorialReward ?? def.reward.fixed ?? []);
      for (const piece of fixed) grantGear(party, piece.id, piece.to ?? kind);
      if (def.tutorialReward !== undefined) continue;
      openRewardChest(
        party,
        kind,
        def.reward.rarity,
        fixed.map((piece) => piece.id),
      );
    }
  }
}

function payBosses(party: PlaytestParty, bosses: readonly DebriefBossType[]): void {
  for (const boss of bosses) {
    const loot = rollBossGear(boss, BOSS_FLOOR[boss], Math.random, owns(party));
    for (const id of loot.items) grantGear(party, id, randomCrawler());
  }
  const repeatKills = Math.max(0, bosses.length - 1);
  for (let kill = 0; kill < repeatKills; kill++) {
    for (const kind of CRAWLER_KINDS) openRewardChest(party, kind, BOSS_REPEAT_CHEST_RARITY);
  }
}

function payNurseryRepeats(party: PlaytestParty, nurseriesHeld: number): void {
  for (let held = 1; held < nurseriesHeld; held++) {
    for (const kind of CRAWLER_KINDS) openRewardChest(party, kind, NURSERY_REPEAT_CHEST_RARITY);
  }
}

function payWoodenChests(
  party: PlaytestParty,
  opened: Readonly<Record<DungeonFloor, number>>,
): void {
  for (const floor of DUNGEON_FLOORS) {
    for (let chest = 0; chest < opened[floor]; chest++) {
      const loot = rollChestGear('wooden', floor, Math.random, owns(party));
      for (const id of loot.items) grantGear(party, id, randomCrawler());
    }
  }
}

/** The run's state behind a preset, with its gear already in the party's inventories. */
export interface PlaytestRunHistory {
  readonly humanAchievements: AchievementManager;
  readonly catAchievements: AchievementManager;
  readonly storyDirector: StoryDirector;
  /** Deinonychus comes in the Something Hatched chest. */
  readonly deinonychusEarned: boolean;
}

/**
 * Pays the run's gear into `party` and returns the rest of its state. Call
 * after the preset's own loadouts are in place, so a piece a preset hands over
 * by name is never paid a second time, and before stats are settled, so worn
 * pieces count toward max HP.
 */
export function playRunHistory(
  preset: PlaytestPreset,
  progress: RunProgress,
  party: PlaytestParty,
): PlaytestRunHistory {
  const earned = runAchievements(preset, progress);
  const loadoutIds = new Set<ItemId>(
    [preset.human, preset.cat].flatMap((loadout) => [
      ...loadout.hotbar.map((stack) => stack.id),
      ...loadout.bag.map((stack) => stack.id),
    ]),
  );
  payAchievements(party, earned);
  payBosses(party, progress.bossesDefeated);
  payNurseryRepeats(party, progress.nurseriesHeld);
  for (const id of progress.questGear) grantGear(party, id, 'human');
  payWoodenChests(party, progress.woodenChestsOpened);
  for (const kind of CRAWLER_KINDS) {
    wearBestOf(party[kind], kind, gearBeyond(party[kind], loadoutIds));
  }
  return {
    humanAchievements: achievementManagerFor('human', earned, progress),
    catAchievements: achievementManagerFor('cat', earned, progress),
    storyDirector: new StoryDirector(beatsHeardBy(progress), progress.objectivesBriefed),
    deinonychusEarned: earned.includes('dungeon_kills_200'),
  };
}

/**
 * Dave's debriefs for `bosses`, already given: congratulated, and every piece
 * the party is not wearing already named, as he would have in each exit room
 * the party walked through.
 */
export function debriefsHeard(
  bosses: readonly DebriefBossType[],
  party: PlaytestParty,
): DaveDebriefCheckpoint {
  const namedItemIds = [
    ...unwornGear('human', party.human.inventory),
    ...unwornGear('cat', party.cat.inventory),
  ].map((item) => item.id);
  const checkpoint: DaveDebriefCheckpoint = {};
  for (const boss of bosses) checkpoint[boss] = { congratulated: true, namedItemIds };
  return checkpoint;
}
