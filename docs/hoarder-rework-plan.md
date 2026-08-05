# The Hoarder rework

Redraw the first boss, her cockroaches and her bile, and give the fight enough
teeth that it can actually be lost — without taking away the fact that it is
meant to be the easy one.

## 1. What is wrong today

**Art.** `src/images/bosses/hoarder.png` is hand-drawn cartoon art with no
generator behind it: a flat green t-shirt, a scribble of hair, five walk frames
and three vomit frames, two views (toward the camera and away — there is no
profile at all), and six gore pieces that are recoloured cut-outs of the same
figure. She reads as a chubby child, not as a fifteen-foot woman.

The cockroaches are not art at all — `Cockroach.drawSelf` draws two ellipses,
two line antennae and six straight line legs every frame.

The bile is two rows of flat `#2f4a1c` blobs, and the acid pool it leaves is a
1.2 × 0.55 tile ellipse drawn over a **2 tile radius** damage circle, so most of
what hurts the player is invisible.

**Fight.** Three things make it trivial:

- `MAX_COCKROACHES = 3`, and the roaches walk a straight A\* line at the player,
  which is a free magic-missile target.
- The Hoarder only ever spits bile **when the roach cap is already full**
  (`TheHoarder.updateAI` gates `vomit_windup` behind `cockroachAtCap`), and the
  roach TTL is 30 s. In a normal clear the acid never appears at all.
- A bile projectile that hits a player deals **zero** damage; the only harm is
  the puddle it drops, and the puddle is invisible.

## 2. Art plan

Three generated sheets, each on the standard four-file pipeline
(`<name>Art.ts` painter → `generate-<name>-sprite.ts` choreography →
`generate-<name>-sprite.gates.ts` bake gates → `render-<name>.ts` review
harness), gates wired to `npm run gen:<name>`.

### 2.1 The Hoarder — `src/images/bosses/hoarder.png`

Built on the `carlArt.ts` rig (view table, two-bone IK, FK arms, every pose an
edit to one resting pose), with obese-giant anatomy on top of it.

She stands **3.6 tiles** on screen against Carl's 1.46 — the 2.5× that fifteen
feet is against six. Height alone does not read as scale, so three other cues
carry it: a head only 1/8.3 of her height (a stylised game figure is ~1/4.8
_because_ it is meant to read as a person, and five heads reads as a toddler),
low-frequency detail, and a gait slow enough to look heavy.

The silhouette is built from a station table of (height, head-on half width,
profile forward reach, profile backward reach) rather than from one half-width
scaled per view — a profile built by scaling a single number gives a figure with
a belly and no backside. Two entries in that table carry the whole read: the
**bust**, which is a local maximum (without one the width climbs monotonically
from neck to belly and the outline is a traffic cone), and the **apron's widest
point sitting low** and hanging past the hips.

Silhouette, in the order it has to read at 32 px: a **bell** — sloping
shoulders, a bust shelf, a belly that is the widest thing about her, and an
apron of lower belly hanging past the hem of a filthy shift dress. Arms held out
from the body because her own bulk pushes them there; short thick legs; no neck,
just jowls into shoulders.

| Row | State                               | Frames |
| --- | ----------------------------------- | ------ |
| 0   | `walk` (toward camera)              | 12     |
| 1   | `walk_side`                         | 12     |
| 2   | `walk_back`                         | 12     |
| 3   | `vomit` (toward camera)             | 12     |
| 4   | `vomit_side`                        | 12     |
| 5   | `vomit_back`                        | 12     |
| 6   | `idle` 6 + `idle_side` 6            | 12     |
| 7   | `idle_back` 6 + the six gore pieces | 12     |

The vomit row is the fight's telegraph and gets the frames to sell it: a heave
that arches her back, a **bolus visibly travelling up the throat**, then the jaw
unhinging on the release frame. The projectile leaves on `VOMIT_RELEASE_FRAME`,
which the generator and `src/sprites/hoarderSprite.ts` both declare and a gate
holds equal.

