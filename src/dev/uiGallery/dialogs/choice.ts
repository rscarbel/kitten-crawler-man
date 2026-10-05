/**
 * Fixtures for the choice-modal dialogs: confirms, stair and door prompts,
 * the failed-hack prompt and the award cards, each over real game models
 * where the model is cheap to build.
 */

import { getSkillDef } from '../../../core/SkillManager';
import type { DescentPrompt } from '../../../systems/StairwellSystem';
import type { TowerStairPrompt } from '../../../systems/TowerStairSystem';
import type { BuildingEntry } from '../../../systems/BuildingSystem';
import { LevelUpDialog } from '../../../ui/LevelUpDialog';
import { RewardGrantedDialog } from '../../../ui/RewardGrantedDialog';
import { SkillBookPrompt } from '../../../ui/SkillBookPrompt';
import { drawCraftSkillIcon } from '../../../ui/icons/craftSkillIcons';
import { drawSkillIcon } from '../../../ui/icons/skillIcons';
import { buildingEntryPromptSurface } from '../../../ui/screens/dialogs/buildingEntryPrompt';
import {
  ConfirmDialog,
  type ConfirmDialogOptions,
} from '../../../ui/screens/dialogs/ConfirmDialog';
import { exitBuildingPromptSurface } from '../../../ui/screens/dialogs/exitBuildingPrompt';
import { hackFailedPromptSurface } from '../../../ui/screens/dialogs/hackFailedPrompt';
import { levelUpSurface } from '../../../ui/screens/dialogs/levelUpDialog';
import { rewardGrantedSurface } from '../../../ui/screens/dialogs/rewardGrantedDialog';
import { skillBookDialogSurface } from '../../../ui/screens/dialogs/skillBookDialog';
import { stairwellPromptSurface } from '../../../ui/screens/dialogs/stairwellPrompt';
import { towerStairsPromptSurface } from '../../../ui/screens/dialogs/towerStairsPrompt';
import type { DialogFixture } from './fixture';

/** Frames of `update()` that carry an award card through its whole reveal. */
const FRAMES_TO_SETTLE = 120;
/** Frames that leave an award card part-way through powering up. */
const FRAMES_MID_REVEAL = 24;
const PUGILISM_LEVEL = 3;
const READER_PUGILISM_LEVEL = 2;
const PARTY_LEVEL = 4;
const RECOMMENDED_LEVEL = 6;
const OVER_RECOMMENDED_LEVEL = 3;

const noop = (): void => undefined;

function confirmFixture(name: string, options: ConfirmDialogOptions): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const dialog = new ConfirmDialog(null);
      dialog.open(options);
      const surface = dialog.surface(name, 'system');
      return [{ ...surface, isOpen: () => shown() && surface.isOpen() }];
    },
  };
}

const QUEST_SWITCH: ConfirmDialogOptions = {
  title: 'NEW QUEST',
  message:
    'Would you like to stop tracking The Goblin Mother and start tracking A Spider in the Works?',
  subtext: '*you can always change this via the quest menu by clicking the blue quest icon',
  yesLabel: 'Yes',
  noLabel: 'No',
  yesQuestRelated: true,
  onYes: noop,
  onNo: noop,
};

const DISMANTLE: ConfirmDialogOptions = {
  message: 'Are you sure you want to permanently remove this? Resources will NOT be refunded.',
  yesLabel: 'Yes',
  noLabel: 'No',
  onYes: noop,
  onNo: noop,
};

function stairwellFixture(name: string, prompt: DescentPrompt): DialogFixture {
  return {
    name,
    surfaces: (shown) => [
      stairwellPromptSurface(name, {
        get menuOpen() {
          return shown();
        },
        descentPrompt: () => prompt,
        descend: noop,
        closeMenu: noop,
      }),
    ],
  };
}

const UNDER_LEVEL_DESCENT: DescentPrompt = {
  nextFloorName: 'The Over City',
  advice: { party: PARTY_LEVEL, recommended: RECOMMENDED_LEVEL, standing: 'below' },
  warning: `The foes below fight like a level-${RECOMMENDED_LEVEL} party. You are level ${PARTY_LEVEL} — this floor still has strength to give.`,
};

