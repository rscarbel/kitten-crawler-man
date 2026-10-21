# Design Debt

Places where the code is hacky, fragile, breaks a common industry practice, or will make later work harder. This is a long-lived register: entries come and go, and the file stays. An entry that matters gets its own plan; once that ships, the entry is deleted.

## Adding an entry

- Record what you find while doing other work, even if you can't fix it. Small fixes that are in scope for your task (a CLAUDE.md type-safety violation, a magic number in a file you're editing) are still fixed, not logged.
- Search this file first. If the problem is already here, extend that entry; don't add a second one.
- Describe the code as it is now. Point at files, functions, classes, constants or a quoted fragment — never line numbers, never a plan doc, never a conversation or task.
- Put the entry under the closest area heading. Add a heading if none fits.
- Delete the entry when the problem is gone. Don't mark it done.
- Never cite this file from code.

Entry shape:

```markdown
### <short name of the problem>

- **Where:** files, functions, constants.
- **Problem:** what is wrong, as a fact about the code now.
- **Cost:** what it makes harder or riskier, or which standard it breaks.
- **Better shape:** the direction a fix should take, in a sentence or two. Not a plan.
- **Until then:** what to avoid so it doesn't get worse. Omit if nothing.
- **Size:** S (an hour), M (a day), L (several days or a cross-cutting change).
- **Found:** YYYY-MM-DD, and the work that surfaced it.
```

---

## Creatures and spawning

### Mob kinds are untyped strings with a silent goblin fallback

- **Where:** `createMob` in `src/levels/spawner.ts` (`type: string`), `MOB_REGISTRY`, every `MobSpawnRule.type`.
- **Problem:** a kind is any string. An unknown one logs a one-time warning and spawns a Goblin.
- **Cost:** a typo in a spawn table compiles, passes the type checks and ships as the wrong creature.
- **Better shape:** derive a `MobKind` union from the registry and type every spawn table and `createMob` with it, so an unknown kind is a compile error and the fallback goes away.
- **Size:** M
- **Found:** 2026-10-21, variety tiers research.

### Hostile mobs are built in many places outside the registry

- **Where:** direct `new <MobClass>(...)` in:
  - `bountyDefs.ts`
  - `CircusQuestSystem` (`WaveSpawn.make`)
  - `SpiderQuestSystem`
  - `BossRoomSystem`, `HoarderRoomSystem`
  - `SkeletonSummonSystem`
  - `createUndead` in `VillageAssaultSystem`
  - `DefendQuestSystem`
  - `MurderMysteryQuestSystem`
  - `QuillConfrontationSystem`
  - `interiorHostiles`
  - the prison and tutorial systems
- **Problem:** `createMob` is one of many entry points. The only shared step, `MobRoster.add`, runs after construction.
- **Cost:** anything that has to apply to every spawn has no single place to live: prewarm, levelling, substitution, look selection, accounting. Each new rule gets patched into a dozen sites, or quietly misses some.
- **Better shape:** one spawn funnel that every hostile kind goes through, with a check that fails on a hostile `new` outside the registry factories.
- **Until then:** don't add new direct constructions of hostile kinds.
- **Size:** L
- **Found:** 2026-10-21, variety tiers research.

### A mob's look is fixed in its class

- **Where:** each `Mob` subclass's `drawSelf` (for example `Goblin.drawSelf` → `drawGoblinSprite` → `GOBLIN_FIGURES[archetype]`), and variant picks inside constructors and registry factories (`pickGoblinWeapon`, `randomSkyfowlToughLookId`, `RaisedRatkin` `pickLook`, cow coats).
- **Problem:** what a mob looks like and how its variant is chosen are hard-coded per class. Some picks happen inside the constructor.
- **Cost:** sharing a look between kinds, reducing variety under memory pressure, or reskinning means editing each class. Variant picks can't be driven from outside.
- **Better shape:** variants as data: a variant family per kind, resolved by the spawn funnel and handed to the constructor. `drawSelf` draws the figure its variant names. Hirelings (`MercenaryTemplate.art` → `MERCENARY_ART`) already work this way.
- **Size:** L
- **Found:** 2026-10-21, variety tiers research.

### Threat has no representation in code

- **Where:** spawn tables (`MobSpawnRule`), `ASSAULT_WAVES`, bounty escort lists. A comment in `mobLevelScaling.ts` defines threat as damage × cadence × hit-rate × count, but nothing computes it.
- **Problem:** encounter difficulty is only hand-authored counts and chances per kind.
- **Cost:** anything that needs to compare enemies has nothing to compare: swapping one kind for another, budgeting a wave, scaling an encounter. Every such feature invents its own numbers.
- **Better shape:** a threat value on each kind's registry entry, derived by one documented method.
- **Size:** M
- **Found:** 2026-10-21, variety tiers research.

### `MobSpawnRule.config` is documented but never read

- **Where:** `MobSpawnRule` in `src/levels/types.ts` ("Optional per-mob config forwarded to the constructor").
- **Problem:** `createMob` never forwards it, and nothing reads it.
- **Cost:** its JSDoc lies about behaviour, and someone setting it gets nothing. It is also dead code.
- **Better shape:** delete it. If per-rule constructor options are ever needed, type them per kind.
- **Size:** S
- **Found:** 2026-10-21, variety tiers research.

### Spawn-time randomness bypasses seeded streams

