/**
 * GumGum, painted on Carl's rig: a stout, kindly orc woman in a patched plum
 * wool coat-dress and a much-washed apron tied in a bow, her hair parted and
 * piled into a bun with a wild rose in it, two plaits over her shoulders. The
 * orc reads from green skin, small lower tusks and pointed ears; the woman from
 * the hair, the A-line of a full skirt under a tied waist, the bodice, and a
 * face with lashes, rose lips and gold hoops; the friendliness from no scowl at
 * all, a smile, and the clothes of somebody's aunt.
 *
 * Her clothes, hair and face are `CarlAttachments`, painted inside the figure's
 * composition from the solved skeleton so they follow the pose and share its
 * silhouette outline (see `wendellAttachments.ts` for why a garment laid over
 * the finished figure reads as a sticker). `gumGumFigure.ts` composes them.
 *
 * The corpse in `gumGumCorpseArt.ts` quotes this palette, so the body found in
 * the alley is visibly the same woman.
 */

import type { CarlAttachments } from './carl/figure';
import { headAngle } from './carl/head';
import { deriveGlossRamp, type Ramp } from './carl/palette';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from './carl/proportions';
import type { CarlPose, CarlView, Skeleton, ViewSpec } from './carl/rig';
import { torsoFrame, traceGarmentTorso, type TorsoFrame } from './carl/torso';
import { mix, rgba, type Pt } from './carlArt';
import { fillSoftEllipse } from './softShade';
import { FEMININE_FACING_BROW, FEMININE_PROFILE_BROW, type CarlExpression } from './carl/head';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * A warm sage green rather than a toxic or swampy one: the hue leans toward
 * olive in the lights and only cools toward teal in the deepest shadow, the
 * same hue-shift Carl's own skin ramp uses, so she sits in the same light as
 * the humans beside her rather than glowing like a slime.
 */
export const GUMGUM_SKIN: Ramp = {
  deep: '#1f3329',
  shadow: '#33503a',
  dark: '#4a6c45',
  mid: '#5f8450',
  base: '#789b5c',
  light: '#9fbd7a',
  rim: '#cbdca2',
};

/** Near-black brown hair with a warm sheen, pinned up. */
export const GUMGUM_HAIR: Ramp = {
  deep: '#140c0c',
  shadow: '#21140f',
  dark: '#2f1d14',
  mid: '#40281a',
  base: '#553621',
  light: '#734b2c',
  rim: '#9a6d40',
};

/** Her coat-dress: a dusty plum wool, the warmest thing on the street outside the club. */
export const GUMGUM_COAT = '#8a4f78';
/** The coat's material ramp, for the rig's torso and sleeves and for the skirt painted over them. */
export const GUMGUM_COAT_RAMP = deriveGlossRamp(GUMGUM_COAT);
/** Patches sewn onto the coat in whatever cloth was to hand. */
export const GUMGUM_PATCH_BLUE = '#46627e';
export const GUMGUM_PATCH_GOLD = '#c8a040';
/** A much-washed apron, a step off white so it never outshines her face. */
export const GUMGUM_APRON = '#e3d6bb';
const APRON_SHADE = '#b5a586';
const APRON_TIE = '#c7b693';
/** Ivory tusks, yellowed at the root. */
export const GUMGUM_TUSK = '#fbf4e0';
const TUSK_ROOT = '#c9b98e';
const STITCH_COLOR = '#3a2814';
const CHEEK_FLUSH = '#c4805c';
const SMILE_INK = '#2a1a14';

// ── Expression ───────────────────────────────────────────────────────────────

/**
 * No anger at all: every row she plays was authored for Carl, whose idle carries
 * a little of his scowl in `pose.brow`, and even a trace of it on her reads as a
 * glare under the tusks. Fuller lips than the feminine default, because the
 * smile painted over the mouth needs width to curl up at.
 */
const GUMGUM_LIP_FULLNESS = 1.1;
export const GUMGUM_EXPRESSION: CarlExpression = {
  angerScale: 0,
  profileBrow: FEMININE_PROFILE_BROW,
  facingBrow: FEMININE_FACING_BROW,
  lipFullness: GUMGUM_LIP_FULLNESS,
};

// ── Apron ────────────────────────────────────────────────────────────────────

/**
 * Head-on, in the torso frame (`x` across from the spine, `y` down from the
 * shoulder line). A bib apron: a narrow bib over the bust on a neck strap, a
 * waist tie, and a skirt panel that falls most of the way down the dress.
 */
const BIB_TOP_Y = 0.13;
const BIB_HALF = 0.105;
const SKIRT_TOP_HALF = 0.2;
const SKIRT_HEM_HALF = 0.25;
/** The apron stops this far above the dress's own hem, so a band of coat shows under it. */
const APRON_HEM_RISE = 0.12;
const NECK_STRAP_X = 0.07;
/** The neck strap meets the bib just inside its corners. */
const STRAP_FOOT_X = BIB_HALF * 0.8;
/** The bib widens a little toward the waist tie. */
const BIB_WAIST_HALF = BIB_HALF * 1.1;
/** The panel's hem dips at its middle, where the skirt under it bows forward. */
const APRON_HEM_MIDDLE_RISE = APRON_HEM_RISE * 0.6;
const NECK_STRAP_TOP_Y = -0.02;
const STRAP_WIDTH = 0.022;
const TIE_WIDTH = 0.03;
const TIE_HALF = 0.4;
/** A front pocket, darker at its mouth, where she keeps the papers. */
const POCKET_X = 0.09;
const POCKET_Y = 0.62;
const POCKET_HALF_W = 0.085;
const POCKET_H = 0.11;
const POCKET_MOUTH_WIDTH = 0.014;
/** Edge-on only the apron's front edge shows, as a band down the front of the dress. */
const PROFILE_APRON_BACK_X = 0.12;
const PROFILE_APRON_FRONT_X = 0.5;
const PROFILE_BIB_BACK_X = 0.22;
/** Edge-on the panel's hem stands further forward than the bib, over the skirt's flare. */
const PROFILE_APRON_HEM_FRONT_X = PROFILE_APRON_FRONT_X * 1.3;
const APRON_LIT_MIX = 0.14;
const FOLD_ALPHA = 0.35;
const FOLD_WIDTH = 0.016;
const FOLD_XS: readonly number[] = [-0.11, 0.04, 0.16];
/** Folds fan out from the waist toward the hem. */
const FOLD_FAN = 1.15;

function apronGradient(ctx: Ctx, frame: TorsoFrame, half: number): CanvasGradient {
  const from = frame.at(-half, 0);
  const to = frame.at(half, 0);
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, mix(GUMGUM_APRON, '#ffffff', APRON_LIT_MIX));
  gradient.addColorStop(1, APRON_SHADE);
  return gradient;
}

function moveTo(ctx: Ctx, p: Pt): void {
  ctx.moveTo(p.x, p.y);
}
function lineTo(ctx: Ctx, p: Pt): void {
  ctx.lineTo(p.x, p.y);
}

