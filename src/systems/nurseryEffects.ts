/**
 * The nursery's short-lived feedback: sawdust and chips thrown by a hammer,
 * splinters and a shudder when a bugaboo lands a blow on the boards, and the
 * spray of timber when a barrier gives.
 *
 * Purely cosmetic and deliberately outside the quest's checkpoint. It draws
 * its randomness from a stream of its own, so a particle burst never shifts
 * the `Math.random` sequence the wave's spawns are rolled from.
 */

import { mulberry32, range, type Rng } from '../sprites/person/rng';

type ParticleKind = 'sawdust' | 'chip' | 'splinter' | 'dust';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  /** Height above the ground point (x, y), so a chip can arc and land where it was thrown. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  spin: number;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly color: string;
}

/** A world-space point, in pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

const RNG_SEED = 0x5eed;
/** Enough for two barriers failing at once and a hammer going; oldest go first past it. */
const MAX_PARTICLES = 220;
const GRAVITY = 0.22;
const BOUNCE_DAMPING = 0.35;
const GROUND_FRICTION = 0.8;
const AIR_DRAG = 0.97;
const DUST_DRIFT_UP = 0.05;

const WOOD_CHIP_COLORS = ['#a8753d', '#8a5c2e', '#c9975a', '#e0b67a'] as const;
const SAWDUST_COLORS = ['rgba(232,204,150,', 'rgba(214,184,132,'] as const;
const DUST_COLOR = 'rgba(120,108,92,';

const HIT_SPLINTERS = 5;
const HIT_DUST = 4;
const BREAK_CHIPS = 18;
const BREAK_SPLINTERS = 10;
const BREAK_DUST = 10;
const STRIKE_SAWDUST = 6;
const STRIKE_CHIPS = 2;
const FINISH_SAWDUST = 16;
const SCRABBLE_DUST = 2;

const SPLINTER_SPEED = 2.4;
const SPLINTER_LIFT = 2.8;
const CHIP_SPEED = 3.2;
const CHIP_LIFT = 3.6;
const SAWDUST_SPEED = 1.1;
const SAWDUST_LIFT = 1.6;
const DUST_SPEED = 0.6;

const SPLINTER_LIFE = 50;
const CHIP_LIFE = 70;
const SAWDUST_LIFE = 40;
const DUST_LIFE = 45;
/** Life is rolled between this share of its kind's figure and the whole of it. */
const LIFE_SPREAD_FLOOR = 0.6;

const SPLINTER_SIZE = 5;
const CHIP_SIZE = 3;
const SAWDUST_SIZE = 1.6;
const DUST_SIZE = 5;
const MAX_SPIN = 0.35;
/** Particles start from anywhere across this share of the tile, not one point. */
const SPAWN_SPREAD = 0.35;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
/** Particles fade out over the last share of their life. */
const FADE_TAIL = 0.4;

/** How long a barrier shudders after a blow, and how far. */
const SHAKE_FRAMES = 12;
const SHAKE_AMPLITUDE_PX = 2.2;
const HEAVY_SHAKE_MULTIPLIER = 1.6;
const SHAKE_FREQUENCY = 1.9;

export class NurseryEffects {
  private particles: Particle[] = [];
  private readonly shakes = new Map<number, { frames: number; amplitude: number }>();
  private readonly rng: Rng = mulberry32(RNG_SEED);

  /** A bugaboo's blow landing on a grate's boards, centred on `centre`. */
  barrierHit(grateIdx: number, centre: Point, tileSize: number, heavy: boolean): void {
    this.shakes.set(grateIdx, {
      frames: SHAKE_FRAMES,
      amplitude: SHAKE_AMPLITUDE_PX * (heavy ? HEAVY_SHAKE_MULTIPLIER : 1),
    });
    this.burst('splinter', centre, tileSize, HIT_SPLINTERS);
    this.burst('dust', centre, tileSize, HIT_DUST);
  }

  /** The boards over a grate giving way entirely. */
  barrierBroken(grateIdx: number, centre: Point, tileSize: number): void {
    this.shakes.delete(grateIdx);
    this.burst('chip', centre, tileSize, BREAK_CHIPS);
    this.burst('splinter', centre, tileSize, BREAK_SPLINTERS);
    this.burst('dust', centre, tileSize, BREAK_DUST);
  }

  /** One hammer blow on a build or repair. */
  hammerStrike(centre: Point, tileSize: number): void {
    this.burst('sawdust', centre, tileSize, STRIKE_SAWDUST);
    this.burst('chip', centre, tileSize, STRIKE_CHIPS);
  }

  /** The last nail going in. */
  buildFinished(centre: Point, tileSize: number): void {
    this.burst('sawdust', centre, tileSize, FINISH_SAWDUST);
  }

  /** Grit shaken loose between the boards by something clawing underneath. */
  scrabble(centre: Point, tileSize: number): void {
    this.burst('dust', centre, tileSize, SCRABBLE_DUST);
  }

