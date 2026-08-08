# Juicer Redraw & Rework Plan

The Juicer is being redrawn as an extremely buff, large lizard man with a full baked sprite sheet (all facings, sprint, throw, ground punch, gore), and gains three behavior changes: a sprint to reach dumbbells, a ground-punch shockwave attack with a cooldown, and player knockback on dumbbell hits. His speech (the `TAUNT_PHRASES` bro-taunts and the speech bubble) persists unchanged.

This plan is written for an implementing agent. Everything here is agent work end to end — bake, gate, blind-image-review, wire, verify. No step waits on a human.

---

## 0. Read these first

Skills (invoke via the Skill tool, in this order as each phase needs them):

1. `game-architecture` — before touching any gameplay code.
2. `bipedal-figure` — before writing any art code. This is the governing method for the whole redraw. Its three reference docs (`anatomy.md`, `gates.md`, `review.md`) are mandatory reading, not optional.
3. `add-sprite` — for manifest/loader/draw-wrapper wiring.
4. `add-creature` — for the `Juicer.ts` behavior changes.
5. `add-sound` — for the new audio cues.

Reference implementations to copy the shape of (never invent a new pipeline shape):

- `scripts/carlArt.ts` + `scripts/generate-human-sprite.ts` — the **only** motion/gait reference. Never take motion from goblins or clowns.
- `scripts/tusklingArt.ts`, `scripts/generate-tuskling-sprite.ts`, `scripts/generate-tuskling-sprite.gates.ts`, `scripts/render-tuskling.ts`, `src/sprites/tusklingAttackTiming.ts`, `src/sprites/tusklingSprite.ts`, `src/creatures/Tuskling.ts` — the most recent complete bipedal redraw; mirror its file set and gate list.
- `src/creatures/DarkKnight.ts` — the template for the ground punch (offset slam point, telegraph, `drawWorldFeedback`).
- `src/sprites/smushBlast.ts` + `src/systems/SmushEffectSystem.ts` — the template for a runtime-drawn shockwave and screen shake.
- `src/creatures/KrakarenClone.ts` + `BossRoomSystem.renderKrakarenSlams` — the "boss exposes read-only markers, a system draws them" pattern.
- `scripts/trogTongue.ts` + `src/sprites/troglodyteTongue.ts` — the anchor-contract-module pattern (reused here for the held-dumbbell hand anchors).

---

## 1. What exists today (map of the current implementation)

- **Creature:** `src/creatures/Juicer.ts` — `class Juicer extends Mob`, `isBoss = true`, `audioTag = 'juicer'`. All tuning constants live in a const block at the top of the file (`JUICER_HP 120`, `JUICER_SPEED 1.0`, `JUICER_SPEED_ENRAGED 1.7`, `THROW_WINDUP_FRAMES 60`, `THROW_COOLDOWN_FRAMES 90`, `FORCE_ATTACK_FRAMES 300`, etc.).
- **State machine:** `type JuicerState = 'idle' | 'seeking_dumbbell' | 'pursuing' | 'winding_up' | 'cooldown'`. He seeks a dumbbell (walking speed, `followTargetAStar`), signals pickup via `requestDumbbellAt` (consumed by `JuicerRoomSystem`), kites the player to a 4–9 tile throw band, winds up 60 frames, throws, cools down. With no dumbbell available he approaches to 3 tiles and just stands there — he has **no** melee or close-range answer today.
- **Projectile:** a private `interface Projectile { x, y, vx, vy, ttl }` with a single `activeThrow` slot on the mob. Linear flight, wall bounce with `THROW_BOUNCE_DAMPING`, hit radius `HIT_RADIUS_TILES 1.5`. On hit: shell-block check (`isPointInsideShell` → `addBlockXp`), else `dealDamage(t, THROW_DAMAGE)` + `damageFlash`. **Damage only — no knockback.**
- **Art:** `src/images/bosses/juicer.png`, manifest entry `juicer` in `src/images/bosses/manifest.json` (208×256 frames, tileX 72, tileY 50, tileScale 64). Rows: `walk`(8), `idle`(1), `throw`(6), `walk_enraged`(8), `idle_enraged`(1). Side-facing only, mirrored via `flipX` — **no front/away rows**. This is the only creature sheet in the game with **no generator script**. The draw wrapper is `src/sprites/juicerSprite.ts` (`drawJuicerSprite`, `drawThrownDumbbell`, `drawJuicerSpeechBubble`). The held dumbbell is currently a parameter that is accepted and ignored (`_heldDumbbell`).
- **Speech:** `TAUNT_PHRASES` in `Juicer.ts` (`'Bro'`, `'I need a spot, bro'`, `"Excuses don't lose calories"`, …), cycled every `TAUNT_INTERVAL 300` frames while aggro'd, rendered by `drawJuicerSpeechBubble` in `juicerSprite.ts` (drawn outside the damage-flash filter). **This persists exactly as-is.**
- **Arena:** `src/systems/JuicerRoomSystem.ts` owns dumbbell/bench/treadmill floor pickups (`DUMBBELL_POSITIONS`, respawn timers, `getActiveDumbbellPositions()`, checkpoint capture/restore). `BossRoomSystem` owns lock/defeat lifecycle and clamps the boss and joined players to the room. `BarrierSystem` is the player-side use of gym gear.
- **Gore:** none. `bodyPartKey` is not overridden, so `BodyPartGoreSystem.spawnParts` no-ops and he dies with only the generic blood burst.
- **Audio:** one sound, `juicer_throw` (`src/audio/bosses/juicer/juicer_throwing.mp3`), fired via `specialSoundPending` and drained in `playMobAudioCues` in `src/systems/GameLoopPhases.ts`.
- **Death text:** `src/ui/DeathExplanations.ts` key `juicer` (dumbbell-themed lines), mapped from the class name in `DeathCauseSystem.ts`.
- **Player knockback does not exist anywhere in the codebase.** The closest primitive is the module-private `pushPlayerWithCollision(player, dx, dy, map)` in `src/systems/MobUpdateLoop.ts` (per-axis wall collision mirroring `Mob.moveWithCollision`). This rework introduces the game's first hit-driven player displacement — Section 6 specifies it.

