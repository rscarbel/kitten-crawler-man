import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';
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

type CatState = SpriteStates['cat'];

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

const FRAME_COUNT: Record<CatState, number> = {
  walk: 8,
  walk_side: 8,
  walk_away: 8,
  idle: 8,
  idle_side: 8,
  idle_away: 8,
  look_around: 12,
  groom_paw: 12,
  groom_flank: 12,
  swipe: 8,
  swipe_side: 8,
  swipe_away: 8,
  cast: 8,
  cast_side: 8,
  cast_away: 8,
  knocked_out: 8,
  dance: 12,
};

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
    drawSpriteKey(ctx, 'cat', 'knocked_out', frame, sx, sy, s, { flipX: facesLeft });
    return;
  }

  if (oneShot !== null) {
    // The idle breaks and the level-up dance are only drawn head-on; the combat
    // actions have a pose per viewpoint.
    const directional = oneShot.action === 'swipe' || oneShot.action === 'cast';
    const key: CatState = directional ? directionalState(oneShot.action, view) : oneShot.action;
    drawSpriteKey(
      ctx,
      'cat',
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
    drawSpriteKey(ctx, 'cat', key, walkFrameIndex(walkFrame, FRAME_COUNT[key]), sx, sy, s, {
      flipX,
    });
    return;
  }

  const key = directionalState('idle', view);
  drawSpriteKey(
    ctx,
    'cat',
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

/** Frames baked per row by `scripts/generate-magic-missile-sprites.ts`. */
const MISSILE_PROJECTILE_FRAMES = 8;
const MISSILE_EXPLOSION_FRAMES = 10;

/** Both missile sheets share one set of row names. */
type MissileSpriteVariant = MagicMissileVisualTier | 'sub_missile';

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
    // both sheets give them a row of their own.
    const variant: MissileSpriteVariant = m.isSubMissile
      ? 'sub_missile'
      : getMagicMissileVisualTier(m.abilityLevel);

    if (m.state === 'flying') {
      const rotation = Math.atan2(m.vy, m.vx);
      const frame = timeFrameIndex(now, MISSILE_ANIM_FPS[variant], MISSILE_PROJECTILE_FRAMES);
      drawSpriteKey(ctx, 'magic_missile_projectile', variant, frame, mx, my, s, { rotation });
    } else {
      // Explosion — centered on the missile position.
      const progress = 1 - m.explodeTimer / EXPLODE_FRAMES;
      const frame = progressFrameIndex(progress, MISSILE_EXPLOSION_FRAMES);
      drawSpriteKey(ctx, 'magic_missile_explosion', variant, frame, mx, my, s);
    }
  }
}
