/**
 * Miller's Farm's furniture, built around three big pieces — the mill works
 * with its stones, hopper and pit wheel, Marta's brick hearth and bread
 * oven, and the family table — with the dresser, larder, kneading trough,
 * Corvin's pallet, the sack stacks, steelyard and grain bin clustered round
 * them, plus the small pieces (pot rack, flour bin, sieves, hand cart).
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
import { getTownRamp, sampleRamp, mix, type RGB } from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

function contactShadow(ctx: Ctx, frame: TownPropFrame): void {
  const box = footprintBox(frame);
  const radiusX = box.width * 0.42;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.32);
}

function woodRamp() {
  return getTownRamp('oc_timber');
}
function ironRamp() {
  return getTownRamp('iron_black');
}

const POT_IRON: RGB = [58, 58, 62];
const POT_COPPER: RGB = [140, 88, 52];
const HERB_DRY: RGB = [148, 138, 70];

/** A wall rail hung with kitchen pots and a bundle of drying herbs beside them. */
export function paintPotRack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = ironRamp();
    const railY = box.top + box.height * 0.22;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.fillRect(box.left, railY, box.width, frame.tileScale * 0.04);

    const potXs = [box.left + box.width * 0.24, box.left + box.width * 0.55];
    const potColors = [POT_IRON, POT_COPPER];
    for (let i = 0; i < potXs.length; i++) {
      const px = potXs[i];
      const pr = frame.tileScale * (0.12 + jitter(rng, 0.01));
      const py = railY + pr + frame.tileScale * 0.08;
      ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, railY);
      ctx.lineTo(px, py - pr);
      ctx.stroke();
      ctx.fillStyle = rgb(potColors[i]);
      ctx.beginPath();
      ctx.ellipse(px, py, pr, pr * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, frame.tileScale * 0.5);
    }

    // A small bundle of dried herbs hung at the rail's east end.
    const bundleX = box.right - box.width * 0.16;
    ctx.strokeStyle = rgb(HERB_DRY);
    ctx.lineWidth = frame.tileScale * 0.03;
    for (const spread of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(bundleX, railY);
      ctx.lineTo(bundleX + spread * frame.tileScale * 0.06, railY + frame.tileScale * 0.3);
      ctx.stroke();
    }
  });
}

/** A deep timber flour bin, lid dusted white along its seam. */
export function paintFlourBin(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = woodRamp();
    const binH = frame.tileScale * 0.5;
    const binTop = box.bottom - binH;
    paintPlankBoard(ctx, box.left, binTop, box.width, binH, forkRng(rng), {
      direction: 'vertical',
      boardPx: box.width / 3,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(box.left, binTop, box.width, binH);
    inkOutline(ctx, frame.tileScale);

    const lidH = frame.tileScale * 0.1;
    const lidTop = binTop - lidH;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.beginPath();
    ctx.moveTo(box.left - frame.tileScale * 0.02, binTop);
    ctx.lineTo(box.left + frame.tileScale * 0.03, lidTop);
    ctx.lineTo(box.right - frame.tileScale * 0.03, lidTop);
    ctx.lineTo(box.right + frame.tileScale * 0.02, binTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.7);

    // Flour dust along the lid's own seam.
    ctx.fillStyle = rgba([232, 220, 196], 0.75);
    ctx.beginPath();
    ctx.ellipse(box.centreX, binTop, box.width * 0.38, frame.tileScale * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** A rack of round flour sieves hung by size, mesh worked in fine crossed lines. */
export function paintSieveRack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const wood = woodRamp();
    const centreY = box.top + box.height * 0.45;
    const radii = [box.width * 0.3, box.width * 0.22, box.width * 0.15];
    const xs = [box.left + box.width * 0.28, box.centreX, box.right - box.width * 0.28];
    for (let i = 0; i < radii.length; i++) {
      const cx = xs[i];
      const r = radii[i];
      ctx.strokeStyle = rgb(sampleRamp(wood, 0.34));
      ctx.lineWidth = frame.tileScale * 0.045;
      ctx.beginPath();
      ctx.ellipse(cx, centreY, r, r * 0.9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba([210, 200, 176], 0.5 + jitter(rng, 0.05));
      ctx.lineWidth = 0.6;
      const meshLines = 4;
      for (let m = 1; m < meshLines; m++) {
        const t = m / meshLines;
        ctx.beginPath();
        ctx.moveTo(cx - r + r * 2 * t, centreY - r * 0.9);
        ctx.lineTo(cx - r + r * 2 * t, centreY + r * 0.9);
        ctx.stroke();
      }
    }
  });
}

/** A two-wheeled hand cart, a sack loaded on its bed — the mill room's own haulage. */
export function paintHandCart(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = woodRamp();
    const iron = ironRamp();
    const bedH = frame.tileScale * 0.16;
    const wheelR = frame.tileScale * 0.2;
    const wheelCy = box.bottom - wheelR * 0.7;
    const bedY = wheelCy - wheelR * 0.6 - bedH;

    for (const wx of [box.left + wheelR * 1.1, box.right - wheelR * 1.1]) {
      ctx.strokeStyle = rgb(sampleRamp(iron, 0.45));
      ctx.lineWidth = frame.tileScale * 0.05;
      ctx.beginPath();
      ctx.arc(wx, wheelCy, wheelR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wx - wheelR * 0.7, wheelCy);
      ctx.lineTo(wx + wheelR * 0.7, wheelCy);
      ctx.moveTo(wx, wheelCy - wheelR * 0.7);
      ctx.lineTo(wx, wheelCy + wheelR * 0.7);
      ctx.stroke();
    }

    paintPlankBoard(ctx, box.left, bedY, box.width, bedH, forkRng(rng), {
      direction: 'horizontal',
      boardPx: box.width / 3,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(box.left, bedY, box.width, bedH);
    inkOutline(ctx, frame.tileScale * 0.7);

    // A loaded sack riding the bed.
    const sackW = box.width * 0.5;
    const sackH = frame.tileScale * 0.32;
    const sackX = box.centreX - sackW / 2;
    const sackTop = bedY - sackH;
    ctx.fillStyle = rgb([176, 148, 96]);
    ctx.beginPath();
    ctx.moveTo(sackX, bedY);
    ctx.quadraticCurveTo(
      sackX - frame.tileScale * 0.03,
      sackTop + sackH * 0.4,
      sackX + sackW * 0.2,
      sackTop,
    );
    ctx.lineTo(sackX + sackW * 0.8, sackTop);
    ctx.quadraticCurveTo(
      sackX + sackW + frame.tileScale * 0.03,
      sackTop + sackH * 0.4,
      sackX + sackW,
      bedY,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.6);

    // A shaft, angled up from the bed's near edge.
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.28));
    ctx.lineWidth = frame.tileScale * 0.045;
    ctx.beginPath();
    ctx.moveTo(box.centreX, bedY + bedH * 0.4);
    ctx.lineTo(box.centreX - box.width * 0.1, bedY + bedH * 0.4 + frame.tileScale * 0.34);
    ctx.stroke();
  });
}

// ── The farm's composed centrepieces ───────────────────────────────────────

const FLOUR_WHITE: RGB = [238, 230, 212];
const GRAIN_GOLD: RGB = [206, 166, 84];
const GRAIN_SHADOW: RGB = [150, 112, 50];
const BURLAP_LIGHT: RGB = [204, 180, 134];
const BURLAP_BODY: RGB = [176, 150, 104];
const BURLAP_SHADOW: RGB = [122, 98, 64];
/** The mill's own mark, stencilled on every sack it sends out — a wheat sheaf in madder. */
const SACK_STAMP: RGB = [138, 52, 40];
const SOOT: RGB = [30, 24, 22];
const FIRE_CORE: RGB = [255, 226, 150];
const FIRE_MID: RGB = [232, 124, 44];
const FIRE_EDGE: RGB = [120, 40, 20];
const BREAD_CRUST: RGB = [160, 96, 44];
const BREAD_LIGHT: RGB = [214, 158, 88];
const DOUGH: RGB = [236, 220, 184];
const DOUGH_SHADOW: RGB = [198, 176, 132];
const PLATE_WHITE: RGB = [232, 230, 220];
const PLATE_BLUE: RGB = [58, 86, 150];
const EARTHENWARE: RGB = [150, 92, 60];
const EARTHENWARE_LIGHT: RGB = [196, 136, 92];
const GLAZE_GREEN: RGB = [92, 124, 78];
const CHEESE: RGB = [226, 186, 86];
const CHEESE_RIND: RGB = [176, 124, 50];
const HAM: RGB = [150, 72, 58];
const MUSLIN: RGB = [214, 204, 180];
const ONION: RGB = [184, 116, 62];
const GARLIC: RGB = [226, 218, 196];
const JAM_RED: RGB = [150, 34, 44];
const PICKLE_GREEN: RGB = [104, 128, 50];
const HONEY: RGB = [214, 150, 40];
const COPPER: RGB = [172, 100, 58];
const COPPER_LIGHT: RGB = [226, 158, 106];
const MILK: RGB = [240, 238, 228];
const CHALK: RGB = [226, 224, 214];
const BLANKET_GREEN: RGB = [84, 104, 70];
const BLANKET_RUST: RGB = [150, 78, 50];
const STRAW: RGB = [202, 174, 96];
/** A cog wheel's inner line — softer than the ink outline so the rim reads as carved, not drawn. */
const TOWN_INK_SOFT: RGB = [40, 30, 24];
const STEW: RGB = [128, 88, 48];
const BUTTER: RGB = [236, 214, 120];
const BELLOWS_LEATHER: RGB = [118, 72, 48];
const SLATE: RGB = [46, 50, 54];