function paintFacingApron(ctx: Ctx, frame: TorsoFrame): void {
  const at = frame.at;
  ctx.strokeStyle = APRON_TIE;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    moveTo(ctx, at(side * NECK_STRAP_X, NECK_STRAP_TOP_Y));
    lineTo(ctx, at(side * STRAP_FOOT_X, BIB_TOP_Y));
    ctx.stroke();
  }
  ctx.beginPath();
  moveTo(ctx, at(-BIB_HALF, BIB_TOP_Y));
  lineTo(ctx, at(BIB_HALF, BIB_TOP_Y));
  lineTo(ctx, at(BIB_WAIST_HALF, frame.waistY));
  lineTo(ctx, at(SKIRT_TOP_HALF, frame.waistY));
  lineTo(ctx, frame.hem(SKIRT_HEM_HALF, -APRON_HEM_RISE));
  ctx.quadraticCurveTo(
    frame.hem(0, -APRON_HEM_MIDDLE_RISE).x,
    frame.hem(0, -APRON_HEM_MIDDLE_RISE).y,
    frame.hem(-SKIRT_HEM_HALF, -APRON_HEM_RISE).x,
    frame.hem(-SKIRT_HEM_HALF, -APRON_HEM_RISE).y,
  );
  lineTo(ctx, at(-SKIRT_TOP_HALF, frame.waistY));
  lineTo(ctx, at(-BIB_WAIST_HALF, frame.waistY));
  ctx.closePath();
  ctx.fillStyle = apronGradient(ctx, frame, SKIRT_HEM_HALF);
  ctx.fill();

  ctx.strokeStyle = rgba(APRON_SHADE, FOLD_ALPHA);
  ctx.lineWidth = FOLD_WIDTH;
  for (const x of FOLD_XS) {
    ctx.beginPath();
    moveTo(ctx, at(x, frame.waistY + TIE_WIDTH));
    lineTo(ctx, frame.hem(x * FOLD_FAN, -APRON_HEM_RISE));
    ctx.stroke();
  }

  ctx.fillStyle = APRON_SHADE;
  const pocketTop = at(-POCKET_X - POCKET_HALF_W, POCKET_Y);
  const pocketTopRight = at(-POCKET_X + POCKET_HALF_W, POCKET_Y);
  const pocketBottomRight = at(-POCKET_X + POCKET_HALF_W, POCKET_Y + POCKET_H);
  const pocketBottom = at(-POCKET_X - POCKET_HALF_W, POCKET_Y + POCKET_H);
  ctx.beginPath();
  moveTo(ctx, pocketTop);
  lineTo(ctx, pocketTopRight);
  lineTo(ctx, pocketBottomRight);
  lineTo(ctx, pocketBottom);
  ctx.closePath();
  ctx.globalAlpha *= FOLD_ALPHA;
  ctx.fill();
  ctx.globalAlpha /= FOLD_ALPHA;
  ctx.strokeStyle = APRON_SHADE;
  ctx.lineWidth = POCKET_MOUTH_WIDTH;
  ctx.beginPath();
  moveTo(ctx, pocketTop);
  lineTo(ctx, pocketTopRight);
  ctx.stroke();

  ctx.strokeStyle = APRON_TIE;
  ctx.lineWidth = TIE_WIDTH;
  ctx.beginPath();
  moveTo(ctx, at(-TIE_HALF, frame.waistY));
  lineTo(ctx, at(TIE_HALF, frame.waistY));
  ctx.stroke();
}

function paintProfileApron(ctx: Ctx, frame: TorsoFrame): void {
  const at = frame.at;
  ctx.beginPath();
  moveTo(ctx, at(PROFILE_BIB_BACK_X, BIB_TOP_Y));
  lineTo(ctx, at(PROFILE_APRON_FRONT_X, BIB_TOP_Y));
  lineTo(ctx, frame.hem(PROFILE_APRON_HEM_FRONT_X, -APRON_HEM_RISE));
  lineTo(ctx, frame.hem(PROFILE_APRON_BACK_X, -APRON_HEM_RISE));
  lineTo(ctx, at(PROFILE_APRON_BACK_X, frame.waistY));
  lineTo(ctx, at(PROFILE_BIB_BACK_X, frame.waistY));
  ctx.closePath();
  ctx.fillStyle = apronGradient(ctx, frame, PROFILE_APRON_FRONT_X);
  ctx.fill();
  ctx.strokeStyle = APRON_TIE;
  ctx.lineWidth = TIE_WIDTH;
  ctx.beginPath();
  moveTo(ctx, at(-TIE_HALF, frame.waistY));
  lineTo(ctx, at(PROFILE_APRON_BACK_X, frame.waistY));
  ctx.stroke();
}

/** Seen from behind only the ties show: a bow at the small of her back. */
const BOW_LOOP_RX = 0.06;
const BOW_LOOP_RY = 0.035;
const BOW_TAIL_DROP = 0.12;
const BOW_TAIL_SPREAD = 0.05;

function paintBackTies(ctx: Ctx, frame: TorsoFrame): void {
  const at = frame.at;
  ctx.strokeStyle = APRON_TIE;
  ctx.lineWidth = TIE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  moveTo(ctx, at(-TIE_HALF, frame.waistY));
  lineTo(ctx, at(TIE_HALF, frame.waistY));
  ctx.stroke();
  const knot = at(0, frame.waistY);
  ctx.fillStyle = APRON_TIE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      knot.x + side * BOW_LOOP_RX,
      knot.y,
      BOW_LOOP_RX,
      BOW_LOOP_RY,
      frame.angle,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    moveTo(ctx, knot);
    lineTo(ctx, at(side * BOW_TAIL_SPREAD, frame.waistY + BOW_TAIL_DROP));
    ctx.stroke();
  }
}

// ── Bust and waist ───────────────────────────────────────────────────────────

/**
 * A full bust, shaped by light rather than outline: a soft highlight on each
 * side of the bib where the cloth rounds toward the key light, and a curved
 * shadow under it. The apron tied tight at the waist below finishes the
 * hourglass the bell skirt starts.
 */
const BUST_Y = 0.25;
const BUST_X = 0.12;
const BUST_RX = 0.1;
const BUST_RY = 0.075;
const BUST_LIGHT_ALPHA = 0.4;
const UNDERBUST_Y = 0.34;
const UNDERBUST_HALF = 0.24;
const UNDERBUST_DIP = 0.05;
const UNDERBUST_WIDTH = 0.024;
const UNDERBUST_ALPHA = 0.45;
const UNDERBUST_INK = '#3a2a1c';

