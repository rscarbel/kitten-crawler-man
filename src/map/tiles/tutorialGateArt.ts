/**
 * The tutorial's cellar gates: iron portcullises that winch up into a timber
 * headbox, the knee-high iron fence with a double swing gate that the cat's
 * Magic Missile flies over, and the solid iron-strapped cellar door that keeps
 * the human away from the cat's target.
 *
 * The tutorial's gates are not tiles: every tile under them is plain floor so
 * a missile can cross a shut gate. These painters therefore take an explicit
 * screen position and how far open the gate is, and the caller sorts each
 * piece with the bodies the way the stealth portcullis's decoration tiles are.
 *
 * Same projection as every standing thing on a dungeon floor: a point `h`
 * above the floor at depth `y` is drawn at `(x, y − h)`. A run across a north–
 * south hall is seen face on; the run across an east–west hall is seen
 * edge-on, a narrow column of iron rising up-screen.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  BAR_HIGHLIGHT_WIDTH,
  CAST_SHADOW,
  IRON_LIGHT,
  IRON_MID,
  IRON_RUST,
  IRON_SHADOW,
  PANEL_BACKING,
  POST_CAP_HEIGHT,
  POST_CAP_OVERHANG,
  RIVET,
  bar,
  beam,
  dot,
  post,
  spike,
  drawEdgeOnPortcullisTile,
  type EdgeOnPortcullisShape,
} from './portcullisParts';

type Ctx = CanvasRenderingContext2D;

const WOOD_DARK = '#24190f';
const WOOD_MID = '#4a3523';
const WOOD_LIGHT = '#6e5237';
const WOOD_GRAIN = 'rgba(20,12,6,0.45)';
const SLOT_DARK = 'rgba(0,0,0,0.6)';
const SLOT_EDGE_LIGHT = 'rgba(200,205,210,0.22)';
const DUST_RGB = '128,114,96';

const HALF = 0.5;

// ── Portcullis, in tiles ─────────────────────────────────────────────────────

/** Where the gate stands down its tile (face on) — the slot it drops into. */
const GROUND_LINE = 0.55;
/** From the floor to the top of the headbox. */
const GATE_HEIGHT = 1.6;
/** The timber headbox the grille winches up into. */
const HEADBOX_DEPTH = 0.32;
/** How far the grille travels: shut, its foot is in the slot; open, it is tucked under the headbox. */
const GRILLE_TRAVEL = GATE_HEIGHT - HEADBOX_DEPTH;
const BARS_PER_TILE = 3;
const BAR_WIDTH = 0.12;
/** Cross rails, as shares of the grille's own height up from its foot. */
const RAIL_SHARES = [0.12, 0.5, 0.86] as const;
const RAIL_THICKNESS = 0.09;
const RIVET_RADIUS = 0.03;
const SPIKE_HEIGHT = 0.16;
/** A shut grille's spear tips sit this deep in the slot. */
const SPIKE_SUNK_SHARE = 0.5;
const SLOT_WIDTH = 0.08;
/** The shadow a shut grille throws on the floor south of it. */
const SHADOW_DEPTH = 0.16;
/** The iron strap round the headbox and its bolts. */
const STRAP_WIDTH = 0.12;
const GRAIN_LINES = 2;
/** A run's end post stands this far in from its tile's outer edge, against the jamb. */
const POST_INSET = 0.14;
/** How far the portcullis's ink reaches from its tile, for culling. */
export const TUTORIAL_PORTCULLIS_REACH_TILES = Math.ceil(GATE_HEIGHT + POST_CAP_HEIGHT + 1);
/** How far above its row's top a face-on portcullis's post caps reach, in tiles. */
export const TUTORIAL_PORTCULLIS_ABOVE_ROW_TILES = GATE_HEIGHT + POST_CAP_HEIGHT - GROUND_LINE;
/** How far past its run's ends a face-on portcullis's post caps reach, in pixels at the game's tile size. */
export const TUTORIAL_PORTCULLIS_OVERHANG_PX = Math.ceil(TILE_SIZE * POST_CAP_OVERHANG);

/**
 * The height above the floor of a grille's foot at `openFraction`, in tiles.
 * A crawler shorter than this walks under it without touching the bars.
 */
export function portcullisClearanceTiles(openFraction: number): number {
  return GRILLE_TRAVEL * Math.max(0, openFraction);
}

