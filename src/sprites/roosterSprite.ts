/**
 * The runtime wrapper for every rooster: Big Rooster and the two minions.
 *
 * Picks a row from what the creature is doing and which way it faces, picks the
 * frame from the row's progress or the gait's phase, and draws the build's
 * figure through the frame cache — with Big Rooster's dumbbell at the hand
 * anchor the figure solves for that frame. Row lengths and impact frames come
 * from the figure's own table (`ROOSTER_ROW_TIMING`), never from a copy.
 */

import {
  MILLISECONDS_PER_SECOND,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { EyePlacement } from './eyePlacement';
import {
  BIG_ROOSTER_HAND_ANCHORS,
  GORE_STATES,
  type HandAnchor,
  ROOSTER_CELLS,
  ROOSTER_FIGURES,
  ROOSTER_ROW_TIMING,
  ROOSTER_VIEWS,
  type RoosterRowBase,
  gaitGroundPerCycle,
  roosterEyeRig,
  roosterStateName,
} from './art/roosterFigure';
import type { RoosterBuild, RoosterView } from './art/roosterArt';
import { ROOSTER_IDLE_FPS } from './bigRoosterAttackTiming';
import { drawRoosterDumbbell } from './roosterDumbbell';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

export type { RoosterBuild, RoosterRowBase };
export { ROOSTER_ROW_TIMING };

/** The severed pieces, in the order the figure paints them. */
export const ROOSTER_GORE_PARTS: readonly string[] = GORE_STATES;

/** The body-part key each build's gore is registered under. */
export const ROOSTER_BODY_PART_KEYS: Readonly<Record<RoosterBuild, string>> = {
  big: 'big_rooster',
  little: 'little_rooster',
  bent: 'slightly_bent_rooster',
};

/**
 * The rows the creatures ask each build for. Written out here rather than read
 * off the figure, so a row the runtime plays and the figure stopped painting is
 * a gate failure (`scripts/gates-rooster.ts`) instead of an invisible bird.
 */
export const ROOSTER_RUNTIME_ROWS: Readonly<Record<RoosterBuild, readonly RoosterRowBase[]>> = {
  big: [
    'idle',
    'walk',
    'sprint',
    'carry_walk',
    'peck',
    'punch',
    'club_swing',
    'throw',
    'slam',
    'pickup',
    'crow',
  ],
  little: ['idle', 'walk', 'peck', 'punch'],
  bent: ['idle', 'walk', 'peck', 'punch'],
};

/**
 * Enraged he idles faster rather than through a second set of rows, and
 * hotter: the cadence carries half the read, because a colour shift alone
 * reads as a change of light. His walk needs no multiplier: it is paced by
 * the ground he covers, and enraged he covers more of it.
 */
const ENRAGED_IDLE_CADENCE = 1.25;
const ENRAGED_FILTER = 'saturate(1.6) brightness(1.08)';
/** The hit flash wins outright over the enrage, so a blow that landed always reads as one. */
const DAMAGE_FLASH_FILTER = 'brightness(3)';

export interface RoosterSpriteState {
  /** Walk-cycle phase in radians, advanced by the ground covered (see {@link RoosterAnimationClock}). */
  readonly walkFrame?: number;
  /** Sprint-cycle phase in radians, advanced by the ground covered (see {@link RoosterAnimationClock}). */
  readonly sprintFrame?: number;
  readonly isMoving?: boolean;
  readonly isSprinting?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through each one-shot, or null when it is not playing. */
  readonly peckProgress?: number | null;
  readonly punchProgress?: number | null;
  readonly clubProgress?: number | null;
  readonly throwProgress?: number | null;
  readonly slamProgress?: number | null;
  readonly pickupProgress?: number | null;
  readonly crowProgress?: number | null;
  /** Whether Big Rooster has a dumbbell in his right fist. */
  readonly heldDumbbell?: boolean;
  readonly isEnraged?: boolean;
  readonly isDamageFlashing?: boolean;
  /** Pins the clock-driven idle, for the preview harness. */
  readonly idleFrame?: number;
  /**
   * Seconds of idle this bird has played, on its own clock
   * ({@link RoosterAnimationClock}). Without one the idle runs off the wall clock.
   */
  readonly idleSeconds?: number;
}

/** Views split on whichever axis he faces hardest along. */
function roosterViewFor(facingX: number, facingY: number): RoosterView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'back' : 'front';
}

