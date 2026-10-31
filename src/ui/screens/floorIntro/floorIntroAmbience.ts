/**
 * The moving light and weather behind each floor's "Find the Key" intro:
 * candle pools and dust, torches with drips and smoke, failing strip lights
 * with sparks and steam, and a dusk skyline with blowing leaves.
 *
 * Particle art, not chrome: every painter is a pure function of the clock, so
 * a gallery frame is a number of milliseconds, and every colour comes from
 * the floor's ink in `introInk.ts`.
 */

import {
  allocCanvas,
  BYTES_PER_MEGABYTE,
  freshSurfaceContext,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import { RecentSurfaceCache } from '../../../core/rendering/recentSurfaceCache';
import type { Rect } from '../../core/geom';
import { withAlpha } from '../../theme/color';
import type { CandlelightInk, DuskInk, StripLightInk, TorchlightInk } from '../../theme/introInk';
import type { IntroAmbience } from './floorIntroThemes';
import { paintTubeBloom } from './introLight';
import { FULL_TURN, paintSoftPool, paintVerticalRamp, scatter } from '../../../sprites/lightMaps';
import { paintLightColumn } from '../celebration/celebrationLight';
import { WORLD_TICKS_PER_SECOND } from '../../../core/constants';

type Ctx = CanvasRenderingContext2D;

/** How much a painter draws: a phone gets fewer particles for the same picture. */
export type AmbienceDetail = 'full' | 'lite';

/** The screen size, in its shorter side, every particle size is designed at. */
const DESIGN_SHORT_SIDE = 600;
const LITE_SHARE = 0.5;
const MS_PER_SECOND = 1000;
const HALF = 0.5;

/**
 * Paints `ambience` over `area` `ms` into the intro, at `presence` (0..1)
 * opacity.
 */
export function paintIntroAmbience(
  ctx: Ctx,
  area: Rect,
  ambience: IntroAmbience,
  ms: number,
  presence: number,
  detail: AmbienceDetail,
): void {
  if (presence <= 0) return;
  const scene: AmbienceScene = {
    ctx,
    area,
    ms,
    unit: Math.min(area.w, area.h) / DESIGN_SHORT_SIDE,
    count: (full) => (detail === 'full' ? full : Math.ceil(full * LITE_SHARE)),
  };
  ctx.save();
  ctx.globalAlpha *= presence;
  switch (ambience.kind) {
    case 'candlelight':
      paintCandlelight(scene, ambience.ink);
      break;
    case 'torchlight':
      paintTorchlight(scene, ambience.ink);
      break;
    case 'stripLights':
      paintStripLights(scene, ambience.ink);
      break;
    case 'dusk':
      paintDusk(scene, ambience.ink);
      break;
    default: {
      const unhandled: never = ambience;
      throw new Error(`Unpainted intro ambience: ${JSON.stringify(unhandled)}`);
    }
  }
  ctx.restore();
}

interface AmbienceScene {
  readonly ctx: Ctx;
  readonly area: Rect;
  readonly ms: number;
  /** Screen pixels per design pixel. */
  readonly unit: number;
  /** How many of a particle to draw at this detail, given the full count. */
  readonly count: (full: number) => number;
}

/** A point on the screen as shares of its width and height. */
interface Placement {
  readonly x: number;
  readonly y: number;
}

/**
 * Which property of a particle a {@link scatter} draw is for: each property
 * draws its own value, so a particle's speed does not follow its position.
 */
const SALT = {
  dustX: 0,
  dustFall: 1,
  dustY: 2,
  dustSway: 3,
  dustSize: 4,
  dripPeriod: 5,
  dripPhase: 6,
  dripColumn: 7,
  sparkSide: 9,
  sparkAngle: 10,
  sparkSpeed: 11,
  steamWobble: 12,
  tubeFlicker: 13,
  roofWidth: 20,
  roofWall: 21,
  roofChimney: 22,
  leafSpeed: 30,
  leafX: 31,
  leafBob: 32,
  leafBand: 33,
  leafSpin: 34,
  leafTurn: 35,
} as const;

function at(area: Rect, place: Placement): { x: number; y: number } {
  return { x: area.x + area.w * place.x, y: area.y + area.h * place.y };
}

/** `value` wrapped into 0..`length`. */
function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

/** A soft round glow: see {@link paintSoftPool}. */
function radialGlow(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  paintSoftPool(ctx, cx, cy, radius, radius, color, alpha);
}

/** A small teardrop flame standing on (`x`, `y`), `height` tall, leaning by `lean` (-1..1). */
function flame(
  ctx: Ctx,
  x: number,
  y: number,
  height: number,
  lean: number,
  outer: string,
  core: string,
): void {
  const width = height * FLAME_WIDTH_SHARE;
  const tipX = x + lean * width;
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(x - width, y);
  ctx.quadraticCurveTo(x - width, y - height * FLAME_SHOULDER, tipX, y - height);
  ctx.quadraticCurveTo(x + width, y - height * FLAME_SHOULDER, x + width, y);
  ctx.quadraticCurveTo(x, y + width * FLAME_BASE_ROUND, x - width, y);
  ctx.fill();
  const coreW = width * FLAME_CORE_SHARE;
  const coreH = height * FLAME_CORE_SHARE;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(x - coreW, y);
  ctx.quadraticCurveTo(x - coreW, y - coreH * FLAME_SHOULDER, x + lean * coreW, y - coreH);
  ctx.quadraticCurveTo(x + coreW, y - coreH * FLAME_SHOULDER, x + coreW, y);
  ctx.quadraticCurveTo(x, y + coreW * FLAME_BASE_ROUND, x - coreW, y);
  ctx.fill();
}

const FLAME_WIDTH_SHARE = 0.32;
const FLAME_SHOULDER = 0.45;
const FLAME_BASE_ROUND = 0.9;
const FLAME_CORE_SHARE = 0.55;

/** A light's slow waver: two out-of-step sines around 1. */
function waver(ms: number, phase: number, depth: number): number {
  return (
    1 +
    depth * Math.sin(ms * WAVER_SLOW + phase) * WAVER_SLOW_SHARE +
    depth * Math.sin(ms * WAVER_FAST + phase * 2) * (1 - WAVER_SLOW_SHARE)
  );
}

const WAVER_SLOW = 0.0047;
const WAVER_FAST = 0.0213;
const WAVER_SLOW_SHARE = 0.6;

// ── Candlelight ──────────────────────────────────────────────────────────

interface CandlePool extends Placement {
  /** The pool's reach, in design pixels. */
  readonly reach: number;
  /** Whether a candle stands in view at its heart, or only its light reaches in. */
  readonly candle: boolean;
}

const CANDLE_POOLS: readonly CandlePool[] = [
  { x: 0.1, y: 0.86, reach: 210, candle: true },
  { x: 0.9, y: 0.82, reach: 240, candle: true },
  { x: 0.22, y: 0.14, reach: 170, candle: false },
  { x: 0.8, y: 0.1, reach: 150, candle: false },
  { x: 0.6, y: 0.97, reach: 160, candle: true },
];

const POOL_ALPHA = 0.5;
/** Light spilling in from a candle out of view is dimmer than one standing in the room. */
const SPILL_SHARE = 0.55;
const POOL_WAVER = 0.16;
const CANDLE_FLAME_HEIGHT = 22;
const CANDLE_WIDTH = 10;
const CANDLE_HEIGHT = 44;
const CANDLE_LEAN = 0.35;
const WICK_HEIGHT = 2;
/** The candle's shaded side, as a share of its width. */
const CANDLE_SHADE_SHARE = 0.35;
const CANDLE_SHADE_ALPHA = 0.45;
/** The halo hugging each flame. */
const FLAME_HALO_REACH = 2.4;
const FLAME_HALO_ALPHA = 0.55;
/** The bright puddle of light on the floor round a cluster's feet. */
const FLOOR_GLOW_REACH = 70;
const FLOOR_GLOW_FLATTEN = 0.28;
const FLOOR_GLOW_ALPHA = 0.5;

/** A cluster's candles: sideways in candle widths, and height as a share of the tallest. */
const CANDLE_CLUSTER: readonly { readonly offset: number; readonly height: number }[] = [
  { offset: -1.7, height: 0.62 },
  { offset: 0, height: 1 },
  { offset: 1.6, height: 0.78 },
];
const DUST_MOTES = 70;
const DUST_FALL_PER_SECOND = 14;
const DUST_FALL_SPREAD = 18;
const DUST_SWAY = 10;
const DUST_SWAY_RATE = 0.0011;
const DUST_SIZE = 1.1;
const DUST_SIZE_SPREAD = 1.3;
const DUST_DIM_ALPHA = 0.08;
const DUST_LIT_ALPHA = 0.85;

function paintCandlelight(scene: AmbienceScene, ink: CandlelightInk): void {
  const { ctx, area, ms, unit } = scene;
  const pools = CANDLE_POOLS.map((pool, index) => {
    const centre = at(area, pool);
    const glowY = pool.candle ? centre.y - CANDLE_HEIGHT * unit : centre.y;
    return { ...centre, glowY, pool, reach: pool.reach * unit * waver(ms, index, POOL_WAVER) };
  });
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pool of pools) {
    const alpha = pool.pool.candle ? POOL_ALPHA : POOL_ALPHA * SPILL_SHARE;
    radialGlow(ctx, pool.x, pool.glowY, pool.reach, ink.pool, alpha);
  }
  ctx.restore();

  for (const [index, pool] of pools.entries()) {
    if (!pool.pool.candle) continue;
    paintCandleCluster(scene, ink, pool, index);
  }

  const motes = scene.count(DUST_MOTES);
  const seconds = ms / MS_PER_SECOND;
  for (let index = 0; index < motes; index++) {
    const fall = (DUST_FALL_PER_SECOND + scatter(index, SALT.dustFall) * DUST_FALL_SPREAD) * unit;
    const y = area.y + wrap(scatter(index, SALT.dustY) * area.h + seconds * fall, area.h);
    const sway =
      Math.sin(ms * DUST_SWAY_RATE + scatter(index, SALT.dustSway) * FULL_TURN) * DUST_SWAY * unit;
    const x = area.x + scatter(index, SALT.dustX) * area.w + sway;
    const lit = pools.reduce((most, pool) => {
      const distance = Math.hypot(pool.x - x, pool.glowY - y);
      return Math.max(most, 1 - distance / pool.reach);
    }, 0);
    const alpha = DUST_DIM_ALPHA + (DUST_LIT_ALPHA - DUST_DIM_ALPHA) * Math.max(0, lit);
    ctx.fillStyle = withAlpha(ink.dust, alpha);
    const size = (DUST_SIZE + scatter(index, SALT.dustSize) * DUST_SIZE_SPREAD) * unit;
    ctx.fillRect(x, y, size, size);
  }
}

