/**
 * The Sky Fowl, as a painted figure: the choreography, the cell geometry, and
 * the `FigureDef`s the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else: one paint function per row, the
 * row table, and the placement of a row inside its cell. Anatomy, gait and
 * palette live in `skyFowlArt.ts`.
 *
 * **One figure per clothing palette.** A cached cell is keyed by figure, state
 * and frame, so a painter that takes a per-instance colour would serve whichever
 * fowl reached the cache first to every other fowl in town. The palettes are a
 * closed set of eight, so each one gets its own `FigureId` and the cache keeps
 * the key it was designed around. That also bounds the cost by the number of
 * palettes rather than by the number of birds: the five sheets this replaced
 * were composited into a full-sheet canvas *per instance*.
 *
 * The art invariants live in `scripts/gates-sky-fowl.ts`, which the review
 * harness runs: `npm run render:sky-fowl`.
 */

import { drawSkyFowlSprite, SKY_FOWL_PALETTES, type SkyFowlClothColors } from './skyFowlArt';
import { type FigureDef, type FigureId, figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * The cell each row is painted into, and where the creature's own tile sits
 * inside it.
 *
 * These five numbers were measured by the bake this figure replaces, and
 * `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 128;
const TILE_X = 16;
const TILE_Y = 16;
/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

const TAU = Math.PI * 2;

/** One full stride cycle, spread over the walk row. */
const WALK_FRAMES = 8;
/**
 * The peck sweep. The bake spread a 0–1 lunge across these frames with both
 * endpoints included, so the last frame is the lunge fully extended rather than
 * a frame short of it.
 */
const PECK_FRAMES = 6;

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  /** True when the last frame runs back into the first. */
  readonly loops: boolean;
  readonly paint: (ctx: CanvasRenderingContext2D, frame: number, cloth: SkyFowlClothColors) => void;
}

function paintAt(
  ctx: CanvasRenderingContext2D,
  cloth: SkyFowlClothColors,
  walkFrame: number,
  isMoving: boolean,
  isAggressive: boolean,
  peckAmt: number,
): void {
  drawSkyFowlSprite(
    ctx,
    TILE_X,
    TILE_Y,
    TILE_SCALE,
    walkFrame,
    isMoving,
    isAggressive,
    cloth,
    peckAmt,
  );
}

/** Sweeps a 0–1 parameter across a row with both endpoints included. */
function sweep(frame: number, frameCount: number): number {
  return frameCount === 1 ? 0 : frame / (frameCount - 1);
}

/**
 * Where in the stride cycle a walk frame sits, in radians.
 *
 * Exported because the pixels cannot say how much of a cycle the row covers: a
 * gait's pose distance saturates, so a row running one and a half turns wraps
 * by about as much as it steps and reads as an ordinary loop. The gate asserts
 * the coverage on this mapping instead, where the defect is unambiguous.
 */
export function stridePhase(frame: number): number {
  return (frame * TAU) / WALK_FRAMES;
}

export const SKY_FOWL_ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    loops: true,
    paint: (ctx, frame, cloth) => paintAt(ctx, cloth, stridePhase(frame), true, false, 0),
  },
  {
    name: 'idle',
    frameCount: 1,
    loops: false,
    paint: (ctx, _frame, cloth) => paintAt(ctx, cloth, 0, false, false, 0),
  },
  {
    name: 'peck',
    frameCount: PECK_FRAMES,
    loops: false,
    paint: (ctx, frame, cloth) => paintAt(ctx, cloth, 0, false, false, sweep(frame, PECK_FRAMES)),
  },
  {
    name: 'aggressive',
    frameCount: 1,
    loops: false,
    paint: (ctx, _frame, cloth) => paintAt(ctx, cloth, 0, false, true, 0),
  },
];

function rowNamed(state: string): RowSpec | undefined {
  return SKY_FOWL_ROWS.find((row) => row.name === state);
}

function skyFowlStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of SKY_FOWL_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

/** Builds the figure for one set of clothing colours. */
function skyFowlFigureOf(id: FigureId, cloth: SkyFowlClothColors): FigureDef {
  return {
    id,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: TILE_SCALE,
    states: figureStates(skyFowlStateFrames()),
    paintFrame: (ctx, state, frame) => {
      const row = rowNamed(state);
      if (row === undefined) return;
      row.paint(ctx, frame, cloth);
    },
  };
}

/**
 * One figure per palette, index-aligned with `SKY_FOWL_PALETTES`. The index is
 * in the id so a cache row can be read back to the bird wearing it.
 */
export const SKY_FOWL_FIGURES: readonly FigureDef[] = SKY_FOWL_PALETTES.map((cloth, index) =>
  skyFowlFigureOf(`sky_fowl_${index}`, cloth),
);
