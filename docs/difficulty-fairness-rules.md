# Difficulty: fairness rules

The game applies real pressure — fights that can be lost, potions that get used.
Frustration is kept out by the rules below, not by keeping enemies weak. They are
labelled **P1–P5** so code comments and review notes can name one without restating it.

`npm run verify:difficulty` is the headless gate on P1, P2 and P5. It runs against the
game's own exported constants and functions rather than a copy, so a retuned formula
either still satisfies the rule or fails the script.

---

## P1 — Pressure, not sponge

Scale how **often** and how **well** enemies attack, never how much HP they carry.
Time-to-kill bloat reads as grind, not as challenge. `MOB_LEVEL_HP_SCALE` in
`src/creatures/Mob.ts` stays at 0.3. When a fight drags, the answer is more pressure —
a shorter cooldown, a smarter approach, an extra body — and never more hit points.

## P2 — Fairness invariants

Hard rules. Every one of these is asserted by `verify:difficulty`.

- **Locked telegraphs last at least 21 frames (350 ms) at every level.** _Locked_ means
  the shot vector is resolved when the lock begins, not on the release frame. A lock
  that only freezes the sprite's facing while the projectile still resolves on release
  buys the player nothing — and a check that asserts the _constant_ is 21 will not
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

## P5 — Levels apply once, at spawn

`applyMobLevel` reads the mob's current stats and multiplies in place, so a second call
squares the level. It refuses and warns rather than compounding. No system may re-level
a live mob, and spawn levels are resolved once, at floor generation, from the party as
restored.

The same in-place multiplication is why assigning a raw constant to a levelled stat
(`this.speed = SOME_CONST`) silently un-levels the mob. Use `setBaseSpeed` /
`setBaseMaxHp`.

---

## Deliberately out of bounds

Changes that would undo the above, and are not to be made without a decision to change
this document first:

- 1:1 player-level matching for spawns. It erases the reward for getting stronger —
  spawn levels use a sub-1 ratio of party level, floored and capped by their own band.
- Live mid-floor rescaling of already-spawned mobs.
- Uncapped scaling curves of any kind.
- Raising the HP scale.
- Nerfing potion healing or potion cooldown.
- Softening the death penalty.
