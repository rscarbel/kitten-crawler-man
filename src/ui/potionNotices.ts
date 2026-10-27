import type { ItemId } from '../core/items/defs/ItemDefs';
import type { StatName } from '../Player';
import type { CrawlerKind } from '../core/skills/SkillManager';
import {
  HAMBURGER_FED_DURATION_SECONDS,
  HAMBURGER_STR_BONUS,
} from '../core/items/consumables/foodEffects';
import { REFRESHED_DURATION_SECONDS, REFRESHED_SPEED_FACTOR } from '../core/combat/StatusEffect';
import type { ToastOptions } from './hud/toasts';

/**
 * Toast copy for potions and foods whose effect reads the same every time. Kept apart from
 * `ITEM_DEF`'s prose descriptions: these are glanced at mid-fight, so they say
 * only what changed.
 */
const FIXED_EFFECT_NOTICES: Partial<Record<ItemId, string>> = {
  health_potion: 'Health restored',
  speed_fizz: 'Speed temporarily increased',
  jugg_juice: 'Max HP temporarily increased',
  cooldown_crisp: 'Cooldowns temporarily halved',
  catnip_tuna_water: 'Health restored — and she is buzzed',
  hollow_stew: 'Health restored',
  hamburger: `Health restored — Strength +${HAMBURGER_STR_BONUS} for ${HAMBURGER_FED_DURATION_SECONDS}s`,
};

/**
 * The line to toast after drinking `id`, or null when the potion's effect varies
 * per drink and the caller reports it itself — see {@link statBoostNotice}.
 */
export function potionEffectNotice(id: ItemId): string | null {
  return FIXED_EFFECT_NOTICES[id] ?? null;
}

/** What each crawler is called in a line about whose a thing is. */
const CRAWLER_NOUN: Record<CrawlerKind, string> = { human: 'human', cat: 'cat' };

/** The toast when a crawler reaches for a drink that belongs to `owner`. */
export function drinkRefusal(owner: CrawlerKind): string {
  return `That's the ${CRAWLER_NOUN[owner]}'s.`;
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

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;

/** `m:ss` for a whole number of seconds. */
function minutesSecondsText(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** The line to toast when a crawler steps out of a bathroom stall with the refreshed boon. */
export function refreshedNotice(): string {
  const speedBonusPercent = Math.round((REFRESHED_SPEED_FACTOR - 1) * PERCENT);
  return `Refreshed! Move speed +${speedBonusPercent}% for ${minutesSecondsText(REFRESHED_DURATION_SECONDS)}.`;
}

/** How the refreshed boon's toast is styled. */
export const REFRESHED_TOAST: ToastOptions = { tone: 'success', icon: 'sparkle' };
