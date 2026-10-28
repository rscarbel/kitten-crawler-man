/**
 * Fixtures for the AI's own screens: a question with two answers and with
 * four, and a challenge offer.
 */

import { CAROLINE_CHARACTER_NAME } from '../../../ai/characters';
import { crawlerName } from '../../../characters/characters';
import {
  aiChallengeOfferSurface,
  type AIChallengeOfferView,
} from '../../../ui/screens/dialogs/aiChallengeOffer';
import { aiQuestionSurface } from '../../../ui/screens/dialogs/aiQuestionPrompt';
import type { DialogFixture, FixtureRig } from './fixture';

const noop = (): void => undefined;
/** Frames run after the settle so Caroline's frame has unfolded and her whole message decoded. */
const CAROLINE_DECODED_FRAMES = 150;

function decodeInFull(rig: FixtureRig): void {
  for (let frame = 0; frame < CAROLINE_DECODED_FRAMES; frame++) rig.frame();
}

function questionFixture(
  name: string,
  question: string,
  choices: readonly string[],
): DialogFixture {
  return {
    name,
    surfaces: (shown) => [
      aiQuestionSurface(name, {
        get pendingQuestion() {
          return shown()
            ? { id: 'question-1', question, choices, askedBy: CAROLINE_CHARACTER_NAME }
            : null;
        },
        answer: noop,
        dismissQuestion: noop,
      }),
    ],
    interact: decodeInFull,
  };
}

const RAT_RACE: AIChallengeOfferView = {
  title: 'Rat Race',
  objective: 'Kill 5 rats within 90s without taking damage',
  pitch: 'Projected success: 38 percent. Raise it.',
  rewardRarity: 'Uncommon',
  offeredBy: CAROLINE_CHARACTER_NAME,
};

function challengeFixture(name: string): DialogFixture {
  return {
    name,
    surfaces: (shown) => [
      aiChallengeOfferSurface(name, {
        get challengeOffer() {
          return shown() ? RAT_RACE : null;
        },
        acceptChallenge: noop,
        declineChallenge: noop,
      }),
    ],
    interact: decodeInFull,
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  questionFixture('ai-question', 'Save the cat or the loot?', ['The cat', 'The loot']),
  questionFixture('ai-question-four', 'Which of you is carrying this team?', [
    crawlerName('human'),
    crawlerName('cat'),
    'Deinonychus',
    'Nobody',
  ]),
  challengeFixture('ai-challenge-offer'),
];
