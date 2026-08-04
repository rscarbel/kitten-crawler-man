/**
 * Localhost-only harness for watching the rock golems move and fight.
 *
 * Reached via `?golem` in `devBootScene`; never on a production path. It exists
 * because stills genuinely cannot answer "does this look like rock":
 * `scripts/render-rock-golem.ts` proves that a loop closes and that the seams
 * are there, but only playback shows whether the walk lands its weight, whether
 * the boulder pick-up reads as a warning in the time the player actually has,
 * and whether the boss's plates close over him or merely fade in.
 *
 * Both sheets play every row side by side on a labelled grid, over a backdrop
 * that can be swapped for the dark and light ground the golem stands on. "kill"
 * fires the real `BodyPartGoreSystem`, which is the only way to check that the
 * rubble tumbles about its own centre rather than orbiting it.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';
import { drawGolemRock, drawGolemRockBurst } from '../sprites/golemRockSprite';
import {
  ROCK_GOLEM_BODY_PART_KEY,
  ROCK_GOLEM_BOSS_BODY_PART_KEY,
  drawRockGolemSprite,
  type GolemAttack,
  type GolemBallState,
  type RockGolemSheet,
} from '../sprites/rockGolemSprite';

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

interface RowSpec {
  readonly label: string;
  readonly attack: GolemAttack | null;
  readonly ballState: GolemBallState | null;
  readonly moving: boolean;
  /** How fast this row plays, in sheet frames per second. */
  readonly fps: number;
  /** Boss-only rows are skipped for the plain golem. */
  readonly bossOnly: boolean;
}

const ROWS: ReadonlyArray<RowSpec> = [
  { label: 'walk', attack: null, ballState: null, moving: true, fps: 10, bossOnly: false },
  { label: 'idle', attack: null, ballState: null, moving: false, fps: 5, bossOnly: false },
  { label: 'slam', attack: 'slam', ballState: null, moving: false, fps: 15, bossOnly: false },
  { label: 'stomp', attack: 'stomp', ballState: null, moving: false, fps: 15, bossOnly: false },
  { label: 'throw', attack: 'throw', ballState: null, moving: false, fps: 15, bossOnly: false },
  { label: 'curl', attack: null, ballState: 'curl', moving: false, fps: 12, bossOnly: true },
  { label: 'roll', attack: null, ballState: 'roll', moving: false, fps: 18, bossOnly: true },
  { label: 'uncurl', attack: null, ballState: 'uncurl', moving: false, fps: 12, bossOnly: true },
  { label: 'stunned', attack: null, ballState: 'stunned', moving: false, fps: 8, bossOnly: true },
];

interface VariantSpec {
  readonly sheet: RockGolemSheet;
  readonly label: string;
  readonly bodyPartKey: string;
}

const VARIANTS: ReadonlyArray<VariantSpec> = [
  { sheet: 'rock_golem', label: 'rock_golem', bodyPartKey: ROCK_GOLEM_BODY_PART_KEY },
  {
    sheet: 'rock_golem_boss',
    label: 'rock_golem_boss',
    bodyPartKey: ROCK_GOLEM_BOSS_BODY_PART_KEY,
  },
];

const BASE_TILE_SIZE = 32;
/** 1× is what a player sees; the review zoom is where a seam becomes visible. */
const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];
const DEFAULT_ZOOM_INDEX = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];
const FRAMES_PER_SECOND = 60;

/** The floors a golem is actually seen against, darkest first. */
const BACKDROPS: ReadonlyArray<string> = ['#2b2b30', '#4a4034', '#6f7a5c', '#8d8477'];

const MARGIN = 16;
const ROW_LABEL_WIDTH = 78;
const CELL_PADDING = 6;
const LABEL_SIZE = 12;
const HEADER_HEIGHT = 46;
/** Cells are three tiles tall so the boss's overhead slam raise fits. */
const CELL_TILES_TALL = 3;
const CELL_TILES_WIDE = 2.6;

const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;

/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
/** Impact direction for the preview kill: away from the camera and to the right. */
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

/** Frames the thrown-rock demo takes to cross its lane, then shatter. */
const ROCK_DEMO_FLIGHT_FRAMES = 90;
const ROCK_DEMO_BURST_FRAMES = 22;
const ROCK_DEMO_LANE_TILES = 6;

