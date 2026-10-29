/**
 * The Giant Wasp, as a painted figure: the choreography, the cell geometry,
 * and the `FigureDef` the runtime cache and the review harness both draw
 * through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `giantWaspArt.ts` and
 * `giantWaspGore.ts`, whose skin painting is `mantidArt.ts`'s.
 *
 * Rows:
 *    hover / hover_side / hover_away   — the wingbeat-driven loop
 *    spit_windup / spit_windup_side / spit_windup_away
 *                                      — the rear-back charge before the acid
 *                                        actually launches
 *    sting / sting_side / sting_away   — the abdomen curls under and drives
 *                                        the stinger forward, landing on
 *                                        {@link STING_IMPACT_FRAME}
 *
 * plus one single-frame state per severed piece, which is how
 * `BodyPartGoreSystem` asks for them. The acid itself is not here: it is its
 * own pair of figures in `waspSpitFigure.ts`.
 *
 * The art invariants live in `scripts/gates-giant-wasp.ts`, which the review harness
 * runs: `npm run render:giant-wasp`.
 */

import {
  GIANT_WASP_BUILD,
  GROUND_Y,
  drawWaspAway,
  drawWaspFront,
  drawWaspSide,
  STING_STRIKE_END,
  restWaspPose,
  stingPose,
  windupPose,
  type WaspPose,
} from './giantWaspArt';
import { giantWaspGorePieces } from './giantWaspGore';
import type { Pt } from './mantidArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell the poses and the gore pieces are painted into, and where the
 * wasp's own tile sits inside it.
 *
 * These four numbers are measured off the widest pose plus padding, quantised,
 * and widened until a spinning gore piece clears the cell's inscribed circle;
 * `scripts/parity-figure-sheet.ts` proves the painter still fills exactly that
 * cell. The gates re-check that nothing paints against the edge, which is what
 * would say a pose has outgrown them.
 */
const FRAME_WIDTH = 112;
const FRAME_HEIGHT = 88;
const TILE_X = 24;
const TILE_Y = 25;

const HOVER_FRAMES = 8;
const WINDUP_FRAMES = 9;
/** A one-shot row samples its pose at the middle of each frame. */
const SHOT_SAMPLE_OFFSET = 0.5;
export const STING_FRAMES = 8;

/**
 * The frame the sting lands on and the AI deals its damage on: the first frame
 * sampled once the thrust is fully driven home. Derived from the pose's own
 * strike timing, so retiming the choreography moves the damage with it.
 */
export const STING_IMPACT_FRAME = Math.ceil(STING_STRIKE_END * STING_FRAMES - SHOT_SAMPLE_OFFSET);

function hoverPose(phase: number): WaspPose {
  const angle = phase * Math.PI * 2;
  return {
    ...restWaspPose(),
    bob: Math.sin(angle * 2) * 0.012,
    sway: Math.sin(angle) * 0.01,
    lean: Math.sin(angle) * 0.02,
    wingbeat: phase,
    wingSpread: 1,
    headPitch: Math.sin(angle) * 0.006,
    abdomenCurl: Math.sin(angle) * 0.03,
    legs: [
      { swing: Math.sin(angle) * 0.06, tuck: 0 },
      { swing: Math.sin(angle + 0.6) * 0.06, tuck: 0 },
      { swing: Math.sin(angle + 1.2) * 0.06, tuck: 0 },
    ],
    time: phase,
  };
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + SHOT_SAMPLE_OFFSET) / frameCount;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type View = 'front' | 'side' | 'away';
export type RowKind = 'loop' | 'oneShot';

/** What the wasp is doing in a row, before the row is resolved against a viewpoint. */
export type WaspAction = 'hover' | 'spit_windup' | 'sting';

export interface RowSpec {
  readonly name: string;
  readonly action: WaspAction;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: (t: number) => WaspPose;
}

const GORE_PIECES = giantWaspGorePieces();
const GORE_PIECE_SCALE = 1.3;

/** One action's choreography, shared by all three of its viewpoints. */
interface ActionSpec {
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number) => WaspPose;
}