function paintGlow(ctx: Ctx, x: number, y: number, radius: number, color: RGB, alpha: number) {
  const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
  glow.addColorStop(0, rgba(color, alpha));
  glow.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A burlap sack standing on its base; `open` rolls the neck down over a mound of flour. */
function paintSack(
  ctx: Ctx,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
  options: { readonly open?: boolean; readonly stamp?: boolean; readonly lean?: number } = {},
): void {
  const lean = options.lean ?? 0;
  const top = bottom - h;
  const neckW = options.open === true ? w * 0.86 : w * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, bottom);
  ctx.bezierCurveTo(
    cx - w * 0.62,
    bottom - h * 0.55,
    cx - neckW * 0.5 + lean,
    top + h * 0.25,
    cx - neckW * 0.5 + lean,
    top + h * 0.12,
  );
  ctx.lineTo(cx + neckW * 0.5 + lean, top + h * 0.12);
  ctx.bezierCurveTo(
    cx + neckW * 0.5 + lean,
    top + h * 0.25,
    cx + w * 0.62,
    bottom - h * 0.55,
    cx + w * 0.5,
    bottom,
  );
  ctx.closePath();
  const body = ctx.createLinearGradient(cx - w * 0.5, 0, cx + w * 0.5, 0);
  body.addColorStop(0, rgb(BURLAP_LIGHT));
  body.addColorStop(0.55, rgb(BURLAP_BODY));
  body.addColorStop(1, rgb(BURLAP_SHADOW));
  ctx.fillStyle = body;
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(BURLAP_SHADOW, 0.35);
  ctx.lineWidth = Math.max(0.6, ts * 0.008);
  const weaveStep = ts * 0.05;
  for (let y = top; y < bottom; y += weaveStep) {
    ctx.beginPath();
    ctx.moveTo(cx - w, y + jitter(rng, ts * 0.005));
    ctx.lineTo(cx + w, y);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(FLOUR_WHITE, 0.28);
  ctx.fillRect(cx - w, bottom - h * 0.22, w * 2, h * 0.22);
  ctx.restore();
  if (options.stamp === true) {
    const sx = cx + lean * 0.4;
    const sy = bottom - h * 0.45;
    const s = Math.min(w, h) * 0.2;
    ctx.strokeStyle = rgba(SACK_STAMP, 0.85);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    for (const spread of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + s);
      ctx.lineTo(sx + spread * s, sy - s);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(sx - s * 0.45, sy + s * 0.2);
    ctx.lineTo(sx + s * 0.45, sy + s * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(sx, sy, s * 1.5, s * 1.35, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (options.open === true) {
    ctx.fillStyle = rgb(mix(BURLAP_LIGHT, BURLAP_SHADOW, 0.3));
    ctx.beginPath();
    ctx.ellipse(cx + lean, top + h * 0.13, neckW * 0.52, h * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(FLOUR_WHITE);
    ctx.beginPath();
    ctx.ellipse(cx + lean, top + h * 0.11, neckW * 0.42, h * 0.08, 0, Math.PI, 0);
    ctx.quadraticCurveTo(cx + lean, top - h * 0.06, cx + lean - neckW * 0.42, top + h * 0.11);
    ctx.fill();
  } else {
    ctx.fillStyle = rgb(BURLAP_SHADOW);
    ctx.beginPath();
    ctx.ellipse(cx + lean, top + h * 0.1, neckW * 0.55, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(BURLAP_BODY);
    ctx.beginPath();
    ctx.moveTo(cx + lean - neckW * 0.35, top + h * 0.1);
    ctx.lineTo(cx + lean - neckW * 0.55, top - h * 0.06);
    ctx.lineTo(cx + lean + neckW * 0.5, top - h * 0.04);
    ctx.lineTo(cx + lean + neckW * 0.35, top + h * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
  }
}

/** A round crusty loaf, scored across the top. */
function paintLoaf(ctx: Ctx, cx: number, baseY: number, w: number, ts: number): void {
  const h = w * 0.55;
  ctx.fillStyle = rgb(BREAD_CRUST);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h * 0.5, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.45);
  ctx.fillStyle = rgb(BREAD_LIGHT);
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.1, baseY - h * 0.66, w * 0.3, h * 0.24, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(mix(BREAD_CRUST, SOOT, 0.35));
  ctx.lineWidth = Math.max(1, ts * 0.014);
  for (const dx of [-0.18, 0.05, 0.28]) {
    ctx.beginPath();
    ctx.moveTo(cx + w * dx - w * 0.08, baseY - h * 0.85);
    ctx.lineTo(cx + w * dx + w * 0.05, baseY - h * 0.35);
    ctx.stroke();
  }
}

/** A glazed jug with a handle, standing on `baseY`. */
function paintJug(ctx: Ctx, cx: number, baseY: number, h: number, color: RGB, ts: number): void {
  const w = h * 0.62;
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, baseY);
  ctx.quadraticCurveTo(cx - w * 0.62, baseY - h * 0.55, cx - w * 0.26, baseY - h * 0.86);
  ctx.lineTo(cx - w * 0.34, baseY - h);
  ctx.lineTo(cx + w * 0.3, baseY - h);
  ctx.lineTo(cx + w * 0.24, baseY - h * 0.86);
  ctx.quadraticCurveTo(cx + w * 0.62, baseY - h * 0.55, cx + w * 0.36, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.45);
  ctx.strokeStyle = rgb(color);
  ctx.lineWidth = Math.max(1, h * 0.09);
  ctx.beginPath();
  ctx.arc(cx + w * 0.42, baseY - h * 0.6, h * 0.18, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();
  ctx.fillStyle = rgba(PLATE_WHITE, 0.45);
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.2, baseY - h * 0.5, w * 0.08, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A preserves jar with a cloth cap tied over its mouth. */
function paintPreserveJar(ctx: Ctx, cx: number, baseY: number, h: number, fill: RGB, ts: number) {
  const w = h * 0.7;
  ctx.fillStyle = rgb(fill);
  ctx.beginPath();
  ctx.rect(cx - w * 0.5, baseY - h * 0.85, w, h * 0.85);
  ctx.fill();
  inkOutline(ctx, ts * 0.4);
  ctx.fillStyle = rgba(PLATE_WHITE, 0.4);
  ctx.fillRect(cx - w * 0.36, baseY - h * 0.75, w * 0.14, h * 0.55);
  ctx.fillStyle = rgb(MUSLIN);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.6, baseY - h * 0.78);
  ctx.lineTo(cx - w * 0.45, baseY - h);
  ctx.lineTo(cx + w * 0.45, baseY - h);
  ctx.lineTo(cx + w * 0.6, baseY - h * 0.78);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.35);
}

/** A plate stood on its edge against a rail — white field, blue rim and a blue sprig. */
function paintStandingPlate(ctx: Ctx, cx: number, baseY: number, r: number, ts: number): void {
  const cy = baseY - r;
  ctx.fillStyle = rgb(PLATE_BLUE);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.4);
  ctx.fillStyle = rgb(PLATE_WHITE);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.76, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(PLATE_BLUE);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(PLATE_WHITE, 0.8);
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

/** A string of onions or garlic heads hung from a nail. */
function paintBulbString(
  ctx: Ctx,
  x: number,
  topY: number,
  length: number,
  color: RGB,
  ts: number,
  rng: Rng,
): void {
  ctx.strokeStyle = rgb(STRAW);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, topY + length);
  ctx.stroke();
  const bulbs = 5;
  for (let i = 0; i < bulbs; i++) {
    const t = (i + 0.6) / bulbs;
    const side = i % 2 === 0 ? -1 : 1;
    const r = ts * (0.065 + jitter(rng, 0.008));
    const bx = x + side * r * 0.7;
    const by = topY + length * t;
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.ellipse(bx, by, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.3);
    ctx.fillStyle = rgba(PLATE_WHITE, 0.35);
    ctx.beginPath();
    ctx.ellipse(bx - r * 0.3, by - r * 0.3, r * 0.3, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A ham in a muslin bag hung by its string. */
function paintHam(ctx: Ctx, x: number, topY: number, h: number, ts: number): void {
  ctx.strokeStyle = rgb(STRAW);
  ctx.lineWidth = Math.max(1, ts * 0.016);
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, topY + h * 0.2);
  ctx.stroke();
  ctx.fillStyle = rgb(MUSLIN);
  ctx.beginPath();
  ctx.moveTo(x - h * 0.08, topY + h * 0.2);
  ctx.quadraticCurveTo(x - h * 0.42, topY + h * 0.75, x, topY + h);
  ctx.quadraticCurveTo(x + h * 0.42, topY + h * 0.75, x + h * 0.08, topY + h * 0.2);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.45);
  ctx.fillStyle = rgba(HAM, 0.55);
  ctx.beginPath();
  ctx.ellipse(x + h * 0.08, topY + h * 0.68, h * 0.18, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A face-on wooden cog wheel: rim, cogs, four spokes and an iron hub. */
function paintCogWheel(ctx: Ctx, cx: number, cy: number, r: number, ts: number): void {
  const wood = woodRamp();
  const iron = ironRamp();
  const cogs = 16;
  ctx.fillStyle = rgb(sampleRamp(wood, 0.38));
  for (let i = 0; i < cogs; i++) {
    const a = (i / cogs) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.rect(-r * 0.02, -r * 0.07, r * 0.16, r * 0.14);
    ctx.fill();
    inkOutline(ctx, ts * 0.3);
    ctx.restore();
  }
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = rgb(sampleRamp(wood, 0.5));
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, ts * 0.012);
  ctx.strokeStyle = rgba(TOWN_INK_SOFT, 0.8);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
  ctx.moveTo(cx + r * 0.82, cy);
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(wood, 0.45));
  ctx.lineWidth = r * 0.12;
  for (const a of [Math.PI * 0.25, Math.PI * 0.75]) {
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r * 0.82, cy - Math.sin(a) * r * 0.82);
    ctx.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.4);
  ctx.fillStyle = rgb(sampleRamp(iron, 0.9));
  ctx.beginPath();
  ctx.arc(cx - r * 0.05, cy - r * 0.05, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** Dressed millstone face: the eye, and the harp furrows cut out from it in ten quarters. */
function paintStoneFace(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ts: number,
  rng: Rng,
): void {
  const stone = getTownRamp('oc_stone');
  const face = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.4, 1, cx, cy, rx * 1.1);
  face.addColorStop(0, rgb(sampleRamp(stone, 0.86)));
  face.addColorStop(1, rgb(sampleRamp(stone, 0.5)));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(sampleRamp(stone, 0.18), 0.75);
  ctx.lineWidth = Math.max(1, ts * 0.016);
  const quarters = 10;
  for (let q = 0; q < quarters; q++) {
    const a = (q / quarters) * Math.PI * 2 + jitter(rng, 0.03);
    const skew = 0.42;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rx * 0.22, cy + Math.sin(a) * ry * 0.22);
    ctx.lineTo(cx + Math.cos(a + skew) * rx * 0.96, cy + Math.sin(a + skew) * ry * 0.96);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a + 0.2) * rx * 0.5, cy + Math.sin(a + 0.2) * ry * 0.5);
    ctx.lineTo(cx + Math.cos(a + 0.5) * rx * 0.94, cy + Math.sin(a + 0.5) * ry * 0.94);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(FLOUR_WHITE, 0.5);
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = rgb(SOOT);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.17, ry * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(GRAIN_GOLD);
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.03, rx * 0.11, ry * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The mill itself, the room's reason for being: a timber hurst platform
 * carrying the bed and runner stones, a horse over them holding the grain
 * hopper, the chute feeding it down from the loft, the face-on pit wheel
 * behind that turns it, a spare dressed stone leaned on the wall, and the
 * meal spout dropping flour into an open sack out front.
 */
export function paintMillWorks(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    const stone = getTownRamp('oc_stone');
    drawTownContactShadow(
      ctx,
      box.left + ts * 1.6,
      box.bottom - ts * 0.55,
      ts * 1.75,
      ts * 0.4,
      0.36,
    );

    // The pit wheel behind the stones, and its axle into the wall.
    const gearCx = box.left + ts * 0.62;
    const gearCy = box.top + ts * 0.05;
    const gearR = ts * 0.62;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.22));
    ctx.fillRect(gearCx - ts * 0.09, box.top - ts * 0.9, ts * 0.18, ts * 0.9);
    paintCogWheel(ctx, gearCx, gearCy, gearR, ts);

    // A spare runner, dressed and leaned on the wall in the back corner.
    const spareCx = box.right - ts * 0.5;
    const spareR = ts * 0.46;
    const spareCy = box.bottom - ts * 0.62 - spareR;
    drawTownContactShadow(ctx, spareCx, spareCy + spareR, spareR * 0.9, ts * 0.1, 0.35);
    ctx.fillStyle = rgb(sampleRamp(stone, 0.3));
    ctx.beginPath();
    ctx.ellipse(spareCx + ts * 0.06, spareCy, spareR * 0.98, spareR, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    paintStoneFace(ctx, spareCx, spareCy, spareR * 0.92, spareR, ts * 0.6, forkRng(rng));

    // The hurst: the timber platform the stones sit on.
    const platLeft = box.left + ts * 0.08;
    const platRight = box.left + ts * 3.02;
    const platBack = box.top + ts * 0.5;
    const platFront = box.bottom - ts * 1.1;
    const platBottom = box.bottom - ts * 0.48;
    paintPlankBoard(ctx, platLeft, platBack, platRight - platLeft, platFront - platBack, rng, {
      direction: 'horizontal',
      boardPx: ts * 0.24,
      ramp: wood,
    });
    ctx.fillStyle = rgba(FLOUR_WHITE, 0.22);
    ctx.fillRect(platLeft, platBack, platRight - platLeft, platFront - platBack);
    ctx.beginPath();
    ctx.rect(platLeft, platBack, platRight - platLeft, platFront - platBack);
    inkOutline(ctx, ts);
    paintPlankBoard(ctx, platLeft, platFront, platRight - platLeft, platBottom - platFront, rng, {
      direction: 'vertical',
      boardPx: ts * 0.3,
      ramp: wood,
    });
    ctx.fillStyle = rgba(SOOT, 0.3);
    ctx.fillRect(platLeft, platFront, platRight - platLeft, platBottom - platFront);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.8));
    ctx.fillRect(platLeft, platFront - ts * 0.02, platRight - platLeft, ts * 0.05);
    for (const px of [platLeft, (platLeft + platRight) / 2 - ts * 0.07, platRight - ts * 0.14]) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.28));
      ctx.fillRect(px, platFront, ts * 0.14, platBottom - platFront);
      ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
      ctx.fillRect(px, platFront + ts * 0.06, ts * 0.14, ts * 0.05);
    }
    ctx.beginPath();
    ctx.rect(platLeft, platFront, platRight - platLeft, platBottom - platFront);
    inkOutline(ctx, ts);

    // Bed stone, then the runner on top of it, iron-hooped round its edge.
    const stoneCx = box.left + ts * 1.5;
    const runnerTop = platBack + (platFront - platBack) * 0.5 - ts * 0.08;
    const runnerRx = ts * 1.02;
    const runnerRy = ts * 0.44;
    const runnerThick = ts * 0.24;
    ctx.fillStyle = rgb(sampleRamp(stone, 0.28));
    ctx.beginPath();
    ctx.ellipse(
      stoneCx,
      runnerTop + runnerThick + ts * 0.1,
      runnerRx * 1.08,
      runnerRy * 1.1,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(FLOUR_WHITE, 0.55);
    ctx.beginPath();
    ctx.ellipse(
      stoneCx,
      runnerTop + runnerThick + ts * 0.14,
      runnerRx * 1.05,
      runnerRy * 0.9,
      0,
      0,
      Math.PI,
    );
    ctx.fill();
    ctx.fillStyle = rgb(sampleRamp(stone, 0.42));
    ctx.beginPath();
    ctx.ellipse(stoneCx, runnerTop + runnerThick, runnerRx, runnerRy, 0, 0, Math.PI);
    ctx.lineTo(stoneCx - runnerRx, runnerTop);
    ctx.ellipse(stoneCx, runnerTop, runnerRx, runnerRy, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = ts * 0.05;
    ctx.beginPath();
    ctx.ellipse(
      stoneCx,
      runnerTop + runnerThick * 0.55,
      runnerRx,
      runnerRy,
      0,
      0.05,
      Math.PI - 0.05,
    );
    ctx.stroke();
    paintStoneFace(ctx, stoneCx, runnerTop, runnerRx, runnerRy, ts, forkRng(rng));

    // The horse — a timber frame astride the stone — and the hopper it holds.
    const hopperTop = runnerTop - ts * 1.2;
    const hopperBottom = runnerTop - ts * 0.42;
    const hopperHalfTop = ts * 0.52;
    const hopperHalfBottom = ts * 0.14;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.35));
    ctx.lineWidth = ts * 0.08;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(stoneCx + side * runnerRx * 0.78, runnerTop + runnerRy * 0.3);
      ctx.lineTo(stoneCx + side * hopperHalfTop * 0.8, hopperTop + ts * 0.3);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(stoneCx - hopperHalfTop * 1.05, hopperBottom - ts * 0.18);
    ctx.lineTo(stoneCx + hopperHalfTop * 1.05, hopperBottom - ts * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(stoneCx - hopperHalfTop, hopperTop);
    ctx.lineTo(stoneCx + hopperHalfTop, hopperTop);
    ctx.lineTo(stoneCx + hopperHalfBottom, hopperBottom);
    ctx.lineTo(stoneCx - hopperHalfBottom, hopperBottom);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    paintPlankBoard(
      ctx,
      stoneCx - hopperHalfTop,
      hopperTop,
      hopperHalfTop * 2,
      hopperBottom - hopperTop,
      forkRng(rng),
      { direction: 'horizontal', boardPx: ts * 0.18, ramp: wood },
    );
    const hopperShade = ctx.createLinearGradient(
      stoneCx - hopperHalfTop,
      0,
      stoneCx + hopperHalfTop,
      0,
    );
    hopperShade.addColorStop(0, rgba(FLOUR_WHITE, 0.15));
    hopperShade.addColorStop(1, rgba(SOOT, 0.35));
    ctx.fillStyle = hopperShade;
    ctx.fillRect(stoneCx - hopperHalfTop, hopperTop, hopperHalfTop * 2, hopperBottom - hopperTop);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(stoneCx - hopperHalfTop, hopperTop);
    ctx.lineTo(stoneCx + hopperHalfTop, hopperTop);
    ctx.lineTo(stoneCx + hopperHalfBottom, hopperBottom);
    ctx.lineTo(stoneCx - hopperHalfBottom, hopperBottom);
    ctx.closePath();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(GRAIN_SHADOW);
    ctx.beginPath();
    ctx.ellipse(stoneCx, hopperTop, hopperHalfTop * 0.96, ts * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(GRAIN_GOLD);
    ctx.beginPath();
    ctx.ellipse(
      stoneCx - ts * 0.04,
      hopperTop + ts * 0.02,
      hopperHalfTop * 0.78,
      ts * 0.08,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // The shoe, and the grain trickling off it into the eye.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.beginPath();
    ctx.moveTo(stoneCx - ts * 0.08, hopperBottom);
    ctx.lineTo(stoneCx + ts * 0.08, hopperBottom);
    ctx.lineTo(stoneCx + ts * 0.1, runnerTop - ts * 0.1);
    ctx.lineTo(stoneCx - ts * 0.02, runnerTop - ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(GRAIN_GOLD);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(
        stoneCx + ts * 0.04 + jitter(rng, ts * 0.02),
        runnerTop - ts * 0.08 + i * ts * 0.02,
        ts * 0.012,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // The chute down from the loft, iron-banded, with its slide gate.
    const chuteTopX = stoneCx + ts * 0.7;
    const chuteTopY = box.top - ts * 0.95;
    const chuteEndX = stoneCx + hopperHalfTop * 0.4;
    const chuteEndY = hopperTop - ts * 0.12;
    const chuteW = ts * 0.24;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.42));
    ctx.beginPath();
    ctx.moveTo(chuteTopX - chuteW * 0.5, chuteTopY);
    ctx.lineTo(chuteTopX + chuteW * 0.5, chuteTopY);
    ctx.lineTo(chuteEndX + chuteW * 0.5, chuteEndY);
    ctx.lineTo(chuteEndX - chuteW * 0.5, chuteEndY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(SOOT, 0.3);
    ctx.beginPath();
    ctx.moveTo(chuteTopX + chuteW * 0.15, chuteTopY);
    ctx.lineTo(chuteTopX + chuteW * 0.5, chuteTopY);
    ctx.lineTo(chuteEndX + chuteW * 0.5, chuteEndY);
    ctx.lineTo(chuteEndX + chuteW * 0.15, chuteEndY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.45));
    ctx.lineWidth = ts * 0.035;
    for (const t of [0.2, 0.55, 0.85]) {
      const bx = chuteTopX + (chuteEndX - chuteTopX) * t;
      const by = chuteTopY + (chuteEndY - chuteTopY) * t;
      ctx.beginPath();
      ctx.moveTo(bx - chuteW * 0.55, by);
      ctx.lineTo(bx + chuteW * 0.55, by);
      ctx.stroke();
    }
    ctx.strokeStyle = rgb(GRAIN_GOLD);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(chuteEndX, chuteEndY);
    ctx.lineTo(chuteEndX - ts * 0.02, hopperTop);
    ctx.stroke();

    // The meal spout out of the platform's face, and the sack filling under it.
    const spoutX = stoneCx + ts * 0.3;
    const spoutTop = platFront + ts * 0.12;
    const sackCx = stoneCx + ts * 0.05;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.beginPath();
    ctx.moveTo(spoutX - ts * 0.1, spoutTop);
    ctx.lineTo(spoutX + ts * 0.1, spoutTop);
    ctx.lineTo(sackCx + ts * 0.08, platBottom + ts * 0.02);
    ctx.lineTo(sackCx - ts * 0.1, platBottom - ts * 0.02);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgba(FLOUR_WHITE, 0.4);
    ctx.beginPath();
    ctx.ellipse(sackCx, box.bottom - ts * 0.08, ts * 0.62, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    paintSack(ctx, sackCx, box.bottom - ts * 0.06, ts * 0.56, ts * 0.46, ts, forkRng(rng), {
      open: true,
    });
    ctx.strokeStyle = rgba(FLOUR_WHITE, 0.9);
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(sackCx - ts * 0.01, platBottom);
    ctx.lineTo(sackCx, box.bottom - ts * 0.44);
    ctx.stroke();

    // Two full sacks stacked at the platform's east end, and a mill bill.
    paintSack(
      ctx,
      box.right - ts * 0.72,
      box.bottom - ts * 0.06,
      ts * 0.48,
      ts * 0.5,
      ts,
      forkRng(rng),
      {
        stamp: true,
      },
    );
    paintSack(
      ctx,
      box.right - ts * 0.3,
      box.bottom - ts * 0.04,
      ts * 0.44,
      ts * 0.46,
      ts,
      forkRng(rng),
      {
        stamp: true,
        lean: ts * 0.04,
      },
    );
    const billX = box.left + ts * 0.5;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.6));
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(billX - ts * 0.2, box.bottom - ts * 0.08);
    ctx.lineTo(billX + ts * 0.18, box.bottom - ts * 0.3);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.6));
    ctx.beginPath();
    ctx.moveTo(billX + ts * 0.12, box.bottom - ts * 0.4);
    ctx.lineTo(billX + ts * 0.3, box.bottom - ts * 0.24);
    ctx.lineTo(billX + ts * 0.26, box.bottom - ts * 0.2);
    ctx.lineTo(billX + ts * 0.08, box.bottom - ts * 0.36);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.4);
  });
}

