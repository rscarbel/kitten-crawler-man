/**
 * Little emotes that float up off a creature — today the hearts a petted cow
 * gives off, and built so any other "this thing is happy / puzzled / sleepy"
 * burst can reuse it.
 *
 * Each burst is anchored at a world point, spawns its pieces staggered over
 * the first second so they read as a rising stream rather than a single pop,
 * and every piece rises, sways, grows, then fades out over the last part of its
 * life. Drawn procedurally in the effects pass, over every body; each heart is
 * a filled shape with a soft white rim so it reads on grass. The shape is baked
 * once per pixel size into a small off-screen canvas, so a burst costs a few
 * blits a frame rather than a few paths.
 */

import { TILE_SIZE } from '../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/** How long one burst of hearts lasts, from the first heart to the last fading out. */
export const PET_HEARTS_SECONDS = 3;

const HEARTS_MIN = 3;
const HEARTS_MAX = 5;
/** Hearts start over this long, so a burst reads as a stream. */
const HEART_STAGGER_SECONDS = 1;
/** Every heart rises this far, in tiles, over its life. */
const HEART_RISE_MIN_TILES = 0.8;
const HEART_RISE_MAX_TILES = 1.2;
/** Side-to-side sway, in tiles, and its rate in full swings per second. */
const HEART_SWAY_TILES = 0.12;
const HEART_SWAY_HZ = 1.2;
/** How far apart the hearts start, either side of the anchor, in tiles. */
const HEART_SPREAD_TILES = 0.35;
/** A heart grows from this share of its full size to all of it. */
const HEART_START_SCALE = 0.6;
/** The last share of a heart's life it spends fading out. */
const HEART_FADE_SHARE = 0.3;
/** A full-grown heart's width, in tiles. */
const HEART_SIZE_TILES = 0.32;
/** Size steps the baked hearts come in, so growing does not bake a new canvas every frame. */
const HEART_SIZE_STEP_PX = 2;
const HEART_MIN_PX = 4;

const HEART_FILL = '#e8455f';
const HEART_SHINE = 'rgba(255, 214, 222, 0.85)';
const HEART_RIM = 'rgba(255, 255, 255, 0.9)';
/** The white rim's width, as a share of the heart's size. */
const HEART_RIM_SHARE = 0.14;
/** Room round the shape in its baked cell for the rim. */
const HEART_CELL_PAD_PX = 2;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

/**
 * The heart outline in a unit box (0–1 wide, 0–1 tall): two round lobes that
 * meet in a cleft at the top and taper to a point at the bottom.
 */
const LOBE_JOIN_Y = 0.3;
const LOBE_CONTROL_Y = 0.02;
const CLEFT_CONTROL_Y = 0.05;
const FLANK_CONTROL_Y = 0.55;
const POINT_CONTROL_INSET_X = 0.35;
const POINT_CONTROL_Y = 0.75;
const POINT_Y = 0.95;
const SHINE_X = 0.3;
const SHINE_Y = 0.3;
const SHINE_RADIUS = 0.1;

interface EmotePiece {
  readonly delaySeconds: number;
  readonly lifeSeconds: number;
  readonly riseTiles: number;
  readonly offsetTiles: number;
  readonly swayPhase: number;
}

interface EmoteBurst {
  readonly x: number;
  readonly y: number;
  ageSeconds: number;
  readonly pieces: readonly EmotePiece[];
}

function traceHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const px = (u: number): number => x + u * size;
  const py = (v: number): number => y + v * size;
  ctx.beginPath();
  ctx.moveTo(px(HALF), py(LOBE_JOIN_Y));
  ctx.bezierCurveTo(
    px(HALF),
    py(CLEFT_CONTROL_Y),
    px(0),
    py(LOBE_CONTROL_Y),
    px(0),
    py(LOBE_JOIN_Y),
  );
  ctx.bezierCurveTo(
    px(0),
    py(FLANK_CONTROL_Y),
    px(POINT_CONTROL_INSET_X),
    py(POINT_CONTROL_Y),
    px(HALF),
    py(POINT_Y),
  );
  ctx.bezierCurveTo(
    px(1 - POINT_CONTROL_INSET_X),
    py(POINT_CONTROL_Y),
    px(1),
    py(FLANK_CONTROL_Y),
    px(1),
    py(LOBE_JOIN_Y),
  );
  ctx.bezierCurveTo(
    px(1),
    py(LOBE_CONTROL_Y),
    px(HALF),
    py(CLEFT_CONTROL_Y),
    px(HALF),
    py(LOBE_JOIN_Y),
  );
  ctx.closePath();
}

