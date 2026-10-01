/**
 * A tallow candle's flame: a small teardrop with a hot core, the one bright
 * stroke on any piece that carries one.
 */

import { TWO_PI, type Ctx } from './cellarPaint';

/** Frames in a candle flame's sway. */
export const CANDLE_FLAME_FRAMES = 4;

const FLAME = {
  height: 0.1,
  width: 0.045,
  haloRadius: 0.07,
  sway: 0.012,
  stretch: 0.15,
  /** The halo centres this far up the flame. */
  haloLift: 0.4,
  /** The teardrop's belly: its half-width swells past the flame's, low down. */
  bellySwell: 1.4,
  bellyRise: 0.25,
} as const;

const FLAME_OUTER = '#ff9a2e';
const FLAME_CORE = '#fff2c0';
const HALO_RGB = '255,190,90';
const HALO_ALPHA = 0.35;
const CORE_FRACTION = 0.5;

/**
 * Paints a flame standing on (x, baseY). `phase` steps through
 * {@link CANDLE_FLAME_FRAMES}: the tip sways and the flame stretches and
 * settles, which is all a candle in still cellar air does.
 */
export function paintCandleFlame(ctx: Ctx, x: number, baseY: number, ts: number, phase: number) {
  const turn = (phase / CANDLE_FLAME_FRAMES) * TWO_PI;
  const height = FLAME.height * ts * (1 + Math.sin(turn) * FLAME.stretch);
  const half = (FLAME.width * ts) / 2;
  const tipX = x + Math.sin(turn + 1) * FLAME.sway * ts;
  const halo = ctx.createRadialGradient(
    x,
    baseY - height * FLAME.haloLift,
    0,
    x,
    baseY - height * FLAME.haloLift,
    FLAME.haloRadius * ts,
  );
  halo.addColorStop(0, `rgba(${HALO_RGB},${HALO_ALPHA})`);
  halo.addColorStop(1, `rgba(${HALO_RGB},0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, baseY - height * FLAME.haloLift, FLAME.haloRadius * ts, 0, TWO_PI);
  ctx.fill();
  const drop = (scale: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(tipX, baseY - height * scale);
    ctx.quadraticCurveTo(
      x + half * scale * FLAME.bellySwell,
      baseY - height * FLAME.bellyRise * scale,
      x,
      baseY,
    );
    ctx.quadraticCurveTo(
      x - half * scale * FLAME.bellySwell,
      baseY - height * FLAME.bellyRise * scale,
      tipX,
      baseY - height * scale,
    );
    ctx.fill();
  };
  drop(1, FLAME_OUTER);
  drop(CORE_FRACTION, FLAME_CORE);
}