---

## 2. Visual design brief: the buff lizard man

Identity: an enormous, roided-out lizard bro. Gym-rat swagger, reptile anatomy, comically overdeveloped upper body. He must read instantly at in-game size (32px tile, sheet baked at tileScale 64) as (a) a lizard, (b) absurdly muscular, (c) big.

**Proportions** (pin these first, per the bipedal-figure skill — height in tiles plus heads-tall, every joint derived from those, never from the head):

- `FIGURE_HEIGHT` ≈ 2.3 tiles — taller than Carl (2.03). He should visibly tower.
- Heads-tall ≈ **4.2** — deliberately fewer heads than Carl's 4.8. Head count is how size is read: a giant needs FEWER heads of height, and extremities shrink with it. A small-ish head on a huge frame is also exactly the bodybuilder silhouette.
- Shoulders dramatically wider than hips — this is both the anatomy rule (hips must never exceed shoulders) and the character. Trapezius mass rising toward the skull, lat flare wider than the pelvis by a factor that survives 32px, thick neck shorter than Carl's.
- Legs proportionally smaller than the torso ("never skips upper body day, always skips leg day" is a legitimate silhouette joke that also satisfies the top-heavy read) but still thick enough to carry him — digitigrade lean is optional; a plantigrade stance like Carl's is safer for the walk cycle and is the default choice.
- A thick, muscular tail, tapering, held off the ground. The tail is the strongest lizard cue at distance, it fills the away/side silhouettes, and it provides a gore piece.

**Head (the lizard read):** the established traps from prior reptile work in this repo apply directly:

- **Go shorter on the muzzle, not longer.** A long muzzle reads as a beak. The reptile cue is lip scales, an ear disc, and a heavy brow — not snout length.
- **Head-on views need a turned head.** A snout square to the camera projects to a stub; foreshorten a three-quarter profile instead on `front` rows.
- Two head radii (tall oval head-on, deeper in profile), jaw holding width to the top of the mouth.

**Skin/palette:** scaled hide in two-tone ramps (e.g. an olive/jade dorsal ramp and a paler belly-plate ramp down the chest and tail underside — belly plates double as pec/ab definition at small scale). Muscle definition comes from ramp banding at the silhouette, not interior line detail — silhouette beats detail, always. Give him gym shorts (each shorts leg is a cuff wrapped round its own thigh — see the clothing trap notes) and optionally lifting-glove wraps on the forearms; keep any printed motif ≥3 sheet px or cut it. If any hide tone approaches the dungeon floor's luminance, add a rim light — a near-black or floor-luminance creature is a smudge at 32px.

**Enrage visuals are a runtime treatment, not baked rows.** The old sheet doubled `walk`/`idle` into `_enraged` variants; do not carry that forward — with 5 states × 3 views it would double a much larger sheet. Instead, when `isEnraged`, apply a named-constant `ctx.filter` flush (e.g. `ENRAGED_FILTER = 'saturate(1.6) brightness(1.08)'`) inside `drawSelf` around the sprite call (composing with the existing damage-flash filter — damage flash wins when both are active), and drive the idle/walk cadence slightly faster via a named multiplier. This keeps the texture budget sane and the enrage read stronger than the old palette swap.

---

## 3. Sheet architecture

