/**
 * Where the AI has pointed the camera, if anywhere. A scene that offers the
 * `spotlight` capability starts it and reads {@link AICameraSpotlight.focus}
 * when it frames the view; the action runtime counts it down every frame.
 */
class AICameraSpotlight {
  private point: { readonly x: number; readonly y: number } | null = null;
  private framesLeft = 0;

  start(point: { readonly x: number; readonly y: number }, frames: number): void {
    this.point = { x: point.x, y: point.y };
    this.framesLeft = Math.max(0, frames);
  }

  /** The world point (pixels) the camera should centre on, or null to follow the crawler. */
  focus(): { readonly x: number; readonly y: number } | null {
    return this.framesLeft > 0 ? this.point : null;
  }

  tick(): void {
    if (this.framesLeft > 0) this.framesLeft--;
    if (this.framesLeft === 0) this.point = null;
  }

  clear(): void {
    this.point = null;
    this.framesLeft = 0;
  }
}

export const aiCameraSpotlight = new AICameraSpotlight();
