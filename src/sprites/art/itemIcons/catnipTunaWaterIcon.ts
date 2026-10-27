import type { Rect } from '../../../ui/core/geom';
import {
  BOLD_DETAIL,
  disc,
  FULL_TURN,
  GLINT_WHITE,
  glint,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  MEDIUM_DETAIL,
  outlineWidth,
  paintForm,
  paintIconArt,
  strokeDetail,
  tone,
  traceEllipse,
  withShapeClip,
} from './iconPaint';

/**
 * Catnip Infused Tuna Water: a squat, opened tin of cloudy tuna water with a
 * sprig of catnip standing out of it. The short wide can with its open rim
 * and the green sprig over it are what read at slot size; the fish on the
 * label is what makes it tuna.
 *
 * The can is lit from the left, so its banding runs across it left to right
 * and the terminator is a straight line down the side.
 */

const CAN_X = 0.47;
const CAN_HALF_WIDTH = 0.24;
const RIM_Y = 0.54;
const BASE_Y = 0.84;
/** How far the rim's ellipse is opened by the view from a little above. */
const RIM_RY = 0.09;

const TIN = '#aeb7bf';
const TIN_INSIDE = tone(TIN, -0.45);
const RIB_INK = tone(TIN, -0.4);
const RIB_LIGHT = tone(TIN, 0.4);
/** The ribs pressed round the can, as shares of the way down from rim to base. */
const RIB_DEPTHS = [0.12, 0.9] as const;

/** The paper label's top and bottom, as shares of the way down from rim to base. */
const LABEL_TOP_SHARE = 0.2;
const LABEL_BOTTOM_SHARE = 0.82;
const LABEL = '#1f7a8c';
const LABEL_BAND = '#f2c14e';
/** The thin gold stripe along the label's top edge, as a share of the label's height. */
const LABEL_BAND_SHARE = 0.12;

const FISH = '#f4efe1';
/** The fish on the label: its body's centre, half-length and half-height. */
const FISH_X = CAN_X - 0.04;
const FISH_Y_SHARE = 0.5;
const FISH_HALF_LENGTH = 0.1;
const FISH_HALF_HEIGHT = 0.05;
const FISH_TAIL_LENGTH = 0.075;
const FISH_TAIL_SPREAD = 0.055;
/** How deep the fork is cut into the tail's back edge. */
const FISH_TAIL_NOTCH = 0.035;
const FISH_EYE_INSET = 0.04;
const FISH_EYE_RADIUS = 0.014;
/** The gill line, this share of the half-length back from the body's centre toward the head. */
const FISH_GILL_SHARE = 0.35;
const FISH_GILL_INK = tone(FISH, -0.3);

/**
 * Cloudy grey-tan brine: warmer than the tin's silver so it reads as liquid
 * in it, and kept off green so the sprig is the only green in the icon.
 */
const WATER = '#c4b48c';
/** The brine's edge darkens where it meets the tin wall, so the surface sits apart from the rim. */
const WATER_EDGE = tone(WATER, -0.45);
/** Flecks of fish floating in the brine. */
const WATER_FLECK = tone(WATER, 0.45);
const WATER_FLECKS: readonly (readonly [number, number])[] = [
  [0.06, 0.012],
  [-0.05, 0.022],
  [0.12, -0.008],
];
const WATER_FLECK_RADIUS = 0.016;
/** Light caught along the brine's far edge: the line that says "wet surface", not "lid". */
const WATER_SHINE = tone(WATER, 0.65);
/** The shine runs inside the darkened edge by this many water insets. */
const WATER_SHINE_INSET = 2;
const WATER_INSET = 0.035;
/** The surface sits a touch below the rim, so the rim's lip shows over it. */
const WATER_DROP = 0.015;
const WATER_GLINT_X = -0.1;
const WATER_GLINT_Y = -0.02;
const WATER_GLINT_RADIUS = 0.035;

const STEM = '#4f7f2f';
const LEAF = '#86a86a';
const LEAF_VEIN = tone(LEAF, -0.35);
/** Where the stem leaves the water and where its tip ends, top right over the can. */
const STEM_ROOT: readonly [number, number] = [CAN_X + 0.1, RIM_Y];
const STEM_CONTROL: readonly [number, number] = [CAN_X + 0.2, 0.3];
const STEM_TIP: readonly [number, number] = [0.74, 0.24];
const STEM_WIDTH = 0.045;

interface LeafSpec {
  /** Along the stem, 0 at the root and 1 at the tip. */
  readonly at: number;
  /** Leaning off the stem's left (-1) or right (+1). */
  readonly side: -1 | 1;
  readonly length: number;
}

