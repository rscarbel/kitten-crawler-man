/**
 * The one fire in this game, as baked stamps and the palette that colours them.
 *
 * Extracted from the Big Top's flame vents so that anything else that burns —
 * the Lich's fire waves, whatever comes next — is literally the same fire and
 * not a second painter's impression of it. Two hand-matched orange ramps drift
 * apart the first time either is touched.
 *
 * Nothing here knows what shape a flame is. A caller decides where parcels of
 * burning gas are born and how they travel; this module hands it the soft,
 * edgeless stamps to draw them with and the repeatable randomness to vary them.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/** A colour with its own opacity, for a stamp that is baked rather than composed. */
export interface FlameInk {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/**
 * The heat ramp, from the grille (first) to the top of the column (last).
 *
 * A parcel picks its tier by how far it has climbed, so colour follows height
 * rather than which layer drew it. The body stays a deeply saturated orange-red
 * the whole way up and only loses opacity near the top: the big top's ground is
 * pale tan, and a pale flame over it reads as smoke. The one white-hot thing in
 * the column is the throat, which is small — brightness has to be bought with
 * value, not with area, or the burner grows an egg in it.
 */
export const FLAME_BODY_TIERS: ReadonlyArray<FlameInk> = [
  { red: 255, green: 176, blue: 52, alpha: 0.95 },
  { red: 255, green: 146, blue: 26, alpha: 0.95 },
  { red: 255, green: 118, blue: 14, alpha: 0.94 },
  { red: 253, green: 96, blue: 10, alpha: 0.92 },
  { red: 244, green: 74, blue: 8, alpha: 0.88 },
  { red: 228, green: 56, blue: 8, alpha: 0.82 },
  { red: 206, green: 40, blue: 8, alpha: 0.72 },
  { red: 180, green: 28, blue: 6, alpha: 0.56 },
  { red: 150, green: 20, blue: 4, alpha: 0.34 },
  { red: 118, green: 14, blue: 2, alpha: 0.16 },
];

export const FLAME_ROOT_INK: FlameInk = { red: 255, green: 142, blue: 26, alpha: 1 };
export const FLAME_THROAT_INK: FlameInk = { red: 255, green: 216, blue: 132, alpha: 0.9 };
export const FLAME_EMBER_INK: FlameInk = { red: 255, green: 206, blue: 118, alpha: 0.9 };
export const FLAME_FUEL_INK: FlameInk = { red: 24, green: 6, blue: 0, alpha: 0.35 };
export const FLAME_GLOW_INK: FlameInk = { red: 255, green: 148, blue: 44, alpha: 1 };

/**
 * How hard each baked parcel shape curves, as a multiple of its own widest
 * radius, and how many half-turns of S that curve makes on the way up.
 *
 * A straight-sided teardrop is a symmetric isoceles triangle, and a field of
 * them all pointing the same way reads as a scatter of arrowheads rather than as
 * fire. A lick leans as it climbs and whips back at the tip, so the axis the
 * lobes are stacked along is an S; each parcel draws one of these variants and a
 * mirror flag from its birth hash, which keeps the cost at one stamp per parcel.
 */
const FLAME_BEND_CURVATURES: ReadonlyArray<number> = [0.3, 0.6, 0.95];
const FLAME_BEND_S_TURNS = 1.5;
/** Holds the foot on the axis while the bend builds over the parcel's length. */
const FLAME_BEND_ONSET_EXPONENT = 0.6;
/** The root's own curve: mild, because it is the part that is anchored. */
const FLAME_ROOT_CURVATURE = 0.3;

/**
 * An alpha this small is indistinguishable from nothing on screen, and
 * `node-canvas` refuses the exponent notation JavaScript prints it in — an
 * `rgba()` carrying `5e-17` is dropped whole, which bakes a solid smear into an
 * offline render. Anything under it is simply not drawn.
 */
export const MIN_VISIBLE_ALPHA = 0.004;

/**
 * A gradient stop that `node-canvas` will actually accept.
 *
 * A stop that fades out has to *exist*: dropping it — as returning null for a
 * vanishing alpha would — throws the whole gradient away and the thing it was
 * meant to draw silently disappears. A fixed-point zero is a legal `rgba()`
 * where `5e-17` is not, so a vanishing alpha is rounded down to a stop that is
 * simply invisible.
 */
export function gradientStopRgba(r: number, g: number, b: number, alpha: number): string {
  const safe = alpha < MIN_VISIBLE_ALPHA ? 0 : Math.min(1, alpha);
  return `rgba(${r},${g},${b},${safe.toFixed(3)})`;
}

/**
 * A repeatable pseudo-random 0..1 from two integers.
 *
 * The caller holds no per-vent state — the vents are plain schedules — so every
 * parcel that has ever risen out of a grille has to be reconstructible from the
 * frame counter alone. Hashing (birth number, parcel index) gives each birth its
 * own width, brightness and sway without anything being remembered between
 * frames, and without it the parcels march in step and the column strobes.
 */
const HASH_X_STRIDE = 12.9898;
const HASH_Y_STRIDE = 78.233;
const HASH_MAGNITUDE = 43758.5453;

export function hashUnit(a: number, b: number): number {
  const scattered = Math.sin(a * HASH_X_STRIDE + b * HASH_Y_STRIDE) * HASH_MAGNITUDE;
  return scattered - Math.floor(scattered);
}

/**
 * Resolution the teardrop stamp is baked at. It is only ever drawn smaller than
 * this — a 32-pixel tile takes it down to roughly a third — and shrinking a
 * bitmap costs nothing and smooths it further.
 */
const STAMP_TEARDROP_WIDTH = 48;
const STAMP_TEARDROP_HEIGHT = 96;
const STAMP_ROUND_SIZE = 48;
const STAMP_GLOW_SIZE = 128;

/**
 * How many soft discs are stacked up the axis to build one teardrop.
 *
 * The whole point of the stamp is that fire has no crisp boundary: a filled path
 * has a hard edge no matter what curve it follows, and a column of them reads as
 * cut paper. A stack of overlapping radial falloffs has no edge anywhere.
 */
const STAMP_LOBE_COUNT = 28;
/** Above one, the stack narrows toward the tip faster than it climbs. */
const STAMP_LOBE_TAPER = 0.8;
/** The smallest disc worth stacking, in stamp pixels. */
const STAMP_MIN_LOBE_RADIUS = 1.2;
/**
 * How far the foot and tip discs are held inside the bitmap, as a share of the
 * widest radius, so neither one's falloff is clipped by the edge — a clipped
 * falloff is exactly the hard edge the stamp exists to avoid.
 */
const STAMP_FOOT_INSET = 0.55;
const STAMP_TIP_INSET = 0.25;

/** Where a disc's own falloff gives out. Softer than a gradient's default ramp. */
const STAMP_FALLOFF: ReadonlyArray<{ readonly stop: number; readonly weight: number }> = [
  { stop: 0, weight: 1 },
  { stop: 0.55, weight: 0.92 },
  { stop: 0.8, weight: 0.42 },
  { stop: 1, weight: 0 },
];

/**
 * Every soft thing in the column, baked once and stamped thereafter.
 *
 * Baking costs a few hundred fills at first light and nothing afterwards; the
 * per-tile work drops to `drawImage`, with no gradient allocated per frame.
 */
export interface FlameStamps {
  /** One row of bend variants per heat tier, indexed [tier][bend]. */
  readonly body: ReadonlyArray<ReadonlyArray<CanvasSurface>>;
  readonly root: CanvasSurface;
  readonly throat: CanvasSurface;
  readonly ember: CanvasSurface;
  readonly fuel: CanvasSurface;
  readonly glow: CanvasSurface;
}

let bakedFlameStamps: FlameStamps | null = null;

export function flameStamps(): FlameStamps {
  bakedFlameStamps ??= {
    body: FLAME_BODY_TIERS.map((ink) =>
      FLAME_BEND_CURVATURES.map((curvature) =>
        bakeTeardrop(ink, STAMP_TEARDROP_WIDTH, STAMP_TEARDROP_HEIGHT, curvature),
      ),
    ),
    root: bakeTeardrop(
      FLAME_ROOT_INK,
      STAMP_TEARDROP_WIDTH,
      STAMP_TEARDROP_HEIGHT,
      FLAME_ROOT_CURVATURE,
    ),
    throat: bakeDisc(FLAME_THROAT_INK, STAMP_ROUND_SIZE),
    ember: bakeDisc(FLAME_EMBER_INK, STAMP_ROUND_SIZE),
    fuel: bakeDisc(FLAME_FUEL_INK, STAMP_ROUND_SIZE),
    glow: bakeDisc(FLAME_GLOW_INK, STAMP_GLOW_SIZE),
  };
  return bakedFlameStamps;
}

/** A radial falloff in unit space, so one gradient serves every disc in a bake. */
function unitFalloff(
  ctx: CanvasRenderingContext2D,
  ink: FlameInk,
  peakAlpha: number,
): CanvasGradient {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const step of STAMP_FALLOFF) {
    gradient.addColorStop(
      step.stop,
      gradientStopRgba(ink.red, ink.green, ink.blue, peakAlpha * step.weight),
    );
  }
  return gradient;
}