/** Running-bond brick laid across a rectangle, each brick its own tone with a lit top edge. */
function paintBrick(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  const clay = getTownRamp('oc_clay');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(clay, 0.12));
  ctx.fillRect(x, y, w, h);
  const courseH = ts * 0.13;
  const brickW = ts * 0.3;
  let row = 0;
  for (let cy = y; cy < y + h; cy += courseH) {
    const offset = row % 2 === 0 ? 0 : brickW * 0.5;
    for (let cx = x - offset; cx < x + w; cx += brickW) {
      const tone = 0.42 + jitter(rng, 0.12);
      ctx.fillStyle = rgb(sampleRamp(clay, tone));
      ctx.fillRect(cx + 1, cy + 1, brickW - 2, courseH - 2);
      ctx.fillStyle = rgba(sampleRamp(clay, 0.9), 0.35);
      ctx.fillRect(cx + 1, cy + 1, brickW - 2, Math.max(1, courseH * 0.18));
    }
    row++;
  }
  ctx.restore();
}

/**
 * Marta's hearth, built for a household that bakes: a brick chimney breast
 * with a wide firebox, a stew pot swung out over the fire on its crane, the
 * bread oven's iron door set into the breast beside it with its peel
 * leaning up against the brick, a mantel loaded with the day's loaves and
 * hung with onions, a ham and a copper pan, and the log basket, bellows and
 * kettle out on the hearthstone.
 */
