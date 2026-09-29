#!/usr/bin/env tsx
/**
 * Gate: Briar Hollow's civilians live their day without wandering off,
 * blocking doors, freezing, or leaving a shop unattended — and they get to
 * shelter when the siege comes.
 *
 * Runs `VillagerSystem` headlessly on real generated floor-3 maps for ten
 * simulated minutes per seed, with the party walking in and out of the
 * village the way a player does: lingering at the square, leaving through the
 * gate to the far fields, and walking back in. Asserts, every frame:
 *
 *  - no villager leaves the village interior (Garn: the quarry);
 *  - none stands still on a doorway threshold for more than 2 s;
 *  - none is stuck — trying to walk and not moving — for more than 5 s;
 *  - every shop and service is at its post whenever the party is within
 *    `SERVICE_AT_POST_TILES` of it;
 *  - once the phase turns `imminent`, everyone reaches shelter within 20 s;
 *
 * and, once: no villager is a `Mob` or a `Player`, so none can ever be put in
 * the combat roster that every attack, blast and companion reads.
 *
 * Run: npm run verify:villagers [-- --seeds=N]
 */

import { GameMap } from '../src/map/GameMap';
import { installCanvasGlobals } from './nodeCanvasGlobals';
import { asGameContext } from './nodeGameContext';
import { createCanvas } from 'canvas';
import { setViewportSize } from '../src/core/Viewport';
import { Conversation, CONVERSATION_CHOICE_LABEL_SIZE } from '../src/dialog/Conversation';
import { speakerLines } from '../src/dialog/line';
import { OREN } from '../src/dialog/scripts/briarHollow';
import type { Choice, ConversationRequest } from '../src/dialog/request';
import { buttonLabelFits } from '../src/ui/Button';
import {
  ASK_QUESTION_LABEL,
  BACK_LABEL,
  BUILT_IN_TOPICS,
  GOODBYE_LABEL,
  type VillagerConversationFlow,
} from '../src/systems/briarHollow/villagerTopics';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { createBriarHollowState } from '../src/core/briarHollowState';
import { Mob } from '../src/creatures/Mob';
import { Player } from '../src/Player';
import { mulberry32 } from '../src/sprites/person/rng';
import type { TilePoint, TileRect } from '../src/map/town/townPlan';
import { VillageNavigator } from '../src/systems/briarHollow/villageNavigator';
import {
  SERVICE_AT_POST_TILES,
  VillagerSystem,
  type VillagerCrawler,
  type VillagerFrame,
} from '../src/systems/briarHollow/VillagerSystem';
import type { Villager } from '../src/systems/briarHollow/Villager';
import type { VillagerPartyState } from '../src/systems/briarHollow/villagerCircumstances';
import { GATE_SWING_SECONDS, VillageGate } from '../src/systems/briarHollow/VillageGate';
import type { BriarHollowGate } from '../src/map/overworld/briarHollowSite';

const MAP_SIZE = 280;
const DEFAULT_SEEDS = 3;
const FRAMES_PER_SECOND = 60;
const SIMULATED_MINUTES = 10;
const SECONDS_PER_MINUTE = 60;
const TOTAL_FRAMES = SIMULATED_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;
/** The siege starts this far in, leaving time before it for the day and after it for the return. */
const SIEGE_START_FRAME = 7 * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;
/** How long the village stays in hiding before the phase moves on. */
const SIEGE_LENGTH_FRAMES = 60 * FRAMES_PER_SECOND;
const SHELTER_DEADLINE_FRAMES = 20 * FRAMES_PER_SECOND;
const THRESHOLD_DWELL_LIMIT_FRAMES = 2 * FRAMES_PER_SECOND;
const STUCK_LIMIT_FRAMES = 5 * FRAMES_PER_SECOND;
/** How far beyond the palisade the party roams — well past the point a shopkeeper is called home. */
const PARTY_ROAM_MARGIN_TILES = 70;
/** The party starts the day out in the fields, this far from the village centre at least, for this long. */
const PARTY_AWAY_TILES = 75;
const PARTY_AWAY_FRAMES = 3 * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;
/** How long the party stands about at each stop, at most. */
const PARTY_LINGER_MAX_FRAMES = 8 * FRAMES_PER_SECOND;
/** A small phone held landscape, and more choices than any villager has today. */
const SHORT_PHONE_WIDTH = 568;
const SHORT_PHONE_HEIGHT = 320;
const MANY_CHOICES = 8;
/** The cat walks a few frames behind Carl. */
const CAT_TRAIL_FRAMES = 20;

