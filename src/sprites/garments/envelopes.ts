/**
 * How far a garment may reach past the part it is worn on. A part's envelope
 * is the union of the silhouettes its pieces publish, grown by `margin` all
 * round and swept `rise` up and `drop` down in each piece's own frame: a hat
 * may stand above the skull, a pendant may hang below the collar, and nothing
 * may stray further. Units are tile units, in the frame of the piece.
 *
 * Every margin is at least as long as the longest tuft the coat's fringe grows
 * on that part, since the coat is a garment too and is held to the same rule.
 */

import type { GarmentPart, GarmentWearer } from './garmentDef';

export interface EnvelopeAllowance {
  readonly margin: number;
  readonly rise: number;
  readonly drop: number;
}

/** Her cheek ruffs' longest tuft, plus the rim of a lens that overhangs the skull. */
const CAT_HEAD_MARGIN = 0.08;
/** A hat stands this far above her skull: the height of the crown's tallest point. */
const CAT_HAT_RISE = 0.15;
/** The collar band is thin; what hangs from it may hang this far below it. */
const CAT_COLLAR_MARGIN = 0.04;
const CAT_PENDANT_DROP = 0.15;
/** Her chest ruff's longest tuft. */
const CAT_BODY_MARGIN = 0.08;
/** A leg's short fringe, plus a band standing proud of the fur. */
const CAT_LEG_MARGIN = 0.04;
/** A bottle-brushed tail's longest tuft. */
const CAT_TAIL_MARGIN = 0.14;

const CAT_ENVELOPES: Readonly<Record<GarmentPart<'cat'>, EnvelopeAllowance>> = {
  head: { margin: CAT_HEAD_MARGIN, rise: CAT_HAT_RISE, drop: 0 },
  neck: { margin: CAT_COLLAR_MARGIN, rise: 0, drop: CAT_PENDANT_DROP },
  body: { margin: CAT_BODY_MARGIN, rise: 0, drop: 0 },
  foreleg: { margin: CAT_LEG_MARGIN, rise: 0, drop: 0 },
  hindleg: { margin: CAT_LEG_MARGIN, rise: 0, drop: 0 },
  tail: { margin: CAT_TAIL_MARGIN, rise: 0, drop: 0 },
};

/** A wrist bracer stands proud of his forearm, and the gauntlet's spikes stand off his fist. */
const CARL_FOREARM_MARGIN = 0.4;
/** A hat sits on his head and stands above it. */
const CARL_HEAD_MARGIN = 0.08;
const CARL_HAT_RISE = 0.3;
/** A shirt shows as a band just above his collar. */
const CARL_NECK_MARGIN = 0.03;
const CARL_SHIRT_RISE = 0.04;
/** His jacket's own silhouette, and its outline's width. */
const CARL_TORSO_MARGIN = 0.05;
/** A leg of his boxers brought round a thigh driven at the camera stands off the bone by a thigh's width. */
const CARL_HIPS_MARGIN = 0.15;
/** A cloak hangs from his shoulders to his calves, flares past his arms and streams behind a run. */
const CARL_CLOAK_MARGIN = 0.8;
const CARL_CLOAK_DROP = 1.2;
const CARL_FOOT_MARGIN = 0.08;
/** A kneepad or a boot shaft stands proud of his leg by about a limb's width. */
const CARL_LEG_MARGIN = 0.15;

const CARL_ENVELOPES: Readonly<Record<GarmentPart<'human'>, EnvelopeAllowance>> = {
  head: { margin: CARL_HEAD_MARGIN, rise: CARL_HAT_RISE, drop: 0 },
  torso: { margin: CARL_TORSO_MARGIN, rise: 0, drop: 0 },
  neck: { margin: CARL_NECK_MARGIN, rise: CARL_SHIRT_RISE, drop: 0 },
  hips: { margin: CARL_HIPS_MARGIN, rise: 0, drop: 0 },
  forearm: { margin: CARL_FOREARM_MARGIN, rise: 0, drop: 0 },
  back: { margin: CARL_CLOAK_MARGIN, rise: 0, drop: CARL_CLOAK_DROP },
  foot: { margin: CARL_FOOT_MARGIN, rise: 0, drop: 0 },
  leg: { margin: CARL_LEG_MARGIN, rise: 0, drop: 0 },
};

/** Every wearer's allowance per part. */
export const GARMENT_ENVELOPES: {
  readonly [W in GarmentWearer]: Readonly<Record<GarmentPart<W>, EnvelopeAllowance>>;
} = {
  cat: CAT_ENVELOPES,
  human: CARL_ENVELOPES,
};
