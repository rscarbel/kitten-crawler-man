/**
 * A stick of red goblin dynamite, gripped round its middle, with a short fuse
 * off one end and — once lit — a spark at the fuse's tip.
 *
 * The spark is drawn in figure space rather than in the grip's rotated frame:
 * whatever angle the fist holds the stick at, a burning fuse throws its light
 * and sparks up, not along the stick.
 */

import { addCapsule, shadeForm } from '../paint';
import { FAR_LIMB_SHADE, OUTLINE, type Ramp, receded } from '../palette';
import type { HeldProp, PropPainter, PropReach } from '../props';
import type { Pt } from '../../carlArt';
import { squareAround } from './reach';

/**
 * Paper-wrapped stick red. Local to this prop: nothing else on the figure is
 * this colour but the boxers' hearts, which are a printed motif, not a solid.
 */
const STICK_RED: Ramp = {
  deep: '#3a0708',
  shadow: '#6a0f10',
  dark: '#8e1716',
  mid: '#b0231d',
  base: '#cc2f24',
  light: '#e8503a',
  rim: '#ff8a64',
};

/**
 * End to end. Longer than a real stick is against a man this size: at the
 * 32 px tile the part showing either side of the fist is all that says
 * "stick", and at life size that is a pixel.
 */
const STICK_LENGTH = 0.36;
/** Where the fist grips it, from the butt; the fuse end is past this. */
const STICK_GRIP_SHARE = 0.42;
const STICK_HALF_WIDTH = 0.042;
/** A dark rim round the stick, so red on brown leather keeps an edge at tile size. */
const STICK_OUTLINE = 0.012;

/** The fuse: a short cord bent off the stick's end. */
const FUSE_LENGTH = 0.07;
/** How far the fuse's tip bends off the stick's line, as a share of its length. */
const FUSE_BEND = 0.45;
/** Where along the fuse its bend's control point sits: the cord leaves the stick straight, then curls. */
const FUSE_CONTROL_SHARE = 0.6;
const FUSE_WIDTH = 0.016;
const FUSE_COLOUR = '#4a2a14';

/** The spark's halo, its hot core and its white centre. */
const SPARK_HALO_RADIUS = 0.07;
const SPARK_CORE_RADIUS = 0.032;
const SPARK_CENTRE_RADIUS = 0.014;
const SPARK_HALO = 'rgba(255, 150, 40, 0.5)';
const SPARK_CORE = '#ffd64a';
const SPARK_CENTRE = '#fffbe8';
/** Sparks thrown off the burning tip: short bright strokes. */
const SPARK_RAY_LENGTH = 0.05;
const SPARK_RAY_WIDTH = 0.012;
const SPARK_RAY_COLOUR = '#ffe070';
/**
 * The spark's rays are drawn at one of a few fixed fans, one per variant, so
 * a hold loop can flicker by stepping through them. Each fan is a set of
 * angles in radians from straight up.
 */
const SPARK_FANS: readonly (readonly number[])[] = [
  [-0.9, 0.2, 1.1],
  [-0.4, 0.8],
  [-1.2, -0.1, 0.6],
  [0.4, 1.3, -0.7],
];
/** The flare on the tick the fuse catches: a wider halo than the steady burn. */
const CATCHING_HALO_SCALE = 1.25;

/**
 * The looks a stick can be posed with:
 * - `unlit` (the default when absent): stick and fuse.
 * - `catching`: the fuse just lit, flaring.
 * - `lit-<n>`: burning, with the spark's rays at fan `n` of {@link SPARK_FANS}.
 */
export type DynamiteVariant = 'unlit' | 'catching' | `lit-${number}`;

/** The burning stick's look on step `step` of a flicker: steps through the spark fans. */
export function burningDynamite(step: number): DynamiteVariant {
  const fan = ((step % SPARK_FANS.length) + SPARK_FANS.length) % SPARK_FANS.length;
  return `lit-${fan}`;
}

