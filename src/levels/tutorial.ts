import type { LevelDef } from './types';

export const tutorialLevel: LevelDef = {
  id: 'tutorial',
  name: 'Tutorial',
  floorNumber: 1,
  /**
   * mapSize is unused — the tutorial uses a hand-crafted TutorialMap (prebuiltStructure)
   * instead of procedural generation. Keep a plausible value for type correctness.
   */
  mapSize: 90,
  roomMobs: [],
  hallwayMobs: [],
  nextLevelId: 'level1',
};
