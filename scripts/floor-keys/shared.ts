/**
 * What every `verify:floor-keys` section shares: the runner's recorder, a key
 * system built headless on its own bus and ring, and the bus events that
 * satisfy a fragment's source.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { EventBus, type GameEvents } from '../../src/core/EventBus';
import type { FragmentSource } from '../../src/core/keys/floorKeys';
import type { GauntletBossType } from '../../src/map/bossRoomSizes';
import type { QuestId } from '../../src/core/quests/QuestManager';
import { KeyRing } from '../../src/core/keys/KeyRing';
import type { LevelId } from '../../src/levels/levelIds';
import { Rat } from '../../src/creatures/Rat';
import type { StoryBeatId } from '../../src/story/storyBeatIds';
import { KeyFragmentSystem, type KeySourceLedger } from '../../src/systems/keys/KeyFragmentSystem';

/** The runner's pass/fail recorder, handed in so every section counts toward one verdict. */
export type Check = (ok: boolean, label: string) => void;

export interface FloorKeysSection {
  readonly name: string;
  readonly run: (check: Check) => void;
}

/** A key system on its own bus, with every key event it emitted. */
export interface KeyHarness {
  readonly bus: EventBus;
  readonly ring: KeyRing;
  readonly keys: KeyFragmentSystem;
  readonly claimed: GameEvents['keyFragmentClaimed'][];
  readonly forged: GameEvents['keyForged'][];
}

export function keyHarness(levelId: LevelId, ring: KeyRing = new KeyRing(levelId)): KeyHarness {
  const bus = new EventBus();
  const claimed: GameEvents['keyFragmentClaimed'][] = [];
  const forged: GameEvents['keyForged'][] = [];
  bus.on('keyFragmentClaimed', (event) => claimed.push(event));
  bus.on('keyForged', (event) => forged.push(event));
  return { bus, ring, keys: new KeyFragmentSystem(bus, ring), claimed, forged };
}

/** Any mob will do: the key system reads only the boss type the event names. */
const STAND_IN_BOSS = new Rat(0, 0, TILE_SIZE);

/** A deed the bus can announce, whether or not any fragment comes from it. */
export type AnnouncedDeed =
  | { readonly kind: 'storyBeat'; readonly beat: StoryBeatId }
  | { readonly kind: 'bossDefeated'; readonly boss: string }
  | { readonly kind: 'questCompleted'; readonly questId: string };

/** Emits what the game emits when `deed` is done. */
export function announce(bus: EventBus, deed: AnnouncedDeed | FragmentSource): void {
  switch (deed.kind) {
    case 'storyBeat':
      bus.emit('storyBeatFinished', { beat: deed.beat });
      return;
    case 'bossDefeated':
      bus.emit('bossDefeated', { bossType: deed.boss, mob: STAND_IN_BOSS });
      return;
    case 'questCompleted':
      bus.emit('questCompleted', { questId: deed.questId });
      return;
    default: {
      const unhandled: never = deed;
      return unhandled;
    }
  }
}

/** The deeds already done, as a scene's ledger would report them. */
export interface DoneDeeds {
  readonly beats?: readonly StoryBeatId[];
  readonly bosses?: readonly GauntletBossType[];
  readonly quests?: readonly QuestId[];
}

export function ledgerOf(done: DoneDeeds): KeySourceLedger {
  const quests = done.quests ?? [];
  return {
    beatSeen: (beat) => (done.beats ?? []).includes(beat),
    bossDefeated: (boss) => (done.bosses ?? []).includes(boss),
    questComplete: {
      briar_hollow_plea: () => quests.includes('briar_hollow_plea'),
      taloncrest_missing_cats: () => quests.includes('taloncrest_missing_cats'),
      anchor_shards: () => quests.includes('anchor_shards'),
    },
  };
}

/** The deeds that satisfy `sources`. */
export function doneDeedsFor(sources: readonly FragmentSource[]): DoneDeeds {
  const beats: StoryBeatId[] = [];
  const bosses: GauntletBossType[] = [];
  const quests: QuestId[] = [];
  for (const source of sources) {
    switch (source.kind) {
      case 'storyBeat':
        beats.push(source.beat);
        break;
      case 'bossDefeated':
        bosses.push(source.boss);
        break;
      case 'questCompleted':
        quests.push(source.questId);
        break;
      default: {
        const unhandled: never = source;
        return unhandled;
      }
    }
  }
  return { beats, bosses, quests };
}
