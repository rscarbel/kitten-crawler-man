/**
 * Hireable mercenary templates for the Desperado Club's "Meat Shields" desk.
 *
 * This is the single source of truth for who can be hired and what they cost,
 * shared by the hire panel (`MercenaryGuildSystem`), the persisted roster
 * (`MercenaryRoster`), and the overworld ally (`Mercenary`). A template names
 * three further tables by id rather than carrying them: how the hireling fights
 * (`kit`, `src/creatures/mercenaries/`), how it is drawn (`art`), and what it
 * says (`voice`). Code that needs to tell hires apart branches on those ids,
 * never on the template id, so two hires sharing a kit behave alike.
 */

export type MercenaryTemplateId =
  'sledge' | 'bomo' | 'dong_quixote' | 'splash_zone' | 'gluteus_maxx' | 'bucket_boy' | 'tumbledown';

/** How a hireling fights. Sledge and Bomo share one kit with a per-hire config. */
export type MercenaryKitId =
  'cretin_guard' | 'lancer' | 'water_mage' | 'brawler' | 'medic' | 'golem';

/** Which painted figure (and variant of it) draws the hireling. */
export type MercenaryArtId =
  'sledge' | 'bomo' | 'dong_quixote' | 'splash_zone' | 'gluteus_maxx' | 'bucket_boy' | 'tumbledown';

/** Whose lines the hireling speaks. */
export type MercenaryVoiceId =
  'sledge' | 'bomo' | 'dong_quixote' | 'splash_zone' | 'gluteus_maxx' | 'bucket_boy' | 'tumbledown';

/**
 * The `Mob.audioTag` a hireling plays its attack cues under, switched on in
 * `playMobAudioCues`. Tumbledown is a rock golem and keeps the golem's tag, so
 * its slam sounds like every other golem's.
 */
export type MercenaryAudioTag =
  'merc_cretin' | 'merc_lancer' | 'merc_water_mage' | 'merc_brawler' | 'merc_medic' | 'rock_golem';

