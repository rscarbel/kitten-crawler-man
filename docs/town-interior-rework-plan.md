# Town Interior Rework Plan

Scaffolding for an implementing agent. Delete this file once the work ships.

## What this changes, in one paragraph

The town's safe room moves out of **The Barracks** and into **The Sleeping Cat
Inn**, which is redesigned as an actual inn: a taproom downstairs and a wing of
three private guest rooms that can be rented for a full mend plus a
time-bounded stat boon. The Barracks stops being a safe room wearing a
bunkhouse costume and becomes the town garrison, with a quartermaster's
armoury, a drill yard that sells permanent training, a muster board, and an
optional sparring bout. The tattoo parlour is renamed off **Signet's Ink** to
**The Quiet Needle** and rebuilt as a medieval inking shop — a curtained
alcove, a pigment bench, a flash-art wall — instead of two tables and a
bookshelf. Underneath all three, the machinery that makes every interior feel
identical is fixed: safe-room-ness stops being a `BuildingKind`, interiors stop
sharing one 18×14 shell and one floor material, a building can offer more than
one service, and the occupant placer stops parking every marquee NPC in the
north-west corner.

## Rules that apply to every phase

- **Type safety.** No `as` (except `as const`), no `!`, no `any`. If the types
  fight you, restructure. Every new registry keyed by `BuildingKind` or
  `TownRole` must be exhaustive by construction (`Record<K, V>` or
  `satisfies`), so a new key cannot ship unhandled.
- **No magic numbers.** Every row, column, price, tick count and radius below
  is stated as a number for clarity; in code it becomes a named constant in the
  surrounding file's existing style. Name it for what it means.
- **Comments explain why.** Do not restate the ASCII grids in comments. Do
  write down the non-obvious constraints this plan calls out (the archway/
  counter collision, the CON-boon HP sync, the reachability rule).
- **Never cite this document from code.** If a reason lives here and needs to
  survive, copy the reason into the comment. Never write "see the town interior
  plan", and never write a line number.
- **Gates.** After every phase: `npm run typecheck`, `npm run lint`,
  `npm run format`, and the verify scripts named in that phase. All must exit 0.

## The ASCII grids are the authority on layout

Three buildings below carry a complete tile grid. They are the specification —
read them as `grid[y][x]`, origin top-left, matching
`GameMap.generateInterior`'s own indexing. Translate each into the file's
existing idiom (named row/column constants plus loops), not into a literal
string table.

Legend, shared by all three grids:

| Char | Tile type          | Char | Tile type          |
| ---- | ------------------ | ---- | ------------------ |
| `#`  | `INTERIOR_WALL`    | `.`  | that room's floor  |
| `T`  | `TABLE`            | `C`  | `CHAIR`            |
| `B`  | `BED`              | `R`  | `RUG`              |
| `F`  | `FIREPLACE`        | `Z`  | `BRAZIER`          |
| `K`  | `INTERIOR_COUNTER` | `s`  | `BOOKSHELF`        |
| `k`  | `CRATE`            | `o`  | `BARREL`           |
| `D`  | exit door          | `,`  | `DRILL_SAND_FLOOR` |
| `d`  | `TRAINING_DUMMY`   | `w`  | `WEAPON_RACK`      |
| `m`  | `MUSTER_BOARD`     | `M`  | `MAP_TABLE`        |
| `f`  | `FLASH_WALL`       | `p`  | `PIGMENT_SHELF`    |
| `I`  | `INK_BENCH`        | `g`  | `GRINDING_SLAB`    |

`k`, `o`, `s`, `w`, `m`, `f`, `p`, `g` are placed with `placeProp`; the rest are
direct `grid[y][x].type =` writes, exactly as the existing named-building cases
do.

---

# Phase 0 — Groundwork

Nothing player-visible ships in this phase. It removes the four structural
reasons the town's interiors are interchangeable. Do it first; every later
phase depends on it.

## 0.1 — Safe-room-ness stops being a `BuildingKind`

Today a building is a safe room if and only if its kind is `'restaurant'`.
That is why The Barracks is registered as a restaurant, and it is the single
thing blocking the safe room from moving.

**Edit `src/map/town/townPlan.ts`:**

- Delete `'restaurant'` from `BuildingKind`. The union becomes
  `'house' | 'tower' | 'store' | 'club'`.
- Add to `PlannedBuilding`:

  ```ts
  /**
   * Whether this building's interior hosts the town's safe room — Mordecai, the
   * Bopca's counter and the lantern light. Stated here rather than derived from
   * `kind`, because a safe room is a property of one specific building and not
   * of a category: keying it to a kind is what forced The Barracks to be
   * registered as a restaurant.
   */
  readonly hasSafeRoom?: boolean;
  ```

- On the Barracks entry: `kind: 'house'`, and no `hasSafeRoom`.
- On the Sleeping Cat Inn entry: `hasSafeRoom: true` (kind stays `'house'`).

**Edit `src/map/OverworldGenerator.ts`:** carry `hasSafeRoom` through into the
pushed `buildingEntries` record.

**Edit `src/systems/BuildingSystem.ts`:** add
`readonly hasSafeRoom?: boolean;` to `BuildingEntry`.

**Compile-guided cleanup.** Removing `'restaurant'` from the union breaks every
site that named it. Fix each as follows — do not reintroduce the kind:

| Site                                                               | Fix                                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `INTERIOR_BY_KIND` in `GameMap.ts`                                 | drop the `restaurant` row (Phase 0.3 replaces its purpose)             |
| `isRestaurant` in `GameMap.generateInterior`                       | see 0.3 — becomes a `hasSafeRoom` parameter                            |
| `BUILDING_TYPE_ICONS` in `BuildingSystem.ts`                       | drop the row; the Barracks keeps its `BUILDING_NAME_ICONS` override    |
| `TYPE_OCCUPANTS` in `InteriorOccupantSystem.ts`                    | drop the `restaurant` roster; the Barracks gets a named one in Phase 3 |
| `entry.type === 'restaurant'` × 3 in `BuildingInteriorScene`       | `entry.hasSafeRoom === true`                                           |
| `entry.type === 'restaurant'` in `src/audio/sfxGroups.ts`          | `entry.hasSafeRoom === true`                                           |
| `TownGuideSystem`'s `find((entry) => entry.type === 'restaurant')` | `find((entry) => entry.hasSafeRoom === true)`                          |

`GameMap.generateInterior` gains a parameter rather than reading a kind:

```ts
generateInterior(
  buildingType: BuildingKind,
  towerFloor = 0,
  buildingName = '',
  hasSafeRoom = false,
): void
```

and its tail becomes:

```ts
if (hasSafeRoom) {
  this.safeRooms = [{ bounds: SAFE_ROOM_BOUNDS_BY_NAME[buildingName] ?? wholeInterior, ... }];
} else {
  this.safeRooms = [];
}
```

The inn's safe room is a _band_ of its interior, not the whole floor (Phase
1.3), so the bounds must be name-addressable. Express this as a small
`Map<string, { x: number; y: number; w: number; h: number }>` in `GameMap.ts`
next to the shell table, with the whole-interior rectangle as the fallback so a
future safe-room building works without an entry.

`BuildingInteriorScene` passes `entry.hasSafeRoom === true` into every
`generateInterior` call it makes (including each tower storey, which passes
`false`).

## 0.2 — A building may offer more than one service

`INTERIOR_SERVICES` maps one building to one `InteriorService`. The Barracks
needs two counters (armoury, drill yard). Widen the registry rather than
special-casing.

**Edit `src/systems/townServices.ts`:**

```ts
const INTERIOR_SERVICES: ReadonlyMap<string, ReadonlyArray<InteriorService>> = new Map([...]);

/** Every service this building offers, in roster order. Empty when it offers none. */
export function interiorServicesFor(building: string): ReadonlyArray<InteriorService> {
  return INTERIOR_SERVICES.get(building) ?? [];
}

/** The service the NPC in `role` provides here, or `undefined`. */
export function interiorServiceForRole(building: string, role: TownRole): InteriorService | undefined {
  return interiorServicesFor(building).find((service) => service.role === role);
}
```

