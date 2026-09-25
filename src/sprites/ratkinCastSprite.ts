/**
 * Draw wrapper for the Briar Hollow ratkin cast.
 *
 * Picks a row from what the villager is doing and which way they face, and a
 * frame from how far they have walked (locomotion) or from the clock (loops).
 * Rows are chosen by their role in `ratkinCastFigure.ts`'s table, never by
 * assembling a name the figure might not paint: `castStateName` is the one
 * place a role and a view become a state name, and the art gates hold every
 * name this wrapper can produce against what each figure actually paints.
 */

import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import type { RatKinView } from './art/ratKinArt';
import { RATKIN_BUILDS } from './art/ratkin/outfit';
import {
  RATKIN_CAST_IDS,
  RATKIN_CAST_OUTFITS,
  type RatkinCastId,
  type RatkinSoldierId,
  isRatkinSoldier,
} from './art/ratkin/cast';
import {
  type CastRowRole,
  RATKIN_WORK_MOTIONS,
  castStateName,
  ratkinCastFigure,
  ratkinCastRow,
} from './art/ratkinCastFigure';
import { RAT_KIN_TILES_PER_WALK_CYCLE } from './ratKinSprite';

/** What a cast member can be doing, as far as the sprite is concerned. */
export type RatkinCastAction =
  'idle' | 'walk' | 'talk' | 'work' | 'cower' | 'strike' | 'hurt' | 'down' | 'rise';

/** Actions that play once, driven by a 0–1 progress, rather than looping. */
const ONE_SHOT_ACTIONS: ReadonlySet<RatkinCastAction> = new Set(['strike', 'hurt', 'down', 'rise']);

/** The views each action is painted in. Work and talk are front and side only; cowering is front only. */
const ACTION_VIEWS: Readonly<Record<RatkinCastAction, readonly RatKinView[]>> = {
  idle: ['front', 'side', 'away'],
  walk: ['front', 'side', 'away'],
  talk: ['front', 'side'],
  work: ['front', 'side'],
  cower: ['front'],
  strike: ['front', 'side', 'away'],
  hurt: ['front', 'side', 'away'],
  down: ['front', 'side', 'away'],
  rise: ['front', 'side', 'away'],
};

/** Which actions a cast member's figure paints at all. */
export function ratkinCastActions(id: RatkinCastId): readonly RatkinCastAction[] {
  const actions: RatkinCastAction[] = ['idle', 'walk', 'talk'];
  if (RATKIN_WORK_MOTIONS[id] !== undefined) actions.push('work');
  if (isRatkinSoldier(id)) actions.push('strike', 'hurt', 'down', 'rise');
  else actions.push('cower');
  return actions;
}

/** Everything a cast member's sprite needs to pick a pose. */
export interface RatkinCastSpriteState {
  readonly action: RatkinCastAction;
  /** Walk-cycle angle in radians, advanced by the ground covered. */
  readonly walkPhase: number;
  /** +1 faces right, −1 left, 0 while facing along the vertical axis. */
  readonly facingX: number;
  /** +1 faces the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /** 0–1 through a one-shot action (strike, hurt, down, rise); ignored by loops. */
  readonly progress?: number;
  /**
   * Phase offset for the clock-driven loops, so two villagers side by side do
   * not breathe and stir in lockstep.
   */
  readonly loopOffsetSeconds?: number;
}

/** Loop speed for the clock-driven rows. */
const LOOP_FPS = 8;
const MS_PER_SECOND = 1000;

function facingView(facingX: number, facingY: number): RatKinView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * The view an action is drawn in: the facing's own view when the action has
 * it, else the nearest one it does have — a villager talking with his back to
 * the camera turns to face it, and one cowering always does.
 */
function viewFor(action: RatkinCastAction, facingX: number, facingY: number): RatKinView {
  const wanted = facingView(facingX, facingY);
  const views = ACTION_VIEWS[action];
  if (views.includes(wanted)) return wanted;
  return views.includes('front') ? 'front' : views[0];
}

/** The state name the wrapper draws for an action in a facing. */
export function ratkinCastStateFor(
  action: RatkinCastAction,
  facingX: number,
  facingY: number,
): string {
  const role: CastRowRole = action;
  return castStateName(role, viewFor(action, facingX, facingY));
}

