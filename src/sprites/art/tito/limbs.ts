/**
 * Tito's arms, hands and knife, shared by the bust and the club-floor figure.
 * Everything is in the caller's units, scaled by an {@link ArmBuild}.
 *
 * A hand is drawn as one silhouette — palm and the fingers held together —
 * because at the sizes he is shown a separate finger is a pixel or two and
 * reads as noise. What sells a hand is its outline against the shirt, a
 * thumb standing off it and a knuckle line. The steepled pair is the smarm:
 * fingertips pressed together, pointing up, over the counter.
 */

import { type Pt } from '../bipedArt';
import {
  type Ctx,
  type FormShading,
  type Trace,
  fillTrace,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceCapsule,
  traceEllipse,
  tracePolygon,
  traceSmoothLoop,
} from '../deuce/paint';
import { BLADE, BLADE_GLINT, BRASS, GOLD, HANDLE, SHIRT, SKIN } from './palette';

export interface ArmBuild {
  shoulderRadius: number;
  elbowRadius: number;
  wristRadius: number;
  cuffLength: number;
  handLength: number;
  handWidth: number;
  knifeHandle: number;
  knifeBlade: number;
  knifeWidth: number;
  outlinePixels: number;
  /** Whether creases, cufflinks and the pinky ring are drawn. */
  fine: boolean;
}

export type HandGrip = 'steeple' | 'flat' | 'knife';

export interface PlacedHand {
  wrist: Pt;
  angle: number;
  grip: HandGrip;
  /** Which way the thumb stands off the hand: +1 counter-clockwise of the hand's axis. */
  thumbSide: 1 | -1;
}

const SLEEVE_SHADING: FormShading = { shadow: 0.35, highlight: 0.12 };
const HAND_SHADING: FormShading = { shadow: 0.2, highlight: 0.06 };
const BLADE_SHADING: FormShading = { shadow: 0.25, highlight: 0.1 };
const FOLD_PIXELS = 1;
/** Shares of the elbow-to-wrist run: where the cuff begins. */
const CUFF_FROM = 0.8;
const CUFFLINK_RADIUS = 0.22;
/** The cufflink sits halfway from the cuff's centre line to its edge. */
const CUFFLINK_OFFSET = 0.5;
/** How far the crook's fold runs from the elbow toward the inside of the bend. */
const CROOK_FOLD_REACH = 0.12;
/** A fist closes round the handle halfway along the hand. */
const FIST_GRIP_SHARE = 0.5;
/** The knife's outline, as shares of its width (across) or of the blade's length (along). */
const KNIFE = {
  pommelHalf: 0.45,
  handleHalf: 0.5,
  guardDepth: 0.4,
  heelHalf: 0.55,
  spineAt: 0.7,
  spineHalf: 0.5,
  bellyAt: 0.6,
  bellyHalf: 0.6,
  glintFrom: 0.8,
  glintTo: 0.8,
  glintHalf: 0.14,
  glintPixels: 1.5,
} as const;

/** Hand silhouette in hand units (x along the hand from the wrist, y across), fingers held together. */
const HAND_OUTLINE: readonly Pt[] = [
  pt(0, -0.42),
  pt(0.45, -0.5),
  pt(0.85, -0.38),
  pt(1, -0.12),
  pt(1, 0.12),
  pt(0.85, 0.36),
  pt(0.45, 0.46),
  pt(0, 0.4),
];
/** A closed fist around a handle, in the same units. */
const FIST_OUTLINE: readonly Pt[] = [
  pt(0, -0.45),
  pt(0.35, -0.6),
  pt(0.72, -0.55),
  pt(0.82, -0.2),
  pt(0.8, 0.3),
  pt(0.6, 0.55),
  pt(0.25, 0.55),
  pt(0, 0.42),
];
const THUMB = { from: pt(0.25, 0), to: pt(0.62, 0.62), radius: 0.17, tipShare: 0.8 } as const;
const KNUCKLE_LINE: readonly Pt[] = [pt(0.62, -0.38), pt(0.66, 0), pt(0.62, 0.34)];
const FIST_CREASES: ReadonlyArray<readonly Pt[]> = [
  [pt(0.55, -0.2), pt(0.8, -0.22)],
  [pt(0.55, 0.08), pt(0.8, 0.06)],
];
const PINKY_RING = { at: pt(0.62, 0.36), rx: 0.08, ry: 0.15 } as const;

