# Ball of Swine — rework plan

The floor-2 borough boss is being rebuilt end to end: new generated art, a new
fight, a dressed arena, and a structure that finally delivers the beat it was
designed for (safe room → boss, obviously skippable).

## 0. Source material

> The Ball of Swine appears to be a massive almost-15' (4.5m) diameter ball of
> rippling pink flesh embedded with eyes, tusks, and scraps of tuxedos and red
> sequin dresses. It reeks of sewage and rotten meat, and grunts and squeals in
> "a high-pitched, angry pig noise" as it rolls shockingly quickly around its
> boss chamber. It never loses momentum.

Level 15 borough boss — tougher than most creatures. Mechanically it is a ball
of fused Tusklings, and the fight should read that way.

## 1. What is wrong today

**Art.** `src/images/bosses/ball_of_swine.png` is legacy hand-made art with no
generator. The ball is a flat maroon sphere about 1.7 tiles across inside a
6-tile frame, decorated with a handful of smudges. Nothing in it reads as flesh,
eyes, tusks, or clothing, and it is too small to read as massive.

**Movement.** `BallOfSwine.updateAI` moves the ball along a parametric orbit
whose centre lerps toward the player. It never touches `moveWithCollision`, so
it has no relationship to the arena at all — it does not roll, it does not
collide, and its "speed" is an angular constant that `applyMobLevel` cannot
scale (`BOS_SPEED_BASE = 0`).

**The fight.** Contact deals `INSTANT_KILL_DAMAGE = 9999`. Damage taken is
capped at 1 unless the ball is stopped, and it stops on a random 20–40 second
timer. So the fight is: survive an unavoidable one-shot for up to 40 seconds,
hit it during the window, repeat. Two problems, both already named in this
repo's own docs:

- `docs/difficulty-plan.md` P2: "Damage-avoidance must remain possible by
  movement alone — scaling may shrink the margin, never remove it."
- `src/creatures/RockGolemBoss.ts` was written as a bounded version of this very
  roll, and its header says a rolling boss that one-shots "is a coin flip, not a
  fight."

It also contradicts the source: the ball is supposed to *never lose momentum*,
and today it parks itself for forty seconds at a time.

**The arena.** A 15-tile-radius steel disc holding a boss, four gym pickups and
a stairwell. `ARENA_FLOOR` is the only large floor region in the game drawn
tile-by-tile with raw `ctx` calls instead of a generated material, and its
renderer is the one floor case that never calls `drawWallShadow`, so the
wall/floor junction is a hard seam. No dressing of any kind.

**The structure.** This part is closer than it looks. The antechamber safe room
*is* carved directly south of the arena door and *is* the only route to it
(invariant I6 in `src/map/progressionValidation.ts` proves it). What is missing
is any reason to walk in: the antechamber is a dead-end spur off one corridor,
and the arena is a blister in solid rock with no path around it. A crawler
following the floor never sees the door, never enters the safe room, and gets no
sense that there is a fight here to take or leave.

## 2. Fight design

The whole fight is about momentum, because that is the one thing the source
insists on. Momentum is a real quantity the player manipulates, and everything
else follows from it.

### 2.1 Rolling

`momentum` runs 0→1 and drives speed directly:

```
speed = MIN_ROLL_SPEED + momentum × (MAX_ROLL_SPEED − MIN_ROLL_SPEED)
```

The ball moves through `moveWithCollision` along a heading, so it exists in the
world for the first time. Momentum **never decays on its own** — no timers, no
idle spin-down.

It charges in **committed straight lines**: it aims at a crawler when it leaves a
wall and then does not turn again until it hits the next one. This started as a
bounded steering rate and simulation killed it — see §2.7.

### 2.2 The trick: bait it into a head-on wall slam

When the ball reaches the arena wall, the angle of incidence decides what
happens:

- **Glancing** carom → perfect reflection, momentum untouched. This is the
  default and it honours "never loses momentum".
- **Head-on** slam → a large momentum loss and a stagger. The wall takes its
  momentum and nothing else — it never wounds itself. A boss that whittles its own
  health bar down on the scenery reads as the arena fighting on your behalf, and
  left alone long enough it finishes the job; every point of damage on this
  creature has to be dealt by somebody.

A carom also has a floor on how shallowly it may leave (`MIN_CAROM_DEPARTURE`),
so the ball always comes off the rim and back across the floor.

