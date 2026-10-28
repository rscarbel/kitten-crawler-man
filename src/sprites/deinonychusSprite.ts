import {
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, drawFigureFitted, prewarmFigureState } from './figure/figureFrameCache';
import { DEINONYCHUS_FIGURES } from './art/deinonychusFigure';
import {
  DEINONYCHUS_BITE_FRAMES,
  DEINONYCHUS_COLLAPSE_FRAMES,
  DEINONYCHUS_FLAP_FRAMES,
  DEINONYCHUS_HAPPY_JUMP_FRAMES,
  DEINONYCHUS_POUNCE_FRAMES,
  DEINONYCHUS_SLASH_FRAMES,
  deinonychusActionFrames,
} from './deinonychusAttackTiming';

/**
 * Deinonychus's runtime sprite wrapper.
 *
 * He is three figures rather than one — one per growth stage, chosen by his pet
 * level — and every one of them paints the same sixteen rows, so growing up is
 * a figure swap and nothing else.
 */
export type DeinonychusStage = 'juvenile' | 'adolescent' | 'adult';

/** Which of the sheet's three viewpoints a facing vector selects. */
type DeinonychusView = 'front' | 'side' | 'away';

/**
 * The three figures paint one row table, so their state names and frame counts
 * are identical and one map serves all of them. Written out rather than derived
 * so that a row the figure stops painting is a compile error here.
 */
type DeinonychusState =
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'bite'
  | 'bite_side'
  | 'bite_away'
  | 'slash'
  | 'slash_side'
  | 'slash_away'
  | 'pounce'
  | 'pounce_side'
  | 'pounce_away'
  | 'collapse'
  | 'happy_jump'
  | 'happy_jump_side'
  | 'happy_jump_away'
  | 'flap'
  | 'flap_side'
  | 'flap_away';

/** Sprite frames in one full stride of any walk row. */
export const DEINONYCHUS_WALK_FRAMES = 8;

/**
 * The rate above which the walk row stops being played and starts being
 * undersampled — one whole sprite frame per game tick.
 *
 * Past it, frames are skipped and the legs jump between non-adjacent poses,
 * which reads as vibrating. The runtime's cadence ceiling is derived against
 * this rather than against a number someone has to remember.
 */
export const DEINONYCHUS_UNDERSAMPLING_FRAME_LIMIT = 1;
const DEINONYCHUS_IDLE_FRAMES = 8;

const FRAME_COUNT: Record<DeinonychusState, number> = {
  idle: DEINONYCHUS_IDLE_FRAMES,
  idle_side: DEINONYCHUS_IDLE_FRAMES,
  idle_away: DEINONYCHUS_IDLE_FRAMES,
  walk: DEINONYCHUS_WALK_FRAMES,
  walk_side: DEINONYCHUS_WALK_FRAMES,
  walk_away: DEINONYCHUS_WALK_FRAMES,
  bite: DEINONYCHUS_BITE_FRAMES,
  bite_side: DEINONYCHUS_BITE_FRAMES,
  bite_away: DEINONYCHUS_BITE_FRAMES,
  slash: DEINONYCHUS_SLASH_FRAMES,
  slash_side: DEINONYCHUS_SLASH_FRAMES,
  slash_away: DEINONYCHUS_SLASH_FRAMES,
  pounce: DEINONYCHUS_POUNCE_FRAMES,
  pounce_side: DEINONYCHUS_POUNCE_FRAMES,
  pounce_away: DEINONYCHUS_POUNCE_FRAMES,
  collapse: DEINONYCHUS_COLLAPSE_FRAMES,
  happy_jump: DEINONYCHUS_HAPPY_JUMP_FRAMES,
  happy_jump_side: DEINONYCHUS_HAPPY_JUMP_FRAMES,
  happy_jump_away: DEINONYCHUS_HAPPY_JUMP_FRAMES,
  flap: DEINONYCHUS_FLAP_FRAMES,
  flap_side: DEINONYCHUS_FLAP_FRAMES,
  flap_away: DEINONYCHUS_FLAP_FRAMES,
};

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 7;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * How much ground one walk cycle covers, per stage, in tiles.
 *
 * *Measured* off the choreography by the `G13` gate, which reads these back out
 * of this file — they are a record of the art, and hand-tuning one makes the
 * gate lie about the figure it is guarding.
 *
 * The runtime paces his legs by these: one cycle per this much ground actually
 * covered, so a planted foot stays planted at any speed. The stride is long
 * enough that his listed speeds land well under the undersampling limit; the
 * one exception is the recall sprint on the juvenile, where the ceiling binds
 * and his feet slide a little rather than strobe.
 */