/** The upper and lower sleeve, white shirt over the arm, with the cuff at the wrist. */
export function paintSleeve(ctx: Ctx, build: ArmBuild, shoulder: Pt, elbow: Pt, wrist: Pt): void {
  const upper: Trace = (c) =>
    traceCapsule(c, shoulder, elbow, build.shoulderRadius, build.elbowRadius);
  const lower: Trace = (c) => traceCapsule(c, elbow, wrist, build.elbowRadius, build.wristRadius);
  outlineTrace(ctx, upper, build.outlinePixels);
  outlineTrace(ctx, lower, build.outlinePixels);
  paintForm(ctx, upper, SHIRT, SLEEVE_SHADING);
  paintForm(ctx, lower, SHIRT, SLEEVE_SHADING);
  if (!build.fine) return;
  const crook = pt(
    elbow.x + (shoulder.x + wrist.x - elbow.x * 2) * CROOK_FOLD_REACH,
    elbow.y + (shoulder.y + wrist.y - elbow.y * 2) * CROOK_FOLD_REACH,
  );
  strokeLine(ctx, [elbow, crook], SHIRT.deep, FOLD_PIXELS);
  const cuffStart = pt(
    elbow.x + (wrist.x - elbow.x) * CUFF_FROM,
    elbow.y + (wrist.y - elbow.y) * CUFF_FROM,
  );
  const angle = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
  const nx = -Math.sin(angle) * build.wristRadius;
  const ny = Math.cos(angle) * build.wristRadius;
  strokeLine(
    ctx,
    [pt(cuffStart.x + nx, cuffStart.y + ny), pt(cuffStart.x - nx, cuffStart.y - ny)],
    SHIRT.shade,
    FOLD_PIXELS,
  );
  const link = build.wristRadius * CUFFLINK_RADIUS;
  fillTrace(
    ctx,
    (c) =>
      traceEllipse(
        c,
        cuffStart.x + nx * CUFFLINK_OFFSET,
        cuffStart.y + ny * CUFFLINK_OFFSET,
        link,
        link,
      ),
    GOLD.base,
  );
}

function inHandSpace(ctx: Ctx, build: ArmBuild, hand: PlacedHand, paint: () => void): void {
  ctx.save();
  ctx.translate(hand.wrist.x, hand.wrist.y);
  ctx.rotate(hand.angle);
  ctx.scale(build.handLength, build.handWidth * hand.thumbSide);
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

function paintKnife(ctx: Ctx, build: ArmBuild, grip: Pt, bladeAngle: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(grip.x, grip.y);
  ctx.rotate(bladeAngle);
  const handle = build.knifeHandle;
  const blade = build.knifeBlade;
  const w = build.knifeWidth;
  const guardDepth = w * KNIFE.guardDepth;
  const handleTrace: Trace = (c) =>
    traceCapsule(c, pt(-handle, 0), pt(0, 0), w * KNIFE.pommelHalf, w * KNIFE.handleHalf);
  outlineTrace(ctx, handleTrace, build.outlinePixels);
  paintForm(ctx, handleTrace, HANDLE, BLADE_SHADING);
  const guard: Trace = (c) =>
    tracePolygon(c, [pt(0, -w), pt(guardDepth, -w), pt(guardDepth, w), pt(0, w)]);
  outlineTrace(ctx, guard, build.outlinePixels);
  fillTrace(ctx, guard, BRASS.base);
  const bladeTrace: Trace = (c) =>
    traceSmoothLoop(c, [
      pt(guardDepth, -w * KNIFE.heelHalf),
      pt(blade * KNIFE.spineAt, -w * KNIFE.spineHalf),
      pt(blade, 0),
      pt(blade * KNIFE.bellyAt, w * KNIFE.bellyHalf),
      pt(guardDepth, w * KNIFE.heelHalf),
    ]);
  outlineTrace(ctx, bladeTrace, build.outlinePixels);
  paintForm(ctx, bladeTrace, BLADE, BLADE_SHADING);
  strokeLine(
    ctx,
    [
      pt(w * KNIFE.glintFrom, -w * KNIFE.glintHalf),
      pt(blade * KNIFE.glintTo, -w * KNIFE.glintHalf),
    ],
    BLADE_GLINT,
    KNIFE.glintPixels,
  );
  ctx.restore();
}

/**
 * A hand at its wrist. A knife grip also draws the knife, the fist painted
 * over its handle so the fingers wrap it.
 */
export function paintHand(
  ctx: Ctx,
  build: ArmBuild,
  hand: PlacedHand,
  knife: { angle: number; alpha: number } | null,
): void {
  if (hand.grip === 'knife' && knife !== null) {
    const gripAt = pt(
      hand.wrist.x + Math.cos(hand.angle) * build.handLength * FIST_GRIP_SHARE,
      hand.wrist.y + Math.sin(hand.angle) * build.handLength * FIST_GRIP_SHARE,
    );
    paintKnife(ctx, build, gripAt, knife.angle, knife.alpha);
  }
  inHandSpace(ctx, build, hand, () => {
    const outline = hand.grip === 'knife' ? FIST_OUTLINE : HAND_OUTLINE;
    const shape: Trace = (c) => traceSmoothLoop(c, outline);
    const thumb: Trace = (c) =>
      traceCapsule(c, THUMB.from, THUMB.to, THUMB.radius, THUMB.radius * THUMB.tipShare);
    outlineTrace(ctx, shape, build.outlinePixels);
    outlineTrace(ctx, thumb, build.outlinePixels);
    paintForm(ctx, shape, SKIN, HAND_SHADING);
    paintForm(ctx, thumb, SKIN, HAND_SHADING);
    if (!build.fine) return;
    if (hand.grip === 'knife') {
      for (const crease of FIST_CREASES) strokeLine(ctx, crease, SKIN.deep, FOLD_PIXELS);
    } else {
      strokeLine(ctx, KNUCKLE_LINE, SKIN.shade, FOLD_PIXELS, true);
      fillTrace(
        ctx,
        (c) => traceEllipse(c, PINKY_RING.at.x, PINKY_RING.at.y, PINKY_RING.rx, PINKY_RING.ry),
        GOLD.base,
      );
    }
  });
}
