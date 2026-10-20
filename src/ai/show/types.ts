/**
 * What the show's AI actions reach through a scene: the stage that puts its
 * questions, sponsor breaks and challenge offers on screen and keeps the
 * viewers' favour. A scene offers it through `AISceneContext.getShow`; an
 * action whose piece a scene left out reports itself unavailable there.
 */

import type { BoxTier } from '../../core/AchievementManager';
import type { ChallengeSpec } from './challenges';

export const VIEWER_REACTIONS = [
  'cheer',
  'laugh',
  'gasp',
  'awe',
  'chant',
  'boo',
  'cringe',
  'yawn',
] as const;
export type ViewerReaction = (typeof VIEWER_REACTIONS)[number];

/** The most answers a question offers; each is one button. */
export const AI_QUESTION_MAX_CHOICES = 4;

export interface AIQuestionRequest {
  readonly question: string;
  /** Two to {@link AI_QUESTION_MAX_CHOICES} labels, in button order. */
  readonly choices: readonly string[];
  readonly askedBy: string;
}

export interface SponsorBreakRequest {
  readonly sponsor: string;
  readonly message: string;
}

export interface ViewerReactionRequest {
  readonly reaction: ViewerReaction;
  readonly delta: number;
  /** What the crowd is saying; may be empty. */
  readonly comment: string;
}

/** The challenge system as an action sees it. */
export interface AIChallengeHost {
  /** An offer is on the card or a challenge is under way. */
  readonly busy: boolean;
  /** Puts `spec` on the offer card; its id, or null when busy. */
  propose(spec: ChallengeSpec): string | null;
}

export interface AIShowHost {
  /** A question is on screen waiting for its answer. */
  questionPending(): boolean;
  /** Shows a question with one button per choice; returns its id at once. The answer arrives as `playerAnswered`. */
  ask(request: AIQuestionRequest): string;
  /** A sponsor break is on screen. */
  sponsorBreakShowing(): boolean;
  runSponsorBreak(request: SponsorBreakRequest): void;
  /** Moves the viewers' favour; returns where it stands and how far it really moved. */
  reactViewers(request: ViewerReactionRequest): { readonly favor: number; readonly moved: number };
  /** Tells the bus an AI achievement was awarded to `player`. */
  achievementAwarded(award: {
    readonly title: string;
    readonly description: string;
    readonly tier: BoxTier;
    readonly player: 'Human' | 'Cat';
    readonly awardedBy: string;
  }): void;
  /** The scene's challenge system; null where challenges cannot run (indoors). */
  readonly challenges: AIChallengeHost | null;
}
