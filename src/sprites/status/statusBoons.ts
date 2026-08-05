/**
 * The statuses that are *good* news: `speed_fizz`, `jugg_juice`,
 * `cooldown_crisp` and `drunk`.
 *
 * These read differently from the ailments on purpose. An ailment sits on the
 * character — tinted skin, things dripping off. A boon radiates *outward*: light
 * leaving the body, motes rising, a shell standing off the figure. That
 * inside-out/outside-in split is what lets a player tell at a glance whether the
 * glow around a crawler is something to panic about.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import {
  bodyTop,
  bodyX,
  bodyY,
  drawEmbermote,
  drawGlow,
  hashRange,
  particlePhase,
  rgba,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

const HALF = 0.5;

/** Rising motes are the shared vocabulary of every boon; only the colour changes. */
const MOTE_COUNT = 7;
const MOTE_RATE_PER_MS = 0.0009;
const MOTE_RISE = 1.25;
const MOTE_SPREAD = 1.1;
const MOTE_RADIUS = 0.14;
const MOTE_ALPHA = 0.85;
/** How far a mote drifts off its column on the way up. */
const MOTE_SWAY = 0.25;
/** The additive spark inside every mote, whatever hue the boon paints it. */
const MOTE_HEAT: Rgb = [255, 255, 246];

function drawRisingMotes(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  color: Rgb,
  indexOffset: number,
): void {
  const heat = MOTE_HEAT;
  for (let i = 0; i < MOTE_COUNT; i++) {
    const key = f.seed + (i + indexOffset) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + indexOffset, MOTE_RATE_PER_MS);
    const alpha = Math.sin(phase * Math.PI) * MOTE_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const x = bodyX(f, hashRange(key, HALF - MOTE_SPREAD, HALF + MOTE_SPREAD));
    const sway = Math.sin(phase * Math.PI * 2 + key) * f.width * MOTE_SWAY;
    drawEmbermote(
      ctx,
      color,
      heat,
      x + sway,
      bodyY(f, MOTE_RISE * phase),
      f.width * MOTE_RADIUS,
      alpha,
    );
  }
}

// -- speed_fizz: everything happening faster --------------------------------

const FIZZ_CYAN: Rgb = [86, 216, 255];
const FIZZ_WHITE: Rgb = [226, 250, 255];

const TRAIL_COUNT = 4;
/** Chevrons stack up behind the runner, the nearest one tightest to the body. */
const TRAIL_SPACING = 0.42;
const TRAIL_HALF_WIDTH = 0.55;
const TRAIL_DEPTH = 0.35;
const TRAIL_LINE_WIDTH = 2;
const TRAIL_ALPHA = 0.6;
/** Chevrons slide backward and recycle, so the trail streams rather than sits. */
const TRAIL_SCROLL_RATE_PER_MS = 0.0022;
const TRAIL_ORIGIN_UP = 0.55;
const FIZZ_RIM_ALPHA = 0.45;

export function speedFizzBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    rimColor: rgba(FIZZ_CYAN, 1),
    rimAlpha: FIZZ_RIM_ALPHA * f.fade,
  };
}

