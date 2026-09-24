import type { RemainsColors } from '../art/spiderLabArt';
import { generatePersonAppearance, type PersonAppearance } from './PersonAppearance';

/**
 * The spider lab's scientist: one fixed genome, so he is the same man on every
 * floor and in every save, put in a lab coat over whatever the seed dressed him
 * in underneath.
 */
const SCIENTIST_SEED = 0x5c1e7;
const LAB_COAT = '#eef1ee';
const LAB_COAT_LAPEL = '#d4d9d6';
const LAB_TROUSERS = '#3d4450';
const LAB_SHOES = '#231f1c';

let appearance: PersonAppearance | null = null;

/** The scientist's appearance. One object for the page's life, so the person cache keeps his cells. */
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
