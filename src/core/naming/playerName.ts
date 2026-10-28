/**
 * The name the player gives their human crawler: what the game calls them by
 * in dialog, not a legal full name.
 */

import {
  NAME_MAX_CODE_UNITS,
  nameRejection,
  nameRuleMessages,
  normalizeName,
  type NameCaps,
  type NameRejection,
} from './nameRules';

/**
 * The most characters the player's name may show. A given name, or one with a
 * short surname, almost never runs past it, and it still fits a dialog
 * nameplate on a phone.
 */
export const PLAYER_NAME_MAX_GRAPHEMES = 24;

const PLAYER_NAME_CAPS = {
  maxGraphemes: PLAYER_NAME_MAX_GRAPHEMES,
  maxCodeUnits: NAME_MAX_CODE_UNITS,
} as const satisfies NameCaps;

declare const playerNameBrand: unique symbol;

/** A name that passed {@link parsePlayerName}; nothing else can make one. */
export type PlayerName = string & { readonly [playerNameBrand]: true };

function isPlayerName(normalized: string): normalized is PlayerName {
  return nameRejection(normalized, PLAYER_NAME_CAPS) === null;
}

/** `raw` as the player's name, tidied, or null when it breaks a rule. */
export function parsePlayerName(raw: string): PlayerName | null {
  const normalized = normalizeName(raw);
  return isPlayerName(normalized) ? normalized : null;
}

/** The rule `raw` breaks as the player's name, or null when it is one. */
export function playerNameRejection(raw: string): NameRejection | null {
  return nameRejection(normalizeName(raw), PLAYER_NAME_CAPS);
}

/** The line a naming screen shows for each rule the player's name can break. */
export const PLAYER_NAME_RULE_MESSAGES = nameRuleMessages(PLAYER_NAME_CAPS);
