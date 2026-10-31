/**
 * The key ring and the key system: what each fragment is issued for, replays,
 * the forge, the save, and reconciling a floor as it is built. Every
 * expectation is read from `FLOOR_KEYS`, never restated.
 */

import { fragmentsOnFloor, floorKeysFor, type FragmentSource } from '../../src/core/keys/floorKeys';
import { KeyRing } from '../../src/core/keys/KeyRing';
import { opensStairwells } from '../../src/core/keys/keyKinds';
import { parseKeyRingState } from '../../src/core/keys/keyRingState';
import { QUEST_IDS } from '../../src/core/quests/QuestManager';
import { LEVEL_IDS, type LevelId } from '../../src/levels/levelIds';
import { BOSS_ROOM_SIZE } from '../../src/map/bossRoomSizes';
import { STORY_BEAT_ORDER } from '../../src/story/storyBeatIds';
import {
  announce,
  doneDeedsFor,
  keyHarness,
  ledgerOf,
  type AnnouncedDeed,
  type FloorKeysSection,
} from './shared';

/** A floor whose key has more than one fragment and comes from bosses, for the replay check. */
const BOSS_FLOOR: LevelId = 'level1';
/** A floor whose key comes from story beats, for the reconcile check. */
const BEAT_FLOOR: LevelId = 'tutorial';
/** The floor whose key a carried quest can satisfy before the floor is ever built. */
const CARRIED_QUEST_FLOOR: LevelId = 'level3';
const STAIRWELL_TILE = { x: 12, y: 34 };
const OTHER_STAIRWELL_TILE = { x: 40, y: 8 };

function sameSource(a: AnnouncedDeed, b: FragmentSource): boolean {
  switch (b.kind) {
    case 'storyBeat':
      return a.kind === 'storyBeat' && a.beat === b.beat;
    case 'bossDefeated':
      return a.kind === 'bossDefeated' && a.boss === b.boss;
    case 'questCompleted':
      return a.kind === 'questCompleted' && a.questId === b.questId;
    default: {
      const unhandled: never = b;
      return unhandled;
    }
  }
}

/** Every deed the bus can announce: each beat, gauntlet boss and quest. */
const EVERY_DEED: readonly AnnouncedDeed[] = [
  ...STORY_BEAT_ORDER.map((beat): AnnouncedDeed => ({ kind: 'storyBeat', beat })),
  ...Object.keys(BOSS_ROOM_SIZE).map((boss): AnnouncedDeed => ({ kind: 'bossDefeated', boss })),
  ...QUEST_IDS.map((questId): AnnouncedDeed => ({ kind: 'questCompleted', questId })),
];

const issuedByTheirSources: FloorKeysSection = {
  name: 'each fragment is issued by its own source and nothing else',
  run(check) {
    for (const levelId of LEVEL_IDS) {
      const onFloor = fragmentsOnFloor(levelId);
      for (const fragment of onFloor) {
        const harness = keyHarness(levelId);
        announce(harness.bus, fragment.source);
        const heldIds = onFloor.filter((f) => harness.ring.holds(f.id)).map((f) => f.id);
        check(
          heldIds.length === 1 && heldIds[0] === fragment.id,
          `${levelId}: ${fragment.id}'s source issues it alone (held: ${heldIds.join(', ') || 'none'})`,
        );
        const moment = harness.keys.nextMoment();
        check(
          moment?.kind === 'fragment' && moment.fragment.id === fragment.id,
          `${levelId}: ${fragment.id} queues its own ceremony`,
        );
        check(harness.claimed.length === 1, `${levelId}: ${fragment.id} is announced once`);
      }

      const harness = keyHarness(levelId);
      const unrelated = EVERY_DEED.filter(
        (deed) => !onFloor.some((fragment) => sameSource(deed, fragment.source)),
      );
      for (const deed of unrelated) announce(harness.bus, deed);
      check(
        harness.ring.view().heldOnFloor === 0 && !harness.keys.hasPendingMoment(),
        `${levelId}: none of ${unrelated.length} other deeds, other floors' sources among them, issues a fragment`,
      );
    }
  },
};

const replayedDeedIssuesOnce: FloorKeysSection = {
  name: 'a replayed deed does not issue its fragment twice',
  run(check) {
    const [first] = fragmentsOnFloor(BOSS_FLOOR);
    if (first === undefined) {
      check(false, `${BOSS_FLOOR} has a fragment to replay`);
      return;
    }
    const harness = keyHarness(BOSS_FLOOR);
    announce(harness.bus, first.source);
    harness.keys.beginMoment();
    harness.keys.endMoment();
    announce(harness.bus, first.source);
    check(harness.ring.view().heldOnFloor === 1, `${first.id} is held once after a replay`);
    check(harness.claimed.length === 1, `${first.id} is announced once after a replay`);
    check(!harness.keys.hasPendingMoment(), `a replay queues no second ceremony for ${first.id}`);
  },
};

