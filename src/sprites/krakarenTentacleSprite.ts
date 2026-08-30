/**
 * Draws a Krakaren guard tentacle through the figure cache.
 *
 * The guard tentacle is a killable mob rather than scenery, so it gets the same
 * facing/mirroring treatment as its parent for the one row where direction is
 * legible — the strike. Rising out of the floor, swaying, and sliding back
 * under all read the same from every side, so those rows are single-view.
 */

import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import { KRAKAREN_TENTACLE_FIGURE } from './art/krakarenFigure';

/** Which of the three drawn viewpoints a facing resolves to. */
export type KrakarenTentacleView = 'front' | 'side' | 'away';

/** Every pose state a guard tentacle can be drawn in. */
export type KrakarenTentacleState =
  'emerge' | 'idle' | 'strike' | 'strike_side' | 'strike_away' | 'retreat';

/** Those states in the order they play, which is also what a spawn warms. */
export const KRAKAREN_TENTACLE_STATES: readonly KrakarenTentacleState[] = [
  'emerge',
  'idle',
  'strike',
  'strike_side',
  'strike_away',
  'retreat',
];

/** The severed pieces, in the order `BodyPartGoreSystem` spawns them. */
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
 * Read off the figure rather than hand-tabled, because the draw path *clamps*
 * the frame index: a state that lost frames would silently freeze on its last
 * one instead of failing.
 */
function frameCountOf(state: KrakarenTentacleState): number {
  return figureFrameCount(KRAKAREN_TENTACLE_FIGURE, state);
}

/** Views split on whichever axis it is striking hardest along; a tie reads as profile. */
function viewFor(facingX: number, facingY: number): KrakarenTentacleView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function strikeStateFor(view: KrakarenTentacleView): KrakarenTentacleState {
  if (view === 'side') return 'strike_side';
  if (view === 'away') return 'strike_away';
  return 'strike';
}

/** Clearance between the top of the painted art and an overhead health bar, in tiles. */
const OVERHEAD_CLEARANCE_TILES = 0.2;

/**
 * How far above its tile origin to hang a health bar so it clears the art.
 *
 * Read off the figure's own declared geometry rather than copied, because
 * resizing the cell moves it — and a stale copy fails silently, as a bar drawn
 * across the tentacle's own mouths.
 */
export function krakarenTentacleOverheadLiftTiles(_fallbackTiles: number): number {
  return (
    KRAKAREN_TENTACLE_FIGURE.tileY / KRAKAREN_TENTACLE_FIGURE.tileScale + OVERHEAD_CLEARANCE_TILES
  );
}

/**
 * Warms every state a guard tentacle can be drawn in, plus its severed pieces.
 *
 * Wired where the spawn is scheduled rather than where the body is built: the
 * boss room commits to a tentacle before it erupts, and its `emerge` row is the
 * first thing drawn.
 */
export function prewarmKrakarenTentacle(): void {
  for (const state of KRAKAREN_TENTACLE_STATES) {
    prewarmFigureState(KRAKAREN_TENTACLE_FIGURE, state);
  }
  for (const part of KRAKAREN_TENTACLE_GORE_PARTS) {
    prewarmFigureState(KRAKAREN_TENTACLE_FIGURE, part);
  }
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
    drawFigureCached(
      ctx,
      KRAKAREN_TENTACLE_FIGURE,
      'retreat',
      progressFrameIndex(retreatProgress, frameCountOf('retreat')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  if (emergeProgress !== null) {
    drawFigureCached(
      ctx,
      KRAKAREN_TENTACLE_FIGURE,
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
    drawFigureCached(
      ctx,
      KRAKAREN_TENTACLE_FIGURE,
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
  drawFigureCached(
    ctx,
    KRAKAREN_TENTACLE_FIGURE,
    'idle',
    idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf('idle')),
    sx,
    sy,
    tileSize,
  );
}
