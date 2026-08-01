#!/usr/bin/env tsx
/**
 * Bakes the Over City's own signage.
 *
 *   Run: npx tsx scripts/generate-over-city-sprites.ts
 *
 * Outputs to `src/images/environment/towns/over_city/` — art that is only ever
 * correct in *this* town. A fingerpost reading "Market Plaza" is a picture of a
 * place, not a piece of street furniture: hang it in a second town and it points
 * at somewhere that does not exist. Everything reusable — the lamps, the
 * hanging shop signs, the gateways, the bunting — is baked by
 * `generate-townscape-sprites.ts` into `environment/townscape/` instead.
 *
 * The split is the whole point of having two scripts. A later town adds a
 * sibling under `towns/`, and `townscape/` stays the size it is.
 *
 * Text is baked here, which is what makes these sheets town-specific in the
 * first place: `drawSignpost` sizes each arm by measuring its label, so the arm
 * lengths are a property of the words. See the note on fonts below.
 */

import { mkdirSync } from 'node:fs';

import { drawFortuneTeller } from '../src/sprites/townFixtures.js';
import { drawSignpost } from '../src/sprites/townWayfinding.js';
import { PLANNED_SIGNPOSTS } from '../src/systems/townDecorPlan.js';
import { OVER_CITY_DIR, writeSheets, type SheetSpec } from './townSheets.js';

/**
 * Matches `generate-townscape-sprites.ts` — the two sets hang side by side, and
 * that script's `TILE_SCALE` comment explains why it is 32 and not 64.
 */
const TILE_SCALE = 32;

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

const px = (tiles: number): number => Math.ceil(tiles * TILE_SCALE);

/**
 * One frame per planned post, in the order `PLANNED_SIGNPOSTS` declares them —
 * which is the order `TownDecorSystem` places them, so a post's index is its
 * frame.
 */
function signpostSheet(): SheetSpec {
  return {
    key: 'over_city_signpost',
    file: 'signpost.png',
    tileX: px(SIGNPOST_SIDE_TILES),
    tileY: px(SIGNPOST_UP_TILES),
    frameWidth: px(SIGNPOST_SIDE_TILES) * 2,
    frameHeight: px(SIGNPOST_UP_TILES) + px(ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: PLANNED_SIGNPOSTS.map((planned) => (ctx, originX, originY) => {
          drawSignpost(ctx, originX, originY, TILE_SCALE, planned.arms);
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
function fortuneTellerSheet(): SheetSpec {
  return {
    key: 'over_city_fortune_teller',
    file: 'fortune_teller.png',
    tileX: px(SEER_MARGIN_TILES),
    tileY: px(SEER_MARGIN_TILES),
    frameWidth: px(SEER_MARGIN_TILES * 2 + ANCHOR_TILE),
    frameHeight: px(SEER_MARGIN_TILES * 2 + ANCHOR_TILE),
    rows: [
      {
        state: 'idle',
        frames: [
          (ctx, originX, originY) => {
            drawFortuneTeller(ctx, originX, originY, TILE_SCALE);
          },
        ],
      },
    ],
  };
}

mkdirSync(OVER_CITY_DIR, { recursive: true });
writeSheets(OVER_CITY_DIR, TILE_SCALE, [signpostSheet(), fortuneTellerSheet()]);
