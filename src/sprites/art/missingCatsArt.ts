/**
 * The small things "A Cat Always Comes Back" turns up: the grey flight feather
 * beside the millstones, a tin of tuna, the dish nobody in the house filled,
 * and a window latch cut clean through. Each is one bold silhouette, painted
 * both as an item icon and on the floor of the room it is found in, so the
 * thing in the bag is the thing that was on the floor.
 */

const OUTLINE = '#1e1a18';
const OUTLINE_WIDTH_SHARE = 0.05;

const FEATHER_VANE = '#8d929a';
const FEATHER_VANE_SHADE = '#5f646c';
const FEATHER_SHAFT = '#d9d4c8';
/** Along its length the vane is widest a little below the middle, as a flight feather is. */
const FEATHER_WIDEST_SHARE = 0.42;
const FEATHER_HALF_WIDTH_SHARE = 0.17;
const FEATHER_QUILL_SHARE = 0.16;
const FEATHER_BARB_NOTCHES = 3;
const FEATHER_NOTCH_DEPTH_SHARE = 0.06;
/** How far back toward the shaft a notch's inner end sits, as a share of its outer end's reach. */
const FEATHER_NOTCH_TAPER = 0.4;

/**
 * A long grey flight feather lying along the x axis, tip at +x, `length`
 * pixels end to end, centred on the origin.
 */
export function drawGreyFeatherShape(ctx: CanvasRenderingContext2D, length: number): void {
  const half = length / 2;
  const tipX = half;
  const quillX = -half;
  const vaneStartX = quillX + length * FEATHER_QUILL_SHARE;
  const widestX = quillX + length * (FEATHER_QUILL_SHARE + FEATHER_WIDEST_SHARE);
  const halfWidth = length * FEATHER_HALF_WIDTH_SHARE;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, length * OUTLINE_WIDTH_SHARE);
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(vaneStartX, 0);
  ctx.quadraticCurveTo(widestX, -halfWidth * 2, tipX, 0);
  ctx.quadraticCurveTo(widestX, halfWidth * 2, vaneStartX, 0);
  ctx.closePath();
  ctx.fillStyle = FEATHER_VANE;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = FEATHER_VANE_SHADE;
  ctx.beginPath();
  ctx.moveTo(vaneStartX, 0);
  ctx.quadraticCurveTo(widestX, halfWidth * 2, tipX, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  for (let notch = 1; notch <= FEATHER_BARB_NOTCHES; notch++) {
    const share = notch / (FEATHER_BARB_NOTCHES + 1);
    const x = vaneStartX + (tipX - vaneStartX) * share;
    ctx.beginPath();
    ctx.moveTo(x, -halfWidth * (1 - share));
    ctx.lineTo(
      x + length * FEATHER_NOTCH_DEPTH_SHARE,
      -halfWidth * (1 - share) * FEATHER_NOTCH_TAPER,
    );
    ctx.stroke();
  }
  ctx.strokeStyle = FEATHER_SHAFT;
  ctx.beginPath();
  ctx.moveTo(quillX, 0);
  ctx.lineTo(tipX, 0);
  ctx.stroke();
  ctx.restore();
}

const TIN_SIDE = '#b9c0c6';
const TIN_SIDE_SHADE = '#7f878e';
const TIN_LABEL = '#3d6fa6';
const TIN_LABEL_STRIPE = '#e8d27a';
const TIN_LID = '#d8dde1';
const TIN_HEIGHT_SHARE = 0.55;
const TIN_LID_DEPTH_SHARE = 0.32;
const TIN_LABEL_TOP_SHARE = 0.3;
const TIN_LABEL_HEIGHT_SHARE = 0.45;
const TIN_STRIPE_HEIGHT_SHARE = 0.1;

