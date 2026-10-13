/**
 * Gate for the player snapshot's held-weapon format and the equipped-set
 * door every save comes through.
 *
 * A v3 save kept the weapon in Carl's hand apart from his equipment, as
 * `wieldedWeaponId`. Loaded today it must come back as the same weapon
 * equipped in his main hand and drawn, beside whatever he was wearing; a v3
 * save with nothing in hand must leave the hand empty. The current format must
 * round-trip drawn and stowed weapons alike, and weapon copies saved before
 * weapons had an equip address must still go in a hand. `replaceAll` must drop
 * any key that names no sub-slot, any section the crawler does not have, and
 * any item the crawler could not equip, so nothing sits in the map where no
 * doll cell reaches it or that the crawler could never have put on.
 *
 *   npx tsx scripts/verify-player-snapshot.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import {
  isWearable,
  MAIN_HAND_KEY,
  type InventoryItem,
  type ItemId,
} from '../src/core/ItemDefs.js';
import { HUMAN_ARM_REACH_TILES, TARANIS_DAMAGE_MULTIPLIER } from '../src/core/weapons.js';
import {
  PLAYER_SNAPSHOT_VERSION,
  restorePlayer,
  snapPlayer,
  type PlayerSnapshot,
} from '../src/core/PlayerSnapshot.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';

const failures: string[] = [];
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (!ok) failures.push(message);
}

/** The last version that kept the weapon in hand apart from the equipment. */
const PRE_HELD_SLOT_VERSION = 3;
const SWORD: ItemId = 'fury_of_taranis';
const SLING: ItemId = 'slingshot';
const RING: ItemId = 'fairy_repellent_signet';
const RING_KEY = 'Hands:Ring 1';
const BOXERS_KEY = 'Legs:Pants';
const RETIRED_KEYS = ['Fingers:Ring 1', 'Hands:Ring 9', 'Hand', 'Hand:'] as const;
const CAT_ONLY_HELD_KEY = 'Mouth:Held';

function carlHolding(...ids: readonly ItemId[]): HumanPlayer {
  const carl = new HumanPlayer(0, 0, TILE_SIZE);
  for (const id of ids) carl.inventory.addItem(id, 1);
  return carl;
}

/**
 * A snapshot as v3 wrote it: Carl wearing his boxers and the ring, with
 * `wielded` in hand outside his equipment.
 */
function v3Snapshot(wielded: ItemId | null): PlayerSnapshot {
  const carl = carlHolding(SWORD, SLING, RING);
  carl.inventory.equipByItemId(RING);
  const current = snapPlayer(carl);
  const { weaponDrawn: _dropped, ...withoutDrawnBit } = current;
  return {
    ...withoutDrawnBit,
    snapshotVersion: PRE_HELD_SLOT_VERSION,
    equippedEntries: current.equippedEntries.filter(([key]) => key !== MAIN_HAND_KEY),
    wieldedWeaponId: wielded,
  };
}

function restored(snap: PlayerSnapshot): HumanPlayer {
  const carl = new HumanPlayer(0, 0, TILE_SIZE);
  restorePlayer(carl, snap);
  return carl;
}

// ── A v3 save with the sword wielded and a ring worn ─────────────────────────
{
  const snap = v3Snapshot(SWORD);
  check(
    snap.equippedEntries.some(([key]) => key === RING_KEY) &&
      !snap.equippedEntries.some(([key]) => key === MAIN_HAND_KEY),
    'the v3 fixture wears the ring and has no main-hand entry',
  );
  const carl = restored(snap);
  const equipment = carl.inventory.equipment;
  check(
    equipment.getEquippedId(MAIN_HAND_KEY) === SWORD,
    `a v3 wielded sword is equipped in ${MAIN_HAND_KEY} (found ${String(equipment.getEquippedId(MAIN_HAND_KEY))})`,
  );
  check(carl.drawnWeaponId === SWORD, 'a v3 wielded sword comes back drawn');
  check(equipment.getEquippedId(RING_KEY) === RING, `the v3 ring is still worn in ${RING_KEY}`);
  check(
    equipment.getEquippedId(BOXERS_KEY) === 'enchanted_bigboi_boxers',
    'the v3 boxers are still worn',
  );
  check(
    carl.drawnMeleeWeapon?.damageMultiplier === TARANIS_DAMAGE_MULTIPLIER,
    'the drawn sword strikes with its own multiplier',
  );
  check(
    carl.getMeleeRange() === TILE_SIZE * HUMAN_ARM_REACH_TILES,
    'the drawn sword reaches exactly as far as his arm did',
  );
  check(
    carl.getStrikeDamage() === carl.getBladeDamage(),
    'the drawn sword strikes for blade damage, not a fist',
  );

  const resaved = snapPlayer(carl);
  check(
    resaved.snapshotVersion === PLAYER_SNAPSHOT_VERSION && resaved.weaponDrawn === true,
    'saving him again writes the current version with the sword drawn',
  );
  check(
    resaved.equippedEntries.some(([key, id]) => key === MAIN_HAND_KEY && id === SWORD),
    'saving him again writes the sword as a main-hand entry',
  );
  const again = restored(resaved);
  check(
    again.drawnWeaponId === SWORD && again.inventory.equipment.getEquippedId(RING_KEY) === RING,
    'the current format round-trips the drawn sword and the ring',
  );
}

