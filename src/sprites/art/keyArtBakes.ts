/**
 * The key's pictures, baked once and blitted after.
 *
 * Shading the key pixel by pixel costs milliseconds, and the ceremonies draw
 * it every frame, so every picture is baked to an off-screen surface at the
 * resolution it is drawn at, rounded up to a quarter octave so a key that
 * grows or flies across the screen reuses a handful of bakes rather than
 * baking at every size it passes through. A turning key is baked once per
 * step of its turn and the two steps either side of the true angle are
 * blended, so its reflections slide rather than snap.
 *
 * The pictures live in one budgeted cache owned by the UI pool, let go least
 * recently drawn first and all at once when the canvas is lost; the surface
 * reliefs they are shaded from are plain arrays, kept for the last couple of
 * resolutions.
 */

import type { KeyKind } from '../../core/keys/keyKinds';
import {
  allocCanvas,
  allocReadableCanvas,
  BYTES_PER_MEGABYTE,
  freshSurfaceContext,
  releaseSurface,
  resizeSurface,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import { onIdleSweep, RecentSurfaceCache } from '../../core/rendering/recentSurfaceCache';
import { idleFrameNumber, renderFrameNumber } from '../../core/rendering/renderFrameClock';
import { withAlpha } from '../../ui/theme/color';
import { KEY_INK } from '../../ui/theme/keyInk';
import { paintSoftBand } from '../lightMaps';
import { tracePolyline } from './itemIcons/iconPaint';
import {
  ALPHA_CHANNEL,
  pieceFieldSteps,
  reliefSteps,
  rampTable,
  RGBA_STRIDE,
  rampColor,
  reliefSize,
  shadeMetal,
  studio,
  type KeyRelief,
  type MetalFinish,
  type TurnAxis,
  type Rasterise,
  type Steps,
} from './keyArtMetal';
import {
  interiorCuts,
  itemAt,
  KEY_HALF_HEIGHT,
  piecesFor,
  traceKey,
  tracePiece,
  type Piece,
} from './keyArtShape';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;

/** Bakes are never finer than this many pixels per key unit: a phone's largest ceremony key, at its density. */
const MAX_UNIT_PX = 1024;
const MIN_UNIT_PX = 8;
/** Sizes are rounded up to the next of this many steps per doubling. */
const SIZE_STEPS_PER_OCTAVE = 4;
/** The steps a full turn is baked in. */
export const YAW_STEPS = 32;
const YAW_STEP = (Math.PI * 2) / YAW_STEPS;

/**
 * Room for the ceremonies' largest keys turning: a whole key's eight steps of
 * its swing at a phone's full density is about 16 MB, and a fragment's full
 * spin about the same again at the size it climbs at.
 */
const KEY_ART_BUDGET_MEGABYTES = 40;
const PROTECTED_FRAMES = 2;
/** A minute at sixty frames: the pause menu and a ceremony's settled screen keep theirs warm. */
const IDLE_RELEASE_FRAMES = 3600;

/** The thickness of the key's cast metal, as a share of its width. */
export const KEY_THICKNESS = 0.032;
/** A turning key's side wall is built from copies of its silhouette this many device pixels apart. */
const WALL_LAYER_SPACING_PX = 1.25;
const MAX_WALL_LAYERS = 16;
/** Side walls are baked at this share of the face's resolution; they are only ever seen squeezed. */
const WALL_RESOLUTION_SHARE = 0.5;
/** Rows of the side wall shaded for its gradient, top to bottom. */
const WALL_GRADIENT_STOPS = 7;
/** How far the side wall's rows lean up or down, as the sky and floor they reflect. */
const WALL_ROW_LEAN = 0.8;
const WALL_DIM = 0.82;
/** The torn faces where a fragment broke, drawn over its side wall. */
const BROKEN_WALL_WIDTH = 0.026;
const BROKEN_WALL_ALPHA = 0.75;

/** The seams' light: its halo, stroke and hot core as shares of the key's width, and how far it bleeds. */
const SEAM_HALO_WIDTH = 0.072;
const SEAM_WIDTH = 0.027;
const SEAM_CORE_WIDTH = 0.011;
const SEAM_BLUR = 0.03;
const SEAM_HALO_ALPHA = 0.7;
/** The seams' light is baked at this share of the key's resolution; it is mostly blur and burns for a second. */
const SEAM_RESOLUTION_SHARE = 0.5;
/** The engraved seams between a socket's pieces: a dark cut with a lit lower lip. */
const SOCKET_SEAM_WIDTH = 0.007;
const SOCKET_SEAM_LIP = 0.004;
const SOCKET_SEAM_MIN_PX = 1;
/** The glow round held pieces at full strength, as a share of the key's width. */
const HALO_BLUR = 0.07;
const HALO_PAD = HALO_BLUR * 2;
/** The halo is baked at this share of the key's resolution; it is all blur, so it holds when stretched. */
const HALO_RESOLUTION_SHARE = 0.5;

/** A soft band of light swept across the metal: its width and lean in key units, and its travel. */
const SWEEP = { width: 0.085, lean: 0.12, travel: 0.7 } as const;

/** Which part of the key a picture is of: the whole key, or one piece of `count`. */
export interface KeyPart {
  readonly key: KeyKind;
  readonly count: number;
  /** null for the whole key. */
  readonly piece: number | null;
}

export type BakeSpec =
  | {
      readonly art: 'face';
      readonly part: KeyPart;
      readonly yawStep: number;
      readonly axis: TurnAxis;
    }
  | {
      readonly art: 'wall';
      readonly part: KeyPart;
      readonly yawStep: number;
      readonly axis: TurnAxis;
    }
  | {
      readonly art: 'profile';
      readonly part: KeyPart;
      readonly yawStep: number;
      readonly axis: TurnAxis;
    }
  | { readonly art: 'socket'; readonly part: KeyPart }
  | { readonly art: 'halo'; readonly key: KeyKind; readonly held: readonly boolean[] }
  | { readonly art: 'seams'; readonly key: KeyKind; readonly count: number };

/** A baked picture and where its top-left corner sits in key units. */
export interface KeyBake {
  readonly surface: CanvasSurface;
  readonly left: number;
  readonly top: number;
  readonly unitPx: number;
}

const bakes = new RecentSurfaceCache<KeyBake>(
  KEY_ART_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE,
  PROTECTED_FRAMES,
  (bake) => bake.surface,
  IDLE_RELEASE_FRAMES,
);

/** Reliefs at the last few resolutions, newest last. */
const RELIEFS_KEPT = 2;
/**
 * A relief is several megabytes of arrays at a ceremony's size and is only
 * needed while new pictures are being baked, so it goes after ten seconds
 * unused, on the same idle clock as the pictures.
 */
const RELIEF_IDLE_FRAMES = 600;
const reliefs = new Map<number, { readonly relief: KeyRelief; usedIdleFrame: number }>();

onIdleSweep(() => {
  const oldestKept = idleFrameNumber() - RELIEF_IDLE_FRAMES;
  for (const [unitPx, held] of reliefs) {
    if (held.usedIdleFrame < oldestKept) reliefs.delete(unitPx);
  }
});

onCanvasRecovery(() => {
  bakes.clear();
  reliefs.clear();
});

/** The device pixels one CSS pixel covers along the transform's larger axis. */
export function deviceScale(ctx: Ctx): number {
  const t = ctx.getTransform();
  return Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d));
}

