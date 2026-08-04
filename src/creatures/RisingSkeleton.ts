import type { Player } from '../Player';
import { Mob } from './Mob';
import { SKELETON_RISE_FRAMES } from '../sprites/skeletonTiming';

/**
 * The half of a skeleton warrior that is about climbing out of the ground.
 *
 * Both warrior types are summoned the same way and both play the same `rise`
 * row, but their combat AI has nothing in common — so the emergence lives here
 * and the fighting lives in the subclasses.
 *
 * A rising skeleton is neither a threat nor a target. Left damageable, a summon
 * that lands in front of the party is deleted before its animation finishes: the
 * wave reads as never having arrived, and worse, the cap the lord counts against
 * frees up immediately, so he summons again at once.
 */
export abstract class RisingSkeleton extends Mob {
  private riseTimer = 0;

  /** Starts this skeleton underground. Called by the summon path, not the spawner. */
  beginRising(): void {
    this.riseTimer = SKELETON_RISE_FRAMES;
  }

  /** True while it is still coming out of the ground. */
  get isRising(): boolean {
    return this.riseTimer > 0;
  }

  /** 0 to 1 across the climb, or null once it is out. For the sprite wrapper. */
  protected get riseProgress(): number | null {
    if (this.riseTimer <= 0) return null;
    return 1 - this.riseTimer / SKELETON_RISE_FRAMES;
  }

  /**
   * Advances the climb. Returns true while it is still running, which is the
   * subclass's signal to do nothing else this frame.
   */
  protected tickRise(): boolean {
    if (this.riseTimer <= 0) return false;
    this.riseTimer--;
    this.isMoving = false;
    return true;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.riseTimer = 0;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    if (this.riseTimer > 0) return;
    const previousHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < previousHp) this.damageSoundPending = true;
  }
}
