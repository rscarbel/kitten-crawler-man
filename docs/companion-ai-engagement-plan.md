# Companion AI engagement plan

Four playtest reports, one investigation: the cat companion soloed the Krakaren
Clone before the player ever engaged and the silver chest never unlocked; the
human companion sprinted out of sight chasing something behind a wall on floor
2; and skill points invested in the cat's claw swipe never did anything because
the companion AI never swipes.

The investigation found **two distinct root causes plus one missing feature**,
not one bug — see §1.5 for the exact split. Every claim below is cited to the
current code.

## 1. What is wrong today (measured from the code)

### 1.1 The chest: a status-effect kill is a silent kill

> **Status 2026-08-05:** the core of this bug was fixed by another agent's
> Hoarder work, which had completed (uncommitted, but final) before this
> verification ran. The diagnosis below was confirmed correct, and the
> _reported_ scenario — a fought boss finished by a DoT tick — now unlocks the
> chest. Residual attribution gaps remain; §4 (Phase 1) has been rewritten
> around them. References in this section describe the pre-fix code (§4 gives
> the current, fixed state).

The chest is **not** gated on player engagement or player damage. No code path
gates boss defeat, chest unlock, or loot on the _human_ specifically: the only
attribution that gates loot is `topDamageDealer` (read in the `mobKilled`
handler in `wireEventBus` in `src/scenes/DungeonScene.ts`), and a cat-only kill
yields the cat, which passes. Companion damage is attributed identically to
player damage (the `damageTakenBy` map, populated in `Mob.takeDamageFrom` in
`src/creatures/Mob.ts`, and credited via `xpCreditTarget` in `resolveKills` in
`src/systems/CombatSystem.ts`).

What actually breaks the chain is the death flag:

- The whole kill pipeline hangs off `mob.justDied` (checked in `resolveKills`
  in `src/systems/CombatSystem.ts`), and `justDied` is set in exactly one
  place: the death block of `Mob.takeDamageFrom` — specifically its call into
  the private `_resolveDeath` helper in `src/creatures/Mob.ts` — which also
  sets `killedBy`, `killType` and rolls `droppedLoot`.
- Status-effect DoT ticks (burn / poison / sepsis / magic_burn / electrified)
  do not go through `takeDamageFrom`. They call the inherited
  `Player.takeDamage` (via `tickStatusEffects` in `src/Player.ts`, which calls
  `this.takeDamage`, resolving to the base `Player.takeDamage` in
  `src/Player.ts`), which zeroes HP and **never touches `justDied`, `killedBy`
  or `droppedLoot`**. Mob statuses tick every frame via the `mob.tickTimers()`
  call in `MobUpdateLoop.update` (`src/systems/MobUpdateLoop.ts`) → `Mob.tickTimers`
  in `src/creatures/Mob.ts`.
- So a mob whose last point of HP comes off a DoT tick dies with
  `justDied === false`: no `mobKilled`, no loot, no
  `treasureChests.receiveBossLoot(bossRoomIdx, ...)` (in the `mobKilled`
  handler in `wireEventBus`, `src/scenes/DungeonScene.ts`), no `bossDefeated`
  (emitted a few lines later in the same handler).
- The boss **door** still opens, because `BossRoomSystem` unlocks purely off
  `boss.isAlive` (hp > 0): the `if (!bossAlive) { state.locked = false; ... }`
  block in `BossRoomSystem.update`, reading the `bossAlive` variable computed
  just above it in the same method (`src/systems/BossRoomSystem.ts`). That
  mismatch — door open, boss visibly dead, chest locked forever — is exactly
  the reported symptom.
- `receiveBossLoot` has no fallback and fails silently: silver chests are
  created locked with `loot: null` (`addBossChest` in
  `src/systems/TreasureChestSystem.ts`), a call that finds no locked chest
  returns without a sound (`receiveBossLoot` in
  `src/systems/TreasureChestSystem.ts`), and the room-cleared auto-unlock is
  wooden-chests-only (the wooden-chest room-clearing block in `update`,
  guarded on `chest.type === 'wooden'`, in `src/systems/TreasureChestSystem.ts`).

Why a cat-carried fight hits this disproportionately: the two DoTs the party
can apply are the sepsis crown proc — applied on **cat** melee and **cat**
missiles as well as human melee (the three `makeSepsis()` proc sites in
`resolvePlayerAttacks` in `src/systems/CombatSystem.ts`) — and the level-15
magic-missile death-shockwave `magic_burn` (the `makeMagicBurn()` shockwave in
`resolveKills` in `src/systems/CombatSystem.ts`), which is cat-only. An AI cat
that pours missiles into a 200 HP boss (`KRAKAREN_HP` in
`src/creatures/KrakarenClone.ts`) is the most likely combatant in the game to
have the killing point of HP arrive on a tick.

