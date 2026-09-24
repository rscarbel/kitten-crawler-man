/**
 * The screen's answer to a Grotesque Spider strike: a camera kick, a cracked and
 * dusty patch of floor where a slam's legs came down, and a shockwave that
 * bursts outward from the edge of a screech.
 *
 * Everything starts on the strike tick itself, drained from the spider's
 * `drainImpactFeedback`, so the shake, the decal and the telegraph's flash land
 * on the same frame as the damage and the audio hit. Each effect outlives the
 * attack's impact hold, so a doubled update in `Scene.loop` cannot skip it.
 */

import type { GrotesqueSpider } from '../creatures/GrotesqueSpider';
import {
  SCREECH_RADIUS_PX,
  SLAM_CONE_HALF_ANGLE_RAD,
  SPIDER_ATTACK_TIMELINES,
  type SpiderImpactEvent,
} from '../creatures/grotesqueSpiderTimeline';
import { TILE_SIZE } from '../core/constants';

/** Centres `Math.random()` on zero so the shake swings both ways. */
const RANDOM_MIDPOINT = 0.5;

/** Peak camera shake in px on a slam's strike tick. */
const SLAM_SHAKE_PEAK_PX = 7;
/** Peak camera shake in px on a screech's strike tick. */
const SCREECH_SHAKE_PEAK_PX = 5;
/** Frames a shake takes to die away; longer than any impact hold so it is never cut short. */
const SHAKE_FRAMES = 18;

/** How far ahead of her centre the slam's legs meet the floor. */
const SLAM_DECAL_DISTANCE_TILES = 1.1;
/** Frames the crack stays at full strength: the slam's own impact hold. */
const SLAM_DECAL_HOLD_FRAMES = SPIDER_ATTACK_TIMELINES.slam.impactHoldFrames;
/** Frames the crack takes to fade once the hold is over; long enough to read as a scar. */
const SLAM_DECAL_FADE_FRAMES = 90;
const SLAM_CRACK_COUNT = 7;
const SLAM_CRACK_SEGMENTS = 3;
const SLAM_CRACK_MIN_TILES = 0.6;
const SLAM_CRACK_MAX_TILES = 1.1;
/** Fraction of the cone half-angle the cracks fan across, so they stay inside the drawn cone. */
const SLAM_CRACK_SPREAD_FRACTION = 0.8;
/** Radians a crack may wander from its heading at each joint. */
const SLAM_CRACK_WANDER_RAD = 0.45;
/** Some cracks run backward under her too, where her body weight lands. */
const SLAM_CRACK_BACKWARD_CHANCE = 0.2;
const SLAM_CRACK_COLOR = '#1a120c';
const SLAM_CRACK_EDGE_COLOR = '#8a7a66';
const SLAM_CRACK_WIDTH = 2.5;
const SLAM_CRACK_EDGE_WIDTH = 1;
const SLAM_CRACK_ALPHA = 0.8;
const SLAM_CRACK_EDGE_ALPHA = 0.45;
/** Offset of the pale lip drawn along each crack, as if the floor had lifted there. */
const SLAM_CRACK_EDGE_OFFSET_PX = 1;

const DUST_PUFF_COUNT = 6;
const DUST_COLOR = '#c8b8a0';
/** Frames a puff of dust takes to billow out and settle. */
const DUST_FRAMES = 36;
const DUST_START_RADIUS_TILES = 0.2;
const DUST_END_RADIUS_TILES = 0.55;
/** How far the puffs drift from the impact point as they spread. */
const DUST_DRIFT_TILES = 0.8;
const DUST_START_ALPHA = 0.55;
/** Smallest puff, as a fraction of the full puff size. */
const DUST_MIN_SCALE = 0.5;

/** Frames the shockwave keeps spreading after the screech's impact hold ends. */
const SHOCKWAVE_TRAIL_FRAMES = 16;
/** Frames the screech's edge shockwave takes to spread and fade; outlasts the impact hold. */
const SHOCKWAVE_FRAMES = SPIDER_ATTACK_TIMELINES.screech.impactHoldFrames + SHOCKWAVE_TRAIL_FRAMES;
/** Tiles past the screech edge the shockwave travels before it is gone. */
const SHOCKWAVE_TRAVEL_TILES = 1.6;
const SHOCKWAVE_COLOR = '#fff0e8';
const SHOCKWAVE_GLOW_COLOR = '#ff3020';
const SHOCKWAVE_WIDTH = 4;
const SHOCKWAVE_GLOW_WIDTH = 10;
const SHOCKWAVE_START_ALPHA = 0.9;
const SHOCKWAVE_GLOW_ALPHA = 0.35;

