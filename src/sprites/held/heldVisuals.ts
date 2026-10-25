/**
 * Every held visual: equipment-chosen weapons and tools, which composite into
 * a socket at runtime, and the props scripted rows always hold, which bake
 * into the row. Both halves are painted by the same shared painter.
 */

import {
  TOOL_TIERS,
  type ItemWorkingToolKind,
  type ToolTier,
  type WorkingTool,
} from '../../core/toolTiers';
import { ITEM_DEF, type ItemId } from '../../core/ItemDefs';
import { archetypeSpec, type StowedPlacement } from './gripArchetypes';
import type { HeldVisualDef, WeaponHeldVisualDef } from './heldVisualDef';
import type { HeldVisualId, WeaponHeldVisualId } from './heldVisualIds';
import { FELLING_AXE, PLAIN_ARMING_SWORD, SPIKED_CLUB } from './art/provingWeapons';
import { CARRIED_BLUEPRINTS_HELD, CARRIED_PRISON_KEY_HELD } from './art/carriedHeld';
import { CARRIED_WRENCH_HELD, SCRIPTED_PROP_HELD, SLINGSHOT_HELD } from './art/scriptedPropHeld';
import { TARANIS_HELD } from './art/taranisHeld';
import { STRIKER_MALLET_HELD } from './art/strikerMalletHeld';
import { SCYTHE_HELD, TOOL_HELD } from './art/toolHeld';

/** Every held visual by id. Each entry's own `id` is its key. */
export const HELD_VISUALS: Readonly<
  Record<WeaponHeldVisualId, WeaponHeldVisualDef> &
    Record<Exclude<HeldVisualId, WeaponHeldVisualId>, HeldVisualDef>
> = {
  fury_of_taranis: TARANIS_HELD,
  slingshot: SLINGSHOT_HELD,
  quest_scythe: SCYTHE_HELD,
  plain_arming_sword: PLAIN_ARMING_SWORD,
  spiked_club: SPIKED_CLUB,
  felling_axe: FELLING_AXE,
  basic_axe: TOOL_HELD.axe[0],
  hardened_axe: TOOL_HELD.axe[1],
  lumberjacks_axe: TOOL_HELD.axe[2],
  ratkin_forge_axe: TOOL_HELD.axe[3],
  deepwood_cleaver: TOOL_HELD.axe[4],
  graveyards_bane: TOOL_HELD.axe[5],
  basic_pickaxe: TOOL_HELD.pickaxe[0],
  hardened_pickaxe: TOOL_HELD.pickaxe[1],
  quarrymans_pick: TOOL_HELD.pickaxe[2],
  ratkin_forge_pick: TOOL_HELD.pickaxe[3],
  stonebreaker: TOOL_HELD.pickaxe[4],
  worldscar_pick: TOOL_HELD.pickaxe[5],
  ...SCRIPTED_PROP_HELD,
  carried_wrench: CARRIED_WRENCH_HELD,
  carried_prison_key: CARRIED_PRISON_KEY_HELD,
  carried_blueprints: CARRIED_BLUEPRINTS_HELD,
  striker_mallet: STRIKER_MALLET_HELD,
};

/** The item Merrit's scythe is drawn from. */
const SCYTHE_ITEM: ItemId = 'quest_scythe';

/** The item a working tool is drawn from: a tier of axe or pick, or Merrit's scythe. */
function workingToolItem(kind: ItemWorkingToolKind, tier: ToolTier): ItemId {
  return kind === 'scythe' ? SCYTHE_ITEM : TOOL_TIERS[kind][tier].id;
}

/**
 * The held visual a working tool is drawn with, resolved through the item it
 * is — so a new tier's look is named once, on its item. The high striker's
 * mallet is no item and names its look here. Null for an item that names
 * none, which `verify:held-visuals` holds to never happen.
 */
export function workingToolHeldVisual(tool: WorkingTool): HeldVisualDef | null {
  if (tool.kind === 'striker_mallet') return HELD_VISUALS.striker_mallet;
  const look = ITEM_DEF[workingToolItem(tool.kind, tool.tier)].heldVisual;
  return look === undefined ? null : HELD_VISUALS[look];
}

/** Where `def` rests while equipped and not in hand, from its archetype and weight. */
export function stowedPlacementOfHeld(def: HeldVisualDef): StowedPlacement {
  return archetypeSpec(def.archetype).stowed[def.weight];
}