  /** How far the barrier on `grateIdx` is displaced this frame by its last blow. */
  shakeOffset(grateIdx: number): Point {
    const shake = this.shakes.get(grateIdx);
    if (shake === undefined) return { x: 0, y: 0 };
    const falloff = shake.frames / SHAKE_FRAMES;
    const swing = Math.sin(shake.frames * SHAKE_FREQUENCY) * shake.amplitude * falloff;
    return { x: swing, y: swing * HALF };
  }

  update(): void {
    for (const [grateIdx, shake] of this.shakes) {
      shake.frames--;
      if (shake.frames <= 0) this.shakes.delete(grateIdx);
    }
    for (const particle of this.particles) this.step(particle);
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.particles.length === 0) return;
    ctx.save();
    for (const particle of this.particles) {
      const fade = Math.min(1, particle.life / (particle.maxLife * FADE_TAIL));
      const sx = particle.x - camX;
      const sy = particle.y - particle.z - camY;
      ctx.globalAlpha = fade;
      if (particle.kind === 'dust' || particle.kind === 'sawdust') {
        ctx.fillStyle = `${particle.color}${(particle.kind === 'dust' ? DUST_ALPHA : 1).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, particle.size, 0, FULL_TURN);
        ctx.fill();
        continue;
      }
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(particle.angle);
      ctx.fillStyle = particle.color;
      const length = particle.size;
      const thickness = particle.kind === 'splinter' ? SPLINTER_THICKNESS : length;
      ctx.fillRect(-length * HALF, -thickness * HALF, length, thickness);
      ctx.restore();
    }
    ctx.restore();
  }

  clear(): void {
    this.particles = [];
    this.shakes.clear();
  }

  private step(particle: Particle): void {
    particle.life--;
    if (particle.kind === 'dust') {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.z += DUST_DRIFT_UP;
      particle.vx *= AIR_DRAG;
      particle.vy *= AIR_DRAG;
      return;
    }
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.z += particle.vz;
    particle.vz -= GRAVITY;
    particle.angle += particle.spin;
    if (particle.z <= 0) {
      particle.z = 0;
      particle.vz = -particle.vz * BOUNCE_DAMPING;
      particle.vx *= GROUND_FRICTION;
      particle.vy *= GROUND_FRICTION;
      particle.spin *= GROUND_FRICTION;
    }
  }

  private burst(kind: ParticleKind, centre: Point, tileSize: number, count: number): void {
    const rng = this.rng;
    const spread = tileSize * SPAWN_SPREAD;
    for (let index = 0; index < count; index++) {
      const heading = rng() * FULL_TURN;
      const speed = SPEED[kind] * range(rng, HALF, 1);
      this.particles.push({
        kind,
        x: centre.x + range(rng, -1, 1) * spread,
        y: centre.y + range(rng, -1, 1) * spread,
        z: kind === 'dust' ? 0 : range(rng, 0, tileSize * HALF * HALF),
        vx: Math.cos(heading) * speed,
        vy: Math.sin(heading) * speed * HALF,
        vz: LIFT[kind] * range(rng, HALF, 1),
        angle: rng() * FULL_TURN,
        spin: range(rng, -MAX_SPIN, MAX_SPIN),
        life: Math.round(LIFE[kind] * range(rng, LIFE_SPREAD_FLOOR, 1)),
        maxLife: LIFE[kind],
        size: SIZE[kind] * range(rng, HALF + HALF * HALF, 1),
        color: colorFor(kind, rng),
      });
    }
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }
}

const DUST_ALPHA = 0.35;
const SPLINTER_THICKNESS = 1.4;

const SPEED: Readonly<Record<ParticleKind, number>> = {
  sawdust: SAWDUST_SPEED,
  chip: CHIP_SPEED,
  splinter: SPLINTER_SPEED,
  dust: DUST_SPEED,
};
const LIFT: Readonly<Record<ParticleKind, number>> = {
  sawdust: SAWDUST_LIFT,
  chip: CHIP_LIFT,
  splinter: SPLINTER_LIFT,
  dust: 0,
};
const LIFE: Readonly<Record<ParticleKind, number>> = {
  sawdust: SAWDUST_LIFE,
  chip: CHIP_LIFE,
  splinter: SPLINTER_LIFE,
  dust: DUST_LIFE,
};
const SIZE: Readonly<Record<ParticleKind, number>> = {
  sawdust: SAWDUST_SIZE,
  chip: CHIP_SIZE,
  splinter: SPLINTER_SIZE,
  dust: DUST_SIZE,
};

function colorFor(kind: ParticleKind, rng: Rng): string {
  if (kind === 'dust') return DUST_COLOR;
  if (kind === 'sawdust') return SAWDUST_COLORS[Math.floor(rng() * SAWDUST_COLORS.length)];
  return WOOD_CHIP_COLORS[Math.floor(rng() * WOOD_CHIP_COLORS.length)];
}
