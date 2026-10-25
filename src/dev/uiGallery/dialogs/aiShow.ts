/**
 * Fixtures for the show AI's own screens: a question with two answers and
 * with four, a challenge offer, a sponsor break part-way typed and fully
 * typed, and the achievement card for an achievement the AI wrote.
 */

import { crawlerName } from '../../../characters/characters';
import { AchievementManager } from '../../../core/AchievementManager';
import { AchievementNotification } from '../../../ui/AchievementNotification';
import {
  aiChallengeOfferSurface,
  type AIChallengeOfferView,
} from '../../../ui/screens/dialogs/aiChallengeOffer';
import { aiQuestionSurface } from '../../../ui/screens/dialogs/aiQuestionPrompt';
import { sponsorBreakSurface } from '../../../ui/screens/dialogs/sponsorBreak';
import { syncViewport } from './conversation';
import type { DialogFixture } from './fixture';

const noop = (): void => undefined;
/** Frames run after the settle so the sponsor's whole line has typed out. */
const SPONSOR_TYPED_FRAMES = 100;
/** Past the card's fade-in, so the OK button is live. */
const ACHIEVEMENT_SHOWN_TICKS = 24;

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
  rewardTier: 'Silver',
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

function aiAchievementFixture(name: string): DialogFixture {
  const manager = new AchievementManager();
  const award = manager.grantAIAchievement({
    title: 'Fled From A Rat',
    description: 'You ran from the single weakest creature in the dungeon. The viewers clipped it.',
    tier: 'Gold',
    category: 'Adventurer',
    awardedBy: 'System',
  });
  const notification = new AchievementNotification();
  notification.reset();
  for (let tick = 0; tick < ACHIEVEMENT_SHOWN_TICKS; tick++) notification.tick();
  return {
    name,
    surfaces: (shown) => [
      {
        id: name,
        band: 'modal',
        haltsWorld: true,
        isOpen: () => shown() && award !== null,
        render: (ui) => {
          syncViewport(ui);
          if (award !== null) notification.paint(ui, award, 'Cat', noop);
        },
      },
    ],
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
  aiAchievementFixture('ai-achievement-notification'),
];
