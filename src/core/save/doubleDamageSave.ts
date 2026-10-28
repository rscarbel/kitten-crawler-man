import { isRecord } from '../util/guards';
import type { PlayerSnapshot } from './playerSnapshotFormat';
import { DOUBLE_DAMAGE_STATUS } from '../combat/StatusEffect';
import { DOUBLE_DAMAGE_FRAMES } from '../combat/statusTuning';

/**
 * Frames of double damage each crawler has left, saved at the top level of the
 * save so the curse survives every path that rebuilds a crawler from a
 * snapshot with its statuses stripped. The live status on the crawler is the
 * truth while the game runs; this is only how it crosses a save.
 */
export interface DoubleDamageRemaining {
  human: number;
  cat: number;
}

export function doubleDamageFramesIn(snap: Pick<PlayerSnapshot, 'statusEffects'>): number {
  const effect = snap.statusEffects.find((status) => status.type === DOUBLE_DAMAGE_STATUS);
  return effect === undefined ? 0 : Math.max(0, effect.ticksRemaining);
}

export function doubleDamageRemainingOf(
  humanSnap: Pick<PlayerSnapshot, 'statusEffects'>,
  catSnap: Pick<PlayerSnapshot, 'statusEffects'>,
): DoubleDamageRemaining {
  return { human: doubleDamageFramesIn(humanSnap), cat: doubleDamageFramesIn(catSnap) };
}

/**
 * The snapshot with its double damage set to `frames` left: added when the
 * snapshot lost it, left alone when there is none to restore.
 */
export function withDoubleDamageFrames(snap: PlayerSnapshot, frames: number): PlayerSnapshot {
  if (frames <= 0) return snap;
  const others = snap.statusEffects.filter((status) => status.type !== DOUBLE_DAMAGE_STATUS);
  const remaining = Math.min(frames, DOUBLE_DAMAGE_FRAMES);
  return {
    ...snap,
    statusEffects: [
      ...others,
      {
        type: DOUBLE_DAMAGE_STATUS,
        ticksRemaining: remaining,
        totalTicks: DOUBLE_DAMAGE_FRAMES,
        applier: null,
      },
    ],
  };
}

function isFrameCount(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0;
}

export function parseDoubleDamageRemaining(raw: unknown): DoubleDamageRemaining | undefined {
  if (!isRecord(raw)) return undefined;
  const { human, cat } = raw;
  if (!isFrameCount(human) || !isFrameCount(cat)) return undefined;
  return { human, cat };
}