This is the known "a status kill leaks the mob grid" defect (memory: affects
all 33 mob types, hand-patched only in isolated places — e.g. the manual
`this.justDied = true` in `updateBursting` in `src/creatures/BallOfSwine.ts`,
and the analogous fixed cases documented in the `strike` method's doc comment
in `src/systems/RockThrowSystem.ts` and the `rollContact` method's doc comment
in `src/creatures/RockGolemBoss.ts`). The Krakaren has no bespoke death path of
its own — no overrides of `takeDamageFrom`, no terminal phase
(`src/creatures/KrakarenClone.ts`) — so it rides the general one.

Downstream casualty worth naming: `krakarenBossRoomIdx` is only set from the
second `bossDefeated` handler in `wireEventBus` (`src/scenes/DungeonScene.ts`,
default `-1` at its field declaration), and the Mongo unlock keys on it (the
krakaren-boss-chest branch of the `treasureChests.setOnOpen` callback wired in
the `DungeonScene` constructor) — a silent Krakaren death also costs the
player Mongo.

### 1.2 The boss: "noticed you" is treated as "engaged you"

There is no engagement state on a boss. The pieces:

- `BossIntroSystem` is a pure overlay — no mob refs, no invulnerability, no
  engagement flag (the `IntroState` type and `BossIntroSystem.trigger` in
  `src/systems/BossIntroSystem.ts`). It is triggered as a _consequence_ of the
  room lock (the `if (this.bossRoom.newlyLockedBossType !== null)` block in
  `DungeonScene`'s `update`, `src/scenes/DungeonScene.ts`), never a cause.
- The room lock requires a **body inside the bounds**: either party member's
  tile entering the room (the `if (!state.locked && bossAlive && (humanInRoom
|| catInRoom))` block in `BossRoomSystem.update`, positions from the
  `humanInRoom`/`catInRoom` computation just above it,
  `src/systems/BossRoomSystem.ts`). There is no door: the "lock" is a post-hoc
  clamp on players, not a gate that keeps missiles out.
- The Krakaren's aggro radius is 12 tiles (`AGGRO_RANGE_TILE_MULTIPLIER` in
  `src/creatures/KrakarenClone.ts`) against a 22×18 boss room (`BOSS_ROOM_W`/
  `BOSS_ROOM_H` in `src/map/DungeonGenerator.ts`) — from the room centre it
  reaches past every wall, so it acquires a player standing in the corridor
  (`acquireTarget` needs only LOS on first pick, and `canNotice`, both in
  `src/creatures/Mob.ts`; nearest of `[human, cat]` regardless of who is
  active — both are pushed unconditionally into `playerTargets` in
  `MobUpdateLoop.update`, `src/systems/MobUpdateLoop.ts`).
- The companion veto in `CompanionSystem` then evaporates on that mere notice:
  `isUntriggeredBossRoomMob` (a local function in `updateAutoAI`,
  `src/systems/CompanionSystem.ts`) releases the mob the moment
  `m.currentTarget === human || m.currentTarget === cat` — the variable named
  `hasAttackedPlayers` actually means "has _noticed_ a player".
- Once released, in aggressive stance the cat picks the boss up via
  `mobTargetingHuman` — a `mobs.find(...)` over the whole level with **no
  distance limit** (the `mobTargetingHuman` assignment in `updateAutoAI`,
  `src/systems/CompanionSystem.ts`) — and `cat.autoFireTick()` (called from
  `updateAutoAI`) shoots it from outside the room (`CatPlayer.autoFireTick` in
  `src/creatures/CatPlayer.ts`; missile range `(3.5 + INT·0.5)` tiles × level
  multiplier — `MISSILE_BASE_RANGE`/`MISSILE_RANGE_INTELLIGENCE_MULTIPLIER`
  and the `fireMissile` range computation, both in `CatPlayer.ts`), with only
  a sight-line check.
- Because nobody crossed the bounds, the room never locks: no intro, no
  `bossFightInitiated`, no player clamp, and no abort-heal — the heal-to-full
  when no conscious player is in the room only runs on a _locked_ room (the
  fight-abort block that sets `boss.hp = boss.maxHp` in `BossRoomSystem.update`,
  `src/systems/BossRoomSystem.ts`, reached only after the earlier
  `if (!state.locked) { ...; continue; }` early-out). The immobile Krakaren
  (`KRAKAREN_SPEED = 0` and the no-op `moveWithCollision` override, both in
  `src/creatures/KrakarenClone.ts`) cannot close the gap, so it stands there
  and dies.

### 1.3 The runaway companion: the same proxy, plus no leash

Three compounding facts, all in `CompanionSystem`:

- **The LOS gate has an exemption keyed on the same "noticed you" proxy.** The
  human companion refuses targets it cannot see — _except_ a mob whose
  `currentTarget` is a party member (the `isFightingParty` check in
  `updateAutoAI`, `src/systems/CompanionSystem.ts`). The Brindled Vespa
  acquires its target by **pure distance with no LOS check** at 10 tiles
  (`VESPA_AGGRO_TILES` and the nearest-target scan in `updateVespaAI`, both in
  `src/creatures/BrindleGrub.ts` — it hand-rolls nearest-target instead of
  using `Mob.acquireTarget`). A vespa on the far side of a thin wall therefore
  targets the human, the exemption waves the wall away, and the human
  companion picks it up.