/** How much of a spear tip shows below the grille's foot: half sunk in the slot when shut. */
function visibleSpike(ts: number, lift: number): number {
  const sunk = ts * SPIKE_HEIGHT * SPIKE_SUNK_SHARE;
  return Math.min(ts * SPIKE_HEIGHT, sunk + lift);
}

function headboxFace(ctx: Ctx, x: number, y: number, width: number, height: number): void {
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = WOOD_MID;
  ctx.fillRect(x, y + 1, width, Math.max(1, height - 2));
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(x, y + 1, width, Math.max(1, height * HALF * HALF));
  ctx.fillStyle = WOOD_GRAIN;
  for (let line = 1; line <= GRAIN_LINES; line++) {
    const grainY = Math.round(y + (height * line) / (GRAIN_LINES + 1));
    ctx.fillRect(x, grainY, width, 1);
  }
}

function headboxStrap(ctx: Ctx, centreX: number, top: number, height: number, ts: number): void {
  const width = ts * STRAP_WIDTH;
  bar(ctx, centreX, top, top + height, width, ts * BAR_HIGHLIGHT_WIDTH);
  dot(ctx, RIVET, centreX, top + height * HALF * HALF, ts * RIVET_RADIUS);
  dot(ctx, RIVET, centreX, top + height - height * HALF * HALF, ts * RIVET_RADIUS);
}

/**
 * One tile of a face-on portcullis run, its tile's top-left at `(sx, sy)`.
 * `openFraction` runs from 0 (shut) to 1 (wound up into the headbox).
 */
