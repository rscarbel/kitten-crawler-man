/**
 * Bespoke furniture for Plumbline Farm: a room built by a man who knows
 * exactly how a room ought to be built, holding three lives at once.
 *
 * The architect's: a tall drafting table under the window with sheets pinned
 * square, a T-square, set squares, compasses and a lamp, beside a plan chest
 * and a bin of rolled drawings he has never thrown away. The builder's: a tool
 * wall over a joiner's bench, every saw, plane and chisel hung in order of
 * size, and a panelled door for someone else's house waiting on trestles. The
 * farmer's he is trying to be: a scrubbed dairy wall under a window onto the
 * empty pasture, churns and a butter churn standing clean, a stool and pail,
 * feed sacks stacked for animals that are not there. Between them, the hearth
 * he dressed himself and his one good chair.
 *
 * The sheets on the drafting table and the rolls in the chest and bin are
 * drawn so they read as drawings and never resolve into anything legible:
 * faint ruled lines and blank title blocks, no text, no recognisable plan.
 * What those drawings are belongs to Wendell's own story, not to the room.
 */

import {
  footprintBox,
  withFootprintClip,
  forkRng,
  jitter,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
  type Rng,
} from '../../town/townArt';
import {
  getTownRamp,
  sampleRamp,
  mix,
  TOWN_INK,
  type Ramp,
  type RGB,
} from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;

// ── Colours no shared town ramp covers ─────────────────────────────────────

/** Drawing paper, warm and pale, and its shaded curl. */
const PAPER: RGB = [232, 222, 194];
const PAPER_SHADE: RGB = [192, 176, 140];
/** A draughtsman's faint blue-grey construction line — present, never legible. */
const DRAWING_LINE: RGB = [98, 116, 140];
/** Tapes tying the rolled drawings. */
const TAPE_RED: RGB = [150, 58, 48];
const TAPE_BLUE: RGB = [58, 84, 128];
/** Polished brass: lamp shade, candlesticks, pulls, the plumb bob. */
const BRASS: RGB = [190, 150, 70];
const BRASS_DARK: RGB = [120, 90, 40];
const BRASS_LIGHT: RGB = [240, 212, 140];
/** Tool steel, kept oiled and bright. */
const STEEL: RGB = [150, 158, 166];
const STEEL_DARK: RGB = [84, 90, 98];
const STEEL_LIGHT: RGB = [222, 228, 232];
/** Scoured dairy tin — brighter and cooler than any hardware ramp, because it is meant to read as clean. */
const TIN: RGB = [178, 186, 192];
const TIN_DARK: RGB = [112, 120, 128];
const TIN_LIGHT: RGB = [236, 242, 246];
/** Planed pine and scrubbed deal: the pale fresh wood of new joinery and a dairy bench. */
const PINE: RGB = [206, 176, 128];
const PINE_DARK: RGB = [150, 118, 76];
const PINE_LIGHT: RGB = [232, 210, 166];
const SCRUBBED_DEAL: RGB = [222, 206, 170];
/** Beech bench top and tool handles: harder and warmer than the pine. */
const BEECH: RGB = [184, 136, 88];
const BEECH_DARK: RGB = [120, 82, 48];
/** Rosewood stocks and a mallet head's end grain. */
const ROSEWOOD: RGB = [104, 54, 40];
/** A spirit level's vial. */
const LEVEL_VIAL: RGB = [166, 208, 120];
/** Translucent celluloid set squares. */
const SET_SQUARE_AMBER: RGB = [214, 168, 82];
const SET_SQUARE_CLEAR: RGB = [196, 214, 214];
/** Lamp and candle flame, and the fire. */
const FLAME_CORE: RGB = [255, 228, 150];
const FLAME_MID: RGB = [236, 132, 48];
const FLAME_DEEP: RGB = [150, 52, 24];
const EMBER_GLOW: RGB = [255, 170, 80];
const SOOT: RGB = [28, 22, 20];
/** Copper kettle on the crane. */
const COPPER: RGB = [172, 94, 58];
const COPPER_LIGHT: RGB = [226, 150, 104];
/** The view out of the windows: sky, the pasture's good grass, his fence. */
const SKY_HIGH: RGB = [150, 190, 222];
const SKY_LOW: RGB = [210, 226, 234];
const PASTURE: RGB = [110, 156, 74];
const PASTURE_FAR: RGB = [150, 184, 102];
const FENCE_RAIL: RGB = [226, 214, 186];
/** Hessian feed sacks and their stencil. */
const HESSIAN: RGB = [196, 170, 120];
const HESSIAN_DARK: RGB = [144, 118, 76];
const STENCIL: RGB = [96, 66, 44];
/** Bed linen and the grey-blue wool blanket, and the good chair's cushion. */
const LINEN: RGB = [236, 230, 214];
const LINEN_SHADE: RGB = [196, 188, 170];
const BLANKET: RGB = [84, 104, 124];
const BLANKET_LIGHT: RGB = [120, 142, 162];
const CUSHION: RGB = [150, 72, 54];
/** Split firewood: bark and the pale cut end. */
const LOG_BARK: RGB = [86, 62, 44];
const LOG_END: RGB = [214, 184, 132];

function timber(): Ramp {
  return getTownRamp('oc_timber');
}
/**
 * A warm pale freestone for the hearth. The town's own dressed-stone ramp is
 * cool and blue-grey, and a whole chimney breast of it reads as a grey slab
 * against timber walls; a builder choosing stone for his own fire would pick
 * the honey-coloured one.
 */
const HEARTH_FREESTONE: Ramp = {
  shadow: [96, 84, 70],
  mid: [170, 152, 124],
  light: [214, 198, 168],
  accent: [234, 222, 196],
};
function iron(): Ramp {
  return getTownRamp('iron_black');
}

// ── Small shared primitives ────────────────────────────────────────────────

function contactShadow(ctx: Ctx, frame: TownPropFrame, spread = 0.44): void {
  const box = footprintBox(frame);
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(
    ctx,
    box.centreX,
    box.bottom - radiusY * 0.4,
    box.width * spread,
    radiusY,
    0.32,
  );
}

/** A filled, inked rectangle — the joinery in this room is all square. */
function block(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  ts: number,
  ink = 1,
): void {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  if (ink > 0) inkOutline(ctx, ts * ink);
}

/** A lit top edge along a board, the one highlight that makes a flat rectangle read as a planed surface. */
function litEdge(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  thickness: number,
  color: RGB,
  alpha = 0.7,
): void {
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillRect(x, y, w, thickness);
}

function disc(ctx: Ctx, x: number, y: number, r: number, color: RGB): void {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

function glow(ctx: Ctx, x: number, y: number, radius: number, color: RGB, alpha: number): void {
  const bloom = ctx.createRadialGradient(x, y, 1, x, y, radius);
  bloom.addColorStop(0, rgba(color, alpha));
  bloom.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function flame(ctx: Ctx, x: number, baseY: number, h: number, w: number): void {
  ctx.fillStyle = rgb(FLAME_MID);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h);
  ctx.quadraticCurveTo(x + w, baseY - h * 0.35, x, baseY);
  ctx.quadraticCurveTo(x - w, baseY - h * 0.35, x, baseY - h);
  ctx.fill();
  ctx.fillStyle = rgb(FLAME_CORE);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h * 0.7);
  ctx.quadraticCurveTo(x + w * 0.5, baseY - h * 0.25, x, baseY);
  ctx.quadraticCurveTo(x - w * 0.5, baseY - h * 0.25, x, baseY - h * 0.7);
  ctx.fill();
}

/** A drawing rolled and seen end-on: a pale disc with the spiral's dark eye. */
function rollEnd(ctx: Ctx, x: number, y: number, r: number, ts: number, tape: RGB | null): void {
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * 0.5);
  ctx.strokeStyle = rgba(PAPER_SHADE, 0.9);
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.beginPath();
  ctx.arc(x + r * 0.08, y + r * 0.06, r * 0.5, Math.PI * 0.2, Math.PI * 1.7);
  ctx.stroke();
  disc(ctx, x + r * 0.1, y + r * 0.08, r * 0.18, PAPER_SHADE);
  if (tape !== null) {
    ctx.strokeStyle = rgb(tape);
    ctx.lineWidth = Math.max(1, r * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.98, Math.PI * 0.6, Math.PI * 0.95);
    ctx.stroke();
  }
}

/** A rolled drawing lying on its side, from `x0` to `x1`, with its spiral end towards `x1`. */
function rollSide(
  ctx: Ctx,
  x0: number,
  x1: number,
  cy: number,
  r: number,
  ts: number,
  tape: RGB | null,
): void {
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.rect(x0, cy - r, x1 - x0, r * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.5);
  ctx.fillStyle = rgba(PAPER_SHADE, 0.7);
  ctx.fillRect(x0, cy + r * 0.25, x1 - x0, r * 0.75);
  if (tape !== null) {
    ctx.fillStyle = rgb(tape);
    ctx.fillRect(x0 + (x1 - x0) * 0.38, cy - r, Math.max(1, r * 0.45), r * 2);
  }
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.ellipse(x1, cy, r * 0.42, r, 0, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * 0.45);
  disc(ctx, x1 + r * 0.05, cy, r * 0.2, PAPER_SHADE);
}

/** A rolled drawing standing on end, leaning by `lean` pixels at the top. */
function rollUpright(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  r: number,
  lean: number,
  ts: number,
  tape: RGB | null,
): void {
  const topX = x + lean;
  const topY = baseY - height;
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.moveTo(x - r, baseY);
  ctx.lineTo(topX - r, topY);
  ctx.lineTo(topX + r, topY);
  ctx.lineTo(x + r, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.45);
  ctx.fillStyle = rgba(PAPER_SHADE, 0.75);
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2, baseY);
  ctx.lineTo(topX + r * 0.2, topY);
  ctx.lineTo(topX + r, topY);
  ctx.lineTo(x + r, baseY);
  ctx.closePath();
  ctx.fill();
  if (tape !== null) {
    const bandT = 0.45;
    const bx = x + lean * bandT;
    const by = baseY - height * bandT;
    ctx.fillStyle = rgb(tape);
    ctx.fillRect(bx - r, by, r * 2, Math.max(1, ts * 0.025));
  }
  ctx.fillStyle = rgb(mix(PAPER, [255, 255, 255], 0.25));
  ctx.beginPath();
  ctx.ellipse(topX, topY, r, r * 0.45, 0, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * 0.4);
  disc(ctx, topX + r * 0.1, topY, r * 0.22, PAPER_SHADE);
}

/**
 * Dressed ashlar in dead-level courses, every block squared and every joint
 * struck — the shared coursed-stone painter sizes its courses to the wall's
 * height, and a chimney breast wants many shallow courses, not two tall ones.
 */
function paintAshlar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  courseH: number,
  blockW: number,
  ramp: Ramp,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.2));
  ctx.fillRect(x, y, w, h);
  const joint = Math.max(1, courseH * 0.08);
  const courses = Math.ceil(h / courseH);
  for (let c = 0; c < courses; c++) {
    const cy = y + c * courseH;
    let bx = x - (c % 2 === 0 ? 0 : blockW / 2);
    while (bx < x + w) {
      const tone = 0.58 + jitter(rng, 0.08);
      ctx.fillStyle = rgb(sampleRamp(ramp, tone));
      ctx.fillRect(bx + joint / 2, cy + joint / 2, blockW - joint, courseH - joint);
      ctx.fillStyle = rgba(sampleRamp(ramp, 1), 0.35);
      ctx.fillRect(bx + joint / 2, cy + joint / 2, blockW - joint, joint);
      ctx.fillStyle = rgba(sampleRamp(ramp, 0), 0.25);
      ctx.fillRect(bx + joint / 2, cy + courseH - joint * 1.5, blockW - joint, joint);
      bx += blockW;
    }
  }
  ctx.restore();
}

/** A window cut into the wall face: a squared oak casing, a sill, four panes, and what is outside. */
function paintWindow(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  withFence: boolean,
): void {
  const casing = ts * 0.07;
  block(
    ctx,
    x - casing,
    y - casing,
    w + casing * 2,
    h + casing * 2,
    sampleRamp(timber(), 0.62),
    ts,
  );
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, rgb(SKY_HIGH));
  sky.addColorStop(0.55, rgb(SKY_LOW));
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  const horizon = y + h * 0.56;
  ctx.fillStyle = rgb(PASTURE_FAR);
  ctx.fillRect(x, horizon, w, h * 0.12);
  ctx.fillStyle = rgb(PASTURE);
  ctx.fillRect(x, horizon + h * 0.1, w, h - (horizon - y) - h * 0.1);
  if (withFence) {
    ctx.fillStyle = rgb(FENCE_RAIL);
    const railH = Math.max(1, h * 0.045);
    ctx.fillRect(x, horizon + h * 0.14, w, railH);
    ctx.fillRect(x, horizon + h * 0.26, w, railH);
    const posts = 3;
    for (let i = 0; i < posts; i++) {
      const px = x + (w * (i + 0.5)) / posts;
      ctx.fillRect(px - railH * 0.8, horizon + h * 0.08, railH * 1.6, h * 0.26);
    }
  }
  // Daylight on the glass: one pale diagonal shine per pane pair.
  ctx.fillStyle = rgba([255, 255, 255], 0.22);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.08, y + h);
  ctx.lineTo(x + w * 0.3, y);
  ctx.lineTo(x + w * 0.4, y);
  ctx.lineTo(x + w * 0.18, y + h);
  ctx.closePath();
  ctx.fill();
  const bar = Math.max(1, ts * 0.035);
  ctx.fillStyle = rgb(sampleRamp(timber(), 0.72));
  ctx.fillRect(x + w / 2 - bar / 2, y, bar, h);
  ctx.fillRect(x, y + h / 2 - bar / 2, w, bar);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts * 0.8);
  const sillOver = ts * 0.1;
  block(
    ctx,
    x - sillOver,
    y + h + casing * 0.4,
    w + sillOver * 2,
    ts * 0.07,
    sampleRamp(timber(), 0.72),
    ts,
  );
  litEdge(
    ctx,
    x - sillOver,
    y + h + casing * 0.4,
    w + sillOver * 2,
    ts * 0.018,
    sampleRamp(timber(), 1),
  );
}

