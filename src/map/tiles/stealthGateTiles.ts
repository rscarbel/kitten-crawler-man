/**
 * The stealth gate across the gate room's onward doorway: a portcullis, shut or
 * hauled up.
 *
 * Each gate tile is drawn in two parts. The base, baked into the floor chunk,
 * is the floor with the iron slot the gate drops into. The portcullis itself
 * stands up out of that slot, so it is drawn in the Y-sorted decoration pass
 * and rises over whatever is behind it, the way any tall prop does: a crawler
 * north of it is drawn behind the bars.
 *
 * A doorway in a north or south wall is seen face on: posts at each jamb, a
 * heavy lintel beam, a grille of round bars with riveted cross rails and spear
 * tips. A doorway in a side wall is seen edge-on, the way the Briar Hollow
 * palisade's side gate is: the grille a thin upright slab, the lintel's top
 * face along it and the posts as end-on columns. Raised, the grille is drawn lifted
 * into the lintel with only its spiked bottom rail hanging below it and open
 * floor underneath: an opened door drawn as bare floor reads as floor that was
 * always there.
 */

import { STEALTH_GATE_CLOSED, STEALTH_GATE_OPEN, type TileContent } from '../tileTypes';
import type { MapSpriteExtentsPx } from '../../core/spriteAssets/SpriteLoader';
import { isWalkableTileType } from '../walkability';
import { drawGroundTile } from './groundTiles';
import { dungeonFloorTheme } from '../dungeon/floorTheme';
import {
  BAR_HIGHLIGHT_WIDTH,
  CAST_SHADOW,
  IRON_RUST,
  PANEL_BACKING,
  POST_CAP_HEIGHT,
  POST_CAP_OVERHANG,
  POST_WIDTH,
  RIVET,
  bar,
  beam,
  dot,
  post,
  spike,
  drawEdgeOnPortcullisTile,
  paintIronLintel,
  type EdgeOnPortcullisShape,
} from './portcullisParts';

type GateAxis = 'horizontal' | 'vertical';
type Ctx = CanvasRenderingContext2D;

const SLOT_DARK = 'rgba(0,0,0,0.72)';
const SLOT_EDGE_LIGHT = 'rgba(200,205,210,0.25)';
/** The lit floor under a raised gate, so the way through reads as open at a glance. */
const OPEN_THRESHOLD_LIGHT = 'rgba(255,214,140,0.2)';

/** Everything below is in tiles. The ground line the gate stands on, down (or across) its tile. */
const GROUND_LINE = 0.55;
/** How high the grille stands above its ground line, lintel included. */
const GATE_HEIGHT = 1.4;
/** Round bars per tile of run, aligned to the tile so a wide doorway's run is unbroken. */
const BARS_PER_TILE = 3;
const BAR_WIDTH = 0.13;
/** Cross rails, as fractions of the grille's height above the ground line. */
const RAIL_HEIGHTS = [0.22, 0.58] as const;
const RAIL_THICKNESS = 0.1;
/** Seen end-on, how far a rail's end stands out past the bars on each side. */
const RAIL_PROUD = 0.05;
const LINTEL_THICKNESS = 0.2;
const RIVET_RADIUS = 0.03;
const SPIKE_HEIGHT = 0.14;
/** The slot in the floor the bars drop into. */
const SLOT_WIDTH = 0.08;
/** The shadow the grille throws on the floor south of it. */
const SHADOW_DEPTH = 0.14;
/** Raised: the share of the grille's height it hangs above the floor. */
const RAISED_CLEARANCE = 0.55;
/**
 * Seen edge-on in a side wall: the grille's thickness across the wall, and
 * the posts'. The lintel spans both.
 */
const GRILLE_DEPTH = 0.2;
const EDGE_POST_WIDTH = 0.3;
/** Slack added to the reach so a rounded pixel at the edge is never culled. */
const REACH_MARGIN = 0.1;

const HALF = 0.5;

function tileAt(structure: TileContent[][], x: number, y: number): TileContent | null {
  if (y < 0 || y >= structure.length) return null;
  const row = structure[y];
  return x >= 0 && x < row.length ? row[x] : null;
}

function isGateAt(structure: TileContent[][], x: number, y: number): boolean {
  const type = tileAt(structure, x, y)?.type;
  return type === STEALTH_GATE_CLOSED || type === STEALTH_GATE_OPEN;
}

/** Off the grid counts as solid: nothing can be walked to out there. */
function isSolidAt(structure: TileContent[][], x: number, y: number): boolean {
  const tile = tileAt(structure, x, y);
  return tile === null || !isWalkableTileType(tile);
}

