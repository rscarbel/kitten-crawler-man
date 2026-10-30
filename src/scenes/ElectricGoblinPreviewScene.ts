/**
 * Localhost-only harness for watching the Current Goblin's rows play.
 *
 * Reached via `?electric-goblin` in `devBootScene`; never on a production path.
 * Every row plays at once on a wrapping grid at the pace the fight plays it
 * (a tell raises once and then crackles round, a strike or reaction plays
 * through and starts again, death holds its corpse for a beat), over a backdrop
 * that cycles the real floor palettes. The render script answers whether a
 * frame is drawn right; only playback answers whether a tell reads in time.
 */

import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import {
  ELECTRIC_GOBLIN_ROWS,
  ELECTRIC_GOBLIN_ROW_NAMES,
  drawElectricGoblinSprite,
  electricGoblinTellFrame,
  prewarmElectricGoblin,
  type ElectricGoblinRow,
} from '../sprites/electricGoblinSprite';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { previewInk } from '../ui/theme/previewInk';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

/**
 * A gait row is paced by ground covered in the fight; standing still in a
 * preview it plays at this rate instead, close to his walking pace.
 */
const PREVIEW_GAIT_FPS = 10;
/** A tell is shown raising and crackling for this long before it starts again. */
const PREVIEW_TELL_SECONDS = 2;
/** A row that plays once rests on its last frame this long before it replays. */
const REPLAY_HOLD_SECONDS = 0.6;

const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

const FACING_RIGHT = 1;
const FACING_LEFT = -1;

const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 2 — poured concrete', color: previewInk.floor.pouredConcrete },
  { name: 'floor 1 — dressed stone', color: previewInk.floor.dressedStone },
  { name: 'unlit cave', color: previewInk.floor.unlitCave },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;
/** Wide enough for the slam's rods out in front and the generator behind. */
const CELL_WIDTH_TILES = 4;
/** Tall enough for both rods held straight up over his head. */
const CELL_HEIGHT_TILES = 4;
/** Where his boots stand, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.92;

/** The frame `row` shows `clockFrames` game frames into its preview loop. */
function previewFrame(row: ElectricGoblinRow, clockFrames: number): number {
  const spec = ELECTRIC_GOBLIN_ROWS[row];
  const seconds = clockFrames / WORLD_TICKS_PER_SECOND;
  switch (spec.kind) {
    case 'gait':
      return Math.floor(seconds * PREVIEW_GAIT_FPS) % spec.frames;
    case 'loop':
      return Math.floor(seconds * spec.fps) % spec.frames;
    case 'tell': {
      if (row !== 'plunge_tell' && row !== 'slam_tell') return 0;
      const elapsed = Math.floor((seconds % PREVIEW_TELL_SECONDS) * spec.fps);
      return electricGoblinTellFrame(row, elapsed);
    }
    case 'strike':
    case 'reaction':
    case 'final': {
      const playSeconds = spec.frames / spec.fps + REPLAY_HOLD_SECONDS;
      const frame = Math.floor((seconds % playSeconds) * spec.fps);
      return Math.min(spec.frames - 1, frame);
    }
    default: {
      const unhandled: never = spec;
      return unhandled;
    }
  }
}

export class ElectricGoblinPreviewScene extends PreviewScene {
  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_IN_GAME);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private facingX = FACING_RIGHT;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;

  constructor() {
    super();
    prewarmElectricGoblin();
  }

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const cellW = tile * CELL_WIDTH_TILES;
    const cellH = tile * CELL_HEIGHT_TILES;
    const columns = Math.max(1, Math.floor((width - MARGIN * 2) / (cellW + CELL_PADDING)));
    const gridTop = this.headerBottom + MARGIN + LABEL_SIZE;
    const clockFrames = Math.floor(this.clock);

    ELECTRIC_GOBLIN_ROW_NAMES.forEach((row, index) => {
      const x = MARGIN + (index % columns) * (cellW + CELL_PADDING);
      const y = gridTop + Math.floor(index / columns) * (cellH + CELL_PADDING + LABEL_SIZE);
      const frame = previewFrame(row, clockFrames);
      worldText(ctx, `${row}  f${frame}`, {
        x: x + cellW / 2,
        y: y - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: previewInk.grid.caption,
        outline: true,
      });
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();
      drawElectricGoblinSprite(ctx, {
        x: x + cellW / 2 - tile / 2,
        y: y + cellH * GROUND_FRACTION - tile,
        tileSize: tile,
        facingX: this.facingX,
        row,
        frame,
      });
      ctx.restore();
      ctx.strokeStyle = previewInk.grid.cellBorder;
      ctx.strokeRect(x, y, cellW, cellH);
    });

    this.renderChrome(ctx);
  }

  protected previewTitle(): string {
    return 'electric goblin preview — ?electric-goblin';
  }

  protected previewCaptions(): readonly string[] {
    return [BACKDROPS[this.backdropIndex].name];
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
        id: 'facing',
        label: this.facingX > 0 ? 'facing →' : 'facing ←',
        onTap: () => {
          this.facingX = this.facingX > 0 ? FACING_LEFT : FACING_RIGHT;
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
