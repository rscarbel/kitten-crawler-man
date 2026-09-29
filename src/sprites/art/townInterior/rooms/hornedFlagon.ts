/**
 * Bespoke furniture for the Horned Flagon, the respectable house: a dressed
 * stone fireplace with the great curled horns the house is named for, the
 * guild's panelled booth and its screen, a walnut feast table laid in
 * sections on a crimson carpet with the old benches that go with it, a
 * polished bar and its mirrored back bar, trophies of arms, iron torchères,
 * plain trestles for the labourers' end, and a coat tree by the door. Plus
 * the tab ledger and the guild banner.
 *
 * Registered into `TOWN_INTERIOR_PROPS` in `../townInteriorProps.ts`; the
 * layout that places these lives in `src/map/town/interiors/hornedFlagon.ts`.
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
import { getTownRamp, sampleRamp, mix, type Ramp, type RGB } from '../../town/townPalette';
import { paintPlankBoard, paintStoneCourses } from '../../town/townMaterials';
import {
  BRASS,
  PEWTER,
  FIRE_GLOW,
  FLAME_CORE,
  FLAME_OUTER,
  inkedRect,
  rectPath,
  roundRectPath,
  paintBloom,
  paintCandle,
  paintCandlestick,
  paintTankard,
  paintBottle,
  paintPlate,
  paintJug,
  paintCaskEnd,
  paintTableTop,
  paintLeg,
  paintSurfaceWear,
} from './tavernKit';

type Ctx = CanvasRenderingContext2D;

function ironRamp() {
  return getTownRamp('iron_black');
}
function stoneRamp() {
  return getTownRamp('oc_stone');
}

/** The guild's own colour, kept off every citizen's outfit ramp so the banner reads as heraldry, not clothing. */
const GUILD_BANNER_FIELD: RGB = [64, 24, 28];
const GUILD_BANNER_TRIM: RGB = [188, 154, 74];

/**
 * A ledger of tabs, hung by a cord rather than standing on a desk — Brend
 * keeps the seating chart in his head (his own line), so the book on the
 * wall is where the debts get written down instead.
 */
export function paintTabLedger(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const iron = ironRamp();
    const pegY = box.top + frame.tileScale * 0.16;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.5));
    ctx.lineWidth = frame.tileScale * 0.03;
    ctx.beginPath();
    ctx.moveTo(box.centreX - frame.tileScale * 0.06, pegY);
    ctx.lineTo(box.centreX - frame.tileScale * 0.06, pegY + frame.tileScale * 0.14);
    ctx.moveTo(box.centreX + frame.tileScale * 0.06, pegY);
    ctx.lineTo(box.centreX + frame.tileScale * 0.06, pegY + frame.tileScale * 0.14);
    ctx.stroke();

    const bookW = box.width * 0.5;
    const bookH = frame.tileScale * 0.42;
    const bookTop = pegY + frame.tileScale * 0.14;
    const pageRamp = stoneRamp();
    ctx.fillStyle = rgb(mix(sampleRamp(pageRamp, 0.9), [255, 255, 255], 0.1));
    ctx.beginPath();
    ctx.rect(box.centreX - bookW / 2, bookTop, bookW, bookH);
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    ctx.strokeStyle = rgba(sampleRamp(pageRamp, 0.2), 0.55);
    ctx.lineWidth = frame.tileScale * 0.02;
    ctx.beginPath();
    ctx.moveTo(box.centreX, bookTop);
    ctx.lineTo(box.centreX, bookTop + bookH);
    ctx.stroke();

    const tallyRows = 4;
    const rowRng = forkRng(rng);
    ctx.strokeStyle = rgba(sampleRamp(iron, 0.3), 0.6);
    ctx.lineWidth = 1;
    for (let row = 0; row < tallyRows; row++) {
      const ry = bookTop + bookH * (0.2 + (row * 0.6) / tallyRows);
      for (let side = 0; side < 2; side++) {
        const sideX = side === 0 ? box.centreX - bookW * 0.32 : box.centreX + bookW * 0.08;
        const ticks = 2 + Math.floor(rowRng() * 3);
        for (let t = 0; t < ticks; t++) {
          const tx = sideX + t * frame.tileScale * 0.045;
          ctx.beginPath();
          ctx.moveTo(tx, ry - frame.tileScale * 0.05);
          ctx.lineTo(tx, ry + frame.tileScale * 0.05);
          ctx.stroke();
        }
      }
    }
  });
}

/**
 * A hanging cloth banner with a small shield emblem — the guild corner's own
 * dressing, distinct from a merchant's stock wall by being fabric and
 * heraldry rather than goods.
 */
export function paintTrophyBanner(ctx: Ctx, frame: TownPropFrame, _variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const rodY = box.top + frame.tileScale * 0.1;
    ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.45));
    ctx.lineWidth = frame.tileScale * 0.03;
    ctx.beginPath();
    ctx.moveTo(box.left + box.width * 0.1, rodY);
    ctx.lineTo(box.right - box.width * 0.1, rodY);
    ctx.stroke();

    const bannerW = box.width * 0.72;
    const bannerH = box.height * 0.62;
    const bannerTop = rodY + frame.tileScale * 0.04;
    const notchH = bannerH * 0.18;
    ctx.fillStyle = rgb(GUILD_BANNER_FIELD);
    ctx.beginPath();
    ctx.moveTo(box.centreX - bannerW / 2, bannerTop);
    ctx.lineTo(box.centreX + bannerW / 2, bannerTop);
    ctx.lineTo(box.centreX + bannerW / 2, bannerTop + bannerH - notchH);
    ctx.lineTo(box.centreX, bannerTop + bannerH);
    ctx.lineTo(box.centreX - bannerW / 2, bannerTop + bannerH - notchH);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);

    const trimInset = bannerW * 0.12;
    ctx.strokeStyle = rgba(GUILD_BANNER_TRIM, 0.85);
    ctx.lineWidth = frame.tileScale * 0.025;
    ctx.beginPath();
    ctx.rect(
      box.centreX - bannerW / 2 + trimInset,
      bannerTop + trimInset * 0.5,
      bannerW - trimInset * 2,
      bannerH * 0.55,
    );
    ctx.stroke();

    const shieldY = bannerTop + bannerH * 0.38;
    const shieldW = bannerW * 0.28;
    const shieldH = bannerH * 0.32;
    ctx.fillStyle = rgb(GUILD_BANNER_TRIM);
    ctx.beginPath();
    ctx.moveTo(box.centreX - shieldW / 2, shieldY - shieldH / 2);
    ctx.lineTo(box.centreX + shieldW / 2, shieldY - shieldH / 2);
    ctx.lineTo(box.centreX + shieldW / 2, shieldY + shieldH * 0.1);
    ctx.lineTo(box.centreX, shieldY + shieldH / 2);
    ctx.lineTo(box.centreX - shieldW / 2, shieldY + shieldH * 0.1);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.6);
  });
}

// ── The respectable house's own materials ──────────────────────────────────

/** Polished walnut: darker and redder than the inn's honey oak, the wood of a house with money in it. */
const WALNUT: Ramp = {
  shadow: [46, 26, 20],
  mid: [96, 56, 38],
  light: [146, 94, 62],
  accent: [188, 136, 94],
};
/** Scrubbed deal for the labourers' end — pale, plain, cheap. */
const DEAL: Ramp = {
  shadow: [118, 96, 70],
  mid: [178, 152, 116],
  light: [214, 194, 158],
  accent: [232, 218, 188],
};
const CRIMSON: RGB = [132, 30, 38];
const CRIMSON_DARK: RGB = [78, 16, 24];
const CRIMSON_LIGHT: RGB = [178, 62, 60];
const GOLD: RGB = [206, 164, 72];
const GOLD_LIGHT: RGB = [240, 208, 120];
const HORN: RGB = [206, 188, 150];
const HORN_DARK: RGB = [138, 118, 88];
const HORN_RIDGE: RGB = [110, 92, 66];
const SKULL: RGB = [226, 216, 190];
const SOOT: RGB = [28, 24, 26];
const IRON: RGB = [44, 44, 48];
const IRON_LIGHT: RGB = [104, 104, 112];
const MIRROR_DARK: RGB = [96, 118, 130];
const MIRROR_LIGHT: RGB = [196, 214, 220];
const WINE: RGB = [110, 24, 40];
const GLASS_CLEAR: RGB = [200, 214, 214];
const PARCHMENT: RGB = [226, 210, 170];
const SEAL_RED: RGB = [170, 30, 30];
const CLOAK_GREEN: RGB = [52, 78, 58];
const CLOAK_GREEN_LIGHT: RGB = [86, 118, 88];
const CLOAK_BROWN: RGB = [104, 72, 48];
const HAT_BLACK: RGB = [36, 32, 34];
const GRAPES: RGB = [92, 50, 96];
const BOAR: RGB = [150, 78, 46];
const BOAR_LIGHT: RGB = [200, 128, 76];
const DECANTER_AMBER: RGB = [180, 110, 40];
const BLADE: RGB = [196, 202, 210];
/** The trophy plaque is drawn smaller than a tile so the horns fit on the chimney breast below the ceiling line. */
const HORNED_TROPHY_SCALE = 0.78;

