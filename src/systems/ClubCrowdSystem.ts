/**
 * The Desperado Club's cosmetic crowd: the patrons who stroll the floor between
 * the dance floor and the station rooms.
 *
 * Two things this owns that the old inline patron loop did not:
 *
 * - **Range.** Patrons roam the club's whole open floor rather than a hard-coded
 *   box by the door, gated by {@link isClubPatronTile} and real map walkability
 *   so they never clip a wall or a counter.
 * - **Weight.** Every figure on the floor — patrons, staff, the Sledge, the
 *   crawlers themselves — is a circular body, and patrons are pushed out of any
 *   overlap. They shoulder past each other, they refuse to stand inside the
 *   bouncer, and the player shoves them aside instead of walking through them.
 *
 * Only patrons ever move under collision: staff stand on their marks and the
 * player is driven by input, so both act as immovable bodies.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { InteriorFigure } from '../core/InteriorFigure';
import { drawClubNpc } from '../sprites/clubNpcSprite';
import { stepWander, type WanderParams, type WanderStep } from '../creatures/townWander';
import {
  CLUB_INTERIOR_W,
  CLUB_INTERIOR_H,
  CLUB_PATRON_COUNT,
  isClubPatronTile,
} from '../core/clubLayout';

const PATRON_SPEED_MIN = 0.32;
const PATRON_SPEED_MAX = 0.85;
const PATRON_ARRIVE_DIST = 5;
const PATRON_PAUSE_MIN = 30;
const PATRON_PAUSE_MAX = 240;
/** Appearance seeds are handed out on this stride; the sprite hashes them apart. */
const PATRON_SEED_STRIDE = 7;
const PATRON_SEED_OFFSET = 3;
/** Minimum horizontal drift toward the target before a patron flips which way it faces. */
const PATRON_FACING_DEADZONE = 0.4;

/** Height spread across the crowd, as a multiple of a tile — enough to read, short of cartoonish. */
const PATRON_HEIGHT_MIN = 0.88;
const PATRON_HEIGHT_MAX = 1.16;

/** How far from a figure's centre another body is refused, as a fraction of a tile. */
const BODY_RADIUS_TILES = 0.34;
/** The crawlers push harder than the crowd does — they get a wider personal space. */
const PLAYER_RADIUS_TILES = 0.42;
/** A body's centre sits below its sprite origin, at roughly hip height. */
const BODY_CENTER_Y_FRACTION = 0.62;

/** Separation shorter than this is treated as two bodies occupying the same point. */
const COINCIDENT_EPSILON = 0.0001;
const DEGREES_PER_TURN = 360;
const HALF_TURN_DEGREES = DEGREES_PER_TURN / 2;
const RADIANS_PER_DEGREE = Math.PI / HALF_TURN_DEGREES;
/** Horizontal centre of a tile, as a fraction of its width. */
const TILE_CENTER_X_FRACTION = 0.5;

/** A circular obstacle on the club floor. Patrons yield to these; these never yield. */
export interface CrowdBody {
  /** Centre in world pixels. */
  cx: number;
  cy: number;
  radius: number;
}

interface Patron {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  seed: number;
  facingX: number;
  pause: number;
  /** Sprite height as a multiple of the tile, fixed per patron. */
  heightScale: number;
}

export class ClubCrowdSystem {
  private patrons: Patron[] | null = null;
  private patronTiles: ReadonlyArray<{ x: number; y: number }> | null = null;
  /** One entry per patron, in step with `patrons`; the update loop refreshes each `y`. */
  private readonly figures: InteriorFigure[] = [];
  private animTime = 0;

  /** Reused output for `stepWander`, so the patron loop allocates nothing. */
  private readonly wanderStep: WanderStep = { dx: 0, dy: 0, moving: false };
  private readonly wanderParams: WanderParams = {
    pickTarget: () => this.randomPatronPoint(),
    arriveDist: PATRON_ARRIVE_DIST,
    pauseMin: PATRON_PAUSE_MIN,
    pauseMax: PATRON_PAUSE_MAX,
    isWalkable: (x, y) => this.isPatronSpot(x, y),
  };