export function paintFarmHearth(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    const stone = getTownRamp('oc_stone');
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.12,
      box.width * 0.47,
      ts * 0.2,
      0.3,
    );

    // Hearthstone flags across the front row.
    const slabTop = box.top + ts * 0.98;
    const slabBottom = box.bottom - ts * 0.06;
    const slabLeft = box.left + ts * 0.08;
    const slabRight = box.right - ts * 0.08;
    const slabCount = 5;
    const slabW = (slabRight - slabLeft) / slabCount;
    for (let i = 0; i < slabCount; i++) {
      for (let r = 0; r < 2; r++) {
        const sy = slabTop + ((slabBottom - slabTop) / 2) * r;
        const sx = slabLeft + slabW * i + (r === 1 ? slabW * 0.4 : 0);
        ctx.fillStyle = rgb(sampleRamp(stone, 0.5 + jitter(rng, 0.08)));
        ctx.beginPath();
        ctx.rect(sx, sy, Math.min(slabW, slabRight - sx), (slabBottom - slabTop) / 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.45);
      }
    }

    // Chimney breast and the narrower stack above the mantel.
    const breastLeft = box.left + ts * 0.12;
    const breastRight = box.right - ts * 0.12;
    const breastBottom = slabTop + ts * 0.02;
    const mantelY = box.top - ts * 0.1;
    const stackLeft = box.left + ts * 0.85;
    const stackRight = box.right - ts * 0.85;
    const stackTop = box.top - ts * 1.58;
    paintBrick(
      ctx,
      stackLeft,
      stackTop,
      stackRight - stackLeft,
      mantelY - stackTop,
      ts,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.22);
    ctx.fillRect(
      stackRight - (stackRight - stackLeft) * 0.3,
      stackTop,
      (stackRight - stackLeft) * 0.3,
      mantelY - stackTop,
    );
    ctx.beginPath();
    ctx.rect(stackLeft, stackTop, stackRight - stackLeft, mantelY - stackTop);
    inkOutline(ctx, ts);
    paintBrick(
      ctx,
      breastLeft,
      mantelY,
      breastRight - breastLeft,
      breastBottom - mantelY,
      ts,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.25);
    ctx.fillRect(breastRight - ts * 0.3, mantelY, ts * 0.3, breastBottom - mantelY);
    ctx.beginPath();
    ctx.rect(breastLeft, mantelY, breastRight - breastLeft, breastBottom - mantelY);
    inkOutline(ctx, ts);

    // The firebox: a wide arch, soot-black, fire on its dogs.
    const fireCx = box.left + ts * 1.55;
    const archLeft = fireCx - ts * 0.95;
    const archRight = fireCx + ts * 0.95;
    const archTop = mantelY + ts * 0.3;
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(archLeft, breastBottom);
    ctx.lineTo(archLeft, archTop + ts * 0.28);
    ctx.quadraticCurveTo(fireCx, archTop - ts * 0.2, archRight, archTop + ts * 0.28);
    ctx.lineTo(archRight, breastBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const fireY = breastBottom - ts * 0.08;
    const fire = ctx.createRadialGradient(fireCx, fireY, 1, fireCx, fireY, ts * 0.85);
    fire.addColorStop(0, rgb(FIRE_CORE));
    fire.addColorStop(0.4, rgba(FIRE_MID, 0.95));
    fire.addColorStop(1, rgba(FIRE_EDGE, 0));
    ctx.fillStyle = fire;
    ctx.beginPath();
    ctx.ellipse(fireCx, fireY, ts * 0.78, ts * 0.55, 0, Math.PI, 0);
    ctx.fill();
    for (const [dx, tilt] of [
      [-0.3, 0.25],
      [0.28, -0.2],
      [0, 0],
    ] as const) {
      ctx.save();
      ctx.translate(fireCx + dx * ts, breastBottom - ts * 0.1);
      ctx.rotate(tilt);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.2));
      ctx.fillRect(-ts * 0.3, -ts * 0.06, ts * 0.6, ts * 0.12);
      ctx.fillStyle = rgba(FIRE_MID, 0.8);
      ctx.fillRect(-ts * 0.3, -ts * 0.06, ts * 0.6, ts * 0.03);
      ctx.restore();
    }
    for (const [dx, hgt] of [
      [-0.2, 0.42],
      [0.05, 0.55],
      [0.28, 0.38],
    ] as const) {
      const fx = fireCx + dx * ts;
      ctx.fillStyle = rgb(FIRE_MID);
      ctx.beginPath();
      ctx.moveTo(fx - ts * 0.1, breastBottom - ts * 0.1);
      ctx.quadraticCurveTo(
        fx - ts * 0.08,
        breastBottom - ts * hgt * 0.7,
        fx,
        breastBottom - ts * hgt,
      );
      ctx.quadraticCurveTo(
        fx + ts * 0.1,
        breastBottom - ts * hgt * 0.6,
        fx + ts * 0.1,
        breastBottom - ts * 0.1,
      );
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgb(FIRE_CORE);
      ctx.beginPath();
      ctx.ellipse(fx, breastBottom - ts * 0.16, ts * 0.045, ts * hgt * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // The crane, swung out with the stew pot on its hook.
    const craneY = archTop + ts * 0.26;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
    ctx.lineWidth = ts * 0.05;
    ctx.beginPath();
    ctx.moveTo(archLeft + ts * 0.1, archTop + ts * 0.2);
    ctx.lineTo(archLeft + ts * 0.1, breastBottom - ts * 0.2);
    ctx.moveTo(archLeft + ts * 0.1, craneY);
    ctx.lineTo(fireCx + ts * 0.12, craneY);
    ctx.moveTo(archLeft + ts * 0.1, craneY + ts * 0.3);
    ctx.lineTo(fireCx - ts * 0.3, craneY);
    ctx.stroke();
    const potCx = fireCx + ts * 0.05;
    const potTop = craneY + ts * 0.26;
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(potCx, craneY);
    ctx.lineTo(potCx, potTop - ts * 0.06);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.3));
    ctx.beginPath();
    ctx.moveTo(potCx - ts * 0.3, potTop);
    ctx.quadraticCurveTo(potCx - ts * 0.34, potTop + ts * 0.36, potCx, potTop + ts * 0.38);
    ctx.quadraticCurveTo(potCx + ts * 0.34, potTop + ts * 0.36, potCx + ts * 0.3, potTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgba(FIRE_MID, 0.45);
    ctx.beginPath();
    ctx.ellipse(potCx, potTop + ts * 0.3, ts * 0.22, ts * 0.06, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.beginPath();
    ctx.ellipse(potCx, potTop, ts * 0.3, ts * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(STEW);
    ctx.beginPath();
    ctx.ellipse(potCx, potTop + ts * 0.01, ts * 0.24, ts * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(FLOUR_WHITE, 0.4);
    ctx.lineWidth = ts * 0.03;
    for (const dx of [-0.1, 0.08]) {
      ctx.beginPath();
      ctx.moveTo(potCx + dx * ts, potTop - ts * 0.04);
      ctx.bezierCurveTo(
        potCx + dx * ts - ts * 0.1,
        potTop - ts * 0.18,
        potCx + dx * ts + ts * 0.1,
        potTop - ts * 0.26,
        potCx + dx * ts,
        potTop - ts * 0.38,
      );
      ctx.stroke();
    }

    // The bread oven's iron door in the breast, glowing at its seams, and its peel.
    const ovenCx = box.right - ts * 0.95;
    const ovenTop = mantelY + ts * 0.36;
    const ovenBottom = breastBottom - ts * 0.3;
    const ovenHalfW = ts * 0.34;
    ctx.fillStyle = rgb(sampleRamp(stone, 0.6));
    ctx.beginPath();
    ctx.moveTo(ovenCx - ovenHalfW - ts * 0.08, ovenBottom + ts * 0.08);
    ctx.lineTo(ovenCx - ovenHalfW - ts * 0.08, ovenTop + ts * 0.2);
    ctx.quadraticCurveTo(
      ovenCx,
      ovenTop - ts * 0.18,
      ovenCx + ovenHalfW + ts * 0.08,
      ovenTop + ts * 0.2,
    );
    ctx.lineTo(ovenCx + ovenHalfW + ts * 0.08, ovenBottom + ts * 0.08);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    paintGlow(ctx, ovenCx, (ovenTop + ovenBottom) / 2, ts * 0.55, FIRE_MID, 0.35);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
    ctx.beginPath();
    ctx.moveTo(ovenCx - ovenHalfW, ovenBottom);
    ctx.lineTo(ovenCx - ovenHalfW, ovenTop + ts * 0.2);
    ctx.quadraticCurveTo(ovenCx, ovenTop - ts * 0.06, ovenCx + ovenHalfW, ovenTop + ts * 0.2);
    ctx.lineTo(ovenCx + ovenHalfW, ovenBottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(FIRE_CORE, 0.85);
    ctx.lineWidth = ts * 0.025;
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.7));
    for (const dy of [0.35, 0.7]) {
      ctx.fillRect(
        ovenCx - ovenHalfW,
        ovenTop + (ovenBottom - ovenTop) * dy,
        ovenHalfW * 2,
        ts * 0.035,
      );
    }
    ctx.beginPath();
    ctx.arc(
      ovenCx + ovenHalfW * 0.55,
      (ovenTop + ovenBottom) / 2 + ts * 0.04,
      ts * 0.04,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    const peelX = box.right - ts * 0.3;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.62));
    ctx.lineWidth = ts * 0.045;
    ctx.beginPath();
    ctx.moveTo(peelX, box.top - ts * 0.45);
    ctx.lineTo(peelX + ts * 0.06, breastBottom + ts * 0.3);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(wood, 0.7));
    ctx.beginPath();
    ctx.ellipse(
      peelX + ts * 0.07,
      breastBottom + ts * 0.42,
      ts * 0.13,
      ts * 0.22,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.5);

    // Mantel beam and what stands on it.
    const mantelH = ts * 0.16;
    const mantelLeft = box.left + ts * 0.04;
    const mantelW = box.width - ts * 0.08;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.42));
    ctx.fillRect(mantelLeft, mantelY - mantelH * 0.5, mantelW, mantelH);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.75);
    ctx.fillRect(mantelLeft, mantelY - mantelH * 0.5, mantelW, ts * 0.03);
    ctx.beginPath();
    ctx.rect(mantelLeft, mantelY - mantelH * 0.5, mantelW, mantelH);
    inkOutline(ctx, ts);
    const mantelTop = mantelY - mantelH * 0.5;
    paintStandingPlate(ctx, box.left + ts * 0.32, mantelTop, ts * 0.17, ts);
    paintJug(ctx, box.left + ts * 0.66, mantelTop, ts * 0.3, GLAZE_GREEN, ts);
    paintLoaf(ctx, box.left + ts * 2.55, mantelTop, ts * 0.32, ts);
    paintLoaf(ctx, box.left + ts * 2.9, mantelTop, ts * 0.28, ts);
    paintStandingPlate(ctx, box.right - ts * 0.72, mantelTop, ts * 0.15, ts);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.6));
    ctx.fillRect(box.right - ts * 0.34, mantelTop - ts * 0.06, ts * 0.1, ts * 0.06);
    ctx.fillStyle = rgb(MUSLIN);
    ctx.fillRect(box.right - ts * 0.32, mantelTop - ts * 0.26, ts * 0.06, ts * 0.2);
    ctx.fillStyle = rgb(FIRE_CORE);
    ctx.beginPath();
    ctx.ellipse(
      box.right - ts * 0.29,
      mantelTop - ts * 0.31,
      ts * 0.025,
      ts * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    paintGlow(ctx, box.right - ts * 0.29, mantelTop - ts * 0.3, ts * 0.2, FIRE_CORE, 0.3);

    // Hung off the mantel's face: onions, the ham, garlic, a copper pan.
    const hangY = mantelY + mantelH * 0.5;
    paintBulbString(ctx, box.left + ts * 0.35, hangY, ts * 0.5, ONION, ts, forkRng(rng));
    paintHam(ctx, box.left + ts * 2.72, hangY, ts * 0.46, ts);
    paintBulbString(ctx, box.left + ts * 3.05, hangY, ts * 0.36, GARLIC, ts, forkRng(rng));
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = ts * 0.02;
    const panX = box.left + ts * 2.38;
    ctx.beginPath();
    ctx.moveTo(panX, hangY);
    ctx.lineTo(panX, hangY + ts * 0.12);
    ctx.stroke();
    ctx.fillStyle = rgb(COPPER);
    ctx.beginPath();
    ctx.arc(panX, hangY + ts * 0.3, ts * 0.15, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(COPPER_LIGHT);
    ctx.beginPath();
    ctx.arc(panX - ts * 0.04, hangY + ts * 0.26, ts * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Firelight thrown out across the hearthstone.
    paintGlow(ctx, fireCx, breastBottom + ts * 0.2, ts * 1.25, FIRE_MID, 0.32);

    // Out on the hearthstone: log basket, bellows, kettle.
    const basketCx = box.left + ts * 0.42;
    const basketBottom = slabBottom - ts * 0.04;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.beginPath();
    ctx.moveTo(basketCx - ts * 0.3, basketBottom - ts * 0.32);
    ctx.lineTo(basketCx + ts * 0.3, basketBottom - ts * 0.32);
    ctx.lineTo(basketCx + ts * 0.24, basketBottom);
    ctx.lineTo(basketCx - ts * 0.24, basketBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    for (const [dx, dy] of [
      [-0.14, 0.36],
      [0.1, 0.38],
      [-0.02, 0.48],
    ] as const) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
      ctx.beginPath();
      ctx.ellipse(
        basketCx + dx * ts,
        basketBottom - dy * ts,
        ts * 0.1,
        ts * 0.08,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.4);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.85));
      ctx.beginPath();
      ctx.ellipse(
        basketCx + dx * ts - ts * 0.02,
        basketBottom - dy * ts,
        ts * 0.05,
        ts * 0.045,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const kettleCx = box.right - ts * 1.55;
    const kettleBottom = slabBottom - ts * 0.08;
    ctx.fillStyle = rgb(COPPER);
    ctx.beginPath();
    ctx.ellipse(kettleCx, kettleBottom - ts * 0.16, ts * 0.2, ts * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.55);
    ctx.fillStyle = rgb(COPPER_LIGHT);
    ctx.beginPath();
    ctx.ellipse(
      kettleCx - ts * 0.07,
      kettleBottom - ts * 0.22,
      ts * 0.06,
      ts * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = rgb(COPPER);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(kettleCx + ts * 0.16, kettleBottom - ts * 0.18);
    ctx.lineTo(kettleCx + ts * 0.3, kettleBottom - ts * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(kettleCx, kettleBottom - ts * 0.34, ts * 0.12, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    const bellowsX = box.left + ts * 1.0;
    const bellowsY = slabBottom - ts * 0.18;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.beginPath();
    ctx.moveTo(bellowsX - ts * 0.2, bellowsY - ts * 0.1);
    ctx.lineTo(bellowsX + ts * 0.12, bellowsY - ts * 0.05);
    ctx.lineTo(bellowsX + ts * 0.3, bellowsY);
    ctx.lineTo(bellowsX + ts * 0.12, bellowsY + ts * 0.06);
    ctx.lineTo(bellowsX - ts * 0.2, bellowsY + ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(BELLOWS_LEATHER);
    ctx.fillRect(bellowsX - ts * 0.12, bellowsY - ts * 0.04, ts * 0.2, ts * 0.08);
  });
}

/** A scrubbed-pine board: the table top's own pale ramp, lighter than any stained timber in the room. */
function scrubbedPine(t: number): RGB {
  return mix(sampleRamp(woodRamp(), 0.7), FLOUR_WHITE, t);
}

/** A shallow bowl seen from above the rim, with what is in it. */
function paintBowl(ctx: Ctx, cx: number, cy: number, r: number, fill: RGB, ts: number): void {
  ctx.fillStyle = rgb(EARTHENWARE);
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.2, r, r * 0.55, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = rgb(EARTHENWARE_LIGHT);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.4);
  ctx.fillStyle = rgb(fill);
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.04, r * 0.75, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The family table, three tiles of scrubbed pine with a bench down each
 * side: a board of dough and its rolling pin at one end, the day's loaf
 * and a knife in the middle, bowls, a milk jug, the butter crock and a
 * candle stub — breakfast and the baking happening on the same boards.
 */
export function paintFarmTable(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.5,
      box.width * 0.46,
      ts * 0.32,
      0.34,
    );

    const benchInset = ts * 0.3;
    // The far bench, only its seat showing past the table.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.fillRect(box.left + benchInset, box.top + ts * 0.1, box.width - benchInset * 2, ts * 0.16);
    ctx.beginPath();
    ctx.rect(box.left + benchInset, box.top + ts * 0.1, box.width - benchInset * 2, ts * 0.16);
    inkOutline(ctx, ts * 0.7);

    const topLeft = box.left + ts * 0.1;
    const topRight = box.right - ts * 0.1;
    const topBack = box.top + ts * 0.3;
    const topFront = box.bottom - ts * 0.74;
    const apronH = ts * 0.12;
    const legBottom = box.bottom - ts * 0.3;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (const lx of [topLeft + ts * 0.08, topRight - ts * 0.2, box.centreX - ts * 0.06]) {
      ctx.fillRect(lx, topFront + apronH, ts * 0.12, legBottom - topFront - apronH);
    }
    ctx.fillStyle = rgb(scrubbedPine(0.25));
    ctx.beginPath();
    ctx.rect(topLeft, topBack, topRight - topLeft, topFront - topBack);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const boards = 4;
    const boardH = (topFront - topBack) / boards;
    for (let b = 0; b < boards; b++) {
      ctx.fillStyle = rgb(scrubbedPine(0.18 + jitter(rng, 0.08)));
      ctx.fillRect(topLeft, topBack + b * boardH + 1, topRight - topLeft, boardH - 1);
      ctx.strokeStyle = rgba(sampleRamp(wood, 0.3), 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(topLeft, topBack + b * boardH);
      ctx.lineTo(topRight, topBack + b * boardH);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.rect(topLeft, topBack, topRight - topLeft, topFront - topBack);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.45));
    ctx.fillRect(topLeft, topFront, topRight - topLeft, apronH);
    ctx.beginPath();
    ctx.rect(topLeft, topFront, topRight - topLeft, apronH);
    inkOutline(ctx, ts * 0.7);

    // The near bench.
    const benchTop = box.bottom - ts * 0.4;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (const lx of [box.left + benchInset + ts * 0.06, box.right - benchInset - ts * 0.16]) {
      ctx.fillRect(lx, benchTop + ts * 0.1, ts * 0.1, box.bottom - ts * 0.04 - benchTop - ts * 0.1);
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.fillRect(box.left + benchInset, benchTop, box.width - benchInset * 2, ts * 0.1);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.fillRect(box.left + benchInset, benchTop + ts * 0.1, box.width - benchInset * 2, ts * 0.06);
    ctx.beginPath();
    ctx.rect(box.left + benchInset, benchTop, box.width - benchInset * 2, ts * 0.16);
    inkOutline(ctx, ts * 0.7);

    // What is on the table.
    const midY = (topBack + topFront) / 2;
    const boardX = topLeft + ts * 0.15;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.72));
    ctx.beginPath();
    ctx.rect(boardX, midY - ts * 0.3, ts * 0.85, ts * 0.58);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgba(FLOUR_WHITE, 0.8);
    ctx.beginPath();
    ctx.ellipse(boardX + ts * 0.45, midY, ts * 0.4, ts * 0.24, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(DOUGH_SHADOW);
    ctx.beginPath();
    ctx.ellipse(boardX + ts * 0.42, midY + ts * 0.04, ts * 0.24, ts * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(DOUGH);
    ctx.beginPath();
    ctx.ellipse(boardX + ts * 0.4, midY, ts * 0.22, ts * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.4);
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.75));
    ctx.lineWidth = ts * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(boardX + ts * 0.8, midY - ts * 0.26);
    ctx.lineTo(boardX + ts * 1.15, midY + ts * 0.0);
    ctx.stroke();
    ctx.lineCap = 'butt';
    paintLoaf(ctx, box.centreX + ts * 0.05, midY + ts * 0.08, ts * 0.46, ts);
    ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.8));
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(box.centreX + ts * 0.3, midY + ts * 0.2);
    ctx.lineTo(box.centreX + ts * 0.62, midY + ts * 0.12);
    ctx.stroke();
    paintBowl(ctx, box.centreX + ts * 0.8, midY - ts * 0.12, ts * 0.15, DOUGH, ts);
    paintBowl(ctx, box.centreX + ts * 1.12, midY + ts * 0.14, ts * 0.14, MILK, ts);
    paintJug(ctx, topRight - ts * 0.22, midY + ts * 0.2, ts * 0.36, MILK, ts);
    ctx.fillStyle = rgb(GLAZE_GREEN);
    ctx.beginPath();
    ctx.ellipse(box.centreX - ts * 0.35, midY - ts * 0.18, ts * 0.12, ts * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.4);
    ctx.fillStyle = rgb(BUTTER);
    ctx.beginPath();
    ctx.ellipse(box.centreX - ts * 0.35, midY - ts * 0.19, ts * 0.08, ts * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(MUSLIN);
    ctx.fillRect(box.centreX - ts * 0.72, midY - ts * 0.28, ts * 0.05, ts * 0.13);
    ctx.fillStyle = rgb(FIRE_CORE);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX - ts * 0.695,
      midY - ts * 0.32,
      ts * 0.02,
      ts * 0.04,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = rgba(FLOUR_WHITE, 0.4);
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(
        boardX + ts * (0.9 + jitter(rng, 0.25)),
        midY + jitter(rng, ts * 0.2),
        ts * 0.018,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

/**
 * The kneading trough on its legs by the oven, lid tipped back against the
 * wall and a batch rising under a cloth inside it, the dredger and scraper
 * left on the lid and a sack of the mill's own flour slumped beside it.
 */
export function paintBakeTrough(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(
      ctx,
      box.left + ts * 0.8,
      box.bottom - ts * 0.12,
      ts * 0.8,
      ts * 0.18,
      0.32,
    );
    const troughLeft = box.left + ts * 0.1;
    const troughRight = box.left + ts * 1.45;
    const lipY = box.bottom - ts * 0.72;
    const floorY = box.bottom - ts * 0.34;
    const legBottom = box.bottom - ts * 0.05;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.28));
    for (const lx of [troughLeft + ts * 0.1, troughRight - ts * 0.2]) {
      ctx.fillRect(lx, floorY, ts * 0.1, legBottom - floorY);
    }
    // The lid, tipped back.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.beginPath();
    ctx.moveTo(troughLeft - ts * 0.02, lipY - ts * 0.08);
    ctx.lineTo(troughLeft + ts * 0.04, lipY - ts * 0.55);
    ctx.lineTo(troughRight - ts * 0.04, lipY - ts * 0.55);
    ctx.lineTo(troughRight + ts * 0.02, lipY - ts * 0.08);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.7));
    ctx.fillRect(troughLeft + ts * 0.35, lipY - ts * 0.5, ts * 0.12, ts * 0.16);
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.55));
    ctx.fillRect(troughLeft + ts * 0.34, lipY - ts * 0.52, ts * 0.14, ts * 0.04);
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.6));
    ctx.fillRect(troughRight - ts * 0.55, lipY - ts * 0.4, ts * 0.22, ts * 0.12);
    // The tapered body.
    ctx.beginPath();
    ctx.moveTo(troughLeft, lipY);
    ctx.lineTo(troughRight, lipY);
    ctx.lineTo(troughRight - ts * 0.12, floorY);
    ctx.lineTo(troughLeft + ts * 0.12, floorY);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    paintPlankBoard(ctx, troughLeft, lipY, troughRight - troughLeft, floorY - lipY, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.13,
      ramp: wood,
    });
    ctx.restore();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(MUSLIN);
    ctx.beginPath();
    ctx.moveTo(troughLeft + ts * 0.04, lipY + ts * 0.02);
    ctx.quadraticCurveTo(
      (troughLeft + troughRight) / 2,
      lipY - ts * 0.26,
      troughRight - ts * 0.04,
      lipY + ts * 0.02,
    );
    ctx.lineTo(troughRight - ts * 0.1, lipY + ts * 0.1);
    ctx.lineTo(troughLeft + ts * 0.1, lipY + ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.strokeStyle = rgba(BURLAP_SHADOW, 0.6);
    ctx.lineWidth = 1;
    for (const t of [0.3, 0.55, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(troughLeft + (troughRight - troughLeft) * t, lipY - ts * 0.12);
      ctx.lineTo(troughLeft + (troughRight - troughLeft) * t + ts * 0.03, lipY + ts * 0.08);
      ctx.stroke();
    }
    paintSack(
      ctx,
      box.right - ts * 0.3,
      box.bottom - ts * 0.04,
      ts * 0.48,
      ts * 0.62,
      ts,
      forkRng(rng),
      {
        stamp: true,
        lean: -ts * 0.05,
      },
    );
  });
}

