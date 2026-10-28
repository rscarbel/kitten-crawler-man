import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import {
  ATTACK_COW_ACTIONS,
  ATTACK_COW_ACTION_VIEWS,
  ATTACK_COW_FIGURE,
  attackCowStateName,
  type AttackCowAction,
} from './art/attackCowFigure';
import type { CowView } from './art/cowArt';
import { type DrawnFigureRow, drawnFigureRow, figureFrameCount } from './figure/figureDef';
import { drawFigureCached, drawFigureFitted, prewarmFigureState } from './figure/figureFrameCache';
import { COW_IDLE_FPS } from './cowTiming';

export type { AttackCowAction };

/** Everything the attack cow's sprite needs to pick a cell. */
export interface AttackCowSpriteState {
  readonly action: AttackCowAction;
  readonly facingX: number;
  readonly facingY: number;
  /**
   * The gait phase in radians (0–2π) for `walk`, `limp` and `charge`, advanced
   * by the ground actually covered.
   */
  readonly gaitPhase: number;
  /** 0 at the first frame of a one-shot, 1 at its last. */
  readonly progress: number;
  /** Seconds on the clock that drives `idle`. */
  readonly clockSeconds: number;
  readonly alpha?: number;
}

/** Views split on whichever axis she is facing hardest along, as the herd's are. */
function viewFor(facingX: number, facingY: number): CowView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'back' : 'front';
}

/** The view an action is drawn in: its own facing if painted, else the profile. */
function drawnView(action: AttackCowAction, view: CowView): CowView {
  return ATTACK_COW_ACTION_VIEWS[action].includes(view) ? view : 'side';
}

/** The state name the sprite asks the figure for, for an action and a facing. */
export function attackCowStateFor(
  action: AttackCowAction,
  facingX: number,
  facingY: number,
): string {
  return attackCowStateName(action, drawnView(action, viewFor(facingX, facingY)));
}

/**
 * Every state {@link drawAttackCowSprite} can ask for, built from the same
 * tables it composes from, for the render harness to hold against the figure.
 */
export const ATTACK_COW_DRAWN_STATES: readonly string[] = ATTACK_COW_ACTIONS.flatMap((action) =>
  (['front', 'side', 'back'] as const).map((view) =>
    attackCowStateName(action, drawnView(action, view)),
  ),
).filter((state, index, all) => all.indexOf(state) === index);

/**
 * Draws her standing on the tile whose top-left is (sx, sy) and returns the
 * row drawn. Only the profile is mirrored, as for the herd.
 */
export function drawAttackCowSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: AttackCowSpriteState,
): DrawnFigureRow {
  const { action, facingX, facingY } = state;
  const view = drawnView(action, viewFor(facingX, facingY));
  const key = attackCowStateName(action, view);
  const frames = Math.max(1, figureFrameCount(ATTACK_COW_FIGURE, key));
  let frame = 0;
  if (action === 'walk' || action === 'limp' || action === 'charge') {
    frame = walkFrameIndex(state.gaitPhase, frames);
  } else if (action === 'idle') {
    frame = timeFrameIndex(state.clockSeconds, COW_IDLE_FPS, frames);
  } else if (action !== 'lie') {
    frame = progressFrameIndex(state.progress, frames);
  }
  drawFigureCached(ctx, ATTACK_COW_FIGURE, key, frame, sx, sy, tileSize, {
    flipX: view === 'side' && facingX < 0,
    alpha: state.alpha,
  });
  return drawnFigureRow(ATTACK_COW_FIGURE, key);
}

/** Her portrait: standing in profile, fitted to the square centred on (cx, cy). */
export function drawAttackCowIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const box = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
  drawFigureFitted(ctx, ATTACK_COW_FIGURE, attackCowStateName('idle', 'side'), 0, box);
}

/** Warms every view of one action's row, off whatever is about to play it. */
export function prewarmAttackCowAction(action: AttackCowAction): void {
  for (const view of ATTACK_COW_ACTION_VIEWS[action]) {
    prewarmFigureState(ATTACK_COW_FIGURE, attackCowStateName(action, view));
  }
}

/**
 * The rows she arrives in and walks with the party in. The fight's rows are
 * warmed by the creature as a fight comes near; the downed and resting rows
 * as she goes down.
 */
export function prewarmAttackCow(): void {
  prewarmAttackCowAction('walk');
  prewarmAttackCowAction('idle');
}
