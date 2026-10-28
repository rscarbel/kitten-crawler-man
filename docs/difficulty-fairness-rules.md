# Difficulty: fairness rules

The game applies real pressure — fights that can be lost, potions that get used.
Frustration is kept out by the rules below, not by keeping enemies weak. They are
labelled **P1–P6** so code comments and review notes can name one without restating it.

Headless gates hold the behaviour rules. Each runs against the game's own exported
constants, functions and creature classes rather than a copy, so a retuned formula
either still satisfies the rule or fails the script:

- `npm run verify:difficulty` — P2 (telegraph floor, projectile caps, bombers,
  dynamite) and P5, plus the cadence curve, walk-speed caps and spawn level bands.
- `npm run verify:bounty` — the bounty rules under P1: every staged bounty mob carries
  the per-blow cap and no blow it lands exceeds it, and the encounter commits a
  stagger apart.
- `npm run verify:tactics` — P6: which mobs learn a trait, how likely, and how each
  learned behaviour is bounded once running.
- `npm run verify:fairies` — the fairy rules below, plus spawn tables, boss healers
  and flight.

Balance — how much of the party's HP a fight costs, how long a kill takes — is tuned
by playtest, and no gate holds it: a scripted party never plays as well or as
strategically as a person, so what it loses says little about how hard a fight feels.

---

## P1 — Pressure, not sponge

A regular fight should cost an on-schedule party roughly the same _share_ of its HP
at every level, drifting slowly upward — never climbing into a wall. Mob stats may
grow only as fast as the player's own one-point-per-level growth answers them; the
rest of the rising challenge comes from how **often** and how **well** enemies attack
(P6), never from time-to-kill bloat, which reads as grind rather than challenge.

Every per-level curve — HP, damage, walk speed, projectile speed, cadence — lives in
`src/creatures/mobLevelScaling.ts`, each with its own named ceiling on the multiplier
(`MAX_MOB_HP_MULTIPLIER` and siblings) that caps the curve whatever level a mob is
given, independent of the spawner's level cap. `Mob.applyMobLevel`, `Mob.scaledDamage` and
every boss, summon and quest system that levels a mob read these functions; nothing
rolls its own level arithmetic.

**A floor's own curve.** A floor may level its mobs on a different HP and damage
curve than the shared one: `LevelDef.levelledCurve`, a `LevelledCurve` in
`mobLevelScaling.ts`, handed to `applyMobLevel` at every spawn site and inherited by
anything spawned at another mob's level. A level-1 mob is the same on every curve.
Floor 1 is the one floor that uses it: it keeps `LEARNING_FLOOR_LEVELLED_CURVE`, the
steeper, rounded-up curve it was tuned on, so none of its fights moved when the shared
curve was flattened for the deeper floors.

The HP and damage rates are tuned by playtest toward that flat share. A player who
spent points badly should struggle, never be locked out.

**Bounties, absolutely.** Bounties are where the level multiplier bites hardest —
escorts spawn at the party's own level, the mark a level above — so every bounty mob
carries a per-blow cap (`Mob.blowCapShareOfTargetHp`, set to
`BOUNTY_MAX_BLOW_HP_SHARE` by `stageBountyEncounter` in `src/systems/BountySystem.ts`),
applied after the difficulty scale and after the struck crawler's status scale
(`Player.incomingDamage`): no single blow from the mark, its escort or its summons
takes more than that share of the struck crawler's full bar, whatever the curve does,
and a curse that multiplies incoming damage cannot carry a capped blow past it. An encounter commits one member at a time (`StaggeredCommit`,
`src/systems/bountyCommit.ts`), so a mirrored pair of escorts never lands its first
blows on the same frame. `verify:bounty` asserts both.

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
  The per-mob fight is unchanged, so every one-on-one fight stays as authored.
- **Higher levels** — `ambientTracking`: every ambient band slides up so its rolls
  land `levelsBehind` under the party's earned level, never past the floor's
  `maxLevel` (`partyTrackedBand`). The step back softens the arrival, where every
  band's top sits well under what the party has earned. The ceiling sits where
  no tactics trait has reached its cap yet, leaving the top of every ramp to bounty
  escorts.

A party still inside a band meets it exactly as authored either way.

**XP pays for levels at the floor's own rate.** A floor's `xpDiminishingTiers` apply
to every XP award earned there — kills, bosses and quest rewards alike — and
`Player.gainXp` prices each level at the tier of the level being bought. A single
large award therefore buys what the same XP earned kill by kill would, and cannot
carry a crawler past a floor's tiers at full value. Every award goes through
`awardXp` (`src/core/progression/awardXp.ts`), which announces the level-up, and every party is
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

