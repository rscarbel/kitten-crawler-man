/**
 * The cellar elf waiting beside the storm-drain grate on the Civic Terrace,
 * for the human to come and be let down. It never leaves its spot and is
 * never a target: a figure to walk up to, not a creature of the street.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { TilePoint } from '../../map/town/townPlan';
import { drawElfSprite, prewarmElf } from '../../sprites/elfSprite';

/** The elf stands this far east of the grate's door tile, on the terrace beside it. */
const ELF_TILES_EAST_OF_GRATE = 2;
const ELF_SEARCH_TILES = 3;
/** The human coming this close to the elf has arrived; walking further off than the second lets them arrive again. */
const MEET_TILES = 2;
const LEAVE_TILES = 4;
const HALF_TILE = TILE_SIZE / 2;
/** The elf faces west, toward the grate it is minding. */
const FACING_WEST_X = -1;
const FACING_WEST_Y = 0;

export class GrateMeeting {
  /** The grate's mouth, in world pixels at its door tile's centre. */
  readonly mouth: { readonly x: number; readonly y: number };
  private readonly elfTile: TilePoint;
  private armed = true;
  private warmed = false;

  constructor(map: GameMap, grateDoor: TilePoint) {
    this.mouth = {
      x: grateDoor.x * TILE_SIZE + HALF_TILE,
      y: grateDoor.y * TILE_SIZE + HALF_TILE,
    };
    this.elfTile = findNearbyWalkableTile(
      map,
      grateDoor.x + ELF_TILES_EAST_OF_GRATE,
      grateDoor.y,
      ELF_SEARCH_TILES,
    ) ?? { x: grateDoor.x + ELF_TILES_EAST_OF_GRATE, y: grateDoor.y };
  }

  /** Warms the elf's figure the first frame it is waiting, ahead of the human reaching it. */
  update(): void {
    if (this.warmed) return;
    this.warmed = true;
    prewarmElf();
  }

  /**
   * True on the frame `human` comes within reach of the elf, and not again
   * until they have walked off and come back, so a refusal is said once a
   * visit rather than every frame.
   */
  humanArrived(human: { readonly x: number; readonly y: number }): boolean {
    const distanceTiles =
      Math.hypot(human.x - this.elfTile.x * TILE_SIZE, human.y - this.elfTile.y * TILE_SIZE) /
      TILE_SIZE;
    if (distanceTiles > LEAVE_TILES) this.armed = true;
    if (!this.armed || distanceTiles > MEET_TILES) return false;
    this.armed = false;
    return true;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    drawElfSprite(
      ctx,
      this.elfTile.x * TILE_SIZE - camX,
      this.elfTile.y * TILE_SIZE - camY,
      TILE_SIZE,
      0,
      false,
      0,
      FACING_WEST_X,
      FACING_WEST_Y,
    );
  }
}
