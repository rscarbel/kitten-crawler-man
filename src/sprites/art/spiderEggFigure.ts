/**
 * The spider egg's figure: four rows around one small, centred cell.
 *
 * The egg is anchored at the middle of its tile, like the spit puddle, because
 * it is placed by where it lies rather than by a pair of feet.
 */

import { figureStates, type FigureDef } from '../figure/figureDef';
import { drawSpiderEgg, SPIDER_EGG_FRAMES, type SpiderEggState } from './spiderEggArt';

/**
 * A tile and a half of padding round the tile: the hatch's goo spray and the
 * destroyed decal both reach about two and a half egg radii out.
 */
const FRAME_SIZE = 128;
const TILE_OFFSET = 32;
const TILE_SCALE = 64;
const TILE_CENTRE = TILE_OFFSET + TILE_SCALE / 2;

const EGG_STATES: readonly SpiderEggState[] = ['land', 'incubate', 'hatch', 'destroyed'];

function isEggState(state: string): state is SpiderEggState {
  return EGG_STATES.some((known) => known === state);
}

export const SPIDER_EGG_FIGURE: FigureDef = {
  id: 'spider_egg',
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  tileX: TILE_OFFSET,
  tileY: TILE_OFFSET,
  tileScale: TILE_SCALE,
  states: figureStates(SPIDER_EGG_FRAMES),
  paintFrame: (ctx, state, frame) => {
    if (!isEggState(state)) return;
    drawSpiderEgg(ctx, TILE_CENTRE, TILE_CENTRE, TILE_SCALE, state, frame);
  },
};

export { EGG_STATES as SPIDER_EGG_STATES };
