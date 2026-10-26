import type { ItemId } from '../core/items/defs/ItemDefs';
import { GoblinBomber, type BomberCloseMove } from './GoblinBomber';

/** The share of a struck crawler's own max HP one goblin stick's blast takes. */
export const GOBLIN_DYNAMITE_HP_SHARE = 0.25;

/**
 * How many of its own sticks a Dynamite Goblin lets burn on the floor at once.
 * At the cap it waits for one to go off: a goblin that could carpet a room in
 * fuses would turn every circle into a maze rather than a warning.
 */
export const DYNAMITER_MAX_LIVE_STICKS = 2;

/**
 * The Dynamite Goblin: lights a stick off the candle on its helmet and lobs it
 * a little ahead of where the target is heading. The stick lands, burns, and
 * the red circle on the floor fills as the fuse runs down — the whole warning
 * is on the ground, so the throw itself is quick. A crawler who gets in its
 * face gets a lit stick dropped between them while the goblin scurries clear.
 * On Kitten it throws at the feet and has no dropped stick (`BOMBER_TUNING`).
 */
export class GoblinDynamiter extends GoblinBomber {
  displayName = 'Dynamite Goblin';
  description = 'Lobs lit sticks of dynamite. Watch the floor, not the goblin.';
  override readonly audioTag = 'goblin_dynamiter';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, 'dynamite');
  }

  override get crawlerHpShare(): number {
    return GOBLIN_DYNAMITE_HP_SHARE;
  }

  protected override get closeMove(): BomberCloseMove {
    return 'drop';
  }

  protected override get carriedExplosive(): ItemId {
    return 'goblin_dynamite';
  }

  protected override get aimsBeforeThrowing(): boolean {
    return false;
  }

  protected override get mayStartThrow(): boolean {
    return this.liveSticks < DYNAMITER_MAX_LIVE_STICKS;
  }

  protected override get cacklesWhenLighting(): boolean {
    return true;
  }

  protected override get shoutsOn(): 'lockStart' | 'release' {
    return 'release';
  }
}
