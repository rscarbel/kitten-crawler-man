/**
 * Donald's arms and hands, shared by the bust and the club-floor figure.
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
  traceSmoothLoop,
} from '../deuce/paint';
import { GOLD, SHIRT, SKIN } from './palette';

export interface ArmBuild {
  shoulderRadius: number;
  elbowRadius: number;
  wristRadius: number;
  cuffLength: number;
  handLength: number;
  handWidth: number;
  outlinePixels: number;
  /** Whether creases, cufflinks and the pinky ring are drawn. */
  fine: boolean;
}

export interface PlacedHand {
  wrist: Pt;
  angle: number;
  /** Which way the thumb stands off the hand: +1 counter-clockwise of the hand's axis. */
  thumbSide: 1 | -1;
}

const SLEEVE_SHADING: FormShading = { shadow: 0.35, highlight: 0.12 };
const HAND_SHADING: FormShading = { shadow: 0.2, highlight: 0.06 };
const FOLD_PIXELS = 1;
/** Shares of the elbow-to-wrist run: where the cuff begins. */
const CUFF_FROM = 0.8;
const CUFFLINK_RADIUS = 0.22;
/** The cufflink sits halfway from the cuff's centre line to its edge. */
const CUFFLINK_OFFSET = 0.5;
/** How far the crook's fold runs from the elbow toward the inside of the bend. */
const CROOK_FOLD_REACH = 0.12;
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
const THUMB = { from: pt(0.25, 0), to: pt(0.62, 0.62), radius: 0.17, tipShare: 0.8 } as const;
const KNUCKLE_LINE: readonly Pt[] = [pt(0.62, -0.38), pt(0.66, 0), pt(0.62, 0.34)];
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

/** A hand at its wrist. */
export function paintHand(ctx: Ctx, build: ArmBuild, hand: PlacedHand): void {
  inHandSpace(ctx, build, hand, () => {
    const shape: Trace = (c) => traceSmoothLoop(c, HAND_OUTLINE);
    const thumb: Trace = (c) =>
      traceCapsule(c, THUMB.from, THUMB.to, THUMB.radius, THUMB.radius * THUMB.tipShare);
    outlineTrace(ctx, shape, build.outlinePixels);
    outlineTrace(ctx, thumb, build.outlinePixels);
    paintForm(ctx, shape, SKIN, HAND_SHADING);
    paintForm(ctx, thumb, SKIN, HAND_SHADING);
    if (!build.fine) return;
    strokeLine(ctx, KNUCKLE_LINE, SKIN.shade, FOLD_PIXELS, true);
    fillTrace(
      ctx,
      (c) => traceEllipse(c, PINKY_RING.at.x, PINKY_RING.at.y, PINKY_RING.rx, PINKY_RING.ry),
      GOLD.base,
    );
  });
}
