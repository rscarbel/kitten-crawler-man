/**
 * What every Briar Hollow shop and service shares: who the party is, which
 * phases keep the shops shut, and the one way a seller's words are looked up.
 *
 * A service never types a word of a villager's dialogue. It names the
 * circumstance and `sellerLine` fetches the verbatim line, so the dialogue
 * table stays the only place any of it is written.
 */

import type { ItemId } from '../../../core/ItemDefs';
import type { VillageQuestPhase } from '../../../core/villageQuestPhase';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import { type Circumstance, type VillagerId, line } from '../ratkinDialogue';
import { isShopClosed } from '../villagerCircumstances';
import type { ConversationTopic } from '../villagerTopics';
import type {
  PricedBlockedLine,
  PricedMenuBuilder,
  PricedPurchaseHandler,
} from '../../../ui/PricedMenuPanel';

export type Crawler = HumanPlayer | CatPlayer;

/** Both crawlers, and which one the player is steering — the one every shop charges. */
export interface ServiceParty {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  active(): Crawler;
}

/** The notice for goods that had nowhere to go: the sale is refused and nothing is charged. */
export const BAG_FULL_LINE = 'Your bag is full.';

/** The phases before the Mayor's request is accepted, when the smith has no work for the party. */
const BEFORE_THE_QUEST: ReadonlySet<VillageQuestPhase> = new Set(['unmet', 'offered', 'declined']);

/** Whether the party has taken the Mayor's request on, at any point since. */
export function questAccepted(phase: VillageQuestPhase): boolean {
  return !BEFORE_THE_QUEST.has(phase);
}

/**
 * Whether a shop still trades. Every counter shuts while the enemy is at the
 * gate — except the infirmary, which is the one that matters mid-siege, and
 * never asks this.
 */
export function shopTrades(phase: VillageQuestPhase): boolean {
  return !isShopClosed(phase);
}

/**
 * A villager's verbatim line for `circumstance`. Every call site names a line
 * the table has for that villager, which the service gate checks; the empty
 * fallback only keeps a missing line from ever printing "undefined".
 */
export function sellerLine(villager: VillagerId, circumstance: Circumstance): string {
  return line(villager, circumstance) ?? '';
}

/** The companion of `crawler`. */
export function otherCrawler(party: ServiceParty, crawler: Crawler): Crawler {
  return crawler === party.human ? party.cat : party.human;
}

/**
 * Who can take delivery of `id`: `preferred` when their pack has room for it,
 * else the companion, else nobody. Stacks never cap, so "room" is a stack
 * already held or a free slot.
 */
export function recipientFor(party: ServiceParty, preferred: Crawler, id: ItemId): Crawler | null {
  if (preferred.inventory.hasRoomFor(id)) return preferred;
  const companion = otherCrawler(party, preferred);
  return companion.inventory.hasRoomFor(id) ? companion : null;
}

/** One shop's rows, what a purchase does, and what the seller says to a refused one. */
export interface ShopDefinition {
  readonly build: PricedMenuBuilder;
  readonly purchase: PricedPurchaseHandler;
  readonly blockedLine?: PricedBlockedLine;
  /** See `PricedMenuPanel.open`: how long a Buy is ignored after a sale. Absent, every press buys. */
  readonly rebuyGuardFrames?: number;
}

/** Where a shop topic sends the party: the priced menu, opened over the village. */
export interface ShopCounter {
  openShop(shop: ShopDefinition): void;
}

/**
 * A topic that closes the conversation and opens a shop in its place — the
 * menu and the conversation never share the screen, so Escape and the
 * walk-away rule each have one thing to close.
 */
export function shopTopic(
  key: string,
  label: string,
  counter: ShopCounter,
  shop: () => ShopDefinition,
): ConversationTopic {
  return {
    key,
    label,
    run: (ctl) => {
      ctl.afterClose(() => counter.openShop(shop()));
      ctl.close();
    },
  };
}
