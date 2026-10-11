/**
 * The clogged bathroom's fittings: the stall row and the pipe access panel hung
 * on the north wall face, the wall sinks, the plunger and the puddles.
 *
 * Every painter takes the anchor tile's top-left corner and the tile size it is
 * painting at, so the same code paints a sheet cell at the sheet's scale and a
 * live overlay at the game's. The stall and the pipe panel are anchored on the
 * floor tile at the foot of the face they hang on and paint upward over that
 * face, from just under its lit cap down to the floor line; nothing they paint
 * reaches onto the walkable floor beyond a thin threshold shadow.
 *
 * The wall face is darker than the washroom floor in front of it, as every
 * dungeon face is, so the tiled back wall, the partitions and the panel all sit
 * in the face's value range and the white PVC is the brightest thing on it.
 */

import { WALL_FACE_RISE_TILES } from '../../map/dungeon/wallLight';
import { CAP_TILES } from './dungeonWallGeometry';
import { mulberry32 } from '../person/rng';
import { worldText } from '../../ui/world/worldText';

type Ctx = CanvasRenderingContext2D;

export type StallDoor = 'open' | 'shut';
export type StallTag = 'vacant' | 'occupied';
/** Which side wall a sink hangs on. */
export type SinkSide = 'west' | 'east';

/** Tiles across one stall: its door tile and the tile east of it. */
export const STALL_ART_WIDTH_TILES = 2;
/** How far the face rises above the floor line to the foot of its cap, which nothing here paints over. */
export const FACE_BODY_RISE_TILES = WALL_FACE_RISE_TILES - CAP_TILES;
/** The thin threshold shadow a stall and the panel cast onto the floor at their foot. */
export const FACE_FOOT_LIP_TILES = 0.12;

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const DOUBLE = 2;
/** Outlines are one source pixel at the sheet's 64 px tile, and never thinner than a screen pixel. */
const OUTLINES_PER_TILE = 64;
/** A screw's rim is finer than an outline. */
const FINE_LINES_PER_TILE = 96;
/** The contact shadow under a free-standing fitting. */
const CONTACT_SHADOW_RGB = '8,12,12';
const CONTACT_SHADOW_ALPHA = 0.45;

function outline(ts: number): number {
  return Math.max(1, ts / OUTLINES_PER_TILE);
}

// ── Shared paint ────────────────────────────────────────────────────────────

function fillRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function verticalFill(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  top: string,
  bottom: string,
): void {
  const gradient = ctx.createLinearGradient(0, y, 0, y + h);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
}

function strokeRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x + width * HALF, y + width * HALF, w - width, h - width);
}

function roundedRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w * HALF, h * HALF);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** A radial blot that fades to nothing at its rim: shadows, stains, sheen. */
function softEllipse(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: string,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(Math.max(rx, Number.EPSILON), Math.max(ry, Number.EPSILON));
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

// ── The tiled wall behind the fittings ──────────────────────────────────────

/** Glazed wall tile, a step darker than the floor's mosaic so the face still reads as a face. */
const WALL_TILE = {
  top: '#7f948d',
  bottom: '#62766f',
  grout: 'rgba(36,48,44,0.45)',
  glaze: 'rgba(214,232,224,0.16)',
  skirting: '#262c2b',
  skirtingEdge: '#5a6662',
} as const;
/** Wall tiles across one game tile. */
const WALL_TILES_PER_TILE = 4;
const WALL_GROUT_TILES = 0.018;
const WALL_SKIRTING_TILES = 0.07;
const WALL_SKIRTING_EDGE_TILES = 0.015;

/** The tiled wall over one stretch of face, from the cap's foot to the floor line. */
function paintTiledWall(ctx: Ctx, left: number, floorY: number, width: number, ts: number): void {
  const top = floorY - FACE_BODY_RISE_TILES * ts;
  const height = FACE_BODY_RISE_TILES * ts;
  verticalFill(ctx, left, top, width, height, WALL_TILE.top, WALL_TILE.bottom);
  const pitch = ts / WALL_TILES_PER_TILE;
  const grout = Math.max(1, WALL_GROUT_TILES * ts);
  ctx.fillStyle = WALL_TILE.grout;
  for (let y = floorY - pitch; y > top; y -= pitch) ctx.fillRect(left, y, width, grout);
  for (let x = left; x < left + width; x += pitch) ctx.fillRect(x, top, grout, height);
  ctx.fillStyle = WALL_TILE.glaze;
  for (let y = floorY - pitch; y > top; y -= pitch) ctx.fillRect(left, y + grout, width, grout);
  const skirting = WALL_SKIRTING_TILES * ts;
  fillRect(ctx, left, floorY - skirting, width, skirting, WALL_TILE.skirting);
  fillRect(
    ctx,
    left,
    floorY - skirting,
    width,
    Math.max(1, WALL_SKIRTING_EDGE_TILES * ts),
    WALL_TILE.skirtingEdge,
  );
}

/** The soft shadow a fitting casts onto the floor at the foot of the face. */
function paintFootShadow(ctx: Ctx, left: number, floorY: number, width: number, ts: number): void {
  verticalFill(
    ctx,
    left,
    floorY,
    width,
    FACE_FOOT_LIP_TILES * ts,
    'rgba(10,14,14,0.35)',
    'rgba(10,14,14,0)',
  );
}

// ── Stalls ──────────────────────────────────────────────────────────────────

/** Powder-coated partition steel: a faded institutional teal. */
const PARTITION = {
  face: '#46645f',
  faceLow: '#37504c',
  edge: '#7a9a93',
  shade: '#2a3c39',
  outline: '#16201e',
} as const;
const DOOR = {
  top: '#507069',
  bottom: '#3c5651',
  edge: '#86a59e',
  shade: '#2c403c',
} as const;
const CHROME = { light: '#d9dee0', mid: '#9aa3a6', dark: '#525b5e' } as const;
const STALL_INTERIOR = {
  top: '#1b2423',
  bottom: '#3a4a46',
  floorGap: '#0e1312',
} as const;
const PORCELAIN = {
  light: '#f2f1ea',
  mid: '#d5d6cf',
  shade: '#a9aca6',
  outline: '#5e6360',
  water: '#8fa7a6',
} as const;

/** Rises are measured up from the floor line, in tiles. */
const STALL = {
  headrailRise: 1.4,
  headrailHeight: 0.06,
  pilasterWidth: 0.11,
  pilasterInset: 0.015,
  doorTopRise: 1.3,
  doorBottomRise: 0.13,
  doorSideGap: 0.025,
  doorBevel: 0.025,
  pilasterEdge: 0.05,
  shoeHeight: 0.06,
  hingeHeight: 0.09,
  hingeWidth: 0.035,
  hingeRises: [1.12, 0.36],
  latchRise: 0.74,
  latchInset: 0.08,
  tagWidth: 0.34,
  tagHeight: 0.12,
  tagTextSize: 0.085,
  tagBezel: 0.018,
  openDoorWidth: 0.3,
  openDoorSkew: 0.1,
  toiletCentre: 0.5,
  toiletTankWidth: 0.42,
  toiletTankRise: 0.98,
  toiletTankHeight: 0.24,
  toiletBowlRx: 0.27,
  toiletBowlRy: 0.1,
  toiletBowlRise: 0.42,
  toiletBaseWidth: 0.2,
  paperRollRise: 0.62,
  paperRollRadius: 0.06,
} as const;

const TAG_INK = {
  vacant: { window: '#2f9e4a', text: '#eafff0' },
  occupied: { window: '#c7302b', text: '#fff1ee' },
} as const satisfies Record<StallTag, { window: string; text: string }>;
const TAG_WORD = { vacant: 'VACANT', occupied: 'OCCUPIED' } as const satisfies Record<
  StallTag,
  string
>;

interface StallFrame {
  readonly left: number;
  readonly right: number;
  readonly floorY: number;
  readonly doorLeft: number;
  readonly doorRight: number;
  readonly doorTop: number;
  readonly doorBottom: number;
}

function stallFrame(ox: number, oy: number, ts: number): StallFrame {
  const left = ox;
  const right = ox + STALL_ART_WIDTH_TILES * ts;
  const jamb = (STALL.pilasterInset + STALL.pilasterWidth + STALL.doorSideGap) * ts;
  return {
    left,
    right,
    floorY: oy,
    doorLeft: left + jamb,
    doorRight: right - jamb,
    doorTop: oy - STALL.doorTopRise * ts,
    doorBottom: oy - STALL.doorBottomRise * ts,
  };
}

function paintPilaster(ctx: Ctx, x: number, frame: StallFrame, ts: number): void {
  const width = STALL.pilasterWidth * ts;
  const top = frame.floorY - STALL.headrailRise * ts;
  const height = frame.floorY - top;
  verticalFill(ctx, x, top, width, height, PARTITION.face, PARTITION.faceLow);
  fillRect(ctx, x, top, Math.max(1, STALL.pilasterEdge * ts), height, PARTITION.edge);
  fillRect(
    ctx,
    x + width - Math.max(1, ts * STALL.doorBevel),
    top,
    ts * STALL.doorBevel,
    height,
    PARTITION.shade,
  );
  const shoe = STALL.shoeHeight * ts;
  verticalFill(ctx, x, frame.floorY - shoe, width, shoe, CHROME.light, CHROME.dark);
  strokeRect(ctx, x, top, width, height, PARTITION.outline, outline(ts));
}

function paintHeadrail(ctx: Ctx, frame: StallFrame, ts: number): void {
  const top = frame.floorY - STALL.headrailRise * ts;
  const height = STALL.headrailHeight * ts;
  verticalFill(ctx, frame.left, top, frame.right - frame.left, height, CHROME.light, CHROME.dark);
  fillRect(ctx, frame.left, top + height, frame.right - frame.left, outline(ts), PARTITION.outline);
}

/** The dark inside of a stall, seen past an open door or under a shut one. */
function paintInterior(ctx: Ctx, frame: StallFrame, ts: number, withToilet: boolean): void {
  const top = frame.floorY - STALL.headrailRise * ts;
  verticalFill(
    ctx,
    frame.doorLeft,
    top,
    frame.doorRight - frame.doorLeft,
    frame.floorY - top,
    STALL_INTERIOR.top,
    STALL_INTERIOR.bottom,
  );
  if (!withToilet) return;
  const cx = frame.left + STALL.toiletCentre * (frame.right - frame.left);
  const tankWidth = STALL.toiletTankWidth * ts;
  const tankTop = frame.floorY - STALL.toiletTankRise * ts;
  const tankHeight = STALL.toiletTankHeight * ts;
  roundedRectPath(ctx, cx - tankWidth * HALF, tankTop, tankWidth, tankHeight, ts * STALL.doorBevel);
  const tankFill = ctx.createLinearGradient(0, tankTop, 0, tankTop + tankHeight);
  tankFill.addColorStop(0, PORCELAIN.mid);
  tankFill.addColorStop(1, PORCELAIN.shade);
  ctx.fillStyle = tankFill;
  ctx.fill();
  ctx.strokeStyle = PORCELAIN.outline;
  ctx.lineWidth = outline(ts);
  ctx.stroke();
  const baseWidth = STALL.toiletBaseWidth * ts;
  const bowlY = frame.floorY - STALL.toiletBowlRise * ts;
  verticalFill(
    ctx,
    cx - baseWidth * HALF,
    bowlY,
    baseWidth,
    frame.floorY - bowlY,
    PORCELAIN.mid,
    PORCELAIN.shade,
  );
  ctx.beginPath();
  ctx.ellipse(cx, bowlY, STALL.toiletBowlRx * ts, STALL.toiletBowlRy * ts, 0, 0, FULL_TURN);
  ctx.fillStyle = PORCELAIN.light;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    cx,
    bowlY,
    STALL.toiletBowlRx * ts * HALF,
    STALL.toiletBowlRy * ts * HALF,
    0,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = PORCELAIN.water;
  ctx.fill();
  const rollX = frame.doorRight - STALL.paperRollRadius * ts * DOUBLE;
  const rollY = frame.floorY - STALL.paperRollRise * ts;
  ctx.beginPath();
  ctx.arc(rollX, rollY, STALL.paperRollRadius * ts, 0, FULL_TURN);
  ctx.fillStyle = PORCELAIN.light;
  ctx.fill();
  ctx.stroke();
}

function paintTag(ctx: Ctx, cx: number, cy: number, ts: number, tag: StallTag): void {
  const width = STALL.tagWidth * ts;
  const height = STALL.tagHeight * ts;
  const bezel = Math.max(1, STALL.tagBezel * ts);
  roundedRectPath(
    ctx,
    cx - width * HALF - bezel,
    cy - height * HALF - bezel,
    width + bezel * DOUBLE,
    height + bezel * DOUBLE,
    bezel * DOUBLE,
  );
  ctx.fillStyle = CHROME.mid;
  ctx.fill();
  ctx.strokeStyle = CHROME.dark;
  ctx.lineWidth = outline(ts);
  ctx.stroke();
  fillRect(ctx, cx - width * HALF, cy - height * HALF, width, height, TAG_INK[tag].window);
  worldText(ctx, TAG_WORD[tag], {
    x: cx,
    y: cy,
    size: STALL.tagTextSize * ts,
    bold: true,
    color: TAG_INK[tag].text,
    outline: false,
    align: 'center',
    baseline: 'middle',
  });
}

function paintShutDoor(ctx: Ctx, frame: StallFrame, ts: number, tag: StallTag): void {
  const width = frame.doorRight - frame.doorLeft;
  const height = frame.doorBottom - frame.doorTop;
  verticalFill(ctx, frame.doorLeft, frame.doorTop, width, height, DOOR.top, DOOR.bottom);
  const bevel = Math.max(1, STALL.doorBevel * ts);
  fillRect(ctx, frame.doorLeft, frame.doorTop, width, bevel, DOOR.edge);
  fillRect(ctx, frame.doorLeft, frame.doorTop, bevel, height, DOOR.edge);
  fillRect(ctx, frame.doorLeft, frame.doorBottom - bevel, width, bevel, DOOR.shade);
  fillRect(ctx, frame.doorRight - bevel, frame.doorTop, bevel, height, DOOR.shade);
  strokeRect(ctx, frame.doorLeft, frame.doorTop, width, height, PARTITION.outline, outline(ts));
  for (const rise of STALL.hingeRises) {
    const y = frame.floorY - rise * ts;
    verticalFill(
      ctx,
      frame.doorLeft - STALL.hingeWidth * ts * HALF,
      y,
      STALL.hingeWidth * ts,
      STALL.hingeHeight * ts,
      CHROME.light,
      CHROME.dark,
    );
  }
  const tagX = frame.doorRight - (STALL.latchInset + STALL.tagWidth * HALF) * ts;
  paintTag(ctx, tagX, frame.floorY - STALL.latchRise * ts, ts, tag);
}

/** The door swung in on its west hinges: a narrow foreshortened slab against the west pilaster. */
function paintOpenDoor(ctx: Ctx, frame: StallFrame, ts: number, tag: StallTag): void {
  const skew = STALL.openDoorSkew * ts;
  const width = STALL.openDoorWidth * ts;
  ctx.beginPath();
  ctx.moveTo(frame.doorLeft, frame.doorTop);
  ctx.lineTo(frame.doorLeft + width, frame.doorTop + skew);
  ctx.lineTo(frame.doorLeft + width, frame.doorBottom - skew * HALF);
  ctx.lineTo(frame.doorLeft, frame.doorBottom);
  ctx.closePath();
  const fill = ctx.createLinearGradient(frame.doorLeft, 0, frame.doorLeft + width, 0);
  fill.addColorStop(0, DOOR.top);
  fill.addColorStop(1, DOOR.shade);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = PARTITION.outline;
  ctx.lineWidth = outline(ts);
  ctx.stroke();
  const tagCentreX = frame.doorLeft + width * HALF;
  const tagCentreY = frame.floorY - STALL.latchRise * ts + skew * HALF;
  ctx.save();
  ctx.translate(tagCentreX, tagCentreY);
  ctx.scale(width / (STALL.tagWidth * ts + STALL.tagBezel * ts * DOUBLE), 1);
  paintTag(ctx, 0, 0, ts, tag);
  ctx.restore();
}

/**
 * One stall of the row, anchored on its door tile: the tiled wall behind it,
 * the dark inside, its two pilasters, the headrail and the door.
 */
export function paintBathroomStall(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  door: StallDoor,
  tag: StallTag,
): void {
  const frame = stallFrame(ox, oy, ts);
  paintTiledWall(ctx, frame.left, frame.floorY, frame.right - frame.left, ts);
  paintInterior(ctx, frame, ts, door === 'open');
  verticalFill(
    ctx,
    frame.doorLeft,
    frame.doorBottom,
    frame.doorRight - frame.doorLeft,
    frame.floorY - frame.doorBottom,
    STALL_INTERIOR.floorGap,
    STALL_INTERIOR.floorGap,
  );
  if (door === 'shut') paintShutDoor(ctx, frame, ts, tag);
  else paintOpenDoor(ctx, frame, ts, tag);
  paintPilaster(ctx, frame.left + STALL.pilasterInset * ts, frame, ts);
  paintPilaster(ctx, frame.right - (STALL.pilasterInset + STALL.pilasterWidth) * ts, frame, ts);
  paintHeadrail(ctx, frame, ts);
  paintFootShadow(ctx, frame.left, frame.floorY, frame.right - frame.left, ts);
}

const SIGN = {
  widthShare: 0.8,
  height: 0.22,
  centreRise: 1.0,
  tilt: -0.05,
  textSize: 0.12,
  tapeWidth: 0.12,
  tapeHeight: 0.05,
  tapeTilt: 0.5,
  curlShade: 0.15,
} as const;
const PAPER = {
  face: '#ece6d2',
  edge: '#b9b19a',
  ink: '#8e1d16',
  tape: 'rgba(222,208,160,0.8)',
  shadow: 'rgba(0,0,0,0.3)',
} as const;
const SIGN_SHADOW_OFFSET_TILES = 0.02;

/** The paper "OUT OF ORDER" sign taped across a shut stall door. Painted alone, over the stall. */
export function paintOutOfOrderSign(ctx: Ctx, ox: number, oy: number, ts: number): void {
  const frame = stallFrame(ox, oy, ts);
  const width = (frame.doorRight - frame.doorLeft) * SIGN.widthShare;
  const height = SIGN.height * ts;
  const cx = (frame.doorLeft + frame.doorRight) * HALF;
  const cy = frame.floorY - SIGN.centreRise * ts;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(SIGN.tilt);
  const shadowOffset = SIGN_SHADOW_OFFSET_TILES * ts;
  fillRect(
    ctx,
    -width * HALF + shadowOffset,
    -height * HALF + shadowOffset,
    width,
    height,
    PAPER.shadow,
  );
  const paper = ctx.createLinearGradient(-width * HALF, 0, width * HALF, 0);
  paper.addColorStop(0, PAPER.face);
  paper.addColorStop(1 - SIGN.curlShade, PAPER.face);
  paper.addColorStop(1, PAPER.edge);
  ctx.fillStyle = paper;
  ctx.fillRect(-width * HALF, -height * HALF, width, height);
  strokeRect(ctx, -width * HALF, -height * HALF, width, height, PAPER.edge, outline(ts));
  worldText(ctx, 'OUT OF ORDER', {
    x: 0,
    y: 0,
    size: SIGN.textSize * ts,
    bold: true,
    color: PAPER.ink,
    outline: false,
    align: 'center',
    baseline: 'middle',
  });
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * width * HALF, -height * HALF);
    ctx.rotate(side * SIGN.tapeTilt);
    fillRect(
      ctx,
      -SIGN.tapeWidth * ts * HALF,
      -SIGN.tapeHeight * ts * HALF,
      SIGN.tapeWidth * ts,
      SIGN.tapeHeight * ts,
      PAPER.tape,
    );
    ctx.restore();
  }
  ctx.restore();
}

