# Bounty Boss — The Evil Clown

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry, and specifically
its C4 `GroundHazardSource` interface); art phases are independent.

**Status: NOT STARTED**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `bipedal-figure` (he is a biped — full rig/pose contract and
image-review loop), `add-sound`.

## Concept

A **horrible giant clown** — genuinely unsettling, not slapstick: too tall,
wrong proportions, fixed grin, stained ruff. He is accompanied by clowns from
the _Show Must Go On_ quest line (reused as-is, zero new minion art).

Signature mechanic — **vial juggling**: every so often he stops chasing, laughs,
and wanders while juggling glass vials. While juggling he lobs vials around the
battlefield; each shatters into a lingering **gas cloud** that damages any
player standing in it. The AI companion avoids the clouds exactly like the
hoarder's acid pools.

## Names (5–10, shuffled by the core system)

```
'Giggles', 'Honk', 'Jangles', 'Grinner', 'Sniggles', 'Tumbles', 'Bubbles', 'Mister Merriment'
```

## Art

He shares the species with the existing clowns, so **extend the existing rig**:
a new style in the `scripts/clownArt.ts` engine (the same route
`generate-clown-sprites.ts` uses for fat/stilt/terror styles) rather than a new
art module — one skeletal rig is why clown limbs stay attached. If the giant's
proportions break the rig's assumptions (very long limbs, huge head), extend
the engine; do not fork it. Known rig gotchas apply: radial-gradient glow only
(never `shadowBlur`), ~6px frame-edge margin so shoes don't clip, oversized art
needs `cullMarginTiles` (Terror uses 3; the giant will need more).

Sheet: `evil_clown.png`, baked by the existing clown generator run
(`generate-clown-sprites.ts` gains the style + sheet spec). Target height ≈3
tiles of art.

Per Ryan, each view/animation is its own independent task:

- [ ] **C-A1. Style + toward-camera set.** Giant palette/proportions in
      `clownArt.ts`; rows `walk`, `idle` (toward). The grin and eye treatment
      carry the horror — iterate on the head painter until the contact sheet is
      actually unsettling at review scale AND still reads at 32px.
- [ ] **C-A2. Away set.** `walk_away`, `idle_away` — the back of the head/ruff,
      hunched shoulders.
- [ ] **C-A3. Side set.** `walk_side`, `idle_side` (ctx-flip for the mirror).
- [ ] **C-A4. Attack + juggle rows.** - `swipe` × toward/side/away — his basic melee (long-arm backhand). - `laugh` (one-shot, shoulders heaving, head thrown back) — the tell that
      juggling is coming. - `juggle_walk` × toward/side/away — walking loop with 3 vials cycling
      through the air above his hands; the vials are drawn IN the rows (they
      are part of the pose), but the **thrown** vial is a separate effect
      sprite (C-A5).
- [ ] **C-A5. Effects sheet: vial + gas.** `scripts/` bake to
      `src/images/effects/` (lava-ball precedent: `gen:lava-ball` →
      `evil_clown_vial` spinning-throw frames, `evil_clown_gas` cloud loop —
      billowing sickly green-yellow, semi-transparent, 6–8 frame loop, plus a
      `shatter` burst). Remember node-canvas rejects exponent-notation alpha
      (memory gotcha) — clamp tiny computed alphas.
- [ ] **C-A6. Gore row.** Shared `goreWound.ts` pieces: oversized shoes, ruff,
      head (grin intact — worst part), gloved hands, torso; register
      `EVIL_CLOWN_GORE_PARTS` + body-part key in `BodyPartGoreSystem`.
- [ ] **C-A7. Harness + preview.** Extend `scripts/render-clowns.ts` with
      `--clown=evil` (it already takes a clown flag), `?evilclown` preview
      route.
- [ ] Review loop on the final sheets (reviewer sees PNGs)

## Creature behavior

