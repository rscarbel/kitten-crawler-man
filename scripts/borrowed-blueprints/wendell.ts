/**
 * Wendell's checks for `verify:borrowed-blueprints`: the first visit that
 * names his price and sends the party to Merrit, his waiting line once per
 * visit, the hand-over once Midge is in his pasture, the hand-back after the
 * blueprints were lost, the knocked-out partner holding every beat, and the
 * dairy corner's examine lines once a cow lives there.
 *
 * His hook is stood up the way Plumbline Farm's interior stands it up, on a
 * real `Conversation` read through page by page, with real crawlers, so the
 * gate needs no scene.
 */

import type { BlueprintsQuestPhase } from '../../src/core/blueprintsQuestPhase';
import { createBriarHollowState, type BriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import { EventBus } from '../../src/core/EventBus';
import { QUEST_SLOT_IDX, type ItemId } from '../../src/core/ItemDefs';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation } from '../../src/dialog/Conversation';
import type { DialogLine } from '../../src/dialog/line';
import type { ConversationRequest } from '../../src/dialog/request';
import { DAIRY_LIVE_EXAMINE_LINES, EXAMINE_LINES } from '../../src/dialog/scripts/interiorObjects';
import { WENDELL } from '../../src/dialog/scripts/wendellBlueprints';
import { PLUMBLINE_FARM_NAME } from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import { plumblineFarmExamineLine } from '../../src/systems/briarHollow/blueprints/plumblineFarmRoom';
import { WendellBlueprintsHook } from '../../src/systems/briarHollow/blueprints/WendellBlueprintsHook';

/** The runner's pass/fail recorder, handed in so every section counts toward one verdict. */
export type Check = (ok: boolean, label: string) => void;

/** Plumbline Farm's ground floor, where Wendell stands. */
const WENDELL_FLOOR = 0;
/** More presses than any of his beats has pages, so a read-through that never ends is caught. */
const MAX_PRESSES_PER_BEAT = 2000;

interface WendellRig {
  readonly state: BriarHollowState;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly conversation: Conversation;
  readonly bus: EventBus;
  /** Every request the hook opened, in order. */
  readonly opened: ConversationRequest[];
  /** Every item the hook flew to the bag. */
  readonly granted: ItemId[];
  readonly phasesMoved: BlueprintsQuestPhase[];
  /** A fresh visit to the room: a new hook against the same state and crawlers. */
  visit(): WendellBlueprintsHook;
}

function wendellRig(phase: BlueprintsQuestPhase): WendellRig {
  const state = createBriarHollowState();
  state.blueprints.phase = phase;
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  human.isActive = true;
  const conversation = new Conversation(null);
  const opened: ConversationRequest[] = [];
  const open = conversation.open.bind(conversation);
  conversation.open = (request) => {
    opened.push(request);
    return open(request);
  };
  const bus = new EventBus();
  const phasesMoved: BlueprintsQuestPhase[] = [];
  bus.on('blueprintsQuestPhaseChanged', (event) => phasesMoved.push(event.phase));
  const granted: ItemId[] = [];
  const visit = (): WendellBlueprintsHook => {
    const hook = WendellBlueprintsHook.forBuilding(PLUMBLINE_FARM_NAME, WENDELL_FLOOR, {
      state,
      bus,
      audio: null,
      conversation,
      human,
      cat,
      toast: () => undefined,
      onItemGranted: (id) => granted.push(id),
    });
    if (hook === null) throw new Error("Wendell's hook did not stand up on Plumbline Farm");
    return hook;
  };
  return { state, human, cat, conversation, bus, opened, granted, phasesMoved, visit };
}

/** Reads the open conversation to its end: skips the typing and turns every page. */
function readThrough(conversation: Conversation): void {
  for (let press = 0; press < MAX_PRESSES_PER_BEAT && conversation.isOpen; press++) {
    conversation.update(null);
    if (!conversation.isOpen) break;
    conversation.advance();
  }
}

function speakerOf(line: DialogLine): string {
  return line.speaker.kind === 'cast' ? line.speaker.id : line.speaker.name;
}

function firstLineOf(request: ConversationRequest | undefined): DialogLine | null {
  const first = request?.lines[0];
  return first !== undefined && 'paragraphs' in first ? first : null;
}