function walnutShadow(ctx: Ctx, box: ReturnType<typeof footprintBox>, ts: number): void {
  drawTownContactShadow(
    ctx,
    box.centreX,
    box.bottom - ts * 0.08,
    box.width * 0.47,
    ts * 0.14,
    0.36,
  );
}

/** A curling ram's horn from the skull outward, drawn as a tapering band with ridges across it. */
function paintCurledHorn(ctx: Ctx, rootX: number, rootY: number, side: number, ts: number): void {
  const steps = 26;
  const points: Array<{ x: number; y: number; w: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = -Math.PI * 0.55 + t * Math.PI * 1.55;
    const radius = ts * (0.5 - t * 0.3);
    points.push({
      x: rootX + side * (ts * 0.28 + Math.cos(angle) * radius * 0.9 + t * ts * 0.1),
      y: rootY + ts * 0.1 + Math.sin(angle) * radius * 0.75,
      w: ts * (0.17 - t * 0.12),
    });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    ctx.strokeStyle = rgb(i % 3 === 0 ? HORN_RIDGE : mix(HORN, HORN_DARK, i / points.length));
    ctx.lineWidth = a.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/**
 * The house's namesake over the fireplace: a walnut shield plaque carrying
 * a bleached ram's skull with a great pair of curled horns.
 */
function paintHornedTrophy(ctx: Ctx, cx: number, cy: number, ts: number): void {
  roundRectPath(ctx, cx - ts * 0.36, cy - ts * 0.34, ts * 0.72, ts * 0.72, ts * 0.12);
  ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55));
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.strokeStyle = rgb(GOLD);
  ctx.lineWidth = ts * 0.03;
  roundRectPath(ctx, cx - ts * 0.3, cy - ts * 0.28, ts * 0.6, ts * 0.6, ts * 0.1);
  ctx.stroke();
  for (const side of [-1, 1]) paintCurledHorn(ctx, cx, cy - ts * 0.1, side, ts);
  ctx.fillStyle = rgb(SKULL);
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.16, cy - ts * 0.18);
  ctx.quadraticCurveTo(cx, cy - ts * 0.3, cx + ts * 0.16, cy - ts * 0.18);
  ctx.lineTo(cx + ts * 0.09, cy + ts * 0.24);
  ctx.quadraticCurveTo(cx, cy + ts * 0.32, cx - ts * 0.09, cy + ts * 0.24);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(SOOT);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * ts * 0.07, cy - ts * 0.08, ts * 0.04, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(cx - ts * 0.02, cy + ts * 0.12, ts * 0.015, ts * 0.05);
  ctx.fillRect(cx + ts * 0.005, cy + ts * 0.12, ts * 0.015, ts * 0.05);
}

/**
 * The great fireplace: a dressed-stone surround with a single carved lintel,
 * the fire laid on brass-knobbed firedogs, the horned trophy on the chimney
 * breast above, and out front a flagged hearth behind a brass fender with
 * the fire irons and the log stack.
 */
