import { TILE_SIZE } from '../../core/constants';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import {
  advanceScientistPhase,
  drawScientist,
  SCIENTIST_ACTIONS,
  SCIENTIST_FIGURE,
  scientistHeadTop,
  scientistStatesFor,
  type ScientistAction,
} from '../../sprites/art/scientistFigure';
import { FacingState } from '../../sprites/facingView';
import { prewarmFigureState } from '../../sprites/figure/figureFrameCache';

/**
 * How Dr. Moult is drawn: his own figure, in the action the quest sets, and —
 * once her spit has found him — the painted remains she left.
 *
 * The quest decides where he stands and what he is doing; this only turns
 * that into a picture, so the quest's state machine never touches a sprite.
 */
export class LabScientistFigure {
  private readonly facing = new FacingState();
  private action: ScientistAction = 'idle';
  private phase = 0;

  /** The action he is playing now. */
  get currentAction(): ScientistAction {
    return this.action;
  }

  /** Whether a one-shot action (the cower) has played to its last frame. */
  get oneShotFinished(): boolean {
    return this.phase >= 1;
  }

  /**
   * Plays `action` from here on. A change of action starts its row from the
   * top, so a one-shot always plays whole; asking for the action already
   * playing carries on where it is, unless `restart` asks for it again from
   * the top — a second flinch while the first is still held.
   */
  play(action: ScientistAction, options: { readonly restart?: boolean } = {}): void {
    if (action === this.action && options.restart !== true) return;
    this.action = action;
    this.phase = 0;
  }

  /** One tick of the current action, having covered `groundPx` world pixels. */
  tick(groundPx: number): void {
    this.phase = advanceScientistPhase(this.action, this.phase, groundPx);
  }

  /** Turns him to face along (dx, dy); a zero vector keeps his facing. */
  faceToward(dx: number, dy: number): void {
    this.facing.update(dx, dy);
  }

  /** Draws him standing with his feet at (feetX, feetY). */
  render(
    ctx: CanvasRenderingContext2D,
    feetX: number,
    feetY: number,
    camX: number,
    camY: number,
  ): void {
    drawScientist(
      ctx,
      this.action,
      this.facing.current,
      this.phase,
      feetX - TILE_SIZE / 2 - camX,
      feetY - TILE_SIZE - camY,
      TILE_SIZE,
    );
  }

  /** The top of his head on screen, for a marker or a speech bubble above him. */
  headTop(feetY: number, camY: number): number {
    return scientistHeadTop(feetY - TILE_SIZE - camY, TILE_SIZE);
  }

  /** What is left of him, on the tile his feet were on. */
  renderRemains(
    ctx: CanvasRenderingContext2D,
    feetX: number,
    feetY: number,
    camX: number,
    camY: number,
  ): void {
    const tileX = Math.floor(feetX / TILE_SIZE);
    const tileY = Math.floor(feetY / TILE_SIZE);
    drawSpriteKey(
      ctx,
      'spider_lab_remains',
      'idle',
      0,
      tileX * TILE_SIZE - camX,
      tileY * TILE_SIZE - camY,
      TILE_SIZE,
    );
  }
}

/** Bakes every row he can be drawn in, so his first call-out or run never stalls on a bake. */
export function prewarmLabScientist(): void {
  for (const action of SCIENTIST_ACTIONS) {
    for (const state of scientistStatesFor(action)) prewarmFigureState(SCIENTIST_FIGURE, state);
  }
}
