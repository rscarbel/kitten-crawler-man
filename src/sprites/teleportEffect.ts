/**
 * The world re-rendering a figure as it teleports in or out: the machine that
 * fabricates this world building someone, or taking them apart.
 *
 * Arriving, a thin column of light scans down to the floor, the figure
 * resolves in horizontal bands from the feet up, each band a glitching,
 * offset slice before it snaps into place among square data motes, and a last
 * flash runs round its edge. Leaving, the bands lift away top first and break
 * into motes drawn up into the column.
 *
 * The effect is laid out of three pictures of the figure — the figure itself,
 * the figure washed in the light's colour, and a ring of the light round its
 * edge — which the figure supplies through {@link TeleportFigure}. Each frame
 * is laid out of them from its frame index alone, so the layout allocates
 * nothing and stores no frames of its own.
 */

import type { SoundId } from '../audio/sounds';
import { type CanvasSurface, surfaceContext } from '../core/rendering/canvasSurface';
import { worldPalette } from '../ui/theme/worldInk';
import { clamp01, easeInOut, easeOut, lerp, ramp } from './art/bipedArt';
import { TICKS_PER_SECOND } from './art/human/timing';

// ── Timing ───────────────────────────────────────────────────────────────────

const TELEPORT_IN_SECONDS = 1.1;
const TELEPORT_OUT_SECONDS = 0.8;
export const TELEPORT_IN_FRAMES = Math.round(TELEPORT_IN_SECONDS * TICKS_PER_SECOND);
export const TELEPORT_OUT_FRAMES = Math.round(TELEPORT_OUT_SECONDS * TICKS_PER_SECOND);

/** One teleport on one draw: which way the figure is going, and how far into it. */
export interface TeleportDraw {
  readonly direction: 'in' | 'out';
  readonly elapsedFrames: number;
}

/** What an arrival and a departure sound like, whoever the world is building. */
export const TELEPORT_SOUNDS = {
  in: 'dave_teleport_in',
  out: 'dave_teleport_out',
} as const satisfies Record<TeleportDraw['direction'], SoundId>;

// ── What a figure supplies ───────────────────────────────────────────────────

/** The three pictures of a figure the effect is laid out of. */
export type TeleportLayer = 'solid' | 'glitch' | 'edge';

/**
 * A figure the world can build or take apart.
 *
 * Every measure is in tiles from the top-left of the tile the figure stands
 * on, y growing downward, so the layout is the same at any tile size.
 *
 * `Pose` is whatever one draw of the figure needs to pick its solid picture —
 * a frame of a breathing loop, or nothing for a figure held as one snapshot.
 */
export interface TeleportFigure<Pose> {
  /** Where its soles meet the floor. */
  readonly soleY: number;
  /** The top of its head. */
  readonly headY: number;
  /** The vertical line the column of light runs down. */
  readonly centreX: number;
  /**
   * The box every picture of it fits inside. The lowest and highest bands run
   * on to its edges, so nothing of the figure is ever left out of a band.
   */
  readonly boxLeft: number;
  readonly boxTop: number;
  readonly boxWidth: number;
  readonly boxBottom: number;
  /** Draws one picture of it with its tile's top-left at `(sx, sy)`, at `alpha`. */
  drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: TeleportLayer,
    pose: Pose,
    sx: number,
    sy: number,
    tileSize: number,
    alpha: number,
  ): void;
}

// ── Painting the light pictures ──────────────────────────────────────────────

/**
 * How strongly a glitching slice is washed in the light's colour: enough
 * that it reads as light rather than as the figure, little enough that its
 * shape and the folds of its clothes still show through it.
 */
const GLITCH_TINT_ALPHA = 0.72;
/** The edge ring's width, in tiles: one screen pixel at the 32 px tile. */
export const TELEPORT_EDGE_RING_TILES = 1 / 32;
/** Directions the silhouette is stamped in to grow it into the ring. */
const EDGE_RING_SAMPLES = 8;
const FULL_TURN = Math.PI * 2;

