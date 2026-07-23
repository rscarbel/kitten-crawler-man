import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawStiltClownSprite } from '../sprites/stiltClownSprite';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const CLOWN_HP = 14;
const CLOWN_SPEED = 0.9;
const AGGRO_RANGE_TILES = 8;
/** Long reach — the stilt clown's signature "Slender Man" lunge. */
const ATTACK_RANGE_TILES = 2.2;
const ATTACK_DAMAGE = 7;
/** Frames between lunges (~2.2 s at 60 fps) — slow but telegraphed and punishing. */
const ATTACK_COOLDOWN = 130;
/** Frames of windup before every strike (not just the first) — sells the "telegraphed lunge" read. */
const WINDUP_FRAMES = 32;
/** Frames the lunge/strike animation plays after windup completes. */
const LUNGE_FRAMES = 18;
const COIN_DROP_MAX = 2;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.75;

/**
 * A Stilt Clown — one of Grimaldi's corrupted performers, towering on
 * spindly stilt legs with a long-reaching, telegraphed lunging strike.
 */
export class StiltClown extends Mob {
  readonly xpValue = 14;
  protected coinDropMin = 0;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Stilt Clown';
  description = 'A towering, spindly-limbed circus horror stalking on stilts.';
  override readonly audioTag = 'clown';

  private attackCooldown = 0;
  private windupTimer = 0;
  private lungeTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, CLOWN_HP, CLOWN_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

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
      this.lungeTimer = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);

    // Hold still while winding up or mid-lunge — the strike itself is stationary.
    if (this.windupTimer > 0 || this.lungeTimer > 0) {
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
      this.lungeTimer === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.windupTimer = WINDUP_FRAMES;
      this.attackCooldown = ATTACK_COOLDOWN;
    }

    if (this.windupTimer > 0) {
      this.windupTimer--;
      if (this.windupTimer === 0) {
        this.lungeTimer = LUNGE_FRAMES;
        if (nearestDist <= attackRangePx) {
          this.dealDamage(nearest, ATTACK_DAMAGE);
        }
      }
    } else if (this.lungeTimer > 0) {
      this.lungeTimer--;
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

    const windupProgress = this.windupTimer > 0 ? 1 - this.windupTimer / WINDUP_FRAMES : 0;
    const lungeProgress = this.lungeTimer > 0 ? 1 - this.lungeTimer / LUNGE_FRAMES : 0;

    const box = scaleHumanoidBox(sx, sy, tileSize);
    drawStiltClownSprite(
      ctx,
      box.sx,
      box.sy,
      box.s,
      this.walkFrame,
      this.isMoving,
      windupProgress,
      lungeProgress,
      this.facingX,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
