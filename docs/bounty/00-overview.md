# Bounty System — Master Plan

Ryan wants a bounty system on the floor-3 overworld: a shady quest-giver ("Shady")
next to the town notice board issues bounties on named, level-scaled boss
encounters that spawn out in the wilderness. Killing the target and returning to
Shady pays out. It is meant to be a strong source of XP and high-quality loot.

This is a **set of plan files**. Each file is a self-contained task designed to be
executed by a separate Claude session. Read this file first in every session — it
holds the conventions, the review protocol, and the dependency order.

## The plan files

| File                  | Task                                                                                                  | Depends on           |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `00-overview.md`      | This file — conventions, review loop, master status                                                   | —                    |
| `01-core-system.md`   | BountySystem, progress record, board text, spawn sites, arrow, scaling, fog immunity, town aggression | nothing              |
| `02-shady.md`         | Shady the NPC — art, placement, markers, dialog                                                       | 01 (interfaces only) |
| `03-mantid.md`        | The Mantid — giant praying mantis + 2 crony mantises                                                  | 01 (registry only)   |
| `04-evil-clown.md`    | The Evil Clown — giant clown, gas-vial juggling                                                       | 01 (registry only)   |
| `05-dark-knight.md`   | The Dark Knight — mace knight + 10 goblins                                                            | 01 (registry only)   |
| `06-skeleton-lord.md` | The Skeleton Lord — caster + summonable skeleton warriors/archers                                     | 01 (registry only)   |
| `07-rock-golem.md`    | The Rock Golem — boss golem + bodyguard; also upgrades the Sledge/mercenary golems                    | 01 (registry only)   |

**Build order.** `01-core-system.md` Phases A–C must land first — they define
`BountyDef`, the registry, and the shared plumbing every other file plugs into.
After that, files 02–07 are **fully independent of one another** and can be built
in any order or in parallel sessions. The core system is testable before any boss
exists via its `!bounty` debug command (Phase D of file 01).

## Master status board

Update this table when a file's work completes (its own checklist is the source
of truth; this is the at-a-glance view).

- [x] 01 Core system — implemented, 2 review rounds, `npm run verify:bounty` green; Ryan's playtest outstanding
- [x] 02 Shady — implemented, 4 blind art reviews; a 5th round and Ryan's in-game look outstanding
- [x] 03 The Mantid — implemented; Ryan's playtest outstanding
- [x] 04 The Evil Clown — implemented; Ryan's playtest outstanding
- [x] 05 The Dark Knight — implemented; Ryan's playtest outstanding
- [x] 06 The Skeleton Lord — implemented; Ryan's playtest outstanding
- [x] 07 The Rock Golem — implemented, 5 art review rounds + independent code review; Ryan's playtest and the in-game `!bounty` walkthrough outstanding

## How the bounty loop works (product spec, agreed with Ryan)

1. Shady stands near the town notice board with an **exclamation mark** over his
   head when a bounty is available. Talking to him issues the next bounty.
2. Issuing a bounty spawns the encounter (boss + minions) at one of several
   pre-scattered wilderness **bounty sites** — never in the town or the circus.
   While the bounty is active: Shady has **no marker**, the notice board lists the
   current target by name and type, and a **guidance arrow** floats over the
   player's head pointing at the target (same arrow as tutorial / `!reveal`).
3. Killing the boss flips the state to _kill pending collection_: Shady gets a
   **question mark** (same visual language as the goblin mother in the defend
   quest), and the arrow points back at Shady.
4. Talking to Shady in that state pays out, clears the mission, and makes the next
   bounty available (exclamation mark returns).
5. **Cycling:** there are 5 bounty enemy types. The order of types is shuffled
   once per floor initialization; the system walks that order and does not repeat
   a type until all 5 have been defeated, then reshuffles. Each type has its own
   shuffled array of 5–10 unique names with a per-type cursor, so the second
   Mantid has a different name than the first.
6. **Scaling:** boss and minion levels derive from the players' level;
   XP/loot/coins scale accordingly. Loot is boss-tier (golden, never fades).
7. **Special rules:** bounty bosses are immune to the Scroll of Confusing Fog
   (minions are not); a blocked confusion shows the hotbar toast
   `` `${name} sees you through the fog` ``. Bounty bosses **and** their minions
   ignore the town safe zone — lured into town, they keep chasing.

