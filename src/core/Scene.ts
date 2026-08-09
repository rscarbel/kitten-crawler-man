import { updateFrameTime } from '../utils';
import {
  clearMenuFocus,
  focusNextButton,
  focusPreviousButton,
  focusedButtonClickPoint,
  menuFocusContextId,
  menuFocusRingSize,
} from '../ui/Button';
import {
  cancelRebindCapture,
  handleRebindCaptureKey,
  isRebindCaptureActive,
} from '../ui/pause/rebindCapture';
import { activeSearchField, endSearchCapture } from '../ui/SearchField';
import { beginPersonFrame } from '../sprites/person/personFrameCache';
import { perfMonitor } from './PerfMonitor';
import { renderQuality } from './RenderQuality';
import {
  getRenderScale,
  setRenderScaleValue,
  setViewportSize,
  viewportHeight,
  viewportWidth,
} from './Viewport';

/** Milliseconds per second. */
const MS_PER_SECOND = 1000;

/** Frame rate for fixed timestep (60 fps). */
const FRAME_RATE = 60;

/** Fixed timestep for game update loop in milliseconds. */
const FIXED_DT_MS = MS_PER_SECOND / FRAME_RATE;

/** Maximum accumulated time to process in one frame to prevent death spiral. */
const MAX_ACCUMULATOR_MULTIPLIER = 5;

/**
 * Maximum catch-up update() calls per animation frame. Running more updates when
 * updates are already slow compounds the slowdown, so remaining debt is dropped.
 */
const MAX_CATCHUP_UPDATES = 2;

/** Floor for the viewport size so a zero-sized window can't divide by zero. */
const MIN_VIEWPORT_PX = 1;

/** Keys that step the menu focus ring forward. */
const FOCUS_NEXT_KEYS: ReadonlySet<string> = new Set(['Tab', 'ArrowDown', 'ArrowRight']);
/** Keys that step it backward. Shift+Tab is handled separately. */
const FOCUS_PREVIOUS_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowLeft']);
/** Keys that activate the focused button — or, with nothing focused, the primary one. */
const FOCUS_ACTIVATE_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

/**
 * Shortest gap between two focus steps driven by the OS key-repeat stream.
 *
 * Auto-repeat runs at around thirty presses a second, which walks a four-button
 * menu end to end inside the frame the player is still reading. A fresh press is
 * never throttled — only the repeats behind it.
 */
const FOCUS_REPEAT_INTERVAL_MS = 140;

/** Elements that own their own keystrokes; the ring must not steal from them. */
const TEXT_ENTRY_TAG_NAMES: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA']);

function isTypingIntoTextField(): boolean {
  const active = document.activeElement;
  if (active === null) return false;
  return TEXT_ENTRY_TAG_NAMES.has(active.tagName);
}

export abstract class Scene {
  abstract update(): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
  onEnter?(): void;
  onExit?(): void;
  /**
   * @param eventTimeStampMs - when the click was *created*, on `performance.now()`'s
   *   timebase. A stalled main thread queues events and delivers them all at resume,
   *   so anything timing-sensitive has to score the click by this rather than by when
   *   the handler happened to run.
   */
  handleClick?(mx: number, my: number, eventTimeStampMs: number): void;
  handleMouseDown?(mx: number, my: number): void;
  handleMouseMove?(mx: number, my: number): void;
  handleMouseUp?(mx: number, my: number): void;
  handleMouseLeave?(): void;
  handleContextMenu?(mx: number, my: number): void;
  handleWheel?(deltaY: number): void;
  handleTouchStart?(e: TouchEvent, rect: DOMRect): void;
  handleTouchMove?(e: TouchEvent, rect: DOMRect): void;
  handleTouchEnd?(e: TouchEvent, rect: DOMRect): void;
}

/**
 * Owns the <canvas>, runs the rAF loop, and manages scene transitions.
 * SceneManager is generic — it knows nothing about gameplay, levels, or mobs.
 */
export class SceneManager {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private current: Scene | null = null;
  private lastTime = performance.now();
  private accumulator = 0;
  private readonly FIXED_DT = FIXED_DT_MS;
  /**
   * Draws on top of whatever the current scene rendered. Installed by a dev
   * entry point for the `?perf` overlay and null otherwise — keeping it a hook
   * rather than a call means `core` never has to reach into `ui`, and a release
   * build has no import edge to the overlay at all.
   */
  private frameOverlay: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  /**
   * Every key physically down right now, tracked here rather than read off
   * `InputManager`: a held-key set that gameplay is free to clear cannot tell a
   * finger coming up from the scene clearing it, and this guard turns entirely
   * on that difference.
   */
  private readonly heldKeys = new Set<string>();

