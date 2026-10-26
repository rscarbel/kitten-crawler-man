/**
 * The Riot Kneeguards on the human crawler: a black hard-shell cap strapped
 * over each knee of his trousers, its dome scuffed white where it has hit the
 * floor. Head-on the shell is a domed
 * oval over the kneecap, edge-on a slab standing off the front of the knee,
 * and from behind only the two straps round the back of the knee show.
 */

import type { BipedLegFrame } from '../../art/biped/bipedParts';
import { LIGHT, type Ramp } from '../../art/biped/palette';
import { KNEE_WIDTH, THIGH_LENGTH } from '../../art/biped/proportions';
import { clamp01, lerp, type Pt, rgba } from '../../art/bipedArt';
import { fillSoftEllipse, withClip } from '../../art/softShade';
import { defineGarment } from '../garmentDef';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** Black moulded plastic, cool in the shade and glossy where the key catches it. */
const SHELL: Ramp = {
  deep: '#08090c',
  shadow: '#101217',
  dark: '#181b21',
  mid: '#22262e',
  base: '#2d323b',
  light: '#4f5763',
  rim: '#8e98a6',
};
/** The scuffs: the shell's black worn through to white. */
const SCUFF = '#e4e6ea';
const SCUFF_ALPHA = 0.85;
const STRAP = '#15171b';
const BUCKLE = '#9da3ad';

/** The shell covers the kneecap and a little of the shin under it. */
const PAD_DROP = THIGH_LENGTH * 0.03;
const PAD_HALF_LENGTH = THIGH_LENGTH * 0.18;
/** Head-on the shell stands wider than the knee it wraps. */
const PAD_HALF_WIDTH = KNEE_WIDTH * 1.4;
/** A leg swung at the camera draws larger, and so does its shell. */
const NEAR_PAD_GAIN = 1.3;
/** Edge-on the shell is a slab on the front of the knee, set forward of the bone. */
const PROFILE_PAD_FORWARD = KNEE_WIDTH * 0.45;
const PROFILE_PAD_HALF_DEPTH = KNEE_WIDTH * 0.85;
/** At the camera the shell is seen end-on, so it is as long as it is wide. */
const AT_CAMERA_HALF_LENGTH = PAD_HALF_WIDTH * 1.05;

/** Shading across the shell, from the lit side to the shadow side. */
const SHELL_LIT_STOP = 0.2;
const SHELL_SHADOW_STOP = 0.75;
/** The hard gloss of moulded plastic: a small bright spot toward the key. */
const SHEEN_TOWARD_LIGHT = 0.45;
const SHEEN_SIZE = 0.3;
const SHEEN_ALPHA = 0.9;
/** A lit lip round the side of the dome turned to the key: a black cap needs it to read as a dome. */
const RIM_WIDTH = KNEE_WIDTH * 0.28;
const RIM_SPAN = Math.PI * 0.4;

/** Scuff strokes across the crown of the dome, in shares of the shell's half length and half width. */
const SCUFFS: readonly { readonly from: Pt; readonly to: Pt }[] = [
  { from: { x: -0.35, y: -0.15 }, to: { x: 0.05, y: -0.4 } },
  { from: { x: -0.1, y: 0.2 }, to: { x: 0.25, y: 0.05 } },
];
const SCUFF_WIDTH = KNEE_WIDTH * 0.2;
/** From behind, two straps cross the back of the knee, above and below its crease. */
const BACK_STRAPS: readonly number[] = [-0.6, 0.6];
const STRAP_HALF = KNEE_WIDTH * 0.26;
const STRAP_REACH = PAD_HALF_WIDTH * 0.95;
const BUCKLE_HALF = STRAP_HALF * 0.85;
const BUCKLE_AT = 0.6;

interface PadFrame {
  readonly centre: Pt;
  readonly along: Pt;
  readonly across: Pt;
  readonly halfLength: number;
  readonly halfWidth: number;
}

function padPoint(pad: PadFrame, along: number, across: number): Pt {
  return {
    x: pad.centre.x + pad.along.x * along + pad.across.x * across,
    y: pad.centre.y + pad.along.y * along + pad.across.y * across,
  };
}

/** A point given in shares of the shell's half length and half width. */
function padShare(pad: PadFrame, share: Pt): Pt {
  return padPoint(pad, share.x * pad.halfLength, share.y * pad.halfWidth);
}

function padAngle(pad: PadFrame): number {
  return Math.atan2(pad.along.y, pad.along.x);
}

function tracePad(ctx: Ctx, pad: PadFrame): void {
  ctx.beginPath();
  ctx.ellipse(
    pad.centre.x,
    pad.centre.y,
    pad.halfLength,
    pad.halfWidth,
    padAngle(pad),
    0,
    Math.PI * 2,
  );
}