function paintCandleCluster(
  scene: AmbienceScene,
  ink: CandlelightInk,
  base: { readonly x: number; readonly y: number },
  clusterIndex: number,
): void {
  const { ctx, ms, unit } = scene;
  const floorReach = FLOOR_GLOW_REACH * unit;
  ctx.save();
  ctx.translate(base.x, base.y);
  ctx.scale(1, FLOOR_GLOW_FLATTEN);
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(
    ctx,
    0,
    0,
    floorReach * waver(ms, clusterIndex, POOL_WAVER),
    ink.pool,
    FLOOR_GLOW_ALPHA,
  );
  ctx.restore();

  const candleW = CANDLE_WIDTH * unit;
  for (const [candleIndex, candle] of CANDLE_CLUSTER.entries()) {
    const phase = clusterIndex * CANDLE_CLUSTER.length + candleIndex;
    const x = base.x + candle.offset * candleW;
    const candleH = CANDLE_HEIGHT * unit * candle.height;
    const top = base.y - candleH;
    ctx.fillStyle = ink.candle;
    ctx.fillRect(x - candleW * HALF, top, candleW, candleH);
    ctx.fillStyle = withAlpha(ink.wick, CANDLE_SHADE_ALPHA);
    ctx.fillRect(
      x + candleW * (HALF - CANDLE_SHADE_SHARE),
      top,
      candleW * CANDLE_SHADE_SHARE,
      candleH,
    );
    ctx.fillStyle = ink.wick;
    ctx.fillRect(x - unit * HALF, top - unit * WICK_HEIGHT, unit, unit * WICK_HEIGHT);
    const lean = Math.sin(ms * WAVER_FAST + phase) * CANDLE_LEAN;
    const height = CANDLE_FLAME_HEIGHT * unit * waver(ms, phase, POOL_WAVER);
    const flameTop = top - unit * WICK_HEIGHT;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    radialGlow(
      ctx,
      x,
      flameTop - height * HALF,
      height * FLAME_HALO_REACH,
      ink.flameOuter,
      FLAME_HALO_ALPHA,
    );
    ctx.restore();
    flame(ctx, x, flameTop, height, lean, ink.flameOuter, ink.flameCore);
  }
}

