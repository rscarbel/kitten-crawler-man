# Difficulty Rebalance Plan

Goal: the game should apply real pressure — fights that can be lost, potions that get
used, rooms that demand attention — without becoming frustrating. Frustration is kept
out by explicit fairness rules and by leaving the death penalty generous, not by
keeping enemies weak.

Non-goals: no HP-sponge enemies, no 1:1 player-level matching, no death-penalty
changes, no live mid-floor rescaling.

All numbers below are **starting points for tuning**, not final values. Every phase
ends with a `[HUMAN]` playtest gate; do not stack multiple untested nerfs into one
playtest.

---

## 1. Why the game is easy today (measured from the code)

**Healing erases all pressure.**

- Passive regen is a flat fraction of max HP: the human heals 100% of max HP every
  60 s, the cat every 80 s (`src/systems/PlayerTickSystem.ts:6-9`). It never pauses —
  it runs _during_ combat. Because max HP is `8 + CON × 2`, absolute regen scales
  linearly with constitution: 0.23 HP/s at starting CON 3, 0.53 HP/s at CON 12.
- A level-1 goblin's theoretical maximum output is ~0.9 damage/s (1–2 damage on a
  90-frame cooldown, `src/sprites/goblinSprite.ts:49-52`), before dodge (9–37% from
  DEX) and before its swing whiffs. A mid-game human literally out-regens a goblin
  that never misses. This is the "outheal everything by level 3" feeling.
- On top of that: 10 starting potions healing 50% max HP each on a ~5.5 s cooldown
  (`src/Player.ts:106,121`), a 25% potion drop per mob kill (`src/creatures/Mob.ts:121`),
  and 5-coin shop potions. Supply is enormous and demand is zero.

**Enemy level scaling only touches the axes that don't create pressure.**

Enemy threat = damage × cadence × hit-rate × count. `applyMobLevel`
(`src/creatures/Mob.ts:594-609`) scales HP +30%/level, damage +20%/level, speed
+8%/level — and nothing else:

- **Cadence never scales.** A level-8 goblin swings every 1.5 s exactly like a
  level-1 goblin. The llama spits every 2.5 s forever. The troglodyte's full attack
  cycle is ~3.6 s at every level.
- **Hit-rate never scales.** The troglodyte locks its aim 417 ms before the strike
  and checks a single frame in a ±60° cone; the llama's bolt travels 1.9 px/frame
  and the llama stands still while the player closes; every one of these is
  trivially sidestepped at level 1 and _identically_ trivially sidestepped at
  level 8.
- **Count never scales.** Spawn tables are fixed at floor generation; nothing gets
  denser as the run progresses, and clearing a boss changes nothing
  (`bossDefeated` only grants achievements, `src/scenes/DungeonScene.ts:1770-1799`).

**Meanwhile player power scales on every axis.** STR adds damage linearly, Smush
multiplies melee ×5 → ×29.7 across ability levels, Magic Missile ×1 → ×5.2, dodge
climbs toward 60%. A level-6 troglodyte (55 HP) dies to a single mid-level Smush.

**Several spawns never level at all.**

- Bosses from `bossRooms` spawn at base stats — `applyMobLevel` is never called
  (`src/levels/spawner.ts:398`).
- `extraSpawns` (the troglodytes guarding the Juicer, the sky fowl) are level 1
  (`spawner.ts:272`).
- Floor 2's on-kill brindle grubs are level 1 (`DungeonScene.ts:1760`).

**Conclusion:** the fix is not bigger numbers. It is (a) making healing a resource
that must be managed, and (b) making enemy _cadence, behavior, and count_ scale —
bounded — so higher-level enemies actually threaten more often, not just survive
longer.

---

## 2. Design principles

- **P1 — Pressure over sponge.** Prefer scaling how often and how well enemies
  attack over inflating HP. Time-to-kill bloat reads as grind, not challenge.
- **P2 — Fairness rules (hard invariants, encoded in the verify script):**
  - Every telegraphed attack keeps a **locked** (aim-frozen) telegraph of ≥ 21
    frames (350 ms) at every level.
  - Every scaled cooldown/windup has an explicit floor; every scaled projectile
    speed has an explicit cap below player run speed. Everything asymptotic,
    nothing unbounded (see the curve in Phase 2).
  - Damage-avoidance must remain possible by movement alone — scaling may shrink
    the margin, never remove it.
