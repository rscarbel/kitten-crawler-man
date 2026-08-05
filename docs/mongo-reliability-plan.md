# Mongo reliability & legibility

Fix the pet raptor's disappearing act, and make his healing, leveling and
combat behavior legible from the HUD and the world — no tutorial dump.

## 1. What is wrong today

Four playtest complaints, each traced to code.

### 1.1 He vanishes after being summoned

There is no single teleport bug — Mongo's position is only ever written by his
own movement, the separation passes and the player-collision push (all of which
reindex the grid correctly via the `mobGrid.move` calls in
`MobUpdateLoop.update` and in `runSeparationPass`). The vanish is a **freeze**, reachable three ways, and once frozen
there is no recovery path the player can see:

- **The AI activation gate turns any separation permanent.**
  `MobUpdateLoop.update` only ticks mobs within `AI_RADIUS_TILES = 22` of the
  human or the cat (the `AI_RADIUS_TILES` constant and the `queryCircle` calls
  in `MobUpdateLoop.update`); the only
  exemptions are `requiresEvasion` and `forceAggro`
  (the exemption loop in `MobUpdateLoop.update`), and Mongo has neither. A Mongo more
  than 22 tiles from both players stops executing `updateAI` entirely: he does
  not follow, does not recall, does not even decrement his despawn fade
  (the `if (this.recallArrived)` branch of `updateAI` in `src/creatures/Mongo.ts`). He stands wherever he froze, off-screen,
  forever.

- **A juvenile cannot keep up, so the gap opens on its own.** Levels 1-4 move
  at 2.0-2.1 px/frame (the level-1 and level-4 `speed` fields in
  `MONGO_LEVELS`, `src/abilities/mongo.ts`) against
  `PLAYER_SPEED = 2.5` (the `PLAYER_SPEED` constant in `src/core/constants.ts`). A player who simply keeps
  walking opens the gap by ~0.9 tiles/second; from the 6-tile leash-resume
  band to the 22-tile freeze radius is under twenty seconds of ordinary
  forward progress. The leash logic cannot save him — `breakLeash`
  (the `breakLeash` method in `src/creatures/Mongo.ts`) only drops his target and turns him home
  at the same too-slow speed, and past 22 tiles the leash logic itself stops
  running.

- **The follow and recall paths have no unreachable-goal escape.**
  `followTargetAStar` falls back to a straight-line `followTargetCollide` walk
  when the search fails (the fallback branch of `followTargetAStar` in
  `src/creatures/Mob.ts`), i.e. grinding into
  the wall between him and the goal, with a failure backoff that suppresses
  re-searching (the `astarLastSearchFailed`/`astarTimer` backoff assignment in
  `followTargetAStar`, `src/creatures/Mob.ts`). The `engage` path guards this
  with `astarSearchFailed` plus a pixels-covered stall counter
  (the stall-counter check in `engage`, `src/creatures/Mongo.ts`), but `standBy`'s follow-the-cat walk
  (the `followTargetAStar` call in `standBy`, `src/creatures/Mongo.ts`) and `runHome`'s recall run
  (the `runHome` method, `src/creatures/Mongo.ts`) have **neither**. A cat on the far side
  of a closed boss door, a diagonal gap A* cannot route, or a one-tile pocket
  leaves him pressed against geometry indefinitely.

- **While he is stuck, the button is dead.** With `mongo !== null` the button
  reads Recall, but `toggleRecall` no-ops while `recalling || collapsing`
  (the early-return guard in `toggleRecall`, `src/systems/MongoSystem.ts`) and `canPress` goes false
  (the `canPress` getter, `src/systems/MongoSystem.ts`). The only way out is for the cat to
  wander within `RECALL_ARRIVE_TILES = 1.2` tiles of wherever he froze
  (the `RECALL_ARRIVE_TILES` constant and its use in `runHome`, `src/creatures/Mongo.ts`) — _and_ within 22 tiles first, so his
  AI resumes and can notice the arrival. That is exactly the reported
  behavior: he is gone, no timer, until the player happens to run past the
  spot and the despawn completes, at which point Summon works again.

