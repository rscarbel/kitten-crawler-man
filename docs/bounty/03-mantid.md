# Bounty Boss — The Mantid

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry + flags); all art
phases are independent and can start immediately.

**Status: IMPLEMENTED — awaiting Ryan's playtest**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `add-sound`. NOT bipedal-figure — this is an arthropod; the
structural template is `scripts/generate-spider-sprite.ts` (segmented body,
jointed limbs, carapace shading, and its arachnid-anatomy bake gates show the
level of rigor expected), with two-bone IK for the raptorial forelimbs borrowed
from the clown rig's solver approach.

## Concept

An **enormous praying mantis** boss, plus **two smaller crony mantises** that
are visually the same species but clearly subordinate. The cronies get their own
registry id because Ryan will reuse them later as regular mobs — build them as a
first-class mob, not a boss appendage.

Signature mechanic — the **rage cycle**:

1. Every so often (cooldown, named constant, e.g. 12–20 s after last rage) the
   Mantid **stops dead** and an **exclamation mark** appears over his head
   (reuse the glyph helper from file 02 Phase S1; gold).
2. For exactly **1 second** he is **invincible**: any player hit deals 0 damage
   and emits floating text "Immune" from him. He does not move or attack.
3. When the second ends: invincibility and the exclamation both drop, and he
   enters a **3-second flurry** — rapid slashes hitting everything around him
   in melee radius on a fast tick, while walking toward the player. The player
   is meant to run; standing in it is near-death unless the Mantid is nearly
   dead already.

## Names (5–10, shuffled by the core system)

```
'Slice', 'Scythe', 'Snips', 'Thresher', 'Sickle', 'Mandible', 'Vesper', 'Cleaver'
```

