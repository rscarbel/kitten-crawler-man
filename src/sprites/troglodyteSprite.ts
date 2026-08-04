import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';
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
 * `BodyPartGoreSystem` spawns them and the order they sit in on the sheet.
 *
 * `scripts/trogGore.ts` builds them in this same order; the generator turns
 * that order into the manifest's `colOffset`s, so a rename in one place and not
 * the other drops a piece rather than silently drawing the wrong one.
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

type TrogState = SpriteStates['troglodyte'];

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Read off the sheet rather than hand-tabled, because `drawSprite` *clamps* the
 * frame index: a row that got shorter would silently freeze on its last frame
 * instead of failing.
 */
function frameCountOf(state: TrogState): number {
  return getSpriteDefByKey('troglodyte')?.states.get(state)?.frameCount ?? 1;
}

function tongueFrameCount(): number {
  return getSpriteDefByKey('troglodyte_tongue')?.states.get('extend')?.frameCount ?? 1;
}

/**
 * The mouth's position for a given frame of the lash, falling back to the
 * single resting anchor when the creature is not mid-strike (the windup, where
 * the tongue is stowed anyway) or when the table has not been baked.
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

function stateFor(base: 'idle' | 'walk' | 'gape' | 'lash', view: TroglodyteView): TrogState {
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

  // Away from the camera the mouth is behind the skull, so the tongue has to be
  // painted before the body or it lies across the back of the creature's head.
  const tongueBehind = view === 'away';
  // Which frame of the lash the *body* is on. The tongue's own extension runs
  // on a different clock, but it is the body that says where the head — and so
  // the mouth the tongue leaves from — currently is.
  const lashKey = stateFor('lash', view);
  const lashFrame =
    strikeProgress === null ? null : progressFrameIndex(strikeProgress, frameCountOf(lashKey));
  if (tongueBehind) {
    drawTongue(ctx, sx, sy, tileSize, view, flipX, tongueExtend, facingX, facingY, lashFrame);
  }

  if (strikeProgress !== null) {
    drawSpriteKey(ctx, 'troglodyte', lashKey, lashFrame ?? 0, sx, sy, tileSize, { flipX });
  } else if (gapeProgress > 0) {
    const key = stateFor('gape', view);
    drawSpriteKey(
      ctx,
      'troglodyte',
      key,
      progressFrameIndex(gapeProgress, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
  } else if (isMoving) {
    const key = stateFor('walk', view);
    drawSpriteKey(
      ctx,
      'troglodyte',
      key,
      walkFrameIndex(walkFrame, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
  } else {
    const key = stateFor('idle', view);
    const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
    // Clock-driven rather than timer-driven so that two troglodytes in the same
    // den do not breathe in lockstep.
    drawSpriteKey(
      ctx,
      'troglodyte',
      key,
      state.idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
  }

  if (!tongueBehind) {
    drawTongue(ctx, sx, sy, tileSize, view, flipX, tongueExtend, facingX, facingY, lashFrame);
  }
}

/**
 * The tongue overlay: its own sheet, anchored at the mouth and rotated toward
 * whatever the creature is striking at.
 *
 * It is not baked into the body sheet because it reaches three tiles — twenty
 * times the creature's own width — and every one of the body's 13 rows would
 * have had to pay for the cell size that needs.
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
  drawSpriteKey(
    ctx,
    'troglodyte_tongue',
    'extend',
    progressFrameIndex(extend, tongueFrameCount()),
    sx + anchorX * tileSize,
    sy + anchor.y * tileSize,
    overlayTile,
    { rotation: Math.atan2(facingY, facingX) },
  );
}
