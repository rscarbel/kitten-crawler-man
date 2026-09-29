/**
 * Bespoke furniture for the General Store, Kestrel's everything-shop. The
 * room is built around a few large pieces painted in the shop's own
 * joinery — bottle-green paint over oak, brass pulls — so the fittings read
 * as one shop rather than a scatter of borrowed furniture: tall goods walls
 * against the north face (hardware, pantry, cloth and back-room stock), a
 * glass-fronted cabinet for the potions and scrolls a crawler actually buys,
 * a long serving counter with its till, scales and sweet jars, and a
 * two-deep display table on the shop floor. Smaller pieces — open bins of
 * nails, flour and salt, a barrel of long-handled tools, slumped sacks, a
 * crate of goblin dynamite kept behind the counter, the clerk's high desk
 * and the storeroom's stacked stock — cluster around those.
 *
 * Every painter keeps its ink inside its own footprint's columns and above
 * its foot, and only rises above the footprint, so a wall piece climbs the
 * wall face rather than spilling sideways.
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
  type FootprintBox,
  type Rng,
} from '../../town/townArt';
import {
  getTownRamp,
  sampleRamp,
  mix,
  TOWN_INK,
  type RGB,
  type Ramp,
} from '../../town/townPalette';

type Ctx = CanvasRenderingContext2D;

// ── Materials no shared ramp covers ─────────────────────────────────────────

/** The shop's own painted joinery — a bottle green that stands off the honey floor boards. */
const SHOP_GREEN: Ramp = {
  shadow: [24, 44, 36],
  mid: [46, 82, 64],
  light: [76, 118, 90],
  accent: [118, 156, 114],
};
/** Waxed oak for worktops, shelf boards and table tops. */
const OAK: Ramp = {
  shadow: [66, 42, 24],
  mid: [124, 84, 48],
  light: [174, 126, 76],
  accent: [210, 168, 110],
};
const BRASS_DIM: RGB = [138, 104, 44];
const BRASS_MID: RGB = [188, 148, 64];
const BRASS_BRIGHT: RGB = [236, 204, 118];
const CREAM: RGB = [228, 216, 184];
const CREAM_SHADOW: RGB = [178, 164, 130];
const PARCHMENT: RGB = [222, 204, 160];
const IRON_DARK: RGB = [36, 36, 40];
const IRON_MID: RGB = [70, 70, 76];
const IRON_LIGHT: RGB = [124, 124, 132];
const TIN_BODY: RGB = [150, 156, 162];
const TIN_LIGHT: RGB = [212, 218, 222];
const GLASS_PALE: RGB = [196, 214, 206];
const LAMP_GLASS: RGB = [232, 204, 132];
const ROPE: RGB = [176, 140, 86];
const ROPE_DARK: RGB = [120, 90, 52];
const TWINE: RGB = [196, 170, 120];
const BURLAP: RGB = [176, 146, 100];
const BURLAP_DARK: RGB = [122, 96, 62];
const FLOUR: RGB = [238, 232, 218];
const SALT: RGB = [214, 218, 222];
const OATS: RGB = [200, 172, 112];
const NAILS: RGB = [92, 94, 100];
const SACK_MARK_RED: RGB = [150, 60, 48];
const SACK_MARK_BROWN: RGB = [70, 60, 50];
const SACK_MARK_BLUE: RGB = [56, 82, 138];
const CANDLE_WAX: RGB = [234, 222, 176];
const SOAP_ROSE: RGB = [206, 150, 146];
const SOAP_SAGE: RGB = [170, 186, 140];
const POTION_RED: RGB = [178, 30, 40];
const POTION_RED_LIGHT: RGB = [236, 96, 96];
const SCROLL_RIBBON: RGB = [92, 118, 170];
const DYNAMITE_RED: RGB = [178, 44, 36];
const DYNAMITE_LIGHT: RGB = [222, 96, 72];
const WARNING_YELLOW: RGB = [226, 180, 52];
const SWEET_COLOURS: readonly RGB[] = [
  [214, 70, 80],
  [240, 236, 226],
  [94, 150, 204],
  [236, 176, 70],
];
/** Dyed cloth — madder, woad, weld, walnut, undyed linen. */
const CLOTH_DYES: readonly RGB[] = [
  [156, 56, 48],
  [56, 82, 138],
  [188, 156, 58],
  [110, 74, 50],
  [214, 204, 178],
  [96, 124, 78],
];
const CLAY: Ramp = {
  shadow: [92, 52, 34],
  mid: [146, 88, 60],
  light: [186, 126, 90],
  accent: [214, 164, 124],
};
const STONEWARE: Ramp = {
  shadow: [146, 132, 108],
  mid: [196, 184, 158],
  light: [226, 218, 196],
  accent: [244, 238, 222],
};

function woodRamp(): Ramp {
  return getTownRamp('oc_timber');
}

// ── Shared primitives ───────────────────────────────────────────────────────

/** A long piece's shadow is a band along its foot, not one ellipse under its middle. */
function bandShadow(ctx: Ctx, box: FootprintBox, ts: number, alpha = 0.32): void {
  const segments = Math.max(1, Math.round(box.width / ts));
  for (let i = 0; i < segments; i++) {
    const cx = box.left + (box.width * (i + 0.5)) / segments;
    drawTownContactShadow(ctx, cx, box.bottom - ts * 0.06, ts * 0.62, ts * 0.14, alpha);
  }
}

function inkRect(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

/** A flat slab lit along its top edge and shaded along its foot — every board, panel and shelf edge. */
function litSlab(
  ctx: Ctx,
  ramp: Ramp,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  tone = 0.55,
): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, tone));
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, tone + 0.35)));
  ctx.fillRect(x, y, w, Math.max(1, h * 0.28));
  ctx.fillStyle = rgba(TOWN_INK, 0.25);
  ctx.fillRect(x, y + h * 0.78, w, h * 0.22);
  inkRect(ctx, x, y, w, h, ts);
}

/** A recessed, painted panel with a lit bevel on its top-left and a shadowed one bottom-right. */
function raisedPanel(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  const bevel = Math.max(1, ts * 0.035);
  ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.42));
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.85));
  ctx.fillRect(x, y, w, bevel);
  ctx.fillRect(x, y, bevel, h);
  ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.12));
  ctx.fillRect(x, y + h - bevel, w, bevel);
  ctx.fillRect(x + w - bevel, y, bevel, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.strokeStyle = rgba(TOWN_INK, 0.5);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.stroke();
}

function brassKnob(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = rgb(BRASS_DIM);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/** A small cream price card with a scribble — the shop's own chalked tickets. */
function priceCard(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(CREAM);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(TOWN_INK, 0.6);
  ctx.fillRect(x + w * 0.2, y + h * 0.4, w * 0.6, Math.max(1, h * 0.18));
  inkRect(ctx, x, y, w, h, ts * 0.6);
}

// ── Goods: each one its own small shape on its own base point ──────────────

/** A hanging-bail storm lantern: iron cap and base, a pale amber glass belly, wire guards. */
function paintLantern(ctx: Ctx, cx: number, baseY: number, h: number, ts: number): void {
  const w = h * 0.6;
  const baseH = h * 0.14;
  const capH = h * 0.2;
  const glassTop = baseY - h + capH;
  const glassBottom = baseY - baseH;
  ctx.fillStyle = rgb(mix(LAMP_GLASS, GLASS_PALE, 0.3));
  ctx.beginPath();
  ctx.ellipse(
    cx,
    (glassTop + glassBottom) / 2,
    w * 0.44,
    (glassBottom - glassTop) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = rgba([255, 255, 255], 0.55);
  ctx.fillRect(cx - w * 0.28, glassTop + h * 0.08, Math.max(1, w * 0.12), h * 0.28);
  ctx.strokeStyle = rgb(IRON_MID);
  ctx.lineWidth = Math.max(1, ts * 0.022);
  for (const dx of [-0.22, 0.22]) {
    ctx.beginPath();
    ctx.moveTo(cx + w * dx, glassTop);
    ctx.lineTo(cx + w * dx, glassBottom);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(IRON_DARK);
  ctx.fillRect(cx - w / 2, glassBottom, w, baseH);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.44, glassTop);
  ctx.lineTo(cx - w * 0.2, baseY - h + capH * 0.2);
  ctx.lineTo(cx + w * 0.2, baseY - h + capH * 0.2);
  ctx.lineTo(cx + w * 0.44, glassTop);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.strokeStyle = rgb(IRON_LIGHT);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  ctx.arc(cx, baseY - h + capH * 0.2, w * 0.24, Math.PI, 0);
  ctx.stroke();
  inkRect(ctx, cx - w / 2, glassBottom, w, baseH, ts * 0.7);
}

/** A big coil of hemp rope seen from just off top-down, rings stacked, a loose tail. */
function paintRopeCoil(ctx: Ctx, cx: number, baseY: number, r: number, ts: number): void {
  const rings = 3;
  for (let i = 0; i < rings; i++) {
    const y = baseY - r * 0.45 - i * r * 0.22;
    ctx.strokeStyle = rgb(i % 2 === 0 ? ROPE : mix(ROPE, [255, 255, 255], 0.18));
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.ellipse(cx, y, r * 0.82, r * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const topY = baseY - r * 0.45 - (rings - 1) * r * 0.22;
  ctx.beginPath();
  ctx.ellipse(cx, topY, r * 0.98, r * 0.55, 0, 0, Math.PI * 2);
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(ROPE_DARK);
  ctx.beginPath();
  ctx.ellipse(cx, topY, r * 0.4, r * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(ROPE_DARK);
  ctx.lineWidth = r * 0.2;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.7, topY + r * 0.2);
  ctx.quadraticCurveTo(cx + r * 1.0, baseY - r * 0.1, cx + r * 0.6, baseY - r * 0.04);
  ctx.stroke();
}

/** A black iron cooking pot with a lid and a bail. */
function paintIronPot(ctx: Ctx, cx: number, baseY: number, w: number, ts: number): void {
  const h = w * 0.72;
  ctx.fillStyle = rgb(IRON_DARK);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY - h * 0.72);
  ctx.quadraticCurveTo(cx - w / 2, baseY, cx, baseY);
  ctx.quadraticCurveTo(cx + w / 2, baseY, cx + w / 2, baseY - h * 0.72);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(IRON_MID);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h * 0.72, w * 0.52, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(IRON_LIGHT);
  ctx.fillRect(cx - w * 0.06, baseY - h * 0.95, w * 0.12, h * 0.16);
  ctx.fillStyle = rgba([255, 255, 255], 0.25);
  ctx.fillRect(cx - w * 0.36, baseY - h * 0.6, Math.max(1, w * 0.08), h * 0.36);
}

/** A kettle: round tin body, a spout to one side, a handle over the top. */
function paintKettle(ctx: Ctx, cx: number, baseY: number, w: number, ts: number): void {
  const h = w * 0.8;
  ctx.fillStyle = rgb(TIN_BODY);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h * 0.4, w * 0.44, h * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.strokeStyle = rgb(TIN_BODY);
  ctx.lineWidth = w * 0.1;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.3, baseY - h * 0.35);
  ctx.lineTo(cx + w * 0.5, baseY - h * 0.62);
  ctx.stroke();
  ctx.strokeStyle = rgb(IRON_DARK);
  ctx.lineWidth = Math.max(1, w * 0.07);
  ctx.beginPath();
  ctx.arc(cx, baseY - h * 0.72, w * 0.22, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = rgb(TIN_LIGHT);
  ctx.fillRect(cx - w * 0.26, baseY - h * 0.62, Math.max(1, w * 0.1), h * 0.3);
}

/** A preserves jar: glass, a coloured fill, a cloth cap tied with twine. */
function paintPreserveJar(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  fill: RGB,
  cap: RGB,
  ts: number,
): void {
  ctx.fillStyle = rgb(mix(fill, GLASS_PALE, 0.2));
  ctx.fillRect(cx - w / 2, baseY - h * 0.85, w, h * 0.85);
  ctx.fillStyle = rgb(mix(fill, TOWN_INK, 0.3));
  ctx.fillRect(cx + w * 0.18, baseY - h * 0.85, w * 0.32, h * 0.85);
  inkRect(ctx, cx - w / 2, baseY - h * 0.85, w, h * 0.85, ts * 0.6);
  ctx.fillStyle = rgb(cap);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.62, baseY - h * 0.8);
  ctx.lineTo(cx - w * 0.45, baseY - h);
  ctx.lineTo(cx + w * 0.45, baseY - h);
  ctx.lineTo(cx + w * 0.62, baseY - h * 0.8);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.fillStyle = rgb(TWINE);
  ctx.fillRect(cx - w * 0.52, baseY - h * 0.86, w * 1.04, Math.max(1, h * 0.06));
  ctx.fillStyle = rgba([255, 255, 255], 0.55);
  ctx.fillRect(cx - w * 0.36, baseY - h * 0.7, Math.max(1, w * 0.12), h * 0.4);
}

/** A cream stoneware crock with a brown-dipped shoulder. */
function paintCrock(ctx: Ctx, cx: number, baseY: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(sampleRamp(STONEWARE, 0.55));
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.4, baseY - h);
  ctx.quadraticCurveTo(cx - w * 0.56, baseY - h * 0.5, cx - w * 0.44, baseY);
  ctx.lineTo(cx + w * 0.44, baseY);
  ctx.quadraticCurveTo(cx + w * 0.56, baseY - h * 0.5, cx + w * 0.4, baseY - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(sampleRamp(CLAY, 0.3));
  ctx.fillRect(cx - w * 0.44, baseY - h, w * 0.88, h * 0.26);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.4, baseY - h);
  ctx.quadraticCurveTo(cx - w * 0.56, baseY - h * 0.5, cx - w * 0.44, baseY);
  ctx.lineTo(cx + w * 0.44, baseY);
  ctx.quadraticCurveTo(cx + w * 0.56, baseY - h * 0.5, cx + w * 0.4, baseY - h);
  ctx.closePath();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgba([255, 255, 255], 0.4);
  ctx.fillRect(cx - w * 0.3, baseY - h * 0.66, Math.max(1, w * 0.1), h * 0.4);
  ctx.fillStyle = rgba(TOWN_INK, 0.2);
  ctx.fillRect(cx + w * 0.16, baseY - h * 0.72, w * 0.26, h * 0.7);
}

/** A small stencilled sack sitting upright, its neck tied off. */
function paintSmallSack(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  cloth: RGB,
  mark: RGB,
  ts: number,
): void {
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.2, baseY - h);
    ctx.quadraticCurveTo(cx - w * 0.62, baseY - h * 0.55, cx - w * 0.5, baseY);
    ctx.lineTo(cx + w * 0.5, baseY);
    ctx.quadraticCurveTo(cx + w * 0.62, baseY - h * 0.55, cx + w * 0.2, baseY - h);
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = rgb(cloth);
  ctx.fill();
  ctx.fillStyle = rgba(TOWN_INK, 0.22);
  ctx.fillRect(cx + w * 0.12, baseY - h * 0.8, w * 0.36, h * 0.8);
  outline();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(mix(cloth, TOWN_INK, 0.3));
  ctx.fillRect(cx - w * 0.22, baseY - h * 1.08, w * 0.44, h * 0.12);
  // A dyed band round the belly and the miller's ring stencilled on it.
  ctx.fillStyle = rgb(mark);
  ctx.fillRect(cx - w * 0.44, baseY - h * 0.52, w * 0.88, h * 0.1);
  ctx.strokeStyle = rgb(mark);
  ctx.lineWidth = Math.max(1, w * 0.06);
  ctx.beginPath();
  ctx.arc(cx - w * 0.04, baseY - h * 0.28, w * 0.12, 0, Math.PI * 2);
  ctx.stroke();
}

