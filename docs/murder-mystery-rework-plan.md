# The Krasue Murders: Story and Final Battle Rework

This plan reworks the murder-mystery quest line (`krasue_murders`) so the story hangs
together as an actual detective plot, and rebuilds the Lich finale into a four-phase
boss fight. It's written to be executed task by task by an implementing agent.

All player-facing text is specified verbatim in this document. Don't write new prose,
don't paraphrase, don't "improve" a line. If a beat seems to need a line this document
doesn't provide, wire the beat without text and leave a `TODO(dialog)` code comment.

Source grounding: the quest adapts "The Sex Workers Who Fell from the Heavens" from
_Carl's Doomsday Scenario_ (Dungeon Crawler Carl book 2). The game's existing
adaptation choices stay in place: the victims are "the low-street folk," GumGum is a
street elf rather than an orc, and the finale chains into the existing soul-crystal
Doomsday sequence (the game's version of the book's "The Fools Who Broke the Glass").

---

## 1. Goals

1. A real mystery. The player pieces the case together from clues that each yield a
   deduction. The evidence points first at Magistrate Featherfall (the book's red
   herring), then at Miss Quill, and finally at the Lich, the thing that has been
   signing Featherfall's letters. The book's core idea carries the whole plot: the one
   doing the killing is not the one who wants the killing done. That exact idea
   already exists as a fortune line in `townFortunes.ts`; the rework pays it off.
2. Every beat caused by the one before it. Nothing happens "because it's next." The
   causal chain is spelled out in section 3.
3. A finale worth the climb: a confirm gate on the last staircase, an opening
   cutscene, and a Lich with 2.5x HP and four distinct phases (baseline, fire-wave
   gauntlet, orb-rain dodge with daze windows, then baseline plus orb rain).

---

## 2. Ground rules for implementing agents

- Load the relevant skill before each task: `add-quest`, `add-ui`, `add-item`,
  `add-sprite`, `add-sound`, `add-system`, `game-architecture`, `dev-workflow`.
- Read `docs/difficulty-fairness-rules.md` before tuning any damage, telegraph, or
  hazard timing in the final battle. Telegraphs must respect the game-wide minimum
  telegraph floor of 21 frames. Every constant in section 6 is above it.
- Every task ends with the gates: `npm run typecheck`, `npm run lint`,
  `npm run format`. All must exit clean.
- Donut's dialogue is rendered in ALL CAPS. This is the single most recognizable
  voice trait from the source books ("I AM YELLING CARL"). Task T1 converts her
  existing murder-quest lines too.
- Known codebase traps that will bite this work (each is flagged again in its task):
  - Moving a mob from a system requires updating the mob grid (`mobGrid.move`), or
    attacks and separation go stale.
  - Projectiles and hazards owned by a Mob die with the Mob. The orb rain and fire
    waves must be owned by the battle system, not by `TheLich`.
  - `Scene.loop` can run two updates per rAF callback, so collision checks belong in
    the update step, not the render step.
  - A menu opened under a held key must demand a fresh key press before accepting it.
  - Every new modal needs an `overlayClaims` entry, and every button set needs a
    `focusContext` (`beginMenuFocus`/`endMenuFocus`). `verify:menus` enforces this.
  - Quest markers read only inside `update()` freeze while a dialog is open. Keep
    using the `syncMarkers()` pattern `MurderMysteryQuestSystem` already has.

---

## 3. The story bible

### What actually happened

This is the truth of the case, for the implementing agent. It is never dumped on the
player; they assemble it from the beats below.

- The Lich is an ancient dead thing that answered a grieving woman's ritual. Years
  ago Miss Quill, the town's prim schoolteacher turned magistrate's secretary, tried
  to resurrect her dead husband, Remex. The ritual reached something old. It took the
  bargain: it rebuilt Remex as a soul capacitor, a docile hollow vessel that stores
  harvested souls, and it promised Quill that when the vessel was full, her husband
  would be poured back in whole.
- The promise was a lie. The Lich feeds on the harvest. To keep the harvest flowing
  it needed the town's machinery, so it murdered Magistrate Featherfall at his desk
  and has been answering his correspondence in a polite hand ever since. His office
  signs the writs that keep the Watch away from the low streets.
- Quill selects the victims. Low-street folk nobody files a report about, invited
  with courteous notes ("Evening lessons. Come alone."). The city-elf cult, who
  believe the skyfowl are angels and Quill their prophet, does the carrying. The soul
  is torn out at the tower; the leavings become krasue. The bodies get dumped from
  the tower roost by night, which is why they seem to fall from the sky.
- GumGum saw a taking. She approached the crawlers at midday. The cult silenced her
  that same night, but the letter she'd lifted from a cult courier stayed in her
  coat, along with the courier's magistrate's writ.
- The moment the crawlers pocket the letter, the Lich can see and hear through it
  (the game's version of the book's Suppurating Eye spell). Everything the party does
  during the investigation is observed. The night attack isn't random. It's the Lich
  trying to erase two witnesses who are getting close.

### The deduction chain the player experiences

