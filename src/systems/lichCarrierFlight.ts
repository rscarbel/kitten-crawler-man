/**
 * The binding's carrier as the room sees it: dropping in through the
 * observatory window, crossing the room, landing beside the cat at its
 * pillar, bending to lift her, and climbing back out of the window with her
 * hung under its talons.
 *
 * The carrier's timing belongs to `BindingCircle` in `lichBattleRules.ts`,
 * which decides when it comes, which pillar it takes and when the cat is
 * free; this module only turns that stage and its progress into where the
 * bird and the cat are drawn. It moves nobody and blocks nothing, so the
 * fight's fairness rules never see it.
 */

import { TILE_SIZE } from '../core/constants';
import { easeInOut, easeOut, hump, lerp } from '../sprites/art/bipedArt';
import {
  drawTowerCarrier,
  drawTowerCarrierShadow,
  type TowerCarrierAction,
  type TowerCarrierFlightView,
  type TowerCarrierKind,
} from '../sprites/art/towerCarrierFigure';
import { CatAppearance, drawCatSprite } from '../sprites/catSprite';
import type { CatLook } from '../sprites/looks/catLook';
import type { CarrierStage, TilePos } from './lichBattleRules';

const HALF = 0.5;

/** How high over its shadow the carrier flies across the room. */
const FLIGHT_HEIGHT_TILES = 1.3;
const FLIGHT_HEIGHT_PX = TILE_SIZE * FLIGHT_HEIGHT_TILES;
/** How far north of the window's tile the carrier is when it first shows, out past the wall. */
const OUTSIDE_TILES = 1.6;
/** The cat sits on the floor just in front of her pillar's foot. */
const CAT_SPOT_TILES_SOUTH = 0.35;
/** The carrier lands this far to one side of the cat, toward the window it came in by. */
const LANDING_OFFSET_TILES = 0.6;
/**
 * Where in a cat's tile her paws rest, as a share of the tile down from its
 * top: her sprite is placed by its tile, and the flight is reckoned in the
 * ground points under bodies.
 */
const CAT_GROUND_IN_TILE = 0.85;
/** How far under the carrier's feet the cat hangs, her back in its talons. */
const CAT_HANG_TILES = 0.55;
const CAT_HANG_PX = TILE_SIZE * CAT_HANG_TILES;
/** Lifted she is drawn this much smaller, curled in the talons. */
const CARRIED_CAT_SCALE = 0.8;

/** Of the flight in: through the window, across the room, then the drop onto the floor. */
const ARRIVAL_AT_WINDOW = 0.15;
const ARRIVAL_DESCENT = 0.75;
/** Of the flight out: the climb off the floor, across the room, then out through the window. */
const LEAVING_CLIMB = 0.2;
const LEAVING_AT_WINDOW = 0.85;
/** Of the stoop, the moment the cat leaves the floor. */
const STOOP_GRAB = 0.65;
/** Her little lift as the carrier gathers her, at its highest. */
const GRAB_LIFT_TILES = 0.25;
const GRAB_LIFT_PX = TILE_SIZE * GRAB_LIFT_TILES;

/** Wingbeat frames advanced per game frame: across the room, and settling onto or off the floor. */
const CRUISE_BEAT_RATE = 0.45;
const HOVER_BEAT_RATE = 0.7;

/**
 * The share of the flight in at which the carrier is framed in the window:
 * where the fight stops for its one line, so the player sees who has come
 * before it crosses the room.
 */
export const CARRIER_AT_WINDOW_SHARE = ARRIVAL_AT_WINDOW;

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the cat is drawn once the carrier has her: her ground point and how
 * far off it she is lifted. Until it lifts her she is the room's to draw,
 * bound at her pillar, so she is never drawn twice.
 */
interface CatPose {
  readonly ground: WorldPoint;
  readonly heightPx: number;
}

