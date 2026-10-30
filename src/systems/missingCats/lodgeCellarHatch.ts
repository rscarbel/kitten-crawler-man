/**
 * Blackwood Lodge's cellar hatch as a thing in the room that opens and shuts.
 *
 * The prop bakes the hatch shut into the floor. While the lid is anywhere
 * but shut, this paints the well over the baked lid and the lid itself
 * swinging on its north hinge, and once it stands open the well's tiles are
 * blocked so nobody walks over the hole. It opens when Kessler heaves it up
 * and shuts when the elves drop it after the cellar holds; a room built while
 * the cellar's fight is still owed is built with it already open.
 */

import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { GameMap } from '../../map/GameMap';
import type { MobRoster } from '../kits/SceneWorld';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { TilePoint } from '../../map/town/townPlan';
import {
  CELLAR_WELL_TILES,
  cellarHatchOpening,
  paintCellarLidLeaf,
  paintCellarWell,
  type CellarHatchRect,
} from '../../sprites/art/townInterior/rooms/cellarHatch';
import { tileStoodOn } from '../partySplit/partyTransfer';
import type { AudioManager } from '../../audio/AudioManager';
import { playMissingCatsCue } from '../../audio/missingCatsSoundCues';

/** How long the lid takes to swing all the way up, or all the way down. */
export const CELLAR_HATCH_SWING_FRAMES = 48;
/** Open, the lid leans a little past upright, back against its stop. */
const OPEN_PAST_UPRIGHT = 1.06;
const OPEN_ANGLE_RAD = (Math.PI / 2) * OPEN_PAST_UPRIGHT;
/**
 * Kessler stands on the floor just south of the lifting edge, this many tiles
 * from the footprint's north-west tile: the well's south row is the hole
 * itself, and the tile east of this one is where the party comes in.
 */
const LIFT_STAND = { dx: 1, dy: 3 } as const;
/**
 * And steps aside to here, off the west side of the well, while it swings
 * up: clear of the hole, and clear of the floor south of it where whatever
 * climbs out steps off the lip.
 */
const STAND_BACK = { dx: -1, dy: 2 } as const;
/** A body caught on the well when it opens is moved to the nearest floor within this. */
const NUDGE_SEARCH_TILES = 3;

type Swing = 'shut' | 'opening' | 'open' | 'closing';

/** Something standing in the room that must not be left over the well. */
interface Body {
  x: number;
  y: number;
}

/** Everyone standing in the room, any of whom the open well must not be left under. */
export interface RoomStanding {
  /** Placed by position alone: the crawlers, their companions, the residents. */
  readonly bodies: readonly Body[];
  /** The room's creatures, elves included, whose grid has to follow a move. */
  readonly roster: MobRoster;
}

export class LodgeCellarHatch {
  private swing: Swing;
  /** 0 shut, 1 open. */
  private openness: number;
  private readonly openingPx: CellarHatchRect;

  private constructor(
    private readonly map: GameMap,
    /** The prop's north-west tile. */
    readonly northWest: TilePoint,
    private readonly audio: AudioManager | null,
    private readonly standing: () => RoomStanding,
    open: boolean,
  ) {
    this.openingPx = cellarHatchOpening(
      northWest.x * TILE_SIZE,
      northWest.y * TILE_SIZE,
      TILE_SIZE,
    );
    this.swing = open ? 'open' : 'shut';
    this.openness = open ? 1 : 0;
    if (open) this.blockWell();
  }

  /** The hatch in this room, or null in a room without one. */
  static inRoom(
    map: GameMap,
    audio: AudioManager | null,
    standing: () => RoomStanding,
    open: boolean,
  ): LodgeCellarHatch | null {
    const placed = map.placedInteriorProps.find((prop) => prop.propId === 'cellar_trapdoor');
    if (placed === undefined) return null;
    return new LodgeCellarHatch(map, placed.tile, audio, standing, open);
  }

  /** Where someone stands to heave the lid up by its hasp. */
  get liftTile(): TilePoint {
    return { x: this.northWest.x + LIFT_STAND.dx, y: this.northWest.y + LIFT_STAND.dy };
  }

