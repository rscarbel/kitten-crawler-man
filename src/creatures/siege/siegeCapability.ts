/**
 * The shared siege capability: how any assault mob attacks a structure.
 *
 * Composable rather than built into each creature's AI. A creature keeps the
 * fight it always had; the assault enlists it ({@link enlistInSiege}), and
 * from then on whatever marches it — a siege directive, or the creature's own
 * `updateAI` when nobody is in reach — calls {@link trySiegeStrike} when the
 * next step toward the bell walks into a structure. The strike is the
 * creature's own swing (`Mob.playStructureStrike`), and the blow lands on the
 * swing's impact frame through `DefenseStructures.damage` — never by writing a
 * tile or an HP value — so spikes soak it first and send a melee blow back as
 * thorns through that same call.
 *
 * Outside the assault `Mob.siegeCapable` is null and none of this runs.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import type { DefenseStructures, StructureRef } from '../../systems/briarHollow/DefenseStructures';
import { isInsideRing, type BriarHollowSite } from '../../map/overworld/briarHollowSite';
import { tileCoordKey } from '../../map/tileIndex';
import type { SiegeFlowQuery, SiegeTile, SiegeWorld } from './siegeTypes';

const HALF_TILE = TILE_SIZE / 2;

/**
 * Enlists `mob` in the assault on `world`: it batters structures at its own
 * multiplier from now on. `spreadSeed` is its own tie-break among equally
 * good steps, so a wave does not walk single file.
 */
export function enlistInSiege(mob: Mob, world: SiegeWorld, spreadSeed = 0): void {
  mob.siegeCapable = {
    structureDamageMultiplier: mob.siegeStructureMultiplier,
    siegeTarget: null,
    world,
    spreadSeed,
  };
}

/** The tile under a body's centre. */
export function tileUnder(body: { readonly x: number; readonly y: number }): SiegeTile {
  return {
    x: Math.floor((body.x + HALF_TILE) / TILE_SIZE),
    y: Math.floor((body.y + HALF_TILE) / TILE_SIZE),
  };
}

/**
 * Whether a structure still stands to be struck: a segment that is not an
 * opening, a trebuchet or snare that is not broken, the bell until it
 * cracks, or the gate (which never falls, and shakes instead).
 */
export function isStandingStructure(defense: DefenseStructures, ref: StructureRef): boolean {
  if (!defense.exists(ref)) return false;
  switch (ref.kind) {
    case 'gate':
      return true;
    case 'segment':
      return !defense.isOpening(ref.id);
    case 'trebuchet':
      return defense.trebuchet(ref.key)?.broken === false;
    case 'snare':
      return defense.snare(ref.key)?.broken === false;
    case 'bell':
      return !defense.bellCracked;
  }
}

/** The centre, in world pixels, of the structure tile nearest a body's centre. */
export function nearestStructurePoint(
  defense: DefenseStructures,
  ref: StructureRef,
  from: { readonly x: number; readonly y: number },
): { x: number; y: number } | null {
  const fromX = from.x + HALF_TILE;
  const fromY = from.y + HALF_TILE;
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const tile of defense.footprintOf(ref)) {
    const x = tile.x * TILE_SIZE + HALF_TILE;
    const y = tile.y * TILE_SIZE + HALF_TILE;
    const distance = Math.hypot(x - fromX, y - fromY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x, y };
    }
  }
  return best;
}

/**
 * Strikes the structure in `mob`'s way, if there is one.
 *
 * Asks the flow which structure the step out of the mob's tile enters. With
 * none — or one already opened — the mob's target is cleared and this answers
 * false, so the caller marches on. Otherwise the mob turns to the structure
 * and swings its own blow at it, and the blow lands on the swing's impact
 * frame as `structureStrikeDamage × structureDamageMultiplier` through
 * `defense.damage(…, 'melee')`. The structure is re-checked on that frame: a
 * wall that fell to another blow mid-swing takes nothing more.
 *
 * Answers true whenever the mob is busy with a structure — swinging, or
 * waiting out its swing's cooldown in front of it — so the caller holds it
 * where it stands rather than walking it into the wall.
 */
