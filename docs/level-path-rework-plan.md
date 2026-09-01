# Level Path Rework: Floor-2 Spine + Defense-Quest Choke

## Goals

1. **Floor 2:** replace the sprawling free region between the Krakaren Clone's boss
   room and the arena antechamber (the safe room just before the Ball of Swine)
   with a single forced path — a long, winding chain of rooms. The route may
   split into **at most two parallel lanes**, and any split must reconverge
   within **two rooms**. The journey should still feel long.
2. **Floor 2:** the spider lab hangs off this forced path as an optional side
   room, with the scientist standing at its entrance so the player sees the
   option from the main path.
3. **Both floors:** the defense quest ("Defend the Goblin Mother",
   `DefendQuestSystem`) becomes a choke the player must go through to proceed —
   placed randomly **between the Hoarder and the Juicer** on floor 1, and
   **anywhere on the forced path before the arena antechamber** on floor 2.

## Current state (what the generator does today)

- **Floor 2** (`src/levels/level2.ts`, `mapSize: 260`, compact): start room →
  Krakaren gauntlet (2–3 converging branches, `planGauntlet` in
  `src/map/gauntletLayout.ts`) → Krakaren boss room → **free region**: a tree of
  ~dozens of rooms rooted at the boss room (`connectFreeRoom` in
  `src/map/DungeonGenerator.ts`), plus `EXTRA_LOOP_RATIO = 0.22` loop edges,
  dead-end rescue shortcuts, and up to `ANTECHAMBER_EXIT_TARGET = 3` extra
  antechamber exits. That is why there are many routes and the Ball of Swine is
  rarely found: the antechamber is just one node in a loopy sprawl.
- **Spider lab**: a free-region room placed by `placeFreeRoom(SPIDER_LAB_W,
SPIDER_LAB_H, 'spider_lab', …)`, 30–90 tiles from the Krakaren room. The
  scientist is a tile (`SpiderLabRoomData.scientistTile`) placed near whichever
  wall `detectRoomEntrance` finds, owned by `SpiderQuestSystem`.
- **Defense quest room**: carved unconditionally on both dungeon floors as a
  14×12 free-region leaf (`placeFreeRoom(QUEST_ROOM_W, QUEST_ROOM_H, 'quest',
…)`), ≤ `QUEST_ROOM_MAX_DIST_FROM_EXIT` from the last boss. On floor 1 that
  puts it **after the Juicer**, and it is a dead-end side room: fully skippable,
  blocks nothing, single south entrance, four `FLOOR_GRATE` tiles, NPC at
  centre.