/** The bake resolution for a key `size` wide drawn through `ctx`. */
export function unitPxFor(ctx: Ctx, size: number): number {
  const device = Math.max(MIN_UNIT_PX, size * deviceScale(ctx));
  const stepped =
    2 ** (Math.ceil(Math.log2(device) * SIZE_STEPS_PER_OCTAVE) / SIZE_STEPS_PER_OCTAVE);
  return Math.min(MAX_UNIT_PX, Math.round(stepped));
}

/** The yaw step at or below `yaw`, and how far toward the next one it is. */
export function yawSteps(yaw: number): {
  readonly from: number;
  readonly to: number;
  readonly blend: number;
} {
  const steps = yaw / YAW_STEP;
  const lower = Math.floor(steps);
  const wrap = (step: number): number => ((step % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  return { from: wrap(lower), to: wrap(lower + 1), blend: steps - lower };
}

function partKey(part: KeyPart): string {
  return `${part.key}|${part.count}|${part.piece ?? 'whole'}`;
}

function specKey(spec: BakeSpec, unitPx: number): string {
  switch (spec.art) {
    case 'face':
    case 'wall':
    case 'profile':
      return `${spec.art}|${partKey(spec.part)}|${spec.axis}|${spec.yawStep}|${unitPx}`;
    case 'socket':
      return `socket|${partKey(spec.part)}|${unitPx}`;
    case 'halo':
      return `halo|${spec.key}|${spec.held.join(',')}|${unitPx}`;
    case 'seams':
      return `seams|${spec.key}|${spec.count}|${unitPx}`;
    default: {
      const unknown: never = spec;
      return unknown;
    }
  }
}

/** Rows of a rasterised scratch read back per step. */
const READ_BAND_ROWS = 48;

/** A rasteriser drawing in key units onto one readable scratch of the relief's size. */
function rasteriserFor(unitPx: number): { rasterise: Rasterise; done: () => void } | null {
  const { w, h } = reliefSize(unitPx);
  const scratch = allocReadableCanvas('ui', w, h);
  let ctx: Ctx;
  try {
    ctx = freshSurfaceContext(scratch);
  } catch {
    return null;
  }
  const rasterise: Rasterise = function* (paint) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(unitPx, 0, 0, unitPx, w / 2, h / 2);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    paint(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const alpha = new Uint8ClampedArray(w * h);
    for (let top = 0; top < h; top += READ_BAND_ROWS) {
      yield;
      const rows = Math.min(READ_BAND_ROWS, h - top);
      const rgba = ctx.getImageData(0, top, w, rows).data;
      const offset = top * w;
      for (let i = 0; i < w * rows; i++) {
        alpha[offset + i] = rgba[i * RGBA_STRIDE + ALPHA_CHANNEL];
      }
    }
    return alpha;
  };
  return { rasterise, done: () => releaseSurface(scratch) };
}

function* withRasteriser<T>(
  unitPx: number,
  use: (rasterise: Rasterise) => Steps<T>,
): Steps<T | null> {
  const made = rasteriserFor(unitPx);
  if (made === null) return null;
  try {
    return yield* use(made.rasterise);
  } finally {
    made.done();
  }
}

/** A relief being built, shared by every bake waiting on its resolution. */
interface ReliefBuild {
  readonly steps: Steps<KeyRelief | null>;
  usedIdleFrame: number;
}
const reliefBuilds = new Map<number, ReliefBuild>();

/** The relief at `unitPx`, advancing its shared build a step each time this is resumed. */
function* reliefAt(unitPx: number): Steps<KeyRelief | null> {
  for (;;) {
    const known = reliefs.get(unitPx);
    if (known) {
      reliefs.delete(unitPx);
      known.usedIdleFrame = idleFrameNumber();
      reliefs.set(unitPx, known);
      return known.relief;
    }
    let build = reliefBuilds.get(unitPx);
    if (build === undefined) {
      build = {
        steps: withRasteriser(unitPx, (rasterise) => reliefSteps(unitPx, rasterise)),
        usedIdleFrame: idleFrameNumber(),
      };
      reliefBuilds.set(unitPx, build);
    }
    build.usedIdleFrame = idleFrameNumber();
    const step = build.steps.next();
    if (step.done) {
      reliefBuilds.delete(unitPx);
      const built = step.value;
      if (built === null) return null;
      reliefs.set(unitPx, { relief: built, usedIdleFrame: idleFrameNumber() });
      for (const stale of reliefs.keys()) {
        if (reliefs.size <= RELIEFS_KEPT) break;
        if (stale !== unitPx) reliefs.delete(stale);
      }
      return built;
    }
    yield;
  }
}

function pieceOf(part: KeyPart): Piece | null {
  return part.piece === null ? null : (itemAt(piecesFor(part.count), part.piece) ?? null);
}

/** The columns of the relief a part covers, so a piece's picture is cropped to its band. */
function partColumns(unitPx: number, part: KeyPart): { x: number; w: number; h: number } {
  const { w, h } = reliefSize(unitPx);
  const piece = pieceOf(part);
  if (piece === null) return { x: 0, w, h };
  const toPx = (x: number): number => x * unitPx + w / 2;
  const x = Math.max(0, Math.floor(toPx(piece.span.left)) - 1);
  const right = Math.min(w, Math.ceil(toPx(piece.span.right)) + 1);
  return { x, w: Math.max(1, right - x), h };
}

function newSurface(w: number, h: number): { surface: CanvasSurface; ctx: Ctx } | null {
  const surface = allocCanvas('ui', Math.max(1, w), Math.max(1, h));
  try {
    return { surface, ctx: freshSurfaceContext(surface) };
  } catch {
    return null;
  }
}

/** Rows of a shaded picture written back per step. */
const WRITE_BAND_ROWS = 48;

function* shadedBake(
  unitPx: number,
  part: KeyPart,
  yaw: number,
  finish: MetalFinish,
  axis: TurnAxis,
): Steps<KeyBake | null> {
  const relief = yield* reliefAt(unitPx);
  if (relief === null) return null;
  const piece = pieceOf(part);
  const field =
    piece === null
      ? null
      : yield* withRasteriser(unitPx, (rasterise) =>
          pieceFieldSteps(relief, `${part.count}|${part.piece ?? ''}`, piece, rasterise),
        );
  if (piece !== null && field === null) return null;
  const columns = partColumns(unitPx, part);
  const made = newSurface(columns.w, relief.h);
  if (made === null) return null;
  let finished = false;
  try {
    const image = made.ctx.createImageData(columns.w, relief.h);
    const ink = KEY_INK[part.key];
    yield* shadeMetal(
      relief,
      { x: columns.x, y: 0, w: columns.w, h: relief.h },
      { angle: yaw, axis },
      {
        metal: rampTable(finish === 'polished' ? ink.metalRamp : ink.socketRamp),
        gem: rampTable(ink.gemRamp),
      },
      field,
      finish,
      image.data,
    );
    for (let top = 0; top < relief.h; top += WRITE_BAND_ROWS) {
      yield;
      const rows = Math.min(WRITE_BAND_ROWS, relief.h - top);
      made.ctx.putImageData(image, 0, 0, 0, top, columns.w, rows);
    }
    const bake: KeyBake = {
      surface: made.surface,
      left: (columns.x - relief.w / 2) / unitPx,
      top: -relief.h / 2 / unitPx,
      unitPx,
    };
    if (finish === 'socket') engraveSeams(made.ctx, bake, part);
    finished = true;
    return bake;
  } finally {
    if (!finished) releaseSurface(made.surface);
  }
}

/** Sets `ctx` to draw in key units over `bake`'s pixels. */
function inBakeUnits(ctx: Ctx, bake: KeyBake): void {
  ctx.setTransform(
    bake.unitPx,
    0,
    0,
    bake.unitPx,
    -bake.left * bake.unitPx,
    -bake.top * bake.unitPx,
  );
}

function engraveSeams(ctx: Ctx, bake: KeyBake, part: KeyPart): void {
  const ink = KEY_INK[part.key];
  const piece = pieceOf(part);
  const cuts = piece === null ? interiorCuts(part.count) : piece.cuts;
  if (cuts.length === 0) return;
  inBakeUnits(ctx, bake);
  const px = 1 / bake.unitPx;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const width = Math.max(SOCKET_SEAM_WIDTH, px * SOCKET_SEAM_MIN_PX);
  const lip = Math.max(SOCKET_SEAM_LIP, px);
  for (const cut of cuts) {
    ctx.translate(lip, lip);
    ctx.strokeStyle = ink.silhouetteLine;
    ctx.lineWidth = width;
    tracePolyline(ctx, cut);
    ctx.stroke();
    ctx.translate(-lip, -lip);
    ctx.strokeStyle = ink.outline;
    tracePolyline(ctx, cut);
    ctx.stroke();
  }
  ctx.restore();
}

/** The side wall's colour down its height for a key turned `yaw`, as gradient stops. */
/**
 * The side wall's colour along the way it varies for a key turned `yaw` about
 * `axis`, as gradient stops. Turned upright, the wall seen is a left or right
 * wall, its rows leaning up to the sky or down to the floor; turned about its
 * length, it is the top or bottom wall, its columns leaning left and right.
 */
function wallStops(key: KeyKind, yaw: number, axis: TurnAxis): readonly string[] {
  const table = rampTable(KEY_INK[key].metalRamp);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const side = sin >= 0 ? -1 : 1;
  return Array.from({ length: WALL_GRADIENT_STOPS }, (_, i) => {
    const lean = ((i / (WALL_GRADIENT_STOPS - 1)) * 2 - 1) * WALL_ROW_LEAN;
    const facing = Math.sqrt(Math.max(0, 1 - lean * lean));
    const wz = -side * facing * sin;
    const turned = side * facing * cos;
    const [wx, wy] = axis === 'upright' ? [turned, lean] : [lean, turned];
    const seen = studio(2 * wz * wx, 2 * wz * wy, 2 * wz * wz - 1);
    return rampColor(table, seen * WALL_DIM);
  });
}

function wallBake(unitPx: number, part: KeyPart, yawStep: number, axis: TurnAxis): KeyBake | null {
  const wallUnit = Math.max(MIN_UNIT_PX, Math.round(unitPx * WALL_RESOLUTION_SHARE));
  const columns = partColumns(wallUnit, part);
  const made = newSurface(columns.w, columns.h);
  if (made === null) return null;
  const { w } = reliefSize(wallUnit);
  const bake: KeyBake = {
    surface: made.surface,
    left: (columns.x - w / 2) / wallUnit,
    top: -columns.h / 2 / wallUnit,
    unitPx: wallUnit,
  };
  const { ctx } = made;
  const ink = KEY_INK[part.key];
  inBakeUnits(ctx, bake);
  const piece = pieceOf(part);
  ctx.save();
  if (piece !== null) {
    tracePiece(ctx, piece);
    ctx.clip();
  }
  traceKey(ctx);
  const stops = wallStops(part.key, yawStep * YAW_STEP, axis);
  const gradient =
    axis === 'upright'
      ? ctx.createLinearGradient(0, -KEY_HALF_HEIGHT, 0, KEY_HALF_HEIGHT)
      : ctx.createLinearGradient(-HALF, 0, HALF, 0);
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = gradient;
  ctx.fill();
  if (piece !== null) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = withAlpha(ink.outline, BROKEN_WALL_ALPHA);
    ctx.lineWidth = BROKEN_WALL_WIDTH;
    ctx.lineJoin = 'round';
    for (const cut of piece.cuts) {
      tracePolyline(ctx, cut);
      ctx.stroke();
    }
  }
  ctx.restore();
  return bake;
}

/** A row of the edge-on profile with less than this alpha in its squeezed wall has no metal in it. */
const PROFILE_EMPTY_ALPHA = 4;
const OPAQUE = 255;

/**
 * The key seen exactly edge-on: one column, each row the side wall's colour
 * where the row holds any metal at all. Squeezing the wall's own picture to
 * a column averages each row's metal with the empty space beside it, which
 * would leave a turned key's thin edge half see-through.
 */
/**
 * The key seen exactly edge-on to its turn: for an upright turn one column,
 * each row the side wall's colour where the row holds any metal; for a turn
 * about its length one row, each column likewise. Squeezing the wall's own
 * picture to a line averages its metal with the empty space beside it, which
 * would leave a turned key's thin edge half see-through.
 */
function profileBake(
  unitPx: number,
  part: KeyPart,
  yawStep: number,
  axis: TurnAxis,
): KeyBake | null {
  const wall = keyBake({ art: 'wall', part, yawStep, axis }, unitPx);
  if (wall === null) return null;
  const { width, height } = wall.surface;
  const upright = axis === 'upright';
  const lineW = upright ? 1 : width;
  const lineH = upright ? height : 1;
  const line = allocReadableCanvas('ui', lineW, lineH);
  let ctx: Ctx;
  try {
    ctx = freshSurfaceContext(line);
  } catch {
    return null;
  }
  ctx.drawImage(wall.surface, 0, 0, width, height, 0, 0, lineW, lineH);
  const image = ctx.getImageData(0, 0, lineW, lineH);
  for (let i = 0; i < lineW * lineH; i++) {
    const alpha = i * RGBA_STRIDE + ALPHA_CHANNEL;
    image.data[alpha] = image.data[alpha] < PROFILE_EMPTY_ALPHA ? 0 : OPAQUE;
  }
  ctx.putImageData(image, 0, 0);
  return { surface: line, left: wall.left, top: wall.top, unitPx: wall.unitPx };
}

function paddedBake(
  unitPx: number,
  pad: number,
  paint: (ctx: Ctx, bake: KeyBake) => void,
): KeyBake | null {
  const { w, h } = reliefSize(unitPx);
  const padPx = Math.ceil(pad * unitPx);
  const made = newSurface(w + padPx * 2, h + padPx * 2);
  if (made === null) return null;
  const bake: KeyBake = {
    surface: made.surface,
    left: -(w / 2 + padPx) / unitPx,
    top: -(h / 2 + padPx) / unitPx,
    unitPx,
  };
  inBakeUnits(made.ctx, bake);
  paint(made.ctx, bake);
  return bake;
}

function haloBake(unitPx: number, key: KeyKind, held: readonly boolean[]): KeyBake | null {
  const ink = KEY_INK[key];
  const pieces = piecesFor(held.length).filter((_, i) => itemAt(held, i) === true);
  const haloUnit = Math.max(MIN_UNIT_PX, Math.round(unitPx * HALO_RESOLUTION_SHARE));
  return paddedBake(haloUnit, HALO_PAD, (ctx) => {
    ctx.shadowColor = ink.glow;
    ctx.shadowBlur = HALO_BLUR * haloUnit;
    ctx.fillStyle = ink.glow;
    for (const piece of pieces) {
      ctx.save();
      tracePiece(ctx, piece);
      ctx.clip();
      traceKey(ctx);
      ctx.fill();
      ctx.restore();
    }
  });
}

function seamsBake(unitPx: number, key: KeyKind, count: number): KeyBake | null {
  const ink = KEY_INK[key];
  const cuts = interiorCuts(count);
  if (cuts.length === 0) return null;
  const seamUnit = Math.max(MIN_UNIT_PX, Math.round(unitPx * SEAM_RESOLUTION_SHARE));
  return paddedBake(seamUnit, SEAM_BLUR * 2, (ctx) => {
    ctx.save();
    traceKey(ctx);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const strokeAll = (color: string, width: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const cut of cuts) {
        tracePolyline(ctx, cut);
        ctx.stroke();
      }
    };
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = ink.glow;
    ctx.shadowBlur = SEAM_BLUR * seamUnit;
    strokeAll(withAlpha(ink.glow, SEAM_HALO_ALPHA), SEAM_HALO_WIDTH);
    strokeAll(ink.glow, SEAM_WIDTH);
    ctx.shadowBlur = 0;
    strokeAll(ink.glint, SEAM_CORE_WIDTH);
    ctx.restore();
  });
}

