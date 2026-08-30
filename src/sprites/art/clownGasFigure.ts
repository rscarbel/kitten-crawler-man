/**
 * The Evil Clown's gas vials as painted figures: the bottle in flight, the
 * shatter, and the cloud it leaves on the ground.
 *
 * Painting lives in `clownGasArt.ts`; this module is the cell geometry, the
 * frame counts and the `FigureDef` the runtime cache draws through. The cells
 * are sized from each effect's own declared reach rather than restated, so an
 * effect that grows takes its cell with it — and `scripts/gates-clowns.ts`
 * re-measures the painted ink against those same reaches, which is what says
 * the declared reach is still the truth.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  GAS_RADIUS,
  SHATTER_REACH,
  VIAL_HALF_HEIGHT,
  drawClownGas,
  drawClownVial,
  drawClownVialShatter,
} from './clownGasArt';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/** Pixels of clear space kept around each effect's own reach. */
export const FRAME_PADDING = 10;

function cellSize(reachTiles: number): number {
  const span = Math.ceil(reachTiles * TILE_SCALE + FRAME_PADDING) * 2;
  // Even sizes only, so the centre anchor lands on a whole pixel.
  return span % 2 === 0 ? span : span + 1;
}

/**
 * The vial trails gas *below* itself, so its cell has to reach further down
 * than the bottle alone does.
 */
export const VIAL_TRAIL_REACH = 0.45;

export const VIAL_REACH = Math.max(VIAL_HALF_HEIGHT, VIAL_TRAIL_REACH);
const VIAL_CELL = cellSize(VIAL_REACH);
const SHATTER_CELL = cellSize(SHATTER_REACH);
const GAS_CELL = cellSize(GAS_RADIUS);

export const VIAL_FRAMES = 8;
export const SHATTER_FRAMES = 10;
export const GAS_FRAMES = 8;

/** The one state each of these single-row effects paints. */
export const VIAL_STATE = 'fly';
export const SHATTER_STATE = 'shatter';
export const GAS_STATE = 'billow';

/** A lingering cloud is drawn at full strength; the caller fades it. */
const GAS_FULL_STRENGTH = 1;

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

interface GasSpec {
  readonly id: string;
  readonly state: string;
  readonly cell: number;
  readonly frames: number;
  readonly reach: number;
  readonly paint: (ctx: CanvasRenderingContext2D, frame: number) => void;
}

function figureOf(spec: GasSpec): FigureDef {
  const anchor = spec.cell / 2;
  return {
    id: spec.id,
    frameWidth: spec.cell,
    frameHeight: spec.cell,
    tileX: anchor,
    tileY: anchor,
    tileScale: TILE_SCALE,
    states: figureStates({ [spec.state]: spec.frames }),
    paintFrame: (ctx, state, frame) => {
      if (state !== spec.state) throw new Error(`${spec.id} paints no state "${state}"`);
      ctx.save();
      ctx.translate(anchor, anchor);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      spec.paint(ctx, frame);
      ctx.restore();
    },
  };
}

const VIAL_SPEC: GasSpec = {
  id: 'evil_clown_vial',
  state: VIAL_STATE,
  cell: VIAL_CELL,
  frames: VIAL_FRAMES,
  reach: VIAL_REACH,
  paint: (ctx, frame) => {
    drawClownVial(ctx, cyclePhase(frame, VIAL_FRAMES));
  },
};

const SHATTER_SPEC: GasSpec = {
  id: 'evil_clown_shatter',
  state: SHATTER_STATE,
  cell: SHATTER_CELL,
  frames: SHATTER_FRAMES,
  reach: SHATTER_REACH,
  paint: (ctx, frame) => {
    drawClownVialShatter(ctx, shotProgress(frame, SHATTER_FRAMES));
  },
};

const GAS_SPEC: GasSpec = {
  id: 'evil_clown_gas',
  state: GAS_STATE,
  cell: GAS_CELL,
  frames: GAS_FRAMES,
  reach: GAS_RADIUS,
  paint: (ctx, frame) => {
    drawClownGas(ctx, cyclePhase(frame, GAS_FRAMES), GAS_FULL_STRENGTH);
  },
};

export const CLOWN_VIAL_FIGURE = figureOf(VIAL_SPEC);
export const CLOWN_SHATTER_FIGURE = figureOf(SHATTER_SPEC);
export const CLOWN_GAS_FIGURE = figureOf(GAS_SPEC);

/** Each gas figure beside the reach its cell was sized from, for the gates. */
export const CLOWN_GAS_FIGURES: ReadonlyArray<{ readonly def: FigureDef; readonly reach: number }> =
  [
    { def: CLOWN_VIAL_FIGURE, reach: VIAL_SPEC.reach },
    { def: CLOWN_SHATTER_FIGURE, reach: SHATTER_SPEC.reach },
    { def: CLOWN_GAS_FIGURE, reach: GAS_SPEC.reach },
  ];

/** The cell an effect of the given reach is painted into, for the gates. */
export function clownGasCellSize(reachTiles: number): number {
  return cellSize(reachTiles);
}