export const DEINONYCHUS_TILES_PER_WALK_CYCLE: Record<DeinonychusStage, number> = {
  juvenile: 0.6602,
  adolescent: 0.969,
  adult: 1.1351,
};

/** Walk-cycle radians advanced per pixel of ground covered, at a given tile size. */
export function deinonychusWalkRadiansPerPixel(stage: DeinonychusStage, tileSize: number): number {
  return (Math.PI * 2) / (DEINONYCHUS_TILES_PER_WALK_CYCLE[stage] * tileSize);
}

/**
 * The fastest the walk cycle may advance in one game tick, in radians — one
 * sprite frame per tick, past which the row is undersampled into a strobe.
 */
export const DEINONYCHUS_MAX_WALK_RADIANS_PER_TICK =
  (Math.PI * 2 * DEINONYCHUS_UNDERSAMPLING_FRAME_LIMIT) / DEINONYCHUS_WALK_FRAMES;

/**
 * How far above his tile's top edge each stage's standing art reaches, in tiles.
 *
 * Deinonychus is drawn much taller than the tile he stands on, so his health bar has
 * to be lifted by his own headroom or it is painted across his back. Verified
 * against the baked idle row by the `G-CLEARANCE` bake gate, because a redraw
 * moves this and nothing downstream can tell that it has.
 */
export const DEINONYCHUS_HEAD_CLEARANCE_TILES: Record<DeinonychusStage, number> = {
  juvenile: 0,
  adolescent: 0,
  adult: 0.125,
};

/** The one-shot rows, and how many sprite frames each holds. */
export type DeinonychusAction = 'bite' | 'slash' | 'pounce' | 'collapse' | 'happy_jump' | 'flap';

const ACTION_SPRITE_FRAMES: Record<DeinonychusAction, number> = {
  bite: DEINONYCHUS_BITE_FRAMES,
  slash: DEINONYCHUS_SLASH_FRAMES,
  pounce: DEINONYCHUS_POUNCE_FRAMES,
  collapse: DEINONYCHUS_COLLAPSE_FRAMES,
  happy_jump: DEINONYCHUS_HAPPY_JUMP_FRAMES,
  flap: DEINONYCHUS_FLAP_FRAMES,
};

/** Game frames a given one-shot runs for. */
export function deinonychusActionDuration(action: DeinonychusAction): number {
  return deinonychusActionFrames(ACTION_SPRITE_FRAMES[action]);
}

/**
 * A one-shot state machine over the attack rows.
 *
 * Kept out of `Deinonychus` itself so the preview scene can drive the same playback
 * the game does, rather than a second implementation of it that drifts.
 */
export class DeinonychusAnimator {
  private action: DeinonychusAction | null = null;
  private framesLeft = 0;
  private duration = 0;

  /** Starts a one-shot, replacing whatever was playing. */
  play(action: DeinonychusAction): void {
    this.action = action;
    this.duration = deinonychusActionDuration(action);
    this.framesLeft = this.duration;
  }

  /** Advance one game frame. */
  tick(): void {
    if (this.framesLeft === 0) return;
    this.framesLeft--;
    if (this.framesLeft === 0) this.action = null;
  }

  cancel(): void {
    this.action = null;
    this.framesLeft = 0;
  }

  get isPlaying(): boolean {
    return this.action !== null;
  }

  get currentAction(): DeinonychusAction | null {
    return this.action;
  }

  /** 0 at the first frame of the one-shot, approaching 1 at the last. */
  get progress(): number {
    if (this.action === null || this.duration === 0) return 0;
    return (this.duration - this.framesLeft) / this.duration;
  }
}

/**
 * The rows Deinonychus is about to need, warmed a few frames ahead of needing them.
 *
 * His painter costs well over the threshold a direct fallback paint is
 * affordable at, so every state his AI can enter is warmed from the moment it
 * becomes reachable rather than being paid for as a hitch on the frame it is
 * first drawn. There are two such moments and they are the two functions here:
 * he arrives on the floor, and he picks a fight.
 *
 * All three views each time, because he turns.
 */
