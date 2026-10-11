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
 * tips. A doorway in a side wall is seen obliquely, the grille leaning into the
 * room so its bars and rails still read. Raised, the grille is drawn lifted
 * into the lintel with only its spiked bottom rail hanging below it and open
 * floor underneath: an opened door drawn as bare floor reads as floor that was
 * always there.
 */

import { STEALTH_GATE_CLOSED, STEALTH_GATE_OPEN, type TileContent } from '../tileTypes';
import type { MapSpriteExtentsPx } from '../../core/SpriteLoader';
import { isWalkableTileType } from '../walkability';
import { drawGroundTile } from './groundTiles';
import { dungeonFloorTheme } from '../dungeon/floorTheme';

type GateAxis = 'horizontal' | 'vertical';
type Ctx = CanvasRenderingContext2D;

const IRON_SHADOW = '#15181b';
const IRON_MID = '#3b4248';
const IRON_LIGHT = '#8a959e';
const IRON_RUST = 'rgba(126,64,30,0.55)';
const RIVET = '#b4bcc2';
const SLOT_DARK = 'rgba(0,0,0,0.72)';
const SLOT_EDGE_LIGHT = 'rgba(200,205,210,0.25)';
const CAST_SHADOW = 'rgba(0,0,0,0.38)';
/** The dark seen through the grille, so the bars read as one heavy panel. */
const PANEL_BACKING = 'rgba(8,10,12,0.32)';
/** The lit floor under a raised gate, so the way through reads as open at a glance. */
const OPEN_THRESHOLD_LIGHT = 'rgba(255,214,140,0.2)';

/** Everything below is in tiles. The ground line the gate stands on, down (or across) its tile. */
const GROUND_LINE = 0.55;
/** How high the grille stands above its ground line, lintel included. */
const GATE_HEIGHT = 1.4;
/** Round bars per tile of run, aligned to the tile so a wide doorway's run is unbroken. */
const BARS_PER_TILE = 3;
const BAR_WIDTH = 0.13;
const BAR_HIGHLIGHT_WIDTH = 0.03;
/** Cross rails, as fractions of the grille's height above the ground line. */
const RAIL_HEIGHTS = [0.22, 0.58] as const;
const RAIL_THICKNESS = 0.1;
const LINTEL_THICKNESS = 0.2;
const RIVET_RADIUS = 0.03;
const SPIKE_HEIGHT = 0.14;
/** The heavy posts a run ends on, against the stone jambs. */
const POST_WIDTH = 0.28;
const POST_CAP_HEIGHT = 0.08;
const POST_CAP_OVERHANG = 0.04;
/** The slot in the floor the bars drop into. */
const SLOT_WIDTH = 0.08;
/** The shadow the grille throws on the floor south of it. */
const SHADOW_DEPTH = 0.14;
/** Raised: the share of the grille's height it hangs above the floor. */
const RAISED_CLEARANCE = 0.55;
/** Seen obliquely: how far the grille leans sideways per unit of height. */
const SIDE_LEAN = 0.75;
/** Slack added to the reach so a rounded pixel at the edge is never culled. */
const REACH_MARGIN = 0.1;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

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
 * Which way a side gate leans: into the room, the side where floor carries on
 * past both ends of the run. On the corridor side the jambs are stone.
 */
function sideLeanSign(structure: TileContent[][], tx: number, ty: number): -1 | 1 {
  let top = ty;
  while (isGateAt(structure, tx, top - 1)) top--;
  let bottom = ty;
  while (isGateAt(structure, tx, bottom + 1)) bottom++;
  const roomward = (dx: number): number =>
    (isSolidAt(structure, tx + dx, top - 1) ? 0 : 1) +
    (isSolidAt(structure, tx + dx, bottom + 1) ? 0 : 1);
  return roomward(1) >= roomward(-1) ? 1 : -1;
}

function line(
  ctx: Ctx,
  color: string,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function dot(ctx: Ctx, color: string, x: number, y: number, radius: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, radius), 0, FULL_TURN);
  ctx.fill();
}

function spike(ctx: Ctx, x: number, baseY: number, halfWidth: number, height: number) {
  ctx.fillStyle = IRON_MID;
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, baseY);
  ctx.lineTo(x + halfWidth, baseY);
  ctx.lineTo(x, baseY + height);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = IRON_LIGHT;
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, baseY);
  ctx.lineTo(x - halfWidth * HALF, baseY);
  ctx.lineTo(x, baseY + height);
  ctx.closePath();
  ctx.fill();
}

/** A round bar from (x, top) down to (x, bottom): dark body, lit edge. */
function bar(ctx: Ctx, x: number, top: number, bottom: number, width: number, highlight: number) {
  ctx.fillStyle = IRON_SHADOW;
  ctx.fillRect(x - width * HALF, top, width, bottom - top);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x - width * HALF * HALF, top, width * HALF, bottom - top);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x - width * HALF * HALF, top, Math.max(1, highlight), bottom - top);
}

/** A horizontal beam across the tile at `y`. */
function beam(ctx: Ctx, x: number, y: number, width: number, thickness: number) {
  ctx.fillStyle = IRON_SHADOW;
  ctx.fillRect(x, y, width, thickness);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, width, thickness * HALF);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y, width, Math.max(1, thickness * HALF * HALF));
}

