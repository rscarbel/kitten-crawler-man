/**
 * Bespoke furniture for the Sunken Stump Pub, the dive: a sticky plank bar
 * with a crooked shelf of mismatched bottles behind it, the back door to the
 * service alley barred with a beam, a dartboard with its chalked scores, a
 * dice table with the stakes still on it, rough scarred tables and upturned
 * barrels to lean on, a stack of empties waiting for the alley, a heap of
 * broken stools, and the spills nobody has mopped.
 *
 * The back door is the door's face on the north wall, not a second exit: the
 * alley behind it belongs to the town plan's exterior geometry, which the
 * murder mystery's route is built on.
 *
 * Registered into `TOWN_INTERIOR_PROPS` in `../townInteriorProps.ts`; the
 * layout that places these lives in `src/map/town/interiors/sunkenStumpPub.ts`.
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
import { paintPlankBoard } from '../../town/townMaterials';
import {
  PEWTER,
  CHALK,
  CROCKERY_WHITE,
  inkedRect,
  rectPath,
  roundRectPath,
  paintBloom,
  paintCandle,
  paintTankard,
  paintBottle,
  paintPlate,
  paintCaskEnd,
  paintTableTop,
  paintLeg,
  paintSurfaceWear,
  FIRE_GLOW,
} from './tavernKit';

type Ctx = CanvasRenderingContext2D;

/** Weathered grey-brown plank, the colour of wood that has been wet more often than dry. */
const DIVE_WOOD: Ramp = {
  shadow: [40, 34, 28],
  mid: [88, 76, 60],
  light: [132, 118, 94],
  accent: [158, 144, 116],
};
/** Barrel oak gone dark with spillage. */
const CASK_WOOD: Ramp = {
  shadow: [52, 36, 24],
  mid: [104, 72, 44],
  light: [150, 108, 68],
  accent: [178, 136, 92],
};
/** Clay mugs, chipped. */
const CLAY_MUG: Ramp = {
  shadow: [84, 52, 36],
  mid: [138, 92, 62],
  light: [182, 134, 98],
  accent: [206, 164, 128],
};
const SPILL: RGB = [70, 50, 24];
const SPILL_WET: RGB = [150, 110, 44];
const SAWDUST: RGB = [196, 170, 120];
const GLASS_SHARD: RGB = [180, 206, 196];
const IRON: RGB = [40, 40, 44];
const IRON_LIGHT: RGB = [96, 96, 104];
const RUST: RGB = [120, 62, 36];
const SLATE: RGB = [44, 46, 50];
const CARD_BACK: RGB = [120, 34, 36];
const CARD_FACE: RGB = [230, 222, 200];
const COIN: RGB = [214, 176, 80];
const COIN_DARK: RGB = [150, 116, 48];
const DIE: RGB = [226, 218, 196];
const PIP: RGB = [30, 26, 24];
const MIRROR_TARNISH: RGB = [118, 128, 120];
const PICKLE_BRINE: RGB = [184, 190, 120];
const EGG: RGB = [236, 228, 196];
const MOP_HEAD: RGB = [176, 166, 140];
const TIN: RGB = [150, 154, 150];
const BUCKET: RGB = [110, 104, 96];
const DARTBOARD_CORK: RGB = [150, 104, 60];
const DARTBOARD_LIGHT: RGB = [226, 212, 176];
const DARTBOARD_DARK: RGB = [40, 34, 28];
const DARTBOARD_RED: RGB = [168, 40, 40];
const DARTBOARD_GREEN: RGB = [52, 104, 64];
const DART_FLIGHT: RGB = [196, 60, 50];
const BOTTLES: readonly RGB[] = [
  [52, 84, 52],
  [104, 64, 36],
  [58, 64, 96],
  [96, 30, 36],
  [140, 120, 60],
  [70, 72, 68],
];

function diveShadow(ctx: Ctx, box: ReturnType<typeof footprintBox>, ts: number): void {
  drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.08, box.width * 0.46, ts * 0.14, 0.4);
}