interface Choice {
  readonly base: RoosterRowBase;
  readonly frame: number;
}

/** A committed blow always wins over the locomotion it interrupted. */
const ONE_SHOT_PRIORITY: ReadonlyArray<readonly [RoosterRowBase, keyof RoosterSpriteState]> = [
  ['crow', 'crowProgress'],
  ['slam', 'slamProgress'],
  ['club_swing', 'clubProgress'],
  ['throw', 'throwProgress'],
  ['punch', 'punchProgress'],
  ['peck', 'peckProgress'],
  ['pickup', 'pickupProgress'],
];

function progressOf(state: RoosterSpriteState, key: keyof RoosterSpriteState): number | null {
  const value = state[key];
  return typeof value === 'number' ? value : null;
}

function chooseRow(build: RoosterBuild, state: RoosterSpriteState): Choice {
  const painted = ROOSTER_RUNTIME_ROWS[build];
  for (const [base, key] of ONE_SHOT_PRIORITY) {
    const progress = progressOf(state, key);
    if (progress === null || !painted.includes(base)) continue;
    return { base, frame: progressFrameIndex(progress, ROOSTER_ROW_TIMING[base].frames) };
  }
  if (state.isSprinting === true && painted.includes('sprint')) {
    return {
      base: 'sprint',
      frame: walkFrameIndex(state.sprintFrame ?? 0, ROOSTER_ROW_TIMING.sprint.frames),
    };
  }
  if (state.isMoving === true) {
    const base: RoosterRowBase =
      state.heldDumbbell === true && painted.includes('carry_walk') ? 'carry_walk' : 'walk';
    return {
      base,
      frame: walkFrameIndex(state.walkFrame ?? 0, ROOSTER_ROW_TIMING[base].frames),
    };
  }
  const idleSeconds = state.idleSeconds ?? performance.now() / MILLISECONDS_PER_SECOND;
  return {
    base: 'idle',
    frame:
      state.idleFrame ??
      timeFrameIndex(idleSeconds, ROOSTER_IDLE_FPS, ROOSTER_ROW_TIMING.idle.frames),
  };
}

/** The dumbbell's anchor on this frame, or null when nothing is in his fist. */
function heldAnchor(
  state: RoosterSpriteState,
  stateName: string,
  frame: number,
): HandAnchor | null {
  if (state.heldDumbbell !== true) return null;
  return BIG_ROOSTER_HAND_ANCHORS.get(stateName)?.[frame] ?? null;
}

/**
 * Draws one rooster. The dumbbell is drawn behind him from the back, where his
 * own back hides his right fist, and in front of him otherwise.
 */
export function drawRoosterSprite(
  ctx: CanvasRenderingContext2D,
  build: RoosterBuild,
  sx: number,
  sy: number,
  tileSize: number,
  state: RoosterSpriteState,
): void {
  const view = roosterViewFor(state.facingX ?? 1, state.facingY ?? 0);
  const flipX = view === 'side' && (state.facingX ?? 1) < 0;
  const choice = chooseRow(build, state);
  const stateName = roosterStateName(choice.base, view);
  const anchor = heldAnchor(state, stateName, choice.frame);
  const figure = ROOSTER_FIGURES[build];

  ctx.save();
  if (state.isDamageFlashing === true) ctx.filter = DAMAGE_FLASH_FILTER;
  else if (state.isEnraged === true) ctx.filter = ENRAGED_FILTER;
  const dumbbellBehind = view === 'back';
  if (anchor !== null && dumbbellBehind) drawRoosterDumbbell(ctx, sx, sy, tileSize, anchor, flipX);
  drawFigureCached(ctx, figure, stateName, choice.frame, sx, sy, tileSize, { flipX });
  if (anchor !== null && !dumbbellBehind) drawRoosterDumbbell(ctx, sx, sy, tileSize, anchor, flipX);
  ctx.restore();
}

const FULL_TURN = Math.PI * 2;
/**
 * Below this share of the walk's ceiling a running bird drops back to the walk.
 * The gap keeps a stride that hovers at the ceiling, or a frame of separation
 * shove, from flicking him between the two rows.
 */
const RUN_EXIT_SHARE = 0.85;

type RoosterGait = 'walk' | 'sprint';

/**
 * The fastest a build can travel in a gait with its feet still planted, in
 * tiles per game tick: one sprite frame of the row a tick. Past it the row is
 * undersampled, so the phase stops there and the feet skate.
 */