/** A shaft of daylight falling from a window onto whatever stands under it. */
function daylight(ctx: Ctx, x: number, y: number, w: number, fall: number, drift: number): void {
  const shaft = ctx.createLinearGradient(0, y, 0, y + fall);
  shaft.addColorStop(0, rgba([255, 244, 214], 0.2));
  shaft.addColorStop(1, rgba([255, 244, 214], 0));
  ctx.fillStyle = shaft;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w + drift, y + fall);
  ctx.lineTo(x + drift, y + fall);
  ctx.closePath();
  ctx.fill();
}

/** A scoured tin milk churn: a tapered body, a banded shoulder, a neck and a seated lid. */
function paintChurn(ctx: Ctx, cx: number, bottom: number, w: number, h: number, ts: number): void {
  const shoulderY = bottom - h * 0.66;
  const neckY = bottom - h * 0.84;
  const neckW = w * 0.46;
  ctx.fillStyle = rgb(TIN);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, bottom);
  ctx.lineTo(cx - w * 0.46, shoulderY);
  ctx.quadraticCurveTo(cx - w * 0.44, neckY + h * 0.04, cx - neckW / 2, neckY);
  ctx.lineTo(cx - neckW / 2, bottom - h * 0.94);
  ctx.lineTo(cx + neckW / 2, bottom - h * 0.94);
  ctx.lineTo(cx + neckW / 2, neckY);
  ctx.quadraticCurveTo(cx + w * 0.44, neckY + h * 0.04, cx + w * 0.46, shoulderY);
  ctx.lineTo(cx + w * 0.5, bottom);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  // The unlit east half, then a hard bright shine down the lit west side.
  ctx.fillStyle = rgba(TIN_DARK, 0.55);
  ctx.fillRect(cx + w * 0.12, shoulderY, w * 0.34, bottom - shoulderY - 1);
  ctx.fillStyle = rgba(TIN_LIGHT, 0.95);
  ctx.fillRect(
    cx - w * 0.32,
    shoulderY + h * 0.06,
    Math.max(1, w * 0.1),
    bottom - shoulderY - h * 0.12,
  );
  // Rolled bands at the foot and the shoulder.
  ctx.fillStyle = rgb(TIN_DARK);
  ctx.fillRect(cx - w * 0.5, bottom - h * 0.07, w, Math.max(1, h * 0.04));
  ctx.fillRect(cx - w * 0.47, shoulderY, w * 0.94, Math.max(1, h * 0.04));
  // The lid: a domed cap with a knob.
  ctx.fillStyle = rgb(TIN_LIGHT);
  ctx.beginPath();
  ctx.ellipse(cx, bottom - h * 0.94, neckW * 0.62, h * 0.06, 0, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * 0.55);
  disc(ctx, cx, bottom - h * 0.99, Math.max(1, w * 0.07), TIN_DARK);
  // Two side handles.
  ctx.strokeStyle = rgb(TIN_DARK);
  ctx.lineWidth = Math.max(1, ts * 0.018);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * w * 0.44, shoulderY - h * 0.02, w * 0.1, 0, TWO_PI);
    ctx.stroke();
  }
}

/** A staved wooden pail with two iron hoops, upright or hung upside down by its bail. */
function paintPail(
  ctx: Ctx,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  ts: number,
  upturned: boolean,
): void {
  const wide = w * 0.5;
  const narrow = w * 0.4;
  const topHalf = upturned ? narrow : wide;
  const bottomHalf = upturned ? wide : narrow;
  const top = bottom - h;
  ctx.fillStyle = rgb(PINE);
  ctx.beginPath();
  ctx.moveTo(cx - topHalf, top);
  ctx.lineTo(cx + topHalf, top);
  ctx.lineTo(cx + bottomHalf, bottom);
  ctx.lineTo(cx - bottomHalf, bottom);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(PINE_DARK, 0.6);
  ctx.lineWidth = 1;
  const staves = 4;
  for (let i = 1; i < staves; i++) {
    const t = i / staves - 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + t * topHalf * 2, top);
    ctx.lineTo(cx + t * bottomHalf * 2, bottom);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(PINE_DARK, 0.45);
  ctx.fillRect(cx + w * 0.12, top, w * 0.4, h);
  ctx.fillStyle = rgb(sampleRamp(iron(), 0.6));
  const hoop = Math.max(1, h * 0.09);
  ctx.fillRect(cx - wide, top + h * 0.16, wide * 2, hoop);
  ctx.fillRect(cx - wide, bottom - h * 0.26, wide * 2, hoop);
  ctx.restore();
  if (!upturned) {
    ctx.fillStyle = rgb(PINE_DARK);
    ctx.beginPath();
    ctx.ellipse(cx, top, topHalf, h * 0.12, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
  }
  ctx.strokeStyle = rgb(sampleRamp(iron(), 0.55));
  ctx.lineWidth = Math.max(1, ts * 0.016);
  ctx.beginPath();
  if (upturned) ctx.arc(cx, bottom, bottomHalf * 0.9, 0, Math.PI);
  else ctx.arc(cx, top, topHalf * 0.95, Math.PI, TWO_PI);
  ctx.stroke();
}

/** A filled hessian sack lying on its side, stencilled, its tied neck to the east. */
function paintLyingSack(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  ctx.fillStyle = rgb(mix(HESSIAN, HESSIAN_DARK, 0.15 + jitter(rng, 0.08)));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h * 0.42);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgba(HESSIAN_DARK, 0.45);
  ctx.beginPath();
  ctx.roundRect(x + w * 0.04, y + h * 0.55, w * 0.9, h * 0.42, h * 0.2);
  ctx.fill();
  ctx.fillStyle = rgba([255, 244, 214], 0.28);
  ctx.fillRect(x + w * 0.12, y + h * 0.14, w * 0.6, Math.max(1, h * 0.1));
  // A stencilled diamond: the merchant's mark, which is all the lettering this room carries.
  const sx = x + w * 0.42;
  const sy = y + h * 0.5;
  const sr = h * 0.2;
  ctx.strokeStyle = rgba(STENCIL, 0.75);
  ctx.lineWidth = Math.max(1, ts * 0.018);
  ctx.beginPath();
  ctx.moveTo(sx, sy - sr);
  ctx.lineTo(sx + sr * 1.3, sy);
  ctx.lineTo(sx, sy + sr);
  ctx.lineTo(sx - sr * 1.3, sy);
  ctx.closePath();
  ctx.stroke();
  // Tied neck.
  ctx.fillStyle = rgb(HESSIAN_DARK);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.96, y + h * 0.3);
  ctx.lineTo(x + w * 1.0, y + h * 0.18);
  ctx.lineTo(x + w * 1.0, y + h * 0.82);
  ctx.lineTo(x + w * 0.96, y + h * 0.7);
  ctx.closePath();
  ctx.fill();
}

// ── The architect ──────────────────────────────────────────────────────────

/**
 * The drafting station under the window: a tall drafting table with its board
 * tilted to the light, two sheets pinned dead square, a T-square across them,
 * a pair of set squares, compasses, and a brass lamp clamped to the board's
 * edge; beside it a narrow instrument cabinet with pencils in a jar and two
 * drawings rolled on top. Three tiles wide, rising up the wall into the
 * window's daylight.
 */