// ── Torchlight ───────────────────────────────────────────────────────────

const TORCHES: readonly Placement[] = [
  { x: 0.08, y: 0.4 },
  { x: 0.92, y: 0.4 },
];

const TORCH_GLOW_REACH = 330;
const TORCH_GLOW_ALPHA = 0.42;
const TORCH_WAVER = 0.12;
/** Keeps the two torches' flicker out of step. */
const TORCH_PHASE_STEP = 3;
const TORCH_FLAME_HEIGHT = 46;
const TORCH_LEAN = 0.4;
const SCONCE_WIDTH = 16;
const SCONCE_HEIGHT = 30;
const STONE_COURSE = 34;
const STONE_BLOCK = 68;
const STONE_LINE_ALPHA = 0.3;
/** How far round a torch its light picks out the stone's joints, as a share of its glow. */
const STONE_LIT_REACH = 0.8;
const STONE_LINE_WIDTH = 1.2;
/** Two screen-sized surfaces at a phone's full density, with room to spare. */
const STONE_BAKE_BUDGET_MEGABYTES = 24;
const STONE_PROTECTED_FRAMES = 2;
const STONE_IDLE_RELEASE_FRAMES = 300;
const DRIP_COLUMNS = 9;
const DRIP_PERIOD_MS = 1700;
const DRIP_PERIOD_SPREAD_MS = 1300;
const DRIP_LENGTH = 16;
const DRIP_WIDTH = 1.5;
const DRIP_ALPHA = 0.7;
const DRIP_FLOOR = 0.96;
const DRIP_FALL_SHARE = 0.82;
const SPLASH_RADIUS = 9;
const SMOKE_PUFFS = 7;
const SMOKE_PERIOD_MS = 3400;
const SMOKE_RISE = 220;
const SMOKE_DRIFT = 46;
const SMOKE_RADIUS = 16;
const SMOKE_GROWTH = 44;
const SMOKE_ALPHA = 0.2;

