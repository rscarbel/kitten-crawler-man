/**
 * The service level's low furniture: the mop bucket with its "wet floor" sign,
 * the pallet stack, the office desk and the locker-room bench.
 *
 * All four are seen past — a crawler behind one is not hidden — so none rises
 * much above its own tile, bar the mop handle and the monitor. The desk and the
 * bench are two tiles across and are drawn whole from their south-west tile.
 *
 * Measurements are in source pixels at the sheet's 64 px tile unless a name
 * says it is a fraction of the tile.
 */

import { type Ctx, contactShadow, lerp, withRotation } from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  BARE_STEEL,
  BENCH_WOOD,
  CAVITY,
  DESK_LAMINATE,
  DESK_STEEL,
  MONITOR_PLASTIC,
  PALLET_WOOD,
  SAFETY_YELLOW,
  type BoxGeometry,
  boxBackTop,
  boxFrontTop,
  dent,
  line,
  paintBox,
  wash,
} from './servicePaint';
import { ONE_TILE_BASE_FRACTION, drawPaperSheets } from './serviceTallProps';

const FULL_TURN = Math.PI * 2;
/** Separates one variant's seeded stream from the next. */
const VARIANT_SEED_STRIDE = 431;
/** Offsets a remains painter's stream from the same kind's standing one. */
const REMAINS_SEED_OFFSET = 0x21;

/** Draws a filled ellipse at partial alpha. */
function blot(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colour: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

// ── Mop bucket and wet floor sign ──────────────────────────────────────────

const BUCKET_SEED = 0xb0c7;
const BUCKET_LEFT_FRACTION = 0.1;
const BUCKET_WIDTH_FRACTION = 0.46;
const BUCKET_HEIGHT_FRACTION = 0.3;
const BUCKET_DEPTH_FRACTION = 0.2;
const BUCKET_CONTACT_SHADOW_SCALE = 0.7;
const BUCKET = {
  waterInset: 2,
  rimLineDrop: 4,
  castorInset: 3,
  castorRadius: 2.2,
  wringerW: 13,
  wringerH: 9,
  wringerSink: 3,
  wringerLitBand: 2,
  leverReachX: 5,
  leverRise: 11,
  leverWidth: 2,
  handleFootFraction: 0.4,
  handleLean: 9,
  handleTopAboveTileFraction: 0.38,
  handleWidth: 2.4,
  handleGlintWidth: 0.8,
  handleGlintOffset: 0.6,
  strandCount: 6,
  strandPitch: 2,
  strandSpread: 5,
  strandJitter: 3,
  strandWidth: 1.3,
  crackFromLeft: 9,
  crackLean: 4,
  crackWidth: 1.6,
  dentFromRight: 8,
  dentDrop: 8,
  dentRx: 4,
  dentRy: 2.5,
  slopInsetX: 2,
  slopReach: 8,
  slopH: 5,
  slopAlpha: 0.45,
  driblChance: 0.5,
  driblInset: 4,
  driblH: 3,
  driblAlpha: 0.3,
  waterAlpha: 0.95,
} as const;
const MOP_HANDLE = '#8e8a7c';
const MOP_HANDLE_GLINT = '#b9b5a6';
const MOP_STRANDS = '#bdb6a0';
const DIRTY_WATER = '#4b4a3c';
const CASTOR = '#1a1a1a';

const SIGN_LEFT_FRACTION = 0.64;
const SIGN = {
  baseWidth: 17,
  topWidth: 9,
  heightFraction: 0.62,
  crownRise: 2,
  shoulderDrop: 3,
  outlineWidth: 1.2,
  handleHoleW: 3,
  handleHoleH: 2.5,
  handleHoleDrop: 1.5,
  figureHeightFraction: 0.45,
  headX: 2.5,
  headY: -6,
  headRadius: 1.8,
  stripeInset: 3,
  stripeRise: 5,
  stripeH: 2,
  contactShadowScale: 0.32,
} as const;
const SIGN_INK = '#1f1c12';
/** The slipping figure as strokes, each [x0, y0, x1, y1, width] about the figure's hip. */
const SLIPPING_FIGURE_STROKES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [1.5, -4, -1.5, 2, 1.6],
  [-1.5, 2, 3, 3, 1.4],
  [-1.5, 2, -4, 7, 1.4],
  [1, -2, 4.5, -4, 1.2],
];

