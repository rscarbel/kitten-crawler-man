import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawGumGumSprite } from '../sprites/gumGumSprite';

const GUMGUM_HP = 30;
const GUMGUM_SPEED = 0;

/**
 * GumGum — the jittery street elf whose plea opens "The Krasue Murders".
 * A stationary, non-combatant hook NPC: MurderMysteryQuestSystem owns his
 * dialog and removes him once the hook is heard (his corpse prop takes over
 * from there). Non-hostile, so player attacks pass through him.
 */
export class GumGum extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'GumGum';
  description = 'A nervous street elf clutching his coat, watching the crowd for something.';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GUMGUM_HP, GUMGUM_SPEED);
  }

  /** GumGum is a bystander — never hostile, never targetable by player attacks. */
  override get isHostile(): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    this.isMoving = false;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    drawGumGumSprite(
      ctx,
      this.x - camX,
      this.y - camY,
      tileSize,
      this.walkFrame,
      this.isMoving,
      this.facingX,
    );
  }
}
