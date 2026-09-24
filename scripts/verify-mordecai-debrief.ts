/**
 * Gate for Mordecai's post-boss debrief: correct boss naming, wearer/worn/upgrade
 * filtering on real `Inventory` objects, the hushed crown, paging, and the `!` news flag.
 *
 *   npx tsx scripts/verify-mordecai-debrief.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { Inventory } from '../src/core/Inventory.js';
import {
  ITEM_DEF,
  type InventoryItem,
  type ItemId,
  type ResistanceType,
} from '../src/core/ItemDefs.js';
import type { StatName } from '../src/Player.js';
import { CRAWLER_NAMES, type CrawlerKind } from '../src/core/SkillManager.js';
import { Juicer } from '../src/creatures/Juicer.js';
import { KrakarenClone } from '../src/creatures/KrakarenClone.js';
import { TheHoarder } from '../src/creatures/TheHoarder.js';
import {
  ALL_DEBRIEF_BOSS_TYPES,
  BOSS_DISPLAY_NAMES,
  EMPTY_DEBRIEF_MEMORY,
  HUSHED_ONLY_LINE,
  MAX_ITEMS_PER_DEBRIEF_PAGE,
  debriefBossType,
  debriefHasNews,
  debriefPages,
  isStrictUpgrade,
  isSupersededDebrief,
  reconcileDebriefMemory,
  rememberDebriefSpoken,
  sameDebriefMemory,
  unwornGear,
  type BoxCounts,
  type DebriefBossType,
  type DebriefMemory,
  type DebriefState,
} from '../src/systems/mordecaiDebrief.js';

const failures: string[] = [];
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (!ok) failures.push(message);
}

const NO_BOXES: BoxCounts = { human: 0, cat: 0 };
const ONE_CARL_BOX: BoxCounts = { human: 1, cat: 0 };

/** Congratulations already spoken, so each gate sees only the section it measures. */
const CONGRATULATED: DebriefMemory = { ...EMPTY_DEBRIEF_MEMORY, congratulated: true };

/** Any boss will do where the gate is not about the congratulations. */
const ANY_BOSS: DebriefBossType = 'the_hoarder';

const KETTLE_HELM_NAME = ITEM_DEF.issue_kettle_helm.name;
const CROWN_ID: ItemId = 'enchanted_crown_sepsis_whore';
/** The word his prose would have to use to name the crown. */
const CROWN_WORD = 'Crown';
const HUSHED_ALSO_FRAGMENT = 'something else unworn';
const CLOSING_FRAGMENT = "Wear what you're carrying";

const WEAK_HAT_CONSTITUTION = 1;
const WORN_HAT_CONSTITUTION = 3;
const BETTER_HAT_CONSTITUTION = 4;
const SIDEGRADE_HAT_CONSTITUTION = 2;
/** Far above anything Donut could find, so every other hat is a downgrade on it. */
const DONUT_BEST_HAT_INTELLIGENCE = 9;

const RING_FAMILY = 'Ring';
const RING_SLOTS_PER_HAND_SET = 4;
const WEAKEST_WORN_RING_STRENGTH = 1;
/**
 * One ring per Ring slot, the low strength repeated twice: `isWorthWearing` lists
 * a candidate that beats any one worn ring, so a candidate only has to clear one
 * of these two, not every ring in the set.
 */
const WORN_RING_STRENGTHS: ReadonlyArray<number> = [
  WEAKEST_WORN_RING_STRENGTH,
  WEAKEST_WORN_RING_STRENGTH + 1,
  WEAKEST_WORN_RING_STRENGTH + 2,
  WEAKEST_WORN_RING_STRENGTH,
];

function inventoryOf(owner: CrawlerKind, ids: ReadonlyArray<ItemId>): Inventory {
  const inventory = new Inventory(owner);
  for (const id of ids) inventory.addItem(id, 1);
  return inventory;
}

/**
 * Puts a synthetic item straight into the first free bag slot.
 *
 * `addItem` always copies from `ITEM_DEF`, so an item with overridden stats has
 * to be placed by hand; equipment lookups go through the bag, so the object in
 * the slot is exactly what the debrief compares.
 */