/**
 * Catnip's leaves come in opposite pairs, heart-shaped and toothed, getting
 * smaller toward the flowering tip.
 */
const LEAVES: readonly LeafSpec[] = [
  { at: 0.36, side: -1, length: 0.17 },
  { at: 0.36, side: 1, length: 0.16 },
  { at: 0.72, side: -1, length: 0.12 },
  { at: 0.72, side: 1, length: 0.11 },
];
/** Off the stem's own direction, in radians: leaves reach outward and a little up. */
const LEAF_SPLAY = 1.05;
const LEAF_HALF_WIDTH_SHARE = 0.42;
/** The toothed edge: notches cut along each side of a leaf. */
const LEAF_TEETH = 3;
const LEAF_TOOTH_DEPTH = 0.18;
/** Below 1, which pulls a leaf's widest point from its middle toward its base. */
const LEAF_SWELL_SKEW = 0.7;
/** The midrib runs this share of the way out to the tip. */
const LEAF_VEIN_SHARE = 0.75;

/**
 * Catnip flowers as a tapered spike of small pale florets past the stem's tip,
 * alternating side to side. No black ring round each one: ringed, a cluster of
 * them reads as one purple berry.
 */
const BLOSSOM = '#f1e9f8';
const BLOSSOM_SHADE = '#b89fd6';
const BLOSSOM_COUNT = 5;
const BLOSSOM_STEP = 0.032;
const BLOSSOM_BASE_RADIUS = 0.03;
const BLOSSOM_TIP_RADIUS = 0.015;
/** How far each floret sits off the spike's line, alternately left and right. */
const BLOSSOM_STAGGER = 0.016;
/** The shade sits this share of a floret's radius down and right of it: light from the top-left. */
const BLOSSOM_SHADE_OFFSET = 0.35;

/**
 * The lid, peeled back on its hinge and standing up behind the can: the one
 * shape that says "tin of tuna" rather than "pot".
 */
const LID_X = CAN_X - 0.11;
const LID_Y = RIM_Y - 0.13;
const LID_RX = 0.19;
const LID_RY = 0.12;
const LID_TILT = -0.45;
const LID_RIM_INSET = 0.035;
/** The ring pull rides on the lid's upper edge. */
const RING_X = LID_X - 0.07;
const RING_Y = LID_Y - 0.07;
const RING_RX = 0.06;
const RING_RY = 0.04;
const RING_WIDTH = 0.022;

function rimYAt(share: number): number {
  return RIM_Y + (BASE_Y - RIM_Y) * share;
}

/** A band round the can between two depths: straight sides, its top and bottom following the can's curve. */
function traceBand(ctx: CanvasRenderingContext2D, top: number, bottom: number): void {
  const left = CAN_X - CAN_HALF_WIDTH;
  const right = CAN_X + CAN_HALF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.ellipse(CAN_X, top, CAN_HALF_WIDTH, RIM_RY, 0, Math.PI, 0, true);
  ctx.lineTo(right, bottom);
  ctx.ellipse(CAN_X, bottom, CAN_HALF_WIDTH, RIM_RY, 0, 0, Math.PI, false);
  ctx.closePath();
}

function traceCan(ctx: CanvasRenderingContext2D): void {
  const left = CAN_X - CAN_HALF_WIDTH;
  const right = CAN_X + CAN_HALF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(left, RIM_Y);
  ctx.ellipse(CAN_X, RIM_Y, CAN_HALF_WIDTH, RIM_RY, 0, Math.PI, 0, false);
  ctx.lineTo(right, BASE_Y);
  ctx.ellipse(CAN_X, BASE_Y, CAN_HALF_WIDTH, RIM_RY, 0, 0, Math.PI, false);
  ctx.closePath();
}