- **A held target is only ever dropped when it dies** (or turns
  `avoidInstead`, or sits in an untriggered boss room): the target-clearing
  checks at the top of the human branch of `updateAutoAI`
  (`src/systems/CompanionSystem.ts`). There is no distance-based disengage
  anywhere.
- **The chase itself is nearly unbounded**: `companionFollow` A*-paths up to
  `COMPANION_MAX_PATH_DISTANCE_TILES = 96` (`src/systems/CompanionSystem.ts`),
  deliberately so for catching up across town — but combat pursuit rides the
  same limit. A leash constant already exists — `COMPANION_LEASH_PX` (10
  tiles), `src/core/constants.ts` — and **is imported by nothing**.

So: vespa targets human through the wall → human companion acquires it sight
unseen → A* routes the long way around the wall → target never dropped until
something dies. "Ran extremely far away chasing an enemy the player couldn't
see" is this, mechanically.

The unbounded scans are also present on the passive-stance retaliation paths
(the `mobTargetingHuman` assignment and the passive-stance
`human.autoTarget = mobs.find(...)` assignment, both in `updateAutoAI`,
`src/systems/CompanionSystem.ts`, are whole-list `mobs.find` with no range
term, unlike the range-gated `findMobTargetingNearPlayer`).

### 1.4 The claw swipe: the companion AI has no melee

- The companion cat's only attack is `autoFireTick()` (called from
  `updateAutoAI`, `src/systems/CompanionSystem.ts`), which fires missiles and
  nothing else (`CatPlayer.autoFireTick` in `src/creatures/CatPlayer.ts`).
- `triggerAttack()` — the claw swipe (`CatPlayer.triggerAttack` in
  `src/creatures/CatPlayer.ts`) — is reachable only through the active
  player's Space action, and even there the active cat prefers a missile
  whenever the tome is slotted and off cooldown (`triggerPlayerAttack` in
  `src/systems/GameLoopPhases.ts`).
- Everything downstream already works for a companion swipe: `CombatSystem`
  resolves cat melee **without checking who is active** (the cat-melee block
  in `resolvePlayerAttacks`, `src/systems/CombatSystem.ts`), and both
  crawlers' `updateAttack()` tick every frame (in each scene's `update`,
  `src/scenes/DungeonScene.ts` and `src/scenes/BuildingInteriorScene.ts`). The
  human companion even has the exact precedent to copy:
  `HumanPlayer.autoFightTick()` swings on a 90-frame auto cooldown
  (`AUTO_ATTACK_COOLDOWN`) when the target is inside melee range
  (`src/creatures/HumanPlayer.ts`).
- Claw damage is `1 + strength` (`CatPlayer.getMeleeDamage` in
  `src/creatures/CatPlayer.ts` — now `1 + this.strength +
this.drunkDamageBonus`; the drunk term is 0 sober, so the claim still holds
  outside that buff), range 1.6 tiles (`MELEE_RANGE_MULTIPLIER` and
  `CatPlayer.getMeleeRange`, both in `CatPlayer.ts`) — so strength invested
  "into the claw swipe" is literally dead stat weight while the cat is the
  companion today.

### 1.5 Do the four bugs share one root cause?

**No — two root causes and one missing feature.**

- Bugs §1.2 and §1.3 **do share a root**: companion logic uses mob-side aggro
  (`mob.currentTarget`, set by proximity, sometimes without LOS) as its proxy
  for "combat is engaged", in the boss-room veto (the `hasAttackedPlayers`
  line in `isUntriggeredBossRoomMob`), the LOS exemption (`isFightingParty`),
  and target acquisition (`mobTargetingCat`/`mobTargetingHuman` and the
  passive-stance `human.autoTarget` assignment) — all in `updateAutoAI`,
  `src/systems/CompanionSystem.ts` — and then holds whatever it acquired with
  no leash.
- Bug §1.1 (chest) has a **different root** — the status-DoT silent-death path
  — but the companion bug set its stage: an AI cat free to solo the boss is
  the likeliest source of a DoT killing blow. Fixing §1.2 alone would make the
  chest failure rarer, not gone.
- Bug §1.4 is a plain capability gap in the companion AI.

## 2. Design principles

- **Engagement is harm or entry, never notice.** A mob is "in a fight with the
  party" when it has actually damaged a crawler, a crawler has actually
  damaged it, or (for boss rooms) the room has locked. A mob merely turning
  its head must not commission the companion.
- **Death bookkeeping has one choke point.** Any code path that can take a
  mob's HP to zero must produce the same `justDied`/`killedBy`/loot record.
  Fix the class of bug, not the Krakaren instance (per the standing rule that
  discovered violations are in scope).
- **Every threshold is a named constant**; no `as`, no `!`, no `any` in
  anything below.