- **P3 — Keep death generous.** Checkpoint restore, no XP/coin loss, full-HP
  respawn all stay. The counterweight to harder fights is cheap retries.
- **P4 — Tune with data.** Phase 0 adds counters so "too easy" becomes a number
  before and after each phase.
- **P5 — Levels are applied once, at spawn.** `applyMobLevel` compounds if called
  twice (warned at `src/systems/bountyDefs.ts:37-41`). No system may re-level a
  live mob.

Target feel (the numbers Phase 0 measures against):

| Metric (on-level player)                | Target |
| --------------------------------------- | ------ |
| HP remaining after a regular room fight | 40–70% |
| Potions used per gauntlet segment       | 1–3    |
| Deaths per floor, first clear           | 0–2    |
| Time-to-kill, one regular mob           | 3–8 s  |

---

## 3. Phase 0 — Difficulty telemetry — **SHIPPED 2026-08-04**

Landed as `src/core/DifficultyStats.ts` (a run-scoped singleton, not fields on
`GameStats`: that object is rebuilt with its `DungeonScene`, so counters on it
would be lost at every stairwell — and the target-feel table is measured across a
whole run), `src/systems/DifficultyTelemetrySystem.ts` for the per-frame half,
and `src/dev/difficultyOverlay.ts` behind `?difficulty`. `?perf` and
`?difficulty` now compose rather than overwriting each other.


Add counters to `GameStats`: damage taken, potions consumed, dodges, deaths, and
per-room-fight HP delta (bucketed per floor segment: pre-Hoarder / post-Hoarder /
post-Juicer / floor 2 / floor 3). Surface them on a dev overlay (alongside the
existing dev boot tooling) so a playtest ends with numbers, not vibes.

Record a baseline run **before** Phase 1 lands so every later phase has a
comparison.

- `[HUMAN]` One baseline playthrough of floor 1 + floor 2 with the overlay on;
  save the numbers into this doc.

## Phase 1 — Healing economy — **1a + 1b SHIPPED 2026-08-04; 1c deliberately not done**

`Player.framesSinceDamaged` / `Player.isRegenSuppressed` and the new curve in
`PlayerTickSystem.humanRegenHpPerSecond`. 1c stays unimplemented on purpose: the
plan gates it on playtest data that does not exist yet.


This is the highest-leverage change in the plan. Everything else raises pressure;
this is what makes pressure _stick_.

**1a. Combat regen suppression.** Passive regen pauses for
`REGEN_SUPPRESS_FRAMES = 300` (5 s) after the crawler last **took** damage (track a
`framesSinceDamaged` counter in `Player`; DoT ticks refresh it too). Inside a safe
room, regen is never suppressed. This single change makes potions the in-combat
healing resource without touching any other number — out-of-combat recovery stays
free, so it cannot create tedium between fights.

**1b. Regen curve with CON diminishing returns.** Ryan's instinct is right, with
one correction: CON currently has no regen term at all — regen scales with CON only
because it is proportional to max HP. Decouple them. Replace
`maxHp / REGEN_FRAMES` with a flat base plus an asymptotic CON term:

```
humanHpPerSecond = REGEN_BASE + REGEN_CON_GAIN * CON / (CON + REGEN_CON_HALF)
// starting values: REGEN_BASE = 0.08, REGEN_CON_GAIN = 0.35, REGEN_CON_HALF = 10
```

| CON       | Current HP/s | Proposed HP/s           |
| --------- | ------------ | ----------------------- |
| 3 (start) | 0.23         | 0.16                    |
| 6         | 0.33         | 0.21                    |
| 12        | 0.53         | 0.27                    |
| 30        | —            | 0.34 (→ 0.43 asymptote) |

High-CON builds still heal fastest, but the gap between CON 6 and CON 12 is 0.06
HP/s instead of 0.20 — CON's main sell becomes max HP (unchanged, 2 per point) and
the potion-cooldown reduction it already has. The cat keeps a flat rate ≈ her
current 0.075 HP/s (her CON is locked; her survivability is dodge + Cockroach and
should stay that way). `regenMultiplier` items (Trollskin Shirt, Shell ≥ L10) keep
multiplying the final rate.

