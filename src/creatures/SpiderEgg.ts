import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import { CASTER_HELD_STATUSES, type StatusEffect } from '../core/StatusEffect';
import { drawSpiderEggSprite, type SpiderEggState } from '../sprites/spiderEggSprite';

/**
 * Frames from the tick an egg lands to the tick it hatches. Counted in the mob
 * loop's per-mob timer tick rather than its AI, so a confusing fog cannot stall
 * it, while anything that halts the mob loop still does.
 */
export const EGG_HATCH_FRAMES = 240;
/** Hatchlings that crawl out of one egg left alone. */
export const EGG_HATCHLINGS_PER_EGG = 1;
/** XP for smashing an egg: a nod to the choice, never worth farming. */
export const EGG_DESTROY_XP = 3;
/** Frames the land row plays over the start of the countdown. */
export const EGG_LAND_FRAMES = 12;
/** Frames the burst plays where the egg sat after it hatches. */
export const EGG_HATCH_BURST_FRAMES = 18;
/** Frames the squash plays before its last frame is held as the decal. */
export const EGG_SQUASH_FRAMES = 12;
/** Frames the squashed sac lies on the floor after the egg is destroyed. */
export const EGG_DESTROYED_DECAL_FRAMES = 150;
/** The last stretch of the decal's life, over which it fades out. */
const EGG_DECAL_FADE_FRAMES = 45;

/** An egg is 1 HP only so that it counts as alive; any accepted hit takes all of it. */
const EGG_HP = 1;
const EGG_SPEED = 0;
/**
 * Near-weightless, so separation leaves the spider and her hatchlings where
 * they walk: an egg has no walk speed to give back the shove, and the share of
 * each push it would claim is what turns a rooted body into a wall. Not zero,
 * because two bodies' masses are divided by their sum.
 */
const EGG_MASS = 0.01;

/** Which row an egg is drawn in, and how far through it. */
export interface SpiderEggPose {
  readonly row: SpiderEggState;
  /** 0 to 1 through the row; for `incubate` this is the hatch progress. */
  readonly progress: number;
  readonly alpha: number;
}

type SpiderEggEnd = 'hatched' | 'destroyed';

/**
 * One of the Grotesque Spider's eggs.
 *
 * A mob rather than a system-owned prop because that is what puts it in front
 * of every weapon the party has: the melee sweep, the stone, the missile, the
 * Smush and the companions all walk the mob grid, and the friendly-fire door
 * (`takesPlayerDamage`) is where it says it answers them all.
 *
 * It never acts. Its only clock is the hatch countdown; whoever owns it reads
 * {@link hatchPending} and swaps the egg for hatchlings. Every way an egg ends
 * leaves it dead with a short floor decal, so the kill sweep removes it from the
 * mob grid when the decal runs out.
 */
export class SpiderEgg extends Mob {
  readonly xpValue = EGG_DESTROY_XP;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  override displayName = 'Spider Egg';
  override description = 'A pulsing sac. Smash it before it hatches.';
  override mass = EGG_MASS;

  /** The squashed sac or the burst shell stays on the floor for a moment. */
  override readonly rendersWhenDead = true;

  readonly tileX: number;
  readonly tileY: number;