/**
 * The kitchen dresser: a cupboard base under a three-rail rack of the
 * household's blue-and-white plates, cups hung from hooks under the top
 * shelf and the year's preserves in a row along the bottom one.
 */
export function paintFarmDresser(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const baseTop = box.bottom - ts * 0.62;
    const baseBottom = box.bottom - ts * 0.04;
    const hutchTop = box.top - ts * 0.86;
    // Hutch back board.
    paintPlankBoard(
      ctx,
      left + ts * 0.08,
      hutchTop,
      right - left - ts * 0.16,
      baseTop - hutchTop,
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: ts * 0.3,
        ramp: wood,
      },
    );
    ctx.fillStyle = rgba(SOOT, 0.3);
    ctx.fillRect(left + ts * 0.08, hutchTop, right - left - ts * 0.16, baseTop - hutchTop);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.fillRect(left + ts * 0.02, hutchTop, ts * 0.1, baseTop - hutchTop);
    ctx.fillRect(right - ts * 0.12, hutchTop, ts * 0.1, baseTop - hutchTop);
    ctx.beginPath();
    ctx.rect(left + ts * 0.02, hutchTop, right - left - ts * 0.04, baseTop - hutchTop);
    inkOutline(ctx, ts);
    // Cornice.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.fillRect(left - ts * 0.02, hutchTop - ts * 0.1, right - left + ts * 0.04, ts * 0.12);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.7);
    ctx.fillRect(left - ts * 0.02, hutchTop - ts * 0.1, right - left + ts * 0.04, ts * 0.03);
    ctx.beginPath();
    ctx.rect(left - ts * 0.02, hutchTop - ts * 0.1, right - left + ts * 0.04, ts * 0.12);
    inkOutline(ctx, ts * 0.7);

    const shelfYs = [hutchTop + ts * 0.44, hutchTop + ts * 0.86, baseTop - ts * 0.02];
    const innerLeft = left + ts * 0.16;
    const innerRight = right - ts * 0.16;
    for (const sy of shelfYs) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.6));
      ctx.fillRect(left + ts * 0.08, sy - ts * 0.04, right - left - ts * 0.16, ts * 0.06);
    }
    // Top two rails: standing plates, big and small alternating.
    for (let row = 0; row < 2; row++) {
      const sy = shelfYs[row] - ts * 0.04;
      let x = innerLeft + ts * 0.14;
      let i = 0;
      while (x < innerRight - ts * 0.1) {
        const r = i % 2 === 0 ? ts * 0.17 : ts * 0.13;
        paintStandingPlate(ctx, x, sy, r, ts);
        x += r * 2 + ts * 0.04;
        i++;
      }
      ctx.strokeStyle = rgb(sampleRamp(wood, 0.4));
      ctx.lineWidth = ts * 0.025;
      ctx.beginPath();
      ctx.moveTo(left + ts * 0.1, sy - ts * 0.12);
      ctx.lineTo(right - ts * 0.1, sy - ts * 0.12);
      ctx.stroke();
    }
    // Cups hung under the top shelf.
    for (let i = 0; i < 5; i++) {
      const cx = innerLeft + ts * 0.2 + i * ((innerRight - innerLeft - ts * 0.4) / 4);
      const cy = shelfYs[0] + ts * 0.1;
      ctx.fillStyle = rgb(i % 2 === 0 ? PLATE_BLUE : PLATE_WHITE);
      ctx.beginPath();
      ctx.rect(cx - ts * 0.05, cy, ts * 0.1, ts * 0.09);
      ctx.fill();
      inkOutline(ctx, ts * 0.3);
    }
    // Bottom shelf: preserves, labelled by colour.
    const jarFills: readonly RGB[] = [
      JAM_RED,
      HONEY,
      PICKLE_GREEN,
      JAM_RED,
      HONEY,
      PICKLE_GREEN,
      JAM_RED,
    ];
    const jarStep = (innerRight - innerLeft) / jarFills.length;
    for (let i = 0; i < jarFills.length; i++) {
      paintPreserveJar(
        ctx,
        innerLeft + jarStep * (i + 0.5),
        shelfYs[2] - ts * 0.04,
        ts * (0.22 + jitter(rng, 0.03)),
        jarFills[i],
        ts,
      );
    }

    // Cupboard base: three doors, a drawer row, a worktop.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.45));
    ctx.fillRect(left, baseTop, right - left, baseBottom - baseTop);
    ctx.beginPath();
    ctx.rect(left, baseTop, right - left, baseBottom - baseTop);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.7));
    ctx.fillRect(left - ts * 0.03, baseTop - ts * 0.02, right - left + ts * 0.06, ts * 0.07);
    const doorCount = 3;
    const doorW = (right - left - ts * 0.16) / doorCount;
    for (let d = 0; d < doorCount; d++) {
      const dx = left + ts * 0.08 + d * doorW;
      ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
      ctx.fillRect(dx + ts * 0.03, baseTop + ts * 0.1, doorW - ts * 0.06, ts * 0.1);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
      ctx.fillRect(
        dx + ts * 0.03,
        baseTop + ts * 0.24,
        doorW - ts * 0.06,
        baseBottom - baseTop - ts * 0.3,
      );
      ctx.strokeStyle = rgba(SOOT, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(
        dx + ts * 0.08,
        baseTop + ts * 0.29,
        doorW - ts * 0.16,
        baseBottom - baseTop - ts * 0.4,
      );
      ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.8));
      ctx.beginPath();
      ctx.arc(dx + doorW / 2, baseTop + ts * 0.15, ts * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    paintJug(ctx, left + ts * 0.35, baseTop - ts * 0.02, ts * 0.34, EARTHENWARE_LIGHT, ts);
    paintBowl(ctx, right - ts * 0.4, baseTop - ts * 0.08, ts * 0.17, GRAIN_GOLD, ts);
  });
}

