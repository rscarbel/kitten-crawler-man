/**
 * The torches down the hall walls: an iron bracket, the game's own torch brand
 * and socket, and a live flame. Before the music a single torch burns, the
 * nearer one on the left wall, guttering low; the ignition flares the rest one
 * pair at a time from the far end toward the viewer.
 *
 * This layer owns how bright each torch burns: it writes `stage.lights.torches`
 * every update, and the light layer reads it. Every level is a function of the
 * clock, so a frozen moment shows exactly the torches it should; the one thing
 * remembered is what each torch burned at when a dive began, because a dive
 * only ever dims the hall from wherever it stood.
 */

import {
  allocCanvas,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
  resizeSurface,
} from '../../../core/canvasSurface';
import { canvasGeneration } from '../../../core/canvasRecovery';
import { renderQuality } from '../../../core/RenderQuality';
import { drawSpriteKey } from '../../../core/SpriteRenderer';
import { flameStamps, hashUnit, type FlameStamps } from '../../../sprites/flameStamps';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import { pixelRatioOf } from '../titleBake';
import { HALL_DEPTH, pxPerTileAt, titleHall } from '../titleHall';
import { applyTitleCamera, type TitleLayer, type TitlePoint } from '../titleLayer';
import type { TitleClock } from '../titleClock';
import type { TitleStage } from '../titleStage';
import { TORCHES_LIGHT_AT_MS } from '../titleTimeline';

// ── when each torch burns ────────────────────────────────────────────────────

/** Torches come in facing pairs, far to near; each pair waits on the one before it. */
const TORCHES_PER_PAIR = 2;
const PAIR_STAGGER_MS = 300;
/** The right-hand torch of a pair catches a beat after the left, so a pair reads as two strikes. */
const SIDE_STAGGER_MS = 90;
/** How long a torch takes from catching to burning fully. */
const CATCH_MS = 160;
/** The flare that overshoots full burn as a torch catches, and how long it takes to settle. */
const FLARE_PEAK = 0.55;
const FLARE_SETTLE_MS = 520;

/** The one torch burning before the music: low, and fighting to stay lit. */
const GUTTERING_TORCH_INDEX = 2;
const GUTTERING_LEVEL = 0.5;

/** Steady burn's flicker depth, and how much of it survives when the player asks for less motion. */
const FLICKER_DEPTH = 0.13;
const REDUCED_FLICKER_DEPTH = 0.05;
/** A guttering flame dips much deeper. */
const GUTTER_FLICKER_DEPTH = 0.45;
const REDUCED_GUTTER_FLICKER_DEPTH = 0.22;
/** Two slow sways and a fast random flutter, in milliseconds per radian or per step. */
const FLICKER_SLOW_MS_PER_RADIAN = 210;
const FLICKER_MID_MS_PER_RADIAN = 77;
const FLICKER_FLUTTER_STEP_MS = 55;
const FLICKER_SLOW_SHARE = 0.45;
const FLICKER_MID_SHARE = 0.25;
const FLICKER_FLUTTER_SHARE = 0.3;
/** Keeps each torch's flicker out of step with its neighbours'. */
const FLICKER_PHASE_PER_TORCH = 2.39;
const FLICKER_HASH_SALT = 71;

/** The dive douses the torches slowly at first, then all at once as the scene is replaced. */
const DIVE_EASE_EXPONENT = 2;

// ── how a torch is drawn ─────────────────────────────────────────────────────

/** A sconce torch drawn as tall as this many tiles of its own wall. */
const SCONCE_TILES = 1.6;
/** The torch sheet's tile, in sheet pixels; its brand is measured in these. */
const TORCH_SHEET_TILE_PX = 64;
/**
 * Where the torch sheet's brand sits, in sheet pixels from its tile's top-left:
 * the top of the rag head, the foot of the socket basket and the basket's
 * half-width. Only that band is drawn; the tripod below it belongs to a
 * standing torch, and the flame painted above it is replaced by a live one.
 */
const SHEET_HEAD_TOP_Y = -21.3;
const SHEET_SOCKET_RIM_Y = -1.3;
const SHEET_SOCKET_FOOT_Y = 6.7;
const SHEET_BRAND_HALF_WIDTH = 8;
/** Sheet pixels of the head's top hidden under the live flame, where the sheet's own flame starts. */
const SHEET_FLAME_OVERLAP_PX = 2;
/** How far toward cold pitch an unlit brand is darkened; the sheet paints it as a burning one. */
const UNLIT_BRAND_SHADE = 0.72;
/** Even burning, the rag under the flame is mostly pitch: only the flame itself is bright. */
const BURNING_BRAND_SHADE = 0.38;
/** The brand's shade is repainted in this many steps between lit and unlit, not every frame of a catch. */
const BRAND_SHADE_STEPS = 16;

