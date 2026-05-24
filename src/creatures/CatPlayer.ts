import { Player } from '../Player';
import type { Mob } from './Mob';
import type { Missile } from '../sprites/catSprite';
import { drawCatSprite, drawCatClawSwipe, drawMissiles } from '../sprites/catSprite';
import type { GameMap } from '../map/GameMap';
import { normalize } from '../utils';
import type { AbilityManager } from '../core/AbilityManager';
import { getMagicMissileStats } from '../abilities/magicMissile';
import { TILE_SIZE } from '../core/constants';
import { ITEM_DEF } from '../core/ItemDefs';

/**
 * This is a playable character.
 * Primary attack (Space): claw swipe — short-range melee.
 * Magic Missile: hotbar ability, fires an arcane projectile.
 */

export class CatPlayer extends Player {
  private missiles: Missile[] = [];
  private readonly EXPLODE_FRAMES = 22;
  private missileCooldown = 0;
  private map: GameMap | null = null;
  private abilityManager: AbilityManager | null = null;

  private attackTimer = 0;
  private readonly ATTACK_FRAMES = 18;

  /** Sub-missile spawns queued by CombatSystem this frame; flushed after resolvePlayerAttacks. */
  private pendingSubMissileSpawns: Array<{ x: number; y: number }> = [];

  /** The mob the cat will automatically shoot at when not player-controlled. */
  autoTarget: Mob | null = null;

