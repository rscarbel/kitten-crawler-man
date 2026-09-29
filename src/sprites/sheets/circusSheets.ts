/**
 * Which pictures the circus grounds' structure sheets carry: the tents, the
 * entry arch's posts and the rim's lamps, wagons, booths and crates.
 *
 * One sheet per footprint shape, as for Briar Hollow's props
 * (`villageSheets.ts`): `SpriteLoader` gives a sheet one frame envelope, and a
 * structure's frame must be exactly as wide as the footprint it blocks so ink
 * running sideways onto walkable ground can be caught. Within a sheet each
 * structure is a row, and each variant a frame.
 *
 * Every frame is anchored on the structure's drawing tile — the footprint's
 * bottom row, so a tent sorts on its foot — and the art spreads up from the
 * footprint by the sheet's headroom. The Big Top's drawing tile is its second
 * column, because the ellipse of its base leaves the first column's bottom
 * tile open ground; its frame still starts at the footprint's west edge.
 *
 * Unseeded: a tent is the same tent on every floor it stands on, and the
 * circus's look varies only in the weathering its painters draw from their
 * own fixed seeds.
 *
 * Live dressing — pennants, the light spilling out of the Big Top's door — is
 * drawn over these frames at runtime rather than baked as extra rows, because
 * an overlay row costs a full frame of memory per cell however little of it
 * is inked.
 */

import type { SpriteKey } from '../../core/SpriteLoader';
import { CIRCUS_STRUCTURES, type CircusStructureId } from '../../map/overworld/circusGroundsLayout';
import { subSeed, mulberry32 } from '../person/rng';
import { CIRCUS_STRUCTURE_ART, CIRCUS_TILE_SCALE } from '../art/circusArt';
import type { FrameEdge, FramePainter, PropSheetPlan } from './propSheetPlan';

interface CircusSheetSpec {
  readonly key: SpriteKey;
  readonly structures: ReadonlyArray<CircusStructureId>;
}

/**
 * The sheets, in paint order. A structure's row order is its order here, and
 * the manifest must agree — `propSheetPlanMismatches` holds the two together.
 */
export const CIRCUS_SHEETS: ReadonlyArray<CircusSheetSpec> = [
  { key: 'circus_big_top', structures: ['big_top'] },
  {
    key: 'circus_pavilion',
    structures: ['pavilion_mold_lion', 'pavilion_feats_of_flesh', 'pavilion_fortunes'],
  },
  { key: 'circus_arch_post', structures: ['arch_post'] },
  { key: 'circus_rim_post', structures: ['flame_lamp', 'high_striker'] },
  { key: 'circus_wagon', structures: ['cage_wagon', 'clown_caravan', 'prop_wagon'] },
  { key: 'circus_booth', structures: ['ticket_booth', 'game_booth', 'crate_stack'] },
];

/**
 * A fixed literal base for every structure's seed. Never derived from a row,
 * so adding a structure re-rolls nothing else.
 */
const CIRCUS_STRUCTURE_SEED = 0xc1a05e;

/** Every frame's contact shadow pools against the footprint's bottom edge, which is the frame's. */
export const CIRCUS_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['bottom']);

const sheetByStructure = new Map<CircusStructureId, CircusSheetSpec>();
for (const sheet of CIRCUS_SHEETS) {
  const shapes = new Set(
    sheet.structures.map((id) => {
      const spec = CIRCUS_STRUCTURES[id];
      return `${spec.w}x${spec.h}:${spec.drawTile.dx},${spec.drawTile.dy}:${CIRCUS_STRUCTURE_ART[id].headroomTiles}`;
    }),
  );
  if (shapes.size !== 1) throw new Error(`${sheet.key} mixes structures of different envelopes`);
  for (const id of sheet.structures) {
    if (sheetByStructure.has(id)) throw new Error(`${id} is on two circus sheets`);
    sheetByStructure.set(id, sheet);
  }
}

/** The sheet and row a structure is drawn from. */
export function circusStructureSheet(id: CircusStructureId): {
  readonly key: SpriteKey;
  readonly state: CircusStructureId;
} {
  const sheet = sheetByStructure.get(id);
  if (sheet === undefined) throw new Error(`circus structure ${id} has no sheet`);
  return { key: sheet.key, state: id };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A stable number per structure id, so a structure's seed does not depend on its row. */
function hashId(id: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash;
}

function sheetPlan(sheet: CircusSheetSpec): PropSheetPlan {
  const first = CIRCUS_STRUCTURES[sheet.structures[0]];
  const headroom = CIRCUS_STRUCTURE_ART[sheet.structures[0]].headroomTiles;
  const ts = CIRCUS_TILE_SCALE;
  const frameHeight = (first.h + headroom) * ts;
  return {
    key: sheet.key,
    file: `${sheet.key}.png`,
    frameWidth: first.w * ts,
    frameHeight,
    tileX: first.drawTile.dx * ts,
    tileY: frameHeight - (first.h - first.drawTile.dy) * ts,
    tileScale: ts,
    rows: sheet.structures.map((id) => {
      const art = CIRCUS_STRUCTURE_ART[id];
      return {
        state: id,
        frames: Array.from(
          { length: art.variants },
          (_unused, variant): FramePainter =>
            (ctx, originX, originY) => {
              const seed = subSeed(subSeed(CIRCUS_STRUCTURE_SEED, hashId(id)), variant);
              art.paint(ctx, { originX, originY, tileScale: ts }, variant, mulberry32(seed));
            },
        ),
      };
    }),
  };
}

/** Every circus structure sheet. */
export function circusSheetPlans(): PropSheetPlan[] {
  return CIRCUS_SHEETS.map(sheetPlan);
}
