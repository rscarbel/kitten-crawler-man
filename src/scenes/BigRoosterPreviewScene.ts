/**
 * Localhost-only harness for watching the roosters play every row they have.
 * Reached via `?rooster` in `devBootScene`; never on a production path.
 *
 * It exists because a still cannot answer the questions that matter here:
 * `scripts/render-big-rooster.ts` shows that the walk loop closes and the
 * dumbbell stays in the fist, but only playback shows whether the bird's head
 * holds and snaps, whether the club arc reads as a swing, and whether a
 * wind-up lasts long enough to step out of.
 *
 * One build at a time (Big Rooster, Little Rooster or Slightly Bent Rooster)
 * plays every row the runtime asks it for, in all four facings, at a 32, 64
 * or 128 px tile. Each cell is drawn through `drawRoosterSprite`, the same
 * entry point the creatures use, so the held dumbbell and the view rule are
 * the game's own. The backdrop cycles the real floor palettes so the contrast
 * check happens against what the bird actually stands on.
 *
 * Drag or scroll to pan: Big Rooster's grid is larger than any screen at 128 px.
 */

import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { worldText } from '../ui/world/worldText';
import type { WorldGesture } from '../ui/core/UiRoot';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import {
  drawRoosterSprite,
  ROOSTER_ROW_TIMING,
  ROOSTER_RUNTIME_ROWS,
  type RoosterBuild,
  type RoosterRowBase,
  type RoosterSpriteState,
} from '../sprites/roosterSprite';
import { ROOSTER_CELLS, gaitGroundPerCycle } from '../sprites/art/roosterFigure';
import { ROOSTER_TILE_SCALE } from '../sprites/art/roosterArt';
import {
  BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS,
  BIG_ROOSTER_CLUB_SWING_RECOVER_FRAMES,
  BIG_ROOSTER_CLUB_SWING_WINDUP_FRAMES,
  BIG_ROOSTER_SLAM_IMPACT_PROGRESS,
  BIG_ROOSTER_SLAM_RECOVER_FRAMES,
  BIG_ROOSTER_SLAM_WINDUP_FRAMES,
  BIG_ROOSTER_THROW_WINDUP_FRAMES,
  bigRoosterThrowProgressAt,
  ROOSTER_PECK_IMPACT_PROGRESS,
  ROOSTER_PECK_RECOVER_FRAMES,
  ROOSTER_PECK_WINDUP_FRAMES,
  ROOSTER_PUNCH_IMPACT_PROGRESS,
  ROOSTER_PUNCH_RECOVER_FRAMES,
  ROOSTER_PUNCH_WINDUP_FRAMES,
  ROOSTER_IDLE_GAME_FRAMES,
  roosterActionFrames,
  splitAtImpactProgress,
} from '../sprites/bigRoosterAttackTiming';
import { previewInk } from '../ui/theme/previewInk';
import { TILE_SIZE } from '../core/constants';
import { BIG_ROOSTER_SPEED, BIG_ROOSTER_SPRINT_SPEED_MULTIPLIER } from '../creatures/BigRooster';
import { LITTLE_ROOSTER } from '../creatures/LittleRooster';
import { SLIGHTLY_BENT_ROOSTER } from '../creatures/SlightlyBentRooster';

/** A facing per column, chosen so the runtime's view rule picks each viewpoint. */
interface ViewSpec {
  readonly label: string;
  readonly facingX: number;
  readonly facingY: number;
}

/** The profile is mirrored for the other direction; the head-on views never are. */
const VIEWS: ReadonlyArray<ViewSpec> = [
  { label: 'side →', facingX: 1, facingY: 0 },
  { label: 'side ←', facingX: -1, facingY: 0 },
  { label: 'toward', facingX: 0, facingY: 1 },
  { label: 'away', facingX: 0, facingY: -1 },
];

const BUILDS: ReadonlyArray<{ readonly build: RoosterBuild; readonly name: string }> = [
  { build: 'big', name: 'Big Rooster' },
  { build: 'little', name: 'Little Rooster' },
  { build: 'bent', name: 'Slightly Bent Rooster' },
];

/**
 * A one-shot's wind-up and recovery, for the rows the game splits at the
 * impact: drawn linearly, the impact frame would land a frame or two away from
 * where the fight resolves the blow.
 */
interface SplitTiming {
  readonly windupFrames: number;
  readonly recoverFrames: number;
  readonly impactProgress: number;
}