/** One frame of the carrier, in world pixels. */
export interface CarrierFlightPose {
  readonly ground: WorldPoint;
  readonly heightPx: number;
  readonly alpha: number;
  readonly action: TowerCarrierAction;
  readonly view: TowerCarrierFlightView;
  readonly facingLeft: boolean;
  /** 0..1 through the stoop; unused by the wingbeat rows. */
  readonly stoop: number;
  /** Whether it is beating hard to hold itself over the floor rather than cruising. */
  readonly hovering: boolean;
  readonly cat: CatPose | null;
}

function tileCentre(tile: TilePos): WorldPoint {
  return { x: (tile.col + HALF) * TILE_SIZE, y: (tile.row + HALF) * TILE_SIZE };
}

function between(from: WorldPoint, to: WorldPoint, t: number): WorldPoint {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

function share(progress: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (progress - from) / (to - from)));
}

/** Where the cat bound to `pillar` sits: on the floor just in front of the pillar's foot. */
function boundCatGround(pillar: TilePos): WorldPoint {
  return {
    x: (pillar.col + HALF) * TILE_SIZE,
    y: (pillar.row + 1 + CAT_SPOT_TILES_SOUTH) * TILE_SIZE,
  };
}

/**
 * The top-left a tile-sized sprite of the cat bound to `pillar` is drawn
 * from, so the room draws her sat exactly where the carrier picks her up.
 */
export function boundCatOrigin(pillar: TilePos): WorldPoint {
  const ground = boundCatGround(pillar);
  return { x: ground.x - TILE_SIZE * HALF, y: ground.y - TILE_SIZE * CAT_GROUND_IN_TILE };
}

/**
 * Whether the carrier has its cat off the floor at `stage` and `progress`:
 * from the moment its stoop gathers her until it is gone. Until then she is
 * the room's to draw, bound at her pillar.
 */
export function carrierHoldsCat(stage: CarrierStage, progress: number): boolean {
  switch (stage) {
    case 'waiting':
    case 'arriving':
    case 'gone':
      return false;
    case 'lifting':
      return share(progress, STOOP_GRAB, 1) > 0;
    case 'leaving':
      return true;
    default: {
      const unhandled: never = stage;
      throw new Error(`unhandled carrier stage ${String(unhandled)}`);
    }
  }
}

/**
 * Where the carrier and its cat are for the circle's carrier `stage` at
 * `progress` (0..1 through it), flying between the observatory `window`'s
 * tile and the `pillar` it has come for. Null while it is not in the room.
 */
