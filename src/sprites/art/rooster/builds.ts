/**
 * The closed set of rooster builds, as data.
 *
 * Every rooster is painted by one painter from one rig. What makes Big Rooster,
 * Little Rooster and Slightly Bent Rooster three different birds is the record
 * below: how big each is drawn, how the parts are proportioned against the big
 * build's, his plumage, how he carries himself and what he wears. A build is a
 * closed set rather than a per-instance trait because a painted cell is shared
 * by every instance of its figure; each build is its own figure.
 *
 * Proportions are multipliers on the rig's own measurements, which are
 * authored at the big build's size. A build's overall size is applied at draw
 * time through `heightTiles`, never by shrinking the rig, so the choreography,
 * the gore and the hand anchors scale with the body instead of drifting off it.
 */

export type RoosterBuild = 'big' | 'little' | 'bent';

export const ROOSTER_BUILDS: readonly RoosterBuild[] = ['big', 'little', 'bent'];

/**
 * A five-step material ramp: the shadow core, the shaded side, the base, the
 * lit side and the rim. Going down the ramp the hue cools and the saturation
 * rises, so a shadow stays a colour rather than a muddy grey.
 */
export interface Ramp {
  readonly deep: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly rim: string;
}

interface RoosterPalette {
  /** Neck hackles and the saddle: the brightest plumage, gold over copper. */
  readonly hackle: Ramp;
  /** The breast: darker rust, so the chest reads as a mass under the cape. */
  readonly chest: Ramp;
  /** The back. */
  readonly back: Ramp;
  /**
   * The soft fluff of the belly and thighs, a step lighter than the breast: in
   * the breast's dark value, everything between the belt and the hocks reads
   * as one garment, a pair of shorts.
   */
  readonly fluff: Ramp;
  /** The close feathering that follows the arms' muscle. */
  readonly arm: Ramp;
  /** Glossy black sickles with a green sheen. */
  readonly tail: Ramp;
  /** Comb and wattles. */
  readonly comb: Ramp;
  readonly beak: Ramp;
  /** Bare scaly skin: the shanks, the toes and the hands. */
  readonly scales: Ramp;
  readonly talon: string;
  readonly iris: string;
  readonly pupil: string;
  /** The silhouette ring, a warm dark rather than black. */
  readonly outline: string;
  /** Bare skin showing through a bald patch. */
  readonly bareSkin: string;
}

interface RoosterProportions {
  /** Girth of both arm bones and the deltoid against the big build's. */
  readonly armGirth: number;
  /** Length of both arm bones against the big build's. */
  readonly armLength: number;
  /** Length of the neck against the big build's; a young bird's is short. */
  readonly neckLength: number;
  /** Comb height against the big build's. */
  readonly combHeight: number;
  /** Number of points along the comb's top edge. */
  readonly combPoints: number;
  /** Length of the sickle feathers against the big build's. */
  readonly tailLength: number;
  /** Number of long sickle feathers in the fountain. */
  readonly sickles: number;
  /** Head size against the big build's; a young bird's head is big for him. */
  readonly headSize: number;
  /** Breadth of the trunk against the big build's. */
  readonly bodyGirth: number;
}

interface RoosterCarriage {
  /** Permanent forward pitch of the trunk, radians. */
  readonly lean: number;
  /** How far the neck kinks the head over, radians of head roll. */
  readonly neckKink: number;
  /** How far the comb flops to one side, 0 standing to 1 lying flat. */
  readonly combFlop: number;
  /**
   * Permanent sideways lean of the whole body toward his own left, radians.
   * Head-on only; edge-on a lean across the picture has nowhere to show.
   */
  readonly bodyRoll: number;
  /** How far the hips ride up on the toes, in rig units. */
  readonly tiptoe: number;
  /** Scales the idle's bounce and the walk's bob. */
  readonly bounce: number;
  /** Waits with his fists up in his guard rather than his arms hanging. */
  readonly fistsUp: boolean;
}

interface RoosterKit {
  readonly liftingBelt: boolean;
  readonly wristTape: boolean;
  readonly neckSweatband: boolean;
}

interface RoosterPlumage {
  /** Number of sickles painted snapped short. */
  readonly snappedSickles: number;
  /** Whether bare skin shows through the feathers in patches. */
  readonly baldPatches: boolean;
}

export interface RoosterBuildSpec {
  /** Standing height to the top of the comb, in game tiles. */
  readonly heightTiles: number;
  readonly proportions: RoosterProportions;
  readonly palette: RoosterPalette;
  readonly carriage: RoosterCarriage;
  readonly kit: RoosterKit;
  readonly plumage: RoosterPlumage;
}

const BIG_PALETTE: RoosterPalette = {
  hackle: { deep: '#5a2006', dark: '#9a4414', mid: '#d47a28', light: '#f2a83e', rim: '#ffd888' },
  chest: { deep: '#240806', dark: '#4a120a', mid: '#74200f', light: '#9a3818', rim: '#c0603a' },
  back: { deep: '#2e0c06', dark: '#5e1a0c', mid: '#8c2c12', light: '#b84a22', rim: '#e07a40' },
  fluff: { deep: '#3a1006', dark: '#6e240e', mid: '#a4401a', light: '#cc6a2c', rim: '#ec9a52' },
  arm: { deep: '#4e1c06', dark: '#9a4214', mid: '#d26e28', light: '#f29a48', rim: '#ffc880' },
  tail: { deep: '#040807', dark: '#0e1c16', mid: '#1c3a2c', light: '#3a8a5a', rim: '#8ee0ac' },
  comb: { deep: '#46040a', dark: '#8a0c14', mid: '#d01e28', light: '#f4544a', rim: '#ffa290' },
  beak: { deep: '#5a3c08', dark: '#9a7418', mid: '#e8c040', light: '#ffe07a', rim: '#fff4c0' },
  scales: { deep: '#5a3c08', dark: '#9a7214', mid: '#d6ae30', light: '#f0d466', rim: '#fff0a8' },
  talon: '#24180e',
  iris: '#ff8c12',
  pupil: '#120604',
  outline: '#1c0a08',
  bareSkin: '#d89c8c',
};

