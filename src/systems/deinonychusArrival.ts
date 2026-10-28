/**
 * Deinonychus's arrival as a reward, shared by every scene that can show the
 * reward chest bringing him. Earning the chest does not bring him: he joins
 * when the player opens it, and is announced and explained when it closes.
 * The chest waits in the saved presentation queue until then, so a chest
 * left unopened across a reload still brings him, once. The player names
 * him between his reward card and his explainer.
 */

import { getDeinonychusStats, DEINONYCHUS_DEF } from '../abilities/deinonychus';
import { crawlerName } from '../characters/characters';
import type { EventBus } from '../core/EventBus';
import type { GrantedReward } from '../core/items/loot/GrantedReward';
import { petWords, type PetNameBook } from '../core/party/petNames';
import type { PetPortrait } from '../ui/screens/dialogs/petNamePrompt';
import type { RewardPresentation } from '../loot/rewardChest';
import { drawDeinonychusIcon } from '../sprites/deinonychusSprite';
import { iconSquare } from '../ui/icons/iconSquare';
import type { MenusKit } from './kits/MenusKit';
import type { DeinonychusSystem } from './DeinonychusSystem';
import { namePetThen } from './petNaming';

/** Whether `presentation` is the chest that brought Deinonychus to the party. */
export function presentsDeinonychus(presentation: RewardPresentation): boolean {
  return presentation.rewards.some((line) => line.kind === 'companion');
}

/** Deinonychus joins the party as the chest that brings him is opened, so he can be summoned from then on. */
export function joinDeinonychusOnOpen(
  presentation: RewardPresentation,
  deinonychus: DeinonychusSystem,
): void {
  if (presentsDeinonychus(presentation)) deinonychus.unlocked = true;
}

/** Deinonychus drawn at the stage his current level shows. */
export function deinonychusPortrait(deinonychusLevel: () => number): PetPortrait {
  return (ctx, rect) => {
    const { x, y, size } = iconSquare(rect);
    const stage = getDeinonychusStats(deinonychusLevel()).stage;
    drawDeinonychusIcon(ctx, stage, x + size / 2, y + size / 2, size);
  };
}

/**
 * Deinonychus's "New Ability!" card. The name prompt follows the card, so the
 * card names him only when the run gave him a name before.
 */
function deinonychusGrantedReward(introduction: DeinonychusIntroduction): GrantedReward {
  const pet = petWords(introduction.petNames, 'deinonychus');
  return {
    kind: 'ability',
    name: DEINONYCHUS_DEF.name,
    description: `A loyal dinosaur companion. Summon ${pet.referred} to fight alongside ${crawlerName('cat')} in battle!`,
    renderIcon: deinonychusPortrait(introduction.deinonychusLevel),
  };
}

/** What his introduction needs from the scene beyond its bus and menus. */
export interface DeinonychusIntroduction {
  readonly deinonychusLevel: () => number;
  readonly petNames: PetNameBook;
  /** The canvas the naming prompt's hidden text field is placed against. */
  readonly keyboardAnchor: HTMLCanvasElement | null;
}

function nameDeinonychusThen(
  menus: Pick<MenusKit, 'petNamePrompt'>,
  introduction: DeinonychusIntroduction,
  next: () => void,
): void {
  namePetThen(
    { prompt: menus.petNamePrompt, ...introduction },
    'deinonychus',
    deinonychusPortrait(introduction.deinonychusLevel),
    next,
  );
}

/**
 * Announces Deinonychus once the chest that brought him has closed, then, after
 * the reward cards drain, has the player name him and explains him. Only this
 * first grant explains him; the Abilities tab reopens the explainer on request.
 */
export function introduceDeinonychus(
  bus: EventBus,
  menus: Pick<MenusKit, 'rewardGrantedDialog' | 'craftExplainers' | 'petNamePrompt'>,
  introduction: DeinonychusIntroduction,
): void {
  bus.emit('rewardGranted', {
    rewards: [deinonychusGrantedReward(introduction)],
  });
  menus.rewardGrantedDialog.afterQueueDrains(() =>
    nameDeinonychusThen(menus, introduction, () => menus.craftExplainers.open('deinonychus')),
  );
}
