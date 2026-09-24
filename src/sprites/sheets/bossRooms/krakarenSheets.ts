import {
  CONSOLE_SCREEN_FRAMES,
  FX_ARC_FRAMES,
  FX_DRAIN_BURST_FRAMES,
  FX_DRIP_FRAMES,
  FX_RIPPLE_FRAMES,
  FX_SPARK_FRAMES,
  FX_WARN_FRAMES,
  JUNCTION_SPARK_FRAMES,
  SEAL_BAR_FRAMES,
  SPLASH_FRAMES,
  VAT_BUBBLE_FRAMES,
  VAT_BURST_FRAMES,
  VAT_CRACK_FRAMES,
  paintArc,
  paintConsole,
  paintDrainBurst,
  paintDrip,
  paintJunctionBox,
  paintRipple,
  paintSealBars,
  paintSparks,
  paintSplash,
  paintVatBroken,
  paintVatBurst,
  paintVatCracking,
  paintVatIntact,
  paintWarn,
  type VatPaintOptions,
} from '../../art/krakarenRoomArt';
import type { FrameEdge, FramePainter, PropSheetPlan, PropSheetRow } from '../propSheetPlan';

/** Matches `TILE_SIZE`: every sheet here is blitted 1:1. */
export const KRAKAREN_ROOM_TILE_SCALE = 32;
const TS = KRAKAREN_ROOM_TILE_SCALE;

/** Two tiles tall with the anchor tile at the bottom, so the foot sorts on the tile's lower edge. */
const TALL_FRAME_HEIGHT = TS * 2;
const TALL_TILE_Y = TS;
/** The console's monitor stands half a tile above its desk. */
const CONSOLE_FRAME_HEIGHT = TS + TS / 2;
const CONSOLE_TILE_Y = TS / 2;
/** A splash is two tiles across, centred on the tile it lands in. */
const SPLASH_FRAME_SIZE = TS * 2;
const SPLASH_TILE_OFFSET = TS / 2;
/** Pixels a vat's art keeps clear of its cell's sides and top. */
const CELL_KEEP_OUT_PX = 1;

function frames(count: number, paint: (frame: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, frame) => paint(frame));
}

function vatRow(
  state: string,
  count: number,
  specimen: boolean,
  painter: (
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    ts: number,
    o: VatPaintOptions,
  ) => void,
): PropSheetRow {
  return {
    state,
    frames: frames(count, (frame) => (ctx, ox, oy) => {
      // Flying shards and wandering cracks are kept a pixel inside the cell's
      // sides and top: a vat is one tile wide, and glass drawn past its tile
      // would read as a vat wider than the ground it blocks.
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(
          ox + CELL_KEEP_OUT_PX,
          oy - TALL_TILE_Y + CELL_KEEP_OUT_PX,
          TS - CELL_KEEP_OUT_PX * 2,
          TALL_FRAME_HEIGHT,
        );
        ctx.clip();
        painter(ctx, ox, oy, TS, { specimen, frame });
      } finally {
        ctx.restore();
      }
    }),
  };
}

const vatPlan: PropSheetPlan = {
  key: 'krakaren_vat',
  file: 'krakaren_vat.png',
  frameWidth: TS,
  frameHeight: TALL_FRAME_HEIGHT,
  tileX: 0,
  tileY: TALL_TILE_Y,
  tileScale: TS,
  rows: [
    vatRow('intact', VAT_BUBBLE_FRAMES, true, paintVatIntact),
    vatRow('intact_empty', VAT_BUBBLE_FRAMES, false, paintVatIntact),
    vatRow('cracking', VAT_CRACK_FRAMES, true, paintVatCracking),
    vatRow('cracking_empty', VAT_CRACK_FRAMES, false, paintVatCracking),
    vatRow('burst', VAT_BURST_FRAMES, true, paintVatBurst),
    vatRow('burst_empty', VAT_BURST_FRAMES, false, paintVatBurst),
    vatRow('broken', 1, true, paintVatBroken),
    vatRow('broken_empty', 1, false, paintVatBroken),
  ],
};

