# Bounty Boss — The Mantid

Read `docs/bounty/00-overview.md` first (conventions, review loop, pipeline
facts). Integration depends on `01-core-system.md` (registry + flags); all art
phases are independent and can start immediately.

**Status: NOT STARTED**

Skills to load: `game-architecture`, `dev-workflow`, `add-creature`,
`add-sprite`, `add-sound`. NOT bipedal-figure — this is an arthropod; the
structural template is `scripts/generate-spider-sprite.ts` (segmented body,
jointed limbs, carapace shading, and its arachnid-anatomy bake gates show the
level of rigor expected), with two-bone IK for the raptorial forelimbs borrowed
from the clown rig's solver approach.

## Concept

An **enormous praying mantis** boss, plus **two smaller crony mantises** that
are visually the same species but clearly subordinate. The cronies get their own
registry id because Ryan will reuse them later as regular mobs — build them as a
first-class mob, not a boss appendage.

Signature mechanic — the **rage cycle**:

1. Every so often (cooldown, named constant, e.g. 12–20 s after last rage) the
   Mantid **stops dead** and an **exclamation mark** appears over his head
   (reuse the glyph helper from file 02 Phase S1; gold).
2. For exactly **1 second** he is **invincible**: any player hit deals 0 damage
   and emits floating text "Immune" from him. He does not move or attack.
3. When the second ends: invincibility and the exclamation both drop, and he
   enters a **3-second flurry** — rapid slashes hitting everything around him
   in melee radius on a fast tick, while walking toward the player. The player
   is meant to run; standing in it is near-death unless the Mantid is nearly
   dead already.

## Names (5–10, shuffled by the core system)

```
'Slice', 'Scythe', 'Snips', 'Thresher', 'Sickle', 'Mandible', 'Vesper', 'Cleaver'
```

