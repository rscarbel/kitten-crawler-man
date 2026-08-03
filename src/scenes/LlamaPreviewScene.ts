/**
 * Localhost-only harness for watching the llama move and spit.
 *
 * Reached via `?llama` in `devBootScene`; never on a production path. It exists
 * because stills genuinely cannot answer "does this look smooth":
 * `scripts/render-llama.ts` can show that a loop closes and the neck reaches,
 * but only playback shows whether the pace has weight, whether the charge
 * climbing the throat reads as a warning in the time the player actually has,
 * and whether the ball leaves the mouth on the frame the neck whips.
 *
 * All three viewpoints play every row simultaneously on a labelled grid, at a
 * chosen zoom and speed, over a backdrop that cycles the real floor palettes so
 * the contrast check happens against the thing the llama actually stands on.
 * The bottom strip plays the projectile's own three sheets, because the bolt,
 * the burst and the fire patch are as much of this creature as its animation is.
 * "kill" fires the real `BodyPartGoreSystem`, which is the only way to check
 * that pieces tumble in place rather than orbiting.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { LLAMA_BODY_PART_KEY, drawLlamaSprite } from '../sprites/llamaSprite';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { LLAMA_SPIT_FRAMES, llamaSpitReleaseFrame } from '../sprites/llamaSpitTiming';
import { drawLavaBolt, drawLavaBurst, drawLavaFlame } from '../sprites/lavaBallSprite';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type LlamaState = SpriteStates['llama'];

/** A facing vector per column, chosen so `drawLlamaSprite` picks each viewpoint. */
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

type RowKind = 'walk' | 'idle' | 'spit';

interface RowSpec {
  readonly kind: RowKind;
  /** Which sheet state the profile column plays, for the frame-count lookup. */
  readonly probeState: LlamaState;
  readonly fps: number;
}

/**
 * The rows to show and how fast to play them. Frame counts are deliberately
 * absent: they are read from the loaded manifest at draw time, because a
 * hand-copied count here would silently desync from the sheet the moment a
 * row's length changed.
 */
const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', probeState: 'walk_side', fps: 12 },
  { kind: 'idle', probeState: 'idle_side', fps: 6 },
  { kind: 'spit', probeState: 'spit_side', fps: 14 },
];

/** How many frames a row actually holds, from the sheet the game loaded. */
function frameCountOf(state: LlamaState): number {
  const def = getSpriteDefByKey('llama');
  return def?.states.get(state)?.frameCount ?? 1;
}

/** 1× is what a player sees; 4× is where a split lip becomes visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a llama actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 1 — dressed stone', color: '#b09668' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'floor 3 — grass', color: '#637032' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
/** Gap between the title and the row of controls under it. */
const CONTROL_ROW_GAP = 8;
/** A llama's neck reaches well past its own footprint, so cells are generous. */
const OVERHANG_TILES = 3.5;
/** Where a cell's llama stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.9;
const CELL_TEXT_INSET = 4;
const FRAMES_PER_SECOND = 60;

/** Frames the projectile strip's burst and flame demos run before repeating. */
const BURST_DEMO_FRAMES = 26;
const FLAME_DEMO_FRAMES = 330;
/** Distinct patch seeds shown side by side, to check they do not animate in step. */
const FLAME_DEMO_SEEDS = 2;
/** The heading the demo bolt travels at — off-axis, so the rotation is visible. */
const BOLT_DEMO_HEADING = 0.35;
/** Tiles between the projectile demos, wide enough to clear a full burst. */
const PROJECTILE_DEMO_GAP_TILES = 3;
/** Fire patches are narrower than a burst, so they sit closer together. */
const FLAME_DEMO_GAP_TILES = 2;
/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
/** Impact direction for the preview kill: away from the camera and to the right. */
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

export class LlamaPreviewScene extends Scene {
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

  /** Which frame of a row is showing right now, at the chosen playback speed. */
  private frameOf(row: RowSpec): number {
    const elapsedSeconds = this.clock / FRAMES_PER_SECOND;
    return Math.floor(elapsedSeconds * row.fps) % frameCountOf(row.probeState);
  }

  /**
   * The spit is a one-shot rather than a loop, so it is driven by the same
   * countdown `Llama` uses — that is what makes the marked release frame here
   * the frame the creature actually launches a ball.
   */
  private spitProgress(): number {
    const elapsed = Math.floor(this.clock) % LLAMA_SPIT_FRAMES;
    return elapsed / LLAMA_SPIT_FRAMES;
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
    const spit = this.spitProgress();
    // Derived, not re-rounded from the fraction: the harness's whole job is to
    // confirm the frame the game fires on, and computing it a second way was
    // marking a frame one earlier than `Llama` actually uses.
    const onReleaseFrame = Math.floor(this.clock) % LLAMA_SPIT_FRAMES === llamaSpitReleaseFrame();

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
      drawText(ctx, row.kind === 'spit' ? `t${spit.toFixed(2)}` : `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + 2,
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
        drawLlamaSprite(ctx, x + cell.w / 2 - tile / 2, y + cell.h * GROUND_FRACTION - tile, tile, {
          walkFrame: (frame / frameCountOf(row.probeState)) * Math.PI * 2,
          isMoving: row.kind === 'walk',
          facingX: view.facingX,
          facingY: view.facingY,
          spitProgress: row.kind === 'spit' ? spit : null,
        });
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);

        // The release frame is the contract between the art and `Llama.ts`, so
        // it is marked: stepping to it is how the two get confirmed to agree.
        if (row.kind === 'spit') {
          if (onReleaseFrame) {
            ctx.strokeStyle = '#ff8a5c';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cell.w - 2, cell.h - 2);
            ctx.lineWidth = 1;
          }
          drawText(ctx, 'release', {
            x: x + CELL_TEXT_INSET,
            y: y + cell.h - LABEL_SIZE - 2,
            size: LABEL_SIZE,
            color: '#e8dfc8',
            outline: true,
          });
        }
      });
    });

    this.renderProjectileStrip(ctx, gridTop + ROWS.length * (cell.h + CELL_PADDING), tile);

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
      LLAMA_BODY_PART_KEY,
      BASE_TILE_SIZE,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
  }

  /** The bolt, the burst and the fire patch, played at the chosen tile size. */
  private renderProjectileStrip(ctx: CanvasRenderingContext2D, top: number, tile: number): void {
    const y = top + tile;
    let x = MARGIN + ROW_LABEL_WIDTH + tile;

    drawText(ctx, 'projectile', {
      x: MARGIN,
      y: y - LABEL_SIZE,
      size: LABEL_SIZE,
      color: '#f4efe4',
      outline: true,
    });

    drawLavaBolt(ctx, x, y, tile, BOLT_DEMO_HEADING, this.clock);
    x += tile * PROJECTILE_DEMO_GAP_TILES;

    const burstProgress = (Math.floor(this.clock) % BURST_DEMO_FRAMES) / BURST_DEMO_FRAMES;
    drawLavaBurst(ctx, x, y, tile, burstProgress);
    x += tile * PROJECTILE_DEMO_GAP_TILES;

    for (let seed = 0; seed < FLAME_DEMO_SEEDS; seed++) {
      drawLavaFlame(ctx, x, y, tile, Math.floor(this.clock) % FLAME_DEMO_FRAMES, seed, 1);
      x += tile * FLAME_DEMO_GAP_TILES;
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
    drawText(ctx, 'llama preview — ?llama', {
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
