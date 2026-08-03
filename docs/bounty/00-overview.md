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

- [ ] 01 Core system
- [ ] 02 Shady
- [ ] 03 The Mantid
- [ ] 04 The Evil Clown
- [ ] 05 The Dark Knight
- [ ] 06 The Skeleton Lord
- [ ] 07 The Rock Golem

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
5. The phase is done only when a review round returns **zero genuine findings**.
   That final clean round is required even if the previous round had exactly one
   trivial fix — in this repo, re-reviews have four times found defects _inside_
   a completed fix (see memory: "A fix can entrench the bug it fixed").

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

- 2026-08-02 — Plan set written by Claude (planning session). Grounding facts
  verified by four parallel code-exploration agents the same day. No
  implementation has started. Note: Ryan's message spelled the fog toast
  "thorough the fog"; the plans use "through the fog" on the assumption it was a
  typo — flag to Ryan if intentional.
