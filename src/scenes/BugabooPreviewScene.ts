/**
 * Localhost-only harness for watching a Bugaboo move, swipe and come up through
 * the floor.
 *
 * Reached via `?bugaboo` in `devBootScene`; never on a production path. It
 * exists because two questions about this creature cannot be answered by a
 * still, however large:
 *
 *  - whether it *reads at all* against the floor it stands on. It is obsidian
 *    on near-black concrete, so the backdrop cycles the real floor palettes and
 *    the 1× zoom is the only honest view of it.
 *  - whether the breach loop reads as a hand groping out of a hole in the time
 *    a player actually looks at it, and whether the emerge hands off to the
 *    stance cleanly instead of popping.
 *
 * All four facings play every row at once on a labelled grid. The loops are
 * driven from this scene's own clock rather than the wall clock, or pause, step
 * and speed would do nothing to the rows that matter most.
 */

import { Scene } from '../core/Scene';
import { BUGABOO_ATTACK_FRAMES, BUGABOO_EMERGE_FRAMES } from '../creatures/Bugaboo';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { BUGABOO_BREACH_FPS, BUGABOO_IDLE_FPS, drawBugabooSprite } from '../sprites/bugabooSprite';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type BugabooState = SpriteStates['bugaboo'];

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

type RowKind = 'idle' | 'walk' | 'swipe' | 'breach' | 'emerge';

interface RowSpec {
  readonly kind: RowKind;
  /** Which sheet state the profile column plays, for the frame-count readout. */
  readonly probeState: BugabooState;
  /**
   * How many *game* ticks the row spans, for a row the mob drives from a timer.
   * These are the counts `Bugaboo` itself uses, so the pacing seen here is the
   * pacing the player gets rather than a second guess at it.
   */
  readonly gameFrames?: number;
  /**
   * The playback rate, for a row the *sprite* drives off the wall clock.
   *
   * Its span has to be derived rather than written down: a clock-driven row is
   * as long as its own frame count divided by its own rate, and a hand-tabled
   * tick count silently plays it at the wrong speed. Written down, the breach
   * ran half again too fast — in the one harness that exists to judge whether
   * the breach reads in the time a player looks at it.
   */
  readonly loopFps?: number;
}

/** Close enough to `Mob.walkFrame`'s cadence to judge the gait by. */
const WALK_GAME_FRAMES = 40;
/** The game's own fixed timestep, from `src/core/Scene.ts`. */
const TICKS_PER_SECOND = 60;

const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'idle', probeState: 'idle_side', loopFps: BUGABOO_IDLE_FPS },
  { kind: 'walk', probeState: 'walk_side', gameFrames: WALK_GAME_FRAMES },
  { kind: 'swipe', probeState: 'swipe_side', gameFrames: BUGABOO_ATTACK_FRAMES },
  { kind: 'breach', probeState: 'breach', loopFps: BUGABOO_BREACH_FPS },
  { kind: 'emerge', probeState: 'emerge', gameFrames: BUGABOO_EMERGE_FRAMES },
];

/** How many frames a row actually holds, from the sheet the game loaded. */
function frameCountOf(state: BugabooState): number {
  return getSpriteDefByKey('bugaboo')?.states.get(state)?.frameCount ?? 1;
}

/** How many game ticks one pass of a row takes at the speed the game plays it. */
function tickSpanOf(row: RowSpec): number {
  if (row.loopFps === undefined) return row.gameFrames ?? 1;
  return Math.max(1, Math.round((frameCountOf(row.probeState) * TICKS_PER_SECOND) / row.loopFps));
}

/** 1× is what a player sees; 3× is where the face becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 3;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/**
 * The floor mids a Bugaboo actually stands on, from `scripts/tilegen/palette.ts`.
 * The concrete is the one that matters — it is the defend quest's own floor, and
 * it is the closest in value to the creature.
 */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'floor 2 — unlit concrete', color: '#191720' },
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 88;
const CELL_PADDING = 8;
const LABEL_SIZE = 11;
/** Breathing room under a column heading and beside a row's frame counter. */
const LABEL_GAP = 2;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
/** Cells are wide enough to hold a raised claw, which reaches past the body. */
const CELL_WIDTH_TILES = 3;
const CELL_HEIGHT_TILES = 2.6;
/** Where a cell's creature stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.92;

export class BugabooPreviewScene extends Scene {
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
      return;
    }
    if (!this.paused) this.clock += SPEED_LEVELS[this.speedIndex];
  }

  /** 0–1 through a row's own span in game ticks. */
  private progressOf(row: RowSpec): number {
    const span = tickSpanOf(row);
    return (Math.floor(this.clock) % span) / span;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * CELL_WIDTH_TILES, h: tile * CELL_HEIGHT_TILES };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    this.buttons.length = 0;

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, viewportHeight());

    this.renderHeader(ctx, width);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = HEADER_HEIGHT + MARGIN;
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];

    VIEWS.forEach((view, column) => {
      drawText(ctx, view.label, {
        x: gridLeft + column * (cell.w + CELL_PADDING) + cell.w / 2,
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
      drawText(ctx, `t${progress.toFixed(2)}  ${frameCountOf(row.probeState)}f`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: '#d8d2c4',
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        drawBugabooSprite(
          ctx,
          x + cell.w / 2 - tile / 2,
          y + cell.h * GROUND_FRACTION - tile,
          tile,
          {
            walkFrame: progress * Math.PI * 2,
            isMoving: row.kind === 'walk',
            facingX: view.facingX,
            facingY: view.facingY,
            swipeProgress: row.kind === 'swipe' ? progress : null,
            breaching: row.kind === 'breach',
            emergeProgress: row.kind === 'emerge' ? progress : null,
            // Both clock-driven loops are pulled onto this scene's own clock, so
            // pause, step and speed reach them. Left on the wall clock, the idle
            // and the breach — the two rows this harness exists for — would be
            // the only ones the controls could not touch.
            loopFrame: Math.floor(progress * frameCountOf(row.probeState)),
          },
        );
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });
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
    drawText(ctx, 'bugaboo preview — ?bugaboo', {
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
