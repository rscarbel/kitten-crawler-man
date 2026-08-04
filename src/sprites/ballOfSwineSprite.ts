import { drawText } from '../ui/TextBox';
import { getSpriteDef } from '../core/SpriteLoader';
import {
  drawSprite,
  drawSpriteKey,
  progressFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import {
  BOS_BURST_FRAMES,
  BOS_ROLL_FRAMES,
  BOS_SLAM_FRAMES,
  BOS_SPINUP_FRAMES,
  BOS_WALLOW_FRAMES,
} from './ballOfSwineSheet';

/** Which picture of the ball to draw. The fight's own phase maps onto these. */
export type BallOfSwinePose = 'roll' | 'wallow' | 'spinup' | 'slam' | 'burst';

export interface BallOfSwineDraw {
  readonly pose: BallOfSwinePose;
  /**
   * Surface phase in radians — how far the ball has *rolled*, not how long it has
   * existed. Driving the roll off a clock instead makes a stationary ball spin and
   * a fast one crawl.
   */
  readonly rollPhase: number;
  /** Travel heading in radians. The rolling and slamming pictures rotate to it. */
  readonly heading: number;
  /** 0→1 through the current one-shot pose. Ignored by the looping ones. */
  readonly progress: number;
  /** Wallow heave phase in turns, so the loop keeps running while it lies there. */
  readonly wallowPhase: number;
}

/** Frames per one-shot pose, kept beside the pose union so the two cannot drift. */
const ONE_SHOT_FRAMES: Record<'spinup' | 'slam' | 'burst', number> = {
  spinup: BOS_SPINUP_FRAMES,
  slam: BOS_SLAM_FRAMES,
  burst: BOS_BURST_FRAMES,
};

/** Poses the runtime turns to the travel heading rather than drawing upright. */
const ROTATED_POSES: ReadonlySet<BallOfSwinePose> = new Set<BallOfSwinePose>(['roll', 'slam']);

const TILE_CENTER_OFFSET = 0.5;

/**
 * Draws the Ball of Swine.
 *
 * Three layers, in this order and for this reason: the ground shadow, then the
 * body, then the fixed key light. The body is the only layer that turns — the
 * sheet's roll frames are painted with no directional light in them, so that
 * rotating them to a heading streams the surface the right way without carrying a
 * highlight and a shadow around the arena with it.
 *
 * `sx`/`sy` are the ball's *tile top-left* in screen space, as for every other
 * creature. The sheet anchors on the frame centre because that is the rotation
 * pivot, so the half-tile to the middle is added here rather than at every call
 * site.
 */
export function drawBallOfSwineSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  draw: BallOfSwineDraw,
): void {
  const pivotX = sx + ts * TILE_CENTER_OFFSET;
  const pivotY = sy + ts * TILE_CENTER_OFFSET;

  drawSpriteKey(ctx, 'ball_of_swine', 'shadow', 0, pivotX, pivotY, ts);
  drawBody(ctx, pivotX, pivotY, ts, draw);
  drawSpriteKey(ctx, 'ball_of_swine', 'shade', 0, pivotX, pivotY, ts);
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  pivotX: number,
  pivotY: number,
  ts: number,
  draw: BallOfSwineDraw,
): void {
  const frame = frameFor(draw);
  if (!ROTATED_POSES.has(draw.pose)) {
    drawSpriteKey(ctx, 'ball_of_swine', draw.pose, frame, pivotX, pivotY, ts);
    return;
  }

  // The rotated path needs `drawSprite`, because only the low-level entry point
  // takes a rotation, and it takes the sprite and state definitions rather than
  // the key. A missing sheet is a no-op everywhere else in the renderer, so it is
  // one here too rather than a throw at draw time.
  const def = getSpriteDef('ball_of_swine');
  const stateDef = def?.states.get(draw.pose);
  if (def === undefined || stateDef === undefined) return;
  drawSprite(ctx, def, stateDef, frame, pivotX, pivotY, ts, { rotation: draw.heading });
}

function frameFor(draw: BallOfSwineDraw): number {
  switch (draw.pose) {
    case 'roll':
      return walkFrameIndex(draw.rollPhase, BOS_ROLL_FRAMES);
    case 'wallow':
      return walkFrameIndex(draw.wallowPhase * Math.PI * 2, BOS_WALLOW_FRAMES);
    case 'spinup':
    case 'slam':
    case 'burst':
      return progressFrameIndex(draw.progress, ONE_SHOT_FRAMES[draw.pose]);
  }
}

