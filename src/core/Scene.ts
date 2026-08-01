import { updateFrameTime } from '../utils';
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

export abstract class Scene {
  abstract update(): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
  onEnter?(): void;
  onExit?(): void;
  handleClick?(mx: number, my: number): void;
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

    const getPos = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    this.canvas.addEventListener('click', (e) => {
      if (!this.current?.handleClick) return;
      const { x, y } = getPos(e);
      this.current.handleClick(x, y);
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
    this.current = scene;
    scene.onEnter?.();
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
    while (this.accumulator >= this.FIXED_DT && steps < MAX_CATCHUP_UPDATES) {
      this.current?.update();
      this.accumulator -= this.FIXED_DT;
      steps++;
    }
    if (this.accumulator >= this.FIXED_DT) this.accumulator = 0;

    this.current?.render(this.ctx);

    requestAnimationFrame((t) => this.loop(t));
  }
}