One body sheet, `src/images/bosses/juicer.png`, replacing the current file at the same manifest key `juicer` (same key = zero changes needed in `assetGroups.ts` / `MOB_SPRITE_KEYS` / preload lists). Frame geometry (`frameWidth`, `frameHeight`, `tileX`, `tileY`) is **measured at bake time, never authored** — the generator prints the exact manifest entry and the gate verifies it (Tuskling `gateManifest` pattern with the `SKIP_MANIFEST_GATE` escape hatch). `tileScale` stays 64.

Row order follows the established convention — head-on / side / away triplet per state, then a single gore row with one column per piece:

| Rows  | State (manifest names)                    | Frames | Kind    | Notes                                                                                                                                                                                                                                                                                                                     |
| ----- | ----------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–2   | `idle`, `idle_side`, `idle_away`          | 8      | loop    | Weight shifting foot to foot, slow breath, tail sway. Clock-driven at runtime (`timeFrameIndex`) so multiple instances don't breathe in lockstep.                                                                                                                                                                         |
| 3–5   | `walk`, `walk_side`, `walk_away`          | 16     | loop    | Heavy, rolling gym-bro walk. 16 frames per the skill's walk-row rule. Carl's gait is the only motion reference. Pelvis drops at contact; stride must clear the IK clamp on every frame (foot-slide gate).                                                                                                                 |
| 6–8   | `sprint`, `sprint_side`, `sprint_away`    | 12     | loop    | Forward-leaning, arms-pumping charge run. Distinct silhouette from walk: deeper lean, longer stride, tail streaming behind. Empty-handed (he sprints TO a dumbbell — the carry happens after pickup).                                                                                                                     |
| 9–11  | `throw`, `throw_side`, `throw_away`       | 10     | oneShot | Windup-through-release as one progress-driven row: crouch + hip coil, two-hand overhead heave, release, follow-through. The release is the peak frame (impact-is-the-peak gate). The rebound lives in follow frames, not a fifth beat. The dumbbell itself is NOT baked into these rows — see the overlay contract below. |
| 12–14 | `punch`, `punch_side`, `punch_away`       | 12     | oneShot | Ground punch: rear up, both fists (or one massive fist) driven into the floor ahead, crouched recovery. Impact at `JUICER_PUNCH_IMPACT_PROGRESS`. The shockwave is NOT in the sheet — its radius is a gameplay value, so it is drawn live (the Smush-blast rule).                                                         |
| 15    | `gore_head` … `gore_tail` (colOffset 0–7) | 1 each | gore    | Eight pieces, Section 8.                                                                                                                                                                                                                                                                                                  |

**Timing contract module: `src/sprites/juicerAttackTiming.ts`** — imports nothing (it is consumed by both the node-canvas generator and the browser bundle), following `tusklingAttackTiming.ts`. It holds: `JUICER_IDLE_FRAMES = 8`, `JUICER_WALK_FRAMES = 16`, `JUICER_SPRINT_FRAMES = 12`, `JUICER_THROW_FRAMES = 10`, `JUICER_THROW_RELEASE_PROGRESS = 0.55`, `JUICER_PUNCH_FRAMES = 12`, `JUICER_PUNCH_IMPACT_PROGRESS = 0.5`, plus the frame-hold constants for sprint cadence. Its docstring must name the consumers that must agree: the choreography, `Juicer.ts`'s release/impact countdowns, the bake gates' peak-frame checks, and the row lengths `juicerSprite.ts` plays.

**Held-dumbbell overlay contract.** The dumbbell is conditional (`heldDumbbell` is sometimes false during pursuit), so it cannot be baked into any row — one sheet cannot carry a conditional prop. Instead:

- New contract module `src/sprites/juicerHandAnchor.ts` (imports nothing), exporting `JUICER_HAND_ANCHORS`: per-view anchors for the carry states, and per-view × per-frame anchors for the `throw` rows (the hands travel through the heave, exactly like `TROGLODYTE_LASH_MOUTH_ANCHORS` tracks the thrown head).
- `juicerSprite.ts` draws the held dumbbell at runtime using `drawDumbbellHeld` from `src/sprites/gymEquipmentSprite.ts` (the one existing dumbbell art source — do not draw a second dumbbell), positioned by the anchor, mirrored when `flipX`, and drawn **under** the gripping fists per the prop rule; on `_away` views the carry draws before the body.
- The generator computes the same anchors from the rig and a gate (`gateHandAnchors`, modeled on the Troglodyte's `gateMouthAnchors`) asserts the runtime table matches the rig to within a small tolerance.
- During `throw` rows the overlay is drawn only while `progress < JUICER_THROW_RELEASE_PROGRESS`; at release the airborne projectile takes over on the same frame.

**Texture budget.** He is a big boss (~2.3 tiles tall at 2× bake) with 16 rows; the sheet will be several times the Tuskling's 2.4 MP. Set `TEXTURE_BUDGET_MEGAPIXELS = 8` in the gates as a hard ceiling and report the measured figure even on pass. He is a single-instance boss preloaded with `level1`, so this is affordable; if the bake exceeds the ceiling, shrink `SPRINT`/`PUNCH` frame counts before shrinking frame size — resolution is not the lever.

---

## 4. Offline pipeline (files to create)

Follow the four-file shape exactly; the naming to mirror is the Tuskling's.

1. **`scripts/juicerArt.ts`** — the painter. Palette ramps, tile-unit proportion constants, `type JuicerView = 'front' | 'back' | 'side'`, the `ViewSpec` table (with both `lateral` and `girth` — a profile this wide needs the two factors separated), `interface JuicerPose` with IK hand/foot targets plus FK `ArmAngles` escape hatches (walking/sprinting arms MUST be FK — an arm placed by its hand cannot swing), `restingPose()`, the IK layer (`solvedArm`, `shoulderJoint`), and `drawJuicerFront/Side/Back(ctx, pose)`. Knows nothing about animation.
2. **`scripts/juicerGore.ts`** — eight severed pieces (Section 8) routed through the shared `scripts/goreWound.ts` helpers, each carrying its `state` name, drawn at tile-unit sizes with `GORE_PIECE_SCALE` ≈ 1.7 so they survive the runtime 0.5×.
3. **`scripts/generate-juicer-sprite.ts`** — choreography only. Sheet geometry constants (`TILE_SCALE = 64`, `SUPERSAMPLE = 2`, `FRAME_PADDING`, `FRAME_SIZE_QUANTUM = 8`), one pose function per row, the exported `ROWS: readonly RowSpec[]` table (`kind: 'loop' | 'oneShot' | 'gore'`), `GORE_STATES` derived from the pieces, `bake()`, `writeSheets()`, hand-anchor computation exported for the gate. Frame counts imported from `juicerAttackTiming.ts`. Pace motion with a phase-speed multiplier, never by scaling frame index. Use the rat generator's **two-pass gore re-centring** (pass 1 measures each piece's ink centre, pass 2 re-bakes with the offsets; cell sizing clears the gore radius on both axes because spinning pieces sweep the diagonal), and the `GORE_AREA_INFLATION_LIMIT` guard so the gore row doesn't inflate every animation cell.
4. **`scripts/generate-juicer-sprite.gates.ts`** — the npm entry point. Bakes into memory, runs every gate, accumulates failures into one thrown report ("N gates failed; nothing was written"), and only then writes. The single-bake rule holds: the gated sheet is the one written. Gate list (IDs carried in messages with measured value AND limit): border clip, anchor (against `SOLID_ALPHA_THRESHOLD` so the contact shadow doesn't count), loop closure, motion continuity (with a declared-spike allowlist if the punch needs one), centroid drift, one-shot settle (throw and punch rows), foot slide (walk AND sprint side rows in `TRAVELLING_ROWS`), leg reach, arm reach (reach gates measure the demand, and every reach/arc gate is paired with an ink-presence gate expressed as a share of the frame's own ink with a hard floor), impact-is-the-peak (throw release and punch impact), `gateSprintLeadsWithTheShoulders` (sprint lean actually present — mirror `gateChargeLeadsWithTheHead`), gore legibility, gore distinctness (16×16 mask IoU, normalise scale but not aspect), `gateGoreContract` (imports `JUICER_GORE_PARTS` from `src/sprites/juicerSprite.js` and asserts equality with `GORE_STATES`), `gateHandAnchors`, texture size, manifest sync (`SKIP_MANIFEST_GATE` escape hatch that prints the exact JSON to paste). Remember: gates go blind in pairs, and a gate that cannot find its row must fail loudly, not skip green.
5. **`scripts/render-juicer.ts`** — review harness: `--out`, `--scale`, `--row`, `--frame`, `--part` (crop table for head/torso/arms/legs/tail), `--mode=sheet|parts|gore|onion|delta|arc`, `--fresh`. Include an in-game-size strip (32px tile) in the contact sheet.
6. **`src/scenes/JuicerPreviewScene.ts`** wired to `?juicer` in the dev boot path (follow `TusklingPreviewScene` and how `?tuskling` is registered). Remove or update the stale `juicer` entry in `scripts/svgSubjects.ts` if it conflicts with the new sheet.
7. **`package.json`:** `"gen:juicer": "tsx scripts/generate-juicer-sprite.gates.ts"`. If `tsconfig.scripts.json` lists script files individually, register every new script file there — an unregistered script is never typechecked.

