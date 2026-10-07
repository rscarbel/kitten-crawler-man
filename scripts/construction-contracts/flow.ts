/**
 * Whole contracts worked and paid for, for `verify:construction-contracts`.
 *
 * Every site in both towns is issued a contract, has every spot finished
 * through the real `ContractSiteWork.finishSpot` path (the interior's
 * `ContractInteriorSite` in Skyfowl Town, the kit's `ConstructionContractSystem`
 * in Briar Hollow) and is paid out by its contact through a real conversation
 * read to the end: the materials spent are the contract's bill, the coins
 * earned are its payout, the record is cleared, `questCompleted` goes out
 * once, and Wendell's note opens only once the thanks has closed. Then the
 * refusals: a siege, a party short of materials, and a dropped contract.
 */

import type { BriarHollowState } from '../../src/core/briarHollowState';
import type { VillageQuestPhase } from '../../src/core/villageQuestPhase';
import { createBriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import { EventBus } from '../../src/core/EventBus';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation } from '../../src/dialog/Conversation';
import type { ConversationHandle, ConversationRequest } from '../../src/dialog/request';
import type { NPCMarkerType } from '../../src/creatures/QuestNPC';
import { InteriorOccupantSystem } from '../../src/systems/InteriorOccupantSystem';
import type { InteriorStoryState } from '../../src/systems/interiorStoryOwnership';
import { createAnchorQuestProgress } from '../../src/core/AnchorQuestProgress';
import {
  CONTRACT_SITES,
  type BriarHollowContractSiteDef,
  type ContractSiteDef,
  type SkyfowlContractSiteDef,
} from '../../src/systems/constructionContracts/contractCatalog';
import { ContractContactHook } from '../../src/systems/constructionContracts/ContractContactHook';
import {
  contractCost,
  contractPayout,
  dropContract,
  issueContract,
} from '../../src/systems/constructionContracts/contractGenerator';
import { ContractInteriorSite } from '../../src/systems/constructionContracts/ContractInteriorSite';
import {
  CONSTRUCTION_CONTRACT_QUEST_ID,
  releaseContractAutoPinOnEnd,
} from '../../src/systems/constructionContracts/contractQuest';
import { createJournalProgress, type PinSource } from '../../src/core/JournalProgress';
import {
  CONTRACT_SHORT_MESSAGE,
  contractSpotFrames,
} from '../../src/systems/constructionContracts/ContractSiteWork';
import { CONTRACT_SIEGE_LINE } from '../../src/systems/constructionContracts/ConstructionContractSystem';
import {
  objectiveBeamTargets,
  resolvePinnedEntry,
  type TrackerEntry,
  type TrackerTarget,
} from '../../src/systems/questTracker';
import { rectCentre } from '../../src/map/overworld/briarHollowSite';
import type { Check } from './shared';
import { partyStock, PLENTY_OF_EACH_MATERIAL, sameCost, stockSpent, stockUp } from './shared';
import { RATKIN_SOLDIER_IDS, type RatkinSoldierId } from '../../src/sprites/art/ratkin/cast';
import { buildSiegeRig, standAt, type SiegeRig } from '../villageSiegeHarness';
import { generateGroundFloor, worldLayouts } from './targets';

const CONTRACT_SEED = 12345;
/** The village after the Plea: no siege, and no Plea beat ahead of a contact's thanks. */
const PEACETIME_PHASE = 'complete' satisfies VillageQuestPhase;
/** A world seed with Briar Hollow on it; the rig's map is generated once and shared. */
const VILLAGE_SEED = 7919;
/** The siege rig's undead level; nothing is fought here, but the rig needs one. */
const RIG_ASSAULT_LEVEL = 6;
/** More presses than any thanks has pages, so a read-through that never ends is caught. */
const MAX_PRESSES_PER_TALK = 2000;
/** Frames past a spot's own channel length before a channel that never ends is called stuck. */
const CHANNEL_SLACK_FRAMES = 30;