/** The sign standing, its foot at (`cx`, `baseY`), leaning by `angle`. */
function drawStandingSign(ctx: Ctx, cx: number, baseY: number, ts: number, angle: number): void {
  const height = ts * SIGN.heightFraction;
  withRotation(ctx, cx, baseY, angle, () => {
    contactShadow(ctx, cx, baseY, ts, SIGN.contactShadowScale);
    const top = baseY - height;
    ctx.save();
    ctx.fillStyle = SAFETY_YELLOW.frontHigh;
    ctx.beginPath();
    ctx.moveTo(cx - SIGN.baseWidth / 2, baseY);
    ctx.lineTo(cx - SIGN.topWidth / 2, top + SIGN.shoulderDrop);
    ctx.quadraticCurveTo(cx, top - SIGN.crownRise, cx + SIGN.topWidth / 2, top + SIGN.shoulderDrop);
    ctx.lineTo(cx + SIGN.baseWidth / 2, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SAFETY_YELLOW.outline;
    ctx.lineWidth = SIGN.outlineWidth;
    ctx.stroke();
    ctx.restore();
    wash(
      ctx,
      cx - SIGN.handleHoleW / 2,
      top + SIGN.handleHoleDrop,
      SIGN.handleHoleW,
      SIGN.handleHoleH,
      CAVITY,
      1,
    );
    const hipY = top + height * SIGN.figureHeightFraction;
    ctx.save();
    ctx.fillStyle = SIGN_INK;
    ctx.beginPath();
    ctx.arc(cx + SIGN.headX, hipY + SIGN.headY, SIGN.headRadius, 0, FULL_TURN);
    ctx.fill();
    ctx.restore();
    for (const [x0, y0, x1, y1, width] of SLIPPING_FIGURE_STROKES) {
      line(ctx, cx + x0, hipY + y0, cx + x1, hipY + y1, SIGN_INK, width);
    }
    wash(
      ctx,
      cx - SIGN.baseWidth / 2 + SIGN.stripeInset,
      baseY - SIGN.stripeRise,
      SIGN.baseWidth - SIGN.stripeInset * 2,
      SIGN.stripeH,
      SIGN_INK,
      1,
    );
  });
}

const LYING_SIGN = { w: 12, h: 18, angle: 0.3, inkW: 4, inkH: 6, shadowAlpha: 0.25 } as const;

/** The sign gone over, lying flat on the floor centred on (`cx`, `cy`). */
function drawLyingSign(ctx: Ctx, cx: number, cy: number): void {
  withRotation(ctx, cx, cy, LYING_SIGN.angle, () => {
    wash(
      ctx,
      cx - LYING_SIGN.w / 2 + 1,
      cy - LYING_SIGN.h / 2 + 1,
      LYING_SIGN.w,
      LYING_SIGN.h,
      '#000',
      LYING_SIGN.shadowAlpha,
    );
    wash(
      ctx,
      cx - LYING_SIGN.w / 2,
      cy - LYING_SIGN.h / 2,
      LYING_SIGN.w,
      LYING_SIGN.h,
      SAFETY_YELLOW.frontHigh,
      1,
    );
    wash(
      ctx,
      cx - LYING_SIGN.inkW / 2,
      cy - LYING_SIGN.inkH / 2,
      LYING_SIGN.inkW,
      LYING_SIGN.inkH,
      SIGN_INK,
      1,
    );
  });
}

/** Frames in the sign's skid when the bucket is first knocked: three sliding and tipping, then down. */
export const SIGN_SKID_FRAMES = 4;
/** How far right the sign slides before it goes over, in tiles. */
const SIGN_SKID_TILES = 0.12;
/** How far it has tipped by its last standing frame. */
const SIGN_SKID_MAX_LEAN = 0.6;
/** Where the sign lies once down, as fractions of the tile. */
const SIGN_DOWN_X_FRACTION = 0.8;
const SIGN_DOWN_Y_FRACTION = 0.72;

function signFootX(ox: number, ts: number): number {
  return ox + ts * SIGN_LEFT_FRACTION + SIGN.baseWidth / 2;
}

/**
 * One frame of the sign skidding away from the bucket after a knock: it slides
 * and tips over the first frames and lies flat on the last, which is where the
 * damaged bucket's art leaves it.
 */
export function drawSignSkidFrame(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  frame: number,
): void {
  const lastFrame = SIGN_SKID_FRAMES - 1;
  if (frame >= lastFrame) {
    drawLyingSign(ctx, ox + ts * SIGN_DOWN_X_FRACTION, oy + ts * SIGN_DOWN_Y_FRACTION);
    return;
  }
  const progress = frame / lastFrame;
  drawStandingSign(
    ctx,
    signFootX(ox, ts) + progress * ts * SIGN_SKID_TILES,
    oy + ts * ONE_TILE_BASE_FRACTION,
    ts,
    progress * SIGN_SKID_MAX_LEAN,
  );
}

/** The tub of the bucket. */
function bucketBox(ox: number, oy: number, ts: number): BoxGeometry {
  const left = ox + ts * BUCKET_LEFT_FRACTION;
  return {
    left,
    right: left + ts * BUCKET_WIDTH_FRACTION,
    baseY: oy + ts * ONE_TILE_BASE_FRACTION - BUCKET.castorRadius,
    height: ts * BUCKET_HEIGHT_FRACTION,
    depth: ts * BUCKET_DEPTH_FRACTION,
  };
}

/** The bucket, the mop standing in it, and its wringer; no sign. */
function drawBucket(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const rng = mulberry32(BUCKET_SEED + variant * VARIANT_SEED_STRIDE);
  const box = bucketBox(ox, oy, ts);
  const frontTop = boxFrontTop(box);
  const backTop = boxBackTop(box);
  const width = box.right - box.left;
  contactShadow(
    ctx,
    (box.left + box.right) / 2,
    box.baseY + BUCKET.castorRadius,
    ts,
    BUCKET_CONTACT_SHADOW_SCALE,
  );
  if (damaged) {
    wash(
      ctx,
      box.left - BUCKET.slopInsetX,
      box.baseY - 1,
      width + BUCKET.slopReach,
      BUCKET.slopH,
      DIRTY_WATER,
      BUCKET.slopAlpha,
    );
  }

  // The handle first, so the tub's rim is drawn over its foot.
  const handleFootX = box.left + width * BUCKET.handleFootFraction;
  const handleTopY = oy - ts * BUCKET.handleTopAboveTileFraction;
  line(
    ctx,
    handleFootX,
    frontTop,
    handleFootX + BUCKET.handleLean,
    handleTopY,
    MOP_HANDLE,
    BUCKET.handleWidth,
  );
  line(
    ctx,
    handleFootX - BUCKET.handleGlintOffset,
    frontTop,
    handleFootX + BUCKET.handleLean - BUCKET.handleGlintOffset,
    handleTopY,
    MOP_HANDLE_GLINT,
    BUCKET.handleGlintWidth,
  );

  paintBox(ctx, box, SAFETY_YELLOW);
  wash(
    ctx,
    box.left + BUCKET.waterInset,
    backTop + BUCKET.waterInset,
    width - BUCKET.waterInset * 2,
    box.depth - BUCKET.waterInset * 2,
    DIRTY_WATER,
    BUCKET.waterAlpha,
  );
  for (let i = 0; i < BUCKET.strandCount; i++) {
    const sx = handleFootX - BUCKET.strandSpread + i * BUCKET.strandPitch;
    const jitter = (rng() - 0.5) * BUCKET.strandJitter;
    line(
      ctx,
      sx,
      backTop + BUCKET.waterInset,
      sx + jitter,
      frontTop - 1,
      MOP_STRANDS,
      BUCKET.strandWidth,
    );
  }
  const wringerX = box.right - BUCKET.wringerW - 1;
  const wringerTop = backTop - BUCKET.wringerH + BUCKET.wringerSink;
  wash(ctx, wringerX, wringerTop, BUCKET.wringerW, BUCKET.wringerH, BARE_STEEL.mid, 1);
  wash(ctx, wringerX, wringerTop, BUCKET.wringerW, BUCKET.wringerLitBand, BARE_STEEL.light, 1);
  line(
    ctx,
    wringerX + BUCKET.wringerW - BUCKET.leverWidth,
    wringerTop,
    wringerX + BUCKET.wringerW + BUCKET.leverReachX,
    wringerTop - BUCKET.leverRise,
    BARE_STEEL.dark,
    BUCKET.leverWidth,
  );
  line(
    ctx,
    box.left + BUCKET.waterInset,
    frontTop + BUCKET.rimLineDrop,
    box.right - BUCKET.waterInset,
    frontTop + BUCKET.rimLineDrop,
    SAFETY_YELLOW.frontLow,
    1,
  );
  for (const x of [box.left + BUCKET.castorInset, box.right - BUCKET.castorInset]) {
    blot(ctx, x, box.baseY, BUCKET.castorRadius, BUCKET.castorRadius, CASTOR, 1);
  }
  if (damaged) {
    line(
      ctx,
      box.left + BUCKET.crackFromLeft,
      frontTop + 1,
      box.left + BUCKET.crackFromLeft + BUCKET.crackLean,
      box.baseY - BUCKET.waterInset,
      CAVITY,
      BUCKET.crackWidth,
    );
    dent(
      ctx,
      box.right - BUCKET.dentFromRight,
      frontTop + BUCKET.dentDrop,
      BUCKET.dentRx,
      BUCKET.dentRy,
    );
  } else if (rng() < BUCKET.driblChance) {
    wash(
      ctx,
      box.left + BUCKET.driblInset,
      box.baseY - BUCKET.driblInset,
      width - BUCKET.driblInset * 2,
      BUCKET.driblH,
      DIRTY_WATER,
      BUCKET.driblAlpha,
    );
  }
}

/**
 * The yellow mop bucket, the mop standing in it and the sign beside it. When
 * `damaged` the tub is split and slopping, and the sign lies where its skid
 * left it.
 */
export function drawMopBucket(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  drawBucket(ctx, ox, oy, ts, variant, damaged);
  if (damaged) {
    drawSignSkidFrame(ctx, ox, oy, ts, SIGN_SKID_FRAMES - 1);
  } else {
    drawStandingSign(ctx, signFootX(ox, ts), oy + ts * ONE_TILE_BASE_FRACTION, ts, 0);
  }
}

const MOP_REMAINS = {
  centreXFraction: 0.4,
  centreYFraction: 0.68,
  puddleOffsetX: 3,
  puddleOffsetY: 2,
  puddleRxFraction: 0.3,
  puddleRyFraction: 0.13,
  puddleAlpha: 0.5,
  sheenRxFraction: 0.2,
  sheenRyFraction: 0.06,
  sheenAlpha: 0.25,
  tubW: 22,
  tubH: 11,
  tubLitBand: 3,
  tubMouthW: 3,
  tubMouthInset: 3,
  tubLean: -0.4,
  tubLeanJitter: 0.2,
  handleX0: 0.12,
  handleY0: 0.42,
  handleX1: 0.5,
  handleY1: 0.5,
  handleWidth: 2.2,
} as const;
const WATER_SHEEN = '#d8dccf';

/** The bucket after a break: on its side in its own puddle, the sign lying flat. */
export function drawMopBucketRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(BUCKET_SEED + REMAINS_SEED_OFFSET + variant);
  const cx = ox + ts * MOP_REMAINS.centreXFraction;
  const cy = oy + ts * MOP_REMAINS.centreYFraction;
  blot(
    ctx,
    cx + MOP_REMAINS.puddleOffsetX,
    cy + MOP_REMAINS.puddleOffsetY,
    ts * MOP_REMAINS.puddleRxFraction,
    ts * MOP_REMAINS.puddleRyFraction,
    DIRTY_WATER,
    MOP_REMAINS.puddleAlpha,
  );
  blot(
    ctx,
    cx,
    cy,
    ts * MOP_REMAINS.sheenRxFraction,
    ts * MOP_REMAINS.sheenRyFraction,
    WATER_SHEEN,
    MOP_REMAINS.sheenAlpha,
  );
  withRotation(ctx, cx, cy, MOP_REMAINS.tubLean + rng() * MOP_REMAINS.tubLeanJitter, () => {
    const left = cx - MOP_REMAINS.tubW / 2;
    const top = cy - MOP_REMAINS.tubH / 2;
    wash(ctx, left, top, MOP_REMAINS.tubW, MOP_REMAINS.tubH, SAFETY_YELLOW.frontHigh, 1);
    wash(ctx, left, top, MOP_REMAINS.tubW, MOP_REMAINS.tubLitBand, SAFETY_YELLOW.edge, 1);
    wash(
      ctx,
      left + MOP_REMAINS.tubW - MOP_REMAINS.tubMouthInset,
      top + 1,
      MOP_REMAINS.tubMouthW,
      MOP_REMAINS.tubH - 2,
      CAVITY,
      1,
    );
  });
  line(
    ctx,
    ox + ts * MOP_REMAINS.handleX0,
    oy + ts * MOP_REMAINS.handleY0,
    ox + ts * MOP_REMAINS.handleX1,
    oy + ts * MOP_REMAINS.handleY1,
    MOP_HANDLE,
    MOP_REMAINS.handleWidth,
  );
  drawLyingSign(ctx, ox + ts * SIGN_DOWN_X_FRACTION, oy + ts * SIGN_DOWN_Y_FRACTION);
}

