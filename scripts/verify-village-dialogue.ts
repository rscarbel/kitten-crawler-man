#!/usr/bin/env tsx
/**
 * Checks Briar Hollow's dialogue ladder: every opening rung is reachable,
 * every built-in topic can be run without error, every village bark fires
 * for real, and a one-shot line is spoken exactly once no matter how many
 * times its villager is talked to.
 *
 * Whether every line a villager's script holds is ever referenced is
 * `verify:dialog-lines`'s job, not this gate's: a script property is a
 * compile-time reference, not a runtime lookup this file could fail to
 * reach.
 *
 * Run: npx tsx scripts/verify-village-dialogue.ts
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import {
  BRAMBLEWICK,
  GARN,
  MERRIT,
  MIDGE,
  PIPKIN,
  TIKKA,
  VILLAGER_IDS,
  WICKER,
  type VillagerId,
} from '../src/dialog/scripts/briarHollow';
import type { DialogLine } from '../src/dialog/line';
import {
  KEEP_TALKING,
  type OpeningRule,
  type QuestLineProvider,
  type SoldierStance,
  type VillagerContext,
  type VillagerPartyState,
  openingLine,
  onceFlagFor,
} from '../src/systems/briarHollow/villagerCircumstances';
import { BUILT_IN_TOPICS } from '../src/systems/briarHollow/villagerTopics';
import {
  COW_PET_NOTICE_TILES,
  VillagerSystem,
  type ConversationSpeaker,
} from '../src/systems/briarHollow/VillagerSystem';
import { Conversation } from '../src/dialog/Conversation';
import { recordingHandle, testConversationFlow, type Runnable } from './dialogFlowTestHelpers';
import { createBriarHollowState, type VillageQuestState } from '../src/core/briarHollowState';
import type { VillageQuestPhase } from '../src/core/villageQuestPhase';
import { GameMap } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

const PHASES: readonly VillageQuestPhase[] = [
  'unmet',
  'offered',
  'declined',
  'need_tools',
  'gather_wood',
  'gather_stone',
  'report_tikka',
  'see_fenna',
  'processing',
  'return_tikka',
  'build_trebuchet',
  'load_trebuchet',
  'build_wall',
  'summoned_by_mayor',
  'fortifying',
  'imminent',
  'assault',
  'repelled_failed',
  'repair_bell',
  'victory',
  'complete',
];
const TALK_COUNTS: readonly number[] = [0, 1, 2, 3];
const SOLDIER_IDS: ReadonlySet<VillagerId> = new Set(['sedge', 'hobb', 'marta', 'pru']);
const SOLDIER_STANCES: readonly SoldierStance[] = ['post', 'follow', 'hold', 'patrol'];
/** A clock reading late enough that "30 s ago" is still after the start. */
const NOW_SECONDS = 1000;
const JUST_NOW_SECONDS = NOW_SECONDS - 5;
const MILESTONE_LEVELS: readonly number[] = [0, 5, 10, 15];
const PLENTY_OF_STONE = 12;
const LAST_TALK_STONE = 3;
const LOW_STOCK = 2;

function questState(phase: VillageQuestPhase): VillageQuestState {
  return { ...createBriarHollowState().quest, phase };
}

function partyState(overrides: Partial<VillagerPartyState> = {}): VillagerPartyState {
  return {
    hpFractions: { human: 1, cat: 1 },
    stone: 0,
    axeTier: null,
    pickaxeTier: null,
    constructionLevels: { human: 0, cat: 0 },
    constructionLearned: false,
    ...overrides,
  };
}

function baseContext(phase: VillageQuestPhase, talkCount: number): VillagerContext {
  return {
    nowSeconds: NOW_SECONDS,
    quest: questState(phase),
    talkCount,
    onceFlags: [],
    party: partyState(),
    events: {
      lastCowPetNearbyAt: null,
      lastDepositDepletedNearAt: null,
      firstWoodenWallBuilt: false,
      stoneAtLastTalk: null,
      lastStoneUpgradeHintAt: null,
    },
    breachExists: false,
    woodenWallStanding: false,
    lowestStock: null,
    soldierStance: null,
    unlocks: createBriarHollowState().unlocks,
  };
}

