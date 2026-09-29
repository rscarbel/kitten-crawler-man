/**
 * Bespoke furniture for the Sleeping Cat Inn, the town's warm house: a
 * sandstone inglenook with the kettle on, Ossie's back bar with the chalked
 * menu and the cat on the name board, a honey-oak bar with its beer engine,
 * a plate dresser, long supper tables laid with stew and bread, the cat's
 * own cushioned stool, a fireside wingback, and the guest wing's beds — a
 * double with a quilt for the good rooms and cots for the cheap one.
 *
 * Also the painted cat sign, the milk churn (shared with Miller's Farm) and
 * the racked casks. Registered into `TOWN_INTERIOR_PROPS` in
 * `../townInteriorProps.ts`; the layout that places these lives in
 * `src/map/town/interiors/sleepingCatInn.ts`.
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
  COPPER,
  PEWTER,
  CHALK,
  CROCKERY_BLUE,
  CROCKERY_WHITE,
  FIRE_GLOW,
  FLAME_CORE,
  FLAME_OUTER,
  BREAD,
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

function woodRamp() {
  return getTownRamp('oc_timber');
}
function ironRamp() {
  return getTownRamp('iron_black');
}
function stoneRamp() {
  return getTownRamp('oc_stone');
}

/** The cat sign's ink — flat and dark, closer to a silhouette than a painting. */
const CAT_SILHOUETTE_INK: RGB = [46, 38, 32];

function contactShadow(ctx: Ctx, frame: TownPropFrame): void {
  const box = footprintBox(frame);
  const radiusX = box.width * 0.4;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.3);
}

/**
 * The painted cat sign, on the wall the way Ossie's own story hangs it —
 * a plain silhouette, framed, legible at 32px without needing to spell
 * anything on it.
 */
export function paintCatPortrait(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const inset = frame.tileScale * 0.08;
    ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.3));
    ctx.fillRect(box.left, box.top, box.width, box.height);
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    inkOutline(ctx, frame.tileScale);

    const canvasX = box.left + inset;
    const canvasY = box.top + inset;
    const canvasW = box.width - inset * 2;
    const canvasH = box.height - inset * 2;
    ctx.fillStyle = rgb(mix(sampleRamp(stoneRamp(), 0.92), [255, 246, 224], 0.4));
    ctx.fillRect(canvasX, canvasY, canvasW, canvasH);
    ctx.beginPath();
    ctx.rect(canvasX, canvasY, canvasW, canvasH);
    inkOutline(ctx, frame.tileScale * 0.6);

    const catCx = canvasX + canvasW * 0.5;
    const catBaseY = canvasY + canvasH * 0.82;
    const bodyR = canvasW * 0.28;
    ctx.fillStyle = rgb(CAT_SILHOUETTE_INK);
    ctx.beginPath();
    ctx.ellipse(catCx, catBaseY, bodyR, bodyR * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    const earH = canvasH * 0.16;
    const earY = catBaseY - bodyR * 0.72;
    ctx.beginPath();
    ctx.moveTo(catCx - bodyR * 0.5, earY);
    ctx.lineTo(catCx - bodyR * 0.24, earY - earH);
    ctx.lineTo(catCx - bodyR * 0.06, earY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(catCx + bodyR * 0.06, earY);
    ctx.lineTo(catCx + bodyR * 0.24, earY - earH);
    ctx.lineTo(catCx + bodyR * 0.5, earY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.5);
  });
}

/** Galvanized iron, narrower and taller than a barrel — a churn, not a cask. */
export function paintDairyChurn(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const iron = ironRamp();
    const bodyH = frame.tileScale * 0.8;
    const bodyTop = box.bottom - bodyH;
    const bodyW = box.width * 0.5;
    const bx = box.centreX;

    ctx.fillStyle = rgb(mix(sampleRamp(iron, 0.72), [255, 255, 255], 0.06));
    ctx.beginPath();
    ctx.moveTo(bx - bodyW / 2, bodyTop + bodyH * 0.18);
    ctx.bezierCurveTo(
      bx - bodyW * 0.6,
      bodyTop + bodyH * 0.5,
      bx - bodyW * 0.6,
      bodyTop + bodyH * 0.85,
      bx - bodyW / 2,
      bodyTop + bodyH,
    );
    ctx.lineTo(bx + bodyW / 2, bodyTop + bodyH);
    ctx.bezierCurveTo(
      bx + bodyW * 0.6,
      bodyTop + bodyH * 0.85,
      bx + bodyW * 0.6,
      bodyTop + bodyH * 0.5,
      bx + bodyW / 2,
      bodyTop + bodyH * 0.18,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);

    const lidH = frame.tileScale * 0.12;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    ctx.beginPath();
    ctx.ellipse(bx, bodyTop, bodyW * 0.42, lidH, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, frame.tileScale * 0.7);

    const handleW = bodyW * 0.28;
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
    ctx.lineWidth = frame.tileScale * 0.035;
    ctx.beginPath();
    ctx.moveTo(bx - handleW / 2, bodyTop - lidH * 0.4);
    ctx.quadraticCurveTo(bx, bodyTop - lidH * 2.2, bx + handleW / 2, bodyTop - lidH * 0.4);
    ctx.stroke();

    const bandY = bodyTop + bodyH * (0.35 + rng() * 0.1);
    ctx.strokeStyle = rgba(sampleRamp(iron, 0.35), 0.7);
    ctx.lineWidth = frame.tileScale * 0.03;
    ctx.beginPath();
    ctx.moveTo(bx - bodyW * 0.56, bandY);
    ctx.lineTo(bx + bodyW * 0.56, bandY);
    ctx.stroke();
  });
}

/** One cask lying on its side, its round head toward the room. */
function paintCaskHead(
  ctx: Ctx,
  frame: TownPropFrame,
  cx: number,
  cy: number,
  radius: number,
  chalkTally: number,
): void {
  const wood = woodRamp();
  const iron = ironRamp();
  const ts = frame.tileScale;

  // The belly behind the head, seen as a sliver of staves above it: what
  // makes a disc read as a barrel on its side rather than a shield.
  ctx.fillStyle = rgb(sampleRamp(wood, 0.38));
  ctx.beginPath();
  ctx.ellipse(cx, cy - radius * 0.28, radius * 0.98, radius * 0.9, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  const head = ctx.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.4,
    radius * 0.1,
    cx,
    cy,
    radius,
  );
  head.addColorStop(0, rgb(sampleRamp(wood, 0.78)));
  head.addColorStop(1, rgb(sampleRamp(wood, 0.5)));
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);

  // Head boards, then the chime hoop round the rim.
  ctx.strokeStyle = rgba(sampleRamp(wood, 0.3), 0.55);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  const boardCount = 3;
  for (let i = 1; i < boardCount; i++) {
    const bx = cx - radius + (radius * 2 * i) / boardCount;
    const half = Math.sqrt(Math.max(0, radius * radius - (bx - cx) * (bx - cx))) * 0.9;
    ctx.beginPath();
    ctx.moveTo(bx, cy - half);
    ctx.lineTo(bx, cy + half);
    ctx.stroke();
  }
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.42));
  ctx.lineWidth = ts * 0.04;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  // The spigot, low on the head where the last pint drains from.
  const spigotY = cy + radius * 0.38;
  ctx.fillStyle = rgb(sampleRamp(BRASS, 0.4));
  ctx.fillRect(cx - ts * 0.025, spigotY - ts * 0.02, ts * 0.05, ts * 0.1);
  ctx.fillStyle = rgb(sampleRamp(BRASS, 0.9));
  ctx.beginPath();
  ctx.arc(cx, spigotY - ts * 0.02, ts * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // Chalked strokes counting the pints drawn off this one today.
  ctx.strokeStyle = rgba([236, 232, 220], 0.75);
  ctx.lineWidth = 1;
  for (let i = 0; i < chalkTally; i++) {
    const tx = cx - radius * 0.42 + i * ts * 0.05;
    ctx.beginPath();
    ctx.moveTo(tx, cy - radius * 0.5);
    ctx.lineTo(tx, cy - radius * 0.18);
    ctx.stroke();
  }
}

/**
 * The back bar: ale casks racked on their sides in a squared timber cradle,
 * two below and one riding the gap between them — the stock the tap wall
 * draws from, so the barkeep's side of the counter is a working place.
 */
