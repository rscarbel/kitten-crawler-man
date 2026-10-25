import {
  MILLISECONDS_PER_SECOND,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import {
  drawFigureCached,
  type FigureBetween,
  prewarmFigureState,
  releaseFigure,
  withFigureCellPlacement,
} from './figure/figureFrameCache';
import { catHeldPxPerUnit, catHeldSocketOf, catSocketsAt } from './art/catSockets';
import { compositeHeldItem, heldTransformAt } from './held/heldComposite';
import type { HeldVisualDef } from './held/heldVisualDef';
import { ResidentRows, type ResidentSpan } from './figure/residentRows';
import type { FigureDef } from './figure/figureDef';
import { figureFrameCount } from './figure/figureDef';
import { CAT_SWIPE_FRAMES } from '../core/crawlerFormulas';
import type { WorkingToolKind } from '../core/toolTiers';
import {
  ACTION_FRAMES,
  BREAK_FRAMES,
  catFigureFor,
  catRowFacesWest,
  catRowView,
  type CatHold,
  DANCE_FRAMES,
  IDLE_FRAMES,
  KO_FRAMES,
  PLAYER_CAT_LOOK,
  WALK_FRAMES,
  WORK_IMPACT_FRAME,
} from './art/catFigure';
import {
  MAGIC_MISSILE_EXPLOSION_FIGURE,
  MAGIC_MISSILE_PROJECTILE_FIGURE,
} from './art/magicMissileFigure';
import { getMagicMissileVisualTier, type MagicMissileVisualTier } from '../abilities/magicMissile';
import { missileOpacity, type SplatterCopy } from '../abilities/eyesOfSplatter';
import { DEFAULT_FACING_SELECTION, type FacingSelection } from './facingView';
import { catRowViewOf, type CatRowView } from './catViews';
import { BARE_CAT_OUTFIT } from './garments/cat/catDressing';
import { outfitOf, sameOutfit, type Outfit } from './garments/outfit';
import type { CatLook } from './looks/catLook';

export interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  distTraveled: number;
  maxDist: number;
  state: 'flying' | 'exploding';
  explodeTimer: number;
  hit: boolean;
  /** The Magic Missile ability level when this missile was created. */
  abilityLevel: number;
  /** Sub-missiles spawned by level-10 never chain-react further. */
  isSubMissile: boolean;
  /** Present on a copy released by the Eyes of Splatter; copies never release copies. */
  splatter?: SplatterCopy;
}

/**
 * Every row `drawCatSprite` can ask the figure for. Written out rather than
 * derived from the figure, because the draw call *clamps* a frame index and
 * skips a state it cannot find: read off the figure, a row that lost its frames
 * or its name would freeze or vanish instead of failing. `scripts/gates-cat.ts`
 * holds this union and the figure's own states equal.
 */
export type CatState =
  | 'walk'
  | 'walk_side'
  | 'walk_side_west'
  | 'walk_away'
  | 'idle'
  | 'idle_side'
  | 'idle_side_west'
  | 'idle_away'
  | 'look_around'
  | 'groom_paw'
  | 'groom_flank'
  | 'swipe'
  | 'swipe_side'
  | 'swipe_side_west'
  | 'swipe_away'
  | 'cast'
  | 'cast_side'
  | 'cast_side_west'
  | 'cast_away'
  | 'knocked_out'
  | 'knocked_out_west'
  | 'dance'
  | 'chop'
  | 'chop_side'
  | 'chop_side_west'
  | 'chop_away'
  | 'mine'
  | 'mine_side'
  | 'mine_side_west'
  | 'mine_away'
  | 'carry_walk'
  | 'carry_walk_side'
  | 'carry_walk_side_west'
  | 'carry_walk_away'
  | 'carry_idle'
  | 'carry_idle_side'
  | 'carry_idle_side_west'
  | 'carry_idle_away';

/** Animations that play once and then hand control back to walk/idle. */
export type CatOneShot =
  'swipe' | 'cast' | 'dance' | 'look_around' | 'groom_paw' | 'groom_flank' | 'chop' | 'mine';

/** Her work swings: a two-paw chop at wood and a two-paw pick at stone. */
export type CatWorkSwing = Extract<CatOneShot, 'chop' | 'mine'>;

/**
 * Her work swing for each tool: a pick at stone and the striker's mallet both
 * come down from overhead, everything else is chopped.
 */
