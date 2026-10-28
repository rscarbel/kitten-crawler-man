/**
 * Where the AI meets the player on screen, one per gameplay scene: its
 * questions and its challenge offers (through the scene's `AIChallengeSystem`,
 * where it has one). The AI's actions reach it through
 * `AISceneContext.getInteractions`; the scene mounts its surfaces and puts the
 * running challenge's card in its top band.
 *
 * Every outcome the AI should hear about — an answer, an accepted challenge —
 * is emitted on the scene's bus, where the AI's event mapping picks it up.
 */

import type { EventBus } from '../../core/EventBus';
import type { AIChallengeSystem } from '../../systems/AIChallengeSystem';
import { CHALLENGE_WARNING_FRAMES } from '../../systems/AIChallengeSystem';
import type { Surface } from '../../ui/core/UiRoot';
import { aiChallengeBandEntry } from '../../ui/hud/aiChallengeBand';
import type { TopBandEntry } from '../../ui/hud/topBand';
import {
  aiChallengeOfferSurface,
  type AIChallengeOfferSource,
  type AIChallengeOfferView,
} from '../../ui/screens/dialogs/aiChallengeOffer';
import {
  aiQuestionSurface,
  type AIQuestionSource,
  type PendingAIQuestion,
} from '../../ui/screens/dialogs/aiQuestionPrompt';
import { CHALLENGE_TEMPLATES } from './challenges';
import type { AIQuestionRequest, AIInteractionHost } from './types';

export interface AIInteractionStageDeps {
  readonly bus: EventBus;
  /** The scene's challenge system; null where challenges cannot run. */
  readonly challenges: AIChallengeSystem | null;
}

export class AIInteractionStage
  implements AIInteractionHost, AIQuestionSource, AIChallengeOfferSource
{
  private nextQuestionId = 1;
  private question: PendingAIQuestion | null = null;

  constructor(private readonly deps: AIInteractionStageDeps) {}

  get challenges(): AIChallengeSystem | null {
    return this.deps.challenges;
  }

  // ── Questions ─────────────────────────────────────────────────────────────

  get pendingQuestion(): PendingAIQuestion | null {
    return this.question;
  }

  questionPending(): boolean {
    return this.question !== null;
  }

  ask(request: AIQuestionRequest): string {
    const id = `question-${this.nextQuestionId++}`;
    this.question = {
      id,
      question: request.question,
      choices: [...request.choices],
      askedBy: request.askedBy,
    };
    return id;
  }

  answer(index: number): void {
    const pending = this.question;
    if (pending === null) return;
    const outOfRange = index < 0 || index >= pending.choices.length;
    if (outOfRange) return;
    const answer = pending.choices[index];
    this.settleQuestion(pending, answer);
  }

  dismissQuestion(): void {
    const pending = this.question;
    if (pending !== null) this.settleQuestion(pending, null);
  }

  private settleQuestion(pending: PendingAIQuestion, answer: string | null): void {
    this.question = null;
    this.deps.bus.emit('playerAnswered', {
      questionId: pending.id,
      question: pending.question,
      answer,
      choices: [...pending.choices],
      askedBy: pending.askedBy,
    });
  }

  // ── Challenges ────────────────────────────────────────────────────────────

  get challengeOffer(): AIChallengeOfferView | null {
    const offer = this.deps.challenges?.offer ?? null;
    if (offer === null) return null;
    return {
      title: offer.spec.title,
      objective: offer.objective,
      pitch: offer.spec.pitch,
      rewardRarity: offer.spec.rewardRarity,
      offeredBy: offer.spec.offeredBy,
    };
  }

  acceptChallenge(): void {
    this.deps.challenges?.accept();
  }

  declineChallenge(): void {
    this.deps.challenges?.decline();
  }

  achievementAwarded(award: Parameters<AIInteractionHost['achievementAwarded']>[0]): void {
    this.deps.bus.emit('aiAchievementAwarded', { ...award });
  }

  // ── Scene wiring ──────────────────────────────────────────────────────────

  /** Mount once on the scene's `UiRoot`. */
  surfaces(): Surface[] {
    const surfaces = [aiQuestionSurface('ai-question', this)];
    if (this.deps.challenges !== null) {
      surfaces.push(aiChallengeOfferSurface('ai-challenge-offer', this));
    }
    return surfaces;
  }

  /** The running challenge's card, for the scene's top band. */
  topBandEntries(): TopBandEntry[] {
    const current = this.deps.challenges?.current ?? null;
    if (current === null) return [];
    const { rules } = CHALLENGE_TEMPLATES[current.spec.template];
    const clock =
      current.framesLeft === null || current.framesLimit === null
        ? null
        : { framesLeft: current.framesLeft, framesLimit: current.framesLimit };
    return [
      aiChallengeBandEntry({
        title: current.spec.title,
        objective: current.objective,
        progress: rules.countsKills ? `${current.kills}/${current.spec.count}` : null,
        clock,
        urgent: clock !== null && clock.framesLeft <= CHALLENGE_WARNING_FRAMES,
      }),
    ];
  }
}
