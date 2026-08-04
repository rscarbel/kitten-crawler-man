/**
 * Owns everything the Skeleton Lord's encounter puts in the air: his soul bolts
 * and his archers' bone arrows.
 *
 * It is a system rather than state on the creatures for one reason, the same one
 * `LavaBallSystem` exists for. A mob stops being updated and stops being drawn
 * the frame it dies — `MobUpdateLoop` skips the dead, and kill resolution drops
 * them out of the spatial grid the renderer queries — so a projectile owned by
 * the caster vanishes in mid-air the instant the player lands the killing blow,
 * which reads as the game eating the shot. An arrow already loosed does not care
 * what happened to the archer, and now neither does the code.
 *
 * One system for both kinds keeps the encounter self-contained: they share a
 * flight loop, a wall test and a target list, and differ only in what they do
 * when they arrive.
 */

import type { Player, DamageSource } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawSoulBolt, drawSoulBurst, drawBoneArrow } from '../sprites/skeletonEffectsSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/** The two things a skeleton can put in the air. */
export type SkeletonShotKind = 'soul_bolt' | 'bone_arrow';

/** One shot, as its caster hands it over. */
export interface SkeletonShot {
  readonly kind: SkeletonShotKind;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** Damage on a direct hit, already scaled for the caster's level. */
  readonly damage: number;
  /** Class name of the caster, so the death screen can name it. */
  readonly mobType: string;
  /**
   * Whoever the caster was aiming at, when that is not one of the two players.
   *
   * Mobs can be made hostile to each other, and a skeleton will happily lock
   * onto such a target. Without carrying it here the system has no way to know
   * it exists, and the shot flies straight through the thing it was aimed at.
   */
  readonly aimedAt: Player | null;
}

interface Projectile {
  readonly kind: SkeletonShotKind;
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  age: number;
  readonly damage: number;
  readonly source: DamageSource;
  readonly burstSource: DamageSource;
  readonly aimedAt: Player | null;
}

interface Burst {
  readonly x: number;
  readonly y: number;
  tick: number;
}

/** World pixels per frame. A soul bolt drifts; an arrow snaps. */
const SOUL_BOLT_SPEED = 2.4;
const BONE_ARROW_SPEED = 4.6;

/** Collision radius of the projectile itself, in world pixels. */
const SOUL_BOLT_RADIUS_PX = 8;
const BONE_ARROW_RADIUS_PX = 4;

/** How close a target's centre must be for a direct hit, as a fraction of a tile. */
const TARGET_CENTER_RADIUS_RATIO = 0.35;
const CENTER_OFFSET = 0.5;

/**
 * Frames a shot may fly before it is dropped, so one that somehow never meets a
 * wall cannot live forever. It is dropped rather than detonated: a bolt bursting
 * here would go off in mid-air over open floor.
 */
const MAX_FLIGHT_FRAMES = 300;

const BURST_FRAMES = 22;
/** Radius the soul burst damages within, in tiles. Small — the bolt is the attack. */
const BURST_RADIUS_TILES = 0.7;
const BURST_DAMAGE = 1;

export class SkeletonProjectileSystem implements GameSystem {
  private projectiles: Projectile[] = [];
  private bursts: Burst[] = [];

  /** Set when a bolt lands; `DungeonScene` reads and clears it to play the cue. */
  burstSoundPending = false;

  constructor(private readonly gameMap: GameMap) {}

  update(ctx: SystemContext): void {
    this.collectShots(ctx.mobs);
    this.advance(ctx);
    for (const burst of this.bursts) burst.tick--;
    this.bursts = this.bursts.filter((burst) => burst.tick > 0);
  }

