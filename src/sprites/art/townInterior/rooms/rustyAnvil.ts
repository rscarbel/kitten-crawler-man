/**
 * Bespoke furniture for The Rusty Anvil, Varga's smithy. The forge hall is
 * built around a few big pieces a smith actually works between: a
 * waist-high brick forge with its coals open on top under a sooted hood, a
 * great leather bellows hung in its frame beside it, the anvil on its
 * banded stump, and a tool wall of hammers and tongs within a step of all
 * three. The shop is a counter of finished work with a rack of blades on
 * the partition behind it and a table of ironmongery by the door.
 *
 * Every painter keeps its ink inside its own footprint's columns and only
 * rises above it, so a piece against a wall climbs the wall face rather
 * than spilling sideways.
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
  type Ramp,
  type RGB,
} from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

interface Pt {
  readonly x: number;
  readonly y: number;
}

function woodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function stoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}

// ── Materials no shared ramp covers ─────────────────────────────────────────

/** Worked steel: brighter and bluer at its lit edge than the near-black hardware ramp, so a face reads as polished by use. */
const STEEL: Ramp = {
  shadow: [26, 28, 32],
  mid: [64, 68, 76],
  light: [122, 128, 138],
  accent: [196, 202, 212],
};
/** Soot-dark forge brick. */
const BRICK: Ramp = {
  shadow: [58, 30, 24],
  mid: [112, 58, 42],
  light: [156, 88, 64],
  accent: [184, 118, 90],
};
/** Oiled bellows hide. */
const LEATHER: Ramp = {
  shadow: [52, 30, 20],
  mid: [104, 62, 38],
  light: [150, 98, 62],
  accent: [182, 132, 88],
};
/** Dark-stained oak for the shop counter and racks — heavier than the pale timber of the forge hall's rough benches. */
const OAK: Ramp = {
  shadow: [44, 30, 22],
  mid: [92, 64, 44],
  light: [140, 104, 72],
  accent: [176, 140, 100],
};
const HEAT_WHITE: RGB = [255, 244, 196];
const HEAT_YELLOW: RGB = [252, 200, 96];
const HEAT_ORANGE: RGB = [232, 110, 38];
const HEAT_RED: RGB = [150, 40, 22];
const SOOT: RGB = [22, 18, 16];
const COAL: RGB = [30, 28, 28];
const COAL_SHEEN: RGB = [84, 82, 86];
const BRASS: RGB = [196, 156, 76];
const BRASS_DARK: RGB = [122, 90, 40];
const QUENCH_WATER: RGB = [30, 42, 48];
const CLOTH_RED: RGB = [128, 40, 36];

// ── Shared helpers ──────────────────────────────────────────────────────────

/** A long piece's shadow is a band along its foot, not one ellipse under its middle. */
function bandShadow(ctx: Ctx, box: FootprintBox, ts: number, alpha = 0.32): void {
  const segments = Math.max(1, Math.round(box.width / ts));
  for (let i = 0; i < segments; i++) {
    const cx = box.left + (box.width * (i + 0.5)) / segments;
    drawTownContactShadow(ctx, cx, box.bottom - ts * 0.07, ts * 0.6, ts * 0.15, alpha);
  }
}

function polygon(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function fillPolygon(
  ctx: Ctx,
  points: readonly Pt[],
  color: RGB,
  ts: number,
  outline = true,
): void {
  polygon(ctx, points);
  ctx.fillStyle = rgb(color);
  ctx.fill();
  if (outline) inkOutline(ctx, ts);
}

function outlinedRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  ts: number,
) {
  ctx.fillStyle = rgb(color);
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

function glow(ctx: Ctx, cx: number, cy: number, radius: number, color: RGB, alpha: number) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

/** A thick stroke with an ink outline round it — a handle, a rod, a rail. */
function inkedLine(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  width: number,
  color: RGB,
  ts: number,
  cap: CanvasLineCap = 'round',
): void {
  ctx.lineCap = cap;
  ctx.strokeStyle = rgba(TOWN_INK, 0.85);
  ctx.lineWidth = width + ts * 0.035;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.strokeStyle = rgb(color);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** Brick courses with dark mortar, stretchers offset every other course, a few bricks burnt darker. */
function paintBrickFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
  soot = 0,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(mix(BRICK.shadow, SOOT, 0.4));
  ctx.fillRect(x, y, w, h);
  const courseH = ts * 0.13;
  const brickW = ts * 0.3;
  const mortar = Math.max(1, ts * 0.022);
  const courses = Math.ceil(h / courseH);
  for (let c = 0; c < courses; c++) {
    const cy = y + c * courseH;
    const offset = c % 2 === 0 ? 0 : brickW / 2;
    for (let bx = x - offset; bx < x + w; bx += brickW) {
      const tone = 0.42 + jitter(rng, 0.14) + (1 - c / courses) * 0.08;
      ctx.fillStyle = rgb(sampleRamp(BRICK, tone));
      ctx.fillRect(bx + mortar / 2, cy + mortar / 2, brickW - mortar, courseH - mortar);
      ctx.fillStyle = rgba(BRICK.accent, 0.35);
      ctx.fillRect(bx + mortar / 2, cy + mortar / 2, brickW - mortar, Math.max(1, mortar));
    }
  }
  if (soot > 0) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgba(SOOT, soot));
    g.addColorStop(1, rgba(SOOT, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/** A hammer: a wooden haft and a squared iron head, drawn from the head outwards along `angle`. */
function paintHammer(
  ctx: Ctx,
  head: Pt,
  angle: number,
  haftLen: number,
  headW: number,
  ts: number,
): void {
  const end = { x: head.x + Math.cos(angle) * haftLen, y: head.y + Math.sin(angle) * haftLen };
  inkedLine(ctx, head, end, ts * 0.05, sampleRamp(woodRamp(), 0.62), ts);
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(angle + Math.PI / 2);
  const headH = headW * 0.42;
  outlinedRect(ctx, -headW / 2, -headH / 2, headW, headH, sampleRamp(STEEL, 0.45), ts);
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.9));
  ctx.fillRect(-headW / 2, -headH / 2, headW, Math.max(1, headH * 0.28));
  ctx.restore();
}

/** Smith's tongs: two long reins meeting at a rivet, short jaws past it. */
function paintTongs(ctx: Ctx, top: Pt, length: number, ts: number, spread = 1): void {
  const pivot = { x: top.x, y: top.y + length * 0.28 };
  const jawL = { x: top.x - ts * 0.05 * spread, y: top.y };
  const jawR = { x: top.x + ts * 0.05 * spread, y: top.y };
  const reinL = { x: top.x - ts * 0.07 * spread, y: top.y + length };
  const reinR = { x: top.x + ts * 0.05 * spread, y: top.y + length };
  const iron = sampleRamp(STEEL, 0.32);
  inkedLine(ctx, jawL, pivot, ts * 0.04, iron, ts);
  inkedLine(ctx, jawR, pivot, ts * 0.04, iron, ts);
  inkedLine(ctx, pivot, reinL, ts * 0.035, iron, ts);
  inkedLine(ctx, pivot, reinR, ts * 0.035, iron, ts);
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.85));
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, ts * 0.025, 0, Math.PI * 2);
  ctx.fill();
}

/** A horseshoe, toe up as it hangs from a peg, nail holes picked out. */
function paintHorseshoe(ctx: Ctx, cx: number, cy: number, r: number, ts: number): void {
  const iron = sampleRamp(STEEL, 0.4);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(TOWN_INK, 0.85);
  ctx.lineWidth = r * 0.62 + ts * 0.03;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.95, Math.PI * 2.05);
  ctx.stroke();
  ctx.strokeStyle = rgb(iron);
  ctx.lineWidth = r * 0.62;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.95, Math.PI * 2.05);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.85));
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.18, Math.PI * 1.15, Math.PI * 1.6);
  ctx.stroke();
}

/** A sword hung hilt up: pommel, grip, crossguard, and a blade tapering to its point. */
function paintSword(ctx: Ctx, x: number, topY: number, length: number, ts: number): void {
  const bladeW = ts * 0.07;
  const guardY = topY + length * 0.24;
  const tipY = topY + length;
  fillPolygon(
    ctx,
    [
      { x: x - bladeW / 2, y: guardY },
      { x: x + bladeW / 2, y: guardY },
      { x: x + bladeW / 2, y: tipY - bladeW * 1.6 },
      { x, y: tipY },
      { x: x - bladeW / 2, y: tipY - bladeW * 1.6 },
    ],
    sampleRamp(STEEL, 0.72),
    ts,
  );
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.95));
  ctx.fillRect(x - bladeW * 0.1, guardY, Math.max(1, bladeW * 0.2), tipY - guardY - bladeW * 2);
  outlinedRect(
    ctx,
    x - ts * 0.03,
    topY + ts * 0.05,
    ts * 0.06,
    guardY - topY - ts * 0.05,
    sampleRamp(LEATHER, 0.4),
    ts,
  );
  outlinedRect(ctx, x - ts * 0.13, guardY - ts * 0.03, ts * 0.26, ts * 0.05, BRASS, ts);
  ctx.fillStyle = rgb(BRASS);
  ctx.beginPath();
  ctx.arc(x, topY + ts * 0.04, ts * 0.045, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
}

/** An axe hung head up: a bearded iron head on a long haft. */
function paintAxe(ctx: Ctx, x: number, topY: number, length: number, ts: number, facing: 1 | -1) {
  inkedLine(
    ctx,
    { x, y: topY },
    { x, y: topY + length },
    ts * 0.05,
    sampleRamp(woodRamp(), 0.6),
    ts,
  );
  const headTop = topY + ts * 0.03;
  fillPolygon(
    ctx,
    [
      { x: x - facing * ts * 0.04, y: headTop },
      { x: x + facing * ts * 0.1, y: headTop + ts * 0.02 },
      { x: x + facing * ts * 0.24, y: headTop - ts * 0.04 },
      { x: x + facing * ts * 0.24, y: headTop + ts * 0.26 },
      { x: x + facing * ts * 0.1, y: headTop + ts * 0.14 },
      { x: x - facing * ts * 0.04, y: headTop + ts * 0.14 },
    ],
    sampleRamp(STEEL, 0.5),
    ts,
  );
  inkedLine(
    ctx,
    { x: x + facing * ts * 0.23, y: headTop - ts * 0.03 },
    { x: x + facing * ts * 0.23, y: headTop + ts * 0.24 },
    Math.max(1, ts * 0.02),
    sampleRamp(STEEL, 0.95),
    ts * 0.3,
  );
}

/** A curved blade with a stub of handle — a knife laid out for sale. */
function paintKnife(ctx: Ctx, x: number, y: number, len: number, ts: number): void {
  const handleLen = len * 0.38;
  outlinedRect(ctx, x, y - ts * 0.025, handleLen, ts * 0.05, sampleRamp(OAK, 0.55), ts * 0.7);
  fillPolygon(
    ctx,
    [
      { x: x + handleLen, y: y - ts * 0.03 },
      { x: x + len, y: y - ts * 0.03 },
      { x: x + handleLen, y: y + ts * 0.035 },
    ],
    sampleRamp(STEEL, 0.8),
    ts * 0.7,
  );
}

