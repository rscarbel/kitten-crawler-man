import type { LevelDef } from './types';
import { LEVEL_IDS, type LevelId } from './levelIds';
import { level1 } from './level1';
import { level2 } from './level2';
import { level3 } from './level3';
import { tutorialLevel } from './tutorial';

const LEVEL_DEFS: Readonly<Record<LevelId, LevelDef>> = {
  tutorial: tutorialLevel,
  level1,
  level2,
  level3,
};

export function getLevelDef(id: LevelId): LevelDef {
  return LEVEL_DEFS[id];
}

/** Every level, in the order a run reaches them. */
export function allLevelDefs(): LevelDef[] {
  return LEVEL_IDS.map((id) => LEVEL_DEFS[id]);
}

/** The small line over a level's name on its loading screen. */
export function levelLoadingKicker(def: LevelDef): string {
  return def.arrivalLoadingScreen.kicker ?? `Floor ${def.floorNumber}`;
}

export { tutorialLevel, level1, level2, level3 };
export type { LevelDef, MobSpawnRule } from './types';
