/**
 * The Grotesque Spider, drawn through the figure cache.
 *
 * A massive, misshapen spider-form entity: fused body, stringy black hair in
 * dozens of individual strands, asymmetric scattered eyes, an inward-toothed
 * gaping maw. Visual footprint ~3×3 tiles; collision footprint one tile.
 *
 * The painting lives in `art/grotesqueSpiderArt.ts` and the pose each frame
 * holds in `art/grotesqueSpiderFigure.ts`. This module is the mapping between
 * the two: it takes the continuous clock and attack progress the creature and
 * the boss intro hand it, quantises them onto the rows those figures declare,
 * and blits a baked cell. Painting her live is several hundred canvas
 * operations — 48 hair strands and 8 two-segment legs — which is the cost the
 * cache exists to pay once per frame index rather than once per frame.
 */

import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import {
  GROTESQUE_SPIDER_ATTACK_FRAMES,
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_LOCOMOTION_FRAMES,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
  type GrotesqueSpiderBaseState,
} from './art/grotesqueSpiderFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { FigureDef } from './figure/figureDef';

export type { GrotesqueSpiderState } from './art/grotesqueSpiderArt';
import type { GrotesqueSpiderState } from './art/grotesqueSpiderArt';

/**
 * Frames per second the idle row runs at.
 *
 * Each of its frames is a second of idling apart from the next, so playback
 * here is a choice about how fast that second passes. The eyelids set the
 * ceiling: several of the seven eyes blink somewhere inside the row, and a row
 * run fast enough to smooth the breath turns those blinks into a flicker.
 */
const IDLE_FPS = 2;

/**
 * Frames per second the walk rows run at.
 *
 * The row samples 0.38 s of gait per frame, so eight frames a second plays the
 * creep back at close to three times the clock it was sampled off — the pace
 * the creature was authored to move at, and slow enough that the eight
 * desynchronised legs still read individually.
 */
const WALK_FPS = 8;

/** Facing thresholds, matching the ones the art mirrors and hides its face on. */
const FACING_UP_THRESHOLD = -0.3;
const FACING_LEFT_THRESHOLD = -0.1;

/** A row of an attack figure and the frame of it being played. */
interface PlacedFrame {
  readonly def: FigureDef;
  readonly state: string;
  readonly frame: number;
  readonly flipX: boolean;
}

/** The attack figures, one per sheet the boss used to carry. */
const ATTACK_FIGURES: ReadonlyMap<string, FigureDef> = new Map([
  ['attack_slam', GROTESQUE_SPIDER_SLAM_FIGURE],
  ['attack_screech', GROTESQUE_SPIDER_SCREECH_FIGURE],
  ['attack_spit', GROTESQUE_SPIDER_SPIT_FIGURE],
]);

/** Which locomotion row a facing direction is drawn from. */
function locomotionState(facingX: number, facingY: number): GrotesqueSpiderBaseState {
  const movingUp = facingY < FACING_UP_THRESHOLD && Math.abs(facingY) > Math.abs(facingX);
  if (movingUp) return 'walk_up';
  if (Math.abs(facingX) > Math.abs(facingY)) return 'walk_side';
  return 'walk_down';
}

function placeFrame(
  time: number,
  facingX: number,
  facingY: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): PlacedFrame {
  const attack = ATTACK_FIGURES.get(state);
  if (attack !== undefined) {
    return {
      def: attack,
      state,
      frame: progressFrameIndex(stateProgress, GROTESQUE_SPIDER_ATTACK_FRAMES),
      flipX: false,
    };
  }
  if (state === 'walk') {
    const row = locomotionState(facingX, facingY);
    return {
      def: GROTESQUE_SPIDER_BASE_FIGURE,
      state: row,
      frame: timeFrameIndex(time, WALK_FPS, GROTESQUE_SPIDER_LOCOMOTION_FRAMES),
      // Only the profile row has a handedness; the head-on rows are symmetric
      // about the same axis the mirror uses, so flipping them changes nothing.
      flipX: row === 'walk_side' && facingX < FACING_LEFT_THRESHOLD,
    };
  }
  return {
    def: GROTESQUE_SPIDER_BASE_FIGURE,
    state: 'idle',
    frame: timeFrameIndex(time, IDLE_FPS, GROTESQUE_SPIDER_LOCOMOTION_FRAMES),
    flipX: false,
  };
}

/**
 * Draw the Grotesque Spider.
 *
 * @param sx            Tile top-left x (screen coords)
 * @param sy            Tile top-left y (screen coords)
 * @param ts            Tile size in pixels
 * @param time          Monotonic time in seconds (performance.now() / 1000)
 * @param facingX       Normalised horizontal facing (-1 left, 0, +1 right)
 * @param facingY       Normalised vertical facing   (-1 up,   0, +1 down)
 * @param state         Animation state
 * @param stateProgress 0–1 progress within the current attack state; ignored for idle/walk
 */
export function drawGrotesqueSpiderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  time: number,
  facingX: number,
  facingY: number,
  state: GrotesqueSpiderState = 'idle',
  stateProgress = 0,
): void {
  const placed = placeFrame(time, facingX, facingY, state, stateProgress);
  drawFigureCached(ctx, placed.def, placed.state, placed.frame, sx, sy, ts, {
    flipX: placed.flipX,
  });
}

/**
 * Warms the rows the boss stands and walks on.
 *
 * Called when the fight starts rather than when she first renders: her cells
 * are the largest in the game, and the frame that would otherwise bake the
 * first of them is the frame the player is being charged on.
 */
export function prewarmGrotesqueSpiderLocomotion(): void {
  prewarmFigureState(GROTESQUE_SPIDER_BASE_FIGURE, 'idle');
  prewarmFigureState(GROTESQUE_SPIDER_BASE_FIGURE, 'walk_down');
}

/**
 * Warms one attack's row, at the moment that attack telegraphs.
 *
 * Each attack is its own figure, so warming one never costs another its cells.
 */
export function prewarmGrotesqueSpiderAttack(state: GrotesqueSpiderState): void {
  const attack = ATTACK_FIGURES.get(state);
  if (attack === undefined) return;
  prewarmFigureState(attack, state);
}

/** Every state the creature and the boss intro can ask this module to draw. */
const DRAWN_STATES: readonly GrotesqueSpiderState[] = [
  'idle',
  'walk',
  'attack_slam',
  'attack_screech',
  'attack_spit',
];

/** The four facings a caller can hand in, one per row the mapping can select. */
const DRAWN_FACINGS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/** One row a draw call can land on. */
export interface GrotesqueSpiderRuntimeRow {
  readonly def: FigureDef;
  readonly state: string;
}

/**
 * Every (figure, row) pair a draw call can resolve to, resolved by the mapping
 * itself rather than restated.
 *
 * Both draw paths return silently on a row a figure does not declare, so a
 * facing that resolves to a name nobody paints is an invisible boss and no log
 * line. The gates walk this.
 */
export const GROTESQUE_SPIDER_RUNTIME_ROWS: readonly GrotesqueSpiderRuntimeRow[] =
  DRAWN_STATES.flatMap((state) =>
    DRAWN_FACINGS.map(([facingX, facingY]) => {
      const placed = placeFrame(0, facingX, facingY, state, 0);
      return { def: placed.def, state: placed.state };
    }),
  );
