# Boss direction hints in Mordecai's dialogue

Playtest feedback: only the Krakaren Clone gets a cardinal direction in
Mordecai's speech. Players struggled to find the other bosses and sometimes
walked the wrong way entirely. Every boss Mordecai talks about should say which
way it is — and because every dungeon boss is placed procedurally, every stated
direction must be computed at dialogue time, never hard-coded.

This is a small, mostly-content plan. The machinery already exists; the work is
three dialogue edits, one new objective, and the wiring for it.

## 1. What exists today

### 1.1 The direction machinery (the Krakaren pattern)

`src/systems/mordecaiAdvice.ts` owns all of Mordecai's floor advice:

- Any dialogue page may contain the literal token `{direction}`
  (`DIRECTION_PLACEHOLDER` in `src/systems/mordecaiAdvice.ts`).
- `MordecaiAdvisor`'s private `render()` substitutes it with
  `cardinalDirection(bearingOrigin, target)` at the moment the dialog opens
  (in `src/systems/mordecaiAdvice.ts`), so the answer is always true for the
  seed the player is standing in.
- `cardinalDirection` (in `src/utils.ts`) returns one of eight bearings
  (the `CardinalDirection` type, `'North' | 'North East' | …`, in
  `src/utils.ts`), `-y = north`.
- An objective can also carry an optional `bearing` closing sentence
  (the `bearing` field on `AdviceObjective` in `src/systems/mordecaiAdvice.ts`),
  appended to the last page — the
  "another crawler spotted it {direction} of here" framing used by
  `defend_goblin_mother`, `spider_lab`, and `the_circus`.

Two delivery paths in `src/scenes/DungeonScene.ts`:

- **Pinned gateway speech** — a safe room that guards a boss
  (`guardsBossType`, read via `SafeRoomSystem.safeRoomInfoAt` in
  `src/systems/SafeRoomSystem.ts`) talks about that boss and nothing
  else while it lives (`pinnedGatewayAdvice` in
  `src/scenes/DungeonScene.ts`). The four gateway ids are
  `the_hoarder`, `juicer`, `krakaren_clone`, `ball_of_swine`
  (`GATEWAY_ADVICE_IDS` in `src/systems/mordecaiAdvice.ts`).
- **Floor objective walk** — every other safe room speaks the first incomplete
  entry of `floorObjectives()` (in `src/scenes/DungeonScene.ts`).

In both paths `bearingOrigin` is the centre of the safe room the player is
standing in (the `bearingOrigin` assignment in `floorAdvice`,
`src/scenes/DungeonScene.ts`), so two safe rooms pointing at
the same boss give two different — both correct — answers.

**The Krakaren hint** is simply an inline token in its first pinned page:
"I see a Krakaren Clone just {direction} of here…"
(the `krakaren_clone` entry's first page in `ADVICE_TEXT`,
`src/systems/mordecaiAdvice.ts`). It is gated to floor 2 by being the
gateway speech of floor 2's gauntlet safe room and the first entry of the
floor-2 objective list (the `DUNGEON_FLOOR_TWO` case in `floorObjectives`,
`src/scenes/DungeonScene.ts`), and marked
complete via `bossRoom.defeatedBossTypes`
(the `bossObjective` method, `src/scenes/DungeonScene.ts`).

### 1.2 Boss roster and verified placement

Every dungeon boss's position is procedural. **No fixed cardinal direction is
safe for any of them**; every hint below uses the runtime computation.