/** A splash of spilled drink soaked into a surface. */
function paintSpill(ctx: Ctx, cx: number, cy: number, radius: number, rng: Rng): void {
  ctx.fillStyle = rgba(SPILL, 0.7);
  ctx.beginPath();
  const lobes = 7;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const r = radius * (0.7 + rng() * 0.4);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.45;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(SPILL_WET, 0.35);
  ctx.beginPath();
  ctx.ellipse(cx - radius * 0.2, cy - radius * 0.08, radius * 0.3, radius * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A candle stub stuck in the neck of an empty bottle, wax run down its side. */
function paintBottleCandle(ctx: Ctx, x: number, baseY: number, ts: number): void {
  paintBottle(ctx, x, baseY, ts * 0.28, ts, [60, 76, 58], null);
  ctx.fillStyle = rgb([226, 216, 186]);
  ctx.fillRect(x - ts * 0.03, baseY - ts * 0.26, ts * 0.018, ts * 0.12);
  paintCandle(ctx, x, baseY - ts * 0.28, ts * 0.08, ts);
}

/**
 * Behind the bar: two crooked plank shelves on iron brackets, crowded with
 * bottles no two alike, a tarnished mirror shard, a jar of pickled eggs and,
 * on variant 1, a chalked NO CREDIT board and a keg on its cradle below.
 */
export function paintStumpBackShelf(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const tilt = variant === 0 ? ts * 0.04 : -ts * 0.05;
    const shelfYs = [box.top - ts * 0.55, box.top + ts * 0.02];
    // Backboard nailed straight to the plaster.
    paintPlankBoard(
      ctx,
      box.left + ts * 0.04,
      box.top - ts * 0.92,
      box.width - ts * 0.08,
      ts * 1.4,
      forkRng(rng),
      {
        direction: 'horizontal',
        boardPx: ts * 0.24,
        ramp: DIVE_WOOD,
      },
    );
    ctx.fillStyle = rgba([20, 16, 12], 0.3);
    ctx.fillRect(box.left + ts * 0.04, box.top - ts * 0.92, box.width - ts * 0.08, ts * 1.4);
    rectPath(ctx, box.left + ts * 0.04, box.top - ts * 0.92, box.width - ts * 0.08, ts * 1.4);
    inkOutline(ctx, ts);

    if (variant === 1) {
      const mirrorX = box.left + ts * 1.9;
      ctx.fillStyle = rgb(MIRROR_TARNISH);
      ctx.beginPath();
      ctx.moveTo(mirrorX, box.top - ts * 0.88);
      ctx.lineTo(mirrorX + ts * 0.7, box.top - ts * 0.86);
      ctx.lineTo(mirrorX + ts * 0.5, box.top - ts * 0.6);
      ctx.lineTo(mirrorX + ts * 0.06, box.top - ts * 0.62);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      ctx.strokeStyle = rgba([240, 244, 236], 0.6);
      ctx.lineWidth = ts * 0.015;
      ctx.beginPath();
      ctx.moveTo(mirrorX + ts * 0.2, box.top - ts * 0.84);
      ctx.lineTo(mirrorX + ts * 0.34, box.top - ts * 0.66);
      ctx.stroke();
    }

    shelfYs.forEach((shelfY, shelfIndex) => {
      const count = 7;
      for (let i = 0; i < count; i++) {
        const x = box.left + ts * 0.2 + i * ((box.width - ts * 0.4) / (count - 1));
        if (variant === 1 && shelfIndex === 0 && x > box.left + ts * 1.8) continue;
        const y = shelfY + tilt * ((x - box.left) / box.width - 0.5);
        const glass = BOTTLES[Math.floor(rng() * BOTTLES.length)];
        const height = ts * (0.22 + rng() * 0.16);
        if (shelfIndex === 1 && i === 3 && variant === 0) {
          // A jar of pickled eggs, the one thing on the shelf anybody eats.
          roundRectPath(ctx, x - ts * 0.13, y - ts * 0.32, ts * 0.26, ts * 0.32, ts * 0.05);
          ctx.fillStyle = rgba(PICKLE_BRINE, 0.85);
          ctx.fill();
          inkOutline(ctx, ts * 0.8);
          ctx.fillStyle = rgb(EGG);
          for (const [dx, dy] of [
            [-0.05, -0.08],
            [0.05, -0.1],
            [0, -0.2],
          ] as const) {
            ctx.beginPath();
            ctx.ellipse(x + dx * ts, y + dy * ts, ts * 0.045, ts * 0.055, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          inkedRect(ctx, x - ts * 0.14, y - ts * 0.36, ts * 0.28, ts * 0.05, RUST, ts * 0.7);
          continue;
        }
        if ((i + shelfIndex) % 4 === 3) {
          paintTankard(ctx, x, y, ts * 0.18, ts, CLAY_MUG, false);
          continue;
        }
        const tipped = rng() < 0.12;
        if (tipped) {
          ctx.save();
          ctx.translate(x, y - ts * 0.05);
          ctx.rotate(Math.PI / 2);
          paintBottle(ctx, 0, ts * 0.08, height, ts, glass, null);
          ctx.restore();
        } else {
          paintBottle(ctx, x, y, height, ts, glass, rng() < 0.5 ? [196, 184, 150] : null);
        }
      }
      // The shelf plank, set a little crooked on its brackets.
      ctx.fillStyle = rgb(sampleRamp(DIVE_WOOD, 0.6));
      ctx.beginPath();
      ctx.moveTo(box.left + ts * 0.06, shelfY - tilt / 2);
      ctx.lineTo(box.right - ts * 0.06, shelfY + tilt / 2);
      ctx.lineTo(box.right - ts * 0.06, shelfY + tilt / 2 + ts * 0.07);
      ctx.lineTo(box.left + ts * 0.06, shelfY - tilt / 2 + ts * 0.07);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts);
      for (const bx of [box.left + ts * 0.3, box.right - ts * 0.3]) {
        ctx.strokeStyle = rgb(IRON);
        ctx.lineWidth = ts * 0.03;
        ctx.beginPath();
        ctx.moveTo(bx, shelfY + ts * 0.07);
        ctx.lineTo(bx, shelfY + ts * 0.2);
        ctx.lineTo(bx + ts * 0.1, shelfY + ts * 0.07);
        ctx.stroke();
      }
    });

    if (variant === 1) {
      const boardX = box.left + ts * 1.95;
      const boardY = box.top - ts * 0.5;
      inkedRect(ctx, boardX, boardY, ts * 0.8, ts * 0.42, SLATE, ts);
      ctx.strokeStyle = rgba(CHALK, 0.9);
      ctx.lineWidth = ts * 0.022;
      // NO CREDIT, as the barkeep's hand would chalk it: blocky strokes.
      const letterY = boardY + ts * 0.1;
      const letterH = ts * 0.12;
      const glyphs = 8;
      for (let i = 0; i < glyphs; i++) {
        if (i === 2) continue;
        const lx = boardX + ts * 0.08 + i * ts * 0.085;
        ctx.beginPath();
        ctx.moveTo(lx, letterY + letterH);
        ctx.lineTo(lx, letterY);
        ctx.lineTo(lx + ts * 0.05, letterY + (i % 2 === 0 ? letterH : 0));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(boardX + ts * 0.1, boardY + ts * 0.32);
      ctx.lineTo(boardX + ts * 0.7, boardY + ts * 0.3);
      ctx.stroke();
      // A keg on a cradle under the counter line.
      paintCaskEnd(ctx, box.left + ts * 0.5, box.bottom - ts * 0.3, ts * 0.22, ts, CASK_WOOD, true);
    }
  });
}

/**
 * The sticky bar: rough planks on a plank front, a top gone dark in rings
 * and spills, clay mugs left where they were emptied. Variant 0 carries a
 * keg on the bar with its tap; variant 1 a mug on its side, a tray of heels
 * of bread and a stub of candle in a bottle.
 */
export function paintStumpBar(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const surfaceTop = box.top - ts * 0.1;
    const depth = ts * 0.34;
    const faceTop = surfaceTop + depth;
    const faceBottom = box.bottom - ts * 0.06;
    paintPlankBoard(ctx, box.left, faceTop, box.width, faceBottom - faceTop, forkRng(rng), {
      direction: 'vertical',
      boardPx: ts * 0.22,
      ramp: DIVE_WOOD,
    });
    ctx.fillStyle = rgba([16, 12, 8], 0.25);
    ctx.fillRect(box.left, faceTop, box.width, faceBottom - faceTop);
    rectPath(ctx, box.left, faceTop, box.width, faceBottom - faceTop);
    inkOutline(ctx, ts);
    // Kick marks and a nailed-on patch board.
    ctx.fillStyle = rgba([20, 16, 12], 0.45);
    for (let i = 0; i < 5; i++) {
      const kx = box.left + ts * 0.2 + rng() * (box.width - ts * 0.4);
      ctx.fillRect(kx, faceBottom - ts * (0.12 + rng() * 0.12), ts * 0.1, ts * 0.025);
    }
    const patchX = box.left + ts * (0.6 + variant * 1.1);
    inkedRect(
      ctx,
      patchX,
      faceTop + ts * 0.14,
      ts * 0.5,
      ts * 0.14,
      sampleRamp(DIVE_WOOD, 0.7),
      ts * 0.8,
    );
    ctx.fillStyle = rgb(IRON_LIGHT);
    for (const nx of [patchX + ts * 0.05, patchX + ts * 0.43])
      ctx.fillRect(nx, faceTop + ts * 0.19, ts * 0.025, ts * 0.025);

    paintPlankBoard(
      ctx,
      box.left - ts * 0.02,
      surfaceTop,
      box.width + ts * 0.04,
      depth,
      forkRng(rng),
      {
        direction: 'horizontal',
        boardPx: depth / 2,
        ramp: DIVE_WOOD,
      },
    );
    rectPath(ctx, box.left - ts * 0.02, surfaceTop, box.width + ts * 0.04, depth);
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      box.left - ts * 0.02,
      faceTop - ts * 0.02,
      box.width + ts * 0.04,
      ts * 0.06,
      sampleRamp(DIVE_WOOD, 0.5),
      ts,
    );
    paintSurfaceWear(ctx, box.left, surfaceTop, box.width, depth, ts, forkRng(rng), SPILL, 6);
    paintSpill(
      ctx,
      box.left + ts * (1.2 + variant * 0.6),
      surfaceTop + depth * 0.6,
      ts * 0.22,
      forkRng(rng),
    );
    // A drip running down the front.
    ctx.fillStyle = rgba(SPILL, 0.6);
    ctx.fillRect(box.left + ts * (1.3 + variant * 0.6), faceTop, ts * 0.04, ts * 0.22);

    const standY = surfaceTop + depth * 0.7;
    if (variant === 0) {
      const kegX = box.left + ts * 0.55;
      inkedRect(
        ctx,
        kegX - ts * 0.3,
        standY - ts * 0.08,
        ts * 0.6,
        ts * 0.08,
        sampleRamp(DIVE_WOOD, 0.3),
        ts,
      );
      paintCaskEnd(ctx, kegX, standY - ts * 0.34, ts * 0.27, ts, CASK_WOOD, true);
      paintTankard(ctx, box.left + ts * 1.3, standY + ts * 0.02, ts * 0.22, ts, CLAY_MUG, true);
      paintTankard(ctx, box.left + ts * 1.75, standY, ts * 0.2, ts, CLAY_MUG, false);
      paintTankard(ctx, box.right - ts * 0.4, standY + ts * 0.03, ts * 0.22, ts, PEWTER, true);
    } else {
      ctx.save();
      ctx.translate(box.left + ts * 0.5, standY - ts * 0.06);
      ctx.rotate(Math.PI / 2);
      paintTankard(ctx, 0, ts * 0.1, ts * 0.2, ts, CLAY_MUG, false);
      ctx.restore();
      paintPlate(
        ctx,
        box.left + ts * 1.3,
        standY - ts * 0.02,
        ts * 0.26,
        ts,
        'crumbs',
        sampleRamp(DIVE_WOOD, 0.7),
      );
      paintBottleCandle(ctx, box.left + ts * 2.0, standY, ts);
      paintTankard(ctx, box.right - ts * 0.4, standY + ts * 0.02, ts * 0.22, ts, CLAY_MUG, true);
    }
  });
}

