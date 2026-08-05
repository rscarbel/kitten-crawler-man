/**
 * Populates the Over City with wandering, non-combatant citizens so the town
 * reads as inhabited rather than an empty stage. Owned by `DungeonScene` and
 * active only on the overworld.
 *
 * The crowd is seeded as four cohorts so life spreads across the whole village
 * instead of pooling in the square:
 *  - the **plaza crowd** mills around the square and its immediate streets;
 *  - **frontage loiterers** are anchored to a building's door and only ever
 *    potter about its doorstep, so every shop and cottage has someone outside it;
 *  - **travelers** walk long hops between distant street tiles, giving the roads
 *    a steady trickle of people going somewhere;
 *  - **activity anchors** stand at a named fixture — a well, the smithy door,
 *    the fountain steps, the club door — and barely move, so the town's props
 *    look used rather than placed.
 *
 * Each cohort strolls via the shared wander helper (respecting walls and keeping
 * clear of building doors) and all four are exposed as one crowd for the scene's
 * Y-sorted render pass. Combat, mobs, and the player are untouched — these
 * figures are pure ambience.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import {
  COBBLE_STREET,
  DIRT_PATCH,
  FloorTypeValue,
  LANE_STREET,
  PLAZA_STONE,
  WELL,
} from '../map/tileTypes';
import { tileCoordKey } from '../map/tileIndex';

import { Townsperson } from '../creatures/Townsperson';
import { findNearestTownsperson } from '../creatures/townInteraction';
import type { WanderParams } from '../creatures/townWander';
import type { TownRole } from '../sprites/person/PersonAppearance';
import type { GameSystem, SystemContext } from './GameSystem';
import { SpatialGrid } from '../core/SpatialGrid';
import { viewportWidth, viewportHeight } from '../core/Viewport';

/** The made surfaces of the town, which citizens treat as public space. */
const STREET_TILE_TYPES: ReadonlySet<number> = new Set([
  FloorTypeValue.road,
  DIRT_PATCH,
  LANE_STREET,
  COBBLE_STREET,
  PLAZA_STONE,
]);

// Spread appearance seeds far apart so neighbors don't share a look.
const SEED_STRIDE = 101;
const SEED_BASE = 1301;

// The town's safe radius (40 tiles) reaches past the wall into the gate roads.
// Two nested zones carve that into the areas worth populating: the plaza (the
// flagstone slab and the lanes feeding it) and the district (every named
// building's plot, out to the farthest of them).
//
// Both are sized against the compacted town, not the old sprawl. The plaza slab
// is 17 x 16, so its corners sit at (±8, -8) and (±8, +7) from its centre —
// hypot(8, 8) = 11.31 tiles, and `withinRadius` is a strict circular test, so 11
// would leave all four corners outside the crowd's own plaza. The farthest door —
// The Sunken Stump Pub, in the south-west corner of the walls — is 33.4 tiles out,
// so the district radius carries a couple of tiles of margin rather than sitting on
// that figure: `districtDoors` filters by it, and a radius of 34 would drop the pub
// out of the town's life entirely on any layout tweak that moved it half a tile.
const PLAZA_RADIUS_TILES = 12;
const DISTRICT_RADIUS_TILES = 36;

// Tiles around a door that count as its building's frontage — roughly its
// doorstep and the width of the street in front of it.
//
// Buildings now stand shoulder to shoulder, so this cannot be large. Measured
// against the real grid it is small enough: **no pair of doors in the town shares
// a single frontage tile.** The closest pair is Blackwood Lodge's door and
// Shepherd's Cabin's, 7 tiles apart, whose radius-4 circles do overlap on two
// tiles — but both of those sit under the buildings' own facade rows and are not
// walkable, so `gatherFrontageTiles` discards them. A wider bubble would start
// merging frontages along the whole of Garrison Row.
const FRONTAGE_RADIUS_TILES = 4;
const FRONTAGE_RADIUS = TILE_SIZE * FRONTAGE_RADIUS_TILES;

// A paved tile only counts as a street once it is this close to some building's
// door; beyond that the streets are just the empty highway out of the gates,
// which travelers have no reason to walk.
const STREET_NEAR_DOOR_TILES = 10;

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

/**
 * How far an anchored citizen strays from the fixture they belong to. One tile:
 * far enough that they shuffle rather than stand frozen, close enough that they
 * still read as being *at* the well rather than near it.
 */
const ANCHOR_RADIUS_TILES = 1;
/**
 * The fountain needs two, because it is not one tile: it is a solid 3 x 3, so a
 * radius-1 circle around its centre admits only that centre and its four
 * cardinals — all five of them fountain. The bubble came back empty and the two
 * children were silently dropped. The first walkable ring is at distance 2.
 */