const SPLIT_TIMINGS: Readonly<Partial<Record<RoosterRowBase, SplitTiming>>> = {
  peck: {
    windupFrames: ROOSTER_PECK_WINDUP_FRAMES,
    recoverFrames: ROOSTER_PECK_RECOVER_FRAMES,
    impactProgress: ROOSTER_PECK_IMPACT_PROGRESS,
  },
  punch: {
    windupFrames: ROOSTER_PUNCH_WINDUP_FRAMES,
    recoverFrames: ROOSTER_PUNCH_RECOVER_FRAMES,
    impactProgress: ROOSTER_PUNCH_IMPACT_PROGRESS,
  },
  club_swing: {
    windupFrames: BIG_ROOSTER_CLUB_SWING_WINDUP_FRAMES,
    recoverFrames: BIG_ROOSTER_CLUB_SWING_RECOVER_FRAMES,
    impactProgress: BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS,
  },
  slam: {
    windupFrames: BIG_ROOSTER_SLAM_WINDUP_FRAMES,
    recoverFrames: BIG_ROOSTER_SLAM_RECOVER_FRAMES,
    impactProgress: BIG_ROOSTER_SLAM_IMPACT_PROGRESS,
  },
};

/**
 * Big Rooster's rows that can carry the dumbbell in his right fist: the peck
 * and the crow are the blows he throws without letting go of it.
 */
const DUMBBELL_ROWS: ReadonlySet<RoosterRowBase> = new Set<RoosterRowBase>([
  'peck',
  'crow',
  'carry_walk',
  'club_swing',
  'throw',
  'pickup',
]);

/** Each build's level-1 walking speed, in pixels per frame. */
const WALKING_SPEED: Readonly<Record<RoosterBuild, number>> = {
  big: BIG_ROOSTER_SPEED,
  little: LITTLE_ROOSTER.speed,
  bent: SLIGHTLY_BENT_ROOSTER.speed,
};

/**
 * Game frames one cycle of a gait takes at `speedPx` a frame: the runtime
 * paces both gaits by the ground covered, so the harness does too.
 */
function gaitGameFrames(build: RoosterBuild, gait: 'walk' | 'sprint', speedPx: number): number {
  const cyclePx = gaitGroundPerCycle(build, gait) * ROOSTER_CELLS[build].tilesPerUnit * TILE_SIZE;
  return Math.round(cyclePx / speedPx);
}

/**
 * How many game frames a row spans. Derived from the shared timing module
 * rather than picked here: a harness that plays a row at a different rate from
 * the game hides undersampling, which is the one defect a still cannot show.
 */
function gameFramesOf(build: RoosterBuild, base: RoosterRowBase): number {
  const split = SPLIT_TIMINGS[base];
  if (split !== undefined) return split.windupFrames + split.recoverFrames;
  if (base === 'throw') return BIG_ROOSTER_THROW_WINDUP_FRAMES;
  if (base === 'idle') return ROOSTER_IDLE_GAME_FRAMES;
  if (base === 'walk' || base === 'carry_walk')
    return gaitGameFrames(build, 'walk', WALKING_SPEED[build]);
  if (base === 'sprint')
    return gaitGameFrames(
      build,
      'sprint',
      WALKING_SPEED[build] * BIG_ROOSTER_SPRINT_SPEED_MULTIPLIER,
    );
  return roosterActionFrames(ROOSTER_ROW_TIMING[base].frames);
}

/** 0–1 through a row at `elapsed` game frames into it, split at the impact where the game splits it. */
function rowProgress(build: RoosterBuild, base: RoosterRowBase, elapsed: number): number {
  if (base === 'throw') return bigRoosterThrowProgressAt(elapsed);
  const split = SPLIT_TIMINGS[base];
  if (split === undefined) return elapsed / gameFramesOf(build, base);
  const inWindup = elapsed < split.windupFrames;
  const framesLeft = inWindup
    ? split.windupFrames - elapsed
    : split.recoverFrames - (elapsed - split.windupFrames);
  return splitAtImpactProgress(
    inWindup,
    framesLeft,
    split.windupFrames,
    split.recoverFrames,
    split.impactProgress,
  );
}

const TAU = Math.PI * 2;

/** The sprite state that plays `base` at `progress`, through the runtime's own row choice. */
function spriteStateFor(
  build: RoosterBuild,
  base: RoosterRowBase,
  progress: number,
  view: ViewSpec,
): RoosterSpriteState {
  const facing = { facingX: view.facingX, facingY: view.facingY };
  const heldDumbbell = build === 'big' && DUMBBELL_ROWS.has(base);
  switch (base) {
    case 'idle':
      return {
        ...facing,
        idleFrame: Math.floor(progress * ROOSTER_ROW_TIMING.idle.frames),
      };
    case 'walk':
    case 'carry_walk':
      return { ...facing, isMoving: true, walkFrame: progress * TAU, heldDumbbell };
    case 'sprint':
      return { ...facing, isSprinting: true, sprintFrame: progress * TAU };
    case 'peck':
      return { ...facing, peckProgress: progress, heldDumbbell };
    case 'punch':
      return { ...facing, punchProgress: progress };
    case 'club_swing':
      return { ...facing, clubProgress: progress, heldDumbbell };
    case 'throw':
      return { ...facing, throwProgress: progress, heldDumbbell };
    case 'slam':
      return { ...facing, slamProgress: progress };
    case 'pickup':
      return { ...facing, pickupProgress: progress, heldDumbbell };
    case 'crow':
      return { ...facing, crowProgress: progress, heldDumbbell };
  }
}