/**
 * The back door onto the service alley: heavy planks in a rough frame,
 * strap hinges, a squared beam dropped across it into two iron brackets and
 * a padlock on the hasp — barred from this side, and meant to stay barred.
 */
export function paintBoltedDoor(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const doorTop = box.top - ts * 0.9;
    const doorBottom = box.bottom - ts * 0.12;
    const doorLeft = box.left + ts * 0.12;
    const doorW = box.width - ts * 0.24;
    // Frame and a worn stone step.
    inkedRect(
      ctx,
      doorLeft - ts * 0.08,
      doorTop - ts * 0.08,
      doorW + ts * 0.16,
      doorBottom - doorTop + ts * 0.08,
      sampleRamp(DIVE_WOOD, 0.25),
      ts,
    );
    paintPlankBoard(ctx, doorLeft, doorTop, doorW, doorBottom - doorTop, forkRng(rng), {
      direction: 'vertical',
      boardPx: doorW / 4,
      ramp: DIVE_WOOD,
    });
    rectPath(ctx, doorLeft, doorTop, doorW, doorBottom - doorTop);
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      box.left + ts * 0.02,
      doorBottom,
      box.width - ts * 0.04,
      ts * 0.1,
      getTownRamp('oc_stone').mid,
      ts,
    );
    // Strap hinges.
    for (const hy of [doorTop + ts * 0.18, doorBottom - ts * 0.3]) {
      inkedRect(ctx, doorLeft - ts * 0.04, hy, doorW * 0.6, ts * 0.06, IRON, ts * 0.7);
      ctx.fillStyle = rgb(IRON_LIGHT);
      ctx.fillRect(doorLeft + doorW * 0.1, hy + ts * 0.015, ts * 0.03, ts * 0.03);
      ctx.fillRect(doorLeft + doorW * 0.4, hy + ts * 0.015, ts * 0.03, ts * 0.03);
    }
    // The beam across, in its brackets.
    const beamY = doorTop + (doorBottom - doorTop) * 0.46;
    for (const bx of [doorLeft - ts * 0.08, doorLeft + doorW - ts * 0.02])
      inkedRect(ctx, bx, beamY - ts * 0.08, ts * 0.1, ts * 0.22, IRON, ts * 0.8);
    inkedRect(
      ctx,
      box.left + ts * 0.02,
      beamY - ts * 0.04,
      box.width - ts * 0.04,
      ts * 0.13,
      sampleRamp(CASK_WOOD, 0.45),
      ts,
    );
    ctx.fillStyle = rgba(sampleRamp(CASK_WOOD, 0.9), 0.5);
    ctx.fillRect(box.left + ts * 0.04, beamY - ts * 0.03, box.width - ts * 0.08, ts * 0.025);
    // Hasp and padlock.
    const lockX = doorLeft + doorW * 0.72;
    const lockY = beamY + ts * 0.2;
    inkedRect(
      ctx,
      lockX - ts * 0.02,
      lockY - ts * 0.06,
      ts * 0.04,
      ts * 0.08,
      IRON_LIGHT,
      ts * 0.6,
    );
    roundRectPath(ctx, lockX - ts * 0.06, lockY, ts * 0.12, ts * 0.1, ts * 0.02);
    ctx.fillStyle = rgb(RUST);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    // A chalk mark somebody left on it and nobody rubbed off.
    ctx.strokeStyle = rgba(CHALK, 0.75);
    ctx.lineWidth = ts * 0.02;
    ctx.beginPath();
    ctx.moveTo(doorLeft + doorW * 0.2, doorTop + ts * 0.34);
    ctx.lineTo(doorLeft + doorW * 0.5, doorTop + ts * 0.5);
    ctx.moveTo(doorLeft + doorW * 0.5, doorTop + ts * 0.34);
    ctx.lineTo(doorLeft + doorW * 0.2, doorTop + ts * 0.5);
    ctx.stroke();
  });
}

