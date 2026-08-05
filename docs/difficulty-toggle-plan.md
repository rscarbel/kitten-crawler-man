# Difficulty Toggle Plan

Goal: floor 1 reads easy to everyone and floor-3 bounties read unplayable to
everyone but a skilled player. Ship (1) a hard fix for the goblin speed runaway
that is independent of any setting, and (2) a player-selectable difficulty
toggle — with rewards that scale to match — built **on top of** the shipped
difficulty rebalance (fairness rules in `docs/difficulty-fairness-rules.md`,
gate `npm run verify:difficulty`) and the shipped bounty system
(gate `npm run verify:bounty`).
Both gates are extended, never weakened; **Normal difficulty must be
bit-identical to today's game**, and the verify script proves it.

All numbers are starting points for tuning. Every phase ends in the validation
gates (`npm run typecheck`, `npm run lint`, `npm run format`) plus the two
verify scripts. Player-feel checks are noted for Ryan's playtest afterward,
not a blocking gate.

---

## 1. What the code does today (measured, with evidence)

**The goblin speed runaway is the unbounded level curve meeting the bounty's
full-party-level scaling.**

- `applyMobLevel` (in `src/creatures/Mob.ts`) multiplies speed by
  `1 + (level − 1) × MOB_LEVEL_SPEED_SCALE` with `MOB_LEVEL_SPEED_SCALE = 0.08`
  (the constant is defined and applied inside `applyMobLevel` in that same
  file). Linear, and **nothing above it** — no cap of any kind.
- `GOBLIN_SPEED = 1.4` (`src/creatures/Goblin.ts`); `PLAYER_SPEED = 2.5`
  (`src/core/constants.ts`).
- Bounty escorts spawn at the **full** stronger-party-member level, capped only
  at `MAX_BOUNTY_MOB_LEVEL = 20` (`src/systems/BountySystem.ts`, applied in
  `bountyMinionLevel`); the mark gets +1 (`bountyBossLevel`, same file). The
  Dark Knight fields **ten** goblins at that level (`DARK_KNIGHT_GOBLIN_COUNT`
  in `src/systems/bountyDefs.ts`, spawn loop in the Dark Knight bounty def's
  `spawn`).
- The math: a goblin **outruns the player from escort level 11**
  (1.4 × 1.80 = 2.52 > 2.5). A floor-3 party around level 14 faces goblins at
  2.86 px/frame (114% of player speed); at the level-20 cap they walk at
  **3.53 px/frame — 141% of player speed**. Ten of them, un-outrunnable, is the
  "absurd speed" in the playtest report.
- The codebase already knows the fix and applies it in exactly two places: the
  Mantid clamps its walk after levelling
  (`MANTID_MAX_SPEED = PLAYER_SPEED * MANTID_WALK_ADVANTAGE` with advantage
  1.08, defined in `src/creatures/Mantid.ts`, clamp in its `applyMobLevel`
  override) and so does the Mantis Crony (`MANTIS_MAX_SPEED` in
  `src/creatures/MantisCrony.ts`, clamp in its `applyMobLevel` override). The
  comment above `MAX_BOUNTY_MOB_LEVEL` in `src/systems/BountySystem.ts` even
  records that "a walk speed with no ceiling" is what made the Mantid
  unbeatable — fixed for the Mantid, and never generalized. Every other
  levelled creature is still uncapped.
- Same-mechanism latent offenders among bounty escorts (level-20 walk speed):
  `CircusLemur` base 2.6 → **6.55** (`LEMUR_SPEED` in
  `src/creatures/CircusLemur.ts`; the Evil Clown's troupe, `CLOWN_TROUPE` in
  `bountyDefs.ts`), `GoblinArcher` 1.2 → 3.02 (`ARCHER_SPEED` in
  `src/creatures/GoblinArcher.ts`), `SkeletonArcher` 1.05 → 2.65
  (`ARCHER_SPEED` in `src/creatures/SkeletonArcher.ts`), `SkeletonWarrior`
  0.95 → 2.39 (`SKELETON_SPEED` in `src/creatures/SkeletonWarrior.ts`).

