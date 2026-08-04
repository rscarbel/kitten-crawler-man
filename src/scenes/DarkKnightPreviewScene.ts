/**
 * Localhost-only harness for watching the Dark Knight move and swing.
 *
 * Reached via `?darkknight` in `devBootScene`; never on a production path. It
 * exists because stills genuinely cannot answer "does this look right":
 * `scripts/render-dark-knight.ts` can show that a loop closes and the mace
 * clears the helm, but only playback shows whether a walk in fifty pounds of
 * steel has weight, whether the slam's wind-up reads as a warning in the time
 * the player actually has, and whether the ground circle and the raised mace
 * agree about when the blow lands.
 *
 * All four facings play every row at once on a labelled grid, at a chosen zoom
 * and speed, over a backdrop that cycles the real floor palettes so the
 * contrast check happens against the ground he actually stands on. "kill" fires
 * the real `BodyPartGoreSystem`, which is the only way to check that his plate
 * tumbles in place rather than orbiting.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { drawDangerCircle } from '../sprites/dangerTelegraph';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';
import {
  DARK_KNIGHT_BODY_PART_KEY,
  darkKnightImpactProgress,
  drawDarkKnightSprite,
  type DarkKnightAttack,
} from '../sprites/darkKnightSprite';
// The radii and the fade curve come from the creature rather than being copied:
// this harness exists to answer "does the circle fade up before the mace is
// overhead", and it can only answer that about the schedule the game runs. It
// already refuses to hand-copy frame counts for the same reason.
import {
  SLAM_RADIUS_TILES,
  SWEEP_RADIUS_TILES,
  darkKnightTelegraphFade,
} from '../creatures/DarkKnight';

type DarkKnightState = SpriteStates['dark_knight'];

/** A facing vector per column, chosen so `drawDarkKnightSprite` picks each view. */
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

type RowKind = 'walk' | 'idle' | DarkKnightAttack;

interface RowSpec {
  readonly kind: RowKind;
  /** Which sheet state the profile column plays, for the frame-count lookup. */
  readonly probeState: DarkKnightState;
  readonly fps: number;
}

/**
 * The rows to show and how fast to play them. Frame counts are deliberately
 * absent: they are read from the loaded manifest at draw time, because a
 * hand-copied count here would desync from the sheet the moment a row's length
 * changed.
 */
const ROWS: ReadonlyArray<RowSpec> = [
  { kind: 'walk', probeState: 'walk_side', fps: 10 },
  { kind: 'idle', probeState: 'idle_side', fps: 5 },
  { kind: 'slam', probeState: 'slam_side', fps: 14 },
  { kind: 'sweep', probeState: 'sweep_side', fps: 16 },
  { kind: 'punch', probeState: 'punch_side', fps: 14 },
];

/** The rows that are one-shot attacks rather than loops. */
const ATTACK_KINDS: ReadonlyArray<DarkKnightAttack> = ['slam', 'sweep', 'punch'];

function isAttack(kind: RowKind): kind is DarkKnightAttack {
  return ATTACK_KINDS.some((attack) => attack === kind);
}

/** How many frames a row actually holds, from the sheet the game loaded. */
function frameCountOf(state: DarkKnightState): number {
  return getSpriteDefByKey('dark_knight')?.states.get(state)?.frameCount ?? 1;
}

/** 1× is what a player sees; 4× is where a scored plate seam is visible at all. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a bounty target actually stands on. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 3 — grass', color: '#637032' },
  { name: 'floor 3 — road', color: '#6b5c46' },
  { name: 'floor 1 — cellar stone', color: '#8c8170' },
  { name: 'floor 2 — poured concrete', color: '#888e96' },
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
/** A raised mace reaches well past his own footprint, so cells are generous. */
const OVERHANG_TILES = 3.6;
/** Where a cell's knight stands, as a fraction of the cell's height. */
const GROUND_FRACTION = 0.92;
const CELL_TEXT_INSET = 4;
const FRAMES_PER_SECOND = 60;
/** A one-shot row samples the middle of each frame, not its start. */
const FRAME_MIDPOINT = 0.5;
/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
/** Impact direction for the preview kill: away from the camera and to the right. */
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

