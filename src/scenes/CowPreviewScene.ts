/**
 * Localhost-only harness for watching the cows and calves move.
 *
 * Reached via `?cows` in `devBootScene`; never on a production path. Stills
 * cannot answer "does this look smooth": `scripts/render-cow.ts` shows that a
 * loop closes and a hoof plants, but only playback shows whether the walk has
 * weight, whether the hooves skate at the real walking speed, and whether a
 * petted calf's buck reads as joy.
 *
 * The top of the screen is a pasture: all six figures walk a loop, driving the
 * walk row by the ground they actually cover, stop to graze, and stand. The
 * strip below holds the six standing still at the chosen zoom; "pet" plays the
 * happy row once on every one of them with the hearts a petted cow gives off,
 * and "kill" fires the real `BodyPartGoreSystem` for each so the pieces can be
 * watched tumbling.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import {
  COW_AGES,
  COW_COATS,
  COW_HAPPY_FPS,
  CALF_TILES_PER_WALK_CYCLE,
  COW_TILES_PER_WALK_CYCLE,
  type CowAction,
  type CowAge,
  type CowCoatId,
  cowBodyPartKey,
  drawCowSprite,
} from '../sprites/cowSprite';
import { COW_HAPPY_FRAMES } from '../sprites/cowTiming';
import { cowPollPoint, restCowPose } from '../sprites/art/cowArt';
import { cowLookOf } from '../sprites/art/cowLooks';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';

const BASE_TILE_SIZE = 32;
const FRAMES_PER_SECOND = 60;
const TWO_PI = Math.PI * 2;

const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 3;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];
const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor-3 grass a pasture cow stands on, from `src/map/tilegen/palette.ts`. */
const GRASS = '#637032';
const MARGIN = 16;
const TITLE_SIZE = 16;
const LABEL_SIZE = 11;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 92;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
const HEADER_HEIGHT = 68;

/**
 * An adult's and a calf's walking pace, in tiles per second. Close to what a
 * herd will be driven at, so the cadence on screen is the cadence in the game —
 * a harness playing a gait at a different rate hides a strobe.
 */
const WALK_TILES_PER_SECOND: Readonly<Record<CowAge, number>> = { adult: 1.1, calf: 1.3 };
/** The pasture loop each animal walks, in tiles. */
const LOOP_RADIUS_X_TILES = 5;
const LOOP_RADIUS_Y_TILES = 2.2;
const PASTURE_HEIGHT_TILES = 7;
/** Seconds a cow spends on each part of its routine. */
const WALK_SECONDS = 7;
const GRAZE_SECONDS = 4;
const IDLE_SECONDS = 2;
const ROUTINE_SECONDS = WALK_SECONDS + GRAZE_SECONDS + IDLE_SECONDS;
/** Cells in the standing strip, in tiles per animal. */
const STRIP_CELL_TILES = 2.4;

/** How long the happy row plays, in seconds. */
const HAPPY_SECONDS = COW_HAPPY_FRAMES / COW_HAPPY_FPS;
/** The hearts are a stand-in until the shared emote effect exists. */
const HEART_SECONDS = 3;
const HEART_COUNT = 4;
const HEART_RISE_TILES = 1;
const HEART_COLOR = '#ff5c7a';
const HEART_STAGGER_SECONDS = 0.25;
const HEART_SWAY_TILES = 0.15;
const HEART_SPACING_TILES = 0.12;
const HEART_SIZE_TILES = 0.3;
/** The share of a heart's life it spends fading out. */
const HEART_FADE_SHARE = 0.3;
/** Where in its strip cell a standing cow's tile sits, as a share of the cell. */
const STRIP_GROUND_SHARE = 0.55;
/** Seconds the idle clocks of neighbouring strip cows are offset by, so they do not chew in step. */
const STRIP_CLOCK_STAGGER = 0.3;
/** Where the kill demo drops its pieces, as a share of the screen height. */
const KILL_HEIGHT_SHARE = 0.8;

const PREVIEW_MAP_SIZE = 24;
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

interface Walker {
  readonly coat: CowCoatId;
  readonly age: CowAge;
  /** Where on the loop this animal starts, and where in its routine. */
  readonly offset: number;
  angle: number;
  gaitPhase: number;
}

