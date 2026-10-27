/**
 * Hireable mercenary templates for The Barracks Mercenaries' desk.
 *
 * This is the single source of truth for who can be hired and what they cost,
 * shared by the hire panel (`MercenaryGuildSystem`), the persisted roster
 * (`MercenaryRoster`), and the overworld ally (`Mercenary`). A template names
 * three further tables by id rather than carrying them: how the hireling fights
 * (`kit`, `src/creatures/mercenaries/`), how it is drawn (`art`), and what it
 * says (`voice`). Code that needs to tell hires apart branches on those ids,
 * never on the template id, so two hires sharing a kit behave alike.
 */

import { SERVICE_PRICES } from '../../economy/servicePrices';

/**
 * Every hire, in desk order: cheapest first, so the list reads as a price
 * ladder. The id union is read off this list, so a hire missing from the desk
 * cannot exist.
 */
const DESK_ORDER = [
  'brother_anselm',
  'ivy_ashgrove',
  'tumbledown',
  'hammer_hands',
  'crush',
] as const;

export type MercenaryTemplateId = (typeof DESK_ORDER)[number];

/** How a hireling fights. Crush and Hammer Hands share one kit with a per-hire config. */
export type MercenaryKitId = 'earth_elemental_guard' | 'archer' | 'medic' | 'golem';

/** Which painted figure (and variant of it) draws the hireling. */
export type MercenaryArtId =
  'crush' | 'hammer_hands' | 'ivy_ashgrove' | 'brother_anselm' | 'tumbledown';

/** Whose lines the hireling speaks. */
export type MercenaryVoiceId =
  'crush' | 'hammer_hands' | 'ivy_ashgrove' | 'brother_anselm' | 'tumbledown';

/**
 * The `Mob.audioTag` a hireling plays its attack cues under, switched on in
 * `playMobAudioCues`. Tumbledown is a rock golem and keeps the golem's tag, so
 * its slam sounds like every other golem's.
 */
export type MercenaryAudioTag =
  'merc_earth_elemental' | 'merc_archer' | 'merc_medic' | 'rock_golem';

export interface MercenaryTemplate {
  readonly id: MercenaryTemplateId;
  /** The name the hire walks around under. */
  readonly name: string;
  /** Shown on the hire card, e.g. "Earth Elemental", "Human". */
  readonly species: string;
  /** A short class label, e.g. "Bodyguard", "Healer". */
  readonly role: string;
  /** Sydney's one-line sell, read off the hire's file. */
  readonly pitch: string;
  /** Coin cost of a contract, which runs to the end of the floor or the hire's death. */
  readonly price: number;
  readonly hp: number;
  readonly speed: number;
  /** Damage per basic strike, credited to the owning player on a kill. */
  readonly damage: number;
  readonly kit: MercenaryKitId;
  readonly art: MercenaryArtId;
  readonly audioTag: MercenaryAudioTag;
  readonly voice: MercenaryVoiceId;
}

const CRUSH_HP = 95;
const HAMMER_HANDS_HP = 85;
const IVY_ASHGROVE_HP = 48;
const BROTHER_ANSELM_HP = 40;
const TUMBLEDOWN_HP = 80;

/** Earth Elementals are seven feet of rock: slow, but not slower than the party. */
const EARTH_ELEMENTAL_SPEED = 1.9;
const IVY_ASHGROVE_SPEED = 2.5;
const BROTHER_ANSELM_SPEED = 2.8;
const TUMBLEDOWN_SPEED = 2.0;

const EARTH_ELEMENTAL_DAMAGE = 6;
/** Per arrow. */
const IVY_ASHGROVE_DAMAGE = 6;
/** Per staff blow: he strikes only to get room, never to win a fight. */
const BROTHER_ANSELM_DAMAGE = 3;
const TUMBLEDOWN_DAMAGE = 6;

/** A `Record` so adding an id to the union fails the typecheck until it has every field. */
const TEMPLATES_BY_ID: Readonly<Record<MercenaryTemplateId, MercenaryTemplate>> = {
  crush: {
    id: 'crush',
    name: 'Crush',
    species: 'Earth Elemental',
    role: 'Bodyguard',
    pitch:
      'Eleven years cutting stone. Posts himself beside the smaller of you and stays posted. Rated for impact.',
    price: SERVICE_PRICES.mercenary_guild.crush,
    hp: CRUSH_HP,
    speed: EARTH_ELEMENTAL_SPEED,
    damage: EARTH_ELEMENTAL_DAMAGE,
    kit: 'earth_elemental_guard',
    art: 'crush',
    audioTag: 'merc_earth_elemental',
    voice: 'crush',
  },
  hammer_hands: {
    id: 'hammer_hands',
    name: 'Hammer Hands',
    species: 'Earth Elemental',
    role: 'Bodyguard',
    pitch:
      'Ex-forge. Carries his own warding spell and spends it on whoever is bleeding worst. Return him in one piece.',
    price: SERVICE_PRICES.mercenary_guild.hammer_hands,
    hp: HAMMER_HANDS_HP,
    speed: EARTH_ELEMENTAL_SPEED,
    damage: EARTH_ELEMENTAL_DAMAGE,
    kit: 'earth_elemental_guard',
    art: 'hammer_hands',
    audioTag: 'merc_earth_elemental',
    voice: 'hammer_hands',
  },
  ivy_ashgrove: {
    id: 'ivy_ashgrove',
    name: 'Ivy Ashgrove',
    species: 'Human',
    role: 'Archer',
    pitch:
      'Keeps four tiles back and puts arrows where you would have wanted them. Arrows are in the fee. Ask about the arrows.',
    price: SERVICE_PRICES.mercenary_guild.ivy_ashgrove,
    hp: IVY_ASHGROVE_HP,
    speed: IVY_ASHGROVE_SPEED,
    damage: IVY_ASHGROVE_DAMAGE,
    kit: 'archer',
    art: 'ivy_ashgrove',
    audioTag: 'merc_archer',
    voice: 'ivy_ashgrove',
  },
  brother_anselm: {
    id: 'brother_anselm',
    name: 'Brother Anselm',
    species: 'Human',
    role: 'Healer',
    pitch:
      "Mends what's broken and stays out of the way. If you see him swinging that staff, something has gone wrong.",
    price: SERVICE_PRICES.mercenary_guild.brother_anselm,
    hp: BROTHER_ANSELM_HP,
    speed: BROTHER_ANSELM_SPEED,
    damage: BROTHER_ANSELM_DAMAGE,
    kit: 'medic',
    art: 'brother_anselm',
    audioTag: 'merc_medic',
    voice: 'brother_anselm',
  },
  tumbledown: {
    id: 'tumbledown',
    name: 'Tumbledown',
    species: 'Rock Golem',
    role: 'Heavy',
    pitch: 'No speech, no wages, no complaints on file. Point it at something.',
    price: SERVICE_PRICES.mercenary_guild.tumbledown,
    hp: TUMBLEDOWN_HP,
    speed: TUMBLEDOWN_SPEED,
    damage: TUMBLEDOWN_DAMAGE,
    kit: 'golem',
    art: 'tumbledown',
    audioTag: 'rock_golem',
    voice: 'tumbledown',
  },
};

export const MERCENARY_TEMPLATES: readonly MercenaryTemplate[] = DESK_ORDER.map(
  (id) => TEMPLATES_BY_ID[id],
);

export const MERCENARY_TEMPLATE_IDS: readonly MercenaryTemplateId[] = DESK_ORDER;

export function getMercenaryTemplate(id: MercenaryTemplateId): MercenaryTemplate {
  return TEMPLATES_BY_ID[id];
}
