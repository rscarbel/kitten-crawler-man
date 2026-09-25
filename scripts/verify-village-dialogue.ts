#!/usr/bin/env tsx
/**
 * Checks the transcribed villager dialogue table against its source.
 *
 * The table in `src/systems/briarHollow/ratkinDialogue.ts` was generated once
 * from a JSON block quoted in the appendix. While that appendix still exists,
 * this gate re-parses the JSON block and asserts the table matches it
 * character for character: every villager, every circumstance, no extras, no
 * missing entries. Once the appendix is gone, the comparison is meaningless
 * (there is nothing left to transcribe against), so the gate skips it and
 * falls back to checks that must hold regardless of any source document: ids
 * are unique, and no line is ever empty.
 *
 * Run: npx tsx scripts/verify-village-dialogue.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { installCanvasGlobals } from './nodeCanvasGlobals';
import {
  VILLAGER_IDS,
  line,
  villagerEntry,
  type Circumstance,
  type VillagerId,
} from '../src/systems/briarHollow/ratkinDialogue';
import {
  type OpeningRule,
  type QuestLineProvider,
  type SoldierStance,
  type VillagerContext,
  type VillagerPartyState,
  openingLine,
  onceFlagFor,
} from '../src/systems/briarHollow/villagerCircumstances';
import {
  BUILT_IN_TOPICS,
  type ConversationController,
  type ConversationTopic,
} from '../src/systems/briarHollow/villagerTopics';
import { PENDING_FLOW_LINES, VILLAGER_FLOW_LINES } from '../src/systems/briarHollow/villagerFlows';
import {
  COW_PET_NOTICE_TILES,
  VillagerSystem,
  type ConversationSpeaker,
} from '../src/systems/briarHollow/VillagerSystem';
import { createBriarHollowState, type VillageQuestState } from '../src/core/briarHollowState';
import type { VillageQuestPhase } from '../src/core/villageQuestPhase';
import { GameMap } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';

const APPENDIX_PATH = 'docs/briar-hollow-plan/appendix-b-source-data.md';

const NAMED_VILLAGER_COUNT = 17;

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SourceDialogueOption {
  readonly circumstance: string;
  readonly text: string;
}

interface SourceVillager {
  readonly name: string;
  readonly role: string;
  readonly backstory: string;
  readonly dialogueOptions: readonly SourceDialogueOption[];
}

function parseDialogueOption(value: unknown): SourceDialogueOption | undefined {
  if (!isRecord(value)) return undefined;
  const { circumstance, text } = value;
  if (typeof circumstance !== 'string' || typeof text !== 'string') return undefined;
  return { circumstance, text };
}

function parseVillager(value: unknown): SourceVillager | undefined {
  if (!isRecord(value)) return undefined;
  const { name, role, backstory, dialogue_options: dialogueOptionsRaw } = value;
  if (typeof name !== 'string' || typeof role !== 'string' || typeof backstory !== 'string') {
    return undefined;
  }
  if (!Array.isArray(dialogueOptionsRaw)) return undefined;
  const dialogueOptions: SourceDialogueOption[] = [];
  for (const item of dialogueOptionsRaw) {
    const option = parseDialogueOption(item);
    if (!option) return undefined;
    dialogueOptions.push(option);
  }
  return { name, role, backstory, dialogueOptions };
}

function parseVillagers(value: unknown): SourceVillager[] {
  if (!Array.isArray(value)) {
    throw new Error('the appendix villager block did not parse as a JSON array');
  }
  const villagers: SourceVillager[] = [];
  for (const item of value) {
    const villager = parseVillager(item);
    if (!villager) {
      throw new Error(
        `an appendix villager entry did not match the expected shape: ${JSON.stringify(item)}`,
      );
    }
    villagers.push(villager);
  }
  return villagers;
}

function extractVillagersJsonBlock(markdown: string): string {
  const sectionStart = markdown.indexOf('## Villagers');
  if (sectionStart === -1) {
    throw new Error('the appendix has no "## Villagers" section');
  }
  const fenceStart = markdown.indexOf('```json', sectionStart);
  if (fenceStart === -1) {
    throw new Error('the appendix "## Villagers" section has no ```json fence');
  }
  const jsonStart = markdown.indexOf('\n', fenceStart) + 1;
  const fenceEnd = markdown.indexOf('```', jsonStart);
  if (fenceEnd === -1) {
    throw new Error('the appendix villager JSON block is never closed');
  }
  return markdown.slice(jsonStart, fenceEnd);
}

const NAME_TO_ID: ReadonlyMap<string, VillagerId> = new Map([
  ['Mayor Bramblewick', 'bramblewick'],
  ['Merrit Roottail', 'merrit'],
  ['Pipkin Paws', 'pipkin'],
  ['Doctor Sella Morrowtail', 'sella'],
  ['Vetch Nibnose', 'vetch'],
  ['Oren Ironwhisker', 'oren'],
  ['Tikka Geargrinder', 'tikka'],
  ['Fenna Splintertail', 'fenna'],
  ['Garn Picknose', 'garn'],
  ['Sedge Quickclaw', 'sedge'],
  ['Hobb Greycloak', 'hobb'],
  ['Marta Redwhisker', 'marta'],
  ['Pru Bristleback', 'pru'],
  ['Nella Softstep', 'nella'],
  ['Cricket Mudwhisk', 'cricket'],
  ['Wicker Longtooth', 'wicker'],
  ['Midge Candleear', 'midge'],
]);

function verifyAgainstAppendix(): void {
  const markdown = readFileSync(APPENDIX_PATH, 'utf8');
  const jsonBlock = extractVillagersJsonBlock(markdown);
  const parsed: unknown = JSON.parse(jsonBlock);
  const sourceVillagers = parseVillagers(parsed);

  check(
    sourceVillagers.length === VILLAGER_IDS.length,
    `appendix has ${sourceVillagers.length} villagers, table has ${VILLAGER_IDS.length}`,
  );

  const seenIds = new Set<VillagerId>();
  for (const source of sourceVillagers) {
    const id = NAME_TO_ID.get(source.name);
    check(id !== undefined, `"${source.name}" maps to a known villager id`);
    if (id === undefined) continue;
    seenIds.add(id);

    const entry = villagerEntry(id);
    check(entry.name === source.name, `${id}: name matches ("${entry.name}" vs "${source.name}")`);
    check(entry.role === source.role, `${id}: role matches`);
    check(entry.backstory === source.backstory, `${id}: backstory matches character for character`);

    const tableCircumstances = new Set(entry.dialogueOptions.map((option) => option.circumstance));
    const sourceCircumstances = new Set(
      source.dialogueOptions.map((option) => option.circumstance),
    );
    check(
      tableCircumstances.size === sourceCircumstances.size,
      `${id}: has exactly the appendix's ${sourceCircumstances.size} circumstances (table has ${tableCircumstances.size})`,
    );

    for (const sourceOption of source.dialogueOptions) {
      const tableOption = entry.dialogueOptions.find(
        (option) => option.circumstance === sourceOption.circumstance,
      );
      check(tableOption !== undefined, `${id}: has a line for "${sourceOption.circumstance}"`);
      if (tableOption === undefined) continue;
      check(
        tableOption.text === sourceOption.text,
        `${id}: "${sourceOption.circumstance}" matches character for character`,
      );
    }

    for (const tableOption of entry.dialogueOptions) {
      const inSource = sourceCircumstances.has(tableOption.circumstance);
      check(
        inSource,
        `${id}: table has no extra circumstance "${tableOption.circumstance}" beyond the appendix`,
      );
    }
  }

  for (const id of VILLAGER_IDS) {
    check(seenIds.has(id), `table's "${id}" exists in the appendix`);
  }
}

function verifyStructuralInvariants(): void {
  check(
    VILLAGER_IDS.length === NAMED_VILLAGER_COUNT,
    `there are ${NAMED_VILLAGER_COUNT} villager ids (found ${VILLAGER_IDS.length})`,
  );
  check(new Set(VILLAGER_IDS).size === VILLAGER_IDS.length, 'villager ids are unique');

  for (const id of VILLAGER_IDS) {
    const entry = villagerEntry(id);
    check(entry.dialogueOptions.length > 0, `${id}: has at least one line`);
    for (const option of entry.dialogueOptions) {
      check(option.text.length > 0, `${id}: "${option.circumstance}" is a non-empty string`);
      check(option.circumstance.length > 0, `${id}: has no empty circumstance name`);
    }
  }
}

// ── Who can say what ─────────────────────────────────────────────────────────
//
// Every line in the table must be sayable: by the opening resolver, by a
// built-in topic, by one of the village's own barks, or by a flow registered
// in `VILLAGER_FLOW_LINES`. A line none of them produces is one the player
// can never hear.

const PHASES: readonly VillageQuestPhase[] = [
  'unmet',
  'offered',
  'declined',
  'need_tools',
  'gathering',
  'fortifying',
  'imminent',
  'assault',
  'repelled_failed',
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
  for (const level of MILESTONE_LEVELS) {
    const spentBelow = MILESTONE_LEVELS.filter((earlier) => earlier > 0 && earlier < level);
    const milestoneFlag: Record<number, Circumstance> = {
      5: 'spikes_unlocked',
      10: 'level_10_construction',
      15: 'level_15_construction',
    };
    contexts.push({
      ...base,
      party: partyState({
        constructionLevels: { human: level, cat: 0 },
        constructionLearned: true,
      }),
      onceFlags: spentBelow.map((earlier) => onceFlagFor('tikka', milestoneFlag[earlier])),
    });
  }
  if (SOLDIER_IDS.has(villager)) {
    for (const stance of SOLDIER_STANCES) contexts.push({ ...base, soldierStance: stance });
  }
  return contexts;
}

/** A stand-in questline that has a line for the Mayor, so the quest rung is exercised. */
const STAND_IN_QUEST_LINES: QuestLineProvider = {
  lineFor: (villager) => (villager === 'bramblewick' ? { pages: ['quest_offer'] } : null),
};

