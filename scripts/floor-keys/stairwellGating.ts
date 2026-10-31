/**
 * The seals on a floor's stairwells, driven through `StairwellSystem` on a
 * stand-in map: a sealed stairwell never offers its exit without the key, a
 * crawler with the key starts the unseal scene instead, the scene's end opens
 * the way, and an opened stairwell stays open across a checkpoint. Counts on
 * the locked note are read from `FLOOR_KEYS`.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { stairwellKey } from '../../src/core/keys/floorKeys';
import { KeyRing } from '../../src/core/keys/KeyRing';
import type { StairwellTile } from '../../src/core/keys/keyRingState';
import { getLevelDef } from '../../src/levels';
import type { LevelId } from '../../src/levels/levelIds';
import { STAIRWELL_FOOTPRINT_SPAN } from '../../src/map/DungeonGenerator';
import {
  HUNTED_NOTICE_TEXT,
  StairwellSystem,
  type StairwellSealRing,
  type UnsealRequest,
} from '../../src/systems/StairwellSystem';
import { announce, keyHarness, type Check, type FloorKeysSection } from './shared';
import { SpatialGrid } from '../../src/core/world/SpatialGrid';
import type { Mob } from '../../src/creatures/Mob';
import { Rat } from '../../src/creatures/Rat';
import { partyIsInDanger } from '../../src/systems/interactionPromptGate';
import type { StairwellStyleId } from '../../src/sprites/art/stairwellArt';

/** A floor whose stairwells lead down, and the floor that ends the run. */
const DESCEND_FLOOR: LevelId = 'tutorial';
const RUN_END_FLOOR: LevelId = 'level3';
const STAIRWELL: StairwellTile = { x: 10, y: 10 };
/** A tile clear of the stairwell, to step off onto. */
const BESIDE: StairwellTile = { x: 4, y: 4 };

const STAND_IN_MAP = {
  stairwellTiles: [STAIRWELL],
  isStairwellTile: (tx: number, ty: number): boolean =>
    tx >= STAIRWELL.x &&
    tx < STAIRWELL.x + STAIRWELL_FOOTPRINT_SPAN &&
    ty >= STAIRWELL.y &&
    ty < STAIRWELL.y + STAIRWELL_FOOTPRINT_SPAN,
};

function standingOn(tile: StairwellTile): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

interface Rig {
  readonly stairwell: StairwellSystem;
  readonly locked: number[];
  readonly unseals: UnsealRequest[];
  readonly runEnds: number[];
  readonly prewarmed: StairwellStyleId[];
  /** Whether something is hunting the party; flipped by a check to stand in for the scene's danger test. */
  readonly danger: { hunted: boolean };
}

function rigOn(levelId: LevelId, ring: StairwellSealRing): Rig {
  const locked: number[] = [];
  const unseals: UnsealRequest[] = [];
  const runEnds: number[] = [];
  const prewarmed: StairwellStyleId[] = [];
  const danger = { hunted: false };
  const stairwell = new StairwellSystem(
    STAND_IN_MAP,
    getLevelDef(levelId),
    { onDescend: () => undefined, onRunEnd: () => runEnds.push(1), onExitOffered: () => undefined },
    () => 1,
    {
      ring,
      onLocked: () => locked.push(1),
      onUnseal: (request) => unseals.push(request),
      keyDock: () => null,
      prewarmOpening: (style) => prewarmed.push(style),
      isSafeToUnseal: () => !danger.hunted,
    },
  );
  return { stairwell, locked, unseals, runEnds, prewarmed, danger };
}

/** Steps off the stairs and back on, as a crawler walking onto them does. */
function stepOn(stairwell: StairwellSystem): void {
  stairwell.detect(standingOn(BESIDE));
  stairwell.detect(standingOn(STAIRWELL));
}

/** Claims every fragment of the floor's stairwell key and forges it through the key system. */
function forgeStairwellKey(levelId: LevelId): KeyRing {
  const harness = keyHarness(levelId);
  for (const fragment of stairwellKey(levelId).fragments) announce(harness.bus, fragment.source);
  while (harness.keys.beginMoment() !== null) harness.keys.endMoment();
  return harness.ring;
}

