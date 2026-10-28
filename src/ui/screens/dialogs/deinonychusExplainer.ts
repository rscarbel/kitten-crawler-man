/**
 * The three pages of Deinonychus's explainer, opened once when he is first granted
 * and again from his entry in the Abilities tab. He has no tome and no hotbar
 * slot, his health outlives a summon and he picks his own targets, so each page
 * shows one of those rules played out and says it in a few lines underneath.
 */

import { getDeinonychusStats } from '../../../abilities/deinonychus';
import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';
import {
  inDesignSpace,
  drawCallPage,
  drawFightPage,
  drawHealthPage,
  prewarmDeinonychusExplainerArt,
  type DeinonychusExplainerLabels,
} from '../../icons/explainerArt/deinonychusArt';
import { byInputMode, keyLabel, type InputMode } from '../../core/inputMode';
import type { DeinonychusStage } from '../../../sprites/deinonychusSprite';
import { petWords, type PetNames, type PetWords } from '../../../core/party/petNames';

function currentLabels(touch: boolean, pet: PetWords): DeinonychusExplainerLabels {
  const inputMode: InputMode = touch ? 'touch' : 'pointer';
  return {
    inputMode,
    switchKey: keyLabel('switchCharacter'),
    summonKey: keyLabel('buildSummon'),
    followKey: keyLabel('companionFollow'),
    petName: pet.called,
  };
}

function callLines(labels: DeinonychusExplainerLabels, pet: PetWords): readonly string[] {
  const summon = `[${labels.summonKey}]`;
  return byInputMode(labels.inputMode, {
    touch: [
      `${pet.opening} answers to the Cat. Tap the Cat button to switch to her, then tap Summon.`,
      'Tap it again — it reads Recall while he is out — to call him back. He runs home to her.',
      "Stuck somewhere? Tap Recall once more while he's on his way and he's brought straight to you.",
    ],
    pointer: [
      `${pet.opening} answers to the Cat. Press [${labels.switchKey}] to switch to her, then ${summon} to summon him.`,
      `Press ${summon} again to call him back. He runs home to her.`,
      `Stuck somewhere? Press ${summon} once more while he's on his way and he's brought straight to you.`,
    ],
  });
}

function fightLines(labels: DeinonychusExplainerLabels): readonly string[] {
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
export function deinonychusExplainerPages(
  stage: DeinonychusStage,
  touch: boolean,
  pet: PetWords,
): ExplainerPageContent[] {
  const labels = currentLabels(touch, pet);
  return [
    {
      subtitle: 'Calling him',
      lines: callLines(labels, pet),
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
        inDesignSpace(ctx, rect, (width) => drawHealthPage(ctx, stage, pet.called, frame, width)),
    },
  ];
}

/**
 * Deinonychus's explainer, drawing the animal the player actually has at
 * `petLevel` rather than a stock adult, and calling him by the name he has
 * when it opens.
 */
export function deinonychusExplainerEntry(
  petLevel: () => number,
  petNames: PetNames,
): ExplainerEntry {
  const stage = (): DeinonychusStage => getDeinonychusStats(petLevel()).stage;
  const pet = (): PetWords => petWords(petNames, 'deinonychus');
  return {
    get title() {
      return deinonychusGuideLabel(pet());
    },
    onOpen: () => prewarmDeinonychusExplainerArt(stage()),
    pages: (touch) =>
      deinonychusExplainerPages(stage(), touch, pet()).map((content) => explainerPage(content)),
  };
}

/** The explainer's title, and the Abilities tab's button that opens it. */
export function deinonychusGuideLabel(pet: PetWords): string {
  return `How ${pet.referred} works`;
}