export function paintDraftingStation(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);

    const windowW = ts * 1.2;
    const windowH = ts * 0.62;
    const windowX = box.left + ts * 0.6;
    const windowY = box.bottom - ts * 1.9;
    paintWindow(ctx, windowX, windowY, windowW, windowH, ts, false);
    daylight(ctx, windowX, windowY + windowH, windowW, ts * 1.0, ts * 0.12);

    // Trestle legs, then the tilted board they carry.
    const boardLeft = box.left + ts * 0.1;
    const boardRight = box.left + ts * 2.2;
    const boardBack = box.bottom - ts * 1.42;
    const boardFront = box.bottom - ts * 0.6;
    const legColor = sampleRamp(wood, 0.4);
    const legW = ts * 0.08;
    for (const lx of [boardLeft + ts * 0.22, boardRight - ts * 0.3]) {
      block(
        ctx,
        lx,
        boardFront - ts * 0.08,
        legW,
        box.bottom - boardFront + ts * 0.02 - ts * 0.04,
        legColor,
        ts,
        0.7,
      );
      block(
        ctx,
        lx - ts * 0.06,
        box.bottom - ts * 0.08,
        legW + ts * 0.12,
        ts * 0.05,
        sampleRamp(wood, 0.3),
        ts,
        0.6,
      );
    }
    block(
      ctx,
      boardLeft + ts * 0.22,
      box.bottom - ts * 0.3,
      boardRight - boardLeft - ts * 0.44,
      ts * 0.05,
      sampleRamp(wood, 0.45),
      ts,
      0.6,
    );
    // Rolled drawings stored on the stretcher.
    rollSide(
      ctx,
      boardLeft + ts * 0.42,
      boardLeft + ts * 1.25,
      box.bottom - ts * 0.37,
      ts * 0.06,
      ts,
      TAPE_RED,
    );
    rollSide(
      ctx,
      boardLeft + ts * 0.55,
      boardLeft + ts * 1.5,
      box.bottom - ts * 0.45,
      ts * 0.055,
      ts,
      null,
    );

    // The board: a thick edge under a pale lime surface.
    block(
      ctx,
      boardLeft,
      boardFront - ts * 0.02,
      boardRight - boardLeft,
      ts * 0.1,
      sampleRamp(wood, 0.52),
      ts,
    );
    ctx.fillStyle = rgb(PINE_LIGHT);
    ctx.beginPath();
    ctx.rect(boardLeft, boardBack, boardRight - boardLeft, boardFront - boardBack);
    ctx.fill();
    inkOutline(ctx, ts);
    // Pinned sheets, squared to the board's edges.
    const sheetA = {
      x: boardLeft + ts * 0.12,
      y: boardBack + ts * 0.08,
      w: ts * 1.3,
      h: ts * 0.62,
    };
    const sheetB = {
      x: boardLeft + ts * 1.28,
      y: boardBack + ts * 0.16,
      w: ts * 0.66,
      h: ts * 0.5,
    };
    for (const sheet of [sheetA, sheetB]) {
      block(ctx, sheet.x, sheet.y, sheet.w, sheet.h, PAPER, ts, 0.5);
      ctx.fillStyle = rgba(PAPER_SHADE, 0.35);
      ctx.fillRect(sheet.x + sheet.w * 0.6, sheet.y, sheet.w * 0.4, sheet.h);
      // Faint construction lines and a blank title block: drawings, never a drawing of anything.
      ctx.strokeStyle = rgba(DRAWING_LINE, 0.4);
      ctx.lineWidth = 1;
      const lines = 4;
      for (let i = 1; i <= lines; i++) {
        const ly = sheet.y + (sheet.h * i) / (lines + 1) + jitter(rng, 1);
        ctx.beginPath();
        ctx.moveTo(sheet.x + sheet.w * 0.08, ly);
        ctx.lineTo(sheet.x + sheet.w * (0.5 + jitter(rng, 0.2)), ly);
        ctx.stroke();
      }
      ctx.strokeRect(
        sheet.x + sheet.w * 0.62,
        sheet.y + sheet.h * 0.62,
        sheet.w * 0.3,
        sheet.h * 0.28,
      );
      ctx.strokeRect(
        sheet.x + sheet.w * 0.06,
        sheet.y + sheet.h * 0.08,
        sheet.w * 0.88,
        sheet.h * 0.84,
      );
      for (const [px, py] of [
        [sheet.x, sheet.y],
        [sheet.x + sheet.w, sheet.y],
        [sheet.x, sheet.y + sheet.h],
        [sheet.x + sheet.w, sheet.y + sheet.h],
      ]) {
        disc(ctx, px, py, Math.max(1, ts * 0.022), BRASS);
      }
    }
    // T-square: the head against the board's left edge, the blade across the sheets.
    const tHeadX = boardLeft - ts * 0.04;
    const tBladeY = boardBack + ts * 0.5;
    block(ctx, tHeadX, tBladeY - ts * 0.18, ts * 0.08, ts * 0.36, ROSEWOOD, ts, 0.6);
    block(ctx, tHeadX + ts * 0.08, tBladeY - ts * 0.025, ts * 1.55, ts * 0.05, BEECH, ts, 0.5);
    litEdge(ctx, tHeadX + ts * 0.08, tBladeY - ts * 0.025, ts * 1.55, 1, PINE_LIGHT, 0.9);
    // Set squares: a 45 in amber, a 30/60 in clear, each with its hollow centre.
    const paintSetSquare = (x: number, y: number, legA: number, legB: number, color: RGB): void => {
      ctx.fillStyle = rgba(color, 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + legA, y);
      ctx.lineTo(x, y - legB);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.45);
      ctx.fillStyle = rgba(PAPER, 0.8);
      ctx.beginPath();
      ctx.moveTo(x + legA * 0.2, y - legB * 0.14);
      ctx.lineTo(x + legA * 0.52, y - legB * 0.14);
      ctx.lineTo(x + legA * 0.2, y - legB * 0.46);
      ctx.closePath();
      ctx.fill();
    };
    paintSetSquare(
      boardLeft + ts * 0.95,
      boardFront - ts * 0.1,
      ts * 0.42,
      ts * 0.42,
      SET_SQUARE_AMBER,
    );
    paintSetSquare(
      boardLeft + ts * 1.42,
      boardFront - ts * 0.06,
      ts * 0.5,
      ts * 0.3,
      SET_SQUARE_CLEAR,
    );
    // Compasses, open, laid on the smaller sheet.
    ctx.strokeStyle = rgb(STEEL_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    const compassX = sheetB.x + sheetB.w * 0.55;
    const compassY = sheetB.y + sheetB.h * 0.2;
    ctx.beginPath();
    ctx.moveTo(compassX - ts * 0.1, compassY + ts * 0.26);
    ctx.lineTo(compassX, compassY);
    ctx.lineTo(compassX + ts * 0.12, compassY + ts * 0.25);
    ctx.stroke();
    disc(ctx, compassX, compassY, Math.max(1, ts * 0.025), BRASS_LIGHT);
    // Pencil ledge along the front edge, with two pencils.
    block(
      ctx,
      boardLeft + ts * 0.1,
      boardFront - ts * 0.04,
      boardRight - boardLeft - ts * 0.2,
      ts * 0.04,
      sampleRamp(wood, 0.7),
      ts,
      0.4,
    );
    block(
      ctx,
      boardLeft + ts * 0.3,
      boardFront - ts * 0.06,
      ts * 0.3,
      ts * 0.025,
      [196, 150, 60],
      ts,
      0,
    );
    block(
      ctx,
      boardLeft + ts * 0.7,
      boardFront - ts * 0.06,
      ts * 0.26,
      ts * 0.025,
      [70, 96, 70],
      ts,
      0,
    );

    // The lamp: clamped to the board's right edge, its arm over the sheets.
    const clampX = boardRight - ts * 0.05;
    const clampY = boardBack + ts * 0.08;
    const elbowX = clampX + ts * 0.06;
    const elbowY = clampY - ts * 0.5;
    const shadeX = clampX - ts * 0.42;
    const shadeY = clampY - ts * 0.38;
    ctx.strokeStyle = rgb(BRASS_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(clampX, clampY);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(shadeX, shadeY);
    ctx.stroke();
    ctx.lineCap = 'butt';
    disc(ctx, elbowX, elbowY, ts * 0.028, BRASS);
    block(ctx, clampX - ts * 0.04, clampY - ts * 0.02, ts * 0.1, ts * 0.08, BRASS_DARK, ts, 0.5);
    glow(ctx, shadeX - ts * 0.04, shadeY + ts * 0.34, ts * 0.55, EMBER_GLOW, 0.22);
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.moveTo(shadeX - ts * 0.04, shadeY - ts * 0.06);
    ctx.lineTo(shadeX + ts * 0.06, shadeY - ts * 0.02);
    ctx.lineTo(shadeX + ts * 0.02, shadeY + ts * 0.14);
    ctx.lineTo(shadeX - ts * 0.2, shadeY + ts * 0.06);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgb(BRASS_LIGHT);
    ctx.fillRect(shadeX - ts * 0.02, shadeY - ts * 0.04, ts * 0.04, ts * 0.08);
    disc(ctx, shadeX - ts * 0.08, shadeY + ts * 0.11, ts * 0.035, FLAME_CORE);

    // The instrument cabinet at the east end: four drawers under a worktop.
    const cabLeft = box.left + ts * 2.32;
    const cabRight = box.right - ts * 0.08;
    const cabTop = box.bottom - ts * 0.92;
    const cabBottom = box.bottom - ts * 0.04;
    block(ctx, cabLeft, cabTop, cabRight - cabLeft, cabBottom - cabTop, sampleRamp(wood, 0.5), ts);
    const drawers = 4;
    const drawerH = (cabBottom - cabTop - ts * 0.1) / drawers;
    for (let i = 0; i < drawers; i++) {
      const dy = cabTop + ts * 0.08 + drawerH * i;
      block(
        ctx,
        cabLeft + ts * 0.05,
        dy,
        cabRight - cabLeft - ts * 0.1,
        drawerH - ts * 0.03,
        sampleRamp(wood, 0.6 - i * 0.03),
        ts,
        0.5,
      );
      disc(ctx, (cabLeft + cabRight) / 2, dy + drawerH * 0.45, Math.max(1, ts * 0.028), BRASS);
    }
    block(
      ctx,
      cabLeft - ts * 0.03,
      cabTop - ts * 0.05,
      cabRight - cabLeft + ts * 0.06,
      ts * 0.07,
      sampleRamp(wood, 0.7),
      ts,
    );
    litEdge(
      ctx,
      cabLeft - ts * 0.03,
      cabTop - ts * 0.05,
      cabRight - cabLeft + ts * 0.06,
      ts * 0.018,
      sampleRamp(wood, 1),
    );
    // On top: a jar of pencils, a bottle of ink, two drawings rolled and tied.
    const jarX = cabLeft + ts * 0.14;
    block(ctx, jarX - ts * 0.07, cabTop - ts * 0.2, ts * 0.14, ts * 0.15, [120, 150, 140], ts, 0.5);
    const pencilColors: readonly RGB[] = [
      [196, 150, 60],
      [70, 96, 70],
      [150, 58, 48],
    ];
    pencilColors.forEach((color, i) => {
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = Math.max(1, ts * 0.022);
      ctx.beginPath();
      ctx.moveTo(jarX - ts * 0.03 + i * ts * 0.03, cabTop - ts * 0.18);
      ctx.lineTo(jarX - ts * 0.07 + i * ts * 0.06, cabTop - ts * 0.34);
      ctx.stroke();
    });
    block(ctx, cabLeft + ts * 0.3, cabTop - ts * 0.13, ts * 0.08, ts * 0.08, SOOT, ts, 0.4);
    rollSide(
      ctx,
      cabLeft + ts * 0.02,
      cabRight - ts * 0.08,
      cabTop - ts * 0.3,
      ts * 0.05,
      ts,
      TAPE_BLUE,
    );
  });
}

/**
 * The plan chest: five wide shallow drawers with brass cups and blank card
 * frames, carrying a pigeonhole rack where every hole is stuffed with rolled
 * drawings, a few tied, and more laid across the top because the rack ran out
 * of holes. A man who keeps every plan he is given.
 */
export function paintPlanChest(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const width = right - left;
    const bottom = box.bottom - ts * 0.04;
    const chestTop = bottom - ts * 0.62;
    const rackTop = chestTop - ts * 0.94;

    // Pigeonhole rack: a dark carcass, then a grid of holes full of rolls.
    block(
      ctx,
      left + ts * 0.04,
      rackTop,
      width - ts * 0.08,
      chestTop - rackTop,
      sampleRamp(wood, 0.45),
      ts,
    );
    const cols = 5;
    const rows = 3;
    const cellW = (width - ts * 0.16) / cols;
    const cellH = (chestTop - rackTop - ts * 0.1) / rows;
    const tapes: readonly (RGB | null)[] = [TAPE_RED, null, null, TAPE_BLUE, null, null, null];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = left + ts * 0.08 + cellW * c;
        const cy = rackTop + ts * 0.06 + cellH * r;
        block(ctx, cx, cy, cellW - ts * 0.03, cellH - ts * 0.03, sampleRamp(wood, 0.12), ts, 0.4);
        const rolls = 3 + ((r + c) % 2);
        const rr = Math.min(cellW, cellH) * 0.19;
        for (let i = 0; i < rolls; i++) {
          const across = rolls === 3 ? [0.28, 0.66, 0.47][i] : [0.26, 0.64, 0.3, 0.7][i];
          const up = rolls === 3 ? [0.66, 0.66, 0.34][i] : [0.68, 0.66, 0.32, 0.34][i];
          const tape = tapes[(r * cols + c + i) % tapes.length];
          rollEnd(ctx, cx + cellW * across + jitter(rng, rr * 0.1), cy + cellH * up, rr, ts, tape);
        }
      }
    }
    // The cap, and the rolls laid across it because the holes ran out.
    block(
      ctx,
      left - ts * 0.02,
      rackTop - ts * 0.06,
      width + ts * 0.04,
      ts * 0.08,
      sampleRamp(wood, 0.66),
      ts,
    );
    litEdge(
      ctx,
      left - ts * 0.02,
      rackTop - ts * 0.06,
      width + ts * 0.04,
      ts * 0.018,
      sampleRamp(wood, 1),
    );
    rollSide(
      ctx,
      left + ts * 0.1,
      left + width * 0.72,
      rackTop - ts * 0.12,
      ts * 0.06,
      ts,
      TAPE_RED,
    );
    rollSide(ctx, left + width * 0.3, right - ts * 0.08, rackTop - ts * 0.23, ts * 0.055, ts, null);

    // The chest: five shallow drawers, each with a brass cup and a card frame.
    block(ctx, left, chestTop, width, bottom - chestTop, sampleRamp(wood, 0.48), ts);
    block(
      ctx,
      left - ts * 0.03,
      chestTop - ts * 0.03,
      width + ts * 0.06,
      ts * 0.06,
      sampleRamp(wood, 0.7),
      ts,
    );
    const drawers = 5;
    const drawerH = (bottom - chestTop - ts * 0.08) / drawers;
    for (let i = 0; i < drawers; i++) {
      const dy = chestTop + ts * 0.05 + drawerH * i;
      block(
        ctx,
        left + ts * 0.05,
        dy,
        width - ts * 0.1,
        drawerH - ts * 0.02,
        sampleRamp(wood, 0.58 - i * 0.02),
        ts,
        0.4,
      );
      for (const at of [0.28, 0.72]) {
        const px = left + width * at;
        ctx.fillStyle = rgb(BRASS);
        ctx.beginPath();
        ctx.ellipse(px, dy + drawerH * 0.52, ts * 0.06, drawerH * 0.22, 0, 0, Math.PI);
        ctx.fill();
        block(ctx, px - ts * 0.05, dy + drawerH * 0.14, ts * 0.1, drawerH * 0.28, PAPER, ts, 0.3);
      }
    }
  });
}

/**
 * A squared oak bin with dovetailed corners, standing full of rolled drawings
 * on end — the overflow of the plan chest beside it.
 */
export function paintRollBin(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.34);
    const binW = ts * 0.64;
    const binLeft = box.centreX - binW / 2;
    const binBottom = box.bottom - ts * 0.06;
    const binTop = binBottom - ts * 0.5;
    // The rolls first, so the bin's front wall stands in front of their feet.
    const rolls = 7;
    const tapes: readonly (RGB | null)[] = [null, TAPE_RED, null, null, TAPE_BLUE, null, TAPE_RED];
    for (let i = 0; i < rolls; i++) {
      const t = (i + 0.5) / rolls;
      const x = binLeft + ts * 0.06 + (binW - ts * 0.12) * t;
      const height = ts * (0.82 + ((i * 7) % 5) * 0.07 + jitter(rng, 0.03));
      const lean = (t - 0.5) * ts * 0.26;
      rollUpright(ctx, x, binTop + ts * 0.1, height - ts * 0.5, ts * 0.045, lean, ts, tapes[i]);
    }
    block(ctx, binLeft, binTop, binW, binBottom - binTop, sampleRamp(wood, 0.5), ts);
    paintPlankBoard(ctx, binLeft, binTop, binW, binBottom - binTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: (binBottom - binTop) / 3,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(binLeft, binTop, binW, binBottom - binTop);
    inkOutline(ctx, ts);
    // Dovetails at both corners: the joint a carpenter shows off.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.75));
    const tails = 3;
    const tailH = (binBottom - binTop) / tails;
    for (let i = 0; i < tails; i++) {
      for (const [edge, dir] of [
        [binLeft, 1],
        [binLeft + binW, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(edge, binTop + tailH * i + tailH * 0.2);
        ctx.lineTo(edge + dir * ts * 0.08, binTop + tailH * i + tailH * 0.1);
        ctx.lineTo(edge + dir * ts * 0.08, binTop + tailH * i + tailH * 0.9);
        ctx.lineTo(edge, binTop + tailH * i + tailH * 0.8);
        ctx.closePath();
        ctx.fill();
      }
    }
    litEdge(ctx, binLeft, binTop, binW, ts * 0.02, sampleRamp(wood, 1));
  });
}

