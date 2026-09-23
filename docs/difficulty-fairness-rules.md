# Difficulty: fairness rules

The game applies real pressure — fights that can be lost, potions that get used.
Frustration is kept out by the rules below, not by keeping enemies weak. They are
labelled **P1–P6** so code comments and review notes can name one without restating it.

Three headless gates hold the rules. Each runs against the game's own exported
constants, functions and creature classes rather than a copy, so a retuned formula
either still satisfies the rule or fails the script:

- `npm run verify:difficulty` — P2 and P5, plus the cadence curve and spawn level bands.
- `npm run verify:difficulty-curve` — P1: the HP-share target, measured on every
  regular creature, boss and bounty escort in the spawn tables; and P4's room-fight
  band, measured on every floor that spawns rooms.
- `npm run verify:tactics` — P6: which mobs learn a trait, how likely, and how each
  learned behaviour is bounded once running.

---

## P1 — Pressure, not sponge

A regular fight should cost an on-schedule party roughly the same _share_ of its HP
at every level, drifting slowly upward — never climbing into a wall. Mob stats may
grow only as fast as the player's own one-point-per-level growth answers them; the
rest of the rising challenge comes from how **often** and how **well** enemies attack
(P6), never from time-to-kill bloat, which reads as grind rather than challenge.

Every per-level curve — HP, damage, walk speed, projectile speed, cadence — lives in
`src/creatures/mobLevelScaling.ts`, each with its own named ceiling on the multiplier
(`MAX_MOB_HP_MULTIPLIER` and siblings) so raising the level cap cannot silently
extend a curve past what was checked. `Mob.applyMobLevel`, `Mob.scaledDamage` and
every boss, summon and quest system that levels a mob read these functions; nothing
rolls its own level arithmetic.

**A floor's own curve.** A floor may level its mobs on a different HP and damage
curve than the shared one: `LevelDef.levelledCurve`, a `LevelledCurve` in
`mobLevelScaling.ts`, handed to `applyMobLevel` at every spawn site and inherited by
anything spawned at another mob's level. A level-1 mob is the same on every curve.
Floor 1 is the one floor that uses it: it keeps `LEARNING_FLOOR_LEVELLED_CURVE`, the
steeper, rounded-up curve it was tuned on, so none of its fights moved when the shared
curve was flattened for the deeper floors. Which rules read the floor's curve: the
room-fight band, the off-stat where-met rule, the boss ratio ceilings (walked only
inside the floor's boss band, since a floor's curve never levels a boss past it) and
the learning-floor gate. The regular creatures' ratio paths and the hits band read
the shared curve — they are what keep the shared curve itself honest — and a floor on
its own curve is held instead to the fights and blows it was tuned with:
`verify:difficulty-curve` holds floor 1's rooms, treasure guards and bosses within a
named tolerance of their tuned costs, either way, and its multi-point blows and health
bars to their tuned values exactly.

The HP and damage rates (`MOB_LEVEL_HP_SCALE`, `MOB_LEVEL_DAMAGE_SCALE`) are not
picked by feel. They are whatever satisfies the target `verify:difficulty-curve`
asserts, and the target's bounds are the named constants beside the curves in the
same module:

- **HP share per fight.** One mob, one stand-up fight, measured against the reference
  crawler in `src/core/referenceCrawler.ts` — real stat, HP, dodge and damage
  formulas, no gear, skills or consumables — and expressed as a ratio of the same
  creature's share at party level 1. Along the expected path for the `balanced`
  build, the trend (averaged over `HP_SHARE_TREND_WINDOW` party levels) never falls
  by more than `HP_SHARE_DIP_TOLERANCE` from one level to the next until spawn levels
  reach the cap, ends between `HP_SHARE_END_MIN` and `HP_SHARE_END_MAX`, and never
  exceeds `HP_SHARE_CEILING`. A fight cheaper than `RATIO_CEILING_MIN_HP_SHARE` of max
  HP is exempt from the ratio ceilings only.
- **Hits to kill.** The `balanced` build kills a regular mob, where that mob is met,
  in `HITS_TO_KILL_MIN`–`HITS_TO_KILL_MAX` blows. At levels a floor has tracked the
  party up to (below), it kills one within `TIME_TO_KILL_MAX_SECONDS` instead: time is
  what tells a sponge from a tough mob once the mob has out-grown the blow count.