(Slice is Ryan's own example — keep it.)

## Art

PNG sheet pipeline per 00-overview (llama example). Two sheets from one art
module: `mantid` (boss) and `mantis` (crony) — the goblin four-sheet precedent
shows one drawing engine parameterized per variant. Boss reads bigger (≈2.5–3
tiles tall art overhanging its tile; override `cullMarginTiles`), with visual
distinction beyond scale: e.g. darker/iridescent carapace, tattered wing cases,
scarred raptorial arms. Cronies ≈1.5 tiles.

Anatomy notes that make it read as a mantis and not "generic bug": triangular
head with huge compound eyes that can pivot; long pronotum (the "neck");
raptorial forelimbs folded in the iconic prayer pose at rest, with visible
spines on the femur/tibia; four slender walking legs (the forelimbs are NOT
walking legs); wings folded flat along the abdomen. Each is a candidate bake
gate (e.g. assert forelimbs attach to the pronotum, not the abdomen — the small
spider taught us socket placement is what sells arthropods).

Per Ryan, **each view and animation is its own independent task**:

- [x] **M-A1. Art module + toward-camera set.** `scripts/mantidArt.ts` +
      generator skeleton. Rows: `walk` (toward), `idle` (toward — swaying,
      forelimbs folded, head pivots; timeFrameIndex-driven). Bake, render
      contact sheet, look at it, iterate.
- [x] **M-A2. Away-from-camera set.** `walk_away`, `idle_away`. Wing cases and
      abdomen dominate; head barely visible. Same review loop.
- [x] **M-A3. Side-profile set.** `walk_side`, `idle_side` (runtime ctx-flip
      gives the other direction — one side only, like every other sheet). The
      side view is where the prayer-fold silhouette must be unmistakable.
- [x] **M-A4. Attack rows.** `slash` × toward/side/away (single raptorial
      strike: unfold–snap–refold, the snap frames nearly straight), and
      `flurry` × toward/side/away (both arms alternating fast wide arcs; loops
      for 3 s). Also `rage_pause` (1-loop: reared up, arms cocked, trembling —
      distinct from idle so the invincible second is readable without the
      exclamation mark).
- [x] **M-A5. Gore row.** Death dismemberment pieces via the shared
      `scripts/goreWound.ts` (llama/rat side, NOT goblinGore's fork): severed
      raptorial arms, head with an eye, wing fragments, thorax, abdomen
      segments; green-tinted hemolymph is a palette decision — check with the
      gore palette constants and keep blood recognizably "bug". Export
      `MANTID_GORE_PARTS` + body-part key; register in `BodyPartGoreSystem`.
- [x] **M-A6. Crony sheet.** Bake `mantis` variant from the same module (all the
      same rows minus `rage_pause`/`flurry`). Verify at 32px it still reads.
- [x] **M-A7. Harness + preview.** `scripts/render-mantid.ts` (rows, gore mode,
      `--scale`), `npm run gen:mantid` alias, `?mantid` preview route.
- [x] Review loop on the final sheets — four bake-and-look rounds, and review round 1 was shown the rendered PNGs alongside the diff (see Journal)

## Creature behavior

- [x] **M-B1. `MantisCrony`** (`src/creatures/MantisCrony.ts`, registry id
      `'mantis'` in `spawner.ts` + `types.ts` union): melee mob, single `slash`
      attack with a short windup, mid speed. Stats sized as a floor-3+ regular
      mob (it will be reused ambiently later) — HP/damage/XP as named constants,
      `applyMobLevel` does the scaling. `audioTag: 'mantis'`.
- [x] **M-B2. `Mantid`** (`src/creatures/Mantid.ts`): state machine
      `idle → pursuing → slash → rage_pause → flurry → cooldown`. Baseline: slow
      stalking pursuit + single slashes in reach. - **Rage pause**: trigger on cooldown while aggroed; freeze movement
      1 s (`RAGE_PAUSE_FRAMES = 60`); render exclamation via the shared glyph
      helper; set an `isImmune`-style guard consumed in `takeDamageFrom` —
      override it to zero the damage and queue an "Immune" text emission
      instead (do NOT bypass via early return before `damageTakenBy`
      bookkeeping decisions — no damage means no attribution, which is
      correct). - **"Immune" floating text**: first check whether a floating combat-text
      mechanism already exists (damage numbers); if yes reuse it, if not
      implement a small rising-fade text in `drawSelf` using `drawText` from
      `src/ui/TextBox.ts` (one emission per blocked hit, cap simultaneous). - **Flurry**: 3 s (`FLURRY_FRAMES = 180`), damage tick every ~12 frames
      (named constant) to all players within ~1.6 tiles, damage per tick
      scaled via `dealDamage`; moves toward the nearest player at slightly
      above walk speed. `requiresEvasion` should return true during
      rage_pause + flurry so the AI companion runs (spider precedent). - Set `attackSoundPending`/`specialSoundPending` at the right beats.
- [x] **M-B3. Spawn composition** (`BountyDef.spawn`): boss + 2 cronies flanking
      at the site. Boss `displayName` set by BountySystem; def id `'mantid'`,
      `typeLabel: 'the Mantid'`. Delete the `debug_ghoul` placeholder def if
      this is the first real def to land.
- [x] **M-B4. Loot + XP**: `xpValue` boss-tier (Grotesque Spider is 2000 at base
      as a reference point; this should be meaningfully rewarding but scaled by
      level anyway); `rollLootItems` override per the core plan's C5 convention;
      generous coin range.
- [x] Validation gates + review loop run after each of B1–B4

## Sounds ([HUMAN] sourcing)

| Proposed SoundId          | Ideal sound                                   | Trigger                      |
| ------------------------- | --------------------------------------------- | ---------------------------- |
| `mantis_chitter_1` / `_2` | dry insect chittering/clicks                  | idle proximity + damage flag |
| `mantid_slash`            | sharp air-cutting _shick_                     | slash strike frame           |
| `mantid_rage`             | rising insectoid shriek/hiss, ~1 s            | rage pause start             |
| `mantid_flurry`           | fast layered slashing whooshes (loopable 3 s) | flurry                       |
| `mantid_death`            | wet crunch + falling chitin clatter           | death                        |

Boss music: reuse `boss_music_3` via `bossFightInitiated` unless Ryan sources a
dedicated track (note in Journal either way). Add `case 'mantis'`/`'mantid'`
arms to `playMobAudioCues`.

- [x] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] **[HUMAN]** Registered in `BOUNTY_DEFS` (done, and machine-checked); the in-browser `!bounty` loop (issue → find
      via arrow → rage cycle behaves: 1 s immune with "Immune" text and
      exclamation, then 3 s flurry that forces retreat → kill → collect)
- [x] Fog scroll — the _flags_ are machine-checked (`verify:bounty` asserts the
      mark is `immuneToConfusion` and that exactly one mob in the encounter is).
      **[HUMAN]** the toast copy on screen: `castConfusingFog` bakes its cloud on
      a DOM canvas, so the cast itself cannot be driven headlessly. _(the
      confusion-freeze bug a real run would have caught is fixed — see Journal)_
- [x] Town lure — `verify:bounty` asserts every mob in the encounter carries `ignoresTownSafeZone`, and none of these classes passes a town predicate to `acquireTarget` at all, so they are aggressive everywhere by construction
- [x] Cronies spawn standalone via registry id — machine-checked by `npm run verify:bounty`, which builds `'mantis'` through the registry
      _(registered and typechecked; never spawned in a running game)_
- [ ] **[HUMAN]** Ryan playtests: flurry damage/escapability, rage readability,
      art believability in motion
- [x] Final review loop: round 3 returned no correctness or gameplay defect (see Journal)

## Journal

- 2026-08-02 — Plan written; not started.

- 2026-08-02 — **Implemented** (Claude session). What landed:

  **Art.** One drawing engine, `scripts/mantidArt.ts`, bakes both sheets through
  `scripts/generate-mantid-sprite.ts` (`npm run gen:mantid`) — the goblin
  four-sheet precedent, parameterised by a `MantidBuild` (palette, wing wear,
  scarring, limb heft, iridescence) plus a per-variant scale. `mantid` is 2.5×
  (≈2.9 tiles of art), `mantis` is 1.3×. Rows: walk/idle/slash × toward/side/away
  for both, plus flurry × 3 and `rage_pause` for the boss only, plus a gore row.
  Frame cells are measured from ink, never declared; the measure pass also fails
  the bake on a blank frame (a NaN pose) and on a frame that ran off the
  measuring canvas. Contact-sheet harness is `scripts/render-mantid.ts`
  (`--variant`, `--row`, `--frame`, `--scale`, `--mode=gore`) and the live
  harness is `?mantid` (`src/scenes/MantidPreviewScene.ts`), which plays both
  builds over the floor-3 palettes and can fire the real gore system.

  **What the image review actually changed** (four bake-and-look rounds):
  1. First bake: the folded raptorials collapsed into one flat spiny slab beside
     the head, and head-on they covered the face entirely. Root cause was a
     single arm rig shared by all three views — the profile prayer is held in
     _front_ of the chest and the head-on prayer is held out to the _sides_, and
     mirroring one into the other laid the arms across the animal's own face.
     Split into `SIDE_ARM_RIG` / `AXIAL_ARM_RIG`, measured off different base
     angles, and moved the head to draw last head-on.
  2. The profile head was the front triangle squashed on one axis — a narrow slab
     with a bead on it. Replaced with a dedicated profile shape that is almost
     entirely compound eye, which is what a mantis head is from the side.
  3. The prayer fold was so tight (−158°) that femur and tibia merged into one
     club. Opened to −136°/−140°, which is where the V and both spine ranks read.
     Also gave the far arm a few degrees of parallax, because both arms move
     together and the far one was hiding exactly behind the near one.
  4. Wing-case wear was per-sample noise, which baked an even comb of notches
     that read as a saw blade painted on the abdomen. Replaced with three
     low-frequency splits (`tearAt`). Walking legs were too short for their span
     and read as straight sticks — lengthened until the knee breaks visibly.
     Pronotum thinned, abdomen carriage steepened, boss palette re-saturated and
     its iridescence pulled back from 0.75 to 0.45 (past ~0.5 the violet band
     stops reading as a sheen on green chitin and just reads as grey).

  **Bake gates** (`assertAnatomy`, run before a pixel is painted): forelimbs
  socket in the _forward_ portion of the pronotum; exactly four walking legs;
  pronotum ≥1.5× the leg-bearing thorax; head wider than deep; raptorial femur
  longer than the tibia that folds on it; both raptorial segments carry a spine
  rank. Plus the blank-frame and off-canvas gates in the bake itself.

  **Gore.** `scripts/mantidGore.ts`, eight pieces routed through the shared
  `scripts/goreWound.ts` (llama/rat side, not goblinGore's fork): folded
  raptorial arm, head, pronotum, abdomen, wing case, walking leg, gut coil,
  carapace shard — chosen for eight distinguishable silhouettes. Palette
  decision, per the plan's question: the pieces bleed **hemolymph**, a pale
  greenish-yellow, not blood. The shared engine still paints the cut face (its
  muscle and bone are what make a wound read as a wound), and a translucent
  hemolymph wash over each finished face lands the colour between the two.
  Pieces are painted from the live animal's own build, so a dead crony's limbs
  are green and the Mantid's are his teal. Registered under two keys in
  `BodyPartGoreSystem` — `mantid` and `mantis` — sharing one part list.

  **Creatures.** `MantisCrony` (`src/creatures/MantisCrony.ts`, registry id
  `'mantis'`) is a plain floor-3 melee mob with a telegraphed committed strike;
  nothing in it knows the Mantid exists, so it is reusable ambiently.
  `Mantid` (`src/creatures/Mantid.ts`) runs
  `idle → pursuing → slash → rage_pause → flurry → cooldown`. `RAGE_PAUSE_FRAMES
= 60`, `FLURRY_FRAMES = 180`, `FLURRY_TICK_FRAMES = 12`,
  `FLURRY_RADIUS_TILES = 1.6`; the rage cycle outranks the ordinary strike so the
  mechanic always gets shown. `requiresEvasion` is true across _both_ rage_pause
  and flurry — by the time the flurry starts it is too late for the companion to
  walk out. Both classes' idle branch calls `returnHomeOrWander()`, per the
  core-system contract, so BountySystem's site anchoring works.

  **"Immune" text.** A floating-combat-text system does exist
  (`FloatingCombatTextSystem`), but it drains only the two players' queues — a
  mob has no route into it, and giving one to a single boss would mean threading
  a system reference through every mob constructor. So the labels are the plan's
  documented fallback: a small rising-fade `drawText` in `drawSelf`, one per
  blocked hit, capped at three simultaneous (uncapped, a one-second immunity
  under panic swings plus missile bursts stacks into a white smear over the one
  thing the player needs to see). `takeDamageFrom` early-returns on a blocked
  hit, which deliberately skips `damageTakenBy`: no damage means no attribution.

  **Deviations from the plan, and why.**
  - The plan's M-B3 says to delete the `debug_ghoul` placeholder def if this is
    the first real def to land. It is not — `evil_clown` landed first — and the
    session brief explicitly said to leave the placeholder alone because another
    agent may still be relying on it. `MANTID_DEF` was appended, nothing removed.
    **Superseded:** a later session removed `debug_ghoul` once all five real defs
    had landed — `BOUNTY_DEFS` no longer contains it.
  - `spawn()` only constructs its three mobs and calls `setMap()` on each. No
    `applyMobLevel`, no flag setting, no insertion — per the corrected
    `BountyDef` contract (`applyMobLevel` multiplies off current values, so a def
    that also scaled would ship compounded stats).
  - Two-bone **IK** is used for the walking legs rather than the forward
    kinematics the plan implied, because the feet have to stay on the ground line
    while the body bobs and sways; the raptorials stay FK, where explicit angles
    are what make the prayer poseable.
  - `rage_pause` is one row rather than three. Reared straight up and stopped,
    there is nothing for a viewpoint to change, and three copies of one pose is
    three more things to keep in sync.

  **Sounds — all stand-ins; none of the proposed ids were sourced.** Recorded
  here so Ryan can swap them when he has the audio:

  | Trigger                                    | Proposed id                         | Stand-in actually wired                                                                                                                                                                                                |
  | ------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | crony + boss strike (`attackSoundPending`) | `mantid_slash` / `mantis_chitter_*` | `sword_attack_1` (sharpest blade cue in the library)                                                                                                                                                                   |
  | rage-pause start (`specialSoundPending`)   | `mantid_rage`                       | `grotesque_spider_screech_attack` (the only shriek there is)                                                                                                                                                           |
  | flurry                                     | `mantid_flurry`                     | none of its own — a flurry tick that _connects_ sets `attackSoundPending` through `Mob.dealDamage`, so landed slashes layer naturally; a flurry the player successfully outruns is silent until a real loop is sourced |
  | death                                      | `mantid_death`                      | none; the generic gore/splat path covers it                                                                                                                                                                            |

  There is no insect audio in `sounds.ts` at all, so **no new SoundIds were
  added** — adding ids without mp3s would only make `preload` warn. Boss music
  needed no edit: `AudioManager.wireEventBus`'s ternary already falls through to
  `boss_music_3` for any unrecognised `bossType`, which is what the plan asked
  for.

  **Not verified by play.** The `!bounty` end-to-end walkthrough, the fog-scroll
  toast, the town lure and Ryan's feel/readability pass are all still open; the
  mechanisms they exercise are BountySystem's rather than this file's, and were
  confirmed by code read only.

- 2026-08-02 — **Review round 1** (independent agent, fresh context, given the diff
  plus the plan and shown the rendered PNGs). Eight findings; **all eight triaged
  as genuine and fixed**. Nothing was dismissed.
  1. **Every anatomy bake gate was dead.** `assertAnatomy` compared hand-copied
     literals against hand-copied thresholds, because the real anatomy constants
     were module-private in `mantidArt.ts` and the generator imported none of
     them. Six gates that could never fail — exactly the regression-proofing the
     plan asked for, absent. Fixed by exporting the measurements
     (`FORELIMB_SOCKET_ALONG`, `PRONOTUM_LENGTH`, `THORAX_RX`, `HEAD_WIDTH/DEPTH`,
     `FEMUR_LENGTH`, `TIBIA_LENGTH`, `FEMUR_SPINES`, `TIBIA_SPINES`) and deriving
     each gate from them; the leg-count gate now counts the _pose_'s legs rather
     than asserting `4 === 4`. Verified by temporarily moving the forelimb socket
     to 0.3 and watching the bake fail with the right message.
  2. **The Scroll of Confusing Fog froze the rage cycle.** `MobUpdateLoop` skips
     `updateAI` for a confused mob, and the whole cycle's timers live there — so a
     fogged Mantid stayed in `rage_pause`, motionless and **invincible**, for as
     long as the fog held, then flurried on exit. A bounty-spawned Mantid is fog
     immune and never sees it, but the class is a registered ordinary spawn type
     too, and "unkillable if you drink one scroll" is not a thing to leave to who
     spawned him. Fixed in `tickTimers()` — the one hook the loop runs for
     confused and unconfused mobs alike — which now cancels a frozen rage cycle
     into the post-flurry cooldown.
  3. **Death screen said "unknown".** Neither `Mantid` nor `MantisCrony` was in
     `MOB_TYPE_TO_CAUSE`, so the game's most lethal new mechanic produced a
     generic death line. Added both, plus a `mantidFlurry` cause split on the
     exported `MANTID_FLURRY_ATTACK_TYPE` — being carved up by fifteen ticks is
     not the same death as being caught by one strike — and three
     `DEATH_EXPLANATIONS` lines each.
  4. **The overhead lift was a hand-copied number citing a `tileY` that does not
     exist** (the comment said 125→149 across rebakes). Replaced with a value read
     from the loaded manifest at draw time, so a rebake that resizes the cell can
     never silently detach the marker from the head. Same treatment on the crony.
  5. **The `?mantid` harness played the boss's strike at the crony's tempo** (36
     frames instead of 46) against a `Mantid.SLASH_FRAMES` symbol that never
     existed — the one judgement the harness exists to make, made on the wrong
     clock. Both totals are now exported and the harness picks per sheet.
  6. **The runtime gore list was a hand-copy with nothing policing it.** Renaming
     a piece in `mantidGore.ts` would rebake cleanly, pass the manifest check, and
     silently drop that body part in play. The bake now imports
     `MANTID_GORE_PARTS` and fails if the two lists disagree. Verified by renaming
     one piece and watching it fail.
  7. **The red aggro `!` was painted underneath both creatures** — drawn before
     the sprite, a few pixels above a tile the art overhangs by two. Dead render
     work, and the tell the rest of the game relies on was simply missing on the
     two mobs where it matters most. Both now draw it after the sprite at the
     art-derived lift. The boss's health bar was lifted with it (it had been lying
     across his legs).
  8. **Three verification checkboxes were ticked that the journal itself said
     were code-read only.** Unticked and annotated. Finding 2 is precisely what a
     real fog-scroll run would have caught, which is the argument for not ticking
     them. The sounds table in the previous entry had also been mangled by
     Prettier into swallowing its trailing prose as table rows; unwrapped.

  Two things the reviewer explicitly cleared and I did not touch: the `BountyDef`
  contract (spawn constructs and `setMap`s only; both idle branches call
  `returnHomeOrWander`), and the art itself — read at review scale and at 32 px
  across `idle_side`, `slash_side`, `rage_pause`, the gore panel and the full
  crony sheet.

  Also fixed unprompted while the review ran, and so **carried into round 2 as
  unreviewed changes**: a rage cycle can no longer fire at maximum aggro range
  (`RAGE_TRIGGER_RANGE_TILES = 4.5`, or the four-second centrepiece burns on empty
  ground eleven tiles from the player); Protective Shell now earns block XP for
  absorbing a flurry tick; the art's specular/rim/gradient tuning multipliers were
  given names; a vestigial `seed` field was removed from `ChitinPart`.

  Round 2 is required before this phase can be called done — per 00-overview and
  the memory note that four re-reviews in this repo have found defects inside a
  completed fix.

- 2026-08-02 — **Review round 2** (independent agent, fresh context, told round 1's
  fixes were not to be trusted). Four findings; **all four genuine and fixed**.
  Nothing dismissed.
  1. **`gore_entrails` baked as a solid disc.** The spiral's radial pitch
     (~0.044 tile units per turn) was thinner than the strokes drawing it (up to
     0.072), so every turn painted over its neighbour and the "coiled rope — the
     only piece in the set with no straight edges" came out as a cookie. It was
     the one piece of the eight that failed the set's own
     eight-distinguishable-silhouettes test, and the module header asserted the
     opposite. Rewritten: the turn count is now _derived_ from the radial span
     and the stroke width rather than chosen, so the gaps cannot close again, and
     the coil is squashed so it reads as a loop lying down rather than a target.
     Re-rendered `--mode=gore` and confirmed it reads as rope at review scale and
     still at the in-game strip.
  2. **Round 1's health-bar lift was applied to the boss and not the crony.**
     Exactly the "a fix can entrench the bug it fixed" pattern: the crony's aggro
     tell was lifted, the symmetric `renderMobHealthBar` call one line below was
     not, leaving the bar painted 11 px inside the animal. Both now share one
     `overheadY`.
  3. Bare `9` used twice as the gut's constriction count — named.
  4. A comment reading "One eye, dulled" sat above a loop that draws two.

  Found and fixed by me _while_ round 2 ran, and so still unreviewed going into
  round 3: the first version of round 1's confusion-cancel also cancelled out of
  `pursuing`, which re-rolled `rageCooldown` every frame for as long as the fog
  held. Narrowed to a `COMMITTED_STATES` set (`slash`/`rage_pause`/`flurry`);
  `MantisCrony` gained the same cancel for a strike frozen mid-swing; and the
  "Immune" labels moved into `tickTimers` so they cannot hang in the air on a
  confused Mantid.

  Round 2 explicitly cleared, having re-derived rather than trusted them: the
  anatomy gates (it broke two constants and watched the bake fail, then restored
  them), the gore-state gate, `tickTimers` reachability for confused mobs,
  `overheadLiftTiles` units and pre-load fallback, the `DeathCauseSystem` import
  (no cycle; matches the `VIAL_ATTACK_TYPE` precedent in the same file), the
  slash-total renames, `RAGE_TRIGGER_RANGE_TILES`, the `addBlockXp` call, and the
  whole state machine end to end — including that the damage frame at progress
  0.565 lands on the art's own snap window at 0.56.

  Two things it flagged as out of scope and I agree with: status DoT reaches mobs
  through `Player.takeDamage`, which bypasses `takeDamageFrom` entirely, so a
  burning Mantid still ticks during his invincible second — there is no
  `Mob.takeDamage` override anywhere in the repo and fixing it is a repo-wide
  change, not this creature's. And a cached `isAggro` that confusion never clears
  is what `DarkKnight`, `RockGolem` and `SkeletonLord` all do too.

- 2026-08-02 — **Review round 3** (independent agent, fresh context). **No
  correctness or gameplay defect found.** Four minor findings; three fixed, one
  the reviewer itself filed as not-a-defect.
  1. **The two `cullMarginTiles` were still hand-copied art measurements** — the
     exact class of number round 1 removed everywhere else — and both JSDoc
     derivations already disagreed with the value they justified (the boss's
     labels rise 3.2 tiles; the margin said 3). Replaced with
     `mantidCullMarginTiles()` in `mantidSprite.ts`, which measures the sheet's
     real overhang on every axis from the loaded manifest, adds whatever the
     creature hangs above its own art, and clamps to `MAX_MOB_CULL_MARGIN_TILES`.
     `overheadLiftTiles` moved into the same module beside it, so both classes now
     read one cached measurement instead of keeping two copies of it.
  2. **The rewritten coil was tessellated with a leftover `STEPS = 44`.** Round 2
     made the turn count derived and left the step budget fixed, so the outer
     turns baked as a flat-sided polygon — in a piece the module header sells as
     the set's only curve, and stale by construction for any future pitch change.
     Now `STEPS = ceil(turns * SEGMENTS_PER_TURN)`. Re-rendered and confirmed
     smooth.
  3. A comment in the preview scene said boss-only rows render blank on the crony
     sheet; the code filters them out. Comment corrected to match.
  4. _Not fixed, and the reviewer agreed it should not be:_ the aggro `!`, the
     rage `!` and the health bar share one anchor, so the glyph overprints the
     bar. Every other mob in the game passes the same `sy` to both; changing it
     here would make the Mantid the one creature that reads differently.

  The reviewer re-derived rather than trusted all three of round 2's changes —
  including chasing the one way the new coil could still have closed up
  (`COIL_SQUASH` scales the path but not the stroke, tightening the effective
  pitch at the top and bottom of the loop) and confirming the groove survives
  there on both variants — plus the anatomy and gore-state gates, the gore cell
  inflation limit on both variants, the `BountyDef` contract, the full state
  machine, and CLAUDE.md compliance across every Mantid file.

- 2026-08-03 — **Review round 4** (independent agent, fresh context). Two
  findings, both genuine, both in the one function round 3 introduced — the
  "a fix can entrench the bug it fixed" pattern for the third round running.
  1. **The new cull margin dropped the crony _below_ the engine default.**
     `RenderPipeline` culls on `mob.x`/`mob.y`, which is the tile's **top-left
     corner**, against one symmetric margin — so a creature leaving the screen
     leftward or upward has a whole tile of its own between that corner and the
     far edge of its art. That is why `DEFAULT_CULL_MARGIN_TILES` is 1 and not 0,
     and `artExtentOf` was computing `max(up, down, side)` with neither `+1`.
     The crony came out at 0.71 tiles — _worse than deleting the override
     entirely_, and worse than the hand-copied 2 it replaced — so a mantis was
     being dropped with about a tile of itself still on screen. Now
     `max(up, 1 + down, 1 + side)`: mantis 1.69, mantid 3.20 (the boss was
     accidentally safe only because his label rise already exceeded his true worst
     edge).
  2. **`side` re-derived an anchor the manifest already states.** It assumed the
     tile was horizontally centred in the cell — true of today's bake, but the
     whole point of round 3's change was that measurements come from the manifest
     so a rebake cannot make them stale. Now reads `def.tileX`.

  Everything else re-derived and cleared: the extent maths against
  `SpriteRenderer`'s anchoring, the cache (a missing def returns before the
  `set`, so it cannot pin the fallbacks for the session), the clamp against
  `MOB_QUERY_MARGIN`, the coil's derived `STEPS` (80 now, ~7.5° per segment) and
  the gore inflation gate passing for real on both variants, the state machine,
  `tickTimers`/`COMMITTED_STATES`, the `BountyDef` contract, every wiring point,
  and CLAUDE.md across all Mantid files.