interface RecordedOpen {
  readonly request: ConversationRequest;
  readonly handle: ConversationHandle;
  /** Whether something else was on screen when this opened. */
  readonly boxWasOpen: boolean;
}

/** Records every request opened on `conversation`, in order. */
function recordOpens(conversation: Conversation): RecordedOpen[] {
  const opened: RecordedOpen[] = [];
  const open = conversation.open.bind(conversation);
  conversation.open = (request) => {
    const boxWasOpen = conversation.isOpen;
    const handle = open(request);
    opened.push({ request, handle, boxWasOpen });
    return handle;
  };
  return opened;
}

/** Presses through the conversation until it closes, as a player reading every page would. */
function readThrough(conversation: Conversation): void {
  const open = (): boolean => conversation.isOpen;
  for (let press = 0; press < MAX_PRESSES_PER_TALK && open(); press++) {
    conversation.update(null);
    if (open()) conversation.advance();
  }
}

function countQuestCompleted(bus: EventBus): { readonly count: () => number } {
  let completed = 0;
  bus.on('questCompleted', (event) => {
    if (event.questId === CONSTRUCTION_CONTRACT_QUEST_ID) completed++;
  });
  return { count: () => completed };
}

function issueAt(state: BriarHollowState, site: ContractSiteDef): ReturnType<typeof issueContract> {
  state.blueprints.phase = 'complete';
  // Past the Plea, whose beats rightly come before a contact's thanks.
  state.quest.phase = PEACETIME_PHASE;
  return issueContract(state.contracts, (candidate) => candidate === site, CONTRACT_SEED);
}

function isSoldierId(id: string): id is RatkinSoldierId {
  return RATKIN_SOLDIER_IDS.some((soldierId) => soldierId === id);
}

/** The glyph drawn over a Briar Hollow contact this frame, or null when they are nowhere in the village. */
function drawnMarker(
  rig: SiegeRig,
  contact: BriarHollowContractSiteDef['contact'],
): NPCMarkerType | null {
  if (isSoldierId(contact)) return rig.kit.soldiers?.soldierById(contact)?.questMarker ?? null;
  return rig.kit.villagers?.villagerFor(contact)?.marker ?? null;
}

/**
 * Opens a talk with a Briar Hollow contact the way a press beside them
 * would: a civilian through the villagers, a militia soldier through the
 * soldiers. False when the contact is nowhere in the village.
 */
function talkToContact(rig: SiegeRig, contact: BriarHollowContractSiteDef['contact']): boolean {
  const { villagers, soldiers } = rig.kit;
  if (isSoldierId(contact)) {
    const soldier = soldiers?.soldierById(contact) ?? null;
    if (soldier === null || soldiers === null) return false;
    soldiers.talkTo(soldier, rig.human);
    return true;
  }
  const villager = villagers?.villagerFor(contact) ?? null;
  if (villager === null || villagers === null) return false;
  villagers.talkTo(villager, rig.human);
  return true;
}

/** The client's thanks, then Wendell's note: every box a payout opens. */
const PAYOUT_BOX_COUNT = 2;

/**
 * The checks every payout shares once the thanks has been read to the end:
 * coins, record, the one `questCompleted`, and Wendell's note on a free box.
 */
