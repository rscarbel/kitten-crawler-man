/**
 * The cat looks the cat harnesses and gates paint, by the id `--look=` names.
 * Every cat garment and held thing is fitted on all of them: two body shapes
 * share one set of part frames, so a fit checked on one says nothing about
 * the other.
 */

import { CHARACTERS, isCatCharacter } from '../src/characters/characters.js';
import type { CatLook } from '../src/sprites/looks/catLook.js';

/** Every cat in the character registry, so a new cat is gated without being listed here. */
export const CAT_LOOKS: readonly CatLook[] = Object.values(CHARACTERS)
  .filter(isCatCharacter)
  .map((cat) => cat.look);

/** The look a harness paints when `--look=` names none. */
const DEFAULT_CAT_LOOK_ID = CHARACTERS.belle.look.id;

/** The look `--look=<id>` names, or the default; throws on an id no look has. */
export function catLookFlag(argv: readonly string[] = process.argv): CatLook {
  const prefix = '--look=';
  const raw =
    argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? DEFAULT_CAT_LOOK_ID;
  const look = CAT_LOOKS.find((candidate) => candidate.id === raw);
  if (look === undefined) {
    throw new Error(`--look=${raw} is not one of ${CAT_LOOKS.map((l) => l.id).join(', ')}`);
  }
  return look;
}
