/**
 * Bespoke furniture for the Temple of the Sky, composed around three large
 * pieces rather than a scatter of small ones: a raised stone dais across the
 * whole north end, the carved altar standing on it, and the stained sky
 * window glowing on the wall behind. Around those, the dome's own worship
 * furniture at a size that reads from the door — iron candelabra, tall
 * roosting perches with skyfowl on them, long hanging sky banners, an eagle
 * lectern holding the great book, votive racks, a font and an offering
 * table — plus the scripture shelves lining the nave.
 */

import {
  footprintBox,
  withFootprintClip,
  jitter,
  forkRng,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
  type Rng,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, mix, type RGB, type Ramp } from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

function ironRamp(): Ramp {
  return getTownRamp('iron_black');
}
function stoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}
function woodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function iconRamp(): Ramp {
  return getTownRamp('oc_sky_icon');
}

function contactShadow(ctx: Ctx, frame: TownPropFrame, widthFraction = 0.42): void {
  const box = footprintBox(frame);
  const radiusX = box.width * widthFraction;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.34);
}

// ── Shared colours ──────────────────────────────────────────────────────────

/** The shard's own dull glint — never bright enough to look like it is asking to be taken. */
const ALTAR_STONE_TONE: RGB = [150, 168, 172];
const ALTAR_STONE_HIGHLIGHT: RGB = [214, 224, 226];
const PAGE_CREAM: RGB = [232, 222, 196];
const PAGE_SHADOW: RGB = [184, 170, 138];

/** Temple brass — candlesticks, the lectern's bird, the font's rim. No town ramp covers polished metal this warm. */
const BRASS_DARK: RGB = [104, 76, 34];
const BRASS_MID: RGB = [170, 132, 60];
const BRASS_LIGHT: RGB = [232, 200, 120];

/** A lit taper's flame and the wax under it. */
const FLAME_CORE: RGB = [255, 238, 176];
const FLAME_EDGE: RGB = [255, 150, 60];
const FLAME_GLOW: RGB = [255, 206, 120];
const WAX: RGB = [236, 228, 206];
const WAX_SHADOW: RGB = [190, 178, 150];

/** The dais' carpet continues the nave aisle's own red-and-gold runner up the step. */
const CARPET_RED: RGB = [150, 40, 36];
const CARPET_RED_DARK: RGB = [98, 24, 24];
const CARPET_GOLD: RGB = [214, 164, 70];

/** The stained window's glass — the dome's sky, lit from outside. */
const GLASS_DEEP: RGB = [34, 64, 128];
const GLASS_SKY: RGB = [86, 146, 206];
const GLASS_PALE: RGB = [176, 214, 238];
const GLASS_GOLD: RGB = [240, 196, 92];
const GLASS_WHITE: RGB = [246, 244, 236];
const SUNLIGHT: RGB = [255, 240, 200];

/** Skyfowl plumage for the roosting birds — pale doves' grey with a slate wing. */
const BIRD_BODY: RGB = [226, 222, 212];
const BIRD_SHADE: RGB = [170, 166, 160];
const BIRD_WING: RGB = [120, 130, 142];
const BIRD_BEAK: RGB = [226, 168, 70];

/** Votive cups: ruby, amber and sky glass, lit from inside. */
const VOTIVE_GLASS: readonly RGB[] = [
  [196, 52, 44],
  [224, 150, 52],
  [70, 120, 196],
];
const VOTIVE_UNLIT_CHANCE = 0.12;

/** Font water. */
const WATER_DEEP: RGB = [40, 84, 110];
const WATER_LIGHT: RGB = [150, 200, 220];

/** The lectern book's ribbon marker. */
const BOOK_RIBBON: RGB = [170, 40, 44];

/** Outline weight for the small painted details — a finer line than a whole prop's silhouette. */
const DETAIL_OUTLINE_SCALE = 48;
const SILHOUETTE_OUTLINE_SCALE = 64;

// ── Small shared painters ───────────────────────────────────────────────────

