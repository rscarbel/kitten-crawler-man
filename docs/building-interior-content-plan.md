# Building interior content plan

Give the Over City's building interiors distinct content and their NPCs
lore-backed dialogue, and put the Dirty Shirley on the Desperado Club's bar.

Playtest feedback: players explore houses expecting interesting content, but
interiors are generic with little to do, and the NPCs inside speak generic
role-flavoured lines with no underlying lore. The one exception — the Desperado
Club — was a big success. This plan reads the club's implementation for _why_
it worked and applies the same recipe, at house scale, to the rest of the town.

> **Dependency.** This plan assumes buildings gain full system support (combat,
> destructibles, generalized menus/consumables) from the parallel
> universal scene-systems work. That work may not be planned or shipped yet as
> you read this. Everything here is explicitly marked either **works today** — it
> runs on machinery `BuildingInteriorScene` already has — or **needs
> universal-scene-systems** — it should not be built until that plan lands.
> Section 6 collects the split in one table. The bulk of this plan (dialogue,
> services, the Dirty Shirley) is deliberately in the works-today column.

Book lore source: `docs/over-city-reference.md` (the Over City as it appears in
_Carl's Doomsday Scenario_) and `docs/town.md` (districts, invariants — note
"Names are load-bearing": building renames break quests).

## 1. Why interiors disappoint today (measured from the code)

The town has 15 sprite buildings plus the tower (`PLANNED_BUILDINGS` in
`src/map/town/townPlan.ts`; the `BuildingKind` union, also in
`src/map/town/townPlan.ts`). Every one already has a **unique hand-crafted
layout** — `GameMap.generateInterior` (in `src/map/GameMap.ts`) branches per
type and then per name through the `NAMED_BUILDINGS` switch inside that same
method. The rooms _look_ individual. What is thin is
what you can do and who you can meet:

- **Only 5 of 16 interiors offer a service.** `SERVICE_NPC_ROLES`
  (in `src/scenes/BuildingInteriorScene.ts`) maps exactly five buildings
  (three taverns, the temple, the tattoo parlour) to a role whose talk opens a
  `PricedMenuPanel`. Everything else — Shepherd's Cabin, Blackwood Lodge,
  Cartwright's Workshop, Old Hilda's Cottage, Miller's Farm, Herb & Remedy —
  is walk in, look at furniture, hear a stock line, leave.
- **Herb & Remedy has a merchant who sells nothing.** Its occupant roster
  stations a `merchant` at the counter
  (the `'Herb & Remedy'` entry in `BUILDING_OCCUPANTS`,
  `src/systems/InteriorOccupantSystem.ts`), it even gets the
  magic-shop ambience bed (the `'Herb & Remedy'` entry in
  `INTERIOR_AMBIENT_BEDS`, `src/scenes/BuildingInteriorScene.ts`), but the
  building is not in `SERVICE_NPC_ROLES`, so talking to the merchant yields
  generic merchant chatter. A shop with no shop is the "disappointment" bug in
  its purest form.
- **All dialogue is role-keyed, not person-keyed.** A conversation is built by
  `buildCitizenConversation(role, seed, turn, ctx)`
  (in `src/systems/townDialog.ts`) from `AMBIENT_LINES`, a
  `Record<TownRole, string[]>` (same file). The
  speaker label is a job title from `ROLE_NAMES`
  (same file). Consequence: the innkeepers of all
  three taverns share the same five lines; no NPC inside any house has a name,
  a history, or anything to say about the building they are standing in.
  (Townspeople structurally _cannot_ have names today: `Townsperson` carries
  only its `role` and `appearance` properties, `src/creatures/Townsperson.ts`.)
- **The three taverns are one tavern three times.** `buildTavernMenu`
  (in `src/systems/townPub.ts`) serves the identical `DRINKS` list
  (same file) under a different title in the Sunken
  Stump, the Horned Flagon and the Sleeping Cat Inn.
