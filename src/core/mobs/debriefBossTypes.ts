/** The bosses Dave debriefs the party after, as plain ids; what he says is `src/systems/daveDebrief.ts`. */

/** In the order the spine meets them; `isSupersededDebrief` (`daveDebrief.ts`) relies on it. */
const DEBRIEF_BOSS_TYPES = ['trash_gremlin', 'big_rooster', 'krakaren_clone'] as const;

export type DebriefBossType = (typeof DEBRIEF_BOSS_TYPES)[number];

export const ALL_DEBRIEF_BOSS_TYPES: ReadonlyArray<DebriefBossType> = DEBRIEF_BOSS_TYPES;

export function debriefBossType(bossType: string | undefined): DebriefBossType | null {
  if (bossType === undefined) return null;
  for (const id of DEBRIEF_BOSS_TYPES) {
    if (id === bossType) return id;
  }
  return null;
}