Gore keeps the six existing state names (`gore_head`, `gore_right_arm`,
`gore_left_arm`, `gore_left_leg`, `gore_right_leg`, `gore_torso`) so
`BodyPartGoreSystem` needs no change, but the list moves out of that file into
`HOARDER_GORE_PARTS` in the sprite wrapper, where a bake gate can hold it equal
to the generator's `GORE_STATES` — the link that otherwise fails silently.
Pieces are painted through `goreWound.ts` (torn flesh, a yellow subcutaneous fat
layer, bone stump) rather than being cut-outs of the walk frame.

### 2.2 The cockroach — `src/images/enemies/cockroach.png`

A _Periplaneta americana_: glossy chestnut chitin, a pronotum shield with a pale
margin and a dark butterfly mark, tegmina lying flat over the abdomen, six spiny
legs and antennae longer than the body. It is drawn dorsally in all three
facings, because that is what you see of an animal that lies flat on the floor.

Rows: `skitter` / `skitter_side` / `skitter_back` (8), `idle` / `idle_side` /
`idle_back` (6, antennae sweeping), `bite` / `bite_side` / `bite_back` (8, a
rear-up and a lunge), and eight gore pieces (`gore_head`, `gore_pronotum`,
`gore_tegmen`, `gore_abdomen`, `gore_leg`, `gore_legpair`, `gore_thorax`,
`gore_cerci`). 144×144 cells, 1.66 Mpx.

This replaces `Cockroach.drawSelf`'s procedural drawing; `MOB_SPRITE_KEYS.cockroach`
goes from `[]` to `['cockroach']` and the key joins the `boss_hoarder` group.

### 2.3 The bile — `src/images/bosses/hoarder_bile.png` + `hoarder_acid.png`

Modelled on the `vespaSpitArt.ts` projectile/impact split, replacing the single
`hoarder_vomit.png`.

- **`hoarder_bile.png`** — `arc`, 8 frames. A tumbling chunky bolus, not a
  glowing orb: a translucent yellow-green envelope with solid chunks suspended
  in it, a stringy trailing drool, specular highlights on the wet surface, and a
  wobble that is only ever the same twice a cycle.
- **`hoarder_acid.png`** — `splash` (8), `form` (6), `pool` (8, the bubbling
  loop) and `fade` (6), in 300×300 cells. Drawn at `TILE_SIZE` the pool's ink
  reaches 63.9–72.6 game pixels against the 64-pixel damage radius, which a bake
  gate measures and enforces. That correspondence is the point of the redraw as
  much as the look is. The runtime picks the row by the pool's own age, so a
  pool spreads, boils and then sinks away leaving an etched stain, rather than
  looping one decal for its whole life.

Pool look: an irregular etched patch, not an ellipse — a dark corroded rim where
it eats the floor, a lighter caustic body, froth cells that pop on their own
phases, and thin steam wisps rising off it.

## 3. Fight plan

Still the easy fight. The changes give it a shape it does not currently have:
the roaches are the pressure, the acid is the terrain, and neither is free.

**Cockroaches.**

- Cap raised to **5** (`MAX_COCKROACHES`).
- Frantic movement replaces the straight line: a wandering heading jitter, random
  freezes and burst sprints (real roaches move in stop-start dashes), and a
  strafe component so they never approach on a stable bearing. This is what
  makes them hard to hit with a manually-aimed magic missile without making them
  hit harder.
- **Re-angling**: after a bite lands, a roach breaks off, arcs around the player
  and comes back in on a different bearing rather than sitting in the same spot
  waiting out its cooldown.
- They are still 4 HP and 1 damage. Nothing about the danger changes except how
  hard they are to remove.

**The Hoarder.**

- Bile moves to its **own timer**, independent of the roach cap, and fires far
  more often. The purge (roaches) and the bile (acid) are two attacks on two
  clocks, not one attack with a fallback.
- A direct bile hit does real, small damage instead of nothing, so the projectile
  is worth dodging on its own.
- Enraged she throws a three-shot spread instead of a single bolus.

**Acid.**

- `PUDDLE_TTL` drops from 6000 frames (100 s) to **1200** (20 s), because pools
  now arrive several times as often and at the old lifetime would simply
  accumulate until they owned the arena.