function checkPaidOut(
  check: Check,
  site: ContractSiteDef,
  paid: {
    readonly state: BriarHollowState;
    readonly payout: number;
    readonly coinsEarned: number;
    /** Every amount flown to the HUD, or null where the scene's own flight is not observed. */
    readonly coinsFlown: readonly number[] | null;
    readonly questCompleted: number;
    readonly opened: readonly RecordedOpen[];
    readonly followUpPendingAfterClose: boolean;
    readonly followUpOpenAfterUpdate: boolean;
  },
): void {
  const { state, payout } = paid;
  check(
    paid.coinsEarned === payout,
    `${site.name}: paid ${payout} coins (earned ${paid.coinsEarned})`,
  );
  if (paid.coinsFlown !== null) {
    check(
      paid.coinsFlown.length === 1 && paid.coinsFlown[0] === payout,
      `${site.name}: the payout flies to the HUD once`,
    );
  }
  check(state.contracts.active === null, `${site.name}: no contract held after the payout`);
  check(
    state.contracts.contractsCompleted === 1 && state.contracts.lastSiteKey === site.slug,
    `${site.name}: counted as completed and remembered as the last site`,
  );
  check(
    paid.questCompleted === 1,
    `${site.name}: questCompleted fired once (${paid.questCompleted})`,
  );
  check(
    paid.followUpPendingAfterClose,
    `${site.name}: Wendell's note waits once the thanks closes`,
  );
  const [, followUp] = paid.opened;
  const followUpSpeaker = followUp.request.lines[0].speaker;
  const followUpIsWendells = followUpSpeaker.kind === 'cast' && followUpSpeaker.id === 'wendell';
  check(
    paid.followUpOpenAfterUpdate &&
      paid.opened.length === PAYOUT_BOX_COUNT &&
      followUpIsWendells &&
      !followUp.boxWasOpen &&
      !followUp.request.haltsWorld,
    `${site.name}: Wendell's note opens next, on a free box, over a running world`,
  );
}

// ── Skyfowl Town ─────────────────────────────────────────────────────────

function verifySkyfowlSite(check: Check, site: SkyfowlContractSiteDef): void {
  const entry = worldLayouts(VILLAGE_SEED).entries.find((e) => e.name === site.buildingName);
  if (entry === undefined) {
    check(false, `${site.name}: has a building entry`);
    return;
  }
  const state = createBriarHollowState();
  const active = issueAt(state, site);
  if (active === null) {
    check(false, `${site.name}: a contract is issued`);
    return;
  }
  const map = generateGroundFloor(entry);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.isActive = true;
  stockUp(human, PLENTY_OF_EACH_MATERIAL);
  const anchor = createAnchorQuestProgress();
  const story = (): InteriorStoryState => ({ murderStage: undefined, anchor });
  const toasts: string[] = [];
  const interior = ContractInteriorSite.forBuilding(site.buildingName, 0, {
    state,
    story,
    gameMap: map,
    human,
    cat,
    audio: null,
    toast: (message) => toasts.push(message),
    worldHalted: () => false,
  });
  if (interior === null) {
    check(false, `${site.name}: the room stands up its contract site`);
    return;
  }
  check(
    interior.work.spots.length === active.spotIds.length,
    `${site.name}: all ${active.spotIds.length} spots bound in the room`,
  );
  const before = partyStock(human, cat);
  const finished = interior.work.spots.filter((spot) =>
    interior.work.finishSpot(spot.index, human),
  );
  check(finished.length === active.spotIds.length, `${site.name}: every spot finishes`);
  check(
    interior.work.spots.every((spot) => !interior.work.finishSpot(spot.index, human)),
    `${site.name}: a finished spot cannot be finished again`,
  );
  const spent = stockSpent(before, partyStock(human, cat));
  const bill = contractCost(active);
  check(sameCost(spent, bill), `${site.name}: spent exactly the bill ${JSON.stringify(bill)}`);
  check(active.spotsDone.every(Boolean), `${site.name}: every spot marked done`);
  interior.dispose();

  const occupants = InteriorOccupantSystem.forBuilding(map, entry.type, entry.name, () => human);
  const contact = occupants?.people.find((person) => person.residentId === site.contact);
  check(contact !== undefined, `${site.name}: ${site.contact} stands in the room to pay`);
  const conversation = new Conversation(null);
  const opened = recordOpens(conversation);
  const bus = new EventBus();
  const questCompleted = countQuestCompleted(bus);
  const coinsFlown: number[] = [];
  const hook = ContractContactHook.forBuilding(site.buildingName, 0, {
    state,
    story,
    bus,
    audio: null,
    conversation,
    flyCoins: (coins) => coinsFlown.push(coins),
    speechStyleOf: (residentId) =>
      occupants?.people.find((person) => person.residentId === residentId)?.speechStyle ?? null,
  });
  if (hook === null) {
    check(false, `${site.name}: the room has a contact hook`);
    return;
  }
  check(hook.markerFor(site.contact) === 'question', `${site.name}: the contact wears a ?`);
  const payout = contractPayout(active);
  const coinsBefore = human.coins;
  check(hook.tryOpenDialog(site.contact, human), `${site.name}: talking opens the thanks`);
  check(
    !hook.settlement.isFollowUpPending && state.contracts.active !== null,
    `${site.name}: nothing is paid while the thanks is still being read`,
  );
  readThrough(conversation);
  check(!conversation.isOpen, `${site.name}: the thanks reads through to its close`);
  const followUpPendingAfterClose = hook.settlement.isFollowUpPending;
  hook.update();
  checkPaidOut(check, site, {
    state,
    payout,
    coinsEarned: human.coins - coinsBefore,
    coinsFlown,
    questCompleted: questCompleted.count(),
    opened,
    followUpPendingAfterClose,
    followUpOpenAfterUpdate: hook.isFollowUpOpen,
  });
  check(hook.markerFor(site.contact) !== 'question', `${site.name}: the contact's ? clears`);
  check(!hook.tryOpenDialog(site.contact, human), `${site.name}: a second talk pays nothing`);
  check(questCompleted.count() === 1, `${site.name}: still one questCompleted`);
}

