import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';

/**
 * The cockroach is drawn dorsally in all three facings, because that is what
 * you see of an animal lying flat on the floor: "front" is head-toward-camera,
 * not a face.
 *
 * `scripts/generate-cockroach-sprite.ts` owns the frame counts and the bite's
 * impact frame; the runtime cannot import from `scripts/`, so they are
 * duplicated here and a bake gate holds the two equal.
 */

type CockroachView = 'front' | 'side' | 'away';
type CockroachBase = 'skitter' | 'idle' | 'bite';
type CockroachState =
  | 'skitter'
  | 'skitter_side'
  | 'skitter_back'
  | 'idle'
  | 'idle_side'
  | 'idle_back'
  | 'bite'
  | 'bite_side'
  | 'bite_back';

const SKITTER_FRAMES = 8;
const IDLE_FRAMES = 6;
export const COCKROACH_BITE_FRAMES = 8;

/** The frame the bite connects on — the extreme of the lunge. */
export const COCKROACH_BITE_IMPACT_FRAME = 4;

/**
 * `drawSprite` clamps the frame index, so a row that lost frames would freeze
 * silently rather than error. Declaring the counts is what lets a gate catch it.
 */
const FRAME_COUNT: Record<CockroachState, number> = {
  skitter: SKITTER_FRAMES,
  skitter_side: SKITTER_FRAMES,
  skitter_back: SKITTER_FRAMES,
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_back: IDLE_FRAMES,
  bite: COCKROACH_BITE_FRAMES,
  bite_side: COCKROACH_BITE_FRAMES,
  bite_back: COCKROACH_BITE_FRAMES,
};

/**
 * The eight pieces it comes apart into, in the generator's own order. A part
 * that is not in both this list and the sheet is silently skipped at draw time,
 * which is what the gore-contract gate exists to catch.
 */
export const COCKROACH_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_pronotum',
  'gore_tegmen',
  'gore_abdomen',
  'gore_leg',
  'gore_legpair',
  'gore_thorax',
  'gore_cerci',
];

export const COCKROACH_BODY_PART_KEY = 'cockroach';

export interface CockroachSpriteState {
  walkFrame?: number;
  isMoving?: boolean;
  facingX?: number;
  facingY?: number;
  /** Progress through the bite row, or null when it is not biting. */
  biteProgress?: number | null;
  /** Pins the idle clock, for the preview harness. */
  idleFrame?: number | null;
}

/** Side wins ties: a diagonal reads better as a profile than as a head-on. */
function viewFor(facingX: number, facingY: number): CockroachView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * Spelled out rather than built from a template literal: a template gives back
 * a plain `string`, and the only way to hand that to `drawSpriteKey` is a cast.
 */
const STATE_OF: Record<CockroachBase, Record<CockroachView, CockroachState>> = {
  skitter: { front: 'skitter', side: 'skitter_side', away: 'skitter_back' },
  idle: { front: 'idle', side: 'idle_side', away: 'idle_back' },
  bite: { front: 'bite', side: 'bite_side', away: 'bite_back' },
};

const IDLE_FPS = 8;
const MILLISECONDS_PER_SECOND = 1000;

export function drawCockroachSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CockroachSpriteState,
): void {
  const facingX = state.facingX ?? 1;
  const facingY = state.facingY ?? 0;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (state.biteProgress !== null && state.biteProgress !== undefined) {
    const key = STATE_OF.bite[view];
    const frame = progressFrameIndex(state.biteProgress, FRAME_COUNT[key]);
    drawSpriteKey(ctx, 'cockroach', key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  if (state.isMoving === true) {
    const key = STATE_OF.skitter[view];
    const frame = walkFrameIndex(state.walkFrame ?? 0, FRAME_COUNT[key]);
    drawSpriteKey(ctx, 'cockroach', key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  const key = STATE_OF.idle[view];
  const frames = FRAME_COUNT[key];
  // Clock-driven rather than tied to the roach's own walk phase, so five of
  // them standing still do not twitch their antennae in lockstep.
  const idleFrame =
    state.idleFrame ?? timeFrameIndex(Date.now() / MILLISECONDS_PER_SECOND, IDLE_FPS, frames);
  drawSpriteKey(ctx, 'cockroach', key, idleFrame % frames, sx, sy, tileSize, { flipX });
}