export class DarkKnightPreviewScene extends Scene {
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
  private showTelegraph = true;
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

  private progressOf(row: RowSpec): number {
    return this.frameOf(row) / frameCountOf(row.probeState);
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
      const frame = this.frameOf(row);
      const progress = this.progressOf(row);
      drawText(ctx, row.kind, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      drawText(ctx, `f${frame}`, {
        x: MARGIN,
        y: y + cell.h / 2 + 2,
        size: LABEL_SIZE,
        color: '#cfd8c4',
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        const footX = x + cell.w / 2 - tile / 2;
        const footY = y + cell.h * GROUND_FRACTION - tile;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        // The ring is drawn first, under him, exactly as the creature draws it.
        if (this.showTelegraph && isAttack(row.kind) && row.kind !== 'punch') {
          this.renderTelegraph(ctx, row.kind, progress, footX + tile / 2, footY + tile / 2, tile);
        }
        drawDarkKnightSprite(ctx, footX, footY, tile, {
          walkFrame: progress * Math.PI * 2,
          isMoving: row.kind === 'walk',
          facingX: view.facingX,
          facingY: view.facingY,
          attack: isAttack(row.kind) ? row.kind : null,
          attackProgress: isAttack(row.kind) ? progress : null,
        });
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);

        // The impact frame is the contract between the art and `DarkKnight.ts`,
        // so it is marked: stepping to it is how the two get confirmed to agree.
        if (isAttack(row.kind)) {
          const impact = darkKnightImpactProgress(row.kind);
          const step = 1 / frameCountOf(row.probeState);
          if (progress <= impact && progress + step > impact) {
            ctx.strokeStyle = '#ff8a5c';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cell.w - 2, cell.h - 2);
            ctx.lineWidth = 1;
            drawText(ctx, 'impact', {
              x: x + CELL_TEXT_INSET,
              y: y + cell.h - LABEL_SIZE - 2,
              size: LABEL_SIZE,
              color: '#ffd9c0',
              outline: true,
            });
          }
        }
      });
    });

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  /**
   * The same shared ground warning the creature draws, on the same schedule.
   *
   * Playing it here is the only way to see whether the circle has faded up
   * before the mace is overhead — which is what decides whether the attack
   * reads as telegraphed or as a surprise.
   */
  private renderTelegraph(
    ctx: CanvasRenderingContext2D,
    attack: DarkKnightAttack,
    progress: number,
    cx: number,
    cy: number,
    tile: number,
  ): void {
    const impact = darkKnightImpactProgress(attack);
    // Compared at the *middle* of the frame, the way the runtime samples a
    // one-shot. Compared at its start, the ring is still drawn on the frame the
    // game has already stopped drawing it — a one-frame lie in the one harness
    // built to check exactly this.
    const sampled = progress + FRAME_MIDPOINT / frameCountOf(`${attack}_side`);
    if (sampled >= impact) return;
    // The creature ramps the circle over its *wind-up*, which is the part of
    // the row that ends at the impact frame — so row progress is remapped onto
    // that span before the shared curve is asked for an opacity.
    const fade = darkKnightTelegraphFade(sampled / impact);
    if (fade === null) return;
    const radiusTiles = attack === 'slam' ? SLAM_RADIUS_TILES : SWEEP_RADIUS_TILES;
    drawDangerCircle(ctx, cx, cy, tile * radiusTiles, fade);
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
      DARK_KNIGHT_BODY_PART_KEY,
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
    drawText(ctx, 'dark knight preview — ?darkknight', {
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
    x = this.control(ctx, x, y, this.showTelegraph ? 'ring on' : 'ring off', () => {
      this.showTelegraph = !this.showTelegraph;
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
