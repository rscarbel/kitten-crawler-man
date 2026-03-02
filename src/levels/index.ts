import type { LevelDef } from './types';
import { level1 } from './level1';

const registry = new Map<string, LevelDef>([['level1', level1]]);

/** Look up a level by ID. Throws if the ID is not registered. */
export function getLevelDef(id: string): LevelDef {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown level id: "${id}"`);
  return def;
}

export { level1 };
export type { LevelDef, MobSpawnRule } from './types';