export const CAT_WORK_SWING_OF_TOOL: Readonly<Record<WorkingToolKind, CatWorkSwing>> = {
  axe: 'chop',
  scythe: 'chop',
  pickaxe: 'mine',
  striker_mallet: 'mine',
};

const CAT_CAST_FRAMES = 24;
const CAT_DANCE_FRAMES = 96;
const CAT_LOOK_AROUND_FRAMES = 90;
const CAT_GROOM_FRAMES = 110;

/**
 * Her work swings last as long as her swipe, `CAT_SWIPE_FRAMES`: harvests,
 * jobs and the grain harvest replay a work swing on cadences counted in
 * ticks and expect each to be over by the next.
 */
const ONE_SHOT_DURATION: Record<CatOneShot, number> = {
  chop: CAT_SWIPE_FRAMES,
  mine: CAT_SWIPE_FRAMES,
  swipe: CAT_SWIPE_FRAMES,
  cast: CAT_CAST_FRAMES,
  dance: CAT_DANCE_FRAMES,
  look_around: CAT_LOOK_AROUND_FRAMES,
  groom_paw: CAT_GROOM_FRAMES,
  groom_flank: CAT_GROOM_FRAMES,
};

/** Ticks her work swing plays for, start to finish. */
export const CAT_WORK_SWING_DURATION_TICKS = ONE_SHOT_DURATION.mine;
/** Ticks from the start of her work swing to the first tick its bite is on screen. */
export const CAT_WORK_SWING_IMPACT_TICKS = Math.ceil(
  (CAT_WORK_SWING_DURATION_TICKS * WORK_IMPACT_FRAME) / ACTION_FRAMES,
);

/** Idle breaks are cosmetic; anything else interrupts them the moment it fires. */
const IDLE_BREAKS: readonly CatOneShot[] = ['look_around', 'groom_paw', 'groom_flank'];

/**
 * Animations she abandons as soon as she moves. The level-up dance is in here
 * because a level-up lands mid-fight as often as not, and a cat sliding across
 * the floor in a dance pose looks broken.
 */
const INTERRUPTED_BY_MOVEMENT: readonly CatOneShot[] = [...IDLE_BREAKS, 'dance'];

/**
 * Frames an animation is guaranteed before movement can cut it short. Without
 * it the dance is unreachable art: the follower cat is walking on almost every
 * frame a level-up lands on, so the celebration would be cancelled the tick
 * after it started.
 */
const MOVEMENT_INTERRUPT_GRACE: Partial<Record<CatOneShot, number>> = { dance: 30 };

/** Frames of standing still before she gets bored enough to preen or look around. */
const IDLE_BREAK_MIN_DELAY = 240;
const IDLE_BREAK_RANDOM_DELAY = 420;
/**
 * Frames ahead of an idle break that its row is asked for: a break is
 * held in no view's resident set, so after a long stand it has been swept,
 * and her fur makes a cold row a run of frames each baked on the render path.
 * Well inside the cache's release window even on the fastest display, so the
 * warming is not swept before the break plays.
 */
const IDLE_BREAK_PREWARM_LEAD = 120;

/**
 * Frames per row, taken from the choreography that paints them, so the two
 * cannot drift. Exhaustive by construction: a state added to `CatState` without
 * a count here is a compile error.
 */
const FRAME_COUNT: Record<CatState, number> = {
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_side_west: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_side_west: IDLE_FRAMES,
  idle_away: IDLE_FRAMES,
  look_around: BREAK_FRAMES,
  groom_paw: BREAK_FRAMES,
  groom_flank: BREAK_FRAMES,
  swipe: ACTION_FRAMES,
  swipe_side: ACTION_FRAMES,
  swipe_side_west: ACTION_FRAMES,
  swipe_away: ACTION_FRAMES,
  cast: ACTION_FRAMES,
  cast_side: ACTION_FRAMES,
  cast_side_west: ACTION_FRAMES,
  cast_away: ACTION_FRAMES,
  knocked_out: KO_FRAMES,
  knocked_out_west: KO_FRAMES,
  dance: DANCE_FRAMES,
  chop: ACTION_FRAMES,
  chop_side: ACTION_FRAMES,
  chop_side_west: ACTION_FRAMES,
  chop_away: ACTION_FRAMES,
  mine: ACTION_FRAMES,
  mine_side: ACTION_FRAMES,
  mine_side_west: ACTION_FRAMES,
  mine_away: ACTION_FRAMES,
  carry_walk: WALK_FRAMES,
  carry_walk_side: WALK_FRAMES,
  carry_walk_side_west: WALK_FRAMES,
  carry_walk_away: WALK_FRAMES,
  carry_idle: IDLE_FRAMES,
  carry_idle_side: IDLE_FRAMES,
  carry_idle_side_west: IDLE_FRAMES,
  carry_idle_away: IDLE_FRAMES,
};