/**
 * The larder shelves: cheeses on the top board, eggs and a butter crock
 * below, and hung off the rail — a string of onions, one of garlic and a
 * cured ham in its muslin.
 */
export function paintLarderShelf(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame);
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    const topY = box.top - ts * 0.88;
    const bottomY = box.bottom - ts * 0.04;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(left, topY, ts * 0.1, bottomY - topY);
    ctx.fillRect(right - ts * 0.1, topY, ts * 0.1, bottomY - topY);
    ctx.fillRect(box.centreX - ts * 0.05, topY, ts * 0.1, bottomY - topY);
    ctx.fillStyle = rgba(SOOT, 0.35);
    ctx.fillRect(left + ts * 0.1, topY, right - left - ts * 0.2, bottomY - topY);
    ctx.beginPath();
    ctx.rect(left, topY, right - left, bottomY - topY);
    inkOutline(ctx, ts);
    const shelves = [
      topY + ts * 0.05,
      topY + ts * 0.56,
      box.bottom - ts * 0.5,
      bottomY - ts * 0.06,
    ];
    for (const sy of shelves) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
      ctx.fillRect(left, sy, right - left, ts * 0.07);
      ctx.beginPath();
      ctx.rect(left, sy, right - left, ts * 0.07);
      inkOutline(ctx, ts * 0.5);
    }
    // Top board: two wheels of cheese and a cut one.
    const cheeseBase = shelves[1];
    for (const [cx, r] of [
      [left + ts * 0.35, 0.22],
      [left + ts * 0.8, 0.19],
    ] as const) {
      const rr = ts * r;
      ctx.fillStyle = rgb(CHEESE_RIND);
      ctx.beginPath();
      ctx.rect(cx - rr, cheeseBase - rr * 0.8, rr * 2, rr * 0.8);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cheeseBase - rr * 0.8, rr, rr * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgb(CHEESE);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - rr, cheeseBase - rr * 0.8);
      ctx.lineTo(cx - rr, cheeseBase);
      ctx.lineTo(cx + rr, cheeseBase);
      ctx.lineTo(cx + rr, cheeseBase - rr * 0.8);
      inkOutline(ctx, ts * 0.5);
    }
    const wedgeX = right - ts * 0.4;
    ctx.fillStyle = rgb(CHEESE);
    ctx.beginPath();
    ctx.moveTo(wedgeX - ts * 0.18, cheeseBase);
    ctx.lineTo(wedgeX + ts * 0.2, cheeseBase);
    ctx.lineTo(wedgeX + ts * 0.2, cheeseBase - ts * 0.2);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    paintJug(ctx, right - ts * 0.72, cheeseBase, ts * 0.3, GLAZE_GREEN, ts);
    // Middle board: eggs in a bowl, a butter crock, preserves.
    const midBase = shelves[2];
    paintBowl(ctx, left + ts * 0.4, midBase - ts * 0.08, ts * 0.22, EARTHENWARE_LIGHT, ts);
    ctx.fillStyle = rgb(MILK);
    for (const dx of [-0.1, 0, 0.1, -0.05, 0.05]) {
      ctx.beginPath();
      ctx.ellipse(
        left + ts * (0.4 + dx),
        midBase - ts * (0.13 + (Math.abs(dx) < 0.07 ? 0.04 : 0)),
        ts * 0.05,
        ts * 0.065,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.25);
    }
    paintPreserveJar(ctx, box.centreX + ts * 0.2, midBase, ts * 0.26, HONEY, ts);
    paintPreserveJar(ctx, box.centreX + ts * 0.46, midBase, ts * 0.22, JAM_RED, ts);
    paintPreserveJar(ctx, right - ts * 0.2, midBase, ts * 0.26, PICKLE_GREEN, ts);
    // The floor board: a crock and a basket of potatoes.
    ctx.fillStyle = rgb(EARTHENWARE);
    ctx.beginPath();
    ctx.ellipse(left + ts * 0.42, shelves[3] - ts * 0.18, ts * 0.2, ts * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(EARTHENWARE_LIGHT);
    ctx.beginPath();
    ctx.ellipse(left + ts * 0.36, shelves[3] - ts * 0.25, ts * 0.07, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = rgb(mix(BREAD_LIGHT, BURLAP_SHADOW, 0.4 + jitter(rng, 0.1)));
      ctx.beginPath();
      ctx.ellipse(
        right - ts * (0.25 + (i % 3) * 0.13),
        shelves[3] - ts * (0.07 + Math.floor(i / 3) * 0.08),
        ts * 0.07,
        ts * 0.05,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.25);
    }
    // Hung from the top rail.
    paintBulbString(ctx, left + ts * 0.25, topY + ts * 0.12, ts * 0.4, ONION, ts, forkRng(rng));
    paintHam(ctx, box.centreX + ts * 0.3, topY + ts * 0.12, ts * 0.42, ts);
    paintBulbString(ctx, right - ts * 0.2, topY + ts * 0.12, ts * 0.34, GARLIC, ts, forkRng(rng));
  });
}

