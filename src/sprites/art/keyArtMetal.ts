/**
 * The key as a solid of polished metal, shaded pixel by pixel.
 *
 * A {@link KeyRelief} is the key's surface at one resolution: a height field
 * built from the silhouette (a rounded bevel round every edge, the shank a
 * rod, the scallops and the tip domes, the collars raised bands, the bezel a
 * ring, the engraving cut in as grooves), and the normals and cavities that
 * follow from it. The gem is cut separately into flat facets.
 *
 * Shading reflects a studio round the key: a bright sky above a dark band at
 * the horizon and a darker floor, a soft key light high on the left, a tall
 * strip light to the right and a dimmer one to the left. A curved bevel
 * mirrors all of it at once, which is what makes polished metal read as
 * metal: dark and bright bands packed into its edges, a hot streak where it
 * faces a light. The view direction leans across the key as if the eye were
 * close, so even a flat face holds a gradient instead of one flat tone, and a
 * turned key's reflections slide across it.
 *
 * Everything is a pure function of its arguments; the relief is the costly
 * part, built once per resolution by the bake cache.
 */

import { rgbOf } from '../../ui/theme/color';
import { smoothstep } from '../lightMaps';
import type { ToneRamp } from '../../ui/theme/keyInk';
import {
  BOW,
  BOW_LOBES,
  bowLobeCentres,
  COLLAR_CORNER,
  COLLARS,
  GEM,
  KEY_ART_ASPECT,
  SHANK,
  strokeEngraving,
  TIP,
  traceKey,
  tracePiece,
  type Piece,
} from './keyArtShape';

type Ctx = CanvasRenderingContext2D;

/** The bytes of one pixel in image data, and where its alpha sits among them. */
export const RGBA_STRIDE = 4;
export const ALPHA_CHANNEL = 3;
/** A pixel's colour is the surface at its middle, half a pixel in from its corner. */
const PIXEL_CENTRE = 0.5;
/** Room left round the key inside a relief, as a share of its width. */
const RELIEF_PAD = 0.012;

/** Every height here is in key units, like the shape: 1 is the key's width. */
const BEVEL = 0.018;
const LOBE_RISE = 0.03;
const COLLAR_RISE = 0.036;
const COLLAR_BEVEL = 0.014;
const TIP_RISE = 0.032;
const BEZEL_RISE = 0.02;
const GEM_SEAT = BEVEL;
const GROOVE_DEPTH = 0.007;
const GROOVE_WIDTH = 0.0065;
/** A groove is never narrower than this many pixels, or a small key's engraving vanishes. */
const GROOVE_MIN_PX = 1.4;
/** How far round a cavity the occlusion looks, as a share of the key's width. */
const OCCLUSION_REACH = 0.012;
/** How dark a cavity gets per key unit it sits below its surroundings. */
const OCCLUSION_STRENGTH = 26;
const OCCLUSION_FLOOR = 0.4;

/** A coverage byte at or above this is metal, for the distance field. */
const INSIDE_COVERAGE = 128;
const COVERAGE_MAX = 255;
const FAR = 1e20;

/** The gem's cut: a flat table, a crown of eight facets, then sixteen steeper ones to the girdle. */
const GEM_TABLE = 0.42;
const GEM_CROWN = 0.76;
const GEM_CROWN_FACETS = 8;
const GEM_PAVILION_FACETS = 16;
const GEM_CROWN_TILT = 0.5;
const GEM_PAVILION_TILT = 0.95;
const GEM_GIRDLE = 0.93;
const GEM_GIRDLE_DIM = 0.55;

const MATERIAL_NONE = 0;
const MATERIAL_METAL = 1;
const MATERIAL_GEM = 2;

/** The broken band where a fragment was snapped off, as a share of the key's width. */
const FRACTURE_WIDTH = 0.017;
const FRACTURE_TILT = 1.05;
const FRACTURE_GRAIN = 0.7;
const FRACTURE_DIM = 0.4;
/** The crystals a break shows, as a share of the key's width, never finer than a couple of pixels. */
const FRACTURE_GRAIN_CELL = 0.005;
const FRACTURE_GRAIN_CELL_MIN_PX = 1.6;
/** The polished face's last sliver before the break catches the light, this many pixels wide. */
const FRACTURE_LIP_PX = 1.5;
const FRACTURE_LIP_GAIN = 1.3;
/** A broken pixel this much nearer its cut than the key's own edge belongs to the break. */
const FRACTURE_MARGIN_PX = 0.75;