  /**
   * The keys that were already down when the menu now on screen appeared. Their
   * repeats are leftovers from walking into the door, not menu input, so they
   * stay inert until the player lifts the key and presses it again.
   */
  private readonly keysHeldWhenMenuOpened = new Set<string>();

  /** The menu {@link keysHeldWhenMenuOpened} was snapshotted for. */
  private lastMenuFocusContext: string | null = null;

  /**
   * The keys that were already down when the currently-focused search field
   * gained focus. Their auto-repeats are leftovers from walking, not typing —
   * without this, holding W into a click on the search field types "wwww…".
   */
  private readonly keysHeldWhenSearchFocused = new Set<string>();

  /** The `SearchField.focusToken()` {@link keysHeldWhenSearchFocused} was snapshotted for. */
  private lastSearchFocusToken: number | null = null;

  /** `performance.now()` of the last focus step, for the auto-repeat throttle. */
  private lastFocusStepAtMs = Number.NEGATIVE_INFINITY;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gameEl = document.getElementById('game');
    if (!gameEl) throw new Error('#game element not found');
    gameEl.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
    this.applyViewportSize();
    renderQuality.attach(this);

    window.addEventListener('resize', () => {
      this.applyViewportSize();
      // A resize is also how a move to a display of a different pixel density
      // surfaces, so the scale the preset asks for may have changed with it.
      renderQuality.handleDisplayChange();
    });

    // Capture phase, on `window`: it has to run before the gameplay handlers
    // registered on the same target, so that a key the menu ring consumes never
    // also fires an attack or a character switch underneath the open menu.
    window.addEventListener('keydown', (e) => this.handleMenuNavigation(e), { capture: true });

    // A release re-arms a key the menu opened underneath: lifting the finger and
    // pressing again is unambiguously aimed at the menu.
    window.addEventListener(
      'keyup',
      (e) => {
        this.heldKeys.delete(e.key);
        this.keysHeldWhenMenuOpened.delete(e.key);
        this.keysHeldWhenSearchFocused.delete(e.key);
      },
      { capture: true },
    );

    // A window that loses focus never delivers the keyup, so every key held
    // across an alt-tab would stay "down" forever and stay permanently inert.
    window.addEventListener('blur', () => {
      this.heldKeys.clear();
      this.keysHeldWhenMenuOpened.clear();
      this.keysHeldWhenSearchFocused.clear();
    });

