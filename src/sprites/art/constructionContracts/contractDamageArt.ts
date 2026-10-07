/**
 * Construction-contract damage: what a marked spot looks like before the
 * party mends it, one painter per material, each with a version for every
 * shape of target.
 *
 * - **prop** — over a piece of furniture's footprint. Marks sit on the body
 *   the footprint holds and the debris lies at its foot; a little headroom
 *   above lets a sprung board stand proud of the top.
 * - **floor** — a tonal read, never a busy one: a lifted board or a sunken,
 *   cracked flag in washes a few percent either side of the floor it sits on.
 * - **wall** — on the visible face, the base band left for the footing or
 *   skirting, and every mark darkening upward into the shadow the cap already
 *   throws, never a hard black hole.
 * - **doorway** / **open_side** — the threshold's floor version plus the
 *   member that used to span the gap, lying broken across it.
 *
 * Every painter draws inside the box it is given; the cache clips to it as a
 * backstop. Everything is seeded: the same spot paints the same damage.
 */

import { rgba } from '../town/townArt';
import { sampleRamp, type RGB } from '../town/townPalette';
import { mulberry32, range, rangeInt, subSeed, type Rng } from '../../person/rng';
import type { ContractPalette } from './contractPalette';
import {
  contactShadow,
  drawBoard,
  drawChunk,
  drawCrumbs,
  drawFray,
  drawNail,
  drawRope,
  drawSplinter,
  jaggedLine,
  lifted,
  screenPx,
  steppedCrack,
  strokeGroove,
  type Point,
} from './contractStrokes';

type Ctx = CanvasRenderingContext2D;

/** What a damaged spot is made of; picks its painter. */
export type ContractArtMaterial = 'wood' | 'stone' | 'rope' | 'plaster';

/** The shape of thing the damage is painted over. */
export type ContractArtSurface = 'prop' | 'floor' | 'wall' | 'doorway' | 'open_side';

/** The rectangle one painter fills, in the units of the surface it paints on. */
export interface DamageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly tilePx: number;
}

export interface DamageJob {
  readonly ctx: Ctx;
  readonly box: DamageBox;
  readonly surface: ContractArtSurface;
  readonly palette: ContractPalette;
  readonly seed: number;
}

/** One stream per part of a painter, so adding a mark never reshuffles the rest. */
function stream(seed: number, part: number): Rng {
  return mulberry32(subSeed(seed, part));
}

const Part = {
  Primary: 1,
  Secondary: 2,
  Nails: 3,
  Debris: 4,
  Cracks: 5,
  Chunk: 6,
  Mortar: 7,
  Rope: 8,
  Fray: 9,
  Patch: 10,
  Lath: 11,
} as const;

function right(box: DamageBox): number {
  return box.left + box.width;
}
function bottom(box: DamageBox): number {
  return box.top + box.height;
}

/** Share of a wall face, at its foot, that is footing or skirting rather than the face proper. */
const WALL_BASE_BAND_SHARE = 0.22;
/** How far down a wall face the cap's shadow reaches into the damage. */
const WALL_TOP_SHADOW_REACH = 0.45;
const WALL_TOP_SHADOW_ALPHA = 0.5;

/** The part of a wall's face above its footing, where the damage itself goes. */
function wallBody(box: DamageBox): DamageBox {
  return { ...box, height: box.height * (1 - WALL_BASE_BAND_SHARE) };
}

/** The foot of the target: where debris lands, inset so its shadow stays inside. */
const FOOT_INSET_TILES = 0.14;
function footY(box: DamageBox): number {
  return bottom(box) - box.tilePx * FOOT_INSET_TILES;
}

/**
 * Darkens everything already painted toward the top of the box, over the
 * damage's own pixels only, so a gap near the cap reads as going into the
 * cap's shadow instead of stopping at a hard line.
 */
function shadeTowardCap(ctx: Ctx, box: DamageBox, ink: RGB): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(
    0,
    box.top,
    0,
    box.top + box.height * WALL_TOP_SHADOW_REACH,
  );
  shade.addColorStop(0, rgba(ink, WALL_TOP_SHADOW_ALPHA));
  shade.addColorStop(1, rgba(ink, 0));
  ctx.fillStyle = shade;
  ctx.fillRect(box.left, box.top, box.width, box.height);
  ctx.restore();
}

// ── Wood ──────────────────────────────────────────────────────────────────────

const WOOD = {
  /** The missing slat's band, as shares of the body's height. */
  slotTopMin: 0.3,
  slotTopMax: 0.48,
  slotThicknessTiles: 0.26,
  slotStartMin: 0.08,
  slotStartMax: 0.22,
  slotEndMin: 0.62,
  slotEndMax: 0.86,
  /** The empty slot is deep shadow, mixed with whatever is behind it — never pure black. */
  slotAlpha: 0.8,
  slotBackLipAlpha: 0.3,
  /** The sprung board hangs off one nail and droops by this much. */
  sprungAngleMin: 0.16,
  sprungAngleMax: 0.3,
  sprungLengthShare: 0.86,
  splitRowShare: 0.74,
  splitLengthMin: 0.3,
  splitLengthMax: 0.5,
  splitWidthPx: 1.8,
  splitAlpha: 0.85,
  splitLipAlpha: 0.6,
  splitKinks: 5,
  splitWobbleTiles: 0.03,
  splinterCount: 3,
  splinterLengthMinTiles: 0.12,
  splinterLengthMaxTiles: 0.24,
  nailShankTiles: 0.12,
  bentNails: 2,
  debrisShadowAlpha: 0.3,
  /** The back board seen through the slot catches a sliver of light along the slot's foot. */
  slotBackLipTone: 0.4,
  slotBackLipPx: 2,
  tornFibreRowMin: 0.3,
  tornFibreRowMax: 0.7,
  tornFibreLengthMinTiles: 0.08,
  tornFibreLengthMaxTiles: 0.14,
  tornFibreTone: 0.6,
  /** The nail the sprung board still hangs from sits this far into the slot. */
  pivotInsetPx: 3,
  sprungThicknessShare: 0.95,
  bentNailInsetPx: 3,
  bentNailUpperRow: 0.25,
  bentNailLowerRow: 0.75,
  bentNailAngleMin: -Math.PI * 0.8,
  bentNailAngleMax: -Math.PI * 0.4,
  slotToothTiles: 0.05,
  slotTeeth: 3,
  splitEdgeMargin: 0.05,
  splinterSpreadMin: 0.15,
  splinterSpreadMax: 0.85,
  splinterTurn: 0.5,
  splinterShadowLengthShare: 0.6,
  splinterShadowHeightTiles: 0.04,
  splinterTone: 0.55,
  fallenLengthMin: 0.7,
  fallenLengthMax: 0.85,
  fallenRowMin: 0.45,
  fallenRowMax: 0.65,
  fallenTurn: 0.22,
  fallenShadowDropTiles: 0.1,
  fallenShadowLengthShare: 0.5,
  fallenShadowHeightTiles: 0.08,
  fallenThicknessTiles: 0.18,
  /** An open side's span breaks into one piece per this many tiles. */
  openSideTilesPerPiece: 2,
} as const;

const WOOD_FLOOR = {
  boardLengthMinTiles: 1.2,
  boardLengthMaxTiles: 2,
  boardThicknessTiles: 0.3,
  liftAlpha: 0.1,
  litEdgeAlpha: 0.16,
  gapAlpha: 0.3,
  gapWidenTiles: 0.07,
  shadowAlpha: 0.16,
  breakAlpha: 0.5,
  breakTiles: 0.1,
  splitAlpha: 0.22,
  splitLipAlpha: 0.08,
  splitWidthPx: 1,
  maxLengthShare: 0.9,
  placeMin: 0.15,
  placeMax: 0.85,
  rowMin: 0.25,
  rowMax: 0.75,
  liftTone: 0.7,
  liftLighten: 0.3,
  litEdgeLighten: 0.2,
  litEdgePx: 1.5,
  liftShadowWidthTiles: 0.3,
  liftShadowHeightTiles: 0.08,
  /** The pale break's jagged profile, as shares of the board's thickness and the break's width. */
  breakNotchDepth: 0.3,
  breakNotchRow: 0.55,
  breakNotchInset: 0.4,
  nailInsetPx: 3,
  splitDropBoards: 2,
  splitDropJitterTiles: 0.3,
  splitClearTiles: 0.1,
  splitStartMin: 0.1,
  splitStartMax: 0.5,
  splitLengthTiles: 0.8,
  splitKinks: 4,
  splitWobbleTiles: 0.02,
} as const;

