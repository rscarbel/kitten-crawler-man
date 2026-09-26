/**
 * Which pictures Briar Hollow's prop sheets carry.
 *
 * One sheet per footprint shape, because `SpriteLoader` gives a sheet one frame
 * envelope and a prop's frame must be exactly as wide as the tiles it blocks:
 * a two-tile table in a four-tile frame could not be checked for ink running
 * sideways onto walkable ground. Within a sheet each prop is a row (its state
 * is its prop id) and each variant is a frame.
 *
 * A sheet is as wide as its longest row, so the props that come in several
 * variants sit on sheets of their own: on one shared sheet, every
 * single-variant row would pay for the widest row's empty cells.
 *
 * Every frame is anchored on the footprint's **bottom-left** tile — `tileX` is
 * zero and the anchor tile is the frame's bottom row — so a prop Y-sorts on
 * its foot and its art spreads right and up from there. Headroom above the
 * footprint is how tall a prop may stand, and is chosen per sheet: a table
 * needs a tile, a lamp post two, the bell tower three.
 *
 * Animated and stateful dressing (the bell's swing, the sawmill blade, a
 * hearth's flicker, the tools on Oren's rack) is drawn live over these frames
 * by `VillageAmbience`, not baked as extra rows: an overlay row costs a full
 * frame of memory per cell however little of it is inked.
 */

import type { SpriteKey } from '../../core/SpriteLoader';
import { allocReadableCanvas, surfaceContext } from '../../core/canvasSurface';
import { VILLAGE_PROPS } from '../../map/overworld/briarHollowLayout';
import { mulberry32, subSeed } from '../person/rng';
import {
  VILLAGE_TILE_SCALE,
  type VillagePropArt,
  type VillageStandingPropId,
} from '../art/villageArt';
import { INDOOR_PROP_ART } from '../art/villageIndoorArt';
import { OUTDOOR_PROP_ART } from '../art/villageOutdoorArt';
import type { FrameEdge, FramePainter, PropSheetPlan } from './propSheetPlan';

const VILLAGE_PROP_ART: Readonly<Record<VillageStandingPropId, VillagePropArt>> = {
  ...OUTDOOR_PROP_ART,
  ...INDOOR_PROP_ART,
};

interface VillageSheetSpec {
  readonly key: SpriteKey;
  /** Footprint of every prop on the sheet, in tiles. */
  readonly w: number;
  readonly h: number;
  /** Tiles of art allowed above the footprint. */
  readonly headroomTiles: number;
  readonly props: ReadonlyArray<VillageStandingPropId>;
}

/**
 * The sheets, in paint order. A prop's row order is its order here, and the
 * manifest must agree — `propSheetPlanMismatches` holds the two together.
 */
