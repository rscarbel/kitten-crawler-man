/**
 * Drawing engine for the Level 3 forest.
 *
 * Three species — oak, birch and pine — with four seeded variants each, all
 * painted by one canopy engine from one master palette so a forest reads as a
 * single wood rather than twelve unrelated assets. Variation comes only from
 * seeded parameters: trunk lean, crown radius, clump count, fork angles and
 * foliage-value jitter.
 *
 * A tree is drawn in two stages. `buildTreeSkeleton` derives every position,
 * radius, lobe and bark mark from the seed *once*; the painters then render that
 * same skeleton in whatever dress the state calls for. That split is the whole
 * reason a charred oak still reads as the oak it was — its silhouette is not
 * redrawn from a generic husk routine, it is the identical skeleton with a
 * blackened ramp and its leaves stripped.
 *
 * Everything is expressed in multiples of `tileScale`, so the sheets can be
 * baked at any resolution without hand-tuned pixel constants drifting apart.
 * The caller supplies the anchor tile's top-left corner; the tree stands on the
 * bottom of that tile and climbs out of the top of it.
 *
 * Light comes from the upper left, matching every other prop in the repo.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import { mulberry32, range, rangeInt, subSeed, type Rng } from '../src/sprites/person/rng.js';

export type TreeSpecies = 'oak' | 'birch' | 'pine';

/** Sheet rows. Mirrors the `states` block every tree manifest entry declares. */
export type TreeState =
  'idle' | 'damaged' | 'burning' | 'burning_late' | 'charred' | 'felling' | 'felling_charred';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// ── Master palette ────────────────────────────────────────────────────────────
// Every ramp runs shadow → dark → mid → light → rim, lit from the upper left.
// The three foliage ramps sit inside one narrow hue band (85°–120°) and one
// value range, which is what stops a mixed grove reading as three art styles.
// Nothing is drawn in pure black: the darkest entry of a ramp is its outline,
// and a true black outline reads as a UI icon rather than as a thing in a world.

/** A five-value shading ramp, darkest first. */
interface Ramp {
  readonly shadow: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly rim: string;
}

const OAK_FOLIAGE: Ramp = {
  shadow: '#1d3316',
  dark: '#2c4a1f',
  mid: '#3e6529',
  light: '#548438',
  rim: '#77a44b',
};
const BIRCH_FOLIAGE: Ramp = {
  shadow: '#243a1a',
  dark: '#365326',
  mid: '#4d7033',
  light: '#6a9243',
  rim: '#93b95c',
};
const PINE_FOLIAGE: Ramp = {
  shadow: '#152c1b',
  dark: '#1f3f26',
  mid: '#2b5631',
  light: '#3a6f3d',
  rim: '#548a4e',
};

const OAK_BARK: Ramp = {
  shadow: '#2a1c12',
  dark: '#3d2a1a',
  mid: '#523827',
  light: '#6a4c34',
  rim: '#8a6748',
};
const BIRCH_BARK: Ramp = {
  shadow: '#4a4238',
  dark: '#6e6455',
  mid: '#948a78',
  light: '#bcb3a1',
  rim: '#ded7c6',
};
const PINE_BARK: Ramp = {
  shadow: '#2b1d17',
  dark: '#3f2a20',
  mid: '#57392b',
  light: '#6f4c39',
  rim: '#8a6349',
};

/** Burnt wood, shared by all three species — charcoal is charcoal. */
const CHAR: Ramp = {
  shadow: '#100c0b',
  dark: '#1b1614',
  mid: '#2a2320',
  light: '#3a312c',
  rim: '#4d423a',
};

/** Leaves the fire has taken but not yet dropped. */
const SCORCHED_FOLIAGE: Ramp = {
  shadow: '#25180f',
  dark: '#3a2415',
  mid: '#5a3618',
  light: '#8a4e1c',
  rim: '#b06d24',
};

const FLAME_CORE = '#fff3cf';
const FLAME_HOT = '#ffd24a';
const FLAME_MID = '#ff8a1e';
const FLAME_OUTER = '#e2450f';
const EMBER_RGB = [255, 148, 52] as const;
const ASH_RGB = [168, 160, 152] as const;
const DUST_RGB = [150, 136, 108] as const;

const CONTACT_SHADOW_ALPHA = 0.34;
const CONTACT_SHADOW_WIDTH_TILES = 0.82;
const CONTACT_SHADOW_HEIGHT_TILES = 0.16;
/** The shadow's declared width is a diameter; the gradient wants a radius. */
const CONTACT_SHADOW_RADIUS_FROM_WIDTH = 0.5;
/** Holds the shadow dark through its middle before it falls away at the rim. */
const CONTACT_SHADOW_MID_STOP = 0.55;
const CONTACT_SHADOW_MID_ALPHA_FRACTION = 0.55;
/** Wet charcoal, for the scar a burnt tree leaves on the ground. */
const SCORCH_RGB = [26, 20, 16] as const;
/** How far the burn scar spreads around the trunk. */
const SCORCH_RADIUS_TILES = 0.9;
/** The shadow tightens as a falling tree leaves the ground. */
const FELLING_SHADOW_SHRINK = 0.4;

function foliageRampFor(species: TreeSpecies): Ramp {
  if (species === 'oak') return OAK_FOLIAGE;
  if (species === 'birch') return BIRCH_FOLIAGE;
  return PINE_FOLIAGE;
}

