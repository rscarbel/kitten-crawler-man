/**
 * The three pages of Mongo's explainer, opened once when he is first granted
 * and again from his entry in the Abilities tab. He has no tome and no hotbar
 * slot, his health outlives a summon and he picks his own targets, so each page
 * shows one of those rules played out and says it in a few lines underneath.
 */

import { getMongoStats } from '../../../abilities/mongo';
import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';
import {
  inDesignSpace,
  drawCallPage,
  drawFightPage,
  drawHealthPage,
  prewarmMongoExplainerArt,
  type MongoExplainerLabels,
} from '../../icons/explainerArt/mongoArt';
import { byInputMode, keyLabel, type InputMode } from '../../core/inputMode';
import type { MongoStage } from '../../../sprites/mongoSprite';

function currentLabels(touch: boolean): MongoExplainerLabels {
  const inputMode: InputMode = touch ? 'touch' : 'pointer';
  return {
    inputMode,
    switchKey: keyLabel('switchCharacter'),
    summonKey: keyLabel('buildSummon'),
    followKey: keyLabel('companionFollow'),
  };
}

function callLines(labels: MongoExplainerLabels): readonly string[] {
  const summon = `[${labels.summonKey}]`;
  return byInputMode(labels.inputMode, {
    touch: [
      'Mongo answers to the Cat. Tap the Cat button to switch to her, then tap Summon.',
      'Tap it again — it reads Recall while he is out — to call him back. He runs home to her.',
      "Stuck somewhere? Tap Recall once more while he's on his way and he's brought straight to you.",
    ],
    pointer: [
      `Mongo answers to the Cat. Press [${labels.switchKey}] to switch to her, then ${summon} to summon him.`,
      `Press ${summon} again to call him back. He runs home to her.`,
      `Stuck somewhere? Press ${summon} once more while he's on his way and he's brought straight to you.`,
    ],
  });
}

function fightLines(labels: MongoExplainerLabels): readonly string[] {
  const whereToTurnOff = byInputMode(labels.inputMode, {
    touch: 'Settings or the follower menu',
    pointer: `Settings or the follower menu [${labels.followKey}]`,
  });
  return [
    'He picks his own fights: first whatever is attacking the Cat, then whatever she is hitting, then the nearest enemy.',
    `While you play the human, the Cat sends him in herself when enemies come close. Turn that off in ${whereToTurnOff}.`,
    'He follows you indoors too.',
  ];
}

function healthLines(): readonly string[] {
  return [
    'Damage stays with him between summons, and he only heals while recalled.',
    "He fights at any health, all the way down — there's no point where he holds back or breaks off.",
    'Knocked out, he collapses and runs home, then must heal all the way to full before you can summon him again. Every kill while he rests speeds that up.',
  ];
}

/**
 * The three pages, with key labels read from the live bindings and touch
 * wording on a phone. Built fresh on every open, so a rebind made since the
 * last one is what the page says.
 */
export function mongoExplainerPages(stage: MongoStage, touch: boolean): ExplainerPageContent[] {
  const labels = currentLabels(touch);
  return [
    {
      subtitle: 'Calling him',
      lines: callLines(labels),
      drawIllustration: (ctx, rect, frame) =>
        inDesignSpace(ctx, rect, (width) => drawCallPage(ctx, stage, labels, frame, width)),
    },
    {
      subtitle: 'How he fights',
      lines: fightLines(labels),
      drawIllustration: (ctx, rect, frame) =>
        inDesignSpace(ctx, rect, (width) => drawFightPage(ctx, stage, frame, width)),
    },
    {
      subtitle: 'His health',
      lines: healthLines(),
      drawIllustration: (ctx, rect, frame) =>
        inDesignSpace(ctx, rect, (width) => drawHealthPage(ctx, stage, frame, width)),
    },
  ];
}

/**
 * Mongo's explainer, drawing the animal the player actually has at
 * `petLevel` rather than a stock adult.
 */
export function mongoExplainerEntry(petLevel: () => number): ExplainerEntry {
  const stage = (): MongoStage => getMongoStats(petLevel()).stage;
  return {
    title: 'How Mongo works',
    onOpen: () => prewarmMongoExplainerArt(stage()),
    pages: (touch) => mongoExplainerPages(stage(), touch).map((content) => explainerPage(content)),
  };
}