// ── The builder ────────────────────────────────────────────────────────────

/**
 * The tool wall over the joiner's bench. A planed pine board with an oak
 * frame carries every tool in order: three saws by size across the top; a
 * rack of six chisels graded narrow to wide, the mallet, try square, framing
 * square, dividers, and a plumb bob hanging dead still on its line; the spirit
 * level on its own two pegs; a shelf of planes. Beneath, a thick beech bench
 * with its vice, a plane laid on its side the way a joiner leaves one, and
 * offcuts sorted by length on the shelf underneath.
 */
export function paintToolWall(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const width = right - left;

    // The board.
    const boardTop = box.bottom - ts * 2.02;
    const boardBottom = box.bottom - ts * 0.9;
    paintPlankBoard(ctx, left, boardTop, width, boardBottom - boardTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.28,
      ramp: { shadow: PINE_DARK, mid: PINE, light: PINE_LIGHT, accent: PINE_LIGHT },
    });
    ctx.beginPath();
    ctx.rect(left, boardTop, width, boardBottom - boardTop);
    inkOutline(ctx, ts);
    const frameW = ts * 0.06;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.fillRect(left, boardTop, width, frameW);
    ctx.fillRect(left, boardTop, frameW, boardBottom - boardTop);
    ctx.fillRect(right - frameW, boardTop, frameW, boardBottom - boardTop);

    const hangShadow = (draw: () => void): void => {
      ctx.save();
      ctx.translate(ts * 0.03, ts * 0.03);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = rgb(PINE_DARK);
      ctx.strokeStyle = rgb(PINE_DARK);
      draw();
      ctx.restore();
    };
    const peg = (x: number, y: number): void =>
      disc(ctx, x, y, Math.max(1, ts * 0.025), sampleRamp(wood, 0.3));

    // Top row: panel saw, tenon saw, bow saw — hung by their handles, teeth down.
    const sawTop = boardTop + ts * 0.12;
    const paintHandSaw = (x: number, bladeW: number, bladeH: number, backed: boolean): void => {
      const bladePath = (): void => {
        ctx.beginPath();
        ctx.moveTo(x, sawTop + ts * 0.08);
        ctx.lineTo(x + bladeW, sawTop + ts * 0.08);
        ctx.lineTo(x + bladeW, sawTop + ts * 0.08 + (backed ? bladeH : bladeH * 0.55));
        ctx.lineTo(x, sawTop + ts * 0.08 + bladeH);
        ctx.closePath();
      };
      hangShadow(() => {
        bladePath();
        ctx.fill();
      });
      ctx.fillStyle = rgb(STEEL);
      bladePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.fillStyle = rgba(STEEL_LIGHT, 0.7);
      ctx.fillRect(x + ts * 0.03, sawTop + ts * 0.1, bladeW * 0.8, Math.max(1, ts * 0.018));
      // Teeth: a fine dark line along the cutting edge.
      ctx.strokeStyle = rgb(STEEL_DARK);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, sawTop + ts * 0.08 + bladeH - 1);
      ctx.lineTo(x + bladeW, sawTop + ts * 0.08 + (backed ? bladeH : bladeH * 0.55) - 1);
      ctx.stroke();
      if (backed) block(ctx, x, sawTop + ts * 0.06, bladeW, ts * 0.05, BRASS, ts, 0.4);
      // The open handle, pegged.
      ctx.fillStyle = rgb(BEECH);
      ctx.beginPath();
      ctx.roundRect(x - ts * 0.18, sawTop, ts * 0.2, ts * 0.24, ts * 0.05);
      ctx.fill();
      inkOutline(ctx, ts * 0.55);
      ctx.fillStyle = rgb(PINE_DARK);
      ctx.beginPath();
      ctx.ellipse(x - ts * 0.08, sawTop + ts * 0.12, ts * 0.04, ts * 0.06, 0, 0, TWO_PI);
      ctx.fill();
      peg(x - ts * 0.08, sawTop + ts * 0.02);
    };
    paintHandSaw(left + ts * 0.3, ts * 0.7, ts * 0.26, false);
    paintHandSaw(left + ts * 1.26, ts * 0.46, ts * 0.18, true);
    // Bow saw: two cheeks, a stretcher, a thin blade below and the twisted cord above.
    const bowLeft = left + ts * 1.95;
    const bowRight = left + ts * 2.72;
    ctx.strokeStyle = rgb(BEECH);
    ctx.lineWidth = Math.max(1, ts * 0.05);
    ctx.beginPath();
    ctx.moveTo(bowLeft, sawTop);
    ctx.lineTo(bowLeft, sawTop + ts * 0.4);
    ctx.moveTo(bowRight, sawTop);
    ctx.lineTo(bowRight, sawTop + ts * 0.4);
    ctx.moveTo(bowLeft, sawTop + ts * 0.2);
    ctx.lineTo(bowRight, sawTop + ts * 0.2);
    ctx.stroke();
    ctx.strokeStyle = rgb(STEEL);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(bowLeft, sawTop + ts * 0.36);
    ctx.lineTo(bowRight, sawTop + ts * 0.36);
    ctx.stroke();
    ctx.strokeStyle = rgb([200, 186, 150]);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    ctx.beginPath();
    ctx.moveTo(bowLeft, sawTop + ts * 0.03);
    ctx.lineTo(bowRight, sawTop + ts * 0.03);
    ctx.stroke();
    peg((bowLeft + bowRight) / 2, sawTop + ts * 0.02);

    // Middle row.
    const rowTop = boardTop + ts * 0.56;
    // Chisel rack: a slotted rail, six chisels graded narrow to wide.
    const rackLeft = left + ts * 0.12;
    const chisels = 6;
    const chiselPitch = ts * 0.1;
    block(
      ctx,
      rackLeft - ts * 0.04,
      rowTop,
      chiselPitch * chisels + ts * 0.04,
      ts * 0.05,
      sampleRamp(wood, 0.5),
      ts,
      0.5,
    );
    for (let i = 0; i < chisels; i++) {
      const cx = rackLeft + chiselPitch * (i + 0.3);
      const bladeW = ts * (0.018 + i * 0.008);
      block(ctx, cx - ts * 0.022, rowTop - ts * 0.13, ts * 0.044, ts * 0.13, BEECH, ts, 0.4);
      block(ctx, cx - bladeW / 2, rowTop + ts * 0.05, bladeW, ts * 0.18, STEEL, ts, 0.4);
    }
    // Mallet, head up.
    const malletX = left + ts * 0.86;
    block(ctx, malletX - ts * 0.02, rowTop - ts * 0.02, ts * 0.04, ts * 0.3, BEECH_DARK, ts, 0.4);
    block(ctx, malletX - ts * 0.1, rowTop - ts * 0.12, ts * 0.2, ts * 0.12, BEECH, ts, 0.6);
    litEdge(
      ctx,
      malletX - ts * 0.1,
      rowTop - ts * 0.12,
      ts * 0.2,
      Math.max(1, ts * 0.02),
      PINE_LIGHT,
      0.8,
    );
    peg(malletX, rowTop + ts * 0.02);
    // Try square: a rosewood stock with brass rivets, a steel blade.
    const trySquareX = left + ts * 1.06;
    block(ctx, trySquareX, rowTop - ts * 0.1, ts * 0.06, ts * 0.26, ROSEWOOD, ts, 0.5);
    block(ctx, trySquareX + ts * 0.06, rowTop - ts * 0.08, ts * 0.22, ts * 0.04, STEEL, ts, 0.4);
    for (const ry of [0, 0.08, 0.16])
      disc(
        ctx,
        trySquareX + ts * 0.03,
        rowTop - ts * 0.06 + ts * ry,
        Math.max(1, ts * 0.012),
        BRASS_LIGHT,
      );
    // Framing square: the big steel L.
    const framingX = left + ts * 1.42;
    ctx.fillStyle = rgb(STEEL_DARK);
    ctx.beginPath();
    ctx.moveTo(framingX, rowTop - ts * 0.14);
    ctx.lineTo(framingX + ts * 0.05, rowTop - ts * 0.14);
    ctx.lineTo(framingX + ts * 0.05, rowTop + ts * 0.18);
    ctx.lineTo(framingX + ts * 0.36, rowTop + ts * 0.18);
    ctx.lineTo(framingX + ts * 0.36, rowTop + ts * 0.23);
    ctx.lineTo(framingX, rowTop + ts * 0.23);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.45);
    ctx.strokeStyle = rgba(STEEL_LIGHT, 0.7);
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(framingX + ts * 0.05 + i * ts * 0.05, rowTop + ts * 0.18);
      ctx.lineTo(framingX + ts * 0.05 + i * ts * 0.05, rowTop + ts * 0.2);
      ctx.stroke();
    }
    // Dividers.
    const dividerX = left + ts * 1.95;
    ctx.strokeStyle = rgb(STEEL_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(dividerX - ts * 0.06, rowTop + ts * 0.2);
    ctx.lineTo(dividerX, rowTop - ts * 0.08);
    ctx.lineTo(dividerX + ts * 0.06, rowTop + ts * 0.2);
    ctx.stroke();
    disc(ctx, dividerX, rowTop - ts * 0.08, Math.max(1, ts * 0.026), BRASS);
    // The plumb bob, hanging true from its peg.
    const plumbX = left + ts * 2.2;
    peg(plumbX, rowTop - ts * 0.12);
    ctx.strokeStyle = rgb([220, 208, 176]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plumbX, rowTop - ts * 0.12);
    ctx.lineTo(plumbX, rowTop + ts * 0.08);
    ctx.stroke();
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.moveTo(plumbX - ts * 0.03, rowTop + ts * 0.08);
    ctx.lineTo(plumbX + ts * 0.03, rowTop + ts * 0.08);
    ctx.lineTo(plumbX + ts * 0.06, rowTop + ts * 0.14);
    ctx.lineTo(plumbX, rowTop + ts * 0.26);
    ctx.lineTo(plumbX - ts * 0.06, rowTop + ts * 0.14);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.45);
    ctx.fillStyle = rgba(BRASS_LIGHT, 0.9);
    ctx.fillRect(plumbX - ts * 0.035, rowTop + ts * 0.11, ts * 0.02, ts * 0.06);
    // Bit brace.
    const braceX = left + ts * 2.52;
    ctx.strokeStyle = rgb(STEEL_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.022);
    ctx.beginPath();
    ctx.moveTo(braceX, rowTop - ts * 0.12);
    ctx.lineTo(braceX, rowTop - ts * 0.02);
    ctx.lineTo(braceX + ts * 0.12, rowTop - ts * 0.02);
    ctx.lineTo(braceX + ts * 0.12, rowTop + ts * 0.12);
    ctx.lineTo(braceX, rowTop + ts * 0.12);
    ctx.lineTo(braceX, rowTop + ts * 0.22);
    ctx.stroke();
    disc(ctx, braceX, rowTop - ts * 0.13, ts * 0.04, BEECH);
    block(ctx, braceX + ts * 0.1, rowTop + ts * 0.02, ts * 0.05, ts * 0.08, BEECH, ts, 0.4);

    // The spirit level on two pegs, then the plane shelf beneath it.
    const levelY = boardBottom - ts * 0.34;
    const levelLeft = left + ts * 0.2;
    const levelW = ts * 1.3;
    peg(levelLeft + ts * 0.15, levelY + ts * 0.1);
    peg(levelLeft + levelW - ts * 0.15, levelY + ts * 0.1);
    block(ctx, levelLeft, levelY, levelW, ts * 0.08, ROSEWOOD, ts, 0.6);
    block(ctx, levelLeft, levelY, ts * 0.08, ts * 0.08, BRASS, ts, 0.4);
    block(ctx, levelLeft + levelW - ts * 0.08, levelY, ts * 0.08, ts * 0.08, BRASS, ts, 0.4);
    block(
      ctx,
      levelLeft + levelW / 2 - ts * 0.1,
      levelY + ts * 0.015,
      ts * 0.2,
      ts * 0.05,
      BRASS_DARK,
      ts,
      0.3,
    );
    ctx.fillStyle = rgb(LEVEL_VIAL);
    ctx.fillRect(levelLeft + levelW / 2 - ts * 0.075, levelY + ts * 0.025, ts * 0.15, ts * 0.03);
    disc(ctx, levelLeft + levelW / 2, levelY + ts * 0.04, Math.max(1, ts * 0.012), [240, 250, 230]);

    const shelfY = boardBottom - ts * 0.08;
    const paintPlane = (x: number, length: number, height: number, wooden: boolean): void => {
      const body = wooden ? BEECH : STEEL_DARK;
      block(ctx, x, shelfY - height, length, height, body, ts, 0.5);
      litEdge(
        ctx,
        x,
        shelfY - height,
        length,
        Math.max(1, ts * 0.015),
        wooden ? PINE_LIGHT : STEEL_LIGHT,
        0.8,
      );
      if (!wooden) {
        // The tote behind and the knob in front.
        ctx.fillStyle = rgb(ROSEWOOD);
        ctx.beginPath();
        ctx.roundRect(
          x + length * 0.62,
          shelfY - height - ts * 0.1,
          ts * 0.1,
          ts * 0.12,
          ts * 0.03,
        );
        ctx.fill();
        inkOutline(ctx, ts * 0.4);
        disc(ctx, x + length * 0.2, shelfY - height - ts * 0.03, ts * 0.035, ROSEWOOD);
      } else {
        ctx.fillStyle = rgb(STEEL);
        ctx.fillRect(x + length * 0.42, shelfY - height - ts * 0.04, ts * 0.04, ts * 0.05);
      }
    };
    paintPlane(left + ts * 0.14, ts * 0.72, ts * 0.08, false);
    paintPlane(left + ts * 1.0, ts * 0.46, ts * 0.08, false);
    paintPlane(left + ts * 1.6, ts * 0.26, ts * 0.07, false);
    paintPlane(left + ts * 2.0, ts * 0.36, ts * 0.1, true);
    paintPlane(left + ts * 2.44, ts * 0.36, ts * 0.1, true);
    block(
      ctx,
      left + ts * 0.04,
      shelfY,
      width - ts * 0.08,
      ts * 0.05,
      sampleRamp(wood, 0.62),
      ts,
      0.6,
    );
    litEdge(
      ctx,
      left + ts * 0.04,
      shelfY,
      width - ts * 0.08,
      Math.max(1, ts * 0.015),
      sampleRamp(wood, 1),
    );

    // The bench: four square legs, a lower shelf of sorted offcuts, a thick beech top.
    const benchTop = box.bottom - ts * 0.64;
    const topH = ts * 0.13;
    const legW = ts * 0.12;
    const underY = box.bottom - ts * 0.24;
    for (const lx of [left + ts * 0.08, right - ts * 0.08 - legW]) {
      block(
        ctx,
        lx,
        benchTop + topH,
        legW,
        box.bottom - ts * 0.04 - benchTop - topH,
        sampleRamp(wood, 0.42),
        ts,
        0.7,
      );
    }
    block(
      ctx,
      left + ts * 0.08,
      underY,
      width - ts * 0.16,
      ts * 0.05,
      sampleRamp(wood, 0.5),
      ts,
      0.6,
    );
    const offcuts = 5;
    for (let i = 0; i < offcuts; i++) {
      const len = width * (0.7 - i * 0.1);
      block(
        ctx,
        left + ts * 0.22,
        underY - ts * 0.045 * (i + 1),
        len,
        ts * 0.04,
        mix(PINE, PINE_DARK, (i % 2) * 0.3),
        ts,
        0.35,
      );
    }
    block(ctx, left, benchTop, width, topH, BEECH, ts);
    litEdge(ctx, left, benchTop, width, Math.max(1, ts * 0.03), PINE_LIGHT, 0.85);
    ctx.fillStyle = rgba(BEECH_DARK, 0.5);
    ctx.fillRect(left, benchTop + topH * 0.6, width, topH * 0.4);
    // The face vice at the west end: a wooden chop and its screw with a tommy bar.
    block(ctx, left - ts * 0.02, benchTop + topH, ts * 0.26, ts * 0.2, BEECH, ts, 0.6);
    disc(ctx, left + ts * 0.11, benchTop + topH + ts * 0.1, ts * 0.04, BEECH_DARK);
    ctx.strokeStyle = rgb(BEECH_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(left - ts * 0.0, benchTop + topH + ts * 0.1);
    ctx.lineTo(left + ts * 0.24, benchTop + topH + ts * 0.14);
    ctx.stroke();
    // On the bench: a plane laid on its side, a marking gauge, a folding rule and a pencil.
    block(ctx, left + ts * 0.7, benchTop - ts * 0.08, ts * 0.42, ts * 0.08, STEEL_DARK, ts, 0.5);
    litEdge(
      ctx,
      left + ts * 0.7,
      benchTop - ts * 0.08,
      ts * 0.42,
      Math.max(1, ts * 0.015),
      STEEL_LIGHT,
      0.8,
    );
    block(ctx, left + ts * 1.4, benchTop - ts * 0.05, ts * 0.22, ts * 0.05, ROSEWOOD, ts, 0.4);
    block(ctx, left + ts * 1.48, benchTop - ts * 0.1, ts * 0.05, ts * 0.1, ROSEWOOD, ts, 0.4);
    block(
      ctx,
      left + ts * 1.84,
      benchTop - ts * 0.035,
      ts * 0.46,
      ts * 0.035,
      [224, 204, 150],
      ts,
      0.35,
    );
    block(ctx, left + ts * 2.4, benchTop - ts * 0.03, ts * 0.22, ts * 0.025, [196, 150, 60], ts, 0);
  });
}

