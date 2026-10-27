/**
 * Magnum as a painted figure: the cell geometry, the stage act's phrase rows
 * and the `FigureDef` the runtime cache and the review harness draw through.
 *
 * This module is choreography and nothing else. Anatomy, palette and every
 * stroke of paint live in `magnumArt.ts`; the stage act's routines live in
 * `magnumDance.ts`.
 *
 * Rows:
 *    dance_<routine>_<n>    one sixteen-frame phrase of the stage act
 *
 * The art invariants live in `scripts/gates-magnum.ts`, which the review
 * harness runs: `npm run render:magnum`.
 */

import { drawMagnum, type MagnumPose, type MagnumView } from './magnumArt';
import { MAGNUM_PHRASES, magnumDancePose, magnumDanceShot, type MagnumPhrase } from './magnumDance';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { MAGNUM_PHRASE_FRAMES } from '../magnumTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The ground line's row within the tile, the one the human and the cat stand on,
 * so he stands on the same line the crawlers do.
 */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;

/**
 * The cell the stage act is painted into. The act carries him most of a tile
 * across the boards and puts his hands over his head, so the cell is wide and
 * tall; the gates fail any pose that paints against an edge of it.
 */
export interface MagnumCellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The cell column his home ground point is painted at. */
  readonly originX: number;
  /** The cell row his ground line is painted on. */
  readonly originY: number;
}

export const MAGNUM_STAGE_CELL: MagnumCellGeometry = {
  frameWidth: 132,
  frameHeight: 104,
  originX: 78,
  originY: 96,
};

function tileXOf(cell: MagnumCellGeometry): number {
  return cell.originX - TILE_SCALE / 2;
}

function tileYOf(cell: MagnumCellGeometry): number {
  return cell.originY - GROUND_ROW_IN_TILE;
}

/** The cell pixel his home ground point — between his feet — is painted at. */
export function magnumOrigin(cell: MagnumCellGeometry): { x: number; y: number } {
  return { x: cell.originX, y: cell.originY };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A painted frame: which painter view to use and the pose it paints. */
export interface MagnumFrame {
  readonly view: MagnumView;
  readonly pose: MagnumPose;
}

// ── The state table ──────────────────────────────────────────────────────────

/** One painted state: how long it is, and its frames. */
export interface MagnumState {
  readonly name: string;
  readonly frameCount: number;
  readonly frame: (frame: number) => MagnumFrame;
}

function phraseState(phrase: MagnumPhrase): MagnumState {
  return {
    name: phrase.state,
    frameCount: MAGNUM_PHRASE_FRAMES,
    frame: (frame) => {
      const shot = magnumDanceShot(phrase, frame);
      return { view: shot.view, pose: magnumDancePose(shot) };
    },
  };
}

export const MAGNUM_STATES: readonly MagnumState[] = MAGNUM_PHRASES.map(phraseState);

const STATE_TABLE: ReadonlyMap<string, MagnumState> = new Map(
  MAGNUM_STATES.map((state): [string, MagnumState] => [state.name, state]),
);

/** The painted frame a state and frame index name, or null for an unknown state. */
export function magnumFrameOf(state: string, frame: number): MagnumFrame | null {
  const entry = STATE_TABLE.get(state);
  if (entry === undefined) return null;
  const clamped = Math.min(Math.max(0, Math.floor(frame)), entry.frameCount - 1);
  return entry.frame(clamped);
}

function paintMagnumFrame(
  cell: MagnumCellGeometry,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const painted = magnumFrameOf(state, frame);
  if (painted === null) throw new Error(`magnum paints no state "${state}"`);
  const origin = magnumOrigin(cell);
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  drawMagnum(ctx, painted.view, painted.pose);
  ctx.restore();
}

function stateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const state of MAGNUM_STATES) frames[state.name] = state.frameCount;
  return frames;
}

/** The stage act, the only way he is drawn. */
export const MAGNUM_STAGE_FIGURE: FigureDef = {
  id: 'magnum_stage',
  frameWidth: MAGNUM_STAGE_CELL.frameWidth,
  frameHeight: MAGNUM_STAGE_CELL.frameHeight,
  tileX: tileXOf(MAGNUM_STAGE_CELL),
  tileY: tileYOf(MAGNUM_STAGE_CELL),
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames()),
  paintFrame: (ctx, state, frame) => {
    paintMagnumFrame(MAGNUM_STAGE_CELL, ctx, state, frame);
  },
};
