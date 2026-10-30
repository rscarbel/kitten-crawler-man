import type { Pt } from '../sprites/art/bipedArt';
import type { CatPlayer } from './CatPlayer';
import type { HumanPlayer } from './HumanPlayer';
import { HumanTalkDriver } from './humanGestures';

/**
 * Keeps whichever crawler the player drives talking, turned toward whoever
 * the conversation is with, for as long as a scene reports a speaker; and
 * back to standing when it stops.
 *
 * The cat's talking is a pose her sprite picks off the clock, so unlike the
 * human's it needs no ticking under a halted world.
 */
export class CrawlerTalkDriver {
  private readonly human = new HumanTalkDriver();

  /**
   * Once per scene update, before its halted-world early return.
   *
   * @param speaker where the one being talked to stands, in world pixels, or
   *   null when no conversation is open.
   * @param worldHalted whether the scene is about to skip its gameplay tick.
   */
  update(human: HumanPlayer, cat: CatPlayer, speaker: Pt | null, worldHalted: boolean): void {
    this.human.update(human, speaker, worldHalted);
    // Walking off is how a street conversation ends, so a step ends her talking.
    if (speaker === null || !cat.isActive || cat.isMoving || cat.isKnockedOut) {
      cat.stopTalking();
      return;
    }
    if (!cat.isTalking) cat.startTalking(speaker);
  }

  /**
   * Ends both crawlers' talking. The players outlive the scene that drives
   * them, so a scene leaving with a conversation open must call this.
   */
  stop(human: HumanPlayer, cat: CatPlayer): void {
    this.human.stop(human);
    cat.stopTalking();
  }
}
