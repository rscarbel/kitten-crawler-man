# Ball of Swine — guaranteed encounter plan

A playtest of floor 2 ended with the player reaching floor 3 without ever seeing
the Ball of Swine's arena. The requirement, per Ryan (2026-08-05), is now
three-fold:

1. **It must be impossible to reach floor 3 without _seeing_ the Ball of Swine
   room** — the arena interior with the boss in it, not merely a door that leads
   there.
2. **Skipping the fight must be a deliberate choice** — the player walks past
   the boss knowingly, not around it obliviously.
3. **The forced route must never require entering anywhere the boss can damage
   the player.**

Plus a source-material nod: in the book the Ball of Swine guards the stairwell
down, and the stairwell in its room appears only when it dies. The geography
here should echo that.

This plan is topology plus a small amount of boss-behaviour hardening. The
fight's design, art, and numbers are untouched.

## 1. Why the room "didn't appear" — root cause

The room **did** appear. Placement is already a hard guarantee on floor 2:

- The `hasArena: true` property on the `level2` `LevelDef` in
  `src/levels/level2.ts` sets it, and in progression mode a failed reservation
  rejects the whole layout — the `if (arenaReservation === null) return
reject('arena reservation');` check in `buildDungeon` in
  `src/map/DungeonGenerator.ts`, right after its `reserveArena(...)` call.
- `generateDungeon` in `src/map/DungeonGenerator.ts` retries rejected layouts
  up to `MAX_MAP_ATTEMPTS = 40` (`src/map/gauntletLayout.ts`) and **throws**
  rather than shipping a floor without one. The boss itself is spawned at
  generation via the `extraSpawns` array on the `level2` `LevelDef` in
  `src/levels/level2.ts` (the entry with origin `'arena:0'`), so it exists and
  animates from level load.

What is _not_ guaranteed is that the player ever walks near it — or, walking
near it, ever has it on screen. Four pieces of evidence:

1. **The stairwells have no relationship to the arena.** Floor 2 asks for two
   stairwells (the `numStairwells: 2` property on the `level2` `LevelDef` in
   `src/levels/level2.ts`), sited in ordinary free-region rooms chosen purely
   by distance from the Krakaren gauntlet's exit plus mutual isolation (the
   progression-branch stairwell-siting logic in `buildDungeon` in
   `src/map/DungeonGenerator.ts`, under its `// 7. Stairwells` comment). The
   arena is sited independently, at a scored far position in a _random
   direction_ from that same exit (the scoring loop inside `reserveArena` in
   `src/map/DungeonGenerator.ts`). Nothing correlates them; a stairwell that
   happens to land near the arena is even filtered _out_ (the
   `filteredStairwells` filter inside `buildDungeon` in
   `src/map/DungeonGenerator.ts`).

2. **The arena is a leaf, not a waypoint.** The free region is a tree rooted at
   the Krakaren boss room (the free-region section of `buildDungeon` in
   `src/map/DungeonGenerator.ts`), and the antechamber hangs off it as a
   junction with up to three exits (the antechamber-junction block inside
   `buildDungeon` in `src/map/DungeonGenerator.ts`) — ways in and out, but
   never a room any route _must_ cross.

3. **The validator proves the floor is skippable.** Invariant I6's second check
   (the `withoutArena` flood-fill block inside `validateProgression` in
   `src/map/progressionValidation.ts`) floods the map with the antechamber
   _and_ the whole arena reserve blocked and **fails the floor if any
   stairwell became unreachable**. Every floor 2 ever shipped carries a
   machine-checked proof that the player can descend without going anywhere
   near the Ball of Swine.