const LIT_PREFIX = 'lit-';

function sparkFanOf(prop: HeldProp): readonly number[] | null {
  const variant = prop.variant ?? 'unlit';
  if (variant === 'catching') return SPARK_FANS[0];
  if (!variant.startsWith(LIT_PREFIX)) return null;
  const index = Number(variant.slice(LIT_PREFIX.length));
  return SPARK_FANS[Number.isInteger(index) ? index % SPARK_FANS.length : 0];
}

function drawSpark(
  ctx: CanvasRenderingContext2D,
  tip: Pt,
  fan: readonly number[],
  haloScale: number,
): void {
  ctx.fillStyle = SPARK_HALO;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, SPARK_HALO_RADIUS * haloScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = SPARK_RAY_COLOUR;
  ctx.lineWidth = SPARK_RAY_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const angle of fan) {
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x + Math.sin(angle) * SPARK_RAY_LENGTH * haloScale,
      tip.y - Math.cos(angle) * SPARK_RAY_LENGTH * haloScale,
    );
  }
  ctx.stroke();
  ctx.fillStyle = SPARK_CORE;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, SPARK_CORE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = SPARK_CENTRE;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, SPARK_CENTRE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The fuse's tip, which the stick's scale carries, and round it the catching
 * flare, which it does not.
 */
export const dynamiteReach: PropReach = (grip, prop) =>
  squareAround(
    grip.centre,
    Math.hypot(STICK_LENGTH * (1 - STICK_GRIP_SHARE) + FUSE_LENGTH, FUSE_LENGTH * FUSE_BEND) *
      (prop.scale ?? 1) +
      Math.max(SPARK_HALO_RADIUS, SPARK_RAY_LENGTH) * CATCHING_HALO_SCALE,
  );

export const drawDynamite: PropPainter = (ctx, grip, prop, _view, behindHand) => {
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const scale = prop.scale ?? 1;
  const red = receded(STICK_RED, behindHand ? FAR_LIMB_SHADE : 0);

  const length = STICK_LENGTH * scale;
  const butt = { x: -length * STICK_GRIP_SHARE, y: 0 };
  const end = { x: length * (1 - STICK_GRIP_SHARE), y: 0 };
  const half = STICK_HALF_WIDTH * scale;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toFigure = (local: Pt): Pt => ({
    x: grip.centre.x + local.x * cos - local.y * sin,
    y: grip.centre.y + local.x * sin + local.y * cos,
  });

  // The fuse bends toward whichever side of the stick is up on screen, so it
  // reads as a cord standing off the end rather than drooping into the fist.
  const upSide = cos >= 0 ? -1 : 1;
  const fuseLength = FUSE_LENGTH * scale;
  const fuseTip = toFigure({ x: end.x + fuseLength, y: upSide * fuseLength * FUSE_BEND });

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(angle);

  ctx.strokeStyle = FUSE_COLOUR;
  ctx.lineWidth = FUSE_WIDTH * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(end.x, 0);
  ctx.quadraticCurveTo(
    end.x + fuseLength * FUSE_CONTROL_SHARE,
    0,
    end.x + fuseLength,
    upSide * fuseLength * FUSE_BEND,
  );
  ctx.stroke();

  ctx.beginPath();
  addCapsule(ctx, butt, end, half + STICK_OUTLINE, half + STICK_OUTLINE);
  ctx.fillStyle = OUTLINE;
  ctx.fill();

  const traceStick = (): void => {
    ctx.beginPath();
    addCapsule(ctx, butt, end, half, half);
  };
  shadeForm(ctx, traceStick, { from: butt, to: end }, red, {
    halfWidth: half,
    frameRotation: angle,
  });
  ctx.restore();

  const fan = sparkFanOf(prop);
  if (fan === null) return;
  const haloScale = prop.variant === 'catching' ? CATCHING_HALO_SCALE : 1;
  drawSpark(ctx, fuseTip, fan, haloScale);
};
