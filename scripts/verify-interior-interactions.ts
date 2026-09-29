#!/usr/bin/env tsx
/**
 * Headless coverage for a building's interactables and its restored
 * breakability: examine/search/use dispatch through the scene's
 * `Conversation` handle, a placed prop's break (HP, unblock, loot falling
 * then auto-collecting, cue selection), a multi-tile prop breaking whole
 * under a swing and a blast, the merchandise-drops-nothing consequence, and a
 * room-by-room regression floor on breakable instance counts (watch the regression check fail once by disabling a kind's
 * `destructible` spec — see the comment above `BREAKABLE_FLOOR_BY_BUILDING`).
 *
 *   npm run verify:interior-interactions
 */

import { GameMap } from '../src/map/GameMap.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { createTownPlan, type BuildingKind } from '../src/map/town/townPlan.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { LootSystem } from '../src/systems/LootSystem.js';
import {
  TownInteriorPropDestructionSystem,
  footprintCentrePx,
  isBreakableInteriorProp,
  resolveDropsLoot,
} from '../src/systems/TownInteriorPropDestructionSystem.js';
import { MELEE_POINT_BLANK_RANGE } from '../src/systems/CombatSystem.js';
import {
  InteriorPropInteractionSystem,
  InMemoryInteriorPayoutRecord,
  type PlacedInteraction,
} from '../src/systems/InteriorPropInteractionSystem.js';
import { Conversation } from '../src/dialog/Conversation.js';
import { TOWN_INTERIOR_PROPS } from '../src/sprites/art/townInterior/townInteriorProps.js';
import {
  townInteriorGroundProps,
  townInteriorPropFigures,
} from '../src/systems/townInteriorPropFigures.js';
import { applyMovement, type MovementInput } from '../src/systems/GameLoopPhases.js';
import { InteriorOccupantSystem } from '../src/systems/InteriorOccupantSystem.js';
import {
  BREAK_REACTION_DURATION_FRAMES,
  BREAK_REACTION_GAP_FRAMES,
  InteriorBreakReactionBarks,
} from '../src/systems/InteriorBreakReactionBarks.js';

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

function buildInterior(name: string, kind: BuildingKind, hasSafeRoom: boolean): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(kind, 0, name, hasSafeRoom);
  return map;
}

// ── Breakables regression floor ─────────────────────────────────────────────
//
// One placed-prop instance per name/kind pair whose `destructible` field
// went missing would silently un-break a whole room's worth of barrels.
// Counted with `isBreakableInteriorProp`, the same predicate the destruction
// system resolves hits against, so a prop counted here is one a swing can
// actually break — whatever its footprint. Big built fixtures (forges, mill
// works, cabinets, altars, bunks, bars, hearths, wall racks and pegs) carry
// no `destructible` spec and never count.
// Floors below are measured counts; watch this fail by commenting out `destructible: DESTRUCTIBLE_BARREL`
// on `barrel`'s registry entry in `townInteriorProps.ts` and re-running.
const BREAKABLE_FLOOR_BY_BUILDING: Readonly<Partial<Record<string, number>>> = {
  'Blackwood Lodge': 4,
  'Plumbline Farm': 6,
  'The Barracks': 18,
  // A workshop of a few big built pieces, none of which break: its
  // breakables are the spoke tubs, the glue pot and the crates and barrels of
  // stores.
  "Cartwright's Workshop": 10,
  'Temple of the Sky': 8,
  'Herb & Remedy': 15,
  // Shelving, counter, tables and bins are built-in fittings with no
  // breakable spec; the store's breakables are its single-tile barrels,
  // sacks, baskets, crocks, tool barrels, crates and one storeroom shelf.
  'General Store': 20,
  'The Sleeping Cat Inn': 12,
  'The Horned Flagon': 3,
  // A ten-by-ten room of a few big pieces: its breakables are the crocks,
  // baskets, stores, the jar dresser and the worktable. The bed and the
  // herb-drying beam are fixtures — a bed frame no more smashes to kindling
  // than a barracks bunk, and the beam is hung from the wall — so they do
  // not count, which leaves the room at 22.
  "Old Hilda's Cottage": 22,
  // A smaller smithy built round a few big working pieces: its breakables
  // are the one-tile stock, stools, tubs and barrels around them.
  'The Rusty Anvil': 17,
  'The Sunken Stump Pub': 5,
  'The Quiet Needle': 9,
  "Miller's Farm": 12,
};