4. **Even a route through the antechamber does not guarantee _seeing_.** The
   world renderer has no fog of war and no line-of-sight gating — mobs draw by
   pure viewport intersection (the `mobGrid.queryRect(...)` query and the
   per-mob cull-margin check in `renderEntities` in
   `src/systems/RenderPipeline.ts`; the only "fog" is a cosmetic distance
   vignette starting at `VISIBILITY_INNER_TILES = 30`, applied in
   `renderVisibilityFog` in the same file). So seeing the boss
   is exactly the question "was it ever inside the viewport". The drum is 26
   tiles across (`ARENA_INTERIOR_RADIUS_TILES = 13`, in
   `src/map/arenaGeometry.ts`) and the ball freezes entirely when both
   players are beyond `AI_RADIUS_TILES = 22` of it (the constant and the
   `mobGrid.queryCircle(...)` activation-range calls in `update` in
   `src/systems/MobUpdateLoop.ts`). A player crossing the
   antechamber's south end sits up to ~28 tiles from a ball parked at the far
   rim — off any sane viewport. Routing someone _past_ the room is not the
   same as putting the boss _on their screen_.

That skippability was the intent at the time — the concourse was built so the
fight would read as optional to the player, and Mordecai says so out loud
("go around to see if you can find a different stairwell",
in `src/systems/mordecaiAdvice.ts`; the ball is called "entirely optional" in
the comment above `BALL_OF_SWINE_MIN_LEVEL` in `src/levels/level2.ts`). The
requirement has changed; the design must change with it. The fight stays
optional — the _viewing_ stops being.

## 2. Design: the way down is behind the drum

**Geometry today** (all from `src/map/arenaGeometry.ts` unless noted): the
arena is a disc of `ARENA_RADIUS = 15` tiles — fight floor out to radius 13,
then a 2-tile `METAL_WALL` band (`ARENA_WALL_THICKNESS = 2`) — wrapped by a
walkable concourse ring 2 tiles wide (`ARENA_RING_WIDTH = 2`, radii 15–17,
carved by the concourse-ring loop inside `carveArena` in
`src/map/DungeonGenerator.ts`). The only door is due south, 2 columns wide
(`ARENA_DOOR_COLUMN_OFFSETS = [-1, 0]`, and the `arenaDoorTileAt` function, in
`arenaGeometry.ts`), its row sealed on both sides (`sealConcourseAcrossDoorRow`
in `DungeonGenerator.ts`) so it touches only the antechamber safe room
directly south (the antechamber `Rect` construction inside `planArenaAt` in
`DungeonGenerator.ts`). The ring's two ends drop into the antechamber through
links at ±6/±7 columns (`linkConcourseToAntechamber` in `DungeonGenerator.ts`).

**The change:** cut a second opening in the ring at the point diametrically
opposite the door — a **north gate** — and seed a **beyond region** (a pocket
of rooms in the rock behind the arena) from it. All floor-2 stairwells are
sited in that pocket. The walk order becomes:

```
start → Krakaren gauntlet (forced) → free roam → antechamber (Mordecai, the door)
      → concourse half-circuit (the viewing walk, boss raging behind iron)
      → north gate → beyond rooms → stairwell
```