const TILE_32 = 32;
const TILE_64 = 64;
const TILE_128 = 128;
const TILE_SIZES: ReadonlyArray<number> = [TILE_32, TILE_64, TILE_128];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/**
 * The floor mids the roosters stand on, from `src/map/tilegen/palette.ts`: the
 * gym's mat and floor 2's concrete, lit and unlit.
 */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'gym mat', color: previewInk.floor.gymMat },
  { name: 'floor 2 — poured concrete', color: previewInk.floor.pouredConcrete },
  { name: 'floor 2 — unlit concrete', color: previewInk.floor.unlitConcrete },
  { name: 'unlit cave', color: previewInk.floor.unlitCave },
];

const MARGIN = 16;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;

export class BigRoosterPreviewScene extends PreviewScene {
  private buildIndex = 0;
  private tileIndex = TILE_SIZES.indexOf(TILE_64);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;
  /** How far the grid is panned, in canvas pixels. */
  private panX = 0;
  private panY = 0;
  /** Where the last drag sample was, in UI units; null between drags. */
  private dragFrom: { readonly x: number; readonly y: number } | null = null;

  update(): void {
    if (this.stepRequested) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
  }

  private get build(): RoosterBuild {
    return BUILDS[this.buildIndex].build;
  }

  /** One cell's size in canvas pixels: the build's whole figure cell at the chosen tile. */
  private cellSize(tile: number): { readonly w: number; readonly h: number } {
    const cell = ROOSTER_CELLS[this.build];
    return {
      w: (cell.frameWidth / ROOSTER_TILE_SCALE) * tile,
      h: (cell.frameHeight / ROOSTER_TILE_SCALE) * tile,
    };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    const build = this.build;
    const tile = TILE_SIZES[this.tileIndex];
    const cell = this.cellSize(tile);
    const figureCell = ROOSTER_CELLS[build];
    const tileOriginX = (figureCell.tileX / ROOSTER_TILE_SCALE) * tile;
    const tileOriginY = (figureCell.tileY / ROOSTER_TILE_SCALE) * tile;
    const gridLeft = MARGIN + ROW_LABEL_WIDTH - this.panX;
    const gridTop = this.headerBottom + MARGIN + LABEL_SIZE - this.panY;

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

    ROOSTER_RUNTIME_ROWS[build].forEach((base, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const gameFrames = gameFramesOf(build, base);
      const elapsed = Math.floor(this.clock) % gameFrames;
      const progress = rowProgress(build, base, elapsed);
      const frames = ROOSTER_ROW_TIMING[base].frames;
      const frame = Math.min(frames - 1, Math.floor(progress * frames));
      worldText(ctx, base, {
        x: MARGIN - this.panX,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: previewInk.grid.caption,
        outline: true,
      });
      worldText(ctx, `f${frame}  ${gameFrames}gf`, {
        x: MARGIN - this.panX,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: previewInk.grid.timingReadout,
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();
        drawRoosterSprite(
          ctx,
          build,
          x + tileOriginX,
          y + tileOriginY,
          tile,
          spriteStateFor(build, base, progress, view),
        );
        ctx.restore();

        ctx.strokeStyle = previewInk.grid.cellBorder;
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });

    this.renderChrome(ctx);
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.kind === 'wheel') {
      this.panY = Math.max(0, this.panY + gesture.deltaY);
      return;
    }
    if (gesture.kind === 'down') {
      this.dragFrom = { x: gesture.x, y: gesture.y };
      return;
    }
    if (gesture.kind !== 'move') {
      this.dragFrom = null;
      return;
    }
    const from = this.dragFrom;
    if (from === null) return;
    const scale = this.ui.uiScale;
    this.panX = Math.max(0, this.panX - (gesture.x - from.x) * scale);
    this.panY = Math.max(0, this.panY - (gesture.y - from.y) * scale);
    this.dragFrom = { x: gesture.x, y: gesture.y };
  }

  protected previewTitle(): string {
    return 'rooster preview — ?rooster';
  }

  protected previewCaptions(): readonly string[] {
    return [
      `${BUILDS[this.buildIndex].name}  ·  ${BACKDROPS[this.backdropIndex].name}`,
      'drag or scroll to pan',
    ];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        id: 'build',
        label: BUILDS[this.buildIndex].name,
        onTap: () => {
          this.buildIndex = (this.buildIndex + 1) % BUILDS.length;
          this.panX = 0;
          this.panY = 0;
        },
      },
      {
        id: 'tile',
        label: `tile ${TILE_SIZES[this.tileIndex]}px`,
        onTap: () => {
          this.tileIndex = (this.tileIndex + 1) % TILE_SIZES.length;
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
    ];
  }
}
