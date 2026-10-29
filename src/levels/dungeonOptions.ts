import type { DungeonLevelOptions } from '../map/DungeonGenerator';
import type { LevelDef } from './types';
import { BASE_DEFEND_QUEST_INTENSITY } from './defendQuestIntensity';
import { DEFAULT_DUNGEON_FLOOR_THEME } from '../map/dungeon/floorTheme';

/**
 * The generator settings a level implies, everything except the map's size.
 *
 * Shared by the scene that builds the real map and the verification harness that
 * generates the same floors headlessly, so the harness can never drift from the
 * numbers the game actually plays with.
 */
export function dungeonOptionsForLevel(levelDef: LevelDef): DungeonLevelOptions {
  return {
    bossTypes: levelDef.bossRooms?.map((b) => b.type) ?? [],
    numStairwellsOverride: levelDef.numStairwells,
    stairwellCountMultiplier: levelDef.stairwellCountMultiplier,
    hasSpiderLab: levelDef.hasSpiderLab ?? false,
    progression: levelDef.progression,
    questGrateCount: (levelDef.defendQuestIntensity ?? BASE_DEFEND_QUEST_INTENSITY).grateCount,
    floorTheme: levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME,
  };
}