const lastFragmentQueuesForge: FloorKeysSection = {
  name: 'the last fragment queues the forge, and the forge happens as it opens',
  run(check) {
    for (const levelId of LEVEL_IDS) {
      for (const key of floorKeysFor(levelId)) {
        const harness = keyHarness(levelId);
        for (const fragment of key.fragments) announce(harness.bus, fragment.source);
        const kinds: string[] = [];
        let completes = 0;
        let forgedWhileQueued = false;
        for (
          let moment = harness.keys.nextMoment();
          moment !== null;
          moment = harness.keys.nextMoment()
        ) {
          if (moment.kind === 'forge') forgedWhileQueued = harness.ring.isForged(key.kind);
          const begun = harness.keys.beginMoment();
          if (begun?.kind === 'fragment' && begun.completesKey) completes++;
          kinds.push(begun?.kind ?? 'none');
          harness.keys.endMoment();
        }
        const expected = [...key.fragments.map(() => 'fragment'), 'forge'];
        check(
          kinds.join(',') === expected.join(','),
          `${levelId}: ${key.fragments.length} fragment ceremonies then a forge (${kinds.join(', ')})`,
        );
        check(completes === 1, `${levelId}: exactly the last fragment completes the key`);
        check(!forgedWhileQueued, `${levelId}: the key is not forged before its ceremony opens`);
        check(harness.ring.isForged(key.kind), `${levelId}: the forge ceremony forges the key`);
        check(harness.forged.length === 1, `${levelId}: keyForged fires once`);
        check(
          harness.ring.canUnsealStairwells() === opensStairwells(key.kind),
          `${levelId}: a forged key unseals the stairwells exactly when its kind opens them`,
        );
        check(
          harness.ring.moments.takeStairwellReveal() === opensStairwells(key.kind),
          `${levelId}: a live forge owes the floor its stairwell exactly when its kind opens them`,
        );
        check(
          !harness.ring.moments.takeStairwellReveal(),
          `${levelId}: and owes it once, not again when asked twice`,
        );
      }
    }
  },
};

/** A ring on `levelId` with its key forged and one stairwell unsealed. */
function forgedRingWithOpenSeal(levelId: LevelId): KeyRing {
  const harness = keyHarness(levelId);
  harness.keys.reconcile(ledgerOf({}));
  for (const fragment of fragmentsOnFloor(levelId)) announce(harness.bus, fragment.source);
  while (harness.keys.beginMoment() !== null) harness.keys.endMoment();
  harness.ring.markUnsealed(STAIRWELL_TILE);
  return harness.ring;
}

const unsealedSurvivesRoundTrip: FloorKeysSection = {
  name: 'an unsealed stairwell stays unsealed across a checkpoint and a save',
  run(check) {
    const ring = forgedRingWithOpenSeal(BOSS_FLOOR);
    const checkpoint = ring.capture();

    const rewound = new KeyRing(BOSS_FLOOR);
    rewound.restore(checkpoint);
    check(rewound.isUnsealed(STAIRWELL_TILE), 'a checkpoint restore keeps the opened seal');
    check(!rewound.isUnsealed(OTHER_STAIRWELL_TILE), 'a checkpoint restore opens no other seal');

    const stored: unknown = JSON.parse(JSON.stringify(checkpoint));
    const parsed = parseKeyRingState(stored);
    check(parsed !== undefined, 'a saved ring parses');
    if (parsed === undefined) return;
    const reloaded = new KeyRing(BOSS_FLOOR);
    reloaded.restore(parsed);
    check(reloaded.isUnsealed(STAIRWELL_TILE), 'a reload keeps the opened seal');
    check(reloaded.canUnsealStairwells(), 'a reload keeps the forged key');

    const harness = keyHarness(BOSS_FLOOR, reloaded);
    harness.keys.reconcile(ledgerOf({}));
    check(reloaded.isUnsealed(STAIRWELL_TILE), 'reconciling never closes an opened seal');
  },
};