function questSlotItem(crawler: HumanPlayer | CatPlayer): ItemId | null {
  return crawler.inventory.actionBar.slots[QUEST_SLOT_IDX]?.id ?? null;
}

/** The first visit: his price, in the active crawler's voice, and on to Merrit only once it is read. */
export function verifyWendellFirstVisit(check: Check): void {
  check(
    WendellBlueprintsHook.forBuilding('Hilda’s Cottage', WENDELL_FLOOR, wendellRigDeps()) === null,
    'no Wendell hook in any other building',
  );

  const rig = wendellRig('ask_wendell');
  const hook = rig.visit();
  check(!hook.tryOpenDialog('old_hilda', rig.human), 'another resident is left to her own lines');
  check(hook.tryOpenDialog('wendell', rig.human), 'talking to Wendell at ask_wendell opens a beat');
  check(hook.isDialogOpen, 'and the beat is his');
  const firstLine = firstLineOf(rig.opened[0]);
  check(
    firstLine !== null && speakerOf(firstLine) === 'carl',
    'Carl opens it when Carl is being driven',
  );

  check(hook.dismissDialog(), 'Esc closes the first visit');
  check(
    rig.state.blueprints.phase === 'ask_wendell',
    'walking out of it leaves the step at ask_wendell',
  );

  rig.human.isActive = false;
  rig.cat.isActive = true;
  check(hook.tryOpenDialog('wendell', rig.cat), 'asking again replays the first visit');
  const donutFirst = firstLineOf(rig.opened[1]);
  check(
    donutFirst !== null && speakerOf(donutFirst) === 'donut',
    'Donut opens it when Donut is being driven',
  );
  readThrough(rig.conversation);
  check(!rig.conversation.isOpen, 'the first visit reads to its end');
  check(
    rig.state.blueprints.phase === 'ask_merrit' && rig.phasesMoved.join() === 'ask_merrit',
    `reading it through moves the step to ask_merrit (${rig.phasesMoved.join()})`,
  );
  check(
    !hook.tryOpenDialog('wendell', rig.cat),
    'having named his price, he is his usual self for the rest of the visit',
  );
}

/** His waiting line from ask_merrit to escort_midge: once a visit, then his usual flow. */
export function verifyWendellWaiting(check: Check): void {
  const rig = wendellRig('harvest_grain');
  const hook = rig.visit();
  check(hook.markerFor('wendell') === 'none', 'no "?" over him while he waits');
  check(hook.tryOpenDialog('wendell', rig.human), 'the first talk of a visit is his waiting line');
  check(
    rig.opened[0]?.lines.length === 1 && rig.opened[0].lines[0] === WENDELL.waitingForCow,
    'the line is "The pasture is ready whenever the cow is"',
  );
  readThrough(rig.conversation);
  check(!hook.tryOpenDialog('wendell', rig.human), 'the second talk goes to his usual flow');
  check(rig.state.blueprints.phase === 'harvest_grain', 'waiting moves nothing');
  const nextVisit = rig.visit();
  check(nextVisit.tryOpenDialog('wendell', rig.human), 'the next visit hears it again');
  readThrough(rig.conversation);

  const done = wendellRig('complete');
  check(
    !done.visit().tryOpenDialog('wendell', done.human),
    'after the quest he has nothing to add',
  );
  const untouched = wendellRig('unoffered');
  check(
    !untouched.visit().tryOpenDialog('wendell', untouched.human),
    'before the quest he has nothing to add',
  );
}

