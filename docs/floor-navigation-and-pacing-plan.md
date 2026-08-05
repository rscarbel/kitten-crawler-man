# Floor Navigation & Pacing Plan

Goal: the stretch after a floor's last boss should be a hunt, not a slog — players
find the stairwell through play (breadcrumbs, a map hint, a fail-safe pointer)
rather than by sweeping the map perimeter. And floor 1's back half should keep
biting the way its front half does, so the arrival at floor 2 (which playtests
call the RIGHT difficulty) is a ramp, not a cliff.

Non-goals: no always-on GPS arrow, no full-screen map, no gating stairwells on
boss kills, no XP-economy changes, no floor-2 band changes (floor 2 is the
calibration reference), no forced grinding — every nudge stays declinable.

All numbers below are **starting points for tuning**, not final values. Every
phase lists in-game notes for Ryan's playtest afterward — automated checks
(typecheck/lint/format) are what gate the phase as done.

---

## 1. How stairwells place today (measured from the code)

A dungeon stairwell is not a tile type: it is a list of room-centre coordinates
plus a `BLOCK_STAIRWELL` bitmask over a 2×2 footprint (the `BLOCK_STAIRWELL`
constant and the `setStairwellTiles`/`buildStairwellBlockedSet` methods in
`src/map/GameMap.ts`), drawn by `StairwellSystem` as a sprite with a pulsing
purple border and a `▼` glyph (`renderStairwells` in
`src/systems/StairwellSystem.ts`). Placement is step 7 of the generator (the
`// 7. Stairwells` block in `buildDungeon`, `src/map/DungeonGenerator.ts`):

- **Count:** `max(1, floor(regularRooms / ROOMS_PER_STAIRWELL))` with
  `ROOMS_PER_STAIRWELL = 50` (the `ROOMS_PER_STAIRWELL` constant and the
  `baseStairwellCount` calculation in `buildDungeon`). Floor 1 doubles it
  (`LEVEL1_STAIRWELL_MULTIPLIER = 2`, `src/levels/level1.ts`); floor 2
  hard-overrides to 2 (the `numStairwells` field on `level2`,
  `src/levels/level2.ts`).
- **Candidates:** free-region regular rooms only (the `regularRooms`
  assignment in `buildDungeon`); gauntlet, safe, boss, and treasure rooms are
  excluded by construction.
- **Selection (progression floors):** rooms are sorted by distance from the
  last gauntlet boss room, **descending**; rooms closer than
  `STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT = 35` tiles are dropped
  (`src/map/progressionValidation.ts`); then **the single farthest room
  seeds the set** (the `stairwellTiles.push(candidates[0])` line in
  `buildDungeon`'s stairwell-placement block) and greedy farthest-point
  sampling adds the rest, each maximising its minimum distance to the already
  chosen, floored at `STAIRWELL_MIN_SEPARATION = 45` tiles (the
  `while (stairwellTiles.length < stairwellCount)` loop in the same block).
- **Validation:** invariant I4 (the I4 block inside `validateProgression`,
  `src/map/progressionValidation.ts`) rejects a floor with no stairwell, one
  nearer than 35 tiles to the boss exit (unless the generator set
  `stairwellSpacingWaived`, in the same stairwell-placement block), or a pair
  closer than 45 tiles; failures regenerate the floor (`generateDungeon`'s
  retry loop, which calls `validateProgression` and retries on failure).

**Why they hug the edges:** the comment above the farthest-point sampling loop
in `buildDungeon`'s stairwell-placement block says farthest-point sampling
exists to avoid "packing them into the far edge" — but the _seed_ is
`candidates[0]`, the literal farthest room from the boss exit, and max-min
isolation is itself maximised at the map's extremes (corners and perimeter
beat interior rooms at being far from everything). The distribution is
edge-biased by construction, which is exactly the playtest complaint: players
don't naturally sweep the perimeter, so the post-boss stretch turns into a
grid search.

**What already exists to build on (no new rendering tech needed):**

