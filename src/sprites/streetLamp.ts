/**
 * A street lamp: an iron post with a glazed lantern head, burning.
 *
 * The town has no day/night cycle and no lighting pass, so "lit" here means the
 * lamp carries its own light rather than that it lights anything. That is the
 * same bargain the fortune teller's orb and the torches already make. The light
 * is baked into the prop's frame, so every part of it — the halo and the bloom
 * over the glazing — has to fit inside that frame and be painted by the prop
 * itself. There is deliberately no pool of light on the paving: a glow at the
 * foot of the post reads as a second light source down there.
 *
 * Every glow is a radial gradient whose alpha follows an inverse-square curve
 * (see `addFalloffStops`). A flat disc or a linear ramp both leave a visible
 * edge where the light stops; real light has no edge, only a bright centre that
 * drops away fast and a long faint tail.
 */

import { rgb, rgba } from './art/town/townArt';
import { getTownRamp, type RGB } from './art/town/townPalette';

const TWO_PI = Math.PI * 2;

/** Geometry as fractions of a tile, from the anchor tile's top-left. */
const BASE_Y = 0.9;
const BASE_HALF_WIDTH = 0.2;
const BASE_HEIGHT = 0.12;
const POST_TOP = -1.5;
const POST_WIDTH_PX = 3;
const COLLAR_Y = -1.06;
const COLLAR_HALF_WIDTH = 0.11;
const COLLAR_HEIGHT_PX = 3;

const HEAD_TOP = -2.1;
const HEAD_BOTTOM = -1.5;
const HEAD_HALF_WIDTH = 0.21;
/** The lantern's roof: a little pyramid, wider than the glass it caps. */
const CAP_OVERHANG = 0.07;
const CAP_HEIGHT = 0.2;
const FINIAL_RADIUS_PX = 2;

const FLAME_CY = -1.8;
const FLAME_RX = 0.08;
const FLAME_RY = 0.13;
const FLAME_CORE_SHARE = 0.5;

/**
 * The wide halo in the air around the head. Its radius is bounded by the sheet
 * frame (`street_lamp` in `townscapeSheets.ts`), which leaves two tiles either
 * side of the post and four above the anchor tile.
 */
const HALO_RADIUS = 1.4;
const HALO_PEAK_ALPHA = 0.5;
/** How steeply the halo falls off; higher keeps more of it near the flame. */
const HALO_SHARPNESS = 3.2;

/**
 * The tight bloom over the lantern, drawn after the iron frame so the glare
 * eats into the glazing bars the way a bright source does in a camera or an eye.
 */
const BLOOM_RADIUS = 0.42;
const BLOOM_PEAK_ALPHA = 0.55;
const BLOOM_SHARPNESS = 5;

/**
 * The glass is lit from inside: brightest beside the flame and amber toward
 * the panes' edges, rather than one flat tint.
 */
const GLASS_GLOW_REACH = 0.36;

/** A warm catch-light down the post's flank, fading as it leaves the head. */
const POST_RIM_WIDTH_PX = 1;
const POST_RIM_LENGTH = 0.6;
const POST_RIM_ALPHA = 0.55;

/** Stops per falloff gradient; enough that the curve shows no banding. */
const FALLOFF_STOPS = 8;

/**
 * The flame's breathing, in frames and in fractions of its own size. Kept small:
 * a lamp that pulses visibly reads as a signal rather than as a light.
 */
const FLICKER_PERIOD_FRAMES = 47;
const FLICKER_AMPLITUDE = 0.14;

// The town's `iron_black` ramp (`src/sprites/art/town/townPalette.ts`) — cool
// and always darkened, so the lamp's ironwork matches every other hinge and
// bracket in town rather than a warm blacksmith's iron of its own.
const OC_IRON = getTownRamp('iron_black');
const IRON = rgb(OC_IRON.mid);
const IRON_LIGHT = rgb(OC_IRON.light);
const FLAME_CORE = '#fff0c0';
const FLAME_EDGE = '#f0a63c';

/**
 * Light shifts from near-white at the source to deep amber at its fringe: the
 * hot centre saturates, and what survives the falloff is the warm end of the
 * candle's spectrum.
 */
const LIGHT_HOT: RGB = [255, 240, 196];
const LIGHT_WARM: RGB = [255, 190, 92];
const LIGHT_FRINGE: RGB = [232, 128, 44];
const GLASS_HOT: RGB = [255, 238, 186];
const GLASS_EDGE: RGB = [214, 150, 70];
const GLASS_EDGE_ALPHA = 0.75;
/** Where on the hot-to-fringe ramp the warm midtone sits. */
const LIGHT_WARM_AT = 0.35;

const GROUND_SHADOW = 'rgba(0,0,0,0.26)';
const GROUND_SHADOW_HALF_WIDTH = 0.26;
const GROUND_SHADOW_HEIGHT = 0.07;

/**
 * How many distinct flicker levels a lamp is drawn at. The whole flicker is a
 * 14% breath, so the steps are far below what the eye resolves — and quantizing
 * lets every lamp in town share one baked picture per level.
 */
export const LAMP_FLICKER_STEPS = 8;

/**
 * Which of the `LAMP_FLICKER_STEPS` levels the flame is at on `frame`.
 *
 * Split from the multiplier for the reason `shopSignSwayStep` gives: the game
 * picks a baked frame and only the offline generator still draws a flame, so the
 * two must agree on what a step means.
 */
export function streetLampFlickerStep(frame: number, flickerPhase: number): number {
  const wave = Math.sin((frame / FLICKER_PERIOD_FRAMES) * TWO_PI + flickerPhase);
  const normalized = (wave + 1) / 2;
  return Math.min(LAMP_FLICKER_STEPS - 1, Math.floor(normalized * LAMP_FLICKER_STEPS));
}