export function roosterGaitCeilingTilesPerTick(build: RoosterBuild, gait: RoosterGait): number {
  const tilesPerCycle = gaitGroundPerCycle(build, gait) * ROOSTER_CELLS[build].tilesPerUnit;
  return tilesPerCycle / ROOSTER_ROW_TIMING[gait].frames;
}

/** Whether a build paints a row to run in when he outpaces his walk. */
function runsWhenFast(build: RoosterBuild): boolean {
  return ROOSTER_RUNTIME_ROWS[build].includes('sprint');
}

/** More ground than a rooster's sprint or a knockback shove covers in one tick. */
const TELEPORT_TILES_PER_TICK = 1;
/** A foot comes down every half turn of a gait's phase. */
const STRIDE_PHASE_PER_STEP = Math.PI;

/**
 * One rooster's animation clocks.
 *
 * Both gaits are paced by the ground he actually covers, measured from where
 * he stood a tick ago, so a planted foot holds its place on the floor. A build
 * with a sprint row runs in it whenever he covers more ground a tick than his
 * walk's ceiling, so his feet stay planted at every speed he reaches.
 *
 * The idle is advanced a tick at a time at the cadence he is playing, so
 * enraging carries on from the frame he was on rather than jumping to
 * wherever a faster wall clock would put him.
 */
export class RoosterAnimationClock {
  private readonly build: RoosterBuild;
  private sampleX: number;
  private sampleY: number;
  private idleClockSeconds: number;
  private walkAdvance = 0;
  private runClockPhase = 0;
  private outpacingWalk = false;
  /** The phase of whichever gait he is drawn in, for telling when a foot lands. */
  private strideClockPhase = 0;
  private footLanded = false;

  /**
   * @param idleOffsetSeconds how far into the idle this bird starts, so a flock
   *   standing together does not breathe and look round in lockstep.
   */
  constructor(build: RoosterBuild, x: number, y: number, idleOffsetSeconds: number) {
    this.build = build;
    this.sampleX = x;
    this.sampleY = y;
    this.idleClockSeconds = idleOffsetSeconds;
  }

  /** Advances every clock by one game tick, with him now at (`x`, `y`). */
  tick(x: number, y: number, tileSize: number, enraged: boolean): void {
    const movedTiles = Math.hypot(x - this.sampleX, y - this.sampleY) / tileSize;
    this.sampleX = x;
    this.sampleY = y;
    // A return to his spawn moves him further in one tick than any stride or
    // shove can; counted as ground, it would read as one enormous sprint step.
    const teleported = movedTiles > TELEPORT_TILES_PER_TICK;
    const coveredTiles = teleported ? 0 : movedTiles;
    const cadence = enraged ? ENRAGED_IDLE_CADENCE : 1;
    this.idleClockSeconds += cadence / WORLD_TICKS_PER_SECOND;

    const walkCeiling = roosterGaitCeilingTilesPerTick(this.build, 'walk');
    const runThreshold = this.outpacingWalk ? walkCeiling * RUN_EXIT_SHARE : walkCeiling;
    this.outpacingWalk = runsWhenFast(this.build) && coveredTiles > runThreshold;
    this.walkAdvance = gaitAdvance(this.build, 'walk', coveredTiles);
    const runAdvance = gaitAdvance(this.build, 'sprint', coveredTiles);
    this.runClockPhase = (this.runClockPhase + runAdvance) % FULL_TURN;

    const shownAdvance = this.outpacingWalk ? runAdvance : this.walkAdvance;
    const stepBefore = Math.floor(this.strideClockPhase / STRIDE_PHASE_PER_STEP);
    this.strideClockPhase = (this.strideClockPhase + shownAdvance) % FULL_TURN;
    const stepAfter = Math.floor(this.strideClockPhase / STRIDE_PHASE_PER_STEP);
    this.footLanded = shownAdvance > 0 && stepBefore !== stepAfter;
  }

  /** Whether one of his feet came down this tick. */
  get footfall(): boolean {
    return this.footLanded;
  }

  /** The walk phase this tick's ground is worth, for `walkFrameSpeed`. */
  get walkRadians(): number {
    return this.walkAdvance;
  }

  /** Whether he is covering ground faster than his walk can show, and so runs. */
  get running(): boolean {
    return this.outpacingWalk;
  }

  /** The sprint row's phase, for {@link RoosterSpriteState.sprintFrame}. */
  get runPhase(): number {
    return this.runClockPhase;
  }