export class RockGolemPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

  private zoomIndex = DEFAULT_ZOOM_INDEX;
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private variantIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;

  update(): void {
    if (!this.paused) this.clock += SPEED_LEVELS[this.speedIndex];
    this.gore.update();
  }

  private get variant(): VariantSpec {
    return VARIANTS[this.variantIndex];
  }

  private tileSize(): number {
    return BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
  }

  /** 0 → 1 through a one-shot row at the chosen playback speed. */
  private progressOf(row: RowSpec): number {
    const cycleFrames = (FRAMES_PER_SECOND / row.fps) * ROW_CYCLE_FRAMES;
    return (this.clock % cycleFrames) / cycleFrames;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BACKDROPS[this.backdropIndex];
    ctx.fillRect(0, 0, width, height);

    this.buttons.length = 0;
    this.renderControls(ctx);

    const tile = this.tileSize();
    const cellW = tile * CELL_TILES_WIDE;
    const cellH = tile * CELL_TILES_TALL;
    const rows = ROWS.filter((row) => !row.bossOnly || this.variant.sheet === 'rock_golem_boss');

    const gridTop = HEADER_HEIGHT + LABEL_SIZE + CELL_PADDING;
    VIEWS.forEach((view, column) => {
      drawText(ctx, view.label, {
        x: MARGIN + ROW_LABEL_WIDTH + column * (cellW + CELL_PADDING),
        y: gridTop - LABEL_SIZE - 2,
        size: LABEL_SIZE,
        color: '#f0e9da',
        outline: true,
      });
    });

    rows.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cellH + CELL_PADDING);
      drawText(ctx, row.label, {
        x: MARGIN,
        y: y + cellH / 2,
        size: LABEL_SIZE,
        color: '#f0e9da',
        outline: true,
      });
      VIEWS.forEach((view, column) => {
        const x = MARGIN + ROW_LABEL_WIDTH + column * (cellW + CELL_PADDING);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.strokeRect(x, y, cellW, cellH);
        // The sprite anchors on a tile, so it is placed on the cell's own floor
        // rather than its centre — which is where the anchor is checked from.
        drawRockGolemSprite(
          ctx,
          this.variant.sheet,
          x + (cellW - tile) / 2,
          y + cellH - tile * 2,
          tile,
          {
            walkFrame: this.clock * WALK_FRAME_RATE,
            isMoving: row.moving,
            facingX: view.facingX,
            facingY: view.facingY,
            attack: row.attack,
            attackProgress: this.progressOf(row),
            ballState: row.ballState,
            ballProgress: this.progressOf(row),
          },
        );
      });
    });

    this.renderRockLane(ctx, gridTop + rows.length * (cellH + CELL_PADDING) + CELL_PADDING, tile);

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  /** The thrown boulder crossing a lane and shattering at the end of it. */
  private renderRockLane(ctx: CanvasRenderingContext2D, top: number, tile: number): void {
    const y = top + tile;
    const lane = tile * ROCK_DEMO_LANE_TILES;
    const cycle = ROCK_DEMO_FLIGHT_FRAMES + ROCK_DEMO_BURST_FRAMES;
    const at = this.clock % cycle;

    drawText(ctx, 'thrown rock', {
      x: MARGIN,
      y: y - LABEL_SIZE,
      size: LABEL_SIZE,
      color: '#f0e9da',
      outline: true,
    });

    const startX = MARGIN + ROW_LABEL_WIDTH;
    if (at < ROCK_DEMO_FLIGHT_FRAMES) {
      const travel = at / ROCK_DEMO_FLIGHT_FRAMES;
      drawGolemRock(ctx, startX + lane * travel, y, tile, at * ROCK_DEMO_SPIN_RATE);
      return;
    }
    drawGolemRockBurst(
      ctx,
      startX + lane,
      y,
      tile,
      (at - ROCK_DEMO_FLIGHT_FRAMES) / ROCK_DEMO_BURST_FRAMES,
    );
  }

  /**
   * Fire the real gore system at the middle of the screen.
   *
   * Deliberately the real one rather than a mock: the question this answers is
   * whether a piece tumbles about its own centre or orbits it, and only the
   * runtime's own rotated-centre draw path can answer that.
   */
  private kill(): void {
    this.gore.spawnParts(
      viewportWidth() / 2,
      viewportHeight() / 2,
      this.variant.bodyPartKey,
      BASE_TILE_SIZE,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
  }

  private renderControls(ctx: CanvasRenderingContext2D): void {
    const controls: ReadonlyArray<{ readonly label: string; readonly action: () => void }> = [
      {
        label: this.variant.label,
        action: () => {
          this.variantIndex = (this.variantIndex + 1) % VARIANTS.length;
        },
      },
      {
        label: `${ZOOM_LEVELS[this.zoomIndex]}×`,
        action: () => {
          this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
        },
      },
      {
        label: `speed ${SPEED_LEVELS[this.speedIndex]}`,
        action: () => {
          this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
        },
      },
      {
        label: this.paused ? 'play' : 'pause',
        action: () => {
          this.paused = !this.paused;
        },
      },
      {
        label: 'floor',
        action: () => {
          this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
        },
      },
      {
        label: 'kill',
        action: () => {
          this.kill();
        },
      },
    ];

    controls.forEach((control, index) => {
      addButton(ctx, this.buttons, {
        ...BUTTON_PRESETS.toggle,
        x: MARGIN + index * (BUTTON_WIDTH + BUTTON_GAP),
        y: MARGIN,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        label: control.label,
        action: control.action,
      });
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

/** Sheet frames a one-shot row is spread over before it restarts. */
const ROW_CYCLE_FRAMES = 16;
/** Radians of walk phase added per game frame, matching a mob's own cadence. */
const WALK_FRAME_RATE = 0.16;
/** Radians the demo boulder tumbles per frame. */
const ROCK_DEMO_SPIN_RATE = 0.16;