**Where levels come from (the seams a difficulty setting must use).**

- Ambient/boss spawns: `partyLevelOf` / `earnedLevelFloor` / `resolveSpawnLevel`
  / `resolveBossLevel` (all in `src/levels/spawner.ts`), driven by
  `MOB_LEVEL_PARTY_RATIO = 0.7` and `BOSS_LEVEL_PARTY_RATIO = 0.8` (both in
  `spawner.ts`), always clamped inside the rule's own `MobLevelRange` band.
  Party level is computed **once at floor generation** (the `DungeonScene`
  constructor's `const partyLevel = partyLevelOf(...)` line).
  `applyMobLevel` call sites: inside `spawnCampResidents` and inside
  `spawnForLevel`'s room, hallway and boss-room spawn loops (all in
  `spawner.ts`), the boss/minion calls in `BountySystem.ts`'s
  `stageEncounter`, plus inherit-level paths (floor-2 grubs, skeleton
  summons).
- Bounties: `bountyMinionLevel` / `bountyBossLevel` (both in
  `BountySystem.ts`), applied at issue (in `stageEncounter`) and again on
  scene-rebuild re-stage at the players' current levels.
- `applyMobLevel` refuses a second call (its re-level guard) and returns early
  for `level <= 1` (its opening guard clause) — anything stamped alongside it
  must not assume it ran. Speed/HP re-authoring must go through
  `setBaseSpeed` / `setBaseMaxHp` in `Mob.ts` (the
  levelled-stats-die-on-reassignment gotcha).

**Where rewards come from.**

- XP: `Mob.scaledXpValue` = base × (1 + (level−1) × 0.25).
- Coins: `coinDropMin/Max` × (1 + (level−1) × 0.25) inside `applyMobLevel`.
- Bounty payout: `bountyPayoutCoins = 60 + 45 × (level − 1)`
  (`BOUNTY_PAYOUT_BASE_COINS`/`BOUNTY_PAYOUT_PER_LEVEL_COINS` and the
  `bountyPayoutCoins` function, `BountySystem.ts`), snapshotted at kill time
  into `pendingPayoutCoins` so a mid-dialog level-up cannot change the number
  (`collectBounty` in `BountySystem.ts`).
