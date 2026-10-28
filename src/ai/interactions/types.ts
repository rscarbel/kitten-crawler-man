/**
 * What the AI's interaction actions reach through a scene: the stage that puts
 * its questions and challenge offers on screen. A scene offers it through
 * `AISceneContext.getInteractions`; an action whose piece a scene left out
 * reports itself unavailable there.
 */

import type { Rarity } from '../../core/items/defs/rarity';
import type { ChallengeSpec } from './challenges';

/** The most answers a question offers; each is one button. */
export const AI_QUESTION_MAX_CHOICES = 4;

export interface AIQuestionRequest {
  readonly question: string;
  /** Two to {@link AI_QUESTION_MAX_CHOICES} labels, in button order. */
  readonly choices: readonly string[];
  readonly askedBy: string;
}

/** The challenge system as an action sees it. */
export interface AIChallengeHost {
  /** An offer is on the card or a challenge is under way. */
  readonly busy: boolean;
  /** Puts `spec` on the offer card; its id, or null when busy. */
  propose(spec: ChallengeSpec): string | null;
}

export interface AIInteractionHost {
  /** A question is on screen waiting for its answer. */
  questionPending(): boolean;
  /** Shows a question with one button per choice; returns its id at once. The answer arrives as `playerAnswered`. */
  ask(request: AIQuestionRequest): string;
  /** Tells the bus an AI achievement was awarded to `player`. */
  achievementAwarded(award: {
    readonly title: string;
    readonly description: string;
    readonly rarity: Rarity;
    readonly player: 'Human' | 'Cat';
    readonly awardedBy: string;
  }): void;
  /** The scene's challenge system; null where challenges cannot run (indoors). */
  readonly challenges: AIChallengeHost | null;
}