Because legs are straight, the rule is geometric and teachable: **a chord that
passes near the middle of a circle meets it head-on; one that clips the edge
grazes.** So make it charge you across the centre of the arena, then step off the
line. That is the "secret to beating it" Mordecai already promises, and it needs
no new content.

Gym barriers stay a second, item-based momentum sink — `isSlowed` drains
momentum every frame, which keeps the existing counterplay and the
`DeathExplanations` line that names it.

### 2.3 Wallowing

Momentum at zero → `wallowing`. The ball collapses into a heaving, squealing
mass: it cannot trample, it takes **full damage times a bonus multiplier**, and
the window's length is proportional to how hard it crashed rather than rolled
off a random timer. Then `spinup` (a locked telegraph ≥ 21 frames, per P2) and
it is rolling again.

While rolling it takes a **fraction** of incoming damage rather than a flat cap
of 1, so chip damage and ranged builds still contribute — a flat 1 makes every
attack outside the window pointless.

### 2.4 Contact

The instant kill goes. Contact damage follows the Rock Golem's model, scaled by
current momentum:

```
damage = ceil(target.maxHp × TRAMPLE_HP_FRACTION × momentum) + TRAMPLE_FLAT
```

At full roll that is brutal and can end a crawler who is already hurt; at a
crawl it is a shove. Per-target cooldown stays. This keeps the terror of the
thing while making the fight a fight.

### 2.5 Phases

| HP | Phase | Behaviour |
|---|---|---|
| 100–60% | Rolling | steer, carom, slam |
| < 60% | Shedding | fused Tusklings tear free as it rolls, capped at a few alive at once |
| < 30% | Frenzy | faster roll, shorter wallows, and every wall slam vents a stench burst — flat unscaled radial damage plus `poison`, telegraphed by the slam itself |

Death keeps the burst: the ball splits and the remaining Tusklings tumble out
dazed, which is the existing phase-2 gate on the stairwell.

### 2.6 Numbers

Level band moves to a borough boss's 14–16. Because `applyMobLevel` multiplies,
base XP and coins come *down* so the scaled values land near today's, and base
HP is set so a level-15 ball lands at 999. Exact values in the code, and every one
of them is a `[HUMAN]` playtest item.

### 2.7 What simulation changed

The fight was built, then driven headless for 20 000 frames against a dummy
crawler at three radii and three orbit speeds, measuring wall overshoot, NaN,
stalls, slams, vulnerable windows and HP lost. Three things only measurement
could have found:

1. **Bounded steering made the fight unwinnable.** A turning radius of eight
   tiles inside an eleven-tile circle turns every approach into a long arc, and a
   long arc meets a circle at a shallow angle nearly every time. Across five
   simulated minutes the ball hit the wall squarely once or twice, so momentum
   almost never dropped and the vulnerable window almost never opened. Replaced
   with committed straight charges, which also hands the player control of the
   next impact angle instead of having them react to a homing boss.
2. **Shallow caroms let it orbit the rim forever.** A pure mirror reflection sends
   a grazing arrival away at a grazing angle, which arrives grazing again. Fixed
   with `MIN_CAROM_DEPARTURE`.
3. **The wall was doing the whole fight.** At the first-guess figure, slam
   self-damage alone killed a level-15 ball in five minutes with the dummy standing
   still and never attacking. Cut to a fifth at the time, and cut to nothing later
   — see §2.9. Momentum loss per slam was halved in the same pass, which brought
   the vulnerable share from 36% of the fight down to 17–26%.

### 2.8 The playtest: committed was *too* readable

Ryan played it and reported it easy, with little pressure. The simulation had said
the fight was healthy, and it was — about the right number of vulnerable windows,
sensible time-to-kill. What it could not see is that a *fully* committed straight
line is beaten by one early sidestep, and then by the same sidestep forever. The
boss had become legible at the cost of being threatening.

The fix keeps the geometry and adds a timing test. Four changes:

1. **A late lunge.** The charge takes exactly one locked correction when it closes
   to `LUNGE_RANGE_TILES` — about 35 frames from contact, above P2's 21-frame floor
   — with a red bar of ground marking the line it has just committed to. Dodge
   early and it follows you once; dodge late, after the lunge, and it cannot. The
   long-line geometry that makes wall angles predictable survives, because the
   correction is a single discrete re-aim rather than continuous homing.
