#!/usr/bin/env tsx
/**
 * A player who only ever presses Space gets *through* a conversation: every
 * page turns, and every choice or confirm row it opens onto is answered with
 * its accepting option — never with the way out. Escape is the only key that
 * leaves.
 *
 * Driven through the real `Conversation` mounted on a `UiRoot`, and the real
 * quest systems that open it. A Space press goes to the root the way the
 * scene's key handler sends it:
 *
 *   - On a world-halting choice or confirm row the conversation leaves Space
 *     to the root's focus ring, whose focused (or primary) choice it taps.
 *   - Otherwise the conversation's surface takes it, and turns the page.
 *
 * Both of those ignore an OS auto-repeat, so every press here is a fresh one.
 *
 * Also checked:
 *   - The press that finishes a page never also answers the row that page
 *     opens onto, a Space held down from the page (an auto-repeat, or a key
 *     already down when the row appeared) never confirms it, and focus moved
 *     on one row never carries to the next.
 *   - Escape on a resident questline's beat inside the real interior scene is
 *     checked by `verify:interior-hud-clicks`, which builds that scene.
 *   - Every confirm row in `src/` defaults Space to its accept side, except
 *     the ones that spend coin (Madame Voss's fee), where Space does nothing.
 *   - Bramblewick's "I'm ready", which starts the siege on the spot, is never
 *     what Space picks; Space asks for more time instead.
 *
 * Run: npx tsx scripts/verify-dialog-accept.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCanvasGlobals } from './nodeCanvasGlobals';
import { gameContext } from './nodeGameContext';
import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { setViewportSize } from '../src/core/Viewport';
import {
  createAnchorQuestProgress,
  type AnchorQuestProgress,
} from '../src/core/AnchorQuestProgress';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { Conversation } from '../src/dialog/Conversation';
import { speakerLines, type NonEmpty } from '../src/dialog/line';
import type { Choice, ConversationRequest, ConversationTopic } from '../src/dialog/request';
import { topicMenu } from '../src/dialog/topics';
import { GameMap } from '../src/map/GameMap';
import {
  AnchorInteriorSystem,
  HILDA_COTTAGE_NAME,
  SKY_TEMPLE_NAME,
} from '../src/systems/AnchorInteriorSystem';
import { AnchorQuestSystem } from '../src/systems/AnchorQuestSystem';
import { RewardGrantedDialog } from '../src/ui/RewardGrantedDialog';
import { UiRoot } from '../src/ui/core/UiRoot';
import { NO_INSETS } from '../src/ui/core/viewport';
import { rewardGrantedSurface } from '../src/ui/screens/dialogs/rewardGrantedDialog';
import { createBriarHollowState } from '../src/core/briarHollowState';
import { createCircusQuestProgress } from '../src/core/CircusQuestProgress';
import { mountConversation, type ConversationRig } from './conversationHarness';
import { buildSiegeRig } from './villageSiegeHarness';

// ── Reporting ────────────────────────────────────────────────────────────────

let failures = 0;
/** Frames the reward card may take to reach its OK before the check gives up. */
const MAX_REWARD_CARD_FRAMES = 600;
const UI_FRAME_MS = 16;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── The frame loop and the Space key ─────────────────────────────────────────

const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 640;
/** Frames between presses — short enough that some presses land mid-typing and skip it, as an impatient reader's do. */
const FRAMES_BETWEEN_PRESSES = 3;
/** More presses than any conversation here has pages; a walk that hits it is stuck. */
const PRESS_GUARD = 80;
const ROOM_TILE = { x: 3, y: 3 } as const;
const PLENTY_OF_COINS = 500;

