/**
 * The crawler signboard's sheet: the board with its lettering, and the arrow as its
 * own one-frame sheet that the tile draw turns to the hallway's bearing. The board
 * fits inside the one tile the sign blocks, so the frame reaches only a sliver
 * below the tile for the shadow. The sign registers no tile type of its own, so
 * `unregisteredDecorationExtents` covers that sliver.
 */

import {
  SIGN_FOOTROOM_TILES,
  SIGN_ARROW_FRAME_TILES,
  drawCrawlerSignArrow,
  drawCrawlerSignBoard,
} from '../art/crawlerSignArt';
import type { PropSheetPlan } from './propSheetPlan';

/** Source pixels per game tile; twice the game's own so the lettering survives the downscale. */
export const CRAWLER_SIGN_TILE_SCALE = 64;

const FRAME_WIDTH = CRAWLER_SIGN_TILE_SCALE;
const FRAME_HEIGHT = CRAWLER_SIGN_TILE_SCALE * (1 + SIGN_FOOTROOM_TILES);
/** The frame's top-left corner is the anchor tile's, so the tile draws with no offset. */
const TILE_X = 0;
const TILE_Y = 0;
/** The arrow's frame is square and its pivot is the frame's middle, so a turn stays inside it. */
const ARROW_FRAME = CRAWLER_SIGN_TILE_SCALE * SIGN_ARROW_FRAME_TILES;

export function dungeonSignSheetPlans(): PropSheetPlan[] {
  return [
    {
      key: 'crawler_sign',
      file: 'crawler_sign.png',
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
      tileX: TILE_X,
      tileY: TILE_Y,
      tileScale: CRAWLER_SIGN_TILE_SCALE,
      rows: [
        {
          state: 'board',
          frames: [
            (ctx, originX, originY) =>
              drawCrawlerSignBoard(ctx, originX, originY, CRAWLER_SIGN_TILE_SCALE),
          ],
        },
      ],
    },
    {
      key: 'crawler_sign_arrow',
      file: 'crawler_sign_arrow.png',
      frameWidth: ARROW_FRAME,
      frameHeight: ARROW_FRAME,
      tileX: ARROW_FRAME / 2,
      tileY: ARROW_FRAME / 2,
      tileScale: CRAWLER_SIGN_TILE_SCALE,
      rows: [
        {
          state: 'arrow',
          frames: [
            (ctx, originX, originY) =>
              drawCrawlerSignArrow(ctx, originX, originY, CRAWLER_SIGN_TILE_SCALE),
          ],
        },
      ],
    },
  ];
}
