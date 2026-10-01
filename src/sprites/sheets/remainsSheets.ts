/**
 * Which pictures the dead of the cellars carry: the walkable bone scatter, the
 * bone pile and the slumped skeleton.
 *
 * The scatter is a floor decal baked into the tile chunks, so its frame is
 * exactly one tile and every look stays inside it. The heap and the skeleton
 * are breakable props on the same envelope and rows as a barrel or a crate.
 */

import {
  BONE_SCATTER_VARIANTS,
  drawRemainsProp,
  paintBoneScatter,
  type RemainsKind,
} from '../art/remainsArt';
import {
  BOXED_PROP_ENVELOPE,
  DESTRUCTIBLE_PROP_TILE_SCALE,
  STATIC_PROP_STATES,
  breakablePropSheet,
} from './destructiblePropSheets';
import type { FramePainter, PropSheetPlan } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

const BREAKABLE_KINDS: ReadonlyArray<RemainsKind & SpriteKey> = ['bone_pile', 'slumped_skeleton'];

function boneScatterSheet(): PropSheetPlan {
  const frames: FramePainter[] = [];
  for (let look = 0; look < BONE_SCATTER_VARIANTS; look++) {
    frames.push((ctx, originX, originY) => {
      paintBoneScatter(ctx, originX, originY, DESTRUCTIBLE_PROP_TILE_SCALE, look);
    });
  }
  return {
    key: 'bone_scatter',
    file: 'bone_scatter.png',
    tileScale: DESTRUCTIBLE_PROP_TILE_SCALE,
    frameWidth: DESTRUCTIBLE_PROP_TILE_SCALE,
    frameHeight: DESTRUCTIBLE_PROP_TILE_SCALE,
    tileX: 0,
    tileY: 0,
    rows: [{ state: 'idle', frames }],
  };
}

/** Every remains sheet. Unseeded: the looks are picked per tile at draw time. */
export function remainsSheetPlans(): PropSheetPlan[] {
  return [
    boneScatterSheet(),
    ...BREAKABLE_KINDS.map((kind) =>
      breakablePropSheet(
        kind,
        BOXED_PROP_ENVELOPE,
        STATIC_PROP_STATES,
        (ctx, state, frame, x, y, ts) => drawRemainsProp(ctx, kind, state, frame, x, y, ts),
      ),
    ),
  ];
}
