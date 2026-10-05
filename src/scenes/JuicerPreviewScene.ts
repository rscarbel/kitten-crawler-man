/**
 * Localhost-only harness for watching the Juicer stand, walk, sprint, throw and
 * ground-punch. Reached via `?juicer` in `devBootScene`; never on a production
 * path.
 *
 * It exists because a still cannot answer the questions that matter here:
 * `scripts/render-juicer.ts` shows that the walk loop closes and the fists
 * reach the floor, but only playback shows whether the twelve-frame sprint
 * reads as a charge or as strobing, and whether the punch's telegraph lasts
 * long enough to dodge.
 *
 * All four facings play every row at once on a labelled grid, over a backdrop
 * that cycles the real floor palettes so the contrast check happens against the
 * thing the creature actually stands on — the dorsal hide is dark, and a
 * creature at the floor's own luminance is a smudge at 32 px.
 *
 * The figure is addressed by state name at run time rather than through a
 * typed state union, because a row being worked on may not be declared yet:
 * this harness says so on screen rather than failing to compile.
 */

import { viewportWidth, viewportHeight } from '../core/Viewport';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { JUICER_FIGURE } from '../sprites/art/juicerFigure';
import { figureFrameCount } from '../sprites/figure/figureDef';
import { drawFigureCached } from '../sprites/figure/figureFrameCache';
import {
  JUICER_IDLE_FRAMES,
  JUICER_PUNCH_FRAMES,
  JUICER_SPRINT_FRAMES,
  JUICER_THROW_FRAMES,
  JUICER_WALK_FRAMES,
  JUICER_FRAME_HOLD,
  JUICER_SPRINT_FRAME_HOLD,
  juicerActionFrames,
} from '../sprites/juicerAttackTiming';
import { previewInk } from '../ui/theme/previewInk';

/** A facing vector per column, chosen so the view rule picks each viewpoint. */
interface ViewSpec {
  readonly label: string;
  readonly suffix: string;
  readonly flipX: boolean;
}

/**
 * The sheet carries three views; the profile is mirrored for the other
 * direction. Mirroring a head-on view would put his eyes and feet on the wrong
 * sides every time he turned around.
 */
const VIEWS: ReadonlyArray<ViewSpec> = [
  { label: 'side →', suffix: '_side', flipX: false },
  { label: 'side ←', suffix: '_side', flipX: true },
  { label: 'toward', suffix: '', flipX: false },
  { label: 'away', suffix: '_away', flipX: false },
];

interface RowSpec {
  readonly base: string;
  readonly frameCount: number;
  /**
   * How many *game* frames the row spans. Derived from the shared timing module
   * rather than picked here: a harness that plays a row at a different rate
   * from the game hides undersampling, which is the one defect a still cannot
   * show and this scene exists to catch.
   */
  readonly gameFrames: number;
}

const IDLE_GAME_FRAMES = 64;
const WALK_GAME_FRAMES = 64;

const ROWS: ReadonlyArray<RowSpec> = [
  { base: 'idle', frameCount: JUICER_IDLE_FRAMES, gameFrames: IDLE_GAME_FRAMES },
  { base: 'walk', frameCount: JUICER_WALK_FRAMES, gameFrames: WALK_GAME_FRAMES },
  {
    base: 'sprint',
    frameCount: JUICER_SPRINT_FRAMES,
    gameFrames: JUICER_SPRINT_FRAMES * JUICER_SPRINT_FRAME_HOLD,
  },
  {
    base: 'throw',
    frameCount: JUICER_THROW_FRAMES,
    gameFrames: juicerActionFrames(JUICER_THROW_FRAMES),
  },
  {
    base: 'punch',
    frameCount: JUICER_PUNCH_FRAMES,
    gameFrames: juicerActionFrames(JUICER_PUNCH_FRAMES),
  },
];

