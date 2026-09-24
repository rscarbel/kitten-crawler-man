#!/usr/bin/env tsx
/**
 * Headless checks for `partyResources`: spend atomicity (a failed spend
 * changes nothing), the active-first take order, discount lines dropping at
 * zero, and `formatCost`'s rendering.
 *
 * Run: npx tsx scripts/verify-party-resources.ts
 */
import { TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import {
  applyDiscount,
  canAfford,
  formatCost,
  partyCount,
  spend,
  type ResourceCost,
} from '../src/core/partyResources';

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

// ── partyCount / canAfford across both inventories ──
{
  const HUMAN_WOOD = 3;
  const CAT_WOOD = 4;
  const COMBINED_WOOD = HUMAN_WOOD + CAT_WOOD;
  const { human, cat } = newCrawlers();
  human.inventory.addItem('wood', HUMAN_WOOD);
  cat.inventory.addItem('wood', CAT_WOOD);
  check(partyCount(human, cat, 'wood') === COMBINED_WOOD, 'partyCount sums both inventories');

  const cost: ResourceCost = { wood: COMBINED_WOOD };
  check(canAfford(human, cat, cost), 'the party can afford exactly its combined stock');
  check(
    !canAfford(human, cat, { wood: COMBINED_WOOD + 1 }),
    'the party cannot afford one more than its combined stock',
  );
}

// ── Atomicity: a failed spend changes nothing ──
{
  const HUMAN_WOOD = 2;
  const CAT_WOOD = 1;
  const EACH_STONE = 5;
  const UNAFFORDABLE_WOOD_COST = 100;
  const { human, cat } = newCrawlers();
  human.inventory.addItem('wood', HUMAN_WOOD);
  cat.inventory.addItem('wood', CAT_WOOD);
  human.inventory.addItem('stone', EACH_STONE);
  cat.inventory.addItem('stone', EACH_STONE);

  const tooExpensive: ResourceCost = { wood: UNAFFORDABLE_WOOD_COST, stone: 1 };
  const ok = spend(human, cat, tooExpensive, human);
  check(!ok, 'an unaffordable spend reports failure');
  check(
    human.inventory.countOf('wood') === HUMAN_WOOD,
    'human wood is untouched after a failed spend',
  );
  check(
    cat.inventory.countOf('wood') === CAT_WOOD,
    "companion's wood is untouched after a failed spend",
  );
  check(
    human.inventory.countOf('stone') === EACH_STONE,
    'human stone is untouched after a failed spend',
  );
  check(
    cat.inventory.countOf('stone') === EACH_STONE,
    "companion's stone is untouched after a failed spend, even though that line alone was affordable",
  );
}

// ── Active-first order ──
{
  const HUMAN_WOOD = 2;
  const CAT_WOOD = 5;
  const SPEND_AMOUNT = 3;
  const { human, cat } = newCrawlers();
  human.inventory.addItem('wood', HUMAN_WOOD);
  cat.inventory.addItem('wood', CAT_WOOD);

  const ok = spend(human, cat, { wood: SPEND_AMOUNT }, human);
  check(ok, 'an affordable spend succeeds');
  check(human.inventory.countOf('wood') === 0, 'the active crawler is drained first');
  check(
    cat.inventory.countOf('wood') === CAT_WOOD - (SPEND_AMOUNT - HUMAN_WOOD),
    'only the shortfall comes from the companion',
  );
}

{
  const HUMAN_WOOD = 2;
  const CAT_WOOD = 5;
  const SPEND_AMOUNT = 3;
  const { human, cat } = newCrawlers();
  human.inventory.addItem('wood', HUMAN_WOOD);
  cat.inventory.addItem('wood', CAT_WOOD);

  const ok = spend(human, cat, { wood: SPEND_AMOUNT }, cat);
  check(ok, 'an affordable spend succeeds with the cat active');
  check(
    cat.inventory.countOf('wood') === CAT_WOOD - SPEND_AMOUNT,
    'the cat, as the active crawler, is drained first',
  );
  check(
    human.inventory.countOf('wood') === HUMAN_WOOD,
    "the human's stock is untouched when the cat can cover the cost alone",
  );
}

{
  const HUMAN_WOOD = 5;
  const CAT_WOOD = 1;
  const SPEND_AMOUNT = 3;
  const { human, cat } = newCrawlers();
  human.inventory.addItem('wood', HUMAN_WOOD);
  cat.inventory.addItem('wood', CAT_WOOD);

  const ok = spend(human, cat, { wood: SPEND_AMOUNT }, cat);
  check(ok, 'the cat can still spend when the human holds the shortfall');
  check(cat.inventory.countOf('wood') === 0, 'the active cat is drained down to zero first');
  check(
    human.inventory.countOf('wood') === HUMAN_WOOD - (SPEND_AMOUNT - CAT_WOOD),
    "the companion's stock covers only the shortfall",
  );
}

// ── Multi-line spend across both resources ──
{
  const BOARDS = 5;
  const ROPE = 1;
  const { human, cat } = newCrawlers();
  human.inventory.addItem('wood_board', BOARDS);
  human.inventory.addItem('rope', ROPE);

  const ok = spend(human, cat, { wood_board: BOARDS, rope: ROPE }, human);
  check(ok, 'a multi-line spend succeeds');
  check(human.inventory.countOf('wood_board') === 0, 'boards are fully spent');
  check(human.inventory.countOf('rope') === 0, 'rope is fully spent');
}

// ── applyDiscount drops zeroed lines ──
{
  const WOOD_COST = 5;
  const STONE_COST = 1;
  const ROPE_COST = 2;
  const SMALL_DISCOUNT = 1;
  const HUGE_DISCOUNT = 10;
  const cost: ResourceCost = { wood: WOOD_COST, stone: STONE_COST, rope: ROPE_COST };
  const discounted = applyDiscount(cost, SMALL_DISCOUNT);
  check(discounted.wood === WOOD_COST - SMALL_DISCOUNT, 'a discounted line above zero is reduced');
  check(discounted.stone === undefined, 'a line that reaches zero is dropped entirely');
  check(
    discounted.rope === ROPE_COST - SMALL_DISCOUNT,
    'another above-zero line is reduced independently',
  );

  const heavilyDiscounted = applyDiscount(cost, HUGE_DISCOUNT);
  check(
    Object.keys(heavilyDiscounted).length === 0,
    'a discount larger than every line drops the whole cost to nothing',
  );

  const undiscounted = applyDiscount(cost, 0);
  check(
    undiscounted.wood === WOOD_COST &&
      undiscounted.stone === STONE_COST &&
      undiscounted.rope === ROPE_COST,
    'a zero discount changes nothing',
  );
}

// ── formatCost ──
{
  const BOARDS = 5;
  const ROPE = 1;
  const STONE = 3;
  const text = formatCost({ wood_board: BOARDS, rope: ROPE });
  check(
    text === `${BOARDS} Boards of Wood, ${ROPE} Rope`,
    `formatCost renders the expected string, got "${text}"`,
  );

  const empty = formatCost({});
  check(empty === '', 'an empty cost formats to an empty string');

  const zeroedOut = formatCost({ wood: 0, stone: STONE });
  check(
    zeroedOut === `${STONE} Stone`,
    'a zero-amount line is skipped rather than printed as "0 Wood"',
  );
}

console.log(
  failures === 0 ? '\nAll party-resources checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
