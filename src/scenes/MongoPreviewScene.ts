/**
 * Localhost-only harness for watching Mongo move, fight and grow up.
 *
 * Reached via `?mongo` in `devBootScene`; never on a production path. It exists
 * because stills genuinely cannot answer "does this look like an animal":
 * `scripts/render-mongo.ts` can show that a loop closes and a claw arcs, but
 * only playback shows whether the walk has weight, whether the head really holds
 * level while the body bobs, and whether a bite reads as a bite and not as a
 * shrug in the fifth of a second the player actually has to read it.
 *
 * Every row plays in all four facings at once on a labelled grid, at a chosen
 * zoom and speed, over a backdrop that cycles the real floor palettes so the
 * contrast check happens against the ground he actually stands on. The stage
 * switcher is the other half of the point: juvenile, adolescent and adult are
 * three separate sheets, and the thing that has to be true of them is that they
 * look like one animal at three ages.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { drawBox } from '../ui/Box';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import {
  MONGO_TILES_PER_WALK_CYCLE,
  MONGO_WALK_FRAMES,
  MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED,
  drawMongoSprite,
  mongoActionDuration,
  type MongoAction,
  type MongoStage,
} from '../sprites/mongoSprite';
import {
  MONGO_BITE_FRAMES,
  MONGO_BITE_IMPACT_PROGRESS,
  MONGO_POUNCE_FRAMES,
  MONGO_POUNCE_IMPACT_PROGRESS,
  MONGO_SLASH_FRAMES,
  MONGO_SLASH_IMPACT_PROGRESS,
  mongoImpactFrame,
} from '../sprites/mongoAttackTiming';

/** A facing vector per column, chosen so `drawMongoSprite` picks each viewpoint. */
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

type RowKind = 'walk' | 'idle' | MongoAction;

interface RowSpec {
  readonly kind: RowKind;
  /** The frame this row's blow lands on, or null for a loop. */
  readonly impactFrame: number | null;
}

const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', impactFrame: null },
  { kind: 'idle', impactFrame: null },
  { kind: 'bite', impactFrame: mongoImpactFrame(MONGO_BITE_FRAMES, MONGO_BITE_IMPACT_PROGRESS) },
  { kind: 'slash', impactFrame: mongoImpactFrame(MONGO_SLASH_FRAMES, MONGO_SLASH_IMPACT_PROGRESS) },
  {
    kind: 'pounce',
    impactFrame: mongoImpactFrame(MONGO_POUNCE_FRAMES, MONGO_POUNCE_IMPACT_PROGRESS),
  },
  { kind: 'collapse', impactFrame: null },
];

const STAGES: ReadonlyArray<MongoStage> = ['juvenile', 'adolescent', 'adult'];

/** 1× is what a player sees; 4× is where a broken claw becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids he actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'floor 3 — grass', color: '#637032' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 14;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 78;
const CELL_PADDING = 8;
const LABEL_SIZE = 11;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 96;
const BUTTON_GAP = 8;
/** Gap between the title and the row of controls under it. */
const CONTROL_ROW_GAP = 8;
/** An adult raptor is over two tiles long, so cells have to be generous. */
const OVERHANG_TILES = 3;
/** Where a cell's Mongo stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.88;
const CELL_TEXT_INSET = 4;
const FRAMES_PER_SECOND = 60;
/**
 * How fast the walk loop plays, in sprite frames per second.
 *
 * Derived from what the game actually runs him at rather than picked to look
 * nice here: a harness playing a slower gait than the one that ships is a
 * harness that cannot show a cadence bug, and it hid one.
 */
const WALK_FPS = MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED * FRAMES_PER_SECOND;
const IDLE_FPS = 7;
const IDLE_FRAME_COUNT = 8;
const TWO_PI = Math.PI * 2;
/** The stride constant is declared to four decimals, so it is shown to as many. */
const STRIDE_DECIMALS = 4;
const LABEL_BASELINE_GAP = 2;
const CELL_BORDER = 'rgba(255,255,255,0.14)';
const CELL_BORDER_WIDTH = 1;
const IMPACT_BORDER = '#ff8a5c';
const IMPACT_BORDER_INSET = 1;
const IMPACT_BORDER_WIDTH = 2;

export class MongoPreviewScene extends Scene {
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
  private stageIndex = STAGES.length - 1;
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

  private get stage(): MongoStage {
    return STAGES[this.stageIndex];
  }