  private ageFrames = 0;
  private _hatchPending = false;
  private endedAs: SpiderEggEnd | null = null;
  private endFrames = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, EGG_HP, EGG_SPEED);
    this.tileX = tileX;
    this.tileY = tileY;
    // Part of the spider's authored fight, like any boss add, so nothing that
    // raises the dead or rolls a summon's traits touches it.
    this.isSummon = true;
    this.isBossAdd = true;
  }

  /** True from the tick the countdown runs out; the owner then calls {@link hatch}. */
  get hatchPending(): boolean {
    return this._hatchPending;
  }

  /** Frames since the egg landed. */
  get framesSinceLanding(): number {
    return this.ageFrames;
  }

  /** 0 on the landing tick, 1 on the tick it is due to hatch. */
  get hatchProgress(): number {
    return Math.min(1, this.ageFrames / EGG_HATCH_FRAMES);
  }

  /** How the egg ended, or null while it is still on the floor whole. */
  get ending(): SpiderEggEnd | null {
    return this.endedAs;
  }

  /** Flat on the floor: crawlers stamp on it rather than punch it. */
  override get lowProfile(): boolean {
    return true;
  }

  /** The party walks over it; a rooted body that shoves would be a wall. */
  override get displacesPlayers(): boolean {
    return false;
  }

  /** The countdown must run wherever the party stands in the lab. */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  /**
   * Every blow the attack key can produce, for either crawler: fists or a
   * sling for the human, claws or a missile for the cat, plus the area
   * abilities. A status tick carries no damage type and is refused here, but
   * it still reaches the egg's HP through `takeDamage`.
   */
  override takesPlayerDamage(damageType: PlayerDamageType | null): boolean {
    return damageType !== null;
  }

  /** Smashing an egg is not a kill that seeds a floor's swarm. */
  override get seedsOnKillSpawns(): boolean {
    return false;
  }

  /** It never attacks, so a companion waiting to be attacked would leave it to hatch. */
  override get drawsCompanionAggro(): boolean {
    return true;
  }

  /**
   * A fairy's shield on an egg would let a hit the egg answers be swallowed
   * whole, and one hit is the egg's whole promise.
   */
  override get acceptsWards(): boolean {
    return false;
  }

  override applyStatus(effect: StatusEffect): void {
    if (!this.acceptsWards && CASTER_HELD_STATUSES.includes(effect.type)) return;
    super.applyStatus(effect);
  }

  /** Anything that slipped past {@link applyStatus} still soaks nothing. */
  protected override soakWithWards(amount: number): number {
    return amount;
  }

  /** Any accepted hit destroys it, however little damage it carried. */
  override takeDamageFrom(
    _amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (!this.isAlive) return;
    super.takeDamageFrom(this.hp, attacker, damageType);
    const blowLanded = this.hp <= 0;
    if (blowLanded) this.end('destroyed');
  }

  /**
   * Ends the egg as a hatch: no kill event, no XP and no gore, only the burst
   * where it sat. The owner spawns the hatchlings.
   */
  hatch(): void {
    if (!this.isAlive) return;
    this.hp = 0;
    this.end('hatched');
  }

  /**
   * Bursts it with nobody credited: her own slam, a fight called off, her
   * death. Leaves the squashed decal and pays nothing.
   */
  burst(): void {
    if (!this.isAlive) return;
    this.hp = 0;
    this.end('destroyed');
  }

  private end(how: SpiderEggEnd): void {
    this.endedAs = how;
    this.endFrames = 0;
    this._hatchPending = false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    this.isMoving = false;
  }

  override tickTimers(): void {
    super.tickTimers();
    if (!this.isAlive || this._hatchPending) return;
    this.ageFrames++;
    if (this.ageFrames >= EGG_HATCH_FRAMES) this._hatchPending = true;
  }

  override tickCorpse(): void {
    // A status tick can finish it through `takeDamage`, which never reaches the overrides above.
    this.endedAs ??= 'destroyed';
    this.endFrames++;
  }

  override get corpseExpired(): boolean {
    return !this.isAlive && this.endFrames >= this.endDurationFrames();
  }

  private endDurationFrames(): number {
    return this.endedAs === 'hatched' ? EGG_HATCH_BURST_FRAMES : EGG_DESTROYED_DECAL_FRAMES;
  }

  /** The row and progress the art should show this frame. */
  get pose(): SpiderEggPose {
    if (this.isAlive) {
      if (this.ageFrames < EGG_LAND_FRAMES) {
        return { row: 'land', progress: this.ageFrames / EGG_LAND_FRAMES, alpha: 1 };
      }
      return { row: 'incubate', progress: this.hatchProgress, alpha: 1 };
    }
    if (this.endedAs === 'hatched') {
      return {
        row: 'hatch',
        progress: Math.min(1, this.endFrames / EGG_HATCH_BURST_FRAMES),
        alpha: 1,
      };
    }
    const progress = Math.min(1, this.endFrames / EGG_SQUASH_FRAMES);
    const fadeStart = EGG_DESTROYED_DECAL_FRAMES - EGG_DECAL_FADE_FRAMES;
    const alpha =
      this.endFrames <= fadeStart
        ? 1
        : Math.max(0, 1 - (this.endFrames - fadeStart) / EGG_DECAL_FADE_FRAMES);
    return { row: 'destroyed', progress, alpha };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const pose = this.pose;
    if (pose.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= pose.alpha;
    drawSpiderEggSprite(ctx, this.x - camX, this.y - camY, tileSize, pose.row, pose.progress);
    ctx.restore();
  }
}
