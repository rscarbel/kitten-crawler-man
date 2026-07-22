/**
 * Populates a building's interior with role-appropriate occupants who perform
 * stationed activities — a smith at the forge, patrons at the tables, a barkeep
 * behind the counter — so walking in feels rewarding rather than like touring an
 * empty diorama. Owned by `BuildingInteriorScene` and the interior analog of
 * `TownLifeSystem`: instead of free-roaming a plaza, each occupant is anchored to
 * a piece of the hand-crafted furniture and only shuffles within a small radius
 * of it.
 *
 * Anchors are *derived* from the generated interior, not hard-coded: the system
 * scans the finished grid for furniture (forge braziers, hearths, tables,
 * shelves, counters) and stands each occupant on a walkable tile beside the
 * relevant piece. That keeps this decoupled from the exact column/row constants
 * inside `GameMap.generateInterior` — re-arrange a room and the occupants follow
 * the furniture.
 *
 * Never constructed for a live quest-encounter interior (Big Top boss, cult
 * hideout, tower confrontation): the scene passes `null` occupants whenever its
 * combat stack is active, mirroring the gate `initEntryEncounter` uses.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { Townsperson } from '../creatures/Townsperson';
import { findNearestTownsperson } from '../creatures/townInteraction';
import type { WanderParams } from '../creatures/townWander';
import type { TownRole } from '../sprites/person/PersonAppearance';
import type { Facing } from '../sprites/person/skeleton';
import {
  BRAZIER,
  FIREPLACE,
  TABLE,
  BOOKSHELF,
  CRATE,
  BARREL,
  FloorTypeValue,
} from '../map/tileTypes';
import type { BuildingEntry } from './BuildingSystem';
import type { GameSystem } from './GameSystem';

/** Which furniture a role stations beside; resolved to concrete tiles by scanning the room. */
type AnchorKind = 'forge' | 'hearth' | 'table' | 'shelf' | 'counter' | 'crate';

/** What an occupant is doing — drives how far they roam and how long they linger. */
type InteriorActivity =
  | 'work_forge'
  | 'tend_counter'
  | 'sit_at_table'
  | 'browse_shelf'
  | 'sweep'
  | 'wander'
  | 'idle';

interface OccupantSpec {
  role: TownRole;
  activity: InteriorActivity;
  anchor: AnchorKind;
}

/**
 * The furniture tile types each anchor kind matches. `counter` is any *interior*
 * wall run (never the perimeter — the scan skips the border). Ordered as a list
 * so the furniture scan can iterate kinds without an unsound `Object.keys` cast.
 */
const ANCHOR_TILE_TYPES: ReadonlyArray<{ kind: AnchorKind; types: ReadonlyArray<number> }> = [
  { kind: 'forge', types: [BRAZIER] },
  { kind: 'hearth', types: [FIREPLACE] },
  { kind: 'table', types: [TABLE] },
  { kind: 'shelf', types: [BOOKSHELF] },
  { kind: 'counter', types: [FloorTypeValue.wall] },
  { kind: 'crate', types: [CRATE, BARREL] },
];

interface ActivityBehavior {
  /** How far (tiles) the occupant may drift from its stand tile. */
  radiusTiles: number;
  pauseMin: number;
  pauseMax: number;
}

// Stationed workers barely move and pause for long stretches; roamers cover more ground more often.
const PAUSE_STATIONED_MIN = 90;
const PAUSE_STATIONED_MAX = 360;
const PAUSE_ROAMING_MIN = 30;
const PAUSE_ROAMING_MAX = 150;

