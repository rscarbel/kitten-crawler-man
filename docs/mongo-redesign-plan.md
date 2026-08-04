# Mongo Redesign Plan — Pet Velociraptor Rework

**Status: COMPLETE except [HUMAN] items** — every A/G/W phase is coded, gated and reviewed except W2, which is a `[HUMAN]` item because browser automation could not run it (see §11 and the W2 entry). The seven `[HUMAN]` boxes in §11 are the whole remaining list.

This plan redesigns Mongo — the Mongoliensis pet raptor — end to end: a complete art rebuild
(three growth-stage spritesheets with full walk/attack animation sets), a rework of his
summon/health lifecycle, always-aggressive combat AI, and integration into the ability
leveling system as a level 1–15 pet.

It is written to be executed by Claude Sonnet agents over many looped sessions in a single
day, concurrently with other agents working elsewhere in this repo. Read the whole plan
before starting any phase. **Every rule in `CLAUDE.md` applies** (strict type safety, no
`as` casts, no `!` assertions, no magic numbers, comments explain _why_, validation gates).

---

## 0. Hard rules for every agent working this plan

1. **NEVER commit.** No `git commit`, no `git push`. The user will review and commit.
2. **NEVER run `git stash`** — other agents' in-progress work would be destroyed.
3. **Other agents are editing this repo right now** (status-effect visuals in
   `src/sprites/status/` + `src/core/silhouetteComposite.ts` + `StatusPreviewScene`,
   floor-3 overworld performance, and the spider room / `GrotesqueSpider` /
   `SpiderQuestSystem` / life-machine files). Do not touch those areas. For shared files
   you _must_ edit (`src/scenes/DungeonScene.ts`, `src/dev/devBoot.ts`,
   `src/images/enemies/manifest.json`, `sw.js`, `package.json`, `tsconfig.scripts.json`,
   `src/systems/DungeonUIRenderer.ts`), **re-read the file immediately before editing**,
   make the smallest additive edit possible, and never reformat or rewrite whole files.
4. **Line numbers in this plan are a snapshot** taken 2026-08-02. Concurrent edits will
   drift them. Always locate code by searching for the named symbol, never by blind line
   number.
5. **`src/images/enemies/manifest.json` is shared.** The generator must _verify_ its
   entries and print the JSON to paste on mismatch (the `verifyManifest()` pattern in
   `scripts/generate-rat-sprite.ts`) — it must never rewrite the file. Hand-add the three
   new entries in one small, surgical edit.
6. **Validation gates** after every code phase: `npm run typecheck`, `npm run lint`,
   `npm run format` — all must pass before a phase may be marked complete.
7. **Every phase gets an independent review** (see §2 protocol). Per project memory:
   _a fix can entrench the bug it fixed_ — after fixing review findings, always run one
   more confirming review round with a fresh agent.
8. Progress is tracked **in this file** (checkboxes + the Progress Log in §12). Update
   both every time you finish or hand off work.
9. If you hit a `[HUMAN]` item, log it and move on — never block the loop on it.
10. Skills to load before the relevant phases: `game-architecture` (always, first),
    `bipedal-figure` (all art phases — Mongo is a biped), `add-sprite`, `add-ability`,
    `add-creature`, `add-ui`, `add-sound`, `dev-workflow`.

---

## 1. Creature brief (source material)

Mongo is a **Mongoliensis** — literally a velociraptor — classified in the dungeon lore as
a **pet**. He belongs to Donut (the cat player).

**Look:** As an adult he should read like the raptors from Jurassic Park — lean,
horizontal-spined, muscular, menacing — but **feathered**. He is **blue** with **pink
feathers** in three places: a crest on his head, on his arms (which are wing-like because
of the feathering), and a fan at the end of his tail. The goal is _very realistic and
convincing as a dinosaur_ — the current sheet fails at this and is being fully replaced.

**Growth stages** (driven by pet level, §6):

| Stage      | Levels | Sheet key          | Read                                                                                                                                                                                          |
| ---------- | ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Juvenile   | 1–4    | `mongo_juvenile`   | Small, fluffy pink down, oversized head and eyes, short snout, stubby tail, bouncy chick-like energy                                                                                          |
| Adolescent | 5–9    | `mongo_adolescent` | Lankier, adult proportions emerging, down receding to flanks, crest growing in, gawky but fast                                                                                                |
| Adult      | 10–15  | `mongo_adult`      | Full JP-raptor build: long low body, S-curved neck, stiff counterbalancing tail with pink fan, full pink head crest, wing-like feathered forearms, defined musculature, pebbled scale texture |

**Palette (all stages):** body a rich steel/royal blue with darker navy dorsal striping
(tiger-style broken bars), pale blue-cream underside from throat to tail base; pink
display feathers (crest / forearm wings / tail fan) with a slightly deeper magenta at the
feather roots; yellow eye with slit pupil; dark keratin claws and sickle toe-claw; teeth
visible in bite frames.

---

## 2. How to run this plan (loop protocol)

Each loop iteration of the working session:

1. Read this file top to bottom. Read the Progress Log (§12) to see the last state.
2. Pick the **first unchecked task** whose dependencies (listed per phase) are met.
   The art track (Phases A1–A6) and gameplay track (Phases G1–G5) are independent until
   Phase W1 — two agent teams can run them in parallel.
3. Load the skills that phase names. Do the work with sub-agents where parallelizable
   (per `CLAUDE.md`, use them liberally: exploration, gate runs, reviews).
4. Run the phase's validation gates. All must pass.
5. Spawn an **independent review agent** (fresh context; give it only this plan file, the
   phase name, and the diff/artifacts — not your reasoning). It reports findings.
6. Fix findings, re-run gates, then spawn a **second, different reviewer** for the
   confirming round. Only when the confirming round finds nothing blocking may you tick
   the checkbox.
7. Append a Progress Log entry (§12): date/time (`date -u`), phase/task IDs, what changed
   (files), gate results, review-round outcomes, and anything the next agent must know.
8. Repeat until every non-`[HUMAN]` box is ticked, then set the Status line at the top to
   `COMPLETE except [HUMAN] items`.

**Image review protocol (art phases).** Reviewer agents must actually _look at_ rendered
PNGs (Read the image files) — never approve art from code. Each art review round: render
the contact sheet(s), have the reviewer score against the rubric in §5.6, fix, re-render,
confirm with a fresh reviewer. Minimum **three review rounds per sheet**, and the final
round must be a no-findings confirming round.

**Browser checks.** Browser automation can drive the game (project memory): rAF, keyboard,
and synthetic canvas MouseEvents all work. Before trusting any browser check, unregister
the service worker (it serves a stale bundle — project memory). Timing/feel judgments
still go to `[HUMAN]`.

---

## 3. Current state (survey snapshot, 2026-08-02)

Core files:

- `src/creatures/Mongo.ts` (~273 lines) — `Mongo extends Mob`. Floor-scaled stats via
  `mongoStatsForFloor(levelId)` (hp 20/35/60, scale 0.7/1.0/1.5 by floor — **this
  floor-based axis is being replaced by pet level**, §6). AI: scans `this.allMobs` for
  nearest alive `isHostile` mob within `AGGRO_RADIUS_TILES = 12` of the cat, leashes back
  to the cat past 12 tiles, bites with `BITE_RANGE_TILES = 0.9`, `ATTACK_COOLDOWN = 50`,
  `ATTACK_ANIM_FRAMES = 12`. Bite calls `nearest.takeDamageFrom(this.biteDamage,
this.owner, 'melee')` — damage credited to the cat. `isHostile` returns `false`;
  `xpValue = 0`; no loot.
- `src/systems/MongoSystem.ts` (~322 lines) — lifecycle: `unlocked`, `mongo`,
  `cooldownFrames` (90 s after despawn), `summon(cat, gameMap, levelId)`,
  `startRecall()`, `dismiss()`, `checkHealth()` (intercepts hp ≤ 0 → sets hp = 1 and
  starts the recall run so Mongo never dies), `renderSummonButton(...)`, speech bubbles.
  **Known defects:** lines ~111–126 contain a dead if-block and redundant duplicate
  hp checks (self-admitting comment) — must be cleaned up in G1.
- `src/sprites/mongoSprite.ts` — `drawMongoSprite` / `drawMongoIcon` over the legacy
  sheet; 2-facing only (`flipX = facingX < 0`), draw priority attack > walk > idle.
- Legacy art: `src/images/enemies/mongo.png` (128×96 frames, 3 rows:
  walk×8 / idle×1 / attack×6) + the `mongo` entry in
  `src/images/enemies/manifest.json` (~line 514).
