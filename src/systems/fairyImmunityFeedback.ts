import type { Player } from '../Player';
import type { FairyElement } from '../core/ItemDefs';
import { isImmuneToFairyElement } from '../core/fairyImmunity';

const IMMUNE_TEXT = 'IMMUNE';

/**
 * Frames one body's "IMMUNE" and fizzle stay quiet after showing. A death
 * flame ticks and a fairy room lobs several balls at once, and a label and a
 * fizzle per blocked hit would stack into a column and a buzz.
 */
const IMMUNE_FEEDBACK_THROTTLE_FRAMES = 40;

/**
 * Decides whether a fairy's ice or fire reaches a party member, and when a
 * ring turns it away, says so: an "IMMUNE" over the wearer and a soft fizzle,
 * so the ring is seen to do something. Each fairy system owns one, ticked
 * once a frame from its own update.
 */
export class FairyImmunityFeedback {
  private frame = 0;
  private fizzlePending = false;
  private readonly lastShownFrame = new WeakMap<Player, number>();

  tick(): void {
    this.frame++;
  }

  /** True when `target`'s ring blocks `element` fairy magic; shows the block when it does. */
  blocks(target: Player, element: FairyElement): boolean {
    if (!isImmuneToFairyElement(target, element)) return false;
    const lastShown = this.lastShownFrame.get(target);
    const quiet =
      lastShown !== undefined && this.frame - lastShown < IMMUNE_FEEDBACK_THROTTLE_FRAMES;
    if (!quiet) {
      this.lastShownFrame.set(target, this.frame);
      target.queueFloatingText(IMMUNE_TEXT, 'immune', {
        throttleFrames: IMMUNE_FEEDBACK_THROTTLE_FRAMES,
      });
      this.fizzlePending = true;
    }
    return true;
  }

  /** Whether a block since the last call should fizzle; clears the flag. */
  takeFizzle(): boolean {
    const pending = this.fizzlePending;
    this.fizzlePending = false;
    return pending;
  }

  /** A checkpoint restore must not fizzle for a block from the run that died. */
  reset(): void {
    this.fizzlePending = false;
  }
}
