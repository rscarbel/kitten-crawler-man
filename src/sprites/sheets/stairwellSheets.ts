/**
 * The floor-exit stairwell's sheet: one row per place a stairwell is cut into,
 * each a single frame covering the whole two-by-two footprint.
 *
 * Every row is painted on every floor, because the sheet is `core` art kept
 * across floor changes and the three frames together are small; the draw site
 * picks the row for where it is standing.
 */

import { paintStairwell, type StairwellStyleId } from '../art/stairwellArt';
import type { PropSheetPlan, PropSheetRow } from './propSheetPlan';

/**
 * Source pixels across the whole footprint. Twice the footprint's size in game
 * pixels, so the joints and nosings survive the downscale as soft single pixels.
 */
export const STAIRWELL_FRAME_PX = 128;

const STAIRWELL_ROWS: ReadonlyArray<StairwellStyleId> = ['cellars', 'service_level', 'street'];

export function stairwellSheetPlans(): PropSheetPlan[] {
  const rows: PropSheetRow[] = STAIRWELL_ROWS.map((style) => ({
    state: style,
    frames: [
      (ctx, originX, originY) => paintStairwell(ctx, originX, originY, STAIRWELL_FRAME_PX, style),
    ],
  }));
  return [
    {
      key: 'stairwell',
      file: 'stairwell.png',
      frameWidth: STAIRWELL_FRAME_PX,
      frameHeight: STAIRWELL_FRAME_PX,
      tileX: 0,
      tileY: 0,
      tileScale: STAIRWELL_FRAME_PX,
      rows,
    },
  ];
}