const ACTIVITY_BEHAVIOR: Record<InteriorActivity, ActivityBehavior> = {
  work_forge: { radiusTiles: 0.6, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  tend_counter: { radiusTiles: 0.5, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  sit_at_table: { radiusTiles: 0.4, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  browse_shelf: { radiusTiles: 0.9, pauseMin: PAUSE_ROAMING_MIN, pauseMax: PAUSE_STATIONED_MIN },
  idle: { radiusTiles: 0.6, pauseMin: PAUSE_STATIONED_MIN, pauseMax: PAUSE_STATIONED_MAX },
  sweep: { radiusTiles: 1.8, pauseMin: PAUSE_ROAMING_MIN, pauseMax: PAUSE_ROAMING_MAX },
  wander: { radiusTiles: 2.6, pauseMin: PAUSE_ROAMING_MIN, pauseMax: PAUSE_ROAMING_MAX },
};

/** Occupants for each marquee building, keyed by the name `GameMap.generateInterior` lays out. */
const BUILDING_OCCUPANTS = new Map<string, ReadonlyArray<OccupantSpec>>(
  Object.entries({
    'The Rusty Anvil': [
      { role: 'smith', activity: 'work_forge', anchor: 'forge' },
      { role: 'laborer', activity: 'idle', anchor: 'crate' },
    ],
    'The Sleeping Cat Inn': [
      { role: 'innkeeper', activity: 'idle', anchor: 'hearth' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table' },
      { role: 'child', activity: 'wander', anchor: 'table' },
    ],
    "The Wanderer's Rest": [
      { role: 'laborer', activity: 'sit_at_table', anchor: 'table' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table' },
      { role: 'beggar', activity: 'wander', anchor: 'table' },
    ],
    'The Sunken Stump Pub': [
      { role: 'innkeeper', activity: 'tend_counter', anchor: 'counter' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table' },
      { role: 'drunk', activity: 'sit_at_table', anchor: 'table' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table' },
    ],
    "Miller's Farm": [
      { role: 'farmer', activity: 'idle', anchor: 'hearth' },
      { role: 'commoner', activity: 'sit_at_table', anchor: 'table' },
    ],
    'Herb & Remedy': [
      { role: 'merchant', activity: 'tend_counter', anchor: 'counter' },
      { role: 'priest', activity: 'browse_shelf', anchor: 'shelf' },
    ],
    "Shepherd's Cabin": [{ role: 'farmer', activity: 'idle', anchor: 'hearth' }],
    "Cartwright's Workshop": [
      { role: 'laborer', activity: 'idle', anchor: 'table' },
      { role: 'laborer', activity: 'idle', anchor: 'crate' },
    ],
    "Old Hilda's Cottage": [{ role: 'priest', activity: 'browse_shelf', anchor: 'shelf' }],
    'Blackwood Barracks': [
      { role: 'guard', activity: 'idle', anchor: 'table' },
      { role: 'guard', activity: 'wander', anchor: 'crate' },
    ],
  }),
);

/** Light company for the town-service interiors, which already have their own scripted NPCs. */
const TYPE_OCCUPANTS: Partial<Record<BuildingEntry['type'], ReadonlyArray<OccupantSpec>>> = {
  restaurant: [
    { role: 'commoner', activity: 'sit_at_table', anchor: 'table' },
    { role: 'noble', activity: 'sit_at_table', anchor: 'table' },
  ],
  store: [{ role: 'commoner', activity: 'browse_shelf', anchor: 'shelf' }],
};

// An occupant within this range of the player shows a Talk prompt / is talkable.
const TALK_RADIUS_TILES = 1.1;
const TALK_RADIUS = TILE_SIZE * TALK_RADIUS_TILES;

const OCCUPANT_SEED_BASE = 5209;
const OCCUPANT_SEED_STRIDE = 71;
const OCCUPANT_SPEED = 0.4;
const MAX_INITIAL_PAUSE = 180;
// A target counts as reached within this fraction of a tile — tight, so a small
// wander radius still registers arrivals and the occupant keeps lingering.
const ARRIVE_DIST_FRACTION = 0.35;
const ARRIVE_DIST = TILE_SIZE * ARRIVE_DIST_FRACTION;
// Rings searched outward from a furniture tile for a walkable spot to stand.
const STAND_SEARCH_RADIUS_TILES = 2;
// Attempts to sample a walkable wander target before falling back to standing put.
const WANDER_SAMPLE_ATTEMPTS = 6;
// Half a tile: from a figure's top-left draw origin to the point under its feet.
const CENTER_OFFSET = TILE_SIZE / 2;
// The cat companion spawns one tile east of the human's startTile (PlayerManager.setPositions).
const CAT_SPAWN_TILE_OFFSET_X = 1;

interface TileXY {
  x: number;
  y: number;
}

export class InteriorOccupantSystem implements GameSystem {
  private readonly occupants: Townsperson[] = [];

  /**
   * Builds the occupant system for a building, or returns `null` when the
   * building takes no ambient occupants (towers, the club, the Big Top, or any
   * type with no authored roster). The scene calls this only when no live quest
   * encounter owns the interior.
   */
  static forBuilding(
    map: GameMap,
    type: BuildingEntry['type'],
    name: string,
  ): InteriorOccupantSystem | null {
    if (type === 'tower' || type === 'club' || name === 'Big Top') return null;
    const specs = BUILDING_OCCUPANTS.get(name) ?? TYPE_OCCUPANTS[type];
    if (specs === undefined || specs.length === 0) return null;
    const system = new InteriorOccupantSystem(map, specs);
    return system.occupants.length > 0 ? system : null;
  }

  private constructor(
    private readonly map: GameMap,
    specs: ReadonlyArray<OccupantSpec>,
  ) {
    const furniture = this.scanFurniture();
    const groupCursors = new Map<AnchorKind, number>();
    const usedStands = new Set<string>();
    const reserved = this.reservedTiles();

    specs.forEach((spec, index) => {
      const anchorTiles = furniture.get(spec.anchor);
      if (anchorTiles === undefined || anchorTiles.length === 0) return;
      const placement = this.placeAtAnchor(
        spec.anchor,
        anchorTiles,
        groupCursors,
        usedStands,
        reserved,
      );
      if (placement === null) return;
      usedStands.add(tileKey(placement.stand.x, placement.stand.y));
      this.occupants.push(this.makeOccupant(spec, placement, index));
    });
  }

  /** The occupants, for the scene's Y-sorted interior render pass. */
  get people(): ReadonlyArray<Townsperson> {
    return this.occupants;
  }

  /** The nearest occupant the player (at world origin `x`,`y`) can talk to, or `null`. */
  findTalkTarget(x: number, y: number): Townsperson | null {
    return findNearestTownsperson(this.occupants, x, y, TALK_RADIUS);
  }

  update(): void {
    for (const occupant of this.occupants) occupant.update();
  }

  /** Group every interior furniture tile by the anchor kind it can host. */
  private scanFurniture(): Map<AnchorKind, TileXY[]> {
    const groups = new Map<AnchorKind, TileXY[]>();
    const structure = this.map.structure;
    for (let y = 1; y < structure.length - 1; y++) {
      const row = structure[y];
      for (let x = 1; x < row.length - 1; x++) {
        const type = row[x].type;
        for (const { kind, types } of ANCHOR_TILE_TYPES) {
          if (!types.includes(type)) continue;
          const list = groups.get(kind) ?? [];
          list.push({ x, y });
          groups.set(kind, list);
        }
      }
    }
    return groups;
  }

  /** Tiles occupants must never stand on: the entrance/exit and both players' spawns. */
  private reservedTiles(): Set<string> {
    const reserved = new Set<string>();
    for (const exit of this.map._interiorExitTiles) reserved.add(tileKey(exit.x, exit.y));
    // The human spawns on startTile and the cat one tile east — see PlayerManager.setPositions.
    const start = this.map.startTile;
    reserved.add(tileKey(start.x, start.y));
    reserved.add(tileKey(start.x + CAT_SPAWN_TILE_OFFSET_X, start.y));
    return reserved;
  }

  /**
   * Walks the anchor group in order, standing the occupant on the first
   * furniture tile that still has a free walkable neighbor. Returns the stand
   * tile plus the facing that points back at the furniture.
   */
  private placeAtAnchor(
    kind: AnchorKind,
    anchorTiles: ReadonlyArray<TileXY>,
    cursors: Map<AnchorKind, number>,
    usedStands: Set<string>,
    reserved: Set<string>,
  ): { stand: TileXY; furniture: TileXY; facing: Facing } | null {
    const start = cursors.get(kind) ?? 0;
    for (let offset = 0; offset < anchorTiles.length; offset++) {
      const idx = (start + offset) % anchorTiles.length;
      const furniture = anchorTiles[idx];
      const stand = this.findStandTile(furniture, usedStands, reserved);
      if (stand === null) continue;
      cursors.set(kind, idx + 1);
      return { stand, furniture, facing: facingToward(stand, furniture) };
    }
    return null;
  }

  /** Nearest walkable, unclaimed interior tile to `furniture`, searched in expanding rings. */
  private findStandTile(
    furniture: TileXY,
    usedStands: Set<string>,
    reserved: Set<string>,
  ): TileXY | null {
    for (let radius = 1; radius <= STAND_SEARCH_RADIUS_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tx = furniture.x + dx;
          const ty = furniture.y + dy;
          const key = tileKey(tx, ty);
          if (usedStands.has(key) || reserved.has(key)) continue;
          if (this.map.isWalkable(tx, ty)) return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  private makeOccupant(
    spec: OccupantSpec,
    placement: { stand: TileXY; facing: Facing },
    index: number,
  ): Townsperson {
    const behavior = ACTIVITY_BEHAVIOR[spec.activity];
    const wander = this.buildWander(placement.stand, behavior);
    return new Townsperson({
      x: placement.stand.x * TILE_SIZE,
      y: placement.stand.y * TILE_SIZE,
      role: spec.role,
      seed: OCCUPANT_SEED_BASE + index * OCCUPANT_SEED_STRIDE,
      speed: OCCUPANT_SPEED,
      wander,
      initialFacing: placement.facing,
      initialPause: Math.floor(Math.random() * MAX_INITIAL_PAUSE),
    });
  }

  /** A wander confined to a small radius of the stand tile, so the occupant holds its post. */
  private buildWander(stand: TileXY, behavior: ActivityBehavior): WanderParams {
    const centerX = stand.x * TILE_SIZE;
    const centerY = stand.y * TILE_SIZE;
    const radiusPx = behavior.radiusTiles * TILE_SIZE;
    return {
      pickTarget: () => this.sampleNearby(centerX, centerY, radiusPx),
      arriveDist: ARRIVE_DIST,
      pauseMin: behavior.pauseMin,
      pauseMax: behavior.pauseMax,
      isWalkable: (x, y) => this.isInteriorWalkable(x, y),
    };
  }

  /** A random walkable point within `radiusPx` of the anchor; falls back to the anchor itself. */
  private sampleNearby(
    centerX: number,
    centerY: number,
    radiusPx: number,
  ): { x: number; y: number } {
    for (let attempt = 0; attempt < WANDER_SAMPLE_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radiusPx;
      const x = centerX + Math.cos(angle) * dist;
      const y = centerY + Math.sin(angle) * dist;
      if (this.isInteriorWalkable(x, y)) return { x, y };
    }
    return { x: centerX, y: centerY };
  }

  private isInteriorWalkable(worldX: number, worldY: number): boolean {
    const tx = Math.floor((worldX + CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((worldY + CENTER_OFFSET) / TILE_SIZE);
    return this.map.isWalkable(tx, ty);
  }
}

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** The cardinal facing that points from `from` toward `to`. */
function facingToward(from: TileXY, to: TileXY): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
