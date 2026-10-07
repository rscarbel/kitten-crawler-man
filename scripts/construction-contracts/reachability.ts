/**
 * Every contract spot can be worked from where the party can walk, for
 * `verify:construction-contracts`.
 *
 * For each site in both towns, every spot in its pool (so every contract the
 * generator can draw), the walkable tiles are flooded from the way in: a
 * Skyfowl Town room's spawn and exit tiles, Briar Hollow's main gate. The
 * flood steps orthogonally because movement collides one axis at a time on
 * the body's centre (`applyMovement`), so no diagonal squeezes between two
 * blocked corners. Each spot must then have a reached tile within
 * `CONTRACT_REACH_TILES` of its footprint, measured by `tilesToFootprint`, the
 * same measure the work channel uses.
 *
 * The worst case is the built map itself: every prop spot's footprint blocks
 * whether it is repaired, damaged or a bare rebuild site (a rebuild prop is
 * only held out of the draw), and every prop footprint is treated as blocked
 * here regardless. Villagers and occupants are never in the way: player
 * movement tests the map's tiles only, so a contact pinned indoors cannot wall
 * off part of a room.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import type { TilePoint, TileRect } from '../../src/map/town/townPlan';
import {
  CONTRACT_SITES,
  type ContractSiteDef,
  type ContractSpotDef,
} from '../../src/systems/constructionContracts/contractCatalog';
import {
  CONTRACT_REACH_TILES,
  tilesToFootprint,
} from '../../src/systems/constructionContracts/ContractSiteWork';
import {
  briarHollowSpotFootprint,
  footprintTiles,
  skyfowlSpotFootprint,
  type ContractSpotFootprint,
} from '../../src/systems/constructionContracts/contractTargets';
import type { Check } from './shared';
import { generateGroundFloor, LAYOUT_WORLD_SEEDS, worldLayouts } from './targets';

const ORTHOGONAL_STEPS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** How far past a footprint a standing tile could still be in reach. */
const REACH_SEARCH_MARGIN = Math.ceil(CONTRACT_REACH_TILES);

/** A walkable grid, the tiles to flood it from, and every spot to reach. */
interface ReachProblem {
  readonly map: Pick<GameMap, 'isWalkable' | 'structure'>;
  readonly entrances: readonly TilePoint[];
  readonly spots: ReadonlyArray<{
    readonly where: string;
    readonly footprint: ContractSpotFootprint | null;
  }>;
  /** Tiles held solid on top of the map's own, for the negative check. */
  readonly extraBlocked?: (x: number, y: number) => boolean;
}

function rectContains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/** Every tile reached from the entrances, as `y * width + x` indices. */
function floodWalkable(problem: ReachProblem): Set<number> {
  const width = problem.map.structure[0]?.length ?? 0;
  const propFootprints = problem.spots.flatMap((spot) =>
    spot.footprint?.surface === 'prop' ? [spot.footprint.rect] : [],
  );
  const open = (x: number, y: number): boolean =>
    problem.map.isWalkable(x, y) &&
    problem.extraBlocked?.(x, y) !== true &&
    !propFootprints.some((rect) => rectContains(rect, x, y));
  const reached = new Set<number>();
  const queue: TilePoint[] = [];
  for (const entrance of problem.entrances) {
    if (!open(entrance.x, entrance.y)) continue;
    reached.add(entrance.y * width + entrance.x);
    queue.push(entrance);
  }
  // Iterating the array itself also visits the tiles pushed onto it below.
  for (const tile of queue) {
    for (const { dx, dy } of ORTHOGONAL_STEPS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const index = y * width + x;
      if (reached.has(index) || !open(x, y)) continue;
      reached.add(index);
      queue.push({ x, y });
    }
  }
  return reached;
}

/** The nearest a reached tile comes to `rect`, in the work channel's own measure. */
function nearestReachedTiles(reached: Set<number>, width: number, rect: TileRect): number {
  const tiles = footprintTiles(rect);
  let nearest = Number.POSITIVE_INFINITY;
  for (let y = rect.y - REACH_SEARCH_MARGIN; y < rect.y + rect.h + REACH_SEARCH_MARGIN; y++) {
    for (let x = rect.x - REACH_SEARCH_MARGIN; x < rect.x + rect.w + REACH_SEARCH_MARGIN; x++) {
      if (x < 0 || y < 0 || x >= width || !reached.has(y * width + x)) continue;
      const standing = { x: x * TILE_SIZE, y: y * TILE_SIZE };
      nearest = Math.min(nearest, tilesToFootprint(standing, tiles));
    }
  }
  return nearest;
}