2. **The wallow is no longer free.** Contact with a wallowing ball deals
   `WALLOW_CONTACT_FRACTION` of a trample. Standing inside it and swinging was
   risk-free, which collapsed the fight into waiting for a free hit; now the
   greedy play is a decision.
3. **Trample cooldown 90 → 55 frames**, and shedding tightened (interval 240 → 165,
   cap 3 → 4, daze 60 → 40).
4. **Less free damage time**: wallow window 130–260 → 100–210 frames, momentum per
   square slam 0.45 → 0.36, frenzy speed ×1.18 → ×1.32.

Re-measured across three crawler behaviours at three radii, the contact rate now
separates them properly — standing still takes 12–44 contacts a minute, a
continuously moving crawler 2–7 — where before every behaviour took roughly none.
Vulnerable share came down to 10–23% of the fight.

Behaviour that held throughout: no wall overshoot, no NaN, no stalls.

### 2.9 No self-damage

The wall slam originally cost the ball a slice of its own max HP. Removed outright
on Ryan's report that it looked like the ball was damaging itself: it is the wrong
read even when the number is small, because the health bar visibly moves without
anyone hitting it, and taken to its conclusion the arena kills the boss while the
crawler watches. Momentum is the only thing the wall takes.

Verified over 40 000 frames unattended, with a crawler parked at the wall, and with
one orbiting at two radii: zero frames of HP loss in every case, while momentum
still drops to 0.15–0.29 — so the mechanic is intact and only the self-harm is gone.

The fight is correspondingly longer, by roughly the 15% of its health the wall used
to remove. Left uncompensated on purpose: `docs/difficulty-plan.md` P1 forbids
paying for difficulty with time-to-kill, so if the fight now drags the answer is
more pressure, not more hit points.

## 3. Art

A generated sheet on the same pipeline as the Tuskling: `scripts/ballOfSwineArt.ts`
(anatomy and paint), `scripts/generate-ball-of-swine-sprite.ts` (choreography and
tiling), `scripts/generate-ball-of-swine-sprite.gates.ts` (the bake gates and the
only entry point), and `scripts/render-ball-of-swine.ts` (review harness, whose
`--mode=composite` is the only view that shows what the game shows).

For reviewing the *fight* rather than the art there is a new `swine` playtest
preset — `npm run playtest -- swine` — which drops a post-Krakaren party in the
antechamber with gym barriers in the bag.

### 3.1 Size

A tile is about 6'4" of creature (the Tuskling is 4'6" at 0.71 of a tile), so
15 feet is ~2.4 tiles. The ball is authored at **2.8 tiles** — generous enough
to read as "almost 15 feet" at sprite scale, and 65% bigger than the sphere it
replaces. That keeps the sheet *smaller* than the one it replaces despite
carrying twice the rows.

### 3.2 Rolling without a rotating highlight

The ball is drawn by rotating the sprite to its travel heading, so surface
features stream backward correctly in any direction including diagonals. A
fully-lit sprite rotated that way would carry its highlight around with it, so
the lighting is split out:

- `roll` frames are **ambient**: flesh, faces, tusks and cloth with their own
  local shading but no global key light.
- a one-frame `shade` overlay carries the key light, the wet rim and the ground
  contact shadow, and is drawn **unrotated** on top.

Every row is baked concentric on the frame centre so the rotated and unrotated
draws align; a gate measures it.

### 3.3 Rows

| State | Frames | Kind | Rotated | Notes |
|---|---|---|---|---|
| `roll` | 12 | loop | yes | surface phase along +x; 30° per frame |
| `wallow` | 8 | loop | no | collapsed and heaving, tusks splayed, mouths gasping |
| `shade` | 1 | overlay | no | fixed key light and wet specular |
| `shadow` | 1 | overlay | no | ground contact shadow, drawn *under* the body |
| `burst` | 8 | one-shot | no | splits open, Tusklings tumble out |
| `slam` | 4 | one-shot | yes | compressed along the impact axis, spray |
| `spinup` | 6 | one-shot | no | gathering itself, tusks clawing the floor |

Seven states on **four** sheet rows. The cells are large — a square cell wide
enough to rotate the ball inside — and a sheet is a rectangle, so one state per
row made every row as wide as the longest: 84 cells to hold 40. Packed, and with
the frame envelope kept to `BODY_REACH`, the rebuilt sheet is 3.98 Mpx against
the 3.54 Mpx of the hand-made one it replaces, for twice the content.

