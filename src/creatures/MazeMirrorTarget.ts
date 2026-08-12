import { MazePropTarget } from './MazePropTarget';
import type { Player } from '../Player';
import type { MazeMirror, MirrorFacing, MirrorKind } from '../map/bigTopMazeLayout';
import { drawMazeMirror } from '../sprites/bigTopMazeProps';

const DISPLAY_NAME: Readonly<Record<MirrorKind, string>> = {
  pivot_mirror: 'Pivot Mirror',
  swivel_mirror: 'Swivel Mirror',
};

const DESCRIPTION: Readonly<Record<MirrorKind, string>> = {
  pivot_mirror: 'A standing mirror on a heavy timber turntable. A good knock moves it a quarter.',
  swivel_mirror: 'A small mirror on a spring mount. It flips between two settings and sticks.',
};

/** Frames the glass rings after it is knocked round, for the art. */
const TURN_FLOURISH_FRAMES = 14;

/**
 * One steerable mirror in the hall.
 *
 * Never spent: a hall of mirrors whose glass could be broken would be a hall
 * the player can lock themselves out of, and the light has to stay steerable
 * for as long as there is a star left to aim at. A blow turns it and nothing
 * else.
 */
export class MazeMirrorTarget extends MazePropTarget<MirrorKind> {
  private facingIndex: number;
  private turnFlourish = 0;

  constructor(
    tileSize: number,
    private readonly definition: MazeMirror,
  ) {
    super(
      definition.tile.x,
      definition.tile.y,
      tileSize,
      definition.kind,
      DISPLAY_NAME[definition.kind],
      DESCRIPTION[definition.kind],
    );
    this.facingIndex = definition.initialIndex;
  }

  get mirrorId(): string {
    return this.definition.id;
  }

  get facing(): MirrorFacing {
    return this.definition.cycle[this.facingIndex];
  }

  /** Set on the frame a blow turns it, so the maze can play the clunk once. */
  turnedThisFrame = false;

  protected override get acceptsBlows(): boolean {
    return true;
  }

  protected override onStruck(): void {
    this.facingIndex = (this.facingIndex + 1) % this.definition.cycle.length;
    this.turnFlourish = TURN_FLOURISH_FRAMES;
    this.turnedThisFrame = true;
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    if (this.turnFlourish > 0) this.turnFlourish--;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    drawMazeMirror(ctx, this.x - camX, this.y - camY, tileSize, {
      kind: this.kind,
      facing: this.facing,
      phase: this.phase,
      struck: this.hitFlash > 0,
      turning: this.turnFlourish > 0,
      pulsing: this.pulsing,
    });
  }
}
