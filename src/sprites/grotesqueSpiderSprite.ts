/**
 * The Grotesque Spider, drawn through the figure cache.
 *
 * The painting lives in `art/grotesqueSpiderArt.ts`, the rig and poses in
 * `art/grotesqueSpiderRig.ts`, and the frames each row holds in
 * `art/grotesqueSpiderFigure.ts`. This module maps what the creature knows —
 * the attack and its frame, the distance walked, the time idled — onto a row
 * frame and blits a baked cell.
 *
 * She is painted once, facing +Y, and the caller rotates the whole cell to her
 * facing with {@link grotesqueSpiderFacingRotation}.
 */

import { TILE_SIZE } from '../core/constants';
import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import {
  attackStageAt,
  MAX_EGG_CLUTCH_SIZE,
  recoveryStartFrame,
  strikeFrame,
  totalFrames,
  type SpiderAttack,
  type SpiderAttackStage,
} from '../creatures/grotesqueSpiderTimeline';
import {
  GROTESQUE_SPIDER_ATTACK_SAMPLES,
  GROTESQUE_SPIDER_ATTACK_SAMPLING,
  GROTESQUE_SPIDER_FIGURE_FOR_ROW,
  GROTESQUE_SPIDER_ROW_FRAMES,
} from './art/grotesqueSpiderFigure';
import {
  WALK_STRIDE_TILES,
  type GrotesqueSpiderAttackRow,
  type GrotesqueSpiderState,
} from './art/grotesqueSpiderRig';
import { drawFigureCached, prewarmFigureState, releaseFigure } from './figure/figureFrameCache';
import type { FigureDef } from './figure/figureDef';

export type { GrotesqueSpiderState } from './art/grotesqueSpiderRig';

/**
 * Frames per second the idle row runs at.
 *
 * The row is picked by time, not by game tick, so this sets only how long each
 * pose is held; it cannot alias the row's motions, which are sampled at least
 * four frames a cycle whatever the rate. What it decides is whether the loop
 * reads as motion: held half a second, each of the eight poses is a still and
 * the loop a slideshow. At four a second the breath takes two seconds, each
 * foreleg's taste of the air one, and a shut eye shows for a quarter of a
 * second, as long as a real blink; much faster and she pants and the blinks
 * flicker.
 */
const IDLE_FPS = 4;

/** The row each attack plays. */
export const GROTESQUE_SPIDER_ATTACK_ROWS: Readonly<
  Record<SpiderAttack, GrotesqueSpiderAttackRow>
> = {
  slam: 'attack_slam',
  screech: 'attack_screech',
  spit: 'attack_spit',
  lay: 'attack_lay',
};

/**
 * World pixels she covers in one full gait cycle. The walk row is picked by
 * distance travelled against this, so her feet stay planted at any speed: half
 * speed roaming and the dash both step at the pace the ground goes by.
 */
export const GROTESQUE_SPIDER_STRIDE_PX = WALK_STRIDE_TILES * TILE_SIZE;

/**
 * The rotation that turns her painted +Y facing to (facingX, facingY).
 *
 * A quarter turn *back* from the facing's angle: rotating by θ sends the art's
 * +Y axis to (−sin θ, cos θ), which is (facingX, facingY) when θ is the facing
 * angle minus a quarter turn.
 */
export function grotesqueSpiderFacingRotation(facingX: number, facingY: number): number {
  return Math.atan2(facingY, facingX) - Math.PI / 2;
}

const STAGE_ORDER: readonly SpiderAttackStage[] = ['tell', 'lock', 'strike', 'recovery'];

/**
 * Samples sit on whole ticks, and a stage's progress is recomputed by division
 * (and, for a repeating strike, a multiply and a modulo), so the tick a sample
 * names can come back a rounding error short of it.
 */
const SAMPLE_PROGRESS_EPSILON = 1e-9;

/**
 * The frame of an attack row a stage and its progress show: the latest sample
 * of that stage at or before the progress. The strike stage's first frame is
 * therefore always the row's contact frame, and it holds until the next
 * strike sample.
 */
