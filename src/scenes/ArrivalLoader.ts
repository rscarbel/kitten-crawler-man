/**
 * The loading screen every gameplay scene arrives behind.
 *
 * `GameplayScene` declares one abstract, so a new scene cannot be written
 * without holding it, and its {@link ArrivalLoader.surfaces} refuses to mount
 * until the scene has called {@link ArrivalLoader.begin} — last in its
 * constructor, once everything that queues art or figures on construction has
 * queued it, so the decision whether the arrival owes enough work to cover
 * reads the real backlog. What the screen waits on is the shared
 * `floorArrivalLoadTasks`, which drain the same queues every environment fills.
 *
 * The same screen covers a warp within the scene — a checkpoint restore, a
 * recall landing — that would otherwise put the party down among art not yet
 * ready ({@link ArrivalLoader.coverWarp}).
 */
import type { LoadTask } from '../core/LoadRunner';
import { renderQuality } from '../core/RenderQuality';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { holdFigureIdleSweep, releaseFigureIdleSweep } from '../sprites/figure/figureFrameCache';
import { holdIdleClock, releaseIdleClock } from '../core/renderFrameClock';
import type { Surface, UiRoot } from '../ui/core/UiRoot';
import { LoadingOverlay } from '../ui/LoadingScreen';
import type { ArrivalLoadingScreen } from '../levels/types';
import { floorArrivalOwesWork } from './floorArrivalLoad';

/** The surface id every scene's loading screen is mounted under. */
export const ARRIVAL_LOADING_SURFACE_ID = 'arrival-loading';

export interface ArrivalLoadRequest {
  /** The small line over the title ("Floor 2"). */
  readonly kicker: string;
  readonly title: string;
  readonly screen: ArrivalLoadingScreen;
  /**
   * The scene is rebuilt around a map the party was just on (a walk back out
   * of a building), so only art still owed puts the screen up — see
   * {@link floorArrivalOwesWork}.
   */
  readonly returning: boolean;
  /** Built only when the screen goes up. */
  readonly tasks: () => LoadTask[];
}

/** A warp's screen: an arrival's, but always put up, since the caller has decided it is owed. */
export type WarpLoadRequest = Omit<ArrivalLoadRequest, 'returning'>;

export class ArrivalLoader {
  private overlay: LoadingOverlay | null = null;
  private begun = false;
  private closedCallbacks: Array<() => void> = [];
  /**
   * Mounted once whether or not anything is owed, so a warp later in the
   * scene's life has somewhere to put its screen: open exactly while an
   * overlay is.
   */
  private readonly surface: Surface = {
    id: ARRIVAL_LOADING_SURFACE_ID,
    band: 'system',
    haltsWorld: true,
    locksKeyboard: true,
    blocksEscape: true,
    isOpen: () => this.isOpen,
    render: (ui) => this.overlaySurface?.render(ui),
    onKey: (key, mods) => this.overlaySurface?.onKey?.(key, mods) === true,
  };
  private overlaySurface: Surface | null = null;

  /** Puts the loading screen up if the arrival owes enough work to be worth covering. */
  begin(request: ArrivalLoadRequest): void {
    if (this.begun) throw new Error('an arrival is begun once per scene');
    this.begun = true;
    if (!floorArrivalOwesWork(request.returning)) return;
    this.open(request);
  }

  /**
   * Puts the screen up over a warp within the scene, until its work is done.
   * For a caller that has already found the destination owed work; does
   * nothing while a screen is already up.
   */
  coverWarp(request: WarpLoadRequest): void {
    if (this.isOpen) return;
    this.open(request);
  }

  private open(request: WarpLoadRequest): void {
    const overlay = new LoadingOverlay({
      kicker: request.kicker,
      title: request.title,
      tips: request.screen.tips,
      tasks: request.tasks(),
    });
    this.overlay = overlay;
    this.overlaySurface = overlay.surface(ARRIVAL_LOADING_SURFACE_ID);
    // Its frames are neither play nor a sign that anything went unused: the
    // render-quality probe would judge the loader's frames, and the idle
    // sweeps would release the rows and sheets being warmed for play.
    renderQuality.beginLoadingCover();
    holdFigureIdleSweep();
    holdIdleClock();
  }

  /** True until the arrival's work is done: the world must neither update nor draw. */
  get isOpen(): boolean {
    return this.overlay?.isOpen === true;
  }

  /** Whether {@link begin} has run, for the check that a scene entered has decided its arrival. */
  get hasBegun(): boolean {
    return this.begun;
  }

  /**
   * Runs `callback` once the screen has closed, or at once when it is not up.
   * For whatever announces the arrival — the floor's sting, a room's music —
   * which would otherwise be heard under the screen, ahead of what it announces.
   * A scene left before the screen closes never runs it.
   */
  whenClosed(callback: () => void): void {
    if (this.isOpen) {
      this.closedCallbacks.push(callback);
      return;
    }
    callback();
  }

  /** The screen's surface, to mount with the scene's others. */
  surfaces(): Surface[] {
    if (!this.begun) {
      throw new Error('a scene mounted its surfaces before beginning its arrival');
    }
    return [this.surface];
  }

  /**
   * While the screen is open, frames only the UI: its surface draws the screen
   * in place of the world, and drawing it is what ticks the work. Returns
   * whether it took the frame, in which case the scene draws nothing else.
   */
  renderLoading(ui: UiRoot, ctx: CanvasRenderingContext2D): boolean {
    const overlay = this.overlay;
    if (overlay?.isOpen !== true) return false;
    ui.frame(ctx);
    // Finished on this frame: the world is drawn from the next one on, and its
    // frame times are the ones the render-quality probe should judge.
    if (overlay.hasFinished()) {
      this.releaseHolds();
      const callbacks = this.closedCallbacks;
      this.closedCallbacks = [];
      for (const callback of callbacks) callback();
    }
    return true;
  }

  /** The screen fading out over the world once the work is done. Call after the scene's UI. */
  renderFadeOut(ctx: CanvasRenderingContext2D): void {
    const overlay = this.overlay;
    if (overlay === null || overlay.isOpen) return;
    if (!overlay.isVisible) {
      this.overlay = null;
      this.overlaySurface = null;
      return;
    }
    overlay.renderFadeOut(ctx, viewportWidth(), viewportHeight());
  }

  /** For the scene's `onExit`: a scene left mid-load must not leave the holds in force. */
  dispose(): void {
    if (this.overlay?.isOpen === true) this.releaseHolds();
    this.overlay = null;
    this.overlaySurface = null;
    this.closedCallbacks = [];
  }

  private releaseHolds(): void {
    renderQuality.endLoadingCover();
    releaseFigureIdleSweep();
    releaseIdleClock();
  }
}