- **The good machinery exists but is rationed.** Interiors already support
  full quest combat via `createCombatStack`
  (in `src/scenes/BuildingInteriorScene.ts`, alongside the `InteriorCombat`
  interface) — but only three encounters ever use it (Big Top, Blackwood
  Lodge cult hideout, tower confrontation; gated by `initEntryEncounter`,
  same file). Reactive world-state dialogue exists (gossip, reputation
  greetings, danger lines — the `gossipLine`/`reputationTier`/`reactiveLead`
  functions in `townDialog.ts`) but is spread thin over
  role pools. Named NPCs with personal barks exist — at the _market stalls_
  (Bess Ottoline, Orlo Pemberwick; the `GREENGROCER` and `TINKER` vendor defs
  in `src/systems/market/vendorDefs.ts`) — just not indoors.

## 2. What made the Desperado Club work (from its implementation)

Concrete, citable properties, each of which the rest of the plan reuses:

1. **A hand-authored, zoned room.** One source of truth, `src/core/clubLayout.ts`:
   a 24×18 room (`CLUB_INTERIOR_W`/`CLUB_INTERIOR_H`) with five labelled zones — bar, market, casino,
   mercenary desk, VIP lounge (`CLUB_ZONES`, same file) — each with
   its own rug, accent glow and room-specific floor stains
   (`FLOOR_STAIN_COLOR` in `src/sprites/clubDecor.ts`). The room _reads_ as places, not as
   furniture scattered in a box.
2. **Every zone is a station you can use.** `CLUB_STATIONS`
   (`clubLayout.ts`) with a 2.6-tile interact radius
   (`STATION_INTERACT_RANGE` in `src/systems/DesperadoClubSystem.ts`): bar shop, market shop, blackjack
   table, mercenary hiring, VIP services. Density of _verbs_ — five distinct
   things to do in one room — is the single biggest difference from a house.
3. **Named NPCs with personality and reactive lines.** The Sledge's four-line
   greeting (`GREETING_LINES`) that grants the Desperado Pass (in `openGreeting`,
   `DesperadoClubSystem.ts`), Deuce the dealer with trigger-keyed banter — nine triggers,
   three lines each, never repeating the previous line
   (`DEUCE_LINES` and `pickDeuceLine` in `src/ui/casino/deuceLines.ts`) — Doctor Bones the skeleton DJ
   (the `CLUB_DJ_TILE` in `clubLayout.ts`), Rosemarie at the mercenary desk
   (the `mercenary: 'rosemarie'` entry in `STATION_VARIANT`, `DesperadoClubSystem.ts`). NPCs react to what the player _just
   did_, not to a global role.
4. **A real game-within-the-game.** Blackjack is a full pure model
   (`src/systems/casino/BlackjackTable.ts`: the `TablePhase` union, the
   `TABLE_MINIMUM`/`TABLE_MAXIMUM`/`HIGH_ROLLER_MAXIMUM`/
   `HIGH_ROLLER_UNLOCK_WAGERED` table limits and high-roller unlock, and the
   anti-exploit wagering accrual in `deal()`'s `this.coinsWagered += total`)
   with its own dev harness (`?casino`,
   `src/scenes/CasinoPreviewScene.ts`).
5. **Persistent consequences.** The `ClubMembership` interface (`src/core/ClubMembership.ts`)
   and `MercenaryRoster` are threaded by reference through scene changes and
   snapshot with the world checkpoint (`captureClubMembership`/`restoreClubMembership`,
   same file), so what you
   did at the club is still true tomorrow.
6. **Layered atmosphere.** A four-track shuffled playlist
   (`CLUB_MUSIC_TRACKS` in `src/audio/sounds.ts`, selected by
   `interiorMusicTracks` in `BuildingInteriorScene.ts`), a constant crowd bed
   (the `'The Desperado Club'` entry in `INTERIOR_AMBIENT_BEDS`,
   `BuildingInteriorScene.ts`), animated dance-floor light pools
   (the `DANCE_LIGHT_*` constants and `renderDanceFloorLights` in
   `DesperadoClubSystem.ts`), a colliding wandering crowd of
   12 patrons plus 8 dancers (`CLUB_PATRON_COUNT` in `src/core/clubLayout.ts`
   and `CLUB_DANCER_TILES` in the same file, driven by
   `src/systems/ClubCrowdSystem.ts`), and purchase-specific SFX (the bar pour,
   played from `update()` in `DesperadoClubSystem.ts`).
7. **A ritualized arrival.** Walk in → the Sledge stops you → you get a pass →
   an achievement fires (`desperado_member`). The building acknowledges you.

The recipe, distilled: **a room of named places, each place with a verb, run by
a named person who reacts, leaving a persistent trace, under its own sound.**
Houses cannot afford five verbs each — but every interior can afford one verb,
one named person, and one piece of lore.

## 3. Design principles

- **Every interior gets three things:** something to _do_ (a service, a game, a
  purchase, a reading), someone who _knows_ something (a named resident with
  lore-backed dialogue), and something that _persists_ (a flag, an item, a
  standing discount, a changed greeting).
- **Reuse the existing surfaces.** `PricedMenuPanel`
  (the `PricedMenu`/`PricedPurchaseHandler` types, and the `active.coins -=
option.price` deduction inside `tryBuy`, in `src/ui/PricedMenuPanel.ts`),
  `ShopSystem` with a bespoke
  `ShopConfig` (the club-bar pattern, `ShopConfig` in `src/systems/ShopSystem.ts` and
  `BAR_SHOP_CONFIG` in `DesperadoClubSystem.ts`), `CitizenDialog`
  (`src/ui/CitizenDialog.ts`), and the notice-board/fortune "pure data +
  selection" module shape (`src/systems/townNotices.ts`,
  `src/systems/townFortunes.ts`). No new UI frameworks.
