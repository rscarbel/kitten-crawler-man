/**
 * The evidence props for "The Krasue Murders" — one hand-drawn gore scene per
 * investigation point.
 *
 * A krasue is a flying head trailing its own viscera, so what it leaves behind
 * is drag, spray and entrail rather than footprints. Each prop is drawn from
 * the clue tile's centre and reaches about a tile to either side, so the scene
 * reads from the far side of the street rather than only when stood on.
 *
 * Every alpha below is a plain decimal on purpose: both node-canvas and the
 * browser 2d context drop an `rgba()` whose alpha arrived in exponent form.
 */

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/** Blood here is arterial and half-dried — near-black reds, never a bright primary. */
const POOL_COLOR = 'rgba(74, 10, 12, 0.85)';
const POOL_EDGE_COLOR = 'rgba(40, 5, 7, 0.9)';
const SMEAR_COLOR = 'rgba(96, 14, 16, 0.55)';
const SMEAR_DARK_COLOR = 'rgba(62, 8, 10, 0.6)';
const SPATTER_COLOR = 'rgba(112, 18, 18, 0.72)';
const ENTRAIL_COLOR = 'rgba(118, 30, 30, 0.85)';
const ENTRAIL_SHEEN_COLOR = 'rgba(168, 74, 68, 0.5)';
const GOUGE_COLOR = 'rgba(34, 20, 14, 0.85)';
const GOUGE_RAW_COLOR = 'rgba(92, 16, 18, 0.6)';
const CLOTH_COLOR = '#6b5a44';
const CLOTH_SOAK_COLOR = 'rgba(78, 11, 13, 0.7)';
const FEATHER_VANE_COLOR = '#d3d9e1';
const FEATHER_SHAFT_COLOR = 'rgba(112, 120, 132, 0.9)';

const POOL_EDGE_WIDTH_RATIO = 0.02;
const MIN_STROKE_PX = 1;

/** A darker wet centre, so a pool is not a flat lozenge at a glance. */
const POOL_CORE_COLOR = 'rgba(36, 4, 6, 0.55)';
const POOL_CORE_SCALE = 0.55;
const POOL_CORE_RISE = 0.15;

/** A feather's vane bulges this far off its shaft, as a fraction of its length. */
const FEATHER_HALF_WIDTH_RATIO = 0.33;
/** The vane is fullest behind the tip, so the widest point sits past the middle. */
const FEATHER_WIDEST_ALONG_SHAFT = 0.42;
const FEATHER_SHAFT_WIDTH_RATIO = 0.06;

/** A scattered skyfowl feather: centre, bearing in radians, length in tile fractions. */
interface FeatherPlacement {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly length: number;
}

function strokeWidthFor(s: number, ratio: number): number {
  return Math.max(MIN_STROKE_PX, s * ratio);
}

function drawBloodPool(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  s: number,
): void {
  ctx.fillStyle = POOL_COLOR;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = POOL_EDGE_COLOR;
  ctx.lineWidth = strokeWidthFor(s, POOL_EDGE_WIDTH_RATIO);
  ctx.stroke();
  ctx.fillStyle = POOL_CORE_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - ry * POOL_CORE_RISE,
    rx * POOL_CORE_SCALE,
    ry * POOL_CORE_SCALE,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
}

function drawFeather(ctx: CanvasRenderingContext2D, feather: FeatherPlacement, s: number): void {
  const length = feather.length * s;
  const halfWidth = length * FEATHER_HALF_WIDTH_RATIO;
  ctx.save();
  ctx.translate(feather.x * s, feather.y * s);
  ctx.rotate(feather.angle);
  ctx.fillStyle = FEATHER_VANE_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * FEATHER_WIDEST_ALONG_SHAFT, -halfWidth, length, 0);
  ctx.quadraticCurveTo(length * FEATHER_WIDEST_ALONG_SHAFT, halfWidth, 0, 0);
  ctx.fill();
  ctx.strokeStyle = FEATHER_SHAFT_COLOR;
  ctx.lineWidth = strokeWidthFor(s, FEATHER_SHAFT_WIDTH_RATIO);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();
  ctx.restore();
}