function stairwellKeyNeeded(levelId: LevelId): number {
  return stairwellKey(levelId).fragments.length;
}

function sealedWithoutKey(check: Check): void {
  const rig = rigOn(DESCEND_FLOOR, new KeyRing(DESCEND_FLOOR));
  stepOn(rig.stairwell);
  check(!rig.stairwell.menuOpen, 'a sealed stairwell offers no descent without the key');
  check(rig.unseals.length === 0, 'a sealed stairwell does not start opening without the key');
  check(rig.locked.length === 1, 'stepping onto it rattles the seal once');
  const needed = stairwellKeyNeeded(DESCEND_FLOOR);
  check(
    rig.stairwell.sealedNotice === `Sealed: 0 of ${needed} fragments`,
    `the note counts the floor key's fragments from the ring ("${rig.stairwell.sealedNotice ?? 'none'}")`,
  );
  rig.stairwell.detect(standingOn(STAIRWELL));
  check(rig.locked.length === 1, 'standing on the seal does not rattle it again');
  stepOn(rig.stairwell);
  check(rig.locked.length === 1, 'stepping straight back on waits out the cooldown');
  check(!rig.stairwell.menuOpen, 'a second try still offers no descent');
}

function unsealsWithKey(check: Check): KeyRing {
  const ring = forgeStairwellKey(DESCEND_FLOOR);
  check(ring.canUnsealStairwells(), "the forged key opens the floor's stairwells");
  const rig = rigOn(DESCEND_FLOOR, ring);
  stepOn(rig.stairwell);
  check(rig.unseals.length === 1, 'stepping on with the key starts the unseal scene');
  check(
    rig.unseals[0]?.tile.x === STAIRWELL.x && rig.unseals[0].tile.y === STAIRWELL.y,
    'the scene opens the stairwell stepped on',
  );
  check(!rig.stairwell.menuOpen, 'the descent waits for the scene to end');
  check(rig.locked.length === 0, 'a crawler with the key hears no rattle');
  stepOn(rig.stairwell);
  check(rig.unseals.length === 1, 'the scene is not started twice while it plays');
  check(!ring.isUnsealed(STAIRWELL), 'the seal stays shut until the scene ends');
  const opened = rig.stairwell.completeUnseal(standingOn(STAIRWELL));
  check(opened !== null && ring.isUnsealed(STAIRWELL), "the scene's end marks the stairwell open");
  check(rig.stairwell.menuOpen, "the scene's end offers the descent at once");
  check(
    opened?.kind === ring.stairwellOpener(),
    'the scene announces the forged key that opened it',
  );
  check(rig.prewarmed.length > 0, "the seal's opening poses are asked for before the scene plays");
  return ring;
}

function refusedWhileHunted(check: Check): void {
  const rig = rigOn(DESCEND_FLOOR, forgeStairwellKey(DESCEND_FLOOR));
  rig.danger.hunted = true;
  stepOn(rig.stairwell);
  check(rig.unseals.length === 0, 'the unseal does not start while the party is hunted');
  check(!rig.stairwell.menuOpen, 'a hunted party is not offered the descent either');
  check(
    rig.stairwell.sealedNotice === HUNTED_NOTICE_TEXT,
    `the seal says why it waits ("${rig.stairwell.sealedNotice ?? 'none'}")`,
  );
  check(rig.locked.length === 0, 'a seal refused for danger does not rattle as if locked');
  rig.stairwell.updateSeals(standingOn(STAIRWELL));
  check(rig.unseals.length === 0, 'it keeps waiting while the hunt goes on');
  rig.danger.hunted = false;
  rig.stairwell.updateSeals(standingOn(STAIRWELL));
  check(rig.unseals.length === 1, 'it opens by itself once calm, for a crawler still on it');

  const left = rigOn(DESCEND_FLOOR, forgeStairwellKey(DESCEND_FLOOR));
  left.danger.hunted = true;
  stepOn(left.stairwell);
  left.stairwell.updateSeals(standingOn(BESIDE));
  left.danger.hunted = false;
  left.stairwell.updateSeals(standingOn(BESIDE));
  check(left.unseals.length === 0, 'a crawler who walked off is not pulled into the scene');
  stepOn(left.stairwell);
  check(left.unseals.length === 1, 'their next step on, once calm, starts it');
}

