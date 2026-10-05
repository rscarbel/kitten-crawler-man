#!/usr/bin/env tsx
/**
 * Headless gate for the shared quest-complete screen.
 *
 * Every quest that pays a reward completes once here, on its own scene-shaped
 * rig (a bus, a `MenusKit` holding the scene's one `QuestRewardScreen`, and
 * the two crawlers), and must ask for exactly one screen. A quest that pays XP
 * pays each crawler the full award exactly once, and its screen shows one line
 * per crawler quoting what `awardXp` landed on that crawler's bar. The screen itself must hold the world and swallow
 * keys, finish its reveal on the first press and close on the second, wait
 * out an open conversation, and queue two completions from one frame.
 *
 * The crawlers earn XP at reduced rates here, Carl at half and Donut at a
 * quarter, so a screen quoting the flat award, or one crawler's figure on the
 * other's line, instead of what landed on each bar is caught.
 *
 * Run: npm run verify:quest-reward
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { allocCanvas, surfaceContext } from '../src/core/canvasSurface';
import { ANCHOR_QUEST_NAME, createAnchorQuestProgress } from '../src/core/AnchorQuestProgress';
import { createBriarHollowState } from '../src/core/briarHollowState';
import { createCircusQuestProgress } from '../src/core/CircusQuestProgress';
import { ANCHOR_SHARD_IDS } from '../src/core/ItemDefs';
import { createMurderQuestProgress } from '../src/core/MurderQuestProgress';
import { transientSpeaker } from '../src/dialog/line';
import { Conversation } from '../src/dialog/Conversation';
import { CRAWLER_NAMES } from '../src/core/SkillManager';
import { AnchorQuestSystem } from '../src/systems/AnchorQuestSystem';
import { CircusQuestSystem } from '../src/systems/CircusQuestSystem';
import { DefendQuestSystem } from '../src/systems/DefendQuestSystem';
import { MurderMysteryQuestSystem } from '../src/systems/MurderMysteryQuestSystem';
import { SpiderQuestSystem } from '../src/systems/SpiderQuestSystem';
import type { QuestRewardScreen } from '../src/ui/questReward/QuestRewardScreen';
import type { QuestRewardSpec, RewardUnlockCard } from '../src/ui/questReward/types';
import type { QuestStatus } from '../src/core/QuestManager';
import {
  buildSiegeRig,
  questRewardSurface,
  questRewardUi,
  type QuestRewardUi,
  type SiegeRig,
} from './villageSiegeHarness';

installCanvasGlobals();

const RIG_SEED = 7919;
const RIG_ASSAULT_LEVEL = 6;
/** Two different reduced rates, so neither the flat award nor the other crawler's figure matches what landed. */
const REDUCED_XP_CURVES = {
  human: [{ minPlayerLevel: 1, multiplier: 0.5 }],
  cat: [{ minPlayerLevel: 1, multiplier: 0.25 }],
} as const;
/** Frames a screen is given to go up once it is clear to. */
const OPEN_WITHIN_FRAMES = 3;
/** Long enough for the spider's death to play out and her screen to be asked for. */
const SPIDER_WAIT_FRAMES = 600;
/** Long enough for the last station upgrade's callout to play out. */
const CELEBRATION_WAIT_FRAMES = 600;
/** Comfortably more than the Wayfinder's assembly fee. */
const ANCHOR_PURSE = 500;
const SCREEN_W = 1280;
const SCREEN_H = 720;
const TRAVEL_CARD_PREFIX = 'Anchor travel: ';
const ANCHOR_CONDITION = `(after completing "${ANCHOR_QUEST_NAME}")`;

let failures = 0;
let passes = 0;
function check(condition: boolean, label: string): void {
  if (condition) {
    passes++;
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
  }
}

/** Calls a quest's own completion step, which the game reaches through play, not through its API. */
function callCompletion(target: object, name: string, args: readonly unknown[]): void {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== 'function') throw new Error(`no method "${name}"`);
  Reflect.apply(method, target, args);
}

interface RewardRig {
  readonly rig: SiegeRig;
  readonly screen: QuestRewardScreen;
  /** The screen's surface on a `UiRoot`, as the scene draws it and routes keys to it. */
  readonly ui: QuestRewardUi;
  readonly conversation: Conversation;
  /** Every spec asked for on this rig's bus. */
  readonly requested: QuestRewardSpec[];
  /** Times the screen actually went up. */
  readonly opens: { count: number };
  /** What each `gainXp` (and so `awardXp`) call returned, per crawler, in order. */
  readonly xpLanded: Record<keyof typeof CRAWLER_NAMES, number[]>;
  /** Every coin grant either crawler earned, in order. */
  readonly coinGrants: number[];
}

