/**
 * Sprite functions for gym equipment items:
 *   - Dumbbell  (floor world, inventory icon, held-by-Juicer)
 *   - Bench press (floor world, inventory icon)
 *   - Treadmill   (floor world, inventory icon)
 *
 * The bench and the treadmill are drawn in the game's three-quarter view: the
 * machine runs away from the camera, so its length foreshortens along -y and
 * anything upright (posts, barbell, console) stacks above its floor contact
 * point. Every surface is shaded rather than flat-filled — round steel gets a
 * cylinder gradient across its short axis, flat panels get a light-from-above
 * ramp — because at one tile the silhouette alone cannot say "machine".
 */

const TAU = Math.PI * 2;

/** Dark / mid / light stops for one material, ordered as a lit cylinder reads. */
interface Shade {
  dark: string;
  mid: string;
  light: string;
}

const BRUSHED_STEEL: Shade = { dark: '#1c1f24', mid: '#5d656f', light: '#aeb7c2' };
const POWDER_COAT: Shade = { dark: '#0e1013', mid: '#2b2f35', light: '#5a626c' };
const CAST_IRON: Shade = { dark: '#101114', mid: '#2b2d32', light: '#565a61' };
const MOULDED_PLASTIC: Shade = { dark: '#25292e', mid: '#5a626b', light: '#9aa3ad' };
const RED_VINYL: Shade = { dark: '#3a090e', mid: '#8d1621', light: '#cf3f49' };
const TREAD_RUBBER: Shade = { dark: '#0b0c0e', mid: '#171a1d', light: '#33383e' };
const GRIP_RUBBER: Shade = { dark: '#131519', mid: '#2c3138', light: '#565e68' };

const CYLINDER_LIGHT_STOP = 0.28;
const CYLINDER_MID_STOP = 0.62;

const PANEL_EDGE_STOP = 0.12;
const PANEL_LIGHT_STOP = 0.34;
const PANEL_MID_STOP = 0.72;

type Point = readonly [number, number];

/**
 * Shading ramp for a round surface lit from the upper left: dark at the far
 * edge, a specular band a third of the way across, then a slow fall-off.
 */
function cylinderGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  shade: Shade,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, shade.dark);
  gradient.addColorStop(CYLINDER_LIGHT_STOP, shade.light);
  gradient.addColorStop(CYLINDER_MID_STOP, shade.mid);
  gradient.addColorStop(1, shade.dark);
  return gradient;
}

/**
 * Shading for a broadly flat panel with rolled edges — an upholstered pad. The
 * cylinder ramp would be wrong here: it makes the pad bulge into a sausage
 * instead of sitting flat with darkened edges.
 */
function panelGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  shade: Shade,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
  gradient.addColorStop(0, shade.dark);
  gradient.addColorStop(PANEL_EDGE_STOP, shade.mid);
  gradient.addColorStop(PANEL_LIGHT_STOP, shade.light);
  gradient.addColorStop(PANEL_MID_STOP, shade.mid);
  gradient.addColorStop(1, shade.dark);
  return gradient;
}

/**
 * A capsule of round stock between two points. `shadeAcrossX` picks which axis
 * the cylinder ramp runs along: true for an upright post (shading varies left to
 * right), false for a bar lying across the view (shading varies top to bottom).
 */
function strokeTube(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  thickness: number,
  shade: Shade,
  shadeAcrossX: boolean,
): void {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const halfThickness = thickness / 2;
  ctx.strokeStyle = shadeAcrossX
    ? cylinderGradient(
        ctx,
        Math.min(x0, x1) - halfThickness,
        0,
        Math.max(x0, x1) + halfThickness,
        0,
        shade,
      )
    : cylinderGradient(
        ctx,
        0,
        Math.min(y0, y1) - halfThickness,
        0,
        Math.max(y0, y1) + halfThickness,
        shade,
      );
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function polygonPath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [pointX, pointY] = points[i];
    if (i === 0) ctx.moveTo(pointX, pointY);
    else ctx.lineTo(pointX, pointY);
  }
  ctx.closePath();
}

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  fill: string | CanvasGradient,
): void {
  polygonPath(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
}

const CONTACT_SHADOW_INNER = 'rgba(0,0,0,0.42)';
const CONTACT_SHADOW_OUTER = 'rgba(0,0,0,0)';
const CONTACT_SHADOW_CORE_STOP = 0.55;

/** Soft grounding blob: without a falloff the equipment reads as floating. */
function drawContactShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  gradient.addColorStop(0, CONTACT_SHADOW_INNER);
  gradient.addColorStop(CONTACT_SHADOW_CORE_STOP, CONTACT_SHADOW_INNER);
  gradient.addColorStop(1, CONTACT_SHADOW_OUTER);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

const PLATE_RIM_COLOR = 'rgba(0,0,0,0.65)';
const PLATE_RIM_WIDTH_FRAC = 0.5;
const PLATE_HUB_RX_FRAC = 0.55;
const PLATE_HUB_RY_FRAC = 0.28;
const PLATE_BORE_RY_FRAC = 0.12;
const PLATE_SPECULAR_COLOR = 'rgba(255,255,255,0.2)';
const PLATE_SPECULAR_RY_FRAC = 0.3;
const PLATE_SPECULAR_Y_FRAC = -0.5;

/** One iron plate seen edge-on: a tall thin disc with a raised hub and bore. */
function drawWeightPlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.fillStyle = cylinderGradient(ctx, 0, cy - ry, 0, cy + ry, CAST_IRON);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = PLATE_RIM_COLOR;
  ctx.lineWidth = rx * PLATE_RIM_WIDTH_FRAC;
  ctx.stroke();

  ctx.fillStyle = CAST_IRON.mid;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * PLATE_HUB_RX_FRAC, ry * PLATE_HUB_RY_FRAC, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = CAST_IRON.dark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * PLATE_HUB_RX_FRAC, ry * PLATE_BORE_RY_FRAC, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = PLATE_SPECULAR_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + ry * PLATE_SPECULAR_Y_FRAC,
    rx * PLATE_HUB_RX_FRAC,
    ry * PLATE_SPECULAR_RY_FRAC,
    0,
    0,
    TAU,
  );
  ctx.fill();
}

