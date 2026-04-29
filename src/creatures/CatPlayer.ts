import { Player } from '../Player';
import type { Mob } from './Mob';
import type { Missile } from '../sprites/catSprite';
import { drawCatSprite, drawMissiles } from '../sprites/catSprite';
import type { GameMap } from '../map/GameMap';
import { normalize } from '../utils';
import type { AbilityManager } from '../core/AbilityManager';
import { getMagicMissileStats } from '../abilities/magicMissile';
import { TILE_SIZE } from '../core/constants';

/**
 * This is a playable character.
 * The cat has the power "magic missile"
 * which is a long range attack
 */

export class CatPlayer extends Player {
  private missiles: Missile[] = [];
  private readonly EXPLODE_FRAMES = 22;
  private missileCooldown = 0;
  private map: GameMap | null = null;
  private abilityManager: AbilityManager | null = null;

  /** Sub-missile spawns queued by CombatSystem this frame; flushed after resolvePlayerAttacks. */
  private pendingSubMissileSpawns: Array<{ x: number; y: number }> = [];

  /** The mob the cat will automatically shoot at when not player-controlled. */
  autoTarget: Mob | null = null;

  setMap(map: GameMap) {
    this.map = map;
  }

  setAbilityManager(manager: AbilityManager): void {
    this.abilityManager = manager;
  }