/** One resolution of the key's surface. Pixel (0,0) is the relief's top-left corner. */
export interface KeyRelief {
  readonly w: number;
  readonly h: number;
  /** Pixels per key unit. */
  readonly unitPx: number;
  readonly coverage: Uint8ClampedArray;
  readonly material: Uint8Array;
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly nz: Float32Array;
  readonly occlusion: Float32Array;
  /** How far each pixel is inside the key's own silhouette, in pixels. */
  readonly edgeDistance: Float32Array;
  readonly pieces: Map<string, PieceField>;
}

/** One fragment's own coverage, and how far each of its pixels is from its edge. */
export interface PieceField {
  readonly coverage: Uint8ClampedArray;
  readonly distance: Float32Array;
}

export function reliefSize(unitPx: number): { w: number; h: number } {
  return {
    w: Math.ceil(unitPx * (1 + RELIEF_PAD * 2)),
    h: Math.ceil(unitPx * (KEY_ART_ASPECT + RELIEF_PAD * 2)),
  };
}

/**
 * Rasterises `paint` (in key units) into a readable scratch and reads back its
 * alpha channel, yielding between bands of rows so the read never holds a
 * frame for long.
 */
export type Rasterise = (paint: (ctx: Ctx) => void) => Generator<void, Uint8ClampedArray>;

/** Work that yields between small steps, so a bake can spread across frames. */
export type Steps<T> = Generator<void, T>;

/** One dimension of the exact squared Euclidean distance transform (Felzenszwalb and Huttenlocher). */
function distance1d(
  f: Float64Array,
  n: number,
  out: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    out[q] = dq * dq + f[v[k]];
  }
}

/** How far each covered pixel is from the nearest uncovered one, in pixels. */
function* insideDistance(coverage: Uint8ClampedArray, w: number, h: number): Steps<Float32Array> {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = coverage[i] >= INSIDE_COVERAGE ? FAR : 0;
  const longest = Math.max(w, h);
  const f = new Float64Array(longest);
  const out = new Float64Array(longest);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    distance1d(f, h, out, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = out[y];
    yield;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    distance1d(f, w, out, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = out[x];
    yield;
  }
  const distance = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let i = y * w; i < (y + 1) * w; i++) {
      // Half a pixel back, so an edge pixel's distance runs from its partial coverage, not its centre.
      distance[i] = Math.max(0, Math.sqrt(grid[i]) - 1 + coverage[i] / COVERAGE_MAX);
    }
    yield;
  }
  return distance;
}

/** A quarter-round: 0 at the edge rising to `rise` once `d` reaches `width`. */
function roundOver(d: number, width: number, rise: number): number {
  if (d <= 0) return 0;
  if (d >= width) return rise;
  const t = 1 - d / width;
  return rise * Math.sqrt(1 - t * t);
}

function dome(dx: number, dy: number, radius: number, rise: number): number {
  const r2 = (dx * dx + dy * dy) / (radius * radius);
  return r2 >= 1 ? 0 : rise * Math.sqrt(1 - r2);
}

function collarHeight(x: number, y: number): number {
  let best = 0;
  for (const collar of COLLARS) {
    const inset = Math.min(x - collar.left, collar.right - x, collar.half - Math.abs(y));
    if (inset <= 0) continue;
    best = Math.max(best, roundOver(inset + COLLAR_CORNER / 2, COLLAR_BEVEL, COLLAR_RISE));
  }
  return best;
}

/** The shank is a round rod standing as proud as it is wide. */
function rodHeight(x: number, y: number): number {
  if (x < SHANK.left || x > SHANK.right) return 0;
  const across = y / SHANK.half;
  return across * across >= 1 ? 0 : SHANK.half * Math.sqrt(1 - across * across);
}

function bezelHeight(r: number): number {
  if (r < GEM.radius || r > GEM.bezel) return 0;
  const t = (r - GEM.radius) / (GEM.bezel - GEM.radius);
  return BEVEL + BEZEL_RISE * Math.sin(t * Math.PI);
}