/**
 * A dartboard on a scarred backing board: coloured rings and wedges, three
 * darts stuck in (one well off the treble), and the backing pocked with the
 * misses.
 */
export function paintDartboard(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    const cy = box.top - ts * 0.3;
    inkedRect(
      ctx,
      box.left + ts * 0.06,
      cy - ts * 0.46,
      box.width - ts * 0.12,
      ts * 0.92,
      sampleRamp(DIVE_WOOD, 0.4),
      ts,
    );
    ctx.fillStyle = rgba([20, 16, 12], 0.6);
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = ts * (0.33 + rng() * 0.1);
      ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, ts * 0.02, ts * 0.02);
    }
    const radius = ts * 0.34;
    ctx.fillStyle = rgb(DARTBOARD_DARK);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const wedges = 16;
    for (let i = 0; i < wedges; i++) {
      const a0 = (i / wedges) * Math.PI * 2;
      const a1 = ((i + 1) / wedges) * Math.PI * 2;
      ctx.fillStyle = rgb(i % 2 === 0 ? DARTBOARD_LIGHT : DARTBOARD_DARK);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius * 0.86, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    for (const [r, width] of [
      [0.84, 0.08],
      [0.52, 0.07],
    ] as const) {
      for (let i = 0; i < wedges; i++) {
        const a0 = (i / wedges) * Math.PI * 2;
        const a1 = ((i + 1) / wedges) * Math.PI * 2;
        ctx.strokeStyle = rgb(i % 2 === 0 ? DARTBOARD_RED : DARTBOARD_GREEN);
        ctx.lineWidth = ts * width;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * r, a0, a1);
        ctx.stroke();
      }
    }
    ctx.fillStyle = rgb(DARTBOARD_GREEN);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(DARTBOARD_RED);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(DARTBOARD_CORK);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.96, 0, Math.PI * 2);
    ctx.stroke();
    for (const [dx, dy] of [
      [0.05, -0.04],
      [-0.12, 0.1],
      [0.2, 0.16],
    ] as const) {
      const x = cx + dx * ts;
      const y = cy + dy * ts;
      ctx.strokeStyle = rgb(IRON_LIGHT);
      ctx.lineWidth = ts * 0.02;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ts * 0.08, y + ts * 0.06);
      ctx.stroke();
      ctx.fillStyle = rgb(DART_FLIGHT);
      ctx.beginPath();
      ctx.moveTo(x + ts * 0.07, y + ts * 0.05);
      ctx.lineTo(x + ts * 0.14, y + ts * 0.04);
      ctx.lineTo(x + ts * 0.11, y + ts * 0.11);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/**
 * The scoreboard beside the dartboard: a slate chalked with two columns of
 * names and scores, several struck through, and a chalk nub on a string.
 */
