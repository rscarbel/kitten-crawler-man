import { ALL_STATS, type StatName } from '../Player';
import type { InventoryItem, ResistanceType } from '../core/ItemDefs';
import { getSkillDef, SKILL_IDS } from '../core/SkillManager';

/** Multiplier→percentage conversion for the lines that read as percentages. */
const PERCENT = 100;

const STAT_LABELS: Record<StatName, string> = {
  strength: 'Strength',
  intelligence: 'Intelligence',
  constitution: 'Constitution',
  dexterity: 'Dexterity',
};

const RESISTANCE_LABELS: Record<ResistanceType, string> = {
  poison: 'Poison',
  ice: 'Ice',
  piercing: 'Piercing',
};

const WEARER_LABELS = { cat: 'Cat only', human: 'Human only' } as const;

/** Rounded to whole percent because a tooltip is read, not calculated against. */
function asPercent(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

/**
 * Human-readable effect lines for an item: stat bonuses, resistances, reflect,
 * skill bonuses, stun chance, regen.
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
      if (amount) lines.push(`+${amount} ${STAT_LABELS[stat]}`);
    }
  }

  const meleeOnly = item.meleeOnlyStatBonus;
  if (meleeOnly) {
    for (const stat of ALL_STATS) {
      const amount = meleeOnly[stat];
      if (amount) lines.push(`+${amount} ${STAT_LABELS[stat]} (melee only)`);
    }
  }

  const resistances = item.resistances;
  if (resistances && resistances.length > 0) {
    const named = resistances.map((type) => RESISTANCE_LABELS[type]).join(', ');
    lines.push(`Resists: ${named}`);
  }

  if (item.damageReflectPct) {
    lines.push(`Reflects ${asPercent(item.damageReflectPct)}% of melee damage`);
  }

  if (item.cancelsMomentum) lines.push('Momentum attacks cannot touch you');

  const skillLevelBonus = item.skillLevelBonus;
  if (skillLevelBonus) {
    for (const id of SKILL_IDS) {
      const amount = skillLevelBonus[id];
      if (amount) lines.push(`+${amount} ${getSkillDef(id).name}`);
    }
  }

  if (item.stunOnHitChance) {
    lines.push(`${asPercent(item.stunOnHitChance)}% stun on hit`);
  }

  const regen = item.regenMultiplier;
  if (regen !== undefined && regen !== 1) {
    lines.push(`${asPercent(regen - 1) >= 0 ? '+' : ''}${asPercent(regen - 1)}% HP regen`);
  }

  if (item.wearer) lines.push(WEARER_LABELS[item.wearer]);

  return lines;
}