  constructor(private readonly map: GameMap) {}

  /**
   * Advance the crowd. `staticBodies` are everything a patron must not stand
   * inside this frame — the station staff, the DJ, the dancers, and the crawlers.
   */
  update(staticBodies: ReadonlyArray<CrowdBody>): void {
    this.animTime++;
    this.ensurePatrons();
    const patrons = this.patrons;
    if (patrons === null) return;

    for (const p of patrons) {
      stepWander(p, this.wanderParams, this.wanderStep);
      if (this.wanderStep.moving && Math.abs(this.wanderStep.dx) > PATRON_FACING_DEADZONE) {
        p.facingX = this.wanderStep.dx < 0 ? -1 : 1;
      }
    }

    this.resolveCollisions(patrons, staticBodies);

    for (let i = 0; i < patrons.length; i++) {
      this.figures[i].y = patrons[i].y;
    }
  }

  /** Push overlapping patrons apart, and out of anything immovable they've walked into. */
  private resolveCollisions(patrons: Patron[], staticBodies: ReadonlyArray<CrowdBody>): void {
    const radius = TILE_SIZE * BODY_RADIUS_TILES;

    for (let i = 0; i < patrons.length; i++) {
      for (let j = i + 1; j < patrons.length; j++) {
        const a = patrons[i];
        const b = patrons[j];
        const dx = bodyCx(b) - bodyCx(a);
        const dy = bodyCy(b) - bodyCy(a);
        const overlap = radius * 2 - Math.hypot(dx, dy);
        if (overlap <= 0) continue;
        // Both are crowd, so both give ground — half the correction each.
        const push = this.separationVector(dx, dy, overlap / 2, a.seed + j);
        this.nudge(a, -push.x, -push.y);
        this.nudge(b, push.x, push.y);
      }
    }

    for (const p of patrons) {
      for (const body of staticBodies) {
        const dx = bodyCx(p) - body.cx;
        const dy = bodyCy(p) - body.cy;
        const overlap = radius + body.radius - Math.hypot(dx, dy);
        if (overlap <= 0) continue;
        // Immovable body: the patron absorbs the whole correction.
        const push = this.separationVector(dx, dy, overlap, p.seed);
        this.nudge(p, push.x, push.y);
      }
    }
  }

  /**
   * Direction to separate two bodies by `distance`. Two figures stacked exactly
   * on top of each other have no direction to separate along, so a seed-derived
   * angle breaks the tie deterministically instead of leaving them welded.
   */
  private separationVector(
    dx: number,
    dy: number,
    distance: number,
    tieBreakSeed: number,
  ): { x: number; y: number } {
    const len = Math.hypot(dx, dy);
    if (len < COINCIDENT_EPSILON) {
      const angle = (tieBreakSeed % DEGREES_PER_TURN) * RADIANS_PER_DEGREE;
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
    }
    return { x: (dx / len) * distance, y: (dy / len) * distance };
  }

  /** Move a patron by a correction, refusing any part of it that leaves legal floor. */
  private nudge(p: Patron, dx: number, dy: number): void {
    if (this.isPatronSpot(p.x + dx, p.y)) p.x += dx;
    if (this.isPatronSpot(p.x, p.y + dy)) p.y += dy;
  }

  /**
   * One figure per patron, built once and re-sorted every frame off the `y` the
   * update loop writes back — a crowd this size would otherwise rebuild a dozen
   * closures per frame purely to carry a number that already exists.
   */
  renderables(): ReadonlyArray<InteriorFigure> {
    this.ensurePatrons();
    return this.figures;
  }

  private renderPatron(
    p: Patron,
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const size = tileSize * p.heightScale;
    // Keep the feet on the tile's ground line while the figure's height varies.
    const footAlign = tileSize - size;
    drawClubNpc(
      ctx,
      p.x - camX + footAlign / 2,
      p.y - camY + footAlign,
      size,
      'patron',
      this.animTime,
      p.facingX,
      p.seed,
      { walking: this.isWalking(p) },
    );
  }

