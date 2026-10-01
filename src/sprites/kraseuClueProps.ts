/**
 * The evidence props for "The Krasue Murders" — one painted scene per
 * investigation point, each built around the object its clue text names.
 *
 * - The well: talon gouges in the rim, a drag mark hauled away from it, and a
 *   white stub of schoolroom chalk crushed into a patch of mud.
 * - Old Hilda's cottage: claw furrows raked through the paving, a pool, a torn
 *   plum shawl with its fringe, and the unsigned note.
 * - The tower plaza: a ring of moulted skyfowl feathers burst open, the
 *   shrine's beeswax candles toppled in it, and blood thrown up the tower.
 *
 * Every scene is drawn in tile units from the clue tile's centre and reaches
 * about a tile to either side, so it reads from across the street. Each focal
 * object carries a dark outline and a contact shadow: a town street is a busy,
 * mid-grey texture, and an object without both dissolves into the paving at
 * thirty-two pixels a tile.
 *
 * Every alpha below is a plain decimal on purpose: both node-canvas and the
 * browser 2d context drop an `rgba()` whose alpha arrived in exponent form.
 */

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const MIN_STROKE_PX = 1;

/** A tile-unit point. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** A tile-unit placement: centre, bearing in radians, and a size along that bearing. */
interface Placement extends Point {
  readonly angle: number;
  readonly length: number;
}

const CONTACT_SHADOW_COLOR = 'rgba(14, 10, 8, 0.38)';
/** Light falls from the north-west, so every shadow slips south-east of its object. */
const SHADOW_OFFSET: Point = { x: 0.03, y: 0.045 };

const OUTLINE_COLOR = 'rgba(24, 16, 12, 0.85)';
const OUTLINE_WIDTH_TILES = 0.025;

/** Blood here is arterial and half-dried — near-black reds, never a bright primary. */
const POOL_COLOR = 'rgba(74, 10, 12, 0.85)';
const POOL_EDGE_COLOR = 'rgba(40, 5, 7, 0.9)';
const POOL_CORE_COLOR = 'rgba(36, 4, 6, 0.55)';
const POOL_SHEEN_COLOR = 'rgba(190, 96, 90, 0.45)';
const POOL_EDGE_WIDTH_TILES = 0.02;
/** A darker wet centre, so a pool is not a flat lozenge at a glance. */
const POOL_CORE_SCALE = 0.55;
const POOL_CORE_RISE = 0.15;
/** A single highlight on the wet surface is what separates a pool from a stain. */
const POOL_SHEEN_OFFSET: Point = { x: -0.35, y: -0.35 };
const POOL_SHEEN_SCALE = 0.22;

const SPATTER_COLOR = 'rgba(112, 18, 18, 0.78)';

/** Sets a stroke width in tile units that never thins below one screen pixel. */
function setLineWidth(ctx: CanvasRenderingContext2D, widthTiles: number, s: number): void {
  ctx.lineWidth = Math.max(MIN_STROKE_PX / s, widthTiles);
}

function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, angle, 0, FULL_TURN);
  ctx.fill();
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: ReadonlyArray<Point>): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function outlineCurrentPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.strokeStyle = OUTLINE_COLOR;
  setLineWidth(ctx, OUTLINE_WIDTH_TILES, s);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawBloodPool(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  s: number,
): void {
  fillEllipse(ctx, cx, cy, rx, ry, 0, POOL_COLOR);
  ctx.strokeStyle = POOL_EDGE_COLOR;
  setLineWidth(ctx, POOL_EDGE_WIDTH_TILES, s);
  ctx.stroke();
  fillEllipse(
    ctx,
    cx,
    cy - ry * POOL_CORE_RISE,
    rx * POOL_CORE_SCALE,
    ry * POOL_CORE_SCALE,
    0,
    POOL_CORE_COLOR,
  );
  fillEllipse(
    ctx,
    cx + rx * POOL_SHEEN_OFFSET.x,
    cy + ry * POOL_SHEEN_OFFSET.y,
    rx * POOL_SHEEN_SCALE,
    ry * POOL_SHEEN_SCALE,
    0,
    POOL_SHEEN_COLOR,
  );
}

/** A tapered streak running from a narrow head to a wide tail. */
function drawSmear(
  ctx: CanvasRenderingContext2D,
  head: Point,
  tail: Point,
  headHalfWidth: number,
  tailHalfWidth: number,
  color: string,
): void {
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const normalX = -dy / length;
  const normalY = dx / length;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(head.x + normalX * headHalfWidth, head.y + normalY * headHalfWidth);
  ctx.lineTo(tail.x + normalX * tailHalfWidth, tail.y + normalY * tailHalfWidth);
  ctx.lineTo(tail.x - normalX * tailHalfWidth, tail.y - normalY * tailHalfWidth);
  ctx.lineTo(head.x - normalX * headHalfWidth, head.y - normalY * headHalfWidth);
  ctx.closePath();
  ctx.fill();
}

