/**
 * What a weapon does in a fight, as data on its item definition.
 *
 * A melee weapon is struck through one generic swing in `CombatSystem`; what
 * makes one weapon different from another is these numbers and, optionally, a
 * named proc that rides on every swing. A new sword is a new stat block, not a
 * new combat branch.
 */

import type { WeaponHeldVisualId } from '../sprites/held/heldVisualIds';

/** How far Carl's bare hands reach, in tiles, centre to centre. */
export const HUMAN_ARM_REACH_TILES = 1.95;

/** Every cut from the Fury of Taranis, blade or wave, lands this many times the blow a fist would. */
export const TARANIS_DAMAGE_MULTIPLIER = 2;

/**
 * The proving weapons hit as hard as a fist: they exist to show a weapon can
 * be added as data alone, and are never balanced because no player reaches them.
 */
export const PROVING_WEAPON_DAMAGE_MULTIPLIER = 1;

/**
 * What a melee weapon's edge does to what it meets: a blade cuts, a blunt head
 * bludgeons. Chooses the hit sound.
 */
export type StrikeKind = 'blade' | 'blunt';

/**
 * A special effect a weapon's swing carries, named in the weapon's definition
 * and run by the system registered under that name in the combat context.
 */
export type WeaponProcId = 'taranisStorm';

/** A weapon swung in melee through the generic strike. */
export interface MeleeWeaponStats {
  readonly delivery: 'melee';
  /** How the weapon looks in hand, which also names its grip archetype and weight. */
  readonly heldVisual: WeaponHeldVisualId;
  readonly strike: StrikeKind;
  /** Applied to the blow his bare arm would land, minus what only a fist earns. */
  readonly damageMultiplier: number;
  /** How far the swing reaches from his centre, in tiles. */
  readonly reachTiles: number;
  /**
   * Runs on every swing after the edge has landed. A weapon whose proc runs is
   * sounded by its proc; otherwise it is sounded by its strike kind.
   */
  readonly onStrike?: WeaponProcId;
}

/** A weapon that takes the attack key to loose a stone instead of swinging. */
export interface SlingWeaponStats {
  readonly delivery: 'sling';
  readonly heldVisual: WeaponHeldVisualId;
}

export type WeaponStats = MeleeWeaponStats | SlingWeaponStats;
