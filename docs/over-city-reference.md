# The Over City — Source Reference (Third Floor)

Reference notes on the third floor as it appears in the source material (_Carl's Doomsday Scenario_, Dungeon Crawler Carl book 2). The game's third-floor content — the dangerous ruins, the circus questline, the murder mystery, and the doomsday finale — is **already implemented**; this document is kept as background for future content work that wants to stay faithful to the book.

> For how the third-floor town is generated, rendered and tuned, see [town.md](town.md).

---

## Setting

The third floor is **the Over City** — the first floor of the "Volcano" storyline. It is a sprawling ruined city sitting atop a magical volcano-world. A poison catastrophe (Scolopendra's curse) transformed most of the former population into monsters. What remains is a network of **heavily guarded, medieval-style villages separated by dangerous, monster-filled urban ruins**:

- **Safe-ish villages** — walled settlements with NPC guards, shops, and inns. The major one Carl and Donut visit is a skyfowl (bird-folk) city.
- **The ruins** — everything between settlements. Overrun with mutated former citizens. This is where random combat happens.
- This is the first floor where **quests become common**, and the first floor featuring **Elite NPCs** — high-level named characters starring in their own Syndicate TV shows, whose scripted dramas crawlers can get pulled into.
- The floor timer is **cut short by the system AI** (traditionally ~20 days, forced down to 8) — time pressure is a core theme.

## Arrival beats

- Carl and Donut reunite with **Mordecai**, who is freed from his guildhall and becomes their **manager**.
- They pick **new races and classes**: Carl becomes a Primal with the _Compensated Anarchist_ class (bomb-making focus); Donut keeps her cat race and takes _Former Child Actor_ (which is why Mordecai can manage her).
- **Mongo** the pet dinosaur is with them from floor 2.

## Quest 1 — Grimaldi's Traveling Circus / "Vengeance of the Daughter"

- Near a skyfowl settlement, Carl and Donut are caught spying on a ruined circus by **Tsarina Signet** — a level 60 Elite NPC, half-naiad half-high-elf Summoner covered in living, moving tattoos. She is the star of the Syndicate drama _Vengeance of the Daughter_.
- Signet **kidnaps Donut** to force Carl to help her destroy the monsters of Grimaldi's circus.
- The circus is a corrupted band of mutated performers: **stilt clowns** (long-limbed "Slender Man dressed as a clown" horrors), **fat clowns**, **Former Circus Lemurs**, **Mold Lions**, mutated **giraffes**, **ogres**, and the infamous **Terror the Clown**.
- The true core: **Ringmaster Grimaldi**, the level 85 **City Boss**, has become a _Pestiferous Vine_ — a parasitic plant creature that sustains and endlessly **resurrects the whole troupe**, trapping his circus family in torment.
- Carl realizes both Signet and Grimaldi actually want the family _freed_, and that a spectacular kill is what the show's producers want. He uses his knowledge of the show's scripted backstory as leverage, cuts a deal with the producers, defeats the circus, frees the performers, and rescues Donut.

## Quest 2 — The Krasue Murder Mystery

- At the **Desperado Club** (a members-only, crawler-and-NPC club whose third-floor entrance is in the Over City), the NPC **GumGum** approaches them with a quest — which Mordecai warns them to ignore.
- GumGum turns up **murdered in an alley**, and Carl and Donut investigate.
- The trail: a necromancer is murdering the city's sex workers and turning them into **krasue** — disembodied flying heads with trailing entrails (Southeast Asian folklore monsters).
- The culprits are **Miss Quill** and her husband **Remex**, who are secretly usurping the magistrate **Featherfall**, aided by a cult of **city elves** who believe the skyfowl are angels.

## The Finale — the Soul Crystal / "Carl's Doomsday Scenario"

- Quill's true plan: a spell powered by harvested souls (channelled through Remex, transformed into a living capacitor) designed to **kill every non-skyfowl inhabitant** of the city.
- The team assaults the magistrate's office with explosives and kills Quill, but the town's **soul crystal destabilizes** — minutes from a city-levelling explosion.
- Carl contains the exploding crystal inside an **enchanted glass display box** and pulls it into his inventory, where it becomes the item **"Carl's Doomsday Scenario"** — a city-levelling bomb he carries for the rest of the series.
- A secondary explosion (Remex's body) starts a ~20-minute countdown. They flee for the stairwell, **Katia** detonates pre-planted bombs, and they evacuate dozens of crawlers and thousands of NPCs down to floor 4.

**As the game implements it**, the countdown is one clock with two stages: the crystal
must be contained first, and only then does the escape stairwell south of the tower door
become usable — stepping on it before containment shows a warning rather than doing
anything. The stairwell itself is visible for the whole countdown, so the player always
knows where to run. Reaching it in the escape stage ends the run: the game saves, then
shows a summary of the run's stats.

## The Desperado Club's cast, as the game implements it

The game only reaches floor 3, so every club character gets only what they have
intrinsically at that point in the books — species, look, personality, class and core
fighting style. Nothing a character gains on a later floor (Bomo's Teleport to
Stairwell, Sledge's Zerzura, anything from the Faction Wars) is in, and no line
refers to later events.

**Staff.**

- **Clarabelle** works the front door: a Crocodilian bouncer, lizard-faced, level 40,
  a non-combatant. Bored, transactional, fond of money, and immune to charm — if the
  cat is the one at the door she says Charisma doesn't work on her. She reads the club
  rules (no fighting, neutral ground) and hands over the pass.
- **Rosemarie** runs the **Meat Shields** mercenary desk: an elderly, stooped, hobbling
  female dwarf, crude and cheerful and a little dangerous. **Bernie**, a black-and-white
  fuzzy mole with blue-heeler markings, rides her shoulder. In the books she throws coins
  at the dancers, aiming for their eyes; her figure has the flick as its own row.
- **Doctor Bones** stays the DJ; he is not for hire.
- **The VIP Private Escort** is two cretin bodyguards per visit, sold separately and free
  after heavy spending at the tables. The pair is **The Sledge and Bomo**; while either
  of them is out on a Meat Shields contract, **Clay-ton and Very Sullen** work the escort
  instead, so one cretin is never in two places. Clay-ton and Very Sullen are escort-only
  and cannot be hired.

**The hire roster**, cheapest first. Every hireling wears an orange Meat Shields armband
(the desk's colour) so a hired rock golem can be told from a wild one.

| Hire         | Species     | Role       | Price | Kit                                                                                                                                                                                                  |
| ------------ | ----------- | ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket Boy   | Crocodilian | Medic      | 120   | Seeks no fights; follows close, flees anything that gets near, casts Triage (a heal of 15% of max HP) on whoever of the party, Mongo or himself is under half health, slaps only when cornered.      |
| Gluteus Maxx | Unknown     | Brawler    | 220   | Reckless: engages from further out and ranges further, never backs off when hurt. Alternating left and right gauntlet jabs; sits on a nearly dead non-boss foe to finish it (the Glute Crush).       |
| Splash Zone  | Otter       | Water Mage | 260   | Holds 3–5 tiles off and shoots crossbow bolts, stepping back from anything in his face; with three or more foes in front of him, rolls a wave that hurts and washes them back. Never in a safe room. |
| Dong Quixote | Human       | Lancer     | 280   | Lance thrust with long reach; charges a foe 3–7 tiles down a clear lane, running down and knocking aside everything in it, then stands winded. Never charges through a friend.                       |
| Tumbledown   | Rock Golem  | Heavy      | 300   | Meat Shields' non-sapient equipment rental: the rock golem's slam and stomp, and a thrown boulder at range. Grunts, never speaks.                                                                    |
| Bomo         | Cretin      | Bodyguard  | 300   | Punches; casts a damage-absorbing Shield on whichever ally is worst hurt, Mongo included, and steps into the path of whatever is closing on a hurt owner.                                            |
| The Sledge   | Cretin      | Bodyguard  | 350   | Punches; casts the same Shield, cat first; whoever hurts the cat becomes his target. Does the robot with her after a fight. Wears the cowboy hat, pink boa and pinback button.                       |

**Damascus Steel** (an Ifrit dancer) is on Meat Shields' books but refuses crawlers: he
is a greyed-out entry at the foot of the desk list, and Rosemarie says so.

**Contract rules**, as Meat Shields sells them in the books:

- One contract at a time, **paid up front**.
- The contract runs to the **end of the floor it was signed on, or the hireling's
  death**, whichever comes first. A hire does not follow the party to the next floor, and
  restoring a checkpoint does not bring back a contract that has ended.
- **No refunds**, for either ending. Rosemarie mentions the dead on the next visit and
  reminds the player the fee stands.
- **Dismissal only at the desk** — a hireling cannot be fired in the field.
- A dead hireling leaves a body that fades, and **cannot be looted**.
- Hirelings talk: each has lines for being hired, idling, engaging, kills, low health,
  their special, the owner or the cat getting hurt, dying, the floor ending, and being
  talked to.

**Hireling survival, as the game implements it.** A hire takes only half of every blow
(Mongo takes 0.6× on his own contract), including one-point damage-over-time ticks, which
land at the full multiplier on average rather than being rounded away. Standing with no
damage taken, no attack started and nothing engaged for 15 seconds snaps it back to full
HP; below two fifths health, on a cooldown, it drinks a bottomless supply of healing
draughts. A hire brought to 0 HP goes down instead of dying outright: untargetable and
unharmable, it waits up to 15 seconds — paused while a crawler stands over it — for
either crawler to revive it, the same range and channel time a knocked-out crawler is
revived by. A revive brings it back at a sliver of its health. Leaving the scene, a
building or a tower storey while a hire is down ends its contract for good; a body cannot
be carried through a door. A hire and Mongo alike follow the party indoors — into every
shop, the club, safe rooms and every tower storey, and back out — with health carried
across on the roster.

## Supporting cast met on this floor

| Character              | Role                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| Tsarina Signet         | Elite quest-giver/ally; summoner; Grimaldi's wife                     |
| Ringmaster Grimaldi    | City Boss — Pestiferous Vine                                          |
| Miss Quill / Remex     | Hidden villains of the murder mystery                                 |
| Magistrate Featherfall | Skyfowl magistrate being usurped                                      |
| GumGum                 | Quest hook NPC, murdered                                              |
| Hekla                  | Leader of Brynhild's Daughters (crawler guild); wants to poach Donut  |
| Katia                  | Doppelganger crawler (Monster Truck Driver class) who joins the party |
| Odette                 | Talk-show host who interviews them after the floor                    |
| Prince Stalwart        | Skull Empire orc prince; bombs their production trailer               |

## Sources

- [The Over City (Third Floor) — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Third_Floor)
- [Carl's Doomsday Scenario — Summary & Study Guide, SuperSummary](https://www.supersummary.com/carls-doomsday-scenario/summary/)
- [Tsarina Signet — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Tsarina_Signet)
- [Grimaldi's Traveling Circus — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Grimaldi's_Traveling_Circus)
- [Ringmaster Grimaldi — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Grimaldi)
- [Terror the Clown — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Terror_the_Clown)
- [Former Circus Lemur — DCC Wiki](https://dungeon-crawler-carl.fandom.com/wiki/Former_Circus_Lemur)
- [Carl's Doomsday Scenario (Item) — DCC Wiki](<https://dungeon-crawler-carl.fandom.com/wiki/Carl's_Doomsday_Scenario_(Item)>)
- [Carl's Doomsday Scenario — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Literature/CarlsDoomsdayScenario)
- [Carl's Doomsday Scenario — Matt Dinniman](https://mattdinniman.com/books/carls-doomsday-scenario/)
