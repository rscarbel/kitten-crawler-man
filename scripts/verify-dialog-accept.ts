#!/usr/bin/env tsx
/**
 * A player who only ever presses Space gets *through* a conversation: every
 * page turns, and every choice or confirm row it opens onto is answered with
 * its accepting option — never with the way out. Escape is the only key that
 * leaves.
 *
 * Driven through the real `Conversation`, the real quest systems that open it,
 * and the real focus ring in `ui/Button`. A Space press is routed the way the
 * browser routes it:
 *
 *   - While the last rendered frame declared a focus ring with buttons in it,
 *     `SceneManager.handleMenuNavigation` takes the press in the capture phase
 *     and synthesizes a click on `focusedButtonClickPoint()`, which the scene
 *     hands to the owning system's `handleClick`.
 *   - Otherwise the press reaches `GameplayInputHandler`, whose `advanceDialog`
 *     is `advanceFocusedOverlay` over the scene's claims — here, the
 *     conversation's own claim.
 *
 * Both of those ignore an OS auto-repeat, so every press here is a fresh one.
 *
 * Also checked:
 *   - The press that finishes a page never also answers the row that page
 *     opens onto, and each row declares a focus ring distinct from the page
 *     before it and from the row before it — the identity change the scene's
 *     key handler snapshots held keys on, so a Space still held down from
 *     earlier cannot confirm the new row.
 *   - The interior scene does not poll the held Space key to close the Anchor
 *     conversation, and Escape reaches that conversation.
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
import { advanceFocusedOverlay, auditOverlayFocus } from '../src/systems/kits/OverlayClaims';
import { RewardGrantedDialog } from '../src/ui/RewardGrantedDialog';
import { createBriarHollowState } from '../src/core/briarHollowState';
import { buildSiegeRig } from './villageSiegeHarness';
import {
  focusedButtonClickPoint,
  menuFocusContextId,
  menuFocusRingSize,
  setButtonMouseState,
} from '../src/ui/Button';

// ── Reporting ────────────────────────────────────────────────────────────────

let failures = 0;
/** Frames the reward card may take to reach its OK before the check gives up. */
const MAX_REWARD_CARD_FRAMES = 600;

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
/** Where the pointer rests: nowhere near a button, so hover never decides anything. */
const POINTER_OFF_CANVAS = -1;
/** Frames between presses — short enough that some presses land mid-typing and skip it, as an impatient reader's do. */
const FRAMES_BETWEEN_PRESSES = 3;
/** More presses than any conversation here has pages; a walk that hits it is stuck. */
const PRESS_GUARD = 80;
const ROOM_TILE = { x: 3, y: 3 } as const;
const PLENTY_OF_COINS = 500;