export interface MercenaryTemplate {
  readonly id: MercenaryTemplateId;
  /** The name the hire walks around under. */
  readonly name: string;
  /** Shown on the hire card, e.g. "Cretin", "Otter". */
  readonly species: string;
  /** A short class label, e.g. "Bodyguard", "Medic". */
  readonly role: string;
  /** Rosemarie's one-line sell, in her voice. */
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

// Prices are tuned against floor-3 coin income. Cheapest is the hire that
// barely fights; dearest is the best tank.
const BUCKET_BOY_PRICE = 120;
const GLUTEUS_MAXX_PRICE = 220;
const SPLASH_ZONE_PRICE = 260;
const DONG_QUIXOTE_PRICE = 280;
const TUMBLEDOWN_PRICE = 300;
const BOMO_PRICE = 300;
const SLEDGE_PRICE = 350;

const SLEDGE_HP = 95;
const BOMO_HP = 85;
const DONG_QUIXOTE_HP = 60;
const SPLASH_ZONE_HP = 45;
const GLUTEUS_MAXX_HP = 42;
const BUCKET_BOY_HP = 30;
const TUMBLEDOWN_HP = 80;

/** Cretins are seven feet of rock in a tuxedo: slow, but not slower than the party. */
const CRETIN_SPEED = 1.9;
const DONG_QUIXOTE_SPEED = 2.2;
const SPLASH_ZONE_SPEED = 2.5;
const GLUTEUS_MAXX_SPEED = 3.0;
const BUCKET_BOY_SPEED = 2.8;
const TUMBLEDOWN_SPEED = 2.0;

const CRETIN_DAMAGE = 6;
const DONG_QUIXOTE_DAMAGE = 8;
const SPLASH_ZONE_DAMAGE = 5;
const GLUTEUS_MAXX_DAMAGE = 12;
const BUCKET_BOY_DAMAGE = 2;
const TUMBLEDOWN_DAMAGE = 6;

/** A `Record` so adding an id to the union fails the typecheck until it has every field. */
const TEMPLATES_BY_ID: Readonly<Record<MercenaryTemplateId, MercenaryTemplate>> = {
  sledge: {
    id: 'sledge',
    name: 'The Sledge',
    species: 'Cretin',
    role: 'Bodyguard',
    pitch:
      "Seven foot of rock in a rented tux. Sweet on the cat. Scuff the tux and I'll scuff you.",
    price: SLEDGE_PRICE,
    hp: SLEDGE_HP,
    speed: CRETIN_SPEED,
    damage: CRETIN_DAMAGE,
    kit: 'cretin_guard',
    art: 'sledge',
    audioTag: 'merc_cretin',
    voice: 'sledge',
  },
  bomo: {
    id: 'bomo',
    name: 'Bomo',
    species: 'Cretin',
    role: 'Bodyguard',
    pitch: 'Bought his own shield spell. Uses it on whoever looks worst. Bless him.',
    price: BOMO_PRICE,
    hp: BOMO_HP,
    speed: CRETIN_SPEED,
    damage: CRETIN_DAMAGE,
    kit: 'cretin_guard',
    art: 'bomo',
    audioTag: 'merc_cretin',
    voice: 'bomo',
  },
  dong_quixote: {
    id: 'dong_quixote',
    name: 'Dong Quixote',
    species: 'Human',
    role: 'Lancer',
    pitch: "Seventy if he's a day, and he'll charge a wall if you point at it. No horse.",
    price: DONG_QUIXOTE_PRICE,
    hp: DONG_QUIXOTE_HP,
    speed: DONG_QUIXOTE_SPEED,
    damage: DONG_QUIXOTE_DAMAGE,
    kit: 'lancer',
    art: 'dong_quixote',
    audioTag: 'merc_lancer',
    voice: 'dong_quixote',
  },
  splash_zone: {
    id: 'splash_zone',
    name: 'Splash Zone',
    species: 'Otter',
    role: 'Water Mage',
    pitch: 'Nice lad. Married. Washes a whole crowd off its feet. Front rows get wet.',
    price: SPLASH_ZONE_PRICE,
    hp: SPLASH_ZONE_HP,
    speed: SPLASH_ZONE_SPEED,
    damage: SPLASH_ZONE_DAMAGE,
    kit: 'water_mage',
    art: 'splash_zone',
    audioTag: 'merc_water_mage',
    voice: 'splash_zone',
  },
  gluteus_maxx: {
    id: 'gluteus_maxx',
    name: 'Gluteus Maxx',
    species: 'Unknown',
    role: 'Brawler',
    pitch:
      "Hits like a cart, folds like a napkin. Keep him off the uppers, or don't. Your funeral.",
    price: GLUTEUS_MAXX_PRICE,
    hp: GLUTEUS_MAXX_HP,
    speed: GLUTEUS_MAXX_SPEED,
    damage: GLUTEUS_MAXX_DAMAGE,
    kit: 'brawler',
    art: 'gluteus_maxx',
    audioTag: 'merc_brawler',
    voice: 'gluteus_maxx',
  },
  bucket_boy: {
    id: 'bucket_boy',
    name: 'Bucket Boy',
    species: 'Crocodilian',
    role: 'Medic',
    pitch: 'Cheap, loyal, screams a lot. Heals, though.',
    price: BUCKET_BOY_PRICE,
    hp: BUCKET_BOY_HP,
    speed: BUCKET_BOY_SPEED,
    damage: BUCKET_BOY_DAMAGE,
    kit: 'medic',
    art: 'bucket_boy',
    audioTag: 'merc_medic',
    voice: 'bucket_boy',
  },
  tumbledown: {
    id: 'tumbledown',
    name: 'Tumbledown',
    species: 'Rock Golem',
    role: 'Heavy',
    pitch: "Doesn't talk, doesn't drink, doesn't unionize.",
    price: TUMBLEDOWN_PRICE,
    hp: TUMBLEDOWN_HP,
    speed: TUMBLEDOWN_SPEED,
    damage: TUMBLEDOWN_DAMAGE,
    kit: 'golem',
    art: 'tumbledown',
    audioTag: 'rock_golem',
    voice: 'tumbledown',
  },
};

/** Desk order: cheapest first, so the list reads as a price ladder. */
const DESK_ORDER: readonly MercenaryTemplateId[] = [
  'bucket_boy',
  'gluteus_maxx',
  'splash_zone',
  'dong_quixote',
  'tumbledown',
  'bomo',
  'sledge',
];

export const MERCENARY_TEMPLATES: readonly MercenaryTemplate[] = DESK_ORDER.map(
  (id) => TEMPLATES_BY_ID[id],
);

export const MERCENARY_TEMPLATE_IDS: readonly MercenaryTemplateId[] = DESK_ORDER;

export function getMercenaryTemplate(id: MercenaryTemplateId): MercenaryTemplate {
  return TEMPLATES_BY_ID[id];
}
