# Bounty Boss — The Dark Knight

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry + the C3 shared
`dangerTelegraph.ts` helpers); art phases are independent.

**Status: IMPLEMENTED — art, creature and integration landed 2026-08-02. Ryan's
playtest and the sourced sounds are the only things outstanding.**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `bipedal-figure` (armored biped — full rig contract and
image-review loop), `add-sound`.

## Concept

A **medieval knight** in blackened plate who fights with a flanged **mace** he
swings around his head and slams into the ground. He brings **10 goblins**
(existing `Goblin` class, zero new minion art) as a screening force.

Three attacks:

1. **Overhead slam** — targets the player's current tile; a **red ground
   telegraph** (the spider-fight visual language, via the shared
   `drawDangerCircle`) marks the impact disc during the windup. Move or take
   massive damage.
2. **Arc sweep** — he whirls the mace around himself; red ring telegraph at his
   sweep radius. The counter is to back out of the ring.
3. **Off-hand punch** — quick jab with the non-mace hand. Small damage,
   **unavoidable** (no telegraph, no dodge window) — it punishes hugging him
   between specials.

## Names (5–10, shuffled by the core system)

```
'Blackgard', 'Grimhelm', 'Sir Craven', 'Dreadmarch', 'Rustmourn', 'Vane', 'Ironwake', 'Sir Malloch'
```

## Art

New art module on the bipedal IK approach (`clownArt.ts` is the reference
solver; plate armor changes the painting, not the skeleton). ≈2–2.5 tiles of
art; override `cullMarginTiles` for the raised mace and
`silhouetteMarginTiles` so telegraph rings aren't clipped (spider precedent).

Armor-believability notes (candidate bake gates): the silhouette must read as
articulated plates, not a smooth suit — pauldron/breastplate/faulds/greaves as
distinct masses with edge highlights; a closed great-helm (no face, eye-slit
glint only); the mace is a **prop painter** (the Terror mallet
`makeMalletPainter` pattern) so every row shares one mace drawing.

Per Ryan, each view/animation is its own independent task:

- [x] **K-A1. Module + toward set.** `scripts/darkKnightArt.ts` +
      `scripts/generate-dark-knight-sprite.ts` (`npm run gen:dark-knight`).
      Rows `walk`, `idle` (toward) — heavy, deliberate gait; idle breathes via
      shoulder rise (timeFrameIndex-driven at runtime).
- [x] **K-A2. Away set.** `walk_away`, `idle_away` — cloak/backplate, mace
      resting on shoulder.
- [x] **K-A3. Side set.** `walk_side`, `idle_side` (ctx-flip mirror).
- [x] **K-A4. Attack rows.** - `slam` × toward/side/away: two-hand raise (long windup — this is when
      the telegraph shows), full-body drop, mace buried, recover. - `sweep` × toward/side/away: mace whirled around the head 1–2 turns then
      a level 360° sweep at torso height. - `punch` × toward/side/away: short off-hand jab, ≤20 frames total —
      visually snappy because mechanically undodgeable.
- [x] **K-A5. Gore row.** Shared `goreWound.ts`: helm (rolls), gauntlets,
      pauldron, breastplate section with the wound, the mace itself as a
      settled piece. Register `DARK_KNIGHT_GORE_PARTS` + key in
      `BodyPartGoreSystem`. Armor gore is mostly clean-cut metal + flesh at the
      joins — use `CutSpec.kind: 'clean'` where plate shears.
- [x] **K-A6. Harness + preview.** `scripts/render-dark-knight.ts`,
      `?darkknight` preview route.
- [x] Review loop on final sheets (reviewer sees PNGs)

## Creature behavior