- **Lore comes from the source reference.** `docs/over-city-reference.md`:
  Scolopendra's curse and the poisoned ruins, the skyfowl and their "watchers"
  theology, Featherfall's magistracy, the Syndicate shows, the murder mystery
  and the circus. Dialogue should _foreshadow and echo the game's own
  questlines_, which already exist as stage unions the dialogue layer can read
  (the `TownDialogContext` interface, `src/systems/townDialog.ts`).
- **Names are load-bearing** (`docs/town.md`, Invariants). New content keys off
  `entry.name` exactly as `SERVICE_NPC_ROLES` and `BUILDING_OCCUPANTS` do;
  never rename a building.
- **Plan conventions:** strict types (no `as`, no `!`, no `any`), UI via
  `src/ui/` utilities, every tuning number a named constant.

## Phase 1 — Named residents and a lore-dialogue data model

The structural fix everything else builds on: interiors get **residents** —
named individuals — layered on top of the role system, without discarding it.

**1a. `ResidentDef` registry.** New file `src/systems/townResidents.ts`
(sibling of `townDialog.ts`, same pure-data shape):

```ts
interface ResidentDef {
  readonly id: ResidentId; // string-literal union
  readonly name: string; // "Old Hilda", "Brann Cartwright"
  readonly role: TownRole; // appearance/voice base
  readonly home: string; // building name (entry.name key)
  /** Rotated everyday lines — replaces the role pool when present. */
  readonly ambient: ReadonlyArray<string>;
  /** Multi-line lore conversations, told once each in order, then re-tellable. */
  readonly lore: ReadonlyArray<ReadonlyArray<string>>;
  /** Optional quest-stage-reactive lines, checked before anything else. */
  readonly reactive?: (ctx: TownDialogContext) => string | null;
}
```

Lore conversations are _arrays of lines_ because `CitizenDialog.open` already
takes a line list and pages through it with a page indicator
(in `src/ui/CitizenDialog.ts`); nothing new to build. Branching choices are
explicitly out of scope — no dialogue surface supports them today and the
club's success didn't need them.

**1b. Give occupants identity.** `OccupantSpec`
(the interface in `src/systems/InteriorOccupantSystem.ts`) gains an optional
`residentId`; `BUILDING_OCCUPANTS` (same file) assigns one to the anchor
occupant of each building (the smith, each innkeeper, Hilda, etc.).
`Townsperson` gains an optional `name` (threaded through its constructor next
to the existing `role` property, `src/creatures/Townsperson.ts`) so the dialog header can show
"Old Hilda" instead of "Priest". `InteriorOccupantSystem.makeOccupant`
(same file) passes it through.