function paintBust(ctx: Ctx, frame: TorsoFrame): void {
  for (const side of [-1, 1]) {
    const at = frame.at(side * BUST_X, BUST_Y);
    fillSoftEllipse(ctx, at.x, at.y, BUST_RX, BUST_RY, '#ffffff', BUST_LIGHT_ALPHA, frame.angle);
  }
  ctx.strokeStyle = rgba(UNDERBUST_INK, UNDERBUST_ALPHA);
  ctx.lineWidth = UNDERBUST_WIDTH;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const outer = frame.at(side * UNDERBUST_HALF, UNDERBUST_Y - UNDERBUST_DIP);
    const low = frame.at(side * BUST_X, UNDERBUST_Y + UNDERBUST_DIP);
    const inner = frame.at(0, UNDERBUST_Y - UNDERBUST_DIP);
    ctx.beginPath();
    moveTo(ctx, outer);
    ctx.quadraticCurveTo(low.x, low.y, inner.x, inner.y);
    ctx.stroke();
  }
}

/** The apron tied in a bow at the front of the waist: the cinch, said at 32 px as a knot of pale loops. */
const FRONT_BOW_LOOP_RX = 0.085;
const FRONT_BOW_LOOP_RY = 0.045;
const FRONT_BOW_TAIL_DROP = 0.17;
const FRONT_BOW_TAIL_SPREAD = 0.07;
const FRONT_BOW_KNOT_R = 0.025;

function paintFrontBow(ctx: Ctx, frame: TorsoFrame): void {
  const knot = frame.at(0, frame.waistY);
  ctx.fillStyle = APRON_TIE;
  ctx.strokeStyle = APRON_TIE;
  ctx.lineWidth = TIE_WIDTH;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const loop = frame.at(side * FRONT_BOW_LOOP_RX, frame.waistY);
    ctx.beginPath();
    ctx.ellipse(loop.x, loop.y, FRONT_BOW_LOOP_RX, FRONT_BOW_LOOP_RY, frame.angle, 0, Math.PI * 2);
    ctx.fill();
    const tail = frame.at(side * FRONT_BOW_TAIL_SPREAD, frame.waistY + FRONT_BOW_TAIL_DROP);
    ctx.beginPath();
    moveTo(ctx, knot);
    lineTo(ctx, tail);
    ctx.stroke();
  }
  ctx.fillStyle = APRON_SHADE;
  ctx.beginPath();
  ctx.arc(knot.x, knot.y, FRONT_BOW_KNOT_R, 0, Math.PI * 2);
  ctx.fill();
}

// ── Coat patches ─────────────────────────────────────────────────────────────

interface Patch {
  readonly x: number;
  readonly y: number;
  readonly halfW: number;
  readonly halfH: number;
  readonly tilt: number;
  readonly color: string;
}

/**
 * Head-on, out past the apron's edge so they show: one on the shoulder, one
 * low on the skirt. Big enough to survive at the tile as two spots of colour;
 * the stitching is for the close-up.
 */
const FACING_PATCHES: readonly Patch[] = [
  { x: 0.25, y: 0.08, halfW: 0.06, halfH: 0.05, tilt: 0.2, color: GUMGUM_PATCH_BLUE },
  { x: 0.3, y: 1.1, halfW: 0.065, halfH: 0.055, tilt: -0.15, color: GUMGUM_PATCH_GOLD },
];
const PROFILE_PATCHES: readonly Patch[] = [
  { x: -0.2, y: 0.75, halfW: 0.07, halfH: 0.06, tilt: 0.1, color: GUMGUM_PATCH_GOLD },
];
const BACK_PATCHES: readonly Patch[] = [
  { x: 0.12, y: 0.3, halfW: 0.08, halfH: 0.07, tilt: -0.12, color: GUMGUM_PATCH_BLUE },
  { x: -0.22, y: 0.9, halfW: 0.07, halfH: 0.06, tilt: 0.2, color: GUMGUM_PATCH_GOLD },
];
const STITCH_WIDTH = 0.008;
const STITCH_DASH = [0.018, 0.014] as const;
const STITCH_INSET = 0.8;

