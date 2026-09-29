/**
 * Bespoke furniture for Herb & Remedy, Fen's apothecary. The room is built
 * around a few large composed pieces rather than a scatter of small ones:
 * a panelled shop counter dressed with scales, ledger, mortar and a show
 * globe; a full-height apothecary cabinet behind it (a bank of labelled
 * drawers under open shelves of glazed jars and glass); and, in the drying
 * room, a working copper still over a brick firebox, a drying rack hung
 * with bunched herbs over trays of petals, and a potting bench of
 * seedlings. Smaller pieces — bulk herb bins, a remedy display table and
 * potted live herbs — cluster around those.
 *
 * Every painter keeps its ink inside its own footprint's columns (the prop
 * frame is exactly the footprint wide) and only rises above it, so a piece
 * against the north wall climbs the wall face rather than spilling sideways.
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

function woodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function ironRamp(): Ramp {
  return getTownRamp('iron_black');
}
function stoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}

function contactShadow(ctx: Ctx, frame: TownPropFrame): void {
  const box = footprintBox(frame);
  const radiusX = box.width * 0.44;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.34);
}

/** A long piece's shadow is a band along its foot, not one ellipse under its middle. */
function bandShadow(ctx: Ctx, box: FootprintBox, ts: number, alpha = 0.3): void {
  const segments = Math.max(1, Math.round(box.width / ts));
  for (let i = 0; i < segments; i++) {
    const cx = box.left + (box.width * (i + 0.5)) / segments;
    drawTownContactShadow(ctx, cx, box.bottom - ts * 0.06, ts * 0.62, ts * 0.14, alpha);
  }
}

// ── Materials no shared ramp covers ─────────────────────────────────────────

/** Stained walnut for Fen's shop joinery — darker and redder than the ash-oak framing everywhere else in town. */
const WALNUT: Ramp = {
  shadow: [40, 26, 20],
  mid: [86, 56, 38],
  light: [134, 94, 62],
  accent: [176, 132, 90],
};
const COPPER: Ramp = {
  shadow: [86, 44, 26],
  mid: [158, 90, 52],
  light: [212, 146, 92],
  accent: [244, 206, 150],
};
const BRICK: Ramp = {
  shadow: [74, 36, 28],
  mid: [132, 66, 48],
  light: [170, 100, 76],
  accent: [196, 132, 104],
};
const BRASS_DIM: RGB = [140, 106, 46];
const BRASS_BRIGHT: RGB = [222, 184, 100];
const LABEL_PAPER: RGB = [232, 222, 192];
const LABEL_SHADOW: RGB = [184, 170, 136];
const GLAZE_WHITE: RGB = [228, 222, 204];
const GLAZE_BLUE: RGB = [48, 78, 146];
const GLASS_TINT: RGB = [190, 214, 206];
const FLAME_CORE: RGB = [255, 226, 140];
const FLAME_MID: RGB = [232, 124, 44];
const FLAME_EDGE: RGB = [120, 44, 20];
const WATER_DARK: RGB = [34, 52, 58];
const WATER_LIGHT: RGB = [92, 126, 132];
const SOIL_DARK: RGB = [60, 42, 30];
const SOIL_LIGHT: RGB = [96, 70, 50];
const TERRACOTTA: Ramp = {
  shadow: [104, 52, 34],
  mid: [164, 90, 58],
  light: [206, 132, 90],
  accent: [226, 168, 124],
};
const LEAF_DEEP: RGB = [52, 92, 44];
const LEAF_MID: RGB = [88, 136, 60];
const LEAF_LIGHT: RGB = [148, 190, 96];
const HERB_TWINE: RGB = [184, 164, 120];

/** Remedy liquids seen through glass — each one must stay distinct from its neighbours at 32 px. */
const LIQUID_AMBER: RGB = [196, 128, 38];
const LIQUID_GREEN: RGB = [74, 140, 70];
const LIQUID_BLUE: RGB = [52, 92, 170];
const LIQUID_RUBY: RGB = [160, 36, 52];
const LIQUID_VIOLET: RGB = [112, 68, 142];
const LIQUIDS: readonly RGB[] = [
  LIQUID_AMBER,
  LIQUID_GREEN,
  LIQUID_RUBY,
  LIQUID_BLUE,
  LIQUID_VIOLET,
];

/** Loose dried stock in a bin — chamomile, rose petal, mint, willow bark, calendula. */
const LOOSE_HERBS: readonly RGB[] = [
  [214, 188, 84],
  [186, 92, 104],
  [104, 138, 72],
  [128, 86, 56],
  [226, 138, 48],
];

// ── Small goods painters (a base point, a size, a colour) ───────────────────

/** A round-shouldered glass jar with a cork or cap, a liquid level, a label and a shine. */
function paintGlassJar(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  liquid: RGB,
  ts: number,
): void {
  const top = baseY - h;
  const neckW = w * 0.5;
  const shoulderY = top + h * 0.22;
  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, baseY - h * 0.06);
    ctx.lineTo(cx - w / 2, shoulderY + h * 0.08);
    ctx.quadraticCurveTo(cx - w / 2, shoulderY, cx - neckW / 2, shoulderY - h * 0.02);
    ctx.lineTo(cx - neckW / 2, top + h * 0.08);
    ctx.lineTo(cx + neckW / 2, top + h * 0.08);
    ctx.lineTo(cx + neckW / 2, shoulderY - h * 0.02);
    ctx.quadraticCurveTo(cx + w / 2, shoulderY, cx + w / 2, shoulderY + h * 0.08);
    ctx.lineTo(cx + w / 2, baseY - h * 0.06);
    ctx.quadraticCurveTo(cx + w / 2, baseY, cx + w / 2 - h * 0.06, baseY);
    ctx.lineTo(cx - w / 2 + h * 0.06, baseY);
    ctx.quadraticCurveTo(cx - w / 2, baseY, cx - w / 2, baseY - h * 0.06);
    ctx.closePath();
  };
  body();
  ctx.fillStyle = rgb(mix(GLASS_TINT, liquid, 0.25));
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  const levelY = top + h * 0.4;
  ctx.fillStyle = rgb(liquid);
  ctx.fillRect(cx - w / 2, levelY, w, baseY - levelY);
  ctx.fillStyle = rgb(mix(liquid, TOWN_INK, 0.35));
  ctx.fillRect(cx + w * 0.18, levelY, w * 0.32, baseY - levelY);
  ctx.fillStyle = rgba(mix(liquid, [255, 255, 255], 0.5), 0.9);
  ctx.fillRect(cx - w / 2, levelY, w, Math.max(1, h * 0.05));
  ctx.restore();
  body();
  inkOutline(ctx, ts);
  // A paper label across the belly: what makes an apothecary's jar its own.
  ctx.fillStyle = rgb(LABEL_PAPER);
  ctx.fillRect(cx - w * 0.34, baseY - h * 0.46, w * 0.68, h * 0.2);
  ctx.fillStyle = rgba(TOWN_INK, 0.55);
  ctx.fillRect(cx - w * 0.22, baseY - h * 0.38, w * 0.44, Math.max(1, h * 0.04));
  ctx.fillStyle = rgba([255, 255, 255], 0.75);
  ctx.fillRect(cx - w * 0.36, shoulderY + h * 0.06, Math.max(1, w * 0.1), h * 0.26);
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55));
  ctx.beginPath();
  ctx.rect(cx - neckW * 0.62, top, neckW * 1.24, h * 0.12);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
}

/** A waisted, lidded albarello in cream glaze with a blue band — the drug jar every apothecary shelf is known by. */
function paintAlbarello(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  band: RGB,
  ts: number,
): void {
  const top = baseY - h;
  const waist = w * 0.4;
  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, baseY);
    ctx.quadraticCurveTo(cx - waist, baseY - h * 0.45, cx - w / 2, top + h * 0.14);
    ctx.lineTo(cx + w / 2, top + h * 0.14);
    ctx.quadraticCurveTo(cx + waist, baseY - h * 0.45, cx + w / 2, baseY);
    ctx.closePath();
  };
  body();
  ctx.fillStyle = rgb(GLAZE_WHITE);
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = rgb(band);
  ctx.fillRect(cx - w / 2, baseY - h * 0.62, w, h * 0.3);
  ctx.fillStyle = rgb(mix(band, GLAZE_WHITE, 0.55));
  ctx.fillRect(cx - w / 2, baseY - h * 0.54, w, Math.max(1, h * 0.07));
  ctx.fillStyle = rgba(TOWN_INK, 0.22);
  ctx.fillRect(cx + w * 0.16, top, w * 0.4, h);
  ctx.fillStyle = rgba([255, 255, 255], 0.7);
  ctx.fillRect(cx - w * 0.34, top + h * 0.2, Math.max(1, w * 0.1), h * 0.6);
  ctx.restore();
  body();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(mix(GLAZE_WHITE, band, 0.25));
  ctx.beginPath();
  ctx.ellipse(cx, top + h * 0.12, w * 0.5, h * 0.1, 0, Math.PI, 0);
  ctx.lineTo(cx + w * 0.5, top + h * 0.14);
  ctx.lineTo(cx - w * 0.5, top + h * 0.14);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(band);
  ctx.beginPath();
  ctx.arc(cx, top + h * 0.02, Math.max(1.5, w * 0.1), 0, Math.PI * 2);
  ctx.fill();
}

/** A narrow-necked stoppered bottle. */
function paintBottle(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  liquid: RGB,
  ts: number,
): void {
  const top = baseY - h;
  const neckW = w * 0.34;
  const shoulderY = top + h * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY);
  ctx.lineTo(cx - w / 2, shoulderY + h * 0.1);
  ctx.quadraticCurveTo(cx - w / 2, shoulderY, cx - neckW / 2, shoulderY - h * 0.06);
  ctx.lineTo(cx - neckW / 2, top + h * 0.1);
  ctx.lineTo(cx + neckW / 2, top + h * 0.1);
  ctx.lineTo(cx + neckW / 2, shoulderY - h * 0.06);
  ctx.quadraticCurveTo(cx + w / 2, shoulderY, cx + w / 2, shoulderY + h * 0.1);
  ctx.lineTo(cx + w / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = rgb(liquid);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgba(TOWN_INK, 0.3);
  ctx.fillRect(cx + w * 0.12, shoulderY, w * 0.36, baseY - shoulderY);
  ctx.fillStyle = rgba([255, 255, 255], 0.65);
  ctx.fillRect(cx - w * 0.34, shoulderY + h * 0.04, Math.max(1, w * 0.14), h * 0.34);
  ctx.fillStyle = rgb(LABEL_PAPER);
  ctx.fillRect(cx - w * 0.36, baseY - h * 0.34, w * 0.72, h * 0.16);
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.7));
  ctx.fillRect(cx - neckW * 0.6, top, neckW * 1.2, h * 0.12);
}