/** A ragged scrap of torn clothing, blood-soaked along one edge. */
function drawTornCloth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  s: number,
): void {
  const w = width * s;
  const h = height * s;
  ctx.save();
  ctx.translate(x * s, y * s);
  ctx.rotate(angle);
  ctx.fillStyle = CLOTH_COLOR;
  ctx.beginPath();
  ctx.moveTo(-w * HALF, -h * HALF);
  ctx.lineTo(w * 0.1, -h * 0.34);
  ctx.lineTo(w * HALF, -h * HALF);
  ctx.lineTo(w * 0.32, h * 0.16);
  ctx.lineTo(w * HALF, h * HALF);
  ctx.lineTo(-w * 0.14, h * 0.3);
  ctx.lineTo(-w * HALF, h * HALF);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CLOTH_SOAK_COLOR;
  ctx.beginPath();
  ctx.moveTo(-w * HALF, h * HALF);
  ctx.lineTo(-w * 0.14, h * 0.3);
  ctx.lineTo(w * HALF, h * HALF);
  ctx.lineTo(w * 0.1, h * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A tapered streak running from a narrow head to a wide tail. */
function drawSmear(
  ctx: CanvasRenderingContext2D,
  headX: number,
  headY: number,
  tailX: number,
  tailY: number,
  headHalfWidth: number,
  tailHalfWidth: number,
  s: number,
  color: string,
): void {
  const dx = tailX - headX;
  const dy = tailY - headY;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const normalX = -dy / length;
  const normalY = dx / length;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo((headX + normalX * headHalfWidth) * s, (headY + normalY * headHalfWidth) * s);
  ctx.lineTo((tailX + normalX * tailHalfWidth) * s, (tailY + normalY * tailHalfWidth) * s);
  ctx.lineTo((tailX - normalX * tailHalfWidth) * s, (tailY - normalY * tailHalfWidth) * s);
  ctx.lineTo((headX - normalX * headHalfWidth) * s, (headY - normalY * headHalfWidth) * s);
  ctx.closePath();
  ctx.fill();
}

// ── The well ────────────────────────────────────────────────────────────────

const WELL_SMEAR_HEAD_Y = -0.56;
const WELL_SMEAR_TAIL_Y = 0.18;
const WELL_SMEAR_HEAD_HALF_WIDTH = 0.045;
const WELL_SMEAR_TAIL_HALF_WIDTH = 0.12;
/** Runnels breaking away from the main smear as it crosses the stonework. */
const WELL_RUNNEL_OFFSETS: ReadonlyArray<number> = [-0.14, 0.11];
const WELL_RUNNEL_HALF_WIDTH = 0.03;
const WELL_RUNNEL_TAIL_Y = 0.06;

const WELL_POOL_Y = 0.32;
const WELL_POOL_RX = 0.6;
const WELL_POOL_RY = 0.27;

const WELL_CLOTH_X = -0.3;
const WELL_CLOTH_Y = -0.52;
const WELL_CLOTH_WIDTH = 0.42;
const WELL_CLOTH_HEIGHT = 0.3;
const WELL_CLOTH_ANGLE = -0.38;

const WELL_FEATHERS: ReadonlyArray<FeatherPlacement> = [
  { x: -0.86, y: 0.4, angle: -0.5, length: 0.34 },
  { x: 0.62, y: 0.5, angle: 2.3, length: 0.3 },
  { x: 0.34, y: -0.24, angle: 0.9, length: 0.26 },
];

/**
 * The well: a torn, blood-soaked scrap snagged on the rim, viscera dragged down
 * the stonework into a pool at the foot of it, skyfowl feathers scattered clear.
 */
export function drawWellClueProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(sx + s * HALF, sy + s * HALF);

  drawSmear(
    ctx,
    0,
    WELL_SMEAR_HEAD_Y,
    0,
    WELL_SMEAR_TAIL_Y,
    WELL_SMEAR_HEAD_HALF_WIDTH,
    WELL_SMEAR_TAIL_HALF_WIDTH,
    s,
    SMEAR_COLOR,
  );
  for (const offsetX of WELL_RUNNEL_OFFSETS) {
    drawSmear(
      ctx,
      offsetX,
      WELL_SMEAR_HEAD_Y,
      offsetX,
      WELL_RUNNEL_TAIL_Y,
      WELL_RUNNEL_HALF_WIDTH,
      WELL_RUNNEL_HALF_WIDTH,
      s,
      SMEAR_DARK_COLOR,
    );
  }

  drawBloodPool(ctx, 0, WELL_POOL_Y * s, WELL_POOL_RX * s, WELL_POOL_RY * s, s);
  drawTornCloth(
    ctx,
    WELL_CLOTH_X,
    WELL_CLOTH_Y,
    WELL_CLOTH_WIDTH,
    WELL_CLOTH_HEIGHT,
    WELL_CLOTH_ANGLE,
    s,
  );
  for (const feather of WELL_FEATHERS) drawFeather(ctx, feather, s);

  ctx.restore();
}

// ── Old Hilda's cottage ─────────────────────────────────────────────────────

/**
 * The drag runs from the doorstep, which lies north of this prop — the clue
 * tile stands clear of the cottage's doorway so the entry menu can never open
 * on top of it, so the gouges are raked into the paving the body crossed rather
 * than into the shutters two tiles behind them.
 */
const HOME_DRAG_HEAD_Y = -0.72;
const HOME_DRAG_TAIL_Y = 0.16;
const HOME_DRAG_HEAD_HALF_WIDTH = 0.06;
const HOME_DRAG_TAIL_HALF_WIDTH = 0.15;

const HOME_GOUGE_OFFSETS: ReadonlyArray<number> = [-0.26, -0.06, 0.14, 0.32];
const HOME_GOUGE_HEAD_Y = -0.78;
const HOME_GOUGE_TAIL_Y = -0.18;
/** The claws splay as they rake, so each furrow ends further out than it began. */
const HOME_GOUGE_SPLAY = 0.13;
/** How far past the splay the furrow's midpoint bows out. */
const HOME_GOUGE_BOW = 1.05;
const HOME_GOUGE_WIDTH_RATIO = 0.045;
const HOME_GOUGE_RAW_WIDTH_RATIO = 0.02;

const HOME_POOL_Y = 0.3;
const HOME_POOL_RX = 0.56;
const HOME_POOL_RY = 0.26;
/** A second, smaller pool where the body was set down and dragged on again. */
const HOME_SPLASH_X = -0.66;
const HOME_SPLASH_Y = 0.44;
const HOME_SPLASH_RX = 0.24;
const HOME_SPLASH_RY = 0.11;

const HOME_CLOTH_SCRAPS: ReadonlyArray<{
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}> = [
  { x: 0.6, y: 0.34, width: 0.34, height: 0.24, angle: 0.42 },
  { x: -0.2, y: 0.56, width: 0.22, height: 0.16, angle: -0.9 },
];

/**
 * The cottage: four claw furrows raked toward the street, a drag smear from the
 * doorstep, and the pool with torn scraps where whatever was hauled out stopped.
 */
export function drawHomeClueProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(sx + s * HALF, sy + s * HALF);

  drawSmear(
    ctx,
    0,
    HOME_DRAG_HEAD_Y,
    0,
    HOME_DRAG_TAIL_Y,
    HOME_DRAG_HEAD_HALF_WIDTH,
    HOME_DRAG_TAIL_HALF_WIDTH,
    s,
    SMEAR_COLOR,
  );

  ctx.lineCap = 'round';
  for (const offsetX of HOME_GOUGE_OFFSETS) {
    const splay = Math.sign(offsetX) * HOME_GOUGE_SPLAY;
    ctx.beginPath();
    ctx.moveTo(offsetX * s, HOME_GOUGE_HEAD_Y * s);
    // Curved rather than straight: a claw dragged through paving bows away from
    // the line of the pull, and four straight lines read as fence posts.
    ctx.quadraticCurveTo(
      (offsetX + splay * HOME_GOUGE_BOW) * s,
      (HOME_GOUGE_HEAD_Y + HOME_GOUGE_TAIL_Y) * HALF * s,
      (offsetX + splay) * s,
      HOME_GOUGE_TAIL_Y * s,
    );
    ctx.strokeStyle = GOUGE_COLOR;
    ctx.lineWidth = strokeWidthFor(s, HOME_GOUGE_WIDTH_RATIO);
    ctx.stroke();
    ctx.strokeStyle = GOUGE_RAW_COLOR;
    ctx.lineWidth = strokeWidthFor(s, HOME_GOUGE_RAW_WIDTH_RATIO);
    ctx.stroke();
  }

  drawBloodPool(ctx, 0, HOME_POOL_Y * s, HOME_POOL_RX * s, HOME_POOL_RY * s, s);
  drawBloodPool(
    ctx,
    HOME_SPLASH_X * s,
    HOME_SPLASH_Y * s,
    HOME_SPLASH_RX * s,
    HOME_SPLASH_RY * s,
    s,
  );
  for (const scrap of HOME_CLOTH_SCRAPS) {
    drawTornCloth(ctx, scrap.x, scrap.y, scrap.width, scrap.height, scrap.angle, s);
  }

  ctx.restore();
}

