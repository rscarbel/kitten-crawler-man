/**
 * The state behind every counter the shop screen draws: the tavern's drinks,
 * the temple's blessing, a market stall's stock, the Anchor's destinations,
 * the general store. The session owns the coins; the caller's purchase
 * handler owns the effect, whether that is a service performed on the spot or
 * an item pushed into a bag. A handler that cannot deliver (a full bag)
 * answers `ok: false` and the purse is left alone: money moves only when the
 * goods do.
 *
 * Pure state, no drawing: `shopScreenSurface` renders a session, and headless
 * checks drive one through {@link ShopSession.pressBuy}.
 */

import { canAffordCoins, spendPartyCoins } from '../../../core/partyCoins';
import { ITEM_DEF, isItemId, type ItemId } from '../../../core/ItemDefs';
import type { Player } from '../../../Player';
import {
  addHeldStock,
  decayHeldStock,
  heldFor,
  type HeldStock,
} from '../../../systems/market/MarketStock';
import { shopSellPrice, type ShopPricingProfile } from '../../../systems/market/shopPricing';
import { sellableHoldings } from '../../../systems/market/sellableInventory';
import type { Rect } from '../../core/geom';
import type { GlyphId } from '../../theme/glyphs';

/** What sits at the start of a row: an item's own icon, or a glyph for a service. */
export type ShopRowIcon =
  | { readonly kind: 'item'; readonly item: ItemId }
  | { readonly kind: 'glyph'; readonly glyph: GlyphId };

export interface ShopRow {
  /** Stable identifier for the row, so a handler can act on a rebuilt menu. */
  readonly key: string;
  readonly label: string;
  readonly price: number;
  readonly desc: string;
  /** When set, the row cannot be bought and shows this instead (e.g. "Already inked", "Sold out"). */
  unavailable?: string;
  /**
   * A questline's errand rather than ordinary stock. Drawn in quest gold, and
   * while it is affordable it is the row a bare accept press buys, so a
   * player sent for one thing can take it without navigating past the rest.
   */
  readonly isQuestItem?: boolean;
  /** Defaults to the item's icon when `key` is an item id, else the menu's `rowGlyph`. */
  readonly icon?: ShopRowIcon;
}

/** A menu of free actions rather than goods: no prices, no purse, and each row's button reads `actionLabel`. */
export interface UnpricedRows {
  readonly actionLabel: string;
}

/** Paints a small picture into `rect`, beside the counter's bark. */
export type ShopTitleIcon = (ctx: CanvasRenderingContext2D, rect: Rect) => void;

export interface ShopMenu {
  readonly title: string;
  /** The seller's opening line, shown until a purchase replaces it with feedback. */
  readonly bark: string;
  /** Who is selling, under the title. Omit where the room is the seller and a name would repeat the title. */
  readonly byline?: string;
  readonly options: readonly ShopRow[];
  readonly unpriced?: UnpricedRows;
  readonly titleIcon?: ShopTitleIcon;
  /** The leading glyph of a row whose key is not an item and which names no icon of its own. */
  readonly rowGlyph?: GlyphId;
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
 * Opts a counter into the Sell tab, priced by the shared market engine. A
 * counter with no goods to buy back (a blessing, a room) never passes one.
 */
export interface ShopSellConfig {
  readonly pricing: ShopPricingProfile;
  /** This counter's own held-stock record. */
  readonly heldStock: HeldStock;
  readonly vendorId: string;
  /** The catalog price a sale is quoted against, for a counter whose catalog fixes its prices. */
  readonly catalogPrice?: (id: ItemId) => number | undefined;
  /**
   * Whether the session decays the held stock while it is open. False for a
   * counter whose owner already decays it every tick, whether or not the
   * menu is up, so it is not decayed twice.
   */
  readonly decaysWhileOpen?: boolean;
  /** Runs after each successful sale, for the caller to layer its own sound. */
  readonly onSold?: () => void;
}

/** Everything `open` takes besides the menu and the purchase. */
export interface ShopOpenOptions {
  /** Called when the player presses a Buy the session refuses; a disabled Buy is otherwise only the error cue. */
  readonly onBlocked?: () => void;
  readonly blockedLine?: ShopBlockedLine;
  /**
   * For a row that becomes a dearer product the moment it sells (a tool's
   * next tier): how many ticks after a sale a further Buy is ignored, so a
   * double press buys once rather than twice up the ladder.
   */
  readonly rebuyGuardTicks?: number;
  readonly sell?: ShopSellConfig;
  /** Rebuild the rows every tick, for a counter whose prices drift while it is open. */
  readonly liveRows?: boolean;
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
  /** What the counter pays for the next unit. */
  readonly unitPrice: number;
}

/** Ticks a purchase's or sale's line stays in place of the bark. */
export const SHOP_FEEDBACK_TICKS = 110;
/** The last ticks of a feedback line, over which it fades back to the bark. */
export const SHOP_FEEDBACK_FADE_TICKS = 25;

const NOT_HELD_LINE = "You don't have one of those!";

/** Whether `option` can be bought: available and, on a priced menu, affordable. */
export function shopRowEnabled(option: ShopRow, unpriced: boolean, party: ShopParty): boolean {
  if (option.unavailable !== undefined) return false;
  if (unpriced) return true;
  return canAffordCoins(party.active, party.companion, option.price);
}

export class ShopSession {
  private menu: ShopMenu | null = null;
  private build: ShopMenuBuilder | null = null;
  private purchase: ShopPurchaseHandler | null = null;
  private options: ShopOpenOptions = {};
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
    return this.options.sell ?? null;
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