/** The wall bracket under the socket, in sheet pixels. */
const BRACKET_PLATE_HALF_WIDTH = 2.6;
const BRACKET_PLATE_HEIGHT = 15;
const BRACKET_ARM_WIDTH = 2.2;
const BRACKET_RIVET_RADIUS = 0.9;

/** The flame's own size, in sheet pixels, at full burn. */
const FLAME_SIZE_SHEET_PX = 44;
const FLAME_COLUMN_HEIGHT = 0.72;
const FLAME_ROOT_WIDTH = 0.46;
const FLAME_ROOT_HEIGHT = 0.7;
const FLAME_PARCEL_HALF_WIDTH = 0.17;
const FLAME_PARCEL_HEIGHT = 0.52;
const FLAME_PARCEL_TAPER = 0.6;
/** Parcels fade faster than linearly, so the tongue thins out rather than ending in a cut. */
const FLAME_PARCEL_FADE_EXPONENT = 1.5;
const FLAME_PARCEL_LIFETIME_MS = 520;
const FLAME_PARCEL_SWAY = 0.16;
const FLAME_PARCEL_SWAY_CYCLE = 5.3;
const FLAME_PARCEL_ROOT_SPREAD = 0.24;
const PARCELS_FULL_DETAIL = 6;
const PARCELS_REDUCED_DETAIL = 4;
const FLAME_THROAT_RADIUS = 0.09;
const FLAME_THROAT_LIFT = 0.14;
const FLAME_THROAT_ALPHA = 0.8;
/** The hot core is a tall sliver inside the body, not a round bulb. */
const FLAME_THROAT_NARROWING = 0.7;
const FLAME_THROAT_STRETCH = 1.8;
const FLAME_GLOW_RADIUS = 0.9;
const FLAME_GLOW_ALPHA = 0.25;
/** The glow sits on the body of the flame, clear of the rag it burns from. */
const FLAME_GLOW_LIFT = 0.35;
/** Under this a flame is too faint to be worth stamping. */
const MIN_FLAME_LEVEL = 0.02;
/** A low flame is small but still opaque; only one that is nearly out turns see-through. */
const FLAME_OPACITY_GAIN = 2.5;
/** Red embers in the rag of a guttering torch, visible between its dips. */
const GUTTER_EMBER_COUNT = 3;
const GUTTER_EMBER_RADIUS = 1.2;
const GUTTER_EMBER_SPREAD = 4;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const HASH_SALT_WIDTH = 13;
const HASH_SALT_SWAY = 29;
const HASH_SALT_ROOT = 47;
const HASH_SALT_BEND = 61;
const HASH_SALT_MIRROR = 83;
const HASH_SALT_RELEASE = 97;
const MIRROR_CHANCE = 0.5;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  const inverse = 1 - clamp01(t);
  return 1 - inverse * inverse * inverse;
}

/** When torch `index` catches during the ignition, from the ignition's start. */
function catchAtMs(index: number): number {
  const pair = Math.floor(index / TORCHES_PER_PAIR);
  const side = index % TORCHES_PER_PAIR;
  return TORCHES_LIGHT_AT_MS + pair * PAIR_STAGGER_MS + side * SIDE_STAGGER_MS;
}

interface TorchBurn {
  readonly level: number;
  /** Extra brightness from the flare, on top of the flicker. */
  readonly flare: number;
  readonly guttering: boolean;
}

/** Where the torches stood when the dive began: their dormant resting burn, all fully lit, or each as it was. */
type DiveStart = 'dormant' | 'lit' | readonly TorchBurn[];

const FULLY_LIT: TorchBurn = { level: 1, flare: 0, guttering: false };

function restingBurn(index: number): TorchBurn {
  const guttering = index === GUTTERING_TORCH_INDEX;
  return { level: guttering ? GUTTERING_LEVEL : 0, flare: 0, guttering };
}

function diveStartBurn(start: DiveStart, index: number): TorchBurn {
  if (start === 'dormant') return restingBurn(index);
  if (start === 'lit') return FULLY_LIT;
  return index < start.length ? start[index] : FULLY_LIT;
}

