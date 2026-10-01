/**
 * The lights the party carries: each crawler's own, always on, and a smaller
 * one on every companion, so a party that splits up can still see each other.
 */

import { TILE_SIZE } from '../../core/constants';
import type { DynamicLightSink, DynamicLightSource } from './dynamicLights';
import { CRAWLER_LIGHT_REACH_TILES } from './lightKinds';

const HALF_TILE = TILE_SIZE / 2;
/**
 * A downed companion keeps a dimmer light, so a hireling waiting for a revive
 * in a dark room can still be found.
 */
const DOWNED_COMPANION_LIGHT = 0.6;

interface Positioned {
  readonly x: number;
  readonly y: number;
}

/** A companion of the party: Mongo or a hireling, standing or down. */
export interface PartyCompanion extends Positioned {
  readonly downed: boolean;
}

export interface PartyLightBearers {
  /** Both crawlers, whoever is leading; a crawler is lit even while knocked out. */
  readonly crawlers: () => ReadonlyArray<Positioned>;
  /** The party's own companions — never a stranger who happens not to be hostile. */
  readonly companions: () => ReadonlyArray<PartyCompanion>;
  /** A crawler light's reach in tiles, given its base reach: Night Vision lengthens it. */
  readonly crawlerReachTiles: (baseTiles: number) => number;
}

/** The party's lights as one source for the dungeon's lighting pass. */
export function partyLightSource(bearers: PartyLightBearers): DynamicLightSource {
  return {
    collectLights(sink: DynamicLightSink): void {
      const reach = bearers.crawlerReachTiles(CRAWLER_LIGHT_REACH_TILES);
      for (const crawler of bearers.crawlers()) {
        sink.add(crawler.x + HALF_TILE, crawler.y + HALF_TILE, 'crawler', 1, reach);
      }
      for (const companion of bearers.companions()) {
        const strength = companion.downed ? DOWNED_COMPANION_LIGHT : 1;
        sink.add(companion.x + HALF_TILE, companion.y + HALF_TILE, 'companion', strength);
      }
    },
  };
}