function paintPatches(ctx: Ctx, frame: TorsoFrame, patches: readonly Patch[]): void {
  for (const patch of patches) {
    const centre = frame.at(patch.x, patch.y);
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.rotate(frame.angle + patch.tilt);
    ctx.fillStyle = patch.color;
    ctx.fillRect(-patch.halfW, -patch.halfH, patch.halfW * 2, patch.halfH * 2);
    ctx.strokeStyle = STITCH_COLOR;
    ctx.lineWidth = STITCH_WIDTH;
    ctx.setLineDash(STITCH_DASH);
    ctx.strokeRect(
      -patch.halfW * STITCH_INSET,
      -patch.halfH * STITCH_INSET,
      patch.halfW * 2 * STITCH_INSET,
      patch.halfH * 2 * STITCH_INSET,
    );
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ── Bell skirt ───────────────────────────────────────────────────────────────

/**
 * Her skirt, painted over the rig's own: the rig flares a hem in straight
 * lines, which reads as a cape or a robe, so this one swells out over the hips
 * from a narrow waist and falls as a bell to a scalloped hem. Head-on and from
 * behind it is symmetric; edge-on it rounds out in front over the belly and
 * behind over the seat. In the torso frame's units (`x` across, `y` down from
 * the shoulder line), the hem riding the rig's own hem swing.
 */
const SKIRT_WAIST_HALF = 0.2;
const SKIRT_HIP_DROP = 0.2;
const SKIRT_HIP_HALF = 0.44;
const SKIRT_HEM_HALF_WIDTH = 0.58;
/** How far the hem's scallops dip between folds. */
const SKIRT_SCALLOP_DIP = 0.035;
const SKIRT_SCALLOPS = 5;
/** Edge-on: how far the skirt stands out in front and behind the spine at the hips and hem. */
const PROFILE_SKIRT_FRONT_HIP = 0.34;
const PROFILE_SKIRT_BACK_HIP = -0.36;
const PROFILE_SKIRT_FRONT_HEM = 0.44;
const PROFILE_SKIRT_BACK_HEM = -0.44;
const PROFILE_SKIRT_WAIST_FRONT = 0.18;
const PROFILE_SKIRT_WAIST_BACK = -0.2;
/** Folds falling from the hips to the scallops, where the light catches each ridge. */
const SKIRT_FOLD_SHARES: readonly number[] = [-0.6, -0.2, 0.2, 0.6];
const SKIRT_FOLD_WIDTH = 0.016;
const SKIRT_FOLD_ALPHA = 0.4;
/** The middle of a span, as a share of its length. */
const SPAN_MIDDLE = 0.5;

interface SkirtShape {
  readonly waistLeft: number;
  readonly waistRight: number;
  readonly hipLeft: number;
  readonly hipRight: number;
  readonly hemLeft: number;
  readonly hemRight: number;
}

function skirtShape(view: ViewSpec): SkirtShape {
  if (view.profile) {
    return {
      waistLeft: PROFILE_SKIRT_WAIST_BACK,
      waistRight: PROFILE_SKIRT_WAIST_FRONT,
      hipLeft: PROFILE_SKIRT_BACK_HIP,
      hipRight: PROFILE_SKIRT_FRONT_HIP,
      hemLeft: PROFILE_SKIRT_BACK_HEM,
      hemRight: PROFILE_SKIRT_FRONT_HEM,
    };
  }
  return {
    waistLeft: -SKIRT_WAIST_HALF,
    waistRight: SKIRT_WAIST_HALF,
    hipLeft: -SKIRT_HIP_HALF,
    hipRight: SKIRT_HIP_HALF,
    hemLeft: -SKIRT_HEM_HALF_WIDTH,
    hemRight: SKIRT_HEM_HALF_WIDTH,
  };
}

interface QuadSegment {
  readonly from: Pt;
  readonly control: Pt;
  readonly to: Pt;
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The bell's outline as a closed run of quadratic segments, waist → right hip → hem → left hip. */
function bellSkirtSegments(frame: TorsoFrame, view: ViewSpec): QuadSegment[] {
  const shape = skirtShape(view);
  const hipY = frame.waistY + SKIRT_HIP_DROP;
  const leftWaist = frame.at(shape.waistLeft, frame.waistY);
  const rightWaist = frame.at(shape.waistRight, frame.waistY);
  const segments: QuadSegment[] = [
    { from: leftWaist, control: midpoint(leftWaist, rightWaist), to: rightWaist },
  ];
  let cursor = frame.hem(shape.hemRight);
  segments.push({ from: rightWaist, control: frame.at(shape.hipRight, hipY), to: cursor });
  const span = shape.hemRight - shape.hemLeft;
  for (let scallop = SKIRT_SCALLOPS - 1; scallop >= 0; scallop--) {
    const mid = shape.hemLeft + span * ((scallop + SPAN_MIDDLE) / SKIRT_SCALLOPS);
    const end = frame.hem(shape.hemLeft + span * (scallop / SKIRT_SCALLOPS));
    segments.push({ from: cursor, control: frame.hem(mid, SKIRT_SCALLOP_DIP * 2), to: end });
    cursor = end;
  }
  segments.push({ from: cursor, control: frame.at(shape.hipLeft, hipY), to: leftWaist });
  return segments;
}

/**
 * Traces the bell, in either direction. The garment's details are clipped to
 * the union of the rig's torso and this bell, and a union of two subpaths under
 * the nonzero rule only holds where they wind the same way — wound against
 * each other, their overlap cancels and the apron vanishes below the waist.
 */
function traceBellSkirt(ctx: Ctx, frame: TorsoFrame, view: ViewSpec, reversed = false): void {
  const segments = bellSkirtSegments(frame, view);
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (reversed) {
    moveTo(ctx, last.to);
    for (const segment of [...segments].reverse()) {
      ctx.quadraticCurveTo(segment.control.x, segment.control.y, segment.from.x, segment.from.y);
    }
  } else {
    moveTo(ctx, first.from);
    for (const segment of segments) {
      ctx.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
    }
  }
  ctx.closePath();
}

/** Clips to the rig's torso and the bell together, winding the bell to match the torso. */
function clipToGarment(
  ctx: Ctx,
  skeleton: Skeleton,
  pose: CarlPose,
  view: ViewSpec,
  frame: TorsoFrame,
): void {
  const inBoth = frame.at(0, frame.waistY + SKIRT_HIP_DROP);
  const transform = ctx.getTransform();
  const probeX = transform.a * inBoth.x + transform.c * inBoth.y + transform.e;
  const probeY = transform.b * inBoth.x + transform.d * inBoth.y + transform.f;
  for (const reversed of [false, true]) {
    ctx.beginPath();
    traceGarmentTorso(ctx, skeleton, pose, view);
    traceBellSkirt(ctx, frame, view, reversed);
    if (ctx.isPointInPath(probeX, probeY, 'nonzero')) break;
  }
  ctx.clip('nonzero');
}

function paintBellSkirt(ctx: Ctx, frame: TorsoFrame, view: ViewSpec): void {
  const shape = skirtShape(view);
  ctx.beginPath();
  traceBellSkirt(ctx, frame, view);
  const from = frame.at(shape.hemLeft, frame.waistY);
  const to = frame.at(shape.hemRight, frame.waistY);
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, GUMGUM_COAT_RAMP.light);
  gradient.addColorStop(SPAN_MIDDLE, GUMGUM_COAT_RAMP.base);
  gradient.addColorStop(1, GUMGUM_COAT_RAMP.shadow);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(GUMGUM_COAT_RAMP.deep, SKIRT_FOLD_ALPHA);
  ctx.lineWidth = SKIRT_FOLD_WIDTH;
  ctx.lineCap = 'round';
  const hipY = frame.waistY + SKIRT_HIP_DROP;
  for (const share of SKIRT_FOLD_SHARES) {
    const top = frame.at(share * SKIRT_HIP_HALF * SPAN_MIDDLE, hipY);
    const bottom = frame.hem(share * SKIRT_HEM_HALF_WIDTH);
    ctx.beginPath();
    moveTo(ctx, top);
    lineTo(ctx, bottom);
    ctx.stroke();
  }
  ctx.restore();
}

function paintGarment(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  const frame = torsoFrame(skeleton, pose);
  paintBellSkirt(ctx, frame, view);
  ctx.save();
  clipToGarment(ctx, skeleton, pose, view, frame);
  if (view.profile) {
    paintPatches(ctx, frame, PROFILE_PATCHES);
    paintProfileApron(ctx, frame);
  } else if (view.showsBack) {
    paintPatches(ctx, frame, BACK_PATCHES);
    paintBackTies(ctx, frame);
  } else {
    paintPatches(ctx, frame, FACING_PATCHES);
    paintFacingApron(ctx, frame);
    paintBust(ctx, frame);
    paintFrontBow(ctx, frame);
  }
  ctx.restore();
}

// ── Head: ears, tusks, smile ─────────────────────────────────────────────────
//
// Head-local units, the same the head is painted in: origin at the head's
// centre (the eye line), +Y down, the face toward +X edge-on.

/**
 * The ear stands out from the side of the skull and sweeps up and back to a
 * point a little above the eye line. Kept short: a long swept ear is an elf's,
 * and a big flared one starts to read as a goblin.
 */
const EAR_ROOT_X = HEAD_RX * 0.86;
const EAR_ROOT_TOP_Y = -HEAD_RY * 0.12;
const EAR_ROOT_BOTTOM_Y = HEAD_RY * 0.36;
const EAR_TIP_X = HEAD_RX * 1.42;
const EAR_TIP_Y = -HEAD_RY * 0.36;
const EAR_LOBE_X = HEAD_RX * 1.08;
const EAR_LOBE_Y = HEAD_RY * 0.36;
const EAR_INNER_SHARE = 0.55;
/** The ear's back edge swells outward on its way down to the lobe. */
const EAR_BACK_BULGE_X = HEAD_RX * 0.08;
const EAR_BACK_BULGE_RISE = HEAD_RY * 0.2;
/** Edge-on the ear sits behind the head's centre, its point aimed up and back. */
const PROFILE_EAR_X = -HEAD_DEPTH * 0.18;
const PROFILE_EAR_TIP: Pt = { x: -HEAD_DEPTH * 0.62, y: -HEAD_RY * 0.52 };
const PROFILE_EAR_HALF = HEAD_RY * 0.2;
const PROFILE_EAR_LOBE_BACK: Pt = {
  x: PROFILE_EAR_X - PROFILE_EAR_HALF * 0.4,
  y: PROFILE_EAR_HALF * 1.6,
};
const PROFILE_EAR_LOBE_FRONT: Pt = {
  x: PROFILE_EAR_X + PROFILE_EAR_HALF * 0.4,
  y: PROFILE_EAR_HALF * 1.4,
};

/**
 * Two short lower tusks, rooted in the lower lip either side of the mouth and
 * rising past the upper lip. Their roots sit inboard of the mouth's corners so
 * the smile curls up outside them.
 */
const MOUTH_Y = HEAD_RY * 0.62;
const TUSK_ROOT_X = HEAD_RX * 0.34;
const TUSK_ROOT_Y = MOUTH_Y + HEAD_RY * 0.1;
const TUSK_TIP_X = HEAD_RX * 0.42;
const TUSK_TIP_Y = MOUTH_Y - HEAD_RY * 0.2;
const TUSK_ROOT_HALF = HEAD_RX * 0.15;
/** Edge-on one tusk shows, rising in front of the lips. */
const PROFILE_TUSK_ROOT: Pt = { x: HEAD_DEPTH * 0.84, y: MOUTH_Y + HEAD_RY * 0.08 };
const PROFILE_TUSK_TIP: Pt = { x: HEAD_DEPTH * 0.92, y: MOUTH_Y - HEAD_RY * 0.2 };

/** The smile: a soft upward curve laid over the mouth, wider than the mouth itself. */
const SMILE_HALF = HEAD_RX * 0.3;
const SMILE_LIFT = HEAD_RY * 0.08;
const SMILE_DIP = HEAD_RY * 0.12;
const SMILE_WIDTH = 0.016;
const SMILE_ALPHA = 0.85;
const PROFILE_SMILE_FROM: Pt = { x: HEAD_DEPTH * 0.72, y: MOUTH_Y - HEAD_RY * 0.06 };
const PROFILE_SMILE_TO: Pt = { x: HEAD_DEPTH * 0.92, y: MOUTH_Y + HEAD_RY * 0.02 };
/** Apple cheeks, flushed: the one warm note in a green face, and most of what reads as a smile at the tile. */
const CHEEK_X = HEAD_RX * 0.5;
const CHEEK_Y = HEAD_RY * 0.36;
const CHEEK_RX = HEAD_RX * 0.2;
const CHEEK_RY = HEAD_RY * 0.12;
const CHEEK_ALPHA = 0.7;

function fillPolygon(ctx: Ctx, points: readonly Pt[], fill: string | CanvasGradient): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function paintFacingEars(ctx: Ctx, view: ViewSpec): void {
  for (const side of [-1, 1]) {
    const root = { x: side * EAR_ROOT_X, y: EAR_ROOT_TOP_Y };
    const tip = { x: side * EAR_TIP_X, y: EAR_TIP_Y };
    const lobe = { x: side * EAR_LOBE_X, y: EAR_LOBE_Y };
    const rootBottom = { x: side * EAR_ROOT_X, y: EAR_ROOT_BOTTOM_Y };
    // The key light comes from the upper left, so the ear on the right of the
    // picture is the one in shadow.
    const lit = side < 0;
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.quadraticCurveTo(
      lobe.x + side * EAR_BACK_BULGE_X,
      lobe.y - EAR_BACK_BULGE_RISE,
      lobe.x,
      lobe.y,
    );
    ctx.lineTo(rootBottom.x, rootBottom.y);
    ctx.closePath();
    ctx.fillStyle = lit ? GUMGUM_SKIN.base : GUMGUM_SKIN.mid;
    ctx.fill();
    if (view.showsBack) continue;
    const inner = (p: Pt): Pt => ({
      x: root.x + (p.x - root.x) * EAR_INNER_SHARE,
      y: (root.y + rootBottom.y) / 2 + (p.y - (root.y + rootBottom.y) / 2) * EAR_INNER_SHARE,
    });
    fillPolygon(ctx, [inner(root), inner(tip), inner(lobe)], GUMGUM_SKIN.dark);
  }
}

function paintProfileEar(ctx: Ctx): void {
  fillPolygon(
    ctx,
    [
      { x: PROFILE_EAR_X, y: -PROFILE_EAR_HALF },
      PROFILE_EAR_TIP,
      PROFILE_EAR_LOBE_BACK,
      PROFILE_EAR_LOBE_FRONT,
    ],
    GUMGUM_SKIN.mid,
  );
}

/**
 * A blunt, stubby tusk: a short tapering column with a rounded tip, solid ivory
 * past a yellowed root. Painted thin and pointed it antialiases into the green
 * at the baked size and vanishes; blunt, it keeps a pixel of near-white.
 */
const TUSK_TIP_SHARE = 0.65;
const TUSK_ROOT_STOP = 0.3;

function paintTusk(ctx: Ctx, root: Pt, tip: Pt, half: number): void {
  const angle = Math.atan2(tip.y - root.y, tip.x - root.x);
  const across = angle + Math.PI / 2;
  const tipHalf = half * TUSK_TIP_SHARE;
  const gradient = ctx.createLinearGradient(root.x, root.y, tip.x, tip.y);
  gradient.addColorStop(0, TUSK_ROOT);
  gradient.addColorStop(TUSK_ROOT_STOP, GUMGUM_TUSK);
  gradient.addColorStop(1, GUMGUM_TUSK);
  ctx.beginPath();
  ctx.moveTo(root.x + Math.cos(across) * half, root.y + Math.sin(across) * half);
  ctx.lineTo(tip.x + Math.cos(across) * tipHalf, tip.y + Math.sin(across) * tipHalf);
  ctx.arc(tip.x, tip.y, tipHalf, across, across + Math.PI, true);
  ctx.lineTo(root.x - Math.cos(across) * half, root.y - Math.sin(across) * half);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

function paintFacingFace(ctx: Ctx): void {
  ctx.fillStyle = rgba(CHEEK_FLUSH, CHEEK_ALPHA);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * CHEEK_X, CHEEK_Y, CHEEK_RX, CHEEK_RY, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(SMILE_INK, SMILE_ALPHA);
  ctx.lineWidth = SMILE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-SMILE_HALF, MOUTH_Y - SMILE_LIFT);
  ctx.quadraticCurveTo(0, MOUTH_Y + SMILE_DIP, SMILE_HALF, MOUTH_Y - SMILE_LIFT);
  ctx.stroke();
  for (const side of [-1, 1]) {
    paintTusk(
      ctx,
      { x: side * TUSK_ROOT_X, y: TUSK_ROOT_Y },
      { x: side * TUSK_TIP_X, y: TUSK_TIP_Y },
      TUSK_ROOT_HALF,
    );
  }
}

function paintProfileFace(ctx: Ctx): void {
  ctx.strokeStyle = rgba(SMILE_INK, SMILE_ALPHA);
  ctx.lineWidth = SMILE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(PROFILE_SMILE_FROM.x, PROFILE_SMILE_FROM.y);
  ctx.lineTo(PROFILE_SMILE_TO.x, PROFILE_SMILE_TO.y);
  ctx.stroke();
  paintTusk(ctx, PROFILE_TUSK_ROOT, PROFILE_TUSK_TIP, TUSK_ROOT_HALF);
}

// ── Hair ─────────────────────────────────────────────────────────────────────
//
// Her hair carries most of "she" at the tile: a full swept-back crown parted in
// the middle, a big bun piled on top that stands clear above the head, and two
// thick plaits over her shoulders ending in rose ribbons. The plaits are what
// survive at 32 px — two dark columns down the front of the bodice — and no man
// in the town wears them.

/** The swept-back crown, head-local, round the top and down the sides of the face to the jaw. */
const CROWN_CENTRE_Y = -HEAD_RY * 0.35;
const CROWN_RX = HEAD_RX * 1.14;
const CROWN_RY = HEAD_RY * 1.0;
/** The face the crown is cut away round: its top edge is the hairline, high and rounded. */
const FACE_CENTRE_Y = HEAD_RY * 0.36;
const FACE_RX = HEAD_RX * 0.9;
const FACE_RY = HEAD_RY * 1.06;
/**
 * The hair comes down the sides of the face only to the eye line, so the
 * cheeks, jaw and tusks stay clear, and the plaits take over below the ears.
 */
const CROWN_LOWEST_Y = HEAD_RY * 0.05;
/** Comfortably larger than anything painted in head space, for the band the crown is clipped to. */
const CROWN_CLIP_HALF = HEAD_RY * 4;
/** The parting, from the hairline back over the crown. */
const PART_FROM_Y = FACE_CENTRE_Y - FACE_RY;
const PART_TO_Y = -HEAD_RY * 1.05;
const PART_WIDTH = 0.012;
/** Combed strands sweeping back from the parting, so the crown reads as hair rather than a cap. */
const STRAND_SPREAD = HEAD_RX * 0.9;
const STRAND_DROP = HEAD_RY * 0.35;
const STRAND_WIDTH = 0.01;
const STRAND_ALPHA = 0.55;
const STRAND_COUNT = 3;
/** Edge-on the crown sits back on the skull and the face is cut away in front. */
const PROFILE_CROWN_X = -HEAD_DEPTH * 0.3;
const PROFILE_CROWN_RX = HEAD_DEPTH * 1.05;
const PROFILE_FACE_X = HEAD_DEPTH * 0.55;
const PROFILE_FACE_RX = HEAD_DEPTH * 0.7;

/** A big bun piled on top: wider than half the head and standing clear above the crown. */
const BUN_Y = -HEAD_RY * 1.42;
const BUN_RX = HEAD_RX * 0.85;
const BUN_RY = HEAD_RY * 0.58;
const PROFILE_BUN_X = -HEAD_DEPTH * 0.3;
const PROFILE_BUN_Y = -HEAD_RY * 1.3;
/** A coil wrapped round the bun: one dark line across it, which is what says "bun" and not "hat". */
const BUN_COIL_DROP = BUN_RY * 0.15;
const BUN_COIL_SPAN = 0.78;
const BUN_HIGHLIGHT_X = BUN_RX * 0.35;
const BUN_HIGHLIGHT_Y = BUN_RY * 0.4;
const BUN_SHADE_REACH = BUN_RX * 1.1;
const BUN_BASE_STOP = 0.5;

/** A wild rose tucked into the side of the bun. */
const FLOWER_AT: Pt = { x: BUN_RX * 0.85, y: BUN_Y + BUN_RY * 0.55 };
const PROFILE_FLOWER_AT: Pt = { x: PROFILE_BUN_X + BUN_RX * 0.7, y: PROFILE_BUN_Y + BUN_RY * 0.5 };
const FLOWER_PETALS = 5;
const PETAL_REACH = HEAD_RX * 0.17;
const PETAL_R = HEAD_RX * 0.15;
const FLOWER_HEART_R = HEAD_RX * 0.07;
const FLOWER_PETAL = '#e48aa0';
const FLOWER_HEART = '#f2d06a';

/** Gold hoops in her ear lobes. */
const EARRING = '#e8c060';
const EARRING_R = HEAD_RX * 0.13;
const EARRING_WIDTH = 0.014;
const EARRING_DROP = HEAD_RY * 0.12;
const PROFILE_EARRING_AT: Pt = { x: -HEAD_DEPTH * 0.2, y: HEAD_RY * 0.52 };

/** Lashes: a short dark flick off the outer corner of each eye. */
const LASH_FROM: Pt = { x: HEAD_RX * 0.56, y: -HEAD_RX * 0.06 };
const LASH_TO: Pt = { x: HEAD_RX * 0.76, y: -HEAD_RX * 0.22 };
const PROFILE_LASH_FROM: Pt = { x: HEAD_DEPTH * 0.62, y: -HEAD_RX * 0.06 };
const PROFILE_LASH_TO: Pt = { x: HEAD_DEPTH * 0.86, y: -HEAD_RX * 0.2 };
const LASH_WIDTH = 0.016;
const LASH_INK = '#1a0e10';
/** Rose lips under the smile line. */
const LIP_TINT = '#b8506a';
const LIP_RX = HEAD_RX * 0.27;
const LIP_RY = HEAD_RY * 0.07;
const LIP_ALPHA = 0.85;

function bunGradient(ctx: Ctx, cx: number, cy: number): CanvasGradient {
  const gradient = ctx.createRadialGradient(
    cx - BUN_HIGHLIGHT_X,
    cy - BUN_HIGHLIGHT_Y,
    0,
    cx,
    cy,
    BUN_SHADE_REACH,
  );
  gradient.addColorStop(0, GUMGUM_HAIR.light);
  gradient.addColorStop(BUN_BASE_STOP, GUMGUM_HAIR.base);
  gradient.addColorStop(1, GUMGUM_HAIR.shadow);
  return gradient;
}

function paintBun(ctx: Ctx, cx: number, cy: number): void {
  ctx.fillStyle = bunGradient(ctx, cx, cy);
  ctx.beginPath();
  ctx.ellipse(cx, cy, BUN_RX, BUN_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GUMGUM_HAIR.deep;
  ctx.lineWidth = STRAND_WIDTH;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + BUN_COIL_DROP,
    BUN_RX * BUN_COIL_SPAN,
    BUN_RY * BUN_COIL_SPAN,
    0,
    Math.PI * 0.1,
    Math.PI * 0.9,
  );
  ctx.stroke();
}

function paintFlower(ctx: Ctx, at: Pt): void {
  ctx.fillStyle = FLOWER_PETAL;
  for (let petal = 0; petal < FLOWER_PETALS; petal++) {
    const angle = (petal / FLOWER_PETALS) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      at.x + Math.cos(angle) * PETAL_REACH,
      at.y + Math.sin(angle) * PETAL_REACH,
      PETAL_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = FLOWER_HEART;
  ctx.beginPath();
  ctx.arc(at.x, at.y, FLOWER_HEART_R, 0, Math.PI * 2);
  ctx.fill();
}

/** Fills `fill` everywhere inside `crown` except the face cut out of it. */
function fillHairCrown(ctx: Ctx, traceCrown: () => void, traceFace: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    -CROWN_CLIP_HALF,
    -CROWN_CLIP_HALF,
    CROWN_CLIP_HALF * 2,
    CROWN_CLIP_HALF + CROWN_LOWEST_Y,
  );
  ctx.clip();
  ctx.beginPath();
  traceCrown();
  traceFace();
  ctx.clip('evenodd');
  ctx.beginPath();
  traceCrown();
  const gradient = ctx.createLinearGradient(-CROWN_RX, CROWN_CENTRE_Y - CROWN_RY, CROWN_RX, 0);
  gradient.addColorStop(0, GUMGUM_HAIR.light);
  gradient.addColorStop(BUN_BASE_STOP, GUMGUM_HAIR.base);
  gradient.addColorStop(1, GUMGUM_HAIR.shadow);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function paintFacingCrown(ctx: Ctx, view: ViewSpec): void {
  const traceCrown = (): void => {
    ctx.ellipse(0, CROWN_CENTRE_Y, CROWN_RX, CROWN_RY, 0, 0, Math.PI * 2);
  };
  const traceFace = (): void => {
    if (view.showsBack) return;
    ctx.moveTo(FACE_RX, FACE_CENTRE_Y);
    ctx.ellipse(0, FACE_CENTRE_Y, FACE_RX, FACE_RY, 0, 0, Math.PI * 2);
  };
  fillHairCrown(ctx, traceCrown, traceFace);
  ctx.strokeStyle = rgba(GUMGUM_HAIR.deep, STRAND_ALPHA);
  ctx.lineWidth = STRAND_WIDTH;
  ctx.lineCap = 'round';
  for (let strand = 1; strand <= STRAND_COUNT; strand++) {
    const spread = (strand / STRAND_COUNT) * STRAND_SPREAD;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, PART_TO_Y);
      ctx.quadraticCurveTo(
        side * spread,
        PART_TO_Y + STRAND_DROP * (strand / STRAND_COUNT),
        side * spread * 1.15,
        FACE_CENTRE_Y - FACE_RY + STRAND_DROP,
      );
      ctx.stroke();
    }
  }
  if (view.showsBack) return;
  ctx.strokeStyle = GUMGUM_HAIR.deep;
  ctx.lineWidth = PART_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, PART_FROM_Y);
  ctx.lineTo(0, PART_TO_Y);
  ctx.stroke();
}