function paintCan(ctx: CanvasRenderingContext2D, px: number): void {
  const left = CAN_X - CAN_HALF_WIDTH;
  const right = CAN_X + CAN_HALF_WIDTH;
  paintForm(ctx, px, () => traceCan(ctx), litFill(ctx, TIN, [left, 0], [right, 0]));

  const labelTop = rimYAt(LABEL_TOP_SHARE);
  const labelBottom = rimYAt(LABEL_BOTTOM_SHARE);
  withShapeClip(
    ctx,
    () => traceCan(ctx),
    () => {
      traceBand(ctx, labelTop, labelBottom);
      ctx.fillStyle = litFill(ctx, LABEL, [left, 0], [right, 0]);
      ctx.fill();
      const bandBottom = labelTop + (labelBottom - labelTop) * LABEL_BAND_SHARE;
      traceBand(ctx, labelTop, bandBottom);
      ctx.fillStyle = litFill(ctx, LABEL_BAND, [left, 0], [right, 0]);
      ctx.fill();
      // The label's front face sags by the can's ellipse depth, so the fish sits that much lower.
      paintFish(ctx, px, labelTop + RIM_RY + (labelBottom - labelTop) * FISH_Y_SHARE);
      for (const depth of RIB_DEPTHS) {
        const y = rimYAt(depth);
        ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
        ctx.strokeStyle = RIB_INK;
        ctx.beginPath();
        ctx.ellipse(CAN_X, y, CAN_HALF_WIDTH, RIM_RY, 0, 0, Math.PI, false);
        ctx.stroke();
        ctx.strokeStyle = RIB_LIGHT;
        ctx.lineWidth = hairlineWidth(px);
        ctx.beginPath();
        ctx.ellipse(CAN_X, y + hairlineWidth(px), CAN_HALF_WIDTH, RIM_RY, 0, 0, Math.PI, false);
        ctx.stroke();
      }
    },
  );

  // The open top: the dark inside wall, the cloudy water filling it, the lip over both.
  traceEllipse(ctx, CAN_X, RIM_Y, CAN_HALF_WIDTH, RIM_RY);
  ctx.fillStyle = TIN_INSIDE;
  ctx.fill();
  traceEllipse(
    ctx,
    CAN_X,
    RIM_Y + WATER_DROP,
    CAN_HALF_WIDTH - WATER_INSET,
    RIM_RY - WATER_INSET / 2,
  );
  ctx.fillStyle = litFill(ctx, WATER, [left, 0], [right, 0]);
  ctx.fill();
  ctx.strokeStyle = WATER_EDGE;
  ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    CAN_X,
    RIM_Y + WATER_DROP,
    CAN_HALF_WIDTH - WATER_INSET * WATER_SHINE_INSET,
    RIM_RY - WATER_INSET,
    0,
    Math.PI,
    FULL_TURN,
  );
  ctx.strokeStyle = WATER_SHINE;
  ctx.lineWidth = hairlineWidth(px) * BOLD_DETAIL;
  ctx.stroke();
  for (const [dx, dy] of WATER_FLECKS) {
    ctx.beginPath();
    ctx.arc(CAN_X + dx, RIM_Y + WATER_DROP + dy, WATER_FLECK_RADIUS, 0, FULL_TURN);
    ctx.fillStyle = WATER_FLECK;
    ctx.fill();
  }
  traceEllipse(ctx, CAN_X, RIM_Y, CAN_HALF_WIDTH, RIM_RY);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = outlineWidth(px);
  ctx.stroke();
  glint(ctx, CAN_X + WATER_GLINT_X, RIM_Y + WATER_GLINT_Y, WATER_GLINT_RADIUS, GLINT_WHITE);
}

/** A plain fish silhouette: a pointed lens of a body and a forked tail, nose to the left. */
function paintFish(ctx: CanvasRenderingContext2D, px: number, y: number): void {
  const nose = FISH_X - FISH_HALF_LENGTH;
  const tailRoot = FISH_X + FISH_HALF_LENGTH;
  const tailEnd = tailRoot + FISH_TAIL_LENGTH;
  ctx.fillStyle = FISH;
  ctx.beginPath();
  ctx.moveTo(nose, y);
  ctx.quadraticCurveTo(FISH_X, y - FISH_HALF_HEIGHT * 2, tailRoot, y);
  ctx.quadraticCurveTo(FISH_X, y + FISH_HALF_HEIGHT * 2, nose, y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tailRoot - FISH_TAIL_NOTCH, y);
  ctx.lineTo(tailEnd, y - FISH_TAIL_SPREAD);
  ctx.lineTo(tailEnd - FISH_TAIL_NOTCH, y);
  ctx.lineTo(tailEnd, y + FISH_TAIL_SPREAD);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(nose + FISH_EYE_INSET, y - FISH_EYE_RADIUS, FISH_EYE_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = LABEL;
  ctx.fill();
  strokeDetail(
    ctx,
    px,
    [
      [FISH_X - FISH_HALF_LENGTH * FISH_GILL_SHARE, y - FISH_HALF_HEIGHT],
      [FISH_X - FISH_HALF_LENGTH * FISH_GILL_SHARE, y + FISH_HALF_HEIGHT],
    ],
    FISH_GILL_INK,
  );
}

function stemPoint(t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * STEM_ROOT[0] + 2 * u * t * STEM_CONTROL[0] + t * t * STEM_TIP[0],
    u * u * STEM_ROOT[1] + 2 * u * t * STEM_CONTROL[1] + t * t * STEM_TIP[1],
  ];
}

