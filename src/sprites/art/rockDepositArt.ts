/**
 * Drawing engine for the quarry's dressed stone: the `ROCK_DEPOSIT` tiles
 * planted on its ruined wall stubs. The quarry's natural outcrops are painted
 * by `mineableRockArt.ts`.
 *
 * A stub is the ruined structures' squared stone, two or three courses of
 * ashlar in running bond with a broken top course, so the quarry's old walls
 * read as walls that can be mined. Its **worked** state is the same stone (the
 * same seed draws the same geometry) with its top course gone, more
 * pick-scars, bites knocked out of its edges showing pale fresh fracture, and
 * spall at its foot.
 *
 * Every mark lives inside the body: the body is painted first, chips are cut
 * out of it with `destination-out`, surface marks go on with `source-atop` so
 * they can never spray past the silhouette, and the contact shadow goes in last
 * with `destination-over` so it sits under everything already painted. The
 * whole body stays inside `MAX_HALF_WIDTH_TILES` either side of the tile's
 * centre: only the anchor tile blocks, so ink beside it would be ground a
 * crawler could stand on while drawn behind the stone.
 *
 * Light comes from the upper left.
 */

import { mulberry32, range, rangeInt, subSeed, type Rng } from '../person/rng';
import {
  MAX_HALF_WIDTH_TILES,
  MOSS_DARK,
  MOSS_LIGHT,
  rockPalette,
  shade,
  shadeAlpha,
  type Lithology,
  type Palette,
  type RockFrame,
} from './rockArt';

type Ctx = CanvasRenderingContext2D;

export interface DepositSpec {
  readonly lithology: Lithology;
  /** The worked-over look of a deposit past half its capacity. */
  readonly worked: boolean;
}

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

/** How far above the tile's bottom edge the stone's foot sits, so the contact shadow has room below it. */
const BASE_LIFT_TILES = 0.14;

// ── Block shading ─────────────────────────────────────────────────────────────

const FACE_TOP_SHADE = 0.06;
const FACE_BOTTOM_SHADE = -0.2;
/** The right-hand end of each face turns away from the light. */
const SIDE_PLANE_SHADE = -0.26;
const SIDE_PLANE_SHARE = 0.2;
/** The left-hand end catches it. */
const LIT_END_SHADE = 0.1;
const LIT_END_SHARE = 0.12;
const TREAD_FRONT_SHADE = 0.04;
const TREAD_BACK_SHADE = -0.08;
const ARRIS_WIDTH_TILES = 0.03;
const KEYLINE_WIDTH_TILES = 0.06;
const ARRIS_ALPHA = 0.6;

// ── Surface marks ─────────────────────────────────────────────────────────────

const SPECKLE_PER_TILE = 70;
const SPECKLE_RADIUS_TILES = 0.013;
const SPECKLE_ALPHA = 0.28;

const SCARS_WORKED = 7;
const SCAR_LENGTH_TILES_MIN = 0.05;
const SCAR_LENGTH_TILES_RANGE = 0.04;
const SCAR_WIDTH_TILES = 0.028;
const SCAR_ALPHA = 0.9;
const SCAR_LIP_ALPHA = 0.55;
/**
 * Picks swing down and to one side, so their scars slope — all one way on one
 * stone, since one worker's swing comes from one side; scars sloping both ways
 * cross into chalk crosses.
 */
const SCAR_SLOPE_MIN = 0.35;
const SCAR_SLOPE_RANGE = 0.5;
const SCAR_LIGHTEN = 0.42;

// ── Worked damage ─────────────────────────────────────────────────────────────

