import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';

/** Frames for human health regeneration (60 fps: 3600 = 1 min). */
const HUMAN_REGEN_FRAMES = 3600;

/** Frames for cat health regeneration (60 fps: 4800 = 80 seconds). */
const CAT_REGEN_FRAMES = 4800;

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
  private readonly HUMAN_REGEN_FRAMES = HUMAN_REGEN_FRAMES;
  private readonly CAT_REGEN_FRAMES = CAT_REGEN_FRAMES;

  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;

  /**
   * Tick health regeneration for both players.
   * Respects each player's `regenMultiplier` (e.g. Trollskin Shirt = 2.5×).
   */
  tickRegen(human: HumanPlayer, cat: CatPlayer): void {
    if (human.isAlive && human.hp < human.maxHp) {
      this.humanRegenAccum += (human.maxHp / this.HUMAN_REGEN_FRAMES) * human.regenMultiplier;
      const heal = Math.floor(this.humanRegenAccum);
      if (heal >= 1) {
        human.hp = Math.min(human.maxHp, human.hp + heal);
        this.humanRegenAccum -= heal;
      }
    } else {
      this.humanRegenAccum = 0;
    }

    if (cat.isAlive && cat.hp < cat.maxHp) {
      this.catRegenAccum += (cat.maxHp / this.CAT_REGEN_FRAMES) * cat.regenMultiplier;
      const heal = Math.floor(this.catRegenAccum);
      if (heal >= 1) {
        cat.hp = Math.min(cat.maxHp, cat.hp + heal);
        this.catRegenAccum -= heal;
      }
    } else {
      this.catRegenAccum = 0;
    }
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

  /** Convenience: tick both regen and auto-potion. */
  update(ctx: SystemContext): void {
    this.tickRegen(ctx.human, ctx.cat);
    this.tickAutoPotion(ctx.human, ctx.cat);
  }
}
