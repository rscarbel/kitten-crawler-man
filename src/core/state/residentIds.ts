/**
 * Taloncrest's named residents, by id: plain data, apart from who they are
 * and what they say (`src/systems/townResidents.ts`), so the town's memory of
 * them can be checked in a save without loading any dialog.
 */
export const RESIDENT_IDS = [
  'old_lori',
  'steve_cartwright',
  'wendell',
  'marta_miller',
  'apothecary_fen',
  'deacon_aviel',
  'smith_varga',
  'innkeep_ossie',
  'innkeep_brend',
  'innkeep_marlow',
  'sgt_kessler',
  'corporal_pell',
  'quartermaster_dann',
  'tattooist_nim',
  'stock_clerk_wick',
  'keeper_brenna_kestrel',
  'janitor_puddles',
  'janitor_grout',
  'sydney',
  'brandon',
  'taloncrest_apothecary_assistant',
  'taloncrest_lodge_cellar_elf',
] as const;

export type ResidentId = (typeof RESIDENT_IDS)[number];