/**
 * Claw marks: a dark groove with a pale scraped lip on its lit side. The lip
 * is what reads as "cut into the surface" rather than "painted on top of it".
 */
const GOUGE_GROOVE_COLOR = 'rgba(30, 20, 16, 0.9)';
const GOUGE_LIP_COLOR = 'rgba(236, 226, 206, 0.75)';
const GOUGE_LIP_OFFSET: Point = { x: -0.025, y: -0.012 };
/** Each claw mark bows away from the line of the pull, as a dragged claw does. */
const GOUGE_BOW = 0.06;

function drawGouges(
  ctx: CanvasRenderingContext2D,
  marks: ReadonlyArray<{ readonly from: Point; readonly to: Point }>,
  widthTiles: number,
  s: number,
): void {
  ctx.lineCap = 'round';
  for (const pass of [
    { color: GOUGE_LIP_COLOR, offset: GOUGE_LIP_OFFSET, width: widthTiles * HALF },
    { color: GOUGE_GROOVE_COLOR, offset: { x: 0, y: 0 }, width: widthTiles },
  ]) {
    ctx.strokeStyle = pass.color;
    setLineWidth(ctx, pass.width, s);
    for (const mark of marks) {
      const midX = (mark.from.x + mark.to.x) * HALF + GOUGE_BOW;
      const midY = (mark.from.y + mark.to.y) * HALF;
      ctx.beginPath();
      ctx.moveTo(mark.from.x + pass.offset.x, mark.from.y + pass.offset.y);
      ctx.quadraticCurveTo(
        midX + pass.offset.x,
        midY + pass.offset.y,
        mark.to.x + pass.offset.x,
        mark.to.y + pass.offset.y,
      );
      ctx.stroke();
    }
  }
}

// ── The well ────────────────────────────────────────────────────────────────

/**
 * The well sprite's stone basin sits north of the clue tile and east of its
 * centre, and this prop is painted over it. The talon gouges land on the
 * basin's front face; everything else lies on the ground at its foot.
 */
const WELL_RIM_GOUGES: ReadonlyArray<{ readonly from: Point; readonly to: Point }> = [
  { from: { x: 0.14, y: -0.86 }, to: { x: 0.3, y: -0.5 } },
  { from: { x: 0.3, y: -0.88 }, to: { x: 0.46, y: -0.5 } },
  { from: { x: 0.46, y: -0.86 }, to: { x: 0.62, y: -0.52 } },
];
const WELL_RIM_GOUGE_WIDTH = 0.06;

/** The broad smear where something heavy was hauled from the well and away. */
const WELL_DRAG_COLOR = 'rgba(70, 40, 26, 0.55)';
const WELL_DRAG_RUTS: ReadonlyArray<{ readonly head: Point; readonly tail: Point }> = [
  { head: { x: 0.22, y: -0.38 }, tail: { x: -0.74, y: 0.5 } },
];
const WELL_DRAG_HEAD_HALF_WIDTH = 0.18;
const WELL_DRAG_TAIL_HALF_WIDTH = 0.07;

/** Overlapping lobes, so the mud is an irregular splat rather than an oval. */
const WELL_MUD_COLOR = 'rgba(58, 40, 26, 0.92)';
const WELL_MUD_WET_COLOR = 'rgba(34, 22, 14, 0.7)';
const WELL_MUD_LOBES: ReadonlyArray<{
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}> = [
  { x: 0.28, y: 0.12, rx: 0.46, ry: 0.24 },
  { x: -0.06, y: 0.24, rx: 0.3, ry: 0.17 },
  { x: 0.6, y: 0.3, rx: 0.24, ry: 0.13 },
  { x: 0.32, y: -0.12, rx: 0.26, ry: 0.12 },
];
const WELL_MUD_WET_SCALE = 0.6;
/** Bootprint-sized dimples pressed into the mud around the chalk. */
const WELL_MUD_DIMPLES: ReadonlyArray<Point> = [
  { x: -0.05, y: 0.28 },
  { x: 0.62, y: 0.32 },
  { x: 0.48, y: -0.06 },
];
const WELL_MUD_DIMPLE_RX = 0.07;
const WELL_MUD_DIMPLE_RY = 0.035;

const CHALK_COLOR = '#f4f1e6';
const CHALK_SHADE_COLOR = '#bdb8a8';
const CHALK_END_COLOR = '#ffffff';
const CHALK_DUST_COLOR = 'rgba(244, 240, 228, 0.6)';
/** A stub's thickness as a fraction of its length — a fat, worn-down stick. */
const CHALK_THICKNESS_RATIO = 0.32;
/** The lower half of the stick is turned from the light. */
const CHALK_SHADE_FRACTION = 0.4;
const WELL_CHALK_STUB: Placement = { x: 0.24, y: 0.1, angle: -0.32, length: 0.44 };
/** The crumb that snapped off when the stub was trodden into the mud. */
const WELL_CHALK_CRUMB: Placement = { x: 0.58, y: 0.2, angle: 0.5, length: 0.15 };
/** The white streak the chalk left as it was ground in. */
const WELL_CHALK_DUST_HEAD: Point = { x: -0.02, y: 0.2 };
const WELL_CHALK_DUST_TAIL: Point = { x: 0.24, y: 0.1 };
const WELL_CHALK_DUST_HEAD_HALF_WIDTH = 0.015;
const WELL_CHALK_DUST_TAIL_HALF_WIDTH = 0.055;

