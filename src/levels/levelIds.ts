/** Every level a run can stand on, in the order a run reaches them. */
export const LEVEL_IDS = ['tutorial', 'level1', 'level2', 'level3'] as const;

export type LevelId = (typeof LEVEL_IDS)[number];

/** A numbered dungeon floor's level id. */
export type DungeonLevelId = Extract<LevelId, `level${number}`>;

/** The number of a numbered dungeon floor, as its level id spells it. */
export type DungeonFloorNumber = DungeonLevelId extends `level${infer N extends number}`
  ? N
  : never;

/** Narrows a level id read from outside the type system, such as a save or a URL. */
export function isLevelId(value: unknown): value is LevelId {
  return LEVEL_IDS.some((id) => id === value);
}

/** A level id from a command line or a harness's arithmetic; throws on one no level has. */
export function parseLevelId(value: string): LevelId {
  if (!isLevelId(value)) throw new Error(`Unknown level id: "${value}"`);
  return value;
}
