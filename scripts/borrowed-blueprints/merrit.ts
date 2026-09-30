/**
 * Merrit, for `verify:borrowed-blueprints`: her openings in each step she
 * matters in (and the Plea's outcome in her greeting), the "?" over her head,
 * each conversation moving the quest on as it closes, and the grain hand-in —
 * the grain spent, the scythe back on the wall, her shout for Midge, and her
 * own "There she is" conversation, which waits for the panel to be free.
 * Under the Plea's siege she keeps the siege line and takes nothing.
 *
 * Talks go through the kit's Space entry, as a player's would.
 */

import { setViewportSize } from '../../src/core/Viewport';
import type { BlueprintsQuestPhase } from '../../src/core/blueprintsQuestPhase';
import type { VillageQuestPhase } from '../../src/core/villageQuestPhase';
import type { DialogLine } from '../../src/dialog/line';
import type { ConversationRequest } from '../../src/dialog/request';
import { MERRIT } from '../../src/dialog/scripts/briarHollow';
import type { NPCMarkerType } from '../../src/creatures/QuestNPC';
import {
  MERRIT_CALL_MIDGE_BARK,
  merritAskPages,
  merritFenceDonePages,
  merritFenceWaitingPages,
  merritGrainDeliveredPages,
  merritHarvestWaitingPages,
  merritMidgeArrivedPages,
} from '../../src/systems/briarHollow/blueprints/blueprintsDialog';
import type { SiegeRig } from '../villageSiegeHarness';
import { blueprintsRig, type Check } from './fence';
import { MIDGE_CALL_TIMEOUT_SECONDS } from '../../src/systems/briarHollow/blueprints/MidgeEscort';
import {
  ESCORT_START_BANNER,
  MIDGE_INTRO_SECONDS,
  MIDGE_LEAD_CAPTION,
} from '../../src/systems/briarHollow/blueprints/BlueprintsStepMoments';

const GRAIN_TARGET = 100;
/** Enough frames for a conversation queued behind another to be seen not to open. */
const WAIT_FRAMES = 30;
const UPDATES_PER_SECOND = 60;
/** Midge walks over, or is snapped beside the party at the call's timeout, within this many frames. */
const CALL_FRAMES = MIDGE_CALL_TIMEOUT_SECONDS * UPDATES_PER_SECOND;
/** Page turns before a conversation that will not end is called stuck. */
const READ_LIMIT = 200;
/**
 * The conversation paginates against the live viewport; with none set it
 * measures a zero-width box and turns every word into a page.
 */
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

interface TalkRig {
  readonly rig: SiegeRig;
  /** Every paragraph the panel has shown, in order. */
  readonly shown: string[];
  /** Every bark Merrit was made to shout. */
  readonly barks: string[];
}

function talkRig(phase: BlueprintsQuestPhase, pleaPhase: VillageQuestPhase): TalkRig {
  setViewportSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  const { rig } = blueprintsRig(phase);
  rig.state.quest.phase = pleaPhase;
  const villagers = rig.kit.villagers;
  if (villagers === null) throw new Error('the village kit built no villagers');
  const shown: string[] = [];
  const barks: string[] = [];
  const capture = (request: ConversationRequest): void => {
    for (const line of request.lines) {
      if ('paragraphs' in line) shown.push(...line.paragraphs);
    }
  };
  const conversation = villagers.conversation;
  const open = conversation.open.bind(conversation);
  conversation.open = (request) => {
    capture(request);
    const handle = open(request);
    const play = handle.play.bind(handle);
    handle.play = (next) => {
      capture(next);
      play(next);
    };
    return handle;
  };
  const bark = villagers.bark.bind(villagers);
  villagers.bark = (id, line, force) => {
    if (id === 'merrit' && 'paragraphs' in line) barks.push(...line.paragraphs);
    return bark(id, line, force);
  };
  return { rig, shown, barks };
}

function paragraphs(lines: readonly DialogLine[]): string[] {
  return lines.flatMap((line) => [...line.paragraphs]);
}

function same(actual: readonly string[], wanted: readonly string[]): boolean {
  return actual.length === wanted.length && actual.every((text, index) => text === wanted[index]);
}

/** Pages through whatever is open until it closes or offers choices. */
function readThrough(talk: TalkRig): void {
  const conversation = talk.rig.kit.villagers?.conversation;
  if (conversation === undefined) return;
  for (
    let turn = 0;
    turn < READ_LIMIT && conversation.isOpen && !conversation.isShowingChoices;
    turn++
  ) {
    conversation.update(null);
    if (!conversation.isOpen || conversation.isShowingChoices) break;
    conversation.advance();
  }
}