function rewardRig(): RewardRig {
  const state = createBriarHollowState();
  const rig = buildSiegeRig({ seed: RIG_SEED, state, assaultLevel: RIG_ASSAULT_LEVEL });
  const conversation = new Conversation(null);
  const screen = rig.menus.questReward;
  screen.setOpenConditions({
    conversationOpen: () => conversation.isOpen,
    worldHeld: () => false,
  });
  const requested: QuestRewardSpec[] = [];
  rig.bus.on('questRewardShown', (spec) => requested.push(spec));
  const opens = { count: 0 };
  const open = screen.open.bind(screen);
  screen.open = (spec) => {
    opens.count++;
    open(spec);
  };
  const xpLanded: RewardRig['xpLanded'] = { human: [], cat: [] };
  const coinGrants: number[] = [];
  for (const [role, crawler] of [
    ['human', rig.human],
    ['cat', rig.cat],
  ] as const) {
    const earnCoins = crawler.earnCoins.bind(crawler);
    crawler.earnCoins = (amount) => {
      if (amount > 0) coinGrants.push(amount);
      earnCoins(amount);
    };
    crawler.xpCurve = REDUCED_XP_CURVES[role];
    const gainXp = crawler.gainXp.bind(crawler);
    crawler.gainXp = (amount) => {
      const result = gainXp(amount);
      xpLanded[role].push(result.xpApplied);
      return result;
    };
  }
  return {
    rig,
    screen,
    ui: questRewardUi(rig),
    conversation,
    requested,
    opens,
    xpLanded,
    coinGrants,
  };
}

function stepScreen(setup: RewardRig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) setup.screen.update();
}

function renderScreen(setup: RewardRig): void {
  setup.ui.frame(surfaceContext(allocCanvas(SCREEN_W, SCREEN_H)));
}

/** Every XP line on a screen, as `recipient=amount`, in the order listed. */
function xpLinesShown(spec: QuestRewardSpec | undefined): string[] {
  if (spec === undefined) return [];
  return spec.sections.flatMap((section) =>
    section.kind === 'xp' ? [`${section.recipient ?? '?'}=${section.amount}`] : [],
  );
}

function coinsShown(spec: QuestRewardSpec | undefined): number[] {
  if (spec === undefined) return [];
  return spec.sections.flatMap((section) => (section.kind === 'coins' ? [section.amount] : []));
}

/** One quest's completion, driven on a fresh rig. */
interface QuestCase {
  readonly questId: string;
  /** Whether finishing it pays XP, which then goes to both crawlers in full. */
  readonly paysXp: boolean;
  readonly complete: (setup: RewardRig) => void;
}