// ── Briar Hollow ─────────────────────────────────────────────────────────

function villageRig(state: BriarHollowState): SiegeRig {
  const rig = buildSiegeRig({ seed: VILLAGE_SEED, state, assaultLevel: RIG_ASSAULT_LEVEL });
  rig.human.godMode = true;
  rig.cat.godMode = true;
  rig.human.isActive = true;
  return rig;
}

function verifyVillageSite(check: Check, site: BriarHollowContractSiteDef): void {
  const state = createBriarHollowState();
  const active = issueAt(state, site);
  if (active === null) {
    check(false, `${site.name}: a contract is issued`);
    return;
  }
  const rig = villageRig(state);
  try {
    const system = rig.kit.contracts;
    const villagers = rig.kit.villagers;
    if (system === null || villagers === null) {
      check(false, `${site.name}: the kit builds its contracts and villagers`);
      return;
    }
    check(
      system.work.spots.length === active.spotIds.length,
      `${site.name}: all ${active.spotIds.length} spots bound in the village`,
    );
    stockUp(rig.human, PLENTY_OF_EACH_MATERIAL);
    const before = partyStock(rig.human, rig.cat);
    const finished = system.work.spots.filter((spot) =>
      system.work.finishSpot(spot.index, rig.human),
    );
    check(finished.length === active.spotIds.length, `${site.name}: every spot finishes`);
    const bill = contractCost(active);
    check(
      sameCost(stockSpent(before, partyStock(rig.human, rig.cat)), bill),
      `${site.name}: spent exactly the bill ${JSON.stringify(bill)}`,
    );
    rig.step();
    check(system.isReady, `${site.name}: the contract reads ready`);
    check(rig.map.hiddenDecorationTiles.size === 0, `${site.name}: every rebuilt prop draws again`);

    const conversation = villagers.conversation;
    const opened = recordOpens(conversation);
    const questCompleted = countQuestCompleted(rig.bus);
    check(system.markerFor(site.contact) === 'question', `${site.name}: the contact is owed a ?`);
    check(
      drawnMarker(rig, site.contact) === 'question',
      `${site.name}: a ? is drawn over ${site.contact}`,
    );
    const payout = contractPayout(active);
    const coinsBefore = rig.human.coins;
    const talked = talkToContact(rig, site.contact);
    check(talked, `${site.name}: ${site.contact} stands in the village to pay`);
    if (!talked) return;
    check(conversation.isOpen, `${site.name}: talking opens the thanks`);
    check(
      !system.settlement.isFollowUpPending && state.contracts.active !== null,
      `${site.name}: nothing is paid while the thanks is still being read`,
    );
    readThrough(conversation);
    check(!conversation.isOpen, `${site.name}: the thanks reads through to its close`);
    const followUpPendingAfterClose = system.settlement.isFollowUpPending;
    rig.step();
    checkPaidOut(check, site, {
      state,
      payout,
      coinsEarned: rig.human.coins - coinsBefore,
      coinsFlown: null,
      questCompleted: questCompleted.count(),
      opened,
      followUpPendingAfterClose,
      followUpOpenAfterUpdate: system.isFollowUpOpen,
    });
    check(system.markerFor(site.contact) === 'none', `${site.name}: the contact's ? clears`);
    check(
      drawnMarker(rig, site.contact) !== 'question',
      `${site.name}: no ? is drawn over ${site.contact} once paid`,
    );
  } finally {
    rig.dispose();
  }
}

