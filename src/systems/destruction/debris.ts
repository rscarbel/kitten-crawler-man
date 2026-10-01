/**
 * The pieces that fly off a struck or breaking prop, drawn by shape: wood
 * splinters spin, clay chips tumble, glass shards glint, paper flutters down,
 * cloth and dust puff where they are, sparks streak and die.
 *
 * Moments, not state: nothing here is checkpointed, and every piece has burnt
 * out a second after it was thrown.
 */

import type { DebrisShape } from './breakMaterials';

export interface DebrisLaunch {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly shape: DebrisShape;
  readonly colour: string;
  /** Length of a splinter or shard, or the diameter of anything rounder, in pixels. */
  readonly size: number;
  readonly life: number;
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  shape: DebrisShape;
  colour: string;
  size: number;
  life: number;
  maxLife: number;
  /** Phase of a fluttering leaf's sway. */
  sway: number;
}

interface ShapeMotion {
  readonly gravity: number;
  readonly drag: number;
  readonly spinMax: number;
}

/**
 * Each shape's fall. Gravity is deliberately light for most: a piece living
 * fifty frames under real gravity would sink three tiles and land well south
 * of the prop it came out of instead of round it.
 */
const SHAPE_MOTION: Readonly<Record<DebrisShape, ShapeMotion>> = {
  splinter: { gravity: 0.03, drag: 0.94, spinMax: 0.3 },
  chip: { gravity: 0.05, drag: 0.92, spinMax: 0.4 },
  shard: { gravity: 0.04, drag: 0.93, spinMax: 0.25 },
  puff: { gravity: -0.01, drag: 0.88, spinMax: 0 },
  flutter: { gravity: 0.015, drag: 0.9, spinMax: 0.12 },
  crumb: { gravity: 0.09, drag: 0.9, spinMax: 0 },
  drop: { gravity: 0.08, drag: 0.9, spinMax: 0 },
  spark: { gravity: 0.02, drag: 0.86, spinMax: 0 },
};

/** Pieces fade over the last third of their life. */
const FADE_SHARE_DIVISOR = 3;
const FADE_SHARE = 1 / FADE_SHARE_DIVISOR;
const SPLINTER_WIDTH_PX = 1.6;
const SHARD_WIDTH_PX = 1.2;
/** A puff swells to this many times its starting size as it fades. */
const PUFF_GROWTH = 1.8;
const PUFF_MAX_ALPHA = 0.45;
/** How far a fluttering leaf swings either side of its fall, in pixels a frame. */
const FLUTTER_SWAY_PX = 0.35;
const FLUTTER_SWAY_RATE = 0.18;
const FLUTTER_ASPECT = 0.7;
/** A spark is drawn as a streak this many frames of its own motion long. */
const SPARK_TRAIL_FRAMES = 2;
const SPARK_WIDTH_PX = 1;
const SHARD_GLINT = 'rgba(255,255,255,0.85)';
const TWO_PI = Math.PI * 2;
const HALF = 0.5;
/**
 * The most pieces alive at once. A blast that breaks a room of props would
 * otherwise throw a few hundred, and none of them is worth a frame.
 */
const MAX_PIECES = 400;

export class Debris {
  private readonly pieces: Piece[] = [];

  /** Throws one piece. */
  launch(launch: DebrisLaunch): void {
    if (this.pieces.length >= MAX_PIECES) return;
    const motion = SHAPE_MOTION[launch.shape];
    this.pieces.push({
      x: launch.x,
      y: launch.y,
      vx: launch.vx,
      vy: launch.vy,
      angle: Math.random() * TWO_PI,
      spin: (Math.random() * 2 - 1) * motion.spinMax,
      shape: launch.shape,
      colour: launch.colour,
      size: launch.size,
      life: launch.life,
      maxLife: launch.life,
      sway: Math.random() * TWO_PI,
    });
  }

  get count(): number {
    return this.pieces.length;
  }

  clear(): void {
    this.pieces.length = 0;
  }