Frame counts and the body radius live in `src/sprites/ballOfSwineSheet.ts`,
shared by the generator, the runtime and the fight, replacing the three
hardcoded literals that were in `src/sprites/ballOfSwineSprite.ts`.

The palette is copied into `ballOfSwineArt.ts` rather than imported —
`tusklingArt.ts` exports no colours or primitives, and `tusklingGore.ts` sets
the precedent of re-deriving its own tones.

### 3.4 What has to be visible

Per the description, at 90 logical pixels:

- rippling **pink** flesh, not maroon — the Tuskling's `HIDE` ramp
- **eyes** scattered over the surface, blinking out of phase
- **tusks** breaking the silhouette, so the outline is not a circle
- **snouts** and gasping mouths
- scraps of **black tuxedo** and **red sequin dress** — the sequins are the one
  saturated highlight on the whole creature and are what make it read as
  *wearing* something rather than being a meatball

## 4. Arena

### 4.1 Redraw

Yes — it is the least-dressed major space in the game.

- `ARENA_FLOOR` gets a real renderer: riveted steel plates in a checker of
  2-tile plates with lit and grooved seams, one rivet per tile at the plate
  corners, drain channels on a 7-tile stride, dried blood and tusk gouges. Every
  variation is hashed off the tile coordinate, not off a per-frame stream — the
  chunk cache redraws tiles whenever the camera crosses a boundary, and a
  per-frame stream makes the whole floor crawl.
- The missing `drawWallShadow` call is added, so the floor finally sits against
  its own wall.
- A new blocking `ARENA_CAGE` tile set into the wall at even angles: barred
  alcoves holding slumped, well-dressed corpses, alternating black tie and red
  gown. This is where the tuxedos and the red sequin dresses come from, so the
  ball's clothing scraps have an on-screen source. It draws the same steel panel
  a `METAL_WALL` does — both go through `drawMetalWallPanel` — and then cuts an
  alcove into it, so a cage always agrees with the run of wall it sits in.

The interior floor stays otherwise clear on purpose: a rolling-ball fight needs
clean sightlines, and the ball's own wet track dresses it dynamically.

### 4.2 Structure

Two changes.

**A concourse ring around the whole arena.** The walkable ring
(`ARENA_RING_WIDTH`) was suppressed on progression floors, with a comment
explaining the dilemma: carve it and the player walks straight to the door,
bypassing the antechamber; leave it and it is unreachable floor. The way out is
to route the ring *through* the antechamber. Three pieces:

- The concourse is carved as a full circuit outside the wall.
- The arena's **door row is walled** on both sides of the door, so the only tiles
  touching the door from outside belong to the antechamber.
- Two **links** cut back through that wall further out, dropping each end of the
  ring into the antechamber. The antechamber's width therefore has a hard floor,
  derived in `arenaGeometry` from where those links land.

That resolves both horns at once:

- The door's only neighbour outside the wall is still the antechamber, so
  invariant I6 holds unchanged.
- The safe room stops being a dead-end spur and becomes the thing you walk
  through, which is the "forced into a safe room with the boss immediately
  after" beat the Juicer has on floor 1.
- Walking the concourse past a sealed iron drum with one guarded door is the
  clearest possible statement that this fight is optional.

Radial spokes from the concourse out to the free region were tried and dropped:
`SegmentMap.canCarveCorridor` will not let a corridor cross the arena's reserved
tiles, and the only endpoint that would have been accepted is the reserve itself
— whose corridor would have been carved straight through the arena wall. The
optionality is carried instead by the ring plus **multiple exits from the
antechamber**, which needs no new machinery and reads the same on the ground.

**Siting.** Placement is scored rather than first-fit, taking the furthest legal
position from the Krakaren's gateway so the arena sits near the end of the
floor's paths instead of wherever the first legal spiral step landed.

### 4.3 Invariants

`validateProgression` keeps its two existing arena checks — the door is reachable
only through the antechamber, and every stairwell survives blocking the
antechamber and the arena reserve — and gains one for the concourse:

- **I6b**: no tile of floor inside the arena's reserve is unreachable from the
  start. That is the exact failure the old comment named, and it is the way a
  one-tile error in the links would otherwise ship invisibly. Confirmed to fail
  by disabling the links and re-running `verify:progression`.

