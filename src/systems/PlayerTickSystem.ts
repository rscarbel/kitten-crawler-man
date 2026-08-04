import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';

const FRAMES_PER_SECOND = 60;

/**
 * Passive regeneration for the human, in HP per second, as a flat base plus an
 * asymptotic constitution term.
 *
 * The old rule was `maxHp / 3600` — a flat *fraction* of max HP, which made
 * absolute regen scale linearly with constitution and let a mid-game crawler
 * out-heal an enemy that never missed. Constitution had no regen term of its
 * own; it only ever had one by accident, through max HP. These decouple the two:
 * a high-CON build still heals fastest, but the gap between CON 6 and CON 12
 * shrinks from 0.20 HP/s to 0.06, leaving max HP and the potion-cooldown
 * reduction as what constitution is actually bought for.
 */
const REGEN_BASE_HP_PER_SECOND = 0.08;
/** The most constitution can add, approached but never reached. */
const REGEN_CON_GAIN_HP_PER_SECOND = 0.35;
/** Constitution at which half of {@link REGEN_CON_GAIN_HP_PER_SECOND} is earned. */
const REGEN_CON_HALF = 10;

/**
 * The cat's flat rate, matching what she healed at before this change.
 *
 * Flat rather than curved because her constitution is locked: a CON term would
 * be a constant dressed up as a formula. Her survivability is dodge and
 * Cockroach, and it should stay that way.
 */
const CAT_REGEN_HP_PER_SECOND = 0.075;

/** Frames for auto-potion cooldown (60 fps: 180 = 3 seconds). */
const AUTO_POTION_COOLDOWN_FRAMES = 180;

/** Health threshold for triggering auto-potion (50% HP). */
const AUTO_POTION_HEALTH_THRESHOLD = 0.5;

/**
 * Passive HP per second for a crawler with this constitution.
 *
 * Exported so `scripts/verify-difficulty.ts` asserts the curve's invariants
 * against the real function rather than against a copy of it.
 */
export function humanRegenHpPerSecond(constitution: number): number {
  return (
    REGEN_BASE_HP_PER_SECOND +
    (REGEN_CON_GAIN_HP_PER_SECOND * constitution) / (constitution + REGEN_CON_HALF)
  );
}

/** The ceiling {@link humanRegenHpPerSecond} approaches but never reaches. */
export const REGEN_HP_PER_SECOND_ASYMPTOTE =
  REGEN_BASE_HP_PER_SECOND + REGEN_CON_GAIN_HP_PER_SECOND;

/**
 * Handles per-frame health regeneration and companion auto-potion logic.
 * Extracted from DungeonScene so it can be shared across scenes (dungeon,
 * building interiors, etc.).
 */
export class PlayerTickSystem implements GameSystem {
  private humanRegenAccum = 0;
  private catRegenAccum = 0;

  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;

  /**
   * Adds one frame of regeneration to a crawler, returning the fractional
   * remainder to carry into the next frame.
   *
   * Regen pauses for a few seconds after the crawler is hurt, which is the
   * single change that turns potions into the in-combat healing resource:
   * out-of-combat recovery is untouched, so nothing here creates downtime
   * between fights. See {@link Player.isRegenSuppressed}.
   */
  private accumulateRegen(player: Player, hpPerSecond: number, accumulated: number): number {
    if (!player.isAlive || player.hp >= player.maxHp) return 0;
    if (player.isRegenSuppressed) return accumulated;
    const next = accumulated + (hpPerSecond / FRAMES_PER_SECOND) * player.regenMultiplier;
    const heal = Math.floor(next);
    if (heal < 1) return next;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    return next - heal;
  }

  /**
   * Tick health regeneration for both players.
   * Respects each player's `regenMultiplier` (e.g. Trollskin Shirt = 2.5×).
   */
  tickRegen(human: HumanPlayer, cat: CatPlayer): void {
    this.tickRegenHumanOnly(human);
    this.catRegenAccum = this.accumulateRegen(cat, CAT_REGEN_HP_PER_SECOND, this.catRegenAccum);
  }

  /**
   * Auto-potion for the inactive companion when below 50% HP.
   * 180-frame cooldown between auto-drinks.
   */
  tickAutoPotion(human: HumanPlayer, cat: CatPlayer): void {
    if (this.humanAutoPotionCooldown > 0) this.humanAutoPotionCooldown--;
    if (this.catAutoPotionCooldown > 0) this.catAutoPotionCooldown--;

    if (human.isActive) {
      if (
        cat.isAlive &&
        cat.hp < cat.maxHp * AUTO_POTION_HEALTH_THRESHOLD &&
        this.catAutoPotionCooldown === 0
      ) {
        if (cat.usePotion()) this.catAutoPotionCooldown = AUTO_POTION_COOLDOWN_FRAMES;
      }
    } else {
      if (
        human.isAlive &&
        human.hp < human.maxHp * AUTO_POTION_HEALTH_THRESHOLD &&
        this.humanAutoPotionCooldown === 0
      ) {
        if (human.usePotion()) this.humanAutoPotionCooldown = AUTO_POTION_COOLDOWN_FRAMES;
      }
    }
  }

  /** Regen the human only — used during tutorial phases when cat regen is suppressed. */
  tickRegenHumanOnly(human: HumanPlayer): void {
    this.humanRegenAccum = this.accumulateRegen(
      human,
      humanRegenHpPerSecond(human.constitution),
      this.humanRegenAccum,
    );
  }

  /** Convenience: tick both regen and auto-potion. */
  update(ctx: SystemContext): void {
    this.tickRegen(ctx.human, ctx.cat);
    this.tickAutoPotion(ctx.human, ctx.cat);
  }
}