/** A folded paper packet tied with twine — a dose made up and waiting to be collected. */
function paintPacket(ctx: Ctx, x: number, baseY: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(LABEL_PAPER);
  ctx.beginPath();
  ctx.rect(x, baseY - h, w, h);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(LABEL_SHADOW);
  ctx.fillRect(x + w * 0.62, baseY - h, w * 0.38, h);
  ctx.strokeStyle = rgb(HERB_TWINE);
  ctx.lineWidth = Math.max(1, ts * 0.018);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, baseY - h);
  ctx.lineTo(x + w * 0.5, baseY);
  ctx.moveTo(x, baseY - h * 0.5);
  ctx.lineTo(x + w, baseY - h * 0.5);
  ctx.stroke();
}

// ── The counter ─────────────────────────────────────────────────────────────

const COUNTER_HEIGHT_TILES = 0.98;
const COUNTER_TOP_DEPTH_TILES = 0.26;

/**
 * One section of Fen's shop counter, several tiles wide: a thick oak top
 * seen from above, a front of raised walnut panels between pilasters, and
 * a dark plinth. Variant 0 is the west section — the end nearest the back
 * of the shop, where the keeper works — and carries the balance scale,
 * the open ledger and made-up packets; variant 1 is the customer's end,
 * with the show globe, the mortar and a bell to ring. Each section closes
 * only its own outer end, so two placed side by side read as one run.
 */
export function paintApothecaryCounter(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.36);
    const isWestSection = variant % 2 === 0;
    const bodyTop = box.bottom - ts * COUNTER_HEIGHT_TILES;
    const topDepth = ts * COUNTER_TOP_DEPTH_TILES;
    const lipH = ts * 0.08;
    const faceTop = bodyTop + topDepth + lipH;
    const plinthH = ts * 0.1;

    // Front face: walnut carcass, one raised panel per tile between pilasters.
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.42));
    ctx.fillRect(box.left, faceTop, box.width, box.bottom - faceTop);
    const panels = Math.round(box.width / ts);
    const pilasterW = ts * 0.1;
    for (let i = 0; i < panels; i++) {
      const px = box.left + i * ts + pilasterW;
      const pw = ts - pilasterW * 2;
      const py = faceTop + ts * 0.08;
      const ph = box.bottom - plinthH - py - ts * 0.06;
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.3));
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55 + jitter(rng, 0.03)));
      ctx.fillRect(px + ts * 0.04, py + ts * 0.04, pw - ts * 0.08, ph - ts * 0.08);
      ctx.fillStyle = rgba(sampleRamp(WALNUT, 0.85), 0.8);
      ctx.fillRect(px, py, pw, Math.max(1, ts * 0.02));
      ctx.fillRect(px, py, Math.max(1, ts * 0.02), ph);
      ctx.fillStyle = rgba(TOWN_INK, 0.45);
      ctx.fillRect(px, py + ph - Math.max(1, ts * 0.02), pw, Math.max(1, ts * 0.02));
      // A brass escutcheon on alternate panels — drawers under the counter, not bare boards.
      if (i % 2 === 1) {
        ctx.fillStyle = rgb(BRASS_BRIGHT);
        ctx.beginPath();
        ctx.arc(px + pw / 2, py + ph * 0.45, ts * 0.035, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(BRASS_DIM);
        ctx.fillRect(px + pw / 2 - 1, py + ph * 0.45, 2, ts * 0.05);
      }
    }
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.12));
    ctx.fillRect(box.left, box.bottom - plinthH, box.width, plinthH);

    // Top: a thick lighter oak slab seen from above, with a lit front lip.
    const oak = woodRamp();
    ctx.fillStyle = rgb(sampleRamp(oak, 0.72));
    ctx.fillRect(box.left, bodyTop, box.width, topDepth);
    ctx.strokeStyle = rgba(sampleRamp(oak, 0.5), 0.6);
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const gy = bodyTop + (topDepth * i) / 3;
      ctx.beginPath();
      ctx.moveTo(box.left, gy);
      ctx.lineTo(box.right, gy + jitter(rng, 1));
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(oak, 0.92));
    ctx.fillRect(box.left, bodyTop + topDepth, box.width, lipH * 0.45);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.45));
    ctx.fillRect(box.left, bodyTop + topDepth + lipH * 0.45, box.width, lipH * 0.55);
    ctx.fillStyle = rgba(TOWN_INK, 0.35);
    ctx.fillRect(box.left, faceTop, box.width, Math.max(1, ts * 0.03));

    // Outline: the whole run's top and foot, and only this section's outer end.
    ctx.strokeStyle = rgba(TOWN_INK, 0.85);
    ctx.lineWidth = Math.max(1, ts / 32);
    ctx.beginPath();
    ctx.moveTo(box.left, bodyTop + 1);
    ctx.lineTo(box.right, bodyTop + 1);
    ctx.moveTo(box.left, box.bottom - 1);
    ctx.lineTo(box.right, box.bottom - 1);
    const endX = isWestSection ? box.left + 1 : box.right - 1;
    ctx.moveTo(endX, bodyTop);
    ctx.lineTo(endX, box.bottom);
    ctx.stroke();

    const standY = bodyTop + topDepth * 0.72;
    if (isWestSection) paintCounterKeeperEnd(ctx, box, standY, ts, forkRng(rng));
    else paintCounterCustomerEnd(ctx, box, standY, ts, forkRng(rng));
  });
}

function paintBalanceScale(ctx: Ctx, cx: number, baseY: number, ts: number): void {
  const postH = ts * 0.62;
  const beamW = ts * 0.62;
  const beamY = baseY - postH;
  ctx.fillStyle = rgb(BRASS_DIM);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - ts * 0.02, ts * 0.13, ts * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.rect(cx - ts * 0.025, beamY, ts * 0.05, postH);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.beginPath();
  ctx.rect(cx - beamW / 2, beamY - ts * 0.02, beamW, ts * 0.04);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.beginPath();
  ctx.moveTo(cx, beamY - ts * 0.1);
  ctx.lineTo(cx - ts * 0.03, beamY - ts * 0.02);
  ctx.lineTo(cx + ts * 0.03, beamY - ts * 0.02);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  for (const side of [-1, 1]) {
    const px = cx + (side * beamW) / 2;
    const panY = beamY + postH * 0.62 + (side < 0 ? ts * 0.03 : 0);
    ctx.strokeStyle = rgba(TOWN_INK, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, beamY);
    ctx.lineTo(px - ts * 0.09, panY);
    ctx.moveTo(px, beamY);
    ctx.lineTo(px + ts * 0.09, panY);
    ctx.stroke();
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.ellipse(px, panY, ts * 0.11, ts * 0.035, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
  }
  // A little heap of powder in the left pan, being weighed out.
  ctx.fillStyle = rgb(LOOSE_HERBS[0]);
  ctx.beginPath();
  ctx.ellipse(cx - beamW / 2, beamY + postH * 0.62, ts * 0.06, ts * 0.03, 0, Math.PI, 0);
  ctx.fill();
}

function paintOpenLedger(ctx: Ctx, cx: number, baseY: number, ts: number, rng: Rng): void {
  const w = ts * 0.5;
  const h = ts * 0.16;
  const top = baseY - h;
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.25));
  ctx.fillRect(cx - w / 2 - 2, top + 2, w + 4, h);
  for (const side of [-1, 1]) {
    ctx.fillStyle = rgb(side < 0 ? LABEL_PAPER : mix(LABEL_PAPER, LABEL_SHADOW, 0.4));
    ctx.beginPath();
    ctx.moveTo(cx, top + h * 0.2);
    ctx.lineTo(cx + (side * w) / 2, top);
    ctx.lineTo(cx + (side * w) / 2, top + h);
    ctx.lineTo(cx, top + h);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgba(TOWN_INK, 0.4);
    ctx.lineWidth = 1;
    for (let line = 0; line < 3; line++) {
      const ly = top + h * (0.35 + line * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx + side * w * 0.08, ly);
      ctx.lineTo(cx + side * w * (0.38 + jitter(rng, 0.05)), ly - h * 0.1);
      ctx.stroke();
    }
  }
}

function paintInkAndQuill(ctx: Ctx, cx: number, baseY: number, ts: number): void {
  ctx.fillStyle = rgb([30, 30, 36]);
  ctx.beginPath();
  ctx.rect(cx - ts * 0.05, baseY - ts * 0.09, ts * 0.1, ts * 0.09);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.strokeStyle = rgb([236, 232, 220]);
  ctx.lineWidth = ts * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, baseY - ts * 0.08);
  ctx.quadraticCurveTo(cx + ts * 0.08, baseY - ts * 0.26, cx + ts * 0.14, baseY - ts * 0.36);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function paintCounterKeeperEnd(
  ctx: Ctx,
  box: FootprintBox,
  standY: number,
  ts: number,
  rng: Rng,
): void {
  paintBalanceScale(ctx, box.left + ts * 0.55, standY, ts);
  paintOpenLedger(ctx, box.left + ts * 1.45, standY, ts, rng);
  paintInkAndQuill(ctx, box.left + ts * 1.85, standY, ts);
  const packetW = ts * 0.2;
  const packetH = ts * 0.11;
  for (let i = 0; i < 3; i++)
    paintPacket(
      ctx,
      box.left + ts * 2.25 + jitter(rng, ts * 0.02),
      standY - i * packetH,
      packetW,
      packetH,
      ts,
    );
  paintPacket(ctx, box.left + ts * 2.5, standY, packetW, packetH, ts);
  const bottleXs = [2.95, 3.18, 3.4, 3.62];
  bottleXs.forEach((bx, i) =>
    paintBottle(
      ctx,
      box.left + ts * bx,
      standY,
      ts * 0.16,
      ts * (0.34 + (i % 2) * 0.06),
      LIQUIDS[i % LIQUIDS.length],
      ts,
    ),
  );
}

