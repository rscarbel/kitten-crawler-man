/**
 * A self longbow: one stave of yew, honey sapwood on the belly, a leather
 * wrap round the riser where the fist closes, pale horn nocks at the tips and
 * a linen string.
 *
 * Painted in the grip's own frame: +X runs up the stave to the upper tip, +Y
 * toward the target — the side the bow's back faces. Braced, the limbs bow
 * back toward the archer and the string runs straight between the tips,
 * `BRACE_HEIGHT` off the riser. With `prop.tether` the string is drawn to that
 * point — the drawing fingers, wherever the choreography has put them — and
 * the limbs bend further the further it is drawn. `variant` `'nocked'` lays an
 * arrow from the string's nock point across the bow hand, its head past the
 * riser; at the release the row drops the variant and the tether in the same
 * frame, so the arrow is gone as the string snaps straight.
 */

import { addCapsule, shadeForm } from '../paint';
import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { PropPainter, PropReach } from '../props';
import { mix, type Pt } from '../../bipedArt';
import { squareAround } from './reach';

/** The variant that lays an arrow on the string. */
export const LONGBOW_NOCKED = 'nocked';

/** Riser to each tip along the stave, braced. A longbow stands nearly as tall as its archer. */
export const LONGBOW_LIMB_LENGTH = 0.8;
/** The leather wrap the fist closes round, either side of the grip. */
export const LONGBOW_RISER_HALF = 0.08;
/** How far the braced string stands off the riser, toward the archer. */
export const LONGBOW_BRACE_HEIGHT = 0.17;

/**
 * How much further back the tips come for every unit the string is drawn past
 * brace: a stave bends, it does not hinge, so the tips move far less than the
 * string.
 */
const LIMB_FLEX = 0.24;
/** The tips come in along the stave a little as they bend back: the stave keeps its length. */
const TIP_DRAW_IN = 0.18;
/**
 * Head-on or from behind the bow's bend runs into the picture, toward or away
 * from the camera, so only this share of it shows across the screen.
 */
const HEAD_ON_BEND_SHARE = 0.2;

/**
 * The stave's half-width at the riser and at the tips. A real stave is under
 * an inch across, but at the 32 px tile anything thinner than this falls
 * under a pixel and the bow vanishes into a string.
 */
const STAVE_HALF_AT_RISER = 0.032;
const STAVE_HALF_AT_TIP = 0.016;
const WRAP_HALF = 0.04;
const NOCK_RADIUS = 0.02;
/** A length too short to give a direction: a string drawn exactly onto the riser. */
const DEGENERATE_LENGTH = 1e-6;
/** Points sampled along each limb's curve. */
const LIMB_SAMPLES = 12;

/**
 * Yew sapwood, a warm honey brighter than anything the archer wears, so the stave
 * reads as a line against green and brown cloth at the tile.
 */
const YEW: Ramp = {
  deep: '#3b2410',
  shadow: '#5a3618',
  dark: '#7d4c22',
  mid: '#9c6430',
  base: '#bf8443',
  light: '#dba767',
  rim: '#f0c992',
};
const WRAP = '#3a2418';
const WRAP_SHADE = '#22140d';
const HORN = '#e6dcc4';
/** Linen, near white, so the string shows as a light line over the dark floor and the archer's clothes. */
const STRING = '#f2ead2';
const STRING_SHADE = '#8f866f';
const STRING_WIDTH = 0.016;
const STRING_SHADE_WIDTH = 0.026;

/**
 * Nock to tip of the arrow: longer than the full draw by enough that the head
 * stands a few pixels past the bow at the tile while she holds the aim.
 */
const ARROW_LENGTH = 0.78;
/** Head-on, how far the foreshortened arrow's head stands past the bow hand. */
const HEAD_ON_ARROW_PAST_REST = 0.07;
const HEAD_ON_POINT_RADIUS = 0.045;
/** Head-on the fletching at the nock is all of the arrow that shows by the face: drawn broader. */
const HEAD_ON_FLETCH_SCALE = 1.8;
const SHAFT = '#d7b37a';
const SHAFT_SHADE = '#7a5a34';
const SHAFT_WIDTH = 0.026;
const SHAFT_SHADE_WIDTH = 0.038;
/** The fletching: two grey goose feathers and the red cock feather, near the nock. */
const FLETCH = '#e9e6de';
const COCK_FEATHER = '#c23b28';
const FLETCH_FROM = 0.02;
const FLETCH_TO = 0.16;
const FLETCH_SPREAD = 0.028;
/** The feather stands out to its full spread a quarter of the way along, and tapers to this share at its tail. */
const FLETCH_FULL_AT = 0.25;
const FLETCH_TAIL_SHARE = 0.4;
const HEAD = '#c6cad2';
const HEAD_SHADE = '#5d626c';
const HEAD_LENGTH = 0.08;
const HEAD_HALF = 0.032;
/** The arrow rides on the fist, just above the riser's middle: the arrow shelf. */
const ARROW_REST_ALONG = 0.03;