- A working stairwell arrow, cheat-gated: the `_revealStairwell` field
  (`src/scenes/DungeonScene.ts`) + `renderStairwellRevealArrow` (same file),
  toggled only by the `!reveal` chat command handler (same file). It is a
  copy-paste of `drawArrowAbovePlayer` in `src/ui/WorldArrow.ts` rather than a
  call to it.
- A minimap with fog-of-war that **already draws stairwells as white squares
  once their tile is out of the fog** (the stairwell white-square loop in
  `MiniMapSystem.render()`, `src/systems/MiniMapSystem.ts`), and a bulk-reveal
  precedent: `revealBossNeighborhood` (same file, radius
  `BOSS_REVEAL_EXTRA_TILES = 15`, called from `BossRoomSystem.update()`,
  `src/systems/BossRoomSystem.ts`).
- A messaging stack: `SystemAnnouncer.announce` (`src/ui/SystemAnnouncer.ts`,
  exposed to systems via the `announce` callback in `DungeonScene`'s
  `skillBookFlowHost()`) for flavourful lines, `ToastStack` for glanceable
  ones — the split `SystemNoticeSystem` already practices (the `handle`
  method's `case 'unlocked'`/`case 'triggered'` branches in
  `src/systems/SystemNoticeSystem.ts`).