function paintShowGlobe(ctx: Ctx, cx: number, baseY: number, ts: number, liquid: RGB): void {
  const r = ts * 0.2;
  const globeY = baseY - ts * 0.12 - r;
  ctx.fillStyle = rgb(BRASS_DIM);
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.12, baseY);
  ctx.lineTo(cx - ts * 0.05, baseY - ts * 0.12);
  ctx.lineTo(cx + ts * 0.05, baseY - ts * 0.12);
  ctx.lineTo(cx + ts * 0.12, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  const glow = ctx.createRadialGradient(cx - r * 0.3, globeY - r * 0.3, 1, cx, globeY, r);
  glow.addColorStop(0, rgb(mix(liquid, [255, 255, 255], 0.45)));
  glow.addColorStop(0.6, rgb(liquid));
  glow.addColorStop(1, rgb(mix(liquid, TOWN_INK, 0.45)));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, globeY, r, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(mix(GLASS_TINT, liquid, 0.2));
  ctx.beginPath();
  ctx.rect(cx - ts * 0.045, globeY - r - ts * 0.16, ts * 0.09, ts * 0.17);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.arc(cx, globeY - r - ts * 0.18, ts * 0.05, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgba([255, 255, 255], 0.8);
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.45, globeY - r * 0.35, r * 0.14, r * 0.28, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function paintCounterMortar(ctx: Ctx, cx: number, baseY: number, ts: number): void {
  const w = ts * 0.34;
  const h = ts * 0.2;
  const stone = stoneRamp();
  ctx.fillStyle = rgb(sampleRamp(stone, 0.6));
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY - h);
  ctx.quadraticCurveTo(cx - w / 2, baseY, cx, baseY);
  ctx.quadraticCurveTo(cx + w / 2, baseY, cx + w / 2, baseY - h);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgba(TOWN_INK, 0.25);
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.1, baseY - h);
  ctx.quadraticCurveTo(cx + w * 0.45, baseY - h * 0.2, cx + w * 0.1, baseY - h * 0.05);
  ctx.quadraticCurveTo(cx + w * 0.5, baseY, cx + w / 2, baseY - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(sampleRamp(stone, 0.2));
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h, w / 2, h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(LEAF_MID);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h + h * 0.05, w * 0.34, h * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(cx + w * 0.12, baseY - h);
  ctx.rotate(Math.PI * 0.2);
  ctx.fillStyle = rgb(sampleRamp(stone, 0.8));
  ctx.beginPath();
  ctx.roundRect(-ts * 0.035, -ts * 0.3, ts * 0.07, ts * 0.32, ts * 0.035);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.restore();
}

function paintCuttingBoard(ctx: Ctx, cx: number, baseY: number, ts: number): void {
  const w = ts * 0.44;
  const h = ts * 0.1;
  ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.85));
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, baseY - h, w, h, h * 0.3);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  // A sprig laid out to be chopped, and the knife beside it.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rgb(i % 2 === 0 ? LEAF_MID : LEAF_LIGHT);
    ctx.beginPath();
    ctx.ellipse(
      cx - w * 0.3 + i * w * 0.1,
      baseY - h * 0.9,
      ts * 0.04,
      ts * 0.022,
      -0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = rgb(sampleRamp(stoneRamp(), 0.9));
  ctx.lineWidth = ts * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.1, baseY - h * 0.6);
  ctx.lineTo(cx + w * 0.42, baseY - h * 0.8);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.3));
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.42, baseY - h * 0.8);
  ctx.lineTo(cx + w * 0.58, baseY - h * 0.9);
  ctx.stroke();
}

function paintCounterBell(ctx: Ctx, cx: number, baseY: number, ts: number): void {
  const r = ts * 0.09;
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.2, baseY);
  ctx.quadraticCurveTo(cx - r, baseY - r * 1.6, cx, baseY - r * 1.6);
  ctx.quadraticCurveTo(cx + r, baseY - r * 1.6, cx + r * 1.2, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(BRASS_DIM);
  ctx.fillRect(cx - 1, baseY - r * 2, 2, r * 0.45);
}

function paintCounterCustomerEnd(
  ctx: Ctx,
  box: FootprintBox,
  standY: number,
  ts: number,
  rng: Rng,
): void {
  const jarXs = [0.3, 0.62];
  jarXs.forEach((jx, i) =>
    paintGlassJar(
      ctx,
      box.left + ts * jx,
      standY,
      ts * 0.26,
      ts * 0.34,
      LIQUIDS[(i + 3) % LIQUIDS.length],
      ts,
    ),
  );
  paintCounterMortar(ctx, box.left + ts * 1.15, standY, ts);
  paintCuttingBoard(ctx, box.left + ts * 1.8, standY, ts);
  paintShowGlobe(ctx, box.left + ts * 2.55, standY, ts, LIQUID_RUBY);
  paintCounterBell(ctx, box.left + ts * 3.05, standY, ts);
  paintAlbarello(
    ctx,
    box.left + ts * 3.5,
    standY,
    ts * 0.26,
    ts * 0.36 + jitter(rng, 1),
    GLAZE_BLUE,
    ts,
  );
}

// ── The apothecary cabinet ──────────────────────────────────────────────────

const CABINET_HEIGHT_TILES = 3.15;
const CABINET_DRAWER_BANK_TILES = 1.3;
const CABINET_CORNICE_TILES = 0.34;
const CABINET_SHELF_ROWS = 3;

/**
 * The wall behind Fen's counter, built as one piece of joinery: a walnut
 * cabinet two tiles deep that climbs well past its footprint. The lower
 * bank is a grid of small labelled drawers — one drug to a drawer — split
 * by a locked cupboard in the middle; above a ledge rise three bays of
 * open shelving crammed with glazed albarelli, labelled glass jars and
 * bottles; a cornice with a painted mortar-and-pestle crest caps it, and
 * two big show jars stand on top. A light from the upper left leaves the
 * right-hand face of every bay and the underside of every shelf in shadow.
 */
export function paintApothecaryCabinet(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.4);
    const top = box.bottom - ts * CABINET_HEIGHT_TILES;
    const plinthH = ts * 0.12;
    const ledgeY = box.bottom - ts * CABINET_DRAWER_BANK_TILES;
    const corniceBottom = top + ts * CABINET_CORNICE_TILES;
    const postW = ts * 0.14;

    // Carcass.
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.38));
    ctx.fillRect(box.left, top, box.width, box.bottom - top);

    // Upper shelving: three bays, dark backs, each shelf board lit on its front edge.
    const bays = 3;
    const innerLeft = box.left + postW;
    const innerRight = box.right - postW;
    const bayGap = ts * 0.1;
    const bayW = (innerRight - innerLeft - bayGap * (bays - 1)) / bays;
    const shelfSpan = ledgeY - corniceBottom;
    const rowH = shelfSpan / CABINET_SHELF_ROWS;
    const boardH = ts * 0.06;
    const itemRng = forkRng(rng);
    for (let b = 0; b < bays; b++) {
      const bx = innerLeft + b * (bayW + bayGap);
      const back = ctx.createLinearGradient(0, corniceBottom, 0, ledgeY);
      back.addColorStop(0, rgb(sampleRamp(WALNUT, 0.05)));
      back.addColorStop(1, rgb(sampleRamp(WALNUT, 0.2)));
      ctx.fillStyle = back;
      ctx.fillRect(bx, corniceBottom, bayW, shelfSpan);
      for (let r = 0; r < CABINET_SHELF_ROWS; r++) {
        const shelfY = corniceBottom + rowH * (r + 1) - boardH;
        // Shadow cast down the back by the shelf above.
        ctx.fillStyle = rgba(TOWN_INK, 0.35);
        ctx.fillRect(bx, shelfY - rowH + boardH, bayW, rowH * 0.18);
        paintShelfRow(
          ctx,
          bx,
          bx + bayW,
          shelfY,
          rowH - boardH,
          ts,
          b * CABINET_SHELF_ROWS + r + variant,
          itemRng,
        );
        ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.7));
        ctx.fillRect(bx, shelfY, bayW, boardH);
        ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.9));
        ctx.fillRect(bx, shelfY, bayW, Math.max(1, boardH * 0.3));
      }
      // The bay's right-hand wall, in shade.
      ctx.fillStyle = rgba(TOWN_INK, 0.3);
      ctx.fillRect(bx + bayW - ts * 0.05, corniceBottom, ts * 0.05, shelfSpan);
      ctx.beginPath();
      ctx.rect(bx, corniceBottom, bayW, shelfSpan);
      inkOutline(ctx, ts);
    }

    // Ledge between the shelving and the drawers.
    const ledgeH = ts * 0.1;
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.8));
    ctx.fillRect(box.left, ledgeY - ledgeH * 0.2, box.width, ledgeH);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.95));
    ctx.fillRect(box.left, ledgeY - ledgeH * 0.2, box.width, Math.max(1, ledgeH * 0.3));
    ctx.beginPath();
    ctx.rect(box.left, ledgeY - ledgeH * 0.2, box.width, ledgeH);
    inkOutline(ctx, ts);

    // Drawer bank: two banks of small labelled drawers either side of a cupboard.
    const bankTop = ledgeY + ledgeH * 0.8;
    const bankBottom = box.bottom - plinthH;
    const cupboardW = ts * 1.1;
    const cupboardLeft = box.centreX - cupboardW / 2;
    const drawerRows = 4;
    const drawerColsPerBank = 7;
    const drawerRng = forkRng(rng);
    paintDrawerBank(
      ctx,
      innerLeft,
      cupboardLeft - ts * 0.05,
      bankTop,
      bankBottom,
      drawerColsPerBank,
      drawerRows,
      ts,
      drawerRng,
    );
    paintDrawerBank(
      ctx,
      cupboardLeft + cupboardW + ts * 0.05,
      innerRight,
      bankTop,
      bankBottom,
      drawerColsPerBank,
      drawerRows,
      ts,
      drawerRng,
    );
    paintCupboardDoors(ctx, cupboardLeft, bankTop, cupboardW, bankBottom - bankTop, ts);

    // Posts, plinth and cornice.
    for (const px of [box.left, box.right - postW]) {
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.5));
      ctx.fillRect(px, top, postW, box.bottom - top);
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.78));
      ctx.fillRect(px + postW * 0.15, top, postW * 0.2, box.bottom - top);
      ctx.fillStyle = rgba(TOWN_INK, 0.3);
      ctx.fillRect(px + postW * 0.75, top, postW * 0.25, box.bottom - top);
    }
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.15));
    ctx.fillRect(box.left, box.bottom - plinthH, box.width, plinthH);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55));
    ctx.fillRect(box.left, top, box.width, corniceBottom - top);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.88));
    ctx.fillRect(box.left, top, box.width, ts * 0.06);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.25));
    ctx.fillRect(box.left, corniceBottom - ts * 0.07, box.width, ts * 0.07);
    ctx.beginPath();
    ctx.rect(box.left, top, box.width, box.bottom - top);
    inkOutline(ctx, ts);

    paintCabinetCrest(ctx, box.centreX, top + (corniceBottom - top) * 0.5, ts);
    // Show jars standing on the cornice, the shop's sign to anyone in the doorway.
    paintGlassJar(ctx, box.left + ts * 0.7, top, ts * 0.4, ts * 0.5, LIQUID_GREEN, ts);
    paintAlbarello(ctx, box.left + ts * 1.3, top, ts * 0.32, ts * 0.42, GLAZE_BLUE, ts);
    paintAlbarello(ctx, box.right - ts * 1.3, top, ts * 0.32, ts * 0.42, GLAZE_BLUE, ts);
    paintGlassJar(ctx, box.right - ts * 0.7, top, ts * 0.4, ts * 0.5, LIQUID_AMBER, ts);
  });
}

/** One shelf's worth of stock: albarelli, labelled jars and bottles in a kit that varies by row. */
function paintShelfRow(
  ctx: Ctx,
  left: number,
  right: number,
  shelfY: number,
  rowH: number,
  ts: number,
  kit: number,
  rng: Rng,
): void {
  const tall = rowH * 0.86;
  let x = left + ts * 0.08;
  let slot = 0;
  while (x < right - ts * 0.14) {
    const pick = (kit + slot) % 5;
    const liquid = LIQUIDS[(kit * 2 + slot) % LIQUIDS.length];
    const heightScale = 0.78 + ((kit + slot * 3) % 3) * 0.1 + jitter(rng, 0.03);
    let w: number;
    if (pick === 0 || pick === 3) {
      w = ts * 0.24;
      paintAlbarello(
        ctx,
        x + w / 2,
        shelfY,
        w,
        tall * heightScale,
        slot % 2 === 0 ? GLAZE_BLUE : mix(GLAZE_BLUE, LIQUID_GREEN, 0.6),
        ts,
      );
    } else if (pick === 1 || pick === 4) {
      w = ts * 0.22;
      paintGlassJar(ctx, x + w / 2, shelfY, w, tall * heightScale * 0.9, liquid, ts);
    } else {
      w = ts * 0.13;
      paintBottle(ctx, x + w / 2, shelfY, w, tall * heightScale, liquid, ts);
    }
    x += w + ts * 0.05;
    slot++;
  }
}