/** Washes a picture of the figure in the light's colour, in place: its `glitch` picture. */
export function washInTeleportLight(body: CanvasSurface): void {
  const bodyCtx = surfaceContext(body);
  bodyCtx.save();
  bodyCtx.setTransform(1, 0, 0, 1, 0, 0);
  bodyCtx.globalCompositeOperation = 'source-atop';
  bodyCtx.globalAlpha = GLITCH_TINT_ALPHA;
  bodyCtx.fillStyle = worldPalette.teleport.glow;
  bodyCtx.fillRect(0, 0, body.width, body.height);
  bodyCtx.restore();
}

/**
 * Paints onto `ring`, a cleared surface the size of `body`, a ring of the
 * light `reachPx` surface pixels wide round the figure in `body`: its `edge`
 * picture.
 */
export function paintTeleportEdgeRing(
  ring: CanvasSurface,
  body: CanvasSurface,
  reachPx: number,
): void {
  const ringCtx = surfaceContext(ring);
  ringCtx.save();
  ringCtx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < EDGE_RING_SAMPLES; i++) {
    const angle = (i / EDGE_RING_SAMPLES) * FULL_TURN;
    ringCtx.drawImage(body, Math.cos(angle) * reachPx, Math.sin(angle) * reachPx);
  }
  ringCtx.globalCompositeOperation = 'source-in';
  ringCtx.fillStyle = worldPalette.teleport.core;
  ringCtx.fillRect(0, 0, ring.width, ring.height);
  ringCtx.globalCompositeOperation = 'destination-out';
  ringCtx.drawImage(body, 0, 0);
  ringCtx.restore();
}

// ── The layout ───────────────────────────────────────────────────────────────

/** The bands the figure is built in, feet first. */
const BAND_COUNT = 9;
const LAST_BAND = BAND_COUNT - 1;

/** The column starts this far above the head, in tiles: it comes from somewhere, not out of the hair. */
const BEAM_ABOVE_HEAD_TILES = 0.9;
/** The column's white core and its glow, in tiles across. */
const BEAM_CORE_WIDTH_TILES = 1 / 32;
const BEAM_GLOW_WIDTH_TILES = 0.16;
const BEAM_GLOW_ALPHA = 0.35;
/** Where the column lands on the floor, a flat pool of light, in tiles across and deep. */
const POOL_HALF_WIDTH_TILES = 0.5;
const POOL_HALF_DEPTH_TILES = 0.14;
const POOL_ALPHA = 0.4;
/** How far a glitching slice is thrown sideways at its worst, in tiles. */
const GLITCH_THROW_TILES = 0.16;
/** A glitching slice jumps to a new offset every this many ticks: a stutter, not a slide. */
const GLITCH_TICKS_PER_JUMP = 3;
/** On some jumps a slice shows as the figure rather than as light, so it flickers between the two. */
const GLITCH_SOLID_SHARE = 0.2;
/** Leaving, each slice lifts this far as it dissolves, in tiles. */
const BAND_LIFT_TILES = 0.35;

/** Motes thrown off each band while it glitches, their size in tiles, and how far they scatter. */
const MOTES_PER_BAND = 5;
const MOTE_SMALL_TILES = 1 / 16;
const MOTE_LARGE_TILES = 3 / 32;
const MOTE_LARGE_SHARE = 0.3;
const MOTE_SCATTER_TILES = 0.55;
const MOTE_DRIFT_TILES = 0.3;
/** Leaving, the motes are drawn up into the column this far, in tiles. */
const MOTE_RISE_TILES = 0.9;
const MOTE_BRIGHT_SHARE = 0.4;
/** Ticks a mote holds a position before it hops: data blinking along rather than drifting smoothly. */
const MOTE_TICKS_PER_HOP = 2;

/** The edge flash's peak strength, and how strongly the body is washed in light under it. */
const EDGE_FLASH_ALPHA = 1;
const BODY_FLASH_ALPHA = 0.3;

/**
 * Arriving, as shares of the whole: the column scans down to the floor, the
 * bands resolve from the feet up while it holds and fades, and the edge
 * flashes last.
 */
const IN_BEAM_LANDS = 0.12;
const IN_POOL_FADES = 0.45;
const IN_BANDS_START = 0.14;
const IN_BANDS_END = 0.8;
const IN_BAND_GLITCH = 0.11;
const IN_BEAM_FADE_FROM = 0.5;
const IN_BEAM_GONE = 0.8;
const IN_FLASH_FROM = 0.72;
const IN_FLASH_TO = 0.9;

