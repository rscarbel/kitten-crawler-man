import { drawSpriteKey, progressFrameIndex } from '../core/SpriteRenderer';
import { getSpriteDefByKey } from '../core/SpriteLoader';

const ROCK_KEY = 'golem_rock' as const;
const BURST_KEY = 'golem_rock_burst' as const;
const SPIN_STATE = 'spin' as const;

/**
 * How much bigger than a tile each sheet is drawn. Both sheets anchor on their
 * own cell centre (see the generator's `effectManifestEntry`), so the caller
 * passes the impact point straight through and does no offset arithmetic of its
 * own — which is where a half-tile shift used to creep in, because half the
 * scaled frame is not half a tile.
 */
const ROCK_DRAW_TILES = 1;
const BURST_DRAW_TILES = 1.6;

function frameCountOf(key: string): number {
  return getSpriteDefByKey(key)?.states.get(SPIN_STATE)?.frameCount ?? 1;
}

const FULL_TURN = Math.PI * 2;

/** The thrown boulder, tumbling. `spin` is its accumulated rotation in radians. */
export function drawGolemRock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  spin: number,
): void {
  const size = tileSize * ROCK_DRAW_TILES;
  const turn = ((spin % FULL_TURN) + FULL_TURN) % FULL_TURN;
  drawSpriteKey(
    ctx,
    ROCK_KEY,
    SPIN_STATE,
    progressFrameIndex(turn / FULL_TURN, frameCountOf(ROCK_KEY)),
    cx,
    cy,
    size,
  );
}

/** The rubble burst where a rock shattered. `progress` runs 0 → 1 across it. */
export function drawGolemRockBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  progress: number,
): void {
  const size = tileSize * BURST_DRAW_TILES;
  drawSpriteKey(
    ctx,
    BURST_KEY,
    SPIN_STATE,
    progressFrameIndex(progress, frameCountOf(BURST_KEY)),
    cx,
    cy,
    size,
  );
}