**1c. Conversation selection.** `tryTalkToOccupant`
(in `src/scenes/BuildingInteriorScene.ts`) currently calls
`buildCitizenConversation(role, seed, turn, ctx)`. Add
`buildResidentConversation(def, turn, ctx)` in `townResidents.ts`: reactive
line if any → next untold lore conversation → rotated personal ambient.
"Untold" is tracked by `turn` (the existing `conversationCount` on the
occupant) — the first N talks walk the lore list in order, later talks rotate;
deterministic, no new persistence needed for a first cut. Street citizens and
unnamed occupants keep the role path untouched.

**1d. Write the lore.** One resident per building minimum. Sourced from
`docs/over-city-reference.md` and the game's own quests; sketches:

| Building              | Resident                                                                                                                                                                | Lore threads                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Old Hilda's Cottage   | **Old Hilda** (priest role, hedge-witch voice)                                                                                                                          | Remembers the city before Scolopendra's curse; what the "mutated former citizens" in the ruins used to be; warns about the circus lights before the quest, mourns Grimaldi's family after                                      |
| Cartwright's Workshop | **Brann Cartwright** (laborer)                                                                                                                                          | Built wagons for Grimaldi's circus when it still toured; his apprentice fled into the ruins; grumbles that the Syndicate films everything                                                                                      |
| Shepherd's Cabin      | **Wendell** (farmer)                                                                                                                                                    | Lost two sheep to the ruins (echoes the street farmer line in `AMBIENT_LINES.farmer`, `src/systems/townDialog.ts`); saw _something with too many legs_ near the south wall — foreshadows floor content                         |
| Miller's Farm         | **Marta Miller** (farmer)                                                                                                                                               | Feeds the town under siege economics; the Barracks buys her grain; her boy wants to be a crawler and she hates it                                                                                                              |
| Herb & Remedy         | **Apothecary Fen** (merchant)                                                                                                                                           | Trained under the skyfowl healers in the tower; theories about the poison in the ruins; sells accordingly (Phase 2)                                                                                                            |
| Temple of the Sky     | **Deacon Aviel** (priest)                                                                                                                                               | Skyfowl theology — "the skyfowl are not birds, they are watchers" (already an `AMBIENT_LINES.priest` line, `src/systems/townDialog.ts`) becomes a told story; nervous about Featherfall's silence — murder-quest foreshadowing |
| The Rusty Anvil       | **Smith Varga** (smith)                                                                                                                                                 | Forged for the garrison before the floor opened; reads the player's gear and comments (works today: `inventory.hasEquipped`)                                                                                                   |
| Sleeping Cat Inn      | **Innkeep Ossie**                                                                                                                                                       | Named the inn after a cat that talked its way out of the ruins — a wink at Donut; travellers' tales tied to actual floor content                                                                                               |
| Horned Flagon         | **Innkeep Brend**                                                                                                                                                       | The respectable house: nobles, guild gossip, Hekla's crawler guild poaching rumors                                                                                                                                             |
| Sunken Stump Pub      | **Innkeep Marlow**                                                                                                                                                      | The dive: Low Quarter gossip, knows the service alley, murder-quest whispers before the body is found                                                                                                                          |
| Blackwood Lodge       | **Sgt. Kessler** (guard)                                                                                                                                                | Why a garrison lodge sits on a dead-end alley; after the cult hideout resolves, what they found in the cellar                                                                                                                  |
| The Barracks          | Existing Mordecai advice chain stays primary (`talkToMordecai` in `src/scenes/BuildingInteriorScene.ts`); give the off-duty guards resident lines about floors they ran |

All existing reactive machinery stays: residents' `reactive` hooks read the
same `TownDialogContext` snapshot the scene already builds
(the `this.townDialogContext()` call inside `tryTalkToOccupant`,
`BuildingInteriorScene.ts`), so a resident can out-gossip the street.

_Works today: entirely — this phase touches only data, `Townsperson`
identity plumbing, and one selection branch._

## Phase 2 — A verb for every interior (archetype content)

Interior archetypes, each mapped to machinery that exists, and the buildings
that adopt them. Ordered cheapest-first.

**2a. Differentiate the three taverns.** `buildTavernMenu`
(in `src/systems/townPub.ts`) takes the building name; make `DRINKS`
per-house: the Sunken Stump keeps cheap ale, the Horned Flagon gets a
mead/noble list, the Sleeping Cat gets food that heals (its `drunk_and_heal`
pour pattern is already written in `pourDrink`, same file). Three data lists, one
lookup by `title`. Distinct innkeeper barks come free from Phase 1.
_Works today._