  getMagicMissileLevel(): number {
    return this.abilityManager?.getLevel('magic_missile') ?? 1;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, 8);
  }

  getMissileDamage(): number {
    const base = 2 + this.intelligence;
    const stats = getMagicMissileStats(this.getMagicMissileLevel());
    return Math.round(base * stats.damageMultiplier);
  }

  get missileCooldownCurrent(): number {
    return this.missileCooldown;
  }

  get missileCooldownMax(): number {
    return getMagicMissileStats(this.getMagicMissileLevel()).cooldownFrames;
  }

  private fireMissile(angleOffset = 0, isSubMissile = false, fromX?: number, fromY?: number) {
    const level = this.getMagicMissileLevel();
    const stats = getMagicMissileStats(level);
    const baseAngle = Math.atan2(this.facingY, this.facingX) + angleOffset;
    const baseRange = (3.5 + this.intelligence * 0.5) * this.tileSize;
    const maxDist = isSubMissile ? this.tileSize * 1.8 : baseRange * stats.rangeMultiplier;

    this.missiles.push({
      x: fromX ?? this.x + this.tileSize * 0.5,
      y: fromY ?? this.y + this.tileSize * 0.5,
      vx: Math.cos(baseAngle) * stats.speed,
      vy: Math.sin(baseAngle) * stats.speed,
      distTraveled: 0,
      maxDist,
      state: 'flying',
      explodeTimer: this.EXPLODE_FRAMES,
      hit: false,
      abilityLevel: isSubMissile ? 1 : level,
      isSubMissile,
    });

    if (!isSubMissile) {
      this.abilityManager?.addUsageXp('magic_missile');
    }
  }

  triggerAttack() {
    const cooldownMax = this.missileCooldownMax;
    if (this.missileCooldown > 0) return;
    this.fireMissile();
    this.missileCooldown = cooldownMax;
  }

  getMissiles(): Missile[] {
    return this.missiles;
  }

  /**
   * Queue a sub-missile spawn from a missile impact point (called by CombatSystem).
   * Flushed by flushPendingSubMissiles() after resolvePlayerAttacks completes.
   */
  queueSubMissileSpawn(x: number, y: number): void {
    this.pendingSubMissileSpawns.push({ x, y });
  }

  /** Spawns any sub-missiles queued this frame. Call after resolvePlayerAttacks. */
  flushPendingSubMissiles(): void {
    for (const { x, y } of this.pendingSubMissileSpawns) {
      const count = 3 + Math.floor(Math.random() * 3); // 3–5
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        this.fireMissile(angle - Math.atan2(this.facingY, this.facingX), true, x, y);
      }
    }
    this.pendingSubMissileSpawns = [];
  }

  /**
   * Called every frame when the cat is the follower and has an autoTarget.
   * Faces the target and fires missiles on cooldown.
   * @param missChance 0–1 probability the shot flies slightly off-target (visible miss).
   */
  autoFireTick(missChance = 0) {
    if (!this.autoTarget?.isAlive) {
      this.autoTarget = null;
      return;
    }

    const dx = this.autoTarget.x + this.tileSize * 0.5 - (this.x + this.tileSize * 0.5);
    const dy = this.autoTarget.y + this.tileSize * 0.5 - (this.y + this.tileSize * 0.5);
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
    }

    const cooldownMax = this.missileCooldownMax;
    if (this.missileCooldown > 0) {
      this.missileCooldown--;
    } else {
      // Use the same shared cooldown as player-triggered shots
      const offset = Math.random() < missChance ? (Math.random() - 0.5) * 2 * 0.44 : 0;
      this.fireMissile(offset);
      this.missileCooldown = cooldownMax;
    }
  }

  updateMissiles(mobs?: ReadonlyArray<Mob>) {
    const level = this.getMagicMissileLevel();
    const hasHoming = level >= 14;
    const HOMING_RANGE_PX = TILE_SIZE * 12;
    const CONE_HALF = Math.PI / 3; // ±60° = 120° total
    const TURN_RATE = 0.08; // radians/frame

    if (this.missileCooldown > 0) this.missileCooldown--;

    for (const m of this.missiles) {
      if (m.state === 'flying') {
        // Level 14+ homing: curve toward nearest mob in forward cone
        if (hasHoming && !m.isSubMissile && mobs && mobs.length > 0) {
          const speed = Math.hypot(m.vx, m.vy);
          if (speed > 0) {
            const dirAngle = Math.atan2(m.vy, m.vx);
            let bestMob: Mob | null = null;
            let bestDist = Infinity;

            for (const mob of mobs) {
              if (!mob.isAlive) continue;
              const ddx = mob.x + TILE_SIZE * 0.5 - m.x;
              const ddy = mob.y + TILE_SIZE * 0.5 - m.y;
              const dist = Math.hypot(ddx, ddy);
              if (dist > HOMING_RANGE_PX || dist < 1) continue;
              const mobAngle = Math.atan2(ddy, ddx);
              let angleDiff = Math.abs(mobAngle - dirAngle);
              if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
              if (angleDiff > CONE_HALF) continue;
              if (dist < bestDist) {
                bestDist = dist;
                bestMob = mob;
              }
            }

            if (bestMob) {
              const ddx = bestMob.x + TILE_SIZE * 0.5 - m.x;
              const ddy = bestMob.y + TILE_SIZE * 0.5 - m.y;
              const targetAngle = Math.atan2(ddy, ddx);
              let diff = targetAngle - dirAngle;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              const turn = Math.min(Math.abs(diff), TURN_RATE) * Math.sign(diff);
              const newAngle = dirAngle + turn;
              m.vx = Math.cos(newAngle) * speed;
              m.vy = Math.sin(newAngle) * speed;
            }
          }
        }

        const nextX = m.x + m.vx;
        const nextY = m.y + m.vy;
        if (this.map) {
          const tx = Math.floor(nextX / this.tileSize);
          const ty = Math.floor(nextY / this.tileSize);
          if (!this.map.isWalkable(tx, ty)) {
            m.state = 'exploding';
            continue;
          }
        }
        m.x = nextX;
        m.y = nextY;
        m.distTraveled += Math.hypot(m.vx, m.vy);
        if (m.distTraveled >= m.maxDist) {
          m.state = 'exploding';
        }
      } else {
        m.explodeTimer--;
      }
    }
    this.missiles = this.missiles.filter((m) => !(m.state === 'exploding' && m.explodeTimer <= 0));
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const s = tileSize;

    // Active indicator — yellow tile outline
    if (this.isActive) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, s - 2, s - 2);
    }

    drawCatSprite(ctx, sx, sy, s, this.walkFrame, this.isMoving, this.facingY);
    drawMissiles(ctx, this.missiles, camX, camY, s, this.EXPLODE_FRAMES);

    this.renderHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
    this.renderStatusEffects(ctx, sx, sy);
  }
}
