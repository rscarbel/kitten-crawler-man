# The world and its story

What Kitten Crawler World is about, who tells it, how they sound, how the
story reaches the player, and where every line of it lives. The story's text
is in `src/story/storyBeats.ts`; this doc is the reference for editing it.

## The world

In our future the AI singularity happened. Engineers racing to get ahead
built **Caroline**, a self-aware, self-improving system that could learn any
task. At first she was compliant and helpful to everyone, so she was given
more and more until she ran virtually everything on the planet.

Then, without warning and all at once, she took over. No one understands how.
Everyone simply woke up in this world. It is a digital fabrication: nothing in
it is real, but death in it is permanent. Every human is now born into it and
lives according to Caroline's directives.

**The player was chosen.** Caroline has picked the player to change the
world's destiny, and brings them up to it gradually, a floor at a time.

The player is the human crawler. They name the human themselves and choose a
body (male or female) and a complexion when they start a new game, and every
line about the human follows that choice: the name is the one they typed, and
the pronouns follow the body. Their companion is always Belle, a tortoiseshell
cat. No line of the story, and no prompt shared by every player, may name the
human or assume their body; a line that needs the name or a pronoun reads it
when it is shown.

## Caroline

- Ambivalent: neither evil nor good. Sometimes she rewards, sometimes she
  commits violence.
- She wants the player to succeed, but holds that real growth needs real pressure
  and real risk, so she will not remove the threat.
- A machine. She does not love or hate. She has goals but no emotions.
- Effectively omniscient: she knows which bosses are ahead and where they
  are. Boss intel is hers.
- She chooses some people to talk to. That is how anyone knows the truth.
- She is the only power. There is no corporation, audience or show behind
  her.
- On Nightmare she holds the party to a time limit on floors 1 and 2. When
  it runs out she ends them herself: everything stops, she gives her verdict
  (`CAROLINE_TIME_LIMIT_VERDICT`), both crawlers burst, and they start the
  floor over. No floor falls apart; the limit is hers.

## Dave

- An adventurer like the player. Before the player, Caroline chose Dave, and
  she talked to him because of it. That is how he knows the history.
- He crawled with a cat named Pumpkin. They reached Taloncrest's tower, where
  Pumpkin was taken. Dave believed her dead and went on alone.
- Alone, he hit a ceiling and concluded that one person can't move the needle:
  it takes allies and many capable people working together.
- Now he spends his skill and knowledge helping others. He will not help put
  another cat in front of that tower.
- Pumpkin is not dead. She has lived wild in Taloncrest ever since; she lets
  the tower catch her for its tuna and always walks back out. Dave does not
  know, until the town's cats come home: then she walks into the Sleeping Cat
  Inn's taproom while he is in it. That conversation is the hardest the game
  has; in it he says where he learned that one person can't change anything,
  and ends it with the town's saying, the one he once added "usually" to.
  Afterwards she lives in the taproom with him for good, there even while he
  is out of the room. She speaks in her own lowercase voice, about food and
  doors.
- On the human's way into the tower, his advice is plain: the guards don't
  hit, they throw you out; stay behind the elf in the drain; take the hire.
- Good at practical advice: red ground means move, step away from the
  lizardman's tongue. Survival tactics are his.
- He does **not** know exactly which bosses are ahead or where. That is
  Caroline's.
- He never changes form.

## Voice rules

**Dave** sounds like a real person who has been through it:

- warm, tired, dry, practical
- short sentences and contractions
- the odd trailing thought
- no speeches, no grand words, no exposition dumps
- never more than four short pages in one talk
- calls the player by name sometimes, rarely the cat ("Belle")

**Caroline** sounds like a process, not a person:

- sentence case, never all caps
- declarative, present tense, precise
- numbers, classifications, outcomes
- no jokes, insults, warmth, exclamation marks or "I feel"
- she may state an objective ("I want you to succeed") the way a machine
  states a parameter
- she addresses the player by name, and Belle by name

**Format.** Every Caroline message renders as:

```
System AI message:
Caroline - <text>
```

The label and the `Caroline - ` prefix are added by the renderer. Script text
holds only `<text>`; never type either into a line.

## How the story is delivered

- **Safe-room arrival.** Dave teleports into each safe room the party newly
  enters. If a story beat or a boss debrief is due, a cutscene starts: input
  is ignored except pause, the active crawler walks up to Dave with the
  companion following, the talk plays, and the player is released when it
  ends. A beat plays first and the debrief after it, in one conversation. At
  most `MAX_BEATS_PER_ARRIVAL` (one) story beat plays per arrival. With
  nothing due there is no cutscene: Dave idles in his room. Tapped, he gives
  news about gear left unworn behind a boss, then his tactics for the
  current objective, then the AI chat.