const strictParser: FloorKeysSection = {
  name: 'a stored ring that does not describe a real one is rejected',
  run(check) {
    const good = forgedRingWithOpenSeal(BOSS_FLOOR).capture();
    const [fragment] = fragmentsOnFloor(BOSS_FLOOR);
    const [foreign] = fragmentsOnFloor(BEAT_FLOOR);
    if (fragment === undefined || foreign === undefined) {
      check(false, 'both floors have fragments to corrupt a ring with');
      return;
    }
    const rejected: readonly [string, unknown][] = [
      ['an unknown fragment', { ...good, held: [...good.held, 'level1_nonexistent'] }],
      ['a fragment held twice', { ...good, held: [...good.held, fragment.id] }],
      ['a fragment from another floor', { ...good, held: [...good.held, foreign.id] }],
      ['a key forged with a piece missing', { ...good, held: good.held.slice(1) }],
      ['a seal opened with no key', { ...good, forged: [] }],
      ['an unknown key kind', { ...good, forged: ['not_a_key_kind'] }],
      ['an unknown floor', { ...good, levelId: 'level9' }],
      ['a missing field', { ...good, floorBuilt: undefined }],
    ];
    for (const [what, value] of rejected) {
      check(parseKeyRingState(value) === undefined, `the parser rejects ${what}`);
    }
  },
};

const reconcileOnBuild: FloorKeysSection = {
  name: 'building a floor claims, silently, every fragment whose deed is already done',
  run(check) {
    const [first, ...rest] = fragmentsOnFloor(BEAT_FLOOR);
    if (first === undefined) {
      check(false, `${BEAT_FLOOR} has a fragment to reconcile`);
      return;
    }
    const saved = keyHarness(BEAT_FLOOR);
    saved.keys.reconcile(ledgerOf({}));
    const lastSave = saved.ring.capture();

    const reloaded = keyHarness(BEAT_FLOOR);
    reloaded.ring.restore(lastSave);
    reloaded.keys.reconcile(ledgerOf(doneDeedsFor([first.source])));
    check(
      reloaded.ring.holds(first.id),
      `${first.id}, done after the last save, is claimed on build`,
    );
    check(
      !reloaded.keys.hasPendingMoment() && reloaded.claimed.length === 0,
      'the claim plays no ceremony and announces nothing',
    );

    const whole = keyHarness(BEAT_FLOOR);
    whole.ring.restore(lastSave);
    whole.keys.reconcile(ledgerOf(doneDeedsFor([first.source, ...rest.map((f) => f.source)])));
    const key = floorKeysFor(BEAT_FLOOR)[0];
    check(
      key !== undefined && whole.ring.isForged(key.kind) && whole.forged.length === 0,
      'a key reconciled whole is forged silently',
    );
    check(whole.ring.capture().unsealedStairwells.length === 0, 'reconciling opens no seal');
    check(
      !whole.ring.moments.takeStairwellReveal(),
      'a key forged silently on build owes no announced stairwell',
    );
  },
};

const firstBuildOfAFloor: FloorKeysSection = {
  name: "a floor's first build issues a carried quest live and a preset's deeds silently",
  run(check) {
    const carriedFragment = fragmentsOnFloor(CARRIED_QUEST_FLOOR).find(
      (fragment) => fragment.carriedIssueLine !== undefined,
    );
    if (carriedFragment === undefined) {
      check(false, `${CARRIED_QUEST_FLOOR} has a fragment with a line for a carried deed`);
      return;
    }
    check(
      carriedFragment.source.kind === 'questCompleted',
      `${carriedFragment.id}, the fragment with a carried line, comes from a quest`,
    );
    const arrival = keyHarness(CARRIED_QUEST_FLOOR);
    arrival.keys.reconcile(ledgerOf(doneDeedsFor([carriedFragment.source])));
    const moment = arrival.keys.nextMoment();
    check(
      moment?.kind === 'fragment' &&
        moment.fragment.id === carriedFragment.id &&
        moment.award === 'carriedIn',
      `a quest done before ${CARRIED_QUEST_FLOOR} was first built issues ${carriedFragment.id} with a ceremony`,
    );
    check(
      moment?.kind === 'fragment' && moment.issueLine === carriedFragment.carriedIssueLine,
      "the carried award uses the fragment's carried line",
    );

    check(
      !arrival.ring.holds(carriedFragment.id) && arrival.claimed.length === 0,
      'the carried fragment is not claimed until its ceremony opens',
    );

    const arrivalSave = keyHarness(CARRIED_QUEST_FLOOR);
    arrivalSave.ring.restore(arrival.ring.capture());
    arrivalSave.keys.reconcile(ledgerOf(doneDeedsFor([carriedFragment.source])));
    const owedAfterReload = arrivalSave.keys.nextMoment();
    check(
      owedAfterReload?.kind === 'fragment' &&
        owedAfterReload.fragment.id === carriedFragment.id &&
        owedAfterReload.award === 'carriedIn',
      'a save written before the ceremony opens still owes it after a reload',
    );

    arrival.keys.beginMoment();
    check(
      arrival.ring.holds(carriedFragment.id) && arrival.ring.floorBuilt,
      'opening the ceremony claims the fragment and records the floor as built',
    );
    check(arrival.claimed.length === 1, 'the carried fragment is announced as its ceremony opens');

    const reload = keyHarness(CARRIED_QUEST_FLOOR);
    const withoutTheClaim = { ...arrival.ring.capture(), held: [] };
    reload.ring.restore(withoutTheClaim);
    reload.keys.reconcile(ledgerOf(doneDeedsFor([carriedFragment.source])));
    check(
      reload.ring.holds(carriedFragment.id) && !reload.keys.hasPendingMoment(),
      'a later build of the same floor claims it silently',
    );

    const preset = keyHarness(BOSS_FLOOR);
    preset.keys.reconcile(
      ledgerOf(doneDeedsFor(fragmentsOnFloor(BOSS_FLOOR).map((fragment) => fragment.source))),
    );
    check(
      preset.ring.view().heldOnFloor === fragmentsOnFloor(BOSS_FLOOR).length &&
        !preset.keys.hasPendingMoment(),
      `bosses a preset marked dead before ${BOSS_FLOOR} was first built are claimed silently`,
    );
  },
};