const consolePlan: PropSheetPlan = {
  key: 'krakaren_console',
  file: 'krakaren_console.png',
  frameWidth: TS,
  frameHeight: CONSOLE_FRAME_HEIGHT,
  tileX: 0,
  tileY: CONSOLE_TILE_Y,
  tileScale: TS,
  rows: [
    {
      state: 'screen',
      frames: frames(
        CONSOLE_SCREEN_FRAMES,
        (frame) => (ctx, ox, oy) => paintConsole(ctx, ox, oy, TS, frame),
      ),
    },
  ],
};

const junctionPlan: PropSheetPlan = {
  key: 'krakaren_junction',
  file: 'krakaren_junction.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  rows: [
    { state: 'intact', frames: [(ctx, ox, oy) => paintJunctionBox(ctx, ox, oy, TS, 'intact', 0)] },
    {
      state: 'sparking',
      frames: frames(
        JUNCTION_SPARK_FRAMES,
        (frame) => (ctx, ox, oy) => paintJunctionBox(ctx, ox, oy, TS, 'sparking', frame),
      ),
    },
    { state: 'broken', frames: [(ctx, ox, oy) => paintJunctionBox(ctx, ox, oy, TS, 'broken', 0)] },
  ],
};

function fxRow(
  state: string,
  count: number,
  painter: (
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    ts: number,
    frame: number,
  ) => void,
): PropSheetRow {
  return {
    state,
    frames: frames(count, (frame) => (ctx, ox, oy) => painter(ctx, ox, oy, TS, frame)),
  };
}

const fxPlan: PropSheetPlan = {
  key: 'krakaren_fx',
  file: 'krakaren_fx.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  rows: [
    fxRow('ripple', FX_RIPPLE_FRAMES, paintRipple),
    fxRow('drain_burst', FX_DRAIN_BURST_FRAMES, paintDrainBurst),
    fxRow('drip', FX_DRIP_FRAMES, paintDrip),
  ],
};

/**
 * Washes that light a whole tile of floor — the live wire's sparks and arc, the
 * warning in front of a cracking vat. Each fills its cell edge to edge so a run
 * of charged tiles reads as one sheet of water, which is why its edges are
 * painted against on purpose.
 */
const washPlan: PropSheetPlan = {
  key: 'krakaren_wash',
  file: 'krakaren_wash.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  groundedEdges: new Set<FrameEdge>(['top', 'bottom', 'left', 'right']),
  rows: [
    fxRow('sparks', FX_SPARK_FRAMES, paintSparks),
    fxRow('arc', FX_ARC_FRAMES, paintArc),
    fxRow('warn', FX_WARN_FRAMES, paintWarn),
  ],
};

const splashPlan: PropSheetPlan = {
  key: 'krakaren_splash',
  file: 'krakaren_splash.png',
  frameWidth: SPLASH_FRAME_SIZE,
  frameHeight: SPLASH_FRAME_SIZE,
  tileX: SPLASH_TILE_OFFSET,
  tileY: SPLASH_TILE_OFFSET,
  tileScale: TS,
  rows: [
    {
      state: 'splash',
      frames: frames(
        SPLASH_FRAMES,
        (frame) => (ctx, ox, oy) => paintSplash(ctx, ox + TS / 2, oy + TS / 2, TS, frame),
      ),
    },
  ],
};

const sealPlan: PropSheetPlan = {
  key: 'krakaren_seal',
  file: 'krakaren_seal.png',
  frameWidth: TS,
  frameHeight: TALL_FRAME_HEIGHT,
  tileX: 0,
  tileY: TALL_TILE_Y,
  tileScale: TS,
  rows: [
    {
      state: 'grow',
      frames: frames(
        SEAL_BAR_FRAMES,
        (frame) => (ctx, ox, oy) => paintSealBars(ctx, ox, oy, TS, frame),
      ),
    },
  ],
};

/**
 * The painted prop sheets that dress Krakaren Clone's flooded lab.
 * Requested when the floor loads, so they are ready before the room is seen.
 *
 * The art does not vary with the floor's seed: every vat is the same failed
 * copy of her, which is the point of a clone lab.
 */
export function krakarenRoomSheetPlans(_artSeed: number): PropSheetPlan[] {
  return [vatPlan, consolePlan, junctionPlan, fxPlan, washPlan, splashPlan, sealPlan];
}
