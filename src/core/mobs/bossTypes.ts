/**
 * Boss-type ids from `levelDef.bossRooms[].type`, in a leaf module so the
 * core counters and the room systems that both key on them share one spelling.
 */

import type { GauntletBossType } from '../../map/bossRoomSizes';

export const TRASH_GREMLIN_BOSS_TYPE = 'trash_gremlin' as const satisfies GauntletBossType;
export const BIG_ROOSTER_BOSS_TYPE = 'big_rooster' as const satisfies GauntletBossType;
export const KRAKEN_BOSS_TYPE = 'kraken' as const satisfies GauntletBossType;
export const ELECTRIC_GOBLIN_BOSS_TYPE = 'electric_goblin' as const satisfies GauntletBossType;