const LOBES = bowLobeCentres();
/** Nothing nearer the bow's centre than this can be on a scallop. */
const LOBE_RING_INNER = BOW_LOBES.reach - BOW_LOBES.radius;
const LOBE_RING_OUTER = BOW_LOBES.reach + BOW_LOBES.radius;

/** The cut gem's facet normal at (dx, dy) from its centre, in key units. */
function gemFacet(dx: number, dy: number): readonly [number, number, number] {
  const rho = Math.sqrt(dx * dx + dy * dy) / GEM.radius;
  if (rho < GEM_TABLE) return [0, 0, 1];
  const angle = Math.atan2(dy, dx);
  const facets = rho < GEM_CROWN ? GEM_CROWN_FACETS : GEM_PAVILION_FACETS;
  const tilt = rho < GEM_CROWN ? GEM_CROWN_TILT : GEM_PAVILION_TILT;
  const step = (Math.PI * 2) / facets;
  const offset = rho < GEM_CROWN ? 0 : step / 2;
  const centre = Math.round((angle - offset) / step) * step + offset;
  const lean = Math.sin(tilt);
  return [Math.cos(centre) * lean, Math.sin(centre) * lean, Math.cos(tilt)];
}

/** Box blur of `src` with a square of half-side `reach` pixels, separably. */
function* boxBlur(src: Float32Array, w: number, h: number, reach: number): Steps<Float32Array> {
  const across = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = reach * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -reach; x <= reach; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      across[row + x] = sum / span;
      sum += src[row + Math.min(w - 1, x + reach + 1)] - src[row + Math.max(0, x - reach)];
    }
    yield;
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -reach; y <= reach; y++) sum += across[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum +=
        across[Math.min(h - 1, y + reach + 1) * w + x] - across[Math.max(0, y - reach) * w + x];
    }
    yield;
  }
  return out;
}

/** Builds the key's surface at `unitPx` pixels per key unit, a row or a column at a time. */
export function* reliefSteps(unitPx: number, rasterise: Rasterise): Steps<KeyRelief> {
  const { w, h } = reliefSize(unitPx);
  const count = w * h;
  const coverage = yield* rasterise((ctx) => {
    traceKey(ctx);
    ctx.fill();
  });
  const grooveWidth = Math.max(GROOVE_WIDTH, GROOVE_MIN_PX / unitPx);
  const grooves = yield* rasterise((ctx) => {
    ctx.save();
    traceKey(ctx);
    ctx.clip();
    ctx.lineWidth = grooveWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokeEngraving(ctx);
    ctx.restore();
  });
  const edge = yield* insideDistance(coverage, w, h);
  const height = new Float32Array(count);
  const material = new Uint8Array(count);
  const toKey = 1 / unitPx;
  const originX = w / 2;
  const originY = h / 2;
  for (let py = 0; py < h; py++) {
    const y = (py + PIXEL_CENTRE - originY) * toKey;
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      if (coverage[i] === 0) continue;
      const x = (px + PIXEL_CENTRE - originX) * toKey;
      const fromBow = x - BOW.x;
      const fromGem = Math.sqrt(fromBow * fromBow + y * y);
      if (fromGem < GEM.radius) {
        material[i] = MATERIAL_GEM;
        height[i] = GEM_SEAT;
        continue;
      }
      material[i] = MATERIAL_METAL;
      const lip = roundOver(edge[i] * toKey, BEVEL, BEVEL);
      let top = lip;
      if (fromGem > LOBE_RING_INNER && fromGem < LOBE_RING_OUTER) {
        for (const [lx, ly] of LOBES) {
          top = Math.max(top, dome(x - lx, y - ly, BOW_LOBES.radius, LOBE_RISE));
        }
      }
      top = Math.max(top, rodHeight(x, y), collarHeight(x, y), bezelHeight(fromGem));
      top = Math.max(top, dome(x - TIP.x, y, TIP.radius, TIP_RISE));
      // A raised part still meets the silhouette's edge with the same rounded lip.
      top = Math.min(top, lip * (top / BEVEL));
      height[i] = top - (GROOVE_DEPTH * grooves[i]) / COVERAGE_MAX;
    }
    yield;
  }
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  const nz = new Float32Array(count);
  const twoPixels = 2 * toKey;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      if (material[i] === MATERIAL_NONE) continue;
      const left = px > 0 ? i - 1 : i;
      const right = px < w - 1 ? i + 1 : i;
      const up = py > 0 ? i - w : i;
      const down = py < h - 1 ? i + w : i;
      if (material[i] === MATERIAL_GEM) {
        const x = (px + PIXEL_CENTRE - originX) * toKey;
        const y = (py + PIXEL_CENTRE - originY) * toKey;
        const [fx, fy, fz] = gemFacet(x - BOW.x, y);
        nx[i] = fx;
        ny[i] = fy;
        nz[i] = fz;
        continue;
      }
      const sx = -(height[right] - height[left]) / twoPixels;
      const sy = -(height[down] - height[up]) / twoPixels;
      const length = Math.sqrt(sx * sx + sy * sy + 1);
      nx[i] = sx / length;
      ny[i] = sy / length;
      nz[i] = 1 / length;
    }
    yield;
  }
  const surroundings = yield* boxBlur(
    height,
    w,
    h,
    Math.max(1, Math.round(OCCLUSION_REACH * unitPx)),
  );
  const occlusion = new Float32Array(count);
  for (let py = 0; py < h; py++) {
    for (let i = py * w; i < (py + 1) * w; i++) {
      const cavity = Math.max(0, surroundings[i] - height[i]);
      occlusion[i] = Math.max(OCCLUSION_FLOOR, 1 - cavity * OCCLUSION_STRENGTH);
    }
    yield;
  }
  return {
    w,
    h,
    unitPx,
    coverage,
    material,
    nx,
    ny,
    nz,
    occlusion,
    edgeDistance: edge,
    pieces: new Map(),
  };
}

