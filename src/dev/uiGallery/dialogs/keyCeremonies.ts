/**
 * Fixtures for the key ceremonies: a fragment's and the forge's, each
 * captured at every stage of its timeline, built from the floors' real key
 * tables so a changed fragment count or name shows up here.
 */

import { floorKey, issueLineFor } from '../../../core/keys/floorKeys';
import type { FragmentMoment, ForgeMoment } from '../../../core/keys/keyMoments';
import type { LevelId } from '../../../levels/levelIds';
import { forgeSubline } from '../../../systems/keys/KeyCeremonySystem';
import type { Surface } from '../../../ui/core/UiRoot';
import {
  FRAGMENT_BEATS,
  FRAGMENT_CONTINUE_GUARD_FRAMES,
} from '../../../ui/screens/keys/fragmentTimeline';
import { FORGE_BEATS, FORGE_CONTINUE_GUARD_FRAMES } from '../../../ui/screens/keys/forgeTimeline';
import { GoldenKeyForgeScreen } from '../../../ui/screens/keys/GoldenKeyForgeScreen';
import { KeyFragmentScreen } from '../../../ui/screens/keys/KeyFragmentScreen';
import { galleryGated } from './conversation';
import type { DialogFixture } from './fixture';

const GALLERY_KEY_KIND = 'golden';

/** The fragment moment for piece `index` of `levelId`'s key, with every earlier piece already held. */
function fragmentMoment(levelId: LevelId, index: number): FragmentMoment {
  const key = floorKey(levelId, GALLERY_KEY_KIND);
  if (key === null) throw new Error(`${levelId} has no key for the gallery`);
  const fragment = key.fragments.find((_, i) => i === index);
  if (fragment === undefined) throw new Error(`${levelId}'s key has no piece ${index}`);
  const needed = key.fragments.length;
  return {
    kind: 'fragment',
    fragment,
    keyKind: key.kind,
    index,
    held: index + 1,
    needed,
    heldMask: key.fragments.map((_, i) => i <= index),
    completesKey: index + 1 === needed,
    award: 'live',
    issueLine: issueLineFor(fragment, 'live'),
  };
}

function forgeMoment(levelId: LevelId): ForgeMoment {
  const key = floorKey(levelId, GALLERY_KEY_KIND);
  if (key === null) throw new Error(`${levelId} has no key for the gallery`);
  return { kind: 'forge', keyKind: key.kind, levelId, needed: key.fragments.length };
}

/** A capture this many frames past a beat shows the beat landing rather than the frame before it. */
const A_BEAT_IN = 6;
/** The orbit is captured this far through, when it is fast and tight. */
const ORBIT_LATE_SHARE = 0.75;

const HALFWAY = 0.5;

/** The frame `share` of the way from `from` to `to`. */
function partWay(from: number, to: number, share = HALFWAY): number {
  return Math.round(from + (to - from) * share);
}

/** Frames into the fragment ceremony worth judging, by stage. */
const FRAGMENT_STAGES = {
  slam: FRAGMENT_BEATS.slamAt + A_BEAT_IN,
  rise: partWay(FRAGMENT_BEATS.riseFrom, FRAGMENT_BEATS.revealAt),
  reveal: FRAGMENT_BEATS.revealAt + A_BEAT_IN,
  socket: partWay(FRAGMENT_BEATS.flyFrom, FRAGMENT_BEATS.lockAt),
  locked: FRAGMENT_BEATS.lockAt + A_BEAT_IN,
  /** Caroline's line still decoding: Continue waits for it. */
  typing: FRAGMENT_BEATS.settledAt,
  /** Every word on screen, the line finished by a press, and Continue past its guard. */
  settled: FRAGMENT_BEATS.settledAt + 1,
} as const;

/** Frames into the forge worth judging, by stage. */
const FORGE_STAGES = {
  summon: partWay(0, FORGE_BEATS.orbitFrom),
  orbit: partWay(FORGE_BEATS.orbitFrom, FORGE_BEATS.fuseAt, ORBIT_LATE_SHARE),
  closing: FORGE_BEATS.fuseAt - A_BEAT_IN,
  flash: FORGE_BEATS.fuseAt + A_BEAT_IN,
  key: partWay(FORGE_BEATS.fuseAt, FORGE_BEATS.titleAt),
  settled: FORGE_BEATS.settledAt + FORGE_CONTINUE_GUARD_FRAMES,
} as const;

function fragmentFixture(
  name: string,
  moment: FragmentMoment,
  frames: number,
  reducedMotion = false,
): DialogFixture {
  let screen: KeyFragmentScreen | null = null;
  const prepared = (): KeyFragmentScreen => {
    if (screen !== null) return screen;
    const created = new KeyFragmentScreen(
      null,
      () => undefined,
      () => reducedMotion,
    );
    created.open(moment);
    const reveal = Math.min(frames, FRAGMENT_BEATS.settledAt);
    for (let frame = 0; frame < reveal; frame++) created.tick();
    if (frames > FRAGMENT_BEATS.settledAt) {
      created.skip();
      for (let frame = 0; frame < FRAGMENT_CONTINUE_GUARD_FRAMES; frame++) created.tick();
    }
    screen = created;
    return created;
  };
  return {
    name,
    surfaces: (shown): readonly Surface[] => [
      galleryGated(prepared().surface(`keys-${name}`), shown),
    ],
  };
}

function forgeFixture(
  name: string,
  levelId: LevelId,
  frames: number,
  reducedMotion = false,
): DialogFixture {
  let screen: GoldenKeyForgeScreen | null = null;
  const prepared = (): GoldenKeyForgeScreen => {
    if (screen !== null) return screen;
    const created = new GoldenKeyForgeScreen(
      null,
      () => undefined,
      () => reducedMotion,
    );
    created.open({
      moment: forgeMoment(levelId),
      subline: forgeSubline(forgeMoment(levelId)),
    });
    for (let frame = 0; frame < frames; frame++) created.tick();
    screen = created;
    return created;
  };
  return {
    name,
    surfaces: (shown): readonly Surface[] => [
      galleryGated(prepared().surface(`keys-${name}`), shown),
    ],
  };
}

const FIRST_OF_TWO = fragmentMoment('level1', 0);
const LAST_OF_THREE = fragmentMoment('level3', 2);

export const FIXTURES: readonly DialogFixture[] = [
  ...Object.entries(FRAGMENT_STAGES).map(([stage, frames]) =>
    fragmentFixture(`key-fragment-${stage}`, FIRST_OF_TWO, frames),
  ),
  fragmentFixture('key-fragment-whole-settled', LAST_OF_THREE, FRAGMENT_STAGES.settled),
  fragmentFixture('key-fragment-whole-socket', LAST_OF_THREE, FRAGMENT_STAGES.socket),
  fragmentFixture('key-fragment-reduced-motion-socket', FIRST_OF_TWO, FRAGMENT_STAGES.socket, true),
  ...Object.entries(FORGE_STAGES).map(([stage, frames]) =>
    forgeFixture(`key-forge-${stage}`, 'level1', frames),
  ),
  forgeFixture('key-forge-town-square-settled', 'level3', FORGE_STAGES.settled),
  forgeFixture('key-forge-three-orbit', 'level3', FORGE_STAGES.orbit),
  forgeFixture('key-forge-reduced-motion-orbit', 'level1', FORGE_STAGES.orbit, true),
];