**1c. Potion economy trim — only after 1a+1b are playtested.** If potions still go
unused: starting stock 10 → 6, drop chance 25% → 15%, shop price 5 → 8. Do **not**
touch the 50% heal or the cooldown — a potion that feels weak when finally needed
is the frustrating outcome we're avoiding. Skip 1c entirely if the playtest shows
potion use in the 1–3-per-segment band.

Files: `src/systems/PlayerTickSystem.ts`, `src/Player.ts`, `src/creatures/Mob.ts`,
`src/systems/ShopSystem.ts`.

- `[HUMAN]` Playtest floor 1 with 1a+1b only. Check: potions get used, and
  between-fight downtime doesn't feel like waiting. Decide 1c from the numbers.

## Phase 2 — A cadence term in the central level curve — **SHIPPED 2026-08-04**

`Mob.scaledCooldownFrames` / `cooldownScaleForLevel`, called by goblin, llama,
troglodyte, rat, ruins ghoul and krasue. `MobLevelRange` is now shared by
`MobSpawnRule`, `CampSpawnRule`, `ExtraSpawnRule` and the new `BossRoomRule`, so
boss rooms and `extraSpawns` are levelled at last; floor 2's on-kill grubs
inherit the dead mob's level.


Add a fourth scaling axis next to the existing constants in `src/creatures/Mob.ts`:

```
cooldownScale(level) = CADENCE_FLOOR + (1 - CADENCE_FLOOR) / (1 + CADENCE_RATE * (level - 1))
// starting values: CADENCE_FLOOR = 0.55, CADENCE_RATE = 0.12
// level 1 → ×1.00, level 4 → ×0.88, level 8 → ×0.79, level 15 → ×0.72, asymptote ×0.55
```

Because every creature owns its private cooldown counter, expose it as a `Mob`
helper — `scaledCooldownFrames(baseFrames): number` — and have each creature call
it where it resets its timer: goblin swing 90 f, llama spit 150 f, troglodyte
post-strike 150 f, rat, ruins ghoul, krasue. This one mechanism delivers the
bounded "attacks more often at higher level" Ryan asked for on llamas, goblins,
and troglodytes simultaneously, with the asymptote he specified.

Also in this phase, fix the never-leveled spawns:

- `bossRooms` and `extraSpawns` rules get an optional `level` (or
  `minLevel`/`maxLevel`) honored by the spawner. Give the Juicer-guard troglodytes
  level 2–3 and floor-appropriate levels to sky fowl.
- Boss levels come in Phase 6 (player-relative); until then give each boss a fixed
  sensible level in its rule.
- Floor 2's on-kill brindle grubs inherit the dead mob's `mobLevel`.

Leave `MOB_LEVEL_HP_SCALE` at 0.3 (P1: no sponges). Hold `MOB_LEVEL_DAMAGE_SCALE`
at 0.2 for now — with cadence and hit-rate improving, effective DPS already rises
multiplicatively; revisit with Phase 0 data before touching it.

- `[HUMAN]` Floor 2 room fights: do level 5–6 mobs feel noticeably more insistent
  than floor 1's, without feeling machine-gun spammy?

## Phase 3 — Signature-enemy behavior — **SHIPPED 2026-08-04**

One correction to the text below: the plan's `BOLT_SPEED_CAP = 2.6` contradicts
the plan's own fairness rule in the same sentence — `PLAYER_SPEED` is 2.5, so
2.6 is *above* player run speed, not comfortably below it. Shipped as a fraction
of `PLAYER_SPEED` (0.9 → 2.25) so the rule is the thing written down and cannot
drift if player speed is retuned.


**3a. Lava Llama** (`src/creatures/Llama.ts`, `src/systems/LavaBallSystem.ts`)

- Spit cadence: covered by Phase 2 (150 f → ~118 f at level 8, floor 83 f). This is
  exactly the asymptotic speed-up Ryan described.