- Scene wiring in `src/scenes/DungeonScene.ts`: summon via **R key**
  (`DungeonInputHandler.ts` — note R is shared with `buildAction()`) and the summon
  button (desktop ~lines 3762–3773; mobile `DungeonUIRenderer.ts` ~454–470);
  `triggerMongoSummon()` ~2413; unlock via the Krakaren Clone boss chest ~1466–1478
  (`mongoSystem.unlocked = true` + `_makeMongoReward()` dialog ~5120); dismissal on
  floor transition ~1115 and building entry ~1148; `extraTargets` push ~3999 (mobs can
  already attack Mongo); `checkHealth()` call ~4296.
- Circus quest integration: `CircusQuestSystem.ts` jams `mongoSystem.cooldownFrames =
MONGO_KIDNAP_LOCK_FRAMES (999999)` while Mongo is kidnapped, restores 0 on resolution;
  `circusQuestDialogs.ts` keys dialog on Mongo presence. `CircusQuestProgress.mongoKidnapped`.
- Audio: `mongo_released`, `mongo_slash` in `src/audio/sounds.ts`; `GameLoopPhases.ts`
  plays `mongo_slash` for `audioTag === 'mongo'`.
- Persistence: `mongoUnlocked` is threaded scene-to-scene via `DungeonSceneOptions` but
  is **not saved to disk** (`SaveProgressFn` carries only player snapshots + levelId +
  abilityStates). No level, no XP, no HP persistence. Fresh `Mongo` constructed per
  summon → HP resets every summon.
- Precache: `sw.js` lists `enemies/mongo.png` (~lines 50, 270).
- `scripts/svgSubjects.ts` ~599–607 has a legacy mongo review subject (retire in W3).

Gaps identified by the survey that this plan closes (beyond the user requirements):
follow-hysteresis jitter (Mongo uses a single 1.5-tile threshold; `Mercenary.ts` has the
correct two-band pattern `RETURN_THRESHOLD_TILES = 3.0` / `RETURN_STOP_TILES = 2.2` with
the why-comment), idle drift toward spawn instead of parking near the cat
(`doWander()` misuse), no `retaliateMob` provocation, dead recall code.

---

## 4. Requirements → design decisions

The five user requirements, verbatim intent, and the decisions that resolve ambiguity.
Decisions marked **(tunable)** are defaults the user may adjust later — implement them
as named constants so tuning is one-line.

### R1 — Summon lifecycle & health

- Summoned Mongo stays out for as long as he has health. **No regeneration while out.**
- At 0 HP the cat calls him back: keep the existing recall run (he sprints to the cat,
  then despawns) — but his HP must now **persist** at 0 into the unsummoned state
  instead of resetting on next summon.
- If the **cat dies** while Mongo is out: Mongo runs to the cat and unsummons exactly
  like the 0-HP recall. Decision **(tunable)**: his HP is _preserved_ (not zeroed) —
  "as if he had lost all his health" is read as _the same recall behavior_, since
  zeroing HP on top of a player death would double-punish. Constant:
  `CAT_DEATH_ZEROES_PET_HP = false`.
- The old **90-second cooldown is removed**. Summon availability is now HP-gated:
  `canSummon = unlocked && !summoned && !summonLocked && hp >= MIN_SUMMON_HP` with
  `MIN_SUMMON_HP = 1` **(tunable)**. The circus-quest kidnap lock changes from jamming
  `cooldownFrames` to setting an explicit `summonLocked` flag (G1).

### R2 — Manual unsummon + off-duty regen

- The existing summon button and the **R key become toggles**: pressed while Mongo is
  out → `startRecall()` (he runs back and despawns; no instant vanish). Button label
  flips from `Summon` to `Recall` when he's out.
- While unsummoned (and unlocked), HP regenerates at **1% of max HP every 1.3 seconds,
  rounded up**: `REGEN_INTERVAL_FRAMES = 78` (1.3 s × 60 fps),
  `regenAmount = Math.ceil(maxHp * REGEN_PERCENT)` with `REGEN_PERCENT = 0.01`.
  Regen ticks in `MongoSystem.update` whenever `!summoned && hp < maxHp`. It continues
  across floors/scenes because the pet state object is threaded through scene options
  (G4). The summon button renders a green HP fill bar (replacing the old cooldown
  overlay) so the player can watch him recover.

### R3 — Always aggressive, quest characters excluded

- Targeting predicate: a new `get isPetAttackable(): boolean` on `Mob` defaulting to
  `this.isHostile`. That already excludes Signet, Gum Gum, InkMarauder, Mercenary,
  Mongo himself, and all quest allies (`isHostile === false` on each); `QuestNPC` and
  townspeople are not `Mob`s and never appear in the mob list, so they are structurally
  safe. `SkyFowl` **overrides `isPetAttackable` to `true`** so Mongo attacks the calm
  town fowl (explicit user requirement) even though players can't melee them until
  provoked.
- There is no way to stop the aggression (no passive stance).
- Mobs fight back: Mongo's attacks pass **himself** as the attacker
  (`takeDamageFrom(dmg, this, 'melee')`) so `alertedTo` records Mongo and mobs
  naturally retaliate against him; additionally set `target.retaliateMob = this` on hit
  (the `BrindleGrub` precedent) so the victim prioritizes him. XP credit is preserved
  via a new `get xpCreditTarget(): Player` on `Player` (defaults to `this`; Mongo
  overrides to return his owner) that `CombatSystem.resolveKills` maps
  `damageTakenBy` entries through — the cat keeps kill XP exactly as today (G2).
- Leash: unchanged in spirit — he never ranges beyond `LEASH_RADIUS_TILES` of the cat
  and breaks off combat to return. Fix the follow-hysteresis and idle-park gaps while
  in there (G3).

### R4 — Pet as a leveling ability

- New `AbilityId` `'mongo'`, owner `'cat'`, `maxLevel: 15`, registered in
  `DungeonScene` and `game.ts` like the other three defs. **No tome, no hotbar slot** —
  `equipInstructions` explains he is a pet summoned with R / the Summon button once the
  Krakaren chest is opened.
- The Abilities tab record shows a special **PET** badge: add an optional
  `tag?: string` to `AbilityDef`, render it as a small pink-bordered chip after the
  owner label in `renderListView` (copy the measured-offset pattern the owner tag
  uses), and mention pet-hood in the detail view.
- XP: `usageXp` granted per summon; `killXp` granted when the killing blow is Mongo's
  (`mob.killedBy instanceof Mongo` in `resolveKills`). Def numbers **(tunable)**:
  `baseXpToLevel2: 100`, `xpGrowthRate: 1.45`, `finalLevelMultiplier: 2.0`,
  `usageXp: 2`, `killXp: 15`.
- Level → stats and stage via a `getMongoStats(level)` resolver (§6), replacing
  `mongoStatsForFloor`. Growth stage changes at 5 and 10; if he levels across a stage
  boundary **while summoned**, he visibly grows on the spot (swap sheet next frame; a
  brief white flash via the existing damage-flash brightness pipeline is enough —
  **(tunable)** whether to add a dedicated effect).
- Level-up flows through the existing `abilityManager.onLevelUp` → `LevelUpDialog`
  pipeline automatically once registered; perk descriptions come from §6.

### R5 — Complete art redraw

- Three sheets — `mongo_juvenile`, `mongo_adolescent`, `mongo_adult` — each with:
  walking/facing **toward** the camera, **away**, and **side** (side is mirrored for
  left/right, per repo convention: 3 baked views = 4 facings), plus idle in all three
  views, plus three attacks in all three views: **bite**, **fore-claw slash**, and a
  **jumping back-claw (sickle) slash**, plus a **collapse** one-shot (side view only)
  for the moment his HP hits 0.
- Built on the modern generated-art pipeline (§5) with bake gates, a contact-sheet
  harness, a `?mongo` in-motion preview scene, and multi-round independent image
  review. This is the largest and riskiest part of the plan — do not rush it.

---

## 5. Art track — pipeline, anatomy, choreography, gates

### 5.1 Files to create

Follow the rat/llama/goblin file shape exactly (survey: `ratArt.ts` /
`generate-rat-sprite.ts` / `generate-rat-kin-sprite.gates.ts` / `render-rat.ts`):

