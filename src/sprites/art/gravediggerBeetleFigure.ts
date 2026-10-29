/**
 * The Gravedigger Beetle's three life stages, as painted figures: the
 * choreography, the cell geometry, and the three `FigureDef`s the runtime cache
 * and the review harness both draw through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row tables, and the placement of a pose or a gore piece inside its cell.
 * Anatomy and palette live in `gravediggerBeetleArt.ts` (larva and pupa),
 * `gravediggerAdultArt.ts` and `gravediggerBeetleGore.ts`.
 *
 * Rows:
 *   larva  idle                         — the rest curl with a breath in it
 *          walk / walk_side / walk_away — the travelling wriggle
 *   pupa   pupa                         — one pulse of the sealed sac
 *          pupa_hatch                   — the sac splitting open
 *   adult  fly / fly_side / fly_away    — hovering on blurred wings
 *          bite / bite_side / bite_away — the mandibles gape, then snap shut on
 *                                         {@link BITE_IMPACT_FRAME}
 *          spit / spit_side / spit_away — it rears with fire in its jaws and
 *                                         whips forward on the release
 *
 * plus one single-frame state per severed piece of the adult, which is how
 * `BodyPartGoreSystem` asks for them. Neither the larva nor the pupa comes
 * apart into pieces: the generic gore burst is all a soft body leaves.
 *
 * The art invariants live in `scripts/gates-gravedigger-beetle.ts`, which the
 * review harness runs: `npm run render:gravedigger-beetle`.
 */

import {
  GROUND_Y as LARVA_GROUND_Y,
  drawLarva,
  drawPupa,
  larvaCrawlPose,
  larvaIdlePose,
  pupaHatchPose,
  pupaPulsePose,
  type LarvaPose,
  type LarvaView,
  type PupaPose,
} from './gravediggerBeetleArt';
import {
  BITE_SNAP_END,
  FRONT_EYE,
  GROUND_Y as ADULT_GROUND_Y,
  SIDE_EYE,
  bitePose,
  drawGravediggerBeetle,
  hoverPose,
  spitPose,
  type BeetlePose,
  type BeetleView,
} from './gravediggerAdultArt';
import { GRAVEDIGGER_BEETLE_GORE_PIECES } from './gravediggerBeetleGore';
import { type FigureDef, figureStates } from '../figure/figureDef';
import type { EyePlacement } from '../eyePlacement';
import {
  GRAVEDIGGER_SPIT_RELEASE_PROGRESS,
  GRAVEDIGGER_SPIT_THRUST_SHARE,
} from '../gravediggerBeetleSpitTiming';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/** A one-shot row samples its pose at the middle of each frame. */
const SHOT_SAMPLE_OFFSET = 0.5;

export type View = 'front' | 'side' | 'away';
export type RowKind = 'loop' | 'oneShot' | 'hold';

/** Anything a row samples; every pose carries the phase it was sampled at. */
export interface SampledPose {
  readonly time: number;
}

export interface RowSpec<P extends SampledPose = SampledPose> {
  readonly name: string;
  readonly frameCount: number;
  readonly view: View;
  readonly kind: RowKind;
  readonly pose: (frame: number) => P;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + SHOT_SAMPLE_OFFSET) / frameCount;
}

const VIEW_SUFFIX = {
  front: '',
  side: '_side',
  away: '_away',
} as const satisfies Record<View, string>;

const VIEWS: readonly View[] = ['front', 'side', 'away'];

/** The state name of one action seen from one viewpoint: `bite`, `bite_side`, `bite_away`. */
export function viewedRowName(action: string, view: View): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

// ── Cells ────────────────────────────────────────────────────────────────────

/**
 * The cell a stage's poses are painted into, and where its own tile sits
 * inside it. Measured from the widest pose plus padding and quantised;
 * `scripts/gates-gravedigger-beetle.ts` re-derives them from painted ink on
 * every render and prints the numbers to paste when the art outgrows them.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileY: number;
}

function figureFrom(
  id: string,
  cell: CellGeometry,
  frames: Record<string, number>,
  paintFrame: FigureDef['paintFrame'],
): FigureDef {
  return {
    id,
    frameWidth: cell.frameWidth,
    frameHeight: cell.frameHeight,
    tileX: cell.frameWidth / 2 - TILE_SCALE / 2,
    tileY: cell.tileY,
    tileScale: TILE_SCALE,
    states: figureStates(frames),
    paintFrame,
  };
}

function framesOf(rows: readonly RowSpec[]): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return frames;
}

/**
 * Anchors a pose on the centre of the creature's own tile and applies the
 * stage's scale about its ground line, so a bigger animal still sits on (or
 * hovers over) the tile it belongs to.
 */