- **The off-stat build never gets locked out.** A deliberately badly spent build
  still beats every regular mob at its floor's authored band alone (share under
  `OFF_STAT_HP_SHARE_MAX`). At levels a floor has tracked the party up to, it cannot:
  that build's main attack never grows, and a tracked mob keeps levelling. There the
  rule is held for the party it plays in, an off-stat human and an off-stat cat
  together, at three strengths:
  - **per mob, on normal:** they beat any one regular mob with more than half their
    pooled bar left (`OFF_STAT_PARTY_HP_SHARE_MAX`); on hard, they still win;
  - **the unavoidable fight, on normal:** they finish the smallest fight a crossing
    of the floor cannot avoid — the roaming pair on every overworld road — with at
    least `OFF_STAT_UNAVOIDABLE_HP_REMAINING_MIN` of their bar;
  - **optional encounters whole, on easy:** a camp taken all at once may beat them
    on normal, where they can walk around it, pull it apart, retreat or drink; on
    easy, where a struggling build is sent, they finish every one.

  A player who spent points badly struggles; they are never locked out.

- **Difficulty profiles.** Easy sits at or below normal. Hard may sit higher but is
  held to `HARD_HP_SHARE_CEILING`.
- **Bosses and escorts.** A boss fight may cost more, up to `BOSS_HP_SHARE_CEILING`
  times its own level-1 cost. Bounty escorts spawn at a full party ratio and are held
  to the regular ceiling at that ratio.
- **Bounties, absolutely.** A ratio against a creature's own level-1 fight cannot see
  a creature authored to kill from full at level 1, so every bounty is also staged
  whole — `stageBountyEncounter` and `EncounterCommitment`, the real mob loop and
  projectile systems — against each `balanced` reference crawler standing her
  ground, on normal and hard, at every party level through the cap, with dodge left
  out. No single blow from the mark, its escort or its summons may take more than
  `BOUNTY_MAX_BLOW_HP_SHARE` of the victim's full bar: every bounty mob carries that
  cap (`Mob.blowCapShareOfTargetHp`), applied after the difficulty scale, so it holds
  for either crawler whatever the curve does. The human standing her ground also
  lives at least a second past first blood on normal, and past the
  `LOCKED_TELEGRAPH_MIN_FRAMES` floor on hard. Donut's bar is a few points by design and dodge is
  her defence, so with dodge left out she is held to the per-blow cap and the
  `LOCKED_TELEGRAPH_MIN_FRAMES` floor. An
  encounter commits one member at a time (`StaggeredCommit`,
  `src/systems/bountyCommit.ts`), so a mirrored pair of escorts never lands its
  first blows on the same frame.

When a fight drags, the answer is more pressure — a shorter cooldown, a smarter
approach, an extra body — not more hit points. When one creature cannot pass without
bending the shared curve for everyone else, it gets its own base-stat adjustment in
its own file.

**A party ahead of the floor.** A band's ceiling holds every mob on a floor while
the party keeps growing, so a party that arrives past a floor's recommended level
meets it weaker every level it gains there. A floor answers that in one of two ways,
both keyed to how far the party's earned level has passed a band's top, both applied
on every difficulty through the profile's own ambient ratio, and neither authored on
the learning floor:

- **More bodies** — `overLevelReinforcement`: each room gains one body for every
  `levelsPerBody` levels past the room's band top, up to `maxBodies`, and never past
  `MAX_ROOM_SPAWN_COUNT` (`overLevelReinforcementBodies` in `src/levels/spawner.ts`).
  The per-mob fight is unchanged, so every one-on-one rule holds as authored.
- **Higher levels** — `ambientTracking`: every ambient band slides up so its rolls
  land `levelsBehind` under the party's earned level, never past the floor's
  `maxLevel` (`partyTrackedBand`). The step back softens the arrival, where every
  band's top sits well under what the party has earned. The mob outgrows the off-stat build, so a floor that tracks is
  held to the restated off-stat and time-to-kill rules above. The ceiling sits where
  no tactics trait has reached its cap yet, leaving the top of every ramp to bounty
  escorts.

A party still inside a band meets it exactly as authored either way.

**XP pays for levels at the floor's own rate.** A floor's `xpDiminishingTiers` apply
to every XP award earned there — kills, bosses and quest rewards alike — and
`Player.gainXp` prices each level at the tier of the level being bought. A single
large award therefore buys what the same XP earned kill by kill would, and cannot
carry a crawler past a floor's tiers at full value. Every award goes through
`awardXp` (`src/core/awardXp.ts`), which announces the level-up, and every party is
built with its floor's curve (`PlayerManager` requires it), interiors included.
`verify:difficulty` asserts both.

## P2 — Fairness invariants

Hard rules. Every one of these is asserted by `verify:difficulty`.

