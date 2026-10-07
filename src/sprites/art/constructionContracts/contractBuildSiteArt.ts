/**
 * A stripped build site: where a prop a contract rebuilds will stand once it
 * is rebuilt. The prop itself is hidden and its footprint stays blocked, so
 * this has to explain the blocked ground on its own — a builder's chalk line
 * round the footprint, a short stack of the material the job will use, and a
 * couple of loose nails.
 */

import { rgba } from '../town/townArt';
import { mix, sampleRamp, type Ramp, type RGB } from '../town/townPalette';
import { mulberry32, range, subSeed, type Rng } from '../../person/rng';
import type { ContractArtMaterial, DamageBox } from './contractDamageArt';
import type { ContractPalette } from './contractPalette';
import {
  contactShadow,
  drawBoard,
  drawChunk,
  drawNail,
  drawRope,
  jaggedLine,
  screenPx,
  type Point,
} from './contractStrokes';

type Ctx = CanvasRenderingContext2D;

const CHALK = {
  insetTiles: 0.14,
  /** The builder's corner marks run a little past the line, toward the footprint's edge. */
  tickOvershootTiles: 0.08,
  lineWidthPx: 1.5,
  alpha: 0.7,
  wobbleTiles: 0.015,
  kinksPerTile: 3,
  /** Chalk rubs the floor it is drawn on: a faint wide halo under the line. */
  haloAlpha: 0.12,
  haloWidthScale: 3,
} as const;

const STACK = {
  boards: 4,
  boardLengthTiles: 0.82,
  boardThicknessTiles: 0.15,
  boardLiftTiles: 0.12,
  /** Offcuts are new timber: their colour sits this far toward a fresh cut. */
  freshShare: 0.4,
  boardTurn: 0.08,
  shadowAlpha: 0.38,
  blockRadiusTiles: 0.16,
  coilRadiusTiles: 0.2,
  coilTurns: 3,
  coilSegments: 18,
  ropeWidthTiles: 0.065,
  lathStrips: 4,
  lathLengthTiles: 0.85,
  lathThicknessTiles: 0.065,
  anchorNudgeTiles: 0.1,
  boardShadowDropTiles: 0.06,
  boardShadowLengthShare: 0.6,
  boardShadowHeightTiles: 0.1,
  boardJitterTiles: 0.05,
  boardShortestShare: 0.8,
  /** Two blocks side by side, a third set on their joint. */
  blockSpreadRadii: 0.95,
  blockLiftRadii: 0.9,
  coilShadowDropRadii: 0.3,
  coilShadowWidthRadii: 1.3,
  coilShadowHeightRadii: 0.5,
  /** Each turn of the coil lies a little smaller and higher than the one under it. */
  coilShrink: 0.45,
  coilSquash: 0.55,
  coilRiseRadii: 0.35,
  lathShadowDropTiles: 0.04,
  lathShadowLengthShare: 0.55,
  lathShadowHeightTiles: 0.07,
  lathJitterTiles: 0.04,
  lathStackShare: 0.9,
  lathTurnShare: 0.5,
  /** The rope coil rests on top of the offcuts beneath it. */
  coilRestBoardLifts: 2.2,
} as const;

const NAILS = {
  count: 3,
  shankTiles: 0.1,
  reachMinTiles: 0.42,
  reachMaxTiles: 0.7,
  scatterYTiles: 0.08,
  turn: 0.6,
  shankTone: 0.35,
} as const;

/** The stack sits in a front corner of the footprint, so it reads as set down, not as the prop. */
const STACK_CORNER_INSET_TILES = 0.42;
/** On a one-tile site the offcuts must leave the chalk line showing either side. */
const STACK_MAX_FOOTPRINT_SHARE = 0.55;

const SALT_CHALK = 1;
const SALT_STACK = 2;
const SALT_NAILS = 3;

function chalkLine(
  ctx: Ctx,
  rng: Rng,
  from: Point,
  to: Point,
  palette: ContractPalette,
  ts: number,
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const kinks = Math.max(2, Math.round((length / ts) * CHALK.kinksPerTile));
  const points = jaggedLine(rng, from, to, kinks, ts * CHALK.wobbleTiles);
  const unit = screenPx(ts);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) =>
    index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
  );
  ctx.strokeStyle = rgba(palette.chalk, CHALK.haloAlpha);
  ctx.lineWidth = unit * CHALK.lineWidthPx * CHALK.haloWidthScale;
  ctx.stroke();
  ctx.strokeStyle = rgba(palette.chalk, CHALK.alpha);
  ctx.lineWidth = unit * CHALK.lineWidthPx;
  ctx.stroke();
  ctx.restore();
}

