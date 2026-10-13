/**
 * The Enchanted Spiked Kneepads of the Shade Gnoll Riot Forces on Carl: a dark
 * hide pad over each bare knee, ringed with a cuff of grey fur and bristling
 * with short pale Thorn Cadaver spikes. Head-on the spikes fan out from the
 * pad's rim, edge-on they stand off the front of the knee, and from behind
 * only the buckled straps round the back of the knee and the spike tips
 * poking past it show.
 */

import type { CarlLegFrame } from '../../art/carl/carlParts';
import { LIGHT, type Ramp } from '../../art/carl/palette';
import { KNEE_WIDTH, THIGH_LENGTH } from '../../art/carl/proportions';
import { clamp01, deg, lerp, type Pt } from '../../art/carlArt';
import { fillSoftEllipse, withClip } from '../../art/softShade';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** Gnoll hide: near-black brown going plum in the shade, so it parts from his tan skin at any size. */
const HIDE: Ramp = {
  deep: '#120a10',
  shadow: '#1d1118',
  dark: '#2a181c',
  mid: '#3a2220',
  base: '#4a2c24',
  light: '#744a33',
  rim: '#a87a58',
};
/** The fur cuff: a dusky grey-brown, lighter than the hide so the pad's edge reads. */
const FUR_SHADOW = '#4b4140';
const FUR_LIGHT = '#ab9d8c';
/** Thorn Cadaver spikes: bone gone yellow at the root, pale at the tip. */
const SPIKE_ROOT = '#b5a27c';
const SPIKE_TIP = '#f1e8cf';
const STRAP = '#24161a';
const BUCKLE = '#b9a98a';

/** The pad covers the kneecap and a little of the shin under it. */
const PAD_DROP = THIGH_LENGTH * 0.08;
const PAD_HALF_LENGTH = THIGH_LENGTH * 0.21;
/** Head-on the pad stands wider than the knee it wraps. */
const PAD_HALF_WIDTH = KNEE_WIDTH * 1.35;
/** A leg swung at the camera draws larger, and so does its pad. */
const NEAR_PAD_GAIN = 1.3;
/** Edge-on the pad is a slab on the front of the knee, set forward of the bone. */
const PROFILE_PAD_FORWARD = KNEE_WIDTH * 0.35;
const PROFILE_PAD_HALF_DEPTH = KNEE_WIDTH;
/** At the camera the pad is seen end-on, so it is as long as it is wide. */
const AT_CAMERA_HALF_LENGTH = PAD_HALF_WIDTH * 1.1;

/** Shading across the pad, from the lit side to the shadow side. */
const HIDE_LIT_STOP = 0.25;
const HIDE_SHADOW_STOP = 0.8;
const PAD_SHEEN_TOWARD_LIGHT = 0.35;
const PAD_SHEEN_SIZE = 0.45;
const PAD_SHEEN_ALPHA = 1;
/**
 * A hard lit lip round the side of the shell turned to the key: without it a
 * dark pad on a 32 px knee reads as a bruise rather than as a domed cap.
 */
const RIM_SPAN = deg(70);
const RIM_WIDTH = KNEE_WIDTH * 0.32;
/** The fur cuff wraps the top of the pad, toward the thigh. */
const FUR_FROM = deg(130);
const FUR_TO = deg(230);
const FUR_WIDTH = KNEE_WIDTH * 0.7;

const SPIKE_LENGTH = KNEE_WIDTH * 1.05;
const SPIKE_BASE_HALF = KNEE_WIDTH * 0.3;
/** How far into the pad a spike's root sits, so it grows out of the hide rather than off its edge. */
const SPIKE_ROOT_INSET = 0.85;
/** Head-on the spikes fan round the pad's rim: angles round the pad, 0 pointing down the shin. */
const FRONT_SPIKES: readonly number[] = [
  deg(55),
  deg(100),
  deg(150),
  deg(-55),
  deg(-100),
  deg(-150),
];
/** Edge-on they stand off the front of the knee only. */
const PROFILE_SPIKES: readonly number[] = [deg(-45), deg(-90), deg(-135)];
/** From behind only the tips past each side of the leg show. */
const BACK_SPIKES: readonly number[] = [deg(70), deg(115), deg(-70), deg(-115)];
const AT_CAMERA_SPIKES: readonly number[] = [
  deg(0),
  deg(60),
  deg(120),
  deg(180),
  deg(-60),
  deg(-120),
];
/** Spikes aimed at the camera show as studs on the pad's face: a pale tip over a pocket of shade. */
const FACE_STUDS: readonly Pt[] = [
  { x: -0.4, y: 0 },
  { x: 0.05, y: 0 },
  { x: 0.5, y: 0 },
];
const STUD_RADIUS = KNEE_WIDTH * 0.2;
/** The pale tip is the middle of the stud; its shade spills past it. */
const STUD_TIP_SHARE = 0.75;
const STUD_SHADE_DROP = STUD_RADIUS * 0.7;
const STUD_SHADE_ALPHA = 0.9;