/** A stick of chalk lying on its side: a lit cylinder with a bright flat end. */
function drawChalkStick(ctx: CanvasRenderingContext2D, placement: Placement, s: number): void {
  const halfLength = placement.length * HALF;
  const halfThickness = placement.length * CHALK_THICKNESS_RATIO * HALF;
  ctx.save();
  ctx.translate(placement.x, placement.y);
  ctx.rotate(placement.angle);

  ctx.fillStyle = CONTACT_SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    SHADOW_OFFSET.x,
    halfThickness + SHADOW_OFFSET.y * HALF,
    halfLength,
    halfThickness * HALF,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();

  ctx.beginPath();
  ctx.rect(-halfLength, -halfThickness, placement.length, halfThickness * 2);
  ctx.fillStyle = CHALK_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);
  const shadeHeight = halfThickness * 2 * CHALK_SHADE_FRACTION;
  ctx.fillStyle = CHALK_SHADE_COLOR;
  ctx.fillRect(-halfLength, halfThickness - shadeHeight, placement.length, shadeHeight);

  ctx.beginPath();
  ctx.ellipse(halfLength, 0, halfThickness * HALF, halfThickness, 0, 0, FULL_TURN);
  ctx.fillStyle = CHALK_END_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);
  ctx.restore();
}

/**
 * The well: talon gouges scored into the rim, drag ruts hauled away from it,
 * and the focal clue — a white stub of schoolroom chalk crushed into the mud.
 */
export function drawWellClueProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(sx + s * HALF, sy + s * HALF);
  ctx.scale(s, s);

  drawGouges(ctx, WELL_RIM_GOUGES, WELL_RIM_GOUGE_WIDTH, s);

  for (const rut of WELL_DRAG_RUTS) {
    drawSmear(
      ctx,
      rut.head,
      rut.tail,
      WELL_DRAG_HEAD_HALF_WIDTH,
      WELL_DRAG_TAIL_HALF_WIDTH,
      WELL_DRAG_COLOR,
    );
  }

  for (const lobe of WELL_MUD_LOBES) {
    fillEllipse(ctx, lobe.x, lobe.y, lobe.rx, lobe.ry, 0, WELL_MUD_COLOR);
  }
  for (const lobe of WELL_MUD_LOBES) {
    fillEllipse(
      ctx,
      lobe.x,
      lobe.y,
      lobe.rx * WELL_MUD_WET_SCALE,
      lobe.ry * WELL_MUD_WET_SCALE,
      0,
      WELL_MUD_WET_COLOR,
    );
  }
  for (const dimple of WELL_MUD_DIMPLES) {
    fillEllipse(
      ctx,
      dimple.x,
      dimple.y,
      WELL_MUD_DIMPLE_RX,
      WELL_MUD_DIMPLE_RY,
      0,
      CONTACT_SHADOW_COLOR,
    );
  }

  drawSmear(
    ctx,
    WELL_CHALK_DUST_HEAD,
    WELL_CHALK_DUST_TAIL,
    WELL_CHALK_DUST_HEAD_HALF_WIDTH,
    WELL_CHALK_DUST_TAIL_HALF_WIDTH,
    CHALK_DUST_COLOR,
  );
  drawChalkStick(ctx, WELL_CHALK_CRUMB, s);
  drawChalkStick(ctx, WELL_CHALK_STUB, s);

  ctx.restore();
}

// ── Old Hilda's cottage ─────────────────────────────────────────────────────

/**
 * The cottage lies north of this prop — the clue tile stands clear of its
 * doorway so the entry menu can never open on top of it — so the claw furrows
 * are raked into the paving the victim crossed, running toward the street.
 */
const HOME_FURROWS: ReadonlyArray<{ readonly from: Point; readonly to: Point }> = [
  { from: { x: -0.36, y: -0.9 }, to: { x: -0.3, y: -0.2 } },
  { from: { x: -0.17, y: -0.94 }, to: { x: -0.1, y: -0.16 } },
  { from: { x: 0.02, y: -0.94 }, to: { x: 0.1, y: -0.16 } },
  { from: { x: 0.21, y: -0.9 }, to: { x: 0.3, y: -0.2 } },
];
const HOME_FURROW_WIDTH = 0.065;

const HOME_POOL: {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
} = { x: -0.02, y: 0.06, rx: 0.4, ry: 0.18 };