const DUMBBELL_FLOOR_CX_OFFSET = 0.5;
const DUMBBELL_FLOOR_CY_OFFSET = 0.62;
const DUMBBELL_SHADOW_ELLIPSE_Y_OFFSET = 0.18;
const DUMBBELL_SHADOW_RX = 0.32;
const DUMBBELL_SHADOW_RY = 0.07;
const DUMBBELL_BAR_HALF_WIDTH = 0.3;
const DUMBBELL_BAR_HALF_HEIGHT = 0.045;
const DUMBBELL_BAR_HEIGHT = 0.09;
const DUMBBELL_PLATE_OUTER_RY = 0.17;
const DUMBBELL_PLATE_INNER_RY = 0.115;
const DUMBBELL_PLATE_INNER_RX = 0.055;
const DUMBBELL_PLATE_OUTER_RX = 0.09;
const DUMBBELL_PLATE_HOLE_R = 0.02;
const DUMBBELL_BAR_SHINE_HALF_W = 0.22;
const DUMBBELL_BAR_SHINE_OFFSET_Y = 0.04;
const DUMBBELL_BAR_SHINE_WIDTH = 0.44;
const DUMBBELL_BAR_SHINE_HEIGHT = 0.03;

const DUMBBELL_ICON_CX_OFFSET = 0.5;
const DUMBBELL_ICON_CY_OFFSET = 0.5;
const DUMBBELL_ICON_SHADOW_Y_OFFSET = 0.28;
const DUMBBELL_ICON_SHADOW_RX = 0.3;
const DUMBBELL_ICON_SHADOW_RY = 0.06;
const DUMBBELL_ICON_BAR_HALF = 0.3;
const DUMBBELL_ICON_BAR_HALF_H = 0.04;
const DUMBBELL_ICON_BAR_HEIGHT = 0.08;
const DUMBBELL_ICON_WEIGHT_X = 0.28;
const DUMBBELL_ICON_WEIGHT_OUTER_RX = 0.08;
const DUMBBELL_ICON_WEIGHT_OUTER_RY = 0.16;
const DUMBBELL_ICON_WEIGHT_INNER_RX = 0.05;
const DUMBBELL_ICON_WEIGHT_INNER_RY = 0.1;

const DUMBBELL_HELD_SWING_MIN = -0.8;
const DUMBBELL_HELD_SWING_RANGE = 1.6;
const DUMBBELL_HELD_BAR_HALF = 0.55;
const DUMBBELL_HELD_BAR_HALF_OFFSET = 0.5;
const DUMBBELL_HELD_BAR_H_HALF = 0.04;
const DUMBBELL_HELD_BAR_HEIGHT = 0.08;
const DUMBBELL_HELD_PLATE_X_FRAC = 0.47;
const DUMBBELL_HELD_PLATE_OUTER_RX = 0.07;
const DUMBBELL_HELD_PLATE_OUTER_RY = 0.14;
const DUMBBELL_HELD_PLATE_INNER_RX = 0.04;
const DUMBBELL_HELD_PLATE_INNER_RY = 0.09;

/**
 * Bench geometry as fractions of the tile, measured from the ground contact
 * point. The bench lies along the view axis with the head end (and therefore the
 * rack) furthest away, which is the only orientation where a barbell reads as a
 * barbell at 32px — across the view it is just a horizontal line.
 */
const BENCH = {
  centreXFrac: 0.5,
  groundYFrac: 0.55,

  shadowRx: 0.66,
  shadowRy: 0.3,
  shadowY: 0.12,

  rackFootY: -0.3,
  rackFootHalfWidth: 0.32,
  seatFootY: 0.56,
  seatFootHalfWidth: 0.27,
  footBarThickness: 0.085,

  spineThickness: 0.1,

  padNearY: 0.46,
  padShoulderY: -0.2,
  padFarY: -0.46,
  padNearHalfWidth: 0.14,
  padShoulderHalfWidth: 0.125,
  headHalfWidth: 0.21,
  headFarHalfWidth: 0.19,
  padEndRadius: 0.05,
  padThickness: 0.09,
  padSeamInsetFrac: 0.62,
  stitchCount: 6,
  stitchLength: 0.035,

  postX: 0.26,
  postThickness: 0.08,
  postTopY: -0.66,
  postHoleCount: 4,
  postHoleTopY: -0.58,
  postHoleStep: 0.09,
  postHoleRadius: 0.017,

  hookRadius: 0.055,
  hookThickness: 0.045,

  barY: -0.7,
  barHalfLength: 0.8,
  barThickness: 0.06,
  sleeveStartX: 0.42,
  sleeveThickness: 0.085,
  knurlHalfSpan: 0.18,
  knurlCount: 5,
  knurlThickness: 0.014,

  innerPlateX: 0.52,
  innerPlateRy: 0.18,
  outerPlateX: 0.63,
  outerPlateRy: 0.145,
  plateRx: 0.042,
  collarX: 0.73,
  collarRx: 0.026,
  collarRy: 0.07,
} as const;

/**
 * Icon build: the same machine, bolder and squarer so it survives a 32px slot.
 * Every extent stays inside [0, size] on both axes — a slot clips, so a plate
 * that overhangs by a pixel loses its top rather than spilling.
 */
const BENCH_ICON = {
  centreXFrac: 0.5,
  groundYFrac: 0.64,

  padNearY: 0.26,
  padShoulderY: -0.14,
  padFarY: -0.3,
  padNearHalfWidth: 0.145,
  padShoulderHalfWidth: 0.13,
  headHalfWidth: 0.21,
  padEndRadius: 0.045,
  padThickness: 0.08,

  postX: 0.22,
  postThickness: 0.075,
  postTopY: -0.42,

  barY: -0.44,
  barHalfLength: 0.44,
  barThickness: 0.065,

  plateX: 0.34,
  plateRx: 0.05,
  plateRy: 0.17,

  shadowRx: 0.38,
  shadowRy: 0.13,
  shadowY: 0.06,
} as const;

