/**
 * The part frames a cat's anatomy publishes while it paints, and the dressing
 * it publishes them to.
 *
 * Her figure is painted piece by piece: each tuft of fur, then the face's
 * features, then the finished head. At every one of those moments the anatomy
 * hands the dressing a frame describing the piece, in the coordinates the
 * context is in at that moment, and whatever she wears on that part is painted
 * there — inside her own composition, so later pieces cover it exactly as they
 * cover her fur. Her coat is painted through the same call: it is the garment
 * every outfit of hers is built on.
 *
 * A frame's `envelope` is the silhouette it adds to its part, or null for a
 * moment that adds none (a point in the head's paint order rather than a piece
 * of fur). A garment on a part has to stay inside the union of its part's
 * envelopes, grown by the part's allowance.
 */

import type { FurPart, Pt } from './catArt';
import type { CatTailCoat } from '../looks/catLook';

type Ctx = CanvasRenderingContext2D;

/** Her own left or right, whichever way she faces on screen. */
export type CatSide = 'left' | 'right';

/** An ellipse in the coordinates of the frame that carries it. */
export interface CatEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/**
 * Where the head's landmarks sit, in head-local units: the origin at the
 * head's anchor, tilted and squeezed with it, +X to screen right in the
 * head-on views and toward her nose in profile.
 */
export interface CatHeadLandmarks {
  readonly skull: CatEllipse;
  /** Every eye the view shows: both head-on, the near one in profile, none from behind. */
  readonly eyes: readonly Pt[];
  /** The height her eyes sit at, whether or not the view shows them. */
  readonly eyeLine: number;
  /** How far the head is turned, -1 to her right through +1 to her left; 0 in profile. */
  readonly turn: number;
}

interface FurPiece {
  readonly fur: FurPart;
  readonly envelope: readonly Pt[];
}

/** The head's fur, painted in head-local units; an ear in its own rotated frame, root at the origin. */
export type CatHeadFurFrame =
  | (FurPiece & { readonly piece: 'ear'; readonly side: CatSide })
  | (FurPiece & { readonly piece: 'cheek'; readonly side: CatSide })
  | (FurPiece & { readonly piece: 'skull' | 'muzzle' });

/**
 * A moment in the head's paint order: `features` once her eyes, muzzle and
 * whiskers are on, `top` once the whole head is painted.
 */
export type CatHeadMoment =
  | { readonly piece: 'features'; readonly landmarks: CatHeadLandmarks; readonly envelope: null }
  | { readonly piece: 'top'; readonly landmarks: CatHeadLandmarks; readonly envelope: null };

export type CatHeadFrame = CatHeadFurFrame | CatHeadMoment;

/**
 * Where her neck meets her body, in pose space: the band a collar sits on,
 * painted after her body and before her head.
 */
export interface CatNeckFrame {
  readonly piece: 'collar';
  /**
   * The band round her neck as the camera sees it. Head-on and from behind it
   * is a wide, shallow ellipse whose lower arc is the side nearest the camera:
   * her throat head-on, her nape from behind. In profile it is a narrow
   * ellipse across her neck, tilted by `tilt`, its +X end at her throat.
   */
  readonly band: CatEllipse;
  readonly tilt: number;
  readonly envelope: readonly Pt[];
}

/**
 * One piece of her barrel, in pose space. A `blade` is a shoulder blade
 * standing up off the top of her barrel head-on, on a look that has them.
 */
export interface CatBodyFrame extends FurPiece {
  readonly piece: 'barrel' | 'blade' | 'haunch' | 'ruff' | 'belly' | 'chest';
  /** Which haunch, for a haunch; null for a piece on her midline. */
  readonly side: CatSide | null;
  /** The ellipse the piece's outline is wobbled from. */
  readonly shape: CatEllipse;
}

/**
 * One piece of a leg: a column or segment in its own frame, origin at the
 * joint it hangs from and +Y down the limb, or a paw in its own frame, origin
 * at the paw's centre. A two-bone leg is `upper` and `lower`; a hind leg drawn
 * with its hock is `upper`, `shank` and `hock`, the hock bone ending at the
 * paw.
 */
export type CatLegFrame =
  | (FurPiece & {
      readonly piece: 'column' | 'upper' | 'lower' | 'shank' | 'hock';
      readonly side: CatSide;
      readonly length: number;
      readonly halfWidth: number;
      /** Darkening of a leg in the body's shade, 0 for a leg in the light. */
      readonly shade: number;
    })
  | (FurPiece & {
      readonly piece: 'paw';
      readonly side: CatSide;
      /** The paw's half-width and half-height before its toes bulge. */
      readonly radiusX: number;
      readonly radiusY: number;
      /**
       * How far her claws are out, 0 sheathed to 1 fully extended, for a paw
       * that shows them; `catPawClaws` places them. A paw closed on a haft
       * reads 0: its claws are painted over the haft after the paw.
       */
      readonly claw: number;
      readonly shade: number;
    });

/** Her tail, in pose space: the spine it is built along and the half-width at each point. */
export interface CatTailFrame {
  readonly piece: 'tail';
  readonly spine: readonly Pt[];
  readonly widths: readonly number[];
  readonly coat: CatTailCoat;
  /** How far the tail's tufts poke past its silhouette, puffed out with it. */
  readonly fringe: number;
  readonly shade: number;
  readonly envelope: readonly Pt[];
}

/** Every part of hers a garment can cover, and the frame each publishes. */
export interface CatPartFrames {
  readonly head: CatHeadFrame;
  readonly neck: CatNeckFrame;
  readonly body: CatBodyFrame;
  readonly foreleg: CatLegFrame;
  readonly hindleg: CatLegFrame;
  readonly tail: CatTailFrame;
}

export type CatPartName = keyof CatPartFrames;

/**
 * What her anatomy paints her clothes through. `part` is called at every
 * piece of every part, with the context in that piece's coordinates.
 */
export interface CatDressing {
  readonly part: <P extends CatPartName>(ctx: Ctx, part: P, frame: CatPartFrames[P]) => void;
}