  private static readonly CAT_STARTING_HP = 8;
  private static readonly STARTING_POTIONS = 10;
  private static readonly MELEE_RANGE_MULTIPLIER = 1.6;
  private static readonly MISSILE_BASE_RANGE = 3.5;
  private static readonly MISSILE_RANGE_INTELLIGENCE_MULTIPLIER = 0.5;
  private static readonly SUBMISSILE_MAX_DIST_TILES = 1.8;
  private static readonly MISSILE_CENTER_OFFSET_X = 0.5;
  private static readonly MISSILE_CENTER_OFFSET_Y = 0.5;
  private static readonly SUBMISSILE_COUNT_BASE = 3;
  private static readonly SUBMISSILE_COUNT_RANDOM_RANGE = 3;
  private static readonly SUBMISSILE_ANGLE_VARIANCE = 0.4;
  private static readonly MISSILE_HOMING_DISTANCE_TILES = 12;
  private static readonly HOMING_CONE_DEGREES = 3;
  private static readonly HOMING_CONE_HALF_ANGLE = Math.PI / CatPlayer.HOMING_CONE_DEGREES;
  private static readonly HOMING_TURN_RATE = 0.08;
  private static readonly MOB_CENTER_OFFSET_X = 0.5;
  private static readonly MOB_CENTER_OFFSET_Y = 0.5;
  private static readonly MISSILE_CENTER_OFFSET = 0.5;
  private static readonly MISSILE_CENTER_OFFSET_2 = 0.5;
  private static readonly ACTIVE_INDICATOR_OFFSET_X = 6;
  private static readonly ACTIVE_INDICATOR_OFFSET_Y = 4;
  private static readonly ACTIVE_INDICATOR_WIDTH = 12;
  private static readonly ACTIVE_INDICATOR_HEIGHT = 12;
  private static readonly AI_MIN_COOLDOWN = 20;
  private static readonly MISS_OFFSET_FACTOR = 0.44;
  private static readonly HOMING_LEVEL_THRESHOLD = 14;
  private static readonly RANDOM_OFFSET_BASE = 0.5;

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
    super(tileX, tileY, tileSize, CatPlayer.CAT_STARTING_HP);
    // Initialize Magic Missile tome in hotbar slot 0
    this.inventory.actionBar.slots[0] = { ...ITEM_DEF.magic_missile_tome, quantity: 1 };
    // Move starting potions from bag to hotbar slot 1 for quick access
    this.inventory.removeItems('health_potion', CatPlayer.STARTING_POTIONS);
    this.inventory.actionBar.slots[1] = {
      ...ITEM_DEF.health_potion,
      quantity: CatPlayer.STARTING_POTIONS,
    };
  }

  getMissileDamage(): number {
    const base = 2 + this.intelligence;
    const stats = getMagicMissileStats(this.getMagicMissileLevel());
    return Math.round(base * stats.damageMultiplier);
  }

  getMeleeDamage(): number {
    return 1 + this.strength;
  }

  getMeleeRange(): number {
    return this.tileSize * CatPlayer.MELEE_RANGE_MULTIPLIER;
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
    const baseRange =
      (CatPlayer.MISSILE_BASE_RANGE +
        this.intelligence * CatPlayer.MISSILE_RANGE_INTELLIGENCE_MULTIPLIER) *
      this.tileSize;
    const maxDist = isSubMissile
      ? this.tileSize * CatPlayer.SUBMISSILE_MAX_DIST_TILES
      : baseRange * stats.rangeMultiplier;

    this.missiles.push({
      x: fromX ?? this.x + this.tileSize * CatPlayer.MISSILE_CENTER_OFFSET_X,
      y: fromY ?? this.y + this.tileSize * CatPlayer.MISSILE_CENTER_OFFSET_Y,
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

  /** Primary Space action: claw swipe (melee). */
  triggerAttack() {
    if (this.attackTimer > 0) return;
    this.attackTimer = this.ATTACK_FRAMES;
  }

  /** Hotbar-triggered magic missile fire. Returns true if a missile was actually launched. */
  triggerMissile(): boolean {
    if (this.missileCooldown > 0) return false;
    this.fireMissile();
    this.missileCooldown = this.missileCooldownMax;
    return true;
  }

  /** True when the companion auto-fire launched a missile this frame. Cleared by the consumer. */
  pendingAutoFireSound = false;

  updateAttack() {
    if (this.attackTimer > 0) this.attackTimer--;
  }

  /** Returns true on the single frame when the claw hits (peak of the swing). */
  isAttackPeak(): boolean {
    return this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
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
      const count =
        CatPlayer.SUBMISSILE_COUNT_BASE +
        Math.floor(Math.random() * CatPlayer.SUBMISSILE_COUNT_RANDOM_RANGE); // 3–5
      for (let i = 0; i < count; i++) {
        const angle =
          (i / count) * Math.PI * 2 + Math.random() * CatPlayer.SUBMISSILE_ANGLE_VARIANCE;
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

    const dx =
      this.autoTarget.x +
      this.tileSize * CatPlayer.MISSILE_CENTER_OFFSET -
      (this.x + this.tileSize * CatPlayer.MISSILE_CENTER_OFFSET);
    const dy =
      this.autoTarget.y +
      this.tileSize * CatPlayer.MISSILE_CENTER_OFFSET -
      (this.y + this.tileSize * CatPlayer.MISSILE_CENTER_OFFSET);
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
    }

    // AI fires at most as fast as an average human could (~3 shots/sec at 60fps).
    const cooldownMax = Math.max(this.missileCooldownMax, CatPlayer.AI_MIN_COOLDOWN);
    if (this.missileCooldown > 0) {
      this.missileCooldown--;
    } else {
      // Use the same shared cooldown as player-triggered shots
      const offset =
        Math.random() < missChance
          ? (Math.random() - CatPlayer.RANDOM_OFFSET_BASE) * 2 * CatPlayer.MISS_OFFSET_FACTOR
          : 0;
      this.fireMissile(offset);
      this.missileCooldown = cooldownMax;
      this.pendingAutoFireSound = true;
    }
  }

  updateMissiles(mobs?: ReadonlyArray<Mob>) {
    const level = this.getMagicMissileLevel();
    const hasHoming = level >= CatPlayer.HOMING_LEVEL_THRESHOLD;
    const HOMING_RANGE_PX = TILE_SIZE * CatPlayer.MISSILE_HOMING_DISTANCE_TILES;
    const CONE_HALF = CatPlayer.HOMING_CONE_HALF_ANGLE; // ±60° = 120° total
    const TURN_RATE = CatPlayer.HOMING_TURN_RATE; // radians/frame

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
              const ddx = mob.x + TILE_SIZE * CatPlayer.MOB_CENTER_OFFSET_X - m.x;
              const ddy = mob.y + TILE_SIZE * CatPlayer.MOB_CENTER_OFFSET_Y - m.y;
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
              const ddx = bestMob.x + TILE_SIZE * CatPlayer.MOB_CENTER_OFFSET_X - m.x;
              const ddy = bestMob.y + TILE_SIZE * CatPlayer.MISSILE_CENTER_OFFSET_2 - m.y;
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

    // Active indicator — slightly larger yellow outline, 40% transparent.
    // Cat sprite: tileX=16, tileY=8, tileScale=64, frame 96×96 → at tileSize=32
    //   scale=0.5, display 48×48, anchor at (sx−8, sy−4).
    if (this.isActive) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        sx - CatPlayer.ACTIVE_INDICATOR_OFFSET_X,
        sy - CatPlayer.ACTIVE_INDICATOR_OFFSET_Y,
        s + CatPlayer.ACTIVE_INDICATOR_WIDTH,
        s + CatPlayer.ACTIVE_INDICATOR_HEIGHT,
      );
      ctx.restore();
    }

    drawCatSprite(ctx, sx, sy, s, this.walkFrame, this.isMoving, this.facingY, this.facingX);
    if (this.attackTimer > 0) {
      drawCatClawSwipe(ctx, sx, sy, s, this.attackTimer, this.ATTACK_FRAMES, this.facingX);
    }
    drawMissiles(ctx, this.missiles, camX, camY, s, this.EXPLODE_FRAMES);

    this.renderHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
    this.renderStatusEffects(ctx, sx, sy);
    this.renderKnockedOutOverlay(ctx, sx, sy);
  }
}