function keyOf(villager: VillagerId, circumstance: Circumstance): string {
  return `${villager}:${circumstance}`;
}

/** Runs every built-in topic, submenus included, recording what each says. */
function exerciseTopics(
  villager: VillagerId,
  ctx: VillagerContext,
  said: Set<string>,
  refusals: string[],
): void {
  const pending: ConversationTopic[] = [...BUILT_IN_TOPICS.topics(villager, ctx)];
  const controller: ConversationController = {
    villager,
    say: (...circumstances) => {
      for (const circumstance of circumstances) {
        if (line(villager, circumstance) === undefined) {
          refusals.push(keyOf(villager, circumstance));
          return false;
        }
      }
      for (const circumstance of circumstances) said.add(keyOf(villager, circumstance));
      return true;
    },
    showTopics: (topics) => pending.push(...topics),
    showRootTopics: () => undefined,
    close: () => undefined,
    afterClose: () => undefined,
  };
  // A submenu pushes its rows behind the one being run; for-of reaches them too.
  for (const topic of pending) topic.run(controller);
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

/** Triggers each village bark for real and records the line that went up. */
function exerciseBarks(said: Set<string>): void {
  const state = createBriarHollowState();
  const system = villageOnAMap(state);
  check(system !== null, 'a generated map has a village to bark in');
  if (system === null) return;
  const byId = (id: string) => system.villagers.find((villager) => villager.id === id);
  const heard = (id: VillagerId, circumstance: Circumstance): void => {
    const villager = byId(id);
    const text = line(id, circumstance);
    const spoke = villager !== undefined && text !== undefined && villager.bark.current === text;
    check(spoke, `${id} barks "${circumstance}"`);
    if (spoke) said.add(keyOf(id, circumstance));
  };
  const merrit = byId('merrit');
  if (merrit !== undefined) system.noteCowPetted(merrit.x, merrit.y);
  heard('merrit', 'cow_petted_nearby');
  const pipkin = byId('pipkin');
  if (pipkin !== undefined) system.noteStewRefused({ x: pipkin.x, y: pipkin.y });
  heard('pipkin', 'stew_cooldown_active');
  const garn = byId('garn');
  if (garn !== undefined) system.noteDepositDepleted(garn.tile.x, garn.tile.y);
  heard('garn', 'deposit_depleted');
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
  heard('midge', 'attack_imminent');
}

function verifyResolverCoverage(): void {
  console.log('\nEvery line can be heard');
  const said = new Set<string>();
  const rules = new Set<OpeningRule>();
  const refusals: string[] = [];
  let undefinedOpenings = 0;
  let textMismatches = 0;

  for (const villager of VILLAGER_IDS) {
    for (const phase of PHASES) {
      for (const talkCount of TALK_COUNTS) {
        for (const ctx of representativeContexts(villager, phase, talkCount)) {
          for (const questLines of [null, STAND_IN_QUEST_LINES]) {
            const opening = openingLine(villager, ctx, questLines);
            rules.add(opening.rule);
            for (const circumstance of opening.pages) {
              const text = line(villager, circumstance);
              if (text === undefined) {
                undefinedOpenings++;
                continue;
              }
              const verbatim = villagerEntry(villager).dialogueOptions.find(
                (option) => option.circumstance === circumstance,
              )?.text;
              if (verbatim !== text) textMismatches++;
              // The stand-in questline only proves the rung is reachable; the
              // lines it says belong to the real questline, still pending.
              if (questLines === null) said.add(keyOf(villager, circumstance));
            }
          }
          exerciseTopics(villager, ctx, said, refusals);
        }
      }
    }
  }

  check(
    undefinedOpenings === 0,
    `no opening resolves to a line the villager lacks (${undefinedOpenings})`,
  );
  check(
    textMismatches === 0,
    `every opening's text is the verbatim table's (${textMismatches} differ)`,
  );
  check(
    refusals.length === 0,
    `every built-in topic has its lines (${refusals.join(', ') || 'none missing'})`,
  );
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

  exerciseBarks(said);

  const flows = new Set<string>();
  const pending = new Set<string>();
  const register = (
    lists: Readonly<
      Record<string, readonly { villager: VillagerId; circumstance: Circumstance }[]>
    >,
    into: Set<string>,
  ): void => {
    for (const [owner, lines] of Object.entries(lists)) {
      for (const flow of lines) {
        const exists = line(flow.villager, flow.circumstance) !== undefined;
        check(exists, `${owner} flow "${keyOf(flow.villager, flow.circumstance)}" is a real line`);
        into.add(keyOf(flow.villager, flow.circumstance));
      }
    }
  };
  register(VILLAGER_FLOW_LINES, flows);
  register(PENDING_FLOW_LINES, pending);
  const both = [...pending].filter((key) => flows.has(key));
  check(both.length === 0, `no flow line is both wired and pending (${both.join(', ') || 'none'})`);

  const unheard: string[] = [];
  const stillPending: string[] = [];
  // Pending lines are checked before anything that produces them: a soldier
  // opens with a command line when he has no line for his orders, but the
  // command itself is still the militia's to wire, and must stay listed.
  const openingButPending: string[] = [];
  for (const villager of VILLAGER_IDS) {
    for (const option of villagerEntry(villager).dialogueOptions) {
      const key = keyOf(villager, option.circumstance);
      if (pending.has(key)) {
        if (said.has(key)) openingButPending.push(key);
        else stillPending.push(key);
        continue;
      }
      if (!said.has(key) && !flows.has(key)) unheard.push(key);
    }
  }
  check(
    unheard.length === 0,
    `every line is produced, wired or pending (unclaimed: ${unheard.join(', ') || 'none'})`,
  );
  // Reported, not failed: these belong to systems that do not speak them yet.
  console.log(
    `  ..   ${stillPending.length} flow line(s) still pending: ${stillPending.join(', ') || 'none'}`,
  );
  console.log(
    `  ..   ${openingButPending.length} pending flow line(s) also heard as an opening: ${openingButPending.join(', ') || 'none'}`,
  );
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
    villager: VillagerId;
    circumstances: readonly Circumstance[];
  }> = [
    { villager: 'wicker', circumstances: ['wooden_wall_built'] },
    {
      villager: 'tikka',
      circumstances: ['spikes_unlocked', 'level_10_construction', 'level_15_construction'],
    },
  ];
  for (const { villager, circumstances } of expectations) {
    const spoken = new Map<Circumstance, number>();
    for (let talk = 0; talk < REPEAT_TALKS; talk++) {
      system.openConversation(standInSpeaker(villager), talker);
      for (const page of system.lastOpening?.pages ?? [])
        spoken.set(page, (spoken.get(page) ?? 0) + 1);
      system.closeConversation();
    }
    for (const circumstance of circumstances) {
      const times = spoken.get(circumstance) ?? 0;
      check(
        times === 1,
        `${villager} says "${circumstance}" exactly once in ${REPEAT_TALKS} talks (${times})`,
      );
      const flag = onceFlagFor(villager, circumstance);
      const recorded = state.onceFlags.filter((entry) => entry === flag).length;
      check(recorded === 1, `and records "${flag}" exactly once (${recorded})`);
    }
  }
}

installCanvasGlobals();

verifyStructuralInvariants();
verifyResolverCoverage();
verifyOneShotsFireOnce();

if (existsSync(APPENDIX_PATH)) {
  verifyAgainstAppendix();
} else {
  console.log('appendix-b-source-data.md is gone; skipping the transcription comparison.');
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll village dialogue checks passed.\n');
