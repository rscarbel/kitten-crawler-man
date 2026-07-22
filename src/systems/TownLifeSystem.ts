/**
 * Populates the Over City's streets and square with wandering, non-combatant
 * citizens so the town reads as inhabited rather than an empty stage. Owned by
 * `DungeonScene` and active only on the overworld: it seeds a fixed population
 * across the walkable town tiles, strolls them each frame via the shared wander
 * helper (respecting walls and keeping clear of building doors), and exposes the
 * crowd for the scene's Y-sorted render pass. Combat, mobs, and the player are
 * untouched — these figures are pure ambience.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { Townsperson } from '../creatures/Townsperson';
import { findNearestTownsperson } from '../creatures/townInteraction';
import type { WanderParams } from '../creatures/townWander';
import type { TownRole } from '../sprites/person/PersonAppearance';
import type { GameSystem } from './GameSystem';

const DEFAULT_TOWN_POPULATION = 28;
// Spread appearance seeds far apart so neighbors don't share a look.
const SEED_STRIDE = 101;
const SEED_BASE = 1301;

// The town's safe radius (55 tiles) reaches far into the approach roads; a crowd
// spread that thin never reads as busy. Cap the inhabited zone to the square and
// its immediate streets so the population actually clusters where the player is.
const TOWN_LIFE_RADIUS_TILES = 20;

// A citizen within this range of the player shows a Talk prompt / is talkable.
const TALK_RADIUS_TILES = 1.1;
const TALK_RADIUS = TILE_SIZE * TALK_RADIUS_TILES;

const WALK_SPEED_MIN = 0.35;
const WALK_SPEED_MAX = 0.9;
const ARRIVE_DIST = TILE_SIZE / 2;
const PAUSE_MIN = 30;
const PAUSE_MAX = 240;
const MAX_INITIAL_PAUSE = 180;

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

// A believable street mix: mostly ordinary folk, a sprinkling of color.
const ROLE_WEIGHTS: ReadonlyArray<RoleWeight> = [
  { role: 'commoner', weight: 6 },
  { role: 'laborer', weight: 4 },
  { role: 'farmer', weight: 3 },
  { role: 'merchant', weight: 2 },
  { role: 'guard', weight: 2 },
  { role: 'child', weight: 2 },
  { role: 'noble', weight: 1 },
  { role: 'beggar', weight: 1 },
  { role: 'drunk', weight: 1 },
];

interface TileXY {
  x: number;
  y: number;
}

export class TownLifeSystem implements GameSystem {
  private readonly townsfolk: Townsperson[] = [];
  private readonly doorTiles: Set<string>;
  private readonly candidateTiles: TileXY[];
  private readonly totalRoleWeight: number;
  private readonly wanderParams: WanderParams;
  private readonly centerTile: number;
  private readonly lifeRadius: number;

  constructor(
    private readonly gameMap: GameMap,
    targetPopulation: number = DEFAULT_TOWN_POPULATION,
  ) {
    this.centerTile = Math.floor(gameMap.gridSize / 2);
    const safeRadius = gameMap.townSafeRadius;
    this.lifeRadius = safeRadius === null ? 0 : Math.min(safeRadius, TOWN_LIFE_RADIUS_TILES);
    this.doorTiles = new Set(
      gameMap.buildingEntries.map((entry) => tileKey(entry.doorTile.x, entry.doorTile.y)),
    );
    this.candidateTiles = this.gatherCandidateTiles();
    this.totalRoleWeight = ROLE_WEIGHTS.reduce((sum, rw) => sum + rw.weight, 0);
    this.wanderParams = {
      pickTarget: () => this.randomTownPoint(),
      arriveDist: ARRIVE_DIST,
      pauseMin: PAUSE_MIN,
      pauseMax: PAUSE_MAX,
      isWalkable: (x, y) => this.isTownWalkable(x, y),
    };
    this.spawn(targetPopulation);
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

  /** Enumerate every walkable, non-door tile inside the inhabited radius. */
  private gatherCandidateTiles(): TileXY[] {
    if (this.lifeRadius <= 0) return [];
    const min = this.centerTile - this.lifeRadius;
    const max = this.centerTile + this.lifeRadius;
    const tiles: TileXY[] = [];
    for (let ty = min; ty <= max; ty++) {
      for (let tx = min; tx <= max; tx++) {
        if (this.isSpawnableTile(tx, ty)) tiles.push({ x: tx, y: ty });
      }
    }
    return tiles;
  }

  private isSpawnableTile(tx: number, ty: number): boolean {
    if (this.doorTiles.has(tileKey(tx, ty))) return false;
    if (!this.gameMap.isWalkable(tx, ty)) return false;
    return this.withinLifeRadius(tx, ty);
  }

  /** True when tile (tx, ty) lies inside the capped inhabited radius. */
  private withinLifeRadius(tx: number, ty: number): boolean {
    const dx = tx - this.centerTile;
    const dy = ty - this.centerTile;
    return dx * dx + dy * dy <= this.lifeRadius * this.lifeRadius;
  }

  private spawn(targetPopulation: number): void {
    if (this.candidateTiles.length === 0) return;
    const count = Math.min(targetPopulation, this.candidateTiles.length);
    for (let i = 0; i < count; i++) {
      const tile = this.centerBiasedTile();
      this.townsfolk.push(
        new Townsperson({
          x: tile.x * TILE_SIZE,
          y: tile.y * TILE_SIZE,
          role: this.randomRole(),
          seed: SEED_BASE + i * SEED_STRIDE,
          speed: WALK_SPEED_MIN + Math.random() * (WALK_SPEED_MAX - WALK_SPEED_MIN),
          wander: this.wanderParams,
          initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
        }),
      );
    }
  }

  /** A random candidate tile, biased toward the plaza by keeping the more central of two draws. */
  private centerBiasedTile(): TileXY {
    let best = this.candidateTiles[Math.floor(Math.random() * this.candidateTiles.length)];
    let bestDist = tileDistSq(best, this.centerTile);
    for (let s = 1; s < CENTER_BIAS_SAMPLES; s++) {
      const cand = this.candidateTiles[Math.floor(Math.random() * this.candidateTiles.length)];
      const dist = tileDistSq(cand, this.centerTile);
      if (dist < bestDist) {
        best = cand;
        bestDist = dist;
      }
    }
    return best;
  }

  private randomTownPoint(): { x: number; y: number } {
    const tile = this.candidateTiles[Math.floor(Math.random() * this.candidateTiles.length)];
    return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
  }

  private randomRole(): TownRole {
    let roll = Math.random() * this.totalRoleWeight;
    for (const rw of ROLE_WEIGHTS) {
      roll -= rw.weight;
      if (roll < 0) return rw.role;
    }
    return 'commoner';
  }

  /** Walkability gate for wander: inside the inhabited radius, on a walkable non-door tile. */
  private isTownWalkable(worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    if (!this.withinLifeRadius(tx, ty)) return false;
    if (this.doorTiles.has(tileKey(tx, ty))) return false;
    return this.gameMap.isWalkable(tx, ty);
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
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= SEPARATION_DIST) continue;
        const nx = (dx / dist) * SEPARATION_PUSH;
        const ny = (dy / dist) * SEPARATION_PUSH;
        if (this.isTownWalkable(a.x - nx, a.y - ny)) {
          a.x -= nx;
          a.y -= ny;
        }
        if (this.isTownWalkable(b.x + nx, b.y + ny)) {
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

function tileDistSq(tile: TileXY, center: number): number {
  const dx = tile.x - center;
  const dy = tile.y - center;
  return dx * dx + dy * dy;
}