/**
 * Every row she can be drawn in without holding anything, standing and
 * walking first. The rows she plays only while holding something are in
 * {@link HELD_ROWS}, warmed when the hold begins.
 *
 * All of them, not just the ones she spends her life in. Her fur engine lays
 * down several hundred individual hair strokes per frame, which makes her by
 * some way the most expensive painter in the game — an order of magnitude past
 * the cost at which painting a frame on demand fits inside a frame's slack — so
 * a row that is not warm when she needs it is a dropped frame, not a slightly
 * soft one. The order is the order the queue drains in, so the rows she is
 * drawn in continuously are ready first and the ones she reaches for on a swipe,
 * a cast or a knockout follow behind them.
 */
const PREWARMED_ROWS: ReadonlyArray<CatState> = [
  'idle',
  'idle_side',
  'idle_side_west',
  'idle_away',
  'walk',
  'walk_side',
  'walk_side_west',
  'walk_away',
  'swipe',
  'swipe_side',
  'swipe_side_west',
  'swipe_away',
  'cast',
  'cast_side',
  'cast_side_west',
  'cast_away',
  'knocked_out',
  'knocked_out_west',
  'dance',
  'look_around',
  'groom_paw',
  'groom_flank',
];

/**
 * The rows she plays only while holding something, by what she holds: a
 * tool's swing in every view, or her walk and idle with something in her
 * jaws. Warmed when the hold begins rather than with the rest: all of them
 * on top of her other rows would be past her share of the cache, and she
 * never holds two of these at once.
 */
const HELD_ROWS: Readonly<Record<CatHold, readonly CatState[]>> = {
  chop: ['chop', 'chop_side', 'chop_side_west', 'chop_away'],
  mine: ['mine', 'mine_side', 'mine_side_west', 'mine_away'],
  carry: [
    'carry_walk',
    'carry_walk_side',
    'carry_walk_side_west',
    'carry_walk_away',
    'carry_idle',
    'carry_idle_side',
    'carry_idle_side_west',
    'carry_idle_away',
  ],
};

let activeLook: CatLook = PLAYER_CAT_LOOK;
let activeOutfit: Outfit<'cat'> = BARE_CAT_OUTFIT;
let activeFigure: FigureDef = catFigureFor(activeLook, BARE_CAT_OUTFIT);

/** Who the cat crawler is painted as: the player's cat, unless a preview has asked for another. */
export function activeCatLook(): CatLook {
  return activeLook;
}

/**
 * Paints the cat crawler as `look` from now on, in the garments she has on.
 * The old look's cells are released at once: only one cat look is ever
 * resident.
 */
export function setCatLook(look: CatLook): void {
  if (look === activeLook) return;
  releaseFigure(activeFigure);
  activeLook = look;
  activeOutfit = outfitOf(look, activeOutfit.worn);
  activeFigure = catFigureFor(look, activeOutfit);
  prewarmCatSprite();
}

/** The figure every draw and prewarm of the cat crawler goes through. */
export function activeCatFigure(): FigureDef {
  return activeFigure;
}

/**
 * Dresses the cat crawler's sprite in `outfit`. On a change the old look's cells are
 * released at once and the new one's rows queued: she is the most expensive
 * painter in the game, so two complete looks resident side by side is budget
 * nothing else gets back. Cheap when nothing that shows changed.
 *
 * Returns whether the look changed.
 */
export function setCatOutfit(outfit: Outfit<'cat'>): boolean {
  if (sameOutfit(outfit, activeOutfit)) return false;
  releaseFigure(activeFigure);
  activeOutfit = outfit;
  activeFigure = catFigureFor(activeLook, outfit);
  prewarmCatSprite();
  return true;
}

/** Queues every row the cat crawler can be drawn in empty-handed for baking. Call once per scene. */
export function prewarmCatSprite(): void {
  for (const state of PREWARMED_ROWS) prewarmFigureState(activeFigure, state);
}

