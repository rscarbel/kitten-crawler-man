import type { Player } from '../../Player';

/**
 * Cross-scene state for the `!god` / `!tough` / `!lucky` developer cheats.
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
 * God and tough are mutually exclusive: enabling one disables the other. Lucky
 * stacks with either.
 */
export interface GodModeState {
  /** `!god` — stat/speed/ability overlay plus permanent damage immunity. */
  active: boolean;
  /** `!tough` — damage immunity and zero outgoing damage, no stat overlay. */
  toughActive: boolean;
  /** `!lucky` — rigged casino draws in the party's favour plus a hidden dodge boost. */
  luckyActive: boolean;
}

export function createGodModeState(): GodModeState {
  return { active: false, toughActive: false, luckyActive: false };
}

/**
 * Asked at the moment a casino game decides an outcome, so toggling `!lucky`
 * mid-visit takes effect on the very next deal or spin.
 */
export type LuckCheck = () => boolean;

export const NEVER_LUCKY: LuckCheck = () => false;

/** Dexterity `!lucky` adds to each crawler's dodge roll; the dodge cap still applies. */
export const LUCKY_DODGE_DEXTERITY_BONUS = 500;

/**
 * Like the god-mode stat bonus, this rides on top of the stored stats and only
 * feeds the dodge roll, so it never shows on the stat sheet or reaches a snapshot.
 */
export function applyLuckToPlayer(p: Player): void {
  p.setLuckyDodgeBonus(LUCKY_DODGE_DEXTERITY_BONUS);
}

export function removeLuckFromPlayer(p: Player): void {
  p.setLuckyDodgeBonus(0);
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
  p.skills.setGodModeMinLevel(GOD_MODE_ABILITY_LEVEL);
  p.craftSkills.setGodModeMinLevel(GOD_MODE_ABILITY_LEVEL);
}

/** Reverse {@link applyGodModeToPlayer}, restoring the pre-god-mode base speed. */
export function removeGodModeFromPlayer(p: Player, originalSpeedMultiplier: number): void {
  p.setGodModeStatBonus(0);
  p.speedMultiplier = originalSpeedMultiplier;
  p.godMode = false;
  p.skills.setGodModeMinLevel(0);
  p.craftSkills.setGodModeMinLevel(0);
}