// ── Pipe wall ───────────────────────────────────────────────────────────────

/** Off-white PVC, the brightest thing on the face. */
const PVC = {
  edge: '#8f8a7a',
  shade: '#c6c0ae',
  body: '#ebe7da',
  shine: '#fffdf5',
  fitting: '#ddd8c7',
  fittingShade: '#b3ad99',
  outline: '#5d594d',
} as const;
const VALVE = {
  light: '#b8bec2',
  mid: '#868d92',
  dark: '#4d5357',
  outline: '#25292b',
} as const;
const PANEL = {
  frameLight: '#a7afb2',
  frameDark: '#5f686c',
  recessTop: '#151b1d',
  recessBottom: '#2b3437',
  screw: '#cfd5d7',
  wet: 'rgba(10,18,22,0.5)',
  wetSheen: 'rgba(150,190,205,0.35)',
  runnel: 'rgba(170,215,232,0.7)',
  poolRgb: '150,200,220',
  poolAlpha: 0.7,
} as const;

/** The panel and its pipes, as fractions of a tile across and rises above the floor line. */
const PIPE_PANEL = {
  left: 0.07,
  right: 0.93,
  bottomRise: 0.1,
  topRise: 1.5,
  frameWidth: 0.05,
  screwRadius: 0.018,
  screwInset: 0.025,
  pipeWidth: 0.14,
  fittingGrow: 1.35,
  fittingLength: 0.12,
  teeLengthShare: 1.4,
  mainX: 0.3,
  branchX: 0.7,
  teeRise: 1.06,
  couplingRise: 1.3,
  branchCouplingX: 0.5,
  valveRise: 0.68,
  valveWidth: 0.22,
  valveHeight: 0.13,
  leverLength: 0.2,
  leverWidth: 0.045,
  leakRise: 0.6,
  leakGap: 0.09,
  leakShift: 0.06,
  drainRise: 0.22,
  wetStreakWidth: 0.3,
  runnelWidth: 0.035,
  poolRx: 0.22,
  poolRy: 0.05,
} as const;