/**
 * Leaving, as shares of the whole: the edge flashes as the column drops onto
 * the figure, the bands lift away from the head down, and the column draws up
 * off the floor after the last of it.
 */
const OUT_FLASH_TO = 0.12;
const OUT_BEAM_IN_TO = 0.08;
const OUT_BANDS_START = 0.1;
const OUT_BANDS_END = 0.82;
const OUT_BAND_DISSOLVE = 0.16;
const OUT_BEAM_RETRACT_FROM = 0.84;

// ── Deterministic scatter ────────────────────────────────────────────────────

const HASH_PRIME_A = 0x9e3779b1;
const HASH_PRIME_B = 0x85ebca6b;
const HASH_PRIME_C = 0xc2b2ae35;
const HASH_SHIFT_A = 16;
const HASH_SHIFT_B = 13;
const UINT32_RANGE = 0x100000000;

/** A repeatable number in [0, 1) for a pair of integers: the same mote lands in the same place every time. */
function hashUnit(a: number, b: number): number {
  let h = Math.imul(a ^ HASH_PRIME_C, HASH_PRIME_A) ^ Math.imul(b, HASH_PRIME_B);
  h ^= h >>> HASH_SHIFT_A;
  h = Math.imul(h, HASH_PRIME_B);
  h ^= h >>> HASH_SHIFT_B;
  return (h >>> 0) / UINT32_RANGE;
}

const MOTE_SALT_X = 1;
const MOTE_SALT_Y = 2;
const MOTE_SALT_SIZE = 3;
const MOTE_SALT_TONE = 4;
const MOTE_SALT_DIRECTION = 5;
const GLITCH_SALT_THROW = 6;
const GLITCH_SALT_SOLID = 7;
const MOTE_SALT_STRIDE = 8;

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Where one draw of the figure lands on screen. */
interface Placement<Pose> {
  readonly ctx: CanvasRenderingContext2D;
  readonly figure: TeleportFigure<Pose>;
  readonly pose: Pose;
  readonly sx: number;
  readonly sy: number;
  readonly tileSize: number;
}

function screenY<Pose>(place: Placement<Pose>, tilesY: number): number {
  return place.sy + tilesY * place.tileSize;
}

function screenX<Pose>(place: Placement<Pose>, tilesX: number): number {
  return place.sx + tilesX * place.tileSize;
}

/** The lower edge of band `index`, in tiles; `index + 1` is its upper edge. */
function bandEdge<Pose>(figure: TeleportFigure<Pose>, index: number): number {
  if (index <= 0) return figure.boxBottom;
  if (index >= BAND_COUNT) return figure.boxTop;
  return lerp(figure.soleY, figure.headY, index / BAND_COUNT);
}

