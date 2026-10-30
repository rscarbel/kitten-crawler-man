import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { StatusEffect } from '../core/combat/StatusEffect';
import { drawPrisonCellDoor, type CellDoorRun } from '../sprites/art/prisonPropArt';

/**
 * The HP handed to the base class. Never written: the door is damage immune,
 * and `hp` is here only so `isAlive` keeps it in the mob grid, where every
 * weapon's sweep finds it.
 */
const MINIMUM_LIVE_HP = 1;
/** Bolted to its frame. */
const DOOR_SPEED = 0;
const DOOR_HIT_FLASH_FRAMES = 8;

/**
 * A holding cell's flimsy door in the Goblin High Security Prison: any blow
 * from any weapon breaks it.
 *
 * A `Mob` rather than a system-owned prop because that is what puts it in
 * front of every weapon the party has. Each weapon site already filters the
 * mob grid with `takesPlayerDamage`, and this door admits every
 * `PlayerDamageType`, so melee from either crawler, Seismic Stomp, Magic Missile and
 * its splash, a slingshot rock, the Energy Shield and dynamite all land
 * here through the one door the game already has. It is nobody's enemy, so no
 * companion, hireling or homing shot ever picks it.
 *
 * It never dies — death is the kill pipeline, the gore and the loot — it is
 * {@link broken}, and the prison reads the flag. The tile it stands on is
 * blocked while it is whole and opened when it breaks; the prison re-boards
 * it on every capture.
 */
export class PrisonCellDoor extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Cell Door';
  description = 'Three planks and a hope. Any hit breaks it.';

  /** True once a blow has landed. */
  broken = false;
  /** Set on the frame it breaks, with the blow that broke it; the prison reads and clears it. */
  brokenBy: PlayerDamageType | null = null;
  private hitFlash = 0;

  protected override get eyePlacement(): EyePlacement | null {
    return null;
  }

  /**
   * @param run which way the wall the door is set in runs: `across` for a
   *   door in a wall running east–west (the hall to its north or south),
   *   `along` for one in a wall running north–south.
   */
  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    readonly run: CellDoorRun,
  ) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, DOOR_SPEED);
    this.paysNoRewards = true;
    this.cannotBeKilled = true;
    this.immuneToConfusion = true;
  }

  override get isHostile(): boolean {
    return false;
  }

  override get showsOnRadar(): boolean {
    return false;
  }

  override get isPetAttackable(): boolean {
    return false;
  }

  override get countsTowardRoomClear(): boolean {
    return false;
  }

  override canBeConverted(): boolean {
    return false;
  }

  override get blowsEarnNothing(): boolean {
    return true;
  }

  override get acceptsWards(): boolean {
    return false;
  }

  override get separationAnchored(): boolean {
    return true;
  }

  override get displacesPlayers(): boolean {
    return false;
  }

  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  protected override acceptsShove(_x: number, _y: number): boolean {
    return false;
  }

  override applyKnockback(
    _dirX: number,
    _dirY: number,
    _distancePx: number,
    _frames: number,
  ): void {
    // Bolted to its frame: nothing knocks it out of the wall.
  }

  override applyStatus(_effect: StatusEffect): void {
    // A door is not a body that burns, freezes or bleeds.
  }

  protected override get isDamageImmune(): boolean {
    return true;
  }

  protected override admitsPlayerDamage(_damageType: PlayerDamageType | null): boolean {
    return !this.broken;
  }

  /** Anything that reaches it without naming a weapon still breaks it. */
  protected override onDamageBlocked(): void {
    this.breakWith('melee');
  }

  protected override receiveDamage(
    _amount: number,
    _attacker: Player | null,
    damageType: PlayerDamageType | null,
  ): void {
    if (!this.takesPlayerDamage(damageType)) return;
    this.breakWith(damageType ?? 'melee');
  }

  private breakWith(damageType: PlayerDamageType): void {
    if (this.broken) return;
    this.broken = true;
    this.brokenBy = damageType;
    this.hitFlash = DOOR_HIT_FLASH_FRAMES;
  }

  /** Whole again, for the prison to re-block its tile. */
  reboard(): void {
    this.broken = false;
    this.brokenBy = null;
    this.hitFlash = 0;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    if (this.hitFlash > 0) this.hitFlash--;
    this.isMoving = false;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    drawPrisonCellDoor(ctx, this.x - camX, this.y - camY, tileSize, {
      run: this.run,
      broken: this.broken,
      struck: this.hitFlash > 0,
    });
  }
}
