#!/usr/bin/env tsx
/**
 * Headless checks for `PartyTools`: starter-tool idempotency, an in-place
 * upgrade that keeps its slot in both the bag and the hotbar, the re-add
 * fallback when a crawler has lost its tool, reconciliation of stray or
 * duplicate tiers, and the saved-state parser's tolerance of garbage input.
 *
 * Run: npx tsx scripts/verify-party-tools.ts
 */
import { TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { createPartyToolsState, parsePartyToolsState, PartyTools } from '../src/core/PartyTools';
import { MAX_TOOL_TIER, TOOL_TIER_RATKIN_FORGE, toolTierDef } from '../src/core/toolTiers';

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

function newCrawlers(): { human: HumanPlayer; cat: CatPlayer } {
  return {
    human: new HumanPlayer(0, 0, TILE_SIZE),
    cat: new CatPlayer(0, 0, TILE_SIZE),
  };
}

// ── Starter tools ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();

  tools.grantStarterTools(human, cat);
  check(state.axeTier === 0, 'grantStarterTools sets axeTier to 0');
  check(state.pickaxeTier === 0, 'grantStarterTools sets pickaxeTier to 0');
  check(human.inventory.countOf('basic_axe') === 1, 'human bag holds one basic axe');
  check(cat.inventory.countOf('basic_pickaxe') === 1, 'cat bag holds one basic pickaxe');
  check(
    human.inventory.bag.findById('basic_axe') !== null,
    'basic axe lands in the bag, not the hotbar',
  );

  tools.grantStarterTools(human, cat);
  check(human.inventory.countOf('basic_axe') === 1, 'a second grant does not duplicate the axe');
  check(
    cat.inventory.countOf('basic_pickaxe') === 1,
    'a second grant does not duplicate the pickaxe',
  );
}

// ── Upgrade keeps slot index, in the bag ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);

  const bagIdx = human.inventory.bag.slots.findIndex((s) => s?.id === 'basic_axe');
  check(bagIdx !== -1, 'basic axe found in the bag before upgrading');

  tools.upgrade('axe', human, cat);
  check(state.axeTier === 1, 'upgrade advances the tier by one');
  const afterIdx = human.inventory.bag.slots.findIndex((s) => s?.id === 'hardened_axe');
  check(afterIdx === bagIdx, 'the hardened axe lands in the exact slot the basic axe held');
  check(
    !human.inventory.bag.slots.some((s) => s?.id === 'basic_axe'),
    'the old-tier axe is gone from the bag',
  );
  check(cat.inventory.countOf('hardened_axe') === 1, "the companion's axe upgrades too");
}

// ── Upgrade keeps slot index, in the hotbar ──
// Tools cannot normally reach the hotbar (they aren't hotlistable), but an old
// save or a bug could still leave one there, and `replaceItemInPlace` has to
// find and fix it in place rather than leaving a stray old-tier item behind.
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);

  const basicAxe = human.inventory.bag.findById('basic_axe');
  check(basicAxe !== null, 'basic axe starts in the bag, for this check');
  const bagIdx = human.inventory.bag.slots.findIndex((s) => s?.id === 'basic_axe');
  human.inventory.bag.slots[bagIdx] = null;
  human.inventory.actionBar.slots[0] = basicAxe;

  tools.upgrade('axe', human, cat);
  check(
    human.inventory.actionBar.slots[0]?.id === 'hardened_axe',
    'the upgrade keeps the hotbar slot',
  );
}

// ── Upgrade is capped at the top tier ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);

  const EXTRA_UPGRADES_PAST_TOP_TIER = MAX_TOOL_TIER;
  const UPGRADE_ATTEMPTS = MAX_TOOL_TIER + EXTRA_UPGRADES_PAST_TOP_TIER;
  for (let i = 0; i < UPGRADE_ATTEMPTS; i++) tools.upgrade('pickaxe', human, cat);
  check(
    state.pickaxeTier === MAX_TOOL_TIER,
    'upgrade caps at the top tier instead of running past it',
  );
  check(
    human.inventory.countOf(toolTierDef('pickaxe', MAX_TOOL_TIER).id) === 1,
    'the human ends up holding exactly the top-tier pickaxe',
  );
}