/** The pictures that are shaded pixel by pixel, baked in steps across frames. */
type ShadedSpec = Extract<BakeSpec, { readonly art: 'face' | 'socket' }>;
type DrawnSpec = Exclude<BakeSpec, ShadedSpec>;

function isShaded(spec: BakeSpec): spec is ShadedSpec {
  return spec.art === 'face' || spec.art === 'socket';
}

function shadedSteps(spec: ShadedSpec, unitPx: number): Steps<KeyBake | null> {
  switch (spec.art) {
    case 'face':
      return shadedBake(unitPx, spec.part, spec.yawStep * YAW_STEP, 'polished', spec.axis);
    case 'socket':
      return shadedBake(unitPx, spec.part, 0, 'socket', 'upright');
    default: {
      const unknown: never = spec;
      return unknown;
    }
  }
}

/** The pictures drawn with a few canvas calls, cheap enough to bake the moment they are wanted. */
function drawnNow(spec: DrawnSpec, unitPx: number): KeyBake | null {
  switch (spec.art) {
    case 'wall':
      return wallBake(unitPx, spec.part, spec.yawStep, spec.axis);
    case 'profile':
      return profileBake(unitPx, spec.part, spec.yawStep, spec.axis);
    case 'halo':
      return haloBake(unitPx, spec.key, spec.held);
    case 'seams':
      return seamsBake(unitPx, spec.key, spec.count);
    default: {
      const unknown: never = spec;
      return unknown;
    }
  }
}