Keep `interiorServiceBuildings()` (now the map's keys) and
`interiorSellsSomething(building)` (now: _any_ service here has
`surface: 'menu'`). Delete `interiorServiceFor` and fix its call sites
directly — no re-export shim.

**Edit `src/scenes/BuildingInteriorScene.ts`:**

- The scene holds one `PricedMenuPanel` and one `FortuneTellerPanel` today.
  It can keep exactly that: only one surface is ever open at a time. Construct
  the priced panel when _any_ service here has `surface: 'menu'`, and the
  reading panel when any has `surface: 'reading'`.
- `tryTalkToOccupant`'s `const sellsHere = target.role === interiorServiceFor(...)?.role`
  becomes a lookup by the talked-to NPC's own role:
  `interiorServiceForRole(this.entry.name, target.role)`.
- `openServiceMenu` currently switches on `this.entry.name` alone. It must now
  switch on the **pair** `(this.entry.name, role)`. Restructure it as a switch
  on name whose branches switch on role where a building has more than one
  service; single-service buildings keep a flat branch. Thread the role through
  `openService`, `resolvePendingServiceTalk` and the pending-talk record.
- `promptFor(target)` takes its verb from the role-matched service.

**Edit `scripts/verify-interiors.ts`:** the check
`"stations exactly one ${service.role} to run its counter"` now runs **per
service** in `interiorServicesFor(name)`. Add a new check: **two services in
the same building never share a role** — if they did, the talk router could not
tell which counter the player walked up to, and one would be silently
unreachable.

## 0.3 — Interiors stop sharing one shell

Every house is 18×14 and floored in `interior_boards`. That is the largest
single cause of "they all look the same".

**Edit `src/map/GameMap.ts`:**

Replace the name-keyed `BIGTOP_INTERIOR` special case with a general table
that sits beside `INTERIOR_BY_KIND`:

```ts
/**
 * Shells stated per building rather than per kind. A kind is a category — a
 * shop, a house — and a category cannot say how big a mead hall is or what a
 * garrison's drill floor is made of. Anything absent here falls back to its
 * kind's shell.
 */
const INTERIOR_BY_NAME: ReadonlyMap<string, { w: number; h: number; floorType: number }> = new Map([...]);
```

Resolution order in `generateInterior`:
`INTERIOR_BY_NAME.get(buildingName) ?? INTERIOR_BY_KIND[buildingType]`.
`'Big Top'` becomes an ordinary row in the new table.

Populate it for all fifteen buildings plus the Big Top. Sizes and floors:

| Building              | w×h                      | Floor material tile         |
| --------------------- | ------------------------ | --------------------------- |
| The Sleeping Cat Inn  | 24×22                    | `INTERIOR_RUSH_FLOOR`       |
| The Barracks          | 22×18                    | `INTERIOR_STONE_FLOOR`      |
| The Quiet Needle      | 18×16                    | `INTERIOR_INK_FLOOR`        |
| The Horned Flagon     | 22×16                    | `INTERIOR_RUSH_FLOOR`       |
| The Sunken Stump Pub  | 16×14                    | `INTERIOR_RUSH_FLOOR`       |
| Temple of the Sky     | 18×18                    | `INTERIOR_FLAG_FLOOR`       |
| The Rusty Anvil       | 18×14                    | `INTERIOR_FLAG_FLOOR`       |
| Herb & Remedy         | 16×14                    | `INTERIOR_BOARD_FLOOR`      |
| Old Hilda's Cottage   | 14×14                    | `INTERIOR_EARTH_FLOOR`      |
| Cartwright's Workshop | 20×14                    | `INTERIOR_EARTH_FLOOR`      |
| Miller's Farm         | 18×14                    | `INTERIOR_EARTH_FLOOR`      |
| Shepherd's Cabin      | 14×12                    | `INTERIOR_EARTH_FLOOR`      |
| Blackwood Lodge       | 18×14                    | `INTERIOR_BOARD_FLOOR`      |
| General Store         | 20×12                    | `INTERIOR_BOARD_FLOOR`      |
| The Desperado Club    | unchanged (`CLUB_FLOOR`) |                             |
| Big Top               | 34×26                    | unchanged (`SAWDUST_FLOOR`) |

**Every shrunk or grown room must have its hand-crafted case re-fitted to the
new bounds.** A row constant of `11` in a room that is now 12 tall writes into
the south wall. Work through each named case that changed size and re-derive
its constants from `w`/`h` the way the existing cases derive `HOUSE_INTERIOR_W - 2`.
Rooms whose size did not change need no edit.

**Interior reachability is a hard invariant.** A partitioned interior can seal
a region, and nothing in the game says so. Phase 6 adds the gate; while
building, sanity-check by hand that every walkable tile is reachable from
`startTile`.

## 0.4 — New interior floor materials

**Edit `scripts/tilegen/materials.ts`:** add four materials modelled on the
shape of the existing `interior_boards` / `interior_stone` entries.

| id                | Reads as                                                       |
| ----------------- | -------------------------------------------------------------- |
| `interior_rushes` | floorboards under a scatter of dried rushes and spilled straw  |
| `interior_earth`  | swept packed earth, faint broom arcs, no plank seams           |
| `interior_flag`   | large irregular flagstones with wide dark mortar joints        |
| `interior_ink`    | boards blotched with sunk pigment — woad blue, gall black, red |

Give each the same `variants` and `patchTiles` treatment its neighbours use,
so the repeat distance stays comparable.

**Edit `scripts/generate-ground-tileset.ts`:** **append** the four ids to the
`ground_interior` sheet's `materials` array. Appending matters: a material's
noise seed is `seedSlotBase + materialIndex`, so inserting one in the middle
re-rolls the art of every material after it and silently changes four shipped
floors.

**Edit `src/map/tileTypes.ts`:** add `INTERIOR_RUSH_FLOOR`,
`INTERIOR_EARTH_FLOOR`, `INTERIOR_FLAG_FLOOR`, `INTERIOR_INK_FLOOR` next to
`INTERIOR_BOARD_FLOOR`, taking the next free numeric ids.

**Edit `src/map/town/interiorMaterials.ts`:**

- `GROUND_BLEND_ORDER`, `GROUND_FALLBACK_COLOR` and `GROUND_SPILL` are
  `satisfies Record<InteriorMaterial, …>`, so each gains a row for the four new
  materials or the file will not compile — which is the point.
- `GROUND_FALLBACK_COLOR` values must be **measured** from the generated sheet,
  not guessed. Guessing is what put both dungeon walls at twice their true
  brightness. Sample each new material's mean after running the generator and
  write the measured hex in.
- `interiorMaterialForTileType` gains a `case` per new tile type.

**Run `npm run gen:townscape`** (or whichever script drives
`generate-ground-tileset.ts` — check `package.json`; the ground sheets are
baked by that script) and commit the regenerated `ground_interior.png` plus its
manifest.

## 0.5 — New furniture tile types

Six new solid tiles, needed by Phases 3 and 4.

| Constant           | Used by      | Reads as                                             |
| ------------------ | ------------ | ---------------------------------------------------- |
| `DRILL_SAND_FLOOR` | Barracks     | a _floor_, walkable — raked sand over the drill hall |
| `TRAINING_DUMMY`   | Barracks     | a straw-and-sacking pell on a post, hacked about     |
| `WEAPON_RACK`      | Barracks     | an angled rack of spears and practice blades         |
| `MUSTER_BOARD`     | Barracks     | a board of nailed parchment orders, wall-hugging     |
| `MAP_TABLE`        | Barracks     | a table under a pinned campaign map, counters on it  |
| `FLASH_WALL`       | Quiet Needle | rows of pinned design parchments, wall-hugging       |
| `PIGMENT_SHELF`    | Quiet Needle | stoppered jars of ground pigment, stained shelf edge |
| `INK_BENCH`        | Quiet Needle | a padded reclining bench with a leather headrest     |
| `GRINDING_SLAB`    | Quiet Needle | a stone slab with muller, soot pot and a pestle      |

For each, the full checklist — **all five steps, or the tile is invisible or
walk-through:**

1. `src/map/tileTypes.ts` — the constant.
2. `src/map/tiles/interiorTiles.ts` — a `case` in `drawInteriorTile`. Draw with
   raw `ctx` (this is world art, not UI chrome). Match the existing interior
   props' palette and their 32px-legibility bar: a silhouette that reads at
   tile size, a rim or highlight so it does not smudge into the floor.
3. `src/map/walkability.ts` — add every one **except** `DRILL_SAND_FLOOR` to
   both the blocking sets the existing furniture appears in. `DRILL_SAND_FLOOR`
   is a floor and must stay walkable.
4. `DECORATION_OVERLAY_TYPES` in `GameMap.ts` **and** `DECORATION_TYPES` in
   `src/map/TileRenderer.ts` — a Y-sorted prop must be in **both** registries
   or it renders as bare floor. Add `TRAINING_DUMMY`, `WEAPON_RACK`,
   `MUSTER_BOARD`, `FLASH_WALL`, `PIGMENT_SHELF` and `GRINDING_SLAB`;
   `MAP_TABLE` and `INK_BENCH` follow whichever registry `TABLE` and `BED` are
   in today.
5. Decide whether each hosts a person or a readable — Phase 0.6.

**Art must fit its blocked tiles.** A prop drawn wider than the tiles it
blocks lets the player stand _inside_ it. The training dummy and the weapon
rack are the two at risk; keep their art inside their own tile footprint.

## 0.6 — Occupants stop clustering in the north-west

`InteriorOccupantSystem.scanFurniture` walks the grid row-major from `(1,1)`
and `placeAtAnchor` starts each anchor group at cursor `0`. The first spec in a
roster is always the named resident. Together those three facts put the
building's marquee NPC beside the north-westmost matching furniture tile in
every room in town. Nothing chose that; it fell out of scan order.

**Edit `src/systems/InteriorOccupantSystem.ts`:**

Add a posting hint to the spec:

```ts
/** Where in the room this occupant belongs, when the room's furniture alone does not say. */
export type OccupantPost = 'north' | 'south' | 'east' | 'west' | 'centre' | 'door' | 'back';

export interface OccupantSpec {
  role: TownRole;
  activity: InteriorActivity;
  anchor: AnchorKind;
  /**
   * Biases which piece of the anchor group this occupant takes. Without it the
   * group is walked in raw scan order, which is row-major from the north-west —
   * so the first spec in every roster took the north-westmost table in the room
   * and the whole town's shopkeepers stood in the same corner.
   */
  post?: OccupantPost;
  residentId?: ResidentId;
}
```

`placeAtAnchor` gains a preceding sort: when `spec.post` is set, order the
anchor group by squared distance from that post's ideal point inside the
room's walkable bounds (`north` = mid-top, `back` = the wall furthest from
`startTile`, `door` = nearest `startTile`, `centre` = the bounds' centre, and
so on) and walk the sorted list. Keep the per-kind cursor for specs with no
post so unnamed extras still spread out.

Then break the residual north-west bias for _unposted_ specs: rotate each
anchor group's starting cursor by a value derived from the building's name.
Derive it deterministically (a small string hash of the name, modulo the group
length) — `Math.random()` here would make `verify:interiors` non-reproducible.

Finally, **give every named resident a post** in `BUILDING_OCCUPANTS`, chosen
to suit their room. At minimum: the three innkeepers `post: 'back'` (behind
their own bar), the smith `'north'`, Old Hilda `'back'`, Deacon Aviel
`'north'` (at the altar), Marta Miller and Wendell `'centre'`, Brann
Cartwright `'north'`, Fen `'back'`, Wick `'back'`, and the two new Barracks
staff and the tattooist as their phases specify.

Mirror the same sort into `InteriorReadableSystem` if it has an equivalent
cursor, so readables do not all pile into the same corner either.

