import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import {
  type Footing,
  type FootingTransition,
  footingTransition,
  LEDGE_RISE_TILES,
} from '../map/mobility';
import { CAT_TRAVERSAL_TICKS } from '../sprites/catSprite';
import { HOP_AIRBORNE } from '../sprites/art/catWorldMoves';
import { easeInOut, lerp, ramp } from '../sprites/art/catArt';
import {
  type CardinalView,
  type FacingSelection,
  selectCardinalFacing,
} from '../sprites/facingView';

const RISE_OF_FOOTING: Readonly<Record<Footing, number>> = {
  floor: 0,
  ledge: LEDGE_RISE_TILES,
  gap: 0,
};

/** The share of a tile from a body's top-left to the point its tile is read at. */
const BODY_CENTRE_SHARE = 0.5;

/**
 * Tiles round a climber searched for a footing edge she may cross: far
 * enough ahead that her crossing rows are baked before she reaches it at a run.
 */
const EDGE_WARM_RADIUS_TILES = 4;
/** Ticks between those searches: an edge does not move, and the search reads dozens of tiles. */
const EDGE_WARM_INTERVAL_TICKS = 20;
/** How far past a shelf's base row she sorts, so a tie with the shelf's own depth goes to her. */
const SORT_PAST_LEDGE_BASE_PX = 1;

/** A body a climber's footing moves: top-left world position, tile-sized. */
export interface FootingBody {
  x: number;
  y: number;
}

/** What the owner of a climber's footing does for it: the row to play and the rows to warm. */
export interface FootingHooks {
  readonly map: () => GameMap | null;
  readonly play: (move: FootingTransition) => void;
  readonly warm: () => void;
}

interface Crossing {
  readonly move: FootingTransition;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly fromRise: number;
  readonly toRise: number;
  readonly duration: number;
  /** The view the crossing is drawn in: the way she is travelling, not the way she last faced. */
  readonly facing: FacingSelection<CardinalView>;
  elapsed: number;
}

function tileOf(position: number): number {
  return Math.floor((position + TILE_SIZE * BODY_CENTRE_SHARE) / TILE_SIZE);
}

/**
 * A climber's footing: where she stands (floor, ledge or gap), and the hop
 * or squeeze she makes between two of them. A step that would carry her
 * across a footing edge is not taken; the crossing is, played out over its
 * row with her body carried from tile to tile across the row's airborne
 * share, and nothing moves her until it lands.
 */
export class ClimberFooting {
  private crossing: Crossing | null = null;
  private ticksToEdgeSearch = 0;

  constructor(private readonly hooks: FootingHooks) {}

  get isCrossing(): boolean {
    return this.crossing !== null;
  }

  /** The view the crossing in flight is drawn in, along her travel; null with none in flight. */
  get crossingFacing(): FacingSelection<CardinalView> | null {
    return this.crossing?.facing ?? null;
  }

  /**
   * Starts the crossing a step from `body`'s tile into (`toTileX`, `toTileY`)
   * makes, when the two tiles' footings differ. True when one started, and
   * then the caller takes no step of its own. The caller has already found
   * the tile walkable for a climber.
   */
  crossInto(body: FootingBody, toTileX: number, toTileY: number): boolean {
    if (this.crossing !== null) return true;
    const map = this.hooks.map();
    if (map === null) return false;
    const fromTileX = tileOf(body.x);
    const fromTileY = tileOf(body.y);
    if (fromTileX === toTileX && fromTileY === toTileY) return false;
    const from = map.footingAt(fromTileX, fromTileY);
    const to = map.footingAt(toTileX, toTileY);
    const move = footingTransition(from, to);
    if (move === null) return false;
    this.crossing = {
      move,
      fromX: body.x,
      fromY: body.y,
      toX: toTileX * TILE_SIZE,
      toY: toTileY * TILE_SIZE,
      fromRise: RISE_OF_FOOTING[from],
      toRise: RISE_OF_FOOTING[to],
      duration: CAT_TRAVERSAL_TICKS[move],
      facing: selectCardinalFacing(toTileX - fromTileX, toTileY - fromTileY),
      elapsed: 0,
    };
    this.hooks.play(move);
    return true;
  }

  /** Once per tick: carries a crossing on, or looks ahead for an edge to warm her rows for. */
  tick(body: FootingBody): void {
    const crossing = this.crossing;
    if (crossing === null) {
      this.searchForEdge(body);
      return;
    }
    crossing.elapsed++;
    const carried = this.carriedShare(crossing);
    body.x = lerp(crossing.fromX, crossing.toX, carried);
    body.y = lerp(crossing.fromY, crossing.toY, carried);
    if (crossing.elapsed >= crossing.duration) this.crossing = null;
  }

  /** Drops a crossing in flight, landing her where it was going: for a body put somewhere else. */
  land(body: FootingBody): void {
    const crossing = this.crossing;
    if (crossing === null) return;
    body.x = crossing.toX;
    body.y = crossing.toY;
    this.crossing = null;
  }

  /** How high above the floor she is drawn, in tiles. */
  riseTiles(body: FootingBody): number {
    const crossing = this.crossing;
    if (crossing !== null) {
      return lerp(crossing.fromRise, crossing.toRise, this.carriedShare(crossing));
    }
    const map = this.hooks.map();
    if (map === null) return 0;
    return RISE_OF_FOOTING[map.footingAt(tileOf(body.x), tileOf(body.y))];
  }

  /**
   * Whether the floor below shows her shadow: mid-crossing, or up on a ledge
   * whose front drops to the floor. Deeper on a shelf top the floor is out
   * of sight under it, and her own contact shadow is the whole story.
   */
  castsFloorShadow(body: FootingBody): boolean {
    if (this.crossing !== null) return true;
    const map = this.hooks.map();
    if (map === null) return false;
    return map.footingAt(tileOf(body.x), tileOf(body.y) + 1) !== 'ledge';
  }

  /**
   * The line she sorts on among the world's upright things, in world pixels
   * from `body`'s top: below whatever she stands on, so a cat on a shelf
   * draws over the shelf.
   */
  depthY(body: FootingBody): number {
    const map = this.hooks.map();
    if (map === null) return body.y;
    const base = map.ledgeBaseRow(tileOf(body.x), tileOf(body.y));
    if (base === null) return body.y;
    return Math.max(body.y, base * TILE_SIZE + SORT_PAST_LEDGE_BASE_PX);
  }

  private carriedShare(crossing: Crossing): number {
    const progress = crossing.elapsed / crossing.duration;
    return easeInOut(ramp(progress, HOP_AIRBORNE.start, HOP_AIRBORNE.end));
  }

  private searchForEdge(body: FootingBody): void {
    if (this.ticksToEdgeSearch > 0) {
      this.ticksToEdgeSearch--;
      return;
    }
    this.ticksToEdgeSearch = EDGE_WARM_INTERVAL_TICKS;
    const map = this.hooks.map();
    if (map === null) return;
    const centreX = tileOf(body.x);
    const centreY = tileOf(body.y);
    const here = map.footingAt(centreX, centreY);
    for (let dy = -EDGE_WARM_RADIUS_TILES; dy <= EDGE_WARM_RADIUS_TILES; dy++) {
      for (let dx = -EDGE_WARM_RADIUS_TILES; dx <= EDGE_WARM_RADIUS_TILES; dx++) {
        const x = centreX + dx;
        const y = centreY + dy;
        if (map.footingAt(x, y) === here || !map.isWalkable(x, y, 'climber')) continue;
        this.hooks.warm();
        return;
      }
    }
  }
}