export function paintFlagonHearth(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = stoneRamp();
    walnutShadow(ctx, box, ts);

    const hearthTop = box.top + ts * 1.0;
    const breastTop = box.top - ts * 0.98;
    const lintelY = box.top - ts * 0.05;
    const breastLeft = box.left + ts * 0.3;
    const breastRight = box.right - ts * 0.3;

    // Chimney breast from the lintel up, carrying the trophy.
    paintStoneCourses(
      ctx,
      breastLeft,
      breastTop,
      breastRight - breastLeft,
      lintelY - breastTop,
      stone,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.12);
    ctx.fillRect(
      box.centreX + ts * 0.3,
      breastTop,
      breastRight - box.centreX - ts * 0.3,
      lintelY - breastTop,
    );
    rectPath(ctx, breastLeft, breastTop, breastRight - breastLeft, lintelY - breastTop);
    inkOutline(ctx, ts);
    paintHornedTrophy(ctx, box.centreX, breastTop + ts * 0.42, ts * HORNED_TROPHY_SCALE);

    // Jambs and the opening.
    const jambW = ts * 0.42;
    const openLeft = box.left + ts * 0.16 + jambW;
    const openRight = box.right - ts * 0.16 - jambW;
    for (const jx of [box.left + ts * 0.16, box.right - ts * 0.16 - jambW]) {
      paintStoneCourses(ctx, jx, lintelY, jambW, hearthTop - lintelY, stone, forkRng(rng));
      rectPath(ctx, jx, lintelY, jambW, hearthTop - lintelY);
      inkOutline(ctx, ts);
      ctx.fillStyle = rgba(sampleRamp(stone, 1), 0.3);
      ctx.fillRect(jx + ts * 0.03, lintelY, ts * 0.06, hearthTop - lintelY);
    }
    const openTop = lintelY + ts * 0.26;
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(openLeft, hearthTop + ts * 0.02);
    ctx.lineTo(openLeft, openTop + ts * 0.14);
    ctx.quadraticCurveTo(box.centreX, openTop - ts * 0.1, openRight, openTop + ts * 0.14);
    ctx.lineTo(openRight, hearthTop + ts * 0.02);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);

    // The fire itself, big and banked high on the dogs.
    const fireBase = hearthTop - ts * 0.04;
    paintBloom(ctx, box.centreX, fireBase - ts * 0.3, ts * 1.3, FIRE_GLOW, 0.6);
    ctx.fillStyle = rgb([70, 46, 30]);
    for (const [dx, angle] of [
      [-0.2, -0.12],
      [0.2, 0.14],
      [0, 0],
    ] as const) {
      ctx.save();
      ctx.translate(box.centreX + dx * ts, fireBase - ts * 0.08);
      ctx.rotate(angle);
      rectPath(ctx, -ts * 0.55, -ts * 0.06, ts * 1.1, ts * 0.12);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.restore();
    }
    const tongues = [-0.55, -0.28, 0, 0.3, 0.56];
    for (const [scale, color] of [
      [1, FLAME_OUTER],
      [0.6, FLAME_CORE],
    ] as const) {
      ctx.fillStyle = rgb(color);
      tongues.forEach((dx, i) => {
        const x = box.centreX + dx * ts;
        const h = ts * (0.55 + (i % 2) * 0.25 + (i === 2 ? 0.2 : 0)) * scale;
        const w = ts * 0.3 * scale;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, fireBase - ts * 0.1);
        ctx.quadraticCurveTo(
          x - w / 2,
          fireBase - h * 0.6,
          x + jitter(rng, ts * 0.04),
          fireBase - h,
        );
        ctx.quadraticCurveTo(x + w / 2, fireBase - h * 0.6, x + w / 2, fireBase - ts * 0.1);
        ctx.closePath();
        ctx.fill();
      });
    }
    for (const dx of [-0.62, 0.62]) {
      inkedRect(
        ctx,
        box.centreX + dx * ts - ts * 0.03,
        fireBase - ts * 0.3,
        ts * 0.06,
        ts * 0.32,
        IRON,
        ts * 0.8,
      );
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.85));
      ctx.beginPath();
      ctx.arc(box.centreX + dx * ts, fireBase - ts * 0.32, ts * 0.06, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }

    // The lintel: one long carved stone and the shelf above it.
    const lintelH = ts * 0.3;
    inkedRect(
      ctx,
      box.left + ts * 0.08,
      lintelY - lintelH * 0.4,
      box.width - ts * 0.16,
      lintelH,
      sampleRamp(stone, 0.7),
      ts,
    );
    ctx.strokeStyle = rgba(sampleRamp(stone, 0.3), 0.8);
    ctx.lineWidth = ts * 0.02;
    rectPath(
      ctx,
      box.left + ts * 0.18,
      lintelY - lintelH * 0.4 + ts * 0.06,
      box.width - ts * 0.36,
      lintelH - ts * 0.12,
    );
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const rx = box.left + ts * 0.4 + i * ((box.width - ts * 0.8) / 6);
      ctx.fillStyle = rgb(sampleRamp(stone, 0.35));
      ctx.beginPath();
      ctx.arc(rx, lintelY - lintelH * 0.4 + lintelH / 2, ts * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    const shelfY = lintelY - lintelH * 0.4 - ts * 0.08;
    inkedRect(ctx, box.left, shelfY, box.width, ts * 0.1, sampleRamp(WALNUT, 0.6), ts);
    paintCandlestick(ctx, box.left + ts * 0.3, shelfY, ts * 0.42, ts, BRASS);
    paintCandlestick(ctx, box.right - ts * 0.3, shelfY, ts * 0.42, ts, BRASS);
    paintTankard(ctx, box.left + ts * 0.8, shelfY, ts * 0.26, ts, PEWTER, false);
    paintTankard(ctx, box.right - ts * 0.8, shelfY, ts * 0.26, ts, PEWTER, false);

    // The flagged hearth, the fender, the irons and the logs.
    paintStoneCourses(
      ctx,
      box.left + ts * 0.06,
      hearthTop,
      box.width - ts * 0.12,
      box.bottom - ts * 0.12 - hearthTop,
      stone,
      forkRng(rng),
    );
    rectPath(
      ctx,
      box.left + ts * 0.06,
      hearthTop,
      box.width - ts * 0.12,
      box.bottom - ts * 0.12 - hearthTop,
    );
    inkOutline(ctx, ts);
    paintBloom(ctx, box.centreX, hearthTop + ts * 0.2, ts * 1.4, FIRE_GLOW, 0.3);
    const fenderY = hearthTop + ts * 0.38;
    inkedRect(
      ctx,
      openLeft - ts * 0.1,
      fenderY,
      openRight - openLeft + ts * 0.2,
      ts * 0.06,
      sampleRamp(BRASS, 0.75),
      ts * 0.8,
    );
    for (const fx of [openLeft - ts * 0.1, openRight + ts * 0.05])
      inkedRect(ctx, fx, fenderY, ts * 0.05, ts * 0.18, sampleRamp(BRASS, 0.5), ts * 0.7);
    const logX = box.left + ts * 0.42;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const x = logX + (i - (2 - row) / 2) * ts * 0.17;
        const y = box.bottom - ts * 0.26 - row * ts * 0.14;
        ctx.fillStyle = rgb([84, 58, 38]);
        ctx.beginPath();
        ctx.arc(x, y, ts * 0.085, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.8);
        ctx.fillStyle = rgb([200, 160, 108]);
        ctx.beginPath();
        ctx.arc(x, y, ts * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const ironsX = box.right - ts * 0.4;
    inkedRect(ctx, ironsX - ts * 0.1, box.bottom - ts * 0.2, ts * 0.2, ts * 0.05, IRON, ts * 0.8);
    ctx.strokeStyle = rgb(IRON_LIGHT);
    ctx.lineWidth = ts * 0.025;
    for (const dx of [-0.06, 0, 0.06]) {
      ctx.beginPath();
      ctx.moveTo(ironsX + dx * ts, box.bottom - ts * 0.18);
      ctx.lineTo(ironsX + dx * ts * 1.6, box.bottom - ts * 0.72);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(BRASS, 0.8));
    ctx.beginPath();
    ctx.arc(ironsX, box.bottom - ts * 0.76, ts * 0.04, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** A heraldic shield with the guild's device: a gold fleece on crimson. */
function paintGuildCrest(ctx: Ctx, cx: number, cy: number, size: number, ts: number): void {
  ctx.fillStyle = rgb(CRIMSON);
  ctx.beginPath();
  ctx.moveTo(cx - size / 2, cy - size / 2);
  ctx.lineTo(cx + size / 2, cy - size / 2);
  ctx.lineTo(cx + size / 2, cy + size * 0.05);
  ctx.quadraticCurveTo(cx + size / 2, cy + size * 0.42, cx, cy + size * 0.6);
  ctx.quadraticCurveTo(cx - size / 2, cy + size * 0.42, cx - size / 2, cy + size * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgb(GOLD);
  ctx.lineWidth = ts * 0.035;
  ctx.stroke();
  inkOutline(ctx, ts * 0.7);
  // The fleece: a gold body with a hanging head, slung from a band.
  ctx.fillStyle = rgb(GOLD_LIGHT);
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.02, size * 0.26, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.24, cy + size * 0.16, size * 0.07, size * 0.1, 0.4, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.strokeStyle = rgb(GOLD);
  ctx.lineWidth = ts * 0.02;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.1, cy - size * 0.1);
  ctx.lineTo(cx, cy - size * 0.32);
  ctx.lineTo(cx + size * 0.1, cy - size * 0.1);
  ctx.stroke();
}

/** A brass wall lamp with its glass chimney lit. */
function paintWallLamp(ctx: Ctx, x: number, y: number, ts: number): void {
  paintBloom(ctx, x, y - ts * 0.08, ts * 0.42, FIRE_GLOW, 0.4);
  ctx.strokeStyle = rgb(sampleRamp(BRASS, 0.6));
  ctx.lineWidth = ts * 0.025;
  ctx.beginPath();
  ctx.moveTo(x, y + ts * 0.14);
  ctx.quadraticCurveTo(x, y + ts * 0.04, x, y);
  ctx.stroke();
  ctx.fillStyle = rgba(GLASS_CLEAR, 0.7);
  ctx.beginPath();
  ctx.ellipse(x, y - ts * 0.1, ts * 0.06, ts * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(FLAME_CORE);
  ctx.beginPath();
  ctx.ellipse(x, y - ts * 0.08, ts * 0.02, ts * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  inkedRect(
    ctx,
    x - ts * 0.06,
    y - ts * 0.01,
    ts * 0.12,
    ts * 0.05,
    sampleRamp(BRASS, 0.8),
    ts * 0.7,
  );
}

/**
 * The guild corner: a high walnut booth back running along the wall, deep
 * crimson squabs on its bench, the guild's crest between two lamps and the
 * framed charter beside it.
 */
export function paintGuildBooth(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const backTop = box.top - ts * 0.86;
    const seatTop = box.top + ts * 0.3;
    // Panelled back.
    paintPlankBoard(ctx, box.left, backTop, box.width, seatTop - backTop, forkRng(rng), {
      direction: 'vertical',
      boardPx: ts * 0.25,
      ramp: WALNUT,
    });
    rectPath(ctx, box.left, backTop, box.width, seatTop - backTop);
    inkOutline(ctx, ts);
    const panelCount = frame.footprintW;
    for (let i = 0; i < panelCount; i++) {
      const px = box.left + i * ts + ts * 0.1;
      inkedRect(
        ctx,
        px,
        backTop + ts * 0.1,
        ts * 0.8,
        ts * 0.42,
        sampleRamp(WALNUT, 0.35),
        ts * 0.7,
      );
      ctx.fillStyle = rgba(sampleRamp(WALNUT, 1), 0.3);
      ctx.fillRect(px + ts * 0.02, backTop + ts * 0.12, ts * 0.76, ts * 0.03);
    }
    // Cornice with gold beading.
    inkedRect(
      ctx,
      box.left - ts * 0.01,
      backTop - ts * 0.14,
      box.width + ts * 0.02,
      ts * 0.16,
      sampleRamp(WALNUT, 0.6),
      ts,
    );
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(box.left, backTop - ts * 0.02, box.width, ts * 0.025);
    // Crest, lamps, charter.
    paintGuildCrest(ctx, box.centreX, backTop + ts * 0.3, ts * 0.5, ts);
    paintWallLamp(ctx, box.centreX - ts * 0.9, backTop + ts * 0.44, ts);
    paintWallLamp(ctx, box.centreX + ts * 0.9, backTop + ts * 0.44, ts);
    const charterX = box.left + ts * 0.18;
    inkedRect(ctx, charterX, backTop + ts * 0.06, ts * 0.46, ts * 0.5, sampleRamp(BRASS, 0.55), ts);
    inkedRect(
      ctx,
      charterX + ts * 0.05,
      backTop + ts * 0.1,
      ts * 0.36,
      ts * 0.42,
      PARCHMENT,
      ts * 0.7,
    );
    ctx.strokeStyle = rgba([90, 70, 50], 0.7);
    ctx.lineWidth = ts * 0.012;
    for (let row = 0; row < 5; row++) {
      ctx.beginPath();
      ctx.moveTo(charterX + ts * 0.09, backTop + ts * (0.16 + row * 0.06));
      ctx.lineTo(charterX + ts * 0.37, backTop + ts * (0.16 + row * 0.06));
      ctx.stroke();
    }
    ctx.fillStyle = rgb(SEAL_RED);
    ctx.beginPath();
    ctx.arc(charterX + ts * 0.23, backTop + ts * 0.46, ts * 0.05, 0, Math.PI * 2);
    ctx.fill();
    const mapX = box.right - ts * 0.64;
    inkedRect(ctx, mapX, backTop + ts * 0.08, ts * 0.46, ts * 0.42, sampleRamp(WALNUT, 0.3), ts);
    inkedRect(
      ctx,
      mapX + ts * 0.05,
      backTop + ts * 0.12,
      ts * 0.36,
      ts * 0.34,
      [200, 186, 150],
      ts * 0.7,
    );
    ctx.strokeStyle = rgba([80, 104, 130], 0.8);
    ctx.lineWidth = ts * 0.015;
    ctx.beginPath();
    ctx.moveTo(mapX + ts * 0.08, backTop + ts * 0.38);
    ctx.quadraticCurveTo(
      mapX + ts * 0.2,
      backTop + ts * 0.2,
      mapX + ts * 0.38,
      backTop + ts * 0.28,
    );
    ctx.stroke();

    // Back squab and seat.
    roundRectPath(
      ctx,
      box.left + ts * 0.06,
      box.top - ts * 0.4,
      box.width - ts * 0.12,
      ts * 0.62,
      ts * 0.12,
    );
    ctx.fillStyle = rgb(CRIMSON);
    ctx.fill();
    inkOutline(ctx, ts);
    for (let i = 0; i < panelCount * 2; i++) {
      const bx = box.left + ts * 0.25 + i * ts * 0.5;
      ctx.fillStyle = rgb(CRIMSON_DARK);
      ctx.beginPath();
      ctx.arc(bx, box.top - ts * 0.1, ts * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgba(CRIMSON_LIGHT, 0.6);
    ctx.fillRect(box.left + ts * 0.1, box.top - ts * 0.36, box.width - ts * 0.2, ts * 0.05);
    roundRectPath(
      ctx,
      box.left + ts * 0.02,
      seatTop - ts * 0.08,
      box.width - ts * 0.04,
      ts * 0.26,
      ts * 0.08,
    );
    ctx.fillStyle = rgb(CRIMSON_LIGHT);
    ctx.fill();
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      box.left,
      seatTop + ts * 0.18,
      box.width,
      box.bottom - seatTop - ts * 0.24,
      sampleRamp(WALNUT, 0.35),
      ts,
    );
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(box.left, seatTop + ts * 0.2, box.width, ts * 0.02);
  });
}

/** The booth's end screen: a carved walnut partition with a brass lamp on its newel. */
export function paintBoothScreen(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const width = ts * 0.32;
    const left = box.centreX - width / 2;
    const rise = ts * 1.05;
    const southFaceTop = box.bottom - ts * 0.08 - rise;
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.4,
      width * 0.9,
      box.height * 0.45,
      0.32,
    );
    // The long top edge running north, then the end face toward the room.
    paintPlankBoard(
      ctx,
      left,
      box.top - rise + ts * 0.1,
      width,
      southFaceTop - (box.top - rise + ts * 0.1),
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: width / 2,
        ramp: WALNUT,
      },
    );
    rectPath(
      ctx,
      left,
      box.top - rise + ts * 0.1,
      width,
      southFaceTop - (box.top - rise + ts * 0.1),
    );
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(
      box.centreX - ts * 0.015,
      box.top - rise + ts * 0.12,
      ts * 0.03,
      southFaceTop - (box.top - rise + ts * 0.14),
    );
    inkedRect(ctx, left, southFaceTop, width, rise, sampleRamp(WALNUT, 0.35), ts);
    inkedRect(
      ctx,
      left + ts * 0.05,
      southFaceTop + ts * 0.1,
      width - ts * 0.1,
      rise - ts * 0.3,
      sampleRamp(WALNUT, 0.55),
      ts * 0.7,
    );
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.8));
    ctx.beginPath();
    ctx.arc(box.centreX, southFaceTop - ts * 0.02, ts * 0.09, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    paintWallLamp(ctx, box.centreX, southFaceTop - ts * 0.14, ts);
  });
}

