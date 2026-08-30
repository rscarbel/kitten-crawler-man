import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import {
  TONGUE_FRAMES,
  TONGUE_STATE,
  TROGLODYTE_FIGURE,
  TROGLODYTE_TONGUE_FIGURE,
} from './art/troglodyteFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  TILE_CENTRE_FRACTION,
  TROGLODYTE_LASH_MOUTH_ANCHORS,
  TROGLODYTE_MOUTH_ANCHORS,
  TROGLODYTE_TONGUE_ART_REACH_TILES,
  TROGLODYTE_TONGUE_HIT_REACH_TILES,
  type TileFraction,
  type TroglodyteView,
} from './troglodyteTongue';

/**
 * The nine pieces a troglodyte comes apart into, in the order
 * `BodyPartGoreSystem` spawns them.
 *
 * `trogGore.ts` builds them in this same order and the figure declares one
 * state per piece; an art gate holds the two lists equal, because the gore
 * system silently skips a state it cannot find.
 */
export const TROGLODYTE_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_torso',
  'gore_arm',
  'gore_leg',
  'gore_ribcage',
  'gore_entrails',
  'gore_crest',
  'gore_tongue',
  'gore_tail',
];

/** The `BodyPartGoreSystem` registry key a dead troglodyte's pieces come from. */
export const TROGLODYTE_BODY_PART_KEY = 'troglodyte';

type TrogBase = 'idle' | 'walk' | 'gape' | 'lash';

type TrogState =
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'gape'
  | 'gape_side'
  | 'gape_away'
  | 'lash'
  | 'lash_side'
  | 'lash_away';

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

/** The head-on idles carry the head's sweep and run longer than the profile's. */
const FACING_IDLE_FRAMES = 14;
const SIDE_IDLE_FRAMES = 8;
const WALK_FRAMES = 12;
const GAPE_FRAMES = 6;
const LASH_FRAMES = 8;

/**
 * Exhaustive by construction: a state added to the union but not to this map is
 * a compile error, which is safer than reading the count off the figure —
 * `drawFigureCached` *clamps* the frame index, so a row that got shorter would
 * silently freeze on its last frame instead of failing.
 */
const FRAME_COUNT: Record<TrogState, number> = {
  idle: FACING_IDLE_FRAMES,
  idle_side: SIDE_IDLE_FRAMES,
  idle_away: FACING_IDLE_FRAMES,
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  gape: GAPE_FRAMES,
  gape_side: GAPE_FRAMES,
  gape_away: GAPE_FRAMES,
  lash: LASH_FRAMES,
  lash_side: LASH_FRAMES,
  lash_away: LASH_FRAMES,
};

/**
 * The mouth's position for a given frame of the lash, falling back to the
 * single resting anchor when the creature is not mid-strike (the windup, where
 * the tongue is stowed anyway).
 */
function lashAnchorFor(view: TroglodyteView, lashFrame: number | null): TileFraction {
  if (lashFrame === null) return TROGLODYTE_MOUTH_ANCHORS[view];
  const frames = TROGLODYTE_LASH_MOUTH_ANCHORS[view];
  return frames[lashFrame] ?? TROGLODYTE_MOUTH_ANCHORS[view];
}

/** Views split on whichever axis the creature is facing hardest along. */
function viewFor(facingX: number, facingY: number): TroglodyteView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: TrogBase, view: TroglodyteView): TrogState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the troglodyte sprite needs to pick a pose. All fields optional. */
export interface TroglodyteSpriteState {
  /** The walk cycle angle from `Mob.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through the jaw-opening windup; 0 when it is not winding up. */
  readonly gapeProgress?: number;
  /** 0–1 through the strike, monotonic; null when it is not striking. */
  readonly strikeProgress?: number | null;
  /** 0–1 tongue extension, which rises and then falls back over the strike. */
  readonly tongueExtend?: number;
  /**
   * Overrides the idle loop's frame.
   *
   * The idle is normally driven by the wall clock so that two troglodytes in
   * one den do not breathe in lockstep. The preview harness has to be able to
   * pause and step it, and a row that ignores the harness's own clock is a row
   * nobody can step through.
   */
  readonly idleFrame?: number;
}