- One behavioral change per phase, each followed by its own playtest notes —
  companion feel is exactly the kind of thing arithmetic cannot sign off, so
  each phase records what to check in-game afterward.

## 3. Phase 0 — Reproduction + verification harness

New `scripts/verify-companion.ts`, `npm run verify:companion`, modeled on
`scripts/verify-bounty.ts` (the `verify:bounty` entry in `package.json`'s
`scripts` block). Must be added to
`tsconfig.scripts.json`'s `include` list — that file is an opt-in list and an
unregistered script is never typechecked.

Assertions (headless, constructing the real classes):

- 0.1 A `Mob` brought to 0 HP by a status tick alone latches `justDied === true`
  (the concurrent fix's behavior — assert it stays fixed), and after Phase 1
  additionally records the DoT's applier as `killedBy`.
- 0.2 `isUntriggeredBossRoomMob` semantics: a boss-room mob with
  `currentTarget` set but no blows exchanged and no lock is (after Phase 2)
  still vetoed.
- 0.3 Companion target is dropped once companion↔active-player distance
  exceeds the leash (Phase 3).
- 0.4 `CatPlayer` in companion mode with an adjacent target starts a swipe
  (`attackTimer > 0`) rather than a missile (Phase 4).

- Reproduce the original report once before any fix, for a
  baseline: `npm run playtest -- krakaren` (the `krakaren` preset in
  `src/dev/playtestPresets.ts`), stand in the corridor, let the cat work.
  Confirm: cat opens fire unprompted, no intro plays, and on a DoT-assisted
  kill the chest stays locked.

## 4. Phase 1 — Status kills become _attributable_ kills (closes the rest of §1.1)

**Rewritten 2026-08-05.** The core fix this phase originally specced landed
with another agent's Hoarder rework, which was already complete when this
verification ran (edits uncommitted but final). Verified state, per stage:

| Stage                                  | Verdict          | Evidence (working tree 2026-08-05)                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `justDied` on a DoT tick               | **fixed**        | `Mob` now overrides `takeDamage`: a lethal tick calls the extracted private `_resolveDeath(null, null)` — `justDied`, loot roll, null credit (both in `src/creatures/Mob.ts`); ticks reach it via `Player.tickStatusEffects` → `this.takeDamage` (`src/Player.ts`)                                                                                                                                                                         |
| `mobKilled` / gore / grid removal      | **fixed**        | `resolveKills` no longer bails on an empty damage ledger; only the XP split is gated on `totalDmg > 0` (the `hasDamageLedger` check and the XP-split block guarded by it, `src/systems/CombatSystem.ts`), and `mobKilled` always emits (the unconditional `bus.emit('mobKilled', ...)` at the end of `resolveKills`)                                                                                                                       |
| XP split on a fought, DoT-finished mob | **fixed**        | split reads `mob.damageTakenBy` (populated in `Mob.takeDamageFrom`, `src/creatures/Mob.ts`), populated by every real blow regardless of who lands the last point                                                                                                                                                                                                                                                                           |
| Chest unlock in the reported scenario  | **fixed**        | `topDamageDealer` comes from the ledger, so the `if (mob.droppedLoot && topDamageDealer)` gate in the `mobKilled` handler in `wireEventBus` (`src/scenes/DungeonScene.ts`) passes and `receiveBossLoot` fires                                                                                                                                                                                                                              |
| `bossDefeated` / Mongo unlock          | **fixed**        | emitted on every `mobKilled` with `isBoss`, _outside_ the loot gate (the `if (mob.isBoss) { bus.emit('bossDefeated', ...) }` block in the same handler, `src/scenes/DungeonScene.ts`); `krakarenBossRoomIdx` set in the second `bossDefeated` handler in `wireEventBus`. 1d's double-emit (`KrakarenClone` + `krakaren_clone`) is still present — keep that cleanup                                                                        |
| Killing-blow attribution               | **still broken** | `_resolveDeath(null, null)` leaves `killedBy`/`killType` null, so `mobKilled.killer` is null (the `killer` computation in `resolveKills`, `src/systems/CombatSystem.ts`)                                                                                                                                                                                                                                                                   |
| Empty-ledger boss death → chest        | **still broken** | `topDamageDealer === null` skips `receiveBossLoot` entirely (same `if (mob.droppedLoot && topDamageDealer)` gate in `wireEventBus`, `src/scenes/DungeonScene.ts`); `receiveBossLoot` still returns silently on a miss (`src/systems/TreasureChestSystem.ts`); no backfill at the `defeated` transitions (the `fightAborted`-path and the normal-path `if (!bossAlive)` blocks in `BossRoomSystem.update`, `src/systems/BossRoomSystem.ts`) |

**Verification caveat:** the Hoarder agent had finished before this
verification ran, so the code read above is its final state — the verdicts
stand. The edits were still uncommitted (`Mob.ts`, `CombatSystem.ts`,
`MobUpdateLoop.ts`, `BossRoomSystem.ts`, `TheHoarder.ts`), so this reading is
pinned to that working tree, the typecheck/lint gates were not run here, and
the new Hoarder swarm-death path the fix's comments mention ("the game kills
the swarm outright when she drops") was not traced. Two of that agent's edits
also overlap **Phase 2**:
`MobUpdateLoop` now hands a boss an empty target list until a player shares
its room (the `holdsFire`/`mob.updateAI(holdsFire ? NO_TARGETS : aiTargets)`
logic in `MobUpdateLoop.update`, `src/systems/MobUpdateLoop.ts`), which may
already cover part of §1.2 — re-check Phase 2's premises before implementing
it.

**Ryan's requirement, stated plainly:** a status-effect kill must count as an
_attributable_ kill — credit, XP, loot and boss-defeat all fire. The landed fix
makes the death _counted_ but _anonymous_. What remains:

**1a. Statuses carry their applier.** The `StatusEffect` interface
(`src/core/StatusEffect.ts`) has no applier field — attribution is
structurally impossible today. Add `applier: Player | null` (null for
environmental sources like acid pools), thread it through the `make*`
constructors' call sites that have an attacker in hand (the three
`makeSepsis()` proc sites in `resolvePlayerAttacks`, the level-15 shockwave
`makeMagicBurn()` in `resolveKills` — all in `src/systems/CombatSystem.ts`),
and on a lethal tick pass it to `_resolveDeath` so `killedBy` is the
applier's `xpCreditTarget`. Also record each tick's damage into
`damageTakenBy` when the applier is non-null — that one write makes the XP
split, `topDamageDealer`, and therefore the chest gate in the `mobKilled`
handler in `wireEventBus` (`src/scenes/DungeonScene.ts`) all see the DoT
damage with no further changes. The applier reference must not outlive a
checkpoint rewind: `resetToSpawn` already clears statuses and ledger together
(`src/creatures/Mob.ts`), so no extra work — verify, don't assume. Design
decision to settle with Ryan: `killType` for a DoT kill stays null (statuses
are not `melee`/`missile`/etc.), which means a missile-applied DoT finish
still grants no _ability_ kill XP (the `killType === 'missile'` branch in
`resolveKills`, `src/systems/CombatSystem.ts`) — acceptable, or thread a
killType too?

