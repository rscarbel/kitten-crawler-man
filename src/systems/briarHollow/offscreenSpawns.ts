/**
 * Where a scripted hostile comes up when the party must not see it appear:
 * round an anchor tile, on open ground a hostile may stand on, never close to
 * a crawler, and off screen wherever that can be found — the siege's dead
 * coming up their lane, the road's ambushers coming out of the wilds round
 * Midge. Also the queue those spawns are let out of, one due body at a time.
 *
 * Off screen is the camera the scene last drew with (`isWorldPointInView`),
 * or with none published — a headless run — far enough from both crawlers.
 * A body that has waited long enough for somewhere off screen settles for the
 * furthest clear spot in view instead, so it is late rather than never.
 */

import { TILE_SIZE } from '../../core/constants';
import { isWorldPointInView, visibleWorldView } from '../../core/visibleWorldView';
import type { GameMap } from '../../map/GameMap';
import { findNearbyWalkableTile, hasRoomToMove } from '../../map/findWalkableTile';
import type { TilePoint } from '../../map/town/townPlan';

/** From a tile's corner to its centre, in tiles. */
const TILE_CENTRE_OFFSET = 0.5;

/** The rules one kind of scripted spawn is placed by. */
export interface OffscreenSpawnRules {
  readonly gameMap: GameMap;
  /** Both crawlers, wherever they stand. */
  readonly crawlers: () => ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** Scatter and candidate picks; seeded in the gates. */
  readonly random: () => number;
  /** How far round the anchor a body may appear, each way. */
  readonly scatterTiles: number;
  /** How far a candidate on crowded ground may be nudged to open ground. */
  readonly searchTiles: number;
  /** Candidate tiles tried round one anchor before settling for the furthest. */
  readonly attempts: number;
  /** No body ever appears this close to a crawler, whatever the camera shows. */
  readonly minCrawlerTiles: number;
  /** With no camera published, a spawn this far from both crawlers counts as out of sight. */
  readonly unseenTiles: number;
  /** A spawn must be this far past the camera's edge, so no part of the body shows as it appears. */
  readonly offscreenMarginTiles: number;
  /** How long a body waits for somewhere off screen before settling for the furthest spot in view. */
  readonly deferFrames: number;
  /** What else a tile must be for this kind of spawn, past being open ground a hostile may stand on. */
  readonly accepts: (tileX: number, tileY: number) => boolean;
}

/** A candidate spot: whether it is out of sight, and how far it stands from the nearer crawler. */
export interface SpawnCandidate {
  readonly tile: TilePoint;
  readonly unseen: boolean;
  readonly away: number;
}

/**
 * The best spot round `anchor`: the first off screen, else the furthest
 * clear of the party. Null when no attempt found open ground far enough from
 * both crawlers.
 */
export function spawnCandidateNear(
  rules: OffscreenSpawnRules,
  anchor: TilePoint,
): SpawnCandidate | null {
  const { gameMap } = rules;
  const crawlers = rules.crawlers();
  const nearestCrawlerTiles = (tile: TilePoint): number =>
    Math.min(
      ...crawlers.map((crawler) =>
        Math.hypot(tile.x - crawler.x / TILE_SIZE, tile.y - crawler.y / TILE_SIZE),
      ),
    );
  const jitterSpan = rules.scatterTiles * 2 + 1;
  let furthest: SpawnCandidate | null = null;
  for (let attempt = 0; attempt < rules.attempts; attempt++) {
    const jitterX = Math.floor(rules.random() * jitterSpan) - rules.scatterTiles;
    const jitterY = Math.floor(rules.random() * jitterSpan) - rules.scatterTiles;
    const tile = findNearbyWalkableTile(
      gameMap,
      anchor.x + jitterX,
      anchor.y + jitterY,
      rules.searchTiles,
      // Room to move, not just walkable: a gap between trunks is walkable
      // ground a body comes up in and never leaves.
      (x, y) =>
        gameMap.isWalkableForHostile(x, y) && hasRoomToMove(gameMap, x, y) && rules.accepts(x, y),
    );
    if (tile === null) continue;
    const away = nearestCrawlerTiles(tile);
    if (away < rules.minCrawlerTiles) continue;
    if (isUnseenSpawn(rules, tile, away)) return { tile, unseen: true, away };
    if (furthest === null || away > furthest.away) furthest = { tile, unseen: false, away };
  }
  return furthest;
}

/**
 * Where a body comes up: near one of `anchors` (the first that has somewhere
 * off screen, in order), else — once it has waited `rules.deferFrames` — the
 * furthest clear spot in view round any of them. Null: nowhere yet, so it waits.
 */
export function placeAmong<A>(
  rules: OffscreenSpawnRules,
  anchors: readonly A[],
  anchorTile: (anchor: A) => TilePoint,
  waitedFrames: number,
): { readonly anchor: A; readonly tile: TilePoint } | null {
  let furthest: { anchor: A; tile: TilePoint; away: number } | null = null;
  for (const anchor of anchors) {
    const candidate = spawnCandidateNear(rules, anchorTile(anchor));
    if (candidate === null) continue;
    if (candidate.unseen) return { anchor, tile: candidate.tile };
    if (furthest === null || candidate.away > furthest.away) {
      furthest = { anchor, tile: candidate.tile, away: candidate.away };
    }
  }
  const waitedLongEnough = waitedFrames >= rules.deferFrames;
  return waitedLongEnough && furthest !== null
    ? { anchor: furthest.anchor, tile: furthest.tile }
    : null;
}

/** Whether `tile`, `tilesFromParty` from the nearer crawler, is out of the party's sight. */
export function isUnseenSpawn(
  rules: Pick<OffscreenSpawnRules, 'unseenTiles' | 'offscreenMarginTiles'>,
  tile: TilePoint,
  tilesFromParty: number,
): boolean {
  if (visibleWorldView() === null) return tilesFromParty > rules.unseenTiles;
  const outsideByPx = -rules.offscreenMarginTiles * TILE_SIZE;
  const centreX = (tile.x + TILE_CENTRE_OFFSET) * TILE_SIZE;
  const centreY = (tile.y + TILE_CENTRE_OFFSET) * TILE_SIZE;
  return !isWorldPointInView(centreX, centreY, outsideByPx);
}

/** What letting a queue of spawns out asks of its owner. */
export interface DueSpawnHooks<T, P> {
  /** Whether the head of the queue is due yet. */
  isDue(item: T): boolean;
  /** Whether no more may come out right now — a cap on the living, say. */
  isHeldBack(): boolean;
  /** Where `item` would come up, having waited `waitedFrames` at the head; null to keep waiting. */
  place(item: T, waitedFrames: number): P | null;
  /** Brings `item` out at `place`. */
  spawn(item: T, place: P): void;
}

/**
 * Lets out every due spawn at the head of `queue`, in order, each where
 * `hooks.place` puts it. One with nowhere to come up yet stays at the head
 * — not dropped, it still belongs to its wave — and `headWait` counts how
 * long it has waited, which is what lets it settle for a spot in view.
 */
export function spawnDue<T, P>(
  queue: T[],
  headWait: { frames: number },
  hooks: DueSpawnHooks<T, P>,
): void {
  while (queue.length > 0) {
    const next = queue[0];
    if (!hooks.isDue(next)) return;
    if (hooks.isHeldBack()) return;
    const place = hooks.place(next, headWait.frames);
    if (place === null) {
      headWait.frames++;
      return;
    }
    queue.shift();
    headWait.frames = 0;
    hooks.spawn(next, place);
  }
}
