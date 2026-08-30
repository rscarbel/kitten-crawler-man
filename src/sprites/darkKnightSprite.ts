import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached } from './figure/figureFrameCache';
import {
  DARK_KNIGHT_FIGURE,
  IDLE_FRAMES,
  PUNCH_FRAMES,
  PUNCH_IMPACT_FRAME,
  SLAM_FRAMES,
  SLAM_IMPACT_FRAME,
  SWEEP_FRAMES,
  SWEEP_IMPACT_FRAME,
  WALK_FRAMES,
} from './art/darkKnightFigure';

/** Which of the figure's three viewpoints a facing vector selects. */
type DarkKnightView = 'front' | 'side' | 'away';

/** The attacks that have their own rows. */
export type DarkKnightAttack = 'slam' | 'sweep' | 'punch';

/**
 * Every pose name the figure paints. Written out rather than derived, because
 * `stateFor` builds its names by template literal and both draw paths answer a
 * name the figure does not declare by returning without drawing anything.
 */
export type DarkKnightState =
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'slam'
  | 'slam_side'
  | 'slam_away'
  | 'sweep'
  | 'sweep_side'
  | 'sweep_away'
  | 'punch'
  | 'punch_side'
  | 'punch_away';

/**
 * The frame each attack lands on, taken from the choreography that paints it
 * rather than hand-copied beside it — the runtime and the art are one module
 * graph now, so there is nothing left to drift.
 */
export const DARK_KNIGHT_ATTACK_IMPACT_FRAME: Readonly<Record<DarkKnightAttack, number>> = {
  slam: SLAM_IMPACT_FRAME,
  sweep: SWEEP_IMPACT_FRAME,
  punch: PUNCH_IMPACT_FRAME,
};

/**
 * Exhaustive by construction: a state added to the figure but not to this map
 * is a compile error, which is safer than reading the count off the figure —
 * the draw call *clamps* the frame index, so a row that got shorter would
 * silently freeze on its last frame instead of failing.
 */
const FRAME_COUNT: Record<DarkKnightState, number> = {
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_away: IDLE_FRAMES,
  slam: SLAM_FRAMES,
  slam_side: SLAM_FRAMES,
  slam_away: SLAM_FRAMES,
  sweep: SWEEP_FRAMES,
  sweep_side: SWEEP_FRAMES,
  sweep_away: SWEEP_FRAMES,
  punch: PUNCH_FRAMES,
  punch_side: PUNCH_FRAMES,
  punch_away: PUNCH_FRAMES,
};

/** Frames in an attack's profile row — the length its timers are sized from. */
export function darkKnightAttackFrames(attack: DarkKnightAttack): number {
  return FRAME_COUNT[`${attack}_side`];
}

/**
 * The fraction of an attack row at which the blow lands.
 *
 * A one-shot row samples the *middle* of each frame, so the impact sits half a
 * frame past its own index. Getting that wrong puts the blow a whole frame
 * early at the short end of the timing table.
 */
const FRAME_MIDPOINT = 0.5;

/** The furthest through a row an impact may be declared. */
const MAX_IMPACT_PROGRESS = 0.9;

export function darkKnightImpactProgress(attack: DarkKnightAttack): number {
  const frames = darkKnightAttackFrames(attack);
  const raw = (DARK_KNIGHT_ATTACK_IMPACT_FRAME[attack] + FRAME_MIDPOINT) / frames;
  // Clamped short of 1: a shortened row would otherwise put the impact past its
  // own end, and nothing throws when that happens — the creature's execute
  // phase interpolates `impact + elapsed * (1 - impact)` with a negative span
  // and plays the attack backwards over a single frame, which is far harder to
  // notice than a crash.
  return Math.min(raw, MAX_IMPACT_PROGRESS);
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 5;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The seven pieces a Dark Knight comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `darkKnightGore.ts` paints
 * them in this order and `BodyPartGoreSystem` spawns them in it, so a rename in
 * one place is a missing body part rather than a silent no-op.
 */
export const DARK_KNIGHT_GORE_PARTS: ReadonlyArray<string> = [
  'gore_helm',
  'gore_pauldron',
  'gore_breastplate',
  'gore_gauntlet',
  'gore_arm',
  'gore_leg',
  'gore_mace',
];

/** The `BodyPartGoreSystem` registry key a dead knight's flying pieces come from. */
export const DARK_KNIGHT_BODY_PART_KEY = 'dark_knight';

/**
 * The three views of a row, warmed together rather than the one he currently
 * faces: a wind-up lasts long enough for the player to walk around him, and the
 * frames the cache has to have ready are whichever view he is in when the blow
 * lands.
 */
export const DARK_KNIGHT_WALK_STATES: ReadonlyArray<DarkKnightState> = [
  'walk',
  'walk_side',
  'walk_away',
];

export function darkKnightAttackStates(attack: DarkKnightAttack): ReadonlyArray<DarkKnightState> {
  return [attack, `${attack}_side`, `${attack}_away`];
}

/** Everything the sprite needs to pick a pose. All fields are optional. */
export interface DarkKnightSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  readonly attack?: DarkKnightAttack | null;
  /** 0 at the first frame of the attack, 1 at the last; null when not attacking. */
  readonly attackProgress?: number | null;
}

/** Views split on whichever axis the knight is facing hardest along. */
function viewFor(facingX: number, facingY: number): DarkKnightView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** The animation families the figure paints; each has a row per view. */
type AnimationBase = 'walk' | 'idle' | DarkKnightAttack;

function stateFor(base: AnimationBase, view: DarkKnightView): DarkKnightState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the Dark Knight.
 *
 * Priority runs attack → walk → idle, so a swing always wins over the pace it
 * interrupts.
 */
export function drawDarkKnightSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: DarkKnightSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    attack = null,
    attackProgress = null,
  } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would swap the
  // mace into the wrong hand every time he turned around.
  const flipX = view === 'side' && facingX < 0;

  if (attack !== null && attackProgress !== null) {
    const key = stateFor(attack, view);
    drawFigureCached(
      ctx,
      DARK_KNIGHT_FIGURE,
      key,
      progressFrameIndex(attackProgress, FRAME_COUNT[key]),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      DARK_KNIGHT_FIGURE,
      key,
      walkFrameIndex(walkFrame, FRAME_COUNT[key]),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  // Clock-driven, not `walkFrame`-driven: `walkFrame` resets to 0 the moment a
  // mob stops, which would freeze the idle on its first frame.
  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  drawFigureCached(
    ctx,
    DARK_KNIGHT_FIGURE,
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    s,
    { flipX },
  );
}
