import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  ACTION_FRAMES,
  BREAK_FRAMES,
  CAT_FIGURE,
  DANCE_FRAMES,
  IDLE_FRAMES,
  KO_FRAMES,
  WALK_FRAMES,
} from './art/catFigure';
import {
  MAGIC_MISSILE_EXPLOSION_FIGURE,
  MAGIC_MISSILE_PROJECTILE_FIGURE,
} from './art/magicMissileFigure';
import { getMagicMissileVisualTier, type MagicMissileVisualTier } from '../abilities/magicMissile';

export interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  distTraveled: number;
  maxDist: number;
  state: 'flying' | 'exploding';
  explodeTimer: number;
  hit: boolean;
  /** The Magic Missile ability level when this missile was created. */
  abilityLevel: number;
  /** Sub-missiles spawned by level-10 never chain-react further. */
  isSubMissile: boolean;
}

/**
 * Every row `drawCatSprite` can ask the figure for. Written out rather than
 * derived from the figure, because the draw call *clamps* a frame index and
 * skips a state it cannot find: read off the figure, a row that lost its frames
 * or its name would freeze or vanish instead of failing. `scripts/gates-cat.ts`
 * holds this union and the figure's own states equal.
 */
type CatState =
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'look_around'
  | 'groom_paw'
  | 'groom_flank'
  | 'swipe'
  | 'swipe_side'
  | 'swipe_away'
  | 'cast'
  | 'cast_side'
  | 'cast_away'
  | 'knocked_out'
  | 'dance';

/** Which way the sheet's three viewpoints are chosen from a facing vector. */
type CatView = 'front' | 'side' | 'away';

/** Animations that play once and then hand control back to walk/idle. */
export type CatOneShot = 'swipe' | 'cast' | 'dance' | 'look_around' | 'groom_paw' | 'groom_flank';

/** Frames the claw swipe animation covers; `CatPlayer` times its hit window to this. */
export const CAT_SWIPE_FRAMES = 18;
const CAT_CAST_FRAMES = 24;
const CAT_DANCE_FRAMES = 96;
const CAT_LOOK_AROUND_FRAMES = 90;
const CAT_GROOM_FRAMES = 110;

const ONE_SHOT_DURATION: Record<CatOneShot, number> = {
  swipe: CAT_SWIPE_FRAMES,
  cast: CAT_CAST_FRAMES,
  dance: CAT_DANCE_FRAMES,
  look_around: CAT_LOOK_AROUND_FRAMES,
  groom_paw: CAT_GROOM_FRAMES,
  groom_flank: CAT_GROOM_FRAMES,
};

/** Idle breaks are cosmetic; anything else interrupts them the moment it fires. */
const IDLE_BREAKS: readonly CatOneShot[] = ['look_around', 'groom_paw', 'groom_flank'];

/**
 * Animations she abandons as soon as she moves. The level-up dance is in here
 * because a level-up lands mid-fight as often as not, and a cat sliding across
 * the floor in a dance pose looks broken.
 */
const INTERRUPTED_BY_MOVEMENT: readonly CatOneShot[] = [...IDLE_BREAKS, 'dance'];

/**
 * Frames an animation is guaranteed before movement can cut it short. Without
 * it the dance is unreachable art: the follower cat is walking on almost every
 * frame a level-up lands on, so the celebration would be cancelled the tick
 * after it started.
 */
const MOVEMENT_INTERRUPT_GRACE: Partial<Record<CatOneShot, number>> = { dance: 30 };

/** Frames of standing still before she gets bored enough to preen or look around. */
const IDLE_BREAK_MIN_DELAY = 240;
const IDLE_BREAK_RANDOM_DELAY = 420;

/**
 * Frames per row, taken from the choreography that paints them, so the two
 * cannot drift. Exhaustive by construction: a state added to `CatState` without
 * a count here is a compile error.
 */
const FRAME_COUNT: Record<CatState, number> = {
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_away: IDLE_FRAMES,
  look_around: BREAK_FRAMES,
  groom_paw: BREAK_FRAMES,
  groom_flank: BREAK_FRAMES,
  swipe: ACTION_FRAMES,
  swipe_side: ACTION_FRAMES,
  swipe_away: ACTION_FRAMES,
  cast: ACTION_FRAMES,
  cast_side: ACTION_FRAMES,
  cast_away: ACTION_FRAMES,
  knocked_out: KO_FRAMES,
  dance: DANCE_FRAMES,
};

/**
 * Every row she can be drawn in, standing and walking first.
 *
 * All of them, not just the ones she spends her life in. Her fur engine lays
 * down several hundred individual hair strokes per frame, which makes her by
 * some way the most expensive painter in the game — an order of magnitude past
 * the cost at which painting a frame on demand fits inside a frame's slack — so
 * a row that is not warm when she needs it is a dropped frame, not a slightly
 * soft one. The order is the order the queue drains in, so the rows she is
 * drawn in continuously are ready first and the ones she reaches for on a swipe,
 * a cast or a knockout follow behind them.
 */
