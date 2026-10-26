/**
 * Fixtures for the show AI's own screens: a question with two answers and
 * with four, a challenge offer, a sponsor break part-way typed and fully
 * typed.
 */

import { crawlerName } from '../../../characters/characters';
import {
  aiChallengeOfferSurface,
  type AIChallengeOfferView,
} from '../../../ui/screens/dialogs/aiChallengeOffer';
import { aiQuestionSurface } from '../../../ui/screens/dialogs/aiQuestionPrompt';
import { sponsorBreakSurface } from '../../../ui/screens/dialogs/sponsorBreak';
import type { DialogFixture } from './fixture';

const noop = (): void => undefined;
/** Frames run after the settle so the sponsor's whole line has typed out. */
const SPONSOR_TYPED_FRAMES = 100;

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
          return shown() ? { id: 'question-1', question, choices, askedBy: 'The System' } : null;
        },
        answer: noop,
        dismissQuestion: noop,
      }),
    ],
  };
}

const RAT_RACE: AIChallengeOfferView = {
  title: 'Rat Race',
  objective: 'Kill 5 rats within 90s without taking damage',
  pitch: 'The viewers have money on you. Not much, but some.',
  rewardRarity: 'Uncommon',
  offeredBy: 'System',
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
  };
}

function sponsorFixture(name: string, typedFrames: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => [
      sponsorBreakSurface(name, {
        get sponsorBreak() {
          return shown()
            ? {
                sponsor: 'Borant Snack Pellets',
                message: 'NOW WITH 40% FEWER SCREAMS. ASK YOUR GUIDE ABOUT PELLETS TODAY.',
              }
            : null;
        },
        endSponsorBreak: noop,
      }),
    ],
    interact: (rig) => {
      for (let frame = 0; frame < typedFrames; frame++) rig.frame();
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  questionFixture('ai-question', 'Viewers want to know: save the cat or the loot?', [
    'The cat',
    'The loot',
  ]),
  questionFixture('ai-question-four', 'Which of you is carrying this team?', [
    crawlerName('human'),
    crawlerName('cat'),
    'Mongo',
    'Nobody',
  ]),
  challengeFixture('ai-challenge-offer'),
  sponsorFixture('ai-sponsor-break-typing', 0),
  sponsorFixture('ai-sponsor-break-typed', SPONSOR_TYPED_FRAMES),
];