function withPoseTransform(
  ctx: CanvasRenderingContext2D,
  cell: CellGeometry,
  groundY: number,
  scale: number,
  paint: () => void,
): void {
  ctx.save();
  ctx.translate(cell.frameWidth / 2, cell.tileY + TILE_SCALE / 2);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, groundY);
  ctx.scale(scale, scale);
  ctx.translate(0, -groundY);
  paint();
  ctx.restore();
}

// ── Larva ────────────────────────────────────────────────────────────────────

const LARVA_WALK_FRAMES = 8;
const LARVA_IDLE_FRAMES = 1;
/** A newly hatched larva: small, but big enough to read its curl at 32 px. */
export const LARVA_SCALE = 1.15;

function larvaWalkRow(view: View): RowSpec<LarvaPose> {
  return {
    name: viewedRowName('walk', view),
    frameCount: LARVA_WALK_FRAMES,
    view,
    kind: 'loop',
    pose: (frame) => larvaCrawlPose(cyclePhase(frame, LARVA_WALK_FRAMES)),
  };
}

export const LARVA_ROWS: readonly RowSpec<LarvaPose>[] = [
  // The curl is the larva's whole silhouette and reads best edge-on, so a
  // stopped larva shows it from the side whichever way it last faced.
  { name: 'idle', frameCount: LARVA_IDLE_FRAMES, view: 'side', kind: 'hold', pose: larvaIdlePose },
  ...VIEWS.map(larvaWalkRow),
];

const LARVA_CELL: CellGeometry = { frameWidth: 48, frameHeight: 48, tileY: -23 };

function paintLarvaFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = LARVA_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) return;
  const view: LarvaView = row.view;
  withPoseTransform(ctx, LARVA_CELL, LARVA_GROUND_Y, LARVA_SCALE, () => {
    drawLarva(ctx, row.pose(frame), view);
  });
}

export const GRAVEDIGGER_LARVA_FIGURE: FigureDef = figureFrom(
  'gravedigger_larva',
  LARVA_CELL,
  framesOf(LARVA_ROWS),
  paintLarvaFrame,
);

// ── Pupa ─────────────────────────────────────────────────────────────────────

export const PUPA_PULSE_STATE = 'pupa';
export const PUPA_HATCH_STATE = 'pupa_hatch';
const PUPA_PULSE_FRAMES = 8;
export const PUPA_HATCH_FRAMES = 8;
/** The sac is bigger than the larva that spun it: it holds a whole beetle. */
export const PUPA_SCALE = 1.25;

export const PUPA_ROWS: readonly RowSpec<PupaPose>[] = [
  {
    name: PUPA_PULSE_STATE,
    frameCount: PUPA_PULSE_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (frame) => pupaPulsePose(cyclePhase(frame, PUPA_PULSE_FRAMES)),
  },
  {
    name: PUPA_HATCH_STATE,
    frameCount: PUPA_HATCH_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (frame) => pupaHatchPose(shotProgress(frame, PUPA_HATCH_FRAMES)),
  },
];

const PUPA_CELL: CellGeometry = { frameWidth: 56, frameHeight: 64, tileY: -11 };

function paintPupaFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = PUPA_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) return;
  withPoseTransform(ctx, PUPA_CELL, LARVA_GROUND_Y, PUPA_SCALE, () => {
    drawPupa(ctx, row.pose(frame));
  });
}

export const GRAVEDIGGER_PUPA_FIGURE: FigureDef = figureFrom(
  'gravedigger_pupa',
  PUPA_CELL,
  framesOf(PUPA_ROWS),
  paintPupaFrame,
);

// ── Adult ────────────────────────────────────────────────────────────────────

/** What the adult is doing in a row, before the row is resolved against a viewpoint. */
export type BeetleAction = 'fly' | 'bite' | 'spit';

const FLY_FRAMES = 8;
export const BITE_FRAMES = 8;
const SPIT_FRAMES = 10;