| File                                                                       | Role                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/mongoArt.ts`                                                      | Painter + anatomy. Exports `MongoPose`, `MongoStage`, `restPose()`, and exactly three view painters `drawMongoFront/Side/Back(ctx, pose, stage)`. Tile-unit coordinates, origin at tile center, +Y down, side profile faces +X (runtime mirrors). Reuse the shared helpers idiom (`lerp`, `clamp01`, `easeInOut`, `hump`, `hash1/2`, `rgba`, `drawGroundShadow`, `GROUND_Y`).              |
| `scripts/generate-mongo-sprites.ts`                                        | Choreography + bake. One `MONGO_STAGES` table (goblin-archetype pattern: `GOBLIN_ARCHETYPES` → `bake(archetype)` per sheet) drives all three sheets from one painter. `RowSpec`/`ROWS` table, measured geometry (`geometryFor`, ink-box measurement, `FRAME_SIZE_QUANTUM = 8`), `verifyManifest()` (verify-only!), exports for the harness, writes `src/images/enemies/mongo_<stage>.png`. |
| `scripts/generate-mongo-sprites.gates.ts`                                  | The **only** entry point with a write path (`gen:mongo` points here). Gate suite in §5.5. `--skip-manifest-gate` escape hatch for the single run after geometry moves.                                                                                                                                                                                                                     |
| `scripts/render-mongo.ts`                                                  | Contact-sheet harness: `--out= --scale= --row= --stage=`, imports `ROWS`/`bake`/geometry from the generator so it cannot desync, renders every row at review scale **plus a 32-px in-game strip** with the tile-anchor guide rect.                                                                                                                                                         |
| `src/sprites/mongoAttackTiming.ts`                                         | Shared impact-timing constants imported by BOTH the generator and the runtime (`llamaSpitTiming.ts` pattern) so art and gameplay cannot drift: `MONGO_BITE_FRAMES/IMPACT_PROGRESS`, `MONGO_SLASH_…`, `MONGO_POUNCE_…`, `MONGO_COLLAPSE_FRAMES`.                                                                                                                                            |
| `src/sprites/mongoSprite.ts`                                               | **Rewritten**: stage-aware wrapper. `viewFor(facingX, facingY)` + `stateFor(base, view)` (rat pattern; only side view mirrors), `FRAME_COUNT` map, a small `MongoAnimator` one-shot state machine (CatAnimator-lite: `play(action)`, per-frame countdown, walk/idle fallback), `drawMongoIcon(stage, …)` for the button/dialog.                                                            |
| `src/scenes/MongoPreviewScene.ts` + `?mongo` route in `src/dev/devBoot.ts` | In-motion preview modeled on `LlamaPreviewScene`: 4-facing view table, per-row playback with fps, zoom `[1,2,4]`, speed `[0.25,0.5,1]`, real floor-palette backdrops, and a **stage switcher** (J/A/D keys) to flip between the three sheets.                                                                                                                                              |

Registration chores: add `"gen:mongo": "tsx scripts/generate-mongo-sprites.gates.ts"` to
`package.json`; add all four script files to the `include` allowlist in
`tsconfig.scripts.json` (**or typecheck will silently not cover them** — survey finding);
add the three manifest entries by hand; add the three PNGs to `sw.js` precache and remove
the old `enemies/mongo.png` entry (W3).

### 5.2 Sheet layout

Per stage, 16 rows (states named per repo convention — base name is the _toward_ view,
`_side` / `_away` suffixes):

| Rows  | State                                  | Frames | Kind    |
| ----- | -------------------------------------- | ------ | ------- |
| 0–2   | `idle`, `idle_side`, `idle_away`       | 8      | loop    |
| 3–5   | `walk`, `walk_side`, `walk_away`       | 8      | loop    |
| 6–8   | `bite`, `bite_side`, `bite_away`       | 10     | oneShot |
| 9–11  | `slash`, `slash_side`, `slash_away`    | 10     | oneShot |
| 12–14 | `pounce`, `pounce_side`, `pounce_away` | 14     | oneShot |
| 15    | `collapse` (side only)                 | 10     | oneShot |

Frame counts are defaults **(tunable during choreography)** — if a count changes, change
it in ONE place (the generator constants) and let the manifest/`FRAME_COUNT` verification
gates force the propagation. Watch `gateTextureSize` / total asset bytes early: 16 rows ×
14-max frames × 3 sheets is large; if a sheet blows the budget, drop supersample padding
before dropping animation content.

Approximate world sizes **(tunable)**: juvenile ~0.8 tiles long / 0.55 tall; adolescent
~1.4 long / 0.9 tall; adult ~2.1 long / 1.1 tall. Geometry is _measured_, never declared
— let the generator derive `frameWidth/frameHeight/tileX/tileY` from ink boxes.

### 5.3 Anatomy (what makes it read as a real dromaeosaur)

Load the `bipedal-figure` skill first — its rig/pose/view contract and anatomy traps
govern this work — but note Mongo is a **digitigrade, horizontal-spined biped with a
counterbalancing tail**: neither the Carl rig nor the quadruped rigs cover this. Design a
new `MongoPose` with these joints: pelvis (root), spine/chest, neck base, head, jaw,
tail (3+ segments, stiff — dromaeosaur tails are rod-straightened, they sway as a unit
from the base, they do NOT whip like a cat's), two 3-segment legs
(femur → tibiotarsus → metatarsus → toes, i.e. knee forward, ankle high and pointing
_backward_ — the classic "backwards knee" that is actually a heel), and two folded
wing-arms.

Non-negotiable silhouette facts (reviewers check every one):

- **Horizontal posture.** Spine near-parallel to the ground; head and tail balance over
  the hips like a seesaw. NOT an upright Godzilla stance.
- **Digitigrade legs.** Walks on toes; long metatarsus; the visible "reverse joint" is
  the ankle. Knee stays forward and tucked near the body.
- **Sickle claw.** Toe II's enlarged claw is held **retracted off the ground** — in side
  view a raised hook is visible on the inner toe of each foot in every non-pounce frame.
- **S-curve neck**, head held level; long low skull, visible teeth in bite frames.
- **Wing-arms.** Forearms carry pink pennaceous feathers making them read as small
  wings; held folded against the body ("prayer hands" wrists — dromaeosaur wrists could
  not pronate; palms face each other, never downward).
- **Feather placement is an invariant** (Signet hair-coverage precedent): pink crest
  pixels on the head region, pink on forearms, pink fan on tail tip, in _every_ frame of
  _every_ row, all three stages. Gate it (§5.5 G-FEATHER).
- Stage proportion deltas live in the `MONGO_STAGES` table: juvenile gets the oversized
  head/eye ratios and downy outline noise; adult gets the longest skull, deepest chest,
  most defined thigh musculature.

### 5.4 Choreography (per animation, all stages)

- **Walk (8f loop):** toe-first digitigrade steps with clear toe-off roll; body bobs
  slightly but the **head stays level** (avian head stabilization — this single trait
  sells realism more than anything else; gate it); tail sways as a stiff unit in
  counterphase to the hips; folded wings bounce subtly; juvenile bounces more, adult
  glides with menace. Front/away views show alternating leg lift and lateral weight
  shift, not a static sprite with wiggling feet.
- **Idle (8f loop):** breathing rib expansion, weight shift, small head scan, tail-tip
  feather flick. Loop must close (gate).
- **Bite (10f one-shot):** neck coils back into a deep S (frames 0–0.35), explosive
  forward strike with jaws opening then snapping (impact at `~0.55`), recover with a
  small head shake. Whole body weight rocks forward on the strike.
- **Fore-claw slash (10f one-shot):** wings flare outward for balance (the pink display
  feathers make the frame — exaggerate them), weight rocks back, then a one-two raking
  swipe with both hands (impact `~0.5`), feathers trailing the arc. Arc-trace gate on
  the claw tip.
- **Pounce / jumping back-claw slash (14f one-shot):** crouch compression (0–0.25),
  airborne arc with legs swung forward, sickle claws leading, wings spread wide
  (0.25–0.6), two-footed sickle strike on impact (`~0.65`), recover hop settling back to
  stance (0.65–1). The vertical leap is baked into the frames; the horizontal lunge is
  runtime movement (G3). Arc-trace gate on the foot-claw tip.
- **Collapse (10f one-shot, side):** legs buckle, wings splay for a failed catch, head
  droops to the ground. No gore — he is a pet and never dies; the runtime fades him out
  during the recall despawn. Tone: exhausted, not killed.
- All impact fractions live in `src/sprites/mongoAttackTiming.ts` and are imported by
  the generator — never duplicated.

### 5.5 Bake gates (`generate-mongo-sprites.gates.ts`)

Port the rat-kin suite and adapt; each gate reports measured value + limit and a failing
sheet must never reach disk:

- G1 border-clip (no ink on cell borders), G2 anchor (ground line on declared `tileY`),
  G3 loop-closure (walk/idle last≈first), G4 continuity (no per-frame pixel-delta
  cliff), G5 centroid drift, G6 reach headroom, G7 foot slide (stance foot pinned during
  contact), G8 ground contact, G10 timing table (rows match `EXPECTED_ROWS`),
  G11 manifest verify, G12 texture size, G13 stride sync (tiles-per-cycle matches the
  runtime walk constant).
- **G9 adapted for digitigrade:** knee bends forward, ankle (the high reverse joint)
  bends backward, in every walk frame.
- **G-ARC:** per-frame claw-tip arc traces for `slash` (hand claw) and `pounce` (foot
  sickle claw) dumped to `scripts/mongo-arc-traces/` (goblin `gateWeaponArc` pattern) —
  a hitch or teleport in the arc must fail the gate.
- **G-FEATHER:** pink-pixel presence in the head region (and tail-tip region in side
  views) in every frame, all rows, all stages.
- **G-HEADLEVEL:** in the walk loop, head-centroid vertical variance stays under a small
  fraction of body-bob amplitude (the head-stabilization invariant from §5.4).
- **G-STAGE-SCALE:** measured ink heights of the three stages preserve
  juvenile < adolescent < adult with ratios within a declared band, so the growth read
  survives geometry quantization.

### 5.6 Image-review rubric (what reviewer agents score)

For each sheet, at review scale AND the 32-px in-game strip: (1) reads instantly as a
feathered velociraptor, not a lizard/bird/dog; (2) horizontal posture, digitigrade legs,
raised sickle claw, prayer-hands wings all present; (3) blue body + the three pink
feather zones legible at 32 px; (4) walk has weight — toe-off, level head, counter-sway
tail; (5) each attack readable as bite vs. arm-rake vs. leaping foot-strike _from the
still strip alone_; (6) stages look like the same animal at three ages (family
resemblance: shared stripe pattern, same palette); (7) juvenile is endearing, adult is
menacing; (8) no frame looks broken/NaN/clipped. In-motion (`?mongo` + browser, or gif
capture): no foot skating, no popping between frames, attacks anticipate → strike →
recover. Reviewers must name specific frames/rows in findings.

### 5.7 Art phases

- [x] **A1 — Rig + stage table.** `scripts/mongoArt.ts` skeleton: `MongoPose`,
      `MongoStage`, `MONGO_STAGES` proportion table, `restPose()`, palette constants, the
      three view painters producing a _static standing pose_ in all three views × three
      stages. Deliverable: a static contact sheet via a temporary `render-mongo.ts` mode.
      Gates: typecheck/lint/format. Review: 1 image round on silhouette + §5.3 checklist.
- [x] **A2 — Walk + idle choreography.** Generator (`generate-mongo-sprites.ts`) with
      `ROWS` for idle/walk ×3 views, measured geometry, `bake(stage)` over `MONGO_STAGES`.
      Gates file with G1–G8, G13, G-FEATHER, G-HEADLEVEL, G-STAGE-SCALE passing. Review:
      ≥2 image rounds + confirming round (§2), including the 32-px strip.
- [x] **A3 — Attack choreography.** Bite/slash/pounce rows ×3 views + collapse;
      `mongoAttackTiming.ts` created and imported by the generator; G-ARC + G10 added and
      passing. Review: ≥2 image rounds + confirming round; reviewer must check arc traces.
- [x] **A4 — Manifest + assets land.** Hand-add `mongo_juvenile/adolescent/adult`
      entries to `src/images/enemies/manifest.json` (surgical edit, re-read file first);
      `gen:mongo` script in `package.json`; scripts added to `tsconfig.scripts.json`
      include; full `npm run gen:mongo` green including G11. Gates: typecheck/lint/format.
- [x] **A5 — Runtime wrapper.** Rewrite `src/sprites/mongoSprite.ts`: stage-aware
      `drawMongoSprite`, `MongoAnimator`, `FRAME_COUNT` map, `drawMongoIcon(stage, …)`.
      No gameplay wiring yet (W1 does that). Gates: typecheck/lint/format + a unit-style
      assertion (script or gate) that `FRAME_COUNT` matches the manifest.
- [x] **A6 — `?mongo` preview scene.** `MongoPreviewScene` + devBoot route (minimal
      additive edit — devBoot is contested, re-read first). Browser review round: reviewer
      drives `?mongo`, captures stills/gif of every row × stage, scores §5.6 in motion.
      Confirming round required.

---

## 6. Pet leveling design (data for G5)

`src/abilities/mongo.ts` exports `MONGO_DEF` (AbilityDef) and `getMongoStats(level)`
returning `{ stage, maxHp, biteDamage, slashDamage, pounceDamage, speed,
slashUnlocked, pounceUnlocked }`. All numbers below are defaults **(tunable)** — keep
them in one table in that file.

| Lvl | Stage      | maxHp | Bite | Slash | Pounce | Speed | Perk text (shown in Abilities tab)                   |
| --- | ---------- | ----- | ---- | ----- | ------ | ----- | ---------------------------------------------------- |
| 1   | Juvenile   | 20    | 2    | —     | —      | 2.0   | A tiny terror hatches. Bite attack.                  |
| 2   | Juvenile   | 24    | 3    | —     | —      | 2.0   | Thicker down — more HP.                              |
| 3   | Juvenile   | 28    | 3    | 4     | —      | 2.0   | Learns the fore-claw slash.                          |
| 4   | Juvenile   | 34    | 4    | 5     | —      | 2.1   | Sharper claws.                                       |
| 5   | Adolescent | 55    | 6    | 8     | —      | 2.4   | **Growth spurt — adolescent.** Major surge in power. |
| 6   | Adolescent | 62    | 7    | 9     | —      | 2.4   | Denser muscle.                                       |
| 7   | Adolescent | 70    | 8    | 10    | 14     | 2.4   | Learns the leaping sickle-claw pounce.               |
| 8   | Adolescent | 80    | 9    | 11    | 16     | 2.5   | Longer stride.                                       |
| 9   | Adolescent | 92    | 10   | 12    | 18     | 2.5   | Hunting instincts sharpen.                           |
| 10  | Adult      | 130   | 14   | 17    | 26     | 2.8   | **Fully grown.** A true Mongoliensis.                |
| 11  | Adult      | 145   | 15   | 19    | 29     | 2.8   | Hardened scales.                                     |
| 12  | Adult      | 160   | 17   | 21    | 32     | 2.8   | Pack-hunter cunning.                                 |
| 13  | Adult      | 175   | 19   | 23    | 35     | 2.9   | Terrifying speed.                                    |
| 14  | Adult      | 190   | 21   | 25    | 39     | 2.9   | Almost apex.                                         |
| 15  | Adult      | 220   | 24   | 29    | 45     | 3.0   | **Apex predator.**                                   |

Attack availability before unlock level: the AI simply never selects that attack (the
animation rows still exist in every sheet — availability is a stats question, not an art
question). XP def numbers are in §4/R4. `maxHp` changes on level-up: keep current HP
fraction (`hp = ceil(fraction * newMax)`) so leveling never _hurts_.

---

## 7. Gameplay track — phases

- [x] **G1 — MongoSystem lifecycle rework.** Depends on nothing (works against the old
      sheet until W1).
  - New `MongoPetState` (small class or plain interface + factory): `{ hp, summonLocked }`
    — maxHp derives from the ability level; threaded through `DungeonSceneOptions`
    exactly like `circusProgress`/`abilityManager` so it survives scene replacement.
  - Remove `cooldownFrames`/`COOLDOWN_SECONDS` and the dead/duplicated hp-check block
    (~lines 111–126). `canSummon` per §4/R1. `summon()` constructs Mongo with persistent
    `hp` and level-derived stats.
  - Off-duty regen per §4/R2 (constants, ceil).
  - Toggle recall: `triggerMongoSummon()` becomes `toggleMongoSummon()` — summons when
    out of play, calls `startRecall()` when active. Keep the R-key binding (verify the
    shared `buildAction()` on R doesn't double-fire in the same context; if it does,
    surface in the log and gate recall on cat-active like summon is today).
  - Cat-death recall: in `MongoSystem.update`, `!cat.isAlive && mongo && !recalling →