- [x] **K-B1. `DarkKnight`** (`src/creatures/DarkKnight.ts`): state machine
      `idle → pursuing → punch | slam | sweep → cooldown`, GrotesqueSpider's
      windup/execute phase structure as the template (it is the codebase's
      proven telegraphed-boss shape): - **Slam**: pick the target player's position **at windup start**, lock
      it (the point does not track — that's the dodge), telegraph via
      `drawDangerCircle` at that point for the whole windup (~70 frames,
      named constants), impact damage is spider-style fraction-of-maxHp
      heavy (e.g. `ceil(maxHp * 0.6)` + flat, tunable) in a ~1.6-tile disc.
      Chosen when target is at mid range. - **Sweep**: telegraph `drawDangerCircle` centered on himself at sweep
      radius (~2.2 tiles) during windup (~55 frames); damage to everything
      inside at execute (heavy but survivable, e.g. `ceil(maxHp * 0.35)` +
      flat). Chosen when a player is inside the radius. He stands still
      during it. - **Punch**: when in arm's reach and specials are cooling down; small
      flat scaled damage via `dealDamage`, marked `undodgeable` in its
      damage-source (AcidPuddle precedent shows the field). - `requiresEvasion` true during slam/sweep windups. - Shell interaction: check `spells.isPointInsideShell` like the spider's
      AoEs do, granting block XP.
- [x] **K-B2. Spawn composition** (`BountyDef.spawn`): boss + **10 `Goblin`**
      spread over the site disc (walkable-tile search per placement,
      `findWalkableTileInCamp`-style uniform-over-area sampling so they don't
      stack). Def id `'dark_knight'`, `typeLabel: 'the Dark Knight'`. Goblins
      get `applyMobLevel(bountyLevel)` + `ignoresTownSafeZone` from
      BountySystem's uniform pass. Delete `debug_ghoul` placeholder if still
      present. Ten goblins at player level is intentionally a mob — the sweep
      also hits goblins? No: `dealDamage` targets players only in this
      codebase's melee helpers; keep it that way (friendly fire is not a
      feature here).
- [x] **K-B3. Loot + XP** per core plan C5; boss-tier `xpValue`; goblins keep
      their normal drops (10 goblins is itself part of the reward).
- [x] Validation gates + review loop after each of B1–B3

## Sounds ([HUMAN] sourcing)

| Proposed SoundId        | Ideal sound                                         | Trigger                   |
| ----------------------- | --------------------------------------------------- | ------------------------- |
| `dark_knight_step`      | heavy armored footfall (sparingly — every Nth step) | walk                      |
| `dark_knight_whirl`     | rhythmic heavy whoosh (loopable)                    | sweep windup              |
| `dark_knight_slam`      | massive metal-on-earth impact                       | slam execute              |
| `dark_knight_sweep_hit` | broad metallic _whumm_                              | sweep execute             |
| `dark_knight_punch`     | short gauntlet thud                                 | punch                     |
| `dark_knight_voice`     | muffled helm-distorted grunt/challenge              | first aggro + damage flag |
| `dark_knight_death`     | armor collapse — cascading metal clatter            | death                     |

`audioTag: 'dark_knight'` + case arms in `playMobAudioCues`. Boss music:
default `boss_music_1/2/3` ternary arm unless Ryan sources something; journal
the choice.

- [x] Sound ids registered + wired (stand-ins journaled — no new mp3s exist yet)

## Integration & verification

- [x] Registered in `BOUNTY_DEFS` (`DARK_KNIGHT_DEF`, id `dark_knight`)
- [ ] **[HUMAN]** Full `!bounty` loop played through (issue → arrow → fight:
      slam telegraph appears at locked point and is dodgeable; sweep ring is
      escapable by backing up; punch lands regardless; goblins screen → kill →
      collect). Not verified in a browser by the implementing session.
