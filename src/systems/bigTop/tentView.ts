import { TILE_SIZE } from '../../core/constants';
import { viewportHeight, viewportWidth } from '../../core/Viewport';

/**
 * Whether a tile drawn at this screen position is worth the paint.
 *
 * The maze is 44×88 tiles against a viewport that shows a small fraction of it,
 * and a lit vent costs a gradient and a dozen bezier fills — so nearly all of
 * that work would be spent on flame nobody can see. `liftTiles` extends the
 * test upward for art that stands taller than its own tile.
 */
export function isOnScreen(x: number, y: number, liftTiles = 0): boolean {
  return (
    x > -TILE_SIZE &&
    y > -TILE_SIZE * (1 + liftTiles) &&
    x < viewportWidth() + TILE_SIZE &&
    y < viewportHeight() + TILE_SIZE
  );
}
