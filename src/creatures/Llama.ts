import { Player } from '../Player';
import { Mob } from './Mob';
import { drawLlamaSprite } from '../sprites/llamaSprite';
import { makeBurn } from '../core/StatusEffect';

interface LavaBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When true the ball has hit something and is playing its burst animation. */
  exploding: boolean;
  explodeTick: number;
}

const LLAMA_HP = 10;
const LLAMA_SPEED = 1.0;
const AGGRO_RANGE_TILES = 8;
/** Llamas keep their distance and spit from afar */
const SPIT_RANGE_TILES = 5.5;
/** Frames between spits (~2.5 s at 60 fps) */
const SPIT_COOLDOWN = 150;
/** Frames the spit-lunge animation plays */
const SPIT_ANIM_FRAMES = 20;
const LAVA_BALL_SPEED = 1.3;
const LAVA_BALL_DAMAGE = 2;
const LAVA_BALL_RADIUS = 8;
const EXPLODE_TICKS = 22;

export class Llama extends Mob {
  readonly xpValue = 8;
  protected coinDropMin = 4;
  protected coinDropMax = 5;
  private lavaBalls: LavaBall[] = [];
  private spitCooldown = 0;
  private spitAnimTimer = 0;
  private aggroRangePx: number;
  private spitRangePx: number;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LLAMA_HP, LLAMA_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.spitRangePx = tileSize * SPIT_RANGE_TILES;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.spitCooldown > 0) this.spitCooldown--;
    if (this.spitAnimTimer > 0) this.spitAnimTimer--;

    // Advance lava balls & check wall/player hits
    for (const ball of this.lavaBalls) {
      if (ball.exploding) {
        ball.explodeTick--;
        continue;
      }
      const nextX = ball.x + ball.vx;
      const nextY = ball.y + ball.vy;
      // Wall collision — explode on impact
      if (this.map) {
        const tx = Math.floor(nextX / this.tileSize);
        const ty = Math.floor(nextY / this.tileSize);
        if (!this.map.isWalkable(tx, ty)) {
          ball.exploding = true;
          ball.explodeTick = EXPLODE_TICKS;
          continue;
        }
      }
      ball.x = nextX;
      ball.y = nextY;
      for (const t of targets) {
        if (!t.isAlive) continue;
        const cx = t.x + this.tileSize * 0.5;
        const cy = t.y + this.tileSize * 0.5;
        if (
          Math.hypot(ball.x - cx, ball.y - cy) <
          LAVA_BALL_RADIUS + this.tileSize * 0.35
        ) {
          t.takeDamage(LAVA_BALL_DAMAGE);
          if (Math.random() < 0.15) t.applyStatus(makeBurn());
          ball.exploding = true;
          ball.explodeTick = EXPLODE_TICKS;
          break;
        }
      }
    }
    // Prune fully-done balls
    this.lavaBalls = this.lavaBalls.filter(
      (b) => !b.exploding || b.explodeTick > 0,
    );

    // Find nearest target
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
      this.clearAStarPath();
      this.doWander();
      return;
    }
    this.isAggro = true;

    const mouthX = this.x + this.tileSize * 0.22;
    const mouthY = this.y + this.tileSize * 0.22;
    const targetCX = nearest.x + this.tileSize * 0.5;
    const targetCY = nearest.y + this.tileSize * 0.5;

    // Check line of sight from mouth to target centre
    const hasLOS = this.map
      ? this.map.hasLineOfSight(mouthX, mouthY, targetCX, targetCY)
      : true;

    // Track last known position while we have LOS
    if (hasLOS) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    // Movement: navigate toward last known pos when no LOS; hold when in range
    if (!hasLOS) {
      // No line of sight — navigate toward last known position to find a clear angle
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.tileSize * 1.5,
      );
    } else if (nearestDist > this.spitRangePx) {
      // Has LOS but too far — move closer
      this.followTargetAStar(
        nearest.x,
        nearest.y,
        this.speed,
        this.spitRangePx * 0.85,
      );
    } else {
      // In range with LOS — hold position
      this.isMoving = false;
    }

    // Spit a lava ball (only when in range and line-of-sight is clear)
    if (hasLOS && nearestDist <= this.spitRangePx && this.spitCooldown === 0) {
      const dx = targetCX - mouthX;
      const dy = targetCY - mouthY;
      const dist = Math.hypot(dx, dy);
      this.lavaBalls.push({
        x: mouthX,
        y: mouthY,
        vx: (dx / dist) * LAVA_BALL_SPEED,
        vy: (dy / dist) * LAVA_BALL_SPEED,
        exploding: false,
        explodeTick: 0,
      });
      this.spitCooldown = SPIT_COOLDOWN;
      this.spitAnimTimer = SPIT_ANIM_FRAMES;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    // Draw lava balls (behind sprite)
    for (const ball of this.lavaBalls) {
      const bx = ball.x - camX;
      const by = ball.y - camY;

      if (ball.exploding) {
        const progress = 1 - ball.explodeTick / EXPLODE_TICKS;
        const r = LAVA_BALL_RADIUS * (1 + progress * 2.2);
        const alpha = ball.explodeTick / EXPLODE_TICKS;
        // Outer burst
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 80, 0, ${alpha * 0.75})`;
        ctx.fill();
        // Inner glow
        ctx.beginPath();
        ctx.arc(bx, by, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
        ctx.fill();
      } else {
        // Glowing lava ball — outer dark-orange shell
        ctx.beginPath();
        ctx.arc(bx, by, LAVA_BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#d93a00';
        ctx.fill();
        // Bright core
        ctx.beginPath();
        ctx.arc(bx, by, LAVA_BALL_RADIUS * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c00';
        ctx.fill();
        // Hot centre
        ctx.beginPath();
        ctx.arc(bx, by, LAVA_BALL_RADIUS * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = '#fff176';
        ctx.fill();
      }
    }

    const sx = this.x - camX;
    const sy = this.y - camY;

    // Red outline when aggro'd
    if (this.isAggro) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tileSize, tileSize);
    }

    // Normalise spit animation to 0–1 peak-at-midpoint curve
    const spitAnim =
      this.spitAnimTimer > 0
        ? Math.sin((1 - this.spitAnimTimer / SPIT_ANIM_FRAMES) * Math.PI)
        : 0;

    drawLlamaSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      spitAnim,
    );

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
