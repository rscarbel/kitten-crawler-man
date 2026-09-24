import { SmallSpider } from './SmallSpider';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import type { SpiderBroodBounds } from './GrotesqueSpider';
import { TILE_SIZE } from '../core/constants';

const HATCHLING_HP = 10;
const HATCHLING_POUNCE_DAMAGE = 3;
const HATCHLING_XP = 5;
/** Drawn smaller than a printed spiderling, so a fresh hatch reads as young. */
const HATCHLING_DRAW_SCALE = 0.75;
const TILE_CENTRE_FRACTION = 0.5;

/**
 * A spiderling hatched from one of the Grotesque Spider's eggs.
 *
 * Weak but fast: an ignored egg should cost chip damage, not the run. It is
 * born knowing where its prey is — it hunts the nearest conscious crawler in
 * the lab from its first update, with no aggro range and no line of sight — and
 * it never leaves the lab, since the fight it belongs to is locked inside.
 */
export class SpiderHatchling extends SmallSpider {
  override readonly xpValue = HATCHLING_XP;
  protected override coinDropMin = 0;
  protected override coinDropMax = 0;
  override displayName = 'Spider Hatchling';
  override description = 'Fresh out of the egg, and already hungry.';

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    private readonly leash: SpiderBroodBounds,
  ) {
    super(tileX, tileY, tileSize);
    this.setBaseMaxHp(HATCHLING_HP);
    this.hp = this.maxHp;
    // Part of the spider's authored fight: it rolls no tactics and nothing raises it again.
    this.isSummon = true;
    this.isBossAdd = true;
  }

  /** The lab bounds it is held inside, in tiles. */
  get leashBounds(): SpiderBroodBounds {
    return this.leash;
  }

  protected override get pounceDamage(): number {
    return HATCHLING_POUNCE_DAMAGE;
  }

  protected override get drawScale(): number {
    return HATCHLING_DRAW_SCALE;
  }

  /** A brood the spider laid mid-fight is not a loot source to farm. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  protected override acquireTarget(targets: Player[]): Player | null {
    let nearest: Player | null = null;
    let nearestDistance = Infinity;
    for (const target of targets) {
      if (!target.isAlive || target.isKnockedOut) continue;
      if (!this.isInsideLeash(target)) continue;
      const distance = Math.hypot(target.x - this.x, target.y - this.y);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      nearest = target;
    }
    return nearest;
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    this.clampToLeash();
  }

  private isInsideLeash(entity: { readonly x: number; readonly y: number }): boolean {
    const tileX = Math.floor((entity.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE);
    const tileY = Math.floor((entity.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE);
    const { x, y, w, h } = this.leash;
    return tileX >= x && tileX < x + w && tileY >= y && tileY < y + h;
  }

  private clampToLeash(): void {
    const { x, y, w, h } = this.leash;
    const lastTileX = x + w - 1;
    const lastTileY = y + h - 1;
    this.x = Math.min(Math.max(this.x, x * TILE_SIZE), lastTileX * TILE_SIZE);
    this.y = Math.min(Math.max(this.y, y * TILE_SIZE), lastTileY * TILE_SIZE);
  }
}