  /**
   * Where a one-shot is in its playback, driven by the same duration `Mongo`
   * uses — that is what makes the marked impact frame here the frame the
   * creature actually charges damage on.
   */
  private actionElapsed(action: MongoAction): number {
    return Math.floor(this.clock) % mongoActionDuration(action);
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * OVERHANG_TILES, h: tile * OVERHANG_TILES };
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
        y: gridTop - LABEL_SIZE - LABEL_BASELINE_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      this.renderRow(ctx, row, y, gridLeft, cell, tile);
    });
  }

  private renderRow(
    ctx: CanvasRenderingContext2D,
    row: RowSpec,
    y: number,
    gridLeft: number,
    cell: { readonly w: number; readonly h: number },
    tile: number,
  ): void {
    const isLoop = row.kind === 'walk' || row.kind === 'idle';
    const action = isLoop ? null : row.kind;
    const elapsed = action === null ? 0 : this.actionElapsed(action);
    const progress = action === null ? 0 : elapsed / mongoActionDuration(action);
    const loopFps = row.kind === 'walk' ? WALK_FPS : IDLE_FPS;
    const loopCount = row.kind === 'walk' ? MONGO_WALK_FRAMES : IDLE_FRAME_COUNT;
    const loopFrame = Math.floor((this.clock / FRAMES_PER_SECOND) * loopFps) % loopCount;
    const onImpact = row.impactFrame !== null && elapsed === row.impactFrame;

    drawText(ctx, row.kind, {
      x: MARGIN,
      y: y + cell.h / 2 - LABEL_SIZE,
      size: LABEL_SIZE,
      color: '#f4efe4',
      outline: true,
    });
    drawText(ctx, isLoop ? `f${loopFrame}` : `t${progress.toFixed(2)}`, {
      x: MARGIN,
      y: y + cell.h / 2 + LABEL_BASELINE_GAP,
      size: LABEL_SIZE,
      color: '#cfd8c4',
      outline: true,
    });

    VIEWS.forEach((view, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cell.w, cell.h);
      ctx.clip();
      drawMongoSprite(ctx, x + cell.w / 2 - tile / 2, y + cell.h * GROUND_FRACTION - tile, tile, {
        stage: this.stage,
        walkFrame: (loopFrame / loopCount) * TWO_PI,
        isMoving: row.kind === 'walk',
        facingX: view.facingX,
        facingY: view.facingY,
        action,
        actionProgress: progress,
        idleFrame: loopFrame,
      });
      ctx.restore();

      drawBox(ctx, {
        x,
        y,
        width: cell.w,
        height: cell.h,
        border: CELL_BORDER,
        borderWidth: CELL_BORDER_WIDTH,
      });

      // The impact frame is the contract between the art and `Mongo.ts`, so it
      // is marked: stepping to it is how the two get confirmed to agree. Marked
      // on that frame only — painted on every frame of the row the caption stops
      // being a marker, which is the opposite of its job.
      if (!onImpact) return;
      drawBox(ctx, {
        x: x + IMPACT_BORDER_INSET,
        y: y + IMPACT_BORDER_INSET,
        width: cell.w - IMPACT_BORDER_INSET * 2,
        height: cell.h - IMPACT_BORDER_INSET * 2,
        border: IMPACT_BORDER,
        borderWidth: IMPACT_BORDER_WIDTH,
      });
      drawText(ctx, 'impact', {
        x: x + CELL_TEXT_INSET,
        y: y + cell.h - LABEL_SIZE - CELL_TEXT_INSET,
        size: LABEL_SIZE,
        color: '#e8dfc8',
        outline: true,
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
    drawText(ctx, 'mongo preview — ?mongo   (J / A / D switch stage)', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    let x = MARGIN;
    const y = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    x = this.control(ctx, x, y, `stage ${this.stage}`, () => {
      this.stageIndex = (this.stageIndex + 1) % STAGES.length;
    });
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

    drawText(
      ctx,
      `${BACKDROPS[this.backdropIndex].name}   ·   ` +
        `${MONGO_TILES_PER_WALK_CYCLE[this.stage].toFixed(STRIDE_DECIMALS)} tiles per walk cycle`,
      {
        x: width - MARGIN,
        y: MARGIN + TITLE_SIZE,
        size: LABEL_SIZE,
        align: 'right',
        color: '#e6e0d2',
        outline: true,
      },
    );
  }

  handleKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const index = key === 'j' ? 0 : key === 'a' ? 1 : key === 'd' ? 2 : -1;
    if (index >= 0) this.stageIndex = index;
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