export function paintChalkTally(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const top = box.top - ts * 0.78;
    const height = ts * 0.9;
    inkedRect(
      ctx,
      box.left + ts * 0.08,
      top,
      box.width - ts * 0.16,
      height,
      sampleRamp(DIVE_WOOD, 0.45),
      ts,
    );
    inkedRect(
      ctx,
      box.left + ts * 0.14,
      top + ts * 0.06,
      box.width - ts * 0.28,
      height - ts * 0.12,
      SLATE,
      ts * 0.8,
    );
    ctx.strokeStyle = rgba(CHALK, 0.85);
    ctx.lineWidth = ts * 0.018;
    ctx.beginPath();
    ctx.moveTo(box.centreX, top + ts * 0.12);
    ctx.lineTo(box.centreX, top + height - ts * 0.12);
    ctx.stroke();
    for (let row = 0; row < 5; row++) {
      const y = top + ts * (0.18 + row * 0.14);
      for (const side of [0, 1]) {
        const x0 = box.left + ts * (0.2 + side * 0.34);
        const w = ts * (0.12 + rng() * 0.12);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + w, y);
        ctx.stroke();
        if (rng() < 0.35) {
          ctx.beginPath();
          ctx.moveTo(x0 - ts * 0.02, y + ts * 0.03);
          ctx.lineTo(x0 + w + ts * 0.02, y - ts * 0.03);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = rgb([200, 190, 160]);
    ctx.lineWidth = ts * 0.01;
    ctx.beginPath();
    ctx.moveTo(box.right - ts * 0.16, top + height - ts * 0.1);
    ctx.lineTo(box.right - ts * 0.1, top + height + ts * 0.2);
    ctx.stroke();
    inkedRect(
      ctx,
      box.right - ts * 0.13,
      top + height + ts * 0.2,
      ts * 0.05,
      ts * 0.08,
      CHALK,
      ts * 0.5,
    );
  });
}

/**
 * The dice table: a scarred round-cornered board with the game still on it —
 * cards fanned face down, two dice mid-roll, little stacks of coin in front
 * of each seat, a knife driven into the wood, a candle in a bottle.
 */
export function paintDiceTable(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const top = box.top + ts * 0.04;
    const depth = ts * 0.52;
    const apronH = ts * 0.1;
    for (const lx of [box.left + ts * 0.16, box.right - ts * 0.16])
      paintLeg(ctx, lx, top + depth + apronH, box.bottom - ts * 0.06, ts * 0.1, ts, DIVE_WOOD);
    paintTableTop(
      ctx,
      box.left + ts * 0.02,
      top,
      box.width - ts * 0.04,
      depth,
      apronH,
      ts,
      DIVE_WOOD,
      rng,
    );
    // A felt of sorts: an old green blanket thrown over the middle.
    ctx.fillStyle = rgb([58, 88, 60]);
    rectPath(ctx, box.left + ts * 0.3, top + depth * 0.18, box.width - ts * 0.6, depth * 0.72);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    const midY = top + depth * 0.55;
    // Cards fanned.
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(box.left + ts * 0.6 + i * ts * 0.05, midY);
      ctx.rotate(-0.4 + i * 0.25);
      inkedRect(
        ctx,
        -ts * 0.05,
        -ts * 0.14,
        ts * 0.1,
        ts * 0.14,
        i === 3 ? CARD_FACE : CARD_BACK,
        ts * 0.6,
      );
      ctx.restore();
    }
    // Two dice.
    for (const [dx, pips] of [
      [0.95, 3],
      [1.12, 5],
    ] as const) {
      const x = box.left + ts * dx;
      const y = midY - ts * 0.06;
      inkedRect(ctx, x, y, ts * 0.1, ts * 0.1, DIE, ts * 0.6);
      ctx.fillStyle = rgb(PIP);
      const spots: ReadonlyArray<readonly [number, number]> =
        pips === 3
          ? [
              [0.25, 0.25],
              [0.5, 0.5],
              [0.75, 0.75],
            ]
          : [
              [0.25, 0.25],
              [0.75, 0.25],
              [0.5, 0.5],
              [0.25, 0.75],
              [0.75, 0.75],
            ];
      for (const [px, py] of spots)
        ctx.fillRect(
          x + ts * 0.1 * px - ts * 0.01,
          y + ts * 0.1 * py - ts * 0.01,
          ts * 0.02,
          ts * 0.02,
        );
    }
    // Stakes.
    for (const [dx, stack] of [
      [0.4, 3],
      [1.45, 2],
      [1.62, 4],
    ] as const) {
      for (let c = 0; c < stack; c++) {
        ctx.fillStyle = rgb(c % 2 === 0 ? COIN : COIN_DARK);
        ctx.beginPath();
        ctx.ellipse(
          box.left + ts * dx,
          midY + ts * 0.12 - c * ts * 0.03,
          ts * 0.05,
          ts * 0.02,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(
        box.left + ts * dx,
        midY + ts * 0.12 - (stack - 1) * ts * 0.03,
        ts * 0.05,
        ts * 0.02,
        0,
        0,
        Math.PI * 2,
      );
      inkOutline(ctx, ts * 0.5);
    }
    // The knife, stood in the wood.
    const knifeX = box.right - ts * 0.35;
    ctx.fillStyle = rgb([200, 204, 210]);
    ctx.beginPath();
    ctx.moveTo(knifeX, midY - ts * 0.02);
    ctx.lineTo(knifeX - ts * 0.03, midY - ts * 0.2);
    ctx.lineTo(knifeX + ts * 0.03, midY - ts * 0.2);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    inkedRect(
      ctx,
      knifeX - ts * 0.025,
      midY - ts * 0.36,
      ts * 0.05,
      ts * 0.16,
      sampleRamp(CASK_WOOD, 0.3),
      ts * 0.6,
    );
    paintBottleCandle(ctx, box.centreX + ts * 0.05, top + depth * 0.4, ts);
  });
}

