/**
 * Which pictures the cellars' furniture carries.
 *
 * One sheet per piece, painted by `src/sprites/art/cellarProps/` from one warm
 * palette. A breakable piece's sheet carries the four rows every breakable prop
 * does — idle and damaged at each variant, the six-frame break, and the
 * wreckage at each variant — so the wreckage a piece leaves matches the
 * variant that stood there. The candle cluster's idle and damaged rows hold
 * every variant's flame loop, variant-major. The sarcophagus and the straw
 * never break and carry only their idle row.
 *
 * A two-tile piece's frame is as wide as its footprint plus the debris margin,
 * and its anchor is the left tile of the two.
 */

import { CANDLE_FLAME_FRAMES } from '../art/cellarProps/candleFlame';
import {
  CANDLE_CLUSTER_BURST_HEIGHT_TILES,
  CANDLE_CLUSTER_SHATTER,
  CANDLE_CLUSTER_VARIANTS,
  paintCandleCluster,
  paintCandleClusterRemains,
} from '../art/cellarProps/candleCluster';
import { SHATTER_FRAMES, paintShatter, type ShatterSpec } from '../art/cellarProps/cellarPaint';
import type {
  CellarFixedPainter,
  CellarPiecePainter,
  PieceOrigin,
} from '../art/cellarProps/cellarPiece';
import { CELLAR_TABLE_PAINTER } from '../art/cellarProps/cellarTable';
import { CLAY_URN_PAINTER } from '../art/cellarProps/clayUrn';
import { FALLEN_BEAM_PAINTER } from '../art/cellarProps/fallenBeam';
import { GLOW_FUNGUS_PAINTER, STRAW_SCATTER_PAINTER } from '../art/cellarProps/floorDressing';
import { GRAIN_SACK_PAINTER } from '../art/cellarProps/grainSack';
import { BOTTLE_RACK_PAINTER, SPEAR_RACK_PAINTER } from '../art/cellarProps/racks';
import { RUBBLE_HEAP_PAINTER, RUBBLE_SLOPE_PAINTER } from '../art/cellarProps/rubbleHeap';
import { SARCOPHAGUS_PAINTER } from '../art/cellarProps/sarcophagus';
import { WINE_CASK_PAINTER } from '../art/cellarProps/wineCask';
import { mulberry32 } from '../person/rng';
import type { SpriteKey } from '../../core/SpriteLoader';
import type { FramePainter, PropSheetPlan, PropSheetRow } from './propSheetPlan';

/** Source pixels per game tile: twice the game's tile, downscaled at draw time. */
export const CELLAR_PROP_TILE_SCALE = 64;

/** Clearance round the footprint for debris that flies past it. */
const DEBRIS_MARGIN = 16;
/** Headroom over a low piece, for its top and the debris thrown up by its break. */
const LOW_HEADROOM = 32;
/** Headroom over a rack, which climbs up the face behind it. */
const RACK_HEADROOM = 64;

/** The breakable cellar pieces, each its own sheet keyed by its own name. */
export type CellarBreakableKind =
  | 'clay_urn'
  | 'grain_sack'
  | 'wine_cask'
  | 'bottle_rack'
  | 'cellar_table'
  | 'spear_rack'
  | 'rubble_heap'
  | 'rubble_slope'
  | 'fallen_beam'
  | 'candle_cluster'
  | 'glow_fungus';

/** Every cellar sheet. */
export type CellarPropKey = CellarBreakableKind | 'sarcophagus' | 'straw_scatter';

