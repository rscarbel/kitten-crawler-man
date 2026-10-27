/**
 * Everything a hireling looses once it has left them: today, an archer's
 * arrows.
 *
 * A system rather than state on the hireling for the reason every projectile
 * system here is one: a mob stops being updated and drawn the frame it dies, so
 * an arrow it owned would vanish in mid-air the instant the hireling fell. An
 * arrow already loosed does not care what happened to the archer.
 *
 * Every shot is an ally's, so none can hurt the party. Its only victims are
 * living hostile mobs — never a crawler, Mongo, a quest ally or another
 * hireling — and every blow is credited to the crawler who paid through
 * `takeCreditedDamage`, with the hireling named as the body that struck.
 *
 * Each kind of shot declares how it flies and how it is drawn in
 * {@link HIRELING_SHOT_KINDS}, so a new kind of shot is a new entry there and
 * nothing in the flight or the render loop changes.
 */

import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob, PlayerDamageType } from '../creatures/Mob';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawGoblinArrow } from '../sprites/goblinArrowSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/** The hireling behind a shot: a mob that wants to hear when its blow finishes something. */
export interface HirelingShooter extends Mob {
  noteBlowLanded(victim: Mob): void;
}

/** Every kind of shot a hireling's kit can loose. */
export type HirelingShotKind = 'arrow';

/** One shot, as the kit hands it over. */
export interface HirelingShot {
  readonly kind: HirelingShotKind;
  /** Where the shot's tip starts, in world pixels at body-centre height. */
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly damage: number;
  /** How far the shot flies before it drops out of the air. */
  readonly rangePx: number;
  readonly shooter: HirelingShooter;
  /** The crawler credited with anything the shot kills. */
  readonly owner: Player;
}

/** How one kind of shot flies, strikes and is drawn. */
interface HirelingShotKindSpec {
  readonly speedTilesPerFrame: number;
  /** How close the tip must pass a body's centre to strike it. */
  readonly hitRadiusTiles: number;
  /**
   * What the blow counts as for a victim that only takes some of the party's
   * damage. Every hireling shot counts as a hand-delivered blow, like the
   * hireling's own strikes.
   */
  readonly damageType: PlayerDamageType;
  /** Draws the shot in flight centred on (sx, sy), pointing along `headingRad`. */
  readonly draw: (
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
    headingRad: number,
  ) => void;
}

/** An arrow outruns anything that walks, so a shot aimed at a mob reaches it. */
const ARROW_SPEED_TILES_PER_FRAME = 0.32;
const ARROW_HIT_RADIUS_TILES = 0.45;

/** A `Record` so a new shot kind fails the typecheck until it says how it flies and looks. */
const HIRELING_SHOT_KINDS: Readonly<Record<HirelingShotKind, HirelingShotKindSpec>> = {
  arrow: {
    speedTilesPerFrame: ARROW_SPEED_TILES_PER_FRAME,
    hitRadiusTiles: ARROW_HIT_RADIUS_TILES,
    damageType: 'melee',
    draw: (ctx, sx, sy, tileSize, headingRad) => drawGoblinArrow(ctx, sx, sy, tileSize, headingRad),
  },
};

/**
 * Anything with shots to hand over. Structural, like `GolemRockThrower`, so the
 * system never has to name the hireling class it drains.
 *
 * The method name is the whole of the check, so it must be one no other mob
 * carries: archers and skeleton casters have a `takePendingShots` of their own
 * with a different shot shape, and draining theirs here would steal their
 * arrows.
 */
export interface HirelingShotSource {
  takePendingHirelingShots(): readonly HirelingShot[];
}

function isShotSource(mob: Mob): mob is Mob & HirelingShotSource {
  return 'takePendingHirelingShots' in mob && typeof mob.takePendingHirelingShots === 'function';
}

const CENTER_OFFSET = 0.5;

interface Flight {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  readonly heading: number;
  travelledPx: number;
  readonly shot: HirelingShot;
}

export class HirelingShotSystem implements GameSystem {
  private flights: Flight[] = [];
  /** Scratch set for grid queries, reused every frame. */
  private readonly nearby = new Set<Mob>();

  /** Set when a shot lands or snaps on a wall; the scene plays the cue and clears it. */
  impactSoundPending = false;