/** A tied bundle of candles standing on end. */
function paintCandleBundle(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  ts: number,
): void {
  const count = 4;
  const stickW = w / count;
  for (let i = 0; i < count; i++) {
    const x = cx - w / 2 + i * stickW;
    const hi = h * (0.9 + (i % 2) * 0.1);
    ctx.fillStyle = rgb(i % 2 === 0 ? CANDLE_WAX : mix(CANDLE_WAX, [255, 255, 255], 0.3));
    ctx.fillRect(x, baseY - hi, stickW, hi);
    ctx.fillStyle = rgb(TOWN_INK);
    ctx.fillRect(x + stickW * 0.4, baseY - hi - h * 0.08, Math.max(1, stickW * 0.2), h * 0.08);
  }
  inkRect(ctx, cx - w / 2, baseY - h, w, h, ts * 0.6);
  ctx.fillStyle = rgb(TWINE);
  ctx.fillRect(cx - w / 2, baseY - h * 0.5, w, Math.max(1, h * 0.08));
}

/** A bolt of cloth lying on its side, seen end-on: a wound spiral and the flat of the roll. */
function paintClothBolt(
  ctx: Ctx,
  x: number,
  baseY: number,
  w: number,
  h: number,
  dye: RGB,
  ts: number,
): void {
  ctx.fillStyle = rgb(dye);
  ctx.fillRect(x, baseY - h, w, h);
  ctx.fillStyle = rgb(mix(dye, [255, 255, 255], 0.28));
  ctx.fillRect(x, baseY - h, w, h * 0.3);
  ctx.fillStyle = rgb(mix(dye, TOWN_INK, 0.3));
  ctx.fillRect(x, baseY - h * 0.25, w, h * 0.25);
  inkRect(ctx, x, baseY - h, w, h, ts * 0.6);
  // The wound end, facing the room.
  const r = h * 0.48;
  ctx.fillStyle = rgb(mix(dye, [255, 255, 255], 0.12));
  ctx.beginPath();
  ctx.ellipse(x + w - r * 0.4, baseY - h / 2, r * 0.5, r, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.strokeStyle = rgba(TOWN_INK, 0.5);
  ctx.lineWidth = Math.max(1, ts * 0.015);
  ctx.beginPath();
  ctx.ellipse(x + w - r * 0.4, baseY - h / 2, r * 0.26, r * 0.52, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** A ball of twine. */
function paintTwineBall(ctx: Ctx, cx: number, baseY: number, r: number, ts: number): void {
  ctx.fillStyle = rgb(TWINE);
  ctx.beginPath();
  ctx.arc(cx, baseY - r, r, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.strokeStyle = rgba(ROPE_DARK, 0.8);
  ctx.lineWidth = Math.max(1, ts * 0.014);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, baseY - r, r * 0.9, r * (0.3 + i * 0.25), 0.5 + i * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** A tin can of lamp oil: a cylinder, a label band, a capped spout. */
function paintOilCan(ctx: Ctx, cx: number, baseY: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(TIN_BODY);
  ctx.fillRect(cx - w / 2, baseY - h, w, h);
  ctx.fillStyle = rgb(TIN_LIGHT);
  ctx.fillRect(cx - w / 2, baseY - h, w * 0.25, h);
  ctx.fillStyle = rgb(DYNAMITE_RED);
  ctx.fillRect(cx - w / 2, baseY - h * 0.65, w, h * 0.32);
  inkRect(ctx, cx - w / 2, baseY - h, w, h, ts * 0.6);
  ctx.fillStyle = rgb(IRON_MID);
  ctx.fillRect(cx + w * 0.12, baseY - h * 1.18, w * 0.2, h * 0.18);
}

/** A stack of soap cakes. */
function paintSoapStack(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  ts: number,
): void {
  const cakes = 3;
  const cakeH = h / cakes;
  for (let i = 0; i < cakes; i++) {
    const tone = i % 2 === 0 ? SOAP_ROSE : SOAP_SAGE;
    const y = baseY - (i + 1) * cakeH;
    ctx.fillStyle = rgb(tone);
    ctx.fillRect(cx - w / 2 + i * w * 0.04, y, w * 0.92, cakeH * 0.92);
    ctx.fillStyle = rgb(mix(tone, [255, 255, 255], 0.35));
    ctx.fillRect(cx - w / 2 + i * w * 0.04, y, w * 0.92, Math.max(1, cakeH * 0.25));
  }
  inkRect(ctx, cx - w / 2, baseY - h, w, h, ts * 0.6);
}

/** A paper-wrapped box of stock with a stencilled mark. */
function paintCarton(
  ctx: Ctx,
  x: number,
  baseY: number,
  w: number,
  h: number,
  tone: RGB,
  ts: number,
): void {
  ctx.fillStyle = rgb(tone);
  ctx.fillRect(x, baseY - h, w, h);
  ctx.fillStyle = rgb(mix(tone, [255, 255, 255], 0.25));
  ctx.fillRect(x, baseY - h, w, Math.max(1, h * 0.18));
  ctx.fillStyle = rgba(TOWN_INK, 0.25);
  ctx.fillRect(x + w * 0.72, baseY - h, w * 0.28, h);
  ctx.fillStyle = rgba(TOWN_INK, 0.6);
  ctx.fillRect(x + w * 0.22, baseY - h * 0.55, w * 0.36, Math.max(1, h * 0.12));
  inkRect(ctx, x, baseY - h, w, h, ts * 0.6);
}

/** A round-bottomed healing flask: red draught, cork, a heart-marked tag. */
function paintPotionFlask(ctx: Ctx, cx: number, baseY: number, h: number, ts: number): void {
  const r = h * 0.34;
  const bellyY = baseY - r;
  const neckW = r * 0.62;
  ctx.fillStyle = rgb(mix(GLASS_PALE, POTION_RED, 0.2));
  ctx.beginPath();
  ctx.arc(cx, bellyY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - neckW / 2, baseY - h * 0.92, neckW, h * 0.4);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, bellyY, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = rgb(POTION_RED);
  ctx.fillRect(cx - r, bellyY - r * 0.35, r * 2, r * 1.4);
  ctx.fillStyle = rgb(mix(POTION_RED, TOWN_INK, 0.35));
  ctx.fillRect(cx + r * 0.25, bellyY - r * 0.35, r, r * 1.4);
  ctx.fillStyle = rgb(POTION_RED_LIGHT);
  ctx.fillRect(cx - r, bellyY - r * 0.35, r * 2, Math.max(1, r * 0.14));
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, bellyY, r, 0, Math.PI * 2);
  inkOutline(ctx, ts * 0.6);
  inkRect(ctx, cx - neckW / 2, baseY - h * 0.92, neckW, h * 0.26, ts * 0.6);
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.6));
  ctx.fillRect(cx - neckW * 0.6, baseY - h, neckW * 1.2, h * 0.12);
  ctx.fillStyle = rgba([255, 255, 255], 0.7);
  ctx.fillRect(cx - r * 0.6, bellyY - r * 0.55, Math.max(1, r * 0.22), r * 0.5);
}

/** A rolled scroll tied with a blue ribbon, lying on its side. */
function paintScroll(ctx: Ctx, x: number, baseY: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(PARCHMENT);
  ctx.fillRect(x, baseY - h, w, h);
  ctx.fillStyle = rgb(mix(PARCHMENT, TOWN_INK, 0.2));
  ctx.fillRect(x, baseY - h * 0.35, w, h * 0.35);
  ctx.fillStyle = rgba([255, 255, 255], 0.5);
  ctx.fillRect(x, baseY - h, w, Math.max(1, h * 0.2));
  inkRect(ctx, x, baseY - h, w, h, ts * 0.6);
  ctx.fillStyle = rgb(SCROLL_RIBBON);
  ctx.fillRect(x + w * 0.44, baseY - h, w * 0.14, h);
  ctx.fillStyle = rgb(mix(PARCHMENT, TOWN_INK, 0.35));
  ctx.beginPath();
  ctx.ellipse(x + w, baseY - h / 2, h * 0.16, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Goods walls ─────────────────────────────────────────────────────────────

/** How tall a goods wall stands, in tiles — the lower cabinet, the worktop and three open shelves. */
const GOODS_WALL_HEIGHT_TILES = 1.85;
const GOODS_WALL_CABINET_TILES = 0.46;
const GOODS_WALL_CORNICE_TILES = 0.16;
const GOODS_WALL_SHELVES = 3;

/**
 * Which trade a goods wall stocks — each reads by silhouette at a glance.
 * Any variant past these is the back room's boxed stock.
 */
const GOODS_HARDWARE = 0;
const GOODS_PANTRY = 1;
const GOODS_CLOTH = 2;

/** One shelf's worth of a goods wall's stock, laid left to right until the bay is full. */
function paintGoodsShelf(
  ctx: Ctx,
  left: number,
  right: number,
  shelfY: number,
  rowH: number,
  ts: number,
  kind: number,
  shelf: number,
  rng: Rng,
): void {
  const tall = rowH * 0.84;
  let x = left + ts * 0.05;
  let slot = 0;
  const room = (w: number): boolean => x + w <= right - ts * 0.03;
  while (x < right - ts * 0.12) {
    const pick = (shelf * 3 + slot + Math.floor(rng() * 2)) % 4;
    let w = ts * 0.24;
    if (kind === GOODS_HARDWARE) {
      if (shelf === 0) {
        w = ts * 0.24;
        if (!room(w)) break;
        paintLantern(ctx, x + w / 2, shelfY, tall * (pick % 2 === 0 ? 1 : 0.86), ts);
      } else if (shelf === 1) {
        w = ts * 0.36;
        if (!room(w)) break;
        if (pick === 3) paintKettle(ctx, x + w / 2, shelfY, w * 0.8, ts);
        else paintRopeCoil(ctx, x + w / 2, shelfY, w * 0.42, ts);
      } else {
        w = ts * 0.34;
        if (!room(w)) break;
        if (pick % 2 === 0) paintIronPot(ctx, x + w / 2, shelfY, w * 0.9, ts);
        else paintOilCan(ctx, x + w / 2, shelfY, w * 0.46, tall * 0.8, ts);
      }
    } else if (kind === GOODS_PANTRY) {
      if (shelf === 0) {
        w = ts * 0.2;
        if (!room(w)) break;
        const fills: readonly RGB[] = [
          [168, 40, 52],
          [214, 150, 48],
          [104, 64, 120],
          [120, 150, 60],
        ];
        paintPreserveJar(
          ctx,
          x + w / 2,
          shelfY,
          w * 0.8,
          tall * (0.8 + (pick % 2) * 0.12),
          fills[(slot + shelf) % fills.length],
          CLOTH_DYES[(slot * 2) % CLOTH_DYES.length],
          ts,
        );
      } else if (shelf === 1) {
        w = ts * 0.26;
        if (!room(w)) break;
        if (pick === 0) paintCandleBundle(ctx, x + w / 2, shelfY, w * 0.7, tall * 0.9, ts);
        else if (pick === 1) paintSoapStack(ctx, x + w / 2, shelfY, w * 0.8, tall * 0.5, ts);
        else paintCrock(ctx, x + w / 2, shelfY, w * 0.86, tall * 0.8, ts);
      } else {
        w = ts * 0.3;
        if (!room(w)) break;
        const isFlour = pick % 2 === 0;
        const cloth = isFlour ? FLOUR : BURLAP;
        const mark = isFlour ? SACK_MARK_RED : SACK_MARK_BROWN;
        paintSmallSack(ctx, x + w / 2, shelfY, w * 0.8, tall * 0.85, cloth, mark, ts);
      }
    } else if (kind === GOODS_CLOTH) {
      if (shelf < 2) {
        w = ts * 0.5;
        if (!room(w)) w = right - ts * 0.03 - x;
        if (w < ts * 0.2) break;
        const bolts = 2;
        const boltH = (tall * 0.9) / bolts;
        for (let b = 0; b < bolts; b++) {
          const dye = CLOTH_DYES[(slot * 3 + b + shelf * 2) % CLOTH_DYES.length];
          paintClothBolt(ctx, x, shelfY - b * boltH, w * 0.94, boltH * 0.96, dye, ts);
        }
      } else {
        w = ts * 0.22;
        if (!room(w)) break;
        paintTwineBall(ctx, x + w / 2, shelfY, w * 0.4, ts);
      }
    } else {
      w = ts * (0.34 + (pick % 2) * 0.1);
      if (!room(w)) break;
      const tones: readonly RGB[] = [
        [168, 136, 92],
        [186, 158, 112],
        [150, 116, 78],
      ];
      paintCarton(ctx, x, shelfY, w * 0.94, tall * (0.6 + (pick % 3) * 0.14), tones[pick % 3], ts);
    }
    x += w + ts * 0.035;
    slot++;
  }
}

/**
 * A tall painted goods wall, one per trade: a cupboard base with brass
 * pulls under an oak worktop, and three open shelves above it stocked
 * item by item, crowned by a cornice with a cream sign board. Bays run
 * two tiles wide so the piece reads as one fitting, not tiles in a row.
 */
export function paintGoodsWall(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.4);
    const top = box.bottom - ts * GOODS_WALL_HEIGHT_TILES;
    const corniceBottom = top + ts * GOODS_WALL_CORNICE_TILES;
    const cabinetTop = box.bottom - ts * GOODS_WALL_CABINET_TILES;
    const worktopH = ts * 0.08;
    const postW = ts * 0.1;
    const plinthH = ts * 0.07;

    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.3));
    ctx.fillRect(box.left, top, box.width, box.bottom - top);

    // Open shelving.
    const bays = Math.max(1, Math.round(box.width / (ts * 2)));
    const innerLeft = box.left + postW;
    const innerRight = box.right - postW;
    const bayGap = postW;
    const bayW = (innerRight - innerLeft - bayGap * (bays - 1)) / bays;
    const shelfTop = corniceBottom;
    const shelfBottom = cabinetTop - worktopH;
    const rowH = (shelfBottom - shelfTop) / GOODS_WALL_SHELVES;
    const boardH = ts * 0.05;
    const itemRng = forkRng(rng);
    for (let b = 0; b < bays; b++) {
      const bx = innerLeft + b * (bayW + bayGap);
      const back = ctx.createLinearGradient(0, shelfTop, 0, shelfBottom);
      back.addColorStop(0, rgb(sampleRamp(OAK, 0.05)));
      back.addColorStop(1, rgb(sampleRamp(OAK, 0.22)));
      ctx.fillStyle = back;
      ctx.fillRect(bx, shelfTop, bayW, shelfBottom - shelfTop);
      for (let r = 0; r < GOODS_WALL_SHELVES; r++) {
        const boardY = shelfTop + rowH * (r + 1) - boardH;
        ctx.fillStyle = rgba(TOWN_INK, 0.35);
        ctx.fillRect(bx, boardY - rowH + boardH, bayW, rowH * 0.16);
        paintGoodsShelf(ctx, bx, bx + bayW, boardY, rowH - boardH, ts, variant, r, itemRng);
        ctx.fillStyle = rgb(sampleRamp(OAK, 0.66));
        ctx.fillRect(bx, boardY, bayW, boardH);
        ctx.fillStyle = rgb(sampleRamp(OAK, 0.92));
        ctx.fillRect(bx, boardY, bayW, Math.max(1, boardH * 0.35));
      }
      ctx.fillStyle = rgba(TOWN_INK, 0.28);
      ctx.fillRect(bx + bayW - ts * 0.05, shelfTop, ts * 0.05, shelfBottom - shelfTop);
      inkRect(ctx, bx, shelfTop, bayW, shelfBottom - shelfTop, ts);
    }

    // Posts between and at the ends of the bays.
    for (let p = 0; p <= bays; p++) {
      const px =
        p === 0
          ? box.left
          : p === bays
            ? box.right - postW
            : innerLeft + p * (bayW + bayGap) - bayGap;
      ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.5));
      ctx.fillRect(px, top, postW, box.bottom - top);
      ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.82));
      ctx.fillRect(px + postW * 0.15, top, postW * 0.22, box.bottom - top);
      ctx.fillStyle = rgba(TOWN_INK, 0.3);
      ctx.fillRect(px + postW * 0.72, top, postW * 0.28, box.bottom - top);
    }

    // Worktop and cupboard base.
    litSlab(ctx, OAK, box.left, cabinetTop - worktopH, box.width, worktopH, ts, 0.6);
    const doorTop = cabinetTop + ts * 0.02;
    const doorBottom = box.bottom - plinthH;
    const doors = Math.max(2, Math.round(box.width / (ts * 0.66)));
    const doorW = (box.width - postW * 2) / doors;
    for (let d = 0; d < doors; d++) {
      const dx = box.left + postW + d * doorW;
      const isDrawerStack = variant === GOODS_HARDWARE && d % 2 === 0;
      if (isDrawerStack) {
        const drawers = 3;
        const drawerH = (doorBottom - doorTop) / drawers;
        for (let r = 0; r < drawers; r++) {
          raisedPanel(
            ctx,
            dx + ts * 0.02,
            doorTop + r * drawerH + ts * 0.01,
            doorW - ts * 0.04,
            drawerH - ts * 0.02,
            ts,
          );
          priceCard(
            ctx,
            dx + doorW * 0.3,
            doorTop + r * drawerH + drawerH * 0.2,
            doorW * 0.4,
            drawerH * 0.3,
            ts,
          );
          brassKnob(ctx, dx + doorW / 2, doorTop + r * drawerH + drawerH * 0.7, ts * 0.025);
        }
      } else {
        raisedPanel(ctx, dx + ts * 0.02, doorTop, doorW - ts * 0.04, doorBottom - doorTop, ts);
        const knobX = d % 2 === 0 ? dx + doorW - ts * 0.08 : dx + ts * 0.08;
        brassKnob(ctx, knobX, (doorTop + doorBottom) / 2, ts * 0.03);
      }
    }
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.1));
    ctx.fillRect(box.left, box.bottom - plinthH, box.width, plinthH);

    // Cornice with a cream sign board.
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.6));
    ctx.fillRect(box.left, top, box.width, corniceBottom - top);
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.92));
    ctx.fillRect(box.left, top, box.width, Math.max(1, ts * 0.03));
    ctx.fillStyle = rgba(TOWN_INK, 0.3);
    ctx.fillRect(box.left, corniceBottom - ts * 0.03, box.width, ts * 0.03);
    const signW = Math.min(box.width * 0.5, ts * 1.4);
    const signX = box.centreX - signW / 2;
    const signY = top + ts * 0.03;
    const signH = corniceBottom - top - ts * 0.06;
    ctx.fillStyle = rgb(CREAM);
    ctx.fillRect(signX, signY, signW, signH);
    ctx.fillStyle = rgb(CREAM_SHADOW);
    ctx.fillRect(signX, signY + signH * 0.7, signW, signH * 0.3);
    const glyphs = 6;
    const glyphW = (signW * 0.8) / glyphs;
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.15));
    for (let g = 0; g < glyphs; g++) {
      const gx = signX + signW * 0.1 + g * glyphW;
      ctx.fillRect(gx + glyphW * 0.15, signY + signH * 0.25, glyphW * 0.6, signH * 0.5);
    }
    inkRect(ctx, signX, signY, signW, signH, ts * 0.7);
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, box.bottom - top);
    inkOutline(ctx, ts);
  });
}