const ACTION_SPECS = {
  hover: {
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  spit_windup: {
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
  sting: {
    frameCount: STING_FRAMES,
    kind: 'oneShot',
    pose: (f) => stingPose(shotProgress(f, STING_FRAMES)),
  },
} as const satisfies Record<WaspAction, ActionSpec>;

const WASP_ACTIONS: readonly WaspAction[] = ['hover', 'spit_windup', 'sting'];
const WASP_VIEWS: readonly View[] = ['front', 'side', 'away'];

const VIEW_SUFFIX = {
  front: '',
  side: '_side',
  away: '_away',
} as const satisfies Record<View, string>;

/** The state name of one action seen from one viewpoint: `sting`, `sting_side`, `sting_away`. */
function waspRowName(action: WaspAction, view: View): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

export const GIANT_WASP_ROWS: readonly RowSpec[] = WASP_ACTIONS.flatMap((action) =>
  WASP_VIEWS.map((view): RowSpec => ({
    name: waspRowName(action, view),
    action,
    view,
    ...ACTION_SPECS[action],
  })),
);

/** A wasp the size of a dog, so it reads as dangerous rather than as a nuisance. */
export const GIANT_WASP_SCALE = 1.4;

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

/** Pixels per tile unit a gore piece is painted at. */
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE * GIANT_WASP_SCALE;

// ── Gore placement ───────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/**
 * How far each gore piece is nudged so that its ink, not its authoring origin,
 * sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible pixels,
 * so a piece drawn off-centre in its cell orbits rather than tumbles. The
 * offsets are in the piece's own units, the same ones its `paint` is scaled by,
 * and they were measured from the painted ink of each piece. Measuring is
 * something only an offline pass can do, so the numbers are frozen here and
 * `scripts/gates-giant-wasp.ts` re-measures them on every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_head', pt(-0.05580357142857143, 0.030048076923076927)],
  ['gore_thorax', pt(0.06868131868131869, 0)],
  ['gore_abdomen', pt(0.060096153846153855, 0)],
  ['gore_stinger', pt(0.04292582417582418, 0.004292582417582418)],
  ['gore_wing', pt(0.034340659340659344, 0)],
  ['gore_leg', pt(0.04292582417582418, 0)],
  ['gore_antenna', pt(0.030048076923076927, 0.025755494505494508)],
  ['gore_entrails', pt(-0.05580357142857143, -0.004292582417582418)],
]);

function goreRecentreOf(state: string): Pt {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

function gorePieceOf(state: string): (typeof GORE_PIECES)[number] {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return GIANT_WASP_ROWS.find((row) => row.name === state);
}

function paintView(ctx: CanvasRenderingContext2D, view: View, pose: WaspPose): void {
  if (view === 'front') drawWaspFront(ctx, GIANT_WASP_BUILD, pose);
  else if (view === 'away') drawWaspAway(ctx, GIANT_WASP_BUILD, pose);
  else drawWaspSide(ctx, GIANT_WASP_BUILD, pose);
}

/**
 * Paints one cell of the wasp, in the cell's own pixels.
 *
 * A pose row is anchored on the centre of the creature's own tile, which is what
 * ties the art to the tile it hovers over, and the wasp's scale is applied
 * about its ground line so a bigger animal still hangs over that tile rather
 * than drifting off it. A gore piece is anchored at the cell's centre instead,
 * because the only thing that reads its cell is the spin the gore field applies
 * about that point.
 */
function paintWaspFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(
      FRAME_WIDTH / 2 + recentre.x * GORE_UNIT,
      FRAME_HEIGHT / 2 + recentre.y * GORE_UNIT,
    );
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx, GIANT_WASP_BUILD);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(FRAME_WIDTH / 2, TILE_Y + TILE_SCALE / 2);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(GIANT_WASP_SCALE, GIANT_WASP_SCALE);
  ctx.translate(0, -GROUND_Y);
  paintView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function waspStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of GIANT_WASP_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const GIANT_WASP_FIGURE: FigureDef = {
  id: 'giant_wasp',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(waspStateFrames()),
  paintFrame: paintWaspFrame,
};