- Bolt speed: +4%/level, hard-capped at `BOLT_SPEED_CAP = 2.6` px/frame — the cap
  must stay comfortably below player run speed so bolts remain outrunnable
  (verify against actual player speed in the playtest; P2).
- Evasive maneuvers, from level 4+: after each spit release, sidestep 1–2 tiles
  perpendicular to the target line ("strafe-after-spit"); and when the target
  closes within 2.5 tiles, back away to ~4 tiles before resuming fire (it
  currently stands still even at melee range, `Llama.ts:136`). Give the retreat a
  commit distance and a cooldown so it can't yo-yo forever — a llama that can
  never be caught is the frustrating version (see the leash-vs-aggro yo-yo
  gotcha).
- Burst/flame-patch damage stays flat and unscaled — it's undodgeable
  environmental damage, and scaling undodgeable damage violates P2.

**3b. Troglodyte** (`src/creatures/Troglodyte.ts`)

- Scale `WINDUP_FRAMES = 50` down with level on the Phase 2 curve shape, floored
  at 32 frames (533 ms). The aim-lock point stays at 25 frames before the strike,
  so the **locked, dodgeable telegraph portion never shrinks** — only the
  aim-tracking portion compresses (50→32 total means tracking drops from 25 f to
  7 f). At the floor, full cycle falls from ~3.6 s to ~2.4 s (with the Phase 2
  cooldown scaling): real pressure on floor 2, unchanged feel at level 1 on
  floor 1 — precisely the split Ryan asked for.
- Range, cone, and poison chance unchanged.

**3c. Goblins** (`src/creatures/Goblin.ts`)

- Faster with level: already true (+8%/level speed). Attacks more often: Phase 2
  (90 f → ~71 f at level 8, floor 50 f). Keep the 15-frame first-engagement
  hesitation as-is; it's a good fairness beat.
- **Pack alert:** goblins currently have pure single-target aggro — "groups" are
  just spawn density, and a room of 4 can be pulled one at a time. Add a shared
  `alertNearbyAllies(radiusTiles)` helper on `Mob`: when a goblin aggros or takes
  damage, same-type mobs within 6 tiles acquire the same target. This makes the
  existing 2–4-per-room spawns _behave_ like the larger groups Ryan wants before
  we spawn a single extra body — and floor-3 camps get it for free.

- `[HUMAN]` Fight leveled llamas (kiting feel — pressuring, not uncatchable),
  floor-2 troglodytes (dodgeable but demanding), and a goblin room (they come as a
  pack now).

## Phase 4 — Goblin Archer (new creature) — **SHIPPED 2026-08-04**

Art: a fifth `bow` archetype on the goblin pipeline (`goblin_bow.png`), which
also gave `GoblinGear` a quiver and `GoblinProp` a shape that changes per frame —
a bow's string is pulled by the *other* hand, so the painter is handed the pose.
Three blind image-review rounds; the third still wants more of the bow in the
walking silhouette, which is a `[HUMAN]` call at this point.

Behaviour: `src/creatures/GoblinArcher.ts` (a 3.5–6-tile band, a bounded
retreat, and two shots that differ in draw length but never in locked telegraph)
plus `src/systems/GoblinArrowSystem.ts`, modelled on `SkeletonProjectileSystem`
so an arrow outlives the archer that loosed it.

Spawning: a new `escorts` field on `MobSpawnRule` — the plan's "never alone"
is a *contract*, and a weighted table that can only pick one rule per room
cannot express it any other way. Escort places are reserved against
`MAX_ROOM_SPAWN_COUNT` before the host rule rolls, so a full room still gets its
archer. Floor 1 gates them behind the Hoarder via `minRegion`.

Also: `Mob.packKind`, so the archer and the melee goblins answer one call.
Memory note the plan asked for — this is a fifth preloaded goblin sheet
(1120×960), which the sprite-memory gotcha says is the axis that matters.

Two things a code review caught that are worth writing down, because both were
green under every check that existed at the time:

- The aim lock was **cosmetic**. It froze the sprite's facing and left the shot
  vector resolved on the release frame, so an arrow tracked a dodging player
  perfectly and the 21 frames of telegraph bought them nothing. The verify
  script asserted the *constant* was 21, which proved nothing about the runtime.
  It now drives a real archer through a draw with a moving target.
