import type { DungeonLevelOptions } from '../map/DungeonGenerator';
import type { LevelDef } from './types';

/** Boss rooms carved when a level declares none. */
const DEFAULT_BOSS_ROOM_COUNT = 1;

/**
 * The generator settings a level implies, everything except the map's size.
 *
 * Shared by the scene that builds the real map and the verification harness that
 * generates the same floors headlessly, so the harness can never drift from the
 * numbers the game actually plays with.
 */
export function dungeonOptionsForLevel(levelDef: LevelDef): DungeonLevelOptions {
  return {
    numBossRooms: levelDef.bossRooms?.length ?? DEFAULT_BOSS_ROOM_COUNT,
    numStairwellsOverride: levelDef.numStairwells,
    hasArena: levelDef.hasArena ?? false,
    bossTypes: levelDef.bossRooms?.map((b) => b.type) ?? [],
    hasSpiderLab: levelDef.hasSpiderLab ?? false,
    progression: levelDef.progression,
  };
}
