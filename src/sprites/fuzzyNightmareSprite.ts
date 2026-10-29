import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import {
  FUZZY_NIGHTMARE_FIGURE,
  SWIPE_FRAMES,
  SWIPE_IMPACT_FRAME,
} from './art/fuzzyNightmareFigure';
import { type DrawnFigureRow, figureFrameCount, drawnFigureRow } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

/** Which of the three drawn viewpoints a facing resolves to. */
export type FuzzyNightmareView = 'front' | 'side' | 'away';

type FuzzyNightmareBase = 'idle' | 'walk' | 'swipe';

type FuzzyNightmareState =
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
 * `FuzzyNightmare` deals its damage here, and the choreography is where it is decided,
 * so both read the same constant.
 */
export const FUZZY_NIGHTMARE_SWIPE_IMPACT_FRAME = SWIPE_IMPACT_FRAME;

/** How many frames every swipe row holds, which the impact frame counts into. */
export const FUZZY_NIGHTMARE_SWIPE_FRAMES = SWIPE_FRAMES;

/** Loop speed for the idle, which is driven by the clock rather than a timer. */
export const FUZZY_NIGHTMARE_IDLE_FPS = 6;
/** How fast the arm sweeps its circle while the creature is stuck in a breach. */
export const FUZZY_NIGHTMARE_BREACH_FPS = 9;
const MILLISECONDS_PER_SECOND = 1000;

function frameCountOf(state: FuzzyNightmareState): number {
  return figureFrameCount(FUZZY_NIGHTMARE_FIGURE, state);
}

/** Views split on whichever axis the creature is facing hardest along. */
function viewFor(facingX: number, facingY: number): FuzzyNightmareView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: FuzzyNightmareBase, view: FuzzyNightmareView): FuzzyNightmareState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the Fuzzy Nightmare sprite needs to pick a pose. All fields optional. */
export interface FuzzyNightmareSpriteState {
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
   * Offsets the clock-driven loops, so a room full of Fuzzy Nightmares does not breathe
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
 * Draw a Fuzzy Nightmare — idle, walk, claw swipe, and the two floor-breach rows —
 * returning the row drawn.
 *
 * Priority runs emerge → breach → swipe → walk → idle, so a creature committed
 * to climbing out of the floor always wins over whatever it was doing.
 *
 * Only the profile rows are mirrored; flipping a head-on view would put its
 * eyes and feet on the wrong sides every time it turned around. The breach and
 * emerge rows are head-on only — a hole in the floor has no facing.
 */
export function drawFuzzyNightmareSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: FuzzyNightmareSpriteState = {},
): DrawnFigureRow {
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
      FUZZY_NIGHTMARE_FIGURE,
      'emerge',
      progressFrameIndex(emergeProgress, frameCountOf('emerge')),
      sx,
      sy,
      tileSize,
    );
    return drawnFigureRow(FUZZY_NIGHTMARE_FIGURE, 'emerge');
  }

  if (breaching) {
    drawFigureCached(
      ctx,
      FUZZY_NIGHTMARE_FIGURE,
      'breach',
      loopedFrame(FUZZY_NIGHTMARE_BREACH_FPS, frameCountOf('breach')),
      sx,
      sy,
      tileSize,
    );
    return drawnFigureRow(FUZZY_NIGHTMARE_FIGURE, 'breach');
  }

  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (swipeProgress !== null) {
    const key = stateFor('swipe', view);
    drawFigureCached(
      ctx,
      FUZZY_NIGHTMARE_FIGURE,
      key,
      progressFrameIndex(swipeProgress, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return drawnFigureRow(FUZZY_NIGHTMARE_FIGURE, key);
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      FUZZY_NIGHTMARE_FIGURE,
      key,
      walkFrameIndex(walkFrame, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return drawnFigureRow(FUZZY_NIGHTMARE_FIGURE, key);
  }

  const key = stateFor('idle', view);
  drawFigureCached(
    ctx,
    FUZZY_NIGHTMARE_FIGURE,
    key,
    loopedFrame(FUZZY_NIGHTMARE_IDLE_FPS, frameCountOf(key)),
    sx,
    sy,
    tileSize,
    {
      flipX,
    },
  );
  return drawnFigureRow(FUZZY_NIGHTMARE_FIGURE, key);
}

/** Every base pose the creature can play in one of the three views. */
const FUZZY_NIGHTMARE_BASES: ReadonlyArray<FuzzyNightmareBase> = ['idle', 'walk', 'swipe'];
const FUZZY_NIGHTMARE_VIEWS: ReadonlyArray<FuzzyNightmareView> = ['front', 'side', 'away'];

/**
 * Every state `drawFuzzyNightmareSprite` can ask the figure for.
 *
 * Built from the same two tables `stateFor` composes rather than listed by
 * hand, so a view or a base added to one is present in the other. The art gates
 * feed this to `missingStateFailures`: both draw paths return silently on a
 * state the figure does not paint, so a name only the runtime knows is an
 * invisible creature and no log line.
 */
export const FUZZY_NIGHTMARE_STATES: ReadonlyArray<FuzzyNightmareState> = [
  ...FUZZY_NIGHTMARE_BASES.flatMap((base) =>
    FUZZY_NIGHTMARE_VIEWS.map((view) => stateFor(base, view)),
  ),
  'breach',
  'emerge',
];

/**
 * Warms every row a Fuzzy Nightmare can draw.
 *
 * Every row, and not the spawn's first few: `npm run bench:figure-paint` puts
 * one Fuzzy Nightmare cell over the threshold the direct-paint fallback is affordable
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
export function prewarmFuzzyNightmare(): void {
  for (const state of FUZZY_NIGHTMARE_STATES) prewarmFigureState(FUZZY_NIGHTMARE_FIGURE, state);
}