function paintDrawerBank(
  ctx: Ctx,
  left: number,
  right: number,
  top: number,
  bottom: number,
  cols: number,
  rows: number,
  ts: number,
  rng: Rng,
): void {
  const cellW = (right - left) / cols;
  const cellH = (bottom - top) / rows;
  const gap = Math.max(1, ts * 0.025);
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.1));
  ctx.fillRect(left, top, right - left, bottom - top);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = left + c * cellW + gap / 2;
      const y = top + r * cellH + gap / 2;
      const w = cellW - gap;
      const h = cellH - gap;
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.5 + jitter(rng, 0.05)));
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = rgba(sampleRamp(WALNUT, 0.9), 0.8);
      ctx.fillRect(x, y, w, Math.max(1, h * 0.1));
      ctx.fillStyle = rgba(TOWN_INK, 0.35);
      ctx.fillRect(x, y + h - Math.max(1, h * 0.12), w, Math.max(1, h * 0.12));
      ctx.fillStyle = rgb(LABEL_PAPER);
      ctx.fillRect(x + w * 0.2, y + h * 0.18, w * 0.6, h * 0.3);
      ctx.fillStyle = rgba(TOWN_INK, 0.5);
      ctx.fillRect(x + w * 0.28, y + h * 0.3, w * (0.3 + jitter(rng, 0.1)), Math.max(1, h * 0.06));
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h * 0.66, Math.max(1.5, ts * 0.022), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  inkOutline(ctx, ts);
}

function paintCupboardDoors(
  ctx: Ctx,
  left: number,
  top: number,
  w: number,
  h: number,
  ts: number,
): void {
  for (let d = 0; d < 2; d++) {
    const x = left + (d * w) / 2;
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.45));
    ctx.fillRect(x, top, w / 2, h);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.6));
    ctx.fillRect(x + ts * 0.06, top + ts * 0.06, w / 2 - ts * 0.12, h - ts * 0.12);
    ctx.fillStyle = rgba(sampleRamp(WALNUT, 0.9), 0.8);
    ctx.fillRect(x + ts * 0.06, top + ts * 0.06, w / 2 - ts * 0.12, Math.max(1, ts * 0.02));
    ctx.beginPath();
    ctx.rect(x, top, w / 2, h);
    inkOutline(ctx, ts);
  }
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.rect(left + w / 2 - ts * 0.05, top + h * 0.4, ts * 0.1, ts * 0.13);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(TOWN_INK);
  ctx.fillRect(left + w / 2 - 1, top + h * 0.4 + ts * 0.04, 2, ts * 0.05);
}

/** A painted oval crest on the cornice: a mortar and pestle in gold on deep green. */
function paintCabinetCrest(ctx: Ctx, cx: number, cy: number, ts: number): void {
  const rx = ts * 0.42;
  const ry = ts * 0.2;
  ctx.fillStyle = rgb([38, 70, 52]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(BRASS_BRIGHT);
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.stroke();
  ctx.fillStyle = rgb(BRASS_BRIGHT);
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.13, cy - ts * 0.02);
  ctx.quadraticCurveTo(cx - ts * 0.13, cy + ts * 0.12, cx, cy + ts * 0.12);
  ctx.quadraticCurveTo(cx + ts * 0.13, cy + ts * 0.12, cx + ts * 0.13, cy - ts * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgb(BRASS_BRIGHT);
  ctx.lineWidth = Math.max(1, ts * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + ts * 0.02, cy);
  ctx.lineTo(cx + ts * 0.16, cy - ts * 0.14);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// ── The copper still ────────────────────────────────────────────────────────

/**
 * A working pot still, three tiles wide and two deep: a brick firebox with
 * a live flame under a big riveted copper pot, a helmet on top, and a swan
 * neck that rises past the wall line and runs down into a hooped wooden
 * worm tub, the copper coil showing above its water. The spout at the
 * tub's foot drips into a collecting jar; split logs wait by the firebox.
 */
export function paintStill(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.36);
    const groundY = box.bottom - ts * 0.18;

    // Firebox glow thrown onto the floor in front of it.
    const fireX = box.left + ts * 1.0;
    const floorGlow = ctx.createRadialGradient(
      fireX,
      groundY + ts * 0.1,
      1,
      fireX,
      groundY + ts * 0.1,
      ts * 0.8,
    );
    floorGlow.addColorStop(0, rgba(FLAME_MID, 0.4));
    floorGlow.addColorStop(1, rgba(FLAME_MID, 0));
    ctx.fillStyle = floorGlow;
    ctx.fillRect(box.left, groundY - ts * 0.5, ts * 2, ts * 0.9);

    // Brick furnace.
    const furnaceLeft = box.left + ts * 0.35;
    const furnaceW = ts * 1.3;
    const furnaceH = ts * 0.78;
    const furnaceTop = groundY - furnaceH;
    paintBrickBlock(ctx, furnaceLeft, furnaceTop, furnaceW, furnaceH, ts, forkRng(rng));
    const archW = ts * 0.5;
    const archLeft = fireX - archW / 2;
    const archTop = furnaceTop + furnaceH * 0.3;
    ctx.fillStyle = rgb([28, 16, 12]);
    ctx.beginPath();
    ctx.moveTo(archLeft, groundY);
    ctx.lineTo(archLeft, archTop + archW * 0.3);
    ctx.arc(fireX, archTop + archW * 0.3, archW / 2, Math.PI, 0);
    ctx.lineTo(archLeft + archW, groundY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    paintFlame(ctx, fireX, groundY - ts * 0.04, archW * 0.8, ts * 0.34, ts);

    // Copper pot: an onion body sitting in the furnace's top.
    const potCx = fireX;
    const potW = ts * 1.34;
    const potH = ts * 1.0;
    const potBottom = furnaceTop + ts * 0.14;
    const potTop = potBottom - potH;
    const potBody = (): void => {
      ctx.beginPath();
      ctx.moveTo(potCx - potW * 0.36, potBottom);
      ctx.bezierCurveTo(
        potCx - potW * 0.62,
        potBottom - potH * 0.35,
        potCx - potW * 0.52,
        potTop + potH * 0.2,
        potCx - potW * 0.16,
        potTop + potH * 0.06,
      );
      ctx.lineTo(potCx + potW * 0.16, potTop + potH * 0.06);
      ctx.bezierCurveTo(
        potCx + potW * 0.52,
        potTop + potH * 0.2,
        potCx + potW * 0.62,
        potBottom - potH * 0.35,
        potCx + potW * 0.36,
        potBottom,
      );
      ctx.closePath();
    };
    paintCopperFill(ctx, potBody, potCx - potW * 0.5, potCx + potW * 0.5, potTop, potBottom);
    potBody();
    inkOutline(ctx, ts);
    // Riveted seam band.
    const seamY = potTop + potH * 0.52;
    ctx.strokeStyle = rgb(COPPER.shadow);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.ellipse(potCx, seamY, potW * 0.5, potH * 0.08, 0, 0, Math.PI);
    ctx.stroke();
    ctx.fillStyle = rgb(COPPER.accent);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.12 + (0.76 * i) / 6);
      ctx.beginPath();
      ctx.arc(
        potCx + Math.cos(a) * potW * 0.49,
        seamY + Math.sin(a) * potH * 0.08 - ts * 0.03,
        Math.max(1, ts * 0.018),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Helmet and swan neck.
    const helmW = ts * 0.52;
    const helmH = ts * 0.34;
    const helmBottom = potTop + potH * 0.08;
    const helmTop = helmBottom - helmH;
    const helmBody = (): void => {
      ctx.beginPath();
      ctx.moveTo(potCx - helmW / 2, helmBottom);
      ctx.quadraticCurveTo(potCx - helmW / 2, helmTop, potCx, helmTop);
      ctx.quadraticCurveTo(potCx + helmW / 2, helmTop, potCx + helmW / 2, helmBottom);
      ctx.closePath();
    };
    paintCopperFill(ctx, helmBody, potCx - helmW / 2, potCx + helmW / 2, helmTop, helmBottom);
    helmBody();
    inkOutline(ctx, ts);

    const tubCx = box.left + ts * 2.42;
    const tubW = ts * 0.98;
    const tubH = ts * 0.92;
    const tubTop = groundY + ts * 0.08 - tubH;
    const neckStartX = potCx + helmW * 0.18;
    const neckStartY = helmTop + helmH * 0.2;
    const neckPeakY = box.top - ts * 0.5;
    const neckEndX = tubCx - tubW * 0.12;
    const neckEndY = tubTop - ts * 0.22;
    const neckPath = (): void => {
      ctx.beginPath();
      ctx.moveTo(neckStartX, neckStartY);
      ctx.bezierCurveTo(
        neckStartX + ts * 0.05,
        neckPeakY,
        neckStartX + ts * 0.5,
        neckPeakY - ts * 0.05,
        neckStartX + ts * 0.75,
        neckPeakY + ts * 0.15,
      );
      ctx.lineTo(neckEndX, neckEndY);
    };
    ctx.lineCap = 'round';
    neckPath();
    ctx.strokeStyle = rgba(TOWN_INK, 0.9);
    ctx.lineWidth = ts * 0.16;
    ctx.stroke();
    neckPath();
    ctx.strokeStyle = rgb(COPPER.mid);
    ctx.lineWidth = ts * 0.12;
    ctx.stroke();
    neckPath();
    ctx.strokeStyle = rgb(COPPER.accent);
    ctx.lineWidth = ts * 0.03;
    ctx.translate(-ts * 0.02, -ts * 0.03);
    ctx.stroke();
    ctx.translate(ts * 0.02, ts * 0.03);
    ctx.lineCap = 'butt';

    // Worm tub: hooped staves holding dark water, the copper coil above it.
    paintWormTub(ctx, tubCx, tubTop, tubW, tubH, ts, forkRng(rng));
    const coilTurns = 3;
    for (let i = 0; i < coilTurns; i++) {
      const cy = tubTop - ts * 0.16 + i * ts * 0.09;
      ctx.strokeStyle = rgba(TOWN_INK, 0.85);
      ctx.lineWidth = ts * 0.09;
      ctx.beginPath();
      ctx.ellipse(tubCx, cy, tubW * 0.3, ts * 0.07, 0, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();
      ctx.strokeStyle = rgb(i % 2 === 0 ? COPPER.light : COPPER.mid);
      ctx.lineWidth = ts * 0.055;
      ctx.stroke();
    }

    // Spout and collecting jar.
    const spoutY = groundY - ts * 0.3;
    const spoutX = tubCx + tubW * 0.5;
    ctx.strokeStyle = rgba(TOWN_INK, 0.9);
    ctx.lineWidth = ts * 0.07;
    ctx.beginPath();
    ctx.moveTo(spoutX - ts * 0.05, spoutY);
    ctx.lineTo(spoutX + ts * 0.1, spoutY + ts * 0.06);
    ctx.stroke();
    ctx.strokeStyle = rgb(COPPER.light);
    ctx.lineWidth = ts * 0.035;
    ctx.stroke();
    const jarX = Math.min(box.right - ts * 0.16, spoutX + ts * 0.08);
    paintGlassJar(ctx, jarX, box.bottom - ts * 0.04, ts * 0.24, ts * 0.3, LIQUID_AMBER, ts);

    paintLogPile(ctx, box.left + ts * 0.2, box.bottom - ts * 0.04, ts, forkRng(rng));
  });
}

function paintCopperFill(
  ctx: Ctx,
  path: () => void,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  const grad = ctx.createLinearGradient(left, 0, right, 0);
  grad.addColorStop(0, rgb(COPPER.mid));
  grad.addColorStop(0.28, rgb(COPPER.light));
  grad.addColorStop(0.42, rgb(COPPER.accent));
  grad.addColorStop(0.58, rgb(COPPER.mid));
  grad.addColorStop(1, rgb(COPPER.shadow));
  path();
  ctx.fillStyle = grad;
  ctx.fill();
  const shade = ctx.createLinearGradient(0, top, 0, bottom);
  shade.addColorStop(0, rgba(TOWN_INK, 0));
  shade.addColorStop(1, rgba(TOWN_INK, 0.3));
  path();
  ctx.fillStyle = shade;
  ctx.fill();
}

function paintBrickBlock(
  ctx: Ctx,
  left: number,
  top: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  ctx.fillStyle = rgb(sampleRamp(BRICK, 0.2));
  ctx.fillRect(left, top, w, h);
  const courseH = ts * 0.13;
  const brickW = ts * 0.26;
  let row = 0;
  for (let y = top; y < top + h; y += courseH, row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = left - offset; x < left + w; x += brickW) {
      const bx = Math.max(left, x + 1);
      const bw = Math.min(left + w, x + brickW - 1) - bx;
      if (bw <= 0) continue;
      ctx.fillStyle = rgb(sampleRamp(BRICK, 0.5 + jitter(rng, 0.12)));
      ctx.fillRect(bx, y + 1, bw, Math.min(courseH - 2, top + h - y - 1));
    }
  }
  const lit = ctx.createLinearGradient(left, 0, left + w, 0);
  lit.addColorStop(0, rgba([255, 230, 200], 0.12));
  lit.addColorStop(1, rgba(TOWN_INK, 0.25));
  ctx.fillStyle = lit;
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = rgb(sampleRamp(BRICK, 0.8));
  ctx.fillRect(left, top, w, Math.max(1, ts * 0.04));
  ctx.beginPath();
  ctx.rect(left, top, w, h);
  inkOutline(ctx, ts);
}

