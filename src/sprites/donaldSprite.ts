/**
 * Donald, the Cloak & Dagger's croupier, who runs the Wheel of Fortune — drawn
 * at runtime in two renderings. The painters live in `art/donald/`.
 *
 * The **bust** is the wheel screen's: chest up behind his counter, fingers
 * steepled, smiling a size too wide, with a pose for each beat of the game.
 * The **world figure** stands behind his counter on the club floor.
 */

import { scaleHumanoidBox } from './humanoidScale';
import { paintDonaldBust } from './art/donald/bust';
import { paintDonaldWorld } from './art/donald/world';
import type { DonaldBustPose } from './art/donald/motion';

export type { DonaldBustPose } from './art/donald/motion';

/**
 * Donald's bust in the square with top-left (x, y) and side `size`.
 *
 * - `idle` breathes, blinks and now and then glances at the wheel.
 * - `grin` widens the smile, cocks a brow and winks.
 * - `chuckle` shuts his eyes and shakes his shoulders.
 *
 * `poseProgress` (0→1) runs a pose's motion; `timeMs` is a real millisecond
 * clock for the idle breath and blink.
 */
export function drawDonaldBust(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pose: DonaldBustPose,
  poseProgress: number,
  timeMs: number,
): void {
  paintDonaldBust(ctx, x, y, size, pose, poseProgress, timeMs);
}

export interface DonaldFigureOpts {
  /** The tile size the club draws its NPCs at. */
  size: number;
  /** A real millisecond clock: his breath, blink and idle gestures. */
  timeMs: number;
}

/**
 * Donald standing behind his counter on the club floor, from the `size`-pixel
 * tile box at (x, y), enlarged like the club's other NPCs. The counter is
 * drawn after him and hides him below the waist.
 */
export function drawDonaldFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts: DonaldFigureOpts,
): void {
  const box = scaleHumanoidBox(x, y, opts.size);
  paintDonaldWorld(ctx, box.sx, box.sy, box.s, opts.timeMs);
}
