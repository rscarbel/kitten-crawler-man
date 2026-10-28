/**
 * Gear sets: pieces that grant more together than apart. A piece joins a set
 * through `set` on its item definition, which is the only list of a set's
 * pieces (`setPieceIds` in `setProgress.ts`); each set's bonuses switch on at
 * a count of its pieces worn on one crawler, and are traits like any other.
 */

import type { Wearer } from '../core/items/defs/ItemDefs';
import type { StatId } from '../core/party/stats';
import type { GearTrait } from './traits';

/** Every trait a set bonus may carry: none that acts only when a piece is put on or taken off. */
export type SetBonusTrait = Exclude<GearTrait, { kind: 'cursed' | 'grantsAbility' }>;

export type GearSetId =
  'hearthguard' | 'bareknuckle' | 'demolition_crew' | 'prowler' | 'gilded_showman';

/** What a set adds once `pieces` of it are worn on one crawler. */
export interface GearSetBonus {
  readonly pieces: number;
  readonly statBonus?: Partial<Record<StatId, number>>;
  /**
   * A set bonus switches on and off with a piece count rather than being put
   * on, so it runs no equip or unequip hook; the traits that need one — a
   * curse's binding, a granted ability's hotbar slot — are refused here.
   */
  readonly traits?: ReadonlyArray<SetBonusTrait>;
}

export interface GearSetDef {
  readonly name: string;
  /** Who can complete the set. */
  readonly wearer: Wearer;
  /** Lowest piece count first. */
  readonly bonuses: ReadonlyArray<GearSetBonus>;
}

const TWO_PIECES = 2;
const THREE_PIECES = 3;
const FOUR_PIECES = 4;

const HEARTHGUARD_HEALTH = 2;
const HEARTHGUARD_STILLNESS_FRAMES = 120;
const HEARTHGUARD_STILLNESS_REGEN = 2;

const BAREKNUCKLE_MELEE = 2;
const BAREKNUCKLE_COMBO_HITS = 4;
const BAREKNUCKLE_COMBO_WINDOW_FRAMES = 150;
const BAREKNUCKLE_COMBO_STUN_FRAMES = 45;
const BAREKNUCKLE_COMBO_SHOCKWAVE_TILES = 1.5;

const DEMOLITION_RADIUS_TILES = 1;
const DEMOLITION_REFUND_CHANCE = 0.25;

const PROWLER_UNSEEN_MULTIPLIER = 1.5;
const PROWLER_VANISH_FRAMES = 120;

const SHOWMAN_COIN_SHARE = 0.15;
const SHOWMAN_FLINCH_CHANCE = 0.1;
const SHOWMAN_FLINCH_TILES = 2;
const SHOWMAN_FLINCH_FRAMES = 20;

/** Every set. Complete over {@link GearSetId}, so a set without a definition does not compile. */
export const GEAR_SETS: Readonly<Record<GearSetId, GearSetDef>> = {
  hearthguard: {
    name: 'Hearthguard',
    wearer: 'both',
    bonuses: [
      { pieces: TWO_PIECES, statBonus: { health: HEARTHGUARD_HEALTH } },
      {
        pieces: THREE_PIECES,
        traits: [
          {
            kind: 'stillnessRegen',
            afterFrames: HEARTHGUARD_STILLNESS_FRAMES,
            multiplier: HEARTHGUARD_STILLNESS_REGEN,
          },
        ],
      },
    ],
  },
  bareknuckle: {
    name: 'Bareknuckle',
    wearer: 'human',
    bonuses: [
      { pieces: TWO_PIECES, statBonus: { melee: BAREKNUCKLE_MELEE } },
      {
        pieces: THREE_PIECES,
        traits: [
          {
            kind: 'combo',
            hits: BAREKNUCKLE_COMBO_HITS,
            windowFrames: BAREKNUCKLE_COMBO_WINDOW_FRAMES,
            stunFrames: BAREKNUCKLE_COMBO_STUN_FRAMES,
            shockwaveTiles: BAREKNUCKLE_COMBO_SHOCKWAVE_TILES,
          },
        ],
      },
    ],
  },
  demolition_crew: {
    name: 'Demolition Crew',
    wearer: 'human',
    bonuses: [
      {
        pieces: TWO_PIECES,
        traits: [{ kind: 'explosiveCraft', radiusTiles: DEMOLITION_RADIUS_TILES, refundChance: 0 }],
      },
      {
        pieces: THREE_PIECES,
        traits: [
          { kind: 'explosiveCraft', radiusTiles: 0, refundChance: DEMOLITION_REFUND_CHANCE },
        ],
      },
    ],
  },
  prowler: {
    name: 'Prowler',
    wearer: 'cat',
    bonuses: [
      {
        pieces: TWO_PIECES,
        traits: [{ kind: 'unseenStrike', multiplier: PROWLER_UNSEEN_MULTIPLIER }],
      },
      {
        pieces: FOUR_PIECES,
        traits: [{ kind: 'vanishOnKill', durationFrames: PROWLER_VANISH_FRAMES }],
      },
    ],
  },
  gilded_showman: {
    name: 'Gilded Showman',
    wearer: 'both',
    bonuses: [
      { pieces: TWO_PIECES, traits: [{ kind: 'coinBonus', share: SHOWMAN_COIN_SHARE }] },
      {
        pieces: THREE_PIECES,
        traits: [
          {
            kind: 'flinchNova',
            chance: SHOWMAN_FLINCH_CHANCE,
            rangeTiles: SHOWMAN_FLINCH_TILES,
            stunFrames: SHOWMAN_FLINCH_FRAMES,
          },
        ],
      },
    ],
  },
};
