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
- `npm run verify:fairies` — the fairy rules below, plus spawn tables, boss healers
  and flight.

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
  in `HITS_TO_KILL_MIN`–`HITS_TO_KILL_MAX` blows (a fairy in up to
  `FAIRY_HITS_TO_KILL_MAX`; see Fairies). At levels a floor has tracked the
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
  it flutters away at its top speed, `FAIRY_MAX_SPEED` (0.85 × `PLAYER_SPEED`), which
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
  the lab, `CircusQuestSystem` for Heather's and Terror's grounds. Positional, not
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
    companion, Mongo and every hireling leave it before the ball comes down —
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
  a chance designed off (floor 1 before the Hoarder, floor 1's healer) stays off, and no
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
- **The Smush never hurts a fairy.** A fairy inside the blast takes no damage, stun,
  knockback or status, and shows "Dodge" instead.
- **Freeze never guarantees a fireball.** `FROZEN_FRAMES + ceil(blast radius px /
(PLAYER_SPEED × CHILLED_MOVE_SPEED_FACTOR)) < FIREBALL_FUSE_FRAMES` (blast radius
  is `FIREBALL_BLAST_RADIUS_TILES` in tiles): a crawler frozen the instant a charge
  lands thaws and clears the blast, walking at the chilled pace, before it goes off.
  The walk is measured at the chilled speed, not full speed, because
  `FREEZE_GRACE_FRAMES` blocks only a second freeze — an ice bolt can still re-chill
  the crawler on the way out. A frozen crawler's in-progress swing is abandoned
  (`abandonSwing`), not merely paused.
- **Flat bursts price outside the level-ratio trend.** The fireball's landed blast
  (`FIREBALL_BLAST_DAMAGE`), the death flame's tick (`DEATH_FLAME_TICK_DAMAGE`) and
  the death explosion (`DEATH_EXPLOSION_DAMAGE`) are flat, undodgeable-once-inside
  damage under P2, and are priced as a flat radial burst rather than held to the
  HP-share trend a regular attack is. The death flame never applies burn — only the
  landed blast can roll `FIREBALL_BURN_CHANCE`.
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
- **Fairy rooms are a deliberately brutal encounter class.** A room, rate-upgrade room
  or floor-3 roaming pair that rolled fairies is priced apart from the ordinary fights
  and is exempt from the ordinary room band and the hard floor: it is meant to be the
  hardest regular fight on its floor, and several of its fights cost the reference
  party standing and trading blows more than its whole pooled HP — floor 3's roaming
  pair with a fairy deals about two party wipes on normal, and floor 2's rooms past the
  Ball of Swine's safe room nearly two and a half early in the floor. The counterplay the price
  leaves out is what makes the class winnable: **kill priority** — a warded body is
  invulnerable only while its shield fairy lives, so the shield fairy dies first and
  the wall comes down with it — and the potions and retreats the pricer never credits.
  The gate does not price chasing a fleeing fairy: a fairy left alone runs for the next
  room, and running it down drags the party into that room's fight with the fairy
  still casting, so a real fight is harder than its priced cost, not easier. A fairy
  carries more health than its host (`FAIRY_BASE_HP_FRACTION`), which puts it a blow
  past the ordinary hits-to-kill limit early in a floor's window; it is held to
  `FAIRY_HITS_TO_KILL_MAX` (8) instead. A fire fairy's twin lob is priced as one ball
  at each crawler, since the reference party has both in the fight. A necro fairy's
  bodies are priced as real lesser sword skeletons and archers, each from the frame it
  is on its feet: its `NECRO_ARMY` climbs out as the fight opens and each place in it is
  refilled on the fairy's own countdowns while it lives, its `NECRO_DEATH_ARMY` climbs
  out on its death, and every room mob that falls while it lives stands back up at
  `RESURRECT_HP_FRACTION` on the raise cooldown, once — so the kill order decides how
  many bodies it adds. Its shove is not priced.
  `verify:difficulty-curve` reads the class in **party wipes** — pooled max HP lost,
  not stopped at an empty bar — because HP remaining stops at zero, and a floor of zero
  cannot fail. Its band:
  - at most `FAIRY_ROOM_FIGHT_WIPES_MAX` (2.7) wipes on normal and
    `HARD_FAIRY_ROOM_FIGHT_WIPES_MAX` (6) on hard, just above the harshest fight priced
    plus its recorded-cost tolerance;
  - each fight within `FAIRY_FIGHT_COST_TOLERANCE` (±10%) of its own recorded cost on
    normal and on hard, both ways, so fairy fights can neither quietly get harsher nor
    quietly go soft;
  - the fairies themselves adding at least `FAIRY_ROOM_FIGHT_FAIRY_COST_MIN` (0.2)
    wipes over the same rolls with the fairies left out.
- **Support fairies are priced by the time they add.** A fight with a shield, healing
  or necro fairy is played out on a clock over sampled kill orders, with the party
  finishing one body before starting the next unless a ward lands on it first. A
  shield fairy lays nothing before the fight: its first ward goes up as the fight
  opens and one more every between-casts cooldown until it holds `shieldWardCount`,
  each on an unwarded ally drawn at random, so unwarded allies can be struck down
  meanwhile. A warded body cannot be struck down while its shield fairy lives, so the
  fairy dies before any body it wards. A
  healer's living heals (`healingFairyHealAmount` on `healingFairyCooldownFrames`,
  started once the struck body is under `HEAL_TRIGGER_HP_FRACTION` and landing only if
  it is still alive), the healer's death-wave overheal (`OVERHEAL_MAX_HP_FRACTION` of
  each standing non-boss's max HP), and the shield fairy's death aegis are charged as
  the time they add. A room is taken to be small enough that every support reaches
  every ally.

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