installCanvasGlobals();
setViewportSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
const ctx = gameContext(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

interface PressTally {
  ring: number;
  overlay: number;
}

interface Pointer {
  readonly x: number;
  readonly y: number;
}

/** A conversation and the root it is mounted on. */
interface Rig {
  readonly conversation: Conversation;
  readonly ui: ConversationRig;
}

function rigFor(conversation: Conversation): Rig {
  return { conversation, ui: mountConversation(conversation, ctx) };
}

/** One tick and one drawn frame, the mouse resting at `pointer` or (null) off the canvas. */
function frame(rig: Rig, pointer: Pointer | null = null): void {
  rig.ui.pointAt(pointer);
  rig.conversation.update(null);
  rig.ui.frame();
}

/** One fresh Space press, counted by whether the root's focus ring held any of the conversation's choices when it landed. */
function pressSpace(rig: Rig, tally: PressTally): void {
  if (rig.ui.focusRingSize() > 0) tally.ring++;
  else tally.overlay++;
  rig.ui.key(' ');
}

/** Presses Space, and nothing else, until the conversation closes — the pointer never moving from `pointer`. */
function spaceUntilClosed(rig: Rig, pointer: Pointer | null = null): PressTally {
  const tally: PressTally = { ring: 0, overlay: 0 };
  for (let press = 0; press < PRESS_GUARD && rig.conversation.isOpen; press++) {
    for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(rig, pointer);
    pressSpace(rig, tally);
  }
  return tally;
}

/** A click on the middle of a choice button as last drawn. */
function clickChoice(rig: Rig, rect: { x: number; y: number; w: number; h: number }): void {
  rig.ui.tap(rect.x + rect.w / 2, rect.y + rect.h / 2);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface Party {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}

function makeParty(): Party {
  return {
    human: new HumanPlayer(ROOM_TILE.x, ROOM_TILE.y, TILE_SIZE),
    cat: new CatPlayer(ROOM_TILE.x + 1, ROOM_TILE.y, TILE_SIZE),
  };
}

function makeVoss(progress: AnchorQuestProgress, party: Party, conversation: Conversation) {
  return new AnchorQuestSystem(
    new EventBus(),
    progress,
    () => ({ human: party.human, cat: party.cat }),
    () => null,
    () => null,
    () => null,
    () => undefined,
    conversation,
    {
      circus: createCircusQuestProgress(),
      briarHollow: createBriarHollowState(),
      anchor: progress,
    },
    null,
  );
}

function makeRoom(
  buildingName: string,
  progress: AnchorQuestProgress,
  party: Party,
  conversation: Conversation,
): AnchorInteriorSystem | null {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('house', 0, buildingName, false);
  return AnchorInteriorSystem.forBuilding(
    buildingName,
    0,
    progress,
    map,
    () => [party.human, party.cat],
    () => undefined,
    () => undefined,
    conversation,
    null,
  );
}

/**
 * Read back through a call so the compiler does not carry a narrowing from the
 * line that set the step across the conversation that changes it.
 */
function stepOf(progress: AnchorQuestProgress, giver: 'hilda' | 'temple'): string {
  return progress[giver];
}

function activeProgress(): AnchorQuestProgress {
  const progress = createAnchorQuestProgress();
  progress.status = 'active';
  return progress;
}

// ── Madame Voss ──────────────────────────────────────────────────────────────

function verifyVossOffer(): void {
  section('Madame Voss: Space through the offer takes the errand');
  const conversation = new Conversation(null);
  const progress = createAnchorQuestProgress();
  const party = makeParty();
  const voss = makeVoss(progress, party, conversation);
  const rig = rigFor(conversation);
  check(voss.tryOpenDialog(party.human), 'the offer opens');
  const tally = spaceUntilClosed(rig);
  check(progress.status === 'active', `the quest is accepted (status: ${progress.status})`);
  check(
    tally.ring > 0,
    `the confirm row was answered through its focus ring (${tally.ring} ring presses)`,
  );
}

const VOSS_PAY_LABEL_PREFIX = 'Pay';

function verifyVossAssembly(): void {
  section('Madame Voss: Space never pays her fee; aiming at "Pay" does');
  const conversation = new Conversation(null);
  const progress = activeProgress();
  progress.tinker = 'done';
  progress.hilda = 'done';
  progress.temple = 'done';
  const party = makeParty();
  party.human.inventory.addItem('anchor_shard_tinker', 1);
  party.human.inventory.addItem('anchor_shard_hilda', 1);
  party.human.inventory.addItem('anchor_shard_temple', 1);
  party.human.coins = PLENTY_OF_COINS;
  const voss = makeVoss(progress, party, conversation);
  const rig = rigFor(conversation);
  check(voss.tryOpenDialog(party.human), 'the assembly opens');
  spaceUntilClosed(rig);
  check(
    conversation.isOpen && conversation.isShowingChoices,
    'Space alone leaves the fee row standing',
  );
  check(
    progress.status === 'active' && party.human.coins === PLENTY_OF_COINS,
    `and nothing is paid (status: ${progress.status}, coins: ${party.human.coins})`,
  );
  frame(rig);
  const pay = conversation.choiceBounds.find((rect) => rect.label.includes(VOSS_PAY_LABEL_PREFIX));
  check(pay !== undefined, 'the "Pay" button is on screen');
  if (pay === undefined) return;
  clickChoice(rig, pay);
  spaceUntilClosed(rig);
  check(
    progress.status === 'completed',
    `a click on it makes the stone (status: ${progress.status})`,
  );
}

/**
 * A cursor left lying where "Pay" will appear is not a player aiming at it:
 * the fee row must still come up with nothing focused, so Space pays nothing.
 * Only a pointer that moves onto a choice may take focus.
 */
function verifyRestingPointerDoesNotPay(): void {
  section('Madame Voss: a cursor resting where "Pay" appears does not make Space pay');
  const setUp = () => {
    const conversation = new Conversation(null);
    const progress = activeProgress();
    progress.tinker = 'done';
    progress.hilda = 'done';
    progress.temple = 'done';
    const party = makeParty();
    party.human.inventory.addItem('anchor_shard_tinker', 1);
    party.human.inventory.addItem('anchor_shard_hilda', 1);
    party.human.inventory.addItem('anchor_shard_temple', 1);
    party.human.coins = PLENTY_OF_COINS;
    const voss = makeVoss(progress, party, conversation);
    return { conversation, progress, party, voss, rig: rigFor(conversation) };
  };

  const scout = setUp();
  scout.voss.tryOpenDialog(scout.party.human);
  spaceUntilClosed(scout.rig);
  frame(scout.rig);
  const pay = scout.conversation.choiceBounds.find((rect) =>
    rect.label.includes(VOSS_PAY_LABEL_PREFIX),
  );
  check(pay !== undefined, 'the "Pay" button has a place on screen to rest on');
  if (pay === undefined) return;
  const restingOnPay: Pointer = { x: pay.x + pay.w / 2, y: pay.y + pay.h / 2 };

  const run = setUp();
  check(run.voss.tryOpenDialog(run.party.human), 'the assembly opens under the resting cursor');
  const tally = spaceUntilClosed(run.rig, restingOnPay);
  check(
    run.conversation.isOpen && run.conversation.isShowingChoices,
    'Space alone leaves the fee row standing',
  );
  check(
    run.progress.status === 'active' && run.party.human.coins === PLENTY_OF_COINS,
    `and nothing is paid (status: ${run.progress.status}, coins: ${run.party.human.coins})`,
  );
  check(tally.ring > 0, `the row's presses went through its focus ring (${tally.ring})`);
  check(
    run.conversation.selectedChoiceIndex === null,
    `and no choice is drawn selected (selected: ${run.conversation.selectedChoiceIndex})`,
  );
}

// ── Old Hilda and Deacon Aviel ───────────────────────────────────────────────

function verifyHilda(): void {
  section(
    'Old Hilda: Space through her terms takes the job, and through her thanks takes the shard',
  );
  const conversation = new Conversation(null);
  const progress = activeProgress();
  const party = makeParty();
  const room = makeRoom(HILDA_COTTAGE_NAME, progress, party, conversation);
  if (room === null) {
    check(false, "Old Hilda's cottage has a questline system");
    return;
  }
  const rig = rigFor(conversation);
  check(room.tryOpenDialog('old_hilda', party.human), 'her request opens');
  const tally = spaceUntilClosed(rig);
  check(progress.hilda === 'in_progress', `the repair job is accepted (hilda: ${progress.hilda})`);
  check(
    tally.ring > 0,
    `her terms were answered through the focus ring (${tally.ring} ring presses)`,
  );

  progress.hilda = 'shard_owed';
  check(room.tryOpenDialog('old_hilda', party.human), 'her thanks open');
  spaceUntilClosed(rig);
  const hildaAfterThanks = stepOf(progress, 'hilda');
  check(hildaAfterThanks === 'done', `the shard is handed over (hilda: ${hildaAfterThanks})`);
  check(party.human.inventory.countOf('anchor_shard_hilda') === 1, 'and it is in the bag');

  section('Old Hilda: Escape is the way out, and it agrees to nothing');
  const fresh = activeProgress();
  const escRoom = makeRoom(HILDA_COTTAGE_NAME, fresh, party, conversation);
  if (escRoom === null) return;
  escRoom.tryOpenDialog('old_hilda', party.human);
  frame(rig);
  check(escRoom.dismissDialog(), 'Escape reaches her conversation');
  check(!conversation.isOpen, 'and closes it');
  check(fresh.hilda === 'offered', `without taking the job (hilda: ${fresh.hilda})`);
}

function verifyAviel(): void {
  section(
    'Deacon Aviel: Space through his terms takes the job, and through his thanks takes the shard',
  );
  const conversation = new Conversation(null);
  const progress = activeProgress();
  const party = makeParty();
  const room = makeRoom(SKY_TEMPLE_NAME, progress, party, conversation);
  if (room === null) {
    check(false, 'the Temple of the Sky has a questline system');
    return;
  }
  const rig = rigFor(conversation);
  check(room.tryOpenDialog('deacon_aviel', party.human), 'his request opens');
  spaceUntilClosed(rig);
  check(progress.temple !== 'offered', `the vermin job is accepted (temple: ${progress.temple})`);

  progress.temple = 'shard_owed';
  check(room.tryOpenDialog('deacon_aviel', party.human), 'his thanks open');
  spaceUntilClosed(rig);
  const templeAfterThanks = stepOf(progress, 'temple');
  check(templeAfterThanks === 'done', `the shard is handed over (temple: ${templeAfterThanks})`);
}

// ── Choice rows in general ───────────────────────────────────────────────────

const narrator = speakerLines('narrator');

function rowRequest(choices: NonEmpty<Choice>, haltsWorld: boolean): ConversationRequest {
  return {
    lines: [narrator.line('A question for the player.')],
    reward: null,
    questRelated: false,
    ending: { kind: 'choices', choices },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld,
    anchor: null,
    locksKeyboard: true,
  };
}

/** What a choice row's `run` recorded; read through the object so a pick made inside a call is not narrowed away. */
interface PickRecord {
  picked: string | null;
}

/** Which label a lone Space press picks on `choices`, or null when it picks none. */
function spacePicks(choices: NonEmpty<Choice>, haltsWorld: boolean): string | null {
  const conversation = new Conversation(null);
  const record: PickRecord = { picked: null };
  const recorded = choices.map((choice): Choice => ({
    ...choice,
    run: (convo) => {
      record.picked = choice.label;
      convo.close();
    },
  }));
  const [first, ...rest] = recorded;
  const rig = rigFor(conversation);
  conversation.open(rowRequest([first, ...rest], haltsWorld));
  for (
    let press = 0;
    press < PRESS_GUARD && conversation.isOpen && record.picked === null;
    press++
  ) {
    for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(rig);
    // Stops at the first press that lands on the row: a row whose default is
    // "nothing" must read as nothing, not as whatever a later press did.
    const rowWasUp = conversation.isShowingChoices;
    pressSpace(rig, { ring: 0, overlay: 0 });
    if (rowWasUp) break;
  }
  return record.picked;
}

const noop = (): void => undefined;

function choice(label: string, tone: Choice['tone'], keyboard?: Choice['keyboard']): Choice {
  return keyboard === undefined ? { label, tone, run: noop } : { label, tone, keyboard, run: noop };
}

function verifyDefaultResolution(): void {
  section('Choice rows: Space takes the accepting option, never the way out');
  for (const haltsWorld of [true, false]) {
    const where = haltsWorld ? 'world-halting' : 'street';
    const leaveFirst = spacePicks(
      [choice('Leave', 'exit'), choice('Tell me more', 'normal')],
      haltsWorld,
    );
    check(
      leaveFirst === 'Tell me more',
      `${where}: a way out listed first is passed over (picked ${leaveFirst})`,
    );
    const questFirst = spacePicks(
      [choice('Chat', 'normal'), choice('About the job', 'quest'), choice('Goodbye', 'exit')],
      haltsWorld,
    );
    check(
      questFirst === 'About the job',
      `${where}: the quest option outranks small talk (picked ${questFirst})`,
    );
    const marked = spacePicks(
      [choice('Buy one', 'normal', 'default'), choice('About the job', 'quest')],
      haltsWorld,
    );
    check(marked === 'Buy one', `${where}: a choice marked 'default' wins (picked ${marked})`);
    const guarded = spacePicks(
      [
        choice('Wager it all', 'quest', 'never'),
        choice('Watch', 'normal'),
        choice('Leave', 'exit'),
      ],
      haltsWorld,
    );
    check(guarded === 'Watch', `${where}: a choice marked 'never' is skipped (picked ${guarded})`);
    const nothingSafe = spacePicks(
      [choice('Wager it all', 'quest', 'never'), choice('Leave', 'exit')],
      haltsWorld,
    );
    check(
      nothingSafe === null,
      `${where}: with only a guarded option and a way out, Space picks nothing (picked ${nothingSafe})`,
    );
    const onlyOut = spacePicks([choice('Back', 'exit')], haltsWorld);
    check(
      onlyOut === 'Back',
      `${where}: a row that is only a way out still lets Space through (picked ${onlyOut})`,
    );
  }
}

function verifyTopicMenu(): void {
  section("A speaker's topic menu: Space asks about the quest, not Goodbye");
  const spent = new Set<string>();
  const asked: string[] = [];
  const topic = (key: string, tone: ConversationTopic['tone']): ConversationTopic => ({
    key,
    label: key,
    tone,
    repeatable: false,
    grouping: 'root',
    run: (convo) => {
      asked.push(key);
      convo.close();
    },
  });
  const goodbye: Choice = { label: 'Goodbye', tone: 'exit', run: (convo) => convo.close() };
  const choices = topicMenu(
    [topic('Weather', 'normal'), topic('The missing cow', 'quest')],
    spent,
    goodbye,
    (row) => rowRequest(row, false),
  );
  const conversation = new Conversation(null);
  const rig = rigFor(conversation);
  conversation.open(rowRequest(choices, false));
  spaceUntilClosed(rig);
  check(
    asked.join() === 'The missing cow',
    `Space picked the quest topic (asked: ${asked.join() || 'nothing'})`,
  );
}

/**
 * On a row that leaves the world running there is no focus ring: Space always
 * takes the row's default, so that is the choice drawn selected even while
 * the pointer hovers another one.
 */
function verifyStreetRowMarksSpaceDefault(): void {
  section('A street row marks what Space picks, wherever the pointer hovers');
  const conversation = new Conversation(null);
  const record: PickRecord = { picked: null };
  const recording = (label: string, tone: Choice['tone']): Choice => ({
    label,
    tone,
    run: (convo) => {
      record.picked = label;
      convo.close();
    },
  });
  const askLabel = 'Ask about the well';
  const goodbyeLabel = 'Goodbye';
  const rig = rigFor(conversation);
  conversation.open(
    rowRequest([recording(askLabel, 'normal'), recording(goodbyeLabel, 'exit')], false),
  );
  for (let press = 0; press < PRESS_GUARD; press++) {
    for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(rig);
    // Checked after the frames, not before the press: the row can come up
    // during a frame, and a press then would already answer it.
    if (conversation.isShowingChoices) break;
    rig.ui.key(' ');
  }
  frame(rig);
  const goodbye = conversation.choiceBounds.find((rect) => rect.label.includes(goodbyeLabel));
  check(goodbye !== undefined, 'the Goodbye button is on screen');
  if (goodbye === undefined) return;
  const onGoodbye: Pointer = { x: goodbye.x + goodbye.w / 2, y: goodbye.y + goodbye.h / 2 };
  for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(rig, onGoodbye);

  const askIndex = 0;
  const marked = conversation.choiceBounds.filter((rect) => rect.label.startsWith('▶'));
  check(
    conversation.selectedChoiceIndex === askIndex,
    `with the pointer on Goodbye, "${askLabel}" is still drawn selected (selected: ${conversation.selectedChoiceIndex})`,
  );
  check(
    marked.length === 1 && marked[0]?.index === askIndex,
    `and it alone wears the marker (marked: ${marked.map((rect) => rect.label).join(', ') || 'none'})`,
  );
  rig.ui.key(' ');
  check(record.picked === askLabel, `and Space picks it (picked: ${record.picked ?? 'nothing'})`);
}

/**
 * On a world-halting row the selected look is the focus ring's entry, and a
 * pointer that moves onto a choice takes the focus with it: Space then
 * answers with what the player is pointing at.
 */
function verifyPointerMovesHaltingFocus(): void {
  section('A world-halting row: a pointer moved onto a choice is what Space takes');
  const conversation = new Conversation(null);
  const record: PickRecord = { picked: null };
  const recording = (label: string, tone: Choice['tone']): Choice => ({
    label,
    tone,
    run: (convo) => {
      record.picked = label;
      convo.close();
    },
  });
  const askLabel = 'Ask about the well';
  const goodbyeLabel = 'Goodbye';
  const rig = rigFor(conversation);
  conversation.open(
    rowRequest([recording(askLabel, 'normal'), recording(goodbyeLabel, 'exit')], true),
  );
  for (let press = 0; press < PRESS_GUARD; press++) {
    frame(rig);
    if (conversation.isShowingChoices) break;
    rig.ui.key(' ');
  }
  frame(rig);
  const goodbye = conversation.choiceBounds.find((rect) => rect.label.includes(goodbyeLabel));
  check(goodbye !== undefined, 'the Goodbye button is on screen');
  if (goodbye === undefined) return;
  const goodbyeIndex = 1;
  check(
    selectedOf(conversation) !== goodbyeIndex,
    `before the pointer moves, the default is selected (selected: ${selectedOf(conversation)})`,
  );
  frame(rig, { x: goodbye.x + goodbye.w / 2, y: goodbye.y + goodbye.h / 2 });
  frame(rig, { x: goodbye.x + goodbye.w / 2, y: goodbye.y + goodbye.h / 2 });
  check(
    selectedOf(conversation) === goodbyeIndex,
    `the pointer on Goodbye selects it (selected: ${selectedOf(conversation)})`,
  );
  rig.ui.key(' ');
  check(
    record.picked === goodbyeLabel,
    `and Space takes it (picked: ${record.picked ?? 'nothing'})`,
  );
}

/** The box lays out in canvas pixels under any UI size; its regions must land where it draws. */
function verifyClickLandsAtLargeUiSize(): void {
  section('At a large UI size a click on a choice still lands on that choice');
  const conversation = new Conversation(null);
  const record: PickRecord = { picked: null };
  const recording = (label: string): Choice => ({
    label,
    tone: 'normal',
    run: (convo) => {
      record.picked = label;
      convo.close();
    },
  });
  const rig: Rig = { conversation, ui: mountConversation(conversation, ctx, { uiSize: 'large' }) };
  const lastLabel = 'Third';
  conversation.open(
    rowRequest([recording('First'), recording('Second'), recording(lastLabel)], true),
  );
  for (let press = 0; press < PRESS_GUARD; press++) {
    frame(rig);
    if (conversation.isShowingChoices) break;
    rig.ui.key(' ');
  }
  frame(rig);
  const last = conversation.choiceBounds.find((rect) => rect.label.includes(lastLabel));
  check(last !== undefined, 'the last choice is on screen');
  if (last === undefined) return;
  clickChoice(rig, last);
  check(record.picked === lastLabel, `the click picks it (picked: ${record.picked ?? 'nothing'})`);
}

// ── A held key does not answer a row it predates ─────────────────────────────

function confirmRequest(onAccept: () => void): ConversationRequest {
  return {
    lines: [narrator.line('Short.')],
    reward: null,
    questRelated: true,
    ending: {
      kind: 'confirm',
      keyboardDefault: 'accept',
      accept: { label: 'Yes', tone: 'quest', run: onAccept },
      decline: { label: 'No', tone: 'exit', run: (convo) => convo.close() },
    },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: true,
    anchor: null,
    locksKeyboard: true,
  };
}

const CONFIRM_DECLINE_INDEX = 0;
const CONFIRM_ACCEPT_INDEX = 1;

/** Read back through a call, so a selection changed by the frame just run is not narrowed away. */
function selectedOf(conversation: Conversation): number | null {
  return conversation.selectedChoiceIndex;
}

function verifyHeldKeyDoesNotConfirm(): void {
  section('A press that finishes a page never also answers the row it opens');
  const conversation = new Conversation(null);
  const rig = rigFor(conversation);
  let accepted = 0;
  conversation.open(confirmRequest(() => accepted++));
  rig.ui.frame();
  // Skip the typing, then the very next press arrives before the row has
  // ever been drawn — both must leave the accept side untouched.
  conversation.advance();
  conversation.update(null);
  conversation.advance();
  check(conversation.isShowingChoices, 'the confirm row is up');
  check(accepted === 0, 'but nothing was accepted before the row was drawn');
  rig.ui.key(' ');
  check(accepted === 0, 'nor by a Space that lands before the row is drawn');

  frame(rig);
  check(rig.ui.focusRingSize() === 2, `the row is the focus ring (${rig.ui.focusRingSize()})`);
  rig.ui.key(' ', { repeat: true });
  check(accepted === 0, 'an auto-repeat of a Space held from the page confirms nothing');
  rig.ui.key(' ', { predatesSurface: true });
  check(accepted === 0, 'nor does a Space already held when the row appeared');
  rig.ui.key(' ');
  check(accepted === 1, `a fresh Space takes the accept side (accepted ${accepted})`);

  rig.ui.key('ArrowLeft');
  frame(rig);
  const movedTo = selectedOf(conversation);
  check(
    movedTo === CONFIRM_DECLINE_INDEX,
    `the arrow key steps off the default onto the decline side (selected: ${movedTo})`,
  );

  conversation.open(confirmRequest(() => accepted++));
  for (let press = 0; press < PRESS_GUARD && !conversation.isShowingChoices; press++) {
    frame(rig);
    conversation.advance();
  }
  frame(rig);
  const nextRowSelected = selectedOf(conversation);
  check(
    nextRowSelected === CONFIRM_ACCEPT_INDEX,
    `a later row starts on its own default, not where focus was left (selected: ${nextRowSelected})`,
  );
}

/** Opens a world-halting row of `labels` on `rig` and frames until it is drawn. */
function openRow(rig: Rig, labels: NonEmpty<string>): void {
  const [first, ...rest] = labels.map((label) => choice(label, 'normal'));
  rig.conversation.open(rowRequest([first, ...rest], true));
  for (let press = 0; press < PRESS_GUARD && !rig.conversation.isShowingChoices; press++) {
    frame(rig);
    rig.conversation.advance();
  }
  frame(rig);
}

const WRAPPING_ROW: NonEmpty<string> = ['First', 'Second', 'Third', 'Fourth'];
/** Faster than the throttle: the OS auto-repeat stream's pace. */
const KEY_REPEAT_GAP_MS = 33;
/** Comfortably past the throttle, so the next repeat may step again. */
const PAST_THROTTLE_MS = 200;
const START_STAMP_MS = 1000;
/** Auto-repeats sent per check: enough that an unthrottled stream would visibly walk the row. */
const REPEATS_PER_CHECK = 3;
/** A canvas point clear of the box and its row, where a click goes past the conversation. */
const PAST_THE_BOX: Pointer = { x: 4, y: 4 };

function verifyChoiceRowKeyboard(): void {
  section('Choice rows: arrows walk a wrapped row, at a readable pace, and only on fresh presses');
  const conversation = new Conversation(null);
  const rig = rigFor(conversation);
  openRow(rig, WRAPPING_ROW);
  const rowLines = new Set(conversation.choiceBounds.map((placed) => placed.y)).size;
  check(rowLines > 1, `the four-choice row wraps onto ${rowLines} lines`);
  const visited: Array<number | null> = [selectedOf(conversation)];
  for (let step = 1; step < WRAPPING_ROW.length; step++) {
    rig.ui.key('ArrowRight');
    frame(rig);
    visited.push(selectedOf(conversation));
  }
  check(
    visited.join() === '0,1,2,3',
    `ArrowRight reaches every choice, the wrapped ones too (visited ${visited.join()})`,
  );

  openRow(rig, WRAPPING_ROW);
  let stamp = START_STAMP_MS;
  rig.ui.key('ArrowRight', { timeStamp: stamp });
  frame(rig);
  const afterFresh = selectedOf(conversation);
  for (let repeat = 0; repeat < REPEATS_PER_CHECK; repeat++) {
    stamp += KEY_REPEAT_GAP_MS;
    rig.ui.key('ArrowRight', { repeat: true, timeStamp: stamp });
    frame(rig);
  }
  const afterFastRepeats = selectedOf(conversation);
  check(
    afterFresh === 1 && afterFastRepeats === 1,
    `repeats inside the throttle do not step (fresh: ${afterFresh}, after repeats: ${afterFastRepeats})`,
  );
  stamp += PAST_THROTTLE_MS;
  rig.ui.key('ArrowRight', { repeat: true, timeStamp: stamp });
  frame(rig);
  check(
    selectedOf(conversation) === 2,
    `a repeat past the throttle steps once (selected: ${selectedOf(conversation)})`,
  );

  const [first, ...rest] = WRAPPING_ROW.map((label) => choice(label, 'normal'));
  conversation.open({
    ...rowRequest([first, ...rest], true),
    lines: [narrator.line('A line read before the question.'), narrator.line('The question.')],
  });
  frame(rig);
  check(rig.ui.focusRingSize() === 0, 'the first line shows no row yet');
  rig.ui.key('ArrowRight', { timeStamp: START_STAMP_MS });
  for (let press = 0; press < PRESS_GUARD && !conversation.isShowingChoices; press++) {
    frame(rig);
    conversation.advance();
  }
  frame(rig);
  stamp = START_STAMP_MS;
  for (let repeat = 0; repeat < REPEATS_PER_CHECK; repeat++) {
    stamp += PAST_THROTTLE_MS;
    rig.ui.key('ArrowRight', { repeat: true, timeStamp: stamp });
    frame(rig);
  }
  check(
    selectedOf(conversation) === 0,
    `an arrow held from the last line does not walk the row it opens (selected: ${selectedOf(conversation)})`,
  );
}

function verifyClickPastTheBoxKeepsSelection(): void {
  section('A click past the box (a HUD button) leaves the row selection where it was');
  const conversation = new Conversation(null);
  let pastClicks = 0;
  const rig: Rig = {
    conversation,
    ui: mountConversation(conversation, ctx, { offBoxClick: () => pastClicks++ }),
  };
  openRow(rig, WRAPPING_ROW);
  rig.ui.key('ArrowRight');
  frame(rig);
  check(
    selectedOf(conversation) === 1,
    `the arrow moved the selection (${selectedOf(conversation)})`,
  );
  rig.ui.tap(PAST_THE_BOX.x, PAST_THE_BOX.y);
  frame(rig);
  check(pastClicks === 1, `the click went past the box (${pastClicks})`);
  check(
    selectedOf(conversation) === 1,
    `the marker stays on the chosen option (selected: ${selectedOf(conversation)})`,
  );
}

// ── Source checks ────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** A private method's body in `source`: from its signature to the first brace back at its own indent. */
function methodBody(source: string, name: string): string | null {
  const match = new RegExp(`\\n  private ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`).exec(
    source,
  );
  return match?.[1] ?? null;
}

function verifyInteriorEscapeSource(): void {
  section('Interior: Escape reaches the conversation');
  const source = readFileSync(join(REPO_ROOT, 'src/scenes/BuildingInteriorScene.ts'), 'utf8');
  const escapeBody = methodBody(source, 'conversationEscape');
  check(escapeBody !== null, 'the interior names what Escape does to its conversation');
  check(
    escapeBody?.includes('openResidentQuestHook()') === true &&
      escapeBody.includes('.dismissDialog()'),
    "Escape's dismiss chain includes the resident questlines' conversations",
  );
  check(
    source.includes('dismiss: () => this.conversationEscape()?.()') &&
      source.includes('wantsEscape: () => this.conversationEscape() !== null'),
    "the conversation's surface hands Escape to that chain",
  );
}

const CONFIRM_DEFAULT = /keyboardDefault:\s*'([a-z]+)'/g;
/** The confirm rows whose accept side spends something, so Space must do nothing on them. */
const GUARDED_CONFIRM_FILES: ReadonlySet<string> = new Set(['src/systems/AnchorQuestSystem.ts']);
const GUARDED_CONFIRMS_PER_FILE = 1;

function verifyConfirmDefaults(): void {
  section('Every confirm row defaults Space to its accept side, unless accepting spends coin');
  let found = 0;
  const guardedFound = new Map<string, number>();
  for (const path of listSourceFiles(join(REPO_ROOT, 'src'))) {
    for (const match of readFileSync(path, 'utf8').matchAll(CONFIRM_DEFAULT)) {
      found++;
      const where = path.slice(REPO_ROOT.length + 1);
      if (match[1] === 'none' && GUARDED_CONFIRM_FILES.has(where)) {
        guardedFound.set(where, (guardedFound.get(where) ?? 0) + 1);
        continue;
      }
      check(match[1] === 'accept', `${where}: keyboardDefault '${match[1]}'`);
    }
  }
  check(found > 0, `confirm rows are found (${found})`);
  for (const where of GUARDED_CONFIRM_FILES) {
    const count = guardedFound.get(where) ?? 0;
    check(
      count === GUARDED_CONFIRMS_PER_FILE,
      `${where}: ${count} spending row(s) keep Space off their accept side`,
    );
  }
}

// ── Briar Hollow: the Mayor's "I'm ready" ────────────────────────────────────

const BRIAR_HOLLOW_SEED = 7919;
const BRIAR_HOLLOW_ASSAULT_LEVEL = 6;
const READY_LABEL = "I'm ready";
const MORE_TIME_LABEL = 'I need more time';
/** Enough presses to skip the typing and turn every page up to the Mayor's choice row. */
const READ_THROUGH_GUARD = 40;

/** Read back through a call, so a row raised by the frame just run is not narrowed away. */
function showingChoices(conversation: Conversation): boolean {
  return conversation.isShowingChoices;
}

/** Read back through a call, so the phase set before the press is not narrowed across it. */
function phaseOf(state: ReturnType<typeof createBriarHollowState>): string {
  return state.quest.phase;
}

function verifyMayorReadyIsGuarded(): void {
  section('Briar Hollow: Space asks the Mayor for more time, never starts the siege');
  const state = createBriarHollowState();
  state.quest.phase = 'fortifying';
  state.unlocks.soldierCommands = true;
  const rig = buildSiegeRig({
    seed: BRIAR_HOLLOW_SEED,
    assaultLevel: BRIAR_HOLLOW_ASSAULT_LEVEL,
    state,
  });
  const villagers = rig.kit.villagers;
  const mayor = villagers?.villagerFor('bramblewick') ?? null;
  if (villagers === null || mayor === null) {
    check(false, 'the village and its Mayor are built');
    return;
  }
  const conversation = villagers.conversation;
  rig.human.x = mayor.x;
  rig.human.y = mayor.y;
  rig.kit.tryInteract(rig.human, false);
  for (
    let press = 0;
    press < READ_THROUGH_GUARD && conversation.isOpen && !conversation.isShowingChoices;
    press++
  ) {
    conversation.update(null);
    if (showingChoices(conversation)) break;
    conversation.advance();
  }
  check(
    conversation.choiceLabels.includes(READY_LABEL),
    `the "${READY_LABEL}" row is on offer (${conversation.choiceLabels.join(' / ')})`,
  );
  const spacePick = conversation.keyboardDefaultLabel;
  check(spacePick !== READY_LABEL, `Space does not pick "${READY_LABEL}" (picks ${spacePick})`);
  check(spacePick === MORE_TIME_LABEL, `Space picks "${MORE_TIME_LABEL}" (picks ${spacePick})`);

  const tally: PressTally = { ring: 0, overlay: 0 };
  const mayorRig = rigFor(conversation);
  frame(mayorRig);
  pressSpace(mayorRig, tally);
  const phaseAfter = phaseOf(state);
  check(
    phaseAfter === 'fortifying',
    `a Space press leaves the village fortifying (phase: ${phaseAfter})`,
  );
}

/**
 * The reward card is a world-halting modal for its whole life — the reveal as
 * well as the OK — and owns the keyboard as the top surface while it is up.
 * Space during the reveal is swallowed rather than reaching whatever is
 * beneath; once OK is up, Space takes it.
 */
function verifyRewardCardOwnsSpace(): void {
  section('The reward card owns Space on every frame it is up');
  const dialog = new RewardGrantedDialog();
  dialog.enqueue({
    kind: 'ability',
    name: 'Test Reward',
    description: 'A reward granted to check the card keeps its promise to the keyboard.',
    renderIcon: () => undefined,
  });
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: VIEWPORT_WIDTH,
      cssHeight: VIEWPORT_HEIGHT,
      density: 'pointer',
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => clock,
    warn: () => undefined,
  });
  root.mount(rewardGrantedSurface('reward-granted', dialog));
  let frames = 0;
  let revealFrames = 0;
  let leaked = 0;
  const revealing = (): boolean => dialog.view?.settled === false;
  while (revealing() && frames < MAX_REWARD_CARD_FRAMES) {
    dialog.update();
    clock += UI_FRAME_MS;
    root.frame(ctx);
    if (revealing()) {
      revealFrames++;
      if (root.key(' ', {}) !== 'consumed') leaked++;
    }
    frames++;
  }
  check(revealFrames > 0, `the card has a reveal before its OK (${revealFrames} frame(s))`);
  check(leaked === 0, `Space during the reveal is the card's (${leaked} press(es) leaked)`);
  check(dialog.isShowing, 'Space during the reveal does not close the card');
  clock += UI_FRAME_MS;
  root.frame(ctx);
  check(root.key(' ', {}) === 'consumed', 'Space is taken once OK is up');
  check(!dialog.isShowing, 'Space on OK closes the card');
}

verifyRewardCardOwnsSpace();
verifyVossOffer();
verifyVossAssembly();
verifyRestingPointerDoesNotPay();
verifyHilda();
verifyAviel();
verifyDefaultResolution();
verifyTopicMenu();
verifyStreetRowMarksSpaceDefault();
verifyPointerMovesHaltingFocus();
verifyClickLandsAtLargeUiSize();
verifyHeldKeyDoesNotConfirm();
verifyChoiceRowKeyboard();
verifyClickPastTheBoxKeepsSelection();
verifyConfirmDefaults();
verifyInteriorEscapeSource();
verifyMayorReadyIsGuarded();

console.log(
  failures === 0 ? '\nAll dialog-accept checks passed.' : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
