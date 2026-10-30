/**
 * People drawn by a painter of their own rather than from a citizen cast — a
 * crocodilian at a desk, an otter at a crossbow range — wrapped so a resident
 * stands, walks and talks through them exactly as a cast citizen does.
 *
 * Each entry adapts one existing bespoke painter to the citizen draw state,
 * mapping the actions a resident can be in onto the rows that painter has;
 * none paints a run, so each hurries in its walk. A
 * new bespoke resident is a new entry here plus `{ kind: 'bespoke', figure: id }`
 * as their `RESIDENT_LOOKS` entry in `residentFigures.ts`; nothing in
 * `Townsperson` or the occupant system changes.
 */

import type { CitizenAction, CitizenSpriteState } from './citizenFigure';
import type { CitizenSpeechStyle } from '../dialog/speakers';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import {
  NO_ROUTINE_ROWS,
  type RoutinePose,
  type RoutinePoseId,
  type RoutinePoseRow,
} from './routinePose';
import {
  JANITOR_TILES_PER_WALK_CYCLE,
  SYDNEY_TILES_PER_WALK_CYCLE,
  crocodilianWalkFrames,
  drawCrocodilianSprite,
  prewarmJanitor,
  prewarmSydney,
  type JanitorRow,
  type SydneyRow,
} from '../sprites/crocodilianSprite';
import {
  JANITOR_MOP_CYCLE_MS,
  JANITOR_MOP_STROKE_PROGRESS,
  JANITOR_WRING_DUNK_PROGRESS,
  JANITOR_WRING_DURATION_MS,
} from '../sprites/crocodilianTiming';
import {
  LORI_TILES_PER_WALK_CYCLE,
  drawLoriSprite,
  loriWalkFrames,
  prewarmLori,
  type LoriRow,
} from '../sprites/loriSprite';
import {
  STEVE_TILES_PER_WALK_CYCLE,
  drawSteveSprite,
  prewarmSteve,
  steveMuzzlePoint,
  steveWalkFrames,
  type SteveRow,
} from '../sprites/steveSprite';
import {
  BRANDON_WALK_TILES_PER_CYCLE,
  drawBrandonSprite,
  prewarmBrandon,
  type BrandonAction,
} from '../sprites/brandonSprite';
import { BRANDON_SALUTE_MS, BRANDON_WALK_FRAMES } from '../sprites/brandonTiming';
import {
  BAGGI_TILES_PER_WALK_CYCLE,
  baggiWalkFrames,
  drawBaggiSprite,
  prewarmBaggiSprite,
} from '../sprites/baggiSprite';
import type { BaggiRole } from '../sprites/art/baggiFigure';
import { ELF_TILES_PER_WALK_CYCLE, drawElfSprite, prewarmElf } from '../sprites/elfSprite';
import { WALK_FRAMES } from '../sprites/art/human/timing';
import {
  STEVE_AIM_FPS,
  STEVE_AIM_FRAMES,
  STEVE_RELOAD_DURATION_MS,
  STEVE_SHOOT_DURATION_MS,
  STEVE_SHOOT_RELEASE_PROGRESS,
} from '../sprites/steveTiming';

export interface BespokeResidentFigure {
  /**
   * Draws one frame with the figure's tile top-left at `sx`,`sy`, returning the
   * row drawn so an overhead icon or bubble can sit on the art's measured top.
   */
  readonly draw: (
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
    state: CitizenSpriteState,
  ) => DrawnFigureRow;
  /** Queues every row the resident can be drawn in, ahead of its first draw. */
  readonly prewarm: () => void;
  /** World pixels one walk cycle covers at `tileSize`, so the feet don't skate. */
  readonly walkCyclePx: (tileSize: number) => number;
  /** Frames in the walk row: the most one tick may advance the cycle is one of them. */
  readonly walkFrames: number;
  readonly speechStyle: CitizenSpeechStyle;
  /**
   * The row each routine pose is painted in and how long it runs, with where
   * its sound lands on the painted frames; or `'rest'` for a pose this figure
   * draws standing at rest.
   */
  readonly routinePoses: Readonly<Record<RoutinePoseId, RoutinePoseRow<string>>>;
  /**
   * Where a shot leaves the figure on its release beat, in tiles from its
   * tile's top-left, facing (`facingX`, `facingY`), so a launched projectile
   * starts on the painted weapon. Absent for a figure that shoots nothing.
   */
  readonly releasePoint?: (facingX: number, facingY: number) => TileOffset;
}