/** Pewter goblet on a stem. */
function paintGoblet(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  ts: number,
  wine: boolean,
): void {
  const cupH = height * 0.5;
  const cupW = height * 0.5;
  ctx.fillStyle = rgb(sampleRamp(PEWTER, 0.7));
  ctx.beginPath();
  ctx.ellipse(x, baseY - ts * 0.01, cupW * 0.45, ts * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();
  inkedRect(
    ctx,
    x - ts * 0.012,
    baseY - height + cupH,
    ts * 0.024,
    height - cupH,
    sampleRamp(PEWTER, 0.8),
    ts * 0.6,
  );
  ctx.fillStyle = rgb(sampleRamp(PEWTER, 0.75));
  ctx.beginPath();
  ctx.moveTo(x - cupW / 2, baseY - height);
  ctx.lineTo(x + cupW / 2, baseY - height);
  ctx.quadraticCurveTo(x + cupW / 2, baseY - height + cupH, x, baseY - height + cupH);
  ctx.quadraticCurveTo(x - cupW / 2, baseY - height + cupH, x - cupW / 2, baseY - height);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  if (wine) {
    ctx.fillStyle = rgb(WINE);
    ctx.beginPath();
    ctx.ellipse(x, baseY - height + ts * 0.01, cupW * 0.42, ts * 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A cut-glass decanter with a round stopper. */
function paintDecanter(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  ts: number,
  liquor: RGB,
): void {
  const bodyR = height * 0.3;
  ctx.fillStyle = rgba(GLASS_CLEAR, 0.75);
  ctx.beginPath();
  ctx.arc(x, baseY - bodyR, bodyR, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.fillStyle = rgb(liquor);
  ctx.beginPath();
  ctx.arc(x, baseY - bodyR, bodyR * 0.8, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.fill();
  inkedRect(
    ctx,
    x - bodyR * 0.25,
    baseY - height * 0.86,
    bodyR * 0.5,
    height * 0.3,
    GLASS_CLEAR,
    ts * 0.6,
  );
  ctx.fillStyle = rgba(GLASS_CLEAR, 0.9);
  ctx.beginPath();
  ctx.arc(x, baseY - height * 0.9, bodyR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.fillStyle = rgba([255, 255, 255], 0.7);
  ctx.fillRect(x - bodyR * 0.55, baseY - bodyR * 1.4, bodyR * 0.2, bodyR * 0.6);
}

/**
 * The guild's own table: walnut under a crimson cloth, a decanter and two
 * goblets, a sheaf of papers under a red seal, the inkwell and a candle.
 */
export function paintBoothTable(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const top = box.top + ts * 0.06;
    const depth = ts * 0.46;
    const apronH = ts * 0.1;
    for (const lx of [box.left + ts * 0.16, box.right - ts * 0.16])
      paintLeg(ctx, lx, top + depth + apronH, box.bottom - ts * 0.06, ts * 0.1, ts, WALNUT);
    paintTableTop(
      ctx,
      box.left + ts * 0.04,
      top,
      box.width - ts * 0.08,
      depth,
      apronH,
      ts,
      WALNUT,
      rng,
    );
    ctx.fillStyle = rgb(CRIMSON);
    rectPath(
      ctx,
      box.left + ts * 0.2,
      top + ts * 0.04,
      box.width - ts * 0.4,
      depth + apronH + ts * 0.12,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(
      box.left + ts * 0.2,
      top + depth + apronH + ts * 0.1,
      box.width - ts * 0.4,
      ts * 0.025,
    );
    const standY = top + depth * 0.68;
    inkedRect(
      ctx,
      box.left + ts * 0.35,
      standY - ts * 0.08,
      ts * 0.42,
      ts * 0.12,
      PARCHMENT,
      ts * 0.8,
    );
    inkedRect(
      ctx,
      box.left + ts * 0.38,
      standY - ts * 0.12,
      ts * 0.4,
      ts * 0.1,
      mix(PARCHMENT, [255, 255, 255], 0.2),
      ts * 0.8,
    );
    ctx.fillStyle = rgb(SEAL_RED);
    ctx.beginPath();
    ctx.arc(box.left + ts * 0.6, standY - ts * 0.05, ts * 0.04, 0, Math.PI * 2);
    ctx.fill();
    inkedRect(ctx, box.left + ts * 0.88, standY - ts * 0.06, ts * 0.08, ts * 0.07, SOOT, ts * 0.7);
    ctx.strokeStyle = rgb([236, 232, 220]);
    ctx.lineWidth = ts * 0.018;
    ctx.beginPath();
    ctx.moveTo(box.left + ts * 0.93, standY - ts * 0.06);
    ctx.lineTo(box.left + ts * 1.02, standY - ts * 0.3);
    ctx.stroke();
    paintDecanter(ctx, box.right - ts * 0.7, standY + ts * 0.02, ts * 0.36, ts, WINE);
    paintGoblet(ctx, box.right - ts * 0.4, standY + ts * 0.06, ts * 0.22, ts, true);
    paintGoblet(ctx, box.left + ts * 1.15, standY + ts * 0.08, ts * 0.22, ts, true);
    paintCandlestick(ctx, box.centreX + ts * 0.1, standY - ts * 0.02, ts * 0.32, ts, BRASS);
  });
}

/**
 * One section of the feast table: walnut on turned legs, the crimson runner
 * carried across every section so a row of them reads as one board. The
 * three variants set out a roast on a charger, a candelabrum with bread and
 * grapes, and the flagons.
 */
export function paintFeastTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const top = box.top + ts * 0.02;
    const depth = ts * 0.52;
    const apronH = ts * 0.12;
    for (const lx of [box.left + ts * 0.12, box.right - ts * 0.12]) {
      paintLeg(ctx, lx, top + depth + apronH, box.bottom - ts * 0.06, ts * 0.12, ts, WALNUT);
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.45));
      ctx.beginPath();
      ctx.ellipse(lx, top + depth + apronH + ts * 0.12, ts * 0.09, ts * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
    }
    paintPlankBoard(ctx, box.left, top, box.width, depth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: depth / 3,
      ramp: WALNUT,
    });
    ctx.fillStyle = rgba(sampleRamp(WALNUT, 1), 0.25);
    ctx.fillRect(box.left, top, box.width, depth * 0.2);
    ctx.beginPath();
    ctx.moveTo(box.left, top);
    ctx.lineTo(box.right, top);
    ctx.moveTo(box.left, top + depth);
    ctx.lineTo(box.right, top + depth);
    inkOutline(ctx, ts);
    inkedRect(ctx, box.left, top + depth, box.width, apronH, sampleRamp(WALNUT, 0.3), ts);
    ctx.fillStyle = rgb(GOLD);
    for (let i = 0; i < 4; i++)
      ctx.fillRect(box.left + ts * (0.2 + i * 0.5), top + depth + ts * 0.04, ts * 0.12, ts * 0.03);
    // Runner, full width so neighbouring sections join.
    const runnerTop = top + depth * 0.3;
    ctx.fillStyle = rgb(CRIMSON);
    ctx.fillRect(box.left, runnerTop, box.width, depth * 0.44);
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(box.left, runnerTop, box.width, ts * 0.02);
    ctx.fillRect(box.left, runnerTop + depth * 0.44 - ts * 0.02, box.width, ts * 0.02);

    const standY = top + depth * 0.6;
    if (variant === 0) {
      ctx.fillStyle = rgb(sampleRamp(PEWTER, 0.8));
      ctx.beginPath();
      ctx.ellipse(box.centreX, standY, ts * 0.46, ts * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(BOAR);
      ctx.beginPath();
      ctx.ellipse(box.centreX, standY - ts * 0.1, ts * 0.32, ts * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.fillStyle = rgb(BOAR_LIGHT);
      ctx.beginPath();
      ctx.ellipse(
        box.centreX - ts * 0.08,
        standY - ts * 0.17,
        ts * 0.16,
        ts * 0.06,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = rgb([196, 60, 50]);
      ctx.beginPath();
      ctx.arc(box.centreX + ts * 0.3, standY - ts * 0.1, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      paintGoblet(ctx, box.left + ts * 0.22, standY + ts * 0.08, ts * 0.22, ts, true);
      paintGoblet(ctx, box.right - ts * 0.22, standY + ts * 0.08, ts * 0.22, ts, true);
    } else if (variant === 1) {
      const baseX = box.centreX;
      inkedRect(
        ctx,
        baseX - ts * 0.03,
        standY - ts * 0.42,
        ts * 0.06,
        ts * 0.42,
        sampleRamp(BRASS, 0.7),
        ts * 0.8,
      );
      ctx.strokeStyle = rgb(sampleRamp(BRASS, 0.6));
      ctx.lineWidth = ts * 0.035;
      ctx.beginPath();
      ctx.moveTo(baseX - ts * 0.24, standY - ts * 0.4);
      ctx.quadraticCurveTo(baseX, standY - ts * 0.2, baseX + ts * 0.24, standY - ts * 0.4);
      ctx.stroke();
      for (const dx of [-0.24, 0, 0.24])
        paintCandle(ctx, baseX + dx * ts, standY - ts * (dx === 0 ? 0.46 : 0.4), ts * 0.2, ts);
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.7));
      ctx.beginPath();
      ctx.ellipse(baseX, standY, ts * 0.12, ts * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      paintPlate(
        ctx,
        box.left + ts * 0.4,
        standY + ts * 0.02,
        ts * 0.24,
        ts,
        'bread',
        sampleRamp(PEWTER, 0.7),
      );
      for (const [dx, dy] of [
        [0, 0],
        [0.05, -0.04],
        [-0.04, -0.05],
        [0.02, -0.09],
        [0.07, 0.02],
      ] as const) {
        ctx.fillStyle = rgb(GRAPES);
        ctx.beginPath();
        ctx.arc(
          box.right - ts * 0.42 + dx * ts,
          standY - ts * 0.04 + dy * ts,
          ts * 0.04,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        inkOutline(ctx, ts * 0.5);
      }
    } else {
      paintTankard(ctx, box.left + ts * 0.36, standY + ts * 0.06, ts * 0.3, ts, PEWTER, true);
      paintJug(ctx, box.centreX, standY + ts * 0.04, ts * 0.34, ts, sampleRamp(PEWTER, 0.7));
      paintTankard(ctx, box.right - ts * 0.4, standY + ts * 0.08, ts * 0.28, ts, PEWTER, true);
      paintPlate(
        ctx,
        box.centreX + ts * 0.02,
        standY + ts * 0.14,
        ts * 0.18,
        ts,
        'cheese',
        sampleRamp(PEWTER, 0.7),
      );
    }
  });
}

/** A heavy walnut bench, carved along its front rail, older than anyone who sits on it. */
export function paintFeastBench(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.1,
      box.width * 0.46,
      ts * 0.1,
      0.32,
    );
    const seatTop = box.top + ts * 0.26;
    const seatDepth = ts * 0.24;
    for (const lx of [box.left + ts * 0.14, box.right - ts * 0.14])
      paintLeg(ctx, lx, seatTop + seatDepth, box.bottom - ts * 0.06, ts * 0.12, ts, WALNUT);
    const frontY = paintTableTop(
      ctx,
      box.left,
      seatTop,
      box.width,
      seatDepth,
      ts * 0.12,
      ts,
      WALNUT,
      rng,
    );
    ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.6));
    ctx.lineWidth = ts * 0.02;
    for (let i = 0; i < 6; i++) {
      const x = box.left + ts * 0.15 + i * ((box.width - ts * 0.3) / 5);
      ctx.beginPath();
      ctx.arc(x, frontY + ts * 0.06, ts * 0.035, 0, Math.PI);
      ctx.stroke();
    }
  });
}

