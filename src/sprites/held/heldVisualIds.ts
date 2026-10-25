/**
 * Every held visual's id, kept apart from the registry so item and weapon data
 * can name a look without importing any art.
 */

/** The working tools, one per tool item: the id is the tier's item id. */
export const TOOL_HELD_VISUAL_IDS = [
  'basic_axe',
  'hardened_axe',
  'lumberjacks_axe',
  'ratkin_forge_axe',
  'deepwood_cleaver',
  'graveyards_bane',
  'basic_pickaxe',
  'hardened_pickaxe',
  'quarrymans_pick',
  'ratkin_forge_pick',
  'stonebreaker',
  'worldscar_pick',
] as const;

/** Props a scripted row always holds, painted into the row rather than chosen by equipment. */
export const SCRIPTED_PROP_VISUAL_IDS = [
  'prop_hammer',
  'prop_board',
  'prop_crate',
  'prop_wrench',
  'prop_dynamite',
  'prop_black_powder_bomb',
  'prop_zippo',
  'prop_bottle',
] as const;

/** Looks a weapon item may name: each is held in a weapon grip archetype. */
export const WEAPON_HELD_VISUAL_IDS = [
  'fury_of_taranis',
  'slingshot',
  'plain_arming_sword',
  'spiked_club',
  'felling_axe',
] as const;

/** Small things the cat crawler carries across her jaws. */
export const MOUTH_CARRY_VISUAL_IDS = [
  'carried_wrench',
  'carried_prison_key',
  'carried_blueprints',
] as const;
export type MouthCarryVisualId = (typeof MOUTH_CARRY_VISUAL_IDS)[number];

/**
 * Working tools that belong to a place rather than to an item: handed to a
 * crawler for one job there and taken back after.
 */
export const FIXTURE_TOOL_VISUAL_IDS = ['striker_mallet'] as const;

export const HELD_VISUAL_IDS = [
  ...WEAPON_HELD_VISUAL_IDS,
  'quest_scythe',
  ...TOOL_HELD_VISUAL_IDS,
  ...SCRIPTED_PROP_VISUAL_IDS,
  ...MOUTH_CARRY_VISUAL_IDS,
  ...FIXTURE_TOOL_VISUAL_IDS,
] as const;

/** Names one look a crawler can hold. */
export type HeldVisualId = (typeof HELD_VISUAL_IDS)[number];

/** Names a look a weapon's stat block may carry. */
export type WeaponHeldVisualId = (typeof WEAPON_HELD_VISUAL_IDS)[number];
export type ToolHeldVisualId = (typeof TOOL_HELD_VISUAL_IDS)[number];
/** Names the look a working tool's item is drawn with: a tier's, or Merrit's scythe. */
export type WorkingToolHeldVisualId = ToolHeldVisualId | 'quest_scythe';
export type ScriptedPropVisualId = (typeof SCRIPTED_PROP_VISUAL_IDS)[number];
/** Looks the dynamite rows' throwing hand can hold: whichever explosive he is lobbing. */
export const THROWN_PROP_VISUAL_IDS = [
  'prop_dynamite',
  'prop_black_powder_bomb',
] as const satisfies readonly ScriptedPropVisualId[];
export type ThrownPropVisualId = (typeof THROWN_PROP_VISUAL_IDS)[number];
