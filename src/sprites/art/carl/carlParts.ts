/**
 * The part frames Carl's compositor publishes while it paints, and the
 * dressing it publishes them to.
 *
 * Carl is assembled slab by slab (`figure.ts`); at each piece that clothing
 * can sit on — his jacket, the band of shirt at his collar, his boxers, each
 * forearm, the cloak's place behind or over him, the toes of each foot, the
 * top of his head — the compositor hands the dressing a frame describing that
 * piece, with the context in the piece's own coordinates, and whatever he
 * wears there is painted inside the slab, so it shares the figure's outline,
 * rim and cast shadows. His jacket and heart boxers are painted through the
 * same call: they are the base garments every outfit of his is built on.
 *
 * A frame's `envelope` traces the silhouette it adds to its part, or is null
 * for a moment that adds none.
 */

import type { Outfit } from '../../garments/outfit';
import type { BodySide, BoneChain, CarlPose, Skeleton, ViewSpec } from './rig';
import type { TorsoFrame } from './torso';
import type { Pt } from '../carlArt';

type Ctx = CanvasRenderingContext2D;

/** Traces a piece's silhouette as a path on `ctx`, in the frame's coordinates. */
export type EnvelopeTrace = (ctx: Ctx) => void;

/** Something of Carl's a garment can hide rather than paint over. */
export type CarlHideableFeature = 'hair';

interface Solved {
  readonly skeleton: Skeleton;
  readonly view: ViewSpec;
}

/** His jacket, in figure space: the body of it, then its stand collar and the collar's lit lip. */
export interface CarlTorsoFrame extends Solved {
  readonly piece: 'jacket' | 'collar' | 'collarRim';
  readonly torso: TorsoFrame;
  readonly envelope: EnvelopeTrace | null;
}

/** The moments round his collar a shirt shows at: under the collar, then its lit lip over it. */
export interface CarlNeckFrame extends Solved {
  readonly piece: 'shirtUnder' | 'shirtLip';
  readonly torso: TorsoFrame;
  readonly envelope: EnvelopeTrace;
}

/** The legs of his boxers as the compositor lays them out, in figure space. */
export interface CarlLegPair {
  readonly left: BoneChain;
  readonly right: BoneChain;
}

/** The flutter of each leg of his boxers. */
export interface CarlShortsFlutter {
  readonly left?: Pt;
  readonly right?: Pt;
}

/** What he wears below the jacket's hem, in figure space. */
export type CarlHipsFrame = Solved &
  (
    | {
        readonly piece: 'shorts';
        readonly hip: Pt;
        readonly halfWidth: number;
        readonly flare: number;
        readonly legs: CarlLegPair;
        readonly flutter: CarlShortsFlutter;
        readonly envelope: EnvelopeTrace;
      }
    | {
        /** The mouth of a leg of the shorts, seen end-on round a thigh driven at the camera. */
        readonly piece: 'legEndOn';
        readonly leg: BoneChain;
        readonly towardCamera: number;
        readonly flutter: Pt | undefined;
        readonly envelope: EnvelopeTrace;
      }
    | {
        /** A leg of the shorts laid back over a knee driven at the camera. */
        readonly piece: 'legOver';
        readonly hip: Pt;
        readonly halfWidth: number;
        readonly flare: number;
        readonly legs: CarlLegPair;
        readonly flutter: CarlShortsFlutter;
        readonly side: BodySide;
        readonly envelope: EnvelopeTrace;
      }
  );

/**
 * One forearm, in figure space, painted with its hand or without it (behind
 * a held item's handle); or the moment over the finished, outlined figure
 * when anything drifting past his silhouette is painted.
 */
export type CarlForearmFrame = Solved &
  (
    | {
        readonly piece: 'arm';
        /** Which drawn arm: his own left or right as the view lays them out. */
        readonly drawn: BodySide;
        readonly chain: BoneChain;
        readonly pose: CarlPose;
        readonly envelope: EnvelopeTrace;
      }
    | {
        readonly piece: 'overFinished';
        readonly pose: CarlPose;
        readonly envelope: null;
      }
  );