## Conventions every session must follow

- **Load skills before coding.** At minimum `game-architecture` and
  `dev-workflow`; plus `add-creature` + `add-sprite` for any boss,
  `bipedal-figure` for bipeds (Shady, clown, knight, skeletons, golem),
  `add-sound` for audio, `add-quest`/`add-ui` where the file says so.
- **CLAUDE.md rules are binding**: no `as` casts, no `!` assertions, no `any`,
  no magic numbers, comments explain _why_ only, use `src/ui` text/box/button
  utilities for UI chrome.
- **Validation gates** after every phase: `npm run typecheck` and `npm run lint`
  must exit 0, then `npm run format`. Never mark a checkbox with a failing gate.
  Also run **`npm run verify:bounty`** — 253 headless assertions over the sites,
  the registry, every def's encounter, the cycles and the whole state machine.
- **Register every new `scripts/` file in `tsconfig.scripts.json`.** Its
  `include` is an explicit list, so `npm run typecheck` simply does not see a
  file that is missing from it — and a passing gate then means nothing. Five of
  the six sessions on this plan set skipped it, which hid 22 real errors, one of
  them a drawing feature that had been written and silently never called.
- **Art pipeline** follows the Lava Llama shape (the best current example):
  `scripts/<name>Art.ts` (drawing engine) → `scripts/generate-<name>-sprite.ts`
  (bake, `npm run gen:<name>` alias in package.json) → PNG + hand-pasted entry in
  `src/images/enemies/manifest.json` (the generator _verifies_ the manifest and
  prints the block to paste; it does not write it) → `scripts/render-<name>.ts`
  contact-sheet harness → localhost `?<name>` preview route in
  `src/dev/devBoot.ts`. Frame cells are measured from ink, not declared. Look at
  `scripts/generate-llama-sprite.ts` and `scripts/render-llama.ts` end to end
  before writing a new generator.
- **Look at your art.** Every art phase ends with actually rendering the contact
  sheet to a PNG and reading it with the Read tool. Bake gates (assertions in the
  generator) encode anything a reviewer catches so it cannot regress.
- **Journal discipline.** Every plan file ends with an append-only `## Journal`.
  Date each entry. Record: what was done, review rounds and their findings,
  decisions that deviated from the plan (and why), and anything the next session
  must know. Never rewrite old entries.

## Independent review loop (mandatory, per Ryan)

After implementing each phase:

1. Run the validation gates (typecheck, lint, format).
2. Spawn an **independent review agent** — fresh context, given the diff and the
   relevant spec section of the plan file, asked to find genuine defects.
3. Triage its findings. A finding counts as _genuine_ unless it is a **nit**
   (style-only, no behavior change), **out of scope** for this phase, or a pure
   **opinion** with no defect behind it. Log the triage in the Journal, including
   what was dismissed and why.