function paintProfileCrown(ctx: Ctx): void {
  fillHairCrown(
    ctx,
    () =>
      ctx.ellipse(PROFILE_CROWN_X, CROWN_CENTRE_Y, PROFILE_CROWN_RX, CROWN_RY, 0, 0, Math.PI * 2),
    () => {
      ctx.moveTo(PROFILE_FACE_X + PROFILE_FACE_RX, FACE_CENTRE_Y);
      ctx.ellipse(PROFILE_FACE_X, FACE_CENTRE_Y, PROFILE_FACE_RX, FACE_RY, 0, 0, Math.PI * 2);
    },
  );
}

function paintEarring(ctx: Ctx, at: Pt): void {
  ctx.strokeStyle = EARRING;
  ctx.lineWidth = EARRING_WIDTH;
  ctx.beginPath();
  ctx.arc(at.x, at.y + EARRING_R, EARRING_R, 0, Math.PI * 2);
  ctx.stroke();
}

function strokeSegment(ctx: Ctx, from: Pt, to: Pt): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function paintFacingFeminine(ctx: Ctx): void {
  ctx.fillStyle = rgba(LIP_TINT, LIP_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, MOUTH_Y, LIP_RX, LIP_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = LASH_INK;
  ctx.lineWidth = LASH_WIDTH;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    strokeSegment(
      ctx,
      { x: side * LASH_FROM.x, y: LASH_FROM.y },
      { x: side * LASH_TO.x, y: LASH_TO.y },
    );
  }
}

