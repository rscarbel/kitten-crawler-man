import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import { LICH_FIGURE } from './art/lichFigure';

/**
 * Draw wrapper for The Lich's sheet.
 *
 * Painted by `LICH_FIGURE` from `art/lichArt.ts` and `art/lichFigure.ts`. The
 * row vocabulary is the Skeleton Lord's exactly — `walk`/`idle`/`cast`/`hands_cast` in three views
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
const MS_PER_SECOND = 1000;

const DAZED_STATE = 'dazed' as const;
/**
 * Slower than the idle. The daze row is the same body barely moving, and the
 * whole point of it is that the creature looks like it has stopped working.
 */
const DAZED_FPS = 3;

/** `BodyPartGoreSystem` registry key, and the art the loose bones come off. */
export const LICH_BODY_PART_KEY = 'the_lich';

/** Which of the sheet's three viewpoints a facing vector selects. */
type LichView = 'front' | 'side' | 'away';

/** The looping and one-shot bases that exist in all three views. */
type LichBase = 'walk' | 'idle' | 'cast' | 'hands_cast';

/**
 * How many frames a state actually holds, read from the figure itself.
 *
 * Not a hand-copied table: the draw call *clamps* the frame index, so a row
 * that got shorter would silently freeze on its last frame rather than throw.
 * There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(state: string): number {
  return figureFrameCount(LICH_FIGURE, state);
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
  /**
   * The spent, grounded vulnerability window. Outranks every other flag: a Lich
   * that is dazed is by definition not mid-cast, and a row that lost to a stale
   * progress value would hide the one moment the player is being told to attack.
   */
  readonly isDazed?: boolean;
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
  drawFigureCached(
    ctx,
    LICH_FIGURE,
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

  if (state.isDazed === true) {
    // Baked camera-facing only, and drawn unmirrored whichever way the creature
    // is turned: the fight parks it at the room centre in front of the party for
    // this, and a slump seen from behind is a robe with nothing happening.
    drawFigureCached(
      ctx,
      LICH_FIGURE,
      DAZED_STATE,
      timeFrameIndex(performance.now() / MS_PER_SECOND, DAZED_FPS, frameCountOf(DAZED_STATE)),
      sx,
      sy,
      tileSize,
    );
    return;
  }

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
    drawFigureCached(
      ctx,
      LICH_FIGURE,
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
  const nowSeconds = performance.now() / MS_PER_SECOND;
  drawFigureCached(
    ctx,
    LICH_FIGURE,
    idle,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(idle)),
    sx,
    sy,
    tileSize,
    { flipX },
  );
}

// ── Prewarm ──────────────────────────────────────────────────────────────────

/**
 * The rows the creature walks and stands in, in every view.
 *
 * Warmed as one set the moment the fight is committed to. A cell of this figure
 * costs several milliseconds to paint — the edge light is a dilation of its own
 * finished alpha, not a stroke — so the direct-paint fallback is not something
 * the frame it first turns a corner on can absorb.
 */
export const LICH_LOCOMOTION_STATES: ReadonlyArray<LichState> = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
];

/**
 * The rows one attack can be drawn in, warmed together when its wind-up starts.
 *
 * All three views of a base rather than the one it currently faces: a wind-up
 * lasts long enough for the player to walk around it, and the frames the cache
 * has to have ready are whichever view it is in when the blow lands. The summon
 * is painted camera-facing only, so it is one row.
 */
const ATTACK_STATES: Readonly<Record<LichAttack, ReadonlyArray<LichState>>> = {
  cast: ['cast', 'cast_side', 'cast_away'],
  hands_cast: ['hands_cast', 'hands_cast_side', 'hands_cast_away'],
  summon: ['summon'],
};

/** The attacks that have rows of their own. */
export type LichAttack = 'cast' | 'hands_cast' | 'summon';

/** Warms the walk and idle rows. Called when the confrontation becomes a fight. */
export function prewarmLichLocomotion(): void {
  for (const state of LICH_LOCOMOTION_STATES) prewarmFigureState(LICH_FIGURE, state);
}

/** Warms one attack's rows. Called on its telegraph, before a frame of it draws. */
export function prewarmLichAttack(attack: LichAttack): void {
  for (const state of ATTACK_STATES[attack]) prewarmFigureState(LICH_FIGURE, state);
}

/**
 * Warms the spent, grounded row.
 *
 * It has no telegraph of its own — the fight decides the Lich is exhausted and
 * the row plays on the next frame — so this is called by the phase that decides
 * it, which is the only warning there is.
 */
export function prewarmLichDazed(): void {
  prewarmFigureState(LICH_FIGURE, DAZED_STATE);
}

/** Every row a prewarm can name, for the gate that checks the figure paints them. */
export const LICH_PREWARMED_STATES: ReadonlyArray<string> = [
  ...LICH_LOCOMOTION_STATES,
  ...ATTACK_STATES.cast,
  ...ATTACK_STATES.hands_cast,
  ...ATTACK_STATES.summon,
  DAZED_STATE,
];
