/**
 * The boot-time loading screen shown while `loadGroups(['core'])` resolves.
 * Runs its own `requestAnimationFrame`
 * loop rather than going through a `Scene`/`SceneManager` — there is no scene yet
 * to hand the canvas to, and a progress bar has no input handling or update-tick
 * needs that would justify the extra machinery.
 */
import { drawOverlay, drawProgressBar, PROGRESS_PRESETS } from './Box';
import { drawText, TEXT_PRESETS } from './TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const BAR_WIDTH = 320;
const BAR_HEIGHT = 14;
/** Vertical gap between the "Loading..." label and the bar beneath it. */
const LABEL_TO_BAR_GAP = 28;
const BACKGROUND_COLOR = '#0f172a';

export interface LoadingScreenHandle {
  /** Update the fraction shown, e.g. as `loadGroups`'s onProgress callback fires. */
  setProgress(loaded: number, total: number): void;
  /** Stop the render loop — call once the first real scene is about to take the canvas. */
  stop(): void;
}

/** Starts drawing a full-screen progress bar on `ctx` every frame until `stop()` is called. */
export function showLoadingScreen(ctx: CanvasRenderingContext2D): LoadingScreenHandle {
  let fraction = 0;
  let stopped = false;

  function frame(): void {
    if (stopped) return;

    const cw = viewportWidth();
    const ch = viewportHeight();

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, color: BACKGROUND_COLOR, alpha: 1 });

    const barX = Math.round(cw / 2 - BAR_WIDTH / 2);
    const barY = Math.round(ch / 2);

    drawText(ctx, 'Loading...', {
      x: cw / 2,
      y: barY - LABEL_TO_BAR_GAP,
      align: 'center',
      ...TEXT_PRESETS.heading,
    });

    drawProgressBar(ctx, {
      x: barX,
      y: barY,
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      value: fraction,
      border: '#334155',
      ...PROGRESS_PRESETS.xp,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return {
    setProgress(loaded: number, total: number): void {
      fraction = total > 0 ? loaded / total : 1;
    },
    stop(): void {
      stopped = true;
    },
  };
}