The antechamber remains the only way onto the ring from the free region
(invariant I6's door logic is untouched), and the north gate is the only way
off it into the pocket — so every route down walks half the circumference of
the drum, wall-to-wall with the boss. The safe concourse _skirts_ the arena;
the stairs are literally on the far side of the swine.

### 2.1 How "must see" becomes a hard guarantee

Two links in the chain, both machine-checkable or provable from cited code:

**The room.** The renderer draws everything in the viewport at full brightness
with no fog, no LOS occlusion, and no roof over the drum (the viewport-culled
draw pass in `renderEntities` plus the purely radial `renderVisibilityFog`,
both in `src/systems/RenderPipeline.ts`; `ArenaRoomSystem` draws no cover). A
ring walker stands 15–17 tiles from centre; the near sector of the arena floor
is 2–4.5 tiles away and is on screen for the entire half-circuit. Forcing the
circuit (Phase 3's invariant I6d) therefore forces seeing the interior — the
floor, the wet track, the corpse cages (the `ARENA_CAGE` tile type, set by
`setArenaCages` in `src/map/DungeonGenerator.ts`).

**The boss.** Left alone, the ball could be parked out of viewport at the far
rim. It is not left alone: the ball already targets players _outside_ the drum
— `nearestInArena`'s `aggroRange` calculation accepts anything within
`arenaInteriorPx + TILE_SIZE × ARENA_AGGRO_EXTEND_TILES` = 16 tiles of centre
(both in `src/creatures/BallOfSwine.ts`) — and once it has a target, the
`requiresEvasion` getter keeps its AI live at any distance (`BallOfSwine.ts`;
the mob-activation check in `update` in `src/systems/MobUpdateLoop.ts` reads
it). Phase 4 widens that
reach to cover the whole ring, so a ring walker is _always_ its target, and a
charging ball closes to the wall beside them — 2–4.5 tiles away, unmissable.
The acquisition itself is guaranteed: the forced walk starts at the door row
(0, +16 from centre) and ends at the gate (0, −16), and no point of the drum
is farther than √(16² + 11.6²) ≈ 19.8 tiles from the nearer of those two —
inside `AI_RADIUS_TILES = 22` — so the ball gets at least one AI tick with the
walker in aggro range no matter where it froze.

This is deliberately **not** done with the `BossIntroSystem` takeover: that
overlay is a full-screen "B-B-B-BOSS BATTLE!" card that pauses the world (its
title/hold-frame constants and the full-screen dark overlay drawn in
`render` in `src/systems/BossIntroSystem.ts`) and it _means_ the fight has
begun — firing it from the safe ring would lie about the contract. The intro
keeps firing exactly where it does today: on stepping onto the arena floor
(the entry-detection and entry-window-setup logic inside `update` in
`ArenaSystem.ts`, which sets `bossRoom.newlyLockedBossType` → the check in
`updateGameplay` in `DungeonScene.ts` that reads it and calls
`this.bossIntro.trigger(...)`).

### 2.2 Why the forced route is provably safe

The ball's damage vectors, measured (all cites in Phase 4):

| Vector                   | Reach from arena centre                                      | Nearest forced-route tile | Verdict                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trample/lunge contact    | 11.6 (wall clamp) + 1.26 (`TRAMPLE_RANGE_TILES`) = **12.86** | ring at **15.03**         | safe by 2.17 tiles, structurally — `resolveArenaWall` in `BallOfSwine.ts` clamps the body centre to 11.6 tiles, so it cannot exit even through an open door |
| Stench burst (frenzy)    | slam point ≤ 11.6 + `STENCH_RADIUS_TILES = 4` = **15.6**     | ring at **15.03**         | **currently reachable** — the burst is a bare radial check with no wall test (`resolveStench` in `ArenaSystem.ts`); Phase 4 clamps it to the drum           |
| Shed / phase-2 Tusklings | unbounded once through the door                              | —                         | confined only by the door lock, and a sequencing bug opens the door ~70 frames early on boss death; Phase 4 fixes it                                        |

The fight cannot start from the route: entry detection requires standing on
the arena floor itself, within 13 tiles of centre (the entry-detection block
inside `update` in `ArenaSystem.ts`) — the route never comes closer than
15.03. Frenzy and shedding require the boss
below 30%/60% HP, impossible before someone chooses to fight. After Phase 4,
even a player walking the route _while somebody else fights inside_ takes
nothing.

### 2.3 The deliberate skip

The route walks the player into the antechamber (Mordecai's boss speech is
pinned there via `guardsBossType`, set on the antechamber room by the
`addRoom` closure inside `buildDungeon` in `src/map/DungeonGenerator.ts`),
past the one door into the drum, and onto a ring where a fifteen-foot ball of
pigs charges the wall beside them, squealing. The minimap backs it up: fog
reveal (`REVEAL_RADIUS = 10`, a private field on `MiniMapSystem` in
`src/systems/MiniMapSystem.ts`) paints the drum as they circle it, and the
boss is a red dot inside `MOB_RADAR_TILES = 20` (same file). Skipping means
walking the rest of the ring to the gate; fighting means stepping through the
south door — which fires the intro, starts the 30-second entry window, and
locks (the entry-window setup and lock logic inside `update` in
`ArenaSystem.ts`).
Neither can happen by accident: the mandatory path never touches the drum
floor, and the drum floor is reachable only through that one door.

### 2.4 The source-material nod, and a decision left to Ryan

The book's beat — _the stairwell appears when the boss dies_ — already exists:
killing the ball and its phase-2 Tusklings unlocks a stairwell in the middle
of the drum (`unlockArenaStairwell` in `src/map/GameMap.ts`, called from the
everything-dead unlock block inside `update` in `ArenaSystem.ts`), and
Mordecai already promises it ("If you can beat this boss, you're guaranteed a
stairwell to the next floor", the second `ball_of_swine` page in
`ADVICE_TEXT` in `mordecaiAdvice.ts`). This plan makes the geography match the
fiction: every _other_ stairwell now sits behind the swine's room, so the
swine guards the way down whether you fight it or skirt it.

**Design decision — flagged for overrule.** The literal source reading would
make the defeat-gated centre stairwell the _only_ way down. That forces the
fight: a mandatory level 14–16 borough boss (`BALL_OF_SWINE_MIN_LEVEL` /
`BALL_OF_SWINE_MAX_LEVEL` in `src/levels/level2.ts`) against an on-level
party, walling the run. Per the requirement that the fight
stay optional, this plan keeps the beyond-region stairwells as the no-fight
path. If Ryan prefers the hard-source version, the delta is small — skip
Phases 1–3, keep Phase 4's safety hardening, and delete floor 2's free
stairwells — but it is not what this plan builds.

### Rejected alternatives

- **Seed the beyond region from the antechamber** (this plan's previous
  revision). Guarantees passing the _door_, not seeing the _room_: a player
  can cross the antechamber's south end ~24–28 tiles from a far-rim ball with
  the drum interior off-screen, exactly the "merely passing a door" failure
  the requirement now excludes.
- **Fire the boss intro on reaching the concourse.** The takeover means "the
  fight has started" and halts the world (the `if (this.bossIntro.isActive)`
  early return inside `update` in `DungeonScene.ts`); firing it from safety
  breaks that contract and steals the real entry moment.
- **A windowed / barred see-through wall.** Solves a problem the renderer does
  not have — walls never occlude the top-down view (`RenderPipeline` has no
  occlusion pass). Seeing fails only when the boss is out of viewport, which
  art cannot fix and the menace charge does.
- **Move the antechamber to immediately after the Krakaren.** Front-loads a
  borough boss onto a party fresh off a gauntlet, deletes the exploration
  beat, and fights the scored far siting (the comment block inside
  `reserveArena` in `src/map/DungeonGenerator.ts` describing the "scored far
  position" rationale).
- **Steer stairwell siting near the arena without a topological gate.**
  Probabilistic, so it fails the "impossible" requirement.

## 3. Phase 1 — the north gate and the beyond pocket

In `src/map/arenaGeometry.ts`, `src/map/DungeonGenerator.ts`, and one segment
constant in `src/map/gauntletLayout.ts`.

1. **Gate geometry lives beside the door's.** In `arenaGeometry.ts`, mirror
   the south door: `ARENA_GATE_COLUMN_OFFSETS` (same `[-1, 0]` shape as
   `ARENA_DOOR_COLUMN_OFFSETS`) and an `arenaGateTileAt(centre)` due **north**
   (`y = centre.y − ARENA_RADIUS`), mirroring `arenaDoorTileAt`. The gate cuts
   the wall band and the reserve margin the same way the door columns are
   retyped to concrete (the door-column carve loop inside `carveArena` in
   `DungeonGenerator.ts`), carved during arena rasterisation — a corridor
   planner cannot do it, since `reserveArena` tags the arena's footprint with
   `SEGMENT_ARENA` (the `segments.addRoom(best.reserve, SEGMENT_ARENA)` /
   `segments.addRoom(best.antechamber, SEGMENT_ARENA)` calls inside
   `reserveArena`) and `SegmentMap.canCarveCorridor` refuses to let a
   corridor's tiles, or their clearance ring, touch a tile owned by a foreign
   segment (method `canCarveCorridor` on `SegmentMap` in `gauntletLayout.ts`).
2. **New segment.** `export const SEGMENT_BEYOND = -3;` beside `SEGMENT_FREE`
   / `SEGMENT_ARENA` in `src/map/gauntletLayout.ts` (values `-1` / `-2`
   respectively — `-3` doesn't collide).
3. **Headroom is a siting condition.** `reserveArena`'s scoring in
   `DungeonGenerator.ts` gains an accept condition: at least
   `BEYOND_HEADROOM_TILES` (~22) of in-bounds map north of the reserve rect
   (`arenaReserveRect` in `arenaGeometry.ts`), so the pocket always has rock to
   live in. An arena that would back onto the map edge scores zero instead of
   stranding the pocket.
4. **New named constants:** `BEYOND_ROOM_TARGET` (~6), `BEYOND_MIN_ROOMS`
   (rejection floor, ~3), `BEYOND_MAX_DIST_FROM_GATE` (keeps the pocket
   clustered behind the drum, ~60), `BEYOND_HEADROOM_TILES` (~22).
5. **Carve order.** Build the pocket immediately after the arena-reservation
   block (the `if (hasArena) { ... }` block inside `buildDungeon` in
   `DungeonGenerator.ts`) and **before** `fillWithRegularRooms` saturates the
   map (both of its call sites inside `buildDungeon`) — the pocket needs the
   untouched rock behind the arena (same lesson as siting the arena before the
   free region, per the comment above that same arena-reservation block).
6. **Placement.** A `placeBeyondRoom` mirroring `placeFreeRoom` (in
   `DungeonGenerator.ts`): random rect, `accept` = within
   `BEYOND_MAX_DIST_FROM_GATE` of the gate tile, north of the reserve rect,
   `segments.canPlaceRoom(rect, SEGMENT_BEYOND)`. The first room (the
   **landing**) must sit within straight-corridor reach of the gate columns;
   its connection is the gate carve itself. Subsequent rooms connect to the
   nearest already-connected beyond room via `planCorridorBetween(segments,
SEGMENT_BEYOND, …)` (`src/map/gauntletLayout.ts`). Fewer than
   `BEYOND_MIN_ROOMS` seated → `reject('beyond region')` and the map retries
   (the `reject` closure pattern near the top of `buildDungeon`).
7. **Plug the shortcut leak.** The dead-end rescue and extra-loop passes
   collect _every_ `role === 'regular'` room (the `freeRegularIndices` reduce
   inside `buildDungeon`) and carve `SEGMENT_FREE` shortcuts between pairs
   (`tryFreeShortcut` and the dead-end-rescue/extra-loop passes, also inside
   `buildDungeon`). Beyond rooms keep the `'regular'` role (decorations and
   mob spawns work unchanged), so these passes could legally carve a
   free-region corridor from a beyond room back into the free region —
   corridor endpoints are exempt from the foreign-neighbour test (method
   `canCarveCorridor` on `SegmentMap` in `gauntletLayout.ts`) — re-opening the
   bypass. Track free-region indices explicitly and iterate those, never a
   role scan. Phase 3's invariants are the backstop.
8. **Antechamber junction stays.** The existing free-region exits (the
   antechamber-junction block inside `buildDungeon`, `ANTECHAMBER_EXIT_TARGET`)
   are the ways _in_; keep the `connected === 0` rejection in that same block.

## 4. Phase 2 — site every stairwell beyond the arena

In the progression-branch stairwell-siting logic inside `buildDungeon` in
`src/map/DungeonGenerator.ts` (the `if (progression !== undefined &&
lastGatewayBossRoom !== null)` block, under the `// 7. Stairwells` comment):

1. Candidates come **only from beyond-region rooms**. Keep the
   distance-from-exit sort and the `STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT`
   filter (the `candidates` filter in that block) — the pocket is far from
   the exit by construction, but the rule stays as stated.
2. **Separation inside the pocket.** `STAIRWELL_MIN_SEPARATION = 45`
   (`src/map/progressionValidation.ts`) cannot hold inside a pocket ~60 tiles
   across. Add `BEYOND_STAIRWELL_MIN_SEPARATION` (~20) exported beside it,
   used by both the farthest-point sampler and invariant I4 whenever the
   floor has an arena — one constant, two readers, same file as its sibling.
3. **Shortfall is a rejection, not a shrug.** Today the sampler quietly ships
   fewer stairwells than requested when isolation runs out (the
   `bestIsolation < STAIRWELL_MIN_SEPARATION` break condition in the
   farthest-point-sampling loop), and the harness only prints a NOTE (inside
   `reportFloor` in `scripts/verify-progression.ts`). Under this plan the
   count is part of the guarantee: fewer than `stairwellCount` seated in the
   beyond region → `reject('beyond stairwells')`. The waiver fallback (the
   `if (stairwellTiles.length === 0 && byDistanceFromExit.length > 0)` block)
   may only ever pick a _beyond_ room.
4. **The near-arena filter keeps its job, loses its magic number.** The
   filter drops stairwells within `ARENA_RADIUS + 2` = 17 tiles of centre (the
   `filteredStairwells` filter inside `buildDungeon`, a bare literal appearing
   twice — extract it as `ARENA_STAIRWELL_EXCLUSION_TILES`, per the
   no-magic-numbers rule). Beyond rooms sit past the reserve edge at
   `ARENA_REACH = 18` (`arenaGeometry.ts`), so they clear it — but only by one
   tile, so the relationship gets a comment naming both constants.

## 5. Phase 3 — invariants: from "provably skippable" to "provably seen"

In `src/map/progressionValidation.ts` (pure checks, run by both the generator
retry loop and `npm run verify:progression`):

1. **Replace** the stairwell-survives-blocking check (the `withoutArena`
   flood-fill block inside `validateProgression`, tagged `'I6'`) with its
   inverse, **I6c**: flood from the start with only the antechamber blocked;
   **every stairwell must be unreachable**. Failure names the surviving
   stairwell and its coordinates.
2. **Add I6d — the viewing walk itself.** Flood from the start with the
   concourse ring tiles blocked (the annulus `ARENA_RADIUS < rad ≤
ARENA_CONCOURSE_REACH`, minus antechamber tiles — the same predicate the
   concourse-ring loop and `insideAntechamber` helper use inside `carveArena`
   in `src/map/DungeonGenerator.ts`); every stairwell must be unreachable.
   I6c alone would pass a future corridor that slipped from the antechamber
   straight into the pocket without touching the ring; I6d makes the
   half-circuit — the part of the route with the drum on screen — the thing
   that is machine-checked.
3. **Keep** I6's door check (the `withoutAntechamber` flood-fill block, tagged
   `'I6'`) and I6b's orphaned-concourse check (the `firstUnreachableFloor`
   block, tagged `'I6b'`) unchanged — both inside `validateProgression` in
   `src/map/progressionValidation.ts`.
4. **I4** (the pairwise stairwell-separation loop inside `validateProgression`,
   tagged `'I4'`): pairwise separation uses `BEYOND_STAIRWELL_MIN_SEPARATION`
   when `expectations.hasArena` is true (the `ProgressionExpectations`
   interface already carries `hasArena`, in `progressionValidation.ts`); floor
   1 untouched.
5. I7's unblocked reachability of every stairwell (the `stairwellTiles`
   reachability loop inside `validateProgression`, tagged `'I7'`) stays. I7 +
   I6c + I6d state the design exactly: reachable, but only through the
   antechamber, and only around the drum.