/** The visitor's shawl: plum wool with an ochre woven band and a knotted fringe. */
const SHAWL_COLOR = '#7c3a6c';
const SHAWL_LIGHT_COLOR = '#a2588f';
const SHAWL_FOLD_COLOR = '#4f2045';
const SHAWL_BAND_COLOR = '#d6a944';
const SHAWL_FRINGE_COLOR = '#e2bd62';
const SHAWL_SOAK_COLOR = 'rgba(60, 6, 10, 0.72)';
const SHAWL_FRINGE_LENGTH = 0.09;
const SHAWL_FRINGE_WIDTH = 0.022;
const SHAWL_BAND_WIDTH = 0.045;

/**
 * A torn triangle of shawl in its own unit frame (x across, y down, centred).
 * The ragged top edge is the tear; the straight bottom edge is the hem that
 * carries the fringe.
 */
const SHAWL_OUTLINE: ReadonlyArray<Point> = [
  { x: -0.5, y: 0.3 },
  { x: -0.3, y: 0.02 },
  { x: -0.12, y: -0.26 },
  { x: 0.0, y: -0.42 },
  { x: 0.08, y: -0.3 },
  { x: 0.15, y: -0.36 },
  { x: 0.2, y: -0.2 },
  { x: 0.28, y: -0.22 },
  { x: 0.34, y: -0.06 },
  { x: 0.5, y: 0.3 },
];
const SHAWL_HEM_START: Point = { x: -0.5, y: 0.3 };
const SHAWL_HEM_END: Point = { x: 0.5, y: 0.3 };
/** The woven band runs parallel to the hem, set this far inside it. */
const SHAWL_BAND_INSET = 0.1;
const SHAWL_BAND_SHRINK = 0.82;
/** Two folds catch the light, one falls into shadow. */
const SHAWL_FOLDS: ReadonlyArray<{
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
}> = [
  { from: { x: -0.04, y: -0.3 }, to: { x: -0.28, y: 0.26 }, color: SHAWL_LIGHT_COLOR },
  { from: { x: 0.02, y: -0.34 }, to: { x: 0.02, y: 0.26 }, color: SHAWL_FOLD_COLOR },
  { from: { x: 0.12, y: -0.24 }, to: { x: 0.3, y: 0.24 }, color: SHAWL_LIGHT_COLOR },
];
const SHAWL_FOLD_WIDTH = 0.05;
const SHAWL_FRINGE_COUNT = 9;
/** The soaked corner, as a polygon in the shawl's unit frame. */
const SHAWL_SOAK: ReadonlyArray<Point> = [
  { x: -0.5, y: 0.3 },
  { x: -0.3, y: 0.02 },
  { x: -0.2, y: -0.12 },
  { x: -0.08, y: 0.3 },
];

interface ShawlPlacement extends Placement {
  /** How deep the scrap lies, as a fraction of its length. */
  readonly depth: number;
  readonly soaked: boolean;
}

const HOME_SHAWL_SCRAPS: ReadonlyArray<ShawlPlacement> = [
  { x: 0.5, y: 0.34, angle: 0.22, length: 0.8, depth: 0.62, soaked: true },
  { x: -0.66, y: -0.26, angle: -0.9, length: 0.36, depth: 0.6, soaked: false },
];

