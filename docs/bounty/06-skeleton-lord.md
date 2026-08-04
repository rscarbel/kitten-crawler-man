# Bounty Boss — The Skeleton Lord

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry + C3 telegraph
helpers); art phases are independent. This is the biggest art file: the boss
**plus two warrior minion types**, all from scratch — there is no skeleton or
undead art anywhere in the codebase (verified; the only "skeleton" outside the
human rig is the cosmetic club DJ in `clubNpcSprite.ts`).

**Status: IMPLEMENTED — [HUMAN] playtest outstanding**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `bipedal-figure` (skeletons are bipeds — the rig contract is what
keeps bones articulating believably), `add-sound`.

## Concept

A **magic skeleton lord** — robed, crowned or horned, green witch-light in the
eye sockets and between the ribs. Two attacks:

1. **Soul bolts** — summons green balls of magic that fly at the player
   (projectiles, system-owned).
2. **Grasping hands** — a wave of skeletal hands erupts from the ground in a
   **cone** from him toward the player. Red cone telegraph
   (`drawDangerCone` from the core plan) with _just_ enough warning to get out.

He is escorted by **skeleton warriors**: at spawn, two with swords and one with
a bow. Periodically he **summons reinforcements** — raises both hands, and two
more sword skeletons plus one bow skeleton climb up out of the ground.

## Names (5–10, shuffled by the core system)

```
'Marrow', 'Ossian', 'Rattlejack', 'Gravelow', 'Hollowcrown', 'Knuckles', 'Dustwight', 'Phalanx'
```

## Art

One art module (`scripts/skeletonArt.ts`) drawing **three variants** from one
bone engine (the goblin multi-sheet precedent): `skeleton_lord` (robed, ≈2.5
tiles, staff or bare clawed hands), `skeleton_sword` (≈1.5 tiles, notched
sword + scrap shield), `skeleton_archer` (≈1.5 tiles, bow + quiver).

Bone-believability notes (candidate bake gates): a skeleton reads as bones only
if the **gaps** read — negative space between ribs, between radius/ulna, at the
knee joint; joints are knobs (condyles), not smooth bends; the pelvis and
ribcage are the two big masses, connected by a visible spine; skulls need the
dark orbital/nasal triangle. The club DJ's bone-white palette
(`clubNpcSprite.ts` skeleton branch) is a color reference only, not a rig.
Green witch-light (radial gradients, never shadowBlur) is the lord's signature
and the family resemblance across all three.

Per Ryan, each view/animation is its own independent task:

- [x] **S-A1. Bone engine + lord toward set.** `scripts/skeletonArt.ts` +
      `scripts/generate-skeleton-sprites.ts` (`npm run gen:skeletons`). Lord
      rows `walk`, `idle` (toward) — drifting, robe-swaying, ribs glowing;
      idle timeFrameIndex-driven.
- [x] **S-A2. Lord away set.** `walk_away`, `idle_away`.
- [x] **S-A3. Lord side set.** `walk_side`, `idle_side` (ctx-flip mirror).
- [x] **S-A4. Lord attack rows.** - `cast` × toward/side/away — one arm thrust, green orb condensing at
      the palm; the bolt release frame is a **shared timing constant** in
      `src/sprites/` imported by the generator (the llama spit-timing
      pattern; do not re-declare release fractions). - `hands_cast` × toward/side/away — both arms sweep low, robe flares;
      this is the grasping-hands windup (telegraph shows during it). - `summon` — both hands raised high, sustained green flare (single
      facing acceptable if he always faces camera-ish during it; decide at
      implementation, journal it).
- [x] **S-A5. Sword skeleton set.** `walk/idle/slash` × toward/side/away, plus
      a **`rise`** row (climbing out of the ground: hand bursts up, then
      shoulders, then stands — used at summon time; also usable for the
      initial escort spawn flourish).
- [x] **S-A6. Archer skeleton set.** `walk/idle/draw_loose` × toward/side/away + `rise`. The arrow itself is part of the effects sheet (S-A7).
- [x] **S-A7. Effects sheet.** `src/images/effects/`: `soul_bolt` (green orb
      with trailing wisps, spin loop), `soul_bolt_burst` (impact), `bone_arrow`
      (single frame, rotated at runtime via `drawSpriteRotatedCenter`),
      `grasping_hands` (eruption loop: hands clawing up, 6–8 frames, tileable
      patch so the cone can be filled with several instances).
