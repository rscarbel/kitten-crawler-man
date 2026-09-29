/**
 * Bespoke furniture for Blackwood Lodge, a garrison post built for a section
 * and held by two men: the briefing table with the row's drainage pinned
 * out across it, double bunks down both walls with most of their mattresses
 * rolled and strapped, a spear rack racked for twelve with five in it, the
 * duty board, the stove the watch keeps a kettle on, the peg rail of kit,
 * Kessler's own footlocker with the log that is not on the wall, and the
 * iron-banded cellar lid the whole post exists to sit on.
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
  type FootprintBox,
  type TownPropFrame,
  type Rng,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, mix, type Ramp, type RGB } from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

function woodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function ironRamp(): Ramp {
  return getTownRamp('iron_black');
}

/** A soft shadow under the whole footprint, wider than the one-tile props' own ellipse. */
function bandShadow(ctx: Ctx, box: FootprintBox, ts: number, alpha: number): void {
  drawTownContactShadow(
    ctx,
    box.centreX,
    box.bottom - ts * 0.08,
    box.width * 0.47,
    ts * 0.18,
    alpha,
  );
}

/** Map parchment, old enough to have yellowed at the edges. */
const PARCHMENT: RGB = [214, 196, 152];
const PARCHMENT_EDGE: RGB = [168, 142, 98];
/** The drainage runs inked in blue, the streets in brown — the two things the post is watching. */
const MAP_WATER: RGB = [58, 96, 142];
const MAP_STREET: RGB = [120, 90, 58];
const PIN_RED: RGB = [178, 42, 38];
const BRASS: RGB = [196, 160, 84];
const BRASS_DARK: RGB = [130, 100, 48];
/** Garrison blanket grey-blue, the same issue as the Barracks' own. */
const BLANKET: RGB = [74, 88, 108];
const BLANKET_LIGHT: RGB = [112, 128, 150];
/** Mattress ticking — a pale stripe that reads as bare bedding, not a made bed. */
const TICKING: RGB = [206, 198, 176];
const TICKING_STRIPE: RGB = [124, 132, 150];
const STRAP_LEATHER: RGB = [92, 58, 36];
const PILLOW: RGB = [222, 216, 200];
const SPEAR_STEEL: RGB = [176, 184, 192];
const SPEAR_STEEL_LIGHT: RGB = [226, 232, 236];
const SHIELD_FIELD: RGB = [62, 78, 104];
const SHIELD_BAND: RGB = [150, 132, 72];
const CLOAK_GREY: RGB = [70, 74, 80];
const CLOAK_BROWN: RGB = [96, 70, 50];
const CANTEEN: RGB = [104, 92, 62];
const FIRE_CORE: RGB = [252, 214, 130];
const FIRE_MID: RGB = [222, 112, 44];
const CANDLE_WAX: RGB = [224, 210, 176];
const CANDLE_FLAME: RGB = [248, 196, 102];
const PAPER: RGB = [228, 220, 196];
const PAPER_SHADE: RGB = [188, 178, 150];
const INK: RGB = [42, 38, 36];
const MUG_CLAY: RGB = [128, 84, 60];
const LOG_COVER: RGB = [70, 40, 34];
const CHALK: RGB = [226, 224, 214];

// ── Shared small pieces ─────────────────────────────────────────────────────

