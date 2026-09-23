import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { OtterView } from './art/splashZoneArt';
import {
  BOLT_STATE,
  SPLASH_STATE,
  SPLASH_ZONE_BOLT_FIGURE,
  SPLASH_ZONE_FIGURE,
  SPLASH_ZONE_SPLASH_FIGURE,
  SPLASH_ZONE_VIEWS,
  SPLASH_ZONE_WAVE_FIGURE,
  SPLASH_ZONE_TILES_PER_WALK_CYCLE,
  WAVE_AUTHORED_WIDTH_TILES,
  WAVE_STATE,
  type SplashZoneRow,
  splashZoneStateName,
} from './art/splashZoneFigure';
import {
  SPLASH_ZONE_BOLT_FPS,
  SPLASH_ZONE_BOLT_FRAMES,
  SPLASH_ZONE_IDLE_FPS,
  SPLASH_ZONE_SPLASH_FRAMES,
  SPLASH_ZONE_TICKS_PER_SECOND,
  SPLASH_ZONE_WAVE_FPS,
  SPLASH_ZONE_WALK_FRAMES,
  SPLASH_ZONE_WAVE_FRAMES,
} from './splashZoneTiming';

/**
 * Splash Zone, the Meat Shields' otter water mage, and his three projectiles.
 *
 * Painted at runtime from `src/sprites/art/splashZoneArt.ts` and
 * `splashZoneWaterArt.ts` through the figure cache; reviewed with
 * `npm run render:splash-zone`. Frame counts, the frames the bolt and the wave
 * leave on, and the row lengths live in `splashZoneTiming.ts`.
 */

/** Which of the three viewpoints a facing vector selects. */
export type SplashZoneView = OtterView;

/** The one-shot rows a kit plays; everything else is idle or walk. */
export type SplashZoneAction = Extract<SplashZoneRow, 'shoot' | 'cast_wave' | 'hurt' | 'death'>;

/** Everything the otter's sprite needs to pick a frame. Every field is optional. */
export interface SplashZoneSpriteState {
  /** The walk cycle angle (radians, 0–2π), as `Mob.walkFrame` keeps it. */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** The one-shot row playing, or null for idle/walk. */
  readonly action?: SplashZoneAction | null;
  /** 0 on the action's first frame, 1 on its last. A finished death holds the corpse at 1. */
  readonly actionProgress?: number;
  /**
   * Seconds on a clock the idle loops on. Pass something per instance (a
   * spawn-time offset added to the game clock) so two otters on screen do not
   * bounce in lockstep; defaults to the page clock.
   */
  readonly idleSeconds?: number;
}

/** Views split on whichever axis the otter is facing hardest along. */
export function splashZoneViewFor(facingX: number, facingY: number): SplashZoneView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * How many frames a row actually holds, read from the figure that paints it:
 * `drawFigureCached` clamps the frame index, so a row that got shorter would
 * freeze on its last frame rather than throw.
 */
function framesIn(state: string): number {
  return Math.max(1, figureFrameCount(SPLASH_ZONE_FIGURE, state));
}

const MILLIS_PER_SECOND = 1000;
const TWO_PI = Math.PI * 2;

/** Walk-phase radians per world pixel covered, at a tile size: one cycle per stride of ground. */
export function splashZoneWalkRadiansPerPixel(tileSize: number): number {
  return TWO_PI / (SPLASH_ZONE_TILES_PER_WALK_CYCLE * tileSize);
}

/**
 * The most the walk may advance in one tick: one frame of the row. His short
 * stride would need several frames a tick at his run speed, which skips frames
 * and strobes the legs instead of speeding them up; capped, the legs cycle as
 * fast as the row can show and the body is carried the rest of the way.
 */
const SPLASH_ZONE_MAX_WALK_FRAMES_PER_TICK = 1;
export const SPLASH_ZONE_MAX_WALK_RADIANS_PER_TICK =
  (TWO_PI / SPLASH_ZONE_WALK_FRAMES) * SPLASH_ZONE_MAX_WALK_FRAMES_PER_TICK;

interface ResolvedRow {
  readonly name: string;
  readonly frame: number;
  readonly flipX: boolean;
}

function resolveRow(state: SplashZoneSpriteState): ResolvedRow {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    action = null,
    actionProgress = 0,
    idleSeconds = performance.now() / MILLIS_PER_SECOND,
  } = state;
  const view = splashZoneViewFor(facingX, facingY);
  // Only the profile is mirrored. Flipping a head-on view would move the
  // crossbow, and the armband with it, into the other paw every time he turned.
  const flipX = view === 'side' && facingX < 0;

  if (action !== null) {
    const name = splashZoneStateName(action, view);
    return { name, frame: progressFrameIndex(actionProgress, framesIn(name)), flipX };
  }
  if (isMoving) {
    const name = splashZoneStateName('walk', view);
    return { name, frame: walkFrameIndex(walkFrame, framesIn(name)), flipX };
  }
  const name = splashZoneStateName('idle', view);
  return {
    name,
    frame: timeFrameIndex(idleSeconds, SPLASH_ZONE_IDLE_FPS, framesIn(name)),
    flipX,
  };
}

/**
 * Draws Splash Zone with his tile's top-left at (sx, sy).
 *
 * Priority runs action → walk → idle, so a flinch interrupts a stride.
 */
