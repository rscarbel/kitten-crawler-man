/**
 * Small painted pieces the three taverns all set out on their furniture —
 * tankards, bottles, candles, plates of food, cask ends, a plank table top —
 * so the inn, the mead hall and the dive dress their big pieces from one
 * consistent vocabulary, while each room's own file decides the wood, the
 * cloth and the mood around them.
 *
 * Every helper paints in the caller's frame coordinates and takes `ts` (the
 * frame's pixels per tile) so its proportions hold at any bake scale.
 */

import { rgb, rgba, inkOutline, jitter, forkRng, type Rng } from '../../town/townArt';
import { mix, sampleRamp, type Ramp, type RGB } from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

export const PEWTER: Ramp = {
  shadow: [70, 74, 80],
  mid: [128, 134, 140],
  light: [190, 196, 200],
  accent: [226, 230, 232],
};
export const BRASS: Ramp = {
  shadow: [104, 74, 30],
  mid: [168, 128, 58],
  light: [220, 184, 100],
  accent: [246, 222, 150],
};
export const COPPER: Ramp = {
  shadow: [98, 44, 26],
  mid: [168, 88, 50],
  light: [214, 136, 90],
  accent: [240, 184, 140],
};

export const FOAM: RGB = [240, 232, 206];
export const ALE: RGB = [196, 128, 40];
export const CANDLE_WAX: RGB = [232, 220, 186];
export const FLAME_CORE: RGB = [255, 236, 170];
export const FLAME_OUTER: RGB = [240, 150, 54];
export const FIRE_GLOW: RGB = [255, 170, 80];
export const CROCKERY_WHITE: RGB = [228, 222, 206];
export const CROCKERY_BLUE: RGB = [62, 92, 150];
export const BREAD: RGB = [196, 138, 70];
export const BREAD_DARK: RGB = [132, 82, 40];
export const STEW: RGB = [138, 74, 42];
export const ROAST: RGB = [170, 92, 44];
export const ROAST_LIGHT: RGB = [214, 144, 78];
export const CHEESE: RGB = [228, 190, 88];
export const APPLE_RED: RGB = [178, 46, 40];
export const GREENS: RGB = [96, 138, 64];
export const GLASS_HIGHLIGHT: RGB = [240, 244, 240];
export const CORK: RGB = [150, 110, 68];
export const CHALK: RGB = [226, 224, 214];

/** Food a plate may carry. */
export type PlateFood = 'bread' | 'stew' | 'fowl' | 'cheese' | 'apples' | 'crumbs';

export function rectPath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

/** Fills a rectangle and inks its outline — the basic building block of every flat-shaded piece. */
export function inkedRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  ts: number,
): void {
  ctx.fillStyle = rgb(color);
  rectPath(ctx, x, y, w, h);
  ctx.fill();
  inkOutline(ctx, ts);
}

export function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** A soft additive-looking pool of light — firelight, a candle's halo. */
export function paintBloom(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  color: RGB,
  alpha: number,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, rgba(color, alpha));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** A lit candle standing on `baseY`, with a small halo. */
