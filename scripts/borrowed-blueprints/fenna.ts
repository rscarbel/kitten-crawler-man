/**
 * Fenna's checks for `verify:borrowed-blueprints`: when her "!" shows, the
 * offer's confirm row and what each side does, the re-offer topic after a
 * decline, her opening while the quest runs, the siege standing her down,
 * and the direction she gives to the skyfowl town — plus the "?" over
 * Wendell, the quest-giver she sends the party to.
 *
 * Fenna's part is stood up on a real generated map (for the two centres her
 * directions are worked out from) with stand-in crawlers, so the gate needs
 * no scene.
 */

import {
  BLUEPRINTS_QUEST_PHASE_ORDER,
  type BlueprintsQuestPhase,
} from '../../src/core/blueprintsQuestPhase';
import { createBriarHollowState, type BriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import { teachBoth } from '../../src/core/CraftSkills';
import { EventBus } from '../../src/core/EventBus';
import { TIKKA_PLANS_UNLOCKS } from '../../src/core/villageUnlocks';
import type { VillageQuestPhase } from '../../src/core/villageQuestPhase';
import type { NPCMarkerType } from '../../src/creatures/QuestNPC';
import type { ConversationRequest } from '../../src/dialog/request';
import { FENNA, type VillagerId } from '../../src/dialog/scripts/briarHollow';
import { GameMap } from '../../src/map/GameMap';
import {
  BLUEPRINTS_SIEGE_HINT,
  BlueprintsQuestSystem,
} from '../../src/systems/briarHollow/BlueprintsQuestSystem';
import { VillagerSystem } from '../../src/systems/briarHollow/VillagerSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation } from '../../src/dialog/Conversation';
import {
  BLUEPRINTS_QUEST_ID,
  moveBlueprintsPhase,
  PLUMBLINE_FARM_NAME,
} from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import { WendellBlueprintsHook } from '../../src/systems/briarHollow/blueprints/WendellBlueprintsHook';
import {
  FENNA_OFFER_ACCEPT_LABEL,
  FENNA_OFFER_DECLINE_LABEL,
  FENNA_REOFFER_TOPIC_LABEL,
} from '../../src/systems/briarHollow/blueprints/blueprintsDialog';
import {
  FennaBlueprintsLines,
  FENNA_REOFFER_TOPIC_KEY,
} from '../../src/systems/briarHollow/blueprints/FennaBlueprintsLines';
import {
  firstQuestMarker,
  type QuestLineProvider,
  type VillagerContext,
} from '../../src/systems/briarHollow/villagerCircumstances';
import { cardinalDirection } from '../../src/utils';
import { recordingHandle, testConversationFlow, type Runnable } from '../dialogFlowTestHelpers';

/** The runner's pass/fail recorder, handed in so every section counts toward one verdict. */
export type Check = (ok: boolean, label: string) => void;

const FENNA_MAP_SIZE = 280;
const FENNA_MAP_SEED = 1;
/** A Plea phase after the trebuchet plans are in hand, with no siege on. */
const PLEA_AT_PEACE: VillageQuestPhase = 'fortifying';

interface FennaRig {
  readonly state: BriarHollowState;
  readonly lines: FennaBlueprintsLines;
  readonly started: string[];
  pleaPhase: VillageQuestPhase;
  humanLearned: boolean;
}

let sharedMap: GameMap | null = null;

/** One generated overworld, shared by every rig: generation is the slow part and nothing here mutates it for long. */
function fennaMap(): GameMap {
  sharedMap ??= new GameMap({
    mapSize: FENNA_MAP_SIZE,
    mapType: 'overworld',
    worldSeed: FENNA_MAP_SEED,
    tileHeight: TILE_SIZE,
  });
  return sharedMap;
}

function fennaRig(): FennaRig {
  const state = createBriarHollowState();
  const bus = new EventBus();
  const started: string[] = [];
  bus.on('questStarted', (event) => started.push(event.questId));
  const rig: FennaRig = {
    state,
    started,
    pleaPhase: PLEA_AT_PEACE,
    humanLearned: false,
    lines: new FennaBlueprintsLines({
      state,
      gameMap: fennaMap(),
      pleaPhase: () => rig.pleaPhase,
      setPhase: (phase) => {
        moveBlueprintsPhase(state.blueprints, phase, bus);
      },
      human: { craftSkills: { isLearned: () => rig.humanLearned } },
      cat: { craftSkills: { isLearned: () => false } },
    }),
  };
  return rig;
}

/** A rig with Construction fully open: Carl taught, Tikka's plans in hand. */
function unlockedRig(): FennaRig {
  const rig = fennaRig();
  rig.humanLearned = true;
  rig.state.unlocks.construction.push(...TIKKA_PLANS_UNLOCKS);
  return rig;
}

export function villagerContext(state: BriarHollowState): VillagerContext {
  return {
    nowSeconds: 0,
    quest: state.quest,
    talkCount: 1,
    onceFlags: [],
    party: {
      hpFractions: { human: 1, cat: 1 },
      stone: 0,
      axeTier: null,
      pickaxeTier: null,
      constructionLevels: { human: 1, cat: 0 },
      constructionLearned: true,
    },
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
    unlocks: state.unlocks,
  };
}

function markerOf(rig: FennaRig): NPCMarkerType {
  return rig.lines.markerFor(villagerContext(rig.state));
}

/** The first page's opening paragraph, for matching a line by its text. */
export function firstParagraph(request: ConversationRequest): string {
  const [first] = request.lines;
  return 'paragraphs' in first ? first.paragraphs[0] : '';
}

/** "!" only once Construction is open, never under siege, gone the moment the offer is answered. */
export function verifyFennaMarker(check: Check): void {
  const rig = fennaRig();
  check(markerOf(rig) === 'none', 'Fenna shows no "!" before Construction is unlocked');
  rig.humanLearned = true;
  check(markerOf(rig) === 'none', 'Construction learned without the trebuchet plan shows no "!"');
  rig.state.unlocks.construction.push(...TIKKA_PLANS_UNLOCKS);
  check(markerOf(rig) === 'exclamation', 'Fenna shows "!" the moment the trebuchet plan unlocks');

  const siegePhases: readonly VillageQuestPhase[] = ['imminent', 'assault'];
  for (const phase of siegePhases) {
    rig.pleaPhase = phase;
    check(markerOf(rig) === 'none', `the "!" stands down while the Plea is ${phase}`);
    check(
      rig.lines.lineFor(villagerContext(rig.state)) === null,
      `the offer is not made while the Plea is ${phase}`,
    );
  }
  rig.pleaPhase = PLEA_AT_PEACE;

  const pleaNeedsFenna: QuestLineProvider = {
    lineFor: () => null,
    markerFor: (id: VillagerId): NPCMarkerType => (id === 'fenna' ? 'question' : 'none'),
  };
  const fennaOnly: QuestLineProvider = {
    lineFor: (id, ctx) => (id === 'fenna' ? rig.lines.lineFor(ctx) : null),
    markerFor: (id, ctx) => (id === 'fenna' ? rig.lines.markerFor(ctx) : 'none'),
  };
  const ctx = villagerContext(rig.state);
  check(
    firstQuestMarker('fenna', ctx, [pleaNeedsFenna, fennaOnly]) === 'question',
    "the Plea's marker on Fenna wins over the offer by provider order",
  );
  check(
    firstQuestMarker('fenna', ctx, [fennaOnly]) === 'exclamation',
    'with the Plea silent, the offer marks Fenna',
  );

  const answered = BLUEPRINTS_QUEST_PHASE_ORDER.filter((phase) => phase !== 'unoffered');
  const markedAfterAnswer = answered.filter((phase) => {
    rig.state.blueprints.phase = phase;
    return markerOf(rig) !== 'none';
  });
  check(
    markedAfterAnswer.length === 0,
    `no "!" once the offer is answered (${markedAfterAnswer.join(', ')})`,
  );
}

/** The offer's confirm row, accepting it, and the direction Fenna gives. */
export function verifyFennaOffer(check: Check): void {
  const rig = unlockedRig();
  const opening = rig.lines.lineFor(villagerContext(rig.state));
  check(opening !== null, 'Fenna opens with the offer once Construction is unlocked');
  if (opening === null) return;
  check(opening.pages[0] === FENNA.blueprintsOffer, 'the opening is her offer');
  check(opening.questRelated === true, 'the offer wears the quest icon');
  check(opening.onceFlag === undefined, 'the offer can repeat until it is answered');
  const after = opening.after;
  check(after.kind === 'confirm', 'the offer ends on a confirm row');
  if (after.kind !== 'confirm') return;
  check(
    after.accept.label === FENNA_OFFER_ACCEPT_LABEL &&
      after.decline.label === FENNA_OFFER_DECLINE_LABEL,
    `the row reads "${FENNA_OFFER_ACCEPT_LABEL}" / "${FENNA_OFFER_DECLINE_LABEL}"`,
  );
  check(
    rig.lines.lineFor(villagerContext(rig.state)) !== null &&
      rig.state.blueprints.phase === 'unoffered',
    'walking away leaves the offer standing',
  );

  const accepted = after.accept.run(testConversationFlow());
  check(rig.state.blueprints.phase === 'ask_wendell', 'accepting sends the party to Wendell');
  check(rig.started.length === 1, 'accepting starts the quest, so the Journal pins it');
  const map = fennaMap();
  const villageCentre = map.briarHollow?.centre;
  const townCentre = map.townPlan?.centre;
  check(
    villageCentre !== undefined && townCentre !== undefined,
    'the test map has both a village and a town',
  );
  if (villageCentre !== undefined && townCentre !== undefined) {
    const bearing = cardinalDirection(villageCentre, townCentre).toLowerCase();
    const expected = `He lives at Plumbline Farm, in the skyfowl town ${bearing} of here.`;
    check(
      firstParagraph(accepted).endsWith(expected),
      `Fenna names the town's real bearing ("${bearing}")`,
    );
  }
  check(markerOf(rig) === 'none', 'no "!" after accepting');

  const inProgress = rig.lines.lineFor(villagerContext(rig.state));
  check(
    inProgress?.pages[0] === FENNA.blueprintsInProgress && inProgress.after.kind === 'root',
    'while the quest runs Fenna asks after the blueprints, then her topics come up',
  );
  rig.pleaPhase = 'assault';
  check(
    rig.lines.lineFor(villagerContext(rig.state)) === null,
    'under siege she leaves the opening to the siege lines',
  );
  rig.pleaPhase = PLEA_AT_PEACE;
  rig.state.blueprints.phase = 'complete';
  check(
    rig.lines.lineFor(villagerContext(rig.state)) === null,
    'once the quest is complete she stops asking',
  );

  const lostMap = fennaMap();
  const townPlan = lostMap.townPlan;
  lostMap.townPlan = undefined;
  const lost = unlockedRig();
  const lostOpening = lost.lines.lineFor(villagerContext(lost.state));
  const lostAccepted =
    lostOpening?.after.kind === 'confirm'
      ? lostOpening.after.accept.run(testConversationFlow())
      : null;
  lostMap.townPlan = townPlan;
  check(
    lostAccepted !== null &&
      firstParagraph(lostAccepted).endsWith('in the skyfowl town past the road.'),
    'with no town on the map, Fenna falls back to "past the road"',
  );
}

/** Declining, and the topic that replays the offer. */
export function verifyFennaDecline(check: Check): void {
  const rig = unlockedRig();
  const opening = rig.lines.lineFor(villagerContext(rig.state));
  if (opening?.after.kind !== 'confirm') {
    check(false, 'Fenna offers before she can be declined');
    return;
  }
  check(
    rig.lines.topics(villagerContext(rig.state), testConversationFlow()).length === 0,
    'no re-offer topic before the offer is answered',
  );
  const declined = opening.after.decline.run(testConversationFlow());
  check(rig.state.blueprints.phase === 'declined', 'declining records the decline');
  check(declined.lines[0] === FENNA.blueprintsDeclined, 'Fenna takes the decline in her stride');
  check(rig.started.length === 0, 'declining starts nothing');
  check(markerOf(rig) === 'none', 'the "!" is gone after a decline');
  check(
    rig.lines.lineFor(villagerContext(rig.state)) === null,
    'after a decline Fenna opens as herself again',
  );

  const flow = testConversationFlow();
  const topics = rig.lines.topics(villagerContext(rig.state), flow);
  const reoffer = topics.find((topic) => topic.key === FENNA_REOFFER_TOPIC_KEY);
  check(
    reoffer?.label === FENNA_REOFFER_TOPIC_LABEL && reoffer.tone === 'quest',
    `a quest-tone "${FENNA_REOFFER_TOPIC_LABEL}" topic re-offers`,
  );
  rig.pleaPhase = 'imminent';
  check(
    rig.lines.topics(villagerContext(rig.state), flow).length === 0,
    'the re-offer topic stands down under siege',
  );
  rig.pleaPhase = PLEA_AT_PEACE;
  if (reoffer === undefined) return;

  const pending: Runnable[] = [];
  const played: ConversationRequest[] = [];
  const handle = recordingHandle(pending);
  reoffer.run({
    play: (request) => {
      played.push(request);
      handle.play(request);
    },
    close: () => undefined,
  });
  check(played[0]?.lines[0] === FENNA.blueprintsOffer, 'the topic replays the offer');
  const choices = played[0]?.ending.kind === 'choices' ? played[0].ending.choices : [];
  const accept = choices.find((choice) => choice.label === FENNA_OFFER_ACCEPT_LABEL);
  const decline = choices.find((choice) => choice.label === FENNA_OFFER_DECLINE_LABEL);
  check(
    accept?.tone === 'quest' && accept.keyboard === 'default',
    'the re-offer accept is quest-tone and what Space picks',
  );
  check(decline?.tone === 'exit', 'the re-offer decline is a way out');
  accept?.run(handle);
  const replayedPhase: BlueprintsQuestPhase = rig.state.blueprints.phase;
  check(replayedPhase === 'ask_wendell', 'accepting the re-offer starts the quest');
  check(
    rig.lines.topics(villagerContext(rig.state), flow).length === 0,
    'the re-offer topic goes once the quest is accepted',
  );
}

/** Plumbline Farm's ground floor, where Wendell stands. */
const WENDELL_FLOOR = 0;
/** The steps that send the party to Wendell while the blueprints are with him. */
const WENDELL_QUESTION_PHASES: readonly BlueprintsQuestPhase[] = [
  'ask_wendell',
  'midge_delivered',
  'build_stations',
];

/**
 * The quest-giver Fenna sends the party to: `'question'` over Wendell exactly
 * in the steps that need him, and not once the blueprints are in hand.
 */
export function verifyWendellMarker(check: Check): void {
  const state = createBriarHollowState();
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const hook = WendellBlueprintsHook.forBuilding(PLUMBLINE_FARM_NAME, WENDELL_FLOOR, {
    state,
    bus: new EventBus(),
    audio: null,
    conversation: new Conversation(null),
    human,
    cat,
    toast: () => undefined,
    onItemGranted: () => undefined,
  });
  check(hook !== null, "Wendell's hook stands up on Plumbline Farm's ground floor");
  if (hook === null) return;
  const wrong = BLUEPRINTS_QUEST_PHASE_ORDER.filter((phase) => {
    state.blueprints.phase = phase;
    // Once the quest is complete his glyph belongs to the construction contracts.
    const expected: NPCMarkerType | null =
      phase === 'complete' ? null : WENDELL_QUESTION_PHASES.includes(phase) ? 'question' : 'none';
    return hook.markerFor('wendell') !== expected;
  });
  check(
    wrong.length === 0,
    `Wendell shows "?" in ask_wendell, midge_delivered and build_stations only, and leaves his glyph alone once complete (${wrong.join(', ')})`,
  );
  state.blueprints.phase = 'build_stations';
  human.inventory.addItem('quest_blueprints', 1);
  check(hook.markerFor('wendell') === 'none', 'no "?" on Wendell once the blueprints are carried');
}

export interface JournalRig {
  readonly state: BriarHollowState;
  readonly quest: BlueprintsQuestSystem;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  pleaPhase: VillageQuestPhase;
}

/** The whole quest system on `map` (the shared one by default), for what the journal and the minimap show. */
export function journalRig(map: GameMap = fennaMap()): JournalRig | null {
  const site = map.briarHollow;
  if (site === null) return null;
  const state = createBriarHollowState();
  const human = new HumanPlayer(site.gate.inside.x, site.gate.inside.y, TILE_SIZE);
  const cat = new CatPlayer(site.gate.inside.x + 1, site.gate.inside.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  const bus = new EventBus();
  const conversation = new Conversation(null);
  const villagers = new VillagerSystem({
    gameMap: map,
    site,
    state,
    bus,
    audio: null,
    conversation,
    party: () => villagerContext(state).party,
    random: () => 0,
  });
  const rig: JournalRig = {
    state,
    human,
    cat,
    pleaPhase: PLEA_AT_PEACE,
    quest: new BlueprintsQuestSystem({
      state,
      gameMap: map,
      site,
      bus,
      audio: null,
      roster: new MobRoster(map, new SpellSystem()),
      human,
      cat,
      active: () => (human.isActive ? human : cat),
      villagers,
      conversation,
      announce: () => undefined,
      callout: () => undefined,
      onTileChanged: () => undefined,
      noteResourceActivity: () => undefined,
      worldHalted: () => false,
      pleaPhase: () => rig.pleaPhase,
      guideTarget: () => null,
    }),
  };
  return rig;
}

/**
 * The journal row and the minimap pip agree with the "!" over Fenna: nothing
 * before Construction opens, a "!" pip on her while the offer stands, no pip
 * once she is declined, and no arrow or pip anywhere under siege.
 */
export function verifyFennaJournal(check: Check): void {
  const rig = journalRig();
  check(rig !== null, 'the test map has a village to stand the quest up in');
  if (rig === null) return;
  const { quest, state } = rig;
  const ctx = villagerContext(state);
  check(
    quest.trackerEntries().length === 0 && quest.questMarkers.length === 0,
    'no journal row and no minimap pip before Construction is unlocked',
  );

  teachBoth(rig.human, rig.cat, 'construction');
  state.unlocks.construction.push(...TIKKA_PLANS_UNLOCKS);
  const offered = quest.trackerEntries().find((entry) => entry.id === BLUEPRINTS_QUEST_ID);
  const exclamationPips = quest.questMarkers.filter((marker) => marker.type === 'exclamation');
  check(offered?.status === 'available', 'the offer shows in the journal once Construction opens');
  check(
    exclamationPips.length === 1 && quest.markerFor('fenna', ctx) === 'exclamation',
    'the minimap pip and the glyph over Fenna both read "!"',
  );

  rig.pleaPhase = 'imminent';
  check(quest.questMarkers.length === 0, 'no "!" pip on Fenna while the enemy is at the gate');
  check(
    quest.trackerEntries().every((entry) => entry.target === undefined),
    'no journal arrow to Fenna while the enemy is at the gate',
  );
  rig.pleaPhase = PLEA_AT_PEACE;

  state.blueprints.phase = 'declined';
  check(quest.questMarkers.length === 0, 'no "!" pip on Fenna after a decline');
  check(quest.markerFor('fenna', ctx) === 'none', 'no glyph over Fenna after a decline');

  state.blueprints.phase = 'ask_merrit';
  rig.pleaPhase = 'assault';
  check(
    quest.questMarkers.length === 0 &&
      quest.trackerEntries().every((entry) => entry.target === undefined),
    'an accepted quest points nowhere during the assault',
  );

  // Every open row says why it stands down, even the steps whose target is
  // a town away and so never had an arrow for the siege to take.
  const unexplained = BLUEPRINTS_QUEST_PHASE_ORDER.filter((phase) => {
    state.blueprints.phase = phase;
    const row = quest.trackerEntries().find((entry) => entry.id === BLUEPRINTS_QUEST_ID);
    if (phase === 'complete') return row?.hint === BLUEPRINTS_SIEGE_HINT;
    return row?.hint !== BLUEPRINTS_SIEGE_HINT || row.target !== undefined;
  });
  check(
    unexplained.length === 0,
    `every open row reads "${BLUEPRINTS_SIEGE_HINT}" with no arrow during the assault, and the finished row does not (wrong: ${unexplained.join(', ') || 'none'})`,
  );
  quest.dispose();
}
