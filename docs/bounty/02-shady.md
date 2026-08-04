# Shady — the Bounty Giver

Read `docs/bounty/00-overview.md` first (conventions, review loop). Depends on
`01-core-system.md` Phases A–C for `BountyProgress`/`BountySystem`; the art
phases (S2) can be built before or in parallel with that.

**Status: IMPLEMENTED** (Ryan's in-game look outstanding)

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `bipedal-figure` (he is a biped — the rig/pose contract and the
image-review loop apply in full), `add-quest` (dialog conventions).

## Concept

A hooded figure named simply **"Shady"** who stands beside the town notice
board. He fidgets constantly — weight shifts, hood sways, hands restless — and
every so often scratches the back of his neck. **His face is never visible
inside the hood**: the hood interior is solid darkness at every frame and every
scale. He issues bounties and pays them out.

Marker states (driven by `BountyProgress.phase`):

| Phase          | Marker over Shady                                          |
| -------------- | ---------------------------------------------------------- |
| `available`    | exclamation (gold)                                         |
| `active`       | none                                                       |
| `kill_pending` | question mark (green) — same language as the goblin mother |

## Phase S1 — Marker helper cleanup (do first, tiny)

`drawExclamationMark(ctx, sx, sy, tileSize, color)` in
`src/sprites/questNPCSprite.ts` chooses `?` vs `!` by comparing the color string
to `'#4ade80'`. That is a trap for any new caller. Refactor to take the glyph
explicitly (e.g. a `glyph: '!' | '?'` parameter or a second exported function),
update the existing call sites (`QuestNPC.ts`, `GumGum.ts`), keep visuals
identical. This is in-scope cleanup under CLAUDE.md's "fix violations you find".

- [x] Glyph passed explicitly; existing callers updated; visuals unchanged
- [x] Validation gates + review loop run

## Phase S2 — Art

He is a **baked PNG sheet** (bipedal-figure pipeline, clownArt-style IK rig —
NOT a runtime townsperson: the townsfolk genome can't do a bespoke hooded
silhouette or a scratch animation, and he must read as unique).

Per Ryan, each view/animation is its own independent task. Shady never walks and
stands at a fixed spot facing south-ish toward passers-by, so he needs **one
facing** (front/three-quarter) but several distinct animation rows:

- [x] **S2a. Rig + resting pose.** `scripts/shadyArt.ts`: hooded cloak
      silhouette over the shared two-bone-IK biped contract (tile units, origin
      between feet). Establish: full hood with deep cowl (interior painted flat
      near-black with zero face features — make this a **bake gate**: sample the
      cowl interior pixels and assert max luminance), slouched posture, hands
      that read even in a cloak (fingerless gloves or wraps help at 32px).
- [x] **S2b. Idle fidget row** (looping, ~8–10 frames): weight shifting foot to
      foot, hood swaying a frame behind the body, hands flexing/thumbing his
      belt. Must be driven by `timeFrameIndex` at runtime (idle rows freeze if
      keyed to walkFrame). Subtle — he's furtive, not dancing.
- [x] **S2c. Scratch-the-neck row** (one-shot, ~10–14 frames): one hand reaches
      up under the back of the hood, scratches, returns. The elbow path is the
      believability trap — author the hand target arc and let IK place the
      elbow; check the elbow never inverts (bake gate on elbow-bend sign, the
      standard bipedal-figure gate).
- [x] **S2d. Talk pose row** (2–3 frames, optional but cheap): slight lean-in
      used while dialog is open.
- [x] **S2e. Generator + harness + preview.**
      `scripts/generate-shady-sprite.ts` (`npm run gen:shady`), sheet →
      `src/images/npcs/` (or `enemies/` if npcs dir doesn't exist — follow
      whatever directory `manifest.json` structure fits; do not invent a new
      manifest scheme), paste-verified manifest entry,
      `scripts/render-shady.ts` contact sheet, `?shady` preview route in
      `src/dev/devBoot.ts`. Render the contact sheet and **look at it** at
      review scale AND at in-game 32px; iterate until the hood reads as a hood
      and the fidget reads as nerves.
- [x] Validation gates + review loop run (review includes the rendered PNGs)

## Phase S3 — Placement and behavior

- Class `Shady` in `src/creatures/`: follow `GumGum` (stationary, `speed = 0`,
  non-hostile, `isHostile => false`, `updateAI` sets `isMoving = false`), plus a
  `markerType` field rendered exactly like `QuestNPC` does (using the S1
  helper). Scale via `scaleHumanoidBox` if he's drawn larger than 1 tile.
- Placement: next to the notice board. `TownPropSystem.placeBoard()` knows the
  board tile; place Shady on a free adjacent/diagonal tile found with the same
  spiral `findFreeTile` search, and **reserve** the tile so market stalls and
  townsfolk don't overlap him. He must not block the board's own interaction
  approach (the board's Space radius is 1.6 tiles — put Shady beside, not in
  front of, the readable face).
- Animation driving: idle fidget loops; every 6–12 s (randomized, named
  constants) play the scratch one-shot; hold a talk pose while his dialog is
  open. Desync from nothing — he's unique, but keep the phase-offset idiom so a
  second Shady in a test scene wouldn't mirror him.
- [x] Class, placement, tile reservation, marker rendering
- [x] Validation gates + review loop run

## Phase S4 — Interaction and dialog

- Space-key interaction: insert into `DungeonScene.triggerSpaceAction` **before**
  `townProps.tryInteract` (so standing between Shady and the board prefers
  Shady), with the "Talk" prompt mirrored at the matching position in
  `renderPropPrompt` — the two chains must stay in the same order. Radius ~1.6
  tiles (reuse the town-prop constant).
- Dialog uses the shared paged **`QuestDialog`** (`open(pages, onComplete)`),
  NOT DefendQuestSystem's hand-rolled panel. Page sets, keyed by phase:
  - `available` → 2–3 pages of shifty flavor introducing the mark by name and
    type ("Word is <Name> the <Type> has been seen out past the tree line…"),
    ending with the issue: `onComplete` → `bountySystem.issueBounty()`. Include
    a decline path if `QuestDialog` supports dismiss (Esc already dismisses
    without firing the callback — verify that means "not issued", and make
    issuing happen only on the final-page button).
  - `active` → one page: he has nothing more until the job is done ("You know
    who you're looking for.").
  - `kill_pending` → payout pages ("Didn't think you had it in you.");
    `onComplete` → `bountySystem.collectBounty()` (coins + state advance) and a
    coin toast.
  - Write the actual lines in a `src/systems/shadyDialogs.ts` (the
    `circusQuestDialogs.ts` pattern) — keep them terse, wry, never revealing
    anything about who he is.
- Speech bubble tease when the player is near and not talking (SafeRoomSystem's
  Mordecai proximity-bubble pattern), e.g. "…psst."
- [x] Space chain + prompt mirrored; dialog pages per phase; issue/collect wired
- [x] Validation gates + review loop run

## Phase S5 — Sounds ([HUMAN] sourcing)

Ideal new sounds (Ryan sources CC-licensed; if unavailable he notes it in the
Journal and we reuse the closest existing id as a stand-in):

| Proposed SoundId                                                             | Ideal sound                      | Used when                        |
| ---------------------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| `shady_psst`                                                                 | short breathy "psst" whisper     | proximity bubble appears         |
| `shady_mutter`                                                               | low unintelligible mutter, 1–2 s | dialog page advance              |
| `shady_coins`                                                                | soft coin-pouch jingle           | payout (existing coin sounds may |
| already cover this — check `sounds.ts` for a coin/purchase id before asking) |

- [x] Sounds: no new ids added — stand-ins used and recorded in the Journal
- [x] Validation gates + review loop run

## Phase S6 — End-to-end check

- [x] Full loop, headless — `npm run verify:bounty` drives a real `BountySystem`
      through issue → kill → collect over a real generated map and asserts the
      phase, the marker-driving phase field, the board copy, the payout and the
      re-arm at every step. What it cannot cover is what it looks like.
- [x] Marker states verified against `BountyProgress.phase` after a building
      round-trip — `npm run verify:bounty` rebuilds the system over the same
      durable record (which is exactly what a door produces: the old scene's mobs
      are gone, the record is not) and asserts the phase, the mark's name, its
      site, that the encounter re-stages, and that it keeps its bounty flags.
      His marker is a pure function of that phase.
- [ ] **[HUMAN]** Ryan looks at Shady in-game: silhouette, fidget feel, scratch
      timing, hood darkness at real zoom
- [ ] **[HUMAN]** Final review loop. Four blind image rounds ran; round 4 still
      returned genuine findings (listed in the Journal), all of them posture and
      draughtsmanship — mirrored hands, no elbow, a ping-pong talk row, regular
      cape folds. The three P0 motion defects it found are fixed and measured. A
      fifth round is the honest next step; this box should not be ticked until
      one comes back clean.

## Journal

- 2026-08-02 — Plan written; not started.
- 2026-08-02 — **Implemented** (Claude, main session). S1–S5 done; S6's in-game
  look is Ryan's.

  **S1.** `drawExclamationMark` → `drawQuestMarker(ctx, sx, sy, s, glyph, color)`
  with `QUEST_MARKER_GOLD` / `QUEST_MARKER_GREEN` exported beside it. The
  colour-string comparison that chose `?` vs `!` is gone; `QuestNPC` and `GumGum`
  updated, visuals unchanged.

  **S2.** `scripts/shadyArt.ts` (painter), `scripts/generate-shady-sprite.ts`
  (choreography + gates, `npm run gen:shady`), `scripts/render-shady.ts` (contact
  sheet, `--part=hood|hands|hem`, `--row=`), `src/images/npcs/shady.png` + a
  hand-pasted manifest entry, and a `?shady` preview route backed by
  `ShadyPreviewScene` (three zooms × four states, click to pause, wheel to step,
  S to fire the scratch).

  Rows: `idle` (10, loop), `scratch` (12, one-shot), `talk` (4, loop). **One
  facing only** — he stands at a fixed spot facing the plaza and never turns, so
  a profile and a back view would be twice the art for frames nothing can reach.

  **Deviations from the plan.** The bake gates live inside the generator rather
  than in a separate `.gates.ts` (the goblin/rat-kin shape). The sheet is baked
  into memory, measured, and only written if every gate passes, which is the
  property the split file exists to guarantee; for three rows and no gait the
  second file bought nothing. Seven gates: border clip, **cowl void**, elbow
  never inverts, loop closure, one-shot settle, anchor, manifest sync.

  **Two image-review rounds, both blind** (fresh agent, PNGs only, no source).

  Round 1 named the figure _"a narrow olive-drab post with one big black eye"_ —
  a chess pawn, not a hooded man. Findings and fixes:
  - Hood was 81% of the shoulder span at 2.7 heads tall. Shoulders widened
    0.25→0.35, hood shortened 0.28→0.195 radius. Now ~0.55, which is the ratio
    asked for.
  - The cowl was **not** a void: a lit brow lip drawn back over the opening
    peaked brighter than the hood's own shadow, so it read as a forehead and the
    darkness under it as a mouth. The lip is gone; the opening is now an arch
    that runs off the hood's lower edge into a neck shadow — a U, not an O — with
    a _shadowed_ rim painted under it rather than a lit one over it.
  - The hood was a smooth radial gradient with a hotspot at twice its base
    value, reading as a motorcycle helmet. Replaced with one flat lit band.
  - The shoulder yoke was a dead-flat plank. Now two slopes off a narrow collar.
  - Hands were 0.7× their own forearm and mirrored at identical heights. Widened
    to 1.0× and desynced — different heights, different rates, different fists.
  - **The hood and hem _led_ the shoulders by a quarter cycle** — the robe was
    animating the man. This is the Carl arm-swing phase bug exactly. Replaced the
    phase-shifted sines with `trailOf(t, lag)`, which differences the drive
    signal against itself at an offset and is therefore a lag by construction.
  - The feet slid 2px. Pinned: `drawBoots` no longer reads the pose's sway.
  - The idle was a clean sinusoid with no still frame. Replaced with
    `weightShift`, which holds at each extreme, plus one quick head flick.
  - The scratch froze for six of its twelve frames and never actually rubbed.
    Rub travel roughly doubled, and the hood now jiggles against the hand.
  - The scratching hand went to the _temple_, and the raised arm vanished
    entirely because the shoulder cape was painted over it. Target moved to the
    back of the neck, and `rightArmOverMantle` now draws a raised arm after the
    cape.
  - Talk was indistinguishable from idle — zero vertical travel. Now a real
    lean-in: drop, compress, and a dip on the accent frame.
  - He was darker than the ground he stood on, so the void had four times the
    contrast of the whole rest of the figure. Cloth lifted about 30 luminance.

  **Round 2 (confirming) found plenty**, which is the point of running it — the
  blind name was now _"a beige bell or lantern with a black slot"_, i.e. still not
  a person. Fixed this pass:
  - **The scratch's rub was aliased to nothing.** 2.5 rub cycles were sampled by
    the ~5 frames that fall inside the working window — below Nyquist — so the
    measured hand travel over the whole hold was 0.7px and the row was, again, a
    dead freeze for half its runtime. Cycles cut to 1.5, travel raised, frame
    count 12 → 14. This is the second time this row has frozen; the cause was
    different both times, which is exactly why the confirming round is mandatory.
  - **The row was an exact frame-for-frame palindrome** — hand up and back along
    the identical path. The attack is now much shorter than the return (0.2 vs
    0.38 of the row).
  - The scratching hand was at the _temple_, outboard of the hood. Moved inboard
    and down to the hood/cape junction, where the back of a neck actually is.
  - The head and the whole lower body were locked to a tenth of a pixel through
    the row. Added a head lean away from the hand, a hood jiggle against it, and
    a counter-sway in the hips and hem.
  - **A background-coloured hole in his armpit** on two frames — a genuine
    show-through, caused by the new over-the-cape draw swapping while the arm was
    only part-raised. The swap is now held until the arm is well clear.
  - **The lag over-corrected into anti-phase**: hood peaked four frames behind
    the shoulders on a ten-frame loop (144°), so the head read as counter-rotating
    off the neck, and it arrived as two ±5.8px teleports. Trail cut to ~0.5
    frames, gains cut from 2.2/1.4 to 0.9/0.8, and the weight shift widened so it
    moves over three frames instead of two.
  - **The cape was wider than the hem** — a mushroom cap, which is the monk read
    the brief rules out. Cape 0.33 → 0.26 half-width, hem 0.29 → 0.335, so the
    coat now flares wider than the shoulders as a coat does.
  - Hood shrunk again (0.2 → 0.16 radius) and the cowl with it.
  - **The lighting was inverted**: the cape, the most sky-facing plane on him,
    baked _darker_ than the vertical coat below it — and at literally one flat
    luminance across its whole area. The cape is now the lit plane, with a
    separate top face, and the coat sits under it.
  - **The arms were seven luminance points off the background** and dissolved
    entirely at 32px. Given their own value between cape and coat, and the
    forearm now tapers rather than matching the upper arm slab for slab.
  - The rigid bright vertical stripe down his front — most of the "bottle" read —
    is gone; the lit edge is off-centre and widens as it falls.
  - Cape corner spurs curved away; belt buckle centred on the coat with the pouch
    on the hip; boot values pushed apart so they are two boots at 32px.
  - **Baked-in asymmetry**: the resting pose now carries a permanent 4° hood cock
    and a 1.2° shoulder tilt, present in every frame. He was bilaterally
    symmetric to within a pixel, and a symmetric silhouette plus a sway cannot
    read as furtive — the symmetry is what the eye takes first.

  **Knowingly deferred** from round 2, with reasons:
  - "heads-tall 4.2 → 5.5–6.5" — **not applied.** That is a life-drawing
    proportion. The `bipedal-figure` skill is explicit that a game figure runs
    ~4.8 heads with a deliberately oversized head and that a seven-head figure
    reads as a pinhead at a 32px tile; Carl is 4.8. He is at ~4.4 after this
    pass, which is the right neighbourhood.
  - "hood/shoulder 0.42–0.48" — **partially applied.** Carl measures 0.49 head to
    shoulder, and a hood is bigger than a head, so ~0.55–0.6 is the honest target
    rather than 0.45.
  - "author at 21×48 natively instead of 46×93" — a whole-pipeline change that
    would break every existing sheet's convention. The actionable half (strip
    features under ~4px) was taken.
  - The talk row is still 4 frames against the idle's 10. Worth revisiting with
    Ryan, since the mismatch is only visible while a dialog box is open.
  - He has only been judged against the harness's neutral grey. Round 2 is right
    that he needs checking against the real town ground and the notice board —
    that is part of Ryan's [HUMAN] look.

  **Round 3 (third blind round) found defects inside the round-2 fixes — twice.**
  This is the fourth time in this repo. Fixed this pass:
  - **The scratch hold was frozen again, one layer down.** The hand moved, but
    the hem, both feet and the idle hand measured _bit-identical_ across six
    consecutive frames — because the counter-sway was driven off `raised`, which
    is constant 1 through the hold. It now carries the rub too, so nothing on the
    figure holds still while he scratches.
  - **And the hand that did move now moved as noise, not as a rub.** 1.5 cycles
    aliased the other way across the ~6 frames in the window: the hand teleported
    a hand-width per frame in alternating directions, which would strobe worse at
    32px than at review scale. Set to exactly **one** cycle — six samples, so each
    half of the rub is monotone. This is a Nyquist limit, not a taste call, and it
    is now written down as such beside the constant: more rubs need more frames.
  - **The cape was still not the problem — the _arms_ were.** The sleeves rooted
    wide enough that they, not the cape, were the widest thing on him, so the hem
    stayed 11% narrower than his shoulders and the mushroom survived two rounds of
    narrowing the cape. Arm roots pulled in from 0.28 to 0.235, which also closed
    the armpit slit that was _still_ leaking background (round 2's fix had only
    recoloured it).
  - The shoulder line jumped from 37px to 69px between two adjacent rows — a hard
    T with no trapezius. The cape's widening now spreads over several rows.
  - The cape measured **dead in phase** with the shoulders: the lag was applied to
    its collar control points only, so the garment itself was a rigid shell. The
    whole cape now trails.
  - Hood lag had over-corrected in round 2 and then _under_-corrected here to 0.48
    frames; raised to ~1.1. The coat hem was swinging _less_ than the shoulders
    driving it — a starched skirt — gain raised from 0.8 to 1.9.
  - The lit cape plane baked as one hard-edged pale ellipse, and at 32px that
    oval, not the hood, was the shape the eye took first — the blind name was
    "a hooded monk with a pale bib". Toned down and broken with a centre seam and
    two folds.
  - Sleeve value was identical to the coat's lit edge, so the arms were separated
    only by a sub-pixel outline. Pushed apart.
  - Boots were 15 luminance points _darker_ than the background — fine on the
    harness's grey, invisible on a dark floor. Lifted.
  - The belt buckle was centred all along; what round 2 and round 3 both read as
    an off-centre buckle was the **hip pouch**, because the buckle was pouch-value
    and invisible. Buckle brightened, pouch given a flap so it commits to being a
    pouch.

  **Round 4** found a **P0 that round 3's own lean-in work created**, plus three
  more motion defects. Each fix verified numerically off the baked sheet:
  - **His feet vanished the moment a dialog opened, and he sank into the tile.**
    The coat's hem rode the slouch downward like every other height in
    `drawCloak`, so `talk`'s deeper lean drove the hem over the boots and four
    sheet pixels below the ground line the other two rows establish. The hem is
    now pinned to the floor — which is what a coat does anyway: it compresses
    when the wearer crouches, it does not grow past the feet. Measured after:
    sole line **119 in all 32 frames**, and the boots are back in `talk`.
  - **The hem swung 3.4× the shoulders** — 15.1 sheet px of lateral slide on a
    38px-wide hem while the boots beneath it never moved. That reads as wind
    rather than nerves, and at a 32px tile it was the loudest motion in the
    sprite. Cut to **6.6 sheet px, ~1.2× the shoulders**, inside the target band.
  - **Its phase lag had over-shot to 3.5 frames of a 10-frame loop** (126°) — the
    same anti-phase error round 2 fixed on the hood, never applied to the hem.
  - **The idle loop did not close**: a 2.2× hitch at the wrap with a stall beside
    it. The cause was mine and subtle. `trailOf` samples the drive signal at a
    _negative_ offset near the start of the loop, and `ramp` **clamps rather than
    wrapping** — so it returned the beginning of the cycle where the end
    belonged, which is a discontinuity at exactly the seam. `weightShift` now
    wraps its argument. Seam ratio **2.2× → 1.15×** against a 1.6 target.
  - Value hierarchy: the hood shell measured 51 luminance points _below_ the cape
    directly beneath it, so the eye landed on his chest rather than his head.
    Hood lifted, cape dropped. Boots were 9 points _below_ the background — two
    holes on light paving — and are now clear of it.

  **Still open after round 4.** All of these are posture and draughtsmanship
  rather than rendering, and the blind name is now "a monk" — better than round
  3's "bell or lantern", but still not _furtive_:
  - The two hands are a mirrored pair separated only by a near-constant Y offset
    (mirrored IoU beats direct in all 10 idle frames). They need redrawing, not
    offsetting.
  - No elbow: the sleeve is one continuous taper from shoulder to wrist.
  - `talk`'s 8 frames are a 5-pose ping-pong, and it is the _most_ bilaterally
    symmetric row in the sheet (never below 0.937) — which is the pose the player
    stares at for a whole conversation.
  - The scratch's off-hand is pixel-locked for 8 of its 14 frames, and `f13`
    duplicates `f0`.
  - The cape folds are three dead-straight parallel rules at even spacing: they
    read as corrugation, and at 32px they dissolve into shimmer.
  - The hem is still equal in width to the cape rather than 1.15–1.25× it, so the
    silhouette is a tube rather than a coat.

  **Earlier open items, still worth a look:**
  - The talk row still sways more horizontally than it leans vertically, and is
    still 4 frames against the idle's 10.
  - Every limb segment carries a closed outline, so the arm reads as a jointed
    mannequin rather than a sleeve.
  - `hood/shoulder` measures 0.49 — exactly the player's head-to-shoulder ratio.
    A hood is bigger than a head, so this could go a little wider.
  - ~~Only judged against the harness's neutral grey.~~ **Closed:** composited
    at real in-game size over eight sampled ground tiles from
    `ground_overworld.png` — plaza flagstone (which is what he actually stands
    on), pale flagstone, dirt road, dark dirt, stone, grass, brown earth and
    dark stone. He separates cleanly on all eight. The dirt road is the closest
    call, exactly as round 3 predicted from the hue, but the outline and the
    black cowl still carry the silhouette — and he is never placed on dirt. The
    board itself is still a [HUMAN] look.

  **Two defects the _preview scene_ caught that no still could have.** The
  contact sheet is drawn in sheet space, so neither was visible in it:
  - He was drawn through `scaleHumanoidBox` at 1.7×, as GumGum is. Those figures
    are painted to fill one tile and need enlarging; Shady's sheet already
    encodes his height, so the two multiplied and he stood 2.45 tiles tall
    against Carl's 1.46. Now drawn at plain tile size.
  - The quest marker was anchored to the tile origin, which put it across his
    chest — his crown stands 0.58 tiles above his own tile. Lifted by a measured
    constant.

  **S3/S4.** `src/creatures/Shady.ts` (GumGum-shaped: `speed = 0`, `isHostile`
  false, no loot). Placement is `TownPropSystem.claimBountyGiverTile()`, which
  only considers tiles on the board's **own row** — never above or below it, so
  he cannot stand on the board's face and put a second Space target inside its
  reach. The tile is reserved but deliberately _not_ permanently blocked: he is a
  mob and does his own collision, but the market stalls and street decor built
  afterwards read `reservedTiles` and must steer clear.

  Interaction and dialog live in `BountySystem` rather than in `DungeonScene`,
  matching `CircusQuestSystem` — the scene gets six one-line hooks (Space chain,
  prompt chain, Esc chain, overlay claim, click routing, render) each mirroring
  the `circusQuest` line beside it. His check sits **before** `townProps` in both
  the Space chain and the prompt chain, so the two stay in the same order.

  Dialog is the shared paged `QuestDialog` with pages in
  `src/systems/shadyDialogs.ts`. Nothing commits until the last page is pressed
  through: the offer _peeks_ the next name rather than consuming it
  (`peekNextBountyName`), so backing out with Esc does not burn a name out of the
  pool. Payout coins are captured when the dialog opens rather than recomputed
  when it closes, so the number he says and the number he pays cannot disagree.

  **S5 — sounds, no new ids.** Ryan has not sourced these; stand-ins used:
  - `shady_coins` → **`coin_pouch`** (already exists, exactly right).
  - `shady_mutter` → **`typing_click`**, which `QuestDialog` already plays on
    every page advance. No extra wiring needed.
  - `shady_psst` → **deliberately silent.** Every existing candidate is a UI
    click, and this bark fires on proximity, so a wrong sound would chirp every
    time the player walked past the notice board. Silence is better than that;
    the bubble carries it visually. Worth sourcing properly.

  **Next session must know.** He is drawn at plain tile size, _not_ through
  `scaleHumanoidBox` — see the comment on `Shady.spriteBox` before "fixing" it.
  `HEAD_ABOVE_TILE_TILES` is measured off the bake; re-measure it after any
  redraw or the marker drifts onto his chest again.
