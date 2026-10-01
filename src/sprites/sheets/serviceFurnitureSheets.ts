/**
 * Which pictures the service level's own furniture carries: the lockers,
 * cabinets, vending machine, gas bottle, mop bucket, pallets, desk, bench and
 * boiler, and the walkable floor clutter.
 *
 * One sheet per breakable piece, each with the four rows every breakable prop
 * carries — idle and damaged at each variant, the six-frame break, and the
 * wreckage it leaves — plus the boiler's looping fire and one sheet of clutter.
 * All painted by `src/sprites/art/serviceProps/` from one cold palette, so a
 * room full of them reads as one building's fittings.
 *
 * A multi-tile piece's frame is as wide as its footprint plus the debris
 * margin, and its anchor is its south-west tile, so the frame's tile anchor is
 * that tile and the footprint's other tiles lie to its right and above it.
 */

import { PROP_VARIANT_COUNT, SHATTER_FRAMES } from '../art/propPaint';
import {
  BOILER_FRAMES,
  SIGN_SKID_FRAMES,
  type ServicePropKind,
  type ServicePropState,
  drawBoiler,
  drawCableBundle,
  drawDroppedTowel,
  drawPaperDrift,
  drawServiceProp,
  drawSignSkidFrame,
} from '../art/serviceProps/serviceFurnitureArt';
import type { FramePainter, PropSheetPlan, PropSheetRow } from './propSheetPlan';

/** Source pixels per game tile: twice the game's tile, downscaled at draw time. */
export const SERVICE_FURNITURE_TILE_SCALE = 64;

/** Clearance round the footprint for debris that flies past it. */
const DEBRIS_MARGIN = 16;
/** A tall piece rises up to a tile above its own tile. */
const TALL_HEADROOM = SERVICE_FURNITURE_TILE_SCALE;

interface Envelope {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function envelope(widthTiles: number, heightTiles: number, headroom: number): Envelope {
  return {
    frameWidth: SERVICE_FURNITURE_TILE_SCALE * widthTiles + DEBRIS_MARGIN * 2,
    frameHeight: headroom + SERVICE_FURNITURE_TILE_SCALE * heightTiles + DEBRIS_MARGIN,
    tileX: DEBRIS_MARGIN,
    tileY: headroom + SERVICE_FURNITURE_TILE_SCALE * (heightTiles - 1),
  };
}

const TALL_ONE_TILE = envelope(1, 1, TALL_HEADROOM);
const LOW_ONE_TILE = envelope(1, 1, DEBRIS_MARGIN);
const TWO_ACROSS = envelope(2, 1, TALL_HEADROOM);
/** The boiler's footprint is two tiles deep, and its flue climbs a tile above that. */
const TWO_BY_TWO = envelope(2, 2, TALL_HEADROOM);

const ENVELOPES: Record<ServicePropKind, Envelope> = {
  gas_cylinder: TALL_ONE_TILE,
  locker_bank: TALL_ONE_TILE,
  filing_cabinet: TALL_ONE_TILE,
  vending_machine: TALL_ONE_TILE,
  mop_bucket: TALL_ONE_TILE,
  pallet_stack: LOW_ONE_TILE,
  service_desk: TWO_ACROSS,
  locker_bench: TWO_ACROSS,
};

/** Every breakable service-level kind, in sheet order. */
export const SERVICE_FURNITURE_KINDS: ReadonlyArray<ServicePropKind> = [
  'gas_cylinder',
  'locker_bank',
  'filing_cabinet',
  'mop_bucket',
  'pallet_stack',
  'vending_machine',
  'service_desk',
  'locker_bench',
];

const STATE_FRAMES: ReadonlyArray<{ readonly state: ServicePropState; readonly frames: number }> = [
  { state: 'idle', frames: PROP_VARIANT_COUNT },
  { state: 'damaged', frames: PROP_VARIANT_COUNT },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

function framesOf(count: number, paint: (frame: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, frame) => paint(frame));
}

/**
 * Rows a kind carries beyond the four every breakable has. The mop bucket's
 * sign skids away when the bucket is first knocked: a live overlay played once
 * over its damaged art, which shows the sign where the skid leaves it.
 */
function extraRows(kind: ServicePropKind): PropSheetRow[] {
  if (kind !== 'mop_bucket') return [];
  return [
    {
      state: 'skid',
      frames: framesOf(SIGN_SKID_FRAMES, (frame) => (ctx, originX, originY) => {
        drawSignSkidFrame(ctx, originX, originY, SERVICE_FURNITURE_TILE_SCALE, frame);
      }),
    },
  ];
}

function breakableSheet(kind: ServicePropKind): PropSheetPlan {
  const rows: PropSheetRow[] = STATE_FRAMES.map(({ state, frames }) => ({
    state,
    frames: framesOf(frames, (frame) => (ctx, originX, originY) => {
      drawServiceProp(ctx, kind, state, frame, originX, originY, SERVICE_FURNITURE_TILE_SCALE);
    }),
  }));
  rows.push(...extraRows(kind));
  return {
    key: kind,
    file: `${kind}.png`,
    tileScale: SERVICE_FURNITURE_TILE_SCALE,
    ...ENVELOPES[kind],
    rows,
  };
}

function boilerSheet(): PropSheetPlan {
  return {
    key: 'boiler',
    file: 'boiler.png',
    tileScale: SERVICE_FURNITURE_TILE_SCALE,
    ...TWO_BY_TWO,
    rows: [
      {
        state: 'idle',
        frames: framesOf(BOILER_FRAMES, (frame) => (ctx, originX, originY) => {
          drawBoiler(ctx, originX, originY, SERVICE_FURNITURE_TILE_SCALE, frame);
        }),
      },
    ],
  };
}

/** The walkable clutter sits wholly inside its tile, so its frame is exactly one tile. */
function decalSheet(): PropSheetPlan {
  const painters = [
    ['cable', drawCableBundle],
    ['paper', drawPaperDrift],
    ['towel', drawDroppedTowel],
  ] as const;
  return {
    key: 'service_decals',
    file: 'service_decals.png',
    tileScale: SERVICE_FURNITURE_TILE_SCALE,
    frameWidth: SERVICE_FURNITURE_TILE_SCALE,
    frameHeight: SERVICE_FURNITURE_TILE_SCALE,
    tileX: 0,
    tileY: 0,
    rows: painters.map(([state, paint]) => ({
      state,
      frames: framesOf(PROP_VARIANT_COUNT, (frame) => (ctx, originX, originY) => {
        paint(ctx, originX, originY, SERVICE_FURNITURE_TILE_SCALE, frame);
      }),
    })),
  };
}

/**
 * Every service-level furniture sheet. Unseeded: a locker is the same locker
 * on every run, and its variants are picked per tile at draw time.
 */
export function serviceFurnitureSheetPlans(): PropSheetPlan[] {
  return [...SERVICE_FURNITURE_KINDS.map(breakableSheet), boilerSheet(), decalSheet()];
}