/**
 * The milliseconds of each frame shaded bakes may spend between them, so a
 * picture that takes a hundred milliseconds to shade arrives over a couple of
 * dozen frames and none of them stutters.
 */
const BAKE_BUDGET_MS = 3;
let budgetMs = BAKE_BUDGET_MS;
/** A shaded bake nobody has asked after for this long is abandoned, its scratch given back. */
const JOB_IDLE_FRAMES = 300;
/** The resolution a picture is baked at in one go when nothing nearer is ready: a few milliseconds, once. */
const STAND_IN_UNIT_PX = 80;

interface BakeJob {
  readonly steps: Steps<KeyBake | null>;
  usedIdleFrame: number;
}
const jobs = new Map<string, BakeJob>();
let budgetFrame = -1;
let spentMs = 0;

function abandonJobs(idleBefore: number): void {
  for (const [key, job] of jobs) {
    if (job.usedIdleFrame >= idleBefore) continue;
    jobs.delete(key);
    job.steps.return(null);
  }
  for (const [unitPx, build] of reliefBuilds) {
    if (build.usedIdleFrame >= idleBefore) continue;
    reliefBuilds.delete(unitPx);
    build.steps.return(null);
  }
}

onIdleSweep(() => abandonJobs(idleFrameNumber() - JOB_IDLE_FRAMES));
onCanvasRecovery(() => abandonJobs(Number.POSITIVE_INFINITY));