| Beat                                            | Evidence gained                                                                                                                                                          | What the player concludes                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook                                            | GumGum's story                                                                                                                                                           | Someone harvests the forgotten; nobody official cares                                                                                           |
| The alley                                       | GumGum dead in one night; the Magistrate's Writ; the Unreadable Letter (Mordecai: necro-script, so something dead gives the orders)                                      | She was watched; Featherfall's paper shields the killers; a lich or necromancer is involved                                                     |
| Well clue                                       | Talon gouges plus schoolroom chalk                                                                                                                                       | A skyfowl did the taking; someone bookish was present                                                                                           |
| Cottage clue                                    | "Evening lessons. Come alone." in a neat schoolteacher hand                                                                                                                        | The victims were invited, by someone respectable they trusted                                                                                   |
| Roost clue                                      | Cult shrine below the tower, blood arc going up                                                                                                                          | The cult worships the skyfowl; victims go up the magistrate's tower. Everything points at Featherfall, except that nobody has seen him in weeks |
| The taunt                                       | The letter answers them: "No, you won't."                                                                                                                                | The letter is a window; the killer has been watching since the alley                                                                            |
| Night attack                                    | Krasue converge on the party specifically; brass Blackwood button; wax and cellar smell                                                                                  | The cult handles the krasue; the watcher sent them                                                                                              |
| Cult cellar                                     | Duty ledger of struck-through names signed Miss Quill, sealed with a feather in black wax; "bring the next lessons to my capacitor at the top of the magistrate's tower" | Quill harvests and the magistrate's office authorizes. A conspiracy, and both answers at the top of one tower                                   |
| (Optional) Deacon Aviel and the temple readable | Featherfall missed thirty years of seventh-days; polite notes "in a hand that is not his"                                                                                | Doubt: is Featherfall alive at all?                                                                                                             |
| The office                                      | Quill stonewalls; Featherfall's corpse; Remex revealed as her enslaved husband                                                                                           | Quill is the murderer, but she believed she was buying her husband back                                                                         |
| The reveal                                      | The voice: "He signs his letters. He suspects nothing. I have seen to it."                                                                                               | The Lich wanted the killing done. Quill was the knife; this is the hand                                                                         |

### Continuity with existing content (keep, don't rewrite)

- Deacon Aviel's three lore sets and the `temple_watchers` readable already carry the
  Featherfall-doubt thread. Leave them alone.
- The `lodge_cellar_letter` readable, the surgeon/guard/tavern-keeper reactive lines,
  `townNotices.murderNotice`, and the fortunes stay as they are except where section
  5 explicitly replaces a line.
- The Doomsday chain out of `finishConfrontation` (crystal tile, containment stage,
  wall-clock deadline) is untouchable. See section 8.

---

## 4. Voice guide

For the implementing agent's judgment calls only. The lines themselves are in
section 5.

- Carl: blunt and casual, thinks out loud in plain sentences. Understates horror,
  jokes when things are bad, goes quiet when they're worse. No exclamation points.
- Donut: ALL CAPS, always. Appends "CARL" to sentences. Vain, theatrical, showbiz
  obsessed, styles herself as royalty ("THE PRINCESS POSSE"), and genuinely brave and
  sweet at odd moments.
- Mordecai (in your ear): italic asterisked lines, world-weary manager. Warns, gets
  ignored, knew he would be.
- Miss Quill: prim schoolmarm menace. Classroom and ledger vocabulary: lessons,
  syllabus, records, untidy.
- The Lich: calm bureaucratic eternity. Office vocabulary: appointments, letters,
  accounts, signatures. It never raises its voice until the tantrum phase.
- Narrator (speaker `The Krasue Murders`): plain and grim, present tense, second
  person. A dry aside is fine; poetry is not.

---

## 5. The full script

Speaker constants already exist in `src/systems/murderQuestDialogs.ts` (`GUMGUM`,
`NARRATOR`). Add `CARL = 'Carl'`, `DONUT = 'Donut'`, `MORDECAI = "Mordecai (in your ear)"`,
`QUILL = 'Miss Quill'`, and `LICH = 'A voice from everywhere'` as needed. Each numbered
entry below is one page: speaker, then body. The advance-button label sits in brackets
at the end of each dialog.

### Scene A: `HOOK_DIALOG` (GumGum outside the Desperado Club; replaces existing)

1. GumGum: "Psst. Crawlers. Over here. No, don't look around, look at ME. Name's
   GumGum. I got no coin and no class worth spit, but I got eyes. And my eyes have
   seen where the missing ones go."
2. GumGum: "People are vanishing off the night streets. My friends. Low-street folk,
   the kind nobody files a report about. They turn up mornings, from the shoulders
   down. The Watch won't come. Nobody comes for us."
3. Donut: "CARL. THIS POOR WOMAN NEEDS OUR HELP. ALSO, I HAVE ALWAYS WANTED TO BE A
   DETECTIVE. I HAVE THE CHEEKBONES FOR IT. THE PRINCESS POSSE IS TAKING THE CASE."
4. GumGum: "Meet me in the alley beside the Desperado Club after dark and I'll show
   you where they take them. Please. You're the first ones who looked at me instead
   of through me."
5. Mordecai: "_Walk away from this one. A stranger with a sad story on this floor is
   bait, and you two bite on everything. ...You're going to do it anyway, aren't you.
   Fine. Then do me one favor. If you find anything on a dead body down here, leave
   it on the dead body. I mean it._" [After dark, then]

### Scene B: `BODY_FOUND_DIALOG` (the alley; replaces existing)

1. The Alley: "GumGum lies crumpled behind the Desperado Club, a day cold at least.
   She never made the meeting. Somebody made certain of that the same night she asked
   for help. The body ends at the shoulders. There is no head."
2. Carl: "She talked to us at noon and she was dead by midnight. That's not bad luck.
   Somebody was watching her. Or watching us."
3. Donut: "I AM NOT LOOKING AT THE NECK PART, CARL. I AM LOOKING AT HER COAT. THERE
   IS PAPER STICKING OUT OF HER COAT. DETECTIVES NOTICE THINGS LIKE THAT."
4. The Alley: "Two papers, tucked where a pickpocket wouldn't bother to look. The
   first is a magistrate's writ, the ink barely dry: 'The bearer acts on my authority
   and is not to be detained.' Signed, Magistrate Featherfall." _(grants item:
   Magistrate's Writ, see T2)_
