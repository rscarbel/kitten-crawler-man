import type { RemainsColors } from '../art/spiderLabArt';
import { generatePersonAppearance, type PersonAppearance } from './PersonAppearance';
import { PERSON_PAINTER_STRIDE_FRACTION, type TownCastLook } from './townCastLooks';

/**
 * The spider lab's scientist: one fixed genome, so he is the same man on every
 * floor and in every save, put in a lab coat over whatever the seed dressed him
 * in underneath. He is not part of the closed street cast (`townCastLooks.ts`)
 * — he is one specific, named individual — but he paints through the same rig
 * and pipeline, as his own dedicated look.
 */
const SCIENTIST_SEED = 0x5c1e7;
const LAB_COAT = '#eef1ee';
const LAB_COAT_LAPEL = '#d4d9d6';
const LAB_TROUSERS = '#3d4450';
const LAB_SHOES = '#231f1c';

let appearance: PersonAppearance | null = null;

/** The scientist's appearance. One object for the page's life, so the frame cache keeps his cells. */
export function labScientistAppearance(): PersonAppearance {
  if (appearance !== null) return appearance;
  const seeded = generatePersonAppearance(SCIENTIST_SEED);
  appearance = {
    ...seeded,
    outfit: {
      ...seeded.outfit,
      top: 'labcoat',
      topColor: LAB_COAT,
      topAccent: LAB_COAT_LAPEL,
      bottom: 'pants',
      bottomColor: LAB_TROUSERS,
      shoes: LAB_SHOES,
      hat: 'none',
    },
  };
  return appearance;
}

export const LAB_SCIENTIST_LOOK_ID = 'human_scientist';

let look: TownCastLook | null = null;

/** The scientist as a closed-set look, for `townCastOutfitFigure`. */
export function labScientistLook(): TownCastLook {
  if (look !== null) return look;
  look = {
    id: LAB_SCIENTIST_LOOK_ID,
    painter: 'person',
    build: 'standard',
    roles: [],
    hasWork: false,
    strideFraction: PERSON_PAINTER_STRIDE_FRACTION,
    feminine: false,
    dialogSeed: SCIENTIST_SEED,
    appearance: labScientistAppearance(),
  };
  return look;
}

/** His colours, for the painted remains she leaves of him. */
export function scientistRemainsColors(): RemainsColors {
  const scientist = labScientistAppearance();
  return {
    skin: scientist.face.skin,
    hair: scientist.hair.color,
    coat: scientist.outfit.topColor,
    trousers: scientist.outfit.bottomColor,
  };
}