export function drawSplashZoneSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: SplashZoneSpriteState = {},
  alpha?: number,
): void {
  const row = resolveRow(state);
  drawFigureCached(ctx, SPLASH_ZONE_FIGURE, row.name, row.frame, sx, sy, tileSize, {
    flipX: row.flipX,
    alpha,
  });
}

const ALL_ROWS: readonly SplashZoneRow[] = ['idle', 'walk', 'shoot', 'cast_wave', 'hurt', 'death'];
const APPROACH_ROWS: readonly SplashZoneRow[] = ['idle', 'walk'];
const COMBAT_ROWS: readonly SplashZoneRow[] = ['shoot', 'cast_wave', 'hurt', 'death'];

/**
 * Every otter state the draw path can ask for, built through the same
 * `splashZoneStateName` it uses, so this list and the draw call can never name
 * different rows. Narrowed by row and view, never by what the figure happens
 * to declare — a filter on the figure would drop a renamed row out of the list
 * instead of reporting it.
 */
export function splashZoneReachableStates(): readonly string[] {
  return ALL_ROWS.flatMap((row) => SPLASH_ZONE_VIEWS.map((view) => splashZoneStateName(row, view)));
}

/**
 * Warms the rows he crosses the floor on, at the moment he is hired or his
 * contract respawns him — not when he first renders.
 */
export function prewarmSplashZone(): void {
  for (const row of APPROACH_ROWS) {
    for (const view of SPLASH_ZONE_VIEWS) {
      prewarmFigureState(SPLASH_ZONE_FIGURE, splashZoneStateName(row, view));
    }
  }
}

/**
 * Warms his combat rows and all three projectiles, for when he engages: the
 * bolt, the wave and the splash have no telegraph of their own beyond the
 * shoot and cast rows that spawn them.
 */
export function prewarmSplashZoneCombat(): void {
  for (const row of COMBAT_ROWS) {
    for (const view of SPLASH_ZONE_VIEWS) {
      prewarmFigureState(SPLASH_ZONE_FIGURE, splashZoneStateName(row, view));
    }
  }
  prewarmFigureState(SPLASH_ZONE_BOLT_FIGURE, BOLT_STATE);
  prewarmFigureState(SPLASH_ZONE_WAVE_FIGURE, WAVE_STATE);
  prewarmFigureState(SPLASH_ZONE_SPLASH_FIGURE, SPLASH_STATE);
}

// ── Projectiles ──────────────────────────────────────────────────────────────

/**
 * A crossbow bolt in flight.
 *
 * The art points along +X with its **tip on the anchor**; `heading` is the
 * direction of travel in radians (`Math.atan2(dy, dx)`), so (sx, sy) is where
 * the point of the bolt is — the position to test hits against.
 */
export function drawSplashZoneBolt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  heading: number,
  ageTicks: number,
): void {
  const seconds = ageTicks / SPLASH_ZONE_TICKS_PER_SECOND;
  drawFigureCached(
    ctx,
    SPLASH_ZONE_BOLT_FIGURE,
    BOLT_STATE,
    timeFrameIndex(seconds, SPLASH_ZONE_BOLT_FPS, SPLASH_ZONE_BOLT_FRAMES),
    sx,
    sy,
    tileSize,
    { rotation: heading },
  );
}

/**
 * The travelling wave.
 *
 * Painted rolling along +X with the **apex of its crest on the anchor** and
 * the wash trailing behind; `heading` is its direction of travel in radians.
 * `widthTiles` stretches it across that direction so it can cover whatever
 * width of cone it has swept out by now — its authored width is
 * `WAVE_AUTHORED_WIDTH_TILES`, and a stretch between about half and double
 * that still reads as the same water.
 */
export function drawSplashZoneWave(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  heading: number,
  widthTiles: number,
  ageTicks: number,
  alpha = 1,
): void {
  const seconds = ageTicks / SPLASH_ZONE_TICKS_PER_SECOND;
  ctx.save();
  try {
    ctx.translate(sx, sy);
    ctx.rotate(heading);
    ctx.scale(1, widthTiles / WAVE_AUTHORED_WIDTH_TILES);
    drawFigureCached(
      ctx,
      SPLASH_ZONE_WAVE_FIGURE,
      WAVE_STATE,
      timeFrameIndex(seconds, SPLASH_ZONE_WAVE_FPS, SPLASH_ZONE_WAVE_FRAMES),
      0,
      0,
      tileSize,
      { rotation: 0, alpha },
    );
  } finally {
    ctx.restore();
  }
}

/**
 * The splash a bolt or the wave breaks into, upright and anchored on the
 * ground point (sx, sy) under it. `progress` runs 0 on impact to 1 when the
 * ripple has gone; it plays over `SPLASH_ZONE_SPLASH_TICKS`.
 */
export function drawSplashZoneSplash(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
  alpha = 1,
): void {
  drawFigureCached(
    ctx,
    SPLASH_ZONE_SPLASH_FIGURE,
    SPLASH_STATE,
    progressFrameIndex(progress, SPLASH_ZONE_SPLASH_FRAMES),
    sx,
    sy,
    tileSize,
    { rotation: 0, alpha },
  );
}