console.log('Breakables regression floor');
let totalBreakable = 0;
let generalStoreMap: GameMap | null = null;
for (const building of plan.buildings) {
  const map = buildInterior(building.name, building.kind, building.hasSafeRoom === true);
  if (building.name === 'General Store') generalStoreMap = map;
  const count = map.placedInteriorProps.filter(isBreakableInteriorProp).length;
  totalBreakable += count;
  const floor = BREAKABLE_FLOOR_BY_BUILDING[building.name];
  if (floor === undefined) continue;
  check(
    count >= floor,
    `"${building.name}" has at least ${floor} breakable prop(s) (found ${count})`,
  );
}
check(totalBreakable > 0, 'at least one building has a breakable prop');

if (generalStoreMap === null) throw new Error('General Store was not in this plan');

// ── Walkable props draw in the ground layer, never in the Y-sorted pass ────
//
// A rug sorted with the figures paints over anyone standing on its upper
// rows, since its sort line is its bottom row. Every walkable prop must come
// back from the ground-layer list and never from the sorted one.

console.log('\nWalkable props stay out of the Y-sorted pass');
{
  let walkablePlaced = 0;
  for (const building of plan.buildings) {
    const map = buildInterior(building.name, building.kind, building.hasSafeRoom === true);
    const sortedWalkable = townInteriorPropFigures(map).filter(
      (figure) => TOWN_INTERIOR_PROPS[figure.placed.propId].walkable,
    );
    const sortedWalkableIds = sortedWalkable.map((figure) => figure.placed.id).join(', ');
    check(
      sortedWalkable.length === 0,
      `"${building.name}" sorts no walkable prop with the figures` +
        (sortedWalkable.length === 0 ? '' : ` (found ${sortedWalkableIds})`),
    );
    const walkableHere = map.placedInteriorProps.filter(
      (placed) => TOWN_INTERIOR_PROPS[placed.propId].walkable,
    );
    walkablePlaced += walkableHere.length;
    const groundIds = new Set(townInteriorGroundProps(map).map((placed) => placed.id));
    check(
      walkableHere.every((placed) => groundIds.has(placed.id)),
      `"${building.name}" draws all ${walkableHere.length} walkable prop(s) in the ground layer`,
    );
  }
  // Without a single placed rug the two checks above pass vacuously.
  check(walkablePlaced > 0, `at least one room places a walkable prop (found ${walkablePlaced})`);
}

// ── Break flow: HP, unblock, loot falls then auto-collects, cues ───────────

console.log('\nBreak flow (General Store)');
{
  const map = generalStoreMap;
  const target = map.placedInteriorProps.find(isBreakableInteriorProp);
  if (target === undefined)
    throw new Error('General Store placed no breakable prop to test against');
  const spec = TOWN_INTERIOR_PROPS[target.propId].destructible;
  if (spec === undefined) throw new Error('unreachable — filtered above');

  const loot = new LootSystem(map);
  const destruction = new TownInteriorPropDestructionSystem(
    map,
    loot,
    new InMemoryInteriorPayoutRecord(),
  );
  // South of the prop, facing north, so the swing's forward-hemisphere test passes.
  const attacker = new HumanPlayer(target.tile.x, target.tile.y + 1, TILE_SIZE);
  attacker.facingX = 0;
  attacker.facingY = -1;
  destruction.setActivePlayer(attacker);

  check(!map.isWalkable(target.tile.x, target.tile.y), 'the prop blocks its tile before it breaks');
  check(destruction.broken.size === 0, 'nothing is broken yet');

  const swingDamage = 1;
  const meleeRange = TILE_SIZE * 2;
  let swings = 0;
  const maxSwings = spec.hp + 1;
  while (destruction.broken.size === 0 && swings < maxSwings) {
    destruction.tryMeleeHit(attacker, meleeRange, swingDamage);
    swings++;
  }
  check(
    swings === spec.hp,
    `the prop broke on its ${spec.hp}th hit (its own HP), took ${swings} swing(s)`,
  );
  check(destruction.broken.has(target.id), 'the broken instance is recorded by its stable id');
  check(map.isWalkable(target.tile.x, target.tile.y), 'the tile is walkable again once broken');

  const dropsLoot = resolveDropsLoot(target, spec);
  const pending = loot.captureCheckpoint().pendingLoots;
  if (dropsLoot) {
    check(pending.length <= 1, 'at most one loot pile was dropped for one break');
    if (pending.length === 1) {
      const pile = pending[0];
      check(pile.collectsOnLanding === true, 'the drop auto-collects once it lands, not before');
      check(
        pile.dropPieces !== undefined && pile.dropPieces.length > 0,
        'the drop has a fall animation — it does not appear already settled',
      );
    }
  }

  const breaks = destruction.drainBreaks();
  check(breaks.length === 1, 'the break is reported to the scene exactly once');
  // Must not throw with no AudioManager — the same as every other
  // audio-draining call site in a headless harness.
  destruction.playBreakCues(null, breaks);
  check(true, 'playBreakCues does not throw without an AudioManager');
}