/** Midge delivered: the blueprints go to the active crawler's quest slot, evicting what was there. */
export function verifyWendellHandOver(check: Check): void {
  const rig = wendellRig('midge_delivered');
  const hook = rig.visit();
  check(hook.markerFor('wendell') === 'question', 'a "?" over him once Midge is settled');

  rig.cat.isKnockedOut = true;
  check(
    !hook.tryOpenDialog('wendell', rig.human),
    'with the partner knocked out in the room, he falls back to his usual lines',
  );
  check(
    rig.state.blueprints.phase === 'midge_delivered' && rig.granted.length === 0,
    'and the step does not advance',
  );
  rig.cat.isKnockedOut = false;

  rig.human.isActive = false;
  rig.cat.isActive = true;
  rig.cat.inventory.addItem('quest_wood_board', 1);
  const evicted: string[] = [];
  rig.cat.inventory.setQuestItemEvictionListener((item) => evicted.push(item.id));
  check(hook.tryOpenDialog('wendell', rig.cat), 'talking to him opens the hand-over');
  check(
    firstLineOf(rig.opened[0]) === WENDELL.midgeDelivered,
    '"She\'s beautiful. Thank you! Here are the blueprints."',
  );
  readThrough(rig.conversation);
  check(
    questSlotItem(rig.cat) === 'quest_blueprints' && questSlotItem(rig.human) === null,
    'the blueprints land in the driven crawler’s quest slot',
  );
  check(evicted.join() === 'quest_wood_board', 'evicting what the slot held before');
  check(rig.granted.join() === 'quest_blueprints', 'and fly to the bag');
  check(rig.state.blueprints.phase === 'build_stations', 'the step moves to build_stations');
  check(hook.markerFor('wendell') === 'none', 'no "?" once they are carried');
  check(
    !hook.tryOpenDialog('wendell', rig.cat),
    'with the blueprints carried, he is his usual self',
  );
}

/** The blueprints lost in build_stations: he hands them back, every time they come home. */
export function verifyWendellHandBack(check: Check): void {
  const rig = wendellRig('build_stations');
  const hook = rig.visit();
  check(hook.markerFor('wendell') === 'question', 'a "?" over him while no crawler holds them');
  check(hook.tryOpenDialog('wendell', rig.human), 'talking to him opens the hand-back');
  check(
    firstLineOf(rig.opened[0]) === WENDELL.blueprintsReturned,
    '"Ah — they found their way home again."',
  );
  readThrough(rig.conversation);
  check(questSlotItem(rig.human) === 'quest_blueprints', 'the driven crawler holds them again');
  check(rig.state.blueprints.phase === 'build_stations', 'the step stays at build_stations');

  rig.human.inventory.removeItems('quest_blueprints', 1);
  check(hook.tryOpenDialog('wendell', rig.human), 'lost a second time, he hands them back again');
  readThrough(rig.conversation);
  check(questSlotItem(rig.human) === 'quest_blueprints', 'and they are held again');
}

/** The churn and the dairy window describe a working dairy once Midge is his. */
export function verifyDairyExamineLines(check: Check): void {
  check(
    plumblineFarmExamineLine('milk_churn', 'escort_midge') === null &&
      plumblineFarmExamineLine('dairy_wall', 'escort_midge') === null,
    'before Midge arrives the room keeps its usual lines',
  );
  check(
    plumblineFarmExamineLine('milk_churn', 'midge_delivered') ===
      DAIRY_LIVE_EXAMINE_LINES.milk_churn &&
      plumblineFarmExamineLine('dairy_wall', 'complete') === DAIRY_LIVE_EXAMINE_LINES.dairy_wall,
    'from midge_delivered on, the churn and the window read as in use',
  );
  check(
    DAIRY_LIVE_EXAMINE_LINES.milk_churn !== EXAMINE_LINES.milk_churn,
    'and the in-use churn line is not the idle one',
  );
  check(
    plumblineFarmExamineLine('feed_sacks', 'complete') === null,
    'the rest of the room keeps its usual lines',
  );
}

function wendellRigDeps(): Parameters<typeof WendellBlueprintsHook.forBuilding>[2] {
  return {
    state: createBriarHollowState(),
    bus: new EventBus(),
    audio: null,
    conversation: new Conversation(null),
    human: new HumanPlayer(0, 0, TILE_SIZE),
    cat: new CatPlayer(0, 0, TILE_SIZE),
    toast: () => undefined,
    onItemGranted: () => undefined,
  };
}

/** Every Wendell section, for the runner's `SECTIONS`. */
export function wendellSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    { name: "Wendell's first visit", run: () => verifyWendellFirstVisit(check) },
    { name: "Wendell's waiting line", run: () => verifyWendellWaiting(check) },
    { name: 'Wendell hands the blueprints over', run: () => verifyWendellHandOver(check) },
    { name: 'Wendell hands lost blueprints back', run: () => verifyWendellHandBack(check) },
    { name: "Plumbline Farm's dairy once Midge is his", run: () => verifyDairyExamineLines(check) },
  ];
}
