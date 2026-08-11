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

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { createTownPlan } from '../src/map/town/townPlan';
import type { BuildingKind } from '../src/map/town/townPlan';
import { GameMap, TOWER_FLOOR_COUNT } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';
import { VOID_TYPE } from '../src/map/tileTypes';
import { renderCanvas, renderDecorationsOverlay } from '../src/map/TileRenderer';
import {
  planSafeRoomCounters,
  stampSafeRoomCounters,
  widestFreeSpan,
} from '../src/map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout';
import {
  ANCHOR_TILE_TYPES,
  BUILDING_OCCUPANTS,
  InteriorOccupantSystem,
  scanInteriorFurniture,
} from '../src/systems/InteriorOccupantSystem';
import type { AnchorKind } from '../src/systems/InteriorOccupantSystem';
import { BIG_TOP_ENTRY_NAME, BIG_TOP_ENTRY_KIND } from '../src/map/OverworldGenerator';
import { InteriorReadableSystem } from '../src/systems/InteriorReadableSystem';
import { allResidents, residentById } from '../src/systems/townResidents';
import { interiorServiceBuildings, interiorServicesFor } from '../src/systems/townServices';
import { readableBuildings, readablesFor } from '../src/systems/townReadables';
import { STAT_BOON_BONUSES } from '../src/core/StatusEffect';
import { statusVisual } from '../src/sprites/status/statusEffectVisuals';
import { EventBus } from '../src/core/EventBus';
import { createMurderQuestProgress } from '../src/core/MurderQuestProgress';
import { createDoomsdayProgress } from '../src/core/DoomsdayProgress';
import { QuillConfrontationSystem } from '../src/systems/QuillConfrontationSystem';
import { MISS_QUILL_CAST_RANGE_TILES } from '../src/creatures/MissQuill';
import { CITY_ELF_CULTIST_AGGRO_RANGE_TILES } from '../src/creatures/CityElfCultist';
import { QUEST_BANNER_FRAMES } from '../src/ui/QuestBanners';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { MIN_STAT_VALUE } from '../src/Player';
import { partyLevelOf } from '../src/levels/spawner';
import type { Mob } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';

/** Any size that produces the full plan; nothing here reads the wilderness. */
const PLAN_SIZE = 220;

/**
 * Kinds that run their own scripted interior rather than the ambient
 * occupant/service/readable stack — the club has its stations, the tower has
 * its stairs and its boss.
 */
const SCRIPTED_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['club', 'tower']);

/** The floor a walk-in gives you; only the tower has any others. */
const TOWER_GROUND_FLOOR = 0;

/**
 * Enterable interiors the town plan does not list, with the kind their building
 * entry is pushed with.
 *
 * The circus sits outside the walls and its entries are added by the overworld
 * generator rather than by `createTownPlan`, so walking the plan alone would
 * never open the Big Top's door — and its interior is the largest in the game.
 *
 * Name and kind are imported from `OverworldGenerator` rather than restated
 * here, so a rename or re-kind of the Big Top's building entry there — as
 * long as the push site keeps using these same constants — propagates
 * automatically instead of quietly dropping the Big Top out of the
 * reachability gate below. "The Big Top walk-in matches what the overworld
 * actually generates" (above) checks that the push site does keep using them.
 */
const WALK_INS_OUTSIDE_THE_PLAN: ReadonlyArray<readonly [string, BuildingKind]> = [
  [BIG_TOP_ENTRY_NAME, BIG_TOP_ENTRY_KIND],
];

/** Bytes per pixel in the `ImageData` the hole scan reads. */
const RGBA_STRIDE = 4;
/** Offset of the alpha byte within one such pixel. */
const ALPHA_OFFSET = 3;

/**
 * Painted fraction below which a tile counts as a hole rather than as art.
 *
 * Near-total rather than merely high. A prop that failed to paint its ground is
 * only transparent where its own art does not reach, so a board or a larder that
 * fills most of its tile hides the fault from a lenient threshold while still
 * showing the player a black frame around itself. Every interior tile has ground
 * under it, so full coverage is the real invariant; the slack is for the odd
 * antialiased pixel at a sprite's edge.
 */
