# Krakaren slam telegraph render fix

The Krakaren Clone's slam warning shadow — the red ring that marks where the
instant-kill lands — is invisible from most positions in the arena, and near the
boss it sometimes shows only about a quarter of itself. The fight telegraphs a
9999-damage attack with a marker the player usually cannot see.

## 1. Root cause

The telegraph is drawn inside the boss's own `drawSelf` (in
`src/creatures/KrakarenClone.ts`), so it inherits two behaviours that
are correct for a mob's body and wrong for a ground marker up to twelve tiles
away from that body. Each one produces exactly one half of the symptom.

**Mechanism A — culled by the boss's position, not the telegraph's.** This is
"in most spots it doesn't render at all."

- The render pipeline drops any mob outside the viewport plus its own
  `cullMarginTiles` (the per-mob margin check in `renderEntities`, in
  `src/systems/RenderPipeline.ts`), fed by a spatial query that is itself only
  4 tiles wide (the `mobGrid.queryRect` call using `MOB_QUERY_MARGIN` in
  `renderEntities`, `src/systems/RenderPipeline.ts`).
- `KrakarenClone` never overrides `cullMarginTiles`, so it gets
  `DEFAULT_CULL_MARGIN_TILES = 1` (the default `cullMarginTiles` getter in
  `src/creatures/Mob.ts`).
- The boss is immobile (`KRAKAREN_SPEED = 0`, in `src/creatures/KrakarenClone.ts`)
  and slams the nearest player anywhere inside a 12-tile aggro range
  (`AGGRO_RANGE_TILE_MULTIPLIER` and the `startSlam` method, both in
  `src/creatures/KrakarenClone.ts`). The shadow is drawn at `slamTargetX/Y` —
  the player's feet.
- So whenever the player kites more than one tile past the screen edge from the
  boss, `drawSelf` is never called and the shadow at the player's own on-screen
  feet never draws. No override can fix this: `MAX_MOB_CULL_MARGIN_TILES = 4`
  (in `src/core/constants.ts`) is still far short of the 12-tile slam reach.

**Mechanism B — clipped to the silhouette composite's box.** This is "a quarter
visible near the boss, sometimes."

- Whenever a character has a hit flash or a status effect, `render` reroutes
  `drawSelf` through an offscreen composite whose bounds are the mob's tile plus
  `silhouetteMarginTiles` (the `needsComposite`/`drawWithSilhouetteLayers` branch
  in `Player.render`, `src/Player.ts`); everything outside that box is cut off
  with a straight edge (`drawWithSilhouetteLayers` in
  `src/core/silhouetteComposite.ts`).
- For the Krakaren that box is `max(1, MIN_HIT_FLASH_MARGIN_TILES = 1.5)` = 1.5
  tiles (the `hitFlashMarginTiles` getter in `src/creatures/Mob.ts`, and the
  `silhouetteMarginTiles` getter in `src/Player.ts`).
- Mid-fight the boss is being hit constantly, so the composite path is active
  for most of the frames that matter. A shadow at a melee-range player's feet
  (up to 3 tiles out, `MELEE_RANGE_TILE_MULTIPLIER` in
  `src/creatures/KrakarenClone.ts`) overlaps that 1.5-tile box only at its near
  edge — the observed quarter. "Sometimes" is the flash coming and going.
- The `Player.ts` JSDoc names this exact failure: "everything `drawSelf` draws
  outside this box — **including attack telegraphs, which some bosses draw
  there** — is cut off with a straight edge" (the `silhouetteMarginTiles`
  getter's JSDoc in `src/Player.ts`).

Overriding `drawWorldFeedback` (the `Player.drawWorldFeedback` method in
`src/Player.ts`, drawn outside the composite) would fix B but not A — it still
only runs when the mob survives the cull. The only fix that covers both is the
one the codebase already uses for the Hoarder: ground hazards are owned and
rendered by `BossRoomSystem` in world space, in the ground pass, with no mob
culling and no silhouette composite (`renderAcidPuddles` in
`src/systems/BossRoomSystem.ts`, called at the end of `renderObjects`, itself
called from `RenderPipeline.renderWorld` in `src/systems/RenderPipeline.ts`).
That is why the Hoarder's telegraphed acid never disappears and the Krakaren's
slam does.

A side finding fixed in passing: with `cullMarginTiles` at 1, the boss's own
art — tentacles reaching 2.8 tiles, `TENTACLE_REACH_SCALE` in
`src/sprites/krakarenSprite.ts` — pops out of existence at the screen edge
while most of it is still visible, and its hit flash is clipped to the same
1.5-tile box, slicing the tentacles mid-flash.

