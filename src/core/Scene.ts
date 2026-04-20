import { updateFrameTime } from '../utils';

/**
 * Abstract base for all game scenes. Scenes own their own update/render logic
 * and declare what action-key listeners they need via onEnter/onExit.
 */
export abstract class Scene {
  abstract update(): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
  onEnter?(): void;
  onExit?(): void;
  handleClick?(mx: number, my: number): void;
  handleMouseDown?(mx: number, my: number): void;
  handleMouseMove?(mx: number, my: number): void;
  handleMouseUp?(mx: number, my: number): void;
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

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.display = 'block';
    document.getElementById('game')!.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
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

    this.loop();
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

  private loop(): void {
    updateFrameTime();
    if (this.current) {
      this.current.update();
      this.current.render(this.ctx);
    }
    requestAnimationFrame(() => this.loop());
  }
}