/**
 * A rough table of mismatched planks, initials cut into it, rings and spills
 * everywhere. Variant 0 has a mug knocked over into its own puddle, variant
 * 1 a plate of crusts and a candle stub in a bottle.
 */
export function paintStumpTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const top = box.top + ts * 0.06;
    const depth = ts * 0.48;
    const apronH = ts * 0.1;
    const legs = [box.left + ts * 0.18, box.right - ts * 0.2];
    legs.forEach((lx, i) =>
      paintLeg(
        ctx,
        lx,
        top + depth + apronH,
        box.bottom - ts * (0.06 + i * 0.03),
        ts * 0.1,
        ts,
        DIVE_WOOD,
      ),
    );
    paintTableTop(
      ctx,
      box.left + ts * 0.02,
      top,
      box.width - ts * 0.04,
      depth,
      apronH,
      ts,
      DIVE_WOOD,
      rng,
    );
    paintSurfaceWear(ctx, box.left, top, box.width, depth, ts, forkRng(rng), SPILL, 5);
    ctx.strokeStyle = rgba([24, 18, 14], 0.6);
    ctx.lineWidth = ts * 0.014;
    const carveX = box.left + ts * (0.3 + rng() * 0.6);
    const carveY = top + depth * 0.35;
    ctx.beginPath();
    ctx.moveTo(carveX, carveY + ts * 0.08);
    ctx.lineTo(carveX + ts * 0.04, carveY);
    ctx.lineTo(carveX + ts * 0.08, carveY + ts * 0.08);
    ctx.moveTo(carveX + ts * 0.12, carveY);
    ctx.lineTo(carveX + ts * 0.12, carveY + ts * 0.08);
    ctx.lineTo(carveX + ts * 0.18, carveY + ts * 0.08);
    ctx.stroke();
    const standY = top + depth * 0.7;
    if (variant === 0) {
      paintSpill(ctx, box.centreX + ts * 0.2, standY, ts * 0.26, forkRng(rng));
      ctx.fillStyle = rgba(SPILL, 0.6);
      ctx.fillRect(box.centreX + ts * 0.34, top + depth, ts * 0.04, apronH + ts * 0.1);
      ctx.save();
      ctx.translate(box.centreX - ts * 0.02, standY - ts * 0.04);
      ctx.rotate(-Math.PI / 2 + 0.3);
      paintTankard(ctx, 0, ts * 0.1, ts * 0.2, ts, CLAY_MUG, false);
      ctx.restore();
      paintTankard(ctx, box.left + ts * 0.4, standY + ts * 0.04, ts * 0.22, ts, CLAY_MUG, true);
      paintTankard(ctx, box.right - ts * 0.35, standY + ts * 0.02, ts * 0.2, ts, PEWTER, false);
    } else {
      paintPlate(ctx, box.left + ts * 0.5, standY, ts * 0.22, ts, 'crumbs', CROCKERY_WHITE);
      paintBottleCandle(ctx, box.centreX + ts * 0.1, standY + ts * 0.02, ts);
      paintTankard(ctx, box.right - ts * 0.4, standY + ts * 0.05, ts * 0.22, ts, CLAY_MUG, true);
      paintBottle(ctx, box.right - ts * 0.72, standY + ts * 0.02, ts * 0.3, ts, BOTTLES[3], null);
    }
  });
}