/** A boss in its room before its fight has begun: in the world, but nobody's foe yet. */
class AwaitingItsFight extends Rat {
  protected override get awaitingItsFight(): boolean {
    return true;
  }
}

/** Tiles between the seal and the hunters the danger check is asked about: well inside its reach. */
const HUNTER_DISTANCE_TILES = 3;
const DANGER_REACH_TILES = 12;

function dangerAround(hunter: Mob): boolean {
  const prey = new Rat(0, 0, TILE_SIZE);
  hunter.currentTarget = prey;
  const grid = new SpatialGrid<Mob>(TILE_SIZE);
  grid.insert(hunter);
  const seal = standingOn(STAIRWELL);
  return partyIsInDanger([hunter], grid, [], seal, DANGER_REACH_TILES * TILE_SIZE);
}

function awaitingBossDoesNotBlock(check: Check): void {
  // A creature is placed by tile.
  const nearTile = STAIRWELL.x + HUNTER_DISTANCE_TILES;
  const hunter = new Rat(nearTile, STAIRWELL.y, TILE_SIZE);
  check(dangerAround(hunter), 'a hunting hostile near the seal counts as danger');
  const waiting = new AwaitingItsFight(nearTile, STAIRWELL.y, TILE_SIZE);
  check(!dangerAround(waiting), 'a boss still waiting for its fight does not keep the seal shut');
}

function knockedOffDuringTheScene(check: Check): void {
  const ring = forgeStairwellKey(DESCEND_FLOOR);
  const rig = rigOn(DESCEND_FLOOR, ring);
  stepOn(rig.stairwell);
  rig.stairwell.completeUnseal(standingOn(BESIDE));
  check(ring.isUnsealed(STAIRWELL), 'a crawler knocked off the stairs still leaves them open');
  check(!rig.stairwell.menuOpen, 'a crawler knocked off the stairs is not offered the descent');
  rig.stairwell.detect(standingOn(STAIRWELL));
  check(rig.stairwell.menuOpen, 'their next step onto the open stairs offers the descent');
}

function staysOpenAcrossCheckpoint(check: Check, opened: KeyRing): void {
  const rewound = new KeyRing(DESCEND_FLOOR);
  rewound.restore(opened.capture());
  const rig = rigOn(DESCEND_FLOOR, rewound);
  stepOn(rig.stairwell);
  check(rig.stairwell.menuOpen, 'after a checkpoint the opened stairwell offers the descent');
  check(rig.unseals.length === 0, 'after a checkpoint the opened stairwell plays no scene again');
}

function runEndFloorUnseals(check: Check): void {
  const sealed = rigOn(RUN_END_FLOOR, new KeyRing(RUN_END_FLOOR));
  stepOn(sealed.stairwell);
  check(sealed.runEnds.length === 0, 'the run-end stairwell does not end the run while sealed');
  const rig = rigOn(RUN_END_FLOOR, forgeStairwellKey(RUN_END_FLOOR));
  stepOn(rig.stairwell);
  check(
    rig.unseals.length === 1 && rig.runEnds.length === 0,
    'the run-end seal opens with its scene first',
  );
  rig.stairwell.completeUnseal(standingOn(STAIRWELL));
  check(rig.runEnds.length === 1, "the run-end seal's scene hands straight on to the run's end");
}

const stairwellGating: FloorKeysSection = {
  name: 'a sealed stairwell opens only with the key, through its scene',
  run(check) {
    sealedWithoutKey(check);
    const opened = unsealsWithKey(check);
    staysOpenAcrossCheckpoint(check, opened);
    knockedOffDuringTheScene(check);
    refusedWhileHunted(check);
    awaitingBossDoesNotBlock(check);
    runEndFloorUnseals(check);
  },
};

export const stairwellSections: readonly FloorKeysSection[] = [stairwellGating];