interface Envelope {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function envelope(tilesWide: number, headroom: number, margin: number): Envelope {
  return {
    frameWidth: CELLAR_PROP_TILE_SCALE * tilesWide + margin * 2,
    frameHeight: headroom + CELLAR_PROP_TILE_SCALE + margin,
    tileX: margin,
    tileY: headroom,
  };
}

const SHATTER_SEED_BASE = 0x1f00;
/**
 * The first frames of a break still show the piece giving way, fading as the
 * shards fly; past these it is all debris.
 */
const COLLAPSE_ALPHAS = [0.75, 0.35] as const;

function shatterFrame(
  spec: ShatterSpec,
  burstHeightTiles: number,
  tilesWide: number,
  frame: number,
  seed: number,
  paintBody: (ctx: CanvasRenderingContext2D, at: PieceOrigin) => void,
): FramePainter {
  return (ctx, originX, originY) => {
    const at: PieceOrigin = { ox: originX, oy: originY, ts: CELLAR_PROP_TILE_SCALE };
    if (frame < COLLAPSE_ALPHAS.length) {
      ctx.save();
      ctx.globalAlpha = COLLAPSE_ALPHAS[frame];
      paintBody(ctx, at);
      ctx.restore();
    }
    const progress = (frame + 1) / SHATTER_FRAMES;
    const cx = originX + (CELLAR_PROP_TILE_SCALE * tilesWide) / 2;
    const cy = originY + burstHeightTiles * CELLAR_PROP_TILE_SCALE;
    // The same stream every frame, so each shard flies one path through the break.
    paintShatter(ctx, cx, cy, progress, spec, mulberry32(seed));
  };
}

function framesOf(count: number, paint: (index: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, index) => paint(index));
}

function breakableRows(painter: CellarPiecePainter, seed: number): PropSheetRow[] {
  const at = (originX: number, originY: number): PieceOrigin => ({
    ox: originX,
    oy: originY,
    ts: CELLAR_PROP_TILE_SCALE,
  });
  return [
    {
      state: 'idle',
      frames: framesOf(painter.variants, (variant) => (ctx, x, y) => {
        painter.paint(ctx, at(x, y), variant, false);
      }),
    },
    {
      state: 'damaged',
      frames: framesOf(painter.variants, (variant) => (ctx, x, y) => {
        painter.paint(ctx, at(x, y), variant, true);
      }),
    },
    {
      state: 'shatter',
      frames: framesOf(SHATTER_FRAMES, (frame) =>
        shatterFrame(
          painter.shatter,
          painter.burstHeightTiles,
          painter.tilesWide,
          frame,
          seed,
          (ctx, origin) => painter.paint(ctx, origin, 0, true),
        ),
      ),
    },
    {
      state: 'remains',
      frames: framesOf(painter.variants, (variant) => (ctx, x, y) => {
        painter.paintRemains(ctx, at(x, y), variant);
      }),
    },
  ];
}

function breakableSheet(
  key: CellarBreakableKind & SpriteKey,
  painter: CellarPiecePainter,
  headroom: number,
  seed: number,
): PropSheetPlan {
  return {
    key,
    file: `${key}.png`,
    tileScale: CELLAR_PROP_TILE_SCALE,
    ...envelope(painter.tilesWide, headroom, DEBRIS_MARGIN),
    rows: breakableRows(painter, seed),
  };
}

function fixedSheet(
  key: CellarPropKey & SpriteKey,
  painter: CellarFixedPainter,
  headroom: number,
  margin: number,
): PropSheetPlan {
  return {
    key,
    file: `${key}.png`,
    tileScale: CELLAR_PROP_TILE_SCALE,
    ...envelope(painter.tilesWide, headroom, margin),
    rows: [
      {
        state: 'idle',
        frames: framesOf(painter.variants, (variant) => (ctx, x, y) => {
          painter.paint(ctx, { ox: x, oy: y, ts: CELLAR_PROP_TILE_SCALE }, variant);
        }),
      },
    ],
  };
}

