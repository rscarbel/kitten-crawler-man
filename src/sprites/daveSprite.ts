/**
 * Dave in the world: his look in his own clothes on the human rig, standing,
 * walking and talking with the rig's bare-handed rows, and the world
 * re-rendering him as he teleports in and out.
 *
 * The teleport is the machine that fabricates this world building him, or
 * taking him apart: a thin column of light scans down to the floor, his figure
 * resolves in horizontal bands from the feet up, each band a glitching,
 * offset slice before it snaps into place among square data motes, and a last
 * flash runs round his edge. Leaving, the bands lift away top first and break
 * into motes drawn up into the column. The figure-shaped pictures it needs —
 * his standing cell, that cell in the light's colour, and the ring round its
 * edge — are cells of the shared figure cache; each frame is laid out of them
 * from its frame index alone, so it allocates nothing and stores no frames of
 * its own.
 */

import { TILE_SIZE } from '../core/constants';
import { allocCanvas, releaseSurface, surfaceContext } from '../core/rendering/canvasSurface';
import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { worldPalette } from '../ui/theme/worldInk';
import { clamp01, easeInOut, easeOut, lerp, ramp } from './art/bipedArt';
import { humanFigureFor } from './art/human/appearance';
import { WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { TICKS_PER_SECOND } from './art/human/timing';
import { HUMAN_ROW_TABLE, type HumanRowName, ORIGIN_Y, type ViewRows } from './art/humanFigure';
import type { CardinalView } from './facingView';
import { selectCardinalFacing } from './facingView';
import {
  type DrawnFigureRow,
  drawnFigureRow,
  type FigureDef,
  figureStates,
} from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { ResidentRows, type ResidentSpan } from './figure/residentRows';
import { defaultOutfitOf } from './garments/human/humanDressing';
import {
  drawHumanFigureSelection,
  rowFrameAtTicks,
  rowLengthInTicks,
  viewRow,
} from './humanSprite';
import { DAVE_LOOK } from './looks/humans/dave';

// ── His figure and rows ──────────────────────────────────────────────────────

/** His figure: the rig in his look and his own clothes, holding nothing. */
const DAVE_FIGURE = humanFigureFor(DAVE_LOOK, defaultOutfitOf(DAVE_LOOK), null);

type DaveRow = 'idle' | 'walk' | 'talk';

/** The rig's bare-handed rows he plays, per view. */
export const DAVE_ROWS: Readonly<Record<DaveRow, ViewRows>> = {
  idle: { front: 'idle', side: 'idle_side', back: 'idle_away' },
  walk: { front: 'walk', side: 'walk_side', back: 'walk_away' },
  talk: { front: 'talk', side: 'talk_side', back: 'talk_away' },
};

export const DRAWN_ROWS: readonly DaveRow[] = ['idle', 'walk', 'talk'];
const DRAWN_VIEWS: readonly CardinalView[] = ['front', 'side', 'back'];

/**
 * Every row he can be drawn in, held warm for as long as he is drawn: he
 * turns a quarter or a half turn in a tick when he sets off or is spoken to
 * from behind, and a view he had not faced for the release window would
 * otherwise bake on the render path.
 */
const RESIDENT_SPANS: readonly ResidentSpan[] = [
  ...new Set(DRAWN_ROWS.flatMap((row) => DRAWN_VIEWS.map((view) => DAVE_ROWS[row][view]))),
].map((row) => ({ row, frames: HUMAN_ROW_TABLE[row].frameCount }));
const RESIDENT_ROWS = new ResidentRows(RESIDENT_SPANS);

/**
 * Ground one walk cycle covers, in tiles. His figure is the rig drawn at his
 * height, and its stride runs across the profile at the rig's own depth
 * whatever his height, so the cycle covers the rig's own ground.
 */
export const DAVE_TILES_PER_WALK_CYCLE = WALK_GROUND_PER_CYCLE_PX / TILE_SIZE;

// ── Overhead clearance ───────────────────────────────────────────────────────

/**
 * How far the top of his hair stands above his tile's top edge, in tiles:
 * his look's own measure, which gate G21 re-measures off his standing cells.
 */
const DAVE_HEAD_LIFT_TILES = DAVE_LOOK.figureExtent.spriteTopAboveTilePx / TILE_SIZE;

/** The top of his art over the tile whose top edge is at `sy`, before a drawn row has been measured. */
export function daveHeadTop(sy: number, tileSize: number): number {
  return sy - DAVE_HEAD_LIFT_TILES * tileSize;
}

// ── The teleport's timing ────────────────────────────────────────────────────

const TELEPORT_IN_SECONDS = 1.1;
const TELEPORT_OUT_SECONDS = 0.8;
export const DAVE_TELEPORT_IN_FRAMES = Math.round(TELEPORT_IN_SECONDS * TICKS_PER_SECOND);
export const DAVE_TELEPORT_OUT_FRAMES = Math.round(TELEPORT_OUT_SECONDS * TICKS_PER_SECOND);

/** One teleport on one draw: which way he is going, and how far into it. */
export interface DaveTeleportDraw {
  readonly direction: 'in' | 'out';
  readonly elapsedFrames: number;
}

/** Everything his sprite needs to pick a picture. */
export interface DaveSpriteState {
  /** Walk-cycle angle in radians, advanced by the ground he has covered. */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  readonly isTalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /** The last left or right he faced, never 0: which way the profile is mirrored when he stands still. */
  readonly lastHorizontalFacing: number;
  /** Offset into the clock-driven loops, so his breathing is not in step with anyone else's. */
  readonly idleOffsetSeconds: number;
  /** The teleport under way, or null when he is drawn solid. */
  readonly teleport: DaveTeleportDraw | null;
}

// ── The teleport's figure-shaped layers ──────────────────────────────────────

/** He stands still, head-on, while the world builds him or takes him apart. */
const STILL_ROW: HumanRowName = DAVE_ROWS.idle.front;
/** The light-coloured slices and the edge ring are cut from one standing frame: they flicker for a few frames each, and a breath under them is invisible. */
const STILL_FRAME = 0;

type TeleportLayer = 'glitch' | 'edge';
const ONE_FRAME = 1;
const TELEPORT_LAYER_FRAMES: Readonly<Record<TeleportLayer, number>> = {
  glitch: ONE_FRAME,
  edge: ONE_FRAME,
};

/**
 * How strongly a glitching slice is washed in the light's colour: enough
 * that it reads as light rather than as him, little enough that his shape
 * and the folds of his jacket still show through it.
 */
const GLITCH_TINT_ALPHA = 0.72;
/** The edge ring's width, in cell pixels: one screen pixel at the 32 px tile. */
const EDGE_RING_CELL_PX = 2;
/** Directions the silhouette is stamped in to grow it into the ring. */
const EDGE_RING_SAMPLES = 8;
const FULL_TURN = Math.PI * 2;

/** Paints his still frame onto a fresh surface at `density`, for one of the teleport layers to be cut from. */
function paintStillFrame(density: number, width: number, height: number) {
  const surface = allocCanvas('figureScratch', width, height);
  const ctx = surfaceContext(surface);
  ctx.setTransform(density, 0, 0, density, 0, 0);
  DAVE_FIGURE.def.paintFrame(ctx, STILL_ROW, STILL_FRAME);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return surface;
}

function paintGlitchLayer(ctx: CanvasRenderingContext2D, density: number): void {
  const width = Math.ceil(DAVE_FIGURE.def.frameWidth * density);
  const height = Math.ceil(DAVE_FIGURE.def.frameHeight * density);
  const body = paintStillFrame(density, width, height);
  try {
    const bodyCtx = surfaceContext(body);
    bodyCtx.globalCompositeOperation = 'source-atop';
    bodyCtx.globalAlpha = GLITCH_TINT_ALPHA;
    bodyCtx.fillStyle = worldPalette.daveTeleport.glow;
    bodyCtx.fillRect(0, 0, width, height);
    ctx.drawImage(body, 0, 0, width, height, 0, 0, width / density, height / density);
  } finally {
    releaseSurface(body);
  }
}

function paintEdgeLayer(ctx: CanvasRenderingContext2D, density: number): void {
  const width = Math.ceil(DAVE_FIGURE.def.frameWidth * density);
  const height = Math.ceil(DAVE_FIGURE.def.frameHeight * density);
  const body = paintStillFrame(density, width, height);
  const ring = allocCanvas('figureScratch', width, height);
  try {
    const ringCtx = surfaceContext(ring);
    const reach = EDGE_RING_CELL_PX * density;
    for (let i = 0; i < EDGE_RING_SAMPLES; i++) {
      const angle = (i / EDGE_RING_SAMPLES) * FULL_TURN;
      ringCtx.drawImage(body, Math.cos(angle) * reach, Math.sin(angle) * reach);
    }
    ringCtx.globalCompositeOperation = 'source-in';
    ringCtx.fillStyle = worldPalette.daveTeleport.core;
    ringCtx.fillRect(0, 0, width, height);
    ringCtx.globalCompositeOperation = 'destination-out';
    ringCtx.drawImage(body, 0, 0);
    ctx.drawImage(ring, 0, 0, width, height, 0, 0, width / density, height / density);
  } finally {
    releaseSurface(ring);
    releaseSurface(body);
  }
}

function isTeleportLayer(state: string): state is TeleportLayer {
  return state === 'glitch' || state === 'edge';
}

/**
 * The teleport's two pictures of him, cut from his still frame: that frame
 * washed in the light's colour, and a ring of the light round its edge. Each
 * is painted at the density the cache bakes at, onto surfaces of that
 * density, so the ring stays one screen pixel wide at any bake.
 */
const DAVE_TELEPORT_FIGURE: FigureDef = {
  id: `${DAVE_FIGURE.def.id}:teleport`,
  frameWidth: DAVE_FIGURE.def.frameWidth,
  frameHeight: DAVE_FIGURE.def.frameHeight,
  tileX: DAVE_FIGURE.def.tileX,
  tileY: DAVE_FIGURE.def.tileY,
  tileScale: DAVE_FIGURE.def.tileScale,
  states: figureStates(TELEPORT_LAYER_FRAMES),
  skipSupersample: true,
  paintFrame: (ctx, state) => {
    if (!isTeleportLayer(state)) return;
    const { a, b, c, d } = ctx.getTransform();
    const density = Math.sqrt(Math.abs(a * d - b * c));
    if (state === 'glitch') paintGlitchLayer(ctx, density);
    else paintEdgeLayer(ctx, density);
  },
};

const TELEPORT_SPANS: readonly ResidentSpan[] = (['glitch', 'edge'] as const).map((row) => ({
  row,
  frames: ONE_FRAME,
}));
const TELEPORT_RESIDENT = new ResidentRows(TELEPORT_SPANS);

// ── The teleport's layout ────────────────────────────────────────────────────

/** Where his figure stands in his cell, in cell pixels: his soles on the ground point, his hair's top above his tile. */
const CELL = DAVE_FIGURE.def;
const SOLE_CELL_Y = ORIGIN_Y;
const HEAD_CELL_Y = CELL.tileY - DAVE_HEAD_LIFT_TILES * CELL.tileScale;
const FIGURE_CENTRE_CELL_X = CELL.tileX + CELL.tileScale / 2;

/** The bands he is built in, feet first; the lowest and highest run on to the cell's edges so nothing of him is ever left out. */
const BAND_COUNT = 9;
const LAST_BAND = BAND_COUNT - 1;
const BAND_EDGES_CELL_Y: readonly number[] = Array.from({ length: BAND_COUNT + 1 }, (_, i) => {
  if (i === 0) return CELL.frameHeight;
  if (i === BAND_COUNT) return 0;
  return lerp(SOLE_CELL_Y, HEAD_CELL_Y, i / BAND_COUNT);
});

/** The column starts this far above his head, in tiles: it comes from somewhere, not out of his hair. */
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
/** On some jumps a slice shows as him rather than as light, so it flickers between the two. */
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

/** The edge flash's peak strength, and how strongly his body is washed in light under it. */
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
 * him, the bands lift away from the head down, and the column draws up off
 * the floor after the last of him.
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

// ── Drawing the teleport ─────────────────────────────────────────────────────

/** Where one draw of him lands on screen. */
interface Placement {
  readonly ctx: CanvasRenderingContext2D;
  readonly sx: number;
  readonly sy: number;
  readonly tileSize: number;
  /** Screen pixels per cell pixel. */
  readonly scale: number;
}

function screenY(place: Placement, cellY: number): number {
  return place.sy + (cellY - CELL.tileY) * place.scale;
}

function screenX(place: Placement, cellX: number): number {
  return place.sx + (cellX - CELL.tileX) * place.scale;
}

/** One draw's band picture: how it shows, its sideways throw and lift, and its strength. */
type BandLook = 'hidden' | 'solid' | 'light';

const reusedFade: { alpha: number } = { alpha: 1 };

/** Draws band `index` of a figure layer, thrown `dx` sideways and lifted `lift`, at `alpha`. */
function drawBand(
  place: Placement,
  def: FigureDef,
  state: string,
  frame: number,
  index: number,
  dx: number,
  lift: number,
  alpha: number,
): void {
  const bottom = Math.round(screenY(place, BAND_EDGES_CELL_Y[index] ?? 0) - lift);
  const top = Math.round(screenY(place, BAND_EDGES_CELL_Y[index + 1] ?? 0) - lift);
  if (bottom <= top || alpha <= 0) return;
  const { ctx } = place;
  ctx.save();
  ctx.beginPath();
  ctx.rect(screenX(place, 0) + dx, top, CELL.frameWidth * place.scale, bottom - top);
  ctx.clip();
  reusedFade.alpha = Math.min(1, alpha);
  drawFigureCached(
    ctx,
    def,
    state,
    frame,
    place.sx + dx,
    place.sy - lift,
    place.tileSize,
    reusedFade,
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

/** The column of light from above his head down to `bottomCellY`, at `strength`. */
function drawBeam(place: Placement, topCellY: number, bottomCellY: number, strength: number): void {
  if (strength <= 0) return;
  const { ctx, tileSize } = place;
  const centre = screenX(place, FIGURE_CENTRE_CELL_X);
  const top = screenY(place, topCellY);
  const bottom = screenY(place, bottomCellY);
  const glowWidth = Math.max(BEAM_MIN_GLOW_PX, Math.round(BEAM_GLOW_WIDTH_TILES * tileSize));
  const coreWidth = Math.max(BEAM_MIN_CORE_PX, Math.round(BEAM_CORE_WIDTH_TILES * tileSize));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRect(
    ctx,
    worldPalette.daveTeleport.glow,
    strength * BEAM_GLOW_ALPHA,
    Math.round(centre - glowWidth / 2),
    top,
    glowWidth,
    bottom - top,
  );
  drawRect(
    ctx,
    worldPalette.daveTeleport.beam,
    strength,
    Math.round(centre - (coreWidth * BEAM_WIDTH_PER_CORE) / 2),
    top,
    coreWidth * BEAM_WIDTH_PER_CORE,
    bottom - top,
  );
  drawRect(
    ctx,
    worldPalette.daveTeleport.core,
    strength,
    Math.round(centre - coreWidth / 2),
    top,
    coreWidth,
    bottom - top,
  );
  ctx.restore();
}

/** The flat pool of light the column makes where it meets the floor. */
function drawPool(place: Placement, strength: number, spread: number): void {
  if (strength <= 0) return;
  const { ctx, tileSize } = place;
  const centreX = screenX(place, FIGURE_CENTRE_CELL_X);
  const centreY = screenY(place, SOLE_CELL_Y);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, strength * POOL_ALPHA);
  ctx.fillStyle = worldPalette.daveTeleport.glow;
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
function drawMotes(
  place: Placement,
  index: number,
  progress: number,
  rise: number,
  tick: number,
): void {
  if (progress <= 0 || progress >= 1) return;
  const { ctx, tileSize } = place;
  const centre = screenX(place, FIGURE_CENTRE_CELL_X);
  const bandBottom = screenY(place, BAND_EDGES_CELL_Y[index] ?? 0);
  const bandTop = screenY(place, BAND_EDGES_CELL_Y[index + 1] ?? 0);
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
      bright ? worldPalette.daveTeleport.core : worldPalette.daveTeleport.beam,
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
 * Whether a glitching slice shows as him on this tick. The chance follows
 * how much of him the slice still is, so a slice never flickers back to him
 * once it has mostly turned to light.
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

function drawGlitchingBand(
  place: Placement,
  index: number,
  tick: number,
  throwLeft: number,
  lift: number,
  alpha: number,
  idleFrame: number,
): BandLook {
  const dx = glitchThrow(index, tick, throwLeft, place.tileSize);
  if (glitchShowsSolid(index, tick, 1 - throwLeft)) {
    drawBand(place, DAVE_FIGURE.def, STILL_ROW, idleFrame, index, dx, lift, alpha);
    return 'solid';
  }
  drawBand(place, DAVE_TELEPORT_FIGURE, 'glitch', 0, index, dx, lift, alpha);
  return 'light';
}

/** Draws the world building him; true when any band of him was drawn. */
function drawTeleportIn(place: Placement, elapsed: number, idleFrame: number): boolean {
  const p = clamp01(elapsed / DAVE_TELEPORT_IN_FRAMES);
  const tick = Math.floor(elapsed);
  const beamTop = HEAD_CELL_Y - BEAM_ABOVE_HEAD_TILES * CELL.tileScale;
  const landed = ramp(p, 0, IN_BEAM_LANDS);
  const beamTip = lerp(beamTop, SOLE_CELL_Y, landed);
  const beamStrength = p < IN_BEAM_FADE_FROM ? 1 : 1 - ramp(p, IN_BEAM_FADE_FROM, IN_BEAM_GONE);

  const poolRise = ramp(p, IN_BEAM_LANDS, IN_BANDS_START + IN_BAND_GLITCH);
  const poolStrength =
    p < IN_BEAM_LANDS ? 0 : poolRise * (1 - ramp(p, IN_BANDS_START, IN_POOL_FADES));
  const span = IN_BANDS_END - IN_BANDS_START - IN_BAND_GLITCH;
  const bandStart = (index: number): number => IN_BANDS_START + span * bandShare(index);
  let front = SOLE_CELL_Y;
  for (let index = 0; index < BAND_COUNT && p >= bandStart(index); index++) {
    front = Math.max(BAND_EDGES_CELL_Y[index + 1] ?? front, HEAD_CELL_Y);
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
      drawBand(place, DAVE_FIGURE.def, STILL_ROW, idleFrame, index, 0, 0, 1);
      continue;
    }
    drawGlitchingBand(place, index, tick, 1 - settle, 0, 1, idleFrame);
    drawMotes(place, index, settle, 0, tick);
  }

  const flash = flashCurve((p - IN_FLASH_FROM) / (IN_FLASH_TO - IN_FLASH_FROM));
  if (flash > 0) {
    drawFigureLayer(place, 'glitch', flash * BODY_FLASH_ALPHA);
    drawFigureLayer(place, 'edge', flash * EDGE_FLASH_ALPHA);
  }
  return drawnAny;
}

/** Draws the world taking him apart; true when any band of him was drawn. */
function drawTeleportOut(place: Placement, elapsed: number, idleFrame: number): boolean {
  const p = clamp01(elapsed / DAVE_TELEPORT_OUT_FRAMES);
  const tick = Math.floor(elapsed);
  const beamTop = HEAD_CELL_Y - BEAM_ABOVE_HEAD_TILES * CELL.tileScale;
  const span = OUT_BANDS_END - OUT_BANDS_START - OUT_BAND_DISSOLVE;
  const bandStart = (index: number): number =>
    OUT_BANDS_START + span * bandShare(BAND_COUNT - 1 - index);
  let remainingTop = SOLE_CELL_Y;
  for (let index = 0; index < BAND_COUNT; index++) {
    const top = Math.max(BAND_EDGES_CELL_Y[index + 1] ?? remainingTop, HEAD_CELL_Y);
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
      drawBand(place, DAVE_FIGURE.def, STILL_ROW, idleFrame, index, 0, 0, 1);
      drawnAny = true;
      continue;
    }
    const gone = clamp01((p - start) / OUT_BAND_DISSOLVE);
    if (gone >= 1) continue;
    const lift = easeInOut(gone) * BAND_LIFT_TILES * place.tileSize;
    drawGlitchingBand(place, index, tick, gone, lift, 1 - easeInOut(gone), idleFrame);
    drawMotes(place, index, gone, MOTE_RISE_TILES, tick);
    drawnAny = true;
  }

  const flash = p < OUT_FLASH_TO ? flashCurve(1 - p / OUT_FLASH_TO) : 0;
  if (flash > 0) {
    drawFigureLayer(place, 'glitch', flash * BODY_FLASH_ALPHA);
    drawFigureLayer(place, 'edge', flash * EDGE_FLASH_ALPHA);
  }
  return drawnAny;
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

/** Lays one of the light pictures of him over him, adding its light rather than covering him. */
function drawFigureLayer(place: Placement, layer: TeleportLayer, alpha: number): void {
  if (alpha <= 0) return;
  place.ctx.save();
  place.ctx.globalCompositeOperation = 'lighter';
  reusedFade.alpha = Math.min(1, alpha);
  drawFigureCached(
    place.ctx,
    DAVE_TELEPORT_FIGURE,
    layer,
    0,
    place.sx,
    place.sy,
    place.tileSize,
    reusedFade,
  );
  place.ctx.restore();
}

// ── The draw ─────────────────────────────────────────────────────────────────

function idleTicks(state: DaveSpriteState): number {
  return Math.floor(
    (performance.now() / MS_PER_SECOND + state.idleOffsetSeconds) * TICKS_PER_SECOND,
  );
}
const MS_PER_SECOND = 1000;

function clockFrame(row: HumanRowName, ticks: number): number {
  const meta = HUMAN_ROW_TABLE[row];
  return rowFrameAtTicks(meta, ticks % rowLengthInTicks(meta));
}

function rowOf(state: DaveSpriteState): DaveRow {
  if (state.isWalking) return 'walk';
  return state.isTalking ? 'talk' : 'idle';
}

/**
 * Draws Dave standing on the tile whose top-left is `(sx, sy)` and returns the
 * row drawn, for `figureRowInkTop`; undefined while a teleport shows none of
 * him yet. Only the profile is mirrored, so his jacket never swaps sides.
 */
export function drawDaveSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: DaveSpriteState,
): DrawnFigureRow | undefined {
  RESIDENT_ROWS.hold(DAVE_FIGURE.def);
  const ticks = idleTicks(state);
  const teleport = state.teleport;
  if (teleport !== null) {
    TELEPORT_RESIDENT.hold(DAVE_TELEPORT_FIGURE);
    const place: Placement = { ctx, sx, sy, tileSize, scale: tileSize / CELL.tileScale };
    const idleFrame = clockFrame(STILL_ROW, ticks);
    ctx.save();
    const drawn =
      teleport.direction === 'in'
        ? drawTeleportIn(place, teleport.elapsedFrames, idleFrame)
        : drawTeleportOut(place, teleport.elapsedFrames, idleFrame);
    ctx.restore();
    return drawn ? drawnFigureRow(DAVE_FIGURE.def, STILL_ROW) : undefined;
  }

  const facing = selectCardinalFacing(state.facingX, state.facingY);
  const painted = rowOf(state);
  const row = viewRow(DAVE_ROWS[painted], facing.view);
  const meta = HUMAN_ROW_TABLE[row];
  const frame =
    painted === 'walk' ? walkFrameIndex(state.walkPhase, meta.frameCount) : clockFrame(row, ticks);
  const horizontal = state.facingX !== 0 ? state.facingX : state.lastHorizontalFacing;
  drawHumanFigureSelection(
    ctx,
    DAVE_FIGURE,
    sx,
    sy,
    tileSize,
    { row, frame, flipX: meta.mirrorable && facing.view === 'side' && horizontal < 0 },
    null,
  );
  return drawnFigureRow(DAVE_FIGURE.def, row);
}

/**
 * Queues every row he is drawn in and the teleport's two pictures of him for
 * baking. Call when his scene loads, and again when a teleport is scheduled:
 * a picture not drawn within the cache's release window is let go.
 */
export function prewarmDaveSprite(): void {
  for (const span of RESIDENT_SPANS) prewarmFigureState(DAVE_FIGURE.def, span.row);
  for (const span of TELEPORT_SPANS) prewarmFigureState(DAVE_TELEPORT_FIGURE, span.row);
}
