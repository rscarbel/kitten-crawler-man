import { platform } from './Platform';
import { TILE_SIZE } from './constants';
import { pointInRect } from '../utils';

const TOUCH_HOLD_THRESHOLD_MS = 150;
const MOVEMENT_SNAP_DISTANCE_PX = 8;
const TAP_DURATION_MS = 250;
const TAP_MOVEMENT_THRESHOLD_PX = 20;
const LONG_PRESS_TIMER_MS = 500;
const LONG_PRESS_MOVEMENT_THRESHOLD_PX = 10;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Encapsulates mobile touch state for movement, taps, and long-press detection.
 * Extracted from DungeonScene to keep mobile-specific complexity isolated.
 *
 * The scene still owns button rect definitions and touch routing logic, but
 * this class manages the low-level touch tracking state.
 */
export class MobileTouchState {
  /** Touch identifier for the game-world movement finger. */
  moveTouchId: number | null = null;
  /** Current movement target in screen coordinates. */
  moveTarget: { x: number; y: number } | null = null;
  /** Tap start info (used to distinguish taps from drags). */
  tapStart: { x: number; y: number; time: number } | null = null;

  /** Touch identifier for inventory drag interactions. */
  inventoryDragTouchId: number | null = null;
  /** Touch identifier for dynamite charge. */
  dynamiteTouchId: number | null = null;
  /** Touch identifier for expanded minimap panning. */
  miniMapTouchId: number | null = null;
  miniMapTouchStartX = 0;
  miniMapTouchStartY = 0;
  miniMapTouchLastX = 0;
  miniMapTouchLastY = 0;
  miniMapDragged = false;
  /** Touch identifier for pause-menu scroll (separate from movement touch). */
  pauseScrollTouchId: number | null = null;
  /** Tap-start info for the pause-scroll touch (used to distinguish taps from scrolls). */
  pauseScrollTapStart: { x: number; y: number; time: number } | null = null;

  /** Long-press timer for inventory context menu. */
  longPressTimer: ReturnType<typeof setTimeout> | null = null;
  longPressPos: { x: number; y: number } | null = null;
  longPressFired = false;

  /** Button rects updated each render frame by the scene. */
  switchBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  followBtnRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  gearBtnRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  bagBtnRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  miniMapRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };
  summonBtnRect: Rect = { x: -9999, y: 0, w: 0, h: 0 };

  /** HUD collapse state (mobile only). */
  hudCollapsed = platform.initialHudCollapsed;
  hudToggleRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /** Returns true if the given point hits the given rect. */
  static hitTest(x: number, y: number, r: Rect): boolean {
    return pointInRect(x, y, r);
  }

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

  /**
   * Check if a touch-end was a short tap (< 250ms, < 20px movement).
   */
  isTap(x: number, y: number): boolean {
    if (!this.tapStart) return false;
    const elapsed = Date.now() - this.tapStart.time;
    const moved = Math.hypot(x - this.tapStart.x, y - this.tapStart.y);
    return elapsed < TAP_DURATION_MS && moved < TAP_MOVEMENT_THRESHOLD_PX;
  }

  /** Start tracking a movement touch. */
  startMove(touchId: number, x: number, y: number): void {
    this.moveTouchId = touchId;
    this.moveTarget = { x, y };
    this.tapStart = { x, y, time: Date.now() };
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

  /** Clear any active long-press timer. */
  clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressPos = null;
  }

  /** Start a long-press timer for context menu activation. */
  startLongPress(x: number, y: number, onFire: () => void): void {
    this.clearLongPress();
    this.longPressPos = { x, y };
    this.longPressFired = false;
    this.longPressTimer = setTimeout(() => {
      this.longPressFired = true;
      onFire();
    }, LONG_PRESS_TIMER_MS);
  }

  /** Cancel long-press if finger moved too far from start. */
  checkLongPressMove(x: number, y: number): void {
    if (this.longPressPos) {
      const dist = Math.hypot(x - this.longPressPos.x, y - this.longPressPos.y);
      if (dist > LONG_PRESS_MOVEMENT_THRESHOLD_PX) this.clearLongPress();
    }
  }
}