function paintHeadDetails(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(headAngle(pose));
  if (view.profile) {
    paintProfileCrown(ctx);
    paintBun(ctx, PROFILE_BUN_X, PROFILE_BUN_Y);
    paintFlower(ctx, PROFILE_FLOWER_AT);
    paintProfileEar(ctx);
    paintEarring(ctx, PROFILE_EARRING_AT);
    paintProfileFace(ctx);
    ctx.strokeStyle = LASH_INK;
    ctx.lineWidth = LASH_WIDTH;
    ctx.lineCap = 'round';
    strokeSegment(ctx, PROFILE_LASH_FROM, PROFILE_LASH_TO);
  } else {
    paintFacingCrown(ctx, view);
    paintBun(ctx, 0, BUN_Y);
    paintFlower(ctx, view.showsBack ? { x: -FLOWER_AT.x, y: FLOWER_AT.y } : FLOWER_AT);
    paintFacingEars(ctx, view);
    for (const side of [-1, 1]) {
      paintEarring(ctx, { x: side * EAR_LOBE_X, y: EAR_LOBE_Y + EARRING_DROP });
    }
    if (!view.showsBack) {
      paintFacingFeminine(ctx);
      paintFacingFace(ctx);
    }
  }
  ctx.restore();
}

// ── Plaits ───────────────────────────────────────────────────────────────────