/** An upturned barrel with a round board nailed on top: somewhere to lean a mug and stay standing. */
export function paintBarrelTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const cx = box.centreX;
    const bodyTop = box.bottom - ts * 0.72;
    const bodyBottom = box.bottom - ts * 0.08;
    const halfW = ts * 0.3;
    const gradient = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
    gradient.addColorStop(0, rgb(sampleRamp(CASK_WOOD, 0.75)));
    gradient.addColorStop(0.6, rgb(sampleRamp(CASK_WOOD, 0.5)));
    gradient.addColorStop(1, rgb(sampleRamp(CASK_WOOD, 0.25)));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(cx - halfW * 0.85, bodyTop);
    ctx.quadraticCurveTo(
      cx - halfW * 1.1,
      (bodyTop + bodyBottom) / 2,
      cx - halfW * 0.85,
      bodyBottom,
    );
    ctx.lineTo(cx + halfW * 0.85, bodyBottom);
    ctx.quadraticCurveTo(cx + halfW * 1.1, (bodyTop + bodyBottom) / 2, cx + halfW * 0.85, bodyTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    for (const t of [0.2, 0.8])
      inkedRect(
        ctx,
        cx - halfW * 0.98,
        bodyTop + (bodyBottom - bodyTop) * t,
        halfW * 1.96,
        ts * 0.04,
        IRON,
        ts * 0.6,
      );
    // The board on top.
    const boardY = bodyTop - ts * 0.02;
    ctx.fillStyle = rgb(sampleRamp(DIVE_WOOD, 0.62));
    ctx.beginPath();
    ctx.ellipse(cx, boardY, ts * 0.42, ts * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      cx - ts * 0.42,
      boardY,
      ts * 0.84,
      ts * 0.05,
      sampleRamp(DIVE_WOOD, 0.3),
      ts * 0.8,
    );
    paintSpill(ctx, cx + ts * 0.1, boardY + ts * 0.02, ts * 0.14, forkRng(rng));
    paintTankard(ctx, cx - ts * 0.16, boardY + ts * 0.04, ts * 0.2, ts, CLAY_MUG, true);
    if (variant === 0)
      paintTankard(ctx, cx + ts * 0.18, boardY + ts * 0.02, ts * 0.2, ts, PEWTER, false);
    else paintBottle(ctx, cx + ts * 0.18, boardY + ts * 0.03, ts * 0.3, ts, BOTTLES[0], null);
  });
}

/** The empties: three barrels racked on their sides, two below and one on top, waiting for the alley. */
export function paintKegStack(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const radius = ts * 0.36;
    const lowerY = box.bottom - ts * 0.08 - radius;
    for (const dx of [-0.5, 0.5])
      paintCaskEnd(ctx, box.centreX + dx * ts * 0.95, lowerY, radius, ts, CASK_WOOD, false);
    paintCaskEnd(ctx, box.centreX, lowerY - radius * 1.55, radius * 0.95, ts, CASK_WOOD, false);
    ctx.strokeStyle = rgba(CHALK, 0.8);
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(box.centreX - ts * 0.08, lowerY - radius * 1.55 - ts * 0.08);
    ctx.lineTo(box.centreX + ts * 0.08, lowerY - radius * 1.55 + ts * 0.08);
    ctx.moveTo(box.centreX + ts * 0.08, lowerY - radius * 1.55 - ts * 0.08);
    ctx.lineTo(box.centreX - ts * 0.08, lowerY - radius * 1.55 + ts * 0.08);
    ctx.stroke();
  });
}

/** Broken stools heaped in the corner, and a mop standing in a bucket of grey water. */
export function paintJunkHeap(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    // Stool legs and a split seat, piled.
    ctx.strokeStyle = rgb(sampleRamp(DIVE_WOOD, 0.45));
    ctx.lineWidth = ts * 0.06;
    for (let i = 0; i < 5; i++) {
      const x = box.left + ts * (0.15 + rng() * 0.4);
      const y = box.bottom - ts * (0.12 + rng() * 0.25);
      const a = rng() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * ts * 0.3, y - Math.abs(Math.sin(a)) * ts * 0.25);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(DIVE_WOOD, 0.62));
    ctx.beginPath();
    ctx.ellipse(box.left + ts * 0.36, box.bottom - ts * 0.36, ts * 0.2, ts * 0.08, 0.5, 0, Math.PI);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    // Bucket and mop.
    const bx = box.right - ts * 0.3;
    ctx.fillStyle = rgb(BUCKET);
    ctx.beginPath();
    ctx.moveTo(bx - ts * 0.16, box.bottom - ts * 0.4);
    ctx.lineTo(bx + ts * 0.16, box.bottom - ts * 0.4);
    ctx.lineTo(bx + ts * 0.12, box.bottom - ts * 0.08);
    ctx.lineTo(bx - ts * 0.12, box.bottom - ts * 0.08);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb([88, 90, 84]);
    ctx.beginPath();
    ctx.ellipse(bx, box.bottom - ts * 0.4, ts * 0.16, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.strokeStyle = rgb(sampleRamp(DIVE_WOOD, 0.6));
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(bx, box.bottom - ts * 0.44);
    ctx.lineTo(bx - ts * 0.12, box.bottom - ts * 1.2);
    ctx.stroke();
    ctx.fillStyle = rgb(MOP_HEAD);
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(
        bx - ts * 0.1 + i * ts * 0.035 + jitter(rng, ts * 0.01),
        box.bottom - ts * 0.5,
        ts * 0.025,
        ts * 0.12,
      );
    }
  });
}

/**
 * What the floor has soaked up: variant 0 a slick of spilled ale with a
 * dropped mug, variant 1 sawdust thrown over something and not swept, with
 * glass in it, variant 2 an old dark stain nobody will say the cause of.
 */
