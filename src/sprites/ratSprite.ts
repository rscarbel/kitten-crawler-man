import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';

type RatState = SpriteStates['rat'];

/** Which of the sheet's three viewpoints a facing vector selects. */
type RatView = 'front' | 'side' | 'away';

const FRAME_COUNT: Record<RatState, number> = {
  walk: 8,
  walk_side: 8,
  walk_away: 8,
  idle: 8,
  idle_side: 8,
  idle_away: 8,
  bite: 8,
  bite_side: 8,
  bite_away: 8,
  gore_head: 1,
  gore_torso: 1,
  gore_haunch: 1,
  gore_foreleg: 1,
  gore_tail: 1,
  gore_ribchunk: 1,
  gore_entrails: 1,
  gore_pelt: 1,
};

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 7;

/**
 * Game frames the bite animation runs for. `Rat` drives the sprite from a
 * countdown of this length, so the two cannot drift.
 */
export const RAT_BITE_FRAMES = 20;

/**
 * Where in the bite the jaws snap shut, as a fraction of `RAT_BITE_FRAMES`.
 *
 * The art gathers, lunges and snaps; the damage has to land on the snap or the
 * animation plays as a reaction to a hit that already happened. Matches the
 * `bitePhases` timing in `scripts/generate-rat-sprite.ts`.
 */
export const RAT_BITE_IMPACT_PROGRESS = 0.56;

/**
 * The eight pieces a rat comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/ratGore.ts` paints
 * them in this order and `BodyPartGoreSystem` spawns them in it, so a rename in
 * one place is a missing body part rather than a silent no-op.
 */
export const RAT_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_torso',
  'gore_haunch',
  'gore_foreleg',
  'gore_tail',
  'gore_ribchunk',
  'gore_entrails',
  'gore_pelt',
];

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

function stateFor(base: 'walk' | 'idle' | 'bite', view: RatView): RatState {
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
    drawSpriteKey(ctx, 'rat', key, progressFrameIndex(biteProgress, FRAME_COUNT[key]), sx, sy, s, {
      flipX,
    });
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawSpriteKey(ctx, 'rat', key, walkFrameIndex(walkFrame, FRAME_COUNT[key]), sx, sy, s, {
      flipX,
    });
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / 1000;
  drawSpriteKey(
    ctx,
    'rat',
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    s,
    {
      flipX,
    },
  );
}