const FOUNTAIN_ANCHOR_RADIUS_TILES = 2;
const WELL_DRAWERS_PER_WELL = 1;
const FOUNTAIN_CHILDREN = 2;
const DOORSTEP_ANCHORS_PER_BUILDING = 1;
/**
 * The doorways worth posting someone permanently on, and who stands there.
 *
 * Keyed by building name, which is what `buildingEntries` carries — and matched
 * by lookup rather than by index, so a building the `TownPlan` drops simply
 * loses its anchor instead of giving the next building in the list a bouncer.
 */
const DOORSTEP_ANCHOR_ROLES: ReadonlyArray<readonly [string, TownRole]> = [
  ['The Rusty Anvil', 'smith'],
  ['The Desperado Club', 'guard'],
  ['The Sleeping Cat Inn', 'innkeeper'],
  ['Temple of the Sky', 'priest'],
];
// Anchored citizens barely move and mostly stand: the slowest speeds and the
// longest pauses of any cohort.
const ANCHOR_SPEED_MIN = 0.2;
const ANCHOR_SPEED_MAX = 0.4;
const ANCHOR_PAUSE_MIN = 180;
const ANCHOR_PAUSE_MAX = 600;

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

/**
 * One tile per cell. Both queries against this grid — separation and the talk
 * prompt — have a radius near one tile, so a query touches a handful of cells.
 */
const TOWNSFOLK_GRID_CELL_SIZE = TILE_SIZE;