/**
 * Queues the rows she plays holding `hold`, the ones of the view she faces
 * first: those are drawn next, and a swing's layered cells bake two layers
 * each. With something in her jaws, the faced row she is drawn in on the very
 * next frame — her carrying walk if `moving`, else her carrying idle — goes
 * ahead of the other: the idle loop's frame is picked by the clock, so while
 * it waits behind a whole walk row every frame the clock reaches is cold.
 */
export function prewarmCatHold(hold: CatHold, facing: FacingSelection, moving: boolean): void {
  const view = catRowViewOf(facing.view);
  const faced = (state: CatState): boolean =>
    catRowView(state) === view && catRowFacesWest(state) === (view === 'side' && facing.flipX);
  const drawnNext =
    hold === 'carry' ? directionalState(moving ? 'carry_walk' : 'carry_idle', facing) : null;
  const rows = HELD_ROWS[hold];
  const facedFirst = [...rows.filter(faced), ...rows.filter((row) => !faced(row))];
  const ordered =
    drawnNext === null ? facedFirst : [drawnNext, ...facedFirst.filter((row) => row !== drawnNext)];
  for (const state of ordered) prewarmFigureState(activeFigure, state);
}

/** Loop speeds for the animations that are driven by the clock, not by a timer. */
const IDLE_FPS = 6;
const KNOCKED_OUT_FPS = 4;

/** A one-shot in flight, as the renderer needs to see it. */
export interface CatOneShotState {
  readonly action: CatOneShot;
  /** 0 at the first frame of the animation, 1 at the last. */
  readonly progress: number;
}

/**
 * Her first break is chosen rather than drawn, so building her takes nothing
 * from `Math.random`: seeded harnesses construct crawlers mid-stream, and one
 * extra draw there reshuffles every roll after it.
 */
const FIRST_IDLE_BREAK: CatOneShot = 'look_around';

function randomBreak(): CatOneShot {
  return IDLE_BREAKS[Math.floor(Math.random() * IDLE_BREAKS.length)];
}

/**
 * Owns the cat crawler's animation timers: the one-shot currently playing and how long
 * she has been standing around doing nothing, which is what triggers the idle
 * breaks (a look around, a paw wash, a flank wash).
 */
export class CatAnimator {
  private oneShot: CatOneShot | null = null;
  private framesLeft = 0;
  private duration = 1;
  private idleFrames = 0;
  private nextBreakDelay = IDLE_BREAK_MIN_DELAY;
  private nextBreak: CatOneShot = FIRST_IDLE_BREAK;

  /** Starts an animation, replacing whatever was playing. */
  play(action: CatOneShot): void {
    this.oneShot = action;
    this.duration = ONE_SHOT_DURATION[action];
    this.framesLeft = this.duration;
    this.idleFrames = 0;
  }

  /** Drops `action` if it is the animation in flight. */
  stop(action: CatOneShot): void {
    if (this.oneShot === action) this.oneShot = null;
  }

  /** Drops any animation in flight — used when a scene resets combat state. */
  reset(): void {
    this.oneShot = null;
    this.framesLeft = 0;
    this.idleFrames = 0;
    this.nextBreakDelay = IDLE_BREAK_MIN_DELAY;
  }

  /** Advances timers by one frame. Call once per frame, before rendering. */
  tick(isMoving: boolean, isKnockedOut: boolean): void {
    if (isKnockedOut) {
      this.reset();
      return;
    }

    if (this.oneShot !== null) {
      const elapsed = this.duration - this.framesLeft;
      const past = elapsed >= (MOVEMENT_INTERRUPT_GRACE[this.oneShot] ?? 0);
      const interruptedByMovement =
        isMoving && past && INTERRUPTED_BY_MOVEMENT.includes(this.oneShot);
      this.framesLeft--;
      if (this.framesLeft <= 0 || interruptedByMovement) this.oneShot = null;
      return;
    }

    if (isMoving) {
      this.idleFrames = 0;
      return;
    }

    this.idleFrames++;
    // Asked on every tick of the lead rather than once: a menu held open
    // partway through it halts these ticks but not the cache's sweep. Asked
    // ahead of the queue, since standing still also queues the swings of the
    // view she faces, and a break behind them would play cold.
    if (this.idleFrames >= this.nextBreakDelay - IDLE_BREAK_PREWARM_LEAD) {
      prewarmFigureState(activeFigure, this.nextBreak, undefined, true);
    }
    if (this.idleFrames < this.nextBreakDelay) return;
    this.nextBreakDelay =
      IDLE_BREAK_MIN_DELAY + Math.floor(Math.random() * IDLE_BREAK_RANDOM_DELAY);
    this.play(this.nextBreak);
    this.nextBreak = randomBreak();
  }