// ── The tower roost ─────────────────────────────────────────────────────────

/** The spatter arc thrown up the tower base, north of the clue tile. */
const ROOST_SPATTER_DROP_COUNT = 9;
const ROOST_SPATTER_RADIUS = 0.78;
const ROOST_SPATTER_START_ANGLE = Math.PI * 1.15;
const ROOST_SPATTER_SWEEP = Math.PI * 0.7;
const ROOST_SPATTER_MAX_DROP_R = 0.07;
const ROOST_SPATTER_MIN_DROP_R = 0.02;

const ROOST_ENTRAIL_RX = 0.52;
const ROOST_ENTRAIL_RY = 0.27;
const ROOST_ENTRAIL_Y = 0.22;
const ROOST_ENTRAIL_WIDTH_RATIO = 0.075;
const ROOST_ENTRAIL_SHEEN_WIDTH_RATIO = 0.025;
/** The loop is torn open where it was dropped, so the ring is not quite closed. */
const ROOST_ENTRAIL_GAP = 0.5;

const ROOST_POOL_Y = 0.3;
const ROOST_POOL_RX = 0.32;
const ROOST_POOL_RY = 0.15;

const ROOST_FEATHERS: ReadonlyArray<FeatherPlacement> = [
  { x: -0.92, y: 0.12, angle: -0.7, length: 0.36 },
  { x: -0.5, y: -0.5, angle: -1.4, length: 0.3 },
  { x: 0.16, y: -0.66, angle: -0.2, length: 0.34 },
  { x: 0.72, y: -0.3, angle: 0.55, length: 0.32 },
  { x: 0.86, y: 0.36, angle: 1.9, length: 0.28 },
];