/** An open-faced helm with a nasal bar: a dome, a brow band, a cheek flare. */
function paintHelm(ctx: Ctx, cx: number, baseY: number, r: number, ts: number): void {
  const steel = sampleRamp(STEEL, 0.55);
  ctx.beginPath();
  ctx.moveTo(cx - r, baseY);
  ctx.lineTo(cx - r, baseY - r * 0.55);
  ctx.quadraticCurveTo(cx - r, baseY - r * 1.45, cx, baseY - r * 1.5);
  ctx.quadraticCurveTo(cx + r, baseY - r * 1.45, cx + r, baseY - r * 0.55);
  ctx.lineTo(cx + r, baseY);
  ctx.closePath();
  ctx.fillStyle = rgb(steel);
  ctx.fill();
  inkOutline(ctx, ts);
  const sheen = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  sheen.addColorStop(0, rgba(STEEL.accent, 0.55));
  sheen.addColorStop(0.45, rgba(STEEL.accent, 0));
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, baseY - r * 0.95, r * 0.35, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  outlinedRect(ctx, cx - r, baseY - r * 0.5, r * 2, r * 0.2, sampleRamp(STEEL, 0.35), ts * 0.8);
  outlinedRect(
    ctx,
    cx - r * 0.1,
    baseY - r * 0.5,
    r * 0.2,
    r * 0.55,
    sampleRamp(STEEL, 0.4),
    ts * 0.8,
  );
  for (const side of [-1, 1]) {
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.9));
    ctx.beginPath();
    ctx.arc(cx + side * r * 0.7, baseY - r * 0.4, Math.max(1, ts * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A heap of coal lumps, each with a cold sheen on its lit side. */
function paintCoalLumps(
  ctx: Ctx,
  cx: number,
  baseY: number,
  halfW: number,
  heapH: number,
  ts: number,
  rng: Rng,
  count: number,
): void {
  ctx.fillStyle = rgb(COAL);
  ctx.beginPath();
  ctx.ellipse(cx, baseY, halfW, heapH, 0, Math.PI, 0);
  ctx.fill();
  inkOutline(ctx, ts);
  for (let i = 0; i < count; i++) {
    const t = rng();
    const lx = cx + (t * 2 - 1) * halfW * 0.85;
    const edge = Math.sqrt(Math.max(0, 1 - ((lx - cx) / halfW) ** 2));
    const ly = baseY - rng() * heapH * edge * 0.9;
    const r = ts * (0.035 + rng() * 0.03);
    ctx.fillStyle = rgb(mix(COAL, SOOT, rng()));
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(COAL_SHEEN, 0.75);
    ctx.beginPath();
    ctx.arc(lx - r * 0.3, ly - r * 0.35, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── The forge ───────────────────────────────────────────────────────────────

/**
 * A smith's forge as she actually works at it: a waist-high brick hearth
 * with the fire open on top — a bed of coals white at the tuyère, a bar
 * pushed into it with the tongs still on — and a sooted brick hood over
 * it, lit orange on its underside, narrowing into a flue that climbs the
 * wall. The front row is the hearth; the back row is hood and chimney
 * against the north wall. The bellows' tuyère enters from the west flank.
 */
export function paintForge(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.45);

    const hearthFrontTop = box.bottom - ts * 0.62;
    const hearthBackY = box.bottom - ts * 1.42;
    const inset = ts * 0.06;
    const left = box.left + inset;
    const right = box.right - inset;

    // Hood and chimney first: they stand behind the hearth.
    const hoodLipY = hearthBackY - ts * 0.12;
    const hoodTopY = box.top - ts * 0.45;
    const flueW = ts * 0.9;
    const flueLeft = box.centreX - flueW / 2;
    const chimneyTop = box.top - ts * 1.55;
    paintBrickFace(
      ctx,
      flueLeft,
      chimneyTop,
      flueW,
      hoodTopY - chimneyTop + 2,
      ts,
      forkRng(rng),
      0.25,
    );
    ctx.fillStyle = rgba(SOOT, 0.35);
    ctx.fillRect(flueLeft + flueW * 0.62, chimneyTop, flueW * 0.38, hoodTopY - chimneyTop);
    ctx.beginPath();
    ctx.rect(flueLeft, chimneyTop, flueW, hoodTopY - chimneyTop);
    inkOutline(ctx, ts);
    const hoodPts: Pt[] = [
      { x: left + ts * 0.05, y: hoodLipY },
      { x: flueLeft - ts * 0.08, y: hoodTopY },
      { x: flueLeft + flueW + ts * 0.08, y: hoodTopY },
      { x: right - ts * 0.05, y: hoodLipY },
    ];
    ctx.save();
    polygon(ctx, hoodPts);
    ctx.clip();
    paintBrickFace(ctx, left, hoodTopY, right - left, hoodLipY - hoodTopY, ts, forkRng(rng), 0.55);
    const underGlow = ctx.createLinearGradient(0, hoodLipY, 0, hoodTopY);
    underGlow.addColorStop(0, rgba(HEAT_ORANGE, 0.55));
    underGlow.addColorStop(0.5, rgba(HEAT_RED, 0.15));
    underGlow.addColorStop(1, rgba(HEAT_RED, 0));
    ctx.fillStyle = underGlow;
    ctx.fillRect(left, hoodTopY, right - left, hoodLipY - hoodTopY);
    ctx.restore();
    polygon(ctx, hoodPts);
    inkOutline(ctx, ts);
    // An iron band holds the hood's lip.
    outlinedRect(
      ctx,
      left,
      hoodLipY - ts * 0.07,
      right - left,
      ts * 0.09,
      sampleRamp(STEEL, 0.3),
      ts,
    );
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = rgb(sampleRamp(STEEL, 0.8));
      ctx.fillRect(left + ((right - left) * (i + 0.5)) / 6, hoodLipY - ts * 0.045, 2, 2);
    }

    // Hearth top: a stone slab rim round the firepot, seen from above.
    const rimPts: Pt[] = [
      { x: left, y: hearthFrontTop },
      { x: left + ts * 0.1, y: hearthBackY },
      { x: right - ts * 0.1, y: hearthBackY },
      { x: right, y: hearthFrontTop },
    ];
    fillPolygon(ctx, rimPts, sampleRamp(stoneRamp(), 0.38), ts);
    ctx.fillStyle = rgba(stoneRamp().light, 0.5);
    ctx.fillRect(left + ts * 0.02, hearthFrontTop - ts * 0.05, right - left - ts * 0.04, ts * 0.04);
    // Firebrick back wall of the fire, glowing at its foot.
    const firebackTop = hearthBackY - ts * 0.02;
    const firebackH = ts * 0.22;
    paintBrickFace(
      ctx,
      left + ts * 0.5,
      firebackTop - firebackH,
      right - left - ts * 1.0,
      firebackH,
      ts,
      forkRng(rng),
    );
    glow(ctx, box.centreX, firebackTop, ts * 0.8, HEAT_ORANGE, 0.5);

    // The firepot: coals heaped in a shallow bowl, white-hot at the heart.
    const potCx = box.centreX - ts * 0.15;
    const potCy = (hearthFrontTop + hearthBackY) / 2 + ts * 0.04;
    const potRx = ts * 0.95;
    const potRy = ts * 0.3;
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.ellipse(potCx, potCy, potRx, potRy, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const coalRng = forkRng(rng);
    for (let i = 0; i < 46; i++) {
      const a = coalRng() * Math.PI * 2;
      const d = Math.sqrt(coalRng());
      const lx = potCx + Math.cos(a) * potRx * d * 0.92;
      const ly = potCy + Math.sin(a) * potRy * d * 0.85 - (1 - d) * ts * 0.06;
      const r = ts * (0.04 + coalRng() * 0.03);
      const heat = Math.max(0, 1 - d * 1.15);
      const color =
        heat > 0.55
          ? mix(HEAT_YELLOW, HEAT_WHITE, (heat - 0.55) * 2)
          : heat > 0.2
            ? mix(HEAT_ORANGE, HEAT_YELLOW, (heat - 0.2) * 2.8)
            : mix(COAL, HEAT_RED, heat * 4);
      ctx.fillStyle = rgb(color);
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
      if (heat < 0.2) {
        ctx.fillStyle = rgba(COAL_SHEEN, 0.6);
        ctx.beginPath();
        ctx.arc(lx - r * 0.3, ly - r * 0.3, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    glow(ctx, potCx, potCy - ts * 0.05, ts * 0.9, HEAT_YELLOW, 0.45);
    // Flame licks rising off the heart of the fire.
    for (let i = 0; i < 4; i++) {
      const fx = potCx + (i - 1.5) * ts * 0.18 + jitter(coalRng, ts * 0.04);
      const fh = ts * (0.22 + coalRng() * 0.16);
      ctx.fillStyle = rgba(i % 2 === 0 ? HEAT_ORANGE : HEAT_YELLOW, 0.85);
      ctx.beginPath();
      ctx.moveTo(fx - ts * 0.06, potCy);
      ctx.quadraticCurveTo(fx - ts * 0.04, potCy - fh * 0.6, fx + ts * 0.02, potCy - fh);
      ctx.quadraticCurveTo(fx + ts * 0.06, potCy - fh * 0.5, fx + ts * 0.06, potCy);
      ctx.closePath();
      ctx.fill();
    }

    // A bar in the fire, its tip at white heat, tongs still clamped on it.
    const barStart = { x: right - ts * 0.18, y: hearthFrontTop - ts * 0.12 };
    const barEnd = { x: potCx + ts * 0.1, y: potCy - ts * 0.02 };
    const barGrad = ctx.createLinearGradient(barStart.x, 0, barEnd.x, 0);
    barGrad.addColorStop(0, rgb(sampleRamp(STEEL, 0.3)));
    barGrad.addColorStop(0.45, rgb(HEAT_RED));
    barGrad.addColorStop(0.8, rgb(HEAT_YELLOW));
    barGrad.addColorStop(1, rgb(HEAT_WHITE));
    ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(TOWN_INK, 0.85);
    ctx.lineWidth = ts * 0.1;
    ctx.beginPath();
    ctx.moveTo(barStart.x, barStart.y);
    ctx.lineTo(barEnd.x, barEnd.y);
    ctx.stroke();
    ctx.strokeStyle = barGrad;
    ctx.lineWidth = ts * 0.065;
    ctx.stroke();
    const tongJaw = { x: barStart.x - ts * 0.02, y: barStart.y };
    inkedLine(
      ctx,
      tongJaw,
      { x: right - ts * 0.02, y: barStart.y + ts * 0.3 },
      ts * 0.035,
      sampleRamp(STEEL, 0.35),
      ts,
    );
    inkedLine(
      ctx,
      tongJaw,
      { x: right - ts * 0.08, y: barStart.y + ts * 0.34 },
      ts * 0.035,
      sampleRamp(STEEL, 0.35),
      ts,
    );

    // Hearth front: brick, an ash-pit arch at its foot with embers fallen through.
    const frontH = box.bottom - inset - hearthFrontTop;
    paintBrickFace(ctx, left, hearthFrontTop, right - left, frontH, ts, forkRng(rng));
    const frontShade = ctx.createLinearGradient(left, 0, right, 0);
    frontShade.addColorStop(0, rgba(HEAT_ORANGE, 0.12));
    frontShade.addColorStop(0.7, rgba(SOOT, 0));
    frontShade.addColorStop(1, rgba(SOOT, 0.3));
    ctx.fillStyle = frontShade;
    ctx.fillRect(left, hearthFrontTop, right - left, frontH);
    ctx.beginPath();
    ctx.rect(left, hearthFrontTop, right - left, frontH);
    inkOutline(ctx, ts);
    const pitW = ts * 0.7;
    const pitLeft = potCx - pitW / 2;
    const pitBottom = box.bottom - inset;
    const pitTop = hearthFrontTop + frontH * 0.35;
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(pitLeft, pitBottom);
    ctx.lineTo(pitLeft, pitTop + ts * 0.1);
    ctx.quadraticCurveTo(potCx, pitTop - ts * 0.08, pitLeft + pitW, pitTop + ts * 0.1);
    ctx.lineTo(pitLeft + pitW, pitBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    glow(ctx, potCx, pitBottom - ts * 0.04, ts * 0.32, HEAT_ORANGE, 0.8);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = rgb(i % 2 === 0 ? HEAT_YELLOW : HEAT_ORANGE);
      ctx.fillRect(
        pitLeft + pitW * (0.15 + i * 0.17),
        pitBottom - ts * (0.05 + coalRng() * 0.04),
        2,
        2,
      );
    }
    // Stone coping along the hearth front's top edge.
    outlinedRect(
      ctx,
      left - 1,
      hearthFrontTop - ts * 0.03,
      right - left + 2,
      ts * 0.07,
      sampleRamp(stoneRamp(), 0.62),
      ts,
    );
    // The tuyère stub on the west flank, where the bellows' nozzle feeds in.
    outlinedRect(
      ctx,
      box.left,
      hearthFrontTop - ts * 0.2,
      ts * 0.22,
      ts * 0.12,
      sampleRamp(STEEL, 0.3),
      ts,
    );

    // A poker and a rake hung off the hood's east corner.
    const hookX = right - ts * 0.22;
    inkedLine(
      ctx,
      { x: hookX, y: hoodLipY + ts * 0.02 },
      { x: hookX - ts * 0.02, y: hearthBackY + ts * 0.34 },
      ts * 0.03,
      sampleRamp(STEEL, 0.4),
      ts,
    );
    inkedLine(
      ctx,
      { x: hookX + ts * 0.1, y: hoodLipY + ts * 0.02 },
      { x: hookX + ts * 0.12, y: hearthBackY + ts * 0.3 },
      ts * 0.03,
      sampleRamp(STEEL, 0.4),
      ts,
    );
    outlinedRect(
      ctx,
      hookX + ts * 0.05,
      hearthBackY + ts * 0.28,
      ts * 0.14,
      ts * 0.04,
      sampleRamp(STEEL, 0.4),
      ts,
    );
    // Sparks hanging in the air under the hood.
    for (let i = 0; i < 9; i++) {
      const sx = potCx + jitter(coalRng, ts * 0.8);
      const sy = potCy - ts * (0.35 + coalRng() * 0.7);
      ctx.fillStyle = rgba(i % 3 === 0 ? HEAT_WHITE : HEAT_YELLOW, 0.9);
      ctx.fillRect(sx, sy, 2, 2);
    }
  });
}

// ── The bellows ─────────────────────────────────────────────────────────────

/**
 * A great double bellows slung in a timber frame: a leaf-shaped leather
 * body between two iron-studded boards, narrowing east to a brass nozzle
 * that meets the forge's tuyère, and a long rocker pole overhead with a
 * chain down to the top board and a worn grip at its end. Two tiles square
 * so it fills the corner between the forge and the wall.
 */
export function paintSmithBellows(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng) {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.36);

    // The rocker: a post against the wall, a pole pivoting on it.
    const postX = box.left + ts * 0.45;
    const postTop = box.top - ts * 0.55;
    outlinedRect(
      ctx,
      postX - ts * 0.08,
      postTop,
      ts * 0.16,
      box.bottom - ts * 0.5 - postTop,
      sampleRamp(wood, 0.4),
      ts,
    );
    ctx.fillStyle = rgba(wood.light, 0.6);
    ctx.fillRect(postX - ts * 0.06, postTop, ts * 0.03, box.bottom - ts * 0.5 - postTop);
    const pivot = { x: postX, y: postTop + ts * 0.12 };
    const poleEast = { x: box.right - ts * 0.18, y: pivot.y + ts * 0.3 };
    const poleWest = { x: box.left + ts * 0.06, y: pivot.y - ts * 0.08 };
    inkedLine(ctx, poleWest, poleEast, ts * 0.08, sampleRamp(wood, 0.55), ts);
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.7));
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, ts * 0.04, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    // Grip rag bound round the pole's west end.
    outlinedRect(ctx, poleWest.x, poleWest.y - ts * 0.06, ts * 0.16, ts * 0.12, CLOTH_RED, ts);

    // Body geometry.
    const bodyCy = box.bottom - ts * 0.78;
    const tailX = box.left + ts * 0.12;
    const noseX = box.right - ts * 0.34;
    const halfH = ts * 0.34;
    const bodyPts = (h: number): Pt[] => [
      { x: tailX, y: bodyCy - h * 0.15 },
      { x: tailX + ts * 0.15, y: bodyCy - h },
      { x: tailX + ts * 0.7, y: bodyCy - h * 1.02 },
      { x: noseX, y: bodyCy - h * 0.3 },
      { x: noseX, y: bodyCy + h * 0.3 },
      { x: tailX + ts * 0.7, y: bodyCy + h * 1.02 },
      { x: tailX + ts * 0.15, y: bodyCy + h },
      { x: tailX, y: bodyCy + h * 0.15 },
    ];

    // Trestle legs under the body.
    for (const lx of [tailX + ts * 0.3, noseX - ts * 0.25]) {
      outlinedRect(
        ctx,
        lx - ts * 0.05,
        bodyCy,
        ts * 0.1,
        box.bottom - ts * 0.08 - bodyCy,
        sampleRamp(wood, 0.3),
        ts,
      );
    }
    outlinedRect(
      ctx,
      tailX + ts * 0.2,
      box.bottom - ts * 0.3,
      noseX - tailX - ts * 0.35,
      ts * 0.07,
      sampleRamp(wood, 0.35),
      ts,
    );

    // Leather body with its fold ribs.
    polygon(ctx, bodyPts(halfH));
    const leather = ctx.createLinearGradient(0, bodyCy - halfH, 0, bodyCy + halfH);
    leather.addColorStop(0, rgb(sampleRamp(LEATHER, 0.75)));
    leather.addColorStop(0.5, rgb(sampleRamp(LEATHER, 0.45)));
    leather.addColorStop(1, rgb(sampleRamp(LEATHER, 0.15)));
    ctx.fillStyle = leather;
    ctx.fill();
    inkOutline(ctx, ts);
    const ribs = 4;
    for (let i = 1; i <= ribs; i++) {
      const h = halfH * (1 - i / (ribs + 1)) + jitter(rng, 1);
      polygon(ctx, bodyPts(halfH - (halfH - h) * 0.9));
      ctx.strokeStyle = rgba(LEATHER.shadow, 0.7);
      ctx.lineWidth = Math.max(1, ts * 0.025);
      ctx.stroke();
    }
    // The two boards, seen edge-on above and below, studded along their rims.
    const boardRy = ts * 0.06;
    for (const side of [-1, 1]) {
      const by = bodyCy + side * halfH * 0.98;
      ctx.fillStyle = rgb(sampleRamp(wood, side < 0 ? 0.7 : 0.35));
      ctx.beginPath();
      ctx.moveTo(tailX + ts * 0.1, by - boardRy);
      ctx.lineTo(noseX - ts * 0.1, by - boardRy + side * ts * 0.12);
      ctx.lineTo(noseX - ts * 0.1, by + boardRy + side * ts * 0.12);
      ctx.lineTo(tailX + ts * 0.1, by + boardRy);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      for (let s = 0; s < 6; s++) {
        const t = (s + 0.5) / 6;
        const sx = tailX + ts * 0.1 + (noseX - tailX - ts * 0.2) * t;
        const sy = by + side * ts * 0.12 * t;
        ctx.fillStyle = rgb(BRASS);
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }
    // Chain from the pole down to the top board.
    const chainX = tailX + ts * 0.95;
    const chainTop =
      pivot.y + ((chainX - pivot.x) / (poleEast.x - pivot.x)) * (poleEast.y - pivot.y);
    ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.55));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    for (let y = chainTop; y < bodyCy - halfH; y += ts * 0.06) {
      ctx.beginPath();
      ctx.ellipse(chainX, y + ts * 0.03, ts * 0.018, ts * 0.03, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Brass-bound nozzle meeting the forge.
    fillPolygon(
      ctx,
      [
        { x: noseX - ts * 0.04, y: bodyCy - ts * 0.1 },
        { x: box.right, y: bodyCy - ts * 0.05 },
        { x: box.right, y: bodyCy + ts * 0.05 },
        { x: noseX - ts * 0.04, y: bodyCy + ts * 0.1 },
      ],
      BRASS_DARK,
      ts,
    );
    ctx.fillStyle = rgb(BRASS);
    ctx.fillRect(noseX, bodyCy - ts * 0.07, box.right - noseX, ts * 0.03);
    // A bucket of water at the frame's foot, for dousing the leather.
    const bucketX = box.right - ts * 0.55;
    const bucketTop = box.bottom - ts * 0.38;
    fillPolygon(
      ctx,
      [
        { x: bucketX - ts * 0.17, y: bucketTop },
        { x: bucketX + ts * 0.17, y: bucketTop },
        { x: bucketX + ts * 0.14, y: box.bottom - ts * 0.06 },
        { x: bucketX - ts * 0.14, y: box.bottom - ts * 0.06 },
      ],
      sampleRamp(wood, 0.45),
      ts,
    );
    outlinedRect(
      ctx,
      bucketX - ts * 0.16,
      bucketTop + ts * 0.08,
      ts * 0.32,
      ts * 0.035,
      sampleRamp(STEEL, 0.4),
      ts * 0.6,
    );
    ctx.fillStyle = rgb(QUENCH_WATER);
    ctx.beginPath();
    ctx.ellipse(bucketX, bucketTop, ts * 0.15, ts * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ── The anvil ───────────────────────────────────────────────────────────────

/**
 * The anvil, side-on so its whole silhouette reads: a long horn tapering
 * west, a flat face with the dish worn deep into it, a heel with its hardy
 * hole, a waisted body flaring to broad feet — on a stump banded with iron.
 * A cross-peen hammer rests on the face; a pair of tongs leans on the
 * stump; a scatter of scale lies black around its foot.
 */
export function paintAnvil(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(
      ctx,
      box.centreX + ts * 0.1,
      box.bottom - ts * 0.12,
      ts * 0.72,
      ts * 0.17,
      0.42,
    );

    // Scale flakes on the floor round the stump.
    const scaleRng = forkRng(rng);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = rgba(SOOT, 0.7);
      ctx.fillRect(
        box.left + ts * 0.2 + scaleRng() * (box.width - ts * 0.4),
        box.bottom - ts * (0.06 + scaleRng() * 0.14),
        2 + scaleRng() * 2,
        2,
      );
    }

    // The stump: a short log, rings on its top, two iron bands.
    const stumpCx = box.centreX + ts * 0.12;
    const stumpW = ts * 0.9;
    const stumpBottom = box.bottom - ts * 0.08;
    const stumpTop = box.bottom - ts * 0.5;
    const stumpRy = ts * 0.1;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.beginPath();
    ctx.moveTo(stumpCx - stumpW / 2, stumpTop);
    ctx.lineTo(stumpCx - stumpW / 2 - ts * 0.04, stumpBottom);
    ctx.ellipse(stumpCx, stumpBottom, stumpW / 2 + ts * 0.04, stumpRy, 0, Math.PI, 0, true);
    ctx.lineTo(stumpCx + stumpW / 2, stumpTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(wood.shadow, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (let i = 0; i < 5; i++) {
      const bx = stumpCx - stumpW * 0.4 + (stumpW * 0.8 * i) / 4 + jitter(rng, ts * 0.02);
      ctx.beginPath();
      ctx.moveTo(bx, stumpTop + ts * 0.06);
      ctx.lineTo(bx + jitter(rng, ts * 0.02), stumpBottom);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(wood.light, 0.35);
    ctx.fillRect(stumpCx - stumpW / 2 + ts * 0.04, stumpTop, ts * 0.08, stumpBottom - stumpTop);
    for (const t of [0.3, 0.78]) {
      const by = stumpTop + (stumpBottom - stumpTop) * t;
      outlinedRect(
        ctx,
        stumpCx - stumpW / 2 - ts * 0.02,
        by,
        stumpW + ts * 0.04,
        ts * 0.05,
        sampleRamp(STEEL, 0.35),
        ts * 0.7,
      );
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.beginPath();
    ctx.ellipse(stumpCx, stumpTop, stumpW / 2, stumpRy, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);

    // Tongs leaning on the stump's east side.
    const tongsTop = { x: stumpCx + stumpW / 2 + ts * 0.14, y: stumpTop - ts * 0.18 };
    inkedLine(
      ctx,
      tongsTop,
      { x: stumpCx + stumpW / 2 + ts * 0.26, y: stumpBottom },
      ts * 0.035,
      sampleRamp(STEEL, 0.4),
      ts,
    );
    inkedLine(
      ctx,
      { x: tongsTop.x + ts * 0.04, y: tongsTop.y },
      { x: stumpCx + stumpW / 2 + ts * 0.34, y: stumpBottom - ts * 0.02 },
      ts * 0.035,
      sampleRamp(STEEL, 0.4),
      ts,
    );

    // The anvil body.
    const feetY = stumpTop + ts * 0.02;
    const faceY = feetY - ts * 0.5;
    const faceLeft = box.left + ts * 0.62;
    const faceRight = box.right - ts * 0.18;
    const waistL = stumpCx - ts * 0.22;
    const waistR = stumpCx + ts * 0.26;
    const hornTip = { x: box.left + ts * 0.06, y: faceY + ts * 0.12 };
    const faceThick = ts * 0.16;
    const bodyPts: Pt[] = [
      hornTip,
      { x: faceLeft - ts * 0.2, y: faceY + ts * 0.01 },
      { x: faceLeft, y: faceY },
      { x: faceRight, y: faceY },
      { x: faceRight, y: faceY + faceThick },
      { x: faceRight - ts * 0.1, y: faceY + faceThick + ts * 0.06 },
      { x: waistR, y: faceY + faceThick + ts * 0.1 },
      { x: waistR, y: feetY - ts * 0.12 },
      { x: waistR + ts * 0.2, y: feetY - ts * 0.02 },
      { x: waistR + ts * 0.22, y: feetY },
      { x: waistL - ts * 0.22, y: feetY },
      { x: waistL - ts * 0.2, y: feetY - ts * 0.02 },
      { x: waistL, y: feetY - ts * 0.12 },
      { x: waistL, y: faceY + faceThick + ts * 0.1 },
      { x: faceLeft - ts * 0.05, y: faceY + faceThick + ts * 0.04 },
      { x: faceLeft - ts * 0.3, y: faceY + ts * 0.16 },
    ];
    polygon(ctx, bodyPts);
    const steelGrad = ctx.createLinearGradient(0, faceY, 0, feetY);
    steelGrad.addColorStop(0, rgb(sampleRamp(STEEL, 0.58)));
    steelGrad.addColorStop(0.35, rgb(sampleRamp(STEEL, 0.36)));
    steelGrad.addColorStop(1, rgb(sampleRamp(STEEL, 0.14)));
    ctx.fillStyle = steelGrad;
    ctx.fill();
    inkOutline(ctx, ts);
    // Lit west-facing planes: the horn's upper curve and the body's west flank.
    ctx.fillStyle = rgba(STEEL.accent, 0.45);
    polygon(ctx, [
      hornTip,
      { x: faceLeft - ts * 0.2, y: faceY + ts * 0.01 },
      { x: faceLeft - ts * 0.2, y: faceY + ts * 0.06 },
      { x: hornTip.x + ts * 0.1, y: hornTip.y + ts * 0.01 },
    ]);
    ctx.fill();
    ctx.fillRect(
      waistL + ts * 0.01,
      faceY + faceThick + ts * 0.1,
      ts * 0.05,
      feetY - faceY - faceThick - ts * 0.24,
    );
    // Side seam under the face plate.
    ctx.strokeStyle = rgba(TOWN_INK, 0.55);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(faceLeft, faceY + faceThick);
    ctx.lineTo(faceRight - ts * 0.02, faceY + faceThick);
    ctx.stroke();

    // The face seen from just above: a lit strip, the dish worn into it.
    const faceTopH = ts * 0.12;
    fillPolygon(
      ctx,
      [
        { x: faceLeft, y: faceY },
        { x: faceLeft + ts * 0.05, y: faceY - faceTopH },
        { x: faceRight - ts * 0.02, y: faceY - faceTopH },
        { x: faceRight, y: faceY },
      ],
      sampleRamp(STEEL, 0.82),
      ts,
    );
    const dishCx = (faceLeft + faceRight) / 2 - ts * 0.04;
    const dishCy = faceY - faceTopH / 2;
    const dish = ctx.createRadialGradient(
      dishCx,
      dishCy + faceTopH * 0.2,
      0,
      dishCx,
      dishCy,
      ts * 0.28,
    );
    dish.addColorStop(0, rgb(sampleRamp(STEEL, 0.28)));
    dish.addColorStop(0.7, rgb(sampleRamp(STEEL, 0.5)));
    dish.addColorStop(1, rgba(sampleRamp(STEEL, 0.82), 0));
    ctx.fillStyle = dish;
    ctx.beginPath();
    ctx.ellipse(dishCx, dishCy, ts * 0.28, faceTopH * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // Polished near lip of the dish, bright where the hammer rings.
    ctx.strokeStyle = rgb(STEEL.accent);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.ellipse(dishCx, dishCy, ts * 0.28, faceTopH * 0.42, 0, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
    // Hardy and pritchel holes on the heel.
    ctx.fillStyle = rgb(SOOT);
    ctx.fillRect(faceRight - ts * 0.16, faceY - faceTopH * 0.7, ts * 0.07, faceTopH * 0.45);
    ctx.beginPath();
    ctx.arc(faceRight - ts * 0.26, faceY - faceTopH * 0.48, ts * 0.022, 0, Math.PI * 2);
    ctx.fill();

    // A hammer laid across the face, its head on the heel.
    paintHammer(
      ctx,
      { x: faceRight - ts * 0.4, y: faceY - faceTopH * 0.9 },
      Math.PI * 0.93,
      ts * 0.62,
      ts * 0.22,
      ts,
    );
  });
}

// ── The tool wall ───────────────────────────────────────────────────────────

/**
 * A board of pegs across the wall with the smith's own kit on it — sledge,
 * cross-peen and rounding hammers, three pairs of tongs, files, punches
 * and chisels, a string of horseshoes — over a low bench of fullers and
 * swages set in a block. Variant 1 swaps the bench for a rack of hardies
 * and a bucket of rods.
 */
export function paintSmithToolWall(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng) {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();

    const boardTop = box.top - ts * 0.78;
    const boardBottom = box.top + ts * 0.3;
    const boardLeft = box.left + ts * 0.06;
    const boardRight = box.right - ts * 0.06;
    paintPlankBoard(
      ctx,
      boardLeft,
      boardTop,
      boardRight - boardLeft,
      boardBottom - boardTop,
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: ts * 0.34,
        ramp: OAK,
      },
    );
    ctx.fillStyle = rgba(SOOT, 0.2);
    ctx.fillRect(boardLeft, boardTop, boardRight - boardLeft, boardBottom - boardTop);
    ctx.beginPath();
    ctx.rect(boardLeft, boardTop, boardRight - boardLeft, boardBottom - boardTop);
    inkOutline(ctx, ts);
    // Two rails of pegs.
    const railY1 = boardTop + ts * 0.12;
    const railY2 = boardTop + ts * 0.62;
    for (const ry of [railY1, railY2]) {
      outlinedRect(
        ctx,
        boardLeft,
        ry - ts * 0.03,
        boardRight - boardLeft,
        ts * 0.06,
        sampleRamp(wood, 0.3),
        ts * 0.7,
      );
    }

    // Upper rail: tools hung by their heads.
    const span = boardRight - boardLeft;
    const toolRng = forkRng(rng);
    const slots = Math.round(span / (ts * 0.34));
    for (let i = 0; i < slots; i++) {
      const x = boardLeft + (span * (i + 0.5)) / slots;
      const kind = (i + variant * 2) % 6;
      if (kind === 0)
        paintHammer(ctx, { x, y: railY1 + ts * 0.07 }, Math.PI / 2, ts * 0.44, ts * 0.27, ts);
      else if (kind === 1) paintTongs(ctx, { x, y: railY1 }, ts * 0.5, ts, 1.5);
      else if (kind === 2) {
        inkedLine(
          ctx,
          { x, y: railY1 },
          { x, y: railY1 + ts * 0.36 },
          ts * 0.045,
          sampleRamp(STEEL, 0.55),
          ts,
          'butt',
        );
        outlinedRect(
          ctx,
          x - ts * 0.03,
          railY1 - ts * 0.02,
          ts * 0.06,
          ts * 0.12,
          sampleRamp(wood, 0.6),
          ts * 0.7,
        );
      } else if (kind === 3)
        paintHammer(ctx, { x, y: railY1 + ts * 0.06 }, Math.PI / 2, ts * 0.4, ts * 0.22, ts);
      else if (kind === 4) paintTongs(ctx, { x, y: railY1 }, ts * 0.46, ts, 2.2);
      else {
        // A sledge, bigger than everything else on the board.
        paintHammer(ctx, { x, y: railY1 + ts * 0.09 }, Math.PI / 2, ts * 0.46, ts * 0.32, ts);
      }
      ctx.fillStyle = rgb(sampleRamp(wood, 0.8));
      ctx.fillRect(x - 1.5, railY1 - 1.5, 3, 3);
    }

    // Lower rail: horseshoes, punches and chisels.
    const lowSlots = Math.round(span / (ts * 0.26));
    for (let i = 0; i < lowSlots; i++) {
      const x = boardLeft + (span * (i + 0.5)) / lowSlots;
      if ((i + variant) % 3 === 0) {
        inkedLine(
          ctx,
          { x, y: railY2 },
          { x: x + jitter(toolRng, ts * 0.02), y: railY2 + ts * 0.22 },
          ts * 0.04,
          sampleRamp(STEEL, 0.5),
          ts,
          'butt',
        );
      } else {
        paintHorseshoe(ctx, x, railY2 + ts * 0.15, ts * 0.09, ts);
      }
    }

    // A low bench against the wall with the swage block and bottom tools.
    const benchTop = box.bottom - ts * 0.46;
    const benchLeft = box.left + ts * 0.08;
    const benchRight = box.right - ts * 0.08;
    for (const lx of [benchLeft + ts * 0.08, benchRight - ts * 0.16]) {
      outlinedRect(
        ctx,
        lx,
        benchTop,
        ts * 0.08,
        box.bottom - ts * 0.06 - benchTop,
        sampleRamp(wood, 0.25),
        ts,
      );
    }
    bandShadow(ctx, box, ts, 0.25);
    outlinedRect(
      ctx,
      benchLeft,
      benchTop,
      benchRight - benchLeft,
      ts * 0.1,
      sampleRamp(wood, 0.55),
      ts,
    );
    ctx.fillStyle = rgba(wood.accent, 0.6);
    ctx.fillRect(benchLeft, benchTop, benchRight - benchLeft, ts * 0.025);
    const itemsY = benchTop;
    const blockW = ts * 0.5;
    const blockX = benchLeft + (variant === 0 ? ts * 0.2 : span - ts * 0.9);
    outlinedRect(ctx, blockX, itemsY - ts * 0.24, blockW, ts * 0.24, sampleRamp(STEEL, 0.28), ts);
    ctx.fillStyle = rgb(SOOT);
    for (let i = 0; i < 3; i++)
      ctx.fillRect(blockX + ts * (0.07 + i * 0.14), itemsY - ts * 0.16, ts * 0.07, ts * 0.08);
    ctx.fillStyle = rgba(STEEL.accent, 0.5);
    ctx.fillRect(blockX, itemsY - ts * 0.24, blockW, 2);
    // A bucket of rods and a stack of fullers along the bench.
    const bucketX = variant === 0 ? benchRight - ts * 0.45 : benchLeft + ts * 0.4;
    for (let r = 0; r < 5; r++) {
      inkedLine(
        ctx,
        { x: bucketX - ts * 0.08 + r * ts * 0.04, y: itemsY - ts * 0.2 },
        { x: bucketX - ts * 0.1 + r * ts * 0.05, y: itemsY - ts * (0.48 + (r % 2) * 0.08) },
        ts * 0.025,
        sampleRamp(STEEL, 0.45),
        ts * 0.5,
      );
    }
    fillPolygon(
      ctx,
      [
        { x: bucketX - ts * 0.15, y: itemsY - ts * 0.24 },
        { x: bucketX + ts * 0.15, y: itemsY - ts * 0.24 },
        { x: bucketX + ts * 0.12, y: itemsY },
        { x: bucketX - ts * 0.12, y: itemsY },
      ],
      sampleRamp(STEEL, 0.3),
      ts,
    );
    for (let i = 0; i < 3; i++) {
      const fx = (blockX + blockW + bucketX) / 2 - ts * 0.12 + i * ts * 0.12;
      outlinedRect(
        ctx,
        fx,
        itemsY - ts * 0.14,
        ts * 0.08,
        ts * 0.14,
        sampleRamp(STEEL, 0.4 + i * 0.08),
        ts * 0.7,
      );
    }
  });
}

// ── Stock ───────────────────────────────────────────────────────────────────

/**
 * Iron stock stood on end in a timber rack against the wall — round rod,
 * square bar and flat strap in bundles of different heights, a couple of
 * plates leaning in front — the raw material everything else in the room
 * is made from.
 */
export function paintBarStock(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.3);
    // The rack: two uprights and a top rail with slotted dividers.
    const railY = box.top - ts * 0.35;
    for (const px of [box.left + ts * 0.08, box.right - ts * 0.18]) {
      outlinedRect(
        ctx,
        px,
        railY - ts * 0.08,
        ts * 0.1,
        box.bottom - ts * 0.04 - railY + ts * 0.08,
        sampleRamp(wood, 0.35),
        ts,
      );
    }
    const rodRng = forkRng(rng);
    const count = Math.round(box.width / (ts * 0.065));
    for (let i = 0; i < count; i++) {
      const x = box.left + ts * 0.22 + ((box.width - ts * 0.44) * i) / (count - 1);
      const topY = box.top - ts * (0.35 + rodRng() * 0.5);
      const shade = 0.25 + rodRng() * 0.45;
      const width = ts * (0.035 + (i % 3) * 0.012);
      inkedLine(
        ctx,
        { x, y: topY },
        { x: x + jitter(rodRng, ts * 0.02), y: box.bottom - ts * 0.1 },
        width,
        sampleRamp(STEEL, shade),
        ts * 0.6,
        'butt',
      );
      ctx.fillStyle = rgba(STEEL.accent, 0.6);
      ctx.fillRect(x - width / 2, topY, Math.max(1, width * 0.35), ts * 0.3);
    }
    outlinedRect(
      ctx,
      box.left + ts * 0.08,
      railY - ts * 0.04,
      box.width - ts * 0.16,
      ts * 0.08,
      sampleRamp(wood, 0.55),
      ts,
    );
    outlinedRect(
      ctx,
      box.left + ts * 0.08,
      box.bottom - ts * 0.34,
      box.width - ts * 0.16,
      ts * 0.07,
      sampleRamp(wood, 0.45),
      ts,
    );
    // Plates leaning against the foot of the rack.
    for (let p = 0; p < 2; p++) {
      const px = box.left + ts * (0.3 + p * 0.7);
      fillPolygon(
        ctx,
        [
          { x: px, y: box.bottom - ts * 0.06 },
          { x: px + ts * 0.08, y: box.bottom - ts * 0.5 },
          { x: px + ts * 0.5, y: box.bottom - ts * 0.48 },
          { x: px + ts * 0.46, y: box.bottom - ts * 0.06 },
        ],
        sampleRamp(STEEL, 0.4 + p * 0.1),
        ts,
      );
      ctx.fillStyle = rgba(HEAT_RED, 0.18);
      ctx.fillRect(px + ts * 0.1, box.bottom - ts * 0.4, ts * 0.25, ts * 0.2);
    }
  });
}

/** Coal tipped out on the floor beside the forge, a shovel driven into the heap and a scuttle beside it. */
export function paintCoalHeap(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.12,
      box.width * 0.46,
      ts * 0.16,
      0.4,
    );
    const heapRng = forkRng(rng);
    paintCoalLumps(
      ctx,
      box.left + box.width * 0.42,
      box.bottom - ts * 0.1,
      box.width * 0.4,
      ts * 0.52,
      ts,
      heapRng,
      60,
    );
    // Shovel.
    const bladeTop = box.bottom - ts * 0.55;
    inkedLine(
      ctx,
      { x: box.left + box.width * 0.52, y: bladeTop },
      { x: box.left + box.width * 0.72, y: box.top - ts * 0.35 },
      ts * 0.05,
      sampleRamp(woodRamp(), 0.6),
      ts,
    );
    fillPolygon(
      ctx,
      [
        { x: box.left + box.width * 0.44, y: bladeTop - ts * 0.05 },
        { x: box.left + box.width * 0.56, y: bladeTop - ts * 0.08 },
        { x: box.left + box.width * 0.54, y: bladeTop + ts * 0.18 },
        { x: box.left + box.width * 0.44, y: bladeTop + ts * 0.2 },
      ],
      sampleRamp(STEEL, 0.5),
      ts,
    );
    outlinedRect(
      ctx,
      box.left + box.width * 0.69,
      box.top - ts * 0.4,
      ts * 0.12,
      ts * 0.06,
      sampleRamp(woodRamp(), 0.5),
      ts * 0.7,
    );
    // Scuttle.
    const sx = box.right - ts * 0.34;
    const sTop = box.bottom - ts * 0.42;
    fillPolygon(
      ctx,
      [
        { x: sx - ts * 0.22, y: sTop + ts * 0.06 },
        { x: sx + ts * 0.24, y: sTop - ts * 0.04 },
        { x: sx + ts * 0.2, y: box.bottom - ts * 0.08 },
        { x: sx - ts * 0.2, y: box.bottom - ts * 0.08 },
      ],
      sampleRamp(STEEL, 0.32),
      ts,
    );
    paintCoalLumps(ctx, sx, sTop + ts * 0.06, ts * 0.2, ts * 0.12, ts, heapRng, 10);
    ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.6));
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.arc(sx, sTop, ts * 0.16, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  });
}