function paintFlame(ctx: Ctx, cx: number, baseY: number, w: number, h: number, ts: number): void {
  const glow = ctx.createRadialGradient(cx, baseY - h * 0.3, 1, cx, baseY - h * 0.3, w * 0.8);
  glow.addColorStop(0, rgba(FLAME_CORE, 0.9));
  glow.addColorStop(0.5, rgba(FLAME_MID, 0.6));
  glow.addColorStop(1, rgba(FLAME_EDGE, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - w, baseY - h * 1.3, w * 2, h * 1.4);
  const tongues: ReadonlyArray<readonly [number, number, RGB]> = [
    [-0.28, 0.7, FLAME_MID],
    [0.26, 0.78, FLAME_MID],
    [0, 1, FLAME_MID],
    [-0.1, 0.62, FLAME_CORE],
    [0.1, 0.55, FLAME_CORE],
  ];
  for (const [dx, scale, color] of tongues) {
    const tx = cx + dx * w;
    const th = h * scale;
    const tw = w * 0.22;
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.moveTo(tx - tw, baseY);
    ctx.quadraticCurveTo(tx - tw, baseY - th * 0.5, tx, baseY - th);
    ctx.quadraticCurveTo(tx + tw, baseY - th * 0.5, tx + tw, baseY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgb([40, 22, 16]);
  ctx.fillRect(cx - w * 0.5, baseY - ts * 0.02, w, ts * 0.05);
}

function paintWormTub(
  ctx: Ctx,
  cx: number,
  top: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  const oak = woodRamp();
  const bottom = top + h;
  const tub = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.lineTo(cx + w * 0.44, bottom);
    ctx.lineTo(cx - w * 0.44, bottom);
    ctx.closePath();
  };
  tub();
  ctx.fillStyle = rgb(sampleRamp(oak, 0.45));
  ctx.fill();
  ctx.save();
  tub();
  ctx.clip();
  const staves = 6;
  for (let i = 0; i < staves; i++) {
    const sx = cx - w / 2 + (w * i) / staves;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.4 + jitter(rng, 0.08) + (i < staves / 2 ? 0.12 : -0.05)));
    ctx.fillRect(sx + 1, top, w / staves - 2, h);
  }
  ctx.fillStyle = rgba(TOWN_INK, 0.25);
  ctx.fillRect(cx + w * 0.2, top, w * 0.3, h);
  ctx.restore();
  tub();
  inkOutline(ctx, ts);
  const iron = ironRamp();
  for (const f of [0.18, 0.78]) {
    const y = top + h * f;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.fillRect(cx - w * 0.49, y, w * 0.98, ts * 0.05);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.85));
    ctx.fillRect(cx - w * 0.49, y, w * 0.98, Math.max(1, ts * 0.015));
  }
  ctx.fillStyle = rgb(WATER_DARK);
  ctx.beginPath();
  ctx.ellipse(cx, top, w / 2, ts * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.strokeStyle = rgba(WATER_LIGHT, 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.1, top + ts * 0.01, w * 0.2, ts * 0.03, 0, Math.PI, Math.PI * 1.8);
  ctx.stroke();
}

function paintLogPile(ctx: Ctx, left: number, baseY: number, ts: number, rng: Rng): void {
  const oak = woodRamp();
  const r = ts * 0.085;
  const logs: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [2, 0],
    [1, 1],
  ];
  for (const [col, row] of logs) {
    const x = left + col * r * 1.05;
    const y = baseY - r - row * r * 1.6;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.3));
    ctx.fillRect(x - r * 0.1, y - r, r * 0.2, r * 2);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.8 + jitter(rng, 0.05)));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgba(sampleRamp(oak, 0.3), 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ── The drying rack ─────────────────────────────────────────────────────────

type HerbBunchKind = 'lavender' | 'sage' | 'yarrow' | 'rosemary' | 'tansy' | 'hops';
const HERB_BUNCH_ORDER: readonly HerbBunchKind[] = [
  'lavender',
  'sage',
  'yarrow',
  'rosemary',
  'tansy',
  'hops',
  'lavender',
  'sage',
  'yarrow',
  'rosemary',
];

const BUNCH_COLOURS: Record<HerbBunchKind, { readonly leaf: RGB; readonly bloom: RGB | null }> = {
  lavender: { leaf: [84, 104, 72], bloom: [140, 96, 190] },
  sage: { leaf: [118, 140, 104], bloom: null },
  yarrow: { leaf: [70, 100, 52], bloom: [240, 236, 214] },
  rosemary: { leaf: [44, 80, 50], bloom: null },
  tansy: { leaf: [74, 104, 44], bloom: [236, 190, 44] },
  hops: { leaf: [150, 160, 78], bloom: null },
};

/** One bunch hung head-down: a tied neck, stems fanning out, foliage fuller at the bottom, blooms at the tips. */
function paintHerbBunch(
  ctx: Ctx,
  cx: number,
  hangY: number,
  len: number,
  kind: HerbBunchKind,
  ts: number,
  rng: Rng,
): void {
  const { leaf, bloom } = BUNCH_COLOURS[kind];
  const tieY = hangY + len * 0.18;
  const w = len * 0.42;
  ctx.strokeStyle = rgb(HERB_TWINE);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  ctx.moveTo(cx, hangY);
  ctx.lineTo(cx, tieY);
  ctx.stroke();
  const mass = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.12, tieY);
    ctx.quadraticCurveTo(cx - w * 0.55, tieY + len * 0.45, cx - w * 0.5, hangY + len);
    ctx.quadraticCurveTo(cx, hangY + len * 1.08, cx + w * 0.5, hangY + len);
    ctx.quadraticCurveTo(cx + w * 0.55, tieY + len * 0.45, cx + w * 0.12, tieY);
    ctx.closePath();
  };
  mass();
  ctx.fillStyle = rgb(mix(leaf, TOWN_INK, 0.3));
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.save();
  mass();
  ctx.clip();
  const leaves = 14;
  for (let i = 0; i < leaves; i++) {
    const t = (i + 0.5) / leaves;
    const lx = cx + jitter(rng, w * 0.4 * (0.4 + t));
    const ly = tieY + (hangY + len - tieY) * (0.15 + 0.85 * t) + jitter(rng, len * 0.04);
    const lit = lx < cx ? 0.22 : 0.02;
    ctx.fillStyle = rgb(mix(leaf, [255, 255, 255], lit + jitter(rng, 0.05)));
    ctx.beginPath();
    if (kind === 'rosemary' || kind === 'lavender')
      ctx.ellipse(lx, ly, ts * 0.012, ts * 0.045, jitter(rng, 0.3), 0, Math.PI * 2);
    else ctx.ellipse(lx, ly, ts * 0.03, ts * 0.022, jitter(rng, 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (bloom !== null) {
    const tips = 5;
    for (let i = 0; i < tips; i++) {
      const tx = cx - w * 0.4 + (w * 0.8 * i) / (tips - 1) + jitter(rng, ts * 0.01);
      const ty = hangY + len * (0.94 + jitter(rng, 0.04));
      ctx.fillStyle = rgb(bloom);
      ctx.beginPath();
      if (kind === 'lavender') ctx.ellipse(tx, ty, ts * 0.024, ts * 0.06, 0, 0, Math.PI * 2);
      else ctx.arc(tx, ty, ts * (kind === 'yarrow' ? 0.042 : 0.032), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(TOWN_INK, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // The twine binding at the neck.
  ctx.fillStyle = rgb(HERB_TWINE);
  ctx.fillRect(cx - w * 0.16, tieY - ts * 0.015, w * 0.32, ts * 0.04);
}

/**
 * The drying room's long rack: a pole on two iron brackets high on the
 * wall, ten bunches of different herbs hung head-down from it, and under
 * them a slatted trestle holding trays of petals and flower heads laid out
 * to dry — one piece five tiles long rather than a row of small racks.
 */
export function paintHerbDryingRack(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.28);
    const oak = woodRamp();
    const iron = ironRamp();

    // Trestle and trays on the footprint.
    const tableTop = box.bottom - ts * 0.46;
    const topH = ts * 0.08;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.3));
    const legXs = [0.12, box.width / ts / 2, box.width / ts - 0.12];
    for (const lx of legXs) {
      ctx.beginPath();
      ctx.rect(
        box.left + lx * ts - ts * 0.04,
        tableTop + topH,
        ts * 0.08,
        box.bottom - tableTop - topH - ts * 0.03,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(oak, 0.3));
    ctx.fillRect(box.left + ts * 0.1, box.bottom - ts * 0.16, box.width - ts * 0.2, ts * 0.04);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.65));
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.04, tableTop, box.width - ts * 0.08, topH);
    ctx.fill();
    inkOutline(ctx, ts);
    const trays = Math.round(box.width / ts);
    for (let i = 0; i < trays; i++) {
      const trayL = box.left + i * ts + ts * 0.1;
      const trayW = ts * 0.8;
      const trayH = ts * 0.1;
      const trayTop = tableTop - trayH;
      ctx.fillStyle = rgb(sampleRamp(oak, 0.5));
      ctx.beginPath();
      ctx.rect(trayL, trayTop, trayW, trayH);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      const petal = LOOSE_HERBS[i % LOOSE_HERBS.length];
      for (let p = 0; p < 9; p++) {
        ctx.fillStyle = rgb(mix(petal, [255, 255, 255], jitter(rng, 0.12) + 0.12));
        ctx.beginPath();
        ctx.arc(
          trayL + trayW * (0.1 + 0.8 * (p / 8)) + jitter(rng, 2),
          trayTop + jitter(rng, 1.5),
          ts * 0.03,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Pole and brackets on the wall face above.
    const poleY = box.top - ts * 0.62;
    for (const bx of [box.left + ts * 0.3, box.right - ts * 0.3]) {
      ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
      ctx.beginPath();
      ctx.moveTo(bx - ts * 0.03, poleY - ts * 0.1);
      ctx.lineTo(bx + ts * 0.03, poleY - ts * 0.1);
      ctx.lineTo(bx + ts * 0.03, poleY + ts * 0.14);
      ctx.lineTo(bx - ts * 0.03, poleY + ts * 0.14);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(oak, 0.6));
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.06, poleY - ts * 0.04, box.width - ts * 0.12, ts * 0.08);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.9));
    ctx.fillRect(
      box.left + ts * 0.06,
      poleY - ts * 0.03,
      box.width - ts * 0.12,
      Math.max(1, ts * 0.02),
    );

    const bunchCount = HERB_BUNCH_ORDER.length;
    const bunchRng = forkRng(rng);
    for (let i = 0; i < bunchCount; i++) {
      const bx = box.left + ts * 0.3 + ((box.width - ts * 0.6) * i) / (bunchCount - 1);
      const len = ts * (0.6 + ((i * 7) % 3) * 0.07);
      paintHerbBunch(ctx, bx, poleY + ts * 0.03, len, HERB_BUNCH_ORDER[i], ts, bunchRng);
    }
  });
}

