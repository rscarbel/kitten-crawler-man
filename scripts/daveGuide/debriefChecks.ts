/**
 * The pure half of `verify:dave-guide`: Dave's post-boss debrief names the
 * right boss, filters the gear it lists by wearer, worn and upgrade on real
 * `Inventory` objects, pages it, and raises the `!` only for news.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { Inventory } from '../../src/core/items/inventory/Inventory.js';
import {
  ITEM_DEF,
  type InventoryItem,
  type ItemId,
  type ItemSubSlot,
  type ResistanceType,
} from '../../src/core/items/defs/ItemDefs.js';
import type { StatId } from '../../src/core/party/stats.js';
import { type CrawlerKind } from '../../src/core/skills/SkillManager.js';
import { BigRooster } from '../../src/creatures/BigRooster.js';
import { KrakarenClone } from '../../src/creatures/KrakarenClone.js';
import { TrashGremlin } from '../../src/creatures/TrashGremlin.js';
import {
  ALL_DEBRIEF_BOSS_TYPES,
  BOSS_DISPLAY_NAMES,
  EMPTY_DEBRIEF_MEMORY,
  MAX_ITEMS_PER_DEBRIEF_PAGE,
  debriefBossType,
  debriefHasNews,
  debriefPages,
  isStrictUpgrade,
  isSupersededDebrief,
  rememberDebriefHeard,
  sameDebriefMemory,
  unwornGear,
  type DebriefBossType,
  type DebriefMemory,
  type DebriefState,
} from '../../src/systems/daveDebrief.js';

const failures: string[] = [];
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (!ok) failures.push(message);
}

/** Congratulations already spoken, so each gate sees only the section it measures. */
const CONGRATULATED: DebriefMemory = { ...EMPTY_DEBRIEF_MEMORY, congratulated: true };

/** Any boss will do where the gate is not about the congratulations. */
const ANY_BOSS: DebriefBossType = 'trash_gremlin';

/** An id the fixtures borrow for the rings and gloves they forge; its own definition is never read. */
const FORGED_ITEM_ID: ItemId = 'cockscomb_crest';
const CLOSING_FRAGMENT = "Wear what you're carrying";

const WEAK_HAT_HEALTH = 1;
const WORN_HAT_HEALTH = 3;
const BETTER_HAT_HEALTH = 4;
const SIDEGRADE_HAT_HEALTH = 2;

const TRINKET_FAMILY = 'Trinket';
const TRINKET_SLOTS = 2;
const WEAKEST_WORN_RING_MELEE_BONUS = 1;
/**
 * One ring per Trinket slot, the weakest first: `isWorthWearing` lists a
 * candidate that beats any one worn ring, so a candidate only has to clear the
 * weakest, not every ring worn.
 */
const WORN_RING_MELEE_BONUSES: ReadonlyArray<number> = [
  WEAKEST_WORN_RING_MELEE_BONUS,
  WEAKEST_WORN_RING_MELEE_BONUS + 1,
];

function inventoryOf(owner: CrawlerKind, ids: ReadonlyArray<ItemId>): Inventory {
  const inventory = new Inventory(owner);
  for (const id of ids) inventory.addItem(id, 1);
  return inventory;
}

/**
 * Puts a synthetic item straight into the first empty bag slot.
 *
 * `addItem` always copies from `ITEM_DEF`, so an item with overridden stats has
 * to be placed by hand; equipment lookups go through the bag, so the object in
 * the slot is exactly what the debrief compares.
 */
function putInBag(inventory: Inventory, item: InventoryItem): void {
  inventory.bag.placeInFirstEmpty(item);
}

/**
 * Armour on a real id — `canEquip` rejects unknown ids — but with the slot, name
 * and bonuses the gate needs. Distinct items need distinct ids, since both the
 * equipped map and `unwornGear` key on the id.
 */
type SyntheticArmorExtra = Partial<
  Pick<InventoryItem, 'resistances' | 'meleeOnlyStatBonus' | 'skillLevelBonus'>
>;

