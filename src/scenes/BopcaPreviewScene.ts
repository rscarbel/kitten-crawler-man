/**
 * Localhost-only harness for eyeballing the Bopca: one hero figure behind a real
 * counter run at four sizes, plus a grid of every animation state and a row of
 * seeded palette variants. Click anywhere to advance the palette seed.
 *
 * Reached via `?bopca` in `devBootScene` (see `game.ts`); never on a production
 * path. Exists because the Bopca is only ever seen from the waist up behind a
 * counter, and the only way to judge whether the face reads at 32 px is to look
 * at it at 32 px next to the same face at 128 px.
 */

import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import { drawText } from '../ui/TextBox';
import {
  bopcaPaletteForSeed,
  drawBopcaSprite,
  BOPCA_HEIGHT_TILE_FRACTION,
  type BopcaState,
} from '../sprites/bopcaSprite';
import {
  BOPCA_FEET_COUNTER_FRACTION,
  counterEdges,
  drawCounterFrontFace,
  drawCounterBackTile,
  drawGalleyFloorTile,
  drawServedDish,
  type DishVisual,
} from '../sprites/safeRoomCounter';
import {
  COUNTER_RUN_BACK_ROW,
  COUNTER_RUN_FRONT_ROW,
  COUNTER_RUN_GALLEY_ROW,
  counterRunStructure,
  DISH_COLUMN_OFFSET_FROM_BOPCA,
} from '../map/safeRoomCounterLayout';
import { SAFE_ROOM_COUNTER, SAFE_ROOM_COUNTER_BACK } from '../map/tileTypes';

const BG_COLOR = '#1b2436';
const PANEL_COLOR = '#232f47';
const LABEL_COLOR = '#e2e8f0';
const SUBLABEL_COLOR = '#93a2c0';

const MARGIN = 40;
const TITLE_SIZE = 20;
const LABEL_SIZE = 12;
/** Gap between a section heading and the figures under it. */
const HEADING_GAP = 20;
/** Gap between a figure and its caption. */
const CAPTION_GAP = 4;
/** Slack above and below the hero band's backing panel. */
const PANEL_PAD = 10;
const FRAMES_PER_SECOND = 60;
/** Half a tile: the offset from a tile's left edge to its centre line. */
const TILE_CENTRE_FRACTION = 0.5;

/**
 * Tile sizes the hero row is drawn at. `IN_GAME_TILE_SIZE` last, because the
 * only judgement that matters is whether the face still reads there.
 */
const HERO_TILE_SIZE_LARGE = 128;
const HERO_TILE_SIZE_MEDIUM = 96;
const HERO_TILE_SIZE_SMALL = 64;
const IN_GAME_TILE_SIZE = 32;
const HERO_TILE_SIZES: ReadonlyArray<number> = [
  HERO_TILE_SIZE_LARGE,
  HERO_TILE_SIZE_MEDIUM,
  HERO_TILE_SIZE_SMALL,
  IN_GAME_TILE_SIZE,
];
const HERO_ROW_TOP = 70;
const HERO_GAP = 36;
const HERO_CAPTION_GAP = 6;

const STATES: ReadonlyArray<BopcaState> = [
  'idle',
  'cooking',
  'serving',
  'leaning',
  'wipingHands',
  'readingNews',
  'annoyed',
  'pleased',
];

const STATE_TILE_SIZE = 72;
const STATE_COLUMNS = 4;
const STATE_CELL_W = 150;
const STATE_CELL_H = 170;
const STATE_GRID_TOP_GAP = 40;

const PALETTE_VARIANT_COUNT = 5;
const PALETTE_TILE_SIZE = 56;
const PALETTE_CELL_W = 110;
const PALETTE_ROW_TOP_GAP = 34;

/**
 * Counter tiles drawn around each figure, so occlusion is judged in context.
 *
 * Three is the minimum that produces every case the tile renderer distinguishes:
 * two side returns and one galley tile, with both of the front bar's end caps.
 */
const COUNTER_RUN_TILES = 3;
/** The real tile grid of a standalone run, so edge detection sees real neighbours. */
const RUN_STRUCTURE = counterRunStructure(COUNTER_RUN_TILES);

