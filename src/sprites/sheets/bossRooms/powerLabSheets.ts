import {
  CONSOLE_SCREEN_FRAMES,
  FX_ARC_FRAMES,
  FX_DRIP_FRAMES,
  FX_RIPPLE_FRAMES,
  FX_SPARK_FRAMES,
  VAT_BUBBLE_FRAMES,
  paintArc,
  paintConsole,
  paintDrip,
  paintRipple,
  paintSparks,
  paintVatIntact,
  type VatPaintOptions,
} from '../../art/powerLabArt';
import type { FrameEdge, FramePainter, PropSheetPlan, PropSheetRow } from '../propSheetPlan';

/** Matches `TILE_SIZE`: every sheet here is blitted 1:1. */
const POWER_LAB_TILE_SCALE = 32;
const TS = POWER_LAB_TILE_SCALE;

/** Two tiles tall with the anchor tile at the bottom, so the foot sorts on the tile's lower edge. */
const TALL_FRAME_HEIGHT = TS * 2;
const TALL_TILE_Y = TS;
/** The console's monitor stands half a tile above its desk. */
const CONSOLE_FRAME_HEIGHT = TS + TS / 2;
const CONSOLE_TILE_Y = TS / 2;
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
      // The vat is kept a pixel inside the cell's sides and top: it is one tile
      // wide, and glass drawn past its tile would read as a vat wider than the
      // ground it blocks.
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
  key: 'power_lab_vat',
  file: 'power_lab_vat.png',
  frameWidth: TS,
  frameHeight: TALL_FRAME_HEIGHT,
  tileX: 0,
  tileY: TALL_TILE_Y,
  tileScale: TS,
  rows: [
    vatRow('intact', VAT_BUBBLE_FRAMES, true, paintVatIntact),
    vatRow('intact_empty', VAT_BUBBLE_FRAMES, false, paintVatIntact),
  ],
};

const consolePlan: PropSheetPlan = {
  key: 'power_lab_console',
  file: 'power_lab_console.png',
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
  key: 'power_lab_fx',
  file: 'power_lab_fx.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  rows: [fxRow('ripple', FX_RIPPLE_FRAMES, paintRipple), fxRow('drip', FX_DRIP_FRAMES, paintDrip)],
};

/**
 * Washes that light a whole tile of puddle: the sparks crawling over it before
 * the Current Goblin charges it, and the arc while it is charged. Each fills its
 * cell edge to edge so a run of charged tiles reads as one sheet of water, which
 * is why its edges are painted against on purpose.
 */
const washPlan: PropSheetPlan = {
  key: 'power_lab_wash',
  file: 'power_lab_wash.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  groundedEdges: new Set<FrameEdge>(['top', 'bottom', 'left', 'right']),
  rows: [fxRow('sparks', FX_SPARK_FRAMES, paintSparks), fxRow('arc', FX_ARC_FRAMES, paintArc)],
};

/**
 * The painted prop sheets that dress the power lab.
 * Requested when the floor loads, so they are ready before the room is seen.
 *
 * The art does not vary with the floor's seed: every vat holds the same
 * failed young kraken.
 */
export function powerLabSheetPlans(_artSeed: number): PropSheetPlan[] {
  return [vatPlan, consolePlan, fxPlan, washPlan];
}