// ── Potion cabinet ──────────────────────────────────────────────────────────

const POTION_CABINET_HEIGHT_TILES = 1.9;

/**
 * A glass-fronted, locked cabinet for the stock a crawler actually comes in
 * for: rows of red healing draughts on the upper shelves and fog scrolls
 * pigeonholed below, behind two glazed doors with a brass lock plate, under
 * a cornice carrying a painted red heart.
 */
export function paintPotionCabinet(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.4);
    const top = box.bottom - ts * POTION_CABINET_HEIGHT_TILES;
    const corniceH = ts * 0.2;
    const baseH = ts * 0.34;
    const frameW = ts * 0.1;
    const glassTop = top + corniceH;
    const glassBottom = box.bottom - baseH;

    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.4));
    ctx.fillRect(box.left, top, box.width, box.bottom - top);

    // Interior, then the goods, then the glass over them.
    const innerLeft = box.left + frameW;
    const innerRight = box.right - frameW;
    ctx.fillStyle = rgb(sampleRamp(OAK, 0.08));
    ctx.fillRect(innerLeft, glassTop, innerRight - innerLeft, glassBottom - glassTop);
    const rows = 4;
    const rowH = (glassBottom - glassTop) / rows;
    const shelfRng = forkRng(rng);
    for (let r = 0; r < rows; r++) {
      const shelfY = glassTop + rowH * (r + 1);
      if (r < rows - 1) {
        const flaskH = rowH * (0.78 + jitter(shelfRng, 0.04));
        const step = ts * 0.2;
        for (let x = innerLeft + step * 0.6; x < innerRight - step * 0.4; x += step) {
          paintPotionFlask(ctx, x, shelfY - ts * 0.03, flaskH, ts);
        }
      } else {
        const holes = 4;
        const holeW = (innerRight - innerLeft) / holes;
        for (let hIdx = 0; hIdx < holes; hIdx++) {
          const hx = innerLeft + hIdx * holeW;
          ctx.strokeStyle = rgb(sampleRamp(OAK, 0.5));
          ctx.lineWidth = Math.max(1, ts * 0.03);
          ctx.strokeRect(hx, shelfY - rowH, holeW, rowH);
          const scrollH = rowH * 0.3;
          for (let s = 0; s < 2; s++) {
            paintScroll(
              ctx,
              hx + holeW * 0.08,
              shelfY - ts * 0.04 - s * scrollH,
              holeW * 0.76,
              scrollH * 0.92,
              ts,
            );
          }
        }
      }
      ctx.fillStyle = rgb(sampleRamp(OAK, 0.7));
      ctx.fillRect(innerLeft, shelfY - ts * 0.035, innerRight - innerLeft, ts * 0.035);
    }
    // Glass and its glint.
    ctx.fillStyle = rgba(GLASS_PALE, 0.16);
    ctx.fillRect(innerLeft, glassTop, innerRight - innerLeft, glassBottom - glassTop);
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerLeft, glassTop, innerRight - innerLeft, glassBottom - glassTop);
    ctx.clip();
    ctx.fillStyle = rgba([255, 255, 255], 0.22);
    for (const offset of [0.15, 0.62]) {
      const gx = innerLeft + (innerRight - innerLeft) * offset;
      ctx.beginPath();
      ctx.moveTo(gx, glassBottom);
      ctx.lineTo(gx + ts * 0.14, glassBottom);
      ctx.lineTo(gx + ts * 0.14 + (glassBottom - glassTop) * 0.5, glassTop);
      ctx.lineTo(gx + (glassBottom - glassTop) * 0.5, glassTop);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Door stiles: the frame, a centre meeting stile, the lock plate.
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.62));
    ctx.fillRect(box.left, glassTop, frameW, glassBottom - glassTop);
    ctx.fillRect(box.right - frameW, glassTop, frameW, glassBottom - glassTop);
    ctx.fillRect(box.centreX - frameW * 0.4, glassTop, frameW * 0.8, glassBottom - glassTop);
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.9));
    ctx.fillRect(box.left + frameW * 0.2, glassTop, frameW * 0.2, glassBottom - glassTop);
    inkRect(
      ctx,
      innerLeft,
      glassTop,
      box.centreX - frameW * 0.4 - innerLeft,
      glassBottom - glassTop,
      ts,
    );
    inkRect(
      ctx,
      box.centreX + frameW * 0.4,
      glassTop,
      innerRight - box.centreX - frameW * 0.4,
      glassBottom - glassTop,
      ts,
    );
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.fillRect(
      box.centreX - ts * 0.06,
      (glassTop + glassBottom) / 2 - ts * 0.08,
      ts * 0.12,
      ts * 0.16,
    );
    ctx.fillStyle = rgb(TOWN_INK);
    ctx.fillRect(
      box.centreX - ts * 0.012,
      (glassTop + glassBottom) / 2 - ts * 0.03,
      ts * 0.024,
      ts * 0.06,
    );
    inkRect(
      ctx,
      box.centreX - ts * 0.06,
      (glassTop + glassBottom) / 2 - ts * 0.08,
      ts * 0.12,
      ts * 0.16,
      ts * 0.6,
    );

    // Base: two drawers.
    const drawerW = (box.width - frameW * 2) / 2;
    for (let d = 0; d < 2; d++) {
      const dx = box.left + frameW + d * drawerW;
      raisedPanel(
        ctx,
        dx + ts * 0.02,
        glassBottom + ts * 0.04,
        drawerW - ts * 0.04,
        baseH - ts * 0.1,
        ts,
      );
      brassKnob(ctx, dx + drawerW / 2, glassBottom + baseH * 0.5, ts * 0.03);
    }
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.1));
    ctx.fillRect(box.left, box.bottom - ts * 0.06, box.width, ts * 0.06);

    // Cornice with the red heart.
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.62));
    ctx.fillRect(box.left, top, box.width, corniceH);
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.95));
    ctx.fillRect(box.left, top, box.width, Math.max(1, ts * 0.03));
    const heartX = box.centreX;
    const heartY = top + corniceH * 0.55;
    const heartR = corniceH * 0.26;
    ctx.fillStyle = rgb(CREAM);
    ctx.beginPath();
    ctx.ellipse(heartX, heartY, heartR * 2.4, corniceH * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(POTION_RED);
    ctx.beginPath();
    ctx.arc(heartX - heartR * 0.5, heartY - heartR * 0.2, heartR * 0.55, 0, Math.PI * 2);
    ctx.arc(heartX + heartR * 0.5, heartY - heartR * 0.2, heartR * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(heartX - heartR * 1.02, heartY - heartR * 0.05);
    ctx.lineTo(heartX, heartY + heartR * 1.0);
    ctx.lineTo(heartX + heartR * 1.02, heartY - heartR * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, box.bottom - top);
    inkOutline(ctx, ts);
  });
}