/** The coverage and edge distance of one fragment, built once per relief. */
export function* pieceFieldSteps(
  relief: KeyRelief,
  key: string,
  piece: Piece,
  rasterise: Rasterise,
): Steps<PieceField> {
  const known = relief.pieces.get(key);
  if (known) return known;
  const coverage = yield* rasterise((ctx) => {
    ctx.save();
    tracePiece(ctx, piece);
    ctx.clip();
    traceKey(ctx);
    ctx.fill();
    ctx.restore();
  });
  const distance = yield* insideDistance(coverage, relief.w, relief.h);
  const field = { coverage, distance };
  relief.pieces.set(key, field);
  return field;
}

// ── The studio the key reflects ─────────────────────────────────────────────

const SKY_FROM = -0.04;
const SKY_TO = 0.85;
const SKY_LOW = 0.5;
const SKY_HIGH = 0.9;
const FLOOR_NEAR = 0.2;
const FLOOR_FAR = 0.08;
const FLOOR_FALL = 0.6;
/** The dark band just above the horizon, which gives a bevel its sharpest dark line. */
const HORIZON_BAND = { from: 0.02, to: 0.17, soft: 0.04, depth: 0.42 } as const;
/** A soft box high on the left and in front, the key light. */
const KEY_LIGHT = { x: -0.42, y: -0.5, z: 0.76, inner: 0.95, outer: 0.88, gain: 0.85 } as const;
/** Tall strip lights either side, whose reflections streak across a turning face. */
const RIGHT_STRIP = { from: 0.5, to: 0.66, soft: 0.04, gain: 0.7 } as const;
const LEFT_STRIP = { from: -0.86, to: -0.76, soft: 0.04, gain: 0.4 } as const;
const STRIP_TOP = 0.85;
const STRIP_FOOT = -0.3;
/** The room behind the viewer, which a face turned square to the eye mirrors. */
const FRONT_FILL = { from: 0.55, to: 1, gain: 0.12 } as const;
/** How far the line of sight leans per key unit across the key, as if the eye were close. */
const VIEW_LEAN = 1.1;

function band(x: number, from: number, to: number, soft: number): number {
  return smoothstep(from - soft, from + soft, x) * (1 - smoothstep(to - soft, to + soft, x));
}

const KEY_LIGHT_LENGTH = Math.hypot(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z);
const KEY_LIGHT_DIR = [
  KEY_LIGHT.x / KEY_LIGHT_LENGTH,
  KEY_LIGHT.y / KEY_LIGHT_LENGTH,
  KEY_LIGHT.z / KEY_LIGHT_LENGTH,
] as const;

