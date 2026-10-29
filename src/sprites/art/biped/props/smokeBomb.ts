/**
 * A fired-clay smoke bomb held by its neck: the round terracotta pot hangs off
 * the butt end of the fist, the neck runs up through it and the cork stopper
 * stands off the knuckles, with — once lit — a wisp of grey smoke curling up
 * off it. It is the pot `smokeBombSprite.ts` draws in the air, in the same
 * clay and cork, so what leaves his hand is what flies.
 *
 * Held by the neck for the reason the black powder bomb is: the fingers are
 * composited in front of whatever the fist holds, so a pot cupped in the fist
 * would vanish behind the knuckles.
 *
 * Unglazed clay is matte: the pot's light is one broad lit side under the
 * figure's upper-left key with no hard specular, which is most of what keeps
 * it from reading as the iron bomb's shine. The smoke always rises up the
 * screen, whichever way the fist holds the pot.
 */

import { FAR_LIMB_SHADE, OUTLINE, type Ramp, receded } from '../palette';
import type { HeldProp, PropPainter, PropReach } from '../props';
import type { Pt } from '../../bipedArt';
import { squareAround } from './reach';

/** The in-flight pot's clay, as a ramp: `base` is its `CLAY`. */
const CLAY: Ramp = {
  deep: '#4a2112',
  shadow: '#7a3a1e',
  dark: '#8f4626',
  mid: '#a5552f',
  base: '#bf6a3d',
  light: '#de9564',
  rim: '#eab48a',
};
const NECK_CLAY = '#a85a33';
const CORK = '#dcb97f';
const CORK_SHADE = '#9a7746';
/** Floor light bounced up under the pot: warm, and only a thin rim. */
const REFLECTED_LIGHT = '#c98a62';
const SMOKE_INK = '#d8d8d4';
const SMOKE_SHADE_INK = '#8e8e8a';

/**
 * The pot's radius: a touch larger than the iron ball, since a clay pot is
 * thicker-walled; about nine pixels across at the 32 px tile.
 */
const POT_RADIUS = 0.14;
/** How much neck shows between the pot and the fist, along the bore. */
const NECK_SHOWN = 0.045;
/** Where the pot's centre sits along the bore: past the fist's butt end. */
const POT_CENTRE_ALONG = -(POT_RADIUS + NECK_SHOWN);
/** Where the neck's lip comes out past the knuckles, along the bore. */
const NECK_MOUTH_ALONG = 0.05;
const NECK_HALF_WIDTH = 0.04;
/** The lip flares a little wider than the neck, as a thrown pot's rim does. */
const LIP_HALF_WIDTH = 0.056;
const LIP_LENGTH = 0.022;
/** The stubby cork standing proud of the lip: short and nearly as wide as the neck. */
const CORK_LENGTH = 0.062;
const CORK_HALF_WIDTH = 0.04;
/** The dark rim round the pot, neck and cork, so they keep an edge on his jacket. */
const CLAY_OUTLINE = 0.016;

/** The lit side is the pot's own outline shifted toward the key, so the terminator is one curved line. */
const LIT_SHIFT_X = -0.28;
const LIT_SHIFT_Y = -0.34;
const TERMINATOR_WIDTH_SHARE = 0.1;
/** A broad, soft matte bloom on the lit side, never a pin-point shine. */
const BLOOM_X = -0.36;
const BLOOM_Y = -0.4;
const BLOOM_RADIUS_SHARE = 0.36;
const BLOOM_ALPHA = 0.55;
/** The bounce rim's cut-out, shifted a little toward the key so the rim stays thin. */
const RIM_SHIFT_X = -0.12;
const RIM_SHIFT_Y = -0.18;
const RIM_ALPHA = 0.45;
/**
 * The groove a potter scores round the shoulder, circling the neck's root: how
 * far toward the neck it sits, as a share of the radius, and how much of its
 * circle is seen edge-on. It turns with the bore, so it always collars the neck.
 */
const RING_TOWARD_NECK = 0.5;
const RING_TILT_SHARE = 0.28;
const RING_WIDTH = 0.012;
/** Faint, so the ring reads as a scored line in the clay rather than a ball's seam. */
const RING_ALPHA = 0.6;

