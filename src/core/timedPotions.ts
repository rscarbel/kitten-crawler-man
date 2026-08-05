/**
 * Potions whose whole effect is a timed status: each refuses a second bottle
 * while its own is still running, and each lands the same way. The status these
 * apply is named after the item, so the key doubles as the status type.
 *
 * Shared rather than owned by `DungeonScene` because a crawler can drink one
 * indoors too — at the club bar they just bought it from, most obviously — and
 * two copies of this table would eventually pour two different drinks.
 */

import type { ItemId } from './ItemDefs';
import type { SoundId } from '../audio/sounds';
import type { Player } from '../Player';

/**
 * Frames between the gulp and the potion's secondary effect sound. Lives beside
 * the table rather than in either scene, because both scenes pour these and a
 * drink that lands on a different beat depending on which room you are standing
 * in is a bug nobody would think to look for.
 */
export const POTION_EFFECT_SOUND_DELAY = 45;

export interface TimedPotion {
  effectSound: SoundId;
  activate: (drinker: Player) => void;
}

export const TIMED_POTIONS: Partial<Record<ItemId, TimedPotion>> = {
  speed_fizz: {
    effectSound: 'speed_fizz',
    activate: (drinker) => drinker.activateSpeedFizz(),
  },
  jugg_juice: {
    effectSound: 'jugg_juice',
    activate: (drinker) => drinker.activateJuggJuice(),
  },
  cooldown_crisp: {
    effectSound: 'cooldown_crisp',
    activate: (drinker) => drinker.activateCooldownCrisp(),
  },
};
