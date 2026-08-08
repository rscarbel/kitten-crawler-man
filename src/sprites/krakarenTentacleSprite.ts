/**
 * Draws a Krakaren guard tentacle from its baked sheet (`krakaren_tentacle`).
 *
 * The guard tentacle is a killable mob rather than scenery, so it gets the same
 * facing/mirroring treatment as its parent for the one row where direction is
 * legible — the strike. Rising out of the floor, swaying, and sliding back
 * under all read the same from every side, so those rows are single-view.
 */

import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type KrakarenTentacleSheetState = SpriteStates['krakaren_tentacle'];

/** Which of the three drawn viewpoints a facing resolves to. */
export type KrakarenTentacleView = 'front' | 'side' | 'away';

const SHEET_KEY = 'krakaren_tentacle';

/** The sheet's severed pieces, in the order the bake lays them into the gore row. */
export const KRAKAREN_TENTACLE_GORE_PARTS: ReadonlyArray<string> = [
  'gore_tip',
  'gore_mid',
  'gore_root',
  'gore_sucker_shred',
];

export const KRAKAREN_TENTACLE_BODY_PART_KEY = 'krakaren_tentacle';

const MILLISECONDS_PER_SECOND = 1000;

/** Loop speed of the sway, which is clock-driven rather than timer-driven. */
const IDLE_FPS = 7;

/**
 * Read off the sheet rather than hand-tabled, because `drawSprite` *clamps* the
 * frame index: a row that got shorter in a rebake would silently freeze on its
 * last frame instead of failing.
 */
function frameCountOf(state: KrakarenTentacleSheetState): number {
  return getSpriteDefByKey(SHEET_KEY)?.states.get(state)?.frameCount ?? 1;
}

/** Views split on whichever axis it is striking hardest along; a tie reads as profile. */
function viewFor(facingX: number, facingY: number): KrakarenTentacleView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function strikeStateFor(view: KrakarenTentacleView): KrakarenTentacleSheetState {
  if (view === 'side') return 'strike_side';
  if (view === 'away') return 'strike_away';
  return 'strike';
}

/** Clearance between the top of the baked art and an overhead health bar, in tiles. */
const OVERHEAD_CLEARANCE_TILES = 0.2;

/**
 * How far above its tile origin to hang a health bar so it clears the art.
 *
 * Measured off the loaded manifest rather than copied, because a rebake that
 * resizes the cell moves it — and a stale copy fails silently, as a bar drawn
 * across the tentacle's own mouths. Not cached: a missing def only means the
 * sheet has not finished loading yet.
 */
export function krakarenTentacleOverheadLiftTiles(fallbackTiles: number): number {
  const def = getSpriteDefByKey(SHEET_KEY);
  if (def === undefined) return fallbackTiles;
  return def.tileY / def.tileScale + OVERHEAD_CLEARANCE_TILES;
}

/** Everything the guard tentacle sprite needs to pick a pose. All fields optional. */
export interface KrakarenTentacleSpriteState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through hauling itself out of the floor; null once it is fully risen. */
  readonly emergeProgress?: number | null;
  /** 0–1 through a whip-down strike; null when it is not striking. */
  readonly strikeProgress?: number | null;
  /** 0–1 through sliding back underground; null when it is not leaving. */
  readonly retreatProgress?: number | null;
  /** Offsets the clock-driven sway so several tentacles do not move in lockstep. */
  readonly loopOffsetSeconds?: number;
  /** Pins the clock-driven sway, for the preview harness. */
  readonly idleFrame?: number | null;
}

/**
 * Draw a guard tentacle.
 *
 * Priority is retreat → emerge → strike → idle: leaving outranks everything,
 * because a tentacle that has started sliding under the floor must not be
 * yanked back up by a strike that was already in flight.
 */
export function drawKrakarenTentacleSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: KrakarenTentacleSpriteState = {},
): void {
  const {
    facingX = 0,
    facingY = 1,
    emergeProgress = null,
    strikeProgress = null,
    retreatProgress = null,
    loopOffsetSeconds = 0,
    idleFrame = null,
  } = state;

  if (retreatProgress !== null) {
    drawSpriteKey(
      ctx,
      SHEET_KEY,
      'retreat',
      progressFrameIndex(retreatProgress, frameCountOf('retreat')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  if (emergeProgress !== null) {
    drawSpriteKey(
      ctx,
      SHEET_KEY,
      'emerge',
      progressFrameIndex(emergeProgress, frameCountOf('emerge')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  if (strikeProgress !== null) {
    const view = viewFor(facingX, facingY);
    const key = strikeStateFor(view);
    drawSpriteKey(
      ctx,
      SHEET_KEY,
      key,
      progressFrameIndex(strikeProgress, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX: view === 'side' && facingX < 0 },
    );
    return;
  }

  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND + loopOffsetSeconds;
  drawSpriteKey(
    ctx,
    SHEET_KEY,
    'idle',
    idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf('idle')),
    sx,
    sy,
    tileSize,
  );
}