5. The Alley: "The second is a letter in no alphabet you know. Squiggles and
   triangles, written in a brown ink you are choosing not to think about." _(grants
   item: The Unreadable Letter, see T2)_
6. Mordecai: "_Hold it up so I can see it. ...Yeah. That's necro-script. Living
   people don't write it. Their hands can't make the shapes. Whatever is running this
   thing, it's already dead. So here's my advice. Burn that letter and walk away from
   all of it._"
7. Carl: "She died trying to hand somebody this. I'm not burning it. Okay. The one
   witness is dead, the magistrate's paperwork was on her body, and whoever wrote
   this doesn't breathe. Let's go find out what the town knows." [Investigate]

### Scene C: the three clues (replace existing clue dialogs)

`WELL_CLUE_DIALOG`, two pages:

1. The Town Well: "Deep gouges score the well's rim. Talons, and drag marks where
   something heavy was hauled up out of hiding. Crushed into the mud beside them: a
   stick of schoolroom chalk, worn to a stub."
2. Donut: "CHALK, CARL. WHO BRINGS CHALK TO A WELL? TEACHERS, THAT'S WHO. TEACHERS
   AND MURDERERS. AND I AM STARTING TO WONDER IF THAT IS ONE PERSON." [Noted]

`HOME_CLUE_DIALOG`, two pages:

1. Old Hilda's Cottage: "Claw furrows rake the paving outside Hilda's cottage, ending
   in a pool and a few torn scraps of a visitor's shawl. The door stands latched from
   the inside, untouched. Tucked under the knocker, a note in a neat schoolteacher
   hand: 'Evening lessons. Come alone.' It is unsigned."
2. Carl: "She was invited. They all were, probably. Nobody goes out alone at night to
   meet a stranger. You go because it's somebody respectable. Somebody you'd feel
   stupid saying no to." [Noted]

`ROOST_CLUE_DIALOG`, three pages:

1. The Tower Plaza: "Beneath the magistrate's tower, moulted skyfowl feathers lie
   arranged in a careful ring. A shrine: elf-made candles, fresh wax. Something burst
   through it since. The feathers are flung wide, and blood is thrown in an arc up
   the tower stone. Whatever took the victim went up."
2. Carl: "So the cult prays down here, and the blood goes up there. Featherfall's
   roost is at the top of this tower. His paperwork was on the body, and now there's
   blood on his walls. Everything keeps coming back to the magistrate."
3. Donut: "THEN WHERE IS HE, CARL? NOBODY HAS SEEN HIM IN WEEKS. EVEN VILLAINS TAKE
   CURTAIN CALLS. ESPECIALLY VILLAINS, ACTUALLY." [Noted]

### Scene D: `TAUNT_AND_NIGHTFALL_DIALOG` (new; fires where `NIGHT_FALLS_DIALOG` fires now, and replaces it)

1. The Unreadable Letter: "The letter in your pack grows warm. The ink crawls,
   rearranges itself, and settles into plain script, in the same neat schoolteacher
   hand as the note on Hilda's door: 'No, you won't.'"
2. Carl: "We didn't ask anything out loud. It answered anyway. This thing isn't a
   letter. It's a window, and somebody has been on the other side of it since the
   alley."
3. Mordecai: "_I told you to burn it. It has your faces now. Listen to me. Whatever
   has been taking people one at a time is about to try for two at once, and the sun
   is almost down. Get somewhere with walls._"
4. Donut: "GOOD. LET THEM COME, CARL. I HAVE BEEN PRACTICING MY DETECTIVE FACE, AND
   ALSO MY LASERS."
5. The Krasue Murders: "The sun drops behind the ruins. Somewhere over the rooftops a
   wet shriek answers the dusk bell, then a dozen more, closing from every quarter.
   They are not hunting the town tonight. They are hunting you. Survive it." [Defend
   yourselves]

### Scene E: `AFTERMATH_DIALOG` (replaces existing)

1. The Krasue Murders: "The last head bursts in a spray of ichor. Tangled in its
   trailing hair: a brass button stamped with the Blackwood Barracks crest, and a
   reek of candle wax and cellar damp."
2. Carl: "Krasue don't own buttons. Somebody hauled these things across town and let
   them loose at our door. The thing in the letter did the watching, and the cult did
   the carrying. Same as with the victims."
3. Donut: "THEN THE CULT HAS AN ADDRESS, CARL. BLACKWOOD LODGE. WE ARE GOING TO GO
   KNOCK VERY, VERY LOUDLY." [To the Lodge]

### Scene F: `HIDEOUT_CLEARED_DIALOG` (replaces existing)

1. The Krasue Murders: "In the cellar, under the guttered candles: a duty ledger of
   names. Low-street names, GumGum's among them, each struck through in a neat
   schoolteacher hand. The final page is an instruction: 'Bring the next lessons to
   my capacitor at the top of the magistrate's tower.' It is signed 'Miss Quill', and
   sealed with a feather pressed into black wax."
2. Carl: "The schoolteacher. The chalk at the well, the note about evening lessons,
   handwriting too neat for a butcher. She does the collecting, and the magistrate's
   office keeps the Watch off her back. That writ on GumGum's body was a leash."
3. Donut: "A TEACHER AND A MAGISTRATE, CARL. IT IS A CONSPIRACY. AND SINCE BOTH OF
   THEM ARE AT THE TOP OF THAT TOWER, I PLAN TO MAKE AN EXTREMELY DRAMATIC ENTRANCE."
4. Mordecai: "_Quill I believe. This town is full of quiet little monsters. It's
   Featherfall that bothers me. Thirty years of temple every seventh day, and then
   nothing but polite notes in handwriting that isn't his? Talk to the deacon before
   you climb that tower. Then climb it angry._" [To the tower]

### Scene G: the final-stair confirm gate (new; see T5)