- The bow's release frame had **no gate at all**: it is exempt from G13b (which
  measures a weapon tip, and a bow's tips are its limbs), invisible to G14
  (which returns early on a null off-grip), and inside G4/G8's declared
  acceleration window. `gateBowDraw` (G16) is the replacement, and it caught a
  one-frame teleport of the draw hand onto the riser on exactly the frame the
  arrow spawns.

A confirming round then found two defects **inside** G16 itself, which is the
lesson worth keeping: a threshold is not a check until you have watched it fail.
Its fist-on-string test compared an absolute draw against a row whose peak draw
is lower, so it silently skipped the whole hurried shot; and its "full draw is
held at the loose" test compared the peak with itself. Both are now relative to
the row's own full draw, and every gate added in this pass has been falsified
by hand — broken deliberately, watched to fail, restored.


Ryan's best idea, and the most expensive one: melee goblins pin you while an
archer punishes from range — that's genuine tactical pressure and target-priority
gameplay, which no amount of stat tuning produces.

- **Behavior:** holds a 3.5–6-tile band; repositions away when the player closes;
  arrow has a ~30-frame draw telegraph (locked aim for the last 21 f, per P2),
  2 damage, 130-frame cooldown (Phase 2 curve applies), dodgeable projectile.
- **Implementation:** arrows live in a dedicated projectile system modeled on
  `SkeletonProjectileSystem` — never stored on the mob (the mob-owned-projectiles
  bug: a projectile stored on a Mob is deleted mid-air on its death).
- **Spawning:** never alone, always attached to a melee group. Floor 1: only in
  post-Hoarder regions, max 1 per room at low weight. Floor 2: up to 2 per goblin
  room. Floor 3 camps: 1–2 mixed in.
- **Art:** a new `bow` archetype on the goblin sheet via the bipedal-figure
  pipeline (draw/loose/recover rows + gore). This is a real art-pipeline lift —
  budget it as its own work item, and mind the sprite memory budget (sheets are
  all preloaded at boot).

- `[HUMAN]` A mixed room on floor 1 post-Hoarder: does the archer force movement
  decisions without feeling like chip-damage spam?

## Phase 5 — Density escalation through the run — **SHIPPED 2026-08-04**

`MobSpawnPoint.region` is tagged by the generator (only it knows which gauntlet
owned a room) and `ProgressionDef.regionSpawnBonus` is applied in
`spawnForLevel`, capped by `MAX_ROOM_SPAWN_COUNT`. Room placement now runs the
`hasRoomToMove` pass before falling back to bare `isWalkable`. The grub swarm is
bounded by `MAX_CONCURRENT_ON_KILL_SPAWNS`, counted through the new
`Mob.spawnTypeKey`. `POST_HIT_GRACE_FRAMES` is held in reserve as the plan asks.


The generator already knows which rooms belong to which progression region
(gauntlet 0 branches, gauntlet 1 branches, free-roam). Tag rooms with a region
index and let `ProgressionDef` carry a per-region spawn-count bonus, applied to
the rolled `minCount`–`maxCount`:

- Floor 1: pre-Hoarder +0 (unchanged — easy early floor stays easy), post-Hoarder
  +1, post-Juicer +2. Exactly Ryan's proposal, and it lands on the right
  mechanism: the count axis, which currently never scales.
- Floor 2: +1 across the board (rooms become troglodyte 2–4 / llama 2–4 / goblin
  4–6), +2 after the Krakaren gauntlet.
- Hard cap per room (`MAX_ROOM_SPAWN_COUNT = 6`) so a bad roll never produces a
  wall of bodies.

Guardrails:

- Placement must use `hasRoomToMove`, not `isWalkable` (the trapped-spawn gotcha).
- Floor 2's on-kill grub rule spawns 1–5 grubs per _any_ mob death — more bodies
  per room multiplies grub swarms. Cap concurrent grubs or exclude bonus-count
  mobs from the grub trigger; decide during implementation.
- **Spike-death watch:** the player has zero post-hit i-frames — three goblins
  connecting on the same frame is nearly a one-shot at 14 max HP. If the playtest
  shows deaths that feel like "I exploded instantly," add a short
  `POST_HIT_GRACE_FRAMES = 12` (200 ms) against mob _melee_ only. Hold it in
  reserve rather than shipping it preemptively — it's a global easing lever.

