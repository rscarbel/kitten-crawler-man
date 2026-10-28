/**
 * Fixtures for the pet-naming prompt: each pet with the field empty, and
 * the Deinonychus's with a suggestion filled in.
 */

import type { PetKind } from '../../../core/party/petNames';
import { PetNamePrompt, type PetPortrait } from '../../../ui/screens/dialogs/petNamePrompt';
import { deinonychusPortrait } from '../../../systems/deinonychusArrival';
import { attackCowPortrait } from '../../../systems/petNaming';
import type { DialogFixture } from './fixture';

const FILLED_SUGGESTION = 'Clementine';

const PORTRAITS = {
  deinonychus: deinonychusPortrait(() => 1),
  attackCow: attackCowPortrait,
} as const satisfies Record<PetKind, PetPortrait>;

function petNameFixture(name: string, kind: PetKind, filled: string | null = null): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const prompt = new PetNamePrompt();
      prompt.open({
        kind,
        portrait: PORTRAITS[kind],
        keyboardAnchor: null,
        onNamed: () => undefined,
      });
      if (filled !== null) prompt.fill(filled);
      const surface = prompt.surface(name);
      return [{ ...surface, isOpen: () => shown() && surface.isOpen() }];
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  petNameFixture('pet-name-deinonychus', 'deinonychus'),
  petNameFixture('pet-name-deinonychus-filled', 'deinonychus', FILLED_SUGGESTION),
  petNameFixture('pet-name-attack-cow', 'attackCow'),
];