function stemAngle(t: number): number {
  const u = 1 - t;
  const dx = 2 * u * (STEM_CONTROL[0] - STEM_ROOT[0]) + 2 * t * (STEM_TIP[0] - STEM_CONTROL[0]);
  const dy = 2 * u * (STEM_CONTROL[1] - STEM_ROOT[1]) + 2 * t * (STEM_TIP[1] - STEM_CONTROL[1]);
  return Math.atan2(dy, dx);
}

/**
 * How wide a leaf is at `along` (0 base, 1 tip) as a share of its widest:
 * a heart, broadest about a third of the way out and narrowing to the tip.
 */
function leafSwell(along: number): number {
  return Math.sin(Math.PI * Math.pow(along, LEAF_SWELL_SKEW));
}

/** A toothed heart-shaped leaf along +X from its base, in its own frame. */
function traceLeaf(ctx: CanvasRenderingContext2D, length: number): void {
  const halfWidth = length * LEAF_HALF_WIDTH_SHARE;
  const edgePoints = LEAF_TEETH * 2;
  const edge: Array<readonly [number, number]> = [];
  for (let i = 1; i <= edgePoints; i++) {
    const along = i / (edgePoints + 1);
    const isNotch = i % 2 === 0;
    const out = halfWidth * leafSwell(along) * (isNotch ? 1 - LEAF_TOOTH_DEPTH : 1);
    edge.push([length * along, out]);
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const [x, out] of edge) ctx.lineTo(x, -out);
  ctx.lineTo(length, 0);
  for (const [x, out] of [...edge].reverse()) ctx.lineTo(x, out);
  ctx.closePath();
}

function paintSprig(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.beginPath();
  ctx.moveTo(STEM_ROOT[0], STEM_ROOT[1]);
  ctx.quadraticCurveTo(STEM_CONTROL[0], STEM_CONTROL[1], STEM_TIP[0], STEM_TIP[1]);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = STEM_WIDTH + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = STEM;
  ctx.lineWidth = STEM_WIDTH;
  ctx.stroke();

  for (const leaf of LEAVES) {
    const [x, y] = stemPoint(leaf.at);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(stemAngle(leaf.at) + leaf.side * LEAF_SPLAY);
    paintForm(
      ctx,
      px,
      () => traceLeaf(ctx, leaf.length),
      litFill(ctx, LEAF, [0, -leaf.length], [0, leaf.length]),
    );
    strokeDetail(
      ctx,
      px,
      [
        [0, 0],
        [leaf.length * LEAF_VEIN_SHARE, 0],
      ],
      LEAF_VEIN,
    );
    ctx.restore();
  }

  const tipAngle = stemAngle(1);
  const alongX = Math.cos(tipAngle);
  const alongY = Math.sin(tipAngle);
  for (let floret = BLOSSOM_COUNT - 1; floret >= 0; floret--) {
    const t = floret / (BLOSSOM_COUNT - 1);
    const reach = floret * BLOSSOM_STEP;
    const side = floret % 2 === 0 ? 1 : -1;
    const fx = STEM_TIP[0] + alongX * reach - alongY * side * BLOSSOM_STAGGER;
    const fy = STEM_TIP[1] + alongY * reach + alongX * side * BLOSSOM_STAGGER;
    const radius = BLOSSOM_BASE_RADIUS + (BLOSSOM_TIP_RADIUS - BLOSSOM_BASE_RADIUS) * t;
    const shadeShift = radius * BLOSSOM_SHADE_OFFSET;
    disc(ctx, fx + shadeShift, fy + shadeShift, radius, BLOSSOM_SHADE);
    disc(ctx, fx, fy, radius, BLOSSOM);
  }
}

function paintLid(ctx: CanvasRenderingContext2D, px: number): void {
  const traceLid = (): void => {
    ctx.beginPath();
    ctx.ellipse(LID_X, LID_Y, LID_RX, LID_RY, LID_TILT, 0, FULL_TURN);
  };
  paintForm(
    ctx,
    px,
    traceLid,
    litFill(ctx, TIN, [LID_X - LID_RX, LID_Y - LID_RY], [LID_X + LID_RX, LID_Y + LID_RY]),
  );
  ctx.beginPath();
  ctx.ellipse(LID_X, LID_Y, LID_RX - LID_RIM_INSET, LID_RY - LID_RIM_INSET, LID_TILT, 0, FULL_TURN);
  ctx.strokeStyle = RIB_INK;
  ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(RING_X, RING_Y, RING_RX, RING_RY, LID_TILT, 0, FULL_TURN);
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = RING_WIDTH + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = RIB_LIGHT;
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();
}

export function drawCatnipTunaWaterIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (c, px) => {
    paintLid(c, px);
    paintCan(c, px);
    paintSprig(c, px);
  });
}