  /**
   * @param isInSafeRoom The test that keeps the party's own attacks out of a
   *   safe room. A shot that reaches the threshold stops there, and nothing
   *   standing inside is hit.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly isInSafeRoom: (point: { readonly x: number; readonly y: number }) => boolean,
  ) {}

  /** Shots in the air, for gates and dev readouts. */
  get inFlight(): number {
    return this.flights.length;
  }

  update(ctx: SystemContext): void {
    this.collectShots(ctx.roster.mobs);
    this.advance(ctx);
  }

  /**
   * Walks the whole mob list rather than only the active ones: a hireling that
   * shoots and dies in the same frame would otherwise strand its shot.
   */
  private collectShots(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!isShotSource(mob)) continue;
      for (const shot of mob.takePendingHirelingShots()) this.launch(shot);
    }
  }

  private launch(shot: HirelingShot): void {
    const heading = normalize(shot.dirX, shot.dirY);
    // A zero direction normalises to (0, 0): a shot that never moves and never lands.
    const degenerate = heading.x === 0 && heading.y === 0;
    const dirX = degenerate ? 1 : heading.x;
    const dirY = degenerate ? 0 : heading.y;
    const speed = TILE_SIZE * HIRELING_SHOT_KINDS[shot.kind].speedTilesPerFrame;
    this.flights.push({
      x: shot.x,
      y: shot.y,
      vx: dirX * speed,
      vy: dirY * speed,
      heading: Math.atan2(dirY, dirX),
      travelledPx: 0,
      shot,
    });
  }

  private advance(ctx: SystemContext): void {
    const survivors: Flight[] = [];
    for (const flight of this.flights) {
      const nextX = flight.x + flight.vx;
      const nextY = flight.y + flight.vy;
      const blocked =
        !this.gameMap.isWalkable(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE)) ||
        this.isInSafeRoom({
          x: nextX - TILE_SIZE * CENTER_OFFSET,
          y: nextY - TILE_SIZE * CENTER_OFFSET,
        });
      if (blocked) {
        this.impactSoundPending = true;
        continue;
      }
      flight.x = nextX;
      flight.y = nextY;
      flight.travelledPx += Math.hypot(flight.vx, flight.vy);

      const victim = this.victimOf(ctx, flight);
      if (victim !== null) {
        const { shot } = flight;
        const damageType = HIRELING_SHOT_KINDS[shot.kind].damageType;
        victim.takeCreditedDamage(shot.damage, shot.owner, damageType, shot.shooter);
        shot.shooter.noteBlowLanded(victim);
        this.impactSoundPending = true;
        continue;
      }
      if (flight.travelledPx >= flight.shot.rangePx) continue;
      survivors.push(flight);
    }
    this.flights = survivors;
  }

  private victimOf(ctx: SystemContext, flight: Flight): Mob | null {
    const radius = TILE_SIZE * HIRELING_SHOT_KINDS[flight.shot.kind].hitRadiusTiles;
    this.nearby.clear();
    ctx.roster.grid.queryCircle(flight.x, flight.y, radius + TILE_SIZE, this.nearby);
    let best: Mob | null = null;
    let bestDistance = Infinity;
    for (const mob of this.nearby) {
      if (!this.canBeHit(mob, flight.shot.shooter)) continue;
      const distance = Math.hypot(
        flight.x - (mob.x + TILE_SIZE * CENTER_OFFSET),
        flight.y - (mob.y + TILE_SIZE * CENTER_OFFSET),
      );
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        best = mob;
      }
    }
    return best;
  }

  /**
   * Only a living hostile mob outside a safe room. Crawlers are not mobs, and
   * Mongo, quest allies and hirelings are never hostile, so the party cannot be
   * struck whichever way a shot happens to be crossing.
   */
  private canBeHit(mob: Mob, shooter: Mob): boolean {
    if (mob === shooter || !mob.isAlive || !mob.isHostile) return false;
    return !this.isInSafeRoom(mob);
  }

  /** Drawn over the creatures, so a shot crossing a fight never hides behind it. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const flight of this.flights) {
      HIRELING_SHOT_KINDS[flight.shot.kind].draw(
        ctx,
        flight.x - camX,
        flight.y - camY,
        TILE_SIZE,
        flight.heading,
      );
    }
  }

  /** A checkpoint restore must not resume a shot loosed in the run that died. */
  resetForCheckpoint(): void {
    this.flights = [];
    this.impactSoundPending = false;
  }
}
