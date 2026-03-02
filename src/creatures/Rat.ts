import { Player } from '../Player';
import { Mob } from './Mob';
import { drawRatSprite } from '../sprites/ratSprite';

const RAT_HP = 3;
const RAT_SPEED = 1.1;
const AGGRO_RANGE_TILES = 3;
const BITE_RANGE_TILES = 0.75;
/** Frames between bites (~2 s at 60 fps) */
const ATTACK_COOLDOWN = 120;
/** Frames the bite-lunge animation plays */
const ATTACK_ANIM_FRAMES = 14;

export class Rat extends Mob {
  readonly xpValue = 2;

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
    this.biteRangePx  = tileSize * BITE_RANGE_TILES;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    // Find nearest living target within aggro range
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < this.aggroRangePx && dist < nearestDist) {
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
      this.followTargetAStar(this.lastKnownTargetX, this.lastKnownTargetY, this.speed, this.biteRangePx * 0.8);
    } else {
      this.isMoving = false;
    }

    // Short windup before the first bite of each engagement
    const inRange = nearestDist <= this.biteRangePx * 1.15;
    if (inRange && this.firstBitePending && this.firstBiteWindup === 0) {
      this.firstBiteWindup = 10;
      this.firstBitePending = false;
    }
    if (this.firstBiteWindup > 0) this.firstBiteWindup--;

    // Same-tile contact always bites — can't dodge point-blank.
    if (inRange && this.attackCooldown === 0 && this.firstBiteWindup === 0 && (this.hasLOS(nearest) || this.onSameTile(nearest))) {
      nearest.takeDamage(1);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      ctx.strokeStyle = 'rgba(180, 40, 40, 0.60)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, sy, tileSize, tileSize);
    }

    const attackAnim = this.attackAnimTimer > 0
      ? Math.sin((1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES) * Math.PI)
      : 0;

    drawRatSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving, attackAnim);

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
