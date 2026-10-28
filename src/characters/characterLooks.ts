/**
 * How each registry character is painted. Apart from `characters.ts` so that a
 * crawler's name can be read without loading any art.
 */

import type { CatLook } from '../sprites/looks/catLook';
import { BELLE_LOOK } from '../sprites/looks/cats/belle';
import { PUMPKIN_LOOK } from '../sprites/looks/cats/pumpkin';
import type { HumanLook } from '../sprites/looks/humanLook';
import { DAVE_LOOK } from '../sprites/looks/humans/dave';
import {
  CHARACTER_IDS,
  CHARACTERS,
  PLAYER_CHARACTERS,
  isCatCharacterId,
  type CharacterId,
} from './characters';

interface LookOfSpecies {
  readonly human: HumanLook;
  readonly cat: CatLook;
}

type CharacterLookTable = {
  readonly [Id in CharacterId]: LookOfSpecies[(typeof CHARACTERS)[Id]['species']];
};

export const CHARACTER_LOOKS = {
  dave: DAVE_LOOK,
  pumpkin: PUMPKIN_LOOK,
  belle: BELLE_LOOK,
} as const satisfies CharacterLookTable;

/** A registry cat with the look it is painted in. */
export interface PaintedCat {
  readonly displayName: string;
  readonly look: CatLook;
}

/** Every cat in the registry, so a new cat reaches the previews and gates without being listed. */
export const PAINTED_CATS: readonly PaintedCat[] = CHARACTER_IDS.filter(isCatCharacterId).map(
  (id) => ({ displayName: CHARACTERS[id].displayName, look: CHARACTER_LOOKS[id] }),
);

/** The registry cat the player controls, with her look. */
export const PLAYER_CAT: PaintedCat = {
  displayName: CHARACTERS[PLAYER_CHARACTERS.cat].displayName,
  look: CHARACTER_LOOKS[PLAYER_CHARACTERS.cat],
};
