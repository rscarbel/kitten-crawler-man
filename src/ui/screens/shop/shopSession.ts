/**
 * The state behind every counter the shop screen draws: the tavern's drinks,
 * the temple's blessing, a market stall's stock, the Anchor's destinations,
 * the general store. The session owns the coins; the caller's purchase
 * handler owns the effect, whether that is a service performed on the spot or
 * an item pushed into a bag. A handler that cannot deliver answers
 * `ok: false` and the purse is left alone: money moves only when the goods do.
 *
 * Pure state, no drawing: `shopScreenSurface` renders a session, and headless
 * checks drive one through {@link ShopSession.pressBuy}.
 */

import { canAffordCoins, spendPartyCoins } from '../../../core/party/partyCoins';
import { ITEM_DEF, isItemId, type ItemId } from '../../../core/items/defs/ItemDefs';
import { canAfford, spend, type ResourceCost } from '../../../core/items/gathering/partyResources';
import type { Player } from '../../../Player';
import { itemQuote, sellPrice, type PriceQuote } from '../../../economy/pricing';
import type { ShopId } from '../../../economy/shops';
import { cloneShopStock, sellToShop, type ShopStock } from '../../../economy/shopStock';
import { sellableHoldings } from '../../../systems/market/sellableInventory';
import type { Rect } from '../../core/geom';
import { RESOURCE_IDS, type ResourceId } from '../../../core/items/gathering/resourceIds';
import type { ServiceIconId } from '../../../sprites/art/itemIcons/serviceIcons';

/**
 * The picture on an offer: an item's own icon, or a painted service (a
 * drink poured on the spot, a room, a blessing, a destination).
 */
export type ShopArt =
  | { readonly kind: 'item'; readonly item: ItemId }
  | { readonly kind: 'service'; readonly service: ServiceIconId };

/** One raw material an offer costs, read against both crawlers' combined packs. */
export interface MaterialLine {
  readonly resource: ResourceId;
  readonly amount: number;
}

/** What taking an offer costs, every part of which the card shows. */
export type ShopCost =
  /** Nothing: the row's button does a free thing, named by `actionLabel` ("Travel"). */
  | { readonly kind: 'free'; readonly actionLabel: string }
  /** A flat fee for a service. */
  | { readonly kind: 'coins'; readonly coins: number }
  /** Goods priced by the engine against the shop's stock; the quote is its working and its tags. */
  | { readonly kind: 'quoted'; readonly quote: PriceQuote }
  /** Coins plus raw materials, charged together from the party. */
  | {
      readonly kind: 'coinsAndMaterials';
      readonly coins: number;
      readonly materials: readonly [MaterialLine, ...MaterialLine[]];
    };

/** Whether an offer can be taken, and what it costs while it can or could be. */
export type ShopOffer =
  | { readonly status: 'open'; readonly cost: ShopCost }
  /** Shut for now ("Sold out", "Unhurt"); the cost still shows, greyed. */
  | { readonly status: 'closed'; readonly reason: string; readonly cost: ShopCost }
  /** Nothing left to sell here at any price ("Finest", "Nothing left I can teach you"). */
  | { readonly status: 'spent'; readonly reason: string };

export interface ShopRow {
  /** Stable identifier for the row, so a handler can act on a rebuilt menu. */
  readonly key: string;
  readonly label: string;
  readonly desc: string;
  readonly art: ShopArt;
  readonly offer: ShopOffer;
  /**
   * A questline's errand rather than ordinary stock. Drawn in quest gold, and
   * while it is affordable it is the row a bare accept press buys, so a
   * player sent for one thing can take it without navigating past the rest.
   */
  readonly questErrand: boolean;
}

/** Paints a small picture into `rect`, beside the counter's bark. */
export type ShopEmblem = (ctx: CanvasRenderingContext2D, rect: Rect) => void;

export interface ShopMenu {
  readonly title: string;
  /** The seller's opening line, shown until a purchase replaces it with feedback. */
  readonly bark: string;
  /** Who is selling, under the title; null where the room is the seller and a name would repeat the title. */
  readonly byline: string | null;
  /** A picture beside the bark, for a counter that is a thing rather than a person; null for none. */
  readonly emblem: ShopEmblem | null;
  readonly options: readonly ShopRow[];
}

/** The coins `cost` takes. */
export function costCoins(cost: ShopCost): number {
  switch (cost.kind) {
    case 'free':
      return 0;
    case 'coins':
    case 'coinsAndMaterials':
      return cost.coins;
    case 'quoted':
      return cost.quote.breakdown.final;
  }
}

/** The raw materials `cost` takes, as the party's resource ledger reads them. */
export function costMaterials(cost: ShopCost): ResourceCost {
  const materials: ResourceCost = {};
  if (cost.kind !== 'coinsAndMaterials') return materials;
  for (const line of cost.materials) materials[line.resource] = line.amount;
  return materials;
}