// ── Serving counter and its bell end ────────────────────────────────────────

const COUNTER_FRONT_TILES = 0.62;
const COUNTER_TOP_TILES = 0.36;

/** The counter's carcass: an oak top seen from above, a green panelled front, a dark kick plate. */
function paintCounterBody(
  ctx: Ctx,
  box: FootprintBox,
  ts: number,
  panels: number,
): { topY: number } {
  const frontTop = box.bottom - ts * COUNTER_FRONT_TILES;
  const topY = frontTop - ts * COUNTER_TOP_TILES;
  const kickH = ts * 0.07;
  // Worktop surface, then its lit nosing.
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.55));
  ctx.fillRect(box.left, topY, box.width, frontTop - topY);
  ctx.fillStyle = rgba(TOWN_INK, 0.14);
  for (let g = 1; g < 4; g++) {
    ctx.fillRect(box.left, topY + ((frontTop - topY) * g) / 4, box.width, Math.max(1, ts * 0.012));
  }
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.3));
  ctx.fillRect(box.left, topY, box.width, ts * 0.04);
  inkRect(ctx, box.left, topY, box.width, frontTop - topY, ts);
  litSlab(ctx, OAK, box.left, frontTop - ts * 0.02, box.width, ts * 0.08, ts, 0.62);
  // Panelled front.
  const bodyTop = frontTop + ts * 0.06;
  ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.55));
  ctx.fillRect(box.left, bodyTop, box.width, box.bottom - bodyTop);
  const panelW = box.width / panels;
  for (let p = 0; p < panels; p++) {
    raisedPanel(
      ctx,
      box.left + p * panelW + ts * 0.07,
      bodyTop + ts * 0.06,
      panelW - ts * 0.14,
      box.bottom - bodyTop - kickH - ts * 0.1,
      ts,
    );
  }
  ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.08));
  ctx.fillRect(box.left, box.bottom - kickH, box.width, kickH);
  inkRect(ctx, box.left, bodyTop, box.width, box.bottom - bodyTop, ts);
  return { topY: frontTop - ts * 0.04 };
}

/** A brass balance: a post, a beam, two pans on chains and a stack of weights. */
function paintScales(ctx: Ctx, cx: number, surfaceY: number, ts: number): void {
  const postH = ts * 0.44;
  const beamW = ts * 0.52;
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.4));
  ctx.fillRect(cx - ts * 0.12, surfaceY - ts * 0.05, ts * 0.24, ts * 0.05);
  ctx.fillStyle = rgb(BRASS_MID);
  ctx.fillRect(cx - ts * 0.015, surfaceY - postH, ts * 0.03, postH);
  ctx.fillRect(cx - beamW / 2, surfaceY - postH, beamW, ts * 0.025);
  ctx.strokeStyle = rgb(BRASS_DIM);
  ctx.lineWidth = Math.max(1, ts * 0.012);
  for (const side of [-1, 1]) {
    const px = cx + (side * beamW) / 2;
    const panY = surfaceY - postH + ts * 0.22 + (side > 0 ? ts * 0.03 : 0);
    ctx.beginPath();
    ctx.moveTo(px, surfaceY - postH);
    ctx.lineTo(px - ts * 0.07, panY);
    ctx.moveTo(px, surfaceY - postH);
    ctx.lineTo(px + ts * 0.07, panY);
    ctx.stroke();
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.ellipse(px, panY, ts * 0.1, ts * 0.03, 0, 0, Math.PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
  }
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.arc(cx, surfaceY - postH, ts * 0.03, 0, Math.PI * 2);
  ctx.fill();
}