export function paintFloorStain(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX + jitter(rng, ts * 0.1);
    const cy = box.top + box.height * 0.55;
    if (variant === 0) {
      paintSpill(ctx, cx - ts * 0.08, cy, ts * 0.46, forkRng(rng));
      paintSpill(ctx, cx + ts * 0.22, cy + ts * 0.12, ts * 0.2, forkRng(rng));
      ctx.save();
      ctx.translate(cx + ts * 0.18, cy - ts * 0.02);
      ctx.rotate(Math.PI / 2 + 0.4);
      paintTankard(ctx, 0, ts * 0.1, ts * 0.18, ts, CLAY_MUG, false);
      ctx.restore();
    } else if (variant === 1) {
      ctx.fillStyle = rgba(SAWDUST, 0.35);
      ctx.beginPath();
      ctx.ellipse(cx, cy, ts * 0.42, ts * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(SAWDUST, 0.85);
      for (let i = 0; i < 70; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * ts * 0.44;
        ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5, ts * 0.035, ts * 0.025);
      }
      ctx.fillStyle = rgba(GLASS_SHARD, 0.85);
      for (let i = 0; i < 4; i++) {
        const x = cx + jitter(rng, ts * 0.25);
        const y = cy + jitter(rng, ts * 0.1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + ts * 0.05, y - ts * 0.02);
        ctx.lineTo(x + ts * 0.02, y + ts * 0.03);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = rgba([40, 22, 18], 0.5);
      ctx.beginPath();
      ctx.ellipse(cx, cy, ts * 0.44, ts * 0.2, jitter(rng, 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba([40, 22, 18], 0.3);
      ctx.beginPath();
      ctx.ellipse(cx + ts * 0.2, cy + ts * 0.08, ts * 0.14, ts * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Firelight for a dim room: a lamp hung from a nail, smoking its glass. */
export function paintSmokyLamp(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const x = box.centreX;
    const y = box.top - ts * 0.3;
    paintBloom(ctx, x, y, ts * 0.55, FIRE_GLOW, 0.35);
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.02;
    ctx.beginPath();
    ctx.moveTo(x, y - ts * 0.3);
    ctx.lineTo(x, y - ts * 0.16);
    ctx.stroke();
    inkedRect(ctx, x - ts * 0.09, y - ts * 0.16, ts * 0.18, ts * 0.04, IRON, ts * 0.7);
    ctx.fillStyle = rgba(mix([200, 190, 150], [40, 30, 20], 0.35), 0.85);
    ctx.beginPath();
    ctx.ellipse(x, y, ts * 0.08, ts * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    paintCandle(ctx, x, y + ts * 0.08, ts * 0.06, ts);
    inkedRect(ctx, x - ts * 0.1, y + ts * 0.1, ts * 0.2, ts * 0.05, IRON, ts * 0.7);
  });
}

/**
 * The only heat in the place: a squat iron stove on a scorched hearth
 * plate, its flue pipe run crooked up the wall and patched with a tin
 * collar, a dented kettle on top and the grate glowing through its door.
 */
export function paintStumpStove(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    diveShadow(ctx, box, ts);
    const cx = box.centreX;
    // Scorched plate under it.
    ctx.fillStyle = rgb(IRON);
    ctx.beginPath();
    ctx.ellipse(cx, box.bottom - ts * 0.14, ts * 0.44, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    // Flue.
    const flueX = cx + ts * 0.06;
    const bodyTop = box.bottom - ts * 0.78;
    inkedRect(
      ctx,
      flueX - ts * 0.07,
      box.top - ts * 0.95,
      ts * 0.14,
      bodyTop - (box.top - ts * 0.95),
      IRON,
      ts,
    );
    inkedRect(ctx, flueX - ts * 0.09, box.top - ts * 0.4, ts * 0.18, ts * 0.08, TIN, ts * 0.7);
    ctx.fillStyle = rgba([20, 16, 14], 0.35);
    ctx.beginPath();
    ctx.ellipse(flueX, box.top - ts * 0.9, ts * 0.3, ts * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body: a fat round-shouldered drum on three legs.
    for (const dx of [-0.24, 0, 0.24])
      inkedRect(
        ctx,
        cx + dx * ts - ts * 0.03,
        box.bottom - ts * 0.24,
        ts * 0.06,
        ts * 0.12,
        IRON,
        ts * 0.7,
      );
    roundRectPath(ctx, cx - ts * 0.3, bodyTop, ts * 0.6, ts * 0.56, ts * 0.14);
    const body = ctx.createLinearGradient(cx - ts * 0.3, 0, cx + ts * 0.3, 0);
    body.addColorStop(0, rgb(IRON_LIGHT));
    body.addColorStop(0.5, rgb(IRON));
    body.addColorStop(1, rgb([22, 22, 24]));
    ctx.fillStyle = body;
    ctx.fill();
    inkOutline(ctx, ts);
    // Grate door, glowing.
    const doorY = bodyTop + ts * 0.26;
    paintBloom(ctx, cx, doorY + ts * 0.08, ts * 0.5, FIRE_GLOW, 0.5);
    roundRectPath(ctx, cx - ts * 0.14, doorY, ts * 0.28, ts * 0.2, ts * 0.04);
    ctx.fillStyle = rgb([236, 120, 40]);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.025;
    for (const dx of [-0.07, 0, 0.07]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * ts, doorY);
      ctx.lineTo(cx + dx * ts, doorY + ts * 0.2);
      ctx.stroke();
    }
    // The kettle on top.
    const kettleY = bodyTop - ts * 0.02;
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.ellipse(cx - ts * 0.12, kettleY - ts * 0.08, ts * 0.13, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba([40, 40, 44], 0.4);
    ctx.fillRect(
      cx - ts * 0.08 + jitter(rng, ts * 0.01),
      kettleY - ts * 0.12,
      ts * 0.05,
      ts * 0.04,
    );
    ctx.strokeStyle = rgb(TIN);
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.24, kettleY - ts * 0.08);
    ctx.lineTo(cx - ts * 0.34, kettleY - ts * 0.16);
    ctx.stroke();
  });
}
