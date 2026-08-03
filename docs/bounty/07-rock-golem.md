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

**Status: NOT STARTED**

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

- [ ] **G-A1. Module + toward set.** `scripts/rockGolemArt.ts` +
      `scripts/generate-rock-golem-sprites.ts` (`npm run gen:rock-golem`).
      Rows `walk`, `idle` (toward). Walk is ponderous — weight lands hard,
      body barely bobs; idle is near-still with grinding micro-shifts
      (timeFrameIndex-driven).
- [ ] **G-A2. Away set.** `walk_away`, `idle_away`.
- [ ] **G-A3. Side set.** `walk_side`, `idle_side` (ctx-flip mirror).
- [ ] **G-A4. Attack rows** (shared by both variants): - `slam` × toward/side/away — double-fist raise + drive. - `stomp` × toward/side/away — leg raise, ground-shaking stomp. - `throw` × toward/side/away — crouch, pull a rock **up from the
      ground** (the pick-up is the readable windup Ryan asked for), heave.
- [ ] **G-A5. Boss-only rows** (`rock_golem_boss` sheet): - `curl` (one-shot into ball), `roll` (spinning boulder loop — mostly a
      rotating ball with debris; facing-agnostic single row is fine), - `uncurl`, and `stunned` (sat back, head lolling, stars/debris ring).
- [ ] **G-A6. Effects.** `src/images/effects/`: `golem_rock` thrown-boulder
      spin frames + `golem_rock_burst` impact rubble.
- [ ] **G-A7. Gore rows.** Both variants via shared `goreWound.ts` — golem
      "gore" is **rubble**: head-stone, fist-boulders, chest slab cracked
      open showing the glowing core, scatter stones. Like the skeleton file,
      this stretches `goreWound.ts`'s flesh assumptions — extend carefully;
      rat/llama byte-identical re-bake is the regression check. Register
      `ROCK_GOLEM_GORE_PARTS` (+ boss key) in `BodyPartGoreSystem`.
- [ ] **G-A8. Harness + preview.** `scripts/render-rock-golem.ts`
      (`--only=regular|boss`), `?golem` preview route.
- [ ] Review loop on final sheets (reviewer sees PNGs)

## Creature behavior

- [ ] **G-B1. `RockGolem`** (`src/creatures/RockGolem.ts`, registry id
      `'rock_golem'`): the shared kit. State machine
      `idle → pursuing → slam | stomp → cooldown`, alternating slam/stomp
      (remember last used); when target beyond ~5 tiles with LOS: `throw` —
      queues a rock projectile at release frame (shared timing constant in
      `src/sprites/`, llama pattern). Tanky, slow, high melee damage — named
      constants.
- [ ] **G-B2. `RockThrowSystem`** (`src/systems/`): LavaBallSystem-shaped owner
      for thrown rocks (drain `takePendingThrows()` from every golem — a golem
      dying mid-throw must not eat the rock). Rock: straight heavy shot,
      breaks on wall, ~1-tile burst damage on impact. Carried pre-scaled
      damage + `DamageSource`.
- [ ] **G-B3. `RockGolemBoss`** (`src/creatures/RockGolemBoss.ts`, extends
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
- [ ] **G-B4. Mercenary/club upgrade**: point the hired **bruiser** at the new
      shared kit — either make `Mercenary` bruisers render from the
      `rock_golem` sheet with the shared rows, or (cleaner, decide at
      implementation and journal it) give the bruiser template a golem-backed
      subclass so it also gains slam/stomp/throw. The club-interior Sledge
      station NPC keeps its runtime drawing (it's cosmetic and non-combat) —
      do NOT touch `clubNpcSprite.ts` beyond what reuse requires. Ryan's
      requirement is that hired meat shields share the animations and attacks.
- [ ] **G-B5. Spawn composition** (`BountyDef.spawn`): boss + 1 `RockGolem`
      bodyguard. Def id `'rock_golem'`, `typeLabel: 'the Rock Golem'`. Delete
      `debug_ghoul` placeholder if still present.
- [ ] **G-B6. Loot + XP** per core plan C5; boss-tier `xpValue`.
- [ ] Validation gates + review loop after each of B1–B6

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

- [ ] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] Registered in `BOUNTY_DEFS`; full `!bounty` loop (issue → arrow → fight:
      slam/stomp alternate, rock throw at range, roll = exactly three passes
      then unroll, 1-damage cap only while rolling, gym equipment interrupt →
      stun → full damage window → kill → collect)
- [ ] Thrown rocks survive the thrower's death mid-flight
- [ ] Fog: boss immune + toast; bodyguard confused
- [ ] Town lure: both follow into town, stay aggressive
- [ ] Hired bruiser meat shield uses the shared kit (hire one at the club and
      watch it slam/stomp/throw)
- [ ] Regular golem spawns standalone via registry id (future reuse)
- [ ] **[HUMAN]** Ryan playtests: roll damage/readability, stun window length,
      whether carrying gym equipment for the counter feels good, bruiser feel
      in the club
- [ ] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.