export function drawSpeedFizz(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  ctx.globalCompositeOperation = 'lighter';
  drawRisingMotes(ctx, f, FIZZ_CYAN, 0);

  if (f.moving) {
    const originY = bodyY(f, TRAIL_ORIGIN_UP);
    const behindX = -f.facingX;
    const behindY = -f.facingY;
    const scroll = (f.timeMs * TRAIL_SCROLL_RATE_PER_MS) % 1;

    ctx.lineWidth = TRAIL_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(FIZZ_WHITE, 1);
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const distance = (i + scroll) * TRAIL_SPACING;
      const alpha = (1 - distance / (TRAIL_COUNT * TRAIL_SPACING)) * TRAIL_ALPHA * f.fade;
      if (alpha <= 0) continue;

      const baseX = f.centerX + behindX * f.width * distance;
      const baseY = originY + behindY * f.height * distance;
      // The chevron opens across the direction of travel, so its arms are the
      // facing vector turned ninety degrees.
      const armX = -behindY * f.width * TRAIL_HALF_WIDTH;
      const armY = behindX * f.height * TRAIL_HALF_WIDTH;
      const tipX = baseX + behindX * f.width * TRAIL_DEPTH;
      const tipY = baseY + behindY * f.height * TRAIL_DEPTH;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(baseX + armX, baseY + armY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(baseX - armX, baseY - armY);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// -- jugg_juice: more of you to kill ----------------------------------------

const JUGG_ORANGE: Rgb = [255, 138, 46];
const JUGG_PALE: Rgb = [255, 214, 168];

/** A shell standing off the body, which is what says "extra hit points". */
const SHELL_RADIUS_X = 1.3;
const SHELL_RADIUS_Y = 0.62;
const SHELL_CENTER_UP = 0.5;
/** Two passes: a wide dim one for the glow, a thin bright one for the surface. */
const SHELL_HALO_WIDTH = 9;
const SHELL_SURFACE_WIDTH = 1.6;
const SHELL_HALO_ALPHA = 0.3;
const SHELL_SURFACE_ALPHA = 0.4;
const SHELL_PULSE_SPEED = 0.0032;
const SHELL_PULSE_DEPTH = 0.08;
const JUGG_GLOW_ALPHA = 0.3;
const JUGG_RIM_ALPHA = 0.55;

export function juggJuiceBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(JUGG_ORANGE, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    blend: 'lighter',
    alpha: JUGG_GLOW_ALPHA * f.fade,
    rimColor: rgba(JUGG_ORANGE, 1),
    rimAlpha: JUGG_RIM_ALPHA * f.fade,
  };
}

export function drawJuggJuice(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  const pulse = 1 + SHELL_PULSE_DEPTH * Math.sin(f.timeMs * SHELL_PULSE_SPEED);

  ctx.globalCompositeOperation = 'lighter';
  drawRisingMotes(ctx, f, JUGG_ORANGE, 0);

  // A single hard outline reads as a hoop hung around him. The wide dim pass
  // underneath is what turns it into a surface with thickness.
  const traceShell = () => {
    ctx.beginPath();
    ctx.ellipse(
      f.centerX,
      bodyY(f, SHELL_CENTER_UP),
      f.width * SHELL_RADIUS_X * pulse,
      f.height * SHELL_RADIUS_Y * pulse,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  };

  ctx.globalAlpha = SHELL_HALO_ALPHA * f.fade;
  ctx.lineWidth = SHELL_HALO_WIDTH;
  ctx.strokeStyle = rgba(JUGG_PALE, 1);
  traceShell();

  // Opaque, so the shell is still orange over sand or snow where the additive
  // halo above it has nothing left to add.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = SHELL_SURFACE_ALPHA * f.fade;
  ctx.lineWidth = SHELL_SURFACE_WIDTH;
  ctx.strokeStyle = rgba(JUGG_ORANGE, 1);
  traceShell();
}

// -- cooldown_crisp: abilities coming back twice as fast --------------------

const CRISP_GREEN: Rgb = [52, 226, 150];
const CRISP_PALE: Rgb = [198, 255, 232];

/** A ring of ticks circling the feet, read as a dial running fast. */
const DIAL_TICK_COUNT = 16;
const DIAL_RADIUS_X = 0.95;
const DIAL_RADIUS_Y = 0.13;
const DIAL_TICK_LENGTH_X = 0.2;
const DIAL_TICK_LENGTH_Y = 0.02;
const DIAL_LINE_WIDTH = 1.6;
/** The rim the ticks sit on. Without it they scatter and read as floor litter. */
const DIAL_RIM_WIDTH = 1.4;
const DIAL_RIM_ALPHA = 0.55;
const DIAL_SPIN_RATE_PER_MS = 0.0011;
const DIAL_ALPHA = 0.65;
/** Every third tick is drawn pale, so the dial's rotation is countable. */
const DIAL_MAJOR_TICK_EVERY = 3;
const CRISP_RIM_ALPHA = 0.4;

export function cooldownCrispBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    rimColor: rgba(CRISP_GREEN, 1),
    rimAlpha: CRISP_RIM_ALPHA * f.fade,
  };
}

export function drawCooldownCrisp(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  const spin = f.timeMs * DIAL_SPIN_RATE_PER_MS;

  ctx.globalCompositeOperation = 'lighter';
  drawRisingMotes(ctx, f, CRISP_GREEN, 0);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = DIAL_RIM_ALPHA * f.fade;
  ctx.lineWidth = DIAL_RIM_WIDTH;
  ctx.strokeStyle = rgba(CRISP_GREEN, 1);
  ctx.beginPath();
  ctx.ellipse(
    f.centerX,
    f.footY,
    f.width * DIAL_RADIUS_X,
    f.height * DIAL_RADIUS_Y,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  ctx.lineWidth = DIAL_LINE_WIDTH;
  ctx.lineCap = 'butt';
  for (let tick = 0; tick < DIAL_TICK_COUNT; tick++) {
    const angle = spin + (tick / DIAL_TICK_COUNT) * Math.PI * 2;
    const nearness = HALF + HALF * Math.sin(angle);
    const innerX = f.centerX + Math.cos(angle) * f.width * DIAL_RADIUS_X;
    const innerY = f.footY + Math.sin(angle) * f.height * DIAL_RADIUS_Y;
    const outerX = f.centerX + Math.cos(angle) * f.width * (DIAL_RADIUS_X + DIAL_TICK_LENGTH_X);
    const outerY = f.footY + Math.sin(angle) * f.height * (DIAL_RADIUS_Y + DIAL_TICK_LENGTH_Y);

    ctx.globalAlpha = DIAL_ALPHA * nearness * f.fade;
    ctx.strokeStyle = rgba(tick % DIAL_MAJOR_TICK_EVERY === 0 ? CRISP_PALE : CRISP_GREEN, 1);
    ctx.beginPath();
    ctx.moveTo(innerX, innerY);
    ctx.lineTo(outerX, outerY);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// -- drunk: the room will not hold still ------------------------------------

const DRUNK_AMBER: Rgb = [252, 196, 84];
const DRUNK_FOAM: Rgb = [255, 244, 206];

const DRUNK_HAZE_RADIUS = 1.1;
const DRUNK_HAZE_ALPHA = 0.24;
const DRUNK_WOBBLE_SPEED = 0.0016;
const DRUNK_WOBBLE_REACH = 0.22;
/** Bubbles bob at twice the sway's rate, so the ring lurches instead of gliding. */
const DRUNK_BOB_RATE = 2;

const DRUNK_BUBBLE_COUNT = 5;
const DRUNK_BUBBLE_RATE_PER_MS = 0.00034;
const DRUNK_BUBBLE_ORBIT_X = 1.05;
const DRUNK_BUBBLE_ORBIT_Y = 0.08;
/** The ring floats just above the head, where a cartoon puts it. */
const DRUNK_RING_ABOVE = 0.04;
const DRUNK_BUBBLE_RADIUS = 0.18;
const DRUNK_TINT_ALPHA = 0.22;

export function drunkBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(DRUNK_AMBER, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    blend: 'lighter',
    alpha: DRUNK_TINT_ALPHA * f.fade,
  };
}

export function drawDrunk(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  const headY = bodyTop(f) - f.height * DRUNK_RING_ABOVE;
  const wobble = Math.sin(f.timeMs * DRUNK_WOBBLE_SPEED) * f.width * DRUNK_WOBBLE_REACH;

  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    DRUNK_AMBER,
    f.centerX + wobble,
    headY,
    f.width * DRUNK_HAZE_RADIUS,
    DRUNK_HAZE_ALPHA * f.fade,
  );

  for (let i = 0; i < DRUNK_BUBBLE_COUNT; i++) {
    const phase = particlePhase(f, i, DRUNK_BUBBLE_RATE_PER_MS);
    const angle = phase * Math.PI * 2;
    const nearness = HALF + HALF * Math.sin(angle);
    const bob =
      Math.sin(f.timeMs * DRUNK_WOBBLE_SPEED * DRUNK_BOB_RATE + i) * f.height * DRUNK_WOBBLE_REACH;
    const x = f.centerX + Math.cos(angle) * f.width * DRUNK_BUBBLE_ORBIT_X + wobble;
    const y = headY + Math.sin(angle) * f.height * DRUNK_BUBBLE_ORBIT_Y + bob;

    drawEmbermote(
      ctx,
      DRUNK_AMBER,
      DRUNK_FOAM,
      x,
      y,
      f.width * DRUNK_BUBBLE_RADIUS * (HALF + nearness * HALF),
      f.fade * nearness,
    );
  }
  ctx.globalCompositeOperation = 'source-over';
}

// -- whetstone: the smith put an edge on it ---------------------------------

const EDGE_STEEL: Rgb = [206, 226, 244];
const EDGE_SPARK: Rgb = [255, 236, 190];

const EDGE_RIM_ALPHA = 0.5;
/** A cold ring at the feet, so the boon is visible on a crawler standing still. */
const EDGE_GLINT_COUNT = 3;
const EDGE_GLINT_RATE_PER_MS = 0.00055;
const EDGE_GLINT_RADIUS = 0.11;
const EDGE_GLINT_ALPHA = 0.9;
/** Glints travel up the leading edge of the figure rather than rising off it. */
const EDGE_GLINT_RISE = 1.15;
const EDGE_GLINT_LEAD = 0.42;
const EDGE_SHEEN_ALPHA = 0.18;
const EDGE_SHEEN_RADIUS = 0.75;
const EDGE_SHEEN_UP = 0.55;

export function whetstoneBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    rimColor: rgba(EDGE_STEEL, 1),
    rimAlpha: EDGE_RIM_ALPHA * f.fade,
  };
}

export function drawWhetstone(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    EDGE_STEEL,
    f.centerX + f.facingX * f.width * EDGE_GLINT_LEAD,
    bodyY(f, EDGE_SHEEN_UP),
    f.width * EDGE_SHEEN_RADIUS,
    EDGE_SHEEN_ALPHA * f.fade,
  );

  // Sparks run along the side the swing comes from, which is what says "edge"
  // rather than the generic upward drift every other boon uses.
  for (let i = 0; i < EDGE_GLINT_COUNT; i++) {
    const phase = particlePhase(f, i, EDGE_GLINT_RATE_PER_MS);
    const alpha = Math.sin(phase * Math.PI) * EDGE_GLINT_ALPHA * f.fade;
    if (alpha <= 0) continue;
    const x = f.centerX + f.facingX * f.width * EDGE_GLINT_LEAD;
    drawEmbermote(
      ctx,
      EDGE_STEEL,
      EDGE_SPARK,
      x,
      bodyY(f, EDGE_GLINT_RISE * phase),
      f.width * EDGE_GLINT_RADIUS,
      alpha,
    );
  }
  ctx.globalCompositeOperation = 'source-over';
}