/** A wooden till: a sloped-lid cash box with a brass-fronted drawer. */
function paintTill(ctx: Ctx, cx: number, surfaceY: number, ts: number): void {
  const w = ts * 0.44;
  const h = ts * 0.26;
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.3));
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, surfaceY);
  ctx.lineTo(cx - w / 2, surfaceY - h * 0.7);
  ctx.lineTo(cx - w * 0.3, surfaceY - h);
  ctx.lineTo(cx + w * 0.3, surfaceY - h);
  ctx.lineTo(cx + w / 2, surfaceY - h * 0.7);
  ctx.lineTo(cx + w / 2, surfaceY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.7));
  ctx.fillRect(cx - w * 0.3, surfaceY - h, w * 0.6, h * 0.14);
  ctx.fillStyle = rgb(BRASS_MID);
  ctx.fillRect(cx - w * 0.4, surfaceY - h * 0.5, w * 0.8, h * 0.34);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.fillRect(cx - w * 0.4, surfaceY - h * 0.5, w * 0.8, Math.max(1, h * 0.08));
  inkRect(ctx, cx - w * 0.4, surfaceY - h * 0.5, w * 0.8, h * 0.34, ts * 0.6);
  // A few coins out on the counter beside it.
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  for (let c = 0; c < 3; c++) {
    ctx.beginPath();
    ctx.ellipse(
      cx + w * 0.62 + c * ts * 0.02,
      surfaceY - ts * 0.02 - c * ts * 0.012,
      ts * 0.035,
      ts * 0.016,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** A tall glass sweet jar with a lid, packed with striped sticks. */
function paintSweetJar(
  ctx: Ctx,
  cx: number,
  surfaceY: number,
  h: number,
  colourIndex: number,
  ts: number,
): void {
  const w = h * 0.5;
  const top = surfaceY - h;
  const sticks = 5;
  for (let s = 0; s < sticks; s++) {
    const sx = cx - w * 0.36 + (s * w * 0.72) / (sticks - 1);
    ctx.fillStyle = rgb(SWEET_COLOURS[(s + colourIndex) % SWEET_COLOURS.length]);
    ctx.fillRect(sx - w * 0.06, top + h * 0.22, w * 0.12, h * 0.74);
    ctx.fillStyle = rgb(SWEET_COLOURS[(s + colourIndex + 1) % SWEET_COLOURS.length]);
    for (let b = 0; b < 4; b++)
      ctx.fillRect(sx - w * 0.06, top + h * (0.3 + b * 0.16), w * 0.12, h * 0.05);
  }
  ctx.fillStyle = rgba(GLASS_PALE, 0.28);
  ctx.fillRect(cx - w / 2, top + h * 0.14, w, h * 0.86);
  ctx.fillStyle = rgba([255, 255, 255], 0.6);
  ctx.fillRect(cx - w * 0.4, top + h * 0.2, Math.max(1, w * 0.1), h * 0.6);
  inkRect(ctx, cx - w / 2, top + h * 0.14, w, h * 0.86, ts * 0.6);
  ctx.fillStyle = rgb(GLASS_PALE);
  ctx.fillRect(cx - w * 0.56, top + h * 0.04, w * 1.12, h * 0.12);
  inkRect(ctx, cx - w * 0.56, top + h * 0.04, w * 1.12, h * 0.12, ts * 0.6);
  ctx.fillStyle = rgb(GLASS_PALE);
  ctx.fillRect(cx - w * 0.12, top - h * 0.02, w * 0.24, h * 0.08);
}

/** A brown-paper parcel tied with string, and a twine spool on its spindle beside it. */
function paintParcelAndTwine(ctx: Ctx, cx: number, surfaceY: number, ts: number): void {
  const pw = ts * 0.34;
  const ph = ts * 0.18;
  const px = cx - pw * 0.9;
  ctx.fillStyle = rgb([176, 142, 98]);
  ctx.fillRect(px, surfaceY - ph, pw, ph);
  ctx.fillStyle = rgb([204, 172, 124]);
  ctx.fillRect(px, surfaceY - ph, pw, ph * 0.3);
  inkRect(ctx, px, surfaceY - ph, pw, ph, ts * 0.6);
  ctx.fillStyle = rgb(CREAM);
  ctx.fillRect(px + pw * 0.46, surfaceY - ph, Math.max(1, pw * 0.06), ph);
  ctx.fillRect(px, surfaceY - ph * 0.55, pw, Math.max(1, ph * 0.1));
  const spoolX = cx + ts * 0.2;
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.35));
  ctx.fillRect(spoolX - ts * 0.08, surfaceY - ts * 0.03, ts * 0.16, ts * 0.03);
  ctx.fillRect(spoolX - ts * 0.012, surfaceY - ts * 0.3, ts * 0.024, ts * 0.3);
  paintTwineBall(ctx, spoolX, surfaceY - ts * 0.04, ts * 0.08, ts);
}

/** A chalk slate hung off the counter's front, its prices rubbed and rewritten. */
function paintHangingSlate(ctx: Ctx, cx: number, y: number, ts: number): void {
  const w = ts * 0.42;
  const h = ts * 0.26;
  ctx.fillStyle = rgb(sampleRamp(OAK, 0.5));
  ctx.fillRect(cx - w / 2 - ts * 0.02, y - ts * 0.02, w + ts * 0.04, h + ts * 0.04);
  ctx.fillStyle = rgb([44, 48, 50]);
  ctx.fillRect(cx - w / 2, y, w, h);
  ctx.fillStyle = rgba([236, 236, 226], 0.75);
  for (let line = 0; line < 3; line++) {
    ctx.fillRect(
      cx - w * 0.36,
      y + h * (0.22 + line * 0.24),
      w * (0.44 - (line % 2) * 0.12),
      Math.max(1, h * 0.07),
    );
    ctx.fillRect(cx + w * 0.18, y + h * (0.22 + line * 0.24), w * 0.16, Math.max(1, h * 0.07));
  }
  inkRect(ctx, cx - w / 2 - ts * 0.02, y - ts * 0.02, w + ts * 0.04, h + ts * 0.04, ts * 0.7);
}

/**
 * The serving counter: a green panelled front under a long oak top, with
 * the till at the keeper's end, a brass balance, two tall jars of striped
 * sweets, a wrapped parcel and a twine spool, and a chalk price slate hung
 * off the front for whoever is waiting.
 */
export function paintStoreCounter(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.36);
    const { topY } = paintCounterBody(ctx, box, ts, frame.footprintW);
    const surfaceY = topY + ts * 0.26;
    const tileX = (i: number): number => box.left + ts * (i + 0.5);
    paintTill(ctx, tileX(0), surfaceY, ts);
    if (frame.footprintW > 1) paintScales(ctx, tileX(1), surfaceY, ts);
    if (frame.footprintW > 2) {
      paintSweetJar(ctx, tileX(2) - ts * 0.14, surfaceY, ts * 0.46, 0, ts);
      paintSweetJar(ctx, tileX(2) + ts * 0.16, surfaceY - ts * 0.02, ts * 0.4, 2, ts);
    }
    if (frame.footprintW > 3) paintParcelAndTwine(ctx, tileX(3), surfaceY, ts);
    if (frame.footprintW > 4) {
      const lampRng = forkRng(rng);
      paintLantern(ctx, tileX(4) + jitter(lampRng, ts * 0.04), surfaceY, ts * 0.4, ts);
    }
    paintHangingSlate(ctx, tileX(Math.min(2, frame.footprintW - 1)), box.bottom - ts * 0.48, ts);
  });
}

/**
 * The counter's short return at its customer end, in the same joinery,
 * carrying the brass tap bell and a card propped against it.
 */
export function paintCounterBellEnd(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.36);
    const { topY } = paintCounterBody(ctx, box, ts, 1);
    const surfaceY = topY + ts * 0.24;
    const cx = box.centreX;
    const bellW = ts * 0.34;
    const bellH = ts * 0.2;
    ctx.fillStyle = rgb(sampleRamp(OAK, 0.25));
    ctx.fillRect(cx - bellW * 0.62, surfaceY - ts * 0.04, bellW * 1.24, ts * 0.05);
    inkRect(ctx, cx - bellW * 0.62, surfaceY - ts * 0.04, bellW * 1.24, ts * 0.05, ts * 0.6);
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.beginPath();
    ctx.moveTo(cx - bellW / 2, surfaceY - ts * 0.04);
    ctx.quadraticCurveTo(
      cx - bellW / 2,
      surfaceY - ts * 0.04 - bellH,
      cx,
      surfaceY - ts * 0.04 - bellH,
    );
    ctx.quadraticCurveTo(
      cx + bellW / 2,
      surfaceY - ts * 0.04 - bellH,
      cx + bellW / 2,
      surfaceY - ts * 0.04,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.ellipse(
      cx - bellW * 0.18,
      surfaceY - ts * 0.04 - bellH * 0.6,
      bellW * 0.1,
      bellH * 0.22,
      -0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = rgb(IRON_MID);
    ctx.fillRect(cx - ts * 0.015, surfaceY - ts * 0.04 - bellH - ts * 0.06, ts * 0.03, ts * 0.06);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.arc(cx, surfaceY - ts * 0.04 - bellH - ts * 0.07, ts * 0.03, 0, Math.PI * 2);
    ctx.fill();
    priceCard(ctx, cx + bellW * 0.62, surfaceY - ts * 0.16, ts * 0.14, ts * 0.12, ts);
  });
}

// ── Display table ───────────────────────────────────────────────────────────

/**
 * A two-deep display table on the shop floor with a stepped riser along its
 * back: variant 0 carries household goods (bolts of cloth, folded
 * blankets, crockery, candles, lanterns), variant 1 the hardware a crawler
 * buys (coiled rope, pots, lamp oil, a hand saw, nail boxes). Price cards
 * stand in among the stock.
 */
