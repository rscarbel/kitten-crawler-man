import { TILE_SIZE } from '../../core/constants';
import type { Camera } from '../../core/rendering/camera';

/** How much of the tent a frame shows, for {@link isOnScreen}. */
export type TentView = Pick<Camera, 'viewWidth' | 'viewHeight'>;

/**
 * Whether a tile drawn at this position, offset from the camera's top-left, is
 * worth the paint.
 *
 * The maze is 44×88 tiles against a view that shows a small fraction of it,
 * and a lit vent costs a gradient and a dozen bezier fills — so nearly all of
 * that work would be spent on flame nobody can see. `liftTiles` extends the
 * test upward for art that stands taller than its own tile.
 */
export function isOnScreen(view: TentView, x: number, y: number, liftTiles = 0): boolean {
  return (
    x > -TILE_SIZE &&
    y > -TILE_SIZE * (1 + liftTiles) &&
    x < view.viewWidth + TILE_SIZE &&
    y < view.viewHeight + TILE_SIZE
  );
}
