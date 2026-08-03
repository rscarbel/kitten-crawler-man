/**
 * Timing shared between the life machine's baked art and the runtime that plays
 * it back.
 *
 * The whole point of the machines is that a player can watch one make the
 * spider that then attacks them. That only holds if the spiderling appears on
 * the frame the delivered sac tears open — a spider that walks out of an intact
 * sac, or a sac that splits with nothing in it, breaks the causal read the art
 * was built for.
 *
 * A shared *fraction* is not enough to guarantee that: the generator samples
 * poses at `index / (frameCount - 1)` while the runtime picks a frame with
 * `floor(progress * frameCount)`, and those two quantisations disagree. So what
 * is shared is the resolved **frame index**, which both sides derive from the
 * same function.
 */

/** Where in the dispensing row the delivered sac is meant to tear open. */
const SAC_SPLIT_PROGRESS = 0.65;

/**
 * First frame of the dispensing row on which the sac is drawn torn open.
 *
 * The generator uses it to decide which frames to paint split; the runtime uses
 * it to work out the tick to release the spiderling on. Both read the row's
 * real frame count, so re-baking the row at a different length keeps them
 * together.
 */
export function lifeMachineSacSplitFrame(frameCount: number): number {
  if (frameCount <= 1) return 0;
  const lastFrame = frameCount - 1;
  return Math.min(lastFrame, Math.floor(SAC_SPLIT_PROGRESS * lastFrame) + 1);
}
