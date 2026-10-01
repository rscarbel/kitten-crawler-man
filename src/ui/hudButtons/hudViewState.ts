/**
 * The HUD's two view toggles — the minimap expanded, the party panel
 * collapsed — which decide where every button stands. Threaded by reference
 * through a door, into the building and back out, so walking through one
 * never flips either and so never moves a button.
 */
export interface HudViewState {
  miniMapExpanded: boolean;
  hudCollapsed: boolean;
}