/** Where each plait leaves the head, head-local: behind the jaw, under the ear. */
const PLAIT_ROOT: Pt = { x: HEAD_RX * 0.78, y: HEAD_RY * 0.5 };
const BACK_PLAIT_ROOT: Pt = { x: HEAD_RX * 0.45, y: HEAD_RY * 0.55 };
const PROFILE_PLAIT_ROOT: Pt = { x: -HEAD_DEPTH * 0.45, y: HEAD_RY * 0.45 };
/**
 * Where each plait lies, in the torso frame: over the shoulder just inside the
 * arm, and down onto the bust beside the apron's bib.
 */
const PLAIT_SHOULDER: Pt = { x: 0.19, y: 0.04 };
const PLAIT_END: Pt = { x: 0.11, y: 0.42 };
const BACK_PLAIT_SHOULDER: Pt = { x: 0.13, y: 0.05 };
const BACK_PLAIT_END: Pt = { x: 0.11, y: 0.48 };
/** Edge-on the near plait falls forward over the shoulder onto the chest. */
const PROFILE_PLAIT_SHOULDER: Pt = { x: 0.05, y: -0.02 };
const PROFILE_PLAIT_END: Pt = { x: 0.32, y: 0.42 };
/** A plait is a chain of overlapping lobes, alternately tilted, tapering toward the tie. */
const PLAIT_LOBES = 7;
const PLAIT_ROOT_HALF = HEAD_RX * 0.2;
const PLAIT_END_HALF = HEAD_RX * 0.14;
const PLAIT_LOBE_LENGTH_SHARE = 0.36;
const PLAIT_LOBE_TILT = 0.45;
const PLAIT_SEAM_WIDTH = 0.01;
/** A rose ribbon tied at the end of each plait, and the loose tuft below it. */
const RIBBON = '#d0607a';
const RIBBON_LOOP_RX = HEAD_RX * 0.2;
const RIBBON_LOOP_RY = HEAD_RX * 0.11;
const TUFT_LENGTH = HEAD_RX * 0.35;

