/**
 * The wash over the floor a watcher is looking at: a guard's flashlight, a
 * warden's stare, a keeper's look. Warm while nobody is in it, amber as the
 * watcher's suspicion rises, and ringed by a bright rim so its edge reads on a
 * lit floor as clearly as a prison spotlight's. Drawn in the caller's camera-relative pixels,
 * under the figures.
 */

import { rgbInkAt, rgbInkMix, worldPalette } from '../theme/worldInk';

interface FanPoint {
  readonly x: number;
  readonly y: number;
}

/** The far edge of a look: a plain arc, or the ends of rays a sight test already cast. */
type SightFanRim =
  | {
      readonly kind: 'arc';
      readonly facingRad: number;
      readonly halfAngleRad: number;
      readonly reachPx: number;
    }
  | { readonly kind: 'rays'; readonly ends: ReadonlyArray<FanPoint> };

interface SightFanOptions {
  /** The watcher's eye, where the fan narrows to a point. */
  readonly origin: FanPoint;
  readonly rim: SightFanRim;
  /** How far the watcher has noticed someone, 0 to 1. */
  readonly suspicion: number;
}

/** Straight segments an arc rim is drawn with: enough that its curve never shows a corner. */
const ARC_RIM_SEGMENTS = 12;
const RIM_WIDTH_PX = 2;
const CATCHING_RIM_WIDTH_PX = 2.5;

function traceRim(ctx: CanvasRenderingContext2D, origin: FanPoint, rim: SightFanRim): void {
  switch (rim.kind) {
    case 'arc': {
      const sweepRad = 2 * rim.halfAngleRad;
      for (let segment = 0; segment <= ARC_RIM_SEGMENTS; segment++) {
        const angle = rim.facingRad - rim.halfAngleRad + (sweepRad * segment) / ARC_RIM_SEGMENTS;
        ctx.lineTo(
          origin.x + Math.cos(angle) * rim.reachPx,
          origin.y + Math.sin(angle) * rim.reachPx,
        );
      }
      return;
    }
    case 'rays':
      for (const end of rim.ends) ctx.lineTo(end.x, end.y);
      return;
    default: {
      const unhandled: never = rim;
      return unhandled;
    }
  }
}

export function drawSightFan(ctx: CanvasRenderingContext2D, options: SightFanOptions): void {
  const ink = worldPalette.prison;
  const share = Math.min(1, Math.max(0, options.suspicion));
  const isCatching = share > 0;
  const washRgb = rgbInkMix(ink.lightWarmRgb, ink.lightCatchingRgb, share);
  const washAlpha = ink.sightWashAlpha + (ink.sightWashCaughtAlpha - ink.sightWashAlpha) * share;
  const rimRgb = rgbInkMix(ink.spotRimRgb, ink.lightCatchingRgb, share);
  const rimAlpha = isCatching
    ? ink.sightRimCatchingMinAlpha + (1 - ink.sightRimCatchingMinAlpha) * share
    : ink.sightRimAlpha;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(options.origin.x, options.origin.y);
  traceRim(ctx, options.origin, options.rim);
  ctx.closePath();
  ctx.fillStyle = rgbInkAt(washRgb, washAlpha);
  ctx.fill();
  ctx.strokeStyle = rgbInkAt(rimRgb, rimAlpha);
  ctx.lineWidth = isCatching ? CATCHING_RIM_WIDTH_PX : RIM_WIDTH_PX;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
