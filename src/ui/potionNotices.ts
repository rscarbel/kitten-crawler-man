import type { ItemId } from '../core/ItemDefs';
import type { StatName } from '../Player';

/**
 * Toast copy for potions whose effect reads the same every time. Kept apart from
 * `ITEM_DEF`'s prose descriptions: these are glanced at mid-fight, so they say
 * only what changed.
 */
const FIXED_EFFECT_NOTICES: Partial<Record<ItemId, string>> = {
  health_potion: 'Health restored',
  speed_fizz: 'Speed temporarily increased',
  jugg_juice: 'Max HP temporarily increased',
  cooldown_crisp: 'Cooldowns temporarily halved',
  dirty_shirley: 'Health restored — and you are drunk',
};

/**
 * The line to toast after drinking `id`, or null when the potion's effect varies
 * per drink and the caller reports it itself — see {@link statBoostNotice}.
 */
export function potionEffectNotice(id: ItemId): string | null {
  return FIXED_EFFECT_NOTICES[id] ?? null;
}

const STAT_LABELS: Record<StatName, string> = {
  strength: 'Strength',
  intelligence: 'Intelligence',
  constitution: 'Constitution',
  dexterity: 'Dexterity',
};

export function statBoostNotice(stat: StatName, amount: number): string {
  return `${STAT_LABELS[stat]} increased by ${amount}`;
}
