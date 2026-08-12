import { MazePropTarget } from './MazePropTarget';
import type { MazeBlockKind } from '../map/bigTopMazeLayout';
import {
  drawMazeBrace,
  drawMazeCapstan,
  drawMazeReleaseRing,
  drawMazeSandbag,
  type MazeDestructibleArt,
} from '../sprites/bigTopMazeProps';

/**
 * How many landed blows each kind gives way to.
 *
 * Counted in hits rather than in damage on purpose: these are puzzle steps, not
 * fights, and a damage pool means a level-twenty crawler flattens a capstan in
 * one swing while a level-four one needs six.
 *
 * The fire walk's two go on the first blow. That is not a shortcut — it is what
 * they have always done, back when they carried a damage pool a crawler on this
 * floor cleared in one swing, and a counterweight that suddenly wanted three
 * shots is the same door asking three times. A trip is a trip.
 *
 * The capstan is worth more than one because its art has something to say
 * between blows: it turns a visible notch per turn. Nothing takes more than
 * three, because three is how many damage stages the art draws — a fourth blow
 * would land on a prop that looks exactly as it did before, which reads as a
 * whiff.
 */
const HITS_TO_BREAK: Readonly<Record<MazeBlockKind, number>> = {
  sandbag: 1,
  brace: 1,
  release_ring: 1,
  capstan: 3,
};

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
  capstan: 'A brass drum on a timber frame. Three turns and the rope on it lifts a cage gate.',
};

/**
 * Something the tent puts in one lane for the crawler in the *other* one to
 * break.
 *
 * Breaking is a flag the maze system reads rather than a death, so the wreck
 * stays standing where it fell and no blood is thrown for a bag of sand.
 */
export class MazeBlockTarget extends MazePropTarget<MazeBlockKind> {
  /** True once the target has been destroyed. Polled by `BigTopMazeSystem`. */
  broken = false;

  private hitsLeft: number;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    kind: MazeBlockKind,
    /** Which way the destructible faces — the side the acting crawler stands on. */
    readonly facing: 'west' | 'east',
  ) {
    super(tileX, tileY, tileSize, kind, DISPLAY_NAME[kind], DESCRIPTION[kind]);
    this.hitsLeft = HITS_TO_BREAK[kind];
  }

  protected override get acceptsBlows(): boolean {
    return !this.broken;
  }

  protected override onStruck(): void {
    this.hitsLeft = Math.max(0, this.hitsLeft - 1);
    if (this.hitsLeft === 0) this.broken = true;
  }

  /** How much of the target is left, 0..1. Drives its own damage art. */
  get integrityFraction(): number {
    return this.hitsLeft / HITS_TO_BREAK[this.kind];
  }

  private get art(): MazeDestructibleArt {
    return {
      integrity: this.integrityFraction,
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
        drawMazeSandbag(ctx, sx, sy, tileSize, state);
        return;
      case 'brace':
        drawMazeBrace(ctx, sx, sy, tileSize, state);
        return;
      case 'release_ring':
        drawMazeReleaseRing(ctx, sx, sy, tileSize, state);
        return;
      case 'capstan':
        drawMazeCapstan(ctx, sx, sy, tileSize, state);
        return;
    }
  }
}
