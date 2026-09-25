/**
 * Readies Briar Hollow for a siege playtest: "Briar Hollow's Plea" moved on
 * to fortifying, as if the Mayor's asks were all done, the whole palisade
 * raised to one tier, and loaded trebuchets standing inside every wall.
 *
 * Dev-only: reached from the `briar-hollow-assault` playtest preset, never
 * from a shipped build.
 */

import { TILE_SIZE } from '../core/constants';
import type { PalisadeTier } from '../map/tileTypes';
import type { AssaultLane, BriarHollowSite } from '../map/overworld/briarHollowSite';
import type { GameMap } from '../map/GameMap';
import { isInsidePalisade } from '../creatures/siege/siegeCapability';
import type { BriarHollowKit } from '../systems/briarHollow/BriarHollowKit';
import type { DefenseStructures } from '../systems/briarHollow/DefenseStructures';
import { structureKey, trebuchetFootprint } from '../systems/briarHollow/DefenseStructures';
import {
  footprintTilesValid,
  villagerAnchorKeys,
  type PlacementWorld,
} from '../systems/briarHollow/constructionPlacement';
import {
  TREBUCHET_HEIGHT_TILES,
  TREBUCHET_MAX_AMMO,
  TREBUCHET_WIDTH_TILES,
} from '../systems/briarHollow/structureRules';

/** The tiers in the order a wall is upgraded through them, for `--walls=1` to `--walls=4`. */
const WALL_TIERS_IN_ORDER: readonly PalisadeTier[] = ['fence', 'wood', 'stone', 'fortified'];

/**
 * A `walls` flag as a tier: a tier's name, or its place in the upgrade order
 * counted from 1 (the wattle fence) to 4 (fortified stone). Null for anything
 * else.
 */
export function parseWallTier(raw: string | null): PalisadeTier | null {
  if (raw === null) return null;
  const byName = WALL_TIERS_IN_ORDER.find((tier) => tier === raw.toLowerCase());
  if (byName !== undefined) return byName;
  const position = Number.parseInt(raw, 10);
  if (!Number.isInteger(position) || position < 1 || position > WALL_TIERS_IN_ORDER.length) {
    return null;
  }
  return WALL_TIERS_IN_ORDER[position - 1];
}

/** A `trebuchets` flag as a count, or null when it is not a whole number of none or more. */
export function parseTrebuchetCount(raw: string | null): number | null {
  if (raw === null) return null;
  const count = Number.parseInt(raw, 10);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export interface BriarHollowFortification {
  readonly wallTier: PalisadeTier;
  /** Dealt round the four walls in turn, each standing as near its lane as it fits. */
  readonly trebuchets: number;
}

/**
 * Keeps a trebuchet this many tiles in from the palisade, so the wall walk
 * behind it stays open to the militia and the crawlers.
 */
const TREBUCHET_WALL_CLEARANCE_TILES = 2;

/**
 * Keeps a trebuchet this many tiles (Chebyshev) from the gate's inside tile:
 * where the preset puts the party down, where Hobb stands, and the way into
 * the main street. The south lane's approach is just outside the gate, so its
 * nearest engine would otherwise stand on top of all three.
 */
const TREBUCHET_GATE_CLEARANCE_TILES = 5;

/**
 * Applies `fortification` to the village. Does nothing once the questline is
 * past its opening or anything has been built: a scene rebuilt on a door
 * visit must not stand a second ring of engines.
 */
export function fortifyBriarHollow(
  kit: BriarHollowKit,
  gameMap: GameMap,
  fortification: BriarHollowFortification,
): void {
  const defense = kit.defences?.defense ?? null;
  const quest = kit.quest;
  const site = gameMap.briarHollow;
  if (defense === null || quest === null || site === null) return;
  if (quest.phase !== 'unmet' || defense.trebuchets.length > 0) return;
  raiseWholeRing(defense, site, fortification.wallTier);
  placeTrebuchets(defense, gameMap, site, fortification.trebuchets);
  quest.setPhase('fortifying');
}

function raiseWholeRing(
  defense: DefenseStructures,
  site: BriarHollowSite,
  tier: PalisadeTier,
): void {
  // Every tier above the fence the generated ring starts at, up to `tier`.
  const upgrades = WALL_TIERS_IN_ORDER.slice(1, WALL_TIERS_IN_ORDER.indexOf(tier) + 1);
  for (const segment of site.segments) {
    const ref = { kind: 'segment', id: segment.id } as const;
    for (const upgrade of upgrades) {
      if (defense.upgradeTarget(ref) === upgrade) defense.applyUpgrade(ref, 'human');
    }
  }
}

function placeTrebuchets(
  defense: DefenseStructures,
  gameMap: GameMap,
  site: BriarHollowSite,
  count: number,
): void {
  const world: PlacementWorld = {
    gameMap,
    site,
    defense,
    anchorTiles: villagerAnchorKeys(site),
  };
  const lanes = site.assaultLanes;
  if (lanes.length === 0) return;
  for (let placed = 0; placed < count; placed++) {
    const lane = lanes[placed % lanes.length];
    if (!placeNearLane(defense, world, site, lane)) return;
  }
}

/** One loaded trebuchet inside the ring, as near `lane`'s approach as one fits. */
function placeNearLane(
  defense: DefenseStructures,
  world: PlacementWorld,
  site: BriarHollowSite,
  lane: AssaultLane,
): boolean {
  const interior = site.interior;
  const inset = TREBUCHET_WALL_CLEARANCE_TILES;
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  for (let y = interior.y + inset; y < interior.y + interior.h - inset; y++) {
    for (let x = interior.x + inset; x < interior.x + interior.w - inset; x++) {
      candidates.push({ x, y, distance: Math.hypot(x - lane.approach.x, y - lane.approach.y) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    if (!footprintInside(site, candidate.x, candidate.y)) continue;
    if (blocksTheGate(site, candidate.x, candidate.y)) continue;
    if (!footprintTilesValid(world, trebuchetFootprint(candidate.x, candidate.y), true)) continue;
    defense.placeTrebuchet(candidate.x, candidate.y, 'human');
    const record = defense.trebuchet(structureKey(candidate.x, candidate.y));
    if (record !== null) record.ammo = TREBUCHET_MAX_AMMO;
    return true;
  }
  return false;
}

/** Whether a trebuchet at (tileX, tileY) would stand within the gate's clearance. */
function blocksTheGate(site: BriarHollowSite, tileX: number, tileY: number): boolean {
  const gate = site.gate.inside;
  const clearance = TREBUCHET_GATE_CLEARANCE_TILES;
  const dx = Math.max(gate.x - (tileX + TREBUCHET_WIDTH_TILES - 1), 0, tileX - gate.x);
  const dy = Math.max(gate.y - (tileY + TREBUCHET_HEIGHT_TILES - 1), 0, tileY - gate.y);
  return Math.max(dx, dy) <= clearance;
}

function footprintInside(site: BriarHollowSite, tileX: number, tileY: number): boolean {
  for (let dy = 0; dy < TREBUCHET_HEIGHT_TILES; dy++) {
    for (let dx = 0; dx < TREBUCHET_WIDTH_TILES; dx++) {
      const body = { x: (tileX + dx) * TILE_SIZE, y: (tileY + dy) * TILE_SIZE };
      if (!isInsidePalisade(site, body)) return false;
    }
  }
  return true;
}