// ── A multi-tile prop breaks whole, from any of its tiles ──────────────────
//
// A bench or a bin two tiles wide is one prop: a hit that reaches only its
// far end must still damage it, and its break must open every tile it
// covers while paying out, reporting and marking exactly once. Driven in a
// real room with a real placed instance, once by a swing whose reach covers
// only the footprint's far tile and once by a blast.

console.log('\nMulti-tile props break whole (swing and blast)');
{
  /** Past one tile's centre, short of the diagonal tile beside it (√2 tiles). */
  const ADJACENT_ONLY_REACH_TILES = 1.2;
  /** Reach that covers the tile in front of the attacker and nothing past it. */
  const ADJACENT_ONLY_REACH = MELEE_POINT_BLANK_RANGE * ADJACENT_ONLY_REACH_TILES;
  /** A blast that reaches only the footprint tile beside the stand, not the prop's origin. */
  const BLAST_RADIUS_TILES = 1.2;
  const BLAST_RADIUS = TILE_SIZE * BLAST_RADIUS_TILES;

  interface MultiTileCase {
    readonly buildingName: string;
    readonly placedId: string;
    readonly stand: { readonly x: number; readonly y: number };
    readonly facingY: number;
  }

  // The first real placement anywhere in town that is multi-tile, pays out a
  // guaranteed coin, and has open floor beside its far column to stand on.
  function findMultiTileCase(): MultiTileCase | null {
    for (const building of plan.buildings) {
      const map = buildInterior(building.name, building.kind, building.hasSafeRoom === true);
      for (const placed of map.placedInteriorProps) {
        const propDef = TOWN_INTERIOR_PROPS[placed.propId];
        const spec = propDef.destructible;
        if (spec === undefined) continue;
        const isMultiTile = propDef.footprint.w * propDef.footprint.h > 1;
        if (!isMultiTile || spec.coinsMin <= 0 || !resolveDropsLoot(placed, spec)) continue;
        const farColumn = placed.tile.x + propDef.footprint.w - 1;
        const south = { x: farColumn, y: placed.tile.y + propDef.footprint.h, facingY: -1 };
        const north = { x: farColumn, y: placed.tile.y - 1, facingY: 1 };
        for (const side of [south, north]) {
          if (!map.isWalkable(side.x, side.y)) continue;
          return {
            buildingName: building.name,
            placedId: placed.id,
            stand: { x: side.x, y: side.y },
            facingY: side.facingY,
          };
        }
      }
    }
    return null;
  }

  class CountingPayoutRecord extends InMemoryInteriorPayoutRecord {
    marks = 0;
    override markPaidOut(id: string): void {
      this.marks++;
      super.markPaidOut(id);
    }
  }

  const found = findMultiTileCase();
  check(found !== null, 'some room places a multi-tile breakable that pays out');
  if (found !== null) {
    const building = plan.buildings.find((b) => b.name === found.buildingName);
    if (building === undefined) throw new Error(`${found.buildingName} vanished from the plan`);

    const attacks: ReadonlyArray<{
      readonly label: string;
      readonly strike: (
        destruction: TownInteriorPropDestructionSystem,
        attacker: HumanPlayer,
      ) => void;
    }> = [
      {
        label: 'melee swing at the far tile',
        strike: (destruction, attacker) => {
          destruction.tryMeleeHit(attacker, ADJACENT_ONLY_REACH, 1);
        },
      },
      {
        label: 'dynamite blast',
        strike: (destruction, attacker) => {
          const blastX = attacker.x + TILE_SIZE / 2;
          const blastY = attacker.y + TILE_SIZE / 2;
          destruction.destroyInRadius(blastX, blastY, BLAST_RADIUS);
        },
      },
    ];

    for (const attack of attacks) {
      const map = buildInterior(building.name, building.kind, building.hasSafeRoom === true);
      const placed = map.placedInteriorProps.find((p) => p.id === found.placedId);
      if (placed === undefined) throw new Error(`${found.placedId} not placed on a rebuild`);
      const propDef = TOWN_INTERIOR_PROPS[placed.propId];
      const spec = propDef.destructible;
      if (spec === undefined) throw new Error('unreachable — chosen for its spec');
      const name = `${placed.propId} ${propDef.footprint.w}x${propDef.footprint.h} in "${building.name}", ${attack.label}`;

      const footprintTiles: Array<{ x: number; y: number }> = [];
      for (let dy = 0; dy < propDef.footprint.h; dy++)
        for (let dx = 0; dx < propDef.footprint.w; dx++)
          footprintTiles.push({ x: placed.tile.x + dx, y: placed.tile.y + dy });
      check(
        footprintTiles.every((tile) => !map.isWalkable(tile.x, tile.y)),
        `${name}: every footprint tile blocks before the break`,
      );

      const loot = new LootSystem(map);
      const record = new CountingPayoutRecord();
      const destruction = new TownInteriorPropDestructionSystem(map, loot, record);
      const attacker = new HumanPlayer(found.stand.x, found.stand.y, TILE_SIZE);
      attacker.facingX = 0;
      attacker.facingY = found.facingY;
      destruction.setActivePlayer(attacker);

      const pendingBefore = loot.captureCheckpoint().pendingLoots.length;
      const maxStrikes = spec.hp + 1;
      for (let strike = 0; strike < maxStrikes && !destruction.broken.has(placed.id); strike++) {
        attack.strike(destruction, attacker);
      }
      check(destruction.broken.has(placed.id), `${name}: the prop breaks`);
      check(
        footprintTiles.every((tile) => map.isWalkable(tile.x, tile.y)),
        `${name}: every footprint tile is walkable once broken`,
      );
      // Strikes after the break must not find a second prop in the rubble.
      attack.strike(destruction, attacker);
      attack.strike(destruction, attacker);
      const pendingAfter = loot.captureCheckpoint().pendingLoots.length;
      check(
        pendingAfter - pendingBefore === 1,
        `${name}: one loot pile dropped (found ${pendingAfter - pendingBefore})`,
      );
      const pilesAfter = loot.captureCheckpoint().pendingLoots;
      const pile = pilesAfter.length > 0 ? pilesAfter[pilesAfter.length - 1] : null;
      const centre = footprintCentrePx(placed);
      check(
        pile?.x === centre.x && pile.y === centre.y,
        `${name}: the loot lands at the footprint's centre`,
      );
      check(record.marks === 1, `${name}: the payout is marked once (found ${record.marks})`);
      check(record.hasPaidOut(placed.id), `${name}: the payout record holds the instance`);
      const breaks = destruction.drainBreaks().filter((brk) => brk.placed.id === placed.id);
      check(breaks.length === 1, `${name}: the break is reported once (found ${breaks.length})`);
    }
  }
}