function paintCandle(ctx: Ctx, x: number, baseY: number, h: number, ts: number): void {
  const w = ts * 0.07;
  ctx.fillStyle = rgb(CANDLE_WAX);
  ctx.beginPath();
  ctx.rect(x - w / 2, baseY - h, w, h);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  const glow = ctx.createRadialGradient(
    x,
    baseY - h - ts * 0.05,
    0,
    x,
    baseY - h - ts * 0.05,
    ts * 0.3,
  );
  glow.addColorStop(0, rgba(CANDLE_FLAME, 0.55));
  glow.addColorStop(1, rgba(CANDLE_FLAME, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - ts * 0.3, baseY - h - ts * 0.35, ts * 0.6, ts * 0.6);
  ctx.fillStyle = rgb(CANDLE_FLAME);
  ctx.beginPath();
  ctx.ellipse(x, baseY - h - ts * 0.05, ts * 0.025, ts * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

function paintMug(ctx: Ctx, x: number, baseY: number, ts: number): void {
  const w = ts * 0.12;
  const h = ts * 0.13;
  ctx.fillStyle = rgb(MUG_CLAY);
  ctx.beginPath();
  ctx.rect(x - w / 2, baseY - h, w, h);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.strokeStyle = rgb(MUG_CLAY);
  ctx.lineWidth = ts * 0.025;
  ctx.beginPath();
  ctx.arc(x + w / 2, baseY - h / 2, h * 0.28, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.fillStyle = rgba(INK, 0.7);
  ctx.beginPath();
  ctx.ellipse(x, baseY - h, w * 0.4, ts * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A pinned sheet of paper, slightly skewed, with ruled lines of writing on it. */
function paintSheet(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  tilt: number,
  ts: number,
  pin: RGB,
): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(tilt);
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  inkOutline(ctx, ts * 0.5);
  ctx.fillStyle = rgba(PAPER_SHADE, 0.8);
  ctx.fillRect(-w / 2, h / 2 - h * 0.14, w, h * 0.14);
  ctx.strokeStyle = rgba(INK, 0.55);
  ctx.lineWidth = Math.max(1, ts * 0.012);
  const lines = Math.max(2, Math.floor(h / (ts * 0.06)));
  for (let i = 1; i < lines; i++) {
    const ly = -h / 2 + (h * i) / lines;
    const lineW = w * (i % 3 === 0 ? 0.45 : 0.75);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + w * 0.12, ly);
    ctx.lineTo(-w / 2 + w * 0.12 + lineW, ly);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(pin);
  ctx.beginPath();
  ctx.arc(0, -h / 2 + ts * 0.03, ts * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Briefing table ──────────────────────────────────────────────────────────

/**
 * A heavy four-tile trestle table, two tiles deep, seen mostly from above so
 * the map pinned across it is the thing the eye lands on: the row's streets
 * in brown, the drainage under them in blue, red pins where the post has
 * marked something, and the working clutter of a watch that never ends —
 * a lantern, a candle, reports weighted down with a knife, ink, a mug.
 */
export function paintLodgeMapTable(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.38);

    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    const topY = box.top + ts * 0.12;
    const topBottom = box.bottom - ts * 0.52;
    const apronH = ts * 0.14;

    // Trestle legs and the stretcher between them, under the apron.
    for (const lx of [left + ts * 0.3, right - ts * 0.42]) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.28));
      ctx.beginPath();
      ctx.rect(lx, topBottom + apronH, ts * 0.12, box.bottom - topBottom - apronH - ts * 0.05);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.36));
      ctx.beginPath();
      ctx.rect(lx - ts * 0.1, box.bottom - ts * 0.1, ts * 0.32, ts * 0.07);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(left + ts * 0.4, box.bottom - ts * 0.3, right - left - ts * 0.8, ts * 0.07);

    // Top: planks running the length of the table, a lit front edge, a shaded apron.
    paintPlankBoard(ctx, left, topY, right - left, topBottom - topY, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.28,
      ramp: wood,
    });
    ctx.fillStyle = rgba(sampleRamp(wood, 0.95), 0.6);
    ctx.fillRect(left, topBottom - ts * 0.03, right - left, ts * 0.03);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.42));
    ctx.fillRect(left, topBottom, right - left, apronH);
    ctx.beginPath();
    ctx.rect(left, topY, right - left, topBottom - topY + apronH);
    inkOutline(ctx, ts);

    // The map: one big sheet with two smaller survey sheets overlapping its corners.
    const mapL = left + ts * 0.55;
    const mapR = right - ts * 0.75;
    const mapT = topY + ts * 0.12;
    const mapB = topBottom - ts * 0.12;
    ctx.fillStyle = rgb(PARCHMENT);
    ctx.beginPath();
    ctx.rect(mapL, mapT, mapR - mapL, mapB - mapT);
    ctx.fill();
    const edge = ctx.createLinearGradient(mapL, 0, mapR, 0);
    edge.addColorStop(0, rgba(PARCHMENT_EDGE, 0.6));
    edge.addColorStop(0.12, rgba(PARCHMENT_EDGE, 0));
    edge.addColorStop(0.88, rgba(PARCHMENT_EDGE, 0));
    edge.addColorStop(1, rgba(PARCHMENT_EDGE, 0.6));
    ctx.fillStyle = edge;
    ctx.fillRect(mapL, mapT, mapR - mapL, mapB - mapT);
    ctx.beginPath();
    ctx.rect(mapL, mapT, mapR - mapL, mapB - mapT);
    inkOutline(ctx, ts * 0.8);

    // Street blocks: a grid of brown-outlined blocks, the row itself one long block.
    const mapW = mapR - mapL;
    const mapH = mapB - mapT;
    ctx.strokeStyle = rgb(MAP_STREET);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    const blockRng = forkRng(rng);
    const cols = 5;
    const rows = 3;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const bx = mapL + mapW * (0.06 + c * 0.185) + jitter(blockRng, ts * 0.02);
        const by = mapT + mapH * (0.1 + r * 0.3) + jitter(blockRng, ts * 0.02);
        ctx.strokeRect(bx, by, mapW * 0.14, mapH * 0.2);
      }
    }
    // The wall along the top edge, hatched.
    ctx.strokeStyle = rgba(INK, 0.75);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.moveTo(mapL + mapW * 0.03, mapT + mapH * 0.05);
    ctx.lineTo(mapR - mapW * 0.03, mapT + mapH * 0.05);
    ctx.stroke();
    // Drainage: a winding blue run under the row with branches off it.
    ctx.strokeStyle = rgb(MAP_WATER);
    ctx.lineWidth = Math.max(1.5, ts * 0.035);
    ctx.beginPath();
    ctx.moveTo(mapL + mapW * 0.02, mapT + mapH * 0.72);
    ctx.bezierCurveTo(
      mapL + mapW * 0.3,
      mapT + mapH * 0.9,
      mapL + mapW * 0.5,
      mapT + mapH * 0.35,
      mapL + mapW * 0.72,
      mapT + mapH * 0.55,
    );
    ctx.quadraticCurveTo(
      mapL + mapW * 0.86,
      mapT + mapH * 0.65,
      mapR - mapW * 0.04,
      mapT + mapH * 0.1,
    );
    ctx.stroke();
    ctx.lineWidth = Math.max(1, ts * 0.018);
    for (const [fx, fy, tx, ty] of [
      [0.22, 0.79, 0.25, 0.4],
      [0.48, 0.52, 0.44, 0.2],
      [0.72, 0.55, 0.66, 0.9],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(mapL + mapW * fx, mapT + mapH * fy);
      ctx.lineTo(mapL + mapW * tx, mapT + mapH * ty);
      ctx.stroke();
    }
    // Red pins down the run, and one spot ringed twice in red.
    for (const [px, py] of [
      [0.22, 0.79],
      [0.48, 0.52],
      [0.72, 0.55],
      [0.9, 0.3],
    ] as const) {
      ctx.fillStyle = rgb(PIN_RED);
      ctx.beginPath();
      ctx.arc(mapL + mapW * px, mapT + mapH * py, ts * 0.035, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.4);
    }
    ctx.strokeStyle = rgba(PIN_RED, 0.85);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (const radius of [0.11, 0.15]) {
      ctx.beginPath();
      ctx.ellipse(
        mapL + mapW * 0.48,
        mapT + mapH * 0.52,
        ts * radius * 1.3,
        ts * radius,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    // Brass tacks at the corners.
    for (const [cx, cy] of [
      [mapL, mapT],
      [mapR, mapT],
      [mapL, mapB],
      [mapR, mapB],
    ] as const) {
      ctx.fillStyle = rgb(BRASS);
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }

    // West end: a stack of reports weighted with a sheathed knife, a candle.
    const stackX = left + ts * 0.08;
    const stackY = topY + ts * 0.3;
    for (let i = 0; i < 3; i++) {
      paintSheet(
        ctx,
        stackX + jitter(forkRng(rng), ts * 0.03),
        stackY + i * ts * 0.035,
        ts * 0.38,
        ts * 0.46,
        jitter(forkRng(rng), 0.12),
        ts,
        PAPER_SHADE,
      );
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.2));
    ctx.save();
    ctx.translate(stackX + ts * 0.2, stackY + ts * 0.34);
    ctx.rotate(-0.5);
    ctx.beginPath();
    ctx.rect(-ts * 0.2, -ts * 0.03, ts * 0.28, ts * 0.06);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgb(BRASS_DARK);
    ctx.fillRect(ts * 0.08, -ts * 0.04, ts * 0.03, ts * 0.08);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.fillRect(ts * 0.11, -ts * 0.025, ts * 0.12, ts * 0.05);
    ctx.restore();
    paintCandle(ctx, left + ts * 0.3, topBottom - ts * 0.06, ts * 0.16, ts);

    // East end: the lantern, the ink pot and quill, a mug gone cold.
    const lanternX = right - ts * 0.38;
    const lanternBase = topY + ts * 0.58;
    const glow = ctx.createRadialGradient(
      lanternX,
      lanternBase - ts * 0.18,
      0,
      lanternX,
      lanternBase - ts * 0.18,
      ts * 0.7,
    );
    glow.addColorStop(0, rgba(FIRE_CORE, 0.5));
    glow.addColorStop(1, rgba(FIRE_CORE, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(lanternX - ts * 0.7, lanternBase - ts * 0.9, ts * 1.4, ts * 1.4);
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.45));
    ctx.beginPath();
    ctx.rect(lanternX - ts * 0.12, lanternBase - ts * 0.04, ts * 0.24, ts * 0.05);
    ctx.fill();
    ctx.fillStyle = rgba(FIRE_CORE, 0.85);
    ctx.beginPath();
    ctx.rect(lanternX - ts * 0.09, lanternBase - ts * 0.3, ts * 0.18, ts * 0.26);
    ctx.fill();
    ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.4));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.strokeRect(lanternX - ts * 0.09, lanternBase - ts * 0.3, ts * 0.18, ts * 0.26);
    ctx.beginPath();
    ctx.moveTo(lanternX, lanternBase - ts * 0.3);
    ctx.lineTo(lanternX, lanternBase - ts * 0.04);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.35));
    ctx.beginPath();
    ctx.moveTo(lanternX - ts * 0.13, lanternBase - ts * 0.3);
    ctx.lineTo(lanternX, lanternBase - ts * 0.4);
    ctx.lineTo(lanternX + ts * 0.13, lanternBase - ts * 0.3);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.4));
    ctx.beginPath();
    ctx.arc(lanternX, lanternBase - ts * 0.44, ts * 0.05, 0, Math.PI * 2);
    ctx.stroke();

    const inkX = right - ts * 0.55;
    const inkY = topBottom - ts * 0.08;
    ctx.fillStyle = rgb(INK);
    ctx.beginPath();
    ctx.ellipse(inkX, inkY, ts * 0.06, ts * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(PAPER);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(inkX, inkY - ts * 0.02);
    ctx.quadraticCurveTo(inkX + ts * 0.1, inkY - ts * 0.2, inkX + ts * 0.18, inkY - ts * 0.26);
    ctx.stroke();
    paintMug(ctx, right - ts * 0.2, topBottom - ts * 0.06, ts);
  });
}