// ── Missing item re-add ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);

  // Simulate an old save or a bug that lost the item entirely.
  human.inventory.removeItems('basic_axe', 1);
  check(
    human.inventory.countOf('basic_axe') === 0,
    'the axe is gone before the upgrade, for this check',
  );

  tools.upgrade('axe', human, cat);
  check(
    human.inventory.countOf('hardened_axe') === 1,
    'upgrade re-adds the new tier when the old item could not be found',
  );
}

// ── Reconcile removes strays and duplicates ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);
  tools.upgrade('axe', human, cat);

  // A stray old-tier copy and a duplicate current-tier copy, as drift could
  // leave behind.
  human.inventory.bag.addToEmpty('basic_axe', 1);
  human.inventory.bag.addToEmpty('hardened_axe', 1);
  check(human.inventory.countOf('basic_axe') === 1, 'stray old-tier axe present before reconcile');
  check(
    human.inventory.countOf('hardened_axe') === 2,
    'duplicate current-tier axe present before reconcile',
  );

  tools.reconcile(human, cat);
  check(human.inventory.countOf('basic_axe') === 0, 'reconcile removes the stray old-tier axe');
  check(human.inventory.countOf('hardened_axe') === 1, 'reconcile folds the duplicate down to one');
}

// ── Reconcile re-adds a completely missing tool ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);
  human.inventory.removeItems('basic_axe', 1);
  check(human.inventory.countOf('basic_axe') === 0, 'axe removed before reconcile, for this check');

  tools.reconcile(human, cat);
  check(
    human.inventory.countOf('basic_axe') === 1,
    'reconcile restores a missing current-tier tool',
  );
}

// ── efficiency / toolItemId ──
{
  const state = createPartyToolsState();
  const tools = new PartyTools(state);
  const { human, cat } = newCrawlers();
  tools.grantStarterTools(human, cat);
  tools.upgrade('axe', human, cat);

  check(
    tools.efficiency('axe') === toolTierDef('axe', 1).efficiency,
    'efficiency reads the current tier',
  );
  check(tools.toolItemId('axe') === 'hardened_axe', 'toolItemId reads the current tier');
  check(
    tools.efficiency('pickaxe') === toolTierDef('pickaxe', 0).efficiency,
    'an un-upgraded kind stays at tier 0',
  );
}

// ── parsePartyToolsState tolerance ──
{
  const fromGarbage = parsePartyToolsState('not an object');
  check(
    fromGarbage.axeTier === null && fromGarbage.pickaxeTier === null,
    'a non-object parses to nulls',
  );

  const fromNull = parsePartyToolsState(null);
  check(fromNull.axeTier === null && fromNull.pickaxeTier === null, 'null parses to nulls');

  const fromEmpty = parsePartyToolsState({});
  check(
    fromEmpty.axeTier === null && fromEmpty.pickaxeTier === null,
    'an absent field parses to null',
  );

  const fromOutOfRange = parsePartyToolsState({ axeTier: 99, pickaxeTier: -1 });
  check(
    fromOutOfRange.axeTier === null && fromOutOfRange.pickaxeTier === null,
    'an out-of-range tier is rejected rather than trusted',
  );

  const fromWrongType = parsePartyToolsState({ axeTier: 'two', pickaxeTier: [1] });
  check(
    fromWrongType.axeTier === null && fromWrongType.pickaxeTier === null,
    'a wrong-typed field is rejected rather than trusted',
  );

  const fromValid = parsePartyToolsState({ axeTier: TOOL_TIER_RATKIN_FORGE, pickaxeTier: 0 });
  check(
    fromValid.axeTier === TOOL_TIER_RATKIN_FORGE && fromValid.pickaxeTier === 0,
    'a well-formed state round-trips',
  );
}

console.log(failures === 0 ? '\nAll party-tools checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
