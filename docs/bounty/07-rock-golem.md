# Bounty Boss — The Rock Golem

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry); art phases are
independent. This file also **upgrades the Desperado Club's golems**: today
"the Sledge" is a talk-only station NPC drawn at runtime by `drawStoneGolem` in
`clubNpcSprite.ts`, and the hired bruiser mercenary renders with that same
drawing (`Mercenary.ts` maps `bruiser → 'sledge'`). There is **no golem Mob
class and no golem sprite sheet** — this plan creates both, and per Ryan the
boss, the regular golem, and the hired meat shields all share the same
animations and attacks.

**Status: IMPLEMENTED — art, creatures, projectile system, mercenary upgrade and
bounty registration all landed 2026-08-02. [HUMAN] playtests outstanding.**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `bipedal-figure` (a golem is a heavy biped), `add-sound`.

## Concept

A **rock golem** boss — the Sledge's kind — slightly bigger and visually
distinct (e.g. molten cracks, moss-and-lichen shoulders, a broken stone crown),
with **one bodyguard** (a normal rock golem).

Shared golem attack kit (boss, bodyguard, AND hired mercenary bruisers):

1. **Double-fist slam** — both fists raised and driven down together (melee).
2. **Ground stomp** — one leg stomp, short-radius shock (melee alternative;
   the kit alternates between 1 and 2).
3. **Rock throw** — when the target is far: picks a rock up off the ground and
   hurls it (ranged projectile).

Boss-only special — **boulder roll**: he curls into a ball and rolls, dealing
high damage on contact and taking only **1 damage per hit** while rolled
(hardened). Ball-of-Swine-like, but bounded: **three roll passes** and he
unrolls back to normal. **Dropped obstacles** (the gym equipment placed via
`BarrierSystem`) interrupt it instantly: hitting a barrier's slow radius while
rolling makes him immediately unroll and stand **stunned** for a moment.

## Names (5–10, shuffled by the core system)

```
'Rubble', 'Crag', 'Basalt', 'Cobble', 'Scree', 'Shale', 'Granite', 'Knapper'
```

## Art

One art module, two sheet variants (`rock_golem`, `rock_golem_boss`) — goblin
multi-sheet precedent. Regular ≈2 tiles, boss ≈2.5 tiles + distinct dressing.
The existing runtime `drawStoneGolem` palette is the color reference (keep the
club NPC recognizably the same species). Rock-believability notes (candidate
bake gates): a golem reads as rock when it's an **assembly of stones**, not a
gray man — visible seams between boulder-segments, asymmetric masses, no
smooth muscle curves; joints are gaps where inner glow or shadow shows;
weathering (chips, strata lines) breaks up flat fills.

Per Ryan, each view/animation is its own independent task:

- [x] **G-A1. Module + toward set.** `scripts/rockGolemArt.ts` +
      `scripts/generate-rock-golem-sprites.ts` (`npm run gen:rock-golem`).
      Rows `walk`, `idle` (toward). Walk is ponderous — weight lands hard,
      body barely bobs; idle is near-still with grinding micro-shifts
      (timeFrameIndex-driven).
- [x] **G-A2. Away set.** `walk_away`, `idle_away`.
- [x] **G-A3. Side set.** `walk_side`, `idle_side` (ctx-flip mirror).
- [x] **G-A4. Attack rows** (shared by both variants): - `slam` × toward/side/away — double-fist raise + drive. - `stomp` × toward/side/away — leg raise, ground-shaking stomp. - `throw` × toward/side/away — crouch, pull a rock **up from the
      ground** (the pick-up is the readable windup Ryan asked for), heave.
- [x] **G-A5. Boss-only rows** (`rock_golem_boss` sheet): - `curl` (one-shot into ball), `roll` (spinning boulder loop — mostly a
      rotating ball with debris; facing-agnostic single row is fine), - `uncurl`, and `stunned` (sat back, head lolling, stars/debris ring).
- [x] **G-A6. Effects.** `src/images/effects/`: `golem_rock` thrown-boulder
      spin frames + `golem_rock_burst` impact rubble.
- [x] **G-A7. Gore rows.** Both variants via shared `goreWound.ts` — golem
      "gore" is **rubble**: head-stone, fist-boulders, chest slab cracked
      open showing the glowing core, scatter stones. Like the skeleton file,
      this stretches `goreWound.ts`'s flesh assumptions — extend carefully;
      rat/llama byte-identical re-bake is the regression check. Register
      `ROCK_GOLEM_GORE_PARTS` (+ boss key) in `BodyPartGoreSystem`.
