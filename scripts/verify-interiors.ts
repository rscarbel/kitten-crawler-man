#!/usr/bin/env tsx
/**
 * Headless checks on the town's interior content: every building's occupants,
 * its named residents, the service behind its counter, and the things left
 * lying around to read.
 *
 * These are all cross-registry checks, and every one of them guards a failure
 * that is *invisible in the game*. A service keyed to a role nobody in that room
 * has is a counter with nobody behind it — the player walks up and the only
 * thing that happens is nothing. A resident whose home names a building that
 * does not exist simply never appears. None of that throws, none of it logs, and
 * none of it shows up in a screenshot.
 *
 * The rooms are laid out by `createTownPlan`, so the building names come from
 * the plan rather than being restated here: a rename that breaks a quest breaks
 * this too, which is the point (see docs/town.md, "Names are load-bearing").
 *
 * Run: npx tsx scripts/verify-interiors.ts
 */

import { createTownPlan } from '../src/map/town/townPlan';
import type { BuildingKind } from '../src/map/town/townPlan';
import { GameMap } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';
import { BUILDING_OCCUPANTS, InteriorOccupantSystem } from '../src/systems/InteriorOccupantSystem';
import { InteriorReadableSystem } from '../src/systems/InteriorReadableSystem';
import { allResidents, residentById } from '../src/systems/townResidents';
import { interiorServiceBuildings, interiorServiceFor } from '../src/systems/townServices';
import { readableBuildings, readablesFor } from '../src/systems/townReadables';

/** Any size that produces the full plan; nothing here reads the wilderness. */
const PLAN_SIZE = 220;

/**
 * Kinds that run their own scripted interior rather than the ambient
 * occupant/service/readable stack — the club has its stations, the tower has
 * its stairs and its boss.
 */
const SCRIPTED_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['club', 'tower']);

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(` FAIL  ${label}`);
  failures++;
}

const plan = createTownPlan(PLAN_SIZE);
const buildings = new Map(plan.buildings.map((b) => [b.name, b.kind]));
const towerName = plan.tower.name;
buildings.set(towerName, plan.tower.kind);

console.log(`\nTown plan: ${buildings.size} buildings\n`);

console.log('Occupant rosters');
for (const [name] of BUILDING_OCCUPANTS) {
  check(buildings.has(name), `"${name}" has an occupant roster and is a real building`);
}

console.log('\nNamed residents');
for (const resident of allResidents()) {
  check(buildings.has(resident.home), `${resident.name} lives in a building that exists`);
  const roster = BUILDING_OCCUPANTS.get(resident.home) ?? [];
  const spec = roster.find((occupant) => occupant.residentId === resident.id);
  check(spec !== undefined, `${resident.name} is stationed in ${resident.home}`);
  if (spec !== undefined) {
    check(spec.role === resident.role, `${resident.name}'s roster role matches their def`);
  }
  check(resident.ambient.length > 0, `${resident.name} has ambient lines to fall back on`);
  check(resident.lore.length > 0, `${resident.name} has at least one lore conversation`);
  check(
    resident.lore.every((conversation) => conversation.length > 0),
    `${resident.name}'s lore conversations all have pages`,
  );
}

console.log('\nResident ids used by the rosters');
for (const [name, roster] of BUILDING_OCCUPANTS) {
  for (const occupant of roster) {
    if (occupant.residentId === undefined) continue;
    // Throws rather than returning null on an unknown id, which is what we want
    // to catch here — the roster is the only place an id is written by hand.
    const resident = residentById(occupant.residentId);
    check(resident.home === name, `${resident.name} is rostered in their own home (${name})`);
  }
}

console.log('\nRegistry keys name real buildings');
// Walked from the registry side as well as the building side. Asking each
// building what it offers can only ever find services and readables that are
// keyed correctly — a misspelled key is simply never visited, and the whole
// section goes green having measured nothing at all.
const serviceKeys = interiorServiceBuildings();
const readableKeys = readableBuildings();
check(serviceKeys.length > 0, 'the service registry is not empty');
check(readableKeys.length > 0, 'the readable registry is not empty');
for (const name of serviceKeys) {
  check(buildings.has(name), `service key "${name}" is a real building`);
}
for (const name of readableKeys) {
  check(buildings.has(name), `readable key "${name}" is a real building`);
}

console.log('\nServices');
for (const [name, kind] of buildings) {
  const service = interiorServiceFor(name);
  if (service === undefined) continue;
  check(!SCRIPTED_KINDS.has(kind), `"${name}" is not a scripted interior`);
  const roster = BUILDING_OCCUPANTS.get(name) ?? [];
  const staff = roster.filter((occupant) => occupant.role === service.role);
  // Exactly one, not at least one. `tryTalkToOccupant` matches the service by
  // role, so a second occupant of the same role in the same room is a stranger
  // who sells the resident's goods anonymously — no name, no barks, no story.
  check(staff.length === 1, `"${name}" stations exactly one ${service.role} to run its counter`);
  // `some`, not `every`: `[].every()` is true, so an unstaffed counter would
  // print a FAIL for the line above and then a cheerful ok for this one.
  check(
    staff.some((occupant) => occupant.residentId !== undefined),
    `"${name}"'s ${service.role} is a named resident rather than an extra`,
  );
  check(service.verb.length > 0, `"${name}"'s service has an interact verb`);
}

console.log('\nReadables');
for (const name of readableKeys) {
  // Driven from the registry rather than from every building, so the section
  // reports on the rooms that actually hold something instead of printing a
  // reassuring ok for each of the dozen that hold nothing.
  const readables = readablesFor(name);
  const ids = new Set(readables.map((readable) => readable.id));
  check(ids.size === readables.length, `"${name}"'s readables have distinct ids`);
  for (const readable of readables) {
    check(readable.body.length > 0, `"${readable.title}" has something written on it`);
  }
}

console.log('\nReadables fit in the rooms they are authored for');
// The registry saying a building has a letter is not the same as the generated
// room having somewhere to put it: `InteriorReadableSystem` drops a readable it
// cannot seat, silently, and the room simply has nothing in it. This is the only
// check here that builds a real interior.
for (const name of readableKeys) {
  const kind = buildings.get(name);
  if (kind === undefined) continue;
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(kind, 0, name);
  const occupants = InteriorOccupantSystem.forBuilding(map, kind, name);
  const system = InteriorReadableSystem.forBuilding(
    map,
    name,
    occupants?.occupiedFurniture ?? new Set(),
  );
  check(system !== null, `"${name}" has furniture its readables can sit on`);
  check(
    system?.placedCount === readablesFor(name).length,
    `"${name}" seats every readable it is authored`,
  );
}

console.log('\nEvery walk-in building has something to do');
for (const [name, kind] of buildings) {
  if (SCRIPTED_KINDS.has(kind)) continue;
  const roster = BUILDING_OCCUPANTS.get(name) ?? [];
  const hasResident = roster.some((occupant) => occupant.residentId !== undefined);
  const hasService = interiorServiceFor(name) !== undefined;
  const hasReadable = readablesFor(name).length > 0;
  check(
    hasResident || hasService || hasReadable,
    `"${name}" offers a resident, a service or something to read`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll interior checks passed.\n');
