# Bounty Boss — The Evil Clown

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry, and specifically
its C4 `GroundHazardSource` interface); art phases are independent.

**Status: IMPLEMENTED — awaiting Ryan's playtest**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `bipedal-figure` (he is a biped — full rig/pose contract and
image-review loop), `add-sound`.

## Concept

A **horrible giant clown** — genuinely unsettling, not slapstick: too tall,
wrong proportions, fixed grin, stained ruff. He is accompanied by clowns from
the _Show Must Go On_ quest line (reused as-is, zero new minion art).

Signature mechanic — **vial juggling**: every so often he stops chasing, laughs,
and wanders while juggling glass vials. While juggling he lobs vials around the
battlefield; each shatters into a lingering **gas cloud** that damages any
player standing in it. The AI companion avoids the clouds exactly like the
hoarder's acid pools.

## Names (5–10, shuffled by the core system)

```
'Giggles', 'Honk', 'Jangles', 'Grinner', 'Sniggles', 'Tumbles', 'Bubbles', 'Mister Merriment'
```

## Art

He shares the species with the existing clowns, so **extend the existing rig**:
a new style in the `scripts/clownArt.ts` engine (the same route
`generate-clown-sprites.ts` uses for fat/stilt/terror styles) rather than a new
art module — one skeletal rig is why clown limbs stay attached. If the giant's
proportions break the rig's assumptions (very long limbs, huge head), extend
the engine; do not fork it. Known rig gotchas apply: radial-gradient glow only
(never `shadowBlur`), ~6px frame-edge margin so shoes don't clip, oversized art
needs `cullMarginTiles` (Terror uses 3; the giant will need more).

Sheet: `evil_clown.png`, baked by the existing clown generator run
(`generate-clown-sprites.ts` gains the style + sheet spec). Target height ≈3
tiles of art.

Per Ryan, each view/animation is its own independent task:

- [x] **C-A1. Style + toward-camera set.** Giant palette/proportions in
      `clownArt.ts`; rows `walk`, `idle` (toward). The grin and eye treatment
      carry the horror — iterate on the head painter until the contact sheet is
      actually unsettling at review scale AND still reads at 32px.
- [x] **C-A2. Away set.** `walk_away`, `idle_away` — the back of the head/ruff,
      hunched shoulders.
- [x] **C-A3. Side set.** `walk_side`, `idle_side` (ctx-flip for the mirror).
- [x] **C-A4. Attack + juggle rows.** - `swipe` × toward/side/away — his basic melee (long-arm backhand). - `laugh` (one-shot, shoulders heaving, head thrown back) — the tell that
      juggling is coming. - `juggle_walk` × toward/side/away — walking loop with 3 vials cycling
      through the air above his hands; the vials are drawn IN the rows (they
      are part of the pose), but the **thrown** vial is a separate effect
      sprite (C-A5).
- [x] **C-A5. Effects sheet: vial + gas.** `scripts/` bake to
      `src/images/effects/` (lava-ball precedent: `gen:lava-ball` →
      `evil_clown_vial` spinning-throw frames, `evil_clown_gas` cloud loop —
      billowing sickly green-yellow, semi-transparent, 6–8 frame loop, plus a
      `shatter` burst). Remember node-canvas rejects exponent-notation alpha
      (memory gotcha) — clamp tiny computed alphas.
- [x] **C-A6. Gore row.** Shared `goreWound.ts` pieces: oversized shoes, ruff,
      head (grin intact — worst part), gloved hands, torso; register
      `EVIL_CLOWN_GORE_PARTS` + body-part key in `BodyPartGoreSystem`.
- [x] **C-A7. Harness + preview.** Extend `scripts/render-clowns.ts` with
      `--clown=evil` (it already takes a clown flag), `?evilclown` preview
      route.
- [x] Review loop on the final sheets (reviewer sees PNGs)

## Creature behavior

- [x] **C-B1. `EvilClown`** (`src/creatures/EvilClown.ts`): state machine
      `idle → pursuing → swipe → laugh → juggling → cooldown`. - Pursuit + swipe: standard melee boss baseline (Terror's windup/swing
      shape is the reference; slower but heavier). - Juggle cycle: on cooldown (e.g. every 10–16 s, named constants) he
      stops, plays `laugh` (with sound), then `juggling` for ~5 s: wanders
      (doWander-style meander, does not chase), and every ~0.8 s queues a
      **vial throw** at a random point within ~5 tiles of himself, biased
      toward players' current positions (some aimed, some scattered — the
      battlefield should fill unevenly). - `requiresEvasion` true while juggling (companion keeps distance).