- `[HUMAN]` Full floor-1 run: does pressure ramp room-to-room, and is the
  post-Juicer stretch busy without slideshow perf or spike deaths?

## Phase 6 — Player-relative enemy levels (soft, floored, capped) — **SHIPPED 2026-08-04**

`partyLevelOf` / `earnedLevelFloor` / `resolveSpawnLevel` / `resolveBossLevel` in
`src/levels/spawner.ts`, resolved once at floor generation from the party as
restored. `Mob.applyMobLevel` now refuses a second call rather than compounding,
which turns P5 from a convention into something the verify script can prove.


Ryan's instinct here is right, including the caveat: 1:1 matching would erase the
reward for getting stronger. The bounty system already does player-relative
levels correctly (`src/systems/BountySystem.ts:112-127`); generalize its shape
with a sub-1 ratio:

```
partyLevel  = max(humanLevel, catLevel)            // as BountySystem does
effectiveMin = clamp(round(partyLevel * 0.7), rule.minLevel, rule.maxLevel)
rolledLevel  = randomInt(effectiveMin, rule.maxLevel)
```

- The 0.7 ratio means an on-level player always out-levels the mobs they meet —
  growth stays rewarding.
- `rule.maxLevel` still caps everything, so each floor keeps its identity and
  descending stays the way to find real danger. Revisiting floor 1 at level 12
  now serves level 2 goblins → level ~8 goblins (still capped by the band), while
  the XP-diminishing tiers keep it unfarmable.
- Levels are computed **once, at floor generation** — exactly "chosen when the
  player starts a level," and required by P5 (no re-leveling live mobs).
- Bosses: per-boss level bands (e.g. Hoarder 1–4, Juicer 3–7, Krakaren 6–10) with
  `bossLevel = clamp(round(partyLevel * 0.8), band)`. This finally levels bosses
  at all (they currently spawn at base stats) while the band floor/cap keeps
  first-encounter tuning intact.

- `[HUMAN]` Enter floor 1 over-leveled and floor 2 on-level: floor 1 should bite
  a little again; floor 2 should feel unchanged for an on-schedule party.

## Phase 7 — Verification harness — **SHIPPED 2026-08-04**

`npm run verify:difficulty` (`scripts/verify-difficulty.ts`, registered in
`tsconfig.scripts.json`). Every check runs against the game's own exported
functions rather than a copy of them.


Mirror `npm run verify:bounty`: add `npm run verify:difficulty` asserting the
invariants so later tuning can't silently break P2:

- `cooldownScale` is monotonically decreasing and never below `CADENCE_FLOOR`.
- Every creature's scaled windup/cooldown respects its floor; locked-telegraph
  durations ≥ 21 frames at level 20.
- Scaled bolt/arrow speeds ≤ their caps at level 20.
- Regen curve: monotone in CON, bounded by `REGEN_BASE + REGEN_CON_GAIN`.
- Spawn-count bonuses never exceed `MAX_ROOM_SPAWN_COUNT`.
- No code path calls `applyMobLevel` twice on one mob.

Register the script in `tsconfig.scripts.json`'s include list (scripts typecheck
is opt-in; an unregistered script is never checked).

---

## Sequencing

1. **Phase 0 → 1 → 2 → 3**, playtest after 1 and after 3. These four deliver most
   of the goal: healing becomes a resource, and existing enemies scale on the
   axes that matter.
2. **Phase 5 → 6**, playtest. Density and relative levels tune the macro curve.
3. **Phase 4** (archer) whenever the art budget allows — independent of 5/6.
4. **Phase 7** alongside whichever phase first adds a scaled formula (i.e. with
   Phase 2).

## What we are deliberately NOT doing

- No 1:1 level scaling, no live rescaling, no uncapped curves.
- No HP-scale increase — sponginess is the failure mode of "make it harder."
- No death-penalty changes, no potion-heal nerf, no potion-cooldown nerf.
- No regen suppression stacked with potion trims in the same playtest — one
  healing nerf at a time, measured.