- The `stairwellFound` event (`src/core/EventBus.ts`, emitted in
  `DungeonScene`'s `updateGameplay()`) and the `bossDefeated` handler block
  inside `DungeonScene`'s `wireEventBus()` as hooks.

## 2. Why floor 1 goes flat (measured from the code)

**Player levelling is fast and front-loaded.** XP to next level is
`level × 10` (the `XP_PER_LEVEL_MULTIPLIER` constant and the
`xpNeededForNextLevel` getter in `src/Player.ts`), so cumulative XP to reach
level 10 is only **450**, to level 12 **660**. Against that, floor 1 (`mapSize`
field of 450 on `level1`, `src/levels/level1.ts`) offers roughly **6,000–9,000
XP**: ~200 hallway rats at 2 XP each, ~19 XP per populated room across a few
hundred rooms, plus 500–875 from the Hoarder and 900–1,500 from the Juicer
(the `xpValue` fields on `TheHoarder` and `Juicer`, scaled by
`MOB_LEVEL_XP_SCALE = 0.25` and the `scaledXpValue` getter in
`src/creatures/Mob.ts`). The XP-diminishing tiers only start biting at player
level 10 (`LEVEL1_XP_HALF_LEVEL = 10`, `level1.ts`'s `xpDiminishingTiers`) — by
design, since "a crawler who clears both gauntlets lands around level 10" (the
doc comment above `LEVEL1_XP_HALF_LEVEL` in `level1.ts`).

**Mob levels freeze at player level ~4.** Spawn level is
`randomInt(earnedLevelFloor, band.maxLevel)` with
`earnedLevelFloor = clamp(round(party × 0.7), band.min, band.max)`
(`resolveSpawnLevel` and `earnedLevelFloor` in `src/levels/spawner.ts`,
`MOB_LEVEL_PARTY_RATIO = 0.7` in the same file). Floor 1's bands
(the `roomMobs`/`hallwayMobs` level ranges on `level1`, `src/levels/level1.ts`):
goblin **1–2**, llama **1–3**, archer escort **1–3**, hallway rat **1–1**. So:

- At party level 3, `round(2.1) = 2` — every goblin is level 2, the band
  ceiling. Forever.
- At party level 4, `round(2.8) = 3` — llamas and archers hit their ceilings.
- Rats never level at all.

The player then spends levels **4 through ~10** — the post-Hoarder region, the
post-Juicer region, and the entire stairwell hunt — against a level-2 goblin:
8 HP, 2/3 damage, 86-frame swing (`applyMobLevel` scales HP and speed, and
`scaledDamage` scales damage, all in `src/creatures/Mob.ts`; cadence via
`cooldownScaleForLevel`/`scaledCooldownFramesForLevel` in the same file). That
is the "laughably easy well before the floor ends" feeling, and it is a
band-ceiling problem, not an XP problem.

**Floor 2 shows the target.** Its bands are 3–6 (the `roomMobs` level ranges
on `level2`, `src/levels/level2.ts`); a party arriving at ~10 gets
`earnedLevelFloor = clamp(round(7), 3, 6) = 6`, so every mob spawns at the
ceiling: a level-6 troglodyte has 55 HP, 8 tongue damage, and a ~×0.83 cooldown
scale (base 22 HP / 4 damage — the `TROG_HP` and `TONGUE_DAMAGE` constants in
`src/creatures/Troglodyte.ts`). Playtests call this **right**. The cliff is
the last thing floor 1 shows you (8 HP / 3 damage) against the first thing
floor 2 does (55 HP / 8 damage).

**Assessment (answering (c) directly):** floor 1's _mob band ceilings_ need
raising in its later regions; nothing else does. Do **not** touch the XP
curve, the diminishing tiers, or the 0.7 ratio — the player's ~level-10
arrival is precisely what makes floor 2 land right, and slowing levelling
would silently re-tune the floor that is already correct. Do not touch floor
2's bands for the same reason. The fix is confined to floor 1 post-Hoarder /
post-Juicer, and Phase 6 sizes it.

---

## 3. Design principles

- **N1 — Findable, not shown.** Every hint narrows the search space; none ends
  it. The exact-tile arrow stays a cheat (`!reveal`) and a bounded fail-safe.
- **N2 — Escalate on evidence of struggle.** Placement fix always applies; the
  map hint fires on the boss kill; the in-world breadcrumb needs proximity;
  the pointer appears only after the player has demonstrably hunted and come
  up empty.
- **N3 — Nudge, never gate.** The recommended-level line informs; Descend is
  never disabled or delayed. Underlevelled descent is a legal choice with a
  visible cost, not an error.
- **N4 — Derive, don't duplicate.** The recommended level is computed from the
  next floor's own spawn bands and `MOB_LEVEL_PARTY_RATIO` — one source of
  truth, so retuning a band retunes the advice.
- **N5 — Tune with data.** Phase 0 makes "the hunt took too long" a number
  before anything changes it.

Target feel (Phase 0 measures against):

| Metric                                           | Target                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Last-gauntlet-boss death → first stairwell found | 3–8 min                                                                               |
| Runs where the Wayfinder fail-safe fires         | < 25%                                                                                 |
| Party level entering floor 2                     | 8–11                                                                                  |
| Floor-1 post-Juicer room fight, HP remaining     | 40–70% (same band as the P4 target-feel table in `docs/difficulty-fairness-rules.md`) |

---

## Phase 0 — Hunt telemetry

`src/core/DifficultyStats.ts` already segments the run (the
`DIFFICULTY_SEGMENTS`/`DifficultySegment` union:
`floor1-pre-hoarder | floor1-post-hoarder | floor1-post-juicer | floor2 | floor3`)
and survives scene teardown (it exists precisely because `GameStats` dies with
its `DungeonScene`). Add:

- `stairwellHuntFrames` per floor: frames from the floor's **last** gauntlet
  boss `bossDefeated` (hook beside the existing `bossDefeated` handler inside
  `DungeonScene`'s `wireEventBus()`) to the first `stairwellFound` emission (in
  `DungeonScene`'s `updateGameplay()`). Which boss is "last" comes from the
  floor's `LevelDef.progression` gauntlet list, not a hardcoded boss name.
- `descendedUnderleveled` count + the party-level-vs-recommended delta at each
  descent (the `onDescend` callback passed to `new StairwellSystem(...)` in
  `DungeonScene`'s constructor).
- Surface both on the `?difficulty` overlay (`src/dev/difficultyOverlay.ts`).

- One baseline floor-1 + floor-2 run with the overlay on; record the
  hunt time and arrival level into this doc before any later phase lands.

## Phase 1 — Placement: a distance band instead of "farthest"

Keep the two good rules (≥ 35 tiles from the boss exit, ≥ 45 tiles apart) and
remove the edge magnetism, all in the stairwell-placement block of
`buildDungeon` (`src/map/DungeonGenerator.ts`):

- New `STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT = 90` tiles (declared beside
  `STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT`/`STAIRWELL_MIN_SEPARATION` in
  `src/map/progressionValidation.ts` so the validator and generator share it).
  Candidate pool becomes rooms with
  `35 ≤ distanceToRect(centre, exitBounds) ≤ 90`; if that pool holds fewer
  rooms than `stairwellCount`, widen back to the full ≥ 35 pool and set the
  existing `stairwellSpacingWaived` flag (in the same stairwell-placement
  block) so I4 waives the new max the same way it waives the min today.
- Seed with a **random banded candidate**, not `candidates[0]` — the generator
  is already unseeded `Math.random()` throughout (e.g. the Fisher-Yates
  shuffle of `shuffledEligible` used for treasure-room selection in
  `buildDungeon`), so this adds no new nondeterminism class. Then keep the
  greedy max-min separation pass, restricted to the banded pool.
- Extend I4 (the I4 block inside `validateProgression`,
  `src/map/progressionValidation.ts`): every stairwell within the band unless
  `stairwellSpacingWaived`; existing checks unchanged.
- Leave the non-progression branch (the `else if (rooms.length > 0)` branch in
  `buildDungeon`'s stairwell-placement block) alone — no current floor uses it
  (tutorial is hand-placed via the `STAIR_X`/`STAIR_Y` constants in
  `src/map/TutorialMap.ts`, level 3 has no `nextLevelId`,
  `src/levels/level3.ts`).
- `npm run verify:progression` (50 maps per floor) is the regression gate;
  Phase 7 adds the band assertion to it.

Why 90: floor 1's free region spans a 450-tile map; 35–90 keeps the stairwell
out of sight of the boss door (the stated intent of the min, per the comment
introducing the stairwell-placement block in `buildDungeon`) while pulling it
off the perimeter and into the ring a player actually sweeps first.

- Generate and eyeball ~5 floor-1 maps (the `?difficulty` run or a
  render harness): stairwells should sit in the mid-ring, not the corners, and
  never beside the boss exit.

## Phase 2 — Post-boss map hint

When the floor's **last** gauntlet boss dies (same hook as Phase 0):

- `MiniMapSystem.revealStairwellNeighborhood(tile)` — modelled line-for-line
  on `revealBossNeighborhood` (`src/systems/MiniMapSystem.ts`) with
  `STAIRWELL_REVEAL_RADIUS_TILES = 8`. Reveal the fog around the stairwell
  nearest the boss room; the existing white-square pass (in
  `MiniMapSystem.render()`) then draws it with no further work.
- One `SystemAnnouncer.announce` line on the same frame, e.g. "The floor
  shudders. Something has opened below — your map remembers where." (final
  copy at implementation; the announcer queue and fade are already built —
  the `queue` field, `MAX_QUEUED`, and `FADE_TICKS` in
  `src/ui/SystemAnnouncer.ts`).
- Fog is deliberately not rewound on death (the doc comment on the
  `MiniMapCheckpoint` interface in `src/systems/MiniMapSystem.ts`), so the
  hint survives checkpoint restores for free. The arena stairwell is excluded
  automatically: it only joins `gameMap.stairwellTiles` after its own unlock
  (`unlockArenaStairwell` in `src/map/GameMap.ts`), so "nearest stairwell" can
  never leak it.

This is the macro hint: it tells the player _which direction of the map_ to
hunt in, not which room — the reveal radius shows an 8-tile pool of fog on a
160-px minimap (`NORMAL_SIZE = 160` in `src/systems/MiniMapSystem.ts`), a
smudge with a white dot, not a waypoint.

- Kill the Juicer, open the minimap: is the revealed patch
  noticeable without being read as "go exactly here"? Does the announcer line
  land once and only once?

## Phase 3 — In-world breadcrumb: the draft

A stairwell is a hole to the floor below; give it a draft. Within
`STAIRWELL_DRAFT_RADIUS_TILES = 14` of any stairwell footprint centre, spawn
slow dust motes that drift toward the stairwell, rendered in
`StairwellSystem`'s render pass (`renderStairwells` in
`src/systems/StairwellSystem.ts`):

- `STAIRWELL_DRAFT_MOTES_MAX = 24` concurrent, `STAIRWELL_DRAFT_MOTE_SPEED`
  well under player speed, alpha ≤ 0.5 — a cue you notice while fighting, not
  a particle show. Raw `ctx` is correct here (game-world rendering, not UI
  chrome).
- The current render culls at `STAIRWELL_OFFSCREEN_MARGIN = 2`
  stairwell-widths (the offscreen-cull check inside `renderStairwells`,
  `src/systems/StairwellSystem.ts`); the draft needs its own wider cull
  (`STAIRWELL_DRAFT_RADIUS_TILES` + viewport) or motes pop in at the screen
  edge.
- Optional, and a candidate for Ryan to judge by ear: a soft looping air
  sound via the add-sound pipeline, positional within the same radius. Ship
  the visual first.

This is the micro hint: it confirms "warmer" once the player is already in
the right neighbourhood, which Phases 1–2 make likely.

- Walk a corridor 10–14 tiles from a stairwell: do the motes read as
  a directional draft at game speed? Are they invisible enough during combat?

## Phase 4 — Wayfinder fail-safe (and the arrow dedupe)

For the player Phases 1–3 still didn't rescue. After the floor's last gauntlet
boss is dead AND `WAYFINDER_GRACE_FRAMES = 5400` (90 s) have passed without a
`stairwellFound`:

- Every `WAYFINDER_PULSE_PERIOD_FRAMES = 600` (10 s), show the
  over-player arrow for `WAYFINDER_PULSE_VISIBLE_FRAMES = 90` (1.5 s), with
  the bearing to the nearest stairwell **quantized to 8 compass directions** —
  a nudge ("north-east-ish"), not a route. One announcer line the first time
  it fires ("Your whiskers catch a draft…").
- Render it from the block that already hosts the objective arrows (in
  `DungeonScene.render()`, gated on `!gameOver && !pauseMenu.isOpen`).
- It stops permanently for the floor on the first `stairwellFound`.
- The grace timer must be captured/restored with the world checkpoint —
  follow `StairwellCheckpoint`'s pattern (`captureCheckpoint`/
  `restoreCheckpoint` in `src/systems/StairwellSystem.ts`, and the
  `stairwell` field on `WorldCheckpoint` in `src/core/WorldCheckpoint.ts`) so
  dying doesn't reset (or skip) the fail-safe.
- **Cleanup in the same phase:** `renderStairwellRevealArrow`
  (`src/scenes/DungeonScene.ts`) is a copy-paste of `drawArrowAbovePlayer`
  (`src/ui/WorldArrow.ts` — its own docstring says it exists to be reused).
  Fold the cheat arrow onto the shared helper and implement the Wayfinder on
  the same call with the quantized bearing. One arrow renderer, two callers.

- Idle post-Juicer for 90 s: the pulse should read as a hint you can
  ignore, and the exact-bearing `!reveal` cheat must still work unchanged.

## Phase 5 — Stairwell menu: recommended level + soft warning

**5a. Derivation.** Export from `src/levels/spawner.ts` (it owns
`MOB_LEVEL_PARTY_RATIO`):

```ts
recommendedPartyLevelFor(levelDef): number
// smallest L with round(L * MOB_LEVEL_PARTY_RATIO) >= maxBandCeiling(levelDef)
```

where `maxBandCeiling` is the highest `maxLevel` across the floor's
`mobSpawns` (plus its hallway rules). For floor 2 (ceiling 6) this yields
**8** — the first level at which `earnedLevelFloor` reaches the band ceiling,
i.e. "the floor will show you its strongest version and you can take it."
Playtesters who called floor 2 right arrived at ~10, so 8 is the _floor_ of
comfortable, which is what a recommendation should be. No `LevelDef` field, no
second copy of the number (N4).

**5b. Menu rework.** `StairwellSystem.renderMenu`
(`src/systems/StairwellSystem.ts`) is hand-rolled `fillRect`/`strokeRect` with
~30 local layout constants (the `STAIRWELL_MENU_*` block near the top of the
file) — a standing violation of the shared-UI rule. Port it to `drawModal` +
`drawButton` (`BOX_PRESETS.modal`, `BUTTON_PRESETS.primary` /
`BUTTON_PRESETS.toggle`), following `SkillBookPrompt`
(`src/ui/SkillBookPrompt.ts`) — it is the exact shape wanted: overlay, modal,
state-dependent body text, amber consequence line
(`WARNING_COLOR = '#fbbf24'`, same file), two preset buttons. Keep the
existing open/dismiss/checkpoint flow (`detect`/`closeMenu`/`handleClick` and
`captureCheckpoint`/`restoreCheckpoint` in `StairwellSystem.ts`) untouched.

**5c. Content.** With `party = partyLevelOf(human.level, cat.level)`
(`partyLevelOf` in `src/levels/spawner.ts`) and
`rec = recommendedPartyLevelFor(nextDef)`:

- `party >= rec`: one line under the prompt — "Recommended level: 8" in
  `TEXT_PRESETS.value`.
- `party < rec`: the line in `TEXT_PRESETS.danger`, plus an amber warning in
  the SkillBookPrompt style: "The foes below fight like a level-8 party. You
  are level 5 — this floor still has strength to give." Descend stays enabled
  and unchanged (N3); Phase 0's `descendedUnderleveled` counter records the
  choice.
- Terminal floors (`nextLevelId` undefined) never open the menu today (the
  `nextLevelId` check at the top of `detect()` in
  `src/systems/StairwellSystem.ts`); nothing to do.

- Reach a stairwell at level 5 and at level 9: does the warning read
  as advice rather than a scold, and does the ported menu look native next to
  the other modals (pause, skill book)?

## Phase 6 — Floor 1 region level bonus

Mirror the shipped `regionSpawnBonus` mechanism
(`PRE_HOARDER_SPAWN_BONUS`/`POST_HOARDER_SPAWN_BONUS`/`POST_JUICER_SPAWN_BONUS`
in `src/levels/level1.ts`, applied to the room's spawn count in `spawnForLevel`,
`src/levels/spawner.ts`) with a `regionLevelBonus` on `ProgressionDef`:

```ts
// level1: regionLevelBonus: [0, 1, 2]   (pre-Hoarder, post-Hoarder, post-Juicer)
effectiveBand = {
  minLevel: min(band.minLevel + bonus, MAX_MOB_LEVEL),
  maxLevel: min(band.maxLevel + bonus, MAX_MOB_LEVEL),
};
```

applied where the spawn's band is resolved, before
`resolveSpawnLevel`/`earnedLevelFloor` (`src/levels/spawner.ts`,
`MAX_MOB_LEVEL = 20` in the same file). The bonus applies to the room's
weighted rule **and its escorts** (the archer escort's `escorts` entry on the
goblin `roomMobs` rule, `src/levels/level1.ts`) so a room stays internally
coherent, and to treasure-room guards (the `mob.applyMobLevel(...)` call in
`spawnTreasureRoomMobs`, `src/levels/spawner.ts`) so a post-Juicer treasure
room is not softer than its hallway. Whether hallway spawn points carry a
region tag must be checked at implementation — today `GameMap.hallwaySpawnPoints`
carries only `{ x, y }`, no region — so rats simply stay level 1, which is
acceptable ambience.

Resulting curve for an on-schedule party (band shifts, then the party floor):

| Region        | Goblin band | Typical party | Spawned goblin          | HP / heavy dmg / swing |
| ------------- | ----------- | ------------- | ----------------------- | ---------------------- |
| pre-Hoarder   | 1–2 (+0)    | 1–3           | 1–2                     | 6–8 / 2–3 / 90–86 f    |
| post-Hoarder  | 2–3 (+1)    | 4–6           | 3                       | 10 / 3 / 82 f          |
| post-Juicer   | 3–4 (+2)    | 7–10          | 4                       | 12 / 4 / 79 f          |
| floor 2 entry | 3–6 (ref.)  | ~10           | 6 (trog: 55 HP / 8 dmg) | —                      |

Llamas run 3–5 post-Juicer (level 5: 22 HP, 4-damage bolt), archers 3–5. The
pre-Hoarder region is untouched — `PRE_HOARDER_SPAWN_BONUS` in
`src/levels/level1.ts` is 0, deliberately leaving the "easy early floor stays
easy" contract alone — and the floor now hands the player a stepped ramp into
the floor-2 numbers instead of a 7× HP cliff.
Floor 2 gets **no** `regionLevelBonus` in this plan (it is the reference; its
existing `[+1, +2]` _count_ bonus — `PRE_KRAKAREN_SPAWN_BONUS`/
`POST_KRAKAREN_SPAWN_BONUS` in `src/levels/level2.ts` — stays as is).

Guardrails: levels still resolve once, at floor generation (the
`spawnForLevel` call in `DungeonScene`'s constructor); `applyMobLevel` already
refuses a second call (`src/creatures/Mob.ts`), so the bonus must shift the
_band_, never re-level a live mob. `MOB_LEVEL_DAMAGE_SCALE`/`MOB_LEVEL_HP_SCALE`
are untouched — this plan adds no new scaling axis, it uses the four that
shipped.

- Full floor-1 run with `?difficulty`: post-Juicer room fights
  should land in the 40–70% HP band, and the floor-2 entry should feel like a
  step, not a wall. Compare hunt-time and arrival-level against the Phase 0
  baseline.

## Phase 7 — Verification harness

Extend the two existing gates (both scripts are already registered;
**register any new script file in `tsconfig.scripts.json`'s `include` list**
— scripts typechecking is opt-in and an unregistered script silently passes):

- `npm run verify:progression` (`src/map/progressionValidation.ts`): every
  unwaived stairwell within `[STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT]`; separation ≥ 45 unchanged; over 50
  maps per floor, assert at least one map places a stairwell strictly inside
  the band's interior (catches a regression back to perimeter-only).
- `npm run verify:difficulty` (`scripts/verify-difficulty.ts`):
  `recommendedPartyLevelFor` is monotone in the band ceiling and equals 8 for
  the current floor-2 bands; `regionLevelBonus` never pushes a band past
  `MAX_MOB_LEVEL`; a bonused band's `earnedLevelFloor` still respects
  `MOB_LEVEL_PARTY_RATIO` (the "party always out-levels its mobs" guarantee,
  `earnedLevelFloor` in `src/levels/spawner.ts`); Wayfinder constants — grace,
  period, visible frames — are positive and
  `WAYFINDER_PULSE_VISIBLE_FRAMES < WAYFINDER_PULSE_PERIOD_FRAMES`.

Both gates plus `npm run typecheck`, `npm run lint`, `npm run format` before
any phase is called done.

---

## Sequencing

1. **Phase 0** first — the baseline numbers are the whole point of N5.
2. **Phases 1 + 2** together, one playtest: placement and the map hint are the
   high-leverage pair and independent of everything else.
3. **Phase 5** any time (pure UI + one derivation; no dependency on 1–4).
4. **Phase 6**, own playtest — it is the only combat-facing change, keep its
   effects unconfounded.
5. **Phases 3 + 4** last: they are the polish and the fail-safe, and the Phase
   2 playtest may shrink how much of them is needed.
6. **Phase 7** lands with whichever phase first touches its assertions
   (i.e. with Phase 1).

## What we are deliberately NOT doing

- No exact-position arrow outside the `!reveal` cheat and the quantized,
  intermittent Wayfinder pulse.
- No full map screen, no fast travel, no stairwell count increase — floor 1
  already doubles the default (`LEVEL1_STAIRWELL_MULTIPLIER` in
  `src/levels/level1.ts`).
- No gating stairwells on boss kills: the spatial relationship (≥ 35 tiles
  from the exit) is the design, per the comment introducing the
  stairwell-placement block in `buildDungeon` (`src/map/DungeonGenerator.ts`).
- No XP-curve, diminishing-tier, or `MOB_LEVEL_PARTY_RATIO` changes — the
  ~level-10 arrival is what makes floor 2 right; §2 is the argument.
- No floor-2 band changes, no new mob-scaling axes, no live re-levelling
  (P5 of `docs/difficulty-fairness-rules.md` stands: levels apply once, at spawn).
- No forced grind: the recommendation informs, the Descend button never locks.