function paintTorchlight(scene: AmbienceScene, ink: TorchlightInk): void {
  const { ctx, area, ms, unit } = scene;
  const torches = TORCHES.map((place, index) => ({
    ...at(area, place),
    flicker: waver(ms, index * TORCH_PHASE_STEP, TORCH_WAVER),
  }));

  paintLitStone(scene, ink.wetStone, torches);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const torch of torches) {
    radialGlow(
      ctx,
      torch.x,
      torch.y,
      TORCH_GLOW_REACH * unit * torch.flicker,
      ink.glow,
      TORCH_GLOW_ALPHA,
    );
  }
  ctx.restore();

  paintSmoke(scene, ink, torches);

  for (const [index, torch] of torches.entries()) {
    const sconceW = SCONCE_WIDTH * unit;
    const sconceH = SCONCE_HEIGHT * unit;
    ctx.fillStyle = ink.sconce;
    ctx.beginPath();
    ctx.moveTo(torch.x - sconceW * HALF, torch.y);
    ctx.lineTo(torch.x + sconceW * HALF, torch.y);
    ctx.lineTo(torch.x + sconceW * HALF * HALF, torch.y + sconceH);
    ctx.lineTo(torch.x - sconceW * HALF * HALF, torch.y + sconceH);
    ctx.closePath();
    ctx.fill();
    const lean = Math.sin(ms * WAVER_FAST * 2 + index) * TORCH_LEAN;
    const flameHeight = TORCH_FLAME_HEIGHT * unit * torch.flicker;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    radialGlow(
      ctx,
      torch.x,
      torch.y - flameHeight * HALF,
      flameHeight * FLAME_HALO_REACH,
      ink.flameOuter,
      FLAME_HALO_ALPHA,
    );
    ctx.restore();
    flame(
      ctx,
      torch.x,
      torch.y,
      TORCH_FLAME_HEIGHT * unit * torch.flicker,
      lean,
      ink.flameOuter,
      ink.flameCore,
    );
  }

  paintDrips(scene, ink);
}

function paintStoneCourses(ctx: Ctx, area: Rect, unit: number): void {
  const course = STONE_COURSE * unit;
  const block = STONE_BLOCK * unit;
  ctx.lineWidth = STONE_LINE_WIDTH * unit;
  ctx.beginPath();
  for (let row = 0, y = area.y; y < area.y + area.h; row++, y += course) {
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    const stagger = row % 2 === 0 ? 0 : block * HALF;
    for (let x = area.x - stagger; x < area.x + area.w; x += block) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + course);
    }
  }
  ctx.stroke();
}

/**
 * The stone wall's joints, and a scratch they are lit on, both the size of
 * the intro's screen: held while the intro plays and let go once it has
 * gone unshown for a few seconds.
 */
const stoneSurfaces = new RecentSurfaceCache<CanvasSurface>(
  STONE_BAKE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE,
  STONE_PROTECTED_FRAMES,
  (surface) => surface,
  STONE_IDLE_RELEASE_FRAMES,
);
onCanvasRecovery(() => stoneSurfaces.clear());

function stoneSurface(key: string, w: number, h: number): CanvasSurface | null {
  const known = stoneSurfaces.get(key);
  if (known !== undefined) return known;
  const surface = allocCanvas('ui', w, h);
  try {
    freshSurfaceContext(surface);
  } catch {
    return null;
  }
  stoneSurfaces.set(key, surface);
  return surface;
}

/**
 * The wet stone's joints catching each torch's light: the joint pattern is
 * baked once, lit through soft pools round the torches on a scratch, and the
 * lit joints laid over the wall, so a frame builds no gradient.
 */
function paintLitStone(
  scene: AmbienceScene,
  wetStone: string,
  torches: readonly { readonly x: number; readonly y: number; readonly flicker: number }[],
): void {
  const { ctx, area, unit } = scene;
  const transform = ctx.getTransform();
  const scale = Math.max(
    Math.hypot(transform.a, transform.b),
    Math.hypot(transform.c, transform.d),
  );
  const w = Math.ceil(area.w * scale);
  const h = Math.ceil(area.h * scale);
  if (w <= 0 || h <= 0) return;
  const size = `${w}x${h}|${unit}`;
  const joints =
    stoneSurfaces.get(`joints|${size}`) ??
    bakeJoints(`joints|${size}`, w, h, scale, area, unit, wetStone);
  const lit = stoneSurface(`lit|${w}x${h}`, w, h);
  if (joints === null || lit === null) return;
  const litCtx = freshSurfaceContext(lit);
  litCtx.setTransform(1, 0, 0, 1, 0, 0);
  litCtx.globalCompositeOperation = 'source-over';
  litCtx.clearRect(0, 0, w, h);
  litCtx.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
  for (const torch of torches) {
    const reach = TORCH_GLOW_REACH * unit * torch.flicker * STONE_LIT_REACH;
    paintSoftPool(litCtx, torch.x, torch.y, reach, reach, wetStone, 1, 'linear');
  }
  litCtx.setTransform(1, 0, 0, 1, 0, 0);
  litCtx.globalCompositeOperation = 'destination-in';
  litCtx.drawImage(joints, 0, 0);
  litCtx.globalCompositeOperation = 'source-over';
  ctx.save();
  try {
    ctx.globalAlpha *= STONE_LINE_ALPHA;
    ctx.drawImage(lit, area.x, area.y, area.w, area.h);
  } finally {
    ctx.restore();
  }
}

function bakeJoints(
  key: string,
  w: number,
  h: number,
  scale: number,
  area: Rect,
  unit: number,
  ink: string,
): CanvasSurface | null {
  const joints = stoneSurface(key, w, h);
  if (joints === null) return null;
  const jointsCtx = freshSurfaceContext(joints);
  jointsCtx.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
  // Only the joints' coverage is kept, as a mask for the torchlight.
  jointsCtx.strokeStyle = ink;
  paintStoneCourses(jointsCtx, area, unit);
  return joints;
}

