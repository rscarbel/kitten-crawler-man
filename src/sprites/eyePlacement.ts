/**
 * Where a creature's eyes sit, for the eye-shine the dungeon's dark shows of
 * it: one of two shapes, after how its art turns to face its way.
 *
 * Lives beside the art rather than the creature so a painter can derive it
 * from the same rig constants it paints the head from.
 */
export type EyePlacement = ViewedEyePlacement | RotatingEyePlacement;

/**
 * Art drawn in views — a profile, a face-on view and a back — picked by
 * whichever axis the creature faces hardest along. In tiles from the tile's
 * top-left; negative heights are above the tile, where most standing art
 * carries its head. Facing away it shows none.
 */
export interface ViewedEyePlacement {
  /** Side view: how far ahead of the tile's centre the eyes are, toward the way it faces. */
  readonly sideForward: number;
  /** Side view: how far down from the top of the tile. */
  readonly sideHeight: number;
  /** Side view: the gap between the two eyes; small, the far eye is half hidden. */
  readonly sideSpacing: number;
  /**
   * Whether the face-on drawing is mirrored when it faces left of straight
   * down. True for art drawn only in profile, which keeps showing that profile
   * facing the camera and flips with it; false for a face-on view the painter
   * never flips, where the eyes stay put however far left or right it leans.
   */
  readonly frontMirrors: boolean;
  /**
   * Facing the camera: how far right of the tile's centre the eyes are, as the
   * face-on drawing is painted unmirrored; with {@link frontMirrors} it is
   * carried to the left when the drawing is.
   */
  readonly frontAcross: number;
  /** Facing the camera: how far down from the top of the tile. */
  readonly frontHeight: number;
  /** Facing the camera: the gap between the two eyes. */
  readonly frontSpacing: number;
}

/**
 * Art seen from above and turned to face its way, so its head is always on
 * show and follows the facing round. The eyes are a point in the art's own
 * unturned frame, turned by the very function its painter turns it with.
 */
export interface RotatingEyePlacement {
  /** The point the art turns about, in tiles from the tile's top-left. */
  readonly pivotX: number;
  readonly pivotY: number;
  /** The eyes in the art's own unturned frame, in tiles from the pivot. */
  readonly headX: number;
  readonly headY: number;
  /** The gap between the two eyes. */
  readonly spacing: number;
  /** The angle, in radians, the painter turns the art by for a facing. */
  readonly rotation: (facingX: number, facingY: number) => number;
}