function post(ctx: Ctx, centreX: number, groundY: number, height: number, ts: number) {
  const width = ts * POST_WIDTH;
  bar(ctx, centreX, groundY - height, groundY, width, ts * BAR_HIGHLIGHT_WIDTH * 2);
  const capWidth = width + ts * POST_CAP_OVERHANG * 2;
  beam(
    ctx,
    centreX - capWidth * HALF,
    groundY - height - ts * POST_CAP_HEIGHT,
    capWidth,
    ts * POST_CAP_HEIGHT,
  );
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

/**
 * The side portcullis for one tile of run, seen obliquely: a point `h` above
 * the ground line at depth `y` is drawn at `(groundX + lean·h, y − h)`, so the
 * bars slope into the room and the rails stand upright between them.
 */
function drawOblique(
  ctx: Ctx,
  open: boolean,
  sx: number,
  sy: number,
  ts: number,
  lean: -1 | 1,
  postAtStart: boolean,
  postAtEnd: boolean,
): void {
  const groundX = sx + ts * HALF;
  const height = ts * GATE_HEIGHT;
  const at = (depth: number, rise: number): { x: number; y: number } => ({
    x: groundX + lean * SIDE_LEAN * rise,
    y: depth - rise,
  });
  const lintel = ts * LINTEL_THICKNESS;
  const lowest = open ? height * RAISED_CLEARANCE : 0;
  const barWidth = ts * BAR_WIDTH;
  const pitch = ts / BARS_PER_TILE;

  const lintelTop = at(sy, height);
  const lintelBottom = at(sy + ts, height);
  const backingNorth = at(sy, lowest);
  const backingSouth = at(sy + ts, lowest);
  ctx.fillStyle = PANEL_BACKING;
  ctx.beginPath();
  ctx.moveTo(backingNorth.x, backingNorth.y);
  ctx.lineTo(backingSouth.x, backingSouth.y);
  ctx.lineTo(lintelBottom.x, lintelBottom.y);
  ctx.lineTo(lintelTop.x, lintelTop.y);
  ctx.closePath();
  ctx.fill();
  for (let index = 0; index < BARS_PER_TILE; index++) {
    const depth = sy + pitch * (index + HALF);
    const foot = at(depth, lowest);
    const head = at(depth, height - lintel);
    line(ctx, IRON_SHADOW, barWidth, foot.x, foot.y, head.x, head.y);
    line(
      ctx,
      IRON_LIGHT,
      ts * BAR_HIGHLIGHT_WIDTH,
      foot.x - barWidth * HALF * HALF,
      foot.y,
      head.x - barWidth * HALF * HALF,
      head.y,
    );
    spike(ctx, foot.x, foot.y, barWidth * HALF, ts * SPIKE_HEIGHT * (open ? 1 : HALF));
  }
  const rails = open ? [RAISED_CLEARANCE] : RAIL_HEIGHTS;
  for (const share of rails) {
    const north = at(sy, height * share);
    const south = at(sy + ts, height * share);
    line(ctx, IRON_SHADOW, ts * RAIL_THICKNESS, north.x, north.y, south.x, south.y);
    line(ctx, IRON_MID, ts * RAIL_THICKNESS * HALF, north.x, north.y, south.x, south.y);
    for (let index = 0; index < BARS_PER_TILE; index++) {
      const rivet = at(sy + pitch * (index + HALF), height * share);
      dot(ctx, RIVET, rivet.x, rivet.y, ts * RIVET_RADIUS);
    }
  }
  line(ctx, IRON_SHADOW, lintel, lintelTop.x, lintelTop.y, lintelBottom.x, lintelBottom.y);
  line(
    ctx,
    IRON_LIGHT,
    lintel * HALF * HALF,
    lintelTop.x,
    lintelTop.y,
    lintelBottom.x,
    lintelBottom.y,
  );
  for (const [atEnd, depth] of [
    [postAtStart, sy],
    [postAtEnd, sy + ts],
  ] as const) {
    if (!atEnd) continue;
    const foot = at(depth, 0);
    const head = at(depth, height + ts * POST_CAP_HEIGHT);
    line(ctx, IRON_SHADOW, ts * POST_WIDTH, foot.x, foot.y, head.x, head.y);
    line(ctx, IRON_MID, ts * POST_WIDTH * HALF, foot.x, foot.y, head.x, head.y);
    line(
      ctx,
      IRON_LIGHT,
      ts * BAR_HIGHLIGHT_WIDTH * 2,
      foot.x - ts * POST_WIDTH * HALF * HALF,
      foot.y,
      head.x - ts * POST_WIDTH * HALF * HALF,
      head.y,
    );
  }
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
  else drawOblique(ctx, open, sx, sy, ts, sideLeanSign(structure, tx, ty), atStart, atEnd);
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
  const leanReach = Math.ceil(ts * (SIDE_LEAN * rise + POST_WIDTH - HALF + REACH_MARGIN));
  const lean = sideLeanSign(structure, tx, ty);
  return {
    left: lean < 0 ? leanReach : Math.ceil(ts * POST_WIDTH),
    up: Math.ceil(ts * rise),
    right: lean > 0 ? leanReach : Math.ceil(ts * POST_WIDTH),
    down: 0,
  };
}
