import type { GameSystem } from './GameSystem';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import {
  impactDebrisConfigOf,
  type ArcanePalette,
  type ExplosionVariant,
} from '../sprites/art/magicMissileArt';

/**
 * The physical debris a Magic Missile's impact throws clear of the blast
 * itself: sparks that keep flying under gravity and drag after the baked
 * explosion animation (`drawMagicMissileExplosion`) has already finished, and
 * a low ring of ground dust kicked outward along the floor. The blast's own
 * fireball, rings and shards stay exactly as painted — this only adds what a
 * fixed-frame animation cannot: particles that leave the point of impact and
 * do not come back.
 *
 * Both particle kinds scale off `impactDebrisConfigOf`, so a bigger tier's
 * louder blast throws more, bigger, faster, longer-lived debris without a
 * second set of tier bands to keep in step with the art's own.
 */

/** A puff of ground dust, at 60 fps, roughly a third to two-thirds of a second. */
const SPARK_LIFE_MIN_FRAMES = 18;
const SPARK_LIFE_MAX_FRAMES = 36;
const SPARK_COUNT_MIN = 2;
const SPARK_COUNT_MAX = 8;
const SPARK_SPEED_MIN = 1.4;
const SPARK_SPEED_MAX = 3.6;
const SPARK_RADIUS_MIN = 1.2;
const SPARK_RADIUS_MAX = 2.6;
/** Downward pull on a flung spark, in px/frame². */
const SPARK_GRAVITY = 0.1;
const SPARK_DRAG = 0.94;
/** How many frames of travel the trailing streak reaches back over. */
const SPARK_TRAIL_FRAMES = 2.4;
const SPARK_TRAIL_WIDTH = 1.2;

const DUST_LIFE_MIN_FRAMES = 20;
const DUST_LIFE_MAX_FRAMES = 40;
const DUST_COUNT_MIN = 3;
const DUST_COUNT_MAX = 9;
const DUST_SPEED_MIN = 0.3;
const DUST_SPEED_MAX = 0.9;
const DUST_DRAG = 0.9;
const DUST_RADIUS_X_MIN = 3;
const DUST_RADIUS_X_MAX = 6;
/** Ground dust reads as flattened ellipses rather than round puffs — a floor-plane cloud, not an airborne one. */
const DUST_RADIUS_Y_FRACTION = 0.45;
/** Dust starts at the rim of the blast rather than its centre — it was kicked out, not left behind. */
const DUST_SPAWN_RADIUS_FRACTION = 0.5;
const DUST_SPAWN_JITTER_FRACTION = 0.15;

/** A miscast spam of missiles must never let debris outgrow what a spark burst should ever cost. */
const MAX_SPARKS = 160;
const MAX_DUST = 100;

/** Ground dust is a neutral haze lightly tinted by the blast's own smoke colour, not a full arcane hue. */
const DUST_BASE_R = 198;
const DUST_BASE_G = 190;
const DUST_BASE_B = 180;
const DUST_BASE_RGB: readonly [number, number, number] = [DUST_BASE_R, DUST_BASE_G, DUST_BASE_B];
const DUST_TINT_FRACTION = 0.3;

/** The weakest tier still throws debris at this share of the loudest tier's speed and size. */
const SPARK_SPEED_SCALE_FLOOR = 0.6;
const SPARK_SIZE_SCALE_FLOOR = 0.7;
const DUST_SPEED_SCALE_FLOOR = 0.6;
const DUST_SIZE_SCALE_FLOOR = 0.7;
const SCALE_FLOOR_CEILING = 1;

/** How much a dust puff fades and grows over its life, as a fraction of its start value. */
const DUST_ALPHA_FADE_FRACTION = 0.3;
const DUST_GROWTH_FRACTION = 0.6;
const DUST_FILL_ALPHA_FRACTION = 0.5;

/** See `magicMissileArt.ts`'s own `ALPHA_DECIMALS` — node-canvas rejects exponent-notation alpha. */
const ALPHA_DECIMALS = 3;

interface FlungSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  color: readonly [number, number, number];
}

interface GroundDust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radiusX: number;
  radiusY: number;
  life: number;
  maxLife: number;
  color: readonly [number, number, number];
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomIntRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function mixChannel(base: number, tint: number, fraction: number): number {
  return Math.round(base + (tint - base) * fraction);
}

function tintedDustColor(palette: ArcanePalette): readonly [number, number, number] {
  return [
    mixChannel(DUST_BASE_RGB[0], palette.smoke[0], DUST_TINT_FRACTION),
    mixChannel(DUST_BASE_RGB[1], palette.smoke[1], DUST_TINT_FRACTION),
    mixChannel(DUST_BASE_RGB[2], palette.smoke[2], DUST_TINT_FRACTION),
  ];
}

/** Drops the closest-to-expiry entries once `list` exceeds `cap`. */
function capByRemainingLife(list: Array<{ life: number }>, cap: number): void {
  while (list.length > cap) {
    let faintest = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].life < list[faintest].life) faintest = i;
    }
    list[faintest] = list[list.length - 1];
    list.pop();
  }
}

export class MagicMissileImpactEffectSystem implements GameSystem {
  private sparks: FlungSpark[] = [];
  private dust: GroundDust[] = [];

  /** Sparks and dust currently in flight — how much this system is holding. */
  get liveCount(): number {
    return this.sparks.length + this.dust.length;
  }

  resetForCheckpoint(): void {
    this.sparks = [];
    this.dust = [];
  }