// ── Bunks ───────────────────────────────────────────────────────────────────

/** What a bunk's two tiers hold. Most of the post's bunks are empty on purpose. */
type BunkTier = 'slats' | 'rolled' | 'folded' | 'made' | 'slept';

const BUNK_TIERS: ReadonlyArray<readonly [BunkTier, BunkTier]> = [
  ['rolled', 'slats'],
  ['folded', 'rolled'],
  // Kessler's: the lower bunk made up square, the upper stripped for his kit.
  ['made', 'rolled'],
  // The other man's: slept in, blanket kicked back.
  ['slept', 'folded'],
];

/** How many distinct bunk dressings `paintLodgeBunk` knows. */
export const LODGE_BUNK_VARIANTS = BUNK_TIERS.length;

function paintBunkTier(
  ctx: Ctx,
  kind: BunkTier,
  left: number,
  right: number,
  deckY: number,
  ts: number,
  rng: Rng,
): void {
  const wood = woodRamp();
  const w = right - left;
  // The deck itself: slats seen edge-on, with the gaps between them.
  ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
  ctx.beginPath();
  ctx.rect(left, deckY, w, ts * 0.12);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  if (kind === 'slats') {
    ctx.fillStyle = rgb(sampleRamp(wood, 0.8));
    ctx.fillRect(left, deckY - ts * 0.14, w, ts * 0.14);
    ctx.strokeStyle = rgba(INK, 0.75);
    ctx.lineWidth = Math.max(1, ts * 0.035);
    const slats = 7;
    for (let i = 1; i < slats; i++) {
      const sx = left + (w * i) / slats;
      ctx.beginPath();
      ctx.moveTo(sx, deckY - ts * 0.14);
      ctx.lineTo(sx, deckY);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(left, deckY - ts * 0.14, w, ts * 0.14);
    inkOutline(ctx, ts * 0.6);
    return;
  }
  if (kind === 'rolled') {
    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.fillRect(left, deckY - ts * 0.08, w, ts * 0.08);
    const rollX = left + w * 0.72;
    const rollR = ts * 0.17;
    ctx.fillStyle = rgb(TICKING);
    ctx.beginPath();
    ctx.ellipse(rollX, deckY - rollR, w * 0.2, rollR, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgba(TICKING_STRIPE, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(rollX - w * 0.18, deckY - rollR + i * rollR * 0.35);
      ctx.lineTo(rollX + w * 0.18, deckY - rollR + i * rollR * 0.35);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(STRAP_LEATHER);
    for (const dx of [-0.1, 0.1]) {
      ctx.fillRect(rollX + w * dx - ts * 0.025, deckY - rollR * 2, ts * 0.05, rollR * 2);
    }
    // The spiral end of the roll.
    ctx.strokeStyle = rgba(TICKING_STRIPE, 0.9);
    ctx.beginPath();
    ctx.ellipse(rollX + w * 0.19, deckY - rollR, rollR * 0.25, rollR * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  // A mattress on the deck for every other kind.
  const mattH = ts * 0.14;
  ctx.fillStyle = rgb(TICKING);
  ctx.beginPath();
  ctx.rect(left + ts * 0.02, deckY - mattH, w - ts * 0.04, mattH);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  if (kind === 'folded') {
    const stackX = left + w * 0.62;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = rgb(i % 2 === 0 ? BLANKET : BLANKET_LIGHT);
      ctx.beginPath();
      ctx.rect(stackX, deckY - mattH - ts * 0.07 * (i + 1), w * 0.3, ts * 0.07);
      ctx.fill();
      inkOutline(ctx, ts * 0.5);
    }
    return;
  }
  // Pillow at the west end, blanket over the rest.
  ctx.fillStyle = rgb(PILLOW);
  ctx.beginPath();
  ctx.ellipse(left + w * 0.12, deckY - mattH - ts * 0.04, w * 0.1, ts * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  const blanketL = left + w * (kind === 'made' ? 0.25 : 0.34);
  ctx.fillStyle = rgb(BLANKET);
  ctx.beginPath();
  if (kind === 'made') {
    ctx.rect(blanketL, deckY - mattH - ts * 0.03, right - blanketL - ts * 0.02, mattH + ts * 0.1);
  } else {
    ctx.moveTo(blanketL, deckY - mattH * 0.2);
    ctx.quadraticCurveTo(
      blanketL + w * 0.1,
      deckY - mattH - ts * 0.14,
      blanketL + w * 0.25,
      deckY - mattH - ts * 0.04,
    );
    ctx.quadraticCurveTo(
      blanketL + w * 0.4,
      deckY - mattH - ts * 0.1,
      right - ts * 0.02,
      deckY - mattH,
    );
    ctx.lineTo(right - ts * 0.02, deckY + ts * 0.08);
    ctx.lineTo(blanketL + w * 0.05, deckY + ts * 0.05);
    ctx.closePath();
  }
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgba(BLANKET_LIGHT, 0.8);
  ctx.fillRect(
    blanketL + ts * 0.02,
    deckY - mattH - ts * 0.02,
    (right - blanketL) * 0.5,
    ts * 0.025,
  );
  if (kind === 'made') {
    // The folded-back sheet line a sergeant makes a bed with.
    ctx.fillStyle = rgb(PILLOW);
    ctx.fillRect(blanketL, deckY - mattH - ts * 0.03, ts * 0.06, mattH + ts * 0.1);
    ctx.strokeStyle = rgba(INK, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(blanketL, deckY - mattH - ts * 0.03, ts * 0.06, mattH + ts * 0.1);
  } else {
    ctx.strokeStyle = rgba(INK, 0.35);
    ctx.lineWidth = Math.max(1, ts * 0.015);
    for (let i = 0; i < 3; i++) {
      const fx = blanketL + w * (0.12 + i * 0.13) + jitter(rng, ts * 0.02);
      ctx.beginPath();
      ctx.moveTo(fx, deckY - mattH * 0.6);
      ctx.lineTo(fx + ts * 0.08, deckY + ts * 0.02);
      ctx.stroke();
    }
  }
}

/**
 * A two-tier garrison bunk, long side to the room: four square posts, two
 * slatted decks, a ladder at the foot. Variant picks what the tiers hold —
 * rolled and strapped, folded, made square, or slept in.
 */
export function paintLodgeBunk(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.34);
    const tiers = BUNK_TIERS[variant % BUNK_TIERS.length];
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    const postW = ts * 0.1;
    const postTop = box.bottom - ts * 1.95;
    const lowerDeck = box.bottom - ts * 0.3;
    const upperDeck = box.bottom - ts * 1.2;

    // Back posts first (a shade darker), then the tiers, then the front posts over them.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.26));
    for (const px of [left + ts * 0.06, right - postW - ts * 0.06]) {
      ctx.fillRect(px, postTop + ts * 0.1, postW * 0.8, lowerDeck - postTop);
    }
    // Boarded backs behind each deck, in shadow under the tier above.
    for (const deck of [lowerDeck, upperDeck]) {
      const backTop = deck - ts * 0.5;
      paintPlankBoard(ctx, left, backTop, right - left, ts * 0.5, forkRng(rng), {
        direction: 'horizontal',
        boardPx: ts * 0.17,
        ramp: wood,
      });
      const shade = ctx.createLinearGradient(0, backTop, 0, deck);
      shade.addColorStop(0, rgba(INK, 0.55));
      shade.addColorStop(1, rgba(INK, 0.2));
      ctx.fillStyle = shade;
      ctx.fillRect(left, backTop, right - left, ts * 0.5);
    }
    // The dark gap under the lower deck.
    ctx.fillStyle = rgba(INK, 0.45);
    ctx.fillRect(left, lowerDeck + ts * 0.09, right - left, box.bottom - lowerDeck - ts * 0.13);

    paintBunkTier(ctx, tiers[0], left + postW, right - postW, lowerDeck, ts, forkRng(rng));
    paintBunkTier(ctx, tiers[1], left + postW, right - postW, upperDeck, ts, forkRng(rng));

    // Upper guard rail on the room side.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.beginPath();
    ctx.rect(left, upperDeck - ts * 0.22, right - left, ts * 0.05);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);

    for (const px of [left, right - postW]) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.48));
      ctx.beginPath();
      ctx.rect(px, postTop, postW, box.bottom - postTop - ts * 0.04);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.7);
      ctx.fillRect(
        px + postW * 0.15,
        postTop + ts * 0.04,
        postW * 0.25,
        box.bottom - postTop - ts * 0.12,
      );
    }
    // Ladder at the foot, leaning on the upper rail.
    const ladderL = right - postW - ts * 0.3;
    const ladderR = right - postW - ts * 0.08;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.6));
    ctx.lineWidth = Math.max(1.5, ts * 0.035);
    for (const lx of [ladderL, ladderR]) {
      ctx.beginPath();
      ctx.moveTo(lx, upperDeck - ts * 0.22);
      ctx.lineTo(lx, box.bottom - ts * 0.06);
      ctx.stroke();
    }
    const rungs = 4;
    for (let i = 1; i <= rungs; i++) {
      const ry = upperDeck - ts * 0.22 + ((box.bottom - upperDeck + ts * 0.16) * i) / (rungs + 1);
      ctx.beginPath();
      ctx.moveTo(ladderL, ry);
      ctx.lineTo(ladderR, ry);
      ctx.stroke();
    }
    // Stencilled bunk number plate on the head post.
    ctx.fillStyle = rgb(PAPER_SHADE);
    ctx.fillRect(left - ts * 0.01, upperDeck + ts * 0.18, postW + ts * 0.02, ts * 0.1);
    ctx.fillStyle = rgb(INK);
    ctx.fillRect(left + postW * 0.35, upperDeck + ts * 0.2, postW * 0.3, ts * 0.06);
  });
}