## 2. Phase 1 — expose the slam state, stop drawing it in `drawSelf`

`src/creatures/KrakarenClone.ts`:

- Add two public read-only getters, mirroring the Hoarder's `vomitProgress`
  accessor pattern (the `vomitProgress` getter in `src/creatures/TheHoarder.ts`):
  - `get slamShadow(): { x: number; y: number; progress: number } | null` —
    non-null while `slamActive`, world-pixel target, progress
    `1 - slamShadowTimer / SLAM_SHADOW_FRAMES`.
  - `get slamImpact(): { x: number; y: number; progress: number } | null` —
    non-null while `slamImpactTimer > 0`, progress
    `1 - slamImpactTimer / SLAM_IMPACT_FRAMES`.
- Delete the shadow and impact draws from `drawSelf` (the `slamActive` /
  `slamImpactTimer` draw blocks) and the now-unused `drawSlamShadow` /
  `drawSlamImpact` imports.
- No state moves off the mob: `resetToSpawn` already clears the slam fields,
  so checkpoint restore is untouched.

The getters return plain object literals — no casts, no assertions.

## 3. Phase 2 — render the telegraph in `BossRoomSystem`'s ground pass

`src/systems/BossRoomSystem.ts`:

- In `update`, beside the existing Hoarder drain that already walks the mob
  list (the `spawnHoarderCockroaches` call and the method itself, both in
  `src/systems/BossRoomSystem.ts`), rebuild a per-frame
  `private readonly liveKrakarens: KrakarenClone[]` cache: clear it, then push
  every `mob instanceof KrakarenClone` with `mob.isAlive`. Rebuilt every frame,
  so a checkpoint restore can never leave a stale reference in it.
- In `renderObjects`, after `renderAcidPuddles`, add
  `renderKrakarenSlams(ctx, camX, camY)`: for each cached boss, draw
  `drawSlamShadow(ctx, s.x - camX, s.y - camY, TILE_SIZE, s.progress)` when
  `slamShadow` is non-null, and the same for `slamImpact` with
  `drawSlamImpact`. Import both from `src/sprites/krakarenSprite.ts` (they take
  screen coordinates and need no change).
- Placement: `renderObjects` runs in `RenderPipeline.renderWorld`
  (`src/systems/RenderPipeline.ts`), before the Y-sorted entity pass
  (`renderEntities`) — the ring sits on the floor under the player and the
  boss, which is what the original in-`drawSelf` comment ("before boss so it
  appears on the ground", in the old `drawSelf` method of
  `src/creatures/KrakarenClone.ts`) was reaching for and could only
  approximate. Same slot as the acid pools.

## 4. Phase 3 — cull margin for the boss's own art

`src/creatures/KrakarenClone.ts`:

- Add `KRAKAREN_CULL_MARGIN_TILES = 3` (tentacle reach is 2.8 tiles; the
  ceiling is `MAX_MOB_CULL_MARGIN_TILES = 4`) and override
  `get cullMarginTiles()` with it, with the same one-line justification the
  Hoarder carries (the `cullMarginTiles` override's JSDoc in
  `src/creatures/TheHoarder.ts`).
- This also widens `hitFlashMarginTiles` to 3 via the existing
  `max(cullMarginTiles, …)` (the `hitFlashMarginTiles` getter in
  `src/creatures/Mob.ts`), fixing the flash-clipped tentacles for free.

This phase is independent of the telegraph fix — the telegraph must not depend
on any margin — but ships with it because the same diagnosis surfaced it.

## 5. Gates and notes for Ryan's playtest

Automated, all must pass: `npm run typecheck`, `npm run lint`,
`npm run format`.

`npm run playtest -- krakaren` (the `KRAKAREN` preset in
`src/dev/playtestPresets.ts`) drops the party in the safe room just before the
boss.

- Kite to the far side of the arena with the boss fully off screen:
  the red slam ring appears at your feet, whole, every slam.
- Stand in melee and attack continuously (hit flash active): the ring
  is complete — no straight-edged quarter, no clipping at any angle around the
  boss.
- Ring layering: it reads as floor paint — the crawlers and the boss
  draw over it, not under it.
- The impact shockwave and debris still show at the slam point,
  including when the boss is off screen.
- Walk the boss across the screen edge: the tentacles no longer pop in
  or out with part of them visible, and a mid-flash boss keeps whole tentacles.