const MIN_TILE_COVERAGE = 0.99;

/** The magistrate's office, and the only storey the Quill confrontation spawns on. */
const TOWER_CONFRONTATION_FLOOR = TOWER_FLOOR_COUNT - 1;
/**
 * How far past its own threat range the confrontation has to spawn from the tile
 * the party climbs in on.
 *
 * Nothing in the room has a windup — every caster in it can loose its first bolt
 * on the frame it acquires a target — and a companion locked to the game's
 * minimum constitution dies to any one of those bolts, which turns the whole
 * party out of the tower before the fight is visible. So the arrival tile is not
 * allowed to be merely outside the ranges: it has to be outside them by more
 * than the encounter's own guards can drift while they idle.
 */
const ARRIVAL_SAFETY_MARGIN_TILES = 2;
/** How long the party is left standing on the landing, doing nothing at all. */
const ARRIVAL_VIGIL_FRAMES = 60 * 20;

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
/** Named rather than derived from a kind, exactly as the town plan states it. */
const safeRoomBuildings = new Set(
  plan.buildings.filter((b) => b.hasSafeRoom === true).map((b) => b.name),
);

/**
 * A generated interior in the state the player walks into: the room the map
 * builds, plus the safe-room fittings the scene stamps afterwards. A check that
 * skipped the stamping pass would be inspecting a room nobody ever sees.
 */
function buildInterior(name: string, kind: BuildingKind, floor: number): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  const hasSafeRoom = safeRoomBuildings.has(name);
  map.generateInterior(kind, floor, name, hasSafeRoom);
  if (hasSafeRoom) {
    stampSafeRoomCounters(map);
    stampSafeRoomDecor(map);
  }
  return map;
}

/** Every storey a walk-in of this kind generates; only the tower has more than one. */
function floorCount(kind: BuildingKind): number {
  return kind === 'tower' ? TOWER_FLOOR_COUNT : 1;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The four steps a walker can take between tiles; interiors have no diagonal moves. */
const CARDINAL_STEPS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/**
 * Every walkable tile the player cannot walk to from where they spawn, as
 * `x,y` strings.
 *
 * The Bopca's galley strip is excluded, and only the galley strip: it is
 * walkable floor deliberately sealed by the counter's own side returns, which is
 * how the game keeps townsfolk and mobs out of the kitchen without special-casing
 * them anywhere. Everything else that is walkable is meant to be walked to.
 */
function unreachableWalkableTiles(map: GameMap): string[] {
  const sealedByCounter = new Set<string>();
  for (const layout of planSafeRoomCounters(map)) {
    for (const tile of layout.galleyTiles) sealedByCounter.add(tileKey(tile.x, tile.y));
  }

  const height = map.structure.length;
  const width = map.structure[0].length;
  const reached = new Set<string>();
  const start = map.startTile;
  if (map.isWalkable(start.x, start.y)) {
    const frontier = [start];
    reached.add(tileKey(start.x, start.y));
    while (frontier.length > 0) {
      const tile = frontier.pop();
      if (tile === undefined) break;
      for (const step of CARDINAL_STEPS) {
        const nx = tile.x + step.dx;
        const ny = tile.y + step.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const key = tileKey(nx, ny);
        if (reached.has(key) || !map.isWalkable(nx, ny)) continue;
        reached.add(key);
        frontier.push({ x: nx, y: ny });
      }
    }
  }

  const stranded: string[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!map.isWalkable(x, y)) continue;
      const key = tileKey(x, y);
      if (reached.has(key) || sealedByCounter.has(key)) continue;
      stranded.push(key);
    }
  }
  return stranded;
}

console.log(`\nTown plan: ${buildings.size} buildings\n`);