/** The flame's size multiplier at one of the `LAMP_FLICKER_STEPS` levels. */
export function streetLampFlickerForStep(step: number): number {
  const steppedWave = (step / (LAMP_FLICKER_STEPS - 1)) * 2 - 1;
  return 1 + steppedWave * FLICKER_AMPLITUDE;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function lightColourAt(t: number): RGB {
  if (t < LIGHT_WARM_AT) return mixRgb(LIGHT_HOT, LIGHT_WARM, t / LIGHT_WARM_AT);
  return mixRgb(LIGHT_WARM, LIGHT_FRINGE, (t - LIGHT_WARM_AT) / (1 - LIGHT_WARM_AT));
}

/**
 * Fills `gradient` with an inverse-square falloff, `1 / (1 + (k·t)²)`, shifted
 * and rescaled so it starts at `peakAlpha` and reaches exactly zero at the rim
 * — the raw curve never reaches zero, and cutting it off leaves a ring.
 */
function addFalloffStops(gradient: CanvasGradient, peakAlpha: number, sharpness: number): void {
  const curveAt = (t: number) => 1 / (1 + (sharpness * t) ** 2);
  const rimValue = curveAt(1);
  for (let i = 0; i <= FALLOFF_STOPS; i++) {
    const t = i / FALLOFF_STOPS;
    const normalized = (curveAt(t) - rimValue) / (1 - rimValue);
    gradient.addColorStop(t, rgba(lightColourAt(t), peakAlpha * normalized));
  }
}

function fillFalloff(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  peakAlpha: number,
  sharpness: number,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  addFalloffStops(gradient, peakAlpha, sharpness);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
}

/** Draws one lit street lamp standing on the tile whose top-left is (sx, sy). */
export function drawStreetLamp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  flicker: number,
): void {
  ctx.save();
  const cx = sx + ts / 2;
  const baseY = sy + ts * BASE_Y;
  const flameY = sy + ts * FLAME_CY;

  ctx.fillStyle = GROUND_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    baseY + ts * BASE_HEIGHT,
    ts * GROUND_SHADOW_HALF_WIDTH,
    ts * GROUND_SHADOW_HEIGHT,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = IRON;
  ctx.fillRect(cx - ts * BASE_HALF_WIDTH, baseY, ts * BASE_HALF_WIDTH * 2, ts * BASE_HEIGHT);
  ctx.fillRect(
    cx - POST_WIDTH_PX / 2,
    sy + ts * POST_TOP,
    POST_WIDTH_PX,
    baseY - sy - ts * POST_TOP,
  );
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(
    cx - ts * COLLAR_HALF_WIDTH,
    sy + ts * COLLAR_Y,
    ts * COLLAR_HALF_WIDTH * 2,
    COLLAR_HEIGHT_PX,
  );

  const headTop = sy + ts * HEAD_TOP;
  const headBottom = sy + ts * HEAD_BOTTOM;
  const headHalf = ts * HEAD_HALF_WIDTH;

  const rimTop = headBottom;
  const rimBottom = headBottom + ts * POST_RIM_LENGTH;
  const rim = ctx.createLinearGradient(0, rimTop, 0, rimBottom);
  rim.addColorStop(0, rgba(LIGHT_WARM, POST_RIM_ALPHA * flicker));
  rim.addColorStop(1, rgba(LIGHT_WARM, 0));
  ctx.fillStyle = rim;
  ctx.fillRect(
    cx + POST_WIDTH_PX / 2 - POST_RIM_WIDTH_PX,
    rimTop,
    POST_RIM_WIDTH_PX,
    rimBottom - rimTop,
  );

  // Under the lantern body, so the halo spills out around the glazing rather
  // than washing over the iron in front of it.
  fillFalloff(
    ctx,
    cx,
    flameY,
    ts * HALO_RADIUS * flicker,
    HALO_PEAK_ALPHA * flicker,
    HALO_SHARPNESS,
  );

  const glass = ctx.createRadialGradient(cx, flameY, 0, cx, flameY, ts * GLASS_GLOW_REACH);
  glass.addColorStop(0, rgb(GLASS_HOT));
  glass.addColorStop(1, rgba(GLASS_EDGE, GLASS_EDGE_ALPHA));
  ctx.fillStyle = glass;
  ctx.fillRect(cx - headHalf, headTop, headHalf * 2, headBottom - headTop);

  const flameRx = ts * FLAME_RX * flicker;
  const flameRy = ts * FLAME_RY * flicker;
  ctx.fillStyle = FLAME_EDGE;
  ctx.beginPath();
  ctx.ellipse(cx, flameY, flameRx, flameRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = FLAME_CORE;
  ctx.beginPath();
  ctx.ellipse(cx, flameY, flameRx * FLAME_CORE_SHARE, flameRy * FLAME_CORE_SHARE, 0, 0, TWO_PI);
  ctx.fill();

  // The lantern's iron frame, over the glass and the flame so the glazing bars
  // read as being in front of the light rather than beside it.
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - headHalf, headTop, headHalf * 2, headBottom - headTop);

  ctx.fillStyle = IRON;
  ctx.beginPath();
  ctx.moveTo(cx - headHalf - ts * CAP_OVERHANG, headTop);
  ctx.lineTo(cx + headHalf + ts * CAP_OVERHANG, headTop);
  ctx.lineTo(cx, headTop - ts * CAP_HEIGHT);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headTop - ts * CAP_HEIGHT, FINIAL_RADIUS_PX, 0, TWO_PI);
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  fillFalloff(
    ctx,
    cx,
    flameY,
    ts * BLOOM_RADIUS * flicker,
    BLOOM_PEAK_ALPHA * flicker,
    BLOOM_SHARPNESS,
  );
  ctx.restore();
}
