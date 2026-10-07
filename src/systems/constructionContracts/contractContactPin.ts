/**
 * Where a Briar Hollow contract holds its contact while the work is on: inside
 * the building, out of their usual round, until the contract is paid out or
 * dropped.
 *
 * Derived from the contract record and the Plea's phase every time it is
 * asked, never stored, so a save, a rewind or a door visit puts the contact
 * back exactly where the state says. The siege outranks it: while the village
 * is under siege there is no pin, and the villagers shelter and the militia
 * man the walls as they always do.
 */

import type { ActiveContract, BriarHollowState } from '../../core/briarHollowState';
import { isVillageUnderSiege } from '../../core/villageQuestPhase';
import type { BriarHollowSite, VillageBuildingDef } from '../../map/overworld/briarHollowSite';
import { rectCentre } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import {
  contractSiteFor,
  contractSpot,
  type BriarHollowContractSiteDef,
  type ContractVillageBuildingId,
  type VillageContractContactId,
} from './contractCatalog';
import { CONTRACT_REACH_TILES } from './ContractSiteWork';
import {
  briarHollowSpotFootprint,
  footprintTiles,
  type ContractSpotFootprint,
} from './contractTargets';

/** A contact held indoors by the active contract, and the tile they wait on. */
export interface ContractContactPin {
  readonly contact: VillageContractContactId;
  readonly buildingId: ContractVillageBuildingId;
  readonly tile: TilePoint;
}

/**
 * The Briar Hollow site whose contract holds its contact indoors right now:
 * the active contract's site while it is in the village, and not while the
 * village is under siege.
 */
export function pinningContractSite(
  state: Pick<BriarHollowState, 'contracts' | 'quest'>,
): BriarHollowContractSiteDef | null {
  const active = state.contracts.active;
  if (active === null || isVillageUnderSiege(state.quest.phase)) return null;
  const site = contractSiteFor(active.site);
  return site?.town === 'briar_hollow' ? site : null;
}

function tileKey(tile: TilePoint): string {
  return `${tile.x},${tile.y}`;
}

/** The footprint of every spot the active contract holds, worked or not, so the pin stays put as spots finish. */
function contractFootprints(
  site: BriarHollowContractSiteDef,
  active: ActiveContract,
  village: BriarHollowSite,
): ContractSpotFootprint[] {
  return active.spotIds.flatMap((spotId) => {
    const spot = contractSpot(site, spotId);
    const footprint = spot === undefined ? null : briarHollowSpotFootprint(site, spot, village);
    return footprint === null ? [] : [footprint];
  });
}

function coveredKeys(footprints: readonly ContractSpotFootprint[]): Set<string> {
  const keys = new Set<string>();
  for (const footprint of footprints) {
    for (const tile of footprintTiles(footprint.rect)) keys.add(tileKey(tile));
  }
  return keys;
}

/** The tiles round a footprint a crawler could work it from, by the same centre-to-centre reach the work uses. */
function reachTiles(footprint: ContractSpotFootprint): TilePoint[] {
  const covered = footprintTiles(footprint.rect);
  const margin = Math.ceil(CONTRACT_REACH_TILES);
  const { x, y, w, h } = footprint.rect;
  const tiles: TilePoint[] = [];
  for (let tileY = y - margin; tileY < y + h + margin; tileY++) {
    for (let tileX = x - margin; tileX < x + w + margin; tileX++) {
      const inReach = covered.some(
        (tile) => Math.hypot(tile.x - tileX, tile.y - tileY) <= CONTRACT_REACH_TILES,
      );
      if (inReach) tiles.push({ x: tileX, y: tileY });
    }
  }
  return tiles;
}

/** How the party stands to a spot: where it can stand, and how near a villager must be to take a press from it. */
export interface ContractPinParty {
  readonly canStand: (tile: TilePoint) => boolean;
  /** A press talks to a villager within this many tiles who is nearer than the spot. */
  readonly talkRangeTiles: number;
}

function nearestFootprintTiles(tile: TilePoint, covered: readonly TilePoint[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const spotTile of covered) {
    nearest = Math.min(nearest, Math.hypot(spotTile.x - tile.x, spotTile.y - tile.y));
  }
  return nearest;
}

/**
 * The interior tiles where a contact would take the press from every tile
 * some spot can be worked from: near enough to talk to, and nearer than the
 * spot itself.
 */