console.log('The Big Top walk-in matches what the overworld actually generates');
// `WALK_INS_OUTSIDE_THE_PLAN` is built from `BIG_TOP_ENTRY_NAME`/`BIG_TOP_ENTRY_KIND`,
// the same constants `OverworldGenerator` pushes the Big Top's building entry
// with, so they cannot drift from each other by construction — but that alone
// does not prove the generator actually produced an entry matching them. This
// generates a real overworld and checks the entry it produced directly, so a
// bug that broke the *value* the generator writes (not just a rename) would
// still be caught here.
{
  const overworld = new GameMap({
    mapSize: PLAN_SIZE,
    mapType: 'overworld',
    tileHeight: TILE_SIZE,
  });
  const bigTopEntry = overworld.buildingEntries.find((entry) => entry.name === BIG_TOP_ENTRY_NAME);
  check(
    bigTopEntry !== undefined,
    `the overworld generates a "${BIG_TOP_ENTRY_NAME}" building entry`,
  );
  check(
    bigTopEntry?.type === BIG_TOP_ENTRY_KIND,
    `"${BIG_TOP_ENTRY_NAME}"'s generated entry is a "${BIG_TOP_ENTRY_KIND}"`,
  );
}

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
  const services = interiorServicesFor(name);
  if (services.length === 0) continue;
  check(!SCRIPTED_KINDS.has(kind), `"${name}" is not a scripted interior`);
  // Two counters in one room must not name the same role. The talk router picks
  // the service by the role of the NPC the player walked up to, so a duplicate
  // leaves one of the two counters permanently unreachable — and nothing in the
  // game says so: the player walks up and the wrong menu opens.
  const roles = new Set(services.map((service) => service.role));
  check(roles.size === services.length, `"${name}"'s services all name different roles`);
  const roster = BUILDING_OCCUPANTS.get(name) ?? [];
  for (const service of services) {
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
    check(service.verb.length > 0, `"${name}"'s ${service.role} service has an interact verb`);
  }
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
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);
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

console.log('\nNo interior tile renders as a hole');
// A prop paints the floor it was stamped over before it paints itself, and the
// palette it paints that floor through is chosen per tile type. A palette with
// no material for the floor type underneath draws *nothing at all* and leaves a
// transparent tile, which the game shows as a solid black square behind the
// prop. Nothing throws and nothing logs, so the only way to catch it is to
// render the room and look at the pixels.
//
// The safe-room buildings matter most — their furnishings were authored against
// the dungeon's palette and now stand on town floors — but every room is cheap
// to check and any of them can grow the same fault.
await loadGameSpritesInNode();
for (const [name, kind] of buildings) {
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);

  const tilesW = map.structure[0].length;
  const tilesH = map.structure.length;
  const canvas = createCanvas(tilesW * TILE_SIZE, tilesH * TILE_SIZE);
  // node-canvas implements the same drawing surface the game's renderers are
  // written against, but not the DOM's `CanvasRenderingContext2D` nominal type.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const viewW = tilesW * TILE_SIZE;
  const viewH = tilesH * TILE_SIZE;
  renderCanvas(ctx, map.structure, TILE_SIZE, 0, 0, viewW, viewH);
  renderDecorationsOverlay(ctx, map.structure, TILE_SIZE, 0, 0, viewW, viewH);

  const pixels = canvas.getContext('2d').getImageData(0, 0, viewW, viewH).data;
  const holes: string[] = [];
  for (let ty = 0; ty < tilesH; ty++) {
    for (let tx = 0; tx < tilesW; tx++) {
      const type = map.structure[ty][tx].type;
      if (type === VOID_TYPE) continue;
      let painted = 0;
      for (let py = 0; py < TILE_SIZE; py++) {
        const rowStart = ((ty * TILE_SIZE + py) * viewW + tx * TILE_SIZE) * RGBA_STRIDE;
        for (let px = 0; px < TILE_SIZE; px++) {
          if (pixels[rowStart + px * RGBA_STRIDE + ALPHA_OFFSET] > 0) painted++;
        }
      }
      const coverage = painted / (TILE_SIZE * TILE_SIZE);
      if (coverage < MIN_TILE_COVERAGE) holes.push(`${tx},${ty} (type ${type})`);
    }
  }
  check(holes.length === 0, `"${name}" paints ground under every tile — ${holes.join(' ')}`);
}

