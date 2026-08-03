# Shady — the Bounty Giver

Read `docs/bounty/00-overview.md` first (conventions, review loop). Depends on
`01-core-system.md` Phases A–C for `BountyProgress`/`BountySystem`; the art
phases (S2) can be built before or in parallel with that.

**Status: NOT STARTED**

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

- [ ] Glyph passed explicitly; existing callers updated; visuals unchanged
- [ ] Validation gates + review loop run

## Phase S2 — Art

He is a **baked PNG sheet** (bipedal-figure pipeline, clownArt-style IK rig —
NOT a runtime townsperson: the townsfolk genome can't do a bespoke hooded
silhouette or a scratch animation, and he must read as unique).

Per Ryan, each view/animation is its own independent task. Shady never walks and
stands at a fixed spot facing south-ish toward passers-by, so he needs **one
facing** (front/three-quarter) but several distinct animation rows:

- [ ] **S2a. Rig + resting pose.** `scripts/shadyArt.ts`: hooded cloak
      silhouette over the shared two-bone-IK biped contract (tile units, origin
      between feet). Establish: full hood with deep cowl (interior painted flat
      near-black with zero face features — make this a **bake gate**: sample the
      cowl interior pixels and assert max luminance), slouched posture, hands
      that read even in a cloak (fingerless gloves or wraps help at 32px).
- [ ] **S2b. Idle fidget row** (looping, ~8–10 frames): weight shifting foot to
      foot, hood swaying a frame behind the body, hands flexing/thumbing his
      belt. Must be driven by `timeFrameIndex` at runtime (idle rows freeze if
      keyed to walkFrame). Subtle — he's furtive, not dancing.
- [ ] **S2c. Scratch-the-neck row** (one-shot, ~10–14 frames): one hand reaches
      up under the back of the hood, scratches, returns. The elbow path is the
      believability trap — author the hand target arc and let IK place the
      elbow; check the elbow never inverts (bake gate on elbow-bend sign, the
      standard bipedal-figure gate).
- [ ] **S2d. Talk pose row** (2–3 frames, optional but cheap): slight lean-in
      used while dialog is open.
- [ ] **S2e. Generator + harness + preview.**
      `scripts/generate-shady-sprite.ts` (`npm run gen:shady`), sheet →
      `src/images/npcs/` (or `enemies/` if npcs dir doesn't exist — follow
      whatever directory `manifest.json` structure fits; do not invent a new
      manifest scheme), paste-verified manifest entry,
      `scripts/render-shady.ts` contact sheet, `?shady` preview route in
      `src/dev/devBoot.ts`. Render the contact sheet and **look at it** at
      review scale AND at in-game 32px; iterate until the hood reads as a hood
      and the fidget reads as nerves.
- [ ] Validation gates + review loop run (review includes the rendered PNGs)

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
- [ ] Class, placement, tile reservation, marker rendering
- [ ] Validation gates + review loop run

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
- [ ] Space chain + prompt mirrored; dialog pages per phase; issue/collect wired
- [ ] Validation gates + review loop run

## Phase S5 — Sounds ([HUMAN] sourcing)

Ideal new sounds (Ryan sources CC-licensed; if unavailable he notes it in the
Journal and we reuse the closest existing id as a stand-in):

| Proposed SoundId                                                             | Ideal sound                      | Used when                        |
| ---------------------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| `shady_psst`                                                                 | short breathy "psst" whisper     | proximity bubble appears         |
| `shady_mutter`                                                               | low unintelligible mutter, 1–2 s | dialog page advance              |
| `shady_coins`                                                                | soft coin-pouch jingle           | payout (existing coin sounds may |
| already cover this — check `sounds.ts` for a coin/purchase id before asking) |

- [ ] Sounds registered in `SOUND_IDS_TUPLE` + `SOUND_MANIFEST` (or stand-ins
      recorded in Journal); wired at the trigger points
- [ ] Validation gates + review loop run

## Phase S6 — End-to-end check

- [ ] Full loop with a real or placeholder bounty: exclamation → talk → issued
      (marker gone, board updated, arrow up) → kill → question mark → talk →
      paid → exclamation again
- [ ] Marker states verified against `BountyProgress.phase` after building
      entry/exit round-trip
- [ ] **[HUMAN]** Ryan looks at Shady in-game: silhouette, fidget feel, scratch
      timing, hood darkness at real zoom
- [ ] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.