/** From behind, two straps cross the back of the knee, above and below its crease. */
const BACK_STRAPS: readonly number[] = [-0.55, 0.55];
const STRAP_HALF = KNEE_WIDTH * 0.28;
const STRAP_REACH = PAD_HALF_WIDTH * 1.05;
const BUCKLE_HALF = STRAP_HALF * 0.8;
/** Each buckle sits partway out along its strap, on the lit side. */
const BUCKLE_AT = 0.55;

/** The pad's own frame: a centre, the shin's direction, and the normal across it. */
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

/** A point on the pad's rim, `angle` round from the shin direction toward `across`. */
function rimPoint(pad: PadFrame, angle: number, inset: number): Pt {
  return padPoint(
    pad,
    Math.cos(angle) * pad.halfLength * inset,
    Math.sin(angle) * pad.halfWidth * inset,
  );
}

function rimNormal(pad: PadFrame, angle: number): Pt {
  const along = Math.cos(angle) / pad.halfLength;
  const across = Math.sin(angle) / pad.halfWidth;
  const length = Math.hypot(along, across);
  return {
    x: (pad.along.x * along + pad.across.x * across) / length,
    y: (pad.along.y * along + pad.across.y * across) / length,
  };
}

function tracePad(ctx: Ctx, pad: PadFrame): void {
  ctx.beginPath();
  ctx.ellipse(
    pad.centre.x,
    pad.centre.y,
    pad.halfLength,
    pad.halfWidth,
    Math.atan2(pad.along.y, pad.along.x),
    0,
    Math.PI * 2,
  );
}

function padFrame(frame: CarlLegFrame, atCamera: boolean): PadFrame | null {
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
  const centre = {
    x: joint.x + along.x * PAD_DROP + across.x * forward,
    y: joint.y + along.y * PAD_DROP + across.y * forward,
  };
  return {
    centre,
    along,
    across,
    halfLength: PAD_HALF_LENGTH * gain,
    halfWidth: (frame.view.profile ? PROFILE_PAD_HALF_DEPTH : PAD_HALF_WIDTH) * gain,
  };
}

function paintHide(ctx: Ctx, pad: PadFrame): void {
  tracePad(ctx, pad);
  ctx.fillStyle = HIDE.base;
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
      shade.addColorStop(0, HIDE.light);
      shade.addColorStop(HIDE_LIT_STOP, HIDE.base);
      shade.addColorStop(HIDE_SHADOW_STOP, HIDE.dark);
      shade.addColorStop(1, HIDE.shadow);
      ctx.fillStyle = shade;
      tracePad(ctx, pad);
      ctx.fill();
      const sheen = {
        x: pad.centre.x + LIGHT.x * pad.halfWidth * PAD_SHEEN_TOWARD_LIGHT,
        y: pad.centre.y + LIGHT.y * pad.halfWidth * PAD_SHEEN_TOWARD_LIGHT,
      };
      fillSoftEllipse(
        ctx,
        sheen.x,
        sheen.y,
        pad.halfLength * PAD_SHEEN_SIZE,
        pad.halfWidth * PAD_SHEEN_SIZE,
        HIDE.rim,
        PAD_SHEEN_ALPHA,
        Math.atan2(pad.along.y, pad.along.x),
      );
      paintLitRim(ctx, pad);
      paintFurCuff(ctx, pad);
    },
  );
}

function paintLitRim(ctx: Ctx, pad: PadFrame): void {
  const lightAlong = LIGHT.x * pad.along.x + LIGHT.y * pad.along.y;
  const lightAcross = LIGHT.x * pad.across.x + LIGHT.y * pad.across.y;
  const towardLight = Math.atan2(lightAcross, lightAlong);
  ctx.strokeStyle = HIDE.rim;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    pad.centre.x,
    pad.centre.y,
    pad.halfLength,
    pad.halfWidth,
    Math.atan2(pad.along.y, pad.along.x),
    towardLight - RIM_SPAN,
    towardLight + RIM_SPAN,
  );
  ctx.stroke();
}

