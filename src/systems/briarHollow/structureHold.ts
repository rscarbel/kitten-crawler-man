/**
 * Whether a finger held on the world is a long-press on a structure in the
 * making, and so must not walk the crawler toward it.
 *
 * Decided once, where the finger comes down, in world space: a hold that began
 * on open ground is a walk however many structures slide under the still
 * finger as the camera follows the crawler, and one that began on a structure
 * stays a long-press only while the finger stays put.
 */
export class StructureHold {
  private start: { readonly x: number; readonly y: number } | null = null;

  /**
   * @param onStructure Whether the finger came down on a structure the active
   *   crawler can work on from where they stand.
   * @param screenX The finger, in screen pixels, where it came down.
   */
  begin(onStructure: boolean, screenX: number, screenY: number): void {
    this.start = onStructure ? { x: screenX, y: screenY } : null;
  }

  end(): void {
    this.start = null;
  }

  /** Whether the hold, with the finger now at (screenX, screenY), must not walk the crawler. */
  suppressesWalk(screenX: number, screenY: number, stillWithinPx: number): boolean {
    const start = this.start;
    if (start === null) return false;
    return Math.hypot(screenX - start.x, screenY - start.y) < stillWithinPx;
  }
}