/** A stand-in dish for the serving state, so the counter is not always bare. */
const PREVIEW_DISH: DishVisual = {
  shape: 'bowl',
  vesselColor: '#e8e0cc',
  contentColor: '#b4762e',
  garnishColor: '#6f9f4a',
};

const BLINK_INTERVAL_FRAMES = 190;
const BLINK_DURATION_FRAMES = 7;
const LOOK_CYCLE_RATE = 0.013;
/** The vertical look drifts slower than the horizontal, so the two never lock. */
const LOOK_VERTICAL_RATE_RATIO = 0.6;

/**
 * A one-tile-wide slice of counter with the Bopca standing behind it: back
 * bench, galley strip, front bar, figure, then the bar's front face again.
 *
 * Mirrors exactly what `BopcaSystem` does in the world so the preview cannot
 * drift from the real render order.
 */
function drawBopcaAtCounter(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  frontRowTopY: number,
  ts: number,
  state: BopcaState,
  seed: number,
  frames: number,
): void {
  const runLeft = centreX - (COUNTER_RUN_TILES * ts) / 2;
  const galleyRowTop = frontRowTopY - ts;
  const backRowTop = frontRowTopY - ts * 2;
  const lastColumn = COUNTER_RUN_TILES - 1;
  const galleyColumn = Math.floor(COUNTER_RUN_TILES / 2);

  /** Every counter tile's front face — the pass `BopcaSystem` repeats after the figure. */
  const drawCounterFronts = (): void => {
    for (let column = 0; column < COUNTER_RUN_TILES; column++) {
      const tileX = runLeft + column * ts;
      if (column === 0 || column === lastColumn) {
        drawCounterFrontFace(
          ctx,
          tileX,
          galleyRowTop,
          ts,
          counterEdges(RUN_STRUCTURE, SAFE_ROOM_COUNTER, column, COUNTER_RUN_GALLEY_ROW),
        );
      }
      drawCounterFrontFace(
        ctx,
        tileX,
        frontRowTopY,
        ts,
        counterEdges(RUN_STRUCTURE, SAFE_ROOM_COUNTER, column, COUNTER_RUN_FRONT_ROW),
      );
    }
  };

  for (let column = 0; column < COUNTER_RUN_TILES; column++) {
    const tileX = runLeft + column * ts;
    // The galley's flagstone goes under all three rows, exactly as
    // `drawInteriorTile` does in the game: every counter tile leaves a sliver of
    // it showing on the kitchen side.
    for (const rowTop of [backRowTop, galleyRowTop, frontRowTopY]) {
      drawGalleyFloorTile(ctx, tileX, rowTop, ts, column, 0);
    }
    drawCounterBackTile(
      ctx,
      tileX,
      backRowTop,
      ts,
      counterEdges(RUN_STRUCTURE, SAFE_ROOM_COUNTER_BACK, column, COUNTER_RUN_BACK_ROW),
      column,
    );
  }
  drawCounterFronts();

  const blinking = frames % BLINK_INTERVAL_FRAMES < BLINK_DURATION_FRAMES;
  const bopcaCentreX = runLeft + (galleyColumn + TILE_CENTRE_FRACTION) * ts;
  drawBopcaSprite(ctx, bopcaCentreX, frontRowTopY + ts * BOPCA_FEET_COUNTER_FRACTION, ts, {
    state,
    animFrames: frames,
    lookX: Math.sin(frames * LOOK_CYCLE_RATE),
    lookY: Math.sin(frames * LOOK_CYCLE_RATE * LOOK_VERTICAL_RATE_RATIO),
    palette: bopcaPaletteForSeed(seed),
    blinking,
  });

  drawCounterFronts();

  if (state === 'serving') {
    drawServedDish(
      ctx,
      runLeft + (galleyColumn + DISH_COLUMN_OFFSET_FROM_BOPCA) * ts,
      frontRowTopY,
      ts,
      {
        visual: PREVIEW_DISH,
        coldness: 0,
        elapsedSeconds: frames / FRAMES_PER_SECOND,
      },
    );
  }
}

