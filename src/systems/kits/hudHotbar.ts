/**
 * The hotbar's slots as the HUD shows them: what each holds, whether it is in
 * hand, and how much of a cooldown is left. Read from the cooldowns every
 * gameplay scene shares through `MenusKit`.
 */

import type { Inventory } from '../../core/Inventory';
import type { ItemId } from '../../core/ItemDefs';
import type { HotbarInput, HotbarSlotModel } from '../../ui/hud/hudModel';
import type { ItemCooldown } from '../../ui/screens/inventory/inventoryTypes';
import { activeInputMode } from '../../ui/core/inputMode';
import { activateHotbarSlot, releaseChargedDynamite, type HotbarHost } from './hotbarActions';

const FRAMES_PER_SECOND = 60;
/** Above this the number stops being a count and starts being a wall of digits. */
const COOLDOWN_SECONDS_SHOWN_MAX = 99;
const COOLDOWN_OVERFLOW_LABEL = '…';

/**
 * Each hotbar slot of `inventory`'s bar.
 *
 * @param drawnWeaponId The weapon the bar's owner has drawn, which reads on
 *   the bar exactly like worn gear: it is in hand and it is not being spent.
 * @param heldItemId Something else in hand and not yet spent — a readied
 *   stick of dynamite — which reads the same way.
 */
export function hotbarSlotModels(
  cooldowns: ReadonlyMap<string, ItemCooldown>,
  inventory: Inventory,
  drawnWeaponId: ItemId | null,
  heldItemId: ItemId | null = null,
): HotbarSlotModel[] {
  return inventory.actionBar.slots.map((item) => {
    // Keyed by ability first, item id second, so a plain item with a cooldown
    // of its own — the Wayfinder's Anchor — wears the same sweep as an ability.
    const cooldownKey = item?.abilityId ?? item?.id;
    const cd = cooldownKey === undefined ? undefined : cooldowns.get(cooldownKey);
    const remaining = cd === undefined || cd.max <= 0 ? 0 : Math.max(0, cd.current) / cd.max;
    const seconds = cd === undefined ? 0 : Math.ceil(cd.current / FRAMES_PER_SECOND);
    return {
      item,
      equipped:
        item !== null && (item.id === heldItemId || inventory.showsInUse(item.id, drawnWeaponId)),
      cooldown: Math.min(1, remaining),
      cooldownLabel:
        seconds > COOLDOWN_SECONDS_SHOWN_MAX ? COOLDOWN_OVERFLOW_LABEL : String(seconds),
      unseen: item !== null && inventory.unseenUpgrades.has(item.id),
    };
  });
}

/**
 * The HUD hotbar's input: a slot fires as it is pressed. With a mouse, the
 * press's end throws a stick of dynamite the press began charging, so holding
 * the slot winds the throw up the way holding its key does; with a finger the
 * press takes the stick in hand and a tap on the world throws it. A world
 * halted under a menu takes no slot.
 */
export function hotbarPressInput(host: () => HotbarHost, worldHalted: () => boolean): HotbarInput {
  return {
    press: (index) => {
      if (worldHalted()) return;
      const dynamiteGrip = activeInputMode() === 'touch' ? 'ready' : 'charge';
      activateHotbarSlot(host(), index, dynamiteGrip);
    },
    release: (index) => {
      releaseChargedDynamite(host(), index);
    },
  };
}