/** Effects that can overlap at most; a flurry past this drops the oldest. */
const MAX_LIVE_EFFECTS = 8;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface SlamDecal {
  readonly cracks: ReadonlyArray<ReadonlyArray<Point>>;
  readonly puffs: ReadonlyArray<{ readonly angle: number; readonly scale: number }>;
  readonly x: number;
  readonly y: number;
  age: number;
}

interface Shockwave {
  readonly x: number;
  readonly y: number;
  age: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function buildCracks(x: number, y: number, heading: number): Point[][] {
  const cracks: Point[][] = [];
  const spread = SLAM_CONE_HALF_ANGLE_RAD * SLAM_CRACK_SPREAD_FRACTION;
  for (let i = 0; i < SLAM_CRACK_COUNT; i++) {
    const runsBackward = Math.random() < SLAM_CRACK_BACKWARD_CHANCE;
    let angle = heading + (runsBackward ? Math.PI : 0) + randomBetween(-spread, spread);
    const length = TILE_SIZE * randomBetween(SLAM_CRACK_MIN_TILES, SLAM_CRACK_MAX_TILES);
    const segmentLength = length / SLAM_CRACK_SEGMENTS;
    const points: Point[] = [{ x, y }];
    let px = x;
    let py = y;
    for (let s = 0; s < SLAM_CRACK_SEGMENTS; s++) {
      angle += randomBetween(-SLAM_CRACK_WANDER_RAD, SLAM_CRACK_WANDER_RAD);
      px += Math.cos(angle) * segmentLength;
      py += Math.sin(angle) * segmentLength;
      points.push({ x: px, y: py });
    }
    cracks.push(points);
  }
  return cracks;
}

export class SpiderImpactFeedback {
  private shakeFrames = 0;
  private shakeStrength = 0;
  private shakeX = 0;
  private shakeY = 0;
  private decals: SlamDecal[] = [];
  private shockwaves: Shockwave[] = [];

  /**
   * Drains the spider's strike events and ages every live effect. Pass null
   * when there is no fight, so what is already on screen still settles.
   */
  update(spider: Pick<GrotesqueSpider, 'drainImpactFeedback'> | null): void {
    if (spider !== null) {
      for (const event of spider.drainImpactFeedback()) this.begin(event);
    }
    this.tickShake();
    for (const decal of this.decals) decal.age++;
    this.decals = this.decals.filter(
      (decal) => decal.age < SLAM_DECAL_HOLD_FRAMES + SLAM_DECAL_FADE_FRAMES,
    );
    for (const wave of this.shockwaves) wave.age++;
    this.shockwaves = this.shockwaves.filter((wave) => wave.age < SHOCKWAVE_FRAMES);
  }

  /** Drops every effect at once, for a restore or a teardown. */
  reset(): void {
    this.shakeFrames = 0;
    this.shakeStrength = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.decals = [];
    this.shockwaves = [];
  }

  /** Camera displacement for this frame; the owner adds it to its own. */
  get cameraOffset(): { x: number; y: number } {
    return { x: this.shakeX, y: this.shakeY };
  }

  private begin(event: SpiderImpactEvent): void {
    switch (event.attack) {
      case 'slam':
        this.kick(SLAM_SHAKE_PEAK_PX);
        this.addDecal(event);
        break;
      case 'screech':
        this.kick(SCREECH_SHAKE_PEAK_PX);
        this.shockwaves.push({ x: event.originX, y: event.originY, age: 0 });
        if (this.shockwaves.length > MAX_LIVE_EFFECTS) this.shockwaves.shift();
        break;
      case 'spit':
        break;
    }
  }

  private kick(peakPx: number): void {
    this.shakeFrames = SHAKE_FRAMES;
    this.shakeStrength = Math.max(peakPx, this.shakeStrength);
  }