4. If any genuine finding survived triage: implement the fix, then **go back to
   step 2 for a full fresh review** — not a skim of the fix.
   This is not ceremony. On this plan set alone the confirming round found a
   defect _inside_ a completed fix on the Evil Clown (3 of round 2's findings
   were in round 1's fixes), on the Dark Knight, and twice on Shady — where a
   frozen animation was "fixed" and then froze again for an entirely different
   reason.
5. The phase is done only when a review round returns **zero genuine findings**.
   That final clean round is required even if the previous round had exactly one
   trivial fix — in this repo, re-reviews have four times found defects _inside_
   a completed fix (see memory: "A fix can entrench the bug it fixed").

## What only a cross-cutting review can catch

Each of the seven workstreams below passed its own review loop, and eight
defects still survived at the seams — including three that no single session
could have seen:

- **Rewards drifted 7× apart.** Three of the five bosses shipped below every
  named boss in the game. Each looked reasonable read on its own.
- **Two individually-correct edits were mutually exclusive.** One session made an
  open bounty dialog halt gameplay; another drove Shady's talk pose from the
  gameplay update. Together they made the talk pose unreachable.
- **A shared registry file was skipped by five of six sessions**, and the gate
  that would have said so was the very thing not registered.

Budget a cross-cutting pass at the end of any plan set built in parallel, and
give it the seams explicitly: shared files, contract compliance across _all_
implementers, reward/stat consistency, and anything one session's change could
make unreachable in another's.

## Codebase facts the plans rely on (verified 2026-08-02)

These were confirmed by direct code exploration; re-verify line numbers if files
have drifted, but the shapes should hold.

- **Notice board**: `NoticeBoardProp` in `src/systems/TownPropSystem.ts` (placed
  near plaza centre, `placeBoard()`); interaction is Space-key + radius via
  `TownPropSystem.tryInteract`, routed from `DungeonScene.triggerSpaceAction`
  (~`DungeonScene.ts:3041`); the prompt render chain in
  `DungeonScene.renderPropPrompt` must mirror the interact chain order. Board
  content is pure data: `buildTownNotices(ctx)` in `src/systems/townNotices.ts`
  (a static `RUINS_BOUNTY` notice already exists — the dynamic bounty posting
  replaces it), context built by `DungeonScene.townNoticeContext()`.
- **Quest markers**: `QuestNPC` (`src/creatures/QuestNPC.ts`) has
  `markerType: 'exclamation' | 'question' | 'none'`; drawing is
  `drawExclamationMark(ctx, sx, sy, tileSize, color)` in
  `src/sprites/questNPCSprite.ts` — beware: it picks `?` vs `!` **by comparing
  the color string** to `'#4ade80'`. File 02 fixes that.
- **Dialog**: use the shared paged `QuestDialog` (`src/ui/QuestDialog.ts`,
  `open(pages, onComplete)`), the pattern every modern quest uses. Do not copy
  `DefendQuestSystem`'s hand-rolled dialog.
- **Arrow**: `drawArrowAbovePlayer(...)` in `src/ui/WorldArrow.ts` — pure
  function, world-pixel target, caller decides per frame. (`!reveal` duplicates
  the geometry inline in DungeonScene; use the WorldArrow helper, don't copy the
  duplication.)
- **Hotbar toast**: `HotbarToast.show(text)`; DungeonScene owns the instance
  (`hotbarToast`, ~line 614). Dedupes identical text automatically.
- **Confusing fog**: `SpellSystem.update()` (~`SpellSystem.ts:500-519`) sets
  `mob.isConfused = true` for every live mob inside the fog circle each frame;
  `MobUpdateLoop` then forces wander. The immunity check belongs in that
  SpellSystem loop condition — NOT in MobUpdateLoop (which would leave
  `isConfused` true for other readers).
- **Town safe zone**: `GameMap.isInTownSafeZone(worldX, worldY)` (circle around
  `townSquareCentre`, radius `TOWN_SAFE_RADIUS_TILES = 40`). Deaggro is
  per-mob-class via an `accept` predicate passed to `Mob.acquireTarget` (see
  `RuinsGhoul.ts`, `Krasue.ts`; Krasue already has an `ignoresTownSafeZone`
  boolean — file 01 promotes that idea to `Mob`).
- **Circus bounds**: `GameMap.circusCentre` / `circusRadiusTiles` (public
  fields, overworld only). Spawn-exclusion precedent:
  `scatterRuinsSpawnPoints` in `src/map/OverworldGenerator.ts` (~line 1351)
  rejects town/circus/camp discs — the bounty site scatter copies this.
- **Scene rebuild trap**: `DungeonScene` is reconstructed on **every building
  entry/exit**. Anything that must survive a door round-trip is threaded through
  `DungeonSceneOptions` as a plain progress record (the `circusQuestProgress`
  pattern, `src/core/CircusQuestProgress.ts`). A shuffle done only in the scene
  constructor would re-roll at every door. Nothing survives a page reload today
  (server save is snapshots + levelId only) — bounty state resetting on reload
  matches every other quest and is accepted.
- **Spawning a mob at runtime** (the exact recipe): `createMob(type, tx, ty,
map)` from `src/levels/spawner.ts` (or `new X(...)` + `setMap`), then
  `mobs.push(mob); mobGrid.insert(mob); mob.setSpells(spells);` and — easy to
  miss — `mob.applyMobLevel(level)` (the `onMobKilledSpawns` path forgets it;
  don't copy that path).
- **Level scaling vocabulary**: `Mob.applyMobLevel(level)` with
  `MOB_LEVEL_{HP,SPEED,COIN,XP,DAMAGE}_SCALE` (`Mob.ts:14-23`), cap
  `MAX_MOB_LEVEL = 20` (`spawner.ts`). **Nothing in the codebase scales off
  player level today** — the bounty system is the first; the hook is simply
  `applyMobLevel(f(playerLevel))` before insertion.
- **XP on death**: `CombatSystem.resolveKills` — 85% to top damage dealer, 15%
  to the other party member, from `mob.scaledXpValue`. A mob nobody damaged
  awards nothing.
- **Boss loot on the overworld**: floor 3 has no boss rooms, so
  `receiveBossLoot` can't fire; the correct path is the existing fallback
  `dropLootByOwner(cx, cy, loot, topDamageDealer, /*isBossLoot*/ true)` —
  golden, never-fading floor loot. Loot content comes from overriding
  `rollLootItems(killer)` on the boss class (`TheHoarder.ts:292` pattern);
  `mobLevel` is readable there for level-scaled tables. There is **no item
  rarity model** — "high quality" means a curated pool of the strong existing
  items plus generous level-scaled coins.
- **Projectiles must be system-owned.** A projectile stored on a Mob is deleted
  mid-air when the mob dies. Follow `LavaBallSystem`
  (`src/systems/LavaBallSystem.ts`, header comment explains it): the mob queues
  `pending*` records, exposes a `takePending*()` drain-and-clear method, and the
  system owns flight/impact/damage with its own `DamageSource`. Do NOT follow
  `soulBolt.ts`/`signetFireball.ts` (mob-owned).
- **Summoning mid-fight**: Hoarder pattern — boss queues spawn requests
  (`cockroachSpawns` + `cockroachAtCap`), a system drains them and enforces the
  cap (`BossRoomSystem.spawnHoarderCockroaches`). For spawn wind-ups, the
  life-machine slot-reservation trick (`SpiderQuestSystem._committedSpiderlingCount`)
  prevents overshoot.
- **Ground telegraphs** (red warning shapes) currently live **inline in
  `GrotesqueSpider.drawSelf`** (~lines 908-1010: hazard-striped clipped fill +
  animated dashed outline, circle and cone variants). File 01 extracts shared
  helpers so the knight and skeleton lord don't copy 90 lines each.
- **Ground hazards + companion avoidance**: acid puddles live in
  `BossRoomSystem` (`AcidPuddle`, `tickAcidPuddles`,
  `getHazardEscapeVector(x, y)`), consumed by
  `CompanionSystem.fleeFromHazards`, which is hard-coupled to `BossRoomSystem`.
  File 01 generalizes this to a hazard-provider interface so the clown's gas
  clouds get avoidance for free.
- **Roll/ball state template**: `BallOfSwine.ts` — damage cap while rolling is
  one line in `takeDamageFrom` (`this.isStopped ? amount : Math.min(amount, 1)`),
  and the roll is interrupted by reading `this.isSlowed`, which
  `BarrierSystem` (gym equipment) sets within its slow radius. The golem reuses
  both ideas with zero new coupling.
- **Sounds**: append id to `SOUND_IDS_TUPLE` (alpha order) + path to
  `SOUND_MANIFEST` in `src/audio/sounds.ts` (mp3 only, under `src/audio/...`).
  Creatures trigger via flag polling: `attackSoundPending` /
  `projectileSoundPending` / `damageSoundPending` / `specialSoundPending` on
  `Mob`, drained by `playMobAudioCues` in `GameLoopPhases.ts` switching on
  `mob.audioTag` — new creature = new `audioTag` + new case arms. Boss music is
  a hardcoded ternary on `bossFightInitiated` in `AudioManager.wireEventBus`.
- **Oversized art**: override `cullMarginTiles` (clowns do) and
  `silhouetteMarginTiles` (spider does, for telegraph rings). Idle rows must be
  driven by `timeFrameIndex(...)` because `walkFrame` resets to 0 when a mob
  stops.
- **Corpses**: mobs leave the render grid the frame they die; gore is handled by
  `spawnGore` + `BodyPartGoreSystem` (`bodyPartKey` registry). Only opt into
  `rendersWhenDead` if you implement `tickCorpse`/`corpseExpired`.

## Sounds Ryan must source ([HUMAN])

Each creature file has a "Sounds" section specifying ideal sounds. Ryan sources
CC-licensed audio; if a sound can't be found, he will note it in that file's
Journal and the implementing session adapts (reuse the closest existing id from
`sounds.ts` as a stand-in and record the substitution).

## Journal

- 2026-08-02 — **Whole plan set implemented** in one session: the core system and
  Shady by the main agent, the five bosses by five parallel agents, each running
  its own independent review loop per the protocol above.

  **`npm run verify:bounty` is new** (`scripts/verify-bounty.ts`) and is the
  cheapest way for a later session to check nothing has rotted. 216 assertions:
  the wilderness site scatter over five freshly generated overworlds, every
  registered def's encounter built for real, the type and name cycles walked six
  times over, and the whole `available → issue → kill → collect → available`
  state machine driven through a real `BountySystem`. It exists because browser
  `requestAnimationFrame` throttles to about one frame a second when the window
  is occluded, so nothing about timing or motion can be honestly claimed from
  automation — rather than assert those from a stalled frame loop, everything
  that could be made deterministic was moved here, and the rest is marked
  [HUMAN].

  The `debug_ghoul` placeholder def has been **removed**, all five real types
  having landed.

  **One defect only visible across all five bosses at once**, found in the final
  integration pass and fixed: the XP rewards had drifted into a 7× spread. The
  Mantid and the Dark Knight shipped at 1500/1600, correctly boss-tier against
  the Grotesque Spider's 2000 and the Hoarder's 500 — but the Evil Clown, the
  Skeleton Lord and the Rock Golem shipped at 320, 220 and 260, _below every
  named boss in the game_ and only an order of magnitude above a regular floor-3
  ghoul. Each looks perfectly reasonable read on its own, which is exactly why
  five parallel sessions could not catch it and why the per-boss reviews did not.
  All five are now in a 1300–1600 band with matching coin ranges, and
  `verify:bounty` asserts both the band and that a mark always out-earns its own
  escort, so the next bounty boss cannot drift out of it quietly.

  **A full cross-cutting integration review** then found eight more defects at
  the seams between the six workstreams, all fixed:
  1. **21 of the 25 new `scripts/` files were never registered in
     `tsconfig.scripts.json`**, whose `include` is an explicit list — so
     `npm run typecheck` never saw them, and 22 real errors were hiding behind
     the gap. One of them was live: a cape-seam feature in `shadyArt.ts` had been
     written and never called, so the fix a blind review asked for was silently
     absent from the baked sheet. Registered all 21 and cleared the fallout; the
     six sheets re-bake byte-identical, which is what proves the rest of the
     removed code really was dead.
  2. **`Shady.isTalking` could never be true.** Its only writer sat in
     `BountySystem.update`, which the scene skips whenever gameplay is halted —
     and an open bounty dialog is exactly that. His lean-in pose and his
     mid-conversation tic suppression were both unreachable outside the preview
     harness. Moved to `syncShady()`, called above the scene's early return.
  3. **Five of the nine new creatures had no death cause**, so dying to a soul
     bolt, a bone arrow, a thrown boulder or the golem's roll showed the generic
     "unknown" text. Added, with separate lines for the grasping-hands cone and
     the boulder roll, since both have counterplay worth naming.
  4. **Four of five defs placed minions at fixed offsets with no walkability
     check.** A site only guarantees ~80% open ground, so mobs spawned inside
     trees — measured at 4 of 416 across two maps. All four now go through a
     shared `placeNearSite`, which keeps the author's formation and only rescues
     when it has to.
  5. **`verify:bounty` did not check the contract clause with no symptom**: that
     `setMap()` was called. A mob without a map walks through walls and never
     paths, and nothing shows until the fight starts. Added, along with
     walkability and same-tile checks — and a sweep that stages every def at
     every site of two maps, because a single site cannot exercise the blocked
     20%.
  6. That new sweep immediately found a **sixth** defect nobody had looked for:
     the Dark Knight's ten goblins were drawn from an unremembering random
     sample and could land two on one tile.
  7. **`SkeletonSummonSystem` was the one encounter system with no checkpoint
     reset**, so a safe-room restore on the frame a wave rose played the rise cue
     for a summon that had just been undone.
  8. **The Evil Clown's entire escort ignored the site anchor.** All nine new
     classes correctly call `returnHomeOrWander()`, but that troupe is composed
     only of reused circus classes, all of which plain-wander — so the boss held
     his clearing while all five of his clowns drifted off it. Fixed in
     `StiltClown`, `FatClown` and `CircusLemur`; with no home set the call is
     exactly `doWander`, so their circus spawns are unchanged.

  **The confirming integration round then found six more — three of them inside
  the fixes above.** Exactly the pattern this repo keeps producing, and the
  reason the protocol demands the extra round:
  1. **`placeNearSite` had no occupancy awareness** — the rescue spiral could
     hand a minion the boss's own tile or a tile another minion had just been
     rescued onto. This is the _identical_ bug the Dark Knight's goblin placement
     had been fixed for one round earlier, reintroduced by the fix for a
     different problem. Both helpers now share one `claimed` set, seeded with the
     boss's tile.
  2. **The new placement sweep only asserted walkability.** The `setMap` and
     same-tile checks still ran on a single site of a single map — and same-tile
     is precisely the rare, layout-dependent failure in (1), so the sweep could
     not have caught it. All three now run across the whole sweep, which was also
     widened to four maps, and a vacuity guard was added: the checks used to pass
     if the sweep staged nothing at all.
  3. **The wired-in cape seam overshot onto the coat.** The cape's hem is a
     quadratic, but the seams ended at a flat `hemY + dip`, so all three crossed
     the cape's own outline and finished on the coat at belt height. A defect
     created by the fix that wired the seam in at all.
  4. **The `syncShady` fix was incomplete.** Talking was checked _after_
     scratching in `drawSelf`, and nothing advances the scratch while a dialog is
     open — so a conversation begun during a tic (about 11% of presses) froze him
     mid-scratch for its whole duration and the lean-in pose still never played.
     Talking now wins, and the tic is cancelled outright.
  5. A stale JSDoc block left stacked above `placeNearSite`, misdescribing it.
  6. Two comments made false by earlier fixes — `spawner.ts` still claimed camp
     residents were the only writer of `homePoint`, and `verify-bounty.ts` called
     itself deterministic while generating unseeded maps. Both corrected rather
     than deleted, since both were load-bearing explanations.

  **The session ended when it hit a monthly spend limit**, which killed five
  agents mid-edit. Only one had left the tree broken: the Mantid session had
  added a `flareSign` parameter to `drawWingCase` and been cut off partway
  through updating its three call sites, so `tsc -p tsconfig.scripts.json`
  failed. Repaired (side view flares outward, the two axial views mirror per
  `side`), and every generator re-bakes clean. Worth noting that the _scripts_
  typecheck is what caught it — the same gate that five of six sessions had
  skipped registering their files with, and which had been fixed two rounds
  earlier. Had it not been, a broken art module would have shipped silently.

  And then, checking my own arithmetic before handing (3) to the next reviewer:
  **the new `hemDipFactor` was exactly 2× wrong.** A quadratic Bézier reaches
  only _half_ its control point's offset — solving the curve gives
  `2u(1−u) = (1 − t²)/2`, not `1 − t²`. The seams therefore still ended below the
  hem; they only _looked_ right because `MANTLE_SEAM_REACH`'s pullback happened
  to cancel almost exactly the same amount. A fix that is wrong and passes by
  coincidence is worse than one that fails, because nothing will ever question
  it. Corrected, with the derivation written beside the constant.

  Two conventions were corrected mid-flight and are worth knowing about, because
  the original plan text got both wrong and all five creature sessions had to be
  messaged directly:
  - **A def must not call `applyMobLevel`.** It is not idempotent — it multiplies
    off current stats rather than a stored base — so a def that scaled its own
    mobs alongside `BountySystem` would ship a compounded encounter that reads as
    a tuning problem rather than as a bug. `verify:bounty` now checks this.
  - **A bounty mob's idle branch must call `returnHomeOrWander()`**, not
    `doWander()`. Only the former consults the `homePoint`/`leashRadiusTiles`
    anchor `BountySystem` sets, so a plain-wandering class drifts off the site
    the player was sent to.

  Ryan's note in the entry below about "thorough the fog": the toast ships as
  `` `${name} sees you through the fog` ``.

- 2026-08-02 — Plan set written by Claude (planning session). Grounding facts
  verified by four parallel code-exploration agents the same day. No
  implementation has started. Note: Ryan's message spelled the fog toast
  "thorough the fog"; the plans use "through the fog" on the assumption it was a
  typo — flag to Ryan if intentional.