/**
 * Corvin's pallet against the wall: a straw tick under a patched blanket,
 * the wooden sword he whittled leaning at its head, and above it, in chalk
 * on the plaster, a figure with a sword and a row of tally marks.
 */
export function paintCorvinPallet(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame);
    // Chalk on the wall above.
    ctx.strokeStyle = rgba(CHALK, 0.85);
    ctx.lineWidth = Math.max(1, ts * 0.022);
    ctx.lineCap = 'round';
    const figX = box.left + ts * 0.55;
    const figY = box.top - ts * 0.45;
    ctx.beginPath();
    ctx.arc(figX, figY - ts * 0.22, ts * 0.07, 0, Math.PI * 2);
    ctx.moveTo(figX, figY - ts * 0.15);
    ctx.lineTo(figX, figY + ts * 0.08);
    ctx.moveTo(figX, figY + ts * 0.08);
    ctx.lineTo(figX - ts * 0.08, figY + ts * 0.24);
    ctx.moveTo(figX, figY + ts * 0.08);
    ctx.lineTo(figX + ts * 0.08, figY + ts * 0.24);
    ctx.moveTo(figX - ts * 0.1, figY - ts * 0.08);
    ctx.lineTo(figX + ts * 0.1, figY - ts * 0.04);
    ctx.lineTo(figX + ts * 0.28, figY - ts * 0.3);
    ctx.stroke();
    const tallyLeft = box.left + ts * 0.95;
    for (let group = 0; group < 3; group++) {
      const gx = tallyLeft + group * ts * 0.3;
      for (let m = 0; m < 4; m++) {
        ctx.beginPath();
        ctx.moveTo(gx + m * ts * 0.045, figY - ts * 0.18);
        ctx.lineTo(gx + m * ts * 0.045 + jitter(rng, ts * 0.01), figY + ts * 0.02);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(gx - ts * 0.03, figY - ts * 0.02);
      ctx.lineTo(gx + ts * 0.17, figY - ts * 0.15);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // The pallet frame and tick.
    const frameTop = box.bottom - ts * 0.72;
    const frameBottom = box.bottom - ts * 0.08;
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.3;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.fillRect(left, frameBottom - ts * 0.14, right - left, ts * 0.14);
    ctx.beginPath();
    ctx.rect(left, frameBottom - ts * 0.14, right - left, ts * 0.14);
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(STRAW);
    ctx.beginPath();
    ctx.rect(
      left + ts * 0.04,
      frameTop,
      right - left - ts * 0.08,
      frameBottom - ts * 0.14 - frameTop,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgb(MUSLIN);
    ctx.beginPath();
    ctx.ellipse(left + ts * 0.3, frameTop + ts * 0.16, ts * 0.2, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    // A blanket, patched in two colours, thrown back.
    const blanketLeft = left + ts * 0.55;
    ctx.fillStyle = rgb(BLANKET_GREEN);
    ctx.beginPath();
    ctx.moveTo(blanketLeft, frameTop + ts * 0.02);
    ctx.lineTo(right - ts * 0.02, frameTop + ts * 0.02);
    ctx.lineTo(right, frameBottom - ts * 0.1);
    ctx.lineTo(blanketLeft - ts * 0.06, frameBottom - ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgb(BLANKET_RUST);
    ctx.fillRect(blanketLeft + ts * 0.3, frameTop + ts * 0.12, ts * 0.26, ts * 0.2);
    ctx.fillRect(blanketLeft + ts * 0.8, frameTop + ts * 0.3, ts * 0.22, ts * 0.18);
    ctx.strokeStyle = rgba(CHALK, 0.6);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(blanketLeft + ts * 0.3, frameTop + ts * 0.12, ts * 0.26, ts * 0.2);
    ctx.strokeRect(blanketLeft + ts * 0.8, frameTop + ts * 0.3, ts * 0.22, ts * 0.18);
    ctx.setLineDash([]);
    ctx.fillStyle = rgb(mix(BLANKET_GREEN, FLOUR_WHITE, 0.25));
    ctx.beginPath();
    ctx.moveTo(blanketLeft, frameTop + ts * 0.02);
    ctx.lineTo(blanketLeft + ts * 0.18, frameTop + ts * 0.02);
    ctx.lineTo(blanketLeft + ts * 0.12, frameBottom - ts * 0.1);
    ctx.lineTo(blanketLeft - ts * 0.06, frameBottom - ts * 0.1);
    ctx.closePath();
    ctx.fill();
    // The wooden sword, leaning at the head end.
    const swordX = box.right - ts * 0.15;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.75));
    ctx.save();
    ctx.translate(swordX, box.bottom - ts * 0.08);
    ctx.rotate(-0.12);
    ctx.fillRect(-ts * 0.035, -ts * 0.95, ts * 0.07, ts * 0.72);
    ctx.beginPath();
    ctx.rect(-ts * 0.035, -ts * 0.95, ts * 0.07, ts * 0.72);
    inkOutline(ctx, ts * 0.45);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.fillRect(-ts * 0.12, -ts * 0.25, ts * 0.24, ts * 0.05);
    ctx.fillRect(-ts * 0.03, -ts * 0.22, ts * 0.06, ts * 0.2);
    ctx.restore();
  });
}

/**
 * The mill's day of work, stacked for the cart: full sacks two courses
 * high on a pallet, each one stencilled with the mill's sheaf. Variant 1
 * has one sack slit open at the front with the scoop still in it.
 */
