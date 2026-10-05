/**
 * Turns mouse and touch input into one gesture stream: `down`, `move`, `up`,
 * `cancel` and `wheel`, each tagged with a pointer id.
 *
 * CSS-pixel coordinates are divided by the UI scale here and nowhere else, so
 * everything downstream works in UI units. The browser's `click` event is
 * never consumed: a tap is decided from `down` and `up`, so a drag can never be
 * followed by a stray click.
 */

/** How far a pointer may wander from where it went down and still count as a tap, in UI units. */
export const TAP_SLOP = 8;

/**
 * How far a finger may travel, in CSS pixels, and still tap a scrolling menu
 * row or the world rather than drag. Wider than {@link TAP_SLOP}: a thumb
 * slides further than a mouse.
 */
export const MENU_TAP_MAX_DISTANCE = 20;

/** A world touch held longer than this is a long press, not a tap. */
export const MENU_TAP_DURATION_MS = 250;

/** The mouse's pointer id. Touch identifiers are never negative, so they cannot collide with it. */
export const MOUSE_POINTER_ID = -1;

/** `MouseEvent.button` for the primary button; touches report it too. */
export const PRIMARY_BUTTON = 0;

export type GestureKind = 'down' | 'move' | 'up' | 'cancel' | 'wheel';

export type PointerSource = 'mouse' | 'touch';

export interface PointerGesture {
  readonly kind: GestureKind;
  readonly pointerId: number;
  readonly source: PointerSource;
  /** UI units. */
  readonly x: number;
  readonly y: number;
  /** The same point in CSS pixels, for world code that maps through the camera. */
  readonly cssX: number;
  readonly cssY: number;
  /** `MouseEvent.button` of the press that started the gesture; {@link PRIMARY_BUTTON} for touch. */
  readonly button: number;
  /** Wheel delta in CSS pixels; zero for every other kind. */
  readonly deltaY: number;
  /** The DOM event's `timeStamp`, when the host had one: timing-graded taps score by it. */
  readonly timeStamp?: number;
}

export type GestureSink = (gesture: PointerGesture) => void;

/**
 * Normalises raw mouse and touch calls into gestures for a sink (normally
 * `UiRoot.pointer`). The host forwards its DOM events here with
 * canvas-relative CSS coordinates, or calls {@link bindPointerEvents}.
 */
export class PointerInput {
  /** Button of the mouse press in progress, or `null` when the mouse is up. */
  private mouseButton: number | null = null;
  private lastMouse = { x: 0, y: 0 };
  /** Each finger down now, at its last reported point. */
  private readonly activeTouches = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly sink: GestureSink,
    private readonly uiScale: () => number,
    /** Called whenever the mouse leaves the canvas, pressed or not, so hover can clear (`UiRoot.pointerLeft`). */
    private readonly onLeave?: () => void,
  ) {}

  private emit(
    kind: GestureKind,
    pointerId: number,
    source: PointerSource,
    cssX: number,
    cssY: number,
    button: number,
    timeStamp: number | undefined,
    deltaY = 0,
  ): void {
    const scale = this.uiScale();
    this.sink({
      kind,
      pointerId,
      source,
      x: cssX / scale,
      y: cssY / scale,
      cssX,
      cssY,
      button,
      deltaY,
      timeStamp,
    });
  }

  mouseDown(cssX: number, cssY: number, button: number, timeStamp?: number): void {
    this.lastMouse = { x: cssX, y: cssY };
    if (this.mouseButton !== null) return;
    this.mouseButton = button;
    this.emit('down', MOUSE_POINTER_ID, 'mouse', cssX, cssY, button, timeStamp);
  }

  /** Moves with or without a button held; a hover move still updates what is under the cursor. */
  mouseMove(cssX: number, cssY: number, timeStamp?: number): void {
    this.lastMouse = { x: cssX, y: cssY };
    this.emit(
      'move',
      MOUSE_POINTER_ID,
      'mouse',
      cssX,
      cssY,
      this.mouseButton ?? PRIMARY_BUTTON,
      timeStamp,
    );
  }

  mouseUp(cssX: number, cssY: number, button: number, timeStamp?: number): void {
    this.lastMouse = { x: cssX, y: cssY };
    if (this.mouseButton !== button) return;
    this.mouseButton = null;
    this.emit('up', MOUSE_POINTER_ID, 'mouse', cssX, cssY, button, timeStamp);
  }

  /** The cursor left the canvas: a press in progress can no longer finish as a tap. */
  mouseLeave(cssX: number, cssY: number, timeStamp?: number): void {
    this.lastMouse = { x: cssX, y: cssY };
    this.onLeave?.();
    if (this.mouseButton === null) return;
    const button = this.mouseButton;
    this.mouseButton = null;
    this.emit('cancel', MOUSE_POINTER_ID, 'mouse', cssX, cssY, button, timeStamp);
  }

  wheel(cssX: number, cssY: number, deltaY: number, timeStamp?: number): void {
    this.emit('wheel', MOUSE_POINTER_ID, 'mouse', cssX, cssY, PRIMARY_BUTTON, timeStamp, deltaY);
  }

  touchStart(identifier: number, cssX: number, cssY: number, timeStamp?: number): void {
    if (this.activeTouches.has(identifier)) return;
    this.activeTouches.set(identifier, { x: cssX, y: cssY });
    this.emit('down', identifier, 'touch', cssX, cssY, PRIMARY_BUTTON, timeStamp);
  }

  touchMove(identifier: number, cssX: number, cssY: number, timeStamp?: number): void {
    if (!this.activeTouches.has(identifier)) return;
    this.activeTouches.set(identifier, { x: cssX, y: cssY });
    this.emit('move', identifier, 'touch', cssX, cssY, PRIMARY_BUTTON, timeStamp);
  }

  touchEnd(identifier: number, cssX: number, cssY: number, timeStamp?: number): void {
    if (!this.activeTouches.delete(identifier)) return;
    this.emit('up', identifier, 'touch', cssX, cssY, PRIMARY_BUTTON, timeStamp);
  }

  touchCancel(identifier: number, cssX: number, cssY: number, timeStamp?: number): void {
    if (!this.activeTouches.delete(identifier)) return;
    this.emit('cancel', identifier, 'touch', cssX, cssY, PRIMARY_BUTTON, timeStamp);
  }

  /**
   * Cancels every press in progress at its last known point: the window lost
   * focus, so no release is coming for any of them.
   */
  cancelAll(): void {
    this.mouseLeave(this.lastMouse.x, this.lastMouse.y);
    for (const [identifier, point] of [...this.activeTouches]) {
      this.touchCancel(identifier, point.x, point.y);
    }
  }
}