**Gates for Phase 0:** `npm run typecheck`, `npm run lint`, `npm run format`,
`npm run verify:interiors`, `npm run verify:town`, `npm run verify:assets`.

---

# Phase 1 — The Sleeping Cat Inn becomes an inn, and the safe room

## 1.1 — Shape

24 wide × 22 tall, floored `INTERIOR_RUSH_FLOOR`. `generateInterior` computes
`doorX = floor(w / 2) - 1 = 11`, so the exit is `(11,21)`/`(12,21)` and
`startTile` is `(12,20)` — the grid below already accounts for that.

Three zones:

- **Guest wing**, rows 1–7, split into three private rooms by dividing walls at
  columns 8 and 16. Each room has one doorway in the wall row 8.
- **Landing corridor**, rows 9–10, running the width of the building.
- **Taproom**, rows 12–20, below the partition wall at row 11. This is the safe
  room.

## 1.2 — Grid

```
y= 0  ########################
y= 1  #.BB....#..FF...#.....Z#
y= 2  #.BB.T..#.BB..T.#.BB.T.#
y= 3  #.BB.C..#.BB..C.#.BB.C.#
y= 4  #.......#.......#s.....#
y= 5  #.RRRR..#.RRRRR.#sRRRR.#
y= 6  #......k#.......#....o.#
y= 7  #.......#.......#......#
y= 8  ####.#######.######.####
y= 9  #.RRRRRRRRRRRRRRRRRRRR.#
y=10  #o....................o#
y=11  ###..###################
y=12  #FF...................o#
y=13  #......................#
y=14  #......................#
y=15  #......................#
y=16  #......................#
y=17  #.TT..TT........KKKKKKK#
y=18  #.CC..CC.C.C....C.C.C.C#
y=19  #.....TTTTTT...........#
y=20  #kk..................oo#
y=21  ###########DD###########
```

Room A (columns 1–7) is **The Attic Cot**, room B (9–15) is **The Hearthside
Room**, room C (17–22) is **The Cat's Own Room**. The bed pairs, the hearth in
B, the shelf and brazier in C are what make them feel like different rooms at
three different prices — keep them.

## 1.3 — The safe room band, and the archway that must not be sealed

Register the inn's safe room in the name-keyed bounds table from Phase 0.1 as
`{ x: 1, y: 12, w: 22, h: 9 }` — the taproom only, not the whole interior.

**The archway at columns 3–4 in row 11 is deliberately off-centre.**
`planSafeRoomCounters` lays the Bopca's counter run against the **north wall of
the safe-room bounds**, centred on it, three rows deep including the galley
strip behind. The bounds' north wall is row 11. A centred archway would be
directly under the centred counter and the guest wing would be sealed — the
player would walk into an inn whose entire upstairs is unreachable, with no
error anywhere. Put a comment saying exactly that on the archway constants, and
leave rows 12–14 free of authored furniture across the middle of the taproom so
the counter has somewhere to land.

Rows 12–14 in the grid above are already clear apart from the west hearth and
one east barrel, which sit outside a centred 3–6 tile run.

## 1.4 — Making the safe-room fittings land in an inn

- `stampSafeRoomDecor` only places decor on tiles whose type is
  `SAFE_ROOM_FLOOR` or `SAFE_ROOM_THRESHOLD` (see the type test in
  `src/map/safeRoomDecorLayout.ts`). The inn's taproom is rushes, so **widen
  that test** to accept the town interior floor types as well. Without it the
  lanterns and the stove silently stamp nothing and the safe room has no light.
- `SafeRoomSystem` derives Mordecai and the sleeping cot from the bounds'
  centre via `mordecaiAndBedTiles`. With the band bounds above, Mordecai lands
  around `(6,16)` and the cot around `(17,16)`. **Rows 15–16 are an empty
  cross-aisle for exactly that reason** — the taproom's tables and bar sit below
  it and the Bopca's counter above it, so neither fixture can land on furniture.
  If you move the bar or the tables, re-derive where those two tiles fall before
  you do. Keep both fixtures: the free cot is the
  bottom rung of the rest ladder (bare HP), and the rented rooms are the paid
  rungs.
- `safeRoomAnchorTiles` already reserves Mordecai, the cot, the counter run, the
  galley and the decor, so `InteriorOccupantSystem` will keep the inn's patrons
  out of the Bopca's kitchen with no extra work.
- **`CombatKit` is constructed with `safeRoom: null` for every interior floor.**
  Leave it that way. It is deliberate — narrowing attacks inside would leave a
  crawler unable to swing anywhere indoors, and nothing hostile reaches here.

## 1.5 — Content that follows the safe room

- **`src/systems/InteriorOccupantSystem.ts`** — rewrite
  `BUILDING_OCCUPANTS['The Sleeping Cat Inn']`. Innkeep Ossie keeps
  `tend_counter`/`anchor: 'counter'` and gains `post: 'back'` so he takes the
  east bar rather than the north-west. Add: two `drunk`/`commoner` at the
  feast table, one `commoner` at a side table, one `child` with
  `activity: 'sweep'`, one `noble` at the bar. Nobody is stationed in the guest
  wing — a rented room the player pays for should not have a stranger in it.