  update(): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      const motion = SHAPE_MOTION[piece.shape];
      piece.x += piece.vx;
      piece.y += piece.vy;
      if (piece.shape === 'flutter') {
        piece.sway += FLUTTER_SWAY_RATE;
        piece.x += Math.sin(piece.sway) * FLUTTER_SWAY_PX;
      }
      piece.vy = (piece.vy + motion.gravity) * motion.drag;
      piece.vx *= motion.drag;
      piece.angle += piece.spin;
      piece.life--;
      if (piece.life <= 0) {
        this.pieces[i] = this.pieces[this.pieces.length - 1];
        this.pieces.pop();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.pieces.length === 0) return;
    // Up to a few hundred pieces a frame: each turned piece sets its transform
    // outright from the base one, rather than paying a save and restore.
    const base = ctx.getTransform();
    const previousAlpha = ctx.globalAlpha;
    for (const piece of this.pieces) {
      const fadeFrames = piece.maxLife * FADE_SHARE;
      const alpha = piece.life < fadeFrames ? piece.life / fadeFrames : 1;
      const sx = piece.x - camX;
      const sy = piece.y - camY;
      ctx.fillStyle = piece.colour;
      ctx.globalAlpha = previousAlpha * alpha;
      switch (piece.shape) {
        case 'puff': {
          const grown = 1 + (1 - piece.life / piece.maxLife) * (PUFF_GROWTH - 1);
          ctx.globalAlpha = previousAlpha * alpha * PUFF_MAX_ALPHA;
          ctx.beginPath();
          ctx.arc(sx, sy, (piece.size * grown) / 2, 0, TWO_PI);
          ctx.fill();
          break;
        }
        case 'spark': {
          ctx.strokeStyle = piece.colour;
          ctx.lineWidth = SPARK_WIDTH_PX;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - piece.vx * SPARK_TRAIL_FRAMES, sy - piece.vy * SPARK_TRAIL_FRAMES);
          ctx.stroke();
          break;
        }
        case 'crumb':
          ctx.fillRect(sx - piece.size / 2, sy - piece.size / 2, piece.size, piece.size);
          break;
        case 'drop':
          ctx.beginPath();
          ctx.arc(sx, sy, piece.size / 2, 0, TWO_PI);
          ctx.fill();
          break;
        case 'splinter':
        case 'chip':
        case 'shard':
        case 'flutter': {
          const cos = Math.cos(piece.angle);
          const sin = Math.sin(piece.angle);
          ctx.setTransform(
            base.a * cos + base.c * sin,
            base.b * cos + base.d * sin,
            base.c * cos - base.a * sin,
            base.d * cos - base.b * sin,
            base.a * sx + base.c * sy + base.e,
            base.b * sx + base.d * sy + base.f,
          );
          drawFlatPiece(ctx, piece);
          ctx.setTransform(base);
        }
      }
    }
    ctx.globalAlpha = previousAlpha;
  }
}

/** A piece drawn in its own rotated frame: splinter, chip, shard or leaf. */
function drawFlatPiece(ctx: CanvasRenderingContext2D, piece: Piece): void {
  const half = piece.size * HALF;
  switch (piece.shape) {
    case 'splinter':
      ctx.fillRect(-half, -SPLINTER_WIDTH_PX / 2, piece.size, SPLINTER_WIDTH_PX);
      return;
    case 'shard':
      ctx.beginPath();
      ctx.moveTo(-half, 0);
      ctx.lineTo(half, -SHARD_WIDTH_PX);
      ctx.lineTo(half * HALF, SHARD_WIDTH_PX);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = SHARD_GLINT;
      ctx.fillRect(half * HALF, -SHARD_WIDTH_PX / 2, 1, 1);
      return;
    case 'flutter': {
      // The sway turns the leaf edge-on and back, which is what reads as paper.
      const width = piece.size * Math.max(FLUTTER_ASPECT * Math.abs(Math.cos(piece.sway)), HALF);
      ctx.fillRect(-width / 2, -half * FLUTTER_ASPECT, width, piece.size * FLUTTER_ASPECT);
      return;
    }
    case 'chip':
    case 'puff':
    case 'crumb':
    case 'drop':
    case 'spark':
      ctx.beginPath();
      ctx.moveTo(-half, -half * HALF);
      ctx.lineTo(half, -half);
      ctx.lineTo(half * HALF, half);
      ctx.closePath();
      ctx.fill();
  }
}