/**
 * Lifts the per-frame bake budget, so every picture is finished the moment it
 * is asked for. Only for offline renders, which draw a single frame and
 * capture it, and so would otherwise capture stand-ins.
 */
export function bakeKeyArtWhole(): void {
  budgetMs = Number.POSITIVE_INFINITY;
}

/** What is left of this frame's bake budget, in milliseconds. */
export function budgetLeftMs(): number {
  const frame = renderFrameNumber();
  if (frame !== budgetFrame) {
    budgetFrame = frame;
    spentMs = 0;
  }
  return budgetMs - spentMs;
}

/** Runs `job` until it finishes or this frame's budget is spent; undefined while unfinished. */
function advance(key: string, job: BakeJob, budgetMs: number): KeyBake | null | undefined {
  const start = performance.now();
  try {
    do {
      const step = job.steps.next();
      if (step.done) {
        jobs.delete(key);
        if (step.value !== null) bakes.set(key, step.value);
        return step.value;
      }
    } while (performance.now() - start < budgetMs);
    return undefined;
  } finally {
    spentMs += performance.now() - start;
  }
}

/**
 * The picture `spec` describes at `unitPx`, or null while it is still being
 * baked. A shaded picture is advanced by whatever is left of this frame's
 * bake budget each time it is asked for; a drawn one is baked at once.
 */