- [ ] **C-B1. `EvilClown`** (`src/creatures/EvilClown.ts`): state machine
      `idle → pursuing → swipe → laugh → juggling → cooldown`. - Pursuit + swipe: standard melee boss baseline (Terror's windup/swing
      shape is the reference; slower but heavier). - Juggle cycle: on cooldown (e.g. every 10–16 s, named constants) he
      stops, plays `laugh` (with sound), then `juggling` for ~5 s: wanders
      (doWander-style meander, does not chase), and every ~0.8 s queues a
      **vial throw** at a random point within ~5 tiles of himself, biased
      toward players' current positions (some aimed, some scattered — the
      battlefield should fill unevenly). - `requiresEvasion` true while juggling (companion keeps distance).
- [ ] **C-B2. `ClownGasSystem`** (`src/systems/ClownGasSystem.ts`) — the
      projectile AND hazard owner, system-owned per the LavaBallSystem rule
      (vials must survive the clown's death mid-throw): - Drains `takePendingVials()` from any `EvilClown` each frame. - Vial flight: lobbed arc (visual-only height offset like dynamite),
      shatter on landing → push a `GasCloud { x, y, ttl }`. - Clouds: radius ~1.5 tiles, TTL ~8 s, damage tick to players inside
      every 20 frames (AcidPuddle constants are the reference; environmental
      `DamageSource` like `lavaFlames` since the clown may be dead), cap on
      simultaneous clouds (e.g. 12) — oldest expires first. - Implements **`GroundHazardSource`** (core plan C4) and registers with
      `CompanionSystem` so the follower flees clouds like acid. - Render clouds under entities (renderGround-adjacent slot), vials in the
      Y-sorted pass; drain `*SoundPending` flags for shatter/gas.
- [ ] **C-B3. Spawn composition** (`BountyDef.spawn`): boss + 2 `StiltClown` +
      2 `FatClown` (existing classes, zero new art; both already registered in
      `spawner.ts`). Optionally 1 `CircusLemur` for chaos — decide at
      implementation, journal it. Def id `'evil_clown'`, `typeLabel: 'the Evil
    Clown'`. Delete `debug_ghoul` placeholder if still present.
- [ ] **C-B4. Loot + XP** per core plan C5 convention; boss-tier `xpValue`.
- [ ] Validation gates + review loop after each of B1–B4

## Sounds ([HUMAN] sourcing)

| Proposed SoundId          | Ideal sound                              | Trigger                                                                       |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `evil_clown_laugh`        | deep, slow, distorted clown laugh, 2–3 s | laugh state                                                                   |
| `evil_clown_giggle`       | quiet broken giggle                      | idle proximity                                                                |
| `evil_clown_vial_throw`   | glass whoosh/tink                        | vial release                                                                  |
| `evil_clown_vial_shatter` | glass shatter + hiss onset               | vial landing                                                                  |
| `evil_clown_gas`          | sustained toxic hiss (loopable)          | cloud active (nearest-cloud emitter, like the river `AmbientEmitter` pattern) |
| `evil_clown_death`        | laugh collapsing into a wet gurgle       | death                                                                         |

Existing clown ids in `sounds.ts` may cover swipe/damage — check before adding.
Add `audioTag: 'evil_clown'` + case arms in `playMobAudioCues`. Boss music:
`boss_music_3` default unless Ryan sources a carnival-horror track (journal it).

- [ ] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] Registered in `BOUNTY_DEFS`; full `!bounty` loop (issue → arrow → fight:
      laugh tell → juggling wander → clouds spawn, damage players inside,
      companion visibly avoids them → kill → collect)
- [ ] Clouds persist and keep damaging after the clown dies mid-juggle
- [ ] Fog: boss immune + toast; stilt/fat clowns confused
- [ ] Town lure: whole troupe follows into town, stays aggressive
- [ ] **[HUMAN]** Ryan playtests: gas damage/visual clarity, juggle cadence, how
      scary the art actually is
- [ ] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.
