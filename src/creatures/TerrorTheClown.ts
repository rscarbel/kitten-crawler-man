import { Mob } from './Mob';
import type { Player } from '../Player';
import {
  drawTerrorTheClownSprite,
  type TerrorTheClownAnimation,
  IDLE_LOOP_SECONDS,
} from '../sprites/terrorTheClownSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const TERROR_HP = 60;
const TERROR_SPEED = 1.0;
const AGGRO_RANGE_TILES = 9;
const ATTACK_RANGE_TILES = 1.8;
const ATTACK_DAMAGE = 14;
/** Frames between mallet swings (~2.3 s at 60 fps). */
const ATTACK_COOLDOWN = 140;
/** Windup and cooldown both shrink once enraged, below this HP fraction. */
const ENRAGE_HP_FRACTION = 0.5;
const ENRAGE_COOLDOWN_MULTIPLIER = 0.7;
const ENRAGE_WINDUP_MULTIPLIER = 0.75;
/** Frames of telegraph before every mallet swing. */
const WINDUP_FRAMES = 40;
/** Frames the swing animation plays after windup completes. */
const SWING_FRAMES = 20;
const COIN_DROP_MIN = 3;
const COIN_DROP_MAX = 6;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.75;
/**
 * The sheet's tile sits 150px down a 240px frame at a 64px tile scale, and the
 * raised mallet fills that headroom.
 */
const CULL_MARGIN_TILES = 3;

/**
 * Terror the Clown — Grimaldi's largest and most feared performer, a
 * hulking mini-boss guarding the big top's sideshow tents.
 */
export class TerrorTheClown extends Mob {
  readonly xpValue = 90;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Terror the Clown';
  description = "Grimaldi's hulking mini-boss, swinging an oversized mallet.";
  override readonly audioTag = 'clown';
  isEnraged = false;

  override get cullMarginTiles(): number {
    return CULL_MARGIN_TILES;
  }

  /** Staggers this clown's idle loop so a pack of them does not move as one. */
  private readonly idlePhaseOffsetSeconds = Math.random() * IDLE_LOOP_SECONDS;

  private attackCooldown = 0;
  private windupTimer = 0;
  /**
   * Length of the windup currently running. Enrage shortens the windup, and if
   * Terror crosses the threshold mid-telegraph, dividing by the *new* length
   * would send the animation's progress backwards.
   */
  private windupDuration = WINDUP_FRAMES;
  private swingTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TERROR_HP, TERROR_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.isEnraged = false;
    this.attackCooldown = 0;
    this.windupTimer = 0;
    this.windupDuration = WINDUP_FRAMES;
    this.swingTimer = 0;
    this.isAggro = false;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (!this.isEnraged && this.hp / this.maxHp <= ENRAGE_HP_FRACTION) {
      this.isEnraged = true;
    }

    if (this.attackCooldown > 0) this.attackCooldown--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const aggroScanRange = this.isAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if ((this.forceAggro || dist < aggroScanRange) && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.windupTimer = 0;
      this.swingTimer = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);

    if (this.windupTimer > 0 || this.swingTimer > 0) {
      this.isMoving = false;
    } else if (nearestDist > attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        attackRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    const inRange = nearestDist <= attackRangePx;

    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.windupTimer === 0 &&
      this.swingTimer === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.windupDuration = this.windupFrames();
      this.windupTimer = this.windupDuration;
      this.attackCooldown = this.isEnraged
        ? Math.round(ATTACK_COOLDOWN * ENRAGE_COOLDOWN_MULTIPLIER)
        : ATTACK_COOLDOWN;
    }

    if (this.windupTimer > 0) {
      this.windupTimer--;
      if (this.windupTimer === 0) {
        this.swingTimer = SWING_FRAMES;
        if (nearestDist <= attackRangePx) {
          this.dealDamage(nearest, ATTACK_DAMAGE);
        }
      }
    } else if (this.swingTimer > 0) {
      this.swingTimer--;
    }
  }

  /** Windup shortens once enraged, so the telegraph has to be measured against it. */
  private windupFrames(): number {
    return this.isEnraged ? Math.round(WINDUP_FRAMES * ENRAGE_WINDUP_MULTIPLIER) : WINDUP_FRAMES;
  }

  private animation(): TerrorTheClownAnimation {
    if (this.windupTimer > 0) {
      return { kind: 'windup', progress: 1 - this.windupTimer / this.windupDuration };
    }
    if (this.swingTimer > 0) {
      return { kind: 'swing', progress: 1 - this.swingTimer / SWING_FRAMES };
    }
    if (this.isMoving) return { kind: 'walk', cycle: this.walkFrame };
    return { kind: 'idle', phaseOffsetSeconds: this.idlePhaseOffsetSeconds };
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawTerrorTheClownSprite(ctx, sx, sy, tileSize, this.facingX, this.animation(), this.isEnraged);

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