**2b. Herb & Remedy becomes a real apothecary.** Add it to
`SERVICE_NPC_ROLES` (in `src/scenes/BuildingInteriorScene.ts`) and give
`openServiceMenu` (same file) a branch that opens a `PricedMenuPanel` of
remedies — the club-market pattern of selling real `ItemId`s
(the `MARKET_SHOP_CONFIG` precedent in `DesperadoClubSystem.ts`, vendor-style purchase handler
that adds inventory items, `createVendorPurchase` in
`src/systems/market/vendorMenu.ts`): health
potions at a friendlier price than the General Store's 5 coins
(`HEALTH_POTION_PRICE` in `src/systems/ShopSystem.ts`), plus an antidote-flavoured stock line.
_Works today._

**2c. Old Hilda reads fortunes.** The plaza fortune teller's module is pure
data + selection (`src/systems/townFortunes.ts`) with its own panel
(`src/ui/FortuneTellerPanel.ts`). Hilda offers a cheaper, darker in-house
reading — a second `ReactiveFortune` pool with curse-lore flavor — through the
same panel class. _Works today._

**2d. The Rusty Anvil sharpens.** A priced smith service via
`PricedMenuPanel`: "Put an edge on it" — a timed player status (whetstone
damage bonus) following the `TIMED_POTIONS` status pattern
(in `src/scenes/DungeonScene.ts`, `Player.applyStatus`). One new status
type, one named constant for the bonus and duration. _Works today_ (statuses
already snapshot with the player, `src/core/PlayerSnapshot.ts`).

**2e. Sleeping Cat Inn rents a bed.** A priced "Sleep it off" service: full
heal for both crawlers plus clearing timed statuses, fade-to-black. The temple
already proves the party-wide priced heal (`buildBlessingMenu`/`grantBlessing`
in `src/systems/townTemple.ts`);
the inn's version is cheaper but requires not being mid-quest-danger
(`isTownInDanger` in `townDialog.ts`). _Works today._