export function paintCandle(ctx: Ctx, x: number, baseY: number, height: number, ts: number): void {
  const width = ts * 0.07;
  paintBloom(ctx, x, baseY - height - ts * 0.05, ts * 0.22, FIRE_GLOW, 0.28);
  inkedRect(ctx, x - width / 2, baseY - height, width, height, CANDLE_WAX, ts);
  ctx.fillStyle = rgb(FLAME_OUTER);
  ctx.beginPath();
  ctx.ellipse(x, baseY - height - ts * 0.05, ts * 0.03, ts * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(FLAME_CORE);
  ctx.beginPath();
  ctx.ellipse(x, baseY - height - ts * 0.04, ts * 0.016, ts * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A candlestick: a brass or iron dish on a short stem, holding a lit candle. */
export function paintCandlestick(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  ts: number,
  metal: Ramp,
): void {
  const stemH = height * 0.45;
  ctx.fillStyle = rgb(sampleRamp(metal, 0.5));
  ctx.beginPath();
  ctx.ellipse(x, baseY - ts * 0.015, ts * 0.07, ts * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  inkedRect(
    ctx,
    x - ts * 0.018,
    baseY - stemH,
    ts * 0.036,
    stemH - ts * 0.02,
    sampleRamp(metal, 0.7),
    ts,
  );
  ctx.fillStyle = rgb(sampleRamp(metal, 0.6));
  ctx.beginPath();
  ctx.ellipse(x, baseY - stemH, ts * 0.05, ts * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  paintCandle(ctx, x, baseY - stemH, height - stemH, ts);
}

/** A tankard or mug with its handle to the east and, if `foamy`, a head of ale. */
export function paintTankard(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  ts: number,
  body: Ramp,
  foamy: boolean,
): void {
  const width = height * 0.72;
  const left = x - width / 2;
  const top = baseY - height;
  ctx.strokeStyle = rgb(sampleRamp(body, 0.35));
  ctx.lineWidth = ts * 0.028;
  ctx.beginPath();
  ctx.ellipse(
    left + width,
    top + height * 0.5,
    width * 0.28,
    height * 0.28,
    0,
    -Math.PI / 2,
    Math.PI / 2,
  );
  ctx.stroke();
  const gradient = ctx.createLinearGradient(left, 0, left + width, 0);
  gradient.addColorStop(0, rgb(sampleRamp(body, 0.8)));
  gradient.addColorStop(0.55, rgb(sampleRamp(body, 0.55)));
  gradient.addColorStop(1, rgb(sampleRamp(body, 0.3)));
  ctx.fillStyle = gradient;
  rectPath(ctx, left, top, width, height);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgba(sampleRamp(body, 0.15), 0.8);
  ctx.fillRect(left, top + height * 0.72, width, height * 0.07);
  ctx.fillRect(left, top + height * 0.18, width, height * 0.07);
  if (foamy) {
    ctx.fillStyle = rgb(FOAM);
    ctx.beginPath();
    ctx.ellipse(x, top, width * 0.56, height * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
  }
}

/** A bottle with a neck, a cork, a label band and one glint. */
export function paintBottle(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  ts: number,
  glass: RGB,
  label: RGB | null,
): void {
  const bodyW = height * 0.42;
  const bodyH = height * 0.62;
  const neckW = bodyW * 0.36;
  const neckH = height - bodyH;
  ctx.fillStyle = rgb(glass);
  ctx.beginPath();
  ctx.moveTo(x - bodyW / 2, baseY);
  ctx.lineTo(x - bodyW / 2, baseY - bodyH + bodyW * 0.3);
  ctx.quadraticCurveTo(x - bodyW / 2, baseY - bodyH, x - neckW / 2, baseY - bodyH - neckH * 0.1);
  ctx.lineTo(x - neckW / 2, baseY - height);
  ctx.lineTo(x + neckW / 2, baseY - height);
  ctx.lineTo(x + neckW / 2, baseY - bodyH - neckH * 0.1);
  ctx.quadraticCurveTo(x + bodyW / 2, baseY - bodyH, x + bodyW / 2, baseY - bodyH + bodyW * 0.3);
  ctx.lineTo(x + bodyW / 2, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  if (label !== null) {
    ctx.fillStyle = rgb(label);
    ctx.fillRect(x - bodyW / 2, baseY - bodyH * 0.62, bodyW, bodyH * 0.32);
  }
  ctx.fillStyle = rgb(CORK);
  ctx.fillRect(x - neckW / 2, baseY - height - ts * 0.02, neckW, ts * 0.035);
  ctx.fillStyle = rgba(GLASS_HIGHLIGHT, 0.7);
  ctx.fillRect(x - bodyW * 0.32, baseY - bodyH * 0.9, bodyW * 0.14, bodyH * 0.55);
}

/** A plate seen from the 3/4 view, with a helping of `food` on it. */
export function paintPlate(
  ctx: Ctx,
  cx: number,
  cy: number,
  radiusX: number,
  ts: number,
  food: PlateFood,
  rim: RGB,
): void {
  const radiusY = radiusX * 0.45;
  ctx.fillStyle = rgb(rim);
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(CROCKERY_WHITE);
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusX * 0.72, radiusY * 0.68, 0, 0, Math.PI * 2);
  ctx.fill();
  switch (food) {
    case 'bread':
      ctx.fillStyle = rgb(BREAD);
      ctx.beginPath();
      ctx.ellipse(cx, cy - radiusY * 0.35, radiusX * 0.55, radiusY * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      ctx.strokeStyle = rgb(BREAD_DARK);
      ctx.lineWidth = ts * 0.012;
      for (const dx of [-0.22, 0, 0.22]) {
        ctx.beginPath();
        ctx.moveTo(cx + radiusX * dx - radiusX * 0.06, cy - radiusY * 0.8);
        ctx.lineTo(cx + radiusX * dx + radiusX * 0.06, cy - radiusY * 0.05);
        ctx.stroke();
      }
      break;
    case 'stew':
      ctx.fillStyle = rgb(STEW);
      ctx.beginPath();
      ctx.ellipse(cx, cy, radiusX * 0.55, radiusY * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(GREENS);
      ctx.fillRect(cx - radiusX * 0.2, cy - radiusY * 0.15, radiusX * 0.12, radiusY * 0.2);
      ctx.fillStyle = rgb(CHEESE);
      ctx.fillRect(cx + radiusX * 0.1, cy - radiusY * 0.05, radiusX * 0.12, radiusY * 0.2);
      break;
    case 'fowl':
      ctx.fillStyle = rgb(ROAST);
      ctx.beginPath();
      ctx.ellipse(cx, cy - radiusY * 0.45, radiusX * 0.6, radiusY * 1.0, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      ctx.fillStyle = rgb(ROAST_LIGHT);
      ctx.beginPath();
      ctx.ellipse(
        cx - radiusX * 0.15,
        cy - radiusY * 0.85,
        radiusX * 0.28,
        radiusY * 0.4,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = rgb(CROCKERY_WHITE);
      ctx.lineWidth = ts * 0.022;
      ctx.beginPath();
      ctx.moveTo(cx + radiusX * 0.5, cy - radiusY * 0.6);
      ctx.lineTo(cx + radiusX * 0.8, cy - radiusY * 1.1);
      ctx.stroke();
      break;
    case 'cheese':
      ctx.fillStyle = rgb(CHEESE);
      ctx.beginPath();
      ctx.moveTo(cx - radiusX * 0.5, cy + radiusY * 0.2);
      ctx.lineTo(cx + radiusX * 0.5, cy + radiusY * 0.2);
      ctx.lineTo(cx + radiusX * 0.2, cy - radiusY * 0.9);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      break;
    case 'apples':
      for (const dx of [-0.3, 0.1, 0.35]) {
        ctx.fillStyle = rgb(APPLE_RED);
        ctx.beginPath();
        ctx.arc(cx + radiusX * dx, cy - radiusY * 0.3, radiusX * 0.2, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.6);
      }
      break;
    case 'crumbs':
      ctx.fillStyle = rgb(BREAD_DARK);
      for (const [dx, dy] of [
        [-0.3, 0.1],
        [0.2, -0.2],
        [0.35, 0.2],
      ] as const)
        ctx.fillRect(cx + radiusX * dx, cy + radiusY * dy, ts * 0.02, ts * 0.02);
      break;
  }
}

/** A jug with a spout and a handle. */
export function paintJug(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  ts: number,
  body: RGB,
): void {
  const width = height * 0.66;
  ctx.strokeStyle = rgb(mix(body, [0, 0, 0], 0.35));
  ctx.lineWidth = ts * 0.026;
  ctx.beginPath();
  ctx.ellipse(
    x + width * 0.5,
    baseY - height * 0.55,
    width * 0.26,
    height * 0.26,
    0,
    -Math.PI / 2,
    Math.PI / 2,
  );
  ctx.stroke();
  ctx.fillStyle = rgb(body);
  ctx.beginPath();
  ctx.moveTo(x - width * 0.34, baseY);
  ctx.quadraticCurveTo(
    x - width * 0.62,
    baseY - height * 0.5,
    x - width * 0.3,
    baseY - height * 0.86,
  );
  ctx.lineTo(x - width * 0.46, baseY - height);
  ctx.lineTo(x + width * 0.3, baseY - height);
  ctx.quadraticCurveTo(x + width * 0.62, baseY - height * 0.5, x + width * 0.34, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgba(GLASS_HIGHLIGHT, 0.35);
  ctx.fillRect(x - width * 0.3, baseY - height * 0.7, width * 0.12, height * 0.4);
}

/** A barrel lying on its side, seen end-on: staves, hoops and, if `tapped`, a brass spigot. */
export function paintCaskEnd(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  ts: number,
  wood: Ramp,
  tapped: boolean,
): void {
  const gradient = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.3,
    radius * 0.1,
    cx,
    cy,
    radius,
  );
  gradient.addColorStop(0, rgb(sampleRamp(wood, 0.8)));
  gradient.addColorStop(1, rgb(sampleRamp(wood, 0.35)));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.strokeStyle = rgba(sampleRamp(wood, 0.15), 0.7);
  ctx.lineWidth = ts * 0.012;
  const staveCount = 5;
  for (let i = 1; i < staveCount; i++) {
    const sx = cx - radius + (radius * 2 * i) / staveCount;
    const half = Math.sqrt(Math.max(0, radius * radius - (sx - cx) * (sx - cx)));
    ctx.beginPath();
    ctx.moveTo(sx, cy - half);
    ctx.lineTo(sx, cy + half);
    ctx.stroke();
  }
  ctx.strokeStyle = rgb([44, 42, 44]);
  ctx.lineWidth = ts * 0.035;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  if (tapped) {
    inkedRect(
      ctx,
      cx - ts * 0.03,
      cy + radius * 0.25,
      ts * 0.06,
      ts * 0.1,
      sampleRamp(BRASS, 0.7),
      ts * 0.7,
    );
    inkedRect(
      ctx,
      cx - ts * 0.05,
      cy + radius * 0.25,
      ts * 0.1,
      ts * 0.03,
      sampleRamp(BRASS, 0.9),
      ts * 0.7,
    );
  }
}

/**
 * A table top seen from the south: a lit plank surface, a darker front edge
 * and apron under it. Returns the y of the surface's front edge, where
 * standing objects on the table put their bases.
 */
export function paintTableTop(
  ctx: Ctx,
  left: number,
  top: number,
  width: number,
  surfaceDepth: number,
  apronH: number,
  ts: number,
  wood: Ramp,
  rng: Rng,
): number {
  paintPlankBoard(ctx, left, top, width, surfaceDepth, forkRng(rng), {
    direction: 'horizontal',
    boardPx: surfaceDepth / 3,
    ramp: { ...wood, shadow: mix(wood.shadow, wood.mid, 0.5) },
  });
  ctx.fillStyle = rgba(sampleRamp(wood, 1), 0.25);
  ctx.fillRect(left, top, width, surfaceDepth * 0.2);
  rectPath(ctx, left, top, width, surfaceDepth);
  inkOutline(ctx, ts);
  const frontY = top + surfaceDepth;
  ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
  rectPath(ctx, left, frontY, width, apronH);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.5);
  ctx.fillRect(left + ts * 0.02, frontY + ts * 0.01, width - ts * 0.04, ts * 0.018);
  return frontY;
}

/** A square-cut table leg from `topY` to `baseY`, lit on its west face. */
export function paintLeg(
  ctx: Ctx,
  x: number,
  topY: number,
  baseY: number,
  width: number,
  ts: number,
  wood: Ramp,
): void {
  inkedRect(ctx, x - width / 2, topY, width, baseY - topY, sampleRamp(wood, 0.28), ts);
  ctx.fillStyle = rgba(sampleRamp(wood, 0.7), 0.5);
  ctx.fillRect(x - width / 2 + ts * 0.008, topY, width * 0.3, baseY - topY);
}

/** A few stray scattered crumbs or wet rings, so a surface reads as used. */
export function paintSurfaceWear(
  ctx: Ctx,
  left: number,
  top: number,
  width: number,
  depth: number,
  ts: number,
  rng: Rng,
  stain: RGB,
  count: number,
): void {
  ctx.strokeStyle = rgba(stain, 0.45);
  ctx.lineWidth = ts * 0.012;
  for (let i = 0; i < count; i++) {
    const x = left + width * (0.1 + rng() * 0.8);
    const y = top + depth * (0.3 + rng() * 0.5);
    ctx.beginPath();
    ctx.ellipse(x, y, ts * (0.05 + jitter(rng, 0.01)), ts * 0.022, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}