function padFrame(frame: BipedLegFrame, atCamera: boolean): PadFrame | null {
  const { joint, end } = frame.chain;
  const shinLength = Math.hypot(end.x - joint.x, end.y - joint.y);
  if (shinLength <= 0) return null;
  const along = { x: (end.x - joint.x) / shinLength, y: (end.y - joint.y) / shinLength };
  const across = { x: -along.y, y: along.x };
  const nearness =
    frame.drawn === 'left' ? frame.pose.leftLegNearness : frame.pose.rightLegNearness;
  const gain = lerp(1, NEAR_PAD_GAIN, clamp01(nearness));
  if (atCamera) {
    return {
      centre: joint,
      along,
      across,
      halfLength: AT_CAMERA_HALF_LENGTH * gain,
      halfWidth: PAD_HALF_WIDTH * gain,
    };
  }
  // Edge-on the front of the leg is the bone's minus side.
  const forward = frame.view.profile ? -PROFILE_PAD_FORWARD : 0;
  return {
    centre: {
      x: joint.x + along.x * PAD_DROP + across.x * forward,
      y: joint.y + along.y * PAD_DROP + across.y * forward,
    },
    along,
    across,
    halfLength: PAD_HALF_LENGTH * gain,
    halfWidth: (frame.view.profile ? PROFILE_PAD_HALF_DEPTH : PAD_HALF_WIDTH) * gain,
  };
}

function paintLitRim(ctx: Ctx, pad: PadFrame): void {
  const lightAlong = LIGHT.x * pad.along.x + LIGHT.y * pad.along.y;
  const lightAcross = LIGHT.x * pad.across.x + LIGHT.y * pad.across.y;
  const towardLight = Math.atan2(lightAcross, lightAlong);
  ctx.strokeStyle = SHELL.rim;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    pad.centre.x,
    pad.centre.y,
    pad.halfLength,
    pad.halfWidth,
    padAngle(pad),
    towardLight - RIM_SPAN,
    towardLight + RIM_SPAN,
  );
  ctx.stroke();
}

function paintScuffs(ctx: Ctx, pad: PadFrame): void {
  ctx.strokeStyle = rgba(SCUFF, SCUFF_ALPHA);
  ctx.lineWidth = SCUFF_WIDTH;
  ctx.lineCap = 'round';
  for (const scuff of SCUFFS) {
    const from = padShare(pad, scuff.from);
    const to = padShare(pad, scuff.to);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

function paintShell(ctx: Ctx, pad: PadFrame): void {
  tracePad(ctx, pad);
  ctx.fillStyle = SHELL.base;
  ctx.fill();
  const lit = {
    x: pad.centre.x + LIGHT.x * pad.halfWidth,
    y: pad.centre.y + LIGHT.y * pad.halfWidth,
  };
  const unlit = {
    x: pad.centre.x - LIGHT.x * pad.halfWidth,
    y: pad.centre.y - LIGHT.y * pad.halfWidth,
  };
  withClip(
    ctx,
    () => tracePad(ctx, pad),
    () => {
      const shade = ctx.createLinearGradient(lit.x, lit.y, unlit.x, unlit.y);
      shade.addColorStop(0, SHELL.light);
      shade.addColorStop(SHELL_LIT_STOP, SHELL.base);
      shade.addColorStop(SHELL_SHADOW_STOP, SHELL.dark);
      shade.addColorStop(1, SHELL.shadow);
      ctx.fillStyle = shade;
      tracePad(ctx, pad);
      ctx.fill();
      paintScuffs(ctx, pad);
      const sheen = {
        x: pad.centre.x + LIGHT.x * pad.halfWidth * SHEEN_TOWARD_LIGHT,
        y: pad.centre.y + LIGHT.y * pad.halfWidth * SHEEN_TOWARD_LIGHT,
      };
      fillSoftEllipse(
        ctx,
        sheen.x,
        sheen.y,
        pad.halfLength * SHEEN_SIZE,
        pad.halfWidth * SHEEN_SIZE,
        SHELL.rim,
        SHEEN_ALPHA,
        padAngle(pad),
      );
      paintLitRim(ctx, pad);
    },
  );
}

function paintStrap(ctx: Ctx, from: Pt, to: Pt): void {
  ctx.strokeStyle = STRAP;
  ctx.lineWidth = STRAP_HALF * 2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/** From behind the shell is hidden by the knee: its straps cross the back of the leg and buckle at the outer side. */
function paintBack(ctx: Ctx, pad: PadFrame): void {
  for (const along of BACK_STRAPS) {
    paintStrap(
      ctx,
      padPoint(pad, along * pad.halfLength, -STRAP_REACH),
      padPoint(pad, along * pad.halfLength, STRAP_REACH),
    );
    const buckleSide = pad.across.x * LIGHT.x + pad.across.y * LIGHT.y >= 0 ? 1 : -1;
    const buckle = padPoint(pad, along * pad.halfLength, buckleSide * STRAP_REACH * BUCKLE_AT);
    ctx.fillStyle = BUCKLE;
    ctx.fillRect(buckle.x - BUCKLE_HALF, buckle.y - BUCKLE_HALF, BUCKLE_HALF * 2, BUCKLE_HALF * 2);
  }
}

function paintLeg(ctx: Ctx, frame: BipedLegFrame): void {
  const atCamera = frame.piece === 'kneeAtCamera';
  // A knee driven at the camera is painted in its own slab after the thigh's, so
  // the shell waits for that moment rather than painting on either half of the leg.
  if (!atCamera && frame.segments !== 'whole') return;
  const pad = padFrame(frame, atCamera);
  if (pad === null) return;
  if (frame.view.showsBack && !frame.view.profile) {
    paintBack(ctx, pad);
    return;
  }
  paintShell(ctx, pad);
}

export const HUMAN_RIOT_KNEEGUARDS = defineGarment({
  id: 'human_riot_kneeguards',
  name: 'Riot Kneeguards',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['leg'],
  paint: { leg: humanEveryView(paintLeg) },
});