export function prewarmDeinonychusWalk(stage: DeinonychusStage): void {
  const figure = DEINONYCHUS_FIGURES[stage];
  for (const state of ARRIVAL_STATES) prewarmFigureState(figure, state);
}

/** The attack rows, warmed when he first commits to a target. */
export function prewarmDeinonychusCombat(stage: DeinonychusStage): void {
  const figure = DEINONYCHUS_FIGURES[stage];
  for (const state of COMBAT_STATES) prewarmFigureState(figure, state);
}

/** The happy-jump/flap rows, warmed the moment a pet press becomes reachable. */
export function prewarmDeinonychusPet(stage: DeinonychusStage): void {
  const figure = DEINONYCHUS_FIGURES[stage];
  for (const state of PET_STATES) prewarmFigureState(figure, state);
}

const ARRIVAL_STATES: readonly DeinonychusState[] = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
];

const COMBAT_STATES: readonly DeinonychusState[] = [
  'bite',
  'bite_side',
  'bite_away',
  'slash',
  'slash_side',
  'slash_away',
  'pounce',
  'pounce_side',
  'pounce_away',
  'collapse',
];

const PET_STATES: readonly DeinonychusState[] = [
  'happy_jump',
  'happy_jump_side',
  'happy_jump_away',
  'flap',
  'flap_side',
  'flap_away',
];

/** Views split on whichever axis Deinonychus is facing hardest along. */
function viewFor(facingX: number, facingY: number): DeinonychusView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(
  base: 'walk' | 'idle' | 'bite' | 'slash' | 'pounce' | 'happy_jump' | 'flap',
  view: DeinonychusView,
): DeinonychusState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

export interface DeinonychusSpriteState {
  readonly stage: DeinonychusStage;
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  readonly action?: DeinonychusAction | null;
  /** 0 at the first frame of the one-shot, 1 at the last. */
  readonly actionProgress?: number;
  /** Fade applied during the recall despawn. */
  readonly alpha?: number;
  /**
   * Overrides the idle loop's frame.
   *
   * The idle is normally driven by the wall clock so that two Deinonychus on screen
   * do not breathe in lockstep. The preview harness has to be able to pause and
   * step it, and a row that ignores the harness's own clock is a row nobody can
   * step through.
   */
  readonly idleFrame?: number;
}

/**
 * Draw Deinonychus.
 *
 * Priority runs one-shot → walk → idle, so an attack always wins over the run
 * it interrupts.
 */
export function drawDeinonychusSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: DeinonychusSpriteState,
): void {
  const {
    stage,
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    action = null,
    actionProgress = 0,
    alpha,
  } = state;
  const figure = DEINONYCHUS_FIGURES[stage];
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put his
  // eyes and feet on the wrong sides every time he turned around.
  const flipX = view === 'side' && facingX < 0;
  const opts = { flipX, alpha };

  if (action === 'collapse') {
    // Only ever painted in profile — he collapses once, at zero HP, and a
    // second and third view of a moment that plays for half a second is not
    // worth choreographing on all three stages.
    drawFigureCached(
      ctx,
      figure,
      'collapse',
      progressFrameIndex(actionProgress, FRAME_COUNT.collapse),
      sx,
      sy,
      tileSize,
      { flipX: facingX < 0, alpha },
    );
    return;
  }

  if (action !== null) {
    const key = stateFor(action, view);
    drawFigureCached(
      ctx,
      figure,
      key,
      progressFrameIndex(actionProgress, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      figure,
      key,
      walkFrameIndex(walkFrame, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  drawFigureCached(
    ctx,
    figure,
    key,
    state.idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    tileSize,
    opts,
  );
}

/**
 * Small centred icon for the summon button, the Abilities tab and the reward
 * dialog, fitted inside the `size` square at every growth stage. Uses the
 * profile idle, which is the pose he is most recognisable in.
 */
export function drawDeinonychusIcon(
  ctx: CanvasRenderingContext2D,
  stage: DeinonychusStage,
  cx: number,
  cy: number,
  size: number,
): void {
  const box = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
  drawFigureFitted(ctx, DEINONYCHUS_FIGURES[stage], 'idle_side', 0, box);
}
