/**
 * Draw wrapper for the human cast: picks a state name from a look's figure and
 * a frame from the caller's own walk phase or clock, and draws it through the
 * shared figure cache. Mirrors `ratkinCastSprite.ts`'s contract so a later
 * species-dispatched figure (skyfowl) can present the same shape.
 */

import { walkFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import {
  drawFigureCached,
  drawFigureCachedApprox,
  pinFigureState,
  prewarmFigureState,
} from './figure/figureFrameCache';
import { type DrawnFigureRow, figureFrameCount, drawnFigureRow } from './figure/figureDef';
import {
  ALL_TOWN_CAST_VIEWS,
  townCastOutfitFigure,
  townCastStateName,
  type TownCastRowRole,
  type TownCastView,
  WORK_TOWN_CAST_VIEWS,
} from './art/townCastFigure';
import type { TownCastLook } from './person/townCastLooks';
import { DANCE_FPS, danceStateName, type DanceStyle } from './art/danceStyles';

/** What a citizen can be doing, as far as the sprite is concerned. */
export type TownCastAction = 'idle' | 'walk' | 'talk' | 'work' | 'dance';

const LOOP_FPS = 8;
const MS_PER_SECOND = 1000;

function loopFrameIndex(frames: number, loopOffsetSeconds: number, nowSeconds: number): number {
  return timeFrameIndex(nowSeconds + loopOffsetSeconds, LOOP_FPS, frames);
}

/** +1 faces right, −1 left, 0 along the vertical axis; +1 faces the camera, −1 away. */
function viewFor(
  action: TownCastAction,
  look: TownCastLook,
  facingX: number,
  facingY: number,
): TownCastView {
  // A dance is baked facing the camera; the spin paints its own turn.
  if (action === 'dance' && look.hasDance === true) return 'down';
  const wanted: TownCastView =
    Math.abs(facingY) <= Math.abs(facingX) ? 'side' : facingY < 0 ? 'up' : 'down';
  if (action !== 'work') return wanted;
  const views = look.hasWork ? WORK_TOWN_CAST_VIEWS : ALL_TOWN_CAST_VIEWS;
  return views.includes(wanted) ? wanted : 'down';
}

/** Everything a citizen's sprite needs to pick a pose. */
export interface TownCastSpriteState {
  readonly action: TownCastAction;
  /** Walk-cycle position in strides, wrapped to one cycle. */
  readonly walkPhase: number;
  readonly facingX: number;
  readonly facingY: number;
  /** Phase offset for the clock-driven loops, so a crowd doesn't breathe in lockstep. */
  readonly loopOffsetSeconds?: number;
  /** Which routine a `dance` plays; a dancer look paints every one. */
  readonly danceStyle?: DanceStyle;
}

/** The routine a dancer plays when the caller names none. */
const DEFAULT_DANCE_STYLE: DanceStyle = 'pump';

/** The state name this wrapper draws for a look's action in a facing. */
export function townCastStateFor(
  action: TownCastAction,
  look: TownCastLook,
  facingX: number,
  facingY: number,
  danceStyle: DanceStyle = DEFAULT_DANCE_STYLE,
): string {
  if (action === 'dance' && look.hasDance === true) return danceStateName(danceStyle);
  const role: TownCastRowRole =
    action === 'work' && !look.hasWork
      ? 'idle'
      : action === 'dance' && look.hasDance !== true
        ? 'idle'
        : action;
  return townCastStateName(role, viewFor(action, look, facingX, facingY));
}

/**
 * Draws one citizen, and returns the row drawn, or `undefined` when the look
 * paints nothing for that action. Only the side view is ever mirrored.
 *
 * `approx` opts into the crowd's own tolerance for a stand-in pose instead of
 * a render-path bake — right for the many near-identical strangers a street
 * cohort draws, wrong for a named, closely-watched figure (the Desperado
 * Club's dancers, a boss room's lab scientist) where the exact pose is worth
 * paying for. Defaults to exact so every caller that doesn't ask for it keeps
 * today's behaviour.
 */
export function drawTownCastSprite(
  ctx: CanvasRenderingContext2D,
  look: TownCastLook,
  sx: number,
  sy: number,
  tileSize: number,
  state: TownCastSpriteState,
  approx = false,
): DrawnFigureRow | undefined {
  const figure = townCastOutfitFigure(look);
  const view = viewFor(state.action, look, state.facingX, state.facingY);
  const key = townCastStateFor(state.action, look, state.facingX, state.facingY, state.danceStyle);
  const frames = figureFrameCount(figure, key);
  if (frames === 0) return undefined;
  const flipX = view === 'side' && state.facingX < 0;

  const nowSeconds = performance.now() / MS_PER_SECOND;
  const loopOffset = state.loopOffsetSeconds ?? 0;
  let frame: number;
  if (state.action === 'walk') frame = walkFrameIndex(state.walkPhase, frames);
  else if (key === danceStateName(state.danceStyle ?? DEFAULT_DANCE_STYLE)) {
    frame = timeFrameIndex(nowSeconds + loopOffset, DANCE_FPS, frames);
  } else frame = loopFrameIndex(frames, loopOffset, nowSeconds);

  if (approx) drawFigureCachedApprox(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
  else drawFigureCached(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
  return drawnFigureRow(figure, key);
}

/**
 * Rows queued ahead of a citizen's first draw: every facing of `idle` and
 * `walk`, the two actions the strolling crowd spends nearly all its time in.
 * `talk` is left out here on purpose — it is a rare, one-off cost rather than
 * something dozens of citizens demand every frame, so it never competes with
 * the crowd-wide prewarm for the same time-sliced bake budget. It is warmed
 * and pinned separately, by {@link prewarmAndPinTownCastTalk}, at the moment a
 * player actually opens dialog with that citizen — never left to the
 * approximate draw path permanently, only until that call's row lands.
 */
const PREWARM_CITIZEN_ROLES: readonly TownCastRowRole[] = ['idle', 'walk'];

/**
 * Warms a citizen look's idle and walk rows in every facing, so a crowd of
 * strangers turning and strolling into view never pays a cold bake on the
 * frame it happens — the cost lands on the prewarm queue's own time-sliced
 * budget instead.
 */
export function prewarmTownCastLook(look: TownCastLook): void {
  const figure = townCastOutfitFigure(look);
  for (const role of PREWARM_CITIZEN_ROLES) {
    for (const view of ALL_TOWN_CAST_VIEWS) {
      prewarmFigureState(figure, townCastStateName(role, view));
    }
  }
}

/**
 * Exempts a citizen look's idle and walk rows from the cache's idle-release
 * sweep, for a scene that keeps its own crowd on screen for as long as it is
 * active and would rather hold the memory than pay a rebake for a look one
 * or two citizens rarely turn to face away from the camera in.
 */
export function pinTownCastLook(look: TownCastLook): void {
  const figure = townCastOutfitFigure(look);
  for (const role of PREWARM_CITIZEN_ROLES) {
    for (const view of ALL_TOWN_CAST_VIEWS) {
      pinFigureState(figure, townCastStateName(role, view));
    }
  }
}

/**
 * Warms and pins one look's `talk` row in the facing it is about to be drawn
 * in — the row `pinTownCastLook` deliberately leaves lazy, called instead the
 * moment a citizen is actually frozen into a conversation. The row bakes
 * within the next frame or two on the ordinary prewarm queue; until it lands,
 * `drawTownCastSprite`'s own approximate path covers the gap the same way it
 * does for anything else not yet warm — never a permanent stand-in, since
 * this is what gets it baked and pinned in the first place.
 */
export function prewarmAndPinTownCastTalk(
  look: TownCastLook,
  facingX: number,
  facingY: number,
): void {
  const figure = townCastOutfitFigure(look);
  const key = townCastStateFor('talk', look, facingX, facingY);
  // Urgent: a conversation is opening on this exact row right now, not at
  // some eventual point a background warm-up would otherwise get to.
  prewarmFigureState(figure, key, undefined, true);
  pinFigureState(figure, key);
}