- 2026-08-03 — **Review round 5** (independent agent, fresh context). Three
  findings, all genuine, all small; fixed.
  1. `widest`'s JSDoc still called it "the largest overhang", but after round 4
     two of its three terms carry the creature's own tile — it is a required
     _margin_, and conflating the two is the exact confusion that made round 3's
     cull too small. Reworded to say so.
  2. **The Mantid's confusion-cancel dropped a strike without arming its
     cooldown**, while `MantisCrony`'s identical fix did. A Mantid fogged
     mid-swing paid 40 frames instead of the usual 100, so being confused
     marginally _raised_ his strike rate. An asymmetry inside a fix the two
     classes were meant to share — the same shape as round 2's finding. Fixed.
  3. This file's "Deviations" note still said the `debug_ghoul` placeholder was
     deliberately left in place; a later session removed it once all five real
     defs landed. Annotated as superseded.

  Round 5 re-derived round 4's cull maths from `RenderPipeline` and
  `SpriteRenderer` independently — including confirming that `up` correctly does
  _not_ take the `+1` (the bottom edge is the one where the mob's own tile lies
  behind the direction of travel) — and re-checked the coil's worst case, the
  bake gates, the state machine, the `BountyDef` contract, every wiring point,
  and the art at review and in-game scale.

- 2026-08-03 — **Review round 6.** For the first time in this sequence the
  reviewer found **nothing wrong inside the previous round's fix**, and no
  correctness, gameplay, art or CLAUDE.md defect in the implementation at all.
  It re-derived the cull contract from `RenderPipeline` and `SpriteRenderer`
  independently, checked round 5's `slashCooldown` reset separately in each of
  the three states the confusion-cancel covers (and confirmed the cancel replaces
  the normal exit rather than doubling it), mutated `FORELIMB_SOCKET_ALONG` to
  prove the anatomy gate still throws before painting, and confirmed by grep that
  every damage path to a `Mob` in the repo runs through `takeDamageFrom` — so the
  invincible second has no bypass. All four gates green; both contact sheets, the
  in-game 32 px strip and the gore panel looked at.

  Two findings; one fixed, one dismissed:
  - **Fixed.** This journal's sounds table said each flurry tick sets
    `attackSoundPending`. It does not — `Mob.dealDamage` does, so a tick only
    makes a sound when it _lands_, and a flurry the player successfully outruns
    is silent. The code is right (unconditionally firing a slash cue fifteen
    times at empty air would be worse, and relying on `dealDamage` is what every
    other mob does); the sentence was wrong, and is now precise.
  - **Dismissed as out of scope.** An orphaned JSDoc block above `placeNearSite`
    in `src/systems/bountyDefs.ts` documents a different, nullable-returning
    function. Genuine and worth deleting, but the text is Dark-Knight flavoured
    and arrived with another file's session; `bountyDefs.ts` is shared and being
    edited concurrently, so removing another agent's comment risks a conflict for
    no behavioural gain. **Flagged here for whichever session owns file 05.**

  Round 7 below is the confirming round the protocol requires after any fix.