/**
 * The tower plaza: a burst of moulted feathers, a spatter arc flung up the
 * tower's base, and a torn loop of entrail circling the clue tile.
 */
export function drawRoostClueProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(sx + s * HALF, sy + s * HALF);

  ctx.fillStyle = SPATTER_COLOR;
  for (let i = 0; i < ROOST_SPATTER_DROP_COUNT; i++) {
    const alongArc = i / (ROOST_SPATTER_DROP_COUNT - 1);
    const angle = ROOST_SPATTER_START_ANGLE + alongArc * ROOST_SPATTER_SWEEP;
    const dropRadius =
      ROOST_SPATTER_MIN_DROP_R +
      (ROOST_SPATTER_MAX_DROP_R - ROOST_SPATTER_MIN_DROP_R) * Math.sin(alongArc * Math.PI);
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * ROOST_SPATTER_RADIUS * s,
      Math.sin(angle) * ROOST_SPATTER_RADIUS * s,
      dropRadius * s,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }

  drawBloodPool(ctx, 0, ROOST_POOL_Y * s, ROOST_POOL_RX * s, ROOST_POOL_RY * s, s);

  ctx.lineCap = 'round';
  ctx.strokeStyle = ENTRAIL_COLOR;
  ctx.lineWidth = strokeWidthFor(s, ROOST_ENTRAIL_WIDTH_RATIO);
  ctx.beginPath();
  ctx.ellipse(
    0,
    ROOST_ENTRAIL_Y * s,
    ROOST_ENTRAIL_RX * s,
    ROOST_ENTRAIL_RY * s,
    0,
    ROOST_ENTRAIL_GAP,
    FULL_TURN,
  );
  ctx.stroke();
  ctx.strokeStyle = ENTRAIL_SHEEN_COLOR;
  ctx.lineWidth = strokeWidthFor(s, ROOST_ENTRAIL_SHEEN_WIDTH_RATIO);
  ctx.stroke();

  for (const feather of ROOST_FEATHERS) drawFeather(ctx, feather, s);

  ctx.restore();
}
