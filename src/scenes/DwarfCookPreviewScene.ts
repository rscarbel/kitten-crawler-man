/**
 * Localhost-only harness for eyeballing the dwarf cook: one hero figure at four
 * sizes, plus a grid of every animation state and a row of seeded palette
 * variants. Tap the art to advance the palette seed.
 *
 * Reached via `?dwarf-cook` in `devBootScene` (see `game.ts`); never on a
 * production path. The figure is placed nowhere in the game yet, so this and
 * `scripts/render-dwarf-cook.ts` are the only places it can be judged, and the
 * only way to judge whether the face reads at 32 px is to look at it at 32 px
 * next to the same face at 128 px.
 */

import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { worldText } from '../ui/world/worldText';
import type { WorldGesture } from '../ui/core/UiRoot';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import {
  dwarfCookPaletteForSeed,
  drawDwarfCookSprite,
  DWARF_COOK_HEIGHT_TILE_FRACTION,
  type DwarfCookState,
} from '../sprites/dwarfCookSprite';
import { previewInk } from '../ui/theme/previewInk';
import { worldPalette } from '../ui/theme/worldInk';

const BG_COLOR = previewInk.dwarfCook.backdrop;
const PANEL_COLOR = previewInk.dwarfCook.panel;
const FLOOR_COLOR = previewInk.dwarfCook.floor;
const LABEL_COLOR = worldPalette.ink.primary;
const SUBLABEL_COLOR = previewInk.dwarfCook.sublabel;

const MARGIN = 40;
const LABEL_SIZE = 12;
/** Gap between a section heading and the figures under it. */
const HEADING_GAP = 20;
/** Gap between a figure and its caption. */
const CAPTION_GAP = 4;
/** Slack above and below the hero band's backing panel. */
const PANEL_PAD = 10;

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
/** Space between the header and the hero band, leaving room for the band's backing panel. */
const HERO_ROW_TOP_GAP = 24;
const HERO_GAP = 36;
const HERO_CAPTION_GAP = 6;

const STATES: ReadonlyArray<DwarfCookState> = [
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

/** Tiles of floor drawn under each figure, so its stance is judged on a floor. */
const FLOOR_TILES_WIDE = 1;

const BLINK_INTERVAL_FRAMES = 190;
const BLINK_DURATION_FRAMES = 7;
const LOOK_CYCLE_RATE = 0.013;
/** The vertical look drifts slower than the horizontal, so the two never lock. */
const LOOK_VERTICAL_RATE_RATIO = 0.6;

/** The cook standing on a one-tile slab of floor whose top edge is `feetY`. */
function drawCookOnFloor(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  feetY: number,
  ts: number,
  state: DwarfCookState,
  seed: number,
  frames: number,
): void {
  const floorWidth = FLOOR_TILES_WIDE * ts;
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(centreX - floorWidth / 2, feetY - ts / 2, floorWidth, ts);
  const blinking = frames % BLINK_INTERVAL_FRAMES < BLINK_DURATION_FRAMES;
  drawDwarfCookSprite(ctx, centreX, feetY, ts, {
    state,
    animFrames: frames,
    lookX: Math.sin(frames * LOOK_CYCLE_RATE),
    lookY: Math.sin(frames * LOOK_CYCLE_RATE * LOOK_VERTICAL_RATE_RATIO),
    palette: dwarfCookPaletteForSeed(seed),
    blinking,
  });
}

export class DwarfCookPreviewScene extends PreviewScene {
  private frames = 0;
  private seedBase = 0;

  protected previewTitle(): string {
    return 'Dwarf cook — tap the art to advance the palette seed';
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        label: 'next seed',
        onTap: () => {
          this.advanceSeed();
        },
      },
    ];
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.tap) this.advanceSeed();
  }

  private advanceSeed(): void {
    this.seedBase += 1;
  }

  update(): void {
    this.frames += 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const stateGridTop = this.renderHeroRow(ctx, width);
    const paletteRowTop = this.renderStateGrid(ctx, stateGridTop);
    this.renderPaletteRow(ctx, paletteRowTop, height);
    this.renderChrome(ctx);
  }

  /** Returns the y the next section may start at. */
  private renderHeroRow(ctx: CanvasRenderingContext2D, width: number): number {
    const heroRowTop = this.headerBottom + HERO_ROW_TOP_GAP;
    const tallest = HERO_TILE_SIZES[0] * DWARF_COOK_HEIGHT_TILE_FRACTION;
    const baseline = heroRowTop + tallest;
    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(0, heroRowTop - PANEL_PAD, width, tallest + HERO_TILE_SIZE_LARGE + PANEL_PAD * 2);

    let cursorX = MARGIN;
    for (const ts of HERO_TILE_SIZES) {
      const centreX = cursorX + (FLOOR_TILES_WIDE * ts) / 2;
      drawCookOnFloor(ctx, centreX, baseline, ts, 'idle', this.seedBase, this.frames);
      worldText(ctx, `${ts}px tile`, {
        x: centreX,
        y: baseline + ts + HERO_CAPTION_GAP,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
        align: 'center',
      });
      cursorX += FLOOR_TILES_WIDE * ts + HERO_GAP;
    }
    return baseline + HERO_TILE_SIZE_LARGE + STATE_GRID_TOP_GAP;
  }

  private renderStateGrid(ctx: CanvasRenderingContext2D, top: number): number {
    worldText(ctx, 'States', {
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
      const feetY = cellY + STATE_TILE_SIZE * DWARF_COOK_HEIGHT_TILE_FRACTION;
      drawCookOnFloor(ctx, centreX, feetY, STATE_TILE_SIZE, state, this.seedBase, this.frames);
      worldText(ctx, state, {
        x: centreX,
        y: feetY + STATE_TILE_SIZE + CAPTION_GAP,
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
    worldText(ctx, 'Seeded palettes', {
      x: MARGIN,
      y: top,
      size: LABEL_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    const rowTop = top + HEADING_GAP;
    for (let variant = 0; variant < PALETTE_VARIANT_COUNT; variant++) {
      const centreX = MARGIN + variant * PALETTE_CELL_W + PALETTE_CELL_W / 2;
      const feetY = rowTop + PALETTE_TILE_SIZE * DWARF_COOK_HEIGHT_TILE_FRACTION;
      drawCookOnFloor(
        ctx,
        centreX,
        feetY,
        PALETTE_TILE_SIZE,
        'idle',
        this.seedBase + variant,
        this.frames,
      );
      worldText(ctx, `seed ${this.seedBase + variant}`, {
        x: centreX,
        y: feetY + PALETTE_TILE_SIZE + CAPTION_GAP,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
        align: 'center',
      });
    }
  }
}
