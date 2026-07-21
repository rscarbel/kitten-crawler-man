/**
 * Hireable mercenary templates for the Desperado Club's "Meat Shields" guild.
 *
 * This is the single source of truth for a merc's price and combat stats,
 * shared by the hire panel (`MercenaryGuildSystem`), the persisted roster
 * (`MercenaryRoster`), and the overworld ally (`Mercenary` creature). Each
 * archetype is melee (the Mongo-pattern ally lifecycle); ranged classes are a
 * later polish pass.
 */

export type MercenaryTemplateId = 'bruiser' | 'enforcer' | 'berserker';

export interface MercenaryTemplate {
  id: MercenaryTemplateId;
  /** Default name a hire walks around under. */
  name: string;
  /** Class label shown on the hire card (e.g. "Bruiser"). */
  title: string;
  /** One-line flavour describing the fighting style. */
  blurb: string;
  /** Coin cost to sign the contract. */
  price: number;
  hp: number;
  speed: number;
  /** Damage per melee strike, credited to the owning player on kill. */
  damage: number;
}

const MERCENARY_TEMPLATE_LIST: ReadonlyArray<MercenaryTemplate> = [
  {
    id: 'bruiser',
    name: 'Damascus Steel',
    title: 'Bruiser',
    blurb: 'A wall of muscle. Soaks hits and hits back hard.',
    price: 200,
    hp: 80,
    speed: 2.0,
    damage: 6,
  },
  {
    id: 'enforcer',
    name: 'Vasquez',
    title: 'Enforcer',
    blurb: 'Quick blade, steady hands. A well-rounded killer.',
    price: 250,
    hp: 55,
    speed: 2.6,
    damage: 9,
  },
  {
    id: 'berserker',
    name: 'Mad Ogo',
    title: 'Berserker',
    blurb: 'Fast and furious. Huge damage, but thin skin.',
    price: 300,
    hp: 40,
    speed: 3.0,
    damage: 14,
  },
];

export const MERCENARY_TEMPLATES: ReadonlyArray<MercenaryTemplate> = MERCENARY_TEMPLATE_LIST;

const TEMPLATES_BY_ID: ReadonlyMap<MercenaryTemplateId, MercenaryTemplate> = new Map(
  MERCENARY_TEMPLATE_LIST.map((template) => [template.id, template]),
);

/** Look up a template by id. Throws on an unknown id (the id union guards callers). */
export function getMercenaryTemplate(id: MercenaryTemplateId): MercenaryTemplate {
  const template = TEMPLATES_BY_ID.get(id);
  if (!template) throw new Error(`Unknown mercenary template: ${id}`);
  return template;
}
