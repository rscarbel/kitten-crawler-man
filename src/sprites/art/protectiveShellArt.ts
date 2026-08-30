/**
 * The Protective Shell's painting: the bubble the human raises, the cat's
 * personal mini-shield, and the orange ring a full-power shell throws off when
 * it expires.
 *
 * All three are concentric strokes about a centre point rather than a figure in
 * a pose, so there is no rig here — `drawShellCircle` is the whole vocabulary,
 * and each exported painter is one parameterisation of it. Cell geometry, frame
 * counts and the `FigureDef`s the runtime cache draws through live beside this
 * in `protectiveShellFigure.ts`.
 *
 * Every painter composes with the caller's `globalAlpha` rather than assigning
 * over it: the figure cache's direct-paint fallback sets the draw alpha on the
 * context before calling the painter, so a painter that assigns would paint a
 * fading shell at full strength.
 */

export type ShellVariant = 'standard' | 'full_power';

interface ShellColors {
  readonly outer: string;
  readonly main: string;
  readonly fill: string;
}

const FULL_POWER_COLORS: ShellColors = { outer: '#fbbf24', main: '#ff8c00', fill: '#fd7c0a' };
const STANDARD_COLORS: ShellColors = { outer: '#93c5fd', main: '#3b82f6', fill: '#60a5fa' };

function shellColors(variant: ShellVariant): ShellColors {
  return variant === 'full_power' ? FULL_POWER_COLORS : STANDARD_COLORS;
}

/** The shell's own radius, in tiles — the range the ability shoves mobs out of. */
export const SHELL_RADIUS_TILES = 5;

/** The cat's mini-shield radius, in tiles. */
export const MINI_SHELL_RADIUS_TILES = 2;

/** The shockwave ring's radius at the start and the end of its expansion, in tiles. */
export const SHOCKWAVE_START_RADIUS_TILES = 2.5;
export const SHOCKWAVE_MAX_RADIUS_TILES = 7;

/** How many haloes are stacked outside the shell's border. */
const GLOW_RINGS = 4;
/** Each halo's own alpha contribution; ring `i` carries `i` of them. */
const GLOW_RING_ALPHA = 0.06;

const BORDER_WIDTH_MIN_PX = 2;
const BORDER_WIDTH_PER_TILE = 0.09;
const GLOW_STEP_MIN_PX = 4;
const GLOW_STEP_PER_TILE = 0.15;

/** The border's alpha swings this far either side of `BORDER_PULSE_BASE`. */
const BORDER_PULSE_BASE = 0.7;
const BORDER_PULSE_SWING = 0.3;

/** The interior is a tint, not a fill — the player has to see through it. */
const INTERIOR_FILL_ALPHA = 0.06;

const TAU = Math.PI * 2;

/** A shell drawn at its own full strength; the caller fades it. */
const FULL_STRENGTH = 1;

/** The pulse phase a non-pulsing state is frozen at. */
const UNPULSED = 0;

function borderWidth(tilePx: number): number {
  return Math.max(BORDER_WIDTH_MIN_PX, tilePx * BORDER_WIDTH_PER_TILE);
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radiusPx: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, TAU);
}

function drawShellCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  tilePx: number,
  colors: ShellColors,
  pulse: number,
  alpha: number,
): void {
  const lineW = borderWidth(tilePx);
  const glowStep = Math.max(GLOW_STEP_MIN_PX, tilePx * GLOW_STEP_PER_TILE);

  ctx.save();
  const callerAlpha = ctx.globalAlpha;

  // Outermost halo first, so each inner one lays over the last and the border
  // sits in the brightest part of the stack.
  for (let ring = GLOW_RINGS; ring >= 1; ring--) {
    ctx.globalAlpha = callerAlpha * alpha * GLOW_RING_ALPHA * ring;
    ctx.strokeStyle = colors.outer;
    ctx.lineWidth = ring * lineW;
    circle(ctx, cx, cy, radiusPx + ring * glowStep);
    ctx.stroke();
  }

  const pulseFactor = BORDER_PULSE_BASE + BORDER_PULSE_SWING * Math.sin(pulse * TAU);
  ctx.globalAlpha = callerAlpha * alpha * pulseFactor;
  ctx.strokeStyle = colors.main;
  ctx.lineWidth = lineW;
  circle(ctx, cx, cy, radiusPx);
  ctx.stroke();

  ctx.globalAlpha = callerAlpha * alpha * INTERIOR_FILL_ALPHA;
  ctx.fillStyle = colors.fill;
  circle(ctx, cx, cy, radiusPx);
  ctx.fill();

  ctx.restore();
}

/** The shell holding at full size, pulsing. `phase` 0→1 is one pulse cycle. */
export function drawProtectiveShellActive(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  variant: ShellVariant,
  phase: number,
): void {
  drawShellCircle(
    ctx,
    cx,
    cy,
    tilePx * SHELL_RADIUS_TILES,
    tilePx,
    shellColors(variant),
    phase,
    FULL_STRENGTH,
  );
}

/** The fraction of full radius the shell starts its expansion at. */
const APPEAR_START_RADIUS_SHARE = 0.1;

/**
 * The shell expanding into existence.
 *
 * `expandT` 0→1 drives radius and alpha together, so it reads as a bubble being
 * blown rather than a ring that fades in at full size. The border does not
 * pulse while it is growing.
 */
