/**
 * The `?story=<beatId>` dev preview: which level a beat belongs to, the run's
 * story as it stands just before the beat, and the moment that plays it.
 */

import type { LevelId } from '../levels/levelIds';
import type { DebriefBossType } from '../core/mobs/debriefBossTypes';
import type { CarolineStoryEvent, DaveStoryEvent } from '../systems/StoryDelivery';
import type { StoryBeatId } from './storyBeatIds';
import { StoryDirector, storyBeat } from './StoryDirector';
import { STORY_BEAT_ORDER } from './storyBeatIds';
import type { StoryFloor } from './storyTypes';

/** The floor each boss with a story beat is fought on. */
const BOSS_FLOORS = {
  trash_gremlin: 1,
  big_rooster: 2,
  kraken: 1,
  electric_goblin: 2,
} as const satisfies Record<DebriefBossType, StoryFloor>;

const FLOOR_LEVELS = {
  1: 'level1',
  2: 'level2',
  3: 'level3',
} as const satisfies Record<StoryFloor, LevelId>;

/** The moment a previewed beat is played at. */
export type StoryPreview =
  | { readonly kind: 'dave'; readonly event: DaveStoryEvent }
  | { readonly kind: 'caroline'; readonly event: CarolineStoryEvent };

/** The level a beat is heard on. */
export function storyPreviewLevel(id: StoryBeatId): LevelId {
  const trigger = storyBeat(id).trigger;
  switch (trigger.kind) {
    case 'tutorialSafeRoomArrival':
    case 'tutorialCatArrived':
    case 'firstAchievement':
      return 'tutorial';
    case 'skippedTutorialStart':
      return FLOOR_LEVELS[1];
    case 'safeRoomArrival':
    case 'floorArrival':
      return FLOOR_LEVELS[trigger.floor];
    case 'bossDefeated':
      return FLOOR_LEVELS[BOSS_FLOORS[trigger.boss]];
    case 'afterBeat':
      return storyPreviewLevel(trigger.beat);
    default: {
      const unhandled: never = trigger;
      return unhandled;
    }
  }
}

/** The run's story just before `id`: every beat ahead of it in play order already heard. */
export function storyDirectorBefore(id: StoryBeatId): StoryDirector {
  return new StoryDirector(STORY_BEAT_ORDER.slice(0, STORY_BEAT_ORDER.indexOf(id)));
}

/** The moment that plays `id`, with any boss it waits on already dead. */
export function storyPreviewEvent(id: StoryBeatId): StoryPreview {
  const trigger = storyBeat(id).trigger;
  switch (trigger.kind) {
    case 'tutorialSafeRoomArrival':
    case 'tutorialCatArrived':
    case 'skippedTutorialStart':
      return { kind: 'dave', event: { kind: trigger.kind } };
    case 'safeRoomArrival': {
      const boss = trigger.afterBossDefeated;
      const defeatedBosses = new Set<DebriefBossType>(boss === undefined ? [] : [boss]);
      return {
        kind: 'dave',
        event: { kind: 'safeRoomArrival', floor: trigger.floor, defeatedBosses },
      };
    }
    case 'floorArrival':
      return { kind: 'caroline', event: { kind: 'floorArrival', floor: trigger.floor } };
    case 'bossDefeated':
      return { kind: 'caroline', event: { kind: 'bossDefeated', boss: trigger.boss } };
    case 'firstAchievement':
      return { kind: 'caroline', event: { kind: 'firstAchievement' } };
    case 'afterBeat':
      return { kind: 'caroline', event: { kind: 'beatFinished', beat: trigger.beat } };
    default: {
      const unhandled: never = trigger;
      return unhandled;
    }
  }
}
