import type { GameSystem } from './GameSystem';
import { viewportWidth, viewportHeight } from '../core/Viewport';

/**
 * The small dust puff and streak burst a crawler's fist or foot throws at the
 * point it actually connects — a mob, a crate, a wall. Every particle is
 * cheap procedural drawing rather than a sprite: the whole burst is on screen
 * for well under a second, so baking it to a sheet would cost more in decoded
 * memory than the effect is ever worth.
 */

/** Life span in ticks at 60 fps — the burst is gone in 150-250 ms. */
const PUFF_LIFE_MIN = 9;
const PUFF_LIFE_MAX = 15;
const STREAK_LIFE_MIN = 6;
const STREAK_LIFE_MAX = 10;

const PUFF_COUNT_MIN = 3;
const PUFF_COUNT_MAX = 5;
const STREAK_COUNT_MIN = 1;
const STREAK_COUNT_MAX = 2;

const PUFF_BASE_RADIUS_MIN = 2;
const PUFF_BASE_RADIUS_MAX = 4;
/** A puff roughly doubles in size as it dissipates. */
const PUFF_GROWTH_MULTIPLIER = 2.2;
const PUFF_SPEED_MIN = 0.4;
const PUFF_SPEED_MAX = 1.1;
const PUFF_DRAG = 0.88;
/** Fraction of a half-turn the puff cone scatters into, around the strike's own direction. */
const PUFF_SPREAD_HALF_TURN_FRACTION = 0.42;
const PUFF_SPREAD_HALF_ANGLE = Math.PI * PUFF_SPREAD_HALF_TURN_FRACTION;

const STREAK_LENGTH_MIN = 5;
const STREAK_LENGTH_MAX = 9;
const STREAK_WIDTH = 1.4;
/** Streaks fly straighter than puffs — a tighter cone around the strike's direction. */
const STREAK_SPREAD_HALF_TURN_FRACTION = 0.22;
const STREAK_SPREAD_HALF_ANGLE = Math.PI * STREAK_SPREAD_HALF_TURN_FRACTION;

/** A long combo throws several of these a second; nothing should ever queue up. */
const MAX_PARTICLES = 90;

/** Neutral dust tone — a punch or kick doesn't know what it's about to hit. */
const DUST_COLOR = '214, 201, 180';
const STREAK_COLOR = '255, 250, 240';
/** Puffs are soft and translucent; streaks read as a brief, brighter flick. */
const PUFF_PEAK_ALPHA = 0.65;
const STREAK_PEAK_ALPHA = 0.8;

interface DustPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
}

interface DustStreak {
  x: number;
  y: number;
  angle: number;
  length: number;
  life: number;
  maxLife: number;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomIntRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export class MeleeImpactEffectSystem implements GameSystem {
  private puffs: DustPuff[] = [];
  private streaks: DustStreak[] = [];

  /** Puffs and streaks currently in flight — how much this system is holding. */
  get liveCount(): number {
    return this.puffs.length + this.streaks.length;
  }

  resetForCheckpoint(): void {
    this.puffs = [];
    this.streaks = [];
  }

  /**
   * A burst of impact dust at a strike's contact point.
   *
   * @param x, y               contact point in world px — the fist or foot
   *                            that landed the blow, not the target's centre
   * @param directionX/Y        the strike's own travel direction; puffs and
   *                            streaks scatter into a cone around it, as if
   *                            kicked off whatever the blow just hit
   */
  spawn(x: number, y: number, directionX: number, directionY: number): void {
    const hasDirection = directionX !== 0 || directionY !== 0;
    const baseAngle = hasDirection
      ? Math.atan2(directionY, directionX)
      : randomRange(0, Math.PI * 2);

    const puffCount = randomIntRange(PUFF_COUNT_MIN, PUFF_COUNT_MAX);
    for (let i = 0; i < puffCount; i++) {
      const angle = baseAngle + randomRange(-PUFF_SPREAD_HALF_ANGLE, PUFF_SPREAD_HALF_ANGLE);
      const speed = randomRange(PUFF_SPEED_MIN, PUFF_SPEED_MAX);
      const life = randomIntRange(PUFF_LIFE_MIN, PUFF_LIFE_MAX);
      const baseRadius = randomRange(PUFF_BASE_RADIUS_MIN, PUFF_BASE_RADIUS_MAX);
      this.puffs.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        baseRadius,
        maxRadius: baseRadius * PUFF_GROWTH_MULTIPLIER,
        life,
        maxLife: life,
      });
    }

    const streakCount = randomIntRange(STREAK_COUNT_MIN, STREAK_COUNT_MAX);
    for (let i = 0; i < streakCount; i++) {
      const angle = baseAngle + randomRange(-STREAK_SPREAD_HALF_ANGLE, STREAK_SPREAD_HALF_ANGLE);
      const life = randomIntRange(STREAK_LIFE_MIN, STREAK_LIFE_MAX);
      this.streaks.push({
        x,
        y,
        angle,
        length: randomRange(STREAK_LENGTH_MIN, STREAK_LENGTH_MAX),
        life,
        maxLife: life,
      });
    }

    // A rapid combo throws several bursts a second; drop the faintest rather
    // than let them pile up past what a fist-sized effect should ever cost.
    while (this.puffs.length + this.streaks.length > MAX_PARTICLES) {
      if (this.puffs.length >= this.streaks.length && this.puffs.length > 0) {
        this.puffs.shift();
      } else if (this.streaks.length > 0) {
        this.streaks.shift();
      } else {
        break;
      }
    }
  }

  update(): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= PUFF_DRAG;
      p.vy *= PUFF_DRAG;
      p.life--;
      if (p.life <= 0) {
        this.puffs[i] = this.puffs[this.puffs.length - 1];
        this.puffs.pop();
      }
    }

    for (let i = this.streaks.length - 1; i >= 0; i--) {
      this.streaks[i].life--;
      if (this.streaks[i].life <= 0) {
        this.streaks[i] = this.streaks[this.streaks.length - 1];
        this.streaks.pop();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.puffs.length === 0 && this.streaks.length === 0) return;
    const viewW = viewportWidth();
    const viewH = viewportHeight();

    ctx.save();
    for (const p of this.puffs) {
      const sx = p.x - camX;
      const sy = p.y - camY;
      if (sx + p.maxRadius < 0 || sx - p.maxRadius > viewW) continue;
      if (sy + p.maxRadius < 0 || sy - p.maxRadius > viewH) continue;
      const progress = 1 - p.life / p.maxLife;
      const radius = p.baseRadius + (p.maxRadius - p.baseRadius) * progress;
      const alpha = (p.life / p.maxLife) * PUFF_PEAK_ALPHA;
      if (radius <= 0 || alpha <= 0) continue;
      const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      gradient.addColorStop(0, `rgba(${DUST_COLOR}, ${alpha})`);
      gradient.addColorStop(1, `rgba(${DUST_COLOR}, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineCap = 'round';
    for (const s of this.streaks) {
      const sx = s.x - camX;
      const sy = s.y - camY;
      if (sx + s.length < 0 || sx - s.length > viewW) continue;
      if (sy + s.length < 0 || sy - s.length > viewH) continue;
      const alpha = (s.life / s.maxLife) * STREAK_PEAK_ALPHA;
      if (alpha <= 0) continue;
      const tipX = sx + Math.cos(s.angle) * s.length;
      const tipY = sy + Math.sin(s.angle) * s.length;
      ctx.strokeStyle = `rgba(${STREAK_COLOR}, ${alpha})`;
      ctx.lineWidth = STREAK_WIDTH;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }
}