| Boss                                                                       | Floor | Placement (evidence)                                                                                                                                                                                                                                                                                                                                                            | Direction hint today                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Hoarder                                                                | 1     | Gauntlet 0 boss room, offset from its gateway safe room along a per-seed heading — `planGauntlet` draws `heading = nextHeading(…)` and places the boss room at `polar(heading, …)` (in `src/map/gauntletLayout.ts`; rooms added via the `addRoom(plan.safeRoom, …)` / `addRoom(plan.bossRoom, …)` calls in `buildDungeon`, `src/map/DungeonGenerator.ts`)                       | **None** (the `the_hoarder` entry in `ADVICE_TEXT`, `src/systems/mordecaiAdvice.ts` — "Up ahead in that hallway")                                                                                                                                                                             |
| Juicer                                                                     | 1     | Gauntlet 1 boss room, same mechanism, heading turned off gauntlet 0's (the `GAUNTLET_FLANK_TURN_MIN_DEG`/`GAUNTLET_FLANK_TURN_MAX_DEG` constants and `nextHeading`'s use of `request.previousHeading`, `src/map/gauntletLayout.ts`)                                                                                                                                             | **None** (the `juicer` entry in `ADVICE_TEXT`, `src/systems/mordecaiAdvice.ts`)                                                                                                                                                                                                               |
| Krakaren Clone                                                             | 2     | Gauntlet 0 boss room on floor 2 (the `bossRooms` field in `level2`, `src/levels/level2.ts`)                                                                                                                                                                                                                                                                                     | **Yes** — inline `{direction}` (the `krakaren_clone` entry in `ADVICE_TEXT`, `src/systems/mordecaiAdvice.ts`)                                                                                                                                                                                 |
| Grotesque Spider (spider lab)                                              | 2     | Free-roam special room, placed wherever the free-region scatter seats it (the `isSpiderLabRoom` placement and `spiderLabRoom` assembly in `buildDungeon`, `src/map/DungeonGenerator.ts`); target `gameMap.spiderLabRoom.centre` (the `spiderLabObjective` method, `src/scenes/DungeonScene.ts`)                                                                                 | **Yes** — `spider_lab` bearing line (the `spider_lab` entry's `bearing` field in `ADVICE_TEXT`, `src/systems/mordecaiAdvice.ts`)                                                                                                                                                              |
| Ball of Swine                                                              | 2     | Arena reserved at a **random angle** and scored distance from the last gauntlet exit (`reserveArena`, in `src/map/DungeonGenerator.ts`); antechamber safe room guards its only door (the `addRoom(arenaReservation.antechamber, …)` call in `buildDungeon`, `src/map/DungeonGenerator.ts`); spawned via `arena:0` (the `extraSpawns` entry in `level2`, `src/levels/level2.ts`) | **None** in the pinned speech (the `ball_of_swine` entry in `ADVICE_TEXT`, `src/systems/mordecaiAdvice.ts`), and **never mentioned at all** from any other floor-2 safe room — `floorObjectives()` omits it (the `DUNGEON_FLOOR_TWO` case in `floorObjectives`, `src/scenes/DungeonScene.ts`) |
| Ringmaster Grimaldi / circus bosses                                        | 3     | Inside the circus tent, itself placed procedurally in the overworld; Mordecai (restaurant) already points at the tent                                                                                                                                                                                                                                                           | **Yes** — `the_circus` bearing (the `the_circus` entry's `bearing` field in `ADVICE_TEXT`, `src/systems/mordecaiAdvice.ts`; snapshot built in `circusAdviceSnapshot`, `src/scenes/BuildingInteriorScene.ts`)                                                                                  |
| Bounty bosses (Mantid, Evil Clown, Dark Knight, Skeleton Lord, Rock Golem) | 3     | Scattered bounty sites, per-issued-bounty                                                                                                                                                                                                                                                                                                                                       | **Out of scope** — BountySystem renders an on-screen guidance arrow plus minimap markers (the `renderArrow` method and `questMarkers` getter, `src/systems/BountySystem.ts`), and Shady's refusal to give directions is written into his character (in `src/systems/shadyDialogs.ts`)         |

Floor-3 note: the overworld generator produces **no** dungeon-style safe rooms
(`safeRooms: []` in `src/map/OverworldGenerator.ts`), so the only floor-3
Mordecai is the restaurant one, and he already carries the circus bearing.
Nothing to do on floor 3.

### 1.3 The two real gaps

1. **The three direction-less gateway speeches.** The Hoarder's and Ball of
   Swine's gateway rooms can have several exits, and the gauntlet heading is
   per-seed, so "up ahead" points nowhere. Worse: after the Hoarder dies, the
   player standing in _her_ gateway room falls through to the floor objective
   walk and hears the **Juicer** pages — a boss a full gauntlet away in a
   random per-seed heading — with no direction at all.
2. **The Ball of Swine is invisible outside its antechamber.** The floor-2
   objective list never mentions the one optional boss that guarantees a
   stairwell, so a player at the Krakaren gateway or the scatter safe room gets
   no pointer toward the arena.

## 2. Phase 1 — directions in the three gateway speeches

All edits in `ADVICE_TEXT` (`src/systems/mordecaiAdvice.ts`). Use the
Krakaren pattern: the `{direction}` token **inline in a page**, not the
`bearing` field — the field's "another crawler spotted it" framing is
documented as absurd for a room adjacent to its boss
(the `bearing` field's doc comment and the `ADVICE_TEXT` doc comment,
`src/systems/mordecaiAdvice.ts`), and that comment stays true.

Because these ids reach `render()` through both the pinned path and the floor
objective walk, one edit fixes both delivery paths at once — including the
dead-Hoarder-gateway case in §1.3.

- **`the_hoarder`** — first page becomes:

  > "Through the hallway {direction} of this room is a boss. The dungeon
  > contains boss fights that will commence once you are in the boss's area."

- **`juicer`** — first page becomes:

  > "I see we have another boss that there's no way you can avoid — his den
  > lies {direction} of here. Fortunately, this one is also just a neighborhood
  > boss, but this one looks a little tougher."

- **`ball_of_swine`** — first page becomes:

  > "Up ahead, {direction} of this room, is a borough boss. That means it's
  > tougher than the other fights you've had so far. However, it looks like you
  > also have the option to ignore it and go around to see if you can find a
  > different stairwell or find other challenges."

Wording rule (already stated in the `ADVICE_TEXT` doc comment,
`src/systems/mordecaiAdvice.ts`):
phrase so all eight bearings read correctly — "{direction} of here", never
"to the {direction} side".

No code changes in this phase; the targets already flow —
`bossObjective()` uses `gameMap.bossRooms[index].centre`
(the `bossObjective` method, `src/scenes/DungeonScene.ts`, index-aligned with
`levelDef.bossRooms` per its JSDoc) and `ballOfSwineObjective()` uses
`gameMap.arenaExteriors[0].centre` (the `ballOfSwineObjective` method,
`src/scenes/DungeonScene.ts`).
A `null` target drops nothing but the token page's substitution — `render()`
returns the pages verbatim (the `target === null` early return in `render`,
`src/systems/mordecaiAdvice.ts`) — so the
token must only appear on ids whose target is always present when spoken;
all three qualify (a pinned gateway room exists only because its boss room
does, the `addRoom(plan.safeRoom, …)`/`addRoom(plan.bossRoom, …)` and
`addRoom(arenaReservation.antechamber, …)` calls in `buildDungeon`,
`src/map/DungeonGenerator.ts`).

## 3. Phase 2 — the arena mentioned from the rest of floor 2

Add a _distant_ Ball of Swine objective so every floor-2 safe room can point at
the arena once the forced content is done. The pinned antechamber text stays
as-is ("Up ahead…"); this is a different speech for far away, so it needs its
own id — reusing `ball_of_swine` would speak "Up ahead" from the wrong side of
the map.

1. **`src/systems/mordecaiAdvice.ts`** — extend the `AdviceObjectiveId` union
   (in `src/systems/mordecaiAdvice.ts`) with `'ball_of_swine_distant'` and add its `ADVICE_TEXT` entry
   (the `as const satisfies Record<AdviceObjectiveId, AdviceText>` clause
   closing `ADVICE_TEXT` makes the compiler demand it — no casts needed). Draft text, Mordecai's
   voice:

   > Page 1: "Somewhere out in these halls stands a great iron arena, and a
   > borough boss rolls inside it — a wheel of fused swine. Borough bosses are
   > tougher than anything else on their floor, but beat one and you are
   > guaranteed a stairwell down."
   >
   > Page 2: "It is entirely optional, mind. If you would rather keep your
   > bones arranged the way they are, no one here will judge you."
   >
   > `bearing`: "Another crawler marked the arena {direction} of here."

   `GATEWAY_ADVICE_IDS` (in `src/systems/mordecaiAdvice.ts`) is untouched — the new id is never pinned.

2. **`src/scenes/DungeonScene.ts`** — append the new objective to the
   `DUNGEON_FLOOR_TWO` case in `floorObjectives`:

   ```
   case DUNGEON_FLOOR_TWO:
     return [
       this.bossObjective('krakaren_clone'),
       this.spiderLabObjective(),
       this.defendQuestObjective(),
       this.ballOfSwineDistantObjective(),
     ];
   ```

   Last on purpose: the walk speaks the _first_ incomplete entry, and the
   arena is a level 14–16 borough boss (`BALL_OF_SWINE_MIN_LEVEL`/
   `BALL_OF_SWINE_MAX_LEVEL` in `src/levels/level2.ts`) — it
   should be the pointer that remains once the level-appropriate content is
   cleared, not the thing Mordecai steers a fresh floor-2 party into. The
   antechamber's pinned speech still covers anyone who finds the arena early.

3. **`ballOfSwineDistantObjective()`** — a sibling of `ballOfSwineObjective()`
   (in `src/scenes/DungeonScene.ts`) with the new id and the same state: complete =
   `this.arena.phase2Active`, target =
   `this.gameMap.arenaExteriors[0]?.centre ?? null`. Either share one private
   helper taking the id (typed `'ball_of_swine' | 'ball_of_swine_distant'` —
   no `as`, no widening to `string`) or duplicate the three lines; keep
   whichever reads cleaner.

## 4. Validation gates

- `npm run typecheck` — exit 0 (the `satisfies` clause forces the new
  `ADVICE_TEXT` entry).
- `npm run lint` — exit 0.
- `npm run format`.

## 5. Notes for Ryan's playtest

All directions are seed-dependent, so each check is: open the dialog, then
confirm the stated bearing against the minimap.

- Floor 1, Hoarder gateway safe room: Mordecai names a direction
  and it matches where the Hoarder's room actually is on this seed.
- Floor 1, Hoarder gateway safe room **after** killing the
  Hoarder: the Juicer speech now plays with a direction, and it points
  down the second gauntlet, not back the way you came.
- Floor 1, Juicer gateway safe room: Juicer direction correct
  from _this_ room too (different origin, same target).
- Floor 2, Krakaren gateway: existing hint still correct
  (regression).
- Floor 2, any non-antechamber safe room after clearing Krakaren,
  spider lab and the goblin-mother quest: Mordecai now offers the arena
  speech with a correct bearing.
- Floor 2, arena antechamber: pinned speech names the direction
  of the arena door.
- Floor 3, restaurant Mordecai: circus bearing unchanged
  (regression).
- Voice check: all three edited gateway pages and the two new
  arena pages read naturally in the dialog box on a phone-width canvas
  (pages are author-split, see the `pages` field's doc comment on
  `AdviceObjective` in `src/systems/mordecaiAdvice.ts` — no
  page should overflow six lines).

## 6. Explicitly out of scope

- **Bounty bosses** — already guided by BountySystem's arrow and minimap
  markers (the `renderArrow` method and `questMarkers` getter, in
  `src/systems/BountySystem.ts`); Shady's "I don't hold hands
  and I don't give directions" (in `src/systems/shadyDialogs.ts`) is a
  character choice this plan must not contradict.
- **Circus interior bosses** (Grimaldi, Terror) — the `the_circus` bearing
  already finds the tent; inside a 22×16 interior no cardinal hint is needed.
- **Grotesque Spider** — `spider_lab` already carries a bearing
  (the `spider_lab` entry's `bearing` field in `ADVICE_TEXT`,
  `src/systems/mordecaiAdvice.ts`).
- **Tutorial** — deliberately excluded from floor advice
  (the `TUTORIAL_LEVEL_ID` check in `floorObjectives`,
  `src/scenes/DungeonScene.ts`).
