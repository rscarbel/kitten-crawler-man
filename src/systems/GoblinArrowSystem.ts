/**
 * Everything a goblin archer's arrow does once it has left the string.
 *
 * A system rather than state on the creature, for the same reason
 * `LavaBallSystem` and `SkeletonProjectileSystem` are: a mob stops being updated
 * and stops being drawn the frame it dies — `MobUpdateLoop` skips the dead, and
 * kill resolution drops them out of the grid the renderer queries — so a
 * projectile owned by the archer vanished in mid-air the instant the player
 * landed the killing blow, which reads as the game eating the shot. An arrow
 * already loosed does not care what happened to the archer.
 *
 * Simpler than either of its two siblings on purpose: an arrow has no burst, no
 * fire patch and no status rider. It is a shaft that either finds someone or
 * ends up in a wall, which is exactly the point of the archer — the pressure is
 * that you have to *move*, not that the hit itself is complicated.
 */

import type { Player, DamageSource } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { GoblinArcher } from '../creatures/GoblinArcher';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import {
  SPENT_ARROW_FADE_FRAMES,
  SPENT_ARROW_FRAMES,
  drawGoblinArrow,
} from '../sprites/goblinArrowSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/** One arrow, as the archer hands it over. */
export interface GoblinArrowShot {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** Damage on a direct hit, already scaled for the archer's level. */
  readonly damage: number;
  /** Class name of the archer, so the death screen can name it. */
  readonly mobType: string;
  /**
   * Whoever the archer was aiming at, when that is not one of the two players.
   *
   * Mobs can be made hostile to each other, and an archer will happily lock onto
   * such a target. Without carrying it here the system has no way to know it
   * exists, and the shot flies straight through the thing it was aimed at.
   */
  readonly aimedAt: Player | null;
}

interface Arrow {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  age: number;
  readonly damage: number;
  readonly source: DamageSource;
  readonly aimedAt: Player | null;
}

/** A shaft that has already stopped, left in the floor for a moment. */
interface SpentArrow {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  framesLeft: number;
}

/**
 * World pixels per frame.
 *
 * Faster than a lava bolt and slower than a skeleton's bone arrow. It has to
 * beat the player's own run speed — an arrow you can simply walk away from is
 * not a reason to move — while staying slow enough that stepping *sideways* out
 * of the line works, which is the answer the fairness rules require to exist.
 */
const ARROW_SPEED = 3.4;

/** Collision radius of the shaft itself, in world pixels. */
const ARROW_RADIUS_PX = 4;
/** How close a target's centre must be for a direct hit, as a fraction of a tile. */
const TARGET_CENTER_RADIUS_RATIO = 0.35;
const CENTER_OFFSET = 0.5;

/**
 * Frames an arrow may fly before it is dropped, so one that somehow never meets
 * a wall cannot live forever.
 */
const MAX_FLIGHT_FRAMES = 240;

/**
 * Live spent shafts kept on the floor. A room of archers all missing into the
 * same corner is the case this bounds.
 */
const MAX_SPENT_ARROWS = 24;

export class GoblinArrowSystem implements GameSystem {
  private arrows: Arrow[] = [];
  private spent: SpentArrow[] = [];

  constructor(private readonly gameMap: GameMap) {}

  update(ctx: SystemContext): void {
    this.collectShots(ctx.mobs);
    this.advance(ctx);
    for (const shaft of this.spent) shaft.framesLeft--;
    this.spent = this.spent.filter((shaft) => shaft.framesLeft > 0);
  }

