/**
 * The HUD's layout for the running game's own screen, for code that needs it
 * outside the HUD's render: the interior camera framing a room clear of the
 * chrome. It resolves the screen exactly as the scene's `UiRoot` does, so
 * both agree.
 */

import { browserViewportInput, resolveViewport } from '../core/viewport';
import { hudLayout, type HudGeometry, type HudLayoutOptions } from './hudLayout';

export interface LiveHudLayout {
  readonly geometry: HudGeometry;
  /** CSS pixels per UI unit. */
  readonly uiScale: number;
}

/** The layout on the live screen for the HUD state in `opts`. */
export function liveHudLayout(
  opts: Pick<HudLayoutOptions, 'miniMapExpanded' | 'build'>,
): LiveHudLayout {
  const viewport = resolveViewport(browserViewportInput());
  return {
    geometry: hudLayout({
      viewport: viewport.safe,
      size: viewport.size,
      density: viewport.density,
      ...opts,
    }),
    uiScale: viewport.uiScale,
  };
}
