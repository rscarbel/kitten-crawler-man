import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { BUGABOO_FIGURE, SWIPE_FRAMES, SWIPE_IMPACT_FRAME } from './art/bugabooFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Which of the three drawn viewpoints a facing resolves to. */
export type BugabooView = 'front' | 'side' | 'away';

type BugabooBase = 'idle' | 'walk' | 'swipe';

type BugabooState =
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'swipe'
  | 'swipe_side'
  | 'swipe_away'
  | 'breach'
  | 'emerge';

/**
 * The frame of every swipe row on which the claws are at full extension.
 * `Bugaboo` deals its damage here, and the choreography is where it is decided,
 * so both read the same constant.
 */
export const BUGABOO_SWIPE_IMPACT_FRAME = SWIPE_IMPACT_FRAME;

/** How many frames every swipe row holds, which the impact frame counts into. */
export const BUGABOO_SWIPE_FRAMES = SWIPE_FRAMES;

/**
 * The topmost inked row of the standing frames, in the figure's own `tileScale`
 * units — every idle and walk frame starts with this much transparent padding.
 * Measured off the painted cells rather than derived, because the anchor only
 * says where the feet are; nothing in the figure's geometry records how far the
 * horns reach. `scripts/gates-bugaboo.ts` re-measures it, since a redraw would
 * move it silently.
 */
export const BUGABOO_STANDING_INK_TOP = 39;

/**
 * How far above his tile origin the standing art actually reaches, in tiles.
 * Anything drawn over a Bugaboo's head — a speech bubble, an interaction prompt —
 * has to start above this or it lands on his chest.
 */
export function bugabooHeadClearanceTiles(): number {
  return (BUGABOO_FIGURE.tileY - BUGABOO_STANDING_INK_TOP) / BUGABOO_FIGURE.tileScale;
}

/** Loop speed for the idle, which is driven by the clock rather than a timer. */
export const BUGABOO_IDLE_FPS = 6;
/** How fast the arm sweeps its circle while the creature is stuck in a breach. */
export const BUGABOO_BREACH_FPS = 9;
const MILLISECONDS_PER_SECOND = 1000;

function frameCountOf(state: BugabooState): number {
  return figureFrameCount(BUGABOO_FIGURE, state);
}

/** Views split on whichever axis the creature is facing hardest along. */
function viewFor(facingX: number, facingY: number): BugabooView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: BugabooBase, view: BugabooView): BugabooState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the Bugaboo sprite needs to pick a pose. All fields optional. */
export interface BugabooSpriteState {
  /** The walk cycle angle from `Mob.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through a claw swipe, monotonic; null when it is not swiping. */
  readonly swipeProgress?: number | null;
  /**
   * Set while the creature is still under a barricaded grate: it plays the
   * looping breach row — an arm out of a hole in the floor, groping around —
   * instead of its body. Null when it is not stuck in one.
   */
  readonly breaching?: boolean;
  /** 0–1 through hauling itself out of a breach; null when it is not. */
  readonly emergeProgress?: number | null;
  /**
   * Offsets the clock-driven loops, so a room full of Bugaboos does not breathe
   * or grope in unison.
   */
  readonly loopOffsetSeconds?: number;
  /**
   * Overrides the frame of whichever clock-driven loop is playing.
   *
   * The idle and the breach both run off the wall clock so that several of
   * these in one room are out of step with each other. The preview harness has
   * to be able to pause and step them, and a row that ignores the harness's own
   * clock is a row nobody can step through — which would be the breach, the one
   * row that harness mostly exists for.
   */
  readonly loopFrame?: number | null;
}

/**
 * Draw a Bugaboo: idle, walk, claw swipe, and the two floor-breach rows.
 *
 * Priority runs emerge → breach → swipe → walk → idle, so a creature committed
 * to climbing out of the floor always wins over whatever it was doing.
 *
 * Only the profile rows are mirrored; flipping a head-on view would put its
 * eyes and feet on the wrong sides every time it turned around. The breach and
 * emerge rows are head-on only — a hole in the floor has no facing.
 */
export function drawBugabooSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: BugabooSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 1,
    swipeProgress = null,
    breaching = false,
    emergeProgress = null,
    loopOffsetSeconds = 0,
    loopFrame = null,
  } = state;

  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND + loopOffsetSeconds;
  const loopedFrame = (fps: number, count: number): number =>
    loopFrame ?? timeFrameIndex(nowSeconds, fps, count);

  if (emergeProgress !== null) {
    drawFigureCached(
      ctx,
      BUGABOO_FIGURE,
      'emerge',
      progressFrameIndex(emergeProgress, frameCountOf('emerge')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  if (breaching) {
    drawFigureCached(
      ctx,
      BUGABOO_FIGURE,
      'breach',
      loopedFrame(BUGABOO_BREACH_FPS, frameCountOf('breach')),
      sx,
      sy,
      tileSize,
    );
    return;
  }

  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (swipeProgress !== null) {
    const key = stateFor('swipe', view);
    drawFigureCached(
      ctx,
      BUGABOO_FIGURE,
      key,
      progressFrameIndex(swipeProgress, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      BUGABOO_FIGURE,
      key,
      walkFrameIndex(walkFrame, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return;
  }

  const key = stateFor('idle', view);
  drawFigureCached(
    ctx,
    BUGABOO_FIGURE,
    key,
    loopedFrame(BUGABOO_IDLE_FPS, frameCountOf(key)),
    sx,
    sy,
    tileSize,
    {
      flipX,
    },
  );
}

/** Every base pose the creature can play in one of the three views. */
const BUGABOO_BASES: ReadonlyArray<BugabooBase> = ['idle', 'walk', 'swipe'];
const BUGABOO_VIEWS: ReadonlyArray<BugabooView> = ['front', 'side', 'away'];

/**
 * Every state `drawBugabooSprite` can ask the figure for.
 *
 * Built from the same two tables `stateFor` composes rather than listed by
 * hand, so a view or a base added to one is present in the other. The art gates
 * feed this to `missingStateFailures`: both draw paths return silently on a
 * state the figure does not paint, so a name only the runtime knows is an
 * invisible creature and no log line.
 */
export const BUGABOO_STATES: ReadonlyArray<BugabooState> = [
  ...BUGABOO_BASES.flatMap((base) => BUGABOO_VIEWS.map((view) => stateFor(base, view))),
  'breach',
  'emerge',
];

/**
 * Warms every row a Bugaboo can draw.
 *
 * Every row, and not the spawn's first few: `npm run bench:figure-paint` puts
 * one Bugaboo cell over the threshold the direct-paint fallback is affordable
 * below, so a row entered without warning costs a full-cell paint on the frame
 * it is entered. There is no state this creature reaches slowly — a body coming
 * up a boarded grate is breaching on its first frame and swinging at the boards
 * a second later — so the coverage has to be the whole set, and the lead has to
 * come from the wave scheduler rather than from the creature.
 *
 * Called where a wave is *scheduled*. A prewarm of a row already warm is nearly
 * free, so firing this once per wave is cheaper than reasoning about which rows
 * the last wave happened to leave behind.
 */
export function prewarmBugaboo(): void {
  for (const state of BUGABOO_STATES) prewarmFigureState(BUGABOO_FIGURE, state);
}