/**
 * A coin fee, with `materials` added when there are any: a cost whose
 * material list is empty is a plain coin fee, so the card never shows an
 * empty materials line.
 */
export function coinsWithMaterials(coins: number, materials: ResourceCost): ShopCost {
  const lines = RESOURCE_IDS.flatMap((resource): MaterialLine[] => {
    const amount = materials[resource];
    return amount === undefined || amount <= 0 ? [] : [{ resource, amount }];
  });
  if (lines.length === 0) return { kind: 'coins', coins };
  const [first, ...rest] = lines;
  return { kind: 'coinsAndMaterials', coins, materials: [first, ...rest] };
}

/** An offer that is open unless `closedReason` names why not. */
export function offerUnless(closedReason: string | null, cost: ShopCost): ShopOffer {
  return closedReason === null
    ? { status: 'open', cost }
    : { status: 'closed', reason: closedReason, cost };
}

/** The offer's cost, or null when there is nothing left to sell. */
export function offerCost(offer: ShopOffer): ShopCost | null {
  return offer.status === 'spent' ? null : offer.cost;
}

/** The coins a row asks, or null when there is nothing left to sell. */
export function rowCoins(row: ShopRow): number | null {
  const cost = offerCost(row.offer);
  return cost === null ? null : costCoins(cost);
}

/** Why the offer cannot be taken at any price right now, or null while it is open. */
export function offerClosedReason(offer: ShopOffer): string | null {
  return offer.status === 'open' ? null : offer.reason;
}

/** The engine's working behind a row's price, or null for a fee or a free row. */
export function rowQuote(row: ShopRow): PriceQuote | null {
  const cost = offerCost(row.offer);
  return cost?.kind === 'quoted' ? cost.quote : null;
}

/** Whether any row on `menu` costs coins, which is when the counter shows the purse. */
export function menuTakesCoins(menu: ShopMenu): boolean {
  return menu.options.some((row) => {
    const cost = offerCost(row.offer);
    return cost !== null && cost.kind !== 'free';
  });
}

/** What a handler did: whether the purchase went through, and the line to echo. */
export interface ShopPurchaseResult {
  readonly ok: boolean;
  readonly line: string;
}

/** Performs a purchase. Runs before the coins are taken, so a handler that cannot deliver can refuse uncharged. */
export type ShopPurchaseHandler = (option: ShopRow, player: Player) => ShopPurchaseResult;

/** Builds the current menu; re-run after every purchase so availability stays honest. */
export type ShopMenuBuilder = () => ShopMenu;

/** The seller's answer to a Buy the session refused, shown in place of the bark; null leaves the bark. */
export type ShopBlockedLine = (option: ShopRow, player: Player) => string | null;

/**
 * Opts a counter into the Sell tab, priced by the shop's `SHOPS` entry against
 * the shared stock record. A counter with no goods to buy back (a blessing, a
 * room) never passes one.
 */
export interface ShopSellConfig {
  readonly shop: ShopId;
  /** The stock record the shop keeps; a sale puts the unit on this shop's shelf. */
  readonly stock: ShopStock;
  /** Runs after each successful sale, for the caller to layer its own sound; null when the counter adds none. */
  readonly onSold: (() => void) | null;
}

/** Everything `open` takes besides the menu and the purchase. */
export interface ShopOpenOptions {
  /**
   * Called when the player presses a Buy the session refuses. Null leaves the
   * refusal to the screen's own error cue.
   */
  readonly onBlocked: (() => void) | null;
  /** Null when the seller has nothing to say to a refused Buy, so the bark stays. */
  readonly blockedLine: ShopBlockedLine | null;
  /**
   * For a row that becomes a dearer product the moment it sells (a tool's
   * next tier): how many ticks after a sale a further Buy is ignored, so a
   * double press buys once rather than twice up the ladder. Zero for a row
   * that sells the same product again.
   */
  readonly rebuyGuardTicks: number;
  /** Null for a counter with no Sell tab. */
  readonly sell: ShopSellConfig | null;
  /** Rebuild the rows every tick, for a counter whose prices drift while it is open. */
  readonly liveRows: boolean;
}

/** Who pays and who stands beside them. */
export interface ShopParty {
  readonly active: Player;
  readonly companion: Player;
}

export type ShopMode = 'buy' | 'sell';

/** One stack the Sell tab offers. */
export interface SellRow {
  readonly id: ItemId;
  readonly held: number;
  /** What the counter pays for the next unit, and why. */
  readonly quote: PriceQuote;
}

