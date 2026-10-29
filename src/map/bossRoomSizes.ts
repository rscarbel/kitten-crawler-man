import type { StandaloneMobKind } from '../levels/mobKinds';

/** A boss room's interior, in tiles. */
interface BossRoomSize {
  readonly w: number;
  readonly h: number;
}

/**
 * Each boss room's interior, sized by what its fight needs rather than shared.
 * Its keys are every boss a gauntlet can end in, and so every boss the
 * generator seats a room for.
 *
 * The Kraken's pump room holds three wall pumps, a dais and a field of small
 * rafts across open water; the gym needs floor for exercise balls to bounce and a
 * kettlebell rain to land with a safe tile left over.
 */
export const BOSS_ROOM_SIZE = {
  trash_gremlin: { w: 22, h: 18 },
  kraken: { w: 40, h: 32 },
  electric_goblin: { w: 22, h: 18 },
  big_rooster: { w: 28, h: 22 },
} as const satisfies Partial<Record<StandaloneMobKind, BossRoomSize>>;

export type GauntletBossType = keyof typeof BOSS_ROOM_SIZE;