// ── The workbench ───────────────────────────────────────────────────────────

/**
 * The fitting bench: a heavy three-tile bench with a tall leg vice bolted
 * to its west end (the leg runs down to the floor, the screw handle across
 * its jaws), and on the top the job in hand — a helm half-riveted, files,
 * a hammer, a tin of rivets, a row of finished hinges — with bar ends and a
 * bucket on the shelf beneath.
 */
export function paintViceBench(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.35);
    const topFront = box.bottom - ts * 0.52;
    const topBack = topFront - ts * 0.3;
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;

    // Legs and the undershelf.
    for (const lx of [left + ts * 0.3, right - ts * 0.14, box.centreX]) {
      outlinedRect(
        ctx,
        lx - ts * 0.05,
        topFront,
        ts * 0.1,
        box.bottom - ts * 0.06 - topFront,
        sampleRamp(wood, 0.25),
        ts,
      );
    }
    const shelfY = box.bottom - ts * 0.2;
    outlinedRect(
      ctx,
      left + ts * 0.25,
      shelfY,
      right - left - ts * 0.35,
      ts * 0.06,
      sampleRamp(wood, 0.35),
      ts,
    );
    const shelfRng = forkRng(rng);
    for (let i = 0; i < 6; i++) {
      inkedLine(
        ctx,
        { x: left + ts * 0.5, y: shelfY - ts * (0.02 + i * 0.035) },
        { x: left + ts * 1.25 + jitter(shelfRng, ts * 0.05), y: shelfY - ts * (0.02 + i * 0.035) },
        ts * 0.03,
        sampleRamp(STEEL, 0.3 + (i % 2) * 0.15),
        ts * 0.5,
      );
    }
    const bucketX = right - ts * 0.6;
    fillPolygon(
      ctx,
      [
        { x: bucketX - ts * 0.15, y: shelfY - ts * 0.24 },
        { x: bucketX + ts * 0.15, y: shelfY - ts * 0.24 },
        { x: bucketX + ts * 0.12, y: shelfY },
        { x: bucketX - ts * 0.12, y: shelfY },
      ],
      sampleRamp(wood, 0.45),
      ts,
    );

    // The top: plank surface seen from above, a thick lit front edge.
    const topPts: Pt[] = [
      { x: left, y: topFront },
      { x: left + ts * 0.06, y: topBack },
      { x: right - ts * 0.06, y: topBack },
      { x: right, y: topFront },
    ];
    ctx.save();
    polygon(ctx, topPts);
    ctx.clip();
    paintPlankBoard(ctx, left, topBack, right - left, topFront - topBack, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.1,
      ramp: wood,
    });
    ctx.fillStyle = rgba(SOOT, 0.18);
    ctx.fillRect(left, topBack, right - left, topFront - topBack);
    ctx.restore();
    polygon(ctx, topPts);
    inkOutline(ctx, ts);
    outlinedRect(ctx, left, topFront, right - left, ts * 0.12, sampleRamp(wood, 0.5), ts);
    ctx.fillStyle = rgba(wood.accent, 0.7);
    ctx.fillRect(left, topFront, right - left, ts * 0.025);

    // The leg vice at the west end.
    const viceX = left + ts * 0.14;
    const jawTop = topBack - ts * 0.34;
    outlinedRect(
      ctx,
      viceX - ts * 0.07,
      jawTop,
      ts * 0.14,
      box.bottom - ts * 0.06 - jawTop,
      sampleRamp(STEEL, 0.3),
      ts,
    );
    ctx.fillStyle = rgba(STEEL.accent, 0.5);
    ctx.fillRect(viceX - ts * 0.06, jawTop, ts * 0.03, box.bottom - ts * 0.1 - jawTop);
    outlinedRect(
      ctx,
      viceX - ts * 0.1,
      jawTop - ts * 0.04,
      ts * 0.2,
      ts * 0.1,
      sampleRamp(STEEL, 0.5),
      ts,
    );
    const screwY = jawTop + ts * 0.2;
    inkedLine(
      ctx,
      { x: viceX - ts * 0.04, y: screwY - ts * 0.16 },
      { x: viceX + ts * 0.02, y: screwY + ts * 0.16 },
      ts * 0.03,
      sampleRamp(STEEL, 0.65),
      ts,
    );
    for (const end of [-1, 1]) {
      ctx.fillStyle = rgb(sampleRamp(STEEL, 0.6));
      ctx.beginPath();
      ctx.arc(
        viceX - ts * 0.01 + end * ts * 0.03,
        screwY + end * ts * 0.16,
        ts * 0.03,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // The job on the bench.
    const surfaceY = (topFront + topBack) / 2 + ts * 0.06;
    paintHelm(ctx, left + ts * 0.8, surfaceY, ts * 0.2, ts);
    paintHammer(
      ctx,
      { x: left + ts * 1.3, y: surfaceY - ts * 0.04 },
      -Math.PI * 0.05,
      ts * 0.4,
      ts * 0.18,
      ts,
    );
    for (let f = 0; f < 3; f++) {
      inkedLine(
        ctx,
        { x: box.centreX + ts * (0.1 + f * 0.05), y: surfaceY - ts * 0.08 + f * ts * 0.05 },
        { x: box.centreX + ts * (0.55 + f * 0.05), y: surfaceY - ts * 0.1 + f * ts * 0.05 },
        ts * 0.03,
        sampleRamp(STEEL, 0.55),
        ts * 0.5,
      );
    }
    // A tin of rivets.
    const tinX = right - ts * 0.75;
    outlinedRect(
      ctx,
      tinX,
      surfaceY - ts * 0.12,
      ts * 0.2,
      ts * 0.12,
      sampleRamp(STEEL, 0.4),
      ts * 0.7,
    );
    ctx.fillStyle = rgb(BRASS);
    for (let i = 0; i < 4; i++)
      ctx.fillRect(tinX + ts * (0.03 + i * 0.04), surfaceY - ts * 0.13, 2, 2);
    // Finished hinges laid in a row.
    for (let i = 0; i < 2; i++) {
      const hx = right - ts * 0.45 + i * ts * 0.18;
      outlinedRect(
        ctx,
        hx,
        surfaceY - ts * 0.14,
        ts * 0.06,
        ts * 0.16,
        sampleRamp(STEEL, 0.35),
        ts * 0.7,
      );
      outlinedRect(
        ctx,
        hx - ts * 0.02,
        surfaceY - ts * 0.16,
        ts * 0.1,
        ts * 0.04,
        sampleRamp(STEEL, 0.5),
        ts * 0.7,
      );
    }
  });
}