function paintWoodSlot(job: DamageJob, body: DamageBox): void {
  const { ctx, palette } = job;
  const ts = body.tilePx;
  const rng = stream(job.seed, Part.Primary);
  const slotTop = body.top + body.height * range(rng, WOOD.slotTopMin, WOOD.slotTopMax);
  const slotH = ts * WOOD.slotThicknessTiles;
  const slotStart = body.left + body.width * range(rng, WOOD.slotStartMin, WOOD.slotStartMax);
  const slotEnd = body.left + body.width * range(rng, WOOD.slotEndMin, WOOD.slotEndMax);
  const ends = jaggedSlotOutline(rng, slotStart, slotEnd, slotTop, slotH, ts);
  ctx.save();
  ctx.beginPath();
  ends.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = rgba(palette.ink, WOOD.slotAlpha);
  ctx.fill();
  ctx.fillStyle = rgba(sampleRamp(palette.wood, WOOD.slotBackLipTone), WOOD.slotBackLipAlpha);
  ctx.fillRect(
    slotStart,
    slotTop + slotH - screenPx(ts) * WOOD.slotBackLipPx,
    slotEnd - slotStart,
    screenPx(ts) * WOOD.slotBackLipPx,
  );
  ctx.restore();
  // The neighbouring boards tore where the slat came out: pale fibre at each end.
  const breakRng = stream(job.seed, Part.Debris);
  for (const x of [slotStart, slotEnd]) {
    drawSplinter(
      ctx,
      x,
      slotTop + slotH * range(breakRng, WOOD.tornFibreRowMin, WOOD.tornFibreRowMax),
      ts * range(breakRng, WOOD.tornFibreLengthMinTiles, WOOD.tornFibreLengthMaxTiles),
      x === slotStart ? 0 : Math.PI,
      sampleRamp(palette.wood, WOOD.tornFibreTone),
      palette.freshBreak,
      palette.ink,
      ts,
    );
  }
  const sprungRng = stream(job.seed, Part.Secondary);
  const pivotX = slotStart + screenPx(ts) * WOOD.pivotInsetPx;
  const pivotY = slotTop + slotH / 2;
  const length = (slotEnd - slotStart) * WOOD.sprungLengthShare;
  const droop = range(sprungRng, WOOD.sprungAngleMin, WOOD.sprungAngleMax);
  const cx = pivotX + (Math.cos(droop) * length) / 2;
  const cy = pivotY + (Math.sin(droop) * length) / 2;
  drawBoard(ctx, cx, cy, length, slotH * WOOD.sprungThicknessShare, droop, sprungRng, {
    ramp: palette.wood,
    freshBreak: palette.freshBreak,
    ink: palette.ink,
    brokenEnd: 'end',
    tilePx: ts,
  });
  const nailRng = stream(job.seed, Part.Nails);
  drawNail(ctx, pivotX, pivotY, null, 0, palette.nail, ts);
  for (let nail = 0; nail < WOOD.bentNails; nail++) {
    drawNail(
      ctx,
      slotEnd - screenPx(ts) * WOOD.bentNailInsetPx,
      slotTop + slotH * (nail === 0 ? WOOD.bentNailUpperRow : WOOD.bentNailLowerRow),
      range(nailRng, WOOD.bentNailAngleMin, WOOD.bentNailAngleMax),
      ts * WOOD.nailShankTiles,
      palette.nail,
      ts,
    );
  }
}

/** A rectangle whose two short ends are torn rather than cut. */
function jaggedSlotOutline(
  rng: Rng,
  start: number,
  end: number,
  top: number,
  height: number,
  ts: number,
): Point[] {
  const tooth = ts * WOOD.slotToothTiles;
  const teeth = WOOD.slotTeeth;
  const left: Point[] = [];
  const rightSide: Point[] = [];
  for (let index = 0; index <= teeth; index++) {
    const y = top + (height * index) / teeth;
    left.push({ x: start + range(rng, -tooth, tooth), y });
    rightSide.push({ x: end + range(rng, -tooth, tooth), y });
  }
  return [...rightSide, ...left.reverse()];
}

function paintWoodSplit(job: DamageJob, body: DamageBox, rowShare: number): void {
  const rng = stream(job.seed, Part.Cracks);
  const ts = body.tilePx;
  const y = body.top + body.height * rowShare;
  const length = body.width * range(rng, WOOD.splitLengthMin, WOOD.splitLengthMax);
  const start =
    body.left +
    range(rng, WOOD.splitEdgeMargin, 1 - WOOD.splitEdgeMargin - length / body.width) * body.width;
  const points = jaggedLine(
    rng,
    { x: start, y },
    { x: start + length, y: y + range(rng, -1, 1) * ts * WOOD.splitWobbleTiles },
    WOOD.splitKinks,
    ts * WOOD.splitWobbleTiles,
  );
  strokeGroove(
    job.ctx,
    points,
    screenPx(ts) * WOOD.splitWidthPx,
    job.palette.ink,
    WOOD.splitAlpha,
    job.palette.freshBreak,
    WOOD.splitLipAlpha,
    ts,
  );
}

function paintSplintersAtFoot(job: DamageJob, box: DamageBox): void {
  const rng = stream(job.seed, Part.Debris + Part.Fray);
  const ts = box.tilePx;
  const y = footY(box);
  for (let index = 0; index < WOOD.splinterCount; index++) {
    const x = box.left + box.width * range(rng, WOOD.splinterSpreadMin, WOOD.splinterSpreadMax);
    const length = ts * range(rng, WOOD.splinterLengthMinTiles, WOOD.splinterLengthMaxTiles);
    const angle = range(rng, -WOOD.splinterTurn, WOOD.splinterTurn) + (rng() < 1 / 2 ? 0 : Math.PI);
    contactShadow(
      job.ctx,
      x,
      y + screenPx(ts),
      length * WOOD.splinterShadowLengthShare,
      ts * WOOD.splinterShadowHeightTiles,
      job.palette.ink,
      WOOD.debrisShadowAlpha,
    );
    drawSplinter(
      job.ctx,
      x,
      y,
      length,
      angle,
      sampleRamp(job.palette.wood, WOOD.splinterTone),
      job.palette.freshBreak,
      job.palette.ink,
      ts,
    );
  }
}

function paintWoodFloor(job: DamageJob, box: DamageBox): void {
  const { ctx, palette } = job;
  const ts = box.tilePx;
  const rng = stream(job.seed, Part.Primary);
  const length = Math.min(
    box.width * WOOD_FLOOR.maxLengthShare,
    ts * range(rng, WOOD_FLOOR.boardLengthMinTiles, WOOD_FLOOR.boardLengthMaxTiles),
  );
  const thickness = ts * WOOD_FLOOR.boardThicknessTiles;
  const x = box.left + (box.width - length) * range(rng, WOOD_FLOOR.placeMin, WOOD_FLOOR.placeMax);
  const y = box.top + (box.height - thickness) * range(rng, WOOD_FLOOR.rowMin, WOOD_FLOOR.rowMax);
  const liftsRight = rng() < 1 / 2;
  const liftEnd = liftsRight ? x + length : x;
  const fixedEnd = liftsRight ? x : x + length;
  const widen = ts * WOOD_FLOOR.gapWidenTiles;
  ctx.save();
  // The board's own face, a shade lighter: it now catches light the floor around it does not.
  ctx.fillStyle = rgba(
    lifted(sampleRamp(palette.wood, WOOD_FLOOR.liftTone), WOOD_FLOOR.liftLighten),
    WOOD_FLOOR.liftAlpha,
  );
  ctx.fillRect(x, y - widen / 2, length, thickness);
  ctx.fillStyle = rgba(
    lifted(palette.freshBreak, WOOD_FLOOR.litEdgeLighten),
    WOOD_FLOOR.litEdgeAlpha,
  );
  ctx.fillRect(x, y - widen / 2, length, screenPx(ts) * WOOD_FLOOR.litEdgePx);
  // The gap under its lifted end opens as a wedge.
  ctx.fillStyle = rgba(palette.ink, WOOD_FLOOR.gapAlpha);
  ctx.beginPath();
  ctx.moveTo(fixedEnd, y + thickness);
  ctx.lineTo(liftEnd, y + thickness - widen);
  ctx.lineTo(liftEnd, y + thickness + widen);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  contactShadow(
    ctx,
    liftEnd,
    y + thickness + widen,
    ts * WOOD_FLOOR.liftShadowWidthTiles,
    ts * WOOD_FLOOR.liftShadowHeightTiles,
    palette.ink,
    WOOD_FLOOR.shadowAlpha,
  );
  ctx.save();
  ctx.fillStyle = rgba(palette.freshBreak, WOOD_FLOOR.breakAlpha);
  const breakW = ts * WOOD_FLOOR.breakTiles;
  const breakX = liftsRight ? liftEnd - breakW : liftEnd;
  ctx.beginPath();
  ctx.moveTo(breakX, y - widen / 2);
  ctx.lineTo(breakX + breakW, y - widen / 2 + thickness * WOOD_FLOOR.breakNotchDepth);
  ctx.lineTo(
    breakX + breakW * WOOD_FLOOR.breakNotchInset,
    y + thickness * WOOD_FLOOR.breakNotchRow,
  );
  ctx.lineTo(breakX + breakW, y + thickness);
  ctx.lineTo(breakX, y + thickness);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawNail(
    ctx,
    fixedEnd + (liftsRight ? 1 : -1) * screenPx(ts) * WOOD_FLOOR.nailInsetPx,
    y + thickness / 2,
    null,
    0,
    palette.nail,
    ts,
  );
  const splitRng = stream(job.seed, Part.Cracks);
  const splitY =
    y +
    thickness * WOOD_FLOOR.splitDropBoards +
    range(splitRng, 0, ts * WOOD_FLOOR.splitDropJitterTiles);
  if (splitY < bottom(box) - ts * WOOD_FLOOR.splitClearTiles) {
    const splitStart =
      box.left + box.width * range(splitRng, WOOD_FLOOR.splitStartMin, WOOD_FLOOR.splitStartMax);
    strokeGroove(
      ctx,
      jaggedLine(
        splitRng,
        { x: splitStart, y: splitY },
        { x: splitStart + ts * WOOD_FLOOR.splitLengthTiles, y: splitY },
        WOOD_FLOOR.splitKinks,
        ts * WOOD_FLOOR.splitWobbleTiles,
      ),
      screenPx(ts) * WOOD_FLOOR.splitWidthPx,
      palette.ink,
      WOOD_FLOOR.splitAlpha,
      palette.freshBreak,
      WOOD_FLOOR.splitLipAlpha,
      ts,
    );
  }
}