const BENCH_STITCH_COLOR = 'rgba(255,190,190,0.3)';
const BENCH_STITCH_THICKNESS = 0.012;
const BENCH_PAD_SPECULAR = 'rgba(255,255,255,0.07)';
const BENCH_PAD_SPECULAR_INSET = 0.45;
const BENCH_POST_HOLE_COLOR = 'rgba(0,0,0,0.7)';

/**
 * Treadmill geometry as fractions of the tile, measured from the ground contact
 * point. Like the bench it runs away from the camera — belt nearest, motor cowl
 * and console at the far end — so the deck is a trapezoid narrowing with depth.
 */
const TREADMILL = {
  centreXFrac: 0.5,
  groundYFrac: 0.56,

  shadowRx: 0.64,
  shadowRy: 0.28,
  shadowY: 0.14,

  deckNearY: 0.44,
  deckFarY: -0.26,
  deckNearHalfWidth: 0.46,
  deckFarHalfWidth: 0.36,
  deckSkirtHeight: 0.1,
  railWidthNear: 0.085,
  railWidthFar: 0.07,

  treadLineCount: 7,
  treadPerspectiveExponent: 1.5,
  treadInsetFrac: 0.08,
  wearStripeHalfWidthFrac: 0.42,

  rollerRy: 0.045,

  cowlNearY: -0.22,
  cowlFarY: -0.46,
  cowlNearHalfWidth: 0.38,
  cowlFarHalfWidth: 0.28,
  cowlCrownInset: 0.06,

  postBaseX: 0.34,
  postTopX: 0.3,
  postBaseY: -0.4,
  postTopY: -0.72,
  postThickness: 0.075,

  handrailGripNearY: -0.06,
  handrailGripX: 0.4,
  handrailBendY: -0.5,
  handrailThickness: 0.065,
  gripLength: 0.22,

  crossbarY: -0.68,
  crossbarHalfWidth: 0.34,
  crossbarThickness: 0.055,

  consoleBottomY: -0.7,
  consoleTopY: -0.94,
  consoleBottomHalfWidth: 0.34,
  consoleTopHalfWidth: 0.29,
  screenInsetX: 0.09,
  screenBottomY: -0.78,
  screenTopY: -0.91,

  readoutCount: 3,
  readoutHalfWidth: 0.045,
  readoutHeight: 0.035,
  readoutY: -0.845,
  readoutGap: 0.055,
  buttonCount: 4,
  buttonRadius: 0.016,
  buttonY: -0.74,
  buttonGap: 0.055,
} as const;

/** Icon build: fewer parts, thicker strokes, so the console still reads at 32px. */
const TREADMILL_ICON = {
  centreXFrac: 0.5,
  groundYFrac: 0.68,

  deckNearY: 0.22,
  deckFarY: -0.14,
  deckNearHalfWidth: 0.42,
  deckFarHalfWidth: 0.32,
  deckSkirtHeight: 0.07,
  railWidth: 0.08,
  treadLineCount: 4,

  postX: 0.26,
  postBaseY: -0.16,
  postTopY: -0.46,
  postThickness: 0.075,

  consoleBottomY: -0.44,
  consoleTopY: -0.64,
  consoleHalfWidth: 0.28,
  screenInset: 0.07,
  readoutCount: 2,
  readoutHalfWidth: 0.06,
  readoutHeight: 0.05,
  readoutGap: 0.08,

  shadowRx: 0.44,
  shadowRy: 0.14,
  shadowY: 0.04,
} as const;

const TREADMILL_TREAD_LINE_COLOR = 'rgba(255,255,255,0.07)';
const TREADMILL_TREAD_LINE_THICKNESS = 0.012;
const TREADMILL_WEAR_STRIPE_COLOR = 'rgba(255,255,255,0.05)';
const TREADMILL_RAIL_EDGE_HIGHLIGHT = 'rgba(255,255,255,0.22)';
const TREADMILL_RAIL_EDGE_THICKNESS = 0.014;
const TREADMILL_SCREEN_BACKING = '#08141a';
const TREADMILL_SCREEN_GLASS_TOP = 'rgba(120,200,220,0.18)';
const TREADMILL_SCREEN_GLASS_BOTTOM = 'rgba(120,200,220,0)';
const TREADMILL_READOUT_COLOR = '#2bf0a6';
const TREADMILL_READOUT_GLOW = 'rgba(43,240,166,0.35)';
const TREADMILL_READOUT_GLOW_BLUR_FRAC = 0.06;
const TREADMILL_BUTTON_COLOR = '#8f98a2';
const TREADMILL_COWL_VENT_COLOR = 'rgba(0,0,0,0.35)';
const TREADMILL_COWL_VENT_COUNT = 3;
const TREADMILL_COWL_VENT_HALF_WIDTH = 0.11;
const TREADMILL_COWL_VENT_THICKNESS = 0.016;
const TREADMILL_COWL_VENT_STEP = 0.045;
const TREADMILL_COWL_VENT_TOP_Y = -0.42;