/** One soft disc, drawn by scaling the unit falloff out to the radius asked for. */
function stampDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(radius, radius);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function bakeDisc(ink: FlameInk, size: number): CanvasSurface {
  const surface = allocCanvas(size, size);
  const ctx = surfaceContext(surface);
  ctx.fillStyle = unitFalloff(ctx, ink, ink.alpha);
  stampDisc(ctx, size / 2, size / 2, size / 2);
  return surface;
}

/**
 * A teardrop: soft discs stacked up an axis, wide at the foot, pinched at the tip.
 *
 * The discs are laid down additively, and each one's alpha is divided by how
 * many of its neighbours reach the same place — otherwise the fat foot, where a
 * dozen discs overlap, saturates to a solid slab while the thin tip, where one
 * does, stays a ghost.
 */
/**
 * How far the lobe stack has wandered off the vertical at a given point up the
 * teardrop, in multiples of the widest lobe radius.
 *
 * Zero at the foot however hard the curve bends, because the foot is where the
 * parcel is anchored: a teardrop whose base has slid sideways detaches from the
 * fuel it is supposed to be leaving.
 */
function bentAxisOffset(along: number, curvature: number): number {
  const onset = Math.pow(along, FLAME_BEND_ONSET_EXPONENT);
  return curvature * onset * Math.sin(along * Math.PI * FLAME_BEND_S_TURNS);
}

