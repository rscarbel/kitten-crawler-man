/**
 * Gate for the player snapshot's held-weapon format, per-item gear state and
 * the equipped-set door every save comes through.
 *
 * A drawn weapon, a drawn sling and an empty hand must each round-trip beside
 * whatever he is wearing, stowed weapons too, and weapon copies saved before
 * weapons had an equip address must still go in a hand. `replaceAll` must drop
 * any key that names no sub-slot the crawler has, any item saved under a
 * sub-slot it does not fit, and any item the crawler could not equip, so
 * nothing sits in the map where no doll cell reaches it or that the crawler
 * could never have put on. Each piece's gear state must round-trip, and a save
 * written before it existed must read as fresh gear.
 *
 * The bag has no fixed size: a bag several pages deep must round-trip slot for
 * slot, a thousand-stack bag must serialize well under the server's smallest
 * plausible body limit, and a save holding a fixed 32 slots of whole item defs,
 * every one of them full, must load with all of them and a page to spare.
 *
 * The Third Eye's wall-clock recharge must round-trip, since a crawler is
 * rebuilt from its snapshot at every door.
 *
 *   npx tsx scripts/verify-player-snapshot.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import {
  BAG_PAGE_SLOTS,
  isWearable,
  ITEM_DEF,
  isItemId,
  MAIN_HAND_KEY,
  type InventoryItem,
  type ItemId,
} from '../src/core/items/defs/ItemDefs.js';
import {
  HUMAN_ARM_REACH_TILES,
  STORMCALLER_DAMAGE_MULTIPLIER,
} from '../src/core/items/equipment/weapons.js';
import {
  PLAYER_SNAPSHOT_VERSION,
  restorePlayer,
  snapPlayer,
  type PlayerSnapshot,
} from '../src/core/save/PlayerSnapshot.js';
import { THIRD_EYE_FORESIGHT_COOLDOWN_MS } from '../src/core/skills/tattoos.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';

const failures: string[] = [];
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (!ok) failures.push(message);
}

const SWORD: ItemId = 'stormcaller';
const SLING: ItemId = 'rattlestick_sling';
const RING: ItemId = 'fae_iron_charm';
const RING_KEY = 'Trinkets:Trinket 1';
const HOODIE: ItemId = 'lucky_hoodie';
const HOODIE_KEY = 'Torso:Jacket';
const RETIRED_KEYS = [
  'Fingers:Ring 1',
  'Hands:Ring 1',
  'Trinkets:Trinket 9',
  'Hand',
  'Hand:',
  'Hand:Main',
] as const;
/** A sub-slot only the cat has, which a human's save must never fill. */
const CAT_ONLY_KEY = 'Weapon:Claws';
/** A real sub-slot the ring does not fit, which a restore must not file it under. */
const WRONG_SUB_SLOT_KEY = 'Head:Hat';
const SAVED_AWAKENING_KILLS = 42;
const SAVED_RELIC_COOLDOWN_FRAMES = 90;
/** Express's default JSON body limit: a save that fits under it fits under any limit the server sets. */
const EXPRESS_DEFAULT_BODY_LIMIT_BYTES = 100 * 1024;
/** Stacks in the deep bag whose save size is measured. */
const DEEP_BAG_STACKS = 1000;
/** Both crawlers' snapshots ride in one save, so each must leave room for the other and the world. */
const SNAPSHOT_SHARE_OF_BODY_LIMIT = 0.5;

function humanHolding(...ids: readonly ItemId[]): HumanPlayer {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  for (const id of ids) human.inventory.addItem(id, 1);
  return human;
}

/** A snapshot of the human wearing his hoodie and the ring, with `drawn` out in his hand. */
function wearingSnapshot(drawn: ItemId | null): PlayerSnapshot {
  const human = humanHolding(SWORD, SLING, RING, HOODIE);
  human.inventory.equipByItemId(RING);
  human.inventory.equipByItemId(HOODIE);
  if (drawn !== null) human.drawWeapon(drawn);
  return snapPlayer(human);
}