// ── Spear rack ──────────────────────────────────────────────────────────────

/**
 * A three-tile rack against the wall, slotted for twelve spears. Five stand
 * in it; the empty slots are the point. Two round shields hang on the
 * uprights and a crossbow lies across the foot rail.
 */
export function paintLodgeSpearRack(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.3);
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    const railTop = box.bottom - ts * 1.25;
    const railLow = box.bottom - ts * 0.55;
    const slots = 12;
    const filled: ReadonlySet<number> =
      variant % 2 === 0 ? new Set([0, 1, 4, 7, 8]) : new Set([2, 3, 5, 9, 11]);

    // A plank backboard fixed to the wall, so the shafts read against it.
    paintPlankBoard(
      ctx,
      left,
      railTop - ts * 0.12,
      right - left,
      box.bottom - railTop,
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: ts * 0.34,
        ramp: wood,
      },
    );
    ctx.fillStyle = rgba(INK, 0.35);
    ctx.fillRect(left, railTop - ts * 0.12, right - left, box.bottom - railTop);
    // Back uprights.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (const ux of [left, box.centreX - ts * 0.05, right - ts * 0.1]) {
      ctx.beginPath();
      ctx.rect(ux, railTop - ts * 0.2, ts * 0.1, box.bottom - railTop + ts * 0.14);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    // Foot trough the butts stand in.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.45));
    ctx.beginPath();
    ctx.rect(left, box.bottom - ts * 0.24, right - left, ts * 0.18);
    ctx.fill();
    inkOutline(ctx, ts);

    const slotX = (i: number): number =>
      left + ts * 0.2 + ((right - left - ts * 0.4) * (i + 0.5)) / slots;
    for (let i = 0; i < slots; i++) {
      if (!filled.has(i)) continue;
      const sx = slotX(i) + jitter(forkRng(rng), ts * 0.01);
      const headY = box.bottom - ts * 1.85 + jitter(forkRng(rng), ts * 0.05);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.66));
      ctx.beginPath();
      ctx.rect(
        sx - ts * 0.03,
        headY + ts * 0.2,
        ts * 0.06,
        box.bottom - ts * 0.16 - headY - ts * 0.2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.fillStyle = rgb(STRAP_LEATHER);
      ctx.fillRect(sx - ts * 0.035, headY + ts * 0.26, ts * 0.07, ts * 0.06);
      ctx.fillStyle = rgb(SPEAR_STEEL);
      ctx.beginPath();
      ctx.moveTo(sx, headY);
      ctx.lineTo(sx + ts * 0.05, headY + ts * 0.17);
      ctx.lineTo(sx, headY + ts * 0.24);
      ctx.lineTo(sx - ts * 0.05, headY + ts * 0.17);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.strokeStyle = rgb(SPEAR_STEEL_LIGHT);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - ts * 0.01, headY + ts * 0.04);
      ctx.lineTo(sx - ts * 0.01, headY + ts * 0.18);
      ctx.stroke();
    }
    // Rails in front of the shafts, notched for every slot.
    for (const ry of [railTop, railLow]) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
      ctx.beginPath();
      ctx.rect(left - ts * 0.02, ry, right - left + ts * 0.04, ts * 0.1);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.6);
      ctx.fillRect(left, ry + ts * 0.01, right - left, ts * 0.02);
      ctx.fillStyle = rgba(INK, 0.55);
      for (let i = 0; i < slots; i++) {
        if (filled.has(i)) continue;
        ctx.beginPath();
        ctx.ellipse(slotX(i), ry + ts * 0.05, ts * 0.025, ts * 0.02, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Two round shields on the outer uprights.
    const shieldR = ts * 0.26;
    for (const sx of variant % 2 === 0 ? [right - ts * 0.3] : [left + ts * 0.3]) {
      const sy = railLow - ts * 0.2;
      ctx.fillStyle = rgb(SHIELD_FIELD);
      ctx.beginPath();
      ctx.arc(sx, sy, shieldR, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.strokeStyle = rgb(SHIELD_BAND);
      ctx.lineWidth = Math.max(1.5, ts * 0.04);
      ctx.beginPath();
      ctx.arc(sx, sy, shieldR * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgb(mix(SPEAR_STEEL, SHIELD_BAND, 0.3));
      ctx.beginPath();
      ctx.arc(sx, sy, shieldR * 0.25, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.fillStyle = rgba(SPEAR_STEEL_LIGHT, 0.7);
      ctx.beginPath();
      ctx.arc(sx - shieldR * 0.08, sy - shieldR * 0.08, shieldR * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    // A crossbow across the foot trough.
    const bowX = variant % 2 === 0 ? left + ts * 0.9 : right - ts * 1.3;
    const bowY = box.bottom - ts * 0.3;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.beginPath();
    ctx.rect(bowX, bowY - ts * 0.04, ts * 0.5, ts * 0.07);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.55));
    ctx.lineWidth = Math.max(1.5, ts * 0.035);
    ctx.beginPath();
    ctx.moveTo(bowX + ts * 0.42, bowY - ts * 0.18);
    ctx.quadraticCurveTo(bowX + ts * 0.52, bowY, bowX + ts * 0.42, bowY + ts * 0.16);
    ctx.stroke();
  });
}

// ── Duty board ──────────────────────────────────────────────────────────────

/**
 * The watch rotation as the wall sees it: a slate ruled into a grid with two
 * columns chalked in and the rest blank, a stack of pinned returns stamped
 * and sent back, and a candle sconce either side.
 */
export function paintLodgeDutyBoard(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const boardL = box.left + ts * 0.2;
    const boardR = box.right - ts * 0.2;
    const boardT = box.bottom - ts * 1.62;
    const boardB = box.bottom - ts * 0.58;

    // A narrow bench below it for the watch's boots and a helmet.
    const benchY = box.bottom - ts * 0.4;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (const lx of [boardL + ts * 0.1, boardR - ts * 0.18]) {
      ctx.fillRect(lx, benchY, ts * 0.08, box.bottom - benchY - ts * 0.04);
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.6));
    ctx.beginPath();
    ctx.rect(boardL, benchY - ts * 0.06, boardR - boardL, ts * 0.1);
    ctx.fill();
    inkOutline(ctx, ts);
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.08,
      box.width * 0.4,
      ts * 0.12,
      0.28,
    );

    // The frame and slate.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.beginPath();
    ctx.rect(
      boardL - ts * 0.06,
      boardT - ts * 0.06,
      boardR - boardL + ts * 0.12,
      boardB - boardT + ts * 0.12,
    );
    ctx.fill();
    inkOutline(ctx, ts);
    const slate = getTownRamp('oc_slate');
    ctx.fillStyle = rgb(sampleRamp(slate, 0.15));
    ctx.fillRect(boardL, boardT, (boardR - boardL) * 0.58, boardB - boardT);
    // Rotation grid: six watches, two of them chalked with names.
    const gridL = boardL + ts * 0.08;
    const gridR = boardL + (boardR - boardL) * 0.58 - ts * 0.08;
    const gridT = boardT + ts * 0.14;
    const gridB = boardB - ts * 0.08;
    ctx.strokeStyle = rgba(CHALK, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.015);
    const watchCols = 6;
    const dayRows = 5;
    for (let c = 0; c <= watchCols; c++) {
      const gx = gridL + ((gridR - gridL) * c) / watchCols;
      ctx.beginPath();
      ctx.moveTo(gx, gridT);
      ctx.lineTo(gx, gridB);
      ctx.stroke();
    }
    for (let r = 0; r <= dayRows; r++) {
      const gy = gridT + ((gridB - gridT) * r) / dayRows;
      ctx.beginPath();
      ctx.moveTo(gridL, gy);
      ctx.lineTo(gridR, gy);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(CHALK, 0.85);
    const cellW = (gridR - gridL) / watchCols;
    const cellH = (gridB - gridT) / dayRows;
    const markRng = forkRng(rng);
    for (let r = 0; r < dayRows; r++) {
      for (const c of [0, 1]) {
        ctx.fillRect(
          gridL + c * cellW + cellW * 0.2,
          gridT + r * cellH + cellH * 0.4,
          cellW * (0.5 + jitter(markRng, 0.1)),
          Math.max(1, ts * 0.02),
        );
      }
    }
    // Heading scrawl.
    ctx.fillRect(gridL, boardT + ts * 0.05, (gridR - gridL) * 0.6, Math.max(1, ts * 0.025));

    // The returns: pinned sheets on the cork half, each with a red stamp.
    const corkL = boardL + (boardR - boardL) * 0.6;
    ctx.fillStyle = rgb([150, 112, 72]);
    ctx.fillRect(corkL, boardT, boardR - corkL, boardB - boardT);
    const sheetW = ts * 0.34;
    const sheetH = ts * 0.44;
    const sheetSpots: ReadonlyArray<readonly [number, number, number]> = [
      [0.04, 0.12, -0.08],
      [0.46, 0.3, 0.1],
    ];
    for (const [sx, sy, tilt] of sheetSpots) {
      const x = corkL + (boardR - corkL - sheetW) * sx * 1.6;
      const y = boardT + (boardB - boardT - sheetH) * sy * 1.4;
      paintSheet(ctx, x, y, sheetW, sheetH, tilt, ts, BRASS);
      ctx.strokeStyle = rgba(PIN_RED, 0.8);
      ctx.lineWidth = Math.max(1, ts * 0.02);
      ctx.strokeRect(x + sheetW * 0.2, y + sheetH * 0.55, sheetW * 0.6, sheetH * 0.2);
    }

    // Sconces either side.
    for (const cx of [box.left + ts * 0.1, box.right - ts * 0.1]) {
      ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.45));
      ctx.fillRect(cx - ts * 0.06, boardT + ts * 0.36, ts * 0.12, ts * 0.04);
      paintCandle(ctx, cx, boardT + ts * 0.36, ts * 0.14, ts);
    }

    // A helmet and a pair of boots on the bench.
    const helmX = boardL + ts * 0.5;
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.6));
    ctx.beginPath();
    ctx.arc(helmX, benchY - ts * 0.06, ts * 0.15, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(SPEAR_STEEL_LIGHT, 0.6);
    ctx.fillRect(helmX - ts * 0.08, benchY - ts * 0.17, ts * 0.05, ts * 0.04);
    for (const bx of [boardR - ts * 0.7, boardR - ts * 0.52]) {
      ctx.fillStyle = rgb(STRAP_LEATHER);
      ctx.beginPath();
      ctx.rect(bx, benchY - ts * 0.24, ts * 0.12, ts * 0.2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.beginPath();
      ctx.rect(bx, benchY - ts * 0.08, ts * 0.2, ts * 0.06);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
  });
}