/** The member that used to span an opening, snapped and lying across it. */
function paintFallenBoard(job: DamageJob, box: DamageBox, pieces: number): void {
  const rng = stream(job.seed, Part.Secondary + Part.Chunk);
  const ts = box.tilePx;
  const span = box.width / pieces;
  for (let piece = 0; piece < pieces; piece++) {
    const length = span * range(rng, WOOD.fallenLengthMin, WOOD.fallenLengthMax);
    const cx = box.left + span * (piece + 1 / 2);
    const cy = box.top + box.height * range(rng, WOOD.fallenRowMin, WOOD.fallenRowMax);
    const angle = range(rng, -WOOD.fallenTurn, WOOD.fallenTurn);
    contactShadow(
      job.ctx,
      cx,
      cy + ts * WOOD.fallenShadowDropTiles,
      length * WOOD.fallenShadowLengthShare,
      ts * WOOD.fallenShadowHeightTiles,
      job.palette.ink,
      WOOD.debrisShadowAlpha,
    );
    drawBoard(job.ctx, cx, cy, length, ts * WOOD.fallenThicknessTiles, angle, rng, {
      ramp: job.palette.wood,
      freshBreak: job.palette.freshBreak,
      ink: job.palette.ink,
      brokenEnd: piece === 0 ? 'end' : 'start',
      tilePx: ts,
    });
  }
}

const UPRIGHT = {
  boardTiles: 0.36,
  /** The sprung board leans out from the nail at its foot by this much. */
  leanMin: 0.32,
  leanMax: 0.45,
  /** The board snapped off this share of the way up, leaving the top of the gap open. */
  remainingShare: 0.78,
  splitOffsetBoards: 1.5,
  maxBoardShare: 0.4,
  /** The slot sits clear of the face's ends by a board either side: three boards' room. */
  boardsOfRoom: 3,
  placeMin: 0.1,
  placeMax: 0.9,
  tornTeeth: 3,
  toothTiles: 0.04,
  footLiftPx: 2,
  thicknessShare: 0.9,
  footNailLiftPx: 2,
  bentNailLeft: 0.3,
  bentNailRight: 0.7,
  bentNailDropPx: 3,
  bentNailAngleMin: Math.PI * 0.2,
  bentNailAngleMax: Math.PI * 0.5,
  edgeClearPx: 2,
  splitTop: 0.15,
  splitBottomMin: 0.55,
  splitBottomMax: 0.8,
  splitKinks: 4,
} as const;

/**
 * A board missing from an upright-boarded wall: the dark slot it left, the
 * board itself sprung loose from the nail at its foot and leaning across the
 * next board, its snapped top pale, with the nails it tore off bent at the
 * top of the slot and a split down a neighbour.
 */
function paintUprightBoardGap(job: DamageJob, body: DamageBox): void {
  const { ctx, palette } = job;
  const ts = body.tilePx;
  const rng = stream(job.seed, Part.Primary);
  const boardW = Math.min(body.width * UPRIGHT.maxBoardShare, ts * UPRIGHT.boardTiles);
  const slotX =
    body.left +
    boardW +
    (body.width - boardW * UPRIGHT.boardsOfRoom) * range(rng, UPRIGHT.placeMin, UPRIGHT.placeMax);
  const slotTop = body.top;
  const slotH = body.height;
  ctx.save();
  ctx.fillStyle = rgba(palette.ink, WOOD.slotAlpha);
  ctx.beginPath();
  ctx.moveTo(slotX, slotTop);
  ctx.lineTo(slotX + boardW, slotTop);
  for (let tooth = 1; tooth <= UPRIGHT.tornTeeth; tooth++) {
    ctx.lineTo(
      slotX + boardW + range(rng, -1, 1) * ts * UPRIGHT.toothTiles,
      slotTop + (slotH * tooth) / UPRIGHT.tornTeeth,
    );
  }
  ctx.lineTo(slotX, slotTop + slotH);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const leansRight = rng() < 1 / 2;
  const lean = range(rng, UPRIGHT.leanMin, UPRIGHT.leanMax) * (leansRight ? 1 : -1);
  const length = slotH * UPRIGHT.remainingShare;
  const footX = slotX + boardW / 2;
  const footY = slotTop + slotH - screenPx(ts) * UPRIGHT.footLiftPx;
  const angle = -Math.PI / 2 + lean;
  drawBoard(
    ctx,
    footX + (Math.cos(angle) * length) / 2,
    footY + (Math.sin(angle) * length) / 2,
    length,
    boardW * UPRIGHT.thicknessShare,
    angle,
    rng,
    {
      ramp: palette.wood,
      freshBreak: palette.freshBreak,
      ink: palette.ink,
      brokenEnd: 'end',
      tilePx: ts,
    },
  );
  drawNail(ctx, footX, footY - screenPx(ts) * UPRIGHT.footNailLiftPx, null, 0, palette.nail, ts);
  const nailRng = stream(job.seed, Part.Nails);
  for (let nail = 0; nail < WOOD.bentNails; nail++) {
    drawNail(
      ctx,
      slotX + boardW * (nail === 0 ? UPRIGHT.bentNailLeft : UPRIGHT.bentNailRight),
      slotTop + screenPx(ts) * UPRIGHT.bentNailDropPx,
      range(nailRng, UPRIGHT.bentNailAngleMin, UPRIGHT.bentNailAngleMax),
      ts * WOOD.nailShankTiles,
      palette.nail,
      ts,
    );
  }
  const splitRng = stream(job.seed, Part.Cracks);
  const splitSide = leansRight ? -1 : 1;
  const splitX = Math.min(
    body.left + body.width - screenPx(ts) * UPRIGHT.edgeClearPx,
    Math.max(
      body.left + screenPx(ts) * UPRIGHT.edgeClearPx,
      footX + splitSide * boardW * UPRIGHT.splitOffsetBoards,
    ),
  );
  strokeGroove(
    ctx,
    jaggedLine(
      splitRng,
      { x: splitX, y: slotTop + slotH * UPRIGHT.splitTop },
      {
        x: splitX,
        y: slotTop + slotH * range(splitRng, UPRIGHT.splitBottomMin, UPRIGHT.splitBottomMax),
      },
      UPRIGHT.splitKinks,
      ts * WOOD.splitWobbleTiles,
    ),
    screenPx(ts) * WOOD.splitWidthPx,
    palette.ink,
    WOOD.splitAlpha,
    palette.freshBreak,
    WOOD.splitLipAlpha,
    ts,
  );
}

function paintWood(job: DamageJob): void {
  const { box } = job;
  switch (job.surface) {
    case 'prop':
      paintWoodSlot(job, box);
      paintWoodSplit(job, box, WOOD.splitRowShare);
      paintSplintersAtFoot(job, box);
      return;
    case 'wall': {
      const body = wallBody(box);
      if (job.palette.wallBoardGrain === 'vertical') {
        paintUprightBoardGap(job, body);
      } else {
        paintWoodSlot(job, body);
        paintWoodSplit(job, body, WOOD.splitRowShare);
      }
      shadeTowardCap(job.ctx, box, job.palette.ink);
      paintSplintersAtFoot(job, box);
      return;
    }
    case 'floor':
      paintWoodFloor(job, box);
      return;
    case 'doorway':
      paintWoodFloor(job, box);
      paintFallenBoard(job, box, 1);
      paintSplintersAtFoot(job, box);
      return;
    case 'open_side':
      paintWoodFloor(job, box);
      paintFallenBoard(
        job,
        box,
        Math.max(2, Math.round(box.width / (box.tilePx * WOOD.openSideTilesPerPiece))),
      );
      paintSplintersAtFoot(job, box);
      return;
  }
}

// ── Stone ─────────────────────────────────────────────────────────────────────

