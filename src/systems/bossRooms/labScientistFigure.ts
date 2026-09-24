import { TILE_SIZE } from '../../core/constants';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import { scaleHumanoidBox } from '../../sprites/humanoidScale';
import { IDLE_CYCLES_PER_FRAME, walkCycleDistance } from '../../sprites/person/gait';
import { labScientistAppearance } from '../../sprites/person/labScientist';
import { drawPersonCached } from '../../sprites/person/personFrameCache';
import type { Facing } from '../../sprites/person/skeleton';

/**
 * How the lab's scientist is drawn: a procedural person in a lab coat, walked
 * by the ground he covers, and — once her spit has found him — the painted
 * remains she left.
 *
 * The quest decides where he stands and what he is doing; this only turns
 * that into a picture, so the quest's state machine never touches a sprite.
 */
export class LabScientistFigure {
  private facing: Facing = 'down';
  private phase = 0;
  private moving = false;
  private readonly cycleDistance = walkCycleDistance(
    labScientistAppearance(),
    scaleHumanoidBox(0, 0, TILE_SIZE).s,
  );

  /** One tick of him walking (dx, dy) pixels, or standing when both are zero. */
  walk(dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    this.moving = distance > 0;
    if (this.moving) {
      this.facing = facingOf(dx, dy);
      this.phase = (this.phase + distance / this.cycleDistance) % 1;
      return;
    }
    this.phase = (this.phase + IDLE_CYCLES_PER_FRAME) % 1;
  }

  /** Turns him to face a point, as he does whoever he is talking to. */
  faceToward(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.facing = facingOf(dx, dy);
  }

  /** Draws him standing with his feet at (feetX, feetY). */
  render(
    ctx: CanvasRenderingContext2D,
    feetX: number,
    feetY: number,
    camX: number,
    camY: number,
  ): void {
    const box = scaleHumanoidBox(feetX - TILE_SIZE / 2 - camX, feetY - TILE_SIZE - camY, TILE_SIZE);
    drawPersonCached(
      ctx,
      box.sx,
      box.sy,
      box.s,
      labScientistAppearance(),
      this.phase,
      this.facing,
      this.moving,
    );
  }

  /** The top of his head on screen, for a marker or a speech bubble above him. */
  headTop(feetY: number, camY: number): number {
    return scaleHumanoidBox(0, feetY - TILE_SIZE - camY, TILE_SIZE).sy;
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

function facingOf(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
