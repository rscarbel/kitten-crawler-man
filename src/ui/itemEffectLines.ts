import { POTION_HEAL_FRACTION } from '../Player';
import { ALL_STATS, DELIVERY_STAT, STAT_DEFS, type StatId } from '../core/party/stats';
import {
  ITEM_DEF,
  wearerOf,
  type FairyElement,
  type InventoryItem,
  type ItemDef,
  type ItemId,
  type ResistanceType,
} from '../core/items/defs/ItemDefs';
import { getSkillDef, SKILL_IDS, type SkillId, type SkillOwner } from '../core/skills/SkillManager';
import {
  WEAPON_FAMILY_LABELS,
  type ClawTrail,
  type WeaponDelivery,
  type WeaponProcId,
  type WeaponStats,
} from '../core/items/equipment/weapons';
import { isAbilityId } from '../core/skills/AbilityManager';
import { describeTrait } from '../gear/traits';
import { activeSetBonuses, setProgress, wornSets } from '../gear/setProgress';
import { grantedAbility } from '../gear/gearHooks';
import { ABILITY_DEFS } from '../abilities/abilityDefs';
import { GEAR_SETS, type GearSetBonus } from '../gear/sets';
import {
  HAMBURGER_FED_DURATION_SECONDS,
  HAMBURGER_HEAL_FRACTION,
  HAMBURGER_MELEE_BONUS,
} from '../core/items/consumables/foodEffects';
import { MAX_TOOL_TIER, toolTierDef, type ToolKind } from '../core/items/gathering/toolTiers';

/** Multiplier→percentage conversion for the lines that read as percentages. */
const PERCENT = 100;

const TOOL_PLURAL: Record<ToolKind, string> = {
  axe: 'axes',
  pickaxe: 'picks',
};

export const RESISTANCE_LABELS: Readonly<Record<ResistanceType, string>> = {
  poison: 'Poison',
  ice: 'Ice',
  piercing: 'Piercing',
  magic: 'Magic',
};

const FAIRY_ELEMENT_LABELS: Record<FairyElement, string> = {
  ice: 'ice',
  fire: 'fire',
};

/** The one wording for fairy immunity, shared by item tooltips and the worn-gear summary. */
export function fairyImmunityLine(elements: readonly FairyElement[]): string | null {
  if (elements.length === 0) return null;
  const named = elements.map((element) => FAIRY_ELEMENT_LABELS[element]).join(' and ');
  return `Immune to ${named} fairies`;
}

const WEARER_LABELS = { cat: 'Cat only', human: 'Human only', both: null } as const;

/** Who can learn from a skill book, by who its skill is for. */
const LEARNER_LINES = {
  cat: 'Only the Cat can learn it',
  human: 'Only the Human can learn it',
  both: 'Either crawler can learn it',
} as const satisfies Record<SkillOwner, string>;

/** What reading a skill book does, and who can read it. */
function skillBookLines(id: SkillId): string[] {
  const def = getSkillDef(id);
  return [`Teaches ${def.name}`, LEARNER_LINES[def.eligibleFor]];
}