export function paintDisplayTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const topFront = box.bottom - ts * 0.46;
    const topBack = box.top + ts * 0.16;
    const apronH = ts * 0.1;
    const legW = ts * 0.1;
    const inset = ts * 0.06;

    // Legs, then the top.
    ctx.fillStyle = rgb(sampleRamp(OAK, 0.3));
    for (const lx of [box.left + inset, box.right - inset - legW]) {
      ctx.fillRect(lx, topFront, legW, box.bottom - topFront - ts * 0.02);
      inkRect(ctx, lx, topFront, legW, box.bottom - topFront - ts * 0.02, ts);
    }
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.3));
    ctx.fillRect(
      box.left + inset + legW,
      box.bottom - ts * 0.16,
      box.width - inset * 2 - legW * 2,
      ts * 0.05,
    );
    const topGrad = ctx.createLinearGradient(0, topBack, 0, topFront);
    topGrad.addColorStop(0, rgb(sampleRamp(OAK, 0.45)));
    topGrad.addColorStop(1, rgb(sampleRamp(OAK, 0.66)));
    ctx.fillStyle = topGrad;
    ctx.fillRect(box.left, topBack, box.width, topFront - topBack);
    ctx.fillStyle = rgba(TOWN_INK, 0.12);
    const boards = 5;
    for (let b = 1; b < boards; b++) {
      ctx.fillRect(
        box.left,
        topBack + ((topFront - topBack) * b) / boards,
        box.width,
        Math.max(1, ts * 0.012),
      );
    }
    inkRect(ctx, box.left, topBack, box.width, topFront - topBack, ts);
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.55));
    ctx.fillRect(box.left, topFront, box.width, apronH);
    ctx.fillStyle = rgb(sampleRamp(SHOP_GREEN, 0.85));
    ctx.fillRect(box.left, topFront, box.width, Math.max(1, apronH * 0.3));
    inkRect(ctx, box.left, topFront, box.width, apronH, ts);

    // A stepped riser along the back half.
    const riserTop = topBack - ts * 0.2;
    const riserStepFront = topBack - ts * 0.02;
    const riserFront = topBack + ts * 0.14;
    const riserLeft = box.left + ts * 0.1;
    const riserW = box.width - ts * 0.2;
    ctx.fillStyle = rgb(sampleRamp(OAK, 0.72));
    ctx.fillRect(riserLeft, riserTop, riserW, riserStepFront - riserTop);
    inkRect(ctx, riserLeft, riserTop, riserW, riserStepFront - riserTop, ts);
    ctx.fillStyle = rgb(sampleRamp(OAK, 0.38));
    ctx.fillRect(riserLeft, riserStepFront, riserW, riserFront - riserStepFront);
    ctx.fillStyle = rgb(CREAM);
    ctx.fillRect(riserLeft + riserW * 0.35, riserStepFront + ts * 0.03, riserW * 0.3, ts * 0.08);
    inkRect(ctx, riserLeft, riserStepFront, riserW, riserFront - riserStepFront, ts);

    const itemRng = forkRng(rng);
    const across = (lo: number, hi: number, count: number, i: number): number =>
      lo + ((hi - lo) * (i + 0.5)) / count;
    const riserSurface = riserStepFront - ts * 0.04;
    const frontSurface = topFront - ts * 0.06;
    const midSurface = riserFront + (topFront - riserFront) * 0.62;
    if (variant === 0) {
      // Riser: lanterns and candle bundles.
      const riserItems = Math.max(3, frame.footprintW * 2);
      for (let i = 0; i < riserItems; i++) {
        const x = across(riserLeft, riserLeft + riserW, riserItems, i);
        if (i % 2 === 0) paintLantern(ctx, x, riserSurface, ts * 0.4, ts);
        else paintCandleBundle(ctx, x, riserSurface, ts * 0.18, ts * 0.26, ts);
      }
      // Table: stacked bolts of cloth, folded blankets and crockery.
      const cols = frame.footprintW;
      for (let c = 0; c < cols; c++) {
        const cx = box.left + ts * (c + 0.5);
        if (c % 3 === 0) {
          for (let b = 0; b < 3; b++) {
            const dye = CLOTH_DYES[(b + c) % CLOTH_DYES.length];
            paintClothBolt(
              ctx,
              cx - ts * 0.4,
              midSurface - b * ts * 0.15,
              ts * 0.76,
              ts * 0.15,
              dye,
              ts,
            );
          }
        } else if (c % 3 === 1) {
          const folds = 4;
          for (let f = 0; f < folds; f++) {
            const dye = CLOTH_DYES[(f * 2 + 1) % CLOTH_DYES.length];
            const y = midSurface - (f + 1) * ts * 0.1;
            ctx.fillStyle = rgb(dye);
            ctx.fillRect(cx - ts * 0.36, y, ts * 0.72, ts * 0.095);
            ctx.fillStyle = rgb(mix(dye, [255, 255, 255], 0.3));
            ctx.fillRect(cx - ts * 0.36, y, ts * 0.72, Math.max(1, ts * 0.025));
          }
          inkRect(
            ctx,
            cx - ts * 0.36,
            midSurface - folds * ts * 0.1,
            ts * 0.72,
            folds * ts * 0.1,
            ts * 0.7,
          );
        } else {
          for (let p = 0; p < 6; p++) {
            ctx.fillStyle = rgb(sampleRamp(STONEWARE, 0.5 + (p % 2) * 0.2));
            ctx.beginPath();
            ctx.ellipse(cx, midSurface - p * ts * 0.05, ts * 0.32, ts * 0.08, 0, 0, Math.PI * 2);
            ctx.fill();
            inkOutline(ctx, ts * 0.5);
          }
          ctx.fillStyle = rgb(sampleRamp(STONEWARE, 0.9));
          ctx.beginPath();
          ctx.ellipse(cx, midSurface - 5 * ts * 0.05, ts * 0.2, ts * 0.04, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let c = 0; c < cols; c++) {
        paintCrock(ctx, box.left + ts * (c + 0.72), frontSurface, ts * 0.22, ts * 0.22, ts);
        priceCard(
          ctx,
          box.left + ts * (c + 0.18),
          frontSurface - ts * 0.12,
          ts * 0.14,
          ts * 0.1,
          ts,
        );
      }
    } else {
      const riserItems = Math.max(3, frame.footprintW * 2);
      for (let i = 0; i < riserItems; i++) {
        const x = across(riserLeft, riserLeft + riserW, riserItems, i);
        if (i % 2 === 0) paintOilCan(ctx, x, riserSurface, ts * 0.16, ts * 0.26, ts);
        else paintKettle(ctx, x, riserSurface, ts * 0.3, ts);
      }
      const cols = frame.footprintW;
      for (let c = 0; c < cols; c++) {
        const cx = box.left + ts * (c + 0.5);
        if (c % 3 === 0) paintRopeCoil(ctx, cx, midSurface + ts * 0.04, ts * 0.26, ts);
        else if (c % 3 === 1) paintIronPot(ctx, cx, midSurface + ts * 0.02, ts * 0.42, ts);
        else {
          // A hand saw laid flat, and a hammer across it.
          ctx.fillStyle = rgb(IRON_LIGHT);
          ctx.beginPath();
          ctx.moveTo(cx - ts * 0.34, midSurface - ts * 0.02);
          ctx.lineTo(cx + ts * 0.2, midSurface - ts * 0.1);
          ctx.lineTo(cx + ts * 0.2, midSurface);
          ctx.lineTo(cx - ts * 0.34, midSurface + ts * 0.02);
          ctx.closePath();
          ctx.fill();
          inkOutline(ctx, ts * 0.6);
          ctx.fillStyle = rgb(sampleRamp(OAK, 0.5));
          ctx.fillRect(cx + ts * 0.2, midSurface - ts * 0.11, ts * 0.12, ts * 0.12);
          inkRect(ctx, cx + ts * 0.2, midSurface - ts * 0.11, ts * 0.12, ts * 0.12, ts * 0.6);
          ctx.fillStyle = rgb(sampleRamp(OAK, 0.7));
          ctx.fillRect(cx - ts * 0.2, midSurface + ts * 0.06, ts * 0.36, ts * 0.04);
          ctx.fillStyle = rgb(IRON_DARK);
          ctx.fillRect(cx - ts * 0.24, midSurface + ts * 0.02, ts * 0.08, ts * 0.12);
        }
      }
      for (let c = 0; c < cols; c++) {
        const tones: readonly RGB[] = [
          [150, 116, 78],
          [186, 158, 112],
        ];
        paintCarton(
          ctx,
          box.left + ts * (c + 0.1),
          frontSurface,
          ts * 0.3,
          ts * 0.16,
          tones[c % 2],
          ts,
        );
        ctx.fillStyle = rgb(NAILS);
        ctx.fillRect(box.left + ts * (c + 0.14), frontSurface - ts * 0.19, ts * 0.22, ts * 0.04);
        priceCard(
          ctx,
          box.left + ts * (c + 0.62),
          frontSurface - ts * 0.12,
          ts * 0.14,
          ts * 0.1,
          ts,
        );
        paintTwineBall(ctx, box.left + ts * (c + 0.86), frontSurface, ts * 0.06, ts);
      }
      jitter(itemRng, 1);
    }
  });
}

// ── Bulk bins ───────────────────────────────────────────────────────────────

/**
 * Open barrels of loose stock sold by the scoop — nails, flour, salt —
 * each with a brass scoop left in it and a chalk tag stuck on a stick.
 */
export function paintBulkBins(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const contents: readonly RGB[] = [NAILS, FLOUR, SALT, OATS];
    const ramp = woodRamp();
    const binRng = forkRng(rng);
    for (let i = 0; i < frame.footprintW; i++) {
      const cx = box.left + ts * (i + 0.5);
      const w = ts * 0.84;
      const h = ts * 0.66;
      const rimY = box.bottom - ts * 0.08 - h;
      // Staves.
      ctx.fillStyle = rgb(sampleRamp(ramp, 0.45));
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, rimY);
      ctx.quadraticCurveTo(cx - w * 0.56, rimY + h / 2, cx - w * 0.44, rimY + h);
      ctx.lineTo(cx + w * 0.44, rimY + h);
      ctx.quadraticCurveTo(cx + w * 0.56, rimY + h / 2, cx + w / 2, rimY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(TOWN_INK, 0.25);
      ctx.fillRect(cx + w * 0.18, rimY, w * 0.32, h);
      ctx.fillStyle = rgba([255, 255, 255], 0.14);
      ctx.fillRect(cx - w * 0.36, rimY, w * 0.14, h);
      ctx.strokeStyle = rgba(TOWN_INK, 0.35);
      ctx.lineWidth = Math.max(1, ts * 0.012);
      for (let s = 1; s < 5; s++) {
        const sx = cx - w / 2 + (w * s) / 5;
        ctx.beginPath();
        ctx.moveTo(sx, rimY);
        ctx.lineTo(sx, rimY + h);
        ctx.stroke();
      }
      ctx.fillStyle = rgb(IRON_DARK);
      for (const band of [0.22, 0.78]) {
        ctx.fillRect(cx - w * 0.52, rimY + h * band - ts * 0.025, w * 1.04, ts * 0.05);
      }
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, rimY);
      ctx.quadraticCurveTo(cx - w * 0.56, rimY + h / 2, cx - w * 0.44, rimY + h);
      ctx.lineTo(cx + w * 0.44, rimY + h);
      ctx.quadraticCurveTo(cx + w * 0.56, rimY + h / 2, cx + w / 2, rimY);
      ctx.closePath();
      inkOutline(ctx, ts);
      // Rim and heaped contents.
      const stock = contents[i % contents.length];
      ctx.fillStyle = rgb(sampleRamp(ramp, 0.2));
      ctx.beginPath();
      ctx.ellipse(cx, rimY, w / 2, ts * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(stock);
      ctx.beginPath();
      ctx.ellipse(cx, rimY + ts * 0.01, w * 0.44, ts * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.06, rimY - ts * 0.02, w * 0.28, ts * 0.08, 0, Math.PI, 0);
      ctx.fill();
      if (stock === NAILS) {
        ctx.strokeStyle = rgb(IRON_LIGHT);
        ctx.lineWidth = Math.max(1, ts * 0.014);
        for (let n = 0; n < 9; n++) {
          const nx = cx + jitter(binRng, w * 0.32);
          const ny = rimY + jitter(binRng, ts * 0.06);
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx + ts * 0.04, ny + jitter(binRng, ts * 0.03));
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = rgba([255, 255, 255], 0.45);
        ctx.beginPath();
        ctx.ellipse(cx - w * 0.14, rimY - ts * 0.03, w * 0.12, ts * 0.03, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // The scoop, handle up.
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.ellipse(cx + w * 0.12, rimY - ts * 0.01, ts * 0.09, ts * 0.05, -0.3, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.strokeStyle = rgb(sampleRamp(OAK, 0.5));
      ctx.lineWidth = Math.max(1, ts * 0.035);
      ctx.beginPath();
      ctx.moveTo(cx + w * 0.2, rimY - ts * 0.03);
      ctx.lineTo(cx + w * 0.36, rimY - ts * 0.2);
      ctx.stroke();
      // Tag on a stick.
      ctx.strokeStyle = rgb(sampleRamp(OAK, 0.35));
      ctx.lineWidth = Math.max(1, ts * 0.02);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.28, rimY);
      ctx.lineTo(cx - w * 0.28, rimY - ts * 0.3);
      ctx.stroke();
      ctx.fillStyle = rgb([44, 48, 50]);
      ctx.fillRect(cx - w * 0.28 - ts * 0.11, rimY - ts * 0.42, ts * 0.22, ts * 0.14);
      ctx.fillStyle = rgba([236, 236, 226], 0.8);
      ctx.fillRect(cx - w * 0.28 - ts * 0.07, rimY - ts * 0.36, ts * 0.14, Math.max(1, ts * 0.025));
      inkRect(ctx, cx - w * 0.28 - ts * 0.11, rimY - ts * 0.42, ts * 0.22, ts * 0.14, ts * 0.6);
    }
  });
}

