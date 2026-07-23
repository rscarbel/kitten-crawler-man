import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawTerrorTheClownSprite } from '../sprites/terrorTheClownSprite';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
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

  private attackCooldown = 0;
  private windupTimer = 0;
  private swingTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TERROR_HP, TERROR_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
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
      if (dist < aggroScanRange && dist < nearestDist) {
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
    const windupFrames = this.isEnraged
      ? Math.round(WINDUP_FRAMES * ENRAGE_WINDUP_MULTIPLIER)
      : WINDUP_FRAMES;

    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.windupTimer === 0 &&
      this.swingTimer === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.windupTimer = windupFrames;
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

    const windupFrames = this.isEnraged
      ? Math.round(WINDUP_FRAMES * ENRAGE_WINDUP_MULTIPLIER)
      : WINDUP_FRAMES;
    const windupProgress = this.windupTimer > 0 ? 1 - this.windupTimer / windupFrames : 0;
    const swingProgress = this.swingTimer > 0 ? 1 - this.swingTimer / SWING_FRAMES : 0;

    const box = scaleHumanoidBox(sx, sy, tileSize);
    drawTerrorTheClownSprite(
      ctx,
      box.sx,
      box.sy,
      box.s,
      this.walkFrame,
      this.isMoving,
      windupProgress,
      swingProgress,
      this.facingX,
      this.isEnraged,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
