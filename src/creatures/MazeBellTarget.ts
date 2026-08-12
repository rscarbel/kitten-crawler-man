import { MazePropTarget } from './MazePropTarget';
import type { Player } from '../Player';
import { BELL_COOLDOWN_FRAMES, BELL_HOLD_FRAMES } from '../map/bigTopMazeLayout';
import { drawMazeShowBell } from '../sprites/bigTopMazeProps';

/**
 * A brass show-bell on its stand.
 *
 * The one target in the tent that is never spent. Ringing it calls the ushers
 * off the floor for {@link BELL_HOLD_FRAMES}, and the stand goes quiet for
 * {@link BELL_COOLDOWN_FRAMES} from the same moment before it will answer
 * again — so a crossing is bought once per ring and the second crawler waits
 * their turn rather than both of them walking through on one pull.
 *
 * The whole clock lives here rather than in the maze system because the bell is
 * also the thing that has to *look* like it: a stand that will not answer is
 * drawn dull, and one holding its lanterns rings with its light on.
 */
export class MazeBellTarget extends MazePropTarget<'show_bell'> {
  /** Frames left of the hold this bell bought. Zero when the ushers are back. */
  private holdFrames = 0;
  /** Frames left before the stand will answer again. */
  private cooldownFrames = 0;
  /** Set on the frame a ring lands, so the maze can play the cue once. */
  rangThisFrame = false;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    readonly bellId: string,
  ) {
    super(
      tileX,
      tileY,
      tileSize,
      'show_bell',
      'Show-Bell',
      'The house bell. The ushers were trained to leave the floor when it rings, and eleven years of being dead has not untrained them.',
    );
  }

  protected override get acceptsBlows(): boolean {
    return this.cooldownFrames === 0;
  }

  protected override onStruck(): void {
    this.holdFrames = BELL_HOLD_FRAMES;
    this.cooldownFrames = BELL_COOLDOWN_FRAMES;
    this.rangThisFrame = true;
  }

  /** True while the lanterns this bell names are off the floor. */
  get isHolding(): boolean {
    return this.holdFrames > 0;
  }

  get isReady(): boolean {
    return this.cooldownFrames === 0;
  }

  /** How much of the hold is left, 0..1, for the dial drawn on the stand. */
  get holdFraction(): number {
    return this.holdFrames / BELL_HOLD_FRAMES;
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    if (this.holdFrames > 0) this.holdFrames--;
    if (this.cooldownFrames > 0) this.cooldownFrames--;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    drawMazeShowBell(ctx, this.x - camX, this.y - camY, tileSize, {
      phase: this.phase,
      struck: this.hitFlash > 0,
      holding: this.isHolding,
      holdFraction: this.holdFraction,
      ready: this.isReady,
      pulsing: this.pulsing,
    });
  }
}