Shown when ascending the tower's last staircase while the finale is live. The text is
exact and non-negotiable:

- Body: "This will initiate a tough final battle for this floor. Are you sure you
  want to proceed?"
- Buttons: "No, I have more to do." (default, focused, primary) and "Yes, I'm ready."

### Scene H: `QUILL_OFFICE_DIALOG` (new; plays on arriving at the top floor, before the Quill fight)

1. The Top Floor: "The magistrate's office is spotless. The ledgers are current. The
   ink is fresh. At the great desk by the north wall, someone sits very still in the
   gloom. Between you and the desk, at a tidy secretary's station, perches an elderly
   skyfowl in spectacles, pen scratching away as though two armed crawlers walk in
   every day."
2. Miss Quill: "You are not in the appointment ledger. The magistrate sees
   petitioners on the seventh day. You may leave your names with me. I keep excellent
   records."
3. Carl: "We're done with appointments. People are dying in the low streets, your
   cult burned down last night, and your name is signed at the bottom of their duty
   ledger. Where's Featherfall?"
4. Miss Quill: "The magistrate is at his desk, where he has always been. He is simply
   particular about visitors. As am I."
5. Donut: "CARL. THE BIRD AT THE BIG DESK HAS NOT MOVED SINCE WE CAME IN. OR
   BLINKED. OR BREATHED. I HAVE WORKED WITH SOME VERY WOODEN ACTORS, CARL, AND THAT
   IS NOT AN ACTOR."
6. Miss Quill: "Hm. It was the chalk, I suppose. Or the note. I did tell her to come
   alone. Witnesses make everything so untidy. Well. You have interrupted years of
   careful work, children, and I am afraid the syllabus does not allow for
   interruptions. Mr. Remex? Ring the bell."
7. The Krasue Murders: "The thing beside the desk unfolds. A skyfowl shape with no
   feathers left, eyes like black glass, something pale steaming off it like heat off
   a summer road. It does not want to be here. It does what she says anyway." [Ready
   weapons]

Then the existing banner (`MISS QUILL — THE HEADMISTRESS` with its current subtitle),
and the fight proceeds as it does today: Remex shield, guards, summons, all
unchanged.

`FEATHERFALL_EXAMINE_DIALOG` (the optional corpse examine during the fight) is kept
exactly as it stands.

### Scene I: `LICH_REVEAL_DIALOG` (replaces existing; still unskippable)

1. The Krasue Murders: "Miss Quill drops mid-sentence, and for one long moment her
   floating pen keeps writing without her, striking one last name from a list. Then
   it clatters to the boards, and the office is quiet."
2. Carl: "The magistrate's a corpse. The secretary ran the harvest. That should be
   the end of it. So why does this room still feel like somebody's in it?"
3. A voice from everywhere: "Because the magistrate keeps his appointments. He signs
   his letters. He suspects nothing, and he never will. I have seen to it."
4. A voice from everywhere: "The teacher believed the souls were for her husband.
   That enough of them would buy him back whole. Grief will sign anything you put in
   front of it. It does not read the terms."
5. Donut: "CARL. THE DEAD THING AT THE DESK IS THE NICE PART OF THIS ROOM."
6. Mordecai: "_That's a lich. The letter, the writs, the harvest. You were never
   chasing the schoolteacher. You were chasing the thing that holds her leash. Kill
   it, and don't count it dead until the fire in that hood goes out._" [Ready
   weapons]

### Scene J: final-battle barks, banners, and objective lines (see section 6 for triggers)

Phase 1 banner: keep the existing one (`THE LICH — MAGISTRATE IN ALL BUT BODY` with
its current subtitle).

Phase 2 (firewall), Lich bark then banner:

- The Lich: "Enough. Stand at the back of the office, and wait to be seen."
- Banner: `THE APPOINTMENT`, subtitle `Thread the fire. Reach the Lich.`
- Boss-bar objective line: `Thread the fire. Reach the Lich.`

Phase 3 (tantrum), Lich bark then banner:

- The Lich: "You were told to WAIT."
- Banner: `THE TANTRUM`, subtitle `Survive the rain until the Lich tires.`
- Boss-bar objective line while dodging: `Survive the rain ({seconds}s)`
- Boss-bar objective line while dazed: `The Lich is spent. Strike it now! ({n} more)`

Phase 4 (reckoning), Lich bark then banner:

- The Lich: "No more appointments. The office is closed."
- Banner: `NOTHING LEFT TO SIGN`, subtitle `Finish it.`
- Boss-bar objective line: `Finish it`

Defeat message for every Lich phase: keep the existing one, `The magistrate's office
kept its appointment.`

### Scene K: `VICTORY_DIALOG` (new; plays when the Lich dies, before the Doomsday chain arms)

1. The Krasue Murders: "The robe folds over nothing and settles on the boards. The
   seal at its belt, Featherfall's seal, cracks down the middle. Somewhere beneath
   the floorboards, something enormous begins, very slowly, to wake."
2. Carl: "For GumGum. Somebody looked."
3. Donut: "AND THE PRINCESS POSSE HAS CLOSED THE CASE, CARL. I WILL BE ACCEPTING
   AWARDS SHORTLY." [It's not over]

Then the existing victory banner (`THE MAGISTRACY IS EMPTY`) and the Doomsday
containment sequence exactly as today.

---

## 6. Final battle design

### 6.1 Shape of the fight

The Quill fight doesn't change. `TheLich` gains a phase structure driven by a new
`LichBattleSystem` (see T8). The lich's own state machine (idle, then cast or hands
or summon, then cooldown) becomes its "baseline kit" and runs only in phases 1 and 4.

Total HP: `LICH_HP = 475` (2.5 times the current 190, still passed through
`questMobLevel` as today, so it levels with the party the same way).