// ── Pallet stack ────────────────────────────────────────────────────────────

const PALLET_SEED = 0xa11e;
const PALLET_VARIANT_STRIDE = 157;
const PALLET_WIDTH_FRACTION = 0.88;
const PALLET_DEPTH_FRACTION = 0.36;
const PALLET_CONTACT_SHADOW_SCALE = 1.1;
const PALLET = {
  layerH: 9,
  layers: 3,
  blocks: 3,
  blockW: 7,
  topBoards: 5,
  boardGapWidth: 1.4,
  deckBoardH: 3,
  bottomBoardH: 2,
  edgeLineWidth: 0.8,
  snapFraction: 0.55,
  snapW: 6,
  splinterReach: 5,
  splinterWidth: 1.5,
  stainChance: 0.5,
  stainW: 8,
  stainSpreadFraction: 0.6,
  stainAlpha: 0.2,
} as const;
/** What waits on top of the stack: nothing, a wrapped carton, or a sheet of card. */
const PALLET_LOAD = {
  cartonLeftFraction: 0.2,
  cartonWidthFraction: 0.5,
  cartonFrontH: 12,
  cartonTopH: 8,
  tapeW: 3,
  wrapPad: 1,
  cardInset: 6,
  cardJitter: 6,
  cardWidthFraction: 0.4,
  cardDepthFraction: 0.6,
  cardAlpha: 0.9,
  tapeAlpha: 0.8,
} as const;
const SHRINK_WRAP = 'rgba(210,214,212,0.35)';
const CARDBOARD = { top: '#a88a5c', front: '#8a6d44', tape: '#c9b48a' } as const;
const PALLET_STAIN = '#3a3020';
/** Which variant carries which load, by `variant % 3`. */
const LOAD_CARTON = 1;
const LOAD_CARD = 2;
const VARIANT_CYCLE = 3;

