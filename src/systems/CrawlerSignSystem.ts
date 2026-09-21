/**
 * Lets the player read the wayfinding signs the dungeon generator stands at
 * junctions. Like `InteriorReadableSystem` it never animates, so it is not a
 * `GameSystem`: signs are placed once and then only queried.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { CrawlerSignDirection, CrawlerSignPlacement } from '../map/crawlerSigns';
import { CRAWLER_SIGN } from '../map/tileTypes';
import type { Player } from '../Player';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';

/**
 * Generous on purpose: reach is measured to the placement tile's centre, and a
 * wider sign base would leave the player standing further from that tile than
 * from the sign's edge.
 */
const READ_RADIUS_TILES = 1.6;
const READ_RADIUS = TILE_SIZE * READ_RADIUS_TILES;

const TILE_CENTRE_OFFSET = TILE_SIZE / 2;

/**
 * Milliseconds between words of a sign's text. A sign is a few words to glance at,
 * not speech to listen to, so it reveals about four times faster than a citizen.
 */
export const SIGN_REVEAL_INTERVAL_MS = 25;

export const CRAWLER_SIGN_SPEAKER = 'Painted Sign';

/** The two read pages; the arrow art and this prose both come from the one stored direction. */
export function signPages(direction: CrawlerSignDirection): ReadonlyArray<string> {
  return [
    'It looks like a different crawler left a message for anyone that came after them.',
    `It says, "Follow the hallway to the ${direction} to get to the stairwell."`,
  ];
}

export class CrawlerSignSystem {
  constructor(
    private readonly placements: ReadonlyArray<CrawlerSignPlacement>,
    private readonly onRead: (sign: CrawlerSignPlacement) => void,
  ) {}

  /**
   * The signs stamped into a map, for scenes that hold a `GameMap` but not the
   * generator's `DungeonData`. The direction and arrow angle ride on the tile itself.
   */
  static placementsFromMap(gameMap: GameMap): CrawlerSignPlacement[] {
    return gameMap.tilesOfType(CRAWLER_SIGN).flatMap((tile) => {
      const content = gameMap.structure[tile.y][tile.x];
      const direction = content.crawlerSignDirection;
      const arrowAngleRadians = content.crawlerSignArrowAngle;
      if (direction === undefined || arrowAngleRadians === undefined) return [];
      return [{ tile: { x: tile.x, y: tile.y }, direction, arrowAngleRadians }];
    });
  }

  get isEmpty(): boolean {
    return this.placements.length === 0;
  }

  /** The nearest sign whose placement tile is within reading distance of `active`, or null. */
  findSignInReach(active: Player): CrawlerSignPlacement | null {
    const playerX = active.x + TILE_CENTRE_OFFSET;
    const playerY = active.y + TILE_CENTRE_OFFSET;
    let nearest: CrawlerSignPlacement | null = null;
    let nearestDistance = READ_RADIUS;
    for (const sign of this.placements) {
      const distance = Math.hypot(
        playerX - (sign.tile.x * TILE_SIZE + TILE_CENTRE_OFFSET),
        playerY - (sign.tile.y * TILE_SIZE + TILE_CENTRE_OFFSET),
      );
      if (distance > nearestDistance) continue;
      nearest = sign;
      nearestDistance = distance;
    }
    return nearest;
  }

  /** Returns true only when a sign was in reach and the press was spent reading it. */
  tryInteract(active: Player): boolean {
    const sign = this.findSignInReach(active);
    if (sign === null) return false;
    this.onRead(sign);
    return true;
  }

  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    const sign = this.findSignInReach(active);
    if (sign === null) return;
    drawInteractionPrompt(
      ctx,
      sign.tile.x * TILE_SIZE - camX,
      sign.tile.y * TILE_SIZE - camY,
      TILE_SIZE,
      'Read',
    );
  }
}
