import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from '../../sprites/figure/figureFrameCache';
import {
  AUNTIE_GORGE_FIGURE,
  GORE_STATES,
  HEAVE_FRAMES,
  IDLE_FRAMES,
  WALK_FRAMES,
} from './auntieGorgeFigure';

/**
 * Auntie Gorge is a shelved figure: no creature class, role or voice wiring yet
 * (see `src/shelf/README.md`). This is the runtime wrapper a creature class
 * would draw her through. She paints three views of every state, so which row
 * is drawn is decided here rather than in the caller — the same split every
 * other painted mob uses.
 *
 * Frame counts are the figure's own constants rather than a second table, so a
 * row that changes length cannot leave this wrapper freezing on a clamped
 * frame index.
 */

type AuntieGorgeView = 'front' | 'side' | 'away';
type AuntieGorgeBase = 'walk' | 'heave' | 'idle';
type AuntieGorgeState =
  | 'walk'
  | 'walk_side'
  | 'walk_back'
  | 'heave'
  | 'heave_side'
  | 'heave_back'
  | 'idle'
  | 'idle_side'
  | 'idle_back';

const FRAMES_OF_BASE: Record<AuntieGorgeBase, number> = {
  walk: WALK_FRAMES,
  heave: HEAVE_FRAMES,
  idle: IDLE_FRAMES,
};

export const AUNTIE_GORGE_GORE_PARTS = GORE_STATES;

export const AUNTIE_GORGE_BODY_PART_KEY = 'auntie_gorge';

export interface AuntieGorgeSpriteState {
  walkFrame?: number;
  isMoving?: boolean;
  facingX?: number;
  facingY?: number;
  /** Progress through the heave row, or null when she is not heaving. */
  heaveProgress?: number | null;
  /** Pins the idle clock, for a preview harness. */
  idleFrame?: number | null;
}

/** Side wins ties: a diagonal reads better as a profile than as a head-on. */
function viewFor(facingX: number, facingY: number): AuntieGorgeView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * Spelled out rather than built from a template literal: a template gives back
 * a plain `string`, which the draw call answers with nothing at all rather than
 * with a type error.
 */
const STATE_OF: Record<AuntieGorgeBase, Record<AuntieGorgeView, AuntieGorgeState>> = {
  walk: { front: 'walk', side: 'walk_side', away: 'walk_back' },
  heave: { front: 'heave', side: 'heave_side', away: 'heave_back' },
  idle: { front: 'idle', side: 'idle_side', away: 'idle_back' },
};

const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

export function drawAuntieGorgeSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: AuntieGorgeSpriteState,
): void {
  const facingX = state.facingX ?? 1;
  const facingY = state.facingY ?? 0;
  const view = viewFor(facingX, facingY);
  // Only the profile is mirrored; the head-on and away rows are drawn as they
  // are, and flipping one of those would swap which of her arms is in front.
  const flipX = view === 'side' && facingX < 0;

  if (state.heaveProgress !== null && state.heaveProgress !== undefined) {
    const key = STATE_OF.heave[view];
    const frame = progressFrameIndex(state.heaveProgress, FRAMES_OF_BASE.heave);
    drawFigureCached(ctx, AUNTIE_GORGE_FIGURE, key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  if (state.isMoving === true) {
    const key = STATE_OF.walk[view];
    const frame = walkFrameIndex(state.walkFrame ?? 0, FRAMES_OF_BASE.walk);
    drawFigureCached(ctx, AUNTIE_GORGE_FIGURE, key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  const key = STATE_OF.idle[view];
  const frames = FRAMES_OF_BASE.idle;
  // Clock-driven rather than tied to her own walk phase, so two of her drawn
  // side by side do not breathe in lockstep.
  const idleFrame =
    state.idleFrame ??
    timeFrameIndex(performance.now() / MILLISECONDS_PER_SECOND, IDLE_FPS, frames);
  drawFigureCached(ctx, AUNTIE_GORGE_FIGURE, key, idleFrame % frames, sx, sy, tileSize, {
    flipX,
  });
}

/**
 * The three views of a base, warmed together rather than the one she currently
 * faces: a heave lasts long enough for the player to walk around her, and the
 * cache has to hold whichever view she is in when it lands.
 */
function prewarmBase(base: AuntieGorgeBase): void {
  for (const state of Object.values(STATE_OF[base])) {
    prewarmFigureState(AUNTIE_GORGE_FIGURE, state);
  }
}

/** The rows she stands and waddles in. */
export function prewarmAuntieGorgeLocomotion(): void {
  prewarmBase('idle');
  prewarmBase('walk');
}

/** The heave, warmed ahead of its first frame so the wind-up never bakes mid-play. */
export function prewarmAuntieGorgeHeave(): void {
  prewarmBase('heave');
}

/**
 * Her severed pieces. They are all drawn at once on the frame she dies, with no
 * lead-in of their own, so they have to be warm before it.
 */
export function prewarmAuntieGorgeGore(): void {
  for (const part of AUNTIE_GORGE_GORE_PARTS) prewarmFigureState(AUNTIE_GORGE_FIGURE, part);
}