function crowdingKeys(
  building: VillageBuildingDef,
  footprints: readonly ContractSpotFootprint[],
  party: ContractPinParty,
): Set<string> {
  const spots = footprints.map((footprint) => {
    const covered = footprintTiles(footprint.rect);
    const stands = reachTiles(footprint)
      .filter(party.canStand)
      .map((tile) => ({ tile, spotTiles: nearestFootprintTiles(tile, covered) }));
    return stands;
  });
  const keys = new Set<string>();
  const { x, y, w, h } = building.interior;
  for (let tileY = y; tileY < y + h; tileY++) {
    for (let tileX = x; tileX < x + w; tileX++) {
      const crowds = spots.some(
        (stands) =>
          stands.length > 0 &&
          stands.every(({ tile, spotTiles }) => {
            const contactTiles = Math.hypot(tile.x - tileX, tile.y - tileY);
            return contactTiles <= party.talkRangeTiles && contactTiles < spotTiles;
          }),
      );
      if (crowds) keys.add(tileKey({ x: tileX, y: tileY }));
    }
  }
  return keys;
}

function union(...sets: ReadonlyArray<ReadonlySet<string>>): Set<string> {
  const keys = new Set<string>();
  for (const set of sets) for (const key of set) keys.add(key);
  return keys;
}

/**
 * The tile a pinned contact waits on: the building's own occupant anchor
 * where it is free, otherwise the interior floor tile nearest it that is
 * standable and not someone else's. Tried in order, keeping off: every spot
 * and every tile that would take the press from every place a spot can be
 * worked from; every spot; then the same two again with the floor patches
 * allowed, for a room too small to stand anywhere else (a floor patch is
 * laid around someone standing on it, a wall or a piece of furniture is
 * not). Null when the building has no such tile.
 */
function pinTileFor(
  site: BriarHollowContractSiteDef,
  active: ActiveContract,
  village: BriarHollowSite,
  isFree: (tile: TilePoint) => boolean,
  party: ContractPinParty,
): TilePoint | null {
  const building = village.buildings.find((candidate) => candidate.id === site.buildingId);
  if (building === undefined) return null;
  const footprints = contractFootprints(site, active, village);
  const standingWork = footprints.filter((footprint) => footprint.surface !== 'floor');
  const everySpot = coveredKeys(footprints);
  const standingSpots = coveredKeys(standingWork);
  const crowding = crowdingKeys(building, footprints, party);
  const tiers: ReadonlyArray<ReadonlySet<string>> = [
    union(everySpot, crowding),
    everySpot,
    union(standingSpots, crowding),
    standingSpots,
  ];
  for (const avoid of tiers) {
    const tile = nearestUsableTile(building, avoid, isFree);
    if (tile !== null) return tile;
  }
  return null;
}

function nearestUsableTile(
  building: VillageBuildingDef,
  onSpot: ReadonlySet<string>,
  isFree: (tile: TilePoint) => boolean,
): TilePoint | null {
  const usable = (tile: TilePoint): boolean => !onSpot.has(tileKey(tile)) && isFree(tile);
  const anchor = building.occupantAnchors.find(usable);
  if (anchor !== undefined) return anchor;
  const from = building.occupantAnchors[0] ?? rectCentre(building.interior);
  const { x, y, w, h } = building.interior;
  let best: TilePoint | null = null;
  let bestDistance = Infinity;
  for (let tileY = y; tileY < y + h; tileY++) {
    for (let tileX = x; tileX < x + w; tileX++) {
      const tile = { x: tileX, y: tileY };
      const distance = Math.hypot(tileX - from.x, tileY - from.y);
      if (distance >= bestDistance || !usable(tile)) continue;
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The contact the active contract holds indoors, and where; null with no
 * Briar Hollow contract held, under siege, or with no free tile inside.
 * `isFree` says whether the contact may stand on a tile: walkable for them,
 * not a doorway, and not held by anyone else. `party` keeps the contact
 * from standing where they would take the press from a spot.
 */
export function contractContactPin(
  state: Pick<BriarHollowState, 'contracts' | 'quest'>,
  village: BriarHollowSite,
  isFree: (tile: TilePoint) => boolean,
  party: ContractPinParty,
): ContractContactPin | null {
  const site = pinningContractSite(state);
  const active = state.contracts.active;
  if (site === null || active === null) return null;
  const tile = pinTileFor(site, active, village, isFree, party);
  return tile === null ? null : { contact: site.contact, buildingId: site.buildingId, tile };
}

/** Whether two pins hold the same contact on the same tile. */
export function samePin(a: ContractContactPin | null, b: ContractContactPin | null): boolean {
  if (a === null || b === null) return a === b;
  return a.contact === b.contact && a.tile.x === b.tile.x && a.tile.y === b.tile.y;
}
