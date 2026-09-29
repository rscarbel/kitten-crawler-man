/**
 * Draw wrapper for the skyfowl cast. Two very different callers share it:
 * skyfowl citizens (`Townsperson`, dispatched through `../creatures/citizenFigure.ts`)
 * play only the idle/walk/talk/work rows; the Desperado Club's dancers play
 * their dance routines; the fightable street-tough `SkyFowl` mob plays the
 * same rig's run and combat rows (strike, aggro, hurt, death) on one of the
 * four tough looks. Mirrors `ratkinCastSprite.ts`'s contract so both draw
 * through the one shared figure cache the same way.
 */

import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import {
  drawFigureCached,
  drawFigureCachedApprox,
  pinFigureState,
  prewarmFigureState,
} from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import type { SkyfowlView } from './art/skyfowl/rig';
import {
  castRow,
  castStateName,
  skyfowlCastFigure,
  type CastRowRole,
} from './art/skyfowlCastFigure';
import type { SkyfowlLookId } from './art/skyfowl/cast';
import { DANCE_FPS, danceStateName, type DanceStyle } from './art/danceStyles';

/** What a skyfowl cast member can be doing, as far as the sprite is concerned. */
export type SkyfowlCastAction = CastRowRole;

/** Actions that play once, driven by a 0–1 progress, rather than looping. */
const ONE_SHOT_ACTIONS: ReadonlySet<SkyfowlCastAction> = new Set(['strike', 'hurt', 'death']);

/**
 * Actions only the fightable street mob ever plays, never a citizen. Drawn
 * exact rather than through the crowd's own approximate fallback: a mob's
 * combat rows are never prewarmed ahead of a fight the way a citizen's
 * idle/walk rows are, and a punch that borrows an idle pose because its own
 * frame wasn't warm yet reads as a wrong hit in a fight the player is
 * actively watching — a cost a crowd's own background pose never asks a
 * player to notice.
 */
const COMBAT_ONLY_ACTIONS: ReadonlySet<SkyfowlCastAction> = new Set([
  'strike',
  'aggro',
  'hurt',
  'death',
]);

const LOOP_FPS = 8;
const MS_PER_SECOND = 1000;

function loopFrameIndex(frames: number, loopOffsetSeconds: number, nowSeconds: number): number {
  return timeFrameIndex(nowSeconds + loopOffsetSeconds, LOOP_FPS, frames);
}

function facingView(facingX: number, facingY: number): SkyfowlView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'up' : 'down';
}

/**
 * `work` only paints down/side, and a dance always faces the camera (the
 * spin paints its own turn); every other action covers all three views.
 */
function viewFor(action: SkyfowlCastAction, facingX: number, facingY: number): SkyfowlView {
  if (action === 'dance') return 'down';
  const wanted = facingView(facingX, facingY);
  if (action === 'work' && wanted === 'up') return 'down';
  return wanted;
}

/** Everything a skyfowl cast member's sprite needs to pick a pose. */
export interface SkyfowlCastSpriteState {
  readonly action: SkyfowlCastAction;
  /** Walk-cycle position, advanced by ground covered. */
  readonly walkPhase: number;
  /** +1 faces right, −1 left, 0 while facing along the vertical axis. */
  readonly facingX: number;
  /** +1 faces the camera (down), −1 away (up), 0 neither. */
  readonly facingY: number;
  /** 0–1 through a one-shot action (strike, hurt, death); ignored by loops. */
  readonly progress?: number;
  /** Phase offset for the clock-driven loops, so a crowd doesn't move in lockstep. */
  readonly loopOffsetSeconds?: number;
  /** Which routine a `dance` plays; a dancer look paints every one. */
  readonly danceStyle?: DanceStyle;
}

/** The routine a dancer plays when the caller names none. */
const DEFAULT_DANCE_STYLE: DanceStyle = 'pump';

/** The state name this wrapper draws for an action in a facing. */
export function skyfowlCastStateFor(
  action: SkyfowlCastAction,
  facingX: number,
  facingY: number,
  danceStyle: DanceStyle = DEFAULT_DANCE_STYLE,
): string {
  if (action === 'dance') return danceStateName(danceStyle);
  return castStateName(action, viewFor(action, facingX, facingY));
}

