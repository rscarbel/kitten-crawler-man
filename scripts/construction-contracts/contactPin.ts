/**
 * A Briar Hollow contract's contact held indoors, for
 * `verify:construction-contracts`.
 *
 * Read from positions only, the way a player sees it: with a contract on a
 * village building, its contact (a civilian, or Sedge for the guardhouse)
 * ends up inside that building and stays on one tile, frame after frame. The
 * siege still sends them where the siege always does, and they come back
 * afterwards. Once the contract is paid out or dropped they are back on their
 * own round, and a scene rebuilt on a state with no contract holds no one.
 */

import type { BriarHollowState } from '../../src/core/briarHollowState';
import { createBriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import type { VillageQuestPhase } from '../../src/core/villageQuestPhase';
import type { TilePoint, TileRect } from '../../src/map/town/townPlan';
import {
  CONTRACT_SITES,
  type BriarHollowContractSiteDef,
} from '../../src/systems/constructionContracts/contractCatalog';
import {
  dropContract,
  issueContract,
} from '../../src/systems/constructionContracts/contractGenerator';
import { RATKIN_SOLDIER_IDS, type RatkinSoldierId } from '../../src/sprites/art/ratkin/cast';
import { buildSiegeRig, UPDATES_PER_SECOND, type SiegeRig } from '../villageSiegeHarness';
import type { Check } from './shared';
import { PLENTY_OF_EACH_MATERIAL, stockUp } from './shared';

const CONTRACT_SEED = 4242;
const VILLAGE_SEED = 7919;
const RIG_ASSAULT_LEVEL = 6;
const PEACETIME_PHASE = 'complete' satisfies VillageQuestPhase;
/** Long enough for the slowest villager to cross the village and settle. */
const SETTLE_SECONDS = 75;
const SETTLE_FRAMES = SETTLE_SECONDS * UPDATES_PER_SECOND;
/** Past the village's staggered return from shelter, plus the walk across one room. */
const INDOOR_SETTLE_SECONDS = 9;
const INDOOR_SETTLE_FRAMES = INDOOR_SETTLE_SECONDS * UPDATES_PER_SECOND;
/** How long a held contact is watched for not wandering off. */
const HOLD_WATCH_SECONDS = 40;
const HOLD_WATCH_FRAMES = HOLD_WATCH_SECONDS * UPDATES_PER_SECOND;
/** The village lives its day for this long before the contract is taken. */
const WARM_UP_SECONDS = 5;
const WARM_UP_FRAMES = WARM_UP_SECONDS * UPDATES_PER_SECOND;
/** Long enough for the siege's alarm to send everyone where the siege wants them. */
const SIEGE_REACT_SECONDS = 20;
const SIEGE_REACT_FRAMES = SIEGE_REACT_SECONDS * UPDATES_PER_SECOND;
/** The siege's countdown, held well beyond the check so no wave ever starts. */
const HELD_COUNTDOWN_FRAMES = 1_000_000;
/** More presses than any thanks has pages. */
const MAX_PRESSES_PER_TALK = 2000;
const TILE_CENTRE = 0.5;

/** Contacts walked through the live case: a farmer held in each of her two buildings, a shopkeeper, the quarryman and the militia's sergeant. */
const LIVE_SITE_IDS: readonly BriarHollowContractSiteDef['buildingId'][] = [
  'farmhouse',
  'barn',
  'cookhouse',
  'garn_hut',
  'guardhouse',
];

function isSoldierId(id: string): id is RatkinSoldierId {
  return RATKIN_SOLDIER_IDS.some((soldierId) => soldierId === id);
}

function villageSites(): BriarHollowContractSiteDef[] {
  return CONTRACT_SITES.flatMap((site) => (site.town === 'briar_hollow' ? [site] : []));
}

function issueAt(state: BriarHollowState, site: BriarHollowContractSiteDef): boolean {
  state.blueprints.phase = 'complete';
  state.quest.phase = PEACETIME_PHASE;
  return issueContract(state.contracts, (candidate) => candidate === site, CONTRACT_SEED) !== null;
}

function villageRig(state: BriarHollowState): SiegeRig {
  const rig = buildSiegeRig({ seed: VILLAGE_SEED, state, assaultLevel: RIG_ASSAULT_LEVEL });
  rig.human.godMode = true;
  rig.cat.godMode = true;
  rig.human.isActive = true;
  return rig;
}

/** Where the contact stands now, by the tile under their centre; null when they are nowhere in the village. */
function contactTile(
  rig: SiegeRig,
  contact: BriarHollowContractSiteDef['contact'],
): TilePoint | null {
  if (isSoldierId(contact)) return rig.kit.soldiers?.soldierById(contact)?.tile ?? null;
  const villager = rig.kit.villagers?.villagerFor(contact) ?? null;
  if (villager === null) return null;
  return {
    x: Math.floor(villager.x / TILE_SIZE + TILE_CENTRE),
    y: Math.floor(villager.y / TILE_SIZE + TILE_CENTRE),
  };
}

function interiorOf(rig: SiegeRig, site: BriarHollowContractSiteDef): TileRect | null {
  return rig.site.buildings.find((building) => building.id === site.buildingId)?.interior ?? null;
}

function inside(rect: TileRect, tile: TilePoint): boolean {
  return (
    tile.x >= rect.x && tile.y >= rect.y && tile.x < rect.x + rect.w && tile.y < rect.y + rect.h
  );
}

function steps(rig: SiegeRig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) rig.step();
}