const CHIPS_WORKED_MIN = 2;
const CHIPS_WORKED_MAX = 3;
const CHIP_SIZE_TILES_MIN = 0.1;
const CHIP_SIZE_TILES_RANGE = 0.06;
/** A chip's floor, as shares of its size: how far it reaches sideways and how deep it bites. */
const CHIP_FLOOR_REACH_MIN = 0.2;
const CHIP_FLOOR_REACH_MAX = 0.7;
const CHIP_DEPTH_MIN = 0.4;
const CHIP_DEPTH_MAX = 0.9;
const CHIP_SHALLOW_DEPTH_MIN = 0.2;
const CHIP_SHALLOW_DEPTH_MAX = 0.6;
/** Fresh fracture is lighter than weathered rind: the stone has not had time to darken. */
const FRACTURE_LIGHTEN = 0.3;
const FRACTURE_ALPHA = 0.8;
const FRACTURE_RIM_TILES = 0.035;
const SPALL_PIECES_MIN = 4;
const SPALL_PIECES_RANGE = 3;
const SPALL_SIZE_TILES_MIN = 0.025;
const SPALL_SIZE_TILES_RANGE = 0.03;
/** Spall lies around the foot, a little in front of it and a little against the face. */
const SPALL_RISE_TILES = 0.04;
const SPALL_DROP_TILES = 0.03;
const SPALL_POINTS = 5;
const SPALL_ANGLE_JITTER = 0.3;
const SPALL_REACH_MIN = 0.6;
/** Flakes lie flat, so they are wider than they are tall from the camera. */
const SPALL_FLATTEN = 0.6;
const SPALL_SHADOW_ALPHA = 0.6;
const SPALL_SHADOW_HALF_WIDTH = 0.6;
const SPALL_SHADOW_HEIGHT = 0.3;
const SPALL_SHADOW_DROP = 0.4;
/** Spall is the body's own stone, a little lighter where it broke fresh; any paler reads as litter. */
const SPALL_SHADE_MIN = -0.05;
const SPALL_SHADE_MAX = 0.18;

// ── Dressed blocks ────────────────────────────────────────────────────────────

const COURSE_HEIGHT_TILES_MIN = 0.19;
const COURSE_HEIGHT_TILES_RANGE = 0.04;
/** Courses standing in an intact stub; the worked look loses its top course. */
const COURSES_FRESH = 3;
const COURSES_WORKED = 2;
const BLOCK_TOP_DEPTH_TILES = 0.08;
/** Bond: every course's joints fall between the joints of the course below. */
const BLOCKS_PER_COURSE = 2;
const JOINT_OFFSET_SHARE_MIN = 0.35;
const JOINT_OFFSET_SHARE_RANGE = 0.3;
/** How much of the top course survives, as a share of the wall's width, measured from the left. */
const TOP_COURSE_SHARE_MIN = 0.35;
const TOP_COURSE_SHARE_RANGE = 0.3;
const BLOCK_SHADE_RANGE = 0.07;
const MORTAR_WIDTH_TILES = 0.024;
const MORTAR_ALPHA = 0.7;
const TOOLING_LINES_PER_BLOCK = 2;
const TOOLING_ALPHA = 0.16;
const TOOLING_WIDTH_TILES = 0.012;
/** Tooling stops short of a block's arrises, which the mason dressed separately. */
const TOOLING_INSET_MIN = 0.1;
const TOOLING_INSET_MAX = 0.3;
/** The broken end of the top course: the drop of its ragged edge, in tiles. */
const BREAK_DROP_TILES = 0.1;
const BLOCK_ROUNDING_TILES = 0.02;
/** Old stone gathers moss on its ledges and along its foot. */
const MOSS_PATCHES = 3;
const MOSS_ALPHA = 0.5;
const MOSS_RADIUS_TILES_MIN = 0.03;
const MOSS_RADIUS_TILES_RANGE = 0.03;
const MOSS_LOBES = 5;
/** Moss spreads along a ledge rather than down its face. */
const MOSS_SPREAD_ALONG_LEDGE = 1.5;
const MOSS_SPREAD_ACROSS_LEDGE = 0.5;
const MOSS_LOBE_SIZE_MIN = 0.4;
const MOSS_LOBE_SIZE_MAX = 0.8;

// ── Contact shadow ────────────────────────────────────────────────────────────

