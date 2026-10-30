---
name: add-ability
description: Add a new player ability/spell to Kitten Crawler World — AbilityDef, 15-level XP progression, tome item, hotbar trigger, SpellSystem effect, UI wiring. Use when creating or modifying abilities like Magic Missile or Energy Shield.
---

# Add an Ability

Abilities are defined by `AbilityDef` (`src/core/skills/AbilityManager.ts`) and live in `src/abilities/*.ts`: `magicMissile.ts` (the cat's), `energyShield.ts` and `seismicStomp.ts` (the human's) are the models; `deinonychus.ts` is the pet ability, which works unlike the others. They level 1→`maxLevel` from usage XP and kill XP, unlocking perks per level. `ABILITY_DEFS` (`src/abilities/abilityDefs.ts`) is the `Record<AbilityId, AbilityDef>` every scene registers from.

## `AbilityDef` shape

`id, name, owner: 'cat' | 'human', delivery: WeaponDelivery | null, tag?, equipInstructions, baseXpToLevel2, xpGrowthRate?, finalLevelMultiplier?, usageXp, killXp, maxLevel, perks: { level, description }[], renderIcon(ctx, rect, level)`.

**Stat scaling is data.** `delivery` says how the ability's damage leaves the caster, and `DELIVERY_STAT` (`src/core/party/stats.ts`) names the stat that delivery grows with; the tome's tooltip prints "Scales with <Stat>" from it. Seismic Stomp is `'melee'` and grows with Melee; Magic Missile and Energy Shield are `'spell'` and grow with Magic. Energy Shield has no absorb pool: `energyShieldMagicScale(magic)` (`src/core/party/crawlerFormulas.ts`) multiplies its duration and its expanding blast, up to a cap. A pet ability with no damage of its own takes `null`. Put the formula that turns the stat into the effect in `crawlerFormulas.ts` beside the others, with named, capped constants, and add the stat's effect to that stat's `effectLine` in `STAT_DEFS` if a player would not guess it.

**One resolver sizes every hit.** Describe each hit the ability deals as a `CrawlerHit` (`src/core/combat/outgoingHit.ts`) and land what `resolveCrawlerHit` returns with `Mob.takeHit`. `takeDamageFrom` refuses a crawler attacker, `takeCreditedDamage` needs a hireling striker and `takeOwnedHarm` only takes a named `OwnedHarmSource` (reflect gear, a structure it built), so an ability hit can skip the resolver only by deliberately naming a striker or a source, never by accident. A hit that lands later than it was set going (a thrown charge) captures its stat with `captureDeliveryStat` and uses `delivery: 'captured'`. The record names its `delivery` and a `blowAt(stat)` formula, and the resolver supplies the stat `DELIVERY_STAT` picks, so the tooltip's "Scales with" line and the damage cannot disagree; a pulse of fixed strength is `delivery: 'unscaled'` with a `blow`. Its `DamageTags` (`MAGIC_HIT` for a spell, `FIRE_HIT` for flame, `EXPLOSION_HIT` for a blast, from `src/core/combat/damageTags.ts`) decide which proficiency skills boost and train from it. Energy Shield's helpers in `src/abilities/energyShield.ts` (`energyShieldPulse`, `energyShieldBlast`) and Seismic Stomp's `seismicStompHit` in `CombatSystem.ts` (untagged: a stomp is no weapon) are the models.

## End-to-end checklist

1. **Id**: add to the `AbilityId` union in `src/core/skills/AbilityManager.ts`.
2. **Def file**: create `src/abilities/<name>.ts` exporting `<NAME>_DEF: AbilityDef`, a `get<Name>Stats(level)` function (per-level tuning table), and `render<Name>Icon` delegating to `drawSpriteKey(ctx, '<name>_icon', state, 0, ...)` — state `full_power` at max level, else `standard`.
3. **Icon sprite**: add `<name>_icon` to `src/images/effects/manifest.json` with `standard`/`full_power` states (see `add-sprite`).
4. **Register**: add `<name>: <NAME>_DEF` to `ABILITY_DEFS`; `DungeonScene` registers every entry.
5. **Tome item**: abilities reach the hotbar via a granting item with `abilityId: '<name>'` and `canDrop: false` in `ItemDefs.ts`, plus its `ITEM_ICONS` entry (see `add-item`).
6. **Trigger**: add a branch in `activateHotbarSlot` (`src/systems/kits/hotbarActions.ts`) matching `slot.abilityId` — gate on the owning character being active (`human.isActive` / `!human.isActive`), fire the effect, call `abilityManager.addUsageXp(id)`, play a sound.
7. **Effect**: area/persistent effects live in `src/systems/SpellSystem.ts` (energy shield, fog — trigger/update/render methods); projectile-style effects live on the player class (`cat.triggerMissile`, `human.triggerSeismicStomp`). Scale the effect with `getLevel(id)` via `get<Name>Stats(level)`.
8. **Kill XP**: grant `addKillXp` in the `mobKilled` handler in `DungeonScene` when the kill came from this ability.
9. **UI**: level-up dialog is automatic via `AbilityManager.onLevelUp` (a direct callback, not the EventBus). `ABILITY_IDS` in `src/core/skills/AbilityManager.ts` (what `isAbilityId` reads, and what puts it on the pause screen's Abilities page, `src/ui/screens/pause/abilitiesSection.ts`) is a `Record<AbilityId, true>`, so the compiler asks for the new id. If the ability has a cooldown, set it each frame in `MenusKit.itemCooldowns` (keyed by ability id, as `DungeonScene` and `BuildingInteriorScene` do for the others) so its hotbar slot shows the sweep.

## Leveling mechanics (no changes needed)

`AbilityManager.grantXp` computes thresholds as `baseXpToLevel2 * xpGrowthRate^(N-1)` with `finalLevelMultiplier` for the last level. XP enters via `addUsageXp` / `addKillXp` / `addXp`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