// ── The shop ────────────────────────────────────────────────────────────────

/**
 * Varga's shop counter: a dark-oak top on a front of iron-strapped boards,
 * her finished work set out on it — horseshoes stacked by size, a knife
 * roll opened to show its blades, a helm on a block, a keg of nails, a
 * brass bell — and a row of hinges and keys hung off the front apron where
 * a customer's eye falls first.
 */
export function paintSmithCounter(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng) {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.38);
    const left = box.left + ts * 0.04;
    const right = box.right - ts * 0.04;
    const topFront = box.bottom - ts * 0.62;
    const topBack = topFront - ts * 0.26;

    // The front: vertical oak boards with iron straps across them.
    paintPlankBoard(
      ctx,
      left,
      topFront,
      right - left,
      box.bottom - ts * 0.04 - topFront,
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: ts * 0.24,
        ramp: OAK,
      },
    );
    const frontShade = ctx.createLinearGradient(0, topFront, 0, box.bottom);
    frontShade.addColorStop(0, rgba(SOOT, 0));
    frontShade.addColorStop(1, rgba(SOOT, 0.35));
    ctx.fillStyle = frontShade;
    ctx.fillRect(left, topFront, right - left, box.bottom - topFront);
    ctx.beginPath();
    ctx.rect(left, topFront, right - left, box.bottom - ts * 0.04 - topFront);
    inkOutline(ctx, ts);
    for (const t of [0.35, 0.8]) {
      const sy = topFront + (box.bottom - topFront) * t;
      outlinedRect(ctx, left, sy, right - left, ts * 0.05, sampleRamp(STEEL, 0.3), ts * 0.6);
      for (let i = 0; i < Math.round((right - left) / (ts * 0.24)); i++) {
        ctx.fillStyle = rgb(sampleRamp(STEEL, 0.8));
        ctx.fillRect(left + ts * (0.1 + i * 0.24), sy + ts * 0.015, 2, 2);
      }
    }
    // Hinges and keys hung from nails along the apron.
    const apronRng = forkRng(rng);
    const hooks = Math.round((right - left) / (ts * 0.34));
    for (let i = 0; i < hooks; i++) {
      const hx = left + ts * 0.2 + ((right - left - ts * 0.4) * i) / Math.max(1, hooks - 1);
      const hy = topFront + ts * 0.1;
      if (i % 2 === 0) {
        outlinedRect(
          ctx,
          hx - ts * 0.03,
          hy,
          ts * 0.06,
          ts * 0.2,
          sampleRamp(STEEL, 0.45),
          ts * 0.6,
        );
        outlinedRect(
          ctx,
          hx - ts * 0.07,
          hy + ts * 0.02,
          ts * 0.14,
          ts * 0.04,
          sampleRamp(STEEL, 0.55),
          ts * 0.6,
        );
      } else {
        ctx.strokeStyle = rgb(BRASS_DARK);
        ctx.lineWidth = ts * 0.025;
        ctx.beginPath();
        ctx.arc(hx, hy + ts * 0.04, ts * 0.035, 0, Math.PI * 2);
        ctx.moveTo(hx, hy + ts * 0.075);
        ctx.lineTo(hx + jitter(apronRng, 1), hy + ts * 0.2);
        ctx.stroke();
      }
    }

    // The top.
    const topPts: Pt[] = [
      { x: left - ts * 0.02, y: topFront },
      { x: left + ts * 0.04, y: topBack },
      { x: right - ts * 0.04, y: topBack },
      { x: right + ts * 0.02, y: topFront },
    ];
    fillPolygon(ctx, topPts, sampleRamp(OAK, 0.62), ts);
    ctx.fillStyle = rgba(OAK.accent, 0.35);
    ctx.fillRect(left, topBack + ts * 0.04, right - left, ts * 0.03);
    outlinedRect(
      ctx,
      left - ts * 0.02,
      topFront - ts * 0.01,
      right - left + ts * 0.04,
      ts * 0.07,
      sampleRamp(OAK, 0.45),
      ts,
    );
    ctx.fillStyle = rgba(OAK.accent, 0.8);
    ctx.fillRect(left, topFront - ts * 0.01, right - left, ts * 0.02);
    // Iron corner caps.
    for (const cx of [left, right - ts * 0.12]) {
      outlinedRect(
        ctx,
        cx,
        topFront - ts * 0.02,
        ts * 0.12,
        ts * 0.12,
        sampleRamp(STEEL, 0.35),
        ts * 0.7,
      );
    }

    const surfaceY = (topFront + topBack) / 2 + ts * 0.05;
    const w = right - left;
    // Horseshoes stacked by size.
    for (let s = 0; s < 3; s++) {
      paintHorseshoe(
        ctx,
        left + w * 0.1 + s * ts * 0.03,
        surfaceY - s * ts * 0.05,
        ts * (0.1 - s * 0.012),
        ts,
      );
    }
    // An opened knife roll with four blades.
    const rollX = left + w * 0.2;
    fillPolygon(
      ctx,
      [
        { x: rollX, y: surfaceY + ts * 0.02 },
        { x: rollX + ts * 0.04, y: surfaceY - ts * 0.16 },
        { x: rollX + ts * 0.76, y: surfaceY - ts * 0.16 },
        { x: rollX + ts * 0.72, y: surfaceY + ts * 0.02 },
      ],
      sampleRamp(LEATHER, 0.5),
      ts * 0.7,
    );
    for (let k = 0; k < 4; k++) {
      paintKnife(
        ctx,
        rollX + ts * (0.06 + k * 0.03),
        surfaceY - ts * (0.12 - k * 0.035),
        ts * 0.62,
        ts,
      );
    }
    // A helm on a turned block.
    const helmX = left + w * 0.52;
    outlinedRect(
      ctx,
      helmX - ts * 0.1,
      surfaceY - ts * 0.08,
      ts * 0.2,
      ts * 0.1,
      sampleRamp(OAK, 0.4),
      ts * 0.7,
    );
    paintHelm(ctx, helmX, surfaceY - ts * 0.08, ts * 0.2, ts);
    // A keg of nails with a scoop.
    const kegX = left + w * 0.7;
    const kegTop = surfaceY - ts * 0.3;
    fillPolygon(
      ctx,
      [
        { x: kegX - ts * 0.16, y: kegTop },
        { x: kegX + ts * 0.16, y: kegTop },
        { x: kegX + ts * 0.18, y: surfaceY - ts * 0.15 },
        { x: kegX + ts * 0.15, y: surfaceY + ts * 0.02 },
        { x: kegX - ts * 0.15, y: surfaceY + ts * 0.02 },
        { x: kegX - ts * 0.18, y: surfaceY - ts * 0.15 },
      ],
      sampleRamp(woodRamp(), 0.5),
      ts,
    );
    for (const t of [0.25, 0.75]) {
      ctx.fillStyle = rgb(sampleRamp(STEEL, 0.3));
      ctx.fillRect(kegX - ts * 0.17, kegTop + (surfaceY - kegTop) * t, ts * 0.34, ts * 0.03);
    }
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.55));
    ctx.beginPath();
    ctx.ellipse(kegX, kegTop, ts * 0.15, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    const nailRng = forkRng(rng);
    for (let n = 0; n < 8; n++) {
      ctx.fillStyle = rgb(sampleRamp(STEEL, 0.2 + nailRng() * 0.5));
      ctx.fillRect(kegX + jitter(nailRng, ts * 0.11), kegTop + jitter(nailRng, ts * 0.03), 2, 2);
    }
    // A brass bell at the east end.
    const bellX = right - ts * 0.3;
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.moveTo(bellX - ts * 0.1, surfaceY);
    ctx.quadraticCurveTo(bellX - ts * 0.09, surfaceY - ts * 0.18, bellX, surfaceY - ts * 0.19);
    ctx.quadraticCurveTo(bellX + ts * 0.09, surfaceY - ts * 0.18, bellX + ts * 0.1, surfaceY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(HEAT_WHITE, 0.6);
    ctx.fillRect(bellX - ts * 0.05, surfaceY - ts * 0.13, ts * 0.025, ts * 0.08);
  });
}

