import { platform } from './Platform';
import { TILE_SIZE } from './constants';
import { MENU_TAP_DURATION_MS, MENU_TAP_MAX_DISTANCE } from '../ui/core/pointer';

const TOUCH_HOLD_THRESHOLD_MS = 150;
const MOVEMENT_SNAP_DISTANCE_PX = 8;

/**
 * A phone's finger on the world: the one that walks the crawler toward it,
 * and whether its lift was a tap.
 * Shared by every gameplay scene, so holding a finger down walks the same way
 * in the dungeon and inside a building.
 */
export class TouchMoveState {
  /** Touch identifier for the game-world movement finger. */
  moveTouchId: number | null = null;
  /** Current movement target in screen coordinates. */
  moveTarget: { x: number; y: number } | null = null;
  /** Tap start info (used to distinguish taps from drags). */
  tapStart: { x: number; y: number; time: number } | null = null;
  /**
   * The touchstart's own `timeStamp` for the movement finger: when the
   * finger came down, which a timed press is graded by. The tap only fires
   * on release, a variable time later.
   */
  tapStartEventMs: number | null = null;

  /**
   * Compute movement delta from the current touch state.
   * Returns `{dx, dy, isMobile}` where dx/dy are normalized direction components,
   * or `{dx: 0, dy: 0}` if no mobile movement is active.
   *
   * @param playerX Active player's world X position
   * @param playerY Active player's world Y position
   * @param cameraX Camera offset X
   * @param cameraY Camera offset Y
   */
  getMoveInput(
    playerX: number,
    playerY: number,
    cameraX: number,
    cameraY: number,
  ): { dx: number; dy: number; isMobile: boolean } {
    if (!platform.isMobile || !this.moveTarget) return { dx: 0, dy: 0, isMobile: false };

    const touchHoldMs = this.tapStart ? Date.now() - this.tapStart.time : 0;
    if (touchHoldMs < TOUCH_HOLD_THRESHOLD_MS) return { dx: 0, dy: 0, isMobile: false };

    const wx = this.moveTarget.x + cameraX;
    const wy = this.moveTarget.y + cameraY;
    const ddx = wx - (playerX + TILE_SIZE / 2);
    const ddy = wy - (playerY + TILE_SIZE / 2);
    const dist = Math.hypot(ddx, ddy);

    if (dist <= MOVEMENT_SNAP_DISTANCE_PX) return { dx: 0, dy: 0, isMobile: false };

    return { dx: ddx / dist, dy: ddy / dist, isMobile: true };
  }

  /** Whether the finger lifted at `(x, y)` stayed close to where it landed. */
  heldInPlace(x: number, y: number): boolean {
    const start = this.tapStart;
    return start !== null && Math.hypot(x - start.x, y - start.y) < MENU_TAP_MAX_DISTANCE;
  }

  /** Whether a finger lifted at `(x, y)` was a tap: quick, and close to where it landed. */
  isTap(x: number, y: number): boolean {
    const start = this.tapStart;
    if (start === null) return false;
    return Date.now() - start.time < MENU_TAP_DURATION_MS && this.heldInPlace(x, y);
  }

  /**
   * Start tracking a movement touch. `timeStamp` is the touch's own event
   * time, which a timed press is graded by.
   */
  startMove(touchId: number, x: number, y: number, timeStamp?: number): void {
    this.moveTouchId = touchId;
    this.moveTarget = { x, y };
    this.tapStart = { x, y, time: Date.now() };
    this.tapStartEventMs = timeStamp ?? null;
  }

  /** Update the movement target position. */
  updateMove(x: number, y: number): void {
    this.moveTarget = { x, y };
  }

  /** End the movement touch. Returns the tap start info if it was a tap. */
  endMove(): { x: number; y: number; time: number } | null {
    const tap = this.tapStart;
    this.moveTouchId = null;
    this.moveTarget = null;
    this.tapStart = null;
    return tap;
  }
}