(Slice is Ryan's own example — keep it.)

## Art

PNG sheet pipeline per 00-overview (llama example). Two sheets from one art
module: `mantid` (boss) and `mantis` (crony) — the goblin four-sheet precedent
shows one drawing engine parameterized per variant. Boss reads bigger (≈2.5–3
tiles tall art overhanging its tile; override `cullMarginTiles`), with visual
distinction beyond scale: e.g. darker/iridescent carapace, tattered wing cases,
scarred raptorial arms. Cronies ≈1.5 tiles.

Anatomy notes that make it read as a mantis and not "generic bug": triangular
head with huge compound eyes that can pivot; long pronotum (the "neck");
raptorial forelimbs folded in the iconic prayer pose at rest, with visible
spines on the femur/tibia; four slender walking legs (the forelimbs are NOT
walking legs); wings folded flat along the abdomen. Each is a candidate bake
gate (e.g. assert forelimbs attach to the pronotum, not the abdomen — the small
spider taught us socket placement is what sells arthropods).

Per Ryan, **each view and animation is its own independent task**:

- [ ] **M-A1. Art module + toward-camera set.** `scripts/mantidArt.ts` +
      generator skeleton. Rows: `walk` (toward), `idle` (toward — swaying,
      forelimbs folded, head pivots; timeFrameIndex-driven). Bake, render
      contact sheet, look at it, iterate.
- [ ] **M-A2. Away-from-camera set.** `walk_away`, `idle_away`. Wing cases and
      abdomen dominate; head barely visible. Same review loop.
- [ ] **M-A3. Side-profile set.** `walk_side`, `idle_side` (runtime ctx-flip
      gives the other direction — one side only, like every other sheet). The
      side view is where the prayer-fold silhouette must be unmistakable.
- [ ] **M-A4. Attack rows.** `slash` × toward/side/away (single raptorial
      strike: unfold–snap–refold, the snap frames nearly straight), and
      `flurry` × toward/side/away (both arms alternating fast wide arcs; loops
      for 3 s). Also `rage_pause` (1-loop: reared up, arms cocked, trembling —
      distinct from idle so the invincible second is readable without the
      exclamation mark).
- [ ] **M-A5. Gore row.** Death dismemberment pieces via the shared
      `scripts/goreWound.ts` (llama/rat side, NOT goblinGore's fork): severed
      raptorial arms, head with an eye, wing fragments, thorax, abdomen
      segments; green-tinted hemolymph is a palette decision — check with the
      gore palette constants and keep blood recognizably "bug". Export
      `MANTID_GORE_PARTS` + body-part key; register in `BodyPartGoreSystem`.
- [ ] **M-A6. Crony sheet.** Bake `mantis` variant from the same module (all the
      same rows minus `rage_pause`/`flurry`). Verify at 32px it still reads.
- [ ] **M-A7. Harness + preview.** `scripts/render-mantid.ts` (rows, gore mode,
      `--scale`), `npm run gen:mantid` alias, `?mantid` preview route.
- [ ] Review loop on the final sheets (reviewer sees the PNGs, not just code)

## Creature behavior

- [ ] **M-B1. `MantisCrony`** (`src/creatures/MantisCrony.ts`, registry id
      `'mantis'` in `spawner.ts` + `types.ts` union): melee mob, single `slash`
      attack with a short windup, mid speed. Stats sized as a floor-3+ regular
      mob (it will be reused ambiently later) — HP/damage/XP as named constants,
      `applyMobLevel` does the scaling. `audioTag: 'mantis'`.
- [ ] **M-B2. `Mantid`** (`src/creatures/Mantid.ts`): state machine
      `idle → pursuing → slash → rage_pause → flurry → cooldown`. Baseline: slow
      stalking pursuit + single slashes in reach. - **Rage pause**: trigger on cooldown while aggroed; freeze movement
      1 s (`RAGE_PAUSE_FRAMES = 60`); render exclamation via the shared glyph
      helper; set an `isImmune`-style guard consumed in `takeDamageFrom` —
      override it to zero the damage and queue an "Immune" text emission
      instead (do NOT bypass via early return before `damageTakenBy`
      bookkeeping decisions — no damage means no attribution, which is
      correct). - **"Immune" floating text**: first check whether a floating combat-text
      mechanism already exists (damage numbers); if yes reuse it, if not
      implement a small rising-fade text in `drawSelf` using `drawText` from
      `src/ui/TextBox.ts` (one emission per blocked hit, cap simultaneous). - **Flurry**: 3 s (`FLURRY_FRAMES = 180`), damage tick every ~12 frames
      (named constant) to all players within ~1.6 tiles, damage per tick
      scaled via `dealDamage`; moves toward the nearest player at slightly
      above walk speed. `requiresEvasion` should return true during
      rage_pause + flurry so the AI companion runs (spider precedent). - Set `attackSoundPending`/`specialSoundPending` at the right beats.
- [ ] **M-B3. Spawn composition** (`BountyDef.spawn`): boss + 2 cronies flanking
      at the site. Boss `displayName` set by BountySystem; def id `'mantid'`,
      `typeLabel: 'the Mantid'`. Delete the `debug_ghoul` placeholder def if
      this is the first real def to land.
- [ ] **M-B4. Loot + XP**: `xpValue` boss-tier (Grotesque Spider is 2000 at base
      as a reference point; this should be meaningfully rewarding but scaled by
      level anyway); `rollLootItems` override per the core plan's C5 convention;
      generous coin range.
- [ ] Validation gates + review loop run after each of B1–B4

## Sounds ([HUMAN] sourcing)

| Proposed SoundId          | Ideal sound                                   | Trigger                      |
| ------------------------- | --------------------------------------------- | ---------------------------- |
| `mantis_chitter_1` / `_2` | dry insect chittering/clicks                  | idle proximity + damage flag |
| `mantid_slash`            | sharp air-cutting _shick_                     | slash strike frame           |
| `mantid_rage`             | rising insectoid shriek/hiss, ~1 s            | rage pause start             |
| `mantid_flurry`           | fast layered slashing whooshes (loopable 3 s) | flurry                       |
| `mantid_death`            | wet crunch + falling chitin clatter           | death                        |

Boss music: reuse `boss_music_3` via `bossFightInitiated` unless Ryan sources a
dedicated track (note in Journal either way). Add `case 'mantis'`/`'mantid'`
arms to `playMobAudioCues`.

- [ ] Sound ids registered + wired (or stand-ins journaled)

## Integration & verification

- [ ] Registered in `BOUNTY_DEFS`; full loop tested via `!bounty` (issue → find
      via arrow → rage cycle behaves: 1 s immune with "Immune" text and
      exclamation, then 3 s flurry that forces retreat → kill → collect)
- [ ] Fog scroll: Mantid immune + toast; cronies confused
- [ ] Town lure: all three follow into town and stay aggressive
- [ ] Cronies spawn standalone via registry id (future reuse sanity check)
- [ ] **[HUMAN]** Ryan playtests: flurry damage/escapability, rage readability,
      art believability in motion
- [ ] Final review loop: zero genuine findings

## Journal

- 2026-08-02 — Plan written; not started.