// ── A v3 save whose weapon copies predate held slots ─────────────────────────
{
  /**
   * The slot copies a v3 save holds for its weapons, written out as the JSON
   * was stored then: no equip address and no stat block, because the item
   * definitions had neither when the copies were taken.
   */
  const oldSling: InventoryItem = {
    id: SLING,
    name: 'Slingshot & Rocks',
    quantity: 1,
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    baseValue: 80,
  };
  const oldSword: InventoryItem = {
    id: SWORD,
    name: 'The Fury of Taranis',
    quantity: 1,
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    baseValue: 900,
  };
  const oldShaped = (slot: InventoryItem | null): InventoryItem | null => {
    if (slot?.id === SWORD) return oldSword;
    if (slot?.id === SLING) return oldSling;
    return slot;
  };
  const fresh = v3Snapshot(SWORD);
  const snap: PlayerSnapshot = {
    ...fresh,
    inventorySlots: fresh.inventorySlots.map(oldShaped),
    inventoryHotbar: fresh.inventoryHotbar.map(oldShaped),
  };
  const carl = restored(snap);
  check(carl.drawnWeaponId === SWORD, 'an old-shaped wielded sword comes back drawn');
  const heldCopies = [...carl.inventory.bag.slots, ...carl.inventory.actionBar.slots].filter(
    (slot) => slot?.id === SWORD || slot?.id === SLING,
  );
  check(
    heldCopies.length === 2 && heldCopies.every((slot) => isWearable(slot)),
    'old-shaped weapon copies can be put in a hand slot after a restore',
  );
  check(
    carl.toggleWeaponDrawn(SLING) && carl.drawnWeaponId === SLING,
    'an old-shaped sling can be swapped into his hand for the sword',
  );
  carl.inventory.equipment.unequip(MAIN_HAND_KEY);
  check(
    carl.drawWeapon(SWORD) && carl.mainHandWeaponId === SWORD,
    'an old-shaped sword can be re-equipped and drawn after his hand is emptied',
  );
}

// ── A v3 save with the sling wielded ─────────────────────────────────────────
{
  const carl = restored(v3Snapshot(SLING));
  check(
    carl.hasSlingDrawn && carl.drawnWeaponId === SLING,
    'a v3 wielded sling comes back drawn, taking the attack key',
  );
}

// ── A v3 save with nothing in hand ───────────────────────────────────────────
{
  const carl = restored(v3Snapshot(null));
  check(
    carl.inventory.equipment.getEquippedId(MAIN_HAND_KEY) === undefined &&
      carl.drawnWeaponId === null,
    'a v3 save with empty hands leaves his main hand empty',
  );
  check(
    carl.inventory.equipment.getEquippedId(RING_KEY) === RING,
    'a v3 save with empty hands still wears the ring',
  );
}

// ── A stowed weapon round-trips stowed ───────────────────────────────────────
{
  const carl = carlHolding(SWORD);
  check(carl.drawWeapon(SWORD), 'Carl can draw the sword from his bag');
  carl.stowWeapon();
  check(
    carl.drawnWeaponId === null && carl.mainHandWeaponId === SWORD,
    'stowing leaves the sword in his main hand, not drawn',
  );
  const back = restored(snapPlayer(carl));
  check(
    back.mainHandWeaponId === SWORD && back.drawnWeaponId === null,
    'a stowed sword comes back equipped and stowed',
  );
}

// ── replaceAll validates keys against the sub-slots ──────────────────────────
{
  const carl = carlHolding(SWORD, RING);
  const entries: [string, ItemId][] = [
    ...RETIRED_KEYS.map((key): [string, ItemId] => [key, RING]),
    [CAT_ONLY_HELD_KEY, SWORD],
    [RING_KEY, RING],
  ];
  carl.inventory.equipment.replaceAll(entries);
  const kept = carl.inventory.equipment.entries();
  check(
    kept.length === 1 && kept[0]?.[0] === RING_KEY,
    `only the valid key survives a restore (kept ${JSON.stringify(kept)})`,
  );

  const donut = new CatPlayer(0, 0, TILE_SIZE);
  donut.inventory.addItem(RING, 1);
  donut.inventory.equipment.replaceAll([
    [MAIN_HAND_KEY, RING],
    [RING_KEY, RING],
  ]);
  check(
    donut.inventory.equipment.getEquippedId(MAIN_HAND_KEY) === undefined &&
      donut.inventory.equipment.getEquippedId(RING_KEY) === RING,
    "Donut's restore drops a main-hand entry she has no hand for",
  );

  const catOnlyEyes: ItemId = 'eyes_of_splatter';
  const humanOnlyCloak: ItemId = 'nightgaunt_cloak';
  const carlInDonutsGear = carlHolding(catOnlyEyes);
  carlInDonutsGear.inventory.equipment.replaceAll([['Head:Face', catOnlyEyes]]);
  check(
    !carlInDonutsGear.inventory.hasEquipped(catOnlyEyes),
    "Carl's restore drops a cat-only item canEquip would refuse him",
  );
  const donutInCarlsGear = new CatPlayer(0, 0, TILE_SIZE);
  donutInCarlsGear.inventory.addItem(humanOnlyCloak, 1);
  donutInCarlsGear.inventory.equipment.replaceAll([['Torso:Back', humanOnlyCloak]]);
  check(
    !donutInCarlsGear.inventory.hasEquipped(humanOnlyCloak),
    "Donut's restore drops a human-only item canEquip would refuse her",
  );
}

if (failures.length > 0) {
  console.error(`verify:player-snapshot — ${failures.length} of ${checks} check(s) failed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`verify:player-snapshot — all ${checks} checks passed`);
