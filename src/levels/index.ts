import type { LevelDef } from './types';
import { level1 } from './level1';
import { level2 } from './level2';
import { level3 } from './level3';

const registry = new Map<string, LevelDef>([
  ['level1', level1],
  ['level2', level2],
  ['level3', level3],
]);

/** Look up a level by ID. Throws if the ID is not registered. */
export function getLevelDef(id: string): LevelDef {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown level id: "${id}"`);
  return def;
}

export { level1, level2, level3 };
export type { LevelDef, MobSpawnRule } from './types';