/**
 * A rack of finished blades on the wall: two swords hilt up, a bearded
 * axe, a boar spear, and the talon-grip handles skyfowl customers order —
 * hung across a dark oak board with a pegged shelf of daggers under it.
 * Variant 1 trades a sword for a second axe and a hand scythe.
 */
export function paintBladeRack(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const boardTop = box.top - ts * 0.72;
    const boardBottom = box.bottom - ts * 0.18;
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    paintPlankBoard(ctx, left, boardTop, right - left, boardBottom - boardTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.3,
      ramp: OAK,
    });
    ctx.beginPath();
    ctx.rect(left, boardTop, right - left, boardBottom - boardTop);
    inkOutline(ctx, ts);
    outlinedRect(
      ctx,
      left,
      boardTop + ts * 0.08,
      right - left,
      ts * 0.05,
      sampleRamp(STEEL, 0.3),
      ts * 0.6,
    );

    const span = right - left;
    const slots = Math.max(3, Math.round(span / (ts * 0.32)));
    for (let i = 0; i < slots; i++) {
      const x = left + (span * (i + 0.5)) / slots;
      const kind = (i + variant) % 4;
      const hangY = boardTop + ts * 0.06;
      if (kind === 0) paintSword(ctx, x, hangY, ts * 1.1, ts);
      else if (kind === 1) paintAxe(ctx, x, hangY, ts * 0.95, ts, i % 2 === 0 ? 1 : -1);
      else if (kind === 2) {
        // Boar spear: a long haft, a broad leaf head, a cross-bar lug.
        inkedLine(
          ctx,
          { x, y: hangY + ts * 0.25 },
          { x, y: boardBottom - ts * 0.05 },
          ts * 0.04,
          sampleRamp(woodRamp(), 0.55),
          ts,
        );
        fillPolygon(
          ctx,
          [
            { x, y: hangY - ts * 0.04 },
            { x: x + ts * 0.07, y: hangY + ts * 0.14 },
            { x, y: hangY + ts * 0.27 },
            { x: x - ts * 0.07, y: hangY + ts * 0.14 },
          ],
          sampleRamp(STEEL, 0.75),
          ts,
        );
        outlinedRect(
          ctx,
          x - ts * 0.08,
          hangY + ts * 0.29,
          ts * 0.16,
          ts * 0.035,
          sampleRamp(STEEL, 0.4),
          ts * 0.6,
        );
      } else {
        // A talon-grip handle: a curved grip shaped for a skyfowl's foot, on a short blade.
        ctx.strokeStyle = rgba(TOWN_INK, 0.85);
        ctx.lineWidth = ts * 0.08;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - ts * 0.02, hangY + ts * 0.05);
        ctx.quadraticCurveTo(x + ts * 0.14, hangY + ts * 0.22, x, hangY + ts * 0.42);
        ctx.stroke();
        ctx.strokeStyle = rgb(sampleRamp(LEATHER, 0.55));
        ctx.lineWidth = ts * 0.05;
        ctx.stroke();
        ctx.lineCap = 'butt';
        fillPolygon(
          ctx,
          [
            { x: x - ts * 0.04, y: hangY + ts * 0.42 },
            { x: x + ts * 0.04, y: hangY + ts * 0.42 },
            { x: x + ts * 0.02, y: hangY + ts * 0.78 },
            { x: x - ts * 0.03, y: hangY + ts * 0.7 },
          ],
          sampleRamp(STEEL, 0.7),
          ts,
        );
      }
    }
    // The dagger shelf across the bottom of the board.
    const shelfY = boardBottom - ts * 0.05;
    outlinedRect(
      ctx,
      left - ts * 0.02,
      shelfY,
      right - left + ts * 0.04,
      ts * 0.08,
      sampleRamp(OAK, 0.55),
      ts,
    );
    const daggers = Math.round(span / (ts * 0.16));
    for (let d = 0; d < daggers; d++) {
      const dx = left + ts * 0.08 + ((span - ts * 0.16) * d) / Math.max(1, daggers - 1);
      inkedLine(
        ctx,
        { x: dx, y: shelfY },
        { x: dx, y: shelfY - ts * 0.22 },
        ts * 0.04,
        sampleRamp(STEEL, 0.75),
        ts * 0.6,
        'butt',
      );
      outlinedRect(ctx, dx - ts * 0.05, shelfY - ts * 0.02, ts * 0.1, ts * 0.03, BRASS, ts * 0.5);
    }
  });
}

