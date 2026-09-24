import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { type FairyView, type Pt, fairyChestOffset, fairyPaintedTopY } from './art/fairyArt';
import { FAIRY_VIEWS, fairyFigureOf, fairyPoseOf, fairyStateName } from './art/fairyFigure';
import {
  type FairyKind,
  type FairyRow,
  fairyHoverFps,
  fairyRowFrames,
  fairyRowSpec,
  fairyRowsOf,
} from './art/fairyTiming';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

const MS_PER_SECOND = 1000;

/** The figure paints in tile units about the tile's centre. */
const TILE_CENTRE_FRACTION = 0.5;

/** Which of the figure's three viewpoints a facing vector selects. */
function viewFor(facingX: number, facingY: number): FairyView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** Everything the fairy sprite needs to pick a cell. */
export interface FairySpriteState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** The row to show; `hover` when omitted. */
  readonly row?: FairyRow;
  /**
   * 0 on a one-shot row's first frame, 1 on its last: the elapsed share of the
   * windup, hurt flinch or death the behaviour is timing. Ignored by `hover`,
   * which loops on the clock.
   */
  readonly progress?: number;
  /**
   * Seconds added to the hover clock, so a room of fairies does not beat its
   * wings in lockstep. Any stable per-instance value works.
   */
  readonly clockOffsetSeconds?: number;
  readonly alpha?: number;
}

/**
 * The frame a row shows for a state: a loop on the clock, or a one-shot
 * indexed by progress.
 *
 * The count is read from the figure rather than a copy of the timing table:
 * `drawFigureCached` clamps the frame index, so a row that got shorter would
 * silently freeze on its last frame rather than throw.
 */
function frameFor(
  kind: FairyKind,
  stateName: string,
  row: FairyRow,
  state: FairySpriteState,
): number {
  const frames = Math.max(1, figureFrameCount(fairyFigureOf(kind), stateName));
  if (fairyRowSpec(row).playback === 'loop') {
    const seconds = performance.now() / MS_PER_SECOND + (state.clockOffsetSeconds ?? 0);
    return timeFrameIndex(seconds, fairyHoverFps(kind), frames);
  }
  return progressFrameIndex(state.progress ?? 0, frames);
}

/**
 * Draws a fairy of one kind at its tile.
 *
 * (sx, sy) is the fairy's tile top-left on screen and `tileSize` the tile's
 * size in screen pixels, as for every creature sprite. The figure paints its
 * own hover height and its own ground shadow, so the caller draws at the
 * mob's ground tile and adds no lift or shadow of its own. The side view faces
 * +X and is mirrored for a fairy facing -X.
 */
export function drawFairySprite(
  ctx: CanvasRenderingContext2D,
  kind: FairyKind,
  sx: number,
  sy: number,
  tileSize: number,
  state: FairySpriteState = {},
): void {
  const { facingX = 0, facingY = 1, row = 'hover', alpha } = state;
  const view = viewFor(facingX, facingY);
  const stateName = fairyStateName(row, view);
  drawFigureCached(
    ctx,
    fairyFigureOf(kind),
    stateName,
    frameFor(kind, stateName, row, state),
    sx,
    sy,
    tileSize,
    { flipX: view === 'side' && facingX < 0, alpha },
  );
}

/**
 * Where the chest of a fairy drawn by `drawFairySprite` with the same
 * arguments hangs, in the same space as (sx, sy).
 *
 * Read off the very pose that frame paints, so a tether, heal stream or thrown ball
 * starting here leaves the body wherever the row has carried it — a lunge, a
 * recoil, the fall of the death row — rather than a fixed point above the tile.
 */
export function fairyChestPoint(
  kind: FairyKind,
  sx: number,
  sy: number,
  tileSize: number,
  state: FairySpriteState = {},
): Pt {
  const { facingX = 0, facingY = 1, row = 'hover' } = state;
  const view = viewFor(facingX, facingY);
  const frame = frameFor(kind, fairyStateName(row, view), row, state);
  const chest = fairyChestOffset(fairyPoseOf(kind, row, frame));
  const mirroredX = view === 'side' && facingX < 0 ? -chest.x : chest.x;
  return {
    x: sx + tileSize * (TILE_CENTRE_FRACTION + mirroredX),
    y: sy + tileSize * (TILE_CENTRE_FRACTION + chest.y),
  };
}

const paintedCrowns = new Map<FairyKind, number>();

/**
 * How far below the tile's top edge the tallest thing a hovering fairy of
 * `kind` paints reaches, in tiles; negative is above the tile. The highest
 * point of any hover frame from any view, so a health bar or an aggro mark
 * hung above it stays clear of the crest, hood, flames or wingtips through the
 * whole wingbeat and never jumps as the fairy turns.
 */
export function fairyCrownBelowTileTopTiles(kind: FairyKind): number {
  const cached = paintedCrowns.get(kind);
  if (cached !== undefined) return cached;
  let topY = Infinity;
  for (const view of FAIRY_VIEWS) {
    for (let frame = 0; frame < fairyRowFrames('hover'); frame++) {
      topY = Math.min(topY, fairyPaintedTopY(kind, view, fairyPoseOf(kind, 'hover', frame)));
    }
  }
  const crown = TILE_CENTRE_FRACTION + topY;
  paintedCrowns.set(kind, crown);
  return crown;
}

/**
 * Every state name `drawFairySprite` can ask a kind's figure for.
 *
 * Composed through `fairyStateName` over the kind's own rows rather than
 * listed by hand, so the art gates can prove each one is painted: the draw
 * path returns silently on a state the figure lacks, which is an invisible
 * fairy and no log line.
 */
export function fairySpriteStatesOf(kind: FairyKind): readonly string[] {
  return fairyRowsOf(kind).flatMap((row) => FAIRY_VIEWS.map((view) => fairyStateName(row, view)));
}

/**
 * Warms every row a kind can draw. Call it where the fairy's spawn is
 * scheduled — the floor's prewarm list, the boss intro that brings a healer —
 * not where it first renders.
 *
 * All rows at once, because a fairy's rows follow each other with no warning
 * of their own: it hovers from its first frame, starts a windup the moment a
 * crawler is in range, flinches on the first hit and dies on the next.
 */
export function prewarmFairy(kind: FairyKind): void {
  const figure = fairyFigureOf(kind);
  for (const state of fairySpriteStatesOf(kind)) prewarmFigureState(figure, state);
}
