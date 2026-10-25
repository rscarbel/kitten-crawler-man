/**
 * What one cat looks like: her coat, her face, her proportions and her fur.
 *
 * The cat painters in `catArt.ts` are generic anatomy plus a fur engine; every
 * colour, patch and proportion that makes one cat herself comes from the look
 * handed to them. A look names its own coat tones (the engine never does), so
 * a new coat is a new look file, not a change to the engine.
 *
 * Patch coordinates are in the frame of the part they sit on, as each layout's
 * doc says; the painters place and mirror them.
 */

import type { CoatLayout, CoatTone, Flank } from '../art/catArt';
import type { CatSide } from '../art/catParts';
import type { OutfitBase } from '../garments/outfit';
import type { StatusFigureBox } from '../../Player';

/** An ellipse's half-width and half-height, tile units. */
export interface CatRadii {
  readonly rx: number;
  readonly ry: number;
}

/** The coat the head-on and from-behind views paint. */
export interface CatHeadOnCoat {
  /** Her barrel head-on, about its centre: her chest. */
  readonly barrel: CoatLayout;
  /** Her barrel from behind, about its centre in screen coordinates: her back. */
  readonly backBarrel: CoatLayout;
  /** Each haunch head-on, about its centre; from behind mirrored on the screen-left one. */
  readonly haunch: CoatLayout;
  /** Her chest ruff, about its centre. */
  readonly ruff: CoatLayout;
  /** Her face, in head-local units. */
  readonly face: CoatLayout;
  /** The back of her head, in head-local units. */
  readonly backOfHead: CoatLayout;
  /**
   * Each cheek ruff by the screen half it is painted on, in shares of the
   * cheek's radii about its centre.
   */
  readonly cheeks: Readonly<Record<'screenLeft' | 'screenRight', CoatLayout>>;
  /** A paw, about its centre. */
  readonly paw: CoatLayout;
  /** A head-on leg column: x in tile units across it, y in shares of its length down it. */
  readonly legColumn: CoatLayout;
}

/** An ear: the side facing the camera, and its back. In shares of the ear's half-width and height. */
export interface CatEarCoat {
  readonly front: CoatLayout;
  readonly back: CoatLayout;
}

/** The coat one flank shows in profile, +X toward her nose, each layout about the part it sits on. */
export interface CatFlankCoat {
  readonly barrel: CoatLayout;
  readonly haunch: CoatLayout;
  readonly chest: CoatLayout;
  /** In the profile head's own frame. */
  readonly head: CoatLayout;
  /** The muzzle wedge, in the profile head's own frame. */
  readonly muzzle: CoatLayout;
}

/** The coat the profile views paint. */
export interface CatProfileCoat {
  readonly flanks: Readonly<Record<Flank, CatFlankCoat>>;
  /** The belly pouch: x in shares of her barrel's half-width, y in tile units, about the pouch's centre. */
  readonly belly: CoatLayout;
  /** A leg segment: x in shares of its half-width, y in shares of its length down it. */
  readonly limb: CoatLayout;
  /**
   * How deep her far legs sit in her body's shadow, 0–1: what tells the far
   * pair from the near one, so a dark coat needs more of it.
   */
  readonly farLimbShade: number;
}

/** Flecks of warm tones scattered over the root end of a tail. */
export interface CatTailFlecks {
  readonly tones: readonly [CoatTone, ...CoatTone[]];
  /** How many flecks, and how far from the root they reach as a share of the tail's length. */
  readonly count: number;
  readonly reach: number;
  /** A fleck's radius as a share of the tail's half-width where it sits. */
  readonly size: number;
  /** How softly each fleck fades into the tail, as a coat patch's `feather`. */
  readonly feather: number;
}

/**
 * A tail's coat: the ground tone, the tones its bands take in turn from root
 * to tip, and any flecks over its root end; null for a tail without them.
 */
export interface CatTailCoat {
  readonly base: CoatTone;
  readonly rings: readonly [CoatTone, ...CoatTone[]];
  readonly flecks: CatTailFlecks | null;
  /**
   * A faint cool light just inside the tail's outline; null for none. A black
   * tail swung out against a dark floor, or carried over her own black back,
   * otherwise has no edge to read by at the 32 px tile.
   */
  readonly rim: CatRimLight | null;
}