function barkRampFor(species: TreeSpecies): Ramp {
  if (species === 'oak') return OAK_BARK;
  if (species === 'birch') return BIRCH_BARK;
  return PINE_BARK;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

/** One overlapping circle inside a foliage clump, in tile units from its centre. */
interface Lobe {
  readonly dx: number;
  readonly dy: number;
  readonly r: number;
}

/**
 * A leaf-mass blob. `depth` says which side of the trunk it hangs on: anything
 * at or above `CLUMP_DEPTH_FRONT_THRESHOLD` is painted after the trunk, the
 * rest before it. It is a contract between `buildTreeSkeleton` and `drawTree`,
 * which is why the threshold and the two values producers use are named.
 */
interface Clump {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly depth: number;
  /** −1..1 value jitter applied to the ramp, so no two clumps match exactly. */
  readonly tint: number;
  readonly lobes: readonly Lobe[];
  readonly speckles: readonly Lobe[];
  /** Copied from the species' `ClumpShape` so the painter needs no species. */
  readonly pointy: boolean;
  /**
   * Shedding order, lowest rank kept longest — `survivingClumps` keeps every
   * clump whose rank is below the surviving count, so rank 0 is the last to go.
   * `damaged` and `burning_late` therefore strip a crown from the outside in,
   * and the same clumps survive in both.
   */
  readonly shedRank: number;
}

/** One station along the tapered trunk, bottom-first. */
interface TrunkNode {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
}

interface Limb {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly w0: number;
  readonly w1: number;
  /** Snapped limbs are drawn as splintered stubs from `damaged` onward. */
  readonly snapsWhenDamaged: boolean;
}

/** A fissure, lenticel dash or knot on the bark. */
interface BarkMark {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
  readonly tilt: number;
}

interface TreeSkeleton {
  readonly species: TreeSpecies;
  readonly centerX: number;
  readonly groundY: number;
  readonly crownTopY: number;
  readonly trunk: readonly TrunkNode[];
  readonly limbs: readonly Limb[];
  readonly clumps: readonly Clump[];
  readonly barkMarks: readonly BarkMark[];
  readonly rootFlareTiles: number;
  /**
   * How far the widest part of the tree reaches either side of its trunk, in
   * pixels. The felling transform needs it: rotating about the foot pushes the
   * outermost point down by `sin(lean)` times this, and that is exactly the
   * amount the whole tree has to be lifted to stay inside the frame.
   */
  readonly halfWidthPx: number;
}

/** The widest reach of a finished canopy, measured from the trunk's foot. */
function canopyHalfWidthPx(clumps: readonly Clump[], centerX: number, rootFlarePx: number): number {
  let widest = rootFlarePx;
  for (const clump of clumps) {
    for (const lobe of clump.lobes) {
      // Measured to each lobe's own tip. Measuring from the clump centre alone
      // ignores how far its lobes are thrown outward, which understated a
      // conifer's real half-width — and this is the one function that claims to
      // know how wide the tree is.
      widest = Math.max(widest, Math.abs(clump.x + lobe.dx - centerX) + lobe.r * NEEDLE_TIP_REACH);
    }
  }
  return widest;
}

// Geometry, all in tile units. The frame gives a tree 3 tiles of headroom above
// its anchor tile and 1 tile of clearance each side (see §5.2 of the plan), so
// the drawable envelope is 3.84 tiles up from the trunk's foot and 1.5 tiles
// sideways.
//
// Treat the two constants below as the budget the species parameters are picked
// against, not as an enforced bound: `MAX_CROWN_HALF_WIDTH_TILES` caps the
// crown radius a variant may ask for but not the reach of the lobes hung off
// it, and `MAX_CROWN_HEIGHT_TILES` only clamps the *reported* `crownTopY` that
// flames and embers anchor to. What actually enforces the envelope is
// `assertNothingClipped` in the generator, which refuses to write a sheet whose
// art touches a frame edge.
const TRUNK_FOOT_TILE_FRACTION = 0.84;
const MAX_CROWN_HALF_WIDTH_TILES = 1.18;
const MAX_CROWN_HEIGHT_TILES = 3.8;

/**
 * The trunk's taper, which every species inherits. It is not linear: the bole
 * narrows steadily with height, then swells sharply again over the last
 * handspan above the ground. That swell is what tells the eye the tree grew
 * where it stands rather than being planted there.
 */
const TRUNK_TAPER_PER_HEIGHT = 0.62;
const ROOT_FLARE_HEIGHT_FRACTION = 0.34;
const ROOT_FLARE_SWELL = 0.9;

/** Depth at or above which a clump is painted in front of the trunk. */
const CLUMP_DEPTH_FRONT_THRESHOLD = 0.5;
/** A broadleaf clump hanging below the crown's centre, in front of the trunk. */
const CLUMP_DEPTH_FRONT = 0.9;
/** One above the centre, behind it. */
const CLUMP_DEPTH_BEHIND = 0.15;
/** A conifer's boughs all hang in front of the bole — see `buildConiferSkeleton`. */
const CLUMP_DEPTH_CONIFER = 1;

const TRUNK_NODE_COUNT = 7;
/**
 * Where the trunk is cut, measured up from the top surviving leaf mass's
 * *centre* as a fraction of that mass's radius. Below 1 the bole stops inside
 * the canopy, which is what hides the join; at 0.55 it ends a little under
 * halfway up the mass.
 */
const TRUNK_CUT_ABOVE_CANOPY = 0.55;

const OAK_TRUNK_HEIGHT_MIN = 1.25;
const OAK_TRUNK_HEIGHT_MAX = 1.55;
const OAK_TRUNK_HALF_WIDTH_MIN = 0.15;
const OAK_TRUNK_HALF_WIDTH_MAX = 0.19;
const OAK_CROWN_CENTER_MIN = 1.95;
const OAK_CROWN_CENTER_MAX = 2.25;
const OAK_CROWN_RADIUS_MIN = 0.98;
const OAK_CROWN_RADIUS_MAX = 1.18;
/**
 * Ring and clump sizes as fractions of the crown's declared half-width. Chosen
 * so the widest reach a clump can have — ring offset plus lobe spread plus lobe
 * radius — still lands inside `MAX_CROWN_HALF_WIDTH_TILES`. A crown that
 * overruns the frame is clipped in the bake, permanently.
 */
const CROWN_CORE_FRACTION = 0.72;
const CROWN_CORE_FRACTION_SLENDER = 0.62;
const CROWN_RING_FRACTION_MIN = 0.34;
const CROWN_RING_FRACTION_MAX = 0.52;
const CROWN_LOBE_FRACTION_MIN = 0.34;
const CROWN_LOBE_FRACTION_MAX = 0.46;

const OAK_CLUMP_MIN = 7;
const OAK_CLUMP_MAX = 9;
const OAK_LIMB_COUNT = 4;

const BIRCH_TRUNK_HEIGHT_MIN = 1.95;
const BIRCH_TRUNK_HEIGHT_MAX = 2.35;
const BIRCH_TRUNK_HALF_WIDTH_MIN = 0.085;
const BIRCH_TRUNK_HALF_WIDTH_MAX = 0.115;
const BIRCH_CROWN_CENTER_MIN = 2.3;
const BIRCH_CROWN_CENTER_MAX = 2.6;
const BIRCH_CROWN_RADIUS_MIN = 0.72;
const BIRCH_CROWN_RADIUS_MAX = 0.9;
const BIRCH_CLUMP_MIN = 5;
const BIRCH_CLUMP_MAX = 7;
const BIRCH_LIMB_COUNT = 5;

const PINE_TRUNK_HALF_WIDTH_MIN = 0.11;
const PINE_TRUNK_HALF_WIDTH_MAX = 0.145;
const PINE_TIER_MIN = 7;
const PINE_TIER_MAX = 9;
const PINE_LOWEST_TIER_TILES = 0.6;
const PINE_APEX_MIN = 3.15;
const PINE_APEX_MAX = 3.5;
const PINE_TIER_HALF_WIDTH_BASE = 0.95;
const PINE_TIER_HALF_WIDTH_APEX = 0.22;
/** Exponent on the bough taper. Above 1 the lower boughs stay broad and the
 *  cone pinches only near the apex, which is what a linear taper gets wrong. */
const PINE_TAPER_EXPONENT = 1.35;
/**
 * How a species' leaf masses are shaped.
 *
 * `flatten` squashes a clump's lobes vertically and `droop` slides them
 * downward: a broadleaf crown is very nearly a sphere, a conifer's bough is a
 * wide skirt that hangs below the branch carrying it.
 */
interface ClumpShape {
  readonly flatten: number;
  readonly droop: number;
  /**
   * Whether a lobe is painted as a drooping wedge instead of a round mass.
   * Needles hang off a bough in flat sprays with pointed tips; painted as
   * circles the same tiers stack into a wedding cake rather than a fir.
   */
  readonly pointy: boolean;
}
const BROADLEAF_CLUMP_SHAPE: ClumpShape = { flatten: 0.86, droop: 0, pointy: false };
const CONIFER_CLUMP_SHAPE: ClumpShape = { flatten: 0.34, droop: 0.16, pointy: true };

const TRUNK_LEAN_TILES_MAX = 0.13;
const CLUMP_LOBE_MIN = 4;
const CLUMP_LOBE_MAX = 6;
const CLUMP_LOBE_RADIUS_MIN = 0.46;
const CLUMP_LOBE_RADIUS_MAX = 0.78;
const CLUMP_SPECKLE_MIN = 3;
const CLUMP_SPECKLE_MAX = 6;
const CLUMP_SPECKLE_RADIUS_MIN = 0.09;
const CLUMP_SPECKLE_RADIUS_MAX = 0.15;
/** How far out along its host lobe's radius a speckle sits. */
const SPECKLE_LOBE_REACH_MIN = 0.55;
const SPECKLE_LOBE_REACH_MAX = 0.85;
/** For wedge lobes, how far along the wedge's axis a speckle sits instead. */
const SPECKLE_WEDGE_ALONG_MIN = 0.45;
const SPECKLE_WEDGE_ALONG_MAX = 1.0;
const CLUMP_TINT_RANGE = 0.4;

/** Bark scars a damaged trunk shows, reusing the first few bark-mark sites. */
const GOUGE_COUNT = 3;
const GOUGE_LIGHTEN = 0.3;
const GOUGE_HALF_WIDTH_TILES = 0.06;
const GOUGE_HALF_HEIGHT_TILES = 0.11;

const BARK_MARK_MIN = 6;
const BARK_MARK_MAX = 11;

/** Sub-seed salts, so each feature draws from its own stable stream. */
const SEED_SALT_TRUNK = 1;
const SEED_SALT_LIMBS = 2;
const SEED_SALT_CROWN = 3;
const SEED_SALT_BARK = 4;
/**
 * The fire and debris salts have `frame` added to them, so they need room
 * between them: at 5 and 6 the two streams interleaved (fire frame 1 drew the
 * same numbers as debris frame 0) and the per-feature independence this whole
 * block exists for did not hold. Nothing renders wrong today only because no
 * state uses both streams at once.
 */
const SEED_SALT_STRIDE = 0x100;
const SEED_SALT_FIRE = SEED_SALT_STRIDE;
const SEED_SALT_DEBRIS = SEED_SALT_STRIDE * 2;

function buildClump(
  rng: Rng,
  x: number,
  y: number,
  r: number,
  depth: number,
  index: number,
  shape: ClumpShape,
): Clump {
  const lobes: Lobe[] = [];
  const lobeCount = rangeInt(rng, CLUMP_LOBE_MIN, CLUMP_LOBE_MAX);
  for (let i = 0; i < lobeCount; i++) {
    const angle = (i / lobeCount) * TWO_PI + range(rng, -0.4, 0.4);
    const spread = range(rng, 0.18, 0.46) * r;
    lobes.push({
      dx: Math.cos(angle) * spread,
      dy: Math.sin(angle) * spread * shape.flatten + shape.droop * r + range(rng, -0.06, 0.06) * r,
      r: r * range(rng, CLUMP_LOBE_RADIUS_MIN, CLUMP_LOBE_RADIUS_MAX),
    });
  }

  // Anchored on a lobe's own rim rather than scattered from the clump centre.
  // Placed by clump radius alone they land in the gaps between lobes and read as
  // peas floating beside the tree; on a lobe's edge they do the job they are for,
  // which is breaking the silhouette so a clump reads as leaves.
  const speckles: Lobe[] = [];
  const speckleCount = rangeInt(rng, CLUMP_SPECKLE_MIN, CLUMP_SPECKLE_MAX);
  for (let i = 0; i < speckleCount; i++) {
    const host = lobes[Math.min(lobes.length - 1, Math.floor(rng() * lobes.length))];
    if (shape.pointy) {
      // A pointy lobe's mass is a narrow wedge running from the clump centre
      // out to its tip, so a speckle placed on the rim of the circle the lobe
      // *would* have been lands in open air beside the tree. Ride the axis.
      const along = range(rng, SPECKLE_WEDGE_ALONG_MIN, SPECKLE_WEDGE_ALONG_MAX);
      speckles.push({
        dx: host.dx * along,
        dy: host.dy * along,
        r: r * range(rng, CLUMP_SPECKLE_RADIUS_MIN, CLUMP_SPECKLE_RADIUS_MAX) * 0.7,
      });
      continue;
    }
    const angle = range(rng, 0, TWO_PI);
    const reach = host.r * range(rng, SPECKLE_LOBE_REACH_MIN, SPECKLE_LOBE_REACH_MAX);
    speckles.push({
      dx: host.dx + Math.cos(angle) * reach,
      dy: host.dy + Math.sin(angle) * reach,
      r: r * range(rng, CLUMP_SPECKLE_RADIUS_MIN, CLUMP_SPECKLE_RADIUS_MAX),
    });
  }

  return {
    x,
    y,
    r,
    depth,
    tint: range(rng, -CLUMP_TINT_RANGE, CLUMP_TINT_RANGE),
    lobes,
    speckles,
    pointy: shape.pointy,
    shedRank: index,
  };
}

function buildTrunk(
  rng: Rng,
  centerX: number,
  groundY: number,
  heightTiles: number,
  halfWidthTiles: number,
  ts: number,
): TrunkNode[] {
  const lean = range(rng, -TRUNK_LEAN_TILES_MAX, TRUNK_LEAN_TILES_MAX);
  const nodes: TrunkNode[] = [];
  for (let i = 0; i < TRUNK_NODE_COUNT; i++) {
    const t = i / (TRUNK_NODE_COUNT - 1);
    // Squared lean so the base stays planted and the sway accumulates upward —
    // a trunk leaning uniformly reads as a tree that has been pushed over.
    const sway = lean * t * t + range(rng, -0.018, 0.018) * t;
    // Root flare: the taper is not linear, it swells sharply in the last handspan
    // above the ground, which is what tells the eye the tree grew there.
    const taper =
      1 -
      t * TRUNK_TAPER_PER_HEIGHT +
      Math.max(0, ROOT_FLARE_HEIGHT_FRACTION - t) * ROOT_FLARE_SWELL;
    nodes.push({
      x: centerX + sway * ts,
      y: groundY - t * heightTiles * ts,
      halfWidth: halfWidthTiles * taper * ts,
    });
  }
  return nodes;
}

function buildBarkMarks(
  rng: Rng,
  species: TreeSpecies,
  trunk: readonly TrunkNode[],
  ts: number,
): BarkMark[] {
  const marks: BarkMark[] = [];
  const count = rangeInt(rng, BARK_MARK_MIN, BARK_MARK_MAX);
  const bottom = trunk[0].y;
  const top = trunk[trunk.length - 1].y;
  for (let i = 0; i < count; i++) {
    const t = range(rng, 0.04, 0.94);
    const y = bottom + (top - bottom) * t;
    const node = trunkNodeAt(trunk, y);
    // A birch's marks are the horizontal lenticel dashes that make it a birch;
    // oak and pine carry vertical fissures instead.
    const horizontal = species === 'birch';
    marks.push({
      x: node.x + range(rng, -0.62, 0.62) * node.halfWidth,
      y,
      length: horizontal
        ? node.halfWidth * range(rng, 0.5, 1.3)
        : ts * range(rng, 0.14, 0.34) * (species === 'pine' ? 0.8 : 1),
      width: horizontal ? ts * range(rng, 0.028, 0.055) : ts * range(rng, 0.02, 0.038),
      tilt: horizontal ? HALF_PI + range(rng, -0.12, 0.12) : range(rng, -0.14, 0.14),
    });
  }
  return marks;
}

/** Linear-interpolates the trunk's centre and width at an arbitrary height. */
function trunkNodeAt(trunk: readonly TrunkNode[], y: number): TrunkNode {
  const bottom = trunk[0];
  const top = trunk[trunk.length - 1];
  if (y >= bottom.y) return bottom;
  if (y <= top.y) return top;
  for (let i = 0; i < trunk.length - 1; i++) {
    const a = trunk[i];
    const b = trunk[i + 1];
    if (y <= a.y && y >= b.y) {
      const span = a.y - b.y;
      const t = span === 0 ? 0 : (a.y - y) / span;
      return {
        x: a.x + (b.x - a.x) * t,
        y,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
      };
    }
  }
  return top;
}

function buildBroadleafSkeleton(
  species: 'oak' | 'birch',
  seed: number,
  centerX: number,
  groundY: number,
  ts: number,
): TreeSkeleton {
  const isOak = species === 'oak';
  const trunkRng = mulberry32(subSeed(seed, SEED_SALT_TRUNK));
  const heightTiles = isOak
    ? range(trunkRng, OAK_TRUNK_HEIGHT_MIN, OAK_TRUNK_HEIGHT_MAX)
    : range(trunkRng, BIRCH_TRUNK_HEIGHT_MIN, BIRCH_TRUNK_HEIGHT_MAX);
  const halfWidthTiles = isOak
    ? range(trunkRng, OAK_TRUNK_HALF_WIDTH_MIN, OAK_TRUNK_HALF_WIDTH_MAX)
    : range(trunkRng, BIRCH_TRUNK_HALF_WIDTH_MIN, BIRCH_TRUNK_HALF_WIDTH_MAX);
  const trunk = buildTrunk(trunkRng, centerX, groundY, heightTiles, halfWidthTiles, ts);

  const crownRng = mulberry32(subSeed(seed, SEED_SALT_CROWN));
  const crownCenterTiles = isOak
    ? range(crownRng, OAK_CROWN_CENTER_MIN, OAK_CROWN_CENTER_MAX)
    : range(crownRng, BIRCH_CROWN_CENTER_MIN, BIRCH_CROWN_CENTER_MAX);
  const crownRadiusTiles = Math.min(
    MAX_CROWN_HALF_WIDTH_TILES,
    isOak
      ? range(crownRng, OAK_CROWN_RADIUS_MIN, OAK_CROWN_RADIUS_MAX)
      : range(crownRng, BIRCH_CROWN_RADIUS_MIN, BIRCH_CROWN_RADIUS_MAX),
  );
  const crownCenterY = groundY - crownCenterTiles * ts;
  const crownTop = trunk[trunk.length - 1];

  const clumpCount = isOak
    ? rangeInt(crownRng, OAK_CLUMP_MIN, OAK_CLUMP_MAX)
    : rangeInt(crownRng, BIRCH_CLUMP_MIN, BIRCH_CLUMP_MAX);
  const clumps: Clump[] = [];
  // One central mass plus a ring, rather than a scatter: a scattered crown has
  // no core and reads as a cloud of separate bushes at tile size.
  const coreRadius =
    crownRadiusTiles * (isOak ? CROWN_CORE_FRACTION : CROWN_CORE_FRACTION_SLENDER) * ts;
  clumps.push(
    buildClump(
      crownRng,
      crownTop.x,
      crownCenterY,
      coreRadius,
      CLUMP_DEPTH_FRONT_THRESHOLD,
      0,
      BROADLEAF_CLUMP_SHAPE,
    ),
  );
  for (let i = 1; i < clumpCount; i++) {
    const angle = ((i - 1) / (clumpCount - 1)) * TWO_PI + range(crownRng, -0.32, 0.32);
    const ringRadius =
      crownRadiusTiles * range(crownRng, CROWN_RING_FRACTION_MIN, CROWN_RING_FRACTION_MAX) * ts;
    const x = crownTop.x + Math.cos(angle) * ringRadius;
    const y = crownCenterY + Math.sin(angle) * ringRadius * 0.78;
    const r =
      crownRadiusTiles * range(crownRng, CROWN_LOBE_FRACTION_MIN, CROWN_LOBE_FRACTION_MAX) * ts;
    // Clumps below the crown centre are in front of the trunk; above it, behind.
    const depth = y > crownCenterY ? CLUMP_DEPTH_FRONT : CLUMP_DEPTH_BEHIND;
    clumps.push(buildClump(crownRng, x, y, r, depth, i, BROADLEAF_CLUMP_SHAPE));
  }

  const limbRng = mulberry32(subSeed(seed, SEED_SALT_LIMBS));
  const limbs: Limb[] = [];
  const limbCount = isOak ? OAK_LIMB_COUNT : BIRCH_LIMB_COUNT;
  for (let i = 0; i < limbCount; i++) {
    const startT = range(limbRng, isOak ? 0.55 : 0.68, 0.97);
    const start = trunkNodeAt(trunk, groundY - startT * heightTiles * ts);
    const outward = i % 2 === 0 ? 1 : -1;
    const angle = range(limbRng, isOak ? 0.5 : 0.85, isOak ? 1.15 : 1.35);
    const length = crownRadiusTiles * range(limbRng, 0.55, 1.0) * ts;
    limbs.push({
      x0: start.x,
      y0: start.y,
      x1: start.x + outward * Math.cos(angle) * length,
      y1: start.y - Math.sin(angle) * length,
      w0: start.halfWidth * range(limbRng, 0.5, 0.72),
      w1: start.halfWidth * range(limbRng, 0.16, 0.3),
      snapsWhenDamaged: i >= limbCount - 2,
    });
  }

  const barkMarks = buildBarkMarks(mulberry32(subSeed(seed, SEED_SALT_BARK)), species, trunk, ts);

  let crownTopY = crownCenterY;
  for (const clump of clumps) crownTopY = Math.min(crownTopY, clump.y - clump.r);

  return {
    species,
    centerX,
    groundY,
    crownTopY: Math.max(crownTopY, groundY - MAX_CROWN_HEIGHT_TILES * ts),
    trunk,
    limbs,
    clumps,
    barkMarks,
    rootFlareTiles: halfWidthTiles * (isOak ? 2.1 : 1.7),
    halfWidthPx: canopyHalfWidthPx(clumps, centerX, halfWidthTiles * (isOak ? 2.1 : 1.7) * ts),
  };
}

function buildConiferSkeleton(
  seed: number,
  centerX: number,
  groundY: number,
  ts: number,
): TreeSkeleton {
  const trunkRng = mulberry32(subSeed(seed, SEED_SALT_TRUNK));
  const apexTiles = range(trunkRng, PINE_APEX_MIN, PINE_APEX_MAX);
  const halfWidthTiles = range(trunkRng, PINE_TRUNK_HALF_WIDTH_MIN, PINE_TRUNK_HALF_WIDTH_MAX);
  const trunk = buildTrunk(trunkRng, centerX, groundY, apexTiles, halfWidthTiles, ts);

  const crownRng = mulberry32(subSeed(seed, SEED_SALT_CROWN));
  const tierCount = rangeInt(crownRng, PINE_TIER_MIN, PINE_TIER_MAX);
  const clumps: Clump[] = [];
  // Built apex-first, so the array is already in back-to-front order: on a
  // conifer every bough hangs in front of the bole and each one occludes the
  // one above it, which is what gives the tree its layered read. Building it
  // bottom-first and letting the trunk paint over the upper tiers is what left
  // a bare pole sticking out of the crown.
  for (let tier = tierCount - 1; tier >= 0; tier--) {
    const t = tier / (tierCount - 1);
    const tierY =
      groundY - (PINE_LOWEST_TIER_TILES + t * (apexTiles - PINE_LOWEST_TIER_TILES)) * ts;
    const node = trunkNodeAt(trunk, tierY);
    const taper = Math.pow(1 - t, PINE_TAPER_EXPONENT);
    const halfWidth =
      Math.min(
        MAX_CROWN_HALF_WIDTH_TILES,
        PINE_TIER_HALF_WIDTH_APEX + (PINE_TIER_HALF_WIDTH_BASE - PINE_TIER_HALF_WIDTH_APEX) * taper,
      ) *
      ts *
      range(crownRng, 0.9, 1.06);
    // Every bough is in front of the bole, and `shedRank` counts up from the
    // bottom so a thinning conifer loses its crown before its skirt.
    clumps.push(
      buildClump(
        crownRng,
        node.x,
        tierY,
        halfWidth,
        CLUMP_DEPTH_CONIFER,
        tier,
        CONIFER_CLUMP_SHAPE,
      ),
    );
  }

  const limbRng = mulberry32(subSeed(seed, SEED_SALT_LIMBS));
  const limbs: Limb[] = [];
  // One per tier rather than every other: under a full canopy they are hidden
  // by the boughs anyway, and they are the only structure a charred conifer has
  // left once the needles are gone.
  for (let tier = 0; tier < tierCount; tier++) {
    const clump = clumps[tierCount - 1 - tier];
    const outward = tier % 2 === 0 ? 1 : -1;
    limbs.push({
      x0: trunkNodeAt(trunk, clump.y).x,
      y0: clump.y,
      // Kept well inside the bough: a needle spray is a narrow wedge, and a
      // limb reaching to the old circular radius pokes out of the silhouette
      // as a bare red stick.
      x1: clump.x + outward * clump.r * range(limbRng, 0.35, 0.55),
      y1: clump.y + clump.r * range(limbRng, 0.05, 0.18),
      w0: halfWidthTiles * ts * 0.55,
      w1: halfWidthTiles * ts * 0.18,
      snapsWhenDamaged: tier === 0,
    });
  }

  const barkMarks = buildBarkMarks(mulberry32(subSeed(seed, SEED_SALT_BARK)), 'pine', trunk, ts);

  let crownTopY = groundY;
  for (const clump of clumps) crownTopY = Math.min(crownTopY, clump.y - clump.r * 0.7);

  return {
    species: 'pine',
    centerX,
    groundY,
    crownTopY: Math.max(crownTopY, groundY - MAX_CROWN_HEIGHT_TILES * ts),
    trunk,
    limbs,
    clumps,
    barkMarks,
    rootFlareTiles: halfWidthTiles * 1.9,
    halfWidthPx: canopyHalfWidthPx(clumps, centerX, halfWidthTiles * 1.9 * ts),
  };
}

function buildTreeSkeleton(
  species: TreeSpecies,
  seed: number,
  centerX: number,
  groundY: number,
  ts: number,
): TreeSkeleton {
  if (species === 'pine') return buildConiferSkeleton(seed, centerX, groundY, ts);
  return buildBroadleafSkeleton(species, seed, centerX, groundY, ts);
}

// ── Colour helpers ────────────────────────────────────────────────────────────

const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const BYTE_MASK = 0xff;
const RGB_CHANNEL_COUNT = 3;

/**
 * Reads either notation a ramp can be written in.
 *
 * Ramps start life as `#rrggbb` literals but `charredRamp`/`wiltedRamp` hand
 * back interpolated `rgb(r,g,b)` strings, and those are then re-read by
 * `shade`. A hex-only parser silently returns NaN for them, which canvas takes
 * as an invalid `fillStyle` — every burning and charred clump filled with
 * whatever colour happened to be current, which is why they came out black.
 */
function parseColor(color: string): readonly [number, number, number] {
  if (color.startsWith('#')) {
    const value = Number.parseInt(color.slice(1), 16);
    return [
      (value >> RED_SHIFT) & BYTE_MASK,
      (value >> GREEN_SHIFT) & BYTE_MASK,
      value & BYTE_MASK,
    ];
  }
  const channels = color
    .slice(color.indexOf('(') + 1, color.lastIndexOf(')'))
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  if (channels.length !== RGB_CHANNEL_COUNT || channels.some((c) => !Number.isFinite(c))) {
    throw new Error(`Unsupported ramp colour: ${color}`);
  }
  return [channels[0], channels[1], channels[2]];
}

const CHANNEL_MAX = 255;

/** Shifts a ramp colour toward white (`amount > 0`) or black (`amount < 0`). */
function shade(hex: string, amount: number): string {
  const [r, g, b] = parseColor(hex);
  const target = amount >= 0 ? CHANNEL_MAX : 0;
  const t = Math.abs(amount);
  const mix = (channel: number) => Math.round(channel + (target - channel) * t);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

// ── Primitives ────────────────────────────────────────────────────────────────

/**
 * Soft dark ellipse where the trunk meets the ground. Without it a tree floats
 * above its tile instead of standing in it.
 */
function contactShadow(
  ctx: Ctx,
  cx: number,
  baseY: number,
  ts: number,
  maxDropPx: number,
  scale: number,
): void {
  const rx = ts * CONTACT_SHADOW_WIDTH_TILES * CONTACT_SHADOW_RADIUS_FROM_WIDTH * scale;
  // Never deeper than the room left below the ground line. The frame's bottom
  // edge is the anchor tile's bottom edge, so a shadow sized purely by taste
  // spills out of the cell and bakes as a hard horizontal cut.
  const ry = Math.min(ts * CONTACT_SHADOW_HEIGHT_TILES * scale, maxDropPx);
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(1, ry / rx);
  // Built *after* the transform, centred on the local origin. A canvas gradient
  // resolves its coordinates in the user space in effect when it is painted,
  // not when it is created — so a gradient built at (cx, baseY) and then
  // painted under `translate(cx, baseY)` lands at (2cx, 2baseY) and every
  // filled pixel falls past its outer stop. That is not subtly wrong: it paints
  // nothing at all, and the shadow was missing from all thirteen sheets.
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  grad.addColorStop(0, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
  grad.addColorStop(
    CONTACT_SHADOW_MID_STOP,
    `rgba(0,0,0,${CONTACT_SHADOW_ALPHA * CONTACT_SHADOW_MID_ALPHA_FRACTION})`,
  );
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Traces the tapered outline of a trunk without filling it. */
function traceTrunk(ctx: Ctx, trunk: readonly TrunkNode[]): void {
  ctx.beginPath();
  ctx.moveTo(trunk[0].x - trunk[0].halfWidth, trunk[0].y);
  for (const node of trunk) ctx.lineTo(node.x - node.halfWidth, node.y);
  for (let i = trunk.length - 1; i >= 0; i--) {
    ctx.lineTo(trunk[i].x + trunk[i].halfWidth, trunk[i].y);
  }
  ctx.closePath();
}

/** Root flare: a low triangular skirt that ties the trunk into the ground. */
function rootFlare(ctx: Ctx, skeleton: TreeSkeleton, ramp: Ramp, ts: number): void {
  const spread = skeleton.rootFlareTiles * ts;
  const base = skeleton.trunk[0];
  const rise = spread * 0.85;
  ctx.fillStyle = ramp.dark;
  ctx.beginPath();
  ctx.moveTo(base.x - spread, base.y);
  ctx.quadraticCurveTo(
    base.x - spread * 0.36,
    base.y - rise * 0.42,
    base.x - base.halfWidth,
    base.y - rise,
  );
  ctx.lineTo(base.x + base.halfWidth, base.y - rise);
  ctx.quadraticCurveTo(base.x + spread * 0.36, base.y - rise * 0.42, base.x + spread, base.y);
  ctx.closePath();
  ctx.fill();
}

/**
 * The trunk, cut off just above whatever canopy is left.
 *
 * A conifer sheds from the top down, so once its upper boughs are gone the bole
 * they grew out of is left standing in open air as a bare spike — the tree
 * reads as a mast with a skirt. Truncating to the surviving canopy fixes that
 * without touching the skeleton, which is what keeps a damaged pine recognisably
 * the same pine. A broadleaf's crown sits above its trunk top, so the cut never
 * bites there, and a tree with no canopy at all keeps its whole bole: that is
 * the charred husk's entire silhouette.
 */
function trunkUpTo(trunk: readonly TrunkNode[], cutY: number): readonly TrunkNode[] {
  if (cutY <= trunk[trunk.length - 1].y) return trunk;
  const kept = trunk.filter((node) => node.y >= cutY);
  if (kept.length === 0) return [trunk[0]];
  return [...kept, trunkNodeAt(trunk, cutY)];
}

/**
 * Trunk body: a flat fill for the silhouette, then a horizontal gradient that
 * puts the highlight on the upper-left face and the core shadow on the right.
 */
function paintTrunk(
  ctx: Ctx,
  skeleton: TreeSkeleton,
  ramp: Ramp,
  ts: number,
  gouged: boolean,
  trunk: readonly TrunkNode[],
): void {
  rootFlare(ctx, skeleton, ramp, ts);

  const base = trunk[0];
  const grad = ctx.createLinearGradient(
    base.x - base.halfWidth,
    base.y,
    base.x + base.halfWidth,
    base.y,
  );
  grad.addColorStop(0, ramp.dark);
  grad.addColorStop(0.24, ramp.light);
  grad.addColorStop(0.44, ramp.rim);
  grad.addColorStop(0.7, ramp.mid);
  grad.addColorStop(1, ramp.shadow);

  traceTrunk(ctx, trunk);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  traceTrunk(ctx, trunk);
  ctx.clip();
  for (const mark of skeleton.barkMarks) {
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.tilt);
    ctx.fillStyle = skeleton.species === 'birch' ? ramp.shadow : shade(ramp.shadow, -0.12);
    ctx.fillRect(-mark.width / 2, -mark.length / 2, mark.width, mark.length);
    ctx.restore();
  }
  ctx.restore();

  if (gouged) {
    // Exposed heartwood where the bark has been struck off. The pale scar is
    // the only cue that survives at tile size — a thinned crown alone reads as
    // a smaller tree rather than as a damaged one.
    ctx.save();
    traceTrunk(ctx, trunk);
    ctx.clip();
    for (const mark of skeleton.barkMarks.slice(0, GOUGE_COUNT)) {
      ctx.fillStyle = shade(ramp.rim, GOUGE_LIGHTEN);
      ctx.beginPath();
      ctx.ellipse(
        mark.x,
        mark.y,
        ts * GOUGE_HALF_WIDTH_TILES,
        ts * GOUGE_HALF_HEIGHT_TILES,
        mark.tilt,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  // Outline last so the bark texture cannot bleed over the silhouette edge.
  traceTrunk(ctx, trunk);
  ctx.strokeStyle = shade(ramp.shadow, -0.25);
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.stroke();
}

/** How much of a limb is left once it has snapped. */
const SNAPPED_LIMB_FRACTION = 0.42;
/** Radius of the pale exposed-wood cap on a snapped limb, relative to its tip. */
const SNAPPED_LIMB_CAP_SCALE = 1.4;
const SNAPPED_LIMB_CAP_LIGHTEN = 0.2;

function paintLimb(ctx: Ctx, limb: Limb, ramp: Ramp, snapped: boolean): void {
  const fraction = snapped ? SNAPPED_LIMB_FRACTION : 1;
  const x1 = limb.x0 + (limb.x1 - limb.x0) * fraction;
  const y1 = limb.y0 + (limb.y1 - limb.y0) * fraction;
  const angle = Math.atan2(y1 - limb.y0, x1 - limb.x0);
  const nx = Math.sin(angle);
  const ny = -Math.cos(angle);
  ctx.beginPath();
  ctx.moveTo(limb.x0 + nx * limb.w0, limb.y0 + ny * limb.w0);
  ctx.lineTo(x1 + nx * limb.w1, y1 + ny * limb.w1);
  ctx.lineTo(x1 - nx * limb.w1, y1 - ny * limb.w1);
  ctx.lineTo(limb.x0 - nx * limb.w0, limb.y0 - ny * limb.w0);
  ctx.closePath();
  ctx.fillStyle = snapped ? ramp.shadow : ramp.mid;
  ctx.fill();
  if (snapped) {
    // Splintered stub: a pale exposed-wood tip is what makes a short limb read
    // as broken rather than merely short.
    ctx.fillStyle = shade(ramp.rim, SNAPPED_LIMB_CAP_LIGHTEN);
    ctx.beginPath();
    ctx.arc(x1, y1, limb.w1 * SNAPPED_LIMB_CAP_SCALE, 0, TWO_PI);
    ctx.fill();
  }
}

/** How far past its own radius a needle spray's tip reaches. */
const NEEDLE_TIP_REACH = 1.25;
/** Half-width of a needle spray at its base, as a fraction of the lobe radius. */
const NEEDLE_BASE_HALF_WIDTH = 0.62;
/** How far the tip of a spray hangs below the line it grows along. */
const NEEDLE_TIP_DROOP = 0.3;

/**
 * Traces one lobe of a clump: a circle for a broadleaf leaf mass, a drooping
 * wedge for a conifer's needle spray. `shrink` pulls the shape in toward the
 * clump centre for the successive lighter passes.
 */
function traceLobe(ctx: Ctx, clump: Clump, lobe: Lobe, shrink: number, floorY: number): void {
  const x = clump.x + lobe.dx * shrink;
  const y = clump.y + lobe.dy * shrink;
  const r = lobe.r * shrink;
  if (!clump.pointy) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    return;
  }
  const length = Math.hypot(lobe.dx, lobe.dy);
  // A lobe sitting on the clump centre has no direction to point in; give it a
  // horizontal one so the apex bough still gets a silhouette.
  const ux = length === 0 ? 1 : lobe.dx / length;
  const uy = length === 0 ? 0 : lobe.dy / length;
  const tipX = x + ux * r * NEEDLE_TIP_REACH;
  // Clamped to the ground line. A bough drawn past it is not "hanging lower" —
  // the frame's bottom edge *is* the anchor tile's bottom edge (the sort anchor
  // demands `down: 0`), so anything below it is sheared off flat in the bake.
  // Stopping at the ground reads as a skirt sweeping the floor, which is what a
  // low fir bough does anyway.
  const tipY = Math.min(y + uy * r * NEEDLE_TIP_REACH + r * NEEDLE_TIP_DROOP, floorY);
  const halfWidth = r * NEEDLE_BASE_HALF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(clump.x - uy * halfWidth, clump.y + ux * halfWidth);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(clump.x + uy * halfWidth, clump.y - ux * halfWidth);
  ctx.closePath();
}

/** Successive passes over a clump: the body, the mid tone, and the lit cap. */
const CLUMP_BODY_SHRINK = 0.84;
const CLUMP_LIT_SHRINK = 0.6;
const CLUMP_LIT_OFFSET_FRACTION = 0.16;

/**
 * One leaf mass: a dark under-body, a mid pass pulled in toward the core, a lit
 * cap offset up-left, then a handful of rim speckles that break the outline so
 * the blob reads as leaves rather than as a balloon.
 */
function paintClump(
  ctx: Ctx,
  clump: Clump,
  ramp: Ramp,
  ts: number,
  wilt: number,
  floorY: number,
): void {
  const tint = clump.tint * (1 - wilt);
  const under = shade(ramp.dark, tint * 0.12);
  const body = shade(ramp.mid, tint * 0.16);
  const lit = shade(ramp.light, tint * 0.16);
  const rim = shade(ramp.rim, tint * 0.16);
  const litOffset = clump.r * CLUMP_LIT_OFFSET_FRACTION;

  ctx.fillStyle = under;
  for (const lobe of clump.lobes) {
    traceLobe(ctx, clump, lobe, 1, floorY);
    ctx.fill();
  }

  ctx.fillStyle = body;
  for (const lobe of clump.lobes) {
    traceLobe(ctx, clump, lobe, CLUMP_BODY_SHRINK, floorY);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(-litOffset, -litOffset);
  ctx.fillStyle = lit;
  for (const lobe of clump.lobes) {
    traceLobe(ctx, clump, lobe, CLUMP_LIT_SHRINK, floorY);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = rim;
  for (const speckle of clump.speckles) {
    ctx.beginPath();
    ctx.arc(
      clump.x + speckle.dx - litOffset,
      Math.min(clump.y + speckle.dy - litOffset, floorY),
      Math.max(ts * 0.02, speckle.r),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/**
 * A single flame: a teardrop whose tip wanders with the animation phase, drawn
 * outer → mid → hot → core so the hot centre survives the overlaps.
 */
function flameTongue(
  ctx: Ctx,
  x: number,
  baseY: number,
  width: number,
  height: number,
  phase: number,
  alpha: number,
): void {
  const sway = Math.sin(phase * TWO_PI) * width * 0.42;
  const layers = [
    { color: FLAME_OUTER, w: 1, h: 1 },
    { color: FLAME_MID, w: 0.72, h: 0.82 },
    { color: FLAME_HOT, w: 0.46, h: 0.6 },
    { color: FLAME_CORE, w: 0.24, h: 0.36 },
  ] as const;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const layer of layers) {
    const w = width * layer.w;
    const h = height * layer.h;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY);
    ctx.quadraticCurveTo(x - w * 0.62, baseY - h * 0.52, x + sway * layer.h, baseY - h);
    ctx.quadraticCurveTo(x + w * 0.62, baseY - h * 0.52, x + w / 2, baseY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** How wide a burning crown throws its sparks. */
const EMBER_SPRAY_SPREAD_TILES = 0.8;
/** How far a spark climbs, as a multiple of that spread. */
const EMBER_RISE_FROM_SPREAD = 1.5;
/** The headroom a spray therefore needs above the point it is anchored at. */
const EMBER_SPRAY_RISE_TILES = EMBER_SPRAY_SPREAD_TILES * EMBER_RISE_FROM_SPREAD;

/** Rising sparks. Positions come from the caller's rng so they stay seeded. */
function emberSpray(
  ctx: Ctx,
  rng: Rng,
  cx: number,
  cy: number,
  spread: number,
  count: number,
  phase: number,
  ts: number,
): void {
  const [r, g, b] = EMBER_RGB;
  for (let i = 0; i < count; i++) {
    const drift = (phase + rng()) % 1;
    const x = cx + range(rng, -spread, spread) + Math.sin(drift * TWO_PI) * ts * 0.1;
    const y = cy - drift * spread * EMBER_RISE_FROM_SPREAD;
    const size = ts * range(rng, 0.025, 0.06);
    ctx.fillStyle = `rgba(${r},${g},${b},${(1 - drift) * 0.9})`;
    ctx.fillRect(x, y, size, size);
  }
}

/** A soft dark bloom, for the burn scar the fire leaves under a tree. */
function scorch(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  alpha: number,
  maxDropPx: number,
): void {
  const groundPlaneSquash =
    CONTACT_SHADOW_HEIGHT_TILES / (CONTACT_SHADOW_WIDTH_TILES * CONTACT_SHADOW_RADIUS_FROM_WIDTH);
  ctx.save();
  ctx.translate(cx, cy);
  // Flattened further if the frame demands it, for the reason `contactShadow`
  // gives — a scar is much wider than a shadow, so it hits the edge sooner.
  ctx.scale(1, Math.min(groundPlaneSquash, maxDropPx / radius));
  // After the transform, for the reason `contactShadow` gives.
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  grad.addColorStop(0, `rgba(${SCORCH_RGB.join(',')},${alpha})`);
  grad.addColorStop(1, `rgba(${SCORCH_RGB.join(',')},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Flakes of burnt leaf drifting down out of a crown. */
function ashFall(
  ctx: Ctx,
  rng: Rng,
  cx: number,
  topY: number,
  bottomY: number,
  spread: number,
  count: number,
  phase: number,
  ts: number,
): void {
  const [r, g, b] = ASH_RGB;
  for (let i = 0; i < count; i++) {
    const fall = (phase + rng()) % 1;
    const x = cx + range(rng, -spread, spread) + Math.sin((fall + rng()) * TWO_PI) * ts * 0.14;
    const y = topY + (bottomY - topY) * fall;
    const size = ts * range(rng, 0.03, 0.06);
    ctx.fillStyle = `rgba(${r},${g},${b},${(1 - fall) * 0.55})`;
    ctx.fillRect(x, y, size, size);
  }
}

/**
 * Keeps a particle of half-extent `halfExtent` inside the frame's bottom edge.
 *
 * The envelope pins `frameHeight - tileY` to exactly one tile so the Y-sort
 * anchor lands on the tree's foot, which leaves almost no room below the ground
 * line — collapse effects have to be authored upward from it rather than
 * spilling past it.
 */
function clampBelow(y: number, frameBottomY: number, halfExtent: number): number {
  return Math.min(y, frameBottomY - halfExtent - FRAME_EDGE_INSET_PX);
}

/**
 * Keeps a particle of half-extent `halfExtent` inside the frame's side edges.
 *
 * The collapse effects were clamped vertically only, which held right up until
 * the dust discs grew with progress and the widest one on the widest variant
 * reached past the left edge — a latent overflow that the round-6 size change
 * tipped over. Clamping both axes removes the whole class rather than the
 * instance.
 */
function clampWithin(x: number, leftX: number, rightX: number, halfExtent: number): number {
  const low = leftX + halfExtent + FRAME_EDGE_INSET_PX;
  const high = rightX - halfExtent - FRAME_EDGE_INSET_PX;
  return Math.max(low, Math.min(x, high));
}

/**
 * Slack left between a clamped particle and the frame edge.
 *
 * One pixel, so that "any ink on the last row" stays a usable invariant for the
 * bake check: a particle sized to sit exactly on the edge is indistinguishable
 * from one that wanted to go further and was cut.
 */
const FRAME_EDGE_INSET_PX = 1;

const PUFF_COUNT = 12;
const PUFF_ANGLE_JITTER = 0.4;
const PUFF_REACH_MIN_TILES = 0.5;
const PUFF_REACH_MAX_TILES = 1.25;
const PUFF_RADIUS_MIN_TILES = 0.08;
const PUFF_RADIUS_MAX_TILES = 0.2;
/** Flattens the ring into ground plane rather than a sphere around the stump. */
const PUFF_VERTICAL_SQUASH = 0.3;
const PUFF_ALPHA_START = 0.5;
const PUFF_ALPHA_FADE = 0.4;

const DEBRIS_COUNT = 14;
const DEBRIS_REACH_MIN_TILES = 0.3;
const DEBRIS_REACH_MAX_TILES = 1.3;
const DEBRIS_LENGTH_MIN_TILES = 0.06;
const DEBRIS_LENGTH_MAX_TILES = 0.18;
const DEBRIS_LIFT_MAX_TILES = 1.1;
const DEBRIS_VERTICAL_SQUASH = 0.5;
const DEBRIS_FADE = 0.7;
const DEBRIS_DARK_SHARE = 0.55;
const DEBRIS_THICKNESS_TILES = 0.05;
const DEBRIS_HALF_THICKNESS_TILES = DEBRIS_THICKNESS_TILES / 2;

/** Expanding ring of dust and shredded needles thrown up as a tree comes down. */
function dustPuff(
  ctx: Ctx,
  rng: Rng,
  cx: number,
  baseY: number,
  progress: number,
  ts: number,
  place: TreePlacement,
): void {
  const [r, g, b] = DUST_RGB;
  for (let i = 0; i < PUFF_COUNT; i++) {
    const angle = (i / PUFF_COUNT) * TWO_PI + rng() * PUFF_ANGLE_JITTER;
    const reach = ts * range(rng, PUFF_REACH_MIN_TILES, PUFF_REACH_MAX_TILES) * progress;
    const radius = ts * range(rng, PUFF_RADIUS_MIN_TILES, PUFF_RADIUS_MAX_TILES) * (0.5 + progress);
    const x = clampWithin(cx + Math.cos(angle) * reach, place.leftX, place.rightX, radius);
    const y = clampBelow(
      baseY + Math.sin(angle) * reach * PUFF_VERTICAL_SQUASH,
      place.bottomY,
      radius,
    );
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, PUFF_ALPHA_START - progress * PUFF_ALPHA_FADE)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
  }
}

/** Splinters and shed leaves flung out of the collapse. */
function fellingDebris(
  ctx: Ctx,
  rng: Rng,
  skeleton: TreeSkeleton,
  ramp: Ramp,
  progress: number,
  ts: number,
  place: TreePlacement,
): void {
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const angle = range(rng, 0, TWO_PI);
    const reach = ts * range(rng, DEBRIS_REACH_MIN_TILES, DEBRIS_REACH_MAX_TILES) * progress;
    const length = ts * range(rng, DEBRIS_LENGTH_MIN_TILES, DEBRIS_LENGTH_MAX_TILES);
    // A splinter is drawn at an arbitrary rotation, so what has to fit is the
    // half-diagonal of its rectangle, not half its length.
    const halfExtent = Math.hypot(length, ts * DEBRIS_THICKNESS_TILES) / 2;
    const x = clampWithin(
      skeleton.centerX + Math.cos(angle) * reach,
      place.leftX,
      place.rightX,
      halfExtent,
    );
    const y = clampBelow(
      skeleton.groundY -
        ts * range(rng, 0, DEBRIS_LIFT_MAX_TILES) +
        Math.sin(angle) * reach * DEBRIS_VERTICAL_SQUASH,
      place.bottomY,
      halfExtent,
    );
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress * DEBRIS_FADE);
    ctx.translate(x, y);
    ctx.rotate(range(rng, 0, TWO_PI));
    ctx.fillStyle = rng() < DEBRIS_DARK_SHARE ? ramp.dark : ramp.mid;
    ctx.fillRect(
      -length / 2,
      -ts * DEBRIS_HALF_THICKNESS_TILES,
      length,
      ts * DEBRIS_THICKNESS_TILES,
    );
    ctx.restore();
  }
}

// ── State dressing ────────────────────────────────────────────────────────────

/** How the state changes what is painted, without changing the skeleton. */
interface Dressing {
  /** Fraction of the crown still on the tree, 0–1. */
  readonly foliage: number;
  /** 0 = green, 1 = fully scorched brown. */
  readonly wilt: number;
  /** 0 = live bark, 1 = charcoal. */
  readonly char: number;
  readonly limbsSnapped: boolean;
  /** Whether the trunk shows struck-off bark. */
  readonly gouged: boolean;
  /** Height of the flames as a fraction of the crown's height. 0 = not alight. */
  readonly flame: number;
  readonly embers: number;
  readonly scorchAlpha: number;
}

const DAMAGED_FOLIAGE_FRACTION = 0.5;
const BURNING_FOLIAGE_FRACTION = 0.9;
const BURNING_LATE_FOLIAGE_FRACTION = 0.34;
const BURNING_WILT = 0.28;
const BURNING_LATE_WILT = 0.92;
const BURNING_CHAR = 0.35;
const BURNING_LATE_CHAR = 0.85;
const BURNING_FLAME_HEIGHT = 0.62;
const BURNING_LATE_FLAME_HEIGHT = 0.86;
const BURNING_EMBERS = 10;
const BURNING_LATE_EMBERS = 18;
const BURNING_SCORCH_ALPHA = 0.3;
const BURNING_LATE_SCORCH_ALPHA = 0.5;
const CHARRED_SCORCH_ALPHA = 0.55;

/**
 * A hurt-but-living tree. Shared with `felling`, which is the same tree on its
 * way down — the collapse is a transform, not a different dressing.
 */
const DAMAGED_DRESSING: Dressing = {
  foliage: DAMAGED_FOLIAGE_FRACTION,
  wilt: 0,
  char: 0,
  limbsSnapped: true,
  gouged: true,
  flame: 0,
  embers: 0,
  scorchAlpha: 0,
};

/**
 * A burnt-out husk. Shared with `felling_charred` for the same reason — and
 * deliberately one value rather than two matching literals: the two drifting
 * apart is precisely the bug that made a charred tree grow its leaves back
 * while it fell, and nothing in a typecheck, a lint or the clip gate would
 * catch it happening again.
 */
const CHARRED_DRESSING: Dressing = {
  foliage: 0,
  wilt: 1,
  char: 1,
  // Limbs kept whole rather than snapped: with no leaves left, the bare
  // branches *are* the silhouette, and a husk with stubs reads as a post.
  limbsSnapped: false,
  gouged: false,
  flame: 0,
  embers: 0,
  scorchAlpha: CHARRED_SCORCH_ALPHA,
};

/** An untouched, fully leafed tree. */
const HEALTHY_DRESSING: Dressing = {
  foliage: 1,
  wilt: 0,
  char: 0,
  limbsSnapped: false,
  gouged: false,
  flame: 0,
  embers: 0,
  scorchAlpha: 0,
};

function dressingFor(state: TreeState): Dressing {
  switch (state) {
    case 'damaged':
    case 'felling':
      return DAMAGED_DRESSING;
    case 'charred':
    case 'felling_charred':
      return CHARRED_DRESSING;
    case 'burning':
      return {
        foliage: BURNING_FOLIAGE_FRACTION,
        wilt: BURNING_WILT,
        char: BURNING_CHAR,
        limbsSnapped: false,
        gouged: false,
        flame: BURNING_FLAME_HEIGHT,
        embers: BURNING_EMBERS,
        scorchAlpha: BURNING_SCORCH_ALPHA,
      };
    case 'burning_late':
      return {
        foliage: BURNING_LATE_FOLIAGE_FRACTION,
        wilt: BURNING_LATE_WILT,
        char: BURNING_LATE_CHAR,
        limbsSnapped: true,
        gouged: false,
        flame: BURNING_LATE_FLAME_HEIGHT,
        embers: BURNING_LATE_EMBERS,
        scorchAlpha: BURNING_LATE_SCORCH_ALPHA,
      };
    case 'idle':
      return HEALTHY_DRESSING;
  }
  // No `default`. Every state is listed above, so adding a row to `TreeState`
  // without dressing it is a compile error here rather than a sheet that bakes
  // silently in the wrong clothes — which is exactly how `felling` came to be
  // dressed as a living tree and to grow a charred husk's leaves back.
  return assertNeverState(state);
}

/**
 * Fails the bake on a `TreeState` nothing has dressed. Unreachable when the
 * switch above is exhaustive; the point is that TypeScript proves it is.
 */
function assertNeverState(state: never): never {
  throw new Error(`No dressing defined for tree state ${JSON.stringify(state)}`);
}

/** Blends a live ramp toward charcoal. */
function charredRamp(ramp: Ramp, amount: number): Ramp {
  if (amount <= 0) return ramp;
  if (amount >= 1) return CHAR;
  const blend = (live: string, burnt: string): string => {
    const [r0, g0, b0] = parseColor(live);
    const [r1, g1, b1] = parseColor(burnt);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
    return `rgb(${mix(r0, r1)},${mix(g0, g1)},${mix(b0, b1)})`;
  };
  return {
    shadow: blend(ramp.shadow, CHAR.shadow),
    dark: blend(ramp.dark, CHAR.dark),
    mid: blend(ramp.mid, CHAR.mid),
    light: blend(ramp.light, CHAR.light),
    rim: blend(ramp.rim, CHAR.rim),
  };
}

/** Blends a foliage ramp toward the browns fire leaves behind. */
function wiltedRamp(ramp: Ramp, amount: number): Ramp {
  if (amount <= 0) return ramp;
  const blend = (live: string, burnt: string): string => {
    const [r0, g0, b0] = parseColor(live);
    const [r1, g1, b1] = parseColor(burnt);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
    return `rgb(${mix(r0, r1)},${mix(g0, g1)},${mix(b0, b1)})`;
  };
  return {
    shadow: blend(ramp.shadow, SCORCHED_FOLIAGE.shadow),
    dark: blend(ramp.dark, SCORCHED_FOLIAGE.dark),
    mid: blend(ramp.mid, SCORCHED_FOLIAGE.mid),
    light: blend(ramp.light, SCORCHED_FOLIAGE.light),
    rim: blend(ramp.rim, SCORCHED_FOLIAGE.rim),
  };
}

/**
 * The clumps still on the tree at a given coverage. Shedding is by `shedRank`
 * rather than at random so a crown thins from the outside in and the same
 * clumps survive in `damaged` as in `burning_late`.
 */
function survivingClumps(skeleton: TreeSkeleton, coverage: number): Clump[] {
  if (coverage >= 1) return [...skeleton.clumps];
  if (coverage <= 0) return [];
  const keep = Math.max(1, Math.round(skeleton.clumps.length * coverage));
  return skeleton.clumps.filter((clump) => clump.shedRank < keep);
}

const CROWN_FLAMES_PER_CLUMP = 4;
const TRUNK_FLAME_COUNT = 3;
const CROWN_FLAME_SPREAD = 0.85;
const CROWN_FLAME_BASE_LIFT = 0.3;
const CROWN_FLAME_BASE_DROP = 0.55;
const CROWN_FLAME_HEIGHT_MIN = 0.16;
const CROWN_FLAME_HEIGHT_MAX = 0.3;
const CROWN_FLAME_WIDTH_MIN = 0.42;
const CROWN_FLAME_WIDTH_MAX = 0.62;
const CROWN_FLAME_ALPHA_MIN = 0.65;
const CROWN_FLAME_ALPHA_MAX = 0.95;
const TRUNK_FLAME_HEIGHT_MIN_TILES = 0.4;
const TRUNK_FLAME_HEIGHT_MAX_TILES = 0.85;
const TRUNK_FLAME_WIDTH_FRACTION = 0.55;
const TRUNK_FLAME_ALPHA_MIN = 0.7;
const TRUNK_FLAME_HEIGHT_ALONG_MIN = 0.05;
const TRUNK_FLAME_HEIGHT_ALONG_MAX = 0.85;
/** Clearance kept between a flame's tip and the top of the baked frame. */
const FLAME_FRAME_MARGIN_PX = 1;

function paintFlames(
  ctx: Ctx,
  rng: Rng,
  skeleton: TreeSkeleton,
  litClumps: readonly Clump[],
  dressing: Dressing,
  phase: number,
  ts: number,
  frameTopY: number,
): void {
  const crownHeight = skeleton.groundY - skeleton.crownTopY;
  // Every flame is capped by the room left above where it starts. A pine's apex
  // sits within a dozen pixels of the top of the frame, and an uncapped tongue
  // was sheared off there in a straight horizontal line — baked in, and exactly
  // the failure `TreePlacement` exists to prevent.
  const fitToFrame = (baseY: number, height: number): number =>
    Math.max(0, Math.min(height, baseY - frameTopY - FLAME_FRAME_MARGIN_PX));

  // Only the leaf masses the tree still has. Iterating the whole skeleton hangs
  // fire in the air where `burning_late` has already burnt the crown away.
  for (const clump of litClumps) {
    for (let i = 0; i < CROWN_FLAMES_PER_CLUMP; i++) {
      const x = clump.x + range(rng, -clump.r * CROWN_FLAME_SPREAD, clump.r * CROWN_FLAME_SPREAD);
      const baseY =
        clump.y + range(rng, -clump.r * CROWN_FLAME_BASE_LIFT, clump.r * CROWN_FLAME_BASE_DROP);
      const height = fitToFrame(
        baseY,
        crownHeight * dressing.flame * range(rng, CROWN_FLAME_HEIGHT_MIN, CROWN_FLAME_HEIGHT_MAX),
      );
      flameTongue(
        ctx,
        x,
        baseY,
        height * range(rng, CROWN_FLAME_WIDTH_MIN, CROWN_FLAME_WIDTH_MAX),
        height,
        (phase + rng()) % 1,
        range(rng, CROWN_FLAME_ALPHA_MIN, CROWN_FLAME_ALPHA_MAX),
      );
    }
  }

  for (let i = 0; i < TRUNK_FLAME_COUNT; i++) {
    const t = range(rng, TRUNK_FLAME_HEIGHT_ALONG_MIN, TRUNK_FLAME_HEIGHT_ALONG_MAX);
    const node = trunkNodeAt(
      skeleton.trunk,
      skeleton.groundY - t * (skeleton.groundY - skeleton.trunk[skeleton.trunk.length - 1].y),
    );
    const height = fitToFrame(
      node.y,
      ts * range(rng, TRUNK_FLAME_HEIGHT_MIN_TILES, TRUNK_FLAME_HEIGHT_MAX_TILES) * dressing.flame,
    );
    flameTongue(
      ctx,
      node.x + range(rng, -node.halfWidth, node.halfWidth),
      node.y,
      height * TRUNK_FLAME_WIDTH_FRACTION,
      height,
      (phase + rng()) % 1,
      range(rng, TRUNK_FLAME_ALPHA_MIN, 1),
    );
  }
}

/**
 * Where a tree is being painted, and how much room it has.
 *
 * The bounds are not decoration. `renderSheet` clips every frame to its own
 * cell, so anything a painter draws outside the frame is not merely invisible —
 * it is sheared off along a straight line and baked that way for good. The
 * skeleton is bounded by `MAX_CROWN_*`, but flames and collapse debris are drawn
 * *on top of* the skeleton and need the frame's own edges to clamp against.
 */
export interface TreePlacement {
  /** The anchor tile's top-left corner, in frame coordinates. */
  readonly originX: number;
  readonly originY: number;
  /** The frame's own edges. All four, so a painter can clamp in either axis. */
  readonly topY: number;
  readonly bottomY: number;
  readonly leftX: number;
  readonly rightX: number;
  readonly tileScale: number;
}

/** Paints one tree into `place`. */
export function drawTree(
  ctx: Ctx,
  species: TreeSpecies,
  seed: number,
  state: TreeState,
  frame: number,
  frameCount: number,
  place: TreePlacement,
): void {
  const { originX, originY, tileScale } = place;
  const ts = tileScale;
  const centerX = originX + ts / 2;
  const groundY = originY + ts * TRUNK_FOOT_TILE_FRACTION;
  const skeleton = buildTreeSkeleton(species, seed, centerX, groundY, ts);
  const dressing = dressingFor(state);
  const barkRamp = charredRamp(barkRampFor(species), dressing.char);
  const leafRamp = wiltedRamp(foliageRampFor(species), dressing.wilt);
  const phase = frameCount <= 1 ? 0 : frame / frameCount;

  // Fire rng is re-seeded per frame so the flicker differs frame to frame while
  // staying byte-identical across re-bakes of the sheet.
  const fireRng = mulberry32(subSeed(seed, SEED_SALT_FIRE + frame));
  const debrisRng = mulberry32(subSeed(seed, SEED_SALT_DEBRIS + frame));

  const isFelling = state === 'felling' || state === 'felling_charred';
  const fellProgress = isFelling && frameCount > 1 ? frame / (frameCount - 1) : 0;

  // How far anything painted on the ground plane may reach below the trunk's
  // foot before it leaves the cell.
  const groundRoomPx = place.bottomY - groundY - FRAME_EDGE_INSET_PX;
  if (dressing.scorchAlpha > 0) {
    scorch(ctx, centerX, groundY, ts * SCORCH_RADIUS_TILES, dressing.scorchAlpha, groundRoomPx);
  }
  contactShadow(
    ctx,
    centerX,
    groundY,
    ts,
    groundRoomPx,
    isFelling ? 1 - fellProgress * FELLING_SHADOW_SHRINK : 1,
  );

  ctx.save();
  if (isFelling) {
    // A full topple would swing a four-tile crown a tile and a half past the
    // frame, where it would be clipped for good. The collapse instead leans as
    // far as the frame allows while the trunk buckles and shortens under it,
    // which reads as "coming down" without losing the crown off the sheet.
    // The lean is small on purpose. The frame's bottom edge is the anchor
    // tile's bottom edge, so there are barely four pixels below the ground
    // line; a tree leaning far enough to read as a topple swings its widest
    // point a good half-tile past that and is sheared off flat. The collapse is
    // carried by the vertical crush and the dust instead, and the residual lean
    // is lifted back out below so even that cannot dip past the edge.
    const FELL_MAX_LEAN = 0.1;
    const FELL_MAX_SQUASH = 0.82;
    // Only partly faded by the last frame: the tile reverts to grass the moment
    // the animation ends, so a tree that has already vanished by then leaves a
    // beat of empty ground in the middle of its own collapse.
    const FELL_MAX_FADE = 0.35;
    const lean = fellProgress * FELL_MAX_LEAN;
    ctx.translate(centerX, groundY - Math.sin(lean) * skeleton.halfWidthPx);
    ctx.rotate(lean);
    ctx.scale(1, 1 - fellProgress * FELL_MAX_SQUASH);
    ctx.translate(-centerX, -groundY);
    ctx.globalAlpha = Math.max(0, 1 - fellProgress * FELL_MAX_FADE);
  }

  const kept = survivingClumps(skeleton, dressing.foliage);
  const behind = kept.filter((clump) => clump.depth < CLUMP_DEPTH_FRONT_THRESHOLD);
  const front = kept.filter((clump) => clump.depth >= CLUMP_DEPTH_FRONT_THRESHOLD);
  // Where the trunk should stop: the highest cut any surviving leaf mass asks
  // for — smallest y, since y grows downward. Null when nothing is left, which
  // is the charred husk and the one case where the whole bole should show.
  let canopyCutY: number | null = null;
  for (const clump of kept) {
    const clumpTopY = clump.y - clump.r * TRUNK_CUT_ABOVE_CANOPY;
    canopyCutY = canopyCutY === null ? clumpTopY : Math.min(canopyCutY, clumpTopY);
  }

  for (const clump of behind) paintClump(ctx, clump, leafRamp, ts, dressing.wilt, groundY);
  for (const limb of skeleton.limbs) {
    // A limb that grew out of a bough the tree has since shed has nothing left
    // to attach to; drawn anyway it floats above the crown as a loose stick.
    if (canopyCutY !== null && limb.y0 < canopyCutY) continue;
    paintLimb(ctx, limb, barkRamp, dressing.limbsSnapped && limb.snapsWhenDamaged);
  }
  const visibleTrunk = canopyCutY === null ? skeleton.trunk : trunkUpTo(skeleton.trunk, canopyCutY);
  paintTrunk(ctx, skeleton, barkRamp, ts, dressing.gouged, visibleTrunk);
  for (const clump of front) paintClump(ctx, clump, leafRamp, ts, dressing.wilt, groundY);

  ctx.restore();

  // Gated on the collapse having begun. Both effects scale their *reach* by
  // progress but not their size or opacity, so at frame 0 they stacked a dozen
  // coincident dust discs and a fistful of splinters on a trunk that had not
  // moved yet — the first frame of a collapse must be the standing tree.
  if (isFelling && fellProgress > 0) {
    dustPuff(ctx, debrisRng, centerX, groundY, fellProgress, ts, place);
    fellingDebris(ctx, debrisRng, skeleton, barkRamp, fellProgress, ts, place);
  }

  if (dressing.flame > 0) {
    paintFlames(ctx, fireRng, skeleton, kept, dressing, phase, ts, place.topY);
    emberSpray(
      ctx,
      fireRng,
      centerX,
      // Sparks rise from the crown, but never out of the frame: the spray climbs
      // `EMBER_SPRAY_RISE_TILES` above wherever it is anchored, and a pine's
      // crown is already within a dozen pixels of the top of the cell — so the
      // floor has to leave room for the whole rise, not just for the anchor.
      Math.max(skeleton.crownTopY + ts, place.topY + EMBER_SPRAY_RISE_TILES * ts),
      ts * EMBER_SPRAY_SPREAD_TILES,
      dressing.embers,
      phase,
      ts,
    );
  }
  if (state === 'burning_late') {
    const ASH_COUNT = 10;
    ashFall(ctx, fireRng, centerX, skeleton.crownTopY, groundY, ts * 0.7, ASH_COUNT, phase, ts);
  }
}

// ── Shared remains decal ──────────────────────────────────────────────────────

const REMAINS_STUMP_HALF_WIDTH_TILES = 0.19;
const REMAINS_STUMP_HEIGHT_TILES = 0.26;
const REMAINS_ASH_COUNT = 22;
const REMAINS_CHIP_COUNT = 9;
const REMAINS_SEED = 0x7ee5;
const REMAINS_SCORCH_RADIUS_TILES = 0.85;
const REMAINS_SCORCH_ALPHA = 0.32;
/** A stump casts a smaller shadow than the tree it came off. */
const REMAINS_SHADOW_SCALE = 0.6;
/** Flattens the ash and chip scatter into the ground plane. */
const REMAINS_SCATTER_SQUASH = 0.42;
const REMAINS_ASH_SIZE_MIN_TILES = 0.03;
const REMAINS_ASH_SIZE_MAX_TILES = 0.08;
const REMAINS_ASH_ALPHA_MIN = 0.22;
const REMAINS_ASH_ALPHA_MAX = 0.55;
const REMAINS_CHIP_LENGTH_MIN_TILES = 0.07;
const REMAINS_CHIP_LENGTH_MAX_TILES = 0.16;
const REMAINS_CHIP_THICKNESS_TILES = 0.048;
const REMAINS_CHIP_HALF_THICKNESS_TILES = REMAINS_CHIP_THICKNESS_TILES / 2;
const REMAINS_CHIP_DARK_SHARE = 0.5;

/**
 * The decal a felled tree leaves behind: a sawn stump, a ring of ash and a few
 * chips. Shared by all twelve keys — a stump reads the same whatever species it
 * came off, and twelve near-identical rows would be pure waste.
 */
export function drawTreeRemains(
  ctx: Ctx,
  originX: number,
  originY: number,
  tileScale: number,
  frameBottomY: number,
): void {
  const ts = tileScale;
  const cx = originX + ts / 2;
  const baseY = originY + ts * TRUNK_FOOT_TILE_FRACTION;
  const rng = mulberry32(REMAINS_SEED);

  const groundRoomPx = frameBottomY - baseY - FRAME_EDGE_INSET_PX;
  scorch(ctx, cx, baseY, ts * REMAINS_SCORCH_RADIUS_TILES, REMAINS_SCORCH_ALPHA, groundRoomPx);

  const [ar, ag, ab] = ASH_RGB;
  for (let i = 0; i < REMAINS_ASH_COUNT; i++) {
    const angle = range(rng, 0, TWO_PI);
    const reach = range(rng, 0.15, 1.05) * ts * 0.6;
    const x = cx + Math.cos(angle) * reach;
    const size = ts * range(rng, REMAINS_ASH_SIZE_MIN_TILES, REMAINS_ASH_SIZE_MAX_TILES);
    const y = clampBelow(
      baseY + Math.sin(angle) * reach * REMAINS_SCATTER_SQUASH,
      frameBottomY,
      size,
    );
    ctx.fillStyle = `rgba(${ar},${ag},${ab},${range(rng, REMAINS_ASH_ALPHA_MIN, REMAINS_ASH_ALPHA_MAX)})`;
    ctx.fillRect(x, y, size, size);
  }

  for (let i = 0; i < REMAINS_CHIP_COUNT; i++) {
    const angle = range(rng, 0, TWO_PI);
    const reach = range(rng, 0.3, 1) * ts * 0.55;
    const length = ts * range(rng, REMAINS_CHIP_LENGTH_MIN_TILES, REMAINS_CHIP_LENGTH_MAX_TILES);
    ctx.save();
    ctx.translate(
      cx + Math.cos(angle) * reach,
      clampBelow(
        baseY + Math.sin(angle) * reach * REMAINS_SCATTER_SQUASH,
        frameBottomY,
        length / 2,
      ),
    );
    ctx.rotate(range(rng, 0, TWO_PI));
    ctx.fillStyle = rng() < REMAINS_CHIP_DARK_SHARE ? OAK_BARK.dark : OAK_BARK.mid;
    ctx.fillRect(
      -length / 2,
      -ts * REMAINS_CHIP_HALF_THICKNESS_TILES,
      length,
      ts * REMAINS_CHIP_THICKNESS_TILES,
    );
    ctx.restore();
  }

  contactShadow(ctx, cx, baseY, ts, groundRoomPx, REMAINS_SHADOW_SCALE);

  const halfWidth = ts * REMAINS_STUMP_HALF_WIDTH_TILES;
  const height = ts * REMAINS_STUMP_HEIGHT_TILES;
  const grad = ctx.createLinearGradient(cx - halfWidth, baseY, cx + halfWidth, baseY);
  grad.addColorStop(0, OAK_BARK.dark);
  grad.addColorStop(0.3, OAK_BARK.light);
  grad.addColorStop(1, OAK_BARK.shadow);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, baseY);
  ctx.lineTo(cx - halfWidth * 0.9, baseY - height);
  ctx.lineTo(cx + halfWidth * 0.9, baseY - height);
  ctx.lineTo(cx + halfWidth, baseY);
  ctx.closePath();
  ctx.fill();

  // Sawn top face: pale heartwood with rings, which is what says "cut" rather
  // than "short trunk".
  ctx.fillStyle = shade(OAK_BARK.rim, 0.28);
  ctx.beginPath();
  ctx.ellipse(cx, baseY - height, halfWidth * 0.9, halfWidth * 0.4, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = OAK_BARK.mid;
  ctx.lineWidth = Math.max(1, ts * 0.022);
  const RING_COUNT = 2;
  for (let i = 1; i <= RING_COUNT; i++) {
    const t = i / (RING_COUNT + 1);
    ctx.beginPath();
    ctx.ellipse(cx, baseY - height, halfWidth * 0.9 * t, halfWidth * 0.4 * t, 0, 0, TWO_PI);
    ctx.stroke();
  }
}