- [x] **C-B2. `ClownGasSystem`** (`src/systems/ClownGasSystem.ts`) — the
      projectile AND hazard owner, system-owned per the LavaBallSystem rule
      (vials must survive the clown's death mid-throw): - Drains `takePendingVials()` from any `EvilClown` each frame. - Vial flight: lobbed arc (visual-only height offset like dynamite),
      shatter on landing → push a `GasCloud { x, y, ttl }`. - Clouds: radius ~1.5 tiles, TTL ~8 s, damage tick to players inside
      every 20 frames (AcidPuddle constants are the reference; environmental
      `DamageSource` like `lavaFlames` since the clown may be dead), cap on
      simultaneous clouds (e.g. 12) — oldest expires first. - Implements **`GroundHazardSource`** (core plan C4) and registers with
      `CompanionSystem` so the follower flees clouds like acid. - Render clouds under entities (renderGround-adjacent slot), vials in the
      Y-sorted pass; drain `*SoundPending` flags for shatter/gas.
- [x] **C-B3. Spawn composition** (`BountyDef.spawn`): boss + 2 `StiltClown` +
      2 `FatClown` (existing classes, zero new art; both already registered in
      `spawner.ts`). Optionally 1 `CircusLemur` for chaos — decide at
      implementation, journal it. Def id `'evil_clown'`, `typeLabel: 'the Evil
  Clown'`. Delete `debug_ghoul` placeholder if still present.
- [x] **C-B4. Loot + XP** per core plan C5 convention; boss-tier `xpValue`.
- [x] Validation gates + review loop after each of B1–B4

## Sounds ([HUMAN] sourcing)

| Proposed SoundId          | Ideal sound                              | Trigger                                                                       |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `evil_clown_laugh`        | deep, slow, distorted clown laugh, 2–3 s | laugh state                                                                   |
| `evil_clown_giggle`       | quiet broken giggle                      | idle proximity                                                                |
| `evil_clown_vial_throw`   | glass whoosh/tink                        | vial release                                                                  |
| `evil_clown_vial_shatter` | glass shatter + hiss onset               | vial landing                                                                  |
| `evil_clown_gas`          | sustained toxic hiss (loopable)          | cloud active (nearest-cloud emitter, like the river `AmbientEmitter` pattern) |
| `evil_clown_death`        | laugh collapsing into a wet gurgle       | death                                                                         |

Existing clown ids in `sounds.ts` may cover swipe/damage — check before adding.
Add `audioTag: 'evil_clown'` + case arms in `playMobAudioCues`. Boss music:
`boss_music_3` default unless Ryan sources a carnival-horror track (journal it).

- [x] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [x] Registered in `BOUNTY_DEFS`; full `!bounty` loop (issue → arrow → fight:
      laugh tell → juggling wander → clouds spawn, damage players inside,
      companion visibly avoids them → kill → collect)
- [x] Clouds persist and keep damaging after the clown dies mid-juggle
- [x] Fog: boss immune + toast; stilt/fat clowns confused
- [x] Town lure: whole troupe follows into town, stays aggressive
- [ ] **[HUMAN]** Ryan playtests: gas damage/visual clarity, juggle cadence, how
      scary the art actually is
- [x] Final review loop: round 3 returned zero genuine findings (see Journal)

## Journal

- 2026-08-02 — Plan written; not started.

- 2026-08-02 — **Implemented end to end by Claude.** Everything except the two
  `[HUMAN]` playtest lines is done; the sheets, the creature, the gas system and
  the bounty registration are all in and both validation gates pass on every
  file this session touched.

  **Art — the rig was extended, not forked (C-A1…C-A4).** `scripts/clownArt.ts`
  had no concept of a viewpoint: all three existing clowns are one three-quarter
  figure drawn facing +X and mirrored at runtime. Rather than fork it, the
  engine gained an optional `ClownView = 'profile' | 'toward' | 'away'` argument
  on `drawClown`, defaulting to `'profile'`. The skeleton is untouched — a
  head-on figure's "near" limb is simply its right one — so only four things
  branch: the head painter (`drawHeadToward` / `drawHeadAway` beside the
  original, now `drawHeadProfile`), the depth shading (both limbs equally lit
  and the torso lit down the middle instead of across), the way a spine lean
  foreshortens instead of rotating, and the shoe (a dedicated end-on blob;
  rotating the profile shoe 90° reads as a foot dangling in mid-air).
  **Gate: the fat/stilt/terror PNGs re-bake byte-identical** (sha1 checked after
  every engine edit) — that is what "extend, do not fork" was verified to mean.
  Three additive optional style knobs were needed and all default to the old
  behaviour: `HairStyle 'lank'`, `MouthStyle 'rictus'`, `FacePaintStyle
'sockets'`, plus `ClownStyle.ruffRise` and `ClownStyle.face`
  (`eyeScale`/`noseScale`/`mouthDrop`) — the shared face layout is tuned for a
  clown whose head is a prop, and a frightening one needs a smaller nose and a
  lower grin on the same skull.

  Sheet `evil_clown.png`: 14 rows × 272×296 px cells, `tileX=104 tileY=204
tileScale=64`, `cullMarginTiles = 5`. Rows are walk/idle/swipe × three views,
  a toward-only `laugh`, `juggle_walk` × three views, and a gore row. Manifest
  entry hand-pasted. A new **edge-bleed bake gate** was added to
  `generate-clown-sprites.ts` (all four clowns) and immediately earned its keep:
  it caught `swipe_side` frame 5 clipping the cell wall, which is why the frame
  is 272 wide and not the 224 first chosen.

  **Image review (four rounds, contact sheet read each time).** R1: face was a
  grey smudge with invisible eyes, a shark grin that swallowed the head, and a
  white mitre-shaped gap on the back of the skull. R2: fixed the sockets to hard
  pits and shrank the grin — face now legible but read as _googly-eyed and
  comic_, plus the ruff sat on the chest like a platter and the away view was a
  bare white dome. R3: narrowed and heightened the sockets, shrank the eyes,
  darkened the nose, added a hair cap to the back of the head, raised the ruff
  under the jaw (`ruffRise`), suppressed the brows for socket faces (a brow over
  a hollow is an _expression_, and the point of the hollow is that there is
  none), and made the teeth ragged rather than even (even teeth read as
  dentures, and dentures are funny). R4: the juggled vials were invisible —
  lost among the arms — so the cascade apex was raised above the head, the
  vials enlarged and given a dark outline (they cross his own white face), and
  the cell grew to 296 tall. Final read: pale head + pale ruff on a dark column,
  legible at 32 px, unsettling at review scale.

  **Gore (C-A6).** `scripts/clownGore.ts`, six pieces through the shared
  `goreWound.ts` cut engine, chosen for silhouette: head (grin intact — the
  worst one), ruff, harlequin torso, arm ending in a white glove, oversized
  shoe, and a fistful of cracked vials still venting. `EVIL_CLOWN_GORE_PARTS` in
  `src/sprites/evilClownSprite.ts` is the single order of truth, registered in
  `BodyPartGoreSystem`.

  **Effects (C-A5).** `scripts/clownGasArt.ts` + `generate-clown-gas-sprites.ts`
  (`npm run gen:clown-gas`), lava-ball precedent: `evil_clown_vial` (8-frame
  tumble with a gas trail), `evil_clown_shatter` (10-frame one-shot),
  `evil_clown_gas` (8-frame billow, ~1.5-tile radius). All alphas route through
  a `alpha()` helper that **clamps anything below 0.004 to zero** — the
  node-canvas exponent-notation trap — and a bake gate (`G3`) fails the run if
  the cloud is ever fully opaque, which is that bug's signature. Manifest
  entries hand-pasted; the generator verifies rather than rewrites the shared
  effects manifest.

  **Creature (C-B1).** `src/creatures/EvilClown.ts`, phases
  `hunting → laughing → juggling → hunting`. 150 HP, speed 0.85, 2.3-tile reach
  (his arms hang below his knees), 16 damage on a backhand with the hit landing
  on the sheet's contact frame. Juggle fires every 10–16 s (randomised so the
  cadence never locks in) when a player is within 14 tiles: ~1.7 s of `laugh`
  with the sound cue, then ~5 s of meander throwing a vial every 0.8 s, 55 %
  aimed-with-jitter and the rest scattered over a 5-tile disc with a
  square-rooted radius so throws spread evenly rather than clustering.
  `requiresEvasion` is true only while juggling. Per the mid-session correction
  from the core-system review, the **idle-no-target branch calls
  `returnHomeOrWander()`** so BountySystem's pre-aggro site leash is honoured;
  the juggling meander deliberately uses plain `doWander()` because by then the
  leash is gone and the point is to spread gas across wherever the fight got to.

  **System (C-B2).** `src/systems/ClownGasSystem.ts`, modelled on
  `LavaBallSystem` including its header rationale. The clown queues
  `PendingVial` records and the system drains them with `takePendingVials()`,
  walking the **full** mob list (a clown who throws and dies on the same frame
  is skipped by every activation-radius query from the next frame on, and his
  bottle would be stranded forever). Vials fly a fixed 38-frame lob whose height
  is screen-space only, so the landing point never moves; a bottle aimed into a
  wall falls short at the thrower's tile rather than gassing unreachable ground.
  Clouds: 1.5-tile radius, 8 s TTL, 1 damage every 20 frames, cap 12
  oldest-first, environmental `DamageSource` `{ hazard: 'clownGas' }` (so it is
  undodgeable and survives the clown's death). Implements `GroundHazardSource`
  and is registered with `CompanionSystem` next to `bossRoom` in DungeonScene.
  Clouds render in the ground pass, bottles and shatters in the over-entity
  pass. `resetForCheckpoint()` clears everything.

  **Death screen.** `DamageSource.hazard` gained `'clownGas'`, and
  `DeathCause` gained `'clownGas'` + `'evilClown'` with explanation lines —
  without this the contact damage reported "a burning tree".

  **Deviations, and why.**
  - _The `CircusLemur` was included_ (C-B3 left it optional). The escort is 2
    StiltClown + 2 FatClown + 1 CircusLemur. Reason: every other member is
    melee, and without a ranged threat the whole encounter can be kited in a
    circle around the gas clouds, which defeats the mechanic the fight is built
    on. Zero new art either way.
  - _`debug_ghoul` was NOT deleted_, despite the plan's instruction. Another
    session is still relying on it as a bounty-loop stand-in; the coordinator
    asked for it to stay. It should be removed by whichever creature file lands
    last.
  - _The laugh row is toward-view only._ It is a telegraph the player has to
    read, and a telegraph seen from behind is not one; the sprite wrapper never
    mirrors it.
  - _`evil_clown` was also registered in `spawner.ts` / `types.ts`_ even though
    only the bounty path constructs him, so `!spawn`-style debugging works.

  **Sounds — all stand-ins, nothing new added ([HUMAN] sourcing still open).**
  Ryan has not sourced the six proposed ids, so no mp3s were added. Substitutions
  wired against `audioTag: 'evil_clown'`:
  | Proposed id | Stand-in used | Where |
  | --- | --- | --- |
  | `evil_clown_laugh` | `clown_laughing_1` / `clown_laughing_2` (random) | `specialSoundPending`, `playMobAudioCues` |
  | swipe / melee | `clown_horn` | `attackSoundPending`, `playMobAudioCues` |
  | `evil_clown_vial_throw` | `juicer_throw` | `projectileSoundPending`, `playMobAudioCues` |
  | `evil_clown_vial_shatter` | `grotesque_spider_spit_landing` | `ClownGasSystem.shatterSoundPending`, drained in DungeonScene |
  | `evil_clown_giggle` | _(none — idle proximity giggle not implemented)_ | — |
  | `evil_clown_gas` | _(none — no sustained hiss exists; the nearest-cloud ambient emitter was **not** built)_ | — |
  | `evil_clown_death` | _(none — generic mob death only)_ | — |
  Boss music is the default `boss_music_3` via the existing
  `bossFightInitiated` ternary; no carnival-horror track was sourced, so nothing
  was changed there.

  **Harnesses.** `npx tsx scripts/render-clowns.ts --clown=evil` for the contact
  sheet, `?evilclown` (`src/scenes/EvilClownPreviewScene.ts`) for playback —
  all three views × five rows on a grid, plus a strip playing the vial, the
  shatter and two differently-seeded clouds, and a "kill" button that fires the
  real `BodyPartGoreSystem`. `npm run gen:clowns` and `npm run gen:clown-gas`
  added to package.json.

  **Still open:** Ryan's playtest of gas damage/visual clarity, juggle cadence
  and how scary the art actually reads in motion; and the real sounds.

- 2026-08-02 — **Review rounds.** Two self-caught defects before the first
  independent round: the `juggle_walk` row was riding `walkFrame`, which
  `Player` zeroes the moment a mob stops — so the three vials snapped back to
  the start of their arc every time the meander paused (fixed with a dedicated
  `juggleCycle` that never stops while juggling); and `faceToward` was being
  called every frame including while pathing, which crabs him sideways round any
  obstacle (now `!isMoving` only, matching Terror).

  **Round 1 (independent agent, fresh context)** returned 8 genuine findings, all
  fixed:
  1. Aimed throws had no distance clamp — `forceAggro` hands the clown a target
     at any range, so a bottle could be lobbed ~14 tiles on the same fixed
     38-frame flight and lay gas most of a screen from the fight. Added
     `clampToDisc()`, so aimed and scattered throws share the 5-tile disc.
  2. The bottle left his collision-box centre, i.e. his shoes, then jumped two
     tiles up on the next frame. `PendingVial` now carries `releaseHeightPx`
     (1.25 tiles, matching `JUGGLE_HAND_DROP`) which decays to zero over the
     flight, on top of the arc.
  3. Cloud contact damage only ticked `human` and `cat`, while the vial _impact_
     already hit `extraTargets` — so a summon could stand in gas forever. The
     two counters became a `Map<Player, number>` and the cloud now ticks
     everything `targetsFor()` returns.
  4. `debug_ghoul` was still in `BOUNTY_DEFS` despite C-B3 saying to delete it.
     **Dismissed as out of scope, deliberately:** the core system's `!bounty`
     harness and other in-flight creature sessions still use it, and the
     coordinator asked for it to stay. Whichever creature file lands last should
     remove it.
  5. The vial impact carried no `attackType`, so a death by thrown bottle
     printed the melee line "backhanded you across the wilderness". Added
     `VIAL_ATTACK_TYPE`, a `DeathCause` of `evilClownVial`, its own explanation
     lines and the `DeathCauseSystem` branch (which imports the constant rather
     than re-typing the literal).
  6. `EVIL_CLOWN_IDLE_LOOP_SECONDS` had a bare `6` in the one file whose own
     `frameCountOf` exists to forbid hand-copied counts. Named
     `IDLE_ROW_FRAMES`, with a comment explaining why this one cannot go through
     the manifest (it is a module constant read before `loadSprites()` runs).
  7. `clownGasSprite.ts` hardcoded all three sheets' frame counts; it now reads
     them from the loaded manifest like `evilClownSprite` does. `ClownGasSystem`
     also had a `SHATTER_FRAMES` that was a _lifetime_, colliding in name with
     the sheet's frame count — renamed `SHATTER_LIFETIME_FRAMES`.
  8. `evilLaughPose` had bare `0.25` / `0.75` window literals while the swipe in
     the same file named its equivalents — now `LAUGH_RISE_END` /
     `LAUGH_FALL_START`.

  Also **dismissed**: flat (unscaled) cloud damage, which matches the acid-puddle
  precedent exactly and is Ryan's tuning call; and the `JUGGLE_TRIGGER_RANGE >
AGGRO_RANGE` gap, which is correct under `forceAggro` and now carries a comment
  saying so. The reviewer's one unverified item — whether the new edge-bleed
  gate passes the three legacy clown sheets — was confirmed: `npm run gen:clowns`
  runs clean and all three legacy PNGs re-bake byte-identical (sha1).

- 2026-08-02 — **Round 2 (confirming round, fresh independent agent).** Three of
  its four findings were _inside_ round 1's fixes, which is exactly why the
  protocol demands the round:
  1. The release-height fix measured from the wrong datum.
     `VIAL_RELEASE_HEIGHT_TILES` was 1.25 "above the ground he stands on", but
     it is applied to `fromY = this.y + tileSize * CENTER_OFFSET` — the _centre_
     of his collision box, half a tile above his feet — so the bottle left from
     empty air above his hands. Re-derived from the rig: hands sit 1.415 tiles
     above the feet (`shoulderHeight` 2.036 − `EVIL_ARM_LENGTH * JUGGLE_HAND_DROP`),
     so the offset from the collision centre is 0.915. Constant corrected and
     the JSDoc rewritten to state the datum and show the derivation (the old one
     also claimed to "match `JUGGLE_HAND_DROP`", which is a fraction of arm
     length, not a tile count).
  2. The `Map<Player, number>` from fix 3 could grow forever, contradicting its
     own comment: entries are only dropped by `tickContactFor`, which only visits
     victims still in `extraTargets` — and `MongoSystem`/`MercenarySystem` splice
     their charges out on recall or death. A pet recalled while standing in gas
     pinned its whole `Player` for the life of the scene, once per summon, on a
     spammable toggle. Now a `WeakMap`, with `resetForCheckpoint` reassigning a
     fresh one (a `WeakMap` has no `clear`).
  3. The release-height edit left both the old and the new comment stacked on the
     same two lines of `render()`. Merged into one accurate comment.
  4. (Not inside a fix.) `gateManifest` ran _after_ `writeFileSync` in
     `generate-clown-gas-sprites.ts`, so a sheet whose geometry had drifted from
     the manifest was already on disk when the run reported failure — directly
     contradicting the "gated before anything reaches disk" comment above it.
     Moved above the write loop with an early return.

  Round 2 independently confirmed as correct: `clampToDisc` (including that
  jitter is applied before the clamp, so long-range aimed throws still spread);
  the `DeathCauseSystem` arm ordering; `IDLE_ROW_FRAMES` against a fresh bake;
  the generic `frameCountOf`; both new comments' factual claims (`forceAggro`
  really does bypass range in `Mob.acquireTarget`); every contract
  (`spawn` constructs + `setMap()` only, `collectThrows` walks the full mob list
  so a throw released on the death frame survives, `GroundHazardSource`
  registered, `returnHomeOrWander()` in the idle branch); the `swipeConnected`
  latch; `MAX_CLOUDS` dropping the oldest; gore order matching the manifest's
  `colOffset` 0–5; and effect-sheet cell-centre anchors versus the clown's
  tile-top-left anchor.

- 2026-08-02 — **Round 3 (clean round): zero genuine findings.** The reviewer
  independently re-derived the 0.915 release height from the rig
  (`groundedHipHeight` 1.1764 → `shoulderHeight` 2.0364, less
  `EVIL_ARM_LENGTH * JUGGLE_HAND_DROP` 0.6215 = 1.4149 above the feet, less the
  0.5-tile collision-centre offset) and confirmed it, including that the sheet's
  ground line really is `this.y + tileSize` (`tileY = groundY − TILE_SCALE = 204`
  matches the manifest, and `drawSprite` anchors the frame's `(tileX, tileY)` at
  the mob's tile top-left). It also confirmed the WeakMap conversion is
  behaviour-identical, the merged render comment is accurate, and the moved
  manifest gate genuinely blocks the write. Contracts, sheet geometry, gore
  order and CLAUDE.md compliance all re-verified.

  Three of its five nits were latent traps rather than style, so they were
  fixed anyway (the fourth and fifth — a one-frame throw-interval rounding and
  the deliberate instant first tick of cloud damage — were left alone):
  - `jitter()` in `clownGasArt.ts` used `x % 1`, which keeps the sign of its
    left operand and so returned (−1, 1) despite its name and every call site
    assuming [0, 1). Harmless today but a trap for the next reuse. Fixed with
    `Math.abs` and named constants; the re-baked effect sheets were re-reviewed
    as an image and are unchanged in quality.
  - `generate-clown-sprites.ts` had **no manifest gate** — the asymmetry the gas
    generator's fix D exposed. An evil-clown row change would have silently
    rendered garbage. It now has one, modelled on the gas generator's, running
    before any write; a gore row expands to one `colOffset` state per piece. It
    passes for all four sheets, which independently re-verifies that the
    hand-pasted `evil_clown` entry is correct.
  - That gate is fed by `EVIL_CLOWN_GORE_PIECES[].name`, which was previously
    read by nothing while the module header claimed a rename would be caught.
    The claim is now true, and both doc comments were rewritten to describe the
    enforcement that actually exists.

  Final state: `npm run typecheck`, `npm run lint`, `npm run format` and
  `npm run build` all clean for every file this session touched; all four clown
  sheets and the three effect sheets re-bake through their gates, with the three
  legacy clown PNGs byte-identical (sha1).
