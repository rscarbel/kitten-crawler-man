import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { MONGO_FIGURES } from './art/mongoFigure';
import {
  MONGO_BITE_FRAMES,
  MONGO_COLLAPSE_FRAMES,
  MONGO_POUNCE_FRAMES,
  MONGO_SLASH_FRAMES,
  mongoActionFrames,
} from './mongoAttackTiming';

/**
 * Mongo's runtime sprite wrapper.
 *
 * He is three figures rather than one — one per growth stage, chosen by his pet
 * level — and every one of them paints the same sixteen rows, so growing up is
 * a figure swap and nothing else.
 */
export type MongoStage = 'juvenile' | 'adolescent' | 'adult';

/** Which of the sheet's three viewpoints a facing vector selects. */
type MongoView = 'front' | 'side' | 'away';

/**
 * The three figures paint one row table, so their state names and frame counts
 * are identical and one map serves all of them. Written out rather than derived
 * so that a row the figure stops painting is a compile error here.
 */
type MongoState =
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
  | 'collapse';

/** Sprite frames in one full stride of any walk row. */
export const MONGO_WALK_FRAMES = 8;

/**
 * Sprite frames of the walk row advanced per game tick when Mongo runs at his
 * own stage's listed speed. Everything faster or slower scales from here.
 *
 * A half holds every frame for two ticks, giving a 30 fps gait inside a 60 fps
 * loop — the same "hold each frame" cadence `MONGO_FRAME_HOLD` gives the attack
 * rows. Past 1.0 the row is undersampled rather than played: frames are skipped,
 * the legs jump between non-adjacent poses, and he reads as vibrating.
 *
 * Lives here rather than on `Mongo` so the preview harness plays the gait that
 * ships. It previously kept its own slower number, which is why the strobe was
 * invisible in every review of the art.
 */
export const MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED = 0.5;

/**
 * The rate above which the walk row stops being played and starts being
 * undersampled — one whole sprite frame per game tick.
 *
 * Exported so the cadence ceiling can be derived against it rather than against
 * a number someone has to remember. Every cadence in the runtime must stay under
 * this; past it, frames are skipped and the legs jump between non-adjacent poses.
 */
export const MONGO_UNDERSAMPLING_FRAME_LIMIT = 1;
const MONGO_IDLE_FRAMES = 8;

const FRAME_COUNT: Record<MongoState, number> = {
  idle: MONGO_IDLE_FRAMES,
  idle_side: MONGO_IDLE_FRAMES,
  idle_away: MONGO_IDLE_FRAMES,
  walk: MONGO_WALK_FRAMES,
  walk_side: MONGO_WALK_FRAMES,
  walk_away: MONGO_WALK_FRAMES,
  bite: MONGO_BITE_FRAMES,
  bite_side: MONGO_BITE_FRAMES,
  bite_away: MONGO_BITE_FRAMES,
  slash: MONGO_SLASH_FRAMES,
  slash_side: MONGO_SLASH_FRAMES,
  slash_away: MONGO_SLASH_FRAMES,
  pounce: MONGO_POUNCE_FRAMES,
  pounce_side: MONGO_POUNCE_FRAMES,
  pounce_away: MONGO_POUNCE_FRAMES,
  collapse: MONGO_COLLAPSE_FRAMES,
};

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 7;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * How much ground one walk cycle covers, per stage, in tiles.
 *
 * *Measured* off the baked choreography by the `G13` bake gate, which reads
 * these back out of this file — they are a record of the art, and hand-tuning
 * one makes the gate lie about the sheet it is guarding.
 *
 * Deliberately not consumed by the runtime, which sets its cadence from speed
 * instead. Advancing the phase by ground covered is the correct way to keep feet
 * planted, and it is unreachable here: these strides are bounded by leg length,
 * his speed is not, and the honest cadence they imply is roughly twelve cycles a
 * second — an eight-frame row asked to play at ninety frames a second on a
 * sixty-frame display, which undersamples into a strobe. See `Mongo.walkAt`.
 */
export const MONGO_TILES_PER_WALK_CYCLE: Record<MongoStage, number> = {
  juvenile: 0.31,
  adolescent: 0.455,
  adult: 0.533,
};