What it is **not**: the summon itself validates its tile (ring search with
sight and stairwell tests, the `findSpawnTile` method in
`src/systems/MongoSystem.ts`, over
`findNearbyWalkableTile`'s two-pass room-to-move search,
the `hasRoomToMove` function in `src/map/findWalkableTile.ts`); floor transitions, building entry,
death respawn and checkpoint restore all `dismiss()` him first
(the `levelCompleteScreen.activate` callback and the `BuildingSystem` entry
callback in the constructor, and `restartAtFloorEntry` and
`restoreFromCheckpoint` — the two branches `respawnAfterDeath` dispatches to —
all in `src/scenes/DungeonScene.ts`); and he is
excluded from `resetToSpawn` rewinds because `resetsFullyOnCheckpoint`
follows `isHostile` (the `resetsFullyOnCheckpoint` getter, `src/creatures/Mob.ts`).

### 1.2 Healing is opaque

The mechanics are: persistent HP, regen of 1% every 78 frames **only while
recalled** (the `MONGO_REGEN_INTERVAL_FRAMES`/`MONGO_REGEN_PERCENT` constants,
`src/core/MongoPetState.ts`, ticked at
the `tickRegen` method, `src/systems/MongoSystem.ts`), summonable again at 1 HP unless
knocked out, in which case he rests to full (the `MONGO_MIN_SUMMON_HP`
constant and the `restingUntilFull` field, `src/core/MongoPetState.ts`). The button shows an HP bar and a countdown
(the HP bar and cooldown overlay in `renderSummonButton`, `src/systems/MongoSystem.ts`) — but nothing anywhere states the two
rules a player must infer: _he only heals while recalled_ and _a knockout
means resting to full_. "Resting" (the button label in `renderSummonButton`, `src/systems/MongoSystem.ts`) is the
single word of explanation in the game.

### 1.3 Leveling is invisible because it is glacial

Level 2 costs 100 XP with 1.45× growth per level
(the `baseXpToLevel2`/`xpGrowthRate` fields of `MONGO_DEF`, `src/abilities/mongo.ts`). The income:

- 2 XP per summon (`usageXp`, the `abilityManager.addUsageXp('mongo')` call in
  `toggleMongoSummon`, `src/scenes/DungeonScene.ts`);
- 15 XP when **Mongo lands the killing blow**
  (the `abilityManager.addKillXp('mongo')` call in `resolveKills`,
  `src/systems/CombatSystem.ts`) — rare, since a juvenile bites for 2
  against mobs the cat hits for many times that
  (the level-1 `biteDamage` field in `MONGO_LEVELS`, `src/abilities/mongo.ts`);
- 1 XP per 5 damage dealt (`MONGO_DAMAGE_PER_XP`,
  in `src/abilities/mongo.ts`, drained at
  the `payOutDamageXp` method, `src/systems/MongoSystem.ts`).

A level-1 Mongo biting for 2 every 46 frames (the `BITE_COOLDOWN_FRAMES` constant, `src/creatures/Mongo.ts`)
earns ~0.3 XP/second of _uninterrupted_ combat: 100 XP is five-plus minutes
of continuous biting from an animal with 20 HP who dies in a few hits and
then owes minutes of recovery. The level-up dialog exists and fires
(the `abilityManager.onLevelUp` callback in the constructor, `src/scenes/DungeonScene.ts`) — players never saw it because the
first level-up realistically never happened.

### 1.4 Engagement is wrong-target, then sudden death

- He picks the **nearest** visible `isPetAttackable` mob within 9 tiles _of
  the cat_ (the `ENGAGE_RADIUS_TILES` constant and the `pickTarget` method,
  `src/creatures/Mongo.ts`). Nothing prefers the mob
  that is biting the cat, or the one the player is attacking — so he runs at
  the wrong enemy, and `canNotice`'s LOS gate
  (the `canNotice` method, `src/creatures/Mob.ts`) makes him ignore a fight happening
  through a doorway.