    const getPos = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    this.canvas.addEventListener('click', (e) => {
      if (!this.current?.handleClick) return;
      const { x, y } = getPos(e);
      this.current.handleClick(x, y, e.timeStamp);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.current?.handleMouseDown) return;
      if (e.button !== 0) return;
      const { x, y } = getPos(e);
      this.current.handleMouseDown(x, y);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.current?.handleMouseMove) return;
      const { x, y } = getPos(e);
      this.current.handleMouseMove(x, y);
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (!this.current?.handleMouseUp) return;
      const { x, y } = getPos(e);
      this.current.handleMouseUp(x, y);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.current?.handleMouseLeave?.();
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.current?.handleWheel) return;
        e.preventDefault();
        this.current.handleWheel(e.deltaY);
      },
      { passive: false },
    );

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.current?.handleContextMenu) return;
      const { x, y } = getPos(e);
      this.current.handleContextMenu(x, y);
    });

    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (!this.current?.handleTouchStart) return;
        const rect = this.canvas.getBoundingClientRect();
        this.current.handleTouchStart(e, rect);
      },
      { passive: false },
    );

    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        if (!this.current?.handleTouchMove) return;
        const rect = this.canvas.getBoundingClientRect();
        this.current.handleTouchMove(e, rect);
      },
      { passive: false },
    );

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (!this.current?.handleTouchEnd) return;
      const rect = this.canvas.getBoundingClientRect();
      this.current.handleTouchEnd(e, rect);
    };
    this.canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * Keyboard driving for whatever menu declared a focus ring last frame.
   *
   * Deliberately inert outside menus: with no ring declared this returns
   * immediately, so Space still attacks, Tab still switches crawlers and the
   * arrows still walk. Escape is never consumed here — it belongs to the scenes'
   * dismiss chains, which are the only way out of some of these menus.
   */
  private handleMenuNavigation(e: KeyboardEvent): void {
    const { predatesMenu: pressPredatesMenu, predatesSearchFocus: pressPredatesSearchFocus } =
      this.trackHeldKey(e);

    if (isTypingIntoTextField()) return;

    if (isRebindCaptureActive()) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') cancelRebindCapture();
      else if (!e.repeat) handleRebindCaptureKey(e.key);
      return;
    }

    // A focused search field owns every key while it has capture, auto-repeats
    // included — holding Backspace has to erase more than one character. This is
    // also what keeps hotbar slots 1-8 and WASD out of a typed query: both live
    // on window listeners behind this capture-phase one.
    const searchField = activeSearchField();
    if (searchField !== null) {
      // A chord is aimed at the browser or the OS, never at the field: Cmd+R
      // means reload, not the letter R. preventDefault is skipped so the
      // browser's own action still fires, but stopPropagation still runs —
      // otherwise the same keydown falls through to the window-level gameplay
      // handlers (hotbar, WASD) and Cmd+1 both switches a tab and activates
      // hotbar slot 1.
      const isModifierChord = e.ctrlKey || e.metaKey || e.altKey;
      if (isModifierChord) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // An auto-repeat from a key held since before the click that focused this
      // field — e.g. walking with W held, then clicking search — is movement
      // input the field never asked for, not a keystroke; typing it would spell
      // "wwww…" into the query.
      if (pressPredatesSearchFocus) return;
      searchField.handleCapturedKey(e.key);
      return;
    }

    if (e.key === 'Escape') return;
    if (menuFocusRingSize() === 0) return;

    const consume = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Consumed before the guards below reject it, never after. A press the menu
    // declines to act on still must not reach the world and swing a weapon
    // behind the panel — the menu owns the screen either way.
    if (FOCUS_NEXT_KEYS.has(e.key)) {
      consume();
      if (pressPredatesMenu || !this.allowFocusStep(e)) return;
      if (e.key === 'Tab' && e.shiftKey) focusPreviousButton();
      else focusNextButton();
      return;
    }

    if (FOCUS_PREVIOUS_KEYS.has(e.key)) {
      consume();
      if (pressPredatesMenu || !this.allowFocusStep(e)) return;
      focusPreviousButton();
      return;
    }

    if (FOCUS_ACTIVATE_KEYS.has(e.key)) {
      // Consumed whether or not anything answers it. A menu that declares a ring
      // but marks no primary — the casino's betting row is the deliberate case —
      // must still not let the press reach the world. A held accept key never
      // re-activates: one press, one button.
      consume();
      if (e.repeat || pressPredatesMenu) return;
      const point = focusedButtonClickPoint();
      if (point === null) return;
      this.current?.handleClick?.(point.x, point.y, e.timeStamp);
    }
  }

  /**
   * Record the press and report whether it began before the menu now on screen
   * did.
   *
   * Walking into a stairwell or a doorway means holding a direction at the
   * moment the menu appears, and the browser keeps delivering auto-repeats for
   * that key afterwards. Answering them races the selection across the menu
   * before the player has read it — and the first thing they did was not aimed
   * at a menu that did not exist yet.
   *
   * The snapshot is taken *before* the press joins the held set, so a key struck
   * after the menu appeared is never caught by it.
   */
  private trackHeldKey(e: KeyboardEvent): {
    predatesMenu: boolean;
    predatesSearchFocus: boolean;
  } {
    const contextId = menuFocusContextId();
    if (contextId !== this.lastMenuFocusContext) {
      this.lastMenuFocusContext = contextId;
      this.keysHeldWhenMenuOpened.clear();
      for (const key of this.heldKeys) this.keysHeldWhenMenuOpened.add(key);
    }
    const predatesMenu = this.keysHeldWhenMenuOpened.has(e.key);

    const searchFocusToken = activeSearchField()?.focusToken() ?? null;
    if (searchFocusToken !== this.lastSearchFocusToken) {
      this.lastSearchFocusToken = searchFocusToken;
      this.keysHeldWhenSearchFocused.clear();
      for (const key of this.heldKeys) this.keysHeldWhenSearchFocused.add(key);
    }
    const predatesSearchFocus = this.keysHeldWhenSearchFocused.has(e.key);

    this.heldKeys.add(e.key);
    return { predatesMenu, predatesSearchFocus };
  }

  /**
   * Throttle to the auto-repeat stream only. Timed off `e.timeStamp` rather than
   * `performance.now()`: a stalled main thread delivers every queued repeat at
   * resume, and handler time would read them all as one instant and let the
   * whole backlog through.
   */
  private allowFocusStep(e: KeyboardEvent): boolean {
    if (e.repeat && e.timeStamp - this.lastFocusStepAtMs < FOCUS_REPEAT_INTERVAL_MS) return false;
    this.lastFocusStepAtMs = e.timeStamp;
    return true;
  }

  /** Visible width in CSS pixels. */
  viewportWidth(): number {
    return viewportWidth();
  }

  /** Visible height in CSS pixels. */
  viewportHeight(): number {
    return viewportHeight();
  }

  /** Backing-store pixels per CSS pixel. */
  get renderScale(): number {
    return getRenderScale();
  }

  /**
   * Change the device-pixel density the game renders at. Fully live: only the
   * backing store and the context transform change, so world geometry — which
   * is expressed in CSS pixels — is untouched.
   */
  setRenderScale(scale: number): void {
    if (scale === getRenderScale()) return;
    setRenderScaleValue(scale);
    this.applyViewportSize();
  }

  /**
   * Size the backing store to the CSS viewport times the render scale, pin the
   * canvas to the CSS size explicitly, and re-establish the scaling transform.
   *
   * The explicit CSS size is required: a canvas with no `width`/`height` style
   * resolves `auto` to its intrinsic size — the `width` attribute — so a scaled
   * backing store would otherwise overflow the screen. The transform must be
   * re-applied on every resize because assigning `canvas.width` resets all
   * context state.
   */
  private applyViewportSize(): void {
    const cssWidth = Math.max(MIN_VIEWPORT_PX, window.innerWidth);
    const cssHeight = Math.max(MIN_VIEWPORT_PX, window.innerHeight);
    const scale = getRenderScale();
    this.canvas.width = Math.round(cssWidth * scale);
    this.canvas.height = Math.round(cssHeight * scale);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    setViewportSize(cssWidth, cssHeight);
    const horizontalScale = this.canvas.width / cssWidth;
    const verticalScale = this.canvas.height / cssHeight;
    this.ctx.setTransform(horizontalScale, 0, 0, verticalScale, 0, 0);
  }

  /**
   * Replace the current scene. Calls onExit on the outgoing scene and
   * onEnter on the incoming one.
   */
  replace(scene: Scene): void {
    this.current?.onExit?.();
    // The outgoing scene's ring outlives its last render otherwise, and a key
    // pressed before the incoming scene draws would synthesize a click at
    // coordinates belonging to a menu that is no longer on screen. An armed
    // rebind chip would likewise eat the first key of the new scene, as would a
    // search field left focused by the panel the outgoing scene tore down.
    clearMenuFocus();
    cancelRebindCapture();
    endSearchCapture();
    this.current = scene;
    scene.onEnter?.();
  }

  setFrameOverlay(overlay: (ctx: CanvasRenderingContext2D) => void): void {
    this.frameOverlay = overlay;
  }

  private loop(now: number): void {
    // Keep frameTime current for smooth visual animations in render().
    updateFrameTime();
    renderQuality.recordFrame(now);

    // Fixed-timestep accumulator: run update() at exactly 60 ticks/s regardless
    // of the display refresh rate. Cap the elapsed time to prevent a "spiral of
    // death" if the tab was backgrounded for a long time.
    const elapsed = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += Math.min(elapsed, this.FIXED_DT * MAX_ACCUMULATOR_MULTIPLIER);

    let steps = 0;
    const updateStartedAt = perfMonitor.begin();
    while (this.accumulator >= this.FIXED_DT && steps < MAX_CATCHUP_UPDATES) {
      this.current?.update();
      this.accumulator -= this.FIXED_DT;
      steps++;
    }
    perfMonitor.end('update', updateStartedAt);
    if (this.accumulator >= this.FIXED_DT) this.accumulator = 0;

    // Here rather than inside a render pipeline or a scene: the procedural-people
    // frame cache spreads its bakes over frames and reclaims only entries nobody
    // drew, so it needs a frame boundary — and a scene that draws citizens
    // without going through whichever pipeline owned the call would silently
    // freeze that clock, turning the cache off. This is the one call site every
    // scene passes through.
    beginPersonFrame();
    const renderStartedAt = perfMonitor.begin();
    this.current?.render(this.ctx);
    perfMonitor.end('render', renderStartedAt);

    // After the timers close, so the overlay reports the frame it is drawn on
    // top of rather than adding its own cost to the figures it shows. Saved and
    // restored around because it draws after an arbitrary scene's render, which
    // is under no obligation to leave alpha, transform or filter as it found them.
    perfMonitor.endFrame();
    if (this.frameOverlay) {
      this.ctx.save();
      this.frameOverlay(this.ctx);
      this.ctx.restore();
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}
