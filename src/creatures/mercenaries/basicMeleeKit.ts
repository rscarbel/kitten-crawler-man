import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import {
  DEFAULT_ENGAGE_RADIUS_TILES,
  DEFAULT_FOLLOW_BAND,
  DEFAULT_LEASH_RADIUS_TILES,
  DEFAULT_STRIKE_RANGE_TILES,
  NO_PROJECTILES,
  locomotionState,
  type FollowBand,
  type HirelingProjectile,
  type MercenaryDrawState,
  type MercenaryKit,
  type MercenaryKitContext,
} from './MercenaryKit';
import { MercenaryStrike, type StrikeTiming } from './mercenaryStrike';

/** A swing starts from a little past strike range, so a victim stepping back is still swung at. */
const STRIKE_TRIGGER_RANGE_RATIO = 1.2;

export interface BasicMeleeConfig {
  readonly damage: number;
  /**
   * The swings the kit cycles through in order, one per attack — a single
   * punch, or a left and right jab taking turns.
   */
  readonly swings: readonly [StrikeTiming, ...StrikeTiming[]];
  readonly cooldownFrames: number;
  readonly strikeRangeTiles?: number;
  readonly engageRadiusTiles?: number;
  readonly leashRadiusTiles?: number;
  readonly followBand?: FollowBand;
}

/**
 * A hireling that walks up and hits things, one committed swing at a time.
 *
 * The common ground under every kit whose basic attack is a blow: each kit
 * extends this and adds its own specials by overriding the hooks it needs,
 * calling `super` to keep the swing.
 */
export class BasicMeleeKit implements MercenaryKit {
  readonly engageRadiusTiles: number;
  readonly leashRadiusTiles: number;
  readonly strikeRangeTiles: number;
  readonly followBand: FollowBand;

  protected readonly strike = new MercenaryStrike();
  private nextSwing = 0;

  constructor(protected readonly config: BasicMeleeConfig) {
    this.engageRadiusTiles = config.engageRadiusTiles ?? DEFAULT_ENGAGE_RADIUS_TILES;
    this.leashRadiusTiles = config.leashRadiusTiles ?? DEFAULT_LEASH_RADIUS_TILES;
    this.strikeRangeTiles = config.strikeRangeTiles ?? DEFAULT_STRIKE_RANGE_TILES;
    this.followBand = config.followBand ?? DEFAULT_FOLLOW_BAND;
  }

  tick(_ctx: MercenaryKitContext): void {
    // A single swing has no timer of its own beyond the shell's shared cooldown.
  }

  update(ctx: MercenaryKitContext): boolean {
    return this.strike.advance(ctx);
  }

  canStartAttack(ctx: MercenaryKitContext, _target: Mob, distancePx: number): boolean {
    return distancePx <= ctx.merc.strikeRangePx * STRIKE_TRIGGER_RANGE_RATIO;
  }

  startAttack(ctx: MercenaryKitContext, target: Mob, _distancePx: number): void {
    const swings = this.config.swings;
    const swing = swings[this.nextSwing % swings.length];
    this.nextSwing = (this.nextSwing + 1) % swings.length;
    this.strike.begin(target, swing, this.config.damage, ctx.merc);
    ctx.merc.attackCooldown = this.config.cooldownFrames;
  }

  drawState(merc: Mercenary): MercenaryDrawState {
    return this.strike.drawState() ?? locomotionState(merc);
  }

  drainProjectiles(): readonly HirelingProjectile[] {
    return NO_PROJECTILES;
  }

  clearAirborne(): void {
    // A swing has nothing in the air.
  }
}