/**
 * Every state name this wrapper can ask `id`'s figure for, built from the
 * actions that figure has and the views each action is drawn in. The gates
 * hold this list against what the figure paints.
 */
export function ratkinCastDrawnStates(id: RatkinCastId): string[] {
  return ratkinCastActions(id).flatMap((action) =>
    ACTION_VIEWS[action].map((view) => castStateName(action, view)),
  );
}

/**
 * Ground one walk cycle covers for this cast member, in tiles. Mordecai's gait
 * at his size, scaled by the build: a child's legs are three quarters as long,
 * so three quarters of the ground per cycle, and pacing the cycle by distance
 * with anything else makes the feet skate.
 */
export function ratkinCastTilesPerWalkCycle(id: RatkinCastId): number {
  return RAT_KIN_TILES_PER_WALK_CYCLE * RATKIN_BUILDS[RATKIN_CAST_OUTFITS[id].build].scale;
}

/**
 * The frame of a row on which an event lands — the spear's impact, the
 * hammer's strike — or undefined when the row has no such event.
 */
export function ratkinCastEventFrame(
  id: RatkinCastId,
  action: RatkinCastAction,
  facingX: number,
  facingY: number,
  event: 'impact' | 'strike',
): number | undefined {
  return ratkinCastRow(id, ratkinCastStateFor(action, facingX, facingY))?.events?.[event];
}

/**
 * Draws one cast member. Only the profile is mirrored: flipping a head-on
 * view would swap the side a satchel or a sash is worn on every time they
 * turned round.
 */
export function drawRatkinCastSprite(
  ctx: CanvasRenderingContext2D,
  id: RatkinCastId,
  sx: number,
  sy: number,
  tileSize: number,
  state: RatkinCastSpriteState,
): void {
  const figure = ratkinCastFigure(id);
  const view = viewFor(state.action, state.facingX, state.facingY);
  const key = castStateName(state.action, view);
  const frames = figureFrameCount(figure, key);
  if (frames === 0) return;
  const flipX = view === 'side' && state.facingX < 0;

  let frame: number;
  if (state.action === 'walk') {
    frame = walkFrameIndex(state.walkPhase, frames);
  } else if (ONE_SHOT_ACTIONS.has(state.action)) {
    frame = progressFrameIndex(state.progress ?? 0, frames);
  } else {
    const seconds = performance.now() / MS_PER_SECOND + (state.loopOffsetSeconds ?? 0);
    frame = timeFrameIndex(seconds, LOOP_FPS, frames);
  }
  drawFigureCached(ctx, figure, key, frame, sx, sy, tileSize, { flipX });
}

/**
 * The rows a cast member is about to play when the party arrives: standing at
 * their post, and — for a worker — working at it. Head-on only; the side and
 * away rows bake on first use under the frame budget.
 */
export function ratkinCastArrivalStates(id: RatkinCastId): string[] {
  const states = [castStateName('idle', 'front')];
  if (RATKIN_WORK_MOTIONS[id] !== undefined) states.push(castStateName('work', 'front'));
  return states;
}

/** Queues one cast member's arrival rows with the cache's paced prewarm. */
export function prewarmRatkinCastMember(id: RatkinCastId): void {
  const figure = ratkinCastFigure(id);
  for (const state of ratkinCastArrivalStates(id)) prewarmFigureState(figure, state);
}

/** A soldier's fight rows: the thrust, the flinch, the fall and the rise. */
const SOLDIER_FIGHT_ACTIONS: readonly RatkinCastAction[] = ['strike', 'hurt', 'down', 'rise'];

/**
 * Queues a soldier's fight rows, head-on, with the cache's paced prewarm —
 * asked for when the soldier first engages, so the thrust that follows is
 * not a cold bake mid-swing. The side and away views bake on first use.
 */
export function prewarmRatkinSoldierFight(id: RatkinSoldierId): void {
  const figure = ratkinCastFigure(id);
  for (const action of SOLDIER_FIGHT_ACTIONS) {
    prewarmFigureState(figure, castStateName(action, 'front'));
  }
}

/** Every cast id, re-exported for callers that warm the whole village. */
export const RATKIN_CAST_PREWARM_ORDER: readonly RatkinCastId[] = RATKIN_CAST_IDS;
