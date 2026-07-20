---
name: add-ability
description: Add a new player ability/spell to Kitten Crawler Man — AbilityDef, 15-level XP progression, tome item, hotbar trigger, SpellSystem effect, UI wiring. Use when creating or modifying abilities like Magic Missile or Protective Shell.
---

# Add an Ability

Abilities are defined by `AbilityDef` (`src/core/AbilityManager.ts`) and live in `src/abilities/*.ts` (`magicMissile.ts`, `protectiveShell.ts`, `smush.ts` are the models). They level 1→`maxLevel` from usage XP and kill XP, unlocking perks per level.

## `AbilityDef` shape

`id, name, owner: 'cat' | 'human', equipInstructions, baseXpToLevel2, xpGrowthRate?, finalLevelMultiplier?, usageXp, killXp, maxLevel, perks: { level, description }[], renderIcon(ctx, x, y, size, level)`.

## End-to-end checklist

1. **Id**: add to the `AbilityId` union in `src/core/AbilityManager.ts`.
2. **Def file**: create `src/abilities/<name>.ts` exporting `<NAME>_DEF: AbilityDef`, a `get<Name>Stats(level)` function (per-level tuning table), and `render<Name>Icon` delegating to `drawSpriteKey(ctx, '<name>_icon', state, 0, ...)` — state `full_power` at max level, else `standard`.
3. **Icon sprite**: add `<name>_icon` to `src/images/effects/manifest.json` with `standard`/`full_power` states (see `add-sprite`).
4. **Register**: `this.abilityManager.register(<NAME>_DEF)` in `DungeonScene` next to the existing three.
5. **Tome item**: abilities reach the hotbar via a granting item with `abilityId: '<name>'` and `canDrop: false` in `ItemDefs.ts`, plus an icon branch in `InventoryPanel.renderItemIcon` (see `add-item`).
6. **Trigger**: add a branch in `DungeonScene.triggerHotbarActivation` matching `slot.abilityId` — gate on the owning character being active (`human.isActive` / `!human.isActive`), fire the effect, call `abilityManager.addUsageXp(id)`, play a sound.
7. **Effect**: area/persistent effects live in `src/systems/SpellSystem.ts` (shell, fog — trigger/update/render methods); projectile-style effects live on the player class (`cat.triggerMissile`, `human.triggerSmush`). Scale the effect with `getLevel(id)` via `get<Name>Stats(level)`.
8. **Kill XP**: grant `addKillXp` in the `mobKilled` handler in `DungeonScene` when the kill came from this ability.
9. **UI**: level-up dialog is automatic via `AbilityManager.onLevelUp` (a direct callback, not the EventBus). **Add the id to the `isAbilityId` allowlist in `src/ui/pause/AbilitiesTab.ts`** or it won't appear in the equipped-abilities view. Wire cooldown display via `inventoryPanel.abilityCooldowns.set(...)` in `DungeonScene` if the ability has one.

## Leveling mechanics (no changes needed)

`AbilityManager.grantXp` computes thresholds as `baseXpToLevel2 * xpGrowthRate^(N-1)` with `finalLevelMultiplier` for the last level. XP enters via `addUsageXp` / `addKillXp` / `addXp`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