  private tickShake(): void {
    if (this.shakeFrames <= 0) {
      this.shakeStrength = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    const falloff = this.shakeFrames / SHAKE_FRAMES;
    const amplitude = this.shakeStrength * falloff * falloff;
    this.shakeX = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
    this.shakeY = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
    this.shakeFrames--;
  }

  private addDecal(event: SpiderImpactEvent): void {
    const reach = TILE_SIZE * SLAM_DECAL_DISTANCE_TILES;
    const x = event.originX + event.dirX * reach;
    const y = event.originY + event.dirY * reach;
    const heading = Math.atan2(event.dirY, event.dirX);
    const puffs = Array.from({ length: DUST_PUFF_COUNT }, (_, i) => ({
      angle: (i / DUST_PUFF_COUNT) * Math.PI * 2 + Math.random(),
      scale: randomBetween(DUST_MIN_SCALE, 1),
    }));
    this.decals.push({ cracks: buildCracks(x, y, heading), puffs, x, y, age: 0 });
    if (this.decals.length > MAX_LIVE_EFFECTS) this.decals.shift();
  }

  /** Floor paint: cracks, dust and the shockwave. Call in the ground pass, before entities. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const decal of this.decals) this.drawDecal(ctx, decal, camX, camY);
    for (const wave of this.shockwaves) this.drawShockwave(ctx, wave, camX, camY);
  }

  private drawDecal(
    ctx: CanvasRenderingContext2D,
    decal: SlamDecal,
    camX: number,
    camY: number,
  ): void {
    const fadeAge = Math.max(0, decal.age - SLAM_DECAL_HOLD_FRAMES);
    const strength = 1 - fadeAge / SLAM_DECAL_FADE_FRAMES;
    if (strength <= 0) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const passes = [
      {
        color: SLAM_CRACK_EDGE_COLOR,
        width: SLAM_CRACK_EDGE_WIDTH,
        alpha: SLAM_CRACK_EDGE_ALPHA,
        offset: SLAM_CRACK_EDGE_OFFSET_PX,
      },
      { color: SLAM_CRACK_COLOR, width: SLAM_CRACK_WIDTH, alpha: SLAM_CRACK_ALPHA, offset: 0 },
    ] as const;
    for (const pass of passes) {
      ctx.globalAlpha = strength * pass.alpha;
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = pass.width;
      for (const crack of decal.cracks) {
        ctx.beginPath();
        crack.forEach((point, index) => {
          const px = point.x - camX + pass.offset;
          const py = point.y - camY + pass.offset;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    }

    if (decal.age < DUST_FRAMES) {
      const dustProgress = decal.age / DUST_FRAMES;
      const radius =
        TILE_SIZE *
        (DUST_START_RADIUS_TILES +
          (DUST_END_RADIUS_TILES - DUST_START_RADIUS_TILES) * dustProgress);
      const drift = TILE_SIZE * DUST_DRIFT_TILES * dustProgress;
      ctx.fillStyle = DUST_COLOR;
      ctx.globalAlpha = DUST_START_ALPHA * (1 - dustProgress);
      for (const puff of decal.puffs) {
        ctx.beginPath();
        ctx.arc(
          decal.x - camX + Math.cos(puff.angle) * drift * puff.scale,
          decal.y - camY + Math.sin(puff.angle) * drift * puff.scale,
          radius * puff.scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * The ring starts on the screech's own edge and only travels outward: a ring
   * that started at her body would suggest the damage travels, and it does not.
   */
  private drawShockwave(
    ctx: CanvasRenderingContext2D,
    wave: Shockwave,
    camX: number,
    camY: number,
  ): void {
    const progress = wave.age / SHOCKWAVE_FRAMES;
    const radius = SCREECH_RADIUS_PX + TILE_SIZE * SHOCKWAVE_TRAVEL_TILES * progress;
    const fade = 1 - progress;
    const cx = wave.x - camX;
    const cy = wave.y - camY;
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = SHOCKWAVE_GLOW_ALPHA * fade;
    ctx.strokeStyle = SHOCKWAVE_GLOW_COLOR;
    ctx.lineWidth = SHOCKWAVE_GLOW_WIDTH;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = SHOCKWAVE_START_ALPHA * fade;
    ctx.strokeStyle = SHOCKWAVE_COLOR;
    ctx.lineWidth = SHOCKWAVE_WIDTH;
    ctx.stroke();
    ctx.restore();
  }
}