- [x] **G-A8. Harness + preview.** `scripts/render-rock-golem.ts`
      (`--only=regular|boss`), `?golem` preview route.
- [x] Review loop on final sheets (reviewer sees PNGs)

## Creature behavior

- [x] **G-B1. `RockGolem`** (`src/creatures/RockGolem.ts`, registry id
      `'rock_golem'`): the shared kit. State machine
      `idle → pursuing → slam | stomp → cooldown`, alternating slam/stomp
      (remember last used); when target beyond ~5 tiles with LOS: `throw` —
      queues a rock projectile at release frame (shared timing constant in
      `src/sprites/`, llama pattern). Tanky, slow, high melee damage — named
      constants.
- [x] **G-B2. `RockThrowSystem`** (`src/systems/`): LavaBallSystem-shaped owner
      for thrown rocks (drain `takePendingThrows()` from every golem — a golem
      dying mid-throw must not eat the rock). Rock: straight heavy shot,
      breaks on wall, ~1-tile burst damage on impact. Carried pre-scaled
      damage + `DamageSource`.
- [x] **G-B3. `RockGolemBoss`** (`src/creatures/RockGolemBoss.ts`, extends
      `RockGolem`): adds the roll. - Trigger: cooldown-based while aggroed (e.g. every ~15 s). - `curl` (~40 frames, vulnerable normally) → `rolling`: **three passes**.
      A pass = aim at the target player's current position, roll through it
      in a straight line via `moveWithCollision` until reaching the far side
      (~2 tiles past the aim point) or hitting a wall; then re-aim for the
      next pass. Pass count is the exit condition (`ROLL_PASSES = 3`).
      Ball of Swine's orbit does NOT transfer (it ignores walls; the
      overworld has trees/cliffs) — straight charges with collision are the
      world-safe equivalent, journal this deviation consciously. - Contact damage while rolling: **high, not instant-kill** (e.g.
      `ceil(target.maxHp * 0.5)` + flat, per-player hit cooldown so one
      pass can't double-hit — BoS `killCooldowns` pattern). - Damage cap while rolling: override `takeDamageFrom` with the exact
      BoS one-liner shape — `Math.min(amount, 1)` unless not rolling. - **Obstacle interrupt**: while rolling, if `this.isSlowed` becomes true
      (that is `BarrierSystem`'s gym equipment setting `slowedByBarrier`
      within its radius — zero new coupling, the BoS precedent exactly) →
      immediately `uncurl` into `stunned` (~2.5 s, full damage taken,
      `requiresEvasion` false so the companion piles in). This makes gym
      equipment the counterplay tool, mirroring the arena fight. - `avoidInstead`-style companion behavior while rolling (BoS precedent).
- [x] **G-B4. Mercenary/club upgrade**: point the hired **bruiser** at the new
      shared kit — either make `Mercenary` bruisers render from the
      `rock_golem` sheet with the shared rows, or (cleaner, decide at
      implementation and journal it) give the bruiser template a golem-backed
      subclass so it also gains slam/stomp/throw. The club-interior Sledge
      station NPC keeps its runtime drawing (it's cosmetic and non-combat) —
      do NOT touch `clubNpcSprite.ts` beyond what reuse requires. Ryan's
      requirement is that hired meat shields share the animations and attacks.
- [x] **G-B5. Spawn composition** (`BountyDef.spawn`): boss + 1 `RockGolem`
      bodyguard. Def id `'rock_golem'`, `typeLabel: 'the Rock Golem'`. Delete
      `debug_ghoul` placeholder if still present.
- [x] **G-B6. Loot + XP** per core plan C5; boss-tier `xpValue`.
- [x] Validation gates + review loop after each of B1–B6

## Sounds ([HUMAN] sourcing)

| Proposed SoundId    | Ideal sound                          | Trigger                                                                               |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `golem_step`        | deep stone footfall (every Nth step) | walk                                                                                  |
| `golem_grind`       | stone-on-stone grind                 | idle shift + curl/uncurl                                                              |
| `golem_slam`        | double boulder impact                | slam execute                                                                          |
| `golem_stomp`       | single massive stomp + rumble tail   | stomp execute                                                                         |
| `golem_throw`       | effortful heave + air whoosh         | rock release                                                                          |
| `golem_rock_impact` | shattering rock burst                | projectile impact                                                                     |
| `golem_roll`        | continuous rolling rumble (loopable) | rolling (start/stop with state — clear it on interrupt too, the river-emitter lesson) |
| `golem_stunned`     | cracked, dazed groan                 | stun start                                                                            |
| `golem_death`       | avalanche collapse                   | death                                                                                 |

`audioTag: 'rock_golem'` + case arms in `playMobAudioCues`. `ball_of_swine_rolling`
already exists — audition it as the roll stand-in before sourcing. Boss music:
default ternary arm unless Ryan sources one (journal it).

- [x] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] **[HUMAN]** Registered in `BOUNTY_DEFS` (done, and machine-checked); the in-browser `!bounty` loop (issue → arrow → fight:
      slam/stomp alternate, rock throw at range, roll = exactly three passes
      then unroll, 1-damage cap only while rolling, gym equipment interrupt →
      stun → full damage window → kill → collect)
- [x] Thrown rocks survive the thrower's death mid-flight
- [x] Fog — flags machine-checked by `npm run verify:bounty`; **[HUMAN]** the on-screen toast (the cast bakes its cloud on a DOM canvas and cannot run headlessly)
- [x] Town lure — `verify:bounty` asserts `ignoresTownSafeZone` on both, and neither class passes a town predicate to `acquireTarget`
- [ ] **[HUMAN]** Hired bruiser meat shield uses the shared kit (hire one at the club and
      watch it slam/stomp/throw)
- [x] Regular golem spawns standalone via registry id — machine-checked by `npm run verify:bounty`
- [ ] **[HUMAN]** Ryan playtests: roll damage/readability, stun window length,
      whether carrying gym equipment for the counter feels good, bruiser feel
      in the club
- [x] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.

- 2026-08-02 — Implemented end to end by Claude. Art, creature classes, the
  projectile system, the mercenary upgrade and the bounty registration all
  landed; `npm run typecheck`, `npm run lint`, `npm run format` and
  `npm run build` are clean.

  **Art pipeline.** `scripts/rockGolemArt.ts` (painter) →
  `scripts/generate-rock-golem-sprites.ts` (choreography + bake gates,
  `npm run gen:rock-golem`) → `scripts/render-rock-golem.ts`
  (`--only=regular|boss`, `--row=`, `--mode=gore`) → `?golem` preview scene.
  Both variants come out of one row table, so the boss, the wild golem and the
  hired bruiser cannot drift apart.

  Sheets: `rock_golem` 16 rows × 14 cols of 112×112 (tileScale 40), and
  `rock_golem_boss` 20 rows × 14 cols of 136×136. Plus `golem_rock` and
  `golem_rock_burst` in `src/images/effects/`. All four manifest entries were
  hand-pasted after the generator printed them; the generator verifies and fails
  the run on a mismatch rather than rewriting the shared JSON.

  **Art review rounds (I read every contact sheet as an image).**
  1. First bake read as a _low-poly grey robot_: the head was lost between the
     shoulders, the torso was three symmetric horizontal bars, limbs were thin
     rectangles. Fixed by widening the whole figure past human ratios
     (shoulders 0.62 half-width against a 2.13 figure), raising and enlarging
     the head, and adding a neck stone.
  2. Second round: the big stones still read as flat-shaded polygons — one huge
     lit triangle per slab. Fixed by adding `paintCracks` (fissures with a
     hairline highlight) and dropping the facet alphas from 0.9/0.85 to
     0.42/0.42, so the facets shade rather than tile.
  3. Third round: the torso still read as a segmented robot. Replaced the three
     stacked wedges with `TORSO_STONES` — a deliberately asymmetric cairn of six
     boulders off the centreline. This is the change that made it read as rock.
  4. Fourth round: the **profile** collapsed into a thin column, because the
     torso stones only carried a lateral offset. Gave each one a `fore` offset
     and added `armStagger` / `legStagger` so the two arms and the two legs are
     separable edge-on. Also moved the core vent to the chest's leading face in
     profile and suppressed it entirely on the back view (the two head-on views
     were otherwise indistinguishable at tile size).
  5. Boss rows reviewed last: crown, lichen, the plates swinging shut over an
     exposed core, the spinning boulder and the dazed sprawl all read. Tunes:
     dropped the curl's core bloom, enlarged the roll's debris chips, and seated
     the broken crown on the skull's actual dome — laid along a flat line it
     left the outer spires floating in the gap above the shoulders, and the
     first attempt at the fix pushed them to the skull's equator instead, where
     they read as two bars sticking out of the sides of his head.

  **Bake gates** (all in the generator; nothing reaches disk until they pass):
  G1 border clip, G2 blank frame, G3 anchor (with an allowance for the ground
  shadow's own spill, exported from the art module so it cannot drift), G4 loop
  closure, G5 motion continuity with a spike allowlist derived from the shared
  timing fractions, G6 foot slide, G7 leg reach, G8 boulder grip, G9 **stone
  seam density** — the gate that encodes the whole review: a figure whose stones
  have merged into one smooth mass has almost no near-black pixels inside its
  silhouette, and G9 fails below 4%. G10 timing-table sync, G11 texture budget.

  G7 caught a real modelling bug on the first run: the leg bones had been sized
  to the standing hip-to-ankle span, which locks the leg dead straight and
  leaves a maximum stride of ~0.03 tiles. Bones now carry a declared
  `LEG_BEND_ALLOWANCE` so a standing golem already has a bent knee.

  **Deviations from the plan, journalled as asked.**
  - **Ball of Swine roll (asked for explicitly).** BoS orbits its arena and
    ignores walls, which it can do because the arena is an empty box. The
    overworld has trees, cliffs and boulders, so the roll here is three straight
    charges through `moveWithCollision`, each aimed at the target's current
    position and carried two tiles past it, with a pass also ending early if a
    wall stops the boulder. The two ideas taken verbatim are the one-line damage
    cap (`this.isRolled ? Math.min(amount, 1) : amount`) and reading `isSlowed`
    for the interrupt, so gym equipment is the counterplay with zero new
    coupling. Pass count, not a timer, is the exit condition (`ROLL_PASSES = 3`).
  - **G-B4 mercenary approach (asked for explicitly).** Chose _"make Mercenary
    bruisers render from the `rock_golem` sheet with the shared rows"_, extended
    so the bruiser also uses the golem's attacks: it alternates slam and stomp,
    lands them on the animation's own impact frame off the shared
    `GOLEM_ATTACK_TIMING` table, and throws a boulder at 4–9 tiles.
    `RockThrowSystem` finds throwers **structurally** (`takePendingThrows` in
    mob) rather than by `instanceof RockGolem`, so the merc's rocks fly by the
    identical path. The golem-backed _subclass_ option was rejected: everything
    that makes a merc a merc — the owner it trails, the leash, the roster that
    dies with it — lives on `Mercenary` and in `MercenarySystem`, and moving
    that under the golem hierarchy is a far larger and riskier change than
    driving three rows from `Mercenary`. `clubNpcSprite.ts` was not touched; the
    club-interior Sledge station NPC still uses its runtime drawing, and
    `TEMPLATE_SPRITE` now only maps the two non-golem archetypes.
  - **Gore does not go through `goreWound.ts`.** That module's vocabulary is
    muscle, subcutaneous fat, blood and marrow — a rock has no use for any of
    it, and stretching it would have meant editing a file the rat and llama
    bakes depend on while other agents are working in this repo. The eight
    rubble pieces are painted natively in `rockGolemArt.ts` with a
    `paintFractureFace` helper (jagged inner edge, molten core showing).
    `goreWound.ts` is therefore byte-unchanged by this work, which is a stronger
    regression guarantee than a re-bake comparison.
  - **`GOLEM_THROW_FRAMES` went 12 → 14 and the release fraction 0.62 → 0.72.**
    At 12 frames the stand-up out of the pick-up crouch tripped the motion
    continuity gate; the extra frames are what make the haul read as an effort
    rather than as a snap.
  - **`TILE_SCALE` is 40, not the usual 64.** The boss carries 20 rows and his
    raised slam is nearly three tiles tall; at 64 the sheet was 11.3 Mpx, well
    past anything else in the repo. 40 keeps it at 2128×2880 and still draws at
    1.25× the in-game tile.
  - **Walk is 12 frames, not the 16 the bipedal-figure skill suggests.** A golem
    is paced by a slow phase speed, not by frame count, and 14 columns was
    already set by the throw.

  **Sound stand-ins (Ryan has sourced none of the nine proposed ids; no mp3s
  were added).** `audioTag: 'rock_golem'`, arms added in `playMobAudioCues`:
  - slam + stomp execute → `krakaren_ground_slam` (the heaviest earth impact in
    the library; covers both).
  - rock release → `juicer_throw` (the only two-handed hurl).
  - projectile impact → `wood_smashing_1` / `wood_smashing_2`, drained in
    `DungeonScene` next to the llama's burst cue because the rock outlives its
    thrower.
  - curl / roll start / uncurl → `ball_of_swine_rolling`. **Auditioned as the
    plan asked and kept**: it is already a stone-heavy rumble and the golem's
    three roll beats all read against it. It is fired as a one-shot on state
    change rather than as a loop, so there is no emitter to leave running on an
    interrupt.
  - stun start → `bear_growl_1` (nearest heavy dazed grunt).
  - `golem_step` and `golem_death` have no stand-in: a per-step footfall would
    need a new emitter and the death already plays the shared kill cue.
  - Boss music: left on the default `bossFightInitiated` arm, as the plan allows.

  **Self-caught defect before review.** `frameAt` in `rockGolemTiming.ts` rounded
  `frames * progress`, but the generator samples one-shot rows at frame
  _centres_ (`(f + 0.5) / frameCount`). Every impact therefore landed one sheet
  frame — four game frames — after the pose that shows it. Fixed to
  `round(frames * progress - 0.5)`, and the generator's continuity spike
  allowlist now calls the same shared helpers instead of recomputing the
  formula, so the two cannot disagree again.

  **Independent review round 1** (fresh-context agent, given the spec and the
  diff). Two genuine findings, both real and both fixed:
  1. _The hired bruiser's thrown rock hit the bruiser itself and could never hit
     anything else._ Two compounding bugs: the throw branch never set
     `golemVictim`, so the release aimed at whatever direction pathfinding had
     left the merc facing and carried `aimedAt: null` — and a merc is itself in
     the scene's `extraTargets`, so with the boulder spawning ~12 px from its own
     centre against a 21.8 px hit radius it detonated on the frame it was fired.
     Fixed by committing the victim before the wind-up, and by carrying a
     `thrower` on `GolemRockThrow` that `RockThrowSystem` excludes from the
     shot's own target list.
  2. _Boulder-roll contact damage was scaled twice._ It is already a fraction of
     the victim's own maximum HP, and `dealDamage` then ran it through
     `MOB_LEVEL_DAMAGE_SCALE` — so from mob level 6 up a single pass killed a
     full-health player outright, contradicting the plan's "high, not
     instant-kill". Now dealt through `takeDamage` with its own dodgeable
     `DamageSource`.

  Three of the round's nits were acted on because they were defects in kind
  rather than style: gate G8 named `throw_side` but measured the front view (it
  now runs over all three views); `requiresEvasion` was an unconditional `false`
  that also left the boss freezable mid-roll outside the AI radius (now
  `state !== 'stunned'`, which both makes the companion respect the telegraphs
  and keeps the rolled state ticking); and the deliberate non-ticking of attack
  cooldowns through the ball states is now documented rather than implicit. Two
  nits were dismissed: `avoidInstead` covering `curling` as well as `rolling` is
  a small improvement over the spec, not a deviation from it, and the
  activation-radius caveat is now moot.

  **Independent review round 2** (full fresh review). Ten findings; the four
  that mattered most were real and are fixed:
  1. _A boulder that killed a Mob did no kill processing._ `RockThrowSystem`
     called `Player.takeDamage`, but `Mob extends Player` — so a mob victim hit
     zero HP without `justDied`/`killedBy`/`droppedLoot`, and `CombatSystem`'s
     kill loop skipped it: no XP, no loot, no gore, never removed from the mob
     list or the grid. That is the _normal_ case for a hired bruiser, whose
     whole job is throwing rocks at mobs. Now routed through `takeDamageFrom`.
  2. _The bruiser's boulder friendly-fired its own party._ It throws from 4–9
     tiles while leashed 2–3 tiles from its employer, so every rock crossed
     them. `GolemRockThrow` now carries an `owner`; an allied shot considers
     only what it was aimed at.
  3. _The slam never reached the ground_ — verified by rendering it. The fists
     stopped near hip height while dust fired at the ankles, contradicting the
     timing module's own "both fists reach the ground". The blow now drops the
     hips a full `MAX_CROUCH` and brings the fists together and nearly straight
     down.
  4. _Gate G10 was circular and could never fail._ It compared `ROWS`'s frame
     counts against the timing module `ROWS` is built from — `X !== X`. It
     looked like coverage and provided none, which is exactly how (3) shipped
     past it. Replaced with a pose gate that measures the fists' lowest point
     against the declared impact frame _and_ against the floor, plus a check
     that the boulder leaves the hands on the declared release frame. The new
     gate failed on the first run and again after the first fix attempt, which
     is the behaviour the old one should have had.

  Also fixed from the same round: the bruiser threw with no line-of-sight check
  (it lobbed rocks into the wall it stood behind, forever, because the cooldown
  reset and it never closed); the bruiser never faced its victim during a
  56-frame wind-up; the two effect sheets had no bake gates at all (now G13:
  border-clip and blank-frame); and `gore_shoulder` was the only rubble piece
  with no fracture face, so it read as an intact boulder rather than a torn-off
  part.

  One finding was already fixed by another agent working concurrently — the
  golem's `DeathCauseSystem` entries. My rename of the roll's `attackType` broke
  the literal they had hardcoded, so their constant now imports from a shared
  `rockGolemAttackTypes.ts`, and the thrown boulder got its own cause too.

  Nits dismissed: the `no-magic-numbers` count in the two art scripts (`npm run
lint` is `eslint src`; every sibling art script is the same), `G1`/`G5`
  headroom, and the stale sheet dimensions in this journal — corrected above
  rather than argued with.

  **Independent review round 3** (confirming round; the reviewer also
  falsification-tested both new gates by perturbing constants, and both failed
  correctly before any write). Four genuine findings — and three of them were
  _inside_ round 2's fixes, which is this repo's documented failure mode
  happening again:
  1. _A cat-active bruiser's boulder kill granted free Magic Missile ability XP
     and, past missile level 15, a free magic shockwave._ Round 2's fix routed
     mob victims through `takeDamageFrom(..., 'missile')`; `CombatSystem` credits
     a `missile` kill by the cat to the Magic Missile ability, and
     `MercenarySystem` reassigns a merc's owner to whichever crawler is active
     every frame. Now typed `melee` — which is also the truer description of a
     boulder, and matches what the merc's own melee already does.
  2. _A wild golem's rock still did no kill processing._ `owner` is null for a
     wild golem, so `damageTakenBy` stayed empty and `resolveKills` bailed on
     "nothing damaged this" before loot, gore and `mobKilled` — round 2 fixed
     only the bruiser half. Now `rock.owner ?? rock.thrower`, which also makes a
     mob a golem shells actually retaliate.
  3. _`RockGolemBoss.rollContact` had the exact bug round 2 fixed one file over._
     Its `targets` list is `MobUpdateLoop`'s, which folds in extra targets and
     the retaliation target — so a fog-confused bodyguard can end up under the
     boulder and be flattened without `justDied`. Same `instanceof Mob` split as
     the projectile now.
  4. _The thrown boulder could not hit a moving player._ `ROCK_SPEED` was 1.3
     against a player speed of 2.5 — half a walking pace over five to nine
     tiles. Raised to 3. The dodge window is deliberately the 56-frame pick-up,
     not the flight: you move because you saw him haul a rock off the ground.

  Nits acted on: the release gate now rejects a fraction that would index frame
  −1; the slam gate measures _both_ fists rather than one (they share a pose
  object today, so one fist would have passed an asymmetric edit); a pointless
  re-alias of an imported constant in `DeathCauseSystem`; and two stale comments
  naming a gate "G12" that does not exist. Dismissed: `strike()` bypassing
  `Player.takeDamage`'s guards for mob victims (that is what `takeDamageFrom`
  is, and every mob-on-mob hit in the codebase behaves this way), the stun that
  a roll ending inside gym equipment gives (the player earned that by placing
  it), and a per-frame array allocation in `advanceRocks`.

  **Independent review round 4** (confirming round): the protocol's required
  clean round after a round that found defects.

  **Still outstanding.** Everything that needs the game actually running: the
  `!bounty` walkthrough (issue → arrow → slam/stomp alternation → rock at range
  → exactly three passes → gym-equipment interrupt → stun window → kill →
  collect), the fog toast, the town lure, and hiring a bruiser at the club to
  watch it slam/stomp/throw. Those checkboxes are deliberately left unticked.
  Ryan's feel playtest (roll damage, stun length, whether carrying gym equipment
  for the counter is fun) is the remaining [HUMAN] item.
