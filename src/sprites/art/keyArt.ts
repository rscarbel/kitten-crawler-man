/**
 * The keys a party collects floor by floor, drawn as cast and polished metal:
 * the whole key, any one of its fragments, the empty socket that fills in as
 * fragments arrive, and the key or a fragment turning in the light as a solid
 * with a back, a face and a side wall.
 *
 * The key lies on its side, bow to the left and bit to the right, inside a box
 * `size` pixels wide and `size * KEY_ART_ASPECT` tall centred on the given
 * point. Its shape and where it breaks are in `keyArtShape`, its shading in
 * `keyArtMetal`; every picture here is a blit of a bake from `keyArtBakes`,
 * so drawing a key every frame costs a few `drawImage` calls.
 *
 * Every painter is a pure function of its arguments. Colours come from
 * `KEY_INK`.
 */

import type { KeyKind } from '../../core/keys/keyKinds';
import { KEY_INK } from '../../ui/theme/keyInk';
import { glint as paintGlint } from './itemIcons/iconPaint';
import {
  blitBake,
  blitSweep,
  budgetLeftMs,
  hasKeyBake,
  keyBake,
  keyBakeOrStandIn,
  turnedFace,
  YAW_STEPS,
  KEY_THICKNESS,
  unitPxFor,
  wallLayers,
  yawSteps,
  type BakeSpec,
  type KeyBake,
  type KeyPart,
} from './keyArtBakes';
import type { TurnAxis } from './keyArtMetal';
import {
  BOW,
  CUT_JAG,
  GEM,
  itemAt,
  KEY_ART_ASPECT,
  piecesFor,
  traceKey,
  tracePiece,
} from './keyArtShape';

export { KEY_ART_ASPECT } from './keyArtShape';
export { bakeKeyArtWhole } from './keyArtBakes';

type Ctx = CanvasRenderingContext2D;

/**
 * The centre of piece `index` of `count`, relative to the whole key's box
 * centre, in units of the box's width: multiply by `size` for pixels.
 */
export function fragmentPieceOffset(index: number, count: number): { x: number; y: number } {
  const piece = itemAt(piecesFor(count), index);
  return piece ? { x: piece.centre.x, y: piece.centre.y } : { x: 0, y: 0 };
}

/** Room round a piece for its broken edge's splinters, in key units. */
const PIECE_EDGE_ALLOWANCE = 0.02;

/**
 * How much room piece `index` of `count` takes, in units of the whole key's
 * box width, with its jagged edges: scale a piece to fit a slot by dividing
 * the slot by this.
 */
export function fragmentPieceExtent(index: number, count: number): { w: number; h: number } {
  const piece = itemAt(piecesFor(count), index);
  if (!piece) return { w: 1, h: KEY_ART_ASPECT };
  const margin = (CUT_JAG + PIECE_EDGE_ALLOWANCE) * 2;
  return { w: piece.extent.w + margin, h: piece.extent.h + margin };
}

/** How bright the band of light swept across a still key is. */
const SWEEP_ALPHA = 0.4;
const SHIMMER_ALPHA = 0.4;
/** The star that flares on the gem as a sweep passes it, as a share of the key's width. */
const STAR_GLINT_RADIUS = 0.06;
/** A turning key is never squeezed thinner than this share of its face, so a canvas can still draw it. */
const MIN_SQUEEZE = 0.004;
/** Within this much of edge-on (as the cosine of the turn) the key's solid edge shows as one strip. */
const EDGE_ON_FADE = 0.2;
/** A blend weight between two turn steps below this draws only the nearer one. */
const BLEND_EPSILON = 0.02;

function drawable(cx: number, cy: number, size: number): boolean {
  return size > 0 && Number.isFinite(size) && Number.isFinite(cx) && Number.isFinite(cy);
}

