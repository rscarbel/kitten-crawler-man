import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import { dungeonFloorTheme } from '../../dungeon/floorTheme';
import { NoiseField, hashLattice } from '../../tilegen/noise';
import { drawGroundTile } from '../groundTiles';
import { Surface, type RGB } from '../../tilegen/raster';
import type { TileContent } from '../../tileTypes';
import { ARENA_CAGE, ARENA_FLOOR, ARENA_MUD, METAL_WALL } from '../../tileTypes';
import {
  COLOSSEUM_DOOR_OPENING,
  COLOSSEUM_FOOTING_RADIUS_TILES,
  COLOSSEUM_OUTER_RADIUS_TILES,
  COLOSSEUM_SAND_RADIUS_TILES,
  colosseumCapInnerRadius,
  colosseumCapOuterRadius,
  colosseumLayoutAt,
  type ColosseumLayout,
  type ColosseumSpectatorSeat,
} from './colosseumGeometry';

/**
 * The Iron Colosseum, painted tile by tile against its true circles.
 *
 * Every tile of the drum — sand, wall, cage, and the concourse tiles its outer
 * edge cuts through — paints the whole ring in arena-local coordinates and is
 * clipped to its own cell. The chunk bake then assembles one smooth ring out of
 * square tiles at no per-frame cost, and a tile's picture is decided by where it
 * is on the circle, never by which neighbour happens to be a wall.
 */

// ── Palette ─────────────────────────────────────────────────────────────────

/**
 * The sand's middle tone, exported so the ball's contrast gate measures the
 * floor the game actually draws. Kept dark on purpose: a pink ball has to pop
 * off it at 32px, which a bright beach-coloured sand would not allow.
 */
export const ARENA_SAND_TONE = '#34281d';
const SAND_DARK: RGB = [29, 21, 15];
const SAND_MID: RGB = [52, 40, 29];
const SAND_LIGHT: RGB = [80, 63, 44];
const SAND_GRIT_LIGHT: RGB = [104, 86, 62];
const SAND_GRIT_DARK: RGB = [24, 18, 14];

const IRON_FACE = '#1f2328';
const IRON_FACE_FOOT = '#121418';
const IRON_FACE_LIT = '#3d434c';
const IRON_CAP = '#474d57';
const IRON_CAP_LIT = '#6e7783';
const IRON_CAP_DARK = '#2a2e35';
const IRON_SEAM = '#15171b';
const IRON_OUTER_FACE = '#1d2126';
/** The footing's slope: near-black where it meets the sand, lit iron where it meets the wall. */
const FOOTING_TOE = '#191c21';
const FOOTING_TOP = '#434953';
const RIVET = '#737c88';
const RIVET_SHADOW = '#0d0f12';
const RUST = '#7a3f1c';
const OLD_BLOOD = '#3d1c0f';
const OLD_BLOOD_DARK = '#250e06';
/** Blood dried on iron goes darker and bluer than blood soaked into sand. */
const IRON_BLOOD = '#4a0f1c';
const STRAW = '#8a7a4a';
const THRESHOLD_STONE = '#403b36';
const THRESHOLD_GROOVE = '#141210';
const CROWD_HEAD = '#262127';
const CROWD_RIM = '#8d93a3';
/** Shirt colours of the three crowd palettes, shared with the live cheering sprites. */
export const COLOSSEUM_CROWD_SHIRTS: readonly string[] = ['#5c1f33', '#23324a', '#2c4a33'];
const CROWD_SHADOW = 'rgba(0,0,0,0.45)';

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Sand texture ────────────────────────────────────────────────────────────

/** Tiles across the tileable sand texture; the pattern repeats this often. */
const SAND_TEXTURE_TILES = 4;
const SAND_MOTTLE_PERIOD = 4;
const SAND_MOTTLE_OCTAVES = 3;
const SAND_DRIFT_PERIOD = 2;
const SAND_MOTTLE_SEED = 311;
/** How much of the sand's tone is fine mottling rather than broad drifts. */
const SAND_MOTTLE_SHARE = 0.75;
const SAND_DRIFT_SEED = 313;
const SAND_GRIT_SEED = 317;
const SAND_PEBBLE_SEED = 331;
/** Pebbles per texture side. */
const SAND_PEBBLE_CELLS = 10;
const SAND_PEBBLE_JITTER = 0.8;
/** Share of a pebble cell a pebble fills, as a distance in cell units. */
const SAND_PEBBLE_SIZE = 0.13;
const SAND_PEBBLE_SHADOW_SIZE = 0.18;
/** How often a pixel is a light or dark grain of grit. */
const SAND_GRIT_LIGHT_CHANCE = 0.06;
const SAND_GRIT_DARK_CHANCE = 0.94;
const SAND_GRIT_ALPHA = 0.45;
const SAND_PEBBLE_ALPHA = 0.6;
const SAND_PEBBLE_SHADOW_ALPHA = 0.35;
/** Pixel offset of a pebble's shadow, down and to the right of it. */
const SAND_PEBBLE_SHADOW_OFFSET = 1;

const sandTextures = new Map<number, CanvasSurface>();

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}

/**
 * A tileable square of trampled sand, painted once per tile size.
 *
 * Seamless because every noise term wraps at the texture's edge, which is what
 * lets a floor of any size be laid from one small texture with no visible repeat
 * seam — and cheap because it is one blit per tile afterwards.
 */
function sandTexture(ts: number): CanvasSurface {
  const cached = sandTextures.get(ts);
  if (cached !== undefined) return cached;
  const size = Math.max(1, Math.round(ts * SAND_TEXTURE_TILES));
  const surface = new Surface(size);
  const noise = new NoiseField(size);
  surface.fill((x, y) => {
    const mottle = noise.fbm(x, y, SAND_MOTTLE_SEED, SAND_MOTTLE_OCTAVES, SAND_MOTTLE_PERIOD);
    const drift = noise.value(x, y, SAND_DRIFT_PERIOD, SAND_DRIFT_SEED);
    const tone = mottle * SAND_MOTTLE_SHARE + drift * (1 - SAND_MOTTLE_SHARE);
    const base =
      tone < HALF
        ? lerpRgb(SAND_DARK, SAND_MID, tone * 2)
        : lerpRgb(SAND_MID, SAND_LIGHT, (tone - HALF) * 2);
    const grit = hashLattice(x, y, SAND_GRIT_SEED);
    if (grit < SAND_GRIT_LIGHT_CHANCE) return lerpRgb(base, SAND_GRIT_LIGHT, SAND_GRIT_ALPHA);
    if (grit > SAND_GRIT_DARK_CHANCE) return lerpRgb(base, SAND_GRIT_DARK, SAND_GRIT_ALPHA);
    return base;
  });
  const cell = size / SAND_PEBBLE_CELLS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pebble = noise.worley(x, y, SAND_PEBBLE_CELLS, SAND_PEBBLE_SEED, SAND_PEBBLE_JITTER);
      const shadow = noise.worley(
        x - SAND_PEBBLE_SHADOW_OFFSET,
        y - SAND_PEBBLE_SHADOW_OFFSET,
        SAND_PEBBLE_CELLS,
        SAND_PEBBLE_SEED,
        SAND_PEBBLE_JITTER,
      );
      if (pebble.nearest < SAND_PEBBLE_SIZE * cell) {
        surface.blend(x, y, SAND_GRIT_LIGHT, SAND_PEBBLE_ALPHA);
      } else if (shadow.nearest < SAND_PEBBLE_SHADOW_SIZE * cell) {
        surface.blend(x, y, SAND_GRIT_DARK, SAND_PEBBLE_SHADOW_ALPHA);
      }
    }
  }
  const canvas = allocCanvas(size, size);
  const textureCtx = surfaceContext(canvas);
  const image = textureCtx.createImageData(size, size);
  image.data.set(surface.toRgba());
  textureCtx.putImageData(image, 0, 0);
  sandTextures.set(ts, canvas);
  return canvas;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Lays the sand texture over a cell, at the cell's own place in the repeat. */
