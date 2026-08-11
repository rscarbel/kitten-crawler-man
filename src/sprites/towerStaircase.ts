import { frameTime } from '../utils';

/**
 * A medieval newel stair — the stone spiral a tower actually has: wedge-shaped
 * treads cantilevered off a solid masonry newel, with a coursed parapet wall
 * curving behind them.
 *
 * Drawn as an **overlay**. The caller paints the room's own floor first and this
 * adds the masonry on top, so the stair sits in the tower's stone rather than on
 * a patch of its own colour. Nothing here fills the tile background.
 *
 * The palette is the room's: cool grey ashlar at the tower floor's own hue, with
 * mortar joints and no timber, carpet or metalwork anywhere. An earlier pass gave
 * the stair a red carpet runner and a brass handrail, and it read as a piece of
 * furniture someone had carried in rather than as part of the building.
 *
 * The block is drawn in full for every tile of it, clipped to that tile. Painting
 * a quarter of a spiral per tile independently is what makes tiled stairs look
 * like four unrelated step patterns; drawing the whole figure and clipping means
 * the arcs and the courses cross the tile seams as single continuous curves.
 *
 * Two things carry the "these are stairs, and they go that way" read, and both are
 * exaggerated well past what the geometry would give:
 *
 * - **Rise.** One turn of a real spiral, seen from this near-overhead angle,
 *   climbs a few pixels and comes out a flat ring — a wheel, not a staircase.
 *   The climb here is over half the block.
 * - **Taper.** Each successive tread is drawn smaller than the one before it, so
 *   the flight recedes: away and upward toward a lit hatch for stairs up, away and
 *   downward into a dark well for stairs down.
 */

/** Everything below is a fraction of the block's pixel size, so the art scales with tile size. */
const CENTRE_X = 0.5;
const INNER_RADIUS_FRACTION = 0.3;
/**
 * Treads are elliptical rather than circular: the view is overhead but oblique,
 * and the flatter the ellipse the more of the block is left for the climb to use.
 */
const ELLIPSE_SQUASH = 0.36;

/** Where the flight starts — front-right, so it opens toward the viewer. */
const START_ANGLE = Math.PI * 0.25;
/** Wedges are drawn a little wider than their pitch so consecutive treads butt rather than gap. */
const TREAD_OVERLAP = 1.06;

interface FlightShape {
  readonly treadCount: number;
  /** How far around the newel the flight winds, in radians. */
  readonly sweep: number;
  /** Screen y of the near tread's centre. */
  readonly baseY: number;
  readonly outerRx: number;
  /** Screen offset of the far end of the flight — negative climbs, positive descends. */
  readonly travelY: number;
  /** How much smaller the far tread is drawn than the near one. */
  readonly taper: number;
  /** Brightness at the far end relative to the near end. */
  readonly farShade: number;
}

/**
 * A rising flight is drawn as a side-on climb: one turn, exaggerated hugely in
 * height so the treads stack into a visible staircase rather than the near-flat
 * ring the true projection would give.
 */
const UP_FLIGHT: FlightShape = {
  treadCount: 11,
  sweep: Math.PI * 2,
  baseY: 0.76,
  outerRx: 0.42,
  travelY: -0.52,
  taper: 0.34,
  farShade: 1.2,
};

/**
 * A descending flight lives entirely inside the hole cut for it, so its numbers
 * are bounded by the mouth below rather than by the block: the whole flight, plus
 * each tread's own ellipse, has to fit between the mouth's top and bottom or a
 * step is drawn lying on the floor outside the hole.
 *
 * A true overhead projection of a descent — nearly two turns spiralling inward
 * with almost no travel down the screen — was tried first and read as a flat ring:
 * the outermost arc is drawn last and closes into a circle that hides every turn
 * inside it. So the flight still descends visibly; it is the clip that keeps it
 * underground.
 */
const DOWN_FLIGHT: FlightShape = {
  treadCount: 11,
  sweep: Math.PI * 2,
  baseY: 0.4,
  outerRx: 0.34,
  travelY: 0.26,
  taper: 0.28,
  farShade: 0.74,
};

/** The opening cut in the floor, which a descending flight is clipped to. */
const WELL_MOUTH_Y = 0.5;
const WELL_MOUTH_RX = 0.42;
/**
 * Rounder than a tread, because a hole in the floor is looked almost straight down
 * into while the steps inside it are still seen at the room's oblique angle.
 */