/** Floor on how close a citizen must be to update every frame; see `fullUpdateRadiusSq`. */
const FULL_UPDATE_RADIUS_TILES = 30;
const FULL_UPDATE_RADIUS_PX = TILE_SIZE * FULL_UPDATE_RADIUS_TILES;
/** Everyone further out updates on one frame in this many. */
const DISTANT_TICK_INTERVAL = 4;

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
  private readonly doorTiles: Set<number>;
  private readonly plazaTiles: TileXY[];
  private readonly streetTiles: TileXY[];
  private readonly districtDoors: TileXY[];
  private readonly centre: TileXY;
  private readonly plazaRadius: number;
  private readonly districtRadius: number;
  private readonly plazaWander: WanderParams;
  private seedCount = 0;
  /**
   * Spatial index over the crowd. The separation pass and the talk-target
   * lookup both only care about citizens within a tile or two, and the town
   * holds enough people that scanning all of them was the system's whole cost.
   */
  private readonly grid = new SpatialGrid<Townsperson>(TOWNSFOLK_GRID_CELL_SIZE);
  /** Reused result set for grid queries. */
  private readonly neighborQuery = new Set<Townsperson>();
  private frameCounter = 0;

  constructor(private readonly gameMap: GameMap) {
    // Read from the map, not recomputed as `gridSize / 2`, which is only ever
    // right because the plaza happens to be centred on the map — and kept as a
    // point rather than one number, which quietly assumed it sits on the diagonal.
    const mapCentre = Math.floor(gameMap.gridSize / 2);
    this.centre = gameMap.townSquareCentre ?? { x: mapCentre, y: mapCentre };
    const safeRadius = gameMap.townSafeRadius ?? 0;
    this.plazaRadius = Math.min(safeRadius, PLAZA_RADIUS_TILES);
    this.districtRadius = Math.min(safeRadius, DISTRICT_RADIUS_TILES);
    this.doorTiles = new Set(
      gameMap.buildingEntries.map((entry) => tileCoordKey(entry.doorTile.x, entry.doorTile.y)),
    );
    this.districtDoors = gameMap.buildingEntries
      .map((entry) => entry.doorTile)
      .filter((door) => this.withinRadius(door.x, door.y, this.districtRadius));
    // Paved only: the plaza slab and the lane mouths opening onto it. Accepting
    // every walkable tile in the radius let the crowd spill onto the verge and
    // through the Plaza Ring's front gardens.
    this.plazaTiles = this.gatherTiles(this.plazaRadius, (tx, ty) => this.isPaved(tx, ty));
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
    this.spawnActivityAnchors();
  }

  /** The current crowd, for the scene's Y-sorted entity render pass. */
  get people(): ReadonlyArray<Townsperson> {
    return this.townsfolk;
  }

  /** The nearest citizen the player (at world origin `x`,`y`) can talk to, or `null`. */
  findTalkTarget(x: number, y: number): Townsperson | null {
    this.neighborQuery.clear();
    const nearby = this.grid.queryCircle(x, y, TALK_RADIUS, this.neighborQuery);
    return findNearestTownsperson(nearby, x, y, TALK_RADIUS);
  }

  update(ctx: SystemContext): void {
    this.frameCounter++;
    const { active } = ctx;
    const fullUpdateRadiusSq = this.fullUpdateRadiusSq();

    for (let i = 0; i < this.townsfolk.length; i++) {
      const person = this.townsfolk[i];
      const dx = person.x - active.x;
      const dy = person.y - active.y;
      const isNearPlayer = dx * dx + dy * dy <= fullUpdateRadiusSq;
      // Distant citizens step coarsely. They still drift to plausible places,
      // and the phase offset keeps the skipped work spread across frames.
      if (!isNearPlayer && (this.frameCounter + i) % DISTANT_TICK_INTERVAL !== 0) continue;

      const oldX = person.x;
      const oldY = person.y;
      person.update();
      this.grid.move(person, oldX, oldY);
    }
    this.separate();
  }

  /**
   * How far a citizen may be from the player and still update every frame.
   *
   * Never less than the visible area: a citizen who is drawn but only stepped
   * one frame in four visibly stutters, and the viewport is the canvas, which
   * is the window. The constant floor keeps a small window from making the
   * crowd's behaviour depend on window size.
   */
  private fullUpdateRadiusSq(): number {
    const halfViewW = viewportWidth() / 2;
    const halfViewH = viewportHeight() / 2;
    const visibleReach = Math.hypot(halfViewW, halfViewH) + TILE_SIZE;
    const radius = Math.max(FULL_UPDATE_RADIUS_PX, visibleReach);
    return radius * radius;
  }

  /** Enumerate every walkable, non-door tile inside `radius` that `accept` allows. */
  private gatherTiles(radius: number, accept: (tx: number, ty: number) => boolean): TileXY[] {
    if (radius <= 0) return [];
    const minX = this.centre.x - radius;
    const maxX = this.centre.x + radius;
    const minY = this.centre.y - radius;
    const maxY = this.centre.y + radius;
    const tiles: TileXY[] = [];
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (this.doorTiles.has(tileCoordKey(tx, ty))) continue;
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
    const dx = tx - this.centre.x;
    const dy = ty - this.centre.y;
    return dx * dx + dy * dy <= radius * radius;
  }

  /**
   * True for the surfaces citizens read as public space: the lanes, the two main
   * streets, the plaza, the packed-earth alleys and tracks, and worn patches of
   * those tracks.
   *
   * Verge and yard are excluded even though both are walkable and both are paving
   * of a sort. Biasing wander targets onto *streets* is what stops townsfolk
   * drifting across the gardens, drying greens and crop rows the street plan put
   * between the blocks — and a yard belongs to the building it serves, not to the
   * public.
   */
  private isPaved(tx: number, ty: number): boolean {
    const size = this.gameMap.gridSize;
    if (tx < 0 || ty < 0 || tx >= size || ty >= size) return false;
    return STREET_TILE_TYPES.has(this.gameMap.structure[ty][tx].type);
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

  /**
   * Someone at every fixture worth being at: a drawer at each well,
   * the smith outside his forge, children on the fountain steps, and a bouncer on
   * the Desperado Club's door.
   *
   * Anchors are derived from the map — well tiles are found by type, the smithy
   * and the club by their `buildingEntries` — rather than from copied offsets.
   * Both of those coordinates have moved before, and the two systems that had
   * copied them (the murder quest's body, the notice board) are exactly what broke.
   *
   * An anchor is a wander with a one-tile bubble and a long pause, not a fixed
   * position: standing perfectly still beside a well reads as a statue, and the
   * separation pass would push a motionless figure off its spot with nothing to
   * bring it back.
   */
  private spawnActivityAnchors(): void {
    for (const well of this.gameMap.tilesOfType(WELL)) {
      this.addAnchoredCitizen(well, 'commoner', WELL_DRAWERS_PER_WELL, ANCHOR_RADIUS_TILES);
    }
    const fountain = this.gameMap.fountainCentre;
    if (fountain !== undefined) {
      this.addAnchoredCitizen(fountain, 'child', FOUNTAIN_CHILDREN, FOUNTAIN_ANCHOR_RADIUS_TILES);
    }
    for (const [buildingName, role] of DOORSTEP_ANCHOR_ROLES) {
      const entry = this.gameMap.buildingEntries.find((e) => e.name === buildingName);
      if (entry === undefined) continue;
      this.addAnchoredCitizen(
        entry.doorTile,
        role,
        DOORSTEP_ANCHORS_PER_BUILDING,
        ANCHOR_RADIUS_TILES,
      );
    }
  }

  /**
   * `count` citizens who stay within `ANCHOR_RADIUS_TILES` of `fixture`.
   *
   * The fixture itself is solid — a well, a fountain, a doorway — so the ring
   * around it is gathered rather than assumed: an anchor whose bubble contained
   * no walkable tile would spawn its citizens inside the prop.
   */
  private addAnchoredCitizen(
    fixture: TileXY,
    role: TownRole,
    count: number,
    radiusTiles: number,
  ): void {
    const radius = TILE_SIZE * radiusTiles;
    const spots = this.gatherAnchorTiles(fixture, radiusTiles);
    if (spots.length === 0) return;
    const wander: WanderParams = {
      pickTarget: () => randomTilePoint(spots),
      arriveDist: ARRIVE_DIST,
      pauseMin: ANCHOR_PAUSE_MIN,
      pauseMax: ANCHOR_PAUSE_MAX,
      // `isWalkableSpot` already excludes doorways, which matters here: four of
      // the seven anchor sites are doorsteps, and without it a bouncer could drift
      // into the door he is standing beside.
      isWalkable: (x, y) => this.isWalkableSpot(x, y) && withinTiles(x, y, fixture, radius),
    };
    for (let i = 0; i < count; i++) {
      this.addCitizen(
        randomTile(spots),
        roleTable([{ role, weight: 1 }]),
        ANCHOR_SPEED_MIN,
        ANCHOR_SPEED_MAX,
        wander,
      );
    }
  }

  /** Walkable, non-door tiles inside an anchor's bubble. */
  private gatherAnchorTiles(fixture: TileXY, radiusTiles: number): TileXY[] {
    const tiles: TileXY[] = [];
    const radius = TILE_SIZE * radiusTiles;
    for (let ty = fixture.y - radiusTiles; ty <= fixture.y + radiusTiles; ty++) {
      for (let tx = fixture.x - radiusTiles; tx <= fixture.x + radiusTiles; tx++) {
        if (this.doorTiles.has(tileCoordKey(tx, ty))) continue;
        if (!withinTiles(tx * TILE_SIZE, ty * TILE_SIZE, fixture, radius)) continue;
        if (!this.gameMap.isWalkable(tx, ty)) continue;
        tiles.push({ x: tx, y: ty });
      }
    }
    return tiles;
  }

  private addCitizen(
    tile: TileXY,
    roles: RoleTable,
    speedMin: number,
    speedMax: number,
    wander: WanderParams,
  ): void {
    const person = new Townsperson({
      x: tile.x * TILE_SIZE,
      y: tile.y * TILE_SIZE,
      role: pickRole(roles),
      seed: SEED_BASE + this.seedCount * SEED_STRIDE,
      speed: speedMin + Math.random() * (speedMax - speedMin),
      wander,
      initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
    });
    this.townsfolk.push(person);
    this.grid.insert(person);
    this.seedCount++;
  }

  /** Walkable, non-door tiles on a building's doorstep — where its loiterers live. */
  private gatherFrontageTiles(door: TileXY): TileXY[] {
    const tiles: TileXY[] = [];
    for (let ty = door.y - FRONTAGE_RADIUS_TILES; ty <= door.y + FRONTAGE_RADIUS_TILES; ty++) {
      for (let tx = door.x - FRONTAGE_RADIUS_TILES; tx <= door.x + FRONTAGE_RADIUS_TILES; tx++) {
        if (this.doorTiles.has(tileCoordKey(tx, ty))) continue;
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
    const center = this.centre;
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
    if (this.doorTiles.has(tileCoordKey(tx, ty))) return false;
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
    for (const a of this.townsfolk) {
      this.neighborQuery.clear();
      const neighbors = this.grid.queryCircle(a.x, a.y, SEPARATION_DIST, this.neighborQuery);
      for (const b of neighbors) {
        // Each pair is pushed apart once, as in the old i < j double loop.
        if (b.id <= a.id) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= SEPARATION_DIST || Math.abs(dy) >= SEPARATION_DIST) continue;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= SEPARATION_DIST) continue;
        const nx = (dx / dist) * SEPARATION_PUSH;
        const ny = (dy / dist) * SEPARATION_PUSH;
        if (this.isWalkableSpot(a.x - nx, a.y - ny)) {
          const oldX = a.x;
          const oldY = a.y;
          a.x -= nx;
          a.y -= ny;
          this.grid.move(a, oldX, oldY);
        }
        if (this.isWalkableSpot(b.x + nx, b.y + ny)) {
          const oldX = b.x;
          const oldY = b.y;
          b.x += nx;
          b.y += ny;
          this.grid.move(b, oldX, oldY);
        }
      }
    }
  }
}

function tileDistSq(a: TileXY, b: TileXY): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** True when a world point is inside `radius` pixels of a fixture's tile origin. */
function withinTiles(worldX: number, worldY: number, fixture: TileXY, radius: number): boolean {
  const dx = worldX - fixture.x * TILE_SIZE;
  const dy = worldY - fixture.y * TILE_SIZE;
  return dx * dx + dy * dy <= radius * radius;
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
