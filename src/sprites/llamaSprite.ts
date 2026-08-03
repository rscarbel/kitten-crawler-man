import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type LlamaState = SpriteStates['llama'];

/** Which of the sheet's three viewpoints a facing vector selects. */
type LlamaView = 'front' | 'side' | 'away';

/**
 * How many frames a row actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(state: LlamaState): number {
  return getSpriteDefByKey('llama')?.states.get(state)?.frameCount ?? 1;
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 6;

/**
 * The eight pieces a llama comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/llamaGore.ts`
 * paints them in this order and `BodyPartGoreSystem` spawns them in it, so a
 * rename in one place is a missing body part rather than a silent no-op.
 */
export const LLAMA_GORE_PARTS: ReadonlyArray<string> = [
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
export const LLAMA_BODY_PART_KEY = 'llama';

/** Everything the llama sprite needs to pick a pose. All fields are optional. */
export interface LlamaSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of the spit, 1 at the last; null when not spitting. */
  readonly spitProgress?: number | null;
}

/** Views split on whichever axis the llama is facing hardest along. */
function viewFor(facingX: number, facingY: number): LlamaView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: 'walk' | 'idle' | 'spit', view: LlamaView): LlamaState {
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
export function drawLlamaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: LlamaSpriteState = {},
): void {
  const { walkFrame = 0, isMoving = false, facingX = 1, facingY = 0, spitProgress = null } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put the
  // llama's ears and legs on the wrong sides every time it turned around.
  const flipX = view === 'side' && facingX < 0;

  if (spitProgress !== null) {
    const key = stateFor('spit', view);
    drawSpriteKey(
      ctx,
      'llama',
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
    drawSpriteKey(ctx, 'llama', key, walkFrameIndex(walkFrame, frameCountOf(key)), sx, sy, s, {
      flipX,
    });
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / 1000;
  drawSpriteKey(
    ctx,
    'llama',
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(key)),
    sx,
    sy,
    s,
    {
      flipX,
    },
  );
}