console.log('\nEvery walkable tile is reachable from the spawn');
// The single most important check here. A partition wall that seals a wing
// produces no error, no log and no visible symptom at all — just a room the
// player can see across and never walk into. Nothing else in the game measures
// this, and every hand-authored interior is one misplaced wall away from it.
for (const [name, kind] of [...buildings, ...WALK_INS_OUTSIDE_THE_PLAN]) {
  for (let floor = 0; floor < floorCount(kind); floor++) {
    const map = buildInterior(name, kind, floor);
    const stranded = unreachableWalkableTiles(map);
    const where = kind === 'tower' ? `"${name}" floor ${floor}` : `"${name}"`;
    check(stranded.length === 0, `${where} reaches every walkable tile — ${stranded.join(' ')}`);
  }
}

console.log('\nCounter door avoidance');
// The archway-seal check below is an outcome assertion: it only ever inspects
// the run `planSafeRoomCounters` actually lays on the inn's current geometry,
// so a regression in the avoidance logic itself would pass silently as long as
// that one building's doors happen to sit away from where a naive centring
// would put the run anyway. This exercises `widestFreeSpan` — the function
// that excludes door columns from the candidate span — directly, with bounds
// built so a naive centre-of-the-room run would land squarely on a "door".
{
  const ADVERSARIAL_BOUNDS = { x: 0, y: 0, w: 12, h: 5 };
  // The room's usable span (after the wall margin) is columns 1..10: a naive
  // centring with no door logic at all would put a run across the middle of
  // that span, which is exactly where this column sits.
  const DOOR_COLUMN_AT_NAIVE_CENTRE = 5;
  const span = widestFreeSpan(ADVERSARIAL_BOUNDS, new Set([DOOR_COLUMN_AT_NAIVE_CENTRE]));
  const spanCoversDoorColumn =
    DOOR_COLUMN_AT_NAIVE_CENTRE >= span.x0 && DOOR_COLUMN_AT_NAIVE_CENTRE < span.x0 + span.width;
  check(span.width > 0, 'widestFreeSpan finds a usable span around a blocked column');
  check(!spanCoversDoorColumn, 'widestFreeSpan excludes a door column from the span it returns');
  // Also pins the "widest", not merely "some", free span: splitting the usable
  // range at column 5 leaves a 4-wide span to its west and a 5-wide span to
  // its east, and the mechanism is supposed to prefer the larger one.
  check(span.width === 5, 'widestFreeSpan picks the wider of the two spans the block leaves');
}

console.log('\nThe safe room');
check(safeRoomBuildings.size === 1, 'exactly one building hosts the town safe room');
for (const name of safeRoomBuildings) {
  const kind = buildings.get(name);
  if (kind === undefined) {
    check(false, `"${name}" claims the safe room and is a real building`);
    continue;
  }
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);
  check(map.safeRooms.length > 0, `"${name}" registers a safe room in its interior`);

  const layouts = planSafeRoomCounters(map);
  check(layouts.length > 0, `"${name}"'s safe room is wide enough for the Bopca's counter`);
  for (const layout of layouts) {
    const bounds = layout.roomBounds;
    const runTiles = [...layout.backTiles, ...layout.counterTiles, ...layout.galleyTiles];
    const escapes = runTiles.filter(
      (tile) =>
        tile.x < bounds.x ||
        tile.x >= bounds.x + bounds.w ||
        tile.y < bounds.y ||
        tile.y >= bounds.y + bounds.h,
    );
    // The wall row carrying the archways is the row immediately north of the
    // bounds, so a run that reaches outside them is standing in the doorway.
    check(
      escapes.length === 0,
      `"${name}"'s counter run stays inside its safe room — ${escapes.map((t) => tileKey(t.x, t.y)).join(' ')}`,
    );

    // The run is solid apart from its galley strip, and it is laid against the
    // bounds' north wall — the same wall the archways to the rest of the
    // building are cut through. A run laid across one of them walls off
    // everything on the far side, and the only symptom is an upstairs the
    // player can never reach.
    const solidRunTiles = new Set(
      [...layout.backTiles, ...layout.counterTiles].map((tile) => tileKey(tile.x, tile.y)),
    );
    const sealedArchways: string[] = [];
    const archwayRow = bounds.y - 1;
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!map.isWalkableIgnoringPermanent(x, archwayRow)) continue;
      if (solidRunTiles.has(tileKey(x, bounds.y))) sealedArchways.push(tileKey(x, archwayRow));
    }
    check(
      sealedArchways.length === 0,
      `"${name}"'s counter run seals no archway into the safe room — ${sealedArchways.join(' ')}`,
    );
  }
}