/** A lit taper standing on `(x, baseY)`: wax body, wick flame and a soft halo. */
function paintTaper(ctx: Ctx, x: number, baseY: number, width: number, height: number): void {
  const top = baseY - height;
  const flameH = width * 2.1;
  const flameY = top - flameH * 0.55;
  const halo = ctx.createRadialGradient(x, flameY, 1, x, flameY, flameH * 2.2);
  halo.addColorStop(0, rgba(FLAME_GLOW, 0.55));
  halo.addColorStop(1, rgba(FLAME_GLOW, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, flameY, flameH * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgb(WAX);
  ctx.beginPath();
  ctx.rect(x - width / 2, top, width, height);
  ctx.fill();
  inkOutline(ctx, DETAIL_OUTLINE_SCALE);
  ctx.fillStyle = rgb(WAX_SHADOW);
  ctx.fillRect(x + width * 0.1, top + 1, width * 0.4, height - 1);

  ctx.fillStyle = rgb(FLAME_EDGE);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.quadraticCurveTo(x + flameH * 0.4, top - flameH * 0.45, x, top - flameH);
  ctx.quadraticCurveTo(x - flameH * 0.4, top - flameH * 0.45, x, top);
  ctx.fill();
  ctx.fillStyle = rgb(FLAME_CORE);
  ctx.beginPath();
  ctx.ellipse(x, top - flameH * 0.38, flameH * 0.15, flameH * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A skyfowl at roost, seen three-quarter: a plump pale body, a slate wing
 * folded along its side, a fanned tail below the perch, and a small head
 * turned toward `facing` with a gold beak and a dark eye.
 */
function paintRoostingBird(
  ctx: Ctx,
  x: number,
  perchY: number,
  size: number,
  facing: 1 | -1,
): void {
  const bodyW = size * 0.78;
  const bodyH = size;
  const bodyCy = perchY - bodyH * 0.42;

  ctx.fillStyle = rgb(BIRD_WING);
  ctx.beginPath();
  ctx.moveTo(x - facing * bodyW * 0.2, perchY - bodyH * 0.05);
  ctx.lineTo(x - facing * bodyW * 0.62, perchY + bodyH * 0.34);
  ctx.lineTo(x - facing * bodyW * 0.28, perchY + bodyH * 0.3);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, DETAIL_OUTLINE_SCALE);

  ctx.fillStyle = rgb(BIRD_BODY);
  ctx.beginPath();
  ctx.ellipse(x, bodyCy, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, SILHOUETTE_OUTLINE_SCALE);
  ctx.fillStyle = rgb(BIRD_SHADE);
  ctx.beginPath();
  ctx.ellipse(x, bodyCy + bodyH * 0.2, bodyW * 0.4, bodyH * 0.24, 0, 0, Math.PI);
  ctx.fill();

  ctx.fillStyle = rgb(BIRD_WING);
  ctx.beginPath();
  ctx.ellipse(
    x - facing * bodyW * 0.1,
    bodyCy + bodyH * 0.02,
    bodyW * 0.36,
    bodyH * 0.34,
    facing * -0.5,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  inkOutline(ctx, DETAIL_OUTLINE_SCALE);
  ctx.strokeStyle = rgba(BIRD_BODY, 0.55);
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(x - facing * bodyW * 0.3, bodyCy - bodyH * 0.1);
  ctx.lineTo(x + facing * bodyW * 0.1, bodyCy + bodyH * 0.12);
  ctx.stroke();

  const headR = size * 0.27;
  const headX = x + facing * bodyW * 0.3;
  const headY = bodyCy - bodyH * 0.44;
  ctx.fillStyle = rgb(BIRD_BODY);
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, SILHOUETTE_OUTLINE_SCALE);
  ctx.fillStyle = rgb(BIRD_BEAK);
  ctx.beginPath();
  ctx.moveTo(headX + facing * headR * 0.8, headY - headR * 0.15);
  ctx.lineTo(headX + facing * headR * 1.65, headY + headR * 0.15);
  ctx.lineTo(headX + facing * headR * 0.8, headY + headR * 0.4);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, DETAIL_OUTLINE_SCALE);
  ctx.fillStyle = rgb([24, 20, 20]);
  ctx.beginPath();
  ctx.arc(headX + facing * headR * 0.35, headY - headR * 0.1, headR * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgb(BIRD_BEAK);
  ctx.lineWidth = Math.max(1, size * 0.06);
  for (const dx of [-0.14, 0.14]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * bodyW, bodyCy + bodyH * 0.45);
    ctx.lineTo(x + dx * bodyW, perchY + size * 0.04);
    ctx.stroke();
  }
}

/**
 * The dome's wing-and-sun device: a sun disc with a solid swept wing either
 * side, each wing's trailing edge cut into three feather tips — filled
 * shapes rather than strokes, so at 32 px it reads as wings and not as a
 * bundle of thin legs.
 */
function paintWingSun(
  ctx: Ctx,
  cx: number,
  cy: number,
  span: number,
  color: RGB,
  lineWidth: number,
): void {
  const half = span / 2;
  ctx.fillStyle = rgb(color);
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * half * 0.2, cy - half * 0.12);
    ctx.quadraticCurveTo(
      cx + dir * half * 0.55,
      cy - half * 0.62,
      cx + dir * half,
      cy - half * 0.5,
    );
    ctx.lineTo(cx + dir * half * 0.8, cy - half * 0.26);
    ctx.lineTo(cx + dir * half * 0.9, cy - half * 0.18);
    ctx.lineTo(cx + dir * half * 0.64, cy - half * 0.04);
    ctx.lineTo(cx + dir * half * 0.72, cy + half * 0.06);
    ctx.lineTo(cx + dir * half * 0.46, cy + half * 0.12);
    ctx.quadraticCurveTo(
      cx + dir * half * 0.3,
      cy + half * 0.18,
      cx + dir * half * 0.2,
      cy + half * 0.1,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = rgba([20, 20, 30], 0.35);
  ctx.lineWidth = Math.max(1, lineWidth * 0.6);
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * half * 0.3, cy - half * 0.08);
    ctx.quadraticCurveTo(
      cx + dir * half * 0.55,
      cy - half * 0.36,
      cx + dir * half * 0.84,
      cy - half * 0.4,
    );
    ctx.stroke();
  }
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.arc(cx, cy, half * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba([20, 20, 30], 0.45);
  ctx.lineWidth = Math.max(1, lineWidth * 0.6);
  ctx.stroke();
}

// ── The dais ────────────────────────────────────────────────────────────────

/** Where the dais' carpet starts, in tiles from the dais' own west edge — the nave aisle's two columns. */
const DAIS_CARPET_START_TILES = 6;
const DAIS_CARPET_WIDTH_TILES = 2;
const DAIS_RISER_HEIGHT_TILES = 0.3;
const DAIS_SLAB_WIDTH_TILES = 1.15;
const DAIS_SLAB_HEIGHT_TILES = 0.9;

/**
 * The raised sanctuary floor across the north end: pale dressed slabs laid
 * in staggered courses inside a carved kerb, a lit front edge dropping to a
 * shaded riser, and the nave's red runner carried up over the step to the
 * altar. Walkable and drawn under everyone — it is floor, only higher.
 */
export function paintTempleDais(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = stoneRamp();
    const riserH = ts * DAIS_RISER_HEIGHT_TILES;
    const topBottom = box.bottom - riserH;

    ctx.fillStyle = rgb(mix(sampleRamp(stone, 0.62), [196, 186, 168], 0.35));
    ctx.fillRect(box.left, box.top, box.width, topBottom - box.top);

    const slabRng = forkRng(rng);
    const slabW = ts * DAIS_SLAB_WIDTH_TILES;
    const slabH = ts * DAIS_SLAB_HEIGHT_TILES;
    const kerb = ts * 0.16;
    const innerLeft = box.left + kerb;
    const innerRight = box.right - kerb;
    const innerTop = box.top + kerb * 0.5;
    const innerBottom = topBottom - kerb;
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerLeft, innerTop, innerRight - innerLeft, innerBottom - innerTop);
    ctx.clip();
    for (let row = 0; innerTop + row * slabH < innerBottom; row++) {
      const rowTop = innerTop + row * slabH;
      const stagger = row % 2 === 0 ? 0 : slabW * 0.5;
      for (let sx = innerLeft - stagger; sx < innerRight; sx += slabW) {
        const tone = 0.55 + jitter(slabRng, 0.07);
        ctx.fillStyle = rgb(mix(sampleRamp(stone, tone), [200, 190, 170], 0.3));
        ctx.fillRect(sx + 1, rowTop + 1, slabW - 2, slabH - 2);
        ctx.fillStyle = rgba(sampleRamp(stone, 0.95), 0.35);
        ctx.fillRect(sx + 1, rowTop + 1, slabW - 2, 2);
        ctx.fillStyle = rgba(sampleRamp(stone, 0.15), 0.28);
        ctx.fillRect(sx + 1, rowTop + slabH - 3, slabW - 2, 2);
      }
    }
    ctx.restore();

    // The carved kerb: a lighter band framing the slabs, with a thin
    // sky-teal inlay line a hand's width in from the edge.
    ctx.strokeStyle = rgb(sampleRamp(stone, 0.82));
    ctx.lineWidth = kerb * 0.9;
    ctx.strokeRect(
      box.left + kerb * 0.45,
      box.top + kerb * 0.1,
      box.width - kerb * 0.9,
      topBottom - box.top - kerb * 0.55,
    );
    ctx.strokeStyle = rgba(sampleRamp(iconRamp(), 0.55), 0.85);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.strokeRect(
      innerLeft + 2,
      innerTop + 2,
      innerRight - innerLeft - 4,
      innerBottom - innerTop - 4,
    );

    // The front riser: the step's own vertical face, shaded, jointed, and
    // lit along its top lip where the platform turns down.
    ctx.fillStyle = rgb(sampleRamp(stone, 0.3));
    ctx.fillRect(box.left, topBottom, box.width, riserH);
    ctx.strokeStyle = rgba(sampleRamp(stone, 0.12), 0.7);
    ctx.lineWidth = 1;
    for (let jx = box.left + ts * 0.9; jx < box.right; jx += ts * 1.3) {
      ctx.beginPath();
      ctx.moveTo(jx, topBottom + 2);
      ctx.lineTo(jx, box.bottom - 1);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(stone, 0.95));
    ctx.fillRect(box.left, topBottom - 2, box.width, 3);
    const riserShade = ctx.createLinearGradient(0, topBottom, 0, box.bottom);
    riserShade.addColorStop(0, rgba([0, 0, 0], 0));
    riserShade.addColorStop(1, rgba([0, 0, 0], 0.35));
    ctx.fillStyle = riserShade;
    ctx.fillRect(box.left, topBottom, box.width, riserH);

    // The runner, carried up over the step from the nave aisle.
    const carpetLeft = box.left + ts * DAIS_CARPET_START_TILES + ts * 0.06;
    const carpetW = ts * DAIS_CARPET_WIDTH_TILES - ts * 0.12;
    const carpetTop = box.bottom - ts;
    ctx.fillStyle = rgb(CARPET_RED);
    ctx.fillRect(carpetLeft, carpetTop, carpetW, topBottom - carpetTop);
    ctx.fillStyle = rgb(CARPET_RED_DARK);
    ctx.fillRect(carpetLeft, topBottom, carpetW, riserH);
    ctx.strokeStyle = rgb(CARPET_GOLD);
    ctx.lineWidth = ts * 0.04;
    ctx.strokeRect(
      carpetLeft + ts * 0.05,
      carpetTop + ts * 0.05,
      carpetW - ts * 0.1,
      box.bottom - carpetTop,
    );
    ctx.fillStyle = rgb(CARPET_GOLD);
    for (const fx of [0.25, 0.75]) {
      const dx = carpetLeft + carpetW * fx;
      const dy = carpetTop + (topBottom - carpetTop) * 0.5;
      const d = ts * 0.1;
      ctx.beginPath();
      ctx.moveTo(dx, dy - d);
      ctx.lineTo(dx + d, dy);
      ctx.lineTo(dx, dy + d);
      ctx.lineTo(dx - d, dy);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    inkOutline(ctx, ts);
    ctx.beginPath();
    ctx.moveTo(box.left, topBottom);
    ctx.lineTo(box.right, topBottom);
    inkOutline(ctx, ts * 0.8);
  });
}

// ── The sky window ──────────────────────────────────────────────────────────

const WINDOW_ROSE_RADIUS_TILES = 0.46;
const WINDOW_LANCET_WIDTH_TILES = 0.3;
const WINDOW_LANCET_OFFSET_TILES = 0.9;
const WINDOW_OUTER_LANCET_OFFSET_TILES = 1.45;

