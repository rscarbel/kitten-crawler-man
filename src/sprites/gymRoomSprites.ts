/**
 * Blits for the gym's painted sheets (`gymRoomSheets.ts`), one call per prop.
 *
 * Every call is a single `drawImage` from a sheet painted when the floor
 * loaded, never a vector repaint. A sheet not painted yet draws nothing for a
 * frame or two rather than stalling the frame to paint it.
 */

import { drawSpriteKey } from '../core/SpriteRenderer';
import {
  GYM_BELT_FRAMES,
  GYM_CHALK_FRAMES,
  GYM_PLATE_FRAMES,
  GYM_SHUTTER_FRAMES,
  type GymBoomboxLook,
  type GymConsoleState,
} from './art/gymRoomArt';

const HALF = 0.5;
const QUARTER_TURN = Math.PI / 2;

/** Which way a belt carries whatever stands on it, as a unit step in tiles. */
export interface BeltDirection {
  readonly dx: number;
  readonly dy: number;
}

/**
 * The turn that carries the belt art — painted running toward +y — onto a push
 * of (dx, dy).
 */
function beltRotation(direction: BeltDirection): number {
  if (direction.dy > 0) return 0;
  if (direction.dy < 0) return Math.PI;
  return direction.dx > 0 ? -QUARTER_TURN : QUARTER_TURN;
}

/** Draws a sheet frame turned by `rotation` about the centre of the tile at (sx, sy). */
function drawTurned(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rotation: number,
  draw: (x: number, y: number) => void,
): void {
  if (rotation === 0) {
    draw(sx, sy);
    return;
  }
  ctx.save();
  ctx.translate(sx + ts * HALF, sy + ts * HALF);
  ctx.rotate(rotation);
  draw(-ts * HALF, -ts * HALF);
  ctx.restore();
}

/** A dumbbell rack holding `filled` dumbbells. */
export function drawGymRackSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  filled: number,
): void {
  drawSpriteKey(ctx, 'gym_rack', 'rack', filled, sx, sy, ts);
}

export function drawGymSquatRackSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  loaded: boolean,
): void {
  drawSpriteKey(ctx, 'gym_squat_rack', loaded ? 'loaded' : 'stripped', 0, sx, sy, ts);
}

export function drawGymCableStackSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawSpriteKey(ctx, 'gym_cable_stack', 'idle', 0, sx, sy, ts);
}

/** One tile of running belt, `frame` counting the slats forward. */
export function drawGymBeltSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  direction: BeltDirection,
  frame: number,
): void {
  const wrapped = ((frame % GYM_BELT_FRAMES) + GYM_BELT_FRAMES) % GYM_BELT_FRAMES;
  drawTurned(ctx, sx, sy, ts, beltRotation(direction), (x, y) =>
    drawSpriteKey(ctx, 'gym_belt', 'run', wrapped, x, y, ts),
  );
}

/** A treadmill's console, standing on the tile at the belt's wall end. */
export function drawGymConsoleSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  state: GymConsoleState,
  blinkFrame: number,
): void {
  drawSpriteKey(ctx, 'gym_console', state, blinkFrame, sx, sy, ts);
}

export function drawGymBoomboxSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  look: GymBoomboxLook,
  thumpFrame: number,
): void {
  drawSpriteKey(ctx, 'gym_boombox', look, look === 'thump' ? thumpFrame : 0, sx, sy, ts);
}

/**
 * The shutter across one doorway tile, `frame` from rolled up to fully down.
 * `acrossY` turns it a quarter for a doorway in a side wall.
 */
export function drawGymShutterSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  frame: number,
  acrossY: boolean,
): void {
  const clamped = Math.max(0, Math.min(GYM_SHUTTER_FRAMES - 1, frame));
  drawTurned(ctx, sx, sy, ts, acrossY ? QUARTER_TURN : 0, (x, y) =>
    drawSpriteKey(ctx, 'gym_shutter', 'roll', clamped, x, y, ts),
  );
}

/** A bowled plate, its tile top-left at (sx, sy). */
export function drawGymPlateSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  frame: number,
): void {
  drawSpriteKey(ctx, 'gym_plate', 'roll', frame % GYM_PLATE_FRAMES, sx, sy, ts);
}

export function drawGymChalkPuffSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  frame: number,
): void {
  drawSpriteKey(ctx, 'gym_chalk_puff', 'puff', Math.min(frame, GYM_CHALK_FRAMES - 1), sx, sy, ts);
}

/**
 * The mirror's spiderweb crack, its first tile's top-left at (sx, sy). Runs
 * along x; `alongY` turns it for a mirror on a side wall, pivoting on the first tile.
 */
export function drawGymMirrorCrackSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  alongY: boolean,
): void {
  drawTurned(ctx, sx, sy, ts, alongY ? QUARTER_TURN : 0, (x, y) =>
    drawSpriteKey(ctx, 'gym_mirror_crack', 'crack', 0, x, y, ts),
  );
}

/** The kit a crawler can carry off. */
export type GymPickupLook = 'bench' | 'treadmill' | 'dumbbell';

/** A carryable piece of kit lying on its tile, top-left at (sx, sy). */
export function drawGymPickupSprite(
  ctx: CanvasRenderingContext2D,
  look: GymPickupLook,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawSpriteKey(ctx, 'gym_pickups', look, 0, sx, sy, ts);
}
