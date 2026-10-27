/**
 * Draws a Cloak & Dagger NPC (a dancer, a patron, or one of the bar/market
 * station staff) as a figure from the Hawkfolk or human closed-set cast,
 * dispatched by species. The club is a mixed crowd the same way the streets
 * are — this is the one seam that lets `CloakAndDaggerSystem`/`ClubCrowdSystem`
 * hand out either species without caring which cast a given look belongs to.
 */

import { drawHawkfolkCastSprite } from './hawkfolkCastSprite';
import type { HawkfolkLookId } from './art/hawkfolk/cast';
import { WALK_FRAMES as HAWKFOLK_WALK_FRAMES, hawkfolkWalkCyclePx } from './art/hawkfolkCastFigure';
import { WALK_FRAMES as HUMAN_WALK_FRAMES } from './art/townCastFrameCounts';
import type { DanceStyle } from './art/danceStyles';
import { HUMANOID_NPC_SCALE } from './humanoidScale';
import { drawTownCastSprite } from './townCastSprite';
import type { DrawnFigureRow } from './figure/figureDef';
import type { TownCastLook } from './person/townCastLooks';
import { hawkfolkSeatedFigure } from './art/hawkfolkCastFigure';
import { townCastSeatedFigure } from './art/townCastFigure';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { drawnFigureRow, figureFrameCount, type FigureDef } from './figure/figureDef';
import {
  SEAT_POSE_FPS,
  SEAT_POSE_LOOPS,
  SEAT_POSES,
  SEAT_VIEWS,
  seatStateName,
  type SeatPose,
  type SeatView,
} from './art/seatPoses';

export {
  BAR_STOOL_SEAT_HEIGHT_TILES,
  SEAT_POSE_FPS,
  SEAT_POSE_FRAMES,
  SEAT_POSE_LOOPS,
  SEAT_POSES,
  SEAT_POSE_SECONDS,
  type SeatPose,
} from './art/seatPoses';

export type ClubFigureRef =
  | { readonly species: 'hawkfolk'; readonly lookId: HawkfolkLookId }
  | { readonly species: 'human'; readonly look: TownCastLook };

interface ClubFigureBase {
  readonly walkPhase: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly loopOffsetSeconds?: number;
}

/**
 * A figure standing, walking, talking, dancing a routine, or sat on a stool;
 * both casts support every action. `sit` perches the figure on a club bar
 * stool standing on its own tile (the stool is the caller's prop, drawn
 * before the sitter).
 */
export type ClubFigureState =
  | (ClubFigureBase & { readonly action: 'idle' | 'walk' | 'talk' })
  | (ClubFigureBase & {
      readonly action: 'dance';
      /** Which routine the dancer plays. */
      readonly danceStyle: DanceStyle;
    })
  | (ClubFigureBase & {
      readonly action: 'sit';
      /** What the seated figure is doing. */
      readonly seatPose: SeatPose;
      /**
       * Seconds since the current seat pose began, so a one-shot pose plays
       * from its first frame and holds its last. Absent, the pose runs off
       * the page clock offset by `loopOffsetSeconds`, which only suits the
       * looping idle.
       */
      readonly poseSeconds?: number;
    });

type SeatedState = Extract<ClubFigureState, { action: 'sit' }>;

/** World pixels one walk cycle of a club figure covers when drawn at `drawSize`. */
export function clubFigureWalkCyclePx(ref: ClubFigureRef, drawSize: number): number {
  if (ref.species === 'hawkfolk') return hawkfolkWalkCyclePx(ref.lookId, drawSize);
  return ref.look.strideFraction * drawSize * HUMANOID_NPC_SCALE;
}

/** Frames in a club figure's walk row. */
export function clubFigureWalkFrames(ref: ClubFigureRef): number {
  return ref.species === 'hawkfolk' ? HAWKFOLK_WALK_FRAMES : HUMAN_WALK_FRAMES;
}

/** A look's seated figure, or `undefined` for a look with no seated rows (a child). */
export function clubSeatedFigure(ref: ClubFigureRef): FigureDef | undefined {
  return ref.species === 'hawkfolk'
    ? hawkfolkSeatedFigure(ref.lookId)
    : townCastSeatedFigure(ref.look);
}

/** +1 faces right, −1 left, 0 along the vertical; +1 faces the camera, −1 away. */
function seatViewFor(facingX: number, facingY: number): SeatView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'up' : 'down';
}

const MS_PER_SECOND = 1000;

function seatFrame(pose: SeatPose, frames: number, state: SeatedState): number {
  const seconds =
    state.poseSeconds ?? performance.now() / MS_PER_SECOND + (state.loopOffsetSeconds ?? 0);
  const played = Math.max(0, Math.floor(seconds * SEAT_POSE_FPS));
  return SEAT_POSE_LOOPS[pose] ? played % frames : Math.min(played, frames - 1);
}

function drawSeated(
  ctx: CanvasRenderingContext2D,
  ref: ClubFigureRef,
  sx: number,
  sy: number,
  tileSize: number,
  state: SeatedState,
): DrawnFigureRow | undefined {
  const figure = clubSeatedFigure(ref);
  if (figure === undefined) {
    return drawClubCastFigure(ctx, ref, sx, sy, tileSize, {
      action: 'idle',
      walkPhase: state.walkPhase,
      facingX: state.facingX,
      facingY: state.facingY,
      loopOffsetSeconds: state.loopOffsetSeconds,
    });
  }
  const pose = state.seatPose;
  const view = seatViewFor(state.facingX, state.facingY);
  const key = seatStateName(pose, view);
  const frames = figureFrameCount(figure, key);
  if (frames === 0) return undefined;
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(ctx, figure, key, seatFrame(pose, frames, state), sx, sy, tileSize, { flipX });
  return drawnFigureRow(figure, key);
}

/**
 * Queues every seated row of each look, ahead of the club drawing its
 * gamblers: called when the room that seats them is entered.
 */
export function prewarmClubSeatedFigures(refs: Iterable<ClubFigureRef>): void {
  for (const ref of refs) {
    const figure = clubSeatedFigure(ref);
    if (figure === undefined) continue;
    for (const pose of SEAT_POSES) {
      for (const view of SEAT_VIEWS) prewarmFigureState(figure, seatStateName(pose, view));
    }
  }
}

export function drawClubCastFigure(
  ctx: CanvasRenderingContext2D,
  ref: ClubFigureRef,
  sx: number,
  sy: number,
  tileSize: number,
  state: ClubFigureState,
): DrawnFigureRow | undefined {
  if (state.action === 'sit') return drawSeated(ctx, ref, sx, sy, tileSize, state);
  const castState = {
    action: state.action,
    walkPhase: state.walkPhase,
    facingX: state.facingX,
    facingY: state.facingY,
    loopOffsetSeconds: state.loopOffsetSeconds,
    danceStyle: state.action === 'dance' ? state.danceStyle : undefined,
  };
  if (ref.species === 'hawkfolk') {
    return drawHawkfolkCastSprite(ctx, ref.lookId, sx, sy, tileSize, castState);
  }
  return drawTownCastSprite(ctx, ref.look, sx, sy, tileSize, castState);
}