/**
 * One gameplay update, the way the real scene drives it: `VillagerSystem`
 * doesn't tick the shared `Conversation` — only the scene does, once per
 * frame, with the active player's position.
 */
function tick(system: VillagerSystem, frame: VillagerFrame): void {
  system.update(frame);
  system.conversation.update(frame.active);
}

/**
 * A flow that never actually plays a beat — for a check that only reads a
 * built-in topic's `label`/`key`, never its `run`.
 */
const INERT_REQUEST: ConversationRequest = {
  lines: [speakerLines('oren').line('unused')],
  reward: null,
  questRelated: false,
  ending: { kind: 'close', onClosed: () => undefined },
  dismiss: { kind: 'blocked' },
  haltsWorld: false,
  anchor: null,
  locksKeyboard: true,
};
const INERT_FLOW: VillagerConversationFlow = {
  answer: () => INERT_REQUEST,
  answerWithTopics: () => INERT_REQUEST,
  answerAndReturnToRoot: () => INERT_REQUEST,
  sayKeepingMenu: () => INERT_REQUEST,
  returnToRoot: () => INERT_REQUEST,
  openTopics: () => INERT_REQUEST,
  closeNow: () => INERT_REQUEST,
  closeAfter: () => INERT_REQUEST,
  onEventualClose: () => undefined,
};

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