export function keyBake(spec: BakeSpec, unitPx: number): KeyBake | null {
  const key = specKey(spec, unitPx);
  const known = bakes.get(key);
  if (known) return known;
  if (!isShaded(spec)) {
    budgetLeftMs();
    const start = performance.now();
    const drawn = drawnNow(spec, unitPx);
    spentMs += performance.now() - start;
    if (drawn !== null) bakes.set(key, drawn);
    return drawn;
  }
  let job = jobs.get(key);
  if (job === undefined) {
    job = { steps: shadedSteps(spec, unitPx), usedIdleFrame: idleFrameNumber() };
    jobs.set(key, job);
  }
  job.usedIdleFrame = idleFrameNumber();
  const budget = budgetLeftMs();
  if (budget <= 0) return null;
  return advance(key, job, budget) ?? null;
}

/** The resolutions a picture has been asked for at, so a stand-in can be found among them. */
const resolutionsAsked = new Map<string, Set<number>>();

function remember(spec: BakeSpec, unitPx: number): void {
  const key = specKey(spec, 0);
  const known = resolutionsAsked.get(key);
  if (known) known.add(unitPx);
  else resolutionsAsked.set(key, new Set([unitPx]));
}

/** `spec` already baked at the resolution nearest `unitPx`, preferring a finer one. */
function nearestBaked(spec: BakeSpec, unitPx: number): KeyBake | null {
  const sizes = [...(resolutionsAsked.get(specKey(spec, 0)) ?? [])].sort(
    (a, b) => Math.abs(Math.log2(a / unitPx)) - Math.abs(Math.log2(b / unitPx)) || b - a,
  );
  for (const size of sizes) {
    if (!hasKeyBake(spec, size)) continue;
    return keyBake(spec, size);
  }
  return null;
}