/** Ticks a purchase's or sale's line stays in place of the bark. */
export const SHOP_FEEDBACK_TICKS = 110;
/** The last ticks of a feedback line, over which it fades back to the bark. */
export const SHOP_FEEDBACK_FADE_TICKS = 25;

const NOT_HELD_LINE = "You don't have one of those!";

/** Whether `option` can be taken right now: open, and its whole cost covered by the party. */
export function shopRowEnabled(option: ShopRow, party: ShopParty): boolean {
  if (option.offer.status !== 'open') return false;
  const { cost } = option.offer;
  if (!canAffordCoins(party.active, party.companion, costCoins(cost))) return false;
  return canAfford(party.active, party.companion, costMaterials(cost));
}

/**
 * What a closed session holds, so nothing it reads between `close` and the
 * next `open` can reach the last counter's handlers.
 */
const CLOSED_SHOP_OPTIONS: ShopOpenOptions = {
  onBlocked: null,
  blockedLine: null,
  rebuyGuardTicks: 0,
  sell: null,
  liveRows: false,
};

/** A completed purchase or sale, as reported to `onShopTrade` listeners. */
export type ShopTrade =
  | { kind: 'buy'; crawler: Player; item: string; coins: number; shop: string }
  | { kind: 'sell'; crawler: Player; item: string; quantity: number; coins: number; shop: string };

export type ShopTradeListener = (trade: ShopTrade) => void;

/**
 * Every listener is told of every trade at every counter. Sessions are built
 * by many systems (stores, the club, the village, travel), none of which holds
 * the scene's bus, so the scene listens here instead of hooking each one.
 */
const tradeListeners = new Set<ShopTradeListener>();

/**
 * Listens to every purchase that went through and every sale of at least one
 * unit, at every shop counter. Returns the unsubscribe function.
 */
export function onShopTrade(listener: ShopTradeListener): () => void {
  tradeListeners.add(listener);
  return () => {
    tradeListeners.delete(listener);
  };
}

function reportTrade(trade: ShopTrade): void {
  for (const listener of tradeListeners) listener(trade);
}

export class ShopSession {
  private menu: ShopMenu | null = null;
  private build: ShopMenuBuilder | null = null;
  private purchase: ShopPurchaseHandler | null = null;
  private options: ShopOpenOptions = CLOSED_SHOP_OPTIONS;
  private rebuyGuardLeft = 0;
  private feedback = '';
  private feedbackLeft = 0;
  /** Bumped every time the session opens, so a screen can tell a reopened counter from one still open. */
  private openCount = 0;
  mode: ShopMode = 'buy';

  get isOpen(): boolean {
    return this.menu !== null;
  }

  /** Changes every time the session opens. */
  get generation(): number {
    return this.openCount;
  }

  get currentMenu(): ShopMenu | null {
    return this.menu;
  }

  get sellConfig(): ShopSellConfig | null {
    return this.options.sell;
  }

  /** The rows on offer right now, or none while closed. */
  get rows(): readonly ShopRow[] {
    return this.menu?.options ?? [];
  }

  /** The line the header shows: the last purchase's feedback while it lasts, else the bark. */
  get currentLine(): string {
    const menu = this.menu;
    if (menu === null) return '';
    return this.feedbackLeft > 0 ? this.feedback : menu.bark;
  }

  /** 1 while a feedback line is fresh, falling to 0 as it fades back to the bark; 0 when showing the bark. */
  get feedbackStrength(): number {
    if (this.feedbackLeft <= 0) return 0;
    return Math.min(1, this.feedbackLeft / SHOP_FEEDBACK_FADE_TICKS);
  }

  open(build: ShopMenuBuilder, purchase: ShopPurchaseHandler, options: ShopOpenOptions): void {
    this.build = build;
    this.menu = build();
    this.purchase = purchase;
    this.options = options;
    this.rebuyGuardLeft = 0;
    this.feedbackLeft = 0;
    this.mode = 'buy';
    this.openCount++;
  }

  close(): void {
    this.menu = null;
    this.build = null;
    this.purchase = null;
    this.options = CLOSED_SHOP_OPTIONS;
    this.mode = 'buy';
  }

  /**
   * One game tick: feedback and the rebuy guard run down. Stock restocks on
   * the scene's own clock whether or not any counter is open, so the session
   * leaves it alone.
   */
  update(): void {
    if (this.feedbackLeft > 0) this.feedbackLeft--;
    if (this.rebuyGuardLeft > 0) this.rebuyGuardLeft--;
    if (this.menu === null) return;
    if (this.options.liveRows) this.rebuildMenu();
  }

  setMode(mode: ShopMode): void {
    if (mode === 'sell' && this.options.sell === null) return;
    this.mode = mode;
  }