/** Stands the crawler beside the spot where it can work it; false when none of the four sides reaches. */
function standInReach(
  rig: SiegeRig,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  const system = rig.kit.contracts;
  if (system === null) return false;
  const sides = [
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x, y: rect.y - 1 },
    { x: rect.x - 1, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
  ];
  for (const side of sides) {
    standAt(rig.human, side.x, side.y);
    rig.human.isMoving = false;
    if (system.work.spotInReach(rig.human) !== null) return true;
  }
  return false;
}

function firstVillageSite(): BriarHollowContractSiteDef {
  for (const site of CONTRACT_SITES) if (site.town === 'briar_hollow') return site;
  throw new Error('no Briar Hollow site');
}

/** A real channel: Space beside a spot, the work runs its frames, the spot is done. Not under siege. */
function verifySiegeAndChannel(check: Check): void {
  const site = firstVillageSite();
  const state = createBriarHollowState();
  const active = issueAt(state, site);
  if (active === null) {
    check(false, `${site.name}: a contract is issued`);
    return;
  }
  const rig = villageRig(state);
  try {
    const system = rig.kit.contracts;
    if (system === null) {
      check(false, 'the kit builds its contracts');
      return;
    }
    stockUp(rig.human, PLENTY_OF_EACH_MATERIAL);
    const reachable = system.work.spots.find((spot) => standInReach(rig, spot.footprint.rect));
    check(reachable !== undefined, `${site.name}: some spot can be stood beside and worked`);
    if (reachable === undefined) return;
    const inReach = system.work.spotInReach(rig.human);
    if (inReach === null) return;
    const before = partyStock(rig.human, rig.cat);

    state.quest.phase = 'assault';
    const announcedBefore = rig.announced.length;
    check(system.tryInteract(rig.human, null), 'under siege: the press is taken');
    check(
      rig.announced.slice(announcedBefore).includes(CONTRACT_SIEGE_LINE) && !system.isWorking,
      'under siege: the spot refuses work and says why',
    );
    check(sameCost(partyStock(rig.human, rig.cat), before), 'under siege: nothing is spent');
    check(!active.spotsDone[inReach.index], 'under siege: the spot stays unfinished');
    state.quest.phase = PEACETIME_PHASE;

    check(
      system.tryInteract(rig.human, null),
      `${site.name}: Space starts work on "${inReach.def.id}"`,
    );
    check(system.isWorking, `${site.name}: the channel runs`);
    const frames = contractSpotFrames(inReach.def, 0) + CHANNEL_SLACK_FRAMES;
    for (let frame = 0; frame < frames && system.isWorking; frame++) rig.step();
    check(
      !system.isWorking && active.spotsDone[inReach.index],
      `${site.name}: the channel finishes the spot`,
    );
    check(
      sameCost(stockSpent(before, partyStock(rig.human, rig.cat)), inReach.def.cost),
      `${site.name}: the channel spent the spot's cost`,
    );

    for (const spot of system.work.spots) system.work.finishSpot(spot.index, rig.human);
    state.quest.phase = 'assault';
    check(
      system.isReady && system.markerFor(site.contact) === 'none',
      'under siege: a ready contact waits, no ?',
    );
    state.quest.phase = PEACETIME_PHASE;
    check(system.markerFor(site.contact) === 'question', 'after the siege: the ? comes back');
  } finally {
    state.quest.phase = PEACETIME_PHASE;
    rig.dispose();
  }
}