function seedCount(): number {
  const arg = process.argv.find((value) => value.startsWith('--seeds='));
  const parsed = arg === undefined ? Number.NaN : Number.parseInt(arg.slice('--seeds='.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SEEDS;
}

function grown(rect: TileRect, by: number): TileRect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

function tileOf(body: VillagerCrawler): TilePoint {
  return { x: Math.round(body.x / TILE_SIZE), y: Math.round(body.y / TILE_SIZE) };
}

function inside(rect: TileRect, tile: TilePoint): boolean {
  return (
    tile.x >= rect.x && tile.y >= rect.y && tile.x < rect.x + rect.w && tile.y < rect.y + rect.h
  );
}

const FIXED_PARTY: VillagerPartyState = {
  hpFractions: { human: 1, cat: 1 },
  stone: 0,
  axeTier: null,
  pickaxeTier: null,
  constructionLevels: { human: 0, cat: 0 },
  constructionLearned: false,
};

/** The party: Carl walks from stop to stop; the cat trails him. */
class SimulatedParty {
  readonly human = { x: 0, y: 0 };
  readonly cat = { x: 0, y: 0 };
  private route: TilePoint[] = [];
  private lingerFrames = 0;
  private readonly trail: Array<{ x: number; y: number }> = [];
  private frame = 0;

  constructor(
    private readonly roam: VillageNavigator,
    private readonly village: TileRect,
    private readonly centre: TilePoint,
    private readonly random: () => number,
    start: TilePoint,
  ) {
    this.human.x = start.x * TILE_SIZE;
    this.human.y = start.y * TILE_SIZE;
    this.cat.x = this.human.x;
    this.cat.y = this.human.y;
  }

  /**
   * Somewhere to walk to next: out in the far fields while the day starts,
   * then half the time inside the village and half anywhere around it.
   */
  private nextStop(): TilePoint {
    const away = this.frame < PARTY_AWAY_FRAMES;
    const inVillage = !away && this.random() < 1 / 2;
    const area = inVillage ? this.village : this.roam.bounds;
    for (;;) {
      const tile = {
        x: area.x + Math.floor(this.random() * area.w),
        y: area.y + Math.floor(this.random() * area.h),
      };
      const farEnough =
        !away || Math.hypot(tile.x - this.centre.x, tile.y - this.centre.y) >= PARTY_AWAY_TILES;
      if (farEnough && this.roam.isStandable(tile.x, tile.y)) return tile;
    }
  }

  /** Where the party starts: somewhere out in the far fields. */
  placeAway(): void {
    const start = this.nextStop();
    this.human.x = start.x * TILE_SIZE;
    this.human.y = start.y * TILE_SIZE;
    this.cat.x = this.human.x;
    this.cat.y = this.human.y;
  }

  step(): void {
    this.frame++;
    if (this.route.length === 0) {
      if (this.lingerFrames > 0) {
        this.lingerFrames--;
      } else {
        this.route = this.roam.findPath(tileOf(this.human), this.nextStop()) ?? [];
        this.lingerFrames = Math.floor(this.random() * PARTY_LINGER_MAX_FRAMES);
      }
    }
    let budget = PLAYER_SPEED;
    while (budget > 0 && this.route.length > 0) {
      const target = this.route[0];
      const dx = target.x * TILE_SIZE - this.human.x;
      const dy = target.y * TILE_SIZE - this.human.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        this.human.x = target.x * TILE_SIZE;
        this.human.y = target.y * TILE_SIZE;
        budget -= distance;
        this.route.shift();
      } else {
        this.human.x += (dx / distance) * budget;
        this.human.y += (dy / distance) * budget;
        budget = 0;
      }
    }
    this.trail.push({ x: this.human.x, y: this.human.y });
    if (this.trail.length > CAT_TRAIL_FRAMES) {
      const behind = this.trail.shift();
      if (behind !== undefined) {
        this.cat.x = behind.x;
        this.cat.y = behind.y;
      }
    }
  }
}

interface Watch {
  lastX: number;
  lastY: number;
  stillOnThresholdFrames: number;
  stuckFrames: number;
  /** Frames spent walking, and frames a shop or service spent away from its counter. */
  movingFrames: number;
  awayFromPostFrames: number;
}

function simulate(seed: number): void {
  console.log(`\nseed ${seed}`);
  const map = new GameMap({
    mapSize: MAP_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
    tileHeight: TILE_SIZE,
  });
  const site = map.briarHollow;
  if (site === null) {
    check(false, 'the map has a Briar Hollow site');
    return;
  }
  const state = createBriarHollowState();
  const random = mulberry32(seed);
  const system = new VillagerSystem({
    gameMap: map,
    site,
    state,
    bus: null,
    audio: null,
    conversation: new Conversation(null),
    party: () => FIXED_PARTY,
    random,
  });
  const roam = new VillageNavigator(map, grown(site.palisadeBounds, PARTY_ROAM_MARGIN_TILES));
  const village = new VillageNavigator(map, site.interior);
  const party = new SimulatedParty(roam, site.interior, site.centre, random, site.gate.outside);
  party.placeAway();

  check(
    system.villagers.every(
      (villager) => !(villager instanceof Mob) && !(villager instanceof Player),
    ),
    'no villager is a Mob or a Player, so none can enter the combat roster',
  );

  const watches = new Map<Villager, Watch>(
    system.villagers.map((villager) => [
      villager,
      {
        lastX: villager.x,
        lastY: villager.y,
        stillOnThresholdFrames: 0,
        stuckFrames: 0,
        movingFrames: 0,
        awayFromPostFrames: 0,
      },
    ]),
  );
  const boundsOf = (villager: Villager): TileRect =>
    villager.routine.bounds === 'quarry' ? site.quarry.rect : site.interior;

  const workshopRect = site.buildings.find((building) => building.id === 'workshop')?.rect ?? null;

  const problems = new Set<string>();
  let servicePostChecks = 0;
  let shelteredBy: number | null = null;
  const note = (problem: string): void => {
    problems.add(problem);
  };

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    if (frame === SIEGE_START_FRAME) state.quest.phase = 'imminent';
    if (frame === SIEGE_START_FRAME + SIEGE_LENGTH_FRAMES) state.quest.phase = 'victory';
    party.step();
    tick(system, { human: party.human, cat: party.cat, active: party.human });

    const inSiege = state.quest.phase === 'imminent';
    for (const villager of system.villagers) {
      const watch = watches.get(villager);
      if (watch === undefined) continue;
      const tile = villager.tile;
      const moved = villager.x !== watch.lastX || villager.y !== watch.lastY;
      watch.lastX = villager.x;
      watch.lastY = villager.y;
      if (moved) watch.movingFrames++;
      const awayFromPost = tile.x !== villager.post.x || tile.y !== villager.post.y;
      if (awayFromPost && !inSiege) watch.awayFromPostFrames++;

      if (!inside(boundsOf(villager), tile)) {
        note(`${villager.id} left its bounds at (${tile.x}, ${tile.y})`);
      }

      if (villager.id === 'tikka' && workshopRect !== null && !inside(workshopRect, tile)) {
        note(`tikka left the workshop at (${tile.x}, ${tile.y})`);
      }

      const onThreshold = village.isThreshold(tile.x, tile.y);
      watch.stillOnThresholdFrames = onThreshold && !moved ? watch.stillOnThresholdFrames + 1 : 0;
      if (watch.stillOnThresholdFrames > THRESHOLD_DWELL_LIMIT_FRAMES) {
        note(`${villager.id} stood on the threshold at (${tile.x}, ${tile.y}) for over 2 s`);
      }

      watch.stuckFrames = villager.isTravelling && !moved ? watch.stuckFrames + 1 : 0;
      if (watch.stuckFrames > STUCK_LIMIT_FRAMES) {
        note(`${villager.id} was stuck at (${tile.x}, ${tile.y}) for over 5 s`);
      }

      if (villager.routine.service && !inSiege && villager.state !== 'sheltering') {
        const post = { x: villager.post.x * TILE_SIZE, y: villager.post.y * TILE_SIZE };
        const partyNear = [party.human, party.cat].some(
          (crawler) =>
            Math.hypot(crawler.x - post.x, crawler.y - post.y) / TILE_SIZE <= SERVICE_AT_POST_TILES,
        );
        if (partyNear) {
          servicePostChecks++;
          const atPost = tile.x === villager.post.x && tile.y === villager.post.y;
          if (!atPost) note(`${villager.id} was away from the counter with the party beside it`);
        }
      }
    }

    if (inSiege && shelteredBy === null) {
      const allSheltered = system.villagers.every(
        (villager) =>
          villager.tile.x === villager.shelter.x &&
          villager.tile.y === villager.shelter.y &&
          !villager.isTravelling,
      );
      if (allSheltered) shelteredBy = frame - SIEGE_START_FRAME;
    }
  }

  // Guards against a village that passes by never moving at all.
  // A shop keeps to its counter by design, so one of them staying put all
  // day is luck, not a fault; the check after this one bounds that.
  const idle = system.villagers.filter(
    (villager) => !villager.routine.service && (watches.get(villager)?.movingFrames ?? 0) === 0,
  );
  check(
    idle.length === 0,
    `every villager walked somewhere (idle: ${idle.map((v) => v.id).join(', ') || 'none'})`,
  );
  const homebodies = system.villagers.filter(
    (villager) =>
      villager.routine.service && (watches.get(villager)?.awayFromPostFrames ?? 0) === 0,
  );
  check(
    homebodies.length <= 1,
    `the shops strolled while the party was away (never left: ${homebodies.map((v) => v.id).join(', ') || 'none'})`,
  );
  for (const problem of problems) check(false, problem);
  check(problems.size === 0, 'no villager left its bounds, idled on a threshold, or stuck');
  check(
    servicePostChecks > 0,
    `the party came within reach of a counter (${servicePostChecks} frames)`,
  );
  check(
    shelteredBy !== null && shelteredBy <= SHELTER_DEADLINE_FRAMES,
    `everyone reached shelter within 20 s (${shelteredBy === null ? 'never' : `${(shelteredBy / FRAMES_PER_SECOND).toFixed(1)} s`})`,
  );
  const returned = system.villagers.filter((villager) => villager.state !== 'sheltering').length;
  check(
    returned === system.villagers.length,
    `after the siege everyone came out of hiding (${returned}/${system.villagers.length})`,
  );
}

