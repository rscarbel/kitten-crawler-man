/**
 * The contract for a town fixture drawn in the scene's Y-sorted entity pass.
 * Lives in its own module so `TownPropSystem`, `MarketSystem`, and
 * `RenderPipeline` can all depend on the shape without depending on each other.
 */
export interface TownPropRenderable {
  /** World-pixel top-left, for camera culling and depth sorting. */
  x: number;
  y: number;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}