const CONTACT_SHADOW_WIDTH_RATIO = 1.12;
const CONTACT_SHADOW_HEIGHT_TILES = 0.1;
const CONTACT_SHADOW_ALPHA = 0.45;
const CONTACT_SHADOW_MID_STOP = 0.55;
const CONTACT_SHADOW_MID_ALPHA = 0.2;

/** Fixed stream salts, so adding a stream never re-rolls another. */
const SALT_GEOMETRY = 1;
const SALT_SPECKLE = 3;
const SALT_SCARS = 5;
const SALT_CHIPS = 6;
const SALT_SPALL = 7;
const SALT_MOSS = 8;
const SALT_TOOLING = 9;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** One stratum or one block: a front face with a lit top surface above it. */
interface Slab {
  readonly left: number;
  readonly right: number;
  /** Bottom of the front face. */
  readonly faceBottom: number;
  /** Top of the front face, where the lit top surface begins. */
  readonly faceTop: number;
  /** Back edge of the lit top surface. */
  readonly topBack: number;
  /** The front face's top edge, left to right. */
  readonly frontEdge: readonly Point[];
  readonly shade: number;
}

/** The stone's shared frame of reference inside the cell. */
interface Body {
  readonly centreX: number;
  readonly baseY: number;
  readonly halfWidth: number;
  readonly ts: number;
  readonly frame: RockFrame;
}

function bodyFor(frame: RockFrame): Body {
  const ts = frame.tileScale;
  return {
    centreX: frame.originX + ts / 2,
    baseY: frame.originY + ts - ts * BASE_LIFT_TILES,
    halfWidth: ts * MAX_HALF_WIDTH_TILES,
    ts,
    frame,
  };
}

// ── Painting a slab ───────────────────────────────────────────────────────────

function traceFace(ctx: Ctx, slab: Slab, lean: number): void {
  ctx.beginPath();
  ctx.moveTo(slab.left, slab.faceBottom);
  ctx.lineTo(slab.right, slab.faceBottom);
  const edge = slab.frontEdge;
  ctx.lineTo(edge[edge.length - 1].x - lean, edge[edge.length - 1].y);
  for (let i = edge.length - 2; i >= 1; i--) ctx.lineTo(edge[i].x, edge[i].y);
  ctx.lineTo(edge[0].x + lean, edge[0].y);
  ctx.closePath();
}

function traceTop(ctx: Ctx, slab: Slab, lean: number): void {
  const edge = slab.frontEdge;
  const inset = lean * 2;
  ctx.beginPath();
  ctx.moveTo(edge[0].x + lean, edge[0].y);
  for (let i = 1; i < edge.length - 1; i++) ctx.lineTo(edge[i].x, edge[i].y);
  ctx.lineTo(edge[edge.length - 1].x - lean, edge[edge.length - 1].y);
  ctx.lineTo(slab.right - inset, slab.topBack);
  ctx.lineTo(slab.left + inset, slab.topBack);
  ctx.closePath();
}

/**
 * One slab: its lit top, then its front face shaded top to bottom and turned
 * away from the light at its right-hand end, then the crisp arris where the
 * two meet — the one line that makes a stack of fills read as a stepped ledge.
 */