/** A point in tiles from a figure's tile top-left. */
export interface TileOffset {
  readonly x: number;
  readonly y: number;
}

const MS_PER_SECOND = 1000;
const FULL_TURN_RADIANS = Math.PI * 2;

/**
 * While he talks Brandon salutes again every this many milliseconds, standing
 * at ease between: one greeting per beat of the conversation, not a hand
 * stuck at his brow.
 */
const BRANDON_SALUTE_EVERY_MS = 4000;

/** Brandon's row for a citizen action: he greets whoever speaks to him with a salute. */
function brandonAction(action: CitizenAction): BrandonAction {
  switch (action) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'talk':
      return 'salute';
    case 'idle':
    case 'work':
      return 'idle';
    default:
      return unhandledAction(action);
  }
}

/**
 * The salute's progress at a clock time, or null in the at-ease stretch
 * between two salutes.
 */
function saluteProgressAt(clockMs: number): number | null {
  const into =
    ((clockMs % BRANDON_SALUTE_EVERY_MS) + BRANDON_SALUTE_EVERY_MS) % BRANDON_SALUTE_EVERY_MS;
  return into < BRANDON_SALUTE_MS ? into / BRANDON_SALUTE_MS : null;
}

function drawBrandonResident(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CitizenSpriteState,
): DrawnFigureRow {
  const clockMs = clockSeconds(state) * MS_PER_SECOND;
  const action = brandonAction(state.action);
  const salute = action === 'salute' ? saluteProgressAt(clockMs) : null;
  const atEase = action === 'salute' && salute === null;
  return drawBrandonSprite(ctx, sx, sy, tileSize, {
    action: atEase ? 'idle' : action,
    facingX: state.facingX,
    facingY: state.facingY,
    progress: action === 'walk' ? state.walkPhase / FULL_TURN_RADIANS : (salute ?? 0),
    clockMs,
  });
}

function sydneyRow(action: CitizenAction): SydneyRow {
  switch (action) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'talk':
      return 'talk';
    case 'idle':
    case 'work':
      return 'idle';
    default: {
      const unhandled: never = action;
      throw new Error(`unhandled citizen action ${String(unhandled)}`);
    }
  }
}

function unhandledAction(action: never): never {
  throw new Error(`unhandled citizen action ${String(action)}`);
}

/** Seconds on the page clock, offset per person so two of one figure never move in step. */
function clockSeconds(state: CitizenSpriteState): number {
  return performance.now() / MS_PER_SECOND + (state.loopOffsetSeconds ?? 0);
}

/** Old Lori talks as she stands: leaning on her cane, facing whoever spoke to her. */
function loriRow(action: CitizenAction): LoriRow {
  switch (action) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'idle':
    case 'talk':
    case 'work':
      return 'idle';
    default:
      return unhandledAction(action);
  }
}

/** Baggi has no work row of her own: at work she stands with her hands folded on the apron. */
function baggiRole(action: CitizenAction): BaggiRole {
  switch (action) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'talk':
      return 'talk';
    case 'idle':
    case 'work':
      return 'idle';
    default:
      return unhandledAction(action);
  }
}

/** The elf paints no talk or work row of its own: it stands at rest for both. */
function elfWalks(action: CitizenAction): boolean {
  switch (action) {
    case 'walk':
    case 'run':
      return true;
    case 'idle':
    case 'talk':
    case 'work':
      return false;
    default:
      return unhandledAction(action);
  }
}

/** The cellar elf never casts in town; its painter's cast progress stays at rest. */
const ELF_AT_REST_CAST = 0;

