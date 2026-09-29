/**
 * Bespoke furniture for The Quiet Needle, built as a few big composed pieces
 * rather than a scatter of small ones: a wall of flash — framed design sheets
 * over a low cabinet of portfolios — for the waiting room; the padded
 * reclining ink chair the whole alcove is arranged around, with its pigment
 * cabinet of individually painted ink pots, its needle trolley, its arm lamp
 * and the feather-tract charts a shop that takes skyfowl clients needs; a
 * grinding bench for the back room where the pigment is made; and a violet
 * settee, a low table with the flash binder open on it, a side table and a
 * coat stand for the people waiting their turn.
 *
 * The palette is the shopfront's own: ink violet and brass, over black
 * lacquered wood — so the inside of the building names the same wall the sign
 * hangs on.
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
import { getTownRamp, sampleRamp, mix, TOWN_INK, type RGB } from '../../town/townPalette';
type Ctx = CanvasRenderingContext2D;

function contactShadow(ctx: Ctx, frame: TownPropFrame): void {
  const box = footprintBox(frame);
  const radiusX = box.width * 0.42;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.32);
}

function ironRamp() {
  return getTownRamp('iron_black');
}

/** Black-lacquered hardwood: the parlour's furniture, darker than any shared timber ramp. */
const LACQUER_DARK: RGB = [28, 22, 26];
const LACQUER_BODY: RGB = [56, 42, 48];
const LACQUER_LIGHT: RGB = [104, 84, 90];

/** The shopfront's ink violet, carried inside onto the upholstery. */
const VIOLET_DARK: RGB = [58, 30, 72];
const VIOLET_BODY: RGB = [110, 62, 136];
const VIOLET_LIGHT: RGB = [166, 112, 190];
/** A second upholstery, so two settees in one room never read as a copy-paste pair. */
const TEAL_DARK: RGB = [22, 56, 60];
const TEAL_BODY: RGB = [44, 104, 108];
const TEAL_LIGHT: RGB = [96, 158, 156];

/** Oxblood chair leather — the one surface every client lies on. */
const LEATHER_DARK: RGB = [58, 20, 20];
const LEATHER_BODY: RGB = [118, 38, 34];
const LEATHER_LIGHT: RGB = [176, 84, 70];

const BRASS_DIM: RGB = [140, 104, 46];
const BRASS_BRIGHT: RGB = [226, 190, 104];

const LINEN: RGB = [228, 222, 206];
const LINEN_SHADE: RGB = [178, 170, 152];
const PAPER: RGB = [226, 214, 184];
const PAPER_SHADE: RGB = [186, 170, 136];

const FLAME_CORE: RGB = [255, 226, 150];
const FLAME_MID: RGB = [232, 150, 60];

/** Traditional flash colours: a flat bold red, green, yellow and blue under black linework. */
const FLASH_RED: RGB = [186, 40, 36];
const FLASH_GREEN: RGB = [48, 122, 66];
const FLASH_YELLOW: RGB = [230, 180, 48];
const FLASH_BLUE: RGB = [44, 84, 156];
const FLASH_WHITE: RGB = [246, 242, 230];

/** Ground pigments on the shelves — each pot its own colour, so a row reads as stock, not a pattern. */
const LAMP_BLACK: RGB = [22, 20, 24];
const INDIGO: RGB = [36, 58, 128];
const MADDER: RGB = [150, 32, 36];
const VERDIGRIS: RGB = [54, 122, 96];
const OCHRE: RGB = [196, 142, 44];
const PIGMENT_VIOLET: RGB = [112, 52, 140];
const LEAD_WHITE: RGB = [224, 218, 204];
const CINNABAR: RGB = [170, 70, 40];
const PIGMENTS: readonly RGB[] = [
  LAMP_BLACK,
  INDIGO,
  MADDER,
  VERDIGRIS,
  OCHRE,
  PIGMENT_VIOLET,
  LEAD_WHITE,
  CINNABAR,
];
const GLASS_SHINE: RGB = [236, 240, 244];

// ── Shared pieces ─────────────────────────────────────────────────────────

