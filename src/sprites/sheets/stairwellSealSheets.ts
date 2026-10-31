/**
 * The stairwell seals' sheets, two per place a stairwell is cut into.
 *
 * The locked seal is all a floor shows until its key is forged, so it is a
 * one-frame sheet painted with the floor's own tileset group. The poses the
 * key takes it through, from the turn to the cover leaving, are a second
 * sheet that no group paints: the stairwell asks for it as a party carrying
 * the key comes near, and the idle sweep lets it go once nothing draws it.
 */

import type { AssetGroup } from '../../core/spriteAssets/assetGroups';
import type { SpriteKey } from '../../core/spriteAssets/SpriteLoader';
import type { StairwellStyleId } from '../art/stairwellArt';
import {
  SEAL_COVER_FRAMES,
  SEAL_MARGIN,
  SEAL_POSE_FRAMES,
  paintStairwellSeal,
  type SealFrameId,
} from '../art/stairwellSealArt';
import type { FramePainter, PropSheetPlan, PropSheetRow } from './propSheetPlan';
import { STAIRWELL_FRAME_PX } from './stairwellSheets';

const SEAL_LEFT_PX = Math.round(STAIRWELL_FRAME_PX * SEAL_MARGIN.left);
const SEAL_TOP_PX = Math.round(STAIRWELL_FRAME_PX * SEAL_MARGIN.top);
const SEAL_FRAME_WIDTH = Math.round(
  STAIRWELL_FRAME_PX * (1 + SEAL_MARGIN.left + SEAL_MARGIN.right),
);
const SEAL_FRAME_HEIGHT = Math.round(
  STAIRWELL_FRAME_PX * (1 + SEAL_MARGIN.top + SEAL_MARGIN.bottom),
);

/** Each place's two seal sheets, and the floor group whose arrival paints its locked one. */
export const STAIRWELL_SEAL_SHEETS = {
  cellars: {
    locked: 'stairwell_seal_locked_cellars',
    open: 'stairwell_seal_open_cellars',
    group: 'floor1_tileset',
  },
  service_level: {
    locked: 'stairwell_seal_locked_service_level',
    open: 'stairwell_seal_open_service_level',
    group: 'floor2_tileset',
  },
  street: {
    locked: 'stairwell_seal_locked_street',
    open: 'stairwell_seal_open_street',
    group: 'town',
  },
} as const satisfies Record<
  StairwellStyleId,
  { readonly locked: SpriteKey; readonly open: SpriteKey; readonly group: AssetGroup }
>;

function sealPlan(key: SpriteKey, rows: readonly PropSheetRow[]): PropSheetPlan {
  return {
    key,
    file: `${key}.png`,
    frameWidth: SEAL_FRAME_WIDTH,
    frameHeight: SEAL_FRAME_HEIGHT,
    tileX: SEAL_LEFT_PX,
    tileY: SEAL_TOP_PX,
    tileScale: STAIRWELL_FRAME_PX,
    rows,
  };
}

function painterOf(style: StairwellStyleId, frame: SealFrameId): FramePainter {
  return (ctx, originX, originY) =>
    paintStairwellSeal(ctx, originX, originY, STAIRWELL_FRAME_PX, style, frame);
}

/** The locked seal of a place: one frame. */
export function stairwellSealLockedPlan(style: StairwellStyleId): PropSheetPlan {
  return sealPlan(STAIRWELL_SEAL_SHEETS[style].locked, [
    { state: 'sealed', frames: [painterOf(style, 'sealed')] },
  ]);
}

/**
 * Every pose a place's seal goes through as it opens: the padlock and chains
 * on one row, the cover's drawn angles on another, so painting it is two
 * paced steps rather than one long one.
 */
export function stairwellSealOpenPlan(style: StairwellStyleId): PropSheetPlan {
  return sealPlan(STAIRWELL_SEAL_SHEETS[style].open, [
    { state: 'open', frames: SEAL_POSE_FRAMES.map((frame) => painterOf(style, frame)) },
    { state: 'cover', frames: SEAL_COVER_FRAMES.map((frame) => painterOf(style, frame)) },
  ]);
}