/** Wooden shipping pallets stacked three high; the top one snapped when `damaged`. */
export function drawPalletStack(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const rng = mulberry32(PALLET_SEED + variant * PALLET_VARIANT_STRIDE);
  const width = ts * PALLET_WIDTH_FRACTION;
  const left = ox + (ts - width) / 2;
  const right = left + width;
  const baseY = oy + ts * ONE_TILE_BASE_FRACTION;
  contactShadow(ctx, ox + ts / 2, baseY, ts, PALLET_CONTACT_SHADOW_SCALE);
  const box: BoxGeometry = {
    left,
    right,
    baseY,
    height: PALLET.layerH * PALLET.layers,
    depth: ts * PALLET_DEPTH_FRACTION,
  };
  paintBox(ctx, box, PALLET_WOOD);
  const backTop = boxBackTop(box);
  const frontTop = boxFrontTop(box);
  for (let b = 1; b < PALLET.topBoards; b++) {
    const x = lerp(left, right, b / PALLET.topBoards);
    line(ctx, x, backTop + 1, x, frontTop - 1, PALLET_WOOD.outline, PALLET.boardGapWidth);
  }
  const blockRowH = PALLET.layerH - PALLET.deckBoardH - PALLET.bottomBoardH;
  for (let layer = 0; layer < PALLET.layers; layer++) {
    const layerTop = frontTop + layer * PALLET.layerH;
    const blockTop = layerTop + PALLET.deckBoardH;
    // Each pallet's front: a deck board, the block row with dark gaps between, a bottom board.
    wash(ctx, left, blockTop, width, blockRowH, CAVITY, 1);
    for (let k = 0; k < PALLET.blocks; k++) {
      const bx = lerp(left, right - PALLET.blockW, k / (PALLET.blocks - 1));
      wash(ctx, bx, blockTop, PALLET.blockW, blockRowH, PALLET_WOOD.frontHigh, 1);
      line(ctx, bx, blockTop, bx, blockTop + blockRowH, PALLET_WOOD.edge, PALLET.edgeLineWidth);
    }
    line(ctx, left, layerTop + 1, right, layerTop + 1, PALLET_WOOD.edge, 1);
    line(
      ctx,
      left,
      layerTop + PALLET.layerH,
      right,
      layerTop + PALLET.layerH,
      PALLET_WOOD.outline,
      1,
    );
  }
  if (damaged) {
    const snapX = lerp(left, right, PALLET.snapFraction);
    wash(ctx, snapX - PALLET.snapW / 2, backTop, PALLET.snapW, box.depth, CAVITY, 1);
    line(
      ctx,
      snapX - PALLET.snapW / 2,
      frontTop,
      snapX + PALLET.snapW / 2 - 1,
      frontTop + PALLET.splinterReach,
      PALLET_WOOD.edge,
      PALLET.splinterWidth,
    );
  }
  const load = variant % VARIANT_CYCLE;
  if (load === LOAD_CARTON) {
    const cl = left + width * PALLET_LOAD.cartonLeftFraction;
    const cw = width * PALLET_LOAD.cartonWidthFraction;
    const cartonTop = frontTop - PALLET_LOAD.cartonFrontH;
    const lidTop = cartonTop - PALLET_LOAD.cartonTopH;
    const cartonH = PALLET_LOAD.cartonFrontH + PALLET_LOAD.cartonTopH;
    wash(ctx, cl, lidTop, cw, PALLET_LOAD.cartonTopH, CARDBOARD.top, 1);
    wash(ctx, cl, cartonTop, cw, PALLET_LOAD.cartonFrontH, CARDBOARD.front, 1);
    wash(
      ctx,
      cl + cw / 2 - PALLET_LOAD.tapeW / 2,
      lidTop,
      PALLET_LOAD.tapeW,
      cartonH,
      CARDBOARD.tape,
      PALLET_LOAD.tapeAlpha,
    );
    ctx.save();
    ctx.fillStyle = SHRINK_WRAP;
    ctx.fillRect(
      cl - PALLET_LOAD.wrapPad,
      lidTop - PALLET_LOAD.wrapPad,
      cw + PALLET_LOAD.wrapPad * 2,
      cartonH + PALLET_LOAD.wrapPad * 2,
    );
    ctx.restore();
  } else if (load === LOAD_CARD) {
    wash(
      ctx,
      left + PALLET_LOAD.cardInset + rng() * PALLET_LOAD.cardJitter,
      backTop + PALLET.deckBoardH,
      width * PALLET_LOAD.cardWidthFraction,
      box.depth * PALLET_LOAD.cardDepthFraction,
      CARDBOARD.top,
      PALLET_LOAD.cardAlpha,
    );
  }
  if (rng() < PALLET.stainChance) {
    wash(
      ctx,
      left + rng() * width * PALLET.stainSpreadFraction,
      frontTop + PALLET.deckBoardH,
      PALLET.stainW,
      PALLET.layerH * 2,
      PALLET_STAIN,
      PALLET.stainAlpha,
    );
  }
}