/** One pointed lancet of stained glass, `(cx, bottom)` at its sill. */
function paintLancet(ctx: Ctx, cx: number, bottom: number, w: number, h: number, ts: number): void {
  const top = bottom - h;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, bottom);
    ctx.lineTo(cx - w / 2, top + w * 0.6);
    ctx.quadraticCurveTo(cx - w / 2, top, cx, top - w * 0.1);
    ctx.quadraticCurveTo(cx + w / 2, top, cx + w / 2, top + w * 0.6);
    ctx.lineTo(cx + w / 2, bottom);
    ctx.closePath();
  };
  const glass = ctx.createLinearGradient(0, top, 0, bottom);
  glass.addColorStop(0, rgb(GLASS_PALE));
  glass.addColorStop(0.5, rgb(GLASS_SKY));
  glass.addColorStop(1, rgb(GLASS_DEEP));
  ctx.fillStyle = glass;
  path();
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  ctx.strokeStyle = rgba([30, 30, 40], 0.7);
  ctx.lineWidth = Math.max(1, ts * 0.018);
  for (let i = 1; i < 4; i++) {
    const y = top + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y);
    ctx.lineTo(cx + w / 2, y);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(GLASS_GOLD);
  ctx.beginPath();
  ctx.arc(cx, top + h * 0.3, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = rgb(sampleRamp(stoneRamp(), 0.8));
  ctx.lineWidth = ts * 0.05;
  path();
  ctx.stroke();
  path();
  inkOutline(ctx, ts);
}

/**
 * The great window over the altar, set into the north wall: a rose of sky
 * glass round a white skyfowl in flight, a pointed lancet either side, all
 * in a pale stone surround — and the daylight it lets in, falling as soft
 * shafts across the dais. Walkable and drawn with the floor, so the deacon
 * standing under it is painted in front of it.
 */
export function paintSkyWindow(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(
    ctx,
    frame,
    () => {
      const box = footprintBox(frame);
      const ts = frame.tileScale;
      const stone = stoneRamp();
      const wallTop = box.top - ts;
      const sill = box.top - ts * 0.06;
      const cx = box.centreX;

      // Daylight first, so the window's own frame sits over the start of it.
      const beams = 3;
      for (let i = 0; i < beams; i++) {
        const spread = (i - (beams - 1) / 2) * ts * 0.62;
        const beam = ctx.createLinearGradient(0, sill, 0, box.bottom);
        beam.addColorStop(0, rgba(SUNLIGHT, 0.5));
        beam.addColorStop(1, rgba(SUNLIGHT, 0));
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(cx + spread - ts * 0.18, sill);
        ctx.lineTo(cx + spread + ts * 0.18, sill);
        ctx.lineTo(cx + spread * 1.9 + ts * 0.42, box.bottom);
        ctx.lineTo(cx + spread * 1.9 - ts * 0.42, box.bottom);
        ctx.closePath();
        ctx.fill();
      }
      const pool = ctx.createRadialGradient(
        cx,
        box.bottom - ts * 0.3,
        1,
        cx,
        box.bottom - ts * 0.3,
        box.width * 0.5,
      );
      pool.addColorStop(0, rgba(SUNLIGHT, 0.22));
      pool.addColorStop(1, rgba(SUNLIGHT, 0));
      ctx.fillStyle = pool;
      ctx.fillRect(box.left, box.top, box.width, box.height);

      // The stone surround: a moulded arch framing all three lights.
      const surroundW = box.width * 0.96;
      const surroundTop = wallTop + ts * 0.02;
      ctx.fillStyle = rgb(sampleRamp(stone, 0.72));
      ctx.beginPath();
      ctx.moveTo(cx - surroundW / 2, sill + ts * 0.04);
      ctx.lineTo(cx - surroundW / 2, surroundTop + ts * 0.3);
      ctx.quadraticCurveTo(
        cx - surroundW / 2,
        surroundTop,
        cx - surroundW / 2 + ts * 0.3,
        surroundTop,
      );
      ctx.lineTo(cx + surroundW / 2 - ts * 0.3, surroundTop);
      ctx.quadraticCurveTo(
        cx + surroundW / 2,
        surroundTop,
        cx + surroundW / 2,
        surroundTop + ts * 0.3,
      );
      ctx.lineTo(cx + surroundW / 2, sill + ts * 0.04);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(sampleRamp(stone, 0.9));
      ctx.fillRect(
        cx - surroundW / 2 - ts * 0.04,
        sill - ts * 0.02,
        surroundW + ts * 0.08,
        ts * 0.08,
      );
      ctx.beginPath();
      ctx.rect(cx - surroundW / 2 - ts * 0.04, sill - ts * 0.02, surroundW + ts * 0.08, ts * 0.08);
      inkOutline(ctx, ts * 0.8);

      const lancetH = ts * 0.74;
      const lancetW = ts * WINDOW_LANCET_WIDTH_TILES;
      for (const dir of [-1, 1]) {
        paintLancet(
          ctx,
          cx + dir * ts * WINDOW_LANCET_OFFSET_TILES,
          sill - ts * 0.02,
          lancetW,
          lancetH,
          ts,
        );
        paintLancet(
          ctx,
          cx + dir * ts * WINDOW_OUTER_LANCET_OFFSET_TILES,
          sill - ts * 0.02,
          lancetW,
          lancetH * 0.82,
          ts,
        );
      }

      // The rose: sky glass in a ring of gold petals, stone tracery spokes,
      // and a white skyfowl in flight across its centre.
      const roseR = ts * WINDOW_ROSE_RADIUS_TILES;
      const roseCy = sill - roseR - ts * 0.05;
      const glass = ctx.createRadialGradient(cx, roseCy - roseR * 0.3, 1, cx, roseCy, roseR);
      glass.addColorStop(0, rgb(GLASS_PALE));
      glass.addColorStop(0.55, rgb(GLASS_SKY));
      glass.addColorStop(1, rgb(GLASS_DEEP));
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.arc(cx, roseCy, roseR, 0, Math.PI * 2);
      ctx.fill();
      const petals = 12;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        const px = cx + Math.cos(a) * roseR * 0.8;
        const py = roseCy + Math.sin(a) * roseR * 0.8;
        ctx.fillStyle = rgb(i % 2 === 0 ? GLASS_GOLD : mix(GLASS_GOLD, GLASS_DEEP, 0.35));
        ctx.beginPath();
        ctx.arc(px, py, roseR * 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = rgba([40, 36, 40], 0.75);
      ctx.lineWidth = Math.max(1, ts * 0.02);
      for (let i = 0; i < petals / 2; i++) {
        const a = (i / (petals / 2)) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * roseR * 0.62, roseCy + Math.sin(a) * roseR * 0.62);
        ctx.lineTo(cx + Math.cos(a) * roseR, roseCy + Math.sin(a) * roseR);
        ctx.moveTo(cx - Math.cos(a) * roseR * 0.62, roseCy - Math.sin(a) * roseR * 0.62);
        ctx.lineTo(cx - Math.cos(a) * roseR, roseCy - Math.sin(a) * roseR);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, roseCy, roseR * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      // The bird: a white skyfowl, wings raised, crossing the rose.
      ctx.fillStyle = rgb(GLASS_WHITE);
      ctx.beginPath();
      ctx.ellipse(cx, roseCy + roseR * 0.08, roseR * 0.14, roseR * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, roseCy);
        ctx.quadraticCurveTo(
          cx + dir * roseR * 0.3,
          roseCy - roseR * 0.55,
          cx + dir * roseR * 0.56,
          roseCy - roseR * 0.3,
        );
        ctx.quadraticCurveTo(
          cx + dir * roseR * 0.32,
          roseCy - roseR * 0.1,
          cx,
          roseCy + roseR * 0.1,
        );
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, roseCy - roseR * 0.22, roseR * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - roseR * 0.12, roseCy + roseR * 0.28);
      ctx.lineTo(cx, roseCy + roseR * 0.44);
      ctx.lineTo(cx + roseR * 0.12, roseCy + roseR * 0.28);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgb(sampleRamp(stone, 0.85));
      ctx.lineWidth = ts * 0.06;
      ctx.beginPath();
      ctx.arc(cx, roseCy, roseR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, roseCy, roseR + ts * 0.03, 0, Math.PI * 2);
      inkOutline(ctx, ts);

      // A faint bloom over the glass, so it reads as lit from outside.
      const bloom = ctx.createRadialGradient(cx, roseCy, 1, cx, roseCy, roseR * 1.6);
      bloom.addColorStop(0, rgba(SUNLIGHT, 0.2 + jitter(forkRng(rng), 0.02)));
      bloom.addColorStop(1, rgba(SUNLIGHT, 0));
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, roseCy, roseR * 1.6, 0, Math.PI * 2);
      ctx.fill();
    },
    2,
  );
}

