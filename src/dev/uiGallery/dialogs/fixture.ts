/**
 * The shape of one dialog-gallery fixture: a named screen mounted over the
 * gallery backdrop with fixture data, plus optional input the render script
 * applies before it captures the PNG.
 */

import type { HitRegion, Surface } from '../../../ui/core/UiRoot';

/** The render script's handle on a fixture's `UiRoot`. */
export interface FixtureRig {
  region(id: string): HitRegion | null;
  /** Like `region`, but a missing region is a broken fixture. */
  need(id: string): HitRegion;
  hover(region: HitRegion): void;
  tap(region: HitRegion): void;
  key(key: string): void;
  /** Advances the clock one frame and renders. */
  frame(): void;
  /** Advances the clock past every tween and renders. */
  settle(): void;
}

export interface DialogFixture {
  /** Unique across all dialog fixtures; becomes the PNG's file name. */
  readonly name: string;
  /**
   * The fixture's surfaces. Each must be open only while `shown()` is true,
   * so a gallery holding every fixture shows one at a time.
   */
  readonly surfaces: (shown: () => boolean) => readonly Surface[];
  /** Input applied after the fixture opens and settles, before the capture. */
  readonly interact?: (rig: FixtureRig) => void;
}