const WELL_MOUTH_SQUASH = 0.66;
const WELL_KERB_THICKNESS = 0.035;

/**
 * The parapet is the low wall the treads run against, and it is drawn only on the
 * far side of the spiral.
 *
 * A real newel stair is enclosed by the tower wall the whole way round, which from
 * overhead would hide every step behind masonry. Walling the back and leaving the
 * front open is the cutaway that lets the steps be seen at all.
 */
const PARAPET_HEIGHT = 0.075;
const PARAPET_CAP = 0.022;
const BACK_ARC_START = Math.PI;
const BACK_ARC_END = Math.PI * 2;

const NEWEL_HALF_WIDTH = 0.052;
const NEWEL_COURSE_COUNT = 5;
const NEWEL_CAP_R = 0.062;
const NEWEL_CAP_RISE = 0.045;

const DRUM_RX = 0.44;
const DRUM_THICKNESS = 0.07;
const FLOOR_SHADOW_RX = 0.44;
const FLOOR_SHADOW_RY = 0.11;
const FLOOR_SHADOW_DROP = 0.05;

const SEAM_THICKNESS = 0.012;
/**
 * Floor for the step face height. A flight that travels very little down-screen
 * would otherwise derive a sub-pixel riser and lose the step read entirely.
 */
const MIN_RISER_DROP = 0.03;

/** Sunlight direction, as the screen angle whose treads catch the most light. */
const LIGHT_ANGLE = -Math.PI * 0.75;
const LIGHT_RANGE = 0.22;

/**
 * Ashlar at the tower floor's own colour, so the stair reads as cut from the room
 * rather than dropped into it. Keep these in step with `interior_stone` in
 * `src/map/town/interiorMaterials.ts`.
 */
const STONE_BASE_R = 151;
const STONE_BASE_G = 151;
const STONE_BASE_B = 157;
const RISER_DARKEN = 0.68;
const NOSING_LIGHTEN = 1.14;
const TREAD_WEAR_DARKEN = 0.91;
/** The worn hollow each tread carries, as a fraction of its width. */
const WEAR_INNER = 0.46;
const WEAR_OUTER = 0.84;

const MORTAR_COLOR = 'rgba(58, 58, 64, 0.85)';
const SEAM_COLOR = 'rgba(40, 40, 46, 0.8)';
const DRUM_STONE = '#5f5f66';
const DRUM_STONE_LIT = '#7c7c84';
const NEWEL_LIGHT = '#a6a6ad';
const NEWEL_DARK = '#5d5d65';
const NEWEL_CAP_COLOR = '#8e8e96';
const WELL_WALL = '#666670';
const WELL_DARK = '#26262e';
const FLOOR_SHADOW_COLOR = 'rgba(0, 0, 0, 0.38)';

/** Torchlight from the opening the flight leads to — the one warm note, kept faint. */
const GLOW_PULSE_PERIOD_MS = 900;
const GLOW_PULSE_CENTRE = 0.3;
const GLOW_PULSE_AMPLITUDE = 0.1;
const GLOW_RX = 0.26;
const UP_GLOW_COLOR = '255, 232, 178';
const DOWN_GLOW_COLOR = '255, 186, 112';

interface Tread {
  readonly startAngle: number;
  readonly endAngle: number;
  readonly midAngle: number;
  /** Screen y of this tread's ellipse centre. */
  readonly y: number;
  readonly outerRx: number;
  readonly outerRy: number;
  readonly innerRx: number;
  readonly innerRy: number;
  /** Vertical face height under this tread. */
  readonly riserDrop: number;
  readonly shade: number;
}

function stoneFill(shade: number): string {
  return (
    `rgb(${Math.round(Math.min(255, STONE_BASE_R * shade))}, ` +
    `${Math.round(Math.min(255, STONE_BASE_G * shade))}, ` +
    `${Math.round(Math.min(255, STONE_BASE_B * shade))})`
  );
}

/**
 * The flight's treads, ordered far-end-first so the painter's order is correct.
 *
 * Every tread carries its own already-tapered radii rather than a scale factor, so
 * the riser, the wear hollow, the parapet and the seams all read the same geometry
 * and cannot drift apart from the tread they belong to.
 */