export interface CatCoat {
  readonly headOn: CatHeadOnCoat;
  readonly ear: CatEarCoat;
  readonly profile: CatProfileCoat;
  readonly tail: CatTailCoat;
  /**
   * A faint cool light along the inside edge of her near legs, a surface pixel
   * wide; null for none. A black coat's legs otherwise dissolve into a dark
   * floor at the 32 px tile, and the step goes with them.
   */
  readonly nearLegRim: CatRimLight | null;
}

export interface CatRimLight {
  readonly colour: string;
  /** 0–1: enough to separate the part from a dark floor, not enough to outline it. */
  readonly alpha: number;
}

/** An iris as a radial gradient, from the pupil out. */
export interface CatIris {
  readonly inner: string;
  readonly mid: string;
  readonly outer: string;
}

/**
 * A narrow stripe of a lighter tone running down the middle of her face
 * head-on, from between her ears to the bridge of her nose. Head-local units.
 */
export interface CatBlaze {
  readonly tone: CoatTone;
  /** How far the stripe sits off her midline, toward her own `side`, at the forehead and at the nose. */
  readonly side: CatSide;
  readonly offsetTop: number;
  readonly offsetBottom: number;
  /** Its half-width at the forehead and where it meets the nose. */
  readonly halfWidthTop: number;
  readonly halfWidthBottom: number;
  /** How high it starts, as a share of the skull's half-height above its middle. */
  readonly topShare: number;
  /**
   * How far its middle bows toward her own `side`, head units: a real blaze
   * wanders between the eyes rather than running ruler-straight.
   */
  readonly bend: number;
  /** 0–1: how strongly the stripe covers the coat; under 1 the black shows through, as a grizzled blaze's does. */
  readonly opacity: number;
  /** Specks of `tone` scattered over the muzzle on the blaze's side. */
  readonly muzzleSpecks: number;
}

/** A tooth that shows past her closed lip on one side, whichever way she faces. */
export interface CatTooth {
  readonly side: CatSide;
  readonly colour: string;
}

export interface CatFace {
  readonly iris: CatIris;
  readonly pupil: string;
  readonly glint: string;
  /** The dark of the lines drawn on her face: lids, the closed mouth, whisker pores. */
  readonly ink: string;
  /**
   * The nose, lit from above: `light` at its top, `dark` at its bottom, with a
   * spot of each `mottle` colour scattered over it; none for a clean nose.
   */
  readonly nose: {
    readonly light: string;
    readonly dark: string;
    readonly mottle: readonly string[];
  };
  readonly mouth: string;
  readonly tongue: string;
  readonly fang: string;
  readonly whisker: string;
  /** Multiplies her eyes' height against their width: rounder, more wide-open eyes above 1. */
  readonly eyeRoundness: number;
  /** How much lower her eyes sit head-on than the engine's, head units: the height of her forehead. */
  readonly eyeDrop: number;
  /**
   * Her pupil's height as a share of her eye's: over 1 a slit that runs past
   * the lids, under 1 an oval with iris showing above and below it.
   */
  readonly pupilHeight: number;
  /** Multiplies her eyes' size, lids and all; a real cat's eye is about a fifth of her head's width. */
  readonly eyeScale: number;
  /** Multiplies how far apart her eyes sit head-on. */
  readonly eyeSpread: number;
  /** How much higher her brow whiskers spring than the engine's, head units, clear of her upper lids. */
  readonly browWhiskerRise: number;
  /** Multiplies her brow whiskers' length. */
  readonly browWhiskerLength: number;
  /** Multiplies her brow whiskers' opacity: faint, they read as whiskers; strong and short, as a frowning brow. */
  readonly browWhiskerAlpha: number;
  /** Multiplies her muzzle whiskers' length: long pale whiskers are spikes off a round head at the 32 px tile. */
  readonly whiskerLength: number;
  /** Multiplies her muzzle whiskers' opacity. */
  readonly whiskerAlpha: number;
  /** Every other whisker in this colour, for a cat whose whiskers are mixed; null where they are all `whisker`. */
  readonly whiskerAlternate: string | null;
  /** The tone of the two pads either side of the muzzle, lit at `light` and settling to `base`. */
  readonly muzzlePads: CoatTone;
  /** A pale mask round the muzzle, painted half-transparent; null for a face without one. */
  readonly muzzleMask: string | null;
  /** The inside of an ear, `dark` at the tip and `light` at the root, with tufts of `furnishing`. */
  readonly innerEar: {
    readonly light: string;
    readonly dark: string;
    readonly furnishing: string;
    /**
     * How far up the ear the pale inside reaches, as a share of its height:
     * at the 32 px tile a pale inside right to the tip rounds the ear off.
     */
    readonly reach: number;
  };
  readonly blaze: CatBlaze | null;
  readonly tooth: CatTooth | null;
}

