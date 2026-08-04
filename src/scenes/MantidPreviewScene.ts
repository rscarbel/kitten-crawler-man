/**
 * Localhost-only harness for watching the Mantid and his cronies move.
 *
 * Reached via `?mantid` in `devBootScene`; never on a production path. It exists
 * because stills cannot answer "does this look right in motion":
 * `scripts/render-mantid.ts` can show that a loop closes and that the prayer
 * folds, but only playback shows whether the idle sway reads as an animal
 * rocking rather than as a jitter, whether the one-second rage pause is
 * distinguishable from the idle at a glance, and whether the flurry looks like
 * something a player should run from.
 *
 * Both builds play every row side by side over a backdrop that cycles the real
 * floor-3 palettes, so the "is the boss visibly a different animal from his
 * escort" check happens against the ground they both stand on. "kill" fires the
 * real `BodyPartGoreSystem`, which is the only way to check that the pieces
 * tumble in place rather than orbiting.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { getSpriteDefByKey } from '../core/SpriteLoader';
import { MANTID_SLASH_TOTAL_FRAMES } from '../creatures/Mantid';
import { MANTIS_SLASH_TOTAL_FRAMES } from '../creatures/MantisCrony';
import {
  MANTID_BODY_PART_KEY,
  MANTIS_BODY_PART_KEY,
  drawMantidSprite,
  type MantidAction,
  type MantidSheet,
} from '../sprites/mantidSprite';

/** A facing vector per column, chosen so `drawMantidSprite` picks each viewpoint. */
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

interface RowSpec {
  readonly action: MantidAction;
  /** Which sheet state the profile column plays, for the frame-count lookup. */
  readonly probeState: string;
  readonly fps: number;
  /** Rows only the boss's sheet has; hidden entirely when the crony is showing. */
  readonly bossOnly: boolean;
}

const ROWS: ReadonlyArray<RowSpec> = [
  { action: 'walk', probeState: 'walk_side', fps: 10, bossOnly: false },
  { action: 'idle', probeState: 'idle_side', fps: 6, bossOnly: false },
  { action: 'slash', probeState: 'slash_side', fps: 14, bossOnly: false },
  { action: 'flurry', probeState: 'flurry_side', fps: 14, bossOnly: true },
  { action: 'rage_pause', probeState: 'rage_pause', fps: 6, bossOnly: true },
];

const SHEETS: ReadonlyArray<MantidSheet> = ['mantid', 'mantis'];

/** How many frames a row actually holds, from the sheet the game loaded. */
function frameCountOf(sheet: MantidSheet, state: string): number {
  return getSpriteDefByKey(sheet)?.states.get(state)?.frameCount ?? 1;
}

/** 1× is what a player sees; 3× is where a femoral spine becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 3;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor-3 grounds a mantis actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 3 — grass', color: '#637032' },
  { name: 'floor 3 — dirt road', color: '#7a6244' },
  { name: 'floor 3 — rubble', color: '#6f6a5e' },
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 8;
const LABEL_SIZE = 11;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 96;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
/** The boss overhangs his tile by well over a tile in every direction. */
const OVERHANG_TILES = 3.5;
/** Where a cell's mantis stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.94;
const FRAMES_PER_SECOND = 60;
const TWO_PI = Math.PI * 2;

/**
 * Frames a slash one-shot runs before it repeats — taken from the creatures
 * themselves, because the boss winds up for longer than the crony does and the
 * whole point of this harness is judging the strike at the tempo it plays at.
 */
const SLASH_DEMO_FRAMES: Readonly<Record<MantidSheet, number>> = {
  mantid: MANTID_SLASH_TOTAL_FRAMES,
  mantis: MANTIS_SLASH_TOTAL_FRAMES,
};

/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
/** Impact direction for the preview kill: away from the camera and to the right. */
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

export class MantidPreviewScene extends Scene {
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
  private sheetIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;

  private get sheet(): MantidSheet {
    return SHEETS[this.sheetIndex];
  }

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
    this.gore.update();
  }

  private frameOf(row: RowSpec): number {
    const elapsedSeconds = this.clock / FRAMES_PER_SECOND;
    return Math.floor(elapsedSeconds * row.fps) % frameCountOf(this.sheet, row.probeState);
  }

  /** The slash is a one-shot rather than a loop, so it runs off its own countdown. */
  private slashProgress(): number {
    const frames = SLASH_DEMO_FRAMES[this.sheet];
    return (Math.floor(this.clock) % frames) / frames;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * OVERHANG_TILES, h: tile * OVERHANG_TILES };
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
    const slash = this.slashProgress();

    VIEWS.forEach((view, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      drawText(ctx, view.label, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - 2,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    const rows = ROWS.filter((row) => this.sheet === 'mantid' || !row.bossOnly);
    rows.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const frame = this.frameOf(row);
      drawText(ctx, row.action, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      drawText(ctx, row.action === 'slash' ? `t${slash.toFixed(2)}` : `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + 2,
        size: LABEL_SIZE,
        color: '#e4e8d4',
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        drawMantidSprite(
          ctx,
          this.sheet,
          x + cell.w / 2 - tile / 2,
          y + cell.h * GROUND_FRACTION - tile,
          tile,
          {
            walkFrame: (frame / frameCountOf(this.sheet, row.probeState)) * TWO_PI,
            isMoving: row.action === 'walk',
            facingX: view.facingX,
            facingY: view.facingY,
            slashProgress: row.action === 'slash' ? slash : null,
            isFlurrying: row.action === 'flurry',
            isRaging: row.action === 'rage_pause',
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
   * Fire the real gore system at the middle of the screen.
   *
   * Deliberately the real one rather than a mock: the question this answers is
   * whether a piece tumbles about its own centre or orbits it, and only the
   * runtime's own `drawSpriteRotatedCenter` path can answer that.
   */
  private kill(): void {
    this.gore.spawnParts(
      viewportWidth() / 2,
      viewportHeight() / 2,
      this.sheet === 'mantid' ? MANTID_BODY_PART_KEY : MANTIS_BODY_PART_KEY,
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
    drawText(ctx, 'mantid preview — ?mantid', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    let x = MARGIN;
    const y = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    x = this.control(ctx, x, y, this.sheet, () => {
      this.sheetIndex = (this.sheetIndex + 1) % SHEETS.length;
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
