/**
 * How a dead village animal comes back: it waits out `RESPAWN_SECONDS`, then
 * stands back up on its home tile in its own pen — or the nearest open pen
 * tile when something stands on that one — after the tile has been cleared
 * of anybody friendly (`clearRespawnTile`).
 *
 * One rule for every animal the village owns, whichever pen it lives in:
 * Merrit's herd in Briar Hollow's paddock, and Midge in Wendell's pasture in
 * the Over City.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Cow } from '../../creatures/Cow';
import type { Player } from '../../Player';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import type { MobRoster } from '../kits/SceneWorld';
import type { CowPen } from './cowPen';
import { clearRespawnTile } from './respawnClearance';

const UPDATES_PER_SECOND = 60;

/** A dead animal stands back up in its pasture after this long. */
export const RESPAWN_SECONDS = 30;
const RESPAWN_UPDATES = RESPAWN_SECONDS * UPDATES_PER_SECOND;

export interface LivestockRespawnDeps {
  readonly gameMap: GameMap;
  readonly roster: MobRoster;
  /** The pen the animals come back in. */
  readonly pen: CowPen;
}

export class LivestockRespawner {
  /** Where each animal first stood, which is where it comes back. */
  private readonly homeTiles = new Map<Cow, TilePoint>();
  /** Updates until each dead animal respawns; absent until its death is first seen. */
  private readonly respawnUpdatesLeft = new Map<Cow, number>();

  constructor(private readonly deps: LivestockRespawnDeps) {}

  /** Records `tile` as where `cow` comes back. */
  setHome(cow: Cow, tile: TilePoint): void {
    this.homeTiles.set(cow, tile);
  }

  /** Where `cow` comes back, or null for an animal this respawner was never told of. */
  homeOf(cow: Cow): TilePoint | null {
    return this.homeTiles.get(cow) ?? null;
  }

  /** Forgets `cow` entirely: an animal that has left this pen for good. */
  forget(cow: Cow): void {
    this.homeTiles.delete(cow);
    this.respawnUpdatesLeft.delete(cow);
  }

  /**
   * One update of a dead animal's wait. `held` keeps the count where it is —
   * the herd sheltering in the barn for a siege, when nothing should appear
   * in the pasture. Returns whether it stood back up this update.
   */
  tick(cow: Cow, crawlers: readonly Player[], held: boolean): boolean {
    const left = this.respawnUpdatesLeft.get(cow) ?? RESPAWN_UPDATES;
    if (held || left > 1) {
      this.respawnUpdatesLeft.set(cow, held ? left : left - 1);
      return false;
    }
    if (!this.standUp(cow, crawlers)) return false;
    this.respawnUpdatesLeft.delete(cow);
    return true;
  }

  /**
   * Stands `cow` back up on its home tile, or the nearest open pasture tile
   * when that one is taken. Returns false when the pasture has no open tile.
   */
  standUp(cow: Cow, crawlers: readonly Player[]): boolean {
    const tile = this.respawnTileFor(cow);
    if (tile === null) return false;
    clearRespawnTile({ gameMap: this.deps.gameMap, roster: this.deps.roster, crawlers }, tile, cow);
    const grid = this.deps.roster.grid;
    grid.remove(cow);
    cow.reviveForCheckpoint();
    cow.x = tile.x * TILE_SIZE;
    cow.y = tile.y * TILE_SIZE;
    grid.insert(cow);
    cow.warmRoutine(false);
    return true;
  }

  private respawnTileFor(cow: Cow): TilePoint | null {
    const pen = this.deps.pen;
    const home = this.homeTiles.get(cow);
    if (home === undefined) return null;
    if (pen.isPassable(home.x, home.y)) return home;
    let nearest: TilePoint | null = null;
    let nearestDistance = Infinity;
    for (const tile of pen.pastureTiles) {
      if (!pen.isPassable(tile.x, tile.y)) continue;
      const distance = Math.hypot(tile.x - home.x, tile.y - home.y);
      if (distance < nearestDistance) {
        nearest = tile;
        nearestDistance = distance;
      }
    }
    return nearest;
  }
}