  get current(): CatOneShotState | null {
    if (this.oneShot === null) return null;
    const elapsed = this.duration - this.framesLeft;
    return { action: this.oneShot, progress: elapsed / this.duration };
  }
}

/** Everything the cat sprite needs to pick a pose. All fields are optional. */
export interface CatSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  /** The view her facing is drawn in, from `selectFacing` or her own facing state; head-on if absent. */
  readonly facing?: FacingSelection;
  readonly isKnockedOut?: boolean;
  readonly oneShot?: CatOneShotState | null;
  /** Something is carried in her jaws: she walks and stands in her carrying rows. */
  readonly carrying?: boolean;
  /** The swing of the tool she has out: standing, she holds it ready in that swing's opening pose. */
  readonly working?: CatWorkSwing | null;
}

/** Her row for one view, facing east and facing west. A head-on row is the same both ways. */
interface ViewRows {
  readonly east: CatState;
  readonly west: CatState;
}

function bothWays(state: CatState): ViewRows {
  return { east: state, west: state };
}

type DirectionalBase =
  'walk' | 'idle' | 'swipe' | 'cast' | 'chop' | 'mine' | 'carry_walk' | 'carry_idle';

/**
 * Her rows that have a version per view, by view. No row is ever mirrored at
 * runtime: her tortoiseshell coat is not symmetric, so every view she faces
 * west in is a row painted facing west.
 */
const OWN_ROWS: Readonly<Record<DirectionalBase, Readonly<Record<CatRowView, ViewRows>>>> = {
  walk: {
    front: bothWays('walk'),
    side: { east: 'walk_side', west: 'walk_side_west' },
    back: bothWays('walk_away'),
  },
  idle: {
    front: bothWays('idle'),
    side: { east: 'idle_side', west: 'idle_side_west' },
    back: bothWays('idle_away'),
  },
  swipe: {
    front: bothWays('swipe'),
    side: { east: 'swipe_side', west: 'swipe_side_west' },
    back: bothWays('swipe_away'),
  },
  cast: {
    front: bothWays('cast'),
    side: { east: 'cast_side', west: 'cast_side_west' },
    back: bothWays('cast_away'),
  },
  chop: {
    front: bothWays('chop'),
    side: { east: 'chop_side', west: 'chop_side_west' },
    back: bothWays('chop_away'),
  },
  mine: {
    front: bothWays('mine'),
    side: { east: 'mine_side', west: 'mine_side_west' },
    back: bothWays('mine_away'),
  },
  carry_walk: {
    front: bothWays('carry_walk'),
    side: { east: 'carry_walk_side', west: 'carry_walk_side_west' },
    back: bothWays('carry_walk_away'),
  },
  carry_idle: {
    front: bothWays('carry_idle'),
    side: { east: 'carry_idle_side', west: 'carry_idle_side_west' },
    back: bothWays('carry_idle_away'),
  },
};

/** The rows she turns in empty-handed. */
const TURNING_BASES: readonly DirectionalBase[] = ['walk', 'idle', 'swipe', 'cast'];

function viewRowsOf(bases: readonly DirectionalBase[]): CatState[] {
  return [
    ...new Set(
      bases.flatMap((base) =>
        Object.values(OWN_ROWS[base]).flatMap((rows) => [rows.east, rows.west]),
      ),
    ),
  ];
}

function directionalState(base: DirectionalBase, facing: FacingSelection): CatState {
  const rows = OWN_ROWS[base][catRowViewOf(facing.view)];
  return facing.flipX ? rows.west : rows.east;
}

/**
 * Her rows a turn changes, in every view she is drawn in, held warm for as
 * long as she is on screen. Every view rather than the one she faces and its
 * neighbours: a keyboard turns her a quarter or a half turn in one tick, her
 * fur makes her the dearest painter in the game, and a row of hers that is
 * cold when she turns into it is painted directly on the frame she turns.
 */
export const RESIDENT_VIEW_ROWS: readonly CatState[] = viewRowsOf(TURNING_BASES);

/**
 * Her turning rows while she holds something: with a tool out her swing in
 * every view joins them, since she turns to face each new tree or rock; with
 * something in her jaws her carrying walk and idle join them, her own kept
 * so that putting the thing down draws nothing cold.
 */
