/**
 * What of Midge's escort survives a door. Going into a building replaces the
 * overworld scene and throws its roster away, Midge with it; this one mutable
 * record is created by the overworld `DungeonScene` and handed by reference to
 * the scene rebuilt on the way out, the way `BountyProgress` is, so she is
 * found again where the party left her — still led, as hurt as she was — and
 * the ambushes already sprung on the road stay sprung.
 *
 * Never saved, and never part of a checkpoint: a load or a death rewind puts
 * Midge back at Merrit's pasture gate, which is where a scene built without
 * this record (or with it empty) puts her anyway.
 */

/** Where Midge stood when the party went through a door, and how much health she had. */
export interface CarriedMidge {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
}

export interface MidgeEscortCarry {
  /** Midge mid-escort, led by the party; null while she waits at Merrit's gate or is not out at all. */
  midge: CarriedMidge | null;
  /** How many of the road's ambush waves have been sprung on this attempt at the escort. */
  wavesSprung: number;
}

export function createMidgeEscortCarry(): MidgeEscortCarry {
  return { midge: null, wavesSprung: 0 };
}