/** The stave's centre line at `s` (−1 the lower tip, 1 the upper), bowed back by `bend` toward `side`. */
function staveAt(s: number, bend: number, side: number, drawIn: number): Pt {
  const along = s * LONGBOW_LIMB_LENGTH * (1 - drawIn);
  return { x: along, y: side * bend * s * s };
}

function staveHalfAt(s: number): number {
  const t = Math.abs(s);
  return STAVE_HALF_AT_RISER + (STAVE_HALF_AT_TIP - STAVE_HALF_AT_RISER) * t;
}

function traceStave(
  ctx: CanvasRenderingContext2D,
  bend: number,
  side: number,
  drawIn: number,
): void {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const steps = LIMB_SAMPLES * 2;
  for (let i = 0; i <= steps; i++) {
    const s = -1 + (2 * i) / steps;
    const centre = staveAt(s, bend, side, drawIn);
    const ahead = staveAt(Math.min(1, s + 1 / steps), bend, side, drawIn);
    const behind = staveAt(Math.max(-1, s - 1 / steps), bend, side, drawIn);
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const length = Math.hypot(dx, dy);
    const half = staveHalfAt(s);
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    left.push({ x: centre.x + nx, y: centre.y + ny });
    right.push({ x: centre.x - nx, y: centre.y - ny });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const point of left) ctx.lineTo(point.x, point.y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
}

function toFigure(local: Pt, centre: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: centre.x + local.x * cos - local.y * sin,
    y: centre.y + local.x * sin + local.y * cos,
  };
}

