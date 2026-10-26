/**
 * Where a rendered frame's time went, measured in every build.
 *
 * Total frame time alone cannot pick a remedy: cutting painting does nothing
 * for a frame that is slow in `update`, and a lower render scale does nothing
 * for one that is slow baking figures. This splits the frame three ways —
 * update, render, and the cache bakes inside it — cheaply enough to stay on in
 * a release build, so `RenderQualityController` and `?perf` read the same
 * numbers.
 */

import { figureBakeMsThisFrame } from '../../sprites/figure/figureFrameCache';
import { environmentPaintMsThisFrame } from '../../map/environmentArtCache';
import { tileChunkPaintMsTotal } from '../../map/TileRenderer';

export interface FrameCost {
  /** Every fixed-timestep `update` the frame ran. */
  readonly updateMs: number;
  /**
   * The scene's `render` together with the cache work that opens its frame
   * (the figure prewarm and environment paint queues), so every bake the frame
   * makes is inside it.
   */
  readonly renderMs: number;
  /**
   * Figure cell bakes, environment sheet paints and ground chunk bakes, from
   * the start of the frame's cache work to the end of its render. A part of
   * `renderMs`, never added to it.
   */
  readonly bakeMs: number;
}

const NO_FRAME_COST: FrameCost = { updateMs: 0, renderMs: 0, bakeMs: 0 };

let chunkPaintMsAtFrameStart = 0;
let lastCost: FrameCost = NO_FRAME_COST;

/**
 * Opens the bake tally. Called beside the figure and environment caches' own
 * frame starts, so all three bake sources cover the same span.
 */
export function beginFrameCostTally(): void {
  chunkPaintMsAtFrameStart = tileChunkPaintMsTotal();
}

/** Milliseconds of cache baking since {@link beginFrameCostTally}. */
function bakeMsThisFrame(): number {
  const chunkPaintMs = tileChunkPaintMsTotal() - chunkPaintMsAtFrameStart;
  return figureBakeMsThisFrame() + environmentPaintMsThisFrame() + chunkPaintMs;
}

/** Closes the frame, keeping its split for {@link lastFrameCost}. */
export function closeFrameCost(updateMs: number, renderMs: number): void {
  lastCost = { updateMs, renderMs, bakeMs: bakeMsThisFrame() };
}

/** The split of the most recently rendered frame. */
export function lastFrameCost(): FrameCost {
  return lastCost;
}