function paintSmoke(
  scene: AmbienceScene,
  ink: TorchlightInk,
  torches: readonly { readonly x: number; readonly y: number }[],
): void {
  const { ctx, ms, unit } = scene;
  const puffs = scene.count(SMOKE_PUFFS);
  for (const [torchIndex, torch] of torches.entries()) {
    for (let index = 0; index < puffs; index++) {
      const offset = (index / puffs) * SMOKE_PERIOD_MS + torchIndex * SMOKE_PERIOD_MS * HALF;
      const age = wrap(ms + offset, SMOKE_PERIOD_MS) / SMOKE_PERIOD_MS;
      const towardMiddle = torch.x < scene.area.x + scene.area.w * HALF ? 1 : -1;
      const x = torch.x + towardMiddle * age * SMOKE_DRIFT * unit;
      const y = torch.y - TORCH_FLAME_HEIGHT * unit - age * SMOKE_RISE * unit;
      const radius = (SMOKE_RADIUS + age * SMOKE_GROWTH) * unit;
      radialGlow(ctx, x, y, radius, ink.smoke, SMOKE_ALPHA * Math.sin(Math.PI * age));
    }
  }
}

function paintDrips(scene: AmbienceScene, ink: TorchlightInk): void {
  const { ctx, area, ms, unit } = scene;
  const columns = scene.count(DRIP_COLUMNS);
  const floorY = area.y + area.h * DRIP_FLOOR;
  ctx.lineWidth = DRIP_WIDTH * unit;
  for (let index = 0; index < columns; index++) {
    const period = DRIP_PERIOD_MS + scatter(index, SALT.dripPeriod) * DRIP_PERIOD_SPREAD_MS;
    const phase = wrap(ms + scatter(index, SALT.dripPhase) * period, period) / period;
    const x =
      area.x + area.w * ((index + HALF + (scatter(index, SALT.dripColumn) - HALF)) / columns);
    if (phase < DRIP_FALL_SHARE) {
      const fall = phase / DRIP_FALL_SHARE;
      const y = area.y + (floorY - area.y) * fall * fall;
      ctx.strokeStyle = withAlpha(ink.drip, DRIP_ALPHA);
      ctx.beginPath();
      ctx.moveTo(x, y - DRIP_LENGTH * unit);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      const splash = (phase - DRIP_FALL_SHARE) / (1 - DRIP_FALL_SHARE);
      ctx.strokeStyle = withAlpha(ink.drip, DRIP_ALPHA * (1 - splash));
      ctx.beginPath();
      ctx.ellipse(
        x,
        floorY,
        SPLASH_RADIUS * unit * splash,
        SPLASH_RADIUS * unit * splash * HALF * HALF,
        0,
        0,
        FULL_TURN,
      );
      ctx.stroke();
    }
  }
}

// ── Strip lights ─────────────────────────────────────────────────────────

interface StripTube extends Placement {
  /** How often the tube drops out: 0 never, 1 always. */
  readonly failing: number;
}

const STRIP_TUBES: readonly StripTube[] = [
  { x: 0.2, y: 0.07, failing: 0.08 },
  { x: 0.5, y: 0.05, failing: 0.45 },
  { x: 0.8, y: 0.07, failing: 0.18 },
];

const TUBE_LENGTH_SHARE = 0.2;
const TUBE_THICKNESS = 5;
const HOUSING_PAD = 4;
const FLICKER_STEP_MS = 70;
const TUBE_DIM = 0.12;
const CONE_REACH_SHARE = 0.75;
const CONE_SPREAD = 1.7;
const CONE_ALPHA = 0.32;
/** The wide bloom round a lit tube and its hot core: how far each spreads above and below, and how strong it is. */
const TUBE_BLOOM_REACH = 40;
const TUBE_BLOOM_ALPHA = 0.5;
const TUBE_CORE_REACH = 9;
const TUBE_CORE_ALPHA = 0.8;
/** Where a tube's light lands on the floor, as a share of its shaft's reach, and how deep and strong the pool is. */
const FLOOR_POOL_AT = 0.95;
const FLOOR_POOL_DEPTH = 40;
const FLOOR_POOL_ALPHA = 0.2;
const SPARK_BURST_PERIOD_MS = 1150;
const SPARKS_PER_BURST = 16;
const SPARK_LIFE_MS = 750;
const SPARK_SPEED = 260;
const SPARK_GRAVITY = 900;
const SPARK_TRAIL_S = 0.03;
const SPARK_WIDTH = 1.6;
/** The small glow round each spark's head. */
const SPARK_GLOW_REACH = 7;
const SPARK_GLOW_ALPHA = 0.6;
const STEAM_VENT: Placement = { x: 0, y: 0.72 };
const STEAM_PUFFS = 30;
const STEAM_PERIOD_MS = 2600;
const STEAM_REACH_SHARE = 0.75;
const STEAM_RISE = 70;
const STEAM_RADIUS = 22;
const STEAM_GROWTH = 120;
const STEAM_ALPHA = 0.14;
const STEAM_WOBBLE = 14;
const STEAM_PIPE_LENGTH = 26;
const STEAM_PIPE_BORE = 9;