  /** Seconds of idle he has played, for {@link RoosterSpriteState.idleSeconds}. */
  get idleSeconds(): number {
    return this.idleClockSeconds;
  }
}

/** A gait's phase for `coveredTiles` of ground, held at one sprite frame a tick. */
function gaitAdvance(build: RoosterBuild, gait: RoosterGait, coveredTiles: number): number {
  const ceiling = roosterGaitCeilingTilesPerTick(build, gait);
  const framesThisTick = Math.min(coveredTiles / ceiling, 1);
  return (framesThisTick * FULL_TURN) / ROOSTER_ROW_TIMING[gait].frames;
}

/**
 * How far a build's cell reaches past his tile on any side, rounded up to
 * whole tiles: the largest overhang his art can have, since no painted pixel
 * leaves its cell. What his cull margin has to be, or he pops in at the edge
 * of the screen with part of him already on it.
 */
export function roosterArtMarginTiles(build: RoosterBuild): number {
  const figure = ROOSTER_FIGURES[build];
  const tile = figure.tileScale;
  const overhangPx = Math.max(
    figure.tileY,
    figure.tileX,
    figure.frameWidth - figure.tileX - tile,
    figure.frameHeight - figure.tileY - tile,
  );
  return Math.ceil(overhangPx / tile);
}

/** Warms one row of a build in every view, ahead of the frames it will be drawn on. */
export function prewarmRoosterRow(build: RoosterBuild, base: RoosterRowBase): void {
  if (!ROOSTER_RUNTIME_ROWS[build].includes(base)) return;
  for (const view of ROOSTER_VIEWS)
    prewarmFigureState(ROOSTER_FIGURES[build], roosterStateName(base, view));
}

/**
 * Where each build's eyes are, for the eye-shine the dark shows. Derived from
 * the rig's own head and the build's scale, never measured off pixels.
 */
export function roosterEyePlacement(build: RoosterBuild): EyePlacement {
  const rig = roosterEyeRig(build);
  const tiles = ROOSTER_CELLS[build].tilesPerUnit;
  return {
    sideForward: rig.side.x * tiles,
    sideHeight: rig.groundTileFraction + rig.side.y * tiles,
    sideSpacing: rig.sideSpacing * tiles,
    frontMirrors: false,
    frontAcross: rig.front.x * tiles,
    frontHeight: rig.groundTileFraction + rig.front.y * tiles,
    frontSpacing: rig.frontSpacing * tiles,
  };
}

// ── Thrown dumbbell ──────────────────────────────────────────────────────────

const THROWN_SPIN_RADIANS_PER_FRAME = 0.25;
const TRAIL_MIN_SPEED_PX = 0.5;
const TRAIL_SEGMENTS = 4;
const TRAIL_SPACING_TILES = 0.14;
const TRAIL_RADIUS_TILES = 0.14;
const TRAIL_PEAK_ALPHA = 0.15;
const TRAIL_COLOUR = '#888';
const THROWN_DUMBBELL_TILE_SCALE = 0.8;

/**
 * A dumbbell in flight. `age` is game frames since release and drives the spin
 * off the frame count, so a stall cannot jump it a quarter turn between draws.
 */
export function drawThrownDumbbell(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  camX: number,
  camY: number,
  s: number,
  vx: number,
  vy: number,
  age: number,
): void {
  const sx = wx - camX;
  const sy = wy - camY;
  const speed = Math.hypot(vx, vy);
  if (speed > TRAIL_MIN_SPEED_PX) {
    const nx = vx / speed;
    const ny = vy / speed;
    for (let i = 1; i <= TRAIL_SEGMENTS; i++) {
      ctx.save();
      ctx.globalAlpha = (TRAIL_PEAK_ALPHA * (TRAIL_SEGMENTS + 1 - i)) / TRAIL_SEGMENTS;
      ctx.fillStyle = TRAIL_COLOUR;
      ctx.beginPath();
      ctx.arc(
        sx - nx * i * s * TRAIL_SPACING_TILES,
        sy - ny * i * s * TRAIL_SPACING_TILES,
        s * TRAIL_RADIUS_TILES,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
  }
  const spinning: HandAnchor = { at: { x: 0, y: 0 }, angle: age * THROWN_SPIN_RADIANS_PER_FRAME };
  drawRoosterDumbbell(ctx, sx, sy, s * THROWN_DUMBBELL_TILE_SCALE, spinning, false);
}
