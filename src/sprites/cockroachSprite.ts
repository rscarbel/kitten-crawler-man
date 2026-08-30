import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import {
  BITE_FRAMES,
  BITE_IMPACT_FRAME,
  COCKROACH_FIGURE,
  GORE_STATES,
  IDLE_FRAMES,
  SKITTER_FRAMES,
} from './art/cockroachFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/**
 * The cockroach is drawn dorsally in all three facings, because that is what
 * you see of an animal lying flat on the floor: "front" is head-toward-camera,
 * not a face.
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

export const COCKROACH_BITE_FRAMES = BITE_FRAMES;

/** The frame the bite connects on — the extreme of the lunge. */
export const COCKROACH_BITE_IMPACT_FRAME = BITE_IMPACT_FRAME;

/**
 * `drawFigureCached` clamps the frame index, so a row that lost frames would
 * freeze silently rather than error. Declaring the counts is what lets a gate
 * catch it, and the record is exhaustive by construction: a state added to the
 * union and not to this table is a compile error.
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
 * The eight pieces it comes apart into, in the figure's own order. A part that
 * is not in both this list and the figure is silently skipped at draw time,
 * which is what the gore-contract gate exists to catch.
 */
export const COCKROACH_GORE_PARTS: ReadonlyArray<string> = GORE_STATES;

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
 * a plain `string`, and the state names the figure paints are the one thing the
 * type system can still hold this file to.
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
    drawFigureCached(ctx, COCKROACH_FIGURE, key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  if (state.isMoving === true) {
    const key = STATE_OF.skitter[view];
    const frame = walkFrameIndex(state.walkFrame ?? 0, FRAME_COUNT[key]);
    drawFigureCached(ctx, COCKROACH_FIGURE, key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  const key = STATE_OF.idle[view];
  const frames = FRAME_COUNT[key];
  // Clock-driven rather than tied to the roach's own walk phase, so five of
  // them standing still do not twitch their antennae in lockstep.
  const idleFrame =
    state.idleFrame ?? timeFrameIndex(Date.now() / MILLISECONDS_PER_SECOND, IDLE_FPS, frames);
  drawFigureCached(ctx, COCKROACH_FIGURE, key, idleFrame % frames, sx, sy, tileSize, { flipX });
}

const COCKROACH_BASES: ReadonlyArray<CockroachBase> = ['skitter', 'idle', 'bite'];
const COCKROACH_VIEWS: ReadonlyArray<CockroachView> = ['front', 'side', 'away'];

/**
 * Every state `drawCockroachSprite` can ask the figure for.
 *
 * Built from the two tables `STATE_OF` composes rather than listed by hand, so a
 * view or a base added to one is present in the other. The art gates feed this
 * to `missingStateFailures`: both draw paths return silently on a state the
 * figure does not paint, so a name only the runtime knows is an invisible
 * creature and no log line.
 */
export const COCKROACH_STATES: ReadonlyArray<CockroachState> = COCKROACH_BASES.flatMap((base) =>
  COCKROACH_VIEWS.map((view) => STATE_OF[base][view]),
);

/**
 * The rows warmed the moment a swarm is scheduled: what a roach arriving on the
 * floor immediately draws, in whichever of the three views it happens to face.
 */
export const COCKROACH_SPAWN_STATES: ReadonlyArray<CockroachState> = COCKROACH_VIEWS.flatMap(
  (view) => [STATE_OF.skitter[view], STATE_OF.idle[view]],
);

/**
 * The rows warmed when a roach engages: the lunge, and the pieces it comes apart
 * into.
 *
 * This creature paints well over the threshold the direct-paint fallback is
 * affordable below (`npm run bench:figure-paint`), so every state its AI can
 * enter has to be warmed by something rather than left to a cold paint on the
 * frame it is first drawn. The bite has no telegraph of its own — the roach
 * decides and lunges on the same frame — so acquiring a target is the only lead
 * that exists, and the gore has less than that: all eight pieces are drawn on
 * the one frame a body comes apart.
 */
export const COCKROACH_COMBAT_STATES: ReadonlyArray<string> = [
  ...COCKROACH_VIEWS.map((view) => STATE_OF.bite[view]),
  ...COCKROACH_GORE_PARTS,
];

/** Warms the rows a cockroach about to exist will draw. */
export function prewarmCockroach(): void {
  for (const state of COCKROACH_SPAWN_STATES) prewarmFigureState(COCKROACH_FIGURE, state);
}

/** Warms the lunge and the gore, from the frame a roach notices a crawler. */
export function prewarmCockroachCombat(): void {
  for (const state of COCKROACH_COMBAT_STATES) prewarmFigureState(COCKROACH_FIGURE, state);
}