**1b. Make the silent drop loud.** Unchanged from the original plan, still
unimplemented: `receiveBossLoot` finding no locked chest
(`src/systems/TreasureChestSystem.ts`) gets a dev-visible `console.warn` —
this failure cost a playtest; it must never again cost one silently.

**1c. Belt and braces at the defeat transition.** Unchanged, still
unimplemented, and still needed — it is what covers the remaining
empty-ledger case (a boss nobody ever hit, killed purely by environment):
when a room flips to `defeated` (the `fightAborted`-path and the
normal-path `if (!bossAlive)` blocks in `BossRoomSystem.update`,
`src/systems/BossRoomSystem.ts`), `DungeonScene` checks whether that room's
silver chest is still `locked` and, if so, unlocks it with the dead boss's
`droppedLoot` (or a fresh roll via a small public accessor on `Mob` if
`droppedLoot` is null). Keep it a safety net, not the mechanism.

**1d. Cleanup while in the file:** the Krakaren still emits `bossDefeated`
twice — once as `'KrakarenClone'` from the generic `mob.isBoss` branch and
once as `'krakaren_clone'` (both in the `mobKilled` handler in `wireEventBus`,
`src/scenes/DungeonScene.ts`). Deduplicate to the snake_case type.

What null-killer currently costs (the concrete stakes of 1a — every one of
these skips on `killer === null` today): Mongo's evolution kill counter
(the `if (killer !== null) this.mongoSystem.onKill();` line in the same
handler, `src/scenes/DungeonScene.ts`), `first_blood` and the other kill
achievements (the `killer === this.human`/`killer === this.cat` checks
further down the same handler), pugilism skill training (the
`mob.killType === 'melee' && killer === human` check in `resolveKills`,
`src/systems/CombatSystem.ts`), ability kill XP and the level-15 procs (the
`killType`-gated blocks following it in `resolveKills`), and the gore impact
direction (the `if (killer !== null)` block computing `impactDx`/`impactDy`
in the `mobKilled` handler, degrades to a directionless burst). The AI
adapter now labels these kills `'Unknown'` rather than misattributing them to
the cat (the `killerName` computation in `subscribeToEvents`,
`src/ai/AIAdapter.ts`) — after 1a it can name the applier.

- Re-run the §3 baseline repro against the landed fix first
  (`npm run playtest -- krakaren`, DoT-assisted kill): chest should now
  unlock — confirming the concurrent fix before building on it.
- Kill any floor-1 mob with a sepsis tick (crown equipped, walk
  away, let it die): XP floats, loot drops, corpse leaves the grid, and
  (after 1a) the kill shows the crown-wearer as killer — Mongo counter and
  achievements included.