/** Bakes `spec` at the stand-in resolution in one go, a blurry picture that never stalls a frame. */
function standIn(spec: ShadedSpec): KeyBake | null {
  const key = specKey(spec, STAND_IN_UNIT_PX);
  const known = bakes.get(key);
  if (known) return known;
  const steps = jobs.get(key)?.steps ?? shadedSteps(spec, STAND_IN_UNIT_PX);
  jobs.delete(key);
  budgetLeftMs();
  const start = performance.now();
  try {
    for (;;) {
      const step = steps.next();
      if (!step.done) continue;
      if (step.value !== null) {
        bakes.set(key, step.value);
        remember(spec, STAND_IN_UNIT_PX);
      }
      return step.value;
    }
  } finally {
    spentMs += performance.now() - start;
  }
}

/**
 * The picture `spec` describes at `unitPx` if it is ready, or else the
 * nearest stand-in: the same picture at another resolution, or a small bake
 * made at once. Drawing never waits on a bake.
 */
export function keyBakeOrStandIn(spec: ShadedSpec, unitPx: number): KeyBake | null {
  remember(spec, unitPx);
  return keyBake(spec, unitPx) ?? nearestBaked(spec, unitPx) ?? standIn(spec);
}

/**
 * The face of `part` turned to `yawStep` if it is ready, else the nearest
 * step already baked at this resolution, else a stand-in.
 */