/** How bright the studio is in direction (rx, ry, rz), +Y down, +Z toward the viewer. */
export function studio(rx: number, ry: number, rz: number): number {
  const up = -ry;
  const sky = SKY_LOW + (SKY_HIGH - SKY_LOW) * smoothstep(SKY_FROM, SKY_TO, up);
  const floor = FLOOR_NEAR + (FLOOR_FAR - FLOOR_NEAR) * smoothstep(0, FLOOR_FALL, -up);
  let light = up >= SKY_FROM ? sky : floor;
  light -= HORIZON_BAND.depth * band(up, HORIZON_BAND.from, HORIZON_BAND.to, HORIZON_BAND.soft);
  const toKey = rx * KEY_LIGHT_DIR[0] + ry * KEY_LIGHT_DIR[1] + rz * KEY_LIGHT_DIR[2];
  light += KEY_LIGHT.gain * smoothstep(KEY_LIGHT.outer, KEY_LIGHT.inner, toKey);
  const tall = band(up, STRIP_FOOT, STRIP_TOP, RIGHT_STRIP.soft);
  light += RIGHT_STRIP.gain * tall * band(rx, RIGHT_STRIP.from, RIGHT_STRIP.to, RIGHT_STRIP.soft);
  light += LEFT_STRIP.gain * tall * band(rx, LEFT_STRIP.from, LEFT_STRIP.to, LEFT_STRIP.soft);
  light += FRONT_FILL.gain * smoothstep(FRONT_FILL.from, FRONT_FILL.to, rz);
  return Math.max(0, light);
}

// ── Tone ramps ───────────────────────────────────────────────────────────────

const LUT_SIZE = 256;
/** A ramp table holds red, green and blue per entry, no alpha. */
const RGB_STRIDE = 3;
/** The brightest a ramp is read to; anything past it is the last colour. */
const RAMP_TOP = 1.1;

/** A ramp unpacked into a lookup table of `LUT_SIZE` RGB triples from 0 to {@link RAMP_TOP}. */
export type RampTable = Uint8ClampedArray;

const RAMP_TABLES = new WeakMap<ToneRamp, RampTable>();

export function rampTable(ramp: ToneRamp): RampTable {
  const known = RAMP_TABLES.get(ramp);
  if (known) return known;
  const stops = ramp.map(({ at, color }) => ({ at, rgb: rgbOf(color) }));
  const table = new Uint8ClampedArray(LUT_SIZE * RGB_STRIDE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const at = (i / (LUT_SIZE - 1)) * RAMP_TOP;
    const upper = stops.findIndex((stop) => stop.at >= at);
    const hi = stops[upper === -1 ? stops.length - 1 : upper];
    const lo = stops[Math.max(0, (upper === -1 ? stops.length : upper) - 1)];
    const span = hi.at - lo.at;
    const t = span > 0 ? Math.max(0, Math.min(1, (at - lo.at) / span)) : 0;
    table[i * RGB_STRIDE] = lo.rgb.r + (hi.rgb.r - lo.rgb.r) * t;
    table[i * RGB_STRIDE + 1] = lo.rgb.g + (hi.rgb.g - lo.rgb.g) * t;
    table[i * RGB_STRIDE + 2] = lo.rgb.b + (hi.rgb.b - lo.rgb.b) * t;
  }
  RAMP_TABLES.set(ramp, table);
  return table;
}

const HEX_RADIX = 16;
const HEX_DIGITS = 2;

/** The colour `table` gives `brightness`, as #RRGGBB. */
export function rampColor(table: RampTable, brightness: number): string {
  const index = rampIndex(brightness);
  const hex = (value: number): string =>
    Math.round(value).toString(HEX_RADIX).padStart(HEX_DIGITS, '0');
  return `#${hex(table[index])}${hex(table[index + 1])}${hex(table[index + 2])}`;
}

function rampIndex(brightness: number): number {
  const scaled = Math.round((brightness / RAMP_TOP) * (LUT_SIZE - 1));
  return Math.max(0, Math.min(LUT_SIZE - 1, scaled)) * RGB_STRIDE;
}