/** Rounded to whole percent because a tooltip is read, not calculated against. */
export function asPercent(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

/** The line a regen multiplier reads as, or null when it changes nothing. */
export function regenLine(multiplier: number): string | null {
  if (multiplier === 1) return null;
  const change = asPercent(multiplier - 1);
  return `${change >= 0 ? '+' : ''}${change}% HP regen`;
}

export function skillBonusLine(id: SkillId, levels: number): string {
  return `+${levels} ${getSkillDef(id).name}`;
}

export function meleeOnlyStatLine(stat: StatId, amount: number): string {
  return `+${amount} ${STAT_DEFS[stat].label} (melee only)`;
}

export const CANCELS_MOMENTUM_LINE = 'Momentum attacks cannot touch you';

/** What each weapon proc adds to every swing, as the detail pane lists it. */
const WEAPON_PROC_LINES: Readonly<Record<WeaponProcId, string>> = {
  stormcallerStorm: 'Each swing throws a lightning wave that chains to nearby enemies',
};

/** The colour words a claw's swipe trail is described by. */
const CLAW_TRAIL_LINES: Readonly<Record<ClawTrail, string>> = {
  frost: 'Swipes leave a frost trail',
  venom: 'Swipes leave a venom trail',
  ink: 'Swipes leave an ink trail',
  sunsteel: 'Swipes leave a sunsteel trail',
};

function weaponLines(weapon: WeaponStats): string[] {
  if (weapon.delivery === 'sling') return ['Looses stones at range'];
  if (weapon.delivery === 'claw') {
    const lines = [`Claws ×${weapon.damageMultiplier} damage`];
    if (weapon.reachBonusTiles > 0) lines.push(`+${weapon.reachBonusTiles} tile swipe reach`);
    if (weapon.trail !== null) lines.push(CLAW_TRAIL_LINES[weapon.trail]);
    return lines;
  }
  const lines = [`${WEAPON_FAMILY_LABELS[weapon.family]} ×${weapon.damageMultiplier} damage`];
  if (weapon.onStrike !== undefined) lines.push(WEAPON_PROC_LINES[weapon.onStrike]);
  return lines;
}

/** How `def`'s damage leaves the crawler, when it deals any: its weapon, its own, or its ability's. */
function deliveryOf(def: ItemDef): WeaponDelivery | null {
  if (def.weapon !== undefined) return def.weapon.delivery;
  if (def.delivery !== undefined) return def.delivery;
  if (def.abilityId !== undefined && isAbilityId(def.abilityId)) {
    return ABILITY_DEFS[def.abilityId].delivery;
  }
  return null;
}

/** "Scales with Melee" and the like, for an item whose damage grows with a stat. */
function scalingLine(def: ItemDef): string | null {
  const delivery = deliveryOf(def);
  if (delivery === null) return null;
  return `Scales with ${STAT_DEFS[DELIVERY_STAT[delivery]].label}`;
}

/** One line per set with any piece among `equipped`: its name and how many of its pieces are on. */
export function setProgressLines(equipped: ReadonlyArray<ItemId>): string[] {
  return [...wornSets(equipped).keys()].map((set) => {
    const progress = setProgress(equipped, set);
    return `${progress.name} set: ${progress.worn}/${progress.pips.length}`;
  });
}

/** A set bonus as one line: what it adds, stats first, then each trait. */
function setBonusLine(bonus: GearSetBonus): string {
  const stats = ALL_STATS.flatMap((stat) => {
    const amount = bonus.statBonus?.[stat];
    return amount === undefined || amount === 0 ? [] : [`+${amount} ${STAT_DEFS[stat].label}`];
  });
  const traits = (bonus.traits ?? []).map(describeTrait);
  return [...stats, ...traits].join(', ');
}

/**
 * What `equipped` adds beyond each piece's own lines, for the Character page:
 * every set bonus switched on, and every ability a worn piece grants.
 */
export function activeGearLines(equipped: ReadonlyArray<ItemId>): string[] {
  const lines: string[] = [];
  for (const [set, worn] of wornSets(equipped)) {
    for (const bonus of activeSetBonuses(set, worn)) {
      lines.push(`${GEAR_SETS[set].name} (${bonus.pieces} pieces): ${setBonusLine(bonus)}`);
    }
  }
  for (const id of equipped) {
    const ability = grantedAbility(id);
    if (ability !== null) {
      lines.push(`Grants ${ABILITY_DEFS[ability].name} (${ITEM_DEF[id].name})`);
    }
  }
  return lines;
}

/**
 * Human-readable effect lines for an item, generated from its data: stat
 * bonuses, a weapon's blow, resistances, fairy immunities, skill bonuses,
 * regen and every trait. An item's description is flavour, so this is the
 * only place what it does is written down.
 *
 * The single source every panel that describes an item draws from, so an item
 * gaining an effect shows up everywhere at once instead of only wherever
 * someone remembered to hand-write a line for it.
 */
export function describeItemEffects(item: InventoryItem): string[] {
  const lines: string[] = [];

  const statBonus = item.statBonus;
  if (statBonus) {
    for (const stat of ALL_STATS) {
      const amount = statBonus[stat];
      if (amount) lines.push(`+${amount} ${STAT_DEFS[stat].label}`);
    }
  }

  const meleeOnly = item.meleeOnlyStatBonus;
  if (meleeOnly) {
    for (const stat of ALL_STATS) {
      const amount = meleeOnly[stat];
      if (amount) lines.push(meleeOnlyStatLine(stat, amount));
    }
  }

  const def = ITEM_DEF[item.id];
  const weapon = def.weapon;
  if (weapon !== undefined) lines.push(...weaponLines(weapon));
  const scaling = scalingLine(def);
  if (scaling !== null) lines.push(scaling);

  const resistances = item.resistances;
  if (resistances && resistances.length > 0) {
    const named = resistances.map((type) => RESISTANCE_LABELS[type]).join(', ');
    lines.push(`Resists: ${named}`);
  }

  const fairyImmunity = fairyImmunityLine(item.fairyImmunities ?? []);
  if (fairyImmunity !== null) lines.push(fairyImmunity);

  if (item.cancelsMomentum) lines.push(CANCELS_MOMENTUM_LINE);

  const skillLevelBonus = item.skillLevelBonus;
  if (skillLevelBonus) {
    for (const id of SKILL_IDS) {
      const amount = skillLevelBonus[id];
      if (amount) lines.push(skillBonusLine(id, amount));
    }
  }

  if (item.skillId !== undefined) lines.push(...skillBookLines(item.skillId));

  const regen = item.regenMultiplier === undefined ? null : regenLine(item.regenMultiplier);
  if (regen !== null) lines.push(regen);

  for (const trait of def.traits ?? []) lines.push(describeTrait(trait));

  const set = def.set;
  if (set !== undefined) lines.push(`Part of the ${GEAR_SETS[set].name} set`);

  const wearer = wearerOf(item.id);
  const wearerLabel = wearer === undefined ? null : WEARER_LABELS[wearer];
  if (wearerLabel !== null) lines.push(wearerLabel);

  const tool = item.tool;
  if (tool) {
    const def = toolTierDef(tool.kind, tool.tier);
    if (def.speedBonus > 0) lines.push(`+${asPercent(def.speedBonus)}% gathering speed`);
    if (def.yieldMultiplier > 1) lines.push(`${def.yieldMultiplier}× yield per swing`);
    if (tool.tier < MAX_TOOL_TIER) lines.push(`Better ${TOOL_PLURAL[tool.kind]} at Oren's forge`);
  }

  // Kept to short lines: effect lines are not wrapped the way the prose is.
  if (item.id === 'hamburger') {
    lines.push(`Heals ${asPercent(HAMBURGER_HEAL_FRACTION)}% max HP`);
    lines.push(`+${HAMBURGER_MELEE_BONUS} Melee for ${HAMBURGER_FED_DURATION_SECONDS} seconds`);
    lines.push("Another refreshes it; doesn't stack");
  }

  if (item.id === 'hollow_stew') {
    lines.push(`Heals ${asPercent(POTION_HEAL_FRACTION)}% max HP, like a potion`);
    lines.push('Shares the health potion cooldown');
  }

  return lines;
}
