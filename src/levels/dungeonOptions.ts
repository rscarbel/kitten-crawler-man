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
  const { progression } = levelDef;
  if (progression === undefined) {
    throw new Error(
      `${levelDef.id} declares no progression, so it is not a generated dungeon floor`,
    );
  }
  return {
    numStairwellsOverride: levelDef.numStairwells,
    stairwellCountMultiplier: levelDef.stairwellCountMultiplier,
    hasSpiderLab: levelDef.hasSpiderLab ?? false,
    progression,
    questGrateCount: (levelDef.defendQuestIntensity ?? BASE_DEFEND_QUEST_INTENSITY).grateCount,
    floorTheme: levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME,
  };
}

/** Where a level's `GameMap` gets its tiles: the overworld generator, or the dungeon generator with this level's settings. */
export function mapSourceForLevel(levelDef: LevelDef) {
  return levelDef.isOverworld
    ? { mapType: 'overworld' as const }
    : { dungeon: dungeonOptionsForLevel(levelDef) };
}