// ── Shading ──────────────────────────────────────────────────────────────────

export interface ShadeRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Polished for the key itself; a socket is the key's shape sunk into dark stone. */
export type MetalFinish = 'polished' | 'socket';

export interface MetalTables {
  readonly metal: RampTable;
  readonly gem: RampTable;
}

/** The gem's specular takes over from its body colour from this much reflected light. */
const GEM_SPECULAR_FROM = 0.8;
const GEM_SPECULAR_SPAN = 0.5;
const GEM_BODY_FLOOR = 0.12;
const GEM_BODY_GAIN = 0.75;
const WHITE = 255;

/** Large odd multipliers that scatter neighbouring cells' grain far apart. */
const GRAIN_HASH_X = 374761393;
const GRAIN_HASH_Y = 668265263;
const GRAIN_HASH_MIX = 1274126177;
const GRAIN_LEVELS = 65536;
/** Offsets that give a cell's second and third grain values their own runs of the hash. */
const GRAIN_STREAM_B = { x: 17, y: 31 } as const;
const GRAIN_STREAM_C = { x: 5, y: 3 } as const;

/** Repeatable grain in [0, 1) for a pixel cell. */
function grain(x: number, y: number): number {
  const mixed = Math.imul(x * GRAIN_HASH_X + y * GRAIN_HASH_Y, GRAIN_HASH_MIX) >>> 0;
  return (mixed % GRAIN_LEVELS) / GRAIN_LEVELS;
}

/**
 * What a key turns about: `upright`, the axis across its length (a key spun
 * to show its back), or `length`, its own shank (a key turning in a lock).
 */
export type TurnAxis = 'upright' | 'length';

/** How far a key is turned, in radians, and about which axis. */
export interface KeyTurn {
  readonly angle: number;
  readonly axis: TurnAxis;
}

/**
 * Shades the key at `turn` into `out` (RGBA, `region`'s size), for the pixels
 * of `region`. Past a quarter turn the back is shown, laid out as the front
 * so the caller mirrors it across the turn's axis. With
 * `piece`, only that fragment's pixels are kept and its broken edge is shaded
 * as torn metal.
 */