function paintBloom(ctx: Ctx, x: number, y: number, radius: number, color: RGB, alpha: number) {
  const bloom = ctx.createRadialGradient(x, y, 1, x, y, radius);
  bloom.addColorStop(0, rgba(color, alpha));
  bloom.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A lacquered box: a lit top edge, a body, a shaded base line, inked round. */
function paintLacquerBox(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(LACQUER_BODY);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgb(LACQUER_LIGHT);
  ctx.fillRect(x, y, w, ts * 0.05);
  ctx.fillStyle = rgba(LACQUER_DARK, 0.8);
  ctx.fillRect(x, y + h - ts * 0.05, w, ts * 0.05);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

/** A squat glass ink pot with a cork, its ink showing through the glass. */
function paintInkPot(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  ink: RGB,
  ts: number,
): void {
  const neckW = w * 0.5;
  const shoulderY = baseY - h * 0.72;
  ctx.fillStyle = rgb(mix(ink, [200, 210, 214], 0.18));
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY);
  ctx.lineTo(cx - w / 2, shoulderY);
  ctx.quadraticCurveTo(cx - w / 2, shoulderY - h * 0.12, cx - neckW / 2, shoulderY - h * 0.14);
  ctx.lineTo(cx + neckW / 2, shoulderY - h * 0.14);
  ctx.quadraticCurveTo(cx + w / 2, shoulderY - h * 0.12, cx + w / 2, shoulderY);
  ctx.lineTo(cx + w / 2, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(ink);
  ctx.fillRect(cx - w / 2 + 1, shoulderY + h * 0.08, w - 2, baseY - shoulderY - h * 0.1);
  ctx.fillStyle = rgb(mix([176, 132, 84], [120, 84, 50], 0.3));
  ctx.fillRect(cx - neckW * 0.4, shoulderY - h * 0.32, neckW * 0.8, h * 0.2);
  ctx.fillStyle = rgba(GLASS_SHINE, 0.75);
  ctx.fillRect(cx - w * 0.34, shoulderY + h * 0.05, Math.max(1, w * 0.1), h * 0.42);
  ctx.fillStyle = rgb(PAPER);
  ctx.fillRect(cx - w * 0.3, baseY - h * 0.42, w * 0.6, h * 0.2);
}

function paintCandle(ctx: Ctx, cx: number, baseY: number, h: number, ts: number): void {
  const w = ts * 0.06;
  ctx.fillStyle = rgb([226, 212, 178]);
  ctx.fillRect(cx - w / 2, baseY - h, w, h);
  ctx.beginPath();
  ctx.rect(cx - w / 2, baseY - h, w, h);
  inkOutline(ctx, ts * 0.6);
  paintBloom(ctx, cx, baseY - h - ts * 0.05, ts * 0.22, FLAME_MID, 0.45);
  ctx.fillStyle = rgb(FLAME_CORE);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h - ts * 0.05, ts * 0.022, ts * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Flash designs ─────────────────────────────────────────────────────────

type FlashDesign =
  | 'rose'
  | 'dagger_heart'
  | 'snake'
  | 'skull'
  | 'ship'
  | 'sun'
  | 'skyfowl'
  | 'anchor'
  | 'eye'
  | 'moon'
  | 'swallow'
  | 'panther';

/** Two sheets of eight, so the two runs of flash on the waiting-room wall never repeat a design. */
const FLASH_SETS: readonly (readonly FlashDesign[])[] = [
  ['skyfowl', 'rose', 'dagger_heart', 'ship', 'skull', 'snake', 'sun', 'anchor'],
  ['panther', 'eye', 'swallow', 'rose', 'moon', 'dagger_heart', 'skyfowl', 'skull'],
];

function strokeBold(ctx: Ctx, ts: number): void {
  ctx.strokeStyle = rgb(TOWN_INK);
  ctx.lineWidth = Math.max(1, ts * 0.022);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function fillAndInk(ctx: Ctx, color: RGB, ts: number): void {
  ctx.fillStyle = rgb(color);
  ctx.fill();
  strokeBold(ctx, ts);
}

function leaf(ctx: Ctx, x: number, y: number, len: number, angle: number, ts: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.35, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.35, 0, 0);
  fillAndInk(ctx, FLASH_GREEN, ts);
  ctx.restore();
}

function heart(ctx: Ctx, cx: number, cy: number, s: number, ts: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.55);
  ctx.bezierCurveTo(cx - s * 0.9, cy, cx - s * 0.6, cy - s * 0.65, cx, cy - s * 0.25);
  ctx.bezierCurveTo(cx + s * 0.6, cy - s * 0.65, cx + s * 0.9, cy, cx, cy + s * 0.55);
  fillAndInk(ctx, FLASH_RED, ts);
  ctx.fillStyle = rgba(FLASH_WHITE, 0.8);
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.3, cy - s * 0.2, s * 0.08, s * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * One design drawn inside a sheet's picture area (`cx`,`cy` its centre, `s`
 * its half-size). Bold outline, flat colour, one white highlight — the
 * traditional flash look, and the only style that stays legible at the
 * size a sheet is on the wall.
 */
function paintFlashDesign(
  ctx: Ctx,
  design: FlashDesign,
  cx: number,
  cy: number,
  s: number,
  ts: number,
): void {
  switch (design) {
    case 'rose': {
      leaf(ctx, cx - s * 0.2, cy + s * 0.35, s * 0.6, Math.PI * 0.85, ts);
      leaf(ctx, cx + s * 0.2, cy + s * 0.35, s * 0.6, Math.PI * 0.15, ts);
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.05, s * 0.5, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_RED, ts);
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.1, s * 0.28, Math.PI * 0.1, Math.PI * 1.7);
      strokeBold(ctx, ts);
      ctx.beginPath();
      ctx.arc(cx + s * 0.05, cy - s * 0.05, s * 0.12, Math.PI, Math.PI * 2.6);
      strokeBold(ctx, ts);
      break;
    }
    case 'dagger_heart': {
      heart(ctx, cx, cy + s * 0.05, s * 0.75, ts);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.08, cy - s * 0.55);
      ctx.lineTo(cx, cy + s * 0.95);
      ctx.lineTo(cx + s * 0.08, cy - s * 0.55);
      ctx.closePath();
      fillAndInk(ctx, [206, 210, 216], ts);
      ctx.beginPath();
      ctx.rect(cx - s * 0.3, cy - s * 0.62, s * 0.6, s * 0.1);
      fillAndInk(ctx, FLASH_YELLOW, ts);
      ctx.beginPath();
      ctx.rect(cx - s * 0.06, cy - s * 0.95, s * 0.12, s * 0.33);
      fillAndInk(ctx, [92, 56, 36], ts);
      break;
    }
    case 'snake': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy + s * 0.7);
      ctx.bezierCurveTo(
        cx + s * 0.9,
        cy + s * 0.6,
        cx - s * 0.9,
        cy - s * 0.1,
        cx + s * 0.4,
        cy - s * 0.5,
      );
      ctx.strokeStyle = rgb(TOWN_INK);
      ctx.lineWidth = s * 0.34;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = rgb(FLASH_GREEN);
      ctx.lineWidth = s * 0.22;
      ctx.stroke();
      ctx.strokeStyle = rgb(FLASH_YELLOW);
      ctx.lineWidth = s * 0.06;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.5, cy - s * 0.55, s * 0.24, s * 0.17, -0.4, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_GREEN, ts);
      ctx.strokeStyle = rgb(FLASH_RED);
      ctx.lineWidth = Math.max(1, ts * 0.015);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.72, cy - s * 0.62);
      ctx.lineTo(cx + s * 0.92, cy - s * 0.72);
      ctx.stroke();
      break;
    }
    case 'skull': {
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.15, s * 0.55, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(cx + s * 0.32, cy + s * 0.55);
      ctx.lineTo(cx - s * 0.32, cy + s * 0.55);
      ctx.closePath();
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.fillStyle = rgb(TOWN_INK);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * s * 0.22, cy - s * 0.1, s * 0.15, s * 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.1);
      ctx.lineTo(cx - s * 0.07, cy + s * 0.25);
      ctx.lineTo(cx + s * 0.07, cy + s * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgb(TOWN_INK);
      ctx.lineWidth = Math.max(1, ts * 0.012);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * s * 0.1, cy + s * 0.35);
        ctx.lineTo(cx + i * s * 0.1, cy + s * 0.55);
        ctx.stroke();
      }
      break;
    }
    case 'ship': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.85, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.85, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.55, cy + s * 0.7);
      ctx.lineTo(cx - s * 0.6, cy + s * 0.7);
      ctx.closePath();
      fillAndInk(ctx, [110, 64, 38], ts);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.05, cy + s * 0.25);
      ctx.lineTo(cx - s * 0.05, cy - s * 0.85);
      ctx.lineTo(cx - s * 0.65, cy + s * 0.15);
      ctx.closePath();
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.05, cy + s * 0.25);
      ctx.lineTo(cx + s * 0.05, cy - s * 0.65);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.15);
      ctx.closePath();
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.05, cy - s * 0.85);
      ctx.lineTo(cx + s * 0.3, cy - s * 0.78);
      ctx.lineTo(cx - s * 0.05, cy - s * 0.7);
      ctx.closePath();
      fillAndInk(ctx, FLASH_RED, ts);
      ctx.strokeStyle = rgb(FLASH_BLUE);
      ctx.lineWidth = Math.max(1, ts * 0.03);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.95, cy + s * 0.82);
      ctx.quadraticCurveTo(cx - s * 0.5, cy + s * 0.65, cx, cy + s * 0.82);
      ctx.quadraticCurveTo(cx + s * 0.5, cy + s * 0.98, cx + s * 0.95, cy + s * 0.8);
      ctx.stroke();
      break;
    }
    case 'sun': {
      const rays = 12;
      ctx.beginPath();
      for (let i = 0; i < rays * 2; i++) {
        const a = (i / (rays * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? s * 0.92 : s * 0.55;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      fillAndInk(ctx, FLASH_RED, ts);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.48, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_YELLOW, ts);
      ctx.fillStyle = rgb(TOWN_INK);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + side * s * 0.16, cy - s * 0.08, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.2, Math.PI * 0.15, Math.PI * 0.85);
      strokeBold(ctx, ts);
      break;
    }
    case 'skyfowl': {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.05);
        ctx.quadraticCurveTo(
          cx + side * s * 0.5,
          cy - s * 0.85,
          cx + side * s * 0.98,
          cy - s * 0.55,
        );
        ctx.lineTo(cx + side * s * 0.78, cy - s * 0.35);
        ctx.lineTo(cx + side * s * 0.9, cy - s * 0.18);
        ctx.lineTo(cx + side * s * 0.62, cy - s * 0.05);
        ctx.lineTo(cx + side * s * 0.7, cy + s * 0.12);
        ctx.quadraticCurveTo(cx + side * s * 0.3, cy + s * 0.15, cx, cy + s * 0.2);
        ctx.closePath();
        fillAndInk(ctx, FLASH_BLUE, ts);
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.18, s * 0.17, s * 0.42, 0, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.3, s * 0.16, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.06, cy - s * 0.25);
      ctx.lineTo(cx, cy - s * 0.08);
      ctx.lineTo(cx + s * 0.06, cy - s * 0.25);
      ctx.closePath();
      fillAndInk(ctx, FLASH_YELLOW, ts);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, cy + s * 0.55);
      ctx.lineTo(cx, cy + s * 0.9);
      ctx.lineTo(cx + s * 0.2, cy + s * 0.55);
      ctx.closePath();
      fillAndInk(ctx, FLASH_BLUE, ts);
      break;
    }
    case 'anchor': {
      ctx.strokeStyle = rgb(TOWN_INK);
      ctx.lineWidth = s * 0.26;
      ctx.lineCap = 'round';
      const drawAnchor = () => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.6);
        ctx.lineTo(cx, cy + s * 0.75);
        ctx.moveTo(cx - s * 0.4, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.4, cy - s * 0.35);
        ctx.moveTo(cx - s * 0.7, cy + s * 0.3);
        ctx.quadraticCurveTo(cx - s * 0.5, cy + s * 0.85, cx, cy + s * 0.75);
        ctx.quadraticCurveTo(cx + s * 0.5, cy + s * 0.85, cx + s * 0.7, cy + s * 0.3);
        ctx.stroke();
      };
      drawAnchor();
      ctx.strokeStyle = rgb(FLASH_BLUE);
      ctx.lineWidth = s * 0.14;
      drawAnchor();
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.75, s * 0.16, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.1;
      strokeBold(ctx, ts);
      ctx.strokeStyle = rgb(FLASH_RED);
      ctx.lineWidth = Math.max(1, ts * 0.02);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.5, cy - s * 0.1);
      ctx.quadraticCurveTo(cx, cy + s * 0.2, cx + s * 0.5, cy - s * 0.05);
      ctx.stroke();
      break;
    }
    case 'eye': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.9, cy);
      ctx.quadraticCurveTo(cx, cy - s * 0.75, cx + s * 0.9, cy);
      ctx.quadraticCurveTo(cx, cy + s * 0.75, cx - s * 0.9, cy);
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_GREEN, ts);
      ctx.fillStyle = rgb(TOWN_INK);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(FLASH_WHITE);
      ctx.beginPath();
      ctx.arc(cx - s * 0.08, cy - s * 0.08, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, cy + s * 0.5);
      ctx.quadraticCurveTo(cx - s * 0.25, cy + s * 0.75, cx - s * 0.12, cy + s * 0.9);
      ctx.quadraticCurveTo(cx - s * 0.02, cy + s * 0.72, cx - s * 0.2, cy + s * 0.5);
      fillAndInk(ctx, FLASH_BLUE, ts);
      break;
    }
    case 'moon': {
      ctx.beginPath();
      ctx.arc(cx - s * 0.1, cy, s * 0.72, Math.PI * 0.35, Math.PI * 1.65);
      ctx.arc(cx + s * 0.2, cy - s * 0.05, s * 0.55, Math.PI * 1.45, Math.PI * 0.55, true);
      ctx.closePath();
      fillAndInk(ctx, FLASH_YELLOW, ts);
      const star = (sx: number, sy: number, r: number) => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
          const rr = i % 2 === 0 ? r : r * 0.45;
          const px = sx + Math.cos(a) * rr;
          const py = sy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        fillAndInk(ctx, FLASH_RED, ts);
      };
      star(cx + s * 0.5, cy - s * 0.45, s * 0.28);
      star(cx + s * 0.6, cy + s * 0.4, s * 0.2);
      break;
    }
    case 'swallow': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.9, cy - s * 0.4);
      ctx.quadraticCurveTo(cx - s * 0.2, cy - s * 0.3, cx, cy);
      ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.6, cx + s * 0.9, cy - s * 0.7);
      ctx.quadraticCurveTo(cx + s * 0.4, cy + s * 0.05, cx + s * 0.15, cy + s * 0.35);
      ctx.lineTo(cx + s * 0.35, cy + s * 0.85);
      ctx.lineTo(cx, cy + s * 0.5);
      ctx.lineTo(cx - s * 0.3, cy + s * 0.8);
      ctx.lineTo(cx - s * 0.15, cy + s * 0.3);
      ctx.quadraticCurveTo(cx - s * 0.4, cy - s * 0.05, cx - s * 0.9, cy - s * 0.4);
      fillAndInk(ctx, FLASH_BLUE, ts);
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.12, s * 0.15, s * 0.22, 0, 0, Math.PI * 2);
      fillAndInk(ctx, FLASH_RED, ts);
      break;
    }
    case 'panther': {
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.6, cy - s * 0.35);
      ctx.lineTo(cx - s * 0.45, cy - s * 0.85);
      ctx.lineTo(cx - s * 0.2, cy - s * 0.55);
      ctx.lineTo(cx + s * 0.2, cy - s * 0.55);
      ctx.lineTo(cx + s * 0.45, cy - s * 0.85);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.35);
      ctx.quadraticCurveTo(cx + s * 0.7, cy + s * 0.4, cx, cy + s * 0.75);
      ctx.quadraticCurveTo(cx - s * 0.7, cy + s * 0.4, cx - s * 0.6, cy - s * 0.35);
      fillAndInk(ctx, [40, 36, 44], ts);
      ctx.fillStyle = rgb(FLASH_YELLOW);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          cx + side * s * 0.25,
          cy - s * 0.15,
          s * 0.12,
          s * 0.07,
          side * 0.3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.25, cy + s * 0.3);
      ctx.lineTo(cx - s * 0.15, cy + s * 0.7);
      ctx.lineTo(cx - s * 0.05, cy + s * 0.32);
      ctx.moveTo(cx + s * 0.25, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.15, cy + s * 0.7);
      ctx.lineTo(cx + s * 0.05, cy + s * 0.32);
      fillAndInk(ctx, FLASH_WHITE, ts);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.12, cy + s * 0.18);
      ctx.lineTo(cx + s * 0.12, cy + s * 0.18);
      ctx.lineTo(cx, cy + s * 0.3);
      ctx.closePath();
      fillAndInk(ctx, FLASH_RED, ts);
      break;
    }
  }
}

