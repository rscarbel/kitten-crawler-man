import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import { firstHealingConsumable } from '../core/items/consumables/foods';
import { crawlerRegenHpPerSecond } from '../core/party/crawlerFormulas';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

/**
 * A companion's unprompted heal: the first potion or stew it carries, through
 * the same `usePotion` refusals a drink by hand gets.
 */
function autoHeal(companion: Player): boolean {
  const heal = firstHealingConsumable(companion.inventory);
  if (heal === null) return false;
  return companion.usePotion(() => companion.inventory.removeOne(heal));
}

/** Frames for auto-potion cooldown (60 fps: 180 = 3 seconds). */
const AUTO_POTION_COOLDOWN_FRAMES = 180;

/** Health threshold for triggering auto-potion (50% HP). */
const AUTO_POTION_HEALTH_THRESHOLD = 0.5;

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
    const next = accumulated + (hpPerSecond / WORLD_TICKS_PER_SECOND) * player.regenMultiplier;
    const heal = Math.floor(next);
    if (heal < 1) return next;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    return next - heal;
  }

  /**
   * Tick health regeneration for both players.
   * Respects each player's `regenMultiplier`, which worn pieces raise.
   */
  tickRegen(human: HumanPlayer, cat: CatPlayer): void {
    this.tickRegenHumanOnly(human);
    this.catRegenAccum = this.accumulateRegen(
      cat,
      crawlerRegenHpPerSecond(cat.health),
      this.catRegenAccum,
    );
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
        if (autoHeal(cat)) this.catAutoPotionCooldown = AUTO_POTION_COOLDOWN_FRAMES;
      }
    } else {
      if (
        human.isAlive &&
        human.hp < human.maxHp * AUTO_POTION_HEALTH_THRESHOLD &&
        this.humanAutoPotionCooldown === 0
      ) {
        if (autoHeal(human)) this.humanAutoPotionCooldown = AUTO_POTION_COOLDOWN_FRAMES;
      }
    }
  }

  /** Regen the human only — used during tutorial phases when cat regen is suppressed. */
  tickRegenHumanOnly(human: HumanPlayer): void {
    this.humanRegenAccum = this.accumulateRegen(
      human,
      crawlerRegenHpPerSecond(human.health),
      this.humanRegenAccum,
    );
  }

  /** Convenience: tick both regen and auto-potion. */
  update(ctx: SystemContext): void {
    this.tickRegen(ctx.human, ctx.cat);
    this.tickAutoPotion(ctx.human, ctx.cat);
  }
}
