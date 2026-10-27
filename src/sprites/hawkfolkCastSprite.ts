/**
 * Draw wrapper for the Hawkfolk cast. Two very different callers share it:
 * Hawkfolk citizens (`Townsperson`, dispatched through `../creatures/citizenFigure.ts`)
 * play only the idle/walk/talk/work rows; the Cloak & Dagger's dancers play
 * their dance routines; the fightable street-tough `Hawkfolk` mob plays the
 * same rig's run and combat rows (strike, aggro, hurt, death) on one of the
 * four tough looks. Mirrors `ratkinCastSprite.ts`'s contract so both draw
 * through the one shared figure cache the same way.
 */

import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { evenIdleFrameAtSeconds } from './art/human/timing';
import {
  drawFigureCached,
  drawFigureCachedApprox,
  pinFigureState,
  prewarmFigureState,
} from './figure/figureFrameCache';
import { type DrawnFigureRow, figureFrameCount, drawnFigureRow } from './figure/figureDef';
import type { HawkfolkView } from './art/hawkfolk/rig';
import {
  castRow,
  castStateName,
  hawkfolkCastFigure,
  type CastRowRole,
} from './art/hawkfolkCastFigure';
import type { HawkfolkLookId } from './art/hawkfolk/cast';
import { DANCE_FPS, danceStateName, type DanceStyle } from './art/danceStyles';

/** What a Hawkfolk cast member can be doing, as far as the sprite is concerned. */
export type HawkfolkCastAction = CastRowRole;

/** Actions that play once, driven by a 0–1 progress, rather than looping. */
const ONE_SHOT_ACTIONS: ReadonlySet<HawkfolkCastAction> = new Set(['strike', 'hurt', 'death']);

/**
 * Actions only the fightable street mob ever plays, never a citizen. Drawn
 * exact rather than through the crowd's own approximate fallback: a mob's
 * combat rows are never prewarmed ahead of a fight the way a citizen's
 * idle/walk rows are, and a punch that borrows an idle pose because its own
 * frame wasn't warm yet reads as a wrong hit in a fight the player is
 * actively watching — a cost a crowd's own background pose never asks a
 * player to notice.
 */
const COMBAT_ONLY_ACTIONS: ReadonlySet<HawkfolkCastAction> = new Set([
  'strike',
  'aggro',
  'hurt',
  'death',
]);

const LOOP_FPS = 8;
const MS_PER_SECOND = 1000;

/**
 * The frame a clock-driven row of `action` shows `seconds` into its loop. The
 * idle plays once per standing breath, the same breath the human cast beside
 * them takes, rather than at the gesture rate.
 */
export function hawkfolkCastLoopFrame(
  action: HawkfolkCastAction,
  frames: number,
  seconds: number,
): number {
  if (action === 'idle') return evenIdleFrameAtSeconds(seconds, frames);
  return timeFrameIndex(seconds, LOOP_FPS, frames);
}

function facingView(facingX: number, facingY: number): HawkfolkView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'up' : 'down';
}

/**
 * `work` only paints down/side, and a dance always faces the camera (the
 * spin paints its own turn); every other action covers all three views.
 */
function viewFor(action: HawkfolkCastAction, facingX: number, facingY: number): HawkfolkView {
  if (action === 'dance') return 'down';
  const wanted = facingView(facingX, facingY);
  if (action === 'work' && wanted === 'up') return 'down';
  return wanted;
}

