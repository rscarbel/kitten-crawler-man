import type { SpriteKey } from '../../../core/SpriteLoader';
import {
  BAG_SHATTER_FRAMES,
  BARRICADE_FRAMES,
  FLOOR_DECALS,
  GRIME_EDGE_ORDER,
  HOARD_PILE_VARIANTS,
  LINOLEUM_VARIANTS,
  PILE_JOIN_STATES,
  PILE_FILL_STATES,
  paintPileFill,
  pileFillJoinsOfFrame,
  pileJoinsOfFrame,
  NEST_TILES_DEEP,
  NEST_TILES_WIDE,
  PILE_RUSTLE_FRAMES,
  TOWER_FALL_FRAMES,
  TOWER_RUBBLE_VARIANTS,
  TOWER_WOBBLE_ART_FRAMES,
  paintBagDamaged,
  paintBagIdle,
  paintBagRemains,
  paintBagShatter,
  paintBarricade,
  paintFloorDecal,
  paintGrimeEdge,
  paintHoardPile,
  paintLinoleum,
  paintNest,
  paintPileRustle,
  paintTowerFall,
  paintTowerIdle,
  paintTowerRubble,
  paintTowerWobble,
  type FallSheet,
} from '../../art/hoarderRoomArt';
import { JUNK_TILE_PX } from '../../art/hoarderJunkKit';
import type { FrameEdge, FramePainter, PropSheetPlan, PropSheetRow } from '../propSheetPlan';

const SIDE_AND_BOTTOM_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>([
  'left',
  'right',
  'bottom',
]);
const SIDE_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['left', 'right']);
const EVERY_EDGE: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['top', 'bottom', 'left', 'right']);

function frames(count: number, paint: (index: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, index) => paint(index));
}

function row(state: string, painters: FramePainter[]): PropSheetRow {
  return { state, frames: painters };
}

