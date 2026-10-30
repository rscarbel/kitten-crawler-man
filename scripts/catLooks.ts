/**
 * The cat looks the cat harnesses and gates paint, by the id `--look=` names.
 * Every cat garment and held thing is fitted on all of them: two body shapes
 * share one set of part frames, so a fit checked on one says nothing about
 * the other.
 */

import { PAINTED_CATS, PLAYER_CAT } from '../src/characters/characterLooks.js';
import type { CatLook } from '../src/sprites/looks/catLook.js';
import { TOWN_CAT_LOOKS } from '../src/sprites/looks/cats/townCatLooks.js';
import { TOWN_CAT_IDS } from '../src/core/state/townCatIds.js';

/** Every cat in the character registry, so a new cat is gated without being listed here. */
export const CAT_LOOKS: readonly CatLook[] = PAINTED_CATS.map((cat) => cat.look);

/**
 * The town's cats, which harnesses paint by `--look=` like any other. Apart
 * from `CAT_LOOKS` because they never wear anything, so the garment gates have
 * nothing to fit on them.
 */
export const TOWN_CAT_LOOK_LIST: readonly CatLook[] = TOWN_CAT_IDS.map((id) => TOWN_CAT_LOOKS[id]);

const EVERY_CAT_LOOK: readonly CatLook[] = [...CAT_LOOKS, ...TOWN_CAT_LOOK_LIST];

/** The look a harness paints when `--look=` names none. */
const DEFAULT_CAT_LOOK_ID = PLAYER_CAT.look.id;

/** The look `--look=<id>` names, or the default; throws on an id no look has. */
export function catLookFlag(argv: readonly string[] = process.argv): CatLook {
  const prefix = '--look=';
  const raw =
    argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? DEFAULT_CAT_LOOK_ID;
  const look = EVERY_CAT_LOOK.find((candidate) => candidate.id === raw);
  if (look === undefined) {
    throw new Error(`--look=${raw} is not one of ${EVERY_CAT_LOOK.map((l) => l.id).join(', ')}`);
  }
  return look;
}