| Phase | Name                             | Lich behavior                                                                                         | Ends when                                                                                                                        |
| ----- | -------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Onslaught                        | Baseline kit, exactly today's fight                                                                   | HP falls to `FIREWALL_TRIGGER_HP_FRACTION = 0.6` of max, meaning the player has dealt one entire "current fight" worth of damage |
| 2     | The Appointment (firewall)       | Anchored at the north wall above the desk; casts fire waves; damage-immune except to close-range hits | The player reaches it and lands one damaging hit                                                                                 |
| 3     | The Tantrum (orb rain)           | Floats out of reach, rains warned orbs; 10 clean seconds of dodging puts it into a vulnerable daze    | Two damaging hits landed during daze windows, cumulative                                                                         |
| 4     | Nothing Left to Sign (reckoning) | Baseline kit again, plus a slower orb rain                                                            | HP reaches 0                                                                                                                     |

Phase state lives on the battle system and is captured and restored with the rest of
the confrontation checkpoint state. A party death mid-fight restarts the Lich fight
from phase 1 with full lich HP, matching how a death restarts it today.

### 6.2 Phase 2: the firewall

- Transition: the lich becomes untargetable by its own AI, slides to its north-wall
  anchor (`mobGrid.move` on every system-driven mob move), and both party members
  slide to the south wall over `PUSH_SLIDE_FRAMES = 36` with input suppressed during
  the slide. Play the Scene J bark and banner during the slide.
- Waves: a wave is a full-width row of fire spawned at the lich's row, traveling
  south. Each wave has exactly one gap of `FIREWALL_GAP_WIDTH_TILES = 2`. Consecutive
  waves' gap columns differ by at most `FIREWALL_GAP_MAX_SHIFT_TILES = 3`, so a
  player moving laterally at walk speed can always make the next gap. This bound is a
  fairness contract and the verify script in T15 asserts it.
- Timing: `FIREWALL_WAVE_INTERVAL_FRAMES = 120`. Each wave's spawn row gets a
  `drawDangerTile` telegraph for `FIREWALL_TELEGRAPH_FRAMES = 30` before igniting.
  Tune wave travel speed so a wave crosses the room in roughly 3 to 4 seconds:
  visibly faster than the player's retreat, slower than their lateral dodge. Extract
  the chosen value as `FIREWALL_TRAVEL_FRAMES_PER_TILE`.
- Getting hit: `FIREWALL_HIT_DAMAGE = 3` to whoever was hit, then the stage resets.
  All waves clear, both party members slide back to the south wall, and spawning
  resumes after `FIREWALL_RESET_GRACE_FRAMES = 60`. The real cost of a mistake is
  repetition, not HP; per `docs/difficulty-fairness-rules.md`, repetition punishment
  and damage punishment shouldn't stack heavily.
- Damage gating: the lich is immune during this phase unless the damage source is
  within `LICH_STRIKE_RANGE_TILES = 2`. A Magic Missile sniped from the back row must
  not skip the gauntlet. Reuse the `isDamageImmune` / `onDamageBlocked` pattern from
  `MissQuill`, with the shield flash on blocked hits so the immunity reads as a
  mechanic and not a bug.
- The first damaging hit that lands moves the fight to phase 3.
- Companion: the battle system issues a companion directive (T10) pointing at the
  current safe gap column at the back row. The companion holds there. It does not
  advance north and does not attack during this phase.

### 6.3 Phase 3: the tantrum

- Transition: the player slides to room center (same slide mechanics), waves clear,
  bark and banner play, and the lich starts floating.
- Floating: the battle system drives the lich along the room perimeter, steering away
  from the player, at `LICH_FLOAT_SPEED_RATIO = 1.75` times player speed.
  Unreachable by design, and damage-immune while floating (same blocked-hit flash).
- Orb rain: warned impact circles (`drawDangerCircle`) appear on the floor for
  `ORB_WARNING_FRAMES = 50`, then the orb lands: `ORB_IMPACT_RADIUS_TILES = 1.1`,
  `ORB_DAMAGE = 4`. Spawn cadence `ORB_SPAWN_INTERVAL_FRAMES = 20`, with at most
  `MAX_CONCURRENT_ORB_WARNINGS = 8` live warnings. One orb in three targets the
  player's current tile; the rest land at random room tiles. Live warnings must never
  cover every walkable neighbor of the player's tile. That fairness invariant is also
  asserted by the verify script.
- The dodge clock: `DODGE_SURVIVAL_FRAMES = 600` (10 seconds). Render it as a
  progress bar under the boss bar plus the Scene J objective line. Any orb hit on the
  player deals damage and resets the clock to zero. Companion hits don't reset the
  clock; the companion dodges via the hazard interface (T10).
