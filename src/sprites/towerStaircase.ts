/**
 * A medieval newel stair — the stone spiral a tower actually has: wedge-shaped
 * treads cantilevered off a solid central newel, wound round inside a drum of
 * coursed masonry.
 *
 * Drawn as an **overlay**. The caller paints the room's own floor first and this
 * adds the masonry on top, so the room's floor runs up to the stair's foot rather
 * than the stair standing on a patch of its own colour. Nothing here fills the
 * tile background. The stair is all cool grey ashlar, with no timber, carpet or
 * metalwork, so it reads as part of the tower's fabric rather than furniture
 * carried into it.
 *
 * The block is drawn in full for every tile of it, clipped to that tile, so the
 * curves cross the tile seams as single continuous lines rather than four
 * unrelated quarter-patterns.
 *
 * The two directions are two different views of one structure:
 *
 * - **Up** stands in the room, drawn the way the game draws anything with height:
 *   the plan squashed into a 3/4 view and every point lifted up the screen by its
 *   height. The treads climb a three-quarter turn round the newel against the
 *   drum's back wall, which is cut away at the front so the steps can be seen.
 * - **Down** is a hole, seen in one-point perspective from just above it: the
 *   drum's inner wall, the newel and every tread are projected toward a vanishing
 *   point below the floor, so the flight winds inward and shrinks as it descends,
 *   darkening until the bottom of the well is black.
 */

/** Everything below is a fraction of the block's pixel size, so the art scales with tile size. */

/** How round things on the floor are flattened by the 3/4 view. */
const PLAN_SQUASH = 0.72;

/** The tower's grey ashlar, the same stone as `interior_stone` in `src/map/town/interiorMaterials.ts`. */
const STONE: Rgb = [151, 151, 157];
const MORTAR: Rgb = [52, 52, 58];
const WELL_BLACK = '#060609';

/** The key light comes from the upper left, as everywhere else in the game. */
const LIGHT_ANGLE = -Math.PI * 0.75;
/** How strongly a surface's turn toward or away from the light changes its tone. */
const FACING_CONTRAST = 0.26;
const TREAD_LIGHT = 1.08;
const RISER_LIGHT = 0.7;
const NOSING_LIGHTEN = 1.3;
const NOSING_ALPHA = 0.85;
const MORTAR_ALPHA = 0.5;
const LINE_WIDTH_SHARE = 0.012;
/** Steps per radian along an arc when tracing curves as polylines. */
const ARC_SEGMENTS_PER_RADIAN = 6;
/** A step is worn into a hollow along the line most feet take, two-thirds of the way out. */
const WEAR_INNER = 0.48;
const WEAR_OUTER = 0.82;
const WEAR_LIGHTEN = 1.08;
/** The share of a descending tread shaded by the nosing of the tread above it. */
const HEEL_SHADOW_SHARE = 0.3;
const HEEL_SHADOW_ALPHA = 0.3;

// ── Up: a stair standing in the room ────────────────────────────────────────

const UP_CENTRE_X = 0.5;
const UP_CENTRE_Y = 0.7;
const UP_OUTER_R = 0.38;
const UP_NEWEL_R = 0.075;
const UP_TREAD_COUNT = 11;
/** A three-quarter turn: up the east side, across the back, down the west. */
const UP_SWEEP = Math.PI * 1.5;
/** The flight starts at the front, where the player walks onto it. */
const UP_START_ANGLE = Math.PI / 2;
/** Height of the top tread, which is as high as the block leaves room to draw. */
const UP_TOTAL_RISE = 0.36;
/** Thickness of each cantilevered tread slab, seen as its front edge. */
const UP_SLAB_THICKNESS = 0.035;
/** The drum's back wall stands this far above the top tread. */
const UP_WALL_OVERHANG = 0.04;
const UP_WALL_THICKNESS = 0.04;
const UP_WALL_COURSE_HEIGHT = 0.07;
const UP_WALL_BLOCK_ANGLE = Math.PI / 7;
const UP_WALL_LIGHT = 0.82;
const UP_NEWEL_CAP_RISE = 0.04;
const UP_SHADOW_ALPHA = 0.32;
const UP_SHADOW_DROP = 0.03;
/** The drum's back wall runs from due west, round the back, to due east. */
const UP_WALL_START = -Math.PI;
const UP_WALL_END = 0;
/** Daylight down the well from the storey above, falling on the top of the flight. */
const UP_LIGHT_POOL_RX = 0.2;
const UP_LIGHT_POOL_ALPHA = 0.18;
const UP_LIGHT_POOL_COLOR = '255, 236, 196';

