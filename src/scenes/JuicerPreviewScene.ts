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
 * The sheet is addressed by state name at run time rather than through
 * `drawSpriteKey`'s typed state union, because the manifest entry is pasted
 * only after the art has passed its image review: until then the new rows do
 * not exist as types, and this harness says so on screen rather than failing to
 * compile.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { getSpriteDefByKey } from '../core/SpriteLoader';
import { drawSprite } from '../core/SpriteRenderer';
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

const SPRITE_KEY = 'juicer';

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

/** The floor mids the Juicer actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'gym mat', color: '#3a3f46' },
  { name: 'unlit cave', color: '#2a2f2b' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
const CELL_WIDTH_TILES = 3;
const CELL_HEIGHT_TILES = 2.9;
/** Where a cell's creature stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.94;
const MISSING_STATE_COLOR = '#ff9a76';

export class JuicerPreviewScene extends Scene {
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

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
   * Draws one cell, or records the state name when the sheet has no such row.
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
    const def = getSpriteDefByKey(SPRITE_KEY);
    if (def === undefined) {
      this.missingStates.add(`${SPRITE_KEY} (sheet not loaded)`);
      return;
    }
    const stateDef = def.states.get(state);
    if (stateDef === undefined) {
      this.missingStates.add(state);
      return;
    }
    drawSprite(ctx, def, stateDef, frame, x, y, tile, { flipX });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.buttons.length = 0;
    this.missingStates.clear();

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    this.renderHeader(ctx, width);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = HEADER_HEIGHT + MARGIN;
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];

    VIEWS.forEach((view, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      drawText(ctx, view.label, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const progress = this.progressOf(row);
      const frame = Math.min(row.frameCount - 1, Math.floor(progress * row.frameCount));
      drawText(ctx, row.base, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      drawText(ctx, `f${frame}  ${row.gameFrames}gf`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: '#e8dcd4',
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

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });

    if (this.missingStates.size > 0) {
      drawText(ctx, `manifest is missing: ${[...this.missingStates].join(', ')}`, {
        x: MARGIN,
        y: height - MARGIN - LABEL_SIZE,
        size: LABEL_SIZE,
        color: MISSING_STATE_COLOR,
        outline: true,
        width: width - MARGIN * 2,
      });
    }
  }

  private control(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    action: () => void,
  ): number {
    addButton(ctx, this.buttons, {
      ...BUTTON_PRESETS.toggle,
      x,
      y,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      label,
      action,
    });
    return x + BUTTON_WIDTH + BUTTON_GAP;
  }

  private renderHeader(ctx: CanvasRenderingContext2D, width: number): void {
    drawText(ctx, 'juicer preview — ?juicer', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    let x = MARGIN;
    const y = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    x = this.control(ctx, x, y, `zoom ${ZOOM_LEVELS[this.zoomIndex]}x`, () => {
      this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
    });
    x = this.control(ctx, x, y, this.paused ? 'play' : 'pause', () => {
      this.paused = !this.paused;
    });
    x = this.control(ctx, x, y, 'step', () => {
      this.paused = true;
      this.stepRequested = true;
    });
    x = this.control(ctx, x, y, `speed ${SPEED_LEVELS[this.speedIndex]}x`, () => {
      this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
    });
    this.control(ctx, x, y, 'backdrop', () => {
      this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
    });

    drawText(ctx, `${BACKDROPS[this.backdropIndex].name}  ·  hold ${JUICER_FRAME_HOLD}gf/frame`, {
      x: width - MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: LABEL_SIZE,
      align: 'right',
      color: '#e6e0d2',
      outline: true,
    });
  }

  handleMouseMove(mx: number, my: number): void {
    setButtonMouseState(mx, my);
  }

  handleClick(mx: number, my: number): void {
    for (const button of this.buttons) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (!inside) continue;
      // This scene has no `AudioManager` of its own; the call is here so the
      // control path matches every other button in the game rather than quietly
      // diverging from it.
      playButtonSound(null);
      button.action?.();
      return;
    }
  }
}