- Kill the Krakaren where a `magic_burn`/sepsis tick lands the
  final point: chest unlocks, `bossDefeated` fires once, Mongo unlock intact.

## 5. Phase 2 — A real engagement signal (fixes §1.2)

**2a. `Mob.hasStruckPlayer`.** New public readonly-outside flag on `Mob`, set
wherever a mob's damage actually lands on a crawler — `dealDamage` and the
unscaled/ranged variant beside it, `dealPreScaledDamage` (both in
`src/creatures/Mob.ts`) — and cleared in `resetToSpawn` (which runs on every
survivor at each checkpoint restore, so a stale flag would survive a death
rewind). Party-side engagement already has a record: `mob.damageTakenBy` is
populated only by real blows (in `Mob.takeDamageFrom`, `src/creatures/Mob.ts`);
expose a `wasDamagedByParty` getter rather than leaking the map.

**2b. Rewrite the veto.** In `isUntriggeredBossRoomMob` (a local function in
`updateAutoAI`, `src/systems/CompanionSystem.ts`), replace the
`m.currentTarget === human || m.currentTarget === cat` release with:

```ts
const roomLocked = state.locked;
const bloodDrawn = m.hasStruckPlayer || m.wasDamagedByParty;
return !playerInRoom && !roomLocked && !bloodDrawn;
```

(the `locked` field on `BossRoomState`, `src/systems/BossRoomSystem.ts`, is
already exposed via `getBossRoomStates`.) The active player attacking the boss
from the doorway is engagement by action and legitimately releases the
companion; the boss merely staring is not. The Hoarder's cockroaches inherit
the same, which is correct: they spawn in her room and should not bait the
companion in.

**2c. Optional hardening (separate commit, own gate).** An unlocked,
unentered boss taking damage never heals — the abort-heal requires `locked`
(the fight-abort block that sets `boss.hp = boss.maxHp` in
`BossRoomSystem.update`, `src/systems/BossRoomSystem.ts`, reachable only
after the room has locked at least once). Extend it: a boss with
`wasDamagedByParty` whose room is unlocked and empty of conscious players
regenerates to full after `UNENTERED_BOSS_REGEN_DELAY_FRAMES` (proposed 300 —
5 s, matching the abort cadence). This closes the remaining
_active-player_ doorway snipe. It is a difficulty decision, so it ships only
if the playtest wants it.

- `npm run playtest -- krakaren`: approach the corridor, stop. The
  cat must hold fire. Step into the room: intro plays, then the cat joins.
- Retaliation check: let the Hoarder's bile actually hit someone
  while the party stands outside her room — companion may now return fire.
- (if 2c ships) Poke the Krakaren from the doorway and retreat: it
  visibly heals back.

## 6. Phase 3 — Leash and sight discipline (fixes §1.3)

**3a. Leash the fight, Mongo-style.** Put the dead `COMPANION_LEASH_PX`
(`src/core/constants.ts`) to work: in `updateAutoAI`, when the companion's
straight-line distance to the **active** player exceeds it while holding an
`autoTarget`, drop the target _and_ ban that specific mob for
`COMPANION_TARGET_BAN_FRAMES` (proposed 90, mirroring Mongo's
`LEASH_BREAK_FORGET_FRAMES`, `src/creatures/Mongo.ts`). Both halves are
required — drop alone re-acquires the same mob the frame the companion gets
home (the documented Mongo lesson — see the class-level doc comment on
`Mongo` explaining the leash-vs-persist-radius mismatch and the
drop-and-ban role of `breakLeash`, `src/creatures/Mongo.ts`). The ban is
exempt for a mob that is hunting the party (`hasStruckPlayer`, from Phase
2a): banning the thing currently biting the player leaves the companion
spectating.

**3b. No unseen acquisitions.** Narrow the LOS exemption — the
`isFightingParty` check in `updateAutoAI` (`src/systems/CompanionSystem.ts`)
— from "mob has noticed a party member" to "blood drawn"
(`mob.hasStruckPlayer || mob.wasDamagedByParty`). A vespa that has actually
spat on someone is a known fight even through a wall; one that has merely
locked on through the bricks is not.

**3c. Range-gate the whole-list scans.** Replace the two unbounded
`mobs.find` scans (the `mobTargetingHuman` assignment and the passive-stance
`human.autoTarget = mobs.find(...)` assignment, both in `updateAutoAI`,
`src/systems/CompanionSystem.ts`) with the existing range-gated
`findMobTargetingNearPlayer`, centred on the companion, radius
`HUMAN_ENGAGE_RANGE × NEARBY_PLAYER_RANGE_MULTIPLIER` as the aggressive path
already uses (the `nearPlayerRange` computation in `updateAutoAI`).

Leave the vespa's own no-LOS acquisition (`updateVespaAI` in
`src/creatures/BrindleGrub.ts`) alone in this plan — mob-side aggro through
walls is a separate design question, and the companion no longer amplifies
it.

