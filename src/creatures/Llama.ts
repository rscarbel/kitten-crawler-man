import type { Player } from '../Player';
import { Mob } from './Mob';
import { drawLlamaSprite } from '../sprites/llamaSprite';
import { makeBurn } from '../core/StatusEffect';
import { normalize } from '../utils';

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
const COIN_DROP_MIN = 4;
const COIN_DROP_MAX = 5;
const CENTER_OFFSET = 0.5;
const PLAYER_CENTER_RADIUS_RATIO = 0.35;
const BURN_CHANCE = 0.15;
const MOUTH_OFFSET_X = 0.22;
const MOUTH_OFFSET_Y = 0.22;
const FOLLOW_STOP_RANGE_TILES = 1.5;
const FOLLOW_CLOSE_RANGE_RATIO = 0.85;
const EXPLOSION_EXPANSION = 2.2;
const EXPLOSION_ALPHA = 0.75;
const INNER_GLOW_ALPHA = 1.0;
const GLOW_RADIUS_RATIO = 0.5;
const BRIGHT_CORE_RATIO = 0.55;
const HOT_CENTER_RATIO = 0.25;

export class Llama extends Mob {
  readonly xpValue = 8;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'llama';
  displayName = 'Lava Llama';
  description = 'Spits balls of molten rock from a distance.';
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
          this.attackSoundPending = true;
          continue;
        }
      }
      ball.x = nextX;
      ball.y = nextY;
      for (const t of targets) {
        if (!t.isAlive) continue;
        const cx = t.x + this.tileSize * CENTER_OFFSET;
        const cy = t.y + this.tileSize * CENTER_OFFSET;
        if (
          Math.hypot(ball.x - cx, ball.y - cy) <
          LAVA_BALL_RADIUS + this.tileSize * PLAYER_CENTER_RADIUS_RATIO
        ) {
          this.dealDamage(t, LAVA_BALL_DAMAGE);
          if (Math.random() < BURN_CHANCE) t.applyStatus(makeBurn());
          ball.exploding = true;
          ball.explodeTick = EXPLODE_TICKS;
          break;
        }
      }
    }
    // Prune fully-done balls
    this.lavaBalls = this.lavaBalls.filter((b) => !b.exploding || b.explodeTick > 0);

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

    const mouthX = this.x + this.tileSize * MOUTH_OFFSET_X;
    const mouthY = this.y + this.tileSize * MOUTH_OFFSET_Y;
    const targetCX = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCY = nearest.y + this.tileSize * CENTER_OFFSET;

    // Check line of sight from mouth to target centre
    const hasLOS = this.map ? this.map.hasLineOfSight(mouthX, mouthY, targetCX, targetCY) : true;

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
        this.tileSize * FOLLOW_STOP_RANGE_TILES,
      );
    } else if (nearestDist > this.spitRangePx) {
      // Has LOS but too far — move closer
      this.followTargetAStar(
        nearest.x,
        nearest.y,
        this.speed,
        this.spitRangePx * FOLLOW_CLOSE_RANGE_RATIO,
      );
    } else {
      // In range with LOS — hold position
      this.isMoving = false;
    }

    // Spit a lava ball (only when in range and line-of-sight is clear)
    if (hasLOS && nearestDist <= this.spitRangePx && this.spitCooldown === 0) {
      const dx = targetCX - mouthX;
      const dy = targetCY - mouthY;
      const n = normalize(dx, dy);
      this.lavaBalls.push({
        x: mouthX,
        y: mouthY,
        vx: n.x * LAVA_BALL_SPEED,
        vy: n.y * LAVA_BALL_SPEED,
        exploding: false,
        explodeTick: 0,
      });
      this.spitCooldown = SPIT_COOLDOWN;
      this.spitAnimTimer = SPIT_ANIM_FRAMES;
      this.projectileSoundPending = true;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    if (!this.isAlive) return;

    // Draw lava balls (behind sprite)
    for (const ball of this.lavaBalls) {
      const bx = ball.x - camX;
      const by = ball.y - camY;

      if (ball.exploding) {
        const progress = 1 - ball.explodeTick / EXPLODE_TICKS;
        const r = LAVA_BALL_RADIUS * (1 + progress * EXPLOSION_EXPANSION);
        const alpha = ball.explodeTick / EXPLODE_TICKS;
        // Outer burst
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 80, 0, ${alpha * EXPLOSION_ALPHA})`;
        ctx.fill();
        // Inner glow
        ctx.beginPath();
        ctx.arc(bx, by, r * GLOW_RADIUS_RATIO, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 200, 0, ${alpha * INNER_GLOW_ALPHA})`;
        ctx.fill();
      } else {
        // Glowing lava ball — outer dark-orange shell
        ctx.beginPath();
        ctx.arc(bx, by, LAVA_BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#d93a00';
        ctx.fill();
        // Bright core
        ctx.beginPath();
        ctx.arc(bx, by, LAVA_BALL_RADIUS * BRIGHT_CORE_RATIO, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c00';
        ctx.fill();
        // Hot centre
        ctx.beginPath();
        ctx.arc(bx, by, LAVA_BALL_RADIUS * HOT_CENTER_RATIO, 0, Math.PI * 2);
        ctx.fillStyle = '#fff176';
        ctx.fill();
      }
    }

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    // Normalise spit animation to 0–1 peak-at-midpoint curve
    const spitAnim =
      this.spitAnimTimer > 0 ? Math.sin((1 - this.spitAnimTimer / SPIT_ANIM_FRAMES) * Math.PI) : 0;

    drawLlamaSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving, spitAnim, this.facingX);

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
