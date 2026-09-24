import { isRecord } from '../../core/guards';

/** Point-in-time gym state, restorable any number of times. */
export interface JuicerRoomCheckpoint {
  /** Per rack, per slot: frames until it refills, 0 for a filled slot. */
  racks: number[][];
  /** Per bench: frames until it is back, 0 for one on the floor. */
  benches: number[];
  squatRackStrippedFrames: number[];
  consoleShutoffFrames: number[];
  boomboxHp: number;
  sealed: boolean;
  defeated: boolean;
  mirrorCracked: boolean;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

/** Reads a saved gym checkpoint back from untrusted JSON; undefined when it is malformed. */
export function parseJuicerRoomCheckpoint(value: unknown): JuicerRoomCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { racks, benches, squatRackStrippedFrames, consoleShutoffFrames } = value;
  const { boomboxHp, sealed, defeated, mirrorCracked } = value;
  if (!Array.isArray(racks) || !racks.every(isNumberArray)) return undefined;
  if (!isNumberArray(benches) || !isNumberArray(squatRackStrippedFrames)) return undefined;
  if (!isNumberArray(consoleShutoffFrames) || typeof boomboxHp !== 'number') return undefined;
  if (typeof sealed !== 'boolean' || typeof defeated !== 'boolean') return undefined;
  if (typeof mirrorCracked !== 'boolean') return undefined;
  return {
    racks: racks.filter(isNumberArray),
    benches,
    squatRackStrippedFrames,
    consoleShutoffFrames,
    boomboxHp,
    sealed,
    defeated,
    mirrorCracked,
  };
}