/** How the wisp rises off the cork: its height, its sideways sway and its widths, in rig units. */
const WISP_HEIGHT = 0.24;
const WISP_SWAY = 0.045;
const WISP_NEAR_WIDTH = 0.032;
const WISP_FAR_WIDTH = 0.064;
const WISP_SEGMENTS = 6;
const WISP_PEAK_ALPHA = 0.9;
const WISP_SHADE_ALPHA = 0.55;
/** How far the shade stroke sits under the lit one, so the wisp has a lit top and a shadowed belly. */
const WISP_SHADE_DROP = 0.008;
/** A puff just catching is short and round: a fraction of the full wisp, a little wider. */
const CATCHING_HEIGHT_SHARE = 0.45;
const CATCHING_WIDTH_SCALE = 1.25;
/** How many distinct curls the burning wisp steps through, one per lit variant. */
const WISP_CURL_STEPS = 4;

const FULL_TURN = Math.PI * 2;
/** Below this a mid-bake alpha is clamped to 0, as the prop painter contract asks. */
const MIN_PAINTED_ALPHA = 1e-6;
const LIT_PREFIX = 'lit-';

/** How far the pot's far side and the top of the wisp lie from the grip, per unit scale. */
const POT_FAR_REACH = -POT_CENTRE_ALONG + POT_RADIUS + CLAY_OUTLINE;
const CORK_TIP_ALONG = NECK_MOUTH_ALONG + LIP_LENGTH + CORK_LENGTH;
const WISP_REACH = CORK_TIP_ALONG + WISP_HEIGHT + WISP_FAR_WIDTH * CATCHING_WIDTH_SCALE;

export const smokeBombReach: PropReach = (grip, prop) =>
  squareAround(grip.centre, Math.max(POT_FAR_REACH, WISP_REACH) * (prop.scale ?? 1));

/** The wisp for the prop's variant: none unlit, a short puff catching, a curling thread lit. */
function wispOf(prop: HeldProp): { readonly curl: number; readonly catching: boolean } | null {
  const variant = prop.variant ?? 'unlit';
  if (variant === 'catching') return { curl: 0, catching: true };
  if (!variant.startsWith(LIT_PREFIX)) return null;
  const step = Number(variant.slice(LIT_PREFIX.length));
  return { curl: Number.isInteger(step) ? step % WISP_CURL_STEPS : 0, catching: false };
}

function paintPot(
  ctx: CanvasRenderingContext2D,
  centre: Pt,
  radius: number,
  outline: number,
  clay: Ramp,
  boreAngle: number,
): void {
  const { x: cx, y: cy } = centre;
  const tracePot = (dx: number, dy: number): void => {
    ctx.beginPath();
    ctx.arc(cx + dx * radius, cy + dy * radius, radius, 0, FULL_TURN);
  };
  ctx.beginPath();
  ctx.arc(cx, cy, radius + outline, 0, FULL_TURN);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  tracePot(0, 0);
  ctx.fillStyle = clay.shadow;
  ctx.fill();

  ctx.save();
  tracePot(0, 0);
  ctx.clip();
  tracePot(LIT_SHIFT_X, LIT_SHIFT_Y);
  ctx.fillStyle = clay.base;
  ctx.fill();
  ctx.strokeStyle = clay.dark;
  ctx.lineWidth = radius * TERMINATOR_WIDTH_SHARE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + BLOOM_X * radius, cy + BLOOM_Y * radius, radius * BLOOM_RADIUS_SHARE, 0, FULL_TURN);
  ctx.globalAlpha = BLOOM_ALPHA;
  ctx.fillStyle = clay.light;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, FULL_TURN);
  ctx.arc(cx + RIM_SHIFT_X * radius, cy + RIM_SHIFT_Y * radius, radius, 0, FULL_TURN);
  ctx.globalAlpha = RIM_ALPHA;
  ctx.fillStyle = REFLECTED_LIGHT;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
  const ringHalfChord = radius * Math.sqrt(1 - RING_TOWARD_NECK * RING_TOWARD_NECK);
  ctx.beginPath();
  ctx.ellipse(
    cx + Math.cos(boreAngle) * RING_TOWARD_NECK * radius,
    cy + Math.sin(boreAngle) * RING_TOWARD_NECK * radius,
    ringHalfChord * RING_TILT_SHARE,
    ringHalfChord,
    boreAngle,
    Math.PI / 2,
    (Math.PI * 3) / 2,
  );
  ctx.globalAlpha = RING_ALPHA;
  ctx.strokeStyle = clay.dark;
  ctx.lineWidth = RING_WIDTH * (radius / POT_RADIUS);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** A band across the bore from `from` to `to`, `halfWidth` either side, outlined. */
