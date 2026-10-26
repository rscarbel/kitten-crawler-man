/**
 * What a weapon does in a fight, as data on its item definition.
 *
 * A melee weapon is struck through one generic swing in `CombatSystem`; what
 * makes one weapon different from another is these numbers and, optionally, a
 * named proc that rides on every swing. A new sword is a new stat block, not a
 * new combat branch.
 */

import type { CatClawGarmentId } from '../../../sprites/garments/garmentIds';
import type { WeaponHeldVisualId } from '../../../sprites/held/heldVisualIds';

/** How far the human crawler's bare hands reach, in tiles, centre to centre. */
export const HUMAN_ARM_REACH_TILES = 1.95;

/** Every cut from the Stormcaller, blade or wave, lands this many times the blow a fist would. */
export const STORMCALLER_DAMAGE_MULTIPLIER = 2;

/**
 * The proving weapons hit as hard as a fist: they exist to show a weapon can
 * be added as data alone, and are never balanced because no player reaches them.
 */
export const PROVING_WEAPON_DAMAGE_MULTIPLIER = 1;

/** What a melee weapon's edge does to what it meets: a blade cuts, a blunt head bludgeons. */
export type StrikeKind = 'blade' | 'blunt';

/**
 * What a weapon held in hand is heard as, by what it is made of, its size and
 * how it is used: coming into his hand, cutting the air and landing. Weapons
 * of one family share their sounds (`WEAPON_FAMILY_SOUNDS` in
 * `src/audio/weaponSoundCues.ts`); a weapon unlike any other overrides a slot there.
 */
export type HandWeaponSoundFamily =
  'smallBlade' | 'sword' | 'ironBlunt' | 'woodenClub' | 'chopAxe' | 'flatShovel' | 'sling';

/** What claws over the cat's paws are heard as: hard caps, or hooked talons. */
export type ClawSoundFamily = 'tinCaps' | 'talons';

/**
 * A special effect a weapon's swing carries, named in the weapon's definition
 * and run by the system registered under that name in the combat context.
 */
export type WeaponProcId = 'stormcallerStorm';

/** A weapon swung in melee through the generic strike. */
export interface MeleeWeaponStats {
  readonly delivery: 'melee';
  /** How the weapon looks in hand, which also names its grip archetype and weight. */
  readonly heldVisual: WeaponHeldVisualId;
  readonly strike: StrikeKind;
  readonly sound: HandWeaponSoundFamily;
  /** Applied to the blow his bare arm would land, minus what only a fist earns. */
  readonly damageMultiplier: number;
  /** How far the swing reaches from his centre, in tiles. */
  readonly reachTiles: number;
  /**
   * Runs on every swing after the edge has landed. A weapon whose proc runs is
   * sounded by its proc; otherwise by its sound family.
   */
  readonly onStrike?: WeaponProcId;
  /**
   * How it looks in hand once its awakening trait has woken it. Same archetype
   * and weight as `heldVisual`: an awakening changes the picture, never the grip.
   */
  readonly awakenedHeldVisual?: WeaponHeldVisualId;
}

/** A weapon that takes the attack key to loose a stone instead of swinging. */
export interface SlingWeaponStats {
  readonly delivery: 'sling';
  readonly heldVisual: WeaponHeldVisualId;
  readonly sound: HandWeaponSoundFamily;
}

/** The weapons the human crawler holds in hand. */
export type HandWeaponStats = MeleeWeaponStats | SlingWeaponStats;

/** The look `weapon` is drawn with: its awakened one once it has woken, when it has one. */
export function heldVisualIdOf(weapon: HandWeaponStats, awakened: boolean): WeaponHeldVisualId {
  if (!awakened || weapon.delivery !== 'melee') return weapon.heldVisual;
  return weapon.awakenedHeldVisual ?? weapon.heldVisual;
}

/** The colour a claw weapon's swipe leaves hanging in the air behind it. */
export type ClawTrail = 'frost' | 'venom' | 'ink' | 'sunsteel';

/**
 * Caps or talons over the cat crawler's paws. Her swipe stays her own; the
 * claws scale it and lengthen it, and paint its arc in their colour.
 */
export interface ClawWeaponStats {
  readonly delivery: 'claw';
  readonly sound: ClawSoundFamily;
  /** Applied to the swipe her bare paw would land. */
  readonly damageMultiplier: number;
  /** Added to her bare swipe's reach, in tiles. */
  readonly reachBonusTiles: number;
  /** The arc the swipe leaves behind; null for claws that leave none. */
  readonly trail: ClawTrail | null;
  /** How they look on her: a garment over her forepaws' claws. */
  readonly garment: CatClawGarmentId;
}

export type WeaponStats = HandWeaponStats | ClawWeaponStats;
