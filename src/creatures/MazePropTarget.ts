import { Mob, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { MAZE_TARGET_OWNER, type MazeHalf, type MazeTargetKind } from '../map/bigTopMazeLayout';

/**
 * The HP handed to the base class. Never written by anything — but read.
 *
 * A swing is answered by each subclass's own bookkeeping; `hp` is here only so
 * that `isAlive` is true, and `isAlive` is what keeps the prop in the mob grid
 * and past the `!mob.isAlive` skip at the top of every combat loop. A target
 * that reads as dead is one no weapon can reach, whose barrier never opens, in
 * a finale with no way out but the flap.
 *
 * The amount is irrelevant — `Player.maxHp` floors any value at 1 — which is
 * why it is 1 rather than a number somebody might mistake for a health pool.
 */
const MINIMUM_LIVE_HP = 1;

/** Rooted in place: a counterweight, a bell and a mirror do not walk. */
const PROP_SPEED = 0;

export const PROP_DAMAGE_FLASH_FRAMES = 8;

/**
 * The blows each kind of prop answers to.
 *
 * The rule these lists have to satisfy is not "what suits the fiction" but
 * **every damage type the attack key can produce for the crawler who has to
 * reach this prop**. Only one crawler can reach either lane — they are walled
 * apart until the centre ring — so a blow that key produces and the prop
 * refuses is not a wasted swing, it is the act sealed shut with no way out but
 * the flap.
 *
 * The human's key is two weapons wearing one button: bare fists swing `melee`,
 * and a wielded slingshot fires `slingshot` instead of swinging at all. The
 * cat's is `missile` while Magic Missile sits in the action bar and `melee`
 * once it is dragged out. Both crawlers can therefore arrive at their own prop
 * holding either answer, and the prop has to take whichever it is.
 */
const HUMAN_ATTACK_KEY_TYPES: ReadonlyArray<PlayerDamageType> = ['melee', 'slingshot'];
const CAT_ATTACK_KEY_TYPES: ReadonlyArray<PlayerDamageType> = ['melee', 'missile'];

/**
 * Derived from {@link MAZE_TARGET_OWNER} rather than restated beside it, because
 * two tables that must agree with nothing enforcing it is exactly how a prop
 * ends up refusing the one blow its owner can land.
 */
function attackKeyTypesOf(owner: MazeHalf): ReadonlyArray<PlayerDamageType> {
  return owner === 'human' ? HUMAN_ATTACK_KEY_TYPES : CAT_ATTACK_KEY_TYPES;
}

export const MAZE_TARGET_DAMAGE_TYPES: Readonly<
  Record<MazeTargetKind, ReadonlyArray<PlayerDamageType>>
> = {
  sandbag: attackKeyTypesOf(MAZE_TARGET_OWNER.sandbag),
  brace: attackKeyTypesOf(MAZE_TARGET_OWNER.brace),
  release_ring: attackKeyTypesOf(MAZE_TARGET_OWNER.release_ring),
  capstan: attackKeyTypesOf(MAZE_TARGET_OWNER.capstan),
  show_bell: attackKeyTypesOf(MAZE_TARGET_OWNER.show_bell),
  pivot_mirror: attackKeyTypesOf(MAZE_TARGET_OWNER.pivot_mirror),
  swivel_mirror: attackKeyTypesOf(MAZE_TARGET_OWNER.swivel_mirror),
};

/**
 * Frames a prop ignores further blows after one lands.
 *
 * Magic Missile above level ten bursts into three to six sub-missiles *at the
 * impact point*, every one of which arrives inside the same prop's hit radius
 * within a frame or two. Without a lockout that is one trigger pull turning a
 * two-facing swivel mirror four times — back to where it started, half the
 * time — and flattening a three-hit sandbag before it has shown a single
 * damage stage.
 *
 * Shorter than the 18-frame swing animation that gates both crawlers' melee and
 * than the sling's 45, so it never eats a swing. It *is* the limit on Magic
 * Missile from level twelve up, where the spell's own cooldown reaches twelve
 * frames and then zero — which is the intent rather than a cost: nothing in the
 * tent is timed on damage per second, and a mirror that could be spun five
 * times a second by holding the key would be unsteerable.
 */
const BLOW_LOCKOUT_FRAMES = 12;

/**
 * Everything in the tent that exists to be hit, and nothing else.
 *
 * A `Mob` rather than a system-owned prop because that is what puts it in front
 * of the game's own weapons — the melee sweep and the missile flight both walk
 * the mob grid, and the friendly-fire door (`takesPlayerDamage`) is already the
 * place a target says which blows it will answer.
 *
 * None of them ever dies. Death is the whole downstream pipeline — the kill
 * event, the gore, the loot, the tally — and none of that belongs to a bag of
 * sand or a pane of glass. What a blow means instead is each subclass's own
 * business, and the maze system reads it as a flag.
 */
export abstract class MazePropTarget<K extends MazeTargetKind = MazeTargetKind> extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;

  protected hitFlash = 0;
  protected phase = 0;
  private blowLockout = 0;

  /**
   * Set on the frame a blow this prop does not answer to lands on it.
   *
   * The centre ring is the one room both crawlers share, so it is the one place
   * a player can aim the wrong weapon at a prop that is not theirs. Refused
   * silently, the shot passes clean through with no flash and no sound, which
   * reads as the game having dropped the input. The maze polls this and says so.
   */
  refusedBlowThisFrame = false;

  /** True while this is the thing the act is currently asking for. Drives the pulse. */
  pulsing = false;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    readonly kind: K,
    displayName: string,
    description: string,
  ) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, PROP_SPEED);
    this.displayName = displayName;
    this.description = description;
  }

  override get isHostile(): boolean {
    return false;
  }

  /** Nothing hunts it and nothing rewinds it: the maze is rebuilt whole on every entry. */
  override get isPetAttackable(): boolean {
    return false;
  }

  /**
   * Scenery, not a body — and the maze depends on it.
   *
   * Several of these stand hard against a grate, which in a corridor one tile
   * wide is the doorway the crawler who broke it then has to walk through. Left
   * to displace players it is a wall that outlives its own purpose: the
   * counterweight comes down, the gate opens, and the wreck goes on holding the
   * only way out of that leg.
   */
  override get displacesPlayers(): boolean {
    return false;
  }

  /**
   * The one switch that shuts every door but the swing.
   *
   * `takeDamageFrom` is the only entry point these classes override, and the
   * base class has two more that never ask `takesPlayerDamage` at all:
   * `takeDamage`, which every status tick and pool of acid arrives through, and
   * `applyStatus`. Left open, one sepsis proc — a flat chance on every landed
   * hit for a crawler wearing the crown — ticks the nominal HP away and *kills*
   * the prop with its own bookkeeping untouched. The barrier never opens, the
   * corpse leaves the mob grid, and nothing can ever hit it again: the act
   * sealed shut with the party inside it.
   *
   * Immunity is safe here precisely because the subclasses' own
   * `takeDamageFrom` does not consult it — a real blow is answered by their own
   * state, and the mob's `hp` is never written by anything.
   */
  protected override get isDamageImmune(): boolean {
    return true;
  }

  /** Whether this prop still answers a blow at all. */
  protected abstract get acceptsBlows(): boolean;

  override takesPlayerDamage(damageType: PlayerDamageType | null): boolean {
    if (!this.acceptsBlows || this.blowLockout > 0 || damageType === null) return false;
    return MAZE_TARGET_DAMAGE_TYPES[this.kind].includes(damageType);
  }

  /**
   * The clocks a prop owns are its own, and they may not stop when the party
   * walks out of range: a bell left mid-hold beyond the AI activation radius
   * would hold its lanterns off the floor forever, disarming a crossing the act
   * is built around.
   */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  /** What a landed blow means. Called only for blows this prop accepts. */
  protected abstract onStruck(): void;

  override takeDamageFrom(
    _amount: number,
    _attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (!this.takesPlayerDamage(damageType)) {
      const wrongWeapon =
        damageType !== null &&
        this.acceptsBlows &&
        this.blowLockout === 0 &&
        !MAZE_TARGET_DAMAGE_TYPES[this.kind].includes(damageType);
      if (wrongWeapon) this.refusedBlowThisFrame = true;
      return;
    }
    this.hitFlash = PROP_DAMAGE_FLASH_FRAMES;
    this.blowLockout = BLOW_LOCKOUT_FRAMES;
    this.onStruck();
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    this.phase++;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.blowLockout > 0) this.blowLockout--;
    this.isMoving = false;
  }
}