function paintBand(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  halfWidth: number,
  outline: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = (halfWidth + outline) * 2;
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = halfWidth * 2;
  ctx.stroke();
}

/** The wisp rising straight up the screen off the cork's tip, swaying as it climbs. */
function paintWisp(
  ctx: CanvasRenderingContext2D,
  tip: Pt,
  scale: number,
  wisp: { readonly curl: number; readonly catching: boolean },
): void {
  const height = WISP_HEIGHT * scale * (wisp.catching ? CATCHING_HEIGHT_SHARE : 1);
  const widthScale = scale * (wisp.catching ? CATCHING_WIDTH_SCALE : 1);
  const phase = (wisp.curl / WISP_CURL_STEPS) * FULL_TURN;
  const pointAt = (along: number): Pt => ({
    x: tip.x + Math.sin(along * FULL_TURN + phase) * WISP_SWAY * scale * along,
    y: tip.y - height * along,
  });
  ctx.save();
  ctx.lineCap = 'round';
  for (const pass of ['shade', 'lit'] as const) {
    const drop = pass === 'shade' ? WISP_SHADE_DROP * scale : 0;
    ctx.strokeStyle = pass === 'shade' ? SMOKE_SHADE_INK : SMOKE_INK;
    let previous = pointAt(0);
    for (let step = 1; step <= WISP_SEGMENTS; step++) {
      const along = step / WISP_SEGMENTS;
      const point = pointAt(along);
      const fade = (pass === 'shade' ? WISP_SHADE_ALPHA : WISP_PEAK_ALPHA) * (1 - along * along);
      ctx.globalAlpha = fade < MIN_PAINTED_ALPHA ? 0 : fade;
      ctx.lineWidth = (WISP_NEAR_WIDTH + (WISP_FAR_WIDTH - WISP_NEAR_WIDTH) * along) * widthScale;
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y + drop);
      ctx.lineTo(point.x, point.y + drop);
      ctx.stroke();
      previous = point;
    }
  }
  ctx.restore();
}

export const drawSmokeBomb: PropPainter = (ctx, grip, prop, _view, behindHand) => {
  const scale = prop.scale ?? 1;
  const clay = receded(CLAY, behindHand ? FAR_LIMB_SHADE : 0);
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const at = (alongBore: number): Pt => ({
    x: grip.centre.x + along.x * alongBore * scale,
    y: grip.centre.y + along.y * alongBore * scale,
  });
  const potCentre = at(POT_CENTRE_ALONG);
  const mouth = at(NECK_MOUTH_ALONG);
  const lipEnd = at(NECK_MOUTH_ALONG + LIP_LENGTH);
  const corkTip = at(CORK_TIP_ALONG);
  const outline = CLAY_OUTLINE * scale;

  ctx.save();
  ctx.lineCap = 'butt';
  paintBand(ctx, lipEnd, corkTip, CORK_HALF_WIDTH * scale, outline, behindHand ? CORK_SHADE : CORK);
  paintBand(ctx, potCentre, mouth, NECK_HALF_WIDTH * scale, outline, NECK_CLAY);
  paintBand(ctx, mouth, lipEnd, LIP_HALF_WIDTH * scale, outline, NECK_CLAY);
  paintPot(ctx, potCentre, POT_RADIUS * scale, outline, clay, angle);
  ctx.restore();

  const wisp = wispOf(prop);
  if (wisp !== null) paintWisp(ctx, corkTip, scale, wisp);
};