// ── Broken debris never blocks: driven by real movement, not just isWalkable ─
//
// A pew broken in the Temple of the Sky once left rubble the player could
// not walk through, even though `isWalkable` said the tile was clear — the
// tile-type conversion these props replaced always opened the floor on a
// break, and an interior kind (`chair`) had been special-cased to stay
// blocking. Drives the same `applyMovement` the scene calls every frame,
// not the raw query, so a future regression in collision resolution itself
// (not just in `isWalkable`) would be caught here too.

console.log('\nBroken debris never blocks (real movement, not just isWalkable)');
{
  // The Temple of the Sky is where the reported bug actually happened (a
  // broken pew, which is the `chair` kind's only placement); the General
  // Store covers the junk/container kinds in the same pass.
  const KINDS_TO_CHECK: ReadonlyArray<{ readonly kind: string; readonly buildingName: string }> = [
    { kind: 'chair', buildingName: 'Temple of the Sky' },
    { kind: 'barrel', buildingName: 'General Store' },
    { kind: 'crate', buildingName: 'General Store' },
    { kind: 'shelf', buildingName: 'General Store' },
  ];
  const STEP_COUNT = 40;
  const move: MovementInput = { dx: 0, dy: 1, isMobile: false };

  for (const { kind, buildingName } of KINDS_TO_CHECK) {
    const entry = plan.buildings.find((b) => b.name === buildingName);
    if (entry === undefined) throw new Error(`${buildingName} was not in this plan`);
    const map = buildInterior(entry.name, entry.kind, false);
    const placed = map.placedInteriorProps.find(
      (candidate) => TOWN_INTERIOR_PROPS[candidate.propId].destructible?.kind === kind,
    );
    if (placed === undefined) {
      check(false, `"${buildingName}" places at least one breakable "${kind}" to drive through`);
      continue;
    }
    const spec = TOWN_INTERIOR_PROPS[placed.propId].destructible;
    if (spec === undefined) continue;

    const loot = new LootSystem(map);
    const destruction = new TownInteriorPropDestructionSystem(
      map,
      loot,
      new InMemoryInteriorPayoutRecord(),
    );
    const attacker = new HumanPlayer(placed.tile.x, placed.tile.y + 1, TILE_SIZE);
    attacker.facingX = 0;
    attacker.facingY = -1;
    destruction.setActivePlayer(attacker);
    for (let swing = 0; swing < spec.hp && !destruction.broken.has(placed.id); swing++) {
      destruction.tryMeleeHit(attacker, TILE_SIZE * 2, 1);
    }
    check(destruction.broken.has(placed.id), `the "${kind}" broke, ready to walk through`);

    // A fresh walker starting one tile north of the broken tile, driven
    // south by the scene's own movement function. The room may pack another
    // (legitimately solid) prop just beyond the one under test, so the
    // measure is "did the walker ever enter the broken tile's own row", not
    // "did it keep going forever" — the whole point is the one tile that
    // broke, not the room past it.
    const walker = new HumanPlayer(placed.tile.x, placed.tile.y - 1, TILE_SIZE);
    let deepestRowReached = Math.floor((walker.y + TILE_SIZE / 2) / TILE_SIZE);
    for (let step = 0; step < STEP_COUNT; step++) {
      applyMovement(walker, move, map, 'sole');
      const row = Math.floor((walker.y + TILE_SIZE / 2) / TILE_SIZE);
      if (row > deepestRowReached) deepestRowReached = row;
    }
    check(
      deepestRowReached >= placed.tile.y,
      `a walker can enter the broken "${kind}"'s own tile (row ${placed.tile.y}), reached row ${deepestRowReached}`,
    );
  }
}