// ── Potting bench ───────────────────────────────────────────────────────────

/**
 * A two-tile potting bench under the window: a backboard with a shelf of
 * small pots and a trowel on a hook, seed trays of sprouting rows on the
 * top, a bigger pot being repotted, and stacked empty pots on the
 * slatted shelf below.
 */
export function paintPottingBench(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.32);
    const oak = woodRamp();
    const topY = box.bottom - ts * 0.58;
    const topH = ts * 0.1;

    // Backboard rising behind the bench top, with its own little shelf.
    const backTop = topY - ts * 0.78;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.42));
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.08, backTop, box.width - ts * 0.16, topY - backTop);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(sampleRamp(oak, 0.2), 0.7);
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = backTop + ((topY - backTop) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(box.left + ts * 0.08, y);
      ctx.lineTo(box.right - ts * 0.08, y);
      ctx.stroke();
    }
    const shelfY = backTop + ts * 0.3;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.75));
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.04, shelfY, box.width - ts * 0.08, ts * 0.06);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    for (let i = 0; i < 5; i++) {
      const px = box.left + ts * (0.3 + i * 0.34);
      paintClayPot(ctx, px, shelfY, ts * 0.18, ts * 0.16, ts);
      paintSeedling(ctx, px, shelfY - ts * 0.15, ts * 0.12, ts, forkRng(rng));
    }
    // Trowel on a hook.
    const hookX = box.right - ts * 0.35;
    ctx.fillStyle = rgb(sampleRamp(stoneRamp(), 0.75));
    ctx.beginPath();
    ctx.moveTo(hookX - ts * 0.06, shelfY + ts * 0.18);
    ctx.lineTo(hookX + ts * 0.06, shelfY + ts * 0.18);
    ctx.lineTo(hookX, shelfY + ts * 0.36);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.45));
    ctx.fillRect(hookX - ts * 0.02, shelfY + ts * 0.08, ts * 0.04, ts * 0.1);

    // Legs, lower shelf and stacked pots.
    ctx.fillStyle = rgb(sampleRamp(oak, 0.3));
    for (const lx of [box.left + ts * 0.12, box.right - ts * 0.2]) {
      ctx.beginPath();
      ctx.rect(lx, topY + topH, ts * 0.08, box.bottom - topY - topH - ts * 0.03);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    const lowY = box.bottom - ts * 0.16;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.55));
    ctx.fillRect(box.left + ts * 0.12, lowY, box.width - ts * 0.24, ts * 0.05);
    for (let i = 0; i < 3; i++)
      paintClayPot(ctx, box.left + ts * 0.5, lowY - i * ts * 0.06, ts * 0.26, ts * 0.14, ts);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.6));
    ctx.beginPath();
    ctx.ellipse(box.right - ts * 0.6, lowY - ts * 0.08, ts * 0.2, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(SOIL_LIGHT);
    ctx.beginPath();
    ctx.ellipse(box.right - ts * 0.6, lowY - ts * 0.12, ts * 0.14, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Top and what is on it.
    ctx.fillStyle = rgb(sampleRamp(oak, 0.68));
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.04, topY, box.width - ts * 0.08, topH);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.9));
    ctx.fillRect(box.left + ts * 0.04, topY, box.width - ts * 0.08, Math.max(1, topH * 0.3));
    for (let t = 0; t < 2; t++) {
      const trayL = box.left + ts * (0.14 + t * 0.62);
      const trayW = ts * 0.56;
      const trayH = ts * 0.12;
      ctx.fillStyle = rgb(sampleRamp(oak, 0.5));
      ctx.beginPath();
      ctx.rect(trayL, topY - trayH, trayW, trayH);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(SOIL_DARK);
      ctx.fillRect(trayL + 2, topY - trayH + 2, trayW - 4, trayH * 0.4);
      for (let s = 0; s < 4; s++)
        paintSeedling(
          ctx,
          trayL + trayW * (0.16 + s * 0.23),
          topY - trayH + 2,
          ts * 0.1,
          ts,
          forkRng(rng),
        );
    }
    const bigPotX = box.right - ts * 0.48;
    paintClayPot(ctx, bigPotX, topY, ts * 0.3, ts * 0.24, ts);
    paintLeafClump(ctx, bigPotX, topY - ts * 0.24, ts * 0.22, ts, forkRng(rng));
  });
}

function paintClayPot(ctx: Ctx, cx: number, baseY: number, w: number, h: number, ts: number): void {
  ctx.fillStyle = rgb(sampleRamp(TERRACOTTA, 0.55));
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, baseY);
  ctx.lineTo(cx - w * 0.5, baseY - h * 0.8);
  ctx.lineTo(cx + w * 0.5, baseY - h * 0.8);
  ctx.lineTo(cx + w * 0.36, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgba(TOWN_INK, 0.25);
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.1, baseY);
  ctx.lineTo(cx + w * 0.14, baseY - h * 0.8);
  ctx.lineTo(cx + w * 0.5, baseY - h * 0.8);
  ctx.lineTo(cx + w * 0.36, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(sampleRamp(TERRACOTTA, 0.8));
  ctx.beginPath();
  ctx.rect(cx - w * 0.56, baseY - h, w * 1.12, h * 0.24);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
}