- **Where:** `Math.random` in `pickRule` and spawn scatter in `src/levels/spawner.ts`; registry factories that roll the goblin weapon, cow coat and sky fowl look; the siege's live `random` (`deps.random ?? Math.random`).
- **Problem:** a lot of spawn variation is unseeded.
- **Cost:** harnesses can't reproduce a spawn exactly, and a gate that depends on these rolls is flaky.
- **Better shape:** thread a seeded random source through spawning, the way the siege's `assaultRandom` dependency already allows for harnesses.
- **Size:** M
- **Found:** 2026-10-21, variety tiers research.

### Siege roster tables must be kept in step by hand

- **Where:** `ASSAULT_WAVES` (`VillageAssaultSystem.ts`), `assaultWaveRoster` / `ROSTER_KIND_ROWS` / `isAssaultRosterKind` (`src/sprites/assaultPrewarm.ts`), `MOB_PREWARM` / `MOB_SPRITE_KEYS` (`src/core/assetGroups.ts`).
- **Problem:** which kinds the siege spawns and which figures its countdown warms are separate lists.
- **Cost:** adding or changing a siege kind in one table and not the others gives cold figures, which show as stand-ins or a hitch, mid-siege.
- **Better shape:** warm the siege from the kinds it actually plans, with the rows each kind needs declared on its registry entry.
- **Size:** M
- **Found:** 2026-10-21, variety tiers research.

## Rendering and memory

### One lost canvas context runs two full recoveries, each back to the same peak

- **Where:** `src/core/canvasRecovery.ts` (the `contextlost` / `contextrestored` listeners on the sentinel and the main canvas, `runPurgeCheck`, `runCanvasRecovery`), `repaintAllEnvironmentArt` in `src/map/environmentArtCache.ts`.
- **Problem:** `contextlost` only brings the purge check forward. The check runs while the context is still lost and starts one recovery. `contextrestored` then starts a second. Each recovery repaints every resident cache to the same budgets, not just what is on screen.
- **Cost:** one Chrome loss blanks the screen twice and rebuilds straight back to the memory level that caused it. Under pressure this loops: on 2026-10-21 a Briar Hollow siege lost its canvases about every 9 s.
- **Better shape:** hold recovery until restore (with a timeout), run it once, repaint what was recently drawn, and make a loss lower future demand instead of restoring it.
- **Size:** M
- **Found:** 2026-10-21, siege blackout.

### Some recovery handlers drop surfaces without releasing them

- **Where:** `onCanvasRecovery` handlers that clear a map of surfaces without `releaseSurface` (for example `ratkinPortrait`, deliberately, because an open conversation keeps drawing the portrait it was handed).
- **Problem:** those surfaces leave the owner tally only when the `FinalizationRegistry` collects them.
- **Cost:** right after a recovery the tally overstates live memory and old and new surfaces coexist. That is the worst moment for it.
- **Better shape:** release explicitly wherever ownership allows. Where it doesn't, as with the portrait, give the holder a handle that gets released instead of keeping a raw surface.
- **Size:** S–M
- **Found:** 2026-10-21, siege blackout research.

### The game's memory tally misses about 40% of what Chrome counts

- **Where:** `surfaceTallies()` in `src/core/canvasSurface.ts`, `src/dev/perfMemory.ts`.
- **Problem:** the tally counts canvas pixels the game allocated, decoded audio and the JS heap. It doesn't count GPU-side copies, the compositor or decoded images held by the browser.
- **Cost:** in the siege the tally read about 725 MB while Chrome reported 1.2 GB for the tab. Budgets tuned against the tally leave less headroom than they appear to.
- **Better shape:** keep the tally, but tune budgets against measured browser totals: Chrome's Task Manager, and `performance.measureUserAgentSpecificMemory` where it is available.
- **Size:** S
- **Found:** 2026-10-21, siege blackout.

### Release builds can't tell paint lag from update lag

- **Where:** `src/core/PerfMonitor.ts` (enabled only on `?perf`), `RenderQualityController` in `src/core/RenderQuality.ts` (frame intervals only).
- **Problem:** the only always-on lag signal is total frame time.
- **Cost:** an automatic quality response can't pick the right remedy: cutting painting doesn't help a frame that is slow in update, and vice versa.
- **Better shape:** a cheap production split. Time `update` and `render` in `SceneManager.step`, and expose the bake caches' per-frame milliseconds.
- **Size:** S
- **Found:** 2026-10-21, siege blackout research.

## Testing and gates

### No gate runs in a real browser

- **Where:** every `verify:*` / `gates:*` script; they run headless on canvas stand-ins.
- **Problem:** canvas context loss, GPU memory pressure and what the screen actually shows are never exercised.
- **Cost:** on 2026-10-21 every gate was green while the siege repeatedly blanked and repainted in Chrome. A class of regression the player sees first is invisible to the gates.
- **Better shape:** a small headless-Chrome smoke suite for the heaviest scenes (the siege at wave 2, a town arrival) that counts canvas recoveries and long frames. It would count events, never milliseconds.
- **Size:** M
- **Found:** 2026-10-21, siege blackout.

### The slowest gates make full verification a 16-minute wait

- **Where:** `verify:town-residency` (about 10 minutes per run), `verify:plaza-perf`, `verify:town-soak`, `verify:floor-sweep`, and `verify:affected` over a large change (146 gates, about 16 minutes).
- **Problem:** a handful of gates dominate the wall clock, and running them in parallel loads the machine heavily.
- **Cost:** a fix-and-confirm loop takes most of an hour. A heavy run competes with a browser playtest and can change its results: it contributed to the 2026-10-21 canvas losses.
- **Better shape:** profile the slow gates. Most of their time is probably repeated scene setup or soak length that a smaller sample would cover just as well.
- **Size:** M
- **Found:** 2026-10-21, perf and memory batch.
