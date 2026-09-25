import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import {
  COW_ACTIONS,
  COW_VIEWS_BY_ACTION,
  type CowAction,
  cowFigure,
  cowStateName,
} from './art/cowFigure';
import { COW_AGES, COW_COATS, type CowAge, type CowCoatId, cowFigureId } from './art/cowLooks';
import { COW_GORE_STATES } from './art/cowGore';
import type { CowView } from './art/cowArt';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { COW_GRAZE_FPS, COW_IDLE_FPS } from './cowTiming';

export { COW_AGES, COW_COATS, type CowAge, type CowCoatId, type CowAction };
export {
  CALF_TILES_PER_TROT_CYCLE,
  CALF_TILES_PER_WALK_CYCLE,
  COW_FLINCH_FPS,
  COW_HAPPY_FPS,
  COW_LIE_DOWN_FPS,
  COW_TILES_PER_TROT_CYCLE,
  COW_TILES_PER_WALK_CYCLE,
} from './cowTiming';

/**
 * The eight pieces a cow or calf comes apart into, in the order they spawn. The
 * same list `cowGore.ts` paints, so a rename there is a missing piece here
 * rather than a silent no-op.
 */
export const COW_GORE_PARTS: ReadonlyArray<string> = COW_GORE_STATES;

/**
 * The `BodyPartGoreSystem` registry key a dead cow's pieces come from.
 *
 * One key per coat and age, not one for the species: the pieces wear the coat
 * they came off — a Jersey drops fawn quarters, a Holstein patched ones — and a
 * calf's are painted at a calf's size, so each figure carries its own.
 */
export function cowBodyPartKey(coat: CowCoatId, age: CowAge): string {
  return cowFigureId(coat, age);
}

/** Every registry key {@link cowBodyPartKey} can return. */
export const COW_BODY_PART_KEYS: ReadonlyArray<string> = COW_AGES.flatMap((age) =>
  COW_COATS.map((coat) => cowBodyPartKey(coat, age)),
);

/** Everything the cow sprite needs to pick a cell. */
export interface CowSpriteState {
  readonly coat: CowCoatId;
  readonly age: CowAge;
  readonly action: CowAction;
  readonly facingX?: number;
  readonly facingY?: number;
  /**
   * The gait phase in radians (0–2π) for `walk` and `trot`, advanced by the
   * distance actually covered: `2π / (COW_TILES_PER_WALK_CYCLE * tileSize)`
   * radians per pixel, or the calf and trot equivalents.
   */
  readonly gaitPhase?: number;
  /** 0 at the first frame of a one-shot (`happy`, `flinch`, `lie_down`), 1 at its last. */
  readonly progress?: number;
  /** Seconds on the clock that drives `idle` and `graze`; offset per cow so a herd does not chew in step. */
  readonly clockSeconds?: number;
  readonly alpha?: number;
}

/** Views split on whichever axis the animal is facing hardest along. */
function viewFor(facingX: number, facingY: number): CowView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'back' : 'front';
}

/**
 * The view an action is drawn in. The lying rows have no rear view: a cow lying
 * facing away is drawn in profile, which reads as lying far better than a rump
 * sunk on the grass does.
 */
function drawnView(action: CowAction, view: CowView): CowView {
  return COW_VIEWS_BY_ACTION[action].includes(view) ? view : 'side';
}

/** The state name the sprite asks the figure for, for an action and a facing. */
export function cowStateFor(action: CowAction, facingX: number, facingY: number): string {
  return cowStateName(action, drawnView(action, viewFor(facingX, facingY)));
}

/**
 * Every state `drawCowSprite` can ask a figure for, built from the same tables
 * `cowStateFor` composes from. The art gates feed it to `missingStateFailures`:
 * both draw paths return silently on a state the figure does not paint, so a
 * name only the runtime knows is an invisible cow and no log line.
 */
export const COW_DRAWN_STATES: ReadonlyArray<string> = COW_ACTIONS.flatMap((action) =>
  (['front', 'side', 'back'] as const).map((view) => cowStateName(action, drawnView(action, view))),
).filter((state, index, all) => all.indexOf(state) === index);

/**
 * Draw one cow or calf, standing on the tile whose top-left is (sx, sy).
 *
 * Only the profile is mirrored: flipping a head-on view would swap which ear
 * flicks and which forefoot steps every time the animal turned round.
 */
export function drawCowSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CowSpriteState,
): void {
  const { coat, age, action, facingX = 1, facingY = 0, gaitPhase = 0, progress = 0 } = state;
  const figure = cowFigure(coat, age);
  const view = drawnView(action, viewFor(facingX, facingY));
  const key = cowStateName(action, view);
  const frames = Math.max(1, figureFrameCount(figure, key));
  const flipX = view === 'side' && facingX < 0;
  const clock = state.clockSeconds ?? 0;
  let frame = 0;
  if (action === 'walk' || action === 'trot') frame = walkFrameIndex(gaitPhase, frames);
  else if (action === 'idle') frame = timeFrameIndex(clock, COW_IDLE_FPS, frames);
  else if (action === 'graze') frame = timeFrameIndex(clock, COW_GRAZE_FPS, frames);
  else if (action !== 'lie') frame = progressFrameIndex(progress, frames);
  drawFigureCached(ctx, figure, key, frame, sx, sy, tileSize, { flipX, alpha: state.alpha });
}

/**
 * The rows warmed when a cow's spawn is scheduled, and kept warm while the
 * party is near a herd: the profile walk, idle and graze a pasture cow spends
 * most of its time in.
 *
 * Deliberately not every view of every routine row. A herd can hold all six
 * figures at once, and every view of idle, walk and graze warm for all six is
 * about half the cache's whole fleet budget; this set keeps the herd well
 * inside the share `scripts/gates-cow.ts` holds it to (C11), leaving room in
 * that share for the rows a herd on screen draws at once and for what it
 * warms off its warnings (`src/creatures/Cow.ts`): the happy, flinch, trot and
 * lying rows, and the gore — each only for the states the AI actually enters.
 * The other views of the routine rows bake as they are first drawn.
 */
export const COW_PREWARMED_STATES: ReadonlyArray<string> = [
  cowStateName('walk', 'side'),
  cowStateName('idle', 'side'),
  cowStateName('graze', 'side'),
];

/** Warms the rows a cow about to exist will draw. Call where the spawn is scheduled. */
export function prewarmCow(coat: CowCoatId, age: CowAge): void {
  const figure = cowFigure(coat, age);
  for (const state of COW_PREWARMED_STATES) prewarmFigureState(figure, state);
}

/** Warms one action's rows, off whatever telegraphs it (a player in reach warms `happy`). */
export function prewarmCowAction(coat: CowCoatId, age: CowAge, action: CowAction): void {
  const figure = cowFigure(coat, age);
  for (const view of COW_VIEWS_BY_ACTION[action])
    prewarmFigureState(figure, cowStateName(action, view));
}

/** Warms the gore pieces, which are all requested the frame a cow comes apart. */
export function prewarmCowGore(coat: CowCoatId, age: CowAge): void {
  const figure = cowFigure(coat, age);
  for (const part of COW_GORE_PARTS) prewarmFigureState(figure, part);
}
