/**
 * The selection ring on the floor under the crawler the player is driving,
 * the cue party games (Baldur's Gate, Divinity, Pillars of Eternity, Diablo)
 * use for "this one is you". It lies flat on the ground in the 3/4 view, so it
 * is an ellipse squashed by {@link RING_FORESHORTENING}, and it is drawn under
 * the body so the figure stands inside it.
 *
 * Four brighter brackets turn slowly round the ring and the glow breathes, so
 * it reads as live selection rather than a floor decal, but slowly enough not
 * to compete with the fight around it.
 */

import { worldPalette } from '../theme/worldInk';

export interface ActiveCrawlerRingPose {
  /** Centre of the ring on the floor, in the caller's space. */
  readonly x: number;
  readonly y: number;
  /** Half the ring's width; its height follows from the view's foreshortening. */
  readonly radiusX: number;
  /** A running clock in milliseconds, for the brackets' turn and the glow's breath. */
  readonly timeMs: number;
}

/** Half the ring's width, in tiles of the figure it lies under. */
export const ACTIVE_RING_RADIUS_TILES = 0.42;

/** A floor circle seen in the game's 3/4 view: this much as tall as it is wide. */
const RING_FORESHORTENING = 0.42;
const UNDERLAY_WIDTH_PX = 3.5;
const GLOW_WIDTH_PX = 2.5;
const CORE_WIDTH_PX = 1;
const BRACKET_WIDTH_PX = 2.25;
const BRACKET_COUNT = 4;
/** Each bracket's share of its quarter of the ring. */
const BRACKET_SHARE = 0.42;
const FULL_TURN = Math.PI * 2;
const BRACKET_SPAN = (FULL_TURN / BRACKET_COUNT) * BRACKET_SHARE;
/** One turn of the brackets: slow enough to sit still in the corner of the eye. */
const BRACKET_TURN_PERIOD_MS = 7000;
const GLOW_BREATH_PERIOD_MS = 1800;
const GLOW_ALPHA_MIN = 0.45;
const GLOW_ALPHA_MAX = 0.8;
/** The thin ring under the brackets stays a touch soft, so the turning brackets are what the eye catches. */
const CORE_ALPHA = 0.7;
const HALF = 0.5;

function strokeRing(
  ctx: CanvasRenderingContext2D,
  pose: ActiveCrawlerRingPose,
  radiusY: number,
  start: number,
  end: number,
): void {
  ctx.beginPath();
  ctx.ellipse(pose.x, pose.y, pose.radiusX, radiusY, 0, start, end);
  ctx.stroke();
}

/** Paints the active crawler's selection ring flat on the floor at (`x`, `y`). */
export function drawActiveCrawlerRing(
  ctx: CanvasRenderingContext2D,
  pose: ActiveCrawlerRingPose,
): void {
  const palette = worldPalette.activeCrawler;
  const radiusY = pose.radiusX * RING_FORESHORTENING;
  const breath = HALF + HALF * Math.sin((pose.timeMs / GLOW_BREATH_PERIOD_MS) * FULL_TURN);
  const glowAlpha = GLOW_ALPHA_MIN + (GLOW_ALPHA_MAX - GLOW_ALPHA_MIN) * breath;
  const turn = ((pose.timeMs % BRACKET_TURN_PERIOD_MS) / BRACKET_TURN_PERIOD_MS) * FULL_TURN;

  ctx.save();
  ctx.lineCap = 'round';

  ctx.strokeStyle = palette.underlay;
  ctx.lineWidth = UNDERLAY_WIDTH_PX;
  strokeRing(ctx, pose, radiusY, 0, FULL_TURN);

  ctx.globalAlpha = glowAlpha;
  ctx.strokeStyle = palette.glow;
  ctx.lineWidth = GLOW_WIDTH_PX;
  strokeRing(ctx, pose, radiusY, 0, FULL_TURN);

  ctx.globalAlpha = CORE_ALPHA;
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = CORE_WIDTH_PX;
  strokeRing(ctx, pose, radiusY, 0, FULL_TURN);

  ctx.globalAlpha = 1;
  ctx.lineWidth = BRACKET_WIDTH_PX;
  for (let bracket = 0; bracket < BRACKET_COUNT; bracket++) {
    const start = turn + (bracket / BRACKET_COUNT) * FULL_TURN;
    strokeRing(ctx, pose, radiusY, start, start + BRACKET_SPAN);
  }
  ctx.restore();
}