function drawShawlScrap(ctx: CanvasRenderingContext2D, scrap: ShawlPlacement, s: number): void {
  ctx.save();
  ctx.translate(scrap.x, scrap.y);
  ctx.rotate(scrap.angle);

  ctx.save();
  ctx.translate(SHADOW_OFFSET.x, SHADOW_OFFSET.y);
  ctx.scale(scrap.length, scrap.length * scrap.depth);
  tracePolygon(ctx, SHAWL_OUTLINE);
  ctx.restore();
  ctx.fillStyle = CONTACT_SHADOW_COLOR;
  ctx.fill();

  const frameX = scrap.length;
  const frameY = scrap.length * scrap.depth;
  const toFrame = (point: Point): Point => ({ x: point.x * frameX, y: point.y * frameY });

  ctx.strokeStyle = SHAWL_FRINGE_COLOR;
  setLineWidth(ctx, SHAWL_FRINGE_WIDTH, s);
  ctx.lineCap = 'round';
  for (let i = 0; i < SHAWL_FRINGE_COUNT; i++) {
    const along = (i + HALF) / SHAWL_FRINGE_COUNT;
    const hemX = SHAWL_HEM_START.x + (SHAWL_HEM_END.x - SHAWL_HEM_START.x) * along;
    const root = toFrame({ x: hemX, y: SHAWL_HEM_START.y });
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.lineTo(root.x, root.y + SHAWL_FRINGE_LENGTH);
    ctx.stroke();
  }

  tracePolygon(ctx, SHAWL_OUTLINE.map(toFrame));
  ctx.fillStyle = SHAWL_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);

  ctx.save();
  ctx.clip();
  for (const fold of SHAWL_FOLDS) {
    const from = toFrame(fold.from);
    const to = toFrame(fold.to);
    ctx.strokeStyle = fold.color;
    setLineWidth(ctx, SHAWL_FOLD_WIDTH, s);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  const bandStart = toFrame({
    x: SHAWL_HEM_START.x * SHAWL_BAND_SHRINK,
    y: SHAWL_HEM_START.y - SHAWL_BAND_INSET,
  });
  const bandEnd = toFrame({
    x: SHAWL_HEM_END.x * SHAWL_BAND_SHRINK,
    y: SHAWL_HEM_END.y - SHAWL_BAND_INSET,
  });
  ctx.strokeStyle = SHAWL_BAND_COLOR;
  setLineWidth(ctx, SHAWL_BAND_WIDTH, s);
  ctx.beginPath();
  ctx.moveTo(bandStart.x, bandStart.y);
  ctx.lineTo(bandEnd.x, bandEnd.y);
  ctx.stroke();
  if (scrap.soaked) {
    tracePolygon(ctx, SHAWL_SOAK.map(toFrame));
    ctx.fillStyle = SHAWL_SOAK_COLOR;
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}

/** The unsigned note: cream paper, one fold crease, three lines of neat ink. */
const NOTE_PAPER_COLOR = '#f2ead4';
const NOTE_SHADE_COLOR = '#d2c7a8';
const NOTE_INK_COLOR = '#22253a';
const NOTE_INK_WIDTH = 0.022;
const NOTE_LINE_COUNT = 3;
/** Margins inside the sheet, as fractions of its width and height. */
const NOTE_MARGIN_X = 0.16;
const NOTE_MARGIN_TOP = 0.22;
const NOTE_LINE_SPACING = 0.24;
/** The last line is a short sign-off, so the writing reads as a sentence. */
const NOTE_LAST_LINE_LENGTH = 0.45;
/** The fold crease divides the sheet and shades its lower half. */
const NOTE_FOLD_AT = 0.62;
const HOME_NOTE: Placement & { readonly depth: number } = {
  x: -0.46,
  y: 0.4,
  angle: -0.2,
  length: 0.46,
  depth: 0.34,
};

function drawNote(
  ctx: CanvasRenderingContext2D,
  note: Placement & { readonly depth: number },
  s: number,
): void {
  const width = note.length;
  const height = note.depth;
  const left = -width * HALF;
  const top = -height * HALF;
  ctx.save();
  ctx.translate(note.x, note.y);
  ctx.rotate(note.angle);

  ctx.fillStyle = CONTACT_SHADOW_COLOR;
  ctx.fillRect(left + SHADOW_OFFSET.x, top + SHADOW_OFFSET.y, width, height);

  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.fillStyle = NOTE_PAPER_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);
  const foldY = top + height * NOTE_FOLD_AT;
  ctx.fillStyle = NOTE_SHADE_COLOR;
  ctx.fillRect(left, foldY, width, top + height - foldY);

  ctx.strokeStyle = NOTE_INK_COLOR;
  setLineWidth(ctx, NOTE_INK_WIDTH, s);
  ctx.lineCap = 'round';
  for (let i = 0; i < NOTE_LINE_COUNT; i++) {
    const isLastLine = i === NOTE_LINE_COUNT - 1;
    const lineY = top + height * (NOTE_MARGIN_TOP + i * NOTE_LINE_SPACING);
    const lineStart = left + width * NOTE_MARGIN_X;
    const fullLength = width * (1 - NOTE_MARGIN_X * 2);
    const lineLength = isLastLine ? fullLength * NOTE_LAST_LINE_LENGTH : fullLength;
    ctx.beginPath();
    ctx.moveTo(lineStart, lineY);
    ctx.lineTo(lineStart + lineLength, lineY);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The cottage: claw furrows raked toward the street ending in a pool, a torn
 * plum shawl with its fringe beside it, and the unsigned schoolteacher's note.
 */
export function drawHomeClueProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(sx + s * HALF, sy + s * HALF);
  ctx.scale(s, s);

  drawGouges(ctx, HOME_FURROWS, HOME_FURROW_WIDTH, s);
  drawBloodPool(ctx, HOME_POOL.x, HOME_POOL.y, HOME_POOL.rx, HOME_POOL.ry, s);
  for (const scrap of HOME_SHAWL_SCRAPS) drawShawlScrap(ctx, scrap, s);
  drawNote(ctx, HOME_NOTE, s);

  ctx.restore();
}

// ── The tower roost ─────────────────────────────────────────────────────────

/** The spatter arc thrown up the tower base, north of the clue tile. */
const ROOST_SPATTER_DROP_COUNT = 9;
const ROOST_SPATTER_RADIUS = 0.8;
const ROOST_SPATTER_START_ANGLE = Math.PI * 1.18;
const ROOST_SPATTER_SWEEP = Math.PI * 0.64;
const ROOST_SPATTER_MAX_DROP_R = 0.075;
const ROOST_SPATTER_MIN_DROP_R = 0.025;
/** Each drop trails a tail back toward where the blood was thrown from. */
const ROOST_SPATTER_TAIL_RATIO = 1.6;

const FEATHER_VANE_COLOR = '#dfe4ec';
const FEATHER_SHADE_COLOR = '#a9b2c0';
const FEATHER_TIP_COLOR = '#76808f';
const FEATHER_SHAFT_COLOR = '#6c7484';
/** Softer than the shared outline: a near-black edge on a thin feather reads as a blade. */
const FEATHER_OUTLINE_COLOR = 'rgba(70, 78, 92, 0.85)';
/** A feather's vane bulges this far off its shaft, as a fraction of its length. */
const FEATHER_HALF_WIDTH_RATIO = 0.3;
/** The vane is fullest behind the tip, so the widest point sits past the middle. */
const FEATHER_WIDEST_ALONG_SHAFT = 0.55;
/** The bare quill showing below the vane. */
const FEATHER_QUILL_FRACTION = 0.18;
/** A dark barred tip — a skyfowl flight feather's marking, and its most legible part. */
const FEATHER_TIP_FRACTION = 0.16;
const FEATHER_SHAFT_WIDTH = 0.018;
/** The trailing vane is narrower than the leading one, as on a real flight feather. */
const FEATHER_TRAILING_VANE_RATIO = 0.7;

/**
 * The shrine ring, centred just south of the clue tile. Its slots run round
 * the full circle, but the north-east arc is where the thing burst through,
 * so those feathers are flung clear instead.
 */
const ROOST_RING_CENTRE: Point = { x: 0, y: 0.14 };
const ROOST_RING_RX = 0.78;
const ROOST_RING_RY = 0.46;
const ROOST_RING_SLOTS = 9;
const ROOST_RING_FEATHER_LENGTH = 0.4;
/** Slot bearings (radians, screen space) that fall inside the burst and are left empty. */
const ROOST_BURST_FROM = -Math.PI * 0.62;
const ROOST_BURST_TO = -Math.PI * 0.08;

const ROOST_FLUNG_FEATHERS: ReadonlyArray<Placement> = [
  { x: 0.46, y: -0.7, angle: -0.9, length: 0.4 },
  { x: 0.86, y: -0.3, angle: 0.4, length: 0.38 },
  { x: 0.1, y: -0.9, angle: -1.9, length: 0.34 },
];

const CANDLE_WAX_COLOR = '#e9c46a';
const CANDLE_WAX_SHADE_COLOR = '#b48a32';
const CANDLE_WICK_COLOR = '#2a1e14';
const CANDLE_FLAME_COLOR = '#ffd65a';
const CANDLE_FLAME_CORE_COLOR = '#fff7d8';
const CANDLE_GLOW_COLOR = 'rgba(255, 196, 92, 0.42)';
const CANDLE_GLOW_CLEAR = 'rgba(255, 196, 92, 0)';
const CANDLE_WIDTH = 0.12;
const CANDLE_HEIGHT = 0.28;
/** The wax lip is drawn as an ellipse this deep, so the candle reads as round. */
const CANDLE_TOP_DEPTH_RATIO = 0.35;
const CANDLE_SHADE_FRACTION = 0.35;
const CANDLE_FLAME_HEIGHT = 0.13;
const CANDLE_FLAME_HALF_WIDTH = 0.045;
const CANDLE_FLAME_CORE_SCALE = 0.45;
const CANDLE_GLOW_RADIUS = 0.3;
const CANDLE_WICK_LENGTH = 0.03;
const CANDLE_WAX_POOL_RX = 0.12;
const CANDLE_WAX_POOL_RY = 0.05;

/** The shrine's candles: two still burning, one knocked flat in a puddle of fresh wax. */
const ROOST_STANDING_CANDLES: ReadonlyArray<Point> = [
  { x: -0.24, y: 0.04 },
  { x: 0.12, y: 0.34 },
];
const ROOST_FALLEN_CANDLE: Placement = { x: 0.34, y: -0.12, angle: -0.5, length: CANDLE_HEIGHT };

interface FeatherPlacement extends Placement {
  /** Mirrors the vane so the ring's feathers do not all curl the same way. */
  readonly flip: boolean;
}

function drawFeather(ctx: CanvasRenderingContext2D, feather: FeatherPlacement, s: number): void {
  const length = feather.length;
  const quill = length * FEATHER_QUILL_FRACTION;
  const halfWidth = length * FEATHER_HALF_WIDTH_RATIO;
  const widest = quill + (length - quill) * FEATHER_WIDEST_ALONG_SHAFT;
  const tipStart = length * (1 - FEATHER_TIP_FRACTION);
  const traceVane = (): void => {
    ctx.beginPath();
    ctx.moveTo(quill, 0);
    ctx.quadraticCurveTo(widest, -halfWidth, length, 0);
    ctx.quadraticCurveTo(widest, halfWidth * FEATHER_TRAILING_VANE_RATIO, quill, 0);
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(feather.x, feather.y);
  ctx.rotate(feather.angle);
  if (feather.flip) ctx.scale(1, -1);

  ctx.save();
  ctx.translate(SHADOW_OFFSET.x, SHADOW_OFFSET.y);
  traceVane();
  ctx.restore();
  ctx.fillStyle = CONTACT_SHADOW_COLOR;
  ctx.fill();

  traceVane();
  ctx.fillStyle = FEATHER_VANE_COLOR;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = FEATHER_SHADE_COLOR;
  ctx.fillRect(quill, 0, length - quill, halfWidth);
  ctx.fillStyle = FEATHER_TIP_COLOR;
  ctx.fillRect(tipStart, -halfWidth, length - tipStart, halfWidth * 2);
  ctx.restore();
  traceVane();
  ctx.strokeStyle = FEATHER_OUTLINE_COLOR;
  setLineWidth(ctx, OUTLINE_WIDTH_TILES, s);
  ctx.stroke();

  ctx.strokeStyle = FEATHER_SHAFT_COLOR;
  setLineWidth(ctx, FEATHER_SHAFT_WIDTH, s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tipStart, 0);
  ctx.stroke();
  ctx.restore();
}

function drawCandleGlow(ctx: CanvasRenderingContext2D, flame: Point): void {
  const glow = ctx.createRadialGradient(flame.x, flame.y, 0, flame.x, flame.y, CANDLE_GLOW_RADIUS);
  glow.addColorStop(0, CANDLE_GLOW_COLOR);
  glow.addColorStop(1, CANDLE_GLOW_CLEAR);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(flame.x, flame.y, CANDLE_GLOW_RADIUS, 0, FULL_TURN);
  ctx.fill();
}

function drawFlame(ctx: CanvasRenderingContext2D, base: Point): void {
  const tipY = base.y - CANDLE_FLAME_HEIGHT;
  const traceFlame = (scale: number): void => {
    const halfWidth = CANDLE_FLAME_HALF_WIDTH * scale;
    const tip = base.y - CANDLE_FLAME_HEIGHT * scale;
    ctx.beginPath();
    ctx.moveTo(base.x, tip);
    ctx.quadraticCurveTo(base.x + halfWidth * 2, base.y, base.x, base.y);
    ctx.quadraticCurveTo(base.x - halfWidth * 2, base.y, base.x, tip);
    ctx.closePath();
  };
  drawCandleGlow(ctx, { x: base.x, y: (base.y + tipY) * HALF });
  traceFlame(1);
  ctx.fillStyle = CANDLE_FLAME_COLOR;
  ctx.fill();
  traceFlame(CANDLE_FLAME_CORE_SCALE);
  ctx.fillStyle = CANDLE_FLAME_CORE_COLOR;
  ctx.fill();
}

/** An upright candle stood on the paving, its base at `foot`. */
function drawStandingCandle(ctx: CanvasRenderingContext2D, foot: Point, s: number): void {
  const halfWidth = CANDLE_WIDTH * HALF;
  const topDepth = CANDLE_WIDTH * CANDLE_TOP_DEPTH_RATIO;
  const topY = foot.y - CANDLE_HEIGHT;

  fillEllipse(
    ctx,
    foot.x + SHADOW_OFFSET.x * 2,
    foot.y + SHADOW_OFFSET.y * HALF,
    CANDLE_WIDTH,
    topDepth,
    0,
    CONTACT_SHADOW_COLOR,
  );

  ctx.beginPath();
  ctx.moveTo(foot.x - halfWidth, topY);
  ctx.lineTo(foot.x - halfWidth, foot.y);
  ctx.ellipse(foot.x, foot.y, halfWidth, topDepth * HALF, 0, Math.PI, 0, true);
  ctx.lineTo(foot.x + halfWidth, topY);
  ctx.closePath();
  ctx.fillStyle = CANDLE_WAX_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);
  const shadeWidth = CANDLE_WIDTH * CANDLE_SHADE_FRACTION;
  ctx.fillStyle = CANDLE_WAX_SHADE_COLOR;
  ctx.fillRect(foot.x + halfWidth - shadeWidth, topY, shadeWidth, CANDLE_HEIGHT);

  ctx.beginPath();
  ctx.ellipse(foot.x, topY, halfWidth, topDepth * HALF, 0, 0, FULL_TURN);
  ctx.fillStyle = CANDLE_FLAME_CORE_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);

  ctx.strokeStyle = CANDLE_WICK_COLOR;
  setLineWidth(ctx, FEATHER_SHAFT_WIDTH, s);
  ctx.beginPath();
  ctx.moveTo(foot.x, topY);
  ctx.lineTo(foot.x, topY - CANDLE_WICK_LENGTH);
  ctx.stroke();
  drawFlame(ctx, { x: foot.x, y: topY - CANDLE_WICK_LENGTH * HALF });
}

