/**
 * The two Brindle Grub instars, as painted figures: the choreography, the cell
 * geometry, and the two `FigureDef`s the runtime cache and the review harness
 * both draw through.
 *
 * One drawing engine, two builds, two scales — the biting second instar is the
 * same animal as the larva it hatched out of, running the same rows, except that
 * only it carries the bite and the tail the name promises. This module is
 * choreography and nothing else: one pose function per row, the row table, and
 * the placement of a pose inside its cell. Anatomy and palette live in
 * `grubArt.ts`, whose skin painting is `mantidArt.ts`'s.
 *
 * Rows:
 *    idle                              — a single breathing hold
 *    walk / walk_side / walk_away      — the peristaltic crawl
 *    attack / attack_side / attack_away  (cow-tailed grub only) — the bite
 *
 * Neither instar comes apart into severed pieces: `BrindleGrub` leaves both
 * squishy stages to the generic gore burst, and only the Vespa the second one
 * evolves into carries a body-part set.
 *
 * The art invariants live in `scripts/gates-grub.ts`, which the review harness
 * runs: `npm run render:grub`.
 */

import {
  BRINDLE_GRUB_BUILD,
  COW_TAILED_GRUB_BUILD,
  GROUND_Y,
  bitePose,
  drawGrubAway,
  drawGrubFront,
  drawGrubSide,
  restGrubPose,
  type GrubBuild,
  type GrubPose,
} from './grubArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

const WALK_FRAMES = 8;
const IDLE_FRAMES = 1;
const ATTACK_FRAMES = 7;

const IDLE_BREATHE_PHASE = 0.3;

function idlePose(): GrubPose {
  return { ...restGrubPose(), breathe: IDLE_BREATHE_PHASE };
}

function walkPose(phase: number): GrubPose {
  return { ...restGrubPose(), crawlPhase: phase, sway: Math.sin(phase * Math.PI * 2), time: phase };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'away';

export type RowKind = 'loop' | 'oneShot' | 'hold';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: View;
  readonly kind: RowKind;
  readonly pose: (t: number) => GrubPose;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const SHARED_ROWS: readonly RowSpec[] = [
  { name: 'idle', frameCount: IDLE_FRAMES, view: 'front', kind: 'hold', pose: () => idlePose() },
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    view: 'front',
    kind: 'loop',
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    view: 'side',
    kind: 'loop',
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    view: 'away',
    kind: 'loop',
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
];

const BITE_ROWS: readonly RowSpec[] = [
  {
    name: 'attack',
    frameCount: ATTACK_FRAMES,
    view: 'front',
    kind: 'oneShot',
    pose: (f) => bitePose(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'attack_side',
    frameCount: ATTACK_FRAMES,
    view: 'side',
    kind: 'oneShot',
    pose: (f) => bitePose(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'attack_away',
    frameCount: ATTACK_FRAMES,
    view: 'away',
    kind: 'oneShot',
    pose: (f) => bitePose(shotProgress(f, ATTACK_FRAMES)),
  },
];

// ── Variants ─────────────────────────────────────────────────────────────────

export type VariantId = 'brindle_grub' | 'cow_tailed_grub';

/**
 * The cell a variant's poses are painted into, and where its own tile sits
 * inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the widest
 * pose plus padding, quantised — and `scripts/parity-figure-sheet.ts` is what
 * proved the painters still fill exactly those cells. `scripts/gates-grub.ts`
 * re-measures the ink and re-derives them on every render.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface GrubVariant {
  readonly id: VariantId;
  readonly build: GrubBuild;
  /**
   * How much of a tile the animal fills, scaled about its own ground line so its
   * underside stays on the tile it belongs to.
   */
  readonly scale: number;
  readonly rows: readonly RowSpec[];
  readonly cell: CellGeometry;
}

/** The first instar is a small but clearly-detailed larva. */
const BRINDLE_GRUB_SCALE = 0.95;
/** The second instar has visibly grown, tail and all. */
const COW_TAILED_GRUB_SCALE = 1.25;

export const BRINDLE_GRUB_VARIANT: GrubVariant = {
  id: 'brindle_grub',
  build: BRINDLE_GRUB_BUILD,
  scale: BRINDLE_GRUB_SCALE,
  rows: SHARED_ROWS,
  cell: { frameWidth: 56, frameHeight: 48, tileX: -4, tileY: -26 },
};

export const COW_TAILED_GRUB_VARIANT: GrubVariant = {
  id: 'cow_tailed_grub',
  build: COW_TAILED_GRUB_BUILD,
  scale: COW_TAILED_GRUB_SCALE,
  rows: [...SHARED_ROWS, ...BITE_ROWS],
  cell: { frameWidth: 88, frameHeight: 72, tileX: 12, tileY: -10 },
};

export const GRUB_VARIANTS: readonly GrubVariant[] = [
  BRINDLE_GRUB_VARIANT,
  COW_TAILED_GRUB_VARIANT,
];

export function grubVariantById(id: string): GrubVariant {
  const found = GRUB_VARIANTS.find((variant) => variant.id === id);
  if (found === undefined) throw new Error(`no grub variant named "${id}"`);
  return found;
}

// ── Painting ─────────────────────────────────────────────────────────────────

function rowOf(variant: GrubVariant, state: string): RowSpec | undefined {
  return variant.rows.find((row) => row.name === state);
}

function paintView(
  ctx: CanvasRenderingContext2D,
  view: View,
  build: GrubBuild,
  pose: GrubPose,
): void {
  if (view === 'front') drawGrubFront(ctx, build, pose);
  else if (view === 'away') drawGrubAway(ctx, build, pose);
  else drawGrubSide(ctx, build, pose);
}

/**
 * Paints one cell of a grub, in the cell's own pixels.
 *
 * The pose is anchored on the centre of the animal's own tile, which is what
 * ties the art to the tile it crawls on, and the instar's scale is applied about
 * its ground line so the bigger one still lies on that tile rather than
 * floating above it.
 */
function paintGrubFrame(
  variant: GrubVariant,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const row = rowOf(variant, state);
  if (row === undefined) return;
  const { cell } = variant;
  ctx.save();
  ctx.translate(cell.frameWidth / 2, cell.tileY + TILE_SCALE / 2);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(variant.scale, variant.scale);
  ctx.translate(0, -GROUND_Y);
  paintView(ctx, row.view, variant.build, row.pose(frame));
  ctx.restore();
}

function stateFramesOf(variant: GrubVariant): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of variant.rows) frames[row.name] = row.frameCount;
  return frames;
}

function figureOf(variant: GrubVariant): FigureDef {
  return {
    id: variant.id,
    frameWidth: variant.cell.frameWidth,
    frameHeight: variant.cell.frameHeight,
    tileX: variant.cell.tileX,
    tileY: variant.cell.tileY,
    tileScale: TILE_SCALE,
    states: figureStates(stateFramesOf(variant)),
    paintFrame: (ctx, state, frame) => {
      paintGrubFrame(variant, ctx, state, frame);
    },
  };
}

export const BRINDLE_GRUB_FIGURE: FigureDef = figureOf(BRINDLE_GRUB_VARIANT);
export const COW_TAILED_GRUB_FIGURE: FigureDef = figureOf(COW_TAILED_GRUB_VARIANT);

/** The figure a variant name selects, for code that holds one of the two names. */
export function grubFigureOf(id: VariantId): FigureDef {
  return id === 'brindle_grub' ? BRINDLE_GRUB_FIGURE : COW_TAILED_GRUB_FIGURE;
}