/** Steps until the contact is inside `rect`, or `frames` run out. Returns whether they got there. */
function stepUntilInside(
  rig: SiegeRig,
  contact: BriarHollowContractSiteDef['contact'],
  rect: TileRect,
  frames: number,
): boolean {
  for (let frame = 0; frame < frames; frame++) {
    rig.step();
    const tile = contactTile(rig, contact);
    if (tile !== null && inside(rect, tile)) return true;
  }
  return false;
}

/**
 * Settles the contact, then watches them for {@link HOLD_WATCH_FRAMES}:
 * true when every frame finds them inside `rect` on one and the same tile.
 */
function heldIndoors(
  rig: SiegeRig,
  contact: BriarHollowContractSiteDef['contact'],
  rect: TileRect,
): { readonly inside: boolean; readonly still: boolean; readonly detail: string } {
  stepUntilInside(rig, contact, rect, SETTLE_FRAMES);
  // A contact who sheltered in this same building waits out their turn to
  // leave before walking to the pin, so the watch starts once that is over.
  steps(rig, INDOOR_SETTLE_FRAMES);
  const first = contactTile(rig, contact);
  let allInside = first !== null && inside(rect, first);
  let still = first !== null;
  let wandered: TilePoint | null = null;
  for (let frame = 0; frame < HOLD_WATCH_FRAMES; frame++) {
    rig.step();
    const tile = contactTile(rig, contact);
    if (tile === null || !inside(rect, tile)) allInside = false;
    if (tile === null || first === null || tile.x !== first.x || tile.y !== first.y) {
      still = false;
      wandered ??= tile;
    }
  }
  const at = first === null ? 'nowhere' : `${first.x},${first.y}`;
  const off = wandered === null ? '' : ` → ${wandered.x},${wandered.y}`;
  return { inside: allInside, still, detail: `${at}${off}` };
}

function readThrough(rig: SiegeRig): void {
  const conversation = rig.kit.villagers?.conversation;
  if (conversation === undefined) return;
  for (let press = 0; press < MAX_PRESSES_PER_TALK && conversation.isOpen; press++) {
    conversation.update(null);
    if (conversation.isOpen) conversation.advance();
  }
}

/** Finishes every spot and pays the contract out through a real talk with its contact. */
function payOut(rig: SiegeRig, contact: BriarHollowContractSiteDef['contact']): boolean {
  const system = rig.kit.contracts;
  const { villagers, soldiers } = rig.kit;
  if (system === null || villagers === null) return false;
  stockUp(rig.human, PLENTY_OF_EACH_MATERIAL);
  for (const spot of system.work.spots) system.work.finishSpot(spot.index, rig.human);
  rig.step();
  if (isSoldierId(contact)) {
    const soldier = soldiers?.soldierById(contact) ?? null;
    if (soldier === null || soldiers === null) return false;
    soldiers.talkTo(soldier, rig.human);
  } else {
    const villager = villagers.villagerFor(contact);
    if (villager === null) return false;
    villagers.talkTo(villager, rig.human);
  }
  readThrough(rig);
  rig.step();
  return rig.state.contracts.active === null;
}

/** Whether the contact's own round lies outside the building: they must walk out once let go. */
function postOutside(
  rig: SiegeRig,
  contact: BriarHollowContractSiteDef['contact'],
  rect: TileRect,
): boolean {
  if (isSoldierId(contact)) return true;
  const villager = rig.kit.villagers?.villagerFor(contact) ?? null;
  return villager !== null && !inside(rect, villager.post);
}

