import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import { Mercenary } from '../creatures/Mercenary';
import type { Mob } from '../creatures/Mob';
import { Mongo } from '../creatures/Mongo';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';

/** How far from the crawler's tile a companion's landing spot is searched for. */
const COMPANION_LANDING_SEARCH_TILES = 4;
/** Offset from a body's origin to the centre of the tile it stands on, as a fraction of a tile. */
const TILE_CENTRE_FRACTION = 0.5;

/** A companion the party brings with it: Mongo, or a hired Meat Shield. */
export type PartyCompanion = Mongo | Mercenary;

/**
 * The companions standing with the party this frame, picked out of the scene's
 * extra targets (which also carry non-party figures such as a quest NPC).
 *
 * A downed hireling is never included, even if a context lists it: its revive
 * window is tied to the spot it fell, so moving the body would move the place
 * the crawler has to reach to save it.
 */
export function standingCompanions(extraTargets: readonly Player[] | undefined): PartyCompanion[] {
  const companions: PartyCompanion[] = [];
  for (const target of extraTargets ?? []) {
    if (!target.isAlive) continue;
    if (target instanceof Mongo) companions.push(target);
    else if (target instanceof Mercenary && !target.isDowned) companions.push(target);
  }
  return companions;
}

function tileUnder(body: Pick<Player, 'x' | 'y'>): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
  };
}

/**
 * Stands a companion on open ground beside `leader`, for a scripted moment that
 * must not leave it behind — a fight that pens the party in, where a companion
 * left outside is out of the fight for its whole length.
 *
 * Never on the leader's own tile, so it reads as the companion arriving rather
 * than as two sprites stacked. `isAcceptable` narrows the landing to a region
 * the caller owns (the circus grounds, a sealed room).
 *
 * @returns false when there was nowhere to put it; the companion is left where it was.
 */
export function placeCompanionBeside(
  companion: PartyCompanion,
  leader: Pick<Player, 'x' | 'y'>,
  gameMap: GameMap,
  mobGrid: SpatialGrid<Mob>,
  isAcceptable: (tileX: number, tileY: number) => boolean = () => true,
): boolean {
  const leaderTile = tileUnder(leader);
  const landing = findNearbyWalkableTile(
    gameMap,
    leaderTile.x,
    leaderTile.y,
    COMPANION_LANDING_SEARCH_TILES,
    (x, y) => (x !== leaderTile.x || y !== leaderTile.y) && isAcceptable(x, y),
  );
  if (landing === null) return false;

  const preMoveX = companion.x;
  const preMoveY = companion.y;
  companion.x = landing.x * TILE_SIZE;
  companion.y = landing.y * TILE_SIZE;
  // A position written by anything other than the mob's own movement is not
  // re-indexed by anything downstream, and attacks aimed at the new spot would
  // look for it in the grid cell it left.
  mobGrid.move(companion, preMoveX, preMoveY);
  // Each holds a route, a walk-home latch and stall counters toward where it
  // was; left alone it walks straight back to the spot it was lifted out of.
  if (companion instanceof Mongo) companion.onRescued();
  else companion.onTeleported();
  return true;
}