// ── Stove ───────────────────────────────────────────────────────────────────

/**
 * The watch's cast-iron stove on a slate hearth plate, its flue running up
 * into the wall, a kettle on the plate top, a coal scuttle beside it and a
 * pair of socks drying on the guard rail — the one warm corner of the post.
 */
export function paintLodgeStove(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const iron = ironRamp();
    const slate = getTownRamp('oc_slate');
    bandShadow(ctx, box, ts, 0.3);

    // Hearth plate.
    ctx.fillStyle = rgb(sampleRamp(slate, 0.35));
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.1, box.bottom - ts * 0.4, box.width - ts * 0.2, ts * 0.32);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(slate, 0.8), 0.6);
    ctx.fillRect(box.left + ts * 0.12, box.bottom - ts * 0.39, box.width - ts * 0.24, ts * 0.03);

    const stoveCx = box.left + ts * 0.85;
    const bodyW = ts * 0.78;
    const bodyTop = box.bottom - ts * 1.25;
    const bodyBottom = box.bottom - ts * 0.3;

    // Flue up into the wall, with a damper collar.
    const flueW = ts * 0.2;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.beginPath();
    ctx.rect(
      stoveCx - flueW / 2,
      box.bottom - ts * 2.45,
      flueW,
      bodyTop - (box.bottom - ts * 2.45),
    );
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(iron, 0.9), 0.5);
    ctx.fillRect(
      stoveCx - flueW * 0.3,
      box.bottom - ts * 2.4,
      flueW * 0.15,
      bodyTop - (box.bottom - ts * 2.4),
    );
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.beginPath();
    ctx.rect(stoveCx - flueW * 0.7, bodyTop - ts * 0.45, flueW * 1.4, ts * 0.08);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);

    // Pot-bellied body.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.35));
    ctx.beginPath();
    ctx.moveTo(stoveCx - bodyW * 0.38, bodyTop);
    ctx.lineTo(stoveCx + bodyW * 0.38, bodyTop);
    ctx.quadraticCurveTo(
      stoveCx + bodyW * 0.62,
      (bodyTop + bodyBottom) / 2,
      stoveCx + bodyW * 0.42,
      bodyBottom,
    );
    ctx.lineTo(stoveCx - bodyW * 0.42, bodyBottom);
    ctx.quadraticCurveTo(
      stoveCx - bodyW * 0.62,
      (bodyTop + bodyBottom) / 2,
      stoveCx - bodyW * 0.38,
      bodyTop,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(iron, 0.95), 0.4);
    ctx.fillRect(
      stoveCx - bodyW * 0.36,
      bodyTop + ts * 0.1,
      ts * 0.05,
      bodyBottom - bodyTop - ts * 0.2,
    );
    // Top plate.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.beginPath();
    ctx.ellipse(stoveCx, bodyTop, bodyW * 0.44, ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    // Feet.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.25));
    for (const fx of [-0.3, 0.3]) {
      ctx.fillRect(stoveCx + bodyW * fx - ts * 0.04, bodyBottom, ts * 0.08, ts * 0.06);
    }
    // Firebox door, open a crack with the fire showing.
    const doorY = bodyTop + (bodyBottom - bodyTop) * 0.45;
    const doorW = bodyW * 0.5;
    const doorH = (bodyBottom - bodyTop) * 0.36;
    const glow = ctx.createRadialGradient(
      stoveCx,
      doorY + doorH / 2,
      0,
      stoveCx,
      doorY + doorH / 2,
      ts * 0.8,
    );
    glow.addColorStop(0, rgba(FIRE_MID, 0.45));
    glow.addColorStop(1, rgba(FIRE_MID, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(stoveCx - ts * 0.8, doorY - ts * 0.4, ts * 1.6, ts * 1.2);
    ctx.fillStyle = rgb(FIRE_MID);
    ctx.beginPath();
    ctx.rect(stoveCx - doorW / 2, doorY, doorW, doorH);
    ctx.fill();
    ctx.fillStyle = rgb(FIRE_CORE);
    ctx.beginPath();
    ctx.ellipse(stoveCx, doorY + doorH * 0.7, doorW * 0.3, doorH * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.3));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(stoveCx - doorW / 2 + (doorW * i) / 4, doorY);
      ctx.lineTo(stoveCx - doorW / 2 + (doorW * i) / 4, doorY + doorH);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(stoveCx - doorW / 2, doorY, doorW, doorH);
    inkOutline(ctx, ts * 0.8);

    // Kettle on the plate.
    const kettleX = stoveCx + ts * 0.08;
    const kettleBase = bodyTop - ts * 0.02;
    ctx.fillStyle = rgb(mix(sampleRamp(iron, 0.5), [120, 90, 60], 0.35));
    ctx.beginPath();
    ctx.ellipse(kettleX, kettleBase - ts * 0.12, ts * 0.17, ts * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.3));
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.arc(kettleX, kettleBase - ts * 0.24, ts * 0.1, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(kettleX - ts * 0.15, kettleBase - ts * 0.14);
    ctx.lineTo(kettleX - ts * 0.27, kettleBase - ts * 0.24);
    ctx.stroke();
    ctx.strokeStyle = rgba(PAPER, 0.35);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.moveTo(kettleX - ts * 0.28, kettleBase - ts * 0.28);
    ctx.quadraticCurveTo(
      kettleX - ts * 0.4,
      kettleBase - ts * 0.5,
      kettleX - ts * 0.3,
      kettleBase - ts * 0.7,
    );
    ctx.stroke();

    // Guard rail with socks drying on it.
    const railY = bodyTop + ts * 0.18;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(stoveCx + bodyW * 0.5, railY);
    ctx.lineTo(stoveCx + bodyW * 0.75, railY);
    ctx.stroke();
    ctx.fillStyle = rgb(mix(CLOAK_GREY, PAPER, 0.35));
    for (const sx of [0.54, 0.66]) {
      ctx.beginPath();
      ctx.rect(stoveCx + bodyW * sx, railY, ts * 0.07, ts * 0.2);
      ctx.fill();
      inkOutline(ctx, ts * 0.5);
    }

    // Coal scuttle and a split-log stack on the east half.
    const scuttleX = box.right - ts * 0.42;
    const scuttleBase = box.bottom - ts * 0.14;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.beginPath();
    ctx.moveTo(scuttleX - ts * 0.18, scuttleBase);
    ctx.lineTo(scuttleX - ts * 0.22, scuttleBase - ts * 0.3);
    ctx.lineTo(scuttleX + ts * 0.2, scuttleBase - ts * 0.36);
    ctx.lineTo(scuttleX + ts * 0.18, scuttleBase);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb([28, 26, 26]);
    const coalRng = forkRng(rng);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(
        scuttleX + jitter(coalRng, ts * 0.14),
        scuttleBase - ts * 0.34 + jitter(coalRng, ts * 0.03),
        ts * 0.05,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const wood = woodRamp();
    for (let i = 0; i < 3; i++) {
      const lx = box.right - ts * 0.72 + i * ts * 0.1;
      const ly = box.bottom - ts * 0.9 - i * ts * 0.04;
      ctx.fillStyle = rgb(sampleRamp(wood, 0.5 + i * 0.08));
      ctx.beginPath();
      ctx.ellipse(lx, ly, ts * 0.07, ts * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
  });
}

// ── Kit pegs ────────────────────────────────────────────────────────────────

/**
 * A peg rail for a section's kit with two men's worth on it: a pair of
 * cloaks, a helmet, a canteen and a sword belt, then a run of bare pegs.
 * Boots stand under the cloaks.
 */
export function paintLodgeKitPegs(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.1,
      box.width * 0.4,
      ts * 0.12,
      0.25,
    );
    const railY = box.bottom - ts * 1.45;
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.beginPath();
    ctx.rect(left, railY, right - left, ts * 0.12);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.6);
    ctx.fillRect(left, railY + ts * 0.01, right - left, ts * 0.025);
    const pegs = 8;
    const pegX = (i: number): number =>
      left + ts * 0.15 + ((right - left - ts * 0.3) * i) / (pegs - 1);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (let i = 0; i < pegs; i++) {
      ctx.beginPath();
      ctx.arc(pegX(i), railY + ts * 0.16, ts * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    const flip = variant % 2 === 1;
    const at = (i: number): number => pegX(flip ? pegs - 1 - i : i);

    // Cloaks.
    for (const [i, colour] of [
      [0, CLOAK_GREY],
      [1, CLOAK_BROWN],
    ] as const) {
      const cx = at(i);
      const top = railY + ts * 0.16;
      const bottom = box.bottom - ts * 0.5 + jitter(forkRng(rng), ts * 0.04);
      ctx.fillStyle = rgb(colour);
      ctx.beginPath();
      ctx.moveTo(cx - ts * 0.07, top);
      ctx.lineTo(cx + ts * 0.07, top);
      ctx.quadraticCurveTo(cx + ts * 0.24, (top + bottom) / 2, cx + ts * 0.2, bottom);
      ctx.lineTo(cx - ts * 0.2, bottom);
      ctx.quadraticCurveTo(cx - ts * 0.24, (top + bottom) / 2, cx - ts * 0.07, top);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.strokeStyle = rgba(INK, 0.35);
      ctx.lineWidth = Math.max(1, ts * 0.018);
      for (const fx of [-0.08, 0.06]) {
        ctx.beginPath();
        ctx.moveTo(cx + ts * fx, top + ts * 0.15);
        ctx.lineTo(cx + ts * fx * 1.6, bottom - ts * 0.02);
        ctx.stroke();
      }
    }
    // Helmet.
    const helmX = at(3);
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.6));
    ctx.beginPath();
    ctx.arc(helmX, railY + ts * 0.4, ts * 0.15, Math.PI, 0);
    ctx.lineTo(helmX + ts * 0.19, railY + ts * 0.44);
    ctx.lineTo(helmX - ts * 0.19, railY + ts * 0.44);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(SPEAR_STEEL_LIGHT, 0.6);
    ctx.fillRect(helmX - ts * 0.08, railY + ts * 0.3, ts * 0.05, ts * 0.05);
    // Canteen on its strap.
    const canX = at(4);
    ctx.strokeStyle = rgb(STRAP_LEATHER);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(canX, railY + ts * 0.16);
    ctx.lineTo(canX - ts * 0.08, railY + ts * 0.55);
    ctx.moveTo(canX, railY + ts * 0.16);
    ctx.lineTo(canX + ts * 0.08, railY + ts * 0.55);
    ctx.stroke();
    ctx.fillStyle = rgb(CANTEEN);
    ctx.beginPath();
    ctx.ellipse(canX, railY + ts * 0.66, ts * 0.13, ts * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    // Sword belt, scabbard hanging.
    const beltX = at(5);
    ctx.strokeStyle = rgb(STRAP_LEATHER);
    ctx.lineWidth = Math.max(1.5, ts * 0.04);
    ctx.beginPath();
    ctx.moveTo(beltX, railY + ts * 0.16);
    ctx.quadraticCurveTo(beltX + ts * 0.1, railY + ts * 0.5, beltX + ts * 0.04, railY + ts * 0.62);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(wood, 0.2));
    ctx.save();
    ctx.translate(beltX + ts * 0.05, railY + ts * 0.62);
    ctx.rotate(0.12);
    ctx.beginPath();
    ctx.rect(-ts * 0.04, 0, ts * 0.08, ts * 0.6);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(BRASS);
    ctx.fillRect(-ts * 0.045, ts * 0.52, ts * 0.09, ts * 0.06);
    ctx.restore();

    // Boots under the cloaks.
    for (const bx of [at(0) - ts * 0.12, at(0) + ts * 0.08, at(1) + ts * 0.04]) {
      ctx.fillStyle = rgb(STRAP_LEATHER);
      ctx.beginPath();
      ctx.rect(bx, box.bottom - ts * 0.38, ts * 0.12, ts * 0.26);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.beginPath();
      ctx.rect(bx, box.bottom - ts * 0.18, ts * 0.2, ts * 0.08);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
  });
}