const RESIDENT_VIEW_ROWS_HOLDING: Readonly<Record<CatHold, readonly CatState[]>> = {
  chop: viewRowsOf([...TURNING_BASES, 'chop']),
  mine: viewRowsOf([...TURNING_BASES, 'mine']),
  carry: viewRowsOf([...TURNING_BASES, 'carry_walk', 'carry_idle']),
};

/** The swing frame she holds her tool ready in between swings. */
const READY_FRAME = 0;
const READY_FRAMES = READY_FRAME + 1;

/**
 * The opening frame of every swing in every view, held warm while her paws
 * are empty: it is the pose she stands in with a tool out, drawn on the tick
 * the tool comes out, before the rest of the swing has had time to bake.
 */
const READY_SPANS: readonly ResidentSpan[] = viewRowsOf(['chop', 'mine']).map((row) => ({
  row,
  frames: READY_FRAMES,
}));

function spansOf(rows: readonly CatState[]): ResidentSpan[] {
  return rows.map((row) => ({ row, frames: FRAME_COUNT[row] }));
}

/** Holds her turning rows warm from every draw of her, menus and flushes included. */
const RESIDENT_VIEWS = new ResidentRows([...spansOf(RESIDENT_VIEW_ROWS), ...READY_SPANS]);

/**
 * Both swings whole in the view she faces, held warm while her paws are
 * empty: she faces a tree or rock as she starts on it, and her first swing
 * comes a beat after the tool does — sooner than a swing's layered cells,
 * two layers each, bake from cold on a slow device.
 */
const FACED_SWINGS: Readonly<Record<CatRowView, Readonly<Record<'east' | 'west', ResidentRows>>>> =
  {
    front: facedSwings('front'),
    side: facedSwings('side'),
    back: facedSwings('back'),
  };

function facedSwings(view: CatRowView): Readonly<Record<'east' | 'west', ResidentRows>> {
  const swings = (way: 'east' | 'west'): ResidentRows =>
    new ResidentRows(spansOf([OWN_ROWS.chop[view][way], OWN_ROWS.mine[view][way]]));
  return { east: swings('east'), west: swings('west') };
}

function facedSwingsFor(facing: FacingSelection): ResidentRows {
  return FACED_SWINGS[catRowViewOf(facing.view)][facing.flipX ? 'west' : 'east'];
}
const RESIDENT_VIEWS_HOLDING: Readonly<Record<CatHold, ResidentRows>> = {
  chop: new ResidentRows(spansOf(RESIDENT_VIEW_ROWS_HOLDING.chop)),
  mine: new ResidentRows(spansOf(RESIDENT_VIEW_ROWS_HOLDING.mine)),
  carry: new ResidentRows(spansOf(RESIDENT_VIEW_ROWS_HOLDING.carry)),
};

/** One cell of the cat crawler's figure: which row, which frame, and whether it is mirrored. */
export interface CatCell {
  readonly state: CatState;
  readonly frame: number;
  readonly flipX: boolean;
}

/**
 * The cell the cat player body shows for `state` right now.
 *
 * Priority runs downed → combat action → idle break → walk → idle, so a swipe
 * or a cast always wins over whatever she was doing to pass the time.
 */
export function catCellFor(state: CatSpriteState = {}): CatCell {
  const {
    walkFrame = 0,
    isMoving = false,
    facing = DEFAULT_FACING_SELECTION,
    isKnockedOut = false,
    oneShot = null,
  } = state;
  const facesLeft = facing.flipX;
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;

  if (isKnockedOut) {
    // The downed pose is profile art whichever way she was facing.
    const key: CatState = facesLeft ? 'knocked_out_west' : 'knocked_out';
    const frame = timeFrameIndex(nowSeconds, KNOCKED_OUT_FPS, FRAME_COUNT[key]);
    return { state: key, frame, flipX: false };
  }

  if (oneShot !== null) {
    // The idle breaks and the level-up dance are only drawn head-on; the combat
    // actions and the work swings have a pose per viewpoint.
    const action = oneShot.action;
    const key: CatState = isDirectional(action) ? directionalState(action, facing) : action;
    return {
      state: key,
      frame: progressFrameIndex(oneShot.progress, FRAME_COUNT[key]),
      flipX: false,
    };
  }

  if (isMoving) {
    const key = directionalState(state.carrying === true ? 'carry_walk' : 'walk', facing);
    return { state: key, frame: walkFrameIndex(walkFrame, FRAME_COUNT[key]), flipX: false };
  }

  const working = state.working ?? null;
  if (working !== null) {
    return { state: directionalState(working, facing), frame: READY_FRAME, flipX: false };
  }

  const key = directionalState(state.carrying === true ? 'carry_idle' : 'idle', facing);
  return {
    state: key,
    frame: timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    flipX: false,
  };
}