installCanvasGlobals();
setViewportSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
const ctx = gameContext(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

type ClickRouter = (mx: number, my: number) => boolean;

interface PressTally {
  ring: number;
  overlay: number;
}

interface Pointer {
  readonly x: number;
  readonly y: number;
}

const POINTER_AWAY: Pointer = { x: POINTER_OFF_CANVAS, y: POINTER_OFF_CANVAS };

function frame(conversation: Conversation, pointer: Pointer = POINTER_AWAY): void {
  setButtonMouseState(pointer.x, pointer.y);
  conversation.update(null);
  conversation.render(ctx);
}

/** One fresh Space press, routed the way the scene's two key handlers route it. */
function pressSpace(conversation: Conversation, click: ClickRouter, tally: PressTally): void {
  if (menuFocusRingSize() > 0) {
    tally.ring++;
    const point = focusedButtonClickPoint();
    if (point !== null) click(point.x, point.y);
    return;
  }
  tally.overlay++;
  advanceFocusedOverlay([conversation.overlayClaim()]);
}

/** Presses Space, and nothing else, until the conversation closes — the pointer never moving from `pointer`. */
function spaceUntilClosed(
  conversation: Conversation,
  click: ClickRouter,
  pointer: Pointer = POINTER_AWAY,
): PressTally {
  const tally: PressTally = { ring: 0, overlay: 0 };
  for (let press = 0; press < PRESS_GUARD && conversation.isOpen; press++) {
    for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(conversation, pointer);
    pressSpace(conversation, click, tally);
  }
  return tally;
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
    () => [party.human, party.cat],
    () => null,
    () => null,
    () => null,
    () => undefined,
    conversation,
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
  check(voss.tryOpenDialog(party.human), 'the offer opens');
  const tally = spaceUntilClosed(conversation, (mx, my) => voss.handleClick(mx, my));
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
  const click: ClickRouter = (mx, my) => voss.handleClick(mx, my);
  check(voss.tryOpenDialog(party.human), 'the assembly opens');
  spaceUntilClosed(conversation, click);
  check(
    conversation.isOpen && conversation.isShowingChoices,
    'Space alone leaves the fee row standing',
  );
  check(
    progress.status === 'active' && party.human.coins === PLENTY_OF_COINS,
    `and nothing is paid (status: ${progress.status}, coins: ${party.human.coins})`,
  );
  frame(conversation);
  const pay = conversation.choiceBounds.find((rect) => rect.label.includes(VOSS_PAY_LABEL_PREFIX));
  check(pay !== undefined, 'the "Pay" button is on screen');
  if (pay === undefined) return;
  click(pay.x + pay.w / 2, pay.y + pay.h / 2);
  spaceUntilClosed(conversation, click);
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
    const click: ClickRouter = (mx, my) => voss.handleClick(mx, my);
    return { conversation, progress, party, voss, click };
  };

  const scout = setUp();
  scout.voss.tryOpenDialog(scout.party.human);
  spaceUntilClosed(scout.conversation, scout.click);
  frame(scout.conversation);
  const pay = scout.conversation.choiceBounds.find((rect) =>
    rect.label.includes(VOSS_PAY_LABEL_PREFIX),
  );
  check(pay !== undefined, 'the "Pay" button has a place on screen to rest on');
  if (pay === undefined) return;
  const restingOnPay: Pointer = { x: pay.x + pay.w / 2, y: pay.y + pay.h / 2 };

  const run = setUp();
  check(run.voss.tryOpenDialog(run.party.human), 'the assembly opens under the resting cursor');
  const tally = spaceUntilClosed(run.conversation, run.click, restingOnPay);
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
  check(room.tryOpenDialog('old_hilda', party.human), 'her request opens');
  const tally = spaceUntilClosed(conversation, (mx, my) => room.handleClick(mx, my));
  check(progress.hilda === 'in_progress', `the repair job is accepted (hilda: ${progress.hilda})`);
  check(
    tally.ring > 0,
    `her terms were answered through the focus ring (${tally.ring} ring presses)`,
  );

  progress.hilda = 'shard_owed';
  check(room.tryOpenDialog('old_hilda', party.human), 'her thanks open');
  spaceUntilClosed(conversation, (mx, my) => room.handleClick(mx, my));
  const hildaAfterThanks = stepOf(progress, 'hilda');
  check(hildaAfterThanks === 'done', `the shard is handed over (hilda: ${hildaAfterThanks})`);
  check(party.human.inventory.countOf('anchor_shard_hilda') === 1, 'and it is in the bag');

  section('Old Hilda: Escape is the way out, and it agrees to nothing');
  const fresh = activeProgress();
  const escRoom = makeRoom(HILDA_COTTAGE_NAME, fresh, party, conversation);
  if (escRoom === null) return;
  escRoom.tryOpenDialog('old_hilda', party.human);
  frame(conversation);
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
  check(room.tryOpenDialog('deacon_aviel', party.human), 'his request opens');
  spaceUntilClosed(conversation, (mx, my) => room.handleClick(mx, my));
  check(progress.temple !== 'offered', `the vermin job is accepted (temple: ${progress.temple})`);

  progress.temple = 'shard_owed';
  check(room.tryOpenDialog('deacon_aviel', party.human), 'his thanks open');
  spaceUntilClosed(conversation, (mx, my) => room.handleClick(mx, my));
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

/** Which label a lone Space press picks on `choices`, or null when it picks none. */
function spacePicks(choices: NonEmpty<Choice>, haltsWorld: boolean): string | null {
  const conversation = new Conversation(null);
  let picked: string | null = null;
  const recorded = choices.map((choice): Choice => ({
    ...choice,
    run: (convo) => {
      picked = choice.label;
      convo.close();
    },
  }));
  const [first, ...rest] = recorded;
  if (first === undefined) return null;
  conversation.open(rowRequest([first, ...rest], haltsWorld));
  for (let press = 0; press < PRESS_GUARD && conversation.isOpen && picked === null; press++) {
    for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(conversation);
    // Stops at the first press that lands on the row: a row whose default is
    // "nothing" must read as nothing, not as whatever a later press did.
    const rowWasUp = conversation.isShowingChoices;
    pressSpace(conversation, (mx, my) => conversation.handleClick(mx, my), {
      ring: 0,
      overlay: 0,
    });
    if (rowWasUp) break;
  }
  return picked;
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
  conversation.open(rowRequest(choices, false));
  spaceUntilClosed(conversation, (mx, my) => conversation.handleClick(mx, my));
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
  let picked: string | null = null;
  const recording = (label: string, tone: Choice['tone']): Choice => ({
    label,
    tone,
    run: (convo) => {
      picked = label;
      convo.close();
    },
  });
  const askLabel = 'Ask about the well';
  const goodbyeLabel = 'Goodbye';
  conversation.open(
    rowRequest([recording(askLabel, 'normal'), recording(goodbyeLabel, 'exit')], false),
  );
  for (let press = 0; press < PRESS_GUARD; press++) {
    for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(conversation);
    // Checked after the frames, not before the press: the row can come up
    // during a frame, and a press then would already answer it.
    if (conversation.isShowingChoices) break;
    advanceFocusedOverlay([conversation.overlayClaim()]);
  }
  frame(conversation);
  const goodbye = conversation.choiceBounds.find((rect) => rect.label.includes(goodbyeLabel));
  check(goodbye !== undefined, 'the Goodbye button is on screen');
  if (goodbye === undefined) return;
  const onGoodbye: Pointer = { x: goodbye.x + goodbye.w / 2, y: goodbye.y + goodbye.h / 2 };
  for (let f = 0; f < FRAMES_BETWEEN_PRESSES; f++) frame(conversation, onGoodbye);

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
  advanceFocusedOverlay([conversation.overlayClaim()]);
  check(picked === askLabel, `and Space picks it (picked: ${picked ?? 'nothing'})`);
}

// ── A held key does not answer a row it predates ─────────────────────────────

function verifyHeldKeyDoesNotConfirm(): void {
  section('A press that finishes a page never also answers the row it opens');
  const conversation = new Conversation(null);
  let accepted = 0;
  conversation.open({
    lines: [narrator.line('Short.')],
    reward: null,
    questRelated: true,
    ending: {
      kind: 'confirm',
      keyboardDefault: 'accept',
      accept: { label: 'Yes', tone: 'quest', run: () => accepted++ },
      decline: { label: 'No', tone: 'exit', run: (convo) => convo.close() },
    },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: true,
    anchor: null,
    locksKeyboard: true,
  });
  setButtonMouseState(POINTER_OFF_CANVAS, POINTER_OFF_CANVAS);
  conversation.render(ctx);
  const pageContext = menuFocusContextId();
  // Skip the typing, then the very next press arrives before the row has
  // ever been drawn — both must leave the accept side untouched.
  conversation.advance();
  conversation.update(null);
  conversation.advance();
  check(conversation.isShowingChoices, 'the confirm row is up');
  check(accepted === 0, 'but nothing was accepted before the row was drawn');

  frame(conversation);
  const firstRowContext = menuFocusContextId();
  check(
    pageContext !== null && firstRowContext !== null && pageContext !== firstRowContext,
    `the page and its row declare different rings ("${pageContext}" then "${firstRowContext}")`,
  );

  conversation.open({
    lines: [narrator.line('Again.')],
    reward: null,
    questRelated: true,
    ending: {
      kind: 'confirm',
      keyboardDefault: 'accept',
      accept: { label: 'Yes', tone: 'quest', run: () => accepted++ },
      decline: { label: 'No', tone: 'exit', run: (convo) => convo.close() },
    },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: true,
    anchor: null,
    locksKeyboard: true,
  });
  for (let press = 0; press < PRESS_GUARD && !conversation.isShowingChoices; press++) {
    frame(conversation);
    conversation.advance();
  }
  frame(conversation);
  const secondRowContext = menuFocusContextId();
  check(
    secondRowContext !== firstRowContext,
    `a later row declares a ring of its own ("${firstRowContext}" then "${secondRowContext}")`,
  );
}

// ── Source checks ────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every branch the interior scene takes on a resident questline's
 * conversation (the Anchor's, the blueprints') being open: a one-line
 * `return`, or a braced body up to its first closing brace.
 */
const ANCHOR_UPDATE_BRANCH =
  /if \(this\.residentQuestDialogOpen\(\)\) (?:return;|\{[\s\S]*?\n\s*\})/g;

function verifyInteriorSource(): void {
  section('Interior: Space is not polled into a close; Escape reaches the conversation');
  const source = readFileSync(join(REPO_ROOT, 'src/scenes/BuildingInteriorScene.ts'), 'utf8');
  const branches = [...source.matchAll(ANCHOR_UPDATE_BRANCH)].map((match) => match[0]);
  check(
    branches.length > 0,
    `the resident questlines' conversation branches are found (${branches.length})`,
  );
  const polledClose = branches.filter(
    (branch) => branch.includes('consumeModalClose') || branch.includes('dismissDialog'),
  );
  check(polledClose.length === 0, 'none of them closes the conversation off the held Space key');
  check(
    source.includes('if (this.dismissResidentQuestDialog()) return true;'),
    "Escape's dismiss chain includes the resident questlines' conversations",
  );
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
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
  rig.kit.tryInteract(rig.human);
  for (
    let press = 0;
    press < READ_THROUGH_GUARD && conversation.isOpen && !conversation.isShowingChoices;
    press++
  ) {
    conversation.update(null);
    if (conversation.isShowingChoices) break;
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
  frame(conversation);
  pressSpace(conversation, (mx, my) => conversation.handleClick(mx, my), tally);
  check(
    state.quest.phase === 'fortifying',
    `a Space press leaves the village fortifying (phase: ${state.quest.phase})`,
  );
}

/**
 * The reward card is a world-halting modal for its whole life — the reveal as
 * well as the OK — and both scenes claim it with the card's focus ring. Every
 * frame it is up must declare that ring (empty during the reveal), or the
 * frame audit reports the claim as a lie; and Space, once OK is up, takes it.
 */
function verifyRewardCardDeclaresItsRing(): void {
  section('The reward card declares its focus ring on every frame it is up');
  const dialog = new RewardGrantedDialog();
  dialog.enqueue({
    kind: 'ability',
    name: 'Test Reward',
    description: 'A reward granted to check the card keeps its promise to the keyboard.',
    renderIcon: () => undefined,
  });
  const claims = [
    {
      isOpen: true,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: true,
      focusContext: 'reward-granted',
    } as const,
  ];
  const quietConsole = console.error;
  console.error = () => undefined;
  let frames = 0;
  let mismatches = 0;
  let revealFrames = 0;
  try {
    while (dialog.isShowing && frames < MAX_REWARD_CARD_FRAMES) {
      setButtonMouseState(0, 0);
      dialog.update();
      dialog.render(ctx);
      if (auditOverlayFocus(claims, menuFocusContextId()) !== null) mismatches++;
      if (menuFocusRingSize() === 0) revealFrames++;
      frames++;
      if (menuFocusRingSize() > 0) break;
    }
  } finally {
    console.error = quietConsole;
  }
  check(revealFrames > 0, `the card has a reveal before its OK (${revealFrames} frame(s))`);
  check(mismatches === 0, `no frame declares a ring other than the claim's (${mismatches} did)`);
  const okPoint = focusedButtonClickPoint();
  check(okPoint !== null, 'OK is focused by Space once the reveal ends');
  if (okPoint !== null) dialog.handleClick(okPoint.x, okPoint.y);
  check(!dialog.isShowing, 'Space on OK closes the card');
}

verifyRewardCardDeclaresItsRing();
verifyVossOffer();
verifyVossAssembly();
verifyRestingPointerDoesNotPay();
verifyHilda();
verifyAviel();
verifyDefaultResolution();
verifyTopicMenu();
verifyStreetRowMarksSpaceDefault();
verifyHeldKeyDoesNotConfirm();
verifyInteriorSource();
verifyConfirmDefaults();
verifyMayorReadyIsGuarded();

console.log(
  failures === 0 ? '\nAll dialog-accept checks passed.' : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