/** Walks up to Merrit and presses Space; returns what the panel opened with, read to its end. */
function talkToMerrit(talk: TalkRig): string[] {
  const villagers = talk.rig.kit.villagers;
  const merrit = villagers?.villagerFor('merrit') ?? null;
  if (villagers === null || merrit === null) return [];
  if (villagers.conversation.isOpen) villagers.closeConversation();
  talk.rig.human.x = merrit.x;
  talk.rig.human.y = merrit.y;
  const before = talk.shown.length;
  talk.rig.kit.tryInteract(talk.rig.human);
  readThrough(talk);
  return talk.shown.slice(before);
}

/** Merrit's marker after a frame has refreshed it. */
function merritMarker(talk: TalkRig): NPCMarkerType {
  talk.rig.step();
  return talk.rig.kit.villagers?.villagerFor('merrit')?.marker ?? 'none';
}

function closeAnyConversation(talk: TalkRig): void {
  const villagers = talk.rig.kit.villagers;
  if (villagers?.conversation.isOpen === true) villagers.closeConversation();
}

/** The ask, its greeting following the Plea, and the step moving to `build_fence` as it closes. */
export function verifyMerritAsk(check: Check): void {
  for (const pleaWon of [false, true]) {
    const talk = talkRig('ask_merrit', pleaWon ? 'complete' : 'fortifying');
    check(
      merritMarker(talk) === 'question',
      `a "?" over Merrit at ask_merrit (Plea won: ${pleaWon})`,
    );
    const pages = talkToMerrit(talk);
    check(
      same(pages, paragraphs(merritAskPages('carl', pleaWon))),
      `Carl asks for a cow and Merrit's greeting follows the Plea (won: ${pleaWon})`,
    );
    talk.rig.step();
    check(
      talk.rig.state.blueprints.phase === 'build_fence',
      'closing the ask moves the quest to build_fence',
    );
    check(merritMarker(talk) === 'none', 'no "?" over Merrit while the fence is built');
    const waiting = talkToMerrit(talk);
    check(
      same(waiting.slice(0, 1), paragraphs(merritFenceWaitingPages())),
      "Merrit's waiting line while the fence is unfinished",
    );
    closeAnyConversation(talk);
    talk.rig.dispose();
  }

  const donut = talkRig('ask_merrit', 'fortifying');
  donut.rig.human.isActive = false;
  donut.rig.cat.isActive = true;
  const donutPages = talkToMerrit(donut);
  check(
    same(donutPages, paragraphs(merritAskPages('donut', false))),
    'with Donut active, Donut does the asking',
  );
  donut.rig.dispose();
}

/** The fence reported, and the step moving on to the harvest. */
export function verifyMerritFenceDone(check: Check): void {
  const talk = talkRig('report_fence', 'fortifying');
  check(merritMarker(talk) === 'question', 'a "?" over Merrit at report_fence');
  const pages = talkToMerrit(talk);
  check(
    same(pages, paragraphs(merritFenceDonePages('carl'))),
    'the finished fence, and her terms for Midge',
  );
  talk.rig.step();
  check(
    talk.rig.state.blueprints.phase === 'harvest_grain',
    'closing it moves the quest to harvest_grain',
  );
  check(merritMarker(talk) === 'none', 'no "?" over Merrit while the party harvests');
  const waiting = talkToMerrit(talk);
  check(
    same(waiting.slice(0, 1), paragraphs(merritHarvestWaitingPages())),
    "Merrit's waiting line while the party harvests",
  );
  closeAnyConversation(talk);
  talk.rig.dispose();
}