const PALLET_REMAINS = {
  bedLeftFraction: 0.14,
  bedTopFraction: 0.52,
  bedWidthFraction: 0.72,
  bedHeightFraction: 0.26,
  bedAlpha: 0.18,
  boards: 6,
  boardSpreadXFraction: 0.56,
  boardLeftFraction: 0.22,
  boardSpreadYFraction: 0.24,
  boardW: 24,
  boardH: 5,
  boardMaxTwist: 1.2,
  blocks: 2,
  blockFirstFraction: 0.3,
  blockStepFraction: 0.3,
  blockYFraction: 0.64,
  blockW: 6,
  blockH: 5,
  edgeLineWidth: 0.8,
} as const;

/** Pallets after a break: loose boards and split blocks. */
export function drawPalletRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(PALLET_SEED + REMAINS_SEED_OFFSET + variant);
  const r = PALLET_REMAINS;
  wash(
    ctx,
    ox + ts * r.bedLeftFraction,
    oy + ts * r.bedTopFraction,
    ts * r.bedWidthFraction,
    ts * r.bedHeightFraction,
    '#000',
    r.bedAlpha,
  );
  for (let i = 0; i < r.boards; i++) {
    const cx = ox + ts * (r.boardLeftFraction + rng() * r.boardSpreadXFraction);
    const cy = oy + ts * (r.bedTopFraction + rng() * r.boardSpreadYFraction);
    const shade = i % 2 === 0 ? PALLET_WOOD.top : PALLET_WOOD.frontHigh;
    withRotation(ctx, cx, cy, (rng() - 0.5) * r.boardMaxTwist, () => {
      wash(ctx, cx - r.boardW / 2, cy - r.boardH / 2, r.boardW, r.boardH, shade, 1);
      line(
        ctx,
        cx - r.boardW / 2,
        cy - r.boardH / 2,
        cx + r.boardW / 2,
        cy - r.boardH / 2,
        PALLET_WOOD.edge,
        r.edgeLineWidth,
      );
    });
  }
  for (let i = 0; i < r.blocks; i++) {
    const bx = ox + ts * (r.blockFirstFraction + i * r.blockStepFraction);
    wash(ctx, bx, oy + ts * r.blockYFraction, r.blockW, r.blockH, PALLET_WOOD.frontLow, 1);
  }
}

// ── Desk with dead monitor ─────────────────────────────────────────────────

const DESK_SEED = 0xde5c;
const DESK_VARIANT_STRIDE = 733;
const DESK_HEIGHT_FRACTION = 0.5;
const DESK_DEPTH_FRACTION = 0.42;
const DESK_PEDESTAL_FRACTION = 0.32;
const DESK_CONTACT_SHADOW_SCALE = 0.95;
const DESK = {
  inset: 4,
  topSlab: 3,
  sidePanel: 6,
  drawers: 3,
  modestyRecess: 6,
  modestyLift: 10,
  drawerInset: 2,
  pullW: 10,
  pullH: 2,
  pullDropFraction: 0.45,
  modestyAlpha: 0.75,
  dentXFraction: 0.45,
  dentDrop: 6,
  dentRx: 6,
  dentRy: 3,
} as const;
/** What sits on the desk is the variant: papers, a mug, a sticky note on the screen. */
const DESK_CLUTTER = {
  papersXFraction: 0.62,
  papersYFraction: 0.55,
  papersSpread: 6,
  papersMin: 3,
  mugXFraction: 0.82,
  mugYFraction: 0.7,
  mugW: 6,
  mugH: 7,
  coffeeH: 1.5,
  mugHandleReach: 2,
  mugHandleDrop: 2,
  mugHandleWidth: 1.2,
  noteSize: 6,
  noteInset: 9,
  noteAlpha: 0.9,
  noMugVariant: 1,
  noteVariant: 1,
} as const;
const MUG = '#d8d3c6';
const COFFEE = '#3a2a1a';
const STICKY_NOTE = '#c9b45a';

const MONITOR = {
  leftFraction: 0.14,
  width: 36,
  height: 30,
  depth: 10,
  bezel: 4,
  chinH: 4,
  baseYFraction: 0.55,
  standShadowInset: 3,
  standShadowH: 3,
  standShadowAlpha: 0.3,
  ledFromRight: 7,
  ledFromBottom: 4,
  ledW: 2,
  ledH: 1.5,
  glintW: 7,
  glintDrop: 10,
  glintTop: 3,
  glintSlant: 4,
} as const;
const KEYBOARD = { w: 28, h: 4, yFraction: 0.82, keysAlpha: 0.8, keysH: 1.2 } as const;
const DEAD_SCREEN = '#141a19';
const SCREEN_GLINT = 'rgba(190,210,205,0.16)';
const DEAD_LED = '#3a2a22';
/**
 * A popped tube: the screen blown in to a jagged hole with the glass's broken
 * edge catching the light round it and a scorch on the bezel above.
 */
const POPPED_SCREEN = {
  points: 10,
  outerFraction: 0.48,
  innerFraction: 0.26,
  aspect: 1.25,
  shardCount: 7,
  shardInner: 0.55,
  shardOuter: 1.05,
  shardWidth: 1.4,
  scorchAlpha: 0.55,
  scorchH: 5,
} as const;
const BROKEN_GLASS = '#d9e6e2';
const SCORCH = '#120d08';