const QUEST_CASES: readonly QuestCase[] = [
  {
    questId: 'defend_goblin_mother',
    paysXp: true,
    complete: ({ rig, conversation }) => {
      const quest = new DefendQuestSystem(
        rig.map,
        rig.bus,
        () => undefined,
        conversation,
        () => 1,
        undefined,
      );
      callCompletion(quest, 'triggerQuestComplete', [rig.human, rig]);
    },
  },
  {
    questId: 'the_show_must_go_on',
    paysXp: true,
    complete: ({ rig, conversation }) => {
      const quest = new CircusQuestSystem(
        rig.map,
        rig.bus,
        () => undefined,
        null,
        createCircusQuestProgress(),
        null,
        null,
        rig.human,
        conversation,
        { anchor: createAnchorQuestProgress() },
      );
      callCompletion(quest, 'finishQuest', [rig.human, rig]);
    },
  },
  {
    questId: 'krasue_murders',
    paysXp: true,
    complete: ({ rig, conversation }) => {
      const quest = new MurderMysteryQuestSystem(
        rig.map,
        rig.bus,
        () => undefined,
        createMurderQuestProgress(),
        null,
        null,
        conversation,
      );
      callCompletion(quest, 'finishQuest', [{ human: rig.human, cat: rig.cat, active: rig.human }]);
    },
  },
  {
    questId: 'anchor_shards',
    paysXp: true,
    complete: ({ rig, conversation }) => {
      const progress = createAnchorQuestProgress();
      progress.status = 'active';
      for (const shard of ANCHOR_SHARD_IDS) rig.human.inventory.addItem(shard, 1);
      rig.human.coins = ANCHOR_PURSE;
      const quest = new AnchorQuestSystem(
        rig.bus,
        progress,
        () => ({ human: rig.human, cat: rig.cat }),
        () => null,
        () => null,
        () => null,
        () => undefined,
        conversation,
        { circus: createCircusQuestProgress(), briarHollow: rig.state, anchor: progress },
      );
      callCompletion(quest, 'assemble', [rig.human]);
    },
  },
  {
    questId: 'grotesque_spider',
    paysXp: true,
    complete: (setup) => {
      const { rig, conversation } = setup;
      const quest = new SpiderQuestSystem(rig.map, rig.bus, () => undefined, conversation);
      quest.onBossKilled(rig.human, rig.cat);
      // Her screen is held until her death has played; the scene ticks it.
      for (let frame = 0; frame < SPIDER_WAIT_FRAMES && setup.requested.length === 0; frame++) {
        quest.update(rig.context());
      }
    },
  },
  {
    questId: 'briar_hollow_plea',
    paysXp: true,
    complete: ({ rig }) => {
      rig.kit.quest?.grantRewards();
    },
  },
  {
    questId: 'borrowed_blueprints',
    paysXp: false,
    complete: (setup) => {
      const { rig } = setup;
      rig.state.blueprints.phase = 'build_stations';
      rig.state.blueprints.stationsUpgraded.saw = true;
      rig.state.blueprints.stationsUpgraded.ropeWalk = true;
      // Asked for once the last upgrade's callout has played out.
      for (
        let frame = 0;
        frame < CELEBRATION_WAIT_FRAMES && setup.requested.length === 0;
        frame++
      ) {
        rig.step();
      }
    },
  },
];

function completeQuest(questId: string, setup: RewardRig): void {
  const questCase = QUEST_CASES.find((c) => c.questId === questId);
  if (questCase === undefined) throw new Error(`no quest case for ${questId}`);
  questCase.complete(setup);
}

function verifyEachQuestOpensOneScreen(): void {
  console.log('\nEvery quest opens exactly one reward screen');
  for (const questCase of QUEST_CASES) {
    const setup = rewardRig();
    const completions: string[] = [];
    setup.rig.bus.on('questCompleted', (event) => completions.push(event.questId));
    questCase.complete(setup);
    stepScreen(setup, OPEN_WITHIN_FRAMES);
    const name = questCase.questId;
    check(completions.filter((id) => id === name).length === 1, `${name}: completes once`);
    check(setup.requested.length === 1, `${name}: asks for exactly one reward screen`);
    check(setup.opens.count === 1 && setup.screen.isOpen, `${name}: the screen goes up once`);
    const spec = setup.requested[0];
    const { human, cat } = setup.xpLanded;
    if (questCase.paysXp) {
      check(
        human.length === 1 && cat.length === 1 && (human[0] ?? 0) > 0 && (cat[0] ?? 0) > 0,
        `${name}: pays XP to both crawlers exactly once (${CRAWLER_NAMES.human} ${human.join() || 'none'}, ${CRAWLER_NAMES.cat} ${cat.join() || 'none'})`,
      );
      const expected = [
        `${CRAWLER_NAMES.human}=${human.join('+')}`,
        `${CRAWLER_NAMES.cat}=${cat.join('+')}`,
      ];
      const shown = xpLinesShown(spec);
      check(
        shown.join() === expected.join(),
        `${name}: shows each crawler the XP awardXp returned (${shown.join() || 'none'} shown, ${expected.join()} landed)`,
      );
    } else {
      check(
        human.length === 0 && cat.length === 0 && xpLinesShown(spec).length === 0,
        `${name}: pays and shows no XP`,
      );
    }
    const shownCoins = coinsShown(spec);
    check(
      shownCoins.join() === setup.coinGrants.join(),
      `${name}: pays its coins exactly once, as shown (${shownCoins.join() || 'none'} shown, ${setup.coinGrants.join() || 'none'} paid)`,
    );
    setup.rig.dispose();
  }
}

