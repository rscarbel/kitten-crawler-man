/**
 * The Grotesque Spider's spit effects, drawn through the figure cache:
 *   drawSpitProjectile — viscous olive-green glob in flight (8-frame wobble)
 *   drawSpitTrapSplat  — landing splat expanding on the ground (8 frames, 0→1)
 *   drawSpitTrapIdle   — sticky puddle sitting on the ground (8-frame loop)
 *
 * All three are centred on (cx, cy), which is also where their figures anchor
 * their tile, so a caller places them by where the effect *is*. The projectile
 * expects the caller to have rotated the context to the flight angle: its +x
 * axis points the way it is travelling.
 *
 * The painting lives in `art/grotesqueSpiderSpitArt.ts`, the frame counts in
 * `art/grotesqueSpiderSpitFigure.ts`.
 */

import {
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
} from './art/grotesqueSpiderSpitFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/**
 * Draw the in-flight spit glob centred on (cx, cy).
 * @param frame  0–7 animation frame (drives wobble deformation)
 * @param ts     tile size to draw at
 */
export function drawSpitProjectile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  frame: number,
): void {
  drawFigureCached(ctx, GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, 'fly', frame, cx, cy, ts);
}

/**
 * Draw the spit landing splat centred on (cx, cy).
 * @param frame  0–7, where 0 = impact and 7 = fully spread
 */
export function drawSpitTrapSplat(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  frame: number,
): void {
  drawFigureCached(ctx, GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, 'splat', frame, cx, cy, ts);
}

/**
 * Draw the idle sticky puddle centred on (cx, cy).
 * @param frame  0–7 loop frame
 */
export function drawSpitTrapIdle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  frame: number,
): void {
  drawFigureCached(ctx, GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, 'idle', frame, cx, cy, ts);
}

/**
 * Warms the glob and the puddle it lands in, at the moment the spit telegraphs.
 *
 * Both rows exist for a second and a half at most and the wind-up is longer
 * than that, so warming them at the telegraph is what keeps the projectile from
 * baking its first cells on the frame it is launched.
 */
export function prewarmSpitEffects(): void {
  prewarmFigureState(GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, 'fly');
  prewarmFigureState(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, 'splat');
  prewarmFigureState(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, 'idle');
}

/** The rows the three draw calls above ask for, for the gates to check. */
export const SPIT_EFFECT_RUNTIME_ROWS: ReadonlyArray<{
  readonly figureId: string;
  readonly state: string;
}> = [
  { figureId: GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE.id, state: 'fly' },
  { figureId: GROTESQUE_SPIDER_SPIT_TRAP_FIGURE.id, state: 'splat' },
  { figureId: GROTESQUE_SPIDER_SPIT_TRAP_FIGURE.id, state: 'idle' },
];
