/**
 * Draws a headless scene's frames until its arrival loading screen has done
 * its work. Every gameplay scene arrives behind one, and ignores every key,
 * touch and update beneath it, so a harness that drives the scene must let it
 * finish first. Yields between frames so the sheet fetches it waits on can
 * resolve.
 */

/** More frames than any environment's arrival screen needs to finish its work. */
export const MAX_ARRIVAL_FRAMES = 6000;

export async function settleArrival(
  scene: { render(ctx: CanvasRenderingContext2D): void; readonly arrivalLoadingOpen: boolean },
  ctx: CanvasRenderingContext2D,
): Promise<boolean> {
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES; frame++) {
    if (!scene.arrivalLoadingOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return !scene.arrivalLoadingOpen;
}
