/**
 * Which character each room and hallway segment of a generated floor was
 * given, and the lookups render, lighting and audio read it through.
 */

import type { Rng } from '../../sprites/person/rng';
import {
  HALLWAY_REGION_BASE,
  NO_REGION,
  RegionMap,
  type HallwayRegion,
  type Zone,
} from '../regionMap';
import type { DungeonFloorThemeId } from './floorTheme';
import {
  HALLWAY_CHARACTERS_BY_FLOOR,
  ROOM_CHARACTERS_BY_FLOOR,
  SPECIAL_REGION_LIGHTING,
  UNLIT_ROOM_CHANCE,
  UNLIT_ROOM_ZONES,
  type HallwayCharacter,
  type LightingProfile,
  type RegionCharacter,
  type RoomCharacter,
  type SpecialRegionTag,
} from './roomCharacters';

/** A populated room and the character it was dressed as. */
export interface RoomCharacterAssignment {
  readonly type: 'room';
  readonly character: RoomCharacter;
  /** Set on a room rolled to have no static light at all. */
  readonly unlit: boolean;
}

/** A hallway segment and the character it was dressed as. */
export interface HallwayCharacterAssignment {
  readonly type: 'hallway';
  readonly character: HallwayCharacter;
}

/** A region that keeps its own dressing and takes only a lighting profile. */
export interface SpecialRegionAssignment {
  readonly type: 'special';
  readonly tag: SpecialRegionTag;
}

export type RegionAssignment =
  RoomCharacterAssignment | HallwayCharacterAssignment | SpecialRegionAssignment;

/**
 * Every region's assignment on one floor, indexed the way {@link RegionMap}
 * numbers regions.
 *
 * Generation data, like the region map it indexes: rolled once when the floor
 * is built, rebuilt with the map, never checkpointed.
 */
export class RegionCharacters {
  constructor(
    private readonly regionMap: RegionMap,
    /** One entry per room, by room id; null for a room the generator did not dress. */
    private readonly rooms: ReadonlyArray<RegionAssignment | null>,
    /** One entry per hallway segment, by `id - HALLWAY_REGION_BASE`. */
    private readonly hallways: ReadonlyArray<RegionAssignment | null>,
  ) {}

  /** No assignments, for any map that is not a forced-progression dungeon floor. */
  static empty(): RegionCharacters {
    return new RegionCharacters(RegionMap.empty(), [], []);
  }

  /** The assignment of a region id, or null for {@link NO_REGION} and undressed regions. */
  forRegion(id: number): RegionAssignment | null {
    if (id === NO_REGION) return null;
    if (id >= HALLWAY_REGION_BASE) return this.hallways[id - HALLWAY_REGION_BASE] ?? null;
    return this.rooms[id] ?? null;
  }

  /** The assignment of the region a tile lies in. */
  assignmentAt(tileX: number, tileY: number): RegionAssignment | null {
    return this.forRegion(this.regionMap.regionAt(tileX, tileY));
  }

  /** The character of the room or hallway a tile lies in, or null for special and undressed regions. */
  characterAt(tileX: number, tileY: number): RegionCharacter | null {
    const assignment = this.assignmentAt(tileX, tileY);
    if (assignment === null || assignment.type === 'special') return null;
    return assignment.character;
  }

  /**
   * How a region is lit: its character's profile, the special profile of a
   * start, safe, boss, quest or arena region, or null where lighting must
   * leave it alone (the spider lab) or nothing was assigned. An unlit room
   * keeps its character's colour and loses every source.
   */
  lightingFor(id: number): LightingProfile | null {
    const assignment = this.forRegion(id);
    if (assignment === null) return null;
    if (assignment.type === 'special') return SPECIAL_REGION_LIGHTING[assignment.tag];
    if (assignment.type === 'room' && assignment.unlit) {
      return { ambient: 'dark', colour: assignment.character.lighting.colour, sources: [] };
    }
    return assignment.character.lighting;
  }

  /** Whether a region was rolled as an unlit room. */
  isUnlit(id: number): boolean {
    const assignment = this.forRegion(id);
    return assignment?.type === 'room' && assignment.unlit;
  }

  /** Every room assignment, by room id. */
  roomAssignments(): ReadonlyArray<RegionAssignment | null> {
    return this.rooms;
  }

  /** Every hallway assignment, by segment index. */
  hallwayAssignments(): ReadonlyArray<RegionAssignment | null> {
    return this.hallways;
  }
}

/** Picks one entry by weight, or null from an empty list. */
export function pickWeighted<T extends { readonly weight: number }>(
  entries: ReadonlyArray<T>,
  rng: Rng,
): T | null {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1] ?? null;
}

/** Rolls the character of a populated room in `zone` on `floor`. */
export function rollRoomCharacter(
  floor: DungeonFloorThemeId,
  zone: Zone,
  rng: Rng,
): RoomCharacterAssignment | null {
  const eligible = ROOM_CHARACTERS_BY_FLOOR[floor].filter((character) =>
    character.zones.includes(zone),
  );
  const character = pickWeighted<RoomCharacter>(eligible, rng);
  if (character === null) return null;
  // Rolled for every room, eligible zone or not, so the rooms after it draw
  // the same numbers whichever zone this one fell in.
  const unlitRoll = rng();
  const unlit = UNLIT_ROOM_ZONES.includes(zone) && unlitRoll < UNLIT_ROOM_CHANCE;
  return { type: 'room', character, unlit };
}

/**
 * The assignment of a hallway segment: the arena's drum and concourse are a
 * special region, every other segment a hallway character.
 */
export function rollHallwayCharacter(
  floor: DungeonFloorThemeId,
  hallway: HallwayRegion,
  rng: Rng,
): RegionAssignment | null {
  if (hallway.arena) return { type: 'special', tag: 'arena' };
  const eligible = HALLWAY_CHARACTERS_BY_FLOOR[floor].filter((character) =>
    character.zones.includes(hallway.zone),
  );
  const character = pickWeighted<HallwayCharacter>(eligible, rng);
  return character === null ? null : { type: 'hallway', character };
}
