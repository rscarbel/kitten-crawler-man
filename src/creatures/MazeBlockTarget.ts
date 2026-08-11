import { Mob, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import type { BlockTargetKind } from '../map/bigTopMazeLayout';
import { drawMazeBrace, drawMazeSandbag } from '../sprites/bigTopMazeProps';

/**
 * How much punishment a target takes before it gives.
 *
 * Small on purpose: this is a puzzle step, not a fight. Two or three good hits
 * is long enough for the player to be sure they are hitting the right thing and
 * short enough that nobody starts wondering whether they are.
 */
const TARGET_INTEGRITY = 24;

/**
 * The HP handed to the base class. Never written by anything — but read.
 *
 * A swing is answered by {@link MazeBlockTarget.integrityFraction}; `hp` is here
 * only so that `isAlive` is true, and `isAlive` is what keeps the target in the
 * mob grid and past the `!mob.isAlive` skip at the top of every combat loop. A
 * target that reads as dead is one no weapon can reach, whose barrier never
 * opens, in a finale with no way out but the flap.
 *
 * The amount is irrelevant — `Player.maxHp` floors any value at 1 — which is
 * why it is 1 rather than a number somebody might mistake for a health pool.
 */
const MINIMUM_LIVE_HP = 1;
/** Rooted in place: a counterweight and a brace do not walk. */
const TARGET_SPEED = 0;

const DAMAGE_FLASH_FRAMES = 8;

/**
 * The blows each kind of target answers to.
 *
 * The rule these lists have to satisfy is not "what suits the fiction" but
 * **every damage type the attack key can produce for the crawler who has to
 * break this target**. Only one crawler can reach either kind — the halves are
 * walled apart until the chamber — so a blow that key produces and the target
 * refuses is not a wasted swing, it is the finale sealed shut with no way out
 * but the flap.
 *
 * The human's key is two weapons wearing one button: bare fists swing `melee`,
 * and a wielded slingshot fires `slingshot` instead of swinging at all. The
 * cat's is `missile` while Magic Missile sits in the action bar and `melee`
 * once it is dragged out. Both crawlers can therefore arrive at their own
 * target holding either answer, and the target has to take whichever it is.
 */
const MAZE_TARGET_DAMAGE_TYPES: Readonly<Record<BlockTargetKind, ReadonlyArray<PlayerDamageType>>> =
  {
    sandbag: ['missile', 'melee'],
    brace: ['melee', 'slingshot'],
  };

const DISPLAY_NAME: Readonly<Record<BlockTargetKind, string>> = {
  sandbag: 'Sandbag Counterweight',
  brace: 'Load-Bearing Brace',
};

const DESCRIPTION: Readonly<Record<BlockTargetKind, string>> = {
  sandbag: 'The counterweight holding a gate shut, hung behind a floor-level grate.',
  brace: 'The timber holding a boarded barricade up, driven clean through the wall.',
};

/**
 * One half of a cross-character block: the thing the *other* crawler destroys to
 * open a door barring this one.
 *
 * A `Mob` rather than a system-owned prop because that is what puts it in front
 * of the game's own weapons — the melee sweep and the missile flight both walk
 * the mob grid, and the friendly-fire door (`takesPlayerDamage`) is already the
 * place a target says which blows it will answer.
 *
 * It never dies. Death is the whole downstream pipeline — the kill event, the
 * gore, the loot, the tally — and none of that belongs to a sandbag. Breaking
 * is a flag the maze system reads instead, so the wreck stays standing where it
 * fell and no blood is thrown for a bag of sand.
 */
export class MazeBlockTarget extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;

  /** True once the target has been destroyed. Polled by `BigTopMazeSystem`. */
  broken = false;

  private integrity = TARGET_INTEGRITY;
  private hitFlash = 0;
  private phase = 0;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    readonly kind: BlockTargetKind,
    /** Which way the destructible faces — the side the acting crawler stands on. */
    readonly facing: 'west' | 'east',
  ) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, TARGET_SPEED);
    this.displayName = DISPLAY_NAME[kind];
    this.description = DESCRIPTION[kind];
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
   * Every one of these stands hard against its grate, which in a corridor one
   * tile wide is the doorway the crawler who broke it then has to walk through.
   * Left to displace players it is a wall that outlives its own purpose: the
   * counterweight comes down, the gate opens, and the wreck goes on holding the
   * only way out of that leg.
   */
  override get displacesPlayers(): boolean {
    return false;
  }

  /**
   * The one switch that shuts every door but the swing.
   *
   * `takeDamageFrom` is the only entry point this class overrides, and the base
   * class has two more that never ask `takesPlayerDamage` at all: `takeDamage`,
   * which every status tick and pool of acid arrives through, and `applyStatus`.
   * Left open, one sepsis proc — a flat chance on every landed hit for a crawler
   * wearing the crown — ticks the nominal HP away and *kills* the target at full
   * integrity with `broken` still false. The barrier never opens, the corpse
   * leaves the mob grid, and nothing can ever hit it again: the finale sealed
   * shut with the party inside it.
   *
   * Immunity is safe here precisely because this class's own `takeDamageFrom`
   * does not consult it — a real blow is answered by {@link integrityFraction},
   * and the mob's `hp` is never written by anything.
   */
  protected override get isDamageImmune(): boolean {
    return true;
  }

  override takesPlayerDamage(damageType: PlayerDamageType | null): boolean {
    if (this.broken || damageType === null) return false;
    return MAZE_TARGET_DAMAGE_TYPES[this.kind].includes(damageType);
  }

  override takeDamageFrom(
    amount: number,
    _attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (!this.takesPlayerDamage(damageType)) return;
    this.integrity = Math.max(0, this.integrity - amount);
    this.hitFlash = DAMAGE_FLASH_FRAMES;
    if (this.integrity === 0) this.broken = true;
  }

  /** How much of the target is left, 0..1. Drives its own damage art. */
  get integrityFraction(): number {
    return this.integrity / TARGET_INTEGRITY;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    this.phase++;
    if (this.hitFlash > 0) this.hitFlash--;
    this.isMoving = false;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const state = {
      integrity: this.integrityFraction,
      broken: this.broken,
      struck: this.hitFlash > 0,
      facing: this.facing,
      phase: this.phase,
    };
    if (this.kind === 'sandbag') drawMazeSandbag(ctx, sx, sy, tileSize, state);
    else drawMazeBrace(ctx, sx, sy, tileSize, state);
  }
}
