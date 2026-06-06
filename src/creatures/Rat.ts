import type { Player } from '../Player';
import { Mob } from './Mob';
import { drawRatSprite } from '../sprites/ratSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const RAT_HP = 3;
const RAT_SPEED = 1.1;
const AGGRO_RANGE_TILES = 3;
const BITE_RANGE_TILES = 1.1;
/** Frames between bites (~2 s at 60 fps) */
const ATTACK_COOLDOWN = 120;
/** Frames the bite-lunge animation plays */
const ATTACK_ANIM_FRAMES = 14;
/** Fraction of bite range to use as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Fraction of bite range to check engagement for first-bite windup. */
const ENGAGE_RANGE_FRACTION = 1.15;

export class Rat extends Mob {
  readonly xpValue = 2;
  protected coinDropMin = 0;
  protected coinDropMax = 1;
  override readonly audioTag = 'rat';
  displayName = 'Rat';
  description = 'A nimble rodent that bites when cornered.';

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;
  private firstBitePending = true;
  private firstBiteWindup = 0;

  private readonly aggroRangePx: number;
  private readonly biteRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, RAT_HP, RAT_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.biteRangePx = tileSize * BITE_RANGE_TILES;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    // Find nearest living target within aggro range
    const aggroScanRange = this.isAggro
      ? this.aggroRangePx * AGGRO_PERSIST_MULTIPLIER
      : this.aggroRangePx;
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
      this.firstBitePending = true;
      this.firstBiteWindup = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;

    // Track last known position while we have LOS
    this.updateLastKnown(nearest);

    // Skitter toward last known position (= current when LOS clear)
    if (nearestDist > this.biteRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.biteRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    // Short windup before the first bite of each engagement
    const inRange = nearestDist <= this.biteRangePx * ENGAGE_RANGE_FRACTION;
    if (inRange && this.firstBitePending && this.firstBiteWindup === 0) {
      this.firstBiteWindup = 10;
      this.firstBitePending = false;
    }
    if (this.firstBiteWindup > 0) this.firstBiteWindup--;

    // Same-tile contact always bites — can't dodge point-blank.
    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.firstBiteWindup === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.dealDamage(nearest, 1);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    const attackAnim =
      this.attackAnimTimer > 0
        ? Math.sin((1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES) * Math.PI)
        : 0;

    drawRatSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving, attackAnim, this.facingX);

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