interface Envelope {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function plan(key: SpriteKey, envelope: Envelope, rows: PropSheetRow[]): PropSheetPlan {
  return {
    key,
    file: `${key}.png`,
    ...envelope,
    tileScale: JUNK_TILE_PX,
    rows,
  };
}

const T = JUNK_TILE_PX;
const QUARTER_TILE = T / 4;
const HALF_TILE = T / 2;

/** A heap reaches three quarters of a tile above its own; nothing hangs past its sides. */
const PILE_HEADROOM = T * 0.75;
/** A tower stands nearly three tiles tall on a one-tile footprint. */
const TOWER_HEADROOM = T * 1.75;
/** The line a tower falls down, in tiles past its own. */
const FALL_LINE_TILES = 3;
const FALL_SIDE_MARGIN = HALF_TILE;
const FALL_FOOT_MARGIN = QUARTER_TILE;
/** The bag's burst and the destructible props' shared margin for flying debris. */
const BAG_DEBRIS_MARGIN = QUARTER_TILE;

const FALL_ENVELOPES: Readonly<Record<FallSheet, Envelope>> = {
  east: {
    frameWidth: FALL_SIDE_MARGIN + T * (1 + FALL_LINE_TILES) + FALL_SIDE_MARGIN,
    frameHeight: TOWER_HEADROOM + T + FALL_SIDE_MARGIN,
    tileX: FALL_SIDE_MARGIN,
    tileY: TOWER_HEADROOM,
  },
  south: {
    frameWidth: FALL_SIDE_MARGIN + T + FALL_SIDE_MARGIN,
    frameHeight: TOWER_HEADROOM + T * (1 + FALL_LINE_TILES) + FALL_FOOT_MARGIN / 2,
    tileX: FALL_SIDE_MARGIN,
    tileY: TOWER_HEADROOM,
  },
  north: {
    frameWidth: FALL_SIDE_MARGIN + T + FALL_SIDE_MARGIN,
    frameHeight: T * FALL_LINE_TILES + QUARTER_TILE + T + QUARTER_TILE,
    tileX: FALL_SIDE_MARGIN,
    tileY: T * FALL_LINE_TILES + QUARTER_TILE,
  },
};

const FALL_KEYS: Readonly<Record<FallSheet, SpriteKey>> = {
  east: 'hoard_tower_fall_east',
  south: 'hoard_tower_fall_south',
  north: 'hoard_tower_fall_north',
};

const FALL_SHEETS: readonly FallSheet[] = ['east', 'south', 'north'];

/**
 * The painted prop sheets that dress the Hoarder's lair. Requested when the
 * floor loads, so they are ready before the room is seen.
 *
 * The art does not vary with the floor's art seed: every variation a lair has
 * comes from which variant lands on which tile, which is a function of the
 * tile's position. The seed is accepted for the family's shared signature.
 */
export function hoarderRoomSheetPlans(_artSeed: number): PropSheetPlan[] {
  return [
    {
      ...plan(
        'hoard_pile',
        { frameWidth: T, frameHeight: PILE_HEADROOM + T, tileX: 0, tileY: PILE_HEADROOM },
        [
          row(
            'idle',
            frames(
              HOARD_PILE_VARIANTS * PILE_JOIN_STATES,
              (frame) => (ctx, x, y) =>
                paintHoardPile(
                  ctx,
                  x,
                  y,
                  Math.floor(frame / PILE_JOIN_STATES),
                  pileJoinsOfFrame(frame),
                ),
            ),
          ),
          row(
            'rustle',
            frames(PILE_RUSTLE_FRAMES, (f) => (ctx, x, y) => paintPileRustle(ctx, x, y, f)),
          ),
        ],
      ),
      // A heap's mound runs to both sides of its tile, so neighbouring heaps meet.
      groundedEdges: SIDE_EDGES,
    },
    {
      ...plan(
        'hoard_pile_fill',
        { frameWidth: T, frameHeight: PILE_HEADROOM + T, tileX: 0, tileY: PILE_HEADROOM },
        [
          row(
            'idle',
            frames(
              PILE_FILL_STATES,
              (frame) => (ctx, x, y) => paintPileFill(ctx, x, y, pileFillJoinsOfFrame(frame)),
            ),
          ),
        ],
      ),
      // Packed junk between heaps runs to its tile's edges where they join.
      groundedEdges: SIDE_AND_BOTTOM_EDGES,
    },
    plan(
      'hoard_tower',
      { frameWidth: T, frameHeight: TOWER_HEADROOM + T, tileX: 0, tileY: TOWER_HEADROOM },
      [
        row('idle', [(ctx, x, y) => paintTowerIdle(ctx, x, y)]),
        row(
          'wobble',
          frames(TOWER_WOBBLE_ART_FRAMES, (f) => (ctx, x, y) => paintTowerWobble(ctx, x, y, f)),
        ),
        row(
          'rubble',
          frames(TOWER_RUBBLE_VARIANTS, (v) => (ctx, x, y) => paintTowerRubble(ctx, x, y, v)),
        ),
      ],
    ),
    ...FALL_SHEETS.map((sheet) =>
      plan(FALL_KEYS[sheet], FALL_ENVELOPES[sheet], [
        row(
          'fall',
          frames(TOWER_FALL_FRAMES, (f) => (ctx, x, y) => paintTowerFall(ctx, x, y, sheet, f)),
        ),
      ]),
    ),
    plan(
      'garbage_bag',
      {
        frameWidth: T + BAG_DEBRIS_MARGIN * 2,
        frameHeight: T + BAG_DEBRIS_MARGIN * 2,
        tileX: BAG_DEBRIS_MARGIN,
        tileY: BAG_DEBRIS_MARGIN,
      },
      [
        row('idle', [(ctx, x, y) => paintBagIdle(ctx, x, y)]),
        row('damaged', [(ctx, x, y) => paintBagDamaged(ctx, x, y)]),
        row(
          'shatter',
          frames(BAG_SHATTER_FRAMES, (f) => (ctx, x, y) => paintBagShatter(ctx, x, y, f)),
        ),
        row('remains', [(ctx, x, y) => paintBagRemains(ctx, x, y)]),
      ],
    ),
    {
      ...plan('hoarder_floor', { frameWidth: T, frameHeight: T, tileX: 0, tileY: 0 }, [
        row(
          'linoleum',
          frames(LINOLEUM_VARIANTS, (v) => (ctx, x, y) => paintLinoleum(ctx, x, y, v)),
        ),
        row(
          'grime',
          GRIME_EDGE_ORDER.map((edge) => (ctx, x, y) => paintGrimeEdge(ctx, x, y, edge)),
        ),
        row(
          'decal',
          frames(FLOOR_DECALS, (d) => (ctx, x, y) => paintFloorDecal(ctx, x, y, d)),
        ),
      ]),
      // A floor fills its tile edge to edge: that is how the next tile continues it.
      groundedEdges: EVERY_EDGE,
    },
    plan(
      'hoarder_nest',
      {
        frameWidth: QUARTER_TILE + T * NEST_TILES_WIDE + QUARTER_TILE,
        frameHeight: HALF_TILE + T * NEST_TILES_DEEP + QUARTER_TILE,
        tileX: QUARTER_TILE,
        tileY: HALF_TILE,
      },
      [row('idle', [(ctx, x, y) => paintNest(ctx, x, y)])],
    ),
    {
      ...plan(
        'hoard_barricade',
        { frameWidth: T, frameHeight: PILE_HEADROOM + T, tileX: 0, tileY: PILE_HEADROOM },
        [
          row(
            'slide',
            frames(BARRICADE_FRAMES, (f) => (ctx, x, y) => paintBarricade(ctx, x, y, f)),
          ),
        ],
      ),
      // It fills its doorway wall to wall, so it meets the walls at both sides.
      groundedEdges: SIDE_EDGES,
    },
  ];
}