/**
 * A trestle table of household ironmongery by the shop door: a cooking pot
 * and a skillet, a kettle, pot hooks and trivets, a lantern, a hand sickle
 * and a stack of shoes — the everyday half of a smith's trade laid out for
 * people who never buy a sword.
 */
export function paintIronmongeryTable(ctx: Ctx, frame: TownPropFrame) {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.34);
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;
    const topFront = box.bottom - ts * 0.46;
    const topBack = topFront - ts * 0.3;
    for (const lx of [left + ts * 0.2, right - ts * 0.2]) {
      inkedLine(
        ctx,
        { x: lx - ts * 0.12, y: box.bottom - ts * 0.06 },
        { x: lx + ts * 0.02, y: topFront },
        ts * 0.06,
        sampleRamp(wood, 0.3),
        ts,
      );
      inkedLine(
        ctx,
        { x: lx + ts * 0.12, y: box.bottom - ts * 0.06 },
        { x: lx - ts * 0.02, y: topFront },
        ts * 0.06,
        sampleRamp(wood, 0.3),
        ts,
      );
    }
    // A cloth over the boards.
    const topPts: Pt[] = [
      { x: left, y: topFront },
      { x: left + ts * 0.05, y: topBack },
      { x: right - ts * 0.05, y: topBack },
      { x: right, y: topFront },
    ];
    fillPolygon(ctx, topPts, sampleRamp(wood, 0.55), ts);
    // A sacking cloth laid over the boards and hanging off the front edge.
    const clothLeft = left + ts * 0.15;
    const clothRight = right - ts * 0.15;
    fillPolygon(
      ctx,
      [
        { x: clothLeft, y: topFront },
        { x: clothLeft + ts * 0.04, y: topBack + ts * 0.04 },
        { x: clothRight - ts * 0.04, y: topBack + ts * 0.04 },
        { x: clothRight, y: topFront },
      ],
      CLOTH_RED,
      ts,
    );
    outlinedRect(ctx, left, topFront, right - left, ts * 0.09, sampleRamp(wood, 0.45), ts);
    outlinedRect(
      ctx,
      clothLeft,
      topFront,
      clothRight - clothLeft,
      ts * 0.2,
      mix(CLOTH_RED, SOOT, 0.25),
      ts,
    );
    // Horseshoes and pot hooks hung alternately off the cloth's hem.
    for (let i = 0; i < 5; i++) {
      const hx = left + ts * 0.3 + i * ((right - left - ts * 0.6) / 4);
      if (i % 2 === 1) {
        paintHorseshoe(ctx, hx, topFront + ts * 0.28, ts * 0.08, ts);
        continue;
      }
      ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.45));
      ctx.lineWidth = ts * 0.03;
      ctx.beginPath();
      ctx.moveTo(hx, topFront + ts * 0.16);
      ctx.lineTo(hx, topFront + ts * 0.3);
      ctx.arc(hx + ts * 0.04, topFront + ts * 0.3, ts * 0.04, Math.PI, 0, true);
      ctx.stroke();
    }

    const surfaceY = (topFront + topBack) / 2 + ts * 0.05;
    const w = right - left;
    // Cooking pot.
    const potX = left + w * 0.14;
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.25));
    ctx.beginPath();
    ctx.ellipse(potX, surfaceY - ts * 0.14, ts * 0.2, ts * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.1));
    ctx.beginPath();
    ctx.ellipse(potX, surfaceY - ts * 0.26, ts * 0.16, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(STEEL.accent, 0.4);
    ctx.fillRect(potX - ts * 0.15, surfaceY - ts * 0.18, ts * 0.04, ts * 0.1);
    // Skillet leaning on the pot.
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.35));
    ctx.beginPath();
    ctx.ellipse(left + w * 0.3, surfaceY - ts * 0.08, ts * 0.17, ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    inkedLine(
      ctx,
      { x: left + w * 0.3 + ts * 0.15, y: surfaceY - ts * 0.08 },
      { x: left + w * 0.3 + ts * 0.42, y: surfaceY - ts * 0.13 },
      ts * 0.04,
      sampleRamp(STEEL, 0.35),
      ts,
    );
    // A lantern.
    const lanternX = left + w * 0.55;
    outlinedRect(
      ctx,
      lanternX - ts * 0.09,
      surfaceY - ts * 0.32,
      ts * 0.18,
      ts * 0.28,
      sampleRamp(STEEL, 0.3),
      ts,
    );
    ctx.fillStyle = rgba(HEAT_YELLOW, 0.75);
    ctx.fillRect(lanternX - ts * 0.06, surfaceY - ts * 0.27, ts * 0.12, ts * 0.18);
    fillPolygon(
      ctx,
      [
        { x: lanternX - ts * 0.11, y: surfaceY - ts * 0.32 },
        { x: lanternX, y: surfaceY - ts * 0.42 },
        { x: lanternX + ts * 0.11, y: surfaceY - ts * 0.32 },
      ],
      sampleRamp(STEEL, 0.35),
      ts,
    );
    // A kettle.
    const kettleX = left + w * 0.72;
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.45));
    ctx.beginPath();
    ctx.ellipse(kettleX, surfaceY - ts * 0.1, ts * 0.15, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    inkedLine(
      ctx,
      { x: kettleX + ts * 0.12, y: surfaceY - ts * 0.12 },
      { x: kettleX + ts * 0.24, y: surfaceY - ts * 0.22 },
      ts * 0.035,
      sampleRamp(STEEL, 0.45),
      ts,
    );
    ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.3));
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.arc(kettleX, surfaceY - ts * 0.2, ts * 0.09, Math.PI, 0);
    ctx.stroke();
    // A sickle and a pair of shoes at the east end.
    const sickleX = left + w * 0.88;
    ctx.strokeStyle = rgba(TOWN_INK, 0.85);
    ctx.lineWidth = ts * 0.06;
    ctx.beginPath();
    ctx.arc(sickleX, surfaceY - ts * 0.12, ts * 0.12, Math.PI * 1.1, Math.PI * 2.1);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.75));
    ctx.lineWidth = ts * 0.035;
    ctx.stroke();
    inkedLine(
      ctx,
      { x: sickleX - ts * 0.11, y: surfaceY - ts * 0.1 },
      { x: sickleX - ts * 0.13, y: surfaceY + ts * 0.02 },
      ts * 0.04,
      sampleRamp(wood, 0.6),
      ts,
    );
  });
}