- [x] **S-A8. Gore rows.** All three variants via shared `goreWound.ts` — a
      skeleton's gore is **bone scatter**: skull, ribcage section, pelvis,
      long bones, hand; no flesh — verify `goreWound.ts` supports a
      no-flesh/marrow-only look (`BoneSpec` exists; may need a small extension,
      keep the rat/llama bakes byte-identical as the regression check).
      Register three `*_GORE_PARTS` keys in `BodyPartGoreSystem`.
- [x] **S-A9. Harness + preview.** `scripts/render-skeletons.ts`
      (`--only=lord|sword|archer`), `?skeletons` preview route.
- [x] Review loop on final sheets (reviewer sees PNGs)

## Creature behavior

- [x] **B1. `SkeletonWarrior`** (`src/creatures/SkeletonWarrior.ts`, registry
      id `'skeleton_sword'`): melee mob, slash with windup; spawns either
      normally or in `rising` state (plays `rise`, invulnerable-and-harmless
      until risen, ~40 frames). Reusable later as a regular mob — standalone
      stats, named constants. `audioTag: 'skeleton'`.
- [x] **B2. `SkeletonArcher`** (`src/creatures/SkeletonArcher.ts`, registry id
      `'skeleton_archer'`): keeps distance (kiting band, e.g. 4–7 tiles),
      `draw_loose` fires a **bone arrow**. Arrows are owned by the encounter's
      projectile system (B4), not the mob — an archer dying mid-flight must not
      eat its arrow. LOS check before firing (llama precedent).