Floor 1 (`hasArena: false`) generates through none of the new code.

## 6. Phase 4 — menace behaviour and route-safety hardening

In `src/creatures/BallOfSwine.ts` and `src/systems/ArenaSystem.ts`. This phase
turns §2.1's "boss on screen" and §2.2's "route never damageable" from mostly
true into invariant.

1. **Menace reach covers the whole ring.** Replace
   `ARENA_AGGRO_EXTEND_TILES = 3` (in `BallOfSwine.ts`, giving 16 tiles of
   reach — only the ring's inner row) with a limit derived from the geometry
   it must cover: `BOS_MENACE_REACH_TILES = ARENA_CONCOURSE_REACH +
ARENA_RESERVE_MARGIN` (= 18), imported from `arenaGeometry.ts` (the file
   `BallOfSwine` already imports for its carom circle — note this is the same
   formula/value as the existing `ARENA_REACH` constant there). Any ring
   walker (tile centres ≤ ~17.03 from arena centre) is now inside the
   `aggroRange` check in `nearestInArena`, so the ball charges them and the
   `requiresEvasion` getter keeps it awake. Note the reach also covers the
   antechamber's first row (16 tiles) — the ball raging at the safe-room door
   is intended drama, made harmless by items 2–4.
2. **Menace charges never spend the ball.** A charge at a target it cannot
   reach must not drain the boss before the real fight: in `resolveArenaWall`
   in `BallOfSwine.ts`, when `currentTarget` lies outside the drum (distance
   from centre > `ARENA_INTERIOR_RADIUS_TILES`), every wall contact resolves
   as a glancing carom (the `MIN_CAROM_DEPARTURE` floor, in the same
   function) — no head-on slam, so no momentum loss, no stagger, no stench
   queue (the `pendingStench` assignment gated on `isFrenzied` in `slamInto`)
   — and `tickShedding` (the function that currently governs shedding; note
   the plan's `tryShed` name doesn't exist in the code) requires its target
   inside the drum. This keeps "it never loses momentum" true at the viewing
   wall, prevents a pre-fight wallow tableau, and closes the
   shoot-through-the-open-door cheese where ring baiting could open wallow
   windows from safety.
3. **The stench burst respects the wall.** Its resolution is a bare radial
   distance check (`resolveStench` in `ArenaSystem.ts`) — a burst at the wall
   clamp (11.6 from centre) with `STENCH_RADIUS_TILES = 4` (in
   `BallOfSwine.ts`) reaches 15.6, past the nearest ring tile at 15.03,
   through two tiles of iron. Add the missing condition: a target is hit only
   if its own distance from arena centre is ≤ `ARENA_INTERIOR_RADIUS_TILES`
   (imported constant, no new literal). With item 2 this is belt-and-braces —
   menace charges no longer slam at all — but it also protects a second
   player walking the route while the first fights inside.
4. **Close the phase-2 door gap.** The `bos.hp === 0` unlock block inside
   `update` in `ArenaSystem.ts` unlocks the door, but the ball's death
   resolution is deferred `BOS_BURST_GAME_FRAMES = 70` frames (the
   `burstTimer` assignment in `BallOfSwine.ts`), so the door opens ~70 frames
   before `arenaPhase2Active` spawns the 8 dazed Tusklings (the
   `bossDefeated` handler in `wireEvents` in `ArenaSystem.ts`) — which can
   then chase the victor out onto the mandatory route, contradicting the
   system's own doc comment (above `resetForCheckpoint` in `ArenaSystem.ts`,
   "the door stays locked for the whole Tuskling fight"). Move the unlock to
   where `arenaPhase2Active` is set, and keep the existing everything-dead
   unlock (the Phase-2 stairwell-unlock block inside `update`) as the real
   release. Shed Tusklings mid-fight remain confined by the locked door as
   today (the `BLOCK_ARENA_DOOR` check inside `isWalkable` in
   `src/map/GameMap.ts`).