function restored(snap: PlayerSnapshot): HumanPlayer {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  restorePlayer(human, snap);
  return human;
}

// ── The sword drawn and a ring worn ──────────────────────────────────────────
{
  const snap = wearingSnapshot(SWORD);
  check(snap.snapshotVersion === PLAYER_SNAPSHOT_VERSION, 'a save writes the current version');
  check(
    snap.equippedEntries.some(([key, id]) => key === MAIN_HAND_KEY && id === SWORD),
    `a save writes the sword as a ${MAIN_HAND_KEY} entry`,
  );
  const human = restored(snap);
  const equipment = human.inventory.equipment;
  check(
    equipment.getEquippedId(MAIN_HAND_KEY) === SWORD,
    `the sword comes back in ${MAIN_HAND_KEY} (found ${String(equipment.getEquippedId(MAIN_HAND_KEY))})`,
  );
  check(human.mainHandWeaponId === SWORD, 'the sword comes back drawn');
  check(equipment.getEquippedId(RING_KEY) === RING, `the ring is still worn in ${RING_KEY}`);
  check(equipment.getEquippedId(HOODIE_KEY) === HOODIE, 'the hoodie is still worn');
  check(
    human.drawnMeleeWeapon?.damageMultiplier === STORMCALLER_DAMAGE_MULTIPLIER,
    'the drawn sword strikes with its own multiplier',
  );
  check(
    human.getMeleeRange() === TILE_SIZE * HUMAN_ARM_REACH_TILES,
    'the drawn sword reaches exactly as far as his arm did',
  );
  check(
    human.getStrikeDamage() === human.getBladeDamage(),
    'the drawn sword strikes for blade damage, not a fist',
  );
}