  private isWalking(p: Patron): boolean {
    if (p.pause > 0) return false;
    return Math.hypot(p.targetX - p.x, p.targetY - p.y) > PATRON_ARRIVE_DIST;
  }

  /** True when a patron may stand with its body centre over this world-pixel spot. */
  private isPatronSpot(x: number, y: number): boolean {
    const tx = Math.floor((x + TILE_SIZE * TILE_CENTER_X_FRACTION) / TILE_SIZE);
    const ty = Math.floor((y + TILE_SIZE * BODY_CENTER_Y_FRACTION) / TILE_SIZE);
    if (!isClubPatronTile(tx, ty)) return false;
    return this.map.isWalkable(tx, ty);
  }

  /**
   * Every tile a patron is allowed to stand on, collected once. Enumerating the
   * legal floor beats sampling the room and retrying: the club's open floor is a
   * minority of its tiles, so rejection sampling either burns tries or, on a bad
   * run, hands back somewhere illegal.
   */
  private legalPatronTiles(): ReadonlyArray<{ x: number; y: number }> {
    if (this.patronTiles !== null) return this.patronTiles;
    const tiles: Array<{ x: number; y: number }> = [];
    for (let ty = 1; ty < CLUB_INTERIOR_H - 1; ty++) {
      for (let tx = 1; tx < CLUB_INTERIOR_W - 1; tx++) {
        if (isClubPatronTile(tx, ty) && this.map.isWalkable(tx, ty)) tiles.push({ x: tx, y: ty });
      }
    }
    this.patronTiles = tiles;
    return tiles;
  }

  /** Never reached with an empty pool: `ensurePatrons` seeds nobody when the floor has no room. */
  private randomPatronPoint(): { x: number; y: number } {
    const tiles = this.legalPatronTiles();
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
  }

  private ensurePatrons(): void {
    if (this.patrons !== null) return;
    const patrons: Patron[] = [];
    if (this.legalPatronTiles().length > 0) {
      for (let i = 0; i < CLUB_PATRON_COUNT; i++) {
        const start = this.randomPatronPoint();
        const target = this.randomPatronPoint();
        const patron: Patron = {
          x: start.x,
          y: start.y,
          targetX: target.x,
          targetY: target.y,
          speed: PATRON_SPEED_MIN + Math.random() * (PATRON_SPEED_MAX - PATRON_SPEED_MIN),
          seed: i * PATRON_SEED_STRIDE + PATRON_SEED_OFFSET,
          facingX: 1,
          pause: Math.floor(Math.random() * PATRON_PAUSE_MAX),
          heightScale: PATRON_HEIGHT_MIN + Math.random() * (PATRON_HEIGHT_MAX - PATRON_HEIGHT_MIN),
        };
        patrons.push(patron);
        this.figures.push({
          y: patron.y,
          render: (ctx, camX, camY, tileSize) =>
            this.renderPatron(patron, ctx, camX, camY, tileSize),
        });
      }
    }
    this.patrons = patrons;
  }
}

function bodyCx(p: { x: number }): number {
  return p.x + TILE_SIZE * TILE_CENTER_X_FRACTION;
}

function bodyCy(p: { y: number }): number {
  return p.y + TILE_SIZE * BODY_CENTER_Y_FRACTION;
}

/** A stationary figure standing on a tile — staff, the DJ, a dancer. */
export function tileBody(tile: { x: number; y: number }): CrowdBody {
  return {
    cx: (tile.x + TILE_CENTER_X_FRACTION) * TILE_SIZE,
    cy: (tile.y + BODY_CENTER_Y_FRACTION) * TILE_SIZE,
    radius: TILE_SIZE * BODY_RADIUS_TILES,
  };
}

/** A crawler's body, from their sprite origin. */
export function playerBody(pos: { x: number; y: number }): CrowdBody {
  return {
    cx: pos.x + TILE_SIZE * TILE_CENTER_X_FRACTION,
    cy: pos.y + TILE_SIZE * BODY_CENTER_Y_FRACTION,
    radius: TILE_SIZE * PLAYER_RADIUS_TILES,
  };
}