function tubeBrightness(ms: number, index: number, failing: number): number {
  const step = Math.floor(ms / FLICKER_STEP_MS);
  return scatter(step, SALT.tubeFlicker + index) < failing ? TUBE_DIM : 1;
}

function paintStripLights(scene: AmbienceScene, ink: StripLightInk): void {
  const { ctx, area, ms, unit } = scene;
  const length = area.w * TUBE_LENGTH_SHARE;
  const thickness = TUBE_THICKNESS * unit;
  const pad = HOUSING_PAD * unit;

  for (const [index, tube] of STRIP_TUBES.entries()) {
    const centre = at(area, tube);
    const bright = tubeBrightness(ms, index, tube.failing);
    const left = centre.x - length * HALF;
    paintTubeLight(scene, ink, centre, length, bright);

    ctx.fillStyle = ink.housing;
    ctx.fillRect(
      left - pad,
      centre.y - thickness * HALF - pad,
      length + pad * 2,
      thickness + pad * 2,
    );
    ctx.fillStyle = withAlpha(ink.tube, Math.max(TUBE_DIM, bright));
    ctx.fillRect(left, centre.y - thickness * HALF, length, thickness);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    paintTubeBloom(
      ctx,
      centre.x,
      centre.y,
      length,
      TUBE_BLOOM_REACH * unit,
      ink.tubeGlow,
      TUBE_BLOOM_ALPHA * bright,
    );
    paintTubeBloom(
      ctx,
      centre.x,
      centre.y,
      length,
      TUBE_CORE_REACH * unit,
      ink.tube,
      TUBE_CORE_ALPHA * bright,
    );
    ctx.restore();
  }

  paintSparks(scene, ink, length);
  paintSteam(scene, ink);
}

/**
 * The light a tube throws down the room: a soft shaft widening below it and
 * a pool where it lands on the floor.
 */
function paintTubeLight(
  scene: AmbienceScene,
  ink: StripLightInk,
  tube: { readonly x: number; readonly y: number },
  length: number,
  bright: number,
): void {
  const { ctx, area, ms, unit } = scene;
  const reach = area.h * CONE_REACH_SHARE;
  ctx.save();
  // The shaft painter stands its light on a foot and fades it upward; mirrored
  // top to bottom, its foot hangs from the tube and it fades toward the floor.
  ctx.translate(tube.x, tube.y);
  ctx.scale(1, -1);
  paintLightColumn(
    ctx,
    { base: { x: 0, y: 0 }, halfBase: length * HALF, widen: CONE_SPREAD, height: reach },
    ink.tubeGlow,
    CONE_ALPHA * bright,
    (ms * WORLD_TICKS_PER_SECOND) / MS_PER_SECOND,
  );
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  paintSoftPool(
    ctx,
    tube.x,
    tube.y + reach * FLOOR_POOL_AT,
    length * CONE_SPREAD * HALF,
    FLOOR_POOL_DEPTH * unit,
    ink.tubeGlow,
    FLOOR_POOL_ALPHA * bright,
  );
  ctx.restore();
}

function paintSparks(scene: AmbienceScene, ink: StripLightInk, tubeLength: number): void {
  const { ctx, area, ms, unit } = scene;
  const failingTube = STRIP_TUBES.reduce((worst, tube) =>
    tube.failing > worst.failing ? tube : worst,
  );
  const tubeCentre = at(area, failingTube);
  const sparks = scene.count(SPARKS_PER_BURST);
  const burst = Math.floor(ms / SPARK_BURST_PERIOD_MS);
  ctx.lineWidth = SPARK_WIDTH * unit;
  ctx.lineCap = 'round';
  for (const burstIndex of [burst - 1, burst]) {
    if (burstIndex < 0) continue;
    const age = (ms - burstIndex * SPARK_BURST_PERIOD_MS) / MS_PER_SECOND;
    if (age * MS_PER_SECOND > SPARK_LIFE_MS) continue;
    const fromEnd = scatter(burstIndex, SALT.sparkSide) < HALF ? -1 : 1;
    const originX = tubeCentre.x + fromEnd * tubeLength * HALF;
    const life = (age * MS_PER_SECOND) / SPARK_LIFE_MS;
    for (let index = 0; index < sparks; index++) {
      const seed = burstIndex * SPARKS_PER_BURST + index;
      const angle = Math.PI * (scatter(seed, SALT.sparkAngle) - HALF);
      const speed = SPARK_SPEED * (HALF + scatter(seed, SALT.sparkSpeed)) * unit;
      const vx = Math.sin(angle) * speed;
      const vy = Math.cos(angle) * speed * HALF;
      const gravity = SPARK_GRAVITY * unit;
      const x = originX + vx * age;
      const y = tubeCentre.y + vy * age + HALF * gravity * age * age;
      const tailAge = Math.max(0, age - SPARK_TRAIL_S);
      const tailX = originX + vx * tailAge;
      const tailY = tubeCentre.y + vy * tailAge + HALF * gravity * tailAge * tailAge;
      ctx.strokeStyle = withAlpha(life < HALF ? ink.sparkHot : ink.spark, 1 - life);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glowReach = SPARK_GLOW_REACH * unit;
      paintSoftPool(ctx, x, y, glowReach, glowReach, ink.spark, SPARK_GLOW_ALPHA * (1 - life));
      ctx.restore();
    }
  }
}

