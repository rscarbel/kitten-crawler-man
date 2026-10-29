/**
 * Painters for the kit Big Rooster turns on the party in his fury: the
 * kettlebell rack he heaves from, a single falling kettlebell, and the
 * exercise balls he kicks loose.
 *
 * Same three-quarter view and materials as `gymRoomArt.ts`, lit from the upper
 * left. Painted once into sheets (`gymRoomSheets.ts`) and blitted.
 */

import { CAST_IRON, POWDER_COAT, cylinderGradient, drawContactShadow } from '../gymEquipmentSprite';
import type { Shade } from '../gymEquipmentSprite';

const TAU = Math.PI * 2;
const HALF = 0.5;

/** The coloured weight bands competition kettlebells wear, so a rack reads as gym kit at a glance. */
const BELL_BANDS: readonly Shade[] = [
  { dark: '#4a0a0e', mid: '#a3161f', light: '#ef4b4b' },
  { dark: '#5a4308', mid: '#c99a14', light: '#ffe05a' },
  { dark: '#0b1c3d', mid: '#1f4fa3', light: '#5c97f0' },
  { dark: '#0d3a1a', mid: '#1f8a3e', light: '#6fe08c' },
];
const RIM_LIGHT = 'rgba(220,240,255,0.55)';
const HAIRLINE = 'rgba(0,0,0,0.75)';
const SPECULAR = 'rgba(255,255,255,0.65)';

/** One kettlebell, as shares of its body's diameter. */
const BELL = {
  handleRadius: 0.36,
  handleThickness: 0.13,
  handleRise: 0.42,
  bandHeight: 0.16,
  bandY: 0.08,
  glintX: -0.22,
  glintY: -0.2,
  glintRadius: 0.1,
  hairline: 0.035,
} as const;

/**
 * A kettlebell whose round body is centred at (cx, cy), `diameter` across,
 * its handle loop rising above it. `band` picks its weight colour.
 */
function drawKettlebell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  diameter: number,
  band: number,
): void {
  const radius = diameter * HALF;
  const handleCy = cy - diameter * BELL.handleRise;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = CAST_IRON.dark;
  ctx.lineWidth = diameter * BELL.handleThickness * (1 + BELL.hairline * 2);
  ctx.beginPath();
  ctx.arc(cx, handleCy, diameter * BELL.handleRadius, Math.PI, TAU);
  ctx.stroke();
  ctx.strokeStyle = cylinderGradient(
    ctx,
    cx - diameter * BELL.handleRadius,
    0,
    cx + diameter * BELL.handleRadius,
    0,
    CAST_IRON,
  );
  ctx.lineWidth = diameter * BELL.handleThickness;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  const body = ctx.createRadialGradient(
    cx + diameter * BELL.glintX,
    cy + diameter * BELL.glintY,
    diameter * BELL.glintRadius,
    cx,
    cy,
    radius,
  );
  body.addColorStop(0, CAST_IRON.light);
  body.addColorStop(HALF, CAST_IRON.mid);
  body.addColorStop(1, CAST_IRON.dark);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = Math.max(1, diameter * BELL.hairline);
  ctx.stroke();

  const shade = BELL_BANDS[band % BELL_BANDS.length];
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.clip();
  const bandTop = cy + diameter * BELL.bandY - diameter * BELL.bandHeight * HALF;
  ctx.fillStyle = cylinderGradient(ctx, cx - radius, 0, cx + radius, 0, shade);
  ctx.fillRect(cx - radius, bandTop, diameter, diameter * BELL.bandHeight);
  ctx.restore();

  ctx.fillStyle = SPECULAR;
  ctx.beginPath();
  ctx.arc(
    cx + diameter * BELL.glintX,
    cy + diameter * BELL.glintY,
    diameter * BELL.glintRadius,
    0,
    TAU,
  );
  ctx.fill();
  ctx.restore();
}

/**
 * A low two-shelf rack: three bells on the bottom shelf, two on the top, so a
 * stocked rack and a heaved-empty one differ by five big dark shapes.
 */
const KB_RACK = {
  shelfYs: [0.78, 0.3],
  shelfInsetX: [0.04, 0.12],
  shelfHeight: 0.08,
  legWidth: 0.07,
  legLeftX: 0.04,
  legRightX: 0.89,
  legTopY: 0.18,
  footY: 0.92,
  bellDiameters: [0.27, 0.24],
  bellsPerShelf: [3, 2],
  bellLift: 0.13,
  shadowRx: 0.52,
  shadowRy: 0.08,
  rimShare: 0.22,
} as const;

/** A kettlebell rack, `stocked` or stripped bare by a heave. */
export function drawGymKettlebellRack(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  stocked: boolean,
): void {
  drawContactShadow(
    ctx,
    ox + s * HALF,
    oy + s * KB_RACK.footY,
    s * KB_RACK.shadowRx,
    s * KB_RACK.shadowRy,
  );
  const legW = s * KB_RACK.legWidth;
  const post = (x: number): void => {
    const top = oy + s * KB_RACK.legTopY;
    const bottom = oy + s * KB_RACK.footY;
    ctx.fillStyle = cylinderGradient(ctx, x, 0, x + legW, 0, POWDER_COAT);
    ctx.fillRect(x, top, legW, bottom - top);
    ctx.fillStyle = RIM_LIGHT;
    ctx.fillRect(x, top, Math.max(1, legW * KB_RACK.rimShare), bottom - top);
  };
  post(ox + s * KB_RACK.legLeftX);
  post(ox + s * KB_RACK.legRightX);
  let band = 0;
  for (let shelf = KB_RACK.shelfYs.length - 1; shelf >= 0; shelf--) {
    const inset = s * KB_RACK.shelfInsetX[shelf];
    const shelfY = oy + s * KB_RACK.shelfYs[shelf];
    const shelfH = s * KB_RACK.shelfHeight;
    ctx.fillStyle = cylinderGradient(ctx, 0, shelfY, 0, shelfY + shelfH, POWDER_COAT);
    ctx.fillRect(ox + inset, shelfY, s - inset * 2, shelfH);
    ctx.fillStyle = RIM_LIGHT;
    ctx.fillRect(ox + inset, shelfY, s - inset * 2, Math.max(1, shelfH * KB_RACK.rimShare));
    if (!stocked) continue;
    const count = KB_RACK.bellsPerShelf[shelf];
    const diameter = s * KB_RACK.bellDiameters[shelf];
    const span = s - inset * 2;
    for (let index = 0; index < count; index++) {
      const cx = ox + inset + (span * (index + HALF)) / count;
      drawKettlebell(ctx, cx, shelfY - s * KB_RACK.bellLift, diameter, band);
      band++;
    }
  }
}

