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
 */
import type { LoadTask } from '../core/LoadRunner';
import { renderQuality } from '../core/RenderQuality';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { holdFigureIdleSweep, releaseFigureIdleSweep } from '../sprites/figure/figureFrameCache';
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

export class ArrivalLoader {
  private overlay: LoadingOverlay | null = null;
  private begun = false;
  private closedCallbacks: Array<() => void> = [];

  /** Puts the loading screen up if the arrival owes enough work to be worth covering. */
  begin(request: ArrivalLoadRequest): void {
    if (this.begun) throw new Error('an arrival is begun once per scene');
    this.begun = true;
    if (!floorArrivalOwesWork(request.returning)) return;
    this.overlay = new LoadingOverlay({
      kicker: request.kicker,
      title: request.title,
      tips: request.screen.tips,
      tasks: request.tasks(),
    });
    // Its frames are neither play nor a sign that anything went unused: the
    // render-quality probe would judge the loader's frames, and the figure
    // cache's idle sweep would release the rows being warmed for play.
    renderQuality.beginLoadingCover();
    holdFigureIdleSweep();
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

  /** The screen's surface, to mount with the scene's others; none when nothing was owed. */
  surfaces(): Surface[] {
    if (!this.begun) {
      throw new Error('a scene mounted its surfaces before beginning its arrival');
    }
    return this.overlay === null ? [] : [this.overlay.surface(ARRIVAL_LOADING_SURFACE_ID)];
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
      return;
    }
    overlay.renderFadeOut(ctx, viewportWidth(), viewportHeight());
  }

  /** For the scene's `onExit`: a scene left mid-load must not leave the holds in force. */
  dispose(): void {
    if (this.overlay?.isOpen === true) this.releaseHolds();
    this.overlay = null;
    this.closedCallbacks = [];
  }

  private releaseHolds(): void {
    renderQuality.endLoadingCover();
    releaseFigureIdleSweep();
  }
}