function candleSheet(seed: number): PropSheetPlan {
  const at = (originX: number, originY: number): PieceOrigin => ({
    ox: originX,
    oy: originY,
    ts: CELLAR_PROP_TILE_SCALE,
  });
  const flameLoop = framesOf(CANDLE_CLUSTER_VARIANTS * CANDLE_FLAME_FRAMES, (index) => {
    const variant = Math.floor(index / CANDLE_FLAME_FRAMES);
    const phase = index % CANDLE_FLAME_FRAMES;
    return (ctx, x, y) => paintCandleCluster(ctx, at(x, y), variant, phase);
  });
  return {
    key: 'candle_cluster',
    file: 'candle_cluster.png',
    tileScale: CELLAR_PROP_TILE_SCALE,
    ...envelope(1, LOW_HEADROOM, DEBRIS_MARGIN),
    rows: [
      { state: 'idle', frames: flameLoop },
      { state: 'damaged', frames: flameLoop },
      {
        state: 'shatter',
        frames: framesOf(SHATTER_FRAMES, (frame) =>
          shatterFrame(
            CANDLE_CLUSTER_SHATTER,
            CANDLE_CLUSTER_BURST_HEIGHT_TILES,
            1,
            frame,
            seed,
            (ctx, origin) => paintCandleCluster(ctx, origin, 0, 0),
          ),
        ),
      },
      {
        state: 'remains',
        frames: framesOf(CANDLE_CLUSTER_VARIANTS, (variant) => (ctx, x, y) => {
          paintCandleClusterRemains(ctx, at(x, y), variant);
        }),
      },
    ],
  };
}

/** How many seeded looks each sheet carries, read off the painters that paint them. */
export const CELLAR_PROP_VARIANTS: Readonly<Record<CellarPropKey, number>> = {
  clay_urn: CLAY_URN_PAINTER.variants,
  grain_sack: GRAIN_SACK_PAINTER.variants,
  wine_cask: WINE_CASK_PAINTER.variants,
  bottle_rack: BOTTLE_RACK_PAINTER.variants,
  cellar_table: CELLAR_TABLE_PAINTER.variants,
  spear_rack: SPEAR_RACK_PAINTER.variants,
  rubble_heap: RUBBLE_HEAP_PAINTER.variants,
  rubble_slope: RUBBLE_SLOPE_PAINTER.variants,
  fallen_beam: FALLEN_BEAM_PAINTER.variants,
  glow_fungus: GLOW_FUNGUS_PAINTER.variants,
  candle_cluster: CANDLE_CLUSTER_VARIANTS,
  sarcophagus: SARCOPHAGUS_PAINTER.variants,
  straw_scatter: STRAW_SCATTER_PAINTER.variants,
};

/** Straw is baked into the floor's chunks, so it is painted to its own tile with no margin. */
const FLAT_DECAL_MARGIN = 0;
const FLAT_DECAL_HEADROOM = 0;

/** Every cellar sheet. Unseeded: the furniture looks the same on every floor that has it. */
export function cellarPropSheetPlans(): PropSheetPlan[] {
  const shatterSeed = (index: number) => SHATTER_SEED_BASE + index;
  return [
    breakableSheet('clay_urn', CLAY_URN_PAINTER, LOW_HEADROOM, shatterSeed(0)),
    breakableSheet('grain_sack', GRAIN_SACK_PAINTER, LOW_HEADROOM, shatterSeed(1)),
    breakableSheet('wine_cask', WINE_CASK_PAINTER, LOW_HEADROOM, shatterSeed(2)),
    breakableSheet('bottle_rack', BOTTLE_RACK_PAINTER, RACK_HEADROOM, shatterSeed(3)),
    breakableSheet('cellar_table', CELLAR_TABLE_PAINTER, LOW_HEADROOM, shatterSeed(4)),
    breakableSheet('spear_rack', SPEAR_RACK_PAINTER, RACK_HEADROOM, shatterSeed(5)),
    breakableSheet('rubble_heap', RUBBLE_HEAP_PAINTER, LOW_HEADROOM, shatterSeed(6)),
    breakableSheet('rubble_slope', RUBBLE_SLOPE_PAINTER, LOW_HEADROOM, shatterSeed(10)),
    breakableSheet('fallen_beam', FALLEN_BEAM_PAINTER, LOW_HEADROOM, shatterSeed(7)),
    breakableSheet('glow_fungus', GLOW_FUNGUS_PAINTER, LOW_HEADROOM, shatterSeed(8)),
    candleSheet(shatterSeed(9)),
    fixedSheet('sarcophagus', SARCOPHAGUS_PAINTER, LOW_HEADROOM, DEBRIS_MARGIN),
    fixedSheet('straw_scatter', STRAW_SCATTER_PAINTER, FLAT_DECAL_HEADROOM, FLAT_DECAL_MARGIN),
  ];
}