function drawSandBase(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const texture = sandTexture(ts);
  const cellPx = texture.width / SAND_TEXTURE_TILES;
  const srcX = positiveMod(tx, SAND_TEXTURE_TILES) * cellPx;
  const srcY = positiveMod(ty, SAND_TEXTURE_TILES) * cellPx;
  ctx.drawImage(texture, srcX, srcY, cellPx, cellPx, sx, sy, ts, ts);
}

/** The sand texture again, laid inside an arena frame for the part of a wall tile the sand reaches. */
function drawSandTextureInFrame(
  ctx: CanvasRenderingContext2D,
  frame: CellFrame,
  ts: number,
  tx: number,
  ty: number,
): void {
  const texture = sandTexture(ts);
  const cellPx = texture.width / SAND_TEXTURE_TILES;
  const srcX = positiveMod(tx, SAND_TEXTURE_TILES) * cellPx;
  const srcY = positiveMod(ty, SAND_TEXTURE_TILES) * cellPx;
  ctx.drawImage(texture, srcX, srcY, cellPx, cellPx, frame.cx - HALF, frame.cy - HALF, 1, 1);
}

// ── Arena-local framing ─────────────────────────────────────────────────────

/** What a cell covers, in arena-local tiles. */
interface CellFrame {
  readonly layout: ColosseumLayout;
  /** Arena-local centre of the cell. */
  readonly cx: number;
  readonly cy: number;
  readonly nearRadius: number;
  readonly farRadius: number;
  readonly angleFrom: number;
  readonly angleTo: number;
}

/** Slack added round a cell's bearing span so a detail straddling its edge is still drawn. */
const CELL_ANGLE_SLACK = 0.05;

function cellFrame(layout: ColosseumLayout, tx: number, ty: number): CellFrame {
  const cx = tx - layout.centreTileX;
  const cy = ty - layout.centreTileY;
  const clampedX = Math.max(cx - HALF, Math.min(cx + HALF, 0));
  const clampedY = Math.max(cy - HALF, Math.min(cy + HALF, 0));
  const nearRadius = Math.hypot(clampedX, clampedY);
  let farRadius = 0;
  const centreAngle = Math.atan2(cy, cx);
  let lowest = 0;
  let highest = 0;
  for (const [dx, dy] of CORNERS) {
    const cornerX = cx + dx;
    const cornerY = cy + dy;
    farRadius = Math.max(farRadius, Math.hypot(cornerX, cornerY));
    const offset = wrapAngle(Math.atan2(cornerY, cornerX) - centreAngle);
    lowest = Math.min(lowest, offset);
    highest = Math.max(highest, offset);
  }
  const containsCentre = nearRadius === 0;
  return {
    layout,
    cx,
    cy,
    nearRadius,
    farRadius,
    angleFrom: containsCentre ? -Math.PI : centreAngle + lowest - CELL_ANGLE_SLACK,
    angleTo: containsCentre ? Math.PI : centreAngle + highest + CELL_ANGLE_SLACK,
  };
}

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-HALF, -HALF],
  [HALF, -HALF],
  [-HALF, HALF],
  [HALF, HALF],
];

function wrapAngle(angle: number): number {
  return angle - FULL_TURN * Math.round(angle / FULL_TURN);
}

/** Every multiple of `pitch` (offset by `phase`) between two bearings, however they wrap. */
function anglesOnPitch(from: number, to: number, pitch: number, phase = 0): number[] {
  const angles: number[] = [];
  const first = Math.ceil((from - phase) / pitch);
  const last = Math.floor((to - phase) / pitch);
  for (let step = first; step <= last; step++) angles.push(phase + step * pitch);
  return angles;
}

/**
 * Runs `paint` clipped to one cell with the origin moved to the arena's centre
 * and one unit per tile, so everything inside can be drawn in arena terms.
 */
function inArenaFrame(
  ctx: CanvasRenderingContext2D,
  frame: CellFrame,
  sx: number,
  sy: number,
  ts: number,
  paint: () => void,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    ctx.translate(sx + (HALF - frame.cx) * ts, sy + (HALF - frame.cy) * ts);
    ctx.scale(ts, ts);
    paint();
  } finally {
    ctx.restore();
  }
}

/** Radians per sample along a curved edge: fine enough that no facet shows at the wall's radius. */
const ARC_SAMPLE_RADIANS = 0.01;

/**
 * Traces a band between two radius functions over a bearing span, as one
 * closed path: out along the outer edge, back along the inner.
 */
function traceBand(
  ctx: CanvasRenderingContext2D,
  from: number,
  to: number,
  inner: (angle: number) => number,
  outer: (angle: number) => number,
): void {
  const steps = Math.max(1, Math.ceil((to - from) / ARC_SAMPLE_RADIANS));
  ctx.beginPath();
  for (let step = 0; step <= steps; step++) {
    const angle = from + ((to - from) * step) / steps;
    const radius = outer(angle);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let step = steps; step >= 0; step--) {
    const angle = from + ((to - from) * step) / steps;
    const radius = inner(angle);
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
}

/** Cuts the door's opening out of whatever is drawn next, so no wall crosses it. */
function clipAwayDoorway(ctx: CanvasRenderingContext2D): void {
  const door = COLOSSEUM_DOOR_OPENING;
  const far = COLOSSEUM_OUTER_RADIUS_TILES + 1;
  ctx.beginPath();
  ctx.rect(-far, -far, far * 2, far * 2);
  // The opening as one outline — the one-tile mouth widening into the cut rows —
  // so the even-odd rule punches out exactly one hole.
  ctx.moveTo(door.mouthLeft, door.mouthTop);
  ctx.lineTo(door.mouthLeft, door.top);
  ctx.lineTo(door.left, door.top);
  ctx.lineTo(door.left, far);
  ctx.lineTo(door.right, far);
  ctx.lineTo(door.right, door.top);
  ctx.lineTo(door.mouthRight, door.top);
  ctx.lineTo(door.mouthRight, door.mouthTop);
  ctx.closePath();
  ctx.clip('evenodd');
}

// ── The sand ────────────────────────────────────────────────────────────────

/** How far in from the wall the sand darkens, and how dark it gets. */
const RIM_SHADE_DEPTH_TILES = 3.2;
const RIM_SHADE_ALPHA = 0.42;
/** The sharp contact shadow right at the foot of the iron. */
const CONTACT_SHADOW_DEPTH_TILES = 0.32;
const CONTACT_SHADOW_ALPHA = 0.6;
/** The far wall's face is tall and throws a longer shadow onto the sand below it. */
const FAR_WALL_SHADOW_EXTRA_TILES = 0.35;

/** Where the ball's endless circuit has scoured the sand, as a band of radii. */
const SCOUR_INNER_TILES = 9.6;
const SCOUR_OUTER_TILES = 12.4;
const SCOUR_GROOVES = 7;
const SCOUR_SEED = 409;
const SCOUR_GROOVE_ALPHA = 0.32;
const SCOUR_LIT_ALPHA = 0.16;
const SCOUR_GROOVE_WIDTH = 0.045;
/** Shortest and longest groove, as fractions of a turn. */
const SCOUR_MIN_SPAN = 0.08;
const SCOUR_SPAN_RANGE = 0.22;

/** Old stains soaked into the sand: arena-local centre, size and how many blots. */
interface Stain {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly seed: number;
}
const STAIN_COUNT = 16;
const STAIN_SEED = 419;
const STAIN_MIN_RADIUS_TILES = 2;
/** Stains keep off the door's approach, so the way in reads clean. */
const STAIN_MAX_RADIUS_TILES = 12;
const STAIN_MIN_SIZE = 0.35;
const STAIN_SIZE_RANGE = 0.6;
const STAIN_BLOTS = 6;
/** A stain's soaked edge and its darker heart: size, how far the blots spread, colour and strength. */
const STAIN_LAYERS: ReadonlyArray<{
  readonly scale: number;
  readonly spread: number;
  readonly color: string;
  readonly alpha: number;
}> = [
  { scale: 1, spread: 1, color: OLD_BLOOD, alpha: 0.34 },
  { scale: 0.55, spread: 0.5, color: OLD_BLOOD_DARK, alpha: 0.38 },
];
const STAIN_SPREAD = 0.7;
const STAIN_BLOT_MIN = 0.35;
const STAIN_BLOT_RANGE = 0.5;
const STAIN_ASPECT = 0.7;

const STAINS: readonly Stain[] = Array.from({ length: STAIN_COUNT }, (_, index) => {
  const angle = hashLattice(index, 0, STAIN_SEED) * FULL_TURN;
  const radius =
    STAIN_MIN_RADIUS_TILES +
    Math.sqrt(hashLattice(index, 1, STAIN_SEED)) *
      (STAIN_MAX_RADIUS_TILES - STAIN_MIN_RADIUS_TILES);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    size: STAIN_MIN_SIZE + hashLattice(index, 2, STAIN_SEED) * STAIN_SIZE_RANGE,
    seed: index,
  };
});