/** A contract taken while the scene is already running: the contact walks in and stays. */
function verifyLiveSite(check: Check, site: BriarHollowContractSiteDef): void {
  const state = createBriarHollowState();
  state.blueprints.phase = 'complete';
  state.quest.phase = PEACETIME_PHASE;
  const rig = villageRig(state);
  try {
    const rect = interiorOf(rig, site);
    if (rect === null) {
      check(false, `${site.name}: the building stands in the village`);
      return;
    }
    steps(rig, WARM_UP_FRAMES);
    if (!issueAt(state, site)) {
      check(false, `${site.name}: a contract is issued`);
      return;
    }
    const held = heldIndoors(rig, site.contact, rect);
    check(
      held.inside && held.still,
      `${site.name}: ${site.contact} walks in and stays on one tile inside (${held.detail})`,
    );

    state.quest.imminentCountdownFrames = HELD_COUNTDOWN_FRAMES;
    state.quest.phase = 'imminent';
    steps(rig, SIEGE_REACT_FRAMES);
    const duringSiege = contactTile(rig, site.contact);
    const shelter = isSoldierId(site.contact)
      ? null
      : (rig.kit.villagers?.villagerFor(site.contact)?.shelter ?? null);
    const deferred = isSoldierId(site.contact)
      ? duringSiege !== null && !inside(rect, duringSiege)
      : duringSiege !== null &&
        shelter !== null &&
        duringSiege.x === shelter.x &&
        duringSiege.y === shelter.y;
    check(
      deferred,
      `${site.name}: under siege ${site.contact} ${isSoldierId(site.contact) ? 'leaves for the wall' : 'shelters'}`,
    );
    state.quest.phase = PEACETIME_PHASE;
    state.quest.imminentCountdownFrames = 0;
    const back = heldIndoors(rig, site.contact, rect);
    check(
      back.inside && back.still,
      `${site.name}: after the siege ${site.contact} is held inside again (${back.detail})`,
    );

    check(payOut(rig, site.contact), `${site.name}: the contract is paid out`);
    if (postOutside(rig, site.contact, rect)) {
      let left = false;
      for (let frame = 0; frame < SETTLE_FRAMES && !left; frame++) {
        rig.step();
        const tile = contactTile(rig, site.contact);
        left = tile !== null && !inside(rect, tile);
      }
      check(left, `${site.name}: once paid, ${site.contact} walks back out to their round`);
    } else {
      const villager = rig.kit.villagers?.villagerFor(site.contact) ?? null;
      steps(rig, SETTLE_FRAMES);
      const tile = contactTile(rig, site.contact);
      const atPostOrOut =
        villager !== null &&
        tile !== null &&
        ((tile.x === villager.post.x && tile.y === villager.post.y) ||
          villager.state !== 'working');
      check(atPostOrOut, `${site.name}: once paid, ${site.contact} is back on their round`);
    }
  } finally {
    state.quest.phase = PEACETIME_PHASE;
    rig.dispose();
  }
}

/** A scene built on a state that already holds a contract: every contact is indoors from the first frame on. */
function verifyRebuiltSites(check: Check): void {
  for (const site of villageSites()) {
    const state = createBriarHollowState();
    if (!issueAt(state, site)) {
      check(false, `${site.name}: a contract is issued`);
      continue;
    }
    const rig = villageRig(state);
    try {
      const rect = interiorOf(rig, site);
      if (rect === null) {
        check(false, `${site.name}: the building stands in the village`);
        continue;
      }
      const held = heldIndoors(rig, site.contact, rect);
      check(
        held.inside && held.still,
        `${site.name}: ${site.contact} is held inside on a rebuilt scene (${held.detail})`,
      );
      const tile = contactTile(rig, site.contact);
      const standingWork =
        rig.kit.contracts?.work.spots.filter(
          (spot) =>
            spot.footprint.surface !== 'floor' &&
            tile !== null &&
            inside(spot.footprint.rect, tile),
        ) ?? [];
      check(
        standingWork.length === 0,
        `${site.name}: ${site.contact} waits clear of the walls and furniture being worked`,
      );
    } finally {
      rig.dispose();
    }
  }
}

/** A dropped contract lets its contact go, and a scene rebuilt with no contract holds no one. */
function verifyDropAndRestore(check: Check): void {
  const site = villageSites().find((candidate) => candidate.buildingId === 'farmhouse');
  if (site === undefined) {
    check(false, 'the farmhouse hosts contracts');
    return;
  }
  const state = createBriarHollowState();
  if (!issueAt(state, site)) {
    check(false, `${site.name}: a contract is issued`);
    return;
  }
  const rig = villageRig(state);
  try {
    const rect = interiorOf(rig, site);
    if (rect === null) {
      check(false, `${site.name}: the building stands in the village`);
      return;
    }
    const held = heldIndoors(rig, site.contact, rect);
    check(held.inside && held.still, `${site.name}: held before the drop (${held.detail})`);
    dropContract(state.contracts);
    let left = false;
    for (let frame = 0; frame < SETTLE_FRAMES && !left; frame++) {
      rig.step();
      const tile = contactTile(rig, site.contact);
      left = tile !== null && !inside(rect, tile);
    }
    check(left, `drop: ${site.contact} walks back out to their round`);
  } finally {
    rig.dispose();
  }
  const rebuilt = villageRig(state);
  try {
    const rect = interiorOf(rebuilt, site);
    const tile = contactTile(rebuilt, site.contact);
    check(
      rect !== null && tile !== null && !inside(rect, tile),
      `restore with no contract: ${site.contact} starts on their round, not held indoors`,
    );
  } finally {
    rebuilt.dispose();
  }
}