/** Draws band `index` of one picture of the figure, thrown `dx` sideways and lifted `lift`, at `alpha`. */
function drawBand<Pose>(
  place: Placement<Pose>,
  layer: TeleportLayer,
  index: number,
  dx: number,
  lift: number,
  alpha: number,
): void {
  const { ctx, figure } = place;
  const bottom = Math.round(screenY(place, bandEdge(figure, index)) - lift);
  const top = Math.round(screenY(place, bandEdge(figure, index + 1)) - lift);
  if (bottom <= top || alpha <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    screenX(place, figure.boxLeft) + dx,
    top,
    figure.boxWidth * place.tileSize,
    bottom - top,
  );
  ctx.clip();
  figure.drawLayer(
    ctx,
    layer,
    place.pose,
    place.sx + dx,
    place.sy - lift,
    place.tileSize,
    Math.min(1, alpha),
  );
  ctx.restore();
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  colour: string,
  alpha: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (alpha <= 0 || w <= 0 || h <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

/** The narrowest the beam's glow draws, in screen pixels, so it never thins out of sight at a small tile. */
const BEAM_MIN_GLOW_PX = 2;
/** The narrowest the beam's white core draws, in screen pixels. */
const BEAM_MIN_CORE_PX = 1;
/** The cyan beam round the core, as a multiple of the core's width. */
const BEAM_WIDTH_PER_CORE = 2;
/** The smallest a mote draws, in screen pixels: a speck, never nothing. */
const MOTE_MIN_PX = 1;
/** The least height a band counts as having, in screen pixels, so its motes always have somewhere to scatter. */
const BAND_MIN_HEIGHT_PX = 1;

/** The column of light from `topY` down to `bottomY` (in tiles), at `strength`. */
function drawBeam<Pose>(
  place: Placement<Pose>,
  topY: number,
  bottomY: number,
  strength: number,
): void {
  if (strength <= 0) return;
  const { ctx, tileSize } = place;
  const centre = screenX(place, place.figure.centreX);
  const top = screenY(place, topY);
  const bottom = screenY(place, bottomY);
  const glowWidth = Math.max(BEAM_MIN_GLOW_PX, Math.round(BEAM_GLOW_WIDTH_TILES * tileSize));
  const coreWidth = Math.max(BEAM_MIN_CORE_PX, Math.round(BEAM_CORE_WIDTH_TILES * tileSize));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRect(
    ctx,
    worldPalette.teleport.glow,
    strength * BEAM_GLOW_ALPHA,
    Math.round(centre - glowWidth / 2),
    top,
    glowWidth,
    bottom - top,
  );
  drawRect(
    ctx,
    worldPalette.teleport.beam,
    strength,
    Math.round(centre - (coreWidth * BEAM_WIDTH_PER_CORE) / 2),
    top,
    coreWidth * BEAM_WIDTH_PER_CORE,
    bottom - top,
  );
  drawRect(
    ctx,
    worldPalette.teleport.core,
    strength,
    Math.round(centre - coreWidth / 2),
    top,
    coreWidth,
    bottom - top,
  );
  ctx.restore();
}

/** The flat pool of light the column makes where it meets the floor. */
function drawPool<Pose>(place: Placement<Pose>, strength: number, spread: number): void {
  if (strength <= 0) return;
  const { ctx, tileSize } = place;
  const centreX = screenX(place, place.figure.centreX);
  const centreY = screenY(place, place.figure.soleY);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, strength * POOL_ALPHA);
  ctx.fillStyle = worldPalette.teleport.glow;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    centreY,
    POOL_HALF_WIDTH_TILES * tileSize * spread,
    POOL_HALF_DEPTH_TILES * tileSize * spread,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.restore();
}

/**
 * The motes band `index` throws off at `progress` through its glitch: square
 * specks scattered round the band, drifting out from it (or, leaving, drawn
 * up toward the column), fading as they go.
 */
function drawMotes<Pose>(
  place: Placement<Pose>,
  index: number,
  progress: number,
  rise: number,
  tick: number,
): void {
  if (progress <= 0 || progress >= 1) return;
  const { ctx, tileSize, figure } = place;
  const centre = screenX(place, figure.centreX);
  const bandBottom = screenY(place, bandEdge(figure, index));
  const bandTop = screenY(place, bandEdge(figure, index + 1));
  const bandMiddle = (bandBottom + bandTop) / 2;
  const bandHeight = Math.max(BAND_MIN_HEIGHT_PX, bandBottom - bandTop);
  const fade = 1 - easeInOut(progress);
  const hop = Math.floor(tick / MOTE_TICKS_PER_HOP);
  for (let k = 0; k < MOTES_PER_BAND; k++) {
    const seed = index * MOTES_PER_BAND + k;
    const across = hashUnit(seed, MOTE_SALT_X) * 2 - 1;
    const along = hashUnit(seed, MOTE_SALT_Y) - 1 / 2;
    const outward = hashUnit(seed, MOTE_SALT_DIRECTION) < 1 / 2 ? -1 : 1;
    const jitter = hashUnit(seed * MOTE_SALT_STRIDE + hop, MOTE_SALT_X) - 1 / 2;
    const size = Math.max(
      MOTE_MIN_PX,
      Math.round(
        (hashUnit(seed, MOTE_SALT_SIZE) < MOTE_LARGE_SHARE ? MOTE_LARGE_TILES : MOTE_SMALL_TILES) *
          tileSize,
      ),
    );
    const bright = hashUnit(seed, MOTE_SALT_TONE) < MOTE_BRIGHT_SHARE;
    const drift = easeOut(progress) * MOTE_DRIFT_TILES * tileSize * outward;
    const x = centre + across * MOTE_SCATTER_TILES * tileSize * (1 / 2 + progress / 2) + drift;
    const y =
      bandMiddle + along * bandHeight + jitter * size - rise * easeInOut(progress) * tileSize;
    drawRect(
      ctx,
      bright ? worldPalette.teleport.core : worldPalette.teleport.beam,
      fade,
      Math.round(x),
      Math.round(y),
      size,
      size,
    );
  }
}

/** A glitching band's sideways throw on this tick, shrinking as `settle` goes 0 → 1. */
function glitchThrow(index: number, tick: number, settle: number, tileSize: number): number {
  const jump = Math.floor(tick / GLITCH_TICKS_PER_JUMP);
  const swing = hashUnit(index * MOTE_SALT_STRIDE + jump, GLITCH_SALT_THROW) * 2 - 1;
  return Math.round(swing * GLITCH_THROW_TILES * tileSize * settle);
}

/**
 * Whether a glitching slice shows as the figure on this tick. The chance
 * follows how much of the figure the slice still is, so a slice never
 * flickers back once it has mostly turned to light.
 */
function glitchShowsSolid(index: number, tick: number, solidity: number): boolean {
  const jump = Math.floor(tick / GLITCH_TICKS_PER_JUMP);
  return (
    hashUnit(index * MOTE_SALT_STRIDE + jump, GLITCH_SALT_SOLID) < GLITCH_SOLID_SHARE * solidity
  );
}

/** Band `index`'s share of the way from the first band to the last, feet first. */
function bandShare(index: number): number {
  return index / LAST_BAND;
}

function drawGlitchingBand<Pose>(
  place: Placement<Pose>,
  index: number,
  tick: number,
  throwLeft: number,
  lift: number,
  alpha: number,
): void {
  const dx = glitchThrow(index, tick, throwLeft, place.tileSize);
  const layer = glitchShowsSolid(index, tick, 1 - throwLeft) ? 'solid' : 'glitch';
  drawBand(place, layer, index, dx, lift, alpha);
}

/**
 * A flash's strength through its window: up in its first sliver, then dying
 * away, so it reads as a flash rather than as a glow that swells and fades.
 */
const FLASH_PEAK_AT = 0.15;
function flashCurve(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < FLASH_PEAK_AT) return t / FLASH_PEAK_AT;
  const fall = 1 - (t - FLASH_PEAK_AT) / (1 - FLASH_PEAK_AT);
  return fall * fall * fall;
}