// ── Tool barrel ─────────────────────────────────────────────────────────────

/** A short barrel stood full of long-handled tools for sale: a rake, a spade, a broom, a pitchfork, a hoe. */
export function paintToolBarrel(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.06, ts * 0.4, ts * 0.12, 0.34);
    const cx = box.centreX;
    const w = ts * 0.66;
    const h = ts * 0.56;
    const rimY = box.bottom - ts * 0.06 - h;
    const handleTop = rimY - ts * 1.05;
    const handle = (x0: number, x1: number, topY: number): void => {
      ctx.strokeStyle = rgb(sampleRamp(OAK, 0.62));
      ctx.lineWidth = ts * 0.05;
      ctx.beginPath();
      ctx.moveTo(x0, rimY + ts * 0.06);
      ctx.lineTo(x1, topY);
      ctx.stroke();
      ctx.strokeStyle = rgba(TOWN_INK, 0.6);
      ctx.lineWidth = Math.max(1, ts * 0.015);
      ctx.stroke();
    };
    // Rake: handle leaning left, a toothed head at the top.
    handle(cx - w * 0.16, cx - w * 0.4, handleTop + ts * 0.14);
    ctx.fillStyle = rgb(IRON_MID);
    ctx.fillRect(cx - w * 0.62, handleTop + ts * 0.1, w * 0.44, ts * 0.04);
    for (let t = 0; t < 5; t++)
      ctx.fillRect(cx - w * 0.6 + t * w * 0.1, handleTop + ts * 0.14, ts * 0.015, ts * 0.06);
    inkRect(ctx, cx - w * 0.62, handleTop + ts * 0.1, w * 0.44, ts * 0.04, ts * 0.6);
    // Broom: straw head up.
    handle(cx + w * 0.02, cx + w * 0.06, handleTop + ts * 0.3);
    ctx.fillStyle = rgb([204, 174, 100]);
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.06 - ts * 0.04, handleTop + ts * 0.3);
    ctx.lineTo(cx + w * 0.06 - ts * 0.11, handleTop);
    ctx.lineTo(cx + w * 0.06 + ts * 0.11, handleTop);
    ctx.lineTo(cx + w * 0.06 + ts * 0.04, handleTop + ts * 0.3);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(DYNAMITE_RED);
    ctx.fillRect(cx + w * 0.06 - ts * 0.05, handleTop + ts * 0.24, ts * 0.1, ts * 0.03);
    // Spade: a blade up top, leaning right.
    handle(cx + w * 0.16, cx + w * 0.4, handleTop + ts * 0.3);
    ctx.fillStyle = rgb(IRON_LIGHT);
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.4 - ts * 0.08, handleTop + ts * 0.3);
    ctx.lineTo(cx + w * 0.4 - ts * 0.08, handleTop + ts * 0.1);
    ctx.quadraticCurveTo(
      cx + w * 0.4,
      handleTop + ts * 0.02,
      cx + w * 0.4 + ts * 0.08,
      handleTop + ts * 0.1,
    );
    ctx.lineTo(cx + w * 0.4 + ts * 0.08, handleTop + ts * 0.3);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    // Pitchfork tines behind the broom.
    handle(cx - w * 0.06, cx - w * 0.14, handleTop + ts * 0.34);
    ctx.strokeStyle = rgb(IRON_MID);
    ctx.lineWidth = Math.max(1, ts * 0.022);
    for (let t = -1; t <= 1; t++) {
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.14 + t * ts * 0.05, handleTop + ts * 0.34);
      ctx.lineTo(cx - w * 0.14 + t * ts * 0.05, handleTop + ts * 0.18);
      ctx.stroke();
    }
    // The barrel.
    const ramp = woodRamp();
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.45));
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, rimY);
    ctx.quadraticCurveTo(cx - w * 0.58, rimY + h / 2, cx - w * 0.44, rimY + h);
    ctx.lineTo(cx + w * 0.44, rimY + h);
    ctx.quadraticCurveTo(cx + w * 0.58, rimY + h / 2, cx + w / 2, rimY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(TOWN_INK, 0.25);
    ctx.fillRect(cx + w * 0.16, rimY, w * 0.34, h);
    ctx.fillStyle = rgb(IRON_DARK);
    for (const band of [0.2, 0.8])
      ctx.fillRect(cx - w * 0.53, rimY + h * band - ts * 0.022, w * 1.06, ts * 0.044);
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, rimY);
    ctx.quadraticCurveTo(cx - w * 0.58, rimY + h / 2, cx - w * 0.44, rimY + h);
    ctx.lineTo(cx + w * 0.44, rimY + h);
    ctx.quadraticCurveTo(cx + w * 0.58, rimY + h / 2, cx + w / 2, rimY);
    ctx.closePath();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.12));
    ctx.beginPath();
    ctx.ellipse(cx, rimY, w / 2, ts * 0.1, 0, 0, Math.PI);
    ctx.fill();
    priceCard(ctx, cx - ts * 0.1, rimY + h * 0.36, ts * 0.2, ts * 0.13, ts);
  });
}

// ── Dynamite crate ──────────────────────────────────────────────────────────

/**
 * A crate of goblin dynamite, kept behind the counter where only the keeper
 * reaches it: lid off and leant against it, red sticks bundled with their
 * fuses poking up, a yellow warning diamond stencilled on the side.
 */
export function paintDynamiteCrate(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.06, ts * 0.42, ts * 0.12, 0.34);
    const w = ts * 0.78;
    const h = ts * 0.5;
    const left = box.centreX - w / 2;
    const top = box.bottom - ts * 0.06 - h;
    const ramp = woodRamp();
    // Sticks, bundled in threes, standing proud of the box.
    const stickW = ts * 0.085;
    for (let s = 0; s < 7; s++) {
      const sx = left + ts * 0.06 + s * stickW * 1.02;
      const rise = ts * (0.14 + (s % 3) * 0.04);
      ctx.fillStyle = rgb(s % 2 === 0 ? DYNAMITE_RED : mix(DYNAMITE_RED, TOWN_INK, 0.15));
      ctx.fillRect(sx, top - rise, stickW, rise + ts * 0.1);
      ctx.fillStyle = rgb(DYNAMITE_LIGHT);
      ctx.fillRect(sx, top - rise, Math.max(1, stickW * 0.3), rise + ts * 0.1);
      ctx.strokeStyle = rgb(TOWN_INK);
      ctx.lineWidth = Math.max(1, ts * 0.014);
      ctx.beginPath();
      ctx.moveTo(sx + stickW / 2, top - rise);
      ctx.quadraticCurveTo(
        sx + stickW,
        top - rise - ts * 0.06,
        sx + stickW * 0.4,
        top - rise - ts * 0.1,
      );
      ctx.stroke();
      inkRect(ctx, sx, top - rise, stickW, rise + ts * 0.1, ts * 0.5);
    }
    ctx.fillStyle = rgb(TWINE);
    ctx.fillRect(left + ts * 0.04, top - ts * 0.08, w * 0.76, ts * 0.03);
    // Box.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.5));
    ctx.fillRect(left, top, w, h);
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.75));
    ctx.fillRect(left, top, w, ts * 0.05);
    ctx.fillStyle = rgba(TOWN_INK, 0.3);
    for (let b = 1; b < 3; b++) ctx.fillRect(left, top + (h * b) / 3, w, Math.max(1, ts * 0.012));
    inkRect(ctx, left, top, w, h, ts);
    // Warning diamond.
    const dx = left + w * 0.5;
    const dy = top + h * 0.55;
    const dr = h * 0.3;
    ctx.fillStyle = rgb(WARNING_YELLOW);
    ctx.beginPath();
    ctx.moveTo(dx, dy - dr);
    ctx.lineTo(dx + dr, dy);
    ctx.lineTo(dx, dy + dr);
    ctx.lineTo(dx - dr, dy);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(TOWN_INK);
    ctx.fillRect(dx - dr * 0.1, dy - dr * 0.5, dr * 0.2, dr * 0.6);
    ctx.fillRect(dx - dr * 0.1, dy + dr * 0.25, dr * 0.2, dr * 0.2);
    // Lid leant against the right side.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.62));
    ctx.beginPath();
    ctx.moveTo(box.right - ts * 0.16, box.bottom - ts * 0.06);
    ctx.lineTo(box.right - ts * 0.04, box.bottom - ts * 0.06);
    ctx.lineTo(box.right - ts * 0.04, top - ts * 0.12);
    ctx.lineTo(box.right - ts * 0.12, top - ts * 0.14);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
  });
}

// ── Clerk's desk ────────────────────────────────────────────────────────────

/**
 * The stock clerk's high desk: a sloped writing top with the ledger lying
 * open on it, an inkwell and quill, a candle, a spike of receipts and a
 * rank of pigeonholes along the back stuffed with dockets.
 */
