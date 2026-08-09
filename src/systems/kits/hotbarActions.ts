/**
 * What pressing a hotbar slot does, in one place for every scene that has one.
 *
 * Both scenes owned a copy. The dungeon's understood potions, skill books,
 * abilities, scrolls and dynamite; the interior's understood potions and skill
 * books, and could only be reached by a mobile tap — so indoors a desktop player
 * had no hotbar at all and nobody could cast anything.
 */

import type { AbilityManager } from '../../core/AbilityManager';
import type { InventoryItem } from '../../core/ItemDefs';
import type { DynamiteSystem } from '../DynamiteSystem';
import type { SkillBookReadRequest } from '../../ui/InventoryInteraction';
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
 * Runs whatever the slot holds.
 *
 * Order is deliberate: the scene gets first refusal, then the universal item
 * kinds. A slot that means nothing here simply does nothing, rather than
 * buzzing — an empty slot is not a mistake.
 */
export function activateHotbarSlot(host: HotbarHost, hotbarIdx: number): void {
  const { pm, bus, audio } = host.world;
  const active = pm.active();
  const slot = active.inventory.actionBar.slots[hotbarIdx];
  if (slot === null) return;

  if (host.trySceneSlot?.(slot, hotbarIdx) === true) return;

  if (slot.drinkable === true) {
    const bottle: PotionSlot = { source: 'hotbar', slotIdx: hotbarIdx };
    host.menus.drinkPotion(active, slot.id, bottle);
    return;
  }

  if (slot.abilityId === 'magic_missile' && !pm.human.isActive) {
    if (pm.cat.triggerMissile()) audio?.play('cat_missile_fire');
    return;
  }

  if (slot.abilityId === 'protective_shell' && pm.human.isActive) {
    const level = pm.human.getProtectiveShellLevel();
    const cast = host.spells.triggerProtectiveShell(
      pm.human,
      pm.cat,
      host.world.roster.grid,
      level,
    );
    if (cast) {
      host.abilityManager.addUsageXp('protective_shell');
      audio?.play('human_protective_shell');
    }
    return;
  }

  if (slot.abilityId === 'smush' && pm.human.isActive) {
    if (pm.human.triggerSmush()) audio?.play('human_smush');
    return;
  }

  if (slot.id === 'scroll_of_confusing_fog') {
    host.spells.castConfusingFog(active);
    audio?.play('confusing_fog');
    return;
  }

  if (slot.id === 'goblin_dynamite' && pm.human.isActive && host.dynamite !== null) {
    if (host.dynamite.isCharging) {
      releaseDynamite(host);
      bus.emit('dynamiteUsed', { player: 'Human' });
    } else {
      host.dynamite.beginCharge(hotbarIdx);
    }
    return;
  }

  // A weapon is wielded rather than spent: the slot toggles it in and out of
  // hand, and the attack key does the shooting.
  if (slot.id === 'slingshot' && pm.human.isActive) {
    pm.human.toggleSlingshotWield();
    audio?.play('menu_click');
    return;
  }

  if (slot.skillId !== undefined) {
    // The bar belongs to the active crawler, so they are the reader even when
    // the panel is showing the companion's bag.
    const request: SkillBookReadRequest = { bookId: slot.id, skillId: slot.skillId };
    host.menus.queueSkillBookRead(request, active);
  }
}

/**
 * Lets go of a charging stick, reporting whether this slot was the one holding
 * it. Bound to key-up so the throw's power is how long the key was held.
 */
export function releaseChargedDynamite(host: HotbarHost, hotbarIdx: number): boolean {
  if (host.dynamite?.chargingHotbarIdx !== hotbarIdx) return false;
  releaseDynamite(host);
  host.world.bus.emit('dynamiteUsed', { player: 'Human' });
  return true;
}

function releaseDynamite(host: HotbarHost): void {
  const { pm, roster } = host.world;
  host.dynamite?.release(pm.human, pm.cat, roster.mobs, roster.grid);
}

/** The potion key means "any bottle you have", unlike a slot, which names one. */
export function drinkAnyHealthPotion(host: HotbarHost): void {
  host.menus.drinkPotion(host.world.pm.active(), 'health_potion', null);
}