- The daze: at a full clock, orb spawning stops, live warnings resolve, and the lich
  descends to the room center, dazed for `DAZE_FRAMES = 180` and fully vulnerable
  (use the lich sheet's new `dazed` row, T13). Hits landed during a daze increment a
  counter; at `DAZE_HITS_REQUIRED = 2`, cumulative across daze windows, the fight
  moves to phase 4. If the daze expires short of the count, the lich rises and the
  float-and-rain loop repeats.
- The falling orb, its warning circle, and its impact burst are owned by
  `LichBattleSystem`. Never store them on the `TheLich` mob; a mob-owned projectile
  dies with the mob.

### 6.4 Phase 4: the reckoning

- The lich's baseline kit resumes. Its own state machine takes back over: bolts,
  grasping hands, summons, all as in phase 1, including the bolt-count escalation,
  which by now is at maximum.
- Orb rain continues at `RECKONING_ORB_SPAWN_INTERVAL_FRAMES = 55` with the same
  warning and damage numbers and the same never-box-in fairness invariant.
- Fight to zero HP. Death triggers Scene K, then the untouched Doomsday chain.

### 6.5 HUD summary

- The boss bar persists across all phases (existing `renderBossBar`), with the
  objective line per Scene J.
- Phase 3 adds the dodge-clock progress bar. Use `drawProgressBar` with an existing
  preset; don't hand-roll it.
- Banners via `drawQuestBanner`; barks via the existing dialog widgets during the
  scripted slides. The world is already held during slides, so a brief page is safe.

---

## 7. Task breakdown

Execute in order. Tasks marked as parallelizable can run alongside their neighbors.
Every task ends with typecheck, lint, and format, all clean.

### T1: Dialog data overhaul

Load `add-quest`. In `src/systems/murderQuestDialogs.ts`:

- Replace `HOOK_DIALOG`, `BODY_FOUND_DIALOG`, `WELL_CLUE_DIALOG`, `HOME_CLUE_DIALOG`,
  `ROOST_CLUE_DIALOG`, `AFTERMATH_DIALOG`, `HIDEOUT_CLEARED_DIALOG`, and
  `LICH_REVEAL_DIALOG` with the section 5 scripts, verbatim.
- Delete `NIGHT_FALLS_DIALOG`. Add `TAUNT_AND_NIGHTFALL_DIALOG` (Scene D) in its
  place and update the one call site in `MurderMysteryQuestSystem.update()`. Keep the
  same re-offer behavior: it must reopen every frame until accepted so an Esc can't
  strand the quest.
- Add `QUILL_OFFICE_DIALOG` (Scene H) and `VICTORY_DIALOG` (Scene K). They get wired
  in T6 and T12; exporting them here is enough for now.
- Add the new speaker constants from the section 5 preamble.
- Leave `FEATHERFALL_EXAMINE_DIALOG` untouched.

Acceptance: no remaining reference to `NIGHT_FALLS_DIALOG`; every section 5 line
appears verbatim; Donut has no lowercase dialog line anywhere in this file.

### T2: Quest items, the Writ and the Letter (parallelizable)

Load `add-item`. Add two quest items:

- `magistrates_writ`, "Magistrate's Writ". Description: "'The bearer acts on my
  authority and is not to be detained.' Signed, Magistrate Featherfall. The ink is
  barely dry. The magistrate has not been seen in weeks."
- `unreadable_letter`, "The Unreadable Letter". Description: "Squiggles and triangles
  in a brown ink you are choosing not to think about. Mordecai called it necro-script
  and told you to burn it. It is warm."

Both: no use action, not sellable, not droppable while the quest is open. Grant them
in `MurderMysteryQuestSystem` when `BODY_FOUND_DIALOG` completes, in the same
callback that advances the stage. Grant them in code: a `DialogReward` strip is a
preview, not a grant, so if you show the strip you still hand the items over in the
completion callback.

Acceptance: after the alley scene both items are in inventory, and a checkpoint
restore during `investigation` retains them. Inventory snapshots should already cover
items; confirm by reading the checkpoint path and fix only if quest items are
excluded.

### T3: Beat wiring for taunt, letter, and aftermath causality

Load `add-quest`. In `MurderMysteryQuestSystem`:

- The Scene D dialog plays where nightfall triggered before: all clues found, dialog
  opens, `beginNightAttack()` on close. No stage-union change is needed; the taunt is
  the front half of the same dialog.
- Check the tracker entries against the new script and update two hints:
  - `investigation` hint: "The well, Hilda's door, and the plaza under the tower. The
    letter in your pack stays warm."
  - `confrontation` hint: "Miss Quill's 'capacitor' waits at the top of the
    magistrate's tower. So does whatever signs Featherfall's letters."
- Everything else (markers, glow, the `syncMarkers()` pattern) stays as is.

Acceptance: playing straight through, the order is clues, then the taunt-and-nightfall
dialog, then the night attack, then the aftermath, then the lodge, then the
hideout-cleared dialog, with no stage able to skip or double-fire. Use one-shot guard
flags the way the system already does.

### T4: Ambient text alignment (parallelizable)

A small text-only pass:

- `CultHideoutSystem` objective string after clearing: "The letter names Miss Quill,
  and it bears the magistrate's seal. The tower, top floor." Banner strings
  unchanged.
- `townNotices.murderNotice` body for `confrontation`: "The killer has a name at
  last, and the name has a patron. End the Krasue murders for good."
- Leave every other ambient line (residents, fortunes, gossip, readables) exactly as
  it is. They already fit the new story.

Acceptance: grep turns up no ambient line contradicting the new script. Specifically,
nothing implying the night attack was random, and nothing implying Quill acted alone
once the reveal is available.

### T5: Final-stair confirm gate

Load `add-ui`. In `src/systems/TowerStairSystem.ts`:

- When the ascent target is the confrontation floor (`TOWER_CONFRONTATION_FLOOR`) and
  the murder stage is `confrontation` or `quill_slain`, replace the generic
  "Ascend to:" panel content with Scene G, exactly: body text, button labels, and
  "No, I have more to do." as the focused, primary, default action. Space must
  activate No, not Yes. Esc also declines.
- A held Space from walking must not answer the prompt. Require a fresh key press
  after the panel opens (the repeat-keydown trap).
- Keep the existing panel for every other floor and every other quest stage.
- The prompt re-arms on every approach. No "asked once" flag: a player who declines,
  shops, and comes back gets asked again.

Acceptance: the prompt shows only for the final ascent during the finale stages;
mashing Space on approach lands on "No" and leaves the player on the lower floor;
`verify:menus` passes, meaning the new buttons carry a `focusContext`.

### T6: Top-floor entry cutscene

Load `add-quest` and `add-system`. In `QuillConfrontationSystem`:

- On entering `quill_fight` for the first time (a fresh `confrontation` stage, not a
  re-entry after a death), hold the room (`holdRoomForBanner` already freezes every
  encounter mob), keep the party's input suppressed, and play `QUILL_OFFICE_DIALOG`
  (Scene H) before the existing banner and fight release. Camera: if a simple camera
  nudge toward Quill's desk is available through the existing viewport, use it during
  the dialog; otherwise skip camera work, since the dialog carries the scene. The
  scripted cutscene in `BigTopMazeSystem` is the reference for beat and camera
  structure if needed.
- On re-entry after a party death, skip the dialog and start the fight with just the
  banner, as today.
- Make the dialog unskippable the same way the reveal already is (`dismissDialog`
  refuses). It ends by starting a boss fight, so an Esc must not strand the room
  half-held.

Acceptance: a fresh approach plays Scene H, then the Quill banner, then combat. Dying
and re-climbing goes straight to combat. Esc during Scene H does nothing.

### T7: Reveal polish

In `QuillConfrontationSystem`: the reveal flow (hold, dialog, materialise, lich
banner) is unchanged mechanically. It just plays the new six-page
`LICH_REVEAL_DIALOG` from T1. Confirm the unskippable guard still covers all six
pages and that the materialise burst and chant still fire on the final page.

Acceptance: the reveal plays all six pages in order, can't be dismissed, and the lich
spawns exactly once.

### T8: Lich phase scaffolding, `LichBattleSystem`

Load `add-system` and `game-architecture`. Create `src/systems/LichBattleSystem.ts`:

- Constructed by `QuillConfrontationSystem.beginLichFight()` and driven from its
  update, render, and dispose. It owns
  `LichBattlePhase = 'onslaught' | 'firewall' | 'tantrum' | 'reckoning'`, the tantrum
  sub-state (`'float' | 'daze'`), the daze-hit counter, the dodge clock, and all
  firewall and orb state.
- In `src/creatures/TheLich.ts`: raise `LICH_HP` to 475, and add a battle-system hook
  that suppresses the lich's own AI while the system is driving it (firewall anchor,
  tantrum float, daze), and routes `isDamageImmune` through the system's phase rules,
  with `onDamageBlocked` flashing the way `MissQuill` does.