function burnAt(index: number, clock: TitleClock, diveStart: DiveStart): TorchBurn {
  const guttering = index === GUTTERING_TORCH_INDEX;
  const restingLevel = guttering ? GUTTERING_LEVEL : 0;
  switch (clock.state) {
    case 'dormant':
      return { level: restingLevel, flare: 0, guttering };
    case 'ignition': {
      const sinceCatch = clock.stateElapsedMs - catchAtMs(index);
      if (sinceCatch < 0) return { level: restingLevel, flare: 0, guttering };
      const caught = easeOutCubic(sinceCatch / CATCH_MS);
      const level = restingLevel + (1 - restingLevel) * caught;
      const flare = FLARE_PEAK * caught * (1 - clamp01(sinceCatch / FLARE_SETTLE_MS));
      return { level, flare, guttering: false };
    }
    case 'alive':
      return { level: 1, flare: 0, guttering: false };
    case 'dive': {
      const start = diveStartBurn(diveStart, index);
      const remaining = 1 - Math.pow(clock.diveProgress, DIVE_EASE_EXPONENT);
      return { level: start.level * remaining, flare: 0, guttering: start.guttering };
    }
  }
}

function flickerAt(index: number, clock: TitleClock, guttering: boolean): number {
  const depth = guttering
    ? clock.reducedMotion
      ? REDUCED_GUTTER_FLICKER_DEPTH
      : GUTTER_FLICKER_DEPTH
    : clock.reducedMotion
      ? REDUCED_FLICKER_DEPTH
      : FLICKER_DEPTH;
  const t = clock.elapsedMs;
  const phase = index * FLICKER_PHASE_PER_TORCH;
  const slow = Math.sin(t / FLICKER_SLOW_MS_PER_RADIAN + phase);
  const mid = Math.sin(t / FLICKER_MID_MS_PER_RADIAN + phase * 2);
  const step = Math.floor(t / FLICKER_FLUTTER_STEP_MS);
  const along = t / FLICKER_FLUTTER_STEP_MS - step;
  const here = hashUnit(step, index + FLICKER_HASH_SALT);
  const next = hashUnit(step + 1, index + FLICKER_HASH_SALT);
  const flutter = (here + (next - here) * along) * 2 - 1;
  const wave =
    slow * FLICKER_SLOW_SHARE + mid * FLICKER_MID_SHARE + flutter * FLICKER_FLUTTER_SHARE;
  // A guttering flame only ever dips: it never burns brighter than its low level.
  return guttering ? 1 - depth * (wave + 1) * HALF : 1 + depth * wave;
}

function writeLights(
  clock: TitleClock,
  stage: TitleStage,
  diveStart: DiveStart,
  guttering: boolean[],
): TorchBurn[] {
  return stage.lights.torches.map((light, index) => {
    const burn = burnAt(index, clock, diveStart);
    light.level = burn.level;
    light.flicker = flickerAt(index, clock, burn.guttering) + burn.flare;
    guttering[index] = burn.guttering;
    return burn;
  });
}

// ── painting ─────────────────────────────────────────────────────────────────

function paintBracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  socketRimY: number,
  k: number,
): void {
  const plateHalf = BRACKET_PLATE_HALF_WIDTH * k;
  const plateTop = socketRimY;
  const plateHeight = BRACKET_PLATE_HEIGHT * k;
  ctx.fillStyle = TITLE_INK.torch.iron;
  ctx.fillRect(x - plateHalf, plateTop, plateHalf * 2, plateHeight);
  ctx.fillStyle = TITLE_INK.torch.ironLight;
  ctx.fillRect(x - plateHalf, plateTop, BRACKET_ARM_WIDTH * k * HALF, plateHeight);
  ctx.beginPath();
  ctx.arc(x, plateTop + plateHeight * HALF, BRACKET_RIVET_RADIUS * k, 0, FULL_TURN);
  ctx.fill();
}

/** One torch's brand, painted once and blitted until its size or its shade changes. */
interface BrandSurface {
  readonly canvas: CanvasSurface;
  key: string;
}

/**
 * The brand and socket, cut out of the torch sheet. Painted through a small
 * surface of its own so the dark of an unlit torch can be laid over the
 * brand's pixels alone, never over the wall behind it.
 */
