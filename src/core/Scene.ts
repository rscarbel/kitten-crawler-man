import { updateFrameTime } from '../utils';
import { bindPointerEvents, PointerInput } from '../ui/core/pointer';
import type { UiRoot } from '../ui/core/UiRoot';
import { rebindCaptureArmed } from '../ui/screens/pause/rebindCapture';
import { beginFigureFrame } from '../sprites/figure/figureFrameCache';
import { beginEnvironmentArtFrame } from '../map/environmentArtCache';
import { closeAboveDarkness } from '../systems/lighting/aboveDarkness';
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

/**
 * How deep a nesting of `ctx.save()` a throwing render is assumed to have got
 * to. Comfortably past the deepest any scene nests; the loop only exists so a
 * corrupt stack cannot spin forever.
 */
const MAX_LEAKED_SAVES = 64;

/**
 * The physical key a keyboard event is about. Held keys are tracked by `code`:
 * Shift or Caps Lock changing between the down and the up changes `key`
 * ("a" down, "A" up), which would leave the key held for good. A virtual
 * keyboard may report no `code`, so `key` stands in.
 */
function heldKeyId(e: KeyboardEvent): string {
  return e.code === '' ? e.key : e.code;
}

/** Elements that own their own keystrokes; the surface stack must not steal from them. */
const TEXT_ENTRY_TAG_NAMES: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA']);

function isTypingIntoTextField(): boolean {
  const active = document.activeElement;
  if (active === null) return false;
  return TEXT_ENTRY_TAG_NAMES.has(active.tagName);
}

export abstract class Scene {
  /**
   * The scene's surface stack. Every pointer gesture and every keydown goes
   * through it: the stack decides which surface a press belongs to, and hands
   * the rest to the scene's own world handler.
   */
  abstract readonly ui: UiRoot;
  abstract update(): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
  onEnter?(): void;
  onExit?(): void;
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

  /** The surface owning keyboard focus that {@link keysHeldWhenMenuOpened} was snapshotted for. */
  private lastFocusSurfaceId: string | null = null;

  /**
   * Keys whose press a surface consumed, until they come up. Their repeats
   * never reach gameplay even after that surface closes: the press that
   * turned a dialog's last page must not, still held, open it again. Keyed
   * by `code`, the physical key: Shift or Caps Lock changing between the down
   * and the up changes `key`, which would leave the key spent for good.
   */
  private readonly keysSpentByUi = new Set<string>();

  /** Gestures for the current scene's `UiRoot`. */
  private readonly pointerInput: PointerInput;

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
    // registered on the same target, so that a key a surface consumes never
    // also fires an attack or a character switch underneath the open menu.
    window.addEventListener('keydown', (e) => this.handleKeyDown(e), { capture: true });

    // A release re-arms a key the menu opened underneath: lifting the finger and
    // pressing again is unambiguously aimed at the menu.
    window.addEventListener(
      'keyup',
      (e) => {
        const physicalKey = heldKeyId(e);
        this.heldKeys.delete(physicalKey);
        this.keysHeldWhenMenuOpened.delete(physicalKey);
        this.keysSpentByUi.delete(physicalKey);
      },
      { capture: true },
    );

    // A window that loses focus never delivers the keyup, so every key held
    // across an alt-tab would stay "down" forever and stay permanently inert.
    window.addEventListener('blur', () => {
      this.heldKeys.clear();
      this.keysHeldWhenMenuOpened.clear();
      this.keysSpentByUi.clear();
      // Nor the mouseup: a button held as focus left would stay held.
      this.pointerInput.cancelAll();
    });

    this.pointerInput = new PointerInput(
      (gesture) => this.current?.ui.pointer(gesture),
      () => this.current?.ui.uiScale ?? 1,
      () => this.current?.ui.pointerLeft(),
    );
    bindPointerEvents(this.canvas, this.pointerInput);

