import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { BITE_FRAMES, GORE_STATES, IDLE_FRAMES, RAT_FIGURE, WALK_FRAMES } from './art/ratFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Every pose row the figure paints. The gore pieces are states of their own. */
export type RatState =
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'bite'
  | 'bite_side'
  | 'bite_away';

/** Which of the figure's three viewpoints a facing vector selects. */
type RatView = 'front' | 'side' | 'away';

type RatBase = 'walk' | 'idle' | 'bite';

/**
 * Exhaustive by construction: a state added to the union but not to this table
 * is a compile error, which is safer than reading the count off the figure —
 * `drawFigureCached` *clamps* the frame index, so a row that got shorter would
 * silently freeze on its last frame instead of failing.
 */
const FRAME_COUNT: Record<RatState, number> = {
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_away: IDLE_FRAMES,
  bite: BITE_FRAMES,
  bite_side: BITE_FRAMES,
  bite_away: BITE_FRAMES,
};

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 7;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Game frames the bite animation runs for. `Rat` drives the sprite from a
 * countdown of this length, so the two cannot drift.
 */
export const RAT_BITE_FRAMES = 20;

/**
 * Where in the bite the jaws snap shut, as a fraction of `RAT_BITE_FRAMES`.
 *
 * The art gathers, lunges and snaps; the damage has to land on the snap or the
 * animation plays as a reaction to a hit that already happened. An art gate
 * holds this against the choreography by asserting it selects the frame the
 * lunge actually drives furthest on.
 */
export const RAT_BITE_IMPACT_PROGRESS = 0.56;

/**
 * The eight pieces a rat comes apart into, in the order they spawn.
 *
 * Taken from the figure rather than restated: `ratGore.ts` paints them in this
 * order and `BodyPartGoreSystem` spawns them in it, and a list written twice is
 * a body part dropped on the floor the first time one of the two is renamed.
 */
export const RAT_GORE_PARTS: ReadonlyArray<string> = GORE_STATES;

/** The `BodyPartGoreSystem` registry key a dead rat's flying pieces come from. */
export const RAT_BODY_PART_KEY = 'rat';

/** Everything the rat sprite needs to pick a pose. All fields are optional. */
export interface RatSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of the bite, 1 at the last; null when not biting. */
  readonly biteProgress?: number | null;
}

/** Views split on whichever axis the rat is facing hardest along. */
function viewFor(facingX: number, facingY: number): RatView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: RatBase, view: RatView): RatState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the rat.
 *
 * Priority runs bite → walk → idle, so a bite always wins over the scurry it
 * interrupts.
 */
export function drawRatSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: RatSpriteState = {},
): void {
  const { walkFrame = 0, isMoving = false, facingX = 1, facingY = 0, biteProgress = null } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put the
  // rat's ears and feet on the wrong sides every time it turned around.
  const flipX = view === 'side' && facingX < 0;

  if (biteProgress !== null) {
    const key = stateFor('bite', view);
    drawFigureCached(
      ctx,
      RAT_FIGURE,
      key,
      progressFrameIndex(biteProgress, FRAME_COUNT[key]),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(ctx, RAT_FIGURE, key, walkFrameIndex(walkFrame, FRAME_COUNT[key]), sx, sy, s, {
      flipX,
    });
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  drawFigureCached(
    ctx,
    RAT_FIGURE,
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    s,
    { flipX },
  );
}

const RAT_BASES: ReadonlyArray<RatBase> = ['walk', 'idle', 'bite'];
const RAT_VIEWS: ReadonlyArray<RatView> = ['front', 'side', 'away'];

/**
 * Every state `drawRatSprite` can ask the figure for.
 *
 * Built from the same two tables `stateFor` composes rather than listed by hand,
 * so a view or a base added to one is present in the other. The art gates feed
 * this to `missingStateFailures`: both draw paths return silently on a state the
 * figure does not paint, so a name only the runtime knows is an invisible
 * creature and no log line.
 */
export const RAT_STATES: ReadonlyArray<RatState> = RAT_BASES.flatMap((base) =>
  RAT_VIEWS.map((view) => stateFor(base, view)),
);

/** The rows a rat draws from the moment it exists: standing and scurrying. */
export const RAT_LOCOMOTION_STATES: ReadonlyArray<RatState> = RAT_VIEWS.flatMap((view) => [
  stateFor('idle', view),
  stateFor('walk', view),
]);

/**
 * The rows a rat draws once it is fighting: the lunge, and the pieces it comes
 * apart into.
 *
 * This creature paints an order of magnitude over the threshold the direct-paint
 * fallback is affordable below (`npm run bench:figure-paint` — the fur engine is
 * the most expensive small-creature painter in the game), so every state its AI
 * can enter is warmed by something rather than left to a cold paint on the frame
 * it is first drawn. The bite has no telegraph of its own, and the gore has less
 * than that: all eight pieces are drawn on the one frame a body comes apart.
 */
export const RAT_COMBAT_STATES: ReadonlyArray<string> = [
  ...RAT_VIEWS.map((view) => stateFor('bite', view)),
  ...RAT_GORE_PARTS,
];

/** Warms the rows a rat about to exist will draw. */
export function prewarmRat(): void {
  for (const state of RAT_LOCOMOTION_STATES) prewarmFigureState(RAT_FIGURE, state);
}

/** Warms the lunge and the gore, from the frame a rat notices a crawler. */
export function prewarmRatCombat(): void {
  for (const state of RAT_COMBAT_STATES) prewarmFigureState(RAT_FIGURE, state);
}