- He fights in his own name so every victim retaliates against him
  (the `retaliateMob` assignment in `resolvePendingBlow`, `src/creatures/Mongo.ts`), and he is on every hostile mob's target
  list while out (the `mongo` push into `extraTargets` inside
  `buildSystemContext`, `src/scenes/DungeonScene.ts`). A melee-only
  animal with 20 HP at level 1, unlocked from the Krakaren chest
  (the Krakaren boss-chest branch of the `treasureChests.setOnOpen` callback
  in the constructor, `src/scenes/DungeonScene.ts`) onto floors where single hits run
  to double digits, is spent in seconds — and then charges minutes of regen.

## 2. Phase 1 — the vanish fix

All position writes below happen in `MongoSystem.update`, which runs _after_
`mobLoop.update` (`this.mongoSystem.update(ctx)` running after
`this.mobLoop.update(ctx)` in `updateGameplay`, `src/scenes/DungeonScene.ts`), so each write
must be followed immediately by `mobGrid.move(mongo, preX, preY)` with the
pre-write coordinates — the SpellSystem shell-push pattern. `SystemContext`
already carries `mobGrid` and `gameMap`.

### 2.1 Never freeze the pet

Add to `Mob` an opt-in getter:

```ts
/** When true, this mob's AI ticks regardless of distance to any player. */
get exemptFromAiActivationRadius(): boolean { return false; }
```

Override it `true` in `Mongo`, and extend the exemption condition in
`MobUpdateLoop.update`'s activation loop to
`mob.requiresEvasion || mob.forceAggro || mob.exemptFromAiActivationRadius`.
Cost is one extra active mob, only while summoned. (Per the
`requiresEvasion` gotcha this runs his AI at any distance — which for a
summon that exists only near the party is the point, not a hazard.)

### 2.2 Stall detection on the follow and recall paths

Mirror the `engage` watchdog (the stall-counter check in `engage`, `src/creatures/Mongo.ts`) in `standBy`
and `runHome`: measure pixels covered per frame (never `isMoving` — see the
`isMoving is not motion` rule), and count consecutive no-progress frames
while the goal is farther than the stop distance. New named constants in
`Mongo.ts`:

```ts
/** Frames of covering no ground toward the cat before he calls for a rescue. */
const HOME_STALL_LIMIT_FRAMES = 90;
/** Cat-distance beyond which he asks for a rescue regardless of progress. */
const RESCUE_DISTANCE_TILES = 18;
```

`RESCUE_DISTANCE_TILES` sits deliberately inside `AI_RADIUS_TILES = 22` so
the rescue fires while both old and new activation rules still tick him.
When either trips — `astarSearchFailed` while homing, the stall counter
exceeding `HOME_STALL_LIMIT_FRAMES`, or cat-distance exceeding
`RESCUE_DISTANCE_TILES` — set a public latch on the creature:

```ts
/** Set when he cannot reach the cat by walking; MongoSystem teleports him. */
needsRescue = false;
```

The creature never moves itself by fiat; deciding _that_ he is stuck is his
job, executing the rescue is the system's.

### 2.3 The rescue: teleport to the owner

In `MongoSystem.update`, when `this.mongo.needsRescue`:

1. Find a landing tile with the existing `findSpawnTile(cat, gameMap)`
   (the `findSpawnTile` method, `src/systems/MongoSystem.ts`) — same contract as a summon:
   walkable, room to move, in the cat's sight, not a stairwell.
2. Capture `preX/preY`, write `mongo.x/mongo.y` to the tile, then
   `ctx.mobGrid.move(mongo, preX, preY)` — the _teleporting a mob needs
   mobGrid.move_ gotcha, verbatim.
3. `mongo.clearAStarPath()` (via a small public `onRescued()` method that
   also clears `needsRescue`, the stall counters, the held target and
   `navigationGoal` — path state is private to the creature).
4. Release stale aggro with the existing `releaseTargeting`
   (the `releaseTargeting` method, `src/systems/MongoSystem.ts`) so mobs do not beeline to the tile
   he vanished from.
5. Speak once — reuse the speech bubble (`speak('Mongo!')`) so the rescue is
   a visible, in-world event rather than a silent snap.