function toLocal(point: Pt, centre: Pt, angle: number): Pt {
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  points: readonly Pt[],
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

/** The arrow from `nock` along `toward`, in figure space. */
function paintArrow(
  ctx: CanvasRenderingContext2D,
  nock: Pt,
  toward: Pt,
  shade: number,
  arrowLength: number,
  fletchScale: number,
): void {
  const dx = toward.x - nock.x;
  const dy = toward.y - nock.y;
  const length = Math.hypot(dx, dy);
  if (length < DEGENERATE_LENGTH) return;
  const ux = dx / length;
  const uy = dy / length;
  const at = (along: number, across = 0): Pt => ({
    x: nock.x + ux * along - uy * across,
    y: nock.y + uy * along + ux * across,
  });
  const shaftEnd = at(arrowLength - HEAD_LENGTH);
  strokeLine(ctx, [nock, shaftEnd], mix(SHAFT_SHADE, '#000000', shade), SHAFT_SHADE_WIDTH);
  strokeLine(ctx, [nock, shaftEnd], mix(SHAFT, SHAFT_SHADE, shade), SHAFT_WIDTH);
  for (const [side, colour] of [
    [-1, FLETCH],
    [1, COCK_FEATHER],
  ] as const) {
    ctx.fillStyle = mix(colour, SHAFT_SHADE, shade);
    ctx.beginPath();
    const root = at(FLETCH_FROM);
    ctx.moveTo(root.x, root.y);
    const out = at(
      FLETCH_FROM + (FLETCH_TO - FLETCH_FROM) * FLETCH_FULL_AT,
      side * FLETCH_SPREAD * fletchScale,
    );
    ctx.lineTo(out.x, out.y);
    const outEnd = at(FLETCH_TO, side * FLETCH_SPREAD * FLETCH_TAIL_SHARE * fletchScale);
    ctx.lineTo(outEnd.x, outEnd.y);
    const end = at(FLETCH_TO);
    ctx.lineTo(end.x, end.y);
    ctx.closePath();
    ctx.fill();
  }
  const tip = at(arrowLength);
  const baseA = at(arrowLength - HEAD_LENGTH, HEAD_HALF);
  const baseB = at(arrowLength - HEAD_LENGTH, -HEAD_HALF);
  ctx.fillStyle = mix(HEAD, HEAD_SHADE, shade);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(baseA.x, baseA.y);
  ctx.lineTo(baseB.x, baseB.y);
  ctx.closePath();
  ctx.fill();
}

/** The farthest any of the bow's or its arrow's ink lies from the grip. */
const LONGBOW_REACH =
  Math.max(LONGBOW_LIMB_LENGTH + NOCK_RADIUS, ARROW_LENGTH) + LONGBOW_BRACE_HEIGHT;

export const longbowReach: PropReach = (grip, prop) =>
  squareAround(grip.centre, LONGBOW_REACH * (prop.scale ?? 1));

export const drawLongbow: PropPainter = (ctx, grip, prop, view, behindHand) => {
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const shade = behindHand ? FAR_LIMB_SHADE : 0;
  const wood = receded(YEW, shade);
  const tether = prop.tether;
  const local = tether === undefined ? null : toLocal(tether, grip.centre, angle);
  // The bow bends toward wherever the string is drawn; braced, toward the archer (−Y).
  const side = local === null || Math.abs(local.y) < DEGENERATE_LENGTH ? -1 : Math.sign(local.y);
  const drawnPast =
    local === null ? 0 : Math.max(0, Math.hypot(local.x, local.y) - LONGBOW_BRACE_HEIGHT);
  // Head-on a drawn bow bends into the picture, and so does an untethered
  // braced one; a braced bow whose string is placed beside it hangs with its
  // plane square to the camera and shows its whole curve.
  const squareToCamera = local !== null && drawnPast < DEGENERATE_LENGTH;
  const bendShare = view.profile || squareToCamera ? 1 : HEAD_ON_BEND_SHARE;
  const bend = (LONGBOW_BRACE_HEIGHT + drawnPast * LIMB_FLEX) * bendShare;
  const drawIn = drawnPast * LIMB_FLEX * TIP_DRAW_IN;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const upperTip = toFigure(staveAt(1, bend, side, drawIn), grip.centre, angle);
  const lowerTip = toFigure(staveAt(-1, bend, side, drawIn), grip.centre, angle);
  const nock = tether ?? toFigure({ x: 0, y: side * bend }, grip.centre, angle);
  const stringShade = mix(STRING_SHADE, '#000000', shade);
  const string = mix(STRING, STRING_SHADE, shade);
  strokeLine(ctx, [upperTip, nock, lowerTip], stringShade, STRING_SHADE_WIDTH);
  strokeLine(ctx, [upperTip, nock, lowerTip], string, STRING_WIDTH);

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(angle);
  shadeForm(
    ctx,
    () => traceStave(ctx, bend, side, drawIn),
    { from: { x: -LONGBOW_LIMB_LENGTH, y: 0 }, to: { x: LONGBOW_LIMB_LENGTH, y: 0 } },
    wood,
    { halfWidth: STAVE_HALF_AT_RISER, frameRotation: angle },
  );
  ctx.fillStyle = mix(WRAP, WRAP_SHADE, shade);
  ctx.beginPath();
  addCapsule(
    ctx,
    { x: -LONGBOW_RISER_HALF, y: 0 },
    { x: LONGBOW_RISER_HALF, y: 0 },
    WRAP_HALF,
    WRAP_HALF,
  );
  ctx.fill();
  ctx.fillStyle = mix(HORN, YEW.shadow, shade);
  for (const s of [-1, 1]) {
    const tip = staveAt(s, bend, side, drawIn);
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, NOCK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (prop.variant === LONGBOW_NOCKED && tether !== undefined) {
    const rest = toFigure({ x: ARROW_REST_ALONG, y: 0 }, grip.centre, angle);
    const restDistance = Math.hypot(rest.x - tether.x, rest.y - tether.y);
    // Head-on the arrow points into the picture: only the shaft between the
    // string and the bow hand shows, the head a stub just past the riser.
    const length = view.profile ? ARROW_LENGTH : restDistance + HEAD_ON_ARROW_PAST_REST;
    paintArrow(ctx, tether, rest, shade, length, view.profile ? 1 : HEAD_ON_FLETCH_SCALE);
    if (!view.profile) {
      // The head pointed at or away from the camera is a glint of steel on the bow hand.
      ctx.fillStyle = mix(HEAD, HEAD_SHADE, shade);
      ctx.beginPath();
      ctx.arc(rest.x, rest.y, HEAD_ON_POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
};