/** The office desk across its two tiles, monitor on top; the screen blown out when `damaged`. */
export function drawServiceDesk(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const rng = mulberry32(DESK_SEED + variant * DESK_VARIANT_STRIDE);
  const left = ox + DESK.inset;
  const right = ox + ts * 2 - DESK.inset;
  const baseY = oy + ts * ONE_TILE_BASE_FRACTION;
  const box: BoxGeometry = {
    left,
    right,
    baseY,
    height: ts * DESK_HEIGHT_FRACTION,
    depth: ts * DESK_DEPTH_FRACTION,
  };
  contactShadow(ctx, (left + right) / 2, baseY, ts * 2, DESK_CONTACT_SHADOW_SCALE);
  const frontTop = boxFrontTop(box);
  const backTop = boxBackTop(box);

  // The body under the slab: a side panel, a recessed modesty panel and the
  // drawer pedestal, each its own steel box.
  const pedestalLeft = right - (right - left) * DESK_PEDESTAL_FRACTION;
  wash(ctx, left, frontTop, pedestalLeft - left, box.height, CAVITY, DESK.modestyAlpha);
  paintBox(
    ctx,
    {
      left: left + DESK.sidePanel,
      right: pedestalLeft,
      baseY: baseY - DESK.modestyRecess,
      height: box.height - DESK.topSlab - DESK.modestyLift,
      depth: 0,
    },
    DESK_STEEL,
  );
  paintBox(
    ctx,
    { left, right: left + DESK.sidePanel, baseY, height: box.height, depth: 0 },
    DESK_STEEL,
  );
  paintBox(ctx, { left: pedestalLeft, right, baseY, height: box.height, depth: 0 }, DESK_STEEL);
  const drawerH = (box.height - DESK.topSlab) / DESK.drawers;
  const pedestalCx = (pedestalLeft + right) / 2;
  for (let i = 0; i < DESK.drawers; i++) {
    const top = frontTop + DESK.topSlab + i * drawerH;
    line(
      ctx,
      pedestalLeft + DESK.drawerInset,
      top + drawerH,
      right - DESK.drawerInset,
      top + drawerH,
      DESK_STEEL.outline,
      1,
    );
    wash(
      ctx,
      pedestalCx - DESK.pullW / 2,
      top + drawerH * DESK.pullDropFraction,
      DESK.pullW,
      DESK.pullH,
      BARE_STEEL.light,
      1,
    );
  }
  paintBox(
    ctx,
    {
      left: left - 1,
      right: right + 1,
      baseY: frontTop + DESK.topSlab,
      height: DESK.topSlab,
      depth: box.depth,
    },
    DESK_LAMINATE,
  );

  const clutterVariant = variant % VARIANT_CYCLE;
  drawPaperSheets(
    ctx,
    lerp(left, right, DESK_CLUTTER.papersXFraction),
    lerp(backTop, frontTop, DESK_CLUTTER.papersYFraction),
    DESK_CLUTTER.papersSpread,
    DESK_CLUTTER.papersMin + (variant % 2),
    rng,
  );
  if (clutterVariant !== DESK_CLUTTER.noMugVariant) {
    const mugX = lerp(left, right, DESK_CLUTTER.mugXFraction);
    const mugY = lerp(backTop, frontTop, DESK_CLUTTER.mugYFraction);
    const mugTop = mugY - DESK_CLUTTER.mugH;
    wash(ctx, mugX - DESK_CLUTTER.mugW / 2, mugTop, DESK_CLUTTER.mugW, DESK_CLUTTER.mugH, MUG, 1);
    wash(
      ctx,
      mugX - DESK_CLUTTER.mugW / 2,
      mugTop,
      DESK_CLUTTER.mugW,
      DESK_CLUTTER.coffeeH,
      COFFEE,
      1,
    );
    line(
      ctx,
      mugX + DESK_CLUTTER.mugW / 2,
      mugTop + DESK_CLUTTER.mugHandleDrop,
      mugX + DESK_CLUTTER.mugW / 2 + DESK_CLUTTER.mugHandleReach,
      mugTop + DESK_CLUTTER.mugHandleDrop * 2,
      MUG,
      DESK_CLUTTER.mugHandleWidth,
    );
  }

  const monitorLeft = left + (right - left) * MONITOR.leftFraction;
  const monitorBase = lerp(backTop, frontTop, MONITOR.baseYFraction);
  const monitor: BoxGeometry = {
    left: monitorLeft,
    right: monitorLeft + MONITOR.width,
    baseY: monitorBase,
    height: MONITOR.height,
    depth: MONITOR.depth,
  };
  wash(
    ctx,
    monitorLeft + MONITOR.standShadowInset,
    monitorBase - 1,
    MONITOR.width - MONITOR.standShadowInset * 2,
    MONITOR.standShadowH,
    '#000',
    MONITOR.standShadowAlpha,
  );
  paintBox(ctx, monitor, MONITOR_PLASTIC);
  const monitorTop = boxFrontTop(monitor);
  const screenLeft = monitorLeft + MONITOR.bezel;
  const screenTop = monitorTop + MONITOR.bezel;
  const screenW = MONITOR.width - MONITOR.bezel * 2;
  const screenH = MONITOR.height - MONITOR.bezel * 2 - MONITOR.chinH;
  wash(ctx, screenLeft, screenTop, screenW, screenH, DEAD_SCREEN, 1);
  if (damaged) {
    drawPoppedScreen(ctx, screenLeft, screenTop, screenW, screenH, rng);
    dent(
      ctx,
      lerp(left, right, DESK.dentXFraction),
      frontTop + DESK.topSlab + DESK.dentDrop,
      DESK.dentRx,
      DESK.dentRy,
    );
  } else {
    ctx.save();
    ctx.fillStyle = SCREEN_GLINT;
    ctx.beginPath();
    ctx.moveTo(screenLeft + MONITOR.glintTop, screenTop);
    ctx.lineTo(screenLeft + MONITOR.glintTop + MONITOR.glintW, screenTop);
    ctx.lineTo(screenLeft, screenTop + MONITOR.glintDrop);
    ctx.lineTo(screenLeft, screenTop + MONITOR.glintSlant);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  wash(
    ctx,
    monitorLeft + MONITOR.width - MONITOR.ledFromRight,
    monitorTop + MONITOR.height - MONITOR.ledFromBottom,
    MONITOR.ledW,
    MONITOR.ledH,
    DEAD_LED,
    1,
  );
  if (clutterVariant === DESK_CLUTTER.noteVariant) {
    wash(
      ctx,
      monitorLeft + MONITOR.width - DESK_CLUTTER.noteInset,
      monitorTop + 1,
      DESK_CLUTTER.noteSize,
      DESK_CLUTTER.noteSize,
      STICKY_NOTE,
      DESK_CLUTTER.noteAlpha,
    );
  }
  const keyboardX = monitorLeft + (MONITOR.width - KEYBOARD.w) / 2;
  const keyboardY = lerp(backTop, frontTop, KEYBOARD.yFraction);
  wash(ctx, keyboardX, keyboardY, KEYBOARD.w, KEYBOARD.h, MONITOR_PLASTIC.frontLow, 1);
  wash(
    ctx,
    keyboardX + 1,
    keyboardY + 1,
    KEYBOARD.w - 2,
    KEYBOARD.keysH,
    MONITOR_PLASTIC.edge,
    KEYBOARD.keysAlpha,
  );
}

/** The screen of a monitor whose tube has popped. */
function drawPoppedScreen(
  ctx: Ctx,
  left: number,
  top: number,
  w: number,
  h: number,
  rng: () => number,
): void {
  const p = POPPED_SCREEN;
  const cx = left + w / 2;
  const cy = top + h / 2;
  const size = Math.min(w, h);
  ctx.save();
  ctx.fillStyle = CAVITY;
  ctx.strokeStyle = BROKEN_GLASS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < p.points; i++) {
    const a = (i / p.points) * FULL_TURN;
    const r = (i % 2 === 0 ? p.outerFraction : p.innerFraction) * size;
    const x = cx + Math.cos(a) * r * p.aspect;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < p.shardCount; i++) {
    const a = rng() * FULL_TURN;
    const reach = (size / 2) * p.aspect;
    line(
      ctx,
      cx + Math.cos(a) * reach * p.shardInner,
      cy + Math.sin(a) * (size / 2) * p.shardInner,
      cx + Math.cos(a) * reach * p.shardOuter,
      cy + Math.sin(a) * (size / 2) * p.shardOuter,
      BROKEN_GLASS,
      p.shardWidth,
    );
  }
  wash(ctx, left, top - p.scorchH, w, p.scorchH, SCORCH, p.scorchAlpha);
}