/**
 * A new four-panel door laid flat across two trestles, planed true and
 * waiting to be hung — in someone else's house. Its hinges are laid out
 * beside it in the order they will go on, with the screws counted into a tin.
 */
export function paintDoorOnTrestles(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);
    const trestleColor = sampleRamp(wood, 0.45);
    const doorTop = box.bottom - ts * 0.9;
    const doorDepth = ts * 0.56;
    const doorLeft = box.left + ts * 0.3;
    const doorRight = box.right - ts * 0.3;
    // Trestles: a beam on two splayed legs each, seen end-on in front of the door's shadow.
    for (const tx of [box.left + ts * 0.4, box.right - ts * 0.4]) {
      const legs = (): void => {
        ctx.beginPath();
        ctx.moveTo(tx - ts * 0.3, box.bottom - ts * 0.06);
        ctx.lineTo(tx - ts * 0.1, doorTop + doorDepth - ts * 0.04);
        ctx.moveTo(tx + ts * 0.3, box.bottom - ts * 0.06);
        ctx.lineTo(tx + ts * 0.1, doorTop + doorDepth - ts * 0.04);
      };
      ctx.strokeStyle = rgba(TOWN_INK, 0.85);
      ctx.lineWidth = ts * 0.1;
      legs();
      ctx.stroke();
      ctx.strokeStyle = rgb(trestleColor);
      ctx.lineWidth = ts * 0.07;
      legs();
      ctx.stroke();
      // The trestle's beam, proud of the door at each end.
      block(
        ctx,
        tx - ts * 0.3,
        doorTop + doorDepth - ts * 0.02,
        ts * 0.6,
        ts * 0.1,
        sampleRamp(wood, 0.35),
        ts,
      );
    }
    // The door's thick edge, then its face with four raised fields.
    block(ctx, doorLeft, doorTop + doorDepth, doorRight - doorLeft, ts * 0.12, PINE_DARK, ts);
    ctx.fillStyle = rgb(PINE);
    ctx.beginPath();
    ctx.rect(doorLeft, doorTop, doorRight - doorLeft, doorDepth);
    ctx.fill();
    inkOutline(ctx, ts);
    paintPlankBoard(ctx, doorLeft, doorTop, doorRight - doorLeft, doorDepth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: doorDepth / 2,
      ramp: { shadow: PINE_DARK, mid: PINE, light: PINE_LIGHT, accent: PINE_LIGHT },
    });
    // Four raised fields, two along and two across: the door's long top
    // panels to the west, its short bottom panels to the east.
    const stile = ts * 0.1;
    const inner = doorRight - doorLeft - stile * 3;
    const fieldLengths = [inner * 0.58, inner * 0.42];
    const fieldDepth = (doorDepth - stile * 3) / 2;
    let fx = doorLeft + stile;
    for (const length of fieldLengths) {
      for (let row = 0; row < 2; row++) {
        const fy = doorTop + stile + (fieldDepth + stile) * row;
        // A raised field: a mid-tone panel, lit along its north and west
        // bevels and shaded along its south and east ones.
        const bevel = ts * 0.035;
        ctx.fillStyle = rgb(mix(PINE, PINE_DARK, 0.3));
        ctx.fillRect(fx, fy, length, fieldDepth);
        ctx.fillStyle = rgba(PINE_LIGHT, 0.9);
        ctx.fillRect(fx, fy, length, bevel);
        ctx.fillRect(fx, fy, bevel, fieldDepth);
        ctx.fillStyle = rgba(PINE_DARK, 0.8);
        ctx.fillRect(fx, fy + fieldDepth - bevel, length, bevel);
        ctx.fillRect(fx + length - bevel, fy, bevel, fieldDepth);
        ctx.fillStyle = rgb(PINE);
        ctx.fillRect(
          fx + bevel * 1.6,
          fy + bevel * 1.6,
          length - bevel * 3.2,
          fieldDepth - bevel * 3.2,
        );
        ctx.strokeStyle = rgba(PINE_DARK, 0.95);
        ctx.lineWidth = Math.max(1, ts * 0.018);
        ctx.strokeRect(fx, fy, length, fieldDepth);
      }
      fx += length + stile;
    }
    ctx.beginPath();
    ctx.rect(doorLeft, doorTop, doorRight - doorLeft, doorDepth);
    inkOutline(ctx, ts);
    // A smoothing plane resting on the face and one clean curl of shaving.
    const planeX = doorLeft + ts * 0.8;
    block(ctx, planeX, doorTop + ts * 0.1, ts * 0.32, ts * 0.1, STEEL_DARK, ts, 0.5);
    litEdge(ctx, planeX, doorTop + ts * 0.1, ts * 0.32, Math.max(1, ts * 0.015), STEEL_LIGHT, 0.8);
    disc(ctx, planeX + ts * 0.26, doorTop + ts * 0.08, ts * 0.035, ROSEWOOD);
    ctx.strokeStyle = rgb(PINE_LIGHT);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.arc(planeX + ts * 0.5, doorTop + ts * 0.15, ts * 0.06, Math.PI * 0.2, Math.PI * 1.8);
    ctx.stroke();
    // Two hinges and a screw tin, laid out in the order they will go on.
    const hingeY = doorTop + doorDepth * 0.55;
    for (const hx of [doorLeft + ts * 1.55, doorLeft + ts * 1.85]) {
      block(ctx, hx, hingeY - ts * 0.05, ts * 0.22, ts * 0.1, BRASS, ts, 0.45);
      ctx.fillStyle = rgb(BRASS_DARK);
      ctx.fillRect(hx + ts * 0.1, hingeY - ts * 0.05, Math.max(1, ts * 0.02), ts * 0.1);
      litEdge(ctx, hx, hingeY - ts * 0.05, ts * 0.22, 1, BRASS_LIGHT, 0.9);
    }
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.ellipse(doorLeft + ts * 2.18, hingeY, ts * 0.08, ts * 0.05, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.45);
    // The lock plate and knob, already fitted on the closing stile.
    const lockX = doorLeft + stile * 1.5 + fieldLengths[0];
    const lockY = doorTop + doorDepth - stile * 0.5;
    block(
      ctx,
      lockX - ts * 0.04,
      lockY - ts * 0.08,
      ts * 0.08,
      ts * 0.16,
      sampleRamp(iron(), 0.55),
      ts,
      0.4,
    );
    disc(ctx, lockX, lockY - ts * 0.02, ts * 0.035, BRASS);
    disc(ctx, lockX - ts * 0.01, lockY - ts * 0.03, Math.max(1, ts * 0.012), BRASS_LIGHT);
    // A folding rule and a pencil at the near edge.
    block(
      ctx,
      doorLeft + ts * 0.18,
      doorTop + doorDepth - ts * 0.1,
      ts * 0.5,
      ts * 0.04,
      [224, 204, 150],
      ts,
      0.35,
    );
    block(
      ctx,
      doorLeft + ts * 0.3,
      doorTop + ts * 0.16,
      ts * 0.2,
      ts * 0.025,
      [196, 150, 60],
      ts,
      0,
    );
  });
}

/**
 * Planed boards stacked on bearers with a stick between every course so the
 * air gets through — sorted by length, ends squared flush, the way a joiner
 * keeps the stock he is saving for a job.
 */
export function paintTimberStack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    const bearerH = ts * 0.1;
    const bottom = box.bottom - ts * 0.06;
    for (const bx of [left + ts * 0.2, (left + right) / 2 - ts * 0.08, right - ts * 0.36]) {
      block(ctx, bx, bottom - bearerH, ts * 0.16, bearerH, sampleRamp(wood, 0.35), ts, 0.6);
    }
    const courses = 5;
    const boardH = ts * 0.085;
    const stickH = ts * 0.035;
    let y = bottom - bearerH;
    for (let c = 0; c < courses; c++) {
      const inset = c * ts * 0.08;
      const tone = mix(PINE, PINE_DARK, 0.12 + jitter(rng, 0.08) + (c % 2) * 0.12);
      y -= boardH;
      block(ctx, left + inset, y, right - left - inset * 2, boardH, tone, ts, 0.5);
      litEdge(
        ctx,
        left + inset,
        y,
        right - left - inset * 2,
        Math.max(1, ts * 0.015),
        PINE_LIGHT,
        0.8,
      );
      // The end grain, square to the face.
      block(ctx, right - inset - ts * 0.06, y, ts * 0.06, boardH, LOG_END, ts, 0.3);
      if (c < courses - 1) {
        for (const sx of [left + ts * 0.24, (left + right) / 2 - ts * 0.04, right - ts * 0.32]) {
          block(ctx, sx, y - stickH, ts * 0.08, stickH, sampleRamp(wood, 0.3), ts, 0.3);
        }
        y -= stickH;
      }
    }
  });
}