/** The situations worth trying for one villager in one phase at one talk count. */
function representativeContexts(
  villager: VillagerId,
  phase: VillageQuestPhase,
  talkCount: number,
): VillagerContext[] {
  const base = baseContext(phase, talkCount);
  const contexts: VillagerContext[] = [
    base,
    { ...base, events: { ...base.events, lastCowPetNearbyAt: JUST_NOW_SECONDS } },
    { ...base, events: { ...base.events, lastDepositDepletedNearAt: JUST_NOW_SECONDS } },
    {
      ...base,
      party: partyState({ stone: PLENTY_OF_STONE }),
      events: { ...base.events, stoneAtLastTalk: LAST_TALK_STONE },
    },
    {
      ...base,
      woodenWallStanding: true,
      party: partyState({ stone: PLENTY_OF_STONE }),
      events: { ...base.events, firstWoodenWallBuilt: true },
      onceFlags: [onceFlagFor('wicker', 'wooden_wall_built')],
    },
    { ...base, events: { ...base.events, firstWoodenWallBuilt: true } },
    { ...base, lowestStock: LOW_STOCK },
    { ...base, party: partyState({ axeTier: 0, pickaxeTier: 0 }) },
    { ...base, breachExists: true },
  ];
  const milestoneFlagSlugs: Readonly<Record<number, string>> = {
    5: 'spikes_unlocked',
    10: 'level_10_construction',
    15: 'level_15_construction',
  };
  for (const level of MILESTONE_LEVELS) {
    const spentBelow = MILESTONE_LEVELS.filter((earlier) => earlier > 0 && earlier < level);
    contexts.push({
      ...base,
      party: partyState({
        constructionLevels: { human: level, cat: 0 },
        constructionLearned: true,
      }),
      onceFlags: spentBelow.map((earlier) =>
        onceFlagFor('tikka', milestoneFlagSlugs[earlier] ?? ''),
      ),
    });
  }
  if (SOLDIER_IDS.has(villager)) {
    for (const stance of SOLDIER_STANCES) {
      contexts.push({ ...base, soldierStance: stance });
      // Orders are gated on the unlock now, not the phase, so a soldier's
      // standing-order lines need their own unlocked context to be reachable.
      contexts.push({
        ...base,
        soldierStance: stance,
        unlocks: { ...base.unlocks, soldierCommands: true },
      });
    }
  }
  return contexts;
}

/** A stand-in questline that has a line for the Mayor, so the quest rung is exercised. */
function standInQuestLines(mayorLine: DialogLine): QuestLineProvider {
  return {
    lineFor: (villager) =>
      villager === 'bramblewick' ? { pages: [mayorLine], after: KEEP_TALKING } : null,
  };
}

/** Runs every built-in topic, submenus included, to catch a topic whose `run` throws. */
function exerciseTopics(villager: VillagerId, ctx: VillagerContext): void {
  const flow = testConversationFlow();
  const pending: Runnable[] = [...BUILT_IN_TOPICS.topics(villager, ctx, flow)];
  const handle = recordingHandle(pending);
  // A submenu queues its rows behind the one being run; for-of reaches them too.
  for (const topic of pending) topic.run(handle);
}

/** A cast-free villager system on one generated map, for driving the village's own barks. */
function villageOnAMap(state = createBriarHollowState()): VillagerSystem | null {
  const map = new GameMap({
    mapSize: VILLAGE_MAP_SIZE,
    mapType: 'overworld',
    worldSeed: VILLAGE_MAP_SEED,
    tileHeight: TILE_SIZE,
  });
  const site = map.briarHollow;
  if (site === null) return null;
  return new VillagerSystem({
    gameMap: map,
    site,
    state,
    bus: null,
    audio: null,
    conversation: new Conversation(null),
    party: () => STONE_RICH_BUILDER,
    random: () => 0,
  });
}

const VILLAGE_MAP_SIZE = 280;
const VILLAGE_MAP_SEED = 1;
const STONE_RICH_BUILDER = partyState({
  stone: PLENTY_OF_STONE,
  constructionLevels: { human: 15, cat: 0 },
  constructionLearned: true,
});