- Floor 2 near brindled vespas, playing the cat: the human
  companion may start toward a fight but must turn back once 10 tiles out,
  and must not yo-yo (watch ~30 s; the ban is what prevents the lap).
- Backpedal out of a fight with a mob still chasing: companion
  stays engaged on the chaser (the ban exemption working).

## 7. Phase 4 — The companion cat uses her claws (fixes §1.4)

**4a. `CatPlayer.autoMeleeTick()`**, the mirror of
`HumanPlayer.autoFightTick` (`src/creatures/HumanPlayer.ts`): face the
target; if within `getMeleeRange()` and `CAT_AUTO_SWIPE_COOLDOWN_FRAMES`
(proposed 90, mirroring `AUTO_ATTACK_COOLDOWN`, `src/creatures/HumanPlayer.ts`)
has elapsed, `triggerAttack()`. Clear the new cooldown in `resetCombatState`
(`src/creatures/CatPlayer.ts`).

**4b. Choose claw over missile point-blank.** In `updateAutoAI`
(`src/systems/CompanionSystem.ts`): if the target's centre distance is
inside `cat.getMeleeRange()`, call `autoMeleeTick()`; otherwise
`autoFireTick()` as today. No movement changes: the kite already produces the
adjacency windows (`doCatKite` pushes away only inside `CAT_KITE_DIST ×
KITE_DISTANCE_THRESHOLD`, `src/systems/CompanionSystem.ts`), so roaches, rats
and anything that catches the cat now eats a swipe on the way past. Nothing
in combat resolution changes — the cat-melee block in `resolvePlayerAttacks`
(`src/systems/CombatSystem.ts`) already resolves it, the swipe animation is
baked into the sheet (`CAT_SWIPE_FRAMES`, imported into and assigned to
`ATTACK_FRAMES` in `src/creatures/CatPlayer.ts`), and the `catMeleeSwing`
audio event already fires from the resolver (`resolvePlayerAttacks`,
`src/systems/CombatSystem.ts`).

**4c. Room for strength builds (design note, not in this plan's code).** With
4a/4b, strength finally works passively for the companion. If the playtest
wants more, the natural extension is a third combat stance in `FollowerMenu`
— "brawler": prefer closing to melee range over kiting when
`cat.strength >= cat.intelligence` or when the player toggles it — plus a
pounce-style gap-closer as a trained skill. Both are follow-up plans; do not
fold them in here.

- Play the human with roaches/rats swarming: the cat visibly swipes
  adjacent enemies between missile casts, and strength points change the
  kill speed.
- The swipe animation and swing sound read correctly on the
  companion (not just the active cat), in all facings.
- The cat does not stand toe-to-toe trading with things she should
  kite — the swipe must feel opportunistic, not suicidal.

## 8. Phase 5 — The cat can build, slowly (defend quest)

Added 2026-08-05 at Ryan's request: the cat CAN build barriers, but 3× slower
than the human — possible, not very effective.

**Where building lives today (verified).** The defend quest's wood barriers
are the game's only human-gated build. (`BarrierSystem.beginConstruct` — gym
equipment placement — already takes any `Player`, in
`src/systems/BarrierSystem.ts`, and needs no change.) The barrier build:

- Trigger is **player-action only** — there is no companion-AI build hook in
  `CompanionSystem`, so this phase is about the **player-controlled cat**; the
  AI-companion cat building autonomously is explicitly out of scope. Two call
  sites, both hard-gated on the human being active:
  `DungeonScene.triggerBuildAction` bails on `!this.human.isActive`
  (`src/scenes/DungeonScene.ts`), and the hotbar activation requires
  `slot?.id === 'quest_wood_board' && this.human.isActive` (in
  `triggerHotbarActivation`, `src/scenes/DungeonScene.ts`).
- The system itself is typed human-only: `tryBuildBarrier(human: HumanPlayer)`
  (`src/systems/DefendQuestSystem.ts`), the pointer variant
  `tryMobileTapOnGrate` (same file), `finishBuild` deducts from `ctx.human`'s
  inventory (`finishBuild` in the same file), and the build/repair prompt
  renders only when `human.isActive` (in `renderObjects`, same file).
- Progress is a **frame countdown**, not an accumulator: `pendingBuild.
framesLeft` is seeded with `BUILD_FRAMES` (`BUILD_SECONDS = 2` ×
  `FRAMES_PER_SECOND`, `src/systems/DefendQuestSystem.ts`, seeded at both
  `tryBuildBarrier` call sites), decremented once per `update`, finished by
  the same `if (this.pendingBuild.framesLeft <= 0)` check that calls
  `finishBuild`; the progress bar derives elapsed from the same constant
  (the `ratio` computation, `src/systems/DefendQuestSystem.ts`).
- The cat **already picks up boards** into her own inventory — the wood-pile
  pickup in `tickWoodPile` checks both crawlers
  (`src/systems/DefendQuestSystem.ts`) — she just can never spend them today.

