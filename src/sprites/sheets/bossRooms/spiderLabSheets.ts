import {
  BENCH_HEADROOM_SHARE,
  BENCH_SEGMENTS,
  BENCH_VARIANTS,
  COCOON_HATCH_FRAMES,
  COCOON_IDLE_FRAMES,
  EGG_OPENING_FRAMES,
  LAB_TILE_SCALE,
  LIGHT_BANK_LOOKS,
  LIGHT_BANK_TILES,
  SHELF_HEIGHT_SHARE,
  SHELF_VARIANTS,
  TERMINAL_COLS,
  TERMINAL_HEADROOM_SHARE,
  TERMINAL_ROWS,
  WEB_GROWTH_FRAMES,
  drawCocoon,
  drawEggSac,
  drawLabBench,
  drawLabTerminal,
  drawLightBank,
  drawScientistRemains,
  drawSpecimenShelf,
  drawSpecimenShelfSide,
  drawWebGrowth,
  type RemainsColors,
} from '../../art/spiderLabArt';
import type { FrameEdge, FramePainter, PropSheetPlan } from '../propSheetPlan';
import { scientistRemainsColors } from '../../person/labScientist';

/**
 * The painted sheets that dress the Grotesque Spider's lab. Requested when the
 * floor loads, so they are ready before the room is seen.
 *
 * Nothing here reads the floor's art seed: every piece is one fixed picture per
 * frame, and the floor's variety comes from which frame a tile picks.
 */

const S = LAB_TILE_SCALE;

/** Bench, terminal and shelving stand on their footprint and run on into their neighbours. */
const FURNITURE_EDGES: ReadonlySet<FrameEdge> = new Set(['bottom', 'left', 'right']);

/** The egg sac and the cocoons touch the floor their frame ends on; their shadows pool against it. */
const STANDS_ON_FLOOR: ReadonlySet<FrameEdge> = new Set(['bottom']);
const ALL_EDGES: ReadonlySet<FrameEdge> = new Set(['top', 'bottom', 'left', 'right']);

const BENCH_HEADROOM = S * BENCH_HEADROOM_SHARE;
const TERMINAL_HEADROOM = S * TERMINAL_HEADROOM_SHARE;
const SHELF_HEADROOM = S * SHELF_HEIGHT_SHARE;

/** Cocoons hang a tile above their own; the egg and the remains stand a tile across. */
const COCOON_HEADROOM = S;
const EGG_FRAME = S * 2;
const REMAINS_FRAME = S * 2;
const REMAINS_HEADROOM = S / 2;

/** Frame index of a bench tile: its segment, then its glassware variant. */
export function benchFrameIndex(segmentIndex: number, variant: number): number {
  return segmentIndex * BENCH_VARIANTS + (variant % BENCH_VARIANTS);
}

/** Frame index of a side-wall shelf tile: its load, then whether it ends the run. */
export function sideShelfFrameIndex(variant: number, end: boolean): number {
  return (end ? SHELF_VARIANTS : 0) + (variant % SHELF_VARIANTS);
}

/** Frame index of one tile of the terminal's bench. */
export function terminalFrameIndex(col: number, row: number): number {
  return row * TERMINAL_COLS + col;
}

function benchRow(broken: boolean): FramePainter[] {
  return BENCH_SEGMENTS.flatMap((segment) =>
    Array.from(
      { length: BENCH_VARIANTS },
      (_unused, variant): FramePainter =>
        (ctx, ox, oy) =>
          drawLabBench(ctx, ox, oy, S, segment, variant, broken),
    ),
  );
}

/**
 * One tile's crop of the terminal. A back-row tile keeps everything above its
 * own bottom edge — the monitor rises from it — and a front-row tile keeps only
 * its own tile, so the two never paint the same pixels twice.
 */
function terminalSlice(col: number, row: number): FramePainter {
  return (ctx, ox, oy) => {
    ctx.save();
    try {
      ctx.beginPath();
      if (row === 0) ctx.rect(ox, oy - TERMINAL_HEADROOM, S, S + TERMINAL_HEADROOM);
      else ctx.rect(ox, oy, S, S);
      ctx.clip();
      drawLabTerminal(ctx, ox - col * S, oy - row * S, S);
    } finally {
      ctx.restore();
    }
  };
}

const OPENING_STEPS = EGG_OPENING_FRAMES + 1;