/**
 * A mail shirt on a T-stand with a helm crowning it — the one piece of
 * armour Varga keeps out front, to show she can.
 */
export function paintMailStand(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, ts * 0.36, ts * 0.12, 0.38);
    const cx = box.centreX;
    // Cross foot and post.
    outlinedRect(
      ctx,
      cx - ts * 0.3,
      box.bottom - ts * 0.12,
      ts * 0.6,
      ts * 0.07,
      sampleRamp(wood, 0.35),
      ts,
    );
    outlinedRect(
      ctx,
      cx - ts * 0.04,
      box.top - ts * 0.4,
      ts * 0.08,
      box.bottom - ts * 0.1 - (box.top - ts * 0.4),
      sampleRamp(wood, 0.45),
      ts,
    );
    // The shirt: shoulders, a flared hem, ringed texture.
    const shoulderY = box.top - ts * 0.2;
    const hemY = box.bottom - ts * 0.38;
    const shirt: Pt[] = [
      { x: cx - ts * 0.3, y: shoulderY + ts * 0.04 },
      { x: cx - ts * 0.12, y: shoulderY - ts * 0.02 },
      { x: cx + ts * 0.12, y: shoulderY - ts * 0.02 },
      { x: cx + ts * 0.3, y: shoulderY + ts * 0.04 },
      { x: cx + ts * 0.34, y: shoulderY + ts * 0.3 },
      { x: cx + ts * 0.24, y: shoulderY + ts * 0.3 },
      { x: cx + ts * 0.26, y: hemY },
      { x: cx - ts * 0.26, y: hemY },
      { x: cx - ts * 0.24, y: shoulderY + ts * 0.3 },
      { x: cx - ts * 0.34, y: shoulderY + ts * 0.3 },
    ];
    fillPolygon(ctx, shirt, sampleRamp(STEEL, 0.48), ts);
    ctx.save();
    polygon(ctx, shirt);
    ctx.clip();
    const ringRng = forkRng(rng);
    for (let y = shoulderY; y < hemY; y += ts * 0.045) {
      for (let x = cx - ts * 0.34; x < cx + ts * 0.34; x += ts * 0.05) {
        ctx.fillStyle = rgba(ringRng() > 0.5 ? STEEL.accent : STEEL.shadow, 0.5);
        ctx.fillRect(x + ((y / (ts * 0.045)) % 2) * ts * 0.025, y, 2, 2);
      }
    }
    const shade = ctx.createLinearGradient(cx - ts * 0.34, 0, cx + ts * 0.34, 0);
    shade.addColorStop(0, rgba(STEEL.accent, 0.25));
    shade.addColorStop(1, rgba(SOOT, 0.35));
    ctx.fillStyle = shade;
    ctx.fillRect(cx - ts * 0.4, shoulderY - ts * 0.1, ts * 0.8, hemY - shoulderY + ts * 0.1);
    ctx.restore();
    outlinedRect(
      ctx,
      cx - ts * 0.26,
      hemY - ts * 0.08,
      ts * 0.52,
      ts * 0.05,
      sampleRamp(LEATHER, 0.45),
      ts * 0.7,
    );
    paintHelm(ctx, cx, shoulderY - ts * 0.02, ts * 0.17, ts);
  });
}

