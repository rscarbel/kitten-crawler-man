import type { LevelDef } from './types';

/**
 * The tutorial's level id, exported so code that must not treat it as a real
 * dungeon floor can say so. It shares `floorNumber: 1` with the first real floor
 * — the two are the same rung of the progression — but its hand-crafted map has
 * none of that floor's bosses or quests on it.
 */
export const TUTORIAL_LEVEL_ID = 'tutorial';

export const tutorialLevel: LevelDef = {
  id: TUTORIAL_LEVEL_ID,
  name: 'Tutorial',
  floorNumber: 1,
  music: 'bg_level_1',
  // The same rung as floor 1, so the same cellars. Stated rather than left to
  // `DEFAULT_DUNGEON_FLOOR_THEME` so that every level answers for its own art.
  groundTheme: 'cellars',
  /**
   * mapSize is unused — the tutorial uses a hand-crafted TutorialMap (prebuiltStructure)
   * instead of procedural generation. Keep a plausible value for type correctness.
   */
  mapSize: 90,
  // Shares floor 1's "cellars" theme and safe-room furniture; its hand-built
  // map has no bosses or quest content of its own, so no groups beyond that.
  spriteGroups: ['core', 'dungeon_common', 'floor1_tileset'],
  roomMobs: [],
  hallwayMobs: [],
  nextLevelId: 'level1',
};