/** A flat fill in the key's base metal, for a canvas that refused a bake. */
function paintPlain(ctx: Ctx, cx: number, cy: number, size: number, part: KeyPart): void {
  const piece = part.piece === null ? null : itemAt(piecesFor(part.count), part.piece);
  ctx.save();
  try {
    ctx.translate(cx, cy);
    ctx.scale(size, size);
    if (piece) {
      tracePiece(ctx, piece);
      ctx.clip();
    }
    traceKey(ctx);
    ctx.fillStyle = KEY_INK[part.key].metal.base;
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/** Whether `part` holds the gem, so a sweep passing it may flare a star there. */
function holdsGem(part: KeyPart): boolean {
  if (part.piece === null) return true;
  const piece = itemAt(piecesFor(part.count), part.piece);
  return (
    piece !== undefined &&
    piece.span.left <= BOW.x - GEM.radius &&
    piece.span.right >= BOW.x + GEM.radius
  );
}

function flareGem(
  ctx: Ctx,
  part: KeyPart,
  gemX: number,
  cy: number,
  size: number,
  glint: number,
): void {
  if (!holdsGem(part)) return;
  const flare = Math.sin(Math.min(1, Math.max(0, glint)) * Math.PI);
  if (flare <= 0) return;
  paintGlint(ctx, gemX, cy, STAR_GLINT_RADIUS * size * flare, KEY_INK[part.key].glint);
}

/** The bake resolution for a picture `size` wide that asked for the bake of one `bakeWidth` wide. */
function resolutionFor(ctx: Ctx, size: number, bakeWidth: number | undefined): number {
  const wider =
    bakeWidth !== undefined && Number.isFinite(bakeWidth) ? Math.max(size, bakeWidth) : size;
  return unitPxFor(ctx, wider);
}

function drawStill(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  part: KeyPart,
  glint?: number,
  bakeWidth?: number,
): void {
  if (!drawable(cx, cy, size)) return;
  const face = keyBakeOrStandIn(
    { art: 'face', part, yawStep: 0, axis: 'upright' },
    resolutionFor(ctx, size, bakeWidth),
  );
  if (face === null) {
    paintPlain(ctx, cx, cy, size, part);
    return;
  }
  blitBake(ctx, face, cx, cy, size);
  if (glint === undefined) return;
  blitSweep(ctx, face, cx, cy, size, glint, KEY_INK[part.key].glint, SWEEP_ALPHA);
  flareGem(ctx, part, cx + BOW.x * size, cy, size, glint);
}

/**
 * The whole key, `size` pixels wide, centred on (`cx`, `cy`). `glint`, 0..1,
 * sweeps a soft band of light across the metal from left to right and flares
 * a star on the gem as it passes the middle; leave it out for a still key.
 * `bakeWidth`, at least `size`, draws from the bake made for a key that
 * wide, so a key that shrinks in flight reuses the bake it started from.
 */
export function paintKey(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  kind: KeyKind,
  glint?: number,
  bakeWidth?: number,
): void {
  drawStill(ctx, cx, cy, size, { key: kind, count: 1, piece: null }, glint, bakeWidth);
}

/**
 * Piece `index` of the key broken into `count`, drawn where it sits inside the
 * whole key's box centred on (`cx`, `cy`). To draw a piece centred somewhere
 * else, shift by `-fragmentPieceOffset(index, count)` times `size`.
 * `bakeWidth`, at least `size`, draws from the bake made for a key that wide,
 * so a piece that grows or shrinks across frames reuses one bake.
 */
export function paintKeyFragment(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  kind: KeyKind,
  index: number,
  count: number,
  glint?: number,
  bakeWidth?: number,
): void {
  if (itemAt(piecesFor(count), index) === undefined) return;
  drawStill(ctx, cx, cy, size, { key: kind, count, piece: index }, glint, bakeWidth);
}

/** Light along a forged key's seams, drawn over a face already placed. */
interface SeamGlow {
  readonly count: number;
  /** 0..1: how bright the seams burn. */
  readonly alpha: number;
}

export interface TurnedKeyOptions {
  /** 0..1: where a sweep of light is across the face; leave out for none. */
  readonly glint?: number;
  readonly seams?: SeamGlow;
  /** At least `size`: draw from the bake made for a key this wide, so a turning piece that grows reuses it. */
  readonly bakeWidth?: number;
  /**
   * What the key turns about: `upright`, the axis across its length (a key
   * spun to show its back), or `length`, its own shank (a key turning in a
   * lock, its bow and bit going edge-on and back). Defaults to `upright`.
   */
  readonly axis?: KeyTurnAxis;
}

/** The axis a turned key turns about; see {@link TurnedKeyOptions.axis}. */
export type KeyTurnAxis = TurnAxis;

/**
 * The key, or one piece of it, turned `yaw` radians about `options.axis` as a
 * solid: the face it shows foreshortened across that axis, its reflections
 * shaded for the angle, and the wall of its thickness showing beside it as it
 * turns.
 */
function drawTurned(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  part: KeyPart,
  yaw: number,
  options: TurnedKeyOptions,
): void {
  if (!drawable(cx, cy, size) || !Number.isFinite(yaw)) return;
  const piece = part.piece === null ? null : itemAt(piecesFor(part.count), part.piece);
  if (part.piece !== null && !piece) return;
  const unitPx = resolutionFor(ctx, size, options.bakeWidth);
  const axis: TurnAxis = options.axis ?? 'upright';
  const pivotX = cx + (piece ? piece.centre.x * size : 0);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const squeeze = Math.sign(cos || 1) * Math.max(MIN_SQUEEZE, Math.abs(cos));
  const halfThickness = (size * KEY_THICKNESS) / 2;
  const nearZ = cos >= 0 ? halfThickness : -halfThickness;
  const steps = yawSteps(yaw);
  const nearest = steps.blend < 1 / 2 ? steps.from : steps.to;
  const layers = wallLayers(ctx, size, sin);
  const wall = layers > 0 ? keyBake({ art: 'wall', part, yawStep: nearest, axis }, unitPx) : null;
  const alongLength = axis === 'length';
  // A flat key turning about an axis is foreshortened across that axis and
  // its thickness steps out beside it; the face drawn is the bake shaded for
  // this angle, so the light moves over the metal as it turns.
  const placed = (z: number, draw: () => void): void => {
    ctx.save();
    try {
      if (alongLength) {
        ctx.translate(pivotX, cy + z * sin);
        ctx.scale(1, squeeze);
      } else {
        ctx.translate(pivotX + z * sin, cy);
        ctx.scale(squeeze, 1);
      }
      draw();
    } finally {
      ctx.restore();
    }
  };
  const left = cx - pivotX;
  const edgeOn = 1 - Math.abs(cos) / EDGE_ON_FADE;
  const profile =
    edgeOn > 0 ? keyBake({ art: 'profile', part, yawStep: nearest, axis }, unitPx) : null;
  if (profile !== null) {
    const span = Math.max(1, 2 * halfThickness * Math.abs(sin));
    const scale = size / profile.unitPx;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, edgeOn);
    if (alongLength) {
      ctx.drawImage(
        profile.surface,
        cx + profile.left * size,
        cy - span / 2,
        profile.surface.width * scale,
        span,
      );
    } else {
      ctx.drawImage(
        profile.surface,
        pivotX - span / 2,
        cy + profile.top * size,
        span,
        profile.surface.height * scale,
      );
    }
    ctx.restore();
  }
  if (wall !== null) {
    for (let layer = 0; layer < layers; layer++) {
      const z = -nearZ + (2 * nearZ * layer) / layers;
      placed(z, () => blitBake(ctx, wall, left, 0, size));
    }
  }
  const from = turnedFace(part, steps.from, axis, unitPx);
  if (from === null) {
    placed(nearZ, () => paintPlain(ctx, left, 0, size, part));
    return;
  }
  const to =
    steps.blend > BLEND_EPSILON
      ? keyBake({ art: 'face', part, yawStep: steps.to, axis }, unitPx)
      : null;
  const shown: KeyBake = to !== null && steps.blend > 1 / 2 ? to : from;
  placed(nearZ, () => {
    blitBake(ctx, from, left, 0, size);
    if (to !== null) {
      ctx.globalAlpha *= steps.blend;
      blitBake(ctx, to, left, 0, size);
    }
  });
  const ink = KEY_INK[part.key];
  const { glint, seams } = options;
  placed(nearZ, () => {
    if (glint !== undefined) blitSweep(ctx, shown, left, 0, size, glint, ink.glint, SWEEP_ALPHA);
    if (seams !== undefined && seams.alpha > 0) {
      const glow = keyBake({ art: 'seams', key: part.key, count: seams.count }, unitPx);
      if (glow === null) return;
      ctx.globalAlpha *= Math.min(1, seams.alpha);
      // Added light, so the seam reads as burning through the gold rather than painted on it.
      ctx.globalCompositeOperation = 'lighter';
      blitBake(ctx, glow, left, 0, size);
    }
  });
  if (glint !== undefined) {
    const gemX = alongLength
      ? pivotX + left + BOW.x * size
      : pivotX + nearZ * sin + (left + BOW.x * size) * squeeze;
    const gemY = alongLength ? cy + nearZ * sin : cy;
    flareGem(ctx, part, gemX, gemY, size, glint);
  }
}

/**
 * The whole key, `size` pixels wide, centred on (`cx`, `cy`), turned `yaw`
 * radians about `options.axis` (its upright axis unless told otherwise): 0
 * faces the viewer, past a quarter turn its back shows. The seams of a key
 * forged from fragments can glow on it.
 */
export function paintKeyTurned(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  kind: KeyKind,
  yaw: number,
  options: TurnedKeyOptions = {},
): void {
  drawTurned(ctx, cx, cy, size, { key: kind, count: 1, piece: null }, yaw, options);
}

/**
 * Piece `index` of `count`, placed as {@link paintKeyFragment} places it and
 * turned `yaw` radians about its own upright axis through its centre (the
 * one axis a loose fragment spins about).
 * `bakeWidth` is as {@link paintKeyFragment} takes it.
 */
export function paintKeyFragmentTurned(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  kind: KeyKind,
  index: number,
  count: number,
  yaw: number,
  glint?: number,
  bakeWidth?: number,
): void {
  drawTurned(ctx, cx, cy, size, { key: kind, count, piece: index }, yaw, { glint, bakeWidth });
}

/**
 * Piece `index` of `count` as it looks while missing: the empty socket of
 * that piece alone, placed as {@link paintKeyFragment} places it.
 */
export function paintMissingKeyFragment(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  kind: KeyKind,
  index: number,
  count: number,
): void {
  if (!drawable(cx, cy, size) || itemAt(piecesFor(count), index) === undefined) return;
  const part: KeyPart = { key: kind, count, piece: index };
  const socket = keyBakeOrStandIn({ art: 'socket', part }, unitPxFor(ctx, size));
  if (socket !== null) blitBake(ctx, socket, cx, cy, size);
}

export interface SilhouetteOptions {
  /** 0..1: where a slow band of light is in its sweep across the held pieces. Leave out to hold still. */
  readonly shimmer?: number;
  /** 0..1: how strongly the held pieces glow round their edge. */
  readonly edgeGlow?: number;
  /** 0..1: how solid the held pieces' gold is; 1 when left out. */
  readonly litPieces?: number;
}

/**
 * The whole key as an empty socket, `size` pixels wide, centred on (`cx`,
 * `cy`), with each piece whose `heldMask` entry is true set into it in its
 * metal. The mask's length is the number of pieces; the seams between them
 * are cut into the socket so a missing piece still reads as a piece.
 */
export function paintKeySilhouette(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  kind: KeyKind,
  heldMask: readonly boolean[],
  opts: SilhouetteOptions = {},
): void {
  if (!drawable(cx, cy, size)) return;
  const count = Math.max(1, heldMask.length);
  const unitPx = unitPxFor(ctx, size);
  const socket = keyBakeOrStandIn(
    { art: 'socket', part: { key: kind, count, piece: null } },
    unitPx,
  );
  if (socket !== null) blitBake(ctx, socket, cx, cy, size);
  const held = heldMask.flatMap((isHeld, index) => (isHeld ? [index] : []));
  if (held.length === 0) return;
  const lit = Math.min(1, Math.max(0, opts.litPieces ?? 1));
  const edgeGlow = Math.min(1, Math.max(0, opts.edgeGlow ?? 0));
  ctx.save();
  try {
    if (edgeGlow > 0) {
      const halo = keyBake({ art: 'halo', key: kind, held: heldMask }, unitPx);
      if (halo !== null) {
        ctx.globalAlpha *= edgeGlow;
        blitBake(ctx, halo, cx, cy, size);
        ctx.globalAlpha /= edgeGlow;
      }
    }
    ctx.globalAlpha *= lit;
    const ink = KEY_INK[kind];
    for (const index of held) {
      const part: KeyPart = { key: kind, count, piece: index };
      const face = keyBakeOrStandIn({ art: 'face', part, yawStep: 0, axis: 'upright' }, unitPx);
      if (face === null) {
        paintPlain(ctx, cx, cy, size, part);
        continue;
      }
      blitBake(ctx, face, cx, cy, size);
      if (opts.shimmer !== undefined) {
        blitSweep(ctx, face, cx, cy, size, opts.shimmer, ink.glint, SHIMMER_ALPHA);
      }
    }
  } finally {
    ctx.restore();
  }
}

/** A picture a ceremony is about to draw, for {@link warmKeyArt}. */
export type KeyArtPicture =
  | { readonly look: 'key'; readonly yaws: readonly number[] }
  | {
      readonly look: 'fragment';
      readonly index: number;
      readonly count: number;
      readonly yaws: readonly number[];
    }
  | { readonly look: 'socket'; readonly count: number }
  | { readonly look: 'halo'; readonly held: readonly boolean[] }
  | { readonly look: 'seams'; readonly count: number };

function bakeSpecsOf(kind: KeyKind, picture: KeyArtPicture): readonly BakeSpec[] {
  switch (picture.look) {
    case 'key':
    case 'fragment': {
      const part: KeyPart =
        picture.look === 'key'
          ? { key: kind, count: 1, piece: null }
          : { key: kind, count: picture.count, piece: picture.index };
      const steps = new Set(
        picture.yaws.flatMap((yaw) => {
          const { from, to, blend } = yawSteps(yaw);
          return blend > BLEND_EPSILON ? [from, to] : [from];
        }),
      );
      const turns = picture.yaws.some((yaw) => Math.sin(yaw) !== 0);
      return [...steps].flatMap((yawStep): BakeSpec[] =>
        turns
          ? [
              { art: 'face', part, yawStep, axis: 'upright' },
              { art: 'wall', part, yawStep, axis: 'upright' },
            ]
          : [{ art: 'face', part, yawStep, axis: 'upright' }],
      );
    }
    case 'socket':
      return [{ art: 'socket', part: { key: kind, count: picture.count, piece: null } }];
    case 'seams':
      return [{ art: 'seams', key: kind, count: picture.count }];
    case 'halo':
      return [{ art: 'halo', key: kind, held: picture.held }];
    default: {
      const unknown: never = picture;
      return unknown;
    }
  }
}

/**
 * Bakes ahead the pictures a ceremony is about to draw a key `size` wide
 * through `ctx`, so they are ready by the frame that first shows them. Call
 * once a frame while a ceremony is owed or building up; each call spends no
 * more than what is left of the frame's bake budget, and it returns true once
 * every picture is ready.
 */
export function warmKeyArt(
  ctx: Ctx,
  size: number,
  kind: KeyKind,
  pictures: readonly KeyArtPicture[],
): boolean {
  if (!(size > 0) || !Number.isFinite(size)) return true;
  const unitPx = unitPxFor(ctx, size);
  const missing = pictures
    .flatMap((picture) => bakeSpecsOf(kind, picture))
    .filter((spec) => !hasKeyBake(spec, unitPx));
  for (const spec of missing) {
    if (budgetLeftMs() <= 0 || keyBake(spec, unitPx) === null) return false;
  }
  return true;
}

/** Every step of a full turn, for warming a spin. */
export const FULL_TURN_YAWS: readonly number[] = Array.from(
  { length: YAW_STEPS },
  (_, step) => (step * Math.PI * 2) / YAW_STEPS,
);
