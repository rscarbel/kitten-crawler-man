/**
 * What weapons sound like. Every weapon names a sound family on its stat block
 * (`sound` in `src/core/items/equipment/weapons.ts`), and weapons of a family
 * share its sounds here: two wooden clubs are one family, never two sets of
 * recordings. A weapon genuinely unlike the rest of its family (a storm in its
 * edge, a coat of venom) overrides just the slots that make it different.
 *
 * Most slots still play a stand-in from the shared library and name the
 * recording they wait for (see {@link CueSlot}). A recording that lands is its
 * registration in `src/audio/sounds.ts` and the `universal` group of
 * `src/audio/sfxGroups.ts` (a crawler can fight anywhere), then its slot here:
 * `takes` become the new ids and `standInFor` goes, with its name in
 * {@link WantedWeaponSound}.
 *
 * Nothing here may borrow the Stormcaller's crackling takes except the
 * Stormcaller: a stand-in is the closest plain whoosh, cut or thud.
 */

import {
  clawStatsOf,
  weaponStatsOf,
  type ClawItemId,
  type HandWeaponItemId,
  type ItemId,
} from '../core/items/defs/ItemDefs';
import type { ClawSoundFamily, HandWeaponSoundFamily } from '../core/items/equipment/weapons';
import type { CueSlot } from './cueSlot';
import type { SoundId } from './sounds';

/** The recordings the weapon slots are waiting for. */
type WantedWeaponSound =
  | 'small_blade_draw'
  | 'small_blade_swing'
  | 'small_blade_hit'
  | 'sword_swing'
  | 'sword_hit'
  | 'iron_blunt_draw'
  | 'iron_blunt_swing'
  | 'iron_blunt_hit'
  | 'wooden_club_swing'
  | 'wooden_club_hit'
  | 'haft_shoulder_draw'
  | 'axe_swing'
  | 'axe_hit'
  | 'shovel_swing'
  | 'shovel_hit'
  | 'sling_band_snap'
  | 'sling_stone_hit'
  | 'claw_swipe_tin'
  | 'claw_caps_click'
  | 'claw_swipe_talon';

type WeaponSlot = CueSlot<WantedWeaponSound>;

/** The sounds of a weapon the human holds in hand. */
export interface HandWeaponSounds {
  /** Coming into his hand, by any route: the hotbar, the doll, the bag. */
  readonly draw: WeaponSlot;
  /** Leaving his hand. */
  readonly stow: WeaponSlot;
  /** Cutting the air; for a sling, the band loosing its stone. */
  readonly swing: WeaponSlot;
  /** Landing on whatever it met; for a sling, where the stone strikes. */
  readonly hit: WeaponSlot;
  /** The weapon's own effect beyond the blow, for a weapon that has one. */
  readonly proc?: WeaponSlot;
}

const BLADE_DRAW: readonly SoundId[] = [
  'weapon_draw_blade_1',
  'weapon_draw_blade_2',
  'weapon_draw_blade_3',
];
const BLADE_STOW: readonly SoundId[] = ['weapon_stow_blade'];
const HEAVY_DRAW: readonly SoundId[] = ['weapon_draw_heavy'];
const HEAVY_STOW: readonly SoundId[] = ['weapon_stow_heavy'];
/** The plainest whoosh in the library, standing in for every one-handed swing. */
const PLAIN_SWING: readonly SoundId[] = [
  'swing_heavy_1',
  'swing_heavy_2',
  'swing_heavy_3',
  'swing_heavy_4',
];
const TWO_HANDED_SWING: readonly SoundId[] = [
  'swing_two_handed_1',
  'swing_two_handed_2',
  'swing_two_handed_3',
];
const BLADE_HIT: readonly SoundId[] = ['slash_strike_1', 'slash_strike_2', 'slash_strike_3'];
const BLUNT_HIT: readonly SoundId[] = [
  'blunt_hit_flesh_1',
  'blunt_hit_flesh_2',
  'blunt_hit_flesh_3',
];
/** A meaty thud with a metal clank under it: the nearest to iron or a spade's face landing. */
const IRON_HIT: readonly SoundId[] = [
  'dumbbell_club_impact_1',
  'dumbbell_club_impact_2',
  'dumbbell_club_impact_3',
];

export const WEAPON_FAMILY_SOUNDS: Readonly<
  Record<HandWeaponSoundFamily, Omit<HandWeaponSounds, 'proc'>>