export function carrierFlightPose(
  stage: CarrierStage,
  progress: number,
  window: TilePos,
  pillar: TilePos,
): CarrierFlightPose | null {
  const windowPoint = tileCentre(window);
  const outside = { x: windowPoint.x, y: windowPoint.y - OUTSIDE_TILES * TILE_SIZE };
  const pillarCentre = tileCentre(pillar);
  const catSpot = boundCatGround(pillar);
  const side = windowPoint.x >= pillarCentre.x ? 1 : -1;
  const landing = { x: catSpot.x + side * LANDING_OFFSET_TILES * TILE_SIZE, y: catSpot.y };
  const facingLeft = side > 0;

  switch (stage) {
    case 'waiting':
    case 'gone':
      return null;
    case 'arriving': {
      const entering = share(progress, 0, ARRIVAL_AT_WINDOW);
      const crossing = share(progress, ARRIVAL_AT_WINDOW, ARRIVAL_DESCENT);
      const dropping = share(progress, ARRIVAL_DESCENT, 1);
      const ground =
        entering < 1
          ? between(outside, windowPoint, easeOut(entering))
          : between(windowPoint, landing, easeInOut(crossing));
      return {
        ground,
        heightPx: FLIGHT_HEIGHT_PX * (1 - easeOut(dropping)),
        alpha: entering,
        action: 'fly',
        view: 'down',
        facingLeft,
        stoop: 0,
        hovering: dropping > 0,
        cat: null,
      };
    }
    case 'lifting': {
      const gathered = share(progress, STOOP_GRAB, 1);
      const cat: CatPose | null = carrierHoldsCat(stage, progress)
        ? {
            ground: between(catSpot, landing, easeInOut(gathered)),
            heightPx: GRAB_LIFT_PX * hump(gathered),
          }
        : null;
      return {
        ground: landing,
        heightPx: 0,
        alpha: 1,
        action: 'stoop',
        view: 'down',
        facingLeft,
        stoop: progress,
        hovering: true,
        cat,
      };
    }
    case 'leaving': {
      const climbing = share(progress, 0, LEAVING_CLIMB);
      const crossing = share(progress, LEAVING_CLIMB, LEAVING_AT_WINDOW);
      const exiting = share(progress, LEAVING_AT_WINDOW, 1);
      const ground =
        exiting > 0
          ? between(windowPoint, outside, easeInOut(exiting))
          : between(landing, windowPoint, easeInOut(crossing));
      const heightPx = FLIGHT_HEIGHT_PX * easeOut(climbing);
      return {
        ground,
        heightPx,
        alpha: 1 - exiting,
        action: 'carry',
        view: 'up',
        facingLeft,
        stoop: 1,
        hovering: climbing < 1,
        cat: { ground, heightPx: Math.max(0, heightPx - CAT_HANG_PX) },
      };
    }
    default: {
      const unhandled: never = stage;
      throw new Error(`unhandled carrier stage ${String(unhandled)}`);
    }
  }
}

/**
 * Draws the carrier and the cat it has come for, holding the cat's
 * appearance from the frame the carrier arrives until it is disposed.
 */
export class CarrierView {
  private beat = 0;
  private cat: CatAppearance<'ambient'> | null = null;
  private catPillar: string | null = null;

  constructor(
    private readonly kind: TowerCarrierKind,
    private readonly catLookAt: (pillarId: string) => CatLook | null,
  ) {}

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    pose: CarrierFlightPose | null,
    pillarId: string,
  ): void {
    if (pose === null) return;
    this.beat += pose.hovering ? HOVER_BEAT_RATE : CRUISE_BEAT_RATE;
    const groundX = pose.ground.x - camX;
    const groundY = pose.ground.y - camY;
    ctx.save();
    ctx.globalAlpha = pose.alpha;
    drawTowerCarrierShadow(ctx, groundX, groundY, pose.heightPx, TILE_SIZE, pose.alpha);
    if (pose.cat !== null) this.renderCat(ctx, camX, camY, pose.cat, pillarId);
    drawTowerCarrier(
      ctx,
      this.kind,
      pose.action,
      pose.view,
      pose.facingLeft,
      pose.action === 'stoop' ? pose.stoop : this.beat,
      groundX,
      groundY,
      pose.heightPx,
      TILE_SIZE,
    );
    ctx.restore();
  }

  private renderCat(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    pose: CatPose,
    pillarId: string,
  ): void {
    const appearance = this.catFor(pillarId);
    if (appearance === null) return;
    const size = TILE_SIZE * CARRIED_CAT_SCALE;
    const sx = pose.ground.x - camX - size * HALF;
    const sy = pose.ground.y - camY - pose.heightPx - size * CAT_GROUND_IN_TILE;
    const state = { sitting: true };
    drawCatSprite(ctx, appearance, sx, sy, size, appearance.cellFor(state), state);
  }

  private catFor(pillarId: string): CatAppearance<'ambient'> | null {
    if (this.catPillar === pillarId) return this.cat;
    this.cat?.release();
    const look = this.catLookAt(pillarId);
    this.cat = look === null ? null : new CatAppearance('ambient', look);
    this.cat?.prewarm();
    this.catPillar = pillarId;
    return this.cat;
  }

  dispose(): void {
    this.cat?.release();
    this.cat = null;
    this.catPillar = null;
  }
}
