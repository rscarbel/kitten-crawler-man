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
  roomMobs: [],
  hallwayMobs: [],
  nextLevelId: 'level1',
};