/** The four ways out of a room, each with the step along the wall it leaves through. */
const OUTWARD_PROBES = [
  { dx: 0, dy: -1, alongX: 1, alongY: 0, axis: 'horizontal' },
  { dx: 0, dy: 1, alongX: 1, alongY: 0, axis: 'horizontal' },
  { dx: -1, dy: 0, alongX: 0, alongY: 1, axis: 'vertical' },
  { dx: 1, dy: 0, alongX: 0, alongY: 1, axis: 'vertical' },
] as const;

/**
 * Which way the gate runs across its doorway. A gate tile is one of the room's
 * own perimeter floor tiles; the stone jambs stand one tile further out. A wide
 * doorway's gate tiles lie along the wall, and a one-tile doorway is found by
 * looking one tile outward for the direction with stone on both sides of the gap.
 */
function gateAxis(structure: TileContent[][], tx: number, ty: number): GateAxis {
  const alongX = isGateAt(structure, tx - 1, ty) || isGateAt(structure, tx + 1, ty);
  const alongY = isGateAt(structure, tx, ty - 1) || isGateAt(structure, tx, ty + 1);
  if (alongX && !alongY) return 'horizontal';
  if (alongY && !alongX) return 'vertical';
  for (const probe of OUTWARD_PROBES) {
    const outX = tx + probe.dx;
    const outY = ty + probe.dy;
    const flanked =
      isSolidAt(structure, outX + probe.alongX, outY + probe.alongY) &&
      isSolidAt(structure, outX - probe.alongX, outY - probe.alongY) &&
      !isSolidAt(structure, outX, outY);
    if (flanked) return probe.axis;
  }
  return 'horizontal';
}

/** Whether the run of gate tiles ends at this side of the tile, against a jamb. */
function endsRun(
  structure: TileContent[][],
  axis: GateAxis,
  tx: number,
  ty: number,
  step: -1 | 1,
): boolean {
  return axis === 'horizontal'
    ? !isGateAt(structure, tx + step, ty)
    : !isGateAt(structure, tx, ty + step);
}

/**
 * Which side of a side gate's run the wall stands on: the side where stone
 * closes both ends of the run. Room floor carries on past them the other way.
 */
function wallSideOf(structure: TileContent[][], tx: number, ty: number): -1 | 1 {
  let top = ty;
  while (isGateAt(structure, tx, top - 1)) top--;
  let bottom = ty;
  while (isGateAt(structure, tx, bottom + 1)) bottom++;
  const solidEnds = (dx: number): number =>
    (isSolidAt(structure, tx + dx, top - 1) ? 1 : 0) +
    (isSolidAt(structure, tx + dx, bottom + 1) ? 1 : 0);
  return solidEnds(1) >= solidEnds(-1) ? 1 : -1;
}

/** The floor and the slot the gate drops into, baked into the chunk. */
export function drawStealthGateBase(
  ctx: Ctx,
  structure: TileContent[][],
  open: boolean,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  drawGroundTile(ctx, dungeonFloorTheme().ground, structure, sx, sy, ts, tx, ty);
  if (open) {
    ctx.fillStyle = OPEN_THRESHOLD_LIGHT;
    ctx.fillRect(sx, sy, ts, ts);
  }
  const slot = ts * SLOT_WIDTH;
  const ground = ts * GROUND_LINE;
  if (gateAxis(structure, tx, ty) === 'horizontal') {
    ctx.fillStyle = SLOT_DARK;
    ctx.fillRect(sx, sy + ground - slot * HALF, ts, slot);
    ctx.fillStyle = SLOT_EDGE_LIGHT;
    ctx.fillRect(sx, sy + ground + slot * HALF, ts, Math.max(1, slot * HALF));
    if (!open) {
      ctx.fillStyle = CAST_SHADOW;
      ctx.fillRect(sx, sy + ground + slot * HALF, ts, ts * SHADOW_DEPTH);
    }
  } else {
    const centreX = sx + ts * HALF;
    ctx.fillStyle = SLOT_DARK;
    ctx.fillRect(centreX - slot * HALF, sy, slot, ts);
    ctx.fillStyle = SLOT_EDGE_LIGHT;
    ctx.fillRect(centreX + slot * HALF, sy, Math.max(1, slot * HALF), ts);
  }
}