  /**
   * Flings sparks and kicks up ground dust from an impact, once. Called from
   * the same place `CombatSystem` sets a missile's state to `'exploding'` —
   * a mob hit, a prop hit or a tree/wall hit all land here alike.
   */
  spawn(x: number, y: number, variant: ExplosionVariant): void {
    const config = impactDebrisConfigOf(variant);
    const dustColor = tintedDustColor(config.palette);

    const sparkCount = Math.round(lerp(SPARK_COUNT_MIN, SPARK_COUNT_MAX, config.scale));
    for (let i = 0; i < sparkCount; i++) {
      const angle = randomRange(0, Math.PI * 2);
      const speed =
        randomRange(SPARK_SPEED_MIN, SPARK_SPEED_MAX) *
        lerp(SPARK_SPEED_SCALE_FLOOR, SCALE_FLOOR_CEILING, config.scale);
      const life = randomIntRange(
        Math.round(SPARK_LIFE_MIN_FRAMES),
        Math.round(lerp(SPARK_LIFE_MIN_FRAMES, SPARK_LIFE_MAX_FRAMES, config.scale)),
      );
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius:
          randomRange(SPARK_RADIUS_MIN, SPARK_RADIUS_MAX) *
          lerp(SPARK_SIZE_SCALE_FLOOR, SCALE_FLOOR_CEILING, config.scale),
        life,
        maxLife: life,
        color: config.palette.spark,
      });
    }
    capByRemainingLife(this.sparks, MAX_SPARKS);

    const dustCount = Math.round(lerp(DUST_COUNT_MIN, DUST_COUNT_MAX, config.scale));
    const spawnRadius = config.maxRadius * DUST_SPAWN_RADIUS_FRACTION;
    for (let i = 0; i < dustCount; i++) {
      const angle = randomRange(0, Math.PI * 2);
      const jitter = 1 + randomRange(-DUST_SPAWN_JITTER_FRACTION, DUST_SPAWN_JITTER_FRACTION);
      const speed =
        randomRange(DUST_SPEED_MIN, DUST_SPEED_MAX) *
        lerp(DUST_SPEED_SCALE_FLOOR, SCALE_FLOOR_CEILING, config.scale);
      const life = randomIntRange(
        DUST_LIFE_MIN_FRAMES,
        Math.round(lerp(DUST_LIFE_MIN_FRAMES, DUST_LIFE_MAX_FRAMES, config.scale)),
      );
      const radiusX =
        randomRange(DUST_RADIUS_X_MIN, DUST_RADIUS_X_MAX) *
        lerp(DUST_SIZE_SCALE_FLOOR, SCALE_FLOOR_CEILING, config.scale);
      this.dust.push({
        x: x + Math.cos(angle) * spawnRadius * jitter,
        y: y + Math.sin(angle) * spawnRadius * jitter,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radiusX,
        radiusY: radiusX * DUST_RADIUS_Y_FRACTION,
        life,
        maxLife: life,
        color: dustColor,
      });
    }
    capByRemainingLife(this.dust, MAX_DUST);
  }

  update(): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= SPARK_DRAG;
      s.vy = s.vy * SPARK_DRAG + SPARK_GRAVITY;
      s.life--;
      if (s.life <= 0) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
      }
    }

    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.x += d.vx;
      d.y += d.vy;
      d.vx *= DUST_DRAG;
      d.vy *= DUST_DRAG;
      d.life--;
      if (d.life <= 0) {
        this.dust[i] = this.dust[this.dust.length - 1];
        this.dust.pop();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.sparks.length === 0 && this.dust.length === 0) return;
    const viewW = viewportWidth();
    const viewH = viewportHeight();

    ctx.save();

    for (const d of this.dust) {
      const sx = d.x - camX;
      const sy = d.y - camY;
      if (sx + d.radiusX < 0 || sx - d.radiusX > viewW) continue;
      if (sy + d.radiusY < 0 || sy - d.radiusY > viewH) continue;
      const progress = 1 - d.life / d.maxLife;
      const alpha = (d.life / d.maxLife) * (1 - progress * DUST_ALPHA_FADE_FRACTION);
      const radiusX = d.radiusX * (1 + progress * DUST_GROWTH_FRACTION);
      const radiusY = d.radiusY * (1 + progress * DUST_GROWTH_FRACTION);
      const fillAlpha = (alpha * DUST_FILL_ALPHA_FRACTION).toFixed(ALPHA_DECIMALS);
      ctx.fillStyle = `rgba(${d.color[0]}, ${d.color[1]}, ${d.color[2]}, ${fillAlpha})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineCap = 'round';
    for (const s of this.sparks) {
      const sx = s.x - camX;
      const sy = s.y - camY;
      if (sx + s.radius < 0 || sx - s.radius > viewW) continue;
      if (sy + s.radius < 0 || sy - s.radius > viewH) continue;
      const alpha = s.life / s.maxLife;
      const [r, g, b] = s.color;
      const tailX = sx - s.vx * SPARK_TRAIL_FRAMES;
      const tailY = sy - s.vy * SPARK_TRAIL_FRAMES;
      const trail = ctx.createLinearGradient(tailX, tailY, sx, sy);
      trail.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      trail.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(ALPHA_DECIMALS)})`);
      ctx.strokeStyle = trail;
      ctx.lineWidth = SPARK_TRAIL_WIDTH;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(ALPHA_DECIMALS)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, s.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
