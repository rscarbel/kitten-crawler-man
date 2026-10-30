import type { Conversation } from '../dialog/Conversation';
import type { SpeakerId } from '../dialog/speakers';
import type { Pt } from '../sprites/art/catArt';

/** A cat of the cast who speaks her own lines in a conversation, drawn talking while she does. */
export interface SpeakingCat {
  readonly speaker: SpeakerId;
  readonly isTalking: boolean;
  /** Whether she is free to stop and talk: standing still and on her feet. */
  readonly canTalk: boolean;
  /** Talks, turned toward `toward` (world pixels, a tile's top-left), until {@link stopTalking}. */
  startTalking(toward: Pt): void;
  stopTalking(): void;
  /** Queues her talking rows, so her first line is drawn on the frame it comes up. */
  prewarmTalk(): void;
}

/** A speaking cat in the scene, and where whoever she would be talking to stands. */
export interface CatInConversation {
  readonly cat: SpeakingCat;
  readonly listener: Pt | null;
}

/**
 * Keeps each cast cat in a scene talking while the line on screen is hers,
 * turned to her listener, and back to standing otherwise. Called once per
 * scene update, ahead of its halted-world early return: a story box halts
 * the world, and her talking pose is picked off the clock, not her tick.
 */
export class CastCatTalkDriver {
  private readonly warmed = new Set<SpeakingCat>();

  update(
    cats: readonly CatInConversation[],
    conversation: Pick<Conversation, 'isOpen' | 'speaking'>,
  ): void {
    if (!conversation.isOpen) {
      this.warmed.clear();
      for (const { cat } of cats) cat.stopTalking();
      return;
    }
    const speaking = conversation.speaking;
    for (const { cat, listener } of cats) {
      if (!this.warmed.has(cat)) {
        cat.prewarmTalk();
        this.warmed.add(cat);
      }
      const saysThisLine = speaking?.kind === 'cast' && speaking.id === cat.speaker;
      if (!saysThisLine || listener === null || !cat.canTalk) {
        cat.stopTalking();
        continue;
      }
      if (!cat.isTalking) cat.startTalking(listener);
    }
  }
}