export function paintClerkDesk(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.32);
    const ramp = OAK;
    const deskFront = box.bottom - ts * 0.5;
    const deskBack = deskFront - ts * 0.34;
    const legW = ts * 0.08;
    // Legs and stretcher.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.3));
    for (const lx of [box.left + ts * 0.08, box.right - ts * 0.08 - legW]) {
      ctx.fillRect(lx, deskFront, legW, box.bottom - deskFront - ts * 0.02);
      inkRect(ctx, lx, deskFront, legW, box.bottom - deskFront - ts * 0.02, ts);
    }
    ctx.fillRect(box.left + ts * 0.16, box.bottom - ts * 0.2, box.width - ts * 0.32, ts * 0.04);
    // Pigeonholes.
    const pigeonTop = deskBack - ts * 0.46;
    const pigeonLeft = box.left + ts * 0.1;
    const pigeonW = box.width - ts * 0.2;
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.45));
    ctx.fillRect(pigeonLeft, pigeonTop, pigeonW, deskBack - pigeonTop);
    const holes = Math.max(4, frame.footprintW * 3);
    const holeW = pigeonW / holes;
    const holeRows = 2;
    const holeH = (deskBack - pigeonTop - ts * 0.04) / holeRows;
    const docketRng = forkRng(rng);
    for (let r = 0; r < holeRows; r++) {
      for (let c = 0; c < holes; c++) {
        const hx = pigeonLeft + c * holeW + ts * 0.02;
        const hy = pigeonTop + ts * 0.03 + r * holeH;
        ctx.fillStyle = rgb(sampleRamp(ramp, 0.08));
        ctx.fillRect(hx, hy, holeW - ts * 0.04, holeH - ts * 0.03);
        if (docketRng() < 0.75) {
          ctx.fillStyle = rgb(docketRng() < 0.5 ? CREAM : PARCHMENT);
          const dh = (holeH - ts * 0.03) * (0.5 + docketRng() * 0.4);
          ctx.fillRect(hx + ts * 0.01, hy + holeH - ts * 0.03 - dh, holeW - ts * 0.06, dh);
        }
      }
    }
    inkRect(ctx, pigeonLeft, pigeonTop, pigeonW, deskBack - pigeonTop, ts);
    // Sloped top.
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.6));
    ctx.fillRect(box.left, deskBack, box.width, deskFront - deskBack);
    ctx.fillStyle = rgb(sampleRamp(ramp, 0.85));
    ctx.fillRect(box.left, deskBack, box.width, ts * 0.03);
    inkRect(ctx, box.left, deskBack, box.width, deskFront - deskBack, ts);
    litSlab(ctx, ramp, box.left, deskFront, box.width, ts * 0.12, ts, 0.45);
    // The ledger, open: two pale pages with ruled lines and a red ribbon.
    const ledgerW = ts * 0.9;
    const ledgerX = box.left + ts * 0.3;
    const pageTop = deskBack + ts * 0.04;
    const pageH = deskFront - deskBack - ts * 0.08;
    ctx.fillStyle = rgb([92, 40, 34]);
    ctx.fillRect(ledgerX - ts * 0.03, pageTop - ts * 0.02, ledgerW + ts * 0.06, pageH + ts * 0.04);
    for (const side of [0, 1]) {
      const px = ledgerX + (side * ledgerW) / 2;
      ctx.fillStyle = rgb(side === 0 ? CREAM : mix(CREAM, CREAM_SHADOW, 0.35));
      ctx.fillRect(px, pageTop, ledgerW / 2, pageH);
      ctx.fillStyle = rgba(TOWN_INK, 0.45);
      for (let l = 0; l < 4; l++) {
        ctx.fillRect(
          px + ts * 0.04,
          pageTop + pageH * (0.2 + l * 0.2),
          ledgerW / 2 - ts * 0.08,
          Math.max(1, ts * 0.01),
        );
      }
    }
    inkRect(
      ctx,
      ledgerX - ts * 0.03,
      pageTop - ts * 0.02,
      ledgerW + ts * 0.06,
      pageH + ts * 0.04,
      ts * 0.7,
    );
    ctx.fillStyle = rgb(POTION_RED);
    ctx.fillRect(ledgerX + ledgerW / 2 - ts * 0.01, pageTop + pageH * 0.6, ts * 0.025, pageH * 0.5);
    // Inkwell and quill.
    const inkX = ledgerX + ledgerW + ts * 0.18;
    ctx.fillStyle = rgb(IRON_DARK);
    ctx.fillRect(inkX - ts * 0.06, deskFront - ts * 0.12, ts * 0.12, ts * 0.1);
    inkRect(ctx, inkX - ts * 0.06, deskFront - ts * 0.12, ts * 0.12, ts * 0.1, ts * 0.6);
    ctx.strokeStyle = rgb(CREAM);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(inkX, deskFront - ts * 0.12);
    ctx.quadraticCurveTo(
      inkX + ts * 0.06,
      deskFront - ts * 0.3,
      inkX + ts * 0.16,
      deskFront - ts * 0.36,
    );
    ctx.stroke();
    // Receipt spike and candle.
    if (frame.footprintW > 1) {
      const spikeX = box.right - ts * 0.24;
      ctx.fillStyle = rgb(IRON_MID);
      ctx.fillRect(spikeX - ts * 0.012, deskBack - ts * 0.02, ts * 0.024, ts * 0.12);
      for (let p = 0; p < 4; p++) {
        ctx.fillStyle = rgb(p % 2 === 0 ? CREAM : PARCHMENT);
        ctx.fillRect(
          spikeX - ts * 0.08,
          deskBack + ts * 0.06 - p * ts * 0.02,
          ts * 0.16,
          ts * 0.02,
        );
      }
      const candleX = box.left + ts * 0.14;
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.fillRect(candleX - ts * 0.06, deskBack + ts * 0.06, ts * 0.12, ts * 0.03);
      ctx.fillStyle = rgb(CANDLE_WAX);
      ctx.fillRect(candleX - ts * 0.025, deskBack - ts * 0.1, ts * 0.05, ts * 0.17);
      ctx.fillStyle = rgb([255, 214, 120]);
      ctx.beginPath();
      ctx.ellipse(candleX, deskBack - ts * 0.14, ts * 0.02, ts * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ── Storeroom stock ─────────────────────────────────────────────────────────

/** One stencilled crate, drawn at an arbitrary box so a stack can be built of them. */
function paintStockCrate(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  mark: number,
): void {
  const ramp = woodRamp();
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.52));
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.78));
  ctx.fillRect(x, y, w, Math.max(1, h * 0.1));
  ctx.fillStyle = rgba(TOWN_INK, 0.24);
  ctx.fillRect(x + w * 0.8, y, w * 0.2, h);
  ctx.strokeStyle = rgba(TOWN_INK, 0.35);
  ctx.lineWidth = Math.max(1, ts * 0.012);
  for (let b = 1; b < 3; b++) {
    ctx.beginPath();
    ctx.moveTo(x, y + (h * b) / 3);
    ctx.lineTo(x + w, y + (h * b) / 3);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.3));
  ctx.fillRect(x, y, w * 0.08, h);
  ctx.fillRect(x + w * 0.92, y, w * 0.08, h);
  inkRect(ctx, x, y, w, h, ts);
  ctx.fillStyle = rgba(TOWN_INK, 0.65);
  const mx = x + w * 0.5;
  const my = y + h * 0.52;
  const ms = Math.min(w, h) * 0.18;
  if (mark % 3 === 0) {
    ctx.fillRect(mx - ms, my - ms * 0.2, ms * 2, ms * 0.4);
    ctx.fillRect(mx - ms * 0.2, my - ms, ms * 0.4, ms * 2);
  } else if (mark % 3 === 1) {
    ctx.beginPath();
    ctx.arc(mx, my, ms, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, ms * 0.4);
    ctx.strokeStyle = rgba(TOWN_INK, 0.65);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(mx - ms, my + ms);
    ctx.lineTo(mx, my - ms);
    ctx.lineTo(mx + ms, my + ms);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The storeroom's delivery, stacked two high: stencilled crates, a sack
 * slumped on top, a lid off one crate showing straw, and the pry bar left
 * leaning against the stack.
 */
export function paintStockStack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.4);
    const markRng = forkRng(rng);
    const crateW = box.width / frame.footprintW;
    const crateH = ts * 0.72;
    // Back rank, stacked two high, standing on the footprint's north row.
    const backBase = box.top + ts * 0.98;
    for (let c = 0; c < frame.footprintW; c++) {
      const x = box.left + c * crateW + ts * 0.02;
      paintStockCrate(
        ctx,
        x,
        backBase - crateH,
        crateW - ts * 0.04,
        crateH,
        ts,
        c + Math.floor(markRng() * 3),
      );
      if (c !== frame.footprintW - 1) {
        paintStockCrate(
          ctx,
          x + ts * 0.06,
          backBase - crateH * 1.9,
          crateW - ts * 0.12,
          crateH * 0.9,
          ts,
          c + 2,
        );
      }
    }
    // A sack slumped on the upper crate.
    paintSmallSack(
      ctx,
      box.left + crateW * 0.5,
      backBase - crateH * 1.9,
      ts * 0.5,
      ts * 0.42,
      BURLAP,
      BURLAP_DARK,
      ts,
    );
    // Front rank, one high, the east one open with straw showing.
    const frontBase = box.bottom - ts * 0.04;
    for (let c = 0; c < frame.footprintW; c++) {
      const x = box.left + c * crateW + ts * 0.02;
      const isOpen = c === frame.footprintW - 1;
      paintStockCrate(ctx, x, frontBase - crateH, crateW - ts * 0.04, crateH, ts, c + 1);
      if (isOpen) {
        ctx.fillStyle = rgb([214, 186, 108]);
        ctx.fillRect(x + ts * 0.06, frontBase - crateH - ts * 0.08, crateW - ts * 0.16, ts * 0.1);
        ctx.strokeStyle = rgb([176, 146, 76]);
        ctx.lineWidth = Math.max(1, ts * 0.014);
        for (let s = 0; s < 6; s++) {
          const sx = x + ts * 0.1 + (s * (crateW - ts * 0.24)) / 5;
          ctx.beginPath();
          ctx.moveTo(sx, frontBase - crateH);
          ctx.lineTo(sx + ts * 0.04, frontBase - crateH - ts * 0.12);
          ctx.stroke();
        }
      }
    }
    // Pry bar leant on the front rank.
    ctx.strokeStyle = rgb(IRON_MID);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(box.left + ts * 0.9, frontBase - ts * 0.02);
    ctx.lineTo(box.left + ts * 1.06, frontBase - crateH * 1.1);
    ctx.lineTo(box.left + ts * 1.14, frontBase - crateH * 1.12);
    ctx.stroke();
  });
}

/** Sacks of flour, salt and oats slumped against each other, one rolled open with a scoop in it. */
export function paintSackPile(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const cloths: readonly RGB[] = [FLOUR, BURLAP, mix(BURLAP, FLOUR, 0.5), OATS];
    const marks: readonly RGB[] = [SACK_MARK_RED, SACK_MARK_BROWN, SACK_MARK_BLUE, SACK_MARK_BROWN];
    const count = frame.footprintW * 2;
    const edgeInset = ts * 0.12;
    const step = (box.width - edgeInset * 2) / count;
    const openAtWest = variant % 2 === 1;
    // Back row taller, front row squat, so the pile has depth.
    for (let i = 0; i < count; i++) {
      const cx = box.left + edgeInset + step * (i + 0.5);
      const isBack = (i + variant) % 2 === 0;
      const h = isBack ? ts * 0.78 : ts * 0.6;
      const baseY = isBack ? box.bottom - ts * 0.2 : box.bottom - ts * 0.04;
      const tone = (i + variant * 2) % cloths.length;
      paintSmallSack(ctx, cx, baseY, step * 1.05, h, cloths[tone], marks[tone], ts);
    }
    // The open one: rolled-down neck, flour heaped, a scoop in it.
    const ox = openAtWest ? box.left + edgeInset + step * 0.9 : box.right - edgeInset - step * 0.9;
    const oy = box.bottom - ts * 0.04;
    ctx.fillStyle = rgb(FLOUR);
    ctx.beginPath();
    ctx.ellipse(ox, oy - ts * 0.4, step * 0.45, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.beginPath();
    ctx.ellipse(ox + ts * 0.04, oy - ts * 0.42, ts * 0.07, ts * 0.04, -0.3, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  });
}

/** Stoneware crocks for sale, two on the floor and one set on top, with a price card propped against them. */
export function paintCrockStack(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.06, ts * 0.44, ts * 0.12, 0.32);
    const floorY = box.bottom - ts * 0.05;
    const crockW = ts * 0.4;
    const crockH = ts * 0.4;
    paintCrock(ctx, box.centreX - ts * 0.2, floorY, crockW, crockH, ts);
    paintCrock(ctx, box.centreX + ts * 0.22, floorY, crockW * 0.9, crockH * 0.86, ts);
    paintCrock(ctx, box.centreX, floorY - crockH * 0.9, crockW * 0.84, crockH * 0.8, ts);
    paintPreserveJar(
      ctx,
      box.centreX + ts * 0.34,
      floorY - crockH * 0.86,
      ts * 0.12,
      ts * 0.2,
      SACK_MARK_RED,
      CREAM,
      ts,
    );
    priceCard(ctx, box.centreX - ts * 0.36, floorY - ts * 0.14, ts * 0.16, ts * 0.12, ts);
  });
}
