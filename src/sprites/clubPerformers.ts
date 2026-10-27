/**
 * The acts the club's stages put on, one per performer, each drawn from the
 * pole it dances round.
 *
 * A stage only knows where its pole stands and how high its boards are; the
 * act knows where its dancer stands relative to the pole. Every act plants its
 * pole on the same point of the pole's tile — where Angel's cell is anchored,
 * which is the socket painted at the stage's centre — so any act drawn on any
 * stage keeps the pole in the socket and the dancer on the boards.
 */

import type { ClubPerformerId } from '../core/club/clubLayout';
import { CLUB_STAGE_RISER_TILES } from './art/clubStageArt';
import { ANGEL_POLE, angelSequenceFrameAtSeconds } from './art/angelFigure';
import { drawAngelSprite, prewarmAngel } from './angelSprite';
import {
  drawMagnumStage,
  keepMagnumStageWarm,
  magnumPoleBase,
  prewarmMagnumStage,
} from './magnumSprite';

export interface ClubPerformerAct {
  /** Queues every frame of the act for baking, when the room is entered. */
  readonly prewarm: () => void;
  /**
   * Draws the act `seconds` into its loop with the pole's tile top-left at
   * `sx`,`sy`, already raised onto the stage's boards.
   */
  readonly draw: (
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
    seconds: number,
  ) => void;
}

/** The stage's boards stand this many pixels above the floor at a tile size. */
export function clubStageLiftPx(tileSize: number): number {
  return CLUB_STAGE_RISER_TILES * tileSize;
}

export const CLUB_PERFORMER_ACTS: Readonly<Record<ClubPerformerId, ClubPerformerAct>> = {
  // Angel dances round her own pole inside her cell, which is anchored on it.
  angel: {
    prewarm: prewarmAngel,
    draw: (ctx, sx, sy, tileSize, seconds) =>
      drawAngelSprite(ctx, sx, sy, tileSize, angelSequenceFrameAtSeconds(seconds)),
  },
  // Magnum's act is anchored on his home tile with the pole a step off his
  // ground point, so his home is placed wherever puts that pole on the socket.
  magnum: {
    prewarm: prewarmMagnumStage,
    draw: (ctx, sx, sy, tileSize, seconds) => {
      keepMagnumStageWarm(seconds);
      const poleFromHome = magnumPoleBase(0, 0, tileSize);
      const homeX = sx + ANGEL_POLE.centreInTileX * tileSize - poleFromHome.x;
      const homeY = sy + ANGEL_POLE.floorInTileY * tileSize - poleFromHome.y;
      drawMagnumStage(ctx, homeX, homeY, tileSize, seconds);
    },
  },
};