const DESK_REMAINS = {
  bedLeftFraction: 0.15,
  bedTopFraction: 0.5,
  bedWidthFraction: 1.7,
  bedHeightFraction: 0.3,
  bedAlpha: 0.2,
  slabFirstFraction: 0.55,
  slabStepFraction: 0.85,
  slabYFraction: 0.6,
  slabYJitter: 0.1,
  slabW: 44,
  slabH: 14,
  slabEdgeH: 2,
  slabMaxTwist: 0.5,
  shellXFraction: 0.95,
  shellYFraction: 0.68,
  shellTwist: 0.5,
  shellW: 24,
  shellH: 18,
  holeW: 16,
  holeH: 10,
  glassBits: 6,
  glassSpreadX: 30,
  glassSpreadY: 12,
  glassW: 2.5,
  glassH: 1.5,
  glassAlpha: 0.8,
  papersXFraction: 1.5,
  papersYFraction: 0.7,
  papersSpread: 10,
  papersCount: 3,
} as const;

/** The desk after a break: the slab in two, the monitor's shell and its glass. */
export function drawServiceDeskRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(DESK_SEED + REMAINS_SEED_OFFSET + variant);
  const r = DESK_REMAINS;
  wash(
    ctx,
    ox + ts * r.bedLeftFraction,
    oy + ts * r.bedTopFraction,
    ts * r.bedWidthFraction,
    ts * r.bedHeightFraction,
    '#000',
    r.bedAlpha,
  );
  for (let i = 0; i < 2; i++) {
    const cx = ox + ts * (r.slabFirstFraction + i * r.slabStepFraction);
    const cy = oy + ts * (r.slabYFraction + (rng() - 0.5) * r.slabYJitter);
    withRotation(ctx, cx, cy, (rng() - 0.5) * r.slabMaxTwist, () => {
      wash(ctx, cx - r.slabW / 2, cy - r.slabH / 2, r.slabW, r.slabH, DESK_LAMINATE.top, 1);
      wash(
        ctx,
        cx - r.slabW / 2,
        cy + r.slabH / 2 - r.slabEdgeH,
        r.slabW,
        r.slabEdgeH,
        DESK_LAMINATE.frontLow,
        1,
      );
    });
  }
  const shellX = ox + ts * r.shellXFraction;
  const shellY = oy + ts * r.shellYFraction;
  withRotation(ctx, shellX, shellY, r.shellTwist, () => {
    wash(
      ctx,
      shellX - r.shellW / 2,
      shellY - r.shellH / 2,
      r.shellW,
      r.shellH,
      MONITOR_PLASTIC.frontHigh,
      1,
    );
    wash(ctx, shellX - r.holeW / 2, shellY - r.holeH / 2, r.holeW, r.holeH, CAVITY, 1);
  });
  for (let i = 0; i < r.glassBits; i++) {
    wash(
      ctx,
      shellX + (rng() - 0.5) * r.glassSpreadX,
      shellY + (rng() - 0.5) * r.glassSpreadY,
      r.glassW,
      r.glassH,
      BROKEN_GLASS,
      r.glassAlpha,
    );
  }
  drawPaperSheets(
    ctx,
    ox + ts * r.papersXFraction,
    oy + ts * r.papersYFraction,
    r.papersSpread,
    r.papersCount,
    rng,
  );
}

// ── Locker-room bench ──────────────────────────────────────────────────────

const BENCH_SEED = 0xbe7c;
const BENCH_VARIANT_STRIDE = 251;
const BENCH_SEAT_HEIGHT_FRACTION = 0.3;
const BENCH_DEPTH_FRACTION = 0.3;
const BENCH_CONTACT_SHADOW_SCALE = 0.8;
const BENCH = {
  inset: 6,
  slats: 3,
  slatGap: 1.5,
  slatFront: 3,
  legW: 3,
  legInset: 9,
  footH: 1.5,
  underInset: 4,
  underAlpha: 0.2,
  slatEdgeWidth: 0.8,
  crackFraction: 0.42,
  crackW: 4,
  crackSag: 1.5,
  crackReach: 6,
  crackWidth: 1.4,
} as const;
/** A towel left folded over one end, or a gym bag on the seat, by variant. */
const BENCH_LOAD = {
  towelVariant: 1,
  bagVariant: 2,
  towelFirstFraction: 0.12,
  towelJitterFraction: 0.1,
  towelW: 16,
  towelOverhang: 7,
  stripeH: 1.5,
  stripeDrop: 2,
  bagXFraction: 0.7,
  bagW: 10,
  bagH: 5,
} as const;
const TOWEL = { body: '#b8bdbf', stripe: '#4f6f8a' } as const;
const GYM_BAG = '#3a3d40';

