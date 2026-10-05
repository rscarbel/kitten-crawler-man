/**
 * Localhost-only review route for the UI widget set, reached via `?ui` in
 * `devBootScene`. Shows the same gallery surfaces `npm run render:ui-gallery`
 * captures, live and interactive, through a real `UiRoot`: the top bar
 * switches sheets, cycles the UI size and flips between pointer and touch
 * density. `SceneManager` routes pointer and keys to the scene's `ui` and
 * disposes it on exit.
 */

import { Scene } from '../core/Scene';
import type { UiSize } from '../core/Settings';
import { GalleryModel } from '../dev/uiGallery/model';
import { createUiGallery, type GalleryChromeHost } from '../dev/uiGallery/screens';
import { UiRoot } from '../ui/core/UiRoot';
import { browserViewportInput, detectDensity } from '../ui/core/viewport';
import type { Density } from '../ui/theme/tokens';

const UI_SIZE_ORDER: readonly UiSize[] = ['small', 'medium', 'large'];

const UI_SIZE_LABELS: Readonly<Record<UiSize, string>> = {
  small: 'Size: S',
  medium: 'Size: M',
  large: 'Size: L',
};

const DENSITY_LABELS: Readonly<Record<Density, string>> = {
  pointer: 'Pointer',
  touch: 'Touch',
};

export class UiGalleryScene extends Scene implements GalleryChromeHost {
  private uiSize: UiSize = 'medium';
  private density: Density = detectDensity();
  readonly ui: UiRoot;

  constructor() {
    super();
    this.ui = new UiRoot({
      audio: null,
      viewport: () => ({ ...browserViewportInput(), uiSize: this.uiSize, density: this.density }),
    });
    for (const surface of createUiGallery(new GalleryModel(), this).surfaces)
      this.ui.mount(surface);
  }

  get uiSizeLabel(): string {
    return UI_SIZE_LABELS[this.uiSize];
  }

  cycleUiSize(): void {
    const index = UI_SIZE_ORDER.indexOf(this.uiSize);
    this.uiSize = UI_SIZE_ORDER[(index + 1) % UI_SIZE_ORDER.length];
  }

  get densityLabel(): string {
    return DENSITY_LABELS[this.density];
  }

  toggleDensity(): void {
    this.density = this.density === 'pointer' ? 'touch' : 'pointer';
  }

  update(): void {
    // Nothing simulates here; every change comes from input through the surfaces.
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.ui.frame(ctx);
  }
}