export function drawProtectiveShellAppear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  variant: ShellVariant,
  expandT: number,
): void {
  const growth = APPEAR_START_RADIUS_SHARE + expandT * (1 - APPEAR_START_RADIUS_SHARE);
  drawShellCircle(
    ctx,
    cx,
    cy,
    tilePx * SHELL_RADIUS_TILES * growth,
    tilePx,
    shellColors(variant),
    UNPULSED,
    expandT,
  );
}

/**
 * The shell fading out. `fadeT` 0→1 runs from fully visible to gone.
 *
 * Always the standard palette: a full-power shell spends its expiry on the
 * shockwave instead, which is orange for both of them.
 */
export function drawProtectiveShellExpire(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  fadeT: number,
): void {
  drawShellCircle(
    ctx,
    cx,
    cy,
    tilePx * SHELL_RADIUS_TILES,
    tilePx,
    shellColors('standard'),
    UNPULSED,
    1 - fadeT,
  );
}

const MINI_BORDER_WIDTH_MIN_PX = 1.5;
const MINI_BORDER_WIDTH_PER_TILE = 0.06;
const MINI_PULSE_BASE = 0.6;
const MINI_PULSE_SWING = 0.4;
/** The mini-shield's single halo, in multiples of its border width. */
const MINI_GLOW_WIDTH_MULT = 3;
const MINI_GLOW_OFFSET_MULT = 2;
const MINI_GLOW_ALPHA = 0.25;
const MINI_BORDER_ALPHA = 0.8;
const MINI_INTERIOR_FILL_ALPHA = 0.05;
const MINI_GLOW_COLOR = '#7c3aed';
const MINI_BORDER_COLOR = '#a78bfa';
const MINI_FILL_COLOR = '#c4b5fd';

/**
 * The cat's personal mini-shield: purple, two tiles across, one pulse cycle per
 * `phase` 0→1.
 *
 * Its own palette rather than a variant of the shell's, because it has to read
 * as the cat's and not as a small copy of the player's while both are up.
 */
export function drawProtectiveShellMini(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  phase: number,
): void {
  const radiusPx = tilePx * MINI_SHELL_RADIUS_TILES;
  const lineW = Math.max(MINI_BORDER_WIDTH_MIN_PX, tilePx * MINI_BORDER_WIDTH_PER_TILE);
  const pulse = MINI_PULSE_BASE + MINI_PULSE_SWING * Math.sin(phase * TAU);

  ctx.save();
  const callerAlpha = ctx.globalAlpha;

  ctx.globalAlpha = callerAlpha * pulse * MINI_GLOW_ALPHA;
  ctx.strokeStyle = MINI_GLOW_COLOR;
  ctx.lineWidth = lineW * MINI_GLOW_WIDTH_MULT;
  circle(ctx, cx, cy, radiusPx + lineW * MINI_GLOW_OFFSET_MULT);
  ctx.stroke();

  ctx.globalAlpha = callerAlpha * pulse * MINI_BORDER_ALPHA;
  ctx.strokeStyle = MINI_BORDER_COLOR;
  ctx.lineWidth = lineW;
  circle(ctx, cx, cy, radiusPx);
  ctx.stroke();

  ctx.globalAlpha = callerAlpha * MINI_INTERIOR_FILL_ALPHA;
  ctx.fillStyle = MINI_FILL_COLOR;
  circle(ctx, cx, cy, radiusPx);
  ctx.fill();

  ctx.restore();
}

const SHOCKWAVE_START_ALPHA = 0.9;
const SHOCKWAVE_INNER_ALPHA_MULT = 0.5;
/** The trailing ring rides inside the leading edge by this share of the radius. */
const SHOCKWAVE_INNER_RADIUS_SHARE = 0.85;
const SHOCKWAVE_INNER_WIDTH_MIN_PX = 1.5;
const SHOCKWAVE_INNER_WIDTH_PER_TILE = 0.05;
const SHOCKWAVE_LEAD_COLOR = '#ff8c00';
const SHOCKWAVE_INNER_COLOR = '#fbbf24';

/**
 * The ring a full-power shell throws off as it expires, expanding from
 * `SHOCKWAVE_START_RADIUS_TILES` to `SHOCKWAVE_MAX_RADIUS_TILES` and fading as
 * it grows. `expandT` 0→1 is the whole sweep.
 */
export function drawProtectiveShellShockwave(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  expandT: number,
): void {
  const startRadius = tilePx * SHOCKWAVE_START_RADIUS_TILES;
  const maxRadius = tilePx * SHOCKWAVE_MAX_RADIUS_TILES;
  const currentRadius = startRadius + (maxRadius - startRadius) * expandT;
  const alpha = (1 - expandT) * SHOCKWAVE_START_ALPHA;

  ctx.save();
  const callerAlpha = ctx.globalAlpha;

  ctx.globalAlpha = callerAlpha * alpha;
  ctx.strokeStyle = SHOCKWAVE_LEAD_COLOR;
  ctx.lineWidth = borderWidth(tilePx);
  circle(ctx, cx, cy, currentRadius);
  ctx.stroke();

  ctx.globalAlpha = callerAlpha * alpha * SHOCKWAVE_INNER_ALPHA_MULT;
  ctx.strokeStyle = SHOCKWAVE_INNER_COLOR;
  ctx.lineWidth = Math.max(SHOCKWAVE_INNER_WIDTH_MIN_PX, tilePx * SHOCKWAVE_INNER_WIDTH_PER_TILE);
  circle(ctx, cx, cy, currentRadius * SHOCKWAVE_INNER_RADIUS_SHARE);
  ctx.stroke();

  ctx.restore();
}
