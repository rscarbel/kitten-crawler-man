import {
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { ACID_LLAMA_FIGURE } from './art/acidLlamaFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/**
 * The three viewpoints the figure paints. There is no fourth: the profile is
 * mirrored for the other direction, and mirroring a head-on view would put the
 * llama's ears and legs on the wrong sides every time it turned around.
 */
type AcidLlamaView = 'front' | 'side' | 'away';

type AcidLlamaBase = 'walk' | 'idle' | 'spit';

/**
 * How many frames a row actually holds, read from the figure that paints it.
 *
 * Not a hand-copied table: `drawFigureCached` *clamps* the frame index, so a row
 * that got shorter would silently freeze on its last frame rather than throw.
 * There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(state: string): number {
  return Math.max(1, figureFrameCount(ACID_LLAMA_FIGURE, state));
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The eight pieces a llama comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side:
 * `src/sprites/art/acidLlamaGore.ts` paints them in this order and
 * `BodyPartGoreSystem` spawns them in it, so a rename in one place is a missing
 * body part rather than a silent no-op.
 */
export const ACID_LLAMA_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_neck',
  'gore_torso',
  'gore_haunch',
  'gore_leg',
  'gore_ribcage',
  'gore_entrails',
  'gore_fleece',
];

/** The `BodyPartGoreSystem` registry key a dead llama's flying pieces come from. */
export const ACID_LLAMA_BODY_PART_KEY = 'acid_llama';

/** Everything the llama sprite needs to pick a pose. All fields are optional. */
export interface AcidLlamaSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of the spit, 1 at the last; null when not spitting. */
  readonly spitProgress?: number | null;
}

/** Views split on whichever axis the llama is facing hardest along. */
function viewFor(facingX: number, facingY: number): AcidLlamaView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: AcidLlamaBase, view: AcidLlamaView): string {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the llama.
 *
 * Priority runs spit → walk → idle, so a spit always wins over the pace it
 * interrupts.
 */
export function drawAcidLlamaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: AcidLlamaSpriteState = {},
): void {
  const { walkFrame = 0, isMoving = false, facingX = 1, facingY = 0, spitProgress = null } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put the
  // llama's ears and legs on the wrong sides every time it turned around.
  const flipX = view === 'side' && facingX < 0;

  if (spitProgress !== null) {
    const key = stateFor('spit', view);
    drawFigureCached(
      ctx,
      ACID_LLAMA_FIGURE,
      key,
      progressFrameIndex(spitProgress, frameCountOf(key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      ACID_LLAMA_FIGURE,
      key,
      walkFrameIndex(walkFrame, frameCountOf(key)),
      sx,
      sy,
      s,
      {
        flipX,
      },
    );
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  drawFigureCached(
    ctx,
    ACID_LLAMA_FIGURE,
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(key)),
    sx,
    sy,
    s,
    { flipX },
  );
}

const ACID_LLAMA_BASES: ReadonlyArray<AcidLlamaBase> = ['walk', 'idle', 'spit'];
const ACID_LLAMA_VIEWS: ReadonlyArray<AcidLlamaView> = ['front', 'side', 'away'];

/**
 * Every state `drawAcidLlamaSprite` can ask the figure for.
 *
 * Built from the same two tables `stateFor` composes rather than listed by hand,
 * so a view or a base added to one is present in the other. The art gates feed
 * this to `missingStateFailures`: both draw paths return silently on a state the
 * figure does not paint, so a name only the runtime knows is an invisible
 * creature and no log line.
 */
export const ACID_LLAMA_STATES: ReadonlyArray<string> = ACID_LLAMA_BASES.flatMap((base) =>
  ACID_LLAMA_VIEWS.map((view) => stateFor(base, view)),
);

/**
 * The rows warmed when a llama's spawn is scheduled.
 *
 * A llama that has just been placed on a floor stands and paces, in whichever of
 * the three views it happens to face, and those six rows are what the first
 * seconds of an encounter draw. The spit rows are warmed separately, off the
 * telegraph that precedes them, because a llama the party never walks up to
 * never plays them.
 */
export const ACID_LLAMA_PREWARMED_STATES: ReadonlyArray<string> = ACID_LLAMA_VIEWS.flatMap(
  (view) => [stateFor('idle', view), stateFor('walk', view)],
);

/** The three spit rows, warmed when the animal first lines a target up. */
export const ACID_LLAMA_SPIT_STATES: ReadonlyArray<string> = ACID_LLAMA_VIEWS.map((view) =>
  stateFor('spit', view),
);

/**
 * Warms the rows a llama about to exist will draw.
 *
 * Called where a spawn is *scheduled* rather than where the mob first renders: a
 * room's worth arriving on one frame is a row of cold cells if the first request
 * for them is the frame they appear on.
 */
export function prewarmAcidLlama(): void {
  for (const state of ACID_LLAMA_PREWARMED_STATES) prewarmFigureState(ACID_LLAMA_FIGURE, state);
}

/** Warms the spit rows, off the wind-up that precedes the first one. */
export function prewarmAcidLlamaSpit(): void {
  for (const state of ACID_LLAMA_SPIT_STATES) prewarmFigureState(ACID_LLAMA_FIGURE, state);
}

/** Warms the gore pieces, which are all requested the frame a llama comes apart. */
export function prewarmAcidLlamaGore(): void {
  for (const part of ACID_LLAMA_GORE_PARTS) prewarmFigureState(ACID_LLAMA_FIGURE, part);
}
