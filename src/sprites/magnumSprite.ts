import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { drawDancePole } from './art/dancePole/dancePole';
import {
  MAGNUM_ACT_FRAMES,
  MAGNUM_PHRASES,
  MAGNUM_POLE_OFFSET_TILES,
  magnumBigMoves,
  type ActBigMove,
} from './art/magnumDance';
import { GROUND_OFFSET_IN_TILE, MAGNUM_STAGE_FIGURE } from './art/magnumFigure';
import { MAGNUM_DANCE_FPS, MAGNUM_PHRASE_FRAMES } from './magnumTiming';

export { MAGNUM_STAGE_FIGURE };

// ── The stage act ────────────────────────────────────────────────────────────

/** Which phrase and frame of the act plays at a moment. */
export interface MagnumDanceCue {
  readonly state: string;
  readonly frame: number;
  /** The frame's place in the whole act, 0 to `MAGNUM_ACT_FRAMES - 1`. */
  readonly actFrame: number;
}

/**
 * The act's frame at `seconds` on the stage's own clock. The act is one loop
 * through every routine; it never restarts visibly, so any clock works, and a
 * stage that wants two dancers out of step offsets one clock.
 */
export function magnumDanceCueAt(seconds: number): MagnumDanceCue {
  const counted = Math.floor(seconds * MAGNUM_DANCE_FPS);
  const actFrame = ((counted % MAGNUM_ACT_FRAMES) + MAGNUM_ACT_FRAMES) % MAGNUM_ACT_FRAMES;
  const phrase = MAGNUM_PHRASES[Math.floor(actFrame / MAGNUM_PHRASE_FRAMES)];
  return { state: phrase.state, frame: actFrame % MAGNUM_PHRASE_FRAMES, actFrame };
}

/**
 * Where his pole's base is on the screen when he is drawn with his tile's
 * top-left at (sx, sy): the stage draws it there before drawing him.
 */
export function magnumPoleBase(sx: number, sy: number, tileSize: number): { x: number; y: number } {
  return {
    x: sx + tileSize / 2 + MAGNUM_POLE_OFFSET_TILES.x * tileSize,
    y: sy + GROUND_OFFSET_IN_TILE * tileSize + MAGNUM_POLE_OFFSET_TILES.y * tileSize,
  };
}

/**
 * Draws the act at `seconds`: the pole first, then Magnum over it, with his
 * home tile's top-left at (sx, sy). A stage that draws its own pole calls
 * {@link drawMagnumDancer} instead.
 */
export function drawMagnumStage(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  seconds: number,
  alpha = 1,
): void {
  const base = magnumPoleBase(sx, sy, tileSize);
  drawDancePole(ctx, base.x, base.y, tileSize);
  drawMagnumDancer(ctx, sx, sy, tileSize, seconds, alpha);
}

/** Draws Magnum alone at the act's frame for `seconds`, for a stage that draws the pole itself. */
export function drawMagnumDancer(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  seconds: number,
  alpha = 1,
): void {
  const cue = magnumDanceCueAt(seconds);
  drawFigureCached(ctx, MAGNUM_STAGE_FIGURE, cue.state, cue.frame, sx, sy, tileSize, { alpha });
}

/**
 * How far above the top of his home tile the act reaches, in tiles: his crown
 * or a raised fist is the top of it. Frozen like the standing clearance and
 * re-measured by the same gate.
 */
export const MAGNUM_STAGE_TOP_ABOVE_TILE_TILES = 0.36;

/** The act's big moves, as act frames: for a stage to time a cheer or a sound. */
export const MAGNUM_BIG_MOVES: readonly ActBigMove[] = magnumBigMoves();

/** Every phrase of the act, the states a stage has to have warm. */
export function magnumStageStates(): readonly string[] {
  return MAGNUM_PHRASES.map((phrase) => phrase.state);
}

/**
 * Warms the whole act. Called when the club is entered: the act loops through
 * every phrase, so each is needed within one pass.
 */
export function prewarmMagnumStage(): void {
  for (const state of magnumStageStates()) prewarmFigureState(MAGNUM_STAGE_FIGURE, state);
}

/**
 * Keeps the phrase playing at `seconds` and the one after it warm. A pass of
 * the act is longer than the cache keeps an undrawn row, so each phrase is
 * released between passes and baked again; called every frame the stage is
 * drawn, this bakes the next phrase while the current one plays.
 */
export function keepMagnumStageWarm(seconds: number): void {
  const current = magnumDanceCueAt(seconds);
  const next = magnumDanceCueAt(seconds + MAGNUM_PHRASE_FRAMES / MAGNUM_DANCE_FPS);
  prewarmFigureState(MAGNUM_STAGE_FIGURE, current.state);
  prewarmFigureState(MAGNUM_STAGE_FIGURE, next.state);
}