/**
 * Brend's back bar: a walnut cabinet with the mead casks set into its base,
 * a bevelled mirror in the middle of its upper stage, cut-glass decanters
 * and bottles on the shelves either side, and the house's pewter flagons
 * stood along the counter.
 */
export function paintFlagonBackBar(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const counterTop = box.top + ts * 0.2;
    const backTop = box.top - ts * 0.84;

    paintPlankBoard(ctx, box.left, backTop, box.width, counterTop - backTop, forkRng(rng), {
      direction: 'vertical',
      boardPx: ts * 0.3,
      ramp: { ...WALNUT, light: sampleRamp(WALNUT, 0.45) },
    });
    rectPath(ctx, box.left, backTop, box.width, counterTop - backTop);
    inkOutline(ctx, ts);

    // The mirror.
    const mirrorW = ts * 1.3;
    const mirrorLeft = box.centreX - mirrorW / 2;
    const mirrorTop = backTop + ts * 0.1;
    const mirrorH = ts * 0.66;
    inkedRect(
      ctx,
      mirrorLeft - ts * 0.07,
      mirrorTop - ts * 0.07,
      mirrorW + ts * 0.14,
      mirrorH + ts * 0.14,
      GOLD,
      ts,
    );
    const glass = ctx.createLinearGradient(
      mirrorLeft,
      mirrorTop,
      mirrorLeft + mirrorW,
      mirrorTop + mirrorH,
    );
    glass.addColorStop(0, rgb(MIRROR_LIGHT));
    glass.addColorStop(0.5, rgb(MIRROR_DARK));
    glass.addColorStop(1, rgb(mix(MIRROR_DARK, [40, 40, 50], 0.4)));
    ctx.fillStyle = glass;
    rectPath(ctx, mirrorLeft, mirrorTop, mirrorW, mirrorH);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgba([255, 255, 255], 0.55);
    ctx.lineWidth = ts * 0.05;
    ctx.beginPath();
    ctx.moveTo(mirrorLeft + mirrorW * 0.15, mirrorTop + mirrorH * 0.55);
    ctx.lineTo(mirrorLeft + mirrorW * 0.5, mirrorTop + mirrorH * 0.1);
    ctx.moveTo(mirrorLeft + mirrorW * 0.3, mirrorTop + mirrorH * 0.7);
    ctx.lineTo(mirrorLeft + mirrorW * 0.6, mirrorTop + mirrorH * 0.3);
    ctx.stroke();
    // The glint of the room's lamps in it.
    paintBloom(
      ctx,
      mirrorLeft + mirrorW * 0.72,
      mirrorTop + mirrorH * 0.6,
      ts * 0.16,
      FIRE_GLOW,
      0.7,
    );

    // Shelves either side.
    const shelves = [backTop + ts * 0.42, backTop + ts * 0.86];
    const sides: ReadonlyArray<readonly [number, number]> = [
      [box.left + ts * 0.1, mirrorLeft - ts * 0.14],
      [mirrorLeft + mirrorW + ts * 0.14, box.right - ts * 0.1],
    ];
    sides.forEach(([left, right], sideIndex) => {
      shelves.forEach((shelfY, shelfIndex) => {
        inkedRect(ctx, left, shelfY, right - left, ts * 0.06, sampleRamp(WALNUT, 0.65), ts * 0.9);
        const count = 4;
        for (let i = 0; i < count; i++) {
          const x = left + (right - left) * ((i + 0.5) / count);
          if ((i + shelfIndex + sideIndex) % 2 === 0)
            paintDecanter(ctx, x, shelfY, ts * 0.34, ts, i % 3 === 0 ? WINE : DECANTER_AMBER);
          else
            paintBottle(
              ctx,
              x,
              shelfY,
              ts * (0.34 + jitter(rng, 0.03)),
              ts,
              i % 3 === 1 ? [46, 72, 50] : [70, 30, 36],
              GOLD,
            );
        }
      });
    });
    // Pediment.
    inkedRect(
      ctx,
      box.left - ts * 0.02,
      backTop - ts * 0.16,
      box.width + ts * 0.04,
      ts * 0.18,
      sampleRamp(WALNUT, 0.6),
      ts,
    );
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(box.left, backTop - ts * 0.04, box.width, ts * 0.025);

    // Base cabinet with the casks.
    const baseTop = counterTop + ts * 0.06;
    inkedRect(
      ctx,
      box.left,
      baseTop,
      box.width,
      box.bottom - baseTop - ts * 0.02,
      sampleRamp(WALNUT, 0.3),
      ts,
    );
    const caskY = baseTop + (box.bottom - baseTop) * 0.5;
    for (let i = 0; i < 3; i++)
      paintCaskEnd(ctx, box.centreX + (i - 1) * ts * 0.5, caskY, ts * 0.2, ts, WALNUT, true);
    for (const dx of [box.left + ts * 0.08, box.right - ts * 1.28]) {
      inkedRect(
        ctx,
        dx,
        baseTop + ts * 0.06,
        ts * 1.2,
        box.bottom - baseTop - ts * 0.16,
        sampleRamp(WALNUT, 0.45),
        ts * 0.8,
      );
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.arc(dx + ts * 0.6, baseTop + ts * 0.2, ts * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    inkedRect(
      ctx,
      box.left - ts * 0.01,
      counterTop,
      box.width + ts * 0.02,
      ts * 0.07,
      sampleRamp(WALNUT, 0.75),
      ts,
    );
    const flagonCount = 6;
    for (let i = 0; i < flagonCount; i++) {
      const x = box.left + ts * 0.35 + i * ((box.width - ts * 0.7) / (flagonCount - 1));
      paintTankard(ctx, x, counterTop, ts * 0.22, ts, PEWTER, false);
    }
  });
}