/** Everything a Hawkfolk cast member's sprite needs to pick a pose. */
export interface HawkfolkCastSpriteState {
  readonly action: HawkfolkCastAction;
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
export function hawkfolkCastStateFor(
  action: HawkfolkCastAction,
  facingX: number,
  facingY: number,
  danceStyle: DanceStyle = DEFAULT_DANCE_STYLE,
): string {
  if (action === 'dance') return danceStateName(danceStyle);
  return castStateName(action, viewFor(action, facingX, facingY));
}

/** The frame an action's event (a strike's impact) lands on, or `undefined` if the row has none. */
export function hawkfolkCastEventFrame(
  id: HawkfolkLookId,
  action: HawkfolkCastAction,
  facingX: number,
  facingY: number,
  event: 'impact' | 'strike',
): number | undefined {
  return castRow(id, hawkfolkCastStateFor(action, facingX, facingY))?.events?.[event];
}

/**
 * Draws one Hawkfolk cast member, and returns the row drawn, or `undefined`
 * when the look paints nothing for that action. Only the side view is ever
 * mirrored.
 */
export function drawHawkfolkCastSprite(
  ctx: CanvasRenderingContext2D,
  id: HawkfolkLookId,
  sx: number,
  sy: number,
  tileSize: number,
  state: HawkfolkCastSpriteState,
): DrawnFigureRow | undefined {
  const figure = hawkfolkCastFigure(id);
  const view = viewFor(state.action, state.facingX, state.facingY);
  const key = hawkfolkCastStateFor(state.action, state.facingX, state.facingY, state.danceStyle);
  const frames = figureFrameCount(figure, key);
  if (frames === 0) return undefined;
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
    frame = hawkfolkCastLoopFrame(state.action, frames, nowSeconds + loopOffset);
  }
  if (COMBAT_ONLY_ACTIONS.has(state.action)) {
    drawFigureCached(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
  } else {
    drawFigureCachedApprox(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
  }
  return drawnFigureRow(figure, key);
}

/**
 * Rows queued ahead of a cast member's first draw: every facing of `idle` and
 * `walk`. `talk` is left out here for the same reason it is on the human cast
 * — a rare, one-off cost when a player actually opens dialog, not something a
 * whole crowd demands every frame; {@link prewarmAndPinHawkfolkTalk} warms and
 * pins it separately, at the moment a conversation actually opens, never left
 * to the approximate draw path beyond that. Combat rows (`strike`/`aggro`/
 * `hurt`/`death`) are never queued here either; only a look with
 * `fightable: true` declares them, and the fightable street mob warms what it
 * needs on its own terms.
 */
const PREWARM_CAST_ROLES: readonly HawkfolkCastAction[] = ['idle', 'walk'];
const PREWARM_VIEWS: readonly HawkfolkView[] = ['down', 'side', 'up'];

/**
 * Warms a cast member's idle and walk rows in every facing, so a crowd of
 * strangers turning and strolling into view never pays a cold bake on the
 * frame it happens.
 */
export function prewarmHawkfolkCastMember(id: HawkfolkLookId): void {
  const figure = hawkfolkCastFigure(id);
  for (const role of PREWARM_CAST_ROLES) {
    for (const view of PREWARM_VIEWS) {
      prewarmFigureState(figure, castStateName(role, view));
    }
  }
}

/** The rows {@link prewarmHawkfolkCastMember} warms. */
export function hawkfolkCastMemberRows(id: HawkfolkLookId): DrawnFigureRow[] {
  const figure = hawkfolkCastFigure(id);
  return PREWARM_CAST_ROLES.flatMap((role) =>
    PREWARM_VIEWS.map((view) => drawnFigureRow(figure, castStateName(role, view))),
  );
}

/**
 * Warms and pins one cast member's `talk` row in the facing it is about to be
 * drawn in — see `prewarmAndPinTownCastTalk`, the human cast's own
 * equivalent, for why this is called at the moment of freezing into a
 * conversation rather than held with the look's idle and walk rows.
 */
export function prewarmAndPinHawkfolkTalk(
  id: HawkfolkLookId,
  facingX: number,
  facingY: number,
): DrawnFigureRow {
  const figure = hawkfolkCastFigure(id);
  const key = hawkfolkCastStateFor('talk', facingX, facingY);
  // Urgent: a conversation is opening on this exact row right now, not at
  // some eventual point a background warm-up would otherwise get to.
  prewarmFigureState(figure, key, undefined, true);
  pinFigureState(figure, key);
  return drawnFigureRow(figure, key);
}