  open(build: ShopMenuBuilder, purchase: ShopPurchaseHandler, options: ShopOpenOptions = {}): void {
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
    this.options = {};
    this.mode = 'buy';
  }

  /** One game tick: feedback and the rebuy guard run down, and an open Sell tab's held stock recovers. */
  update(): void {
    if (this.feedbackLeft > 0) this.feedbackLeft--;
    if (this.rebuyGuardLeft > 0) this.rebuyGuardLeft--;
    if (this.menu === null) return;
    const sell = this.options.sell;
    if (sell !== undefined && sell.decaysWhileOpen !== false) {
      decayHeldStock(sell.heldStock, sell.pricing.heldStockRecoveryPerTick);
    }
    if (this.options.liveRows === true) this.menu = this.build?.() ?? this.menu;
  }

  setMode(mode: ShopMode): void {
    if (mode === 'sell' && this.options.sell === undefined) return;
    this.mode = mode;
  }

  /** The row a bare accept press buys: an affordable quest row, or null when Close keeps the primary. */
  questDefaultRow(party: ShopParty): ShopRow | null {
    const menu = this.menu;
    if (menu === null || this.mode !== 'buy') return null;
    return (
      menu.options.find(
        (option) =>
          option.isQuestItem === true && shopRowEnabled(option, menu.unpriced !== undefined, party),
      ) ?? null
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
    return this.options.onBlocked !== undefined;
  }

  tryBuy(option: ShopRow, party: ShopParty): void {
    const purchase = this.purchase;
    if (purchase === null || this.rebuyGuardLeft > 0) return;
    const unpriced = this.menu?.unpriced !== undefined;
    if (!shopRowEnabled(option, unpriced, party)) {
      this.options.onBlocked?.();
      const refusal = this.options.blockedLine?.(option, party.active) ?? null;
      if (refusal !== null) this.showFeedback(refusal);
      return;
    }
    const result = purchase(option, party.active);
    if (result.ok) {
      if (!unpriced) spendPartyCoins(party.active, party.companion, option.price, party.active);
      this.rebuyGuardLeft = this.options.rebuyGuardTicks ?? 0;
    }
    if (this.purchase === null) return;
    this.menu = this.build?.() ?? this.menu;
    this.showFeedback(result.line);
  }

  /** What the counter pays for one more unit of `id` once `alreadySold` more have gone over the counter. */
  private unitSellPrice(sell: ShopSellConfig, id: ItemId, alreadySold: number): number {
    const held = heldFor(sell.heldStock, sell.vendorId, id) + alreadySold;
    return shopSellPrice(id, sell.pricing, held, sell.catalogPrice?.(id));
  }

  /** The Sell tab's rows, read live off the bag so a sale shows the instant it happens. */
  sellRows(seller: Player): SellRow[] {
    const sell = this.options.sell;
    if (sell === undefined) return [];
    return sellableHoldings(seller).map(({ id, qty }) => ({
      id,
      held: qty,
      unitPrice: this.unitSellPrice(sell, id, 0),
    }));
  }

  /**
   * What selling `quantity` of `id` would pay in total. Every unit sold pushes
   * the counter's held stock up and its price down, so the units are quoted
   * one at a time, exactly as selling them one at a time would pay.
   */
  sellQuote(id: ItemId, quantity: number): number {
    const sell = this.options.sell;
    if (sell === undefined) return 0;
    let total = 0;
    for (let sold = 0; sold < quantity; sold++) total += this.unitSellPrice(sell, id, sold);
    return total;
  }

  /** Sells up to `quantity` of `id`, one unit at a time at each unit's own price. Returns the units sold. */
  sell(id: ItemId, quantity: number, seller: Player): number {
    const sell = this.options.sell;
    if (sell === undefined || !isItemId(id)) return 0;
    let sold = 0;
    let earned = 0;
    while (sold < quantity) {
      const price = this.unitSellPrice(sell, id, 0);
      if (!seller.inventory.removeOne(id)) break;
      seller.earnCoins(price);
      addHeldStock(sell.heldStock, sell.vendorId, id);
      earned += price;
      sold++;
    }
    if (sold === 0) {
      this.showFeedback(NOT_HELD_LINE);
      return 0;
    }
    const name = ITEM_DEF[id].name;
    const what = sold === 1 ? name : `${sold} × ${name}`;
    this.showFeedback(`Sold ${what} for ${earned} coins.`);
    sell.onSold?.();
    return sold;
  }

  private showFeedback(line: string): void {
    if (line.length === 0) return;
    this.feedback = line;
    this.feedbackLeft = SHOP_FEEDBACK_TICKS;
  }
}
