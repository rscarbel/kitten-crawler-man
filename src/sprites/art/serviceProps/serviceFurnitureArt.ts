/**
 * The service level's furniture, one entry point per sheet row.
 *
 * `drawServiceProp` paints any breakable piece in any of the four states every
 * breakable prop sheet carries — idle, damaged, the six-frame shatter and the
 * remains — at a variant or shatter frame. The boiler and the floor decals have
 * entry points of their own, because neither breaks.
 */

import {
  type Ctx,
  type RadialDebrisSpec,
  SHATTER_FRAMES,
  drawDebrisBurst,
  puff,
  radialDebris,
} from '../propPaint';
import {
  BENCH_WOOD,
  CABINET_STEEL,
  CONCRETE_DUST_RGB,
  CYLINDER_PAINT,
  DESK_LAMINATE,
  LOCKER_STEEL,
  MONITOR_PLASTIC,
  PALLET_WOOD,
  SAFETY_YELLOW,
  VENDING_SHELL,
} from './servicePaint';
import {
  drawFilingCabinet,
  drawFilingCabinetRemains,
  drawGasCylinder,
  drawGasCylinderRemains,
  drawLocker,
  drawLockerRemains,
  drawVendingMachine,
  drawVendingRemains,
} from './serviceTallProps';
import {
  drawLockerBench,
  drawLockerBenchRemains,
  drawMopBucket,
  drawMopBucketRemains,
  drawPalletRemains,
  drawPalletStack,
  drawServiceDesk,
  drawServiceDeskRemains,
} from './serviceLowProps';

export { SIGN_SKID_FRAMES, drawSignSkidFrame } from './serviceLowProps';
export {
  BOILER_FRAMES,
  drawBoiler,
  drawCableBundle,
  drawDroppedTowel,
  drawPaperDrift,
} from './serviceBoilerAndDecals';

/** Every breakable piece of service-level furniture. Each is its own sheet, keyed by this name. */
export type ServicePropKind =
  | 'gas_cylinder'
  | 'locker_bank'
  | 'filing_cabinet'
  | 'mop_bucket'
  | 'pallet_stack'
  | 'vending_machine'
  | 'service_desk'
  | 'locker_bench';

export type ServicePropState = 'idle' | 'damaged' | 'shatter' | 'remains';

type BodyPainter = (
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
) => void;
type RemainsPainter = (ctx: Ctx, ox: number, oy: number, ts: number, variant: number) => void;

interface ServicePropArt {
  readonly body: BodyPainter;
  readonly remains: RemainsPainter;
  /** Tiles across the piece is; its burst centres on the middle of them. */
  readonly widthTiles: number;
  /** Where the burst centres, in tiles down from the anchor tile's top. */
  readonly burstCentreY: number;
  readonly debris: RadialDebrisSpec;
}

const STEEL_DEBRIS = {
  count: 14,
  spreadPx: 30,
  edge: '#1c2427',
  curlPeriod: 4,
  lengthMin: 5,
  lengthSpread: 6,
  widthMin: 2,
  widthSpread: 2,
} as const;

const WOOD_DEBRIS = {
  count: 16,
  spreadPx: 30,
  edge: '#2a1e12',
  curlPeriod: 0,
  curlShade: '#000',
  lengthMin: 5,
  lengthSpread: 8,
  widthMin: 1.6,
  widthSpread: 1.6,
} as const;

/** A tall piece bursts from its chest, not its foot. */
const TALL_BURST_CENTRE = 0.25;
const LOW_BURST_CENTRE = 0.6;

