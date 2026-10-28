import { TILE_SIZE } from '../../core/constants';
import type { SpatialGrid } from '../../core/world/SpatialGrid';
import type { Mercenary } from '../../creatures/Mercenary';
import type { Mob } from '../../creatures/Mob';
import type { StealthGateRoomData } from '../../map/stealthGateLayout';

function standAt(
  mob: Mob,
  tile: { readonly x: number; readonly y: number },
  grid: SpatialGrid<Mob>,
): void {
  const previousX = mob.x;
  const previousY = mob.y;
  mob.x = tile.x * TILE_SIZE;
  mob.y = tile.y * TILE_SIZE;
  grid.move(mob, previousX, previousY);
}

/**
 * Stands Deinonychus and the hire on the gate room's waiting tiles, where they
 * stayed while the crawlers were in the prison: the prison admits neither, so
 * on the way out they are found waiting by the door rather than at the
 * crawlers' heels. Either may be absent.
 */
export function seatCompanionsWaitingOutsidePrison(
  room: Pick<StealthGateRoomData, 'waitingTiles'>,
  deinonychus: Mob | null,
  hire: Mercenary | null,
  grid: SpatialGrid<Mob>,
): void {
  if (deinonychus !== null) standAt(deinonychus, room.waitingTiles.deinonychus, grid);
  if (hire !== null) {
    standAt(hire, room.waitingTiles.hireling, grid);
    hire.onTeleported();
  }
}