/** Frames in a falling kettlebell's sheet row: one per weight band, so a rain is not one colour. */
export const GYM_FALLING_KETTLEBELL_FRAMES = 4;

/** A falling kettlebell's sheet frame: one bell, a little over half a tile across. */
const FALLING_BELL_DIAMETER = 0.56;
const FALLING_BELL_CENTRE_Y = 0.62;

/** One kettlebell on its way down, centred in a one-tile frame. */
export function drawFallingKettlebell(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  band: number,
): void {
  drawKettlebell(
    ctx,
    ox + s * HALF,
    oy + s * FALLING_BELL_CENTRE_Y,
    s * FALLING_BELL_DIAMETER,
    band,
  );
}

/** Frames of an exercise ball's roll; its seams turn a full circle across them. */
export const GYM_EXERCISE_BALL_FRAMES = 6;

/** The colours the balls come in, one sheet row each. */
export const GYM_EXERCISE_BALL_COLOURS = ['red', 'blue'] as const;
export type GymExerciseBallColour = (typeof GYM_EXERCISE_BALL_COLOURS)[number];

const BALL_SHADES: Readonly<Record<GymExerciseBallColour, Shade>> = {
  red: { dark: '#4e0b12', mid: '#b3202c', light: '#ff7a7a' },
  blue: { dark: '#0b2148', mid: '#2563c4', light: '#86b6ff' },
};
const BALL_SEAM = 'rgba(0,0,0,0.35)';

/** An exercise ball, as shares of the frame's tile. */
const BALL = {
  /** The ball's radius: wider than a crawler, so a rolling one reads as a threat. */
  radius: 0.5,
  centreY: 0.58,
  shadowY: 1.04,
  shadowRx: 0.46,
  shadowRy: 0.09,
  glintX: -0.18,
  glintY: -0.2,
  glintRadius: 0.12,
  seamWidth: 0.04,
  seams: 3,
  hairline: 0.025,
} as const;

/**
 * An exercise ball standing on the tile whose centre is (cx, cy), its seams
 * turned to `spin` (0 to 1 around). The seams are what show it rolling; the body stays lit from one side.
 */
export function drawExerciseBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  colour: GymExerciseBallColour,
  spin: number,
): void {
  const radius = s * BALL.radius;
  const ballCy = cy + s * BALL.centreY - s * HALF;
  drawContactShadow(
    ctx,
    cx,
    cy + s * BALL.shadowY - s * HALF,
    s * BALL.shadowRx,
    s * BALL.shadowRy,
  );
  const shade = BALL_SHADES[colour];
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, ballCy, radius, 0, TAU);
  const body = ctx.createRadialGradient(
    cx + s * BALL.glintX,
    ballCy + s * BALL.glintY,
    s * BALL.glintRadius,
    cx,
    ballCy,
    radius,
  );
  body.addColorStop(0, shade.light);
  body.addColorStop(HALF, shade.mid);
  body.addColorStop(1, shade.dark);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = BALL_SEAM;
  ctx.lineWidth = s * BALL.seamWidth;
  for (let seam = 0; seam < BALL.seams; seam++) {
    // Each seam is a meridian seen edge-on as the ball turns: an ellipse whose
    // width swings with the cosine of its angle.
    const angle = (spin + seam / BALL.seams) * Math.PI;
    const width = Math.abs(Math.cos(angle)) * radius;
    ctx.beginPath();
    ctx.ellipse(cx, ballCy, Math.max(1, width), radius, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = Math.max(1, s * BALL.hairline);
  ctx.beginPath();
  ctx.arc(cx, ballCy, radius, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = SPECULAR;
  ctx.beginPath();
  ctx.arc(cx + s * BALL.glintX, ballCy + s * BALL.glintY, s * BALL.glintRadius, 0, TAU);
  ctx.fill();
}

/** A falling bell's shadow: dark at its heart, and as wide as its blow by the time it lands. */
const SHADOW_CORE = 'rgba(0,0,0,0.55)';
const SHADOW_EDGE = 'rgba(0,0,0,0)';
/** How wide a shadow starts, as a share of its landing reach. */
const SHADOW_START_SHARE = 0.25;
/** The shadow is squashed to the floor's three-quarter view. */
const SHADOW_SQUASH = 0.6;

/**
 * The shadow under a falling kettlebell at (cx, cy), `progress` from 0 as it
 * appears to 1 as the bell lands, growing to `radiusPx`. Painted live, not
 * from a sheet: a radial gradient at any size is cheaper than a frame per size.
 */
export function drawKettlebellShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  progress: number,
): void {
  const radius = radiusPx * (SHADOW_START_SHARE + (1 - SHADOW_START_SHARE) * progress);
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, SHADOW_CORE);
  gradient.addColorStop(1, SHADOW_EDGE);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, SHADOW_SQUASH);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}
