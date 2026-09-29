#!/usr/bin/env tsx
/**
 * The rule a placed interior prop's loot pays out under: broken props are
 * restored the next time a room is entered, but a prop pays out only the
 * first time it is broken. Checks three things against `TownMemory`
 * directly, the record a real room's `BuildingInteriorScene` builds from:
 *
 *  - a prop broken once drops loot, is restored after leaving and coming
 *    back (a freshly generated room, same `TownMemory`), and drops nothing
 *    when broken again;
 *  - a roll that comes up empty still marks the prop paid out, so a player
 *    cannot keep re-breaking it for another shot at the drop table;
 *  - a death rewind to a save taken before the first break makes the prop
 *    pay out again, the same as every other piece of `TownMemory`.
 *
 * Also watched fail once (see the comment above the third block) by
 * disabling the payout lookup, per the project's rule that a fix round
 * needs its own negative test.
 *
 *   npm run verify:interior-payout
 */

import { GameMap } from '../src/map/GameMap.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { createTownPlan, type BuildingKind } from '../src/map/town/townPlan.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { LootSystem } from '../src/systems/LootSystem.js';
import { TownInteriorPropDestructionSystem } from '../src/systems/TownInteriorPropDestructionSystem.js';
import {
  TownMemoryInteriorPayoutRecord,
  type InteriorPayoutRecord,
} from '../src/systems/InteriorPropInteractionSystem.js';
import {
  createTownMemory,
  captureTownMemory,
  restoreTownMemory,
  type TownMemory,
} from '../src/core/TownMemory.js';
import { TOWN_INTERIOR_PROPS } from '../src/sprites/art/townInterior/townInteriorProps.js';

let failures = 0;
function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(` FAIL  ${label}`);
  failures++;
}

const PLAN_SIZE = 5;
const plan = createTownPlan(PLAN_SIZE);
const GENERAL_STORE_FLOOR = 0;

function buildInterior(name: string, kind: BuildingKind, hasSafeRoom: boolean): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(kind, 0, name, hasSafeRoom);
  return map;
}

const generalStoreEntry = plan.buildings.find((b) => b.name === 'General Store');
if (generalStoreEntry === undefined) throw new Error('General Store was not in this plan');

/** Breaks every prop's own HP worth of swings against `target`, once. */
function breakTarget(
  map: GameMap,
  target: { readonly tile: { readonly x: number; readonly y: number }; readonly id: string },
  hp: number,
  destruction: TownInteriorPropDestructionSystem,
): void {
  const attacker = new HumanPlayer(target.tile.x, target.tile.y + 1, TILE_SIZE);
  attacker.facingX = 0;
  attacker.facingY = -1;
  destruction.setActivePlayer(attacker);
  const meleeRange = TILE_SIZE * 2;
  for (let swing = 0; swing < hp && !destruction.broken.has(target.id); swing++) {
    destruction.tryMeleeHit(attacker, meleeRange, 1);
  }
}

function findBreakable(map: GameMap) {
  const target = map.placedInteriorProps.find(
    (placed) => TOWN_INTERIOR_PROPS[placed.propId].destructible !== undefined,
  );
  if (target === undefined)
    throw new Error('General Store placed no breakable prop to test against');
  const spec = TOWN_INTERIOR_PROPS[target.propId].destructible;
  if (spec === undefined) throw new Error('unreachable — filtered above');
  return { target, spec };
}

// ── Part 1: pays out once, restored on re-entry, silent on re-break ────────

console.log('Break once, restore on re-entry, silent on re-break');
{
  const memory = createTownMemory();

  // First visit.
  const map1 = buildInterior(generalStoreEntry.name, generalStoreEntry.kind, false);
  const { target: target1, spec } = findBreakable(map1);
  const loot1 = new LootSystem(map1);
  const record1 = new TownMemoryInteriorPayoutRecord(
    memory,
    generalStoreEntry.name,
    GENERAL_STORE_FLOOR,
  );
  const destruction1 = new TownInteriorPropDestructionSystem(map1, loot1, record1);
  breakTarget(map1, target1, spec.hp, destruction1);
  check(destruction1.broken.has(target1.id), 'the first break registers');
  const firstDrop = loot1.captureCheckpoint().pendingLoots.length;
  check(firstDrop > 0, 'the first break drops loot (this prop pays coins by default)');

  // Leave and come back: a brand-new map (a room regenerates every entry)
  // built from the same layout, same `TownMemory`.
  const map2 = buildInterior(generalStoreEntry.name, generalStoreEntry.kind, false);
  const { target: target2 } = findBreakable(map2);
  check(target2.id === target1.id, "the prop's id is stable across regeneration");
  check(!map2.isWalkable(target2.tile.x, target2.tile.y), 'the prop is standing again on re-entry');

  const loot2 = new LootSystem(map2);
  const record2 = new TownMemoryInteriorPayoutRecord(
    memory,
    generalStoreEntry.name,
    GENERAL_STORE_FLOOR,
  );
  const destruction2 = new TownInteriorPropDestructionSystem(map2, loot2, record2);
  breakTarget(map2, target2, spec.hp, destruction2);
  check(
    destruction2.broken.has(target2.id),
    'the re-break still registers (art, sound, tile unblocks)',
  );
  check(
    map2.isWalkable(target2.tile.x, target2.tile.y),
    'the tile is walkable again after the re-break',
  );
  const secondDrop = loot2.captureCheckpoint().pendingLoots.length;
  check(secondDrop === 0, 'the re-break drops nothing — already paid out');
}

