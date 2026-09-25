/**
 * What a ratkin wears, how he is built, and what he carries — the outfit the
 * shared ratkin painter (`ratKinArt.ts`) is handed for every frame.
 *
 * One rig paints every ratkin in the game. Mordecai, each Briar Hollow
 * villager and anything built on them later differ only in the
 * {@link RatkinOutfit} passed in: fur ramps, a proportion preset, an ordered
 * stack of garment layers and an optional held prop.
 *
 * **An outfit is a closed, per-figure fact, never per instance.** Cached cells
 * are keyed on `(figure, state, frame)`, so a look has to be baked into its own
 * `FigureDef` (one id per character) rather than read off a creature at paint
 * time. See `ratkinCastFigure.ts` for how the cast does that.
 *
 * Adding a garment: write a factory in `garments.ts` (or anywhere) that returns
 * a {@link GarmentLayer}. A layer is a set of optional slot painters, each a
 * pure function of the {@link GarmentFrame} it is handed — the pose, the solved
 * skeleton and the view — so the same layer serves every row and every facing.
 */

import type { Pt } from '../carlArt';
import type { Ramp } from './paint';
import type {
  BoneChain,
  FootPose,
  RatKinPose,
  RatKinView,
  Skeleton,
  TorsoSpan,
} from '../ratKinArt';

type Ctx = CanvasRenderingContext2D;

/** A three-stop fur ramp: shadow, body and highlight. */
export type FurRamp = Ramp;

/** The proportion presets a ratkin can be built on. */
export type RatkinBuild = 'slight' | 'standard' | 'stocky' | 'elder' | 'child';

/**
 * How a build departs from the standard rig. Every field is a multiplier (or,
 * for angles and crouch, an addition) that is exactly neutral on `standard`, so
 * a standard-built ratkin paints the unmodified rig.
 */
export interface RatkinBuildSpec {
  /** Whole-figure scale about the ground line, applied by the figure's cell placement. */
  readonly scale: number;
  /** Torso reach either side of the spine. */
  readonly bodyWidth: number;
  /** Limb thickness, root to tip. */
  readonly limbWidth: number;
  /**
   * Head size about its own centre. Head count is how size is read: a child
   * needs *more* head per body, not just less body.
   */
  readonly headScale: number;
  /** Extra forward lean, radians — the elder's stoop. */
  readonly stoop: number;
  /** Extra crouch, 0–1, carried on every frame — tired knees. */
  readonly crouch: number;
  readonly tailGirth: number;
  readonly tailLength: number;
}

const NEUTRAL_BUILD: RatkinBuildSpec = {
  scale: 1,
  bodyWidth: 1,
  limbWidth: 1,
  headScale: 1,
  stoop: 0,
  crouch: 0,
  tailGirth: 1,
  tailLength: 1,
};

/** Degrees to radians, kept local so this data module imports no values. */
const DEGREE = Math.PI / 180;

export const RATKIN_BUILDS: Readonly<Record<RatkinBuild, RatkinBuildSpec>> = {
  standard: NEUTRAL_BUILD,
  // Narrow through the body and limbs; the same height, so a slight ratkin
  // reads as wiry rather than as young.
  slight: { ...NEUTRAL_BUILD, bodyWidth: 0.86, limbWidth: 0.86, tailGirth: 0.9 },
  // Broad and a touch shorter: width is what says strength at 40 pixels tall,
  // and a stocky figure that is also taller reads as a different species.
  stocky: {
    ...NEUTRAL_BUILD,
    scale: 0.97,
    bodyWidth: 1.24,
    limbWidth: 1.2,
    headScale: 1.04,
    tailGirth: 1.15,
  },
  // The stoop is most of the read; the thin tail and soft knees finish it.
  elder: {
    ...NEUTRAL_BUILD,
    scale: 0.95,
    bodyWidth: 0.95,
    limbWidth: 0.9,
    stoop: 12 * DEGREE,
    crouch: 0.1,
    tailGirth: 0.62,
    tailLength: 0.9,
  },
  // Three quarters of the height with a bigger head on it, which is what makes
  // a small figure read as a child rather than as a small adult.
  child: {
    ...NEUTRAL_BUILD,
    scale: 0.74,
    bodyWidth: 0.96,
    limbWidth: 0.94,
    headScale: 1.2,
    tailGirth: 0.9,
    tailLength: 0.85,
  },
};

/** What a ratkin can hold. `none` is the same as omitting the prop. */
export type HeldPropKind =
  | 'none'
  | 'spear'
  | 'rough_spear'
  | 'ledger'
  | 'ladle'
  | 'smith_hammer'
  | 'claw_hammer'
  | 'hoe'
  | 'lantern'
  | 'bag'
  | 'bucket'
  | 'basket'
  | 'toy'
  | 'cane'
  | 'plane'
  | 'woodaxe'
  | 'pickaxe';

/** The outline a torso garment's silhouette follows, for the rim light that traces it. */
export interface HemShape {
  /** How far below the hip the hem hangs, in figure units. */
  readonly drop: number;
  /** How far the hem flares past the hip's own span. */
  readonly flare: number;
  /** How far above the shoulder line the collar stands. */
  readonly collarRise: number;
  /** How far the hem swings for a full `hemSway`. */
  readonly sway: number;
  /**
   * The flare behind him in profile, when it differs from `flare`. A hem that
   * reaches the ankles has to clear the hocks, which a digitigrade leg carries
   * well back behind the body.
   */
  readonly profileTrailFlare?: number;
}

