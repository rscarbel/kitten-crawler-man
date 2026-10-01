/**
 * The contract between anything that glows for a moment — a crawler, a spell
 * in flight, a blast — and the dungeon's lighting pass.
 *
 * Each frame the lighting pass asks every registered source to name the
 * lights it is carrying right now. A source keeps no reference to the lighting
 * pass and knows nothing about how a light is drawn.
 */

import type { DynamicLightKind } from './lightKinds';

export interface DynamicLightSink {
  /**
   * Adds one light at world pixel `(x, y)` for this frame. `strength` (0–1)
   * scales how much of the dark it cuts and how bright its glow is; a light
   * dying away passes a falling strength. `reachTiles` overrides the kind's
   * own reach, for a light that grows or shrinks.
   */
  add(x: number, y: number, kind: DynamicLightKind, strength?: number, reachTiles?: number): void;
}

/** Something that may be carrying lights this frame. */
export interface DynamicLightSource {
  collectLights(sink: DynamicLightSink): void;
}