/**
 * Draw the troglodyte, and its tongue when the tongue is out.
 *
 * Priority runs strike → windup → walk → idle, so a committed strike always
 * wins over the approach it interrupted.
 */
export function drawTroglodyteSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: TroglodyteSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    gapeProgress = 0,
    strikeProgress = null,
    tongueExtend = 0,
  } = state;

  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put its
  // eyes and feet on the wrong sides every time it turned around.
  const flipX = view === 'side' && facingX < 0;
  const opts = { flipX };

  // Away from the camera the mouth is behind the skull, so the tongue has to be
  // painted before the body or it lies across the back of the creature's head.
  const tongueBehind = view === 'away';
  // Which frame of the lash the *body* is on. The tongue's own extension runs
  // on a different clock, but it is the body that says where the head — and so
  // the mouth the tongue leaves from — currently is.
  const lashKey = stateFor('lash', view);
  const lashFrame =
    strikeProgress === null ? null : progressFrameIndex(strikeProgress, FRAME_COUNT[lashKey]);
  if (tongueBehind) {
    drawTongue(ctx, sx, sy, tileSize, view, flipX, tongueExtend, facingX, facingY, lashFrame);
  }

  if (strikeProgress !== null) {
    drawFigureCached(ctx, TROGLODYTE_FIGURE, lashKey, lashFrame ?? 0, sx, sy, tileSize, opts);
  } else if (gapeProgress > 0) {
    const key = stateFor('gape', view);
    drawFigureCached(
      ctx,
      TROGLODYTE_FIGURE,
      key,
      progressFrameIndex(gapeProgress, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
  } else if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      TROGLODYTE_FIGURE,
      key,
      walkFrameIndex(walkFrame, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
  } else {
    const key = stateFor('idle', view);
    const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
    // Clock-driven rather than timer-driven so that two troglodytes in the same
    // den do not breathe in lockstep.
    drawFigureCached(
      ctx,
      TROGLODYTE_FIGURE,
      key,
      state.idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
  }

  if (!tongueBehind) {
    drawTongue(ctx, sx, sy, tileSize, view, flipX, tongueExtend, facingX, facingY, lashFrame);
  }
}

/**
 * The tongue overlay: its own figure, anchored at the mouth and rotated toward
 * whatever the creature is striking at.
 *
 * It is not painted into the body's cells because it reaches three tiles —
 * twenty times the creature's own width — and every one of the body's twelve
 * pose rows would have had to pay for the cell size that needs.
 */
function drawTongue(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  view: TroglodyteView,
  flipX: boolean,
  extend: number,
  facingX: number,
  facingY: number,
  lashFrame: number | null,
): void {
  if (extend <= 0) return;
  // Per-frame while the creature is actually striking, because the head is
  // thrown forward through the strike and a single anchor is only right on the
  // frame it was measured at. Edge-on that error runs along the facing, which
  // is exactly what makes the tongue look like it is floating ahead of the jaw.
  const anchor = lashAnchorFor(view, lashFrame);
  // The mirrored profile puts the mouth on the other side of the tile, so the
  // anchor has to mirror with the art.
  const anchorX = flipX ? 1 - anchor.x : anchor.x;
  const facingLength = Math.hypot(facingX, facingY);
  const towardX = facingLength === 0 ? 1 : facingX / facingLength;
  const towardY = facingLength === 0 ? 0 : facingY / facingLength;
  // How far ahead of the creature's own tile centre the mouth already is. In
  // profile the snout juts most of half a tile forward; head-on it sits a third
  // of a tile back. Drawn at one length regardless, the tongue overshoots the
  // range it can actually damage from by nearly a tile in one view and falls
  // short of it in another — so the overlay is scaled to make up the difference
  // and the tip lands on the hit boundary in every direction.
  const mouthAhead =
    (anchorX - TILE_CENTRE_FRACTION) * towardX + (anchor.y - TILE_CENTRE_FRACTION) * towardY;
  const wantedReach = TROGLODYTE_TONGUE_HIT_REACH_TILES - mouthAhead;
  const overlayTile = tileSize * (wantedReach / TROGLODYTE_TONGUE_ART_REACH_TILES);
  drawFigureCached(
    ctx,
    TROGLODYTE_TONGUE_FIGURE,
    TONGUE_STATE,
    progressFrameIndex(extend, TONGUE_FRAMES),
    sx + anchorX * tileSize,
    sy + anchor.y * tileSize,
    overlayTile,
    { rotation: Math.atan2(facingY, facingX) },
  );
}

/** Every base pose the creature can play, in the order they are prioritised. */
const TROGLODYTE_BASES: ReadonlyArray<TrogBase> = ['idle', 'walk', 'gape', 'lash'];
const TROGLODYTE_VIEWS: ReadonlyArray<TroglodyteView> = ['front', 'side', 'away'];

/**
 * Every state `drawTroglodyteSprite` can ask the figure for.
 *
 * Built from the same two tables `stateFor` composes rather than listed by
 * hand, so a view or a base added to one is present in the other. The art gates
 * feed this to `missingStateFailures`: both draw paths return silently on a
 * state the figure does not paint, so a name only the runtime knows is an
 * invisible creature and no log line.
 */
export const TROGLODYTE_STATES: ReadonlyArray<TrogState> = TROGLODYTE_BASES.flatMap((base) =>
  TROGLODYTE_VIEWS.map((view) => stateFor(base, view)),
);

/**
 * The rows warmed when a troglodyte's spawn is scheduled.
 *
 * `npm run bench:figure-paint` puts one troglodyte cell over the threshold the
 * direct-paint fallback is affordable below, so this creature gets prewarm
 * coverage for every state its AI can enter rather than only the rows a spawn
 * immediately draws — the attack rows are warmed separately, on the telegraph
 * that precedes them, because the cache lets a row go after ten seconds idle
 * and a spawn-time warm of them would be gone by the first fight.
 */
export const TROGLODYTE_PREWARMED_STATES: ReadonlyArray<TrogState> = TROGLODYTE_VIEWS.flatMap(
  (view) => [stateFor('idle', view), stateFor('walk', view)],
);

/** The rows a strike plays, warmed from the windup that precedes it. */
export const TROGLODYTE_ATTACK_STATES: ReadonlyArray<TrogState> = TROGLODYTE_VIEWS.flatMap(
  (view) => [stateFor('gape', view), stateFor('lash', view)],
);

/**
 * Warms the rows a troglodyte about to exist will draw.
 *
 * Called where a spawn is *scheduled* rather than where the mob first renders:
 * a den of four arriving on one frame is a cold row apiece if the first request
 * for them is the frame they appear on.
 */
export function prewarmTroglodyte(): void {
  for (const state of TROGLODYTE_PREWARMED_STATES) prewarmFigureState(TROGLODYTE_FIGURE, state);
}

/**
 * Warms the windup and the strike.
 *
 * Called when the creature notices a target rather than when it winds up: the
 * windup's own first frame *is* a gape cell, so a warm started there is already
 * late. Noticing a crawler is the earliest warning that this creature's fight
 * has begun.
 */
export function prewarmTroglodyteStrike(): void {
  for (const state of TROGLODYTE_ATTACK_STATES) prewarmFigureState(TROGLODYTE_FIGURE, state);
}

/**
 * Warms the tongue overlay, from the windup that telegraphs it.
 *
 * The windup is fifty frames at level 1 and never fewer than thirty-two, and
 * the tongue is not drawn on any of them — so the strike's own row has the
 * longest lead of anything this creature paints.
 */
export function prewarmTroglodyteTongue(): void {
  prewarmFigureState(TROGLODYTE_TONGUE_FIGURE, TONGUE_STATE);
}

/** Warms the severed pieces, requested on the one frame a troglodyte comes apart. */
export function prewarmTroglodyteGore(): void {
  for (const part of TROGLODYTE_GORE_PARTS) prewarmFigureState(TROGLODYTE_FIGURE, part);
}