function paintSeedling(ctx: Ctx, cx: number, baseY: number, h: number, ts: number, rng: Rng): void {
  const lean = jitter(rng, h * 0.2);
  ctx.strokeStyle = rgb(LEAF_DEEP);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx + lean, baseY - h);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.fillStyle = rgb(side < 0 ? LEAF_LIGHT : LEAF_MID);
    ctx.beginPath();
    ctx.ellipse(
      cx + lean + side * h * 0.28,
      baseY - h,
      h * 0.3,
      h * 0.15,
      side * 0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** A bushy crown of leaves: a dark mass, then lit leaves on the upper left. */
function paintLeafClump(
  ctx: Ctx,
  cx: number,
  baseY: number,
  r: number,
  ts: number,
  rng: Rng,
): void {
  ctx.fillStyle = rgb(LEAF_DEEP);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - r * 0.55, r, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  const leaves = 11;
  for (let i = 0; i < leaves; i++) {
    const a = (Math.PI * 2 * i) / leaves + jitter(rng, 0.3);
    const d = r * (0.3 + jitter(rng, 0.1) + 0.35);
    const lx = cx + Math.cos(a) * d * 0.9;
    const ly = baseY - r * 0.55 + Math.sin(a) * d * 0.6;
    const lit = lx < cx && ly < baseY - r * 0.5;
    ctx.fillStyle = rgb(lit ? LEAF_LIGHT : LEAF_MID);
    ctx.beginPath();
    ctx.ellipse(lx, ly, r * 0.28, r * 0.17, a, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Bins, display and pots ──────────────────────────────────────────────────

/**
 * Bulk herb bins, two tiles wide: a slope-topped chest split into four open
 * compartments of loose dried stock — chamomile, rose petal, mint, willow
 * bark — each with a chalked slate on its front, a brass scoop left in one.
 */
export function paintHerbBins(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const oak = woodRamp();
    const faceTop = box.bottom - ts * 0.55;
    const topBack = faceTop - ts * 0.34;
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    // The slope of open compartments, seen from above and in front.
    ctx.fillStyle = rgb(sampleRamp(oak, 0.35));
    ctx.beginPath();
    ctx.rect(left, topBack, right - left, faceTop - topBack);
    ctx.fill();
    const bins = 4;
    const binW = (right - left) / bins;
    for (let i = 0; i < bins; i++) {
      const bx = left + i * binW;
      const herb = LOOSE_HERBS[i % LOOSE_HERBS.length];
      ctx.fillStyle = rgb(mix(herb, TOWN_INK, 0.2));
      ctx.beginPath();
      ctx.moveTo(bx + 3, faceTop);
      ctx.lineTo(bx + 3, topBack + ts * 0.06);
      ctx.quadraticCurveTo(bx + binW / 2, topBack - ts * 0.16, bx + binW - 3, topBack + ts * 0.06);
      ctx.lineTo(bx + binW - 3, faceTop);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(TOWN_INK, 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
      for (let d = 0; d < 14; d++) {
        ctx.fillStyle = rgb(mix(herb, [255, 255, 255], jitter(rng, 0.15) + 0.15));
        ctx.beginPath();
        ctx.arc(
          bx + 5 + (binW - 10) * ((d * 0.37) % 1),
          topBack + ts * 0.06 + (faceTop - topBack - ts * 0.08) * ((d * 0.61) % 1),
          ts * 0.022,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = rgb(sampleRamp(oak, 0.6));
      ctx.fillRect(bx, topBack, Math.max(2, ts * 0.04), faceTop - topBack);
    }
    ctx.beginPath();
    ctx.rect(left, topBack, right - left, faceTop - topBack);
    inkOutline(ctx, ts);
    // Front face with slates.
    ctx.fillStyle = rgb(sampleRamp(oak, 0.5));
    ctx.fillRect(left, faceTop, right - left, box.bottom - faceTop - ts * 0.04);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.85));
    ctx.fillRect(left, faceTop, right - left, Math.max(1, ts * 0.04));
    ctx.fillStyle = rgba(TOWN_INK, 0.2);
    ctx.fillRect(right - ts * 0.2, faceTop, ts * 0.2, box.bottom - faceTop - ts * 0.04);
    ctx.beginPath();
    ctx.rect(left, faceTop, right - left, box.bottom - faceTop - ts * 0.04);
    inkOutline(ctx, ts);
    for (let i = 0; i < bins; i++) {
      const sx = left + i * binW + binW * 0.2;
      const sy = faceTop + ts * 0.14;
      ctx.fillStyle = rgb([70, 74, 78]);
      ctx.beginPath();
      ctx.rect(sx, sy, binW * 0.6, ts * 0.12);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.strokeStyle = rgba([226, 226, 220], 0.85);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + binW * 0.1, sy + ts * 0.06);
      ctx.lineTo(sx + binW * (0.35 + jitter(rng, 0.1)), sy + ts * 0.05);
      ctx.stroke();
    }
    // Scoop left in the second bin.
    const scoopX = left + binW * 1.5;
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.beginPath();
    ctx.ellipse(scoopX, topBack + ts * 0.16, ts * 0.08, ts * 0.05, -0.3, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.4));
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(scoopX + ts * 0.06, topBack + ts * 0.12);
    ctx.lineTo(scoopX + ts * 0.2, topBack - ts * 0.02);
    ctx.stroke();
  });
}

/**
 * A two-tile display table under a madder-red cloth, stepped with a small
 * riser: ranks of stoppered remedy bottles and labelled jars, made-up
 * packets stacked at the front, and a chalked price card.
 */
export function paintRemedyDisplay(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const cloth = getTownRamp('oc_cloth_ember');
    const topY = box.bottom - ts * 0.56;
    const topDepth = ts * 0.24;
    const left = box.left + ts * 0.05;
    const right = box.right - ts * 0.05;
    // Cloth: top plane then the drop, hemmed and scalloped.
    ctx.fillStyle = rgb(sampleRamp(cloth, 0.62));
    ctx.fillRect(left, topY, right - left, topDepth);
    const dropTop = topY + topDepth;
    const dropBottom = box.bottom - ts * 0.08;
    const scallops = 6;
    ctx.beginPath();
    ctx.moveTo(left, dropTop);
    ctx.lineTo(right, dropTop);
    ctx.lineTo(right, dropBottom);
    for (let i = scallops; i > 0; i--) {
      const x0 = left + ((right - left) * i) / scallops;
      const x1 = left + ((right - left) * (i - 1)) / scallops;
      ctx.quadraticCurveTo((x0 + x1) / 2, dropBottom + ts * 0.06, x1, dropBottom);
    }
    ctx.closePath();
    ctx.fillStyle = rgb(sampleRamp(cloth, 0.42));
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let i = 0; i < scallops; i++) {
      const fx = left + ((right - left) * (i + 0.5)) / scallops;
      ctx.fillStyle = rgba(TOWN_INK, 0.18);
      ctx.fillRect(fx, dropTop, ts * 0.06, dropBottom - dropTop + ts * 0.06);
    }
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.fillRect(left, dropBottom - ts * 0.08, right - left, Math.max(1, ts * 0.03));
    ctx.restore();
    ctx.beginPath();
    ctx.rect(left, topY, right - left, dropBottom - topY);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(cloth, 0.85));
    ctx.fillRect(left, dropTop, right - left, Math.max(1, ts * 0.03));

    // A riser at the back, with bottles on it; jars and packets in front.
    const riserTop = topY - ts * 0.16;
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55));
    ctx.beginPath();
    ctx.rect(left + ts * 0.14, riserTop, right - left - ts * 0.28, ts * 0.18);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    const bottleCount = 7;
    for (let i = 0; i < bottleCount; i++) {
      const bx = left + ts * 0.26 + ((right - left - ts * 0.52) * i) / (bottleCount - 1);
      paintBottle(
        ctx,
        bx,
        riserTop + 1,
        ts * 0.14,
        ts * (0.3 + (i % 3) * 0.05),
        LIQUIDS[(i + variant) % LIQUIDS.length],
        ts,
      );
    }
    const standY = topY + topDepth * 0.8;
    paintGlassJar(ctx, left + ts * 0.3, standY, ts * 0.24, ts * 0.3, LIQUID_GREEN, ts);
    paintAlbarello(ctx, left + ts * 0.62, standY, ts * 0.22, ts * 0.3, GLAZE_BLUE, ts);
    for (let i = 0; i < 3; i++)
      paintPacket(
        ctx,
        left + ts * 0.9 + i * ts * 0.2 + jitter(rng, 1),
        standY,
        ts * 0.18,
        ts * 0.12,
        ts,
      );
    paintGlassJar(ctx, right - ts * 0.35, standY, ts * 0.26, ts * 0.32, LIQUID_VIOLET, ts);
    // Price card, propped.
    ctx.fillStyle = rgb(LABEL_PAPER);
    ctx.beginPath();
    ctx.rect(left + ts * 1.52, standY - ts * 0.2, ts * 0.18, ts * 0.2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(TOWN_INK, 0.6);
    ctx.fillRect(left + ts * 1.55, standY - ts * 0.15, ts * 0.12, Math.max(1, ts * 0.02));
    ctx.fillRect(left + ts * 1.55, standY - ts * 0.09, ts * 0.08, Math.max(1, ts * 0.02));
  });
}

/**
 * Live herbs still growing, three terracotta pots of different heights on
 * one tile — basil in the big pot, chives in the small one, flowering thyme
 * between — greener and looser than the dried stock hung in the back.
 */
export function paintLiveHerbPots(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const flip = variant % 2 === 1;
    const place = (f: number): number => (flip ? box.right - f * ts : box.left + f * ts);
    const bigX = place(0.34);
    const smallX = place(0.78);
    const midX = place(0.6);
    // The back pot first so the nearer ones overlap it.
    paintClayPot(ctx, midX, box.bottom - ts * 0.3, ts * 0.26, ts * 0.22, ts);
    paintThyme(ctx, midX, box.bottom - ts * 0.52, ts, forkRng(rng));
    paintClayPot(ctx, bigX, box.bottom - ts * 0.06, ts * 0.4, ts * 0.32, ts);
    paintLeafClump(ctx, bigX, box.bottom - ts * 0.38, ts * 0.24, ts, forkRng(rng));
    paintClayPot(ctx, smallX, box.bottom - ts * 0.05, ts * 0.24, ts * 0.2, ts);
    paintChives(ctx, smallX, box.bottom - ts * 0.25, ts, forkRng(rng));
  });
}

function paintThyme(ctx: Ctx, cx: number, baseY: number, ts: number, rng: Rng): void {
  ctx.fillStyle = rgb(mix(LEAF_DEEP, LEAF_MID, 0.4));
  ctx.beginPath();
  ctx.ellipse(cx, baseY - ts * 0.08, ts * 0.14, ts * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = rgb(i % 2 === 0 ? [176, 128, 196] : LEAF_LIGHT);
    ctx.beginPath();
    ctx.arc(
      cx + jitter(rng, ts * 0.1),
      baseY - ts * 0.08 + jitter(rng, ts * 0.07),
      ts * 0.022,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function paintChives(ctx: Ctx, cx: number, baseY: number, ts: number, rng: Rng): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const dx = (i - 3) * ts * 0.02;
    const h = ts * (0.2 + jitter(rng, 0.04));
    ctx.strokeStyle = rgba(TOWN_INK, 0.8);
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(cx + dx, baseY);
    ctx.lineTo(cx + dx * 2.2, baseY - h);
    ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const dx = (i - 3) * ts * 0.02;
    const h = ts * (0.2 + jitter(rng, 0.04));
    ctx.strokeStyle = rgb(i < 3 ? LEAF_LIGHT : LEAF_MID);
    ctx.lineWidth = ts * 0.022;
    ctx.beginPath();
    ctx.moveTo(cx + dx, baseY);
    ctx.lineTo(cx + dx * 2.2, baseY - h);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/**
 * The drying room's sorting table: a scrubbed top where the day's cut is
 * stripped and bunched — a heap of loose leaves, a row of tied bunches
 * waiting for the rack, a spool of twine and a knife.
 */
export function paintSortingTable(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.32);
    const oak = woodRamp();
    const topY = box.bottom - ts * 0.56;
    const topDepth = ts * 0.26;
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    ctx.fillStyle = rgb(sampleRamp(oak, 0.3));
    for (const lx of [left + ts * 0.08, right - ts * 0.16]) {
      ctx.beginPath();
      ctx.rect(lx, topY + topDepth, ts * 0.08, box.bottom - topY - topDepth - ts * 0.03);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(oak, 0.35));
    ctx.fillRect(left + ts * 0.08, box.bottom - ts * 0.2, right - left - ts * 0.16, ts * 0.04);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.85));
    ctx.fillRect(left, topY, right - left, topDepth);
    ctx.fillStyle = rgb(sampleRamp(oak, 0.55));
    ctx.fillRect(left, topY + topDepth, right - left, ts * 0.08);
    ctx.beginPath();
    ctx.rect(left, topY, right - left, topDepth + ts * 0.08);
    inkOutline(ctx, ts);
    const heapX = left + ts * 0.42;
    const heapY = topY + topDepth * 0.75;
    ctx.fillStyle = rgb(LEAF_DEEP);
    ctx.beginPath();
    ctx.ellipse(heapX, heapY - ts * 0.06, ts * 0.3, ts * 0.13, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const heapRng = forkRng(rng);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = rgb(i % 3 === 0 ? LEAF_LIGHT : LEAF_MID);
      ctx.beginPath();
      ctx.ellipse(
        heapX + jitter(heapRng, ts * 0.24),
        heapY - ts * 0.08 + jitter(heapRng, ts * 0.05),
        ts * 0.04,
        ts * 0.022,
        jitter(heapRng, 1),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const bunchRng = forkRng(rng);
    for (let i = 0; i < 3; i++) {
      const bx = left + ts * (0.9 + i * 0.22);
      ctx.save();
      ctx.translate(bx, heapY);
      ctx.rotate(-Math.PI / 2);
      paintHerbBunch(ctx, 0, -ts * 0.02, ts * 0.36, HERB_BUNCH_ORDER[i + 1], ts, bunchRng);
      ctx.restore();
    }
    const spoolX = right - ts * 0.26;
    ctx.fillStyle = rgb(HERB_TWINE);
    ctx.beginPath();
    ctx.ellipse(spoolX, heapY - ts * 0.06, ts * 0.08, ts * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgba(sampleRamp(WALNUT, 0.3), 0.7);
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(spoolX - ts * 0.07, heapY - ts * 0.06 + i * ts * 0.03);
      ctx.lineTo(spoolX + ts * 0.07, heapY - ts * 0.06 + i * ts * 0.03);
      ctx.stroke();
    }
    ctx.strokeStyle = rgb(sampleRamp(stoneRamp(), 0.9));
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.8, topY + topDepth * 0.35);
    ctx.lineTo(left + ts * 1.1, topY + topDepth * 0.2);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.3));
    ctx.beginPath();
    ctx.moveTo(left + ts * 1.1, topY + topDepth * 0.2);
    ctx.lineTo(left + ts * 1.25, topY + topDepth * 0.12);
    ctx.stroke();
  });
}