// ── Merchandise consequence: an instance override always wins ──────────────

console.log('\nConsequences — shop merchandise drops nothing');
{
  const spec = { dropsLootByDefault: true };
  check(
    resolveDropsLoot({ dropsLoot: undefined }, spec),
    'no override falls back to the kind default (true)',
  );
  check(
    !resolveDropsLoot({ dropsLoot: false }, spec),
    'a merchandise placement (dropsLoot: false) overrides the default',
  );
  check(
    resolveDropsLoot({ dropsLoot: true }, { dropsLootByDefault: false }),
    'an override can also turn a junk-default prop into a payer',
  );
}

// ── Merchandise consequence, exercised against the real store ──────────────
//
// The check above only proves `resolveDropsLoot` itself is correct; it does
// not prove any actual layout entry sets the override. A real regression —
// the General Store's shelving and stock barrels placed with plain `prop()`,
// no `dropsLoot: false` — passed every other gate here because nothing read
// the room's own placed instances. This drives real melee swings against
// every instance the store's layout tags as merchandise and checks the coin
// drop is zero every time, not just that the pure function agrees with
// itself.

console.log('\nConsequences — every General Store merchandise instance actually pays nothing');
{
  const map = generalStoreMap;
  const loot = new LootSystem(map);
  const destruction = new TownInteriorPropDestructionSystem(
    map,
    loot,
    new InMemoryInteriorPayoutRecord(),
  );
  const merchandise = map.placedInteriorProps.filter((placed) => placed.dropsLoot === false);
  check(merchandise.length > 0, 'the General Store places at least one merchandise instance');

  let everyMerchandiseInstanceStayedSilent = true;
  for (const placed of merchandise) {
    const spec = TOWN_INTERIOR_PROPS[placed.propId].destructible;
    if (spec === undefined) continue;
    const attacker = new HumanPlayer(placed.tile.x, placed.tile.y + 1, TILE_SIZE);
    attacker.facingX = 0;
    attacker.facingY = -1;
    destruction.setActivePlayer(attacker);
    const before = loot.captureCheckpoint().pendingLoots.length;
    for (let swing = 0; swing < spec.hp && !destruction.broken.has(placed.id); swing++) {
      destruction.tryMeleeHit(attacker, TILE_SIZE * 2, 1);
    }
    const after = loot.captureCheckpoint().pendingLoots.length;
    if (after !== before) everyMerchandiseInstanceStayedSilent = false;
  }
  check(
    everyMerchandiseInstanceStayedSilent,
    'breaking every merchandise-tagged instance in the real store dropped no loot',
  );
}