/** Where a cloak hangs in his draw order: behind everything he is, or over his back. */
export interface CarlBackFrame extends Solved {
  readonly piece: 'behind' | 'over';
  readonly pose: CarlPose;
  readonly envelope: EnvelopeTrace;
}

/**
 * The toes of one foot, in the foot's own frame (origin at the ankle, the
 * foot's pitch applied), once the foot is painted. Head-on and in profile
 * only: from behind his toes do not show.
 */
export interface CarlToesFrame {
  readonly piece: 'toes';
  /** The foot on the drawn skeleton's `drawn` side. */
  readonly drawn: BodySide;
  readonly view: ViewSpec;
  /** Each toenail that faces the camera. */
  readonly nails: readonly Pt[];
  /** Where the key light catches the top of the foot. */
  readonly instep: Pt;
  /** Where a ring on his second toe sits, and the line it crosses the toe along. */
  readonly secondToe: Pt;
  readonly ringAcross: Pt;
  readonly envelope: EnvelopeTrace;
}

/**
 * One leg, in figure space, once it and its foot are painted: `leg` in its
 * slab with whatever of it the slab holds (`segments`), `kneeAtCamera` once a
 * knee driven at the camera is painted over the shorts.
 */
export interface CarlLegFrame extends Solved {
  readonly piece: 'leg' | 'kneeAtCamera';
  /** Which drawn leg: his own left or right as the view lays them out. */
  readonly drawn: BodySide;
  readonly chain: BoneChain;
  readonly segments: 'whole' | 'thigh' | 'lower';
  readonly pose: CarlPose;
  /** The foot's pitch in profile, its scale, and which way its toes turn out (−1 or +1). */
  readonly footPitch: number;
  readonly footScale: number;
  readonly footOut: number;
  readonly envelope: EnvelopeTrace;
}

/** The top of his head, in head-local units, once the head is painted. */
export interface CarlHeadFrame {
  readonly piece: 'top';
  readonly view: ViewSpec;
  readonly pose: CarlPose;
  readonly envelope: EnvelopeTrace;
}

/** Every part of his a garment can cover, and the frame each publishes. */
export interface CarlPartFrames {
  readonly head: CarlHeadFrame;
  readonly torso: CarlTorsoFrame;
  readonly neck: CarlNeckFrame;
  readonly hips: CarlHipsFrame;
  readonly forearm: CarlForearmFrame;
  readonly leg: CarlLegFrame;
  readonly back: CarlBackFrame;
  readonly foot: CarlToesFrame;
}

export type CarlPartName = keyof CarlPartFrames;

/**
 * What a row is, as far as garments that move with it need to know: whether
 * it is a punch his right fist lands, and on which frame, and the gait he
 * travels at in it, if he travels.
 */
export interface HumanGarmentRow {
  readonly name: string;
  readonly rightPunchImpact: number | null;
  readonly travellingGait: 'walk' | 'run' | null;
}

/** A picture of him drawn from no row: a still, a portrait, a cast member's look. */
export const STILL_ROW: HumanGarmentRow = {
  name: '',
  rightPunchImpact: null,
  travellingGait: null,
};

/**
 * What his compositor paints his clothes through. `part` is called at every
 * piece with the context in that piece's coordinates; `hides` says whether
 * something he wears covers a feature; `reach` is every point past his
 * skeleton the garments' ink reaches, so the composing surface is sized round
 * it.
 */
export interface CarlDressing {
  readonly part: <P extends CarlPartName>(ctx: Ctx, part: P, frame: CarlPartFrames[P]) => void;
  /** Whether anything he wears paints on `part`, for a slab that exists only to hold it. */
  readonly paints: (part: CarlPartName) => boolean;
  readonly hides: (feature: CarlHideableFeature) => boolean;
  readonly reach: (skeleton: Skeleton, view: ViewSpec) => readonly Pt[];
}

/**
 * What he is wearing on one pose, and the cell it is painted into: the
 * outfit, and the row and frame the garments that move with the row read.
 */
export interface CarlPoseOutfit {
  readonly outfit: Outfit<'human'>;
  readonly row: HumanGarmentRow;
  readonly frame: number;
  readonly frameCount: number;
}