**Blind image review loop (mandatory, minimum three rounds plus one confirming round after it looks right):** render the contact sheet, hand ONLY the PNG to a fresh agent with the design brief from Section 2 and no source access, demand numeric findings (pixel measurements and ratios, not adjectives), apply, re-render, repeat. Include a round judged at in-game size. Run a blind identification test on the gore pieces (an agent naming each piece cold) and on the held dumbbell in the carry pose. After the final fix round, run one more review round anyway — a fix can entrench the bug it fixed.

---

## 5. Runtime wiring

**`src/sprites/juicerSprite.ts` — rewrite.**

- `drawJuicerSprite` gains the full view logic: `viewFor(facingX, facingY)` (vertical facing wins ties to `side`), `stateFor(base, view)`, `flipX` only on `side` views. State priority chain: `punch → throw → sprint → walk → idle` — a committed attack always wins over the locomotion it interrupted.
- Frame counts come from an exhaustive `Record<JuicerSpriteState, number>` sourced from `juicerAttackTiming.ts` (the Tuskling approach — a missing row is a compile error).
- Loops via `walkFrameIndex`, one-shots via `progressFrameIndex`, idle via `timeFrameIndex` with an `idleFrame` override for the preview harness.
- The `heldDumbbell` parameter goes from ignored to implemented (overlay contract, Section 3).
- `drawThrownDumbbell` keeps its trail but the spin must become frame-driven: rotation from a projectile `age` counter, not `Date.now()` (a stall dispatches queued time all at once; wall-clock animation lies).
- `drawJuicerSpeechBubble` persists as-is, but its vertical anchor is derived from the new measured sprite height so the bubble sits above the new, taller head.
- Export `JUICER_GORE_PARTS` (ordered, matching `GORE_STATES`) and `JUICER_BODY_PART_KEY = 'juicer'`.