function paintSlab(ctx: Ctx, slab: Slab, palette: Palette, ts: number, lean: number): void {
  // A dark keyline round the whole slab first: grey stone on grey scree has
  // no value contrast of its own, and at one tile it dissolves without it.
  ctx.strokeStyle = palette.crack;
  ctx.lineWidth = ts * KEYLINE_WIDTH_TILES;
  ctx.lineJoin = 'round';
  traceTop(ctx, slab, lean);
  ctx.stroke();
  traceFace(ctx, slab, lean);
  ctx.stroke();

  const top = ctx.createLinearGradient(0, slab.faceTop, 0, slab.topBack);
  top.addColorStop(0, shade(palette.light, TREAD_FRONT_SHADE + slab.shade));
  top.addColorStop(1, shade(palette.light, TREAD_BACK_SHADE + slab.shade));
  ctx.fillStyle = top;
  traceTop(ctx, slab, lean);
  ctx.fill();

  ctx.save();
  traceFace(ctx, slab, lean);
  ctx.clip();
  const face = ctx.createLinearGradient(0, slab.faceTop, 0, slab.faceBottom);
  face.addColorStop(0, shade(palette.body, FACE_TOP_SHADE + slab.shade));
  face.addColorStop(1, shade(palette.body, FACE_BOTTOM_SHADE + slab.shade));
  ctx.fillStyle = face;
  const faceHeight = slab.faceBottom - slab.topBack;
  ctx.fillRect(slab.left, slab.topBack, slab.right - slab.left, faceHeight);
  const width = slab.right - slab.left;
  ctx.fillStyle = shadeAlpha(palette.shadow, slab.shade, -SIDE_PLANE_SHADE);
  ctx.fillRect(slab.right - width * SIDE_PLANE_SHARE, slab.topBack, width, faceHeight);
  ctx.fillStyle = shadeAlpha(palette.rim, slab.shade, LIT_END_SHADE);
  ctx.fillRect(slab.left, slab.topBack, width * LIT_END_SHARE, faceHeight);
  ctx.restore();

  ctx.strokeStyle = shade(palette.rim, slab.shade);
  ctx.globalAlpha = ARRIS_ALPHA;
  ctx.lineWidth = ts * ARRIS_WIDTH_TILES;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const edge = slab.frontEdge;
  ctx.moveTo(edge[0].x + lean, edge[0].y);
  for (let i = 1; i < edge.length - 1; i++) ctx.lineTo(edge[i].x, edge[i].y);
  ctx.lineTo(edge[edge.length - 1].x - lean, edge[edge.length - 1].y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Painting the marks ────────────────────────────────────────────────────────

interface Extent {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function paintSpeckle(ctx: Ctx, extent: Extent, palette: Palette, ts: number, rng: Rng): void {
  const area = ((extent.right - extent.left) * (extent.bottom - extent.top)) / (ts * ts);
  const total = Math.round(SPECKLE_PER_TILE * area);
  const radius = ts * SPECKLE_RADIUS_TILES;
  ctx.globalAlpha = SPECKLE_ALPHA;
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = rng() > HALF ? palette.light : palette.shadow;
    ctx.beginPath();
    ctx.arc(
      range(rng, extent.left, extent.right),
      range(rng, extent.top, extent.bottom),
      radius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Pick-scars: each a short pale gouge with a dark lip under it. */
function paintScars(
  ctx: Ctx,
  extent: Extent,
  palette: Palette,
  ts: number,
  count: number,
  rng: Rng,
): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = ts * SCAR_WIDTH_TILES;
  const swingSide = rng() < HALF ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const length = ts * (SCAR_LENGTH_TILES_MIN + rng() * SCAR_LENGTH_TILES_RANGE);
    const slope = swingSide * (SCAR_SLOPE_MIN + rng() * SCAR_SLOPE_RANGE);
    const x = range(rng, extent.left + length / 2, extent.right - length / 2);
    const y = range(rng, extent.top, extent.bottom);
    const dx = length / 2 / Math.hypot(1, slope);
    const dy = dx * slope;
    const lip = ts * SCAR_WIDTH_TILES;
    ctx.strokeStyle = shadeAlpha(palette.crack, 0, SCAR_LIP_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy + lip);
    ctx.lineTo(x + dx, y + dy + lip);
    ctx.stroke();
    ctx.strokeStyle = shadeAlpha(palette.rim, SCAR_LIGHTEN, SCAR_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
}

/**
 * Knocks chunks out of the stone's upper corners and edges, then paints the
 * pale fresh fracture those bites expose. Chips come off where a pick lands:
 * on the arrises, not in the middle of a face.
 */
function chipEdges(
  ctx: Ctx,
  corners: readonly Point[],
  palette: Palette,
  ts: number,
  rng: Rng,
): void {
  const count = rangeInt(rng, CHIPS_WORKED_MIN, CHIPS_WORKED_MAX);
  const bites: Array<{ at: Point; size: number }> = [];
  for (let i = 0; i < count && corners.length > 0; i++) {
    const at = corners[rangeInt(rng, 0, corners.length - 1)];
    bites.push({ at, size: ts * (CHIP_SIZE_TILES_MIN + rng() * CHIP_SIZE_TILES_RANGE) });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const { at, size } of bites) {
    ctx.beginPath();
    ctx.moveTo(at.x - size, at.y - size);
    ctx.lineTo(at.x + size, at.y - size);
    ctx.lineTo(
      at.x + size * range(rng, CHIP_FLOOR_REACH_MIN, CHIP_FLOOR_REACH_MAX),
      at.y + size * range(rng, CHIP_DEPTH_MIN, CHIP_DEPTH_MAX),
    );
    ctx.lineTo(
      at.x - size * range(rng, CHIP_FLOOR_REACH_MIN, CHIP_FLOOR_REACH_MAX),
      at.y + size * range(rng, CHIP_SHALLOW_DEPTH_MIN, CHIP_SHALLOW_DEPTH_MAX),
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = shadeAlpha(palette.light, FRACTURE_LIGHTEN, FRACTURE_ALPHA);
  for (const { at, size } of bites) {
    ctx.beginPath();
    ctx.arc(at.x, at.y + size * HALF, size * HALF + ts * FRACTURE_RIM_TILES, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Spall at the stone's foot: flakes a pick has knocked off, lying where they fell. */
function paintSpall(ctx: Ctx, body: Body, palette: Palette, rng: Rng): void {
  const { ts } = body;
  const pieces = SPALL_PIECES_MIN + rangeInt(rng, 0, SPALL_PIECES_RANGE);
  for (let i = 0; i < pieces; i++) {
    const size = ts * (SPALL_SIZE_TILES_MIN + rng() * SPALL_SIZE_TILES_RANGE);
    const x = range(
      rng,
      body.centreX - body.halfWidth + size,
      body.centreX + body.halfWidth - size,
    );
    const y = body.baseY + range(rng, -ts * SPALL_RISE_TILES, ts * SPALL_DROP_TILES);
    ctx.fillStyle = shade(palette.body, range(rng, SPALL_SHADE_MIN, SPALL_SHADE_MAX));
    ctx.beginPath();
    for (let p = 0; p < SPALL_POINTS; p++) {
      const angle =
        (p / SPALL_POINTS) * TWO_PI + range(rng, -SPALL_ANGLE_JITTER, SPALL_ANGLE_JITTER);
      const reach = size * range(rng, SPALL_REACH_MIN, 1);
      const px = x + Math.cos(angle) * reach;
      const py = y + Math.sin(angle) * reach * SPALL_FLATTEN;
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // Each flake's own shadow, a sliver under its lower edge.
    ctx.fillStyle = shadeAlpha(palette.shadow, 0, SPALL_SHADOW_ALPHA);
    const shadowHalfWidth = size * SPALL_SHADOW_HALF_WIDTH;
    const shadowHeight = Math.max(1, size * SPALL_SHADOW_HEIGHT);
    ctx.fillRect(
      x - shadowHalfWidth,
      y + size * SPALL_SHADOW_DROP,
      shadowHalfWidth * 2,
      shadowHeight,
    );
  }
}

function paintMoss(ctx: Ctx, ledges: readonly Point[], ts: number, rng: Rng): void {
  ctx.globalAlpha = MOSS_ALPHA;
  for (let patch = 0; patch < MOSS_PATCHES && ledges.length > 0; patch++) {
    const at = ledges[rangeInt(rng, 0, ledges.length - 1)];
    const radius = ts * (MOSS_RADIUS_TILES_MIN + rng() * MOSS_RADIUS_TILES_RANGE);
    ctx.fillStyle = rng() < HALF ? MOSS_DARK : MOSS_LIGHT;
    ctx.beginPath();
    for (let lobe = 0; lobe < MOSS_LOBES; lobe++) {
      const lx = at.x + range(rng, -radius, radius) * MOSS_SPREAD_ALONG_LEDGE;
      const ly = at.y + range(rng, -radius, radius) * MOSS_SPREAD_ACROSS_LEDGE;
      const size = radius * range(rng, MOSS_LOBE_SIZE_MIN, MOSS_LOBE_SIZE_MAX);
      ctx.moveTo(lx + size, ly);
      ctx.arc(lx, ly, size, 0, TWO_PI);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Goes under everything already painted, so it can be the last thing drawn. */
function paintContactShadow(ctx: Ctx, body: Body): void {
  const rx = body.halfWidth * CONTACT_SHADOW_WIDTH_RATIO;
  const ry = Math.min(body.ts * CONTACT_SHADOW_HEIGHT_TILES, body.frame.bottomY - body.baseY);
  if (rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.translate(body.centreX, body.baseY);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
  gradient.addColorStop(CONTACT_SHADOW_MID_STOP, `rgba(0,0,0,${CONTACT_SHADOW_MID_ALPHA})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function extentOf(slabs: readonly Slab[]): Extent {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const slab of slabs) {
    left = Math.min(left, slab.left);
    right = Math.max(right, slab.right);
    top = Math.min(top, slab.topBack);
    bottom = Math.max(bottom, slab.faceBottom);
  }
  return { left, right, top, bottom };
}

/** The upper corners of every slab's front face: where a pick bites. */
function cornersOf(slabs: readonly Slab[]): Point[] {
  const corners: Point[] = [];
  for (const slab of slabs) {
    corners.push({ x: slab.left, y: slab.faceTop }, { x: slab.right, y: slab.faceTop });
  }
  return corners;
}

/** Marks that must stay on the stone, laid over it with `source-atop`. */
function onTheStone(ctx: Ctx, paint: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

// ── Dressed blocks ────────────────────────────────────────────────────────────

/**
 * The courses of a ruined wall stub, bottom first. Every course but the top
 * spans the whole width in two blocks; the top course survives only on the
 * left, and its last block ends in a ragged break.
 */
function buildCourses(body: Body, courses: number, rng: Rng): Slab[][] {
  const { ts, centreX, baseY } = body;
  const left = centreX - body.halfWidth;
  const right = centreX + body.halfWidth;
  const width = right - left;
  const courseHeight = ts * (COURSE_HEIGHT_TILES_MIN + rng() * COURSE_HEIGHT_TILES_RANGE);
  const topDepth = ts * BLOCK_TOP_DEPTH_TILES;
  const topShare = TOP_COURSE_SHARE_MIN + rng() * TOP_COURSE_SHARE_RANGE;
  const rows: Slab[][] = [];
  for (let course = 0; course < COURSES_FRESH; course++) {
    const faceBottom = baseY - course * courseHeight;
    const faceTop = faceBottom - courseHeight;
    const jointShare = JOINT_OFFSET_SHARE_MIN + rng() * JOINT_OFFSET_SHARE_RANGE;
    const isTop = course === COURSES_FRESH - 1;
    const courseRight = isTop ? left + width * topShare : right;
    const joints = [left];
    for (let block = 1; block < BLOCKS_PER_COURSE; block++) {
      joints.push(left + (courseRight - left) * (course % 2 === 0 ? jointShare : 1 - jointShare));
    }
    joints.push(courseRight);
    const row: Slab[] = [];
    for (let block = 0; block + 1 < joints.length; block++) {
      const blockLeft = joints[block];
      const blockRight = joints[block + 1];
      const broken = isTop && block + 1 === joints.length - 1;
      const frontEdge: Point[] = broken
        ? [
            { x: blockLeft, y: faceTop },
            { x: (blockLeft + blockRight) / 2, y: faceTop + range(rng, 0, ts * BREAK_DROP_TILES) },
            { x: blockRight, y: faceTop + ts * BREAK_DROP_TILES },
          ]
        : [
            { x: blockLeft, y: faceTop },
            { x: blockRight, y: faceTop },
          ];
      row.push({
        left: blockLeft,
        right: blockRight,
        faceBottom,
        faceTop,
        topBack: faceTop - topDepth,
        frontEdge,
        shade: range(rng, -BLOCK_SHADE_RANGE, BLOCK_SHADE_RANGE),
      });
    }
    rows.push(row);
  }
  // Drawn from the same stream whether or not the top course stands, so the
  // worked stub is the same wall with its top knocked off.
  return rows.slice(0, courses);
}

function paintMortar(ctx: Ctx, rows: readonly Slab[][], palette: Palette, ts: number): void {
  ctx.strokeStyle = shadeAlpha(palette.crack, 0, MORTAR_ALPHA);
  ctx.lineWidth = ts * MORTAR_WIDTH_TILES;
  for (const row of rows) {
    for (const block of row) {
      ctx.beginPath();
      ctx.moveTo(block.left, block.faceBottom);
      ctx.lineTo(block.right, block.faceBottom);
      ctx.stroke();
      if (block !== row[0]) {
        ctx.beginPath();
        ctx.moveTo(block.left, block.topBack);
        ctx.lineTo(block.left, block.faceBottom);
        ctx.stroke();
      }
    }
  }
}

/** Faint horizontal tooling on each face: the mason's claw chisel, long since weathered. */
function paintTooling(
  ctx: Ctx,
  rows: readonly Slab[][],
  palette: Palette,
  ts: number,
  rng: Rng,
): void {
  ctx.strokeStyle = shadeAlpha(palette.shadow, 0, TOOLING_ALPHA);
  ctx.lineWidth = ts * TOOLING_WIDTH_TILES;
  for (const row of rows) {
    for (const block of row) {
      for (let line = 0; line < TOOLING_LINES_PER_BLOCK; line++) {
        const y = range(rng, block.faceTop, block.faceBottom);
        const inset = (block.right - block.left) * range(rng, TOOLING_INSET_MIN, TOOLING_INSET_MAX);
        ctx.beginPath();
        ctx.moveTo(block.left + inset, y);
        ctx.lineTo(block.right - inset, y);
        ctx.stroke();
      }
    }
  }
}

function drawDressed(ctx: Ctx, spec: DepositSpec, seed: number, body: Body): void {
  const palette = rockPalette(spec.lithology);
  const { ts } = body;
  const courses = spec.worked ? COURSES_WORKED : COURSES_FRESH;
  const rows = buildCourses(body, courses, mulberry32(subSeed(seed, SALT_GEOMETRY)));
  const blocks = rows.flat();
  const lean = ts * BLOCK_ROUNDING_TILES;
  for (const block of blocks) paintSlab(ctx, block, palette, ts, lean);
  const extent = extentOf(blocks);
  const ledges = blocks.map((block) => ({ x: (block.left + block.right) / 2, y: block.faceTop }));
  onTheStone(ctx, () => {
    paintMortar(ctx, rows, palette, ts);
    paintTooling(ctx, rows, palette, ts, mulberry32(subSeed(seed, SALT_TOOLING)));
    paintSpeckle(ctx, extent, palette, ts, mulberry32(subSeed(seed, SALT_SPECKLE)));
    paintMoss(ctx, ledges, ts, mulberry32(subSeed(seed, SALT_MOSS)));
    if (spec.worked) {
      paintScars(ctx, extent, palette, ts, SCARS_WORKED, mulberry32(subSeed(seed, SALT_SCARS)));
    }
  });
  if (spec.worked) {
    chipEdges(ctx, cornersOf(blocks), palette, ts, mulberry32(subSeed(seed, SALT_CHIPS)));
    paintSpall(ctx, body, palette, mulberry32(subSeed(seed, SALT_SPALL)));
  }
  paintContactShadow(ctx, body);
}

/** Paints one deposit into its cell. */
export function drawRockDeposit(ctx: Ctx, spec: DepositSpec, seed: number, frame: RockFrame): void {
  const body = bodyFor(frame);
  ctx.save();
  try {
    drawDressed(ctx, spec, seed, body);
  } finally {
    ctx.restore();
  }
}