export function spiderLabSheetPlans(_artSeed: number): PropSheetPlan[] {
  const remains: RemainsColors = scientistRemainsColors();
  return [
    {
      key: 'spider_lab_bench',
      file: 'spider_lab_bench.png',
      frameWidth: S,
      frameHeight: S + BENCH_HEADROOM,
      tileX: 0,
      tileY: BENCH_HEADROOM,
      tileScale: S,
      groundedEdges: FURNITURE_EDGES,
      rows: [
        { state: 'intact', frames: benchRow(false) },
        { state: 'broken', frames: benchRow(true) },
      ],
    },
    {
      key: 'spider_lab_terminal',
      file: 'spider_lab_terminal.png',
      frameWidth: S,
      frameHeight: S + TERMINAL_HEADROOM,
      tileX: 0,
      tileY: TERMINAL_HEADROOM,
      tileScale: S,
      groundedEdges: FURNITURE_EDGES,
      rows: [
        {
          state: 'slice',
          frames: Array.from({ length: TERMINAL_ROWS * TERMINAL_COLS }, (_unused, index) =>
            terminalSlice(index % TERMINAL_COLS, Math.floor(index / TERMINAL_COLS)),
          ),
        },
      ],
    },
    {
      key: 'spider_lab_shelf',
      file: 'spider_lab_shelf.png',
      frameWidth: S,
      frameHeight: S + SHELF_HEADROOM,
      tileX: 0,
      tileY: SHELF_HEADROOM,
      tileScale: S,
      groundedEdges: FURNITURE_EDGES,
      rows: [
        {
          state: 'idle',
          frames: Array.from(
            { length: SHELF_VARIANTS },
            (_unused, variant): FramePainter =>
              (ctx, ox, oy) =>
                drawSpecimenShelf(ctx, ox, oy, S, variant),
          ),
        },
        {
          state: 'side',
          frames: [false, true].flatMap((end) =>
            Array.from(
              { length: SHELF_VARIANTS },
              (_unused, variant): FramePainter =>
                (ctx, ox, oy) =>
                  drawSpecimenShelfSide(ctx, ox, oy, S, variant, end),
            ),
          ),
        },
      ],
    },
    {
      key: 'spider_lab_egg_sac',
      file: 'spider_lab_egg_sac.png',
      frameWidth: EGG_FRAME,
      frameHeight: EGG_FRAME,
      tileX: (EGG_FRAME - S) / 2,
      tileY: EGG_FRAME - S,
      tileScale: S,
      groundedEdges: STANDS_ON_FLOOR,
      rows: [
        { state: 'whole', frames: [(ctx, ox, oy) => drawEggSac(ctx, ox, oy, S, 0)] },
        {
          state: 'opening',
          frames: Array.from(
            { length: EGG_OPENING_FRAMES },
            (_unused, step): FramePainter =>
              (ctx, ox, oy) =>
                drawEggSac(ctx, ox, oy, S, (step + 1) / OPENING_STEPS),
          ),
        },
        { state: 'opened', frames: [(ctx, ox, oy) => drawEggSac(ctx, ox, oy, S, 1)] },
      ],
    },
    {
      key: 'spider_lab_cocoon',
      file: 'spider_lab_cocoon.png',
      frameWidth: S,
      frameHeight: S + COCOON_HEADROOM,
      tileX: 0,
      tileY: COCOON_HEADROOM,
      tileScale: S,
      groundedEdges: STANDS_ON_FLOOR,
      rows: [
        {
          state: 'idle',
          frames: Array.from(
            { length: COCOON_IDLE_FRAMES },
            (_unused, pose): FramePainter =>
              (ctx, ox, oy) =>
                drawCocoon(ctx, ox, oy, S, {
                  sway: COCOON_SWAYS[pose] ?? 0,
                  hatch: 0,
                  burst: false,
                }),
          ),
        },
        {
          state: 'hatching',
          frames: Array.from(
            { length: COCOON_HATCH_FRAMES },
            (_unused, step): FramePainter =>
              (ctx, ox, oy) =>
                drawCocoon(ctx, ox, oy, S, {
                  sway: step % 2 === 0 ? 1 : -1,
                  hatch: (step + 1) / COCOON_HATCH_FRAMES,
                  burst: false,
                }),
          ),
        },
        {
          state: 'burst',
          frames: [(ctx, ox, oy) => drawCocoon(ctx, ox, oy, S, { sway: 0, hatch: 1, burst: true })],
        },
      ],
    },
    {
      key: 'spider_lab_light_bank',
      file: 'spider_lab_light_bank.png',
      frameWidth: S * LIGHT_BANK_TILES,
      frameHeight: S * LIGHT_BANK_FRAME_SHARE,
      tileX: 0,
      tileY: 0,
      tileScale: S,
      rows: LIGHT_BANK_LOOKS.map((look) => ({
        state: look,
        frames: [
          (ctx: CanvasRenderingContext2D, ox: number, oy: number) =>
            drawLightBank(ctx, ox, oy, S, look),
        ],
      })),
    },
    {
      key: 'spider_lab_web_growth',
      file: 'spider_lab_web_growth.png',
      frameWidth: S,
      frameHeight: S,
      tileX: 0,
      tileY: 0,
      tileScale: S,
      // A floor decal: it fills its tile to the edges, as the web it becomes does.
      groundedEdges: ALL_EDGES,
      rows: [
        {
          state: 'grow',
          frames: Array.from(
            { length: WEB_GROWTH_FRAMES },
            (_unused, step): FramePainter =>
              (ctx, ox, oy) =>
                drawWebGrowth(ctx, ox, oy, S, (step + 1) / WEB_GROWTH_FRAMES),
          ),
        },
      ],
    },
    {
      key: 'spider_lab_remains',
      file: 'spider_lab_remains.png',
      frameWidth: REMAINS_FRAME,
      frameHeight: REMAINS_FRAME,
      tileX: (REMAINS_FRAME - S) / 2,
      tileY: REMAINS_HEADROOM,
      tileScale: S,
      rows: [
        { state: 'idle', frames: [(ctx, ox, oy) => drawScientistRemains(ctx, ox, oy, S, remains)] },
      ],
    },
  ];
}

/** The idle twitch: hanging still, then swung a little each way. */
const COCOON_SWAYS: readonly number[] = [0, 1, -1];
/** A light bank's frame height, as a share of a tile: its housing and the bloom round it. */
const LIGHT_BANK_FRAME_SHARE = 0.625;
