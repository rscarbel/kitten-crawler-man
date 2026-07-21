import type { Player } from '../Player';
import type { PlayerSnapshot } from './PlayerSnapshot';

/**
 * Cross-scene state for the `!god` / `!tough` developer cheats.
 *
 * Like {@link ClubMembership} and the questline progress objects, this is a
 * plain mutable object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors. Without it, the cheats reset every time
 * the player changed scenes (entering a building, taking stairs, dying) because
 * scene transitions strip god-mode boosts out of the player snapshots. Carrying
 * this reference lets the target scene re-apply the overlay on construction, so
 * the cheat stays on until the player explicitly toggles it off.
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

/** Apply the god-mode overlay to a live player. Reversible via {@link removeGodModeFromPlayer}. */
export function applyGodModeToPlayer(p: Player): void {
  p.strength += GOD_MODE_STAT_BOOST;
  p.intelligence += GOD_MODE_STAT_BOOST;
  p.constitution += GOD_MODE_STAT_BOOST;
  p.maxHp += GOD_MODE_STAT_BOOST;
  p.hp += GOD_MODE_STAT_BOOST;
  p.godMode = true;
  p.speedMultiplier = GOD_MODE_SPEED_MULTIPLIER;
}

/** Reverse {@link applyGodModeToPlayer}, restoring the pre-god-mode base speed. */
export function removeGodModeFromPlayer(p: Player, originalSpeedMultiplier: number): void {
  p.strength -= GOD_MODE_STAT_BOOST;
  p.intelligence -= GOD_MODE_STAT_BOOST;
  p.constitution -= GOD_MODE_STAT_BOOST;
  p.maxHp -= GOD_MODE_STAT_BOOST;
  p.hp = Math.min(p.hp, p.maxHp);
  p.speedMultiplier = originalSpeedMultiplier;
  p.godMode = false;
}

/**
 * Remove the god-mode boosts from a snapshot so god mode is never baked into the
 * raw stats that carry across scenes — it must be re-applied as an overlay by
 * whichever scene the snapshot is restored into.
 */
export function stripGodModeFromSnapshot(snap: PlayerSnapshot): void {
  snap.strength -= GOD_MODE_STAT_BOOST;
  snap.intelligence -= GOD_MODE_STAT_BOOST;
  snap.constitution -= GOD_MODE_STAT_BOOST;
  snap.maxHp -= GOD_MODE_STAT_BOOST;
  snap.hp = Math.min(snap.hp, snap.maxHp);
}