export function turnedFace(
  part: KeyPart,
  yawStep: number,
  axis: TurnAxis,
  unitPx: number,
): KeyBake | null {
  const spec: ShadedSpec = { art: 'face', part, yawStep, axis };
  remember(spec, unitPx);
  const wanted = keyBake(spec, unitPx);
  if (wanted !== null) return wanted;
  for (let offset = 1; offset <= YAW_STEPS / 2; offset++) {
    for (const step of [yawStep - offset, yawStep + offset]) {
      const wrapped = ((step % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
      const near: BakeSpec = { art: 'face', part, yawStep: wrapped, axis };
      if (hasKeyBake(near, unitPx)) return keyBake(near, unitPx);
    }
  }
  return nearestBaked(spec, unitPx) ?? standIn(spec);
}

/** Whether the picture is already baked, without baking it. */
export function hasKeyBake(spec: BakeSpec, unitPx: number): boolean {
  return bakes.get(specKey(spec, unitPx)) !== undefined;
}

/** Draws `bake` for a whole-key box `size` wide centred on (`cx`, `cy`). */
export function blitBake(ctx: Ctx, bake: KeyBake, cx: number, cy: number, size: number): void {
  const scale = size / bake.unitPx;
  ctx.drawImage(
    bake.surface,
    cx + bake.left * size,
    cy + bake.top * size,
    bake.surface.width * scale,
    bake.surface.height * scale,
  );
}

/** One scratch for sweeping light across a picture, grown to the largest picture swept. */
let sweepScratch: { surface: CanvasSurface; ctx: Ctx } | null = null;
let sweepScratchUsedIdleFrame = 0;

function releaseSweepScratch(): void {
  if (sweepScratch !== null) releaseSurface(sweepScratch.surface);
  sweepScratch = null;
}

onCanvasRecovery(releaseSweepScratch);
onIdleSweep(() => {
  if (idleFrameNumber() - sweepScratchUsedIdleFrame > IDLE_RELEASE_FRAMES) releaseSweepScratch();
});

function scratchFor(w: number, h: number): { surface: CanvasSurface; ctx: Ctx } | null {
  sweepScratchUsedIdleFrame = idleFrameNumber();
  const current = sweepScratch;
  if (current !== null && current.surface.width >= w && current.surface.height >= h) return current;
  if (current !== null) {
    resizeSurface(
      current.surface,
      Math.max(w, current.surface.width),
      Math.max(h, current.surface.height),
    );
    return current;
  }
  const made = newSurface(w, h);
  sweepScratch = made;
  return made;
}

/**
 * A soft band of `color` swept across `bake`'s own pixels at `phase` (0 off
 * the key's left, 1 off its right), drawn like {@link blitBake}.
 */
export function blitSweep(
  ctx: Ctx,
  bake: KeyBake,
  cx: number,
  cy: number,
  size: number,
  phase: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const { width, height } = bake.surface;
  const scratch = scratchFor(width, height);
  if (scratch === null) return;
  const sctx = scratch.ctx;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = 'source-over';
  sctx.clearRect(0, 0, width, height);
  sctx.drawImage(bake.surface, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  inBakeUnits(sctx, bake);
  const x = -SWEEP.travel + phase * SWEEP.travel * 2;
  const reach = KEY_HALF_HEIGHT;
  const lean = Math.atan2(2 * SWEEP.lean, 2 * reach);
  const bakeHeight = height / bake.unitPx;
  const bakeWidth = width / bake.unitPx;
  // Long enough to cross the whole picture at its lean, so its ends never show.
  const halfLength = Math.hypot(bakeWidth, bakeHeight);
  paintSoftBand(sctx, { x, y: 0 }, SWEEP.width, halfLength, lean, color, alpha);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = 'source-over';
  const scale = size / bake.unitPx;
  ctx.drawImage(
    scratch.surface,
    0,
    0,
    width,
    height,
    cx + bake.left * size,
    cy + bake.top * size,
    width * scale,
    height * scale,
  );
}

/** How many side-wall layers a key `size` wide turned to `sin` of its yaw needs. */
export function wallLayers(ctx: Ctx, size: number, sin: number): number {
  const reach = Math.abs(sin) * size * KEY_THICKNESS * deviceScale(ctx);
  return Math.min(MAX_WALL_LAYERS, Math.ceil(reach / WALL_LAYER_SPACING_PX));
}