export class BopcaPreviewScene extends Scene {
  private frames = 0;
  private seedBase = 0;

  constructor(private readonly sceneManager: SceneManager) {
    super();
  }

  handleClick(): void {
    this.seedBase += 1;
  }

  update(): void {
    this.frames += 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.sceneManager.canvas;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    drawText(ctx, 'Bopca Protector — click to advance the palette seed', {
      x: MARGIN,
      y: 16,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
      outline: true,
    });

    const stateGridTop = this.renderHeroRow(ctx, width);
    const paletteRowTop = this.renderStateGrid(ctx, stateGridTop);
    this.renderPaletteRow(ctx, paletteRowTop, height);
  }

  /** Returns the y the next section may start at. */
  private renderHeroRow(ctx: CanvasRenderingContext2D, width: number): number {
    const tallest = HERO_TILE_SIZES[0] * BOPCA_HEIGHT_TILE_FRACTION;
    const baseline = HERO_ROW_TOP + tallest;
    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(
      0,
      HERO_ROW_TOP - PANEL_PAD,
      width,
      tallest + HERO_TILE_SIZE_LARGE + PANEL_PAD * 2,
    );

    let cursorX = MARGIN;
    for (const ts of HERO_TILE_SIZES) {
      const centreX = cursorX + (COUNTER_RUN_TILES * ts) / 2;
      drawBopcaAtCounter(ctx, centreX, baseline, ts, 'idle', this.seedBase, this.frames);
      drawText(ctx, `${ts}px tile`, {
        x: centreX,
        y: baseline + ts + HERO_CAPTION_GAP,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
        align: 'center',
      });
      cursorX += COUNTER_RUN_TILES * ts + HERO_GAP;
    }
    return baseline + HERO_TILE_SIZE_LARGE + STATE_GRID_TOP_GAP;
  }

  private renderStateGrid(ctx: CanvasRenderingContext2D, top: number): number {
    drawText(ctx, 'States', {
      x: MARGIN,
      y: top,
      size: LABEL_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    const gridTop = top + HEADING_GAP;
    STATES.forEach((state, index) => {
      const column = index % STATE_COLUMNS;
      const row = Math.floor(index / STATE_COLUMNS);
      const cellX = MARGIN + column * STATE_CELL_W;
      const cellY = gridTop + row * STATE_CELL_H;
      const centreX = cellX + STATE_CELL_W / 2;
      const frontRowTop = cellY + STATE_TILE_SIZE * BOPCA_HEIGHT_TILE_FRACTION;
      drawBopcaAtCounter(
        ctx,
        centreX,
        frontRowTop,
        STATE_TILE_SIZE,
        state,
        this.seedBase,
        this.frames,
      );
      drawText(ctx, state, {
        x: centreX,
        y: frontRowTop + STATE_TILE_SIZE + CAPTION_GAP,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
        align: 'center',
      });
    });
    const rows = Math.ceil(STATES.length / STATE_COLUMNS);
    return gridTop + rows * STATE_CELL_H + PALETTE_ROW_TOP_GAP;
  }

  private renderPaletteRow(ctx: CanvasRenderingContext2D, top: number, height: number): void {
    if (top > height) return;
    drawText(ctx, 'Seeded palettes', {
      x: MARGIN,
      y: top,
      size: LABEL_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    const rowTop = top + HEADING_GAP;
    for (let variant = 0; variant < PALETTE_VARIANT_COUNT; variant++) {
      const centreX = MARGIN + variant * PALETTE_CELL_W + PALETTE_CELL_W / 2;
      const frontRowTop = rowTop + PALETTE_TILE_SIZE * BOPCA_HEIGHT_TILE_FRACTION;
      drawBopcaAtCounter(
        ctx,
        centreX,
        frontRowTop,
        PALETTE_TILE_SIZE,
        'idle',
        this.seedBase + variant,
        this.frames,
      );
      drawText(ctx, `seed ${this.seedBase + variant}`, {
        x: centreX,
        y: frontRowTop + PALETTE_TILE_SIZE + CAPTION_GAP,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
        align: 'center',
      });
    }
  }
}