function paintChalkOutline(ctx: Ctx, box: DamageBox, palette: ContractPalette, seed: number): void {
  const rng = mulberry32(subSeed(seed, SALT_CHALK));
  const ts = box.tilePx;
  const inset = ts * CHALK.insetTiles;
  const over = ts * CHALK.tickOvershootTiles;
  const left = box.left + inset;
  const top = box.top + inset;
  const right = box.left + box.width - inset;
  const bottom = box.top + box.height - inset;
  chalkLine(ctx, rng, { x: left - over, y: top }, { x: right + over, y: top }, palette, ts);
  chalkLine(ctx, rng, { x: right, y: top - over }, { x: right, y: bottom + over }, palette, ts);
  chalkLine(ctx, rng, { x: right + over, y: bottom }, { x: left - over, y: bottom }, palette, ts);
  chalkLine(ctx, rng, { x: left, y: bottom + over }, { x: left, y: top - over }, palette, ts);
}

function stackAnchor(box: DamageBox, rng: Rng): Point {
  const ts = box.tilePx;
  const inset = Math.min(ts * STACK_CORNER_INSET_TILES, box.width / 2);
  const onLeft = rng() < 1 / 2;
  return {
    x: onLeft
      ? box.left + inset + ts * STACK.anchorNudgeTiles
      : box.left + box.width - inset - ts * STACK.anchorNudgeTiles,
    y: box.top + box.height - Math.min(ts * STACK_CORNER_INSET_TILES, box.height / 2),
  };
}

function freshTimber(palette: ContractPalette): Ramp {
  const toward = (color: RGB): RGB => mix(color, palette.freshBreak, STACK.freshShare);
  return {
    shadow: toward(palette.wood.shadow),
    mid: toward(palette.wood.mid),
    light: toward(palette.wood.light),
    accent: palette.wood.accent,
  };
}

function paintBoardStack(
  ctx: Ctx,
  at: Point,
  rng: Rng,
  palette: ContractPalette,
  ts: number,
  boards: number,
  maxLength: number,
): void {
  const length = Math.min(ts * STACK.boardLengthTiles, maxLength);
  contactShadow(
    ctx,
    at.x,
    at.y + ts * STACK.boardShadowDropTiles,
    length * STACK.boardShadowLengthShare,
    ts * STACK.boardShadowHeightTiles,
    palette.ink,
    STACK.shadowAlpha,
  );
  for (let board = 0; board < boards; board++) {
    drawBoard(
      ctx,
      at.x + range(rng, -1, 1) * ts * STACK.boardJitterTiles,
      at.y - board * ts * STACK.boardLiftTiles,
      length * range(rng, STACK.boardShortestShare, 1),
      ts * STACK.boardThicknessTiles,
      range(rng, -STACK.boardTurn, STACK.boardTurn),
      rng,
      {
        ramp: freshTimber(palette),
        freshBreak: palette.freshBreak,
        ink: palette.ink,
        brokenEnd: 'none',
        sawnEnds: true,
        tilePx: ts,
      },
    );
  }
}

function paintBlockStack(
  ctx: Ctx,
  at: Point,
  rng: Rng,
  palette: ContractPalette,
  ts: number,
): void {
  const r = ts * STACK.blockRadiusTiles;
  drawChunk(ctx, at.x - r * STACK.blockSpreadRadii, at.y, r, rng, palette.stone, palette.ink, ts);
  drawChunk(ctx, at.x + r * STACK.blockSpreadRadii, at.y, r, rng, palette.stone, palette.ink, ts);
  drawChunk(ctx, at.x, at.y - r * STACK.blockLiftRadii, r, rng, palette.stone, palette.ink, ts);
}

function paintRopeCoil(ctx: Ctx, at: Point, palette: ContractPalette, ts: number): void {
  const radius = ts * STACK.coilRadiusTiles;
  contactShadow(
    ctx,
    at.x,
    at.y + radius * STACK.coilShadowDropRadii,
    radius * STACK.coilShadowWidthRadii,
    radius * STACK.coilShadowHeightRadii,
    palette.ink,
    STACK.shadowAlpha,
  );
  const points: Point[] = [];
  const total = STACK.coilTurns * STACK.coilSegments;
  for (let step = 0; step <= total; step++) {
    const angle = (step / STACK.coilSegments) * Math.PI * 2;
    const shrink = 1 - (step / total) * STACK.coilShrink;
    points.push({
      x: at.x + Math.cos(angle) * radius * shrink,
      y:
        at.y +
        Math.sin(angle) * radius * shrink * STACK.coilSquash -
        (step / total) * radius * STACK.coilRiseRadii,
    });
  }
  drawRope(ctx, points, ts * STACK.ropeWidthTiles, palette.rope, palette.ink);
}