  /** Where they step back to while it swings. */
  get standBackTile(): TilePoint {
    return { x: this.northWest.x + STAND_BACK.dx, y: this.northWest.y + STAND_BACK.dy };
  }

  /** The middle of the opening, in world pixels. */
  get centre(): { x: number; y: number } {
    const { left, right, top, bottom } = this.openingPx;
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }

  open(): void {
    if (this.swing === 'open' || this.swing === 'opening') return;
    this.swing = 'opening';
    playMissingCatsCue(this.audio, 'cellarLidOpen', this.centre);
  }

  /** Lets the lid down. The well is floor again the moment it starts to fall, so nobody is shut in under it. */
  close(): void {
    if (this.swing === 'shut' || this.swing === 'closing') return;
    this.swing = 'closing';
    this.unblockWell();
    playMissingCatsCue(this.audio, 'cellarLidShut', this.centre);
  }

  update(): void {
    const step = 1 / CELLAR_HATCH_SWING_FRAMES;
    if (this.swing === 'opening') {
      this.openness = Math.min(1, this.openness + step);
      if (this.openness === 1) {
        this.swing = 'open';
        this.blockWell();
      }
    } else if (this.swing === 'closing') {
      this.openness = Math.max(0, this.openness - step);
      if (this.openness === 0) this.swing = 'shut';
    }
  }

  /** The well, over the baked lid and under every figure. Nothing while the lid is shut. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.openness === 0) return;
    paintCellarWell(ctx, this.shifted(camX, camY), TILE_SIZE);
  }

  /**
   * The lid, for the depth-sorted pass. It sorts on its hinge: a body north
   * of the hatch is behind it once it stands up, and one on the lifting edge
   * is in front of it.
   */
  sortedFigure(): InteriorFigure | null {
    if (this.openness === 0) return null;
    const hingeY = this.openingPx.top;
    const angle = OPEN_ANGLE_RAD * easeInOut(this.openness);
    return {
      y: hingeY - TILE_SIZE,
      render: (ctx, camX, camY) =>
        paintCellarLidLeaf(ctx, this.shifted(camX, camY), TILE_SIZE, angle),
    };
  }

  private shifted(camX: number, camY: number): CellarHatchRect {
    const { left, right, top, bottom } = this.openingPx;
    return { left: left - camX, right: right - camX, top: top - camY, bottom: bottom - camY };
  }

  private wellTiles(): TilePoint[] {
    return CELLAR_WELL_TILES.map(({ dx, dy }) => ({
      x: this.northWest.x + dx,
      y: this.northWest.y + dy,
    }));
  }

  private blockWell(): void {
    const tiles = this.wellTiles();
    for (const tile of tiles) this.map.blockTilePermanently(tile.x, tile.y);
    const { bodies, roster } = this.standing();
    for (const body of bodies) this.stepOffWell(body, tiles);
    for (const mob of roster.mobs) {
      if (!mob.isAlive) continue;
      const oldX = mob.x;
      const oldY = mob.y;
      if (this.stepOffWell(mob, tiles)) roster.grid.move(mob, oldX, oldY);
    }
  }

  /** Sets `body` down on the nearest floor if it stands on the well; returns whether it was moved. */
  private stepOffWell(body: Body, wellTiles: readonly TilePoint[]): boolean {
    const at = tileStoodOn(body);
    const onWell = wellTiles.some((tile) => tile.x === at.x && tile.y === at.y);
    if (!onWell) return false;
    const floor = findNearbyWalkableTile(this.map, at.x, at.y, NUDGE_SEARCH_TILES);
    if (floor === null) return false;
    body.x = floor.x * TILE_SIZE;
    body.y = floor.y * TILE_SIZE;
    return true;
  }

  private unblockWell(): void {
    for (const tile of this.wellTiles()) this.map.unblockTilePermanently(tile.x, tile.y);
  }
}

/** A heavy lid: slow off the collar, quick through the middle, slow onto its stop. */
function easeInOut(t: number): number {
  const smoothstepRise = 3;
  return t * t * (smoothstepRise - 2 * t);
}