/**
 * The head's own geometry, in head-local units: origin at the skull's centre,
 * +X forward in profile, +Y down. Head layers are painted in this space, after
 * the head, with the build's head scale already applied.
 */
export interface HeadGeometry {
  /** Half the skull's width as drawn in this view. */
  readonly skullHalfWidth: number;
  /** Half the skull's height. */
  readonly skullHalfHeight: number;
  /** Where an ear's centre sits, on the +X side in a head-on view. */
  readonly ear: Pt;
  /** The ear disc's radius as drawn in this view. */
  readonly earRadius: number;
  /** One eye's centre (the +X one head-on). */
  readonly eye: Pt;
  readonly eyeRadius: number;
  /** The nose tip, profile only; head-on it is the muzzle's bottom centre. */
  readonly nose: Pt;
}

/** Everything a garment slot painter may read. Never mutated by a layer. */
export interface GarmentFrame {
  readonly ctx: Ctx;
  readonly pose: RatKinPose;
  readonly skeleton: Skeleton;
  readonly view: RatKinView;
  /** The torso's reach at each height, with this frame's breath and the build applied. */
  readonly span: TorsoSpan;
  /**
   * +1 when the wearer's right side is drawn toward +X, −1 when it is drawn
   * toward −X. Head-on he faces the camera and his right is on the left of the
   * picture; from behind and in profile (facing +X, near side toward the
   * viewer) it is on the right. Anything asymmetric — a satchel, a sash, a
   * chain's clasp — is placed with this, so it stays on the same side of his
   * body when he turns round instead of swapping with the picture.
   */
  readonly rightSide: number;
  readonly build: RatkinBuildSpec;
  readonly head: HeadGeometry;
}

/** One leg, as its slot painter sees it. */
export interface LegFrame {
  readonly chain: BoneChain;
  readonly foot: FootPose;
  /** True for the leg on the near/+X side of the drawing. */
  readonly near: boolean;
  /** How far toward the outline colour the leg is shaded for depth, 0–1. */
  readonly shade: number;
  /** Width multiplier the build applies to the leg. */
  readonly widthScale: number;
}

/** One arm, as its slot painter sees it. */
export interface ArmFrame {
  readonly chain: BoneChain;
  readonly near: boolean;
  /** True for the arm on the wearer's right. */
  readonly right: boolean;
  readonly shade: number;
  readonly widthScale: number;
}

/**
 * One garment, as a set of slot painters. Every slot is optional; each is
 * called at a fixed depth in the figure's draw order, in the order the layers
 * appear in {@link RatkinOutfit.garments} (back to front).
 *
 * - `back`  — before any limb: a cloak's back panel, seen past the body.
 * - `leg`   — straight after each leg: trousers, knee pads, mud.
 * - `torso` — over the torso's fur: tunics, coats, aprons, belts, chains.
 * - `arm`   — after each arm and its paw: sleeves, gloves, wristbands.
 * - `head`  — over the head, in head-local space: hats, scarves, spectacles.
 * - `front` — over everything, including the arms: a yoke, a cloak's front.
 */
export interface GarmentLayer {
  readonly name: string;
  back?(frame: GarmentFrame): void;
  leg?(frame: GarmentFrame, leg: LegFrame): void;
  torso?(frame: GarmentFrame): void;
  arm?(frame: GarmentFrame, arm: ArmFrame): void;
  head?(frame: GarmentFrame): void;
  front?(frame: GarmentFrame): void;
  /**
   * The silhouette the figure's rim light follows. The last layer that
   * declares one wins; with none, the rim follows the bare torso.
   */
  readonly hem?: HemShape;
  /** Recolours the paws — gloves. The last layer that declares one wins. */
  readonly pawTint?: Ramp;
}

/**
 * One ratkin's whole look.
 *
 * `fur` covers the back, limbs, head and ears; `belly` is the countershaded
 * front: throat, chest, cheeks and underjaw. `skin` and `tailSkin` default to
 * the rodent pinks Mordecai is painted in.
 */
export interface RatkinOutfit {
  readonly fur: FurRamp;
  readonly belly: FurRamp;
  readonly skin?: Ramp;
  readonly tailSkin?: Ramp;
  /** The eye bead's colour; a near-black by default. */
  readonly eyeTint?: string;
  /** How long the incisors are drawn against the standard pair. */
  readonly incisorScale?: number;
  readonly build: RatkinBuild;
  /** Ordered back to front within each slot. */
  readonly garments: readonly GarmentLayer[];
  /** Drawn in the right paw. */
  readonly heldProp?: HeldPropKind;
  /**
   * Which of the wearer's hips the tail sweeps out past in the head-on and
   * from-behind views; `right` by default. A ratkin carrying something in his
   * right paw sweeps it left, so the tail and the prop do not hang side by
   * side and read as one shape.
   */
  readonly tailHip?: 'right' | 'left';
}
