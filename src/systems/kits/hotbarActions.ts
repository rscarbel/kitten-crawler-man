/**
 * What pressing a hotbar slot does, in one place for every scene that has one.
 *
 * Both scenes owned a copy. The dungeon's understood potions, skill books,
 * abilities, scrolls and dynamite; the interior's understood potions and skill
 * books, and could only be reached by a mobile tap — so indoors a desktop player
 * had no hotbar at all and nobody could cast anything.
 */

import { hotbarAbilityOf } from '../../gear/gearHooks';
import type { AbilityManager } from '../../core/skills/AbilityManager';
import { castShellWithGesture, isCastingShell } from '../../creatures/humanGestures';
import { weaponStatsOf, type InventoryItem } from '../../core/items/defs/ItemDefs';
import { isThrownExplosive, type DynamiteSystem, type ThrownExplosiveId } from '../DynamiteSystem';
import type { SkillBookReadRequest } from '../../ui/screens/inventory/InventoryActions';
import type { SpellSystem } from '../SpellSystem';
import type { MenusKit, PotionSlot } from './MenusKit';
import type { SceneWorld } from './SceneWorld';

/** The collaborators a hotbar press can reach. */
export interface HotbarHost {
  readonly world: SceneWorld;
  readonly menus: MenusKit;
  readonly abilityManager: AbilityManager;
  readonly spells: SpellSystem;
  /** Null where nothing can be blown up — a scene with no `DestructionKit`. */
  readonly dynamite: DynamiteSystem | null;
  /**
   * The scene's own slots, given first refusal: the dungeon's gym equipment and
   * quest boards mean something only where those systems exist, and a scene
   * without them should not carry a branch for them.
   *
   * Returns whether the press was consumed.
   */
  readonly trySceneSlot?: (slot: InventoryItem, hotbarIdx: number) => boolean;
}

/**
 * How a press on the dynamite slot throws:
 * - `charge` — the press lights the stick and its release throws it, as hard
 *   as the press was long, the way he faces. A key or a mouse button.
 * - `ready` — the press takes an unlit stick in hand and the next tap on the
 *   world throws it there; a second press puts it away. A finger, which
 *   cannot hold a slot down and point at the target at once.
 */
export type DynamiteGrip = 'charge' | 'ready';

/** Shown the first time a stick is readied each session, then left to the player. */
const DYNAMITE_READY_HINT = 'Tap where to throw it. Tap the dynamite again to put it away.';
let dynamiteReadyHintShown = false;

/**
 * Runs whatever the slot holds.
 *
 * Order is deliberate: the scene gets first refusal, then the universal item
 * kinds. A slot that means nothing here simply does nothing, rather than
 * buzzing — an empty slot is not a mistake.
 */
export function activateHotbarSlot(
  host: HotbarHost,
  hotbarIdx: number,
  dynamiteGrip: DynamiteGrip = 'charge',
): void {
  const { pm, audio } = host.world;
  const active = pm.active();
  const slot = active.inventory.actionBar.slots[hotbarIdx];
  // Any other slot, even an empty one, takes his hand back, and the
  // readied item's own slot pressed again is the way to put it away.
  const readiedItem = host.dynamite?.readiedItem ?? null;
  if (readiedItem !== null) {
    host.dynamite?.putAway(pm.human);
    if (slot === null || slot.id === readiedItem) return;
  }
  if (slot === null) return;
  if (!active.canAct) {
    audio?.play('error_taking_action');
    return;
  }

  if (host.trySceneSlot?.(slot, hotbarIdx) === true) return;

  if (slot.drinkable === true) {
    const bottle: PotionSlot = { source: 'hotbar', slotIdx: hotbarIdx };
    host.menus.drinkPotion(active, slot.id, bottle);
    return;
  }

  if (slot.edible === true) {
    const dish: PotionSlot = { source: 'hotbar', slotIdx: hotbarIdx };
    host.menus.eatFood(active, slot.id, dish);
    return;
  }

  const ability = hotbarAbilityOf(active.inventory, slot);

  if (ability === 'magic_missile' && !pm.human.isActive) {
    if (pm.cat.triggerMissile()) audio?.play('cat_missile_fire');
    return;
  }

  if (ability === 'protective_shell' && pm.human.isActive) {
    // A press while the cooldown runs, or while his palm is still on its way
    // down, changes nothing: the dome goes up where the palm lands.
    if (host.spells.shellCooldown > 0 || isCastingShell(pm.human)) return;
    castShellWithGesture(pm.human, () => {
      const cast = host.spells.triggerProtectiveShell(
        pm.human,
        pm.cat,
        host.world.roster.grid,
        pm.human.getProtectiveShellLevel(),
      );
      if (cast) {
        host.abilityManager.addUsageXp('protective_shell');
        audio?.play('human_protective_shell');
      }
    });
    return;
  }

  if (ability === 'smush' && pm.human.isActive) {
    if (pm.human.triggerSmush()) {
      audio?.play('human_smush');
    } else if (pm.human.smushRefusedByCooldown) {
      audio?.play('error_taking_action');
    }
    return;
  }

  if (slot.id === 'scroll_of_confusing_fog') {
    host.spells.castConfusingFog(active);
    audio?.play('confusing_fog');
    return;
  }

  if (isThrownExplosive(slot.id) && pm.human.isActive && host.dynamite !== null) {
    if (host.dynamite.isCharging) {
      releaseDynamite(host);
    } else if (dynamiteGrip === 'ready') {
      readyDynamite(host, host.dynamite, slot.id);
    } else if (!host.dynamite.beginCharge(hotbarIdx, pm.human, slot.id)) {
      refuseDynamiteInSafeRoom(host);
    }
    return;
  }

  // A weapon is drawn rather than spent: the slot takes it in and out of hand,
  // and the attack key does the fighting.
  if (weaponStatsOf(slot.id) !== null && pm.human.isActive) {
    const wasDrawn = pm.human.mainHandWeaponId === slot.id;
    const drawn = pm.human.toggleWeaponDrawn(slot.id);
    if (drawn === wasDrawn) audio?.play('error_taking_action');
    return;
  }

  if (slot.skillId !== undefined) {
    // The bar belongs to the active crawler, so they are the reader even when
    // the panel is showing the companion's bag.
    const request: SkillBookReadRequest = { bookId: slot.id, skillId: slot.skillId };
    host.menus.queueSkillBookRead(request, active);
  }
}