export function paintCaskRack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const wood = woodRamp();

    const cradleH = ts * 0.2;
    const cradleTop = box.bottom - cradleH;
    const legInset = ts * 0.08;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.42));
    ctx.fillRect(box.left + legInset, cradleTop, box.width - legInset * 2, cradleH);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.66));
    ctx.fillRect(box.left + legInset, cradleTop, box.width - legInset * 2, cradleH * 0.3);
    ctx.beginPath();
    ctx.rect(box.left + legInset, cradleTop, box.width - legInset * 2, cradleH);
    inkOutline(ctx, ts);

    const lowerRadius = ts * 0.34;
    const lowerY = cradleTop - lowerRadius * 0.62;
    const lowerXs = [box.left + box.width * 0.27, box.left + box.width * 0.73];
    const tallies = [1 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 4)];
    lowerXs.forEach((x, i) => paintCaskHead(ctx, frame, x, lowerY, lowerRadius, tallies[i]));

    const upperRadius = ts * 0.3;
    const upperY = lowerY - lowerRadius * 1.25;
    paintCaskHead(ctx, frame, box.centreX, upperY, upperRadius, 0);
  });
}

// ── The warm house's own materials ─────────────────────────────────────────

/** Honey oak: the inn's furniture wood, warmer and more golden than the town's ash timber. */
const HONEY_OAK: Ramp = {
  shadow: [82, 50, 28],
  mid: [148, 96, 54],
  light: [206, 150, 90],
  accent: [234, 192, 132],
};
/** Sandstone for the inglenook — warm and pale, the opposite of the Flagon's cool ashlar. */
const HEARTH_SANDSTONE: Ramp = {
  shadow: [104, 78, 58],
  mid: [164, 126, 94],
  light: [208, 174, 134],
  accent: [230, 204, 166],
};
const SOOT: RGB = [30, 22, 20];
const EMBER: RGB = [196, 70, 30];
const LOG_BARK: RGB = [74, 50, 34];
const LOG_END: RGB = [196, 156, 104];
const LOG_RING: RGB = [150, 110, 68];
const IRON: RGB = [46, 44, 46];
const IRON_LIGHT: RGB = [96, 94, 98];
const LINEN: RGB = [232, 222, 196];
const LINEN_STRIPE: RGB = [170, 58, 46];
const QUILT_RED: RGB = [168, 58, 48];
const QUILT_CREAM: RGB = [232, 220, 190];
const QUILT_BLUE: RGB = [70, 98, 152];
const QUILT_GREEN: RGB = [86, 124, 78];
const QUILT_OCHRE: RGB = [206, 156, 70];
const WOOL_GREY: RGB = [128, 124, 116];
const WOOL_GREY_DARK: RGB = [92, 88, 82];
const WOOL_BROWN: RGB = [138, 104, 76];
const WOOL_BROWN_DARK: RGB = [96, 70, 52];
const UPHOLSTERY_RUST: RGB = [150, 60, 42];
const UPHOLSTERY_RUST_DARK: RGB = [102, 40, 30];
const UPHOLSTERY_RUST_LIGHT: RGB = [196, 100, 70];
const CUSHION_PATCHES: readonly RGB[] = [QUILT_RED, QUILT_CREAM, QUILT_BLUE, QUILT_OCHRE];
const MILK: RGB = [244, 242, 232];
const WICKER: RGB = [176, 136, 78];
const WICKER_DARK: RGB = [120, 88, 48];
const NAME_BOARD_CREAM: RGB = [226, 208, 164];
const SLATE: RGB = [40, 44, 48];
const GLASS_TINT: RGB = [226, 236, 226];
const BOTTLE_GREENS: readonly RGB[] = [
  [58, 98, 62],
  [120, 70, 40],
  [60, 70, 120],
  [150, 110, 50],
  [104, 42, 50],
];

function oakShadow(ctx: Ctx, box: ReturnType<typeof footprintBox>, ts: number): void {
  drawTownContactShadow(
    ctx,
    box.centreX,
    box.bottom - ts * 0.08,
    box.width * 0.46,
    ts * 0.14,
    0.34,
  );
}

