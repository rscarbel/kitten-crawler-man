/**
 * Populates the Over City with wandering, non-combatant citizens so the town
 * reads as inhabited rather than an empty stage. Owned by `DungeonScene` and
 * active only on the overworld.
 *
 * The crowd is seeded as three cohorts so life spreads across the whole village
 * instead of pooling in the square:
 *  - the **plaza crowd** mills around the square and its immediate streets;
 *  - **frontage loiterers** are anchored to a building's door and only ever
 *    potter about its doorstep, so every shop and cottage has someone outside it;
 *  - **travelers** walk long hops between distant street tiles, giving the roads
 *    a steady trickle of people going somewhere.
 *
 * Each cohort strolls via the shared wander helper (respecting walls and keeping
 * clear of building doors) and all three are exposed as one crowd for the scene's
 * Y-sorted render pass. Combat, mobs, and the player are untouched — these
 * figures are pure ambience.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { DIRT_PATCH, FloorTypeValue } from '../map/tileTypes';
import { Townsperson } from '../creatures/Townsperson';
import { findNearestTownsperson } from '../creatures/townInteraction';
import type { WanderParams } from '../creatures/townWander';
import type { TownRole } from '../sprites/person/PersonAppearance';
import type { GameSystem } from './GameSystem';

// Spread appearance seeds far apart so neighbors don't share a look.
const SEED_STRIDE = 101;
const SEED_BASE = 1301;

// The town's safe radius (55 tiles) reaches far into the approach roads. Two
// nested zones carve that into the areas worth populating: the plaza (square
// plus the streets feeding it) and the district (every named building's plot,
// out to the farthest of them).
const PLAZA_RADIUS_TILES = 20;
const DISTRICT_RADIUS_TILES = 48;

// Tiles around a door that count as its building's frontage — roughly its
// doorstep and the street stub in front of it.
const FRONTAGE_RADIUS_TILES = 5;
const FRONTAGE_RADIUS = TILE_SIZE * FRONTAGE_RADIUS_TILES;

// A paved tile only counts as a street once it is this close to some building's
// door; beyond that the main roads are just the empty highway out of town, which
// travelers have no reason to walk.
const STREET_NEAR_DOOR_TILES = 14;

const PLAZA_POPULATION = 18;
const TRAVELER_POPULATION = 12;
const LOITERERS_PER_BUILDING_MIN = 1;
const LOITERERS_PER_BUILDING_MAX = 2;

// A citizen within this range of the player shows a Talk prompt / is talkable.
const TALK_RADIUS_TILES = 1.1;
const TALK_RADIUS = TILE_SIZE * TALK_RADIUS_TILES;

const PLAZA_SPEED_MIN = 0.35;
const PLAZA_SPEED_MAX = 0.9;
// Loiterers shuffle around their doorstep rather than going anywhere.
const FRONTAGE_SPEED_MIN = 0.25;
const FRONTAGE_SPEED_MAX = 0.55;
// Travelers are covering real distance, so they move with purpose.
const TRAVELER_SPEED_MIN = 0.6;
const TRAVELER_SPEED_MAX = 1.0;

const ARRIVE_DIST = TILE_SIZE / 2;
const PLAZA_PAUSE_MIN = 30;
const PLAZA_PAUSE_MAX = 240;
// Standing outside your own front door is most of what a loiterer does.
const FRONTAGE_PAUSE_MIN = 90;
const FRONTAGE_PAUSE_MAX = 420;
// Travelers barely break stride between legs of a journey.
const TRAVELER_PAUSE_MIN = 10;
const TRAVELER_PAUSE_MAX = 90;
const MAX_INITIAL_PAUSE = 180;

// Candidate destinations sampled per traveler retarget; the farthest from where
// they stand wins, so a hop crosses town instead of shuffling one street over.
const TRAVEL_TARGET_SAMPLES = 4;

// Half a tile: the offset from a citizen's top-left draw origin to its center,
// used so every tile/zone query samples the point under the figure's feet.
const CENTER_OFFSET = TILE_SIZE / 2;

// Gentle anti-clumping: citizens closer than this nudge apart a touch each frame.
const SEPARATION_DIST_FRACTION = 0.55;
const SEPARATION_DIST = TILE_SIZE * SEPARATION_DIST_FRACTION;
const SEPARATION_PUSH = 0.25;

// Bias spawns toward the plaza by keeping the more central of two candidate tiles.
const CENTER_BIAS_SAMPLES = 2;

interface RoleWeight {
  role: TownRole;
  weight: number;
}

interface RoleTable {
  weights: ReadonlyArray<RoleWeight>;
  total: number;
}

function roleTable(weights: ReadonlyArray<RoleWeight>): RoleTable {
  return { weights, total: weights.reduce((sum, rw) => sum + rw.weight, 0) };
}

// A believable street mix: mostly ordinary folk, a sprinkling of color.
const PLAZA_ROLES = roleTable([
  { role: 'commoner', weight: 6 },
  { role: 'laborer', weight: 4 },
  { role: 'farmer', weight: 3 },
  { role: 'merchant', weight: 2 },
  { role: 'guard', weight: 2 },
  { role: 'child', weight: 2 },
  { role: 'noble', weight: 1 },
  { role: 'beggar', weight: 1 },
  { role: 'drunk', weight: 1 },
]);

// Doorsteps belong to the people who live and work on them — trades, kids
// playing out front, and the odd loafer.
const FRONTAGE_ROLES = roleTable([
  { role: 'commoner', weight: 5 },
  { role: 'child', weight: 3 },
  { role: 'laborer', weight: 3 },
  { role: 'merchant', weight: 2 },
  { role: 'guard', weight: 2 },
  { role: 'drunk', weight: 2 },
  { role: 'beggar', weight: 2 },
  { role: 'smith', weight: 1 },
  { role: 'innkeeper', weight: 1 },
  { role: 'priest', weight: 1 },
  { role: 'noble', weight: 1 },
]);

// Nobody sends a child or a beggar hiking across town, so the road crowd is
// working folk with somewhere to be.
const TRAVELER_ROLES = roleTable([
  { role: 'commoner', weight: 4 },
  { role: 'laborer', weight: 4 },
  { role: 'farmer', weight: 4 },
  { role: 'merchant', weight: 3 },
  { role: 'guard', weight: 2 },
  { role: 'noble', weight: 1 },
]);

interface TileXY {
  x: number;
  y: number;
}

export class TownLifeSystem implements GameSystem {
  private readonly townsfolk: Townsperson[] = [];
  private readonly doorTiles: Set<string>;
  private readonly plazaTiles: TileXY[];
  private readonly streetTiles: TileXY[];
  private readonly districtDoors: TileXY[];
  private readonly centerTile: number;
  private readonly plazaRadius: number;
  private readonly districtRadius: number;
  private readonly plazaWander: WanderParams;
  private seedCount = 0;

  constructor(private readonly gameMap: GameMap) {
    this.centerTile = Math.floor(gameMap.gridSize / 2);
    const safeRadius = gameMap.townSafeRadius ?? 0;
    this.plazaRadius = Math.min(safeRadius, PLAZA_RADIUS_TILES);
    this.districtRadius = Math.min(safeRadius, DISTRICT_RADIUS_TILES);
    this.doorTiles = new Set(
      gameMap.buildingEntries.map((entry) => tileKey(entry.doorTile.x, entry.doorTile.y)),
    );
    this.districtDoors = gameMap.buildingEntries
      .map((entry) => entry.doorTile)
      .filter((door) => this.withinRadius(door.x, door.y, this.districtRadius));
    this.plazaTiles = this.gatherTiles(this.plazaRadius, () => true);
    this.streetTiles = this.gatherTiles(
      this.districtRadius,
      (tx, ty) => this.isPaved(tx, ty) && this.isNearAnyDoor(tx, ty),
    );
    this.plazaWander = {
      pickTarget: () => randomTilePoint(this.plazaTiles),
      arriveDist: ARRIVE_DIST,
      pauseMin: PLAZA_PAUSE_MIN,
      pauseMax: PLAZA_PAUSE_MAX,
      isWalkable: (x, y) => this.isWalkableWithin(x, y, this.plazaRadius),
    };

    this.spawnPlazaCrowd();
    this.spawnFrontageLoiterers();
    this.spawnTravelers();
  }

  /** The current crowd, for the scene's Y-sorted entity render pass. */
  get people(): ReadonlyArray<Townsperson> {
    return this.townsfolk;
  }

  /** The nearest citizen the player (at world origin `x`,`y`) can talk to, or `null`. */
  findTalkTarget(x: number, y: number): Townsperson | null {
    return findNearestTownsperson(this.townsfolk, x, y, TALK_RADIUS);
  }

  update(): void {
    for (const person of this.townsfolk) {
      person.update();
    }
    this.separate();
  }

  /** Enumerate every walkable, non-door tile inside `radius` that `accept` allows. */
  private gatherTiles(radius: number, accept: (tx: number, ty: number) => boolean): TileXY[] {
    if (radius <= 0) return [];
    const min = this.centerTile - radius;
    const max = this.centerTile + radius;
    const tiles: TileXY[] = [];
    for (let ty = min; ty <= max; ty++) {
      for (let tx = min; tx <= max; tx++) {
        if (this.doorTiles.has(tileKey(tx, ty))) continue;
        if (!this.withinRadius(tx, ty, radius)) continue;
        if (!this.gameMap.isWalkable(tx, ty)) continue;
        if (!accept(tx, ty)) continue;
        tiles.push({ x: tx, y: ty });
      }
    }
    return tiles;
  }

  /** True when tile (tx, ty) lies inside `radius` tiles of the town centre. */
  private withinRadius(tx: number, ty: number, radius: number): boolean {
    const dx = tx - this.centerTile;
    const dy = ty - this.centerTile;
    return dx * dx + dy * dy <= radius * radius;
  }

  /** True for road-family ground — the paved surfaces citizens read as streets. */
  private isPaved(tx: number, ty: number): boolean {
    const size = this.gameMap.gridSize;
    if (tx < 0 || ty < 0 || tx >= size || ty >= size) return false;
    const tileType = this.gameMap.structure[ty][tx].type;
    return tileType === FloorTypeValue.road || tileType === DIRT_PATCH;
  }

  private isNearAnyDoor(tx: number, ty: number): boolean {
    return this.districtDoors.some((door) => {
      const dx = tx - door.x;
      const dy = ty - door.y;
      return dx * dx + dy * dy <= STREET_NEAR_DOOR_TILES * STREET_NEAR_DOOR_TILES;
    });
  }

  private spawnPlazaCrowd(): void {
    if (this.plazaTiles.length === 0) return;
    const count = Math.min(PLAZA_POPULATION, this.plazaTiles.length);
    for (let i = 0; i < count; i++) {
      this.addCitizen(
        this.centerBiasedTile(),
        PLAZA_ROLES,
        PLAZA_SPEED_MIN,
        PLAZA_SPEED_MAX,
        this.plazaWander,
      );
    }
  }

  /** Give every building in the district someone loitering on its doorstep. */
  private spawnFrontageLoiterers(): void {
    for (const door of this.districtDoors) {
      const frontage = this.gatherFrontageTiles(door);
      if (frontage.length === 0) continue;
      const wander: WanderParams = {
        pickTarget: () => randomTilePoint(frontage),
        arriveDist: ARRIVE_DIST,
        pauseMin: FRONTAGE_PAUSE_MIN,
        pauseMax: FRONTAGE_PAUSE_MAX,
        isWalkable: (x, y) => this.isWalkableSpot(x, y) && near(x, y, door),
      };
      const count = randomIntInclusive(LOITERERS_PER_BUILDING_MIN, LOITERERS_PER_BUILDING_MAX);
      for (let i = 0; i < count; i++) {
        this.addCitizen(
          randomTile(frontage),
          FRONTAGE_ROLES,
          FRONTAGE_SPEED_MIN,
          FRONTAGE_SPEED_MAX,
          wander,
        );
      }
    }
  }

  /**
   * Populate the streets with citizens crossing town. Each keeps its own
   * last-destination so the next hop is chosen away from where it just arrived,
   * which is what makes them read as walking somewhere rather than milling.
   */
  private spawnTravelers(): void {
    if (this.streetTiles.length === 0) return;
    const count = Math.min(TRAVELER_POPULATION, this.streetTiles.length);
    for (let i = 0; i < count; i++) {
      const start = randomTile(this.streetTiles);
      let lastTarget = start;
      const wander: WanderParams = {
        pickTarget: () => {
          lastTarget = this.farthestStreetTileFrom(lastTarget);
          return tilePoint(lastTarget);
        },
        arriveDist: ARRIVE_DIST,
        pauseMin: TRAVELER_PAUSE_MIN,
        pauseMax: TRAVELER_PAUSE_MAX,
        isWalkable: (x, y) => this.isWalkableWithin(x, y, this.districtRadius),
      };
      this.addCitizen(start, TRAVELER_ROLES, TRAVELER_SPEED_MIN, TRAVELER_SPEED_MAX, wander);
    }
  }

  private addCitizen(
    tile: TileXY,
    roles: RoleTable,
    speedMin: number,
    speedMax: number,
    wander: WanderParams,
  ): void {
    this.townsfolk.push(
      new Townsperson({
        x: tile.x * TILE_SIZE,
        y: tile.y * TILE_SIZE,
        role: pickRole(roles),
        seed: SEED_BASE + this.seedCount * SEED_STRIDE,
        speed: speedMin + Math.random() * (speedMax - speedMin),
        wander,
        initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
      }),
    );
    this.seedCount++;
  }

  /** Walkable, non-door tiles on a building's doorstep — where its loiterers live. */
  private gatherFrontageTiles(door: TileXY): TileXY[] {
    const tiles: TileXY[] = [];
    for (let ty = door.y - FRONTAGE_RADIUS_TILES; ty <= door.y + FRONTAGE_RADIUS_TILES; ty++) {
      for (let tx = door.x - FRONTAGE_RADIUS_TILES; tx <= door.x + FRONTAGE_RADIUS_TILES; tx++) {
        if (this.doorTiles.has(tileKey(tx, ty))) continue;
        if (!near(tx * TILE_SIZE, ty * TILE_SIZE, door)) continue;
        if (!this.gameMap.isWalkable(tx, ty)) continue;
        tiles.push({ x: tx, y: ty });
      }
    }
    return tiles;
  }

  /** The most distant of several sampled street tiles, so a traveler's next leg is a real journey. */
  private farthestStreetTileFrom(from: TileXY): TileXY {
    let best = randomTile(this.streetTiles);
    let bestDist = tileDistSq(best, from);
    for (let s = 1; s < TRAVEL_TARGET_SAMPLES; s++) {
      const cand = randomTile(this.streetTiles);
      const dist = tileDistSq(cand, from);
      if (dist > bestDist) {
        best = cand;
        bestDist = dist;
      }
    }
    return best;
  }

  /** A random plaza tile, biased toward the square by keeping the more central of two draws. */
  private centerBiasedTile(): TileXY {
    const center = { x: this.centerTile, y: this.centerTile };
    let best = randomTile(this.plazaTiles);
    let bestDist = tileDistSq(best, center);
    for (let s = 1; s < CENTER_BIAS_SAMPLES; s++) {
      const cand = randomTile(this.plazaTiles);
      const dist = tileDistSq(cand, center);
      if (dist < bestDist) {
        best = cand;
        bestDist = dist;
      }
    }
    return best;
  }

  /** Base walkability gate for wander: a walkable tile that isn't a building's doorway. */
  private isWalkableSpot(worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    if (this.doorTiles.has(tileKey(tx, ty))) return false;
    return this.gameMap.isWalkable(tx, ty);
  }

  /** Walkability gate that also confines a cohort to its zone. */
  private isWalkableWithin(worldX: number, worldY: number, radius: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    if (!this.withinRadius(tx, ty, radius)) return false;
    return this.isWalkableSpot(worldX, worldY);
  }

  /** Nudge overlapping citizens apart, but never into a wall. */
  private separate(): void {
    const folk = this.townsfolk;
    for (let i = 0; i < folk.length; i++) {
      for (let j = i + 1; j < folk.length; j++) {
        const a = folk[i];
        const b = folk[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= SEPARATION_DIST || Math.abs(dy) >= SEPARATION_DIST) continue;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= SEPARATION_DIST) continue;
        const nx = (dx / dist) * SEPARATION_PUSH;
        const ny = (dy / dist) * SEPARATION_PUSH;
        if (this.isWalkableSpot(a.x - nx, a.y - ny)) {
          a.x -= nx;
          a.y -= ny;
        }
        if (this.isWalkableSpot(b.x + nx, b.y + ny)) {
          b.x += nx;
          b.y += ny;
        }
      }
    }
  }
}

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

function tileDistSq(a: TileXY, b: TileXY): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** True when a world point is inside the frontage bubble around `door`. */
function near(worldX: number, worldY: number, door: TileXY): boolean {
  const dx = worldX - door.x * TILE_SIZE;
  const dy = worldY - door.y * TILE_SIZE;
  return dx * dx + dy * dy <= FRONTAGE_RADIUS * FRONTAGE_RADIUS;
}

function randomTile(tiles: ReadonlyArray<TileXY>): TileXY {
  return tiles[Math.floor(Math.random() * tiles.length)];
}

function tilePoint(tile: TileXY): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

function randomTilePoint(tiles: ReadonlyArray<TileXY>): { x: number; y: number } {
  return tilePoint(randomTile(tiles));
}

function randomIntInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRole(table: RoleTable): TownRole {
  let roll = Math.random() * table.total;
  for (const rw of table.weights) {
    roll -= rw.weight;
    if (roll < 0) return rw.role;
  }
  return 'commoner';
}