  /**
   * Drains every caster's queued shots.
   *
   * Deliberately walks the full mob list rather than only the ones near a
   * player: a caster that fires and dies in the same frame is skipped by every
   * activation-radius query from the next frame on, and its shot would be
   * stranded in a queue forever.
   */
  private collectShots(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof SkeletonLord) && !(mob instanceof SkeletonArcher)) continue;
      for (const shot of mob.takePendingShots()) this.launch(shot);
    }
  }

  private launch(shot: SkeletonShot): void {
    const heading = normalize(shot.dirX, shot.dirY);
    const speed = shot.kind === 'soul_bolt' ? SOUL_BOLT_SPEED : BONE_ARROW_SPEED;
    this.projectiles.push({
      kind: shot.kind,
      x: shot.x,
      y: shot.y,
      vx: heading.x * speed,
      vy: heading.y * speed,
      age: 0,
      damage: shot.damage,
      // A shot crossing open ground is exactly what dodge is for, so it stays
      // dodgeable. The burst it makes on landing is not — there is no
      // sidestepping a blast you are already standing in.
      source: { kind: 'mob', mobType: shot.mobType },
      burstSource: { kind: 'mob', mobType: shot.mobType, undodgeable: true },
      aimedAt: shot.aimedAt,
    });
  }

  private advance(ctx: SystemContext): void {
    const survivors: Projectile[] = [];

    for (const projectile of this.projectiles) {
      projectile.age++;
      if (projectile.age > MAX_FLIGHT_FRAMES) continue;

      const targets = this.targetsFor(ctx, projectile);
      const nextX = projectile.x + projectile.vx;
      const nextY = projectile.y + projectile.vy;
      if (!this.gameMap.isWalkable(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE))) {
        // Landed at the last clear position rather than inside the wall, so a
        // burst sits on floor the player can actually stand on.
        this.land(projectile, targets);
        continue;
      }
      projectile.x = nextX;
      projectile.y = nextY;

      const hitRadius =
        (projectile.kind === 'soul_bolt' ? SOUL_BOLT_RADIUS_PX : BONE_ARROW_RADIUS_PX) +
        TILE_SIZE * TARGET_CENTER_RADIUS_RATIO;
      let struck: Player | null = null;
      for (const target of targets) {
        if (!target.isAlive) continue;
        const cx = target.x + TILE_SIZE * CENTER_OFFSET;
        const cy = target.y + TILE_SIZE * CENTER_OFFSET;
        if (Math.hypot(projectile.x - cx, projectile.y - cy) >= hitRadius) continue;
        target.takeDamage(projectile.damage, projectile.source);
        struck = target;
        break;
      }
      if (struck !== null) {
        this.land(projectile, targets, struck);
        continue;
      }
      survivors.push(projectile);
    }

    this.projectiles = survivors;
  }

  /**
   * Ends a projectile's flight.
   *
   * Only a soul bolt bursts. An arrow that hits a wall is simply gone — a bone
   * shaft has nothing in it to go off, and giving it a blast would make the
   * archers hit harder from behind cover than the lord does.
   */
  private land(projectile: Projectile, targets: readonly Player[], directHit?: Player): void {
    if (projectile.kind !== 'soul_bolt') return;
    const { x, y } = projectile;
    this.bursts.push({ x, y, tick: BURST_FRAMES });
    this.burstSoundPending = true;

    const radius = TILE_SIZE * BURST_RADIUS_TILES;
    for (const target of targets) {
      // Whoever the bolt actually hit has already taken the full projectile
      // damage; charging them the splash as well means a direct hit quietly
      // costs more than the tuned number says it does.
      if (!target.isAlive || target === directHit) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      target.takeDamage(BURST_DAMAGE, projectile.burstSource);
    }
  }

  /**
   * Everything this projectile can hit: the two players, the scene's extra
   * player-like targets (Mongo, hired mercenaries), and whatever the caster was
   * actually aiming at.
   */
  private targetsFor(ctx: SystemContext, projectile: Projectile): readonly Player[] {
    const targets: Player[] = [ctx.human, ctx.cat];
    /**
     * Defend-quest NPCs are escorted, not hunted. `MobUpdateLoop` strips them
     * out of the shared AI target list for exactly this reason, and losing one
     * fails the quest — so a stray blast must never be able to reach them.
     */
    const consider = (candidate: Player): void => {
      if (candidate.isDefendTarget === true) return;
      if (!targets.includes(candidate)) targets.push(candidate);
    };
    if (ctx.extraTargets) {
      for (const extra of ctx.extraTargets) consider(extra);
    }
    if (projectile.aimedAt !== null) consider(projectile.aimedAt);
    return targets;
  }

  /** Drawn over creatures, so a shot never disappears behind the mob it passes. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const burst of this.bursts) {
      const progress = 1 - burst.tick / BURST_FRAMES;
      drawSoulBurst(ctx, burst.x - camX, burst.y - camY, TILE_SIZE, progress);
    }
    for (const projectile of this.projectiles) {
      const sx = projectile.x - camX;
      const sy = projectile.y - camY;
      if (projectile.kind === 'soul_bolt') {
        drawSoulBolt(ctx, sx, sy, TILE_SIZE, projectile.age);
        continue;
      }
      drawBoneArrow(ctx, sx, sy, TILE_SIZE, Math.atan2(projectile.vy, projectile.vx));
    }
  }

  /** A checkpoint restore must not resume a shot fired in the run that died. */
  resetForCheckpoint(): void {
    this.projectiles = [];
    this.bursts = [];
    this.burstSoundPending = false;
  }
}