/**
 * His tool chest: a dovetailed oak chest with brass corners and a brass
 * escutcheon, iron lifting handles at each end, and a panel saw strapped
 * along the lid — the kit that goes with him to a job.
 */
export function paintToolChest(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.44);
    const left = box.left + ts * 0.14;
    const right = box.right - ts * 0.14;
    const width = right - left;
    const bottom = box.bottom - ts * 0.06;
    const bodyTop = bottom - ts * 0.46;
    const lidDepth = ts * 0.22;
    // The lid's top face, then the front.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.beginPath();
    ctx.rect(left, bodyTop - lidDepth, width, lidDepth);
    ctx.fill();
    inkOutline(ctx, ts);
    litEdge(ctx, left, bodyTop - lidDepth, width, Math.max(1, ts * 0.02), sampleRamp(wood, 1));
    block(
      ctx,
      left - ts * 0.02,
      bodyTop - ts * 0.02,
      width + ts * 0.04,
      ts * 0.08,
      sampleRamp(wood, 0.5),
      ts,
    );
    paintPlankBoard(
      ctx,
      left,
      bodyTop + ts * 0.06,
      width,
      bottom - bodyTop - ts * 0.06,
      forkRng(rng),
      {
        direction: 'horizontal',
        boardPx: (bottom - bodyTop) / 3,
        ramp: wood,
      },
    );
    ctx.beginPath();
    ctx.rect(left, bodyTop + ts * 0.06, width, bottom - bodyTop - ts * 0.06);
    inkOutline(ctx, ts);
    // The saw strapped along the lid.
    block(
      ctx,
      left + ts * 0.3,
      bodyTop - lidDepth * 0.72,
      width * 0.62,
      ts * 0.08,
      STEEL,
      ts,
      0.45,
    );
    block(ctx, left + ts * 0.14, bodyTop - lidDepth * 0.8, ts * 0.18, ts * 0.12, BEECH, ts, 0.45);
    for (const sx of [left + width * 0.4, left + width * 0.75]) {
      block(ctx, sx, bodyTop - lidDepth, ts * 0.05, lidDepth, [98, 70, 44], ts, 0.3);
    }
    // Brass corners and escutcheon, iron handles at the ends.
    const corner = ts * 0.09;
    for (const cx of [left, right - corner]) {
      block(ctx, cx, bodyTop + ts * 0.06, corner, corner, BRASS, ts, 0.35);
      block(ctx, cx, bottom - corner, corner, corner, BRASS, ts, 0.35);
    }
    block(
      ctx,
      left + width / 2 - ts * 0.05,
      bodyTop + ts * 0.08,
      ts * 0.1,
      ts * 0.12,
      BRASS,
      ts,
      0.4,
    );
    disc(ctx, left + width / 2, bodyTop + ts * 0.13, Math.max(1, ts * 0.018), SOOT);
    ctx.strokeStyle = rgb(sampleRamp(iron(), 0.6));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    for (const [hx, dir] of [
      [left, -1],
      [right, 1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(hx, bodyTop + ts * 0.14);
      ctx.lineTo(hx + dir * ts * 0.06, bodyTop + ts * 0.16);
      ctx.lineTo(hx + dir * ts * 0.06, bodyTop + ts * 0.26);
      ctx.lineTo(hx, bodyTop + ts * 0.28);
      ctx.stroke();
    }
  });
}

// ── The hearth and the good chair ──────────────────────────────────────────

/**
 * The hearth he laid himself: a chimney breast of dressed ashlar in dead-level
 * courses, a keyed arch over the firebox, a squared oak mantel with a pair of
 * brass candlesticks set exactly equidistant and a level lying along it; a
 * fire on iron dogs with a copper kettle on the crane; out on the hearthstone,
 * a squared log box stacked end-on and a stand of fire irons. Three tiles
 * wide and two deep.
 */
export function paintBuildersHearth(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = HEARTH_FREESTONE;
    const wood = timber();
    contactShadow(ctx, frame, 0.48);

    // Hearthstone: squared flags across the front row, with a raised kerb.
    const hearthTop = box.bottom - ts * 1.02;
    const hearthLeft = box.left + ts * 0.06;
    const hearthRight = box.right - ts * 0.06;
    paintAshlar(
      ctx,
      hearthLeft,
      hearthTop,
      hearthRight - hearthLeft,
      ts * 0.9,
      ts * 0.3,
      ts * 0.6,
      stone,
      forkRng(rng),
    );
    ctx.beginPath();
    ctx.rect(hearthLeft, hearthTop, hearthRight - hearthLeft, ts * 0.9);
    inkOutline(ctx, ts);
    block(
      ctx,
      hearthLeft,
      box.bottom - ts * 0.16,
      hearthRight - hearthLeft,
      ts * 0.1,
      sampleRamp(stone, 0.35),
      ts,
    );
    litEdge(
      ctx,
      hearthLeft,
      box.bottom - ts * 0.16,
      hearthRight - hearthLeft,
      Math.max(1, ts * 0.02),
      sampleRamp(stone, 1),
    );

    // The chimney breast up to the mantel, then the narrower stack rising
    // into the wall above it.
    const breastLeft = box.left + ts * 0.26;
    const breastRight = box.right - ts * 0.26;
    const breastBottom = hearthTop + ts * 0.06;
    const mantelLevel = box.bottom - ts * 2.1;
    const stackInset = ts * 0.34;
    const stackTop = box.bottom - ts * 3.0;
    paintAshlar(
      ctx,
      breastLeft + stackInset,
      stackTop,
      breastRight - breastLeft - stackInset * 2,
      mantelLevel - stackTop + ts * 0.1,
      ts * 0.2,
      ts * 0.42,
      stone,
      forkRng(rng),
    );
    ctx.beginPath();
    ctx.rect(
      breastLeft + stackInset,
      stackTop,
      breastRight - breastLeft - stackInset * 2,
      mantelLevel - stackTop + ts * 0.1,
    );
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(stone.shadow, 0.35);
    ctx.fillRect(breastRight - stackInset - ts * 0.1, stackTop, ts * 0.1, mantelLevel - stackTop);
    paintAshlar(
      ctx,
      breastLeft,
      mantelLevel,
      breastRight - breastLeft,
      breastBottom - mantelLevel,
      ts * 0.2,
      ts * 0.42,
      stone,
      forkRng(rng),
    );
    ctx.beginPath();
    ctx.rect(breastLeft, mantelLevel, breastRight - breastLeft, breastBottom - mantelLevel);
    inkOutline(ctx, ts);
    // Shade the breast's east return so it stands proud of the wall.
    ctx.fillStyle = rgba(stone.shadow, 0.3);
    ctx.fillRect(breastRight - ts * 0.12, mantelLevel, ts * 0.12, breastBottom - mantelLevel);

    // Firebox under a keyed arch.
    const fireCx = box.centreX;
    const fireHalf = ts * 0.56;
    const fireTop = box.bottom - ts * 1.78;
    const fireBottom = hearthTop + ts * 0.06;
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(fireCx - fireHalf, fireBottom);
    ctx.lineTo(fireCx - fireHalf, fireTop + fireHalf * 0.5);
    ctx.quadraticCurveTo(
      fireCx,
      fireTop - fireHalf * 0.35,
      fireCx + fireHalf,
      fireTop + fireHalf * 0.5,
    );
    ctx.lineTo(fireCx + fireHalf, fireBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const back = ctx.createRadialGradient(
      fireCx,
      fireBottom - ts * 0.1,
      2,
      fireCx,
      fireBottom - ts * 0.2,
      fireHalf * 1.2,
    );
    back.addColorStop(0, rgba(EMBER_GLOW, 0.85));
    back.addColorStop(0.5, rgba(FLAME_DEEP, 0.55));
    back.addColorStop(1, rgba(SOOT, 0));
    ctx.fillStyle = back;
    ctx.fill();
    // Voussoirs and the keystone.
    const voussoirs = 7;
    for (let i = 0; i < voussoirs; i++) {
      const t = i / (voussoirs - 1);
      const ang = Math.PI + t * Math.PI;
      const rx = fireHalf + ts * 0.06;
      const vx = fireCx + Math.cos(ang) * rx;
      const vy = fireTop + fireHalf * 0.42 + Math.sin(ang) * fireHalf * 0.75;
      const key = i === Math.floor(voussoirs / 2);
      const vw = key ? ts * 0.16 : ts * 0.12;
      const vh = key ? ts * 0.2 : ts * 0.13;
      block(ctx, vx - vw / 2, vy - vh / 2, vw, vh, sampleRamp(stone, key ? 0.85 : 0.7), ts, 0.5);
    }
    // Iron dogs, logs and the fire.
    const dogY = fireBottom - ts * 0.06;
    for (const side of [-1, 1]) {
      block(
        ctx,
        fireCx + side * ts * 0.34 - ts * 0.03,
        dogY - ts * 0.16,
        ts * 0.06,
        ts * 0.18,
        sampleRamp(iron(), 0.5),
        ts,
        0.5,
      );
      disc(ctx, fireCx + side * ts * 0.34, dogY - ts * 0.17, ts * 0.04, sampleRamp(iron(), 0.8));
    }
    for (const [lx, ly, len] of [
      [fireCx - ts * 0.34, dogY - ts * 0.1, ts * 0.68],
      [fireCx - ts * 0.26, dogY - ts * 0.18, ts * 0.52],
    ] as const) {
      block(ctx, lx, ly, len, ts * 0.09, LOG_BARK, ts, 0.5);
      disc(ctx, lx + len, ly + ts * 0.045, ts * 0.045, LOG_END);
    }
    glow(ctx, fireCx, dogY - ts * 0.2, ts * 0.7, EMBER_GLOW, 0.35);
    flame(ctx, fireCx - ts * 0.14, dogY - ts * 0.12, ts * 0.36, ts * 0.1);
    flame(ctx, fireCx + ts * 0.06, dogY - ts * 0.14, ts * 0.46, ts * 0.12);
    flame(ctx, fireCx + ts * 0.22, dogY - ts * 0.1, ts * 0.28, ts * 0.08);
    // The crane and the kettle, swung in over the fire.
    const craneX = fireCx - fireHalf + ts * 0.06;
    ctx.strokeStyle = rgb(sampleRamp(iron(), 0.45));
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.moveTo(craneX, fireBottom - ts * 0.1);
    ctx.lineTo(craneX, fireTop + ts * 0.2);
    ctx.lineTo(fireCx + ts * 0.08, fireTop + ts * 0.2);
    ctx.moveTo(fireCx - ts * 0.18, fireTop + ts * 0.2);
    ctx.lineTo(fireCx - ts * 0.18, fireTop + ts * 0.36);
    ctx.stroke();
    ctx.fillStyle = rgb(COPPER);
    ctx.beginPath();
    ctx.ellipse(fireCx - ts * 0.18, fireTop + ts * 0.5, ts * 0.16, ts * 0.13, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgb(COPPER_LIGHT);
    ctx.beginPath();
    ctx.ellipse(fireCx - ts * 0.24, fireTop + ts * 0.46, ts * 0.05, ts * 0.06, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = rgb(COPPER);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.moveTo(fireCx - ts * 0.04, fireTop + ts * 0.48);
    ctx.lineTo(fireCx + ts * 0.06, fireTop + ts * 0.4);
    ctx.stroke();

    // The mantel: a squared oak beam, and on it everything set exactly.
    const mantelY = mantelLevel - ts * 0.04;
    const mantelLeft = breastLeft - ts * 0.1;
    const mantelW = breastRight - breastLeft + ts * 0.2;
    block(ctx, mantelLeft, mantelY, mantelW, ts * 0.14, sampleRamp(wood, 0.55), ts);
    litEdge(ctx, mantelLeft, mantelY, mantelW, Math.max(1, ts * 0.025), sampleRamp(wood, 1), 0.8);
    ctx.fillStyle = rgba(sampleRamp(wood, 0), 0.4);
    ctx.fillRect(mantelLeft, mantelY + ts * 0.14, mantelW, ts * 0.04);
    for (const side of [-1, 1]) {
      const sx = box.centreX + side * ts * 0.95;
      block(ctx, sx - ts * 0.04, mantelY - ts * 0.04, ts * 0.08, ts * 0.04, BRASS_DARK, ts, 0.4);
      block(ctx, sx - ts * 0.02, mantelY - ts * 0.2, ts * 0.04, ts * 0.16, BRASS, ts, 0.4);
      block(ctx, sx - ts * 0.025, mantelY - ts * 0.34, ts * 0.05, ts * 0.14, LINEN, ts, 0.4);
      glow(ctx, sx, mantelY - ts * 0.4, ts * 0.22, EMBER_GLOW, 0.3);
      flame(ctx, sx, mantelY - ts * 0.34, ts * 0.1, ts * 0.03);
    }
    // A level lying along the mantel, bubble centred.
    const levelW = ts * 0.9;
    block(ctx, box.centreX - levelW / 2, mantelY - ts * 0.06, levelW, ts * 0.06, ROSEWOOD, ts, 0.5);
    ctx.fillStyle = rgb(LEVEL_VIAL);
    ctx.fillRect(box.centreX - ts * 0.06, mantelY - ts * 0.05, ts * 0.12, ts * 0.03);
    disc(ctx, box.centreX, mantelY - ts * 0.035, Math.max(1, ts * 0.01), [240, 250, 230]);

    // The log box, west on the hearthstone: squared oak, logs stacked end-on.
    const logBoxLeft = hearthLeft + ts * 0.06;
    const logBoxW = ts * 0.56;
    const logBoxTop = box.bottom - ts * 0.62;
    const logR = ts * 0.075;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        const lx = logBoxLeft + logR * 1.3 + i * logR * 2.2 + (row % 2) * logR * 0.9;
        const ly = logBoxTop - logR * 0.4 - row * logR * 1.7;
        if (row === 1 && i === 2) continue;
        disc(ctx, lx, ly, logR, LOG_BARK);
        disc(ctx, lx, ly, logR * 0.72, LOG_END);
      }
    }
    block(ctx, logBoxLeft, logBoxTop, logBoxW, ts * 0.4, sampleRamp(wood, 0.5), ts);
    litEdge(ctx, logBoxLeft, logBoxTop, logBoxW, Math.max(1, ts * 0.02), sampleRamp(wood, 1));
    // The fire irons on their stand, east.
    const standX = hearthRight - ts * 0.3;
    block(
      ctx,
      standX - ts * 0.12,
      box.bottom - ts * 0.24,
      ts * 0.24,
      ts * 0.05,
      sampleRamp(iron(), 0.5),
      ts,
      0.5,
    );
    ctx.strokeStyle = rgb(sampleRamp(iron(), 0.55));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(standX, box.bottom - ts * 0.22);
    ctx.lineTo(standX, box.bottom - ts * 0.9);
    ctx.moveTo(standX - ts * 0.1, box.bottom - ts * 0.84);
    ctx.lineTo(standX + ts * 0.1, box.bottom - ts * 0.84);
    ctx.stroke();
    for (const [dx, len] of [
      [-0.08, 0.56],
      [0.0, 0.62],
      [0.08, 0.52],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(standX + ts * dx, box.bottom - ts * 0.84);
      ctx.lineTo(standX + ts * dx, box.bottom - ts * (0.84 - len));
      ctx.stroke();
    }
    disc(ctx, standX, box.bottom - ts * 0.92, ts * 0.035, BRASS);
  });
}