export interface CatPaws {
  readonly toeBean: string;
  /** The creases between the toes. */
  readonly toeLine: string;
  readonly claw: string;
}

/** A hind leg drawn with its hock in profile: thigh, shank and the long hock bone to the paw. */
export interface CatHindHock {
  /** The share of the lower leg's length that is the hock bone, standing steeply up behind the paw. */
  readonly share: number;
  /** Multiplies the thigh's width: a cat's hind leg is heavy above the stifle. */
  readonly thigh: number;
}

/** How her head and neck read seen from behind, where the face gives nothing away. */
export interface CatBackView {
  /** Multiplies the size of her head, against her shoulders. */
  readonly headScale: number;
  /** Multiplies her skull's height alone: under 1 reads as the broad, flat-topped dome of a cat. */
  readonly headHeight: number;
  /** Multiplies her ears' height. */
  readonly earHeight: number;
  /** Draws her ear roots this share in from the skull's edge, so they sit on its top corners. */
  readonly earInset: number;
  /**
   * Her nape as a share of her skull's width, flowing down into her
   * shoulders; 0 leaves the skull a disc on the body, which reads as a mouse.
   */
  readonly nape: number;
  /**
   * Paints her tail over her nape and the back of her head instead of under
   * them: from behind a raised tail is the nearest part of her, and under the
   * head a tail carried up over her back can only show as a spike past an ear.
   */
  readonly tailOverNape: boolean;
}

export interface CatProportions {
  /** Her barrel head-on, standing and sitting. */
  readonly body: CatRadii & { readonly sittingRx: number; readonly sittingRy: number };
  readonly profileBody: CatRadii;
  readonly head: CatRadii;
  readonly profileHead: CatRadii;
  /**
   * Her ears head-on and from behind: half the base's width, the height, how
   * far each leans out from upright, radians, at rest, and how straight their
   * sides run, 0 bowed out like a leaf to 1 a straight-sided triangle.
   */
  readonly ear: {
    readonly halfWidth: number;
    readonly height: number;
    readonly lean: number;
    readonly straightEdges: number;
  };
  readonly ruff: CatRadii;
  readonly cheek: CatRadii;
  /** The profile legs' bones, hip or shoulder to knee and knee to paw. */
  readonly legs: {
    readonly foreUpper: number;
    readonly foreLower: number;
    readonly hindUpper: number;
    readonly hindLower: number;
  };
  readonly tail: {
    readonly length: number;
    readonly baseWidth: number;
    readonly tipWidth: number;
    /** How much wider than its taper the tail swells along its middle, as a share. */
    readonly swell: number;
  };
  /**
   * How far her legs hold her barrel and head above the engine's stance, tile
   * units, head-on (and from behind) and in profile: what longer legs look
   * like when the paws stay on the floor. Head-on the legs are seen against
   * her chest rather than below a barrel's length, so they lift her further
   * there to show as long.
   */
  readonly legLift: { readonly headOn: number; readonly profile: number };
  /**
   * How much lower her head is carried than the engine's, tile units, head-on
   * (and from behind) and in profile: a shallower chest needs the head brought
   * down onto it or a gap opens under her chin, and a long-legged cat carries
   * her head level with her back rather than up on her neck.
   */
  readonly neckDrop: { readonly headOn: number; readonly profile: number };
  /**
   * Multiplies how far apart her shoulders, hips, chest, haunch and head sit
   * along her in profile: a long-bodied cat is this much longer than the
   * engine's.
   */
  readonly profileLength: number;
  /** Multiplies her muzzle's width head-on: whisker pads, nose and mouth. Under 1 narrows the face into a wedge. */
  readonly muzzleWidth: number;
  /** Multiplies how far her muzzle reaches forward of her skull in profile. */
  readonly profileMuzzle: number;
  /** Multiplies her ears' width at the base in profile. */
  readonly profileEarWidth: number;
  /**
   * How much lower her nose sits under her eyes head-on than the engine's,
   * head units: the length of the bridge of her nose.
   */
  readonly noseDrop: number;
  /**
   * Her ears in profile: `squeezed`, the head-on ear narrowed, its pink
   * inside to the camera; `sideOn`, a broad-based flap seen edge-on to its
   * forward-facing opening (`drawSideOnEar`).
   */
  readonly profileEars: 'squeezed' | 'sideOn';
  /**
   * How far her shoulder blades rise over a planted foreleg head-on, tile
   * units: 0 for a cat whose barrel hides them.
   */
  readonly bladeRise: number;
  /** Multiplies how far apart her ear roots sit across her skull: under 1 keeps the tips over the cheeks. */
  readonly earSpread: number;
  readonly backView: CatBackView;
  /** Her hind legs in profile with a hock; null draws them as two bones like her forelegs. */
  readonly hindHock: CatHindHock | null;
  /** Multiplies her ears' height in profile, where they are seen from the side. */
  readonly profileEarHeight: number;
  /** Multiplies the width of her pupils. */
  readonly pupilScale: number;
  /** Multiplies the width of every leg column and segment. */
  readonly limbWidth: number;
  /** Multiplies how far apart her hind paws stand head-on and from behind. */
  readonly hindPawSpread: number;
  /** Multiplies the size of every paw. */
  readonly pawScale: number;
  /** Each haunch head-on, from behind and in profile. */
  readonly haunch: {
    readonly headOn: CatRadii;
    /**
     * Head-on, standing, her haunches show at this share of their size: a
     * standing cat's hindquarters are behind her chest, and only sat back on
     * them do they spread either side of her.
     */
    readonly headOnStandingShare: number;
    readonly back: CatRadii;
    readonly profile: CatRadii;
  };
  readonly profileChest: CatRadii;
  /** The belly pouch in profile: its half-width as a share of her barrel's, and its half-height. */
  readonly belly: { readonly widthShare: number; readonly ry: number };
  /**
   * How much narrower the head-on skull grows toward the chin, as a share of
   * its half-width: 0 a round head, larger a wedge.
   */
  readonly chinTaper: number;
}