/** The row a figure stands in for a routine pose, falling back on its rest row. */
function poseRow<Row extends string>(
  rows: Readonly<Record<RoutinePoseId, RoutinePoseRow<Row>>>,
  pose: RoutinePose | undefined,
  rest: Row,
): Row {
  if (pose === undefined) return rest;
  const entry = rows[pose.id];
  return entry === 'rest' ? rest : entry.row;
}

/** The janitor's mop rows; a pose with no mop in it is his rest. */
const JANITOR_POSE_ROWS = {
  ...NO_ROUTINE_ROWS,
  mop: {
    row: 'mop',
    timing: { durationMs: JANITOR_MOP_CYCLE_MS, beats: JANITOR_MOP_STROKE_PROGRESS },
  },
  wring: {
    row: 'wring',
    timing: { durationMs: JANITOR_WRING_DURATION_MS, beats: [JANITOR_WRING_DUNK_PROGRESS] },
  },
} as const satisfies Record<RoutinePoseId, RoutinePoseRow<JanitorRow>>;

/** The janitor always has the mop to hand: he walks pushing it, and talks leaning on it. */
function janitorRow(action: CitizenAction, pose: RoutinePose | undefined): JanitorRow {
  switch (action) {
    case 'walk':
    case 'run':
      return 'walk_mop';
    case 'idle':
    case 'talk':
      return 'idle';
    case 'work':
      return poseRow(JANITOR_POSE_ROWS, pose, 'idle');
    default:
      return unhandledAction(action);
  }
}

/** The held aim loops on the clock, so one play of it is one pass of its breathing. */
const STEVE_AIM_LOOP_MS = (STEVE_AIM_FRAMES / STEVE_AIM_FPS) * MS_PER_SECOND;

/** Steve's crossbow rows; a pose with no crossbow in it is his rest. */
const STEVE_POSE_ROWS = {
  ...NO_ROUTINE_ROWS,
  aim: { row: 'aim', timing: { durationMs: STEVE_AIM_LOOP_MS, beats: [] } },
  shoot: {
    row: 'shoot',
    timing: { durationMs: STEVE_SHOOT_DURATION_MS, beats: [STEVE_SHOOT_RELEASE_PROGRESS] },
  },
  reload: {
    row: 'reload',
    // The crank's clicks run the whole reload, so its one recording starts with it.
    timing: { durationMs: STEVE_RELOAD_DURATION_MS, beats: [0] },
  },
} as const satisfies Record<RoutinePoseId, RoutinePoseRow<SteveRow>>;

function steveRow(action: CitizenAction, pose: RoutinePose | undefined): SteveRow {
  switch (action) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'idle':
    case 'talk':
      return 'idle';
    case 'work':
      return poseRow(STEVE_POSE_ROWS, pose, 'idle');
    default:
      return unhandledAction(action);
  }
}