- [x] Telegraph visuals match the spider's language (shared helpers, no drift)
- [x] Fog: knight immune + toast; goblins confused (both come from BountySystem's uniform pass; nothing knight-specific was needed)
- [x] Town lure: knight + goblins all follow into town, stay aggressive (BountySystem clears the leashes and sets `forceAggro`; `DarkKnight` idles through `returnHomeOrWander` so it reads the anchor)
- [ ] **[HUMAN]** Ryan playtests: slam/sweep windup lengths (dodgeable but
      tense), punch damage as chip-not-burst, 10-goblin chaos level
- [x] Final review loop run — five blind art rounds and three independent code
      reviews; the last art round returned only nits, all triaged out in the
      Journal. The gates lock in every fix that could regress.

## Journal

- 2026-08-02 — Plan written; not started.

- 2026-08-02 — **Implemented end to end** (art, gore, creature, integration).

  **Files added.** `scripts/darkKnightArt.ts` (the painter: palette, proportions,
  view table, two-bone IK rig, plate painting, the mace prop painter),
  `scripts/darkKnightGore.ts` (seven pieces), `scripts/generate-dark-knight-sprite.ts`
  (choreography + measured geometry + nine bake gates + manifest verification),
  `scripts/render-dark-knight.ts` (contact sheet, `--mode=parts|prop|gore`),
  `src/sprites/darkKnightSprite.ts`, `src/creatures/DarkKnight.ts`,
  `src/scenes/DarkKnightPreviewScene.ts`. Edited: `package.json`
  (`gen:dark-knight`), `src/images/enemies/manifest.json` (hand-pasted
  `dark_knight` entry), `src/systems/bountyDefs.ts` (`DARK_KNIGHT_DEF`),
  `src/systems/BodyPartGoreSystem.ts`, `src/systems/GameLoopPhases.ts`,
  `src/dev/devBoot.ts`.

  **Sheet.** 16 rows × 18 cols of 168×204 at `tileScale=64`, `tileX=52`,
  `tileY=134`; 9.9 megapixels, 1.76 MB — in line with the other bounty bosses.
  Rows: walk/idle/slam/sweep/punch × toward/side/away, plus the gore row.

  **Bake gates (all in the generator, all fatal).** G0 border clip, G1 leg reach
  headroom (measured against the _ankle target_, not the solved chain — a
  clamped leg reports the limit exactly however far past it the pose reached),
  G2 stance-foot slide, G3 off-hand grip on the slam, G4 mace-tip continuity
  with a declared-spike allowlist for the strike itself, G5 mace floor
  clearance, G6 impact-is-the-peak, G7 loop closure, G8 anchor + height, G9 gore
  distinctness (16×16 IoU, 62% limit), plus a texture-size report.

  **Deviations from the plan, and why.**
  - The plan cites `clownArt.ts` as the reference solver. The `bipedal-figure`
    skill overrides that: `carlArt.ts` is the only sanctioned rig and gait
    reference in this repo, so the skeleton, the view table, the FK arm escape
    hatch and the whole walk cycle are Carl's, adapted. The clown rig was not
    used.
  - **The knight carries the mace shouldered** in every locomotion and idle row
    rather than swinging it at his side. A 0.94-tile haft swung from a hanging
    hand drags the cell size out for all sixteen rows, and shouldered it puts a
    second vertical mass beside the helm — which is what says "armed" at 32 px.
  - The sweep whirls **one** turn round the helm, not two. Two spun the head
    through 90° per frame, which is a strobe rather than a swing at any playback
    rate.
  - `SWEEP_IMPACT_FRAME` is 11 of 18 rather than a "middle" frame: G6 requires
    the declared impact to be the extreme of the row's own motion, and 11 is
    where the head is furthest out during the level sweep.
  - The punch is routed through `takeDamage` rather than `dealDamage`, because
    `dealDamage` cannot express `undodgeable` and the spec requires it. The
    level scaling (`scaledDamage`) and the swing sound are applied by hand to
    match what `dealDamage` would have done.
  - Head-on, the jab is driven from **joint angles with a foreshortened
    forearm**, not from a hand target. Moving the hand sideways produced an arm
    raised out to the side and held there; a reviewer read it as no punch at
    all. A 2D arm has no other way to travel at the camera.
  - `debug_ghoul` was **left in `BOUNTY_DEFS`** despite the plan's "delete if
    still present": the coordinating session asked for it to stay while other
    bounty files are still being built against it.

  **Sound stand-ins ([HUMAN]).** None of the seven proposed `dark_knight_*` ids
  exist as mp3s, so no ids were added to `sounds.ts`. Existing ids stand in at
  each trigger, wired in `playMobAudioCues` / `playDarkKnightCues`:
  - punch → `hammer_strike` (via the `attackSoundPending` switch)
  - sweep wind-up whirl → `rumble`
  - slam execute → `krakaren_ground_slam`
  - sweep execute → `grotesque_spider_slam_attack`
  - armoured footfall, helm-distorted voice and the death clatter → **not
    wired at all**. There is nothing in the library close enough to be worth the
    false note, and the walk-step cue in particular needs an every-Nth-step
    driver that does not exist yet.
  - Boss music: left on the default `boss_music_3` arm of the
    `bossFightInitiated` ternary in `AudioManager.wireEventBus`. No change made.

  **Review rounds.**
  - _Art round 1_ (blind, images only). 18 findings. Accepted and fixed:
    limbs reading as beads-on-a-string (segments and joint plates are now
    unioned into one silhouette per limb with the plate boundary _scored_ rather
    than painted as separate shaded discs); shoulder:hip ≈ 1.15:1 (shoulders
    widened, skirt spread cut from 1.55× the waist to 1.28× so the hips are
    narrower than the shoulders); armour within ~10% luminance of the backdrop
    (steel ramp brightened two steps); the mace reading as a plume from the
    front (carry tilt widened to 26° so the shaft clears the body, head painted
    a step lighter than the plate, flanges redrawn with straight leading edges);
    two brass rivets on the back of the helm reading as a second pair of eyes
    (now steel at low alpha); no visible punch; the slam ending in a T-pose
    (every attack now eases back toward its own view's idle); the sweep hiding
    the mace behind the torso for three frames; the crouch popping in one frame;
    the back cape swallowing the whole rear silhouette. _Dismissed:_ the demand
    for 7.0–7.5 heads tall — the `bipedal-figure` skill fixes this game's
    figures at ~4.8 heads with a deliberately oversized head, and a life-drawing
    ratio here produces a pinhead at a 32 px tile (the helm _was_ shrunk one
    step, 4.6 → 5.0 heads). Also dismissed: "16 walk frames doing the work of 6"
    (16 is the house standard for a walk row) and the r5 measurements, which
    were taken from a crop that was mis-centred on the helm — the crop was
    fixed instead.
  - _Art round 2_ (blind). 17 findings. Accepted and fixed: the pauldrons were
    horizontal shelves with daylight under them (lift cut from 0.085 to 0.03 and
    an outer-edge roll added, so each cap now sits _over_ the deltoid); the arm
    was still five bordered lumps because the gauntlet was painted as its own
    mass (the gauntlet is now unioned into the arm's silhouette, with its seams
    and studs painted over the shared mass); the head-on cloak reached the knees
    and read as red trousers with the poleyns' ink outlines boxing it (front
    cloak shortened to 0.78 tiles, tabard now stops at the fauld line); the
    tassets had a gap between them and read as saddlebags (widened to meet); the
    head-on crest was a one-pixel antenna (widened to a block); the two visor
    embers read as robot eyes (a dim glow bar now lights the whole slit behind
    them); the back-of-helm rivets sat exactly at eye height (moved up); the
    slam's mace was hidden behind the body head-on for the three frames of the
    strike, taking the signature move off screen (`macePropBehind` is now the
    away view only); the sweep's second half orbited round rather than flat, so
    it read as a windmill (level-phase orbit squashed to 0.32); the head-on jab
    was invisible (the fist now grows 45% as the forearm foreshortens); the walk
    was pixel-identical above the waist (the shouldered mace rocks ±7° and lags
    the torso by a quarter cycle); attack recoveries raised to 0.95 so every row
    ends idle-adjacent; gore pieces scaled up 1.5 → 1.9. _Dismissed:_ the demand
    for a starburst/flanged-tip mace silhouette — `bipedal-figure`'s anatomy
    notes record that adding tips to a weapon in this codebase destroyed its
    archetype outright ("a blunt rectangle straddling the haft is the whole
    read"); the flange notches were deepened instead. Also dismissed: mismatched
    sabaton lengths (that is the foot's own pitch and rotation) and the r5 crop
    complaints, which were fixed rather than argued with.
  - _Code review round 1_ (independent, fresh context). Two SEVERE findings,
    both genuine and both fixed:
    - **The punch never fired.** `punch` had `windup: 0`, so `beginAttack` put
      it straight into `'execute'` — and damage is only resolved on the
      windup→execute _transition_. The whole jab was an animation that hurt
      nobody, played no sound and skipped the first half of its own sprite row.
      `beginAttack` now always enters `'windup'`, and the punch's split is
      derived from the sheet's own impact frame via `punchTiming()`.
    - **The slam telegraph was being clipped away.** `Player.render` composites
      `drawSelf` into a box of `silhouetteMarginTiles` whenever the character is
      hit-flashing or carrying a status, and the slam disc is drawn up to 5.5
      tiles away — so the one warning the player has to read vanished every time
      the knight took a hit, i.e. constantly. The slam disc moved to
      `drawWorldFeedback` (outside the composite); the sweep ring stays in
      `drawSelf` because it is centred on him and inside the margin.
      Also fixed from that round: a dead `punchSoundPending` flag, the punch
      bypassing `harmless` and playing its thud with nobody in range, a hard-coded
      punch frame count that ignored `darkKnightAttackFrames()`, an unreachable
      `SLAM_MIN_RANGE_TILES` (removed — the sweep claims everything inside its
      ring first, so the slam's near edge is the sweep radius by construction),
      `TELEGRAPH_FULL_AT` being a span rather than the threshold its name claimed,
      a stale cell size in the cull-margin comment, and a missing
      `DeathCauseSystem` entry — dying to him reported "unknown". He now has three
      death causes (`darkKnight`, `darkKnightSlam`, `darkKnightSweep`) with copy
      in `DeathExplanations`. _Dismissed:_ the `clearAStarPath()`-in-idle repath
      cost, which is a house-wide pattern shared by `Mantid`, `EvilClown` and
      `SkeletonLord` and belongs in one systemic fix, not here.

  - _Art round 3_ (blind) and _code review round 2_ (independent). One SEVERE
    art finding, genuine and important: **the profile jab was drawn behind the
    torso**. `drawFigure` makes the off arm the far arm in every profile pose,
    so the punch was painted first and the body covered it — the reviewer
    measured the silhouette's bounding width as _dead constant across all eight
    frames_. `KnightPose` gained `leftArmInFront`, which the punch alone sets.
    Also fixed from that round: the rear cloak had no attachment point (it now
    springs from the full shoulder line rather than from a point between them);
    the back-of-helm rivets were dropped entirely (moved once already and still
    read as eyes — a pair of dots on an anonymous helm is a face wherever you
    put them); the armour mid-tone measured within 2% luminance of the floor-3
    grass and was lifted a step; the gore pauldron's lames are now cut into its
    outline rather than scored on top of it, the gore gauntlet is half again
    its size, and the gore mace's head was widened to match the weapon he
    carries. _Dismissed:_ the sweep ring being recoloured by the hit-flash
    composite — `GrotesqueSpider.drawSelf` does exactly the same with its
    screech ring, so it is the established precedent, and unlike the slam disc
    the ring is inside the composite's box and is never clipped.
    The code review's genuine findings, all fixed: the slam was near-unreachable
    (he pursues to 1.2 tiles and the sweep claimed everything inside 2.2, so a
    player who stood and traded would never see the boss's signature attack —
    the two now split by a weighted roll, and a slam at close range is still
    dodgeable because its point is locked for seventy frames); the gauntlet thud
    played on top of every slam and sweep that connected, because `dealDamage`
    raises `attackSoundPending` unconditionally; the `?darkknight` harness drew
    the telegraph on a schedule the game does not run and hand-copied the two
    radii the creature owns, in a file that explicitly refuses to hand-copy
    frame counts for the same reason (`darkKnightTelegraphFade` and both radii
    are now exported). _Dismissed:_ goblin spawn tiles being able to collide —
    separation physics untangles them on frame one, and the reviewer graded it
    cosmetic.

  - _Art round 4_ (blind). One SEVERE finding, and it was the third round in a
    row to report the same symptom: **the punch still did not read**. The pose
    stream was fine — a numeric dump showed the off hand travelling 0.94 tiles
    across the row — so the defect was in the _painting_, twice over. The arm
    forced in front was still being painted with the far-side ramp, three shades
    darker than everything around it, so a fully extended jab read as the body's
    own shadow; and it landed at shoulder height, arriving on top of the mace
    hand and the shaft rising past it. The arm now takes the near ramp when it
    is in front, and the fist lands at chest height, clear of the weapon. Also
    fixed from that round: the front slam's contact was a single frame with the
    head beside the hip rather than out in front (a one-frame contact hold, and
    the facing views keep more of the profile's forward reach); the mace's
    leather grip was long enough that over the shoulder it read as a bare
    forearm (cut to a fifth of the haft); the head's three equal parallel
    grooves read as fingers and the whole weapon as a fist on a stick (the
    flange spans are now unequal); and the gore arm and gore leg silhouetted
    alike, with the gauntlet a featureless lozenge (the arm's couter bulge was
    enlarged — it is the only thing separating two plated sticks at sixteen
    pixels — and the gauntlet gained a flared cuff to go with its knuckles).
    _Dismissed:_ the poleyn reading as a circle on the front idle (it is a
    hard-cornered hexagon; the ink border rounds it at review scale, and it is
    the mildest instance in the set by the reviewer's own account).

  - _Art round 5 and code review round 3_ (both blind/independent). The code
    review found two more genuine defects, both fixed: **the jab starved the
    specials** — `beginAttack` reset `pursuitTimer` for every attack including
    the punch, and the punch's cooldown is shorter than its own animation plus
    the state cooldown, so at melee range the counter never got past 1 and the
    45-frame gate on the special roll was never reached (only specials reset it
    now); and **the jab had become dodgeable**, because giving it an 11-frame
    wind-back meant a player could walk out of its 1.5-tile resolve radius
    before the blow, on the one attack whose damage source claims it cannot be
    dodged (the target is now captured at wind-up start and the resolve radius
    is sized from the wind-up's own travel). Also fixed: no guard that a
    hand-copied impact frame was inside its row (a shortened re-bake would have
    played the attack _backwards_ over one frame rather than failing), the
    preview drawing the ring one frame after the game stops it, `resetToSpawn`
    leaving the sound flags and the punch target, and two constants declared
    below their use sites. The art round found the jab still unreadable in the
    profile and away views: away it was painted behind his own back, and in
    profile it arrived into the same screen space as the shouldered mace and its
    rising shaft. The punch now hauls the mace back out of its lane, is never
    drawn behind the body, reaches further and grows the fist 70%. The sweep's
    whirl also started dead vertical, with the shaft rising out of the top of
    the helm and the gripping fist hidden behind the head — the orbit now begins
    a seventh of a turn off the vertical. _Dismissed:_ the sweep ring being
    recoloured by the hit-flash composite (moving it to `drawWorldFeedback`
    would paint a red wash over his own body, and `GrotesqueSpider` sets the
    precedent for keeping a self-centred ring in `drawSelf`); the head-on sweep
    and slam sharing a silhouette for their first three frames (they are
    distinguished by the ground circle, which is the actual tell the fight
    teaches); and `gore_arm` vs `gore_leg` at 16 px, which the same reviewer
    graded separable.

  **Not verified by this session.** The `!bounty` loop was never played in a
  browser: the encounter was exercised only through the bake gates, the offline
  harness and `?darkknight`. Timing and feel — windup lengths, whether ten
  goblins is chaos or soup, whether the shouldered carry reads in motion — need
  Ryan.