export const VILLAGE_SHEETS: ReadonlyArray<VillageSheetSpec> = [
  {
    key: 'village_1x1',
    w: 1,
    h: 1,
    headroomTiles: 1,
    props: [
      'bench',
      'anvil',
      'coal_bin',
      'trebuchet_model',
      'gear_crate',
      'board_stack',
      'stone_pile',
      'chopping_block',
      'feed_bin',
      'washbasin',
      'stool',
      'fabric_bolts',
      'bucket',
      'oil_cans',
      'seed_sacks',
    ],
  },
  {
    key: 'village_1x1_variants',
    w: 1,
    h: 1,
    headroomTiles: 1,
    props: ['well', 'crate', 'barrel', 'sack', 'hay_bale'],
  },
  {
    key: 'village_1x1_tall',
    w: 1,
    h: 1,
    headroomTiles: 2,
    props: [
      'notice_board',
      'lamp_post',
      'scarecrow',
      'tool_rack',
      'weapon_rack',
      'shelf_records',
      'shelf_herbs',
      'shelf_goods',
      'banner',
      'hearth',
      'tool_pegs',
      'lamp_shelf',
      'hoe_rack',
      'pick_rack',
    ],
  },
  {
    key: 'village_2x1',
    w: 2,
    h: 1,
    headroomTiles: 2,
    props: [
      'quench_trough',
      'water_trough',
      'cooking_hearth',
      'desk',
      'drafting_table',
      'workbench',
      'rope_frame',
      'mushroom_log_bed',
      'loom',
      'half_built_cart',
      'broken_cart',
    ],
  },
  {
    key: 'village_2x1_variants',
    w: 2,
    h: 1,
    headroomTiles: 2,
    props: ['table', 'log_pile'],
  },
  { key: 'village_3x1', w: 3, h: 1, headroomTiles: 1, props: ['serving_counter'] },
  { key: 'village_4x1', w: 4, h: 1, headroomTiles: 1, props: ['long_table'] },
  { key: 'village_1x2', w: 1, h: 2, headroomTiles: 1, props: ['cot', 'bed', 'bunk'] },
  { key: 'village_2x2', w: 2, h: 2, headroomTiles: 3, props: ['bell_tower', 'forge_hearth'] },
  { key: 'village_2x3', w: 2, h: 3, headroomTiles: 2, props: ['sawmill_machine'] },
];

/**
 * A fixed literal base for every village prop's seed. Never derived from an
 * index, so adding a prop re-rolls nothing else; a floor's art term is added
 * to it the way it is added to every seeded family's.
 */
const VILLAGE_PROP_SEED = 0x6b1a7e;

/** Every frame's contact shadow pools against the footprint's bottom edge, which is the frame's. */
export const VILLAGE_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['bottom']);

const sheetByProp = new Map<VillageStandingPropId, VillageSheetSpec>();
for (const sheet of VILLAGE_SHEETS) {
  for (const prop of sheet.props) {
    const spec = VILLAGE_PROPS[prop];
    if (spec.w !== sheet.w || spec.h !== sheet.h) {
      throw new Error(
        `${prop} is ${spec.w}x${spec.h} but sits on ${sheet.key}, a ${sheet.w}x${sheet.h} sheet`,
      );
    }
    if (sheetByProp.has(prop)) throw new Error(`${prop} is on two village sheets`);
    sheetByProp.set(prop, sheet);
  }
}
for (const prop of Object.keys(VILLAGE_PROP_ART)) {
  if (!VILLAGE_SHEETS.some((sheet) => sheet.props.some((listed) => listed === prop))) {
    throw new Error(`village prop ${prop} has art but no sheet`);
  }
}

/** The sheet a standing prop is painted on. */
export function villagePropSheetKey(prop: VillageStandingPropId): SpriteKey {
  const sheet = sheetByProp.get(prop);
  if (sheet === undefined) throw new Error(`village prop ${prop} has no sheet`);
  return sheet.key;
}

/** How many variants a prop's row carries. */
export function villagePropVariants(prop: VillageStandingPropId): number {
  return VILLAGE_PROP_ART[prop].variants;
}

function frameHeightPx(sheet: VillageSheetSpec): number {
  return (sheet.h + sheet.headroomTiles) * VILLAGE_TILE_SCALE;
}

/** Alpha (0-255) a pixel must clear to count as "painted" rather than antialiasing fringe. */
const ART_TOP_ALPHA_THRESHOLD = 12;

/** One measurement per prop, since none of these painters change their silhouette's top edge by seed or variant. */
const measuredArtTopCache = new Map<VillageStandingPropId, number>();

/**
 * Tiles above the footprint's own top row that `prop`'s painted pixels
 * actually reach, measured from a scratch render of the prop rather than
 * trusted from its sheet's declared headroom.
 *
 * Headroom is only the space a sheet *allows* for art above the footprint —
 * chosen per sheet shape, not per prop — so a prop painted shorter than its
 * sheet's ceiling would otherwise report a gap well above its own ink. A UI
 * element that must clear a prop's tallest point (a bobbing badge, say) needs
 * this, not the sheet's allowance.
 */
