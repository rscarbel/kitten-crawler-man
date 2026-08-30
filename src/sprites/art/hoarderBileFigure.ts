/**
 * The Hoarder's bile in flight and the acid pool it leaves, as painted figures.
 *
 * Two figures rather than one: the bolus is a small tumbling projectile drawn
 * on its own flight angle, and the pool is a wide ground decal four times its
 * size. Sharing a cell would make every bolus in the air cost the pool's
 * footprint, which is nine times the pixels.
 *
 * There is no choreography layer here in the sense the creature figures have
 * one — an effect's "pose" is its frame index, and `hoarderBileArt.ts` already
 * takes that. All this module does is place each row's painter at its cell's
 * own anchor and declare the geometry the bake it replaces measured.
 *
 * The art invariants live in `scripts/gates-hoarder.ts`, which the review
 * harness runs: `npm run render:hoarder`.
 */

import {
  BOLUS_ANCHOR,
  BOLUS_FRAME_COUNT,
  BOLUS_FRAME_SIZE,
  FADE_FRAME_COUNT,
  FORM_FRAME_COUNT,
  POOL_ANCHOR,
  POOL_FRAME_COUNT,
  POOL_FRAME_SIZE,
  SPLASH_FRAME_COUNT,
  TILE_SCALE,
  drawAcidFade,
  drawAcidForm,
  drawAcidPoolLoop,
  drawAcidSplash,
  drawHoarderBile,
} from './hoarderBileArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/**
 * One row of an effect sheet: a painter that is handed the cell's anchor and
 * the frame's place in its own row.
 */
type EffectPainter = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
) => void;

interface EffectRow {
  readonly name: string;
  readonly frameCount: number;
  readonly paint: EffectPainter;
}

/**
 * Builds an effect figure whose cells are square and anchored at their own
 * centre, which is what both of these sheets baked.
 */
function effectFigure(
  id: string,
  frameSize: number,
  anchor: number,
  rows: readonly EffectRow[],
): FigureDef {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return {
    id,
    frameWidth: frameSize,
    frameHeight: frameSize,
    tileX: anchor,
    tileY: anchor,
    tileScale: TILE_SCALE,
    states: figureStates(frames),
    paintFrame: (ctx, state, frame) => {
      const row = byName.get(state);
      if (row === undefined) return;
      row.paint(ctx, anchor, anchor, frame, row.frameCount);
    },
  };
}

/** The bolus in flight: one looping row, drawn travelling +X and rotated by the caller. */
export const HOARDER_BILE_ARC_ROWS: readonly EffectRow[] = [
  { name: 'arc', frameCount: BOLUS_FRAME_COUNT, paint: drawHoarderBile },
];

/**
 * The pool's whole life, in the order it plays: the impact crown, the spread,
 * the boil it loops on, and the sink that leaves an etched stain. The rows hand
 * off byte-exactly — the last splash frame *is* the first form frame — so the
 * four read as one event rather than as four effects in a row.
 */
export const HOARDER_ACID_ROWS: readonly EffectRow[] = [
  { name: 'splash', frameCount: SPLASH_FRAME_COUNT, paint: drawAcidSplash },
  { name: 'form', frameCount: FORM_FRAME_COUNT, paint: drawAcidForm },
  { name: 'pool', frameCount: POOL_FRAME_COUNT, paint: drawAcidPoolLoop },
  { name: 'fade', frameCount: FADE_FRAME_COUNT, paint: drawAcidFade },
];

export const HOARDER_BILE_ARC_FIGURE: FigureDef = effectFigure(
  'hoarder_bile_arc',
  BOLUS_FRAME_SIZE,
  BOLUS_ANCHOR,
  HOARDER_BILE_ARC_ROWS,
);

export const HOARDER_ACID_FIGURE: FigureDef = effectFigure(
  'hoarder_acid',
  POOL_FRAME_SIZE,
  POOL_ANCHOR,
  HOARDER_ACID_ROWS,
);