function verifyScreenBehaviour(): void {
  console.log('\nThe screen holds the world and takes two presses');
  const setup = rewardRig();
  completeQuest('the_show_must_go_on', setup);
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  const { screen } = setup;
  const surface = questRewardSurface(setup.rig);
  check(surface.isOpen() && surface.haltsWorld, 'the open screen halts the world');
  check(surface.locksKeyboard === true, 'and takes the keyboard');
  check(screen.handleKeyDown('h', false) && screen.isOpen, 'an ordinary key is swallowed');
  renderScreen(setup);
  check(!screen.isSettled, 'the reveal is still playing after one frame');
  check(setup.ui.root.key(' ', {}) === 'consumed', 'Space is taken by the screen');
  check(screen.isOpen && screen.isSettled, 'the first press finishes the reveal');
  const closedWith: QuestRewardSpec[] = [];
  screen.onClosed = (spec) => {
    closedWith.push(spec);
  };
  renderScreen(setup);
  setup.ui.root.key('Enter', {});
  check(!screen.isOpen, 'the second press closes it');
  check(closedWith.length === 1, 'and tells the scene, for the fly-ins');
  check(!surface.isOpen(), 'its surface closes with it');
  setup.rig.dispose();
}

function verifyEscape(): void {
  console.log('\nEscape finishes the reveal, then dismisses');
  const setup = rewardRig();
  completeQuest('krasue_murders', setup);
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  const { screen } = setup;
  renderScreen(setup);
  screen.handleKeyDown('Escape', false);
  check(screen.isOpen && screen.isSettled, 'the first Escape finishes the reveal');
  check(
    screen.handleKeyDown('Escape', true) && screen.isOpen,
    'a held, repeating Escape does not close it',
  );
  screen.handleKeyDown('Escape', false);
  check(!screen.isOpen, 'a fresh Escape dismisses it');
  setup.rig.dispose();
}

function verifyDiscard(): void {
  console.log('\nA checkpoint rewind drops the screen unread');
  const setup = rewardRig();
  const dismissals = { count: 0 };
  const closings = { count: 0 };
  setup.screen.onClosed = () => closings.count++;
  const markedSpec = (questTitle: string): QuestRewardSpec => ({
    questTitle,
    sections: [{ kind: 'coins', amount: 1 }],
    onDismissed: () => dismissals.count++,
  });
  setup.rig.bus.emit('questRewardShown', markedSpec('First'));
  setup.rig.bus.emit('questRewardShown', markedSpec('Second'));
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  check(setup.screen.isOpen && setup.screen.queuedCount === 1, 'one screen up, one queued');
  setup.screen.discard();
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  check(
    !setup.screen.isOpen && setup.screen.queuedCount === 0,
    'discard takes down the screen and empties the queue',
  );
  check(
    dismissals.count === 0 && closings.count === 0,
    'and runs no dismissal: no seen flag, no fly-in for a rewound reward',
  );
  setup.rig.dispose();
}

function verifyWaitsForConversation(): void {
  console.log('\nThe screen never opens over a conversation');
  const setup = rewardRig();
  const handle = setup.conversation.open({
    lines: [transientSpeaker('Signet', 'questLine').line('Bravo, darlings.')],
    reward: null,
    questRelated: true,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'blocked' },
    haltsWorld: true,
    anchor: null,
    locksKeyboard: true,
  });
  completeQuest('the_show_must_go_on', setup);
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  check(setup.requested.length === 1, 'the quest asks for its screen while the conversation is up');
  check(!setup.screen.isOpen, 'but the screen waits while the conversation is open');
  if (setup.conversation.isActive(handle)) setup.conversation.close();
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  check(setup.screen.isOpen, 'and goes up once the conversation closes');
  setup.rig.dispose();
}

function verifyQueue(): void {
  console.log('\nTwo completions in one frame queue up');
  const setup = rewardRig();
  completeQuest('the_show_must_go_on', setup);
  completeQuest('krasue_murders', setup);
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  const first = setup.screen.showing;
  check(setup.screen.isOpen && setup.screen.queuedCount === 1, 'one shows and one waits');
  setup.screen.advance();
  setup.screen.advance();
  stepScreen(setup, OPEN_WITHIN_FRAMES);
  const second = setup.screen.showing;
  check(
    second !== null && first !== null && second !== first,
    'the second goes up once the first is dismissed',
  );
  check(setup.opens.count === 2, 'each went up exactly once');
  setup.rig.dispose();
}

/** The travel cards on a screen, by title. */
function travelCards(spec: QuestRewardSpec | undefined): RewardUnlockCard[] {
  return (spec?.sections ?? []).flatMap((section) =>
    section.kind === 'unlocks'
      ? section.cards.filter((card) => card.title.startsWith(TRAVEL_CARD_PREFIX))
      : [],
  );
}