/** A band of fur along the pad's top rim, lit on the side toward the key. */
function paintFurCuff(ctx: Ctx, pad: PadFrame): void {
  const from = rimPoint(pad, FUR_FROM, 1);
  const to = rimPoint(pad, FUR_TO, 1);
  const fur = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  const fromLit = from.x * LIGHT.x + from.y * LIGHT.y >= to.x * LIGHT.x + to.y * LIGHT.y;
  fur.addColorStop(0, fromLit ? FUR_LIGHT : FUR_SHADOW);
  fur.addColorStop(1, fromLit ? FUR_SHADOW : FUR_LIGHT);
  ctx.strokeStyle = fur;
  ctx.lineWidth = FUR_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    pad.centre.x,
    pad.centre.y,
    pad.halfLength,
    pad.halfWidth,
    Math.atan2(pad.along.y, pad.along.x),
    FUR_FROM,
    FUR_TO,
  );
  ctx.stroke();
}

function paintSpike(ctx: Ctx, pad: PadFrame, angle: number): void {
  const root = rimPoint(pad, angle, SPIKE_ROOT_INSET);
  const out = rimNormal(pad, angle);
  const side = { x: -out.y, y: out.x };
  const tip = { x: root.x + out.x * SPIKE_LENGTH, y: root.y + out.y * SPIKE_LENGTH };
  const grain = ctx.createLinearGradient(root.x, root.y, tip.x, tip.y);
  grain.addColorStop(0, SPIKE_ROOT);
  grain.addColorStop(1, SPIKE_TIP);
  ctx.fillStyle = grain;
  ctx.beginPath();
  ctx.moveTo(root.x + side.x * SPIKE_BASE_HALF, root.y + side.y * SPIKE_BASE_HALF);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(root.x - side.x * SPIKE_BASE_HALF, root.y - side.y * SPIKE_BASE_HALF);
  ctx.closePath();
  ctx.fill();
}

function paintFaceStuds(ctx: Ctx, pad: PadFrame): void {
  for (const stud of FACE_STUDS) {
    const at = padPoint(pad, stud.x * pad.halfLength, stud.y * pad.halfWidth);
    const shadeAt = { x: at.x - LIGHT.x * STUD_SHADE_DROP, y: at.y - LIGHT.y * STUD_SHADE_DROP };
    fillSoftEllipse(
      ctx,
      shadeAt.x,
      shadeAt.y,
      STUD_RADIUS,
      STUD_RADIUS,
      HIDE.deep,
      STUD_SHADE_ALPHA,
    );
    ctx.fillStyle = SPIKE_TIP;
    ctx.beginPath();
    ctx.arc(at.x, at.y, STUD_RADIUS * STUD_TIP_SHARE, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** From behind the pad is hidden by the knee: its straps cross the back of the leg and buckle at the outer side. */
function paintBack(ctx: Ctx, pad: PadFrame): void {
  for (const angle of BACK_SPIKES) paintSpike(ctx, pad, angle);
  ctx.lineCap = 'butt';
  for (const along of BACK_STRAPS) {
    const from = padPoint(pad, along * pad.halfLength, -STRAP_REACH);
    const to = padPoint(pad, along * pad.halfLength, STRAP_REACH);
    ctx.strokeStyle = STRAP;
    ctx.lineWidth = STRAP_HALF * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const buckleSide = pad.across.x * LIGHT.x + pad.across.y * LIGHT.y >= 0 ? 1 : -1;
    const buckle = padPoint(pad, along * pad.halfLength, buckleSide * STRAP_REACH * BUCKLE_AT);
    ctx.fillStyle = BUCKLE;
    ctx.fillRect(buckle.x - BUCKLE_HALF, buckle.y - BUCKLE_HALF, BUCKLE_HALF * 2, BUCKLE_HALF * 2);
  }
}

function paintLeg(ctx: Ctx, frame: CarlLegFrame): void {
  const atCamera = frame.piece === 'kneeAtCamera';
  // A knee driven at the camera is painted in its own slab after the thigh's, so
  // the pad waits for that moment rather than painting on either half of the leg.
  if (!atCamera && frame.segments !== 'whole') return;
  const pad = padFrame(frame, atCamera);
  if (pad === null) return;
  if (frame.view.showsBack && !frame.view.profile) {
    paintBack(ctx, pad);
    return;
  }
  const spikes = atCamera ? AT_CAMERA_SPIKES : frame.view.profile ? PROFILE_SPIKES : FRONT_SPIKES;
  for (const angle of spikes) paintSpike(ctx, pad, angle);
  paintHide(ctx, pad);
  if (!frame.view.profile) paintFaceStuds(ctx, pad);
}

export const CARL_KNEEPADS = defineGarment({
  id: 'carl_kneepads',
  name: 'Spiked Kneepads of the Shade Gnoll Riot Forces',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  paint: { leg: carlEveryView(paintLeg) },
});
