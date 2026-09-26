/**
 * Doctor Sella's infirmary: both crawlers patched up to full, a downed one
 * stood back up, for a fee that grows with how hurt the party is.
 *
 * The one counter that stays open through the siege — the village's healer is
 * the service that matters most while the dead are at the wall.
 *
 * Crawler health is counted in tens, not hundreds (a floor-3 pair holds about
 * 20 between them), so a per-point fee has to be a fraction of a coin to keep
 * a half-health party's treatment near one and a half potions. The minimum is
 * one potion: a scratch is never cheaper to have seen to than to drink away.
 */

import { HEALTH_POTION_PRICE } from '../../market/vendorDefs';
import type { PricedMenu, PricedOption, PricedPurchaseResult } from '../../../ui/PricedMenuPanel';
import type { TopicProvider } from '../villagerTopics';
import { villagerEntry } from '../ratkinDialogue';
import {
  type Crawler,
  type ServiceParty,
  type ShopCounter,
  type ShopDefinition,
  sellerLine,
  shopTopic,
} from './serviceContext';

/** Coins per point of health missing across both crawlers, rounded up. */
export const SELLA_FEE_PER_MISSING_HP = 0.7;
export const SELLA_MIN_FEE = HEALTH_POTION_PRICE;

const INFIRMARY_TITLE = 'The Infirmary';
export const DOCTOR = 'sella';
const TREATMENT_KEY = 'treat_party';
const UNHURT_LABEL = 'Unhurt';

function partyMembers(party: ServiceParty): readonly Crawler[] {
  return [party.human, party.cat];
}

/** Health missing across the party, a downed crawler's whole bar included. */
export function missingPartyHp(party: ServiceParty): number {
  return partyMembers(party).reduce(
    (sum, member) => sum + Math.max(0, member.maxHp - member.hp),
    0,
  );
}

export function partyIsUnhurt(party: ServiceParty): boolean {
  return partyMembers(party).every((member) => member.hp >= member.maxHp && !member.isKnockedOut);
}

export function treatmentFee(party: ServiceParty): number {
  const byWounds = Math.ceil(missingPartyHp(party) * SELLA_FEE_PER_MISSING_HP);
  return Math.max(SELLA_MIN_FEE, byWounds);
}

export function buildInfirmaryMenu(party: ServiceParty): PricedMenu {
  const option: PricedOption = {
    key: TREATMENT_KEY,
    label: 'Treat the party',
    price: treatmentFee(party),
    desc: 'Heals you and your companion to full, and stands the fallen up',
  };
  if (partyIsUnhurt(party)) option.unavailable = UNHURT_LABEL;
  return {
    title: INFIRMARY_TITLE,
    bark: sellerLine(DOCTOR, 'service_menu'),
    byline: villagerEntry(DOCTOR).name,
    options: [option],
  };
}

/** Everyone to full health; anyone downed is stood back up. */
export function treatParty(party: ServiceParty): void {
  for (const member of partyMembers(party)) member.reviveToFull();
}

/** What the infirmary asks of whoever runs the treatment the player watches. */
export interface InfirmaryHost extends ShopCounter {
  /** Plays the treatment out over the party, after they have already been healed. */
  beginTreatment(): void;
}

export function infirmaryShop(party: ServiceParty, host: InfirmaryHost): ShopDefinition {
  return {
    build: () => buildInfirmaryMenu(party),
    purchase: (option): PricedPurchaseResult => {
      if (option.key !== TREATMENT_KEY || partyIsUnhurt(party)) {
        return { ok: false, line: sellerLine(DOCTOR, 'fully_healthy') };
      }
      treatParty(party);
      host.beginTreatment();
      return { ok: true, line: sellerLine(DOCTOR, 'buy_healing') };
    },
    blockedLine: (option) =>
      option.unavailable === undefined
        ? sellerLine(DOCTOR, 'cannot_afford')
        : sellerLine(DOCTOR, 'fully_healthy'),
  };
}

/** "Treatment" under Sella's conversation — open through the siege, when it matters most. */
export function infirmaryTopics(party: ServiceParty, host: InfirmaryHost): TopicProvider {
  return {
    topics(villager) {
      if (villager !== DOCTOR) return [];
      const treatment = shopTopic('treatment', 'Treatment', host, () => infirmaryShop(party, host));
      return [
        {
          key: treatment.key,
          label: treatment.label,
          run: (ctl) => {
            if (partyIsUnhurt(party)) {
              ctl.say('fully_healthy');
              return;
            }
            treatment.run(ctl);
          },
        },
      ];
    },
  };
}