function paintBrand(
  ctx: CanvasRenderingContext2D,
  brand: BrandSurface,
  mount: TitlePoint,
  k: number,
  level: number,
  zoom: number,
): void {
  const ratio = pixelRatioOf(ctx, zoom);
  const width = SHEET_BRAND_HALF_WIDTH * 2 * k;
  const height = (SHEET_SOCKET_FOOT_Y - SHEET_HEAD_TOP_Y - SHEET_FLAME_OVERLAP_PX) * k;
  const unlitShare = Math.round((1 - clamp01(level)) * BRAND_SHADE_STEPS) / BRAND_SHADE_STEPS;
  const shade = BURNING_BRAND_SHADE + (UNLIT_BRAND_SHADE - BURNING_BRAND_SHADE) * unlitShare;
  const key = `${width.toFixed(1)}|${ratio}|${shade}#${canvasGeneration()}`;
  if (brand.key !== key) {
    repaintBrand(brand.canvas, k, ratio, width, height, shade);
    brand.key = key;
  }
  const left = mount.x - SHEET_BRAND_HALF_WIDTH * k;
  const top = mount.y + SHEET_FLAME_OVERLAP_PX * k;
  ctx.drawImage(brand.canvas, left, top, width, height);
}

function repaintBrand(
  canvas: CanvasSurface,
  k: number,
  ratio: number,
  width: number,
  height: number,
  shade: number,
): void {
  resizeSurface(
    canvas,
    Math.max(1, Math.ceil(width * ratio)),
    Math.max(1, Math.ceil(height * ratio)),
  );
  const brandCtx = surfaceContext(canvas);
  brandCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const tileSize = TORCH_SHEET_TILE_PX * k;
  drawSpriteKey(
    brandCtx,
    'torch',
    'idle',
    0,
    width * HALF - tileSize * HALF,
    -(SHEET_HEAD_TOP_Y + SHEET_FLAME_OVERLAP_PX) * k,
    tileSize,
  );
  brandCtx.globalCompositeOperation = 'source-atop';
  brandCtx.globalAlpha = shade;
  brandCtx.fillStyle = TITLE_INK.torch.unlitShade;
  brandCtx.fillRect(0, 0, width, height);
}