/** Lays one of the light pictures of the figure over it, adding its light rather than covering it. */
function drawLightLayer<Pose>(place: Placement<Pose>, layer: TeleportLayer, alpha: number): void {
  if (alpha <= 0) return;
  const { ctx } = place;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  place.figure.drawLayer(
    ctx,
    layer,
    place.pose,
    place.sx,
    place.sy,
    place.tileSize,
    Math.min(1, alpha),
  );
  ctx.restore();
}

function drawEdgeFlash<Pose>(place: Placement<Pose>, flash: number): void {
  if (flash <= 0) return;
  drawLightLayer(place, 'glitch', flash * BODY_FLASH_ALPHA);
  drawLightLayer(place, 'edge', flash * EDGE_FLASH_ALPHA);
}

/** Draws the world building the figure; true when any band of it was drawn. */
function drawTeleportIn<Pose>(place: Placement<Pose>, elapsed: number): boolean {
  const { figure } = place;
  const p = clamp01(elapsed / TELEPORT_IN_FRAMES);
  const tick = Math.floor(elapsed);
  const beamTop = figure.headY - BEAM_ABOVE_HEAD_TILES;
  const landed = ramp(p, 0, IN_BEAM_LANDS);
  const beamTip = lerp(beamTop, figure.soleY, landed);
  const beamStrength = p < IN_BEAM_FADE_FROM ? 1 : 1 - ramp(p, IN_BEAM_FADE_FROM, IN_BEAM_GONE);

  const poolRise = ramp(p, IN_BEAM_LANDS, IN_BANDS_START + IN_BAND_GLITCH);
  const poolStrength =
    p < IN_BEAM_LANDS ? 0 : poolRise * (1 - ramp(p, IN_BANDS_START, IN_POOL_FADES));
  const span = IN_BANDS_END - IN_BANDS_START - IN_BAND_GLITCH;
  const bandStart = (index: number): number => IN_BANDS_START + span * bandShare(index);
  let front = figure.soleY;
  for (let index = 0; index < BAND_COUNT && p >= bandStart(index); index++) {
    front = Math.max(bandEdge(figure, index + 1), figure.headY);
  }
  drawPool(place, poolStrength, lerp(1 / 2, 1, poolRise));
  drawBeam(place, beamTop, Math.min(beamTip, front), beamStrength);

  let drawnAny = false;
  for (let index = 0; index < BAND_COUNT; index++) {
    const start = bandStart(index);
    if (p < start) continue;
    const settle = clamp01((p - start) / IN_BAND_GLITCH);
    drawnAny = true;
    if (settle >= 1) {
      drawBand(place, 'solid', index, 0, 0, 1);
      continue;
    }
    drawGlitchingBand(place, index, tick, 1 - settle, 0, 1);
    drawMotes(place, index, settle, 0, tick);
  }

  drawEdgeFlash(place, flashCurve((p - IN_FLASH_FROM) / (IN_FLASH_TO - IN_FLASH_FROM)));
  return drawnAny;
}