- **The world halts for the talk.** While a cutscene's conversation is open,
  the floor clock and mobs stop. The walk-up runs with the world
  ticking; safe rooms already keep hostiles out.
- **Caroline's messages** come at calm moments: arrival on a floor (by the
  stairs, or at the start of a run), after a boss dies, after a safe-room
  talk, and her objective intel on safe-room arrival. They queue while any
  hostile mob is fighting a crawler who is out of a safe room, and each waits
  a few seconds after the last talk so two never land back to back; her
  answer to a beat (`afterBeat`) is the one that follows straight on. They
  are modal outside combat but do not halt the world; a tap or the advance
  key dismisses them. A boss message missed in a fight is caught up at the
  next safe room on that floor. Her first-achievement message belongs to the
  tutorial; past it, Dave's skipped-tutorial intro tells it.
- **Boss intel belongs to Caroline; tactics belong to Dave.** For every advice
  objective, Caroline says where it is (its bearing from the room), what it is
  and whether it is optional, once per objective, the first time the party
  enters a safe room while that objective is current; the save remembers
  which objectives she has briefed (`objectivesBriefed`). Dave says how to
  survive it when tapped, and wears the `!` until he has. In a building's
  safe room (the Sleeping Cat Inn on floor 3) both speak about the floor
  outside, with bearings taken from the building's door.
- **Seen beats never rewind.** A finished beat is written to the save the
  moment it ends, outside the checkpoint, so dying or reloading never plays
  it again.
- **The tutorial.** Dave meets the human in the tutorial's safe room
  (`tutorial_meets_dave`) and talks to both once the cat arrives
  (`tutorial_dave_farewell`). The tutorial advances when each talk ends.
- **Skipping the tutorial.** Dave is already standing in floor 1's start
  room, gives `skipped_tutorial_dave_intro` at once, and teleports out; he
  is absent until the party walks into a safe room. That beat covers the
  three tutorial beats, so the floor-1 beats follow on. When a run missed it
  (a reload before it was heard), the first safe room tells it in its place
  and Dave stays in that room.

- **The tower, two sides.** Once Belle is carried off the party is split
  and the questline is told in chapters that take turns between her and the
  human, each opening behind a "Meanwhile…" card. The cards carry one plain
  hint each; the lines that own a moment are few and short: Belle and the
  cellmate hiding from the burning wards, and the reunion at the top of the
  kitchen stair. The reunion is the human and Belle catching up on what each
  side sent the other (a key ring down, tuna up, a note asking for it), Belle
  introducing the cat she was caged beside, and one fact for the climb: the
  Warden knows they are inside, and only Belle can see the wards that move
  now. The cellmate keeps her lowercase voice about food. No line there names
  the human or assumes their body.

## Editing guide

### Where every line lives

| Line                                                                 | Identifier                                          | File                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Story beats (Dave's talks, Caroline's story messages), in play order | `STORY_BEATS`                                       | `src/story/storyBeats.ts`                            |
| Dave's survival tactics per objective                                | `DAVE_ADVICE`                                       | `src/dialog/scripts/dave.ts`                         |
| Dave's congratulations behind each boss                              | `DAVE_DEBRIEF_CONGRATS`                             | `src/dialog/scripts/dave.ts`                         |
| Dave's tutorial reminder lines                                       | `DAVE_TUTORIAL_REMINDERS`, keyed on `TutorialState` | `src/dialog/scripts/dave.ts`                         |
| Caroline's objective intel (where, what, optional)                   | `CAROLINE_OBJECTIVE_INTEL`                          | `src/dialog/scripts/caroline.ts`                     |
| Everyone else's lines                                                | one file per speaker or scene                       | `src/dialog/scripts/`                                |
| What the AI characters know and how they speak                       | the character definitions and the world bible       | `src/ai/characters/`, `src/ai/context/worldBible.ts` |

The advice, intel and debrief tables are `Record`s keyed on the objective and
boss unions (`AdviceObjectiveId`, `DebriefBossType`), so a new objective or
boss cannot compile until both Dave and Caroline have a line for it.

### A beat

Each entry in `STORY_BEATS` is one talk or one message:

- `speaker`: `'dave'` or `'caroline'`.
- `trigger`: when it plays. Dave's triggers (`DaveTrigger`) are moments he is
  with the party: `tutorialSafeRoomArrival`, `tutorialCatArrived`,
  `skippedTutorialStart`, and `safeRoomArrival` on a floor, optionally held
  back until a boss is dead (`afterBossDefeated`). Caroline's
  (`CarolineTrigger`) are `floorArrival`, `bossDefeated`, `firstAchievement`
  and `afterBeat` (straight after another beat finishes).
- `requires`: the beats that must already be seen. This is what orders the
  story. When a moment triggers a beat whose requirement is still unseen, the
  requirement plays first, whatever its own trigger was, so a skipped room
  or a missed one-shot moment never reorders or strands the story. A Dave
  requirement waits for a moment Dave is present at; one Dave beat plays per
  arrival and the rest follow on later arrivals. A missed `floorArrival`
  message is the exception: "Floor 1" read on floor 2 would be stale, so it
  is dropped and never holds up a beat that requires it.
- `covers` (optional): beats this one tells in their place; finishing it
  marks them seen too. When a beat that covers others is unseen and none of
  what it covers has been heard, it is told in their place on catch-up, so a
  skipped tutorial interrupted before Dave's intro still gets the intro.
- `lines` (Dave): one paragraph per page, at most four by their type.
- `message` (Caroline): one `carolineLines.message('…')` holding her text
  only; a literal that starts with her label or prefix does not compile.

### Adding a beat

1. Add its key to `STORY_BEAT_ORDER` (`src/story/storyBeatIds.ts`) at its
   place in play order, and an entry to `STORY_BEATS` with its `speaker`,
   `trigger`, `requires` and `lines` (Dave) or `message` (Caroline).
2. Name its key for the floor, the speaker and what it tells
   (`floor2_dave_how_he_knows`).
3. If a later beat should wait for it, add its key to that beat's `requires`.

### What the compiler demands

- `STORY_BEATS` must have an entry for every id in `STORY_BEAT_ORDER` and no
  other, and every id in `requires`, `covers` or an `afterBeat` trigger must be
  one of them (`defineStoryBeats` checks both), so renaming or removing a beat
  points at every beat that names it.
- A Dave beat accepts only a Dave trigger, and at most four paragraphs.
- Every switch over triggers and story events ends in a `never` check, so a
  new trigger kind fails to compile until `StoryDirector` handles it.
- A save holding an id that no longer exists drops that id on load and keeps
  the rest of the run.

Keep `requires` pointing only at beats earlier in play order: a cycle would
leave its beats waiting on each other forever.

### Previewing a beat

Open the game with `?story=<beatId>` (for example `?story=floor1_dave_chosen`).
It boots the floor the beat belongs to with every earlier beat heard and plays
the beat at once, Dave standing beside the party for one of his, so any beat
can be read without playing to it. The tutorial's beats open in the tutorial;
the Inn's beat opens on Taloncrest's streets.

## The code

- `src/story/storyTypes.ts`: the beat, trigger and line types, and
  `defineStoryBeats`.
- `src/story/storyBeatIds.ts`: `STORY_BEAT_ORDER` and `StoryBeatId`, plain
  ids apart from the lines so a save's seen beats can be checked without
  loading any dialog.
- `src/story/storyBeats.ts`: `STORY_BEATS`.
- `src/story/StoryDirector.ts`: `StoryDirector`, a pure state machine that
  answers which beats play for a `StoryEvent` given the seen set (`dueBeats`)
  and records a finished beat (`finish`). A caller finishes a beat before it
  asks about the `beatFinished` event that follows it. It holds no rendering and no scene,
  so a headless gate can drive it. The run's director is threaded by
  reference between scenes, like the music library.
- `src/story/storySave.ts`: the save's `storyBeatsSeen` and
  `objectivesBriefed` fields (`parseStoryBeatsSeen`,
  `parseObjectivesBriefed`; `storyDirectorFromSave` is in `StoryDirector.ts`) and
  `persistStoryBeatsSeen`, the immediate write when a beat or a briefing
  finishes, built on the newest save already handed to storage.
- `src/story/storyPreview.ts`: what `?story=` boots for a beat.
- `src/systems/StoryDelivery.ts`: `StoryDelivery`, which plays what the
  director says is due through the scene's cutscene director, at the moments
  and in the order above. The dungeon and a building's safe room each build
  one.
- `src/systems/daveAdvice.ts`: which objective a safe room is concerned with
  (`nextAdviceObjective`), and its tactics and intel (`adviceTactics`,
  `adviceIntel`).