/** One design sheet: cream paper, a pin, the design, and a pencilled price line underneath. */
function paintFlashSheet(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  design: FlashDesign,
  tilt: number,
  ts: number,
): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(tilt);
  ctx.fillStyle = rgba(TOWN_INK, 0.35);
  ctx.fillRect(-w / 2 + ts * 0.03, -h / 2 + ts * 0.03, w, h);
  ctx.fillStyle = rgb(PAPER);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = rgba(PAPER_SHADE, 0.6);
  ctx.fillRect(-w / 2, h / 2 - h * 0.12, w, h * 0.12);
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  inkOutline(ctx, ts * 0.8);
  const artSize = Math.min(w, h * 0.8) * 0.4;
  paintFlashDesign(ctx, design, 0, -h * 0.07, artSize, ts);
  ctx.strokeStyle = rgba(TOWN_INK, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w * 0.28, h / 2 - h * 0.08);
  ctx.lineTo(w * 0.12, h / 2 - h * 0.08);
  ctx.stroke();
  ctx.fillStyle = rgb(FLASH_RED);
  ctx.beginPath();
  ctx.arc(0, -h / 2 + ts * 0.03, ts * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Flash wall ────────────────────────────────────────────────────────────

/**
 * The waiting room's centrepiece: a lacquered board of framed flash, two
 * rows of design sheets per tile, over a low cabinet of portfolio drawers
 * with the day's binders and a candle on top. Four tiles wide; two variants
 * carry two different sets of designs so a run of two never repeats.
 */
export function paintFlashWall(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);

    const boardLeft = box.left + ts * 0.06;
    const boardRight = box.right - ts * 0.06;
    const boardTop = box.top - ts * 1.02;
    const boardBottom = box.top + ts * 0.42;
    ctx.fillStyle = rgb(LACQUER_DARK);
    ctx.fillRect(boardLeft, boardTop, boardRight - boardLeft, boardBottom - boardTop);
    ctx.fillStyle = rgb(VIOLET_DARK);
    const inset = ts * 0.07;
    ctx.fillRect(
      boardLeft + inset,
      boardTop + inset,
      boardRight - boardLeft - inset * 2,
      boardBottom - boardTop - inset * 2,
    );
    ctx.beginPath();
    ctx.rect(boardLeft, boardTop, boardRight - boardLeft, boardBottom - boardTop);
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgb(BRASS_DIM);
    ctx.lineWidth = ts * 0.02;
    ctx.strokeRect(
      boardLeft + inset * 0.5,
      boardTop + inset * 0.5,
      boardRight - boardLeft - inset,
      boardBottom - boardTop - inset,
    );

    const designs = FLASH_SETS[variant % FLASH_SETS.length];
    const columns = frame.footprintW;
    const rows = 2;
    const sheetW = ts * 0.7;
    const sheetH = ts * 0.6;
    const rowGap = (boardBottom - boardTop - inset * 2 - sheetH * rows) / (rows + 1);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const design = designs[(row * columns + col) % designs.length];
        const sx = box.left + col * ts + (ts - sheetW) / 2 + jitter(forkRng(rng), ts * 0.03);
        const sy = boardTop + inset + rowGap * (row + 1) + row * sheetH;
        paintFlashSheet(ctx, sx, sy, sheetW, sheetH, design, jitter(forkRng(rng), 0.05), ts);
      }
    }

    // The portfolio cabinet underneath, and what sits on it.
    const cabTop = box.top + ts * 0.42;
    const cabBottom = box.bottom - ts * 0.04;
    paintLacquerBox(
      ctx,
      box.left + ts * 0.04,
      cabTop,
      box.width - ts * 0.08,
      cabBottom - cabTop,
      ts,
    );
    const drawerCount = columns * 2;
    const drawerW = (box.width - ts * 0.2) / drawerCount;
    for (let i = 0; i < drawerCount; i++) {
      const dx = box.left + ts * 0.1 + i * drawerW;
      ctx.strokeStyle = rgba(TOWN_INK, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 1, cabTop + ts * 0.1, drawerW - 2, cabBottom - cabTop - ts * 0.16);
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      ctx.fillRect(dx + drawerW / 2 - ts * 0.03, cabTop + ts * 0.22, ts * 0.06, ts * 0.03);
    }
    const binderColors: readonly RGB[] = [VIOLET_BODY, [40, 40, 44], FLASH_RED, TEAL_BODY];
    const binderStackX = box.left + ts * (variant % 2 === 0 ? 0.3 : 2.4);
    for (let i = 0; i < 3; i++) {
      const bh = ts * 0.05;
      const bw = ts * (0.5 - i * 0.04);
      ctx.fillStyle = rgb(binderColors[(i + variant) % binderColors.length]);
      ctx.beginPath();
      ctx.rect(binderStackX + i * ts * 0.02, cabTop - bh * (i + 1), bw, bh);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
    paintCandle(ctx, box.left + ts * (variant % 2 === 0 ? 3.55 : 0.45), cabTop, ts * 0.2, ts);
    paintInkPot(ctx, box.left + ts * 1.5, cabTop, ts * 0.12, ts * 0.14, INDIGO, ts);
  });
}

