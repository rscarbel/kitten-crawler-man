/**
 * The one entry point per trait hook: each walks a crawler's worn traits — her
 * pieces' own, and the bonuses of every set she has enough of on — and runs
 * the hook on every trait whose handler has it. Combat, the player and
 * `GearSystem` call these and never look at an item id.
 */

import type { EquipmentChange } from '../core/items/equipment/EquipmentManager';
import { isAbilityId, type AbilityId } from '../core/skills/AbilityManager';
import type { Inventory } from '../core/items/inventory/Inventory';
import {
  clawStatsOf,
  ITEM_DEF,
  type InventoryItem,
  type ItemId,
} from '../core/items/defs/ItemDefs';
import type { ClawWeaponStats } from '../core/items/equipment/weapons';
import type { Mob } from '../creatures/Mob';
import { ALL_STATS, type Player, type StatName } from '../Player';
import type { ActiveTrait, WornGearCache } from './gearState';
import { activeSetBonuses, wornSets } from './setProgress';
import {
  addModifiers,
  NO_GEAR_MODIFIERS,
  traitHandler,
  type GearHit,
  type GearHookContext,
  type GearHurt,
  type GearKill,
  type GearModifiers,
  type GearStrike,
  type GearSwing,
  type GearTick,
  type GearTrait,
  type GearTraitKind,
  type GearTraitOf,
  type IncomingShot,
} from './traits';

/** One trait a crawler is wearing, with the piece that carries it. */
export interface WornTrait {
  readonly ctx: GearHookContext;
  readonly trait: GearTrait;
}

/** Everything that is read off a wearer to run its gear. */
export type GearWearer = Pick<Player, 'inventory' | 'gear'>;

/** The traits `id` carries in its current state: its own, plus its awakened ones once awakened. */
export function itemTraits(id: ItemId, awakened: boolean): GearTrait[] {
  const own = ITEM_DEF[id].traits ?? [];
  if (!awakened) return [...own];
  const awakenedTraits = own.flatMap((trait) =>
    trait.kind === 'awakening' ? trait.awakensTo : [],
  );
  return [...own, ...awakenedTraits];
}

/** Builds everything derived from what `wearer` has on, at the revisions it is read at. */
function buildWornCache(wearer: GearWearer): WornGearCache {
  const equipment = wearer.inventory.equipment;
  const equipped = [...equipment.equippedIds()];
  const traits: ActiveTrait[] = [];
  for (const itemId of equipped) {
    for (const trait of itemTraits(itemId, wearer.gear.of(itemId).awakened)) {
      traits.push({ itemId, trait });
    }
  }
  const setStatBonus: Record<StatName, number> = {
    strength: 0,
    intelligence: 0,
    constitution: 0,
    dexterity: 0,
  };
  for (const [set, worn] of wornSets(equipped)) {
    const holder = equipped.find((id) => ITEM_DEF[id].set === set);
    if (holder === undefined) continue;
    for (const bonus of activeSetBonuses(set, worn)) {
      for (const trait of bonus.traits ?? []) traits.push({ itemId: holder, trait });
      for (const stat of ALL_STATS) setStatBonus[stat] += bonus.statBonus?.[stat] ?? 0;
    }
  }
  let modifiers = NO_GEAR_MODIFIERS;
  for (const { trait } of traits)
    modifiers = addModifiers(modifiers, traitModifiers(trait.kind, trait));
  let claws: ClawWeaponStats | null = null;
  for (const id of equipped) claws ??= clawStatsOf(id);
  return {
    equipmentRevision: equipment.revision,
    gearRevision: wearer.gear.revision,
    traits,
    modifiers,
    setStatBonus,
    claws,
  };
}

/**
 * What `wearer` has on, derived once per change to it: her pieces' traits and
 * the bonuses of every set she has enough of on, their passive totals, and her
 * claws. Rebuilt whenever the equipped set or what its pieces carry changes.
 */
function wornCache(wearer: GearWearer): WornGearCache {
  const cached = wearer.gear.wornCache;
  const fresh =
    cached !== null &&
    cached.equipmentRevision === wearer.inventory.equipment.revision &&
    cached.gearRevision === wearer.gear.revision;
  if (fresh) return cached;
  const built = buildWornCache(wearer);
  wearer.gear.wornCache = built;
  return built;
}