export function villagePropArtTopTilesAboveFootprint(prop: VillageStandingPropId): number {
  const cached = measuredArtTopCache.get(prop);
  if (cached !== undefined) return cached;
  const measured = measureArtTopTilesAboveFootprint(prop);
  measuredArtTopCache.set(prop, measured);
  return measured;
}

/**
 * Paints one representative frame (variant 0, the family's own base seed) into
 * a scratch canvas the size of its sheet's frame envelope, then scans down
 * from the top for the first row carrying a painted pixel. The row before the
 * footprint's own top row is headroom the sheet allows but the prop's variant
 * or seed may never fill — measuring the actual paint is the only way to know
 * how much of it this prop uses.
 */
function measureArtTopTilesAboveFootprint(prop: VillageStandingPropId): number {
  const sheet = sheetByProp.get(prop);
  if (sheet === undefined) throw new Error(`village prop ${prop} has no sheet`);
  const frameWidth = sheet.w * VILLAGE_TILE_SCALE;
  const frameHeight = frameHeightPx(sheet);
  const surface = allocReadableCanvas(frameWidth, frameHeight);
  const ctx = surfaceContext(surface);
  const art = VILLAGE_PROP_ART[prop];
  const propSeed = subSeed(VILLAGE_PROP_SEED, hashPropId(prop));
  art.paint(
    ctx,
    {
      originX: 0,
      originY: frameHeight - VILLAGE_TILE_SCALE,
      tileScale: VILLAGE_TILE_SCALE,
      footprintW: sheet.w,
      footprintH: sheet.h,
    },
    0,
    mulberry32(subSeed(propSeed, 0)),
  );
  const { data } = ctx.getImageData(0, 0, frameWidth, frameHeight);
  const footprintTopPx = sheet.headroomTiles * VILLAGE_TILE_SCALE;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const alpha = data[(y * frameWidth + x) * 4 + 3];
      if (alpha <= ART_TOP_ALPHA_THRESHOLD) continue;
      return Math.max(0, (footprintTopPx - y) / VILLAGE_TILE_SCALE);
    }
  }
  return 0;
}

function sheetPlan(sheet: VillageSheetSpec, seedTerm: number): PropSheetPlan {
  const frameHeight = frameHeightPx(sheet);
  return {
    key: sheet.key,
    file: `${sheet.key}.png`,
    frameWidth: sheet.w * VILLAGE_TILE_SCALE,
    frameHeight,
    tileX: 0,
    tileY: frameHeight - VILLAGE_TILE_SCALE,
    tileScale: VILLAGE_TILE_SCALE,
    rows: sheet.props.map((prop) => {
      const art = VILLAGE_PROP_ART[prop];
      return {
        state: prop,
        frames: Array.from(
          { length: art.variants },
          (_unused, variant): FramePainter =>
            (ctx, originX, originY) => {
              const propSeed = subSeed(VILLAGE_PROP_SEED + seedTerm, hashPropId(prop));
              art.paint(
                ctx,
                {
                  originX,
                  originY,
                  tileScale: VILLAGE_TILE_SCALE,
                  footprintW: sheet.w,
                  footprintH: sheet.h,
                },
                variant,
                mulberry32(subSeed(propSeed, variant)),
              );
            },
        ),
      };
    }),
  };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A stable number per prop id, so a prop's seed does not depend on its row. */
function hashPropId(prop: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < prop.length; index++) {
    hash = Math.imul(hash ^ prop.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * Every village prop sheet, painted with `seedTerm` added to the family seed.
 * A parameter rather than read from the floor slot, so the seed sweep can paint
 * the village at a candidate seed without pretending to be on a floor.
 */
export function villageSheetPlans(seedTerm: number): PropSheetPlan[] {
  return VILLAGE_SHEETS.map((sheet) => sheetPlan(sheet, seedTerm));
}