export function grotesqueSpiderAttackRowFrame(
  row: GrotesqueSpiderAttackRow,
  stage: SpiderAttackStage,
  stageProgress: number,
): number {
  const samples = GROTESQUE_SPIDER_ATTACK_SAMPLES[row];
  const stageRank = STAGE_ORDER.indexOf(stage);
  let lastEarlier = 0;
  let chosen = -1;
  // Samples within one stage are listed in ascending progress.
  samples.forEach((sample, index) => {
    if (STAGE_ORDER.indexOf(sample.stage) < stageRank) lastEarlier = index;
    if (sample.stage !== stage) return;
    if (sample.stageProgress <= stageProgress + SAMPLE_PROGRESS_EPSILON) chosen = index;
  });
  // Before a stage's first sample, and through a stage the row never samples
  // (the lay has no lock), the frame before it holds.
  return chosen >= 0 ? chosen : lastEarlier;
}

/** What the creature knows about the pose it is in. */
export type GrotesqueSpiderSpritePose =
  | { readonly kind: 'idle'; readonly time: number }
  | { readonly kind: 'walk'; readonly distancePx: number }
  | {
      readonly kind: 'attack';
      readonly attack: SpiderAttack;
      readonly attackFrame: number;
      /** Eggs in the clutch being laid; only the lay reads it. */
      readonly eggsInClutch?: number;
    }
  | { readonly kind: 'death'; readonly progress: number };

interface PlacedFrame {
  readonly def: FigureDef;
  readonly state: GrotesqueSpiderState;
  readonly frame: number;
}

/**
 * The frame of an attack's row shown on an attack frame, read through the
 * attack timeline. On `strikeFrame(attack)` this is by construction the row's
 * contact, burst or release frame, and it holds for the impact hold.
 *
 * @param eggsInClutch For the lay, how many eggs this clutch drops; the drop
 *   windows past its last egg show no egg.
 */
export function grotesqueSpiderRowFrameAt(
  attack: SpiderAttack,
  attackFrame: number,
  eggsInClutch = MAX_EGG_CLUTCH_SIZE,
): number {
  const row = GROTESQUE_SPIDER_ATTACK_ROWS[attack];
  const at = attackStageAt(attack, attackFrame);
  const repeats = at.stage === 'strike' ? GROTESQUE_SPIDER_ATTACK_SAMPLING[row].strikeRepeats : 1;
  const rawRepeated = at.stageProgress * repeats;
  const nearestWhole = Math.round(rawRepeated);
  // A drop boundary computed by division can land a hair short of the whole
  // number, which would show the last frame of the previous egg's drop.
  const repeated =
    Math.abs(rawRepeated - nearestWhole) < SAMPLE_PROGRESS_EPSILON ? nearestWhole : rawRepeated;
  // The last tick of a repeating stage is progress 1, which belongs to the final
  // repeat rather than wrapping to the start of another.
  const stageProgress = repeated >= repeats ? 1 : repeated % 1;
  // Each drop window of the lay crowns and expels the egg that lands at the
  // start of the next window. The row is painted for the largest clutch, so
  // once the clutch's last egg is down she holds the window's egg-free
  // opening instead of pushing out an egg the creature never lays.
  const dropWindow = Math.min(repeats - 1, Math.floor(repeated));
  if (attack === 'lay' && at.stage === 'strike' && dropWindow + 1 >= eggsInClutch) {
    return grotesqueSpiderAttackRowFrame(row, at.stage, 0);
  }
  return grotesqueSpiderAttackRowFrame(row, at.stage, stageProgress);
}

/**
 * The screech attack frame the phase-change roar shows on a roar frame. The
 * roar has its own length, so its build is stretched over the screech's
 * run-up — bursting on the build's last frame — and its pause over the
 * screech's dazed recovery.
 */
export function grotesqueSpiderRoarAttackFrame(
  roarFrame: number,
  buildFrames: number,
  pauseFrames: number,
): number {
  const burst = strikeFrame('screech');
  if (roarFrame < buildFrames) return (roarFrame / buildFrames) * burst;
  const recovery = recoveryStartFrame('screech');
  const recoveryLength = totalFrames('screech') - recovery;
  const holdFrames = recovery - burst;
  const sinceBurst = roarFrame - buildFrames;
  // The burst pose holds for the screech's own impact hold, then she is dazed.
  if (sinceBurst < holdFrames) return burst + sinceBurst;
  // The dazed stretch runs from the first tick after the hold to the roar's
  // last tick, and spans the screech's recovery from its first frame to its last.
  const dazedFrames = pauseFrames - holdFrames;
  const dazed = Math.min(1, (sinceBurst - holdFrames) / Math.max(dazedFrames - 1, 1));
  return recovery + dazed * (recoveryLength - 1);
}

