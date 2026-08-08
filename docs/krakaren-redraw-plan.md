# Krakaren Clone Redraw & Rework Plan

The Krakaren Clone is being redrawn from a 542-line procedural ctx drawing into full baked sprite sheets (facing triplets, attack rows, gore), and the fight gains two mechanics:

1. **Guard tentacles** — secondary tentacles erupt from the ground near the player and strike. While any guard tentacle is alive, the player deals 0.25× damage to the main body. Each guard tentacle has its own small health bar and can be killed to restore full damage.
2. **A visible slam tentacle** — when the ground target appears, a big tentacle rises out of the ground beside the main body, dives back under, erupts at the marked spot exactly on the damage frame, and retracts.

This plan is written for an implementing agent. Everything here is agent work end to end — bake, gate, blind-image-review, wire, verify. No step waits on a human.

---

## 0. Read these first

Skills (invoke via the Skill tool as each phase needs them):

1. `game-architecture` — before touching any gameplay code.
2. `add-sprite` — the bake/manifest/loader pipeline. The Krakaren is not bipedal, so `bipedal-figure` does not govern here, but its references (`gates.md`, `review.md`) are still the gate catalog and review method to follow.
3. `add-creature` — for the new `KrakarenTentacle` mob and the `KrakarenClone.ts` changes.
4. `add-sound` — for the new audio cues.

Reference implementations to copy the shape of (never invent a new pipeline shape):

- `scripts/tusklingArt.ts`, `scripts/tusklingGore.ts`, `scripts/generate-tuskling-sprite.ts`, `scripts/generate-tuskling-sprite.gates.ts`, `scripts/render-tuskling.ts`, `src/sprites/tusklingAttackTiming.ts`, `src/sprites/tusklingSprite.ts` — the most recent complete redraw file set; mirror its structure and gate list.
- `scripts/generate-troglodyte-sprite.ts` — the two-sheet precedent (`troglodyteTongue` is a separate sheet because its reach would inflate every body row; the slam tentacle is the same situation).
- `scripts/generate-ball-of-swine-sprite.gates.ts` `gateDescribedCreature` — the described-creature/floor-contrast gate, including reading the floor lightness off the tile renderer instead of copying it.
- `src/creatures/KrakarenClone.ts` `slamShadow`/`slamImpact` + `BossRoomSystem.renderKrakarenSlams` — the "boss exposes read-only markers, a system draws them" pattern. The slam tentacle extends exactly this.
- `src/creatures/TheHoarder.ts` `cockroachSpawns` + `BossRoomSystem.spawnHoarderCockroaches` / `tickCockroachTTLs` — the mid-fight mob-spawn drain and TTL cleanup the guard tentacles reuse.
- `src/creatures/Troglodyte.ts` — the facing-lock-during-windup compliance pattern for telegraphed strikes.
- `scripts/goreWound.ts` — the shared severed-flesh engine; `scripts/ratGore.ts` documents why gore seeds are drawn at construction, never inside `paint`.

---

## 1. What exists today (map of the current implementation)