// ── Search: first payout only ───────────────────────────────────────────────

console.log('\nSearch — first payout only, keyed by stable instance id');
{
  const record = new InMemoryInteriorPayoutRecord();
  check(!record.hasPaidOut('chest@1,1'), 'a fresh instance has not paid out');
  record.markPaidOut('chest@1,1');
  check(record.hasPaidOut('chest@1,1'), 'marking pays it out');
  check(!record.hasPaidOut('chest@2,2'), 'a different instance is unaffected');
}

// ── Examine/search/use dispatch, owned by the scene's Conversation handle ──

console.log('\nExamine/search/use dispatch');
{
  const map = generalStoreMap;
  const loot = new LootSystem(map);
  const conversation = new Conversation(null);
  const record = new InMemoryInteriorPayoutRecord();
  // The plain constructor rather than `forBuilding`, with synthetic targets
  // of the exported shape: the dispatch is exercised independent of which
  // rooms happen to place which interactables.
  const system = new InteriorPropInteractionSystem(map, record);
  const activePlayer = new HumanPlayer(0, 0, TILE_SIZE);

  // Arbitrary, distinct tiles for three synthetic targets — nothing reads
  // these positions, they only need to be different from one another.
  const EXAMINE_TARGET_TILE = 3;
  const SEARCH_TARGET_TILE = 4;
  const USE_TARGET_TILE = 5;

  const examineTarget: PlacedInteraction = {
    placed: {
      propId: 'jars',
      variant: 0,
      tile: { x: EXAMINE_TARGET_TILE, y: EXAMINE_TARGET_TILE },
      id: `jars@${EXAMINE_TARGET_TILE},${EXAMINE_TARGET_TILE}`,
      dropsLoot: undefined,
    },
    interaction: { kind: 'examine', id: 'jars' },
    x: EXAMINE_TARGET_TILE * TILE_SIZE,
    y: EXAMINE_TARGET_TILE * TILE_SIZE,
  };
  system.perform(examineTarget, conversation, loot, activePlayer, false);
  check(conversation.isOpen, 'examine opens the scene conversation');
  conversation.dismiss();
  check(!conversation.isOpen, 'dismissing closes it, same as any other beat');

  const searchTarget: PlacedInteraction = {
    placed: {
      propId: 'chest',
      variant: 0,
      tile: { x: SEARCH_TARGET_TILE, y: SEARCH_TARGET_TILE },
      id: `chest@${SEARCH_TARGET_TILE},${SEARCH_TARGET_TILE}`,
      dropsLoot: undefined,
    },
    interaction: { kind: 'search', id: 'chest' },
    x: SEARCH_TARGET_TILE * TILE_SIZE,
    y: SEARCH_TARGET_TILE * TILE_SIZE,
  };
  system.perform(searchTarget, conversation, loot, activePlayer, false);
  check(conversation.isOpen, 'search opens the scene conversation the first time');
  conversation.dismiss();
  const firstPending = loot.captureCheckpoint().pendingLoots.length;
  system.perform(searchTarget, conversation, loot, activePlayer, false);
  conversation.dismiss();
  const secondPending = loot.captureCheckpoint().pendingLoots.length;
  check(secondPending === firstPending, 'searching the same chest again drops no further loot');

  const useTarget: PlacedInteraction = {
    placed: {
      propId: 'shop_bell',
      variant: 0,
      tile: { x: USE_TARGET_TILE, y: USE_TARGET_TILE },
      id: `shop_bell@${USE_TARGET_TILE},${USE_TARGET_TILE}`,
      dropsLoot: undefined,
    },
    interaction: { kind: 'use', id: 'shop_bell' },
    x: USE_TARGET_TILE * TILE_SIZE,
    y: USE_TARGET_TILE * TILE_SIZE,
  };
  system.perform(useTarget, conversation, loot, activePlayer, false);
  check(conversation.isOpen, 'use opens the scene conversation');
  conversation.dismiss();
}