/** The frame an action's event (a strike's impact) lands on, or `undefined` if the row has none. */
export function skyfowlCastEventFrame(
  id: SkyfowlLookId,
  action: SkyfowlCastAction,
  facingX: number,
  facingY: number,
  event: 'impact' | 'strike',
): number | undefined {
  return castRow(id, skyfowlCastStateFor(action, facingX, facingY))?.events?.[event];
}

/** Draws one skyfowl cast member. Only the side view is ever mirrored. */
export function drawSkyfowlCastSprite(
  ctx: CanvasRenderingContext2D,
  id: SkyfowlLookId,
  sx: number,
  sy: number,
  tileSize: number,
  state: SkyfowlCastSpriteState,
): void {
  const figure = skyfowlCastFigure(id);
  const view = viewFor(state.action, state.facingX, state.facingY);
  const key = skyfowlCastStateFor(state.action, state.facingX, state.facingY, state.danceStyle);
  const frames = figureFrameCount(figure, key);
  if (frames === 0) return;
  const flipX = view === 'side' && state.facingX < 0;

  const nowSeconds = performance.now() / MS_PER_SECOND;
  const loopOffset = state.loopOffsetSeconds ?? 0;
  let frame: number;
  if (state.action === 'walk' || state.action === 'run') {
    frame = walkFrameIndex(state.walkPhase, frames);
  } else if (ONE_SHOT_ACTIONS.has(state.action)) {
    frame = progressFrameIndex(state.progress ?? 0, frames);
  } else if (state.action === 'dance') {
    frame = timeFrameIndex(nowSeconds + loopOffset, DANCE_FPS, frames);
  } else {
    frame = loopFrameIndex(frames, loopOffset, nowSeconds);
  }
  if (COMBAT_ONLY_ACTIONS.has(state.action)) {
    drawFigureCached(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
    return;
  }
  drawFigureCachedApprox(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
}

/**
 * Rows queued ahead of a cast member's first draw: every facing of `idle` and
 * `walk`. `talk` is left out here for the same reason it is on the human cast
 * — a rare, one-off cost when a player actually opens dialog, not something a
 * whole crowd demands every frame; {@link prewarmAndPinSkyfowlTalk} warms and
 * pins it separately, at the moment a conversation actually opens, never left
 * to the approximate draw path beyond that. Combat rows (`strike`/`aggro`/
 * `hurt`/`death`) are never queued here either; only a look with
 * `fightable: true` declares them, and the fightable street mob warms what it
 * needs on its own terms.
 */
const PREWARM_CAST_ROLES: readonly SkyfowlCastAction[] = ['idle', 'walk'];
const PREWARM_VIEWS: readonly SkyfowlView[] = ['down', 'side', 'up'];

/**
 * Warms a cast member's idle and walk rows in every facing, so a crowd of
 * strangers turning and strolling into view never pays a cold bake on the
 * frame it happens.
 */
export function prewarmSkyfowlCastMember(id: SkyfowlLookId): void {
  const figure = skyfowlCastFigure(id);
  for (const role of PREWARM_CAST_ROLES) {
    for (const view of PREWARM_VIEWS) {
      prewarmFigureState(figure, castStateName(role, view));
    }
  }
}

/**
 * Exempts a cast member's idle and walk rows from the cache's idle-release
 * sweep — see `pinTownCastLook`, the human cast's own equivalent, for why.
 */
export function pinSkyfowlCastMember(id: SkyfowlLookId): void {
  const figure = skyfowlCastFigure(id);
  for (const role of PREWARM_CAST_ROLES) {
    for (const view of PREWARM_VIEWS) {
      pinFigureState(figure, castStateName(role, view));
    }
  }
}

/**
 * Warms and pins one cast member's `talk` row in the facing it is about to be
 * drawn in — see `prewarmAndPinTownCastTalk`, the human cast's own
 * equivalent, for why this is called at the moment of freezing into a
 * conversation rather than folded into `pinSkyfowlCastMember`.
 */
export function prewarmAndPinSkyfowlTalk(
  id: SkyfowlLookId,
  facingX: number,
  facingY: number,
): void {
  const figure = skyfowlCastFigure(id);
  const key = skyfowlCastStateFor('talk', facingX, facingY);
  // Urgent: a conversation is opening on this exact row right now, not at
  // some eventual point a background warm-up would otherwise get to.
  prewarmFigureState(figure, key, undefined, true);
  pinFigureState(figure, key);
}