const floorChange: FloorKeysSection = {
  name: "arriving on a floor drops the last floor's key and seals",
  run(check) {
    const ring = forgedRingWithOpenSeal(BOSS_FLOOR);
    ring.beginFloor(BOSS_FLOOR);
    check(
      ring.view().heldOnFloor === 0 && !ring.canUnsealStairwells() && ring.floorBuilt,
      'a restart of the same floor drops its fragments and keeps its built record',
    );
    const descended = forgedRingWithOpenSeal(BOSS_FLOOR);
    const next: LevelId = 'level2';
    descended.beginFloor(next);
    check(
      descended.levelId === next &&
        descended.view().heldOnFloor === 0 &&
        !descended.isUnsealed(STAIRWELL_TILE) &&
        !descended.floorBuilt,
      'the stairs leave every fragment, key and seal behind',
    );
  },
};

const carriedPieceTellsTheKeyInOrder: FloorKeysSection = {
  name: 'a carried piece claimed behind live ones tells the key in the order it is shown',
  run(check) {
    const onFloor = fragmentsOnFloor(CARRIED_QUEST_FLOOR);
    const carried = onFloor.find((fragment) => fragment.carriedIssueLine !== undefined);
    if (carried === undefined) {
      check(false, `${CARRIED_QUEST_FLOOR} has a fragment with a line for a carried deed`);
      return;
    }
    const harness = keyHarness(CARRIED_QUEST_FLOOR);
    harness.keys.reconcile(ledgerOf(doneDeedsFor([carried.source])));
    for (const fragment of onFloor) {
      if (fragment.id !== carried.id) announce(harness.bus, fragment.source);
    }
    const shown: string[] = [];
    const counts: number[] = [];
    let completes = 0;
    let lastFragmentCompletes = false;
    for (let moment = harness.keys.beginMoment(); moment !== null;) {
      shown.push(moment.kind);
      if (moment.kind === 'fragment') {
        counts.push(moment.held);
        if (moment.completesKey) completes++;
        lastFragmentCompletes = moment.completesKey;
      }
      harness.keys.endMoment();
      moment = harness.keys.beginMoment();
    }
    const expected = [...onFloor.map(() => 'fragment'), 'forge'];
    check(
      shown.join(',') === expected.join(','),
      `every fragment ceremony plays before the forge (${shown.join(', ')})`,
    );
    const climbing = counts.every((held, place) => held === place + 1);
    check(climbing, `each ceremony counts one more piece than the last (${counts.join(', ')})`);
    check(
      completes === 1 && lastFragmentCompletes,
      'only the last fragment shown calls the key whole',
    );
    check(
      harness.ring.moments.takeStairwellReveal(),
      "the forge a carried piece made due still owes the floor's stairwell",
    );
  },
};

export const ringSections: readonly FloorKeysSection[] = [
  issuedByTheirSources,
  replayedDeedIssuesOnce,
  lastFragmentQueuesForge,
  unsealedSurvivesRoundTrip,
  strictParser,
  reconcileOnBuild,
  firstBuildOfAFloor,
  carriedPieceTellsTheKeyInOrder,
  floorChange,
];
