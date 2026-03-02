import { Player } from '../Player';

/**
 * Abstract base for all enemy mobs. Subclasses define their own AI, appearance,
 * and speed. `updateAI` is called every frame by the game loop.
 */
export abstract class Mob extends Player {
  protected speed: number;
  abstract readonly xpValue: number;

  /** The player this mob is currently chasing/attacking. Set each frame in updateAI. */
  currentTarget: Player | null = null;

  /** Tracks how much damage each player has dealt to this mob (for XP split). */
  readonly damageTakenBy: Map<Player, number> = new Map();

  /** Set to true on the frame this mob's HP reaches 0; game loop reads and resets it. */
  justDied = false;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp: number, speed: number) {
    super(tileX, tileY, tileSize, maxHp);
    this.speed = speed;
  }

  /**
   * Deal damage to this mob and attribute it to an attacker for kill-credit tracking.
   */
  takeDamageFrom(amount: number, attacker: Player | null) {
    const prev = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    const actual = prev - this.hp;
    if (actual > 0 && attacker) {
      this.damageTakenBy.set(attacker, (this.damageTakenBy.get(attacker) ?? 0) + actual);
    }
    if (this.hp === 0 && prev > 0) {
      this.justDied = true;
    }
  }

  abstract updateAI(targets: Player[]): void;
}