> = {
  /** A short metal point or knife, pulled from a belt rather than a scabbard. */
  smallBlade: {
    draw: { takes: BLADE_DRAW, standInFor: 'small_blade_draw' },
    stow: { takes: BLADE_STOW },
    swing: { takes: PLAIN_SWING, standInFor: 'small_blade_swing' },
    hit: { takes: BLADE_HIT, standInFor: 'small_blade_hit' },
  },
  /** A one-handed sword drawn from a scabbard. */
  sword: {
    draw: { takes: BLADE_DRAW },
    stow: { takes: BLADE_STOW },
    swing: { takes: PLAIN_SWING, standInFor: 'sword_swing' },
    hit: { takes: BLADE_HIT, standInFor: 'sword_hit' },
  },
  /** A one-handed lump of iron: a wrench, a mace, a crowbar. */
  ironBlunt: {
    draw: { takes: HEAVY_DRAW, standInFor: 'iron_blunt_draw' },
    stow: { takes: HEAVY_STOW },
    swing: { takes: PLAIN_SWING, standInFor: 'iron_blunt_swing' },
    hit: { takes: IRON_HIT, standInFor: 'iron_blunt_hit' },
  },
  /** A heavy wooden club, studded or not. */
  woodenClub: {
    draw: { takes: HEAVY_DRAW },
    stow: { takes: HEAVY_STOW },
    swing: { takes: PLAIN_SWING, standInFor: 'wooden_club_swing' },
    hit: { takes: BLUNT_HIT, standInFor: 'wooden_club_hit' },
  },
  /** A long-hafted axe swung in both hands. */
  chopAxe: {
    draw: { takes: HEAVY_DRAW, standInFor: 'haft_shoulder_draw' },
    stow: { takes: HEAVY_STOW },
    swing: { takes: TWO_HANDED_SWING, standInFor: 'axe_swing' },
    hit: { takes: BLADE_HIT, standInFor: 'axe_hit' },
  },
  /** A long-hafted flat blade, a shovel or spade, swung face first. */
  flatShovel: {
    draw: { takes: HEAVY_DRAW, standInFor: 'haft_shoulder_draw' },
    stow: { takes: HEAVY_STOW },
    swing: { takes: TWO_HANDED_SWING, standInFor: 'shovel_swing' },
    hit: { takes: IRON_HIT, standInFor: 'shovel_hit' },
  },
  sling: {
    draw: { takes: ['slingshot_draw_pocket'] },
    stow: { takes: ['slingshot_stow_pocket'] },
    swing: { takes: ['shooting_an_arrow'], standInFor: 'sling_band_snap' },
    hit: { takes: ['arrow_impact'], standInFor: 'sling_stone_hit' },
  },
};

/**
 * The slots a weapon plays instead of its family's. The Stormcaller's base
 * swing is the generic magic-sword swing; every crackling electric take
 * belongs to its cut landing, so the storm is heard only when the blade or
 * its wave hits something.
 */
export const WEAPON_SOUND_OVERRIDES = {
  stormcaller: {
    swing: {
      takes: [
        'magic_sword_swing_1',
        'magic_sword_swing_2',
        'magic_sword_swing_3',
        'magic_sword_swing_4',
      ],
    },
    hit: {
      takes: [
        'stormcaller_swing_1',
        'stormcaller_swing_2',
        'stormcaller_swing_3',
        'stormcaller_swing_4',
        'stormcaller_wave_hit_1',
        'stormcaller_wave_hit_2',
        'stormcaller_wave_hit_3',
        'stormcaller_wave_hit_4',
      ],
    },
    proc: {
      takes: [
        'stormcaller_chain_lightning_1',
        'stormcaller_chain_lightning_2',
        'stormcaller_chain_lightning_3',
        'stormcaller_chain_lightning_4',
      ],
    },
  },
} as const satisfies Partial<Record<HandWeaponItemId, Partial<HandWeaponSounds>>>;

const HAND_WEAPON_OVERRIDES: Partial<Record<ItemId, Partial<HandWeaponSounds>>> =
  WEAPON_SOUND_OVERRIDES;

/** The sounds of `id` when it is a weapon held in hand: its family's, under its own overrides. */
export function handWeaponSoundsOf(id: ItemId): HandWeaponSounds | null {
  const weapon = weaponStatsOf(id);
  if (weapon === null) return null;
  return { ...WEAPON_FAMILY_SOUNDS[weapon.sound], ...HAND_WEAPON_OVERRIDES[id] };
}

/** The sounds of a set of claws, layered over her own paw's scratch. */
export interface ClawSounds {
  /** The claws through the air, on every swipe. */
  readonly swipe: WeaponSlot;
  /** Going on over her paws. */
  readonly equip: WeaponSlot;
}

const SMALL_METAL_EQUIP: readonly SoundId[] = ['equip_metal_armor_1', 'equip_metal_armor_2'];

const CLAW_FAMILY_SOUNDS: Readonly<Record<ClawSoundFamily, ClawSounds>> = {
  tinCaps: {
    swipe: { takes: [], standInFor: 'claw_swipe_tin' },
    equip: { takes: SMALL_METAL_EQUIP, standInFor: 'claw_caps_click' },
  },
  talons: {
    swipe: { takes: [], standInFor: 'claw_swipe_talon' },
    equip: { takes: SMALL_METAL_EQUIP },
  },
};

/** Claws whose coating is heard on every swipe in place of the bare talons. */
const CLAW_SOUND_OVERRIDES = {
  venom_claws: {
    swipe: {
      takes: [
        'claw_swipe_venom_1',
        'claw_swipe_venom_2',
        'claw_swipe_venom_3',
        'claw_swipe_venom_4',
      ],
    },
  },
  frostbite_claws: {
    swipe: {
      takes: [
        'claw_swipe_frost_1',
        'claw_swipe_frost_2',
        'claw_swipe_frost_3',
        'claw_swipe_frost_4',
      ],
    },
  },
  ink_dipped_claws: {
    swipe: {
      takes: ['claw_swipe_ink_1', 'claw_swipe_ink_2', 'claw_swipe_ink_3', 'claw_swipe_ink_4'],
    },
  },
} as const satisfies Partial<Record<ClawItemId, Partial<ClawSounds>>>;

const CLAW_OVERRIDES: Partial<Record<ItemId, Partial<ClawSounds>>> = CLAW_SOUND_OVERRIDES;

/** The sounds of `id` when it is a set of claws: its family's, under its own overrides. */
export function clawSoundsOf(id: ItemId): ClawSounds | null {
  const claws = clawStatsOf(id);
  if (claws === null) return null;
  return { ...CLAW_FAMILY_SOUNDS[claws.sound], ...CLAW_OVERRIDES[id] };
}