const STONE = {
  courseTiles: 0.28,
  blockTiles: 0.55,
  crackWidthPx: 1.5,
  crackAlpha: 0.85,
  crackLipAlpha: 0.45,
  branchWidthPx: 1.1,
  notchTiles: 0.34,
  notchAlpha: 0.55,
  notchFacetAlpha: 0.55,
  mortarRakes: 3,
  mortarRakeTiles: 0.32,
  mortarAlpha: 0.55,
  mortarWidthPx: 2,
  chunkRadiusTiles: 0.13,
  crumbCount: 7,
  /** The crack network stops short of the foot, leaving room for the fallen piece. */
  crackReachShare: 0.85,
  crackStartMin: 0.3,
  crackStartMax: 0.7,
  crackStartDropPx: 2,
  crackMarginTiles: 0.12,
  crackLipLighten: 0.2,
  /** The branch runs two courses fewer than the trunk it leaves. */
  branchCoursesShort: 2,
  notchMaxWidthShare: 0.35,
  notchMaxHeightShare: 0.4,
  /** The recess outline and its lit facet, as shares of the notch's size. */
  notchMidInset: 0.7,
  notchMidDrop: 0.45,
  notchLowInset: 0.25,
  notchLowDrop: 0.8,
  notchEdgeDrop: 0.9,
  notchFacetFoot: 1.05,
  notchFacetInset: 0.35,
  notchFacetDrop: 0.95,
  notchFacetTone: 0.95,
  notchFacetLighten: 0.15,
  mortarClearPx: 2,
  mortarLengthMin: 0.7,
  mortarLengthMax: 1.2,
  mortarKinks: 3,
  mortarWobblePx: 0.6,
  fallenLeftMin: 0.15,
  fallenLeftMax: 0.3,
  fallenRightMin: 0.7,
  fallenRightMax: 0.85,
  fallenEdgeClearRadii: 1.4,
  fallenSinkRadii: 0.3,
  crumbOffsetRadii: 1.6,
  crumbDropRadii: 0.2,
  crumbSpreadRadii: 1.1,
  crumbSpreadYRadii: 0.25,
  blockRadiusMin: 1,
  blockRadiusMax: 1.5,
  blockPlaceMin: 0.3,
  blockPlaceMax: 0.7,
  blockRowMin: 0.45,
  blockRowMax: 0.7,
  blockCrumbRow: 0.75,
  blockCrumbSpreadShare: 0.35,
  blockCrumbSpreadYTiles: 0.06,
} as const;

const STONE_FLOOR = {
  flagWidthMinTiles: 0.9,
  flagWidthMaxTiles: 1.3,
  flagHeightMinTiles: 0.65,
  flagHeightMaxTiles: 0.85,
  sunkAlpha: 0.1,
  innerShadeAlpha: 0.2,
  innerShadePx: 2,
  outerLipAlpha: 0.1,
  crackAlpha: 0.32,
  crackLipAlpha: 0.1,
  crackWidthPx: 1,
  cracks: 3,
  maxSizeShare: 0.9,
  placeMin: 0.2,
  placeMax: 0.8,
  lipTone: 1,
  lipLighten: 0.3,
  hubMin: 0.3,
  hubMax: 0.7,
  endMin: 0.2,
  endMax: 0.8,
  crackKinks: 4,
  crackWobbleTiles: 0.04,
} as const;

function paintCrackNetwork(job: DamageJob, body: DamageBox, part: number): void {
  const rng = stream(job.seed, part);
  const ts = body.tilePx;
  const courseH = ts * STONE.courseTiles;
  const courses = Math.max(1, Math.floor((body.height * STONE.crackReachShare) / courseH));
  const start = {
    x: body.left + body.width * range(rng, STONE.crackStartMin, STONE.crackStartMax),
    y: body.top + screenPx(ts) * STONE.crackStartDropPx,
  };
  const margin = ts * STONE.crackMarginTiles;
  const trunk = steppedCrack(
    rng,
    start,
    courses,
    courseH,
    ts * STONE.blockTiles,
    body.left + margin,
    right(body) - margin,
  );
  const lip = lifted(sampleRamp(job.palette.stone, 1), STONE.crackLipLighten);
  strokeGroove(
    job.ctx,
    trunk,
    screenPx(ts) * STONE.crackWidthPx,
    job.palette.ink,
    STONE.crackAlpha,
    lip,
    STONE.crackLipAlpha,
    ts,
  );
  const branchFrom =
    trunk[Math.min(trunk.length - 1, rangeInt(rng, 1, Math.max(1, trunk.length - 2)))];
  const branch = steppedCrack(
    rng,
    branchFrom,
    Math.max(1, courses - STONE.branchCoursesShort),
    courseH,
    ts * STONE.blockTiles,
    body.left + margin,
    right(body) - margin,
  );
  strokeGroove(
    job.ctx,
    branch,
    screenPx(ts) * STONE.branchWidthPx,
    job.palette.ink,
    STONE.crackAlpha,
    lip,
    STONE.crackLipAlpha,
    ts,
  );
}

/** A corner knocked off the top of the masonry: a shadowed recess with a lit broken facet. */
function paintNotch(job: DamageJob, body: DamageBox): boolean {
  const rng = stream(job.seed, Part.Chunk);
  const ts = body.tilePx;
  const size = Math.min(
    ts * STONE.notchTiles,
    body.width * STONE.notchMaxWidthShare,
    body.height * STONE.notchMaxHeightShare,
  );
  const onLeft = rng() < 1 / 2;
  const edgeX = onLeft ? body.left : right(body);
  const inward = onLeft ? 1 : -1;
  const top = body.top;
  const recess: Point[] = [
    { x: edgeX, y: top },
    { x: edgeX + inward * size, y: top },
    { x: edgeX + inward * size * STONE.notchMidInset, y: top + size * STONE.notchMidDrop },
    { x: edgeX + inward * size * STONE.notchLowInset, y: top + size * STONE.notchLowDrop },
    { x: edgeX, y: top + size * STONE.notchEdgeDrop },
  ];
  const { ctx, palette } = job;
  ctx.save();
  ctx.beginPath();
  recess.forEach((point, index) =>
    index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
  );
  ctx.closePath();
  ctx.fillStyle = rgba(palette.ink, STONE.notchAlpha);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(recess[2].x, recess[2].y);
  ctx.lineTo(recess[3].x, recess[3].y);
  ctx.lineTo(recess[4].x, recess[4].y);
  ctx.lineTo(edgeX, top + size * STONE.notchFacetFoot);
  ctx.lineTo(edgeX + inward * size * STONE.notchFacetInset, top + size * STONE.notchFacetDrop);
  ctx.closePath();
  ctx.fillStyle = rgba(
    lifted(sampleRamp(palette.stone, STONE.notchFacetTone), STONE.notchFacetLighten),
    STONE.notchFacetAlpha,
  );
  ctx.fill();
  ctx.restore();
  return onLeft;
}

function paintRakedMortar(job: DamageJob, body: DamageBox): void {
  const rng = stream(job.seed, Part.Mortar);
  const ts = body.tilePx;
  const courseH = ts * STONE.courseTiles;
  for (let rake = 0; rake < STONE.mortarRakes; rake++) {
    const course = rangeInt(rng, 1, Math.max(1, Math.floor(body.height / courseH) - 1));
    const y = body.top + course * courseH;
    if (y > bottom(body) - screenPx(ts) * STONE.mortarClearPx) continue;
    const length =
      ts * STONE.mortarRakeTiles * range(rng, STONE.mortarLengthMin, STONE.mortarLengthMax);
    const x = body.left + range(rng, 0, Math.max(0, body.width - length));
    strokeGroove(
      job.ctx,
      jaggedLine(
        rng,
        { x, y },
        { x: x + length, y },
        STONE.mortarKinks,
        screenPx(ts) * STONE.mortarWobblePx,
      ),
      screenPx(ts) * STONE.mortarWidthPx,
      job.palette.ink,
      STONE.mortarAlpha,
      job.palette.mortar,
      STONE.crackLipAlpha,
      ts,
    );
  }
}

function paintFallenStone(job: DamageJob, box: DamageBox, onLeft: boolean): void {
  const rng = stream(job.seed, Part.Debris);
  const ts = box.tilePx;
  const radius = ts * STONE.chunkRadiusTiles;
  const share = onLeft
    ? range(rng, STONE.fallenLeftMin, STONE.fallenLeftMax)
    : range(rng, STONE.fallenRightMin, STONE.fallenRightMax);
  const cx = Math.min(
    right(box) - radius * STONE.fallenEdgeClearRadii,
    Math.max(box.left + radius * STONE.fallenEdgeClearRadii, box.left + box.width * share),
  );
  const cy = footY(box) - radius * STONE.fallenSinkRadii;
  drawChunk(job.ctx, cx, cy, radius, rng, job.palette.stone, job.palette.ink, ts);
  drawCrumbs(
    job.ctx,
    cx + (onLeft ? 1 : -1) * radius * STONE.crumbOffsetRadii,
    cy + radius * STONE.crumbDropRadii,
    radius * STONE.crumbSpreadRadii,
    radius * STONE.crumbSpreadYRadii,
    STONE.crumbCount,
    rng,
    job.palette.stone,
    ts,
  );
}

