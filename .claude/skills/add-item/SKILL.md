---
name: add-item
description: Add a new item to Kitten Crawler Man — definition, icon, hotbar use behavior, equipment, loot drops, shop stock. Use when creating consumables, armor, quest items, or changing inventory/loot/shop behavior.
---

# Add an Item

Master registry: `src/core/ItemDefs.ts`. Items are ids in the `ItemId` union with an entry in `ITEM_DEF: Record<ItemId, Omit<InventoryItem, 'quantity'>>`.

## `InventoryItem` shape

`id, name, stackable, canHotlist`, plus optional: `type: 'consumable' | 'armor'`, `equipSlot` (`Head|Torso|Legs|Feet|Hands`), `equipSubSlot` (see `EQUIP_SUBSLOTS`), `description`, `statBonus: { constitution?, strength?, intelligence? }`, `abilityId` (links item → ability, for tomes), `isQuestItem`, `canDrop`, `regenMultiplier`.

## End-to-end checklist

1. **Define**: add the id to the `ItemId` union and an entry to `ITEM_DEF` in `src/core/ItemDefs.ts`.
2. **Icon**: add a branch in `InventoryPanel.renderItemIcon` (`src/ui/InventoryPanel.ts`) — a per-`item.id` chain of procedural canvas drawing. Alternatively add a sprite to `src/images/effects/manifest.json` and draw via `drawSpriteKey` (the tome-icon pattern).
3. **Use behavior** (if activatable): add a branch in `DungeonScene.triggerHotbarActivation` (`src/scenes/DungeonScene.ts`) — the single dispatch hub keyed on `slot.id` / `slot.abilityId`. There is **no generic consume-on-use**: call `inventory.removeOne(id)` explicitly, apply the effect, play a sound, and emit an EventBus event if other systems care. Number keys 1–8 route here via `DungeonInputHandler`.
4. **Equipment** (if armor): set `type: 'armor'`, `equipSlot`, `equipSubSlot`, `statBonus`. Equip/unequip/drop is handled generically by `InventoryActionSystem` + `EquipmentManager` — no per-item code. Equipment is tracked by ItemId keyed on `"Slot:SubSlot"`.
5. **Loot** (if dropped by mobs): add to the base drop table in `Mob.rollLootItems` (`src/creatures/Mob.ts`) or override `rollLootItems` in a specific creature (see `Goblin`'s dynamite). `LootSystem` handles ground TTL and proximity/click pickup automatically. Boss drops flow through the `mobKilled` handler in `DungeonScene`.
6. **Shop** (if purchasable): add a `{ id, label, price, desc }` entry to `SHOP_ITEMS` in `src/systems/ShopSystem.ts`, with the price as a named constant. Buying already guards on coins and inventory space.

## Storage mechanics (usually no changes needed)

`Inventory` (`src/core/Inventory.ts`) is a facade over `ItemBag` (32 slots), `Hotbar` (8 slots), and equipment. `addItem` routes quest items to the reserved quest slot, otherwise stacks hotbar → bag → first empty. `stackable` and `canHotlist` in the item def drive stacking and hotbar placement.

Finish with the `dev-workflow` gates (typecheck, lint, format).