/** Split logs piled end-on, three below and two above. */
function paintLogPile(ctx: Ctx, cx: number, baseY: number, ts: number): void {
  const radius = ts * 0.085;
  const rows: ReadonlyArray<ReadonlyArray<number>> = [
    [-2, 0, 2],
    [-1, 1],
  ];
  rows.forEach((row, rowIndex) => {
    for (const slot of row) {
      const x = cx + slot * radius;
      const y = baseY - radius - rowIndex * radius * 1.7;
      ctx.fillStyle = rgb(LOG_BARK);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(LOG_END);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgb(LOG_RING);
      ctx.lineWidth = ts * 0.01;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.38, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** Flames in three nested tongues, banked low over glowing logs. */
function paintFire(
  ctx: Ctx,
  cx: number,
  baseY: number,
  width: number,
  height: number,
  ts: number,
): void {
  paintBloom(ctx, cx, baseY - height * 0.3, width * 0.9, FIRE_GLOW, 0.55);
  ctx.fillStyle = rgb(LOG_BARK);
  ctx.save();
  ctx.translate(cx, baseY - ts * 0.06);
  for (const angle of [-0.18, 0.18]) {
    ctx.save();
    ctx.rotate(angle);
    rectPath(ctx, -width * 0.42, -ts * 0.05, width * 0.84, ts * 0.1);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = rgba(EMBER, 0.9);
  ctx.fillRect(cx - width * 0.35, baseY - ts * 0.04, width * 0.7, ts * 0.04);
  const tongues: ReadonlyArray<readonly [number, number, number]> = [
    [-0.26, 0.7, 0.2],
    [0.24, 0.78, 0.22],
    [0, 1, 0.3],
  ];
  for (const [layer, color] of [
    [1, FLAME_OUTER],
    [0.62, FLAME_CORE],
  ] as const) {
    ctx.fillStyle = rgb(color);
    for (const [dx, tall, wide] of tongues) {
      const x = cx + dx * width;
      const h = height * tall * layer;
      const w = width * wide * layer;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, baseY - ts * 0.05);
      ctx.quadraticCurveTo(x - w / 2, baseY - h * 0.55, x, baseY - h);
      ctx.quadraticCurveTo(x + w / 2, baseY - h * 0.55, x + w / 2, baseY - ts * 0.05);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * The inglenook: a sandstone chimney breast carried up into the wall, an
 * oak mantel with the good plates and two candlesticks, a fire with the
 * kettle hung over it, and out front a hearthstone with the log pile and a
 * copper scuttle, lit orange from the firebox.
 */
export function paintInnHearth(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);

    const hearthTop = box.top + ts * 1.02;
    const slabLeft = box.left + ts * 0.06;
    const slabRight = box.right - ts * 0.06;
    const slabBottom = box.bottom - ts * 0.1;
    paintStoneCourses(
      ctx,
      slabLeft,
      hearthTop,
      slabRight - slabLeft,
      slabBottom - hearthTop,
      HEARTH_SANDSTONE,
      forkRng(rng),
    );
    rectPath(ctx, slabLeft, hearthTop, slabRight - slabLeft, slabBottom - hearthTop);
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      slabLeft,
      slabBottom,
      slabRight - slabLeft,
      ts * 0.07,
      sampleRamp(HEARTH_SANDSTONE, 0.2),
      ts,
    );

    const breastLeft = box.left + ts * 0.16;
    const breastRight = box.right - ts * 0.16;
    const mantelY = box.top - ts * 0.3;
    const stackLeft = box.centreX - ts * 0.72;
    const stackRight = box.centreX + ts * 0.72;
    const stackTop = box.top - ts * 1.7;
    paintStoneCourses(
      ctx,
      stackLeft,
      stackTop,
      stackRight - stackLeft,
      mantelY - stackTop,
      HEARTH_SANDSTONE,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.16);
    ctx.fillRect(box.centreX, stackTop, stackRight - box.centreX, mantelY - stackTop);
    rectPath(ctx, stackLeft, stackTop, stackRight - stackLeft, mantelY - stackTop);
    inkOutline(ctx, ts);
    paintStoneCourses(
      ctx,
      breastLeft,
      mantelY,
      breastRight - breastLeft,
      hearthTop - mantelY,
      HEARTH_SANDSTONE,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.14);
    ctx.fillRect(breastRight - ts * 0.3, mantelY, ts * 0.3, hearthTop - mantelY);
    rectPath(ctx, breastLeft, mantelY, breastRight - breastLeft, hearthTop - mantelY);
    inkOutline(ctx, ts);

    // The firebox arch, sooted round its mouth.
    const archHalf = ts * 0.78;
    const archTop = mantelY + ts * 0.28;
    const archBottom = hearthTop + ts * 0.02;
    paintBloom(ctx, box.centreX, archTop + ts * 0.2, ts * 1.1, SOOT, 0.45);
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(box.centreX - archHalf, archBottom);
    ctx.lineTo(box.centreX - archHalf, archTop + ts * 0.32);
    ctx.quadraticCurveTo(
      box.centreX,
      archTop - ts * 0.2,
      box.centreX + archHalf,
      archTop + ts * 0.32,
    );
    ctx.lineTo(box.centreX + archHalf, archBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    paintFire(ctx, box.centreX + ts * 0.15, archBottom, ts * 0.9, ts * 0.75, ts);

    // The kettle on its crane, hung to the side of the flames.
    const craneX = box.centreX - archHalf + ts * 0.12;
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(craneX, archBottom);
    ctx.lineTo(craneX, archTop + ts * 0.3);
    ctx.lineTo(craneX + ts * 0.42, archTop + ts * 0.3);
    ctx.lineTo(craneX + ts * 0.42, archTop + ts * 0.46);
    ctx.stroke();
    const kettleX = craneX + ts * 0.42;
    const kettleY = archTop + ts * 0.7;
    ctx.fillStyle = rgb(IRON);
    ctx.beginPath();
    ctx.ellipse(kettleX, kettleY, ts * 0.17, ts * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(IRON_LIGHT, 0.8);
    ctx.beginPath();
    ctx.ellipse(kettleX - ts * 0.06, kettleY - ts * 0.05, ts * 0.05, ts * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(kettleX + ts * 0.14, kettleY - ts * 0.02);
    ctx.lineTo(kettleX + ts * 0.26, kettleY - ts * 0.1);
    ctx.stroke();

    // The mantel and the good plates stood along it.
    const mantelH = ts * 0.15;
    const mantelLeft = box.left + ts * 0.06;
    const mantelW = box.width - ts * 0.12;
    paintPlankBoard(ctx, mantelLeft, mantelY - mantelH / 2, mantelW, mantelH, forkRng(rng), {
      direction: 'horizontal',
      boardPx: mantelH,
      ramp: HONEY_OAK,
    });
    rectPath(ctx, mantelLeft, mantelY - mantelH / 2, mantelW, mantelH);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(HONEY_OAK, 1), 0.5);
    ctx.fillRect(mantelLeft, mantelY - mantelH / 2, mantelW, ts * 0.025);
    const shelfY = mantelY - mantelH / 2;
    paintCandlestick(ctx, box.left + ts * 0.3, shelfY, ts * 0.36, ts, BRASS);
    paintCandlestick(ctx, box.right - ts * 0.3, shelfY, ts * 0.36, ts, BRASS);
    const plateXs = [-0.66, 0, 0.66];
    plateXs.forEach((dx, i) => {
      const px = box.centreX + dx * ts;
      const radius = ts * (i === 1 ? 0.2 : 0.16);
      ctx.fillStyle = rgb(CROCKERY_WHITE);
      ctx.beginPath();
      ctx.ellipse(px, shelfY - radius, radius, radius, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.strokeStyle = rgb(CROCKERY_BLUE);
      ctx.lineWidth = ts * 0.022;
      ctx.beginPath();
      ctx.arc(px, shelfY - radius, radius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgb(CROCKERY_BLUE);
      ctx.beginPath();
      ctx.arc(px, shelfY - radius, radius * 0.25, 0, Math.PI * 2);
      ctx.fill();
    });
    paintJug(ctx, box.centreX - ts * 0.34, shelfY, ts * 0.2, ts, [150, 90, 60]);
    paintJug(ctx, box.centreX + ts * 0.36, shelfY, ts * 0.17, ts, CROCKERY_WHITE);

    // Out front on the hearthstone: logs to the west, the copper scuttle east,
    // both catching the fire's light.
    paintBloom(ctx, box.centreX, hearthTop + ts * 0.3, ts * 1.2, FIRE_GLOW, 0.3);
    paintLogPile(ctx, box.left + ts * 0.42, slabBottom - ts * 0.04, ts);
    const scuttleX = box.right - ts * 0.45;
    const scuttleBase = slabBottom - ts * 0.04;
    ctx.fillStyle = rgb(sampleRamp(COPPER, 0.55));
    ctx.beginPath();
    ctx.moveTo(scuttleX - ts * 0.18, scuttleBase);
    ctx.lineTo(scuttleX - ts * 0.2, scuttleBase - ts * 0.26);
    ctx.lineTo(scuttleX + ts * 0.12, scuttleBase - ts * 0.34);
    ctx.lineTo(scuttleX + ts * 0.2, scuttleBase);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(COPPER, 1), 0.6);
    ctx.fillRect(scuttleX - ts * 0.14, scuttleBase - ts * 0.22, ts * 0.05, ts * 0.18);
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.ellipse(
      scuttleX - ts * 0.04,
      scuttleBase - ts * 0.3,
      ts * 0.14,
      ts * 0.04,
      -0.25,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = rgb(IRON);
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.moveTo(box.centreX + ts * 0.62, archBottom - ts * 0.02);
    ctx.lineTo(box.centreX + ts * 0.8, archTop + ts * 0.62);
    ctx.stroke();
  });
}

/** Three shelves of stock behind the bar, the last one hung with pewter tankards. */
function paintBackBarShelf(
  ctx: Ctx,
  left: number,
  right: number,
  shelfY: number,
  ts: number,
  contents: 'bottles' | 'crocks' | 'plates',
  rng: Rng,
): void {
  inkedRect(ctx, left, shelfY, right - left, ts * 0.06, sampleRamp(HONEY_OAK, 0.62), ts);
  const width = right - left;
  if (contents === 'bottles') {
    const count = Math.max(3, Math.floor(width / (ts * 0.17)));
    for (let i = 0; i < count; i++) {
      const x = left + width * ((i + 0.5) / count);
      const height = ts * (0.28 + jitter(rng, 0.05));
      const glass = BOTTLE_GREENS[(i + Math.floor(rng() * 3)) % BOTTLE_GREENS.length];
      paintBottle(ctx, x, shelfY, height, ts, glass, i % 2 === 0 ? CROCKERY_WHITE : null);
    }
  } else if (contents === 'crocks') {
    const count = Math.max(2, Math.floor(width / (ts * 0.26)));
    for (let i = 0; i < count; i++) {
      const x = left + width * ((i + 0.5) / count);
      paintJug(
        ctx,
        x,
        shelfY,
        ts * (0.22 + jitter(rng, 0.03)),
        ts,
        i % 2 === 0 ? [150, 96, 62] : CROCKERY_WHITE,
      );
    }
  } else {
    const count = Math.max(2, Math.floor(width / (ts * 0.22)));
    for (let i = 0; i < count; i++) {
      const x = left + width * ((i + 0.5) / count);
      const radius = ts * 0.1;
      ctx.fillStyle = rgb(CROCKERY_WHITE);
      ctx.beginPath();
      ctx.arc(x, shelfY - radius, radius, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      ctx.strokeStyle = rgb(CROCKERY_BLUE);
      ctx.lineWidth = ts * 0.016;
      ctx.beginPath();
      ctx.arc(x, shelfY - radius, radius * 0.66, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/**
 * Ossie's back bar, against the north wall behind the counter: casks built
 * into the base with their taps, a counter shelf with the bread board and
 * the crock, a row of tankards hung on pegs, two tiers of bottles and
 * crockery either side of the chalked slate, and the name board on the
 * cornice with the sleeping cat that gave the house its name.
 */
export function paintInnBackBar(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);

    const counterTop = box.top + ts * 0.22;
    const backTop = box.top - ts * 1.62;
    const sideW = ts * 0.1;

    // Back boards, the wall the shelves are fixed to.
    paintPlankBoard(ctx, box.left, backTop, box.width, counterTop - backTop, forkRng(rng), {
      direction: 'vertical',
      boardPx: ts * 0.32,
      ramp: { ...HONEY_OAK, light: sampleRamp(HONEY_OAK, 0.5) },
    });
    ctx.fillStyle = rgba(SOOT, 0.28);
    ctx.fillRect(box.left, backTop, box.width, counterTop - backTop);
    rectPath(ctx, box.left, backTop, box.width, counterTop - backTop);
    inkOutline(ctx, ts);

    // The slate, centred, with the day's board chalked on it.
    const slateW = ts * 1.15;
    const slateLeft = box.centreX - slateW / 2;
    const slateTop = backTop + ts * 0.18;
    const slateH = ts * 0.95;
    inkedRect(
      ctx,
      slateLeft - ts * 0.05,
      slateTop - ts * 0.05,
      slateW + ts * 0.1,
      slateH + ts * 0.1,
      sampleRamp(HONEY_OAK, 0.35),
      ts,
    );
    inkedRect(ctx, slateLeft, slateTop, slateW, slateH, SLATE, ts * 0.8);
    ctx.strokeStyle = rgba(CHALK, 0.9);
    ctx.lineWidth = ts * 0.018;
    const chalkRows = 4;
    for (let row = 0; row < chalkRows; row++) {
      const y = slateTop + slateH * (0.34 + row * 0.16);
      const lineW = slateW * (0.42 + rng() * 0.2);
      ctx.beginPath();
      ctx.moveTo(slateLeft + slateW * 0.1, y);
      ctx.lineTo(slateLeft + slateW * 0.1 + lineW, y);
      ctx.stroke();
      ctx.fillStyle = rgba(CHALK, 0.9);
      ctx.fillRect(slateLeft + slateW * 0.8, y - ts * 0.015, ts * 0.06, ts * 0.03);
    }
    // A chalk bowl with steam, the one picture on the board.
    ctx.beginPath();
    ctx.arc(box.centreX, slateTop + slateH * 0.14, slateW * 0.08, 0, Math.PI);
    ctx.stroke();
    for (const dx of [-0.04, 0.04]) {
      ctx.beginPath();
      ctx.moveTo(box.centreX + dx * slateW, slateTop + slateH * 0.1);
      ctx.quadraticCurveTo(
        box.centreX + dx * slateW + ts * 0.03,
        slateTop + slateH * 0.04,
        box.centreX + dx * slateW,
        slateTop,
      );
      ctx.stroke();
    }

    // Shelves either side of the slate.
    const shelfRows = [backTop + ts * 0.62, backTop + ts * 1.12];
    const westLeft = box.left + sideW;
    const westRight = slateLeft - ts * 0.12;
    const eastLeft = slateLeft + slateW + ts * 0.12;
    const eastRight = box.right - sideW;
    paintBackBarShelf(ctx, westLeft, westRight, shelfRows[0], ts, 'bottles', forkRng(rng));
    paintBackBarShelf(ctx, westLeft, westRight, shelfRows[1], ts, 'crocks', forkRng(rng));
    paintBackBarShelf(ctx, eastLeft, eastRight, shelfRows[0], ts, 'plates', forkRng(rng));
    paintBackBarShelf(ctx, eastLeft, eastRight, shelfRows[1], ts, 'bottles', forkRng(rng));

    // Pegs and the tankards hung from them, the house's own pewter.
    const pegRail = shelfRows[1] + ts * 0.14;
    inkedRect(
      ctx,
      box.left + sideW,
      pegRail,
      box.width - sideW * 2,
      ts * 0.04,
      sampleRamp(HONEY_OAK, 0.4),
      ts * 0.8,
    );
    const mugCount = 9;
    for (let i = 0; i < mugCount; i++) {
      const x = box.left + box.width * ((i + 0.5) / mugCount);
      paintTankard(ctx, x, pegRail + ts * 0.26, ts * 0.2, ts, PEWTER, false);
    }

    // Cornice and the name board with the curled cat.
    const corniceH = ts * 0.14;
    inkedRect(
      ctx,
      box.left,
      backTop - corniceH,
      box.width,
      corniceH,
      sampleRamp(HONEY_OAK, 0.6),
      ts,
    );
    ctx.fillStyle = rgba(sampleRamp(HONEY_OAK, 1), 0.5);
    ctx.fillRect(box.left, backTop - corniceH, box.width, ts * 0.03);
    const boardW = ts * 1.5;
    const boardH = ts * 0.34;
    const boardTop = backTop - corniceH - boardH + ts * 0.04;
    roundRectPath(ctx, box.centreX - boardW / 2, boardTop, boardW, boardH, ts * 0.08);
    ctx.fillStyle = rgb(NAME_BOARD_CREAM);
    ctx.fill();
    inkOutline(ctx, ts);
    const catX = box.centreX;
    const catY = boardTop + boardH * 0.6;
    ctx.fillStyle = rgb(CAT_SILHOUETTE_INK);
    ctx.beginPath();
    ctx.ellipse(catX, catY, ts * 0.2, ts * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(catX + ts * 0.17, catY - ts * 0.04, ts * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(catX + ts * 0.12, catY - ts * 0.08);
    ctx.lineTo(catX + ts * 0.14, catY - ts * 0.15);
    ctx.lineTo(catX + ts * 0.18, catY - ts * 0.1);
    ctx.lineTo(catX + ts * 0.21, catY - ts * 0.15);
    ctx.lineTo(catX + ts * 0.23, catY - ts * 0.08);
    ctx.fill();
    ctx.strokeStyle = rgb(CAT_SILHOUETTE_INK);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(catX - ts * 0.18, catY + ts * 0.04);
    ctx.quadraticCurveTo(catX - ts * 0.34, catY + ts * 0.06, catX - ts * 0.3, catY - ts * 0.06);
    ctx.stroke();

    // Uprights.
    inkedRect(ctx, box.left, backTop, sideW, counterTop - backTop, sampleRamp(HONEY_OAK, 0.5), ts);
    inkedRect(
      ctx,
      box.right - sideW,
      backTop,
      sideW,
      counterTop - backTop,
      sampleRamp(HONEY_OAK, 0.4),
      ts,
    );

    // The base: casks racked in the west half, cupboard doors to the east.
    const baseTop = counterTop + ts * 0.06;
    inkedRect(
      ctx,
      box.left,
      baseTop,
      box.width,
      box.bottom - baseTop - ts * 0.02,
      sampleRamp(HONEY_OAK, 0.3),
      ts,
    );
    const caskRadius = ts * 0.2;
    const caskY = baseTop + (box.bottom - baseTop) * 0.5;
    for (let i = 0; i < 3; i++)
      paintCaskEnd(ctx, box.left + ts * (0.35 + i * 0.5), caskY, caskRadius, ts, HONEY_OAK, true);
    const doorCount = 3;
    const doorsLeft = box.left + ts * 1.7;
    const doorsW = box.right - ts * 0.08 - doorsLeft;
    for (let i = 0; i < doorCount; i++) {
      const doorW = doorsW / doorCount;
      const dx = doorsLeft + i * doorW;
      inkedRect(
        ctx,
        dx + ts * 0.04,
        baseTop + ts * 0.05,
        doorW - ts * 0.08,
        box.bottom - baseTop - ts * 0.14,
        sampleRamp(HONEY_OAK, 0.5),
        ts * 0.8,
      );
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.8));
      ctx.beginPath();
      ctx.arc(
        dx + doorW * (i % 2 === 0 ? 0.8 : 0.2),
        baseTop + (box.bottom - baseTop) * 0.45,
        ts * 0.025,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // Counter shelf and what stands on it.
    inkedRect(
      ctx,
      box.left - ts * 0.01,
      counterTop,
      box.width + ts * 0.02,
      ts * 0.07,
      sampleRamp(HONEY_OAK, 0.75),
      ts,
    );
    const boardX = box.left + ts * 2.0;
    inkedRect(
      ctx,
      boardX,
      counterTop - ts * 0.04,
      ts * 0.42,
      ts * 0.05,
      sampleRamp(HONEY_OAK, 0.85),
      ts * 0.8,
    );
    ctx.fillStyle = rgb(BREAD);
    ctx.beginPath();
    ctx.ellipse(boardX + ts * 0.21, counterTop - ts * 0.1, ts * 0.16, ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    paintJug(ctx, box.right - ts * 0.9, counterTop, ts * 0.26, ts, [120, 84, 60]);
    paintCandle(ctx, box.right - ts * 0.4, counterTop, ts * 0.14, ts);
    paintTankard(ctx, box.left + ts * 3.8, counterTop, ts * 0.18, ts, PEWTER, true);
  });
}

/**
 * Ossie's bar, built in sections: honey-oak panels, a brass foot rail, and
 * a polished top. Variant 0 carries the beer engine, variant 1 the till end
 * with the bell, the bread and a lamp.
 */
export function paintInnBar(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);
    const surfaceTop = box.top - ts * 0.14;
    const surfaceDepth = ts * 0.36;
    const faceTop = surfaceTop + surfaceDepth;
    const faceBottom = box.bottom - ts * 0.06;

    // Front face with a raised panel per tile.
    inkedRect(
      ctx,
      box.left,
      faceTop,
      box.width,
      faceBottom - faceTop,
      sampleRamp(HONEY_OAK, 0.42),
      ts,
    );
    const tiles = frame.footprintW;
    for (let i = 0; i < tiles; i++) {
      const px = box.left + i * ts + ts * 0.12;
      const pw = ts * 0.76;
      const py = faceTop + ts * 0.1;
      const ph = faceBottom - faceTop - ts * 0.3;
      inkedRect(ctx, px, py, pw, ph, sampleRamp(HONEY_OAK, 0.55), ts * 0.7);
      ctx.fillStyle = rgba(sampleRamp(HONEY_OAK, 1), 0.35);
      ctx.fillRect(px + ts * 0.02, py + ts * 0.02, pw - ts * 0.04, ts * 0.03);
      ctx.fillRect(px + ts * 0.02, py + ts * 0.02, ts * 0.03, ph - ts * 0.04);
    }
    inkedRect(
      ctx,
      box.left,
      faceBottom - ts * 0.08,
      box.width,
      ts * 0.08,
      sampleRamp(HONEY_OAK, 0.2),
      ts,
    );
    // Brass foot rail on its brackets.
    const railY = faceBottom - ts * 0.16;
    for (let i = 0; i <= tiles; i++) {
      const bx = box.left + Math.min(box.width - ts * 0.08, i * ts + ts * 0.04);
      inkedRect(ctx, bx, railY - ts * 0.02, ts * 0.04, ts * 0.1, sampleRamp(BRASS, 0.4), ts * 0.6);
    }
    inkedRect(
      ctx,
      box.left + ts * 0.02,
      railY - ts * 0.03,
      box.width - ts * 0.04,
      ts * 0.045,
      sampleRamp(BRASS, 0.75),
      ts * 0.7,
    );

    // The polished top.
    paintPlankBoard(ctx, box.left, surfaceTop, box.width, surfaceDepth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: surfaceDepth / 2,
      ramp: { ...HONEY_OAK, shadow: sampleRamp(HONEY_OAK, 0.4) },
    });
    ctx.fillStyle = rgba(sampleRamp(HONEY_OAK, 1), 0.3);
    ctx.fillRect(box.left, surfaceTop, box.width, surfaceDepth * 0.3);
    rectPath(ctx, box.left, surfaceTop, box.width, surfaceDepth);
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      box.left - ts * 0.01,
      faceTop - ts * 0.02,
      box.width + ts * 0.02,
      ts * 0.07,
      sampleRamp(HONEY_OAK, 0.7),
      ts,
    );
    paintSurfaceWear(
      ctx,
      box.left,
      surfaceTop,
      box.width,
      surfaceDepth,
      ts,
      forkRng(rng),
      sampleRamp(HONEY_OAK, 0.2),
      3,
    );

    const standY = surfaceTop + surfaceDepth * 0.7;
    if (variant === 0) {
      // The beer engine: three pulls on a brass-collared block, and a drip tray.
      const engineLeft = box.left + ts * 0.5;
      const engineW = ts * 1.3;
      inkedRect(
        ctx,
        engineLeft,
        standY - ts * 0.1,
        engineW,
        ts * 0.1,
        sampleRamp(HONEY_OAK, 0.3),
        ts,
      );
      const pullCount = 3;
      for (let i = 0; i < pullCount; i++) {
        const px = engineLeft + engineW * ((i + 0.5) / pullCount);
        const pullTop = standY - ts * 0.62;
        inkedRect(
          ctx,
          px - ts * 0.035,
          standY - ts * 0.2,
          ts * 0.07,
          ts * 0.1,
          sampleRamp(BRASS, 0.8),
          ts * 0.7,
        );
        roundRectPath(ctx, px - ts * 0.045, pullTop, ts * 0.09, ts * 0.44, ts * 0.04);
        ctx.fillStyle = rgb(i === 1 ? CROCKERY_WHITE : sampleRamp(HONEY_OAK, 0.25));
        ctx.fill();
        inkOutline(ctx, ts * 0.8);
        ctx.fillStyle = rgb(sampleRamp(BRASS, 0.9));
        ctx.fillRect(px - ts * 0.045, pullTop + ts * 0.3, ts * 0.09, ts * 0.03);
      }
      inkedRect(
        ctx,
        engineLeft + ts * 0.05,
        standY - ts * 0.02,
        engineW - ts * 0.1,
        ts * 0.04,
        sampleRamp(BRASS, 0.5),
        ts * 0.7,
      );
      paintTankard(ctx, box.left + ts * 2.1, standY, ts * 0.24, ts, PEWTER, true);
      paintTankard(ctx, box.left + ts * 2.5, standY + ts * 0.02, ts * 0.22, ts, HONEY_OAK, true);
      ctx.fillStyle = rgb(LINEN);
      ctx.beginPath();
      ctx.moveTo(box.left + ts * 0.12, standY - ts * 0.02);
      ctx.lineTo(box.left + ts * 0.4, standY - ts * 0.06);
      ctx.lineTo(box.left + ts * 0.42, faceTop + ts * 0.18);
      ctx.lineTo(box.left + ts * 0.16, faceTop + ts * 0.22);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    } else {
      // The till end: a brass-bound cash box, the bell, a lamp and a loaf.
      const boxLeft = box.left + ts * 1.7;
      inkedRect(
        ctx,
        boxLeft,
        standY - ts * 0.26,
        ts * 0.5,
        ts * 0.26,
        sampleRamp(HONEY_OAK, 0.3),
        ts,
      );
      inkedRect(
        ctx,
        boxLeft - ts * 0.02,
        standY - ts * 0.3,
        ts * 0.54,
        ts * 0.07,
        sampleRamp(HONEY_OAK, 0.55),
        ts,
      );
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.85));
      ctx.fillRect(boxLeft + ts * 0.21, standY - ts * 0.2, ts * 0.08, ts * 0.08);
      const bellX = box.left + ts * 2.6;
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.7));
      ctx.beginPath();
      ctx.moveTo(bellX - ts * 0.1, standY);
      ctx.quadraticCurveTo(bellX - ts * 0.1, standY - ts * 0.16, bellX, standY - ts * 0.16);
      ctx.quadraticCurveTo(bellX + ts * 0.1, standY - ts * 0.16, bellX + ts * 0.1, standY);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgba(sampleRamp(BRASS, 1), 0.8);
      ctx.fillRect(bellX - ts * 0.06, standY - ts * 0.12, ts * 0.025, ts * 0.08);
      paintPlate(
        ctx,
        box.left + ts * 0.9,
        standY - ts * 0.02,
        ts * 0.28,
        ts,
        'bread',
        sampleRamp(HONEY_OAK, 0.8),
      );
      // A hand lamp, brass with a glass chimney.
      const lampX = box.left + ts * 0.35;
      paintBloom(ctx, lampX, standY - ts * 0.3, ts * 0.4, FIRE_GLOW, 0.35);
      inkedRect(
        ctx,
        lampX - ts * 0.08,
        standY - ts * 0.08,
        ts * 0.16,
        ts * 0.08,
        sampleRamp(BRASS, 0.6),
        ts * 0.8,
      );
      ctx.fillStyle = rgba(GLASS_TINT, 0.6);
      ctx.beginPath();
      ctx.ellipse(lampX, standY - ts * 0.22, ts * 0.065, ts * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(FLAME_CORE);
      ctx.beginPath();
      ctx.ellipse(lampX, standY - ts * 0.2, ts * 0.02, ts * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * A plate dresser: a cupboard base with two drawers over two doors, and a
 * rack above it of blue-and-white plates stood on edge, with jugs hung from
 * hooks under each shelf.
 */
export function paintInnDresser(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);
    const baseTop = box.top + ts * 0.12;
    const rackTop = box.top - ts * 1.45;
    const inset = ts * 0.06;

    paintPlankBoard(
      ctx,
      box.left + inset,
      rackTop,
      box.width - inset * 2,
      baseTop - rackTop,
      forkRng(rng),
      {
        direction: 'vertical',
        boardPx: ts * 0.3,
        ramp: HONEY_OAK,
      },
    );
    ctx.fillStyle = rgba(SOOT, 0.22);
    ctx.fillRect(box.left + inset, rackTop, box.width - inset * 2, baseTop - rackTop);
    rectPath(ctx, box.left + inset, rackTop, box.width - inset * 2, baseTop - rackTop);
    inkOutline(ctx, ts);
    const shelfCount = 3;
    const shelfPitch = (baseTop - rackTop - ts * 0.1) / shelfCount;
    for (let shelf = 0; shelf < shelfCount; shelf++) {
      const shelfY = rackTop + ts * 0.1 + shelfPitch * (shelf + 1) - ts * 0.04;
      const plateCount = 4;
      for (let i = 0; i < plateCount; i++) {
        const px =
          box.left +
          inset +
          ts * 0.18 +
          i * ((box.width - inset * 2 - ts * 0.36) / (plateCount - 1));
        const radius = Math.min(ts * 0.14, shelfPitch * 0.42);
        const blue = (i + shelf) % 2 === 0;
        ctx.fillStyle = rgb(blue ? CROCKERY_BLUE : CROCKERY_WHITE);
        ctx.beginPath();
        ctx.arc(px, shelfY - radius, radius, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.7);
        ctx.strokeStyle = rgb(blue ? CROCKERY_WHITE : CROCKERY_BLUE);
        ctx.lineWidth = ts * 0.016;
        ctx.beginPath();
        ctx.arc(px, shelfY - radius, radius * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
      inkedRect(
        ctx,
        box.left + inset,
        shelfY,
        box.width - inset * 2,
        ts * 0.05,
        sampleRamp(HONEY_OAK, 0.66),
        ts * 0.8,
      );
    }
    inkedRect(
      ctx,
      box.left,
      rackTop - ts * 0.12,
      box.width,
      ts * 0.12,
      sampleRamp(HONEY_OAK, 0.62),
      ts,
    );

    // The base: a worktop, two drawers, two doors.
    inkedRect(
      ctx,
      box.left,
      baseTop,
      box.width,
      box.bottom - baseTop - ts * 0.03,
      sampleRamp(HONEY_OAK, 0.4),
      ts,
    );
    inkedRect(
      ctx,
      box.left - ts * 0.02,
      baseTop - ts * 0.02,
      box.width + ts * 0.04,
      ts * 0.08,
      sampleRamp(HONEY_OAK, 0.78),
      ts,
    );
    const halfW = box.width / 2;
    for (let i = 0; i < 2; i++) {
      const dx = box.left + i * halfW;
      inkedRect(
        ctx,
        dx + ts * 0.06,
        baseTop + ts * 0.1,
        halfW - ts * 0.12,
        ts * 0.16,
        sampleRamp(HONEY_OAK, 0.55),
        ts * 0.7,
      );
      inkedRect(
        ctx,
        dx + ts * 0.06,
        baseTop + ts * 0.32,
        halfW - ts * 0.12,
        box.bottom - baseTop - ts * 0.44,
        sampleRamp(HONEY_OAK, 0.5),
        ts * 0.7,
      );
      ctx.fillStyle = rgb(sampleRamp(BRASS, 0.85));
      ctx.beginPath();
      ctx.arc(dx + halfW / 2, baseTop + ts * 0.18, ts * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }
    paintJug(ctx, box.left + ts * 0.4, baseTop - ts * 0.02, ts * 0.24, ts, [150, 96, 62]);
    paintJug(ctx, box.right - ts * 0.35, baseTop - ts * 0.02, ts * 0.18, ts, CROCKERY_WHITE);
  });
}

/**
 * The cat's stool, kept exactly where the story says the cat sat: a
 * three-legged stool with a patchwork cushion on it and a saucer of milk
 * underneath, in case.
 */
export function paintCatStool(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, ts * 0.32, ts * 0.1, 0.3);
    const seatY = box.bottom - ts * 0.52;
    const legSpread = ts * 0.24;
    ctx.strokeStyle = rgb(sampleRamp(HONEY_OAK, 0.3));
    ctx.lineWidth = ts * 0.06;
    for (const dx of [-legSpread, 0, legSpread]) {
      ctx.beginPath();
      ctx.moveTo(box.centreX + dx * 0.6, seatY);
      ctx.lineTo(box.centreX + dx, box.bottom - ts * 0.08 - (dx === 0 ? ts * 0.06 : 0));
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(HONEY_OAK, 0.6));
    ctx.beginPath();
    ctx.ellipse(box.centreX, seatY, ts * 0.3, ts * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      box.centreX - ts * 0.3,
      seatY,
      ts * 0.6,
      ts * 0.06,
      sampleRamp(HONEY_OAK, 0.35),
      ts * 0.8,
    );
    // The cushion, stitched from four patches.
    const cushionY = seatY - ts * 0.08;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(box.centreX, cushionY, ts * 0.25, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.clip();
    CUSHION_PATCHES.forEach((patch, i) => {
      ctx.fillStyle = rgb(patch);
      ctx.fillRect(
        box.centreX - ts * 0.25 + (i % 2) * ts * 0.25,
        cushionY - ts * 0.1 + Math.floor(i / 2) * ts * 0.1,
        ts * 0.25,
        ts * 0.1,
      );
    });
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(box.centreX, cushionY, ts * 0.25, ts * 0.1, 0, 0, Math.PI * 2);
    inkOutline(ctx, ts);
    // A dent in it, as though something was curled there a moment ago.
    ctx.fillStyle = rgba(SOOT, 0.2);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX + jitter(rng, ts * 0.02),
      cushionY,
      ts * 0.12,
      ts * 0.045,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // The saucer.
    const saucerX = box.centreX + ts * 0.3;
    const saucerY = box.bottom - ts * 0.12;
    ctx.fillStyle = rgb(CROCKERY_WHITE);
    ctx.beginPath();
    ctx.ellipse(saucerX, saucerY, ts * 0.12, ts * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(MILK);
    ctx.beginPath();
    ctx.ellipse(saucerX, saucerY - ts * 0.005, ts * 0.075, ts * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** A rust-red wingback, turned a little toward the fire, with a folded blanket over one arm. */
export function paintFiresideChair(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, ts * 0.4, ts * 0.12, 0.34);
    const cx = box.centreX;
    const backTop = box.bottom - ts * 1.25;
    const seatY = box.bottom - ts * 0.48;
    // Wings and back.
    roundRectPath(ctx, cx - ts * 0.34, backTop, ts * 0.68, seatY - backTop + ts * 0.05, ts * 0.16);
    ctx.fillStyle = rgb(UPHOLSTERY_RUST_DARK);
    ctx.fill();
    inkOutline(ctx, ts);
    roundRectPath(
      ctx,
      cx - ts * 0.24,
      backTop + ts * 0.08,
      ts * 0.48,
      seatY - backTop - ts * 0.06,
      ts * 0.12,
    );
    ctx.fillStyle = rgb(UPHOLSTERY_RUST);
    ctx.fill();
    ctx.fillStyle = rgba(UPHOLSTERY_RUST_LIGHT, 0.6);
    ctx.fillRect(cx - ts * 0.2, backTop + ts * 0.14, ts * 0.08, seatY - backTop - ts * 0.24);
    // Button tufts.
    ctx.fillStyle = rgb(UPHOLSTERY_RUST_DARK);
    for (const [dx, dy] of [
      [-0.1, 0.3],
      [0.1, 0.3],
      [0, 0.5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx * ts, backTop + dy * ts, ts * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
    // Seat cushion and arms.
    roundRectPath(ctx, cx - ts * 0.3, seatY - ts * 0.08, ts * 0.6, ts * 0.2, ts * 0.06);
    ctx.fillStyle = rgb(UPHOLSTERY_RUST_LIGHT);
    ctx.fill();
    inkOutline(ctx, ts);
    for (const side of [-1, 1]) {
      roundRectPath(
        ctx,
        cx + side * ts * 0.36 - ts * 0.08,
        seatY - ts * 0.2,
        ts * 0.16,
        ts * 0.42,
        ts * 0.06,
      );
      ctx.fillStyle = rgb(UPHOLSTERY_RUST);
      ctx.fill();
      inkOutline(ctx, ts);
    }
    inkedRect(
      ctx,
      cx - ts * 0.38,
      seatY + ts * 0.12,
      ts * 0.76,
      ts * 0.12,
      UPHOLSTERY_RUST_DARK,
      ts,
    );
    for (const side of [-1, 1])
      inkedRect(
        ctx,
        cx + side * ts * 0.3 - ts * 0.025,
        seatY + ts * 0.24,
        ts * 0.05,
        ts * 0.16,
        sampleRamp(HONEY_OAK, 0.3),
        ts * 0.8,
      );
    // The blanket over the east arm.
    ctx.fillStyle = rgb(QUILT_GREEN);
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.24, seatY - ts * 0.24);
    ctx.lineTo(cx + ts * 0.46, seatY - ts * 0.2);
    ctx.lineTo(cx + ts * 0.46, seatY + ts * 0.22);
    ctx.lineTo(cx + ts * 0.3, seatY + ts * 0.26);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(QUILT_CREAM);
    ctx.lineWidth = ts * 0.02;
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.3, seatY - ts * 0.1);
    ctx.lineTo(cx + ts * 0.46, seatY - ts * 0.08);
    ctx.stroke();
  });
}

/** A wicker basket of split logs and kindling, set down beside the fire. */
export function paintLogBasket(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, ts * 0.36, ts * 0.1, 0.3);
    const basketTop = box.bottom - ts * 0.42;
    const basketLeft = box.centreX - ts * 0.34;
    const basketW = ts * 0.68;
    // Logs standing up out of it first, so the basket's rim covers their feet.
    for (let i = 0; i < 4; i++) {
      const lx = basketLeft + ts * 0.12 + i * ts * 0.14;
      const lean = jitter(rng, ts * 0.05);
      const topY = basketTop - ts * (0.25 + (i % 2) * 0.1);
      ctx.fillStyle = rgb(LOG_BARK);
      ctx.beginPath();
      ctx.moveTo(lx - ts * 0.06, basketTop + ts * 0.05);
      ctx.lineTo(lx - ts * 0.06 + lean, topY);
      ctx.lineTo(lx + ts * 0.06 + lean, topY);
      ctx.lineTo(lx + ts * 0.06, basketTop + ts * 0.05);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(LOG_END);
      ctx.beginPath();
      ctx.ellipse(lx + lean, topY, ts * 0.06, ts * 0.025, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgb(WICKER);
    ctx.beginPath();
    ctx.moveTo(basketLeft, basketTop);
    ctx.lineTo(basketLeft + basketW, basketTop);
    ctx.lineTo(basketLeft + basketW - ts * 0.06, box.bottom - ts * 0.08);
    ctx.lineTo(basketLeft + ts * 0.06, box.bottom - ts * 0.08);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgb(WICKER_DARK);
    ctx.lineWidth = ts * 0.018;
    for (let row = 1; row < 4; row++) {
      const y = basketTop + ((box.bottom - ts * 0.08 - basketTop) * row) / 4;
      ctx.beginPath();
      ctx.moveTo(basketLeft + ts * 0.03, y);
      ctx.lineTo(basketLeft + basketW - ts * 0.03, y);
      ctx.stroke();
    }
    inkedRect(
      ctx,
      basketLeft - ts * 0.02,
      basketTop - ts * 0.03,
      basketW + ts * 0.04,
      ts * 0.06,
      WICKER_DARK,
      ts * 0.8,
    );
  });
}

/**
 * A long supper table, honey oak under a linen runner, laid for the evening.
 * Variant 0 is stew night — bowls, bread, a jug of ale; variant 1 is the
 * roast — a fowl on the platter, cheese and apples.
 */
export function paintInnTable(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);
    const top = box.top + ts * 0.04;
    const depth = ts * 0.5;
    const apronH = ts * 0.1;
    const legTop = top + depth + apronH;
    for (const lx of [box.left + ts * 0.14, box.right - ts * 0.14])
      paintLeg(ctx, lx, legTop - ts * 0.02, box.bottom - ts * 0.06, ts * 0.1, ts, HONEY_OAK);
    const frontY = paintTableTop(
      ctx,
      box.left + ts * 0.04,
      top,
      box.width - ts * 0.08,
      depth,
      apronH,
      ts,
      HONEY_OAK,
      rng,
    );

    // The runner, falling over the front edge.
    const runnerLeft = box.left + ts * 0.3;
    const runnerW = box.width - ts * 0.6;
    ctx.fillStyle = rgb(LINEN);
    rectPath(ctx, runnerLeft, top + depth * 0.25, runnerW, depth * 0.75 + apronH + ts * 0.06);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(LINEN_STRIPE);
    ctx.fillRect(runnerLeft, top + depth * 0.25 + ts * 0.02, runnerW, ts * 0.02);
    ctx.fillRect(runnerLeft, frontY + apronH - ts * 0.01, runnerW, ts * 0.025);

    const rimColor = CROCKERY_BLUE;
    const plateY = top + depth * 0.62;
    if (variant === 0) {
      paintPlate(ctx, box.left + ts * 0.55, plateY, ts * 0.2, ts, 'stew', rimColor);
      paintPlate(
        ctx,
        box.left + ts * 1.5,
        plateY - ts * 0.04,
        ts * 0.26,
        ts,
        'bread',
        sampleRamp(HONEY_OAK, 0.75),
      );
      paintPlate(ctx, box.right - ts * 0.55, plateY, ts * 0.2, ts, 'stew', rimColor);
      paintJug(ctx, box.left + ts * 2.05, plateY + ts * 0.06, ts * 0.3, ts, [150, 96, 62]);
      paintTankard(ctx, box.left + ts * 1.0, plateY + ts * 0.1, ts * 0.2, ts, PEWTER, true);
      paintTankard(ctx, box.right - ts * 0.95, plateY + ts * 0.12, ts * 0.2, ts, HONEY_OAK, true);
      paintCandle(ctx, box.centreX + ts * 0.2, plateY - ts * 0.05, ts * 0.18, ts);
    } else {
      paintPlate(ctx, box.centreX, plateY, ts * 0.36, ts, 'fowl', sampleRamp(PEWTER, 0.7));
      paintPlate(ctx, box.left + ts * 0.5, plateY, ts * 0.2, ts, 'cheese', rimColor);
      paintPlate(
        ctx,
        box.right - ts * 0.5,
        plateY,
        ts * 0.2,
        ts,
        'apples',
        sampleRamp(HONEY_OAK, 0.75),
      );
      paintTankard(ctx, box.left + ts * 0.95, plateY + ts * 0.1, ts * 0.2, ts, PEWTER, true);
      paintTankard(ctx, box.right - ts * 1.0, plateY + ts * 0.1, ts * 0.2, ts, PEWTER, false);
      paintCandlestick(ctx, box.centreX - ts * 0.62, plateY - ts * 0.02, ts * 0.34, ts, BRASS);
      paintCandlestick(ctx, box.centreX + ts * 0.62, plateY - ts * 0.02, ts * 0.34, ts, BRASS);
    }
  });
}

/** A plain oak bench, drawn from the room side of the table it serves. */
export function paintInnBench(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    drawTownContactShadow(ctx, box.centreX, box.bottom - ts * 0.1, box.width * 0.44, ts * 0.1, 0.3);
    const seatTop = box.top + ts * 0.3;
    const seatDepth = ts * 0.22;
    for (const lx of [box.left + ts * 0.2, box.right - ts * 0.2])
      paintLeg(ctx, lx, seatTop + seatDepth, box.bottom - ts * 0.08, ts * 0.09, ts, HONEY_OAK);
    paintTableTop(
      ctx,
      box.left + ts * 0.08,
      seatTop,
      box.width - ts * 0.16,
      seatDepth,
      ts * 0.08,
      ts,
      HONEY_OAK,
      rng,
    );
  });
}

/** A pillow, puffed and outlined. */
function paintPillow(ctx: Ctx, cx: number, cy: number, width: number, ts: number): void {
  roundRectPath(ctx, cx - width / 2, cy - ts * 0.1, width, ts * 0.2, ts * 0.08);
  ctx.fillStyle = rgb(LINEN);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgba(sampleRamp(HONEY_OAK, 0.8), 0.3);
  ctx.fillRect(cx - width / 2 + ts * 0.04, cy + ts * 0.02, width - ts * 0.08, ts * 0.05);
}

/**
 * A guest room's double bed, headboard to the wall: turned oak posts, two
 * pillows, a sheet turned down over the quilt. Variant 0 has a blue-and-cream
 * check, variant 1 a patchwork of the house's odd ends.
 */
export function paintInnGuestBed(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);
    const headTop = box.top - ts * 0.55;
    const mattressTop = box.top + ts * 0.22;
    const mattressBottom = box.bottom - ts * 0.28;
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;

    // Headboard with its two posts.
    roundRectPath(
      ctx,
      left + ts * 0.06,
      headTop + ts * 0.1,
      right - left - ts * 0.12,
      mattressTop - headTop,
      ts * 0.18,
    );
    ctx.fillStyle = rgb(sampleRamp(HONEY_OAK, 0.5));
    ctx.fill();
    inkOutline(ctx, ts);
    inkedRect(
      ctx,
      left + ts * 0.22,
      headTop + ts * 0.26,
      right - left - ts * 0.44,
      ts * 0.32,
      sampleRamp(HONEY_OAK, 0.35),
      ts * 0.8,
    );
    for (const px of [left, right - ts * 0.1]) {
      inkedRect(
        ctx,
        px,
        headTop,
        ts * 0.1,
        mattressTop - headTop + ts * 0.2,
        sampleRamp(HONEY_OAK, 0.4),
        ts,
      );
      ctx.fillStyle = rgb(sampleRamp(HONEY_OAK, 0.8));
      ctx.beginPath();
      ctx.arc(px + ts * 0.05, headTop, ts * 0.07, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
    }

    // Mattress and pillows.
    inkedRect(
      ctx,
      left + ts * 0.04,
      mattressTop,
      right - left - ts * 0.08,
      mattressBottom - mattressTop,
      LINEN,
      ts,
    );
    const pillowY = mattressTop + ts * 0.16;
    const pillowW = (right - left) * 0.36;
    paintPillow(ctx, box.centreX - pillowW * 0.58, pillowY, pillowW, ts);
    paintPillow(ctx, box.centreX + pillowW * 0.58, pillowY, pillowW, ts);

    // The quilt, turned down under a sheet fold.
    const quiltTop = mattressTop + ts * 0.42;
    const quiltLeft = left - ts * 0.02;
    const quiltW = right - left + ts * 0.04;
    const quiltH = box.bottom - ts * 0.1 - quiltTop;
    ctx.save();
    rectPath(ctx, quiltLeft, quiltTop, quiltW, quiltH);
    ctx.clip();
    const cell = ts * 0.24;
    const cols = Math.ceil(quiltW / cell);
    const rows = Math.ceil(quiltH / cell);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let color: RGB;
        if (variant === 0) color = (row + col) % 2 === 0 ? QUILT_BLUE : QUILT_CREAM;
        else color = CUSHION_PATCHES[Math.floor(rng() * CUSHION_PATCHES.length)];
        ctx.fillStyle = rgb(color);
        ctx.fillRect(quiltLeft + col * cell, quiltTop + row * cell, cell, cell);
      }
    }
    ctx.fillStyle = rgba([0, 0, 0], 0.16);
    ctx.fillRect(quiltLeft, quiltTop + quiltH * 0.72, quiltW, quiltH * 0.28);
    ctx.restore();
    rectPath(ctx, quiltLeft, quiltTop, quiltW, quiltH);
    inkOutline(ctx, ts);
    inkedRect(ctx, quiltLeft, quiltTop - ts * 0.02, quiltW, ts * 0.12, LINEN, ts * 0.9);

    // Footboard.
    inkedRect(
      ctx,
      left,
      box.bottom - ts * 0.2,
      right - left,
      ts * 0.14,
      sampleRamp(HONEY_OAK, 0.45),
      ts,
    );
    for (const px of [left, right - ts * 0.1])
      inkedRect(
        ctx,
        px,
        box.bottom - ts * 0.34,
        ts * 0.1,
        ts * 0.3,
        sampleRamp(HONEY_OAK, 0.4),
        ts,
      );
  });
}

