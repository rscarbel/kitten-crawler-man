# Bounty Boss — The Skeleton Lord

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry + C3 telegraph
helpers); art phases are independent. This is the biggest art file: the boss
**plus two warrior minion types**, all from scratch — there is no skeleton or
undead art anywhere in the codebase (verified; the only "skeleton" outside the
human rig is the cosmetic club DJ in `clubNpcSprite.ts`).

**Status: NOT STARTED**

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

- [ ] **S-A1. Bone engine + lord toward set.** `scripts/skeletonArt.ts` +
      `scripts/generate-skeleton-sprites.ts` (`npm run gen:skeletons`). Lord
      rows `walk`, `idle` (toward) — drifting, robe-swaying, ribs glowing;
      idle timeFrameIndex-driven.
- [ ] **S-A2. Lord away set.** `walk_away`, `idle_away`.
- [ ] **S-A3. Lord side set.** `walk_side`, `idle_side` (ctx-flip mirror).
- [ ] **S-A4. Lord attack rows.** - `cast` × toward/side/away — one arm thrust, green orb condensing at
      the palm; the bolt release frame is a **shared timing constant** in
      `src/sprites/` imported by the generator (the llama spit-timing
      pattern; do not re-declare release fractions). - `hands_cast` × toward/side/away — both arms sweep low, robe flares;
      this is the grasping-hands windup (telegraph shows during it). - `summon` — both hands raised high, sustained green flare (single
      facing acceptable if he always faces camera-ish during it; decide at
      implementation, journal it).
- [ ] **S-A5. Sword skeleton set.** `walk/idle/slash` × toward/side/away, plus
      a **`rise`** row (climbing out of the ground: hand bursts up, then
      shoulders, then stands — used at summon time; also usable for the
      initial escort spawn flourish).
- [ ] **S-A6. Archer skeleton set.** `walk/idle/draw_loose` × toward/side/away + `rise`. The arrow itself is part of the effects sheet (S-A7).
- [ ] **S-A7. Effects sheet.** `src/images/effects/`: `soul_bolt` (green orb
      with trailing wisps, spin loop), `soul_bolt_burst` (impact), `bone_arrow`
      (single frame, rotated at runtime via `drawSpriteRotatedCenter`),
      `grasping_hands` (eruption loop: hands clawing up, 6–8 frames, tileable
      patch so the cone can be filled with several instances).
- [ ] **S-A8. Gore rows.** All three variants via shared `goreWound.ts` — a
      skeleton's gore is **bone scatter**: skull, ribcage section, pelvis,
      long bones, hand; no flesh — verify `goreWound.ts` supports a
      no-flesh/marrow-only look (`BoneSpec` exists; may need a small extension,
      keep the rat/llama bakes byte-identical as the regression check).
      Register three `*_GORE_PARTS` keys in `BodyPartGoreSystem`.
- [ ] **S-A9. Harness + preview.** `scripts/render-skeletons.ts`
      (`--only=lord|sword|archer`), `?skeletons` preview route.
- [ ] Review loop on final sheets (reviewer sees PNGs)

## Creature behavior

- [ ] **B1. `SkeletonWarrior`** (`src/creatures/SkeletonWarrior.ts`, registry
      id `'skeleton_sword'`): melee mob, slash with windup; spawns either
      normally or in `rising` state (plays `rise`, invulnerable-and-harmless
      until risen, ~40 frames). Reusable later as a regular mob — standalone
      stats, named constants. `audioTag: 'skeleton'`.
- [ ] **B2. `SkeletonArcher`** (`src/creatures/SkeletonArcher.ts`, registry id
      `'skeleton_archer'`): keeps distance (kiting band, e.g. 4–7 tiles),
      `draw_loose` fires a **bone arrow**. Arrows are owned by the encounter's
      projectile system (B4), not the mob — an archer dying mid-flight must not
      eat its arrow. LOS check before firing (llama precedent).
- [ ] **B3. `SkeletonLord`** (`src/creatures/SkeletonLord.ts`): state machine
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
- [ ] **B4. `SkeletonProjectileSystem`** (`src/systems/`): LavaBallSystem-shaped
      owner for soul bolts AND bone arrows — drains `takePending*()` from lord
      and archers, flies, collides (walls stop bolts; llama precedent),
      damages via carried pre-scaled damage + proper `DamageSource` naming the
      bounty. One system for both projectile kinds keeps the encounter
      self-contained.
- [ ] **B5. Spawn composition** (`BountyDef.spawn`): lord + 2 sword + 1 archer.
      Def id `'skeleton_lord'`, `typeLabel: 'the Skeleton Lord'`. Delete
      `debug_ghoul` placeholder if still present. Summoned reinforcements also
      get `applyMobLevel` + `ignoresTownSafeZone` (the summon path must apply
      the same uniform flags BountySystem applies at issue — easy to miss).
- [ ] **B6. Loot + XP** per core plan C5; boss-tier `xpValue`; escorts give
      modest XP each (they respawn via summon — do not make farming them
      better than killing the lord: keep escort XP low, named constant).
- [ ] Validation gates + review loop after each of B1–B6

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

- [ ] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] Registered in `BOUNTY_DEFS`; full `!bounty` loop (issue → arrow → fight:
      bolts pursue and are dodgeable, cone telegraph gives an escapable
      warning, hands damage+stick anyone caught, summons rise on cadence and
      respect the cap → kill lord → collect)
- [ ] Bolts/arrows survive their caster's death mid-flight
- [ ] Fog: lord immune + toast; warriors/archers confused
- [ ] Town lure: lord + all escorts (including later summons) follow into town
- [ ] Sword/archer skeletons spawn standalone via registry ids (future reuse)
- [ ] **[HUMAN]** Ryan playtests: cone warning duration, summon rate vs kill
      pressure, bone art believability in motion
- [ ] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.
