/**
 * Every pet the party has is named. A pet is named when it joins, but a run
 * can end between the pet joining and the name being given (a reload, a
 * closed tab), so each scene checks once as it starts and asks for any name
 * still missing.
 */

import { PET_KINDS, type PetKind, type PetNameBook } from '../core/party/petNames';
import { drawAttackCowIcon } from '../sprites/attackCowSprite';
import { iconSquare } from '../ui/icons/iconSquare';
import type { PetNamePrompt, PetPortrait } from '../ui/screens/dialogs/petNamePrompt';

/** The attack cow, standing in profile. */
export const attackCowPortrait: PetPortrait = (ctx, rect) => {
  const { x, y, size } = iconSquare(rect);
  drawAttackCowIcon(ctx, x + size / 2, y + size / 2, size);
};

/** What asking for a pet's name needs from the scene. */
export interface PetNaming {
  readonly prompt: PetNamePrompt;
  readonly petNames: PetNameBook;
  /** The canvas the prompt's hidden text field is placed against. */
  readonly keyboardAnchor: HTMLCanvasElement | null;
}

/**
 * Asks for `kind`'s name unless the run has already given it one, then runs
 * `next`. The prompt cannot be dismissed, so `next` always runs.
 */
export function namePetThen(
  naming: PetNaming,
  kind: PetKind,
  portrait: PetPortrait,
  next: () => void = () => undefined,
): void {
  const { prompt, petNames, keyboardAnchor } = naming;
  if (petNames.nameOf(kind) !== null) {
    next();
    return;
  }
  prompt.open({
    kind,
    portrait,
    keyboardAnchor,
    onNamed: (name) => {
      petNames.give(kind, name);
      next();
    },
  });
}

export interface MissingPetNamesDeps extends PetNaming {
  /** Whether the party has each pet right now. */
  readonly owned: Readonly<Record<PetKind, () => boolean>>;
  readonly portraits: Readonly<Record<PetKind, PetPortrait>>;
}

/** Asks, once per scene, for the name of every pet the party has without one. */
export class MissingPetNames {
  private checked = false;

  constructor(private readonly deps: MissingPetNamesDeps) {}

  /**
   * Called every frame. Waits until nothing halts the world (the arrival
   * screen, a reward card, the pause menu), then asks once.
   */
  update(worldHalted: boolean): void {
    if (this.checked || worldHalted) return;
    this.checked = true;
    const { owned, portraits } = this.deps;
    for (const kind of PET_KINDS) {
      if (owned[kind]()) namePetThen(this.deps, kind, portraits[kind]);
    }
  }
}