/** A cockerel's plumage is paler and yellower than his father's. */
const LITTLE_PALETTE: RoosterPalette = {
  ...BIG_PALETTE,
  hackle: { deep: '#6a3a0a', dark: '#a86a1c', mid: '#dca236', light: '#f4c85a', rim: '#fff0b0' },
  /**
   * His breast and thighs are a warm orange-chestnut: a step darker than his
   * gold cape so the cape still reads, but nowhere near his father's dark rust.
   * In the cape's own gold he reads as a hen.
   */
  chest: { deep: '#4a1c06', dark: '#7a3410', mid: '#a8521c', light: '#c8722e', rim: '#e49a50' },
  back: { deep: '#5a2a0a', dark: '#8e4a16', mid: '#c0762a', light: '#de9a44', rim: '#f4c070' },
  fluff: { deep: '#4a1e08', dark: '#7a3812', mid: '#a4561e', light: '#c47632', rim: '#e09c56' },
  /** Gold, a step lighter than his orange breast, so the arms stand out of it as limbs of their own. */
  arm: { deep: '#5a3008', dark: '#9a5e18', mid: '#d4922e', light: '#eeb24a', rim: '#fcd486' },
  /**
   * A cockerel's few sickles are thin, and at his size the sheen is most of
   * each one: in his father's ramp they come out jade green rather than black.
   */
  tail: { deep: '#030605', dark: '#0a1410', mid: '#13261d', light: '#2c6646', rim: '#6cb88a' },
};

/** Dull brown-red, a bird whose best fights were a while ago. */
const BENT_PALETTE: RoosterPalette = {
  ...BIG_PALETTE,
  hackle: { deep: '#3e1c0c', dark: '#6e3a1c', mid: '#a0602e', light: '#c4844c', rim: '#deaa78' },
  chest: { deep: '#24100a', dark: '#46200e', mid: '#6c3418', light: '#8e4e2c', rim: '#b0704a' },
  back: { deep: '#30120a', dark: '#5c2614', mid: '#88401e', light: '#ac6236', rim: '#cc8a5a' },
  fluff: { deep: '#2c140a', dark: '#56280f', mid: '#80421e', light: '#a46036', rim: '#c48658' },
  /** A step lighter and redder than his dull trunk, so the arms stay limbs rather than part of it. */
  arm: { deep: '#401a0a', dark: '#763818', mid: '#a05428', light: '#c27442', rim: '#dc9c6c' },
  comb: { deep: '#46060a', dark: '#861216', mid: '#c42628', light: '#e8564c', rim: '#ff9a8a' },
  bareSkin: '#d4ac98',
};

export const ROOSTER_BUILD_SPECS: Readonly<Record<RoosterBuild, RoosterBuildSpec>> = {
  big: {
    heightTiles: 3,
    proportions: {
      armGirth: 1,
      armLength: 1,
      neckLength: 1,
      combHeight: 1,
      combPoints: 5,
      tailLength: 1.5,
      sickles: 6,
      headSize: 1.12,
      bodyGirth: 1,
    },
    palette: BIG_PALETTE,
    carriage: {
      lean: 0,
      neckKink: 0,
      combFlop: 0,
      bodyRoll: 0,
      tiptoe: 0,
      bounce: 1,
      fistsUp: false,
    },
    kit: { liftingBelt: true, wristTape: true, neckSweatband: false },
    plumage: { snappedSickles: 0, baldPatches: false },
  },
  little: {
    heightTiles: 1.6,
    proportions: {
      armGirth: 0.84,
      armLength: 0.68,
      neckLength: 0.8,
      combHeight: 0.72,
      combPoints: 4,
      tailLength: 0.5,
      sickles: 3,
      headSize: 1.5,
      bodyGirth: 0.9,
    },
    palette: LITTLE_PALETTE,
    carriage: {
      lean: 0.34,
      neckKink: 0,
      combFlop: 0,
      bodyRoll: 0,
      tiptoe: 0.16,
      bounce: 2,
      fistsUp: true,
    },
    kit: { liftingBelt: false, wristTape: true, neckSweatband: false },
    plumage: { snappedSickles: 0, baldPatches: false },
  },
  bent: {
    // To the top of an upright comb: his flops over and his neck kinks, so
    // the ink he actually stands is about 1.9 tiles.
    heightTiles: 2.02,
    proportions: {
      armGirth: 0.74,
      armLength: 0.85,
      neckLength: 1,
      combHeight: 1.15,
      combPoints: 5,
      tailLength: 0.85,
      sickles: 5,
      headSize: 1.3,
      bodyGirth: 0.96,
    },
    palette: BENT_PALETTE,
    carriage: {
      lean: 0.08,
      neckKink: 0.45,
      combFlop: 0.75,
      bodyRoll: 0.28,
      tiptoe: 0,
      bounce: 1,
      fistsUp: false,
    },
    kit: { liftingBelt: false, wristTape: true, neckSweatband: true },
    plumage: { snappedSickles: 3, baldPatches: true },
  },
};
