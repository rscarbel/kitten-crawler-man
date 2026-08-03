# Mongo Redesign Plan — Pet Velociraptor Rework

**Status: NOT STARTED** (update this line as phases complete: `IN PROGRESS — Phase N` / `COMPLETE except [HUMAN] items`)

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

- [ ] **A1 — Rig + stage table.** `scripts/mongoArt.ts` skeleton: `MongoPose`,
      `MongoStage`, `MONGO_STAGES` proportion table, `restPose()`, palette constants, the
      three view painters producing a _static standing pose_ in all three views × three
      stages. Deliverable: a static contact sheet via a temporary `render-mongo.ts` mode.
      Gates: typecheck/lint/format. Review: 1 image round on silhouette + §5.3 checklist.
- [ ] **A2 — Walk + idle choreography.** Generator (`generate-mongo-sprites.ts`) with
      `ROWS` for idle/walk ×3 views, measured geometry, `bake(stage)` over `MONGO_STAGES`.
      Gates file with G1–G8, G13, G-FEATHER, G-HEADLEVEL, G-STAGE-SCALE passing. Review:
      ≥2 image rounds + confirming round (§2), including the 32-px strip.
- [ ] **A3 — Attack choreography.** Bite/slash/pounce rows ×3 views + collapse;
      `mongoAttackTiming.ts` created and imported by the generator; G-ARC + G10 added and
      passing. Review: ≥2 image rounds + confirming round; reviewer must check arc traces.
- [ ] **A4 — Manifest + assets land.** Hand-add `mongo_juvenile/adolescent/adult`
      entries to `src/images/enemies/manifest.json` (surgical edit, re-read file first);
      `gen:mongo` script in `package.json`; scripts added to `tsconfig.scripts.json`
      include; full `npm run gen:mongo` green including G11. Gates: typecheck/lint/format.
- [ ] **A5 — Runtime wrapper.** Rewrite `src/sprites/mongoSprite.ts`: stage-aware
      `drawMongoSprite`, `MongoAnimator`, `FRAME_COUNT` map, `drawMongoIcon(stage, …)`.
      No gameplay wiring yet (W1 does that). Gates: typecheck/lint/format + a unit-style
      assertion (script or gate) that `FRAME_COUNT` matches the manifest.
- [ ] **A6 — `?mongo` preview scene.** `MongoPreviewScene` + devBoot route (minimal
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

- [ ] **G1 — MongoSystem lifecycle rework.** Depends on nothing (works against the old
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
- [ ] **G2 — Combat attribution & retaliation.** `xpCreditTarget` on `Player` (default
      `this`), Mongo overrides to `owner`; Mongo attacks pass `this` as attacker and set
      `retaliateMob = this`; `CombatSystem.resolveKills` maps XP-split entries through
      `xpCreditTarget` (cat keeps XP exactly as before — write this as the review
      acceptance criterion) and grants `addKillXp('mongo')` when `killedBy instanceof
Mongo`. Verify the XP-split top-dealer logic still resolves to Human/Cat after
      mapping. Gates + review + confirming round.
- [ ] **G3 — Targeting & movement.** `isPetAttackable` on `Mob` (default `isHostile`),
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
- [ ] **G4 — Persistence.** Register `MONGO_DEF` in both `DungeonScene` and
      `game.ts:resumedAbilityManager` (level/XP then persist through the existing
      `abilityStates` path for free). Add optional `mongoUnlocked?: boolean` and
      `mongoPetHp?: number` to the save payload (`SaveProgressFn` in DungeonScene, the
      `saveProgress` writer in `game.ts`, and `GameProgress` in `src/auth/AuthClient.ts`)
      — optional fields so old saves load unchanged; verify whether the server schema
      stores a blob (then no server change) or named columns (then log a `[HUMAN]` item
      rather than touching `server/`). Restore on boot. Gates + review + confirming round.
- [ ] **G5 — Ability def + UI.** `src/abilities/mongo.ts` per §6; `AbilityId` union +
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

- [ ] **W1 — Swap the art in.** `Mongo.ts` renders through the new `mongoSprite.ts` +
      `MongoAnimator`: stage from `getMongoStats(level)`, 4-facing view selection from his
      facing vector, walk phase from actual distance moved (stride-sync gate G13 keeps
      feet honest), one-shots for bite/slash/pounce, `collapse` playing at the moment hp
      hits 0 before the recall run, runtime fade during despawn. Retire `visualScale`/
      `MongoSize`/`mongoStatsForFloor` and the sine `attackAmt` ping-pong. Health-bar
      offset re-anchored to measured sheet geometry. Gates + review + confirming round.
- [ ] **W2 — In-game verification sweep.** Browser-automation pass (unregister the
      service worker first): summon on floor 2, watch him fight; verify he attacks a calm
      sky fowl in town; verify quest characters (Signet, Gum Gum) are never targeted;
      recall via button and via R; HP bar regen while unsummoned; level-up growth moment
      (use the dev/god-mode level floor `setGodModeMinLevel` if useful for reaching L5/L10
      quickly); circus kidnap lock still blocks summon; cat death triggers recall.
      Findings fixed + confirming round. Feel/timing items go to `[HUMAN]` (§11).
- [ ] **W3 — Cleanup.** Delete `src/images/enemies/mongo.png` + its manifest entry;
      update `sw.js` precache (remove old, add three new); retire the legacy mongo entry
      in `scripts/svgSubjects.ts`; grep for dangling references (`drawMongoSprite` old
      signature, `mongoStatsForFloor`, `COOLDOWN`). Full `npm run typecheck && npm run
lint && npm run format` + `npm run build`. Review + confirming round.
- [ ] **W4 — Final independent audit.** One fresh agent reads this plan's §4
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
- [ ] [HUMAN] If G4 finds the server stores named columns instead of a blob, approve
      the server-side persistence change.

---

## 12. Progress Log (append-only — newest at the bottom)

| When (UTC)                   | Agent/phase | What happened | Gates | Reviews |
| ---------------------------- | ----------- | ------------- | ----- | ------- |
| _(empty — plan not started)_ |             |               |       |         |