startRecall()`; `CAT_DEATH_ZEROES_PET_HP` constant per §4/R1.
  - On despawn, write Mongo's remaining hp back into `MongoPetState`.
  - Circus quest: replace the `cooldownFrames = MONGO_KIDNAP_LOCK_FRAMES` jam with
    `petState.summonLocked = true/false` in `CircusQuestSystem` (both set and restore
    sites); delete `MONGO_KIDNAP_LOCK_FRAMES`.
  - Dismissal on floor transition / building entry stays, but now preserves hp.
  - Gates + independent review + confirming round.
- [x] **G2 — Combat attribution & retaliation.** `xpCreditTarget` on `Player` (default
      `this`), Mongo overrides to `owner`; Mongo attacks pass `this` as attacker and set
      `retaliateMob = this`; `CombatSystem.resolveKills` maps XP-split entries through
      `xpCreditTarget` (cat keeps XP exactly as before — write this as the review
      acceptance criterion) and grants `addKillXp('mongo')` when `killedBy instanceof
Mongo`. Verify the XP-split top-dealer logic still resolves to Human/Cat after
      mapping. Gates + review + confirming round.
- [x] **G3 — Targeting & movement.** `isPetAttackable` on `Mob` (default `isHostile`),
      `SkyFowl` overrides `true`; Mongo's scan filter switches to it. Fix follow
      hysteresis (port Mercenary's `RETURN_THRESHOLD_TILES = 3.0` / `RETURN_STOP_TILES =