- **`src/systems/townResidents.ts`** — Ossie's `ambient` and `lore` lines are
  now spoken in the town's safe room. Rewrite at least one lore page so he says
  what that means (the System's protection, why nothing follows you in). Do not
  delete pages; `verify:interiors` requires `ambient.length > 0` and
  `lore.length > 0`.
- **`src/systems/townDialog.ts`** — the ambient line
  `'The Barracks takes anyone off a floor. Warm bunk, no questions.'` now names
  the wrong building. Rewrite it for the inn, and sweep the file for any other
  line pointing crawlers at the Barracks for shelter.
- **`src/systems/townResidents.ts`** — Corporal Pell's line
  `'The Barracks is a safe room. Actually safe — the system says so…'` is now
  false. Rewrite it: he sends you to the inn.
- **`src/systems/townReadables.ts`** — add two readables to the inn (a guest
  register on a table, a tariff board on a shelf) and re-point the Barracks'
  `barracks_orders` in Phase 3.
- **`src/systems/TownGuideSystem.ts`** — already fixed by Phase 0.1's
  `hasSafeRoom` swap; confirm its row now names the inn and its beacon points
  there.
- **`src/audio/sfxGroups.ts`** — the inn is already in `INTERIOR_AMBIENT_BEDS`
  as a tavern; it now also needs the Bopca's cue group, which the
  `hasSafeRoom` swap from Phase 0.1 handles. Verify the Barracks is no longer
  pulling the Bopca group.
- **`src/systems/BuildingSystem.ts`** — `BUILDING_NAME_ICONS`: the inn's `🛏`
  still fits; give the Barracks a garrison icon in Phase 3.

**Gates:** typecheck, lint, format, `verify:interiors`, `verify:town`.

---

# Phase 2 — Renting a room: rejuvenation and time-bounded boons

## 2.1 — The mechanism

Room boons are **`StatusEffect`s**, not `tempStatMods`. This is not
interchangeable:

- `StatusEffect`s ride `PlayerSnapshot.statusEffects` in and out of every
  building, so a boon bought at the inn survives the walk to the dungeon.
  `tempStatMods` is **not** in `PlayerSnapshot` — a boon built on it would
  evaporate the moment the player stepped out of the inn's door.
- `StatusEffect`s already render as a HUD badge with a duration bar via
  `drawStatusIcon` and `statusBadge`.
- They are already excluded from `AILMENT_STATUSES`, so the inn's own cure and
  the temple's blessing will not strip a boon the player paid for.

`StatusEffect` carries no stat payload today, so add one.

**Edit `src/core/StatusEffect.ts`:**

```ts
/**
 * Stat deltas a boon grants while it is live. Read by `Player.effectiveStat`,
 * which is the whole of the mechanism: nothing is applied on grant and nothing
 * is unwound on expiry, so a boon cannot leave a stale bonus behind.
 */
export const STAT_BOON_BONUSES: ReadonlyMap<string, Partial<Record<StatName, number>>> = new Map([
  ['well_rested', { constitution: 2 }],
  ['hearth_warmed', { strength: 2 }],
  ['deep_slumber', { dexterity: 2, intelligence: 2 }],
]);

export const ROOM_BOON_TICKS = 28800; // eight minutes at 60fps — name it for the minutes
export function makeWellRested(): StatusEffect { ... }
export function makeHearthWarmed(): StatusEffect { ... }
export function makeDeepSlumber(): StatusEffect { ... }
```

Also export `ROOM_BOON_STATUSES` — the three type strings — so the inn can cure
the other two when it grants one.

**Edit `src/Player.ts`:**

- `effectiveStat` folds in the boon bonus alongside equipment and
  `tempStatMods`:

  ```ts
  for (const effect of this.statusEffects) {
    total += STAT_BOON_BONUSES.get(effect.type)?.[stat] ?? 0;
  }
  ```

- **A constitution boon moves `maxHp`, and `maxHp` needs a sync.** This is the
  same trap Jugg Juice's HP loan is written around. Every path that can start
  or end a CON-bearing boon must call `syncHpToMaxHp()`:
  - `applyStatus` — when the applied type appears in `STAT_BOON_BONUSES`.
  - `tickStatusEffects` — when any expiring effect appears in it.
  - `cureStatuses` and `clearStatusEffects` — same test.

  Without this the player's HP bar and their max HP disagree until some other
  event happens to sync them.

**Edit `src/sprites/status/statusEffectVisuals.ts`:** register all three in
`STATUS_VISUALS` with `harmful: false` (a boon gets the bright rim, not the
dark outline) — labels `RSTD`, `WARM`, `DEEP`, distinct colours, and a body
layer + overlay each in the style of `whetstoneBodyLayer`/`drawWhetstone` in
`src/sprites/status/statusBoons.ts`. An unregistered status falls back to a
grey **harmful** pill, which would show three boons as though they were
poisons.

**Edit `src/scenes/StatusPreviewScene.ts`:** add the three to its list so they
are reviewable.

## 2.2 — The rooms

New module **`src/systems/townInnRooms.ts`**, in the shape of `townSmithy.ts`
(pure data plus a `PricedPurchaseHandler`; `PricedMenuPanel` owns the UI and
`BuildingInteriorScene` owns the sounds and gating).

| Key             | Label               | Price | Grants                                                       |
| --------------- | ------------------- | ----- | ------------------------------------------------------------ |
| `room_attic`    | The Attic Cot       | 25    | full mend + ailments cured + `well_rested` (+2 CON)          |
| `room_hearth`   | The Hearthside Room | 55    | full mend + ailments cured + `hearth_warmed` (+2 STR)        |
| `room_cats_own` | The Cat's Own Room  | 90    | full mend + ailments cured + `deep_slumber` (+2 DEX, +2 INT) |

Every room applies to **both crawlers**, matching what `serveInn` does today.
Each `desc` states the boon and its duration in minutes — the player is buying
the boon, so the boon has to be legible before they pay.

Rules:

- **One room boon at a time.** Granting one cures the other two
  (`member.cureStatuses(ROOM_BOON_STATUSES)` before applying). Otherwise the
  player rents all three and stacks +2 to everything, and the choice stops
  being a choice.
- **A room is refused while the town is in danger.** Reuse the existing
  `townInDanger` gate from `buildInnMenu`, with the same `'Not tonight'`
  string: Ossie will not rent a room while people are screaming in the street,
  and that trade against the temple's blessing is why both exist.
- **A room is never refused for being at full HP.** The current `'Rested'`
  gate must not carry over to the boon rooms — the boon is the product, and a
  healthy player refused a purchase they want reads as a bug.
- Re-renting the room whose boon is already live is allowed and simply refreshes
  it; say so in the returned line rather than rejecting.

## 2.3 — Wiring

**Edit `src/systems/townInn.ts`:** `buildInnMenu` appends the three room rows
in place of the single `INN_ROOM_KEY` row; `serveInn` delegates any key in the
room table to `townInnRooms`' handler and otherwise falls through to
`serveDrinkAt`. Keep the module doc's standing point — the room clears
`AILMENT_STATUSES` and nothing else, so a whetstone edge or a Jugg Juice
survives the night — and extend it to say the room boons are excluded from
each other but from nothing else.

**Edit `src/scenes/BuildingInteriorScene.ts`:** the audio predicate
`(option) => option.key !== INN_ROOM_KEY` ("a round pours, a bed does not")
becomes a test against the room-key set. Renting should still get a sound —
give it the rest cue the safe room's sleep uses rather than the pour.

**Note what does _not_ persist.** `checkpointSnapshot` strips `statusEffects`,
so a death rewind removes a room boon along with the coins that bought it.
That is correct and consistent with every other buff; do not special-case it.

**Gates:** typecheck, lint, format, `verify:interiors`.

---

# Phase 3 — The Barracks becomes the garrison

The Barracks keeps its exterior, its plot and its name. It loses Mordecai, the
Bopca and the safe-room banner, and gains three things a crawler actually walks
in for.

## 3.1 — Shape

22 wide × 18 tall, floored `INTERIOR_STONE_FLOOR`, with the drill hall's own
`DRILL_SAND_FLOOR` laid over its east half. `doorX = floor(22/2) - 1 = 10`, so
the exit is `(10,17)`/`(11,17)` and `startTile` is `(11,16)`.

Three zones, and the visual point is that they are three _rooms_, not one box:

- **The armoury**, columns 1–6, rows 1–11 — a quartermaster penned behind a
  counter run, weapon racks on the north wall, crates and barrels of issue kit.
- **The drill hall**, columns 8–20, rows 1–11 — raked sand, four training
  dummies, a rug sparring ring.
- **The muster hall**, rows 13–16, full width — the muster board, the map
  table, benches, braziers flanking the door.

## 3.2 — Grid

```
y= 0  ######################
y= 1  #wwww..#,,,,,,,,,,,,,#
y= 2  #oo....#,,,d,,,,,d,,,#
y= 3  #KKKKK.#,,,,,,,,,,,,,#
y= 4  #......#,,,,,,,,,,,,,#
y= 5  #k....k#,,RRRRRRRRR,,#
y= 6  #k....k#,,RRRRRRRRR,,#
y= 7  #......#,,RRRRRRRRR,,#
y= 8  #s....s#,,RRRRRRRRR,,#
y= 9  #o....o#,,,,,,,,,,,,,#
y=10  #......#,,,d,,,,,d,,,#
y=11  #kk..kk#,,,,,,,,,,,,,#
y=12  ###.##########.#######
y=13  #mm..................#
y=14  #........MMMM........#
y=15  #.o......C..C......o.#
y=16  #.CC..Z..RRRR..Z..CC.#
y=17  ##########DD##########
```

The counter run at row 3 spans columns 1–5 and pens rows 1–2 into a stock
alley, entered by the one flap gap at column 6. That is the same trick the
Sunken Stump uses to keep its barkeep behind the bar: the quartermaster's
`tend_counter` radius holds him at his post, so he is always where the player
expects him, while the alley itself stays reachable.

**The flap gap is not decorative.** A counter spanning all six columns would
seal the alley outright, and a sealed region is exactly what the Phase 6
reachability gate exists to catch. Do not close it.

The two archways in row 12 sit at columns 3 and 14. Check them against the
grid: `(3,11)`, `(3,13)`, `(14,11)` and `(14,13)` are all floor. The route from
`startTile` runs east to column 13, north through the muster hall, then west
along row 13 to the armoury or north through the column-14 archway to the drill
hall — which is why rows 13–16 keep an unbroken north–south lane at column 13.

## 3.3 — Staff

**Edit `src/systems/townResidents.ts`:**

- `corporal_pell` stays, `home: 'The Barracks'`, role `guard`. Rewrite his
  lines: he is now the **drill sergeant**, not a safe-room greeter.
- Add a new resident `quartermaster_dann` (name and voice yours to pick),
  role `merchant`, `home: 'The Barracks'`. Give him at least three `ambient`
  lines and at least one `lore` conversation, or `verify:interiors` fails.

**Edit `src/systems/InteriorOccupantSystem.ts`:**

```
'The Barracks': [
  { role: 'merchant', activity: 'tend_counter', anchor: 'counter', post: 'west',   residentId: 'quartermaster_dann' },
  { role: 'guard',    activity: 'idle',         anchor: 'dummy',   post: 'east',   residentId: 'corporal_pell' },
  { role: 'guard',    activity: 'wander',       anchor: 'dummy',   post: 'east' },
  { role: 'guard',    activity: 'sit_at_table', anchor: 'table',   post: 'south' },
  { role: 'laborer',  activity: 'idle',         anchor: 'crate',   post: 'west' },
  { role: 'commoner', activity: 'idle',         anchor: 'board',   post: 'south' },
]
```

This needs two new `AnchorKind`s. Add to `ANCHOR_TILE_TYPES`:
`{ kind: 'dummy', types: [TRAINING_DUMMY] }` and
`{ kind: 'board', types: [MUSTER_BOARD] }`. Widen the `AnchorKind` union to
match; it is a closed union, so the compiler will find every switch that needs
a new arm.

## 3.4 — Service one: the quartermaster's armoury

`townServices.ts` gains, under `'The Barracks'`:
`{ role: 'merchant', surface: 'menu', verb: 'Requisition' }`.

New module **`src/systems/townArmoury.ts`**, shaped like `townApothecary.ts`
(a priced menu that pushes items into the inventory and can fail on a full
bag — return `ok: false` and the panel leaves the purse alone).

Stock: the town's only **armour** counter. Pull the concrete item ids from
`src/items/` — whatever `ITEM_DEF` entries carry a defensive `statBonus`. Stock
three or four, priced above the General Store's consumables and below the
tattoo. If the item set is thin, add one or two new armour items following the
`add-item` skill rather than inventing stock that does not exist.

This deliberately does not sell weapons: the smith already says the town's
weapons come off the floor, and the garrison issuing _protection_ rather than
_edge_ keeps both counters distinct.

## 3.5 — Service two: the drill yard

`townServices.ts` gains, under `'The Barracks'`:
`{ role: 'guard', surface: 'menu', verb: 'Train' }`.

New module **`src/systems/townDrillYard.ts`**. Four rows, one per stat, each
granting **one permanent point** via `applyPermanentStat`, with:

- **A per-character cap.** Add `drillTraining: number` to `Player` (points
  bought here so far) and cap it — four total across all stats is the right
  order of magnitude. Past the cap every row shows
  `unavailable: 'Nothing left I can teach you'`.
- **An escalating price.** Price the *n*th point higher than the *n-1*th, so
  the cap is felt as diminishing returns before it is hit as a wall.
- Persistence: `drillTraining` joins `PlayerSnapshot` as an optional field
  (absent on saves predating it, defaulted through `finiteOr`) and is written by
  `snapPlayer` / read by `restorePlayer`. Without it the cap resets on every
  building entry and the sink is unlimited.

This is distinct from the tattoo (one permanent point, one design, one per
skin, 100 coins) and from the inn (timed, repeatable). Three sinks, three
shapes.

## 3.6 — The muster board

An interactable, not a service. Reuse the readable surface: add a Barracks
readable anchored to `MUSTER_BOARD` whose body is the garrison's standing
orders and current postings. `InteriorReadableSystem` places readables by
anchor kind, so add `MUSTER_BOARD` to _its_ anchor table too.

Move the existing `barracks_orders` readable onto the board, and add a second
on the map table.

## 3.7 — Sparring with the sergeant (do this last)

A non-lethal bout in the sparring ring: talk to Corporal Pell, accept, and a
practice opponent spawns in the rug ring for a fight that ends at low HP rather
than death, paying XP.

Build it on the machinery that is already here rather than a new system:

- Every interior floor already carries a full `CombatKit` — a swing indoors
  does what a swing in the dungeon does.
- `src/systems/interiorHostiles.ts` already spawns hostiles into an interior
  and `noteRoomCleared` already records the outcome in
  `TownMemory.clearedRooms` under `roomKey(buildingName, floor)`. Gate the
  bout on that key so it cannot be farmed by stepping out and back in.
- Spawn inside the ring, and remember: **`isWalkable` is not `hasRoomToMove`** —
  a one-tile gap passes the walkability test and traps whatever spawns in it.
  Use the room-to-move check.
- The opponent must not be able to kill the player. Give it a damage floor of
  effectively zero at low player HP, or yield at a HP threshold; a "training"
  fight that produces a death screen is worse than no feature.

If the surrounding work runs long, ship 3.1–3.6 and leave this out — it is the
only part of Phase 3 that is additive rather than corrective.

**Gates:** typecheck, lint, format, `verify:interiors`, `verify:town`,
`verify:friendly-fire` (3.7 introduces a combatant in a town interior).

---

# Phase 4 — Signet's Ink becomes The Quiet Needle

## 4.1 — The rename

The building's name is load-bearing across roughly twenty files. Change it in
all of them in one pass; a half-rename produces a shop with no service, no
occupants and no readables, and **none of that throws or logs**.

New name: **The Quiet Needle**. New sprite key: `quiet_needle`.

| File                                             | What changes                                      |
| ------------------------------------------------ | ------------------------------------------------- |
| `src/map/town/townPlan.ts`                       | `name`, `spriteKey`, and `sign: 'needle'`         |
| `src/map/GameMap.ts`                             | the `NAMED_BUILDINGS` entry and the `switch` case |
| `src/systems/townServices.ts`                    | the registry key                                  |
| `src/systems/InteriorOccupantSystem.ts`          | the `BUILDING_OCCUPANTS` key                      |
| `src/systems/townReadables.ts`                   | the `BUILDING_READABLES` key                      |
| `src/systems/townResidents.ts`                   | `tattooist_nim`'s `home`                          |
| `src/systems/BuildingSystem.ts`                  | the `BUILDING_NAME_ICONS` key                     |
| `src/scenes/BuildingInteriorScene.ts`            | the `openServiceMenu` case                        |
| `src/systems/townTattooParlor.ts`                | the menu `title`                                  |
| `src/core/assetGroups.ts`                        | the sprite key in the town group                  |
| `scripts/buildinggen/buildings.ts`               | `key`, `file`, `title`                            |
| `src/images/environment/buildings/manifest.json` | regenerated, not hand-edited                      |
| `docs/town.md`                                   | the district listing and the names invariant      |

Grep the whole repo for both `Signet's Ink` and `signets_ink` afterwards and
confirm zero hits outside `Tsarina Signet` herself, who is a separate character
and stays.

**Keep `replaces: 'tattoo_parlor'` in the building spec.** The frozen footprint
fixture is keyed by `replaces`, not by `key`, and it is irreplaceable — the
geometry and texture-richness gates measure against it. Changing `replaces`
would leave those gates with nothing to measure, and a gate that cannot find
its row reports green.

Re-bake the facade with `npm run gen:buildings` and gate it with
`npm run verify:buildings`. If `scripts/render-signet.ts` exists as a preview
harness, rename it alongside and update its `package.json` script.

## 4.2 — The sign

`sign: 'quill'` reads as a scribe. Add `'needle'` to `SHOP_SIGN_EMBLEMS` in
`townPlan.ts` — which widens `ShopSignEmblem` and makes
`EMBLEM_PAINTERS` in `src/sprites/shopSign.ts` fail to compile until the
painter exists, which is the intended forcing function. Paint a long needle
crossed with a ribbon of ink, in the parlour's violet.

## 4.3 — The barks

`TATTOOIST_BARKS` opens with `'They move, mine. Tsarina Signet's trick…'`. The
shop is no longer hers, so rewrite the barks to make the place its own: the
needle, the pigment, the one-per-skin rule. Keep three lines so `rotateLine`
still has something to rotate.

The mechanics do not change: four stat designs at 100 coins gated on
`Player.tattooStat`, the Brass Gullet skill mark at 250 gated separately on
`Player.skillTattoo`. That ladder is good and this phase is about the room, not
the offer.

## 4.4 — Shape

18 wide × 16 tall, floored `INTERIOR_INK_FLOOR`. `doorX = floor(18/2) - 1 = 8`,
so the exit is `(8,15)`/`(9,15)` and `startTile` is `(9,14)`.

- **The inking alcove**, columns 1–7, rows 1–6 — the reclining bench, the
  tattooist's stool, the needle brazier, pigment jars on the back shelf, and a
  rug. Entered through the single gap at column 5 in the divider row 7. This is
  where the work happens and it is private, which is the whole reason the room
  reads as a parlour instead of a shop.
- **The pigment room**, columns 9–16, rows 1–6 — the grinding slab, a work
  table with two stools, pigment shelves down both walls. Entered at column 12.
- **The waiting room**, rows 8–14, full width — the flash-art wall along the
  north side, benches, a low table, braziers flanking the door, a rug.

## 4.5 — Grid

```
y= 0  ##################
y= 1  #ppp....#....gg..#
y= 2  #..III..#....TT..#
y= 3  #...C.Z.#....CC..#
y= 4  #..RRR..#........#
y= 5  #o.....o#p......p#
y= 6  #.......#p......p#
y= 7  #####.######.#####
y= 8  #.fff.f...ff.fff.#
y= 9  #................#
y=10  #..CCCC.TT.CCCC..#
y=11  #.o............o.#
y=12  #....RRRRRRRR....#
y=13  #....RRRRRRRR....#
y=14  #k....Z....Z....k#
y=15  ########DD########
```

Both alcove gaps line up with open floor above and below: `(5,6)` and `(5,8)`
are floor either side of the row-7 gap at column 5, and `(12,6)`/`(12,8)` are
floor either side of the gap at column 12.

## 4.6 — Occupants

```
'The Quiet Needle': [
  { role: 'merchant', activity: 'work_forge', anchor: 'bench', post: 'north', residentId: 'tattooist_nim' },
  { role: 'commoner', activity: 'idle',       anchor: 'bench', post: 'south' },
  { role: 'drunk',    activity: 'idle',       anchor: 'table', post: 'south' },
]
```

`'bench'` is a third new `AnchorKind`, mapping to `[INK_BENCH]`. With
`post: 'north'` the tattooist stands at the alcove bench rather than at the
waiting-room furniture — which is the point of the whole posting mechanism from
Phase 0.6.

Give the shop two readables while you are here: a price board on a pigment
shelf and a customer's ledger on the work table.

**Gates:** typecheck, lint, format, `verify:interiors`, `verify:town`,
`verify:buildings`, `verify:assets`.

---

# Phase 5 — The remaining twelve stop looking alike

Phases 0.3–0.6 already do most of this: every building has its own shell size
and floor material, and its named NPC is no longer parked in the north-west.
This phase spends the rest of the differentiation budget where it shows.

For each building below, re-fit its existing hand-crafted case to its new
bounds from the Phase 0.3 table and apply the listed change. Keep every change
inside the existing `switch (buildingName)` structure — do not introduce a new
layout framework.

| Building              | Change                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temple of the Sky     | Now 18×18. Extend the aisle and add a third pew rank; put the altar on a raised flagstone dais reading as a distinct band.                         |
| The Rusty Anvil       | Flagstone floor. Add a partition wall separating the forge from a small front counter, with a doorway — a smithy is two rooms.                     |
| The Horned Flagon     | Now 22×16. Keep the mead-hall feast table but give it two flanking side bays formed by short stub walls.                                           |
| The Sunken Stump Pub  | Now 16×14 — deliberately the cramped one. Tighten the table clusters; the point is that it feels smaller than the Flagon.                          |
| Old Hilda's Cottage   | Now 14×14, earth floor. Densify the shelves against the smaller walls; it should feel crowded rather than shrunken.                                |
| Cartwright's Workshop | Now 20×14, earth floor. Split the workbench run with a timber-store bay along the east wall.                                                       |
| Miller's Farm         | Earth floor. Move the harvest crates into a lean-to bay behind a stub wall.                                                                        |
| Shepherd's Cabin      | Now 14×12, earth floor. One room, deliberately; it is the smallest interior in town and should read that way.                                      |
| Blackwood Lodge       | Give it what The Barracks gave up visually: bunk rows, a briefing table, a weapon rack or two. It is garrison ground and Sgt. Kessler lives there. |
| Herb & Remedy         | Now 16×14. Put the drying room behind a stub wall with a doorway; hang the counter run off the front.                                              |
| General Store         | Unchanged shell. Reorganise the shelves into two aisles rather than one perimeter run.                                                             |
| The Desperado Club    | Unchanged. It already has its own floor, its own dividers and its own stations.                                                                    |

**Every partition wall added here is a chance to seal a region.** Phase 6's
reachability gate is what catches it; run it after each building, not once at
the end.

**Gates:** typecheck, lint, format, `verify:interiors`, `verify:town`.

---

# Phase 6 — Gates and documentation

## 6.1 — New checks in `scripts/verify-interiors.ts`

Add these to the existing `check(...)` walk, which already builds real
`GameMap` interiors from `createTownPlan`:

1. **Reachability.** For every walk-in building, flood-fill from `startTile`
   over walkable tiles and assert that **every** walkable tile in the interior
   is reached. This is the single most important new gate: a partitioned
   interior that seals a wing produces no error, no log and no visible symptom
   except a room the player can see and never enter.
2. **The safe room exists, in exactly one building.** Assert exactly one entry
   with `hasSafeRoom === true`, that its interior registers a non-empty
   `safeRooms`, and — separately — that `planSafeRoomCounters` over that
   interior returns a counter run that does **not** overlap any archway tile.
   State the second one as its own check: the archway collision is the failure
   mode Phase 1.3 exists to prevent, and it would otherwise only show up as an
   unreachable wing.
3. **Every declared service is reachable.** Already partly covered; extend it
   to the multi-service registry — one NPC per declared role, and no two
   services in a building sharing a role.
4. **Every new anchor kind has furniture somewhere.** `forBuilding` drops an
   occupant whose anchor group is empty _without a warning_. Assert that each
   of `dummy`, `board` and `bench` matches at least one tile in the building
   whose roster names it.
5. **Every stat boon is registered.** For each type in `STAT_BOON_BONUSES`,
   assert `statusVisual(type)` is defined and `harmful === false`. An
   unregistered boon shows as a grey harmful pill and nothing says so.

Write each check so it can **fail**. A check that skips on a missed string
lookup reports green while measuring nothing — that is how a whole gate goes
quiet. After writing them, mutate the code each one guards (seal a wing, drop a
`STATUS_VISUALS` row, give two services the same role) and confirm the gate
goes red before reverting.

## 6.2 — Existing gates

`npm run verify:town`, `verify:buildings`, `verify:assets`, `verify:menus`,
`verify:kits`, `verify:friendly-fire`. The service-panel restructure in Phase
0.2 touches overlay-claiming code paths, so `verify:menus` and `verify:kits`
are not optional here: every claim must still name its focus context, and the
`haltsWorld` flag must still match whether `update()` early-returns.

## 6.3 — `docs/town.md`

It is one of the four durable reference docs and it is now wrong in three
places. Update:

- The district listing — the Low Quarter names The Quiet Needle.
- The names invariant — the renamed building, and the fact that safe-room-ness
  is now `hasSafeRoom` on the plan rather than `kind: 'restaurant'`. Note that
  `BuildingKind` no longer has a `restaurant` member.
- Anything describing The Barracks as the town's safe room.

## 6.4 — Delete this plan

Once every phase above has shipped and every gate is green, delete
`docs/town-interior-rework-plan.md`. A shipped plan is scaffolding, and leaving
it invites a later agent to trust a document describing work that has already
moved on.

---

# Traps this plan is written around

Read these before starting; each one has already cost someone a debugging
session in this codebase.

- **The Bopca counter will seal a centred archway.** `planSafeRoomCounters`
  centres its run on the safe-room bounds' north wall. The inn's archway is at
  columns 3–4 for exactly this reason.
- **A CON boon that does not sync `maxHp` leaves the HP bar lying.** Jugg
  Juice's loan is written around the same trap; copy its discipline.
- **`tempStatMods` is not in `PlayerSnapshot`.** A boon built on it dies at the
  inn's front door.
- **A tile must be in both decoration registries** — `DECORATION_TYPES` and
  `DECORATION_OVERLAY_TYPES` — or it renders as bare floor.
- **`forBuilding` silently drops an occupant whose anchor group is empty.**
  Adding an anchor kind without adding matching furniture deletes the NPC with
  no error. This is how three taverns lost their innkeepers once already.
- **A misspelled registry key is invisible from both directions.** The building
  reports no service, the service names no building, and the gate goes green
  having measured nothing. Keep the rename pass atomic.
- **Inserting a material into a sheet's list re-rolls every material after it.**
  Append only.
- **`isWalkable` is not `hasRoomToMove`.** A one-tile gap passes the first and
  traps whatever spawns there.
- **The service worker serves a stale bundle.** Unregister it before trusting
  any in-browser check of this work.
- **A gate that cannot find its row reports green.** After writing each new
  check, mutate the thing it guards and watch it go red.