function lobeRadiusFraction(along: number, maxRadius: number): number {
  return Math.max(STAMP_MIN_LOBE_RADIUS / maxRadius, Math.pow(1 - along, STAMP_LOBE_TAPER));
}

/**
 * How wide a bent teardrop's bitmap has to be, as a multiple of the straight
 * one's, for no lobe's falloff to be clipped by the edge.
 *
 * Every teardrop is baked and drawn at this one width whatever its own bend, so
 * that a caller's requested half-width always means the same thing about the
 * foot no matter which variant it picked.
 */
function stampWidthMultiple(): number {
  const maxRadius = STAMP_TEARDROP_WIDTH / 2;
  const sharpestBend = Math.max(...FLAME_BEND_CURVATURES, FLAME_ROOT_CURVATURE);
  let widest = 1;
  for (let lobe = 0; lobe < STAMP_LOBE_COUNT; lobe++) {
    const along = lobe / (STAMP_LOBE_COUNT - 1);
    const reach =
      Math.abs(bentAxisOffset(along, sharpestBend)) + lobeRadiusFraction(along, maxRadius);
    widest = Math.max(widest, reach);
  }
  return widest;
}

const STAMP_BEND_PADDING = stampWidthMultiple();

function bakeTeardrop(
  ink: FlameInk,
  width: number,
  height: number,
  curvature: number,
): CanvasSurface {
  const maxRadius = width / 2;
  const paddedWidth = Math.ceil(width * STAMP_BEND_PADDING);
  const surface = allocCanvas(paddedWidth, height);
  const ctx = surfaceContext(surface);
  const footY = height - maxRadius * STAMP_FOOT_INSET;
  const lobeSpacing = (footY - maxRadius * STAMP_TIP_INSET) / (STAMP_LOBE_COUNT - 1);
  ctx.globalCompositeOperation = 'lighter';
  for (let lobe = 0; lobe < STAMP_LOBE_COUNT; lobe++) {
    const along = lobe / (STAMP_LOBE_COUNT - 1);
    const radius = maxRadius * lobeRadiusFraction(along, maxRadius);
    const overlapping = Math.max(1, (radius * 2) / lobeSpacing);
    ctx.fillStyle = unitFalloff(ctx, ink, ink.alpha / overlapping);
    const lobeX = paddedWidth / 2 + maxRadius * bentAxisOffset(along, curvature);
    stampDisc(ctx, lobeX, footY - lobeSpacing * lobe, radius);
  }
  return surface;
}

/**
 * Stamps one baked teardrop, standing on (footX, footY) and tilted about that
 * foot — a flame is anchored where it leaves the fuel and free everywhere else.
 *
 * `mirrored` flips the baked bend about that same foot, so a handful of baked
 * curves cover twice as many apparent shapes without a second bake.
 */
export function stampTeardrop(
  ctx: CanvasRenderingContext2D,
  stamp: CanvasSurface,
  footX: number,
  footY: number,
  halfWidth: number,
  height: number,
  lean: number,
  alpha: number,
  mirrored: boolean,
): void {
  ctx.save();
  ctx.translate(footX, footY);
  ctx.rotate(lean);
  if (mirrored) ctx.scale(-1, 1);
  ctx.globalAlpha = alpha;
  const drawnHalfWidth = halfWidth * STAMP_BEND_PADDING;
  ctx.drawImage(stamp, -drawnHalfWidth, -height, drawnHalfWidth * 2, height);
  ctx.restore();
}