function quadAt(from: Pt, control: Pt, to: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

function headPoint(skeleton: Skeleton, pose: CarlPose, local: Pt): Pt {
  const angle = headAngle(pose);
  return {
    x: skeleton.headCentre.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
    y: skeleton.headCentre.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
  };
}

function paintPlait(ctx: Ctx, from: Pt, control: Pt, to: Pt): void {
  const step = 1 / PLAIT_LOBES;
  for (let lobe = 0; lobe < PLAIT_LOBES; lobe++) {
    const t = (lobe + 0.5) * step;
    const at = quadAt(from, control, to, t);
    const ahead = quadAt(from, control, to, Math.min(1, t + step));
    const behind = quadAt(from, control, to, Math.max(0, t - step));
    const along = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
    const half = PLAIT_ROOT_HALF + (PLAIT_END_HALF - PLAIT_ROOT_HALF) * t;
    const length = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) * PLAIT_LOBE_LENGTH_SHARE;
    const tilt = (lobe % 2 === 0 ? 1 : -1) * PLAIT_LOBE_TILT;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, length, half, along + tilt, 0, Math.PI * 2);
    ctx.fillStyle = bunGradient(ctx, at.x, at.y);
    ctx.fill();
    ctx.strokeStyle = GUMGUM_HAIR.deep;
    ctx.lineWidth = PLAIT_SEAM_WIDTH;
    ctx.stroke();
  }
  const angle = Math.atan2(to.y - control.y, to.x - control.x);
  ctx.strokeStyle = GUMGUM_HAIR.mid;
  ctx.lineWidth = PLAIT_END_HALF;
  ctx.lineCap = 'round';
  strokeSegment(ctx, to, {
    x: to.x + Math.cos(angle) * TUFT_LENGTH,
    y: to.y + Math.sin(angle) * TUFT_LENGTH,
  });
  ctx.fillStyle = RIBBON;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      to.x + side * RIBBON_LOOP_RX * Math.cos(angle + Math.PI / 2),
      to.y + side * RIBBON_LOOP_RX * Math.sin(angle + Math.PI / 2),
      RIBBON_LOOP_RX,
      RIBBON_LOOP_RY,
      angle + Math.PI / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function paintPlaits(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  const frame = torsoFrame(skeleton, pose);
  if (view.profile) {
    paintPlait(
      ctx,
      headPoint(skeleton, pose, PROFILE_PLAIT_ROOT),
      frame.at(PROFILE_PLAIT_SHOULDER.x, PROFILE_PLAIT_SHOULDER.y),
      frame.at(PROFILE_PLAIT_END.x, PROFILE_PLAIT_END.y),
    );
    return;
  }
  const root = view.showsBack ? BACK_PLAIT_ROOT : PLAIT_ROOT;
  const shoulder = view.showsBack ? BACK_PLAIT_SHOULDER : PLAIT_SHOULDER;
  const end = view.showsBack ? BACK_PLAIT_END : PLAIT_END;
  for (const side of [-1, 1]) {
    paintPlait(
      ctx,
      headPoint(skeleton, pose, { x: side * root.x, y: root.y }),
      frame.at(side * shoulder.x, shoulder.y),
      frame.at(side * end.x, end.y),
    );
  }
}

/** How far past the head's outline the ears, bun and flower reach, as shares of the head's radii. */
const HEAD_DETAIL_REACH_X = 1.6;
const HEAD_DETAIL_REACH_Y = 1.9;

/** Past the skirt's widest points, so the composing surface is sized round the bell. */
const SKIRT_REACH_SHARE = 1.15;

function skirtReach(skeleton: Skeleton, view: ViewSpec, pose: CarlPose): Pt[] {
  const frame = torsoFrame(skeleton, pose);
  const shape = skirtShape(view);
  return [
    frame.hem(shape.hemLeft * SKIRT_REACH_SHARE, SKIRT_SCALLOP_DIP),
    frame.hem(shape.hemRight * SKIRT_REACH_SHARE, SKIRT_SCALLOP_DIP),
    frame.at(shape.hipLeft * SKIRT_REACH_SHARE, frame.waistY + SKIRT_HIP_DROP),
    frame.at(shape.hipRight * SKIRT_REACH_SHARE, frame.waistY + SKIRT_HIP_DROP),
  ];
}

export const GUMGUM_ATTACHMENTS: CarlAttachments = {
  over: (ctx, skeleton, view, pose) => {
    paintGarment(ctx, skeleton, view, pose);
    paintHeadDetails(ctx, skeleton, view, pose);
    paintPlaits(ctx, skeleton, view, pose);
  },
  reach: (skeleton, view, pose) => [
    ...skirtReach(skeleton, view, pose),
    {
      x: skeleton.headCentre.x - HEAD_RX * HEAD_DETAIL_REACH_X,
      y: skeleton.headCentre.y - HEAD_RY * HEAD_DETAIL_REACH_Y,
    },
    {
      x: skeleton.headCentre.x + HEAD_RX * HEAD_DETAIL_REACH_X,
      y: skeleton.headCentre.y - HEAD_RY * HEAD_DETAIL_REACH_Y,
    },
  ],
};

// ── Posture ──────────────────────────────────────────────────────────────────

/**
 * A small, warm tilt of the head, which is most of what separates "listening
 * to you" from "standing guard" in a figure this size. Head-on only: edge-on a
 * tilt nods her at the floor.
 */
const HEAD_TILT = 0.12;

/** Her bearing on every row: the warm tilt, and never a trace of Carl's scowl. */
export function gumGumPosture(pose: CarlPose, view: CarlView): CarlPose {
  if (view !== 'front') return { ...pose, brow: 0 };
  return { ...pose, headTilt: pose.headTilt + HEAD_TILT, brow: 0 };
}

// ── The cut ──────────────────────────────────────────────────────────────────

/**
 * The rig's own coat-dress falls to mid-shin under the bell skirt painted over
 * it, flared only enough that its straight hem never shows past the bell's.
 */
export const GUMGUM_DRESS_HEM_DROP = 0.85;
export const GUMGUM_DRESS_HEM_FLARE = 1.6;
/**
 * Sleeves to the wrist with only a soft cuff: Carl's shoved-up sleeve with its
 * bunched roll at the elbow is a brawler's arm, and it squares off her shoulders.
 */
export const GUMGUM_SLEEVE_CUFF_ALONG = 0.88;
export const GUMGUM_SLEEVE_CUFF_BULK = 1.4;
export const GUMGUM_SHOE = '#4a3a2c';