/** Pulses of the vulnerability label across one wallow window. */
const WARNING_PULSES_PER_WINDOW = 9;
const WARNING_PULSE_FLOOR = 0.72;
const WARNING_PULSE_RANGE = 0.28;
const WARNING_TEXT_SIZE_RATIO = 0.32;
/**
 * How far above the anchor it is given the banner sits, in tiles.
 *
 * Small, because the caller passes an anchor already lifted clear of the body — this
 * is only the gap between the top of the ball and the text.
 */
const WARNING_LIFT_RATIO = 0.35;
const WARNING_BAR_WIDTH_RATIO = 1.4;
const WARNING_BAR_HEIGHT = 5;
const WARNING_BAR_GAP = 4;
const WARNING_BAR_ALPHA = 0.7;
const WARNING_BAR_TRACK = '#374151';
const WARNING_BAR_EARLY = '#4ade80';
const WARNING_BAR_LATE = '#f59e0b';
/** Where in the window the bar turns from "hit it" to "get out". */
const WARNING_BAR_URGENT_FRACTION = 0.5;
const WARNING_TEXT_LIFT_RATIO = 0.8;

/**
 * The "VULNERABLE" banner over a wallowing ball, and how long is left of it.
 *
 * `elapsedFraction` is 0 the instant it goes down and 1 as it gets up, so the bar
 * drains — the crawler is reading how much damage window is left, not how long the
 * boss has been down.
 *
 * The pulse is driven off `elapsedFraction` too, not off a clock. A second clock
 * inside a draw call keeps animating while the game is paused, and it would put the
 * banner and the bar directly under it out of step — they are describing the same
 * window, so they should be the same number.
 */
export function drawBallOfSwineStoppedWarning(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  elapsedFraction: number,
): void {
  const cx = sx + ts * TILE_CENTER_OFFSET;
  const topY = sy - ts * WARNING_LIFT_RATIO;
  const pulse =
    WARNING_PULSE_FLOOR +
    WARNING_PULSE_RANGE * Math.sin(elapsedFraction * WARNING_PULSES_PER_WINDOW * Math.PI * 2);
  const fontSize = Math.floor(ts * WARNING_TEXT_SIZE_RATIO);

  ctx.save();
  drawText(ctx, 'VULNERABLE', {
    x: cx,
    y: topY - Math.round(fontSize * WARNING_TEXT_LIFT_RATIO),
    size: fontSize,
    bold: true,
    font: 'monospace',
    color: '#fde68a',
    alpha: pulse,
    align: 'center',
  });

  const barW = ts * WARNING_BAR_WIDTH_RATIO;
  const barX = cx - barW * TILE_CENTER_OFFSET;
  const barY = topY + WARNING_BAR_GAP;
  ctx.globalAlpha = WARNING_BAR_ALPHA;
  ctx.fillStyle = WARNING_BAR_TRACK;
  ctx.fillRect(barX, barY, barW, WARNING_BAR_HEIGHT);
  ctx.fillStyle =
    elapsedFraction < WARNING_BAR_URGENT_FRACTION ? WARNING_BAR_EARLY : WARNING_BAR_LATE;
  ctx.fillRect(barX, barY, barW * (1 - elapsedFraction), WARNING_BAR_HEIGHT);
  ctx.restore();
}

/**
 * One fading smear of the wet track a rolling ball drags around the arena.
 *
 * `age` runs 0→1 as it dries. Drawn beneath the body, so a run of these reads as
 * the line the ball came in on — which is the only cue that says which way a
 * five-tile sphere was heading a second ago.
 */
const TRACK_WIDTH_RATIO = 2.4;
const TRACK_LENGTH_RATIO = 1.2;
const TRACK_ALPHA = 0.3;
const TRACK_COLOR = '#2a1418';

export function drawBallOfSwineTrack(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  heading: number,
  age: number,
): void {
  const fade = 1 - Math.max(0, Math.min(1, age));
  if (fade <= 0) return;
  ctx.save();
  ctx.translate(sx + ts * TILE_CENTER_OFFSET, sy + ts * TILE_CENTER_OFFSET);
  ctx.rotate(heading);
  ctx.globalAlpha = TRACK_ALPHA * fade;
  ctx.fillStyle = TRACK_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    (ts * TRACK_LENGTH_RATIO) / 2,
    (ts * TRACK_WIDTH_RATIO * fade) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

/** A still pose for the boss-intro panel, where nothing is moving yet. */
export function ballOfSwinePortrait(): BallOfSwineDraw {
  return { pose: 'roll', rollPhase: 0, heading: 0, progress: 0, wallowPhase: 0 };
}