/**
 * The one good chair: a Windsor armchair, bow back and five spindles, a
 * saddled elm seat oiled to a shine, with a madder wool cushion.
 */
export function paintGoodChair(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.38);
    const cx = box.centreX;
    const seatY = box.bottom - ts * 0.4;
    const seatHalf = ts * 0.34;
    const oiled = sampleRamp(wood, 0.62);
    const oiledDark = sampleRamp(wood, 0.42);
    // Every turned part is stroked twice, ink under wood, so a spindle two
    // pixels wide still has an edge at 32 px.
    const turned = (width: number, color: RGB, path: () => void): void => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(TOWN_INK, 0.85);
      ctx.lineWidth = width + Math.max(2, ts * 0.03);
      path();
      ctx.stroke();
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = width;
      path();
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    const legWidth = ts * 0.06;
    for (const side of [-1, 1]) {
      turned(legWidth, oiledDark, () => {
        ctx.beginPath();
        ctx.moveTo(cx + side * seatHalf * 0.66, seatY);
        ctx.lineTo(cx + side * seatHalf * 0.92, box.bottom - ts * 0.05);
      });
    }
    turned(ts * 0.035, oiledDark, () => {
      ctx.beginPath();
      ctx.moveTo(cx - seatHalf * 0.8, box.bottom - ts * 0.2);
      ctx.lineTo(cx + seatHalf * 0.8, box.bottom - ts * 0.2);
    });
    const bowTop = seatY - ts * 0.86;
    const spindles = 5;
    for (let i = 1; i <= spindles; i++) {
      const t = i / (spindles + 1);
      const sx = cx - seatHalf * 0.78 + seatHalf * 1.56 * t;
      const arch = Math.sin(t * Math.PI);
      turned(ts * 0.035, oiled, () => {
        ctx.beginPath();
        ctx.moveTo(sx, seatY);
        ctx.lineTo(sx, seatY - ts * (0.3 + arch * 0.4));
      });
    }
    turned(ts * 0.07, oiled, () => {
      ctx.beginPath();
      ctx.moveTo(cx - seatHalf * 0.86, seatY - ts * 0.04);
      ctx.bezierCurveTo(
        cx - seatHalf * 0.98,
        bowTop,
        cx + seatHalf * 0.98,
        bowTop,
        cx + seatHalf * 0.86,
        seatY - ts * 0.04,
      );
    });
    for (const side of [-1, 1]) {
      turned(ts * 0.06, sampleRamp(wood, 0.7), () => {
        ctx.beginPath();
        ctx.moveTo(cx + side * seatHalf * 0.55, seatY - ts * 0.32);
        ctx.lineTo(cx + side * seatHalf * 1.04, seatY - ts * 0.28);
        ctx.lineTo(cx + side * seatHalf * 1.0, seatY - ts * 0.02);
      });
    }
    // The saddled seat, and the cushion on it.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.72));
    ctx.beginPath();
    ctx.ellipse(cx, seatY, seatHalf, ts * 0.13, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(oiledDark);
    ctx.beginPath();
    ctx.ellipse(cx, seatY + ts * 0.05, seatHalf * 0.96, ts * 0.07, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = rgb(CUSHION);
    ctx.beginPath();
    ctx.roundRect(cx - seatHalf * 0.7, seatY - ts * 0.12, seatHalf * 1.4, ts * 0.14, ts * 0.05);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgba([255, 220, 190], 0.4);
    ctx.fillRect(cx - seatHalf * 0.55, seatY - ts * 0.1, seatHalf * 0.8, Math.max(1, ts * 0.025));
  });
}

// ── The farmer ─────────────────────────────────────────────────────────────

/**
 * The dairy wall: a window onto the pasture with its good fence and no cow,
 * a peg rail either side — two pails hung upturned and a skimmer on one side,
 * the shoulder yoke hung level on the other — over a scrubbed deal bench of
 * setting pans, a stack of nested tin pails and a folded straining cloth.
 */
export function paintDairyWall(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const width = right - left;

    const windowW = ts * 0.96;
    const windowH = ts * 0.62;
    const windowX = box.centreX - windowW / 2;
    const windowY = box.bottom - ts * 1.9;
    paintWindow(ctx, windowX, windowY, windowW, windowH, ts, true);
    daylight(ctx, windowX, windowY + windowH, windowW, ts * 0.9, -ts * 0.1);

    // Peg rails either side of the window.
    const railY = box.bottom - ts * 1.86;
    for (const [rx, rw] of [
      [left, windowX - left - ts * 0.14],
      [windowX + windowW + ts * 0.14, right - windowX - windowW - ts * 0.14],
    ] as const) {
      block(ctx, rx, railY, rw, ts * 0.07, sampleRamp(wood, 0.6), ts, 0.6);
      litEdge(ctx, rx, railY, rw, Math.max(1, ts * 0.015), sampleRamp(wood, 1));
    }
    // West: two pails hung upturned by their bails, and a skimmer.
    paintPail(ctx, left + ts * 0.2, railY + ts * 0.46, ts * 0.3, ts * 0.3, ts, true);
    paintPail(ctx, left + ts * 0.56, railY + ts * 0.46, ts * 0.3, ts * 0.3, ts, true);
    ctx.strokeStyle = rgb(TIN_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.86, railY + ts * 0.04);
    ctx.lineTo(left + ts * 0.86, railY + ts * 0.3);
    ctx.stroke();
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.ellipse(left + ts * 0.86, railY + ts * 0.38, ts * 0.07, ts * 0.09, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    // East: the shoulder yoke, hung level, its chains and hooks drawn in.
    const yokeLeft = windowX + windowW + ts * 0.2;
    const yokeRight = right - ts * 0.08;
    const yokeY = railY + ts * 0.14;
    // Carved to sit across two shoulders: thick at the ends, dipped and
    // hollowed at the neck in the middle.
    const yokeMid = (yokeLeft + yokeRight) / 2;
    ctx.fillStyle = rgb(BEECH);
    ctx.beginPath();
    ctx.moveTo(yokeLeft, yokeY - ts * 0.02);
    ctx.quadraticCurveTo(yokeMid, yokeY + ts * 0.16, yokeRight, yokeY - ts * 0.02);
    ctx.lineTo(yokeRight, yokeY + ts * 0.1);
    ctx.quadraticCurveTo(yokeMid, yokeY + ts * 0.36, yokeLeft, yokeY + ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BEECH_DARK);
    ctx.beginPath();
    ctx.ellipse(yokeMid, yokeY + ts * 0.19, ts * 0.1, ts * 0.04, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = rgba(PINE_LIGHT, 0.8);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    ctx.beginPath();
    ctx.moveTo(yokeLeft + ts * 0.04, yokeY + ts * 0.01);
    ctx.quadraticCurveTo(yokeMid, yokeY + ts * 0.18, yokeRight - ts * 0.04, yokeY + ts * 0.01);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(iron(), 0.6));
    ctx.lineWidth = Math.max(1, ts * 0.018);
    for (const hx of [yokeLeft + ts * 0.05, yokeRight - ts * 0.05]) {
      ctx.beginPath();
      ctx.moveTo(hx, yokeY + ts * 0.06);
      ctx.lineTo(hx, yokeY + ts * 0.34);
      ctx.arc(hx + ts * 0.03, yokeY + ts * 0.34, ts * 0.03, Math.PI, 0, true);
      ctx.stroke();
    }

    // The scrubbed bench.
    const benchTop = box.bottom - ts * 0.62;
    const legW = ts * 0.08;
    for (const lx of [left + ts * 0.06, right - ts * 0.06 - legW]) {
      block(
        ctx,
        lx,
        benchTop,
        legW,
        box.bottom - ts * 0.04 - benchTop,
        mix(SCRUBBED_DEAL, PINE_DARK, 0.35),
        ts,
        0.6,
      );
    }
    block(
      ctx,
      left + ts * 0.1,
      box.bottom - ts * 0.22,
      width - ts * 0.2,
      ts * 0.05,
      mix(SCRUBBED_DEAL, PINE_DARK, 0.25),
      ts,
      0.5,
    );
    // Under the bench: two more pails, upright, and a scrubbing brush.
    paintPail(ctx, left + ts * 0.62, box.bottom - ts * 0.26, ts * 0.28, ts * 0.24, ts, false);
    paintPail(ctx, left + ts * 0.98, box.bottom - ts * 0.26, ts * 0.28, ts * 0.24, ts, false);
    block(ctx, right - ts * 0.72, box.bottom - ts * 0.33, ts * 0.22, ts * 0.07, BEECH, ts, 0.4);
    block(ctx, left, benchTop - ts * 0.08, width, ts * 0.1, SCRUBBED_DEAL, ts);
    litEdge(ctx, left, benchTop - ts * 0.08, width, Math.max(1, ts * 0.025), [248, 240, 222], 0.9);
    // On it: three setting pans on edge, a nest of tin pails, a folded straining cloth.
    const panY = benchTop - ts * 0.08;
    for (let i = 0; i < 3; i++) {
      const px = left + ts * 0.22 + i * ts * 0.14;
      ctx.fillStyle = rgb(mix(TIN, TIN_LIGHT, i * 0.2));
      ctx.beginPath();
      ctx.ellipse(px, panY - ts * 0.2, ts * 0.05, ts * 0.2, 0, 0, TWO_PI);
      ctx.fill();
      inkOutline(ctx, ts * 0.5);
    }
    const nestX = right - ts * 0.42;
    for (let i = 0; i < 3; i++) {
      const pw = ts * (0.34 - i * 0.02);
      const py = panY - i * ts * 0.08;
      ctx.fillStyle = rgb(mix(TIN, TIN_LIGHT, 0.2 + i * 0.15));
      ctx.beginPath();
      ctx.moveTo(nestX - pw * 0.4, py);
      ctx.lineTo(nestX + pw * 0.4, py);
      ctx.lineTo(nestX + pw * 0.5, py - ts * 0.1);
      ctx.lineTo(nestX - pw * 0.5, py - ts * 0.1);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.5);
    }
    ctx.fillStyle = rgba(TIN_LIGHT, 0.95);
    ctx.fillRect(nestX - ts * 0.12, panY - ts * 0.28, ts * 0.04, ts * 0.2);
    block(ctx, left + ts * 1.5, panY - ts * 0.08, ts * 0.4, ts * 0.08, LINEN, ts, 0.5);
    ctx.fillStyle = rgba(LINEN_SHADE, 0.8);
    ctx.fillRect(left + ts * 1.5, panY - ts * 0.04, ts * 0.4, ts * 0.02);
    // Tone breaks on the bench's own face so it is not one flat slab.
    ctx.fillStyle = rgba(PINE_DARK, 0.18 + jitter(rng, 0.03));
    ctx.fillRect(left, benchTop - ts * 0.01, width, ts * 0.03);
  });
}

/**
 * Three tall milk churns standing on a slatted stand, scoured till they
 * shine, and a plunger butter churn beside them with its dasher up — all
 * clean, all empty, all exactly where a full one would stand.
 */
