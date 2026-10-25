/**
 * Dong Quixote's runtime sprite: picks a row, a view and a frame from the
 * state his kit hands it, and blits the cached cell.
 *
 * Rows are chosen by the action the kit names, never inferred from movement
 * flags, so a charge that is sliding to a halt still draws the charge. Each
 * row advances the way its own table entry says (`DongRow.pacing`): the walk
 * and the charge by ground covered, the breathing idle by the clock with its
 * per-frame holds, and every one-shot by the progress of the action it shows.
 */

import {
  DONG_ACTIONS,
  DONG_CHARGE_GROUND_PER_CYCLE,
  DONG_QUIXOTE_FIGURE,
  DONG_ROWS,
  DONG_VIEWS,
  DONG_TILES_PER_FIGURE_UNIT,
  DONG_WALK_GROUND_PER_CYCLE,
  type DongAction,
  dongPoseAt,
  dongStateName,
} from './art/dongQuixoteFigure';
import { type DongView, buildSkeleton } from './art/dongQuixoteArt';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { DONG_IDLE_FRAME_MS, dongFrameAtProgress } from './dongQuixoteTiming';

export type { DongAction } from './art/dongQuixoteFigure';
export type { DongView } from './art/dongQuixoteArt';

/** Ground one walk cycle covers, in tiles: advance `cyclePhase` by distance over this. */
export const DONG_WALK_TILES_PER_CYCLE = DONG_WALK_GROUND_PER_CYCLE * DONG_TILES_PER_FIGURE_UNIT;
/** Ground one charge cycle covers, in tiles. */
export const DONG_CHARGE_TILES_PER_CYCLE =
  DONG_CHARGE_GROUND_PER_CYCLE * DONG_TILES_PER_FIGURE_UNIT;

/**
 * How far above his tile's top edge the crown of his helmet's comb stands, in
 * tiles, for hanging a health bar or an ally marker over him. The lance point
 * rises higher still, but a bar over the point would float a tile clear of
 * his head. Measured off the painted idle, walk and hurt rows and re-measured
 * by `scripts/gates-dong-quixote.ts` on every render.
 */
export const DONG_HEAD_TOP_ABOVE_TILE = 1.4;

export interface DongQuixoteSpriteState {
  /** The way he faces; any length. */
  readonly facingX: number;
  readonly facingY: number;
  readonly action: DongAction;
  /**
   * For the walk and the charge: the gait's phase in cycles (any real number;
   * only its fraction is used). Advance it by ground covered over
   * {@link DONG_WALK_TILES_PER_CYCLE} or {@link DONG_CHARGE_TILES_PER_CYCLE}.
   * For a one-shot: 0 at its start, 1 at its end.
   */
  readonly progress: number;
  /**
   * Milliseconds on a clock of the caller's choosing, for the breathing idle.
   * Give each instance its own offset so two of him never breathe in lockstep.
   */
  readonly clockMs: number;
  /** 0–1 opacity, for the corpse's fade. */
  readonly alpha?: number;
}

/**
 * The view a facing selects: well north of level is drawn from behind, well
 * to either side is drawn in profile, and the rest head-on — the same split
 * the human crawler's sprite uses, so the two turn together as they walk side by side.
 */
const AWAY_THRESHOLD = -0.5;
const SIDEWAYS_THRESHOLD = 0.5;

export function dongQuixoteViewFor(facingX: number, facingY: number): DongView {
  const length = Math.hypot(facingX, facingY);
  const fx = length > 0 ? facingX / length : 0;
  const fy = length > 0 ? facingY / length : 1;
  if (fy < AWAY_THRESHOLD) return 'back';
  if (Math.abs(fx) > SIDEWAYS_THRESHOLD) return 'side';
  return 'front';
}

const IDLE_CYCLE_MS = DONG_IDLE_FRAME_MS.reduce((sum, ms) => sum + ms, 0);

/** The idle frame showing at a clock time, honouring each frame's own hold. */
export function dongIdleFrameAt(clockMs: number): number {
  let into = ((clockMs % IDLE_CYCLE_MS) + IDLE_CYCLE_MS) % IDLE_CYCLE_MS;
  for (let frame = 0; frame < DONG_IDLE_FRAME_MS.length; frame++) {
    into -= DONG_IDLE_FRAME_MS[frame];
    if (into < 0) return frame;
  }
  return DONG_IDLE_FRAME_MS.length - 1;
}

function rowOf(action: DongAction): { frames: number; pacing: 'ground' | 'clock' | 'progress' } {
  const row = DONG_ROWS.get(action);
  if (row === undefined) throw new Error(`Dong Quixote has no row for "${action}"`);
  return row;
}

/** The frame of a row a sprite state shows. */
export function dongFrameFor(state: DongQuixoteSpriteState): number {
  const row = rowOf(state.action);
  switch (row.pacing) {
    case 'clock':
      return dongIdleFrameAt(state.clockMs);
    case 'ground': {
      const cycle = state.progress - Math.floor(state.progress);
      return Math.min(row.frames - 1, Math.floor(cycle * row.frames));
    }
    case 'progress':
      return dongFrameAtProgress(row.frames, state.progress);
  }
}

/**
 * Draws Dong Quixote with his tile's top-left at (`sx`, `sy`) on a tile `s`
 * pixels wide. Profile rows are painted facing +X and mirrored for a facing
 * to the left.
 */
export function drawDongQuixoteSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: DongQuixoteSpriteState,
): void {
  const view = dongQuixoteViewFor(state.facingX, state.facingY);
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(
    ctx,
    DONG_QUIXOTE_FIGURE,
    dongStateName(state.action, view),
    dongFrameFor(state),
    sx,
    sy,
    s,
    { flipX, alpha: state.alpha ?? 1 },
  );
}

/**
 * Every state name the runtime can ask for, composed by the same
 * `dongStateName` the draw call uses, so the prewarm list, the draw call and
 * the gates can never name different rows.
 */
export function dongQuixoteReachableStates(): readonly string[] {
  return DONG_ACTIONS.flatMap((action) => DONG_VIEWS.map((view) => dongStateName(action, view)));
}

/**
 * Warms the rows he is seen doing all floor — walking and breathing, in every
 * view — at the moment his hire is made, rather than when he first renders.
 */
export function prewarmDongQuixote(): void {
  for (const action of ['walk', 'idle'] as const) {
    for (const view of DONG_VIEWS)
      prewarmFigureState(DONG_QUIXOTE_FIGURE, dongStateName(action, view));
  }
}

/**
 * Warms one action in every view, to its first `frameLimit` frames when
 * given: call it as a charge is telegraphed, or as he engages, so the
 * wind-up bakes while the frames before it play.
 */
export function prewarmDongQuixoteAction(action: DongAction, frameLimit?: number): void {
  for (const view of DONG_VIEWS) {
    prewarmFigureState(DONG_QUIXOTE_FIGURE, dongStateName(action, view), frameLimit);
  }
}

/**
 * How far ahead of the centre of his tile the lance point reaches on a frame,
 * in tiles, along the way he faces. The same in every view: it is read off
 * the rig, not off a picture. A kit landing the thrust on its impact frame
 * can test a foe against this rather than a guessed reach.
 */
export function dongLanceReachTiles(action: DongAction, frame: number): number {
  const { pose } = dongPoseAt(dongStateName(action, 'side'), frame);
  return buildSkeleton(pose).lanceTip.z * DONG_TILES_PER_FIGURE_UNIT;
}
