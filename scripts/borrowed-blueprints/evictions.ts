/**
 * Losing and regaining quest items, for `verify:borrowed-blueprints`.
 *
 * Carrying a quest item evicts whatever other quest item held the one
 * reserved slot. These checks hold every quest to surviving that:
 * - Merrit's scythe and Tikka's blueprints, evicted mid-step, send guidance
 *   back to the barn wall / Wendell, and taking them again resumes the step
 *   with every fence section, grain and upgraded station still counted;
 * - the crawlers remark on it, but only when another quest's item did it —
 *   never when this quest takes its own items back, or moves one of its
 *   items on to the other;
 * - Hilda's Barricade Boards, evicted by this quest's items, come back from
 *   her wood pile, and a walk over the pile takes the boards even when that
 *   evicts this quest's item — which then comes back from Wendell as usual;
 * - a quest that ends retires only its own item from the slot.
 *
 * Stood up on the same real village and quest system as the station checks,
 * and on real interiors for Wendell and Hilda, so the gate needs no scene.
 */

import { createAnchorQuestProgress } from '../../src/core/AnchorQuestProgress';
import { createBriarHollowState } from '../../src/core/briarHollowState';
import { BLUEPRINTS_GRAIN_TARGET } from '../../src/core/blueprintsQuestPhase';
import { TILE_SIZE } from '../../src/core/constants';
import { QUEST_SLOT_IDX, type ItemId } from '../../src/core/ItemDefs';
import type { CrawlerKind } from '../../src/core/SkillManager';
import type { CatPlayer } from '../../src/creatures/CatPlayer';
import type { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { Conversation } from '../../src/dialog/Conversation';
import { GameMap } from '../../src/map/GameMap';
import { PASTURE_FENCE_SECTION_COUNT } from '../../src/map/overworld/briarHollowLayout';
import type { Player } from '../../src/Player';
import {
  AnchorInteriorSystem,
  HILDA_COTTAGE_NAME,
  WOOD_PILE_RESPAWN_SECONDS,
} from '../../src/systems/AnchorInteriorSystem';
import {
  PLUMBLINE_FARM_NAME,
  grantBlueprintsItem,
  takeBlueprintsItem,
} from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import { barkWhenBlueprintsItemEvicted } from '../../src/systems/briarHollow/blueprints/blueprintsEvictionBark';
import { plumblineFarmStateFor } from '../../src/systems/briarHollow/blueprints/plumblineFarmRoom';
import { WendellBlueprintsHook } from '../../src/systems/briarHollow/blueprints/WendellBlueprintsHook';
import { forwardQuestItemEvictions } from '../../src/systems/questItemEvictions';
import type { Check } from './fenna';
import { stationsRig, type StationsRig } from './stations';

/** Grain already cut when the scythe is lost: partway, so a reset to zero would show. */
const GRAIN_BEFORE_LOSS = 40;
/** Plumbline Farm's ground floor, where Wendell stands. */
const WENDELL_FLOOR = 0;
/** More presses than any of Wendell's beats has pages. */
const MAX_PRESSES_PER_BEAT = 2000;
const UPDATES_PER_SECOND = 60;
/** A frame past the pile's own restock time, so rounding can never leave it one short. */
const PILE_RESTOCK_FRAMES = WOOD_PILE_RESPAWN_SECONDS * UPDATES_PER_SECOND + 1;
/** Far enough from Hilda's pile that it is out of pickup reach. */
const AWAY_FROM_PILE_TILES = 4;

const SCYTHE_BARK = 'We left the scythe behind.';
const BLUEPRINTS_BARK = 'We left the blueprints behind.';

interface Remark {
  readonly speaker: Player;
  readonly lines: readonly string[];
}

/** The quest's village with evictions forwarded and every remark about them recorded. */
interface EvictionRig extends StationsRig {
  readonly remarks: Remark[];
  readonly evicted: ItemId[];
}

function evictionRig(prepare: (rig: StationsRig) => void): EvictionRig | null {
  const state = createBriarHollowState();
  const base = stationsRig(state);
  if (base === null) return null;
  prepare(base);
  const remarks: Remark[] = [];
  const evicted: ItemId[] = [];
  const crawlers: Readonly<Record<CrawlerKind, Player>> = { human: base.human, cat: base.cat };
  base.bus.on('questItemEvicted', (event) => evicted.push(event.itemId));
  forwardQuestItemEvictions(base.bus, crawlers);
  barkWhenBlueprintsItemEvicted(base.bus, crawlers, {
    say: (speaker, lines) => remarks.push({ speaker, lines }),
  });
  return { ...base, remarks, evicted };
}

function questSlotItem(crawler: HumanPlayer | CatPlayer): ItemId | null {
  return crawler.inventory.actionBar.slots[QUEST_SLOT_IDX]?.id ?? null;
}

function remarkText(remark: Remark | undefined): string {
  return remark?.lines.join(' ') ?? '(nothing)';
}

function fenceSectionsBuilt(rig: StationsRig): number {
  return rig.state.blueprints.fenceSectionsBuilt.filter(Boolean).length;
}

/** Talks `crawler` through Wendell handing the blueprints back, checking he is ready to. */
function wendellHandsBackBlueprints(
  check: Check,
  rig: EvictionRig,
  crawler: HumanPlayer | CatPlayer,
): void {
  const conversation = new Conversation(null);
  const wendell = WendellBlueprintsHook.forBuilding(PLUMBLINE_FARM_NAME, WENDELL_FLOOR, {
    state: rig.state,
    bus: rig.bus,
    audio: null,
    conversation,
    human: rig.human,
    cat: rig.cat,
    toast: () => undefined,
    onItemGranted: () => undefined,
  });
  check(wendell?.markerFor('wendell') === 'question', 'Wendell wears a "?" for them');
  check(wendell?.tryOpenDialog('wendell', crawler) === true, 'talking to him opens the hand-back');
  for (let press = 0; press < MAX_PRESSES_PER_BEAT && conversation.isOpen; press++) {
    conversation.update(null);
    if (conversation.isOpen) conversation.advance();
  }
}

/** Hilda's cottage mid-repair, stood up on `rig`'s crawlers, or null when it has no wood pile. */
function hildaCottage(
  rig: EvictionRig,
): { readonly room: AnchorInteriorSystem; readonly pile: { x: number; y: number } } | null {
  const progress = createAnchorQuestProgress();
  progress.status = 'active';
  progress.hilda = 'in_progress';
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('house', 0, HILDA_COTTAGE_NAME, false);
  const room = AnchorInteriorSystem.forBuilding(
    HILDA_COTTAGE_NAME,
    0,
    progress,
    map,
    () => [rig.human, rig.cat],
    () => undefined,
    () => undefined,
    new Conversation(null),
    null,
  );
  const pile = room?.stockedWoodPileTile ?? null;
  if (room === null || pile === null) return null;
  return { room, pile: { x: pile.x, y: pile.y } };
}

function standAt(crawler: Player, tileX: number, tileY: number): void {
  crawler.x = tileX * TILE_SIZE;
  crawler.y = tileY * TILE_SIZE;
}

/** The scythe evicted mid-harvest: guidance back to the pegs, the pegs full again, the grain kept. */
export function verifyScytheEvictionRecovery(check: Check): void {
  const rig = evictionRig((setup) => {
    setup.state.blueprints.phase = 'harvest_grain';
    setup.state.blueprints.grain = GRAIN_BEFORE_LOSS;
    setup.state.blueprints.fenceSectionsBuilt.fill(true);
  });
  const pegs = rig?.quest.harvest.scytheTile() ?? null;
  if (rig === null || pegs === null) {
    check(false, 'the test village has a barn with scythe pegs');
    return;
  }
  const { human } = rig;
  human.x = pegs.x * TILE_SIZE;
  human.y = (pegs.y + 1) * TILE_SIZE;
  check(rig.quest.tryInteract(human), 'Carl takes the scythe off the barn wall');
  check(rig.quest.guidance()?.kind === 'grain_field', 'with it held, guidance is the grain field');

  human.inventory.addItem('doomsday_scenario', 1);
  check(
    questSlotItem(human) === 'doomsday_scenario' && !rig.quest.scytheHeld,
    "another quest's item takes the slot and the scythe is gone",
  );
  const guidance = rig.quest.guidance();
  check(
    guidance?.kind === 'scythe' && guidance.at.x === pegs.x && guidance.at.y === pegs.y,
    'guidance points back to the barn wall',
  );
  check(
    rig.quest.trackerEntries()[0]?.objective === "Take Merrit's scythe from the barn wall",
    'the journal sends the party back for it',
  );
  rig.quest.update();
  check(
    rig.map.structure[pegs.y]?.[pegs.x]?.scytheTaken !== true,
    'the pegs show the scythe again',
  );
  check(
    rig.remarks.length === 1 &&
      rig.remarks[0].speaker === human &&
      remarkText(rig.remarks[0]) === SCYTHE_BARK,
    `Carl, whose slot it was, says "${SCYTHE_BARK}" (said: ${remarkText(rig.remarks[0])})`,
  );

  check(rig.quest.tryInteract(human), 'the scythe can be taken again');
  check(questSlotItem(human) === 'quest_scythe', 'and it is back in the quest slot');
  check(
    rig.remarks.length === 1,
    'taking it back evicts the crystal, which is not this quest’s to remark on',
  );
  check(
    rig.state.blueprints.phase === 'harvest_grain' &&
      rig.state.blueprints.grain === GRAIN_BEFORE_LOSS &&
      rig.quest.counterText() === `${GRAIN_BEFORE_LOSS}/${BLUEPRINTS_GRAIN_TARGET} grain`,
    'the step resumes with the grain already cut',
  );
  check(
    fenceSectionsBuilt(rig) === PASTURE_FENCE_SECTION_COUNT,
    'and every fence section still built',
  );
  check(rig.quest.guidance()?.kind === 'grain_field', 'guidance is the grain field again');
}

/** The crawler whose slot was taken is down: the partner notices instead. */
export function verifyKnockedOutRemark(check: Check): void {
  const rig = evictionRig((setup) => {
    setup.state.blueprints.phase = 'harvest_grain';
  });
  if (rig === null) {
    check(false, 'the test village stands up');
    return;
  }
  grantBlueprintsItem(rig.cat, 'quest_scythe');
  rig.cat.isKnockedOut = true;
  rig.cat.inventory.addItem('doomsday_scenario', 1);
  check(
    rig.remarks.length === 1 &&
      rig.remarks[0].speaker === rig.human &&
      remarkText(rig.remarks[0]) === SCYTHE_BARK,
    'with Donut knocked out, Carl says it',
  );
}

/** The blueprints evicted while building: guidance back to Wendell, who hands them over again. */
export function verifyBlueprintsEvictionRecovery(check: Check): void {
  const rig = evictionRig((setup) => {
    setup.state.blueprints.phase = 'build_stations';
    setup.state.blueprints.stationsUpgraded.saw = true;
    setup.state.blueprints.fenceSectionsBuilt.fill(true);
  });
  if (rig === null) {
    check(false, 'the test village stands up');
    return;
  }
  const { human, cat } = rig;
  cat.isActive = true;
  human.isActive = false;
  grantBlueprintsItem(cat, 'quest_blueprints');
  check(
    rig.quest.guidance()?.kind !== 'town_building',
    'with the blueprints held, guidance is the stations',
  );

  cat.inventory.addItem('doomsday_scenario', 1);
  check(!rig.quest.blueprintsHeld, "another quest's item takes the slot and the blueprints go");
  const guidance = rig.quest.guidance();
  check(
    guidance?.kind === 'town_building' &&
      guidance.buildingName === PLUMBLINE_FARM_NAME &&
      guidance.residentName === 'Wendell',
    'guidance points back to Wendell at Plumbline Farm',
  );
  check(
    rig.quest.trackerEntries()[0]?.objective ===
      'Fetch the blueprints from Wendell at Plumbline Farm',
    'the journal sends the party back for them',
  );
  check(
    plumblineFarmStateFor(rig.state.blueprints.phase, [human, cat]).blueprintsInPlanChest,
    "Wendell's plan chest shows them again",
  );
  check(
    rig.remarks.length === 1 &&
      rig.remarks[0].speaker === cat &&
      remarkText(rig.remarks[0]) === BLUEPRINTS_BARK,
    `Donut, whose slot it was, says "${BLUEPRINTS_BARK}" (said: ${remarkText(rig.remarks[0])})`,
  );

  wendellHandsBackBlueprints(check, rig, cat);
  check(questSlotItem(cat) === 'quest_blueprints', 'Donut holds the blueprints again');
  check(rig.remarks.length === 1, 'the crystal they evicted draws no remark');
  check(
    rig.state.blueprints.phase === 'build_stations' &&
      rig.state.blueprints.stationsUpgraded.saw &&
      !rig.state.blueprints.stationsUpgraded.ropeWalk,
    'the step resumes with the saw still upgraded',
  );
  check(rig.quest.guidance()?.kind !== 'town_building', 'guidance is back on the stations');
}

/** The quest moving its own items on is never "leaving something behind". */
export function verifyOwnRemovalsAreQuiet(check: Check): void {
  const rig = evictionRig((setup) => {
    setup.state.blueprints.phase = 'harvest_grain';
  });
  if (rig === null) {
    check(false, 'the test village stands up');
    return;
  }
  const { human, cat } = rig;

  grantBlueprintsItem(human, 'quest_scythe');
  takeBlueprintsItem([human, cat], 'quest_scythe');
  check(
    rig.evicted.length === 0 && rig.remarks.length === 0,
    'the scythe going back on the wall at the grain hand-in is no eviction and no remark',
  );

  grantBlueprintsItem(human, 'quest_scythe');
  grantBlueprintsItem(human, 'quest_blueprints');
  check(
    rig.evicted.join() === 'quest_scythe' && rig.remarks.length === 0,
    "one of this quest's items replacing the other evicts, but draws no remark",
  );

  rig.state.blueprints.phase = 'build_stations';
  rig.quest.complete();
  check(
    rig.quest.phase === 'complete' && !rig.quest.blueprintsHeld,
    'completion retires the blueprints',
  );
  check(rig.evicted.length === 1 && rig.remarks.length === 0, 'with no eviction and no remark');

  human.inventory.addItem('quest_wood_board', 1);
  grantBlueprintsItem(human, 'quest_scythe');
  check(
    rig.evicted[rig.evicted.length - 1] === 'quest_wood_board' && rig.remarks.length === 0,
    "another quest's item evicted by this one's is not this quest's to remark on",
  );
}

/**
 * Hilda's boards, evicted by this quest's scythe, come back from her pile —
 * and walking over the pile with the scythe takes the boards, evicting it.
 */
export function verifyHildaBoardsRecover(check: Check): void {
  const rig = evictionRig(() => undefined);
  const cottage = rig === null ? null : hildaCottage(rig);
  if (rig === null || cottage === null) {
    check(false, "Hilda's cottage stocks a wood pile while her repairs are under way");
    return;
  }
  const { human, cat } = rig;
  const { room, pile } = cottage;
  const awayX = pile.x + AWAY_FROM_PILE_TILES;
  standAt(cat, awayX, pile.y);
  standAt(human, pile.x, pile.y);
  room.update();
  const boardsTaken = human.inventory.countOf('quest_wood_board');
  check(boardsTaken > 0, `Carl picks up boards from the pile (${boardsTaken})`);
  standAt(human, awayX, pile.y);

  grantBlueprintsItem(human, 'quest_scythe');
  check(
    human.inventory.countOf('quest_wood_board') === 0 && rig.evicted.join() === 'quest_wood_board',
    "the scythe evicts Carl's boards",
  );

  for (let frame = 0; frame < PILE_RESTOCK_FRAMES; frame++) room.update();
  check(room.stockedWoodPileTile !== null, 'the pile restocks');

  standAt(cat, pile.x, pile.y);
  room.update();
  check(
    cat.inventory.countOf('quest_wood_board') === boardsTaken,
    'Donut, with a free quest slot, picks the boards back up',
  );
  check(rig.remarks.length === 0, "the boards are not this quest's to remark on");

  standAt(cat, awayX, pile.y);
  for (let frame = 0; frame < PILE_RESTOCK_FRAMES; frame++) room.update();
  standAt(human, pile.x, pile.y);
  room.update();
  check(
    questSlotItem(human) === 'quest_wood_board' && room.stockedWoodPileTile === null,
    'Carl, walking over the pile with the scythe, takes the boards',
  );
  check(
    rig.evicted[rig.evicted.length - 1] === 'quest_scythe' &&
      remarkText(rig.remarks[0]) === SCYTHE_BARK,
    `evicting the scythe, and Carl says "${SCYTHE_BARK}" (said: ${remarkText(rig.remarks[0])})`,
  );
}

/**
 * The blueprints held while fetching Hilda's wood: the pile puts the boards in
 * the quest slot anyway, and the blueprints go back to Wendell.
 */
export function verifyWoodPileEvictsBlueprints(check: Check, kind: CrawlerKind): void {
  const rig = evictionRig((setup) => {
    setup.state.blueprints.phase = 'build_stations';
    setup.state.blueprints.stationsUpgraded.saw = true;
  });
  const cottage = rig === null ? null : hildaCottage(rig);
  if (rig === null || cottage === null) {
    check(false, "the test village stands up, with Hilda's wood pile stocked");
    return;
  }
  const { room, pile } = cottage;
  const carrier = kind === 'human' ? rig.human : rig.cat;
  const partner = kind === 'human' ? rig.cat : rig.human;
  const name = kind === 'human' ? 'Carl' : 'Donut';
  carrier.isActive = true;
  partner.isActive = false;
  grantBlueprintsItem(carrier, 'quest_blueprints');
  standAt(partner, pile.x + AWAY_FROM_PILE_TILES, pile.y);
  standAt(carrier, pile.x, pile.y);
  room.update();

  check(
    questSlotItem(carrier) === 'quest_wood_board' &&
      carrier.inventory.countOf('quest_wood_board') > 0,
    `${name}, holding the blueprints, walks over the pile and the boards are in the quest slot`,
  );
  check(
    partner.inventory.countOf('quest_wood_board') === 0,
    `the boards go to ${name}, not the partner across the room`,
  );
  check(
    rig.evicted.join() === 'quest_blueprints',
    `questItemEvicted reports the blueprints (reported: ${rig.evicted.join() || 'nothing'})`,
  );
  check(
    rig.remarks.length === 1 &&
      rig.remarks[0].speaker === carrier &&
      remarkText(rig.remarks[0]) === BLUEPRINTS_BARK,
    `${name} says "${BLUEPRINTS_BARK}" (said: ${remarkText(rig.remarks[0])})`,
  );
  check(!rig.quest.blueprintsHeld, 'the quest no longer sees the blueprints held');
  const guidance = rig.quest.guidance();
  check(
    guidance?.kind === 'town_building' &&
      guidance.buildingName === PLUMBLINE_FARM_NAME &&
      guidance.residentName === 'Wendell',
    'guidance points back to Wendell at Plumbline Farm',
  );
  check(
    rig.quest.trackerEntries()[0]?.objective ===
      'Fetch the blueprints from Wendell at Plumbline Farm',
    'the journal sends the party back for them',
  );
  check(
    plumblineFarmStateFor(rig.state.blueprints.phase, [rig.human, rig.cat]).blueprintsInPlanChest,
    "Wendell's plan chest shows them again",
  );
  wendellHandsBackBlueprints(check, rig, carrier);
  check(questSlotItem(carrier) === 'quest_blueprints', `${name} holds the blueprints again`);
  check(
    rig.state.blueprints.phase === 'build_stations' && rig.state.blueprints.stationsUpgraded.saw,
    'the step resumes with the saw still upgraded',
  );
}

/** Both crawlers at the pile at once: the one with nothing to lose takes the wood. */
export function verifyWoodPilePrefersFreeSlot(check: Check): void {
  const rig = evictionRig((setup) => {
    setup.state.blueprints.phase = 'build_stations';
  });
  const cottage = rig === null ? null : hildaCottage(rig);
  if (rig === null || cottage === null) {
    check(false, "the test village stands up, with Hilda's wood pile stocked");
    return;
  }
  const { human, cat } = rig;
  const { room, pile } = cottage;
  grantBlueprintsItem(human, 'quest_blueprints');
  standAt(human, pile.x, pile.y);
  standAt(cat, pile.x, pile.y);
  room.update();
  check(
    questSlotItem(human) === 'quest_blueprints' && questSlotItem(cat) === 'quest_wood_board',
    'Donut takes the boards and Carl keeps the blueprints',
  );
  check(rig.evicted.length === 0, 'and nothing is evicted');
}

/** A finished quest clears its own item from the slot and leaves another quest's alone. */
export function verifyQuestEndClearsOnlyItsOwnItem(check: Check): void {
  const rig = evictionRig(() => undefined);
  if (rig === null) {
    check(false, 'the test village stands up');
    return;
  }
  const { human, cat } = rig;
  grantBlueprintsItem(human, 'quest_scythe');
  cat.inventory.addItem('quest_wood_board', 1);
  human.inventory.clearQuestItem('quest_wood_board');
  cat.inventory.clearQuestItem('quest_wood_board');
  check(
    questSlotItem(human) === 'quest_scythe' && questSlotItem(cat) === null,
    "the defend quest ending takes its boards and leaves Merrit's scythe",
  );
}

/** Every eviction section, for the runner's `SECTIONS`. */
export function evictionSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    { name: 'Evictions: the scythe comes back', run: () => verifyScytheEvictionRecovery(check) },
    {
      name: 'Evictions: a downed crawler’s partner remarks',
      run: () => verifyKnockedOutRemark(check),
    },
    {
      name: 'Evictions: the blueprints come back',
      run: () => verifyBlueprintsEvictionRecovery(check),
    },
    {
      name: 'Evictions: the quest moving its own items is quiet',
      run: () => verifyOwnRemovalsAreQuiet(check),
    },
    { name: "Evictions: Hilda's boards come back", run: () => verifyHildaBoardsRecover(check) },
    {
      name: "Evictions: Hilda's pile evicts Carl's blueprints",
      run: () => verifyWoodPileEvictsBlueprints(check, 'human'),
    },
    {
      name: "Evictions: Hilda's pile evicts Donut's blueprints",
      run: () => verifyWoodPileEvictsBlueprints(check, 'cat'),
    },
    {
      name: "Evictions: both at Hilda's pile, the free slot takes it",
      run: () => verifyWoodPilePrefersFreeSlot(check),
    },
    {
      name: 'Evictions: a quest ending clears only its own item',
      run: () => verifyQuestEndClearsOnlyItsOwnItem(check),
    },
  ];
}
