/**
 * The long bloom round a lit tube in the floor intros' ambience: full along
 * the tube and falling away to nothing past its ends and above and below it,
 * with no rim where a gradient stops. Baked once per tint through the shared
 * light maps and stretched to size.
 */

import { alphaMap, drawStretched, easedFalloff } from '../../../sprites/lightMaps';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;
/** A bloom's map: wide along the tube, short across it. */
const BLOOM_MAP = { w: 256, h: 64 } as const;
/** How much of a bloom's length is the bright tube itself, the rest falling away past its ends. */
const BLOOM_CORE_SHARE = 0.55;
/** How tightly the bloom gathers at the tube: higher is a thinner, hotter line. */
const BLOOM_FALLOFF = 4;

/**
 * The bloom round a lit tube `length` long, centred on (`cx`, `cy`): full
 * along the tube and falling away past its ends and `reach` above and below.
 */
export function paintTubeBloom(
  ctx: Ctx,
  cx: number,
  cy: number,
  length: number,
  reach: number,
  tint: string,
  alpha: number,
): void {
  const map = alphaMap('tube-bloom', BLOOM_MAP.w, BLOOM_MAP.h, tint, (u, v) => {
    const pastCore = Math.max(0, Math.abs(u) - BLOOM_CORE_SHARE) / (1 - BLOOM_CORE_SHARE);
    return easedFalloff(Math.sqrt(pastCore * pastCore + v * v), BLOOM_FALLOFF);
  });
  const halfW = (length * HALF) / BLOOM_CORE_SHARE;
  drawStretched(ctx, map, cx, cy, halfW, reach, alpha);
}