- Phase transitions per 6.1, with barks, banners, and objective lines per Scene J.
  Barks play during the scripted slides while the world is held.
- Scripted slides for the push and the throw: move players over `PUSH_SLIDE_FRAMES`
  with input suppressed. Every system-driven lich move goes through `mobGrid.move`.
- Checkpoint: capture and restore the phase, daze-hit count, and dodge clock
  alongside the confrontation's existing checkpoint state. A mid-fight party death
  restarts at `onslaught` with full HP, matching today's death behavior.
- Cleanup contract: `dispose()` and `finishConfrontation` clear every wave, orb, and
  warning. Nothing battle-owned may live on the `TheLich` mob.

Acceptance: phase 1 plays exactly like the current fight but with the larger HP pool,
and crossing the 60% threshold reliably enters firewall (test by dealing damage, not
by waiting). Firewall and tantrum bodies may be stubs until T9 and T11, but the phase
machine, immunity gating, and slides must be real.

### T9: Firewall stage

Implement 6.2 in `LichBattleSystem`:

- Build the wave scheduler as a pure, exported unit (gap column selection with the
  3-tile shift rule, wave spawn timing) so T15 can test it headlessly. Pass in a
  seeded RNG; no direct `Math.random` in the pure part.
- Wave rendering: telegraph via `drawDangerTile`, flame art per T13. Collision: a
  player intersecting a burning (non-gap) tile of a wave takes `FIREWALL_HIT_DAMAGE`
  and triggers the stage reset. Collision runs in `update()`, which can run twice per
  rAF under catch-up, so it goes in the update step, never the render step.
- Strike window: the 2-tile damage gate from 6.2. A landed hit transitions to
  tantrum.
- Derive room geometry from the generated top-floor bounds at runtime. No hardcoded
  room size.

Acceptance: waves always have exactly one 2-wide gap; the gap never jumps more than 3
columns; a hit resets both party members to the south wall and clears the waves;
ranged hits from beyond 2 tiles are visibly blocked; a close hit advances the phase.

### T10: Companion directive and hazard avoidance (parallelizable with T9 and T11)

Load `add-system`. Two pieces:

1. `CompanionSystem` gains a minimal directive API: `setDirective({ x, y, hold })`
   and `clearDirective()`. While a directive is set it overrides follow and anchor
   movement (path to the tile, hold there), and when `hold` is set it suppresses
   attacking. Scene changes and `dispose` clear it. Don't touch stance persistence;
   the directive is a battle-scoped override, not a stance.
2. `LichBattleSystem` implements `GroundHazardSource` (escape vectors out of live orb
   warnings and out of oncoming wave rows) and registers with the companion the way
   `BossRoomSystem` and `BigTopMazeSystem` do. During firewall it directs the
   companion to the current gap column at the back row. During tantrum it clears the
   directive and lets hazard avoidance do the dodging. During a daze the companion
   may engage, and its hits count toward the daze counter.

Acceptance: in firewall the companion sits in the safe column and never advances or
attacks; in tantrum the companion walks out of warning circles; clearing the fight or
leaving the scene leaves no directive stuck, and the companion resumes normal follow.

### T11: Tantrum stage

Implement 6.3 in `LichBattleSystem`:

- Float steering: perimeter path, away-from-player bias, `LICH_FLOAT_SPEED_RATIO`,
  with `mobGrid.move` on every step.
- Build the orb scheduler as a pure, exported unit (spawn cadence, player-targeted
  every third orb, the concurrency cap, the never-box-in invariant) with a seeded
  RNG, for T15.
