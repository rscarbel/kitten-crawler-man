import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { GameSystem } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { Townsperson } from '../creatures/Townsperson';
import type { ShopId } from '../economy/shops';
import type { ShopStock } from '../economy/shopStock';
import { ShopSession } from '../ui/screens/shop/shopSession';
import { openStoreCounter } from '../ui/screens/shop/storeCounter';

const SHOPKEEPER_HALF_TILE = 0.5;
const SHOPKEEPER_INTERACT_RANGE = 3.5;

/**
 * A catalog store's counter: the town's General Store, the club's bar and
 * market. Owns where the keeper stands and the "Shop" prompt; the counter
 * itself is a {@link ShopSession} the shop screen draws, priced from the
 * shop's `SHOPS` entry against the shared stock record.
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
    private readonly shop: ShopId,
    private readonly stock: ShopStock,
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
      shop: this.shop,
      stock: this.stock,
      onTraded: () => {
        this.purchasePending = true;
      },
    });
  }

  close(): void {
    this.session.close();
  }

  /** One tick, open or not: the counter's feedback line and live prices. */
  update(): void {
    this.session.update();
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
