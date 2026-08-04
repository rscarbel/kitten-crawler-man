# Bounty System — Core Plumbing

Read `docs/bounty/00-overview.md` first (conventions, review loop, verified
codebase facts). This file is the foundation every other bounty file plugs into.
It must land before files 02–07 are integrated, and it is fully testable on its
own via a debug command that uses an existing mob as a stand-in target.

**Status: PHASES A–D IMPLEMENTED** (Ryan's playtest outstanding)

Skills to load: `game-architecture`, `dev-workflow`, `add-system`, `add-quest`
(for state-machine/dialog conventions), `add-ui` (board/toast touches).

## New files this plan creates

| File                             | Contents                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `src/core/BountyProgress.ts`     | Durable progress record + factory (threaded through `DungeonSceneOptions`)     |
| `src/systems/bountyDefs.ts`      | `BountyDef` interface + `BOUNTY_DEFS` registry (creature files append entries) |
| `src/systems/BountySystem.ts`    | The GameSystem: state machine, spawn, arrow, kill detection, payout            |
| `src/sprites/dangerTelegraph.ts` | Shared red ground-warning drawing helpers (extracted from GrotesqueSpider)     |

Plus edits to: `Mob.ts`, `SpellSystem.ts`, `CompanionSystem.ts`,
`OverworldGenerator.ts`, `GameMap.ts`, `townNotices.ts`, `DungeonScene.ts`,
`RuinsGhoul.ts`, `Krasue.ts`, `MiniMapSystem` wiring.

---

## Phase A — Data model and registry

### A1. `BountyProgress` (`src/core/BountyProgress.ts`)

Follow the `CircusQuestProgress` pattern exactly: a plain mutable record +
`createBountyProgress()` factory, created once when absent and re-passed through
`DungeonSceneOptions` on every scene rebuild (building entry/exit). **The
shuffles happen in the factory** — that is what "shuffled on floor
initialization" means here, and it is why they survive door round-trips.

```ts
export type BountyPhase = 'available' | 'active' | 'kill_pending';

export interface BountyProgress {
  phase: BountyPhase;
  /** Shuffled cycle of BountyDef ids; walked by cycleIndex. */
  typeOrder: string[];
  cycleIndex: number;
  /** Per-type shuffled name arrays + cursor, so a repeat encounter gets a fresh name. */
  namesByType: Record<string, string[]>;
  nameCursorByType: Record<string, number>;
  /** Set while phase !== 'available'. */
  currentTypeId: string | null;
  currentName: string | null;
  currentSiteIndex: number | null;
  bountiesCompleted: number;
}
```

Rules encoded in the factory + helper functions (put the helpers here too, pure
and unit-testable in review):

- `typeOrder` = shuffle of all `BOUNTY_DEFS` ids (Fisher–Yates, `Math.random()`
  — unseeded matches house style; the overworld generator is unseeded too).
- When `cycleIndex` walks past the end, reshuffle `typeOrder` and reset to 0.
  Guard: the reshuffle must not place the just-completed type first (reject and
  reshuffle, or swap), otherwise back-to-back repeats are possible at the seam.
- `namesByType[id]` shuffled once in the factory; cursor advances per issued
  bounty of that type; wraps with a reshuffle using the same no-immediate-repeat
  guard.
- Name arrays come from each `BountyDef` (see A2) — the factory copies then
  shuffles, it does not mutate the def.

### A2. `BountyDef` registry (`src/systems/bountyDefs.ts`)

```ts
export interface BountyEncounter {
  boss: Mob;
  minions: Mob[];
}

export interface BountyDef {
  id: string; // 'mantid' | 'evil_clown' | 'dark_knight' | 'skeleton_lord' | 'rock_golem'
  /** Shown on the notice board and in dialog, e.g. "the Mantid". */
  typeLabel: string;
  /** 5–10 unique bounty names; copied + shuffled into BountyProgress. */
  names: readonly string[];
  /** Build the whole encounter at a site. Implementations must setMap() every
   *  mob. They must NOT push into mobs/mobGrid, must NOT set the bounty flags,
   *  and must NOT call applyMobLevel — BountySystem does all three uniformly.
   *  `applyMobLevel` scales off current stats rather than a stored base, so a
   *  def that also called it would ship a compounded encounter. `level` is
   *  passed only so a def can size the encounter (minion count, loadout). */
  spawn(siteTileX: number, siteTileY: number, map: GameMap, level: number): BountyEncounter;
}

export const BOUNTY_DEFS: readonly BountyDef[] = [
  /* creature files append */
];
```

Ship Phase A with a **single placeholder def** (`id: 'debug_ghoul'`, spawning a
`RuinsGhoul`) guarded so it is only present until the first real def lands —
simplest honest mechanism: keep it in the array, and have file 03–07 sessions
delete it when they add the first real entry (note it in their checklist; it is
also called out in each creature file's integration phase).

### A3. Checklist

- [x] `BountyProgress` + factory + shuffle/cycle helpers written
- [x] `bountyDefs.ts` with `BountyDef`, `BountyEncounter`, `BOUNTY_DEFS`
- [x] `DungeonSceneOptions` gains `bountyProgress?`; created-if-absent in the
      constructor, re-passed at every scene-rebuild site (grep every place
      `circusQuestProgress` is threaded and mirror all of them)
- [x] Validation gates + review loop run (see 00-overview)

---

## Phase B — Mob flags: fog immunity and town aggression

### B1. `immuneToConfusion`

- Add `immuneToConfusion = false` to `Mob` (next to `isConfused`, ~`Mob.ts:315`).
- In `SpellSystem.update()`'s fog loop (~`SpellSystem.ts:513`), extend the
  condition so immune mobs are never flagged. **Do it here, not in
  MobUpdateLoop** — flagging then ignoring would lie to every other reader of
  `isConfused`.
- Toast: when the fog loop skips a mob because of immunity, queue the mob's
  `displayName` (SpellSystem gets a small pending list + drain method, the same
  `*Pending` idiom other systems use). DungeonScene drains it into
  `hotbarToast.show(`${name} sees you through the fog`)`. `HotbarToast` dedupes
  identical text, so per-frame queuing is safe, but still only queue while the
  mob is inside the fog disc. The `name` is the bounty name (e.g. "Slice"), so
  the bounty boss's `displayName` must be set to its bounty name at spawn
  (BountySystem does this — Phase C).

### B2. `ignoresTownSafeZone` promoted to `Mob`

- `Krasue` already has a private `ignoresTownSafeZone` flag; move the field to
  `Mob` (default `false`) and update `Krasue`'s quest-script writers.
- Update the two `accept` predicates that implement town deaggro
  (`RuinsGhoul.ts` ~59-63, `Krasue.ts` ~68-72) to pass when the flag is set.
- BountySystem sets the flag `true` on the boss **and every minion** at spawn.
  Minions reuse existing classes (Goblin, StiltClown, …) that today have no
  safe-zone predicate at all — that is fine (no predicate = already aggressive
  everywhere), but setting the flag uniformly is still correct and future-proof
  if those classes ever gain the predicate.
- Aggression persistence: bounty mobs must never disengage once aggroed (that is
  what "lured into town, they keep following" requires). Do NOT give bounty
  mobs `homePoint`/`leashRadiusTiles` — a leash yanks them home. Instead
  BountySystem anchors idle wandering (Phase C) and, on first aggro, sets
  `forceAggro = true` on the encounter's mobs. Verify `forceAggro` semantics in
  `Mob.acquireTarget` (it bypasses range/sight but not `accept` — with B2's flag
  change, town no longer blocks them).

### B3. Checklist

- [x] `immuneToConfusion` on Mob + SpellSystem check + pending-toast drain
- [x] Toast copy exactly: `` `${name} sees you through the fog` ``
- [x] `ignoresTownSafeZone` on Mob; Krasue migrated; both accept predicates updated
- [x] Validation gates + review loop run

---

## Phase C — Bounty sites, BountySystem, arrow, board, rewards

### C1. Site scatter (generation time)

In `OverworldGenerator.ts`, add `scatterBountySites(...)` modeled directly on
`scatterRuinsSpawnPoints` (~line 1351):

- Target: **8 sites**, ring-sampled between the town safe radius and the map
  edge. Named constants for count, buffers, and clearance.
- Reject candidates inside: town safe radius + buffer, circus disc +
  buffer, camp discs + buffer (all three exclusions already exist in the ruins
  scatter — copy them), and water.
- **Room to fight**: require a mostly-open disc — e.g. ≥ 80% of tiles within a
  6-tile radius are walkable open wilderness ground (`isOpenWildernessGround` /
  road / rubble). Named constants; exact numbers are tunable, intent is "a boss
  with a 3-second flurry or a rolling golem fits here".
- Enforce a minimum spacing between sites (e.g. 30 tiles) so "all over the map"
  is literal.
- Filter through the existing reachability flood fill
  (`overworld/reachability.ts`) the way ambient spawn points are.
- Expose as `GameMap.bountySites: Array<{x: number; y: number}>` (tile coords),
  threaded through the generator result like `circusCentre` is. Empty on
  non-overworld maps.
- Degenerate maps: if fewer than 3 sites survive, log a warning and accept what
  exists (mirrors the generator's existing warn-don't-throw stance).

### C2. `BountySystem` (`src/systems/BountySystem.ts`)

A `GameSystem` constructed in DungeonScene's `isOverworld` block, taking
`(gameMap, bus, progress: BountyProgress, addMob: (mob: Mob) => void, players,
hotbarToast …)` — mirror `SpiderQuestSystem`'s injected-`addMob` shape; the
scene supplies `(mob) => { this.mobs.push(mob); this.mobGrid.insert(mob);
mob.setSpells(this.spells); }`.

Responsibilities:

- **Issue** (called from Shady's dialog completion, file 02; and from the debug
  command, Phase D): pick next type via cycle helpers, pick next name, pick a
  site — random among sites at least ~60 tiles from the player's current
  position (fall back to farthest if none qualify). Call `def.spawn(...)`, then
  uniformly: `applyMobLevel(bountyLevel)` (always — defs must not), set
  `ignoresTownSafeZone = true` on all, `immuneToConfusion = true` on the
  **boss only**, `boss.displayName = currentName`, `boss.isBoss = true`, insert
  all via `addMob`. Update progress: `phase = 'active'`, current fields set.
- **Level formula**: `bountyLevel = clamp(max(human.level, cat.level), 1,
MAX_MOB_LEVEL)` for minions; boss gets `+1` (named constants). This is the
  first player-derived mob level in the codebase — keep it in one exported
  function so tuning is one edit.
- **Kill detection**: subscribe to `bus.on('mobKilled', …)`; when the killed mob
  is the current boss, set `phase = 'kill_pending'`. Surviving minions stay
  alive and hostile (accepted design). Also emit `bossFightInitiated` on first
  aggro and let the boss-music ternary pick a track (see each creature file;
  wiring the event is here, track choice is per-boss).
- **Scene-rebuild recovery**: on construction, if `progress.phase === 'active'`
  the live mobs were lost with the old scene (verify this — if mobs do survive
  rebuilds, skip). Re-spawn the encounter fresh at `currentSiteIndex` with the
  same name (full HP; accepted simplification — record in Journal if the
  reviewer or Ryan wants HP persistence later).
- **Idle anchoring**: until first aggro, keep the encounter near its site — use
  the mobs' existing wander with `homePoint`/`leashRadiusTiles` **cleared the
  moment any encounter mob aggros a player** (leash is fine pre-aggro; it must
  be removed on aggro so town-luring works; simplest is BountySystem watching
  `currentTarget !== null` and clearing leashes + setting `forceAggro` once).
- **Arrow**: render hook draws `drawArrowAbovePlayer` (from
  `src/ui/WorldArrow.ts` — not the inline DungeonScene copies) over the active
  player: while `active` → target the boss's live position; while
  `kill_pending` → target Shady's position (file 02 exposes it; until then,
  the notice board tile). Suppress when within ~4 tiles of the target (mirror
  `TutorialController`'s near-objective suppression). Render in the same
  guarded slot as `renderStairwellRevealArrow` (`!gameOver && !pauseMenu`).
- **Payout** (called from Shady's collect dialog, file 02 / debug command):
  coins to the active player scaled by level (named base + per-level constants),
  `phase = 'available'`, advance cycle + name cursor, clear current fields.
  The _loot_ reward is on the boss corpse (C4), the _XP_ is the kill itself —
  Shady's payout is the coin bonus, which keeps the reward flowing even if the
  cat got the killing blow.
- **Minimap**: expose a `questMarkers`-shaped getter (exclamation at Shady when
  available, skull/target at the site while active, question at Shady when
  kill_pending) and merge it where DungeonScene aggregates quest markers.
- **Board text**: extend `TownNoticeContext` + `buildTownNotices` with the
  bounty state; while a bounty is active the board's bounty notice reads e.g.
  "WANTED: <Name> the <Type> — last seen in the wilds. Speak to the hooded man."
  When available: "The hooded man by this board pays for dangerous work." The
  static `RUINS_BOUNTY` notice is replaced by this dynamic one.

### C3. Shared telegraph helpers (`src/sprites/dangerTelegraph.ts`)

Extract from `GrotesqueSpider.drawSelf` (~lines 908-1010) into pure functions:

```ts
drawDangerCircle(ctx, cx, cy, radiusPx, fade, palette?)
drawDangerCone(ctx, cx, cy, radiusPx, facingAngle, halfAngleRad, fade, palette?)
```

Keep the exact visual recipe (clipped fill at `DANGER_FILL_ALPHA`, diagonal
hazard stripes, animated dashed outline via `performance.now()`); move the
`DANGER_*` constants here. Refactor `GrotesqueSpider` to call them —
**pixel-identical output is the review gate** (the spider is shipped art;
compare screenshots via its preview route). Dark Knight (file 05) and Skeleton
Lord (file 06) consume these.

### C4. Ground-hazard interface for the companion

`CompanionSystem.fleeFromHazards` currently reads `BossRoomSystem` directly.
Generalize:

```ts
export interface GroundHazardSource {
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null;
}
```

`CompanionSystem` takes a list of `GroundHazardSource`; `BossRoomSystem`
implements it unchanged; the clown's gas system (file 04) registers as another.
No behavior change for existing fights — that is the review gate.

### C5. Reward-loot convention (documented here, implemented per boss)

Each boss class overrides `rollLootItems(killer)` (`TheHoarder.ts:292` pattern):
`super.rollLootItems(killer)` + guaranteed picks from a curated high-value pool
(`stat_boost_potion`, `jugg_juice`, `speed_fizz`, `cooldown_crisp`, elevated
skill-book chance via `maybeDropSkillBook`), count/quality stepped by
`this.mobLevel` thresholds (named constants). Coins already scale via
`MOB_LEVEL_COIN_SCALE` — set generous `coinDropMin/Max`. On death the loot takes
the existing `dropLootByOwner(..., isBossLoot = true)` fallback automatically
(no boss room on the overworld) — golden, never fades. Verify once in Phase D.

### C6. Checklist

- [x] `scatterBountySites` + `GameMap.bountySites` + reachability filter
- [x] `BountySystem` implemented and wired (constructor block, update, render,
      space-chain untouched — Shady owns interaction; minimap markers merged)
- [x] Level formula in one exported function
- [x] Arrow uses `WorldArrow.ts`, suppressed when near, both phases targeted
- [x] Board notices dynamic; `RUINS_BOUNTY` static notice replaced
- [x] `dangerTelegraph.ts` extracted; GrotesqueSpider refactored, output verified
      pixel-identical via `?spider`-adjacent preview/screenshot comparison
- [x] `GroundHazardSource` interface; CompanionSystem generalized; hoarder fight
      behavior unchanged
- [x] Validation gates + review loop run

---

## Phase D — Debug harness and end-to-end verification

- [x] Add a `!bounty` chat command next to `!reveal` (`DungeonScene.triggerOpenChat`,
      ~line 2340): issues the next bounty immediately (bypassing Shady), and
      `!bounty done` force-completes payout — so this file is fully testable before
      Shady or any real boss exists (using the `debug_ghoul` placeholder def).
- Walkthrough to verify (browser automation can drive movement/keys; timing
  quirks need Ryan — see memory "browser automation mostly CAN drive the game";
  unregister the service worker first):
  - [x] **Site scatter, headless** — `npm run verify:bounty` (new,
        `scripts/verify-bounty.ts`) generates five overworlds and asserts every
        one yields the full 8 sites, all outside the town safe radius, all clear
        of the circus, and none closer than 30 tiles to another. Five for five.
  - [x] **Cycle, headless** — the same script walks six full cycles: `peek` is
        proved a pure read, every cycle deals each type exactly once, and no
        type or name ever repeats back to back, including across the seam.
  - [x] **Name pools, headless** — every registered type's first pass is
        distinct and the reshuffle never repeats at the wrap.
  - [x] **Every registered def's encounter, headless** — each `spawn()` is
        called for real and its mobs inspected. Catches the double-scaling trap
        automatically: a def that called `applyMobLevel` itself now fails a
        named check rather than shipping a compounded encounter that reads as a
        tuning problem.
  - [x] **The whole state machine, headless** — a real `BountySystem` over a
        real generated map is driven `available → issue → kill → collect →
available`, asserting at each step: the phase, the mark's name and type,
        the mob count, that a second issue is refused, that exactly one mob is
        the boss and is levelled and fog-immune while the escort is not, that
        every mob ignores the town safe zone, that the board copy follows, that
        the coins land on the player, that a second payout is refused, and that
        the next bounty picks a different site.
  - [ ] **[HUMAN]** `!bounty` — the _visual_ half: arrow points correctly and is
        readable, minimap marker shows, board text renders. The state changes
        underneath are covered by `verify:bounty`.
  - [ ] **[HUMAN]** The arrow flips to Shady once the mark is dead
  - [x] **Building entry/exit mid-bounty, headless** — `verify:bounty` rebuilds
        `BountySystem` over the same record and asserts the bounty survives, keeps
        its name and site, re-stages its encounter on the next update, and that
        the re-staged mobs still carry the bounty flags.
  - [ ] **[HUMAN]** Fog scroll: the mark shows the toast verbatim and keeps
        chasing; a nearby normal mob wanders confused
  - [ ] **[HUMAN]** Luring into town: bounty mobs cross the safe radius and keep
        attacking; a RuinsGhoul control deaggros as before
  - [ ] **[HUMAN]** Loot drops golden and persistent at the corpse
- [ ] **[HUMAN]** Ryan playtests feel: site distances, arrow readability, coin
      amounts.
- [x] Validation gates + review loop run — two rounds, second returned only the
      two findings recorded above, both fixed and re-verified.

**Why so much of Phase D is [HUMAN].** Browser automation loads the game and can
drive keys and clicks, but `requestAnimationFrame` throttles to roughly one frame
a second whenever the window is occluded — and every remaining item on this list
is a timing or motion judgement. Rather than claim those from a stalled frame
loop, the checks that _can_ be made deterministic were pulled out into
`npm run verify:bounty`, which is worth more than a screenshot anyway: it runs on
five freshly generated maps instead of the one a human would happen to see.

## Journal

- 2026-08-02 — Plan written; not started.
- 2026-08-02 — **Phases A–D implemented** (Claude, main session).

  **A.** `src/core/BountyProgress.ts` (record + factory + cycle/name helpers) and
  `src/systems/bountyDefs.ts` (`BountyDef`, `BountyEncounter`, `BOUNTY_DEFS`).
  Threaded through `DungeonSceneOptions` at both scene-rebuild sites that
  `circusQuestProgress` uses (building entry/exit, death restart) — deliberately
  **not** at the stairs transition, since bounty sites are floor-3 geometry and a
  new floor should get a fresh record. Shipped with the `debug_ghoul` placeholder
  def per the plan.

  **B.** `immuneToConfusion` and `ignoresTownSafeZone` promoted onto `Mob`;
  `Krasue`'s private flag removed in favour of the shared one; both town-deaggro
  `accept` predicates (`Krasue`, `RuinsGhoul`) honour it. `SpellSystem` skips
  immune mobs in the fog loop and queues their `displayName`; `DungeonScene`
  drains that into the toast.

  **C.** `scatterBountySites` in `OverworldGenerator` (8 sites, ring-sampled,
  town/circus/camp/water exclusions, ≥80% open ground in a 6-tile disc, ≥30 tiles
  apart, filtered through the existing reachability flood fill, warn-don't-throw
  below 3). `BountySystem` with the full state machine. `dangerTelegraph.ts`
  extracted from `GrotesqueSpider` and the spider refactored onto it.
  `GroundHazardSource` extracted; `CompanionSystem` now takes a registered list
  and `BossRoomSystem` registers itself.

  **D.** `!bounty` / `!bounty done` chat commands beside `!reveal`.

  **Deviations from the plan, and why.**
  - `dangerTelegraph.ts` takes a `DangerPalette` rather than hard-coding one
    recipe. The spider's ring and cone differ in three colours and three dash
    constants, and a single palette could not have reproduced both — the plan's
    "pixel-identical output" gate is only satisfiable with the palette
    parameter. Two exported presets carry the spider's exact values.
  - `bossFightInitiated` fires on **first aggro**, not at spawn. The plan put
    the emit in the issue path; a mark staged sixty tiles away has not started
    a fight, and the boss music would have played across the whole journey.
  - The minimap marker tracks the live boss rather than its site (see review
    round 2 below).

  **Review round 1** (independent agent, full diff + spec). Verified clean: the
  telegraph extraction is pixel-identical call-for-call; the fog bookkeeping;
  the companion generalization; the site scatter's ordering after the natural
  passes. Four genuine findings, all fixed:
  1. `MobUpdateLoop` wrote `forceAggro = false` every frame for any `isBoss`
     mob whenever a `BossRoomSystem` existed — and the overworld builds one with
     zero rooms, so the mark alone silently reverted to ordinary aggro while its
     escort committed. Fixed with `BossRoomSystem.governsBoss(mob)`: the loop now
     only clears the flag for a boss standing inside some room's bounds.
  2. `pickSiteIndex`'s "not the last site" test compared against
     `currentSiteIndex`, which is always null by then. Added `lastSiteIndex` to
     the record, captured in `collectBounty` before the clear.
  3. `BountyDef.spawn`'s contract was ambiguous about `applyMobLevel`, which is
     **not** idempotent — it compounds off current stats. The plan's own A2 text
     told creature sessions to call it, which would have shipped double-scaled
     encounters. Fixed the JSDoc _and_ this plan file, and messaged all five
     in-flight creature sessions.
  4. `SpellSystem.fogResistedNames` was write-only in any scene that never
     drains it (a building interior runs its own `SpellSystem`). Now cleared in
     the per-frame fog pass rather than relying on the drain.
     Dismissed as minor but fixed anyway: `BountySystem.dispose()` was never called
     (safe only because `bus.clear()` happened to cover it) — now called from
     `onExit`; and `peekNextBountyType` mutated the durable record as a side effect
     of a read, which Shady's dialog was about to depend on.

  **Review round 2** (fresh agent, full re-review). Confirmed all five fixes
  correct and complete, including that `governsBoss` cannot change behaviour for
  any shipped boss. Two further genuine findings, both fixed:
  1. `forceAggro` was still set only once. A safe-room checkpoint restore runs
     `resetToSpawn()` on every hostile mob, which clears it — and out here no
     boss room puts it back, so the whole encounter quietly de-committed for the
     rest of the run. It is now re-asserted every frame (`holdAggro`), the same
     lesson `CircusQuestSystem` already records for its wave mobs.
  2. The minimap pinned the red X to the spawn site forever while the arrow
     tracked the live boss, so the two guidance affordances disagreed from the
     moment the fight started. The marker now tracks the boss and falls back to
     the site.
     Also noted: the plan's "idle anchoring" via `homePoint`/`leashRadiusTiles` is
     inert for any class that calls `doWander()` rather than `returnHomeOrWander()`
     — repo-wide only `Goblin` and `Troglodyte` honour it today. Rather than
     special-case it in the system, the obligation is now documented on
     `BountyDef.spawn` and all five creature sessions were messaged directly.

  **Next session must know.** The `debug_ghoul` placeholder has since been
  **removed** — all five real types landed the same day, and `verify:bounty` now
  builds a real encounter from every entry in `BOUNTY_DEFS`, so there is nothing
  left for a placeholder to cover. `!bounty` / `!bounty done` are still the
  fastest way to drive the loop by hand.