- **Creature:** `src/creatures/KrakarenClone.ts` — `class KrakarenClone extends Mob`, immobile (`KRAKAREN_SPEED = 0`), `KRAKAREN_HP = 200`, `xpValue = 700`, `audioTag = 'krakaren'`, `cullMarginTiles = 3` (tentacle reach is 2.8 tiles). State machine: `'idle' | 'melee_windup' | 'melee_swing' | 'melee_cooldown' | 'slam_charging'`. Melee: `MELEE_RANGE_PX = TILE_SIZE * 3`, `MELEE_DAMAGE = 3`, windup 20 / swing 15 / cooldown 60 frames, damage at the swing midpoint frame. Slam: every `SLAM_INTERVAL_BASE = 480` frames (300 enraged), `startSlam` snapshots the position of the **closest** living player once, `SLAM_SHADOW_FRAMES = 90` of telegraph, then `executeSlamImpact` deals `SLAM_DAMAGE = 9999` inside `SLAM_KILL_RADIUS_PX = TILE_SIZE * 1.5`, then `SLAM_IMPACT_FRAMES = 20` of impact visual. Enrage at `hp/maxHp < 0.4` shortens the slam interval. `clearEncounterPhase()` resets enrage, timers, and slam state.
- **Rendering:** fully procedural. `drawSelf` calls `drawKrakarenSprite(ctx, sx, sy, tileSize, animTime, isEnraged, facingX, facingY, attackTentacle, attackProgress)` from `src/sprites/krakarenSprite.ts` — 10 sin-driven tentacles studded with human-shaped mouths, mantle, beak, eyes tracking the facing vector, enrage glow ring. `animTime` is continuous; there are no discrete animation frames anywhere. The melee swing animates one randomly chosen tentacle (`attackTentacle`).
- **Slam telegraph:** the boss exposes `slamShadow` / `slamImpact` getters (`SlamMarker { x, y, progress }`), and `BossRoomSystem` caches `liveKrakarens` each update (`cacheLiveKrakarens`) and paints `drawSlamShadow` / `drawSlamImpact` (both currently in `krakarenSprite.ts`) from `renderObjects` in the ground pass. This shipped as a fix — the telegraph must never move back into `drawSelf`, where the boss's own cull margin and hit-flash silhouette box clipped it.
- **A sheet already exists but is never drawn:** `src/images/bosses/krakaren.png` with manifest key `krakaren` (320×320 frames, states `idle`/`attack`/`enraged`, single view). It is preloaded via `assetGroups.ts` groups `boss_krakaren` and `krakaren_clone` yet no runtime code calls it. This redraw replaces that file and manifest entry under the **same key**, so the preload wiring already exists.
- **Damage into the boss:** player-side multipliers are applied in `CombatSystem` before the call; the mob-side entry points are `Mob.takeDamageFrom` and `Mob.takeDamage`, both gated only by the binary `isDamageImmune`. **No fractional mob-side damage-reduction exists anywhere** — the 0.25× guard state is a new primitive (Section 6).
- **Gore:** none. `bodyPartKey` is not overridden; she dies with only the generic blood burst.
- **Spawning:** floor 2 boss (`level2.ts` `bossRooms: [{ type: 'krakaren_clone', minLevel 6, maxLevel 10 }]`), placed at the boss-room centre by `spawner.ts`, level-scaled via `applyMobLevel`. Room floor `KRAKAREN_BOSS_ROOM_FLOOR` renders wet sheen + pink slime in `src/map/tiles/specialFloorTiles.ts`.
- **Coupling to know about:** `BossIntroSystem` draws the boss portrait by calling `drawKrakarenSprite` directly (constants `KRAKAREN_SPRITE_SIZE`, `KRAKAREN_SPRITE_Y_OFFSET`) — any signature change breaks it. `DungeonScene` tracks `krakarenKilled` (Mongo unlock chest), persisted in `WorldCheckpoint`. `scripts/verify-companion.ts` builds `BossRoomSystem` with `['krakaren_clone']` and spawns the boss in eight headless tests. Playtest preset: `npm run playtest -- krakaren`. Death copy: `krakarenCloneSlam` / `krakarenCloneRegularMelee` in `DeathExplanations.ts`, selected by `DeathCauseSystem` on `mobType === 'KrakarenClone'` + attack tag. Mordecai's gateway advice (`mordecaiAdvice.ts`, id `krakaren_clone`) teaches the red-ring telegraph.
- **Audio:** `krakaren_ground_slam` and `krakaren_yell` already exist and stay.

---

## 2. Visual design brief

Identity: a cloned kraken — a wet, heaving cephalopod mass squatting in a flooded pink-slimed lair. She must read instantly at in-game size (32px tile, baked at tileScale 64) as (a) a mass of tentacles, (b) wrong — the mouths — and (c) big.

- **Silhouette:** a broad mantle dome roughly 2.2 tiles wide and 1.8 tiles tall at rest, ringed by ten thick tentacles that coil and drape to a spread of about 2.8 tiles (the reach the cull margin was widened for — do not exceed it in any baked frame, the border-clip gate will hold this). She is immobile, so the tentacles are the whole performance: the idle loop is slow coiling, suckers flexing, mantle breathing.
- **The horror hook stays:** the current procedural art studs the tentacles with human-shaped mouths. Keep them — several per tentacle, lips and teeth legible at 32px or cut down to fewer, larger mouths rather than a texture of illegible dots. In the idle loop a mouth or two should slowly open and close out of phase with the others. Do not animate them with `hump(1 - d/w)`-style windows — that shape is zero at its own centre and makes a blink fire twice; build open/close from an ease up and an ease down.
- **Head/face:** two large tracking-adjacent eyes on the mantle and a chitinous beak beneath. The bake cannot track the player continuously; the facing triplets (front/side/away) carry coarse tracking, and the front view's eyes look at the camera. Foreshorten rather than flatten on the front view.
- **Palette:** magenta-pink flesh ramps (the boss meta color is `#e05090` and her lair drips pink slime — she should look like the source of it), paler ventral sucker rows, wet specular highlights along tentacle tops. Two rules from prior work bind here: a near-black or floor-luminance creature is a smudge at 32px — her lair floor has a wet sheen, so give the silhouette a cool rim light; and the gate must measure her lightness **against the actual lair floor tile renderer's colors** (`specialFloorTiles.ts`), not a copied constant, per the Ball of Swine's `gateDescribedCreature`.
- **Enrage is a runtime treatment, not baked rows.** The old manifest's `enraged` row is deleted. When `isEnraged`, apply a named-constant `ctx.filter` (e.g. `ENRAGED_FILTER = 'saturate(1.5) brightness(1.1)'`) around the sprite call in `drawSelf` (damage-flash filter wins when both are active) and keep a runtime-drawn red glow ring under her (port the existing procedural `ENRAGE_GLOW_*` treatment as a small runtime underlay, drawn before the sprite).
- **Guard tentacle (own sheet):** a single thick tentacle out of a burst of broken floor, same flesh ramps and mouths as the boss so parentage is unmistakable, about 1.4 tiles tall risen. It needs to read as a killable creature, not scenery: it sways, it has a face-like cluster of mouths near the tip, and it recoils on damage flash.
- **Slam tentacle (own sheet):** the largest single piece of art in the fight — a massive tentacle ~2.5 tiles tall at full rise, thicker than the boss's idle tentacles, so the player's eye snaps to it the moment the red ring appears. Its strike frame is a downward smash with splayed tip.

