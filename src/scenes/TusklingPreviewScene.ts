/**
 * Localhost-only harness for watching a Tuskling move, hook, snort and charge.
 *
 * Reached via `?tuskling` in `devBootScene`; never on a production path. It
 * exists because a still cannot answer the questions that matter here:
 * `scripts/render-tuskling.ts` shows that the walk loop closes and the tusks
 * clear the snout, but only playback shows whether the thirty-five-frame
 * wind-up reads as a warning in the time the player has to get out of the way,
 * and whether the sprint's shorter frame hold reads as speed or as strobing.
 *
 * All four facings play every row at once on a labelled grid, over a backdrop
 * that cycles the real floor palettes so the contrast check happens against the
 * thing the creature actually stands on. "kill" fires the real
 * `BodyPartGoreSystem`, which is the only way to see whether the pieces tumble
 * about their own centres rather than orbiting them.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { TUSKLING_BODY_PART_KEY, drawTusklingSprite } from '../sprites/tusklingSprite';
import {
  TUSKLING_CHARGE_FRAMES,
  TUSKLING_CHARGE_FRAME_HOLD,
  TUSKLING_HOOK_FRAMES,
  TUSKLING_IDLE_FRAMES,
  TUSKLING_WINDUP_GAME_FRAMES,
  tusklingActionFrames,
} from '../sprites/tusklingAttackTiming';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';

/** A facing vector per column, chosen so the wrapper picks each viewpoint. */
interface ViewSpec {
  readonly label: string;
  readonly facingX: number;
  readonly facingY: number;
}

const VIEWS: ReadonlyArray<ViewSpec> = [
  { label: 'side →', facingX: 1, facingY: 0 },
  { label: 'side ←', facingX: -1, facingY: 0 },
  { label: 'toward', facingX: 0, facingY: 1 },
  { label: 'away', facingX: 0, facingY: -1 },
];

type RowKind = 'idle' | 'walk' | 'hook' | 'snort' | 'charge';

interface RowSpec {
  readonly kind: RowKind;
  /**
   * How many *game* frames the row spans. The attacks use the same counts
   * `Tuskling` drives them with, so the pacing seen here is the pacing the
   * player gets rather than a second guess at it.
   */
  readonly gameFrames: number;
}

const IDLE_GAME_FRAMES = 60;
const WALK_GAME_FRAMES = 44;
const CHARGE_GAME_FRAMES = TUSKLING_CHARGE_FRAMES * TUSKLING_CHARGE_FRAME_HOLD;

const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'idle', gameFrames: IDLE_GAME_FRAMES },
  { kind: 'walk', gameFrames: WALK_GAME_FRAMES },
  { kind: 'hook', gameFrames: tusklingActionFrames(TUSKLING_HOOK_FRAMES) },
  { kind: 'snort', gameFrames: TUSKLING_WINDUP_GAME_FRAMES },
  { kind: 'charge', gameFrames: CHARGE_GAME_FRAMES },
];

/** 1× is what a player sees; 4× is where a tusk becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a Tuskling actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'floor 3 — grass', color: '#637032' },
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
const CELL_WIDTH_TILES = 2.6;
const CELL_HEIGHT_TILES = 2.2;
/** Where a cell's creature stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.92;

/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

const TAU = Math.PI * 2;

export class TusklingPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);
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

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
    this.gore.update();
  }

  /** 0–1 through a row's own game-frame span. */
  private progressOf(row: RowSpec): number {
    return (Math.floor(this.clock) % row.gameFrames) / row.gameFrames;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * CELL_WIDTH_TILES, h: tile * CELL_HEIGHT_TILES };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.buttons.length = 0;

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
      drawText(ctx, row.kind, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      drawText(ctx, `t${progress.toFixed(2)}  ${row.gameFrames}gf`, {
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
        drawTusklingSprite(
          ctx,
          x + cell.w / 2 - tile / 2,
          y + cell.h * GROUND_FRACTION - tile,
          tile,
          {
            walkFrame: progress * TAU,
            isMoving: row.kind === 'walk',
            facingX: view.facingX,
            facingY: view.facingY,
            hookProgress: row.kind === 'hook' ? progress : null,
            snortProgress: row.kind === 'snort' ? progress : null,
            chargeFrame:
              row.kind === 'charge' ? Math.floor(progress * TUSKLING_CHARGE_FRAMES) : null,
            // Driven from this scene's own clock rather than the wall clock, or
            // the one row that plays most would ignore pause, step and speed —
            // which is the whole reason this harness exists.
            idleFrame:
              row.kind === 'idle' ? Math.floor(progress * TUSKLING_IDLE_FRAMES) : undefined,
          },
        );
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  /**
   * Fire the real gore system at the middle of the screen. Deliberately the
   * real one: only the runtime's own rotate-about-measured-ink-centre path can
   * answer whether a severed tusk spins about itself or orbits a point beside
   * it.
   */
  private kill(): void {
    this.gore.spawnParts(
      viewportWidth() / 2,
      viewportHeight() / 2,
      TUSKLING_BODY_PART_KEY,
      BASE_TILE_SIZE,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
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
    drawText(ctx, 'tuskling preview — ?tuskling', {
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
    x = this.control(ctx, x, y, 'backdrop', () => {
      this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
    });
    this.control(ctx, x, y, 'kill', () => {
      this.kill();
    });

    drawText(ctx, BACKDROPS[this.backdropIndex].name, {
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