// ── Ink chair ─────────────────────────────────────────────────────────────

/**
 * The alcove's centrepiece: a padded reclining chair on an iron pedestal,
 * seen side-on — the backrest raised at the west end under a folded towel,
 * the seat, and the leg rest dropping away east — in button-tufted oxblood
 * leather, with a padded arm board swung out for the client's arm.
 */
export function paintInkChair(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.1,
      box.width * 0.46,
      ts * 0.2,
      0.36,
    );
    const iron = ironRamp();

    // Pedestal and foot plate.
    const plateY = box.bottom - ts * 0.1;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
    ctx.beginPath();
    ctx.ellipse(box.centreX, plateY, ts * 0.55, ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const seatY = box.bottom - ts * 0.62;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    ctx.fillRect(box.centreX - ts * 0.09, seatY + ts * 0.12, ts * 0.18, plateY - seatY - ts * 0.12);
    ctx.beginPath();
    ctx.rect(box.centreX - ts * 0.09, seatY + ts * 0.12, ts * 0.18, plateY - seatY - ts * 0.12);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(BRASS_BRIGHT, 0.7);
    ctx.fillRect(box.centreX - ts * 0.06, seatY + ts * 0.18, ts * 0.03, plateY - seatY - ts * 0.3);
    // Hydraulic foot pump.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.6));
    ctx.fillRect(box.centreX + ts * 0.12, plateY - ts * 0.12, ts * 0.22, ts * 0.05);

    // The padded body: backrest (raised, west), seat, leg rest (dropping, east).
    const thickness = ts * 0.2;
    const backTopX = box.left + ts * 0.14;
    const backTopY = seatY - ts * 0.55;
    const seatStartX = box.left + ts * 0.95;
    const seatEndX = box.right - ts * 0.95;
    const legEndX = box.right - ts * 0.14;
    const legEndY = seatY + ts * 0.22;
    const top: ReadonlyArray<readonly [number, number]> = [
      [backTopX, backTopY],
      [seatStartX, seatY],
      [seatEndX, seatY],
      [legEndX, legEndY],
    ];

    // Iron frame rail under the padding.
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.3));
    ctx.lineWidth = ts * 0.06;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    top.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px + ts * 0.05, py + thickness + ts * 0.04);
      else ctx.lineTo(px, py + thickness + ts * 0.04);
    });
    ctx.stroke();

    ctx.beginPath();
    top.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    for (let i = top.length - 1; i >= 0; i--) {
      const [px, py] = top[i];
      ctx.lineTo(px, py + thickness);
    }
    ctx.closePath();
    const leather = ctx.createLinearGradient(0, seatY - ts * 0.5, 0, seatY + thickness);
    leather.addColorStop(0, rgb(LEATHER_LIGHT));
    leather.addColorStop(0.5, rgb(LEATHER_BODY));
    leather.addColorStop(1, rgb(LEATHER_DARK));
    ctx.fillStyle = leather;
    ctx.fill();
    inkOutline(ctx, ts);

    // Seams between the three pads, and the lit top edge.
    ctx.strokeStyle = rgba(LEATHER_DARK, 0.9);
    ctx.lineWidth = ts * 0.02;
    for (const [px, py] of [top[1], top[2]]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + thickness);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(LEATHER_LIGHT, 0.9);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    top.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py + 2) : ctx.lineTo(px, py + 2)));
    ctx.stroke();

    // Button tufting along each pad's midline.
    ctx.fillStyle = rgb(LEATHER_DARK);
    for (let seg = 0; seg < top.length - 1; seg++) {
      const [ax, ay] = top[seg];
      const [bx, by] = top[seg + 1];
      const buttons = 3;
      for (let b = 1; b <= buttons; b++) {
        const t = b / (buttons + 1);
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t + thickness * 0.5;
        ctx.beginPath();
        ctx.arc(px, py, ts * 0.018, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Headrest pillow and a folded towel over it.
    ctx.fillStyle = rgb(LEATHER_BODY);
    ctx.beginPath();
    ctx.ellipse(
      backTopX + ts * 0.08,
      backTopY - ts * 0.02,
      ts * 0.16,
      ts * 0.1,
      -0.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(LINEN);
    ctx.beginPath();
    ctx.moveTo(backTopX + ts * 0.18, backTopY + ts * 0.02);
    ctx.lineTo(backTopX + ts * 0.5, backTopY + ts * 0.22);
    ctx.lineTo(backTopX + ts * 0.46, backTopY + ts * 0.42);
    ctx.lineTo(backTopX + ts * 0.14, backTopY + ts * 0.22);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(LINEN_SHADE);
    ctx.beginPath();
    ctx.moveTo(backTopX + ts * 0.46, backTopY + ts * 0.42);
    ctx.lineTo(backTopX + ts * 0.5, backTopY + ts * 0.22);
    ctx.lineTo(backTopX + ts * 0.54, backTopY + ts * 0.26);
    ctx.lineTo(backTopX + ts * 0.5, backTopY + ts * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgb(FLASH_RED);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(backTopX + ts * 0.2, backTopY + ts * 0.1);
    ctx.lineTo(backTopX + ts * 0.48, backTopY + ts * 0.28);
    ctx.stroke();

    // The arm board, swung out towards the viewer on its own post.
    const armX = seatStartX + ts * 0.2;
    const armY = seatY + ts * 0.12;
    const armW = ts * 0.75;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
    ctx.fillRect(armX + armW * 0.45, armY + ts * 0.08, ts * 0.05, ts * 0.22);
    ctx.fillStyle = rgb(LEATHER_BODY);
    ctx.beginPath();
    ctx.rect(armX, armY, armW, ts * 0.09);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(LEATHER_LIGHT, 0.8);
    ctx.fillRect(armX + 2, armY + 1, armW - 4, ts * 0.025);
    // A drop of spilled ink on the leg-rest, never quite wiped.
    ctx.fillStyle = rgba(LAMP_BLACK, 0.8);
    ctx.beginPath();
    ctx.ellipse(
      seatEndX + ts * 0.35 + jitter(rng, ts * 0.05),
      seatY + ts * 0.12,
      ts * 0.04,
      ts * 0.025,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  });
}

// ── Pigment cabinet ───────────────────────────────────────────────────────

/**
 * A lacquered open cabinet against the alcove wall: three shelves of squat
 * glass ink pots, every one its own pigment and label, a cornice with a
 * brass needle-and-drop crest, and a cupboard base with the slate of rates
 * propped against it.
 */
export function paintPigmentCabinet(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const left = box.left + ts * 0.05;
    const right = box.right - ts * 0.05;
    const top = box.top - ts * 0.98;
    const baseTop = box.top + ts * 0.4;
    const bottom = box.bottom - ts * 0.04;

    // Carcass and dark back.
    ctx.fillStyle = rgb(LACQUER_BODY);
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    inkOutline(ctx, ts);
    const side = ts * 0.08;
    ctx.fillStyle = rgb(LACQUER_DARK);
    ctx.fillRect(left + side, top + ts * 0.16, right - left - side * 2, baseTop - top - ts * 0.16);
    ctx.fillStyle = rgba(LACQUER_LIGHT, 0.8);
    ctx.fillRect(left, top, ts * 0.03, bottom - top);

    // Cornice with crest.
    ctx.fillStyle = rgb(LACQUER_LIGHT);
    ctx.fillRect(left - 1, top, right - left + 2, ts * 0.1);
    ctx.beginPath();
    ctx.rect(left - 1, top, right - left + 2, ts * 0.1);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.moveTo(box.centreX, top + ts * 0.02);
    ctx.quadraticCurveTo(box.centreX + ts * 0.09, top + ts * 0.14, box.centreX, top + ts * 0.2);
    ctx.quadraticCurveTo(box.centreX - ts * 0.09, top + ts * 0.14, box.centreX, top + ts * 0.02);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);

    // Three shelves of pots.
    const shelfCount = 3;
    const shelfSpan = (baseTop - top - ts * 0.16) / shelfCount;
    for (let s = 0; s < shelfCount; s++) {
      const shelfY = top + ts * 0.16 + shelfSpan * (s + 1);
      let x = left + side + ts * 0.08;
      let i = 0;
      while (x < right - side - ts * 0.1) {
        const potRng = forkRng(rng);
        const w = ts * (0.13 + jitter(potRng, 0.02));
        const h = ts * (0.17 + jitter(potRng, 0.04));
        const ink = PIGMENTS[(s * 5 + i * 3 + Math.floor(potRng() * 3)) % PIGMENTS.length];
        if (x + w > right - side - ts * 0.04) break;
        paintInkPot(ctx, x + w / 2, shelfY - ts * 0.03, w, h, ink, ts);
        x += w + ts * (0.04 + potRng() * 0.03);
        i++;
      }
      ctx.fillStyle = rgb(LACQUER_LIGHT);
      ctx.fillRect(left + side, shelfY - ts * 0.03, right - left - side * 2, ts * 0.05);
      ctx.fillStyle = rgba(TOWN_INK, 0.5);
      ctx.fillRect(left + side, shelfY + ts * 0.02, right - left - side * 2, ts * 0.02);
    }

    // Cupboard base.
    paintLacquerBox(ctx, left, baseTop, right - left, bottom - baseTop, ts);
    const doors = frame.footprintW;
    const doorW = (right - left - ts * 0.12) / doors;
    for (let d = 0; d < doors; d++) {
      const dx = left + ts * 0.06 + d * doorW;
      ctx.strokeStyle = rgba(TOWN_INK, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 2, baseTop + ts * 0.1, doorW - 4, bottom - baseTop - ts * 0.16);
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      ctx.beginPath();
      ctx.arc(dx + doorW / 2, baseTop + ts * 0.26, ts * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }

    // The slate of rates, propped against the base, lettered in four inks.
    const slateW = ts * 0.52;
    const slateH = ts * 0.4;
    const slateX = right - slateW - ts * 0.12;
    const slateY = bottom - slateH - ts * 0.01;
    ctx.fillStyle = rgb([92, 70, 50]);
    ctx.fillRect(slateX - ts * 0.03, slateY - ts * 0.03, slateW + ts * 0.06, slateH + ts * 0.06);
    ctx.fillStyle = rgb([40, 44, 48]);
    ctx.fillRect(slateX, slateY, slateW, slateH);
    ctx.beginPath();
    ctx.rect(slateX - ts * 0.03, slateY - ts * 0.03, slateW + ts * 0.06, slateH + ts * 0.06);
    inkOutline(ctx, ts);
    const letterInks: readonly RGB[] = [FLASH_WHITE, FLASH_YELLOW, FLASH_RED, [140, 180, 220]];
    ctx.lineWidth = Math.max(1, ts * 0.018);
    letterInks.forEach((ink, row) => {
      ctx.strokeStyle = rgb(ink);
      const ly = slateY + slateH * (0.2 + row * 0.2);
      ctx.beginPath();
      ctx.moveTo(slateX + slateW * 0.12, ly);
      ctx.lineTo(slateX + slateW * (0.55 + (row % 2) * 0.15), ly);
      ctx.stroke();
    });
  });
}

// ── Needle trolley ────────────────────────────────────────────────────────

/**
 * A two-tier iron trolley on casters: a tray of ink caps in four colours, a
 * fan of needles bound on their sticks, a folded cloth and a stoppered bottle
 * on top; a roll of linen and a basin on the shelf below.
 */
export function paintNeedleTray(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const iron = ironRamp();
    const left = box.left + ts * 0.12;
    const right = box.right - ts * 0.12;
    const trayY = box.bottom - ts * 0.72;
    const shelfY = box.bottom - ts * 0.3;

    ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
    ctx.lineWidth = ts * 0.04;
    for (const x of [left + ts * 0.04, right - ts * 0.04]) {
      ctx.beginPath();
      ctx.moveTo(x, trayY);
      ctx.lineTo(x, box.bottom - ts * 0.1);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(iron, 0.25));
    for (const x of [left + ts * 0.04, right - ts * 0.04]) {
      ctx.beginPath();
      ctx.arc(x, box.bottom - ts * 0.07, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
    }

    // Lower shelf: a basin and a roll of linen.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.fillRect(left, shelfY, right - left, ts * 0.05);
    ctx.beginPath();
    ctx.rect(left, shelfY, right - left, ts * 0.05);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb([196, 200, 204]);
    ctx.beginPath();
    ctx.ellipse(left + ts * 0.18, shelfY - ts * 0.05, ts * 0.14, ts * 0.06, 0, 0, Math.PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(LINEN);
    ctx.beginPath();
    ctx.ellipse(right - ts * 0.16, shelfY - ts * 0.07, ts * 0.12, ts * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);

    // Top tray with raised lip.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.7));
    ctx.fillRect(left - ts * 0.04, trayY, right - left + ts * 0.08, ts * 0.07);
    ctx.beginPath();
    ctx.rect(left - ts * 0.04, trayY, right - left + ts * 0.08, ts * 0.07);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba([240, 240, 240], 0.6);
    ctx.fillRect(left - ts * 0.02, trayY + 1, right - left + ts * 0.04, ts * 0.015);

    const capInks: readonly RGB[] = [LAMP_BLACK, FLASH_RED, FLASH_GREEN, FLASH_BLUE];
    capInks.forEach((ink, i) => {
      const cx = left + ts * (0.06 + i * 0.1);
      ctx.fillStyle = rgb([220, 220, 214]);
      ctx.beginPath();
      ctx.rect(cx - ts * 0.035, trayY - ts * 0.07, ts * 0.07, ts * 0.07);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.fillStyle = rgb(ink);
      ctx.fillRect(cx - ts * 0.025, trayY - ts * 0.068, ts * 0.05, ts * 0.02);
    });
    const bottleX = right - ts * 0.06;
    ctx.fillStyle = rgb([70, 104, 90]);
    ctx.beginPath();
    ctx.rect(bottleX - ts * 0.05, trayY - ts * 0.2, ts * 0.1, ts * 0.2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb([150, 110, 70]);
    ctx.fillRect(bottleX - ts * 0.025, trayY - ts * 0.26, ts * 0.05, ts * 0.06);
    ctx.fillStyle = rgba(GLASS_SHINE, 0.7);
    ctx.fillRect(bottleX - ts * 0.035, trayY - ts * 0.18, 1, ts * 0.12);

    // Needles on their sticks, fanned against the bottle.
    const needleCount = 4;
    for (let i = 0; i < needleCount; i++) {
      const nx = left + ts * (0.2 + i * 0.07) + jitter(forkRng(rng), ts * 0.01);
      ctx.strokeStyle = rgb([128, 92, 60]);
      ctx.lineWidth = ts * 0.025;
      ctx.beginPath();
      ctx.moveTo(nx, trayY - ts * 0.01);
      ctx.lineTo(nx + ts * 0.08, trayY - ts * 0.3);
      ctx.stroke();
      ctx.strokeStyle = rgb([214, 218, 224]);
      ctx.lineWidth = Math.max(1, ts * 0.01);
      ctx.beginPath();
      ctx.moveTo(nx + ts * 0.08, trayY - ts * 0.3);
      ctx.lineTo(nx + ts * 0.1, trayY - ts * 0.38);
      ctx.stroke();
    }
  });
}

// ── Feather-tract charts ──────────────────────────────────────────────────

/** A wing pinned open on a chart: primaries fanned, coverts in rows, each tract ruled off in its own colour. */
function paintWingChart(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  const rootX = x + w * 0.2;
  const rootY = y + h * 0.35;
  const primaries = 7;
  for (let i = 0; i < primaries; i++) {
    const a = -0.25 + (i / (primaries - 1)) * 1.25;
    const len = w * (0.72 - i * 0.05);
    const tipX = rootX + Math.cos(a) * len;
    const tipY = rootY + Math.sin(a) * len * 0.8;
    ctx.fillStyle = rgb(mix([220, 214, 200], [120, 110, 100], i / primaries));
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.quadraticCurveTo(
      (rootX + tipX) / 2 + ts * 0.03,
      (rootY + tipY) / 2 - ts * 0.04,
      tipX,
      tipY,
    );
    ctx.quadraticCurveTo(
      (rootX + tipX) / 2 - ts * 0.02,
      (rootY + tipY) / 2 + ts * 0.03,
      rootX,
      rootY,
    );
    ctx.fill();
    ctx.strokeStyle = rgba(TOWN_INK, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const tractInks: readonly RGB[] = [FLASH_RED, FLASH_BLUE, FLASH_GREEN];
  tractInks.forEach((ink, i) => {
    ctx.strokeStyle = rgb(ink);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    ctx.beginPath();
    ctx.arc(rootX, rootY, w * (0.22 + i * 0.16), -0.3, 0.9);
    ctx.stroke();
  });
}

/** A skyfowl drawn front-on with its body's feather tracts shaded in, the lines a needle must follow. */
function paintBodyChart(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  const cx = x + w / 2;
  ctx.fillStyle = rgb([232, 226, 212]);
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.24, w * 0.16, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(TOWN_INK);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = rgb(FLASH_YELLOW);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.05, y + h * 0.27);
  ctx.lineTo(cx, y + h * 0.37);
  ctx.lineTo(cx + w * 0.05, y + h * 0.27);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb([232, 226, 212]);
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.6, w * 0.26, h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const bands: readonly RGB[] = [FLASH_RED, FLASH_BLUE, FLASH_GREEN, FLASH_RED];
  bands.forEach((ink, i) => {
    ctx.strokeStyle = rgba(ink, 0.85);
    ctx.lineWidth = Math.max(1, ts * 0.016);
    ctx.beginPath();
    const by = y + h * (0.46 + i * 0.08);
    ctx.moveTo(cx - w * 0.22, by);
    ctx.quadraticCurveTo(cx, by + h * 0.05, cx + w * 0.22, by);
    ctx.stroke();
  });
  ctx.strokeStyle = rgba(TOWN_INK, 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const ly = y + h * (0.9 + i * 0.03);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.15, ly);
    ctx.lineTo(x + w * (0.55 + i * 0.1), ly);
    ctx.stroke();
  }
}

/**
 * Two pinned charts on the alcove wall — a whole skyfowl front-on with its
 * body tracts ruled in, and a wing fanned open — over a narrow washstand
 * with a basin, a ewer and folded towels: the reference a groundfolk needle
 * guide has no equivalent of, beside the one place in the alcove to scrub up.
 */
export function paintFeatherChart(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);

    const sheetTop = box.top - ts * 0.96;
    const sheetH = ts * 0.92;
    const bodyW = ts * 0.72;
    const wingW = box.width - bodyW - ts * 0.3;
    const bodyX = box.left + ts * 0.1;
    const wingX = bodyX + bodyW + ts * 0.1;
    for (const [sx, sw, tilt] of [
      [bodyX, bodyW, -0.03],
      [wingX, wingW, 0.025],
    ] as const) {
      ctx.save();
      ctx.translate(sx + sw / 2, sheetTop + sheetH / 2);
      ctx.rotate(tilt + jitter(forkRng(rng), 0.01));
      ctx.fillStyle = rgba(TOWN_INK, 0.3);
      ctx.fillRect(-sw / 2 + ts * 0.03, -sheetH / 2 + ts * 0.03, sw, sheetH);
      ctx.fillStyle = rgb(PAPER);
      ctx.fillRect(-sw / 2, -sheetH / 2, sw, sheetH);
      ctx.beginPath();
      ctx.rect(-sw / 2, -sheetH / 2, sw, sheetH);
      inkOutline(ctx, ts);
      if (sx === bodyX) paintBodyChart(ctx, -sw / 2, -sheetH / 2, sw, sheetH, ts);
      else paintWingChart(ctx, -sw / 2, -sheetH / 2, sw, sheetH, ts);
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      for (const px of [-sw / 2 + ts * 0.06, sw / 2 - ts * 0.06]) {
        ctx.beginPath();
        ctx.arc(px, -sheetH / 2 + ts * 0.05, ts * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // The washstand beneath.
    const standTop = box.top + ts * 0.35;
    const standLeft = box.left + ts * 0.2;
    const standRight = box.right - ts * 0.2;
    paintLacquerBox(
      ctx,
      standLeft,
      standTop,
      standRight - standLeft,
      box.bottom - ts * 0.04 - standTop,
      ts,
    );
    ctx.fillStyle = rgb([210, 214, 216]);
    ctx.beginPath();
    ctx.ellipse(standLeft + ts * 0.42, standTop, ts * 0.26, ts * 0.08, 0, 0, Math.PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb([150, 170, 180]);
    ctx.beginPath();
    ctx.ellipse(
      standLeft + ts * 0.42,
      standTop + ts * 0.01,
      ts * 0.2,
      ts * 0.04,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // Ewer.
    const ewerX = standLeft + ts * 0.9;
    ctx.fillStyle = rgb([196, 200, 204]);
    ctx.beginPath();
    ctx.moveTo(ewerX - ts * 0.08, standTop);
    ctx.quadraticCurveTo(
      ewerX - ts * 0.12,
      standTop - ts * 0.14,
      ewerX - ts * 0.05,
      standTop - ts * 0.26,
    );
    ctx.lineTo(ewerX + ts * 0.07, standTop - ts * 0.28);
    ctx.quadraticCurveTo(ewerX + ts * 0.12, standTop - ts * 0.14, ewerX + ts * 0.08, standTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(GLASS_SHINE, 0.8);
    ctx.fillRect(ewerX - ts * 0.06, standTop - ts * 0.2, 1.5, ts * 0.14);
    // Folded towels.
    for (let i = 0; i < 3; i++) {
      const ty = standTop - ts * 0.05 * (i + 1);
      ctx.fillStyle = rgb(i === 1 ? LINEN_SHADE : LINEN);
      ctx.beginPath();
      ctx.rect(standRight - ts * 0.4, ty, ts * 0.32, ts * 0.05);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
  });
}

// ── Arm lamp ──────────────────────────────────────────────────────────────

/**
 * A tall iron lamp with a brass shade on a jointed arm, reaching over the
 * chair — the one bright light in a room kept dim everywhere else, with its
 * pool of light falling on the floor below.
 */
export function paintArmLamp(ctx: Ctx, frame: TownPropFrame, variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const iron = ironRamp();
    const reachEast = variant % 2 === 0;
    const dir = reachEast ? 1 : -1;
    const baseX = box.centreX - dir * ts * 0.2;
    paintBloom(
      ctx,
      box.centreX + dir * ts * 0.18,
      box.bottom - ts * 0.3,
      ts * 0.5,
      FLAME_MID,
      0.25,
    );
    contactShadow(ctx, frame);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
    ctx.beginPath();
    ctx.ellipse(baseX, box.bottom - ts * 0.12, ts * 0.2, ts * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const poleTop = box.bottom - ts * 1.55;
    ctx.strokeStyle = rgb(TOWN_INK);
    ctx.lineWidth = ts * 0.07;
    ctx.beginPath();
    ctx.moveTo(baseX, box.bottom - ts * 0.14);
    ctx.lineTo(baseX, poleTop);
    ctx.lineTo(baseX + dir * ts * 0.4, poleTop + ts * 0.18);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.55));
    ctx.lineWidth = ts * 0.04;
    ctx.stroke();
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.arc(baseX, poleTop, ts * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // Shade: a brass cone tipped towards the chair, with the flame's glow under it.
    const shadeX = baseX + dir * ts * 0.42;
    const shadeY = poleTop + ts * 0.2;
    paintBloom(ctx, shadeX, shadeY + ts * 0.14, ts * 0.45, FLAME_CORE, 0.55);
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.beginPath();
    ctx.moveTo(shadeX - ts * 0.08, shadeY - ts * 0.06);
    ctx.lineTo(shadeX + ts * 0.08, shadeY - ts * 0.06);
    ctx.lineTo(shadeX + ts * 0.2, shadeY + ts * 0.12);
    ctx.lineTo(shadeX - ts * 0.2, shadeY + ts * 0.12);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(BRASS_BRIGHT, 0.9);
    ctx.fillRect(shadeX - dir * ts * 0.1, shadeY - ts * 0.03, ts * 0.05, ts * 0.12);
    ctx.fillStyle = rgb(FLAME_CORE);
    ctx.beginPath();
    ctx.ellipse(shadeX, shadeY + ts * 0.13, ts * 0.16, ts * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ── Grinding bench ────────────────────────────────────────────────────────

/**
 * The back room's worktable: a heavy bench with a stone grinding slab, a
 * glass muller mid-stroke in a smear of ground ochre, heaps of raw pigment,
 * a mortar and pestle, and a jar of oil, under a wall rack of drying ink
 * cakes on their paper.
 */
export function paintGrindingBench(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const wood = getTownRamp('oc_timber');
    const stone = getTownRamp('oc_stone');

    // Wall rack of drying ink cakes.
    const rackY = box.top - ts * 0.75;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.fillRect(box.left + ts * 0.12, rackY, box.width - ts * 0.24, ts * 0.06);
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.12, rackY, box.width - ts * 0.24, ts * 0.06);
    inkOutline(ctx, ts);
    const cakes = 6;
    for (let i = 0; i < cakes; i++) {
      const cx = box.left + ts * 0.22 + i * ((box.width - ts * 0.44) / (cakes - 1));
      ctx.fillStyle = rgb(PAPER);
      ctx.fillRect(cx - ts * 0.09, rackY - ts * 0.14, ts * 0.18, ts * 0.14);
      ctx.fillStyle = rgb(PIGMENTS[(i * 3) % PIGMENTS.length]);
      ctx.beginPath();
      ctx.rect(cx - ts * 0.06, rackY - ts * 0.12, ts * 0.12, ts * 0.08);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }

    // Bench.
    const topY = box.top + ts * 0.32;
    const legInset = ts * 0.14;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (const lx of [box.left + legInset, box.right - legInset - ts * 0.08]) {
      ctx.fillRect(lx, topY, ts * 0.08, box.bottom - ts * 0.06 - topY);
      ctx.beginPath();
      ctx.rect(lx, topY, ts * 0.08, box.bottom - ts * 0.06 - topY);
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.fillRect(box.left + legInset, box.bottom - ts * 0.3, box.width - legInset * 2, ts * 0.05);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.fillRect(box.left + ts * 0.06, topY, box.width - ts * 0.12, ts * 0.14);
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.06, topY, box.width - ts * 0.12, ts * 0.14);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.8));
    ctx.fillRect(box.left + ts * 0.06, topY, box.width - ts * 0.12, ts * 0.025);
    // Sacks of raw earth under the bench.
    for (const [sx, tone] of [
      [box.left + ts * 0.5, OCHRE],
      [box.left + ts * 0.85, CINNABAR],
    ] as const) {
      ctx.fillStyle = rgb([176, 150, 108]);
      ctx.beginPath();
      ctx.ellipse(sx, box.bottom - ts * 0.18, ts * 0.16, ts * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(tone);
      ctx.beginPath();
      ctx.ellipse(sx, box.bottom - ts * 0.27, ts * 0.1, ts * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grinding slab with the muller mid-stroke in a smear of ochre.
    const slabX = box.left + ts * 0.2;
    const slabW = ts * 0.8;
    ctx.fillStyle = rgb(sampleRamp(stone, 0.7));
    ctx.fillRect(slabX, topY - ts * 0.07, slabW, ts * 0.07);
    ctx.beginPath();
    ctx.rect(slabX, topY - ts * 0.07, slabW, ts * 0.07);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(OCHRE, 0.85);
    ctx.beginPath();
    ctx.ellipse(slabX + slabW * 0.5, topY - ts * 0.07, slabW * 0.36, ts * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba([210, 220, 224], 0.9);
    ctx.beginPath();
    ctx.moveTo(slabX + slabW * 0.55, topY - ts * 0.07);
    ctx.lineTo(slabX + slabW * 0.58, topY - ts * 0.3);
    ctx.lineTo(slabX + slabW * 0.72, topY - ts * 0.3);
    ctx.lineTo(slabX + slabW * 0.78, topY - ts * 0.07);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);

    // Heaps of raw pigment.
    const heaps: readonly RGB[] = [INDIGO, MADDER, VERDIGRIS];
    heaps.forEach((tone, i) => {
      const hx = box.left + ts * (1.18 + i * 0.2) + jitter(forkRng(rng), ts * 0.02);
      ctx.fillStyle = rgb(tone);
      ctx.beginPath();
      ctx.moveTo(hx - ts * 0.09, topY);
      ctx.quadraticCurveTo(hx, topY - ts * 0.16, hx + ts * 0.09, topY);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
    });
    // Mortar and pestle, and a jar of oil.
    const mortarX = box.right - ts * 0.3;
    ctx.fillStyle = rgb(sampleRamp(stone, 0.55));
    ctx.beginPath();
    ctx.moveTo(mortarX - ts * 0.12, topY - ts * 0.14);
    ctx.lineTo(mortarX + ts * 0.12, topY - ts * 0.14);
    ctx.lineTo(mortarX + ts * 0.08, topY);
    ctx.lineTo(mortarX - ts * 0.08, topY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(sampleRamp(stone, 0.85));
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(mortarX, topY - ts * 0.1);
    ctx.lineTo(mortarX + ts * 0.1, topY - ts * 0.32);
    ctx.stroke();
    paintInkPot(ctx, box.right - ts * 0.62, topY, ts * 0.12, ts * 0.2, [196, 170, 90], ts);
  });
}

// ── Waiting-room seating ──────────────────────────────────────────────────

/**
 * A three-seat settee in button-tufted velvet with a carved black frame and
 * scrolled arms, seen from the front. Variant 0 is the shop's violet, 1 a
 * teal, so two settees in one room never read as a copy-pasted pair.
 */
export function paintSettee(ctx: Ctx, frame: TownPropFrame, variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const [dark, body, light] =
      variant % 2 === 0
        ? [VIOLET_DARK, VIOLET_BODY, VIOLET_LIGHT]
        : [TEAL_DARK, TEAL_BODY, TEAL_LIGHT];
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    const backTop = box.bottom - ts * 1.05;
    const seatTop = box.bottom - ts * 0.5;
    const seatBottom = box.bottom - ts * 0.26;

    // Legs.
    ctx.fillStyle = rgb(LACQUER_DARK);
    for (const lx of [left + ts * 0.1, right - ts * 0.16, box.centreX - ts * 0.03]) {
      ctx.fillRect(lx, seatBottom, ts * 0.06, box.bottom - ts * 0.06 - seatBottom);
    }

    // Back, a camel-humped top rail.
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.12, seatTop);
    ctx.lineTo(left + ts * 0.12, backTop + ts * 0.18);
    ctx.quadraticCurveTo(box.centreX, backTop - ts * 0.16, right - ts * 0.12, backTop + ts * 0.18);
    ctx.lineTo(right - ts * 0.12, seatTop);
    ctx.closePath();
    const backFill = ctx.createLinearGradient(0, backTop, 0, seatTop);
    backFill.addColorStop(0, rgb(light));
    backFill.addColorStop(1, rgb(body));
    ctx.fillStyle = backFill;
    ctx.fill();
    ctx.strokeStyle = rgb(LACQUER_BODY);
    ctx.lineWidth = ts * 0.05;
    ctx.stroke();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(dark);
    const tuftRows = 2;
    const tuftCols = frame.footprintW * 3;
    for (let r = 0; r < tuftRows; r++) {
      for (let c = 0; c < tuftCols; c++) {
        const tx = left + ts * 0.3 + (c + (r % 2) * 0.5) * ((right - left - ts * 0.6) / tuftCols);
        const ty = backTop + ts * (0.22 + r * 0.16);
        ctx.beginPath();
        ctx.arc(tx, ty, ts * 0.018, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Seat cushions, one per tile.
    const cushions = frame.footprintW;
    const cushionW = (right - left - ts * 0.3) / cushions;
    for (let c = 0; c < cushions; c++) {
      const cx = left + ts * 0.15 + c * cushionW;
      ctx.fillStyle = rgb(body);
      ctx.beginPath();
      ctx.rect(cx, seatTop, cushionW, seatBottom - seatTop);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(light);
      ctx.fillRect(cx + 2, seatTop + 1, cushionW - 4, ts * 0.04);
    }
    // Carved seat rail.
    ctx.fillStyle = rgb(LACQUER_BODY);
    ctx.fillRect(left, seatBottom - ts * 0.02, right - left, ts * 0.07);
    ctx.beginPath();
    ctx.rect(left, seatBottom - ts * 0.02, right - left, ts * 0.07);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.arc(box.centreX, seatBottom + ts * 0.015, ts * 0.025, 0, Math.PI * 2);
    ctx.fill();

    // Scrolled arms.
    for (const ax of [left, right - ts * 0.2]) {
      ctx.fillStyle = rgb(body);
      ctx.beginPath();
      ctx.rect(ax, seatTop - ts * 0.18, ts * 0.2, seatBottom - seatTop + ts * 0.18);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(LACQUER_BODY);
      ctx.beginPath();
      ctx.ellipse(ax + ts * 0.1, seatTop - ts * 0.18, ts * 0.12, ts * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(BRASS_DIM);
      ctx.beginPath();
      ctx.arc(ax + ts * 0.1, seatTop - ts * 0.18, ts * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** The flash binder open on a low table: a spread of small designs on two facing pages. */
function paintOpenBinder(ctx: Ctx, cx: number, topY: number, ts: number): void {
  const pageW = ts * 0.34;
  const pageH = ts * 0.2;
  ctx.fillStyle = rgb(VIOLET_DARK);
  ctx.fillRect(
    cx - pageW - ts * 0.03,
    topY - pageH - ts * 0.01,
    pageW * 2 + ts * 0.06,
    pageH + ts * 0.04,
  );
  for (const side of [-1, 1]) {
    const px = side < 0 ? cx - pageW : cx;
    ctx.fillStyle = rgb(PAPER);
    ctx.beginPath();
    ctx.rect(px, topY - pageH, pageW, pageH);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    const minis: readonly RGB[] =
      side < 0 ? [FLASH_RED, FLASH_BLUE, FLASH_GREEN] : [FLASH_YELLOW, FLASH_RED, FLASH_BLUE];
    minis.forEach((ink, i) => {
      ctx.fillStyle = rgb(ink);
      ctx.beginPath();
      ctx.arc(px + pageW * (0.22 + i * 0.28), topY - pageH * 0.55, ts * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgb(TOWN_INK);
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
}

/**
 * A long low lacquered table for the waiting room: the flash binder lying
 * open, a teapot and two cups, and a dish of incense sending up a thread of
 * smoke.
 */
export function paintLowTable(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const topY = box.bottom - ts * 0.48;
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    ctx.fillStyle = rgb(LACQUER_DARK);
    for (const lx of [left + ts * 0.06, right - ts * 0.14]) {
      ctx.fillRect(lx, topY, ts * 0.08, box.bottom - ts * 0.08 - topY);
      ctx.beginPath();
      ctx.rect(lx, topY, ts * 0.08, box.bottom - ts * 0.08 - topY);
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(LACQUER_BODY);
    ctx.fillRect(left, topY, right - left, ts * 0.12);
    ctx.beginPath();
    ctx.rect(left, topY, right - left, ts * 0.12);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(LACQUER_LIGHT);
    ctx.fillRect(left, topY, right - left, ts * 0.025);
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.fillRect(left + ts * 0.06, topY + ts * 0.07, right - left - ts * 0.12, ts * 0.015);

    paintOpenBinder(ctx, left + ts * 0.55, topY + ts * 0.01, ts);

    // Teapot and cups.
    const potX = right - ts * 0.55;
    ctx.fillStyle = rgb([196, 90, 60]);
    ctx.beginPath();
    ctx.ellipse(potX, topY - ts * 0.1, ts * 0.12, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb([196, 90, 60]);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(potX + ts * 0.1, topY - ts * 0.1);
    ctx.lineTo(potX + ts * 0.2, topY - ts * 0.18);
    ctx.stroke();
    ctx.fillStyle = rgba(FLASH_WHITE, 0.7);
    ctx.fillRect(potX - ts * 0.07, topY - ts * 0.15, 1.5, ts * 0.07);
    for (const cupX of [potX - ts * 0.26, potX + ts * 0.26]) {
      ctx.fillStyle = rgb(FLASH_WHITE);
      ctx.beginPath();
      ctx.rect(cupX - ts * 0.04, topY - ts * 0.07, ts * 0.08, ts * 0.07);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }

    // Incense dish and its thread of smoke.
    const dishX = right - ts * 0.14;
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.beginPath();
    ctx.ellipse(dishX, topY - ts * 0.01, ts * 0.07, ts * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba([210, 206, 214], 0.55);
    ctx.lineWidth = Math.max(1, ts * 0.012);
    ctx.beginPath();
    ctx.moveTo(dishX, topY - ts * 0.03);
    ctx.bezierCurveTo(
      dishX - ts * 0.06,
      topY - ts * 0.2,
      dishX + ts * 0.05,
      topY - ts * 0.3,
      dishX - ts * 0.02,
      topY - ts * 0.48,
    );
    ctx.stroke();
  });
}

/** A round lacquered side table with a small lamp and a stack of design books. */
export function paintSideTable(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const topY = box.bottom - ts * 0.55;
    ctx.fillStyle = rgb(LACQUER_DARK);
    ctx.fillRect(box.centreX - ts * 0.04, topY, ts * 0.08, box.bottom - ts * 0.1 - topY);
    ctx.beginPath();
    ctx.ellipse(box.centreX, box.bottom - ts * 0.1, ts * 0.16, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(LACQUER_BODY);
    ctx.beginPath();
    ctx.ellipse(box.centreX, topY, ts * 0.36, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(LACQUER_LIGHT, 0.8);
    ctx.beginPath();
    ctx.ellipse(box.centreX - ts * 0.08, topY - ts * 0.02, ts * 0.18, ts * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();

    const books: readonly RGB[] = [FLASH_RED, VIOLET_BODY, [40, 40, 44]];
    books.forEach((cover, i) => {
      ctx.fillStyle = rgb(cover);
      ctx.beginPath();
      ctx.rect(
        box.centreX - ts * 0.28 + i * ts * 0.02,
        topY - ts * 0.05 * (i + 1),
        ts * 0.26,
        ts * 0.05,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    });
    // Lamp.
    const lampX = box.centreX + ts * 0.15;
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.fillRect(lampX - ts * 0.02, topY - ts * 0.2, ts * 0.04, ts * 0.2);
    paintBloom(ctx, lampX, topY - ts * 0.26, ts * 0.3, FLAME_MID, 0.5);
    ctx.fillStyle = rgb(VIOLET_LIGHT);
    ctx.beginPath();
    ctx.moveTo(lampX - ts * 0.06, topY - ts * 0.34);
    ctx.lineTo(lampX + ts * 0.06, topY - ts * 0.34);
    ctx.lineTo(lampX + ts * 0.11, topY - ts * 0.2);
    ctx.lineTo(lampX - ts * 0.11, topY - ts * 0.2);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(FLAME_CORE, 0.8);
    ctx.fillRect(lampX - ts * 0.09, topY - ts * 0.22, ts * 0.18, ts * 0.02);
  });
}

/** A turned coat stand with a customer's cloak, a hat and a scarf left on its hooks. */
export function paintCoatStand(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const topY = box.bottom - ts * 1.6;
    ctx.fillStyle = rgb(LACQUER_DARK);
    ctx.beginPath();
    ctx.ellipse(box.centreX, box.bottom - ts * 0.12, ts * 0.22, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(LACQUER_BODY);
    ctx.fillRect(box.centreX - ts * 0.035, topY, ts * 0.07, box.bottom - ts * 0.12 - topY);
    ctx.beginPath();
    ctx.rect(box.centreX - ts * 0.035, topY, ts * 0.07, box.bottom - ts * 0.12 - topY);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.arc(box.centreX, topY, ts * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Cloak hanging from the west hook.
    ctx.fillStyle = rgb([70, 78, 60]);
    ctx.beginPath();
    ctx.moveTo(box.centreX - ts * 0.05, topY + ts * 0.12);
    ctx.quadraticCurveTo(
      box.centreX - ts * 0.34,
      topY + ts * 0.5,
      box.centreX - ts * 0.3,
      topY + ts * 1.05,
    );
    ctx.lineTo(box.centreX - ts * 0.02, topY + ts * 1.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba([40, 44, 34], 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.centreX - ts * 0.14, topY + ts * 0.4);
    ctx.lineTo(box.centreX - ts * 0.18, topY + ts * 1.0);
    ctx.stroke();

    // Hat on the top.
    ctx.fillStyle = rgb([44, 38, 44]);
    ctx.beginPath();
    ctx.ellipse(box.centreX + ts * 0.06, topY + ts * 0.02, ts * 0.2, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.beginPath();
    ctx.rect(box.centreX - ts * 0.04, topY - ts * 0.14, ts * 0.2, ts * 0.15);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(FLASH_RED);
    ctx.fillRect(box.centreX - ts * 0.04, topY - ts * 0.03, ts * 0.2, ts * 0.03);

    // A striped scarf over the east hook.
    ctx.fillStyle = rgb(FLASH_YELLOW);
    ctx.beginPath();
    ctx.rect(box.centreX + ts * 0.06, topY + ts * 0.18, ts * 0.1, ts * 0.55);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(VIOLET_BODY);
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(box.centreX + ts * 0.06, topY + ts * (0.28 + i * 0.16), ts * 0.1, ts * 0.05);
    }
  });
}