function verifyShortAndDrop(check: Check): void {
  const site = firstVillageSite();
  const state = createBriarHollowState();
  const active = issueAt(state, site);
  if (active === null) {
    check(false, `${site.name}: a contract is issued`);
    return;
  }
  const rig = villageRig(state);
  try {
    const system = rig.kit.contracts;
    if (system === null) {
      check(false, 'the kit builds its contracts');
      return;
    }
    const spot = system.work.spots.find((candidate) =>
      Object.values(candidate.def.cost).some((amount) => amount > 0),
    );
    if (spot === undefined) {
      check(false, 'a spot with a cost to fall short of');
      return;
    }
    const { cost } = spot.def;
    const shortOn = cost.wood_board > 0 ? 'wood_board' : cost.rope > 0 ? 'rope' : 'stone';
    rig.human.inventory.addItem('wood_board', cost.wood_board - (shortOn === 'wood_board' ? 1 : 0));
    rig.human.inventory.addItem('rope', cost.rope - (shortOn === 'rope' ? 1 : 0));
    rig.human.inventory.addItem('stone', cost.stone - (shortOn === 'stone' ? 1 : 0));
    const before = partyStock(rig.human, rig.cat);
    const announcedBefore = rig.announced.length;
    check(!system.work.finishSpot(spot.index, rig.human), `one ${shortOn} short: the spot refuses`);
    check(
      rig.announced.slice(announcedBefore).includes(CONTRACT_SHORT_MESSAGE),
      'one short: the party is told',
    );
    check(sameCost(partyStock(rig.human, rig.cat), before), 'one short: nothing is spent');
    check(!active.spotsDone[spot.index], 'one short: the spot stays unfinished');

    verifyDoorBeamGoesInside(check, rig, site);

    rig.step();
    const hiddenWhileHeld = rig.map.hiddenDecorationTiles.size;
    dropContract(state.contracts);
    rig.step();
    check(state.contracts.active === null, 'drop: no contract held');
    check(system.work.spots.length === 0, 'drop: no spot left to work');
    check(system.topBandEntries().length === 0, 'drop: the counter is gone');
    check(
      rig.map.hiddenDecorationTiles.size === 0,
      `drop: every stripped prop draws again (${hiddenWhileHeld} hidden while held)`,
    );

    state.blueprints.phase = 'complete';
    const idleEntries = system.trackerEntries();
    const idleEntry = idleEntries.find((entry) => entry.id === CONSTRUCTION_CONTRACT_QUEST_ID);
    check(idleEntry?.status === 'available', 'idle: the Journal offers a contract');
    check(
      objectiveBeamTargets(null, idleEntries).length === 0,
      "idle, unpinned: no beam stands on Wendell's house; he wears his own glow indoors",
    );
    const idleBeams = objectiveBeamTargets(pinnedBeamTarget(idleEntries), idleEntries);
    check(
      idleBeams.length === 1 && idleBeams[0] === idleEntry?.target,
      "idle, pinned: the beam stands on Wendell's door",
    );
    check(
      system.questMarkers.length === 1 && system.questMarkers[0].type === 'exclamation',
      "idle: the minimap marks Wendell's house with a !",
    );
  } finally {
    rig.dispose();
  }
}

/** What the scene's pin resolves to with the contract pinned. */
function pinnedBeamTarget(entries: ReadonlyArray<TrackerEntry>): TrackerTarget | null {
  return resolvePinnedEntry(CONSTRUCTION_CONTRACT_QUEST_ID, entries)?.target ?? null;
}

