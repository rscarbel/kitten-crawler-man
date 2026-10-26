/**
 * Localhost-only harness for watching the Trash Gremlin crouch, scurry, spit and
 * summon. Reached via `?gremlin` in `src/dev/devBoot.ts`; never on a production path.
 *
 * A still cannot say whether the scurry reads as a scurry or a strobe, or
 * whether the summon's shriek lands on a beat a player would notice. Every row
 * plays here in all three views at once, at 128, 64 and 32 px a tile, over the
 * floors it is judged on.
 */

import { viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { TRASH_GREMLIN_FIGURE } from '../sprites/art/trashGremlinFigure';
import { figureFrameCount } from '../sprites/figure/figureDef';
import { drawFigureCached } from '../sprites/figure/figureFrameCache';
import { TILE_SIZE } from '../core/constants';
import {
  SUMMON_WINDUP_FRAMES,
  TRASH_GREMLIN_SPEED,
  VOMIT_WINDUP_FRAMES,
} from '../creatures/TrashGremlin';
import {
  TRASH_GREMLIN_IDLE_FPS,
  TRASH_GREMLIN_IDLE_FRAMES,
  TRASH_GREMLIN_SCURRY_GROUND_TILES,
  TRASH_GREMLIN_SCURRY_FRAMES,
  TRASH_GREMLIN_SUMMON_FRAMES,
  TRASH_GREMLIN_VOMIT_FRAMES,
} from '../sprites/trashGremlinSprite';
import { previewInk } from '../ui/theme/previewInk';

interface ViewSpec {
  readonly label: string;
  readonly suffix: string;
  readonly flipX: boolean;
}

/** The profile is mirrored for the other direction; the head-on views never are. */
const VIEWS: ReadonlyArray<ViewSpec> = [
  { label: 'side →', suffix: '_side', flipX: false },
  { label: 'side ←', suffix: '_side', flipX: true },
  { label: 'toward', suffix: '', flipX: false },
  { label: 'away', suffix: '_back', flipX: false },
];

interface RowSpec {
  readonly base: string;
  readonly frameCount: number;
  /** How many game frames one pass of the row spans in play. */
  readonly gameFrames: number;
}

const GAME_FRAMES_PER_SECOND = 60;
/** The idle runs on the wrapper's own clock. */
const IDLE_GAME_FRAMES = Math.round(
  (TRASH_GREMLIN_IDLE_FRAMES / TRASH_GREMLIN_IDLE_FPS) * GAME_FRAMES_PER_SECOND,
);
/**
 * One scurry cycle at its normal speed, the walk phase paced by the ground the
 * cycle covers.
 */
const SCURRY_GAME_FRAMES = Math.round(
  (TRASH_GREMLIN_SCURRY_GROUND_TILES * TILE_SIZE) / TRASH_GREMLIN_SPEED,
);
const VOMIT_GAME_FRAMES = VOMIT_WINDUP_FRAMES;
const SUMMON_GAME_FRAMES = SUMMON_WINDUP_FRAMES;

const ROWS: ReadonlyArray<RowSpec> = [
  { base: 'idle', frameCount: TRASH_GREMLIN_IDLE_FRAMES, gameFrames: IDLE_GAME_FRAMES },
  { base: 'scurry', frameCount: TRASH_GREMLIN_SCURRY_FRAMES, gameFrames: SCURRY_GAME_FRAMES },
  { base: 'vomit', frameCount: TRASH_GREMLIN_VOMIT_FRAMES, gameFrames: VOMIT_GAME_FRAMES },
  { base: 'summon', frameCount: TRASH_GREMLIN_SUMMON_FRAMES, gameFrames: SUMMON_GAME_FRAMES },
];

/** 4× is review size, 2× and 1× what a player sees on a big and a normal screen. */
const ZOOM_REVIEW = 4;
const ZOOM_DOUBLE = 2;
const ZOOM_IN_GAME = 1;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_REVIEW, ZOOM_DOUBLE, ZOOM_IN_GAME];
const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'its lair — linoleum', color: previewInk.floor.lairLinoleum },
  { name: 'floor 1 — cellar stone', color: previewInk.floor.cellarStone },
  { name: 'unlit cave', color: previewInk.floor.unlitCave },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;
const CELL_WIDTH_TILES = 4;
const CELL_HEIGHT_TILES = 3.4;
/** Where a cell's creature stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.9;

export class TrashGremlinPreviewScene extends PreviewScene {
  private zoomIndex = 1;
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
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

  private frameOf(row: RowSpec): number {
    const progress = (Math.floor(this.clock) % row.gameFrames) / row.gameFrames;
    return Math.min(row.frameCount - 1, Math.floor(progress * row.frameCount));
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.missingStates.clear();
    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const cellW = tile * CELL_WIDTH_TILES;
    const cellH = tile * CELL_HEIGHT_TILES;
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = this.headerBottom + MARGIN + LABEL_SIZE;

    VIEWS.forEach((view, column) => {
      worldText(ctx, view.label, {
        x: gridLeft + column * (cellW + CELL_PADDING) + cellW / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: previewInk.grid.caption,
        outline: true,
      });
    });

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cellH + CELL_PADDING);
      const frame = this.frameOf(row);
      worldText(ctx, `${row.base}  f${frame}`, {
        x: MARGIN,
        y: y + cellH / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.caption,
        outline: true,
      });
      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cellW + CELL_PADDING);
        const state = `${row.base}${view.suffix}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW, cellH);
        ctx.clip();
        if (figureFrameCount(TRASH_GREMLIN_FIGURE, state) === 0) this.missingStates.add(state);
        else {
          drawFigureCached(
            ctx,
            TRASH_GREMLIN_FIGURE,
            state,
            frame,
            x + cellW / 2 - tile / 2,
            y + cellH * GROUND_FRACTION - tile,
            tile,
            { flipX: view.flipX },
          );
        }
        ctx.restore();
        ctx.strokeStyle = previewInk.grid.cellBorder;
        ctx.strokeRect(x, y, cellW, cellH);
      });
    });

    if (this.missingStates.size > 0) {
      worldText(ctx, `the figure paints no: ${[...this.missingStates].join(', ')}`, {
        x: MARGIN,
        y: height - MARGIN - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.missingState,
        outline: true,
        width: width - MARGIN * 2,
      });
    }
    this.renderChrome(ctx);
  }

  protected previewTitle(): string {
    return 'trash gremlin preview — ?gremlin';
  }

  protected previewCaptions(): readonly string[] {
    return [
      `${BACKDROPS[this.backdropIndex].name}  ·  ${BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex]} px a tile`,
    ];
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