function putInBag(inventory: Inventory, item: InventoryItem): void {
  const freeSlot = inventory.bag.slots.findIndex((slot) => slot === null);
  if (freeSlot === -1) throw new Error(`no room in the bag for ${item.name}`);
  inventory.bag.slots[freeSlot] = item;
}

/**
 * Armour on a real id — `canEquip` rejects unknown ids — but with the slot, name
 * and bonuses the gate needs. Distinct items need distinct ids, since both the
 * equipped map and `unwornGear` key on the id.
 */
type SyntheticArmorExtra = Partial<
  Pick<InventoryItem, 'resistances' | 'meleeOnlyStatBonus' | 'skillLevelBonus' | 'stunOnHitChance'>
>;

function syntheticArmor(
  id: ItemId,
  name: string,
  equipSlot: 'Head' | 'Hands',
  equipSubSlot: string,
  statBonus: Partial<Record<StatName, number>>,
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
  statBonus: Partial<Record<StatName, number>>,
  extra: Pick<InventoryItem, 'resistances'> = {},
): InventoryItem {
  return syntheticArmor(id, name, 'Head', 'Hat', statBonus, extra);
}

function ring(id: ItemId, strength: number): InventoryItem {
  return ringWithResistances(id, strength, []);
}

/** A ring that also carries resistances, so a zero-stat ring can still block an upgrade. */
function ringWithResistances(
  id: ItemId,
  strength: number,
  resistances: ReadonlyArray<ResistanceType>,
): InventoryItem {
  const statBonus = strength === 0 ? {} : { strength };
  const resistanceSuffix = resistances.length > 0 ? ` (${resistances.join('/')})` : '';
  return syntheticArmor(
    id,
    `Ring of +${strength} STR${resistanceSuffix} (${id})`,
    'Hands',
    RING_FAMILY,
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

function stateOf(
  carl: Inventory,
  donut: Inventory,
  pendingBoxes: BoxCounts = NO_BOXES,
): DebriefState {
  return {
    pendingBoxes,
    unworn: [...unwornGear('human', carl), ...unwornGear('cat', donut)],
  };
}

function lists(owner: CrawlerKind, inventory: Inventory, id: ItemId): boolean {
  return unwornGear(owner, inventory).some((item) => item.id === id);
}

function spoken(
  memory: DebriefMemory,
  state: DebriefState,
  boss: DebriefBossType = ANY_BOSS,
): string {
  return (debriefPages(boss, memory, state) ?? []).join('\n');
}

const emptyState = stateOf(inventoryOf('human', []), inventoryOf('cat', []));

const bossMobs = {
  the_hoarder: new TheHoarder(0, 0, TILE_SIZE),
  juicer: new Juicer(0, 0, TILE_SIZE),
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
  const carl = inventoryOf('human', ['issue_kettle_helm']);
  const donut = inventoryOf('cat', []);
  const boxedText = spoken(CONGRATULATED, stateOf(carl, donut, ONE_CARL_BOX));
  const openedText = spoken(CONGRATULATED, stateOf(carl, donut));

  check(openedText.includes(KETTLE_HELM_NAME), 'control: with no boxes the kettle helm is named');
  check(!boxedText.includes(KETTLE_HELM_NAME), 'gear named while a loot box is still unopened');
  check(boxedText.includes('loot box'), 'no box section while a box is pending');
  check(!openedText.includes('loot box'), 'box section spoken with no box pending');

  check(
    boxedText.includes(`${CRAWLER_NAMES.human}, you're sitting on an unopened loot box`),
    'a single Carl box does not address Carl by name',
  );
  const donutText = spoken(CONGRATULATED, stateOf(carl, donut, { human: 0, cat: 2 }));
  check(
    donutText.includes(`${CRAWLER_NAMES.cat}, you're sitting on unopened loot boxes`),
    'two Donut boxes do not address Donut by name in the plural',
  );
  const bothText = spoken(CONGRATULATED, stateOf(carl, donut, { human: 1, cat: 1 }));
  check(bothText.includes('You both'), 'boxes on both crawlers are not addressed to both');
  check(!boxedText.includes('You both'), 'a Carl-only box is addressed to both crawlers');
}

{
  const talisman: ItemId = 'slate_butterfly_talisman';
  check(
    !lists('human', inventoryOf('human', [talisman]), talisman),
    "Donut's talisman is recommended to Carl",
  );
  check(
    lists('cat', inventoryOf('cat', [talisman]), talisman),
    'control: the talisman in Donut’s own bag is not listed',
  );
}

{
  const carl = inventoryOf('human', ['issue_kettle_helm']);
  check(lists('human', carl, 'issue_kettle_helm'), 'control: an unworn kettle helm is not listed');
  carl.equipByItemId('issue_kettle_helm');
  check(carl.equipment.hasEquipped('issue_kettle_helm'), 'fixture: kettle helm would not equip');
  check(!lists('human', carl, 'issue_kettle_helm'), 'a worn kettle helm is still listed');
}

{
  const donutCrownOnly = inventoryOf('cat', [CROWN_ID]);
  const crownOnlyState = stateOf(inventoryOf('human', []), donutCrownOnly);
  const crownOnlyText = spoken(CONGRATULATED, crownOnlyState);
  check(lists('cat', donutCrownOnly, CROWN_ID), 'the crown is not counted as unworn gear');
  check(crownOnlyText.includes(HUSHED_ONLY_LINE), 'crown alone: the vague line is missing');
  check(!crownOnlyText.includes(CROWN_WORD), 'crown alone: Mordecai names the crown to Donut');

  const carlCrownText = spoken(
    CONGRATULATED,
    stateOf(inventoryOf('human', [CROWN_ID]), inventoryOf('cat', [])),
  );
  check(
    carlCrownText.includes(CROWN_WORD),
    `control: a crown in Carl's bag is named — the "${CROWN_WORD}" absence check would otherwise pass on nothing`,
  );

  const crownAndHelmText = spoken(
    CONGRATULATED,
    stateOf(inventoryOf('human', []), inventoryOf('cat', [CROWN_ID, 'issue_kettle_helm'])),
  );
  check(crownAndHelmText.includes(KETTLE_HELM_NAME), 'crown + helm: the helm is not named');
  check(!crownAndHelmText.includes(CROWN_WORD), 'crown + helm: the crown is named');
  check(
    crownAndHelmText.includes(HUSHED_ALSO_FRAGMENT),
    'crown + helm: the "something else unworn" line is missing',
  );
  check(
    !crownOnlyText.includes(HUSHED_ALSO_FRAGMENT),
    'crown alone: the "something else" line is spoken with nothing else named',
  );

  const donutWellHatted = inventoryOf('cat', [CROWN_ID]);
  const bestHat = hat('issue_kettle_helm', "Donut's Tiara", {
    intelligence: DONUT_BEST_HAT_INTELLIGENCE,
  });
  putInBag(donutWellHatted, bestHat);
  wear(donutWellHatted, bestHat);
  const lesserHat = hat('padded_gambeson', 'Lesser Hat', { constitution: WEAK_HAT_CONSTITUTION });
  putInBag(donutWellHatted, lesserHat);
  check(
    !lists('cat', donutWellHatted, lesserHat.id),
    'control: a lesser hat is listed although Donut wears a far better one',
  );
  check(
    lists('cat', donutWellHatted, CROWN_ID),
    'the crown is dropped by the downgrade filter when Donut wears a better hat',
  );
  check(
    spoken(CONGRATULATED, stateOf(inventoryOf('human', []), donutWellHatted)).includes(
      HUSHED_ONLY_LINE,
    ),
    'a better-hatted Donut with the crown in her bag hears no vague line',
  );
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
  const wornHat = hat('issue_kettle_helm', 'Worn Helm +3', { constitution: WORN_HAT_CONSTITUTION });
  const weakHat = hat('padded_gambeson', 'Weak Helm +1', { constitution: WEAK_HAT_CONSTITUTION });

  function carlWearing(candidate: InventoryItem, worn: InventoryItem | null): Inventory {
    const carl = inventoryOf('human', []);
    if (worn !== null) {
      putInBag(carl, worn);
      wear(carl, worn);
    }
    putInBag(carl, candidate);
    return carl;
  }

  check(
    !lists('human', carlWearing(weakHat, wornHat), weakHat.id),
    'a +1 helm is recommended over a worn +3',
  );
  check(
    lists('human', carlWearing(weakHat, null), weakHat.id),
    'control: a +1 helm is not listed against a bare head',
  );

  const poisonProofHat = hat(
    'issue_kettle_helm',
    'Poison-Proof Helm +3',
    { constitution: WORN_HAT_CONSTITUTION },
    { resistances: ['poison'] },
  );
  const statForResistance = hat('padded_gambeson', 'Bare Helm +4', {
    constitution: BETTER_HAT_CONSTITUTION,
  });
  check(
    !lists('human', carlWearing(statForResistance, poisonProofHat), statForResistance.id),
    'a helm that gains a stat point but drops poison resistance is recommended',
  );
  const resistanceForStat = hat(
    'padded_gambeson',
    'Warded Helm +2',
    { constitution: SIDEGRADE_HAT_CONSTITUTION },
    { resistances: ['poison', 'ice'] },
  );
  check(
    !lists('human', carlWearing(resistanceForStat, wornHat), resistanceForStat.id),
    'a helm that gains a resistance but drops a stat point is recommended',
  );
  const strictUpgrade = hat(
    'padded_gambeson',
    'Poison-Proof Helm +4',
    { constitution: BETTER_HAT_CONSTITUTION },
    { resistances: ['poison'] },
  );
  check(
    lists('human', carlWearing(strictUpgrade, poisonProofHat), strictUpgrade.id),
    'a strict upgrade (more stats, same resistance) is not recommended',
  );
  check(isStrictUpgrade(strictUpgrade, poisonProofHat), 'isStrictUpgrade rejects a strict upgrade');
  check(!isStrictUpgrade(poisonProofHat, poisonProofHat), 'isStrictUpgrade accepts an equal item');
}

{
  const wornRingIds: ReadonlyArray<ItemId> = [
    'riveted_bracers',
    'marching_boots',
    'padded_gambeson',
    'issue_kettle_helm',
  ];
  const candidateId: ItemId = CROWN_ID;
  check(
    wornRingIds.length === RING_SLOTS_PER_HAND_SET &&
      WORN_RING_STRENGTHS.length === RING_SLOTS_PER_HAND_SET,
    'fixture: ring list is not one hand set',
  );

  /** Carl wearing the first `wornCount` of {@link WORN_RING_STRENGTHS}, with one more ring in the bag. */
  function carlWithRings(wornCount: number, candidateStrength: number): Inventory {
    const carl = inventoryOf('human', []);
    wornRingIds.slice(0, wornCount).forEach((id, index) => {
      const worn = ring(id, WORN_RING_STRENGTHS[index] ?? WEAKEST_WORN_RING_STRENGTH);
      putInBag(carl, worn);
      wear(carl, worn);
    });
    putInBag(carl, ring(candidateId, candidateStrength));
    return carl;
  }

  check(
    lists(
      'human',
      carlWithRings(RING_SLOTS_PER_HAND_SET - 1, WEAKEST_WORN_RING_STRENGTH),
      candidateId,
    ),
    'a ring is not listed while a Ring slot is still empty',
  );
  const fullHands = carlWithRings(RING_SLOTS_PER_HAND_SET, WEAKEST_WORN_RING_STRENGTH);
  const occupiedRingSlots = wornRingIds.filter((id) => fullHands.equipment.hasEquipped(id));
  check(
    occupiedRingSlots.length === RING_SLOTS_PER_HAND_SET,
    'fixture: four rings did not fill all four Ring slots',
  );
  check(
    !lists('human', fullHands, candidateId),
    'a ring that only ties the weakest worn ring is listed with every Ring slot full',
  );
  check(
    lists(
      'human',
      carlWithRings(RING_SLOTS_PER_HAND_SET, WEAKEST_WORN_RING_STRENGTH + 1),
      candidateId,
    ),
    'a ring that beats the weakest worn ring is not listed',
  );
}

{
  const ZERO_STAT_RING_RESISTANCE: ResistanceType = 'poison';
  const UPGRADE_RING_STRENGTH = 1;
  const wornRingIds: ReadonlyArray<ItemId> = [
    'riveted_bracers',
    'marching_boots',
    'padded_gambeson',
    'issue_kettle_helm',
  ];
  const candidateId: ItemId = CROWN_ID;

  function carlWithFourRings(worn: ReadonlyArray<InventoryItem>): Inventory {
    const carl = inventoryOf('human', []);
    for (const item of worn) {
      putInBag(carl, item);
      wear(carl, item);
    }
    return carl;
  }

  const [zeroResistantId, zeroPlainId, strongAId, strongBId] = wornRingIds;
  const [, , strongAStrength, strongBStrength] = WORN_RING_STRENGTHS;

  const resistantZero = ringWithResistances(zeroResistantId, 0, [ZERO_STAT_RING_RESISTANCE]);
  const plainZero = ringWithResistances(zeroPlainId, 0, []);
  const strongerA = ring(strongAId, strongAStrength);
  const strongerB = ring(strongBId, strongBStrength);

  const oneBareZeroRing = carlWithFourRings([resistantZero, plainZero, strongerA, strongerB]);
  putInBag(oneBareZeroRing, ring(candidateId, UPGRADE_RING_STRENGTH));
  check(
    lists('human', oneBareZeroRing, candidateId),
    'a +1 ring with no resistance is not listed although a worn ring is 0-stat with nothing to give up',
  );

  const resistanceOnEveryRing: ReadonlyArray<InventoryItem> = [
    ringWithResistances(zeroResistantId, WORN_RING_STRENGTHS[0], [ZERO_STAT_RING_RESISTANCE]),
    ringWithResistances(zeroPlainId, WORN_RING_STRENGTHS[1], [ZERO_STAT_RING_RESISTANCE]),
    ringWithResistances(strongAId, strongAStrength, [ZERO_STAT_RING_RESISTANCE]),
    ringWithResistances(strongBId, strongBStrength, [ZERO_STAT_RING_RESISTANCE]),
  ];
  const allResistant = carlWithFourRings(resistanceOnEveryRing);
  const strongestWornRingStrength = Math.max(...WORN_RING_STRENGTHS);
  putInBag(allResistant, ring(candidateId, strongestWornRingStrength + UPGRADE_RING_STRENGTH));
  check(
    !lists('human', allResistant, candidateId),
    'a ring with no resistance is listed although every worn ring carries one it lacks',
  );
}

{
  /** Far above the gauntlet's own +1, so the id-keyed guard is the only reason it is refused. */
  const OVERWHELMING_GLOVE_STRENGTH = 20;
  const REAL_GAUNTLET_STAT_TOTAL = ITEM_DEF.grull_war_gauntlet.statBonus?.dexterity ?? 0;
  /** Copied from the real gauntlet so every field it guards is matched, not just its stats. */
  const gauntletLike = (id: ItemId, name: string, strength: number): InventoryItem => ({
    ...ITEM_DEF.grull_war_gauntlet,
    id,
    name,
    quantity: 1,
    statBonus: { strength },
  });
  const overwhelmingGlove = gauntletLike(
    CROWN_ID,
    'Impossible Gauntlet',
    OVERWHELMING_GLOVE_STRENGTH,
  );

  const carlWithGauntlet = inventoryOf('human', ['grull_war_gauntlet']);
  carlWithGauntlet.equipByItemId('grull_war_gauntlet');
  check(
    carlWithGauntlet.equipment.hasEquipped('grull_war_gauntlet'),
    'fixture: the War Gauntlet would not equip',
  );
  putInBag(carlWithGauntlet, overwhelmingGlove);
  check(
    !lists('human', carlWithGauntlet, overwhelmingGlove.id),
    'a far-stronger glove is recommended over the worn War Gauntlet',
  );

  const impostorId: ItemId = 'riveted_bracers';
  const carlWithImpostor = inventoryOf('human', []);
  putInBag(carlWithImpostor, gauntletLike(impostorId, 'Gauntlet Copy', REAL_GAUNTLET_STAT_TOTAL));
  carlWithImpostor.equipByItemId(impostorId);
  check(
    carlWithImpostor.equipment.hasEquipped(impostorId),
    'fixture: the gauntlet copy would not equip',
  );
  putInBag(carlWithImpostor, overwhelmingGlove);
  check(
    lists('human', carlWithImpostor, overwhelmingGlove.id),
    'control: the glove does not beat an identical gauntlet under an unguarded id, so the id guard is untested',
  );
}

{
  const carlGear: ReadonlyArray<ItemId> = [
    'issue_kettle_helm',
    'padded_gambeson',
    'riveted_bracers',
    'marching_boots',
    'nightgaunt_cloak',
    'splatter_skunk_toe_ring',
    'shade_gnoll_kneepads',
  ];
  const donutGear: ReadonlyArray<ItemId> = ['slate_butterfly_talisman', 'fae_scale_crupper'];
  const allNames = [...carlGear, ...donutGear].map((id) => ITEM_DEF[id].name);
  check(allNames.length > MAX_ITEMS_PER_DEBRIEF_PAGE, 'fixture: too few items to force paging');

  const pages =
    debriefPages(
      ANY_BOSS,
      CONGRATULATED,
      stateOf(inventoryOf('human', carlGear), inventoryOf('cat', donutGear)),
    ) ?? [];
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
    stateOf(inventoryOf('human', ['marching_boots']), inventoryOf('cat', [])),
  );
  check(
    singlePluralItemText.includes(CLOSING_FRAGMENT),
    'a single plural-named item does not get the closing line',
  );
}

{
  const bareCarl = inventoryOf('human', []);
  const bareDonut = inventoryOf('cat', []);

  check(
    debriefHasNews(EMPTY_DEBRIEF_MEMORY, emptyState),
    'no `!` before the congratulations are spoken',
  );
  const boxState = stateOf(bareCarl, bareDonut, ONE_CARL_BOX);
  check(debriefHasNews(CONGRATULATED, boxState), 'no `!` for an unheard-of loot box');
  const helmState = stateOf(inventoryOf('human', ['issue_kettle_helm']), bareDonut);
  check(debriefHasNews(CONGRATULATED, helmState), 'no `!` for unnamed gear');

  for (const [label, memory, state] of [
    ['congratulations', EMPTY_DEBRIEF_MEMORY, emptyState],
    ['box', CONGRATULATED, boxState],
    ['gear', CONGRATULATED, helmState],
  ] as const) {
    check(
      !debriefHasNews(rememberDebriefSpoken(memory, state), state),
      `${label}: the \`!\` survives a talk that changed nothing`,
    );
  }

  const afterOneBox = rememberDebriefSpoken(CONGRATULATED, boxState);
  check(
    debriefHasNews(afterOneBox, stateOf(bareCarl, bareDonut, { human: 2, cat: 0 })),
    'a second box after the talk raises no `!`',
  );

  const afterHelm = rememberDebriefSpoken(CONGRATULATED, helmState);
  const helmAndShirt = inventoryOf('human', ['issue_kettle_helm', 'padded_gambeson']);
  check(
    debriefHasNews(afterHelm, stateOf(helmAndShirt, bareDonut)),
    'a newly found item after the talk raises no `!`',
  );

  const bothNamed = rememberDebriefSpoken(CONGRATULATED, stateOf(helmAndShirt, bareDonut));
  helmAndShirt.equipByItemId('issue_kettle_helm');
  const oneLeft = stateOf(helmAndShirt, bareDonut);
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

  const threeBoxes: BoxCounts = { human: 3, cat: 0 };
  const afterThree = rememberDebriefSpoken(CONGRATULATED, stateOf(bareCarl, bareDonut, threeBoxes));
  const allOpened = reconcileDebriefMemory(afterThree, NO_BOXES);
  const earnedOne = reconcileDebriefMemory(allOpened, ONE_CARL_BOX);
  check(
    debriefHasNews(earnedOne, stateOf(bareCarl, bareDonut, ONE_CARL_BOX)),
    'opening every box then earning one more raises no `!`',
  );
  check(
    !debriefHasNews(afterThree, stateOf(bareCarl, bareDonut, ONE_CARL_BOX)),
    'control: without reconciling, one box reads as fewer than he last saw — the reconcile is what the gate above measures',
  );

  const helmCarl = inventoryOf('human', ['issue_kettle_helm']);
  const boxedHelm = stateOf(helmCarl, bareDonut, ONE_CARL_BOX);
  const afterBoxTalk = rememberDebriefSpoken(CONGRATULATED, boxedHelm);
  check(
    !debriefHasNews(afterBoxTalk, boxedHelm),
    'fixture: the `!` did not clear after the box talk',
  );
  const boxesOpened = stateOf(helmCarl, bareDonut);
  const reconciled = reconcileDebriefMemory(afterBoxTalk, boxesOpened.pendingBoxes);
  check(
    debriefHasNews(reconciled, boxesOpened),
    'gear held back behind boxes is not news once the boxes are open',
  );
  check(
    spoken(reconciled, boxesOpened).includes(KETTLE_HELM_NAME),
    'gear held back behind boxes is not named once the boxes are open',
  );
}

{
  check(
    isSupersededDebrief('the_hoarder', new Set(['the_hoarder', 'juicer'])),
    'the Hoarder is not superseded once the Juicer is also dead',
  );
  check(
    !isSupersededDebrief('the_hoarder', new Set(['the_hoarder'])),
    'control: the Hoarder is superseded with no later boss dead',
  );
  check(
    !isSupersededDebrief('juicer', new Set(['the_hoarder', 'juicer'])),
    'the Juicer is superseded by a boss earlier than it in the order',
  );
  check(
    !isSupersededDebrief('krakaren_clone', new Set(['the_hoarder', 'juicer', 'krakaren_clone'])),
    'the Krakaren Clone, last in the boss order, is superseded by an earlier boss',
  );
}

{
  const memoryA: DebriefMemory = {
    congratulated: true,
    namedItemIds: ['issue_kettle_helm', 'padded_gambeson'],
    boxCountsAtLastTalk: { human: 1, cat: 2 },
  };
  const memoryACopy: DebriefMemory = { ...memoryA, namedItemIds: [...memoryA.namedItemIds] };
  check(sameDebriefMemory(memoryA, memoryA), 'a memory is not equal to itself');
  check(sameDebriefMemory(memoryA, memoryACopy), 'a memory is not equal to a copy of itself');

  const carl = inventoryOf('human', ['issue_kettle_helm']);
  const donut = inventoryOf('cat', []);
  const repeatBoxes: BoxCounts = { human: 1, cat: 2 };
  const repeatState = stateOf(carl, donut, repeatBoxes);
  const repeatTalk = rememberDebriefSpoken(memoryA, repeatState);
  check(
    sameDebriefMemory(memoryA, repeatTalk),
    'a boxes-only repeat talk with unchanged counts changes the memory',
  );

  const firstCongratsTalk = rememberDebriefSpoken(EMPTY_DEBRIEF_MEMORY, repeatState);
  check(
    !sameDebriefMemory(EMPTY_DEBRIEF_MEMORY, firstCongratsTalk),
    'congratulating for the first time does not change the memory',
  );

  const newNamedItem: DebriefMemory = {
    ...memoryA,
    namedItemIds: [...memoryA.namedItemIds, 'marching_boots'],
  };
  check(
    !sameDebriefMemory(memoryA, newNamedItem),
    'a newly named item id does not change the memory',
  );

  const changedBoxCount: DebriefMemory = {
    ...memoryA,
    boxCountsAtLastTalk: { human: 2, cat: 2 },
  };
  check(
    !sameDebriefMemory(memoryA, changedBoxCount),
    'a changed box count does not change the memory',
  );
}

if (failures.length > 0) {
  console.error(`verify:mordecai-debrief — ${failures.length} of ${checks} check(s) failed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`verify:mordecai-debrief — all ${checks} checks passed`);
