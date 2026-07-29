import type { Player } from '../Player';

/**
 * Cross-scene state for the `!god` / `!tough` developer cheats.
 *
 * Like {@link ClubMembership} and the questline progress objects, this is a
 * plain mutable object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors. Without it, the cheats would reset every
 * time the player changed scenes (entering a building, taking stairs, dying):
 * god mode is an overlay on the live player rather than a stat delta, so it is
 * deliberately absent from snapshots and each scene builds fresh players without
 * it. Carrying this reference lets the target scene re-apply the overlay on
 * construction, so the cheat stays on until the player explicitly toggles it off.
 *
 * The two modes are mutually exclusive: enabling one disables the other.
 */
export interface GodModeState {
  /** `!god` — stat/speed/ability overlay plus permanent damage immunity. */
  active: boolean;
  /** `!tough` — damage immunity and zero outgoing damage, no stat overlay. */
  toughActive: boolean;
}

export function createGodModeState(): GodModeState {
  return { active: false, toughActive: false };
}

export const GOD_MODE_STAT_BOOST = 300;
export const GOD_MODE_SPEED_MULTIPLIER = 2;
export const GOD_MODE_ABILITY_LEVEL = 15;

/**
 * Apply the god-mode overlay to a live player. Reversible via
 * {@link removeGodModeFromPlayer}.
 *
 * The boost rides on top of the stored base stats rather than being added into
 * them, so it can never be baked into a snapshot and carried across scenes.
 */
export function applyGodModeToPlayer(p: Player): void {
  p.setGodModeStatBonus(GOD_MODE_STAT_BOOST);
  p.hp = p.maxHp;
  p.godMode = true;
  p.speedMultiplier = GOD_MODE_SPEED_MULTIPLIER;
}

/** Reverse {@link applyGodModeToPlayer}, restoring the pre-god-mode base speed. */
export function removeGodModeFromPlayer(p: Player, originalSpeedMultiplier: number): void {
  p.setGodModeStatBonus(0);
  p.speedMultiplier = originalSpeedMultiplier;
  p.godMode = false;
}
