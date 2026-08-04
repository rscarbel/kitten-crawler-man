import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type BugabooState = SpriteStates['bugaboo'];

/** Which of the three drawn viewpoints a facing resolves to. */
export type BugabooView = 'front' | 'side' | 'away';

/**
 * The frame of every swipe row on which the claws are at full extension.
 * `Bugaboo` deals its damage here, and `scripts/generate-bugaboo-sprite.ts`
 * declares the same value — the runtime cannot import from `scripts/` (rootDir
 * is `src/`), so the two are duplicated and a bake gate checks they agree.
 */
export const BUGABOO_SWIPE_IMPACT_FRAME = 4;

/** How many frames every swipe row holds, which the impact frame counts into. */
export const BUGABOO_SWIPE_FRAMES = 8;

/** Loop speed for the idle, which is driven by the clock rather than a timer. */
export const BUGABOO_IDLE_FPS = 6;
/** How fast the arm sweeps its circle while the creature is stuck in a breach. */
export const BUGABOO_BREACH_FPS = 9;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Read off the sheet rather than hand-tabled, because `drawSprite` *clamps* the
 * frame index: a row that got shorter would silently freeze on its last frame
 * instead of failing.
 */
function frameCountOf(state: BugabooState): number {
  return getSpriteDefByKey('bugaboo')?.states.get(state)?.frameCount ?? 1;
}

/** Views split on whichever axis the creature is facing hardest along. */
function viewFor(facingX: number, facingY: number): BugabooView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: 'idle' | 'walk' | 'swipe', view: BugabooView): BugabooState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the Bugaboo sprite needs to pick a pose. All fields optional. */
export interface BugabooSpriteState {
  /** The walk cycle angle from `Mob.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through a claw swipe, monotonic; null when it is not swiping. */
  readonly swipeProgress?: number | null;
  /**
   * Set while the creature is still under a barricaded grate: it plays the
   * looping breach row — an arm out of a hole in the floor, groping around —
   * instead of its body. Null when it is not stuck in one.
   */
  readonly breaching?: boolean;
  /** 0–1 through hauling itself out of a breach; null when it is not. */
  readonly emergeProgress?: number | null;
  /**
   * Offsets the clock-driven loops, so a room full of Bugaboos does not breathe
   * or grope in unison.
   */
  readonly loopOffsetSeconds?: number;
  /**
   * Overrides the frame of whichever clock-driven loop is playing.
   *
   * The idle and the breach both run off the wall clock so that several of
   * these in one room are out of step with each other. The preview harness has
   * to be able to pause and step them, and a row that ignores the harness's own
   * clock is a row nobody can step through — which would be the breach, the one
   * row that harness mostly exists for.
   */
  readonly loopFrame?: number | null;
}

/**
 * Draw a Bugaboo: idle, walk, claw swipe, and the two floor-breach rows.
 *
 * Priority runs emerge → breach → swipe → walk → idle, so a creature committed
 * to climbing out of the floor always wins over whatever it was doing.
 *
 * Only the profile rows are mirrored; flipping a head-on view would put its
 * eyes and feet on the wrong sides every time it turned around. The breach and
 * emerge rows are head-on only — a hole in the floor has no facing.
 */
export function drawBugabooSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: BugabooSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 1,
    swipeProgress = null,
    breaching = false,
    emergeProgress = null,
    loopOffsetSeconds = 0,
    loopFrame = null,
  } = state;

  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND + loopOffsetSeconds;
  const loopedFrame = (fps: number, count: number): number =>
    loopFrame ?? timeFrameIndex(nowSeconds, fps, count);

  if (emergeProgress !== null) {
    drawSpriteKey(
      ctx,
      'bugaboo',
      'emerge',
      progressFrameIndex(emergeProgress, frameCountOf('emerge')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  if (breaching) {
    drawSpriteKey(
      ctx,
      'bugaboo',
      'breach',
      loopedFrame(BUGABOO_BREACH_FPS, frameCountOf('breach')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (swipeProgress !== null) {
    const key = stateFor('swipe', view);
    drawSpriteKey(
      ctx,
      'bugaboo',
      key,
      progressFrameIndex(swipeProgress, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawSpriteKey(
      ctx,
      'bugaboo',
      key,
      walkFrameIndex(walkFrame, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return;
  }

  const key = stateFor('idle', view);
  drawSpriteKey(
    ctx,
    'bugaboo',
    key,
    loopedFrame(BUGABOO_IDLE_FPS, frameCountOf(key)),
    sx,
    sy,
    tileSize,
    {
      flipX,
    },
  );
}