---

## 3. Sheet architecture

Three sheets, all in `src/images/bosses/` with entries in `src/images/bosses/manifest.json`. Frame geometry (`frameWidth`, `frameHeight`, `tileX`, `tileY`) is **measured at bake time, never authored** — the generator prints the exact manifest entry and a manifest-sync gate verifies it (Tuskling `gateManifest` pattern with the `--skip-manifest-gate` escape hatch). `tileScale` is 64 everywhere.

### 3a. Body sheet — key `krakaren` (replaces the unused file at the same key)

| Rows | State (manifest names)                        | Frames | Kind    | Notes                                                                                                                                                                                                       |
| ---- | --------------------------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–2  | `idle`, `idle_side`, `idle_away`              | 10     | loop    | Tentacle coil, mantle breath, out-of-phase mouth movement. Clock-driven at runtime (`timeFrameIndex`).                                                                                                      |
| 3–5  | `swipe`, `swipe_side`, `swipe_away`           | 10     | oneShot | The melee attack: one flank tentacle rears and lashes through the melee arc. The lash crossing the target side is the peak frame (impact-is-the-peak gate). Replaces the procedural `attackTentacle` swing. |
| 6–8  | `channel`, `channel_side`, `channel_away`     | 8      | loop    | Played during `slam_charging`: the whole body braces, tentacles pull taut and root, mantle compresses. Distinct silhouette from idle so the slam is readable off the body alone.                            |
| 9    | `gore_mantle` … `gore_tentacle_b` (colOffset) | 1 each | gore    | Seven pieces, Section 8.                                                                                                                                                                                    |

She never walks (`KRAKAREN_SPEED = 0`), so there are no walk rows — the facing triplets are the directional requirement satisfied for an immobile boss. Side rows are drawn facing +X and mirrored via `flipX`.

### 3b. Guard tentacle sheet — new key `krakaren_tentacle`

| Rows | State                                  | Frames | Kind    | Notes                                                                                                                                                           |
| ---- | -------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `emerge`                               | 8      | oneShot | Floor cracks, burst of debris, tentacle rises to full height. Played once on spawn, after the ground telegraph.                                                 |
| 1    | `idle`                                 | 8      | loop    | Sway + mouth movement. Clock-driven so multiple tentacles don't sway in lockstep.                                                                               |
| 2–4  | `strike`, `strike_side`, `strike_away` | 10     | oneShot | Rear back, whip down/toward the target. View chosen from the direction to the locked strike point; `strike_side` mirrors via `flipX`. Impact is the peak frame. |
| 5    | `retreat`                              | 6      | oneShot | Slides back underground (used for TTL expiry / boss death, NOT for being killed — a killed tentacle bursts into gore).                                          |
| 6    | `gore_tip` … `gore_root` (colOffset)   | 1 each | gore    | Four pieces, Section 8.                                                                                                                                         |

### 3c. Slam tentacle sheet — new key `krakaren_slam`

Drawn only by `BossRoomSystem` (Section 7) — no mob owns it.

| Rows | State   | Frames | Kind    | Notes                                                                                                                                                                                                                                               |
| ---- | ------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `rise`  | 10     | oneShot | Erupts beside the body to full ~2.5-tile height.                                                                                                                                                                                                    |
| 1    | `loom`  | 8      | loop    | Risen, coiling, quivering with intent.                                                                                                                                                                                                              |
| 2    | `dive`  | 6      | oneShot | Plunges back underground (the shadow ring at the target intensifies while it travels).                                                                                                                                                              |
| 3    | `smash` | 12     | oneShot | Erupts at the target and smashes down. The downward impact is the peak frame and must land exactly at the damage frame (Section 7 timing contract). Later frames are the retract — it slides back under and the row ends on empty-ish floor debris. |

The slam tentacle is a separate sheet for the same reason the troglodyte's tongue is: its 2.5-tile rise would inflate every body-row cell. Its `smash` frames are also the widest art in the fight; keep the burst tight around the tentacle — the kill-radius ring itself stays a runtime floor decal (`drawSlamShadow`), because `SLAM_KILL_RADIUS_PX` is a gameplay value and what the player sees sweep must be exactly what hits.

### 3d. Timing contract module — `src/sprites/krakarenAttackTiming.ts`

Imports nothing (consumed by the node-canvas generators AND the browser bundle, like `tusklingAttackTiming.ts`). Holds every row frame count above plus:

- `KRAKAREN_SWIPE_IMPACT_PROGRESS = 0.5` — where in the swipe row the melee damage frame falls (the existing midpoint-of-swing rule expressed as progress).
- `SLAM_RISE_SHARE = 0.4`, `SLAM_LOOM_SHARE = 0.35`, `SLAM_DIVE_SHARE = 0.25` — how the 90-frame telegraph divides into rise/loom/dive (must sum to 1; assert it in the module).
- `SLAM_SMASH_IMPACT_PROGRESS` — where in the `smash` row the tentacle visually hits (the damage fires when the impact visual shows, Section 7).
- `TENTACLE_STRIKE_IMPACT_PROGRESS = 0.6`.

