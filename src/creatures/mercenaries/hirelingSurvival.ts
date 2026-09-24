import { DamageLedger } from '../damageLedger';
import { POTION_HEAL_FRACTION } from '../../Player';
import { REVIVE_FRAMES, REVIVE_HP_FRACTION } from '../../core/reviveRules';

/**
 * How a Meat Shields hireling stays alive between the desk and the end of its
 * contract: a flat resistance, a full heal after a spell out of the fight, a
 * bottomless supply of healing draughts on a cooldown, and a downed state a
 * crawler can revive it from before it bleeds out for good.
 *
 * Plain state and rules, one instance per hireling. `Mercenary` feeds it what
 * happened to the body; `MercenarySystem` asks it what to do each frame and
 * does the parts that need the world — who is standing close, the mob list,
 * the toast strip.
 */

const UPDATE_FRAMES_PER_SECOND = 60;

/**
 * Share of every blow a hireling actually takes. A hire costs real gold and
 * fights for one floor; at full damage the heavier hitters on that floor
 * dropped one in a fight or two, which made the purchase feel like a tip.
 */
export const HIRELING_DAMAGE_TAKEN_MULTIPLIER = 0.5;

const OUT_OF_COMBAT_SECONDS = 15;
/**
 * Frames with no damage taken, no attack started and nothing engaged before a
 * hireling is back to full health. A snap rather than a ramp, so the player can
 * read "they are fine again" from one moment instead of watching a bar.
 */
export const HIRELING_OUT_OF_COMBAT_FRAMES = OUT_OF_COMBAT_SECONDS * UPDATE_FRAMES_PER_SECOND;

/** At or below this share of its health, a hireling reaches for a draught. */
export const HIRELING_POTION_HP_FRACTION = 0.4;

const POTION_COOLDOWN_SECONDS = 15;
/** Frames between two of a hireling's draughts. It carries as many as it likes. */
export const HIRELING_POTION_COOLDOWN_FRAMES = POTION_COOLDOWN_SECONDS * UPDATE_FRAMES_PER_SECOND;

const REVIVE_WINDOW_SECONDS = 15;
/**
 * Frames a downed hireling can wait for a crawler before it dies for good.
 * Counted only while nobody is standing over it, so a revive in progress can
 * never be beaten by the clock.
 */
export const HIRELING_REVIVE_WINDOW_FRAMES = REVIVE_WINDOW_SECONDS * UPDATE_FRAMES_PER_SECOND;

/** How long the heal sparkle plays over a hireling that just drank or recovered. */
export const HIRELING_HEAL_FLASH_FRAMES = 36;

/** What one tick of a standing hireling's recovery came to. */
export type HirelingHeal =
  | { readonly kind: 'recovered'; readonly amount: number }
  | { readonly kind: 'potion'; readonly amount: number };

/** What one tick of a downed hireling came to. */
export type DownedTick = 'waiting' | 'revive_started' | 'reviving' | 'revived' | 'expired';

export class HirelingSurvival {
  private readonly ledger = new DamageLedger(HIRELING_DAMAGE_TAKEN_MULTIPLIER);
  /** Frames since the hireling last took damage, swung, or had a target. */
  framesOutOfCombat = 0;
  /** Frames until the next draught; zero when one is ready. */
  potionCooldownFrames = 0;
  /** Frames left on the heal sparkle. */
  healFlashFrames = 0;

  /** Down and waiting for a revive. */
  downed = false;
  /** Frames since it went down, which paces the fall onto the floor. */
  downedFrames = 0;
  /** Frames of the revive window still unspent. */
  reviveWindowLeft = 0;
  /** Frames a crawler has stood over it without a break, toward {@link REVIVE_FRAMES}. */
  reviveProgress = 0;

  /**
   * The whole hit points a blow of `amount` costs, after the resistance. Any
   * incoming blow at all counts as being in a fight, including one the ledger
   * charges nothing for this time: the clock is about danger, not arithmetic.
   */
  soften(amount: number, mayLandForNothing: boolean): number {
    if (amount > 0) this.noteCombat();
    return this.ledger.charge(amount, mayLandForNothing);
  }

  /** Something happened that means the hireling is fighting. */
  noteCombat(): void {
    this.framesOutOfCombat = 0;
  }

  /**
   * One frame of a standing hireling's upkeep, run once damage for the frame
   * has landed: the clocks advance, then at most one heal. The full recovery
   * is checked first because it heals more, and a draught spent on the same
   * frame would only be wasted.
   *
   * @returns the heal, if there was one, for the caller to show and apply.
   */
  tickStanding(hp: number, maxHp: number): HirelingHeal | null {
    if (this.healFlashFrames > 0) this.healFlashFrames--;
    if (this.potionCooldownFrames > 0) this.potionCooldownFrames--;
    if (this.framesOutOfCombat < HIRELING_OUT_OF_COMBAT_FRAMES) this.framesOutOfCombat++;

    const missing = maxHp - hp;
    if (missing <= 0) return null;

    if (this.framesOutOfCombat >= HIRELING_OUT_OF_COMBAT_FRAMES) {
      this.healFlashFrames = HIRELING_HEAL_FLASH_FRAMES;
      return { kind: 'recovered', amount: missing };
    }

    const lowEnoughToDrink = hp <= maxHp * HIRELING_POTION_HP_FRACTION;
    if (lowEnoughToDrink && this.potionCooldownFrames === 0) {
      this.potionCooldownFrames = HIRELING_POTION_COOLDOWN_FRAMES;
      this.healFlashFrames = HIRELING_HEAL_FLASH_FRAMES;
      const amount = Math.min(missing, Math.round(maxHp * POTION_HEAL_FRACTION));
      return { kind: 'potion', amount };
    }
    return null;
  }

  /** Starts the revive window. */
  goDown(): void {
    this.downed = true;
    this.downedFrames = 0;
    this.reviveWindowLeft = HIRELING_REVIVE_WINDOW_FRAMES;
    this.reviveProgress = 0;
    this.healFlashFrames = 0;
  }

  /**
   * One frame on the floor. A crawler in reach fills the revive and holds the
   * window; nobody in reach empties the revive — the same rule a knocked-out
   * crawler lives by — and spends the window.
   */
  tickDowned(crawlerInReach: boolean): DownedTick {
    this.downedFrames++;
    if (crawlerInReach) {
      const starting = this.reviveProgress === 0;
      this.reviveProgress++;
      if (this.reviveProgress >= REVIVE_FRAMES) return 'revived';
      return starting ? 'revive_started' : 'reviving';
    }
    this.reviveProgress = 0;
    if (this.reviveWindowLeft > 0) this.reviveWindowLeft--;
    return this.reviveWindowLeft === 0 ? 'expired' : 'waiting';
  }

  /**
   * Back on its feet: HP to hand back, and the clocks restarted as though it
   * had just been hit. The draught is left ready: a hireling revived onto a
   * sliver of health that still had to wait out a cooldown would go straight
   * back down to the first blow, and the player would be reviving it on a loop.
   */
  getUp(maxHp: number): number {
    this.downed = false;
    this.downedFrames = 0;
    this.reviveProgress = 0;
    this.reviveWindowLeft = 0;
    this.framesOutOfCombat = 0;
    this.potionCooldownFrames = 0;
    return Math.max(1, Math.ceil(maxHp * REVIVE_HP_FRACTION));
  }

  /** Share of the revive done, 0–1. */
  get reviveFraction(): number {
    return Math.min(1, this.reviveProgress / REVIVE_FRAMES);
  }
}