// ── Break reactions are a bubble, never the conversation box ───────────────
//
// A reaction that opened the shared Conversation stood in front of the fight
// and could not be walked away from. It must leave the box closed, hang over
// the occupant nearest the break, fade on its own, and let a burst of breaks
// earn one line rather than a wall of them.

console.log('\nBreak reactions (General Store)');
{
  const map = generalStoreMap;
  const occupants = InteriorOccupantSystem.forBuilding(map, 'store', 'General Store');
  const people = occupants?.people ?? [];
  check(people.length > 0, `the General Store has occupants to react (found ${people.length})`);
  const breakable = map.placedInteriorProps.filter(isBreakableInteriorProp);
  const reactionBreaks = breakable.flatMap((placed) => {
    const spec = TOWN_INTERIOR_PROPS[placed.propId].destructible;
    return spec === undefined ? [] : [{ placed, kind: spec.kind }];
  });
  if (reactionBreaks.length === 0) throw new Error('General Store placed no breakable prop');
  const firstBreak = reactionBreaks[0];

  const conversation = new Conversation(null);
  const reactions = new InteriorBreakReactionBarks();

  check(!reactions.react([firstBreak], []), 'an empty room does not react');
  check(reactions.react([firstBreak], people), 'an occupied room reacts to a break');
  check(!conversation.isOpen, 'the reaction leaves the conversation box closed');
  check(
    !conversation.overlayClaim().isOpen,
    'the reaction claims no overlay (no input lock, no world halt)',
  );

  const { x: breakX, y: breakY } = footprintCentrePx(firstBreak.placed);
  const distSq = (x: number, y: number): number => (x - breakX) ** 2 + (y - breakY) ** 2;
  const nearestDistSq = Math.min(...people.map((person) => distSq(person.x, person.y)));
  const shown = reactions.current;
  check(
    shown !== null && distSq(shown.speaker.x, shown.speaker.y) === nearestDistSq,
    'the line hangs over the occupant nearest the break',
  );

  check(reactionBreaks.length > 1, 'the store has more than one breakable to burst through');
  const burstReacted = reactionBreaks.slice(1).some((brk) => reactions.react([brk], people));
  check(!burstReacted, 'a burst of breaks while a line is up adds no second line');
  check(reactions.current?.text === shown?.text, 'the burst leaves the first line in place');

  for (let frame = 0; frame < BREAK_REACTION_DURATION_FRAMES; frame++) reactions.update();
  check(reactions.current === null, 'the line fades on its own');
  check(
    !reactions.react([firstBreak], people),
    'the room stays quiet through the gap after a line',
  );
  for (let frame = 0; frame < BREAK_REACTION_GAP_FRAMES; frame++) reactions.update();
  check(reactions.react([firstBreak], people), 'after the gap the room reacts again');
  check(!conversation.isOpen, 'still no conversation after a second reaction');
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)`);
if (failures > 0) process.exit(1);