/**
 * A narrow cot for the cheap room: a plain pine frame, one flat pillow, a
 * grey wool blanket with a dark stripe, and a pair of boots left under the
 * foot — three of these side by side is a dormitory at a glance.
 */
export function paintInnCot(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    const headTop = box.top - ts * 0.3;
    const frameTop = box.top + ts * 0.05;
    const frameBottom = box.bottom - ts * 0.16;

    inkedRect(ctx, left, headTop, right - left, ts * 0.42, sampleRamp(HONEY_OAK, 0.55), ts);
    ctx.fillStyle = rgba(sampleRamp(HONEY_OAK, 1), 0.4);
    ctx.fillRect(left + ts * 0.03, headTop + ts * 0.03, right - left - ts * 0.06, ts * 0.05);
    inkedRect(
      ctx,
      left,
      frameTop,
      right - left,
      frameBottom - frameTop,
      sampleRamp(HONEY_OAK, 0.4),
      ts,
    );
    inkedRect(
      ctx,
      left + ts * 0.05,
      frameTop + ts * 0.03,
      right - left - ts * 0.1,
      frameBottom - frameTop - ts * 0.1,
      LINEN,
      ts * 0.8,
    );
    paintPillow(ctx, box.centreX, frameTop + ts * 0.18, right - left - ts * 0.16, ts);

    const blanketTop = frameTop + ts * 0.45 + jitter(rng, ts * 0.03);
    const blanket = variant % 2 === 0 ? WOOL_GREY : WOOL_BROWN;
    const blanketDark = variant % 2 === 0 ? WOOL_GREY_DARK : WOOL_BROWN_DARK;
    inkedRect(
      ctx,
      left - ts * 0.02,
      blanketTop,
      right - left + ts * 0.04,
      frameBottom - blanketTop + ts * 0.04,
      blanket,
      ts,
    );
    ctx.fillStyle = rgb(blanketDark);
    ctx.fillRect(left - ts * 0.02, blanketTop + ts * 0.1, right - left + ts * 0.04, ts * 0.06);
    ctx.fillRect(left - ts * 0.02, frameBottom - ts * 0.16, right - left + ts * 0.04, ts * 0.06);
    ctx.fillStyle = rgba(GLASS_TINT, 0.25);
    ctx.fillRect(
      left + ts * 0.02,
      blanketTop + ts * 0.02,
      ts * 0.06,
      frameBottom - blanketTop - ts * 0.04,
    );
    inkedRect(
      ctx,
      left,
      frameBottom,
      ts * 0.07,
      box.bottom - frameBottom - ts * 0.06,
      sampleRamp(HONEY_OAK, 0.3),
      ts,
    );
    inkedRect(
      ctx,
      right - ts * 0.07,
      frameBottom,
      ts * 0.07,
      box.bottom - frameBottom - ts * 0.06,
      sampleRamp(HONEY_OAK, 0.3),
      ts,
    );
  });
}