/** Where the broken joint drips from, as a fraction of a tile across and a rise above the floor line. */
export const PIPE_LEAK_POINT = {
  across: PIPE_PANEL.branchX + PIPE_PANEL.leakShift * HALF,
  rise: PIPE_PANEL.leakRise - PIPE_PANEL.leakGap,
} as const;

/** The access panel's opening, for a highlight that hugs it. In tiles from the anchor's top-left. */
export const PIPE_PANEL_BOUNDS = {
  left: PIPE_PANEL.left,
  right: PIPE_PANEL.right,
  topRise: PIPE_PANEL.topRise,
  bottomRise: PIPE_PANEL.bottomRise,
} as const;

/** Where the light falls across a pipe, as stops from its upper-left edge to its lower-right. */
const PVC_SHADING = { body: 0.18, shine: 0.32, bodyAgain: 0.55, shade: 0.85 } as const;
/** A fitting's own shading and shape, as shares of its girth. */
const FITTING_SHADING = {
  shine: 0.3,
  body: 0.6,
  cornerShare: 0.2,
  outlineShare: 0.1,
  elbowSwell: 1.15,
  elbowLightOffset: 0.2,
  elbowReach: 0.7,
} as const;
const VALVE_SHAPE = { cornerShare: 0.35, bossShare: 0.8 } as const;