// ── Part 2: an empty roll still marks the prop paid out ────────────────────

console.log('\nAn empty first roll still marks the prop paid out');
{
  // Break every breakable instance in the General Store whose coin range can
  // land on zero (`coinsMin === 0`) and check each is marked paid out
  // regardless of what it actually rolled. With this many instances in one
  // store, at least one is certain to land empty — proving the mark happens
  // at the roll, not on a nonzero outcome, without leaning on a single
  // coin flip.
  const memory = createTownMemory();
  const map = buildInterior(generalStoreEntry.name, generalStoreEntry.kind, false);
  const loot = new LootSystem(map);
  const record = new TownMemoryInteriorPayoutRecord(
    memory,
    generalStoreEntry.name,
    GENERAL_STORE_FLOOR,
  );
  const destruction = new TownInteriorPropDestructionSystem(map, loot, record);
  const candidates = map.placedInteriorProps.filter(
    (placed) => TOWN_INTERIOR_PROPS[placed.propId].destructible?.coinsMin === 0,
  );
  check(candidates.length > 0, 'the General Store has at least one zero-capable breakable');

  let anyEmptyRoll = false;
  let allMarkedPaid = true;
  for (const placed of candidates) {
    const spec = TOWN_INTERIOR_PROPS[placed.propId].destructible;
    if (spec === undefined) continue;
    const beforeCount = loot.captureCheckpoint().pendingLoots.length;
    breakTarget(map, placed, spec.hp, destruction);
    const afterCount = loot.captureCheckpoint().pendingLoots.length;
    if (afterCount === beforeCount) anyEmptyRoll = true;
    if (!record.hasPaidOut(placed.id)) allMarkedPaid = false;
  }
  check(anyEmptyRoll, 'at least one of them rolled an empty drop');
  check(allMarkedPaid, 'every one of them is marked paid out, empty roll or not');
}

// ── Part 3: a death rewind to a save before the break pays it out again ────
//
// Watch this fail: replace `record.hasPaidOut(placed.id)` in
// `TownInteriorPropDestructionSystem.rollLoot` with `false` (disabling the
// payout lookup) and re-run — the rewind check below fails because the
// second break drops loot on top of the first, the exact double-pay this
// whole mechanism exists to prevent.

console.log('\nA death rewind to a save before the break pays it out again');
{
  const memory: TownMemory = createTownMemory();
  const map = buildInterior(generalStoreEntry.name, generalStoreEntry.kind, false);
  const { target, spec } = findBreakable(map);

  const checkpoint = captureTownMemory(memory);

  const loot1 = new LootSystem(map);
  const record: InteriorPayoutRecord = new TownMemoryInteriorPayoutRecord(
    memory,
    generalStoreEntry.name,
    GENERAL_STORE_FLOOR,
  );
  const destruction1 = new TownInteriorPropDestructionSystem(map, loot1, record);
  breakTarget(map, target, spec.hp, destruction1);
  check(destruction1.broken.has(target.id), 'the break registers before the rewind');
  check(record.hasPaidOut(target.id), 'the payout is recorded before the rewind');

  restoreTownMemory(memory, checkpoint);
  check(
    !record.hasPaidOut(target.id),
    'the rewind clears the payout, same as any other memory field',
  );

  // A fresh room (the death restart regenerates the floor) and a fresh
  // destruction system reading the now-rewound memory.
  const map2 = buildInterior(generalStoreEntry.name, generalStoreEntry.kind, false);
  const { target: target2 } = findBreakable(map2);
  const loot2 = new LootSystem(map2);
  const record2 = new TownMemoryInteriorPayoutRecord(
    memory,
    generalStoreEntry.name,
    GENERAL_STORE_FLOOR,
  );
  const destruction2 = new TownInteriorPropDestructionSystem(map2, loot2, record2);
  breakTarget(map2, target2, spec.hp, destruction2);
  check(destruction2.broken.has(target2.id), 'the break after the rewind registers');
  check(
    loot2.captureCheckpoint().pendingLoots.length > 0,
    'the break after the rewind pays out again',
  );
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)`);
if (failures > 0) process.exit(1);
