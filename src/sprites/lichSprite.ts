import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey } from '../core/SpriteLoader';

/**
 * Draw wrapper for The Lich's sheet.
 *
 * Baked by `npm run gen:lich` from `scripts/lichArt.ts`. The row vocabulary is
 * the Skeleton Lord's exactly — `walk`/`idle`/`cast`/`hands_cast` in three views
 * plus a single camera-facing `summon` — so this wrapper's state machine is his,
 * and a creature written against one can be pointed at the other without
 * anything in between having to translate.
 *
 * The helpers are duplicated from `skeletonSprite.ts` rather than shared. They
 * are a handful of lines each, and the alternative is a module both sheets
 * import that quietly becomes the place a future view rule has to be true for
 * two creatures at once — which is how one of them ends up mirroring a row it
 * should not.
 */

/** Loop speed for the idle, which is driven by the clock rather than a timer. */
const IDLE_FPS = 5;

const LICH_KEY = 'the_lich' as const;

/** `BodyPartGoreSystem` registry key, and the sheet the loose bones come off. */
export const LICH_BODY_PART_KEY = 'the_lich';

/** Which of the sheet's three viewpoints a facing vector selects. */
type LichView = 'front' | 'side' | 'away';

/** The looping and one-shot bases that exist in all three views. */
type LichBase = 'walk' | 'idle' | 'cast' | 'hands_cast';

/**
 * How many frames a state actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(state: string): number {
  return getSpriteDefByKey(LICH_KEY)?.states.get(state)?.frameCount ?? 1;
}

/** Views split on whichever axis the Lich is facing hardest along. */
function viewFor(facingX: number, facingY: number): LichView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * Only the profile art is mirrored. Flipping a head-on view would swap the hand
 * the witch-light gathers in every time the creature turned, and the cast
 * telegraph is the whole warning the player gets.
 */
function flipFor(view: LichView, facingX: number): boolean {
  return view === 'side' && facingX < 0;
}

type LichState = `${LichBase}_side` | `${LichBase}_away` | LichBase | 'summon';

function lichState(base: LichBase, view: LichView): LichState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** What The Lich is doing this frame. */
export interface TheLichSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of a soul-bolt cast, 1 at the last; null when not casting. */
  readonly castProgress?: number | null;
  /** 0 to 1 across the grasping-hands wind-up; null when not winding up. */
  readonly handsProgress?: number | null;
  /** 0 to 1 across the summon; null when not summoning. */
  readonly summonProgress?: number | null;
}

function drawOneShot(
  ctx: CanvasRenderingContext2D,
  state: LichState,
  progress: number,
  flipX: boolean,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  drawSpriteKey(
    ctx,
    LICH_KEY,
    state,
    progressFrameIndex(progress, frameCountOf(state)),
    sx,
    sy,
    tileSize,
    { flipX },
  );
}

/**
 * Draw The Lich.
 *
 * Priority runs summon → grasping hands → cast → walk → idle: a committed attack
 * always wins over the drift it interrupted.
 */
export function drawTheLichSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: TheLichSpriteState = {},
): void {
  const { facingX = 1, facingY = 0, walkFrame = 0, isMoving = false } = state;
  const view = viewFor(facingX, facingY);
  const flipX = flipFor(view, facingX);

  const summon = state.summonProgress;
  if (summon !== null && summon !== undefined) {
    // Baked in one facing only — a held, symmetrical, arms-overhead pose is two
    // sleeves on top of each other in profile and a plain robe from behind.
    // Drawn unmirrored whichever way it is turned, because summoning turns the
    // creature to face the party by definition.
    drawOneShot(ctx, 'summon', summon, false, sx, sy, tileSize);
    return;
  }

  const hands = state.handsProgress;
  if (hands !== null && hands !== undefined) {
    drawOneShot(ctx, lichState('hands_cast', view), hands, flipX, sx, sy, tileSize);
    return;
  }

  const cast = state.castProgress;
  if (cast !== null && cast !== undefined) {
    drawOneShot(ctx, lichState('cast', view), cast, flipX, sx, sy, tileSize);
    return;
  }

  if (isMoving) {
    const walk = lichState('walk', view);
    drawSpriteKey(
      ctx,
      LICH_KEY,
      walk,
      walkFrameIndex(walkFrame, frameCountOf(walk)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return;
  }

  // The idle is clock-driven rather than `walkFrame`-driven because `walkFrame`
  // resets to 0 the moment a mob stops, which would freeze every stationary
  // Lich on the same frame of its loop.
  const idle = lichState('idle', view);
  const nowSeconds = performance.now() / 1000;
  drawSpriteKey(
    ctx,
    LICH_KEY,
    idle,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(idle)),
    sx,
    sy,
    tileSize,
    { flipX },
  );
}