/**
 * Brend's bar: polished walnut with fluted pilasters between panels, a
 * gleaming top with the brass taps, goblets set out on a cloth, and the
 * brass foot rail — kept like furniture, not like a counter.
 */
export function paintFlagonBar(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const surfaceTop = box.top - ts * 0.16;
    const depth = ts * 0.36;
    const faceTop = surfaceTop + depth;
    const faceBottom = box.bottom - ts * 0.06;
    inkedRect(
      ctx,
      box.left,
      faceTop,
      box.width,
      faceBottom - faceTop,
      sampleRamp(WALNUT, 0.35),
      ts,
    );
    for (let i = 0; i < frame.footprintW; i++) {
      const px = box.left + i * ts + ts * 0.14;
      inkedRect(
        ctx,
        px,
        faceTop + ts * 0.1,
        ts * 0.72,
        faceBottom - faceTop - ts * 0.32,
        sampleRamp(WALNUT, 0.5),
        ts * 0.7,
      );
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.arc(px + ts * 0.36, faceTop + (faceBottom - faceTop) * 0.42, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
    for (let i = 0; i <= frame.footprintW; i++) {
      const x = Math.min(box.right - ts * 0.07, box.left + i * ts);
      inkedRect(
        ctx,
        x,
        faceTop,
        ts * 0.07,
        faceBottom - faceTop,
        sampleRamp(WALNUT, 0.6),
        ts * 0.7,
      );
    }
    const railY = faceBottom - ts * 0.16;
    inkedRect(
      ctx,
      box.left + ts * 0.02,
      railY,
      box.width - ts * 0.04,
      ts * 0.05,
      sampleRamp(BRASS, 0.8),
      ts * 0.7,
    );
    // The polished top, with a band of reflected light across it.
    paintPlankBoard(ctx, box.left, surfaceTop, box.width, depth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: depth,
      ramp: WALNUT,
    });
    ctx.fillStyle = rgba([255, 236, 210], 0.22);
    ctx.fillRect(box.left, surfaceTop + depth * 0.2, box.width, depth * 0.18);
    rectPath(ctx, box.left, surfaceTop, box.width, depth);
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      box.left - ts * 0.01,
      faceTop - ts * 0.02,
      box.width + ts * 0.02,
      ts * 0.07,
      sampleRamp(WALNUT, 0.7),
      ts,
    );
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(box.left, faceTop + ts * 0.04, box.width, ts * 0.02);

    const standY = surfaceTop + depth * 0.72;
    // Taps.
    for (let i = 0; i < 3; i++) {
      const x = box.left + ts * (0.4 + i * 0.3);
      inkedRect(
        ctx,
        x - ts * 0.03,
        standY - ts * 0.16,
        ts * 0.06,
        ts * 0.16,
        sampleRamp(BRASS, 0.8),
        ts * 0.7,
      );
      roundRectPath(ctx, x - ts * 0.04, standY - ts * 0.58, ts * 0.08, ts * 0.42, ts * 0.04);
      ctx.fillStyle = rgb(i === 1 ? CRIMSON : sampleRamp(WALNUT, 0.2));
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(GOLD_LIGHT);
      ctx.fillRect(x - ts * 0.04, standY - ts * 0.3, ts * 0.08, ts * 0.03);
    }
    // Goblets set out on a linen cloth.
    inkedRect(
      ctx,
      box.left + ts * 1.5,
      standY - ts * 0.04,
      ts * 1.4,
      ts * 0.08,
      [232, 224, 204],
      ts * 0.7,
    );
    for (let i = 0; i < 5; i++)
      paintGoblet(ctx, box.left + ts * (1.65 + i * 0.27), standY, ts * 0.22, ts, i % 2 === 0);
    paintDecanter(ctx, box.right - ts * 1.6, standY + ts * 0.02, ts * 0.36, ts, DECANTER_AMBER);
    paintTankard(ctx, box.right - ts * 1.05, standY + ts * 0.04, ts * 0.24, ts, PEWTER, true);
    paintTankard(ctx, box.right - ts * 0.55, standY + ts * 0.06, ts * 0.24, ts, PEWTER, true);
  });
}

/**
 * Trophies of arms on the wall: variant 0 a round targe over two crossed
 * axes, variant 1 a crimson kite shield over two crossed swords.
 */
export function paintFlagonTrophy(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    const cy = box.top - ts * 0.18;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(side * 0.7);
      inkedRect(
        ctx,
        -ts * 0.025,
        -ts * 0.48,
        ts * 0.05,
        ts * 0.96,
        variant === 0 ? sampleRamp(WALNUT, 0.6) : BLADE,
        ts * 0.8,
      );
      if (variant === 0) {
        ctx.fillStyle = rgb(BLADE);
        ctx.beginPath();
        ctx.moveTo(ts * 0.02, -ts * 0.46);
        ctx.quadraticCurveTo(ts * 0.26, -ts * 0.4, ts * 0.22, -ts * 0.2);
        ctx.lineTo(ts * 0.02, -ts * 0.28);
        ctx.closePath();
        ctx.fill();
        inkOutline(ctx, ts * 0.8);
      } else {
        inkedRect(ctx, -ts * 0.12, ts * 0.28, ts * 0.24, ts * 0.05, GOLD, ts * 0.7);
        inkedRect(
          ctx,
          -ts * 0.03,
          ts * 0.33,
          ts * 0.06,
          ts * 0.14,
          sampleRamp(WALNUT, 0.4),
          ts * 0.7,
        );
      }
      ctx.restore();
    }
    if (variant === 0) {
      ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.55));
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.27, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.strokeStyle = rgb(sampleRamp(BRASS, 0.7));
      ctx.lineWidth = ts * 0.04;
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.23, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.85));
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.08, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(a) * ts * 0.16,
          cy + Math.sin(a) * ts * 0.16,
          ts * 0.02,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else {
      ctx.fillStyle = rgb(CRIMSON);
      ctx.beginPath();
      ctx.moveTo(cx - ts * 0.24, cy - ts * 0.28);
      ctx.lineTo(cx + ts * 0.24, cy - ts * 0.28);
      ctx.lineTo(cx + ts * 0.22, cy + ts * 0.02);
      ctx.lineTo(cx, cy + ts * 0.34);
      ctx.lineTo(cx - ts * 0.22, cy + ts * 0.02);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.strokeStyle = rgb(GOLD);
      ctx.lineWidth = ts * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx - ts * 0.2, cy + ts * 0.02);
      ctx.lineTo(cx, cy - ts * 0.16);
      ctx.lineTo(cx + ts * 0.2, cy + ts * 0.02);
      ctx.stroke();
    }
  });
}

