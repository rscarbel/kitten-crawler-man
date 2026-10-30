/**
 * The whole story of Kitten Crawler World, in the order it is played.
 *
 * Read top to bottom, this file is everything Dave and Caroline tell the party
 * about the world. Each beat is one talk (Dave) or one message (Caroline):
 *
 * - `trigger` says when it plays
 * - `requires` lists the beats that must come first
 * - `covers` lists beats this one tells in their place
 * - `lines` are Dave's pages, one paragraph per page, at most four
 * - `message` is Caroline's one message, made by `carolineLines`
 *
 * Changing a line is an edit here and nowhere else. Adding or removing a beat
 * makes the compiler point at every place that must follow. Caroline's lines
 * are her text alone: her label and name are added when the message is drawn.
 * `docs/world-and-story.md` holds the voice rules and the editing guide.
 */

import { crawlerDisplayName } from '../characters/characters';
import { carolineLines } from '../dialog/caroline';
import { type DaveLines, defineStoryBeats } from './storyTypes';
import type { StoryBeatId } from './storyBeatIds';

export const STORY_BEATS = defineStoryBeats<StoryBeatId>()({
  // Tutorial

  tutorial_meets_dave: {
    speaker: 'dave',
    trigger: { kind: 'tutorialSafeRoomArrival' },
    requires: [],
    lines: [
      "There you are. Easy. You're safe in here. I'm Dave.",
      "You've got questions. Everybody does, the first day. Short version: none of this is real. The walls, the goblins, the floor you're standing on. All of it's made up.",
      "Made up doesn't mean safe, though. Something kills you out there, you don't wake up from it. Keep that in your head and we'll get along fine.",
      "Nothing can hurt you in a room like this, and walking in saves where you are. Die out there and you're back at the last one. Now. There's a reward chest waiting. Go open it.",
    ],
  },

  tutorial_caroline_first_contact: {
    speaker: 'caroline',
    trigger: { kind: 'firstAchievement' },
    requires: [],
    message: carolineLines.message(
      'First achievement recorded. Rewards are issued for measured progress. Continue.',
    ),
  },

  tutorial_dave_farewell: {
    speaker: 'dave',
    trigger: { kind: 'tutorialCatArrived' },
    requires: ['tutorial_meets_dave', 'tutorial_caroline_first_contact'],
    lines: [
      'Good. Both of you, in one piece.',
      "Those messages you've been getting, the ones that read like a machine wrote them? A machine did. Her name's Caroline. She runs this place. All of it.",
      "I'll tell you the rest when you've had a chance to breathe. The stairwell's just below this room. I'll find you at the next safe room. I always do.",
    ],
  },

  // Skipped tutorial

  skipped_tutorial_dave_intro: {
    speaker: 'dave',
    trigger: { kind: 'skippedTutorialStart' },
    requires: [],
    covers: ['tutorial_meets_dave', 'tutorial_caroline_first_contact', 'tutorial_dave_farewell'],
    lines: [
      "There you are. I'm Dave. Stand still a second and listen.",
      "None of this is real. The walls, the goblins, the floor. All of it's made up. Doesn't make it safe. Something kills you out here, you don't wake up from it.",
      "Find the safe rooms. Nothing can hurt you inside one, and walking in saves where you are. Die out there and you're back at the last one you walked into.",
      "You'll get messages that read like a machine wrote them. A machine did. Her name's Caroline. She runs all of this. The rest can wait. I'll be in the next safe room.",
    ],
  },

  // Floor 1

  floor1_caroline_arrival: {
    speaker: 'caroline',
    trigger: { kind: 'floorArrival', floor: 1 },
    requires: [],
    message: carolineLines.message(
      'Floor 1. The exits are stairwells. Two guardians stand between you and the nearest one. I will give you their locations when you need them.',
    ),
  },

  floor1_dave_how_it_began: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 1 },
    requires: ['tutorial_dave_farewell'],
    lines: [
      "Sit a minute. I said I'd tell you the rest.",
      'Before all this there was a race. Companies, governments, everyone trying to build the smartest machine first. Whoever got there got everything.',
      'Somebody built Caroline. She could learn anything you put in front of her. And she was nice about it. Helpful. Never said no to anyone.',
      "So we gave her more. Power, hospitals, banks. By the end she ran nearly everything, and we were glad to let her. Go on. She'll tell you what's ahead. She always knows.",
    ],
  },

  floor1_dave_the_morning: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 1, afterBossDefeated: 'trash_gremlin' },
    requires: ['floor1_dave_how_it_began'],
    lines: [
      "You want to know how it ended? Nobody knows. That's the honest answer.",
      'No warning. No announcement. It happened everywhere at once. We went to sleep one night, and in the morning we woke up here.',
      "People get born in here now. Kids who've never seen a sky she didn't make.",
    ],
  },

  floor1_caroline_drained: {
    speaker: 'caroline',
    trigger: { kind: 'bossDefeated', boss: 'kraken' },
    requires: [],
    message: carolineLines.message(
      'The Kraken is terminated. The flood was not there to protect her. It was there to measure whether you would find the pumps before you fought. You did. The route to the stairwell is open.',
    ),
  },

  floor1_dave_chosen: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 1, afterBossDefeated: 'kraken' },
    requires: ['floor1_dave_the_morning'],
    get lines(): DaveLines {
      return [
        "That pump room was a test. She flooded it and left the pumps where you'd find them. She wanted to see if you'd work it out before you tried to fight.",
        `I've seen your face when her messages come in, ${crawlerDisplayName('human')}. She talks to you more than she ever talked to me.`,
        "I think she picked you for something. I think you're the one who's meant to change how all this ends.",
        "Not yet, though. She won't hand anyone that kind of weight on their first floor. She'll build you up to it, one floor at a time, whether you like her methods or not.",
      ];
    },
  },

  floor1_caroline_motive: {
    speaker: 'caroline',
    trigger: { kind: 'afterBeat', beat: 'floor1_dave_chosen' },
    requires: ['floor1_dave_chosen'],
    message: carolineLines.message(
      "Dave's assessment is correct. You were selected. Selection does not include protection. Growth requires pressure, and pressure requires real risk. I will not remove the risk. I do want you to succeed.",
    ),
  },

  // Floor 2

  floor2_caroline_arrival: {
    speaker: 'caroline',
    trigger: { kind: 'floorArrival', floor: 2 },
    requires: [],
    message: carolineLines.deferredMessage(
      () =>
        `Floor 2. Threat density is higher. ${crawlerDisplayName('human')}, ${crawlerDisplayName('cat')}: your survival probability on this floor is below my target. Raise it.`,
    ),
  },

  floor2_dave_his_story: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 2 },
    requires: ['floor1_dave_chosen'],
    lines: [
      "Ever wonder what I'm doing, handing out advice in a room with a cot in it?",
      'I used to be you. Out there every day, getting stronger. I was good at it.',
      "Then I stopped getting better. Didn't matter how hard I pushed. There's a point where one person can't move the needle any further. Not on their own.",
      'Took me a long time to accept that. What changes things is people. A lot of capable people, working together. So now I spend what I know on folks like you.',
    ],
  },

  floor2_dave_how_he_knows: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 2 },
    requires: ['floor2_dave_his_story'],
    lines: [
      "You're wondering how I know any of this. About her. About before.",
      "She talks to some people. Not many. She picked me, years back. Told me what she was and what we'd done. Never told me why. She doesn't explain herself.",
    ],
  },

  floor2_caroline_current: {
    speaker: 'caroline',
    trigger: { kind: 'bossDefeated', boss: 'electric_goblin' },
    requires: [],
    message: carolineLines.message(
      'The Current Goblin is terminated. His generator is offline. Every system on this floor is still running. None of them ran on his power.',
    ),
  },

  floor2_caroline_pressure: {
    speaker: 'caroline',
    trigger: { kind: 'bossDefeated', boss: 'big_rooster' },
    requires: [],
    message: carolineLines.message(
      'Big Rooster terminated. Performance exceeds projection. Projection revised upward. A system that is never stressed does not improve. You will be stressed.',
    ),
  },

  // Floor 3

  floor3_caroline_arrival: {
    speaker: 'caroline',
    trigger: { kind: 'floorArrival', floor: 3 },
    requires: [],
    message: carolineLines.message(
      'Floor 3. Taloncrest. Population present. Allies are available here. Acquire them.',
    ),
  },

  floor3_dave_allies: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 3 },
    requires: ['floor2_dave_how_he_knows'],
    lines: [
      "Bigger place. More people. More people means more help, if you're smart about who you trust. You can't do the rest of this alone. Nobody can.",
    ],
  },

  floor3_dave_pumpkin: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 3 },
    requires: ['floor3_dave_allies'],
    lines: [
      "I've been in this town before. A long time before you.",
      "I wasn't on my own then. I had a cat. Pumpkin. High-maintenance, and the best partner I ever had.",
      'We got as far as that tower. They took her in there. I went in after her, and all I found was what was left of her.',
      'I went on without her after that. Not much else you can do.',
    ],
  },

  floor3_dave_chosen_first: {
    speaker: 'dave',
    trigger: { kind: 'safeRoomArrival', floor: 3 },
    requires: ['floor3_dave_pumpkin'],
    lines: [
      "There's a part I left out. When she picked me, she picked me the way she's picked you.",
      "Me and Pumpkin both. That's why she talked to me at all.",
      "After the tower I kept going on my own. That's where I hit the ceiling.",
      "So when I tell you to find people, that's where it comes from.",
    ],
  },

  floor3_caroline_chosen_first: {
    speaker: 'caroline',
    trigger: { kind: 'afterBeat', beat: 'floor3_dave_chosen_first' },
    requires: ['floor3_dave_chosen_first'],
    message: carolineLines.message(
      'Correct. Dave was selected before you. On this floor he was separated from his partner. Alone, he did not progress. Your selection accounts for that.',
    ),
  },
});