/** The grain in, the scythe back, the shout, and the auto-opened "There she is" moving on to the escort. */
export function verifyMerritGrainAndCall(check: Check): void {
  const talk = talkRig('deliver_grain', 'fortifying');
  const { rig } = talk;
  rig.state.blueprints.grain = GRAIN_TARGET;
  rig.human.inventory.addItem('quest_scythe', 1);
  check(merritMarker(talk) === 'question', 'a "?" over Merrit at deliver_grain');
  const pages = talkToMerrit(talk);
  check(
    same(pages, paragraphs(merritGrainDeliveredPages())),
    'Merrit takes the grain: "That\'ll do."',
  );
  check(rig.state.blueprints.grain === 0, 'the grain counter is spent');
  check(
    rig.human.inventory.countOf('quest_scythe') === 0 &&
      rig.cat.inventory.countOf('quest_scythe') === 0,
    'the scythe leaves the quest slot',
  );
  check(
    same(talk.barks, paragraphs([MERRIT_CALL_MIDGE_BARK])),
    'Merrit shouts "HERE MIDGE! COME HERE GIRL!"',
  );
  const blueprints = rig.kit.blueprints;
  if (blueprints === null) return;
  rig.step();
  const midge = blueprints.escort.midge;
  const midgeTile = blueprints.escort.midgeTile();
  const pointedAt = blueprints.trackerEntries()[0]?.target;
  check(
    midge !== null && midge.questMarker === 'exclamation',
    'Midge wears a "!" while she answers the call',
  );
  check(
    midgeTile !== null &&
      pointedAt !== undefined &&
      pointedAt.x === midgeTile.x &&
      pointedAt.y === midgeTile.y,
    'while Merrit calls, the journal points at Midge rather than Merrit',
  );

  // Something else holds the panel as Midge arrives: Merrit waits for it.
  const conversation = rig.kit.villagers?.conversation;
  if (conversation === undefined) return;
  const shownBeforeWait = talk.shown.length;
  const [intruder] = merritFenceWaitingPages();
  conversation.open({
    lines: [intruder],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: false,
    anchor: null,
    locksKeyboard: false,
  });
  for (let frame = 0; frame < CALL_FRAMES + WAIT_FRAMES; frame++) rig.step();
  const arrived = paragraphs(merritMidgeArrivedPages());
  check(
    same(talk.shown.slice(shownBeforeWait), paragraphs([intruder])),
    '"There she is" waits while another conversation is open',
  );
  check(rig.state.blueprints.phase === 'deliver_grain', 'the step waits with it');
  conversation.close();
  rig.step();
  check(
    same(talk.shown.slice(shownBeforeWait + 1), arrived),
    'once the panel is free, Merrit opens "There she is" herself',
  );
  check(
    rig.kit.villagers?.villagerFor('merrit')?.marker === 'none',
    'no "?" over Merrit while she is calling Midge',
  );
  check(
    rig.state.blueprints.phase === 'deliver_grain',
    'the step holds until "There she is" is read',
  );
  readThrough(talk);
  rig.step();
  check(
    rig.state.blueprints.phase === 'escort_midge',
    'reading "There she is" moves the quest to escort_midge',
  );
  check(talk.barks.length === 1, 'Merrit shouted for Midge once');
  check(
    blueprints.moments.currentBanner === ESCORT_START_BANNER,
    `the escort opens with "${ESCORT_START_BANNER.title}"`,
  );
  check(
    midge?.questMarker === 'exclamation' &&
      blueprints.moments.midgeCaption() === MIDGE_LEAD_CAPTION,
    `at the escort's start Midge wears a "!" captioned "${MIDGE_LEAD_CAPTION}"`,
  );
  const guidance = blueprints.guidance();
  check(
    guidance?.kind === 'escort_waypoint',
    `with Midge on the lead the guide leads along the road to Wendell's pasture (${guidance?.kind ?? 'nothing'})`,
  );
  for (let frame = 0; frame < MIDGE_INTRO_SECONDS * UPDATES_PER_SECOND; frame++) rig.step();
  const following = !blueprints.escort.isWaitingAtGate && !blueprints.escort.isOutOfLeadRange;
  check(following, 'Midge is on the lead beside the party');
  check(
    following && midge?.questMarker === 'none' && blueprints.moments.midgeCaption() === null,
    `after ${MIDGE_INTRO_SECONDS} s on the lead, Midge takes her "!" off`,
  );
  blueprints.setPhase('midge_delivered');
  rig.step();
  check(midge?.questMarker === 'none', 'the delivered Midge wears no "!"');
  rig.dispose();
}

/** The Plea's siege: Merrit keeps her siege line, takes no grain and calls nobody. */
export function verifyMerritUnderSiege(check: Check): void {
  const talk = talkRig('deliver_grain', 'fortifying');
  const { rig } = talk;
  rig.state.blueprints.grain = GRAIN_TARGET;
  rig.human.inventory.addItem('quest_scythe', 1);
  rig.state.quest.phase = 'imminent';
  const pages = talkToMerrit(talk);
  check(
    same(pages.slice(0, 1), paragraphs([MERRIT.attackImminent])),
    "under siege Merrit's opening stays the siege line",
  );
  closeAnyConversation(talk);
  rig.step();
  check(
    rig.state.blueprints.grain === GRAIN_TARGET &&
      rig.human.inventory.countOf('quest_scythe') === 1 &&
      talk.barks.length === 0 &&
      rig.state.blueprints.phase === 'deliver_grain',
    'under siege the grain waits, the scythe stays and Midge is not called',
  );
  check(
    rig.kit.villagers?.villagerFor('merrit')?.marker === 'none',
    'no "?" over Merrit under siege',
  );
  rig.dispose();
}