2.2` two-band pattern), fix idle behavior (park near the cat; do NOT `doWander()`
      toward the spawn anchor), and use `Mob.faceToward()` instead of the hand-rolled
      normalize (guard re-facing on `attackAnimTimer === 0`, Goblin precedent, so attacks
      don't swivel mid-swing). Three-attack AI: bite in melee range; slash on its own
      cooldown at slightly longer reach; pounce as a gap-closer when the target is 2–4
      tiles out and off cooldown — the lunge is ordinary per-frame movement inside
      `updateAI` over the pounce's airborne frames (never a teleport — the mob grid only
      tracks self-moved mobs; see the `mobGrid.move` project gotcha). Per-attack cooldown
      constants; damage lands on the impact frame using `mongoAttackTiming.ts` progress
      (pendingImpact pattern from `Goblin.ts`), NOT on swing start. Attack unlock levels
      respected from `getMongoStats`. Gates + review + confirming round.
- [x] **G4 — Persistence.** Register `MONGO_DEF` in both `DungeonScene` and
      `game.ts:resumedAbilityManager` (level/XP then persist through the existing
      `abilityStates` path for free). Add optional `mongoUnlocked?: boolean` and
      `mongoPetHp?: number` to the save payload (`SaveProgressFn` in DungeonScene, the
      `saveProgress` writer in `game.ts`, and `GameProgress` in `src/auth/AuthClient.ts`)
      — optional fields so old saves load unchanged; verify whether the server schema
      stores a blob (then no server change) or named columns (then log a `[HUMAN]` item
      rather than touching `server/`). Restore on boot. Gates + review + confirming round.
- [x] **G5 — Ability def + UI.** `src/abilities/mongo.ts` per §6; `AbilityId` union +
      `ABILITY_IDS` record entries; `tag?: string` on `AbilityDef` + PET chip in
      `AbilitiesTab.renderListView` (use `drawText`/`drawBox` utilities and presets — no
      raw ctx) + pet note in the detail view; `usageXp` on successful summon. Summon
      button rework: label `Summon`/`Recall`, green HP fill bar via
      `drawProgressBar`/`PROGRESS_PRESETS.hp` replacing the cooldown overlay, icon from
      `drawMongoIcon` at the _current stage_; same treatment on the mobile button in
      `DungeonUIRenderer` (re-read before editing; contested file). Update
      `_makeMongoReward` dialog icon. Gates + review + confirming round.

---

## 8. Wiring track — phases (depend on both tracks)

- [x] **W1 — Swap the art in.** `Mongo.ts` renders through the new `mongoSprite.ts` +
      `MongoAnimator`: stage from `getMongoStats(level)`, 4-facing view selection from his
      facing vector, walk phase from actual distance moved (stride-sync gate G13 keeps
      feet honest), one-shots for bite/slash/pounce, `collapse` playing at the moment hp
      hits 0 before the recall run, runtime fade during despawn. Retire `visualScale`/
      `MongoSize`/`mongoStatsForFloor` and the sine `attackAmt` ping-pong. Health-bar
      offset re-anchored to measured sheet geometry. Gates + review + confirming round.
- [ ] **W2 — [HUMAN] In-game verification sweep.** _Attempted 2026-08-03 and blocked,
      not skipped: Chrome reported `document.hidden === true` and rAF delivered zero
      ticks per second, so the game loop was frozen and no input could be observed.
      What **was** verified from the browser with the loop stopped: all three sheets
      load at exactly the dimensions the manifest declares, all sixteen rows are
      present in each, the legacy `mongo` manifest entry is gone, and the `?mongo`
      preview scene renders every row in all four facings. `?playtest=<preset>` now
      unlocks Mongo so a human can drop straight into a floor and test him._
      Original scope: Browser-automation pass (unregister the
      service worker first): summon on floor 2, watch him fight; verify he attacks a calm
      sky fowl in town; verify quest characters (Signet, Gum Gum) are never targeted;
      recall via button and via R; HP bar regen while unsummoned; level-up growth moment
      (use the dev/god-mode level floor `setGodModeMinLevel` if useful for reaching L5/L10
      quickly); circus kidnap lock still blocks summon; cat death triggers recall.
      Findings fixed + confirming round. Feel/timing items go to `[HUMAN]` (§11).
- [x] **W3 — Cleanup.** Delete `src/images/enemies/mongo.png` + its manifest entry;
      update `sw.js` precache (remove old, add three new); retire the legacy mongo entry
      in `scripts/svgSubjects.ts`; grep for dangling references (`drawMongoSprite` old
      signature, `mongoStatsForFloor`, `COOLDOWN`). Full `npm run typecheck && npm run