const DIRECTIONAL_ONE_SHOTS = ['swipe', 'cast', 'chop', 'mine'] as const satisfies readonly (
  CatOneShot | DirectionalBase
)[];

function isDirectional(action: CatOneShot): action is (typeof DIRECTIONAL_ONE_SHOTS)[number] {
  return DIRECTIONAL_ONE_SHOTS.some((directional) => directional === action);
}

/** What she holds on one draw: the thing's look, which of its pictures, and what she does with it. */
export interface CatHeldDraw {
  readonly look: HeldVisualDef;
  readonly phase: number;
  readonly hold: CatHold;
}

/**
 * Draw the cat player body: the cell {@link catCellFor} picks, or `cell` when
 * the caller already has it, with `held` composited at its socket between
 * the cell's two layers, and `stowed` riding on her back: behind all of her
 * head-on, over her back in profile and from behind.
 */
export function drawCatSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: CatSpriteState = {},
  cell: CatCell = catCellFor(state),
  held: CatHeldDraw | null = null,
  stowed: HeldVisualDef | null = null,
): void {
  if (held === null) {
    RESIDENT_VIEWS.hold(activeFigure);
    facedSwingsFor(state.facing ?? DEFAULT_FACING_SELECTION).hold(activeFigure);
  } else {
    RESIDENT_VIEWS_HOLDING[held.hold].hold(activeFigure);
  }
  const between = held === null ? undefined : catHeldBetween(held, cell);
  const resting = stowed === null ? null : catStowedAt(stowed, cell);
  const opts = { flipX: cell.flipX };
  const drawResting = (): void => {
    if (resting === null) return;
    withFigureCellPlacement(ctx, activeFigure, sx, sy, s, opts, resting.draw);
  };
  if (resting?.behind === true) drawResting();
  drawFigureCached(ctx, activeFigure, cell.state, cell.frame, sx, sy, s, opts, between);
  if (resting?.behind === false) drawResting();
}

/**
 * Over her back, a stowed tool rides with the middle of its haft on her
 * spine, so neither end hangs off her: the grip point is moved this share of
 * the haft's length back from her saddle. Behind her head-on it rides from
 * the saddle up, so its head shows past her shoulder.
 */
const STOWED_HAFT_CENTRING = 0.5;
const STOWED_BEHIND_CENTRING = 0;

/** Where her stowed tool is drawn on the cell being drawn, and whether it is behind her. */
function catStowedAt(
  look: HeldVisualDef,
  cell: CatCell,
): { readonly draw: FigureBetween; readonly behind: boolean } | null {
  const frames = catSocketsAt(activeLook, cell.state, cell.frame);
  if (frames === null) return null;
  const socket = frames.sockets.back;
  const pxPerUnit = catHeldPxPerUnit(look);
  const share = socket.behind ? STOWED_BEHIND_CENTRING : STOWED_HAFT_CENTRING;
  const centring = look.handle.length * share * pxPerUnit;
  return {
    behind: socket.behind,
    draw: (ctx, place) => {
      const centre = {
        x: place.x + (socket.centre.x - socket.axis.x * centring) * place.scale,
        y: place.y + (socket.centre.y - socket.axis.y * centring) * place.scale,
      };
      const transform = heldTransformAt({ ...socket, centre }, place.scale * pxPerUnit, 0);
      compositeHeldItem(ctx, look, transform, 'cached');
    },
  };
}

/** Composites `held` at its socket on the cell being drawn, or nothing where the cell does not hold it. */
function catHeldBetween(held: CatHeldDraw, cell: CatCell): FigureBetween | undefined {
  const frames = catSocketsAt(activeLook, cell.state, cell.frame);
  if (frames === null) return undefined;
  const socket = catHeldSocketOf(held.look, frames);
  if (socket === null) return undefined;
  return (ctx, place) => {
    const centre = {
      x: place.x + socket.centre.x * place.scale,
      y: place.y + socket.centre.y * place.scale,
    };
    const transform = heldTransformAt(
      { ...socket, centre },
      place.scale * catHeldPxPerUnit(held.look),
      held.phase,
    );
    compositeHeldItem(ctx, held.look, transform, 'cached');
  };
}