- The drawn pool is made to match `ACID_PUDDLE_RADIUS`.
- The per-player acid tick counters are reset by `resetForCheckpoint` along with
  the pools; left standing, a crawler respawning into a fresh pool took its
  first tick of damage on the frame they touched it.

## 3.1 The numbers as shipped

|                     | before                | after                                            |
| ------------------- | --------------------- | ------------------------------------------------ |
| `MAX_COCKROACHES`   | 3                     | 5                                                |
| bile cadence        | only at the roach cap | own timer, 210 frames (240 enraged, ×3 boluses)  |
| roach purge cadence | shared with the bile  | 300 frames (190 enraged), 90 to retry at the cap |
| direct bile hit     | 0 damage              | 2                                                |
| enraged bile        | one bolus             | a three-shot spread at ±20°                      |
| `PUDDLE_TTL`        | 6000                  | 1200                                             |
| roach aggro range   | 5 tiles               | 7                                                |

## 3.2 Follow-up after the first playtest (2026-08-05)

Two things the playtest found, both fixed:

**The acid walled the arena off.** Every pool was worth throwing, so she threw
them at whoever was nearest — which in a melee fight is someone standing on her,
and the pools landed on the only ground an attacker could stand on. Three rules
now decide where a bolus goes:

- She will not spit at a player inside `POINT_BLANK_TILES` (2), except once per
  `POINT_BLANK_ALLOWANCE_FRAMES` (1800, thirty seconds). Distant targets are
  preferred whether or not the allowance is up.
- She will not aim at ground already inside `PUDDLE_CROWDING_RADIUS` (2.5 tiles)
  of a live pool. `BossRoomSystem` owns the pools, so it hands her a bound probe
  (`isAcidCovered`) rather than the list. A pool already inside its fade does not
  count — by the time the bolus lands it is gone.
- A shot with no qualifying target is deferred by `VOMIT_RETRY_INTERVAL` (45),
  not spent, so stepping back out of her face is answered promptly.

The wind-up now tracks the player it was aimed at rather than re-picking the
nearest each frame, and only while that player still satisfies the rule that
picked them. Re-picking threw the choice away; following unconditionally let a
player walk into a pool, or into her face, during a telegraph long enough to
cross several tiles and have the fresh pool land there anyway.

Two more things kept the arena flooded in the fight's second half, both found by
arithmetic rather than by eye:

- Crowding is decided **where the bolus lands**, in `BossRoomSystem`, not where
  it was aimed. A bolus flies until a wall, a player or its lifetime stops it —
  up to ten tiles — and the enraged spread's flanks miss the target by
  construction and fly the whole way, so nothing at the throwing end can predict
  where a pool will come down. The first attempt at this checked a predicted
  landing point in `releaseBile` and was wrong by up to eight tiles.
- Three pools every two seconds against a twenty-second lifetime **demands
  thirty pools**. `VOMIT_INTERVAL_ENRAGED` went 120 → 240 — longer than the
  unenraged interval, because enraged it is the volley that grows — and
  `MAX_ACID_PUDDLES` 15 → 9, which is about a quarter of the room's floor
  instead of over half of it. The interval only sets the pace; what bounds the
  coverage is that pools cannot stack.

The pool's size, art, damage and lifetime are all untouched.

**The silhouette had corners in it.** Measured, the flesh outline was turning
inside 0.022 figure units — a radius of one and a half game pixels, which is a
crease, not a body. Three separate causes:

- The two lowest apron stations were listed 0.01 apart in height with 0.18
  between their widths, and in the wrong order: the spline had to double back.
- The heave and the belly swing were applied on a boolean, `station.y > WAIST_Y`.
  A boolean is a step, so a heave lifted one station by the full rise and left
  the one above it where it was. It is a smoothstep across bust→belly now.
- The spline was a **uniform** Catmull-Rom over **unevenly spaced** stations, so
  a station with a long gap above and a short one below got a tangent scaled for
  the long gap: the control point landed past the next station. It is centripetal
  now, which is the standard cure and provably cusp-free.

Tightest turn on the outline went from 0.0217 to 0.1194 figure units, and G14
holds the line at 0.1.

A blind image review of the rebaked sheet then found three more, all fixed:

