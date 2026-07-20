# The Desperado Club — Design Plan

This document captures what the **Desperado Club** is in the *Dungeon Crawler Carl* books, what the game already has to build on, and the design strategy for adding the club as the third floor's social hub. The step-by-step build order lives in [desperado-club-implementation.md](desperado-club-implementation.md).

This is the deep-dive expansion of **Phase 5 → "Desperado Club"** from [third-floor-plan.md](third-floor-plan.md#36-the-desperado-club-stretch). Phases 1–4 of the third floor (dangerous ruins, the circus questline, the murder mystery, the doomsday finale) are already implemented; this document promotes the club from a one-line stretch goal into its own multi-phase feature.

---

## Part 1: The Desperado Club in the Books

### What it is

The Desperado Club is a **members-only, cross-floor "instance" nightclub** — a neutral social hub shared by crawlers and dungeon NPCs alike. It first appears in *Carl's Doomsday Scenario* (book 2), with its top level opening on the **third floor** (the Over City). It is one of **two** dungeon clubs a crawler can belong to; the other is the more exclusive **Club Vanquisher**, and the two memberships are **mutually exclusive** — obtaining a Desperado Pass permanently forfeits any chance at a Vanquisher pass.

Crucially for us: the club is a **safe zone**. No combat happens inside. It is a place to spend gold, gather information, make deals, and hire help.

### Aesthetic

- An **art deco tower crowned by a spinning neon knife**.
- A **1920s / Prohibition-era** vibe — concrete columns, sunburst motifs, smoky low light, jazz.
- A loud, packed, flashing-light **dance floor** at its heart.

### Rooms & amenities (canon)

| Space | What it is |
|---|---|
| **Dance floor** | The central room — loud, smoke-filled, flashing lights, a crowd, a DJ. |
| **Bars** | Drinks and socializing. |
| **Casino** | Gambling tables; spending enough there earns perks (see below). |
| **Markets** | Shops selling club-exclusive goods. |
| **Brothels / strip clubs** | Canonically named "Bitches" and "Penis Parade." **We deliberately abstract these into a tasteful "VIP Lounge"** — see §3.7. |
| **Privacy bubbles** | Fields that let patrons make discreet/black-market deals unobserved. |
| **Mercenaries Guild ("Meat Shields")** | A mercenary market on the club's top level, run by a hidden dwarf manager named **Rosemarie**. Crawlers spend "Meat Shields coupons" to hire NPCs, whose contracts transfer them into the crawler's **guild barracks** to fight alongside the party. |

### Notable NPCs (canon)

| NPC | Role |
|---|---|
| **The Sledge** | A **Cretin** (a ~7-foot tuxedoed rock-monster) working security. Hireable as a private bodyguard. |
| **Bomo** | Another Cretin bodyguard, close friend of the Sledge. |
| **Rosemarie** | Dwarf woman who secretly manages the Meat Shields mercenary market on the top floor. |
| **Doctor Bones** | A skeleton **DJ**. |
| **Bucket Boy** | A flavor NPC / hireable performer. |

### Canon mechanics worth stealing

- **Private security:** starting on the fourth floor, the club sells bodyguards for **300 gold per crawler / 500 gold per pair, per visit** — two guards who follow you anywhere in the club. If you **spend more than that at the casino tables, the next visit's security is free.**
- **Mercenary hiring:** a coupon-driven contract moves an NPC into your guild's barracks as a fighting mercenary.
- **Membership is a status you earn**, not a place you stumble into.

### Sources

- [Desperado Club — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Desperado_Club)
- [Desperado Club — Bookworm Wiki](https://wiki.bookwormai.app/dungeon-crawler-carl/world/desperado-club-2)
- [The Sledge — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Sledge)
- [Damascus Steel (Meat Shields mercenary) — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Damascus_Steel)
- [Guilds — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Guilds)
- [Casino — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Casino)
- [The Over City (Third Floor) — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Third_Floor)

---

## Part 2: What the Game Has Today

The club is a **building interior**, and the game already has a mature building-interior stack we can lean on almost entirely:

- **Enterable buildings.** `OverworldGenerator.placeBuilding()` stamps a building onto the overworld and registers a `BuildingEntry { doorTile, name, type }`. `BuildingSystem` detects the player on a door tile, shows an "Enter?" menu, and calls back into `DungeonScene`, which swaps to a `BuildingInteriorScene`. On exit it swaps back to the overworld at the tile south of the door. **Adding one more building + one more `type` is a well-worn path.**
- **`BuildingInteriorScene`** (`src/scenes/BuildingInteriorScene.ts`) generates an interior map via `GameMap.generateInterior(type, floor, name)`, then conditionally instantiates helper systems based on `entry.type`:
  - `entry.type === 'restaurant'` → `SafeRoomSystem` (bed to sleep, Mordecai to chat).
  - `entry.type === 'store'` → `ShopSystem` (a wandering shopkeeper + buy panel).
  - `entry.type === 'tower'` → 4-floor stack + `TowerStairSystem`.
  - Named buildings (`Big Top`, `Blackwood Barracks`) → live combat encounters.
  This conditional-helper pattern is **exactly** how the club's systems should attach.
- **`ShopSystem`** (`src/systems/ShopSystem.ts`) — a wandering vendor with a proximity "Shop" prompt and a buy panel backed by a hardcoded `SHOP_ITEMS` list and `player.coins`. Currently single-vendor, single item list; we'll generalize it to be configurable.
- **`SafeRoomSystem`** — bed-rest + an NPC (Mordecai) you talk to, whose dialog is generated through `aiAdapter.chatWithMordecai(...)` with a scripted structure. A good template for club NPC conversations.
- **`MongoSystem`** (`src/systems/MongoSystem.ts`) — a summonable friendly `Mob` (Mongo the raptor) that follows the cat, attacks nearby enemies, auto-recalls at low HP, and is dismissed on floor/interior transitions. **This is the template for a hired mercenary that fights alongside you in the overworld.**
- **Cross-scene progress objects.** Quest state survives the overworld↔interior scene swaps by being threaded through constructors: `circusQuestProgress`, `murderQuestProgress`, `doomsdayQuestProgress` (see `src/core/CircusQuestProgress.ts` etc. and how `DungeonScene` passes them into `BuildingInteriorScene` and back). **Club membership + hired mercenaries persist the same way.**
- **`player.coins`** is the gold currency, already displayed in the inventory panel. No new currency needed.
- **UI kit.** `src/ui/TextBox.ts` (`drawText`/`TEXT_PRESETS`), `src/ui/Box.ts` (`drawModal`/`drawBox`/`drawOverlay`), `src/ui/Button.ts` (`drawButton`/`BUTTON_PRESETS`), `src/ui/InteractionPrompt.ts` (`drawInteractionPrompt`) cover every panel and prompt the club needs.
- **Music.** `AudioManager` + a music manifest already carry per-zone tracks (`village_square`, `circus_theme`, etc.); adding a `desperado_club` track and playing it on interior enter is routine (`add-sound` skill).

**The bones are all there.** The club is "a big multi-room interior with several NPC interaction stations and a couple of new sub-panels (casino, mercenary guild), that grants a persistent membership flag and can spawn a persistent overworld ally." Nothing here requires new engine tech — it's new content assembled from proven systems.

### The one genuinely new system

The **hired mercenary** is the only feature that crosses the scene boundary in a new way: it's created inside the club but must *live and fight in the overworld*. We solve this exactly like Mongo (a friendly `Mob` with follow+attack AI) plus a persisted roster object (like the quest-progress objects) so the hire survives the club→overworld swap.

---

## Part 3: Design Strategy

Guiding principle (same as the third-floor plan): **adapt the book onto the systems we already have.** Reuse `BuildingInteriorScene`'s conditional-helper pattern, `ShopSystem`, `MongoSystem`'s ally lifecycle, and the progress-threading pattern. Invent as little as possible.

### 3.1 Structure: one multi-room interior, not a tower

**Decision: the club is a single large single-floor interior with several rooms carved into one `GameMap` grid**, connected by internal doorways — *not* a multi-floor tower.

Rationale:
- The book's *other* club levels (Hunting Grounds, Larracos) open on floors 6 and 9, which don't exist in the game. Only the top level belongs on floor 3, so there is nothing to stack yet.
- `BuildingInteriorScene`'s multi-floor path is tightly coupled to `TowerStairSystem` and boss encounters; bending it to a club is more work than laying out rooms in one grid.
- A single grid with a minimap (which the interior scene already renders) reads clearly as "a club with a dance floor, a bar over there, the casino in back."

If a future floor wants to add the Hunting Grounds level, the tower's multi-floor mechanism is the natural upgrade path — noted, but out of scope now.

### 3.2 The rooms

One interior grid (~24×18 tiles), carved into connected rooms:

| Room | Contents | System |
|---|---|---|
| **Vestibule** (entry) | The Sledge greets you; states the house rules; this is where the membership gate lives. | `DesperadoClubSystem` (greeting/rules dialog) |
| **Dance floor** (center) | Animated multi-color light tiles, a crowd of cosmetic dancing NPCs, Doctor Bones the DJ. Pure ambiance. | `DesperadoClubSystem` (render only) |
| **The Bar** | Bartender NPC; buy club-exclusive **drinks** (temporary buff consumables). | generalized `ShopSystem` |
| **The Casino** | A dealer NPC; a coin-wager minigame (high-low). Tracks lifetime wager for the free-security perk. | `ClubCasinoSystem` |
| **The Market** | Vendor NPC; buy club-exclusive **gear/items** you can't get in the village store. | generalized `ShopSystem` |
| **Mercenaries Guild** ("Meat Shields") | Rosemarie NPC; hire a mercenary who follows you into the overworld and fights. | `MercenaryGuildSystem` + `Mercenary` creature |
| **VIP Lounge** | Quiet back room (privacy-bubble adaptation); pay to fully heal + receive a short buff; hire the Sledge/Bomo as in-club bodyguards (cosmetic escort). | `DesperadoClubSystem` |

### 3.3 Membership (the Desperado Pass)

- New persisted flag `hasDesperadoPass` on a `ClubMembership` progress object, threaded through scenes like the quest-progress objects and saved via the existing save hook.
- **First visit:** the Sledge stops you at the vestibule. Free membership is granted after a short rules dialog (keep the gate lightweight — this is content, not a paywall). Flag flips true.
- Optional book-flavor: mention that taking the pass forecloses Club Vanquisher (we have no Vanquisher, so it's pure flavor text).

### 3.4 Gold sinks & the casino perk

Everything in the club spends `player.coins`:
- Drinks (bar), gear (market), the VIP heal/buff, mercenary contracts, bodyguard hire.
- **Casino** high-low minigame wagers coins. Track **lifetime coins wagered this visit**; if it exceeds the bodyguard price, the VIP bodyguard hire is free that visit — a faithful nod to the canon "spend enough at the tables and security is free" rule.

### 3.5 The Mercenaries Guild (the marquee feature)

The one feature with real cross-scene weight. Design:
- Rosemarie's panel lists 2–4 hireable mercenaries (name, class flavor, price, a one-line stat summary).
- Hiring deducts coins and records the merc on a persisted `MercenaryRoster`.
- Back in the **overworld**, `DungeonScene` reads the roster and spawns a `Mercenary` `Mob` that follows the player and auto-attacks nearby hostiles — lifecycle modeled directly on `MongoSystem` (spawn near player, follow, attack, recall/despawn on death, dismissed on interior transitions, re-spawned on return).
- Scope guard: **one active mercenary at a time** for the first pass (the roster can hold the hire; only one walks with you). Multiple simultaneous mercs is a later polish.

### 3.6 Ambiance: music, lights, crowd

- A dedicated **`desperado_club`** music track, started on interior enter and restored on exit to the overworld's music (the interior scene already has an `audio` handle and the overworld already manages its own music).
- **Dance-floor light tiles**: a new animated tile type whose color cycles per-frame (cheap `Date.now()`-driven palette cycle), plus a handful of cosmetic dancer sprites that bob in place.
- A **spinning neon knife** marker over the club's roof in the overworld to make the building unmistakable (a simple animated overlay on the building tile, or a dedicated sprite building — see implementation §1.2).

### 3.7 Content adaptation note (brothels)

The canonical "Bitches" / "Penis Parade" rooms are adapted into a **non-explicit "VIP Lounge"** — a quiet paid back room offering a heal, a short buff, and the bodyguard-hire. This keeps the club faithful in *function* (a premium members' back room, privacy bubbles, paid perks) while staying appropriate for this game's tone. This is a deliberate design choice, not an oversight.

### 3.8 Optional integration with existing quests

- **GumGum hook relocation (optional):** the murder mystery currently hooks GumGum at the Sunken Stump pub. The book actually has him approach at the Desperado Club. This is *optional* and should be a clearly separable step — the murder questline works today and must not regress.
- **Mordecai flavor:** Mordecai can warn you about the club / the mercenary contracts, reusing the `aiAdapter` dialog surface.

### 3.9 Explicitly out of scope (for now)

- The club's lower levels (Hunting Grounds floor 6, Larracos floor 9).
- Club Vanquisher (the rival club).
- Multiple simultaneous mercenaries; mercenary leveling/persistence across floors.
- Explicit adult content (see §3.7).
- A full card/dice engine — the casino is one simple high-low minigame.

---

## Part 4: Suggested Build Order (summary)

Each phase ships independently and leaves the game fully playable. Full task breakdown with file/line detail: [desperado-club-implementation.md](desperado-club-implementation.md).

1. **Phase 1 — Club shell:** new `club` interior type, multi-room layout, a club building + neon-knife marker in town, enter/exit, dance-floor lights + music, the Sledge's greeting, and the persisted membership flag. *You can walk into the Desperado Club.*
2. **Phase 2 — Bar & Market:** generalize `ShopSystem` to be config-driven; add the bartender (drinks/buffs) and market (club-exclusive gear) vendors. *The club becomes a gold sink with unique stock.*
3. **Phase 3 — Casino:** the high-low wager minigame + lifetime-wager tracking. *Gambling works; big spenders earn the free-security perk.*
4. **Phase 4 — Mercenaries Guild:** Rosemarie, the hire panel, the persisted `MercenaryRoster`, and the `Mercenary` overworld ally (Mongo-pattern). *You can hire muscle that fights beside you outside.*
5. **Phase 5 — VIP Lounge & polish:** paid heal/buff, Sledge/Bomo bodyguard escort, achievements, dev-URL jump, AI-driven NPC banter, optional GumGum relocation. *The club feels alive and complete.*

### Sequencing & risk notes

- Phase 1 is a hard prerequisite for all others (it creates the interior and its host system).
- Phases 2 and 3 are independent of each other and of Phase 4.
- **Highest technical risk is Phase 4** (cross-scene ally): prototype the `Mercenary` spawn/follow/despawn against `MongoSystem` first, and the roster persistence against `circusQuestProgress` threading, before wiring the hire panel.
- Second risk is the **generalized `ShopSystem`** (Phase 2): it must stay backward-compatible with the existing General Store, so add an *optional* config parameter rather than changing the current call site's behavior.
</content>
</invoke>