/** A knocked-over candle lying in the puddle of wax it spilled. */
function drawFallenCandle(ctx: CanvasRenderingContext2D, candle: Placement, s: number): void {
  const halfLength = candle.length * HALF;
  const halfWidth = CANDLE_WIDTH * HALF;
  fillEllipse(
    ctx,
    candle.x,
    candle.y + halfWidth,
    CANDLE_WAX_POOL_RX + halfLength,
    CANDLE_WAX_POOL_RY,
    candle.angle,
    CANDLE_WAX_SHADE_COLOR,
  );
  ctx.save();
  ctx.translate(candle.x, candle.y);
  ctx.rotate(candle.angle);
  ctx.fillStyle = CONTACT_SHADOW_COLOR;
  ctx.fillRect(
    -halfLength + SHADOW_OFFSET.x,
    -halfWidth + SHADOW_OFFSET.y,
    candle.length,
    CANDLE_WIDTH,
  );
  ctx.beginPath();
  ctx.rect(-halfLength, -halfWidth, candle.length, CANDLE_WIDTH);
  ctx.fillStyle = CANDLE_WAX_COLOR;
  ctx.fill();
  outlineCurrentPath(ctx, s);
  ctx.fillStyle = CANDLE_WAX_SHADE_COLOR;
  ctx.fillRect(
    -halfLength,
    halfWidth - CANDLE_WIDTH * CANDLE_SHADE_FRACTION,
    candle.length,
    CANDLE_WIDTH * CANDLE_SHADE_FRACTION,
  );
  ctx.strokeStyle = CANDLE_WICK_COLOR;
  setLineWidth(ctx, FEATHER_SHAFT_WIDTH, s);
  ctx.beginPath();
  ctx.moveTo(halfLength, 0);
  ctx.lineTo(halfLength + CANDLE_WICK_LENGTH, 0);
  ctx.stroke();
  ctx.restore();
}