/** A squat round tin seen a little from above, `width` pixels across, centred on the origin. */
export function drawTunaTinShape(ctx: CanvasRenderingContext2D, width: number): void {
  const rx = width / 2;
  const ry = rx * TIN_LID_DEPTH_SHARE;
  const height = width * TIN_HEIGHT_SHARE;
  const top = -height / 2;
  const bottom = height / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, width * OUTLINE_WIDTH_SHARE);
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = TIN_SIDE;
  ctx.beginPath();
  ctx.moveTo(-rx, top);
  ctx.lineTo(-rx, bottom);
  ctx.ellipse(0, bottom, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(rx, top);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TIN_SIDE_SHADE;
  ctx.fillRect(rx * TIN_LID_DEPTH_SHARE, top, rx * (1 - TIN_LID_DEPTH_SHARE), height);
  const labelTop = top + height * TIN_LABEL_TOP_SHARE;
  const labelHeight = height * TIN_LABEL_HEIGHT_SHARE;
  ctx.fillStyle = TIN_LABEL;
  ctx.fillRect(-rx, labelTop, width, labelHeight);
  ctx.fillStyle = TIN_LABEL_STRIPE;
  ctx.fillRect(-rx, labelTop + labelHeight / 2, width, height * TIN_STRIPE_HEIGHT_SHARE);
  ctx.fillStyle = TIN_LID;
  ctx.beginPath();
  ctx.ellipse(0, top, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const DISH_RIM = '#c9b79a';
const DISH_SHADE = '#8f7d63';
const DISH_TUNA = '#c98a73';
const DISH_DEPTH_SHARE = 0.38;
const DISH_FILL_SHARE = 0.7;

/** A shallow clay saucer with a heap of fish in it, `width` pixels across, centred on the origin. */
export function drawTunaDishShape(ctx: CanvasRenderingContext2D, width: number): void {
  const rx = width / 2;
  const ry = rx * DISH_DEPTH_SHARE;
  ctx.save();
  ctx.lineWidth = Math.max(1, width * OUTLINE_WIDTH_SHARE);
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = DISH_SHADE;
  ctx.beginPath();
  ctx.ellipse(0, ry / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = DISH_RIM;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = DISH_TUNA;
  ctx.beginPath();
  ctx.ellipse(
    0,
    -ry * DISH_FILL_SHARE * DISH_DEPTH_SHARE,
    rx * DISH_FILL_SHARE,
    ry * DISH_FILL_SHARE,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

const LATCH_IRON = '#4a4c52';
const LATCH_CUT = '#e6e0c8';
const LATCH_BAR_SHARE = 0.22;
const LATCH_GAP_SHARE = 0.12;
const LATCH_CUT_FACE_PX = 1;

/**
 * A window's iron latch bar, cut clean through in the middle with a bright
 * sawn face either side of the gap, `width` pixels across.
 */
export function drawCutLatchShape(ctx: CanvasRenderingContext2D, width: number): void {
  const barHeight = width * LATCH_BAR_SHARE;
  const gap = width * LATCH_GAP_SHARE;
  const halfWidth = width / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, width * OUTLINE_WIDTH_SHARE);
  ctx.strokeStyle = OUTLINE;
  for (const side of [-1, 1] as const) {
    const near = (gap / 2) * side;
    const far = halfWidth * side;
    const x = Math.min(near, far);
    const w = Math.abs(far - near);
    ctx.fillStyle = LATCH_IRON;
    ctx.fillRect(x, -barHeight / 2, w, barHeight);
    ctx.strokeRect(x, -barHeight / 2, w, barHeight);
    ctx.fillStyle = LATCH_CUT;
    ctx.fillRect(
      side < 0 ? near - LATCH_CUT_FACE_PX : near,
      -barHeight / 2,
      LATCH_CUT_FACE_PX,
      barHeight,
    );
  }
  ctx.restore();
}

const THIEF_BODY = '#2c2a33';
const THIEF_WING = '#3d3a46';
const THIEF_WING_EDGE = '#5b5866';
const THIEF_SHADOW = 'rgba(0,0,0,0.28)';
const CARRIED_CAT = '#c98a4a';
const WING_SPAN_SHARE = 1.1;
const WING_DEPTH_SHARE = 0.32;
const WING_FLAP_LIFT_SHARE = 0.28;
const BODY_LENGTH_SHARE = 0.42;
const BODY_WIDTH_SHARE = 0.14;
const HEAD_RADIUS_SHARE = 0.09;
const SHADOW_WIDTH_SHARE = 0.7;
const SHADOW_HEIGHT_SHARE = 0.18;
const CARRIED_CAT_RADIUS_SHARE = 0.12;
const CARRIED_CAT_DROP_SHARE = 0.3;
const HALF = 0.5;

/**
 * The thief's shadow on the ground under it, `size` pixels across: the one
 * part of it that sits on the street, so a player can tell where over the
 * roofs it is.
 */
export function drawWingedThiefShadow(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.fillStyle = THIEF_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    size * SHADOW_WIDTH_SHARE * HALF,
    size * SHADOW_HEIGHT_SHARE * HALF,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

/**
 * A winged shape seen against the dusk from below: no face, no colours, only
 * a long body between two broad wings, the wings lifted by `flap` (-1 to 1).
 * `heading` is in radians, 0 = east. With `carrying` a small cat hangs under it.
 */
export function drawWingedThief(
  ctx: CanvasRenderingContext2D,
  size: number,
  heading: number,
  flap: number,
  carrying: boolean,
): void {
  const span = size * WING_SPAN_SHARE;
  const depth = size * WING_DEPTH_SHARE;
  const lift = size * WING_FLAP_LIFT_SHARE * flap;
  ctx.save();
  ctx.rotate(heading);
  ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH_SHARE);
  ctx.strokeStyle = THIEF_WING_EDGE;
  ctx.fillStyle = THIEF_WING;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-depth, side * (span * HALF + lift), -depth * 2, side * span * HALF);
    ctx.quadraticCurveTo(-depth * HALF, side * depth, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = THIEF_BODY;
  ctx.beginPath();
  ctx.ellipse(
    -size * BODY_LENGTH_SHARE * HALF,
    0,
    size * BODY_LENGTH_SHARE * HALF,
    size * BODY_WIDTH_SHARE,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * HEAD_RADIUS_SHARE, 0, size * HEAD_RADIUS_SHARE, 0, Math.PI * 2);
  ctx.fill();
  if (carrying) {
    ctx.fillStyle = CARRIED_CAT;
    ctx.beginPath();
    ctx.arc(-size * CARRIED_CAT_DROP_SHARE, 0, size * CARRIED_CAT_RADIUS_SHARE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
