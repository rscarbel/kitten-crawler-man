/**
 * A human look: everything that makes one figure on the biped rig a particular
 * person rather than the rig itself — the colours of skin, hair, eyes and torso
 * garment, the cut of that garment, the hairstyle and facial hair, the face it
 * wears at rest, its build, and the clothes every outfit of it starts from.
 *
 * The rig's painters read a look from the compose options they are handed,
 * never from module state, so any number of looks can be baked side by side.
 */

import type { BipedExpression, FaceShape, HeadFeaturePainter } from '../art/biped/head';
import type { GlossRamp, Ramp } from '../art/biped/palette';
import type { LimbBuild } from '../art/biped/limbs';
import type { SleeveCut } from '../art/biped/sleeve';
import type { GarmentCut } from '../art/biped/torso';
import type { OutfitBase } from '../garments/outfit';
import { PLAYER_HUMAN_SIZE_OVER_RIG } from '../art/human/figureScale';

/**
 * What the status box needs of a look, measured off its painted standing
 * cells at the in-game tile; gate G21 in `scripts/gates-human.ts`
 * re-measures both for every look it gates.
 */
export interface HumanFigureExtent {
  /**
   * How far the top of the figure's hair sits above the tile anchor, in pixels at the
   * in-game tile, rounded up to a whole pixel so the health bar hung off it
   * clears the hair.
   */
  readonly spriteTopAboveTilePx: number;
  /**
   * Half the figure's width head-on, arms included, in tile fractions. Every
   * look is narrower than the tile: flames or drips spread across the full
   * tile would visibly miss the figure.
   */
  readonly halfWidthTiles: number;
}

export interface HumanLook extends OutfitBase<'human'> {
  /** Names the look in its figures' ids, which the frame cache keys every cell on. */
  readonly id: string;
  readonly skin: Ramp;
  /**
   * The skin of the hands where it differs from the rest of him — knuckles
   * a little redder than the face — or null for hands of the look's own skin.
   */
  readonly handSkin: Ramp | null;
  readonly hair: Ramp;
  readonly iris: string;
  /** What the garment over the torso, and its sleeves, are made of. */
  readonly garment: GlossRamp;
  readonly garmentCut: GarmentCut;
  readonly sleeveCut: SleeveCut;
  readonly hairstyle: HeadFeaturePainter;
  /** Null for a clean-shaven face. */
  readonly facialHair: HeadFeaturePainter | null;
  /** The brows, anger and lips the face wears in every pose. */
  readonly expression: BipedExpression;
  /** The shape of the face: its jaw, chin, profile, nose, eyes and lips. */
  readonly face: FaceShape;
  /**
   * How much taller and wider than the rig the look stands, about its own
   * ground line. Applied where a cell maps figure units to pixels, so the
   * rig's proportions, shared by every look, are never edited for one.
   * `widthScale` is across the body; see {@link playerLookAxes} for what the
   * player's figure does with it edge-on.
   */
  readonly heightScale: number;
  readonly widthScale: number;
  /** How slim or heavy the limbs are about the rig's bones. */
  readonly limbs: LimbBuild;
  /**
   * The head's size against the rig's, about a point between eyes and chin, so it stays on the
   * neck. The rig's head is a game figure's, oversized to read at the tile;
   * a look drawn to a real person's proportions draws it smaller.
   */
  readonly headScale: number;
  /**
   * How much broader the head is drawn than its scale alone makes it: the
   * rig's head is a narrow oval, and a smaller head keeps a real face's width.
   */
  readonly headBreadth: number;
  /**
   * Where a head drawn smaller or larger than the rig's is scaled about, as a
   * share of the way from its eyes down to its chin. Near the chin the neck
   * keeps the rig's length under the smaller head; near the eyes the chin
   * rises off it and the neck grows by what the head lost.
   */
  readonly headPivot: number;
  /** How thick the neck stands across its column against the rig's heavy-framed one. */
  readonly neckGirth: number;
  /**
   * How softly the neck's light turns into its shade, against the rig's
   * banded, muscled column ({@link RIG_NECK_SOFTNESS}); its creases fade by
   * the same share.
   */
  readonly neckSoftness: number;
  /**
   * Head-on, how far the shoulders spread past the profile's width: the
   * rig's heavy V is `FACING_SHOULDER_SPREAD`; a lean man's shoulders stand
   * only a little past his chest.
   */
  readonly shoulderSpread: number;
  /** How far apart the thighs root against the rig's heavy-hipped stance. */
  readonly hipSpread: number;
  /** How much fuller than a pair of trousers' own cut their seat stands on this body. */
  readonly seatFullness: SeatFullness;
  /** Where the status box, health bar and marker hang off the look's painted figure. */
  readonly figureExtent: HumanFigureExtent;
}