/** An iron torchère: tripod foot, a tall twisted shaft, a crown of three candles. */
export function paintTorchere(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    const footY = box.bottom - ts * 0.16;
    drawTownContactShadow(ctx, cx, footY + ts * 0.04, ts * 0.26, ts * 0.08, 0.34);
    const crownY = box.bottom - ts * 1.55;
    paintBloom(ctx, cx, crownY - ts * 0.18, ts * 0.6, FIRE_GLOW, 0.4);
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.04;
    for (const dx of [-0.22, 0, 0.22]) {
      ctx.beginPath();
      ctx.moveTo(cx, footY - ts * 0.16);
      ctx.lineTo(cx + dx * ts, footY + (dx === 0 ? -ts * 0.04 : 0));
      ctx.stroke();
    }
    inkedRect(ctx, cx - ts * 0.03, crownY, ts * 0.06, footY - ts * 0.14 - crownY, IRON, ts * 0.8);
    ctx.fillStyle = rgb(IRON_LIGHT);
    for (let y = crownY + ts * 0.1; y < footY - ts * 0.2; y += ts * 0.12)
      ctx.fillRect(cx - ts * 0.03, y, ts * 0.06, ts * 0.025);
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.22, crownY - ts * 0.02);
    ctx.quadraticCurveTo(cx, crownY + ts * 0.12, cx + ts * 0.22, crownY - ts * 0.02);
    ctx.stroke();
    for (const dx of [-0.22, 0, 0.22]) {
      const x = cx + dx * ts;
      const baseY = crownY - (dx === 0 ? ts * 0.06 : 0);
      inkedRect(ctx, x - ts * 0.05, baseY - ts * 0.02, ts * 0.1, ts * 0.04, IRON_LIGHT, ts * 0.7);
      paintCandle(ctx, x, baseY - ts * 0.02, ts * 0.22, ts);
    }
  });
}

/**
 * A scrubbed deal trestle for the labourers' end — pale, plain, sturdy —
 * with a brown jug, clay mugs and the heel of a loaf. Variant 1 has a pipe
 * and a hat left on it.
 */
export function paintTrestleTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const top = box.top - ts * 0.08;
    const depth = ts * 0.42;
    const apronH = ts * 0.08;
    const legTop = top + depth + apronH;
    const footY = box.bottom - ts * 0.08;
    // A-frame trestles at each end, splayed, with a stretcher between them.
    for (const lx of [box.left + ts * 0.32, box.right - ts * 0.32]) {
      for (const side of [-1, 1]) {
        ctx.fillStyle = rgb(sampleRamp(DEAL, side < 0 ? 0.55 : 0.35));
        ctx.beginPath();
        ctx.moveTo(lx - ts * 0.03, legTop);
        ctx.lineTo(lx + ts * 0.03, legTop);
        ctx.lineTo(lx + side * ts * 0.2 + ts * 0.04, footY);
        ctx.lineTo(lx + side * ts * 0.2 - ts * 0.04, footY);
        ctx.closePath();
        ctx.fill();
        inkOutline(ctx, ts * 0.8);
      }
    }
    inkedRect(
      ctx,
      box.left + ts * 0.3,
      legTop + (footY - legTop) * 0.45,
      box.width - ts * 0.6,
      ts * 0.06,
      sampleRamp(DEAL, 0.4),
      ts * 0.8,
    );
    paintTableTop(
      ctx,
      box.left + ts * 0.02,
      top,
      box.width - ts * 0.04,
      depth,
      apronH,
      ts,
      DEAL,
      rng,
    );
    paintSurfaceWear(
      ctx,
      box.left,
      top,
      box.width,
      depth,
      ts,
      forkRng(rng),
      sampleRamp(DEAL, 0.1),
      3,
    );
    const standY = top + depth * 0.66;
    const clay: Ramp = {
      shadow: [90, 52, 34],
      mid: [150, 92, 60],
      light: [196, 136, 96],
      accent: [220, 170, 130],
    };
    paintJug(ctx, box.left + ts * 0.5, standY + ts * 0.04, ts * 0.34, ts, [132, 84, 54]);
    paintTankard(ctx, box.left + ts * 0.95, standY + ts * 0.06, ts * 0.22, ts, clay, true);
    paintTankard(
      ctx,
      box.right - ts * 0.38,
      standY + ts * 0.02,
      ts * 0.22,
      ts,
      clay,
      variant === 0,
    );
    if (variant === 0) {
      paintPlate(
        ctx,
        box.centreX + ts * 0.25,
        standY,
        ts * 0.18,
        ts,
        'bread',
        sampleRamp(DEAL, 0.6),
      );
    } else {
      ctx.fillStyle = rgb(HAT_BLACK);
      ctx.beginPath();
      ctx.ellipse(
        box.centreX + ts * 0.3,
        standY - ts * 0.02,
        ts * 0.2,
        ts * 0.06,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      inkedRect(
        ctx,
        box.centreX + ts * 0.18,
        standY - ts * 0.16,
        ts * 0.24,
        ts * 0.14,
        HAT_BLACK,
        ts * 0.8,
      );
      ctx.strokeStyle = rgb([210, 200, 180]);
      ctx.lineWidth = ts * 0.02;
      ctx.beginPath();
      ctx.moveTo(box.left + ts * 1.15, standY + ts * 0.06);
      ctx.lineTo(box.left + ts * 1.35, standY + ts * 0.02);
      ctx.stroke();
    }
  });
}