function buildTreads(shape: FlightShape, block: number): Tread[] {
  const pitch = shape.sweep / shape.treadCount;
  const baseOuterRx = block * shape.outerRx;
  const travel = block * shape.travelY;
  const riserDrop = Math.max(block * MIN_RISER_DROP, Math.abs(travel) / (shape.treadCount - 1));
  const treads: Tread[] = [];
  for (let i = shape.treadCount - 1; i >= 0; i--) {
    const depth = i / (shape.treadCount - 1);
    const outerRx = baseOuterRx * (1 - depth * shape.taper);
    const midAngle = START_ANGLE + i * pitch + (pitch * TREAD_OVERLAP) / 2;
    const facing = Math.cos(midAngle - LIGHT_ANGLE);
    treads.push({
      startAngle: START_ANGLE + i * pitch,
      endAngle: START_ANGLE + i * pitch + pitch * TREAD_OVERLAP,
      midAngle,
      y: block * shape.baseY + depth * travel,
      outerRx,
      outerRy: outerRx * ELLIPSE_SQUASH,
      innerRx: outerRx * INNER_RADIUS_FRACTION,
      innerRy: outerRx * INNER_RADIUS_FRACTION * ELLIPSE_SQUASH,
      riserDrop,
      shade: (1 + facing * LIGHT_RANGE) * (1 + depth * (shape.farShade - 1)),
    });
  }
  return treads;
}

/** An annular wedge between two concentric ellipses, as a closed path. */
function wedgePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRx: number,
  outerRy: number,
  innerRx: number,
  innerRy: number,
  startAngle: number,
  endAngle: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, outerRx, outerRy, 0, startAngle, endAngle);
  ctx.ellipse(cx, cy, innerRx, innerRy, 0, endAngle, startAngle, true);
  ctx.closePath();
}

/** A band between one arc and the same arc offset down the screen — a vertical face. */
function facePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  rx: number,
  ry: number,
  drop: number,
  startAngle: number,
  endAngle: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, topY, rx, ry, 0, startAngle, endAngle);
  ctx.ellipse(cx, topY + drop, rx, ry, 0, endAngle, startAngle, true);
  ctx.closePath();
}

/** The dark line between two treads, which is what separates them into steps. */
function drawTreadSeam(
  ctx: CanvasRenderingContext2D,
  cx: number,
  tread: Tread,
  angle: number,
  block: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angle) * tread.innerRx, tread.y + Math.sin(angle) * tread.innerRy);
  ctx.lineTo(cx + Math.cos(angle) * tread.outerRx, tread.y + Math.sin(angle) * tread.outerRy);
  ctx.strokeStyle = SEAM_COLOR;
  ctx.lineWidth = Math.max(1, block * SEAM_THICKNESS);
  ctx.stroke();
}