function paintSunkenFlag(job: DamageJob, box: DamageBox): void {
  const { ctx, palette } = job;
  const ts = box.tilePx;
  const rng = stream(job.seed, Part.Primary);
  const w = Math.min(
    box.width * STONE_FLOOR.maxSizeShare,
    ts * range(rng, STONE_FLOOR.flagWidthMinTiles, STONE_FLOOR.flagWidthMaxTiles),
  );
  const h = Math.min(
    box.height * STONE_FLOOR.maxSizeShare,
    ts * range(rng, STONE_FLOOR.flagHeightMinTiles, STONE_FLOOR.flagHeightMaxTiles),
  );
  const x = box.left + (box.width - w) * range(rng, STONE_FLOOR.placeMin, STONE_FLOOR.placeMax);
  const y = box.top + (box.height - h) * range(rng, STONE_FLOOR.placeMin, STONE_FLOOR.placeMax);
  const edge = screenPx(ts) * STONE_FLOOR.innerShadePx;
  ctx.save();
  ctx.fillStyle = rgba(palette.ink, STONE_FLOOR.sunkAlpha);
  ctx.fillRect(x, y, w, h);
  // Sunk below its neighbours: they throw a shadow onto its upper-left edges.
  ctx.fillStyle = rgba(palette.ink, STONE_FLOOR.innerShadeAlpha);
  ctx.fillRect(x, y, w, edge);
  ctx.fillRect(x, y + edge, edge, h - edge);
  ctx.fillStyle = rgba(
    lifted(sampleRamp(palette.stone, STONE_FLOOR.lipTone), STONE_FLOOR.lipLighten),
    STONE_FLOOR.outerLipAlpha,
  );
  ctx.fillRect(x, y + h - edge / 2, w, edge / 2);
  ctx.fillRect(x + w - edge / 2, y, edge / 2, h);
  ctx.restore();
  const crackRng = stream(job.seed, Part.Cracks);
  const hub = {
    x: x + w * range(crackRng, STONE_FLOOR.hubMin, STONE_FLOOR.hubMax),
    y: y + h * range(crackRng, STONE_FLOOR.hubMin, STONE_FLOOR.hubMax),
  };
  const ends: Point[] = [
    { x, y: y + h * range(crackRng, STONE_FLOOR.endMin, STONE_FLOOR.endMax) },
    { x: x + w, y: y + h * range(crackRng, STONE_FLOOR.endMin, STONE_FLOOR.endMax) },
    { x: x + w * range(crackRng, STONE_FLOOR.endMin, STONE_FLOOR.endMax), y: y + h },
  ];
  for (const end of ends.slice(0, STONE_FLOOR.cracks)) {
    strokeGroove(
      ctx,
      jaggedLine(crackRng, hub, end, STONE_FLOOR.crackKinks, ts * STONE_FLOOR.crackWobbleTiles),
      screenPx(ts) * STONE_FLOOR.crackWidthPx,
      palette.ink,
      STONE_FLOOR.crackAlpha,
      lifted(sampleRamp(palette.stone, STONE_FLOOR.lipTone), STONE_FLOOR.lipLighten),
      STONE_FLOOR.crackLipAlpha,
      ts,
    );
  }
}

/** Chunks of a fallen sill or lintel lying across an opening. */
function paintFallenBlocks(job: DamageJob, box: DamageBox, count: number): void {
  const rng = stream(job.seed, Part.Chunk + Part.Debris);
  const ts = box.tilePx;
  for (let index = 0; index < count; index++) {
    const radius =
      ts * STONE.chunkRadiusTiles * range(rng, STONE.blockRadiusMin, STONE.blockRadiusMax);
    const cx =
      box.left +
      (box.width * (index + range(rng, STONE.blockPlaceMin, STONE.blockPlaceMax))) / count;
    const cy = box.top + box.height * range(rng, STONE.blockRowMin, STONE.blockRowMax);
    drawChunk(job.ctx, cx, cy, radius, rng, job.palette.stone, job.palette.ink, ts);
  }
  drawCrumbs(
    job.ctx,
    box.left + box.width / 2,
    box.top + box.height * STONE.blockCrumbRow,
    box.width * STONE.blockCrumbSpreadShare,
    ts * STONE.blockCrumbSpreadYTiles,
    STONE.crumbCount,
    rng,
    job.palette.stone,
    ts,
  );
}

const FOOTING = {
  holeWidthTiles: 0.42,
  holeAlpha: 0.72,
  holeVertices: 8,
  holeJitter: 0.22,
  rakes: 2,
  holeMaxWidthShare: 0.4,
  placeMin: 0.15,
  placeMax: 0.85,
  holeRow: 0.45,
  holeHalfHeightShare: 0.5,
  rakeStartHoles: 0.55,
  rakeLengthMinTiles: 0.25,
  rakeLengthMaxTiles: 0.45,
  rakeRowMin: 0.3,
  rakeRowMax: 0.6,
  rakeKinks: 3,
  rakeWobblePx: 0.8,
  crackStartHoles: 0.3,
  crackLeanMinTiles: 0.15,
  crackLeanMaxTiles: 0.3,
  /** The crack climbs out of the footing almost a footing's height up the planks. */
  crackRiseFootings: 0.9,
  crackKinks: 3,
  crackWobbleTiles: 0.03,
  crackAlphaShare: 0.7,
  chunkEdgeClearRadii: 1.3,
  chunkOffsetHoles: 0.6,
  chunkLiftRadii: 0.8,
  crumbLiftPx: 2,
  crumbSpreadHoles: 0.6,
} as const;

/**
 * Stone damage on a plank wall's fieldstone footing: a stone knocked out of
 * the course, lying in front of its hole, with the mortar either side raked
 * out and a short crack running along the course.
 */
function paintFootingDamage(job: DamageJob, box: DamageBox): void {
  const { ctx, palette } = job;
  const ts = box.tilePx;
  const footingH = box.height * WALL_BASE_BAND_SHARE;
  const footing: DamageBox = { ...box, top: bottom(box) - footingH, height: footingH };
  const rng = stream(job.seed, Part.Chunk);
  const holeW = Math.min(footing.width * FOOTING.holeMaxWidthShare, ts * FOOTING.holeWidthTiles);
  const holeX =
    footing.left +
    holeW / 2 +
    (footing.width - holeW) * range(rng, FOOTING.placeMin, FOOTING.placeMax);
  const holeY = footing.top + footingH * FOOTING.holeRow;
  const hole: Point[] = [];
  for (let index = 0; index < FOOTING.holeVertices; index++) {
    const angle = (index / FOOTING.holeVertices) * Math.PI * 2;
    const jitter = 1 + range(rng, -FOOTING.holeJitter, FOOTING.holeJitter);
    hole.push({
      x: holeX + (Math.cos(angle) * holeW * jitter) / 2,
      y: holeY + Math.sin(angle) * footingH * FOOTING.holeHalfHeightShare * jitter,
    });
  }
  ctx.save();
  ctx.beginPath();
  hole.forEach((point, index) =>
    index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
  );
  ctx.closePath();
  ctx.fillStyle = rgba(palette.ink, FOOTING.holeAlpha);
  ctx.fill();
  ctx.restore();
  const mortarRng = stream(job.seed, Part.Mortar);
  for (let rake = 0; rake < FOOTING.rakes; rake++) {
    const side = rake === 0 ? -1 : 1;
    const from = holeX + side * holeW * FOOTING.rakeStartHoles;
    const to =
      from + side * ts * range(mortarRng, FOOTING.rakeLengthMinTiles, FOOTING.rakeLengthMaxTiles);
    const y = footing.top + footingH * range(mortarRng, FOOTING.rakeRowMin, FOOTING.rakeRowMax);
    strokeGroove(
      ctx,
      jaggedLine(
        mortarRng,
        { x: from, y },
        { x: Math.min(right(footing), Math.max(footing.left, to)), y },
        FOOTING.rakeKinks,
        screenPx(ts) * FOOTING.rakeWobblePx,
      ),
      screenPx(ts) * STONE.mortarWidthPx,
      palette.ink,
      STONE.mortarAlpha,
      palette.mortar,
      STONE.crackLipAlpha,
      ts,
    );
  }
  const crackRng = stream(job.seed, Part.Cracks);
  const crackStart = { x: holeX + holeW * FOOTING.crackStartHoles, y: footing.top + screenPx(ts) };
  strokeGroove(
    ctx,
    jaggedLine(
      crackRng,
      crackStart,
      {
        x:
          crackStart.x + ts * range(crackRng, FOOTING.crackLeanMinTiles, FOOTING.crackLeanMaxTiles),
        y: footing.top - footingH * FOOTING.crackRiseFootings,
      },
      FOOTING.crackKinks,
      ts * FOOTING.crackWobbleTiles,
    ),
    screenPx(ts) * STONE.branchWidthPx,
    palette.ink,
    STONE.crackAlpha * FOOTING.crackAlphaShare,
    palette.freshBreak,
    STONE.crackLipAlpha,
    ts,
  );
  const chunkRadius = ts * STONE.chunkRadiusTiles;
  const chunkX = Math.min(
    right(box) - chunkRadius * FOOTING.chunkEdgeClearRadii,
    Math.max(
      box.left + chunkRadius * FOOTING.chunkEdgeClearRadii,
      holeX + holeW * FOOTING.chunkOffsetHoles,
    ),
  );
  drawChunk(
    ctx,
    chunkX,
    bottom(box) - chunkRadius * FOOTING.chunkLiftRadii,
    chunkRadius,
    rng,
    palette.stone,
    palette.ink,
    ts,
  );
  drawCrumbs(
    ctx,
    holeX,
    bottom(box) - screenPx(ts) * FOOTING.crumbLiftPx,
    holeW * FOOTING.crumbSpreadHoles,
    screenPx(ts),
    STONE.crumbCount,
    rng,
    palette.stone,
    ts,
  );
}