/** The pinned beam stands at a village site's doorway, and goes once the party is inside. */
function verifyDoorBeamGoesInside(
  check: Check,
  rig: SiegeRig,
  site: BriarHollowContractSiteDef,
): void {
  const system = rig.kit.contracts;
  const building = rig.map.briarHollow?.buildings.find(
    (candidate) => candidate.id === site.buildingId,
  );
  if (system === null || building === undefined) {
    check(false, `${site.name}: the building stands in the village`);
    return;
  }
  const door = pinnedBeamTarget(system.trackerEntries());
  if (door === null) {
    check(false, `${site.name}: the Journal points at the doorway`);
    return;
  }
  standAt(rig.human, door.x, door.y);
  const outsideEntries = system.trackerEntries();
  const outsideBeams = objectiveBeamTargets(pinnedBeamTarget(outsideEntries), outsideEntries);
  check(outsideBeams.length === 1, `${site.name}: outside, the pinned beam stands at the doorway`);

  const inside = rectCentre(building.interior);
  standAt(rig.human, inside.x, inside.y);
  const insideEntries = system.trackerEntries();
  check(
    objectiveBeamTargets(pinnedBeamTarget(insideEntries), insideEntries).length === 0,
    `${site.name}: inside, the doorway beam is gone`,
  );
  check(system.questMarkers.length === 1, `${site.name}: inside, the minimap pip stays`);
}

/**
 * After a payout, a pin the contract's start set automatically is let go, so
 * the offer of another lights nothing on Wendell's door; a pin the player
 * chose survives and keeps lighting it.
 */
function verifyPinAfterPayout(check: Check, pinSource: PinSource): void {
  const site = firstVillageSite();
  const state = createBriarHollowState();
  const active = issueAt(state, site);
  if (active === null) {
    check(false, `${site.name}: a contract is issued`);
    return;
  }
  const rig = villageRig(state);
  try {
    const system = rig.kit.contracts;
    if (system === null) {
      check(false, 'the kit builds its contracts');
      return;
    }
    const progress = createJournalProgress();
    const stopReleasing = releaseContractAutoPinOnEnd(rig.bus, progress);
    progress.pinnedTrackerId = CONSTRUCTION_CONTRACT_QUEST_ID;
    progress.pinSource = pinSource;
    stockUp(rig.human, PLENTY_OF_EACH_MATERIAL);
    for (const spot of system.work.spots) system.work.finishSpot(spot.index, rig.human);
    check(system.settlement.settle(rig.human) !== null, `${pinSource} pin: the contract pays out`);
    stopReleasing();
    const entries = system.trackerEntries();
    const offer = entries.find((entry) => entry.id === CONSTRUCTION_CONTRACT_QUEST_ID);
    check(offer?.status === 'available', `${pinSource} pin: the Journal offers another contract`);
    const pinned = resolvePinnedEntry(progress.pinnedTrackerId, entries)?.target ?? null;
    const beams = objectiveBeamTargets(pinned, entries);
    if (pinSource === 'auto') {
      check(
        progress.pinnedTrackerId === null && beams.length === 0,
        "auto pin: after the payout no beam stands on Wendell's door",
      );
    } else {
      check(
        beams.length === 1 && beams[0] === offer?.target,
        "player pin: after the payout the beam still stands on Wendell's door",
      );
    }
  } finally {
    rig.dispose();
  }
}

export const flowSections: ReadonlyArray<{
  readonly name: string;
  readonly run: (check: Check) => void;
}> = [
  {
    name: 'Flow: every Skyfowl Town site worked and paid',
    run: (check) => {
      for (const site of CONTRACT_SITES)
        if (site.town === 'skyfowl') verifySkyfowlSite(check, site);
    },
  },
  {
    name: 'Flow: every Briar Hollow site worked and paid',
    run: (check) => {
      for (const site of CONTRACT_SITES) {
        if (site.town === 'briar_hollow') verifyVillageSite(check, site);
      }
    },
  },
  { name: 'Flow: a real channel, and the siege refusing it', run: verifySiegeAndChannel },
  { name: 'Flow: short of materials, and a dropped contract', run: verifyShortAndDrop },
  {
    name: 'Flow: the Journal pin after a payout',
    run: (check) => {
      verifyPinAfterPayout(check, 'auto');
      verifyPinAfterPayout(check, 'player');
    },
  },
];