// ── Weapon copies saved before weapons had an equip address ──────────────────
{
  /**
   * The slot copies an old save holds for its weapons, written out as the JSON
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
  };
  const oldSword: InventoryItem = {
    id: SWORD,
    name: 'The Stormcaller',
    quantity: 1,
    stackable: false,
    canHotlist: true,
    type: 'weapon',
  };
  const oldShaped = (slot: InventoryItem | null): InventoryItem | null => {
    if (slot?.id === SWORD) return oldSword;
    if (slot?.id === SLING) return oldSling;
    return slot;
  };
  const fresh = wearingSnapshot(SWORD);
  const snap: PlayerSnapshot = {
    ...fresh,
    inventorySlots: fresh.inventorySlots.map(oldShaped),
    inventoryHotbar: fresh.inventoryHotbar.map(oldShaped),
  };
  const human = restored(snap);
  check(human.mainHandWeaponId === SWORD, 'an old-shaped drawn sword comes back drawn');
  const heldCopies = [...human.inventory.bag.slots, ...human.inventory.actionBar.slots].filter(
    (slot) => slot?.id === SWORD || slot?.id === SLING,
  );
  check(
    heldCopies.length === 2 && heldCopies.every((slot) => isWearable(slot)),
    'old-shaped weapon copies can be put in a hand slot after a restore',
  );
  check(
    human.toggleWeaponDrawn(SLING) && human.mainHandWeaponId === SLING,
    'an old-shaped sling can be swapped into his hand for the sword',
  );
  human.inventory.equipment.unequip(MAIN_HAND_KEY);
  check(
    human.drawWeapon(SWORD) && human.mainHandWeaponId === SWORD,
    'an old-shaped sword can be re-equipped and drawn after his hand is emptied',
  );
}

// ── The sling drawn ──────────────────────────────────────────────────────────
{
  const human = restored(wearingSnapshot(SLING));
  check(
    human.hasSlingDrawn && human.mainHandWeaponId === SLING,
    'a drawn sling comes back drawn, taking the attack key',
  );
}

// ── Nothing in hand ──────────────────────────────────────────────────────────
{
  const human = restored(wearingSnapshot(null));
  check(
    human.inventory.equipment.getEquippedId(MAIN_HAND_KEY) === undefined &&
      human.mainHandWeaponId === null,
    'a save with empty hands leaves his main hand empty',
  );
  check(
    human.inventory.equipment.getEquippedId(RING_KEY) === RING,
    'a save with empty hands still wears the ring',
  );
}

// ── Each piece's gear state round-trips ──────────────────────────────────────
{
  const human = humanHolding(RING);
  const state = human.gear.of(RING);
  state.awakeningKills = SAVED_AWAKENING_KILLS;
  state.bound = true;
  state.floorOnceSpent = ['ninthLife'];
  state.cooldownFrames.relic = SAVED_RELIC_COOLDOWN_FRAMES;
  const back = restored(structuredClone(snapPlayer(human))).gear.of(RING);
  check(
    back.awakeningKills === SAVED_AWAKENING_KILLS &&
      back.bound &&
      back.floorOnceSpent.includes('ninthLife') &&
      back.cooldownFrames.relic === SAVED_RELIC_COOLDOWN_FRAMES,
    `a piece's gear state round-trips (got ${JSON.stringify(back)})`,
  );
  const { gearState: _dropped, ...predating } = snapPlayer(human);
  const fresh = restored(predating).gear.of(RING);
  check(
    fresh.awakeningKills === 0 && !fresh.bound && fresh.floorOnceSpent.length === 0,
    'a save predating gear state reads as fresh gear',
  );
}

// ── A stowed weapon round-trips stowed ───────────────────────────────────────
{
  const human = humanHolding(SWORD);
  check(human.drawWeapon(SWORD), 'The human can draw the sword from his bag');
  human.stowWeapon();
  check(
    human.mainHandWeaponId === null && human.mainHandWeaponId === null,
    'stowing takes the sword out of his main hand: an equipped weapon is always drawn',
  );
  const back = restored(snapPlayer(human));
  check(
    back.mainHandWeaponId === null && back.inventory.countOf(SWORD) === 1,
    'a stowed sword comes back carried, not equipped',
  );
}

// ── Any equip draws ──────────────────────────────────────────────────────────
{
  const human = humanHolding(SWORD);
  human.inventory.equipByItemId(SWORD);
  check(
    human.mainHandWeaponId === SWORD,
    'equipping the sword from the bag puts it in his hand, as a hotbar press would',
  );
}

// ── replaceAll validates keys against the sub-slots ──────────────────────────
{
  const human = humanHolding(SWORD, RING);
  const entries: [string, ItemId][] = [
    ...RETIRED_KEYS.map((key): [string, ItemId] => [key, RING]),
    [CAT_ONLY_KEY, SWORD],
    [WRONG_SUB_SLOT_KEY, RING],
    [RING_KEY, RING],
  ];
  human.inventory.equipment.replaceAll(entries);
  const kept = human.inventory.equipment.entries();
  check(
    kept.length === 1 && kept[0]?.[0] === RING_KEY,
    `only the valid key survives a restore (kept ${JSON.stringify(kept)})`,
  );

  const cat = new CatPlayer(0, 0, TILE_SIZE);
  cat.inventory.addItem(RING, 1);
  cat.inventory.equipment.replaceAll([
    [MAIN_HAND_KEY, RING],
    [RING_KEY, RING],
  ]);
  check(
    cat.inventory.equipment.getEquippedId(MAIN_HAND_KEY) === undefined &&
      cat.inventory.equipment.getEquippedId(RING_KEY) === RING,
    "The cat's restore drops a main-hand entry she has no hand for",
  );

  const catOnlyEyes: ItemId = 'kaleidoscope_specs';
  const humanOnlyCloak: ItemId = 'patched_duster';
  const humanInCatsGear = humanHolding(catOnlyEyes);
  humanInCatsGear.inventory.equipment.replaceAll([['Head:Face', catOnlyEyes]]);
  check(
    !humanInCatsGear.inventory.hasEquipped(catOnlyEyes),
    "The human's restore drops a cat-only item canEquip would refuse him",
  );
  const catInHumansGear = new CatPlayer(0, 0, TILE_SIZE);
  catInHumansGear.inventory.addItem(humanOnlyCloak, 1);
  catInHumansGear.inventory.equipment.replaceAll([['Torso:Back', humanOnlyCloak]]);
  check(
    !catInHumansGear.inventory.hasEquipped(humanOnlyCloak),
    "The cat's restore drops a human-only item canEquip would refuse her",
  );
}

{
  const nonStacking = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => !ITEM_DEF[id].stackable && ITEM_DEF[id].isQuestItem !== true);
  const packedPages = 3;
  const packed = new HumanPlayer(0, 0, TILE_SIZE);
  for (let index = 0; index < BAG_PAGE_SLOTS * (packedPages - 1); index++) {
    packed.inventory.addItem(nonStacking[index % nonStacking.length], 1);
  }
  const layout = (human: HumanPlayer): string =>
    human.inventory.bag.slots.map((slot) => slot?.id ?? '-').join(',');
  const back = restored(structuredClone(snapPlayer(packed)));
  check(
    packed.inventory.bag.pageCount === packedPages && layout(back) === layout(packed),
    'a bag several pages deep round-trips slot for slot',
  );

  const deep = new HumanPlayer(0, 0, TILE_SIZE);
  for (let index = 0; index < DEEP_BAG_STACKS; index++) {
    deep.inventory.addItem(nonStacking[index % nonStacking.length], 1);
  }
  const deepSnap = snapPlayer(deep);
  const deepBytes = Buffer.byteLength(JSON.stringify(deepSnap));
  check(
    deepBytes < EXPRESS_DEFAULT_BODY_LIMIT_BYTES * SNAPSHOT_SHARE_OF_BODY_LIMIT,
    `a ${DEEP_BAG_STACKS}-stack bag saves in ${deepBytes} bytes, well under the body limit`,
  );
  check(
    deepSnap.inventorySlots.every(
      (slot) => slot === null || Object.keys(slot).sort().join(',') === 'id,quantity',
    ),
    'a saved stack stores only its id and quantity',
  );
  const deepBack = restored(structuredClone(deepSnap));
  check(
    layout(deepBack) === layout(deep) &&
      deepBack.inventory.bag.slots.every(
        (slot) => slot === null || slot.name === ITEM_DEF[slot.id].name,
      ),
    `a ${DEEP_BAG_STACKS}-stack bag round-trips, every stack rebuilt from its def`,
  );

  const fixedSize = new Array<InventoryItem | null>(BAG_PAGE_SLOTS)
    .fill(null)
    .map((_, index) => ({ ...ITEM_DEF[nonStacking[index % nonStacking.length]], quantity: 1 }));
  const legacy = restored({
    ...snapPlayer(new HumanPlayer(0, 0, TILE_SIZE)),
    inventorySlots: fixedSize,
  });
  check(
    legacy.inventory.bag.slots.filter((slot) => slot !== null).length === BAG_PAGE_SLOTS &&
      legacy.inventory.bag.pageCount === 2 &&
      legacy.inventory.bag.slots.includes(null),
    'a full fixed-size bag from an older save loads whole, with a page to spare',
  );
}

// ── The Third Eye's recharge survives a rebuild ─────────────────────────────
{
  const seer = new HumanPlayer(0, 0, TILE_SIZE);
  seer.tattoo = 'third_eye';
  const readyAt = Date.now() + THIRD_EYE_FORESIGHT_COOLDOWN_MS;
  seer.thirdEyeReadyAt = readyAt;
  const back = restored(snapPlayer(seer));
  check(
    back.tattoo === 'third_eye' && back.thirdEyeReadyAt === readyAt,
    "the Third Eye's recharge deadline round-trips, so a door cannot reset it",
  );
}

if (failures.length > 0) {
  console.error(`verify:player-snapshot — ${failures.length} of ${checks} check(s) failed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`verify:player-snapshot — all ${checks} checks passed`);
