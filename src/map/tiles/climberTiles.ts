/**
 * The climbers' ground: a ledge a cat stands on above the floor, and a gap
 * only a cat fits through.
 *
 * A ledge reads as a raised thing at in-game size by three parts: a lit top
 * surface, a bright lip along its open edge, and a dark face dropping from
 * that lip to the floor with a contact shadow at its foot. A run of ledge
 * tiles reads as one beam or shelf: the face and the lip are painted only on
 * a tile's open south side, the side edges only where the run ends. The top
 * surface stands {@link LEDGE_RISE_TILES} above the floor, which is where a
 * cat on it is drawn.
 *
 * Everything is a share of `ts`; light comes from the upper left.
 */

import { LEDGE_RISE_TILES } from '../mobility';
import { CAT_GAP, CAT_LEDGE, type TileContent } from '../tileTypes';

const TOP_TIMBER = '#8c6c46';
const TOP_TIMBER_LIGHT = 'rgba(236,206,150,0.22)';
/** The share of the top surface, from its back edge, the light from the upper left catches. */
const TOP_LIT_SHARE = 0.5;
const PLANK_SEAM = 'rgba(40,26,14,0.45)';
const PLANK_COUNT = 2;
const PLANK_SEAM_WIDTH = 0.03;
const GRAIN_COLOR = 'rgba(52,34,18,0.18)';
const GRAIN_LINES = 3;
const GRAIN_WIDTH = 0.012;
const GRAIN_HASH_X = 73;
const GRAIN_HASH_Y = 151;
const GRAIN_HASH_MOD = 97;

const LIP_COLOR = 'rgba(250,226,176,0.7)';
const LIP_WIDTH = 0.045;
const BACK_EDGE_COLOR = 'rgba(28,18,10,0.55)';
const BACK_EDGE_WIDTH = 0.04;
const SIDE_EDGE_COLOR = 'rgba(30,20,10,0.45)';
const SIDE_EDGE_WIDTH = 0.05;

const FACE_TOP = '#4a3420';
const FACE_BOTTOM = '#22160c';
const FACE_SLAT_COLOR = 'rgba(0,0,0,0.25)';
const FACE_SLAT_WIDTH = 0.02;
const FACE_SLATS = 3;
/** The face's dark foot where it meets the floor, as a share of its own height. */
const FOOT_SHADOW_SHARE = 0.3;
const FOOT_SHADOW = 'rgba(0,0,0,0.55)';

const GAP_SURROUND = '#4b4640';
const GAP_SURROUND_LIGHT = 'rgba(214,204,186,0.25)';
const GAP_SURROUND_DARK = 'rgba(14,12,10,0.5)';
const GAP_BEVEL = 0.06;
/** The opening is low and wide: a cat's height, not a person's. */
const GAP_OPENING_TOP_SHARE = 0.5;
const GAP_OPENING_SIDE_SHARE = 0.14;
const GAP_OPENING_TOP_INK = '#141210';
const GAP_OPENING_DEPTH_INK = '#020202';
const GAP_LINTEL_LIGHT = 'rgba(222,210,188,0.4)';
const GAP_LINTEL_WIDTH = 0.04;
const GAP_FLOOR_GLINT = 'rgba(160,150,130,0.18)';
const GAP_FLOOR_GLINT_HEIGHT = 0.05;

function tileTypeAt(structure: TileContent[][], tx: number, ty: number): number | undefined {
  return structure[ty]?.[tx]?.type;
}