/**
 * How much fuller a body's seat stands than the one trousers are cut for:
 * head-on across the hips, and edge-on behind them. A woman's hips are wider
 * and her seat rounder than the slim man's trousers are cut to.
 */
export interface SeatFullness {
  readonly across: number;
  readonly depth: number;
}

/** The seat a pair of trousers is cut for, unchanged. */
export const TROUSERS_OWN_SEAT: SeatFullness = { across: 1, depth: 1 };

/**
 * Everything a look carries but who it is — its id, colouring, hair and
 * expression: the build, the face's shape and the clothes. Looks that share a body share one of
 * these and differ only in the rest.
 */
export type HumanBuild = Omit<
  HumanLook,
  'id' | 'skin' | 'handSkin' | 'hair' | 'iris' | 'hairstyle' | 'facialHair' | 'expression'
>;

/** A pose with `look`'s own build laid on: what the painter, the probe and the sockets all solve. */
export function withLookBuild<P extends { shoulderSpread?: number; hipSpread?: number }>(
  pose: P,
  look: Pick<HumanLook, 'shoulderSpread' | 'hipSpread'>,
): P {
  return { ...pose, shoulderSpread: look.shoulderSpread, hipSpread: look.hipSpread };
}

/** The rig's own head. */
export const RIG_HEAD_SCALE = 1;

/** The rig's own hips. */
export const RIG_HIP_SPREAD = 1;

/** The rig's own head breadth. */
export const RIG_HEAD_BREADTH = 1;

/** The rig's own neck. */
export const RIG_NECK_GIRTH = 1;

/** The rig's own neck shading. */
export const RIG_NECK_SOFTNESS = 1;

/** The rig is drawn at 6'3", crown to sole. */
export const RIG_STATURE_METRES = 1.905;

/** A look's stature is written in inches and compared with the rig's in metres. */
export const METRES_PER_INCH = 0.0254;

/** The ramp a look's hands are painted in. */
export function handSkinOf(look: Pick<HumanLook, 'skin' | 'handSkin'>): Ramp {
  return look.handSkin ?? look.skin;
}

/** How much a look stretches the rig along each camera axis in one view: x right, y down, z toward the camera. */
export interface LookAxes {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The rig's own depth, front to back, which the player's figure keeps
 * whatever its look's build.
 */
const RIG_DEPTH_SCALE = 1;

/**
 * How the player's figure stretches the rig in a view. Head-on and from
 * behind the look's width runs across the picture and its depth into it;
 * edge-on its depth runs across the picture and its width into it. The depth
 * stays the rig's because the rows carry his stride across the profile in
 * world pixels at the player's speed: a travelling blow is played off the
 * swing's own timer, not off the ground covered, so a profile drawn shallower
 * than the rig would skate every planted foot by the difference.
 *
 * Every axis carries {@link PLAYER_HUMAN_SIZE_OVER_RIG} on top, the same for
 * every look, because the strides those rows carry are paced for the
 * player's figure at that size (`human/locomotion.ts`).
 */
export function playerLookAxes(
  look: Pick<HumanLook, 'widthScale' | 'heightScale'>,
  profile: boolean,
): LookAxes {
  const size = PLAYER_HUMAN_SIZE_OVER_RIG;
  return profile
    ? { x: RIG_DEPTH_SCALE * size, y: look.heightScale * size, z: look.widthScale * size }
    : { x: look.widthScale * size, y: look.heightScale * size, z: RIG_DEPTH_SCALE * size };
}

/**
 * How much taller than the rig at the town's scale the player's figure in
 * `look` stands: what an item he holds is sized by, so a slighter build
 * swings the same sword at the same length against his height.
 */
export function playerStatureScale(look: Pick<HumanLook, 'heightScale'>): number {
  return look.heightScale * PLAYER_HUMAN_SIZE_OVER_RIG;
}

/** A look's figure units as pixels across and down, at `pxPerUnit` for the rig itself. */
export function lookPxPerUnit(
  look: Pick<HumanLook, 'widthScale' | 'heightScale'>,
  pxPerUnit: number,
): { readonly x: number; readonly y: number } {
  return { x: pxPerUnit * look.widthScale, y: pxPerUnit * look.heightScale };
}