/**
 * The talk flow end to end, without a browser: Space in range opens the
 * panel on the villager's line, the choices come up once it is read, a
 * number key picks one, walking off closes it, and an unnamed villager
 * answers with a bubble rather than a panel.
 */
function verifyConversation(): void {
  console.log('\nconversation');
  installCanvasGlobals();
  // A dialog box lays itself out against the live viewport, so — as in the
  // running game, where the canvas is always sized before any scene ticks —
  // this must be set before the first line is shown, not only when a check
  // later on cares about screen bounds.
  setViewportSize(SHORT_PHONE_WIDTH, SHORT_PHONE_HEIGHT);
  const map = new GameMap({
    mapSize: MAP_SIZE,
    mapType: 'overworld',
    worldSeed: 1,
    tileHeight: TILE_SIZE,
  });
  const site = map.briarHollow;
  if (site === null) {
    check(false, 'the map has a Briar Hollow site');
    return;
  }
  const state = createBriarHollowState();
  const system = new VillagerSystem({
    gameMap: map,
    site,
    state,
    bus: null,
    audio: null,
    conversation: new Conversation(null),
    party: () => ({ ...FIXED_PARTY, axeTier: 0, pickaxeTier: 0 }),
    random: mulberry32(1),
  });
  const oren = system.villagers.find((villager) => villager.id === 'oren');
  const elder = system.villagers.find((villager) => villager.id === 'elder_bracken');
  if (oren === undefined || elder === undefined) {
    check(false, 'Oren and Elder Bracken are in the village');
    return;
  }
  const talker = { x: oren.x, y: oren.y + TILE_SIZE };
  const far = { x: 0, y: 0 };
  const frame = { human: talker, cat: far, active: talker };

  check(system.talkTarget(far) === null, 'nobody answers from across the map');
  check(system.tryTalk(talker), 'Space beside Oren opens a conversation');
  check(system.isConversationOpen && oren.state === 'talking', 'and he stops to talk');
  check(state.talkCounts.oren === 1, 'the talk is counted in the village state');
  check(system.lastOpening?.pages[0] === OREN.firstMeeting, 'he opens with his first meeting');
  check(system.talkSpeakerFor(talker)?.x === oren.x, 'Carl is told who he is facing');
  system.conversation.advance();
  tick(system, frame);
  check(system.conversation.isShowingChoices, 'the choices come up once the line is read');
  check(
    system.conversation.choiceLabels.length === 2,
    'only "I have a question" and Goodbye sit at the root',
  );
  check(system.conversation.handleKeyDown('1'), 'a number key opens "I have a question"');
  check(system.conversation.isShowingChoices, 'and the question submenu comes up');
  check(system.conversation.handleKeyDown('1'), 'a number key picks a question');
  check(!system.conversation.isShowingChoices, 'and the answer is shown');
  system.conversation.advance();
  tick(system, frame);
  system.conversation.advance();
  check(!system.isConversationOpen, 'the conversation ends after the answer');
  check(oren.state !== 'talking', 'and Oren goes back to his day');

  // Asking about something else means talking to Oren again — each answer
  // closes the whole conversation, and reopening brings every topic back,
  // since a picked row is only dropped for the conversation that consumed
  // it. Every lore row about Oren is `isQuestion`, so the root always offers
  // only "I have a question" and Goodbye; the questions themselves live one
  // level down, in the submenu it opens. Some answers span more than one
  // page, so each round reads however many pages it takes to reach the next
  // choice row, or the auto-close, whichever comes first.
  const readUntilChoicesOrClosed = (): void => {
    for (
      let guard = 0;
      guard < 6 && system.isConversationOpen && !system.conversation.isShowingChoices;
      guard++
    ) {
      system.conversation.advance();
      tick(system, frame);
    }
  };
  for (let round = 0; round < 3; round++) {
    check(system.tryTalk(talker), `talks again for round ${round + 1}`);
    readUntilChoicesOrClosed();
    check(
      system.conversation.choiceLabels.length === 2,
      `only "I have a question" and Goodbye at the root (round ${round + 1})`,
    );
    check(system.conversation.handleKeyDown('1'), `opens "I have a question" (round ${round + 1})`);
    check(
      system.conversation.choiceLabels.length === 5,
      `every question is back, Back included (round ${round + 1})`,
    );
    check(system.conversation.handleKeyDown('1'), `picks a question (round ${round + 1})`);
    readUntilChoicesOrClosed();
    check(
      !system.isConversationOpen,
      `the conversation ends after the answer (round ${round + 1})`,
    );
  }
  check(oren.state !== 'talking', 'and Oren goes back to his day');

  check(system.tryTalk(talker), 'a fresh conversation reopens, topics restored');
  readUntilChoicesOrClosed();
  check(system.conversation.handleKeyDown('1'), 'opens "I have a question" once more');
  check(
    system.conversation.choiceLabels.some((label) => label.includes('About the axe')),
    'the earlier conversation’s picks do not carry over to a new one',
  );
  const home = { x: talker.x, y: talker.y };
  talker.x = far.x;
  talker.y = far.y;
  tick(system, frame);
  check(!system.isConversationOpen, 'walking away ends the conversation');
  check(oren.state !== 'talking', 'and Oren goes back to his day');

  talker.x = home.x;
  talker.y = home.y;
  check(system.tryTalk(talker), 'a second talk opens again');
  check(system.lastOpening?.rule === 'fallback', 'on a rotating line rather than the greeting');
  system.conversation.advance();
  tick(system, frame);
  // A choice row only answers Space once it has actually been drawn — the
  // same tick that reveals it must not also be the tick that picks from it.
  const goodbyeScratch = createCanvas(SHORT_PHONE_WIDTH, SHORT_PHONE_HEIGHT);
  system.conversation.render(asGameContext(goodbyeScratch.getContext('2d')));
  const rootDefault = system.conversation.keyboardDefaultLabel;
  check(
    rootDefault !== null && rootDefault !== GOODBYE_LABEL,
    `Space on the choice row goes on rather than saying goodbye (default: ${rootDefault})`,
  );
  system.conversation.advance();
  check(system.isConversationOpen, 'and the conversation stays open');
  system.conversation.dismiss();
  check(!system.isConversationOpen, 'Escape is what says goodbye');

  // A short phone: every choice row must still be on screen to be tapped.
  const openWithChoices = (speaker: 'tikka' | 'oren', choices: readonly Choice[]): Conversation => {
    const [first, ...rest] = choices;
    if (first === undefined) throw new Error('openWithChoices: choices must not be empty');
    const panel = new Conversation(null);
    panel.open({
      lines: [speakerLines(speaker).line('A line.')],
      reward: null,
      questRelated: false,
      ending: { kind: 'choices', choices: [first, ...rest] },
      dismiss: { kind: 'blocked' },
      haltsWorld: false,
      anchor: null,
      locksKeyboard: true,
    });
    panel.advance();
    panel.update(null);
    return panel;
  };
  const panel = openWithChoices(
    'tikka',
    Array.from({ length: MANY_CHOICES }, (_, index) => ({
      label: `Topic ${index + 1}`,
      tone: 'normal' as const,
      run: () => undefined,
    })),
  );
  const screen = createCanvas(SHORT_PHONE_WIDTH, SHORT_PHONE_HEIGHT);
  panel.render(asGameContext(screen.getContext('2d')));
  const rects = panel.choiceBounds;
  check(rects.length === MANY_CHOICES, `all ${MANY_CHOICES} choices are drawn on a short phone`);
  check(
    rects.every(
      (rect) =>
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.w <= SHORT_PHONE_WIDTH &&
        rect.y + rect.h <= SHORT_PHONE_HEIGHT,
    ),
    `and every one of them is on the ${SHORT_PHONE_WIDTH}×${SHORT_PHONE_HEIGHT} screen`,
  );

  // Oren's real choices on the same phone: every label must fit its button,
  // at the root (his actions plus "I have a question") and in the question
  // submenu it opens (his built-in lore, every row of it, plus "Back").
  const checkPhoneFit = (level: string, choices: readonly Choice[]): void => {
    const panel = openWithChoices('oren', choices);
    const screen = createCanvas(SHORT_PHONE_WIDTH, SHORT_PHONE_HEIGHT);
    const ctx = asGameContext(screen.getContext('2d'));
    panel.render(ctx);
    const overflowing = panel.choiceBounds.filter(
      (rect) => !buttonLabelFits(ctx, rect.label, rect.w, CONVERSATION_CHOICE_LABEL_SIZE),
    );
    check(
      panel.choiceBounds.length === choices.length,
      `all ${choices.length} of Oren's ${level} choices are drawn on a short phone`,
    );
    check(
      overflowing.length === 0,
      `and every ${level} label fits its button (overflowing: ${overflowing.map((rect) => rect.label).join(', ') || 'none'})`,
    );
    check(
      panel.choiceBounds.every((rect) => rect.y >= 0 && rect.y + rect.h <= SHORT_PHONE_HEIGHT),
      `and every ${level} choice is on screen`,
    );
  };
  checkPhoneFit('root', [
    { label: ASK_QUESTION_LABEL, tone: 'normal', run: () => undefined },
    { label: GOODBYE_LABEL, tone: 'exit', run: () => undefined },
  ]);
  checkPhoneFit('question', [
    ...BUILT_IN_TOPICS.topics('oren', system.contextFor('oren', oren, null), INERT_FLOW).map(
      (topic) => ({
        label: topic.label,
        tone: 'normal' as const,
        run: () => undefined,
      }),
    ),
    { label: BACK_LABEL, tone: 'exit' as const, run: () => undefined },
  ]);

  const beside = { x: elder.x + TILE_SIZE, y: elder.y };
  const elderFrame = { human: beside, cat: far, active: beside };
  check(system.tryTalk(beside), 'Space beside an unnamed elder is answered');
  check(!system.isConversationOpen && elder.bark.current !== null, 'with a bubble, not the panel');
  tick(system, elderFrame);
}