- [x] **B3. `SkeletonLord`** (`src/creatures/SkeletonLord.ts`): state machine
      `idle → repositioning → cast | hands_cast | summon → cooldown`. He
      prefers mid-range; drifts away from a player closing in. - **Soul bolts**: `cast` queues 1–3 bolts (fanned) at release frame →
      pending queue drained by B4. - **Grasping hands**: `drawDangerCone` from him toward the target
      (~4-tile radius, ~50° half-angle) during windup (~55 frames — "just
      enough time to get out"); at execute, players inside take heavy damage
      (fraction-of-maxHp, spider convention) and get `makeStuck()` briefly
      (1.5 s, not the spider's 4 — constants named); the cone fills with
      `grasping_hands` eruption effects for ~1 s. Check
      `spells.isPointInsideShell` for block XP. - **Summon**: on cooldown AND when living escorts < cap: play `summon`,
      queue 2 sword + 1 archer spawn requests. **Cap enforcement is the
      Hoarder pattern** (boss queues, system drains + enforces; write the
      cap back to the boss so it stops casting at cap). Cap ≈ 9 living
      escorts. Spawn tiles: walkable near the lord, `rise` state on arrival.
      Use the life-machine slot-reservation idea if the rise wind-up could
      double-book the cap. - `requiresEvasion` during hands_cast.
- [x] **B4. `SkeletonProjectileSystem`** (`src/systems/`): LavaBallSystem-shaped
      owner for soul bolts AND bone arrows — drains `takePending*()` from lord
      and archers, flies, collides (walls stop bolts; llama precedent),
      damages via carried pre-scaled damage + proper `DamageSource` naming the
      bounty. One system for both projectile kinds keeps the encounter
      self-contained.
- [x] **B5. Spawn composition** (`BountyDef.spawn`): lord + 2 sword + 1 archer.
      Def id `'skeleton_lord'`, `typeLabel: 'the Skeleton Lord'`. Delete
      `debug_ghoul` placeholder if still present. Summoned reinforcements also
      get `applyMobLevel` + `ignoresTownSafeZone` (the summon path must apply
      the same uniform flags BountySystem applies at issue — easy to miss).
- [x] **B6. Loot + XP** per core plan C5; boss-tier `xpValue`; escorts give
      modest XP each (they respawn via summon — do not make farming them
      better than killing the lord: keep escort XP low, named constant).
- [x] Validation gates + review loop after each of B1–B6

## Sounds ([HUMAN] sourcing)

| Proposed SoundId           | Ideal sound                              | Trigger                        |
| -------------------------- | ---------------------------------------- | ------------------------------ |
| `skeleton_rattle_1` / `_2` | dry bone rattle/clatter                  | walk (sparingly) + damage flag |
| `skeleton_slash`           | rusty blade whoosh                       | sword slash                    |
| `skeleton_bow`             | creak + loose twang                      | archer fire                    |
| `skeleton_lord_cast`       | low whispery chant + energy release      | soul bolt release              |
| `soul_bolt_impact`         | soft green _whumph_                      | bolt burst                     |
| `skeleton_hands`           | earth cracking + many dry scrapes        | grasping hands execute         |
| `skeleton_summon`          | rising choral moan + earth breaking      | summon + rise                  |
| `skeleton_lord_death`      | collapsing bone cascade + fading whisper | lord death                     |

`audioTag: 'skeleton'` (warriors/archer) and `'skeleton_lord'` + case arms in
`playMobAudioCues`. Boss music: this one most deserves its own dark track —
[HUMAN] Ryan decides; default ternary arm otherwise (journal it).

- [x] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [x] Registered in `BOUNTY_DEFS`; full `!bounty` loop (issue → arrow → fight:
      bolts pursue and are dodgeable, cone telegraph gives an escapable
      warning, hands damage+stick anyone caught, summons rise on cadence and
      respect the cap → kill lord → collect)
- [x] Bolts/arrows survive their caster's death mid-flight
- [x] Fog: lord immune + toast; warriors/archers confused
- [x] Town lure: lord + all escorts (including later summons) follow into town
- [x] Sword/archer skeletons spawn standalone via registry ids (future reuse)
- [ ] **[HUMAN]** Ryan playtests: cone warning duration, summon rate vs kill
      pressure, bone art believability in motion
- [x] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.

- 2026-08-02 — **Implemented end to end** (Claude, this session). Everything in
  this file is coded and both validation gates pass; what is left is Ryan's
  playtest.

  **Art (S-A1 – S-A9).** One bone engine, `scripts/skeletonArt.ts`, draws all
  three variants in three views. Negative space is protected structurally rather
  than by hand: ribs are stroked arcs with real gaps (never a filled shell), the
  forearm is a radius/ulna pair with an interosseous gap that closes at the
  wrist, the pelvis is assembled from blades, rami and a sacrum so the obturator
  holes are genuine transparency, and every long bone is a narrow shaft between
  two wider condyle knobs. `scripts/generate-skeleton-sprites.ts`
  (`npm run gen:skeletons`) bakes three sheets — the variants differ in height by
  a full tile, and one shared cell sized for the lord would leave every warrior
  frame mostly empty. Frame geometry is measured from ink; the generator verifies
  `src/images/enemies/manifest.json` and prints the block to paste rather than
  writing it. Review harness: `scripts/render-skeletons.ts --only=lord|sword|archer`
  (+ `--row`, `--frame`, `--scale`, `--mode=gore`); in-motion route `?skeletons`
  (`src/scenes/SkeletonPreviewScene.ts`).

  **Look-at-the-art rounds (four, each by rendering a contact sheet and reading
  the PNG).**
  1. Warriors' ribcages were a solid teal blob — the witch-light behind the
     ribs filled every gap it was supposed to leave, i.e. the exact failure the
     plan warns about. Split the glow into a per-variant `ribLight` (lord 0.7,
     warriors 0.1). Also: both feet pointed the same way head-on (toes are now
     view-aware, splayed outboard and foreshortened when pointed at the
     camera); the pelvis was a low-contrast lump (widened, and the ribcage's
     bottom raised to open a lumbar gap).
  2. The lord's mantle was a wide black dome that swallowed the shoulders and
     the top of the ribcage, and a cowl ellipse behind the skull fought the
     crown for the same silhouette. Mantle narrowed, shortened to clear the
     ribs and given a pointed hem; the cowl became a small standing collar.
     Skirt re-hung from the hip so the pelvis stays visible. The orbit halo was
     2.6 sockets wide and the two overlapped into a flat green mask across the
     face — cut to 1.45. Crown cut from seven thin spikes to five heavy ones.
  3. Profile was the weakest view: a ball-shaped skull with a single orbit in
     the middle of it (cyclops), no visible gear, and a trunk with no depth.
     Fixed by pushing the whole face forward on the skull (`PROFILE_FACE_FORWARD`),
     deepening the skull front-to-back, raising `PROFILE_GIRTH`, and moving both
     hands _forward_ in the edge-on idle so the shield, the sword and the bow
     clear the body instead of being drawn behind it.
  4. Gore: the ribcage read as wire squiggles, the forearm pair had fused into
     one fat bone, and the hand was a smudge at the runtime's 0.5×. Heavier
     ribs and vertebrae, a wider interosseous gap, a bigger hand. Final look
     also caught the lord's soul orb condensing exactly on his own jaw in the
     profile cast — he read as blowing a bubble. The gather hand now draws back
     beside the ribs.

  **S-A4 `summon` single-facing decision (the plan asked for this to be
  journalled).** Baked **toward-camera only**. It is a held, symmetrical,
  arms-overhead pose: mirrored into profile it is two arms drawn on top of each
  other, and from behind it is a robe with nothing happening above it. The draw
  wrapper deliberately ignores facing and never mirrors for this row, on the
  grounds that a boss turns to face the party to summon — which is what summoning
  is for. The other three attack rows keep all three views.

  **S-A8 gore / `goreWound.ts` extension.** Added `drawBoneBreak` **alongside**
  `drawWound` rather than branching inside it. A skeleton's break is bone all the
  way through — cortical wall, dry sponge, splinters, bone dust, no flesh, no
  blood — and every stage `drawWound` exists to paint is a stage a skeleton does
  not have. Additive rather than a branch because the two share a seeded random
  stream: one extra draw inside `drawWound` re-rolls every piece downstream of it.
  **Regression check ran twice** (after the addition, and again after `prettier`
  reformatted the file): `npm run gen:rat` and `npm run gen:llama` reproduce
  byte-identical PNGs (`rat.png` d06eff1a…, `llama.png` aa8b0c24…).

  **Behaviour (B1 – B6).**
  - `RisingSkeleton` (new, `src/creatures/RisingSkeleton.ts`) holds the half
    both warriors share: the climb out of the ground, and the fact that a
    rising skeleton is neither damageable nor a threat. Left damageable, a
    summon that lands in front of the party is deleted before its animation
    finishes _and_ frees the cap slot it was counted against, so the lord
    immediately summons again.
  - `SkeletonWarrior` (`skeleton_sword`) and `SkeletonArcher`
    (`skeleton_archer`) extend it. The archer kites a 4–7 tile band, checks LOS
    from the bow before drawing, and retreats in a straight line rather than
    pathfinding backwards (an A\*-ing retreat faces its own path and never
    shoots; backed into a corner it simply stops, which is how the player beats
    it).
  - `SkeletonLord`: `idle → reposition → cast | hands | summon → cooldown`.
    Facing is frozen for the length of every attack, so the cone cannot be
    re-aimed after the player has already read it. Soul bolts fan 1–3 wide and
    escalate as he is worn down. Grasping hands: `drawDangerCone`, 55-frame
    wind-up, 4 tiles, ~50° half-angle, damage on the single execute frame
    (`Math.ceil(maxHp * 0.4) + 2`, the spider's convention) plus a 90-frame
    root, with `isPointInsideShell` → `addBlockXp` honoured. `requiresEvasion`
    is true, so the companion sidesteps him.
  - `SkeletonProjectileSystem` owns soul bolts **and** bone arrows, on the
    LavaBallSystem contract: casters queue `pending*` records and expose
    `takePendingShots()`, the system drains the _whole_ mob list (not just the
    activation radius — a caster that fires and dies the same frame would
    otherwise strand its shot forever), and flight/impact/damage outlive the
    caster.
  - `SkeletonSummonSystem` (new; the plan named only B4, so this is a
    deviation) drains the lord's summon requests, places them on walkable
    ground 2–5 tiles out, and enforces the cap of 9. Splitting it from the
    projectile system keeps both names honest. Per the coordinator's mid-task
    correction it applies `applyMobLevel(lord.mobLevel)`, `ignoresTownSafeZone`
    and `forceAggro` itself — summons bypass BountySystem's uniform pass
    entirely — and deliberately leaves them unleashed, since they arrive into a
    fight that is already happening.
  - `spawn()` in `bountyDefs.ts` does exactly what the corrected contract says:
    constructs and `setMap()`s, nothing else. All three classes' idle branches
    call `returnHomeOrWander()`, not `doWander()`.
  - `makeStuck()` gained an optional tick count (defaulting to the spider's 240) so the hands can root for 1.5 s without a caller mutating the returned
    effect. Shared-file edit, backward compatible.

  **Sound stand-ins ([HUMAN] — none of the eight proposed ids were sourced, so
  every trigger point reuses the closest existing `SoundId`).**
  | Trigger | Proposed | Stand-in used |
  | --- | --- | --- |
  | sword slash | `skeleton_slash` | `sword_attack_1` |
  | archer looses | `skeleton_bow` | `wood_breaking_3` |
  | soul bolt released | `skeleton_lord_cast` | `cat_missile_fire` |
  | soul bolt burst | `soul_bolt_impact` | `llama_fireball_explosion` |
  | any skeleton damaged | `skeleton_rattle_1/_2` | `wood_breaking_1` / `_2` |
  | grasping hands erupt | `skeleton_hands` | `krakaren_ground_slam` |
  | summon cast | `skeleton_summon` | `krakaren_yell` |
  | a skeleton rises | `skeleton_summon` | `krakaren_ground_slam` |
  | lord death | `skeleton_lord_death` | _(none — generic death only)_ |
  Walk rattle was not wired at all: without a real bone sound it would be the
  sword swing playing on every step. **Boss music**: left on the default
  ternary arm, as the plan allows — [HUMAN] Ryan decides whether this one gets
  its own dark track.
  `Mob` carries one `specialSoundPending` flag but the lord has two specials,
  so `playMobAudioCues` reads `SkeletonLord.lastSpecial` to choose between
  them (the `instanceof` precedent already used there for boss cues).

  **Deviations from the plan, and why.**
  - Summons split into their own system (above).
  - `summon` baked in one facing (above).
  - `drawBoneBreak` added beside `drawWound` instead of extending it (above).
  - Walk rows sampled at 12 frames rather than Carl's 16: these are mobs seen
    at a distance across three sheets, and four more columns on each buys
    smoothness nobody is close enough to see.
  - The grasping-hands eruption is drawn from `SkeletonLord.drawSelf` rather
    than from a system. Unlike a projectile it is pure decoration — every point
    of damage landed on the frame it came up — so nothing is lost if the lord
    dies underneath it.

  **Still open.** [HUMAN] Ryan's playtest of the cone's warning duration, the
  summon cadence against kill pressure, and whether the bones read in motion;
  [HUMAN] real sounds for the eight ids above; [HUMAN] the boss-music decision.

- 2026-08-02 (later) — **Independent review round 1: 11 findings, all triaged
  genuine, all fixed.** Nothing was dismissed as a nit or out of scope.
  1. _Grasping hands rooted a player who had dodged._ `dealDamage`'s return value
     was discarded, so a dexterity dodge avoided the damage and still ate the
     90-frame root — in the middle of the cone. `Mob.dealDamage`'s own JSDoc says
     to gate the status on it, and the spider precedent this code cites does.
     Now gated.
  2. _The hands one-shot the party at high level._ The fraction-of-maxHp damage
     was going through `dealDamage`, which multiplies by the mob-level scale. The
     lord is the first mob whose level tracks the players', capped at 20, where
     that multiplier is 4.8 — so `ceil(maxHp*0.4)+2` came to ~1.9× the victim's
     own maximum health, an unconditional kill on any build. A fraction of max HP
     is already level-independent by construction; it now goes through
     `takeDamage` with its own `DamageSource` and is not scaled twice. (The
     spider's convention was only safe because the spider never receives
     `applyMobLevel`.)
  3. _All three `cullMarginTiles` were under-declared_, measured against the
     baked sheets: the lord overreaches its tile by 2.45 tiles against a declared
     2, and the warriors by 1.61 and 1.16 against the default 1. They popped in
     at the screen edge, and — because `hitFlashMarginTiles` is floored by this —
     the flash sliced their skulls off mid-fight. Now 3 / 2 / 1.5, with the
     measurement in the comment. `silhouetteMarginTiles` was also changed to
     `Math.max(super, …)` rather than a bare override.
  4. _The loop-closure bake gate was vacuously true._ It compared `pose(0)` with
     `pose(frameCount)` — i.e. phase 0 against phase 1 — and every pose here is
     built from sinusoids of the phase and from `gaitStep`, which wraps its
     argument into [0,1). Both are identical at 0 and 1 _by construction_, so the
     gate could not fail for any row written in the style of the rows it guarded.
     Replaced with two gates that do work: a **loop-seam** gate (the step across
     the wrap must not exceed the median in-cycle step by more than 2.2×) and a
     **leg-reach** gate (`legReachHeadroom`, new in `skeletonArt.ts`, checks every
     frame of every row against `THIGH + SHIN − JOINT_SLACK`, using each row's own
     view lateral). The reach gate immediately failed on **six** poses that had
     shipped over-extended — the head-on walk raised the hip above standing
     height on a third of its frames, the lord's hover and his summon lifted the
     pelvis off legs left on the floor, the profile poses inherited a head-on
     foot spread that edge-on becomes a quarter-tile of _depth_, and two head-on
     poses inherited a profile stance so narrow that each foot sat inboard of its
     own hip and the leg reached _further_. All six fixed: the gait bob now
     peaks at contact and never rises above standing height; hovering poses lift
     their feet with them; `profileStance()` / `facingStance()` make a pose state
     which stance it means.
  5. Dead local in `drawBoneBreak` removed.
  6. A comment in `DungeonScene` claimed an ordering opposite to the code's;
     rewritten to describe what is actually there and why either order is safe.
  7. _Art — the profile view did not read as a skeleton._ Confirmed by rendering:
     the head floated a quarter-tile above the cervical column (the spine stopped
     half a skull-radius short of the cranium — now carried up to `SKULL_BASE_Y`,
     with 11 vertebrae); there was effectively no ribcage or pelvis edge-on
     (`girth` alone left the cage sweeping under a tenth of a tile off the spine
     — new `PROFILE_RIB_REACH` / `PROFILE_PELVIS_REACH`); the sword hung straight
     down through the legs with no hand on it (new `SWORD_CARRY_TILT` carries it
     forward and clear, the `IRON` ramp was lightened so it stops reading as
     wood, and the gripping fist is now repainted over the shield).
  8. _Art — gore was illegible at the size it renders._ `GORE_PIECE_SCALE` 1.3 →
     1.85, and three pieces were redrawn outright: the ribcage now has ribs on
     **both** sides of a real column (one-sided it read as loose hooks beside a
     string of beads); the pelvis is filled wings with visible sockets and a
     closed pubic arch (as two capsules it read as a moth); the forearm's two
     bones no longer share an elbow disc (joined at both ends they closed into a
     hairpin); and the hand's fingers now fan across a narrow arc with a wrist
     stub instead of radiating round the palm, which read unmistakably as a
     spider.
  9. _Art — the orbits read as goggles._ The witch-light filled the socket
     instead of burning inside it. The glow is now well inside the orbit, and the
     socket's own dark rim is restated on top of it.
  10. _Art — the archer had no quiver and the bow read as a plank._ The quiver was
      tucked against the spine and painted over by the ribcage and both arms; it
      is now slung clear, with shafts standing above the shoulder line. The bow
      gained depth, horn nocks and a string thick enough to survive a 32 px tile.
  11. Stale doc comment in `StatusEffect.ts` reattached correctly.

  The regression check was re-run after every `goreWound.ts` edit and after
  `prettier` reformatted it: `rat.png` and `llama.png` remain byte-identical.

- 2026-08-03 — **Independent review round 2 (the confirming round): 6 findings,
  all triaged genuine, all fixed.** One of them was a defect _inside_ a round-1
  fix, which is the fourth time that has happened in this repo.
  1. _`rightArmBehind` was written by five pose functions and read by none._ The
     painter only ever consulted `leftArmBehind`; the reference rigs it was
     derived from read both. `draw_loose_away` and `hands_cast_away` therefore
     baked as identity copies of their front poses, with the bow, the string arm
     and the quiver painted on top of the ribs on a _back_ view. The painter now
     honours both flags.
  2. _The lord's profile arms collapsed into one shape over the ribcage._ Round
     1's fix for "the props are drawn behind the body" pushed **both** hands
     forward for **every** variant — and the lord carries nothing. A profile
     collapses the two shoulder joints onto nearly one point, so two hands a
     tenth of a tile apart stack their chains on the same pixels, and a quarter
     of a tile apart they cross into an X; either way the profile ribcage that
     round 1 had just widened was invisible again. The offsets are now chosen per
     variant (`carriesProp` threaded through `movementRows`): a shield and a bow
     are worth some crossing, bare hands simply hang.
  3. _The rib witch-light escaped the profile silhouette_ — a glow centred on the
     spine put half of itself outside a cage that is entirely on one side of it.
     It now moves forward with the ribs and shrinks to stay under them.
  4. _The profile tooth row spanned the whole cranium_, so the skull read as a
     smiley face however carefully the socket behind it was drawn. Edge-on the
     row is now a quarter of the jaw's width, sitting in the muzzle.
  5. _`LORD_CULL_MARGIN_TILES` (3) was smaller than the cone's reach (4)._
     `RenderPipeline` skips `drawSelf` past that margin and both the telegraph
     and the eruption are drawn from there, so a lord just off screen could take
     40% of a nearby player's max HP with a warning that was never drawn. Now
     `Math.min(MAX_MOB_CULL_MARGIN_TILES, HANDS_RANGE_TILES)`.
  6. Two cull-margin comments cited `tileY` values the current bake contradicts
     (103/74 against the real 104/73); corrected.

  Also tightened while in there: `eruptHands` now checks `harmless` itself, which
  is the one thing bypassing `dealDamage` had silently dropped.

  Gates green after every change; `rat.png` and `llama.png` still byte-identical;
  `npm run build` succeeds.

- 2026-08-03 (later) — **Independent review round 3: 8 findings, all triaged
  genuine, all fixed.** Three of them were defects _inside_ round-2 fixes, which
  is now the fifth and sixth time that pattern has caught something here.
  1. _The lord's profile arms still stacked._ Round 2 chose per-variant hand
     offsets and picked bare-hand values (0.05 / −0.03) that are closer together
     than the profile shoulder joints are — i.e. it fixed the crossing case and
     re-created the stacking case for the one variant it was written for. Fixed
     twice over: the bare hands now hang _behind_ the spine, clear of a ribcage
     that edge-on is entirely forward of it, **and** a bare profile arm is driven
     from joint angles rather than a hand target. (Solved from a target, the
     elbow flare bows the two arms in opposite _screen_ directions — head-on that
     holds them off the ribs, edge-on it throws one forward and one back into an
     X across the chest.) Prop carriers keep their targets, because where the
     shield and the bow end up is the whole point of them.
  2. _The mouth was painted on the back of the head._ The gape wedge was drawn
     unconditionally, before the `showsFace` branch; with the occipital arc under
     it the back of the skull read as a smiling face. Now gated.
  3. _The profile skull still read as a grin._ Round 2 narrowed the tooth row but
     not the mandible or the gape, which still spanned the whole skull depth. The
     jaw is now a short muzzle at the front of the skull.
  4. _Gear stayed in front of the trunk when its arm went behind it._ In every
     back row that hides the left arm, the shield floated over the pelvis with no
     forearm attached and the repainted fist belonged to nothing. Gear now
     travels with its own limb: two small painters, each called immediately after
     the arm that holds it, in whichever of the two slots that arm was painted.
     The quiver likewise moved — slung across the back, it is in _front_ of the
     ribs from behind and behind them from everywhere else.
  5. _`draw_loose_away` was still a front view with the face erased_ — round 2
     set `rightArmBehind` on it, which the painter now reads, but left
     `leftArmBehind` false, so the bow, the bow arm and the quiver were all still
     painted over the ribs on a back view. Both arms now go behind.
  6. _`handsCastBack` set both flags false_, making it byte-identical to the front
     pose. Both now true.
  7. _The profile walk never got the prop clearance the profile idle got._ The FK
     walk drives both arms from two all-but-coincident shoulders, so the shield
     sat on the ribs for all twelve frames — in the row a chasing mob spends its
     life in. The carrying arm now takes a forward bias, threaded through the
     same `carriesProp` flag.
  8. `SKIN_LOBE_MIN/MAX` renamed to `RIM_LOBE_MIN/MAX`: `drawBoneBreak` reads
     them and a skeleton has no skin. Values unchanged, so the rat and llama
     bakes stayed byte-identical (re-verified).

  Gates green; `gen:skeletons` in sync; `npm run build` succeeds.