    // The browser's own menu would cover the canvas on a right-click or a long press.
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    requestAnimationFrame((t) => this.loop(t));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const pressPredatesMenu = this.trackHeldKey(e);
    if (isTypingIntoTextField()) return;
    const ui = this.current?.ui;
    if (ui === undefined) return;
    this.routeKeyToUi(ui, e, pressPredatesMenu);
  }

  /**
   * Offers a keydown to the scene's surface stack ahead of every gameplay
   * listener. A key a surface consumed, or one whose press a surface consumed
   * earlier in the same hold, goes no further; anything else carries on to
   * gameplay, whose own gate reads the stack to decide whether it may act.
   */
  private routeKeyToUi(ui: UiRoot, e: KeyboardEvent, predatesSurface: boolean): void {
    // A chord is aimed at the browser or the OS (Cmd+R, Ctrl+Tab), never at a
    // menu, unless a key chip is listening: then the modifier is the answer.
    if ((e.ctrlKey || e.metaKey || e.altKey) && !rebindCaptureArmed()) return;
    const outcome = ui.key(e.key, {
      shift: e.shiftKey,
      repeat: e.repeat,
      timeStamp: e.timeStamp,
      predatesSurface,
    });
    if (outcome === 'consumed') this.keysSpentByUi.add(heldKeyId(e));
    if (!this.keysSpentByUi.has(heldKeyId(e))) return;
    e.preventDefault();
    e.stopPropagation();
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
   *
   * A Ctrl or Cmd chord is never recorded: macOS delivers no keyup for a key
   * released while Cmd is down, so it would stay "held" for good and make the
   * next real press of it look like a leftover.
   */
  private trackHeldKey(e: KeyboardEvent): boolean {
    const focusSurfaceId = this.current?.ui.focusSurfaceId() ?? null;
    if (focusSurfaceId !== this.lastFocusSurfaceId) {
      this.lastFocusSurfaceId = focusSurfaceId;
      this.keysHeldWhenMenuOpened.clear();
      for (const key of this.heldKeys) this.keysHeldWhenMenuOpened.add(key);
    }
    const physicalKey = heldKeyId(e);
    const predatesMenu = this.keysHeldWhenMenuOpened.has(physicalKey);

    const isChord = e.ctrlKey || e.metaKey;
    if (!isChord) this.heldKeys.add(physicalKey);
    return predatesMenu;
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
    // Released into the outgoing scene, so no surface or world gesture there is
    // left waiting for an `up` that will now arrive somewhere else.
    this.pointerInput.cancelAll();
    this.current?.onExit?.();
    this.current?.ui.dispose();
    this.current = scene;
    scene.onEnter?.();
  }

  setFrameOverlay(overlay: (ctx: CanvasRenderingContext2D) => void): void {
    this.frameOverlay = overlay;
  }

  /**
   * One rAF tick, wrapped so nothing thrown inside it can stop the loop.
   *
   * A creature's art is painted during render now rather than blitted from a
   * decoded sheet, and a painter is code that can throw where `drawImage` on a
   * missing key merely returned. Without this, one bad pose in one creature
   * ends the game: no further frame is ever scheduled, and the timers stay open
   * so even the perf readout lies about why. The exception still propagates —
   * a painter bug has to be loud — it just does not take the loop with it.
   */
  private loop(now: number): void {
    try {
      this.step(now);
    } finally {
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  /**
   * Pop everything a half-finished render left on the context's save stack.
   *
   * A painter that throws stops between its `save` and its `restore`, and
   * nothing else ever pops what it pushed — so the clip, alpha, composite mode
   * and transform of whatever it was drawing become the state every later frame
   * starts from. The loop above keeps the game running, which makes that the
   * worst possible outcome: the floor still updates and still takes input behind
   * a screen that never comes back.
   *
   * Draining to empty is the right target rather than a saved marker: the base
   * transform is established by `applyViewportSize` outside any `save`, so it is
   * what an emptied stack leaves in place, and `restore` on an empty stack does
   * nothing. The bound is only there so a corrupt stack cannot spin.
   */
  private drainSaveStack(): void {
    for (let i = 0; i < MAX_LEAKED_SAVES; i++) this.ctx.restore();
  }

  private step(now: number): void {
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
    try {
      while (this.accumulator >= this.FIXED_DT && steps < MAX_CATCHUP_UPDATES) {
        this.current?.update();
        this.accumulator -= this.FIXED_DT;
        steps++;
      }
    } finally {
      perfMonitor.end('update', updateStartedAt);
    }
    if (this.accumulator >= this.FIXED_DT) this.accumulator = 0;

    // Here rather than inside a render pipeline or a scene: the figure frame
    // cache spreads its bakes over frames and reclaims only entries nobody drew,
    // so it needs a frame boundary — and a scene that draws a cached figure
    // without going through whichever pipeline owned the call would silently
    // freeze that clock, turning the cache off. This is the one call site every
    // scene passes through.
    beginFigureFrame();
    beginEnvironmentArtFrame();
    closeAboveDarkness();
    const renderStartedAt = perfMonitor.begin();
    try {
      this.current?.render(this.ctx);
    } catch (error) {
      this.drainSaveStack();
      throw error;
    } finally {
      perfMonitor.end('render', renderStartedAt);
      perfMonitor.endFrame();
    }

    // After the timers close, so the overlay reports the frame it is drawn on
    // top of rather than adding its own cost to the figures it shows. Saved and
    // restored around because it draws after an arbitrary scene's render, which
    // is under no obligation to leave alpha, transform or filter as it found them.
    if (this.frameOverlay) {
      this.ctx.save();
      this.frameOverlay(this.ctx);
      this.ctx.restore();
    }
  }
}