**Manifest:** update the `juicer` entry in `src/images/bosses/manifest.json` with the bake-measured geometry and the new state table (paste from the gate's printed JSON). The `walk_enraged` / `idle_enraged` states are deleted.

**`src/creatures/Juicer.ts` drawing:** `drawSelf` passes the new state fields (sprint flag, throw progress, punch progress, facing, held dumbbell), applies the enraged filter treatment (Section 2), and keeps `renderMobHealthBar`. After the first successful bake, **re-measure the tile anchor**: health-bar and aggro-marker offsets key off it and will be wrong after a redraw. Facing correctness now matters in four directions — every movement path (A* follow, kiting back-away, sprint) must write `facingX`/`facingY`, and note the known trap that `followTargetCollide` returns before writing facing when already at range: verify a stationary-at-range Juicer faces his target (the windup state already writes facing explicitly; extend that discipline to `pursuing`).

**Asset checks:** run `npm run verify:assets` — the key set is unchanged (`juicer` only; no new sheet keys are introduced), so this should stay green without edits.

---

## 6. Player knockback (new mechanic — first of its kind in the codebase)

Nothing currently displaces the player on hit; this section introduces the primitive both new attacks use.

**Displacement helper.** Move the module-private `pushPlayerWithCollision(player, dx, dy, map)` out of `src/systems/MobUpdateLoop.ts` into a new shared module `src/systems/playerDisplacement.ts`, export it, and update `MobUpdateLoop`'s call sites to import it (move it — no re-export shim left behind). It already does the right thing: per-axis wall collision with the same leading-edge/tile-centre anchors as player movement.

**Knockback state on `Player`** (`src/Player.ts`):

- Fields: `knockbackDirX`, `knockbackDirY` (unit vector), `knockbackFramesRemaining`, `knockbackTotalFrames`, `knockbackDistancePx`.
- `applyKnockback(dirX, dirY, distancePx, frames)` — normalises the direction, replaces any active knockback (latest hit wins; do not stack).
- Cleared in `clearTransientCombatState()` and on death/knockout.

**Per-frame application.** In `src/systems/GameLoopPhases.ts`, a new `applyKnockbackMotion(player, gameMap)` runs immediately after `applyMovement` in the documented phase ordering (update the phase-ordering comment at the top of the file to include it). Each frame it moves the player `knockbackDistancePx * easeShare` along the direction via `pushPlayerWithCollision`, where `easeShare` front-loads the displacement (ease-out over `knockbackTotalFrames`) so the hit reads as an impact, not a glide. Rules:

- Knockback applies **even while `hasStatus('stuck')`** — it is physical displacement, not walking. (`applyMovement`'s stuck early-return is separate and stays.)
- It does not set `isMoving` and never writes facing — the player faces the hit, staggering backward.
- Per-frame displacement is capped below one tile (`KNOCKBACK_MAX_STEP_PX`, a named constant) so a large knockback cannot tunnel a wall — the per-axis collision test only sees one step at a time.
- Player input still applies in the same frame (the two displacements sum); the knockback share dominates early frames naturally because it is front-loaded.
- `BossRoomSystem` already re-clamps a joined player displaced through the doorway on the following frame — its player-containment comment anticipates exactly this mechanic. No changes needed there, but verify the clamp interaction in a playtest script pass (knock a player at the doorway; they must end inside).
- `BuildingInteriorScene` uses a different movement path and no Juicer exists there; the knockback tick lives only in the dungeon loop phases, and the fields are inert elsewhere.

**Dumbbell impact knockback.** In `updateProjectile`'s hit branch: direction = the projectile's velocity normalised; `t.applyKnockback(nx, ny, TILE_SIZE * DUMBBELL_KNOCKBACK_TILES, DUMBBELL_KNOCKBACK_FRAMES)` alongside the existing damage + `damageFlash`. Raise the flash to a bigger-hit value (`DAMAGE_FLASH_DUMBBELL`, larger than the current 8 — the Krakaren's 12-vs-8 slam/swing split is the idiom). A shell block absorbs the knockback along with the damage (the existing `isPointInsideShell` branch stays the outer gate).

---

## 7. Behavior changes in `Juicer.ts`

### 7a. Sprint to dumbbells

- In `doSeekDumbbellState`, when a `nearestDumbbellPos` exists and is farther than `SPRINT_MIN_DISTANCE_TILES` (~2), he sprints: pass an explicit speed of `this.moveSpeed * SPRINT_SPEED_MULTIPLIER` to the follow call, and set a `private isSprinting` flag that `drawSelf` forwards for row selection. Inside the sprint threshold he drops to walk speed for the final approach (so the pickup doesn't overshoot).
- **Never reassign `this.speed` for the sprint.** `applyMobLevel` multiplies speed in place; a transient burst goes through a per-frame derived speed (the `BallOfSwine.currentSpeed()` / Tuskling `CHARGE_SPEED` pattern). Deriving from `this.moveSpeed` keeps the sprint level-scaled. The existing `verify:difficulty` and `verify:companion` gates assert exactly this invariant — they must stay green.
- Sprint animation cadence gets its own frame counter advanced per update (the Tuskling `chargeFrame` precedent) — a distance-driven `walkFrame` undersamples fast movement.
- Sprint only applies while seeking a dumbbell. Pursuit of the player keeps the existing kiting behavior and walk rows.

### 7b. A more convincing throw

- The throw becomes the 10-frame one-shot row driven by the existing `throwAnim` progress. `THROW_WINDUP_FRAMES` continues to control real duration; the row is sampled by progress, so tuning the windup never desyncs the art.
- The release fires at `JUICER_THROW_RELEASE_PROGRESS` rather than at progress 1.0: restructure `doWindupState` so `throwDumbbell(...)` triggers when the windup crosses the release fraction, with the remaining frames playing follow-through before the state advances to `cooldown`. Exact-crossing logic, not `===` on a float — compute the release frame once from the timing module and compare frame counters.
- The held-dumbbell overlay disappears at release on the same frame the airborne projectile spawns (Section 3), so the object visually leaves his hands.
- Add `age` to the `Projectile` interface (incremented in `updateProjectile`) to drive the frame-based spin.

### 7c. Ground punch with shockwave

New states in the union: `'punch_windup' | 'punch_recover'`.

**Trigger:** in `updateAI`, before the throw logic — if a target is within `PUNCH_TRIGGER_TILES` (~1.7) of him, `punchCooldownTimer === 0`, and he is not mid-throw (`winding_up` keeps its commitment), enter `punch_windup`. Snapshot `punchPoint` = a spot `PUNCH_REACH_TILES` (~1.1) in front of him along the facing toward the target, **chosen at windup start and never revised** (the Dark Knight rule — that is what makes it dodgeable).

**Windup (`PUNCH_WINDUP_FRAMES` ≈ 45):** he roots, faces the punch point, plays the punch row's rising portion. Telegraph: `drawDangerCircle` from `src/sprites/dangerTelegraph.ts` at the punch point with radius `PUNCH_RADIUS_TILES` and `fade` = windup progress — drawn from a `protected override drawWorldFeedback(ctx, sx, sy)` (the Dark Knight template; read that method's doc comment about the silhouette-composite crop before writing this one — an offset disc must be drawn outside `drawSelf`).

**Impact:** at windup end, for every target within `TILE_SIZE * PUNCH_RADIUS_TILES` of the punch point (centre-to-centre):

- Shell check first (`isPointInsideShell` on the target centre → `addBlockXp(BLOCK_XP)`, skip everything else for that target).
- `this.dealDamage(t, PUNCH_DAMAGE)`; `t.damageFlash = DAMAGE_FLASH_PUNCH`.
- `t.applyKnockback(nx, ny, TILE_SIZE * PUNCH_KNOCKBACK_TILES, PUNCH_KNOCKBACK_FRAMES)` — direction radially away from the punch point.
- Set the shockwave marker and sound flag (below), start `punch_recover` (`PUNCH_RECOVER_FRAMES` ≈ 30, playing the row's settle), then return to the normal loop with `punchCooldownTimer = this.scaledCooldownFrames(this.isEnraged ? PUNCH_COOLDOWN_ENRAGED_FRAMES : PUNCH_COOLDOWN_FRAMES)`.

**Cooldown:** `punchCooldownTimer` decrements every frame unconditionally (the Hoarder's `pointBlankTimer` precedent — a cooldown, unlike an attack clock, runs without a target). Suggested `PUNCH_COOLDOWN_FRAMES = 360`, `PUNCH_COOLDOWN_ENRAGED_FRAMES = 240`. While it is nonzero and the player crowds him, the existing back-away kiting already answers — no new behavior needed.

**Shockwave visual + screen shake:** the radius is a gameplay value, so the wave is drawn live, never baked. Follow the marker pattern:

- `Juicer` exposes `get punchShockwave(): { x, y, progress } | null` backed by an impact-age counter (`PUNCH_SHOCKWAVE_FRAMES` ≈ 20 of travel; the ring must stop exactly at `PUNCH_RADIUS_TILES` — what the player sees it sweep over is what it hit).
- `JuicerRoomSystem` renders it: a new `src/sprites/juicerShockwave.ts` exporting `drawJuicerShockwave(ctx, frame)` modeled directly on `smushBlast.ts`'s layer structure (scuff, compression ring as a paired multiply/lighter band, dust, debris with deterministic per-seed noise, `GROUND_SQUASH` flattening) but gym-flavored (rubber-mat scuff, chalk dust) and without Carl's air-burst layer. Do not call `drawSmushBlast` itself — that is Carl's blast art.
- Screen shake: `JuicerRoomSystem` gains the `SmushEffectSystem` shake shape (`SHAKE_PEAK_PX`, quadratic falloff, `get cameraOffset()`), armed on impact, and `DungeonScene.camera()` adds it as another term after the map clamp alongside the existing spider-quest and smush terms.

**Reset obligations:** `clearEncounterPhase()` clears `punchCooldownTimer`, `punchPoint`, punch state/progress, and `isSprinting` (the base-class doc names the Juicer as the reason this hook exists). `clearAirborneAttacks()` continues to null `activeThrow`. `JuicerRoomSystem`'s checkpoint restore and `resetForCheckpoint`-style path must drop any live shockwave and shake — a checkpoint must not resume a blast.

### 7d. Death attribution

Pass a source through the punch damage (`'ground_punch'`, matching how the Krakaren and Dark Knight tag `'slam'`) and add one or two punch-flavored lines to the `juicer` entry in `src/ui/DeathExplanations.ts` (e.g. being put through the floor by a lizard's fist). Existing dumbbell lines stay.

---

## 8. Gore

Eight pieces in `scripts/juicerGore.ts`, states in spawn order: `gore_head`, `gore_torso`, `gore_arm`, `gore_forearm`, `gore_thigh`, `gore_shin`, `gore_entrails`, `gore_tail`. Each must survive a blind naming test as what it is — the head keeps the brow/ear-disc/lip-scale cues, the torso slab keeps belly plates, the arm reads as an absurd bicep with a cut deltoid face, the tail is the easiest identifier. Route cut faces through `scripts/goreWound.ts` (`drawWound`, `paintGoreMass`, the shared palette). Clamp any computed alpha above a floor before serializing — node-canvas silently drops exponent-notation alpha and bakes a solid smear.

Registration (three places that must agree, closed by `gateGoreContract`):

1. `src/sprites/juicerSprite.ts` exports `JUICER_GORE_PARTS` + `JUICER_BODY_PART_KEY = 'juicer'`.
2. `src/systems/BodyPartGoreSystem.ts` adds `JUICER_CONFIG: MobBodyPartConfig = { spriteKey: 'juicer', parts: JUICER_GORE_PARTS }` to `BODY_PART_REGISTRY`.
3. The manifest's `gore_*` colOffset states on row 15.

Then `Juicer.ts` adds `override readonly bodyPartKey = JUICER_BODY_PART_KEY`. Leave `rendersWhenDead` false — like every sheet-based creature with gore, the body vanishes and the pieces are the whole death read. `CombatKit.spawnKillGore` needs no changes; gore is opt-in via the key.

---

## 9. Audio

New `SoundId`s in `src/audio/sounds.ts` (alphabetical tuple order) wired as stand-ins from the existing library — no new assets required:

- Ground punch impact: `massive_strike_with_dirt_impact` is the best fit in the library (the Rock Golem's slam). Mark the borrow with a `// [STAND-IN]` comment in the drain, per convention.
- Punch windup: `metal_winding_up` if it reads, else deliberate silence with the flag still drained (the `overheatSoundPending` precedent).
- Dumbbell impact on a player: `rock_thud_1` family as a stand-in layered by the existing damage path.
- Sprint: no loop cue (no suitable asset; leave silent).

**Flag plumbing:** `specialSoundPending` is one boolean and the punch can land near a throw — give the punch its own flags on `Juicer` (`punchWindupSoundPending`, `punchImpactSoundPending`) and drain them with a dedicated `playJuicerCues(...)` in `playMobAudioCues` in `src/systems/GameLoopPhases.ts` (the `playDarkKnightCues` precedent: one function, several flags, none dropped). `juicer_throw` keeps its existing `specialSoundPending` path.

Add any new ids to the `level1` sfx group in `src/audio/sfxGroups.ts` (and `bounty` if the Juicer is listed there) — most of the suggested stand-ins are already preloaded; verify each.

---

## 10. Constants inventory (new, all named — no magic numbers)

In `Juicer.ts` unless noted. Values are starting points; tune freely but keep them named:

```
SPRINT_SPEED_MULTIPLIER = 1.8        SPRINT_MIN_DISTANCE_TILES = 2
PUNCH_TRIGGER_TILES = 1.7            PUNCH_REACH_TILES = 1.1
PUNCH_RADIUS_TILES = 1.8             PUNCH_WINDUP_FRAMES = 45
PUNCH_RECOVER_FRAMES = 30            PUNCH_COOLDOWN_FRAMES = 360
PUNCH_COOLDOWN_ENRAGED_FRAMES = 240  PUNCH_DAMAGE = 4
PUNCH_KNOCKBACK_TILES = 2.2          PUNCH_KNOCKBACK_FRAMES = 14
PUNCH_SHOCKWAVE_FRAMES = 20          DAMAGE_FLASH_PUNCH = 12
DUMBBELL_KNOCKBACK_TILES = 1.4       DUMBBELL_KNOCKBACK_FRAMES = 10
DAMAGE_FLASH_DUMBBELL = 12           ENRAGED_FILTER (juicerSprite.ts)
KNOCKBACK_MAX_STEP_PX (Player/GameLoopPhases)
```

Timing-module constants are listed in Section 3. Balance sanity: with `PUNCH_DAMAGE 4` + `THROW_DAMAGE 3` he stays inside the fairness envelope of `docs/difficulty-fairness-rules.md` — check the punch against its rules for telegraphed close-range attacks (the 45-frame telegraph plus a fixed, never-revised impact point is the compliance mechanism) and adjust per that doc, which is a durable reference.

---

## 11. Implementation order

1. **Timing + contracts first:** `juicerAttackTiming.ts`, `juicerHandAnchor.ts` (initial values; the gate calibrates them).
2. **Art:** `juicerArt.ts` → `generate-juicer-sprite.ts` → `generate-juicer-sprite.gates.ts` → `render-juicer.ts` → `gen:juicer` script → blind review rounds → manifest paste → preview scene.
3. **Runtime sprite wiring:** rewrite `juicerSprite.ts`, update `Juicer.drawSelf`, re-measure anchor, gore registration in `BodyPartGoreSystem`.
4. **Knockback primitive:** `playerDisplacement.ts` move, `Player.applyKnockback`, `applyKnockbackMotion` in the phase loop.
5. **Behavior:** sprint → throw restructure → ground punch (states, telegraph, shockwave marker) → `JuicerRoomSystem` shockwave render + shake + camera term.
6. **Audio, death lines, checkpoint/reset hooks.**
7. **Verification (all must exit 0):** `npm run gen:juicer`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run verify:assets`, `npm run verify:difficulty`, `npm run verify:companion`, `npm run verify:friendly-fire`. The difficulty/companion gates directly assert Juicer enrage/speed/reset invariants that the sprint and punch code touches — if one goes red, the new code broke a real rule; fix the code, never the gate. For each new gate written in step 2, run its negative test: mutate the generator to violate the rule and confirm the gate actually goes red before trusting its green.
8. **Headless behavior check:** drive a scripted fight (browser automation works for this game; the service worker must be unregistered before trusting any browser check) verifying: sprint row plays en route to a dumbbell, punch triggers point-blank exactly once then respects its cooldown, knockback displaces the player away from the punch point and from dumbbell hits without passing through walls, and a knocked-back player at the doorway ends up back inside the room.