/** Draws the world taking the figure apart; true when any band of it was drawn. */
function drawTeleportOut<Pose>(place: Placement<Pose>, elapsed: number): boolean {
  const { figure } = place;
  const p = clamp01(elapsed / TELEPORT_OUT_FRAMES);
  const tick = Math.floor(elapsed);
  const beamTop = figure.headY - BEAM_ABOVE_HEAD_TILES;
  const span = OUT_BANDS_END - OUT_BANDS_START - OUT_BAND_DISSOLVE;
  const bandStart = (index: number): number =>
    OUT_BANDS_START + span * bandShare(BAND_COUNT - 1 - index);
  let remainingTop = figure.soleY;
  for (let index = 0; index < BAND_COUNT; index++) {
    const top = Math.max(bandEdge(figure, index + 1), figure.headY);
    if (p < bandStart(index) + OUT_BAND_DISSOLVE) remainingTop = Math.min(remainingTop, top);
  }
  const retract = ramp(p, OUT_BEAM_RETRACT_FROM, 1);
  const beamBottom = lerp(remainingTop, beamTop, retract);
  const beamStrength = ramp(p, 0, OUT_BEAM_IN_TO);
  const lastBandGoing = ramp(p, bandStart(0), bandStart(0) + OUT_BAND_DISSOLVE);
  drawPool(place, beamStrength * lastBandGoing * (1 - retract), 1);
  drawBeam(place, beamTop, beamBottom, beamStrength);

  let drawnAny = false;
  for (let index = BAND_COUNT - 1; index >= 0; index--) {
    const start = bandStart(index);
    if (p < start) {
      drawBand(place, 'solid', index, 0, 0, 1);
      drawnAny = true;
      continue;
    }
    const gone = clamp01((p - start) / OUT_BAND_DISSOLVE);
    if (gone >= 1) continue;
    const lift = easeInOut(gone) * BAND_LIFT_TILES * place.tileSize;
    drawGlitchingBand(place, index, tick, gone, lift, 1 - easeInOut(gone));
    drawMotes(place, index, gone, MOTE_RISE_TILES, tick);
    drawnAny = true;
  }

  drawEdgeFlash(place, p < OUT_FLASH_TO ? flashCurve(1 - p / OUT_FLASH_TO) : 0);
  return drawnAny;
}

/**
 * Draws `figure` part-way through `teleport`, standing on the tile whose
 * top-left is `(sx, sy)`; true when any band of it was drawn.
 */
export function drawTeleport<Pose>(
  ctx: CanvasRenderingContext2D,
  figure: TeleportFigure<Pose>,
  pose: Pose,
  sx: number,
  sy: number,
  tileSize: number,
  teleport: TeleportDraw,
): boolean {
  const place: Placement<Pose> = { ctx, figure, pose, sx, sy, tileSize };
  ctx.save();
  try {
    return teleport.direction === 'in'
      ? drawTeleportIn(place, teleport.elapsedFrames)
      : drawTeleportOut(place, teleport.elapsedFrames);
  } finally {
    ctx.restore();
  }
}