/**
 * Forwards a canvas's mouse, wheel and touch events to `input` with
 * canvas-relative CSS coordinates. Deliberately does not listen for `click`.
 * Returns a function that removes every listener.
 */
export function bindPointerEvents(canvas: HTMLCanvasElement, input: PointerInput): () => void {
  const local = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const onMouseDown = (e: MouseEvent): void => {
    const p = local(e.clientX, e.clientY);
    input.mouseDown(p.x, p.y, e.button, e.timeStamp);
  };
  const onMouseMove = (e: MouseEvent): void => {
    const p = local(e.clientX, e.clientY);
    input.mouseMove(p.x, p.y, e.timeStamp);
  };
  const onMouseUp = (e: MouseEvent): void => {
    const p = local(e.clientX, e.clientY);
    input.mouseUp(p.x, p.y, e.button, e.timeStamp);
  };
  const onMouseLeave = (e: MouseEvent): void => {
    const p = local(e.clientX, e.clientY);
    input.mouseLeave(p.x, p.y, e.timeStamp);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = local(e.clientX, e.clientY);
    input.wheel(p.x, p.y, e.deltaY, e.timeStamp);
  };
  const forEachChanged = (
    e: TouchEvent,
    handle: (identifier: number, x: number, y: number, timeStamp: number) => void,
  ): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const p = local(touch.clientX, touch.clientY);
      handle(touch.identifier, p.x, p.y, e.timeStamp);
    }
  };
  const onTouchStart = (e: TouchEvent): void => {
    forEachChanged(e, (id, x, y, t) => input.touchStart(id, x, y, t));
  };
  const onTouchMove = (e: TouchEvent): void => {
    forEachChanged(e, (id, x, y, t) => input.touchMove(id, x, y, t));
  };
  const onTouchEnd = (e: TouchEvent): void => {
    forEachChanged(e, (id, x, y, t) => input.touchEnd(id, x, y, t));
  };
  const onTouchCancel = (e: TouchEvent): void => {
    forEachChanged(e, (id, x, y, t) => input.touchCancel(id, x, y, t));
  };
  const touchOptions: AddEventListenerOptions = { passive: false };
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, touchOptions);
  canvas.addEventListener('touchmove', onTouchMove, touchOptions);
  canvas.addEventListener('touchend', onTouchEnd, touchOptions);
  canvas.addEventListener('touchcancel', onTouchCancel, touchOptions);
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('mouseleave', onMouseLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('touchstart', onTouchStart, touchOptions);
    canvas.removeEventListener('touchmove', onTouchMove, touchOptions);
    canvas.removeEventListener('touchend', onTouchEnd, touchOptions);
    canvas.removeEventListener('touchcancel', onTouchCancel, touchOptions);
  };
}