// ── The altar ───────────────────────────────────────────────────────────────

/**
 * The altar itself, four tiles long: a dressed stone table with a heavy lit
 * top slab over a carved face, an embroidered sky-blue cloth laid along the
 * top and falling at both ends, and, centred in the face, the pale stone
 * set in a carved sunburst — "the stone set within the face of the altar".
 * On top: a brass wing-and-sun standard, a pair of tall candlesticks, the
 * offering dish and an open book of the office.
 */
export function paintAltarStone(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = stoneRamp();
    contactShadow(ctx, frame, 0.5);

    const bodyH = ts * 0.62;
    const slabH = ts * 0.16;
    const bodyTop = box.bottom - bodyH;
    const slabTop = bodyTop - slabH;
    const inset = ts * 0.08;

    // Body with a shadowed plinth course at its foot.
    ctx.fillStyle = rgb(sampleRamp(stone, 0.46));
    ctx.beginPath();
    ctx.rect(box.left + inset, bodyTop, box.width - inset * 2, bodyH);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(stone, 0.3));
    ctx.fillRect(box.left + inset, box.bottom - ts * 0.09, box.width - inset * 2, ts * 0.09);

    // Carved panels either side of the centre, each with a lit upper edge
    // and a shaded lower one so they read as recessed.
    const panelTop = bodyTop + ts * 0.08;
    const panelBottom = box.bottom - ts * 0.14;
    const panelW = ts * 0.62;
    const centreGap = ts * 0.9;
    for (const dir of [-1, 1]) {
      for (let p = 0; p < 2; p++) {
        const px =
          dir < 0
            ? box.centreX - centreGap / 2 - (p + 1) * panelW - p * ts * 0.1
            : box.centreX + centreGap / 2 + p * (panelW + ts * 0.1);
        ctx.fillStyle = rgb(sampleRamp(stone, 0.38));
        ctx.fillRect(px, panelTop, panelW, panelBottom - panelTop);
        ctx.fillStyle = rgba(sampleRamp(stone, 0.1), 0.6);
        ctx.fillRect(px, panelTop, panelW, 2);
        ctx.fillRect(px, panelTop, 2, panelBottom - panelTop);
        ctx.fillStyle = rgba(sampleRamp(stone, 0.9), 0.6);
        ctx.fillRect(px, panelBottom - 2, panelW, 2);
        ctx.fillRect(px + panelW - 2, panelTop, 2, panelBottom - panelTop);
      }
    }

    // The sunburst and the stone at its heart.
    const gemCy = bodyTop + bodyH * 0.46;
    const burstR = ts * 0.3;
    ctx.strokeStyle = rgb(sampleRamp(stone, 0.72));
    ctx.lineWidth = ts * 0.035;
    const rays = 10;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(box.centreX + Math.cos(a) * burstR * 0.45, gemCy + Math.sin(a) * burstR * 0.45);
      ctx.lineTo(box.centreX + Math.cos(a) * burstR, gemCy + Math.sin(a) * burstR);
      ctx.stroke();
    }
    const gemR = ts * (0.1 + jitter(forkRng(rng), 0.008));
    const glow = ctx.createRadialGradient(box.centreX, gemCy, 1, box.centreX, gemCy, gemR * 2.6);
    glow.addColorStop(0, rgba(ALTAR_STONE_HIGHLIGHT, 0.55));
    glow.addColorStop(1, rgba(ALTAR_STONE_HIGHLIGHT, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(box.centreX, gemCy, gemR * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(sampleRamp(stone, 0.2));
    ctx.beginPath();
    ctx.arc(box.centreX, gemCy, gemR * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(ALTAR_STONE_TONE);
    ctx.beginPath();
    ctx.moveTo(box.centreX, gemCy - gemR);
    ctx.lineTo(box.centreX + gemR, gemCy);
    ctx.lineTo(box.centreX, gemCy + gemR);
    ctx.lineTo(box.centreX - gemR, gemCy);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(ALTAR_STONE_HIGHLIGHT, 0.9);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX - gemR * 0.25,
      gemCy - gemR * 0.3,
      gemR * 0.28,
      gemR * 0.16,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // The top slab, overhanging the body, its front edge lit.
    ctx.fillStyle = rgb(sampleRamp(stone, 0.7));
    ctx.beginPath();
    ctx.rect(box.left, slabTop, box.width, slabH);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(stone, 0.92));
    ctx.fillRect(box.left + 1, slabTop + 1, box.width - 2, slabH * 0.3);

    // The cloth: laid along the top, falling over both ends with a gold
    // fringe and the wing-and-sun stitched on each fall.
    const clothTop = slabTop - ts * 0.02;
    const fallW = ts * 0.7;
    const fallBottom = bodyTop + bodyH * 0.72;
    const cloth = getTownRamp('oc_cloth_sky');
    ctx.fillStyle = rgb(sampleRamp(cloth, 0.55));
    ctx.fillRect(box.left + ts * 0.2, clothTop, box.width - ts * 0.4, slabH * 0.75);
    for (const dir of [-1, 1]) {
      const fx = dir < 0 ? box.left + ts * 0.2 : box.right - ts * 0.2 - fallW;
      ctx.fillStyle = rgb(sampleRamp(cloth, 0.5));
      ctx.beginPath();
      ctx.rect(fx, clothTop, fallW, fallBottom - clothTop);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgba(sampleRamp(cloth, 0.2), 0.5);
      ctx.fillRect(fx + fallW * 0.78, clothTop, fallW * 0.22, fallBottom - clothTop);
      ctx.fillStyle = rgb(CARPET_GOLD);
      ctx.fillRect(fx, fallBottom - ts * 0.05, fallW, ts * 0.05);
      const tassels = 5;
      for (let t = 0; t < tassels; t++) {
        const tx = fx + (fallW * (t + 0.5)) / tassels;
        ctx.fillRect(tx - 1, fallBottom, 2, ts * 0.05);
      }
      paintWingSun(
        ctx,
        fx + fallW / 2,
        clothTop + (fallBottom - clothTop) * 0.52,
        fallW * 0.85,
        CARPET_GOLD,
        Math.max(1, ts * 0.025),
      );
    }
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.2, clothTop, box.width - ts * 0.4, slabH * 0.75);
    inkOutline(ctx, ts * 0.7);

    // On the slab: candlesticks toward each end, a brass standard in the
    // middle, an open book west of it and the offering dish east.
    const surfaceY = slabTop + slabH * 0.35;
    for (const dir of [-1, 1]) {
      const sx = box.centreX + dir * ts * 1.1;
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.ellipse(sx, surfaceY, ts * 0.1, ts * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillRect(sx - ts * 0.025, surfaceY - ts * 0.34, ts * 0.05, ts * 0.34);
      ctx.beginPath();
      ctx.rect(sx - ts * 0.025, surfaceY - ts * 0.34, ts * 0.05, ts * 0.34);
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(BRASS_LIGHT);
      ctx.fillRect(sx - ts * 0.012, surfaceY - ts * 0.32, ts * 0.018, ts * 0.28);
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.ellipse(sx, surfaceY - ts * 0.34, ts * 0.07, ts * 0.025, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      paintTaper(ctx, sx, surfaceY - ts * 0.35, ts * 0.06, ts * 0.2);
    }

    const standardBase = surfaceY;
    const standardTop = surfaceY - ts * 0.72;
    ctx.fillStyle = rgb(BRASS_DARK);
    ctx.beginPath();
    ctx.moveTo(box.centreX - ts * 0.12, standardBase);
    ctx.lineTo(box.centreX + ts * 0.12, standardBase);
    ctx.lineTo(box.centreX + ts * 0.04, standardBase - ts * 0.1);
    ctx.lineTo(box.centreX - ts * 0.04, standardBase - ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.fillRect(
      box.centreX - ts * 0.022,
      standardTop + ts * 0.2,
      ts * 0.044,
      standardBase - standardTop - ts * 0.2,
    );
    ctx.beginPath();
    ctx.rect(
      box.centreX - ts * 0.022,
      standardTop + ts * 0.2,
      ts * 0.044,
      standardBase - standardTop - ts * 0.2,
    );
    inkOutline(ctx, ts * 0.8);
    const discCy = standardTop + ts * 0.14;
    const discGlow = ctx.createRadialGradient(
      box.centreX,
      discCy,
      1,
      box.centreX,
      discCy,
      ts * 0.34,
    );
    discGlow.addColorStop(0, rgba(FLAME_GLOW, 0.4));
    discGlow.addColorStop(1, rgba(FLAME_GLOW, 0));
    ctx.fillStyle = discGlow;
    ctx.beginPath();
    ctx.arc(box.centreX, discCy, ts * 0.34, 0, Math.PI * 2);
    ctx.fill();
    for (const dir of [-1, 1]) {
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.moveTo(box.centreX + dir * ts * 0.08, discCy);
      ctx.quadraticCurveTo(
        box.centreX + dir * ts * 0.22,
        discCy - ts * 0.2,
        box.centreX + dir * ts * 0.36,
        discCy - ts * 0.1,
      );
      ctx.quadraticCurveTo(
        box.centreX + dir * ts * 0.26,
        discCy + ts * 0.02,
        box.centreX + dir * ts * 0.08,
        discCy + ts * 0.07,
      );
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.strokeStyle = rgb(BRASS_LIGHT);
      ctx.lineWidth = Math.max(1, ts * 0.015);
      ctx.beginPath();
      ctx.moveTo(box.centreX + dir * ts * 0.12, discCy - ts * 0.02);
      ctx.quadraticCurveTo(
        box.centreX + dir * ts * 0.22,
        discCy - ts * 0.13,
        box.centreX + dir * ts * 0.31,
        discCy - ts * 0.09,
      );
      ctx.stroke();
    }
    ctx.fillStyle = rgb(BRASS_LIGHT);
    ctx.beginPath();
    ctx.arc(box.centreX, discCy, ts * 0.09, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb([255, 244, 210]);
    ctx.beginPath();
    ctx.arc(box.centreX - ts * 0.025, discCy - ts * 0.025, ts * 0.03, 0, Math.PI * 2);
    ctx.fill();

    const bookCx = box.centreX - ts * 0.55;
    const bookW = ts * 0.4;
    const bookH = ts * 0.13;
    ctx.fillStyle = rgb([110, 40, 38]);
    ctx.fillRect(bookCx - bookW / 2 - 1, surfaceY - bookH - 1, bookW + 2, bookH + 3);
    for (const dir of [-1, 1]) {
      ctx.fillStyle = rgb(dir < 0 ? PAGE_CREAM : mix(PAGE_CREAM, PAGE_SHADOW, 0.35));
      ctx.beginPath();
      ctx.moveTo(bookCx, surfaceY);
      ctx.lineTo(bookCx + (dir * bookW) / 2, surfaceY - ts * 0.02);
      ctx.lineTo(bookCx + (dir * bookW) / 2, surfaceY - bookH);
      ctx.lineTo(bookCx, surfaceY - bookH + ts * 0.03);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.rect(bookCx - bookW / 2 - 1, surfaceY - bookH - 1, bookW + 2, bookH + 3);
    inkOutline(ctx, ts * 0.7);

    const dishCx = box.centreX + ts * 0.55;
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.beginPath();
    ctx.ellipse(dishCx, surfaceY - ts * 0.03, ts * 0.17, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(BRASS_LIGHT);
    ctx.beginPath();
    ctx.ellipse(dishCx, surfaceY - ts * 0.05, ts * 0.12, ts * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    const petalColors: readonly RGB[] = [
      [214, 96, 120],
      [236, 196, 90],
      [200, 140, 204],
    ];
    petalColors.forEach((color, i) => {
      ctx.fillStyle = rgb(color);
      ctx.beginPath();
      ctx.arc(
        dishCx + (i - 1) * ts * 0.07,
        surfaceY - ts * 0.09 - (i === 1 ? ts * 0.03 : 0),
        ts * 0.04,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    });
  });
}

// ── Candelabrum ─────────────────────────────────────────────────────────────

const CANDELABRUM_HEIGHT_TILES = 1.35;
const CANDELABRUM_SHORT_HEIGHT_TILES = 0.95;

/**
 * A tall iron candelabrum on a three-footed base: a turned stem rising to a
 * branched head carrying three lit tapers, the centre one tallest. Variant 1
 * is the shorter pew-end stand.
 */
export function paintTempleCandelabrum(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.3);
    const iron = ironRamp();
    const heightTiles = variant === 1 ? CANDELABRUM_SHORT_HEIGHT_TILES : CANDELABRUM_HEIGHT_TILES;
    const baseY = box.bottom - ts * 0.16;
    const headY = baseY - ts * heightTiles;
    const cx = box.centreX;

    ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
    for (const dir of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, baseY - ts * 0.12);
      ctx.lineTo(cx + dir * ts * 0.22, baseY + (dir === 0 ? ts * 0.05 : 0));
      ctx.lineTo(cx + dir * ts * 0.22 + ts * 0.04, baseY + (dir === 0 ? ts * 0.05 : 0));
      ctx.lineTo(cx + ts * 0.03, baseY - ts * 0.14);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.beginPath();
    ctx.rect(cx - ts * 0.03, headY, ts * 0.06, baseY - headY - ts * 0.1);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(iron, 0.95), 0.8);
    ctx.fillRect(cx - ts * 0.015, headY + ts * 0.05, ts * 0.012, baseY - headY - ts * 0.2);
    for (const knopY of [0.35, 0.7]) {
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.ellipse(cx, headY + (baseY - headY) * knopY, ts * 0.06, ts * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }

    // The branched head: two arms curving up from the stem to their cups.
    const armSpan = ts * 0.26;
    const armLift = ts * 0.14;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(cx - armSpan, headY - armLift);
    ctx.quadraticCurveTo(cx - armSpan, headY + ts * 0.08, cx, headY + ts * 0.06);
    ctx.quadraticCurveTo(cx + armSpan, headY + ts * 0.08, cx + armSpan, headY - armLift);
    ctx.stroke();
    const cups = [
      { x: cx - armSpan, y: headY - armLift, h: ts * 0.2 },
      { x: cx + armSpan, y: headY - armLift, h: ts * 0.2 },
      { x: cx, y: headY - ts * 0.02, h: ts * 0.3 },
    ];
    for (const cup of cups) {
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.ellipse(cup.x, cup.y, ts * 0.07, ts * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      paintTaper(ctx, cup.x, cup.y - ts * 0.01, ts * 0.055, cup.h + jitter(rng, ts * 0.02));
    }
  });
}

// ── Perch stand ─────────────────────────────────────────────────────────────

/**
 * A tall roosting perch, the skyfowl's own pew: a turned post on a cross
 * foot with two crossbars at different heights and a bird roosting on each,
 * facing opposite ways. Variant 1 swaps which side each bird sits.
 */
export function paintPerchStand(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.34);
    const wood = woodRamp();
    const cx = box.centreX;
    const footY = box.bottom - ts * 0.14;
    const topY = footY - ts * 1.55;

    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.beginPath();
    ctx.rect(cx - ts * 0.3, footY - ts * 0.06, ts * 0.6, ts * 0.1);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.45));
    ctx.beginPath();
    ctx.rect(cx - ts * 0.045, topY, ts * 0.09, footY - topY);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.8), 0.6);
    ctx.fillRect(cx - ts * 0.03, topY + 2, ts * 0.02, footY - topY - 4);
    ctx.fillStyle = rgb(sampleRamp(iconRamp(), 0.7));
    ctx.beginPath();
    ctx.arc(cx, topY - ts * 0.04, ts * 0.07, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);

    const flip: 1 | -1 = variant === 1 ? -1 : 1;
    const bars = [
      { y: topY + ts * 0.3, span: ts * 0.42, bird: flip },
      { y: topY + ts * 0.88, span: ts * 0.36, bird: -flip },
    ] as const;
    for (const bar of bars) {
      ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
      ctx.beginPath();
      ctx.rect(cx - bar.span, bar.y, bar.span * 2, ts * 0.06);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + dir * bar.span, bar.y + ts * 0.03, ts * 0.035, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.7);
      }
      const birdX = cx + bar.bird * bar.span * 0.55 + jitter(rng, ts * 0.02);
      const facing: 1 | -1 = bar.bird === 1 ? 1 : -1;
      paintRoostingBird(ctx, birdX, bar.y, ts * 0.3, facing);
    }
  });
}

