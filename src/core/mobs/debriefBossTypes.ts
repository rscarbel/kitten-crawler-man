/** The bosses Dave debriefs the party after, as plain ids; what he says is `src/systems/daveDebrief.ts`. */

/** In the order a run meets them; `isSupersededDebrief` (`daveDebrief.ts`) relies on it. */
const DEBRIEF_BOSS_TYPES = ['trash_gremlin', 'kraken', 'electric_goblin', 'big_rooster'] as const;

export type DebriefBossType = (typeof DEBRIEF_BOSS_TYPES)[number];

/** Must match each mob's `displayName`; `verify:dave-guide` checks it. */
export const BOSS_DISPLAY_NAMES = {
  trash_gremlin: 'The Trash Gremlin',
  big_rooster: 'Big Rooster',
  kraken: 'The Kraken',
  electric_goblin: 'The Current Goblin',
} as const satisfies Record<DebriefBossType, string>;

export const ALL_DEBRIEF_BOSS_TYPES: ReadonlyArray<DebriefBossType> = DEBRIEF_BOSS_TYPES;

export function debriefBossType(bossType: string | undefined): DebriefBossType | null {
  if (bossType === undefined) return null;
  for (const id of DEBRIEF_BOSS_TYPES) {
    if (id === bossType) return id;
  }
  return null;
}