**2f. Readables — lore you can pick up.** A small `ReadablePanel` modeled on
`NoticeBoardPanel` + `townNotices.ts` ("pure data + selection", tone-sorted
postings, `src/systems/townNotices.ts`): interactable books/notes at
existing `BOOKSHELF`/`TABLE` furniture in named interiors (the furniture scan
pattern is proven — `InteriorOccupantSystem.scanFurniture`, same class's file).
Content: Hilda's herbal marginalia, the Lodge's cult letter aftermath, temple
scripture about the watchers, a circus playbill in Cartwright's workshop.
_Works today_ (interact prompt + modal panel; no combat, no destructibles).

**2g. Cartwright's Workshop, Miller's Farm, Shepherd's Cabin.** Resident lore
(Phase 1) plus one light verb each: Cartwright sells `goblin_dynamite` "for
stumps" (it's a real `ItemId`, defined in `src/core/ItemDefs.ts`); Marta sells cheap
hearty food (heal-over-time consumable or the inn-food list); Wendell posts a
"lost sheep" notice that the plaza board can echo (`townNotices.ts` context
already flows quest flags). The sheep _hunt itself_ — going into the ruins,
finding the flock, a small fight — **needs universal-scene-systems** if any of
it happens indoors, but as written (overworld ruins) it can ride existing
overworld spawning; keep it a stretch goal either way.

**2h. Deferred to universal-scene-systems.** The content ideas this plan
_wants_ but must not build yet, because interiors have no general combat,
destructibles or physics outside the three scripted encounters
(gated by `initEntryEncounter`, `src/scenes/BuildingInteriorScene.ts`):

- A bar brawl event in the Sunken Stump (interior combat on a non-quest
  trigger).
- Rats in the inn cellar / a "clear my storeroom" micro-quest (interior combat
  - spawning).
- Breakable crates with loot in Cartwright's yardhouse (destructibles).
- Anything that throws, burns or explodes indoors (Cartwright's dynamite demo).

Each of these is one `createCombatStack` call away _if_ that stack is
generalized — reference the universal plan's combat/destructible phases when
they exist.

## Phase 3 — The Dirty Shirley (Desperado Club bar)

The source-material drink players went looking for. Sold at the club bar as a
**purchasable consumable item** (like the rest of the bar's stock, unlike the
taverns' drink-on-the-spot service).

**3a. Item definition.** Add `'dirty_shirley'` to the `ItemId` union
(in `src/core/ItemDefs.ts`) and `ITEM_DEF` (same file):

```ts
dirty_shirley: {
  id: 'dirty_shirley',
  name: 'The Dirty Shirley',
  stackable: true,
  canHotlist: true,
  type: 'consumable',
  drinkable: true,
  description:
    'The Desperado Club’s signature: grenadine, ginger ale, a cherry, and ' +
    'far too much vodka. Restores health and grants liquid courage. ' +
    'You will be drunk.',
},
```

`drinkable: true` puts "Drink" in the bag context menu for free
(`leadOptionFor` in `src/ui/InventoryInteraction.ts`, queued via the
`pendingDrinkSlot` field on `InventoryInteraction`, same file).

**3b. Effect.** In `DungeonScene.drinkPotion`
(in `src/scenes/DungeonScene.ts`), a branch beside `stat_boost_potion`
(it is instant + status, not a pure timed potion): consume, then

- heal `DIRTY_SHIRLEY_HEAL_FRACTION` (0.25) of max HP — the Boozy Milk
  arithmetic in `pourDrink`, `src/systems/townPub.ts`;
- `applyStatus(makeDrunk(drinker.ironStomachTimeScale))`
  (`makeDrunk` in `src/core/StatusEffect.ts`; the Iron Stomach scale is how the pub
  pours it, same call in `pourDrink`, `townPub.ts`);
- `recordSwallowed()` (called from `pourDrink`, `townPub.ts`) so the achievement plumbing that
  watches drinks keeps counting.

Named constants for fraction and price; sounds via the existing
`playDrinkSounds` gulp-then-effect pattern (in `DungeonScene.ts`) and a
`potionEffectNotice` entry (`src/ui/potionNotices.ts`).

**3c. Icon.** A branch in `InventoryPanel.renderItemIcon`
(in `src/ui/InventoryPanel.ts`, called from both the bag-slot and hotbar-slot
render passes): a highball glass,
grenadine-red gradient, cherry on top — procedural ctx drawing like the other
item icons.

**3d. Stocking.** One line in `BAR_SHOP_CONFIG`
(in `src/systems/DesperadoClubSystem.ts`), first in the list — it is the
signature: `{ id: 'dirty_shirley', price: DIRTY_SHIRLEY_PRICE (15), desc:
'The house special. Ask for it dirty.' }`. Purchase flow is already built:
`ShopSystem.tryBuy` adds the item before charging
(in `src/systems/ShopSystem.ts`) and the club plays the pour + purchase
chime (in `update()`, `DesperadoClubSystem.ts`).

**3e. Drinking it _at the club_.** Gap: inside interiors only
`health_potion` is drinkable from the hotbar
(`BuildingInteriorScene.triggerHotbarActivation`,
`src/scenes/BuildingInteriorScene.ts`); the `TIMED_POTIONS` record and the
potion switch live in `DungeonScene.drinkPotion` (`src/scenes/DungeonScene.ts`). Players will buy
a Dirty Shirley and immediately try to drink it at the bar. Extend the
interior hotbar branch to handle it (small, works today) — **but check the
universal scene-systems work first**: if it generalizes
consumable activation across scenes, implement it there once and delete the
interior special case rather than adding another.

**3f. Stretch.** A `dirty_shirley` achievement ("Ask For It Dirty" — drink one
inside the club), via the existing pending-unlock drain
(`DesperadoClubSystem.consumePendingUnlocks`, in `src/systems/DesperadoClubSystem.ts`;
`AchievementId` union + `ACHIEVEMENT_DEFS`, `src/core/AchievementManager.ts`).

_Works today: all of 3a-3d and the small 3e fix._

## Phase 4 — Atmosphere parity for the upgraded rooms

Cheap club-lessons applied where Phase 2 added verbs:

- **Ambience beds** for newly-alive rooms via `INTERIOR_AMBIENT_BEDS`
  (in `BuildingInteriorScene.ts`) — Herb & Remedy already hums; give the
  Rusty Anvil a forge bed (hearth crackle is automatic,
  `buildAmbientEmitters` scans `FIREPLACE`/`BRAZIER`, same file).
- **Music**: taverns already share a playlist
  (`TAVERN_BUILDING_NAMES`/`interiorMusicTracks`,
  `BuildingInteriorScene.ts`); no new tracks required, but
  the hook is one set-membership away if any get commissioned (`add-sound`
  skill).
- **Occupant rosters**: one pass over `BUILDING_OCCUPANTS`
  (in `InteriorOccupantSystem.ts`) so every upgraded room's population
  matches its new story (e.g. a customer _waiting_ at Herb & Remedy's
  counter).

_Works today._

## Phase 5 — Validation

- `npm run typecheck`, `npm run lint`, `npm run format` — all must exit 0.
- `?townmap`, `?people` dev routes still render (`docs/town.md`, Dev routes).
- The `?casino` harness still passes its invariant sims (money conservation,
  no-repeat lines) after the bar-stock edit
  (`src/scenes/CasinoPreviewScene.ts`).
- Manual sweep: enter all 16 buildings; every named resident opens their lore
  pages; every service menu charges exactly once and refuses when broke
  (`PricedMenuPanel.tryBuy` charges only on `ok`, `src/ui/PricedMenuPanel.ts`;
  `ShopSystem.tryBuy` add-before-charge, `src/systems/ShopSystem.ts`).

## 6. Dependency split — universal-scene-systems

| Content                                              | Status                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Named residents + lore dialogue (Phase 1)            | **Works today**                                                                                                  |
| Tavern menu differentiation (2a)                     | **Works today**                                                                                                  |
| Herb & Remedy apothecary shop (2b)                   | **Works today**                                                                                                  |
| Hilda's fortune readings (2c)                        | **Works today**                                                                                                  |
| Rusty Anvil whetstone service (2d)                   | **Works today**                                                                                                  |
| Sleeping Cat room rental (2e)                        | **Works today**                                                                                                  |
| Readables/lore panels (2f)                           | **Works today**                                                                                                  |
| Light vendor verbs — Cartwright/Miller/Shepherd (2g) | **Works today** (the sheep-hunt fight is stretch)                                                                |
| Dirty Shirley item, effect, icon, stocking (3a-3d)   | **Works today**                                                                                                  |
| Drinking consumables inside interiors (3e)           | Small local fix today, **or** subsumed by universal-scene-systems consumable parity — coordinate before building |
| Bar brawls, cellar rats, indoor micro-quests (2h)    | **Needs universal-scene-systems** (general interior combat)                                                      |
| Breakable/destructible interior props (2h)           | **Needs universal-scene-systems** (destructibles)                                                                |
| Indoor dynamite/fire behavior (2h)                   | **Needs universal-scene-systems**                                                                                |

## 7. Sequencing

Phase 1 → 2a-2f in any order (each is independent) → 3 (independent of 1-2,
can ship first if the Dirty Shirley is wanted immediately) → 4 → 5. Phase 2h
waits for the universal scene-systems work and should be re-planned
against its actual shape when it lands.

## 8. Notes for Ryan's playtest

- Walk all 16 interiors: does each now have at least one thing to do
  and one person worth talking to? Which still feel empty?
- Do the resident lore conversations read as _this town's_ lore, and
  do the quest-reactive lines fire at the right stages (before/during/after
  circus, murder, doomsday)?
- Are the three taverns now distinguishable blind — menus, barks,
  crowd?
- Buy a Dirty Shirley at the club, drink it at the bar: pour sound,
  heal, drunk wobble, hotbar toast — does the moment land? Is 15 coins right?
- Does the drunk effect stacked with the club's dance-floor lights
  cause any readability/comfort problem?
- Herb & Remedy prices vs the General Store and market stalls — does
  the town economy still make sense (no strictly-dominant potion source)?
- Performance: interiors with new occupants/ambience on the phone
  layout — any frame-time regression vs the current rooms?
- Confirm nothing in this plan collided with what the universal
  scene-systems work shipped — especially consumable
  activation (3e) and any interior combat hooks (2h).