export const BESPOKE_RESIDENT_FIGURES = {
  old_lori: {
    draw: (ctx, sx, sy, tileSize, state) =>
      drawLoriSprite(ctx, sx, sy, tileSize, {
        row: loriRow(state.action),
        facingX: state.facingX,
        facingY: state.facingY,
        walkPhase: state.walkPhase,
        timeSeconds: clockSeconds(state),
      }),
    prewarm: prewarmLori,
    walkCyclePx: (tileSize) => LORI_TILES_PER_WALK_CYCLE * tileSize,
    walkFrames: loriWalkFrames(),
    speechStyle: 'townsfolkFeminine',
    routinePoses: NO_ROUTINE_ROWS,
  },
  janitor: {
    draw: (ctx, sx, sy, tileSize, state) =>
      drawCrocodilianSprite(ctx, sx, sy, tileSize, {
        variant: 'janitor',
        row: janitorRow(state.action, state.routinePose),
        facingX: state.facingX,
        facingY: state.facingY,
        walkFrame: state.walkPhase,
        progress: state.routinePose?.progress ?? 0,
        elapsedSeconds: clockSeconds(state),
      }),
    prewarm: prewarmJanitor,
    walkCyclePx: (tileSize) => JANITOR_TILES_PER_WALK_CYCLE * tileSize,
    walkFrames: crocodilianWalkFrames('janitor'),
    speechStyle: 'townsfolkMasculine',
    routinePoses: JANITOR_POSE_ROWS,
  },
  steve_cartwright: {
    draw: (ctx, sx, sy, tileSize, state) =>
      drawSteveSprite(ctx, sx, sy, tileSize, {
        row: steveRow(state.action, state.routinePose),
        facingX: state.facingX,
        facingY: state.facingY,
        walkPhase: state.walkPhase,
        progress: state.routinePose?.progress ?? 0,
        timeSeconds: clockSeconds(state),
      }),
    prewarm: prewarmSteve,
    walkCyclePx: (tileSize) => STEVE_TILES_PER_WALK_CYCLE * tileSize,
    walkFrames: steveWalkFrames(),
    speechStyle: 'townsfolkMasculine',
    routinePoses: STEVE_POSE_ROWS,
    releasePoint: steveMuzzlePoint,
  },
  sydney: {
    draw: (ctx, sx, sy, tileSize, state) =>
      drawCrocodilianSprite(ctx, sx, sy, tileSize, {
        variant: 'sydney',
        row: sydneyRow(state.action),
        facingX: state.facingX,
        facingY: state.facingY,
        walkFrame: state.walkPhase,
        elapsedSeconds: performance.now() / MS_PER_SECOND + (state.loopOffsetSeconds ?? 0),
      }),
    prewarm: prewarmSydney,
    walkCyclePx: (tileSize) => SYDNEY_TILES_PER_WALK_CYCLE * tileSize,
    walkFrames: crocodilianWalkFrames('sydney'),
    speechStyle: 'townsfolkFeminine',
    routinePoses: NO_ROUTINE_ROWS,
  },
  brandon: {
    draw: drawBrandonResident,
    prewarm: prewarmBrandon,
    walkCyclePx: (tileSize) => BRANDON_WALK_TILES_PER_CYCLE * tileSize,
    walkFrames: BRANDON_WALK_FRAMES,
    speechStyle: 'townsfolkMasculine',
    routinePoses: NO_ROUTINE_ROWS,
  },
  baggi: {
    draw: (ctx, sx, sy, tileSize, state) =>
      drawBaggiSprite(ctx, sx, sy, tileSize, {
        role: baggiRole(state.action),
        facingX: state.facingX,
        facingY: state.facingY,
        walkPhase: state.walkPhase,
        timeSeconds: clockSeconds(state),
      }),
    prewarm: prewarmBaggiSprite,
    walkCyclePx: (tileSize) => BAGGI_TILES_PER_WALK_CYCLE * tileSize,
    walkFrames: baggiWalkFrames(),
    speechStyle: 'townsfolkFeminine',
    routinePoses: NO_ROUTINE_ROWS,
  },
  cellar_elf: {
    draw: (ctx, sx, sy, tileSize, state) =>
      drawElfSprite(
        ctx,
        sx,
        sy,
        tileSize,
        state.walkPhase,
        elfWalks(state.action),
        ELF_AT_REST_CAST,
        state.facingX,
        state.facingY,
        state.loopOffsetSeconds ?? 0,
      ),
    prewarm: prewarmElf,
    walkCyclePx: (tileSize) => ELF_TILES_PER_WALK_CYCLE * tileSize,
    walkFrames: WALK_FRAMES,
    speechStyle: 'townsfolkMasculine',
    routinePoses: NO_ROUTINE_ROWS,
  },
} as const satisfies Record<string, BespokeResidentFigure>;

export type BespokeResidentFigureId = keyof typeof BESPOKE_RESIDENT_FIGURES;

export function bespokeResidentFigure(id: BespokeResidentFigureId): BespokeResidentFigure {
  return BESPOKE_RESIDENT_FIGURES[id];
}