/** A washstand: a basin and a ewer, a towel over the rail, a small glass on the wall above. */
export function paintWashstand(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    oakShadow(ctx, box, ts);
    // The looking glass, on two uprights rising from the back of the stand.
    const mirrorTop = box.top - ts * 0.72;
    for (const side of [-1, 1])
      inkedRect(
        ctx,
        box.centreX + side * ts * 0.2 - ts * 0.025,
        mirrorTop + ts * 0.2,
        ts * 0.05,
        ts * 0.72,
        sampleRamp(HONEY_OAK, 0.4),
        ts * 0.8,
      );
    roundRectPath(ctx, box.centreX - ts * 0.2, mirrorTop, ts * 0.4, ts * 0.46, ts * 0.12);
    ctx.fillStyle = rgb(sampleRamp(HONEY_OAK, 0.45));
    ctx.fill();
    inkOutline(ctx, ts);
    roundRectPath(
      ctx,
      box.centreX - ts * 0.14,
      mirrorTop + ts * 0.06,
      ts * 0.28,
      ts * 0.34,
      ts * 0.08,
    );
    ctx.fillStyle = rgb([176, 196, 204]);
    ctx.fill();
    ctx.fillStyle = rgba(GLASS_TINT, 0.7);
    ctx.fillRect(box.centreX - ts * 0.09, mirrorTop + ts * 0.1, ts * 0.04, ts * 0.22);

    const top = box.top + ts * 0.12;
    const depth = ts * 0.34;
    for (const lx of [box.left + ts * 0.16, box.right - ts * 0.16])
      paintLeg(ctx, lx, top + depth, box.bottom - ts * 0.06, ts * 0.07, ts, HONEY_OAK);
    inkedRect(
      ctx,
      box.left + ts * 0.14,
      box.bottom - ts * 0.3,
      box.width - ts * 0.28,
      ts * 0.05,
      sampleRamp(HONEY_OAK, 0.5),
      ts * 0.8,
    );
    paintTableTop(
      ctx,
      box.left + ts * 0.08,
      top,
      box.width - ts * 0.16,
      depth,
      ts * 0.08,
      ts,
      HONEY_OAK,
      rng,
    );
    // Towel over the front rail.
    ctx.fillStyle = rgb(LINEN);
    ctx.fillRect(box.left + ts * 0.2, top + depth + ts * 0.02, ts * 0.22, ts * 0.3);
    rectPath(ctx, box.left + ts * 0.2, top + depth + ts * 0.02, ts * 0.22, ts * 0.3);
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(LINEN_STRIPE);
    ctx.fillRect(box.left + ts * 0.2, top + depth + ts * 0.24, ts * 0.22, ts * 0.03);
    // Basin and ewer.
    const basinY = top + depth * 0.62;
    ctx.fillStyle = rgb(CROCKERY_WHITE);
    ctx.beginPath();
    ctx.ellipse(box.centreX - ts * 0.08, basinY, ts * 0.22, ts * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb([150, 184, 196]);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX - ts * 0.08,
      basinY - ts * 0.01,
      ts * 0.15,
      ts * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    paintJug(ctx, box.centreX + ts * 0.22, basinY + ts * 0.06, ts * 0.3, ts, CROCKERY_WHITE);
  });
}