// ── Sky banner ──────────────────────────────────────────────────────────────

const BANNER_LENGTH_TILES = 1.55;

/**
 * A long hanging banner in the dome's sky blue: a turned pole with finials,
 * a gold-bordered field carrying the wing-and-sun, a sun disc below it and
 * a swallowtail hem with tassels. Tall enough that on the north wall it
 * climbs the whole wall face; on a side wall it reads as a hung standard.
 */
export function paintSkyBanner(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(
    ctx,
    frame,
    () => {
      const box = footprintBox(frame);
      const ts = frame.tileScale;
      const cloth = getTownRamp('oc_cloth_sky');
      const bannerW = box.width * 0.62;
      const left = box.centreX - bannerW / 2;
      const bottom = box.bottom - ts * 0.22;
      const top = bottom - ts * BANNER_LENGTH_TILES;
      const tail = ts * 0.2;

      const path = (): void => {
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left + bannerW, top);
        ctx.lineTo(left + bannerW, bottom);
        ctx.lineTo(box.centreX, bottom - tail);
        ctx.lineTo(left, bottom);
        ctx.closePath();
      };
      ctx.fillStyle = rgb(sampleRamp(cloth, 0.5));
      path();
      ctx.fill();
      ctx.save();
      path();
      ctx.clip();
      const fold = ctx.createLinearGradient(left, 0, left + bannerW, 0);
      fold.addColorStop(0, rgba([255, 255, 255], 0.12));
      fold.addColorStop(0.35, rgba([255, 255, 255], 0));
      fold.addColorStop(0.7, rgba([0, 0, 0], 0.18));
      fold.addColorStop(1, rgba([0, 0, 0], 0.05));
      ctx.fillStyle = fold;
      ctx.fillRect(left, top, bannerW, bottom - top);
      ctx.strokeStyle = rgb(CARPET_GOLD);
      ctx.lineWidth = ts * 0.035;
      ctx.beginPath();
      ctx.moveTo(left + ts * 0.05, top);
      ctx.lineTo(left + ts * 0.05, bottom);
      ctx.moveTo(left + bannerW - ts * 0.05, top);
      ctx.lineTo(left + bannerW - ts * 0.05, bottom);
      ctx.stroke();
      ctx.restore();
      path();
      inkOutline(ctx, ts);

      paintWingSun(
        ctx,
        box.centreX,
        top + ts * 0.42,
        bannerW * 0.95,
        [240, 222, 170],
        Math.max(1, ts * 0.03),
      );
      ctx.fillStyle = rgb(CARPET_GOLD);
      ctx.beginPath();
      ctx.arc(box.centreX, top + ts * 0.9, ts * 0.08, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      ctx.strokeStyle = rgb(CARPET_GOLD);
      ctx.lineWidth = Math.max(1, ts * 0.02);
      const rays = 8;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(box.centreX + Math.cos(a) * ts * 0.11, top + ts * 0.9 + Math.sin(a) * ts * 0.11);
        ctx.lineTo(box.centreX + Math.cos(a) * ts * 0.16, top + ts * 0.9 + Math.sin(a) * ts * 0.16);
        ctx.stroke();
      }

      ctx.fillStyle = rgb(CARPET_GOLD);
      for (const tx of [left, box.centreX, left + bannerW]) {
        const ty = tx === box.centreX ? bottom - tail : bottom;
        ctx.beginPath();
        ctx.moveTo(tx - ts * 0.025, ty);
        ctx.lineTo(tx + ts * 0.025, ty);
        ctx.lineTo(tx, ty + ts * 0.12);
        ctx.closePath();
        ctx.fill();
      }

      const iron = ironRamp();
      const poleY = top - ts * 0.04;
      ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.35));
      ctx.beginPath();
      ctx.rect(left - ts * 0.08, poleY - ts * 0.03, bannerW + ts * 0.16, ts * 0.06);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(BRASS_MID);
      for (const px of [left - ts * 0.08, left + bannerW + ts * 0.08]) {
        ctx.beginPath();
        ctx.arc(px, poleY, ts * 0.04, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.7);
      }
      ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
      ctx.lineWidth = Math.max(1, ts * 0.02);
      ctx.beginPath();
      ctx.moveTo(left, poleY);
      ctx.lineTo(box.centreX, poleY - ts * 0.16 + jitter(forkRng(rng), 1));
      ctx.lineTo(left + bannerW, poleY);
      ctx.stroke();
    },
    3,
  );
}