/** The face-on portcullis for one tile of run, standing on the tile's ground line. */
function drawFaceOn(
  ctx: Ctx,
  open: boolean,
  sx: number,
  sy: number,
  ts: number,
  postAtStart: boolean,
  postAtEnd: boolean,
): void {
  const groundY = sy + ts * GROUND_LINE;
  const height = ts * GATE_HEIGHT;
  const topY = groundY - height;
  const lintel = ts * LINTEL_THICKNESS;
  const grilleBottom = open ? groundY - height * RAISED_CLEARANCE : groundY;
  const pitch = ts / BARS_PER_TILE;
  const barWidth = ts * BAR_WIDTH;

  ctx.fillStyle = PANEL_BACKING;
  ctx.fillRect(sx, topY, ts, grilleBottom - topY);
  for (let index = 0; index < BARS_PER_TILE; index++) {
    const x = sx + pitch * (index + HALF);
    bar(ctx, x, topY + lintel, grilleBottom, barWidth, ts * BAR_HIGHLIGHT_WIDTH);
    spike(ctx, x, grilleBottom, barWidth * HALF, ts * SPIKE_HEIGHT * (open ? 1 : HALF));
  }
  const rails = open ? [RAISED_CLEARANCE] : RAIL_HEIGHTS;
  for (const share of rails) {
    const railY = groundY - height * share - ts * RAIL_THICKNESS;
    beam(ctx, sx, railY, ts, ts * RAIL_THICKNESS);
    ctx.fillStyle = IRON_RUST;
    ctx.fillRect(sx, railY + ts * RAIL_THICKNESS * HALF, ts, ts * RAIL_THICKNESS * HALF);
    for (let index = 0; index < BARS_PER_TILE; index++) {
      dot(
        ctx,
        RIVET,
        sx + pitch * (index + HALF),
        railY + ts * RAIL_THICKNESS * HALF,
        ts * RIVET_RADIUS,
      );
    }
  }
  beam(ctx, sx, topY, ts, lintel);
  if (postAtStart) post(ctx, sx + ts * POST_WIDTH * HALF, groundY, height, ts);
  if (postAtEnd) post(ctx, sx + ts - ts * POST_WIDTH * HALF, groundY, height, ts);
}

const EDGE_ON_SHAPE: EdgeOnPortcullisShape = {
  gateHeight: GATE_HEIGHT,
  lintelThickness: LINTEL_THICKNESS,
  barsPerTile: BARS_PER_TILE,
  grilleDepth: GRILLE_DEPTH,
  postWidth: EDGE_POST_WIDTH,
  rivetRadius: RIVET_RADIUS,
  railThickness: RAIL_THICKNESS,
  railProud: RAIL_PROUD,
  shadowDepth: SHADOW_DEPTH,
  lintelOverGrille: true,
};

/** The side portcullis for one tile of run: a doorway in an east or west wall runs north–south. */
function drawEdgeOn(
  ctx: Ctx,
  open: boolean,
  sx: number,
  sy: number,
  ts: number,
  wallSide: -1 | 1,
  postAtStart: boolean,
  postAtEnd: boolean,
): void {
  const railShares = open ? [RAISED_CLEARANCE] : RAIL_HEIGHTS;
  drawEdgeOnPortcullisTile(
    ctx,
    sx,
    sy,
    ts,
    EDGE_ON_SHAPE,
    {
      liftTiles: open ? GATE_HEIGHT * RAISED_CLEARANCE : 0,
      railHeights: railShares.map((share) => GATE_HEIGHT * share),
      spikeTiles: SPIKE_HEIGHT * (open ? 1 : HALF),
      frameSide: wallSide,
      postAtStart,
      postAtEnd,
    },
    paintIronLintel,
  );
}

/** The portcullis standing on one gate tile, drawn in the Y-sorted pass. */
export function drawStealthGatePortcullis(
  ctx: Ctx,
  structure: TileContent[][],
  open: boolean,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const axis = gateAxis(structure, tx, ty);
  const atStart = endsRun(structure, axis, tx, ty, -1);
  const atEnd = endsRun(structure, axis, tx, ty, 1);
  ctx.save();
  if (axis === 'horizontal') drawFaceOn(ctx, open, sx, sy, ts, atStart, atEnd);
  else drawEdgeOn(ctx, open, sx, sy, ts, wallSideOf(structure, tx, ty), atStart, atEnd);
  ctx.restore();
}

/** How far a gate tile's portcullis reaches past its own square, for culling. */
export function stealthGateExtentsPx(
  structure: TileContent[][],
  tx: number,
  ty: number,
  ts: number,
): MapSpriteExtentsPx {
  const rise = GATE_HEIGHT + POST_CAP_HEIGHT + REACH_MARGIN;
  if (gateAxis(structure, tx, ty) === 'horizontal') {
    const up = Math.ceil(ts * (rise - GROUND_LINE));
    const side = Math.ceil(ts * POST_CAP_OVERHANG);
    return { left: side, up, right: side, down: 0 };
  }
  return { left: 0, up: Math.ceil(ts * rise), right: 0, down: 0 };
}