function paintStone(job: DamageJob): void {
  const { box } = job;
  switch (job.surface) {
    case 'prop': {
      paintCrackNetwork(job, box, Part.Cracks);
      paintRakedMortar(job, box);
      // No knocked-off corner here: a prop's art rarely fills its footprint's
      // corners, so a notch there would be a dark shape floating on the floor.
      paintFallenStone(job, box, stream(job.seed, Part.Chunk)() < 1 / 2);
      return;
    }
    case 'wall': {
      if (job.palette.wallMasonry === 'footing') {
        paintFootingDamage(job, box);
        return;
      }
      const body = wallBody(box);
      paintCrackNetwork(job, body, Part.Cracks);
      if (box.width > box.tilePx * 2) paintCrackNetwork(job, body, Part.Cracks + Part.Patch);
      paintRakedMortar(job, body);
      const onLeft = paintNotch(job, body);
      shadeTowardCap(job.ctx, box, job.palette.ink);
      paintFallenStone(job, box, onLeft);
      return;
    }
    case 'floor':
      paintSunkenFlag(job, box);
      return;
    case 'doorway':
      paintSunkenFlag(job, box);
      paintFallenBlocks(job, box, Math.max(1, Math.round(box.width / box.tilePx)));
      return;
    case 'open_side':
      paintSunkenFlag(job, box);
      paintFallenBlocks(job, box, Math.max(2, Math.round(box.width / box.tilePx)));
      return;
  }
}

// ── Rope ──────────────────────────────────────────────────────────────────────

const ROPE = {
  widthTiles: 0.075,
  poleWidthTiles: 0.13,
  /** The slackened member leans this far off true. */
  poleLeanMin: 0.12,
  poleLeanMax: 0.22,
  lashingWraps: 3,
  frayTiles: 0.14,
  hangTiles: 0.42,
  pegRadiusTiles: 0.075,
  /** A rope lying on the floor curves gently, in this many waves along its length. */
  lieWaves: 0.75,
  lieAmplitudeTiles: 0.1,
  curveSampleTiles: 0.12,
  shadowAlpha: 0.3,
  /** A hanging end's sag: where its midpoint sits, as shares of its swing and drop. */
  hangMidSwing: 0.2,
  hangMidDrop: 0.55,
  lashReachShare: 0.9,
  wrapSpacingWidths: 1.6,
  wrapSlackWidths: 0.5,
  poleFootLeft: 0.3,
  poleFootRight: 0.7,
  poleMaxHeightShare: 0.85,
  poleMaxLengthTiles: 1.6,
  poleShadowWidthTiles: 0.16,
  poleShadowHeightTiles: 0.05,
  /** The loose lashing sits near the pole's top, the snapped tail near its foot. */
  upperLashShare: 0.78,
  lowerLashShare: 0.3,
  hangOffsetXTiles: 0.1,
  hangOffsetYTiles: 0.04,
  hangSwingTiles: 0.08,
  tailEdgeClearTiles: 0.15,
  tailReachTiles: 0.45,
  tailSagTiles: 0.05,
  minFloorSamples: 4,
  floorShadowDropTiles: 0.06,
  floorShadowLengthShare: 0.55,
  floorShadowHeightTiles: 0.06,
  floorShadowAlphaShare: 0.6,
  pegRowMin: 0.25,
  pegRowMax: 0.35,
  pegInsetShare: 0.18,
  pegShadowDropPx: 2,
  pegShadowWidthRadii: 1.6,
  hangMaxDropShare: 0.55,
  hangDropScale: 1.4,
  leftSwingShare: 0.22,
  rightDropShare: 0.6,
  rightSwingShare: -0.12,
  floorInsetShare: 0.2,
  openingInsetTiles: 0.12,
  leftHalfReach: 0.45,
  rightHalfReach: 0.42,
  leftHalfLiftTiles: 0.05,
  rightHalfDropTiles: 0.08,
} as const;

/** A rope hanging from `from` under its own weight, ending in a fray. */
function hangingEnd(job: DamageJob, from: Point, length: number, swing: number, rng: Rng): void {
  const ts = job.box.tilePx;
  const end = { x: from.x + swing, y: from.y + length };
  const mid = { x: from.x + swing * ROPE.hangMidSwing, y: from.y + length * ROPE.hangMidDrop };
  drawRope(job.ctx, [from, mid, end], ts * ROPE.widthTiles, job.palette.rope, job.palette.ink);
  drawFray(
    job.ctx,
    end.x,
    end.y,
    Math.PI / 2 + swing / length,
    ts * ROPE.frayTiles,
    job.palette.rope,
    rng,
    ts,
  );
}

/** Loose turns of a lashing round a member at `at`, the member running along `angle`. */
function looseLashing(job: DamageJob, at: Point, angle: number): void {
  const ts = job.box.tilePx;
  const width = ts * ROPE.widthTiles;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const across = { x: -along.y, y: along.x };
  const reach = ts * ROPE.poleWidthTiles * ROPE.lashReachShare;
  for (let wrap = 0; wrap < ROPE.lashingWraps; wrap++) {
    const offset = (wrap - (ROPE.lashingWraps - 1) / 2) * width * ROPE.wrapSpacingWidths;
    const slack = wrap * width * ROPE.wrapSlackWidths;
    const centre = { x: at.x + along.x * offset, y: at.y + along.y * offset };
    drawRope(
      job.ctx,
      [
        {
          x: centre.x - across.x * reach - along.x * width,
          y: centre.y - across.y * reach - along.y * width,
        },
        {
          x: centre.x + across.x * reach + along.x * width + slack,
          y: centre.y + across.y * reach + along.y * width + slack,
        },
      ],
      width,
      job.palette.rope,
      job.palette.ink,
    );
  }
}

function paintRopeProp(job: DamageJob, box: DamageBox): void {
  const rng = stream(job.seed, Part.Rope);
  const ts = box.tilePx;
  const lean = range(rng, ROPE.poleLeanMin, ROPE.poleLeanMax) * (rng() < 1 / 2 ? -1 : 1);
  const footX = box.left + box.width * (lean > 0 ? ROPE.poleFootLeft : ROPE.poleFootRight);
  const foot = { x: footX, y: footY(box) };
  const length = Math.min(box.height * ROPE.poleMaxHeightShare, ts * ROPE.poleMaxLengthTiles);
  const angle = -Math.PI / 2 + lean;
  const top = { x: foot.x + Math.cos(angle) * length, y: foot.y + Math.sin(angle) * length };
  contactShadow(
    job.ctx,
    foot.x,
    foot.y,
    ts * ROPE.poleShadowWidthTiles,
    ts * ROPE.poleShadowHeightTiles,
    job.palette.ink,
    ROPE.shadowAlpha,
  );
  drawBoard(
    job.ctx,
    (foot.x + top.x) / 2,
    (foot.y + top.y) / 2,
    length,
    ts * ROPE.poleWidthTiles,
    angle,
    rng,
    {
      ramp: job.palette.wood,
      freshBreak: job.palette.freshBreak,
      ink: job.palette.ink,
      brokenEnd: 'none',
      tilePx: ts,
    },
  );
  const lashAt = {
    x: foot.x + (top.x - foot.x) * ROPE.upperLashShare,
    y: foot.y + (top.y - foot.y) * ROPE.upperLashShare,
  };
  looseLashing(job, lashAt, angle);
  const fray = stream(job.seed, Part.Fray);
  hangingEnd(
    job,
    { x: lashAt.x + ts * ROPE.hangOffsetXTiles, y: lashAt.y + ts * ROPE.hangOffsetYTiles },
    ts * ROPE.hangTiles,
    ts * ROPE.hangSwingTiles * (lean > 0 ? 1 : -1),
    fray,
  );
  const lowAt = {
    x: foot.x + (top.x - foot.x) * ROPE.lowerLashShare,
    y: foot.y + (top.y - foot.y) * ROPE.lowerLashShare,
  };
  const tailEnd = {
    x: Math.min(
      right(box) - ts * ROPE.tailEdgeClearTiles,
      Math.max(
        box.left + ts * ROPE.tailEdgeClearTiles,
        lowAt.x + (lean > 0 ? 1 : -1) * ts * ROPE.tailReachTiles,
      ),
    ),
    y: footY(box),
  };
  drawRope(
    job.ctx,
    [lowAt, { x: (lowAt.x + tailEnd.x) / 2, y: tailEnd.y - ts * ROPE.tailSagTiles }, tailEnd],
    ts * ROPE.widthTiles,
    job.palette.rope,
    job.palette.ink,
  );
  drawFray(
    job.ctx,
    tailEnd.x,
    tailEnd.y,
    lean > 0 ? 0 : Math.PI,
    ts * ROPE.frayTiles,
    job.palette.rope,
    fray,
    ts,
  );
}