export function drawDumbbellFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * DUMBBELL_FLOOR_CX_OFFSET;
  const cy = sy + s * DUMBBELL_FLOOR_CY_OFFSET;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + s * DUMBBELL_SHADOW_ELLIPSE_Y_OFFSET,
    s * DUMBBELL_SHADOW_RX,
    s * DUMBBELL_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Bar (horizontal rod)
  ctx.fillStyle = '#888';
  ctx.fillRect(
    cx - s * DUMBBELL_BAR_HALF_WIDTH,
    cy - s * DUMBBELL_BAR_HALF_HEIGHT,
    s * DUMBBELL_BAR_HALF_WIDTH * 2,
    s * DUMBBELL_BAR_HEIGHT,
  );

  // Left weight plate (outer)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.ellipse(
    cx - s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_OUTER_RX,
    s * DUMBBELL_PLATE_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Left weight plate (inner rim highlight)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.ellipse(
    cx - s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_INNER_RX,
    s * DUMBBELL_PLATE_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Left weight plate hole
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx - s * DUMBBELL_BAR_HALF_WIDTH, cy, s * DUMBBELL_PLATE_HOLE_R, 0, Math.PI * 2);
  ctx.fill();

  // Right weight plate (outer)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.ellipse(
    cx + s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_OUTER_RX,
    s * DUMBBELL_PLATE_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right weight plate (inner rim highlight)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.ellipse(
    cx + s * DUMBBELL_BAR_HALF_WIDTH,
    cy,
    s * DUMBBELL_PLATE_INNER_RX,
    s * DUMBBELL_PLATE_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right weight plate hole
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx + s * DUMBBELL_BAR_HALF_WIDTH, cy, s * DUMBBELL_PLATE_HOLE_R, 0, Math.PI * 2);
  ctx.fill();

  // Bar shine
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(
    cx - s * DUMBBELL_BAR_SHINE_HALF_W,
    cy - s * DUMBBELL_BAR_SHINE_OFFSET_Y,
    s * DUMBBELL_BAR_SHINE_WIDTH,
    s * DUMBBELL_BAR_SHINE_HEIGHT,
  );
}