function paintLathBundle(
  ctx: Ctx,
  at: Point,
  rng: Rng,
  palette: ContractPalette,
  ts: number,
): void {
  contactShadow(
    ctx,
    at.x,
    at.y + ts * STACK.lathShadowDropTiles,
    ts * STACK.lathLengthTiles * STACK.lathShadowLengthShare,
    ts * STACK.lathShadowHeightTiles,
    palette.ink,
    STACK.shadowAlpha,
  );
  for (let strip = 0; strip < STACK.lathStrips; strip++) {
    drawBoard(
      ctx,
      at.x + range(rng, -1, 1) * ts * STACK.lathJitterTiles,
      at.y - strip * ts * STACK.lathThicknessTiles * STACK.lathStackShare,
      ts * STACK.lathLengthTiles,
      ts * STACK.lathThicknessTiles,
      range(rng, -STACK.boardTurn, STACK.boardTurn) * STACK.lathTurnShare,
      rng,
      {
        ramp: freshTimber(palette),
        freshBreak: palette.freshBreak,
        ink: palette.ink,
        brokenEnd: 'none',
        sawnEnds: true,
        tilePx: ts,
      },
    );
  }
}

function paintStack(
  ctx: Ctx,
  box: DamageBox,
  material: ContractArtMaterial,
  palette: ContractPalette,
  seed: number,
): Point {
  const rng = mulberry32(subSeed(seed, SALT_STACK));
  const ts = box.tilePx;
  const at = stackAnchor(box, rng);
  switch (material) {
    case 'wood':
      paintBoardStack(
        ctx,
        at,
        rng,
        palette,
        ts,
        STACK.boards,
        box.width * STACK_MAX_FOOTPRINT_SHARE,
      );
      break;
    case 'stone':
      paintBlockStack(ctx, at, rng, palette, ts);
      break;
    case 'rope':
      paintBoardStack(
        ctx,
        at,
        rng,
        palette,
        ts,
        STACK.boards - 1,
        box.width * STACK_MAX_FOOTPRINT_SHARE,
      );
      paintRopeCoil(
        ctx,
        { x: at.x, y: at.y - ts * STACK.boardLiftTiles * STACK.coilRestBoardLifts },
        palette,
        ts,
      );
      break;
    case 'plaster':
      paintLathBundle(ctx, at, rng, palette, ts);
      break;
  }
  return at;
}

function paintLooseNails(
  ctx: Ctx,
  box: DamageBox,
  stack: Point,
  palette: ContractPalette,
  seed: number,
): void {
  const rng = mulberry32(subSeed(seed, SALT_NAILS));
  const ts = box.tilePx;
  const towardMiddle = stack.x < box.left + box.width / 2 ? 1 : -1;
  for (let nail = 0; nail < NAILS.count; nail++) {
    const x = stack.x + towardMiddle * ts * range(rng, NAILS.reachMinTiles, NAILS.reachMaxTiles);
    const y = stack.y + ts * range(rng, -NAILS.scatterYTiles, NAILS.scatterYTiles);
    const lying = range(rng, -NAILS.turn, NAILS.turn) + (rng() < 1 / 2 ? 0 : Math.PI);
    ctx.save();
    ctx.strokeStyle = rgba(sampleRamp(palette.nail, NAILS.shankTone), 1);
    ctx.lineWidth = screenPx(ts);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + Math.cos(lying) * ts * NAILS.shankTiles,
      y + Math.sin(lying) * ts * NAILS.shankTiles,
    );
    ctx.stroke();
    ctx.restore();
    drawNail(ctx, x, y, null, 0, palette.nail, ts);
  }
}

/** Paints one rebuild spot's stripped site into `box`. */
export function paintContractBuildSite(
  ctx: Ctx,
  box: DamageBox,
  material: ContractArtMaterial,
  palette: ContractPalette,
  seed: number,
): void {
  paintChalkOutline(ctx, box, palette, seed);
  const stack = paintStack(ctx, box, material, palette, seed);
  paintLooseNails(ctx, box, stack, palette, seed);
}