/** Triggers each village bark for real and checks the line that went up is the one asked for. */
function exerciseBarks(): void {
  const state = createBriarHollowState();
  const system = villageOnAMap(state);
  check(system !== null, 'a generated map has a village to bark in');
  if (system === null) return;
  const byId = (id: string) => system.villagers.find((villager) => villager.id === id);
  const heard = (id: VillagerId, line: DialogLine, label: string): void => {
    const villager = byId(id);
    const spoke = villager !== undefined && villager.bark.current === line.paragraphs[0];
    check(spoke, `${id} barks "${label}"`);
  };
  const merrit = byId('merrit');
  if (merrit !== undefined) system.noteCowPetted(merrit.x, merrit.y);
  heard('merrit', MERRIT.cowPettedNearby, 'cow petted nearby');
  const pipkin = byId('pipkin');
  if (pipkin !== undefined) system.noteStewRefused({ x: pipkin.x, y: pipkin.y });
  heard('pipkin', PIPKIN.stewCooldownActive, 'stew cooldown active');
  const garn = byId('garn');
  if (garn !== undefined) system.noteDepositDepleted(garn.tile.x, garn.tile.y);
  heard('garn', GARN.depositDepleted, 'deposit depleted');
  const far = { x: 0, y: 0 };
  // Out of earshot: a cow petted far from Merrit never makes her bark twice.
  if (merrit !== undefined) {
    merrit.bark.clear();
    system.noteCowPetted(merrit.x + (COW_PET_NOTICE_TILES + 1) * TILE_SIZE * 2, merrit.y);
    check(merrit.bark.current === null, 'Merrit does not see a cow petted out of her sight');
  }
  const party = { human: far, cat: far, active: far };
  system.update(party);
  state.quest.phase = 'imminent';
  system.update(party);
  heard('midge', MIDGE.attackImminent, 'attack imminent');
}

function verifyResolverCoverage(): void {
  console.log('\nEvery opening rung is reachable');
  const rules = new Set<OpeningRule>();

  for (const villager of VILLAGER_IDS) {
    for (const phase of PHASES) {
      for (const talkCount of TALK_COUNTS) {
        for (const ctx of representativeContexts(villager, phase, talkCount)) {
          for (const questLines of [[], [standInQuestLines(BRAMBLEWICK.questOffer)]]) {
            const opening = openingLine(villager, ctx, questLines);
            rules.add(opening.rule);
          }
          exerciseTopics(villager, ctx);
        }
      }
    }
  }

  const everyRule: readonly OpeningRule[] = [
    'siege',
    'one_shot',
    'quest',
    'victory',
    'recent',
    'first_meeting',
    'orders_need_mayor',
    'soldier_stance',
    'quest_active',
    'fallback',
  ];
  for (const rule of everyRule) check(rules.has(rule), `the "${rule}" rung is reachable`);

  exerciseBarks();
}

/** A villager standing still at the origin, for opening conversations headlessly. */
function standInSpeaker(id: VillagerId): ConversationSpeaker {
  return {
    id,
    x: 0,
    y: 0,
    soldierStance: null,
    beginTalk: () => undefined,
    endTalk: () => undefined,
  };
}

const REPEAT_TALKS = 6;

function verifyOneShotsFireOnce(): void {
  console.log('\nOne-shot lines are spoken exactly once');
  const state = createBriarHollowState();
  state.structures.push({
    kind: 'segment',
    id: 'palisade_0',
    tier: 'wood',
    hp: 1,
    spikesHp: null,
    builtBy: 'human',
  });
  const system = villageOnAMap(state);
  if (system === null) {
    check(false, 'a generated map has a village to talk in');
    return;
  }
  const talker = { x: 0, y: 0 };
  const expectations: ReadonlyArray<{
    readonly villager: VillagerId;
    readonly flagSlugs: readonly string[];
    readonly lines: readonly DialogLine[];
  }> = [
    { villager: 'wicker', flagSlugs: ['wooden_wall_built'], lines: [WICKER.woodenWallBuilt] },
    {
      villager: 'tikka',
      flagSlugs: ['spikes_unlocked', 'level_10_construction', 'level_15_construction'],
      lines: [TIKKA.spikesUnlocked, TIKKA.level10Construction, TIKKA.level15Construction],
    },
  ];
  for (const { villager, flagSlugs, lines } of expectations) {
    const spoken = new Map<DialogLine, number>();
    for (let talk = 0; talk < REPEAT_TALKS; talk++) {
      system.openConversation(standInSpeaker(villager), talker);
      for (const page of system.lastOpening?.pages ?? [])
        spoken.set(page, (spoken.get(page) ?? 0) + 1);
      system.closeConversation();
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const flagSlug = flagSlugs[i];
      if (line === undefined || flagSlug === undefined) continue;
      const times = spoken.get(line) ?? 0;
      check(
        times === 1,
        `${villager} says its "${flagSlug}" one-shot exactly once in ${REPEAT_TALKS} talks (${times})`,
      );
      const flag = onceFlagFor(villager, flagSlug);
      const recorded = state.onceFlags.filter((entry) => entry === flag).length;
      check(recorded === 1, `and records "${flag}" exactly once (${recorded})`);
    }
  }
}

installCanvasGlobals();

verifyResolverCoverage();
verifyOneShotsFireOnce();

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll village dialogue checks passed.\n');