/** Hoof and boot scuffs, a few per tile. */
const SCUFFS_PER_TILE = 1;
const SCUFF_SEED = 433;
const SCUFF_CHANCE = 0.3;
const SCUFF_ALPHA = 0.2;
const SCUFF_RADIUS = 0.07;
const SCUFF_SPLIT = 0.05;
/** Stray straw, blown in from the cages. */
const STRAW_SEED = 443;
const STRAW_CHANCE = 0.35;
const STRAW_LENGTH = 0.22;
const STRAW_WIDTH = 0.03;
const STRAW_ALPHA = 0.55;

function drawSand(ctx: CanvasRenderingContext2D, frame: CellFrame, tx: number, ty: number): void {
  // The sand ends where the iron's footing begins.
  const sandRadius = COLOSSEUM_FOOTING_RADIUS_TILES;

  // The pit darkens toward the wall: the iron keeps the light off the edge.
  const rimShade = ctx.createRadialGradient(
    0,
    0,
    sandRadius - RIM_SHADE_DEPTH_TILES,
    0,
    0,
    sandRadius,
  );
  rimShade.addColorStop(0, 'rgba(0,0,0,0)');
  rimShade.addColorStop(1, `rgba(0,0,0,${RIM_SHADE_ALPHA})`);
  ctx.fillStyle = rimShade;
  ctx.fillRect(frame.cx - HALF, frame.cy - HALF, 1, 1);

  drawScour(ctx, frame);
  drawStains(ctx, frame);
  drawScuffs(ctx, frame, tx, ty);

  // The contact shadow, deeper under the tall far wall.
  if (frame.farRadius > sandRadius - CONTACT_SHADOW_DEPTH_TILES - FAR_WALL_SHADOW_EXTRA_TILES) {
    traceBand(
      ctx,
      frame.angleFrom,
      frame.angleTo,
      (angle) =>
        sandRadius -
        CONTACT_SHADOW_DEPTH_TILES -
        FAR_WALL_SHADOW_EXTRA_TILES * Math.max(0, -Math.sin(angle)),
      () => sandRadius,
    );
    const contact = ctx.createRadialGradient(
      0,
      0,
      sandRadius - CONTACT_SHADOW_DEPTH_TILES - FAR_WALL_SHADOW_EXTRA_TILES,
      0,
      0,
      sandRadius,
    );
    contact.addColorStop(0, 'rgba(0,0,0,0)');
    contact.addColorStop(1, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
    ctx.fillStyle = contact;
    ctx.fill();
  }
}

function drawScour(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  if (frame.farRadius < SCOUR_INNER_TILES || frame.nearRadius > SCOUR_OUTER_TILES) return;
  ctx.lineCap = 'round';
  for (let groove = 0; groove < SCOUR_GROOVES; groove++) {
    const radius =
      SCOUR_INNER_TILES +
      hashLattice(groove, 0, SCOUR_SEED) * (SCOUR_OUTER_TILES - SCOUR_INNER_TILES);
    if (radius < frame.nearRadius - HALF || radius > frame.farRadius + HALF) continue;
    const start = hashLattice(groove, 1, SCOUR_SEED) * FULL_TURN - Math.PI;
    const span =
      (SCOUR_MIN_SPAN + hashLattice(groove, 2, SCOUR_SEED) * SCOUR_SPAN_RANGE) * FULL_TURN;
    ctx.lineWidth = SCOUR_GROOVE_WIDTH;
    ctx.strokeStyle = `rgba(12,8,6,${SCOUR_GROOVE_ALPHA})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + span);
    ctx.stroke();
    ctx.strokeStyle = `rgba(150,120,90,${SCOUR_LIT_ALPHA})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius + SCOUR_GROOVE_WIDTH, start, start + span);
    ctx.stroke();
  }
}

/**
 * One soaked-in stain: its blots traced as a single outline and filled once, so
 * where they overlap reads as one patch rather than a stack of see-through
 * discs; then a darker, smaller heart where it pooled deepest.
 */
function drawStains(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  for (const stain of STAINS) {
    const reach = stain.size * (1 + STAIN_SPREAD) + HALF;
    if (
      Math.abs(stain.x - frame.cx) > reach + HALF ||
      Math.abs(stain.y - frame.cy) > reach + HALF
    ) {
      continue;
    }
    for (const layer of STAIN_LAYERS) {
      ctx.beginPath();
      for (let blot = 0; blot < STAIN_BLOTS; blot++) {
        const angle = hashLattice(stain.seed, blot, STAIN_SEED + 1) * FULL_TURN;
        const along =
          hashLattice(stain.seed, blot, STAIN_SEED + 2) * stain.size * STAIN_SPREAD * layer.spread;
        const radius =
          stain.size *
          layer.scale *
          (STAIN_BLOT_MIN + hashLattice(stain.seed, blot, STAIN_SEED + 3) * STAIN_BLOT_RANGE);
        const x = stain.x + Math.cos(angle) * along;
        const y = stain.y + Math.sin(angle) * along;
        ctx.moveTo(x + radius, y);
        ctx.ellipse(x, y, radius, radius * STAIN_ASPECT, angle, 0, FULL_TURN);
      }
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = layer.alpha;
      ctx.fill('nonzero');
    }
  }
  ctx.globalAlpha = 1;
}