const SERVICE_PROP_ART: Record<ServicePropKind, ServicePropArt> = {
  locker_bank: {
    body: drawLocker,
    remains: drawLockerRemains,
    widthTiles: 1,
    burstCentreY: TALL_BURST_CENTRE,
    debris: {
      ...STEEL_DEBRIS,
      shades: [LOCKER_STEEL.frontHigh, LOCKER_STEEL.top, LOCKER_STEEL.frontLow],
      curlShade: LOCKER_STEEL.edge,
    },
  },
  filing_cabinet: {
    body: drawFilingCabinet,
    remains: drawFilingCabinetRemains,
    widthTiles: 1,
    burstCentreY: TALL_BURST_CENTRE,
    debris: {
      ...STEEL_DEBRIS,
      // Half the pieces are paper: a cabinet bursts into its files.
      shades: [CABINET_STEEL.frontHigh, '#cfcbbd', '#e0dccf', CABINET_STEEL.frontLow],
      curlShade: CABINET_STEEL.edge,
    },
  },
  vending_machine: {
    body: drawVendingMachine,
    remains: drawVendingRemains,
    widthTiles: 1,
    burstCentreY: TALL_BURST_CENTRE,
    debris: {
      ...STEEL_DEBRIS,
      count: 18,
      shades: ['#c8dbe4', '#dcebf3', VENDING_SHELL.frontHigh, '#d0a23b', '#b8473a'],
      curlShade: VENDING_SHELL.edge,
    },
  },
  gas_cylinder: {
    body: drawGasCylinder,
    remains: drawGasCylinderRemains,
    widthTiles: 1,
    burstCentreY: TALL_BURST_CENTRE,
    debris: {
      ...STEEL_DEBRIS,
      spreadPx: 36,
      shades: [CYLINDER_PAINT.frontHigh, CYLINDER_PAINT.frontLow, '#c8c3b5'],
      curlShade: CYLINDER_PAINT.edge,
    },
  },
  mop_bucket: {
    body: drawMopBucket,
    remains: drawMopBucketRemains,
    widthTiles: 1,
    burstCentreY: LOW_BURST_CENTRE,
    debris: {
      ...WOOD_DEBRIS,
      count: 12,
      shades: [SAFETY_YELLOW.frontHigh, SAFETY_YELLOW.top, '#4b4a3c'],
      edge: SAFETY_YELLOW.outline,
    },
  },
  pallet_stack: {
    body: drawPalletStack,
    remains: drawPalletRemains,
    widthTiles: 1,
    burstCentreY: LOW_BURST_CENTRE,
    debris: {
      ...WOOD_DEBRIS,
      shades: [PALLET_WOOD.top, PALLET_WOOD.frontHigh, PALLET_WOOD.frontLow],
    },
  },
  service_desk: {
    body: drawServiceDesk,
    remains: drawServiceDeskRemains,
    widthTiles: 2,
    burstCentreY: LOW_BURST_CENTRE,
    debris: {
      ...STEEL_DEBRIS,
      count: 20,
      spreadPx: 40,
      shades: [DESK_LAMINATE.top, MONITOR_PLASTIC.frontHigh, '#c8d4d0', '#cfcbbd'],
      curlShade: '#6a6c66',
    },
  },
  locker_bench: {
    body: drawLockerBench,
    remains: drawLockerBenchRemains,
    widthTiles: 2,
    burstCentreY: LOW_BURST_CENTRE,
    debris: {
      ...WOOD_DEBRIS,
      count: 18,
      spreadPx: 40,
      shades: [BENCH_WOOD.top, BENCH_WOOD.frontHigh, BENCH_WOOD.frontLow],
    },
  },
};

/** Fixed seed per kind for its burst, so a sheet painted twice is identical. */
const BURST_SEEDS: Record<ServicePropKind, number> = {
  locker_bank: 0x1c01,
  filing_cabinet: 0x1c02,
  vending_machine: 0x1c03,
  gas_cylinder: 0x1c04,
  mop_bucket: 0x1c05,
  pallet_stack: 0x1c06,
  service_desk: 0x1c07,
  locker_bench: 0x1c08,
};

/** The share of the shatter row over which the damaged body is still seen giving way. */
const BODY_FADE_PROGRESS = 0.34;

function dustCloud(ctx: Ctx, cx: number, cy: number, radius: number, alpha: number): void {
  puff(ctx, cx, cy, radius, alpha, CONCRETE_DUST_RGB);
}

/**
 * Paints one frame of a breakable service-level prop with its anchor tile's
 * top-left at (`ox`, `oy`). `frame` is the variant for idle, damaged and
 * remains, and the shatter frame for shatter.
 */
export function drawServiceProp(
  ctx: Ctx,
  kind: ServicePropKind,
  state: ServicePropState,
  frame: number,
  ox: number,
  oy: number,
  ts: number,
): void {
  const art = SERVICE_PROP_ART[kind];
  switch (state) {
    case 'idle':
      art.body(ctx, ox, oy, ts, frame, false);
      return;
    case 'damaged':
      art.body(ctx, ox, oy, ts, frame, true);
      return;
    case 'remains':
      art.remains(ctx, ox, oy, ts, 0);
      return;
    case 'shatter': {
      const progress = frame / (SHATTER_FRAMES - 1);
      if (progress < BODY_FADE_PROGRESS) {
        ctx.save();
        ctx.globalAlpha = 1 - progress / BODY_FADE_PROGRESS;
        art.body(ctx, ox, oy, ts, 0, true);
        ctx.restore();
      }
      const cx = ox + (ts * art.widthTiles) / 2;
      const cy = oy + ts * art.burstCentreY;
      drawDebrisBurst(
        ctx,
        radialDebris(BURST_SEEDS[kind], art.debris),
        dustCloud,
        cx,
        cy,
        ts,
        progress,
      );
      return;
    }
  }
}