function paintRopeOnFloor(
  job: DamageJob,
  box: DamageBox,
  fromX: number,
  toX: number,
  y: number,
): void {
  const rng = stream(job.seed, Part.Rope + Part.Debris);
  const ts = box.tilePx;
  const points: Point[] = [];
  const samples = Math.max(
    ROPE.minFloorSamples,
    Math.round(Math.abs(toX - fromX) / (ts * ROPE.curveSampleTiles)),
  );
  const phase = range(rng, 0, Math.PI * 2);
  const amplitude = ts * ROPE.lieAmplitudeTiles;
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    points.push({
      x: fromX + (toX - fromX) * t,
      y: y + Math.sin(phase + t * ROPE.lieWaves * Math.PI * 2) * amplitude,
    });
  }
  contactShadow(
    job.ctx,
    (fromX + toX) / 2,
    y + ts * ROPE.floorShadowDropTiles,
    Math.abs(toX - fromX) * ROPE.floorShadowLengthShare,
    ts * ROPE.floorShadowHeightTiles,
    job.palette.ink,
    ROPE.shadowAlpha * ROPE.floorShadowAlphaShare,
  );
  drawRope(job.ctx, points, ts * ROPE.widthTiles, job.palette.rope, job.palette.ink);
  const end = points[points.length - 1];
  drawFray(
    job.ctx,
    end.x,
    end.y,
    toX > fromX ? 0 : Math.PI,
    ts * ROPE.frayTiles,
    job.palette.rope,
    rng,
    ts,
  );
}

function paintRopeWall(job: DamageJob, box: DamageBox): void {
  const body = wallBody(box);
  const rng = stream(job.seed, Part.Rope);
  const ts = box.tilePx;
  const pegY = body.top + body.height * range(rng, ROPE.pegRowMin, ROPE.pegRowMax);
  const pegs = [
    body.left + body.width * ROPE.pegInsetShare,
    right(body) - body.width * ROPE.pegInsetShare,
  ];
  for (const x of pegs) {
    contactShadow(
      job.ctx,
      x + screenPx(ts),
      pegY + screenPx(ts) * ROPE.pegShadowDropPx,
      ts * ROPE.pegRadiusTiles * ROPE.pegShadowWidthRadii,
      ts * ROPE.pegRadiusTiles,
      job.palette.ink,
      ROPE.shadowAlpha,
    );
    drawChunk(
      job.ctx,
      x,
      pegY,
      ts * ROPE.pegRadiusTiles,
      rng,
      job.palette.wood,
      job.palette.ink,
      ts,
    );
  }
  const fray = stream(job.seed, Part.Fray);
  const drop = Math.min(
    body.height * ROPE.hangMaxDropShare,
    ts * ROPE.hangTiles * ROPE.hangDropScale,
  );
  const gap = pegs[1] - pegs[0];
  hangingEnd(job, { x: pegs[0], y: pegY }, drop, gap * ROPE.leftSwingShare, fray);
  hangingEnd(
    job,
    { x: pegs[1], y: pegY },
    drop * ROPE.rightDropShare,
    gap * ROPE.rightSwingShare,
    fray,
  );
  shadeTowardCap(job.ctx, box, job.palette.ink);
}

function paintRope(job: DamageJob): void {
  const { box } = job;
  const ts = box.tilePx;
  const mid = box.top + box.height / 2;
  switch (job.surface) {
    case 'prop':
      paintRopeProp(job, box);
      return;
    case 'wall':
      paintRopeWall(job, box);
      return;
    case 'floor':
      paintRopeOnFloor(
        job,
        box,
        box.left + box.width * ROPE.floorInsetShare,
        right(box) - box.width * ROPE.floorInsetShare,
        mid,
      );
      return;
    case 'doorway':
    case 'open_side':
      paintRopeOnFloor(
        job,
        box,
        box.left + ts * ROPE.openingInsetTiles,
        box.left + box.width * ROPE.leftHalfReach,
        mid - ts * ROPE.leftHalfLiftTiles,
      );
      paintRopeOnFloor(
        job,
        box,
        right(box) - ts * ROPE.openingInsetTiles,
        right(box) - box.width * ROPE.rightHalfReach,
        mid + ts * ROPE.rightHalfDropTiles,
      );
      return;
  }
}

// ── Plaster ───────────────────────────────────────────────────────────────────

const PLASTER = {
  patchRadiusMinTiles: 0.32,
  patchRadiusMaxTiles: 0.5,
  patchSquash: 0.72,
  patchVertices: 11,
  patchJitter: 0.28,
  /** Behind the laths: the dark of the wall's cavity, mixed with what is under it. */
  cavityAlpha: 0.72,
  lathTiles: 0.085,
  lathGapTiles: 0.055,
  rimLitAlpha: 0.55,
  rimShadeAlpha: 0.5,
  rimWidthPx: 1.4,
  hairlines: 3,
  hairlineAlpha: 0.45,
  hairlineWidthPx: 1,
  crumbChunks: 3,
  crumbCount: 9,
  dustAlpha: 0.22,
  chunkRadiusTiles: 0.07,
  maxRadiusWidthShare: 0.38,
  maxRadiusHeightShare: 0.36,
  placeMin: 0.2,
  placeMax: 0.8,
  rowMin: 0.25,
  rowMax: 0.55,
  /** Laths run past the hole on every side so the clip, not the lath, makes the edge. */
  lathOverrunY: 1.3,
  lathOverrunX: 1.4,
  lathSpanRadii: 2.8,
  lathTiltPx: 0.6,
  lathToneMin: 0.45,
  lathToneMax: 0.6,
  lathLitTone: 0.95,
  lathLitAlpha: 0.8,
  keyTone: 0.4,
  keyAlpha: 0.85,
  keysMax: 2,
  keyWidthMinTiles: 0.06,
  keyWidthMaxTiles: 0.12,
  keyHeightShare: 0.8,
  rimLighten: 0.2,
  hairReachMin: 0.5,
  hairKinks: 3,
  hairWobbleTiles: 0.03,
  hairLipLighten: 0.3,
  crumbSpreadShare: 0.4,
  crumbSpreadTiles: 0.45,
  dustHeightTiles: 0.07,
  dustLighten: 0.2,
  chunkSpreadShare: 0.7,
  chunkLiftTiles: 0.02,
  chunkSizeMin: 0.7,
  chunkSizeMax: 1.3,
  crumbSpreadYTiles: 0.04,
} as const;

const PLASTER_FLOOR = {
  dustAlpha: 0.14,
  chunks: 4,
  spreadShare: 0.4,
  spreadTiles: 0.55,
  dustSquash: 0.5,
  dustLighten: 0.3,
  chunkSpreadX: 0.6,
  chunkSpreadY: 0.25,
  chunkSizeMin: 0.6,
  chunkSizeMax: 1.1,
  crumbSpreadX: 0.8,
  crumbSpreadY: 0.3,
  /** An opening's crumbs pile against each jamb. */
  jambInsetTiles: 0.45,
  leftPileRow: 0.55,
  rightPileRow: 0.6,
} as const;

function patchOutline(rng: Rng, cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < PLASTER.patchVertices; index++) {
    const angle = (index / PLASTER.patchVertices) * Math.PI * 2;
    const jitter = 1 + range(rng, -PLASTER.patchJitter, PLASTER.patchJitter);
    points.push({ x: cx + Math.cos(angle) * rx * jitter, y: cy + Math.sin(angle) * ry * jitter });
  }
  return points;
}

function tracePolygon(ctx: Ctx, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((point, index) =>
    index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
  );
  ctx.closePath();
}