Nothing else in the fight changes: entry detection (the entry-detection block
inside `update` in `ArenaSystem.ts`), the entry window and insider push-back
(the entry-window setup/lock logic inside `update`, and
`pushInsiderBackFromDoor`, both in `ArenaSystem.ts`), the intro trigger (the
`newlyLockedBossType` check inside `updateGameplay` in `DungeonScene.ts`),
trample numbers, and the phase table are all untouched.

## 7. Phase 5 — copy and signposting

1. **Mordecai's antechamber speech** (the `ball_of_swine` entry's `pages` array
   in `ADVICE_TEXT` in `src/systems/mordecaiAdvice.ts`): page one currently
   promises the player can "go around... find a different stairwell", which
   becomes false as stated. Rewrite to name the new truth: the fight is yours
   to take or leave, but every way down lies around and behind this drum —
   you will walk her cage either way. Keep the stairwell-reward page (the
   second page in that array) and the wall-slam hint pages untouched.
2. **The comment above `BALL_OF_SWINE_MIN_LEVEL` in `src/levels/level2.ts`** —
   calling the ball "entirely optional" narrows to: the fight is optional; the
   room, the ring, and the view are not.
3. Grep `DeathExplanations` and the boss description for other "optional / go
   around" phrasing and align it.

## 8. Phase 6 — verification across many seeds