function drawScuffs(ctx: CanvasRenderingContext2D, frame: CellFrame, tx: number, ty: number): void {
  for (let scuff = 0; scuff < SCUFFS_PER_TILE; scuff++) {
    if (hashLattice(tx, ty, SCUFF_SEED + scuff) > SCUFF_CHANCE) continue;
    const x = frame.cx - HALF + hashLattice(tx, ty, SCUFF_SEED + scuff + 10);
    const y = frame.cy - HALF + hashLattice(tx, ty, SCUFF_SEED + scuff + 20);
    const turn = hashLattice(tx, ty, SCUFF_SEED + scuff + 30) * FULL_TURN;
    // A cloven print: two halves either side of the split.
    ctx.fillStyle = `rgba(14,10,8,${SCUFF_ALPHA})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        x + Math.cos(turn + HALF * Math.PI) * SCUFF_SPLIT * side,
        y + Math.sin(turn + HALF * Math.PI) * SCUFF_SPLIT * side,
        SCUFF_RADIUS,
        SCUFF_RADIUS * STAIN_ASPECT,
        turn,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
  }
  if (hashLattice(tx, ty, STRAW_SEED) < STRAW_CHANCE) {
    const x = frame.cx - HALF + hashLattice(tx, ty, STRAW_SEED + 1);
    const y = frame.cy - HALF + hashLattice(tx, ty, STRAW_SEED + 2);
    const turn = hashLattice(tx, ty, STRAW_SEED + 3) * Math.PI;
    ctx.strokeStyle = STRAW;
    ctx.globalAlpha = STRAW_ALPHA;
    ctx.lineWidth = STRAW_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(turn) * STRAW_LENGTH * HALF, y - Math.sin(turn) * STRAW_LENGTH * HALF);
    ctx.lineTo(x + Math.cos(turn) * STRAW_LENGTH * HALF, y + Math.sin(turn) * STRAW_LENGTH * HALF);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ── The iron ────────────────────────────────────────────────────────────────

/** Angle between the wall's panel seams. A fixed pitch, so the panels follow the curve. */
const PANEL_PITCH_RADIANS = FULL_TURN / 56;
/** Rivets run at twice the seam pitch along each row. */
const RIVET_PITCH_RADIANS = PANEL_PITCH_RADIANS / 4;
const RIVET_RADIUS = 0.035;
const RIVET_SHADOW_OFFSET = 0.02;
const SEAM_WIDTH = 0.04;
/** The footing's bolts sit this far up its slope; its toe and lip are thin bands at either edge. */
const FOOTING_BOLT_SHARE = 0.55;
const FOOTING_TOE_WIDTH = 0.04;
const FOOTING_LIP_WIDTH = 0.035;
const FACE_FOOT_SHARE = 0.25;
const FACE_LIT_WIDTH = 0.06;
/** Heights up the inner face at which rivet rows run, as shares of its depth. */
const FACE_RIVET_ROWS: readonly number[] = [0.3, 0.78];
/** A rivet row needs this much face under it or it would sit on the lip. */
const FACE_RIVET_MIN_DEPTH = 0.3;
const CAP_RIVET_INSET = 0.12;
const CAP_LIT_WIDTH = 0.07;
const CAP_DARK_WIDTH = 0.05;
const OUTER_LIT_WIDTH = 0.05;
/** Rust bleeding down the face from a seam, on some seams. */
const RUST_SEED = 503;
const RUST_CHANCE = 0.4;
const RUST_ALPHA = 0.2;
const RUST_WIDTH_RADIANS = 0.022;
const RUST_MIN_LENGTH = 0.35;
const RUST_LENGTH_RANGE = 0.5;
/** Blood thrown up the inner face by past slams, on some panels. */
const SPLASH_SEED = 509;
const SPLASH_CHANCE = 0.3;
const SPLASH_ALPHA = 0.5;
const SPLASH_DROPS = 5;
const SPLASH_RADIUS = 0.07;
const SPLASH_SPREAD_RADIANS = 0.03;

function drawIron(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const foot = COLOSSEUM_FOOTING_RADIUS_TILES;
  const sand = COLOSSEUM_SAND_RADIUS_TILES;
  const outer = COLOSSEUM_OUTER_RADIUS_TILES;
  if (frame.farRadius < foot || frame.nearRadius > outer) return;
  const { angleFrom: from, angleTo: to } = frame;

  ctx.save();
  clipAwayDoorway(ctx);
  // Nothing of the iron — a splash, a rivet — may stray onto the sand or the paving.
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, FULL_TURN);
  ctx.arc(0, 0, foot, FULL_TURN, 0, true);
  ctx.clip();

  drawFooting(ctx, frame);

  // The inner face: dark plate standing up out of the sand.
  traceBand(ctx, from, to, () => sand, colosseumCapInnerRadius);
  ctx.fillStyle = IRON_FACE;
  ctx.fill();
  traceBand(
    ctx,
    from,
    to,
    () => sand,
    (angle) => sand + (colosseumCapInnerRadius(angle) - sand) * FACE_FOOT_SHARE,
  );
  ctx.fillStyle = IRON_FACE_FOOT;
  ctx.globalAlpha = HALF;
  ctx.fill();
  ctx.globalAlpha = 1;
  drawFaceDetail(ctx, frame);
  traceBand(
    ctx,
    from,
    to,
    (angle) => colosseumCapInnerRadius(angle) - FACE_LIT_WIDTH,
    colosseumCapInnerRadius,
  );
  ctx.fillStyle = IRON_FACE_LIT;
  ctx.fill();

  // The top of the wall.
  traceBand(ctx, from, to, colosseumCapInnerRadius, colosseumCapOuterRadius);
  ctx.fillStyle = IRON_CAP;
  ctx.fill();
  traceBand(
    ctx,
    from,
    to,
    colosseumCapInnerRadius,
    (angle) => colosseumCapInnerRadius(angle) + CAP_LIT_WIDTH,
  );
  ctx.fillStyle = IRON_CAP_LIT;
  ctx.fill();
  traceBand(
    ctx,
    from,
    to,
    (angle) => colosseumCapOuterRadius(angle) - CAP_DARK_WIDTH,
    colosseumCapOuterRadius,
  );
  ctx.fillStyle = IRON_CAP_DARK;
  ctx.fill();
  drawCapDetail(ctx, frame);

  // The outer face, dropping away to the concourse on the near side.
  traceBand(ctx, from, to, colosseumCapOuterRadius, () => outer);
  ctx.fillStyle = IRON_OUTER_FACE;
  ctx.fill();
  traceBand(
    ctx,
    from,
    to,
    colosseumCapOuterRadius,
    (angle) => colosseumCapOuterRadius(angle) + OUTER_LIT_WIDTH,
  );
  ctx.fillStyle = IRON_CAP_DARK;
  ctx.fill();
  ctx.restore();
}

/**
 * The sloped iron kick-plate at the wall's foot, from where a crawler's
 * shoulder stops up to the base of the wall proper: dark where it meets the
 * sand, catching the light as it rises, bolted along its middle.
 */
function drawFooting(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const foot = COLOSSEUM_FOOTING_RADIUS_TILES;
  const sand = COLOSSEUM_SAND_RADIUS_TILES;
  const { angleFrom: from, angleTo: to } = frame;
  traceBand(
    ctx,
    from,
    to,
    () => foot,
    () => sand,
  );
  const slope = ctx.createRadialGradient(0, 0, foot, 0, 0, sand);
  slope.addColorStop(0, FOOTING_TOE);
  slope.addColorStop(1, FOOTING_TOP);
  ctx.fillStyle = slope;
  ctx.fill();
  ctx.lineWidth = SEAM_WIDTH;
  ctx.strokeStyle = IRON_SEAM;
  for (const angle of anglesOnPitch(from, to, PANEL_PITCH_RADIANS)) {
    radialSegment(ctx, angle, foot, sand);
    ctx.stroke();
  }
  const boltRadius = foot + (sand - foot) * FOOTING_BOLT_SHARE;
  for (const angle of anglesOnPitch(from, to, PANEL_PITCH_RADIANS / 2, PANEL_PITCH_RADIANS / 4)) {
    rivet(ctx, angle, boltRadius);
  }
  traceBand(
    ctx,
    from,
    to,
    () => foot,
    () => foot + FOOTING_TOE_WIDTH,
  );
  ctx.fillStyle = IRON_FACE_FOOT;
  ctx.fill();
  traceBand(
    ctx,
    from,
    to,
    () => sand - FOOTING_LIP_WIDTH,
    () => sand,
  );
  ctx.fillStyle = IRON_FACE_LIT;
  ctx.fill();
}

function radialSegment(
  ctx: CanvasRenderingContext2D,
  angle: number,
  inner: number,
  outer: number,
): void {
  ctx.beginPath();
  ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
  ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
}

function rivet(ctx: CanvasRenderingContext2D, angle: number, radius: number): void {
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  ctx.fillStyle = RIVET_SHADOW;
  ctx.beginPath();
  ctx.arc(x + RIVET_SHADOW_OFFSET, y + RIVET_SHADOW_OFFSET, RIVET_RADIUS, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = RIVET;
  ctx.beginPath();
  ctx.arc(x, y, RIVET_RADIUS, 0, FULL_TURN);
  ctx.fill();
}

function panelIndex(angle: number): number {
  return Math.round(angle / PANEL_PITCH_RADIANS);
}

function drawFaceDetail(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const sand = COLOSSEUM_SAND_RADIUS_TILES;
  ctx.lineWidth = SEAM_WIDTH;
  ctx.strokeStyle = IRON_SEAM;
  for (const angle of anglesOnPitch(frame.angleFrom, frame.angleTo, PANEL_PITCH_RADIANS)) {
    const top = colosseumCapInnerRadius(angle);
    radialSegment(ctx, angle, sand, top);
    ctx.stroke();
    const panel = panelIndex(angle);
    if (hashLattice(panel, 0, RUST_SEED) < RUST_CHANCE) {
      // A drip: full width where it leaks from under the top, tapering down the face.
      const length =
        (top - sand) * (RUST_MIN_LENGTH + hashLattice(panel, 1, RUST_SEED) * RUST_LENGTH_RANGE);
      const tipAngle = angle + RUST_WIDTH_RADIANS * HALF;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * top, Math.sin(angle) * top);
      ctx.lineTo(
        Math.cos(angle + RUST_WIDTH_RADIANS) * top,
        Math.sin(angle + RUST_WIDTH_RADIANS) * top,
      );
      ctx.lineTo(Math.cos(tipAngle) * (top - length), Math.sin(tipAngle) * (top - length));
      ctx.closePath();
      ctx.fillStyle = RUST;
      ctx.globalAlpha = RUST_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  for (const angle of anglesOnPitch(
    frame.angleFrom,
    frame.angleTo,
    PANEL_PITCH_RADIANS,
    PANEL_PITCH_RADIANS / 2,
  )) {
    const depth = colosseumCapInnerRadius(angle) - sand;
    const panel = panelIndex(angle);
    if (hashLattice(panel, 0, SPLASH_SEED) < SPLASH_CHANCE) {
      ctx.fillStyle = IRON_BLOOD;
      ctx.globalAlpha = SPLASH_ALPHA;
      for (let drop = 0; drop < SPLASH_DROPS; drop++) {
        const spread =
          (hashLattice(panel, drop, SPLASH_SEED + 1) - HALF) * SPLASH_SPREAD_RADIANS * 2;
        const height =
          hashLattice(panel, drop, SPLASH_SEED + 2) * Math.max(depth, FACE_RIVET_MIN_DEPTH);
        const radius = SPLASH_RADIUS * (HALF + hashLattice(panel, drop, SPLASH_SEED + 3));
        ctx.beginPath();
        ctx.arc(
          Math.cos(angle + spread) * (sand + height),
          Math.sin(angle + spread) * (sand + height),
          radius,
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (depth < FACE_RIVET_MIN_DEPTH) continue;
    for (const share of FACE_RIVET_ROWS) rivet(ctx, angle, sand + depth * share);
  }
}

function drawCapDetail(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  ctx.lineWidth = SEAM_WIDTH;
  ctx.strokeStyle = IRON_SEAM;
  for (const angle of anglesOnPitch(frame.angleFrom, frame.angleTo, PANEL_PITCH_RADIANS)) {
    radialSegment(ctx, angle, colosseumCapInnerRadius(angle), colosseumCapOuterRadius(angle));
    ctx.stroke();
  }
  for (const angle of anglesOnPitch(
    frame.angleFrom,
    frame.angleTo,
    RIVET_PITCH_RADIANS,
    RIVET_PITCH_RADIANS / 2,
  )) {
    rivet(ctx, angle, colosseumCapInnerRadius(angle) + CAP_RIVET_INSET);
    rivet(ctx, angle, colosseumCapOuterRadius(angle) - CAP_RIVET_INSET);
  }
}

// ── The crowd ───────────────────────────────────────────────────────────────

/** A seated spectator's shape, in tiles. */
const SPECTATOR_SHOULDER_WIDTH = 0.3;
const SPECTATOR_SHOULDER_HEIGHT = 0.15;
const SPECTATOR_HEAD_RADIUS = 0.095;
const SPECTATOR_HEAD_LIFT = 0.22;
const SPECTATOR_SHADOW_WIDTH = 0.18;
const SPECTATOR_SHADOW_HEIGHT = 0.06;
const SPECTATOR_RIM_WIDTH = 0.025;
/** The rim light runs round the top-left of the head, where the light comes from. */
const SPECTATOR_RIM_FROM = Math.PI * 1.1;
const SPECTATOR_RIM_TO = Math.PI * 1.7;
/** How far past a cell a spectator can reach, so one straddling two cells is drawn by both. */
const SPECTATOR_REACH = 0.35;

/**
 * Paints one seated spectator, feet at (x, y) in the current units. Shared with
 * the cheering sprites, which draw the same body with its arms up.
 */
export function drawColosseumSpectator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  variant: number,
): void {
  const shirt = COLOSSEUM_CROWD_SHIRTS[variant % COLOSSEUM_CROWD_SHIRTS.length];
  ctx.fillStyle = CROWD_SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, y, SPECTATOR_SHADOW_WIDTH * unit, SPECTATOR_SHADOW_HEIGHT * unit, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y - SPECTATOR_SHOULDER_HEIGHT * unit * HALF,
    SPECTATOR_SHOULDER_WIDTH * unit * HALF,
    SPECTATOR_SHOULDER_HEIGHT * unit,
    0,
    Math.PI,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = CROWD_HEAD;
  ctx.beginPath();
  ctx.arc(x, y - SPECTATOR_HEAD_LIFT * unit, SPECTATOR_HEAD_RADIUS * unit, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = CROWD_RIM;
  ctx.lineWidth = SPECTATOR_RIM_WIDTH * unit;
  ctx.beginPath();
  ctx.arc(
    x,
    y - SPECTATOR_HEAD_LIFT * unit,
    SPECTATOR_HEAD_RADIUS * unit,
    SPECTATOR_RIM_FROM,
    SPECTATOR_RIM_TO,
  );
  ctx.stroke();
}

function drawCrowd(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const seats: ColosseumSpectatorSeat[] = [];
  for (const seat of frame.layout.spectators) {
    if (Math.abs(seat.x - frame.cx) > HALF + SPECTATOR_REACH) continue;
    if (Math.abs(seat.y - frame.cy) > HALF + SPECTATOR_REACH + SPECTATOR_HEAD_LIFT) continue;
    seats.push(seat);
  }
  if (seats.length === 0) return;
  // Back to front, so a nearer spectator's shoulders cover a farther one's feet.
  seats.sort((a, b) => a.y - b.y);
  // The crowd sits on the wall's top and never leans out over the sand below.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, COLOSSEUM_OUTER_RADIUS_TILES, 0, FULL_TURN);
  ctx.arc(0, 0, COLOSSEUM_SAND_RADIUS_TILES, FULL_TURN, 0, true);
  ctx.clip();
  for (const seat of seats) drawColosseumSpectator(ctx, seat.x, seat.y, 1, seat.variant);
  ctx.restore();
}

// ── Cages ───────────────────────────────────────────────────────────────────

/** A cage's recess in the wall, in tiles: along the wall and into it. */
export const COLOSSEUM_CAGE_WIDTH_TILES = 0.74;
export const COLOSSEUM_CAGE_DEPTH_TILES = 0.62;
const CAGE_RECESS = '#09090d';
const CAGE_FRAME = '#50565f';
const CAGE_FRAME_WIDTH = 0.06;

function drawCageRecess(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const angle = Math.atan2(frame.cy, frame.cx);
  ctx.save();
  ctx.translate(frame.cx, frame.cy);
  // Local frame: +y points out of the arena, so the recess's open side faces the pit.
  ctx.rotate(angle - HALF * Math.PI);
  const halfWidth = COLOSSEUM_CAGE_WIDTH_TILES * HALF;
  const halfDepth = COLOSSEUM_CAGE_DEPTH_TILES * HALF;
  ctx.fillStyle = CAGE_FRAME;
  ctx.fillRect(
    -halfWidth - CAGE_FRAME_WIDTH,
    -halfDepth - CAGE_FRAME_WIDTH,
    (halfWidth + CAGE_FRAME_WIDTH) * 2,
    (halfDepth + CAGE_FRAME_WIDTH) * 2,
  );
  // Only the hollow: the straw, the pig and the bars are the live cage's, which
  // changes as the fight goes on.
  ctx.fillStyle = CAGE_RECESS;
  ctx.fillRect(-halfWidth, -halfDepth, halfWidth * 2, halfDepth * 2);
  ctx.restore();
}

// ── The door's threshold ────────────────────────────────────────────────────

const THRESHOLD_GROOVE_WIDTH = 0.07;
/** Flagstones down the passage: how many across and along, and how much each varies in tone. */
const THRESHOLD_FLAGS_ACROSS = 3;
const THRESHOLD_FLAGS_ALONG = 3;
const THRESHOLD_FLAG_SEED = 613;
const THRESHOLD_FLAG_TONE_ALPHA = 0.14;
const THRESHOLD_JOINT = 'rgba(0,0,0,0.45)';
const THRESHOLD_JOINT_WIDTH = 0.03;
/** The shadow each cut face of the wall throws across the passage floor. */
const THRESHOLD_JAMB_SHADOW = 'rgba(0,0,0,0.5)';
const THRESHOLD_JAMB_SHADOW_WIDTH = 0.16;

/**
 * The passage through the wall: worn flagstones between the two cut faces of
 * the iron, and the groove at its outer end the portcullis drops into.
 */
function drawThreshold(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const door = COLOSSEUM_DOOR_OPENING;
  if (frame.cy + HALF < door.top || frame.cy - HALF > door.bottom) return;
  if (frame.cx + HALF < door.left || frame.cx - HALF > door.right) return;
  const width = door.right - door.left;
  const length = door.bottom - door.top;
  ctx.fillStyle = THRESHOLD_STONE;
  ctx.fillRect(door.left, door.top, width, length);
  const flagWidth = width / THRESHOLD_FLAGS_ACROSS;
  const flagLength = length / THRESHOLD_FLAGS_ALONG;
  for (let along = 0; along < THRESHOLD_FLAGS_ALONG; along++) {
    for (let across = 0; across < THRESHOLD_FLAGS_ACROSS; across++) {
      const tone = hashLattice(across, along, THRESHOLD_FLAG_SEED);
      ctx.fillStyle = tone < HALF ? THRESHOLD_GROOVE : STRAW;
      ctx.globalAlpha = THRESHOLD_FLAG_TONE_ALPHA * Math.abs(tone - HALF) * 2;
      ctx.fillRect(
        door.left + across * flagWidth,
        door.top + along * flagLength,
        flagWidth,
        flagLength,
      );
    }
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = THRESHOLD_JOINT;
  ctx.lineWidth = THRESHOLD_JOINT_WIDTH;
  ctx.beginPath();
  for (let across = 1; across < THRESHOLD_FLAGS_ACROSS; across++) {
    ctx.moveTo(door.left + across * flagWidth, door.top);
    ctx.lineTo(door.left + across * flagWidth, door.bottom);
  }
  for (let along = 1; along < THRESHOLD_FLAGS_ALONG; along++) {
    ctx.moveTo(door.left, door.top + along * flagLength);
    ctx.lineTo(door.right, door.top + along * flagLength);
  }
  ctx.stroke();
  ctx.fillStyle = THRESHOLD_JAMB_SHADOW;
  ctx.fillRect(door.left, door.top, THRESHOLD_JAMB_SHADOW_WIDTH, length);
  ctx.fillRect(
    door.right - THRESHOLD_JAMB_SHADOW_WIDTH,
    door.top,
    THRESHOLD_JAMB_SHADOW_WIDTH,
    length,
  );
  ctx.fillStyle = THRESHOLD_GROOVE;
  ctx.fillRect(door.left, door.bottom - THRESHOLD_GROOVE_WIDTH, width, THRESHOLD_GROOVE_WIDTH);
}

// ── The concourse's edge ────────────────────────────────────────────────────

/** The iron's shadow thrown onto the concourse, deepest right at its foot. */
const OUTER_SHADOW_DEPTH_TILES = 0.55;
const OUTER_SHADOW_ALPHA = 0.5;

function drawOuterShadow(ctx: CanvasRenderingContext2D, frame: CellFrame): void {
  const outer = COLOSSEUM_OUTER_RADIUS_TILES;
  if (frame.farRadius < outer || frame.nearRadius > outer + OUTER_SHADOW_DEPTH_TILES) return;
  ctx.save();
  clipAwayDoorway(ctx);
  traceBand(
    ctx,
    frame.angleFrom,
    frame.angleTo,
    () => outer,
    () => outer + OUTER_SHADOW_DEPTH_TILES,
  );
  const shade = ctx.createRadialGradient(0, 0, outer, 0, 0, outer + OUTER_SHADOW_DEPTH_TILES);
  shade.addColorStop(0, `rgba(0,0,0,${OUTER_SHADOW_ALPHA})`);
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.restore();
}

// ── Mud ─────────────────────────────────────────────────────────────────────

/**
 * A wallow is painted as one soft blob for the whole patch, shaped by how deep
 * each point lies inside the patch's tiles: the distance to the nearest tile
 * that is not mud, blended smoothly so outer corners round off and inner ones
 * fill in. Cut a little way inside the tiles' own edge, the blob reads as a
 * puddle with a lobed rim rather than as squares — and since it never reaches
 * a mud tile's edge, no mud is drawn on sand a crawler crosses at full pace.
 * Built once per patch and tile size, then blitted a cell at a time.
 */
/** How far inside the tiles' edge the mud stops, in tiles. */
const MUD_EDGE_INSET = 0.1;
/** How round the outer corners are: the blend distance of the depth's soft minimum. */
const MUD_CORNER_ROUNDING = 0.14;
/** How soft the edge is, in tiles either side of the inset. */
const MUD_EDGE_SOFTNESS = 0.025;
/** Depths into the mud where the churned rim ends and where the wet middle is fully reached. */
const MUD_RIM_DEPTH = 0.2;
const MUD_WET_DEPTH = 0.45;
const MUD_RIM_RGB: RGB = [20, 14, 9];
const MUD_BASE_RGB: RGB = [50, 37, 25];
const MUD_WET_RGB: RGB = [30, 21, 14];
const MUD_SHEEN_RGB: RGB = [168, 142, 112];
const MUD_GRAIN_SEED = 701;
/** A wobble on the depth, so the rim is lobed and uneven rather than a clean offset of the tiles. */
const MUD_WOBBLE = 0.09;
const MUD_WOBBLE_PERIOD = 5;
const MUD_WOBBLE_SEED = 719;
const MUD_GRAIN_ALPHA = 0.18;
/** Sheen: streaks of the wet middle catching the light. */
const MUD_SHEEN_SEED = 709;
const MUD_SHEEN_PERIOD = 16;
const MUD_SHEEN_THRESHOLD = 0.76;
const MUD_SHEEN_ALPHA = 0.45;
const MUD_BUBBLES_PER_TILE = 2;
const MUD_BUBBLE_RADIUS = 0.035;
const MUD_BUBBLE_ALPHA = 0.45;
const MUD_HOOF_ALPHA = 0.4;
const MUD_HOOF_SPLIT = 0.05;
const MUD_HOOF_RADIUS = 0.06;
const MUD_HOOF_ASPECT = 1.3;
/** Four channels a pixel in image data. */
const RGBA_CHANNELS = 4;
const OPAQUE = 255;
const ALPHA_CHANNEL = 3;
/** Spreads a tile's bubbles across the hash so neighbouring tiles' bubbles never line up. */
const MUD_BUBBLE_HASH_STRIDE = 3;

interface MudPatch {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<readonly [number, number]>;
}

const mudPatchImages = new WeakMap<TileContent[][], Map<string, CanvasSurface>>();

function isMudAt(structure: TileContent[][], tileX: number, tileY: number): boolean {
  return structure[tileY]?.[tileX]?.type === ARENA_MUD;
}

function mudPatchAt(structure: TileContent[][], tx: number, ty: number): MudPatch {
  const tiles: Array<readonly [number, number]> = [];
  const seen = new Set<string>([`${tx},${ty}`]);
  const queue: Array<readonly [number, number]> = [[tx, ty]];
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined) break;
    tiles.push(next);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = next[0] + dx;
        const ny = next[1] + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !isMudAt(structure, nx, ny)) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  const xs = tiles.map(([x]) => x);
  const ys = tiles.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    width: Math.max(...xs) - minX + 1,
    height: Math.max(...ys) - minY + 1,
    tiles,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Distance from a point to a unit cell whose top-left is (cellX, cellY); zero inside it. */
function distanceToCell(x: number, y: number, cellX: number, cellY: number): number {
  const dx = Math.max(cellX - x, 0, x - (cellX + 1));
  const dy = Math.max(cellY - y, 0, y - (cellY + 1));
  return Math.hypot(dx, dy);
}

/**
 * How deep a point (in patch-local tiles) lies inside the patch: a smooth
 * minimum of its distance to every surrounding tile that is not mud.
 */
function mudDepth(patch: MudPatch, isMud: ReadonlySet<string>, x: number, y: number): number {
  let sum = 0;
  for (let cellY = -1; cellY <= patch.height; cellY++) {
    for (let cellX = -1; cellX <= patch.width; cellX++) {
      if (isMud.has(`${cellX},${cellY}`)) continue;
      sum += Math.exp(-distanceToCell(x, y, cellX, cellY) / MUD_CORNER_ROUNDING);
    }
  }
  return sum === 0 ? Infinity : -MUD_CORNER_ROUNDING * Math.log(sum);
}

function mudPatchImage(structure: TileContent[][], patch: MudPatch, ts: number): CanvasSurface {
  let byPatch = mudPatchImages.get(structure);
  if (byPatch === undefined) {
    byPatch = new Map();
    mudPatchImages.set(structure, byPatch);
  }
  const key = `${patch.minX},${patch.minY}|${ts}`;
  const cached = byPatch.get(key);
  if (cached !== undefined) return cached;

  const widthPx = Math.max(1, Math.round(patch.width * ts));
  const heightPx = Math.max(1, Math.round(patch.height * ts));
  const canvas = allocCanvas(widthPx, heightPx);
  const mudCtx = surfaceContext(canvas);
  const image = mudCtx.createImageData(widthPx, heightPx);
  const noise = new NoiseField(Math.max(widthPx, heightPx));
  const isMud = new Set(
    patch.tiles.map(([tileX, tileY]) => `${tileX - patch.minX},${tileY - patch.minY}`),
  );
  for (let py = 0; py < heightPx; py++) {
    for (let px = 0; px < widthPx; px++) {
      const x = (px + HALF) / ts;
      const y = (py + HALF) / ts;
      if (!isMud.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
      const wobble = (noise.value(px, py, MUD_WOBBLE_PERIOD, MUD_WOBBLE_SEED) - HALF) * MUD_WOBBLE;
      const depth = mudDepth(patch, isMud, x, y) + wobble - MUD_EDGE_INSET;
      const alpha = smoothstep(-MUD_EDGE_SOFTNESS, MUD_EDGE_SOFTNESS, depth);
      if (alpha <= 0) continue;
      let colour = lerpRgb(MUD_RIM_RGB, MUD_BASE_RGB, smoothstep(0, MUD_RIM_DEPTH, depth));
      colour = lerpRgb(colour, MUD_WET_RGB, smoothstep(MUD_RIM_DEPTH, MUD_WET_DEPTH, depth));
      const grain = hashLattice(px + patch.minX * ts, py + patch.minY * ts, MUD_GRAIN_SEED);
      colour = lerpRgb(
        colour,
        grain < HALF ? MUD_RIM_RGB : MUD_BASE_RGB,
        MUD_GRAIN_ALPHA * Math.abs(grain - HALF) * 2,
      );
      const sheen = noise.value(px, py, MUD_SHEEN_PERIOD, MUD_SHEEN_SEED);
      if (sheen > MUD_SHEEN_THRESHOLD && depth > MUD_RIM_DEPTH) {
        const sheenShare = (sheen - MUD_SHEEN_THRESHOLD) / (1 - MUD_SHEEN_THRESHOLD);
        colour = lerpRgb(colour, MUD_SHEEN_RGB, MUD_SHEEN_ALPHA * sheenShare);
      }
      const index = (py * widthPx + px) * RGBA_CHANNELS;
      image.data[index] = colour[0];
      image.data[index + 1] = colour[1];
      image.data[index + 2] = colour[2];
      image.data[index + ALPHA_CHANNEL] = Math.round(alpha * OPAQUE);
    }
  }
  mudCtx.putImageData(image, 0, 0);

  // Bubbles and hoofprints sunk in the middle of each tile.
  mudCtx.save();
  mudCtx.scale(ts, ts);
  for (const [tileX, tileY] of patch.tiles) {
    const cx = tileX - patch.minX + HALF;
    const cy = tileY - patch.minY + HALF;
    mudCtx.strokeStyle = rgbString(MUD_SHEEN_RGB);
    mudCtx.lineWidth = 1 / ts;
    mudCtx.globalAlpha = MUD_BUBBLE_ALPHA;
    for (let bubble = 0; bubble < MUD_BUBBLES_PER_TILE; bubble++) {
      mudCtx.beginPath();
      mudCtx.arc(
        cx +
          (hashLattice(tileX, tileY * MUD_BUBBLE_HASH_STRIDE + bubble, MUD_GRAIN_SEED) - HALF) *
            HALF,
        cy +
          (hashLattice(tileY, tileX * MUD_BUBBLE_HASH_STRIDE + bubble, MUD_GRAIN_SEED) - HALF) *
            HALF,
        MUD_BUBBLE_RADIUS,
        0,
        FULL_TURN,
      );
      mudCtx.stroke();
    }
    mudCtx.globalAlpha = MUD_HOOF_ALPHA;
    mudCtx.fillStyle = rgbString(MUD_RIM_RGB);
    const turn = hashLattice(tileX, tileY, MUD_SHEEN_SEED) * Math.PI;
    for (const side of [-1, 1]) {
      mudCtx.beginPath();
      mudCtx.ellipse(
        cx + Math.cos(turn) * MUD_HOOF_SPLIT * side,
        cy + Math.sin(turn) * MUD_HOOF_SPLIT * side,
        MUD_HOOF_RADIUS,
        MUD_HOOF_RADIUS * MUD_HOOF_ASPECT,
        turn,
        0,
        FULL_TURN,
      );
      mudCtx.fill();
    }
  }
  mudCtx.restore();
  byPatch.set(key, canvas);
  return canvas;
}

function rgbString(colour: RGB): string {
  return `rgb(${Math.round(colour[0])},${Math.round(colour[1])},${Math.round(colour[2])})`;
}

/** Lays this cell's share of its wallow's blob over the sand already painted. */
function drawMud(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const patch = mudPatchAt(structure, tx, ty);
  const image = mudPatchImage(structure, patch, ts);
  const cellPx = image.width / patch.width;
  ctx.drawImage(
    image,
    (tx - patch.minX) * cellPx,
    (ty - patch.minY) * cellPx,
    cellPx,
    cellPx,
    sx,
    sy,
    ts,
    ts,
  );
}

// ── Entry points ────────────────────────────────────────────────────────────

/**
 * Paints any tile the colosseum's picture covers — its sand, mud, iron and
 * cages. Returns false for a tile of none of those types, or of one standing
 * outside any arena (the door row's seal is plain wall).
 */
export function drawColosseumTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  if (type !== ARENA_FLOOR && type !== ARENA_MUD && type !== METAL_WALL && type !== ARENA_CAGE) {
    return false;
  }
  const layout = colosseumLayoutAt(structure, tx, ty);
  const isWall = type === METAL_WALL || type === ARENA_CAGE;
  if (layout === null) {
    if (isWall) return false;
    drawSandBase(ctx, sx, sy, ts, tx, ty);
    return true;
  }
  const frame = cellFrame(layout, tx, ty);
  // A wall standing outside the ring — the seal across the door row — is plain
  // wall; the ring's edge is painted over it by `drawColosseumRim`.
  const centreRadius = Math.hypot(frame.cx, frame.cy);
  if (isWall && centreRadius > COLOSSEUM_OUTER_RADIUS_TILES) return false;

  // A wall tile's corners past the curve are the concourse, so its paving goes
  // down first; the sand is only ever seen inside the ring.
  if (isWall) drawGroundTile(ctx, dungeonFloorTheme().ground, structure, sx, sy, ts, tx, ty);
  else drawSandBase(ctx, sx, sy, ts, tx, ty);
  inArenaFrame(ctx, frame, sx, sy, ts, () => {
    // A wall tile shows sand only inside the ring; a floor tile's sand runs to
    // its own edge, which matters only in the door's mouth, where no iron covers it.
    const sandReach = isWall ? COLOSSEUM_SAND_RADIUS_TILES : COLOSSEUM_OUTER_RADIUS_TILES;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, sandReach, 0, FULL_TURN);
    ctx.clip();
    if (isWall) drawSandTextureInFrame(ctx, frame, ts, tx, ty);
    drawSand(ctx, frame, tx, ty);
    ctx.restore();
    drawIron(ctx, frame);
    drawOuterShadow(ctx, frame);
    if (type === ARENA_CAGE) drawCageRecess(ctx, frame);
    drawCrowd(ctx, frame);
  });
  if (type === ARENA_MUD) drawMud(ctx, structure, sx, sy, ts, tx, ty);
  return true;
}

/**
 * Paints the colosseum's picture over a concourse or doorway tile the ring's
 * outer edge cuts through: the part of the iron that reaches into it, the door's
 * threshold, and the iron's shadow on the paving. Called after the tile's own
 * ground, and returns whether the tile belongs to an arena — in which case the
 * square contact bands a wall would cast are the arena's to replace.
 */
export function drawColosseumRim(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  const layout = colosseumLayoutAt(structure, tx, ty);
  if (layout === null) return false;
  const frame = cellFrame(layout, tx, ty);
  const reach = COLOSSEUM_OUTER_RADIUS_TILES + OUTER_SHADOW_DEPTH_TILES;
  if (frame.nearRadius > reach) return false;
  inArenaFrame(ctx, frame, sx, sy, ts, () => {
    drawThreshold(ctx, frame);
    drawIron(ctx, frame);
    drawOuterShadow(ctx, frame);
    drawCrowd(ctx, frame);
  });
  return true;
}

/**
 * Whether a tile is part of an arena's round wall, whose shadow the arena
 * paints itself: a square strip cast from it would cut straight across the curve.
 */
export function isColosseumRingTile(structure: TileContent[][], tx: number, ty: number): boolean {
  const type = structure[ty]?.[tx]?.type;
  if (type !== METAL_WALL && type !== ARENA_CAGE) return false;
  const layout = colosseumLayoutAt(structure, tx, ty);
  if (layout === null) return false;
  const radius = Math.hypot(tx - layout.centreTileX, ty - layout.centreTileY);
  return radius <= COLOSSEUM_OUTER_RADIUS_TILES;
}