/**
 * The slack tub: a cut-down cask of dark quench water with a sooty rim and
 * steam off it, a bundle of rods cooling in it and a pair of tongs hung on
 * its stave.
 */
export function paintSlackTub(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, ts * 0.4, ts * 0.13, 0.38);
    const cx = box.centreX;
    const rimY = box.bottom - ts * 0.55;
    const rx = ts * 0.38;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.beginPath();
    ctx.moveTo(cx - rx, rimY);
    ctx.lineTo(cx - rx * 0.9, box.bottom - ts * 0.1);
    ctx.ellipse(cx, box.bottom - ts * 0.1, rx * 0.9, ts * 0.08, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, rimY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const staveRng = forkRng(rng);
    ctx.strokeStyle = rgba(wood.shadow, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (let i = 1; i < 6; i++) {
      const sx = cx - rx + (rx * 2 * i) / 6 + jitter(staveRng, 1);
      ctx.beginPath();
      ctx.moveTo(sx, rimY + ts * 0.04);
      ctx.lineTo(sx * 0.98 + cx * 0.02, box.bottom - ts * 0.12);
      ctx.stroke();
    }
    for (const t of [0.25, 0.75]) {
      const by = rimY + (box.bottom - ts * 0.1 - rimY) * t;
      outlinedRect(
        ctx,
        cx - rx * (1 - t * 0.1),
        by,
        rx * 2 * (1 - t * 0.1),
        ts * 0.05,
        sampleRamp(STEEL, 0.3),
        ts * 0.6,
      );
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.beginPath();
    ctx.ellipse(cx, rimY, rx, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(QUENCH_WATER);
    ctx.beginPath();
    ctx.ellipse(cx, rimY + ts * 0.01, rx * 0.84, ts * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(STEEL.light, 0.6);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.ellipse(cx - ts * 0.05, rimY, rx * 0.45, ts * 0.04, 0, Math.PI * 1.1, Math.PI * 1.7);
    ctx.stroke();
    for (let r = 0; r < 3; r++) {
      inkedLine(
        ctx,
        { x: cx - ts * 0.1 + r * ts * 0.08, y: rimY },
        { x: cx - ts * 0.2 + r * ts * 0.1, y: rimY - ts * 0.4 },
        ts * 0.035,
        sampleRamp(STEEL, 0.35),
        ts * 0.6,
      );
    }
    for (let s = 0; s < 3; s++) {
      ctx.strokeStyle = rgba(STEEL.accent, 0.35);
      ctx.lineWidth = Math.max(1, ts * 0.025);
      ctx.beginPath();
      const sx = cx + ts * (0.05 + s * 0.08);
      ctx.moveTo(sx, rimY - ts * 0.04);
      ctx.bezierCurveTo(
        sx + ts * 0.08,
        rimY - ts * 0.2,
        sx - ts * 0.08,
        rimY - ts * 0.35,
        sx,
        rimY - ts * 0.55,
      );
      ctx.stroke();
    }
  });
}

/**
 * The working floor in front of the forge: the flags sooted dark and
 * littered with black scale knocked off hot iron, a few cinders still
 * glowing, and the fire's light spilling warm across the stone nearest the
 * hearth. Walkable and drawn with the floor, and faded out at every edge
 * so it reads as the floor itself darkened, never as a mat laid on it.
 */
export function paintForgeFloor(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng) {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    const cy = box.top + box.height * 0.45;
    const rx = box.width * 0.5;
    const ry = box.height * 0.55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const soot = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    soot.addColorStop(0, rgba(SOOT, 0.42));
    soot.addColorStop(0.6, rgba(SOOT, 0.26));
    soot.addColorStop(1, rgba(SOOT, 0));
    ctx.fillStyle = soot;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
    // Firelight falling from the hearth onto the stone nearest it.
    const lightY = box.top;
    ctx.save();
    ctx.translate(cx, lightY);
    ctx.scale(1, 0.55);
    const light = ctx.createRadialGradient(0, 0, 0, 0, 0, box.width * 0.42);
    light.addColorStop(0, rgba(HEAT_ORANGE, 0.34));
    light.addColorStop(0.5, rgba(HEAT_ORANGE, 0.14));
    light.addColorStop(1, rgba(HEAT_ORANGE, 0));
    ctx.fillStyle = light;
    ctx.fillRect(-box.width / 2, -box.width / 2, box.width, box.width);
    ctx.restore();
    // Scale flakes and cinders, thickest in the middle.
    const flakeRng = forkRng(rng);
    const flakes = Math.round((box.width * box.height) / (ts * ts)) * 5;
    for (let i = 0; i < flakes; i++) {
      const a = flakeRng() * Math.PI * 2;
      const d = Math.sqrt(flakeRng()) * 0.95;
      const fx = cx + Math.cos(a) * rx * d;
      const fy = cy + Math.sin(a) * ry * d;
      const glowing = flakeRng() < 0.05 && d < 0.6;
      ctx.fillStyle = glowing ? rgb(HEAT_ORANGE) : rgba(SOOT, 0.35 + flakeRng() * 0.25);
      const size = 2 + Math.floor(flakeRng() * 3);
      ctx.fillRect(fx, fy, size, glowing ? 2 : Math.max(2, size - 1));
    }
  });
}

/**
 * A cone mandrel standing on the floor beside a swage block on its timber
 * stand — the smith's two shaping irons, a tall black cone for truing rings
 * and a heavy block pierced with holes and grooved on every edge.
 */
export function paintMandrelSwage(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng) {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    bandShadow(ctx, box, ts, 0.34);
    // The mandrel: a tall iron cone with a lit west flank and ring marks.
    const mx = box.left + ts * 0.5;
    const baseY = box.bottom - ts * 0.1;
    const topY = box.top - ts * 0.5;
    const cone: Pt[] = [
      { x: mx - ts * 0.04, y: topY },
      { x: mx + ts * 0.04, y: topY },
      { x: mx + ts * 0.26, y: baseY },
      { x: mx - ts * 0.26, y: baseY },
    ];
    polygon(ctx, cone);
    const coneGrad = ctx.createLinearGradient(mx - ts * 0.26, 0, mx + ts * 0.26, 0);
    coneGrad.addColorStop(0, rgb(sampleRamp(STEEL, 0.7)));
    coneGrad.addColorStop(0.45, rgb(sampleRamp(STEEL, 0.35)));
    coneGrad.addColorStop(1, rgb(sampleRamp(STEEL, 0.12)));
    ctx.fillStyle = coneGrad;
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(STEEL.accent, 0.4);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      const y = topY + (baseY - topY) * t;
      const half = ts * 0.04 + ts * 0.22 * t;
      ctx.beginPath();
      ctx.moveTo(mx - half, y);
      ctx.lineTo(mx + half * 0.2, y);
      ctx.stroke();
    }
    // A finished ring hung on the cone.
    ctx.strokeStyle = rgba(TOWN_INK, 0.85);
    ctx.lineWidth = ts * 0.06;
    ctx.beginPath();
    ctx.ellipse(mx, topY + (baseY - topY) * 0.45, ts * 0.15, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.75));
    ctx.lineWidth = ts * 0.035;
    ctx.stroke();

    // The swage block on its stand.
    const sx = box.right - ts * 0.55;
    const standTop = box.bottom - ts * 0.42;
    for (const lx of [sx - ts * 0.3, sx + ts * 0.22]) {
      outlinedRect(
        ctx,
        lx,
        standTop,
        ts * 0.08,
        box.bottom - ts * 0.08 - standTop,
        sampleRamp(wood, 0.3),
        ts,
      );
    }
    outlinedRect(
      ctx,
      sx - ts * 0.36,
      standTop - ts * 0.06,
      ts * 0.72,
      ts * 0.1,
      sampleRamp(wood, 0.5),
      ts,
    );
    const blockTop = standTop - ts * 0.5;
    outlinedRect(ctx, sx - ts * 0.34, blockTop, ts * 0.68, ts * 0.44, sampleRamp(STEEL, 0.3), ts);
    fillPolygon(
      ctx,
      [
        { x: sx - ts * 0.34, y: blockTop },
        { x: sx - ts * 0.3, y: blockTop - ts * 0.1 },
        { x: sx + ts * 0.36, y: blockTop - ts * 0.1 },
        { x: sx + ts * 0.34, y: blockTop },
      ],
      sampleRamp(STEEL, 0.6),
      ts,
    );
    ctx.fillStyle = rgb(SOOT);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.beginPath();
        ctx.arc(
          sx - ts * 0.17 + c * ts * 0.17,
          blockTop + ts * (0.1 + r * 0.14),
          ts * (0.035 + jitter(rng, 0.008)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    for (let g = 0; g < 4; g++) {
      ctx.beginPath();
      ctx.arc(
        sx - ts * 0.3,
        blockTop + ts * (0.05 + g * 0.09),
        ts * 0.025,
        -Math.PI / 2,
        Math.PI / 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = rgba(STEEL.accent, 0.5);
    ctx.fillRect(sx - ts * 0.26, blockTop - ts * 0.09, ts * 0.58, 2);
  });
}
