/**
 * The party's coins as one purse. Each crawler still keeps their own `coins`
 * count — what they picked up and were paid — but every price is paid from
 * the two together, whoever is being controlled.
 */

export interface CoinHolder {
  coins: number;
}

/** Both crawlers' coins together. */
export function partyCoins(human: CoinHolder, cat: CoinHolder): number {
  return human.coins + cat.coins;
}

export function canAffordCoins(human: CoinHolder, cat: CoinHolder, amount: number): boolean {
  return partyCoins(human, cat) >= amount;
}

/**
 * Pays `amount` from the shared purse, taking from `active` first and the
 * companion only for what `active` cannot cover. Removes nothing when the
 * purse cannot cover it.
 *
 * @returns false when the party could not afford it.
 */
export function spendPartyCoins(
  human: CoinHolder,
  cat: CoinHolder,
  amount: number,
  active: CoinHolder,
): boolean {
  if (amount <= 0) return true;
  if (!canAffordCoins(human, cat, amount)) return false;
  const companion = active === human ? cat : human;
  const fromActive = Math.min(amount, active.coins);
  active.coins -= fromActive;
  companion.coins -= amount - fromActive;
  return true;
}