- **Locked telegraphs last at least `LOCKED_TELEGRAPH_MIN_FRAMES` (350 ms) at every
  level** (`src/creatures/mobLevelScaling.ts`). _Locked_ means
  the shot vector is resolved when the lock begins, not on the release frame. A lock
  that only freezes the sprite's facing while the projectile still resolves on release
  buys the player nothing — and a check that asserts the _constant's value_ will not
  notice the difference. Drive a real creature through its attack against a moving
  target instead.
- **Every scaled cooldown or windup has an explicit floor.** Everything asymptotic,
  nothing unbounded.
- **Every scaled projectile speed has an explicit cap, written as a fraction of
  `PLAYER_SPEED`** rather than as an absolute, so a bolt stays outrunnable even if
  player speed is retuned later.
- **Avoidance by movement alone must always remain possible.** Scaling may shrink the
  margin; it may never close it. Damage that is undodgeable once you are already inside
  it — flame patches, radial bursts — stays flat and does not scale at all.

## P3 — Death stays generous

Checkpoint restore, no XP or coin loss, full-HP respawn. Cheap retries are the
counterweight that lets the fights themselves be hard.

## P4 — Tune with data

`?difficulty` boots the run-scoped counters in `src/core/DifficultyStats.ts`. They are
deliberately _not_ fields on `GameStats`, which is rebuilt along with its `DungeonScene`
and would therefore lose every counter at each stairwell. `?perf` and `?difficulty`
compose rather than replacing one another.

Target feel for an on-level player — the bands the counters are read against:

| Metric                                  | Target |
| --------------------------------------- | ------ |
| HP remaining after a regular room fight | 40–70% |
| Potions used per gauntlet segment       | 1–3    |
| Deaths per floor, first clear           | 0–2    |
| Time-to-kill, one regular mob           | 3–8 s  |

