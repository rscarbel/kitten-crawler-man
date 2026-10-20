/**
 * Where the show's AI appears on screen, one per gameplay scene: its
 * questions, its sponsor breaks, its challenge offers (through the scene's
 * `AIChallengeSystem`, where it has one) and the viewers' favour. The AI's
 * actions reach it through `AISceneContext.getShow`; the scene mounts its
 * surfaces and puts its HUD pieces in the `HudModel`.
 *
 * Every outcome the AI should hear about — an answer, a skipped advert, a
 * swing of the crowd — is emitted on the scene's bus, where the AI's event
 * mapping picks it up.
 */

import type { EventBus } from '../../core/EventBus';
import { FAVOR_MAX, favorPerk, favorTier, type ViewerFavor } from '../../core/viewerFavor';
import type { AIChallengeSystem } from '../../systems/AIChallengeSystem';
import { CHALLENGE_WARNING_FRAMES } from '../../systems/AIChallengeSystem';
import type { Surface } from '../../ui/core/UiRoot';
import { aiChallengeBandEntry } from '../../ui/hud/aiChallengeBand';
import type { TopBandEntry } from '../../ui/hud/topBand';
import type { ToastOptions } from '../../ui/hud/toasts';
import type { ViewerFavorModel } from '../../ui/hud/viewerFavorPill';
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
import {
  sponsorBreakSurface,
  type SponsorBreakSource,
  type SponsorBreakView,
} from '../../ui/screens/dialogs/sponsorBreak';
import { CHALLENGE_TEMPLATES } from './challenges';
import type {
  AIQuestionRequest,
  AIShowHost,
  SponsorBreakRequest,
  ViewerReactionRequest,
} from './types';

export interface AIShowStageDeps {
  readonly bus: EventBus;
  readonly favor: ViewerFavor;
  /** The scene's challenge system; null where challenges cannot run. */
  readonly challenges: AIChallengeSystem | null;
  postToast(text: string, opts?: ToastOptions): void;
}

const REACTION_WORDS: Readonly<Record<ViewerReactionRequest['reaction'], string>> = {
  cheer: 'cheer',
  laugh: 'laugh',
  gasp: 'gasp',
  awe: 'go quiet in awe',
  chant: 'chant',
  boo: 'boo',
  cringe: 'cringe',
  yawn: 'yawn',
};

export class AIShowStage
  implements AIShowHost, AIQuestionSource, SponsorBreakSource, AIChallengeOfferSource
{
  private nextQuestionId = 1;
  private question: PendingAIQuestion | null = null;
  private advert: SponsorBreakView | null = null;

  constructor(private readonly deps: AIShowStageDeps) {
    deps.favor.clearSwing();
  }

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

  // ── Sponsor breaks ────────────────────────────────────────────────────────

  get sponsorBreak(): SponsorBreakView | null {
    return this.advert;
  }

  sponsorBreakShowing(): boolean {
    return this.advert !== null;
  }

  runSponsorBreak(request: SponsorBreakRequest): void {
    this.advert = { sponsor: request.sponsor, message: request.message };
  }

  endSponsorBreak(skipped: boolean): void {
    const shown = this.advert;
    if (shown === null) return;
    this.advert = null;
    this.deps.bus.emit('sponsorBreakEnded', { sponsor: shown.sponsor, skipped });
  }

  // ── Challenges ────────────────────────────────────────────────────────────

  get challengeOffer(): AIChallengeOfferView | null {
    const offer = this.deps.challenges?.offer ?? null;
    if (offer === null) return null;
    return {
      title: offer.spec.title,
      objective: offer.objective,
      pitch: offer.spec.pitch,
      rewardTier: offer.spec.rewardTier,
      offeredBy: offer.spec.offeredBy,
    };
  }

  acceptChallenge(): void {
    this.deps.challenges?.accept();
  }

  declineChallenge(): void {
    this.deps.challenges?.decline();
  }

  // ── Viewers ───────────────────────────────────────────────────────────────

  reactViewers(request: ViewerReactionRequest): { readonly favor: number; readonly moved: number } {
    const { favor } = this.deps;
    const moved = favor.adjust(request.delta, request.reaction);
    const tier = favorTier(favor.value);
    this.deps.bus.emit('viewerFavorChanged', {
      favor: favor.value,
      delta: moved,
      reaction: request.reaction,
      comment: request.comment,
      tier,
    });
    const crowd = `The viewers ${REACTION_WORDS[request.reaction]}!`;
    const said = request.comment === '' ? crowd : `${crowd} “${request.comment}”`;
    this.deps.postToast(said, {
      tone: moved < 0 ? 'warning' : 'info',
      icon: 'users',
    });
    return { favor: favor.value, moved };
  }

  achievementAwarded(award: Parameters<AIShowHost['achievementAwarded']>[0]): void {
    this.deps.bus.emit('aiAchievementAwarded', { ...award });
  }

  // ── Scene wiring ──────────────────────────────────────────────────────────

  /** Mount once on the scene's `UiRoot`. */
  surfaces(): Surface[] {
    const surfaces = [
      aiQuestionSurface('ai-question', this),
      sponsorBreakSurface('ai-sponsor', this),
    ];
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

  /** The favour meter for the `HudModel`; null until the viewers have reacted this run. */
  favorModel(): ViewerFavorModel | null {
    const { favor } = this.deps;
    if (!favor.engaged) return null;
    const swing = favor.lastSwing;
    return {
      value: favor.value,
      max: FAVOR_MAX,
      tier: favorTier(favor.value),
      perk: favorPerk(favor.value).label,
      swing: swing === null ? null : { delta: swing.delta, seq: swing.seq },
    };
  }

  /** What every loot box's coins are multiplied by at the current favour. */
  boxCoinMultiplier(): number {
    return favorPerk(this.deps.favor.value).boxCoinMultiplier;
  }
}