const PREWARMED_ROWS: ReadonlyArray<CatState> = [
  'idle',
  'idle_side',
  'idle_away',
  'walk',
  'walk_side',
  'walk_away',
  'swipe',
  'swipe_side',
  'swipe_away',
  'cast',
  'cast_side',
  'cast_away',
  'knocked_out',
  'dance',
  'look_around',
  'groom_paw',
  'groom_flank',
];

/** Queues every row Donut can be drawn in for baking. Call once per scene. */
export function prewarmCatSprite(): void {
  for (const state of PREWARMED_ROWS) prewarmFigureState(CAT_FIGURE, state);
}

/** Loop speeds for the animations that are driven by the clock, not by a timer. */
const IDLE_FPS = 6;
const KNOCKED_OUT_FPS = 4;

/** A one-shot in flight, as the renderer needs to see it. */
export interface CatOneShotState {
  readonly action: CatOneShot;
  /** 0 at the first frame of the animation, 1 at the last. */
  readonly progress: number;
}

/**
 * Owns Donut's animation timers: the one-shot currently playing and how long
 * she has been standing around doing nothing, which is what triggers the idle
 * breaks (a look around, a paw wash, a flank wash).
 */
export class CatAnimator {
  private oneShot: CatOneShot | null = null;
  private framesLeft = 0;
  private duration = 1;
  private idleFrames = 0;
  private nextBreakDelay = IDLE_BREAK_MIN_DELAY;

  /** Starts an animation, replacing whatever was playing. */
  play(action: CatOneShot): void {
    this.oneShot = action;
    this.duration = ONE_SHOT_DURATION[action];
    this.framesLeft = this.duration;
    this.idleFrames = 0;
  }

  /** Drops any animation in flight — used when a scene resets combat state. */
  reset(): void {
    this.oneShot = null;
    this.framesLeft = 0;
    this.idleFrames = 0;
    this.nextBreakDelay = IDLE_BREAK_MIN_DELAY;
  }

  /** Advances timers by one frame. Call once per frame, before rendering. */
  tick(isMoving: boolean, isKnockedOut: boolean): void {
    if (isKnockedOut) {
      this.reset();
      return;
    }

    if (this.oneShot !== null) {
      const elapsed = this.duration - this.framesLeft;
      const past = elapsed >= (MOVEMENT_INTERRUPT_GRACE[this.oneShot] ?? 0);
      const interruptedByMovement =
        isMoving && past && INTERRUPTED_BY_MOVEMENT.includes(this.oneShot);
      this.framesLeft--;
      if (this.framesLeft <= 0 || interruptedByMovement) this.oneShot = null;
      return;
    }

    if (isMoving) {
      this.idleFrames = 0;
      return;
    }

    this.idleFrames++;
    if (this.idleFrames < this.nextBreakDelay) return;
    this.nextBreakDelay =
      IDLE_BREAK_MIN_DELAY + Math.floor(Math.random() * IDLE_BREAK_RANDOM_DELAY);
    this.play(IDLE_BREAKS[Math.floor(Math.random() * IDLE_BREAKS.length)]);
  }

  get current(): CatOneShotState | null {
    if (this.oneShot === null) return null;
    const elapsed = this.duration - this.framesLeft;
    return { action: this.oneShot, progress: elapsed / this.duration };
  }
}

/** Everything the cat sprite needs to pick a pose. All fields are optional. */
export interface CatSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  readonly isKnockedOut?: boolean;
  readonly oneShot?: CatOneShotState | null;
}

/** Views split on whichever axis she is facing hardest along. */
function viewFor(facingX: number, facingY: number): CatView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function directionalState(base: 'walk' | 'idle' | 'swipe' | 'cast', view: CatView): CatState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the cat player body.
 *
 * Priority runs downed → combat action → idle break → walk → idle, so a swipe
 * or a cast always wins over whatever she was doing to pass the time.
 */