/** The rag rug's braids, outermost first: the house's worn-out shirts and shawls, plaited and coiled. */
const RAG_RUG_BRAIDS: ReadonlyArray<ReadonlyArray<RGB>> = [
  [
    [120, 46, 38],
    [196, 140, 70],
    [150, 60, 46],
    [226, 206, 162],
    [96, 118, 76],
    [176, 76, 56],
    [206, 162, 86],
  ],
  [
    [74, 90, 120],
    [206, 170, 104],
    [150, 64, 50],
    [226, 206, 162],
    [110, 128, 88],
    [196, 120, 70],
    [132, 52, 44],
  ],
];

/**
 * A braided rag rug, coiled from the centre out — a stadium on a runner's
 * footprint, near enough an oval on a squarer one. Every ring is a plait,
 * drawn as a band with its braid ticked in a lighter strand.
 */
export function paintRagRug(ctx: Ctx, frame: TownPropFrame, variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const braids = RAG_RUG_BRAIDS[variant % RAG_RUG_BRAIDS.length];
    const inset = ts * 0.08;
    const left = box.left + inset;
    const top = box.top + inset;
    const width = box.width - inset * 2;
    const height = box.height - inset * 2;
    const ringW = ts * 0.13;
    const ringCount = Math.max(2, Math.floor(Math.min(width, height) / 2 / ringW));
    for (let ring = 0; ring < ringCount; ring++) {
      const r = ring * ringW;
      const w = width - r * 2;
      const h = height - r * 2;
      if (w <= 0 || h <= 0) break;
      const color = braids[ring % braids.length];
      roundRectPath(ctx, left + r, top + r, w, h, Math.min(w, h) / 2);
      ctx.fillStyle = rgb(color);
      ctx.fill();
      if (ring === 0) inkOutline(ctx, ts);
      const mid = r + ringW / 2;
      roundRectPath(
        ctx,
        left + mid,
        top + mid,
        width - mid * 2,
        height - mid * 2,
        Math.max(0, Math.min(width - mid * 2, height - mid * 2) / 2),
      );
      ctx.setLineDash([ts * 0.05, ts * 0.05]);
      ctx.strokeStyle = rgba(mix(color, [255, 240, 210], 0.35), 0.8);
      ctx.lineWidth = ts * 0.035;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}