/** One line per spot the party cannot get within reach of, naming the building and spot. */
function unreachableSpots(problem: ReachProblem): string[] {
  const reached = floodWalkable(problem);
  const width = problem.map.structure[0]?.length ?? 0;
  const problems: string[] = [];
  for (const spot of problem.spots) {
    if (spot.footprint === null) {
      problems.push(`${spot.where}: target does not resolve`);
      continue;
    }
    const nearest = nearestReachedTiles(reached, width, spot.footprint.rect);
    if (nearest > CONTRACT_REACH_TILES) {
      const distance = Number.isFinite(nearest) ? `${nearest.toFixed(2)} tiles` : 'nowhere near';
      problems.push(
        `${spot.where}: no walkable tile from the entrance within ${CONTRACT_REACH_TILES} of it (nearest ${distance})`,
      );
    }
  }
  return problems;
}

function spotWhere(site: ContractSiteDef, spot: ContractSpotDef): string {
  return `${site.name}, spot "${spot.id}"`;
}

/** The reach problem for one site on one world seed, or why it could not be built. */
function siteReachProblem(site: ContractSiteDef, seed: number): ReachProblem | string {
  const world = worldLayouts(seed);
  if (site.town === 'briar_hollow') {
    const village = world.village;
    return {
      map: world.map,
      entrances: [village.gate.inside, village.gate.outside],
      spots: site.spots.map((spot) => ({
        where: spotWhere(site, spot),
        footprint: briarHollowSpotFootprint(site, spot, village),
      })),
    };
  }
  const entry = world.entries.find((candidate) => candidate.name === site.buildingName);
  if (entry === undefined) return `${site.name}: no building entry on world seed ${seed}`;
  const map = generateGroundFloor(entry);
  return {
    map,
    entrances: [map.startTile, ...map._interiorExitTiles],
    spots: site.spots.map((spot) => ({
      where: spotWhere(site, spot),
      footprint: skyfowlSpotFootprint(site, spot, map),
    })),
  };
}

function verifyEverySpotReachable(check: Check): void {
  for (const seed of LAYOUT_WORLD_SEEDS) {
    for (const site of CONTRACT_SITES) {
      const problem = siteReachProblem(site, seed);
      if (typeof problem === 'string') {
        check(false, problem);
        continue;
      }
      const problems = unreachableSpots(problem);
      for (const line of problems) console.log(`         ${line}`);
      check(
        problems.length === 0,
        `seed ${seed} · ${site.name}: all ${site.spots.length} spots in reach from the entrance`,
      );
    }
  }
}

/**
 * One spot walled in on the map, in memory: every tile around its footprint
 * held solid. The check must go red naming that building and spot.
 */
function verifyWalledSpotIsCaught(check: Check): void {
  const seed = LAYOUT_WORLD_SEEDS[0];
  for (const town of ['skyfowl', 'briar_hollow'] as const) {
    const site = CONTRACT_SITES.find((candidate) => candidate.town === town);
    const spot = site?.spots[0];
    if (site === undefined || spot === undefined) {
      check(false, `negative: a ${town} site with a spot to wall in`);
      continue;
    }
    const problem = siteReachProblem(site, seed);
    if (typeof problem === 'string') {
      check(false, `negative: ${problem}`);
      continue;
    }
    const target = problem.spots.find((candidate) => candidate.where === spotWhere(site, spot));
    const rect = target?.footprint?.rect;
    if (rect === undefined) {
      check(false, `negative: ${spotWhere(site, spot)} resolves`);
      continue;
    }
    const moat: TileRect = {
      x: rect.x - REACH_SEARCH_MARGIN,
      y: rect.y - REACH_SEARCH_MARGIN,
      w: rect.w + 2 * REACH_SEARCH_MARGIN,
      h: rect.h + 2 * REACH_SEARCH_MARGIN,
    };
    const walledIn: ReachProblem = {
      ...problem,
      extraBlocked: (x, y) => rectContains(moat, x, y) && !rectContains(rect, x, y),
    };
    const clean = unreachableSpots(problem);
    const named = unreachableSpots(walledIn).filter((line) =>
      line.startsWith(spotWhere(site, spot)),
    );
    for (const line of named) console.log(`         caught: ${line}`);
    check(
      clean.length === 0 && named.length > 0,
      `negative: ${spotWhere(site, spot)} walled in goes red naming it`,
    );
  }
}

export const reachabilitySections: ReadonlyArray<{
  readonly name: string;
  readonly run: (check: Check) => void;
}> = [
  { name: 'Every spot is in reach from the entrance', run: verifyEverySpotReachable },
  { name: 'Negative: a walled-in spot goes red', run: verifyWalledSpotIsCaught },
];