// ── Kessler's footlocker ────────────────────────────────────────────────────

/**
 * An iron-cornered footlocker at the foot of the sergeant's bunk, lid down,
 * with a thin book pushed in under it so only its spine shows — the log he
 * keeps instead of filing requests, on purpose not on the wall.
 */
export function paintKesslerFootlocker(
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
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.1,
      box.width * 0.42,
      ts * 0.14,
      0.34,
    );
    const left = box.left + ts * 0.12;
    const right = box.right - ts * 0.12;
    const lidTop = box.bottom - ts * 0.62;
    const lidDepth = ts * 0.14;
    const bodyTop = lidTop + lidDepth;
    const bottom = box.bottom - ts * 0.08;

    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.beginPath();
    ctx.rect(left, lidTop, right - left, lidDepth);
    ctx.fill();
    inkOutline(ctx, ts);
    paintPlankBoard(ctx, left, bodyTop, right - left, bottom - bodyTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.14,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(left, bodyTop, right - left, bottom - bodyTop);
    inkOutline(ctx, ts);
    // Iron corners and a hasp.
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    for (const cx of [left, right - ts * 0.1]) {
      ctx.fillRect(cx, lidTop, ts * 0.1, ts * 0.1);
      ctx.fillRect(cx, bottom - ts * 0.1, ts * 0.1, ts * 0.1);
    }
    ctx.fillRect(box.centreX - ts * 0.05, bodyTop - ts * 0.02, ts * 0.1, ts * 0.14);
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.arc(box.centreX, bodyTop + ts * 0.14, ts * 0.035, 0, Math.PI * 2);
    ctx.fill();
    // Stencilled name plate.
    ctx.fillStyle = rgb(PAPER_SHADE);
    ctx.fillRect(left + ts * 0.08, bodyTop + ts * 0.22, ts * 0.22, ts * 0.08);
    ctx.fillStyle = rgb(INK);
    ctx.fillRect(left + ts * 0.11, bodyTop + ts * 0.25, ts * 0.15, Math.max(1, ts * 0.02));

    // The log's spine, pushed in under the lid on the room side.
    ctx.fillStyle = rgb(LOG_COVER);
    ctx.beginPath();
    ctx.rect(right - ts * 0.34, lidTop - ts * 0.05, ts * 0.26, ts * 0.07);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    ctx.fillStyle = rgb(PAPER);
    ctx.fillRect(right - ts * 0.33, lidTop + ts * 0.02, ts * 0.24, ts * 0.025);
    ctx.fillStyle = rgb(BRASS_DARK);
    ctx.fillRect(right - ts * 0.3, lidTop - ts * 0.04, ts * 0.02, ts * 0.05);
  });
}