lint && npm run format` + `npm run build`. Review + confirming round.
- [x] **W4 — Final independent audit.** One fresh agent reads this plan's §4
      requirements table and audits the diff + a browser session against every acceptance
      criterion, requirement by requirement (R1–R5), reporting per-requirement PASS/FAIL
      with evidence. Fix, then one final confirming audit. Then set the Status line at the
      top of this file.

---

## 9. Acceptance criteria (what W4 audits)

- **R1:** Summoned Mongo has persistent HP; no regen while out; 0 HP → recall run →
  despawn with hp 0 stored; cat death → identical recall; can't summon at 0 HP until
  regen ticks him ≥ `MIN_SUMMON_HP`; the 90 s cooldown is gone everywhere.
- **R2:** Button and R toggle recall; off-duty regen is `ceil(maxHp/100)` HP per 78
  frames, visible on the button's HP bar, and continues across floor transitions.
- **R3:** Attacks every `isPetAttackable` mob including calm sky fowl; never Signet /
  Gum Gum / quest allies / townsfolk; mobs retaliate against him specifically; he
  leashes back to the cat and never ranges beyond the leash.
- **R4:** `mongo` appears in the Abilities tab with a PET badge; levels 1→15 with XP
  from summons + pet kills; stats/stage follow §6; growth at 5 and 10 visibly changes
  his sheet in-game; level/XP + unlocked flag + pet HP survive save/load.
- **R5:** Three sheets exist, gen-gated, manifest-verified; walk toward/away/side(+mirror),
  idle, bite, fore-claw slash, jumping sickle pounce (+collapse) all present and
  convincing per §5.6; old art fully retired; `?mongo` preview works.
- **Meta:** typecheck/lint/format/build green; no commits made; no `as`/`!`/`any`
  introduced; every phase has logged review + confirming rounds in §12.

---

## 10. Known traps (from project memory — do not rediscover these)

- Service worker serves a stale bundle — unregister before trusting any browser check.
- `Scene.loop` runs two updates per callback under load — steady low fps looks like a
  stall; don't misread animation timing in an occluded window (rAF drops to ~1 fps).
- Teleporting a mob needs `mobGrid` fix-up — the pounce lunge must be ordinary
  self-movement inside `updateAI`, never a position write from a system.
- Mob-owned projectiles die with the mob — irrelevant to Mongo today (melee only), but
  if anyone adds a ranged pet attack, route it through a system.
- Dead mobs leave the mob grid / `rendersWhenDead` — Mongo never truly dies (recall
  intercepts at 0), so his despawn must remove him from BOTH `mobs[]` and `mobGrid`
  (the existing `dismiss()` removal pattern).
- node-canvas rejects exponent alpha — clamp tiny computed alphas in generator code or
  a whole `rgba()` silently drops and bakes a smear.
- `render-*` harness: never enable any canvas flush option (software-raster demotion).

---

## 11. [HUMAN] checklist (Ryan)

- [ ] [HUMAN] Feel pass: walk weight, attack snappiness, pounce distance, follow
      distance — all three stages.
- [ ] [HUMAN] Approve the look of each sheet (contact sheets in `scripts/` output dir +
      `?mongo` in motion) — especially "convincing as a dinosaur" and the juvenile's charm.
- [ ] [HUMAN] Balance pass on §6 numbers (HP/damage/speed/XP curve) after playing.
- [ ] [HUMAN] Confirm the R1 tunables: `CAT_DEATH_ZEROES_PET_HP = false`,
      `MIN_SUMMON_HP = 1` (resummon-at-1-HP spam is allowed by design — OK?).
- [ ] [HUMAN] Decide if the town wants Mongo attacking sky fowl to have consequences
      (guards? none today) — out of scope for this plan.
- [ ] [HUMAN] Optional: new sounds (bite chomp, pounce screech) via `add-sound` — the
      plan reuses `mongo_released` / `mongo_slash` for now.
- [x] [HUMAN] If G4 finds the server stores named columns instead of a blob, approve
      the server-side persistence change. _Resolved without needing you: `server/db.ts`
      stores one `data TEXT` JSON blob, so the two new optional fields need no server
      change at all._
- [ ] [HUMAN] Run the W2 in-game sweep. Browser automation could not: the game loop
      only runs while the Chrome window is in the foreground.

---

## 12. Progress Log (append-only — newest at the bottom)

| When (UTC)           | Agent/phase                                        | What happened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Gates                                                                                                                                                                                                                          | Reviews                                                                                                                            |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 03:31 UTC | Opus — A1–A6, G1–G5, W1, W3                        | Art: `scripts/mongoArt.ts` (painter, 3 stage proportion sets, digitigrade IK, feather/crest/tail-fan engine), `generate-mongo-sprites.ts` (16 rows × 3 stages), `generate-mongo-sprites.gates.ts` (G1–G13 + G-ARC/G-FEATHER/G-HEADLEVEL/G-STAGE-SCALE/G-CLEARANCE), `render-mongo.ts` (sheet/onion/stages modes). Gameplay: `MongoPetState`, `abilities/mongo.ts` (15-level table + PET tag), rewritten `Mongo.ts` (3 attacks, pendingImpact, leash hysteresis, pounce lunge as self-movement, collapse + fade), rewritten `MongoSystem.ts` (persistent HP, off-duty regen, toggle recall, cat-death recall, `summonLocked`), `xpCreditTarget` on `Player`, `isPetAttackable` on `Mob` + `SkyFowl` override, `resolveKills` credit mapping + `addKillXp('mongo')`, save/load of `mongoUnlocked`/`mongoPetHp`, PET chip in `AbilitiesTab`, `?mongo` preview scene. W3: legacy `mongo.png` + manifest entry + `svgSubjects` entry retired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `npm run gen:mongo` green (all gates); typecheck, lint, format, build all green on the changed files                                                                                                                           | 1 blind art round applied (15 findings, all addressed); round 2 art review + gameplay code review running                          |
| 2026-08-03 05:05 UTC | Opus — review round 1 fixes                        | **Art round 2** (blind, 16 findings) and **gameplay code review** (11 findings) both applied. Art: head-on/away views rebuilt as a depth-ordered projection (one elongated body mass, muzzle keel, tail swung off the centreline); the tail-lift sign was inverted so every constant named "lift" pushed the tail _down_; the collapse now flops its tail to the floor and clamps the skull above the ground line; the sickle claw is rebuilt as a pale-keratin tapered ribbon (it was baking as an invisible hairline); idle/walk motion amplitudes roughly tripled; stride widened; blink widened past the row's sampling limit; juvenile and adolescent proportions re-cut; down redrawn as a halo. Gameplay: `checkHealth` now clamps unconditionally (he was dying for real mid-recall and stranding the system); the death restart and the checkpoint restore now dismiss him so his HP is written back; the button's bar reads the live creature; `Mob.killedBy` is mapped through `xpCreditTarget` with a new `killedByDealer` for the literal dealer, so pet kills keep every killer-keyed loot roll and achievement; regen moved onto `MongoPetState` and is ticked by `BuildingInteriorScene` too; `applyLevel` preserves the HP fraction per §6 and flashes; restored HP is clamped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `npm run gen:mongo` green; typecheck, lint, format all green                                                                                                                                                                   | Round 2 art + round 1 code applied; confirming rounds (art 3, code 2) running                                                      |
| 2026-08-03 05:45 UTC | Opus — confirming rounds                           | **Confirming code review** (10 findings) applied. Real fixes: a despawned Mongo left every mob he had provoked holding a `retaliateMob` reference to a creature that never dies, so they beelined to the tile he vanished from and ignored the cat for the rest of the floor (`finishDespawn` now clears those); both save sites recorded the _stored_ HP, so a safe room entered with a 5/130 raptor saved 130 (they read `mongoSystem.hp` now); `hpRatio` still read the stored value while the bar's colour read the live one, so the widget contradicted itself; the PET line on the detail page was drawn exactly on top of "Owner: Cat" (folded into the equip line, which already wraps); `BallOfSwine`'s `takeDamageFrom` override bypassed the credit mapping entirely; a fresh pet state was seeded at level-1 max HP regardless of the restored level; the `?mongo` harness could not pause or step the idle rows because the sprite drove them off the wall clock. One finding was a false positive (the interior scene is handed the live ability manager, not a clone) and is recorded here so it is not "fixed" again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `npm run gen:mongo`, typecheck, lint, format, build all green                                                                                                                                                                  | Code round 2 applied; art round 3 outstanding                                                                                      |
| 2026-08-03 06:40 UTC | Opus — art round 3 + W4 audit                      | **Art round 3** (12 findings) and the **W4 requirement audit** both applied. The head-on and away views were rebuilt a second time, to this game's own convention for a horizontal animal seen end-on — head at the top with the crest above it, body below, tail swept to one side — which is how the rat's `walk` row is drawn. The depth-ordered projection that preceded it was geometrically right and unreadable: the head could not be found at 32 px, the two axial views came out a third shorter than the profile, and the head-on bite punched four pixels through the floor. Also: idle/walk bob amplitudes raised again (the old 0.022 tiles was half a screen pixel); sickle claw enlarged, re-angled forward and given its own head-on placement; finger claws given the same pale keratin so the rake ends in a hand; collapse settle added (its last three frames were pixel-identical); tail root raised to meet the back line; juvenile eye cut to 42% of skull height and its down recoloured cream so it stops being a fourth pink zone; **leash hysteresis** split (`LEASH_BREAK_TILES` 12 / `LEASH_RESUME_TILES` 9.5 — they were the same number as the aggro radius, so a target at the edge flipped him between fighting and going home every frame). New gates: **G-CLAW** (keratin pixels present in every frame — G-ARC watches a _joint_, so it passes on a claw that is never painted, which is how the sickle shipped invisible once already) and G-FEATHER's crest band re-anchored on the measured skull instead of an ink-box fraction. G-ARC traces now write to `scripts/mongo-arc-traces/` as §5.5 specifies. The four `scripts/*mongo*` files are now Prettier-clean (`npm run format` only globs `src/`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `npm run gen:mongo` green incl. the two new gates; typecheck, lint, format, build green; `prettier --check` clean on the script files                                                                                          | Art round 3 + W4 audit applied; art round 4 (confirming) running                                                                   |
| 2026-08-03 07:25 UTC | Opus — round-3 follow-ups                          | The juvenile's down was still a closed-loop stroke round the torso, which is a marquee with visible ends rather than fluff — it is now dense, varied, cool-white tufts (cool so the new G-CLAW gate cannot mistake a fluffy chick for a well-clawed one) and is drawn on the tail as well as the body. The spread wing fan head-on was flaring to horizontal, which reads as a T-pose, and now sweeps up and out. The axial sickle claw no longer applies the deployment swing: axially that rotation is almost pure depth, so drawing it foreshortened the claw to two pixels on exactly the frames where it is being driven into something. G-CLAW's floor became a share of each frame's own ink with a hard minimum, for the same reason G-FEATHER's did — the juvenile's sheet is a third the adult's area. The generated arc-trace dump was deleted from the working tree so it is not committed; `npm run gen:mongo -- --arc-traces` regenerates it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `npm run gen:mongo` green; typecheck, lint, format, build green                                                                                                                                                                | Round 4 (confirming art) outstanding                                                                                               |
| 2026-08-03 07:55 UTC | Opus — art round 4 fixes                           | **Art round 4** returned DO NOT SHIP on three findings, all applied. (1) The walk and idle bodies were still frozen: the head stabilisation was pinning the skull to a constant height _exactly_, which is what the trait technically is and reads on screen as a head glued in mid-air while the body slides under it — it now absorbs 74% of the bob, the bob itself was raised again, and **G-HEADLEVEL was rewritten as a ratio gate** (head swing ≤ 0.4 × body swing) because "the head does not move" was the wrong invariant to be policing. (2) The sickle claw had over-corrected into the loudest element on the sprite, mounted on the shin — it is smaller, duller bone, rooted at the toe, depth-shaded far less than the leg it sits on, and declared _proportionally larger_ on the younger stages so it survives their smaller sheets. (3) The near arm's spread primaries were painted over his own neck and skull, so the rake read as an effect going off in front of his face; the arm now draws under them, and the hand's claws are bigger and bone-coloured. Also: the head-on gape widened to the muzzle with a real tooth row, the collapse's drop and head droop reduced (it was sinking 2.5px through the floor), the trailing toe shortened (the foot pointed backwards), the juvenile's skull enlarged and body shortened, the eye's iris ring thinned so it stops reading as a goggle. G5 got G3's largest-in-loop-step floor for the same reason G3 needed it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `npm run gen:mongo` green; typecheck, lint, format, build green                                                                                                                                                                | Round 4 applied; round 5 (confirming) running                                                                                      |
| 2026-08-03 14:20 UTC | Opus — juvenile coherence pass (Ryan's note)       | Ryan looked at the sheets and called the juvenile incoherent. He was right, and the reviews had been saying so since round 3 — the fixes each round were partial. Root causes, all found by looking at it at 9×: (1) the tail's down was painted as a **closed** loop, so it grew a segment from the tail tip back to the hips and stitched a dashed diagonal straight across the middle of the animal; (2) the body outline's down ran along stretches that the neck, skull and legs are drawn over, so tufts sprouted _inside_ the silhouette — the outline now declares which of its segments are actually exposed; (3) the chick's skull was 0.235 long against 0.26 deep, i.e. a ball with an eye on it and no muzzle, and it had almost no neck, so head and body merged into one lump; (4) every interior element — pebbling, dorsal bars, pale underside, hand claws, part outlines — was carried at full adult strength on cells a third the area, which is what made it read as a suit of overlapping plates. Fixes: an open/closed flag on the down, an exposed-segment set, a longer shallower skull with a real neck, and a new per-stage **`detail`** budget (juvenile 0.35 / adolescent 0.7 / adult 1) that scales the pebbling, bars, belly wash and hand claws, plus an `innerEdge()` colour that softens _interior_ seams on the low-detail stages while the silhouette's own outline stays hard. G-CLAW exempts the collapse row, where a claw hidden under a folded-up body is the correct picture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `npm run gen:mongo` green; typecheck, lint, format, build green                                                                                                                                                                | Ryan's own look drove this; art round 5 and code round 3 running against the pre-fix images                                        |
| 2026-08-03 14:45 UTC | Opus — code round 3 fixes                          | **Third confirming code review** (11 findings) applied; it confirmed nine of the eleven round-2 fixes outright and found what two of them had left behind. Real ones: the leash band still started exactly at the aggro radius, so latching the state only slowed the yo-yo to a two-second period — the bubble is now strictly inside the resume band (`AGGRO_RADIUS_TILES` 9 < `LEASH_RESUME_TILES` 9.5) and the invariant is written down beside them. The interior scene's regen tick sat _above_ every menu gate, so standing in a shop with the pause menu open healed the pet on wall-clock time while doing the same outdoors healed nothing — it moved below the gates. The live-HP accessor reported `1` for a spent pet, because `checkHealth` pins him there so he can walk home, which meant an autosave during the recall stored 1 instead of 0 and painted the button green; it now reports 0 when he is exhausted. Mongo was not immune to the cat's _own_ Scroll of Confusing Fog, which replaces `updateAI` wholesale — a pet fogged mid-recall stood in the fight at one hit point, unable to leave or be re-summoned. `onPetLevelUp` mixed the raw level with the god-mode-floored one and could cut a 130 HP pet to 24. Plus: the equip line got its `How to equip:` label back, the preview's duplicated impact guard was merged and its chrome moved to `drawBox`, a dead `setMap` override went, and the speech bubble's font size is derived rather than restated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | typecheck, lint, format, build, `npm run gen:mongo` all green                                                                                                                                                                  | Code round 3 applied; a fourth confirming code round has not been run                                                              |
| 2026-08-03 15:10 UTC | Opus — art round 5 fixes                           | **Art round 5** returned DO NOT SHIP with the collapse as the blocker; applied. The skull was rotating ~90° nose-down and hanging off the neck like a severed head on its snout — the neck's droop, the skull's own rest pitch and the head droop all added in the same direction. The head droop is now _negative_ to counter them, and the head is laid on the floor in both directions rather than only clamped up out of it. Also: the head-on gape had over-corrected from a thin bar into a red oval hanging over the chest (bounded by the skull now, and the axial muzzle no longer reaches chest height); the sickle claw was standing as a post in the middle of a flat paddle (rooted at the front of the foot and hooked); the hand claws were depth-shaded into olive mud (same shade share as the sickle); the adult's slit pupil was sub-pixel and baked away into a hollow gold ring (floored in absolute units); the pounce released its leg tuck at take-off so the leap was the standing pose translated upward; and the axial tail left the hips at the same height and angle as the arm feathers, so from the front the two were indistinguishable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `npm run gen:mongo` green; typecheck, lint, format, build green                                                                                                                                                                | Art round 5 applied; a sixth confirming art round has not been run                                                                 |
| 2026-08-03 15:35 UTC | Opus — code round 4 fixes                          | **Fourth confirming code review** returned DO NOT SHIP on Mongo's own ability page; applied. The round-3 fix that restored the `How to equip:` label pushed an already-three-line string to four, and the detail panel's content starts at a _fixed_ offset — so lines 2–4 painted straight through the level line, the XP bar and its label. The block is now measured with `measureTextBox` and the content starts under whatever it actually took, and the instruction string itself was shortened. Also, and each one a defect living inside a previous fix: the interior regen tick was still above the blackjack-table and service-panel returns (the same free heal, one gate lower — it now sits below every halt); the `immuneToConfusion` fix made the cat's own pet appear in the "sees you through the fog" toast; excluding a retreating pet from `extraTargets` did nothing because the mobs he had provoked hold `retaliateMob` and he is never dead, so the release sweep now runs when the retreat _starts_ as well as at despawn; the Summon button's label was overpainted by its own HP bar; and `onPetLevelUp` re-derived the previous maximum from `level - 1`, which god mode's level floor makes a lie — the pet state now remembers the maximum its stored HP was last scaled against, and rescales on a god-mode change too, which never fires `onLevelUp`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | typecheck, lint, format, build, `npm run gen:mongo` all green (the only lint error in the tree is in another agent's `BountySystem.ts`)                                                                                        | Code round 4 applied; a fifth confirming code round has not been run                                                               |
| 2026-08-03 16:20 UTC | Opus — playtest fixes (companion AI)               | **Ryan's first in-game playtest of the pet AI**, four complaints, all four traced to `Mongo.updateAI` and fixed. (1) _He shakes while following._ `standBy` re-decided from raw distance every frame: it set off past `RETURN_THRESHOLD_TILES` and stopped the instant it crossed back, so the cat's next step pushed him over the line again and he alternated walk/stand on consecutive frames. The comment claimed hysteresis but no state remembered he was mid-return — it is a latched `following` flag now, and `RETURN_STOP_TILES` dropped 2.2 → 1.6 so arriving means arriving. (2) _He targets enemies he cannot see, and ignores nearer ones._ `findTarget` was the only mob targeting path in the codebase with no perception gate — every other creature goes through `acquireTarget`/`canNotice`. New quarry now has to pass `canNotice`, and the pounce additionally requires `hasLOS` so the leap never plays its airborne window against a wall. (3) _He walks into walls to reach them._ `followTargetAStar` silently degrades to a straight-line walk when no route exists, which for a sealed-off mob is indistinguishable from grinding into the masonry; `Mob` exposes `astarSearchFailed` now and Mongo drops such a target into an `unreachable` map for `UNREACHABLE_FORGET_FRAMES` (entries expire — doors open). (4) _He will not stay with the cat._ The bands were far too generous and the target was re-picked from scratch every frame, so two mobs a pixel apart traded "nearest" and swapped his goal tile faster than a path could be walked. The target is held across frames now, and the radii are rebuilt around the leash as the governing rule: engage 4.5 from the cat, persist 6.0, break 7.0, resume 3.0, with `persist < break` and `engage > resume` written down as the anti-yo-yo invariants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | typecheck, lint, format green on `Mongo.ts` + `Mob.ts`                                                                                                                                                                         | Playtest round 1 applied; needs Ryan's re-test in game, and a confirming code review has not been run                              |
| 2026-08-03 17:30 UTC | Opus — knockout rest lock + summon countdown       | **Ryan's second playtest ask**, shipped and reviewed to SHIP in two rounds. New `MongoPetState.restingUntilFull`: driven to 0 HP he is unsummonable until _full_, recalled with health to spare he stays available at 1 HP, and the cat being knocked out now spends him too (that R1 tunable, `CAT_DEATH_ZEROES_PET_HP`, was the open `[HUMAN]` question — Ryan answered it, the constant is gone and the behaviour is unconditional). The latch persists as its own save field because HP alone cannot say whether a half-healed raptor is climbing back from zero or was simply recalled hurt. The Summon button gets a countdown; the hotbar's inline cooldown drawing was extracted to a shared `src/ui/CooldownOverlay.ts` so both use one implementation, and the countdown number is outlined — Ryan reported it was sometimes invisible, which it was, over any pale icon. Review round 1 returned DO NOT SHIP on three holes with one root cause: "spent" was recorded only via `Mongo.exhausted`, which `beginCollapse` alone set. So recalling a wounded pet (the obvious play when he is in trouble) meant mobs could beat him to 0 on the run home with no latch — pressing R in time spent him for free; the same leak if the cat went down while he was already retreating; and both autosaves can fire mid-retreat, storing `hp: 0` with `resting: false`, so a reload skipped the recovery the latch exists to enforce. Fixed by flagging in `checkHealth` unconditionally, hoisting the cat-death assignment out of the recall guard, and giving the getter the same live/stored split `hp` already had. Round 2 traced every reader, both save paths, the level-up interactions and the countdown arithmetic: **SHIP**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | typecheck, lint, format, build green                                                                                                                                                                                           | Rest lock complete and confirmed; needs Ryan's in-game feel check on the recovery duration                                         |
| 2026-08-03 18:15 UTC | Opus — playtest fixes (companion AI), rounds 1-7   | **Seven review rounds on `Mongo.ts`**, six of which found a defect living inside the previous round's fix — the pattern this plan has hit at every stage. Ryan's four complaints (shakes while following; follows and chases at once; walks into walls; will not stay with the cat) all traced to `updateAI`. Round 1 fixes: a latched `following` flag (`standBy` re-decided from raw distance every frame, so crossing the threshold stopped him and the cat's next step restarted him — walk/stand on alternate frames); a `canNotice` perception gate on acquisition, the only mob targeting path in the codebase that had none; `Mob.astarSearchFailed` exposed so an unroutable target is dropped rather than beelined into; a target held across frames instead of re-picked, since two mobs a pixel apart traded "nearest" and swapped his goal tile faster than a path could be walked; and the radii rebuilt with the leash governing (engage 4.5 from the cat, persist 6.0, break 7.0, resume 3.0). Rounds 2-7 then found, in order: the leash kept the target that broke it (the short-circuit that skips selection while leashed also skipped the drop); an occluded target froze him solid, because his goal is the target's _last known_ tile, which routes fine — A* succeeds, he arrives, and nothing ever changes; a stale no-route verdict from a *cat* path blamed on a mob; blows landing through walls on the abandoning frame; `standBy` with no animation guard, so his own killing bite left him sliding mid-swing (two movement writers in one frame during a pounce); the stall detector reading `isMoving`, which `followTargetCollide` sets true even when both the direct step and the unstick step moved him zero pixels — see the `ismoving-is-not-motion` memory; the LOS hoist creating a soft-lock in the band where a straight-line reach test and a sight-based attack gate disagree across a corner; the leash-break ban blaming the mob when the *player* was the one who moved; that ban's exemption testing `retaliateMob`, which nothing clears while he lives, so it exempted every mob he had ever bitten; and finally a purely relative lift bar that inverted for a mob already beside the cat, refusing to release the one standing *on* her. Final shape: `offLimits: Map<Mob, TargetBan>` with a distance-anchored early lift floored at 2.25 tiles, a displacement-measured stall counter shared by the chase and in-reach branches, a navigation-goal reset that discards stale A* verdicts, and LOS on all three attacks. The header rationale was rewritten — `ENGAGE_PERSIST_TILES < LEASH_BREAK_TILES` does _not_ prevent the yo-yo, because persist is straight-line and the leash is route-length, and the old comment invited a future editor to widen the bands on that false guarantee.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | lint, format, build green on `Mongo.ts` + `Mob.ts`; tsc clean for both. Repo-wide `npm run typecheck` is red on `src/creatures/Troglodyte.ts:262` from a parallel agent's troglodyte-sprite refactor — unrelated and untouched | AI rework complete and reviewed to SHIP; needs Ryan's in-game re-test of following, targeting and the leash                        |
| 2026-08-03 19:40 UTC | Opus — playtest fixes (spawn tile + juvenile gait) | **Ryan's third playtest ask**, four review rounds to SHIP. (1) _Summoned into walls in a thin hallway._ Two bugs: the cat's tile was read as `floor(cat.x / TILE_SIZE)`, which is the tile under her sprite's top-left **corner** rather than under her — one tile off in a corridor, where that neighbour is masonry — and the "behind her is blocked" fallback used that same unvalidated tile, so the one branch written to handle a blocked spawn placed him on ground nothing had checked. Now `findSpawnTile` derives her tile from her centre and ring-searches via `findNearbyWalkableTile`, requiring line of sight from her (so a blocked corridor is not solved by putting him through the wall) and excluding stairwell tiles (`isWalkable` admits them, `Mob.moveWithCollision` refuses to enter one — the spawn contract now matches the movement contract). Review round 1 found the fallback still violated the requirement on the _only_ path that reached it: LOS to her own tile is trivially true, so the search always succeeds while her tile is walkable, meaning `spawn === null` implies her tile is **un**walkable — and it returned exactly that. Fallback deleted; the summon is refused, with a "No room for Mongo!" bubble, because `canSummon` stays true and a live-looking button that does nothing reads as a dropped input. (2) _Juvenile animation vibrating._ His walk phase was distance-driven, which is the right way to keep feet planted and is unreachable here: a juvenile's leg is half a tile, so `strideOf = (femur + tibia) * 0.62` gives 0.31 tiles, and covering the 3.75 tiles/s his speed asks for needs twelve strides a second — ninety-odd sprite frames from an eight-frame row on a sixty-frame display. Past one frame per tick the row is **undersampled**, not played. The art cannot be redrawn around it either: a stride long enough to sync would step further than the leg extends and G6 would reject it. First fix was a flat clamp, which round 2 showed binds at _every_ stage and speed (slowest honest cadence is 1.31 frames/tick against a 0.5 cap) — killing the distance-driven design outright, flattening all three stages to one cadence, and making the recall sprint moon-walk. Replaced with `syncGaitToDistanceCovered`, ported from `Signet.ts`: cadence from pixels actually covered last frame, so wade (36%) and slow (35%) — applied _inside_ `moveWithCollision`, invisible to anything reading `this.speed` — are picked up by construction. Round 3 caught that the port dropped Signet's ceiling, and that the dominant unbounded displacement is not the pounce but **the player**: the separation pass shoves an overlapped pet ¾ of the overlap, ~9 px against his own 2, which reads back as 5× speed and re-opens the strobe by standing next to him. Ceiling added, derived from `RECALL_SPEED_MULTIPLIER` and floored under a new exported `MONGO_UNDERSAMPLING_FRAME_LIMIT`. (3) Refactoring the runtime `FRAME_COUNT` literals into named constants **silently disabled bake gate G10** for all 16 rows — its regex captured `(\d+)` and _skipped on no-match_, reporting nothing. It throws now and resolves named constants across both `mongoSprite.ts` and `mongoAttackTiming.ts`. (4) `MongoPreviewScene` played the walk at 12 fps against the shipping 30, which is why five rounds of art review never saw the strobe; it now derives from the shared constant. | typecheck, lint, format, build, `npm run gen:mongo` all green                                                                                                                                                                  | Spawn + gait complete and reviewed to SHIP; needs Ryan's in-game check that the gait reads right and that feet-slide is acceptable |
