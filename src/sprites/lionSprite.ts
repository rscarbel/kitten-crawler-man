import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { LION_FIGURE } from './art/lionFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

export const LION_STATES: ReadonlyArray<string> = ['idle', 'walk', 'attack'];

function frameCountOf(state: string): number {
  return Math.max(1, figureFrameCount(LION_FIGURE, state));
}

/** Call when a spawn is scheduled, so a pride arriving together is not baked mid-frame. */
export function prewarmLion(): void {
  for (const state of LION_STATES) prewarmFigureState(LION_FIGURE, state);
}

/**
 * Draw a lion in profile, mirrored to face left.
 *
 * @param attackAnim 0–1 progress through the bite lunge (0 = idle/walk).
 */
export function drawLionSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
): void {
  const flipX = facingX < 0;
  if (attackAnim > 0) {
    drawFigureCached(
      ctx,
      LION_FIGURE,
      'attack',
      progressFrameIndex(attackAnim, frameCountOf('attack')),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  if (isMoving) {
    drawFigureCached(
      ctx,
      LION_FIGURE,
      'walk',
      walkFrameIndex(walkFrame, frameCountOf('walk')),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  drawFigureCached(
    ctx,
    LION_FIGURE,
    'idle',
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf('idle')),
    sx,
    sy,
    s,
    { flipX },
  );
}
