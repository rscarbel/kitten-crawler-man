/**
 * The part frames the figure's compositor publishes while it paints, and the
 * dressing it publishes them to.
 *
 * The figure is assembled slab by slab (`figure.ts`); at each piece that
 * clothing can sit on — its jacket, the band of shirt at its collar, the
 * seat over its hips, each forearm, the place behind or over its back, the toes of each
 * foot, the top of its head — the compositor hands the dressing a frame describing that
 * piece, with the context in the piece's own coordinates, and whatever he
 * wears there is painted inside the slab, so it shares the figure's outline,
 * rim and cast shadows. A look's base garments — Dave's jacket and jeans —
 * are painted through the same call: every outfit of the look is built on them.
 *
 * A frame's `envelope` traces the silhouette it adds to its part, or is null
 * for a moment that adds none.
 */

import type { Outfit } from '../../garments/outfit';
import type { HumanLook } from '../../looks/humanLook';
import type { Ramp } from './palette';
import type { BodySide, BoneChain, BipedPose, Skeleton, ViewSpec } from './rig';
import type { SleeveCloth } from './sleeve';
import type { TorsoFrame } from './torso';
import type { Pt } from '../bipedArt';

type Ctx = CanvasRenderingContext2D;

/** Traces a piece's silhouette as a path on `ctx`, in the frame's coordinates. */
export type EnvelopeTrace = (ctx: Ctx) => void;

interface Solved {
  readonly skeleton: Skeleton;
  readonly view: ViewSpec;
  /** Whose body the piece is: the look its skin and torso garment are painted in. */
  readonly look: HumanLook;
}

/** His jacket, in figure space: the body of it, then its stand collar and the collar's lit lip. */
export interface BipedTorsoFrame extends Solved {
  readonly piece: 'jacket' | 'collar' | 'collarRim';
  readonly torso: TorsoFrame;
  readonly envelope: EnvelopeTrace | null;
}

/** The moments round his collar a shirt shows at: under the collar, then its lit lip over it. */
export interface BipedNeckFrame extends Solved {
  readonly piece: 'shirtUnder' | 'shirtLip';
  readonly torso: TorsoFrame;
  readonly envelope: EnvelopeTrace;
}

/** What he wears below the jacket's hem: the seat over his hips, in figure space. */
export interface BipedHipsFrame extends Solved {
  readonly piece: 'seat';
  readonly envelope: EnvelopeTrace;
}

/**
 * One forearm, in figure space, painted with its hand or without it (behind
 * a held item's handle); or the moment over the finished, outlined figure
 * when anything drifting past his silhouette is painted.
 */
export type BipedForearmFrame = Solved &
  (
    | {
        readonly piece: 'arm';
        /** Which drawn arm: his own left or right as the view lays them out. */
        readonly drawn: BodySide;
        readonly chain: BoneChain;
        readonly pose: BipedPose;
        readonly envelope: EnvelopeTrace;
      }
    | {
        readonly piece: 'overFinished';
        readonly pose: BipedPose;
        readonly envelope: null;
      }
  );

/** Where something hung from his back sits in his draw order: behind everything he is, or over his back. */
export interface BipedBackFrame extends Solved {
  readonly piece: 'behind' | 'over';
  readonly pose: BipedPose;
  readonly envelope: EnvelopeTrace;
}

/**
 * The toes of one foot, in the foot's own frame (origin at the ankle, the
 * foot's pitch applied), once the foot is painted. Head-on and in profile
 * only: from behind his toes do not show.
 */
export interface BipedToesFrame {
  readonly piece: 'toes';
  /** The foot on the drawn skeleton's `drawn` side. */
  readonly drawn: BodySide;
  readonly view: ViewSpec;
  readonly look: HumanLook;
  /** Each toenail that faces the camera. */
  readonly nails: readonly Pt[];
  /** Where the key light catches the top of the foot. */
  readonly instep: Pt;
  readonly envelope: EnvelopeTrace;
}

/**
 * One leg, in figure space, once it and its foot are painted: `leg` in its
 * slab with whatever of it the slab holds (`segments`), `kneeAtCamera` once a
 * knee driven at the camera is painted over the seat.
 */
export interface BipedLegFrame extends Solved {
  readonly piece: 'leg' | 'kneeAtCamera';
  /** Which drawn leg: his own left or right as the view lays them out. */
  readonly drawn: BodySide;
  readonly chain: BoneChain;
  readonly segments: 'whole' | 'thigh' | 'lower';
  readonly pose: BipedPose;
  /** The foot's pitch in profile, its scale, and which way its toes turn out (−1 or +1). */
  readonly footPitch: number;
  readonly footScale: number;
  readonly footOut: number;
  readonly envelope: EnvelopeTrace;
}

/** The top of his head, in head-local units, once the head is painted. */
export interface BipedHeadFrame {
  readonly piece: 'top';
  readonly view: ViewSpec;
  readonly look: HumanLook;
  readonly pose: BipedPose;
  readonly envelope: EnvelopeTrace;
}

/** Every part of his a garment can cover, and the frame each publishes. */
export interface BipedPartFrames {
  readonly head: BipedHeadFrame;
  readonly torso: BipedTorsoFrame;
  readonly neck: BipedNeckFrame;
  readonly hips: BipedHipsFrame;
  readonly forearm: BipedForearmFrame;
  readonly leg: BipedLegFrame;
  readonly back: BipedBackFrame;
  readonly foot: BipedToesFrame;
}

export type BipedPartName = keyof BipedPartFrames;

/** What a row is, as far as garments that move with it need to know. */
export interface HumanGarmentRow {
  readonly name: string;
}

/** A picture of him drawn from no row: a still, a portrait, a cast member's look. */
export const STILL_ROW: HumanGarmentRow = { name: '' };

/**
 * What his compositor paints his clothes through. `part` is called at every
 * piece with the context in that piece's coordinates.
 */
export interface BipedDressing {
  readonly part: <P extends BipedPartName>(ctx: Ctx, part: P, frame: BipedPartFrames[P]) => void;
  /** Whether anything he wears paints on `part`, for a slab that exists only to hold it. */
  readonly paints: (part: BipedPartName) => boolean;
  /** The sleeves what he wears brings over his arms, or null for his look's own. */
  readonly sleeves: SleeveCloth | null;
  /** The ramp a glove paints his own `side` hand in, or null for a bare hand. */
  readonly glove: (side: BodySide) => Ramp | null;
}

/**
 * What he is wearing on one pose, and the cell it is painted into: the
 * outfit, and the row and frame the garments that move with the row read.
 */
export interface BipedPoseOutfit {
  readonly outfit: Outfit<'human'>;
  readonly row: HumanGarmentRow;
  readonly frame: number;
  readonly frameCount: number;
}