function syntheticArmor(
  id: ItemId,
  name: string,
  equipSlot: 'Head' | 'Trinkets',
  equipSubSlot: ItemSubSlot,
  statBonus: Partial<Record<StatId, number>>,
  extra: SyntheticArmorExtra = {},
): InventoryItem {
  return {
    id,
    name,
    quantity: 1,
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot,
    equipSubSlot,
    statBonus,
    ...extra,
  };
}

function hat(
  id: ItemId,
  name: string,
  statBonus: Partial<Record<StatId, number>>,
  extra: Pick<InventoryItem, 'resistances'> = {},
): InventoryItem {
  return syntheticArmor(id, name, 'Head', 'Hat', statBonus, extra);
}

function ring(id: ItemId, melee: number): InventoryItem {
  return ringWithResistances(id, melee, []);
}

/** A ring that also carries resistances, so a zero-stat ring can still block an upgrade. */
function ringWithResistances(
  id: ItemId,
  melee: number,
  resistances: ReadonlyArray<ResistanceType>,
): InventoryItem {
  const statBonus = melee === 0 ? {} : { melee };
  const resistanceSuffix = resistances.length > 0 ? ` (${resistances.join('/')})` : '';
  return syntheticArmor(
    id,
    `Ring of +${melee} MEL${resistanceSuffix} (${id})`,
    'Trinkets',
    TRINKET_FAMILY,
    statBonus,
    { resistances: [...resistances] },
  );
}

function wear(inventory: Inventory, item: InventoryItem): void {
  inventory.equipment.equip(item);
  check(
    inventory.equipment.hasEquipped(item.id),
    `fixture: could not equip ${item.name} — every gate built on it is measuring nothing`,
  );
}

function stateOf(human: Inventory, cat: Inventory): DebriefState {
  return {
    unworn: [...unwornGear('human', human), ...unwornGear('cat', cat)],
  };
}

function lists(owner: CrawlerKind, inventory: Inventory, id: ItemId): boolean {
  return unwornGear(owner, inventory).some((item) => item.id === id);
}

/** The memory after hearing the whole debrief out. */
function heardAll(memory: DebriefMemory, state: DebriefState): DebriefMemory {
  return rememberDebriefHeard(memory, debriefPages(ANY_BOSS, memory, state) ?? []);
}

function spoken(
  memory: DebriefMemory,
  state: DebriefState,
  boss: DebriefBossType = ANY_BOSS,
): string {
  return (debriefPages(boss, memory, state) ?? []).map((page) => page.text).join('\n');
}

