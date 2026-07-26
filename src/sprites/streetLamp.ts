/**
 * A street lamp: an iron post with a glazed lantern head, burning.
 *
 * The town has no day/night cycle and no lighting pass, so "lit" here means the
 * lamp carries its own halo rather than that it lights anything. That is the
 * same bargain the fortune teller's orb and the torches already make, and it is
 * the reason the halo is drawn with `shadowBlur` on the flame rather than as a
 * radial gradient over the ground: a gradient would need to composite under
 * everything else in the scene, and a prop draws after the ground is baked.
 */

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
const FLAME_GLOW_BLUR = 0.55;
const HALO_RADIUS = 0.5;
const HALO_ALPHA = 0.16;

/**
 * The flame's breathing, in frames and in fractions of its own size. Kept small:
 * a lamp that pulses visibly reads as a signal rather than as a light.
 */
const FLICKER_PERIOD_FRAMES = 47;
const FLICKER_AMPLITUDE = 0.14;

const IRON = '#2f2b26';
const IRON_LIGHT = '#4d4740';
const GLASS = 'rgba(255, 226, 160, 0.35)';
const FLAME_CORE = '#fff0c0';
const FLAME_EDGE = '#f0a63c';
const HALO = 'rgba(255, 196, 96, 1)';
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
 * The lamp's breath at `frame`, snapped to one of `LAMP_FLICKER_STEPS` levels.
 * Returns the step index and the multiplier to draw it with.
 */
export function streetLampFlicker(
  frame: number,
  flickerPhase: number,
): { step: number; flicker: number } {
  const wave = Math.sin((frame / FLICKER_PERIOD_FRAMES) * TWO_PI + flickerPhase);
  const normalized = (wave + 1) / 2;
  const step = Math.min(LAMP_FLICKER_STEPS - 1, Math.floor(normalized * LAMP_FLICKER_STEPS));
  const steppedWave = (step / (LAMP_FLICKER_STEPS - 1)) * 2 - 1;
  return { step, flicker: 1 + steppedWave * FLICKER_AMPLITUDE };
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

  ctx.fillStyle = GLASS;
  ctx.fillRect(cx - headHalf, headTop, headHalf * 2, headBottom - headTop);

  ctx.save();
  ctx.shadowColor = HALO;
  ctx.shadowBlur = ts * FLAME_GLOW_BLUR * flicker;
  ctx.fillStyle = FLAME_EDGE;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    sy + ts * FLAME_CY,
    ts * FLAME_RX * flicker,
    ts * FLAME_RY * flicker,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = FLAME_CORE;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    sy + ts * FLAME_CY,
    ts * FLAME_RX * flicker * 0.5,
    ts * FLAME_RY * flicker * 0.5,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();

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

  // A soft pool on the paving under the lamp. Drawn last and very faint, because
  // it is over the ground rather than under it and anything stronger reads as a
  // painted disc.
  ctx.save();
  ctx.globalAlpha = HALO_ALPHA * flicker;
  ctx.fillStyle = HALO;
  ctx.beginPath();
  ctx.ellipse(cx, baseY, ts * HALO_RADIUS, ts * HALO_RADIUS * 0.45, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}
