/** An axis-aligned rectangle in world pixels. */
export interface WorldRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A stretch of rows of the world, in world pixels: what a fight asks the camera to keep in view. */
export interface WorldRows {
  readonly top: number;
  readonly bottom: number;
}