/** 1× is what a player sees; 4× is where a lip scale becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids the Juicer actually stands on, from `src/map/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: previewInk.floor.cellarStone },
  { name: 'floor 1 — dressed stone', color: previewInk.floor.dressedStone },
  { name: 'floor 2 — poured concrete', color: previewInk.floor.pouredConcrete },
  { name: 'gym mat', color: previewInk.floor.gymMat },
  { name: 'unlit cave', color: previewInk.floor.unlitCave },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;
const CELL_WIDTH_TILES = 3;
const CELL_HEIGHT_TILES = 2.9;
/** Where a cell's creature stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.94;
const MISSING_STATE_COLOR = previewInk.grid.missingState;

export class JuicerPreviewScene extends PreviewScene {
  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;
  private missingStates = new Set<string>();

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
  }

  /** 0–1 through a row's own game-frame span. */
  private progressOf(row: RowSpec): number {
    return (Math.floor(this.clock) % row.gameFrames) / row.gameFrames;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * CELL_WIDTH_TILES, h: tile * CELL_HEIGHT_TILES };
  }

  /**
   * Draws one cell, or records the state name when the figure has no such row.
   * A silent no-op here would look exactly like a creature that renders nothing
   * because its art is broken.
   */
  private drawCell(
    ctx: CanvasRenderingContext2D,
    state: string,
    frame: number,
    x: number,
    y: number,
    tile: number,
    flipX: boolean,
  ): void {
    if (figureFrameCount(JUICER_FIGURE, state) === 0) {
      this.missingStates.add(state);
      return;
    }
    drawFigureCached(ctx, JUICER_FIGURE, state, frame, x, y, tile, { flipX });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.missingStates.clear();

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = this.headerBottom + MARGIN + LABEL_SIZE;
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];

    VIEWS.forEach((view, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      worldText(ctx, view.label, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: previewInk.grid.caption,
        outline: true,
      });
    });

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const progress = this.progressOf(row);
      const frame = Math.min(row.frameCount - 1, Math.floor(progress * row.frameCount));
      worldText(ctx, row.base, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.caption,
        outline: true,
      });
      worldText(ctx, `f${frame}  ${row.gameFrames}gf`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: previewInk.grid.timingReadout,
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        this.drawCell(
          ctx,
          `${row.base}${view.suffix}`,
          frame,
          x + cell.w / 2 - tile / 2,
          y + cell.h * GROUND_FRACTION - tile,
          tile,
          view.flipX,
        );
        ctx.restore();

        ctx.strokeStyle = previewInk.grid.cellBorder;
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });

    if (this.missingStates.size > 0) {
      worldText(ctx, `manifest is missing: ${[...this.missingStates].join(', ')}`, {
        x: MARGIN,
        y: height - MARGIN - LABEL_SIZE,
        size: LABEL_SIZE,
        color: MISSING_STATE_COLOR,
        outline: true,
        width: width - MARGIN * 2,
      });
    }

    this.renderChrome(ctx);
  }

  protected previewTitle(): string {
    return 'juicer preview — ?juicer';
  }

  protected previewCaptions(): readonly string[] {
    return [`${BACKDROPS[this.backdropIndex].name}  ·  hold ${JUICER_FRAME_HOLD}gf/frame`];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        id: 'zoom',
        label: `zoom ${ZOOM_LEVELS[this.zoomIndex]}x`,
        onTap: () => {
          this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
        },
      },
      {
        id: 'play',
        label: this.paused ? 'play' : 'pause',
        onTap: () => {
          this.paused = !this.paused;
        },
      },
      {
        label: 'step',
        onTap: () => {
          this.paused = true;
          this.stepRequested = true;
        },
      },
      {
        id: 'speed',
        label: `speed ${SPEED_LEVELS[this.speedIndex]}x`,
        onTap: () => {
          this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
        },
      },
      {
        label: 'backdrop',
        onTap: () => {
          this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
        },
      },
    ];
  }
}
