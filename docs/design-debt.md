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

### Mob construction rolls bypass the spawn context's random stream

- **Where:** `Mob`'s `noticeStagger` and `astarStagger` field initialisers (`src/creatures/Mob.ts`, through `randomInt`, which reads `worldRandom`), and creature field initialisers that call `Math.random` while being built (`EvilClown`'s `idlePhaseOffsetSeconds`, `BallOfSwine`'s `heading`, `Cockroach`'s `skitterPhase`, `NecroFairy`'s `effectSeed`, and others in `src/creatures/`).
- **Problem:** each kind's `create` on `MOB_KINDS` (`src/levels/mobKinds.ts`) receives the `SpawnContext`'s `random`, but only `Necromancer` keeps it; the base class and the other creatures roll from other streams while being built.
- **Cost:** a harness passing a seeded stream through the funnel still gets unseeded per-mob staggers and phases unless it also replaces `Math.random`, so a gate depending on them is not reproducible from the context alone.
- **Better shape:** hand the `create` stream to the `Mob` constructor and let the base class and every creature draw their construction rolls from it.
- **Until then:** don't add new `Math.random` rolls to a creature for anything a gate needs to reproduce; take the `random` its `create` is given.
- **Size:** M
- **Found:** 2026-10-21, spawn funnel work.

## Townsfolk

### Two skyfowl civilian looks are painted and gated but never worn

- **Where:** `SKYFOWL_CIVILIAN_LOOKS` (`src/sprites/art/skyfowl/cast.ts`), `SKYFOWL_ROLE_FOR_TOWN_ROLE` (`src/creatures/citizenFigure.ts`).
- **Problem:** the two `clerk` looks are in the civilian pool, but no `TownRole` maps to the skyfowl `clerk` role, so the street wears only 14 of the 16 civilian looks. The art and cast-motion gates still paint and check both.
- **Cost:** gate time and review effort spent on looks no player sees, and a "16 looks" count that overstates the street's real variety.
- **Better shape:** map a town role (`commoner` or `priest`) onto `clerk`, or move the clerk looks out of the civilian pool to wherever they are meant to be used.
- **Size:** S
- **Found:** 2026-10-21, town crowd variety tiers.

## Rendering and memory

### The game's memory tally misses about 40% of what Chrome counts

- **Where:** `surfaceTallies()` in `src/core/canvasSurface.ts`, `src/dev/perfMemory.ts`.
- **Problem:** the tally counts canvas pixels the game allocated, decoded audio and the JS heap. It doesn't count GPU-side copies, the compositor or decoded images held by the browser.
- **Cost:** in the siege the tally read about 725 MB while Chrome reported 1.2 GB for the tab. Budgets tuned against the tally leave less headroom than they appear to.
- **Better shape:** keep the tally, but tune budgets against measured browser totals: Chrome's Task Manager, and `performance.measureUserAgentSpecificMemory` where it is available.
- **Size:** S
- **Found:** 2026-10-21, siege blackout.

### Places the party has left on floor 3 stay resident until the stairs

- **Where:** the stairs branch of `DungeonScene` (the only caller of `releaseSpritesExcept`, `releaseEnvironmentArt` and `flushFigureFrameCache` on a floor), `TownLifeSystem`'s constructor (`person.pinLook()` for the whole cast), `TownResidency` pin standby.
- **Problem:** building interiors' painted environment sheets and the overworld's tile chunks are never released while the party stays on floor 3, and the town crowd's pinned rows (about 83 MB of the 188 MB figure budget) are baked on arrival wherever the party stands. Only the figure cache, through pin standby and stale-row eviction, gives anything back.
- **Cost:** a headless run that visited the town streets, the Desperado Club and eleven more interiors before the siege carried about 73 MB and 4,200 surfaces more than one that went straight to Briar Hollow, none of it in use there. The tab's footprint grows with how much of floor 3 a player has seen, which is what pushes a phone into canvas loss.
- **Better shape:** release environment sheets by distance or idle time, as the figure cache does rows, rather than only at the stairs, and pin the crowd's looks only while the party is within the town's hold distance.
- **Until then:** don't add another resident cache whose only release is the stairs transition.
- **Size:** M
- **Found:** 2026-10-21, siege lag profiling.

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