- A **two-pixel spur off her back edge in every side frame**. The trouser
  waistband's ellipse was wider than the small of her back, so its own widest
  point reached past the flesh outline. The band is gone: it sat a third of a
  tile above the apron's hem and the flesh is painted after the trousers, so
  apart from that spur it had never rendered a single pixel.
- The **clothed torso was a straight-sided cone** — the mid-torso stations were
  fractionally _concave_ against the shoulder-to-belly chord. Raised until the
  run is convex the whole way down.
- The **belly folds sagged 2% of their own span**, which is a straight line. A
  crease's `sag` is a quadratic _control_ offset, so the drawn drop was half of
  the authored number; the sags are roughly doubled.

Two of its findings were left alone deliberately: the hands overhang the
silhouette (that spread was tuned by an earlier round — tucked in, the forearm
disappears into the belly), and the trousers sit at luminance 45 against a belly
at 176, which is [[a-near-black-creature-needs-a-rim]] territory and wants
measuring against the actual floor rather than the harness background.

## 3.3 Second playtest (2026-08-05)

**She opened fire before the party was in the room.** Her aggro ring is ten
tiles and it reaches straight out through her own doorway, so she was spitting
across the threshold and pooling acid over the entrance — which the player could
walk through and the companion AI would not. `MobUpdateLoop` now hands a boss
**no targets at all** while nobody has entered its room
(`BossRoomSystem.sharesRoomWithPlayer`, which unlike `isAnyPlayerInBossRoom` does
not require the room to be locked, because the question is about the moment
before the fight). Un-forcing `forceAggro` was never enough on its own: her own
range was doing the work.

**Pools still stacked where she stood.** Three rules now, instead of one:

- Nothing forms within `HOARDER_CLEAR_TILES` (3) of a living Hoarder. Whatever
  else is on the floor, the ground she is standing on stays walkable — a boss who
  backs into a corner was spitting a moat around herself.
- `PUDDLE_CROWDING_TILES` 2.5 → **4**, which is exactly tangent for two pools of
  `ACID_PUDDLE_RADIUS`: they can no longer overlap at all. At 2.5 a run of them
  across an approach was still a wall.
- `MAX_ACID_PUDDLES` 9 → **6**, about a fifth of the room.

Crowding and "standing in acid" are two different questions and now have two
different probes. They shared one, so at the widened radius she was declining to
spit at anyone within four tiles of any pool — most of the room she fights in.

**The gore was cartoonish, and every piece was a different size.** Each one's
dimensions were hand-set literals that drifted from the figure independently:
measured against the anatomy the arms were about four fifths of life, the legs
and the torso under a half, and the head — while `HEADS_TALL` went 5.6 → 7.4 →
8.3 chasing "she reads as a toddler" — **2.4× her skull across and 1.8× down**.
The sheet also drew gore at 2.2 against the figure's 1.5, so even a piece
measured correctly rendered half again as big as the part it came off.

Every piece is derived from `hoarderArt` now — widths, bone lengths and the head
— and `GORE_PIECE_SCALE` equals `HOARDER_SCALE`, so "life-size" means life-size
and one number moves them all. Two shape bugs fell out of the derivation: the
severed leg was 2.2:1 root to tip where her leg is 6.4:1 (a near-uniform column
whose femur stump was drawn wider than the thigh it came out of), and it is torn
mid-thigh rather than at the hip, because at the hip's full width the piece is a
cone with a foot on it. The right leg had to straighten as well — at anatomical
bone lengths it and the folded arm were the same comma, and G7 said so.

**The head's face, specifically.** Two more cartoon tells went with the size: white sclerae with
black dot pupils (the loudest mark on a nine-pixel piece, and two of them side by
side is a cartoon face) became sunken sockets under a heavy lid, and the mouth's
three ivory teeth — one white block wider than an eye — became a slack gape with
a lip shadow. The hair hanks were halved in length and widened; thin and long,
they stood off the crown as a ring of spikes.

## 3.4 Third playtest (2026-08-05)

**"When she dies, everything including her body parts disappears."** Two causes,
both real:

- The defeat branch in `BossRoomSystem` **emptied the room in one frame**: every
  acid pool spliced out of the list, every bolus still in the air deleted, the
  cockroaches killed instantly. Nothing is cleaned up now. The pools fade on
  their own clock, a bolus in flight lands and leaves one more, and the swarm
  dies through `justDied` — the ordinary death, with gore and rewards.
- A mob killed by a **status tick** — burn, poison, an acid pool — never set
  `justDied`. `Player.takeDamage` writes hp and nothing else, and `Mob` did not
  override it, so anything finished by damage-over-time hit zero with no death
  event: no gore, no loot, no XP, and a nought-HP body left in `mobs` and in the
  mob grid. `Mob.takeDamage` now resolves the death like any other. This is a
  game-wide fix, not a Hoarder one — it is the long-standing gotcha this repo
  had recorded and only ever worked around for the Ball of Swine. The kill is
  unattributed (`killedBy` and `killType` both null), which every consumer of
  `killType` already reads as "not killed by a blow".

That second fix was incomplete on its own: `CombatSystem`'s kill loop bailed on
`if (totalDmg === 0) continue` **before** emitting `mobKilled`, so setting
`justDied` got the body out of the grid and still produced no gore. Only the XP
split needs a damage ledger; the death does not. Two knock-ons came out of that:
a cockroach that merely ran out of TTL was being marked `justDied` to despawn it
and would now have sprayed gore and counted as a kill (it is despawned without
the flag), and the swarm-compaction pass had to learn not to drop a death the
kill resolver has not seen yet.

Known and unclosed: an **unattributed kill drops no loot**, because
`DungeonScene` partitions loot by top damage dealer and there is not one. That
predates this work but is more reachable now — the Hoarder finished by a status
tick would lose her guaranteed Cockroach book. Closing it honestly means status
effects remembering who applied them.

## 4. Gates

Beyond the standard border-clip / anchor / loop-closure / motion-continuity /
centroid-drift / texture-size set, the ones specific to this work:

- **Reach headroom** on every walk frame of every view — a giant's leg is short
  relative to her hip height and a clamped frame reads as a hop.
- **Foot slide** on the planted foot.
- **Release is the peak**: the declared bile release frame is the extreme of the
  vomit choreography, in all three views.
- **Gore contract**: generator `GORE_STATES` equals the runtime
  `HOARDER_GORE_PARTS` / `COCKROACH_GORE_PARTS`, in order.
- **Gore distinctness + legibility** at the 0.5× the runtime draws them.
- **Pool footprint**: the baked `pool` frames' ink radius, converted to game
  pixels at `TILE_SIZE`, is within tolerance of `ACID_PUDDLE_RADIUS`. This is
  the gate that stops the invisible-damage bug coming back.
- **Silhouette curvature** (G14): the tightest turn radius on the traced flesh
  outline, over every frame of every posed row. A body has no corners, and the
  station table that produces them looks perfectly reasonable in the source.
- **Antenna reach** on the roach: the antennae are most of what makes the
  silhouette an insect, and they are the first thing a frame-size change clips.

## 5. Notes for Ryan's playtest

Everything below is invisible to typecheck, lint, the bake gates and a still
image, and is left as an assumption to verify at the keyboard.

- Does she read as fifteen feet tall in the room, next to Carl and next
  to the door frames?
- Gait: does she plant and lumber, or float?
- Is the vomit telegraph readable in time to walk out of the line?
- Are five frantic roaches actually annoying to hit with magic missile,
  or merely annoying?
- Is the fight still winnable-on-a-first-try easy, and does the acid now
  come up often enough to matter without walling off the arena?
- Health bar and aggro marker placement on the new (much taller) anchor.
- Frame rate with five roaches, several pools and the bile in flight.
- Is there always a lane to walk in on her now, and does the acid still
  threaten a ranged fight rather than merely decorating it?
- Does she now stay put until the party is actually in the room, and does
  the companion path in without balking?
- Does the gore read as a body at tile size, or still as a cartoon?
- Does her death now leave a mess behind — six pieces, the pools still
  fading, the roaches dying where they stood?
- Does the once-per-thirty-seconds point-blank spit still land often
  enough to punish standing in her face?

`npm run playtest -- hoarder` drops the party in the safe room immediately
before her, which is the fastest way to reach all of the above.
