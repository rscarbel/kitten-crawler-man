/**
 * Tito, the Desperado Club's croupier, who runs the Wheel of Fortune — drawn
 * at runtime in two renderings. The painters live in `art/tito/`.
 *
 * The **bust** is the wheel screen's: chest up behind his counter, fingers
 * steepled, smiling a size too wide, with a pose for each beat of the game.
 * The **world figure** stands behind his counter on the club floor.
 */

import { scaleHumanoidBox } from './humanoidScale';
import { paintTitoBust } from './art/tito/bust';
import { paintTitoWorld } from './art/tito/world';
import type { TitoBustPose } from './art/tito/motion';

export type { TitoBustPose } from './art/tito/motion';

/**
 * Tito's bust in the square with top-left (x, y) and side `size`.
 *
 * - `idle` breathes, blinks and now and then glances at the wheel.
 * - `grin` widens the smile, cocks a brow and winks.
 * - `chuckle` shuts his eyes and shakes his shoulders.
 * - `lunge` is the stab: a wind-up, a lunge across the counter with the knife,
 *   a hold and a recovery. The caller adds the slash flash and the shake.
 *
 * `poseProgress` (0→1) runs a pose's motion; `timeMs` is a real millisecond
 * clock for the idle breath and blink.
 */
export function drawTitoBust(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pose: TitoBustPose,
  poseProgress: number,
  timeMs: number,
): void {
  paintTitoBust(ctx, x, y, size, pose, poseProgress, timeMs);
}

export interface TitoFigureOpts {
  /** The tile size the club draws its NPCs at. */
  size: number;
  /** A real millisecond clock: his breath, blink and idle gestures. */
  timeMs: number;
}

/**
 * Tito standing behind his counter on the club floor, from the `size`-pixel
 * tile box at (x, y), enlarged like the club's other NPCs. The counter is
 * drawn after him and hides him below the waist.
 */
export function drawTitoFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts: TitoFigureOpts,
): void {
  const box = scaleHumanoidBox(x, y, opts.size);
  paintTitoWorld(ctx, box.sx, box.sy, box.s, opts.timeMs);
}
