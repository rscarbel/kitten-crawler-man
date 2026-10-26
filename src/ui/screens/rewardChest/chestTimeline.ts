/**
 * When everything happens on the reward chest screen, as a pure function of
 * the frame: the chest dropping in, idling, unlocking, straining, swinging
 * open, and each reward rising out and gliding to its tray slot. Nothing here
 * is stateful, so skipping is a jump to `settledAt` and a gallery fixture is
 * just a frame number.
 *
 * Frames are 60 per second. Rarer chests stretch every beat, so a Divine
 * chest takes its time where a Common one gets on with it.
 */

import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import { rarityAtLeast, rarityRank, type Rarity } from '../../../core/items/defs/rarity';
import type { GrantedLine } from '../../../loot/rewardChest';

/** The chest starts falling on the screen's first frame. */
export const DROP_START_FRAME = 0;
const DROP_FRAMES = 24;
const IDLE_FRAMES = 40;
const UNLOCK_FRAMES = 10;
const ANTICIPATION_BASE_FRAMES = 20;
const ANTICIPATION_FRAMES_PER_RANK = 5;
const LID_FRAMES = 18;
/** The first reward leaves the chest this far into the lid's swing. */
const FIRST_RISE_AFTER_LID = 10;
const RISE_FRAMES = 16;
const GLIDE_FRAMES = 14;
const REVEAL_STAGGER_FRAMES = 12;
/** The slow-motion beat as the best reward of a Legendary or Divine chest rises. */
const HOLD_FRAMES = 20;
const POP_FRAMES = 10;
const COIN_TICK_FRAMES = 30;
/** Collect stays inert this long after the chest settles, so a held key cannot dismiss it unseen. */
export const COLLECT_GUARD_FRAMES = 18;
/** Every beat lengthens by this share per rung of rarity. */
const STRETCH_PER_RANK = 0.1;
/** The rarity from which the best reward gets its slow-motion hold. */
const HOLD_FROM: Rarity = 'Legendary';

/** Where one reward line is on its way from the chest to its slot. */
export interface RevealBeat {
  readonly line: GrantedLine;
  /** Frame it starts rising out of the chest. */
  readonly riseAt: number;
  /** Frame it reaches the top of its rise and begins gliding. */
  readonly glideAt: number;
  /** Frame it lands in its tray slot. */
  readonly landAt: number;
  /** Rises in slow motion with a flash: the chest's best reward, on a Legendary or Divine chest. */
  readonly held: boolean;
}

export interface ChestTimeline {
  readonly rarity: Rarity;
  readonly dropEnd: number;
  readonly idleEnd: number;
  readonly unlockEnd: number;
  readonly anticipationEnd: number;
  readonly lidEnd: number;
  readonly beats: readonly RevealBeat[];
  /** The frame the coin total starts ticking up, and the frame it is done. */
  readonly coinsFrom: number;
  readonly coinsTo: number;
  readonly settledAt: number;
}

/** How a line ranks in the reveal: coins first, the best gear and the companion last. */
function revealRank(line: GrantedLine): number {
  const GEAR_BASE = 3;
  const COMPANION_RANK = 10;
  switch (line.kind) {
    case 'coins':
      return 0;
    case 'duplicate':
      return 1;
    case 'item': {
      const rarity = ITEM_DEF[line.id].rarity;
      return rarity === undefined ? 2 : GEAR_BASE + rarityRank(rarity);
    }
    case 'companion':
      return COMPANION_RANK;
  }
}

/** The lines in the order they come out of the chest and fill the tray. */
function revealOrder(rewards: readonly GrantedLine[]): GrantedLine[] {
  return rewards
    .map((line, index) => ({ line, index }))
    .sort((a, b) => revealRank(a.line) - revealRank(b.line) || a.index - b.index)
    .map(({ line }) => line);
}

export function chestTimeline(rarity: Rarity, rewards: readonly GrantedLine[]): ChestTimeline {
  const stretch = 1 + rarityRank(rarity) * STRETCH_PER_RANK;
  const beat = (frames: number): number => Math.round(frames * stretch);
  const dropEnd = beat(DROP_FRAMES);
  const idleEnd = dropEnd + beat(IDLE_FRAMES);
  const unlockEnd = idleEnd + beat(UNLOCK_FRAMES);
  const anticipationEnd =
    unlockEnd + ANTICIPATION_BASE_FRAMES + rarityRank(rarity) * ANTICIPATION_FRAMES_PER_RANK;
  const lidEnd = anticipationEnd + beat(LID_FRAMES);
  const ordered = revealOrder(rewards);
  const holds = rarityAtLeast(rarity, HOLD_FROM);
  const beats: RevealBeat[] = [];
  let riseAt = anticipationEnd + FIRST_RISE_AFTER_LID;
  ordered.forEach((line, index) => {
    const held = holds && index === ordered.length - 1;
    const glideAt = riseAt + RISE_FRAMES + (held ? HOLD_FRAMES : 0);
    const landAt = glideAt + GLIDE_FRAMES;
    beats.push({ line, riseAt, glideAt, landAt, held });
    riseAt += REVEAL_STAGGER_FRAMES + (held ? HOLD_FRAMES : 0);
  });
  const coinBeat = beats.find((b) => b.line.kind === 'coins');
  const coinsFrom = coinBeat?.landAt ?? lidEnd;
  const coinsTo = coinBeat === undefined ? coinsFrom : coinsFrom + COIN_TICK_FRAMES;
  const lastLand = beats.reduce((latest, b) => Math.max(latest, b.landAt), lidEnd);
  const settledAt = Math.max(lastLand + POP_FRAMES, coinsTo);
  return {
    rarity,
    dropEnd,
    idleEnd,
    unlockEnd,
    anticipationEnd,
    lidEnd,
    beats,
    coinsFrom,
    coinsTo,
    settledAt,
  };
}

/** 0 before `from`, 1 after `to`, linear between. */
export function progress(frame: number, from: number, to: number): number {
  if (to <= from) return frame >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (frame - from) / (to - from)));
}

/** The pop of a slot as its reward lands: up past full size and back, 1 once settled. */
export function popScale(t: RevealBeat, frame: number): number {
  const POP_OVERSHOOT = 0.25;
  const p = progress(frame, t.landAt, t.landAt + POP_FRAMES);
  return 1 + Math.sin(p * Math.PI) * POP_OVERSHOOT;
}

/** How much of the coin total has landed. */
export function coinShare(t: ChestTimeline, frame: number): number {
  return progress(frame, t.coinsFrom, t.coinsTo);
}