If `findSpawnTile` returns null (cat herself is somewhere unwalkable — a
closing arena door), fall through to `finishDespawn` in place: his HP is
preserved by the normal despawn write (the `finishDespawn` method, `src/systems/MongoSystem.ts`)
and the button returns to Summon. Either branch ends the unrecoverable
state; neither loses pet HP.

A recalling Mongo who gets rescued lands beside the cat, so his next
`runHome` tick sees `distance < RECALL_ARRIVE_TILES` and finishes the
despawn normally — no special case.

### 2.4 The button is never dead

`toggleRecall` (the `toggleRecall` method, `src/systems/MongoSystem.ts`) currently no-ops while
`recalling`. Change: a press while `recalling` sets `needsRescue` on the
creature — the player mashing the button _is_ the "he is lost, bring him to
me" input, and it now works. `canPress`
(the `canPress` getter, `src/systems/MongoSystem.ts`) admits the recalling state; keep
`collapsing` excluded (the collapse is sub-second and the animation must
finish).

### 2.5 See him even when you cannot see him

Two passive affordances so a stuck-adjacent state can never read as a vanish
again:

- **Minimap dot.** `MiniMapSystem.render` already takes a `companion`
  position (the `render` method's `companion` parameter, `src/systems/MiniMapSystem.ts`); add an optional
  `pet: { x: number; y: number } | null` parameter and draw a small dot in a
  distinct color (a named `MINIMAP_PET_COLOR` beside the existing marker
  colors). `DungeonScene` passes `this.mongoSystem.mongo`.
- **Screen-edge arrow.** When summoned and outside the viewport, draw a small
  `drawMongoIcon` chevron clamped to the screen edge along the cat→Mongo
  bearing, in `RenderPipeline`'s effects layer next to the existing speech
  bubble hook (the `mongoSystem.renderSpeechBubble` call in `renderEffects`, `src/systems/RenderPipeline.ts`). Constants:
  `OFFSCREEN_ARROW_EDGE_INSET_PX`, `OFFSCREEN_ARROW_SIZE_PX`. This is
  game-world adjacent chrome; the icon helper plus `drawText` cover it — no
  raw `fillText`.

## 3. Phase 2 — healing legibility

The button already carries the whole model (HP bar = the only cooldown,
countdown overlay, Resting label). Close the gap between _shown_ and
_stated_ with in-world, first-time-only lines — the speech bubble and the
existing notice channel, not a tutorial screen:

- **First despawn with HP below max** → cat speech bubble: `'Rest up,
Mongo.'` plus a one-line system notice: `Mongo heals only while recalled.`
- **First knockout** (`restingUntilFull` latching) → notice: `Mongo is
knocked out — he must rest to full health.` The button label already says
  Resting; this names why.
- **Numeric HP on the button.** Add `hp/maxHp` in small text above the bar
  (`drawText`, `TEXT_PRESETS.label` sizing) — the bar answers "roughly how
  hurt", the number makes the regen ticks visibly _count up_, which is what
  teaches "he is healing right now".
- **Ability-tab text.** Extend `MONGO_DEF.equipInstructions`
  (the `equipInstructions` field of `MONGO_DEF`, `src/abilities/mongo.ts`) with one sentence on persistent HP and
  off-duty regen — the place a player who wants the rule stated goes looking.

One-time flags live as fields on `MongoSystem` (session scope is fine — the
lines are cheap and repeat at most once per scene).

## 4. Phase 3 — leveling pace and visibility

Pace first — the announcement machinery already works
(the `abilityManager.onLevelUp` callback in the constructor, `src/scenes/DungeonScene.ts`); it has nothing to announce.

- **`MONGO_DAMAGE_PER_XP` 5 → 2** (the `MONGO_DAMAGE_PER_XP` constant, `src/abilities/mongo.ts`). A juvenile
  in constant combat moves from ~0.3 to ~0.8 XP/s.
- **Assist XP.** In `resolveKills` beside the existing killing-blow grant
  (the `abilityManager.addKillXp('mongo')` call in `resolveKills`,
  `src/systems/CombatSystem.ts`), pay `MONGO_ASSIST_XP = 5` when the
  dead mob's `damageTakenBy` (the `damageTakenBy` field, `src/creatures/Mob.ts`) records the live
  Mongo but he did not land the final blow. The pet is the one party member
  who mostly does not finish kills; contribution has to pay.
- **`baseXpToLevel2` 100 → 60** (the `baseXpToLevel2` field of `MONGO_DEF`, `src/abilities/mongo.ts`). The first
  level-up should land in the first session that uses him — it is the proof
  that leveling exists. Growth rate 1.45 is untouched; the late curve is
  fine once the player knows there is a curve.
- **XP strip on the button.** A 2-px `drawProgressBar` directly above the HP
  bar in `renderSummonButton`, fed by an `xpProgress()` accessor the scene
  injects (the system already takes `petLevel` as a closure — the
  `MongoSystem` constructor, `src/systems/MongoSystem.ts` — add a sibling
  `petXpFraction: () => number`). Constants `MONGO_XP_BAR_HEIGHT`,
  `MONGO_XP_BAR_COLOR`. Growth-stage changes already flash the creature
  (the `applyLevel` method, `src/creatures/Mongo.ts`) and open the level-up dialog; the strip
  is the "this number moves" tell in between.

Estimated new pace (to be confirmed at the keyboard): level 2 inside one or
two fights, level 5 (the adolescent growth spurt) inside a floor or two of
regular use.

## 5. Phase 4 — engagement players can predict

Rule: **he defends the party first, then joins the player's fight, then
free-hunts**. Replace the flat nearest-mob scan in `pickTarget`
(the `pickTarget` method, `src/creatures/Mongo.ts`) with a scored pick over the same
candidate set (still `isValidTarget` + `canNotice`-gated, still holding the
current target inside the persist band):

1. **Party threat** — a mob whose `currentTarget` is the owner, or whose
   `retaliateMob` is the owner, outranks everything (`PRIORITY_PARTY_THREAT`).
2. **The player's quarry** — a mob the owner has damaged recently. Track it
   where the knowledge originates: `Mob.takeDamageFrom`
   (the `damageTakenBy.set` call inside `takeDamageFrom`, `src/creatures/Mob.ts`) already records per-attacker damage;
   add a frame-stamped `lastDamagedByOwnerFrame` read, or thread the cat's
   most recent victim through a small `owner`-side field — decide at
   implementation which is cheaper, but the contract is "the mob the cat is
   hitting" (`PRIORITY_OWNER_QUARRY`).
3. **Nearest visible** — today's behavior, as the fallback.

Within a tier, nearest wins. Two supporting changes:

- **Fights the owner is in are noticed through walls.** `canNotice` exempts a
  mob that is currently hurting the owner — mirror the `alertedTo` mechanism
  (the `alertedTo` check in `canNotice` and the `noticeTarget` method, `src/creatures/Mob.ts`) by calling `noticeTarget`-style
  registration on Mongo when the owner takes mob damage, so a doorway does
  not blind him to the cat being bitten. This also honors the leash-ban
  exemption already documented for hunting mobs
  (the `LEASH_BAN_LIFT_APPROACH_TILES`/`LEASH_BAN_LIFT_MIN_TILES` constants, `src/creatures/Mongo.ts`).
- Keep every band constant as-is (the `ENGAGE_RADIUS_TILES`/`ENGAGE_PERSIST_TILES`/`LEASH_BREAK_TILES`/`LEASH_RESUME_TILES` constants, `src/creatures/Mongo.ts`) — the
  yo-yo protections are load-bearing; the fix here is _which_ mob, not _how
  far_.

The scored pick makes his behavior narratable in one sentence — "he guards
the cat, helps with your target, otherwise hunts nearby" — which is the
legibility fix; no UI is needed beyond what Phase 2/4 already add.

## 6. Phase 5 — survivability

He is a melee animal on every hostile's target list. Three levers, all in
the one stat table or one named constant, all [HUMAN]-tunable:

- **Pet damage resistance.** `MONGO_DAMAGE_TAKEN_MULTIPLIER = 0.6` applied
  in a `Mongo.takeDamage` override before delegating to `super` — flat,
  honest, and visible in one place. Rationale: he cannot kite, cannot heal
  in the field, and pays real recovery time for every point.
- **Fatten the juvenile band.** 20/24/28/34 → 35/42/50/60 for levels 1-4 in
  `MONGO_LEVELS` (the `MONGO_LEVELS` array, `src/abilities/mongo.ts`). The unlock floor's mobs
  hit for enough that 20 HP is two mistakes; the adolescent/adult rows are
  probably fine once resistance lands.
- **Wounded retreat (optional, flag-gated).** At
  `MONGO_RETREAT_HP_FRACTION = 0.25` he disengages and holds at the cat's
  side (the `standBy` posture) instead of pressing until the knockout
  interception (the `checkHealth` method, `src/systems/MongoSystem.ts`) fires. This converts
  "he died instantly" into a visible limping-raptor state the player can
  respond to with a recall. It slightly softens the "spending him is the
  decision" design (the class-level doc comment on `MongoSystem`, `src/systems/MongoSystem.ts`), so it ships behind
  a single boolean constant and gets its own [HUMAN] verdict.

## 7. The numbers, before → after

|                                 | before          | after                      |
| ------------------------------- | --------------- | -------------------------- |
| AI tick beyond 22 tiles         | frozen solid    | always ticks (opt-in flag) |
| stuck while following/recalling | forever         | rescue ≤ 90 stalled frames |
| cat-distance hard rescue        | —               | 18 tiles                   |
| button while recalling          | dead            | forces rescue              |
| off-screen visibility           | none            | minimap dot + edge arrow   |
| `MONGO_DAMAGE_PER_XP`           | 5               | 2                          |
| assist XP on a shared kill      | 0               | 5                          |
| `baseXpToLevel2`                | 100             | 60                         |
| target priority                 | nearest visible | threat → quarry → nearest  |
| damage taken                    | 100%            | 60%                        |
| level 1-4 max HP                | 20/24/28/34     | 35/42/50/60                |

Healing/regen numbers (`1%` per 78 frames, rest-to-full on knockout,
`MIN_SUMMON_HP = 1`) are deliberately untouched — the complaint was
comprehension, not pace, and R1 of the redesign plan already flagged those
tunables for Ryan.

## 8. Validation gates

- `npm run typecheck`, `npm run lint`, `npm run format` — zero errors, per
  CLAUDE.md; no `as`, no `!`, no `any` anywhere in the new code.
- All UI additions go through `drawText`/`drawProgressBar`/`drawButton` and
  presets; every new literal above gets a named constant.
- A headless sanity check is worth adding to the existing script family: a
  node harness that walks the owner away from a spawned Mongo across a
  generated map and asserts he is beside the cat (or despawned) within
  `HOME_STALL_LIMIT_FRAMES + RESCUE` bound — the vanish was invisible to
  every existing gate precisely because it needs distance and time.

## 9. Human checks

Everything below needs Ryan at the keyboard (`?playtest=<preset>` unlocks
Mongo; `?mongo` previews the art).

- [HUMAN] Walk away from a summoned juvenile at full player speed for 30+
  seconds, through forest and around boss doors: does he always either
  arrive or visibly teleport in, never vanish?
- [HUMAN] Recall him from behind sealed geometry (boss room, tree pocket):
  does the button press bring him, and does the despawn complete?
- [HUMAN] Does the rescue teleport read as "loyal pet catching up" rather
  than as a glitch (speech line, landing tile in front of the cat)?
- [HUMAN] Minimap dot and edge arrow: visible, not noisy?
- [HUMAN] Do the two first-time healing notices land at the right moments,
  and is once each enough to teach the model?
- [HUMAN] Does level 2 arrive within the first session of real use, and
  level 5's growth spurt soon enough to feel earned rather than mythical?
- [HUMAN] With threat-first targeting, does he peel the mob that is biting
  the cat, and join the player's target otherwise?
- [HUMAN] Survivability at unlock: does he survive a normal room fight at
  level 1-2 with the 0.6 multiplier and fatter juvenile HP, without
  trivializing it?
- [HUMAN] Verdict on the optional wounded-retreat behavior: keep, tune, or
  cut?