/**
 * How far above his tile's top edge each stage's standing art reaches, in tiles.
 *
 * Mongo is drawn much taller than the tile he stands on, so his health bar has
 * to be lifted by his own headroom or it is painted across his back. Verified
 * against the baked idle row by the `G-CLEARANCE` bake gate, because a redraw
 * moves this and nothing downstream can tell that it has.
 */
export const MONGO_HEAD_CLEARANCE_TILES: Record<MongoStage, number> = {
  juvenile: 0,
  adolescent: 0,
  adult: 0.172,
};

/** The one-shot rows, and how many sprite frames each holds. */
export type MongoAction = 'bite' | 'slash' | 'pounce' | 'collapse';

const ACTION_SPRITE_FRAMES: Record<MongoAction, number> = {
  bite: MONGO_BITE_FRAMES,
  slash: MONGO_SLASH_FRAMES,
  pounce: MONGO_POUNCE_FRAMES,
  collapse: MONGO_COLLAPSE_FRAMES,
};

/** Game frames a given one-shot runs for. */
export function mongoActionDuration(action: MongoAction): number {
  return mongoActionFrames(ACTION_SPRITE_FRAMES[action]);
}

/**
 * A one-shot state machine over the attack rows.
 *
 * Kept out of `Mongo` itself so the preview scene can drive the same playback
 * the game does, rather than a second implementation of it that drifts.
 */
export class MongoAnimator {
  private action: MongoAction | null = null;
  private framesLeft = 0;
  private duration = 0;

  /** Starts a one-shot, replacing whatever was playing. */
  play(action: MongoAction): void {
    this.action = action;
    this.duration = mongoActionDuration(action);
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

  get currentAction(): MongoAction | null {
    return this.action;
  }

  /** 0 at the first frame of the one-shot, approaching 1 at the last. */
  get progress(): number {
    if (this.action === null || this.duration === 0) return 0;
    return (this.duration - this.framesLeft) / this.duration;
  }
}

/**
 * The rows Mongo is about to need, warmed a few frames ahead of needing them.
 *
 * His painter costs well over the threshold a direct fallback paint is
 * affordable at, so every state his AI can enter is warmed from the moment it
 * becomes reachable rather than being paid for as a hitch on the frame it is
 * first drawn. There are two such moments and they are the two functions here:
 * he arrives on the floor, and he picks a fight.
 *
 * All three views each time, because he turns.
 */
export function prewarmMongoWalk(stage: MongoStage): void {
  const figure = MONGO_FIGURES[stage];
  for (const state of ARRIVAL_STATES) prewarmFigureState(figure, state);
}

/** The attack rows, warmed when he first commits to a target. */
export function prewarmMongoCombat(stage: MongoStage): void {
  const figure = MONGO_FIGURES[stage];
  for (const state of COMBAT_STATES) prewarmFigureState(figure, state);
}

const ARRIVAL_STATES: readonly MongoState[] = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
];

const COMBAT_STATES: readonly MongoState[] = [
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

/** Views split on whichever axis Mongo is facing hardest along. */
function viewFor(facingX: number, facingY: number): MongoView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(
  base: 'walk' | 'idle' | 'bite' | 'slash' | 'pounce',
  view: MongoView,
): MongoState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

export interface MongoSpriteState {
  readonly stage: MongoStage;
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  readonly action?: MongoAction | null;
  /** 0 at the first frame of the one-shot, 1 at the last. */
  readonly actionProgress?: number;
  /** Fade applied during the recall despawn. */
  readonly alpha?: number;
  /**
   * Overrides the idle loop's frame.
   *
   * The idle is normally driven by the wall clock so that two Mongos on screen
   * do not breathe in lockstep. The preview harness has to be able to pause and
   * step it, and a row that ignores the harness's own clock is a row nobody can
   * step through.
   */
  readonly idleFrame?: number;
}

/**
 * Draw Mongo.
 *
 * Priority runs one-shot → walk → idle, so an attack always wins over the run
 * it interrupts.
 */
export function drawMongoSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: MongoSpriteState,
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
  const figure = MONGO_FIGURES[stage];
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
 * dialog. Uses the profile idle, which is the pose he is most recognisable in.
 */
export function drawMongoIcon(
  ctx: CanvasRenderingContext2D,
  stage: MongoStage,
  cx: number,
  cy: number,
  size: number,
): void {
  drawFigureCached(ctx, MONGO_FIGURES[stage], 'idle_side', 0, cx - size / 2, cy - size / 2, size);
}