export function paintFlourSackStack(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.1,
      box.width * 0.46,
      ts * 0.18,
      0.34,
    );
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.fillRect(box.left + ts * 0.06, box.bottom - ts * 0.14, box.width - ts * 0.12, ts * 0.1);
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.06, box.bottom - ts * 0.14, box.width - ts * 0.12, ts * 0.1);
    inkOutline(ctx, ts * 0.6);
    const sackW = ts * 0.58;
    const sackH = ts * 0.5;
    const upperH = ts * 0.46;
    const lowerBottom = box.bottom - ts * 0.12;
    // Upper course first (behind), then the lower one in front of it.
    for (const t of [0.3, 0.7]) {
      paintSack(
        ctx,
        box.left + box.width * t,
        lowerBottom - sackH * 0.62,
        sackW,
        upperH,
        ts,
        forkRng(rng),
        {
          stamp: true,
          lean: jitter(rng, ts * 0.04),
        },
      );
    }
    const lowerCount = 3;
    for (let i = 0; i < lowerCount; i++) {
      const cx = box.left + ts * 0.36 + i * ((box.width - ts * 0.72) / (lowerCount - 1));
      const open = variant === 1 && i === 1;
      paintSack(ctx, cx, lowerBottom, sackW, sackH, ts, forkRng(rng), {
        stamp: !open,
        open,
        lean: jitter(rng, ts * 0.03),
      });
      if (open) {
        ctx.strokeStyle = rgb(sampleRamp(wood, 0.7));
        ctx.lineWidth = ts * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx + ts * 0.05, lowerBottom - sackH * 0.92);
        ctx.lineTo(cx + ts * 0.2, lowerBottom - sackH * 1.25);
        ctx.stroke();
        ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.75));
        ctx.beginPath();
        ctx.ellipse(
          cx + ts * 0.02,
          lowerBottom - sackH * 0.86,
          ts * 0.07,
          ts * 0.04,
          0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.fillStyle = rgba(FLOUR_WHITE, 0.35);
    ctx.beginPath();
    ctx.ellipse(box.centreX, box.bottom - ts * 0.06, box.width * 0.4, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * A steelyard on its gallows — the mill's sale scale: a sack hung off the
 * short arm, the poise run out along the notched long one, iron weights
 * stacked at the post's foot and a chalk slate of the week's tally.
 */
export function paintSteelyardScale(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    contactShadow(ctx, frame);
    const postX = box.left + ts * 0.62;
    const beamTopY = box.top - ts * 0.85;
    const floorY = box.bottom - ts * 0.08;
    // The gallows: a post, a foot, the arm out over the beam.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.fillRect(postX - ts * 0.07, beamTopY, ts * 0.14, floorY - beamTopY);
    ctx.fillRect(postX - ts * 0.3, floorY - ts * 0.1, ts * 0.6, ts * 0.1);
    ctx.fillRect(postX - ts * 0.07, beamTopY, ts * 0.85, ts * 0.12);
    ctx.beginPath();
    ctx.rect(postX - ts * 0.07, beamTopY, ts * 0.14, floorY - beamTopY);
    ctx.rect(postX - ts * 0.07, beamTopY, ts * 0.85, ts * 0.12);
    ctx.rect(postX - ts * 0.3, floorY - ts * 0.1, ts * 0.6, ts * 0.1);
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.3));
    ctx.lineWidth = ts * 0.07;
    ctx.beginPath();
    ctx.moveTo(postX, beamTopY + ts * 0.4);
    ctx.lineTo(postX + ts * 0.36, beamTopY + ts * 0.1);
    ctx.stroke();
    // The steelyard beam, hung from the arm's end.
    const pivotX = postX + ts * 0.62;
    const pivotY = beamTopY + ts * 0.36;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(pivotX, beamTopY + ts * 0.12);
    ctx.lineTo(pivotX, pivotY);
    ctx.stroke();
    const shortEnd = pivotX - ts * 0.3;
    const longEnd = box.right - ts * 0.1;
    const tilt = -0.04;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(tilt);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.fillRect(shortEnd - pivotX, -ts * 0.035, longEnd - shortEnd, ts * 0.07);
    ctx.beginPath();
    ctx.rect(shortEnd - pivotX, -ts * 0.035, longEnd - shortEnd, ts * 0.07);
    inkOutline(ctx, ts * 0.5);
    ctx.strokeStyle = rgba(CHALK, 0.7);
    ctx.lineWidth = 1;
    for (let n = 1; n < 8; n++) {
      const nx = (longEnd - pivotX) * (n / 8);
      ctx.beginPath();
      ctx.moveTo(nx, -ts * 0.035);
      ctx.lineTo(nx, ts * 0.0);
      ctx.stroke();
    }
    const poiseX = (longEnd - pivotX) * 0.66;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.3));
    ctx.beginPath();
    ctx.moveTo(poiseX - ts * 0.05, ts * 0.04);
    ctx.quadraticCurveTo(poiseX - ts * 0.13, ts * 0.26, poiseX, ts * 0.3);
    ctx.quadraticCurveTo(poiseX + ts * 0.13, ts * 0.26, poiseX + ts * 0.05, ts * 0.04);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.85));
    ctx.fillRect(poiseX - ts * 0.04, ts * 0.1, ts * 0.025, ts * 0.1);
    ctx.restore();
    // The sack on the short arm's hook.
    const hookX = shortEnd + ts * 0.04;
    const hookY = pivotY + ts * 0.02;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.55));
    ctx.lineWidth = ts * 0.02;
    ctx.beginPath();
    ctx.moveTo(hookX, hookY);
    ctx.lineTo(hookX, hookY + ts * 0.22);
    ctx.stroke();
    paintSack(ctx, hookX, floorY - ts * 0.16, ts * 0.46, ts * 0.72, ts, forkRng(rng), {
      stamp: true,
    });
    // Weights at the foot, and the tally slate leaned against the post.
    const weightX = box.right - ts * 0.55;
    for (let i = 0; i < 3; i++) {
      const wr = ts * (0.15 - i * 0.03);
      const wy = floorY - ts * 0.06 - i * ts * 0.1;
      ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
      ctx.fillRect(weightX - wr, wy - ts * 0.08, wr * 2, ts * 0.08);
      ctx.beginPath();
      ctx.ellipse(weightX, wy - ts * 0.08, wr, wr * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgb(sampleRamp(iron, 0.6));
      ctx.fill();
      inkOutline(ctx, ts * 0.35);
    }
    const slateX = box.right - ts * 0.28;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.fillRect(slateX - ts * 0.16, floorY - ts * 0.48, ts * 0.32, ts * 0.42);
    ctx.fillStyle = rgb(SLATE);
    ctx.fillRect(slateX - ts * 0.12, floorY - ts * 0.44, ts * 0.24, ts * 0.34);
    ctx.beginPath();
    ctx.rect(slateX - ts * 0.16, floorY - ts * 0.48, ts * 0.32, ts * 0.42);
    inkOutline(ctx, ts * 0.5);
    ctx.strokeStyle = rgba(CHALK, 0.85);
    ctx.lineWidth = 1;
    for (let row = 0; row < 3; row++) {
      for (let m = 0; m < 4; m++) {
        ctx.beginPath();
        ctx.moveTo(slateX - ts * 0.08 + m * ts * 0.04, floorY - ts * (0.4 - row * 0.1));
        ctx.lineTo(slateX - ts * 0.08 + m * ts * 0.04, floorY - ts * (0.34 - row * 0.1));
        ctx.stroke();
      }
    }
  });
}

/**
 * Flour tracked out across the flagstones from the stones: a pale drift at
 * the heart of it, thinning to a haze, with boot prints walked through it
 * toward the sacks. Walkable floor dressing.
 */
export function paintFlourDrift(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cy = box.top + box.height * 0.5;
    // Several overlapping puffs rather than one oval, so the drift has a ragged edge.
    const puffs = 6;
    for (let i = 0; i < puffs; i++) {
      const px = box.left + box.width * (0.18 + (i / (puffs - 1)) * 0.64) + jitter(rng, ts * 0.15);
      const py = cy + jitter(rng, box.height * 0.18);
      const pr = ts * (0.42 + jitter(rng, 0.12));
      const haze = ctx.createRadialGradient(px, py, 1, px, py, pr);
      haze.addColorStop(0, rgba(FLOUR_WHITE, 0.34));
      haze.addColorStop(1, rgba(FLOUR_WHITE, 0));
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.ellipse(px, py, pr, pr * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = rgba(FLOUR_WHITE, 0.35 + jitter(rng, 0.1));
      ctx.beginPath();
      ctx.ellipse(
        box.centreX + jitter(rng, box.width * 0.4),
        cy + jitter(rng, box.height * 0.3),
        ts * (0.08 + jitter(rng, 0.04)),
        ts * 0.04,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = rgba(sampleRamp(getTownRamp('oc_stone'), 0.2), 0.35);
    const prints = 5;
    for (let i = 0; i < prints; i++) {
      const px = box.left + box.width * (0.2 + (i / prints) * 0.65);
      const py = cy + (i % 2 === 0 ? -ts * 0.1 : ts * 0.1);
      ctx.beginPath();
      ctx.ellipse(px, py, ts * 0.07, ts * 0.035, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(px + ts * 0.09, py, ts * 0.035, ts * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * An open grain bin of slatted boards, heaped gold with this week's
 * threshing, the wooden scoop stuck in it and a bushel measure beside it.
 */
export function paintGrainBin(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    drawTownContactShadow(
      ctx,
      box.left + ts * 0.75,
      box.bottom - ts * 0.1,
      ts * 0.75,
      ts * 0.18,
      0.34,
    );
    const left = box.left + ts * 0.08;
    const right = box.left + ts * 1.4;
    const rimY = box.bottom - ts * 0.68;
    const floorY = box.bottom - ts * 0.06;
    const rimDepth = ts * 0.22;
    // The bin's back wall, seen over the heap.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(left + ts * 0.06, rimY - rimDepth, right - left - ts * 0.12, rimDepth);
    // The heap, domed above the rim.
    const heap = ctx.createRadialGradient(
      (left + right) / 2 - ts * 0.15,
      rimY - ts * 0.2,
      1,
      (left + right) / 2,
      rimY,
      ts * 0.8,
    );
    heap.addColorStop(0, rgb(mix(GRAIN_GOLD, FLOUR_WHITE, 0.25)));
    heap.addColorStop(1, rgb(GRAIN_SHADOW));
    ctx.fillStyle = heap;
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.04, rimY);
    ctx.quadraticCurveTo((left + right) / 2, rimY - ts * 0.5, right - ts * 0.04, rimY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgba(GRAIN_SHADOW, 0.7);
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.ellipse(
        left + (right - left) * (0.15 + rng() * 0.7),
        rimY - ts * (0.04 + rng() * 0.26),
        ts * 0.018,
        ts * 0.01,
        rng() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // The scoop, stuck handle-up in the heap.
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.72));
    ctx.lineWidth = ts * 0.05;
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.85, rimY - ts * 0.22);
    ctx.lineTo(left + ts * 1.05, rimY - ts * 0.62);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(wood, 0.6));
    ctx.beginPath();
    ctx.ellipse(left + ts * 0.8, rimY - ts * 0.18, ts * 0.12, ts * 0.06, -0.3, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.4);
    // The slatted front, iron-cornered.
    paintPlankBoard(ctx, left, rimY, right - left, floorY - rimY, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.15,
      ramp: wood,
    });
    ctx.fillStyle = rgba(SOOT, 0.18);
    ctx.fillRect(right - ts * 0.3, rimY, ts * 0.3, floorY - rimY);
    ctx.beginPath();
    ctx.rect(left, rimY, right - left, floorY - rimY);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    for (const cx of [left, right - ts * 0.08]) {
      ctx.fillRect(cx, rimY, ts * 0.08, ts * 0.12);
      ctx.fillRect(cx, floorY - ts * 0.12, ts * 0.08, ts * 0.12);
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.8));
    ctx.fillRect(left, rimY - ts * 0.02, right - left, ts * 0.04);
    ctx.fillStyle = rgba(GRAIN_GOLD, 0.8);
    ctx.beginPath();
    ctx.ellipse(right + ts * 0.06, floorY - ts * 0.02, ts * 0.12, ts * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    // The bushel measure: a banded wooden tub, full.
    const tubCx = box.right - ts * 0.3;
    const tubTop = box.bottom - ts * 0.46;
    const tubHalfW = ts * 0.2;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.beginPath();
    ctx.moveTo(tubCx - tubHalfW, tubTop);
    ctx.lineTo(tubCx + tubHalfW, tubTop);
    ctx.lineTo(tubCx + tubHalfW * 0.85, floorY);
    ctx.lineTo(tubCx - tubHalfW * 0.85, floorY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.45));
    ctx.lineWidth = ts * 0.03;
    for (const t of [0.25, 0.75]) {
      const y = tubTop + (floorY - tubTop) * t;
      ctx.beginPath();
      ctx.moveTo(tubCx - tubHalfW * (1 - t * 0.15), y);
      ctx.lineTo(tubCx + tubHalfW * (1 - t * 0.15), y);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(GRAIN_GOLD);
    ctx.beginPath();
    ctx.ellipse(tubCx, tubTop, tubHalfW, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.4);
  });
}
