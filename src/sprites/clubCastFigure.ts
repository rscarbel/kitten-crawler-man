/**
 * Draws a Desperado Club NPC (a dancer, a patron, or one of the bar/market/VIP
 * station staff) as a figure from the skyfowl or human closed-set cast,
 * dispatched by species. The club is a mixed crowd the same way the streets
 * are — this is the one seam that lets `DesperadoClubSystem`/`ClubCrowdSystem`
 * hand out either species without caring which cast a given look belongs to.
 */

import { drawSkyfowlCastSprite } from './skyfowlCastSprite';
import type { SkyfowlLookId } from './art/skyfowl/cast';
import { WALK_FRAMES as SKYFOWL_WALK_FRAMES, skyfowlWalkCyclePx } from './art/skyfowlCastFigure';
import { WALK_FRAMES as HUMAN_WALK_FRAMES } from './art/townCastFrameCounts';
import type { DanceStyle } from './art/danceStyles';
import { HUMANOID_NPC_SCALE } from './humanoidScale';
import { drawTownCastSprite } from './townCastSprite';
import type { TownCastLook } from './person/townCastLooks';

export type ClubFigureRef =
  | { readonly species: 'skyfowl'; readonly lookId: SkyfowlLookId }
  | { readonly species: 'human'; readonly look: TownCastLook };

/** The actions every club figure needs; both casts support this whole set. */
export type ClubFigureAction = 'idle' | 'walk' | 'talk' | 'dance';

export interface ClubFigureState {
  readonly action: ClubFigureAction;
  readonly walkPhase: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly loopOffsetSeconds?: number;
  /** Which routine a dancer plays. */
  readonly danceStyle?: DanceStyle;
}

/** World pixels one walk cycle of a club figure covers when drawn at `drawSize`. */
export function clubFigureWalkCyclePx(ref: ClubFigureRef, drawSize: number): number {
  if (ref.species === 'skyfowl') return skyfowlWalkCyclePx(ref.lookId, drawSize);
  return ref.look.strideFraction * drawSize * HUMANOID_NPC_SCALE;
}

/** Frames in a club figure's walk row. */
export function clubFigureWalkFrames(ref: ClubFigureRef): number {
  return ref.species === 'skyfowl' ? SKYFOWL_WALK_FRAMES : HUMAN_WALK_FRAMES;
}

export function drawClubCastFigure(
  ctx: CanvasRenderingContext2D,
  ref: ClubFigureRef,
  sx: number,
  sy: number,
  tileSize: number,
  state: ClubFigureState,
): void {
  if (ref.species === 'skyfowl') {
    drawSkyfowlCastSprite(ctx, ref.lookId, sx, sy, tileSize, {
      action: state.action,
      walkPhase: state.walkPhase,
      facingX: state.facingX,
      facingY: state.facingY,
      loopOffsetSeconds: state.loopOffsetSeconds,
      danceStyle: state.danceStyle,
    });
    return;
  }
  drawTownCastSprite(ctx, ref.look, sx, sy, tileSize, {
    action: state.action,
    walkPhase: state.walkPhase,
    facingX: state.facingX,
    facingY: state.facingY,
    loopOffsetSeconds: state.loopOffsetSeconds,
    danceStyle: state.danceStyle,
  });
}