export function trySiegeStrike(
  mob: Mob,
  defense: DefenseStructures,
  flow: SiegeFlowQuery,
): boolean {
  const siege = mob.siegeCapable;
  // A mob a snare has turned to the party's side has no quarrel with the
  // village's walls, whatever its enlistment says.
  if (siege === null || !mob.isAlive || !mob.isHostile || siege.structureDamageMultiplier <= 0) {
    return false;
  }
  if (mob.isStrikingStructure) return true;
  const ref = flow.blockingStructure(tileUnder(mob), siege.spreadSeed);
  if (ref === null || !isStandingStructure(defense, ref)) {
    siege.siegeTarget = null;
    return false;
  }
  siege.siegeTarget = ref;
  const aim = nearestStructurePoint(defense, ref, mob);
  if (aim !== null) {
    const toX = aim.x - (mob.x + HALF_TILE);
    const toY = aim.y - (mob.y + HALF_TILE);
    const length = Math.hypot(toX, toY);
    if (length > 0) {
      mob.facingX = toX / length;
      mob.facingY = toY / length;
    }
  }
  mob.isMoving = false;
  const damage = mob.structureStrikeDamage * siege.structureDamageMultiplier;
  mob.playStructureStrike(() => {
    // Re-checked on the impact frame: the wall may have fallen mid-swing, and
    // a snare may have turned the swinger to the party's side.
    if (mob.isHostile && isStandingStructure(defense, ref)) {
      defense.damage(ref, damage, mob, 'melee');
    }
  });
  return true;
}

/**
 * One frame of an enlisted mob's advance on the village with nobody to fight:
 * strike the structure in its way, or step toward the next tile downhill.
 * Answers false when the mob is not enlisted, is an archer (it never marches
 * into walls), or the flow has nowhere to send it — the caller's own idle
 * behaviour then runs.
 */
export function siegeAdvance(mob: Mob): boolean {
  const siege = mob.siegeCapable;
  if (siege === null || !mob.isHostile || siege.structureDamageMultiplier <= 0) return false;
  const { defense, flow } = siege.world;
  if (trySiegeStrike(mob, defense, flow)) return true;
  const next = flow.nextStep(tileUnder(mob), siege.spreadSeed);
  if (next === null) return false;
  const toX = next.x * TILE_SIZE - mob.x;
  const toY = next.y * TILE_SIZE - mob.y;
  mob.marchStep(toX, toY);
  return true;
}

/** Whether a body stands inside the palisade ring (the ring itself counts as inside). */
export function isInsidePalisade(
  site: BriarHollowSite,
  body: { readonly x: number; readonly y: number },
): boolean {
  const tile = tileUnder(body);
  return isInsidePalisadeTile(site, tile.x, tile.y);
}

/** {@link isInsidePalisade} for a tile. */
export function isInsidePalisadeTile(site: BriarHollowSite, tileX: number, tileY: number): boolean {
  const originX = site.palisadeBounds.x;
  const originY = site.palisadeBounds.y;
  if (isInsideRing(tileX - originX, tileY - originY)) return true;
  return ringTileKeys(site).has(tileCoordKey(tileX, tileY));
}

const ringKeysBySite = new WeakMap<BriarHollowSite, ReadonlySet<number>>();

/** The palisade's own tiles and the gate's, keyed by `tileCoordKey`, built once per site. */
function ringTileKeys(site: BriarHollowSite): ReadonlySet<number> {
  const cached = ringKeysBySite.get(site);
  if (cached !== undefined) return cached;
  const keys = new Set<number>();
  for (const tile of site.palisadePath) keys.add(tileCoordKey(tile.x, tile.y));
  for (const tile of site.gate.tiles) keys.add(tileCoordKey(tile.x, tile.y));
  ringKeysBySite.set(site, keys);
  return keys;
}

/**
 * Whether an enlisted mob may take `target` as its fight rather than march on.
 * A defender on its own side of the ring, yes; one behind a wall still
 * standing, no — chasing that one would drive the mob's pathing into a wall
 * it has no route through, and the flow is what finds the way in.
 */
export function siegeCanEngage(mob: Mob, target: Player): boolean {
  const siege = mob.siegeCapable;
  if (siege === null) return true;
  // The gateway belongs to both sides: a defender standing in it can be
  // reached from outside as well as in, or the gate would be a pillbox.
  if (isOnGateTile(siege.world.site, target)) return true;
  return isInsidePalisade(siege.world.site, mob) === isInsidePalisade(siege.world.site, target);
}

/** Whether a body's centre stands on one of the gate's tiles. */
function isOnGateTile(
  site: BriarHollowSite,
  body: { readonly x: number; readonly y: number },
): boolean {
  const tile = tileUnder(body);
  return site.gate.tiles.some((gate) => gate.x === tile.x && gate.y === tile.y);
}
