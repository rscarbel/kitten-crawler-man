import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';

/**
 * Handles per-frame health regeneration and companion auto-potion logic.
 * Extracted from DungeonScene so it can be shared across scenes (dungeon,
 * building interiors, etc.).
 */
export class PlayerTickSystem {
  private humanRegenAccum = 0;
  private catRegenAccum = 0;
  private readonly HUMAN_REGEN_FRAMES = 10800; // 3 min @ 60fps
  private readonly CAT_REGEN_FRAMES = 14400; // 4 min @ 60fps

  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;

  /**
   * Tick health regeneration for both players.
   * Respects each player's `regenMultiplier` (e.g. Trollskin Shirt = 2.5×).
   */
  tickRegen(human: HumanPlayer, cat: CatPlayer): void {
    if (human.isAlive && human.hp < human.maxHp) {
      this.humanRegenAccum +=
        (human.maxHp / this.HUMAN_REGEN_FRAMES) * human.regenMultiplier;
      const heal = Math.floor(this.humanRegenAccum);
      if (heal >= 1) {
        human.hp = Math.min(human.maxHp, human.hp + heal);
        this.humanRegenAccum -= heal;
      }
    } else {
      this.humanRegenAccum = 0;
    }

    if (cat.isAlive && cat.hp < cat.maxHp) {
      this.catRegenAccum +=
        (cat.maxHp / this.CAT_REGEN_FRAMES) * cat.regenMultiplier;
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
        cat.hp < cat.maxHp * 0.5 &&
        this.catAutoPotionCooldown === 0
      ) {
        if (cat.usePotion()) this.catAutoPotionCooldown = 180;
      }
    } else {
      if (
        human.isAlive &&
        human.hp < human.maxHp * 0.5 &&
        this.humanAutoPotionCooldown === 0
      ) {
        if (human.usePotion()) this.humanAutoPotionCooldown = 180;
      }
    }
  }

  /** Convenience: tick both regen and auto-potion. */
  update(human: HumanPlayer, cat: CatPlayer): void {
    this.tickRegen(human, cat);
    this.tickAutoPotion(human, cat);
  }
}
