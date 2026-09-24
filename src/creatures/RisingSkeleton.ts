import type { Player } from '../Player';
import { Mob } from './Mob';
import type { PlayerDamageType } from './Mob';
import { SKELETON_RISE_FRAMES } from '../sprites/skeletonTiming';

/** The group every risen skeleton answers to; see {@link Mob.packKind}. */
const SKELETON_PACK_KIND = 'skeleton';

/** A skeleton at its authored HP and bite. */
const FULL_STRENGTH = 1;

/** A lesser skeleton still takes at least one blow to fell. */
const MIN_LESSER_MAX_HP = 1;

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
  protected lesserShare = FULL_STRENGTH;

  /**
   * Makes this a lesser copy of itself: `share` of its authored max HP and of
   * every blow it deals. Call before `applyMobLevel`, which then levels the
   * reduced HP like any other, and never on a live skeleton.
   */
  raiseAsLesser(share: number): void {
    this.lesserShare = share;
    this.setFixedMaxHp(Math.max(MIN_LESSER_MAX_HP, Math.round(this.maxHp * share)));
    this.hp = this.maxHp;
  }

  protected override scaledDamage(baseDamage: number): number {
    return super.scaledDamage(baseDamage) * this.lesserShare;
  }

  /**
   * Starts this skeleton underground. Called by the summon path, not the
   * spawner, and before the summon's traits are rolled: a skeleton a caster
   * raises mid-fight is a summon, and so learns nothing.
   */
  beginRising(): void {
    this.riseTimer = SKELETON_RISE_FRAMES;
    this.isSummon = true;
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
   * Extends {@link Mob.tickTimers} to advance the climb out of the ground.
   *
   * `tickTimers` runs for every active mob every frame regardless of which AI
   * branch `MobUpdateLoop` takes for it — unlike `updateAI`, which a confused or
   * held mob never reaches. A skeleton summoned inside a fog cloud is confused
   * on the very frame it rises, so advancing the climb from `updateAI` left it
   * stuck at its first frame — undamageable and visually still buried — for as
   * long as the fog kept re-confusing it.
   */
  override tickTimers(): void {
    super.tickTimers();
    if (this.riseTimer > 0) {
      this.riseTimer--;
      this.isMoving = false;
    }
  }

  /** True while it is still coming out of the ground, which is the subclass's signal to do nothing else this frame. */
  protected tickRise(): boolean {
    return this.riseTimer > 0;
  }

  /**
   * Sword and bow skeletons are one company. The archer's kite is falling back
   * behind a sword skeleton, and a pack split by class would leave it with no
   * friend to fall back on in the escort it stands in.
   */
  override get packKind(): string {
    return SKELETON_PACK_KIND;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.riseTimer = 0;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const previousHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < previousHp) this.damageSoundPending = true;
  }

  /**
   * Nothing reaches a skeleton still underground — a status tick least of all,
   * since it would otherwise kill one that has not finished arriving.
   */
  protected override get isDamageImmune(): boolean {
    return this.riseTimer > 0;
  }
}
