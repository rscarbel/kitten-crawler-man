/**
 * Every story beat's id, in the order the beats are played. Apart from
 * `STORY_BEATS` (`storyBeats.ts`), which holds their lines, so that a save's
 * seen beats can be checked without loading any dialog; `defineStoryBeats`
 * holds the table to exactly these keys.
 */
export const STORY_BEAT_ORDER = [
  'tutorial_meets_dave',
  'tutorial_caroline_first_contact',
  'tutorial_dave_farewell',
  'skipped_tutorial_dave_intro',
  'floor1_caroline_arrival',
  'floor1_dave_how_it_began',
  'floor1_dave_the_morning',
  'floor1_caroline_pressure',
  'floor2_caroline_arrival',
  'floor2_dave_his_story',
  'floor2_dave_how_he_knows',
  'floor2_dave_chosen',
  'floor2_caroline_motive',
  'floor3_caroline_arrival',
  'floor3_dave_allies',
] as const;

/** One beat of the story. */
export type StoryBeatId = (typeof STORY_BEAT_ORDER)[number];

export function isStoryBeatId(value: unknown): value is StoryBeatId {
  return STORY_BEAT_ORDER.some((id) => id === value);
}