export function drawDumbbellInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * DUMBBELL_ICON_CX_OFFSET;
  const cy = y + size * DUMBBELL_ICON_CY_OFFSET;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + size * DUMBBELL_ICON_SHADOW_Y_OFFSET,
    size * DUMBBELL_ICON_SHADOW_RX,
    size * DUMBBELL_ICON_SHADOW_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Bar
  ctx.fillStyle = '#999';
  ctx.fillRect(
    cx - size * DUMBBELL_ICON_BAR_HALF,
    cy - size * DUMBBELL_ICON_BAR_HALF_H,
    size * DUMBBELL_ICON_BAR_HALF * 2,
    size * DUMBBELL_ICON_BAR_HEIGHT,
  );

  // Left weight
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(
    cx - size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RX,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.ellipse(
    cx - size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_INNER_RX,
    size * DUMBBELL_ICON_WEIGHT_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Right weight
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(
    cx + size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RX,
    size * DUMBBELL_ICON_WEIGHT_OUTER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.ellipse(
    cx + size * DUMBBELL_ICON_WEIGHT_X,
    cy,
    size * DUMBBELL_ICON_WEIGHT_INNER_RX,
    size * DUMBBELL_ICON_WEIGHT_INNER_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/**
 * Dumbbell held by Juicer — rendered at hand position with throw-anim rotation.
 * `cx, cy` = world position of the hand. `throwAnim` 0→1 swings the arm forward.
 */
export function drawDumbbellHeld(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  throwAnim: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  // Rotate: pull back at 0, swing forward at 1
  const angle = DUMBBELL_HELD_SWING_MIN + throwAnim * DUMBBELL_HELD_SWING_RANGE;
  ctx.rotate(angle);

  const barLen = s * DUMBBELL_HELD_BAR_HALF;
  ctx.fillStyle = '#999';
  ctx.fillRect(
    -barLen * DUMBBELL_HELD_BAR_HALF_OFFSET,
    -s * DUMBBELL_HELD_BAR_H_HALF,
    barLen,
    s * DUMBBELL_HELD_BAR_HEIGHT,
  );

  // Plates
  for (const sign of [-1, 1]) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.ellipse(
      sign * barLen * DUMBBELL_HELD_PLATE_X_FRAC,
      0,
      s * DUMBBELL_HELD_PLATE_OUTER_RX,
      s * DUMBBELL_HELD_PLATE_OUTER_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.ellipse(
      sign * barLen * DUMBBELL_HELD_PLATE_X_FRAC,
      0,
      s * DUMBBELL_HELD_PLATE_INNER_RX,
      s * DUMBBELL_HELD_PLATE_INNER_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
}

// Bench Press

function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Path a polygon with filleted corners. Starting on an edge midpoint and using
 * `arcTo` per corner keeps the fillet correct for the tapered slabs here, where
 * a `roundRect` would need the shape to be an axis-aligned rectangle.
 */
function roundedPolygonPath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  radius: number,
): void {
  const count = points.length;
  const [startX, startY] = midpoint(points[count - 1], points[0]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  for (let i = 0; i < count; i++) {
    const [cornerX, cornerY] = points[i];
    const [nextX, nextY] = midpoint(points[i], points[(i + 1) % count]);
    ctx.arcTo(cornerX, cornerY, nextX, nextY, radius);
  }
  ctx.closePath();
}

/**
 * A slab seen from above and slightly in front: the same outline filled twice,
 * the lower copy in shadow, so the near edge shows a thickness rather than
 * ending at a hairline.
 */
function fillExtrudedSlab(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  radius: number,
  thickness: number,
  topFill: string | CanvasGradient,
  sideFill: string | CanvasGradient,
): void {
  const dropped = points.map(([px, py]): Point => [px, py + thickness]);
  roundedPolygonPath(ctx, dropped, radius);
  ctx.fillStyle = sideFill;
  ctx.fill();
  roundedPolygonPath(ctx, points, radius);
  ctx.fillStyle = topFill;
  ctx.fill();
}

export function drawBenchPressFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * BENCH.centreXFrac;
  const cy = sy + s * BENCH.groundYFrac;
  const px = (frac: number): number => cx + frac * s;
  const py = (frac: number): number => cy + frac * s;

  drawContactShadow(ctx, cx, py(BENCH.shadowY), s * BENCH.shadowRx, s * BENCH.shadowRy);

  const footThickness = s * BENCH.footBarThickness;
  strokeTube(
    ctx,
    [px(-BENCH.rackFootHalfWidth), py(BENCH.rackFootY)],
    [px(BENCH.rackFootHalfWidth), py(BENCH.rackFootY)],
    footThickness,
    POWDER_COAT,
    false,
  );
  strokeTube(
    ctx,
    [px(-BENCH.seatFootHalfWidth), py(BENCH.seatFootY)],
    [px(BENCH.seatFootHalfWidth), py(BENCH.seatFootY)],
    footThickness,
    POWDER_COAT,
    false,
  );
  strokeTube(
    ctx,
    [cx, py(BENCH.rackFootY)],
    [cx, py(BENCH.seatFootY)],
    s * BENCH.spineThickness,
    POWDER_COAT,
    true,
  );

  const padNearHalf = s * BENCH.padNearHalfWidth;
  const padShoulderHalf = s * BENCH.padShoulderHalfWidth;
  const headHalf = s * BENCH.headHalfWidth;
  const headFarHalf = s * BENCH.headFarHalfWidth;
  // The flare at the head end is what separates a bench from a plain slab at
  // this size — a straight rectangle reads as a mat.
  const padOutline: readonly Point[] = [
    [cx - padNearHalf, py(BENCH.padNearY)],
    [cx + padNearHalf, py(BENCH.padNearY)],
    [cx + padShoulderHalf, py(BENCH.padShoulderY)],
    [cx + headHalf, py(BENCH.padShoulderY)],
    [cx + headFarHalf, py(BENCH.padFarY)],
    [cx - headFarHalf, py(BENCH.padFarY)],
    [cx - headHalf, py(BENCH.padShoulderY)],
    [cx - padShoulderHalf, py(BENCH.padShoulderY)],
  ];
  fillExtrudedSlab(
    ctx,
    padOutline,
    s * BENCH.padEndRadius,
    s * BENCH.padThickness,
    panelGradient(ctx, cx - headHalf, cx + headHalf, RED_VINYL),
    RED_VINYL.dark,
  );

  ctx.save();
  roundedPolygonPath(ctx, padOutline, s * BENCH.padEndRadius);
  ctx.clip();

  ctx.strokeStyle = BENCH_STITCH_COLOR;
  ctx.lineWidth = s * BENCH_STITCH_THICKNESS;
  const stitchHalf = (s * BENCH.stitchLength) / 2;
  for (let i = 0; i < BENCH.stitchCount; i++) {
    const alongPad = (i + 1) / (BENCH.stitchCount + 1);
    const stitchY = py(BENCH.padNearY + (BENCH.padShoulderY - BENCH.padNearY) * alongPad);
    const halfWidthHere = padNearHalf + (padShoulderHalf - padNearHalf) * alongPad;
    const stitchX = halfWidthHere * BENCH.padSeamInsetFrac;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * stitchX - stitchHalf, stitchY);
      ctx.lineTo(cx + side * stitchX + stitchHalf, stitchY);
      ctx.stroke();
    }
  }

  ctx.fillStyle = BENCH_PAD_SPECULAR;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    py((BENCH.padNearY + BENCH.padShoulderY) / 2),
    padShoulderHalf * BENCH_PAD_SPECULAR_INSET,
    s * Math.abs(BENCH.padNearY - BENCH.padShoulderY) * BENCH_PAD_SPECULAR_INSET,
    0,
    0,
    TAU,
  );
  ctx.fill();
  ctx.restore();

  for (const side of [-1, 1]) {
    const postX = px(side * BENCH.postX);
    strokeTube(
      ctx,
      [postX, py(BENCH.rackFootY)],
      [postX, py(BENCH.postTopY)],
      s * BENCH.postThickness,
      BRUSHED_STEEL,
      true,
    );
    ctx.fillStyle = BENCH_POST_HOLE_COLOR;
    for (let hole = 0; hole < BENCH.postHoleCount; hole++) {
      ctx.beginPath();
      ctx.arc(
        postX,
        py(BENCH.postHoleTopY + hole * BENCH.postHoleStep),
        s * BENCH.postHoleRadius,
        0,
        TAU,
      );
      ctx.fill();
    }

    ctx.strokeStyle = BRUSHED_STEEL.mid;
    ctx.lineWidth = s * BENCH.hookThickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(postX, py(BENCH.barY), s * BENCH.hookRadius, 0, Math.PI);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  const barY = py(BENCH.barY);
  for (const side of [-1, 1]) {
    strokeTube(
      ctx,
      [px(side * BENCH.sleeveStartX), barY],
      [px(side * BENCH.barHalfLength), barY],
      s * BENCH.sleeveThickness,
      BRUSHED_STEEL,
      false,
    );
  }
  strokeTube(
    ctx,
    [px(-BENCH.sleeveStartX), barY],
    [px(BENCH.sleeveStartX), barY],
    s * BENCH.barThickness,
    BRUSHED_STEEL,
    false,
  );

  ctx.strokeStyle = PLATE_RIM_COLOR;
  ctx.lineWidth = s * BENCH.knurlThickness;
  const barHalfThickness = (s * BENCH.barThickness) / 2;
  for (let mark = 0; mark < BENCH.knurlCount; mark++) {
    const alongGrip = mark / (BENCH.knurlCount - 1);
    const knurlX = px(-BENCH.knurlHalfSpan + alongGrip * BENCH.knurlHalfSpan * 2);
    ctx.beginPath();
    ctx.moveTo(knurlX, barY - barHalfThickness);
    ctx.lineTo(knurlX, barY + barHalfThickness);
    ctx.stroke();
  }

  for (const side of [-1, 1]) {
    drawWeightPlate(
      ctx,
      px(side * BENCH.innerPlateX),
      barY,
      s * BENCH.plateRx,
      s * BENCH.innerPlateRy,
    );
    drawWeightPlate(
      ctx,
      px(side * BENCH.outerPlateX),
      barY,
      s * BENCH.plateRx,
      s * BENCH.outerPlateRy,
    );
    ctx.fillStyle = BRUSHED_STEEL.mid;
    ctx.beginPath();
    ctx.ellipse(px(side * BENCH.collarX), barY, s * BENCH.collarRx, s * BENCH.collarRy, 0, 0, TAU);
    ctx.fill();
  }
}

export function drawBenchPressInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * BENCH_ICON.centreXFrac;
  const cy = y + size * BENCH_ICON.groundYFrac;
  const px = (frac: number): number => cx + frac * size;
  const py = (frac: number): number => cy + frac * size;

  drawContactShadow(
    ctx,
    cx,
    py(BENCH_ICON.shadowY),
    size * BENCH_ICON.shadowRx,
    size * BENCH_ICON.shadowRy,
  );

  const padNearHalf = size * BENCH_ICON.padNearHalfWidth;
  const padShoulderHalf = size * BENCH_ICON.padShoulderHalfWidth;
  const headHalf = size * BENCH_ICON.headHalfWidth;
  fillExtrudedSlab(
    ctx,
    [
      [cx - padNearHalf, py(BENCH_ICON.padNearY)],
      [cx + padNearHalf, py(BENCH_ICON.padNearY)],
      [cx + padShoulderHalf, py(BENCH_ICON.padShoulderY)],
      [cx + headHalf, py(BENCH_ICON.padShoulderY)],
      [cx + headHalf, py(BENCH_ICON.padFarY)],
      [cx - headHalf, py(BENCH_ICON.padFarY)],
      [cx - headHalf, py(BENCH_ICON.padShoulderY)],
      [cx - padShoulderHalf, py(BENCH_ICON.padShoulderY)],
    ],
    size * BENCH_ICON.padEndRadius,
    size * BENCH_ICON.padThickness,
    panelGradient(ctx, cx - headHalf, cx + headHalf, RED_VINYL),
    RED_VINYL.dark,
  );

  for (const side of [-1, 1]) {
    strokeTube(
      ctx,
      [px(side * BENCH_ICON.postX), py(BENCH_ICON.padFarY)],
      [px(side * BENCH_ICON.postX), py(BENCH_ICON.postTopY)],
      size * BENCH_ICON.postThickness,
      BRUSHED_STEEL,
      true,
    );
  }

  const barY = py(BENCH_ICON.barY);
  strokeTube(
    ctx,
    [px(-BENCH_ICON.barHalfLength), barY],
    [px(BENCH_ICON.barHalfLength), barY],
    size * BENCH_ICON.barThickness,
    BRUSHED_STEEL,
    false,
  );
  for (const side of [-1, 1]) {
    drawWeightPlate(
      ctx,
      px(side * BENCH_ICON.plateX),
      barY,
      size * BENCH_ICON.plateRx,
      size * BENCH_ICON.plateRy,
    );
  }
}

// Treadmill

export function drawTreadmillFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * TREADMILL.centreXFrac;
  const cy = sy + s * TREADMILL.groundYFrac;
  const px = (frac: number): number => cx + frac * s;
  const py = (frac: number): number => cy + frac * s;

  drawContactShadow(ctx, cx, py(TREADMILL.shadowY), s * TREADMILL.shadowRx, s * TREADMILL.shadowRy);

  const deckNearHalf = s * TREADMILL.deckNearHalfWidth;
  const deckFarHalf = s * TREADMILL.deckFarHalfWidth;
  const deckNearY = py(TREADMILL.deckNearY);
  const deckFarY = py(TREADMILL.deckFarY);
  const deckOutline: readonly Point[] = [
    [cx - deckNearHalf, deckNearY],
    [cx + deckNearHalf, deckNearY],
    [cx + deckFarHalf, deckFarY],
    [cx - deckFarHalf, deckFarY],
  ];
  const skirtOutline = deckOutline.map(([qx, qy]): Point => [
    qx,
    qy + s * TREADMILL.deckSkirtHeight,
  ]);
  fillPolygon(ctx, skirtOutline, MOULDED_PLASTIC.dark);
  fillPolygon(
    ctx,
    deckOutline,
    cylinderGradient(ctx, cx - deckNearHalf, 0, cx + deckNearHalf, 0, MOULDED_PLASTIC),
  );

  const beltNearHalf = deckNearHalf - s * TREADMILL.railWidthNear;
  const beltFarHalf = deckFarHalf - s * TREADMILL.railWidthFar;
  const beltOutline: readonly Point[] = [
    [cx - beltNearHalf, deckNearY],
    [cx + beltNearHalf, deckNearY],
    [cx + beltFarHalf, deckFarY],
    [cx - beltFarHalf, deckFarY],
  ];
  fillPolygon(
    ctx,
    beltOutline,
    cylinderGradient(ctx, cx - beltNearHalf, 0, cx + beltNearHalf, 0, TREAD_RUBBER),
  );

  ctx.save();
  polygonPath(ctx, beltOutline);
  ctx.clip();

  fillPolygon(
    ctx,
    [
      [cx - beltNearHalf * TREADMILL.wearStripeHalfWidthFrac, deckNearY],
      [cx + beltNearHalf * TREADMILL.wearStripeHalfWidthFrac, deckNearY],
      [cx + beltFarHalf * TREADMILL.wearStripeHalfWidthFrac, deckFarY],
      [cx - beltFarHalf * TREADMILL.wearStripeHalfWidthFrac, deckFarY],
    ],
    TREADMILL_WEAR_STRIPE_COLOR,
  );

  ctx.strokeStyle = TREADMILL_TREAD_LINE_COLOR;
  ctx.lineWidth = s * TREADMILL_TREAD_LINE_THICKNESS;
  for (let line = 0; line < TREADMILL.treadLineCount; line++) {
    const evenSpacing = (line + 1) / (TREADMILL.treadLineCount + 1);
    const towardCamera = Math.pow(evenSpacing, TREADMILL.treadPerspectiveExponent);
    const lineY = deckFarY + (deckNearY - deckFarY) * towardCamera;
    const halfWidthHere =
      (beltFarHalf + (beltNearHalf - beltFarHalf) * towardCamera) * (1 - TREADMILL.treadInsetFrac);
    ctx.beginPath();
    ctx.moveTo(cx - halfWidthHere, lineY);
    ctx.lineTo(cx + halfWidthHere, lineY);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = cylinderGradient(
    ctx,
    0,
    deckNearY - s * TREADMILL.rollerRy,
    0,
    deckNearY + s * TREADMILL.rollerRy,
    BRUSHED_STEEL,
  );
  ctx.beginPath();
  ctx.ellipse(cx, deckNearY, beltNearHalf, s * TREADMILL.rollerRy, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = TREADMILL_RAIL_EDGE_HIGHLIGHT;
  ctx.lineWidth = s * TREADMILL_RAIL_EDGE_THICKNESS;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * deckNearHalf, deckNearY);
    ctx.lineTo(cx + side * deckFarHalf, deckFarY);
    ctx.stroke();
  }

  const cowlNearHalf = s * TREADMILL.cowlNearHalfWidth;
  const cowlFarHalf = s * TREADMILL.cowlFarHalfWidth;
  const cowlNearY = py(TREADMILL.cowlNearY);
  const cowlFarY = py(TREADMILL.cowlFarY);
  fillExtrudedSlab(
    ctx,
    [
      [cx - cowlNearHalf, cowlNearY],
      [cx + cowlNearHalf, cowlNearY],
      [cx + cowlFarHalf, cowlFarY],
      [cx - cowlFarHalf, cowlFarY],
    ],
    s * TREADMILL.cowlCrownInset,
    s * TREADMILL.deckSkirtHeight,
    cylinderGradient(ctx, cx - cowlNearHalf, 0, cx + cowlNearHalf, 0, MOULDED_PLASTIC),
    MOULDED_PLASTIC.dark,
  );

  ctx.strokeStyle = TREADMILL_COWL_VENT_COLOR;
  ctx.lineWidth = s * TREADMILL_COWL_VENT_THICKNESS;
  for (let vent = 0; vent < TREADMILL_COWL_VENT_COUNT; vent++) {
    const ventY = py(TREADMILL_COWL_VENT_TOP_Y + vent * TREADMILL_COWL_VENT_STEP);
    ctx.beginPath();
    ctx.moveTo(cx - s * TREADMILL_COWL_VENT_HALF_WIDTH, ventY);
    ctx.lineTo(cx + s * TREADMILL_COWL_VENT_HALF_WIDTH, ventY);
    ctx.stroke();
  }

  for (const side of [-1, 1]) {
    const handrailNear: Point = [
      px(side * TREADMILL.handrailGripX),
      py(TREADMILL.handrailGripNearY),
    ];
    const handrailFar: Point = [px(side * TREADMILL.postBaseX), py(TREADMILL.handrailBendY)];
    strokeTube(
      ctx,
      handrailNear,
      handrailFar,
      s * TREADMILL.handrailThickness,
      BRUSHED_STEEL,
      true,
    );

    const gripSpan =
      (s * TREADMILL.gripLength) /
      Math.hypot(handrailFar[0] - handrailNear[0], handrailFar[1] - handrailNear[1]);
    const gripEnd: Point = [
      handrailNear[0] + (handrailFar[0] - handrailNear[0]) * gripSpan,
      handrailNear[1] + (handrailFar[1] - handrailNear[1]) * gripSpan,
    ];
    strokeTube(ctx, handrailNear, gripEnd, s * TREADMILL.handrailThickness, GRIP_RUBBER, true);

    strokeTube(
      ctx,
      [px(side * TREADMILL.postBaseX), py(TREADMILL.postBaseY)],
      [px(side * TREADMILL.postTopX), py(TREADMILL.postTopY)],
      s * TREADMILL.postThickness,
      BRUSHED_STEEL,
      true,
    );
  }

  strokeTube(
    ctx,
    [px(-TREADMILL.crossbarHalfWidth), py(TREADMILL.crossbarY)],
    [px(TREADMILL.crossbarHalfWidth), py(TREADMILL.crossbarY)],
    s * TREADMILL.crossbarThickness,
    BRUSHED_STEEL,
    false,
  );

  const consoleBottomHalf = s * TREADMILL.consoleBottomHalfWidth;
  const consoleTopHalf = s * TREADMILL.consoleTopHalfWidth;
  fillPolygon(
    ctx,
    [
      [cx - consoleBottomHalf, py(TREADMILL.consoleBottomY)],
      [cx + consoleBottomHalf, py(TREADMILL.consoleBottomY)],
      [cx + consoleTopHalf, py(TREADMILL.consoleTopY)],
      [cx - consoleTopHalf, py(TREADMILL.consoleTopY)],
    ],
    cylinderGradient(ctx, cx - consoleBottomHalf, 0, cx + consoleBottomHalf, 0, MOULDED_PLASTIC),
  );

  const screenBottomHalf = consoleBottomHalf - s * TREADMILL.screenInsetX;
  const screenTopHalf = consoleTopHalf - s * TREADMILL.screenInsetX;
  const screenOutline: readonly Point[] = [
    [cx - screenBottomHalf, py(TREADMILL.screenBottomY)],
    [cx + screenBottomHalf, py(TREADMILL.screenBottomY)],
    [cx + screenTopHalf, py(TREADMILL.screenTopY)],
    [cx - screenTopHalf, py(TREADMILL.screenTopY)],
  ];
  fillPolygon(ctx, screenOutline, TREADMILL_SCREEN_BACKING);

  ctx.save();
  ctx.shadowColor = TREADMILL_READOUT_GLOW;
  ctx.shadowBlur = s * TREADMILL_READOUT_GLOW_BLUR_FRAC;
  ctx.fillStyle = TREADMILL_READOUT_COLOR;
  const readoutSpan = (TREADMILL.readoutCount - 1) * TREADMILL.readoutGap;
  for (let readout = 0; readout < TREADMILL.readoutCount; readout++) {
    const readoutX = px(-readoutSpan / 2 + readout * TREADMILL.readoutGap);
    ctx.fillRect(
      readoutX - s * TREADMILL.readoutHalfWidth,
      py(TREADMILL.readoutY) - (s * TREADMILL.readoutHeight) / 2,
      s * TREADMILL.readoutHalfWidth * 2,
      s * TREADMILL.readoutHeight,
    );
  }
  ctx.restore();

  const glass = ctx.createLinearGradient(
    0,
    py(TREADMILL.screenTopY),
    0,
    py(TREADMILL.screenBottomY),
  );
  glass.addColorStop(0, TREADMILL_SCREEN_GLASS_TOP);
  glass.addColorStop(1, TREADMILL_SCREEN_GLASS_BOTTOM);
  fillPolygon(ctx, screenOutline, glass);

  ctx.fillStyle = TREADMILL_BUTTON_COLOR;
  const buttonSpan = (TREADMILL.buttonCount - 1) * TREADMILL.buttonGap;
  for (let button = 0; button < TREADMILL.buttonCount; button++) {
    ctx.beginPath();
    ctx.arc(
      px(-buttonSpan / 2 + button * TREADMILL.buttonGap),
      py(TREADMILL.buttonY),
      s * TREADMILL.buttonRadius,
      0,
      TAU,
    );
    ctx.fill();
  }
}

export function drawTreadmillInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * TREADMILL_ICON.centreXFrac;
  const cy = y + size * TREADMILL_ICON.groundYFrac;
  const px = (frac: number): number => cx + frac * size;
  const py = (frac: number): number => cy + frac * size;

  drawContactShadow(
    ctx,
    cx,
    py(TREADMILL_ICON.shadowY),
    size * TREADMILL_ICON.shadowRx,
    size * TREADMILL_ICON.shadowRy,
  );

  const deckNearHalf = size * TREADMILL_ICON.deckNearHalfWidth;
  const deckFarHalf = size * TREADMILL_ICON.deckFarHalfWidth;
  const deckNearY = py(TREADMILL_ICON.deckNearY);
  const deckFarY = py(TREADMILL_ICON.deckFarY);
  const deckOutline: readonly Point[] = [
    [cx - deckNearHalf, deckNearY],
    [cx + deckNearHalf, deckNearY],
    [cx + deckFarHalf, deckFarY],
    [cx - deckFarHalf, deckFarY],
  ];
  fillPolygon(
    ctx,
    deckOutline.map(([qx, qy]): Point => [qx, qy + size * TREADMILL_ICON.deckSkirtHeight]),
    MOULDED_PLASTIC.dark,
  );
  fillPolygon(
    ctx,
    deckOutline,
    cylinderGradient(ctx, cx - deckNearHalf, 0, cx + deckNearHalf, 0, MOULDED_PLASTIC),
  );

  const beltNearHalf = deckNearHalf - size * TREADMILL_ICON.railWidth;
  const beltFarHalf = deckFarHalf - size * TREADMILL_ICON.railWidth;
  const beltOutline: readonly Point[] = [
    [cx - beltNearHalf, deckNearY],
    [cx + beltNearHalf, deckNearY],
    [cx + beltFarHalf, deckFarY],
    [cx - beltFarHalf, deckFarY],
  ];
  fillPolygon(
    ctx,
    beltOutline,
    cylinderGradient(ctx, cx - beltNearHalf, 0, cx + beltNearHalf, 0, TREAD_RUBBER),
  );

  ctx.save();
  polygonPath(ctx, beltOutline);
  ctx.clip();
  ctx.strokeStyle = TREADMILL_TREAD_LINE_COLOR;
  ctx.lineWidth = size * TREADMILL_TREAD_LINE_THICKNESS;
  for (let line = 0; line < TREADMILL_ICON.treadLineCount; line++) {
    const towardCamera = (line + 1) / (TREADMILL_ICON.treadLineCount + 1);
    const lineY = deckFarY + (deckNearY - deckFarY) * towardCamera;
    const halfWidthHere = beltFarHalf + (beltNearHalf - beltFarHalf) * towardCamera;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidthHere, lineY);
    ctx.lineTo(cx + halfWidthHere, lineY);
    ctx.stroke();
  }
  ctx.restore();

  for (const side of [-1, 1]) {
    strokeTube(
      ctx,
      [px(side * TREADMILL_ICON.postX), py(TREADMILL_ICON.postBaseY)],
      [px(side * TREADMILL_ICON.postX), py(TREADMILL_ICON.postTopY)],
      size * TREADMILL_ICON.postThickness,
      BRUSHED_STEEL,
      true,
    );
  }

  const consoleHalf = size * TREADMILL_ICON.consoleHalfWidth;
  fillPolygon(
    ctx,
    [
      [cx - consoleHalf, py(TREADMILL_ICON.consoleBottomY)],
      [cx + consoleHalf, py(TREADMILL_ICON.consoleBottomY)],
      [cx + consoleHalf, py(TREADMILL_ICON.consoleTopY)],
      [cx - consoleHalf, py(TREADMILL_ICON.consoleTopY)],
    ],
    cylinderGradient(ctx, cx - consoleHalf, 0, cx + consoleHalf, 0, MOULDED_PLASTIC),
  );

  const screenHalf = consoleHalf - size * TREADMILL_ICON.screenInset;
  const screenBottomY = py(TREADMILL_ICON.consoleBottomY) - size * TREADMILL_ICON.screenInset;
  const screenTopY = py(TREADMILL_ICON.consoleTopY) + size * TREADMILL_ICON.screenInset;
  fillPolygon(
    ctx,
    [
      [cx - screenHalf, screenBottomY],
      [cx + screenHalf, screenBottomY],
      [cx + screenHalf, screenTopY],
      [cx - screenHalf, screenTopY],
    ],
    TREADMILL_SCREEN_BACKING,
  );

  ctx.fillStyle = TREADMILL_READOUT_COLOR;
  const readoutSpan = (TREADMILL_ICON.readoutCount - 1) * TREADMILL_ICON.readoutGap;
  const readoutY = (screenBottomY + screenTopY) / 2;
  for (let readout = 0; readout < TREADMILL_ICON.readoutCount; readout++) {
    ctx.fillRect(
      px(-readoutSpan / 2 + readout * TREADMILL_ICON.readoutGap) -
        size * TREADMILL_ICON.readoutHalfWidth,
      readoutY - (size * TREADMILL_ICON.readoutHeight) / 2,
      size * TREADMILL_ICON.readoutHalfWidth * 2,
      size * TREADMILL_ICON.readoutHeight,
    );
  }
}