export interface CatFur {
  /** Multiplies every piece's fringe: how far her tufts poke past each silhouette. */
  readonly fringe: number;
  /** Whether a deep ruff covers her chest head-on. */
  readonly ruff: boolean;
  /** Whether ruffs break the outline of her cheeks head-on and from behind. */
  readonly cheekRuffs: boolean;
  /** Multiplies the length of every hair stroke the fur engine lays inside her silhouette. */
  readonly hairLength: number;
  /** How much wider her tail grows per unit of the pose's `puff`. */
  readonly tailPuff: number;
}

/**
 * How a cat walks: `trot`, the diagonal pairs swung together with the legs
 * marching head-on; `lateralWalk`, a cat's lateral-sequence walk with the
 * paws set down on her centreline (`catLateralWalk.ts`).
 */
export type CatGait = 'trot' | 'lateralWalk';

export interface CatOutline {
  readonly colour: string;
  /** 0–1. */
  readonly alpha: number;
  /** Its width in cell pixels: two are one pixel at the in-game tile. */
  readonly widthPx: number;
}

/** Everything that makes one cat look like herself, and the clothes every outfit of hers starts from. */
export interface CatLook extends OutfitBase<'cat'> {
  /** Names the look in figure ids, so two looks never share a cached cell. */
  readonly id: string;
  readonly coat: CatCoat;
  readonly face: CatFace;
  readonly paws: CatPaws;
  readonly proportions: CatProportions;
  readonly fur: CatFur;
  readonly gait: CatGait;
  /**
   * Her ink, measured off her painted idle cell against its own tile anchor:
   * what the status effects hang off. A cat is roughly tile-shaped but sits
   * low and to the right of it, so a status painted on the tile would float
   * off her back, and each cat's build is her own, so a box measured on one
   * cat hangs off another's flanks.
   */
  readonly statusFigureBox: StatusFigureBox;
  /**
   * A line round her whole silhouette, or null for none. A near-black cat
   * vanishes into a dark floor at the tile, and a light line round her keeps
   * her shape there; on a light floor her own dark coat already does.
   */
  readonly outline: CatOutline | null;
}