  /**
   * Drains every archer's queued shots.
   *
   * Deliberately walks the full mob list rather than only the ones near a
   * player: an archer that looses and dies in the same frame is skipped by every
   * activation-radius query from the next frame on, and its shot would be
   * stranded in a queue forever.
   */
  private collectShots(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof GoblinArcher)) continue;
      for (const shot of mob.takePendingShots()) this.launch(shot);
    }
  }

  private launch(shot: GoblinArrowShot): void {
    const heading = normalize(shot.dirX, shot.dirY);
    this.arrows.push({
      x: shot.x,
      y: shot.y,
      vx: heading.x * ARROW_SPEED,
      vy: heading.y * ARROW_SPEED,
      age: 0,
      damage: shot.damage,
      // An arrow crossing open ground is exactly what dodge is for.
      source: { kind: 'mob', mobType: shot.mobType },
      aimedAt: shot.aimedAt,
    });
  }

  private advance(ctx: SystemContext): void {
    const hitRadius = ARROW_RADIUS_PX + TILE_SIZE * TARGET_CENTER_RADIUS_RATIO;
    const survivors: Arrow[] = [];

    for (const arrow of this.arrows) {
      arrow.age++;
      if (arrow.age > MAX_FLIGHT_FRAMES) continue;

      const nextX = arrow.x + arrow.vx;
      const nextY = arrow.y + arrow.vy;
      if (!this.gameMap.isWalkable(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE))) {
        // Stopped at the last clear position rather than inside the wall, so the
        // shaft is left standing in floor the player can see.
        this.land(arrow);
        continue;
      }
      arrow.x = nextX;
      arrow.y = nextY;

      let struck = false;
      for (const target of this.targetsFor(ctx, arrow)) {
        if (!target.isAlive) continue;
        const cx = target.x + TILE_SIZE * CENTER_OFFSET;
        const cy = target.y + TILE_SIZE * CENTER_OFFSET;
        if (Math.hypot(arrow.x - cx, arrow.y - cy) >= hitRadius) continue;
        target.takeDamage(arrow.damage, arrow.source);
        struck = true;
        break;
      }
      if (struck) continue;
      survivors.push(arrow);
    }

    this.arrows = survivors;
  }

  /** Leaves a spent shaft where an arrow stopped. */
  private land(arrow: Arrow): void {
    if (this.spent.length >= MAX_SPENT_ARROWS) this.spent.shift();
    this.spent.push({
      x: arrow.x,
      y: arrow.y,
      heading: Math.atan2(arrow.vy, arrow.vx),
      framesLeft: SPENT_ARROW_FRAMES,
    });
  }

  /**
   * Everything this arrow can hit: the two players, the scene's extra
   * player-like targets (Mongo, hired mercenaries), and whatever the archer was
   * actually aiming at.
   */
  private targetsFor(ctx: SystemContext, arrow: Arrow): readonly Player[] {
    const targets: Player[] = [ctx.human, ctx.cat];
    /**
     * Defend-quest NPCs are escorted, not hunted. `MobUpdateLoop` strips them
     * out of the shared AI target list for exactly this reason, and losing one
     * fails the quest — so a stray shaft must never be able to reach them.
     */
    const consider = (candidate: Player): void => {
      if (candidate.isDefendTarget === true) return;
      if (!targets.includes(candidate)) targets.push(candidate);
    };
    if (ctx.extraTargets) {
      for (const extra of ctx.extraTargets) consider(extra);
    }
    if (arrow.aimedAt !== null) consider(arrow.aimedAt);
    return targets;
  }

  /** Drawn over creatures, so a shaft never disappears behind the mob it passes. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const shaft of this.spent) {
      const alpha = Math.min(1, shaft.framesLeft / SPENT_ARROW_FADE_FRAMES);
      drawGoblinArrow(ctx, shaft.x - camX, shaft.y - camY, TILE_SIZE, shaft.heading, alpha);
    }
    for (const arrow of this.arrows) {
      drawGoblinArrow(
        ctx,
        arrow.x - camX,
        arrow.y - camY,
        TILE_SIZE,
        Math.atan2(arrow.vy, arrow.vx),
      );
    }
  }

  /** A checkpoint restore must not resume a shot fired in the run that died. */
  resetForCheckpoint(): void {
    this.arrows = [];
    this.spent = [];
  }
}