// ── Cellar lid ──────────────────────────────────────────────────────────────

/** Flagstone tones for the cellar head's kerb — cold grey, not the hearth's warm fieldstone. */
const FLAG_TONES: readonly RGB[] = [
  [112, 110, 104],
  [128, 124, 116],
  [98, 98, 94],
  [140, 136, 126],
];
const FLAG_MORTAR: RGB = [58, 54, 50];

/** Irregular flags laid in courses, clipped to the rectangle. */
function paintFlags(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(FLAG_MORTAR);
  ctx.fillRect(x, y, w, h);
  let courseH = ts * 0.42;
  for (let cy = y; cy < y + h; cy += courseH) {
    courseH = ts * (0.36 + Math.abs(jitter(rng, 0.14)));
    let cx = x - Math.abs(jitter(rng, ts * 0.4));
    while (cx < x + w) {
      const sw = ts * (0.42 + Math.abs(jitter(rng, 0.34)));
      const tone =
        FLAG_TONES[Math.floor(Math.abs(jitter(rng, 1)) * FLAG_TONES.length) % FLAG_TONES.length];
      const gap = ts * 0.025;
      ctx.fillStyle = rgb(tone);
      ctx.beginPath();
      ctx.roundRect(cx + gap, cy + gap, sw - gap * 2, courseH - gap * 2, ts * 0.04);
      ctx.fill();
      ctx.fillStyle = rgba(PAPER, 0.12);
      ctx.fillRect(cx + gap * 2, cy + gap * 2, sw * 0.6, courseH * 0.12);
      ctx.fillStyle = rgba(INK, 0.16);
      ctx.fillRect(cx + gap * 2, cy + courseH * 0.72, sw - gap * 4, courseH * 0.2);
      cx += sw;
    }
  }
  ctx.restore();
}