export function* shadeMetal(
  relief: KeyRelief,
  region: ShadeRegion,
  turn: KeyTurn,
  tables: MetalTables,
  piece: PieceField | null,
  finish: MetalFinish,
  out: Uint8ClampedArray,
): Steps<void> {
  const { w, h, unitPx } = relief;
  const cosYaw = Math.cos(turn.angle);
  const sinYaw = Math.sin(turn.angle);
  const aboutLength = turn.axis === 'length';
  const back = cosYaw < 0;
  const toKey = 1 / unitPx;
  const fractureReach = FRACTURE_WIDTH * unitPx;
  const grainCell = Math.max(FRACTURE_GRAIN_CELL_MIN_PX, FRACTURE_GRAIN_CELL * unitPx);
  for (let ry = 0; ry < region.h; ry++) {
    const py = region.y + ry;
    const ky = (py + PIXEL_CENTRE - h / 2) * toKey;
    for (let rx = 0; rx < region.w; rx++) {
      const px = region.x + rx;
      const i = py * w + px;
      const o = (ry * region.w + rx) * RGBA_STRIDE;
      const coverage = piece ? Math.min(piece.coverage[i], relief.coverage[i]) : relief.coverage[i];
      const material = relief.material[i];
      if (coverage === 0 || material === MATERIAL_NONE) {
        out[o + ALPHA_CHANNEL] = 0;
        continue;
      }
      const recessed = finish === 'socket';
      const plain = recessed && material === MATERIAL_GEM;
      let nx = plain ? 0 : recessed ? -relief.nx[i] : relief.nx[i];
      let ny = plain ? 0 : recessed ? -relief.ny[i] : relief.ny[i];
      let nz = plain ? 1 : back ? -relief.nz[i] : relief.nz[i];
      let dim = relief.occlusion[i];
      let broken = false;
      if (piece !== null && !recessed && material === MATERIAL_METAL) {
        const fromCut = piece.distance[i];
        const left = px > 0 ? i - 1 : i;
        const right = px < w - 1 ? i + 1 : i;
        const up = py > 0 ? i - w : i;
        const down = py < h - 1 ? i + w : i;
        const cutNearer = fromCut + FRACTURE_MARGIN_PX < relief.edgeDistance[i];
        const nearCut = cutNearer && fromCut < fractureReach;
        const onLip = cutNearer && !nearCut && fromCut < fractureReach + FRACTURE_LIP_PX;
        if (onLip) dim *= FRACTURE_LIP_GAIN;
        if (nearCut) {
          broken = true;
          const outX = -(piece.distance[right] - piece.distance[left]);
          const outY = -(piece.distance[down] - piece.distance[up]);
          const outLength = Math.sqrt(outX * outX + outY * outY) || 1;
          const tilt = FRACTURE_TILT * (1 - fromCut / fractureReach);
          const cellX = Math.floor(px / grainCell);
          const cellY = Math.floor(py / grainCell);
          const jitterX = (grain(cellX, cellY) * 2 - 1) * FRACTURE_GRAIN;
          const jitterY =
            (grain(cellY + GRAIN_STREAM_B.x, cellX + GRAIN_STREAM_B.y) * 2 - 1) * FRACTURE_GRAIN;
          nx = (outX / outLength) * Math.sin(tilt) + jitterX;
          ny = (outY / outLength) * Math.sin(tilt) + jitterY;
          nz = Math.cos(tilt);
          const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
          nx /= length;
          ny /= length;
          nz /= length;
          dim *=
            FRACTURE_DIM *
            (1 -
              FRACTURE_GRAIN / 2 +
              grain(cellX + GRAIN_STREAM_C.x, cellY + GRAIN_STREAM_C.y) * FRACTURE_GRAIN);
        }
      }
      // Turn the normal with the key, and lean the line of sight to where the turned pixel lands.
      const across = aboutLength ? ny : nx;
      const turnedAcross = across * cosYaw + nz * sinYaw;
      const wz = -across * sinYaw + nz * cosYaw;
      const wx = aboutLength ? nx : turnedAcross;
      const wy = aboutLength ? turnedAcross : ny;
      const kx = (px + PIXEL_CENTRE - w / 2) * toKey * (aboutLength ? 1 : cosYaw);
      const screenY = ky * (aboutLength ? cosYaw : 1);
      const vx0 = -kx * VIEW_LEAN;
      const vy0 = -screenY * VIEW_LEAN;
      const vLength = Math.sqrt(vx0 * vx0 + vy0 * vy0 + 1);
      const vx = vx0 / vLength;
      const vy = vy0 / vLength;
      const vz = 1 / vLength;
      const facing = wx * vx + wy * vy + wz * vz;
      const rX = 2 * facing * wx - vx;
      const rY = 2 * facing * wy - vy;
      const rZ = 2 * facing * wz - vz;
      const seen = studio(rX, rY, rZ);
      if (material === MATERIAL_GEM && !recessed && !broken) {
        // Light let in through the facets comes back out on the side away from it.
        const inward = studio(-rX, -rY, rZ);
        const body = rampIndex(GEM_BODY_FLOOR + GEM_BODY_GAIN * inward * dim);
        const gemX = (px + PIXEL_CENTRE - w / 2) * toKey - BOW.x;
        const rho = Math.sqrt(gemX * gemX + ky * ky) / GEM.radius;
        const girdle = rho > GEM_GIRDLE ? GEM_GIRDLE_DIM : 1;
        const shine = smoothstep(GEM_SPECULAR_FROM, GEM_SPECULAR_FROM + GEM_SPECULAR_SPAN, seen);
        out[o] = (tables.gem[body] + (WHITE - tables.gem[body]) * shine) * girdle;
        out[o + 1] = (tables.gem[body + 1] + (WHITE - tables.gem[body + 1]) * shine) * girdle;
        out[o + 2] = (tables.gem[body + 2] + (WHITE - tables.gem[body + 2]) * shine) * girdle;
        out[o + ALPHA_CHANNEL] = coverage;
        continue;
      }
      const tone = rampIndex(seen * dim);
      out[o] = tables.metal[tone];
      out[o + 1] = tables.metal[tone + 1];
      out[o + 2] = tables.metal[tone + 2];
      out[o + ALPHA_CHANNEL] = coverage;
    }
    yield;
  }
}