export function paintChurnStand(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);
    // The slatted stand that keeps the tin off a wet floor.
    const standTop = box.bottom - ts * 0.18;
    const slats = 4;
    for (let i = 0; i < slats; i++) {
      block(
        ctx,
        box.left + ts * 0.06,
        standTop + i * ts * 0.035,
        box.width * 0.7,
        ts * 0.03,
        sampleRamp(wood, 0.55 + jitter(rng, 0.04) - i * 0.04),
        ts,
        0.35,
      );
    }
    const churns = 3;
    const churnW = ts * 0.4;
    for (let i = 0; i < churns; i++) {
      const cx = box.left + ts * 0.3 + i * ts * 0.46;
      paintChurn(ctx, cx, standTop + ts * 0.02, churnW, ts * 0.86, ts);
    }
    // The butter churn: tall staves, three hoops, a lid and its dasher.
    const bx = box.right - ts * 0.34;
    const bottom = box.bottom - ts * 0.04;
    const top = bottom - ts * 0.9;
    const halfBottom = ts * 0.2;
    const halfTop = ts * 0.14;
    ctx.fillStyle = rgb(PINE);
    ctx.beginPath();
    ctx.moveTo(bx - halfTop, top);
    ctx.lineTo(bx + halfTop, top);
    ctx.lineTo(bx + halfBottom, bottom);
    ctx.lineTo(bx - halfBottom, bottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = rgba(PINE_DARK, 0.55);
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const t = i / 5 - 0.5;
      ctx.beginPath();
      ctx.moveTo(bx + t * halfTop * 2, top);
      ctx.lineTo(bx + t * halfBottom * 2, bottom);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(PINE_DARK, 0.4);
    ctx.fillRect(bx + ts * 0.04, top, ts * 0.2, bottom - top);
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.6));
    for (const t of [0.12, 0.5, 0.86])
      ctx.fillRect(
        bx - halfBottom,
        top + (bottom - top) * t,
        halfBottom * 2,
        Math.max(1, ts * 0.035),
      );
    ctx.restore();
    ctx.fillStyle = rgb(PINE_LIGHT);
    ctx.beginPath();
    ctx.ellipse(bx, top, halfTop * 1.05, ts * 0.05, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.55);
    block(ctx, bx - ts * 0.02, top - ts * 0.34, ts * 0.04, ts * 0.34, BEECH, ts, 0.45);
    block(ctx, bx - ts * 0.07, top - ts * 0.36, ts * 0.14, ts * 0.04, BEECH, ts, 0.45);
  });
}

/**
 * A three-legged milking stool with a clean pail standing beside it,
 * upright and dry.
 */
export function paintMilkingStool(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.38);
    const stoolX = box.left + ts * 0.36;
    const seatY = box.bottom - ts * 0.3;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.45));
    ctx.lineWidth = Math.max(1, ts * 0.045);
    for (const dx of [-0.14, 0, 0.14]) {
      ctx.beginPath();
      ctx.moveTo(stoolX + ts * dx * 0.6, seatY);
      ctx.lineTo(stoolX + ts * dx, box.bottom - ts * (dx === 0 ? 0.1 : 0.04));
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.7));
    ctx.beginPath();
    ctx.ellipse(stoolX, seatY, ts * 0.2, ts * 0.075, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba([255, 240, 210], 0.35);
    ctx.beginPath();
    ctx.ellipse(stoolX - ts * 0.05, seatY - ts * 0.02, ts * 0.08, ts * 0.02, 0, 0, TWO_PI);
    ctx.fill();
    paintPail(ctx, box.right - ts * 0.26, box.bottom - ts * 0.06, ts * 0.34, ts * 0.32, ts, false);
  });
}

/**
 * Feed sacks stacked square — three below, two above, stencils all facing
 * out — with a tin scoop laid on top. Bought in for cows he does not have.
 */
export function paintFeedStack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.46);
    const left = box.left + ts * 0.08;
    const width = box.width - ts * 0.16;
    const sackH = ts * 0.3;
    const lowerW = width / 3;
    for (let i = 0; i < 3; i++) {
      paintLyingSack(
        ctx,
        left + lowerW * i,
        box.bottom - ts * 0.04 - sackH,
        lowerW - ts * 0.02,
        sackH,
        ts,
        forkRng(rng),
      );
    }
    const upperW = width / 2.6;
    for (let i = 0; i < 2; i++) {
      paintLyingSack(
        ctx,
        left + lowerW * 0.5 + upperW * i,
        box.bottom - ts * 0.04 - sackH * 1.86,
        upperW - ts * 0.02,
        sackH,
        ts,
        forkRng(rng),
      );
    }
    const scoopX = left + width * 0.44;
    const scoopY = box.bottom - ts * 0.04 - sackH * 1.9;
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.moveTo(scoopX, scoopY);
    ctx.lineTo(scoopX + ts * 0.22, scoopY - ts * 0.02);
    ctx.lineTo(scoopX + ts * 0.2, scoopY - ts * 0.1);
    ctx.lineTo(scoopX + ts * 0.02, scoopY - ts * 0.08);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    block(ctx, scoopX - ts * 0.12, scoopY - ts * 0.06, ts * 0.13, ts * 0.03, BEECH, ts, 0.35);
  });
}

/**
 * His supper table: square oak legs, a lit top, and one place laid on it —
 * a pewter plate with a heel of bread, a cup, the knife and fork set exactly
 * parallel either side, a folded napkin, a jug of water and a candle. He eats
 * alone, but he lays the table.
 */
export function paintSupperTable(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.44);
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    const width = right - left;
    const topY = box.bottom - ts * 0.72;
    const topDepth = ts * 0.34;
    const apronH = ts * 0.1;
    const legW = ts * 0.09;
    for (const lx of [left + ts * 0.04, right - ts * 0.04 - legW]) {
      block(
        ctx,
        lx,
        topY + topDepth,
        legW,
        box.bottom - ts * 0.04 - topY - topDepth,
        sampleRamp(wood, 0.4),
        ts,
        0.7,
      );
    }
    block(
      ctx,
      left + ts * 0.02,
      topY + topDepth,
      width - ts * 0.04,
      apronH,
      sampleRamp(wood, 0.45),
      ts,
      0.7,
    );
    paintPlankBoard(ctx, left, topY, width, topDepth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: topDepth / 3,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(left, topY, width, topDepth);
    inkOutline(ctx, ts);
    litEdge(ctx, left, topY + topDepth - ts * 0.03, width, ts * 0.03, sampleRamp(wood, 0.9), 0.6);
    // One place, laid square to the table's edge.
    const plateX = left + width * 0.36;
    const plateY = topY + topDepth * 0.52;
    ctx.fillStyle = rgb(STEEL);
    ctx.beginPath();
    ctx.ellipse(plateX, plateY, ts * 0.17, ts * 0.09, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(STEEL_LIGHT);
    ctx.beginPath();
    ctx.ellipse(plateX, plateY, ts * 0.11, ts * 0.055, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgb(LOG_END);
    ctx.beginPath();
    ctx.ellipse(plateX + ts * 0.02, plateY - ts * 0.01, ts * 0.06, ts * 0.035, 0.3, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.4);
    for (const side of [-1, 1]) {
      block(
        ctx,
        plateX + side * ts * 0.24 - ts * 0.012,
        plateY - ts * 0.08,
        ts * 0.024,
        ts * 0.16,
        STEEL_DARK,
        ts,
        0,
      );
    }
    block(ctx, plateX - ts * 0.4, plateY - ts * 0.05, ts * 0.1, ts * 0.1, LINEN, ts, 0.4);
    // A cup, a jug of water, and a candle at the far end.
    block(ctx, plateX + ts * 0.36, plateY - ts * 0.14, ts * 0.08, ts * 0.1, STEEL, ts, 0.45);
    const jugX = left + width * 0.72;
    ctx.fillStyle = rgb([176, 108, 76]);
    ctx.beginPath();
    ctx.moveTo(jugX - ts * 0.07, plateY + ts * 0.02);
    ctx.quadraticCurveTo(jugX - ts * 0.11, plateY - ts * 0.12, jugX - ts * 0.05, plateY - ts * 0.2);
    ctx.lineTo(jugX + ts * 0.06, plateY - ts * 0.2);
    ctx.quadraticCurveTo(
      jugX + ts * 0.11,
      plateY - ts * 0.12,
      jugX + ts * 0.07,
      plateY + ts * 0.02,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgba([255, 230, 200], 0.4);
    ctx.fillRect(jugX - ts * 0.06, plateY - ts * 0.14, ts * 0.02, ts * 0.12);
    const candleX = right - ts * 0.18;
    block(ctx, candleX - ts * 0.05, plateY - ts * 0.02, ts * 0.1, ts * 0.03, BRASS, ts, 0.35);
    block(ctx, candleX - ts * 0.02, plateY - ts * 0.18, ts * 0.04, ts * 0.16, LINEN, ts, 0.35);
    glow(ctx, candleX, plateY - ts * 0.24, ts * 0.24, EMBER_GLOW, 0.3);
    flame(ctx, candleX, plateY - ts * 0.18, ts * 0.09, ts * 0.03);
  });
}

// ── Where he sleeps ────────────────────────────────────────────────────────

/**
 * His cot: a joined oak box bed with pegged corners, the blanket drawn tight
 * with square corners and the sheet turned down to a ruled line, a pillow
 * squared to the headboard and a spare blanket folded at the foot.
 */
export function paintMadeCot(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, 0.46);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const frameBottom = box.bottom - ts * 0.06;
    const railTop = frameBottom - ts * 0.22;
    const mattressTop = railTop - ts * 0.44;
    const headW = ts * 0.1;
    // Headboard and footboard posts.
    block(
      ctx,
      left,
      mattressTop - ts * 0.3,
      headW,
      frameBottom - mattressTop + ts * 0.3,
      sampleRamp(wood, 0.5),
      ts,
    );
    block(
      ctx,
      right - headW,
      mattressTop - ts * 0.12,
      headW,
      frameBottom - mattressTop + ts * 0.12,
      sampleRamp(wood, 0.45),
      ts,
    );
    block(
      ctx,
      left - ts * 0.02,
      mattressTop - ts * 0.34,
      headW + ts * 0.04,
      ts * 0.05,
      sampleRamp(wood, 0.7),
      ts,
      0.5,
    );
    block(
      ctx,
      right - headW - ts * 0.02,
      mattressTop - ts * 0.16,
      headW + ts * 0.04,
      ts * 0.05,
      sampleRamp(wood, 0.7),
      ts,
      0.5,
    );
    const bedLeft = left + headW;
    const bedRight = right - headW;
    // Mattress in linen, the blanket over most of it, the sheet turned down.
    block(ctx, bedLeft, mattressTop, bedRight - bedLeft, railTop - mattressTop, LINEN, ts, 0.8);
    const pillowW = ts * 0.34;
    ctx.fillStyle = rgb(mix(LINEN, [255, 255, 255], 0.3));
    ctx.beginPath();
    ctx.roundRect(
      bedLeft + ts * 0.06,
      mattressTop + ts * 0.06,
      pillowW,
      railTop - mattressTop - ts * 0.12,
      ts * 0.04,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    const turnX = bedLeft + pillowW + ts * 0.14;
    block(
      ctx,
      turnX,
      mattressTop - ts * 0.02,
      ts * 0.1,
      railTop - mattressTop + ts * 0.06,
      LINEN,
      ts,
      0.6,
    );
    block(
      ctx,
      turnX + ts * 0.1,
      mattressTop - ts * 0.02,
      bedRight - turnX - ts * 0.1,
      railTop - mattressTop + ts * 0.06,
      BLANKET,
      ts,
      0.8,
    );
    litEdge(
      ctx,
      turnX + ts * 0.1,
      mattressTop - ts * 0.02,
      bedRight - turnX - ts * 0.1,
      Math.max(1, ts * 0.025),
      BLANKET_LIGHT,
      0.9,
    );
    // A single ruled stripe across the blanket: even the bedding is square.
    ctx.fillStyle = rgba(LINEN, 0.55);
    ctx.fillRect(
      turnX + ts * 0.1,
      mattressTop + (railTop - mattressTop) * 0.45,
      bedRight - turnX - ts * 0.1,
      Math.max(1, ts * 0.02),
    );
    // The spare blanket, folded square at the foot.
    const foldW = ts * 0.34;
    block(
      ctx,
      bedRight - foldW - ts * 0.04,
      mattressTop - ts * 0.08,
      foldW,
      ts * 0.18,
      BLANKET_LIGHT,
      ts,
      0.6,
    );
    ctx.fillStyle = rgba(BLANKET, 0.8);
    ctx.fillRect(bedRight - foldW - ts * 0.04, mattressTop, foldW, ts * 0.03);
    // The side rail with its pegged tenons.
    block(ctx, left, railTop, right - left, frameBottom - railTop, sampleRamp(wood, 0.52), ts);
    litEdge(ctx, left, railTop, right - left, Math.max(1, ts * 0.025), sampleRamp(wood, 1));
    for (const px of [left + headW * 0.5, right - headW * 0.5]) {
      for (const py of [railTop + ts * 0.06, railTop + ts * 0.15])
        disc(ctx, px, py, Math.max(1, ts * 0.018), sampleRamp(wood, 0.25));
    }
  });
}