**Statuses that scale incoming damage.** A status changes the damage its carrier
takes only through the `incomingDamageScale` of its entry in `STATUS_DEFS`
(`src/core/combat/StatusEffect.ts`), keyed by every status id, so a new status cannot
ship without saying. Crawlers and mobs read the same table. The wheel's double-damage
curse (`double_damage`, `DOUBLE_DAMAGE_SCALE` for `DOUBLE_DAMAGE_FRAMES`) is the one
crawler-side entry above 1, and it multiplies every source: mob blows, status ticks,
hazards and the wheel's own Take Damage wedge. `Player.incomingDamage` applies the
difficulty scale, then the status scale, then the source's per-blow cap, so the cap
always has the last word. The wheel's Take Damage wedge
(`src/systems/casino/wheel/wheelPenalties.ts`) goes through `Player.takeDamage` with a
`floorHp` of one HP: it hurts, but never kills.

**Blood vomit costs nothing.** The blood-vomit status is a single retch
(`BLOOD_VOMIT_RETCH_FRAMES`) that a crawler plays on entering the `retch` band of
`CRAWLER_HP_THRESHOLDS` (`src/core/combat/hpThresholds.ts`). It deals no damage, is not
saved and shows no HUD pill; it is a warning that the next blow may be the last. It
fires once per entry into the band and re-arms only once HP rises back above it.
`verify:wheel` asserts the double damage and the retch.

### Dynamite

A stick is a burst item bought and found at a flat price, so it has to stay worth
throwing on every floor without turning any fight into a shopping list. `DYN_DAMAGE`
(`src/systems/DynamiteSystem.ts`) sets what an untrained level-1 stick does, to
enemies and crawlers alike; its enemy damage then grows with the thrower's level
(capped where mob health stops growing) and with each Explosives Handling level. The
limits on it live in `scripts/verify-difficulty.ts`, under _explosives handling_:

- **`ON_CURVE_BLAST_MAX_OVERKILL`** — one stick at on-curve Explosives Handling deals
  at most this many times a same-floor regular's health. It keeps a trained stick a
  heavy hit rather than a blast that clears a room several times over.
- **`BOSS_MIN_STICKS_ON_CURVE`** — every arena boss and bounty mark takes at least
  this many separate blasts to kill at on-curve Explosives Handling, across the
  party levels from floor 2 to past the boss level cap. A boss fight is decided by
  how it is played, not by how many sticks were bought.
- **`BOSS_MIN_STICKS_ALL_IN`** — the same floor for a thrower who put every level-up
  point into Explosives Handling. The heaviest investment buys a much faster kill,
  never a one-stick one.
- **`ESCORT_MAX_HP_SHARE_PER_STICK`** — one untrained stick deals at most this many
  times a tougher bounty escort's max HP. A single stick may kill a light escort
  outright; it may not gut a tougher one several times over.

Alongside those, the same section holds that an untrained stick still takes a
meaningful share of a same-floor regular, that every Explosives Handling point
raises enemy damage, that an on-curve stick hurts enemies well beyond what it does
to the crawlers, and that a boss never takes less from a stick than a crawler does.
Gate: `npm run verify:difficulty`.

## P3 — Death stays generous

Checkpoint restore, no XP or coin loss, full-HP respawn. Cheap retries are the
counterweight that lets the fights themselves be hard.

## P4 — Tune with data

`?difficulty` boots the run-scoped counters in `src/core/difficulty/DifficultyStats.ts`. They are
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

## The crawlers' stats

Both crawlers carry the same six stats (`ALL_STATS` in `src/core/party/stats.ts`, in the
order every stat list shows them) and may put level-up points into any of them:

| Stat                | Code  | Ryan per point | Belle per point | What it grows                                                                                     |
| ------------------- | ----- | -------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| Health              | `HLT` | 2              | 1               | max HP (`HEALTH_HP_PER_POINT`, one HP a point) and HP regen                                       |
| Melee               | `MEL` | 1              | 1               | melee and claw weapons, bare fists and claws, Seismic Stomp                                       |
| Magic               | `MAG` | 1              | 1               | spells and magic weapons, Energy Shield, magic resistance, magic-attuned recharges               |
| Evasiveness         | `EVA` | 1              | 2               | dodge chance                                                                                      |
| Ranged              | `RNG` | 1              | 1               | non-magical ranged weapons (the sling's damage and range)                                         |
| Explosives Handling | `EXP` | 1              | 1               | thrown explosives' damage to enemies and throw length                                            |

The gains are `STAT_GAIN_PER_POINT`, a `Record` over stats and crawlers, and every
source of stat points (level-ups, the Drill Yard, stat-boost potions, gear) pays each
crawler that gain. `STARTING_STATS` sets where each crawler starts: Ryan with 10 HP and about a 10% dodge,
Belle with 6 HP and about a 28% dodge. Which stat a weapon grows with is its delivery's entry in
`DELIVERY_STAT`, never per-item code, and its tooltip says "Scales with" that stat. HP
regen is one formula for both (`crawlerRegenHpPerSecond`), saturating in health.

**Dodge approaches a soft limit** (`src/core/combat/dodge.ts`):

- `computeDodgeChance` takes evasiveness through
  `DODGE_SOFT_LIMIT[crawler] * (1 - exp(-evasiveness / EVASIVENESS_DODGE_SCALE))`, with
  soft limits of 0.45 for Ryan and 0.65 for Belle. The scale puts 100 evasiveness (100
  points for Ryan, 50 for Belle) at 95% of the limit; points past that return very
  little. Gear evasiveness feeds the curve.
- Flat bonuses add after the curve: gear dodge chance, Cat-like Reflexes and `!lucky`'s
  `LUCKY_DODGE_CHANCE_BONUS`. They can carry a crawler past her soft limit.
- `DODGE_CHANCE_CAP` (0.75) is the hard ceiling over everything, so some blows always
  land. It sits above Belle's soft limit so her gear still counts.

**Magic resistance is scaled by Magic.** `'magic'` is a `ResistanceType`. A mob's spell
(`Mob.dealSpellDamage`, which marks its `DamageSource` as `magic`) and a spell hazard
(`HAZARD_IS_MAGIC`: the Lich's firewalls and orbs) are turned aside by magic-resistant
gear in `Player.incomingDamage`, for every caller. The share it turns aside is `magicResistedShare(magic)`: `MAGIC_RESIST_BASE_SHARE` at starting Magic, plus
`MAGIC_RESIST_SHARE_PER_MAGIC` a point, capped at `MAGIC_RESIST_MAX_SHARE`
(`src/core/party/crawlerFormulas.ts`). A magic status loses the same share of its length
(`Player.magicResistedFrames`), and a chill the same share of its slow: the ice fairy's chill and freeze, the fire fairy's
burn, the Skeleton Lord's and the Lich's stuck hands. A magic-attuned relic's recharge
shortens with its wearer's Magic down to `MAGIC_RECHARGE_MIN_SCALE` of its own. Every
one of these is capped.

**Proficiency skills follow one curve.** The eight proficiency skills
(`PROFICIENCY_SKILL_IDS` in `src/core/skills/proficiency.ts`) top out at
`PROFICIENCY_MAX_LEVEL` (50). `proficiencyEffect(level)` is 0 untrained, about 1% at level
1 and `PROFICIENCY_EFFECT_CAP` (30%) at the ceiling, each level worth a little less
than the last. The bonuses (Swordsmanship, Archery, Clawmanship, Magic Eye, Mechanical
Fist, Blunt Proficiency, and the damage halves of Pyro's Touch and Demolitionist) apply to
any hit carrying one of the skill's tags (`PROFICIENCY_SKILL_TAGS`), and bonuses from
different skills on one hit add. The reductions use the same curve: Pyro's Touch
shortens burns on its owner, and Demolitionist softens the owner's own blasts on the
party. Uses level a proficiency on a slow curve of their own (`PROFICIENCY_BASE_USES`,
`PROFICIENCY_USES_EXPONENT`), meant to take a whole run to reach the ceiling.

**Reward chests pay by rarity.** A chest's coins are rolled from its rarity's range and
multiplied only by the recipient's worn coin bonus. Nothing about how a run is going
raises or lowers a payout.

## Story talks halt the world

While a cutscene's conversation is open (Dave's story talk, his debrief, a tutorial
talk), the world halts: the floor's collapse timer and every mob stop. A talk opened by
a cutscene can neither be dismissed nor walked away from, so the halt never strands the
party mid-fight. The walk-up before it runs with the world ticking, which is safe
because a safe room already keeps hostiles out. Caroline's messages do not halt the
world; they wait until no hostile is fighting a crawler outside a safe room
(`CutsceneDirector`, `StoryDelivery`).

## Fairies

A fairy rides along with a room's own population rather than replacing it, so every
rule above still holds for the mobs it accompanies; these rules cover what the fairy
itself adds. `npm run verify:fairies` asserts all of them, plus spawn tables, boss
healers and flight.

- **A fairy keeps its distance, and is always catchable.** Every fairy hovers away
  from every living member of the party within notice range — both crawlers, the pet
  and hirelings — preferring spots with a living non-fairy ally between it and them
  (`FAIRY_COVER_BONUS_TILES`), and backs off within a few frames when one closes in:
  its hover goal is re-chosen early once a threat closes on it by
  `FAIRY_THREAT_SHIFT_REPLAN_TILES`, with a switch margin so a crawler pacing at the
  range boundary cannot make it jitter. Within `FAIRY_FLUTTER_RANGE_TILES` of a threat
  it flutters away at its top speed, `FAIRY_MAX_SPEED` (0.85 × 0.7 = 0.595 × `PLAYER_SPEED`; the shield fairy alone
  keeps the unslowed 0.85, `SHIELD_MAX_SPEED`), which
  levelling can never raise: a crawler who commits to the chase always closes the gap.
  Hover goals never land on marked ground, walls, or ground a fairy may not be placed
  on (inside the town wall, the town's safe radius, the circus grounds) — except a
  healer bound to a boss (`Fairy.isHoverGoalAllowed`), which is exempt from that
  ground restriction, since its boss's own room or arena may sit on it.
- **A fairy left alone runs for the next room.** With no living non-fairy hostile
  within `FAIRY_ALLY_SEARCH_TILES` (other fairies do not count) and the party in
  sight, a fairy runs for another room (`chooseFairyRefuge`): one within the path
  search's reach, preferring rooms that still hold hostiles, never one with no route
  to it or whose route (`map.findPath`, judged tile by tile, with
  `ROUTE_GRID_SLACK_TILES` of grid slack) comes within
  `FAIRY_REFUGE_PARTY_CLEARANCE_TILES` of the party any closer than the fairy already
  stands. On open ground it runs for the nearest other hostile group
  instead. It stops running on arrival or once an ally is within
  `FAIRY_REFUGE_JOIN_TILES`, and gives a refuge up if it stalls. With nowhere to run
  it keeps `FAIRY_LONE_RANGE_TILES` from the party, inside the reach of its own casts.
  A running fairy still casts, on the move. A boss's healer never runs: it keeps its
  distance inside its boss's sealed room or arena, within
  `FAIRY_BOUND_HEALER_LEASH_TILES` of the boss. A checkpoint rewind returns a fairy
  that ran to its spawn.
- **A boss-room healer never leaves the room, whatever else is true of it.** Every
  healer standing in a boss room or the colosseum arena is confined to it
  (`Fairy.confineTo`/`respectsConfinement`) by whichever room owns it — `BossRoomSystem`
  for a gauntlet boss's room, `ArenaSystem` for the ring (a circle, not a rectangle: see
  `docs/town.md`'s cousin note on the colosseum's own shape), `SpiderQuestSystem` for
  the lab. Positional, not
  bond-based: a healer stripped of its bond to a dead boss, or with no bond at all, is
  held exactly the same as one still healing a live fight — before, during and after,
  whether the boss is alive or dead. Confinement rules out every way a healer could
  otherwise cross the boundary: its hover goals and its refuge search
  (`Fairy.isHoverGoalAllowed`, `refugeQuery`) only ever offer a point inside the room,
  and a hard position clamp — the same shape as the room, applied every frame after AI
  and knockback resolve — catches whatever a shove or a stray teleport might otherwise
  carry across it.
- **A fairy never stands still to cast.** Every cast resolves on the frame it is
  chosen, and its row plays out over `FAIRY_CAST_RECOVER_FRAMES` while the fairy keeps
  moving. Support casts (`WARD_CAST`, `HEAL_CAST`, `NECRO_RESURRECT_CAST`,
  `NECRO_SUMMON_CAST`) have nothing to dodge, so they need no telegraph and nothing
  interrupts them. The offensive casts carry their telegraph in the world instead of in
  a windup:
  - the **ice bolt** (`ICE_BOLT_CAST`) flies dead straight at where the crawler stood
    when it was loosed, with no lead, at a fixed `ICE_BOLT_SPEED` =
    `ICE_BOLT_SPEED_FRACTION_OF_PLAYER` × `PLAYER_SPEED`. The fraction is under one and
    does not scale with level — P2's projectile-speed cap — so from its firing range a
    sidestep always escapes it, and walking straight away escapes it only while the
    crawler is unchilled: a chilled crawler walks at `CHILLED_MOVE_SPEED_FACTOR` × its
    speed, under the bolt's fraction. It stops at the first wall and
    strikes only the first party member it meets, never a mob. The bolt is owned by
    `FairySystem`, so one in flight outlives the fairy that loosed it.
  - the **fireball** (`FIREBALL_CAST`) is thrown at the crawler's feet with its landing
    fixed on the throw frame, and the blast's full red danger circle (filling as the
    ball comes down) marks that spot for the whole `FIREBALL_FLIGHT_FRAMES`, never
    under `LOCKED_TELEGRAPH_MIN_FRAMES`, then a fuse with its own danger circle. The
    flight outlasts a reaction and a walk out of the circle:
    `FIREBALL_DODGE_REACTION_FRAMES + ceil(blast radius px / PLAYER_SPEED) <
FIREBALL_FLIGHT_FRAMES`, so a crawler standing dead on the landing who starts
    walking half a second after the throw is outside the blast radius when it lands.
    One cast throws a ball at each crawler the fairy may lob at (alive, in range and
    sight, outside the town's safe zone), each on that crawler's own feet, on one
    cooldown. From the throw on, every landing is marked ground
    (`GroundHazardSource`, widened by `FIREBALL_HAZARD_MARGIN_TILES`): the AI
    companion, the Deinonychus and every hireling leave it before the ball comes down —
    following, fighting, recalling or mid-swing alike — are steered out of every
    overlapping circle at once rather than out of one into another, and take no
    step back onto it until the charge has gone off.
  - the **telekinetic wave** (`NECRO_TELEKINETIC_CAST`) is exempt from the telegraph
    rule: it deals no damage and applies no status, only a knockback from where the
    fairy is on its release frame, and never through a wall. Its recharge,
    `TK_COOLDOWN_FRAMES`, is flat rather than level-scaled: the wave's rhythm is part
    of what makes it readable.
- **A shield fairy's ward is invulnerability, and its counterplay is the fairy.** A mob
  holding a shield fairy's ward takes no damage from any source for as long as that
  fairy lives (`Player.isHeldInvulnerable`), and a struck ward-holder shows
  "Invulnerable" (throttled, so a flurry does not stack) — except on easy, where
  `DifficultyProfile.wardDamageReduction` lets a quarter of the blow through and the
  label reads "Resist" instead; normal and hard keep the ward absolute. Either way, a
  crawler whose blows keep landing on a warded body without doing their job is told
  why: after `WARD_EXPLAINER_HIT_THRESHOLD` such hits in one floor,
  `Player.noteWardBlockedHit` fires an explainer bark naming the shield fairy, once per
  floor per crawler. A fairy holds at most
  `shieldWardCount` wards — its potency plus `SHIELD_EXTRA_WARDS`, the potency ceiling
  included — one fairy ward per mob, and lays a new one on another ally every
  `SHIELD_BETWEEN_CASTS_FRAMES` when a warded ally dies or leaves. No grub of any stage
  ever takes this ward (`BrindleGrub.acceptsWards` is false): a shield fairy instead
  turns its rarer, longer-cooldown crushing ward on a hatched Brindled Vespa in reach,
  which snaps shut over `SHIELD_CRUSH_IMPLODE_FRAMES` and kills it outright, crediting
  no player kill. It lays no ordinary ward
  before it is seen, and none while it is off screen: every cast waits until the fairy
  is on screen (`Fairy.isOnScreen`) — its body at least half a tile inside the camera
  view the scene publishes each frame (`setVisibleWorldView`) and inside the fog's
  clear disc — so the player sees each ward land and hears its sound. The view is the
  real camera on the live window, the one following the active crawler, pinned at map
  edges as drawn: a desktop window watches from much farther than a phone, which is
  the point — a fixed radius small enough for every phone would let a desktop player
  stand in plain view of the fairy and never be warded against. Walls are not
  consulted: the view is top-down, so a fairy past a wall but on screen is in plain
  sight. With no view published, nothing counts as on screen. Wards already laid stay
  up while nobody watches. No ward is ever laid
  on a shield fairy (`canTakeWardFrom` refuses one whatever candidate list asked): two
  shield fairies warding each other would both be invulnerable forever. The wards come
  off on the frame the fairy dies, and its death aegis (`AEGIS_DAMAGE_SCALE` on every
  standing body for `AEGIS_DURATION_FRAMES`) follows; an in-flight crush is cancelled
  the same frame rather than finishing on its own.
- **Healers cost time, not blows.** `healingFairyHealPerSecond` never exceeds
  `HEAL_MAX_SHARE_OF_PARTY_DPS` of the reference party's damage per second, on any
  target, at any level: the per-heal amount is a share of the target's max HP
  (`HEAL_FRACTION_OF_TARGET_MAX_HP`, cut to `BOSS_HEAL_SCALE` of that on a boss) capped
  by `HEAL_AMOUNT_CAP_BASE` scaled through `hpScaleForLevel` on the healer's own curve,
  and the cooldown alone spaces the heals. A heal never lifts a target past its own
  `fairyHealCeiling`, so it can never carry a boss back over a phase threshold the
  party already fought it past. The healer's death wave (`applyHealingWave`) skips any
  target that `isBoss`. A healer off screen heals, and its death wave heals, exactly
  as on screen, but neither makes a sound: only on screen are the heal's bloom and the
  wave's chime played.
- **A fairy is sturdier than its host.** A fairy's base HP is `FAIRY_BASE_HP_FRACTION`
  (1.2) of its floor's typical host (`FAIRY_TYPICAL_HOST_HP_BY_FLOOR`), levelled on
  the same curve, so the share holds at every level — boss healers and cheat-spawned
  fairies included.
- **Fairy chances sit 15 points above their design rates.** Every enabled fairy chance —
  room rates per region and difficulty, the Ball of Swine's upgrade, the room healer, and
  floor 3's scatter fairy and scatter healer — is its design rate plus 0.15, held to 1;
  a chance designed off (floor 1 before the Trash Gremlin, floor 1's healer) stays off, and no
  count range moves (`verify:fairies` spawn rules).
- **Every fairy group has a shield fairy.** Wherever a room, a rate-upgrade top-up or a
  floor-3 scatter point leaves at least one fairy (a healer included) and none is a
  shield fairy, one more shield fairy is added (`needsGuaranteedShield`), on every
  difficulty alike, outside the rolled count and `MAX_FAIRIES_PER_ROOM`. A boss's
  healer never brings one.
- **The Ball of Swine's upgrade reaches only the rooms past it.** Its upgraded rates
  apply only to the rooms the floor's start cannot reach without crossing the safe room
  guarding the Swine (`onlyPastItsSafeRoom`, `pastSafeRoomTest`) — the pocket behind
  the arena. Every earlier room keeps its base rate for good. The Swine is optional:
  the pocket is reachable round the arena, and its rooms keep their base rates until
  the Swine dies.
- **The Seismic Stomp never hurts a fairy.** A fairy inside the blast takes no damage, stun,
  knockback or status, and shows "Dodge" instead.
- **Freeze never guarantees a fireball.** `FROZEN_FRAMES + ceil(blast radius px /
(PLAYER_SPEED × CHILLED_MOVE_SPEED_FACTOR)) < FIREBALL_FUSE_FRAMES` (blast radius
  is `FIREBALL_BLAST_RADIUS_TILES` in tiles): a crawler frozen the instant a charge
  lands thaws and clears the blast, walking at the chilled pace, before it goes off.
  The walk is measured at the chilled speed, not full speed, because
  `FREEZE_GRACE_FRAMES` blocks only a second freeze — an ice bolt can still re-chill
  the crawler on the way out. A frozen crawler's in-progress swing is abandoned
  (`abandonSwing`), not merely paused.
- **Flat bursts stay flat.** The fireball's landed blast (`FIREBALL_BLAST_DAMAGE`),
  the death flame's tick (`DEATH_FLAME_TICK_DAMAGE`) and the death explosion
  (`DEATH_EXPLOSION_DAMAGE`) are flat, undodgeable-once-inside damage under P2, and
  never scale with level. The death flame never applies burn — only the landed blast
  can roll `FIREBALL_BURN_CHANCE`.
- **The lob's flight speed is fixed, not level-scaled.** A fireball always flies the
  same `FIREBALL_FLIGHT_FRAMES`, and its throw range is clamped to
  `FIREBALL_MAX_RANGE_TILES`, so its horizontal speed never grows with level. The dodge
  is stepping out of the marked circle before the ball comes down, not outrunning it
  in flight.
- **Necro skeletons are bodies, not an XP source.** A necro fairy's skeletons rise
  `NECRO_SKELETON_LEVELS_BELOW_FAIRY` levels under the fairy, at
  `NECRO_SKELETON_STRENGTH` of a skeleton's authored HP and damage
  (`Mob.raiseAsLesser`), swords and archers alike, whether summoned in life or left
  behind on death. They pay no XP or coin (`paysRewards` is false on anything raised
  this way), and a resurrected mob pays nothing on its second death either — a necro
  fairy is a harder fight, never a farm.
- **A necro's army is fixed in shape; its raises are limited per body, not per life.**
  It fields `NECRO_ARMY` (two sword skeletons and an archer) once a crawler it has
  noticed is within `NECRO_SUMMON_TRIGGER_TILES`, and refills to that shape — never
  past it — `NECRO_RESUMMON_LAST_STANDING_FRAMES` after it is down to its last
  skeleton, or `NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES`–`NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES`
  after the whole army falls; an army down one of three is not refilled. One raise
  stands up every eligible corpse in range and sight at once, however long ago it
  fell, and a mob is raised at most once ever — never a boss, a boss's add, a summon
  or a fairy. Its death leaves `NECRO_DEATH_ARMY` by the difficulty stamped at spawn:
  four swords and two archers on easy and normal, seven and three on hard. It raises
  and summons only while it is on screen, by the same test as the shield fairy, so
  the player watches every body stand up; a refill that comes due off screen is held
  and called the first frame the fairy is back in view. The telekinetic shove needs a
  crawler within reach and is not held. The counterplay is kill priority: no refill or
  raise outlives the fairy, and the death army is the price of taking it.

## Bomber goblins

The Dynamite Goblin and the Black Powder Goblin (`src/creatures/GoblinBomber.ts`)
lob explosives that `GoblinBombSystem` carries from the throw to the blast. Their
sizes live in `src/systems/goblinBombConstants.ts`, and everything about their
timing and AI that the difficulty decides lives in its `BOMBER_TUNING`, one
`BomberTuning` per difficulty, read live through `activeBomberTuning()`: a
difficulty changed mid-run applies on the next frame, while a stick already
thrown keeps the flight and fuse it was thrown with. Like the fairy fireball, the
dodge is leaving the marked circle in time, never outrunning a projectile.

On Crawler and Nightmare the bombers are among the harder regulars on a floor:
every window leaves a crawler who reacts in half a second well under a second to
spare. On Kitten they keep the slower, plainer mechanics they first shipped with.
The blast's damage is the same on every difficulty.

| `BomberTuning` field                                      | Kitten           | Crawler / Nightmare |
| --------------------------------------------------------- | ---------------- | ------------------- |
| `dynamiteFlightFrames` / `blackPowderFlightFrames`        | 42 / 48          | 35 / 40             |
| `fuse` (frames, final stretch)                            | 120, 40          | 93, 32              |
| `bombardierLockFrames`                                    | 36               | 30                  |
| `actionFrames` light / throw, dynamite                    | 30 / 24          | 23 / 19             |
| `actionFrames` light / throw, black powder                | 40 / 28          | 31 / 22             |
| `throwCooldownFrames` dynamite / black powder             | 150 / 180        | 110 / 135           |
| `walkSpeed`, `maxSpeedRatio`                              | 1.2, 0.7         | 1.45, 0.75          |
| `retreatSpeedRatio`                                       | 0 (its own walk) | 0.8                 |
| `retreatMaxFrames` / `retreatCooldownFrames`              | 70 / 150         | 80 / 120            |
| `interruptedRecoveryFrames`                               | 45               | 38                  |
| `aimLeadShare` dynamite / black powder, `maxAimLeadTiles` | 0 / 0, 0         | 0.5 / 0.4, 2        |
| `closeMoves`                                              | no               | yes                 |
| `throwsWhileRetreating`                                   | no               | yes                 |

The Dynamite Goblin keeps at most `DYNAMITER_MAX_LIVE_STICKS` (2) of its own sticks
live on every difficulty, a dropped stick included.

- **The lob's flight is fixed, not level-scaled.** A stick always flies
  `dynamiteFlightFrames` and a bomb `blackPowderFlightFrames`, and every throw is
  clamped to `GOBLIN_BOMB_MAX_RANGE_TILES`, so horizontal speed never grows with
  level (P2).
- **Throws are led on Crawler and Nightmare.** A stick is aimed `aimLeadShare` of
  the way to where the target will be when it lands; a black powder landing that
  share of the way to where the target will be when it bursts, measured from the
  first lock frame. The lead is capped at `maxAimLeadTiles` and dropped when the
  led landing would catch the bomber. A crawler who keeps walking the same way
  walks toward the circle; the fairness inequalities below are for a crawler
  standing on the landing. On Kitten every lob comes down at the target's feet.
- **A goblin stick's fuse outlasts a reaction and a walk out of its circle, on
  every difficulty.** The stick may roll up to `GOBLIN_DYNAMITE_SETTLE_TILES` after
  it lands, so that roll is walked too: with `W = ceil((GOBLIN_DYNAMITE_BLAST_RADIUS_PX +
GOBLIN_DYNAMITE_SETTLE_PX) / PLAYER_SPEED)` (`GOBLIN_DYNAMITE_WALK_OUT_FRAMES`),
  `GOBLIN_BOMB_DODGE_REACTION_FRAMES + W < fuse.frames`
  (`goblinDynamiteDodgeMarginFrames`): about half a second to spare on Crawler and
  Nightmare, about a second on Kitten. The red danger circle fills with the fuse
  from landing to blast. A stick the goblin drops at its own feet burns the same
  fuse.
- **A black powder bomb's lock plus its flight outlast a reaction and a walk out,
  on every difficulty.** The bomb goes off the frame it touches the ground, so the
  circle drawn during the aim is the only warning. The landing is resolved on the
  first frame of the lock, not on release, and `bombardierLockFrames` is never
  under `LOCKED_TELEGRAPH_MIN_FRAMES`. With `W = ceil(BLACK_POWDER_BLAST_RADIUS_PX /
PLAYER_SPEED)` (`BLACK_POWDER_WALK_OUT_FRAMES`),
  `GOBLIN_BOMB_DODGE_REACTION_FRAMES + W < bombardierLockFrames +
blackPowderFlightFrames` (`blackPowderDodgeMarginFrames`): under a third of a
  second to spare on Crawler and Nightmare, half a second on Kitten. A bomber
  killed or staggered mid-aim throws nothing and its circle goes with it, and a
  lock it was shoved toward is not thrown.
- **Closing in is not a safe answer on Crawler and Nightmare.** Inside its band a
  bomber backs off at `retreatSpeedRatio` of the player's speed for a limited
  budget, and still throws whenever a lob would land clear of itself. A crawler in
  its face meets its close-range move, once per `CLOSE_MOVE_COOLDOWN_FRAMES`: the
  Dynamite Goblin drops a lit stick half a tile toward the crawler and scurries out
  of its circle; the Black Powder Goblin hops nearly three tiles back and locks at
  once, with no light row. On Kitten closing in works: the bomber backs off at a
  walk and throws nothing until the retreat ends, and it has no close-range move.
  On every difficulty its levelled walk is capped under the player's
  (`maxSpeedRatio`), so a crawler who commits to the chase catches one once its
  retreat runs out.
- **The blast is a share of the struck crawler's own bar.** A blast takes
  `GOBLIN_DYNAMITE_HP_SHARE` or `GOBLIN_BLACK_POWDER_HP_SHARE` of each struck
  crawler's max HP (`goblinBlastDamage`), scaled by the difficulty's incoming
  damage, so the human's deep bar loses the same share as the cat's and it never grows
  with the mob's own level (P2). It is undodgeable: no dodge roll turns aside an
  explosion the crawler is standing in. Siege walls and trebuchets take a multiple
  of the blast an on-curve crawler would take at the floor's reference party level
  (`floorReferencePartyLevel`).
- **Who the blast hurts.** Both crawlers take the full blast, as do party-side
  mobs (the Deinonychus, hirelings, soldiers, thralls, converted mobs, attack cows), each the
  same share of its own max HP. A hostile that attacks other mobs on its own
  (`Mob.huntsOtherMobs`, today the Brindled Vespa) is the goblins' enemy too and
  takes the full blast. Every other
  mob, bosses and the thrower's own pack included, loses exactly
  `GOBLIN_BLAST_DAMAGE_TO_BYSTANDER_MOBS` (1 HP), credited to nobody, so a goblin
  never wipes its own band and a mob the party wore down still pays the party.
- **Knockback.** Every mob still standing inside the radius is pushed straight out
  from the centre, hardest at the centre and to nothing at the edge, through
  collision, so never through a wall. Party-side mobs are pushed too. Bosses, mobs
  that cannot walk and mobs whose movement is scripted by their own attack
  (`Mob.resistsBlastKnockback`: the Grave Bull's charge, the necromancer's standoff)
  are not. The crawlers are never pushed.
- **Allies treat both landing spots as marked ground.** From the throw on, a stick's
  landing (widened by the settle roll) and, from the first frame of the lock, a
  black powder landing are marked ground (`GroundHazardSource`, widened by
  `GOBLIN_BOMB_HAZARD_MARGIN_TILES`), whether or not a circle is drawn there. The AI
  companion, the Deinonychus, hirelings, soldiers and thralls leave every overlapping circle at
  once, never stepping from one into another, and take no step back until the blast
  has gone off, as with the fairy fireball. Hostiles, the bombers included, refuse
  marked steps the same way.

---

## The AI's interventions

Every action the AI takes (`src/ai/actions/`) passes the `ActionGovernor`
(`governor.ts`) before it runs, whatever the server already allowed. The AI may
pressure a crawler; it never ambushes a beaten one:

- **Two HP shields.** Nothing that spawns hostiles or harms the party runs while
  either crawler is down or in the low-health band (`isAtOrUnderLowHealth`, the
  same `CRAWLER_HP_THRESHOLDS.low_health` line that fires `healthLow`). During a
  fight the line rises to `HURT_IN_COMBAT_FRACTION`: a party already losing a
  fight is not piled on. Help (heals, cures, buffs) is never held back. Both lines
  are written into the tool descriptions the model reads.
- **Nothing the AI does finishes a crawler.** HP actions stop at the low-HP line,
  a health cut that would cross it is undone, and a damage-over-time status
  is refused when everything already eating the crawler's HP, scaled by any
  status that multiplies incoming damage (the wheel's double damage doubles every
  tick), would carry them under it.
- **No spawns in menus, boss fights, safe rooms or indoors**, none closer than
  `MIN_SPAWN_DISTANCE_TILES`, and every spawn levelled once inside the floor's
  own band (P5).
- **Limits.** Per-action cooldowns, per-floor caps, no stacking stat changes, and
  per-floor budgets for spawns, gifts, fines, reward chests and clock changes, kept
  across reloads and shared with every building on the floor.

## The AI's challenges

The AI may set a challenge (`offer_challenge`), held to the rules above:

- **A challenge only puts its own reward chest at stake.** It never stops the crawlers
  doing anything: drinking a potion during a no-potion challenge simply fails
  it. The worst a challenge costs is the reward and a taunt.
- **Offers are fair when made.** None while either crawler is under a quarter
  of their health, mid-fight or in a boss fight; one at a time; a few per
  floor; and each template is checked for being winnable from where the party
  stands (enough of the named creature alive, at least
  `CHALLENGE_MIN_SECONDS_PER_KILL` per kill, time for the walk to the stairs,
  no status already eating HP under a no-damage rule, a living boss for the
  potion fast). Templates and their bounds live in `src/ai/interactions/challenges.ts`;
  the clock counts gameplay frames, so it stops whenever the world does.

Gate: `npm run verify:ai-actions`.

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
- Raising the HP or damage curve to make a fight harder; raise how often and how well
  enemies attack instead (P1, P6).
- Rolling tactics traits below `TACTICS_MIN_MOB_LEVEL`, re-rolling them on a live mob,
  or letting a guard meet a spell, a status tick or a low-HP blow.
- Nerfing potion healing or potion cooldown.
- Softening the death penalty.