- Dodge clock with reset-on-hit; progress bar and objective line per 6.5.
- Daze: descent to center, the `dazed` sprite row, the vulnerability window, hit
  counting, and the loop-or-advance rule from 6.3. Orbs stop spawning at daze start
  and all live warnings resolve before the lich lands, so there's no cheap hit during
  the transition.

Acceptance: the lich can't be hit while floating (the blocked-hit flash shows); 10
clean seconds always produce a daze; an orb hit resets the clock and the bar visibly
empties; two daze hits across any number of windows advance to reckoning.

### T12: Reckoning and finish wiring

- Phase 4 per 6.4: baseline AI resumes, orb rain at the slower cadence, same fairness
  invariant.
- On lich death: play `VICTORY_DIALOG` (Scene K) first, then run the existing
  `finishConfrontation` effects unchanged. The victory banner, music handoff, and the
  Doomsday chain (crystal tile, containment stage, wall-clock deadline) arm only
  after the dialog closes, so the dialog doesn't eat containment time. Preserve every
  existing emitted event and their order relative to each other.
- Clear all battle-owned visuals and hazards on death.

Acceptance: killing the lich in phase 4 plays Scene K, then the banner, then the
Doomsday countdown starts at its full duration; no orb or wave survives into the
containment sequence; the quest completes and pays out exactly as before.

### T13: Art (parallelizable, any time after T8)

Load `add-sprite`, and `bipedal-figure` only if the dazed pose needs rig work:

- Lich `dazed` row: extend `scripts/lichArt.ts` and regenerate via `gen:lich`. A
  slumped, grounded hover: hood tipped forward, hood-fire guttering low, arms
  hanging. Keep the sheet's frame size identical (frame-size drift bleeds neighboring
  rows) and update the manifest row list. One camera-facing row is enough.
- Fire wave: a `drawFireWave` module in `src/sprites/`, a per-tile animated flame
  wall segment with its palette matched to the Big Top flame vents so fire reads
  consistently game-wide. Runtime-drawn is fine (it matches the vents); no new sheet
  required.
- Falling orb: `drawLichOrb`, a small soul-green sphere with a short trail, scaled up
  as it "falls" into the warning circle. The impact reuses `drawSoulBurst`, and the
  warning circle is `drawDangerCircle` as-is.

Acceptance: the dazed row renders in-game without bleeding adjacent rows; waves and
orbs read at gameplay zoom (judge at in-game size, not zoomed in); `gen:lich` runs
clean and the manifest matches the sheet.

### T14: Audio (parallelizable, any time after T8)

Load `add-sound`. Audit `SOUND_MANIFEST` and wire:

- Firewall: wave ignition (reuse the Big Top vent ignition cue if it fits, otherwise
  add one), plus the lich's existing chant during the phase.
- Tantrum: orb launch (`magic_ball_launch` already exists in the lich's stop-list, so
  reuse it), orb impact (reuse an existing burst or impact id if one fits), and a
  distinct cue at daze start so the strike window is audible.
- Barks and banners reuse the existing quest banner audio behavior.
- Confirm the stop-list in `finishConfrontation` covers every loop the new phases
  start.

Acceptance: no phase leaves a loop playing after the fight ends, and each phase
transition has an audible cue.

### T15: Headless verify script

Load `dev-workflow`. Create `scripts/verify-lich.ts`, register it in
`tsconfig.scripts.json` (the scripts typecheck is an opt-in list, and an unregistered
script is never checked), and add `npm run verify:lich`. Drive the pure units from T9
and T11 plus the phase machine with a seeded RNG, and assert:

1. Every generated wave has exactly one gap, exactly 2 tiles wide.
2. Across 500 consecutive waves, no gap shift exceeds 3 columns.
3. Orb warnings never exceed the concurrency cap, and never cover every walkable
   neighbor of a simulated player tile.
4. The dodge clock resets on a hit and reaches daze only after 600 uninterrupted
   frames.
5. Two daze hits, across one or several daze windows, advance to reckoning. One does
   not.
6. Phase order is monotonic: onslaught, firewall, tantrum, reckoning. No skips, and
   no regressions other than the scripted firewall stage reset.
7. HP thresholds: firewall triggers at 60% or below, never above.

For each assertion, temporarily mutate the rule under test once during development
and confirm the gate goes red, then revert. A gate that can't fail is measuring
nothing. Also guard against vacuous passes: if a lookup the gate depends on misses (a
row, a phase name), the gate must fail loudly rather than skip.

Acceptance: `npm run verify:lich` exits 0 on the shipped code and exits non-zero
under each single-rule mutation.

### T16: Full pass

- `npm run typecheck`, `npm run lint`, `npm run format`, all clean.
- `npm run verify:lich`, `verify:menus`, and any existing murder or companion
  verifies (`verify:companion`), all green.
- Grep for `NIGHT_FALLS_DIALOG` (must be gone) and for lowercase Donut dialog lines
  in `murderQuestDialogs.ts` (must be none).

---

## 8. Continuity contract (must survive the rework untouched)

- The Doomsday effects in `finishConfrontation`: `doomsdayProgress.crystalTile`,
  `stage = 'containment'`, the wall-clock `deadlineAt`, and the `rumble`. Same
  values, armed after Scene K closes (T12), otherwise unchanged.
- `restoreMurderQuestProgress` rewinds in place. Never replace the progress object.
- Death-and-return behavior: `quill_slain` reopens straight into the lich fight, and
  `confrontation` reopens into the Quill fight (now minus the Scene H dialog on
  re-entry).
- The Quill fight itself: Remex shield, guards, summons, and `dispose()` killing her
  live krasue, all unchanged.
- Quest rewards and their split payout path (XP from `finishQuest`, coins and loot
  from the scene's `questCompleted` handling), unchanged.
- GumGum's splice-out at `finishHook` and her corpse render, unchanged.