// ── Down: a stair going into a hole in the floor ────────────────────────────

const DOWN_CENTRE_X = 0.5;
const DOWN_CENTRE_Y = 0.5;
const DOWN_OUTER_R = 0.4;
const DOWN_NEWEL_R = 0.07;
/** The kerb round the hole, standing a little proud of the floor. */
const DOWN_KERB_WIDTH = 0.05;
const DOWN_KERB_HEIGHT = 0.025;
const DOWN_KERB_FACE_LIGHT = 0.62;
/**
 * The vanishing point sits a little south of the hole's centre — the eye of a
 * crawler standing at its near edge — so the far side of the well's wall shows
 * as a face and the near side tucks under the kerb.
 */
const DOWN_VANISH_OFFSET_Y = 0.06;
/** Depth at which the picture has shrunk to half size. */
const DOWN_HALF_SCALE_DEPTH = 0.5;
const DOWN_TREAD_COUNT = 13;
/** One turn: the treads of the turn below are hidden under these, as in a real newel stair. */
const DOWN_SWEEP = Math.PI * 2;
const DOWN_START_ANGLE = Math.PI / 2;
const DOWN_TREAD_RISE = 0.034;
const DOWN_WALL_COURSE_DEPTH = 0.06;
const DOWN_WALL_SEGMENTS = 28;
/** Masonry blocks per course, round the full circle. */
const DOWN_WALL_BLOCKS = 14;
const DOWN_LIGHT_FALLOFF_DEPTH = 0.36;
const DOWN_LIGHT_FLOOR = 0.04;
const DOWN_WALL_LIGHT = 0.78;
/** The kerb's shadow on the shaft wall just below it. */
const DOWN_LIP_SHADOW_ALPHA = 0.45;

type Rgb = readonly [number, number, number];
type Ctx = CanvasRenderingContext2D;

interface Point {
  readonly x: number;
  readonly y: number;
}

function stone(light: number, alpha = 1, color: Rgb = STONE): string {
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value * light)));
  return `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${alpha})`;
}

/** How much a surface facing `angle` (in plan) is turned toward the key light: -1 to 1. */
function facingLight(angle: number): number {
  return Math.cos(angle - LIGHT_ANGLE);
}

function tracePolyline(ctx: Ctx, points: ReadonlyArray<Point>, close: boolean): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (close) ctx.closePath();
}

function arcSteps(from: number, to: number): number {
  return Math.max(2, Math.ceil(Math.abs(to - from) * ARC_SEGMENTS_PER_RADIAN));
}

/** Points along an arc from one angle to another, mapped through `place`. */
function arc(from: number, to: number, place: (angle: number) => Point): Point[] {
  const steps = arcSteps(from, to);
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) points.push(place(from + ((to - from) * i) / steps));
  return points;
}

/** The tile block one staircase occupies: its top-left tile and its span on each axis. */
export interface StairBlock {
  readonly x: number;
  readonly y: number;
  readonly span: number;
}

/**
 * Paint one tile of a tower staircase over whatever floor is already there.
 *
 * @param sx Screen x of the tile being painted.
 * @param sy Screen y of the tile being painted.
 * @param tx Tile column being painted.
 * @param ty Tile row being painted.
 */
export function drawTowerStaircaseTile(
  ctx: Ctx,
  isUp: boolean,
  stair: StairBlock,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const blockSx = sx - (tx - stair.x) * ts;
  const blockSy = sy - (ty - stair.y) * ts;
  const block = ts * stair.span;

  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  ctx.translate(blockSx, blockSy);
  ctx.lineJoin = 'round';
  if (isUp) drawRisingFlight(ctx, block);
  else drawDescendingFlight(ctx, block);
  ctx.restore();
}

