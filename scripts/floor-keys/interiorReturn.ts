/**
 * A fragment earned indoors outlives the walk back out: the floor's ring is
 * threaded into the building by reference, so the checkpoint the street was
 * held aside with must not put the ring back to how it stood at the door.
 * A death still rewinds it.
 */

import { fragmentsOnFloor } from '../../src/core/keys/floorKeys';
import { KeyRing } from '../../src/core/keys/KeyRing';
import type { LevelId } from '../../src/levels/levelIds';
import { announce, keyHarness, type FloorKeysSection } from './shared';

/** The floor whose quests finish indoors as well as out. */
const TOWN_FLOOR: LevelId = 'level3';

const indoorFragmentSurvivesReturn: FloorKeysSection = {
  name: 'a fragment earned indoors survives the return outside',
  run(check) {
    const indoorFragment = fragmentsOnFloor(TOWN_FLOOR).find(
      (fragment) => fragment.source.kind === 'questCompleted',
    );
    if (indoorFragment === undefined) {
      check(false, `${TOWN_FLOOR} has a quest fragment to earn indoors`);
      return;
    }
    for (const runProgress of ['keep', 'rewind'] as const) {
      const ring = new KeyRing(TOWN_FLOOR);
      const outside = keyHarness(TOWN_FLOOR, ring);
      const atTheDoor = ring.capture();
      const inside = keyHarness(TOWN_FLOOR, ring);
      announce(inside.bus, indoorFragment.source);
      ring.applyCheckpoint(atTheDoor, runProgress);
      const held = ring.holds(indoorFragment.id);
      const owed = outside.keys.nextMoment()?.kind === 'fragment';
      if (runProgress === 'keep') {
        check(held, `${indoorFragment.id}, earned indoors, is still held back outside`);
        check(owed, `its ceremony is still owed back outside`);
      } else {
        check(
          !held && !owed,
          `a death rewinds ${indoorFragment.id} and its ceremony to the capture`,
        );
      }
      outside.keys.dispose();
      inside.keys.dispose();
    }
  },
};

export const interiorReturnSections: readonly FloorKeysSection[] = [indoorFragmentSurvivesReturn];
