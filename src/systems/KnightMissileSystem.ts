/**
 * Owns every green bolt a Dark Knight has let go of.
 *
 * A system rather than state on the creature for the reason every projectile in
 * this codebase eventually learns: a mob stops being updated and stops being
 * drawn the frame it dies, so a bolt held on the knight vanished in mid-air the
 * instant the player landed the killing blow. Magic already in the air does not
 * care what happened to the knight who threw it.
 *
 * The knights queue their releases and this drains them, so nothing has to be
 * injected into a mob at spawn time.
 */

import type { Player, DamageSource } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { DarkKnight, KNIGHT_MISSILE_ATTACK_TYPE } from '../creatures/DarkKnight';
import { TILE_SIZE } from '../core/constants';
import {
  drawKnightMissile,
  drawKnightMissileBurst,
  KNIGHT_MISSILE_BURST_FRAMES,
} from '../sprites/knightMissileSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const CENTER_OFFSET = 0.5;

/**
 * How fast a bolt travels, in pixels per frame.
 *
 * Fast enough to feel like a shot rather than a lob, slow enough that a player
 * who is already moving across its line clears it — that crossing *is* the
 * counter-play, since the bolt is aimed where they stood when it left.
 */
const MISSILE_SPEED_PX = 5.4;
/** How close a bolt has to pass to a victim to count as a hit, in tiles. */
const MISSILE_HIT_RADIUS_TILES = 0.42;
/**
 * Frames a bolt may fly before it gives up, sized from the knight's own firing
 * range so a shot at the edge of it still arrives.
 */
const MISSILE_MAX_LIFETIME_FRAMES = 150;

/**
 * Live bolts beyond this are dropped oldest-first. Six per volley and a couple
 * of seconds of flight is the case this bounds; a second knight would be a
 * bounty escort that does not exist, but the cap costs nothing.
 */
const MAX_MISSILES = 24;

interface Missile {
  x: number;
  y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly damage: number;
  readonly source: DamageSource;
  /**
   * The knight that threw it, so a hit can be recorded against him.
   *
   * The whole point of this system is that a bolt outlives its knight, so this
   * may well reference a dead mob — which is fine, it is only ever read to note
   * blood. Held here rather than on the knight precisely because a projectile
   * stored on a mob is deleted in mid-air when that mob dies.
   */
  readonly owner: Mob;
  age: number;
}

interface Burst {
  readonly x: number;
  readonly y: number;
  tick: number;
}

export class KnightMissileSystem implements GameSystem {
  private missiles: Missile[] = [];
  private bursts: Burst[] = [];

  /** Set when a bolt lands; `DungeonScene` reads and clears it to play the hit. */
  impactSoundPending = false;

  constructor(private readonly gameMap: GameMap) {}

  update(ctx: SystemContext): void {
    this.collectReleases(ctx.mobs);
    this.advanceMissiles(ctx);
    this.advanceBursts();
  }

  /**
   * Drains every Dark Knight's queued releases.
   *
   * Walks the full mob list rather than only the ones near a player, for the
   * same reason the clown's vials do: a knight who releases a bolt and dies in
   * the same frame is skipped by every activation-radius query from the next
   * frame on, and his bolt would be stranded in a queue forever.
   */
  private collectReleases(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof DarkKnight)) continue;
      for (const released of mob.takePendingMissiles()) {
        const dx = released.toX - released.fromX;
        const dy = released.toY - released.fromY;
        const length = Math.hypot(dx, dy);
        // A bolt aimed at the knight's own position has no direction to travel
        // in; dropping it is better than dividing by zero into a NaN that would
        // then be drawn every frame forever.
        if (length === 0) continue;
        if (this.missiles.length >= MAX_MISSILES) this.missiles.shift();
        this.missiles.push({
          x: released.fromX,
          y: released.fromY,
          dirX: dx / length,
          dirY: dy / length,
          damage: released.damage,
          source: {
            kind: 'mob',
            mobType: released.mobType,
            attackType: KNIGHT_MISSILE_ATTACK_TYPE,
          },
          owner: mob,
          age: 0,
        });
      }
    }
  }

  private advanceMissiles(ctx: SystemContext): void {
    const targets = this.targetsFor(ctx);
    const survivors: Missile[] = [];
    for (const missile of this.missiles) {
      missile.age++;
      missile.x += missile.dirX * MISSILE_SPEED_PX;
      missile.y += missile.dirY * MISSILE_SPEED_PX;

      const victim = this.victimAt(missile, targets);
      if (victim !== null) {
        const connected = victim.takeDamage(missile.damage, missile.source);
        if (connected) missile.owner.noteStruckPlayer(victim);
        this.burstAt(missile);
        continue;
      }
      if (this.hitsWall(missile)) {
        this.burstAt(missile);
        continue;
      }
      if (missile.age >= MISSILE_MAX_LIFETIME_FRAMES) continue;
      survivors.push(missile);
    }
    this.missiles = survivors;
  }

  private victimAt(missile: Missile, targets: readonly Player[]): Player | null {
    const radius = TILE_SIZE * MISSILE_HIT_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(missile.x - cx, missile.y - cy) > radius) continue;
      return target;
    }
    return null;
  }

  /**
   * The bolt is a screen-space object with a world-space position: it is drawn
   * lifted to the height of the mace, but it collides on the flat, which is
   * where the walls are.
   */
  private hitsWall(missile: Missile): boolean {
    const tileX = Math.floor(missile.x / TILE_SIZE);
    const tileY = Math.floor(missile.y / TILE_SIZE);
    return !this.gameMap.isWalkable(tileX, tileY);
  }

  private burstAt(missile: Missile): void {
    this.bursts.push({ x: missile.x, y: missile.y, tick: KNIGHT_MISSILE_BURST_FRAMES });
    this.impactSoundPending = true;
  }

  /**
   * Everything a bolt can hit: the two players plus the scene's extra
   * player-like targets (Mongo, hired mercenaries).
   */
  private targetsFor(ctx: SystemContext): readonly Player[] {
    const targets: Player[] = [ctx.human, ctx.cat];
    // Defend-quest NPCs are escorted, not hunted — `MobUpdateLoop` strips them
    // out of the shared AI target list for the same reason, and killing one
    // fails the quest outright.
    if (ctx.extraTargets) {
      for (const extra of ctx.extraTargets) {
        if (extra.isDefendTarget === true) continue;
        if (!targets.includes(extra)) targets.push(extra);
      }
    }
    return targets;
  }

  private advanceBursts(): void {
    for (const burst of this.bursts) burst.tick--;
    this.bursts = this.bursts.filter((burst) => burst.tick > 0);
  }

  /** Bolts and their impacts, drawn over creatures so neither hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const missile of this.missiles) {
      drawKnightMissile(
        ctx,
        missile.x - camX,
        missile.y - camY,
        TILE_SIZE,
        missile.dirX,
        missile.dirY,
        missile.age,
      );
    }
    for (const burst of this.bursts) {
      const progress = 1 - burst.tick / KNIGHT_MISSILE_BURST_FRAMES;
      drawKnightMissileBurst(ctx, burst.x - camX, burst.y - camY, TILE_SIZE, progress);
    }
  }

  /** A checkpoint restore must not resume a bolt fired in the run that died. */
  resetForCheckpoint(): void {
    this.missiles = [];
    this.bursts = [];
    this.impactSoundPending = false;
  }
}
