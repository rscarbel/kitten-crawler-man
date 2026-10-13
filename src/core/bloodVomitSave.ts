import { isRecord } from './guards';
import type { PlayerSnapshot } from './PlayerSnapshot';
import { BLOOD_VOMIT_STATUS } from './StatusEffect';
import { BLOOD_VOMIT_FRAMES } from './statusTuning';

/**
 * Frames of blood vomiting each crawler has left, saved at the top level of the
 * save so the status survives every path that rebuilds a crawler from a
 * snapshot with its statuses stripped. The live status on the crawler is the
 * truth while the game runs; this is only how it crosses a save.
 */
export interface BloodVomitRemaining {
  human: number;
  cat: number;
}

export function bloodVomitFramesIn(snap: Pick<PlayerSnapshot, 'statusEffects'>): number {
  const effect = snap.statusEffects.find((status) => status.type === BLOOD_VOMIT_STATUS);
  return effect === undefined ? 0 : Math.max(0, effect.ticksRemaining);
}

export function bloodVomitRemainingOf(
  humanSnap: Pick<PlayerSnapshot, 'statusEffects'>,
  catSnap: Pick<PlayerSnapshot, 'statusEffects'>,
): BloodVomitRemaining {
  return { human: bloodVomitFramesIn(humanSnap), cat: bloodVomitFramesIn(catSnap) };
}

/**
 * The snapshot with its blood vomiting set to `frames` left: added when the
 * snapshot lost it, left alone when there is none to restore.
 */
export function withBloodVomitFrames(snap: PlayerSnapshot, frames: number): PlayerSnapshot {
  if (frames <= 0) return snap;
  const others = snap.statusEffects.filter((status) => status.type !== BLOOD_VOMIT_STATUS);
  const remaining = Math.min(frames, BLOOD_VOMIT_FRAMES);
  return {
    ...snap,
    statusEffects: [
      ...others,
      {
        type: BLOOD_VOMIT_STATUS,
        ticksRemaining: remaining,
        totalTicks: BLOOD_VOMIT_FRAMES,
        applier: null,
      },
    ],
  };
}

function parseFrames(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

export function parseBloodVomitRemaining(raw: unknown): BloodVomitRemaining | undefined {
  if (!isRecord(raw)) return undefined;
  return { human: parseFrames(raw.human), cat: parseFrames(raw.cat) };
}