/** The slatted bench across its two tiles; its middle slat cracked and sagging when `damaged`. */
export function drawLockerBench(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const rng = mulberry32(BENCH_SEED + variant * BENCH_VARIANT_STRIDE);
  const left = ox + BENCH.inset;
  const right = ox + ts * 2 - BENCH.inset;
  const baseY = oy + ts * ONE_TILE_BASE_FRACTION;
  const seatFront = baseY - ts * BENCH_SEAT_HEIGHT_FRACTION;
  const seatBack = seatFront - ts * BENCH_DEPTH_FRACTION;
  contactShadow(ctx, (left + right) / 2, baseY, ts * 2, BENCH_CONTACT_SHADOW_SCALE);
  wash(
    ctx,
    left + BENCH.underInset,
    seatFront,
    right - left - BENCH.underInset * 2,
    baseY - seatFront - 2,
    '#000',
    BENCH.underAlpha,
  );

  for (const x of [left + BENCH.legInset, (left + right) / 2, right - BENCH.legInset]) {
    wash(ctx, x - BENCH.legW / 2, seatFront, BENCH.legW, baseY - seatFront, BARE_STEEL.mid, 1);
    wash(ctx, x - BENCH.legW / 2, seatFront, 1, baseY - seatFront, BARE_STEEL.light, 1);
    wash(ctx, x - BENCH.legW, baseY - BENCH.footH, BENCH.legW * 2, BENCH.footH, BARE_STEEL.dark, 1);
  }
  const slatDepth = (seatFront - seatBack) / BENCH.slats;
  for (let s = 0; s < BENCH.slats; s++) {
    const top = seatBack + s * slatDepth;
    wash(ctx, left, top, right - left, slatDepth - BENCH.slatGap, BENCH_WOOD.top, 1);
    line(ctx, left, top + 1, right, top + 1, BENCH_WOOD.edge, BENCH.slatEdgeWidth);
  }
  wash(ctx, left, seatFront, right - left, BENCH.slatFront, BENCH_WOOD.frontHigh, 1);
  line(
    ctx,
    left,
    seatFront + BENCH.slatFront,
    right,
    seatFront + BENCH.slatFront,
    BENCH_WOOD.outline,
    1,
  );
  ctx.save();
  ctx.strokeStyle = BENCH_WOOD.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(left, seatBack, right - left, seatFront + BENCH.slatFront - seatBack);
  ctx.restore();
  if (damaged) {
    const crackX = lerp(left, right, BENCH.crackFraction);
    wash(ctx, crackX - BENCH.crackW / 2, seatBack + slatDepth, BENCH.crackW, slatDepth, CAVITY, 1);
    line(
      ctx,
      crackX - BENCH.crackReach,
      seatBack + slatDepth * 2 - 1,
      crackX + BENCH.crackReach,
      seatBack + slatDepth * 2 + BENCH.crackSag,
      BENCH_WOOD.outline,
      BENCH.crackWidth,
    );
  }
  const load = variant % VARIANT_CYCLE;
  if (load === BENCH_LOAD.towelVariant) {
    const tx = lerp(
      left,
      right,
      BENCH_LOAD.towelFirstFraction + rng() * BENCH_LOAD.towelJitterFraction,
    );
    wash(
      ctx,
      tx,
      seatBack - 1,
      BENCH_LOAD.towelW,
      seatFront - seatBack + BENCH_LOAD.towelOverhang,
      TOWEL.body,
      1,
    );
    wash(
      ctx,
      tx,
      seatFront + BENCH.slatFront,
      BENCH_LOAD.towelW,
      BENCH_LOAD.stripeH,
      TOWEL.stripe,
      1,
    );
    wash(
      ctx,
      tx,
      seatBack + BENCH_LOAD.stripeDrop,
      BENCH_LOAD.towelW,
      BENCH_LOAD.stripeH,
      TOWEL.stripe,
      1,
    );
  } else if (load === BENCH_LOAD.bagVariant) {
    wash(
      ctx,
      lerp(left, right, BENCH_LOAD.bagXFraction),
      seatBack + 2,
      BENCH_LOAD.bagW,
      BENCH_LOAD.bagH,
      GYM_BAG,
      1,
    );
  }
}

const BENCH_REMAINS = {
  bedLeftFraction: 0.15,
  bedTopFraction: 0.55,
  bedWidthFraction: 1.7,
  bedHeightFraction: 0.22,
  bedAlpha: 0.18,
  slats: 5,
  slatFirstFraction: 0.35,
  slatStepFraction: 0.32,
  slatJitterX: 0.1,
  slatYFraction: 0.62,
  slatJitterY: 0.14,
  slatW: 22,
  slatH: 5,
  slatMaxTwist: 0.7,
  slatEdgeWidth: 0.8,
  legX0: 0.9,
  legY0: 0.5,
  legX1: 1.05,
  legY1: 0.74,
  legWidth: 3,
} as const;

/** The bench after a break: snapped slats and a bent leg. */
export function drawLockerBenchRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(BENCH_SEED + REMAINS_SEED_OFFSET + variant);
  const r = BENCH_REMAINS;
  wash(
    ctx,
    ox + ts * r.bedLeftFraction,
    oy + ts * r.bedTopFraction,
    ts * r.bedWidthFraction,
    ts * r.bedHeightFraction,
    '#000',
    r.bedAlpha,
  );
  for (let i = 0; i < r.slats; i++) {
    const cx =
      ox + ts * (r.slatFirstFraction + i * r.slatStepFraction + (rng() - 0.5) * r.slatJitterX);
    const cy = oy + ts * (r.slatYFraction + (rng() - 0.5) * r.slatJitterY);
    withRotation(ctx, cx, cy, (rng() - 0.5) * r.slatMaxTwist, () => {
      wash(ctx, cx - r.slatW / 2, cy - r.slatH / 2, r.slatW, r.slatH, BENCH_WOOD.top, 1);
      line(
        ctx,
        cx - r.slatW / 2,
        cy - r.slatH / 2,
        cx + r.slatW / 2,
        cy - r.slatH / 2,
        BENCH_WOOD.edge,
        r.slatEdgeWidth,
      );
    });
  }
  line(
    ctx,
    ox + ts * r.legX0,
    oy + ts * r.legY0,
    ox + ts * r.legX1,
    oy + ts * r.legY1,
    BARE_STEEL.mid,
    r.legWidth,
  );
}
