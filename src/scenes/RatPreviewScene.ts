/**
 * Localhost-only harness for watching the rat move.
 *
 * Reached via `?rat` in `devBootScene` (see `game.ts`); never on a production
 * path. It exists because stills genuinely cannot answer "does this look
 * smooth": `scripts/render-rat.ts` can show that a loop closes and a wound is
 * legible, but only playback shows whether the scurry has weight and whether the
 * bite's snap lands where the damage does.
 *
 * All three viewpoints play every row simultaneously on a labelled grid, at a
 * chosen zoom and speed, over a backdrop that cycles the real floor palettes so
 * the contrast check happens against the thing the rat actually stands on.
 * "kill" fires the real `BodyPartGoreSystem`, which is the only way to check
 * that pieces tumble in place rather than orbiting.
 */

import { viewportWidth, viewportHeight } from '../core/Viewport';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import {
  RAT_BITE_FRAMES,
  RAT_BITE_IMPACT_PROGRESS,
  RAT_BODY_PART_KEY,
  type RatState,
  drawRatSprite,
} from '../sprites/ratSprite';
import { RAT_FIGURE } from '../sprites/art/ratFigure';
import { figureFrameCount } from '../sprites/figure/figureDef';
import { previewInk } from '../ui/theme/previewInk';

/** A facing vector per column, chosen so `drawRatSprite` picks each viewpoint. */
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

type RowKind = 'walk' | 'idle' | 'bite';

interface RowSpec {
  readonly kind: RowKind;
  /** Which sheet state the profile column plays, for the frame-count lookup. */
  readonly probeState: RatState;
  readonly fps: number;
}

/**
 * The rows to show and how fast to play them. Frame counts are deliberately
 * absent: they are read from the figure at draw time, because a hand-copied
 * count here would silently desync from the art the moment a row's length
 * changed.
 */
const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', probeState: 'walk_side', fps: 14 },
  { kind: 'idle', probeState: 'idle_side', fps: 7 },
  { kind: 'bite', probeState: 'bite_side', fps: 14 },
];

/** How many frames a row actually holds, straight off the figure that paints it. */
function frameCountOf(state: RatState): number {
  return figureFrameCount(RAT_FIGURE, state);
}

/** 1× is what a player sees; 4× is where an incisor becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a rat actually stands on, from `src/map/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: previewInk.floor.cellarStone },
  { name: 'floor 1 — dressed stone', color: previewInk.floor.dressedStone },
  { name: 'floor 2 — poured concrete', color: previewInk.floor.pouredConcrete },
  { name: 'floor 3 — grass', color: previewInk.floor.grass },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
/** Space between a label and the cell edge it captions. */
const LABEL_GAP = 2;
/** Width of the outline marking a cell on its bite's impact frame. */
const IMPACT_OUTLINE_WIDTH = 2;
/** A rat's tail reaches well past its own footprint, so cells are generous. */
const OVERHANG_TILES = 3;
/** Where a cell's rat stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.82;
const CELL_TEXT_INSET = 4;
const FRAMES_PER_SECOND = 60;
/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
/** Impact direction for the preview kill: away from the camera and to the right. */
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

export class RatPreviewScene extends PreviewScene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);

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

  /** Which frame of a row is showing right now, at the chosen playback speed. */
  private frameOf(row: RowSpec): number {
    const elapsedSeconds = this.clock / FRAMES_PER_SECOND;
    return Math.floor(elapsedSeconds * row.fps) % frameCountOf(row.probeState);
  }

  /**
   * The bite is a one-shot rather than a loop, so it is driven by the same
   * countdown `Rat` uses — that is what makes the marked impact frame here the
   * frame the creature actually deals damage on.
   */
  private biteProgress(): number {
    const elapsed = Math.floor(this.clock) % RAT_BITE_FRAMES;
    return elapsed / RAT_BITE_FRAMES;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * OVERHANG_TILES, h: tile * OVERHANG_TILES };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = this.headerBottom + MARGIN + LABEL_SIZE;
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const bite = this.biteProgress();
    const impactFrame = Math.floor(RAT_BITE_IMPACT_PROGRESS * RAT_BITE_FRAMES);
    const onImpactFrame = Math.floor(this.clock) % RAT_BITE_FRAMES === impactFrame;

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
      worldText(ctx, row.kind, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.caption,
        outline: true,
      });
      const frame = this.frameOf(row);
      worldText(ctx, row.kind === 'bite' ? `t${bite.toFixed(2)}` : `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: previewInk.grid.frameCounter,
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        drawRatSprite(ctx, x + cell.w / 2 - tile / 2, y + cell.h * GROUND_FRACTION - tile, tile, {
          walkFrame: (frame / frameCountOf(row.probeState)) * Math.PI * 2,
          isMoving: row.kind === 'walk',
          facingX: view.facingX,
          facingY: view.facingY,
          biteProgress: row.kind === 'bite' ? bite : null,
        });
        ctx.restore();

        ctx.strokeStyle = previewInk.grid.cellBorder;
        ctx.strokeRect(x, y, cell.w, cell.h);

        // The impact frame is the contract between the art and `Rat.ts`, so it
        // is marked: stepping to it is how the two get confirmed to agree.
        if (row.kind === 'bite') {
          if (onImpactFrame) {
            ctx.strokeStyle = previewInk.grid.impactFrame;
            ctx.lineWidth = IMPACT_OUTLINE_WIDTH;
            const outlineInset = IMPACT_OUTLINE_WIDTH / 2;
            ctx.strokeRect(
              x + outlineInset,
              y + outlineInset,
              cell.w - IMPACT_OUTLINE_WIDTH,
              cell.h - IMPACT_OUTLINE_WIDTH,
            );
            ctx.lineWidth = 1;
          }
          worldText(ctx, 'snap', {
            x: x + CELL_TEXT_INSET,
            y: y + cell.h - LABEL_SIZE - LABEL_GAP,
            size: LABEL_SIZE,
            color: previewInk.grid.moveName,
            outline: true,
          });
        }
      });
    });

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
    this.renderChrome(ctx);
  }

  protected previewTitle(): string {
    return 'rat preview — ?rat';
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
      {
        label: 'kill',
        onTap: () => {
          this.kill();
        },
      },
    ];
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
      RAT_BODY_PART_KEY,
      BASE_TILE_SIZE,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
  }
}