export function drawCatSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: CatSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 0,
    facingY = 1,
    isKnockedOut = false,
    oneShot = null,
  } = state;
  const view = viewFor(facingX, facingY);
  const facesLeft = facingX < 0;
  // Only the profile art is mirrored: flipping the head-on views would swap the
  // sides of her tortoiseshell coat every time she turned around.
  const flipX = view === 'side' && facesLeft;
  const nowSeconds = performance.now() / 1000;

  if (isKnockedOut) {
    // The downed pose is profile art whichever way she was facing, so it takes
    // the mirror on its own rather than through the view rule above.
    const frame = timeFrameIndex(nowSeconds, KNOCKED_OUT_FPS, FRAME_COUNT.knocked_out);
    drawFigureCached(ctx, CAT_FIGURE, 'knocked_out', frame, sx, sy, s, { flipX: facesLeft });
    return;
  }

  if (oneShot !== null) {
    // The idle breaks and the level-up dance are only drawn head-on; the combat
    // actions have a pose per viewpoint.
    const directional = oneShot.action === 'swipe' || oneShot.action === 'cast';
    const key: CatState = directional ? directionalState(oneShot.action, view) : oneShot.action;
    drawFigureCached(
      ctx,
      CAT_FIGURE,
      key,
      progressFrameIndex(oneShot.progress, FRAME_COUNT[key]),
      sx,
      sy,
      s,
      {
        flipX: directional && flipX,
      },
    );
    return;
  }

  if (isMoving) {
    const key = directionalState('walk', view);
    drawFigureCached(ctx, CAT_FIGURE, key, walkFrameIndex(walkFrame, FRAME_COUNT[key]), sx, sy, s, {
      flipX,
    });
    return;
  }

  const key = directionalState('idle', view);
  drawFigureCached(
    ctx,
    CAT_FIGURE,
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

/** Both missile figures share one set of row names. */
type MissileSpriteVariant = MagicMissileVisualTier | 'sub_missile';

/**
 * The level-10 shrapnel's row. It is not a tier — the shards carry an ability
 * level of 1 so they cannot chain — so it is named here rather than derived
 * from a level.
 */
export const SUB_MISSILE_VARIANT = 'sub_missile';

/**
 * Warms the rows a bolt just launched will draw.
 *
 * A cast is a keypress with no telegraph of its own, so this is the earliest
 * moment anything knows a missile is coming. The bolt itself is drawn on the
 * very next frame and falls back to a direct paint until its row lands; the
 * impact is the row the lead actually buys, because it is a whole flight away
 * and is the more expensive of the two to bake. A level-10 cat's shrapnel is
 * warmed at the same moment for the same reason: its rows are two events away.
 */
export function prewarmMagicMissileCast(level: number, spawnsSubMissiles: boolean): void {
  const tier = getMagicMissileVisualTier(level);
  prewarmFigureState(MAGIC_MISSILE_PROJECTILE_FIGURE, tier);
  prewarmFigureState(MAGIC_MISSILE_EXPLOSION_FIGURE, tier);
  if (!spawnsSubMissiles) return;
  prewarmFigureState(MAGIC_MISSILE_PROJECTILE_FIGURE, SUB_MISSILE_VARIANT);
  prewarmFigureState(MAGIC_MISSILE_EXPLOSION_FIGURE, SUB_MISSILE_VARIANT);
}

/**
 * How fast each tier's bolt cycles its loop. The higher tiers spin faster on
 * purpose: the same braid played at the same rate reads as the same spell with
 * a new palette, and the tempo is half of what sells the escalation.
 */
const MISSILE_ANIM_FPS: Record<MissileSpriteVariant, number> = {
  tier1: 10,
  tier2: 13,
  tier3: 17,
  tier4: 22,
  sub_missile: 17,
};

export function drawMissiles(
  ctx: CanvasRenderingContext2D,
  missiles: Missile[],
  camX: number,
  camY: number,
  s: number,
  EXPLODE_FRAMES: number,
): void {
  const now = performance.now() / 1000;

  for (const m of missiles) {
    const mx = m.x - camX;
    const my = m.y - camY;
    // Sub-missiles carry an ability level of 1 so they cannot chain into more
    // sub-missiles, so their level says nothing about how they should look —
    // both figures give them a row of their own.
    const variant: MissileSpriteVariant = m.isSubMissile
      ? SUB_MISSILE_VARIANT
      : getMagicMissileVisualTier(m.abilityLevel);

    if (m.state === 'flying') {
      const rotation = Math.atan2(m.vy, m.vx);
      const frame = timeFrameIndex(
        now,
        MISSILE_ANIM_FPS[variant],
        figureFrameCount(MAGIC_MISSILE_PROJECTILE_FIGURE, variant),
      );
      drawFigureCached(ctx, MAGIC_MISSILE_PROJECTILE_FIGURE, variant, frame, mx, my, s, {
        rotation,
      });
    } else {
      // Explosion — centered on the missile position.
      const progress = 1 - m.explodeTimer / EXPLODE_FRAMES;
      const frame = progressFrameIndex(
        progress,
        figureFrameCount(MAGIC_MISSILE_EXPLOSION_FIGURE, variant),
      );
      drawFigureCached(ctx, MAGIC_MISSILE_EXPLOSION_FIGURE, variant, frame, mx, my, s);
    }
  }
}