function ringFeathers(): FeatherPlacement[] {
  const feathers: FeatherPlacement[] = [];
  for (let i = 0; i < ROOST_RING_SLOTS; i++) {
    const bearing = -Math.PI + (i / ROOST_RING_SLOTS) * FULL_TURN;
    if (bearing > ROOST_BURST_FROM && bearing < ROOST_BURST_TO) continue;
    const quillX = ROOST_RING_CENTRE.x + Math.cos(bearing) * ROOST_RING_RX;
    const quillY = ROOST_RING_CENTRE.y + Math.sin(bearing) * ROOST_RING_RY;
    // Laid quill-out with the tip pointing at the centre, the way a ring of
    // offerings is placed by hand — the order is what says "shrine".
    const inward = Math.atan2(ROOST_RING_CENTRE.y - quillY, ROOST_RING_CENTRE.x - quillX);
    feathers.push({
      x: quillX,
      y: quillY,
      angle: inward,
      length: ROOST_RING_FEATHER_LENGTH,
      flip: i % 2 === 0,
    });
  }
  return feathers;
}

const ROOST_RING_FEATHERS = ringFeathers();

/**
 * The tower plaza: the shrine's careful ring of moulted feathers burst open on
 * the tower side, its beeswax candles still burning or knocked flat, the
 * feathers that were flung clear, and blood thrown in an arc up the stone.
 */
