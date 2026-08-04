/**
 * Localhost-only harness for watching the Evil Clown move, laugh and juggle.
 *
 * Reached via `?evilclown` in `devBootScene`; never on a production path. It
 * exists because stills genuinely cannot answer "does this look right":
 * `scripts/render-clowns.ts --clown=evil` can show that a loop closes and that
 * the vials clear the head, but only playback shows whether a figure three
 * tiles tall reads as heavy rather than floaty, whether the laugh is legible as
 * a telegraph in the time the player actually has, and whether the cascade
 * keeps a steady pattern while the hands work.
 *
 * All three viewpoints play every row simultaneously on a labelled grid, at a
 * chosen zoom and speed, over a backdrop that cycles the real floor palettes so
 * the contrast check happens against the ground he actually stands on. The
 * bottom strip plays the vial's own three sheets, because the bottle, the
 * shatter and the cloud are as much of this creature as its animation is.
 * "kill" fires the real `BodyPartGoreSystem`, which is the only way to check
 * that his pieces tumble in place rather than orbiting.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import {
  EVIL_CLOWN_BODY_PART_KEY,
  drawEvilClownSprite,
  type EvilClownAnimation,
} from '../sprites/evilClownSprite';
import { drawClownGas, drawClownVial, drawClownVialShatter } from '../sprites/clownGasSprite';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type EvilClownState = SpriteStates['evil_clown'];

/** A facing vector per column, chosen so `drawEvilClownSprite` picks each view. */
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

type RowKind = EvilClownAnimation['kind'];

interface RowSpec {
  readonly kind: RowKind;
  /** Which sheet state the profile column plays, for the frame-count lookup. */
  readonly probeState: EvilClownState;
  readonly fps: number;
}

/**
 * The rows to show and how fast to play them. Frame counts are deliberately
 * absent: they are read from the loaded manifest at draw time, because a
 * hand-copied count here would silently desync from the sheet the moment a
 * row's length changed.
 */
const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', probeState: 'walk_side', fps: 10 },
  { kind: 'idle', probeState: 'idle_side', fps: 5 },
  { kind: 'swipe', probeState: 'swipe_side', fps: 12 },
  { kind: 'laugh', probeState: 'laugh', fps: 6 },
  { kind: 'juggle_walk', probeState: 'juggle_walk_side', fps: 10 },
];

/** How many frames a row actually holds, from the sheet the game loaded. */
function frameCountOf(state: EvilClownState): number {
  return getSpriteDefByKey('evil_clown')?.states.get(state)?.frameCount ?? 1;
}

/** 1× is what a player sees; 3× is where the grin becomes legible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 3;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a bounty target actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 3 — grass', color: '#637032' },
  { name: 'floor 3 — road', color: '#8a7c60' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 8;
const LABEL_SIZE = 11;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
/** Gap between the title and the row of controls under it. */
const CONTROL_ROW_GAP = 8;
/** He stands three tiles tall and juggles above that, so cells are generous. */
const OVERHANG_TILES = 4.5;
/** Where a cell's clown stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.94;
const FRAMES_PER_SECOND = 60;

/** Frames the vial strip's shatter and cloud demos run before repeating. */
const SHATTER_DEMO_FRAMES = 22;
const CLOUD_DEMO_FRAMES = 480;
/** Distinct cloud seeds shown side by side, to check they do not billow in step. */
const CLOUD_DEMO_SEEDS = 2;
/** Screen-space lift of the demo bottle, so the lob's offset is visible. */
const VIAL_DEMO_HEIGHT_PX = 24;
/** Tiles between the vial demos, wide enough to clear a full cloud. */
const VIAL_DEMO_GAP_TILES = 4;

/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
/** Impact direction for the preview kill: away from the camera and to the right. */
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

export class EvilClownPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_IN_GAME);
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
   * A row's animation descriptor. The one-shots are driven from the same frame
   * index the loops are, so a paused harness shows one coherent moment across
   * the whole grid rather than each row at its own point in time.
   */
  private animationFor(row: RowSpec): EvilClownAnimation {
    const count = frameCountOf(row.probeState);
    const frame = this.frameOf(row);
    const progress = frame / count;
    switch (row.kind) {
      case 'idle':
        return { kind: 'idle', phaseOffsetSeconds: 0 };
      case 'walk':
        return { kind: 'walk', cycle: progress * Math.PI * 2 };
      case 'juggle_walk':
        return { kind: 'juggle_walk', cycle: progress * Math.PI * 2 };
      case 'swipe':
        return { kind: 'swipe', progress };
      case 'laugh':
        return { kind: 'laugh', progress };
    }
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

    ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      drawText(ctx, row.kind, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      const frame = this.frameOf(row);
      drawText(ctx, `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + 2,
        size: LABEL_SIZE,
        color: '#cfd8c4',
        outline: true,
      });

      const animation = this.animationFor(row);
      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        drawEvilClownSprite(
          ctx,
          x + cell.w / 2 - tile / 2,
          y + cell.h * GROUND_FRACTION - tile,
          tile,
          view.facingX,
          view.facingY,
          animation,
        );
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });

    this.renderVialStrip(ctx, gridTop + ROWS.length * (cell.h + CELL_PADDING), tile);

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
      EVIL_CLOWN_BODY_PART_KEY,
      BASE_TILE_SIZE,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
  }

  /** The bottle, the shatter and the cloud, played at the chosen tile size. */
  private renderVialStrip(ctx: CanvasRenderingContext2D, top: number, tile: number): void {
    const y = top + tile * 2;
    let x = MARGIN + ROW_LABEL_WIDTH + tile * 2;

    drawText(ctx, 'vial', {
      x: MARGIN,
      y: y - LABEL_SIZE,
      size: LABEL_SIZE,
      color: '#f4efe4',
      outline: true,
    });

    drawClownVial(ctx, x, y, tile, this.clock, VIAL_DEMO_HEIGHT_PX);
    x += tile * VIAL_DEMO_GAP_TILES;

    const shatterProgress = (Math.floor(this.clock) % SHATTER_DEMO_FRAMES) / SHATTER_DEMO_FRAMES;
    drawClownVialShatter(ctx, x, y, tile, shatterProgress);
    x += tile * VIAL_DEMO_GAP_TILES;

    for (let seed = 0; seed < CLOUD_DEMO_SEEDS; seed++) {
      drawClownGas(ctx, x, y, tile, Math.floor(this.clock) % CLOUD_DEMO_FRAMES, seed, 1);
      x += tile * VIAL_DEMO_GAP_TILES;
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
    drawText(ctx, 'evil clown preview — ?evilclown', {
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
