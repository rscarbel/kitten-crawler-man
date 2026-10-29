/**
 * Draws a Kraken guard tentacle through the figure cache.
 *
 * The guard tentacle is a killable mob rather than scenery, so it gets the same
 * facing/mirroring treatment as its parent for the one row where direction is
 * legible — the strike. Rising out of the floor, swaying, and sliding back
 * under all read the same from every side, so those rows are single-view.
 */

import { progressFrameIndex, timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import { KRAKEN_TENTACLE_FIGURE } from './art/krakenFigure';

/** Which of the three drawn viewpoints a facing resolves to. */
export type KrakenTentacleView = 'front' | 'side' | 'away';

/** Every pose state a guard tentacle can be drawn in. */
export type KrakenTentacleState =
  'emerge' | 'idle' | 'strike' | 'strike_side' | 'strike_away' | 'retreat';

/** Those states in the order they play, which is also what a spawn warms. */
export const KRAKEN_TENTACLE_STATES: readonly KrakenTentacleState[] = [
  'emerge',
  'idle',
  'strike',
  'strike_side',
  'strike_away',
  'retreat',
];

/** The severed pieces, in the order `BodyPartGoreSystem` spawns them. */
export const KRAKEN_TENTACLE_GORE_PARTS: ReadonlyArray<string> = [
  'gore_tip',
  'gore_mid',
  'gore_root',
  'gore_sucker_shred',
];

export const KRAKEN_TENTACLE_BODY_PART_KEY = 'kraken_tentacle';

const MILLISECONDS_PER_SECOND = 1000;

/** Loop speed of the sway, which is clock-driven rather than timer-driven. */
const IDLE_FPS = 7;

/**
 * Read off the figure rather than hand-tabled, because the draw path *clamps*
 * the frame index: a state that lost frames would silently freeze on its last
 * one instead of failing.
 */
function frameCountOf(state: KrakenTentacleState): number {
  return figureFrameCount(KRAKEN_TENTACLE_FIGURE, state);
}

/** Views split on whichever axis it is striking hardest along; a tie reads as profile. */
function viewFor(facingX: number, facingY: number): KrakenTentacleView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function strikeStateFor(view: KrakenTentacleView): KrakenTentacleState {
  if (view === 'side') return 'strike_side';
  if (view === 'away') return 'strike_away';
  return 'strike';
}

/**
 * Warms every state a guard tentacle can be drawn in, plus its severed pieces.
 *
 * Wired where the spawn is scheduled rather than where the body is built: the
 * boss room commits to a tentacle before it erupts, and its `emerge` row is the
 * first thing drawn.
 */
export function prewarmKrakenTentacle(): void {
  for (const state of KRAKEN_TENTACLE_STATES) {
    prewarmFigureState(KRAKEN_TENTACLE_FIGURE, state);
  }
  for (const part of KRAKEN_TENTACLE_GORE_PARTS) {
    prewarmFigureState(KRAKEN_TENTACLE_FIGURE, part);
  }
}

/** Everything the guard tentacle sprite needs to pick a pose. All fields optional. */
export interface KrakenTentacleSpriteState {
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
export function drawKrakenTentacleSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: KrakenTentacleSpriteState = {},
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
      KRAKEN_TENTACLE_FIGURE,
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
      KRAKEN_TENTACLE_FIGURE,
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
      KRAKEN_TENTACLE_FIGURE,
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
    KRAKEN_TENTACLE_FIGURE,
    'idle',
    idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf('idle')),
    sx,
    sy,
    tileSize,
  );
}