// ── Up ──────────────────────────────────────────────────────────────────────

interface UpTread {
  readonly from: number;
  readonly to: number;
  /** Height of the tread's top face. */
  readonly height: number;
}

function drawRisingFlight(ctx: Ctx, block: number): void {
  const cx = block * UP_CENTRE_X;
  const cy = block * UP_CENTRE_Y;
  const outer = block * UP_OUTER_R;
  const newel = block * UP_NEWEL_R;
  const lineWidth = Math.max(1, block * LINE_WIDTH_SHARE);
  const totalRise = block * UP_TOTAL_RISE;

  /** A point in the drum at `radius` and `angle` in plan, `height` above the floor. */
  const at = (radius: number, angle: number, height: number): Point => ({
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius * PLAN_SQUASH - height,
  });

  // Contact shadow, thrown down and right of the drum's foot.
  ctx.beginPath();
  ctx.ellipse(
    cx + block * UP_SHADOW_DROP,
    cy + block * UP_SHADOW_DROP,
    outer,
    outer * PLAN_SQUASH,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(0, 0, 0, ${UP_SHADOW_ALPHA})`;
  ctx.fill();

  drawUpDrumWall(ctx, at, block, outer, totalRise + block * UP_WALL_OVERHANG, lineWidth);

  const pitch = UP_SWEEP / UP_TREAD_COUNT;
  const treads: UpTread[] = [];
  for (let i = 0; i < UP_TREAD_COUNT; i++) {
    treads.push({
      from: UP_START_ANGLE - i * pitch,
      to: UP_START_ANGLE - (i + 1) * pitch,
      height: (totalRise * (i + 1)) / UP_TREAD_COUNT,
    });
  }
  const riserHeight = totalRise / UP_TREAD_COUNT;

  // Back to front, so a nearer tread overlaps one behind it; the newel takes
  // its turn at the drum's centre line.
  const planDepth = (tread: UpTread): number => Math.sin((tread.from + tread.to) / 2);
  const ordered = [...treads].sort((a, b) => planDepth(a) - planDepth(b) || a.height - b.height);
  const behindNewel = ordered.filter((tread) => planDepth(tread) <= 0);
  const beforeNewel = ordered.filter((tread) => planDepth(tread) > 0);
  for (const tread of behindNewel) {
    drawUpTread(ctx, at, tread, outer, newel, riserHeight, block, lineWidth);
  }
  drawUpNewel(ctx, at, newel, totalRise + block * UP_NEWEL_CAP_RISE, lineWidth);
  for (const tread of beforeNewel) {
    drawUpTread(ctx, at, tread, outer, newel, riserHeight, block, lineWidth);
  }

  const top = treads[treads.length - 1];
  const poolCentre = at((outer + newel) / 2, (top.from + top.to) / 2, top.height);
  const poolRx = block * UP_LIGHT_POOL_RX;
  const pool = ctx.createRadialGradient(
    poolCentre.x,
    poolCentre.y,
    0,
    poolCentre.x,
    poolCentre.y,
    poolRx,
  );
  pool.addColorStop(0, `rgba(${UP_LIGHT_POOL_COLOR}, ${UP_LIGHT_POOL_ALPHA})`);
  pool.addColorStop(1, `rgba(${UP_LIGHT_POOL_COLOR}, 0)`);
  ctx.fillStyle = pool;
  ctx.fillRect(poolCentre.x - poolRx, poolCentre.y - poolRx, poolRx * 2, poolRx * 2);
}

/** The drum's back half: its inner face in courses, and the wall head along the top. */
function drawUpDrumWall(
  ctx: Ctx,
  at: (radius: number, angle: number, height: number) => Point,
  block: number,
  outer: number,
  wallHeight: number,
  lineWidth: number,
): void {
  const courseHeight = block * UP_WALL_COURSE_HEIGHT;
  const courses = Math.ceil(wallHeight / courseHeight);
  for (let course = 0; course < courses; course++) {
    const low = course * courseHeight;
    const high = Math.min(wallHeight, low + courseHeight);
    const stagger = course % 2 === 0 ? 0 : UP_WALL_BLOCK_ANGLE / 2;
    for (let start = UP_WALL_START - stagger; start < UP_WALL_END; start += UP_WALL_BLOCK_ANGLE) {
      const from = Math.max(UP_WALL_START, start);
      const to = Math.min(UP_WALL_END, start + UP_WALL_BLOCK_ANGLE);
      if (to <= from) continue;
      // The inner face looks back toward the centre, so it faces the opposite way to its angle.
      const facing = facingLight((from + to) / 2 + Math.PI);
      const shade = UP_WALL_LIGHT * (1 + facing * FACING_CONTRAST);
      const outline = [
        ...arc(from, to, (angle) => at(outer, angle, low)),
        ...arc(to, from, (angle) => at(outer, angle, high)),
      ];
      tracePolyline(ctx, outline, true);
      ctx.fillStyle = stone(shade);
      ctx.fill();
      ctx.strokeStyle = stone(1, MORTAR_ALPHA, MORTAR);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  // The wall head: the top of the masonry, a band seen from above.
  const thickness = block * UP_WALL_THICKNESS;
  const head = [
    ...arc(UP_WALL_START, UP_WALL_END, (angle) => at(outer, angle, wallHeight)),
    ...arc(UP_WALL_END, UP_WALL_START, (angle) => at(outer + thickness, angle, wallHeight)),
  ];
  tracePolyline(ctx, head, true);
  ctx.fillStyle = stone(TREAD_LIGHT);
  ctx.fill();
  ctx.strokeStyle = stone(1, MORTAR_ALPHA, MORTAR);
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  // The wall's cut ends, where the cutaway opens the front of the drum.
  for (const angle of [UP_WALL_START, UP_WALL_END]) {
    const end = [
      at(outer, angle, 0),
      at(outer + thickness, angle, 0),
      at(outer + thickness, angle, wallHeight),
      at(outer, angle, wallHeight),
    ];
    tracePolyline(ctx, end, true);
    ctx.fillStyle = stone(RISER_LIGHT);
    ctx.fill();
    ctx.stroke();
  }
}

function drawUpNewel(
  ctx: Ctx,
  at: (radius: number, angle: number, height: number) => Point,
  radius: number,
  height: number,
  lineWidth: number,
): void {
  const foot = at(0, 0, 0);
  const head = at(0, 0, height);
  const shaft = ctx.createLinearGradient(foot.x - radius, 0, foot.x + radius, 0);
  shaft.addColorStop(0, stone(1.05));
  shaft.addColorStop(1, stone(RISER_LIGHT * 0.85));
  ctx.fillStyle = shaft;
  ctx.fillRect(foot.x - radius, head.y, radius * 2, foot.y - head.y);
  ctx.beginPath();
  ctx.ellipse(head.x, head.y, radius, radius * PLAN_SQUASH, 0, 0, Math.PI * 2);
  ctx.fillStyle = stone(TREAD_LIGHT);
  ctx.fill();
  ctx.strokeStyle = stone(1, MORTAR_ALPHA, MORTAR);
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawUpTread(
  ctx: Ctx,
  at: (radius: number, angle: number, height: number) => Point,
  tread: UpTread,
  outer: number,
  newel: number,
  riserHeight: number,
  block: number,
  lineWidth: number,
): void {
  const slab = block * UP_SLAB_THICKNESS;
  const { from, to, height } = tread;

  // The riser under the tread's lower edge, seen only where that edge turns toward the viewer.
  if (Math.cos(from) > 0) {
    const riser = [
      at(newel, from, height - riserHeight),
      at(outer, from, height - riserHeight),
      at(outer, from, height),
      at(newel, from, height),
    ];
    tracePolyline(ctx, riser, true);
    ctx.fillStyle = stone(RISER_LIGHT * (1 + facingLight(from + Math.PI / 2) * FACING_CONTRAST));
    ctx.fill();
  }

  // The slab's curved outer edge, wherever it faces the viewer.
  const edgeFrom = Math.max(Math.min(from, to), 0);
  const edgeTo = Math.min(Math.max(from, to), Math.PI);
  if (edgeTo > edgeFrom) {
    const edge = [
      ...arc(edgeFrom, edgeTo, (angle) => at(outer, angle, height)),
      ...arc(edgeTo, edgeFrom, (angle) => at(outer, angle, height - slab)),
    ];
    tracePolyline(ctx, edge, true);
    ctx.fillStyle = stone(RISER_LIGHT);
    ctx.fill();
  }

  const midAngle = (from + to) / 2;
  const tone = TREAD_LIGHT * (1 + facingLight(midAngle) * FACING_CONTRAST * 0.5);
  const top = [
    ...arc(from, to, (angle) => at(outer, angle, height)),
    ...arc(to, from, (angle) => at(newel, angle, height)),
  ];
  tracePolyline(ctx, top, true);
  ctx.fillStyle = stone(tone);
  ctx.fill();
  const wear = [
    ...arc(from, to, (angle) => at(outer * WEAR_OUTER, angle, height)),
    ...arc(to, from, (angle) => at(outer * WEAR_INNER, angle, height)),
  ];
  tracePolyline(ctx, wear, true);
  ctx.fillStyle = stone(tone * WEAR_LIGHTEN, 0.6);
  ctx.fill();
  tracePolyline(ctx, top, true);
  ctx.strokeStyle = stone(1, MORTAR_ALPHA, MORTAR);
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // The nosing: the lit front edge the eye reads each step by.
  tracePolyline(ctx, [at(newel, from, height), at(outer, from, height)], false);
  ctx.strokeStyle = stone(NOSING_LIGHTEN, NOSING_ALPHA);
  ctx.stroke();
}

// ── Down ────────────────────────────────────────────────────────────────────

function drawDescendingFlight(ctx: Ctx, block: number): void {
  const cx = block * DOWN_CENTRE_X;
  const cy = block * DOWN_CENTRE_Y;
  const outer = block * DOWN_OUTER_R;
  const newel = block * DOWN_NEWEL_R;
  const vanishX = cx;
  const vanishY = cy + block * DOWN_VANISH_OFFSET_Y;
  const halfScaleDepth = block * DOWN_HALF_SCALE_DEPTH;
  const lineWidth = Math.max(1, block * LINE_WIDTH_SHARE);

  /** A point in the well at `radius` and `angle` in plan, `depth` below the floor. */
  const at = (radius: number, angle: number, depth: number): Point => {
    const shrink = 1 / (1 + depth / halfScaleDepth);
    const planX = cx + Math.cos(angle) * radius;
    const planY = cy + Math.sin(angle) * radius * PLAN_SQUASH;
    return {
      x: vanishX + (planX - vanishX) * shrink,
      y: vanishY + (planY - vanishY) * shrink,
    };
  };
  const light = (depth: number): number =>
    Math.max(DOWN_LIGHT_FLOOR, Math.exp(-depth / (block * DOWN_LIGHT_FALLOFF_DEPTH)));

  const rise = block * DOWN_TREAD_RISE;
  const deepest = rise * DOWN_TREAD_COUNT;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, outer, outer * PLAN_SQUASH, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = WELL_BLACK;
  ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);

  drawDownWellWall(ctx, at, light, block, outer, deepest, lineWidth);

  // The newel runs up the middle of the well; only the side turned toward the
  // vanishing point's offset shows, as a sliver north of its cap.
  const newelFoot = at(newel, -Math.PI / 2, deepest);
  const newelHead = at(newel, -Math.PI / 2, rise);
  ctx.beginPath();
  ctx.moveTo(newelFoot.x - newel, newelFoot.y);
  ctx.lineTo(newelHead.x - newel, newelHead.y);
  ctx.lineTo(newelHead.x + newel, newelHead.y);
  ctx.lineTo(newelFoot.x + newel, newelFoot.y);
  ctx.closePath();
  ctx.fillStyle = stone(RISER_LIGHT * light(deepest / 2));
  ctx.fill();

  const pitch = DOWN_SWEEP / DOWN_TREAD_COUNT;
  for (let i = DOWN_TREAD_COUNT - 1; i >= 0; i--) {
    const from = DOWN_START_ANGLE + i * pitch;
    const to = from + pitch;
    const depth = rise * (i + 1);
    drawDownTread(ctx, at, light, from, to, depth, rise, outer, newel, lineWidth);
  }

  const cap = at(0, 0, rise);
  const capRadius = cap.x - at(newel, Math.PI, rise).x;
  ctx.beginPath();
  ctx.ellipse(
    cap.x,
    cap.y,
    Math.abs(capRadius),
    Math.abs(capRadius) * PLAN_SQUASH,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = stone(TREAD_LIGHT * light(rise));
  ctx.fill();
  ctx.strokeStyle = stone(1, MORTAR_ALPHA, MORTAR);
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();

  drawDownKerb(ctx, cx, cy, outer, block, lineWidth);
}

/** The well's inner wall, course by course, each course one band of depth. */
function drawDownWellWall(
  ctx: Ctx,
  at: (radius: number, angle: number, depth: number) => Point,
  light: (depth: number) => number,
  block: number,
  outer: number,
  deepest: number,
  lineWidth: number,
): void {
  const courseDepth = block * DOWN_WALL_COURSE_DEPTH;
  const blockAngle = (Math.PI * 2) / DOWN_WALL_BLOCKS;
  const segmentAngle = (Math.PI * 2) / DOWN_WALL_SEGMENTS;
  for (let top = 0, course = 0; top < deepest; top += courseDepth, course++) {
    const bottom = top + courseDepth;
    const stagger = course % 2 === 0 ? 0 : blockAngle / 2;
    for (let from = stagger; from < Math.PI * 2 + stagger; from += segmentAngle) {
      const to = from + segmentAngle;
      // The inner face looks back across the well, so it faces the opposite way to its angle.
      const facing = facingLight((from + to) / 2 + Math.PI);
      const shade = DOWN_WALL_LIGHT * light((top + bottom) / 2) * (1 + facing * FACING_CONTRAST);
      const quad = [
        at(outer, from, top),
        at(outer, to, top),
        at(outer, to, bottom),
        at(outer, from, bottom),
      ];
      tracePolyline(ctx, quad, true);
      ctx.fillStyle = stone(shade);
      ctx.fill();
    }
    ctx.strokeStyle = stone(light(top), MORTAR_ALPHA, MORTAR);
    ctx.lineWidth = lineWidth;
    tracePolyline(
      ctx,
      arc(0, Math.PI * 2, (angle) => at(outer, angle, bottom)),
      true,
    );
    ctx.stroke();
    for (let joint = stagger; joint < Math.PI * 2 + stagger; joint += blockAngle) {
      tracePolyline(ctx, [at(outer, joint, top), at(outer, joint, bottom)], false);
      ctx.stroke();
    }
  }

  // The kerb overhangs the top of the shaft and shades the first course.
  const lipFoot = at(outer, -Math.PI / 2, courseDepth);
  const lipTop = at(outer, -Math.PI / 2, 0);
  const lip = ctx.createLinearGradient(0, lipTop.y, 0, lipFoot.y);
  lip.addColorStop(0, `rgba(0, 0, 0, ${DOWN_LIP_SHADOW_ALPHA})`);
  lip.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lip;
  ctx.fillRect(lipTop.x - outer, lipTop.y, outer * 2, lipFoot.y - lipTop.y);
}

function drawDownTread(
  ctx: Ctx,
  at: (radius: number, angle: number, depth: number) => Point,
  light: (depth: number) => number,
  from: number,
  to: number,
  depth: number,
  rise: number,
  outer: number,
  newel: number,
  lineWidth: number,
): void {
  // The riser under this tread's leading edge drops to the next tread down. It
  // lies in a plane through the well's axis, so it shows only as far as the
  // vanishing point's offset turns it toward the eye.
  const riser = [
    at(newel, to, depth),
    at(outer, to, depth),
    at(outer, to, depth + rise),
    at(newel, to, depth + rise),
  ];
  tracePolyline(ctx, riser, true);
  ctx.fillStyle = stone(RISER_LIGHT * light(depth + rise / 2));
  ctx.fill();

  const midAngle = (from + to) / 2;
  const tone = TREAD_LIGHT * light(depth) * (1 + facingLight(midAngle) * FACING_CONTRAST * 0.5);
  const top = [
    ...arc(from, to, (angle) => at(outer, angle, depth)),
    ...arc(to, from, (angle) => at(newel, angle, depth)),
  ];
  tracePolyline(ctx, top, true);
  ctx.fillStyle = stone(tone);
  ctx.fill();
  const wear = [
    ...arc(from, to, (angle) => at(outer * WEAR_OUTER, angle, depth)),
    ...arc(to, from, (angle) => at(outer * WEAR_INNER, angle, depth)),
  ];
  tracePolyline(ctx, wear, true);
  ctx.fillStyle = stone(tone * WEAR_LIGHTEN, 0.6);
  ctx.fill();
  // The heel sits under the nosing of the tread above, in its shadow.
  const heelTo = from + (to - from) * HEEL_SHADOW_SHARE;
  const heel = [
    ...arc(from, heelTo, (angle) => at(outer, angle, depth)),
    ...arc(heelTo, from, (angle) => at(newel, angle, depth)),
  ];
  tracePolyline(ctx, heel, true);
  ctx.fillStyle = `rgba(0, 0, 0, ${HEEL_SHADOW_ALPHA})`;
  ctx.fill();
  tracePolyline(ctx, top, true);
  ctx.strokeStyle = stone(light(depth), MORTAR_ALPHA, MORTAR);
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // The nosing is the edge this tread drops away from, toward the next one down.
  tracePolyline(ctx, [at(newel, to, depth), at(outer, to, depth)], false);
  ctx.strokeStyle = stone(light(depth) * NOSING_LIGHTEN, NOSING_ALPHA);
  ctx.stroke();
}

/**
 * The kerb ringing the hole. It stands a little proud of the floor, so its top
 * is lifted up the screen and the inside of its far half shows as a face over
 * the well, while its near half cuts across the top of the shaft.
 */
function drawDownKerb(
  ctx: Ctx,
  cx: number,
  cy: number,
  outer: number,
  block: number,
  lineWidth: number,
): void {
  const lift = block * DOWN_KERB_HEIGHT;
  const width = block * DOWN_KERB_WIDTH;
  const ry = (radius: number): number => radius * PLAN_SQUASH;

  // The far half's inner face: the lifted rim that rises clear of the hole's edge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - outer - width, cy - outer - width - lift, (outer + width) * 2, (outer + width) * 2);
  ctx.ellipse(cx, cy, outer, ry(outer), 0, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.beginPath();
  ctx.ellipse(cx, cy - lift, outer, ry(outer), 0, 0, Math.PI * 2);
  ctx.fillStyle = stone(DOWN_KERB_FACE_LIGHT);
  ctx.fill();
  ctx.restore();

  // The kerb's top: a ring, lifted, with the near side's outer face below it.
  ctx.beginPath();
  ctx.ellipse(cx, cy, outer + width, ry(outer + width), 0, 0, Math.PI);
  ctx.ellipse(cx, cy - lift, outer + width, ry(outer + width), 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = stone(RISER_LIGHT);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, cy - lift, outer + width, ry(outer + width), 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy - lift, outer, ry(outer), 0, 0, Math.PI * 2);
  const ring = ctx.createLinearGradient(cx - outer, cy - outer, cx + outer, cy + outer);
  ring.addColorStop(0, stone(TREAD_LIGHT * 1.06));
  ring.addColorStop(1, stone(TREAD_LIGHT * 0.9));
  ctx.fillStyle = ring;
  ctx.fill('evenodd');
  ctx.strokeStyle = stone(1, MORTAR_ALPHA, MORTAR);
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  // Joints between the kerb stones.
  const kerbStones = DOWN_WALL_BLOCKS;
  for (let i = 0; i < kerbStones; i++) {
    const angle = (i / kerbStones) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * outer, cy - lift + Math.sin(angle) * ry(outer));
    ctx.lineTo(
      cx + Math.cos(angle) * (outer + width),
      cy - lift + Math.sin(angle) * ry(outer + width),
    );
    ctx.stroke();
  }
}