/** The house carpet: crimson field, gold and black border, gold medallions down the middle, fringed ends. */
export function paintFlagonCarpet(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const inset = ts * 0.1;
    const left = box.left + inset;
    const top = box.top + inset;
    const width = box.width - inset * 2;
    const height = box.height - inset * 2;
    ctx.strokeStyle = rgb([220, 204, 160]);
    ctx.lineWidth = ts * 0.02;
    for (let y = top + ts * 0.06; y < top + height; y += ts * 0.07) {
      ctx.beginPath();
      ctx.moveTo(left - inset * 0.8, y);
      ctx.lineTo(left, y);
      ctx.moveTo(left + width, y);
      ctx.lineTo(left + width + inset * 0.8, y);
      ctx.stroke();
    }
    inkedRect(ctx, left, top, width, height, CRIMSON_DARK, ts);
    const border = Math.min(ts * 0.22, height * 0.2);
    ctx.fillStyle = rgb(GOLD);
    ctx.fillRect(
      left + border * 0.3,
      top + border * 0.3,
      width - border * 0.6,
      height - border * 0.6,
    );
    ctx.fillStyle = rgb(CRIMSON_DARK);
    ctx.fillRect(
      left + border * 0.55,
      top + border * 0.55,
      width - border * 1.1,
      height - border * 1.1,
    );
    ctx.fillStyle = rgb(CRIMSON);
    ctx.fillRect(left + border, top + border, width - border * 2, height - border * 2);
    // Medallions down the long axis.
    const horizontal = width >= height;
    const count = Math.max(1, Math.round((horizontal ? width : height) / (ts * 1.4)));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const mx = horizontal ? left + width * t : left + width / 2;
      const my = horizontal ? top + height / 2 : top + height * t;
      const r = Math.min(ts * 0.4, (horizontal ? height : width) * 0.3);
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.moveTo(mx, my - r * 0.7);
      ctx.lineTo(mx + r, my);
      ctx.lineTo(mx, my + r * 0.7);
      ctx.lineTo(mx - r, my);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgb(CRIMSON_DARK);
      ctx.beginPath();
      ctx.moveTo(mx, my - r * 0.4);
      ctx.lineTo(mx + r * 0.55, my);
      ctx.lineTo(mx, my + r * 0.4);
      ctx.lineTo(mx - r * 0.55, my);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgb(GOLD_LIGHT);
      ctx.beginPath();
      ctx.arc(mx, my, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** A turned coat tree by the door, a cloak and a coat on its pegs, a hat on top and a cane against it. */
export function paintCoatRack(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    const footY = box.bottom - ts * 0.14;
    drawTownContactShadow(ctx, cx, footY + ts * 0.04, ts * 0.28, ts * 0.08, 0.34);
    const topY = box.bottom - ts * 1.7;
    ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.3));
    ctx.lineWidth = ts * 0.05;
    for (const dx of [-0.2, 0.2]) {
      ctx.beginPath();
      ctx.moveTo(cx, footY - ts * 0.1);
      ctx.lineTo(cx + dx * ts, footY);
      ctx.stroke();
    }
    inkedRect(
      ctx,
      cx - ts * 0.035,
      topY,
      ts * 0.07,
      footY - topY,
      sampleRamp(WALNUT, 0.5),
      ts * 0.8,
    );
    // Cloak on the west peg.
    ctx.fillStyle = rgb(CLOAK_GREEN);
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.06, topY + ts * 0.2);
    ctx.quadraticCurveTo(cx - ts * 0.4, topY + ts * 0.5, cx - ts * 0.36, topY + ts * 1.25);
    ctx.lineTo(cx - ts * 0.02, topY + ts * 1.2);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(CLOAK_GREEN_LIGHT);
    ctx.fillRect(cx - ts * 0.3, topY + ts * 0.6, ts * 0.06, ts * 0.5);
    // Coat on the east peg.
    ctx.fillStyle = rgb(CLOAK_BROWN);
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.04, topY + ts * 0.26);
    ctx.lineTo(cx + ts * 0.3, topY + ts * 0.4);
    ctx.lineTo(cx + ts * 0.28, topY + ts * 1.0);
    ctx.lineTo(cx + ts * 0.06, topY + ts * 1.02);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(GOLD);
    for (let i = 0; i < 3; i++)
      ctx.fillRect(cx + ts * 0.1, topY + ts * (0.5 + i * 0.14), ts * 0.03, ts * 0.03);
    // Hat on the finial.
    ctx.fillStyle = rgb(HAT_BLACK);
    ctx.beginPath();
    ctx.ellipse(cx, topY + ts * 0.02, ts * 0.2, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    inkedRect(ctx, cx - ts * 0.11, topY - ts * 0.16, ts * 0.22, ts * 0.17, HAT_BLACK, ts * 0.8);
    ctx.fillStyle = rgb(CRIMSON);
    ctx.fillRect(cx - ts * 0.11, topY - ts * 0.04, ts * 0.22, ts * 0.03);
    // Cane.
    ctx.strokeStyle = rgb(sampleRamp(WALNUT, 0.2));
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.34, footY);
    ctx.lineTo(cx + ts * 0.2, topY + ts * 0.9);
    ctx.stroke();
    ctx.fillStyle = rgb(sampleRamp(BRASS, 0.85));
    ctx.beginPath();
    ctx.arc(cx + ts * 0.2, topY + ts * 0.88, ts * 0.035, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** A high-backed carved chair with a crimson seat and back, set by the fire for whoever the house is honouring. */
export function paintFlagonChair(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    drawTownContactShadow(ctx, cx, box.bottom - ts * 0.1, ts * 0.34, ts * 0.1, 0.34);
    const backTop = box.bottom - ts * 1.35;
    const seatY = box.bottom - ts * 0.46;
    for (const side of [-1, 1]) {
      inkedRect(
        ctx,
        cx + side * ts * 0.26 - ts * 0.04,
        backTop,
        ts * 0.08,
        box.bottom - ts * 0.08 - backTop,
        sampleRamp(WALNUT, 0.4),
        ts * 0.8,
      );
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.arc(cx + side * ts * 0.26, backTop - ts * 0.02, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
    }
    roundRectPath(ctx, cx - ts * 0.22, backTop + ts * 0.02, ts * 0.44, ts * 0.12, ts * 0.05);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.6));
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    inkedRect(
      ctx,
      cx - ts * 0.19,
      backTop + ts * 0.18,
      ts * 0.38,
      seatY - backTop - ts * 0.26,
      CRIMSON,
      ts * 0.8,
    );
    ctx.fillStyle = rgba(CRIMSON_LIGHT, 0.6);
    ctx.fillRect(cx - ts * 0.16, backTop + ts * 0.22, ts * 0.06, seatY - backTop - ts * 0.34);
    inkedRect(ctx, cx - ts * 0.3, seatY - ts * 0.08, ts * 0.6, ts * 0.16, CRIMSON_LIGHT, ts);
    inkedRect(
      ctx,
      cx - ts * 0.3,
      seatY + ts * 0.08,
      ts * 0.6,
      ts * 0.08,
      sampleRamp(WALNUT, 0.35),
      ts,
    );
  });
}

/** A plain deal bench for the trestles — the labourers' end does not get walnut. */
export function paintDealBench(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, box.width * 0.44, ts * 0.1, 0.3);
    const seatTop = box.top + ts * 0.3;
    const seatDepth = ts * 0.22;
    for (const lx of [box.left + ts * 0.2, box.right - ts * 0.2])
      paintLeg(ctx, lx, seatTop + seatDepth, box.bottom - ts * 0.08, ts * 0.09, ts, DEAL);
    paintTableTop(
      ctx,
      box.left + ts * 0.06,
      seatTop,
      box.width - ts * 0.12,
      seatDepth,
      ts * 0.08,
      ts,
      DEAL,
      rng,
    );
  });
}

/**
 * A walnut sideboard against the side wall: a silver punch bowl with its
 * ladle, a stack of chargers, a candelabrum, and cupboard doors under.
 */
export function paintFlagonSideboard(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    walnutShadow(ctx, box, ts);
    const top = box.top - ts * 0.02;
    const depth = ts * 0.34;
    const bodyTop = top + depth;
    inkedRect(
      ctx,
      box.left + ts * 0.04,
      bodyTop,
      box.width - ts * 0.08,
      box.bottom - ts * 0.08 - bodyTop,
      sampleRamp(WALNUT, 0.35),
      ts,
    );
    const doorW = (box.width - ts * 0.2) / 2;
    for (let i = 0; i < 2; i++) {
      const dx = box.left + ts * 0.1 + i * doorW;
      inkedRect(
        ctx,
        dx + ts * 0.03,
        bodyTop + ts * 0.08,
        doorW - ts * 0.06,
        box.bottom - bodyTop - ts * 0.26,
        sampleRamp(WALNUT, 0.5),
        ts * 0.7,
      );
      ctx.fillStyle = rgb(GOLD);
      ctx.beginPath();
      ctx.arc(
        dx + doorW * (i === 0 ? 0.82 : 0.18),
        bodyTop + (box.bottom - bodyTop) * 0.42,
        ts * 0.025,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    paintPlankBoard(ctx, box.left, top, box.width, depth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: depth,
      ramp: WALNUT,
    });
    ctx.fillStyle = rgba([255, 236, 210], 0.2);
    ctx.fillRect(box.left, top + depth * 0.2, box.width, depth * 0.2);
    rectPath(ctx, box.left, top, box.width, depth);
    inkOutline(ctx, ts);
    const standY = top + depth * 0.72;
    // Punch bowl.
    const bowlX = box.left + ts * 0.62;
    ctx.fillStyle = rgb(sampleRamp(PEWTER, 0.8));
    ctx.beginPath();
    ctx.moveTo(bowlX - ts * 0.3, standY - ts * 0.24);
    ctx.quadraticCurveTo(bowlX, standY + ts * 0.06, bowlX + ts * 0.3, standY - ts * 0.24);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(WINE);
    ctx.beginPath();
    ctx.ellipse(bowlX, standY - ts * 0.24, ts * 0.28, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    inkedRect(
      ctx,
      bowlX - ts * 0.06,
      standY - ts * 0.06,
      ts * 0.12,
      ts * 0.06,
      sampleRamp(PEWTER, 0.6),
      ts * 0.7,
    );
    ctx.strokeStyle = rgb(sampleRamp(PEWTER, 0.9));
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(bowlX + ts * 0.1, standY - ts * 0.26);
    ctx.lineTo(bowlX + ts * 0.3, standY - ts * 0.46);
    ctx.stroke();
    // Stacked chargers and a candelabrum.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = rgb(sampleRamp(PEWTER, 0.6 + i * 0.08));
      ctx.beginPath();
      ctx.ellipse(
        box.right - ts * 0.5,
        standY - i * ts * 0.035,
        ts * 0.22,
        ts * 0.05,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
    paintCandlestick(ctx, box.centreX + ts * 0.14, standY - ts * 0.02, ts * 0.4, ts, BRASS);
  });
}