export function drawPortcullisFaceOnTile(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  openFraction: number,
  postAtStart: boolean,
  postAtEnd: boolean,
): void {
  const groundY = sy + ts * GROUND_LINE;
  const topY = groundY - ts * GATE_HEIGHT;
  const headboxBottom = topY + ts * HEADBOX_DEPTH;
  const travel = ts * GRILLE_TRAVEL;
  const lift = ts * portcullisClearanceTiles(openFraction);
  const grilleBottom = groundY - lift;
  const grilleTop = grilleBottom - travel;
  const pitch = ts / BARS_PER_TILE;
  const barWidth = ts * BAR_WIDTH;
  const slot = ts * SLOT_WIDTH;
  const spikeLength = visibleSpike(ts, lift);

  ctx.save();
  ctx.fillStyle = SLOT_DARK;
  ctx.fillRect(sx, groundY - slot * HALF, ts, slot);
  ctx.fillStyle = SLOT_EDGE_LIGHT;
  ctx.fillRect(sx, groundY + slot * HALF, ts, Math.max(1, slot * HALF));
  const shutShare = 1 - Math.min(1, lift / (ts * SHADOW_DEPTH));
  if (shutShare > 0) {
    ctx.globalAlpha = shutShare;
    ctx.fillStyle = CAST_SHADOW;
    ctx.fillRect(sx, groundY + slot * HALF, ts, ts * SHADOW_DEPTH);
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.rect(sx, headboxBottom, ts, grilleBottom + spikeLength - headboxBottom);
  ctx.clip();
  ctx.fillStyle = PANEL_BACKING;
  ctx.fillRect(sx, grilleTop, ts, travel);
  for (let index = 0; index < BARS_PER_TILE; index++) {
    const x = sx + pitch * (index + HALF);
    bar(ctx, x, grilleTop, grilleBottom, barWidth, ts * BAR_HIGHLIGHT_WIDTH);
    spike(ctx, x, grilleBottom, barWidth * HALF, spikeLength);
  }
  for (const share of RAIL_SHARES) {
    const railY = grilleBottom - travel * share - ts * RAIL_THICKNESS;
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
  ctx.restore();

  ctx.save();
  headboxFace(ctx, sx, topY, ts, ts * HEADBOX_DEPTH);
  headboxStrap(ctx, sx + ts * HALF, topY, ts * HEADBOX_DEPTH, ts);
  if (postAtStart) post(ctx, sx + ts * POST_INSET, groundY, ts * GATE_HEIGHT, ts);
  if (postAtEnd) post(ctx, sx + ts - ts * POST_INSET, groundY, ts * GATE_HEIGHT, ts);
  ctx.restore();
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Seen edge-on: the grille's thickness across the hall, and its frame's. */
const SIDE_GRILLE_DEPTH = 0.24;
const SIDE_POST_WIDTH = 0.3;
/** How far a rail's end stands out past the slab on each side. */
const SIDE_RAIL_PROUD = 0.05;
/** The frame stands on the guards' side, west, leaving the grille nearest the crawler held east of it. */
const SIDE_FRAME_SIDE = -1;

const SIDE_SHAPE: EdgeOnPortcullisShape = {
  gateHeight: GATE_HEIGHT,
  lintelThickness: HEADBOX_DEPTH,
  barsPerTile: BARS_PER_TILE,
  grilleDepth: SIDE_GRILLE_DEPTH,
  postWidth: SIDE_POST_WIDTH,
  rivetRadius: RIVET_RADIUS,
  railThickness: RAIL_THICKNESS,
  railProud: SIDE_RAIL_PROUD,
  shadowDepth: SHADOW_DEPTH,
  lintelOverGrille: false,
};

function timberTop(ctx: Ctx, x: number, y: number, width: number, height: number): void {
  headboxFace(ctx, x, y, width, height);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
}

function timberFront(ctx: Ctx, x: number, y: number, width: number, height: number): void {
  headboxFace(ctx, x, y, width, height);
  dot(ctx, RIVET, x + width * HALF, y + height * HALF, Math.max(1, height * HALF * HALF));
}

/**
 * One tile of a portcullis run crossing an east–west hall, its tile's
 * top-left at `(sx, sy)`, seen edge-on like the stealth gate's side doorway:
 * a narrow column of iron rising up-screen from the floor slot, posts at
 * both ends and the timber headbox's top along it. Opening winds the grille's
 * foot up-screen into the headbox, the same rise the face-on gates make.
 */
export function drawPortcullisSideTile(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  openFraction: number,
  postAtStart: boolean,
  postAtEnd: boolean,
): void {
  const liftTiles = portcullisClearanceTiles(openFraction);
  const slot = ts * SLOT_WIDTH;
  const slotX = sx + ts * HALF;
  ctx.save();
  ctx.fillStyle = SLOT_DARK;
  ctx.fillRect(slotX - slot * HALF, sy, slot, ts);
  ctx.fillStyle = SLOT_EDGE_LIGHT;
  ctx.fillRect(slotX + slot * HALF, sy, Math.max(1, slot * HALF), ts);
  ctx.restore();
  drawEdgeOnPortcullisTile(
    ctx,
    sx,
    sy,
    ts,
    SIDE_SHAPE,
    {
      liftTiles,
      railHeights: RAIL_SHARES.map((share) => liftTiles + GRILLE_TRAVEL * share).filter(
        (height) => height < GRILLE_TRAVEL,
      ),
      spikeTiles: visibleSpike(ts, ts * liftTiles) / ts,
      frameSide: SIDE_FRAME_SIDE,
      postAtStart,
      postAtEnd,
    },
    timberTop,
    timberFront,
  );
}

// ── Dust ────────────────────────────────────────────────────────────────────

/** Frames a puff of dust lasts once the grille's foot leaves the floor. */
export const GATE_DUST_FRAMES = 26;
const DUST_PUFFS_PER_TILE = 3;
const DUST_START_RADIUS = 0.1;
const DUST_GROWTH = 0.32;
const DUST_RISE = 0.3;
const DUST_DRIFT = 0.22;
const DUST_PEAK_ALPHA = 0.7;
/** How much puffs differ in size, scaled by each puff's jitter. */
const DUST_SIZE_SPREAD = 0.6;
/** Fixed sideways jitter per puff, so the cloud is uneven without any randomness. */
const DUST_JITTER = [0.3, -0.45, 0.1, 0.5, -0.2, -0.05, 0.4, -0.35, 0.2] as const;

/**
 * Dust kicked off the floor along the line from `(x0, y0)` to `(x1, y1)` as a
 * grille's foot leaves it, `age` frames ago.
 */
export function drawGateDust(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ts: number,
  age: number,
): void {
  if (age < 0 || age >= GATE_DUST_FRAMES) return;
  const life = age / GATE_DUST_FRAMES;
  const lengthTiles = Math.max(1, Math.hypot(x1 - x0, y1 - y0) / ts);
  const puffs = Math.round(lengthTiles * DUST_PUFFS_PER_TILE);
  const fadeOut = 1 - life;
  ctx.save();
  for (let index = 0; index < puffs; index++) {
    const along = (index + HALF) / puffs;
    const jitter = DUST_JITTER[index % DUST_JITTER.length];
    const radius = ts * (DUST_START_RADIUS + DUST_GROWTH * life) * (1 + DUST_SIZE_SPREAD * jitter);
    const x = x0 + (x1 - x0) * along + ts * DUST_DRIFT * jitter * life;
    const y = y0 + (y1 - y0) * along - ts * DUST_RISE * life;
    ctx.fillStyle = `rgba(${DUST_RGB},${(DUST_PEAK_ALPHA * fadeOut).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Low fence, in tiles ──────────────────────────────────────────────────────

const FENCE_GROUND_LINE = 0.55;
/** Short fixed runs against each wall; the rest of the span is the double gate. */
const FENCE_STUB = 0.3;
const FENCE_RAIL_LOW = 0.07;
const FENCE_RAIL_HIGH = 0.26;
const FENCE_PICKET_TOP = 0.32;
const FENCE_POST_HEIGHT = 0.4;
const FENCE_POST_WIDTH = 0.13;
const FENCE_FINIAL_RADIUS = 0.05;
const FENCE_PICKET_PITCH = 0.16;
const FENCE_SPEAR = 0.05;
const FENCE_RAIL_WIDTH = 0.09;
const FENCE_PICKET_WIDTH = 0.06;
const FENCE_SHADOW_DEPTH = 0.07;
/** How far a leaf swings at full open: a little past square, back toward the wall. */
const FENCE_OPEN_ANGLE = Math.PI * 0.56;
const FENCE_LATCH_RADIUS = 0.04;
/** The fence's tallest ink, its finials, above its ground line. */
export const TUTORIAL_FENCE_HEIGHT_TILES = FENCE_POST_HEIGHT + FENCE_FINIAL_RADIUS * 2;

function ironLine(ctx: Ctx, from: Point, to: Point, width: number): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = IRON_SHADOW;
  ctx.lineWidth = width + 1;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.strokeStyle = IRON_MID;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function spearTip(ctx: Ctx, x: number, topY: number, halfWidth: number, height: number): void {
  ctx.fillStyle = IRON_LIGHT;
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, topY);
  ctx.lineTo(x, topY - height);
  ctx.lineTo(x + halfWidth, topY);
  ctx.closePath();
  ctx.fill();
}

function fencePost(ctx: Ctx, x: number, groundY: number, ts: number): void {
  const height = ts * FENCE_POST_HEIGHT;
  bar(ctx, x, groundY - height, groundY, ts * FENCE_POST_WIDTH, ts * BAR_HIGHLIGHT_WIDTH);
  dot(ctx, IRON_SHADOW, x, groundY - height - ts * FENCE_FINIAL_RADIUS, ts * FENCE_FINIAL_RADIUS);
  dot(
    ctx,
    IRON_LIGHT,
    x - ts * FENCE_FINIAL_RADIUS * HALF * HALF,
    groundY - height - ts * FENCE_FINIAL_RADIUS * (1 + HALF * HALF),
    ts * FENCE_FINIAL_RADIUS * HALF,
  );
}

/**
 * A straight run of fence from `from` to `to` along the ground: two rails and
 * spear-topped pickets. Both ends are ground points; the run may lie at any
 * angle, so a swinging leaf is the same drawing as a fixed stub.
 */
function fenceRun(ctx: Ctx, from: Point, to: Point, ts: number, latchAtEnd: boolean): void {
  const lift = (point: Point, h: number): Point => ({ x: point.x, y: point.y - ts * h });
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const pickets = Math.max(1, Math.round(length / (ts * FENCE_PICKET_PITCH)));
  for (let index = 1; index < pickets; index++) {
    const t = index / pickets;
    const foot = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    ironLine(ctx, lift(foot, 0), lift(foot, FENCE_PICKET_TOP), ts * FENCE_PICKET_WIDTH);
    spearTip(
      ctx,
      foot.x,
      foot.y - ts * FENCE_PICKET_TOP,
      ts * FENCE_PICKET_WIDTH,
      ts * FENCE_SPEAR,
    );
  }
  ironLine(ctx, lift(from, FENCE_RAIL_LOW), lift(to, FENCE_RAIL_LOW), ts * FENCE_RAIL_WIDTH);
  ironLine(ctx, lift(from, FENCE_RAIL_HIGH), lift(to, FENCE_RAIL_HIGH), ts * FENCE_RAIL_WIDTH);
  const highFrom = lift(from, FENCE_RAIL_HIGH);
  const highTo = lift(to, FENCE_RAIL_HIGH);
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(highFrom.x, highFrom.y - 1);
  ctx.lineTo(highTo.x, highTo.y - 1);
  ctx.stroke();
  if (latchAtEnd) {
    const latch = lift(to, (FENCE_RAIL_LOW + FENCE_RAIL_HIGH) * HALF);
    ctx.strokeStyle = IRON_LIGHT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(latch.x, latch.y, Math.max(1, ts * FENCE_LATCH_RADIUS), 0, Math.PI * 2);
    ctx.stroke();
  }
}

interface SwingingPairGeometry {
  readonly groundY: number;
  readonly rightX: number;
  readonly hingeLeft: number;
  readonly hingeRight: number;
  readonly reachX: number;
  readonly reachY: number;
}

function fenceGeometry(
  leftX: number,
  rowTopY: number,
  ts: number,
  spanTiles: number,
  swingFraction: number,
): SwingingPairGeometry {
  const rightX = leftX + ts * spanTiles;
  const hingeLeft = leftX + ts * FENCE_STUB;
  const hingeRight = rightX - ts * FENCE_STUB;
  const leafLength = (hingeRight - hingeLeft) * HALF;
  const angle = FENCE_OPEN_ANGLE * swingFraction;
  return {
    groundY: rowTopY + ts * FENCE_GROUND_LINE,
    rightX,
    hingeLeft,
    hingeRight,
    reachX: leafLength * Math.cos(angle),
    reachY: leafLength * Math.sin(angle),
  };
}

/**
 * How far south of its row's top a leaf's free end stands on the floor, in
 * tiles, for a fence `spanTiles` wide swung `swingFraction` open: where the
 * leaf sorts against the bodies walking past it.
 */
export function cellarFenceLeafFootTiles(spanTiles: number, swingFraction: number): number {
  return FENCE_GROUND_LINE + fenceGeometry(0, 0, 1, spanTiles, swingFraction).reachY;
}

/**
 * The knee-high cellar fence's fixed parts across a hall, its row's top-left
 * at `(leftX, rowTopY)` and `spanTiles` wide: the short runs against each
 * wall, the posts, and the shadow under the shut gate, which fades as its
 * leaves swing away.
 */
export function drawCellarFenceFrame(
  ctx: Ctx,
  leftX: number,
  rowTopY: number,
  ts: number,
  spanTiles: number,
  swingFraction: number,
): void {
  const { groundY, rightX, hingeLeft, hingeRight } = fenceGeometry(
    leftX,
    rowTopY,
    ts,
    spanTiles,
    swingFraction,
  );
  ctx.save();
  ctx.fillStyle = CAST_SHADOW;
  ctx.fillRect(leftX, groundY, hingeLeft - leftX, ts * FENCE_SHADOW_DEPTH);
  ctx.fillRect(hingeRight, groundY, rightX - hingeRight, ts * FENCE_SHADOW_DEPTH);
  ctx.globalAlpha = 1 - swingFraction;
  ctx.fillRect(hingeLeft, groundY, hingeRight - hingeLeft, ts * FENCE_SHADOW_DEPTH);
  ctx.globalAlpha = 1;

  fenceRun(ctx, { x: leftX, y: groundY }, { x: hingeLeft, y: groundY }, ts, false);
  fenceRun(ctx, { x: hingeRight, y: groundY }, { x: rightX, y: groundY }, ts, false);
  fencePost(ctx, leftX + ts * FENCE_POST_WIDTH * HALF, groundY, ts);
  fencePost(ctx, rightX - ts * FENCE_POST_WIDTH * HALF, groundY, ts);
  fencePost(ctx, hingeLeft, groundY, ts);
  fencePost(ctx, hingeRight, groundY, ts);
  ctx.restore();
}

export type CellarFenceLeaf = 'west' | 'east';

/**
 * One leaf of the fence's double gate, hung on its post and swung
 * `swingFraction` of the way back south toward its wall. The west leaf
 * carries the latch.
 */
export function drawCellarFenceLeaf(
  ctx: Ctx,
  leftX: number,
  rowTopY: number,
  ts: number,
  spanTiles: number,
  swingFraction: number,
  leaf: CellarFenceLeaf,
): void {
  const { groundY, hingeLeft, hingeRight, reachX, reachY } = fenceGeometry(
    leftX,
    rowTopY,
    ts,
    spanTiles,
    swingFraction,
  );
  ctx.save();
  if (leaf === 'west') {
    const end = { x: hingeLeft + reachX, y: groundY + reachY };
    fenceRun(ctx, { x: hingeLeft, y: groundY }, end, ts, true);
  } else {
    const end = { x: hingeRight - reachX, y: groundY + reachY };
    fenceRun(ctx, { x: hingeRight, y: groundY }, end, ts, false);
  }
  ctx.restore();
}

// ── Cellar door, in tiles ───────────────────────────────────────────────────

const DOOR_GROUND_LINE = 0.55;
/** From the floor to the top of the frame's lintel: tall and solid, nothing like a grille. */
const DOOR_HEIGHT = 1.5;
const DOOR_LINTEL = 0.2;
const DOOR_JAMB_WIDTH = 0.18;
const DOOR_PLANKS_PER_LEAF = 4;
/** The iron straps across each leaf, as shares of the leaf's height up from the floor. */
const DOOR_BAND_SHARES = [0.2, 0.78] as const;
const DOOR_BAND_THICKNESS = 0.09;
const DOOR_RIVET_RADIUS = 0.028;
const DOOR_RING_RADIUS = 0.06;
/** The ring pull's height up the leaf, as a share of it. */
const DOOR_RING_SHARE = 0.48;
/** How far in from a leaf's free edge its ring pull hangs, as a share of the leaf. */
const DOOR_RING_INSET_SHARE = 0.14;
/** A leaf's thickness, seen on its free edge once it swings out of line. */
const DOOR_LEAF_THICKNESS = 0.08;
const DOOR_SHADOW_DEPTH = 0.18;
/** How far a leaf swings at full open: a little past square, back toward the wall. */
const DOOR_OPEN_ANGLE = Math.PI * 0.56;
/** How much a leaf darkens as it turns its face away from the light. */
const DOOR_TURNED_SHADE = 0.45;
const DOOR_TURN_SHADE = 'rgba(0,0,0,1)';
/** The door's tallest ink above its row's top, in tiles. */
export const TUTORIAL_DOOR_ABOVE_ROW_TILES = DOOR_HEIGHT - DOOR_GROUND_LINE;

function doorGeometry(
  leftX: number,
  rowTopY: number,
  ts: number,
  spanTiles: number,
  swingFraction: number,
): SwingingPairGeometry {
  const rightX = leftX + ts * spanTiles;
  const hingeLeft = leftX + ts * DOOR_JAMB_WIDTH;
  const hingeRight = rightX - ts * DOOR_JAMB_WIDTH;
  const leafLength = (hingeRight - hingeLeft) * HALF;
  const angle = DOOR_OPEN_ANGLE * swingFraction;
  return {
    groundY: rowTopY + ts * DOOR_GROUND_LINE,
    rightX,
    hingeLeft,
    hingeRight,
    reachX: leafLength * Math.cos(angle),
    reachY: leafLength * Math.sin(angle),
  };
}

/** How far south of its row's top a door leaf's free edge stands on the floor, in tiles. */
export function cellarDoorLeafFootTiles(spanTiles: number, swingFraction: number): number {
  return DOOR_GROUND_LINE + doorGeometry(0, 0, 1, spanTiles, swingFraction).reachY;
}

/**
 * The cellar door's frame across a hall, its row's top-left at
 * `(leftX, rowTopY)` and `spanTiles` wide: two timber jambs and the lintel
 * over them, and the shadow under the shut leaves, which fades as they open.
 */
export function drawCellarDoorFrame(
  ctx: Ctx,
  leftX: number,
  rowTopY: number,
  ts: number,
  spanTiles: number,
  swingFraction: number,
): void {
  const { groundY, rightX, hingeLeft, hingeRight } = doorGeometry(
    leftX,
    rowTopY,
    ts,
    spanTiles,
    swingFraction,
  );
  const topY = groundY - ts * DOOR_HEIGHT;
  ctx.save();
  ctx.globalAlpha = 1 - swingFraction;
  ctx.fillStyle = CAST_SHADOW;
  ctx.fillRect(hingeLeft, groundY, hingeRight - hingeLeft, ts * DOOR_SHADOW_DEPTH);
  ctx.globalAlpha = 1;
  const jamb = ts * DOOR_JAMB_WIDTH;
  for (const x of [leftX, rightX - jamb]) {
    headboxFace(ctx, x, topY, jamb, groundY - topY);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, topY, jamb, groundY - topY);
  }
  headboxFace(ctx, leftX, topY, rightX - leftX, ts * DOOR_LINTEL);
  ctx.strokeStyle = WOOD_DARK;
  ctx.strokeRect(leftX, topY, rightX - leftX, ts * DOOR_LINTEL);
  for (const x of [leftX + jamb * HALF, rightX - jamb * HALF]) {
    dot(ctx, RIVET, x, topY + ts * DOOR_LINTEL * HALF, ts * DOOR_RIVET_RADIUS);
  }
  ctx.restore();
}

function fillQuad(ctx: Ctx, corners: readonly Point[]): void {
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  });
  ctx.closePath();
  ctx.fill();
}

function lineAcross(ctx: Ctx, from: Point, to: Point, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * One leaf of the cellar door, hung on its jamb and swung `swingFraction` of
 * the way back south toward its wall: iron-strapped planks, solid, with a
 * ring pull near its free edge.
 */
export function drawCellarDoorLeaf(
  ctx: Ctx,
  leftX: number,
  rowTopY: number,
  ts: number,
  spanTiles: number,
  swingFraction: number,
  leaf: CellarFenceLeaf,
): void {
  const { groundY, hingeLeft, hingeRight, reachX, reachY } = doorGeometry(
    leftX,
    rowTopY,
    ts,
    spanTiles,
    swingFraction,
  );
  const hinge = { x: leaf === 'west' ? hingeLeft : hingeRight, y: groundY };
  const free = {
    x: leaf === 'west' ? hingeLeft + reachX : hingeRight - reachX,
    y: groundY + reachY,
  };
  const height = ts * (DOOR_HEIGHT - DOOR_LINTEL);
  const at = (t: number, h: number): Point => ({
    x: hinge.x + (free.x - hinge.x) * t,
    y: hinge.y + (free.y - hinge.y) * t - h,
  });

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.fillStyle = WOOD_MID;
  fillQuad(ctx, [at(0, 0), at(1, 0), at(1, height), at(0, height)]);
  for (let plank = 1; plank < DOOR_PLANKS_PER_LEAF; plank++) {
    const t = plank / DOOR_PLANKS_PER_LEAF;
    lineAcross(ctx, at(t, 0), at(t, height), 1, WOOD_GRAIN);
  }
  lineAcross(ctx, at(0, height), at(1, height), 1, WOOD_LIGHT);
  for (const share of DOOR_BAND_SHARES) {
    const bandHeight = height * share;
    lineAcross(ctx, at(0, bandHeight), at(1, bandHeight), ts * DOOR_BAND_THICKNESS, IRON_SHADOW);
    lineAcross(
      ctx,
      at(0, bandHeight + 1),
      at(1, bandHeight + 1),
      Math.max(1, ts * DOOR_BAND_THICKNESS * HALF),
      IRON_MID,
    );
    for (let plank = 0; plank < DOOR_PLANKS_PER_LEAF; plank++) {
      const rivet = at((plank + HALF) / DOOR_PLANKS_PER_LEAF, bandHeight);
      dot(ctx, RIVET, rivet.x, rivet.y, ts * DOOR_RIVET_RADIUS);
    }
  }
  const ring = at(1 - DOOR_RING_INSET_SHARE, height * DOOR_RING_SHARE);
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, Math.max(1, ts * DOOR_RING_RADIUS), 0, Math.PI * 2);
  ctx.stroke();
  if (swingFraction > 0) {
    ctx.globalAlpha = DOOR_TURNED_SHADE * swingFraction;
    ctx.fillStyle = DOOR_TURN_SHADE;
    fillQuad(ctx, [at(0, 0), at(1, 0), at(1, height), at(0, height)]);
    ctx.globalAlpha = 1;
    const edge = ts * DOOR_LEAF_THICKNESS;
    const edgeTop = at(1, height);
    const edgeFoot = at(1, 0);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(
      leaf === 'west' ? edgeFoot.x : edgeFoot.x - edge,
      edgeTop.y,
      edge,
      edgeFoot.y - edgeTop.y,
    );
  }
  lineAcross(ctx, at(0, 0), at(0, height), 1, WOOD_DARK);
  lineAcross(ctx, at(1, 0), at(1, height), 1, WOOD_DARK);
  ctx.restore();
}
