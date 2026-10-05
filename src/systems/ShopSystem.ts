import { TILE_SIZE } from '../core/constants';
import type { ItemId } from '../core/ItemDefs';
import type { Player } from '../Player';
import type { GameSystem } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { Townsperson } from '../creatures/Townsperson';
import { decayHeldStock, type MarketStock } from './market/MarketStock';
import type { ShopPricingProfile } from './market/shopPricing';
import { GENERAL_STORE_PRICING } from './market/shopProfiles';
import { ShopSession } from '../ui/screens/shop/shopSession';
import { openStoreCounter } from '../ui/screens/shop/storeCounter';

const SHOPKEEPER_HALF_TILE = 0.5;
const SHOPKEEPER_INTERACT_RANGE = 3.5;

const HEALTH_POTION_PRICE = 5;
export const GOBLIN_DYNAMITE_PRICE = 10;
const CONFUSING_FOG_PRICE = 15;

const DEFAULT_SHOP_TITLE = 'General Store';

export interface ShopItem {
  id: ItemId;
  label: string;
  price: number;
  desc: string;
  /** Units available for the whole run. Omit for an unlimited line, the default for every ShopSystem row. */
  stock?: number;
}

/** A shop's catalog and how it prices what it buys back. */
export interface ShopConfig {
  title: string;
  items: ReadonlyArray<ShopItem>;
  pricing: ShopPricingProfile;
}

/**
 * Backs a `ShopSystem`'s limited rows with the same cross-scene counter the
 * overworld market stalls use, so a line bought out at a club counter stays
 * sold out through a checkpoint restore or a reload the same way a market
 * stall does. Also where the shop's held-stock (what the player has sold it)
 * lives, so a sale here survives leaving and re-entering the building.
 */
export interface ShopStockConfig {
  stock: MarketStock;
  vendorId: string;
}

const SHOP_ITEMS: ReadonlyArray<ShopItem> = [
  {
    id: 'health_potion',
    label: 'Health Potion',
    price: HEALTH_POTION_PRICE,
    desc: 'Restores 50% max HP',
  },
  {
    id: 'goblin_dynamite',
    label: 'Goblin Dynamite',
    price: GOBLIN_DYNAMITE_PRICE,
    desc: 'Throw for AoE damage',
  },
  {
    id: 'scroll_of_confusing_fog',
    label: 'Scroll of Confusing Fog',
    price: CONFUSING_FOG_PRICE,
    desc: 'Blinds nearby enemies',
  },
];

/** The town's General Store: the same everyday catalog and pricing personality in every building of this type. */
export const GENERAL_STORE_CONFIG: ShopConfig = {
  title: DEFAULT_SHOP_TITLE,
  items: SHOP_ITEMS,
  pricing: GENERAL_STORE_PRICING,
};

/**
 * A catalog store's counter: the town's General Store, the club's bar and
 * market. Owns where the keeper stands, the "Shop" prompt and the held stock's
 * recovery; the counter itself is a {@link ShopSession} the shop screen draws.
 */
export class ShopSystem implements GameSystem {
  readonly session = new ShopSession();
  /** Set to true after a successful purchase or sale; consuming scene clears it and plays the sound. */
  purchasePending = false;

  /**
   * Keeper Brenna Kestrel's own occupant, the counter's sole owner — this
   * system only reads her position for the interaction prompt and range
   * check; `InteriorOccupantSystem` renders her, the same as any other
   * stationed resident. Set once the scene has built its occupant roster
   * (construction order puts this system together before that roster
   * exists), so it starts `null` and falls back to a fixed spot behind the
   * counter until then.
   */
  private keeper: Pick<Townsperson, 'x' | 'y'> | null = null;
  private readonly fallbackKeeperX: number;
  private readonly fallbackKeeperTileY = 1;

  constructor(
    interiorWidth: number,
    private readonly config: ShopConfig,
    private readonly stockConfig: ShopStockConfig,
  ) {
    this.fallbackKeeperX = Math.floor(interiorWidth / 2) * TILE_SIZE;
  }

  /** Points this system at Kestrel's own occupant, once the scene has built its roster. */
  setKeeper(keeper: Pick<Townsperson, 'x' | 'y'> | null): void {
    this.keeper = keeper;
  }

  private keeperX(): number {
    return this.keeper?.x ?? this.fallbackKeeperX;
  }

  private keeperY(): number {
    return this.keeper?.y ?? this.fallbackKeeperTileY * TILE_SIZE;
  }

  get isOpen(): boolean {
    return this.session.isOpen;
  }

  open(): void {
    openStoreCounter(this.session, {
      config: this.config,
      stock: this.stockConfig,
      onTraded: () => {
        this.purchasePending = true;
      },
    });
  }

  close(): void {
    this.session.close();
  }

  /** One tick, open or not: the counter's line and live prices, and the held stock's recovery. */
  update(): void {
    this.session.update();
    decayHeldStock(this.stockConfig.stock.held, this.config.pricing.heldStockRecoveryPerTick);
  }

  isNearShopkeeper(player: Player): boolean {
    const skPx = this.keeperX() + TILE_SIZE * SHOPKEEPER_HALF_TILE;
    const skPy = this.keeperY() + TILE_SIZE * SHOPKEEPER_HALF_TILE;
    return (
      Math.hypot(
        player.x + TILE_SIZE * SHOPKEEPER_HALF_TILE - skPx,
        player.y + TILE_SIZE * SHOPKEEPER_HALF_TILE - skPy,
      ) <
      TILE_SIZE * SHOPKEEPER_INTERACT_RANGE
    );
  }

  /**
   * Kestrel is drawn by `InteriorOccupantSystem`'s own Y-sorted pass, the
   * same as any other stationed resident — this only places the "Shop"
   * prompt at her own position, so it never floats away from her.
   */
  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (this.isOpen || !this.isNearShopkeeper(active)) return;
    const sx = this.keeperX() - camX;
    const sy = this.keeperY() - camY;
    drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, 'Shop');
  }
}
