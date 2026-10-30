/**
 * The cats walking out of the cattery once the Warden has fallen: every town
 * cat the fight left in the room gets up from where she waited and runs for
 * the stair down, and is gone from the room once she reaches it. Where each
 * cat goes from there is the town's to show, in her own building.
 */

import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import { TownCats } from '../critters/TownCats';
import type { CatInRoom } from '../tower/boundCats';

export class CatsWalkOut {
  private readonly cats: TownCats;

  /** Sets each of `cats` running from where she is for `stair`, a tile of the cattery's stair down. */
  constructor(map: GameMap, cats: readonly CatInRoom[], stair: TilePoint, random: () => number) {
    this.cats = new TownCats((x, y) => map.isWalkable(x, y, 'walker'), random);
    const to = { x: stair.x * TILE_SIZE, y: stair.y * TILE_SIZE };
    for (const { id, at } of cats) {
      this.cats.placeCaged(id, at);
      this.cats.free(id, to);
    }
  }

  update(): void {
    this.cats.update();
    for (const cat of this.cats.cats) {
      if (!cat.isRunning) this.cats.remove(cat.id);
    }
  }

  /** The cats still running, for the room's depth-sorted pass. */
  sortedFigures(): readonly InteriorFigure[] {
    return this.cats.cats.map((cat) => ({
      y: cat.y,
      render: (ctx, camX, camY, tileSize) => cat.draw(ctx, camX, camY, tileSize),
    }));
  }

  dispose(): void {
    this.cats.clear();
  }
}
