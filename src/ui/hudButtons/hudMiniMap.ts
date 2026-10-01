/**
 * The minimap's square in the top-right corner, shared by every scene so that
 * walking through a door never resizes it — and never moves the buttons hung
 * underneath it.
 */

export const HUD_MINIMAP_NORMAL_SIZE = 160;
export const HUD_MINIMAP_EXPANDED_SIZE = 240;
/** Clear space between the minimap and the screen's top and right edges. */
export const HUD_MINIMAP_MARGIN = 8;

export interface HudMiniMapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function hudMiniMapSize(expanded: boolean): number {
  return expanded ? HUD_MINIMAP_EXPANDED_SIZE : HUD_MINIMAP_NORMAL_SIZE;
}

/** The minimap's square on a `viewportWidth`-wide screen, caption not included. */
export function hudMiniMapRect(viewportWidth: number, expanded: boolean): HudMiniMapRect {
  const size = hudMiniMapSize(expanded);
  return {
    x: viewportWidth - size - HUD_MINIMAP_MARGIN,
    y: HUD_MINIMAP_MARGIN,
    w: size,
    h: size,
  };
}