export class EmoteEffectSystem {
  private readonly bursts: EmoteBurst[] = [];
  private readonly heartCells = new Map<number, CanvasSurface>();

  constructor(private readonly random: () => number = Math.random) {}

  /** Floats a burst of hearts up from world pixel (`x`, `y`). */
  spawnHearts(x: number, y: number): void {
    const count = HEARTS_MIN + Math.floor(this.random() * (HEARTS_MAX - HEARTS_MIN + 1));
    const pieces: EmotePiece[] = [];
    for (let i = 0; i < count; i++) {
      const delaySeconds = (i / count) * HEART_STAGGER_SECONDS;
      pieces.push({
        delaySeconds,
        lifeSeconds: PET_HEARTS_SECONDS - delaySeconds,
        riseTiles:
          HEART_RISE_MIN_TILES + this.random() * (HEART_RISE_MAX_TILES - HEART_RISE_MIN_TILES),
        offsetTiles: (this.random() * 2 - 1) * HEART_SPREAD_TILES,
        swayPhase: this.random() * TWO_PI,
      });
    }
    this.bursts.push({ x, y, ageSeconds: 0, pieces });
  }

  /** Whether any burst is still on screen. */
  get isActive(): boolean {
    return this.bursts.length > 0;
  }

  update(dtSeconds: number): void {
    for (const burst of this.bursts) burst.ageSeconds += dtSeconds;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (this.bursts[i].ageSeconds >= PET_HEARTS_SECONDS) this.bursts.splice(i, 1);
    }
  }

  clear(): void {
    this.bursts.length = 0;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const burst of this.bursts) {
      for (const piece of burst.pieces) this.renderHeart(ctx, burst, piece, camX, camY);
    }
  }

  private renderHeart(
    ctx: CanvasRenderingContext2D,
    burst: EmoteBurst,
    piece: EmotePiece,
    camX: number,
    camY: number,
  ): void {
    const lived = burst.ageSeconds - piece.delaySeconds;
    if (lived < 0 || lived >= piece.lifeSeconds) return;
    const t = lived / piece.lifeSeconds;
    const fadeStart = 1 - HEART_FADE_SHARE;
    const alpha = t > fadeStart ? (1 - t) / HEART_FADE_SHARE : 1;
    const scale = HEART_START_SCALE + (1 - HEART_START_SCALE) * Math.min(1, t / fadeStart);
    const sway = Math.sin(lived * HEART_SWAY_HZ * TWO_PI + piece.swayPhase) * HEART_SWAY_TILES;
    const sizePx = this.snappedSize(HEART_SIZE_TILES * TILE_SIZE * scale);
    const cell = this.heartCell(sizePx);
    const centreX = burst.x - camX + (piece.offsetTiles + sway) * TILE_SIZE;
    const centreY = burst.y - camY - t * piece.riseTiles * TILE_SIZE;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(
      cell,
      Math.round(centreX - cell.width / 2),
      Math.round(centreY - cell.height / 2),
    );
    ctx.restore();
  }

  private snappedSize(px: number): number {
    return Math.max(HEART_MIN_PX, Math.round(px / HEART_SIZE_STEP_PX) * HEART_SIZE_STEP_PX);
  }

  private heartCell(sizePx: number): CanvasSurface {
    const cached = this.heartCells.get(sizePx);
    if (cached !== undefined) return cached;
    const rimPx = Math.max(1, sizePx * HEART_RIM_SHARE);
    const side = Math.ceil(sizePx + rimPx * 2 + HEART_CELL_PAD_PX * 2);
    const cell = allocCanvas(side, side);
    const ctx = surfaceContext(cell);
    const origin = (side - sizePx) / 2;
    traceHeart(ctx, origin, origin, sizePx);
    ctx.lineJoin = 'round';
    ctx.lineWidth = rimPx * 2;
    ctx.strokeStyle = HEART_RIM;
    ctx.stroke();
    ctx.fillStyle = HEART_FILL;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      origin + SHINE_X * sizePx,
      origin + SHINE_Y * sizePx,
      Math.max(1, SHINE_RADIUS * sizePx),
      0,
      TWO_PI,
    );
    ctx.fillStyle = HEART_SHINE;
    ctx.fill();
    this.heartCells.set(sizePx, cell);
    return cell;
  }
}