**5a. `CAT_BUILD_TIME_MULTIPLIER = 3`.** Because progress is a seeded frame
countdown, "3× slower" is expressed as 3× the frames, not a fractional
per-tick rate: a cat-initiated build seeds `framesLeft: BUILD_FRAMES *
CAT_BUILD_TIME_MULTIPLIER`. Named constant beside `BUILD_FRAMES`; no `0.333`
literal anywhere.

**5b. `PendingBuild` learns its builder.** Add `builder: HumanPlayer |
CatPlayer` and `totalFrames: number` to the `PendingBuild` interface
(`src/systems/DefendQuestSystem.ts`). `finishBuild` spends `BOARDS_PER_BUILD`
from `pendingBuild.builder`'s inventory instead of `ctx.human`'s; the
progress bar and the hammer-sound cadence (the `ratio` computation and the
`hammerSoundPending` field's tick in `update`) read `totalFrames` instead of
the `BUILD_FRAMES` constant, so the longer cat bar renders correctly.
`PendingBuild` is captured by the checkpoint snapshot (the
`DefendQuestCheckpoint` interface and its doc comment, "copied by value",
`src/systems/DefendQuestSystem.ts`); a `Player` reference does not copy by
value, so decide there: either drop an in-progress build on checkpoint
capture or store which-crawler as a discriminant, not a reference. No casts,
no `!`.

**5c. Widen the triggers.** `tryBuildBarrier(builder: HumanPlayer |
CatPlayer)` (and the `tryMobileTapOnGrate` pointer variant);
`triggerBuildAction` passes the active crawler instead of bailing when she is
the cat (`src/scenes/DungeonScene.ts`); the hotbar path in
`triggerHotbarActivation` drops `&& this.human.isActive`; the build/repair
prompt in `renderObjects` (`src/systems/DefendQuestSystem.ts`) renders for
whichever crawler is active, holds boards, and stands by a grate.

- Play the cat in the defend quest: prompt appears at a grate,
  build takes visibly ~6 s (vs the human's 2 s), 4 boards leave the _cat's_
  bag, hammer sound cadence still reads right over the longer bar.
- Repair path as the cat (damaged barrier, not a fresh one) — same
  3× duration.
- Mid-build crawler swap and a checkpoint death during a cat build:
  no orphaned progress bar, no boards lost without a barrier.
- Feel check: is a 6 s build under bugaboo pressure "possible but
  not very effective" as intended, or just a death sentence? (Tuning knob is
  the one constant.)

## 9. Sequencing

Phase 1 is independent and highest-value — ship first. Phase 2 before Phase 3
(3a's ban exemption and 3b both consume Phase 2a's `hasStruckPlayer`) — but
re-verify Phase 2's premises first: the concurrent 2026-08-05 work already
made boss rooms hold fire via `MobUpdateLoop` (see §4's caveat). Phase 4
last of the companion phases; it touches the same `updateAutoAI` seam but
depends on nothing. Phase 5 is fully independent (defend quest only) and can
ship any time. After each phase: `npm run typecheck`, `npm run lint`,
`npm run format`, `npm run verify:companion`.

## 10. What we are deliberately NOT doing

- Not adding invulnerability to un-engaged bosses. The
  `takeDamageFrom`-override pattern exists (RingmasterGrimaldi's
  `takeDamageFrom` override, `src/creatures/RingmasterGrimaldi.ts`, and
  MissQuill's, `src/creatures/MissQuill.ts`) but a blanket "boss immune until
  locked" punishes legitimate active-player openers; Phase 2c's regen is the
  gentler tool if wanted.
- Not touching mob-side aggro (vespa no-LOS acquisition, Krakaren's 12-tile
  radius). The companion was the amplifier; mob senses are a separate balance
  topic, out of scope here.
- Not building a general threat/aggro table. `hasStruckPlayer` +
  `wasDamagedByParty` + room lock is the smallest set of signals that answers
  "is this fight ours", and every one of them is a fact, not a heuristic.
- Not changing the 85/15 XP split or kill attribution — verified correct for
  companion kills (the credited-damage split and `topPlayer`/`otherPlayer` XP
  award in `resolveKills`, `src/systems/CombatSystem.ts`).

## 11. Consolidated notes for Ryan's playtest

- §3 baseline re-run against the concurrently-landed fix (chest
  should now unlock on the old repro).
- §4 DoT-kill loot on a regular mob with the killer _named_ (Mongo
  counter, achievements); DoT-finished Krakaren unlocks chest and Mongo.
- §5 cat holds fire until entry/blood; intro always precedes the
  first companion shot on an untouched boss.
- §6 no cross-map chases on floor 2; no leash yo-yo; chasers still
  get fought.
- §7 companion swipes adjacent enemies; strength investment felt;
  kite behavior otherwise unchanged.
- §8 cat builds a defend-quest barrier in ~6 s from her own boards;
  human still 2 s; the pace feels "possible, not very effective".
- One full Krakaren gauntlet run start-to-finish playing each
  crawler, checking the fight still _feels_ like a boss fight when the
  companion participates properly.
