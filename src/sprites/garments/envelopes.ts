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

/** Her cheek ruffs' longest tuft, plus the rim of anything worn over her eyes that overhangs the skull. */
const CAT_HEAD_MARGIN = 0.08;
/** A hat may stand this far above her skull. */
const CAT_HAT_RISE = 0.15;
/** The collar band is thin; what hangs from it may hang this far below it. */
const CAT_COLLAR_MARGIN = 0.04;
const CAT_PENDANT_DROP = 0.15;
/** Her chest ruff's longest tuft. */
const CAT_BODY_MARGIN = 0.08;
/** A tailcoat's tails hang below her rump, past the bottom of her haunches. */
const CAT_COAT_TAIL_DROP = 0.14;
/** A leg's short fringe, plus a band standing proud of the fur. */
const CAT_LEG_MARGIN = 0.04;
/** Claw weapons stand past her toes: the longest, gold talons, reach this far below the paw. */
const CAT_CLAW_DROP = 0.06;
/** A bottle-brushed tail's longest tuft. */
const CAT_TAIL_MARGIN = 0.14;

const CAT_ENVELOPES: Readonly<Record<GarmentPart<'cat'>, EnvelopeAllowance>> = {
  head: { margin: CAT_HEAD_MARGIN, rise: CAT_HAT_RISE, drop: 0 },
  neck: { margin: CAT_COLLAR_MARGIN, rise: 0, drop: CAT_PENDANT_DROP },
  body: { margin: CAT_BODY_MARGIN, rise: 0, drop: CAT_COAT_TAIL_DROP },
  foreleg: { margin: CAT_LEG_MARGIN, rise: 0, drop: CAT_CLAW_DROP },
  hindleg: { margin: CAT_LEG_MARGIN, rise: 0, drop: 0 },
  tail: { margin: CAT_TAIL_MARGIN, rise: 0, drop: 0 },
};

/** A band or cuff round the wrist stands proud of his forearm, and gear on his fist stands off it. */
const HUMAN_FOREARM_MARGIN = 0.4;
/** A hat sits on his head and stands above it. */
const HUMAN_HEAD_MARGIN = 0.08;
const HUMAN_HAT_RISE = 0.3;
/** A shirt shows as a band just above his collar. */
const HUMAN_NECK_MARGIN = 0.03;
const HUMAN_SHIRT_RISE = 0.04;
/** His jacket's own silhouette, and its outline's width. */
const HUMAN_TORSO_MARGIN = 0.05;
/** The seat of his trousers stands off the hips by about a thigh's width. */
const HUMAN_HIPS_MARGIN = 0.15;
/**
 * A robe's skirt hangs from his hips to his ankles: painted over the legs at
 * the seat, edge-on it closes the gap a stride opens between them, which the
 * legs' own cloth cannot, each leg's envelope holding only its own leg.
 */
const HUMAN_HIPS_DROP = 1;
/** What hangs from his back may hang from his shoulders to his calves and flare past his arms. */
const HUMAN_BACK_MARGIN = 0.8;
const HUMAN_BACK_DROP = 1.2;
const HUMAN_FOOT_MARGIN = 0.08;
/** A boot shaft or a strapped pad stands proud of his leg by about a limb's width. */
const HUMAN_LEG_MARGIN = 0.15;

const HUMAN_ENVELOPES: Readonly<Record<GarmentPart<'human'>, EnvelopeAllowance>> = {
  head: { margin: HUMAN_HEAD_MARGIN, rise: HUMAN_HAT_RISE, drop: 0 },
  torso: { margin: HUMAN_TORSO_MARGIN, rise: 0, drop: 0 },
  neck: { margin: HUMAN_NECK_MARGIN, rise: HUMAN_SHIRT_RISE, drop: 0 },
  hips: { margin: HUMAN_HIPS_MARGIN, rise: 0, drop: HUMAN_HIPS_DROP },
  forearm: { margin: HUMAN_FOREARM_MARGIN, rise: 0, drop: 0 },
  back: { margin: HUMAN_BACK_MARGIN, rise: 0, drop: HUMAN_BACK_DROP },
  foot: { margin: HUMAN_FOOT_MARGIN, rise: 0, drop: 0 },
  leg: { margin: HUMAN_LEG_MARGIN, rise: 0, drop: 0 },
};

/** Every wearer's allowance per part. */
export const GARMENT_ENVELOPES: {
  readonly [W in GarmentWearer]: Readonly<Record<GarmentPart<W>, EnvelopeAllowance>>;
} = {
  cat: CAT_ENVELOPES,
  human: HUMAN_ENVELOPES,
};