/** Contract draws per site for the reach gate, so most of each pool's spots come up at least once. */
const REACH_GATE_SEEDS: readonly number[] = [4242, 1, 2, 3, 4, 5, 6, 7];
/** How far round a spot's footprint to look for a tile to press Space from: past `CONTRACT_REACH_TILES`. */
const REACH_SEARCH_TILES = 2;

/**
 * Whether a real Space press from somewhere walkable round `spot` starts its
 * work, with every other spot done and the contact held where they wait.
 */
function spotPressable(rig: SiegeRig, spotIndex: number, rect: TileRect): boolean {
  const system = rig.kit.contracts;
  if (system === null) return false;
  for (let y = rect.y - REACH_SEARCH_TILES; y < rect.y + rect.h + REACH_SEARCH_TILES; y++) {
    for (let x = rect.x - REACH_SEARCH_TILES; x < rect.x + rect.w + REACH_SEARCH_TILES; x++) {
      if (!rig.map.isWalkable(x, y)) continue;
      rig.human.x = x * TILE_SIZE;
      rig.human.y = y * TILE_SIZE;
      rig.human.isMoving = false;
      if (system.work.spotInReach(rig.human)?.index !== spotIndex) continue;
      const pressed = rig.kit.tryInteract(rig.human, false);
      const working = system.isWorking;
      system.cancelWork();
      rig.kit.villagers?.closeConversation();
      if (pressed && working) return true;
    }
  }
  return false;
}

/** Every spot of every village contract can be started with Space while its contact is held indoors. */
function verifySpotsPressable(check: Check): void {
  for (const site of villageSites()) {
    const blocked = new Set<string>();
    const seen = new Set<string>();
    for (const seed of REACH_GATE_SEEDS) {
      const state = createBriarHollowState();
      state.blueprints.phase = 'complete';
      state.quest.phase = PEACETIME_PHASE;
      const active = issueContract(state.contracts, (candidate) => candidate === site, seed);
      if (active === null) continue;
      const rig = villageRig(state);
      try {
        stockUp(rig.human, PLENTY_OF_EACH_MATERIAL);
        rig.step();
        const system = rig.kit.contracts;
        if (system === null) continue;
        for (const spot of system.work.spots) {
          active.spotsDone.forEach((_, index) => {
            active.spotsDone[index] = index !== spot.index;
          });
          seen.add(spot.def.id);
          if (!spotPressable(rig, spot.index, spot.footprint.rect)) blocked.add(spot.def.id);
          active.spotsDone.fill(false);
        }
        if (seed === REACH_GATE_SEEDS[0]) {
          active.spotsDone.fill(true);
          rig.step();
          const tile = contactTile(rig, site.contact);
          if (tile !== null) {
            rig.human.x = tile.x * TILE_SIZE;
            rig.human.y = tile.y * TILE_SIZE;
          }
          const pressed = rig.kit.tryInteract(rig.human, false);
          const thanksOpen = rig.kit.villagers?.conversation.isOpen === true;
          rig.kit.villagers?.closeConversation();
          check(
            tile !== null && pressed && thanksOpen,
            `${site.name}: once the work is done, Space beside ${site.contact} opens the payout`,
          );
        }
      } finally {
        rig.dispose();
      }
    }
    check(
      seen.size > 0 && blocked.size === 0,
      `${site.name}: Space starts every spot with ${site.contact} held indoors (${seen.size} spots${blocked.size === 0 ? '' : `; blocked: ${[...blocked].join(', ')}`})`,
    );
  }
}

export const contactPinSections: ReadonlyArray<{
  readonly name: string;
  readonly run: (check: Check) => void;
}> = [
  {
    name: 'Contact pin: a contract taken mid-scene holds its contact indoors until paid',
    run: (check) => {
      for (const site of villageSites()) {
        if (LIVE_SITE_IDS.includes(site.buildingId)) verifyLiveSite(check, site);
      }
    },
  },
  {
    name: 'Contact pin: every Briar Hollow contact held on a rebuilt scene',
    run: verifyRebuiltSites,
  },
  { name: 'Contact pin: a dropped contract and a restore with none', run: verifyDropAndRestore },
  {
    name: 'Contact pin: every spot still takes Space beside a held contact',
    run: verifySpotsPressable,
  },
];
