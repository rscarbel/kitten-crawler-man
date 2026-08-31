/**
 * Which pictures the Over City's own signage carries.
 *
 * Art that is only ever correct in *this* town. A fingerpost reading "Market
 * Plaza" is a picture of a place, not a piece of street furniture: hang it in a
 * second town and it points at somewhere that does not exist. Everything
 * reusable — the lamps, the hanging shop signs, the gateways, the bunting — is
 * planned in `townscapeSheets.ts` instead, and that split is the whole reason
 * these are two modules. A later town adds a sibling here, and the townscape set
 * stays the size it is.
 *
 * Text is painted here, which is what makes these sheets town-specific in the
 * first place: `drawSignpost` sizes each arm by measuring its label, so the arm
 * lengths are a property of the words — and, now that the game paints them
 * rather than loading them, of the font the player's browser resolves. The frame
 * is sized generously for exactly that reason.
 */

import { drawFortuneTeller } from '../townFixtures';
import { drawSignpost } from '../townWayfinding';
import { PLANNED_SIGNPOSTS } from '../../systems/townDecorPlan';
import { TOWNSCAPE_TILE_SCALE } from './townscapeSheets';
import type { FrameEdge, PropSheetPlan } from './propSheetPlan';

const ANCHOR_TILE = 1;

/**
 * The post rises 1.9 tiles above its anchor. Its arms are as long as their
 * labels, and the longest in the town reaches about 2.6 tiles from the post's
 * centre line, so three tiles either side clears every arm with room over.
 *
 * Generous on purpose: an arm is sized by `measureText`, so a font substitution
 * changes its length, and a frame too small to hold the result would clip the
 * end off a word permanently.
 */
const SIGNPOST_UP_TILES = 2.4;
const SIGNPOST_SIDE_TILES = 3;

/**
 * Madame Voss sits wholly inside her own tile — her widest measure is the robe
 * hem at 0.84 of a tile — so the margin only has to clear the `shadowBlur` halos
 * on her eyes and her orb.
 */
const SEER_MARGIN_TILES = 0.5;

const px = (tiles: number): number => Math.ceil(tiles * TOWNSCAPE_TILE_SCALE);

/**
 * One frame per planned post, in the order `PLANNED_SIGNPOSTS` declares them —
 * which is the order `TownDecorSystem` places them, so a post's index is its
 * frame.
 */
function signpostSheet(): PropSheetPlan {
  return {
    key: 'over_city_signpost',
    file: 'signpost.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(SIGNPOST_SIDE_TILES),
    tileY: px(SIGNPOST_UP_TILES),
    frameWidth: px(SIGNPOST_SIDE_TILES) * 2,
    frameHeight: px(SIGNPOST_UP_TILES) + px(ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: PLANNED_SIGNPOSTS.map((planned) => (ctx, originX, originY) => {
          drawSignpost(ctx, originX, originY, TOWNSCAPE_TILE_SCALE, planned.arms);
        }),
      },
    ],
  };
}

/**
 * Madame Voss, in one frame — she is a named person rather than a piece of
 * street furniture, so she belongs to this town the way its fingerposts do, and
 * she has no animation at all: her glows are `shadowBlur` on fixed geometry.
 */
function fortuneTellerSheet(): PropSheetPlan {
  return {
    key: 'over_city_fortune_teller',
    file: 'fortune_teller.png',
    tileScale: TOWNSCAPE_TILE_SCALE,
    tileX: px(SEER_MARGIN_TILES),
    tileY: px(SEER_MARGIN_TILES),
    frameWidth: px(SEER_MARGIN_TILES * 2 + ANCHOR_TILE),
    frameHeight: px(SEER_MARGIN_TILES * 2 + ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: [
          (ctx, originX, originY) => {
            drawFortuneTeller(ctx, originX, originY, TOWNSCAPE_TILE_SCALE);
          },
        ],
      },
    ],
  };
}

/** The Over City's own signage sheets. */
/**
 * The edge the fingerpost stands on rather than is sheared by.
 *
 * The post's foot and its ground shadow press against the bottom row of its
 * frame, because that row is its anchor tile. Every other edge is slack the arms
 * may not use up — and the arms are sized by measuring their labels, so that
 * slack is what absorbs a font the game did not expect.
 */
export const OVER_CITY_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['bottom']);

export function overCitySheetPlans(): PropSheetPlan[] {
  return [signpostSheet(), fortuneTellerSheet()];
}