/** What the hotbar says when a stick is lit where lighting one is refused. */
export const DYNAMITE_SAFE_ROOM_REFUSAL = 'No explosives in the safe room.';

/** Buzzes and explains a refused light, from any route that tried one. */
export function refuseDynamiteInSafeRoom(host: Pick<HotbarHost, 'world' | 'menus'>): void {
  host.world.audio?.play('error_taking_action');
  host.menus.announce(DYNAMITE_SAFE_ROOM_REFUSAL);
}

function readyDynamite(host: HotbarHost, dynamite: DynamiteSystem, item: ThrownExplosiveId): void {
  if (!dynamite.ready(host.world.pm.human, item)) {
    refuseDynamiteInSafeRoom(host);
    return;
  }
  if (dynamiteReadyHintShown) return;
  dynamiteReadyHintShown = true;
  host.menus.announce(DYNAMITE_READY_HINT);
}

/**
 * Throws a readied stick at the world point `(worldX, worldY)`, or as far as
 * he can toward it. Returns whether the tap was spent on the throw, in which
 * case it must do nothing else — no walk, no swing, no pickup.
 */
export function throwReadiedDynamiteAt(
  host: Pick<HotbarHost, 'world' | 'dynamite'>,
  worldX: number,
  worldY: number,
): boolean {
  const { pm, bus } = host.world;
  const dynamite = host.dynamite;
  const item = dynamite?.readiedItem ?? null;
  if (dynamite === null || item === null || !pm.human.isActive) return false;
  if (!dynamite.throwReadiedAt(pm.human, worldX, worldY)) return true;
  bus.emit('dynamiteUsed', { player: 'Human', item });
  return true;
}

/** What the Wayfinder's Anchor says when it is used under a roof. */
export const ANCHOR_INDOORS_REFUSAL = 'The stone needs open sky to find its way.';

/** Buzzes and explains a refused trip, from the hotbar or the bag menu. */
export function refuseAnchorIndoors(host: Pick<HotbarHost, 'world' | 'menus'>): void {
  host.world.audio?.play('error_taking_action');
  host.menus.toasts.post(ANCHOR_INDOORS_REFUSAL, { tone: 'warning', icon: 'anchor' });
}

/**
 * Lets go of a charging stick, reporting whether this slot was the one holding
 * it. Bound to key-up so the throw's power is how long the key was held.
 */
export function releaseChargedDynamite(host: HotbarHost, hotbarIdx: number): boolean {
  if (host.dynamite?.chargingHotbarIdx !== hotbarIdx) return false;
  releaseDynamite(host);
  return true;
}

/** Lets go of whatever he is charging and reports the throw. */
function releaseDynamite(host: HotbarHost): void {
  const { pm, bus } = host.world;
  const item = host.dynamite?.chargingItem ?? null;
  if (item === null) return;
  host.dynamite?.release(pm.human);
  bus.emit('dynamiteUsed', { player: 'Human', item });
}

/** The potion key means "any bottle you have", unlike a slot, which names one. */
export function drinkAnyHealthPotion(host: HotbarHost): void {
  host.menus.drinkPotion(host.world.pm.active(), 'health_potion', null);
}