1. `npm run verify:progression` — 50 maps per floor (`VERIFY_RUN_COUNT` in
   `scripts/verify-progression.ts`), now enforcing I6c and I6d on every
   floor-2 map. For the sign-off run, bump `VERIFY_RUN_COUNT` locally to 200;
   the committed value stays 50.
2. **Generation-cost budget.** Record mean/max `map attempts` and generation
   ms before and after. The new rejects (`beyond region`, `beyond
stairwells`, the headroom siting condition) must leave mean attempts well
   inside `MAX_MAP_ATTEMPTS = 40`; if they spike, tune `BEYOND_*` constants —
   never the invariants.
3. **Menace geometry check, headless.** The fight's whole design leans on
   driving it headless rather than reasoning about it — the committed-charge
   behavior itself was chosen this way (see the "simulation killed it" note
   above `BOS_BASE_ROLL_SPEED`'s turn-rate comment in
   `src/creatures/BallOfSwine.ts`, and the boss-death checks already driven
   headless in `scripts/verify-difficulty.ts`). Extend the same method here:
   park a dummy crawler on the ring's _outer_ row at several angles; assert
   the ball acquires it, closes to the wall, and that the dummy's HP never
   moves. This is the "provably outside damage reach" claim as a script, not
   an assertion.
4. `npm run playtest -- swine` (the `SWINE` preset in
   `src/dev/playtestPresets.ts`) still boots the party into the antechamber;
   walk the ring both ways, through the gate, into the pocket, to a
   stairwell.