/**
 * A body merely near the gate, with no route through it, must never open it —
 * only a body whose route crosses one of the gate's own tiles does. A body
 * with no route at all (the player) still opens it by proximity, as always.
 */
function verifyGateOpensOnlyForARouteThroughIt(): void {
  const gateTiles: TilePoint[] = [
    { x: 10, y: 10 },
    { x: 11, y: 10 },
    { x: 12, y: 10 },
  ];
  const gateDef: BriarHollowGate = {
    tiles: gateTiles,
    outside: { x: 11, y: 8 },
    inside: { x: 11, y: 12 },
    facing: 'south',
  };
  const middle = gateTiles[1];
  const middleWorld = { x: middle.x * TILE_SIZE, y: middle.y * TILE_SIZE };
  const framesToOpen = Math.ceil(GATE_SWING_SECONDS * FRAMES_PER_SECOND);

  const openFractionAfter = (
    friendlies: ReadonlyArray<{
      readonly x: number;
      readonly y: number;
      readonly routeTiles?: ReadonlyArray<TilePoint>;
    }>,
    frames: number,
  ): number => {
    const gate = new VillageGate([], gateDef, null);
    let fraction = 0;
    for (let frame = 0; frame < frames; frame++) {
      gate.update(friendlies, 0, 1 / FRAMES_PER_SECOND);
      fraction = gate.openFraction;
    }
    return fraction;
  };

  const pacingGuard = { x: middleWorld.x, y: middleWorld.y, routeTiles: [{ x: 11, y: 9 }] };
  check(
    openFractionAfter([pacingGuard], framesToOpen) === 0,
    'a guard pacing beside the gate without a route through it leaves the gate shut',
  );

  const crossingVillager = {
    x: middleWorld.x,
    y: middleWorld.y,
    routeTiles: [{ x: 11, y: 9 }, middle, { x: 11, y: 11 }],
  };
  check(
    openFractionAfter([crossingVillager], framesToOpen) > 0,
    "a villager whose route crosses the gate's own tile opens it in time",
  );

  const player = { x: middleWorld.x, y: middleWorld.y };
  check(
    openFractionAfter([player], framesToOpen) > 0,
    'the player still opens the gate by proximity alone, with no route to consult',
  );
}

for (let seed = 1; seed <= seedCount(); seed++) simulate(seed);
verifyConversation();
verifyGateOpensOnlyForARouteThroughIt();

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll villager checks passed.\n');
