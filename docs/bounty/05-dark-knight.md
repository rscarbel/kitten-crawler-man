# Bounty Boss — The Dark Knight

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry + the C3 shared
`dangerTelegraph.ts` helpers); art phases are independent.

**Status: NOT STARTED**

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

- [ ] **K-A1. Module + toward set.** `scripts/darkKnightArt.ts` +
      `scripts/generate-dark-knight-sprite.ts` (`npm run gen:dark-knight`).
      Rows `walk`, `idle` (toward) — heavy, deliberate gait; idle breathes via
      shoulder rise (timeFrameIndex-driven at runtime).
- [ ] **K-A2. Away set.** `walk_away`, `idle_away` — cloak/backplate, mace
      resting on shoulder.
- [ ] **K-A3. Side set.** `walk_side`, `idle_side` (ctx-flip mirror).
- [ ] **K-A4. Attack rows.** - `slam` × toward/side/away: two-hand raise (long windup — this is when
      the telegraph shows), full-body drop, mace buried, recover. - `sweep` × toward/side/away: mace whirled around the head 1–2 turns then
      a level 360° sweep at torso height. - `punch` × toward/side/away: short off-hand jab, ≤20 frames total —
      visually snappy because mechanically undodgeable.
- [ ] **K-A5. Gore row.** Shared `goreWound.ts`: helm (rolls), gauntlets,
      pauldron, breastplate section with the wound, the mace itself as a
      settled piece. Register `DARK_KNIGHT_GORE_PARTS` + key in
      `BodyPartGoreSystem`. Armor gore is mostly clean-cut metal + flesh at the
      joins — use `CutSpec.kind: 'clean'` where plate shears.
- [ ] **K-A6. Harness + preview.** `scripts/render-dark-knight.ts`,
      `?darkknight` preview route.
- [ ] Review loop on final sheets (reviewer sees PNGs)

## Creature behavior

- [ ] **K-B1. `DarkKnight`** (`src/creatures/DarkKnight.ts`): state machine
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
- [ ] **K-B2. Spawn composition** (`BountyDef.spawn`): boss + **10 `Goblin`**
      spread over the site disc (walkable-tile search per placement,
      `findWalkableTileInCamp`-style uniform-over-area sampling so they don't
      stack). Def id `'dark_knight'`, `typeLabel: 'the Dark Knight'`. Goblins
      get `applyMobLevel(bountyLevel)` + `ignoresTownSafeZone` from
      BountySystem's uniform pass. Delete `debug_ghoul` placeholder if still
      present. Ten goblins at player level is intentionally a mob — the sweep
      also hits goblins? No: `dealDamage` targets players only in this
      codebase's melee helpers; keep it that way (friendly fire is not a
      feature here).
- [ ] **K-B3. Loot + XP** per core plan C5; boss-tier `xpValue`; goblins keep
      their normal drops (10 goblins is itself part of the reward).
- [ ] Validation gates + review loop after each of B1–B3

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

- [ ] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] Registered in `BOUNTY_DEFS`; full `!bounty` loop (issue → arrow → fight:
      slam telegraph appears at locked point and is dodgeable; sweep ring is
      escapable by backing up; punch lands regardless; goblins screen → kill →
      collect)
- [ ] Telegraph visuals match the spider's language (shared helpers, no drift)
- [ ] Fog: knight immune + toast; goblins confused
- [ ] Town lure: knight + goblins all follow into town, stay aggressive
- [ ] **[HUMAN]** Ryan playtests: slam/sweep windup lengths (dodgeable but
      tense), punch damage as chip-not-burst, 10-goblin chaos level
- [ ] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.