`verify:difficulty-curve` holds the first row for a reference party — the `balanced`
human and cat together, both attacking, the fights the spawner rolls (a floor's rooms;
on the overworld each camp and a pair of roaming mobs) — early, mid and late between
a floor's recommended level and the level its XP curve's last tier starts at, where a
thorough party leaves it: between `ROOM_FIGHT_HP_REMAINING_MIN` and
`ROOM_FIGHT_HP_REMAINING_MAX` on normal, where the first floor, the one mechanics are
learned on, is held only to the minimum — and to its tuned costs (P1, a floor's own curve). Easy must leave no less than normal at the
same party level, and hard no more — but never less than
`HARD_ROOM_FIGHT_HP_REMAINING_MIN`. The model stands both crawlers still, so a player who
steps out of telegraphs keeps more than it says; it is the bar for the reference party,
not a prediction of any one run.

The overlay also tallies P6 per segment: guard blocks per fight, kites started and
their average length in frames, and HP remaining split between fights that included
at least one trait-bearing mob and fights with none. The 40–70% band above is the bar
for both columns. If trait fights consistently land below 40%, lower the trait
chances in `TRAIT_RAMPS` (or the profile's `tacticsChanceScale`) before touching
stats.

## P5 — Levels apply once, at spawn

`applyMobLevel` reads the mob's current stats and multiplies in place, so a second call
squares the level. It refuses and warns rather than compounding. No system may re-level
a live mob, and spawn levels are resolved once, at floor generation, from the party as
restored.

The difficulty setting's level ratio is read in the same place, so a switch to easy
mid-floor changes only the damage the crawlers take — the profile's incoming-damage
scale is read live — until the floor's mobs are spawned again. The mobs already
standing keep the levels, and the traits, they were spawned with.

The same in-place multiplication is why assigning a raw constant to a levelled stat
(`this.speed = SOME_CONST`) silently un-levels the mob. Use `setBaseSpeed` /
`setBaseMaxHp`.

## P6 — Enemies get smarter, within bounds

Past the early game, the rising challenge is behaviour: a levelled mob may have learned
to flank, guard a blow (`block`), back off toward a friend (`kite`), fall back on one
when wounded (`regroup`), or answer a guard quickly (`riposte`). The traits are defined
in `src/creatures/tactics/`; every one of these rules is asserted by `verify:tactics`.

- **Unlocked by level, with capped chances.** Each trait's unlock level, chance at
  unlock, per-level increment and hard maximum live in `TRAIT_RAMPS`
  (`src/creatures/tactics/tacticsTraits.ts`). A difficulty profile's
  `tacticsChanceScale` scales the chance before the cap, and normal is the identity.
  Every unlock level must be one a shipped floor's ambient mobs actually reach, or the
  trait only ever appears on party-levelled bounty escorts; the middle floor's mobs
  stay rarely clever, and no trait reaches its cap at any floor level.
- **Never below mob level 5.** `TACTICS_MIN_MOB_LEVEL` is a floor under the table, not
  a consequence of it: retuning a trait's unlock level downward cannot reach the early
  game, which is tuned around mobs that stand and trade blows.
- **Rolled once, at spawn, never live.** Traits are rolled straight after
  `applyMobLevel`, by `applySpawnDifficulty`, from the spawner's own random source. A
  mob is a blocker for its whole life or not at all. Traits survive `resetToSpawn`,
  checkpoint revive and `healAndForgetFight`; live behaviour state (a guard cooldown,
  a kite in progress) is what those clear.
- **Opt-in per creature.** `Mob.tacticsEligibility` is empty by default. Bosses, quest
  NPCs, summons, maze targets, non-combatants, mercenaries and rooted creatures keep
  their authored behaviour, and a creature lists only traits its own AI acts on.
- **Bounded durations.** A kite or regroup ends at a frame cap
  (`KITE_MAX_FRAMES`, `REGROUP_MAX_FRAMES`), a walked-distance cap
  (`KITE_MAX_DISTANCE_TILES`, `REGROUP_MAX_DISTANCE_TILES`), a stall, the leash, or a
  hazard — whichever comes first — and then the mob commits and fights. Every ending
  spends the cooldown (`KITE_COOLDOWN_FRAMES`); a regroup happens once per life. Caps
  bound duration, not the number of starts. Tactics never raise a mob's speed, so a
  player who chases a kiter catches it. The last one standing never kites, and a
  wounded mob with no ally fights on — regroup is not fleeing.
- **Flanking never detours.** A flank slot that is unreachable, or would cost more
  than `FLANK_MAX_DETOUR_RATIO` of the direct approach, is dropped for the direct
  approach, so a corridor fight stays a legitimate tactic for the player. Flanking
  changes where a mob stands, never how often it attacks.
- **No block streaks.** After a guard, the mob cannot guard again until an unguarded
  hit has landed _and_ `GUARD_COOLDOWN_FRAMES` have passed. The trait's chance is a
  per-blow roll, not immunity.
- **Only a swung weapon can be guarded.** `GUARDABLE_DAMAGE_TYPES`
  (`src/creatures/tactics/blockGuard.ts`) is melee and physical projectiles. Spells,
  status ticks, blasts and environmental damage are never guarded, nor is a blow on a
  mob at or below `GUARD_LOW_HP_FRACTION` — a mob one hit from death that turns the blow
  aside reads as a stolen kill. A guard shoves the mob away from the crawler that
  struck, which is the space the lost hit is paid back in. It is a separate mechanic
  from the boss shields (`isDamageImmune` / `onDamageBlocked`).
- **Hazards outrank tactics.** A tactic refuses or abandons any step onto marked ground
  (`src/creatures/tactics/markedGround.ts`), and abandoning spends its cooldown, so a
  retreat and a hazard can never take turns on alternate frames.
- **Telegraph minimums hold through riposte.** A riposte shortens only the wait
  _between_ attacks, and never below `RIPOSTE_READY_FRAMES`, which is itself at least
  the P2 locked-telegraph floor. The windup, the telegraph and the frame the blow lands
  on are untouched, so the punishment for swinging into a guard stays dodgeable.
- **Readable.** A mob acting on a trait carries a rank mark by its health bar, a guard shows
  a "Blocked" label, and `TacticsNoticeSystem` announces each trait the first time the
  party fights one. Smarter AI the player cannot see reads as randomness.

---

## Deliberately out of bounds

Changes that would undo the above, and are not to be made without a decision to change
this document first:

- 1:1 player-level matching for spawns. It erases the reward for getting stronger —
  spawn levels use a sub-1 ratio of party level, floored and capped by their own band.
- Live mid-floor rescaling of already-spawned mobs.
- Letting an over-levelled party pull a floor's mob levels past its bands outside
  `ambientTracking`, or tracking on the learning floor (see P1).
- XP that skips a floor's diminishing curve.
- Uncapped scaling curves of any kind.
- Raising the HP or damage curve above what `verify:difficulty-curve` allows, or
  loosening that gate's bounds to make room for it.
- Rolling tactics traits below `TACTICS_MIN_MOB_LEVEL`, re-rolling them on a live mob,
  or letting a guard meet a spell, a status tick or a low-HP blow.
- Nerfing potion healing or potion cooldown.
- Softening the death penalty.