/** Every trait on everything `wearer` has equipped, set bonuses included. */
export function wornTraits(wearer: Player): WornTrait[] {
  return wornCache(wearer).traits.map(({ itemId, trait }) => ({
    ctx: { wearer, itemId, state: wearer.gear.of(itemId) },
    trait,
  }));
}

/** The passive numbers everything `wearer` has equipped adds up to. */
export function gearModifiers(wearer: GearWearer): GearModifiers {
  return wornCache(wearer).modifiers;
}

/**
 * What worn gear adds to `stat` beyond each piece's own bonus: the stat
 * bonuses of every set bonus switched on, and a partner link while it holds.
 */
export function gearStatBonus(wearer: GearWearer, stat: StatName): number {
  return wornCache(wearer).setStatBonus[stat] + wearer.gear.live.partnerLinkStatBonus;
}

/** The share of her max HP worn curses leave a crawler, 1 when nothing worn is cursed. */
export function gearMaxHpScale(wearer: GearWearer): number {
  return Math.max(0, 1 - gearModifiers(wearer).maxHpPenaltyShare);
}

/**
 * How much of a kill's or a chest's coins `crawler` collects, as a multiplier
 * on the base payout: 1 plus every worn coin bonus. Chest payouts read this
 * for whoever is paid; kills apply it in {@link runKillHooks}.
 */
export function coinBonusFor(crawler: GearWearer): number {
  return 1 + gearModifiers(crawler).coinBonusShare;
}

/** The claws `wearer` has over her paws, or null when she swipes bare-pawed. */
export function wornClaws(wearer: GearWearer): ClawWeaponStats | null {
  return wornCache(wearer).claws;
}

function traitModifiers<K extends GearTraitKind>(
  kind: K,
  trait: GearTraitOf<K>,
): Partial<GearModifiers> {
  return traitHandler(kind).modifiers?.(trait) ?? {};
}

function meleeHit<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  hit: GearHit,
): void {
  traitHandler(kind).onMeleeHit?.(ctx, trait, hit);
}

function spellHit<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  hit: GearHit,
): void {
  traitHandler(kind).onSpellHit?.(ctx, trait, hit);
}

function strikeMultiplier<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  strike: GearStrike,
): number {
  return traitHandler(kind).strikeMultiplier?.(ctx, trait, strike) ?? 1;
}

function swing<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  swung: GearSwing,
): void {
  traitHandler(kind).onSwing?.(ctx, trait, swung);
}

function kill<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  killed: GearKill,
): void {
  traitHandler(kind).onKill?.(ctx, trait, killed);
}

function hurt<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  taken: GearHurt,
): number {
  return traitHandler(kind).onHurt?.(ctx, trait, taken) ?? taken.damage;
}

function afterHurt<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  damageTaken: number,
): void {
  traitHandler(kind).afterHurt?.(ctx, trait, damageTaken);
}

function struck<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  attacker: Mob,
): void {
  traitHandler(kind).onStruck?.(ctx, trait, attacker);
}

function rangedIncoming<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  shot: IncomingShot,
): boolean {
  return traitHandler(kind).onRangedIncoming?.(ctx, trait, shot) ?? false;
}

function tick<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
  ticked: GearTick,
): void {
  traitHandler(kind).onTick?.(ctx, trait, ticked);
}

function equipped<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
): void {
  traitHandler(kind).onEquip?.(ctx, trait);
}

function unequipped<K extends GearTraitKind>(
  kind: K,
  ctx: GearHookContext,
  trait: GearTraitOf<K>,
): void {
  traitHandler(kind).onUnequip?.(ctx, trait);
}

/** Runs every worn trait's hit hook for one landed blow (melee) or missile (spell). */
export function runHitHooks(wearer: Player, hit: GearHit): void {
  for (const { ctx, trait } of wornTraits(wearer)) {
    if (hit.delivery === 'melee') meleeHit(trait.kind, ctx, trait, hit);
    else spellHit(trait.kind, ctx, trait, hit);
  }
}

/** The multiple every worn trait puts on a blow `wearer` is about to land on `strike.mob`. */
export function runStrikeHooks(wearer: Player, strike: GearStrike): number {
  let multiplier = 1;
  for (const { ctx, trait } of wornTraits(wearer)) {
    multiplier *= strikeMultiplier(trait.kind, ctx, trait, strike);
  }
  return multiplier;
}

/**
 * Runs every worn trait's swing hook for one melee swing, and leaves the
 * worn claws' trail hanging behind it.
 */