function drawLedge(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const ledgeBelow = tileTypeAt(structure, tx, ty + 1) === CAT_LEDGE;
  const ledgeAbove = tileTypeAt(structure, tx, ty - 1) === CAT_LEDGE;
  const ledgeWest = tileTypeAt(structure, tx - 1, ty) === CAT_LEDGE;
  const ledgeEast = tileTypeAt(structure, tx + 1, ty) === CAT_LEDGE;
  const faceHeight = ledgeBelow ? 0 : Math.round(ts * LEDGE_RISE_TILES);
  const topHeight = ts - faceHeight;

  ctx.fillStyle = TOP_TIMBER;
  ctx.fillRect(sx, sy, ts, topHeight);
  ctx.fillStyle = TOP_TIMBER_LIGHT;
  ctx.fillRect(sx, sy, ts, topHeight * TOP_LIT_SHARE);

  const plankHeight = topHeight / PLANK_COUNT;
  ctx.fillStyle = PLANK_SEAM;
  for (let plank = 1; plank < PLANK_COUNT; plank++) {
    ctx.fillRect(sx, sy + plankHeight * plank, ts, Math.max(1, ts * PLANK_SEAM_WIDTH));
  }
  ctx.fillStyle = GRAIN_COLOR;
  const grainSeed = (tx * GRAIN_HASH_X + ty * GRAIN_HASH_Y) % GRAIN_HASH_MOD;
  for (let line = 0; line < GRAIN_LINES; line++) {
    const offset = ((grainSeed + line * GRAIN_HASH_X) % GRAIN_HASH_MOD) / GRAIN_HASH_MOD;
    ctx.fillRect(sx, sy + topHeight * offset, ts, Math.max(1, ts * GRAIN_WIDTH));
  }

  if (!ledgeAbove) {
    ctx.fillStyle = BACK_EDGE_COLOR;
    ctx.fillRect(sx, sy, ts, Math.max(1, ts * BACK_EDGE_WIDTH));
  }
  const sideWidth = Math.max(1, ts * SIDE_EDGE_WIDTH);
  ctx.fillStyle = SIDE_EDGE_COLOR;
  if (!ledgeWest) ctx.fillRect(sx, sy, sideWidth, ts);
  if (!ledgeEast) ctx.fillRect(sx + ts - sideWidth, sy, sideWidth, ts);

  if (faceHeight === 0) return;
  const faceTop = sy + topHeight;
  const face = ctx.createLinearGradient(0, faceTop, 0, sy + ts);
  face.addColorStop(0, FACE_TOP);
  face.addColorStop(1, FACE_BOTTOM);
  ctx.fillStyle = face;
  ctx.fillRect(sx, faceTop, ts, faceHeight);
  ctx.fillStyle = FACE_SLAT_COLOR;
  for (let slat = 1; slat <= FACE_SLATS; slat++) {
    const slatX = sx + (ts * slat) / (FACE_SLATS + 1);
    ctx.fillRect(slatX, faceTop, Math.max(1, ts * FACE_SLAT_WIDTH), faceHeight);
  }
  ctx.fillStyle = FOOT_SHADOW;
  const footHeight = faceHeight * FOOT_SHADOW_SHARE;
  ctx.fillRect(sx, sy + ts - footHeight, ts, footHeight);
  ctx.fillStyle = LIP_COLOR;
  ctx.fillRect(sx, faceTop - Math.max(1, ts * LIP_WIDTH), ts, Math.max(1, ts * LIP_WIDTH));
}

function drawGap(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  ctx.fillStyle = GAP_SURROUND;
  ctx.fillRect(sx, sy, ts, ts);
  const bevel = Math.max(1, ts * GAP_BEVEL);
  ctx.fillStyle = GAP_SURROUND_LIGHT;
  ctx.fillRect(sx, sy, ts, bevel);
  ctx.fillStyle = GAP_SURROUND_DARK;
  ctx.fillRect(sx, sy + ts - bevel, ts, bevel);

  const openingX = sx + ts * GAP_OPENING_SIDE_SHARE;
  const openingW = ts * (1 - GAP_OPENING_SIDE_SHARE * 2);
  const openingY = sy + ts * GAP_OPENING_TOP_SHARE;
  const openingH = sy + ts - openingY;
  const depth = ctx.createLinearGradient(0, openingY, 0, sy + ts);
  depth.addColorStop(0, GAP_OPENING_TOP_INK);
  depth.addColorStop(1, GAP_OPENING_DEPTH_INK);
  ctx.fillStyle = depth;
  ctx.fillRect(openingX, openingY, openingW, openingH);
  ctx.fillStyle = GAP_LINTEL_LIGHT;
  ctx.fillRect(
    openingX,
    openingY - Math.max(1, ts * GAP_LINTEL_WIDTH),
    openingW,
    Math.max(1, ts * GAP_LINTEL_WIDTH),
  );
  ctx.fillStyle = GAP_FLOOR_GLINT;
  ctx.fillRect(
    openingX,
    sy + ts - ts * GAP_FLOOR_GLINT_HEIGHT,
    openingW,
    ts * GAP_FLOOR_GLINT_HEIGHT,
  );
}

/** Paints a climbers' tile; false for any other type. */
export function drawClimberTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  if (type === CAT_LEDGE) {
    drawLedge(ctx, structure, sx, sy, ts, tx, ty);
    return true;
  }
  if (type === CAT_GAP) {
    drawGap(ctx, sx, sy, ts);
    return true;
  }
  return false;
}