/** A straight run of pipe, shaded across its own axis like a cylinder lit from the upper left. */
function pvcRun(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number): void {
  const vertical = x0 === x1;
  const half = width * HALF;
  const left = vertical ? x0 - half : Math.min(x0, x1);
  const top = vertical ? Math.min(y0, y1) : y0 - half;
  const w = vertical ? width : Math.abs(x1 - x0);
  const h = vertical ? Math.abs(y1 - y0) : width;
  const across = vertical
    ? ctx.createLinearGradient(left, 0, left + width, 0)
    : ctx.createLinearGradient(0, top, 0, top + width);
  across.addColorStop(0, PVC.edge);
  across.addColorStop(PVC_SHADING.body, PVC.body);
  across.addColorStop(PVC_SHADING.shine, PVC.shine);
  across.addColorStop(PVC_SHADING.bodyAgain, PVC.body);
  across.addColorStop(PVC_SHADING.shade, PVC.shade);
  across.addColorStop(1, PVC.edge);
  ctx.fillStyle = across;
  ctx.fillRect(left, top, w, h);
}

/** A fitting over a joint: a short sleeve a little fatter than the pipe. */
function pvcSleeve(
  ctx: Ctx,
  cx: number,
  cy: number,
  vertical: boolean,
  width: number,
  length: number,
): void {
  const fat = width * PIPE_PANEL.fittingGrow;
  const w = vertical ? fat : length;
  const h = vertical ? length : fat;
  const left = cx - w * HALF;
  const top = cy - h * HALF;
  const across = vertical
    ? ctx.createLinearGradient(left, 0, left + w, 0)
    : ctx.createLinearGradient(0, top, 0, top + h);
  across.addColorStop(0, PVC.fittingShade);
  across.addColorStop(FITTING_SHADING.shine, PVC.shine);
  across.addColorStop(FITTING_SHADING.body, PVC.fitting);
  across.addColorStop(1, PVC.fittingShade);
  roundedRectPath(ctx, left, top, w, h, fat * FITTING_SHADING.cornerShare);
  ctx.fillStyle = across;
  ctx.fill();
  ctx.strokeStyle = PVC.outline;
  ctx.lineWidth = Math.max(1, width * FITTING_SHADING.outlineShare);
  ctx.stroke();
}

/** A 90° elbow fitting turning between two runs that meet at (cx, cy). */
function pvcElbow(ctx: Ctx, cx: number, cy: number, width: number): void {
  const fat = width * PIPE_PANEL.fittingGrow;
  ctx.beginPath();
  ctx.arc(cx, cy, fat * HALF * FITTING_SHADING.elbowSwell, 0, FULL_TURN);
  const lightOffset = fat * FITTING_SHADING.elbowLightOffset;
  const body = ctx.createRadialGradient(
    cx - lightOffset,
    cy - lightOffset,
    0,
    cx,
    cy,
    fat * FITTING_SHADING.elbowReach,
  );
  body.addColorStop(0, PVC.shine);
  body.addColorStop(HALF, PVC.fitting);
  body.addColorStop(1, PVC.fittingShade);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = PVC.outline;
  ctx.lineWidth = Math.max(1, width * FITTING_SHADING.outlineShare);
  ctx.stroke();
}

function screw(ctx: Ctx, x: number, y: number, ts: number): void {
  ctx.beginPath();
  ctx.arc(x, y, PIPE_PANEL.screwRadius * ts, 0, FULL_TURN);
  ctx.fillStyle = PANEL.screw;
  ctx.fill();
  ctx.strokeStyle = PANEL.frameDark;
  ctx.lineWidth = Math.max(1, ts / FINE_LINES_PER_TILE);
  ctx.stroke();
}

/** The grey quarter-turn shutoff valve on the main riser. */
function paintValve(ctx: Ctx, cx: number, cy: number, ts: number): void {
  const w = PIPE_PANEL.valveWidth * ts;
  const h = PIPE_PANEL.valveHeight * ts;
  roundedRectPath(ctx, cx - w * HALF, cy - h * HALF, w, h, h * VALVE_SHAPE.cornerShare);
  const body = ctx.createLinearGradient(0, cy - h * HALF, 0, cy + h * HALF);
  body.addColorStop(0, VALVE.light);
  body.addColorStop(HALF, VALVE.mid);
  body.addColorStop(1, VALVE.dark);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = VALVE.outline;
  ctx.lineWidth = outline(ts);
  ctx.stroke();
  const leverW = PIPE_PANEL.leverLength * ts;
  const leverH = PIPE_PANEL.leverWidth * ts;
  roundedRectPath(ctx, cx, cy - h * HALF - leverH, leverW, leverH, leverH * HALF);
  ctx.fillStyle = VALVE.mid;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - h * HALF - leverH * HALF, leverH * VALVE_SHAPE.bossShare, 0, FULL_TURN);
  ctx.fillStyle = VALVE.light;
  ctx.fill();
  ctx.stroke();
}

/**
 * The open access panel and the white PVC run inside it: a riser from the
 * ceiling, a tee feeding a branch across and down, a grey shutoff valve on the
 * riser, couplings and elbows at every joint. Broken, the branch's joint has
 * pulled apart and the wall below it is wet; fixed, it is whole and dry.
 */