- **Forced-path machinery that already exists** (reuse, don't reinvent):
  - `SegmentMap` segment ownership in `gauntletLayout.ts`
    (`canPlaceRoom` / `canCarveCorridor` / `claimCorridor`,
    `FOREIGN_SEGMENT_CLEARANCE`) — sealing a segment is what makes a room
    unavoidable.
  - Cut-vertex flood-fill proofs in `validateProgression`
    (`src/map/progressionValidation.ts`), retried by `generateDungeon` up to
    `MAX_MAP_ATTEMPTS`; offline harness `scripts/verify-progression.ts`.
  - Runtime door locks: `BLOCK_ARENA_DOOR`-style block flags on `GameMap`,
    `BossRoomSystem.state.locked`, `SpiderQuestSystem.applyRoomLock`.

## Design

### A. Floor-2 spine (Krakaren boss room → antechamber)

Add an optional `spine` config to `ProgressionDef` (in `src/levels/types.ts`),
set only by `level2`:

```ts
spine?: {
  rooms: { min: number; max: number };   // level2: 10–14 walked rooms
  splits: { min: number; max: number };  // level2: 1–2 split segments
}
```

When `spine` is present, `buildDungeon` **replaces** the free-region fill for
that floor with:

1. **Reserve the arena first** (as today, `reserveArena` / `planArenaAt`), so
   both endpoints — Krakaren boss room and antechamber — are fixed before the
   spine is planned.
2. **Plan a winding chain** from the Krakaren boss room to the antechamber:
   seat `rooms` chain rooms along a serpentine waypoint path (S-curve with 2–3
   control points, à la `branchWaypoints` — but with **both endpoints fixed**,
   unlike `planBranch` which grows outward). The straight-line arena distance
   on a compact map is only ~30–100 tiles (`ARENA_MIN_DIST_FROM_GAUNTLET_EXIT`
   - `ARENA_DIST_VARIANCE`), which at `MIN_ROOM_PITCH = 16` holds only ~2–6
     rooms — **the length comes from winding, not from distance**. Walked room
     count is the contract, not straight-line separation (the leash-radius
     lesson: measure the walk, not the crow-fly).
3. **Claim everything to a new segment** `SEGMENT_SPINE` in `SegmentMap`, so no
   later corridor, pocket, or rescue shortcut can touch it and create a bypass.
4. **Splits:** pick `splits` non-adjacent chain positions; at each, seat an
   alternate lane of **1–2 rooms** between a fork room and a join room on the
   chain. New constant `SPLIT_LANE_MAX_ROOMS = 2`. The fork and join rooms stay
   cut vertices; only the lane rooms are bypassable, and only pairwise — this
   is exactly "at most two paths, never more than two rooms".
5. **Insert the quest room** as one of the chain rooms at a random index
   (never the first or last chain room, never a fork/join/lane room). See §C.
6. **Attach the spider lab** as a dead-end side room off a random chain room in
   the first two-thirds of the spine, via one short corridor, claimed so
   nothing else can reach it. `SPIDER_LAB_MIN_DIST`/`MAX_DIST` become
   irrelevant on spine floors (keep them for any future free-region floor).
7. **Side pockets keep exploration alive without adding routes:** treasure
   rooms and the one scatter safe room become single-corridor dead ends
   hanging off chain rooms (a dead end is not a path to the antechamber).
   Place the scatter safe room roughly mid-spine — a long forced gauntlet of
   region-1 spawns needs a mid-journey respawn anchor
   (`docs/difficulty-fairness-rules.md` applies).
8. **Disable on spine floors:** free seed rooms, `MIN_FREE_REGULAR_ROOMS`
   fill, `EXTRA_LOOP_RATIO` loop edges, dead-end rescue shortcuts
   (`tryFreeShortcut`), and antechamber extra exits (`ANTECHAMBER_EXIT_TARGET`
   → 0). Every one of these is a bypass generator. Gate on the presence of
   `spine`, never on the level number.
9. **Unchanged:** the concourse/antechamber sealing
   (`sealConcourseAcrossDoorRow`, `linkConcourseToAntechamber`), the beyond
   pocket, stairwells-behind-the-arena, and all existing I6 invariants.

Spawn regions: spine rooms take over the old free region's identity —
`progressionRegionOf` must report them as region 1 so `regionSpawnBonus` /
`regionLevelBonus` and mob levels are unchanged.

Retry budget: seating a fixed-endpoint serpentine chain in a compact map that
also holds an arena reservation will fail more often than free-room scatter.
Give the spine its own attempt budget (`MAX_SPINE_ATTEMPTS`, mirroring
`MAX_BRANCH_ATTEMPTS`) with `SegmentMap.snapshot`/`rollback`, and let a spine
failure re-seat the arena rather than burning a whole map attempt.

### B. Scientist at the spider-lab entrance

- Keep the lab's interior layout machinery, but compute
  `SpiderLabRoomData.scientistTile` from the (now known, single) entrance: 1–2
  tiles inside the doorway, facing it, so the scientist is visible from the
  spine corridor as the player walks past. The four `entranceWall` cases in
  `buildDungeon` already branch on `detectRoomEntrance`; move the scientist
  seat from "near the entrance wall" to "adjacent to the entrance doorway".
- `SpiderQuestSystem` needs no phase changes — it already seeds
  `scientistX/Y` from `scientistTile` and interaction is range-based
  (`SCIENTIST_INTERACT_RANGE_TILES`). Verify the computer, egg, and
  life-machine tiles still satisfy their far-from-entrance placement for all
  four entrance walls after the move.

### C. Defense quest as a mandatory choke (both floors)

**Room shape.** `QuestRoomData` gains an `exitTile` alongside `entranceTile`:
the room becomes a pass-through with two doorways on different walls, both
carved by the path corridors. Grate placement can no longer assume a south
entrance and fixed east/west grate columns — derive grate walls from the two
actual doorways (reuse the `detectRoomEntrance` approach) so no grate sits in
a doorway and Bugaboo pathing to the NPC stays clear. The
`ENTRANCE_SPAWN_CHANCE` spawn in `DefendQuestSystem.spawnWave` should pick
either doorway.

**The choke.** The exit doorway is blocked at generation time by a barricade
(a `GameMap` permanent-block flag in the style of `BLOCK_ARENA_DOOR`, e.g.
`BLOCK_QUEST_EXIT`, with door art — an opened door needs open art, so author
both states). `DefendQuestSystem` unblocks it when the defense encounter
**resolves either way**:

- `triggerDefenseComplete` → open.
- `triggerQuestFailed` (the goblin mother dies) → open.

The player must _play_ the encounter to proceed, but a failure never
soft-locks the floor. Declining the NPC's dialog remains allowed — the player
can retreat the way they came and return — but the only way forward is
through the wave. Add the door state to `DefendQuestCheckpoint` /
`WorldCheckpoint` so a checkpoint restore doesn't resurrect a closed door
after the quest resolved (a banked resolution must survive the rewind).

Trap-corridor caveat: the room now has two doorways, so the player can enter
from **either side** (e.g. walking backward from deeper in the floor after a
respawn). The system must behave sanely when approached from the exit side —
the barricade blocks the exit doorway itself, not "the far half of the room",
and interactions must work regardless of approach direction.

**Floor 1 placement — randomly between the Hoarder and the Juicer.** The only
points every player provably crosses between the two bosses are the sealed
stem before gauntlet 1's branch fan and the sealed corridor after its gateway
safe room (branches are parallel, so a branch room can never be a forced
choke). Per map, randomly pick one of two slots, both seated by `planGauntlet`
via a new optional choke-room request:

- **Slot A — post-Hoarder stem:** Hoarder boss room → corridor → quest room →
  gauntlet-1 branches fan out _from the quest room_ instead of from the boss
  room (the quest room becomes the gauntlet's entry hub).
- **Slot B — pre-Juicer approach:** gateway safe room → corridor → quest room
  → corridor → Juicer boss room, all inside `gatewaySegment(1)`; widen
  `BOSS_ROOM_OFFSET_MIN/MAX` for a gauntlet carrying a choke so the room fits.

Both slots live in already-sealed segments, so the existing ownership rules
make them bypass-proof for free.

**Floor 2 placement** — a random spine chain-room index (§A.5), i.e. anywhere
on the forced path before the antechamber.

**Remove** the free-region `placeFreeRoom(QUEST_ROOM_W, …, 'quest', …)`
placement on progression floors; keep it for classic free-roam floors, where
the quest stays a side room.

**Knock-on effects to check:**

- `validateProgression` I3a/I3b currently lists quest rooms as _later
  landmarks_ behind **every** gateway. On floor 1 the quest room now sits
  between gauntlets — behind gateway 0 but ahead of gateway 1. The invariant
  must move the quest room into per-gauntlet expectations instead of the
  floor-wide later-landmark list.
- Bugaboo wave difficulty was tuned for the post-Juicer free region (region 2
  on floor 1). Mid-floor the quest sits in region 1 — re-check wave HP/damage
  against a region-1 player loadout rather than assuming it still fits.
- `defendQuestObjective()` in `DungeonScene` (Mordecai's advice ordering) and
  the quest-tracker copy assume the quest is late-floor optional content;
  reword for "clear the way forward".
- `tutorialSeen` is module-level (once per run) — with the quest now
  mandatory on both floors, confirm the floor-2 encounter still explains
  enough for a player who skimmed the floor-1 tutorial.

### D. New validation invariants

Extend `validateProgression` (and expectations passed from
`dungeonOptionsForLevel`) — every gate must first prove its subject exists, so
a floor that failed to build a spine or choke fails **red, not vacuously
green**:

- **S1 (spine forced):** every non-lane spine room (quest room included) is a
  cut vertex — flood fill from the start with that room removed must not
  reach the antechamber.
- **S2 (two lanes max, two rooms max):** between each consecutive pair of
  spine cut vertices, the room-adjacency graph of the carved map contains at
  most 2 vertex-disjoint paths, and any alternate lane holds ≤
  `SPLIT_LANE_MAX_ROOMS` rooms. Measure the **built map**, not the plan — the
  plan can be wrong about what got carved.
- **S3 (lab is a dead end):** the spider lab has exactly one doorway, and
  removing its entrance corridor disconnects it.
- **S4 (choke on floor 1):** the quest room is a cut vertex between the
  Hoarder boss room and the Juicer gateway safe room (slot A) or between the
  gateway safe room and the Juicer boss room (slot B).
- **S5 (exit barricade exists):** the quest room's `exitTile` is blocked at
  generation time and is the room's only onward doorway toward the
  later-landmark side.

## Implementation phases

Each phase ends green: `npm run typecheck`, `npm run lint`, `npm run format`,
plus the verification listed.

1. **Quest room pass-through + choke door** (generator `QuestRoomData` +
   `DefendQuestSystem` + checkpointing + door art). Verify: S5 in a unit
   harness; manual run on floor 1 with the room still in its old free-region
   spot (door mechanics first, placement second).
2. **Floor-1 choke placement** (`planGauntlet` choke-room request, slots A/B,
   I3a/I3b rework, S4). Verify: `scripts/verify-progression.ts` across many
   seeds; then a **negative test** — disable the choke request and watch S4
   go red before re-enabling it.
3. **Floor-2 spine** (`spine` config, `SEGMENT_SPINE`, serpentine planner,
   splits, disabled loop/rescue/extra-exit machinery, side pockets, S1–S2).
   Verify: verify-progression seeds sweep; `npx tsx
scripts/render-dungeon.ts --level=2 --scale=2` to eyeball the winding at
   map scale; negative test — re-enable one `tryFreeShortcut` loop edge
   across the spine and watch S1 fail.
4. **Spider lab on the spine + scientist at the entrance** (S3, scientist
   seat, all four entrance walls rendered and checked). Verify: render pass
   per entrance wall; walk the spine in-game past the lab doorway and confirm
   the scientist is visible from the corridor.
5. **Quest room onto the spine** (floor-2 random index placement, region
   bonus wiring). Verify: full seeds sweep with every S-invariant armed; one
   full manual playthrough of floor 2 start → Ball of Swine.

## Open questions (defaults chosen; flag if wrong)

1. **"Go through it to proceed"** is implemented as _must play the encounter_
   (door opens on success **or** failure). Alternative: door opens on mere
   room entry (quest stays optional but visible). The plan assumes the
   former.
2. Floor-2 quest placement is restricted to the post-Krakaren spine. If
   "anywhere before the ball of swine safe room" should include the
   pre-Krakaren stretch, add a slot between the Krakaren gateway safe room
   and its boss room to the random pool.
3. Spine length 10–14 walked rooms (plus lanes/pockets) is the "long
   journey" guess — tune after the first render pass.
