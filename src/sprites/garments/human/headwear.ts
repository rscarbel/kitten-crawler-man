/**
 * What the human crawler's hats share: shapes authored as head-local paths in
 * the same fractions his hair is (`ryanHead.ts`: x a share of `HEAD_RX`
 * head-on and of `HEAD_DEPTH` edge-on, the face toward +X; y a share of
 * `HEAD_RY`, the eye line at 0, the skull's crown at −1.2), and the pitch a
 * hat takes with the crop it sits on.
 *
 * A hat paints over his hair, so each one has to come down over the crop far
 * enough that no hair stands above it: Ryan's swept top reaches −1.36 head-on,
 * −1.48 edge-on and −1.42 from behind, Dave's tufts about as high.
 */

import { pitchedHairY } from '../../art/biped/head';
import type { BipedHeadFrame } from '../../art/biped/bipedParts';
import { type PathCommand, headUnits, type Units } from '../../art/human/castHead';
import type { CardinalView } from '../../facingView';
import { humanViews } from './views';

type Ctx = CanvasRenderingContext2D;

export type { PathCommand, Units };

/** The head-local units a hat's paths are authored in, for one view. */
export function hatUnits(view: CardinalView): Units {
  return headUnits(view === 'side');
}

/** Traces `path` in `units` as one closed shape. */
export function traceHatPath(ctx: Ctx, path: readonly PathCommand[], units: Units): void {
  ctx.beginPath();
  for (const command of path) {
    if (command[0] === 'Q') {
      ctx.quadraticCurveTo(
        command[1] * units.x,
        command[2] * units.y,
        command[3] * units.x,
        command[4] * units.y,
      );
    } else if (command[0] === 'M') {
      ctx.moveTo(command[1] * units.x, command[2] * units.y);
    } else {
      ctx.lineTo(command[1] * units.x, command[2] * units.y);
    }
  }
  ctx.closePath();
}

/** Fills `path` in `units` with `style`. */
export function fillHatPath(
  ctx: Ctx,
  path: readonly PathCommand[],
  units: Units,
  style: string | CanvasGradient,
): void {
  traceHatPath(ctx, path, units);
  ctx.fillStyle = style;
  ctx.fill();
}

/** Strokes an open line through head-local points `[x, y, x, y, …]` in `units`. */
export function strokeHatLine(
  ctx: Ctx,
  points: readonly number[],
  units: Units,
  colour: string,
  width: number,
): void {
  ctx.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] * units.x;
    const y = points[i + 1] * units.y;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * Head-on his crop is pitched with the head (`pitchedHairY`): squashed about
 * its top and risen on the neck as the chin lifts. A hat sitting on the crop
 * takes the same vertical map, so it stays seated as he looks up or down.
 * Edge-on the head's own rotation carries the pitch, and from behind the crop
 * is not pitched at all.
 */
function applyHairPitch(ctx: Ctx, frame: BipedHeadFrame, view: CardinalView): void {
  if (view !== 'front') return;
  const lift = frame.pose.chinLift ?? 0;
  const atEyeLine = pitchedHairY(0, lift);
  const squash = pitchedHairY(1, lift) - atEyeLine;
  ctx.transform(1, 0, 0, squash, 0, atEyeLine);
}

/** A hat painter for one cardinal view, already seated on his pitched crop. */
export type HatPainter = (ctx: Ctx, view: CardinalView, frame: BipedHeadFrame) => void;

/** A hat's head painters for every view, each run on the crop's pitch. */
export function hatViews(painters: Readonly<Record<CardinalView, HatPainter>>) {
  const seated =
    (view: CardinalView) =>
    (ctx: Ctx, frame: BipedHeadFrame): void => {
      ctx.save();
      applyHairPitch(ctx, frame, view);
      painters[view](ctx, view, frame);
      ctx.restore();
    };
  return humanViews({ front: seated('front'), side: seated('side'), back: seated('back') });
}