export class CowPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);
  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];
  private readonly walkers: Walker[] = COW_AGES.flatMap((age) =>
    COW_COATS.map((coat, i) => ({
      coat,
      age,
      offset: (i + (age === 'calf' ? COW_COATS.length : 0)) / (COW_COATS.length * COW_AGES.length),
      angle: 0,
      gaitPhase: 0,
    })),
  );

  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private paused = false;
  /** Scene clock, in seconds of play at the chosen speed. */
  private clock = 0;
  /** When the last pet happened on the scene clock, or null before the first. */
  private pettedAt: number | null = null;

  update(): void {
    if (this.paused) return;
    const dt = SPEED_LEVELS[this.speedIndex] / FRAMES_PER_SECOND;
    this.clock += dt;
    for (const walker of this.walkers) {
      if (this.actionOf(walker) !== 'walk') continue;
      const tilesPerSecond = WALK_TILES_PER_SECOND[walker.age];
      const loopLength = Math.PI * (LOOP_RADIUS_X_TILES + LOOP_RADIUS_Y_TILES);
      walker.angle += (tilesPerSecond * dt * TWO_PI) / loopLength;
      const tilesPerCycle =
        walker.age === 'adult' ? COW_TILES_PER_WALK_CYCLE : CALF_TILES_PER_WALK_CYCLE;
      walker.gaitPhase += (tilesPerSecond * dt * TWO_PI) / tilesPerCycle;
    }
    this.gore.update();
  }

  private actionOf(walker: Walker): CowAction {
    const at = (this.clock / ROUTINE_SECONDS + walker.offset) % 1;
    const seconds = at * ROUTINE_SECONDS;
    if (seconds < WALK_SECONDS) return 'walk';
    if (seconds < WALK_SECONDS + GRAZE_SECONDS) return 'graze';
    return 'idle';
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.buttons.length = 0;
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, width, height);
    this.renderHeader(ctx);

    const tile = BASE_TILE_SIZE;
    const pastureTop = HEADER_HEIGHT + MARGIN;
    const centreX = width / 2;
    const centreY = pastureTop + (PASTURE_HEIGHT_TILES * tile) / 2;
    const placed = this.walkers.map((walker) => {
      const angle = walker.angle + walker.offset * TWO_PI;
      const x = centreX + Math.cos(angle) * LOOP_RADIUS_X_TILES * tile;
      const y = centreY + Math.sin(angle) * LOOP_RADIUS_Y_TILES * tile;
      // Heading along the loop, as the tangent of the ellipse.
      const facingX = -Math.sin(angle) * LOOP_RADIUS_X_TILES;
      const facingY = Math.cos(angle) * LOOP_RADIUS_Y_TILES;
      return { walker, x, y, facingX, facingY };
    });
    // Y-sorted, as the game draws mobs, so the nearer cow is in front.
    placed.sort((a, b) => a.y - b.y);
    for (const { walker, x, y, facingX, facingY } of placed) {
      drawCowSprite(ctx, x - tile / 2, y - tile / 2, tile, {
        coat: walker.coat,
        age: walker.age,
        action: this.actionOf(walker),
        facingX,
        facingY,
        gaitPhase: walker.gaitPhase,
        clockSeconds: this.clock + walker.offset * ROUTINE_SECONDS,
      });
    }

    this.renderStrip(ctx, pastureTop + PASTURE_HEIGHT_TILES * tile + MARGIN, width);
    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  /** The six standing still at the chosen zoom, where "pet" plays. */
  private renderStrip(ctx: CanvasRenderingContext2D, top: number, width: number): void {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const cell = tile * STRIP_CELL_TILES;
    const count = this.walkers.length;
    const left = Math.max(MARGIN, (width - count * cell) / 2);
    const sincePet = this.pettedAt === null ? Infinity : this.clock - this.pettedAt;
    const petting = sincePet < HAPPY_SECONDS;
    this.walkers.forEach((walker, i) => {
      const x = left + i * cell + cell / 2 - tile / 2;
      const y = top + cell * STRIP_GROUND_SHARE;
      drawCowSprite(ctx, x, y, tile, {
        coat: walker.coat,
        age: walker.age,
        action: petting ? 'happy' : 'idle',
        facingX: 1,
        facingY: 0,
        progress: petting ? sincePet / HAPPY_SECONDS : 0,
        clockSeconds: this.clock + i * STRIP_CLOCK_STAGGER,
      });
      drawText(ctx, `${walker.age} ${walker.coat}`, {
        x: x + tile / 2,
        y: y + tile + LABEL_SIZE,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
      if (sincePet < HEART_SECONDS) {
        const poll = cowPollPoint(restCowPose(), cowLookOf(walker.coat, walker.age), 'side');
        this.renderHearts(
          ctx,
          x + tile / 2 + poll.x * tile,
          y + tile / 2 + poll.y * tile,
          tile,
          sincePet,
        );
      }
    });
  }

  /**
   * A placeholder for the hearts a petted cow gives off, until the shared emote
   * effect exists: a few text hearts rising and fading over the head.
   */
  private renderHearts(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tile: number,
    age: number,
  ): void {
    for (let i = 0; i < HEART_COUNT; i++) {
      const start = i * HEART_STAGGER_SECONDS;
      const t = (age - start) / (HEART_SECONDS - start);
      if (t < 0 || t > 1) continue;
      const rise = t * HEART_RISE_TILES * tile;
      const sway = Math.sin(t * TWO_PI + i) * tile * HEART_SWAY_TILES;
      const fadeStart = 1 - HEART_FADE_SHARE;
      ctx.save();
      ctx.globalAlpha = t > fadeStart ? (1 - t) / HEART_FADE_SHARE : 1;
      drawText(ctx, '♥', {
        x: x + sway + (i - HEART_COUNT / 2) * tile * HEART_SPACING_TILES,
        y: y - rise,
        size: Math.round(tile * HEART_SIZE_TILES),
        align: 'center',
        color: HEART_COLOR,
        outline: true,
      });
      ctx.restore();
    }
  }

  private kill(): void {
    const tile = BASE_TILE_SIZE;
    this.walkers.forEach((walker, i) => {
      this.gore.spawnParts(
        viewportWidth() / 2 + (i - this.walkers.length / 2) * tile * 2,
        viewportHeight() * KILL_HEIGHT_SHARE,
        cowBodyPartKey(walker.coat, walker.age),
        tile,
        KILL_IMPACT_X,
        KILL_IMPACT_Y,
      );
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

  private renderHeader(ctx: CanvasRenderingContext2D): void {
    drawText(ctx, 'cows preview — ?cows', {
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
    x = this.control(ctx, x, y, `speed ${SPEED_LEVELS[this.speedIndex]}x`, () => {
      this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
    });
    x = this.control(ctx, x, y, 'pet', () => {
      this.pettedAt = this.clock;
    });
    this.control(ctx, x, y, 'kill', () => {
      this.kill();
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
      // This scene has no `AudioManager`; the call keeps the control path the
      // same as every other button in the game.
      playButtonSound(null);
      button.action?.();
      return;
    }
  }
}
