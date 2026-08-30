/**
 * The Brindled Vespa, as a painted figure: the choreography, the cell geometry,
 * and the `FigureDef` the runtime cache and the review harness both draw
 * through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `brindledVespaArt.ts` and
 * `brindledVespaGore.ts`, whose skin painting is `mantidArt.ts`'s.
 *
 * Rows:
 *    hover / hover_side / hover_away   — the wingbeat-driven loop
 *    spit_windup / spit_windup_side / spit_windup_away
 *                                      — the rear-back charge before the acid
 *                                        actually launches
 *
 * plus one single-frame state per severed piece, which is how
 * `BodyPartGoreSystem` asks for them. The acid itself is not here: it is the
 * grub's own projectile art, drawn from its own sheets.
 *
 * The art invariants live in `scripts/gates-vespa.ts`, which the review harness
 * runs: `npm run render:vespa`.
 */

import {
  BRINDLED_VESPA_BUILD,
  GROUND_Y,
  drawVespaAway,
  drawVespaFront,
  drawVespaSide,
  restVespaPose,
  windupPose,
  type VespaPose,
} from './brindledVespaArt';
import { brindledVespaGorePieces } from './brindledVespaGore';
import type { Pt } from './mantidArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell the poses and the gore pieces are painted into, and where the
 * hornet's own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the widest
 * pose plus padding, quantised, widened until a spinning gore piece clears the
 * cell's inscribed circle — and `scripts/parity-figure-sheet.ts` is what proved
 * the painter still fills exactly that cell. The gates re-check that nothing
 * paints against the edge, which is what would say a pose has outgrown them.
 */
const FRAME_WIDTH = 112;
const FRAME_HEIGHT = 88;
const TILE_X = 24;
const TILE_Y = 25;

const HOVER_FRAMES = 8;
const WINDUP_FRAMES = 9;

function hoverPose(phase: number): VespaPose {
  const angle = phase * Math.PI * 2;
  return {
    ...restVespaPose(),
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
  return (frame + 0.5) / frameCount;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type View = 'front' | 'side' | 'away';
export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: (t: number) => VespaPose;
}

const GORE_PIECES = brindledVespaGorePieces();
const GORE_PIECE_SCALE = 1.3;

export const BRINDLED_VESPA_ROWS: readonly RowSpec[] = [
  {
    name: 'hover',
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  {
    name: 'hover_side',
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  {
    name: 'hover_away',
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    view: 'away',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  {
    name: 'spit_windup',
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
  {
    name: 'spit_windup_side',
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
  {
    name: 'spit_windup_away',
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    view: 'away',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
];

/** A hornet reads as dangerous at a size that visibly outsizes the grub stages. */
export const VESPA_SCALE = 1.4;

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

/** Pixels per tile unit a gore piece is painted at. */
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE * VESPA_SCALE;

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
 * `scripts/gates-vespa.ts` re-measures them on every render.
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
  return BRINDLED_VESPA_ROWS.find((row) => row.name === state);
}

function paintView(ctx: CanvasRenderingContext2D, view: View, pose: VespaPose): void {
  if (view === 'front') drawVespaFront(ctx, BRINDLED_VESPA_BUILD, pose);
  else if (view === 'away') drawVespaAway(ctx, BRINDLED_VESPA_BUILD, pose);
  else drawVespaSide(ctx, BRINDLED_VESPA_BUILD, pose);
}

/**
 * Paints one cell of the hornet, in the cell's own pixels.
 *
 * A pose row is anchored on the centre of the creature's own tile, which is what
 * ties the art to the tile it hovers over, and the hornet's scale is applied
 * about its ground line so a bigger animal still hangs over that tile rather
 * than drifting off it. A gore piece is anchored at the cell's centre instead,
 * because the only thing that reads its cell is the spin the gore field applies
 * about that point.
 */
function paintVespaFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
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
    piece.paint(ctx, BRINDLED_VESPA_BUILD);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(FRAME_WIDTH / 2, TILE_Y + TILE_SCALE / 2);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(VESPA_SCALE, VESPA_SCALE);
  ctx.translate(0, -GROUND_Y);
  paintView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function vespaStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of BRINDLED_VESPA_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const BRINDLED_VESPA_FIGURE: FigureDef = {
  id: 'brindled_vespa',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(vespaStateFrames()),
  paintFrame: paintVespaFrame,
};
