/**
 * The contract for a town fixture drawn in the scene's Y-sorted entity pass.
 * Lives in its own module so `TownPropSystem`, `MarketSystem`, and
 * `RenderPipeline` can all depend on the shape without depending on each other.
 */
export interface TownPropRenderable {
  /** World-pixel top-left, for camera culling and depth sorting. */
  x: number;
  y: number;
  /**
   * How far, in tiles, this prop's art reaches beyond its own anchor — the
   * margin `RenderPipeline` must add before culling it.
   *
   * Omitted means the default margin, which suits anything the size of a market
   * stall. State it for a prop that spans real distance: culling is on the
   * anchor alone, so a 16-tile string of bunting culled at the default 4 tiles
   * vanishes in one frame with twelve of its tiles still on screen. Measured
   * reach, not intended reach — the lamp's flame halo is a `shadowBlur`, which
   * is real ink and is not in anybody's geometry constants.
   */
  cullMarginTiles?: number;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}