/** Both missile figures share one set of row names. */
type MissileSpriteVariant = MagicMissileVisualTier | 'sub_missile';

/**
 * The level-10 shrapnel's row. It is not a tier — the shards carry an ability
 * level of 1 so they cannot chain — so it is named here rather than derived
 * from a level.
 */
export const SUB_MISSILE_VARIANT = 'sub_missile';

/**
 * Warms the rows a bolt just launched will draw.
 *
 * A cast is a keypress with no telegraph of its own, so this is the earliest
 * moment anything knows a missile is coming. The bolt itself is drawn on the
 * very next frame and falls back to a direct paint until its row lands; the
 * impact is the row the lead actually buys, because it is a whole flight away
 * and is the more expensive of the two to bake. A level-10 cat's shrapnel is
 * warmed at the same moment for the same reason: its rows are two events away.
 */
export function prewarmMagicMissileCast(level: number, spawnsSubMissiles: boolean): void {
  const tier = getMagicMissileVisualTier(level);
  prewarmFigureState(MAGIC_MISSILE_PROJECTILE_FIGURE, tier);
  prewarmFigureState(MAGIC_MISSILE_EXPLOSION_FIGURE, tier);
  if (!spawnsSubMissiles) return;
  prewarmFigureState(MAGIC_MISSILE_PROJECTILE_FIGURE, SUB_MISSILE_VARIANT);
  prewarmFigureState(MAGIC_MISSILE_EXPLOSION_FIGURE, SUB_MISSILE_VARIANT);
}

/**
 * How fast each tier's bolt cycles its loop. The higher tiers spin faster on
 * purpose: the same braid played at the same rate reads as the same spell with
 * a new palette, and the tempo is half of what sells the escalation.
 */
const MISSILE_ANIM_FPS: Record<MissileSpriteVariant, number> = {
  tier1: 10,
  tier2: 13,
  tier3: 17,
  tier4: 22,
  sub_missile: 17,
};

/**
 * Which side of the cat who cast them a pass of {@link drawMissiles} paints:
 * the missiles further from the camera than her, drawn before her so her body
 * hides them, or the rest, drawn over her.
 */
export type MissileDepthLayer = 'beyond' | 'near';

/**
 * Whether a missile is further from the camera than the cat whose depth line
 * is `depthY`. One just launched sits on the line, so the way it is flying
 * decides: a missile cast away from the camera leaves from behind her.
 */
function missileIsBeyond(missile: Missile, depthY: number): boolean {
  const ahead = missile.y - depthY;
  return ahead < 0 || (ahead === 0 && missile.vy < 0);
}

export function drawMissiles(
  ctx: CanvasRenderingContext2D,
  missiles: Missile[],
  camX: number,
  camY: number,
  s: number,
  EXPLODE_FRAMES: number,
  layer: MissileDepthLayer,
  depthY: number,
): void {
  const now = performance.now() / MILLISECONDS_PER_SECOND;
  const paintBeyond = layer === 'beyond';

  for (const m of missiles) {
    if (missileIsBeyond(m, depthY) !== paintBeyond) continue;
    const mx = m.x - camX;
    const my = m.y - camY;
    // Sub-missiles carry an ability level of 1 so they cannot chain into more
    // sub-missiles, so their level says nothing about how they should look —
    // both figures give them a row of their own.
    const variant: MissileSpriteVariant = m.isSubMissile
      ? SUB_MISSILE_VARIANT
      : getMagicMissileVisualTier(m.abilityLevel);

    if (m.state === 'flying') {
      const rotation = Math.atan2(m.vy, m.vx);
      const frame = timeFrameIndex(
        now,
        MISSILE_ANIM_FPS[variant],
        figureFrameCount(MAGIC_MISSILE_PROJECTILE_FIGURE, variant),
      );
      drawFigureCached(ctx, MAGIC_MISSILE_PROJECTILE_FIGURE, variant, frame, mx, my, s, {
        rotation,
        alpha: missileOpacity(m),
      });
    } else {
      // Explosion — centered on the missile position.
      const progress = 1 - m.explodeTimer / EXPLODE_FRAMES;
      const frame = progressFrameIndex(
        progress,
        figureFrameCount(MAGIC_MISSILE_EXPLOSION_FIGURE, variant),
      );
      drawFigureCached(ctx, MAGIC_MISSILE_EXPLOSION_FIGURE, variant, frame, mx, my, s);
    }
  }
}