console.log("\nFurniture scan matches the placer's own border");
// `scanInteriorFurniture` is the exact function `InteriorOccupantSystem` places
// occupants from, reused here rather than re-walked, so the two cannot drift
// apart on where the border sits. This proves the exclusion directly — furniture
// stamped on the outermost ring must not appear in the scan — rather than only
// ever observing it on interiors where no anchor tile happens to reach the wall.
{
  const [sampleName, sampleKind] = [...buildings][0];
  const map = buildInterior(sampleName, sampleKind, TOWER_GROUND_FLOOR);
  const countTiles = (byKind: Map<AnchorKind, { x: number; y: number }[]>): number =>
    [...byKind.values()].reduce((sum, tiles) => sum + tiles.length, 0);

  const before = countTiles(scanInteriorFurniture(map));
  const borderTile = map.structure[0][0];
  const originalBorderType = borderTile.type;
  borderTile.type = ANCHOR_TILE_TYPES[0].types[0];
  const after = countTiles(scanInteriorFurniture(map));
  borderTile.type = originalBorderType;

  check(after === before, 'furniture stamped on the grid border is not counted by the scan');
}

console.log('\nEvery roster occupant finds furniture to stand at');
// `forBuilding` drops an occupant whose anchor group matched nothing, with no
// warning of any kind: the NPC simply is not in the room. That is how three
// taverns lost their innkeepers once, and how a cottage lost its resident again
// during this rework — both found by hand, neither by anything automatic.
for (const [name, roster] of BUILDING_OCCUPANTS) {
  const kind = buildings.get(name);
  if (kind === undefined) continue;
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);

  // Scanned through the same helper `InteriorOccupantSystem` uses rather than
  // walking `map.structure` directly: the placer excludes the outer ring of
  // border tiles, so a wider scan here would pass furniture stamped on the
  // border that the placer itself will never find.
  const furnitureByKind = new Map<AnchorKind, number>();
  for (const [anchorKind, tiles] of scanInteriorFurniture(map)) {
    furnitureByKind.set(anchorKind, tiles.length);
  }
  const anchorsWanted = new Set(roster.map((occupant) => occupant.anchor));
  for (const anchor of anchorsWanted) {
    check(
      (furnitureByKind.get(anchor) ?? 0) > 0,
      `"${name}" holds ${anchor} furniture for the occupant anchored to it`,
    );
  }

  const system = InteriorOccupantSystem.forBuilding(map, kind, name);
  check(
    system?.people.length === roster.length,
    `"${name}" places all ${roster.length} of its rostered occupants`,
  );
}

console.log('\nEvery anchor kind is used by somebody');
// An anchor kind nobody anchors to is furniture the placer will never look for,
// and the loop above can only check the kinds a roster names — so an anchor that
// fell out of every roster would leave both sides of the pairing unmeasured.
for (const { kind: anchorKind } of ANCHOR_TILE_TYPES) {
  const rostered = [...BUILDING_OCCUPANTS.values()].some((roster) =>
    roster.some((occupant) => occupant.anchor === anchorKind),
  );
  check(rostered, `some building's roster anchors an occupant to ${anchorKind} furniture`);
}

console.log('\nStat boons present themselves as boons');
// An unregistered status falls back to a grey *harmful* pill, so a boon the
// player paid coins for would show in the HUD as though it were a poison.
check(STAT_BOON_BONUSES.size > 0, 'there is at least one stat boon to check');
for (const [type, bonuses] of STAT_BOON_BONUSES) {
  const visual = statusVisual(type);
  check(visual !== undefined, `the "${type}" boon has a registered status visual`);
  check(visual?.harmful === false, `the "${type}" boon is not painted as something to fear`);
  check(
    Object.values(bonuses).some((amount) => amount !== 0),
    `the "${type}" boon actually moves a stat`,
  );
}