export function drawRoostClueProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(sx + s * HALF, sy + s * HALF);
  ctx.scale(s, s);

  ctx.fillStyle = SPATTER_COLOR;
  for (let i = 0; i < ROOST_SPATTER_DROP_COUNT; i++) {
    const alongArc = i / (ROOST_SPATTER_DROP_COUNT - 1);
    const angle = ROOST_SPATTER_START_ANGLE + alongArc * ROOST_SPATTER_SWEEP;
    const dropRadius =
      ROOST_SPATTER_MIN_DROP_R +
      (ROOST_SPATTER_MAX_DROP_R - ROOST_SPATTER_MIN_DROP_R) * Math.sin(alongArc * Math.PI);
    const dropX = Math.cos(angle) * ROOST_SPATTER_RADIUS;
    const dropY = Math.sin(angle) * ROOST_SPATTER_RADIUS;
    ctx.beginPath();
    ctx.ellipse(
      dropX,
      dropY,
      dropRadius * ROOST_SPATTER_TAIL_RATIO,
      dropRadius,
      angle,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }

  for (const feather of ROOST_RING_FEATHERS) drawFeather(ctx, feather, s);
  ROOST_FLUNG_FEATHERS.forEach((feather, index) => {
    drawFeather(ctx, { ...feather, flip: index % 2 === 1 }, s);
  });

  drawFallenCandle(ctx, ROOST_FALLEN_CANDLE, s);
  for (const foot of ROOST_STANDING_CANDLES) drawStandingCandle(ctx, foot, s);

  ctx.restore();
}