/** Where plaster has fallen away: the cavity, the laths across it, and the broken skin's rim. */
function paintFlakedPatch(job: DamageJob, body: DamageBox): Point {
  const { ctx, palette } = job;
  const rng = stream(job.seed, Part.Patch);
  const ts = body.tilePx;
  const rx = Math.min(
    body.width * PLASTER.maxRadiusWidthShare,
    ts * range(rng, PLASTER.patchRadiusMinTiles, PLASTER.patchRadiusMaxTiles),
  );
  const ry = Math.min(body.height * PLASTER.maxRadiusHeightShare, rx * PLASTER.patchSquash);
  const cx =
    body.left + rx + (body.width - rx * 2) * range(rng, PLASTER.placeMin, PLASTER.placeMax);
  const cy = body.top + ry + (body.height - ry * 2) * range(rng, PLASTER.rowMin, PLASTER.rowMax);
  const outline = patchOutline(rng, cx, cy, rx, ry);
  const unit = screenPx(ts);
  ctx.save();
  tracePolygon(ctx, outline);
  ctx.fillStyle = rgba(palette.ink, PLASTER.cavityAlpha);
  ctx.fill();
  ctx.clip();
  const lathRng = stream(job.seed, Part.Lath);
  const lathH = ts * PLASTER.lathTiles;
  const pitch = lathH + ts * PLASTER.lathGapTiles;
  const lathLeft = cx - rx * PLASTER.lathOverrunX;
  const lathRight = cx + rx * PLASTER.lathOverrunX;
  for (let y = cy - ry * PLASTER.lathOverrunY; y < cy + ry * PLASTER.lathOverrunY; y += pitch) {
    const tilt = range(lathRng, -PLASTER.lathTiltPx, PLASTER.lathTiltPx) * unit;
    ctx.fillStyle = rgba(
      sampleRamp(palette.lath, range(lathRng, PLASTER.lathToneMin, PLASTER.lathToneMax)),
      1,
    );
    ctx.beginPath();
    ctx.moveTo(lathLeft, y + tilt);
    ctx.lineTo(lathRight, y - tilt);
    ctx.lineTo(lathRight, y - tilt + lathH);
    ctx.lineTo(lathLeft, y + tilt + lathH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(sampleRamp(palette.lath, PLASTER.lathLitTone), PLASTER.lathLitAlpha);
    ctx.fillRect(lathLeft, y + Math.min(tilt, -tilt), rx * PLASTER.lathSpanRadii, unit);
    // Keys of plaster still squeezed between the laths.
    ctx.fillStyle = rgba(sampleRamp(palette.plaster, PLASTER.keyTone), PLASTER.keyAlpha);
    const keys = rangeInt(lathRng, 1, PLASTER.keysMax);
    for (let key = 0; key < keys; key++) {
      ctx.fillRect(
        cx + range(lathRng, -rx, rx),
        y + lathH,
        ts * range(lathRng, PLASTER.keyWidthMinTiles, PLASTER.keyWidthMaxTiles),
        ts * PLASTER.lathGapTiles * PLASTER.keyHeightShare,
      );
    }
  }
  ctx.restore();
  // The broken edge of the skin: lit along its lower right, where its thickness faces the light.
  ctx.save();
  ctx.lineJoin = 'round';
  tracePolygon(
    ctx,
    outline.map((p) => ({ x: p.x + unit, y: p.y + unit })),
  );
  ctx.strokeStyle = rgba(
    lifted(sampleRamp(palette.plaster, 1), PLASTER.rimLighten),
    PLASTER.rimLitAlpha,
  );
  ctx.lineWidth = unit * PLASTER.rimWidthPx;
  ctx.stroke();
  tracePolygon(ctx, outline);
  ctx.strokeStyle = rgba(palette.ink, PLASTER.rimShadeAlpha);
  ctx.lineWidth = unit;
  ctx.stroke();
  ctx.restore();
  const hairRng = stream(job.seed, Part.Cracks);
  for (let line = 0; line < PLASTER.hairlines; line++) {
    const from = outline[rangeInt(hairRng, 0, outline.length - 1)];
    const away = { x: from.x - cx, y: from.y - cy };
    const reach = range(hairRng, PLASTER.hairReachMin, 1);
    const to = {
      x: Math.min(right(body) - unit, Math.max(body.left + unit, from.x + away.x * reach)),
      y: Math.min(bottom(body) - unit, Math.max(body.top + unit, from.y + away.y * reach)),
    };
    strokeGroove(
      ctx,
      jaggedLine(hairRng, from, to, PLASTER.hairKinks, ts * PLASTER.hairWobbleTiles),
      unit * PLASTER.hairlineWidthPx,
      palette.ink,
      PLASTER.hairlineAlpha,
      lifted(sampleRamp(palette.plaster, 1), PLASTER.hairLipLighten),
      PLASTER.hairlineAlpha * (1 / 2),
      ts,
    );
  }
  return { x: cx, y: cy };
}

function paintPlasterCrumbs(job: DamageJob, box: DamageBox, x: number, dustAlpha: number): void {
  const rng = stream(job.seed, Part.Debris);
  const ts = box.tilePx;
  const y = footY(box);
  const spread = Math.min(box.width * PLASTER.crumbSpreadShare, ts * PLASTER.crumbSpreadTiles);
  const cx = Math.min(right(box) - spread, Math.max(box.left + spread, x));
  contactShadow(
    job.ctx,
    cx,
    y,
    spread,
    ts * PLASTER.dustHeightTiles,
    lifted(sampleRamp(job.palette.plaster, 1), PLASTER.dustLighten),
    dustAlpha,
  );
  for (let chunk = 0; chunk < PLASTER.crumbChunks; chunk++) {
    drawChunk(
      job.ctx,
      cx + range(rng, -spread, spread) * PLASTER.chunkSpreadShare,
      y - ts * PLASTER.chunkLiftTiles,
      ts * PLASTER.chunkRadiusTiles * range(rng, PLASTER.chunkSizeMin, PLASTER.chunkSizeMax),
      rng,
      job.palette.plaster,
      job.palette.ink,
      ts,
    );
  }
  drawCrumbs(
    job.ctx,
    cx,
    y,
    spread,
    ts * PLASTER.crumbSpreadYTiles,
    PLASTER.crumbCount,
    rng,
    job.palette.plaster,
    ts,
  );
}

function paintFallenPlasterOnFloor(job: DamageJob, box: DamageBox, x: number, y: number): void {
  const rng = stream(job.seed, Part.Debris + Part.Patch);
  const ts = box.tilePx;
  const spread = Math.min(box.width * PLASTER_FLOOR.spreadShare, ts * PLASTER_FLOOR.spreadTiles);
  contactShadow(
    job.ctx,
    x,
    y,
    spread,
    spread * PLASTER_FLOOR.dustSquash,
    lifted(sampleRamp(job.palette.plaster, 1), PLASTER_FLOOR.dustLighten),
    PLASTER_FLOOR.dustAlpha,
  );
  for (let chunk = 0; chunk < PLASTER_FLOOR.chunks; chunk++) {
    drawChunk(
      job.ctx,
      x + range(rng, -spread, spread) * PLASTER_FLOOR.chunkSpreadX,
      y + range(rng, -spread, spread) * PLASTER_FLOOR.chunkSpreadY,
      ts *
        PLASTER.chunkRadiusTiles *
        range(rng, PLASTER_FLOOR.chunkSizeMin, PLASTER_FLOOR.chunkSizeMax),
      rng,
      job.palette.plaster,
      job.palette.ink,
      ts,
    );
  }
  drawCrumbs(
    job.ctx,
    x,
    y,
    spread * PLASTER_FLOOR.crumbSpreadX,
    spread * PLASTER_FLOOR.crumbSpreadY,
    PLASTER.crumbCount,
    rng,
    job.palette.plaster,
    ts,
  );
}

function paintPlaster(job: DamageJob): void {
  const { box } = job;
  const ts = box.tilePx;
  switch (job.surface) {
    case 'prop': {
      const patch = paintFlakedPatch(job, box);
      paintPlasterCrumbs(job, box, patch.x, PLASTER.dustAlpha);
      return;
    }
    case 'wall': {
      const body = wallBody(box);
      const patch = paintFlakedPatch(job, body);
      shadeTowardCap(job.ctx, box, job.palette.ink);
      paintPlasterCrumbs(job, box, patch.x, PLASTER.dustAlpha);
      return;
    }
    case 'floor':
      paintFallenPlasterOnFloor(job, box, box.left + box.width / 2, box.top + box.height / 2);
      return;
    case 'doorway':
    case 'open_side':
      paintFallenPlasterOnFloor(
        job,
        box,
        box.left + ts * PLASTER_FLOOR.jambInsetTiles,
        box.top + box.height * PLASTER_FLOOR.leftPileRow,
      );
      paintFallenPlasterOnFloor(
        job,
        box,
        right(box) - ts * PLASTER_FLOOR.jambInsetTiles,
        box.top + box.height * PLASTER_FLOOR.rightPileRow,
      );
      return;
  }
}

const PAINTERS: Record<ContractArtMaterial, (job: DamageJob) => void> = {
  wood: paintWood,
  stone: paintStone,
  rope: paintRope,
  plaster: paintPlaster,
};

/** Paints one spot's damage into `job.box`. */
export function paintContractDamage(job: DamageJob, material: ContractArtMaterial): void {
  PAINTERS[material](job);
}