function paintSteam(scene: AmbienceScene, ink: StripLightInk): void {
  const { ctx, area, ms, unit } = scene;
  const vent = at(area, STEAM_VENT);
  ctx.fillStyle = ink.housing;
  ctx.fillRect(
    vent.x,
    vent.y - STEAM_PIPE_BORE * unit,
    STEAM_PIPE_LENGTH * unit,
    STEAM_PIPE_BORE * unit * 2,
  );
  const puffs = scene.count(STEAM_PUFFS);
  const reach = area.w * STEAM_REACH_SHARE;
  for (let index = 0; index < puffs; index++) {
    const age = wrap(ms + (index / puffs) * STEAM_PERIOD_MS, STEAM_PERIOD_MS) / STEAM_PERIOD_MS;
    const wobble =
      Math.sin(age * FULL_TURN + scatter(index, SALT.steamWobble) * FULL_TURN) *
      STEAM_WOBBLE *
      unit;
    const x = vent.x + STEAM_PIPE_LENGTH * unit + age * reach;
    const y = vent.y - age * STEAM_RISE * unit + wobble;
    const radius = (STEAM_RADIUS + age * STEAM_GROWTH) * unit;
    radialGlow(ctx, x, y, radius, ink.steam, STEAM_ALPHA * Math.sin(Math.PI * Math.sqrt(age)));
  }
}

// ── Dusk ─────────────────────────────────────────────────────────────────

/** Where the sky's colour starts, and where the horizon sits, as shares of the height. */
const SKY_FROM = 0.3;
const HORIZON_AT = 0.88;
const SKY_LOW_ALPHA = 0.75;
const HORIZON_GLOW_ALPHA = 0.5;
const HORIZON_GLOW_WIDTH = 0.7;
const HORIZON_GLOW_HEIGHT = 0.22;
const TOWER_AT = 0.78;
const TOWER_WIDTH = 30;
const TOWER_HEIGHT_SHARE = 0.3;
const TOWER_BELFRY_FLARE = 1.3;
const TOWER_BELFRY_HEIGHT = 1.1;
const TOWER_SPIRE_HEIGHT = 2.4;
const TOWER_WINDOW_SHARE = 0.28;
const TOWER_WINDOW_GLOW = 26;
const LEAVES = 28;
const LEAF_SPEED = 120;
const LEAF_SPEED_SPREAD = 110;
const LEAF_BOB = 34;
const LEAF_BOB_RATE = 0.0022;
const LEAF_SPIN_RATE = 0.006;
const LEAF_LENGTH = 6;
const LEAF_WIDTH = 2.6;
const LEAF_MARGIN = 30;
const LEAF_BAND_TOP = 0.15;
const LEAF_BAND = 0.75;

function paintDusk(scene: AmbienceScene, ink: DuskInk): void {
  const { ctx, area } = scene;
  const skyTop = area.y + area.h * SKY_FROM;
  const horizon = area.y + area.h * HORIZON_AT;
  const skyBottom = withAlpha(ink.skyLow, SKY_LOW_ALPHA);
  paintVerticalRamp(ctx, { x: area.x, y: skyTop, w: area.w, h: horizon - skyTop }, [
    { at: 0, color: withAlpha(ink.skyHigh, 0) },
    { at: HALF, color: withAlpha(ink.skyHigh, SKY_LOW_ALPHA) },
    { at: 1, color: skyBottom },
  ]);
  ctx.fillStyle = skyBottom;
  ctx.fillRect(area.x, horizon, area.w, area.y + area.h - horizon);

  ctx.save();
  ctx.translate(area.x + area.w * HALF, horizon);
  ctx.scale(1, HORIZON_GLOW_HEIGHT / HORIZON_GLOW_WIDTH);
  radialGlow(ctx, 0, 0, area.w * HORIZON_GLOW_WIDTH, ink.horizonGlow, HORIZON_GLOW_ALPHA);
  ctx.restore();

  paintTower(scene, ink, horizon);
  paintRoofline(scene, horizon, FAR_ROOFS, ink.farRoofs);
  ctx.fillStyle = ink.farRoofs;
  ctx.fillRect(area.x, horizon, area.w, area.y + area.h - horizon);
  paintRoofline(scene, area.y + area.h, NEAR_ROOFS, ink.nearRoofs);
  paintLeaves(scene, ink);
}

/** One row of the town's roofs: how wide a house is and how high its walls stand. */
interface RooflineRow {
  /** A house's width, in design pixels, before its own variation. */
  readonly houseWidth: number;
  /** Wall heights, in design pixels. */
  readonly wall: number;
  readonly wallSpread: number;
  /** Keeps one row's houses from repeating the other's. */
  readonly salt: number;
}

const FAR_ROOFS: RooflineRow = { houseWidth: 70, wall: 30, wallSpread: 30, salt: 0 };
const NEAR_ROOFS: RooflineRow = { houseWidth: 120, wall: 34, wallSpread: 40, salt: 100 };
/** A house's width varies from this share of its row's up by {@link HOUSE_WIDTH_SPREAD}. */
const HOUSE_WIDTH_MIN = 0.7;
const HOUSE_WIDTH_SPREAD = 0.6;
/** How steep a gable is: its rise as a share of the house's half-width. */
const ROOF_PITCH = 0.9;
/** A chimney stands on roughly this share of houses. */
const CHIMNEY_SHARE = 0.4;
/** A chimney's width and how far it stands above the ridge, as shares of its house's width. */
const CHIMNEY_WIDTH = 0.12;
const CHIMNEY_RISE = 0.18;
/** Where along the house its chimney rises, on the right-hand slope. */
const CHIMNEY_AT = 0.7;

