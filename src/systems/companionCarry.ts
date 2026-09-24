import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import type { MobRoster } from './kits/SceneWorld';

/**
 * A party-side creature that goes where the crawlers go: through a building's
 * door, up a tower's stairs, and back to its mark when a script resets the
 * party.
 *
 * Each owning system answers the three questions below for its own creature,
 * so a scene moves every companion it hosts through one call and a new kind of
 * companion joins by adding an entry rather than a second copy of the move.
 */
export interface CarriedCompanion {
  /** The live creature, or null when this companion is not out. */
  readonly body: Mob | null;
  /**
   * Where it should stand on `map` beside the crawler it follows, or null when
   * there is nowhere it could stand and move.
   */
  landingTile(map: GameMap): { x: number; y: number } | null;
  /**
   * Put it away from the roster it is in right now. Used when no landing tile
   * exists, because a creature placed on an unchecked tile can be walled in for
   * the rest of the visit.
   */
  putAway(mobs: Mob[], grid: SpatialGrid<Mob>): void;
  /**
   * Called once it stands on its new tile, so it can drop whatever route,
   * target or stall reading it was holding for the ground it left, and read
   * `mobs` — the roster it now stands in — from here on.
   */
  onPlaced(mobs: Mob[]): void;
}

/** What a building is told, at the door, about the companions coming in. */
export interface InteriorCompanionArrival {
  /** Whether Mongo exists in this run at all; an interior has no other way to know. */
  readonly mongoUnlocked: boolean;
  /** Whether he was out beside the party at the door, and so walks in with them. */
  readonly mongoWasOut: boolean;
}

/** What the overworld is told on the way back out. */
export interface InteriorCompanionDeparture {
  /** Whether he was out beside the party at the door, and so walks out with them. */
  readonly mongoWasOut: boolean;
}

/** Nobody came in with the party, and nothing about Mongo is known. */
export const NO_INTERIOR_COMPANIONS: InteriorCompanionArrival = {
  mongoUnlocked: false,
  mongoWasOut: false,
};

/**
 * Drops every reference `mobs` holds to `body`.
 *
 * A mob chasing a creature that has just been moved goes on chasing the tile it
 * left — and on a tower storey the party has walked off, it chases a creature
 * that is no longer in its roster at all, for as long as that storey exists.
 */
function releaseTargetsOn(body: Mob, mobs: readonly Mob[]): void {
  for (const mob of mobs) {
    if (mob.retaliateMob === body) mob.retaliateMob = null;
    if (mob.currentTarget === body) mob.currentTarget = null;
  }
}

/**
 * Moves every companion that is out from `from` into `to`, beside the crawler
 * it follows on `map`.
 *
 * `from` and `to` may be the same roster — a script that puts the party back on
 * its marks moves the companions with them without changing storey — in which
 * case the grid cell is moved rather than the membership. Either way the grid
 * is kept in step with the new position: a creature teleported without it keeps
 * its hit-test entry where it was, and every blow aimed at it misses.
 *
 * A companion with nowhere to stand is put away instead of placed blind.
 */
export function carryCompanions(
  companions: readonly CarriedCompanion[],
  from: MobRoster,
  to: MobRoster,
  map: GameMap,
): void {
  for (const companion of companions) {
    const body = companion.body;
    if (body === null) continue;
    const landing = companion.landingTile(map);
    if (landing === null) {
      companion.putAway(from.mobs, from.grid);
      continue;
    }
    releaseTargetsOn(body, from.mobs);
    const previousX = body.x;
    const previousY = body.y;
    if (from === to) {
      body.x = landing.x * TILE_SIZE;
      body.y = landing.y * TILE_SIZE;
      from.grid.move(body, previousX, previousY);
    } else {
      // Removed before the move: the grid finds an entry by the position it was
      // filed under.
      from.grid.remove(body);
      const index = from.mobs.indexOf(body);
      if (index >= 0) from.mobs.splice(index, 1);
      body.x = landing.x * TILE_SIZE;
      body.y = landing.y * TILE_SIZE;
      to.add(body);
    }
    companion.onPlaced(to.mobs);
  }
}
