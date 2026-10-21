import type { ItemId } from '../core/ItemDefs';
import { GoblinBomber, type BomberCloseMove } from './GoblinBomber';

/** The share of a struck crawler's own max HP one black powder blast takes. */
export const GOBLIN_BLACK_POWDER_HP_SHARE = 0.25;

/**
 * The Black Powder Goblin: lights a round iron bomb off its slow-match, holds
 * it high while it locks onto the ground where the target is heading, then
 * lobs it. The bomb bursts the moment it lands, so the circle it draws during
 * the lock is the only warning — once the bomb is in the air nothing marks the
 * ground. A crawler who gets in its face sees it hop back and lock at once.
 * On Kitten it locks onto the feet and never hops (`BOMBER_TUNING`).
 *
 * Staggered or killed mid-aim, it throws nothing: the circle goes, and the
 * bomb it was holding is among the explosives it drops.
 */
export class GoblinBombardier extends GoblinBomber {
  displayName = 'Black Powder Goblin';
  description = 'Locks onto the ground under you, then lobs a bomb that bursts on landing.';
  override readonly audioTag = 'goblin_bombardier';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, 'black_powder');
  }

  override get crawlerHpShare(): number {
    return GOBLIN_BLACK_POWDER_HP_SHARE;
  }

  protected override get closeMove(): BomberCloseMove {
    return 'hop';
  }

  protected override get carriedExplosive(): ItemId {
    return 'black_powder_bomb';
  }

  protected override get aimsBeforeThrowing(): boolean {
    return true;
  }

  protected override get mayStartThrow(): boolean {
    return true;
  }

  protected override get cacklesWhenLighting(): boolean {
    return false;
  }

  protected override get shoutsOn(): 'lockStart' | 'release' {
    return 'lockStart';
  }
}
