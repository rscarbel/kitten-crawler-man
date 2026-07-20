# Third Floor Plan — The Over City

This document captures what the third floor is in the source material (*Carl's Doomsday Scenario*, Dungeon Crawler Carl book 2), what the game's `level3` currently has, and the design strategy for closing the gap. The step-by-step build order lives in [third-floor-implementation.md](third-floor-implementation.md).

---

## Part 1: The Third Floor in the Book

### Setting

The third floor is **the Over City** — the first floor of the "Volcano" storyline. It is a sprawling ruined city sitting atop a magical volcano-world. A poison catastrophe (Scolopendra's curse) transformed most of the former population into monsters. What remains is a network of **heavily guarded, medieval-style villages separated by dangerous, monster-filled urban ruins**:

- **Safe-ish villages** — walled settlements with NPC guards, shops, and inns. The major one Carl and Donut visit is a skyfowl (bird-folk) city.
- **The ruins** — everything between settlements. Overrun with mutated former citizens. This is where random combat happens.
- This is the first floor where **quests become common**, and the first floor featuring **Elite NPCs** — high-level named characters starring in their own Syndicate TV shows, whose scripted dramas crawlers can get pulled into.
- The floor timer is **cut short by the system AI** (traditionally ~20 days, forced down to 8) — time pressure is a core theme.

### Arrival beats

- Carl and Donut reunite with **Mordecai**, who is freed from his guildhall and becomes their **manager**.
- They pick **new races and classes**: Carl becomes a Primal with the *Compensated Anarchist* class (bomb-making focus); Donut keeps her cat race and takes *Former Child Actor* (which is why Mordecai can manage her).
- **Mongo** the pet dinosaur is with them from floor 2.

### Quest 1 — Grimaldi's Traveling Circus / "Vengeance of the Daughter"

- Near a skyfowl settlement, Carl and Donut are caught spying on a ruined circus by **Tsarina Signet** — a level 60 Elite NPC, half-naiad half-high-elf Summoner covered in living, moving tattoos. She is the star of the Syndicate drama *Vengeance of the Daughter*.
- Signet **kidnaps Donut** to force Carl to help her destroy the monsters of Grimaldi's circus.
- The circus is a corrupted band of mutated performers: **stilt clowns** (long-limbed "Slender Man dressed as a clown" horrors), **fat clowns**, **Former Circus Lemurs**, **Mold Lions**, mutated **giraffes**, **ogres**, and the infamous **Terror the Clown**.
- The true core: **Ringmaster Grimaldi**, the level 85 **City Boss**, has become a *Pestiferous Vine* — a parasitic plant creature that sustains and endlessly **resurrects the whole troupe**, trapping his circus family in torment.
- Carl realizes both Signet and Grimaldi actually want the family *freed*, and that a spectacular kill is what the show's producers want. He uses his knowledge of the show's scripted backstory as leverage, cuts a deal with the producers, defeats the circus, frees the performers, and rescues Donut.

### Quest 2 — The Krasue Murder Mystery

- At the **Desperado Club** (a members-only, crawler-and-NPC club whose third-floor entrance is in the Over City), the NPC **GumGum** approaches them with a quest — which Mordecai warns them to ignore.
- GumGum turns up **murdered in an alley**, and Carl and Donut investigate.
- The trail: a necromancer is murdering the city's sex workers and turning them into **krasue** — disembodied flying heads with trailing entrails (Southeast Asian folklore monsters).
- The culprits are **Miss Quill** and her husband **Remex**, who are secretly usurping the magistrate **Featherfall**, aided by a cult of **city elves** who believe the skyfowl are angels.

### The Finale — the Soul Crystal / "Carl's Doomsday Scenario"

- Quill's true plan: a spell powered by harvested souls (channelled through Remex, transformed into a living capacitor) designed to **kill every non-skyfowl inhabitant** of the city.
- The team assaults the magistrate's office with explosives and kills Quill, but the town's **soul crystal destabilizes** — minutes from a city-levelling explosion.
- Carl contains the exploding crystal inside an **enchanted glass display box** and pulls it into his inventory, where it becomes the item **"Carl's Doomsday Scenario"** — a city-levelling bomb he carries for the rest of the series.
- A secondary explosion (Remex's body) starts a ~20-minute countdown. They flee for the stairwell, **Katia** detonates pre-planted bombs, and they evacuate dozens of crawlers and thousands of NPCs down to floor 4.

### Supporting cast met on this floor

| Character | Role |
|---|---|
| Tsarina Signet | Elite quest-giver/ally; summoner; Grimaldi's daughter |
| Ringmaster Grimaldi | City Boss — Pestiferous Vine |
| Miss Quill / Remex | Hidden villains of the murder mystery |
| Magistrate Featherfall | Skyfowl magistrate being usurped |
| GumGum | Quest hook NPC, murdered |
| Hekla | Leader of Brynhild's Daughters (crawler guild); wants to poach Donut |
| Katia | Doppelganger crawler (Monster Truck Driver class) who joins the party |
| Odette | Talk-show host who interviews them after the floor |
| Prince Stalwart | Skull Empire orc prince; bombs their production trailer |

### Sources

- [The Over City (Third Floor) — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Third_Floor)
- [Carl's Doomsday Scenario — Summary & Study Guide, SuperSummary](https://www.supersummary.com/carls-doomsday-scenario/summary/)
- [Tsarina Signet — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Tsarina_Signet)
- [Grimaldi's Traveling Circus — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Grimaldi's_Traveling_Circus)
- [Ringmaster Grimaldi — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Grimaldi)
- [Terror the Clown — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Terror_the_Clown)
- [Former Circus Lemur — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Former_Circus_Lemur)
- [Carl's Doomsday Scenario (Item) — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Carl's_Doomsday_Scenario_(Item))
- [Carl's Doomsday Scenario — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Literature/CarlsDoomsdayScenario)
- [Carl's Doomsday Scenario — Matt Dinniman](https://mattdinniman.com/books/carls-doomsday-scenario/)

---

## Part 2: What `level3` Has Today

- `src/levels/level3.ts` — `isOverworld: true`, `isSafeLevel: true`, `mapSize: 280`. Only spawns are 12 passive `sky_fowl` around map center. No bosses, no quests, no unique enemies, no timer.
- `src/map/OverworldGenerator.ts` — already generates a lot of usable geography:
  - A walled-feeling **town** with named buildings (Sleeping Cat inn, Rusty Anvil forge, Miller's Farm, Wanderer's Rest, Sunken Stump, barracks, general store, restaurant, shepherd's cabin, Hilda's, cartwright).
  - A **main tower** (`MAIN_TOWER`, `TowerStairSystem`) and enterable buildings (`BuildingSystem`, `BuildingInteriorScene`).
  - A **circus** placed 70–90 tiles from town — big top + side tents with circus-striped roofs, connected by road. Currently **pure decoration**: no mobs, no quest, big top not a boss arena.
  - Forests, roads, safe rooms, stairwell tiles.
- Quest infrastructure exists and has two working exemplars: `DefendQuestSystem` (state-machine mini quest with `QuestNPC`, dialog, waves, rewards) and `SpiderQuestSystem`. `QuestManager` is a minimal available/active/completed/failed tracker.
- Mordecai and Mongo already exist and have `level3` special-casing.

**The bones are all there.** The town = the fortified settlement; the circus = Grimaldi's; skyfowl already spawn. What's missing is: danger outside town, the circus questline (Signet + performers + Grimaldi boss), the town murder-mystery questline (krasue + Miss Quill), and the soul-crystal finale.

---

## Part 3: Design Strategy — Mapping Book to Game

Guiding principle: **adapt the three-act structure of the book onto the map we already generate**, reusing existing systems (quest state machines, boss rooms, building interiors, dialog) rather than inventing new tech.

### 3.1 World structure: safe town, dangerous ruins

The book's core geography is *safe villages inside deadly ruins*. Today the whole floor is `isSafeLevel`. Change to **zone-based safety**:

- **Town zone** (inside the torch ring / town square area): remains safe. Guards at the edges sell the fantasy of a protected settlement.
- **Ruins zone** (everything outside town, between town and circus/forests): hostile spawns. Scatter ruined-building shells and rubble via `OverworldGenerator` so the outside reads as "destroyed city," not open countryside.
- **Circus zone**: quest-gated — circus mobs are part of the questline, not ambient spawns.
- Keep sky fowl as ambient fauna; they fit (skyfowl are this floor's civilized race — the *town* NPCs should read as bird-folk too).

### 3.2 Unique enemy roster

Ambient ruins mobs (ordered by build priority):

| Mob | Book basis | Gameplay sketch |
|---|---|---|
| **Krasue** | Flying disembodied heads | Fast, erratic flier; night/quest-spawned; low HP, high damage |
| **Ruins Ghoul** (mutated citizen) | Poison-transformed populace | Basic melee shambler; the ruins' bread-and-butter mob |
| **City Elf Cultist** | Quill's cult | Ranged caster; appears in murder-mystery quest beats |

Circus mobs (quest-gated, spawned around/in the circus):

| Mob | Book basis | Gameplay sketch |
|---|---|---|
| **Stilt Clown** | "Slender Man dressed as a clown" | Tall sprite, long reach, lunging strikes |
| **Fat Clown** | Fat clowns | Tanky; explodes into confetti + gore on death |
| **Former Circus Lemur** | Mutated lemurs | Small, fast, swarms (reuse SmallSpider-style pack AI) |
| **Mold Lion** | Mold lions | Mid-tier bruiser with a poison (mold) aura |
| **Terror the Clown** | Named mini-boss | Sideshow-tent mini-boss guarding the big top |
| **Ringmaster Grimaldi** | Level 85 City Boss — Pestiferous Vine | Big-top boss: rooted vine core + waves of resurrected performers. Killing performers is temporary until vine tendrils are destroyed — the resurrection gimmick from the book |

### 3.3 Elite NPC: Signet

- New NPC (`Signet`), visually distinct (tattooed elf), found near the circus.
- Quest-giver and **ally combatant** for the circus questline — as a Summoner she periodically summons a friendly creature during the fights (reuses companion/ally patterns from `CompanionSystem`/`MongoSystem`).
- Her show, *Vengeance of the Daughter*, gives the quest UI flavor ("You are now an extra in a Syndicate production").

### 3.4 The three questlines

**Questline A — "Vengeance of the Daughter" (the circus):**

1. **The hook:** approaching the circus triggers Signet catching the player spying. Adaptation of the kidnap beat: Signet takes **Mongo** hostage (kidnapping the player's companion mirrors Donut's kidnap without needing a second player character).
2. **Clear the sideshows:** each side tent holds a themed encounter (lemurs / clowns / mold lions) with Terror the Clown in the last.
3. **The big top:** Grimaldi boss fight with the resurrection-vine mechanic; Signet fights alongside you.
4. **Resolution:** freeing the performers (not just slaughtering them) — after the vine core dies, a short dialog beat with Signet; Mongo returned; big XP + loot-box reward.

**Questline B — "The Krasue Murders" (the town):**

1. **The hook:** GumGum approaches the player in town (or at the Desperado Club, see 3.6) with a vague plea; Mordecai warns you off. Later, GumGum's body is found in an alley — quest becomes active.
2. **Investigation:** 3–4 clue interactions around town (alley, docksides/wells, a victim's home), light dialog-driven detective work.
3. **Night attack:** krasue swarm event in town streets.
4. **The cult:** trail leads to a city-elf cult hideout (a building interior); fight cultists, learn Quill is behind it.
5. **Confrontation:** magistrate's office (the main tower fits perfectly) — Miss Quill boss fight, with Remex as a static "capacitor" objective.

**Questline C — "Doomsday Scenario" (the finale, auto-starts when B completes):**

1. Quill's death destabilizes the **soul crystal** — a visible countdown starts (~7 minutes).
2. Player must reach the crystal and contain it → receives the **"Doomsday Scenario"** inventory item (a legendary trophy item; whether it's usable as a weapon can be decided later — as a trophy first).
3. Second countdown (~escape timer): reach the stairwell before the city blows. Town NPCs flee alongside (pure ambience). Failing the timer = death by explosion (ties into the existing death-cause system).
4. Descending during the countdown ends the floor with an achievement.

### 3.5 Floor timer

Once questline C exists, flip `level3` off `isSafeLevel` and give the floor the standard countdown treatment other floors have — the book's shortened-timer pressure. (Optional first pass: no global timer, only the questline-C countdowns.)

### 3.6 The Desperado Club (stretch)

A club interior accessible from a marked door in town: music, a bouncer (the Sledge), a shop with club-exclusive stock, and GumGum's quest hook. Low priority — the murder mystery can hook from a street NPC first and move into the club later.

### 3.7 Explicitly out of scope (for now)

- Race/class selection on arrival (big system; separate design doc if wanted).
- Hekla/Katia/party members, Prince Stalwart/Skull Empire, Odette interviews — later-book connective tissue, not needed for the floor to feel like the book.
- Making "Doomsday Scenario" a usable city-levelling weapon (balance nightmare; trophy item first).

---

## Part 4: Suggested build order (summary)

1. **Phase 1 — Dangerous ruins:** zone-based spawning, ruined-building decoration, Ruins Ghoul + Krasue mobs. *The floor stops being a walking simulator.*
2. **Phase 2 — The circus questline:** Signet, circus mobs, Terror mini-boss, Grimaldi city boss, Mongo-kidnap quest chain. *The floor's marquee content.*
3. **Phase 3 — The murder mystery:** GumGum, clue investigation, cultists, Miss Quill + Remex, tower confrontation.
4. **Phase 4 — The finale:** soul crystal, Doomsday Scenario item, escape sequence, floor timer.
5. **Phase 5 — Polish/stretch:** Desperado Club, sounds/music per zone, achievements, minimap markers.

Each phase ships independently and leaves the game playable. Full task breakdown: [third-floor-implementation.md](third-floor-implementation.md).