/**
 * The lid the post sits on: a cellar head of cold flagstones let into the
 * boards, and in it a two-by-two trapdoor of heavy planks in a timber frame,
 * banded with iron straps, a drop ring folded flat and a padlocked hasp
 * pinning it to the frame. Painted in the ground layer — it is floor, and a
 * crawler walks straight over it.
 */
export function paintCellarTrapdoor(
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
    const kerbInset = ts * 0.1;
    const kerbL = box.left + kerbInset;
    const kerbR = box.right - kerbInset;
    const kerbT = box.top + kerbInset;
    const kerbB = box.bottom - kerbInset;
    paintFlags(ctx, kerbL, kerbT, kerbR - kerbL, kerbB - kerbT, ts, forkRng(rng));
    const kerbShade = ctx.createRadialGradient(
      box.centreX,
      (kerbT + kerbB) / 2,
      ts * 0.8,
      box.centreX,
      (kerbT + kerbB) / 2,
      ts * 2.2,
    );
    kerbShade.addColorStop(0, rgba(INK, 0));
    kerbShade.addColorStop(1, rgba(INK, 0.3));
    ctx.fillStyle = kerbShade;
    ctx.fillRect(kerbL, kerbT, kerbR - kerbL, kerbB - kerbT);
    ctx.beginPath();
    ctx.rect(kerbL, kerbT, kerbR - kerbL, kerbB - kerbT);
    inkOutline(ctx, ts);

    const lidHalf = ts * 0.92;
    const frameW = ts * 0.12;
    const midY = (box.top + box.bottom) / 2;
    const l = box.centreX - lidHalf;
    const r = box.centreX + lidHalf;
    const t = midY - lidHalf;
    const b = midY + lidHalf;

    // Dark gap all round, then the timber frame.
    ctx.fillStyle = rgba(INK, 0.55);
    ctx.fillRect(l - ts * 0.03, t - ts * 0.03, r - l + ts * 0.06, b - t + ts * 0.06);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(l, t, r - l, b - t);
    paintPlankBoard(
      ctx,
      l + frameW,
      t + frameW,
      r - l - frameW * 2,
      b - t - frameW * 2,
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: ts * 0.3,
        ramp: wood,
      },
    );
    // Worn traffic line across the middle where boots cross it.
    ctx.fillStyle = rgba(sampleRamp(wood, 0.95), 0.18);
    ctx.fillRect(l + frameW, (t + b) / 2 - ts * 0.25, r - l - frameW * 2, ts * 0.5);
    ctx.beginPath();
    ctx.rect(l, t, r - l, b - t);
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(INK, 0.6);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.strokeRect(l + frameW, t + frameW, r - l - frameW * 2, b - t - frameW * 2);

    // Iron straps with rivets.
    const strapH = ts * 0.12;
    for (const sy of [t + (b - t) * 0.26, t + (b - t) * 0.7]) {
      ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
      ctx.beginPath();
      ctx.rect(l + frameW * 0.5, sy - strapH / 2, r - l - frameW, strapH);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgba(sampleRamp(iron, 1), 0.5);
      ctx.fillRect(l + frameW * 0.5, sy - strapH / 2, r - l - frameW, Math.max(1, ts * 0.02));
      ctx.fillStyle = rgb(sampleRamp(iron, 0.85));
      const rivets = 6;
      for (let i = 0; i < rivets; i++) {
        ctx.beginPath();
        ctx.arc(
          l + frameW + ((r - l - frameW * 2) * (i + 0.5)) / rivets,
          sy,
          ts * 0.025,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    // Drop ring folded flat.
    const ringX = (l + r) / 2;
    const ringY = t + (b - t) * 0.48;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.55));
    ctx.lineWidth = Math.max(1.5, ts * 0.045);
    ctx.beginPath();
    ctx.ellipse(ringX, ringY + ts * 0.08, ts * 0.16, ts * 0.11, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(iron, 0.4));
    ctx.fillRect(ringX - ts * 0.06, ringY - ts * 0.06, ts * 0.12, ts * 0.08);
    // Padlocked hasp on the south edge, over the frame.
    const haspX = (l + r) / 2;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
    ctx.beginPath();
    ctx.rect(haspX - ts * 0.07, b - frameW - ts * 0.14, ts * 0.14, ts * 0.24);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.rect(haspX - ts * 0.08, b - ts * 0.08, ts * 0.16, ts * 0.14);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.strokeStyle = rgb(BRASS_DARK);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.arc(haspX, b - ts * 0.08, ts * 0.05, Math.PI, 0);
    ctx.stroke();
    // Chalked arrow and tally scratched on the frame by a bored watch.
    ctx.strokeStyle = rgba(CHALK, 0.55);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (let i = 0; i < 5; i++) {
      const tx = r - ts * 0.4 + i * ts * 0.05;
      ctx.beginPath();
      ctx.moveTo(tx, t + ts * 0.02);
      ctx.lineTo(tx, t + frameW - ts * 0.02);
      ctx.stroke();
    }
  });
}
