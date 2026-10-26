/**
 * The frame a garment's skirt hangs in below his torso: the part of an apron
 * or a long coat that falls from his waist over the tops of his thighs. It is
 * painted at the seat over his hips, so his legs stay under it and the torso
 * garment's hem laps over its top.
 */

import type { BipedHipsFrame } from '../../art/biped/bipedParts';
import { pt } from '../../art/biped/geometry';
import type { Pt } from '../../art/bipedArt';

export interface SkirtFrame {
  /** A point `x` across his hips and `share` of the way from his waist down to the skirt's hem. */
  readonly place: (x: number, share: number) => Pt;
  /** The rotation of his hips' across axis, for ellipses laid along it. */
  readonly rotation: number;
  /** The skirt's length from his waist down to its hem. */
  readonly length: number;
}

/** A skirt falling `dropBelowHip` past his hip joint, along his spine. */
export function skirtFrame(frame: BipedHipsFrame, dropBelowHip: number): SkirtFrame {
  const { waist, hip } = frame.skeleton;
  const spine = { x: hip.x - waist.x, y: hip.y - waist.y };
  const spineLength = Math.hypot(spine.x, spine.y);
  const down = spineLength === 0 ? pt(0, 1) : pt(spine.x / spineLength, spine.y / spineLength);
  const across = pt(down.y, -down.x);
  const length = spineLength + dropBelowHip;
  return {
    place: (x, share) =>
      pt(
        waist.x + across.x * x + down.x * share * length,
        waist.y + across.y * x + down.y * share * length,
      ),
    rotation: Math.atan2(across.y, across.x),
    length,
  };
}