const COMFORTABLE_DESCENT: DescentPrompt = {
  nextFloorName: 'The Over City',
  advice: { party: PARTY_LEVEL, recommended: OVER_RECOMMENDED_LEVEL, standing: 'above' },
  warning: null,
};

const TAVERN: BuildingEntry = {
  doorTile: { x: 0, y: 0 },
  name: 'The Sunken Stump Pub',
  type: 'store',
};

function towerFixture(name: string, prompt: TowerStairPrompt): DialogFixture {
  return {
    name,
    surfaces: (shown) => [
      towerStairsPromptSurface(name, () => ({
        prompt: shown() ? prompt : null,
        takeStairs: noop,
        closeMenu: noop,
      })),
    ],
  };
}

function levelUpFixture(name: string, frames: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const dialog = new LevelUpDialog();
      const def = getSkillDef('pugilism');
      dialog.enqueue({
        name: def.name,
        newLevel: PUGILISM_LEVEL,
        perkDescription: def.describeEffect(PUGILISM_LEVEL),
        renderIcon: (ctx, rect) => drawSkillIcon(ctx, rect, 'pugilism'),
      });
      for (let frame = 0; frame < frames; frame++) dialog.update();
      return [levelUpSurface(name, dialog, { shownWhen: shown })];
    },
  };
}

function rewardFixture(name: string, frames: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const dialog = new RewardGrantedDialog();
      dialog.enqueue({
        kind: 'skill',
        name: 'Construction',
        description:
          'You have unlocked the Construction skill. You may now earn construction experience.',
        renderIcon: (ctx, rect) => drawCraftSkillIcon(ctx, rect, 'construction'),
      });
      for (let frame = 0; frame < frames; frame++) dialog.update();
      return [rewardGrantedSurface(name, dialog, { shownWhen: shown })];
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  confirmFixture('confirm-quest-switch', QUEST_SWITCH),
  confirmFixture('confirm-dismantle', DISMANTLE),
  {
    ...confirmFixture('confirm-dismantle-hover-no', DISMANTLE),
    interact: (rig) => rig.hover(rig.need('confirm-dismantle-hover-no/confirm/no')),
  },
  stairwellFixture('stairwell-under-level', UNDER_LEVEL_DESCENT),
  stairwellFixture('stairwell-comfortable', COMFORTABLE_DESCENT),
  {
    name: 'building-entry',
    surfaces: (shown) => [
      buildingEntryPromptSurface('building-entry', () => ({
        menuEntry: shown() ? TAVERN : null,
        enterActiveBuilding: noop,
        closeMenu: noop,
      })),
    ],
  },
  towerFixture('tower-stairs-ascend', { kind: 'ascend', targetFloorLabel: '2nd Floor' }),
  towerFixture('tower-stairs-finale', { kind: 'finale' }),
  {
    name: 'exit-building',
    surfaces: (shown) => [
      exitBuildingPromptSurface('exit-building', {
        isOpen: shown,
        buildingName: () => TAVERN.name,
        exit: noop,
        stay: noop,
      }),
    ],
  },
  {
    name: 'hack-failed',
    surfaces: (shown) => [
      hackFailedPromptSurface('hack-failed', {
        get isHackFailedOpen() {
          return shown();
        },
        retryHack: noop,
        retreatFromHack: noop,
        dismissDialog: () => true,
      }),
    ],
  },
  levelUpFixture('level-up', FRAMES_TO_SETTLE),
  levelUpFixture('level-up-revealing', FRAMES_MID_REVEAL),
  rewardFixture('reward-granted', FRAMES_TO_SETTLE),
  rewardFixture('reward-granted-revealing', FRAMES_MID_REVEAL),
  {
    name: 'skill-book',
    surfaces: (shown) => {
      const prompt = new SkillBookPrompt();
      prompt.open({ bookId: 'skill_book_pugilism', skillId: 'pugilism' }, READER_PUGILISM_LEVEL);
      return [
        skillBookDialogSurface(
          'skill-book',
          {
            get pendingRequest() {
              return shown() ? prompt.pendingRequest : null;
            },
            bodyText: () => prompt.bodyText(),
          },
          { resolve: noop, dismiss: noop },
        ),
      ];
    },
  },
];