/** A row of gabled houses standing shoulder to shoulder on `ground`, across the whole width. */
function paintRoofline(
  scene: AmbienceScene,
  ground: number,
  row: RooflineRow,
  color: string,
): void {
  const { ctx, area, unit } = scene;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(area.x, ground);
  let x = area.x - row.houseWidth * unit * HALF;
  for (let index = 0; x < area.x + area.w; index++) {
    const width =
      row.houseWidth *
      unit *
      (HOUSE_WIDTH_MIN + scatter(index, SALT.roofWidth + row.salt) * HOUSE_WIDTH_SPREAD);
    const wallTop =
      ground - (row.wall + scatter(index, SALT.roofWall + row.salt) * row.wallSpread) * unit;
    const ridgeTop = wallTop - width * HALF * ROOF_PITCH;
    ctx.lineTo(x, wallTop);
    ctx.lineTo(x + width * HALF, ridgeTop);
    if (scatter(index, SALT.roofChimney + row.salt) < CHIMNEY_SHARE) {
      const chimneyLeft = x + width * CHIMNEY_AT;
      const chimneyRight = chimneyLeft + width * CHIMNEY_WIDTH;
      const slopeAt = (px: number): number => ridgeTop + (px - (x + width * HALF)) * ROOF_PITCH;
      const chimneyTop = ridgeTop - width * CHIMNEY_RISE;
      ctx.lineTo(chimneyLeft, slopeAt(chimneyLeft));
      ctx.lineTo(chimneyLeft, chimneyTop);
      ctx.lineTo(chimneyRight, chimneyTop);
      ctx.lineTo(chimneyRight, slopeAt(chimneyRight));
    }
    ctx.lineTo(x + width, wallTop);
    x += width;
  }
  ctx.lineTo(area.x + area.w, ground);
  ctx.closePath();
  ctx.fill();
}

/** The tower, far off over the roofs: a square keep with a belfry and a spire, its window lit. */
function paintTower(scene: AmbienceScene, ink: DuskInk, ground: number): void {
  const { ctx, area, unit } = scene;
  const width = TOWER_WIDTH * unit;
  const height = area.h * TOWER_HEIGHT_SHARE;
  const left = area.x + area.w * TOWER_AT - width * HALF;
  const top = ground - height;
  const belfryW = width * TOWER_BELFRY_FLARE;
  const belfryH = width * TOWER_BELFRY_HEIGHT;
  const belfryLeft = left - (belfryW - width) * HALF;
  const spire = width * TOWER_SPIRE_HEIGHT;
  ctx.fillStyle = ink.tower;
  ctx.fillRect(left, top, width, height);
  ctx.fillRect(belfryLeft, top - belfryH, belfryW, belfryH);
  ctx.beginPath();
  ctx.moveTo(belfryLeft, top - belfryH);
  ctx.lineTo(left + width * HALF, top - belfryH - spire);
  ctx.lineTo(belfryLeft + belfryW, top - belfryH);
  ctx.closePath();
  ctx.fill();
  const windowW = width * TOWER_WINDOW_SHARE;
  const windowH = belfryH * TOWER_WINDOW_SHARE * 2;
  const windowX = left + width * HALF;
  const windowY = top - belfryH * HALF;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, windowX, windowY, TOWER_WINDOW_GLOW * unit, ink.towerWindow, HALF);
  ctx.restore();
  ctx.fillStyle = ink.towerWindow;
  ctx.fillRect(windowX - windowW * HALF, windowY - windowH * HALF, windowW, windowH);
}

function paintLeaves(scene: AmbienceScene, ink: DuskInk): void {
  const { ctx, area, ms, unit } = scene;
  const leaves = scene.count(LEAVES);
  const seconds = ms / MS_PER_SECOND;
  const margin = LEAF_MARGIN * unit;
  for (let index = 0; index < leaves; index++) {
    const speed = (LEAF_SPEED + scatter(index, SALT.leafSpeed) * LEAF_SPEED_SPREAD) * unit;
    const x =
      area.x -
      margin +
      wrap(scatter(index, SALT.leafX) * area.w + seconds * speed, area.w + margin * 2);
    const bob =
      Math.sin(ms * LEAF_BOB_RATE + scatter(index, SALT.leafBob) * FULL_TURN) * LEAF_BOB * unit;
    const y = area.y + area.h * (LEAF_BAND_TOP + scatter(index, SALT.leafBand) * LEAF_BAND) + bob;
    const color = ink.leaves[index % ink.leaves.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(
      ms * LEAF_SPIN_RATE * (HALF + scatter(index, SALT.leafSpin)) +
        scatter(index, SALT.leafTurn) * FULL_TURN,
    );
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, LEAF_LENGTH * unit, LEAF_WIDTH * unit, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.restore();
  }
}