/**
 * The frame the bite lands on and the AI deals its damage on: the first frame
 * sampled once the jaws have snapped shut. Derived from the pose's own timing,
 * so retiming the choreography moves the damage with it.
 */
export const BITE_IMPACT_FRAME = Math.ceil(BITE_SNAP_END * BITE_FRAMES - SHOT_SAMPLE_OFFSET);

const SPIT_THRUST_START = GRAVEDIGGER_SPIT_RELEASE_PROGRESS - GRAVEDIGGER_SPIT_THRUST_SHARE / 2;
const SPIT_THRUST_END = GRAVEDIGGER_SPIT_RELEASE_PROGRESS + GRAVEDIGGER_SPIT_THRUST_SHARE / 2;

interface ActionSpec {
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number) => BeetlePose;
}

const ACTION_SPECS = {
  fly: {
    frameCount: FLY_FRAMES,
    kind: 'loop',
    pose: (frame) => hoverPose(cyclePhase(frame, FLY_FRAMES)),
  },
  bite: {
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    pose: (frame) => bitePose(shotProgress(frame, BITE_FRAMES)),
  },
  spit: {
    frameCount: SPIT_FRAMES,
    kind: 'oneShot',
    pose: (frame) => spitPose(shotProgress(frame, SPIT_FRAMES), SPIT_THRUST_START, SPIT_THRUST_END),
  },
} as const satisfies Record<BeetleAction, ActionSpec>;

export const BEETLE_ACTIONS: readonly BeetleAction[] = ['fly', 'bite', 'spit'];
export const BEETLE_VIEWS: readonly View[] = VIEWS;

export const ADULT_ROWS: readonly RowSpec<BeetlePose>[] = BEETLE_ACTIONS.flatMap((action) =>
  VIEWS.map((view): RowSpec<BeetlePose> => ({
    name: viewedRowName(action, view),
    view,
    ...ACTION_SPECS[action],
  })),
);

/** A beetle the size of a dog, so it reads as the threat the larva grew into. */
export const ADULT_SCALE = 1.4;

const ADULT_CELL: CellGeometry = { frameWidth: 88, frameHeight: 80, tileY: 21 };

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GRAVEDIGGER_BEETLE_GORE_PIECES.map(
  (piece) => piece.state,
);
const GORE_PIECE_SCALE = 1.3;
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE * ADULT_SCALE;

function paintAdultFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = ADULT_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) {
    const piece = GRAVEDIGGER_BEETLE_GORE_PIECES.find((candidate) => candidate.state === state);
    if (piece === undefined) return;
    ctx.save();
    ctx.translate(ADULT_CELL.frameWidth / 2, ADULT_CELL.frameHeight / 2);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  const view: BeetleView = row.view;
  withPoseTransform(ctx, ADULT_CELL, ADULT_GROUND_Y, ADULT_SCALE, () => {
    drawGravediggerBeetle(ctx, row.pose(frame), view);
  });
}

function adultStateFrames(): Record<string, number> {
  const frames = framesOf(ADULT_ROWS);
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const GRAVEDIGGER_BEETLE_FIGURE: FigureDef = figureFrom(
  'gravedigger_beetle',
  ADULT_CELL,
  adultStateFrames(),
  paintAdultFrame,
);

// ── Eyes ─────────────────────────────────────────────────────────────────────

const TILE_CENTRE = 0.5;

/** A painted point's height from the top of the tile, after the stage's scale about its ground line. */
function tileHeightOf(y: number): number {
  return TILE_CENTRE + ADULT_GROUND_Y + (y - ADULT_GROUND_Y) * ADULT_SCALE;
}

/**
 * Where the adult's eyes are, for eye-shine in the dark, derived from the
 * painter's own head constants so it follows the art. The two ground stages
 * are blind litter on the floor and show none.
 */
export const GRAVEDIGGER_BEETLE_EYES: EyePlacement = {
  sideForward: SIDE_EYE.x * ADULT_SCALE,
  sideHeight: tileHeightOf(SIDE_EYE.y),
  sideSpacing: FRONT_EYE.x * ADULT_SCALE * 0.5,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: tileHeightOf(FRONT_EYE.y),
  frontSpacing: FRONT_EYE.x * 2 * ADULT_SCALE,
};