## 5. Ordering relative to the Krakaren

The arena is already reserved after the last gateway boss room and the free
region is a tree rooted at that boss, so the Ball of Swine is unreachable until
the Krakaren Clone is dead. The scored siting keeps that and strengthens it by
pushing the arena further from the gauntlet exit. `validateProgression` I3a/I3b
already assert the arena door is unreachable while bypassing each gauntlet's
gateway; those keep passing.

## 6. Work order

1. `src/sprites/ballOfSwineSheet.ts` — shared frame counts and body radius.
2. `scripts/ballOfSwineArt.ts` — palette, flesh, faces, tusks, cloth, sequins.
3. `scripts/generate-ball-of-swine-sprite.ts` — rows, choreography, tiling.
4. `scripts/generate-ball-of-swine-sprite.gates.ts` — bake gates; the entry point.
5. `scripts/render-ball-of-swine.ts` — review loop.
6. `src/sprites/ballOfSwineSprite.ts` — rotated roll, shade and shadow overlays,
   the wet track, new states.
7. `src/creatures/BallOfSwine.ts` — momentum physics, phases, contact, checkpoints.
8. `src/systems/ArenaSystem.ts` — shedding, stench bursts, HUD momentum read-out.
9. Arena tiles: `ARENA_FLOOR` renderer, `drawWallShadow`, `ARENA_CAGE`.
10. `src/map/` — concourse carve, scored siting, `arenaGeometry` updates.
11. `src/map/progressionValidation.ts` — concourse invariants.
12. Copy: `mordecaiAdvice`, `DeathExplanations`, the boss description.
13. `src/dev/playtestPresets.ts` — the `swine` preset.
14. Gates: `npm run typecheck`, `lint`, `format`, `verify:progression`,
    `verify:difficulty`, `verify:assets`, `gen:ball-of-swine`.

## 7. What the review rounds changed

Three independent review passes over the finished change set. The rounds earned
their keep — the first found a defect worse than anything in the original code:

**The death never completed.** `isAlive` reports true through the burst so the
fight cannot end mid-animation, but the burst had nowhere to finish, so the ball
stayed permanently "alive" and re-latched `justDied` *every frame* — 331 times in
400 frames. That re-resolved the kill sixty times a second: the whole XP split
re-awarded, `bossDefeated` re-emitted into another eight Tusklings each frame, and
`rewindMobsToCheckpoint` unable to ever revive it because it never read as dead.
Fixed with a terminal `'spent'` phase. **This was pre-existing** — the previous
code had the same shape — and it survived because `verify:difficulty`'s boss-revive
case never instantiated a `BallOfSwine`. It does now, with seven checks.

**A status tick could kill it past the burst entirely.** `Player.takeDamage` is
where burn, poison and sepsis land, and it does none of a mob's death bookkeeping —
so a ball finished off by the cat's Sepsis Crown dropped to zero with no
`justDied`, and `resolveKills` skipped it: no loot, no XP, no phase 2, no
stairwell. Fixed with a `takeDamage` override that routes a lethal tick through the
real mob death path. Also covered by a check.

**An unattended ball fought the walls.** `requiresEvasion` force-activates a mob
*regardless of distance*, so a level-15 ball ticked from level load and ground its
own HP down on the ironwork in an empty chamber — first vulnerable window 11.6
seconds after the floor generated. The party would have arrived to find the boss
already collapsed. Now gated on having a target, and wall impacts cost nothing with
nobody present.

Smaller: the slam pose was rotated to the *rebound* rather than the impact, so a
dead-on bait — the fight's central skill — drew the ball flattened on its inward
face; a shed Tuskling could be dropped inside the arena wall; the `drawBox` rework
of the boss HUD left the boss's name outside its own panel; a trample could land on
the frame the wall killed it; and the bake gate was measuring contrast against an
arena floor colour this same change had deleted.

## 8. `[HUMAN]` checks

- Does the ball read as "massive ball of fused pigs in evening wear" in game?
- Is baiting a head-on wall slam discoverable without being told?
- Is the wallow window long enough to matter and short enough to stay tense?
- Is contact damage at full momentum the right side of brutal? (The cat has ~6
  max HP; the human ~14 mid-game.)
- Walking the concourse: is it obvious the fight is optional?
- Is a level-15 ball at ~1000 HP a slog?