function paintGutterEmbers(
  ctx: CanvasRenderingContext2D,
  mount: TitlePoint,
  k: number,
  glow: number,
  index: number,
): void {
  ctx.fillStyle = TITLE_INK.torch.ember;
  for (let ember = 0; ember < GUTTER_EMBER_COUNT; ember++) {
    const offset = (hashUnit(ember, index) - HALF) * GUTTER_EMBER_SPREAD * 2 * k;
    const drop = hashUnit(index, ember) * GUTTER_EMBER_SPREAD * k;
    ctx.globalAlpha = clamp01(glow);
    ctx.beginPath();
    ctx.arc(
      mount.x + offset,
      mount.y + SHEET_FLAME_OVERLAP_PX * k + drop,
      GUTTER_EMBER_RADIUS * k,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

interface FlameDraw {
  readonly x: number;
  readonly baseY: number;
  readonly size: number;
  readonly intensity: number;
  readonly timeMs: number;
  readonly seed: number;
  readonly parcels: number;
}

/** A torch flame from the shared flame stamps: a glow, an anchored root, rising parcels and a hot throat. */
function paintFlame(ctx: CanvasRenderingContext2D, stamps: FlameStamps, flame: FlameDraw): void {
  const { x, baseY, size, intensity, timeMs, seed, parcels } = flame;
  if (intensity < MIN_FLAME_LEVEL) return;
  const strength = clamp01(intensity * FLAME_OPACITY_GAIN);
  const reach = Math.sqrt(intensity);

  ctx.globalCompositeOperation = 'lighter';
  const glowRadius = size * FLAME_GLOW_RADIUS * Math.sqrt(intensity);
  ctx.globalAlpha = clamp01(FLAME_GLOW_ALPHA * intensity);
  const glowY = baseY - size * FLAME_GLOW_LIFT;
  ctx.drawImage(stamps.glow, x - glowRadius, glowY - glowRadius, glowRadius * 2, glowRadius * 2);
  ctx.globalCompositeOperation = 'source-over';

  const rootWidth = size * FLAME_ROOT_WIDTH * Math.sqrt(strength);
  const rootHeight = size * FLAME_ROOT_HEIGHT * reach;
  ctx.globalAlpha = strength;
  ctx.drawImage(stamps.root, x - rootWidth * HALF, baseY - rootHeight, rootWidth, rootHeight);

  const columnHeight = size * FLAME_COLUMN_HEIGHT * reach;
  const topTier = stamps.body.length - 1;
  const clockCycles = timeMs / FLAME_PARCEL_LIFETIME_MS;
  for (let i = 0; i < parcels; i++) {
    const release = clockCycles + (i + hashUnit(seed + HASH_SALT_RELEASE, i) * HALF) / parcels;
    const birth = Math.floor(release);
    const age = release - birth;
    const widthJitter = HALF + hashUnit(birth + HASH_SALT_WIDTH, i + seed);
    const halfWidth = size * FLAME_PARCEL_HALF_WIDTH * widthJitter * (1 - age * FLAME_PARCEL_TAPER);
    const height = size * FLAME_PARCEL_HEIGHT * widthJitter * Math.sqrt(strength);
    const swayPhase = hashUnit(birth + HASH_SALT_SWAY, i + seed) * FULL_TURN;
    const sway =
      size * FLAME_PARCEL_SWAY * age * Math.sin(age * FLAME_PARCEL_SWAY_CYCLE + swayPhase);
    const root =
      (hashUnit(birth + HASH_SALT_ROOT, i + seed) - HALF) * size * FLAME_PARCEL_ROOT_SPREAD;
    const footX = x + root * (1 - age) + sway;
    const footY = baseY - columnHeight * age;
    const tier = Math.min(topTier, Math.floor(age * stamps.body.length));
    const bends = stamps.body[tier];
    const bend = bends[Math.floor(hashUnit(birth + HASH_SALT_BEND, i + seed) * bends.length)];
    const mirrored = hashUnit(birth + HASH_SALT_MIRROR, i + seed) < MIRROR_CHANCE;
    ctx.globalAlpha = strength * Math.pow(1 - age, FLAME_PARCEL_FADE_EXPONENT);
    ctx.save();
    ctx.translate(footX, footY);
    if (mirrored) ctx.scale(-1, 1);
    ctx.drawImage(bend, -halfWidth, -height, halfWidth * 2, height);
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'lighter';
  const throatRadius = size * FLAME_THROAT_RADIUS * Math.sqrt(strength);
  const throatHalfWidth = throatRadius * FLAME_THROAT_NARROWING;
  const throatHalfHeight = throatRadius * FLAME_THROAT_STRETCH;
  ctx.globalAlpha = strength * FLAME_THROAT_ALPHA;
  ctx.drawImage(
    stamps.throat,
    x - throatHalfWidth,
    baseY - size * FLAME_THROAT_LIFT - throatHalfHeight,
    throatHalfWidth * 2,
    throatHalfHeight * 2,
  );
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

export function torchLayer(): TitleLayer {
  const guttering: boolean[] = [];
  let brands: BrandSurface[] = [];
  // Until an update has run, the hall is as the scene opens it: dormant.
  let latest: DiveStart = 'dormant';
  let diveStart: DiveStart = 'dormant';
  return {
    id: 'torches',
    depth: HALL_DEPTH,
    update: (clock, stage) => {
      const burns = writeLights(clock, stage, diveStart, guttering);
      if (clock.state !== 'dive') latest = burns;
    },
    onCue: (cue) => {
      // A moment entered part-way hands over every cue before it with no update between, so the cues themselves say where the torches stand.
      if (cue === 'settle') latest = 'lit';
      if (cue === 'diveStart') diveStart = latest;
    },
    render: (ctx, clock, stage, camera) => {
      applyTitleCamera(ctx, camera, HALL_DEPTH);
      const hall = titleHall(stage);
      const stamps = flameStamps();
      const parcels = renderQuality.fullDetail ? PARCELS_FULL_DETAIL : PARCELS_REDUCED_DETAIL;
      stage.torches.forEach((mount, index) => {
        const light = stage.lights.torches[index];
        const k = (pxPerTileAt(hall, mount) * SCONCE_TILES) / TORCH_SHEET_TILE_PX;
        paintBracket(ctx, mount.x, mount.y + (SHEET_SOCKET_RIM_Y - SHEET_HEAD_TOP_Y) * k, k);
        const brand = (brands[index] ??= { canvas: allocCanvas('title', 1, 1), key: '' });
        paintBrand(ctx, brand, mount, k, light.level, camera.zoom);
        const intensity = light.level * light.flicker;
        if (guttering[index]) paintGutterEmbers(ctx, mount, k, light.flicker, index);
        paintFlame(ctx, stamps, {
          x: mount.x,
          baseY: mount.y + SHEET_FLAME_OVERLAP_PX * k,
          size: FLAME_SIZE_SHEET_PX * k,
          intensity,
          timeMs: clock.elapsedMs,
          seed: index,
          parcels,
        });
      });
    },
    dispose: () => {
      for (const brand of brands) {
        releaseSurface(brand.canvas);
      }
      brands = [];
    },
  };
}