/** The circus finale's screen, with the anchor questline at `anchorStatus`. */
function circusScreen(anchorStatus: QuestStatus): QuestRewardSpec | undefined {
  const setup = rewardRig();
  const anchor = createAnchorQuestProgress();
  anchor.status = anchorStatus;
  const quest = new CircusQuestSystem(
    setup.rig.map,
    setup.rig.bus,
    () => undefined,
    null,
    createCircusQuestProgress(),
    null,
    null,
    setup.rig.human,
    setup.conversation,
    { anchor },
  );
  callCompletion(quest, 'finishQuest', [setup.rig.human, setup.rig]);
  setup.rig.dispose();
  return setup.requested[0];
}

/** The Plea's screen, with the anchor questline at `anchorStatus`. */
function pleaScreen(anchorStatus: QuestStatus): QuestRewardSpec | undefined {
  const setup = rewardRig();
  setup.rig.anchorQuest.status = anchorStatus;
  setup.rig.kit.quest?.grantRewards();
  setup.rig.dispose();
  return setup.requested[0];
}

/** The anchor's own screen, with the circus and the Plea finished or not. */
function anchorScreen(circusDone: boolean, pleaDone: boolean): QuestRewardSpec | undefined {
  const setup = rewardRig();
  const { rig } = setup;
  const progress = createAnchorQuestProgress();
  progress.status = 'active';
  const circus = createCircusQuestProgress();
  if (circusDone) circus.stage = 'complete';
  if (pleaDone) rig.state.quest.phase = 'complete';
  for (const shard of ANCHOR_SHARD_IDS) rig.human.inventory.addItem(shard, 1);
  rig.human.coins = ANCHOR_PURSE;
  const quest = new AnchorQuestSystem(
    rig.bus,
    progress,
    () => ({ human: rig.human, cat: rig.cat }),
    () => null,
    () => null,
    () => null,
    () => undefined,
    setup.conversation,
    { circus, briarHollow: rig.state, anchor: progress },
  );
  callCompletion(quest, 'assemble', [rig.human]);
  rig.dispose();
  return setup.requested[0];
}

function cardTitles(spec: QuestRewardSpec | undefined): string {
  return travelCards(spec)
    .map((card) => card.title)
    .join(', ');
}

function verifyTravelUnlockCards(): void {
  console.log('\nScreens that bind the anchor somewhere say so');
  const screens: ReadonlyArray<{
    readonly name: string;
    readonly title: string;
    readonly build: (status: QuestStatus) => QuestRewardSpec | undefined;
  }> = [
    { name: 'the circus finale', title: 'Anchor travel: Circus', build: circusScreen },
    { name: "Briar Hollow's Plea", title: 'Anchor travel: Briar Hollow', build: pleaScreen },
  ];
  for (const screen of screens) {
    const before = travelCards(screen.build('available'));
    check(
      before.length === 1 && before[0]?.title === screen.title,
      `${screen.name} shows the "${screen.title}" card`,
    );
    check(
      before[0]?.condition === ANCHOR_CONDITION,
      `with the anchor not yet earned, it says ${ANCHOR_CONDITION}`,
    );
    const after = travelCards(screen.build('completed'));
    check(
      after.length === 1 && after[0]?.condition === undefined,
      'with the anchor earned, the card carries no condition',
    );
  }

  const fresh = anchorScreen(false, false);
  check(
    cardTitles(fresh) === 'Anchor travel: Skyfowl Town',
    `the anchor's screen alone lists Skyfowl Town (${cardTitles(fresh)})`,
  );
  const everything = anchorScreen(true, true);
  check(
    cardTitles(everything) ===
      'Anchor travel: Skyfowl Town, Anchor travel: Circus, Anchor travel: Briar Hollow',
    `after both questlines it lists every destination (${cardTitles(everything)})`,
  );
  check(
    travelCards(everything).every((card) => card.condition === undefined),
    "and none of the anchor's own cards carries a condition",
  );
}

verifyEachQuestOpensOneScreen();
verifyScreenBehaviour();
verifyEscape();
verifyDiscard();
verifyWaitsForConversation();
verifyQueue();
verifyTravelUnlockCards();

console.log(`\n${passes}/${passes + failures} checks passed`);
if (failures > 0) {
  console.log(`verify:quest-reward FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:quest-reward passed');