export function runSwingHooks(wearer: Player, swung: GearSwing): void {
  const trail = wornClaws(wearer)?.trail ?? null;
  if (trail !== null) {
    wearer.gear.live.queueFx({
      kind: 'clawTrail',
      trail,
      x: swung.originX,
      y: swung.originY,
      dirX: swung.dirX,
      dirY: swung.dirY,
      reachPx: swung.reachPx,
    });
  }
  for (const { ctx, trait } of wornTraits(wearer)) swing(trait.kind, ctx, trait, swung);
}

/** Runs every worn trait's kill hook, then pays the killer's coin bonus on what the mob dropped. */
export function runKillHooks(wearer: Player, killed: GearKill): void {
  for (const { ctx, trait } of wornTraits(wearer)) kill(trait.kind, ctx, trait, killed);
  const loot = killed.mob.droppedLoot;
  if (loot !== null && loot.coins > 0) loot.coins = Math.round(loot.coins * coinBonusFor(wearer));
}

/**
 * The damage `wearer` takes after every worn trait has had its say, in wearing
 * order; then every trait that reacts to what a blow cost is told the final
 * figure, so a reaction never reads a blow a later trait still changed.
 */
export function runHurtHooks(wearer: Player, taken: GearHurt): number {
  const worn = wornTraits(wearer);
  let damage = taken.damage;
  for (const { ctx, trait } of worn) {
    damage = hurt(trait.kind, ctx, trait, { ...taken, damage });
  }
  for (const { ctx, trait } of worn) afterHurt(trait.kind, ctx, trait, damage);
  return damage;
}

/** Runs every worn trait's hook for a mob's contact blow that just landed on `wearer`. */
export function runStruckHooks(wearer: Player, attacker: Mob): void {
  for (const { ctx, trait } of wornTraits(wearer)) struck(trait.kind, ctx, trait, attacker);
}

/** Whether anything `wearer` has on swallows a ranged blow about to reach her; the first that can, does. */
export function runRangedWardHooks(wearer: Player, shot: IncomingShot): boolean {
  for (const { ctx, trait } of wornTraits(wearer)) {
    if (rangedIncoming(trait.kind, ctx, trait, shot)) return true;
  }
  return false;
}

export function runTickHooks(wearer: Player, ticked: GearTick): void {
  for (const { ctx, trait } of wornTraits(wearer)) tick(trait.kind, ctx, trait, ticked);
}

function runEquipHooks(wearer: Player, id: ItemId, put: 'on' | 'off'): void {
  const state = wearer.gear.of(id);
  const ctx: GearHookContext = { wearer, itemId: id, state };
  for (const trait of itemTraits(id, state.awakened)) {
    if (put === 'on') equipped(trait.kind, ctx, trait);
    else unequipped(trait.kind, ctx, trait);
  }
}

/**
 * Runs the unequip hooks of whatever a change took off and the equip hooks of
 * whatever it put on. A restore is skipped: it puts back gear whose own state
 * is restored with it, so nothing was really put on or taken off.
 */
export function runEquipChangeHooks(wearer: Player, change: EquipmentChange): void {
  if (change.reason === 'restore') return;
  if (change.removedItemId !== null) runEquipHooks(wearer, change.removedItemId, 'off');
  if (change.itemId !== null) runEquipHooks(wearer, change.itemId, 'on');
}

/** The ability `id` grants while worn, worn or not: what its hotbar slot's cooldown sweep is keyed on. */
export function grantedAbility(id: ItemId): AbilityId | null {
  for (const trait of ITEM_DEF[id].traits ?? []) {
    if (trait.kind === 'grantsAbility') return trait.ability;
  }
  return null;
}

/**
 * The ability a hotbar slot casts: a tome's own, or the one a piece grants
 * while it is worn. Null for a piece that grants one but sits unworn.
 */
export function hotbarAbilityOf(inventory: Inventory, slot: InventoryItem): AbilityId | null {
  if (slot.abilityId !== undefined) return isAbilityId(slot.abilityId) ? slot.abilityId : null;
  return inventory.equipment.isEquipped(slot.id) ? grantedAbility(slot.id) : null;
}

/** The key a hotbar slot's cooldown sweep is read under: its ability's, else its own id. */
export function cooldownKeyOf(slot: InventoryItem): string {
  return slot.abilityId ?? grantedAbility(slot.id) ?? slot.id;
}