- So **rewards already scale with mob level**: any difficulty lever that moves
  levels moves rewards intrinsically. Explicit scaling is only needed where
  levels cannot move (Hard's bounty escort is already at full party level).

**Where a difficulty setting would live and be applied.**

- `src/core/Settings.ts` is device-local `localStorage` with per-field
  validation and defaults (`STORAGE_KEY`/`SETTINGS_VERSION`, the
  `SettingsData` interface and `DEFAULTS`, and the `load` function); an
  additive field needs no version bump (an unknown field simply falls back,
  like `quality`).
- The settings UI is `src/ui/pause/SettingsTab.ts`; the three-way quality
  toggle (the `renderQualityChoice` function) is the exact pattern to copy —
  `addButton` + `BUTTON_PRESETS.toggle`/`toggleActive` + a hints record, hint
  hidden on mobile. The tab's Game section is bottom-anchored because the box
  is height-clamped and tight on mobile landscape (the bottom-anchoring block
  in `renderSettingsTab`).
- Every mob-inflicted hit on either crawler funnels through one choke point:
  `Player.takeDamage` with `DamageSource.kind === 'mob'` (the `DamageSource`
  type and the `takeDamage` method, both in `src/Player.ts`) — melee,
  projectiles resolved by systems, and standing fields all construct
  `kind: 'mob'` sources. HP is already fractional (regen adds fractional HP
  per tick), so a multiplied `amount` needs no rounding.

**The gates to extend.**

- `scripts/verify-difficulty.ts` — sections named via `section(...)`:
  `'cadence curve'`, `'telegraphs'`, `'projectiles'`, `'regen curve'`,
  `'spawn counts'`, `'level bands'`, `'re-levelling'` (incl. the checkpoint
  speed case), `'progression regions'`; the `check()` helper backs all of
  them.
- `scripts/verify-bounty.ts` — builds every def's encounter for real; asserts
  the boss XP band 1000–2000 (`MIN_BOSS_XP`/`MAX_BOSS_XP`) and
  boss-out-earns-escort on the **base** `xpValue` field.
- Both are registered in `tsconfig.scripts.json` (opt-in include list — no new
  script files are added by this plan, so no registration risk).

---

## 2. Design positions

- **P1 — The goblin cap is unconditional.** It lives in the level curve's
  application, not in the difficulty profile. Ryan's report is explicit:
  "regardless of difficulty setting."
- **P2 — Scope: the toggle is global, not bounty-only.** The feedback names
  both ends: floor 1 too easy _and_ floor-3 bounties too hard. A bounty-only
  toggle fixes half the complaint. The shipped rebalance makes global scope
  cheap: every level in the game resolves through four functions in
  `spawner.ts` plus two in `BountySystem.ts`, and every mob-inflicted hit
  through one method on `Player` — six seams total.
- **P3 — Normal is identity.** The Normal profile multiplies everything by 1.0
  and reproduces today's constants exactly; `verify:difficulty` asserts it.
  Players who never open settings get the game the rebalance shipped.
- **P4 — Two lever families, deliberately different timing.**
  _Levels_ stamp at spawn (floor generation / bounty issue) — the shipped "no
  live re-levelling" rule (P5 in `docs/difficulty-fairness-rules.md`) stands.
  _Incoming-damage scale_ reads live — flipping to Kitten mid-bounty must help immediately, or the
  toggle fails the player who needed it most. Reward scales stamp at spawn
  with the level, so flipping difficulty right before a kill changes nothing.
- **P5 — No sponge axis.** Difficulty never touches mob HP scale, cadence
  floors, telegraph minimums, or projectile caps — the fairness invariants in
  `verify:difficulty` are difficulty-independent and keep passing untouched.
- **P6 — Persistence in `Settings`.** Device-local like quality/volume: the
  server save is snapshots + levelId only, quest state already resets on
  reload, and Settings works in every boot path (per the header comment in
  `Settings.ts`). Ids are
  `'easy' | 'normal' | 'hard'`; UI labels are **Kitten / Crawler / Nightmare**.
- **P7 — Rewards scale by two composed mechanisms, both named.** Intrinsic
  (lower/higher spawn levels feed the existing +25%/level XP and coin curves)
  and explicit per-difficulty scales that compensate only where levels cannot
  move (Hard). Easy's reward drop comes almost entirely from the intrinsic
  path, so it never feels like a punishment multiplier.

---

## 3. Phase 1 — Goblin speed cap (ships alone, before everything else)

Promote the Mantid's clamp to the shared mechanism it should have been:

- **`Mob` gains `protected get levelledSpeedCap(): number | null`** (default
  `null` = uncapped). `applyMobLevel` clamps after computing the speed
  multiplier, and `setBaseSpeed` clamps too — so an enrage, evolution, or
  checkpoint `resetToSpawn` that re-authors speed cannot climb back over the
  cap (the reassignment gotcha, in reverse).
- **Goblin** (`src/creatures/Goblin.ts`):
  `GOBLIN_MAX_SPEED = PLAYER_SPEED * GOBLIN_MAX_SPEED_RATIO` with
  `GOBLIN_MAX_SPEED_RATIO = 0.8` → **2.0 px/frame**. Expressed as a fraction
  of `PLAYER_SPEED` per the shipped bolt-cap convention, so it cannot drift if
  player speed is retuned. Effect: levels 1–6 are untouched (level 6 =
  1.96 < 2.0); the cap binds from level ~7; a level-20 bounty goblin drops
  from 3.53 (141% of player) to 2.0 (80%). Goblins stay a _pinning_ threat —
  the archer band and the Knight's slam do the killing — and the player can
  always disengage. This is the "MUCH lower" ask, grounded: no goblin ever
  outruns the player again.
- **GoblinArcher** (`ARCHER_SPEED` in `GoblinArcher.ts`):
  `ARCHER_MAX_SPEED_RATIO = 0.7` → 1.75. A kiter that outruns its pursuer is
  unkillable; base 1.2 means levels 1–6 unchanged.
- **Refactor Mantid + MantisCrony** onto the shared getter (delete their
  `applyMobLevel` overrides in `Mantid.ts` and `MantisCrony.ts`; their
  existing 1.08 / 1.04 advantage constants become their getter values).
- **Cap the remaining bounty escorts** — the same bug, one bounty away from
  the same report:
  | Class                                                                       | base      | L20 today   | proposed cap     | ratio constant                  |
  | --------------------------------------------------------------------------- | --------- | ----------- | ---------------- | ------------------------------- |
  | CircusLemur (`LEMUR_SPEED` in `CircusLemur.ts`)                             | 2.6       | 6.55        | 2.6 (= its base) | `LEMUR_MAX_SPEED = LEMUR_SPEED` |
  | SkeletonArcher (`ARCHER_SPEED` in `SkeletonArcher.ts`)                      | 1.05      | 2.65        | 1.75             | 0.7 × player                    |
  | SkeletonWarrior (`SKELETON_SPEED` in `SkeletonWarrior.ts`)                  | 0.95      | 2.39        | 2.0              | 0.8 × player                    |
  | StiltClown / FatClown (`CLOWN_SPEED` in `StiltClown.ts` and `FatClown.ts`)  | 0.9 / 0.7 | 2.27 / 1.76 | 2.0              | 0.8 × player                    |
  | The lemur's cap equals its authored base: it already outpaces the player by |
  | design at the circus, so levelling simply buys it nothing — circus behavior |
  | is unchanged by construction.                                               |
- **Verify** (`scripts/verify-difficulty.ts`, new `section('speed caps')`):
  instantiate every class in an explicit registry (goblin family + all bounty
  escort classes; assert the registry is non-empty — the
  gate-that-cannot-find-its-row-is-green lesson), `applyMobLevel(20)`, assert
  `moveSpeed` ≤ its declared cap, and assert every cap ≤
  `PLAYER_SPEED * MAX_LEVELLED_WALK_ADVANTAGE` (1.1 — the Mantid's stalk
  advantage is the only sanctioned >1, at 1.08) **or** equal to the creature's
  authored base (the lemur case). Also assert the checkpoint case: level,
  `resetToSpawn()`, cap still holds (extends the existing
  `section('re-levelling')` block).
- Update the comment above `MAX_BOUNTY_MOB_LEVEL` in `BountySystem.ts` — its
  "fixed at the source" claim becomes true for goblins too.
- Audit note, out of scope but recorded: ambient `Krasue` (base 2.0,
  `KRASUE_SPEED` in `Krasue.ts`) passes player speed at level ~5 and floor-3
  ambients roll levels 5–9. Flag for Ryan; if it plays badly, she gets a
  getter row in the same registry.

- Fight the Dark Knight bounty at a level-12+ party: the goblin
  screen should pin and swarm, not chase you down in the open. Confirm plain
  floor-1 goblins feel unchanged.

## 4. Phase 2 — `DifficultyProfile` core + Settings field

**New file `src/core/difficultyProfiles.ts`** (pure, importable by the verify
scripts):

```ts
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyProfile {
  /** Multiplies mob-inflicted damage in Player.takeDamage. Read live. */
  incomingMobDamageScale: number;
  /** Replaces MOB_LEVEL_PARTY_RATIO (0.7 today) in earnedLevelFloor. */
  ambientLevelRatio: number;
  /** Replaces BOSS_LEVEL_PARTY_RATIO (0.8 today) in resolveBossLevel. */
  bossLevelRatio: number;
  /** Fraction of party level a bounty escort spawns at (1.0 today). */
  bountyLevelRatio: number;
  /** Explicit XP/coin scale, stamped on the mob at spawn. */
  rewardXpScale: number;
  rewardCoinScale: number;
  /** Multiplies Shady's coin payout, captured at kill time. */
  bountyPayoutScale: number;
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile>;
```

| axis                     | easy (Kitten) | normal (Crawler) | hard (Nightmare) |
| ------------------------ | ------------- | ---------------- | ---------------- |
| `incomingMobDamageScale` | 0.7           | 1.0              | 1.3              |
| `ambientLevelRatio`      | 0.55          | 0.7              | 0.85             |
| `bossLevelRatio`         | 0.65          | 0.8              | 0.95             |
| `bountyLevelRatio`       | 0.75          | 1.0              | 1.0              |
| `rewardXpScale`          | 1.0           | 1.0              | 1.25             |
| `rewardCoinScale`        | 1.0           | 1.0              | 1.25             |
| `bountyPayoutScale`      | 0.85          | 1.0              | 1.5              |

Reasoning for the asymmetries:

- Easy's reward drop is **intrinsic**: `bountyLevelRatio` 0.75 at a level-15
  party spawns level-11 escorts, whose XP curve pays ×3.5 instead of ×4.5 —
  a ~22% cut with no explicit penalty number for a struggling player to
  resent. `rewardXpScale` stays 1.0 on Easy on purpose.
- Hard cannot raise levels much — bounty escorts are already at full party
  level and ambient bands clamp — so its reward bump must be explicit
  (`rewardXpScale`/`rewardCoinScale` 1.25, payout 1.5), matching the ×1.3
  incoming damage it charges for.
- `incomingMobDamageScale` is the only lever that moves a level-1 floor-1
  fight, which is exactly the "floor 1 easy for everyone" complaint: bands and
  ratios do nothing at party level 1–2, a flat ×1.3 does.
- All ratios pass through the existing band clamps
  (`earnedLevelFloor`/`resolveBossLevel` clamp to `MobLevelRange`, both in
  `spawner.ts`), so no floor's identity changes and Easy can never spawn
  below an authored band minimum.

**`src/core/Settings.ts`**: add `difficulty: Difficulty` to `SettingsData`
(default `'normal'`), an `isDifficulty` validator mirroring `isQualityPreset`
(in `Settings.ts`), getter + `setDifficulty`. No `SETTINGS_VERSION` bump —
additive, per-field fallback like every existing field. Export a convenience
`activeDifficultyProfile(): DifficultyProfile` from `difficultyProfiles.ts`
that reads `settings.difficulty` (kept out of `Settings.ts` so the profiles
module stays pure for the verify scripts).

**`Mob`**: new `applyDifficultyRewards(xpScale: number, coinScale: number)`
called by spawners **next to** every `applyMobLevel` call — a separate method
because `applyMobLevel` early-returns at `level <= 1` (its opening guard
clause) and is refused on a second call, so piggybacking would silently skip
level-1 mobs. It multiplies `coinDropMin/Max` once and stores an `xp` factor
read by `scaledXpValue`. Idempotence: refuse a second call the same way
`applyMobLevel` does (its re-level guard). Plain fields — they survive
`resetToSpawn` and checkpoint restores by construction.

**Telemetry**: record `settings.difficulty` in `DifficultyStats`
(`src/core/DifficultyStats.ts`) and print it on the `?difficulty` overlay
(`src/dev/difficultyOverlay.ts`), so every future playtest number is labeled
with the tier it was measured on.

## 5. Phase 3 — Wire the seams

- **Ambient levels** (`src/levels/spawner.ts`): `earnedLevelFloor`,
  `resolveSpawnLevel`, `resolveBossLevel` gain a `profile: DifficultyProfile`
  parameter (kept pure — the verify script calls them with explicit profiles).
  `MOB_LEVEL_PARTY_RATIO`/`BOSS_LEVEL_PARTY_RATIO` move into the Normal
  profile row. The one production caller chain starts at the `DungeonScene`
  constructor's `partyLevel` computation, which passes
  `activeDifficultyProfile()` — captured once at floor generation, honoring
  stamp-at-spawn.
- **Bounty levels** (`bountyMinionLevel` / `bountyBossLevel` in
  `BountySystem.ts`): both gain the same parameter; `bountyLevelRatio` applies
  before the `MAX_BOUNTY_MOB_LEVEL` clamp. `BOUNTY_BOSS_LEVEL_BONUS`
  unchanged. The issue path (`stageEncounter`) and the scene-rebuild re-stage
  both read the live profile — a bounty issued on Easy and resumed after a
  door stays Easy only if the setting still says so, which matches how the
  re-stage already re-reads player levels.
- **Rewards**: pair `applyDifficultyRewards(profile.rewardXpScale,
profile.rewardCoinScale)` with every `applyMobLevel` site
  (`spawnCampResidents` and `spawnForLevel`'s spawn loops in `spawner.ts`, the
  boss/minion calls in `BountySystem.ts`'s `stageEncounter`) and the
  inherit-level paths (floor-2 on-kill grubs, skeleton summons — grep
  `applyMobLevel(` and pair each).
- **Bounty payout**: multiply by `bountyPayoutScale` where
  `pendingPayoutCoins` is captured (in `collectBounty`, `BountySystem.ts`) —
  the existing snapshot-at-kill pattern already makes the number immune to a
  settings flip during Shady's dialog.
- **Incoming damage** (`Player.takeDamage` in `src/Player.ts`): at the top of `takeDamage`, when
  `source?.kind === 'mob'`, scale `amount` by
  `activeDifficultyProfile().incomingMobDamageScale`. Unrounded — HP is
  already fractional. Applies to both crawlers (CatPlayer shares the method).
  Status ticks (`kind: 'status'`) and self-inflicted dynamite stay unscaled:
  scaling a burn that is already running re-prices a hit after the dodge/avoid
  decision was made, which violates the shipped fairness framing.

## 6. Phase 4 — UI

- **Settings tab** (`src/ui/pause/SettingsTab.ts`): a "Difficulty" section
  between Graphics and the bottom-anchored Game section, cloned from the
  quality pattern (the `renderQualityChoice` function): three `addButton`
  toggles (`BUTTON_PRESETS.toggle` / `toggleActive`) labeled **Kitten /
  Crawler / Nightmare**, plus a `DIFFICULTY_HINTS: Record<Difficulty, string>`
  line (desktop only, like quality hints). Hint copy states the timing
  contract, e.g. Kitten: "Take less damage now; weaker spawns from the next
  floor or bounty." All layout numbers named constants; the tab is
  height-clamped and tight on mobile landscape (the bottom-anchoring block in
  `renderSettingsTab`), so the section reuses `QUALITY_SECTION_Y_SPACING_BARE`
  sizing on mobile.
- **Shady's offer dialog** (`buildBountyOfferDialog` in
  `src/systems/shadyDialogs.ts`): when the active difficulty is not Normal,
  `buildBountyOfferDialog` appends one line naming
  the tier and its payout consequence ("Kitten rates — the purse is lighter"),
  so the reward change is disclosed where the contract is signed. No selector
  at the board — one global selector in Settings, per P2; a second control
  surface would invite per-bounty toggling for reward arbitrage.
- Settings tab on a phone in landscape: all three difficulty buttons
  reachable, nothing crowded off the box; Reset/Back still reachable.

## 7. Phase 5 — Verify-gate extension

`scripts/verify-difficulty.ts`, new `section('difficulty profiles')`:

- The Normal profile is exactly identity: every axis 1.0 except the two level
  ratios, which must equal the shipped 0.7 / 0.8 — this is the
  today's-game-unchanged proof.
- Monotonicity per axis: easy ≤ normal ≤ hard for `incomingMobDamageScale`
  and all level ratios; reward scales ≥ 1.0 only on hard; every scale > 0.
- Band safety: `earnedLevelFloor` / `resolveBossLevel` under every profile ×
  party levels 1–30 stay inside the rule band.
- Bounty levels under every profile stay within 1..`MAX_BOUNTY_MOB_LEVEL`,
  and easy < normal at a level-15 party (the actual relief being promised).
- Speed caps hold at level 20 **under every profile** (composes with Phase 1's
  section — difficulty must never re-open the runaway).
- `applyDifficultyRewards` refuses a second call.

`scripts/verify-bounty.ts`:

- Build every def's encounter at escort levels derived under each of the three
  profiles; assert every escort mob's `moveSpeed` ≤ `PLAYER_SPEED *
MAX_LEVELLED_WALK_ADVANTAGE` or its authored base — this is the check that
  was missing when the goblins shipped.
- The existing XP band (1000–2000) and boss-out-earns-escort checks read base
  `xpValue` (the `MIN_BOSS_XP`/`MAX_BOSS_XP` and `BOSS_XP_ESCORT_RATIO`
  assertions in `verify-bounty.ts`) and are untouched by reward scaling —
  assert once, explicitly, that `rewardXpScale` does not mutate `xpValue`.
- `bountyPayoutCoins × bountyPayoutScale` is monotone in difficulty at a fixed
  party level.

No new script files — both scripts already sit in `tsconfig.scripts.json`'s
include list.

## 8. Phase 6 — Notes for Ryan's playtest

- Floor 1 on Nightmare from a fresh save: room fights bite (HP
  after a room fight lands in the rebalance's 40–70% target band on the
  `?difficulty` overlay) without spike deaths.
- A floor-3 bounty on Kitten at a mid-skill party: winnable with
  potions and movement; the Dark Knight's goblin screen pins but cannot run
  you down (composes Phase 1 + Phase 2).
- Flip Kitten → Nightmare mid-floor: damage changes immediately,
  spawned mobs keep their levels, next floor spawns harder. Shady's offer
  shows the tier line on both non-Normal tiers.
- Rewards read fair: Nightmare bounty pays visibly more coins/XP;
  Kitten pays less without feeling punitive.

---

## Sequencing

1. **Phase 1** ships alone — it is the reported bug, it needs no setting, and
   its verify section is the falsifiable half of the fix.
2. **Phases 2 → 3 → 5** as one unit (profiles are inert until wired; the
   gates prove Normal is identity before any UI exposes the toggle).
3. **Phase 4** last, then the Phase 6 playtests.

## What we are deliberately NOT doing

- No difficulty axis on mob HP, cadence floors, telegraph minimums, or
  projectile speed caps — the shipped fairness invariants stay
  difficulty-independent.
- No per-bounty difficulty picker at the board or on Shady (reward-arbitrage
  surface; one global selector).
- No live re-levelling of spawned mobs on a settings flip (stamp-at-spawn, per
  the shipped rebalance's P5).
- No editing of `MAX_BOUNTY_MOB_LEVEL` or per-mark tuning — the comment above
  `MAX_BOUNTY_MOB_LEVEL` in `BountySystem.ts`'s "tune an individual mark"
  stance stands;
  Easy routes around it via `bountyLevelRatio`, and the goblin problem was
  never a level problem.
- No server-side persistence of the setting (device-local, like every other
  setting, until saves grow real client state).

## Journal

- 2026-08-05 — Plan written from direct code exploration; no implementation
  started. Key finding: the goblin runaway is `MOB_LEVEL_SPEED_SCALE` (linear,
  uncapped, defined and applied in `src/creatures/Mob.ts`'s `applyMobLevel`) ×
  the bounty's full-party-level escorts (`bountyMinionLevel` in
  `BountySystem.ts`); goblins outrun the player from escort level 11. The
  Mantid already carries the correct fix shape (its `applyMobLevel` override
  in `Mantid.ts`) — Phase 1 generalizes it. The CircusLemur is a worse latent
  offender (6.55 px/frame at cap) and is capped in the same phase.