// ── Eagle lectern ───────────────────────────────────────────────────────────

/**
 * The reading desk beside the dais: a turned brass column on a stepped foot
 * topped by a skyfowl with its wings spread, the great book of the office
 * lying open across its back.
 */
export function paintLectern(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.34);
    const cx = box.centreX;
    const footY = box.bottom - ts * 0.12;

    ctx.fillStyle = rgb(BRASS_DARK);
    ctx.beginPath();
    ctx.ellipse(cx, footY, ts * 0.26, ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.beginPath();
    ctx.ellipse(cx, footY - ts * 0.05, ts * 0.17, ts * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);

    const columnTop = footY - ts * 0.7;
    const columnW = ts * 0.09;
    const column = ctx.createLinearGradient(cx - columnW / 2, 0, cx + columnW / 2, 0);
    column.addColorStop(0, rgb(BRASS_LIGHT));
    column.addColorStop(0.5, rgb(BRASS_MID));
    column.addColorStop(1, rgb(BRASS_DARK));
    ctx.fillStyle = column;
    ctx.beginPath();
    ctx.rect(cx - columnW / 2, columnTop, columnW, footY - ts * 0.05 - columnTop);
    ctx.fill();
    inkOutline(ctx, ts);
    for (const knop of [0.3, 0.65]) {
      ctx.fillStyle = rgb(BRASS_MID);
      ctx.beginPath();
      ctx.ellipse(
        cx,
        columnTop + (footY - columnTop) * knop,
        ts * 0.075,
        ts * 0.04,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }

    // The bird: a brass skyfowl, wings spread wide under the book.
    const birdY = columnTop - ts * 0.06;
    ctx.fillStyle = rgb(BRASS_MID);
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, birdY + ts * 0.02);
      ctx.quadraticCurveTo(
        cx + dir * ts * 0.24,
        birdY - ts * 0.16,
        cx + dir * ts * 0.44,
        birdY - ts * 0.05,
      );
      ctx.lineTo(cx + dir * ts * 0.36, birdY + ts * 0.02);
      ctx.lineTo(cx + dir * ts * 0.4, birdY + ts * 0.06);
      ctx.lineTo(cx + dir * ts * 0.28, birdY + ts * 0.08);
      ctx.quadraticCurveTo(cx + dir * ts * 0.12, birdY + ts * 0.1, cx, birdY + ts * 0.08);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.strokeStyle = rgb(BRASS_LIGHT);
      ctx.lineWidth = Math.max(1, ts * 0.018);
      ctx.beginPath();
      ctx.moveTo(cx + dir * ts * 0.06, birdY - ts * 0.01);
      ctx.quadraticCurveTo(
        cx + dir * ts * 0.22,
        birdY - ts * 0.12,
        cx + dir * ts * 0.38,
        birdY - ts * 0.05,
      );
      ctx.stroke();
    }

    // The book, open on the wings.
    const bookW = ts * 0.66;
    const bookH = ts * 0.22;
    const bookTop = birdY - ts * 0.26;
    ctx.fillStyle = rgb([96, 34, 34]);
    ctx.beginPath();
    ctx.rect(cx - bookW / 2 - 2, bookTop - 2, bookW + 4, bookH + 5);
    ctx.fill();
    inkOutline(ctx, ts);
    for (const dir of [-1, 1]) {
      ctx.fillStyle = rgb(dir < 0 ? PAGE_CREAM : mix(PAGE_CREAM, PAGE_SHADOW, 0.3));
      ctx.beginPath();
      ctx.moveTo(cx, bookTop + bookH);
      ctx.quadraticCurveTo(
        cx + (dir * bookW) / 4,
        bookTop + bookH - ts * 0.04,
        cx + (dir * bookW) / 2,
        bookTop + bookH,
      );
      ctx.lineTo(cx + (dir * bookW) / 2, bookTop);
      ctx.quadraticCurveTo(cx + (dir * bookW) / 4, bookTop - ts * 0.04, cx, bookTop + ts * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba([90, 80, 60], 0.55);
      ctx.lineWidth = 1;
      for (let line = 1; line <= 3; line++) {
        const ly = bookTop + (bookH * line) / 4.2;
        ctx.beginPath();
        ctx.moveTo(cx + dir * ts * 0.05, ly);
        ctx.lineTo(cx + (dir * bookW) / 2 - dir * ts * 0.04, ly);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = rgba(BOOK_RIBBON, 0.95);
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.02, bookTop + ts * 0.02);
    ctx.lineTo(cx + ts * 0.05 + jitter(rng, 1), bookTop + bookH + ts * 0.14);
    ctx.stroke();

    // The bird's head, rising over the book's gutter.
    const headY = bookTop - ts * 0.04;
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.beginPath();
    ctx.arc(cx, headY, ts * 0.075, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_LIGHT);
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.05, headY - ts * 0.01);
    ctx.lineTo(cx + ts * 0.15, headY + ts * 0.03);
    ctx.lineTo(cx + ts * 0.05, headY + ts * 0.05);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb([30, 22, 16]);
    ctx.beginPath();
    ctx.arc(cx + ts * 0.025, headY - ts * 0.015, ts * 0.015, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ── Votive rack ─────────────────────────────────────────────────────────────

/**
 * A two-tier iron rack of small votive candles in glass cups — the lights
 * worshippers leave burning — on a low stone step, many small flames massed
 * into one warm block rather than scattered singly across the floor.
 */
export function paintVotiveRack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.46);
    const iron = ironRamp();
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    const width = right - left;
    const baseY = box.bottom - ts * 0.12;

    const glow = ctx.createRadialGradient(
      box.centreX,
      baseY - ts * 0.4,
      1,
      box.centreX,
      baseY - ts * 0.4,
      width * 0.7,
    );
    glow.addColorStop(0, rgba(FLAME_GLOW, 0.4));
    glow.addColorStop(1, rgba(FLAME_GLOW, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(box.left, baseY - ts * 1.2, box.width, ts * 1.2);

    for (const legX of [left + ts * 0.04, right - ts * 0.04]) {
      ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
      ctx.beginPath();
      ctx.rect(legX - ts * 0.025, baseY - ts * 0.62, ts * 0.05, ts * 0.62);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    const cupPitch = ts * 0.22;
    const tiers = [
      { y: baseY - ts * 0.26, inset: 0 },
      { y: baseY - ts * 0.58, inset: cupPitch * 0.5 },
    ];
    for (const tier of [...tiers].reverse()) {
      const tl = left + tier.inset;
      const tw = width - tier.inset * 2;
      const count = Math.max(2, Math.floor(tw / cupPitch));
      for (let i = 0; i < count; i++) {
        const vx = tl + (tw * (i + 0.5)) / count;
        const glass =
          VOTIVE_GLASS[(i + Math.round(tier.inset)) % VOTIVE_GLASS.length] ?? GLASS_GOLD;
        const cupW = ts * 0.13;
        const cupH = ts * 0.15;
        const cupTop = tier.y - cupH;
        ctx.fillStyle = rgb(mix(glass, [20, 10, 10], 0.25));
        ctx.beginPath();
        ctx.moveTo(vx - cupW / 2, cupTop);
        ctx.lineTo(vx + cupW / 2, cupTop);
        ctx.lineTo(vx + cupW * 0.4, tier.y);
        ctx.lineTo(vx - cupW * 0.4, tier.y);
        ctx.closePath();
        ctx.fill();
        inkOutline(ctx, ts * 0.7);
        const inner = ctx.createRadialGradient(
          vx,
          cupTop + cupH * 0.35,
          1,
          vx,
          cupTop + cupH * 0.35,
          cupW * 0.6,
        );
        inner.addColorStop(0, rgba(FLAME_CORE, 0.9));
        inner.addColorStop(1, rgba(glass, 0));
        ctx.fillStyle = inner;
        ctx.fillRect(vx - cupW / 2, cupTop, cupW, cupH);
        if (rng() < VOTIVE_UNLIT_CHANCE) continue;
        const flameH = ts * 0.09;
        ctx.fillStyle = rgb(FLAME_EDGE);
        ctx.beginPath();
        ctx.moveTo(vx, cupTop + ts * 0.02);
        ctx.quadraticCurveTo(vx + flameH * 0.4, cupTop - flameH * 0.4, vx, cupTop - flameH);
        ctx.quadraticCurveTo(vx - flameH * 0.4, cupTop - flameH * 0.4, vx, cupTop + ts * 0.02);
        ctx.fill();
        ctx.fillStyle = rgb(FLAME_CORE);
        ctx.beginPath();
        ctx.ellipse(vx, cupTop - flameH * 0.3, flameH * 0.14, flameH * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
      ctx.beginPath();
      ctx.rect(tl - ts * 0.04, tier.y, tw + ts * 0.08, ts * 0.06);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgba(sampleRamp(iron, 0.95), 0.7);
      ctx.fillRect(tl - ts * 0.03, tier.y + 1, tw + ts * 0.06, ts * 0.012);
    }
    const stone = stoneRamp();
    ctx.fillStyle = rgb(sampleRamp(stone, 0.5));
    ctx.beginPath();
    ctx.rect(left - ts * 0.04, baseY - ts * 0.02, width + ts * 0.08, ts * 0.1);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(stone, 0.8));
    ctx.fillRect(left - ts * 0.03, baseY - ts * 0.01, width + ts * 0.06, ts * 0.025);
  });
}

// ── Font ────────────────────────────────────────────────────────────────────

/**
 * The stone font inside the door: a wide octagonal basin of still water on a
 * carved pedestal, a white feather floating on it and a teal wing carved
 * into the bowl's face.
 */
export function paintSkyFont(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.4);
    const stone = stoneRamp();
    const cx = box.centreX;
    const footY = box.bottom - ts * 0.1;

    ctx.fillStyle = rgb(sampleRamp(stone, 0.4));
    ctx.beginPath();
    ctx.rect(cx - ts * 0.26, footY - ts * 0.1, ts * 0.52, ts * 0.12);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(stone, 0.5));
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.13, footY - ts * 0.1);
    ctx.lineTo(cx - ts * 0.09, footY - ts * 0.44);
    ctx.lineTo(cx + ts * 0.09, footY - ts * 0.44);
    ctx.lineTo(cx + ts * 0.13, footY - ts * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(stone, 0.2), 0.5);
    ctx.fillRect(cx + ts * 0.03, footY - ts * 0.42, ts * 0.07, ts * 0.32);

    const bowlTop = footY - ts * 0.78;
    const bowlBottom = footY - ts * 0.42;
    const bowlW = ts * 0.84;
    ctx.fillStyle = rgb(sampleRamp(stone, 0.6));
    ctx.beginPath();
    ctx.moveTo(cx - bowlW / 2, bowlTop);
    ctx.lineTo(cx + bowlW / 2, bowlTop);
    ctx.quadraticCurveTo(cx + bowlW * 0.46, bowlBottom, cx, bowlBottom);
    ctx.quadraticCurveTo(cx - bowlW * 0.46, bowlBottom, cx - bowlW / 2, bowlTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(stone, 0.2), 0.45);
    ctx.beginPath();
    ctx.moveTo(cx + bowlW * 0.15, bowlTop);
    ctx.lineTo(cx + bowlW / 2, bowlTop);
    ctx.quadraticCurveTo(cx + bowlW * 0.46, bowlBottom, cx, bowlBottom);
    ctx.quadraticCurveTo(cx + bowlW * 0.2, bowlBottom - ts * 0.1, cx + bowlW * 0.15, bowlTop);
    ctx.fill();
    paintWingSun(
      ctx,
      cx - ts * 0.04,
      bowlTop + ts * 0.15,
      ts * 0.46,
      sampleRamp(iconRamp(), 0.55),
      Math.max(1, ts * 0.025),
    );

    ctx.fillStyle = rgb(sampleRamp(stone, 0.85));
    ctx.beginPath();
    ctx.ellipse(cx, bowlTop, bowlW / 2, ts * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const water = ctx.createLinearGradient(0, bowlTop - ts * 0.1, 0, bowlTop + ts * 0.1);
    water.addColorStop(0, rgb(WATER_DEEP));
    water.addColorStop(1, rgb(mix(WATER_DEEP, WATER_LIGHT, 0.5)));
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.ellipse(cx, bowlTop + ts * 0.01, bowlW * 0.42, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(WATER_LIGHT, 0.8);
    ctx.lineWidth = Math.max(1, ts * 0.015);
    ctx.beginPath();
    ctx.ellipse(cx - ts * 0.1, bowlTop - ts * 0.01, ts * 0.1, ts * 0.025, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    const featherX = cx + ts * 0.12 + jitter(rng, ts * 0.02);
    ctx.fillStyle = rgb(BIRD_BODY);
    ctx.beginPath();
    ctx.ellipse(featherX, bowlTop + ts * 0.02, ts * 0.1, ts * 0.028, -0.25, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  });
}

// ── Offering table ──────────────────────────────────────────────────────────

/**
 * The narthex offering table, two tiles long under a sky cloth: the brass
 * alms bowl with coins in it at the centre, a jug of cut flowers, a fan of
 * dropped feathers and two short tapers — the congregation's own corner of
 * the temple, massed on one surface.
 */
export function paintOfferingTable(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.46);
    const wood = woodRamp();
    const cloth = getTownRamp('oc_cloth_sky');
    const topY = box.bottom - ts * 0.5;
    const left = box.left + ts * 0.08;
    const right = box.right - ts * 0.08;

    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    for (const lx of [left + ts * 0.08, right - ts * 0.14]) {
      ctx.beginPath();
      ctx.rect(lx, topY, ts * 0.06, box.bottom - ts * 0.08 - topY);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }
    ctx.fillStyle = rgb(sampleRamp(cloth, 0.5));
    ctx.beginPath();
    ctx.moveTo(left, topY - ts * 0.08);
    ctx.lineTo(right, topY - ts * 0.08);
    ctx.lineTo(right, topY + ts * 0.2);
    for (let i = 8; i >= 0; i--) {
      ctx.lineTo(left + ((right - left) * i) / 8, topY + ts * (i % 2 === 0 ? 0.2 : 0.26));
    }
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(cloth, 0.85), 0.5);
    ctx.fillRect(left + 1, topY - ts * 0.08, right - left - 2, ts * 0.06);
    ctx.fillStyle = rgb(CARPET_GOLD);
    ctx.fillRect(left, topY + ts * 0.16, right - left, ts * 0.03);

    const surfaceY = topY - ts * 0.04;
    const bowlX = box.centreX;
    ctx.fillStyle = rgb(BRASS_MID);
    ctx.beginPath();
    ctx.moveTo(bowlX - ts * 0.24, surfaceY - ts * 0.12);
    ctx.quadraticCurveTo(bowlX, surfaceY + ts * 0.08, bowlX + ts * 0.24, surfaceY - ts * 0.12);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_DARK);
    ctx.beginPath();
    ctx.ellipse(bowlX, surfaceY - ts * 0.12, ts * 0.24, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(BRASS_LIGHT);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(
        bowlX + (i - 2) * ts * 0.07,
        surfaceY - ts * 0.13 + jitter(rng, ts * 0.01),
        ts * 0.035,
        ts * 0.018,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    const jugX = left + ts * 0.34;
    ctx.fillStyle = rgb([120, 150, 160]);
    ctx.beginPath();
    ctx.moveTo(jugX - ts * 0.08, surfaceY);
    ctx.quadraticCurveTo(
      jugX - ts * 0.13,
      surfaceY - ts * 0.16,
      jugX - ts * 0.05,
      surfaceY - ts * 0.24,
    );
    ctx.lineTo(jugX + ts * 0.05, surfaceY - ts * 0.24);
    ctx.quadraticCurveTo(jugX + ts * 0.13, surfaceY - ts * 0.16, jugX + ts * 0.08, surfaceY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const flowers: ReadonlyArray<{ dx: number; dy: number; color: RGB }> = [
      { dx: -0.1, dy: -0.36, color: [214, 96, 120] },
      { dx: 0.02, dy: -0.44, color: [236, 196, 90] },
      { dx: 0.12, dy: -0.34, color: [200, 140, 204] },
      { dx: -0.02, dy: -0.3, color: [240, 236, 226] },
    ];
    ctx.strokeStyle = rgb([70, 110, 60]);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (const f of flowers) {
      ctx.beginPath();
      ctx.moveTo(jugX, surfaceY - ts * 0.22);
      ctx.lineTo(jugX + ts * f.dx, surfaceY + ts * f.dy);
      ctx.stroke();
    }
    for (const f of flowers) {
      ctx.fillStyle = rgb(f.color);
      ctx.beginPath();
      ctx.arc(jugX + ts * f.dx, surfaceY + ts * f.dy, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }

    const featherBaseX = right - ts * 0.42;
    for (let i = 0; i < 3; i++) {
      const angle = -0.9 + i * 0.35;
      ctx.save();
      ctx.translate(featherBaseX + i * ts * 0.04, surfaceY - ts * 0.02);
      ctx.rotate(angle);
      ctx.fillStyle = rgb(i === 1 ? BIRD_WING : BIRD_BODY);
      ctx.beginPath();
      ctx.ellipse(0, -ts * 0.12, ts * 0.035, ts * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.restore();
    }
    for (const tx of [right - ts * 0.16, left + ts * 0.62]) {
      paintTaper(ctx, tx, surfaceY - ts * 0.02, ts * 0.05, ts * 0.14);
    }
  });
}

// ── Scripture shelf ─────────────────────────────────────────────────────────

const SCROLL_COLORS: readonly RGB[] = [
  [196, 176, 132],
  [172, 148, 108],
  [212, 196, 158],
];
const TOME_SPINE_COLORS: readonly RGB[] = [
  [94, 62, 46],
  [58, 74, 84],
  [110, 46, 46],
  [70, 82, 56],
];

/**
 * A tall shelf of scrolls and bound tomes — the dome's own library, not the
 * jars and dry goods `paintShelving`'s vial rows imply. Scrolls stand
 * pigeonholed above a shelf of upright spines below, so the silhouette reads
 * as reading material rather than stock.
 */
export function paintScriptureShelf(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = woodRamp();
    const unitH = frame.tileScale * 0.86;
    const top = box.bottom - unitH;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(box.left, top, box.width, unitH);
    inkOutline(ctx, frame.tileScale);
    const midY = top + unitH * 0.42;
    paintPlankBoard(ctx, box.left, midY, box.width, unitH * 0.07, forkRng(rng), {
      direction: 'horizontal',
      boardPx: box.width,
      ramp: wood,
    });

    const holes = 4;
    const holeH = midY - top;
    for (let i = 0; i < holes; i++) {
      const hx = box.left + box.width * ((i + 0.5) / holes);
      const scrollW = box.width * 0.12;
      const scrollH = holeH * (0.55 + jitter(rng, 0.06));
      const color = SCROLL_COLORS[(i + variant) % SCROLL_COLORS.length] ?? SCROLL_COLORS[0];
      ctx.fillStyle = rgb(color);
      ctx.beginPath();
      ctx.rect(hx - scrollW / 2, midY - scrollH, scrollW, scrollH);
      ctx.fill();
      inkOutline(ctx, frame.tileScale);
      ctx.strokeStyle = rgba([90, 78, 56], 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - scrollW / 2, midY - scrollH * 0.3);
      ctx.lineTo(hx + scrollW / 2, midY - scrollH * 0.3);
      ctx.stroke();
    }

    const spineCount = 6;
    const spineH = box.bottom - midY - unitH * 0.06;
    for (let i = 0; i < spineCount; i++) {
      const sx = box.left + box.width * ((i + 0.5) / spineCount);
      const spineW = (box.width / spineCount) * 0.7;
      const color =
        TOME_SPINE_COLORS[(i + variant) % TOME_SPINE_COLORS.length] ?? TOME_SPINE_COLORS[0];
      ctx.fillStyle = rgb(color);
      ctx.beginPath();
      ctx.rect(sx - spineW / 2, box.bottom - unitH * 0.06 - spineH, spineW, spineH);
      ctx.fill();
      inkOutline(ctx, frame.tileScale);
      ctx.fillStyle = rgba([224, 214, 180], 0.65);
      ctx.fillRect(sx - spineW * 0.3, box.bottom - unitH * 0.06 - spineH * 0.85, spineW * 0.6, 1);
    }
  });
}
