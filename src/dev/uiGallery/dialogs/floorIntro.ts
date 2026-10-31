/**
 * Fixtures for each floor's "Find the Key" intro, stopped at each of its
 * beats: the floor's name over its ambience, the silhouette counting its
 * sockets, the title's slam, the finished card and the fade to the floor.
 */

import { WORLD_TICKS_PER_SECOND } from '../../../core/constants';
import { LEVEL_IDS, type LevelId } from '../../../levels/levelIds';
import { DungeonIntroSystem } from '../../../systems/DungeonIntroSystem';
import { floorIntroView } from '../../../ui/screens/floorIntro/floorIntroScreen';
import type { Surface } from '../../../ui/core/UiRoot';
import type { DialogFixture } from './fixture';

const MS_PER_SECOND = 1000;
/** The kicker is up and the ambience most of the way in, before the key has started to rise. */
const FLOOR_BEAT_SLAM_SHARE = 0.3;
/** Just past the last knock, with its socket at the top of its pulse. */
const KNOCK_PEAK_AFTER_MS = 80;
/** Just after the title lands, with the flash and the edge catch strongest. */
const SLAM_LANDED_AFTER_MS = 230;
/** The finished card, the subline fully in, just before the fade starts. */
const WORDS_BEFORE_FADE_MS = 300;
/** Partway through the fade to the floor. */
const FADE_INTO_MS = 600;

type IntroBeat = 'floor' | 'lock' | 'slam' | 'words' | 'fade';

function beatMs(levelId: LevelId, beat: IntroBeat): number {
  const { timing } = floorIntroView(levelId);
  switch (beat) {
    case 'floor':
      return timing.slamAtMs * FLOOR_BEAT_SLAM_SHARE;
    case 'lock':
      return timing.knockAtMs[timing.knockAtMs.length - 1] + KNOCK_PEAK_AFTER_MS;
    case 'slam':
      return timing.slamAtMs + SLAM_LANDED_AFTER_MS;
    case 'words':
      return timing.holdMs - WORDS_BEFORE_FADE_MS;
    case 'fade':
      return timing.holdMs + FADE_INTO_MS;
    default: {
      const unhandled: never = beat;
      return unhandled;
    }
  }
}

function introFixture(levelId: LevelId, beat: IntroBeat): DialogFixture {
  const name = `floor-intro-${levelId}-${beat}`;
  const frames = Math.round((beatMs(levelId, beat) * WORLD_TICKS_PER_SECOND) / MS_PER_SECOND);
  return {
    name,
    surfaces: (shown): readonly Surface[] => {
      const intro = new DungeonIntroSystem(levelId);
      intro.start(null);
      for (let frame = 0; frame < frames; frame++) intro.tick();
      return [
        {
          id: name,
          get band() {
            return intro.band;
          },
          get haltsWorld() {
            return intro.haltsWorld;
          },
          isOpen: () => shown() && intro.isOpen(),
          // The gallery has no teardown, so each still gives its pixels back once drawn.
          render: (ui) => {
            intro.render(ui);
            intro.dispose();
          },
        },
      ];
    },
  };
}

const BEATS: readonly IntroBeat[] = ['floor', 'lock', 'slam', 'words', 'fade'];

export const FIXTURES: readonly DialogFixture[] = LEVEL_IDS.flatMap((levelId) =>
  BEATS.map((beat) => introFixture(levelId, beat)),
);