console.log('\nEvery walk-in building has something to do');
for (const [name, kind] of buildings) {
  if (SCRIPTED_KINDS.has(kind)) continue;
  const roster = BUILDING_OCCUPANTS.get(name) ?? [];
  const hasResident = roster.some((occupant) => occupant.residentId !== undefined);
  const hasService = interiorServicesFor(name).length > 0;
  const hasReadable = readablesFor(name).length > 0;
  check(
    hasResident || hasService || hasReadable,
    `"${name}" offers a resident, a service or something to read`,
  );
}

console.log('\nThe tower confrontation opens on safe ground');
{
  const map = buildInterior(towerName, plan.tower.kind, TOWER_CONFRONTATION_FLOOR);
  const stair = map._interiorStairDownTiles[0];
  check(stair !== undefined, 'the office has the stair the party climbs in on');

  // Mirrors how `BuildingInteriorScene` places an ascending party: both crawlers
  // side by side, one row below the stair they arrived on.
  const arrivalRow = stair.y + 1;
  const human = new HumanPlayer(stair.x, arrivalRow, TILE_SIZE);
  const cat = new CatPlayer(stair.x + 1, arrivalRow, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  // The build this fight is hardest on, and the one it was reported broken from:
  // a crawler holding the game's minimum constitution has a health pool smaller
  // than a single soul bolt.
  cat.setBaseStat('constitution', MIN_STAT_VALUE);

  const roster = new MobRoster(map, new SpellSystem());
  const spawned: Mob[] = [];
  const progress = createMurderQuestProgress();
  progress.stage = 'confrontation';
  const confrontation = new QuillConfrontationSystem(
    map,
    new EventBus(),
    (mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    createDoomsdayProgress(),
    partyLevelOf(human.level, cat.level),
  );

  check(spawned.length > 0, 'the confrontation puts its culprits in the room');

  const threatRangeTiles = Math.max(
    MISS_QUILL_CAST_RANGE_TILES,
    CITY_ELF_CULTIST_AGGRO_RANGE_TILES,
  );
  const requiredTiles = threatRangeTiles + ARRIVAL_SAFETY_MARGIN_TILES;
  for (const mob of spawned) {
    const nearestCrawlerTiles =
      Math.min(
        Math.hypot(mob.x - human.x, mob.y - human.y),
        Math.hypot(mob.x - cat.x, mob.y - cat.y),
      ) / TILE_SIZE;
    check(
      nearestCrawlerTiles >= requiredTiles,
      `${mob.displayName} spawns ${nearestCrawlerTiles.toFixed(1)} tiles from the landing (needs ${requiredTiles})`,
    );
  }

  check(
    spawned.every((mob) => mob.aiHeld),
    'the room is frozen while its own intro banner is on screen',
  );

  const context: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  const mobLoop = new MobUpdateLoop();
  const humanStartHp = human.hp;
  const catStartHp = cat.hp;
  let releasedAtFrame = -1;
  for (let frame = 0; frame < ARRIVAL_VIGIL_FRAMES; frame++) {
    confrontation.update(context);
    mobLoop.update(context);
    for (const mob of roster.mobs) mob.tickTimers();
    if (releasedAtFrame < 0 && spawned.every((mob) => !mob.aiHeld)) releasedAtFrame = frame;
  }
  mobLoop.dispose();

  check(
    releasedAtFrame >= 0 && releasedAtFrame <= QUEST_BANNER_FRAMES,
    `the room wakes up when the banner clears (woke at frame ${releasedAtFrame})`,
  );
  // The party never moved and never swung: whatever happened to them here, they
  // had no way to answer, which is the whole complaint the offsets exist to fix.
  check(human.hp === humanStartHp, 'a party that stands still on the landing is not shot at');
  check(cat.hp === catStartHp, 'nor is the companion beside them');
  check(cat.isAlive, 'so the companion is still standing, and the party is not turned out');
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll interior checks passed.\n');