/** Runs every debrief check, returning a message for each that failed and how many ran. */
export function debriefCheckResults(): {
  readonly failures: readonly string[];
  readonly checks: number;
} {
  const emptyState = stateOf(inventoryOf('human', []), inventoryOf('cat', []));

  const bossMobs = {
    trash_gremlin: new TrashGremlin(0, 0, TILE_SIZE),
    big_rooster: new BigRooster(0, 0, TILE_SIZE),
    krakaren_clone: new KrakarenClone(0, 0, TILE_SIZE),
  } as const satisfies Record<DebriefBossType, { displayName: string }>;

  check(ALL_DEBRIEF_BOSS_TYPES.length === Object.keys(bossMobs).length, 'boss list drifted');
  for (const boss of ALL_DEBRIEF_BOSS_TYPES) {
    const mobName = bossMobs[boss].displayName;
    check(
      mobName === BOSS_DISPLAY_NAMES[boss],
      `${boss}: BOSS_DISPLAY_NAMES says "${BOSS_DISPLAY_NAMES[boss]}" but the mob calls itself "${mobName}"`,
    );
    const text = spoken(EMPTY_DEBRIEF_MEMORY, emptyState, boss);
    check(text.includes(mobName), `${boss}: congratulations never name "${mobName}"`);
    for (const other of ALL_DEBRIEF_BOSS_TYPES) {
      if (other === boss) continue;
      check(
        !text.includes(BOSS_DISPLAY_NAMES[other]),
        `${boss}: congratulations name the wrong boss, "${BOSS_DISPLAY_NAMES[other]}"`,
      );
    }
    check(debriefBossType(boss) === boss, `debriefBossType('${boss}') does not narrow to itself`);
  }
  check(debriefBossType('ball_of_swine') === null, "debriefBossType('ball_of_swine') is not null");
  check(debriefBossType(undefined) === null, 'debriefBossType(undefined) is not null');

  {
    const talisman: ItemId = 'moonmoth_pendant';
    check(
      !lists('human', inventoryOf('human', [talisman]), talisman),
      "The cat's talisman is recommended to the human",
    );
    check(
      lists('cat', inventoryOf('cat', [talisman]), talisman),
      'control: the talisman in the cat’s own bag is not listed',
    );
  }

  {
    const human = inventoryOf('human', ['hearthguard_cap']);
    check(lists('human', human, 'hearthguard_cap'), 'control: an unworn cap is not listed');
    human.equipByItemId('hearthguard_cap');
    check(human.equipment.hasEquipped('hearthguard_cap'), 'fixture: the cap would not equip');
    check(!lists('human', human, 'hearthguard_cap'), 'a worn cap is still listed');
  }

  check(
    debriefPages(ANY_BOSS, EMPTY_DEBRIEF_MEMORY, emptyState) !== null,
    'control: an uncongratulated party gets no pages',
  );
  check(
    debriefPages(ANY_BOSS, CONGRATULATED, emptyState) === null,
    'congratulated with nothing pending, the debrief still speaks instead of handing back to the advice',
  );

  {
    const wornHat = hat('hearthguard_cap', 'Worn Helm +3', { health: WORN_HAT_HEALTH });
    const weakHat = hat('hearthguard_quilted_vest', 'Weak Helm +1', {
      health: WEAK_HAT_HEALTH,
    });

    function humanWearing(candidate: InventoryItem, worn: InventoryItem | null): Inventory {
      const human = inventoryOf('human', []);
      if (worn !== null) {
        putInBag(human, worn);
        wear(human, worn);
      }
      putInBag(human, candidate);
      return human;
    }

    check(
      !lists('human', humanWearing(weakHat, wornHat), weakHat.id),
      'a +1 helm is recommended over a worn +3',
    );
    check(
      lists('human', humanWearing(weakHat, null), weakHat.id),
      'control: a +1 helm is not listed against a bare head',
    );

    const poisonProofHat = hat(
      'hearthguard_cap',
      'Poison-Proof Helm +3',
      { health: WORN_HAT_HEALTH },
      { resistances: ['poison'] },
    );
    const statForResistance = hat('hearthguard_quilted_vest', 'Bare Helm +4', {
      health: BETTER_HAT_HEALTH,
    });
    check(
      !lists('human', humanWearing(statForResistance, poisonProofHat), statForResistance.id),
      'a helm that gains a stat point but drops poison resistance is recommended',
    );
    const resistanceForStat = hat(
      'hearthguard_quilted_vest',
      'Warded Helm +2',
      { health: SIDEGRADE_HAT_HEALTH },
      { resistances: ['poison', 'ice'] },
    );
    check(
      !lists('human', humanWearing(resistanceForStat, wornHat), resistanceForStat.id),
      'a helm that gains a resistance but drops a stat point is recommended',
    );
    const strictUpgrade = hat(
      'hearthguard_quilted_vest',
      'Poison-Proof Helm +4',
      { health: BETTER_HAT_HEALTH },
      { resistances: ['poison'] },
    );
    check(
      lists('human', humanWearing(strictUpgrade, poisonProofHat), strictUpgrade.id),
      'a strict upgrade (more stats, same resistance) is not recommended',
    );
    check(
      isStrictUpgrade(strictUpgrade, poisonProofHat),
      'isStrictUpgrade rejects a strict upgrade',
    );
    check(
      !isStrictUpgrade(poisonProofHat, poisonProofHat),
      'isStrictUpgrade accepts an equal item',
    );
  }

  {
    const wornRingIds: ReadonlyArray<ItemId> = ['hearthguard_bracers', 'hearthguard_boots'];
    const candidateId: ItemId = FORGED_ITEM_ID;
    check(
      wornRingIds.length === TRINKET_SLOTS && WORN_RING_MELEE_BONUSES.length === TRINKET_SLOTS,
      'fixture: ring list does not fill the Trinket slots',
    );

    /** The human wearing the first `wornCount` of {@link WORN_RING_MELEE_BONUSES}, with one more ring in the bag. */
    function humanWithRings(wornCount: number, candidateMelee: number): Inventory {
      const human = inventoryOf('human', []);
      wornRingIds.slice(0, wornCount).forEach((id, index) => {
        const worn = ring(id, WORN_RING_MELEE_BONUSES[index] ?? WEAKEST_WORN_RING_MELEE_BONUS);
        putInBag(human, worn);
        wear(human, worn);
      });
      putInBag(human, ring(candidateId, candidateMelee));
      return human;
    }

    check(
      lists('human', humanWithRings(TRINKET_SLOTS - 1, WEAKEST_WORN_RING_MELEE_BONUS), candidateId),
      'a ring is not listed while a Trinket slot is still empty',
    );
    const fullTrinkets = humanWithRings(TRINKET_SLOTS, WEAKEST_WORN_RING_MELEE_BONUS);
    const occupiedRingSlots = wornRingIds.filter((id) => fullTrinkets.equipment.hasEquipped(id));
    check(
      occupiedRingSlots.length === TRINKET_SLOTS,
      'fixture: two rings did not fill both Trinket slots',
    );
    check(
      !lists('human', fullTrinkets, candidateId),
      'a ring that only ties the weakest worn ring is listed with every Trinket slot full',
    );
    check(
      lists('human', humanWithRings(TRINKET_SLOTS, WEAKEST_WORN_RING_MELEE_BONUS + 1), candidateId),
      'a ring that beats the weakest worn ring is not listed',
    );
  }

  {
    const ZERO_STAT_RING_RESISTANCE: ResistanceType = 'poison';
    const UPGRADE_RING_MELEE = 1;
    const wornRingIds: ReadonlyArray<ItemId> = ['hearthguard_bracers', 'hearthguard_boots'];
    const candidateId: ItemId = FORGED_ITEM_ID;

    function humanWithRings(worn: ReadonlyArray<InventoryItem>): Inventory {
      const human = inventoryOf('human', []);
      for (const item of worn) {
        putInBag(human, item);
        wear(human, item);
      }
      return human;
    }

    const [zeroResistantId, zeroPlainId] = wornRingIds;

    const resistantZero = ringWithResistances(zeroResistantId, 0, [ZERO_STAT_RING_RESISTANCE]);
    const plainZero = ringWithResistances(zeroPlainId, 0, []);

    const oneBareZeroRing = humanWithRings([resistantZero, plainZero]);
    putInBag(oneBareZeroRing, ring(candidateId, UPGRADE_RING_MELEE));
    check(
      lists('human', oneBareZeroRing, candidateId),
      'a +1 ring with no resistance is not listed although a worn ring is 0-stat with nothing to give up',
    );

    const resistanceOnEveryRing: ReadonlyArray<InventoryItem> = [
      ringWithResistances(zeroResistantId, WORN_RING_MELEE_BONUSES[0], [ZERO_STAT_RING_RESISTANCE]),
      ringWithResistances(zeroPlainId, WORN_RING_MELEE_BONUSES[1], [ZERO_STAT_RING_RESISTANCE]),
    ];
    const allResistant = humanWithRings(resistanceOnEveryRing);
    const strongestWornRingMeleeBonus = Math.max(...WORN_RING_MELEE_BONUSES);
    putInBag(allResistant, ring(candidateId, strongestWornRingMeleeBonus + UPGRADE_RING_MELEE));
    check(
      !lists('human', allResistant, candidateId),
      'a ring with no resistance is listed although every worn ring carries one it lacks',
    );
  }

  {
    /** Far above anything the gauntlet's own stats add, so its traits are the only reason it is refused. */
    const OVERWHELMING_GLOVE_MELEE = 20;
    const REAL_GAUNTLET_STAT_TOTAL = ITEM_DEF.iron_knuckle_gauntlet.statBonus?.evasiveness ?? 0;
    /** Copied from the real gauntlet so every field it guards is matched, not just its stats. */
    const gauntletLike = (id: ItemId, name: string, melee: number): InventoryItem => ({
      ...ITEM_DEF.iron_knuckle_gauntlet,
      id,
      name,
      quantity: 1,
      statBonus: { melee },
    });
    const overwhelmingGlove = gauntletLike(
      FORGED_ITEM_ID,
      'Impossible Gauntlet',
      OVERWHELMING_GLOVE_MELEE,
    );

    const humanWithGauntlet = inventoryOf('human', ['iron_knuckle_gauntlet']);
    humanWithGauntlet.equipByItemId('iron_knuckle_gauntlet');
    check(
      humanWithGauntlet.equipment.hasEquipped('iron_knuckle_gauntlet'),
      'fixture: the Iron Knuckle Gauntlet would not equip',
    );
    putInBag(humanWithGauntlet, overwhelmingGlove);
    check(
      !lists('human', humanWithGauntlet, overwhelmingGlove.id),
      'a far-stronger glove is recommended over the worn Iron Knuckle Gauntlet',
    );

    const impostorId: ItemId = 'hearthguard_bracers';
    const humanWithImpostor = inventoryOf('human', []);
    putInBag(
      humanWithImpostor,
      gauntletLike(impostorId, 'Gauntlet Copy', REAL_GAUNTLET_STAT_TOTAL),
    );
    humanWithImpostor.equipByItemId(impostorId);
    check(
      humanWithImpostor.equipment.hasEquipped(impostorId),
      'fixture: the gauntlet copy would not equip',
    );
    putInBag(humanWithImpostor, overwhelmingGlove);
    check(
      lists('human', humanWithImpostor, overwhelmingGlove.id),
      'control: the glove does not beat an identical gauntlet under an id with no traits, so the trait guard is untested',
    );
  }

  {
    const humanGear: ReadonlyArray<ItemId> = [
      'hearthguard_cap',
      'hearthguard_quilted_vest',
      'hearthguard_bracers',
      'hearthguard_boots',
      'patched_duster',
      'riot_kneeguards',
    ];
    const catGear: ReadonlyArray<ItemId> = ['moonmoth_pendant', 'plumed_coat'];
    const allNames = [...humanGear, ...catGear].map((id) => ITEM_DEF[id].name);
    check(allNames.length > MAX_ITEMS_PER_DEBRIEF_PAGE, 'fixture: too few items to force paging');

    const pages = (
      debriefPages(
        ANY_BOSS,
        CONGRATULATED,
        stateOf(inventoryOf('human', humanGear), inventoryOf('cat', catGear)),
      ) ?? []
    ).map((page) => page.text);
    check(pages.length > 1, 'a long gear list was not paged at all');

    let namedTotal = 0;
    pages.forEach((page, index) => {
      const namedHere = allNames.filter((name) => page.includes(name)).length;
      namedTotal += namedHere;
      check(
        namedHere <= MAX_ITEMS_PER_DEBRIEF_PAGE,
        `page ${index + 1} names ${namedHere} items, more than ${MAX_ITEMS_PER_DEBRIEF_PAGE}`,
      );
    });
    check(
      namedTotal === allNames.length,
      `pages name ${namedTotal} items in total; the party holds ${allNames.length}`,
    );
    const lastPage = pages[pages.length - 1] ?? '';
    check(lastPage.includes(CLOSING_FRAGMENT), 'the closing line is not on the last page');
    check(
      pages.slice(0, -1).every((page) => !page.includes(CLOSING_FRAGMENT)),
      'the closing line appears before the last page',
    );
  }

  {
    const singlePluralItemText = spoken(
      CONGRATULATED,
      stateOf(inventoryOf('human', ['hearthguard_boots']), inventoryOf('cat', [])),
    );
    check(
      singlePluralItemText.includes(CLOSING_FRAGMENT),
      'a single plural-named item does not get the closing line',
    );
  }

  {
    const bareCat = inventoryOf('cat', []);

    check(
      debriefHasNews(EMPTY_DEBRIEF_MEMORY, emptyState),
      'no `!` before the congratulations are spoken',
    );
    const helmState = stateOf(inventoryOf('human', ['hearthguard_cap']), bareCat);
    check(debriefHasNews(CONGRATULATED, helmState), 'no `!` for unnamed gear');

    for (const [label, memory, state] of [
      ['congratulations', EMPTY_DEBRIEF_MEMORY, emptyState],
      ['gear', CONGRATULATED, helmState],
    ] as const) {
      check(
        !debriefHasNews(heardAll(memory, state), state),
        `${label}: the \`!\` survives a talk that changed nothing`,
      );
    }

    const afterHelm = heardAll(CONGRATULATED, helmState);
    const helmAndShirt = inventoryOf('human', ['hearthguard_cap', 'hearthguard_quilted_vest']);
    check(
      debriefHasNews(afterHelm, stateOf(helmAndShirt, bareCat)),
      'a newly found item after the talk raises no `!`',
    );

    const bothNamed = heardAll(CONGRATULATED, stateOf(helmAndShirt, bareCat));
    helmAndShirt.equipByItemId('hearthguard_cap');
    const oneLeft = stateOf(helmAndShirt, bareCat);
    check(
      oneLeft.unworn.length === 1,
      'fixture: equipping one of two named items did not leave one unworn',
    );
    check(
      !debriefHasNews(bothNamed, oneLeft),
      'equipping one of two items he already named raises the `!`',
    );
    check(
      debriefPages(ANY_BOSS, bothNamed, oneLeft) === null,
      'equipping one of two named items makes him re-read the other',
    );
  }

  {
    check(
      isSupersededDebrief('trash_gremlin', new Set(['trash_gremlin', 'big_rooster'])),
      'the Trash Gremlin is not superseded once Big Rooster is also dead',
    );
    check(
      !isSupersededDebrief('trash_gremlin', new Set(['trash_gremlin'])),
      'control: the Trash Gremlin is superseded with no later boss dead',
    );
    check(
      !isSupersededDebrief('big_rooster', new Set(['trash_gremlin', 'big_rooster'])),
      'Big Rooster is superseded by a boss earlier than it in the order',
    );
    check(
      !isSupersededDebrief(
        'krakaren_clone',
        new Set(['trash_gremlin', 'big_rooster', 'krakaren_clone']),
      ),
      'the Krakaren Clone, last in the boss order, is superseded by an earlier boss',
    );
  }

  {
    const memoryA: DebriefMemory = {
      congratulated: true,
      namedItemIds: ['hearthguard_cap', 'hearthguard_quilted_vest'],
    };
    const memoryACopy: DebriefMemory = { ...memoryA, namedItemIds: [...memoryA.namedItemIds] };
    check(sameDebriefMemory(memoryA, memoryA), 'a memory is not equal to itself');
    check(sameDebriefMemory(memoryA, memoryACopy), 'a memory is not equal to a copy of itself');

    const human = inventoryOf('human', ['hearthguard_cap']);
    const cat = inventoryOf('cat', []);
    const repeatState = stateOf(human, cat);
    const repeatTalk = heardAll(memoryA, repeatState);
    check(
      sameDebriefMemory(memoryA, repeatTalk),
      'a repeat talk with nothing new changes the memory',
    );

    const firstCongratsTalk = heardAll(EMPTY_DEBRIEF_MEMORY, repeatState);
    check(
      !sameDebriefMemory(EMPTY_DEBRIEF_MEMORY, firstCongratsTalk),
      'congratulating for the first time does not change the memory',
    );

    const newNamedItem: DebriefMemory = {
      ...memoryA,
      namedItemIds: [...memoryA.namedItemIds, 'hearthguard_boots'],
    };
    check(
      !sameDebriefMemory(memoryA, newNamedItem),
      'a newly named item id does not change the memory',
    );
  }

  return { failures, checks };
}