function placeAttack(
  attack: SpiderAttack,
  attackFrame: number,
  eggsInClutch: number | undefined,
): PlacedFrame {
  const row = GROTESQUE_SPIDER_ATTACK_ROWS[attack];
  return {
    def: GROTESQUE_SPIDER_FIGURE_FOR_ROW[row],
    state: row,
    frame: grotesqueSpiderRowFrameAt(attack, attackFrame, eggsInClutch),
  };
}

function placePose(pose: GrotesqueSpiderSpritePose): PlacedFrame {
  switch (pose.kind) {
    case 'idle':
      return {
        def: GROTESQUE_SPIDER_FIGURE_FOR_ROW.idle,
        state: 'idle',
        frame: timeFrameIndex(pose.time, IDLE_FPS, GROTESQUE_SPIDER_ROW_FRAMES.idle),
      };
    case 'walk': {
      const frames = GROTESQUE_SPIDER_ROW_FRAMES.walk;
      const cycles = pose.distancePx / GROTESQUE_SPIDER_STRIDE_PX;
      const cycle = cycles - Math.floor(cycles);
      return {
        def: GROTESQUE_SPIDER_FIGURE_FOR_ROW.walk,
        state: 'walk',
        frame: Math.min(frames - 1, Math.floor(cycle * frames)),
      };
    }
    case 'attack':
      return placeAttack(pose.attack, pose.attackFrame, pose.eggsInClutch);
    case 'death':
      return {
        def: GROTESQUE_SPIDER_FIGURE_FOR_ROW.death,
        state: 'death',
        frame: progressFrameIndex(pose.progress, GROTESQUE_SPIDER_ROW_FRAMES.death),
      };
  }
}

/**
 * Draws her on the tile whose top-left is (sx, sy), facing +Y. Rotate the
 * context about the tile centre first to face her anywhere else.
 *
 * @param alpha Multiplies into the caller's alpha; a lingering corpse fades by it.
 */
export function drawGrotesqueSpiderPoseSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  pose: GrotesqueSpiderSpritePose,
  alpha = 1,
): void {
  const placed = placePose(pose);
  drawFigureCached(ctx, placed.def, placed.state, placed.frame, sx, sy, ts, { alpha });
}

/**
 * Warms the rows she stands and walks on. Called when the fight starts rather
 * than when she first renders: the frame that would otherwise bake the first of
 * her cells is the frame the player is being charged on.
 */
export function prewarmGrotesqueSpiderLocomotion(): void {
  prewarmFigureState(GROTESQUE_SPIDER_FIGURE_FOR_ROW.idle, 'idle');
  prewarmFigureState(GROTESQUE_SPIDER_FIGURE_FOR_ROW.walk, 'walk');
}

/**
 * Warms one attack's row, or the death row, at the moment it telegraphs. Each is
 * its own figure, so warming one never costs another its cells.
 */
export function prewarmGrotesqueSpiderAttack(state: GrotesqueSpiderState): void {
  prewarmFigureState(GROTESQUE_SPIDER_FIGURE_FOR_ROW[state], state);
}

/**
 * Drops the death row and any prewarm queued for it. For a fight that resets
 * with her alive: the row was warmed because she was close to dying, and at
 * full health again it is only memory held for nothing.
 */
export function releaseGrotesqueSpiderDeath(): void {
  releaseFigure(GROTESQUE_SPIDER_FIGURE_FOR_ROW.death);
}

/** One row a draw call can land on. */
export interface GrotesqueSpiderRuntimeRow {
  readonly def: FigureDef;
  readonly state: string;
}

const RUNTIME_POSES: readonly GrotesqueSpiderSpritePose[] = [
  { kind: 'idle', time: 0 },
  { kind: 'walk', distancePx: 0 },
  { kind: 'attack', attack: 'slam', attackFrame: 0 },
  { kind: 'attack', attack: 'screech', attackFrame: 0 },
  { kind: 'attack', attack: 'spit', attackFrame: 0 },
  { kind: 'attack', attack: 'lay', attackFrame: 0 },
  { kind: 'death', progress: 0 },
];

/**
 * Every (figure, row) pair a draw call can resolve to, resolved by the mapping
 * itself rather than restated. Both draw paths return silently on a row a
 * figure does not declare, so a pose that resolves to a name nobody paints is
 * an invisible boss and no log line; the gates walk this.
 */
export const GROTESQUE_SPIDER_RUNTIME_ROWS: readonly GrotesqueSpiderRuntimeRow[] =
  RUNTIME_POSES.map((pose) => {
    const placed = placePose(pose);
    return { def: placed.def, state: placed.state };
  });