// ── Specimen case and bay tree ──────────────────────────────────────────────

const SPIRIT_TINT: RGB = [222, 196, 118];
const SNAKE_SKIN: RGB = [92, 74, 38];
const TOAD_SKIN: RGB = [82, 108, 40];

/** A tall jar of spirits with something preserved in it. */
function paintSpecimenJar(
  ctx: Ctx,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  specimen: 'snake' | 'toad' | 'leeches',
  ts: number,
): void {
  const top = baseY - h;
  const liquid = specimen === 'leeches' ? mix(WATER_DARK, SPIRIT_TINT, 0.3) : SPIRIT_TINT;
  ctx.fillStyle = rgb(mix(liquid, GLASS_TINT, 0.3));
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top + h * 0.1, w, h * 0.9, w * 0.18);
  ctx.fill();
  inkOutline(ctx, ts);
  const midY = top + h * 0.58;
  if (specimen === 'snake') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(
        cx,
        midY + h * 0.14 - i * h * 0.14,
        w * (0.34 - i * 0.06),
        h * 0.07,
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = rgba(TOWN_INK, 0.8);
      ctx.lineWidth = ts * 0.075;
      ctx.stroke();
      ctx.strokeStyle = rgb(i % 2 === 0 ? SNAKE_SKIN : mix(SNAKE_SKIN, [255, 255, 255], 0.25));
      ctx.lineWidth = ts * 0.05;
      ctx.stroke();
    }
    ctx.fillStyle = rgb(mix(SNAKE_SKIN, TOWN_INK, 0.3));
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.06, midY - h * 0.28, w * 0.1, h * 0.05, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (specimen === 'toad') {
    ctx.fillStyle = rgb(TOAD_SKIN);
    ctx.beginPath();
    ctx.ellipse(cx, midY, w * 0.32, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(TOWN_INK, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = rgb([236, 214, 96]);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * w * 0.14, midY - h * 0.14, ts * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = rgb([24, 20, 20]);
    ctx.lineWidth = ts * 0.035;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const lx = cx - w * 0.28 + i * w * 0.18;
      const ly = midY + ((i * 5) % 3) * h * 0.08 - h * 0.05;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(lx + w * 0.08, ly - h * 0.08, lx + w * 0.12, ly + h * 0.04);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  ctx.fillStyle = rgba([255, 255, 255], 0.6);
  ctx.fillRect(cx - w * 0.36, top + h * 0.2, Math.max(1, w * 0.1), h * 0.55);
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.45));
  ctx.beginPath();
  ctx.rect(cx - w * 0.44, top, w * 0.88, h * 0.14);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgb(LABEL_PAPER);
  ctx.fillRect(cx - w * 0.3, baseY - h * 0.2, w * 0.6, h * 0.12);
}

/**
 * A glass-fronted specimen case on a walnut base: an adder coiled in
 * spirits, a toad, a jar of leeches, and small labelled jars on the upper
 * shelf. Kept, not sold — the shop floor's curiosity, the thing a child
 * presses its face to.
 */
export function paintSpecimenCase(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.36);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const baseTop = box.bottom - ts * 0.42;
    const caseTop = baseTop - ts * 1.0;
    // Walnut base with two drawers.
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.42));
    ctx.beginPath();
    ctx.rect(left, baseTop, right - left, box.bottom - baseTop - ts * 0.03);
    ctx.fill();
    inkOutline(ctx, ts);
    for (let d = 0; d < 2; d++) {
      const dx = left + ts * 0.1 + d * ((right - left) / 2);
      const dw = (right - left) / 2 - ts * 0.2;
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.56));
      ctx.fillRect(dx, baseTop + ts * 0.08, dw, ts * 0.2);
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      ctx.beginPath();
      ctx.arc(dx + dw / 2, baseTop + ts * 0.18, ts * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    // Glass case: back, shelf, specimens, then the glass and its frame over them.
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.18));
    ctx.fillRect(left, caseTop, right - left, baseTop - caseTop);
    const shelfY = caseTop + ts * 0.4;
    paintSpecimenJar(ctx, left + ts * 0.33, baseTop - ts * 0.02, ts * 0.44, ts * 0.54, 'snake', ts);
    paintSpecimenJar(ctx, left + ts * 0.9, baseTop - ts * 0.02, ts * 0.38, ts * 0.46, 'toad', ts);
    paintSpecimenJar(
      ctx,
      left + ts * 1.47,
      baseTop - ts * 0.02,
      ts * 0.4,
      ts * 0.52,
      'leeches',
      ts,
    );
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.7));
    ctx.fillRect(left, shelfY, right - left, ts * 0.05);
    const smallRng = forkRng(rng);
    for (let i = 0; i < 5; i++) {
      const jx = left + ts * 0.22 + i * ts * 0.34;
      if (i % 2 === 0)
        paintAlbarello(
          ctx,
          jx,
          shelfY,
          ts * 0.2,
          ts * (0.3 + jitter(smallRng, 0.03)),
          GLAZE_BLUE,
          ts,
        );
      else paintGlassJar(ctx, jx, shelfY, ts * 0.2, ts * 0.28, LIQUIDS[i % LIQUIDS.length], ts);
    }
    ctx.fillStyle = rgba(GLASS_TINT, 0.1);
    ctx.fillRect(left, caseTop, right - left, baseTop - caseTop);
    ctx.strokeStyle = rgba([255, 255, 255], 0.35);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(left + ts * 1.55, caseTop + ts * 0.42);
    ctx.lineTo(left + ts * 1.8, caseTop + ts * 0.08);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.6));
    ctx.lineWidth = ts * 0.06;
    ctx.strokeRect(
      left + ts * 0.03,
      caseTop + ts * 0.03,
      right - left - ts * 0.06,
      baseTop - caseTop - ts * 0.03,
    );
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.6));
    ctx.fillRect(box.centreX - ts * 0.03, caseTop, ts * 0.06, baseTop - caseTop);
    ctx.beginPath();
    ctx.rect(left, caseTop, right - left, box.bottom - caseTop - ts * 0.03);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.85));
    ctx.fillRect(left - 0, caseTop - ts * 0.06, right - left, ts * 0.08);
    ctx.beginPath();
    ctx.rect(left, caseTop - ts * 0.06, right - left, ts * 0.08);
    inkOutline(ctx, ts * 0.8);
  });
}

/**
 * A bay tree clipped to a ball in a big terracotta pot — the one live plant
 * tall enough to stand among the furniture, where the smaller pots only
 * dress the corners.
 */
export function paintPottedBay(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const potBase = box.bottom - ts * 0.06;
    const potH = ts * 0.42;
    paintClayPot(ctx, box.centreX, potBase, ts * 0.56, potH, ts);
    const trunkTop = potBase - potH - ts * 0.5;
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.45));
    ctx.beginPath();
    ctx.rect(box.centreX - ts * 0.035, trunkTop, ts * 0.07, potBase - potH - trunkTop);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    const crownR = ts * 0.4;
    const crownY = trunkTop - crownR * 0.55;
    ctx.fillStyle = rgb(LEAF_DEEP);
    ctx.beginPath();
    ctx.arc(box.centreX, crownY, crownR, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const leafRng = forkRng(rng);
    for (let i = 0; i < 26; i++) {
      const a = leafRng() * Math.PI * 2;
      const d = crownR * Math.sqrt(leafRng()) * 0.82;
      const lx = box.centreX + Math.cos(a) * d;
      const ly = crownY + Math.sin(a) * d;
      const litness = (box.centreX - lx + (crownY - ly)) / (crownR * 2);
      ctx.fillStyle = rgb(
        litness > 0.15 ? LEAF_LIGHT : litness > -0.2 ? LEAF_MID : mix(LEAF_DEEP, LEAF_MID, 0.4),
      );
      ctx.beginPath();
      ctx.ellipse(lx, ly, ts * 0.06, ts * 0.032, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgb(SOIL_DARK);
    ctx.beginPath();
    ctx.ellipse(box.centreX, potBase - potH + ts * 0.02, ts * 0.24, ts * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ── Shared with Old Hilda's Cottage ─────────────────────────────────────────

const HERB_LEAF_DRY: RGB = [140, 132, 66];
const HERB_LEAF_FRESH: RGB = [96, 118, 58];

/**
 * A wall rack of drying herb bundles hung upside down over a line —
 * clustered leaves, not one flat sprig, so a whole row reads as a working
 * drying room rather than one dead plant repeated.
 */
export function paintHerbBundleRack(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = getTownRamp('iron_black');
    const lineY = box.top + frame.tileScale * 0.14;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
    ctx.lineWidth = frame.tileScale * 0.02;
    ctx.beginPath();
    ctx.moveTo(box.left, lineY);
    ctx.lineTo(box.right, lineY);
    ctx.stroke();
    const bundleCount = 3;
    for (let i = 0; i < bundleCount; i++) {
      const bx = box.left + (box.width * (i + 0.5)) / bundleCount;
      const twineLen = frame.tileScale * (0.06 + jitter(forkRng(rng), 0.015));
      ctx.strokeStyle = rgb(HERB_TWINE);
      ctx.lineWidth = frame.tileScale * 0.015;
      ctx.beginPath();
      ctx.moveTo(bx, lineY);
      ctx.lineTo(bx, lineY + twineLen);
      ctx.stroke();
      const leafTone = (i + variant) % 2 === 0 ? HERB_LEAF_DRY : HERB_LEAF_FRESH;
      const headH = frame.tileScale * (0.22 + jitter(forkRng(rng), 0.03));
      const headW = frame.tileScale * 0.1;
      const headTop = lineY + twineLen;
      ctx.fillStyle = rgb(leafTone);
      ctx.beginPath();
      ctx.moveTo(bx, headTop);
      ctx.lineTo(bx - headW, headTop + headH * 0.55);
      ctx.lineTo(bx, headTop + headH);
      ctx.lineTo(bx + headW, headTop + headH * 0.55);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, frame.tileScale);
      ctx.strokeStyle = rgba(mix(leafTone, [20, 16, 10], 0.4), 0.6);
      ctx.lineWidth = frame.tileScale * 0.01;
      ctx.beginPath();
      ctx.moveTo(bx, headTop);
      ctx.lineTo(bx, headTop + headH * 0.85);
      ctx.stroke();
    }
  });
}
