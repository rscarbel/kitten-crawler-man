import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import {
  drawGrimaldiVineSprite,
  GRIMALDI_VINE_OVERLAY_CLEARANCE,
} from '../sprites/grimaldiVineSprite';

export const GRIMALDI_VINE_DISPLAY_NAME = 'Grimaldi';

/** How far above his tile his art reaches — anything a system anchors over him needs it. */
export { GRIMALDI_VINE_OVERLAY_CLEARANCE };

/**
 * He can never be hurt, so his health is a formality — but a Mob has to have
 * some, and a bar that reads full is the honest one for a creature whose every
 * wound is refused.
 */
const GRIMALDI_HP = 1;
/** Rooted: he has grown into the big top's floor and does not move, ever. */
const GRIMALDI_SPEED = 0;
const PHASE_SPEED = 1;
/** Frames the refused-blow flare plays, so a swing reads as rejected rather than as missed. */
const HIT_FLASH_FRAMES = 8;

/**
 * Grimaldi — the ringmaster the pestilence turned into an enormous vine wrapped
 * around the big top's centre pole.
 *
 * He is scenery: no AI, no attacks, no movement, and every blow aimed at him is
 * refused. The maze quest drives his poison/sag/cure state, and
 * the only thing he does under his own power is breathe.
 */
export class GrimaldiVine extends Mob {
  /**
   * His foliage clears four tiles of air above his own, so an interaction prompt
   * anchored to the tile would land somewhere inside the mass.
   */
  protected override get statusLabelClearanceTiles(): number {
    return GRIMALDI_VINE_OVERLAY_CLEARANCE;
  }

  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = GRIMALDI_VINE_DISPLAY_NAME;
  description =
    'The ringmaster of the big top. The pestilent vine grew through him until nothing of the man was left to find — only a great strangling plant with his name.';

  /** Driven by BigTopMazeSystem's cure cutscene. */
  poisonAmount = 0;
  sagAmount = 0;
  cureAmount = 0;

  private phase = 0;
  private hitFlashTimer = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GRIMALDI_HP, GRIMALDI_SPEED);
  }

  /** He is the quest's subject, not its enemy — nothing may treat him as a fight. */
  override get isHostile(): boolean {
    return false;
  }

  /**
   * Where the quest planted him is where he is: he cannot walk, so a restore has
   * nothing to rewind, but anchoring him keeps a checkpoint from treating a
   * fixture of the room as something staged after the safe room and deletable.
   */
  override get resetsFullyOnCheckpoint(): boolean {
    return true;
  }

  /**
   * Scenery. Separation shoves a crawler a full tile clear of any
   * mob that displaces them, and a rooted one gives none of it back — so a mass
   * this size wrapped around the tent pole would hold the party at arm's length
   * from the one thing the room is asking them to walk up to and pour a bottle
   * over.
   */
  override get displacesPlayers(): boolean {
    return false;
  }

  protected override get isDamageImmune(): boolean {
    return true;
  }

  /** The whole mass flares white, so a swing reads as refused rather than as a miss. */
  protected override onDamageBlocked(): void {
    this.hitFlashTimer = HIT_FLASH_FRAMES;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.hitFlashTimer = 0;
  }

  updateAI(_targets: Player[]): void {
    this.phase += PHASE_SPEED;
    if (this.hitFlashTimer > 0) this.hitFlashTimer--;
    this.isMoving = false;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    drawGrimaldiVineSprite(ctx, this.x - camX, this.y - camY, tileSize, this.phase, {
      poison: this.poisonAmount,
      sag: this.sagAmount,
      cure: this.cureAmount,
      hitFlash: this.hitFlashTimer > 0,
    });
  }
}