  /** The row a bare accept press buys: an affordable quest row, or null when Close keeps the primary. */
  questDefaultRow(party: ShopParty): ShopRow | null {
    const menu = this.menu;
    if (menu === null || this.mode !== 'buy') return null;
    return (
      menu.options.find((option) => option.questErrand && shopRowEnabled(option, party)) ?? null
    );
  }

  /**
   * Presses the Buy of the row keyed `key` exactly as a tap would: refused,
   * charged or not by the same rules. Returns whether such a row was on the menu.
   */
  pressBuy(key: string, party: ShopParty): boolean {
    const option = this.menu?.options.find((candidate) => candidate.key === key);
    if (option === undefined) return false;
    this.tryBuy(option, party);
    return true;
  }

  /** Whether the opener sounds a refused purchase itself, so the screen must not sound it too. */
  get soundsOwnRefusal(): boolean {
    return this.options.onBlocked !== null;
  }

  tryBuy(pressed: ShopRow, party: ShopParty): void {
    const purchase = this.purchase;
    if (purchase === null || this.rebuyGuardLeft > 0) return;
    this.rebuildMenu();
    const option = this.menu?.options.find((candidate) => candidate.key === pressed.key);
    if (option === undefined) return;
    if (option.offer.status !== 'open' || !shopRowEnabled(option, party)) {
      const { onBlocked, blockedLine } = this.options;
      if (onBlocked !== null) onBlocked();
      const refusal = blockedLine === null ? null : blockedLine(option, party.active);
      if (refusal !== null) this.showFeedback(refusal);
      return;
    }
    const result = purchase(option, party.active);
    if (result.ok) {
      const { cost } = option.offer;
      spendPartyCoins(party.active, party.companion, costCoins(cost), party.active);
      spend(party.active, party.companion, costMaterials(cost), party.active);
      this.rebuyGuardLeft = this.options.rebuyGuardTicks;
      reportTrade({
        kind: 'buy',
        crawler: party.active,
        item: option.label,
        coins: costCoins(cost),
        shop: this.menu?.title ?? '',
      });
    }
    if (this.purchase === null) return;
    this.rebuildMenu();
    this.showFeedback(result.line);
  }

  /**
   * Re-reads every row from the builder. Run after anything that moves stock
   * or coins, and again just before a purchase, so the row that is charged is
   * the engine's price for the shelf as it stands rather than the price the
   * panel last drew.
   */
  private rebuildMenu(): void {
    this.menu = this.build?.() ?? this.menu;
  }

  /** The Sell tab's rows, read live off the bag so a sale shows the instant it happens. */
  sellRows(seller: Player): SellRow[] {
    const sell = this.options.sell;
    if (sell === null) return [];
    return sellableHoldings(seller).map(({ id, qty }) => ({
      id,
      held: qty,
      quote: itemQuote(sell.shop, id, sell.stock, 'sell'),
    }));
  }

  /**
   * What selling `quantity` of `id` would pay in total. Every unit sold puts
   * one more on the shop's shelf and lowers its price, so the units are quoted
   * one at a time on a scratch copy of the stock, exactly as selling them one
   * at a time would pay.
   */
  sellQuote(id: ItemId, quantity: number): number {
    const sell = this.options.sell;
    if (sell === null) return 0;
    let total = 0;
    const scratch = cloneShopStock(sell.stock);
    for (let sold = 0; sold < quantity; sold++) {
      total += sellPrice(sell.shop, id, scratch);
      sellToShop(scratch, sell.shop, id);
    }
    return total;
  }

  /** Sells up to `quantity` of `id`, one unit at a time at each unit's own price. Returns the units sold. */
  sell(id: ItemId, quantity: number, seller: Player): number {
    const sell = this.options.sell;
    if (sell === null || !isItemId(id)) return 0;
    let sold = 0;
    let earned = 0;
    while (sold < quantity) {
      const price = sellPrice(sell.shop, id, sell.stock);
      if (!seller.inventory.removeOne(id)) break;
      seller.earnCoins(price);
      sellToShop(sell.stock, sell.shop, id);
      earned += price;
      sold++;
    }
    if (sold === 0) {
      this.showFeedback(NOT_HELD_LINE);
      return 0;
    }
    const name = ITEM_DEF[id].name;
    const what = sold === 1 ? name : `${sold} × ${name}`;
    this.rebuildMenu();
    this.showFeedback(`Sold ${what} for ${earned} coins.`);
    if (sell.onSold !== null) sell.onSold();
    reportTrade({
      kind: 'sell',
      crawler: seller,
      item: name,
      quantity: sold,
      coins: earned,
      shop: this.menu?.title ?? '',
    });
    return sold;
  }

  private showFeedback(line: string): void {
    if (line.length === 0) return;
    this.feedback = line;
    this.feedbackLeft = SHOP_FEEDBACK_TICKS;
  }
}