/** True when this tread sits on the far side of the newel, where the wall is drawn. */
function isOnBackArc(midAngle: number): boolean {
  const wrapped = ((midAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return wrapped > BACK_ARC_START && wrapped < BACK_ARC_END;
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
  ctx: CanvasRenderingContext2D,
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

  const cx = block * CENTRE_X;
  if (isUp) drawRisingFlight(ctx, cx, block);
  else drawDescendingFlight(ctx, cx, block);

  ctx.restore();
}

/** A flight climbing out of the floor: masonry standing in the room. */
function drawRisingFlight(ctx: CanvasRenderingContext2D, cx: number, block: number): void {
  const treads = buildTreads(UP_FLIGHT, block);
  const nearTread = treads[treads.length - 1];
  const farTread = treads[0];

  drawFloorShadow(ctx, cx, nearTread.y, block);
  drawDrum(ctx, cx, nearTread, block);
  drawNewel(ctx, cx, nearTread.y, farTread.y - block * NEWEL_CAP_RISE, block);
  drawOpeningGlow(ctx, cx, farTread.y, block, true);
  paintTreads(ctx, cx, treads, block, true);
  drawNewelCap(ctx, cx, farTread.y - block * NEWEL_CAP_RISE, block);
}

/**
 * A flight going down, which is a **hole**: everything below the floor plane, seen
 * through an opening cut in it.
 *
 * The flight is clipped to that opening, so no part of a descent can be drawn
 * standing above the floor the player is walking on. An earlier version mirrored
 * the rising flight and left its kerb and top tread above the plane, which read as
 * a structure rising out of the ground rather than a stair going into it.
 *
 * The mouth is drawn far rounder than a tread (`WELL_MOUTH_SQUASH` against
 * `ELLIPSE_SQUASH`) because you look almost straight down a hole in the floor,
 * where the treads inside it are still seen at the room's oblique angle. It also
 * buys the vertical room the descent needs: at the treads' own squash the opening
 * would be a slot too flat for a flight to be visible inside.
 */
function drawDescendingFlight(ctx: CanvasRenderingContext2D, cx: number, block: number): void {
  const mouthY = block * WELL_MOUTH_Y;
  const mouthRx = block * WELL_MOUTH_RX;
  const mouthRy = mouthRx * WELL_MOUTH_SQUASH;
  const treads = buildTreads(DOWN_FLIGHT, block);
  const nearTread = treads[treads.length - 1];
  const farTread = treads[0];

  const shaft = ctx.createLinearGradient(0, mouthY - mouthRy, 0, mouthY + mouthRy);
  shaft.addColorStop(0, WELL_WALL);
  shaft.addColorStop(1, WELL_DARK);
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = shaft;
  ctx.fill();

  ctx.save();
  ctx.clip();
  drawOpeningGlow(ctx, cx, farTread.y, block, false);
  drawNewel(ctx, cx, farTread.y, nearTread.y, block);
  paintTreads(ctx, cx, treads, block, false);
  ctx.restore();

  // The kerb last and over the flight, so the near lip of the hole cuts across the
  // steps behind it — which is what puts them below the floor rather than on it.
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.strokeStyle = DRUM_STONE_LIT;
  ctx.lineWidth = Math.max(1, block * WELL_KERB_THICKNESS);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.strokeStyle = MORTAR_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Paint a built flight, back to front. */
function paintTreads(
  ctx: CanvasRenderingContext2D,
  cx: number,
  treads: ReadonlyArray<Tread>,
  block: number,
  withParapet: boolean,
): void {
  for (const tread of treads) {
    if (withParapet && isOnBackArc(tread.midAngle)) drawParapet(ctx, cx, tread, block);

    facePath(
      ctx,
      cx,
      tread.y,
      tread.outerRx,
      tread.outerRy,
      tread.riserDrop,
      tread.startAngle,
      tread.endAngle,
    );
    ctx.fillStyle = stoneFill(tread.shade * RISER_DARKEN);
    ctx.fill();

    wedgePath(
      ctx,
      cx,
      tread.y,
      tread.outerRx,
      tread.outerRy,
      tread.innerRx,
      tread.innerRy,
      tread.startAngle,
      tread.endAngle,
    );
    ctx.fillStyle = stoneFill(tread.shade);
    ctx.fill();

    // Centuries of feet hollow the middle of a stone tread. It is also the only
    // tonal break across an otherwise uniform grey wedge.
    wedgePath(
      ctx,
      cx,
      tread.y,
      tread.outerRx * WEAR_OUTER,
      tread.outerRy * WEAR_OUTER,
      tread.outerRx * WEAR_INNER,
      tread.outerRy * WEAR_INNER,
      tread.startAngle,
      tread.endAngle,
    );
    ctx.fillStyle = stoneFill(tread.shade * TREAD_WEAR_DARKEN);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, tread.y, tread.outerRx, tread.outerRy, 0, tread.startAngle, tread.endAngle);
    ctx.strokeStyle = stoneFill(tread.shade * NOSING_LIGHTEN);
    ctx.lineWidth = Math.max(1, block * SEAM_THICKNESS);
    ctx.stroke();

    drawTreadSeam(ctx, cx, tread, tread.startAngle, block);
    drawTreadSeam(ctx, cx, tread, tread.endAngle, block);
  }
}

function drawFloorShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  block: number,
): void {
  ctx.beginPath();
  ctx.ellipse(
    cx,
    baseY + block * FLOOR_SHADOW_DROP,
    block * FLOOR_SHADOW_RX,
    block * FLOOR_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = FLOOR_SHADOW_COLOR;
  ctx.fill();
}

/** The coursed wall standing on the outer edge of one tread. */
function drawParapet(ctx: CanvasRenderingContext2D, cx: number, tread: Tread, block: number): void {
  const height = block * PARAPET_HEIGHT;
  const cap = block * PARAPET_CAP;
  const topY = tread.y - height;

  facePath(ctx, cx, topY, tread.outerRx, tread.outerRy, height, tread.startAngle, tread.endAngle);
  ctx.fillStyle = stoneFill(tread.shade * RISER_DARKEN * 1.12);
  ctx.fill();

  facePath(ctx, cx, topY, tread.outerRx, tread.outerRy, cap, tread.startAngle, tread.endAngle);
  ctx.fillStyle = stoneFill(tread.shade * NOSING_LIGHTEN);
  ctx.fill();

  // A course line along the wall and a vertical joint through it, so the parapet
  // reads as laid blocks rather than a smooth band.
  ctx.strokeStyle = MORTAR_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    topY + height * 0.55,
    tread.outerRx,
    tread.outerRy,
    0,
    tread.startAngle,
    tread.endAngle,
  );
  ctx.stroke();
  const jointX = cx + Math.cos(tread.midAngle) * tread.outerRx;
  const jointY = tread.y + Math.sin(tread.midAngle) * tread.outerRy;
  ctx.beginPath();
  ctx.moveTo(jointX, jointY);
  ctx.lineTo(jointX, jointY - height);
  ctx.stroke();
}

/** The tower's own masonry, curving away behind a rising flight. */
function drawDrum(
  ctx: CanvasRenderingContext2D,
  cx: number,
  nearTread: Tread,
  block: number,
): void {
  const rx = block * DRUM_RX;
  const ry = rx * ELLIPSE_SQUASH;
  const thickness = block * DRUM_THICKNESS;

  wedgePath(
    ctx,
    cx,
    nearTread.y,
    rx,
    ry,
    rx - thickness,
    ry - thickness * ELLIPSE_SQUASH,
    BACK_ARC_START,
    BACK_ARC_END,
  );
  ctx.fillStyle = DRUM_STONE;
  ctx.fill();

  wedgePath(
    ctx,
    cx,
    nearTread.y,
    rx,
    ry,
    rx - thickness * 0.4,
    ry - thickness * 0.4 * ELLIPSE_SQUASH,
    BACK_ARC_START,
    BACK_ARC_END,
  );
  ctx.fillStyle = DRUM_STONE_LIT;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(
    cx,
    nearTread.y,
    rx - thickness,
    ry - thickness * ELLIPSE_SQUASH,
    0,
    BACK_ARC_START,
    BACK_ARC_END,
  );
  ctx.strokeStyle = MORTAR_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** The solid masonry pier every tread is cut into. */
function drawNewel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  fromY: number,
  toY: number,
  block: number,
): void {
  const halfWidth = block * NEWEL_HALF_WIDTH;
  const top = Math.min(fromY, toY);
  const height = Math.abs(toY - fromY);
  ctx.fillStyle = NEWEL_DARK;
  ctx.fillRect(cx - halfWidth, top, halfWidth * 2, height);
  ctx.fillStyle = NEWEL_LIGHT;
  ctx.fillRect(cx - halfWidth, top, halfWidth * 0.7, height);

  ctx.strokeStyle = MORTAR_COLOR;
  ctx.lineWidth = 1;
  for (let i = 1; i < NEWEL_COURSE_COUNT; i++) {
    const y = Math.round(top + (height * i) / NEWEL_COURSE_COUNT) + 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, y);
    ctx.lineTo(cx + halfWidth, y);
    ctx.stroke();
  }
}

/** The stone cap on top of the newel, which is what shows where a climb ends. */
function drawNewelCap(ctx: CanvasRenderingContext2D, cx: number, y: number, block: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, y, block * NEWEL_CAP_R, block * NEWEL_CAP_R * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = NEWEL_CAP_COLOR;
  ctx.fill();
  ctx.strokeStyle = MORTAR_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Light from the opening the flight leads to: a hatch overhead, or a lit landing below. */
function drawOpeningGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  farY: number,
  block: number,
  isUp: boolean,
): void {
  const glow =
    GLOW_PULSE_CENTRE + Math.sin((frameTime * 1000) / GLOW_PULSE_PERIOD_MS) * GLOW_PULSE_AMPLITUDE;
  const rx = block * GLOW_RX;
  const ry = rx * ELLIPSE_SQUASH;
  const color = isUp ? UP_GLOW_COLOR : DOWN_GLOW_COLOR;
  const gradient = ctx.createRadialGradient(cx, farY, 0, cx, farY, rx);
  gradient.addColorStop(0, `rgba(${color}, ${glow})`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);
  ctx.save();
  ctx.translate(cx, farY);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}