export function paintPipeWall(ctx: Ctx, ox: number, oy: number, ts: number, broken: boolean): void {
  paintTiledWall(ctx, ox, oy, ts, ts);
  const left = ox + PIPE_PANEL.left * ts;
  const right = ox + PIPE_PANEL.right * ts;
  const top = oy - PIPE_PANEL.topRise * ts;
  const bottom = oy - PIPE_PANEL.bottomRise * ts;
  const frame = PIPE_PANEL.frameWidth * ts;
  verticalFill(ctx, left, top, right - left, bottom - top, PANEL.frameLight, PANEL.frameDark);
  const innerLeft = left + frame;
  const innerTop = top + frame;
  const innerWidth = right - left - frame * DOUBLE;
  const innerHeight = bottom - top - frame * DOUBLE;
  verticalFill(
    ctx,
    innerLeft,
    innerTop,
    innerWidth,
    innerHeight,
    PANEL.recessTop,
    PANEL.recessBottom,
  );
  for (const [sx, sy] of [
    [left + PIPE_PANEL.screwInset * ts, top + PIPE_PANEL.screwInset * ts],
    [right - PIPE_PANEL.screwInset * ts, top + PIPE_PANEL.screwInset * ts],
    [left + PIPE_PANEL.screwInset * ts, bottom - PIPE_PANEL.screwInset * ts],
    [right - PIPE_PANEL.screwInset * ts, bottom - PIPE_PANEL.screwInset * ts],
  ] as const) {
    screw(ctx, sx, sy, ts);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(innerLeft, innerTop, innerWidth, innerHeight);
  ctx.clip();
  const pipe = PIPE_PANEL.pipeWidth * ts;
  const mainX = ox + PIPE_PANEL.mainX * ts;
  const branchX = ox + PIPE_PANEL.branchX * ts;
  const teeY = oy - PIPE_PANEL.teeRise * ts;
  const drainY = oy - PIPE_PANEL.drainRise * ts;
  const leakY = oy - PIPE_PANEL.leakRise * ts;
  const gap = PIPE_PANEL.leakGap * ts;
  const shift = broken ? PIPE_PANEL.leakShift * ts : 0;

  if (broken) {
    const streak = PIPE_PANEL.wetStreakWidth * ts;
    verticalFill(
      ctx,
      branchX - streak * HALF + shift,
      leakY - gap,
      streak,
      bottom - leakY + gap,
      PANEL.wet,
      PANEL.wetSheen,
    );
  }
  pvcRun(ctx, mainX, innerTop, mainX, drainY, pipe);
  pvcRun(ctx, mainX, teeY, branchX, teeY, pipe);
  pvcRun(ctx, branchX, teeY, branchX, leakY - (broken ? gap : 0), pipe);
  pvcRun(ctx, branchX + shift, leakY, branchX + shift, bottom, pipe);
  pvcSleeve(
    ctx,
    mainX,
    oy - PIPE_PANEL.couplingRise * ts,
    true,
    pipe,
    PIPE_PANEL.fittingLength * ts,
  );
  pvcSleeve(
    ctx,
    ox + PIPE_PANEL.branchCouplingX * ts,
    teeY,
    false,
    pipe,
    PIPE_PANEL.fittingLength * ts,
  );
  pvcSleeve(
    ctx,
    mainX,
    teeY,
    true,
    pipe,
    PIPE_PANEL.fittingLength * ts * PIPE_PANEL.teeLengthShare,
  );
  pvcSleeve(
    ctx,
    mainX + PIPE_PANEL.fittingLength * ts * HALF,
    teeY,
    false,
    pipe,
    PIPE_PANEL.fittingLength * ts,
  );
  pvcElbow(ctx, branchX, teeY, pipe);
  if (broken) {
    pvcSleeve(
      ctx,
      branchX + shift,
      leakY + PIPE_PANEL.fittingLength * ts * HALF,
      true,
      pipe,
      PIPE_PANEL.fittingLength * ts,
    );
  } else {
    pvcSleeve(ctx, branchX, leakY, true, pipe, PIPE_PANEL.fittingLength * ts);
  }
  pvcElbow(ctx, mainX, drainY, pipe);
  pvcRun(ctx, mainX, drainY, innerLeft, drainY, pipe);
  if (broken) {
    const runnel = Math.max(1, PIPE_PANEL.runnelWidth * ts);
    verticalFill(
      ctx,
      branchX + shift + pipe * HALF - runnel,
      leakY,
      runnel,
      bottom - leakY,
      PANEL.runnel,
      PANEL.wetSheen,
    );
    softEllipse(
      ctx,
      branchX + shift,
      bottom - PIPE_PANEL.poolRy * ts,
      PIPE_PANEL.poolRx * ts,
      PIPE_PANEL.poolRy * ts,
      PANEL.poolRgb,
      PANEL.poolAlpha,
    );
  }
  paintValve(ctx, mainX, oy - PIPE_PANEL.valveRise * ts, ts);
  ctx.restore();
  strokeRect(ctx, left, top, right - left, bottom - top, PANEL.frameDark, outline(ts));
  paintFootShadow(ctx, ox, oy, ts, ts);
}

// ── Sinks ───────────────────────────────────────────────────────────────────

const MIRROR = {
  top: '#c9d6db',
  bottom: '#7d9098',
  glint: 'rgba(255,255,255,0.55)',
  frame: '#4d5a5e',
} as const;

/** A west-wall sink, in tiles from its tile's top-left. An east-wall sink is its mirror image. */
const SINK = {
  mirrorLeft: 0.02,
  mirrorWidth: 0.2,
  mirrorTop: -0.95,
  mirrorBottom: 0.2,
  glintWidth: 0.07,
  glintDrop: 0.15,
  bracketWidth: 0.06,
  bracketTop: 0.3,
  bracketBottom: 0.62,
  basinCx: 0.42,
  basinRimY: 0.36,
  basinRx: 0.33,
  basinRy: 0.17,
  bowlRx: 0.24,
  bowlRy: 0.105,
  bowlDrop: 0.12,
  stainRxShare: 0.6,
  stainRyShare: 0.7,
  apronDepth: 0.13,
  trapX: 0.42,
  trapBottom: 0.68,
  trapWidth: 0.07,
  faucetX: 0.13,
  faucetTop: 0.12,
  faucetPostWidth: 0.05,
  spoutReach: 0.3,
  spoutDrop: 0.06,
  spoutWidth: 0.035,
  handleRadius: 0.035,
  handleOffset: 0.08,
  drainX: 0.44,
  drainY: 0.37,
  drainRadius: 0.025,
  shadowCx: 0.42,
  shadowCy: 0.86,
  shadowRx: 0.32,
  shadowRy: 0.09,
  stainAlpha: 0.25,
} as const;

/** Where the running water leaves the spout and lands, in tiles from a west-wall sink tile's top-left. */
export const SINK_WATER_PATH = {
  spoutX: SINK.faucetX + SINK.spoutReach,
  spoutY: SINK.faucetTop + SINK.spoutDrop,
  drainX: SINK.drainX,
  drainY: SINK.drainY,
} as const;

/** The faint rust ring round a dry sink's drain. */
const SINK_STAIN_RGB = '120,96,60';

/** One wall sink with its strip of mirror, dry. Painted for the west wall and mirrored for the east. */
export function paintBathroomSink(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  side: SinkSide,
): void {
  ctx.save();
  if (side === 'east') {
    ctx.translate(ox + ts, 0);
    ctx.scale(-1, 1);
    ctx.translate(-ox, 0);
  }
  const at = (fx: number): number => ox + fx * ts;
  const atY = (fy: number): number => oy + fy * ts;
  softEllipse(
    ctx,
    at(SINK.shadowCx),
    atY(SINK.shadowCy),
    SINK.shadowRx * ts,
    SINK.shadowRy * ts,
    CONTACT_SHADOW_RGB,
    CONTACT_SHADOW_ALPHA,
  );

  const mirrorTop = atY(SINK.mirrorTop);
  const mirrorHeight = (SINK.mirrorBottom - SINK.mirrorTop) * ts;
  verticalFill(
    ctx,
    at(SINK.mirrorLeft),
    mirrorTop,
    SINK.mirrorWidth * ts,
    mirrorHeight,
    MIRROR.top,
    MIRROR.bottom,
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(at(SINK.mirrorLeft), mirrorTop, SINK.mirrorWidth * ts, mirrorHeight);
  ctx.clip();
  ctx.fillStyle = MIRROR.glint;
  ctx.beginPath();
  const glintTop = mirrorTop + mirrorHeight * SINK.glintDrop;
  ctx.moveTo(at(SINK.mirrorLeft), glintTop + SINK.glintWidth * ts * DOUBLE);
  ctx.lineTo(at(SINK.mirrorLeft + SINK.mirrorWidth), glintTop);
  ctx.lineTo(at(SINK.mirrorLeft + SINK.mirrorWidth), glintTop + SINK.glintWidth * ts);
  ctx.lineTo(at(SINK.mirrorLeft), glintTop + SINK.glintWidth * ts * (DOUBLE + 1));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  strokeRect(
    ctx,
    at(SINK.mirrorLeft),
    mirrorTop,
    SINK.mirrorWidth * ts,
    mirrorHeight,
    MIRROR.frame,
    outline(ts),
  );

  fillRect(
    ctx,
    at(0),
    atY(SINK.bracketTop),
    SINK.bracketWidth * ts,
    (SINK.bracketBottom - SINK.bracketTop) * ts,
    CHROME.dark,
  );
  const trapLeft = at(SINK.trapX - SINK.trapWidth * HALF);
  verticalFill(
    ctx,
    trapLeft,
    atY(SINK.basinRimY),
    SINK.trapWidth * ts,
    (SINK.trapBottom - SINK.basinRimY) * ts,
    PVC.body,
    PVC.shade,
  );
  pvcRun(
    ctx,
    at(SINK.trapX),
    atY(SINK.trapBottom),
    at(0),
    atY(SINK.trapBottom),
    SINK.trapWidth * ts,
  );

  const cx = at(SINK.basinCx);
  const rimY = atY(SINK.basinRimY);
  const rx = SINK.basinRx * ts;
  const ry = SINK.basinRy * ts;
  const apron = SINK.apronDepth * ts;
  ctx.beginPath();
  ctx.ellipse(cx, rimY + apron, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, rimY);
  ctx.ellipse(cx, rimY, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  const apronFill = ctx.createLinearGradient(0, rimY, 0, rimY + apron + ry);
  apronFill.addColorStop(0, PORCELAIN.mid);
  apronFill.addColorStop(1, PORCELAIN.shade);
  ctx.fillStyle = apronFill;
  ctx.fill();
  ctx.strokeStyle = PORCELAIN.outline;
  ctx.lineWidth = outline(ts);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rx, ry, 0, 0, FULL_TURN);
  ctx.fillStyle = PORCELAIN.light;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, rimY + ry * SINK.bowlDrop, SINK.bowlRx * ts, SINK.bowlRy * ts, 0, 0, FULL_TURN);
  const bowl = ctx.createLinearGradient(0, rimY - SINK.bowlRy * ts, 0, rimY + SINK.bowlRy * ts);
  bowl.addColorStop(0, PORCELAIN.shade);
  bowl.addColorStop(1, PORCELAIN.mid);
  ctx.fillStyle = bowl;
  ctx.fill();
  softEllipse(
    ctx,
    at(SINK.drainX),
    atY(SINK.drainY),
    SINK.bowlRx * ts * SINK.stainRxShare,
    SINK.bowlRy * ts * SINK.stainRyShare,
    SINK_STAIN_RGB,
    SINK.stainAlpha,
  );
  ctx.beginPath();
  ctx.arc(at(SINK.drainX), atY(SINK.drainY), SINK.drainRadius * ts, 0, FULL_TURN);
  ctx.fillStyle = CHROME.dark;
  ctx.fill();

  const postLeft = at(SINK.faucetX - SINK.faucetPostWidth * HALF);
  verticalFill(
    ctx,
    postLeft,
    atY(SINK.faucetTop),
    SINK.faucetPostWidth * ts,
    (SINK.basinRimY - SINK.faucetTop) * ts,
    CHROME.light,
    CHROME.dark,
  );
  ctx.strokeStyle = CHROME.mid;
  ctx.lineCap = 'round';
  ctx.lineWidth = SINK.spoutWidth * ts;
  ctx.beginPath();
  ctx.moveTo(at(SINK.faucetX), atY(SINK.faucetTop));
  ctx.quadraticCurveTo(
    at(SINK.faucetX + SINK.spoutReach * HALF),
    atY(SINK.faucetTop - SINK.spoutDrop),
    at(SINK_WATER_PATH.spoutX),
    atY(SINK_WATER_PATH.spoutY),
  );
  ctx.stroke();
  ctx.strokeStyle = CHROME.light;
  ctx.lineWidth = SINK.spoutWidth * ts * HALF;
  ctx.stroke();
  for (const offset of [-SINK.handleOffset, SINK.handleOffset]) {
    ctx.beginPath();
    ctx.arc(
      at(SINK.faucetX),
      atY(SINK.basinRimY - SINK.apronDepth) + offset * ts * HALF,
      SINK.handleRadius * ts,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = CHROME.mid;
    ctx.fill();
  }
  ctx.restore();
}

// ── Floor pieces ────────────────────────────────────────────────────────────

const PLUNGER = {
  cx: 0.56,
  cupBottom: 0.8,
  cupRx: 0.17,
  cupHeight: 0.15,
  handleTop: 0.1,
  handleWidth: 0.055,
  lean: 0.16,
  lightStop: 0.35,
  cupShoulder: 1.2,
  cupCrown: 1.25,
  shadowRx: 0.22,
  shadowRy: 0.06,
} as const;
const PLUNGER_INK = {
  cup: '#8a1f1a',
  cupLight: '#c2423a',
  cupDark: '#4c0f0c',
  wood: '#9a6a3c',
  woodLight: '#c8945d',
  woodDark: '#5e3c1e',
} as const;

/** A plunger stood on its cup, leaning a little. */
export function paintPlunger(ctx: Ctx, ox: number, oy: number, ts: number): void {
  const cx = ox + PLUNGER.cx * ts;
  const bottom = oy + PLUNGER.cupBottom * ts;
  softEllipse(
    ctx,
    cx,
    bottom,
    PLUNGER.shadowRx * ts,
    PLUNGER.shadowRy * ts,
    CONTACT_SHADOW_RGB,
    CONTACT_SHADOW_ALPHA,
  );
  ctx.save();
  ctx.translate(cx, bottom);
  ctx.rotate(PLUNGER.lean);
  const handleLength = (PLUNGER.cupBottom - PLUNGER.handleTop) * ts;
  const handle = ctx.createLinearGradient(
    -PLUNGER.handleWidth * ts * HALF,
    0,
    PLUNGER.handleWidth * ts * HALF,
    0,
  );
  handle.addColorStop(0, PLUNGER_INK.woodDark);
  handle.addColorStop(PLUNGER.lightStop, PLUNGER_INK.woodLight);
  handle.addColorStop(1, PLUNGER_INK.wood);
  ctx.fillStyle = handle;
  ctx.fillRect(
    -PLUNGER.handleWidth * ts * HALF,
    -handleLength,
    PLUNGER.handleWidth * ts,
    handleLength,
  );
  const rx = PLUNGER.cupRx * ts;
  const height = PLUNGER.cupHeight * ts;
  ctx.beginPath();
  ctx.moveTo(-rx, 0);
  ctx.quadraticCurveTo(-rx, -height * PLUNGER.cupShoulder, 0, -height * PLUNGER.cupCrown);
  ctx.quadraticCurveTo(rx, -height * PLUNGER.cupShoulder, rx, 0);
  ctx.closePath();
  const cup = ctx.createLinearGradient(-rx, 0, rx, 0);
  cup.addColorStop(0, PLUNGER_INK.cupDark);
  cup.addColorStop(PLUNGER.lightStop, PLUNGER_INK.cupLight);
  cup.addColorStop(1, PLUNGER_INK.cup);
  ctx.fillStyle = cup;
  ctx.fill();
  ctx.strokeStyle = PLUNGER_INK.cupDark;
  ctx.lineWidth = outline(ts);
  ctx.stroke();
  ctx.restore();
}

/** Distinct puddle shapes a puddle tile may wear. */
export const PUDDLE_VARIANTS = 3;
const PUDDLE = {
  lobes: 4,
  centreSpread: 0.22,
  minRadius: 0.14,
  radiusSpread: 0.12,
  flatten: 0.6,
  alpha: 0.85,
  rimAlpha: 0.5,
  sheenAlpha: 0.7,
  sheenRx: 0.16,
  sheenRy: 0.04,
} as const;
const PUDDLE_SEED_BASE = 0x7ab1e;
const PUDDLE_WATER = '84,116,128';
const PUDDLE_SHEEN = '226,240,244';

/** A shallow puddle of standing water, within its tile. */
export function paintPuddle(ctx: Ctx, ox: number, oy: number, ts: number, variant: number): void {
  const rng = mulberry32(PUDDLE_SEED_BASE + variant);
  const cx = ox + ts * HALF;
  const cy = oy + ts * HALF;
  for (let lobe = 0; lobe < PUDDLE.lobes; lobe++) {
    const lx = cx + (rng() - HALF) * PUDDLE.centreSpread * ts;
    const ly = cy + (rng() - HALF) * PUDDLE.centreSpread * ts * PUDDLE.flatten;
    const radius = (PUDDLE.minRadius + rng() * PUDDLE.radiusSpread) * ts;
    softEllipse(ctx, lx, ly, radius, radius * PUDDLE.flatten, PUDDLE_WATER, PUDDLE.alpha);
  }
  softEllipse(
    ctx,
    cx,
    cy - PUDDLE.sheenRy * ts,
    PUDDLE.sheenRx * ts,
    PUDDLE.sheenRy * ts,
    PUDDLE_SHEEN,
    PUDDLE.sheenAlpha,
  );
  softEllipse(
    ctx,
    cx,
    cy,
    ts * (PUDDLE.minRadius + PUDDLE.radiusSpread),
    ts * PUDDLE.minRadius,
    PUDDLE_WATER,
    PUDDLE.rimAlpha * HALF,
  );
}