Its docstring names the consumers that must agree: the choreographies, `KrakarenClone.ts` / `KrakarenTentacle.ts` countdowns, the bake gates' peak-frame checks, and the rows the sprite wrappers play.

**Texture budget:** three sheets for one boss room. Set `TEXTURE_BUDGET_MEGAPIXELS` per sheet in each gate file (suggested: 6 for the body, 2 for the guard tentacle, 4 for the slam tentacle) and report measured figures even on pass. All three keys are preloaded together with the floor-2 groups, so the sum is the real cost; if a bake exceeds its ceiling, cut frame counts, not resolution.

---

## 4. Offline pipeline (files to create)

Follow the established file set exactly; the naming to mirror is the Tuskling's.

1. **`scripts/krakarenArt.ts`** — the painter. Import the shared helpers (`clamp01`, `lerp`, `mix`, `rgba`, `hash1` from `carlArt.js` / `ratArt.js` — `rgba` specifically, for the exponent-alpha trap). Flesh ramps, tile-unit proportion constants, `type KrakarenView = 'front' | 'back' | 'side'`, a tentacle-spline drawing core shared by all three subjects (body tentacles, guard tentacle, slam tentacle) so the flesh reads as one creature, mouth-cluster painter, `interface KrakarenPose` (per-tentacle coil phases, mantle squash, swipe progress), and `drawKrakarenFront/Side/Back(ctx, pose)` plus `drawGuardTentacle(ctx, pose)` and `drawSlamTentacle(ctx, pose)`. Two trap notes to honor: tentacle splines are Catmull-Rom-like curves — space the knots by arc distance or corners appear at uneven stations; and any noise sampling uses pixel-space coordinates, never loop indices (`NoiseField` coordinates are pixels).
2. **`scripts/krakarenGore.ts`** — all eleven pieces (seven body + four guard-tentacle, Section 8) routed through `scripts/goreWound.ts` (`drawWound`, `paintGoreMass`, the shared palette). Seeds drawn at construction, never inside `paint` (the rat-gore three-paint rule). `GORE_PIECE_SCALE = 1.7`.
3. **`scripts/generate-krakaren-sprite.ts`** — choreography + bake for **all three sheets** (the troglodyte generator bakes body + tongue from one script; same shape here). Geometry constants (`TILE_SCALE = 64`, `SUPERSAMPLE = 2`, `FRAME_PADDING`, `FRAME_SIZE_QUANTUM = 8`), one pose function per row, exported `ROWS` tables per sheet (`kind: 'loop' | 'oneShot' | 'gore'`), two-pass gore re-centring, `GORE_AREA_INFLATION_LIMIT`, `bake()` per sheet, `writeSheets()`, and `manifestMismatch()`/printed-JSON manifest verification for all three manifest entries (the generator never rewrites the shared manifest file). Guard the direct-invocation write with the `import.meta.url` check so gates and harnesses can import `bake` without painting to disk. Frame counts come only from `krakarenAttackTiming.ts`. Watch the animation Nyquist rule: 8–10 frames cannot carry a fast tentacle oscillation — keep coil frequencies low enough that the sampled cycle doesn't alias to a strobe.
4. **`scripts/generate-krakaren-sprite.gates.ts`** — the npm entry point. Bakes all three sheets into memory, runs every gate, accumulates failures into one thrown report, and only then writes ("a sheet that fails a gate never reaches disk" — the gated bake is the one written). Gate list (IDs in messages with measured value AND limit), per applicable sheet: border clip, anchor (against `SOLID_ALPHA_THRESHOLD`), loop closure (idle, channel, loom, guard idle), motion continuity, centroid drift (the body is rooted — drift is a bug), one-shot settle (swipe, strike, emerge, retreat, rise, dive, smash), impact-is-the-peak (swipe, strike, smash — at the progress constants from the timing module), mouth-presence (an ink/color gate proving the mouth clusters actually baked — gates go blind in pairs; a reach gate without an ink gate once shipped an invisible claw), floor-contrast (body lightness vs the lair floor read off `specialFloorTiles.ts`'s exported colors, the `gateDescribedCreature` pattern), rise-height (the slam tentacle's `loom` ink actually spans its declared tiles — sample the row end to end, not the centre frame), gore legibility, gore distinctness (16×16 mask IoU), `gateGoreContract` (imports `KRAKAREN_GORE_PARTS` and `KRAKAREN_TENTACLE_GORE_PARTS` from the sprite modules and asserts equality with the bakes' `GORE_STATES` — a rename silently drops a body part), texture size per sheet, manifest sync ×3. A gate that cannot find its row must fail loudly, never skip green. For every gate written, run its negative test: mutate the generator to violate the rule and confirm the gate goes red before trusting its green.
5. **`scripts/render-krakaren.ts`** — review harness: `--out`, `--scale`, `--row`, `--frame`, `--sheet=body|tentacle|slam`, `--mode=sheet|parts|gore|onion|delta`, `--fresh`. Part crops as fractions of the cell, not pixel boxes. Include an in-game-size strip (32px tile) in every contact sheet, and a composite mode that stages body + guard tentacle + slam tentacle `loom` together at game scale over a swatch of the lair floor — the fight's whole cast must read as one creature on the real backdrop.
6. **`src/scenes/KrakarenPreviewScene.ts`** wired to `?krakaren` in `src/dev/devBoot.ts` (follow `TusklingPreviewScene` registration). It should cycle body states, spawn/strike/kill a guard tentacle (with its health bar and gore), and run the full slam sequence on a loop.
7. **`package.json`:** `"gen:krakaren": "tsx scripts/generate-krakaren-sprite.gates.ts"`.
8. **`tsconfig.scripts.json`:** add every new script file to `include` individually (`krakarenArt.ts`, `krakarenGore.ts`, `generate-krakaren-sprite.ts`, `generate-krakaren-sprite.gates.ts`, `render-krakaren.ts`) — an unregistered script is never typechecked.

**Blind image review loop (mandatory, minimum three rounds plus one confirming round after it looks right):** render contact sheets, hand ONLY the PNGs to a fresh agent with the Section 2 brief and no source access, demand numeric findings (pixel measurements and ratios, not adjectives), apply, re-render, repeat. Include a round judged at in-game size and a round on the composite mode. Run a blind identification test on the gore pieces (an agent naming each cold) and a blind read of the slam sequence (an agent shown the rise→loom→dive→smash strip must describe "a tentacle goes underground and comes up over there"). After the final fix round, run one more round anyway — a fix can entrench the bug it fixed.

---

## 5. Runtime wiring — body

**`src/sprites/krakarenSprite.ts` — rewrite.** The 542-line procedural painter is replaced by a thin sheet wrapper plus the floor decals:

- `drawKrakarenSprite(ctx, sx, sy, tileSize, state)` where `state` carries `facingX/facingY`, `swipeProgress`, `isChanneling`, and an `idleFrame` override for the preview harness. View selection: `viewFor(facingX, facingY)` (vertical facing wins ties to `side`), `stateFor(base, view)`, `flipX` only on side views. State priority: `swipe → channel → idle`. Frame counts read off the sheet via `getSpriteDefByKey` (`frameCountOf` pattern — never hand-tabled), sampled with `progressFrameIndex` / `timeFrameIndex`.
- `drawSlamShadow` and `drawSlamImpact` **stay in this module as runtime floor decals** (the ring radius is `SLAM_KILL_RADIUS_PX`, a gameplay value). `drawSlamImpact`'s debris ring shrinks to a dust ring that frames the new `smash` art rather than carrying the whole impact alone.
- Exports: `KRAKAREN_GORE_PARTS`, `KRAKAREN_BODY_PART_KEY = 'krakaren'`.
- New sibling module `src/sprites/krakarenTentacleSprite.ts` for the guard tentacle (`drawKrakarenTentacleSprite` with `emerge`/`idle`/`strike`/`retreat` selection; exports `KRAKAREN_TENTACLE_GORE_PARTS`, `KRAKAREN_TENTACLE_BODY_PART_KEY = 'krakaren_tentacle'`).

**`KrakarenClone.ts` drawing:** `drawSelf` keeps the damage-flash filter wrap and `renderMobHealthBar`, draws the enrage glow underlay, then the sprite. Add the enraged `ctx.filter` treatment. Track `swipeProgress` off the existing melee windup/swing timers so the row is sampled by progress and tuning the timers never desyncs the art. After the first successful bake, re-measure the tile anchor — the health-bar offset keys off the sprite height and will be wrong.

**Melee facing lock (fairness upgrade while we're here):** the boss currently re-faces every frame through the windup. Lock facing at `melee_windup` entry (the Troglodyte `facingLocked` pattern) — windup 20 frames + swing-to-impact ~7 gives 27 locked frames, over the 21-frame floor in `docs/difficulty-fairness-rules.md`.

**`BossIntroSystem`:** replace the `drawKrakarenSprite` portrait call with a `drawSpriteKey(ctx, 'krakaren', 'idle', 0, ...)` portrait (or a small helper in the sprite module) sized by the existing `KRAKAREN_SPRITE_SIZE` constants.

**Manifest + assets:** replace the `krakaren` entry, add `krakaren_tentacle` and `krakaren_slam` entries (paste from the gate's printed JSON). Add the two new keys to `assetGroups.ts` in both `boss_krakaren` and `krakaren_clone` groups. Run `npm run verify:assets`.

---

## 6. Mechanic 1 — guard tentacles

### The mob: `src/creatures/KrakarenTentacle.ts`

`class KrakarenTentacle extends Mob`. Immobile (`speed 0`), `isBoss = false`, small stats: `GUARD_TENTACLE_HP = 15`, `xpValue = 25`, no coin drop. `cullMarginTiles` wide enough for the strike reach. `rendersWhenDead` stays false — a killed tentacle bursts into gore pieces (the whole death read), a TTL-expired or boss-death tentacle plays `retreat` then despawns (needs a terminal phase so `justDied`-style logic can't re-latch; follow the isAlive-through-death-animation rule).

State machine: `'emerging' | 'idle' | 'strike_windup' | 'striking' | 'strike_cooldown' | 'retreating'`.

- **Emerge:** spawned invisible-under-ground; a ground telegraph (Section 6, rendering) shows for `TENTACLE_EMERGE_TELEGRAPH_FRAMES = 30` at the locked spawn point (position chosen at spawn request, never revised — the 21-frame locked-telegraph floor applies), then the `emerge` row plays. The tentacle is not damageable until emerge starts (it isn't there yet); from emerge frame 0 it is.
- **Strike:** when a target is within `TENTACLE_STRIKE_RANGE_TILES = 1.6`, `strike_windup` for `TENTACLE_STRIKE_WINDUP_FRAMES = 25` with facing and strike point locked at entry, then the strike row; damage `TENTACLE_STRIKE_DAMAGE = 2` at `TENTACLE_STRIKE_IMPACT_PROGRESS` to targets within `TENTACLE_STRIKE_HIT_RADIUS_TILES = 1.0` of the locked point, attack tag `'tentacle_strike'`. Cooldown `TENTACLE_STRIKE_COOLDOWN_FRAMES = 90`. Flat damage, unscaled radius — undodgeable-once-inside damage never scales, per the fairness rules.
- **TTL:** `GUARD_TENTACLE_TTL_FRAMES = 900` (15s), after which it enters `retreating` and despawns — mirroring `tickCockroachTTLs` so an ignored tentacle doesn't guard forever from across the room; the boss will spawn a fresh one near the player anyway.
- `takesPlayerDamage` stays default-true (it must be killable); the friendly-fire rule needs no exception here. Overhead health bar comes free from `renderMobHealthBar` (it shows while `healthBarTimer > 0`, i.e. once damaged).

### Spawning (the Hoarder drain pattern, verbatim)

- `KrakarenClone` gains `tentacleSpawns: Array<{ x: number; y: number }> = []` and `guardTentacleAtCap = false` (set by `BossRoomSystem` each frame, like `cockroachAtCap`).
- In `updateAI`, while aggro'd with a living target: every `GUARD_SPAWN_INTERVAL_BASE = 600` frames (`GUARD_SPAWN_INTERVAL_ENRAGED = 420`), if not at cap, push a spawn position near the target — a walkable tile `GUARD_SPAWN_MIN_DIST_TILES = 1.5` to `GUARD_SPAWN_MAX_DIST_TILES = 2.5` from the player, validated with the same room-to-move check the cockroach drain uses (walkable is not spawnable — a one-tile pocket passes `isWalkable` and traps the fight's geometry; reuse the drain's validation exactly).
- `BossRoomSystem` gains `spawnKrakarenTentacles(roster)` mirroring `spawnHoarderCockroaches`: counts live `KrakarenTentacle`s (cap `MAX_GUARD_TENTACLES = 2`), drains `tentacleSpawns`, `roster.add(new KrakarenTentacle(...))`, applies the boss's level via `applyMobLevel` (use `setBaseMaxHp`-style scaling only — never raw reassignment after levelling; levelled stats die on reassignment), and calls `boss.registerGuardTentacle(t)`.
- Dead-tentacle cleanup joins the existing spent-cockroach removal pass in `BossRoomSystem` so corpses don't linger in the roster.

### The 0.25× guard — new damage-reduction primitive on `Mob`

There is no fractional reduction anywhere in the codebase; add the hook where the immunity gate already sits so every route into a mob's health passes through it:

- `Mob` gains `protected get incomingDamageScale(): number { return 1; }`, applied inside **both** `takeDamageFrom` and `takeDamage` at the same points that consult `isDamageImmune` (both compute `const prev = this.hp` then subtract — scale the amount just before the subtraction, `Math.max(1, Math.round(amount * scale))` so a hit never rounds to zero). Applying it in both entry points is what keeps swung damage and status/DoT damage consistent — the same reason the immunity doc gives for its three entry points.
- `KrakarenClone` overrides it: `TENTACLE_GUARD_DAMAGE_SCALE = 0.25` while `this.hasLivingGuardTentacle`, else 1.
- `registerGuardTentacle(t)` pushes into a private array; **prune dead entries every update and clear the array in `clearEncounterPhase()`** — holding references to dead mobs pins them (the checkpoint-flags-not-a-Set lesson), and a stale reference would leave her guarded forever.
- **The guard must be legible.** Three tells, all cheap: (a) while guarded, living guard tentacles pulse a brief highlight whenever the boss takes a scaled hit (give `KrakarenTentacle` a `guardPulse` counter the boss pokes from the override's call path — set a flag in the override, consume it in `updateAI`, never do work inside a getter); (b) the boss's damage flash while guarded uses a dimmer named constant so hits visibly "thud"; (c) copy, Section 10.

### Fairness & balance check

Worst case pressure: slam every 300 frames (enraged), one tentacle strike per 90 frames per tentacle, melee at 3 tiles. The tentacle's 30-frame locked emerge telegraph and 25-frame locked strike windup both clear the 21-frame floor; strike damage is flat; the spawn cap and interval are the pressure valves. `verify:difficulty` must stay green; if a rule there binds tighter than these numbers, obey the rule, never relax the gate.

### Reset / checkpoint obligations

- `clearEncounterPhase()` clears `tentacleSpawns`, the guard registry, spawn timers, and `guardTentacleAtCap`.
- Checkpoint restore: guard tentacles are spawned mobs and must not survive a rewind — confirm the world-snapshot mob capture drops them the way cockroaches are dropped (they use the same roster path, so this should come free; verify it in the headless check, Section 12).
- Boss death: all living guard tentacles enter `retreating` (they die with their owner — mob-owned anything dies with the mob; here that's the correct read, and `retreat` makes it look intentional).

### Attribution & copy

`DeathCauseSystem`: map `mobType === 'KrakarenTentacle'` to a new `DeathExplanations.ts` key `krakarenTentacleStrike` (lines about being swatted by the little one while watching the big one). Companion note: the companion may target tentacles — that is desirable (it can break the guard for you), but `verify:companion`'s eight Krakaren tests must stay green; the boss-room veto and engagement rules apply to the tentacle like any non-boss mob.

---

## 7. Mechanic 2 — the visible slam tentacle

The slam already has correct bones: position locked in `startSlam`, 90 telegraph frames, damage at impact, 20 impact frames. This mechanic is **rendering only** plus one timing alignment — do not change the slam's damage, radius, target selection, or interval.

### Fiction and shape

The tentacle travels underground — the same fiction the guard tentacles establish. Sequence, all driven off the existing timers:

1. `startSlam` additionally snapshots a **rise anchor**: a point `SLAM_RISE_OFFSET_TILES = 1.6` from the body centre on the side facing the slam target, snapshotted once (never revised — it's part of the telegraph).
2. During the 90 shadow frames, the telegraph progress drives the slam sheet through `rise` → `loom` → `dive` at the timing module's share constants. While the tentacle is diving, the existing `drawSlamShadow` ring at the target intensifies (drive its alpha up with dive progress) — the read is "it's coming up under the ring".
3. At the impact frame, the `smash` row plays at the **target** position over the existing `SLAM_IMPACT_FRAMES` window, with `SLAM_SMASH_IMPACT_PROGRESS` positioned so the visual hit lands on the first impact frame — the frame `executeSlamImpact` deals damage. The row's tail is the retract; the runtime dust ring (`drawSlamImpact`, slimmed) frames it at exactly `SLAM_KILL_RADIUS_PX`.

### Rendering (the marker pattern, extended — never `drawSelf`)

The rise anchor sits within the boss's widened cull margin, but the smash is up to 12 tiles away — the exact geometry that made the original telegraph invisible. Everything stays system-drawn:

- `KrakarenClone` exposes `get slamTentacle(): SlamTentacleMarker | null` — `{ phase: 'rise' | 'loom' | 'dive' | 'smash', progress, riseX, riseY, targetX, targetY, mirrored }` (`mirrored` = target is west of the body, so the art flips toward it). Backed by the existing `slamShadowTimer` / `slamImpactTimer`; no new timers.
- `BossRoomSystem.renderKrakarenSlams` draws it from the cached `liveKrakarens`: shadow decal first, then the tentacle art via `drawSpriteKey('krakaren_slam', ...)` at the rise anchor (rise/loom/dive) or the target (smash). It draws in the same objects pass as the current slam visuals — precedent already accepted for this fight; the rise anchor should be placed on the **north side** bias of the boss when the target is north, so the ground-pass tentacle doesn't read as pasted over the Y-sorted body (pick the anchor side by target bearing; the snapshot rule still holds).
- A slam in flight must not survive a checkpoint restore or room reset — `clearEncounterPhase()` already zeroes the slam timers, which zeroes the marker; verify the impact-phase marker also clears.

**Sound:** `krakaren_ground_slam` already fires on impact and now has art to match. Add a rise cue (Section 9).

---

## 8. Gore

All pieces routed through `scripts/goreWound.ts`; clamp computed alphas via the shared `rgba` helper (node-canvas drops exponent-notation alpha and bakes a solid smear). Each piece must survive a blind naming test.

**Body (7 pieces, states in spawn order):** `gore_mantle` (the dome, one dead eye), `gore_beak` (chitin, unmistakable), `gore_eye`, `gore_tentacle_a`, `gore_tentacle_b` (different coil poses — the distinctness gate must separate them), `gore_mouth_cluster` (a flesh slab with two of the human mouths — the signature piece), `gore_entrails`.

**Guard tentacle (4 pieces):** `gore_tip` (mouth cluster at the tip), `gore_mid` (sucker-studded barrel segment), `gore_root` (ragged base with floor debris embedded), `gore_sucker_shred`.

Registration (three places that must agree, closed by `gateGoreContract`, for **each** of the two keyed creatures):

1. Sprite modules export `KRAKAREN_GORE_PARTS` / `KRAKAREN_BODY_PART_KEY = 'krakaren'` and `KRAKAREN_TENTACLE_GORE_PARTS` / `KRAKAREN_TENTACLE_BODY_PART_KEY = 'krakaren_tentacle'`.
2. `BodyPartGoreSystem.ts` adds both `MobBodyPartConfig` entries to `BODY_PART_REGISTRY`.
3. The manifests' `gore_*` colOffset states on each sheet's last row.

Then `KrakarenClone` and `KrakarenTentacle` each add `override readonly bodyPartKey = ...`. `CombatKit.spawnKillGore` needs no changes; gore is opt-in via the key. The slam tentacle has no gore (it is never killable).

---

## 9. Audio

New `SoundId`s in `src/audio/sounds.ts` (alphabetical tuple order), wired as stand-ins from the existing library with `// [STAND-IN]` comments per convention — survey `src/audio/` for the closest fits before choosing (dirt/debris burst family for emergence, whip/whoosh for the strike, wet squelch for tentacle death):

- Guard tentacle emerge (fires when the emerge row starts, not at telegraph start).
- Guard tentacle strike impact.
- Guard tentacle death squelch.
- Slam tentacle rise (the audible "look at the boss" cue at telegraph start; `krakaren_ground_slam` keeps the impact).

Flag plumbing: give `KrakarenTentacle` its own pending-sound flags drained by a dedicated `playKrakarenTentacleCues(...)` in `playMobAudioCues` in `src/systems/GameLoopPhases.ts` (the multi-flag `playDarkKnightCues` precedent); the boss's rise cue rides a new flag on `KrakarenClone` beside its existing `specialSoundPending` yell. Add every new id to the floor-2 sfx group in `src/audio/sfxGroups.ts` next to the existing krakaren entries.

---

## 10. Copy

- **Mordecai's advice** (`mordecaiAdvice.ts`, id `krakaren_clone`): add one page teaching the guard: when small tentacles rise near you, your blows barely scratch her — cut them down first. Keep the existing red-ring page; it now also describes the visible tentacle. Keep `{direction}` handling untouched.
- **Death explanations:** new `krakarenTentacleStrike` key (Section 6). Existing `krakarenCloneSlam` lines may now reference the tentacle you watched come out of the ground; update the flavor if the current lines contradict the new visual.

---

## 11. Constants inventory (new, all named — no magic numbers)

In `KrakarenClone.ts` / `KrakarenTentacle.ts` unless noted. Values are starting points; tune freely but keep them named:

```
TENTACLE_GUARD_DAMAGE_SCALE = 0.25     MAX_GUARD_TENTACLES = 2
GUARD_TENTACLE_HP = 15                 GUARD_SPAWN_INTERVAL_BASE = 600
GUARD_SPAWN_INTERVAL_ENRAGED = 420     GUARD_SPAWN_MIN_DIST_TILES = 1.5
GUARD_SPAWN_MAX_DIST_TILES = 2.5       GUARD_TENTACLE_TTL_FRAMES = 900
TENTACLE_EMERGE_TELEGRAPH_FRAMES = 30  TENTACLE_STRIKE_RANGE_TILES = 1.6
TENTACLE_STRIKE_WINDUP_FRAMES = 25     TENTACLE_STRIKE_DAMAGE = 2
TENTACLE_STRIKE_HIT_RADIUS_TILES = 1.0 TENTACLE_STRIKE_COOLDOWN_FRAMES = 90
SLAM_RISE_OFFSET_TILES = 1.6           ENRAGED_FILTER (krakarenSprite.ts)
GUARDED_DAMAGE_FLASH (dimmer variant)  GUARD_PULSE_FRAMES (tentacle highlight)
```

Timing-module constants are listed in Section 3d. Sheet/gate constants (`TEXTURE_BUDGET_MEGAPIXELS`, thresholds) live in the generator/gates files per convention.

---

## 12. Implementation order

1. **Contracts first:** `krakarenAttackTiming.ts`.
2. **Art:** `krakarenArt.ts` → `krakarenGore.ts` → `generate-krakaren-sprite.ts` → `generate-krakaren-sprite.gates.ts` (with negative tests per gate) → `render-krakaren.ts` → `gen:krakaren` + `tsconfig.scripts.json` entries → blind review rounds → manifest paste ×3 → asset groups → preview scene.
3. **Body runtime:** rewrite `krakarenSprite.ts`, update `KrakarenClone.drawSelf` + melee facing lock + swipe/channel progress, fix `BossIntroSystem`, re-measure the health-bar anchor.
4. **Damage primitive:** `Mob.incomingDamageScale` + both entry-point applications.
5. **Guard tentacles:** `KrakarenTentacle.ts` + `krakarenTentacleSprite.ts`, boss spawn pushes, `BossRoomSystem` drain/cap/TTL/cleanup, guard registry + override + tells, gore registration, reset hooks.
6. **Slam tentacle:** marker getter, timing shares, `renderKrakarenSlams` extension, shadow-intensify, impact alignment.
7. **Audio + copy.**
8. **Verification (all must exit 0):** `npm run gen:krakaren`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run verify:assets`, `npm run verify:difficulty`, `npm run verify:companion` (its eight tests build `BossRoomSystem` with `krakaren_clone` — they exercise this exact code), `npm run verify:friendly-fire`.
9. **Headless behavior check** (browser automation drives this game; unregister the service worker before trusting any browser check; `npm run playtest -- krakaren`): confirm — the sheet renders in all three facings; a guard tentacle telegraphs, emerges, strikes, and shows a health bar when hit; player damage on the body drops to 0.25× while it lives and restores the frame after it dies; two tentacles cap the spawns; a TTL'd tentacle retreats; the slam plays rise→loom→dive with the ring, the smash lands on the damage frame at the marked spot, and the whole sequence stays visible when the boss is off-screen; `clearEncounterPhase` (checkpoint restore) removes tentacles and any in-flight slam; boss death retreats surviving tentacles and drops body gore that passes a blind naming read.
