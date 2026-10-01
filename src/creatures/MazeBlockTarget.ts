import { MazePropTarget } from './MazePropTarget';
import type { MazeBlockKind } from '../map/bigTopMazeLayout';
import {
  drawGrimaldiSandbag,
  drawStageBrace,
  type MazeDestructibleArt,
} from '../sprites/art/bigTop/fireWalkProps';
import { drawCageReleaseRing, drawCapstanWinch } from '../sprites/art/bigTop/menagerieProps';

const DISPLAY_NAME: Readonly<Record<MazeBlockKind, string>> = {
  sandbag: 'Sandbag Counterweight',
  brace: 'Load-Bearing Brace',
  release_ring: 'Release Ring',
  capstan: 'Cage Capstan',
};

const DESCRIPTION: Readonly<Record<MazeBlockKind, string>> = {
  sandbag: 'The counterweight holding a gate shut, hung behind a floor-level grate.',
  brace: 'The timber holding a boarded barricade up, driven clean through the wall.',
  release_ring: 'The trip ring on a striped sack of ballast. Hit it and the cage gate goes up.',
  capstan: 'A brass drum on a timber frame. One turn and the rope on it lifts a cage gate.',
};

/**
 * Something the tent puts in one lane for the crawler in the *other* one to
 * break.
 *
 * Breaking is a flag the maze system reads rather than a death, so the wreck
 * stays standing where it fell and no blood is thrown for a bag of sand.
 *
 * Every kind gives way to the first blow that lands. These are puzzle steps,
 * not fights: the work is reaching the prop through the other lane's hazards,
 * and a prop that then asks for the same blow again is the same door asking
 * twice.
 */
export class MazeBlockTarget extends MazePropTarget<MazeBlockKind> {
  /** True once the target has been destroyed. Polled by `BigTopMazeSystem`. */
  broken = false;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    kind: MazeBlockKind,
    /** Which way the destructible faces — the side the acting crawler stands on. */
    readonly facing: 'west' | 'east',
  ) {
    super(tileX, tileY, tileSize, kind, DISPLAY_NAME[kind], DESCRIPTION[kind]);
  }

  protected override get acceptsBlows(): boolean {
    return !this.broken;
  }

  protected override onStruck(): void {
    this.broken = true;
  }

  private get art(): MazeDestructibleArt {
    return {
      broken: this.broken,
      struck: this.hitFlash > 0,
      facing: this.facing,
      phase: this.phase,
      pulsing: this.pulsing,
    };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const state = this.art;
    switch (this.kind) {
      case 'sandbag':
        drawGrimaldiSandbag(ctx, sx, sy, tileSize, state);
        return;
      case 'brace':
        drawStageBrace(ctx, sx, sy, tileSize, state);
        return;
      case 'release_ring':
        drawCageReleaseRing(ctx, sx, sy, tileSize, state);
        return;
      case 'capstan':
        drawCapstanWinch(ctx, sx, sy, tileSize, state);
        return;
    }
  }
}