5. Gates: `npm run typecheck`, `npm run lint`, `npm run format` — all clean.

## 9. `[HUMAN]` checks

- [ ] `[HUMAN]` **Saw the boss without taking damage:** play floor 2 start to
      stairs without entering the drum. Confirm (a) the Ball of Swine itself was
      unmistakably on screen — charging, slamming the wall beside you — not just
      its room, and (b) you took zero damage from it or anything it produced for
      the whole route.
- [ ] `[HUMAN]` **The skip felt deliberate:** bypassing the fight should feel
      like walking past a door you chose not to open — Mordecai, the sealed drum,
      the door, the raging ball — not like the level quietly routing you around a
      boss you never clocked.
- [ ] `[HUMAN]` Does the menace charge read as _menace_ — the boss hurling
      itself at the iron beside you — rather than as a bug where the boss is stuck
      on a wall? Does it stay dramatic on the second and third lap?
- [ ] `[HUMAN]` Does forcing the walk _first_ spoil or sharpen the entry
      moment when you do step through the door and the intro fires?
- [ ] `[HUMAN]` Play floor 2 start to stairs: does the hunt for the stairwell
      ending behind the Iron Colosseum land as a beat, or feel like a wall?
- [ ] `[HUMAN]` Collapse timer (the `hasCollapseTimer` property on the `level2`
      `LevelDef` in `src/levels/level2.ts`): the forced detour lengthens the
      route — is there still slack on an ordinary run?
- [ ] `[HUMAN]` Does the rewritten Mordecai copy read naturally?
- [ ] `[HUMAN]` Minimap: do the beyond-region stairwells telegraph "behind the
      arena" rather than looking unreachable?
- [ ] `[HUMAN]` **Ryan — design decision (§2.4):** keep the no-fight stairwells
      behind the arena, or go full source-material and make the defeat-gated
      centre stairwell the only way down (which forces the fight)?
