/**
 * Grimaldi — what is left of the Over City's ringmaster after the pestilence
 * took him. Nothing of the man is left to see: he is an enormous sentient plant
 * grown around and through the big top's centre mast, and the horror is meant to
 * come from the *absence* of a face rather than the presence of one. There are
 * no eyes here, no hat and no head, and none should ever be added — an earlier
 * pass had all three and read as a scarecrow.
 *
 * Five things carry the read, and each was learned from a render that failed
 * without it.
 *
 * The mast runs the full height of the sprite and out of the top of it, because
 * a vine with nothing to climb is just a bush — and it is visibly *deformed*
 * where the wraps cross it, because a pole the vine merely decorates makes the
 * vine decorative too.
 *
 * The silhouette is a woody helix rather than a body: no shoulders, no arms, no
 * bilateral anything, because symmetry is the loudest "plush toy" cue there is.
 * The whole mass leans off the pole and one heavy limb reaches down and forward
 * out of it, so the outline is a thing caught mid-motion instead of a pile.
 *
 * The value range is deliberately brutal — near-black in the recesses, a dark
 * underside on every blade and rope, a hot rim along everything facing up. A
 * ramp that looks like sensible shading at review scale flattens into one green
 * blob at a 32 px tile, and every part of him has to stay separable there.
 *
 * The organs are grotesque rather than tidy: pods of wildly unequal size, some
 * split and weeping, some collapsed and empty; blades torn, bitten and curled.
 * Even, smooth produce reads as a garden.
 *
 * And under the poison he does not merely darken — he necrotises: yellow-grey
 * blight spreads across blade and pod, edges brown, and the whole mass slumps
 * and loses its grip on the pole. That state is what the player looks at for the
 * length of the cure cutscene, so it carries the scene.
 */

export interface GrimaldiVineVisualState {
  /** 0..1 — how strongly the poison green-tint reads. */
  readonly poison: number;
  /** 0..1 — how far the mass has sagged under the poison. */
  readonly sag: number;
  /** 0..1 — the cure flourish: a soft golden bloom that lifts the mass straight. */
  readonly cure: number;
  /** True on the frame a refused blow should flare. */
  readonly hitFlash: boolean;
}

/** How many tiles wide/tall the art occupies — he wraps the whole tent pole. */
export const GRIMALDI_VINE_DRAW_SCALE = 4;

/**
 * Tiles above the entity tile to keep clear for prompts and the nameplate.
 *
 * Measured off a render, as the worst case over every poison/sag/cure state and
 * a full sweep of `phase`: the topmost inked pixel more than a mast-width off the
 * centre line. The mast itself is excluded because it leaves the sprite entirely
 * on its way to a tent peak the camera never sees, and hanging a label off the
 * end of it would put the label in open sky.
 */
export const GRIMALDI_VINE_OVERLAY_CLEARANCE = 7.8;

/**
 * The big top's centre mast (fractions of the scaled size). It runs off the top
 * edge of the sprite: what makes a vine read as *strangling* something is the
 * something, continuing past where the vine stops.
 */
const MAST_HALF_WIDTH = 0.105;
const MAST_TOP_Y = -2.6;
const MAST_BASE_Y = 0.48;
/** One lit edge and one shaded edge, as fractions of the pole's own half-width so both survive a bite. */
const MAST_HIGHLIGHT_FROM = -0.78;
const MAST_HIGHLIGHT_TO = -0.42;
const MAST_SHADE_FROM = 0.58;
const MAST_SHADE_TO = 1.0;
/** Below this the bitten profile visibly facets where a wrap crosses it. */
const MAST_PROFILE_STEPS = 64;

/**
 * Where a wrap has sunk into the pole. `leftDepth`/`rightDepth` are unequal on
 * purpose: a symmetric pinch reads as a turned wooden bead, and the pole has to
 * read as crushed by something that does not care about it.
 */
interface MastBite {
  readonly y: number;
  readonly span: number;
  readonly leftDepth: number;
  readonly rightDepth: number;
  /** How far the crushed section pushes the pole's centre line off true. */
  readonly kink: number;
}
const MAST_BITES: readonly MastBite[] = [
  { y: 0.3, span: 0.16, leftDepth: 0.4, rightDepth: 0.18, kink: 0.016 },
  { y: -0.14, span: 0.2, leftDepth: 0.26, rightDepth: 0.58, kink: -0.03 },
  { y: -0.62, span: 0.18, leftDepth: 0.54, rightDepth: 0.22, kink: 0.026 },
  { y: -1.14, span: 0.15, leftDepth: 0.2, rightDepth: 0.5, kink: -0.032 },
  { y: -1.66, span: 0.12, leftDepth: 0.46, rightDepth: 0.18, kink: 0.028 },
  { y: -2.05, span: 0.11, leftDepth: 0.16, rightDepth: 0.34, kink: -0.018 },
];

/** Splinters sprung out of the deepest bites — the pole failing, not just narrowing. */
interface MastSplinter {
  readonly y: number;
  readonly side: number;
  readonly length: number;
  readonly rise: number;
  readonly width: number;
}
const MAST_SPLINTERS: readonly MastSplinter[] = [
  { y: -0.14, side: 1, length: 0.075, rise: 0.05, width: 0.016 },
  { y: -0.62, side: -1, length: 0.06, rise: -0.045, width: 0.013 },
  { y: 0.3, side: -1, length: 0.05, rise: 0.03, width: 0.012 },
];

/**
 * A run of the strangling helix. The heavy runs are wider than the pole itself:
 * a rope thinner than what it is crushing reads as trim on a post.
 *
 * Radius and thickness both swell around a single station rather than tapering
 * evenly, which is what turns a spring into a plant that has been feeding in one
 * place for years.
 */
interface CoilSpec {
  readonly baseY: number;
  readonly topY: number;
  readonly turns: number;
  /** Rotates the whole helix so two runs never cross the mast at the same height. */
  readonly phaseOffset: number;
  readonly baseRadius: number;
  readonly topRadius: number;
  readonly baseWidth: number;
  readonly topWidth: number;
  /** Where along the run the mass is densest, 0 at the root and 1 at the tip. */
  readonly swellAt: number;
  readonly swellSpread: number;
  readonly swellRadius: number;
  readonly swellWidth: number;
  /** Only the heavy runs earn a rim; a rim on a thin runner is just a bright line. */
  readonly rimLit: boolean;
}

const MAIN_COIL: CoilSpec = {
  baseY: 0.34,
  topY: -1.62,
  turns: 3.4,
  phaseOffset: 0.6,
  baseRadius: 0.31,
  topRadius: 0.15,
  baseWidth: 0.3,
  topWidth: 0.085,
  swellAt: 0.26,
  swellSpread: 0.22,
  swellRadius: 0.045,
  swellWidth: 0.13,
  rimLit: true,
};
/** A second heavy runner, crossing at different heights so the two never braid. */
const SECOND_COIL: CoilSpec = {
  baseY: 0.3,
  topY: -1.2,
  turns: 2.3,
  phaseOffset: 2.9,
  baseRadius: 0.23,
  topRadius: 0.15,
  baseWidth: 0.21,
  topWidth: 0.06,
  swellAt: 0.52,
  swellSpread: 0.3,
  swellRadius: 0.03,
  swellWidth: 0.06,
  rimLit: true,
};
/** The climbing tip: the only run still gaining height, and the reason the mass reaches so far up the pole. */
const RUNNER_COIL: CoilSpec = {
  baseY: -0.8,
  topY: -2.0,
  turns: 1.9,
  phaseOffset: 4.4,
  baseRadius: 0.17,
  topRadius: 0.125,
  baseWidth: 0.075,
  topWidth: 0.018,
  swellAt: 0.0,
  swellSpread: 0.3,
  swellRadius: 0.0,
  swellWidth: 0.0,
  rimLit: false,
};

/** Below about this many segments per turn the helix visibly polygonises. */
const COIL_SEGMENTS_PER_TURN = 20;
/** Slow lateral creep — the coil is always tightening, never quickly enough to see it move. */
const COIL_CREEP_SPEED = 0.017;
const COIL_CREEP_WAVES = 5.0;
const COIL_CREEP_AMP = 0.012;
/** Under the poison the whole climb bows off the pole and settles. */
const COIL_SAG_BOW = -0.24;
const COIL_SAG_DROP = 0.22;
/**
 * The mass hangs off the pole rather than balancing on it. Without the lean the
 * silhouette is a symmetrical bottom-heavy triangle, which reads as a stack of
 * scenery no matter how good the parts are.
 */
const MASS_LEAN_X = -0.14;
/** Bands as fractions of the rope they ride, never as fixed offsets — see {@link edgeBandLift}. */
const COIL_RIM_WIDTH_FRACTION = 0.24;
/** The dark sliver under a rope. Rim alone lights the top and leaves the underside the same value as the body. */
const COIL_SHADE_WIDTH_FRACTION = 0.42;
/** A hair of recess value around the far half, so a back turn still parts from the pole behind it. */
const COIL_BACKING_OUTLINE = 0.12;
/** Roots get a wider midtone under their rim: they are the thickest strokes on him and read as flat without a step. */
const ROOT_MIDTONE_WIDTH_FRACTION = 0.5;

/**
 * Loose loops of vine tangled through the strangle point. Three, coarse and
 * large: an earlier pass had six small tidy ones and they dissolved into the
 * coils at tile size. Every one is a *rotated* partial ellipse of its own size
 * and sweep, because a run of concentric horizontal arcs is always a flower pot.
 */
interface TangleLoop {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly tilt: number;
  readonly fromAngle: number;
  readonly toAngle: number;
  readonly width: number;
}
const TANGLE_LOOPS: readonly TangleLoop[] = [
  { x: -0.24, y: -0.26, rx: 0.3, ry: 0.16, tilt: 0.85, fromAngle: 0.4, toAngle: 4.2, width: 0.13 },
  { x: 0.16, y: -0.6, rx: 0.25, ry: 0.14, tilt: -0.7, fromAngle: 1.2, toAngle: 5.0, width: 0.1 },
  { x: 0.06, y: -0.06, rx: 0.32, ry: 0.17, tilt: 0.3, fromAngle: 2.6, toAngle: 5.9, width: 0.15 },
];

/**
 * Unlit hollows inside the tangle. They are painted between the far and near
 * halves of the helix, so the near ropes read as standing off a black interior
 * instead of sitting on more of the same green.
 */
const RECESS_POCKETS = [
  { x: -0.1, y: -0.26, rx: 0.15, ry: 0.11 },
  { x: 0.19, y: -0.46, rx: 0.11, ry: 0.09 },
  { x: -0.02, y: 0.0, rx: 0.17, ry: 0.09 },
] as const;

/** How far in from the ends an upper-edge arc starts, so a rim never closes into a ring. */
const WRAP_ARC_INSET = 0.35;
/** Where the tangle centres — spores orbit it and the cure blooms out of it. */
const KNOT_CENTER_Y = -0.3;

/**
 * Aerial roots gripping the sawdust. Five, not a fan: three left and two right,
 * of wildly unequal length and weight. They hold nearly their full width until
 * the last quarter, because a root that tapers evenly from the trunk is a spider
 * leg.
 */
interface RootLimb {
  readonly angle: number;
  readonly length: number;
  readonly baseWidth: number;
  readonly tipWidth: number;
}
const ROOT_LIMBS: readonly RootLimb[] = [
  { angle: 2.78, length: 0.62, baseWidth: 0.24, tipWidth: 0.08 },
  { angle: 2.16, length: 0.36, baseWidth: 0.15, tipWidth: 0.055 },
  { angle: 1.68, length: 0.26, baseWidth: 0.13, tipWidth: 0.05 },
  { angle: 0.82, length: 0.42, baseWidth: 0.18, tipWidth: 0.065 },
  { angle: 0.28, length: 0.7, baseWidth: 0.27, tipWidth: 0.09 },
];
const ROOT_SEGMENT_COUNT = 6;
const ROOT_ORIGIN_Y = 0.12;
/**
 * Roots leave the trunk at their own point on the plate rather than all from one
 * hub. Five round-capped strokes sharing an origin stack into a single dark
 * mound the size of the base, and the limbs stop reading as limbs.
 */
const ROOT_ORIGIN_SPREAD = 0.16;
const ROOT_DROP_BASE = 0.32;
const ROOT_DROP_SPREAD = 0.26;
/** Late-curving descent, so a root flares outward first and only then grips the floor. */
const ROOT_GRIP = 0.34;
/** Above 1 the width clings to the base value and collapses only near the tip. */
const ROOT_TAPER_POWER = 2.6;
const ROOT_SWAY_AMP = 0.018;
const ROOT_SWAY_SPEED = 0.014;
const ROOT_SAG_DROP = 0.12;
/** Sick roots slide outward as well as down: the grip failing is most of what "slumping" looks like. */
const ROOT_SAG_SPLAY = 0.16;
const ROOT_THORN_AT = 0.55;
const ROOT_THORN_LEN = 0.11;
const ROOT_THORN_WIDTH = 0.03;
const ROOT_THORN_RISE = 0.6;
const ROOT_PLATE_SHADOW_DROP = 0.03;
/** A lumpy plate where the roots meet, so the base has weight instead of a hub of strokes. */
const ROOT_PLATE_LOBES = [
  { x: -0.18, y: 0.34, rx: 0.21, ry: 0.07 },
  { x: 0.12, y: 0.38, rx: 0.24, ry: 0.075 },
  { x: -0.02, y: 0.27, rx: 0.17, ry: 0.065 },
  { x: 0.31, y: 0.3, rx: 0.13, ry: 0.055 },
] as const;

/**
 * Broad blades. Six, large and unevenly distributed, two of them behind the mast
 * so the mass has depth. None is a clean spade: each is torn along one flank and
 * bitten out of the other, and `blightBias` decides which ones die first so the
 * poison arrives as a spreading blotch rather than a global tint.
 */
interface BroadLeaf {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly length: number;
  readonly width: number;
  readonly behindMast: boolean;
  readonly blightBias: number;
  readonly curl: number;
  readonly biteAt: number;
  readonly biteDepth: number;
  readonly tearFrom: number;
  readonly tearDepth: number;
}
const BROAD_LEAVES: readonly BroadLeaf[] = [
  {
    x: -0.16,
    y: -1.05,
    angle: 3.3,
    length: 0.46,
    width: 0.16,
    behindMast: true,
    blightBias: 0.9,
    curl: 0.45,
    biteAt: 0.62,
    biteDepth: 0.7,
    tearFrom: 0.4,
    tearDepth: 0.3,
  },
  {
    x: 0.14,
    y: -1.22,
    angle: -0.35,
    length: 0.34,
    width: 0.12,
    behindMast: true,
    blightBias: 0.5,
    curl: 0.15,
    biteAt: 0.45,
    biteDepth: 0.25,
    tearFrom: 0.55,
    tearDepth: 0.45,
  },
  {
    x: -0.26,
    y: -0.62,
    angle: 2.55,
    length: 0.56,
    width: 0.21,
    behindMast: false,
    blightBias: 0.2,
    curl: 0.6,
    biteAt: 0.35,
    biteDepth: 0.55,
    tearFrom: 0.3,
    tearDepth: 0.22,
  },
  {
    x: 0.24,
    y: -0.78,
    angle: 0.45,
    length: 0.5,
    width: 0.18,
    behindMast: false,
    blightBias: 0.75,
    curl: 0.3,
    biteAt: 0.7,
    biteDepth: 0.8,
    tearFrom: 0.45,
    tearDepth: 0.5,
  },
  {
    x: 0.3,
    y: -0.2,
    angle: 0.85,
    length: 0.52,
    width: 0.19,
    behindMast: false,
    blightBias: 0.35,
    curl: 0.5,
    biteAt: 0.5,
    biteDepth: 0.3,
    tearFrom: 0.6,
    tearDepth: 0.35,
  },
  {
    x: -0.44,
    y: -0.68,
    angle: 2.35,
    length: 0.44,
    width: 0.15,
    behindMast: false,
    blightBias: 1.0,
    curl: 0.7,
    biteAt: 0.55,
    biteDepth: 0.65,
    tearFrom: 0.35,
    tearDepth: 0.55,
  },
];
/** The leaf silhouette is a spade, not an ellipse: an ellipse at 32 px reads as a pebble. */
const LEAF_SHOULDER_AT = 0.42;
/** Below this the torn flank smooths back into a clean curve. */
const LEAF_OUTLINE_SAMPLES = 20;
const LEAF_SHOULDER_RISE_POWER = 0.55;
const LEAF_POINT_FALL_POWER = 0.9;
/** How far the tip falls below the leaf's own axis, as a fraction of its length. */
const LEAF_TIP_DROOP = 0.16;
/** A curled blade drops harder and hides the far flank; both together are what "curled" looks like flat-on. */
const LEAF_CURL_DROOP_GAIN = 1.6;
const LEAF_CURL_FLANK_LOSS = 0.42;
/**
 * Two or three deep notches down the torn flank, not a fine ripple. A high
 * frequency is invisible at tile size and reads as a slightly furry edge when
 * you zoom in, which is worse than a clean one.
 */
const LEAF_TEAR_FREQUENCY = 9.0;
const LEAF_BITE_SPREAD = 0.16;
const LEAF_MIDRIB_WIDTH = 0.028;
const LEAF_RIM_WIDTH = 0.026;
/** A fully blighted blade still keeps some of its own colour; a black leaf reads as a hole. */
const LEAF_BLIGHT_CEILING = 0.72;
/** The same ceiling for the swollen organs; a black pitcher reads as a gap in the sprite. */
const ORGAN_BLIGHT_CEILING = 0.48;
const LEAF_SAG_ANGLE = 0.62;
const LEAF_SWAY_AMP = 0.05;
const LEAF_SWAY_SPEED = 0.021;
/**
 * A blighted blade rolls up on itself as it dries. Curl is what wilt looks like
 * in the silhouette — a blade that only changes colour is still being held out,
 * and a plant holding its leaves out is not a plant that is dying.
 */
const LEAF_BLIGHT_CURL = 0.5;
/** Necrosis lands as blotches with soft edges rather than a wash, so it reads as spreading. */
const LEAF_BLOTCH_COUNT = 3;
const LEAF_BLOTCH_ALPHA = 0.72;
const LEAF_EDGE_BROWNING_ALPHA = 0.9;
/** The browned margin has to be several times the rim line or it disappears under it. */
const LEAF_EDGE_BROWNING_WIDTH_SCALE = 4;

/**
 * Swollen seed pods. Four, and no two remotely the same size: one enormous and
 * split open, one collapsed and empty, and two small. Even ovoids in a narrow
 * size range read as olives, which is the single fastest way to make a
 * pestilence look like a vegetable patch.
 */
interface SeedPod {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly tilt: number;
  /** Seeds the lumpy outline, so the same pod is malformed the same way every frame. */
  readonly lumpSeed: number;
  /** 0..1 — how far the husk has burst open and started weeping. */
  readonly split: number;
  /** 0..1 — how far one flank has caved in on a spent pod. */
  readonly collapsed: number;
}
const SEED_PODS: readonly SeedPod[] = [
  { x: 0.02, y: -0.3, radius: 0.185, tilt: -0.32, lumpSeed: 1.7, split: 0.9, collapsed: 0.0 },
  { x: 0.36, y: -0.5, radius: 0.075, tilt: 0.3, lumpSeed: 4.1, split: 0.0, collapsed: 0.15 },
  { x: -0.3, y: -0.16, radius: 0.115, tilt: 0.12, lumpSeed: 8.9, split: 0.25, collapsed: 0.7 },
  { x: 0.18, y: -0.86, radius: 0.05, tilt: 0.6, lumpSeed: 6.3, split: 0.0, collapsed: 0.0 },
];
/** Pods hang longer than they are wide; a round one is a berry, and a berry is a decoration. */
const POD_ASPECT = 1.45;
const POD_OUTLINE_POINTS = 16;
/** Two beats of lump at different frequencies; one alone comes out as a regular scallop. */
const POD_LUMP_COARSE = 0.2;
const POD_LUMP_FINE = 0.11;
const POD_LUMP_COARSE_WAVES = 3;
const POD_LUMP_FINE_WAVES = 5;
const POD_COLLAPSE_DEPTH = 0.55;
const POD_BREATHE_SPEED = 0.029;
const POD_BREATHE_AMP = 0.09;
/** Each limb's own offset into its cycle; an irrational step keeps them from ever beating together. */
const LIMB_PHASE_STAGGER = 1.317;
const POD_HIGHLIGHT_OFFSET = 0.42;
const POD_HIGHLIGHT_SCALE = 0.26;
/** How far the shaded flank sits off centre, and how much of the husk it covers. */
const POD_SHADE_OFFSET = 0.42;
const POD_SHADE_SCALE = 0.78;
const POD_SHADE_DEPTH = 0.8;
/** A specular that reaches the rim value reads as a bean; the sheen stays part-way back to the skin. */
const POD_SHEEN_RESTRAINT = 0.35;
const POD_OUTLINE_WIDTH = 0.09;
/** The woody calyx the pod hangs from — without it a pod is an egg lying on the vine. */
const POD_CALYX_SCALE = 0.42;
const POD_CALYX_ASPECT = 0.5;
/** A blighted pod shrivels as well as darkening; colour alone reads as a lighting change. */
const POD_SHRIVEL = 0.24;
const POD_SPLIT_WIDTH = 0.55;
const POD_SPLIT_LENGTH = 0.82;
/** The weep runs out of the split and hangs; it lengthens as the sickness takes hold. */
const POD_WEEP_LENGTH = 0.6;
const POD_WEEP_POISON_GAIN = 1.1;
const POD_WEEP_WIDTH = 0.16;
const POD_WEEP_BEAD_SCALE = 0.32;

/**
 * Ropy tendrils. Three, of three very different weights, each ending in a spiral
 * curl — the curl is the single most legible "vine" cue on the whole figure.
 *
 * Every field here exists to stop the limb reading as plumbing. A run of even
 * width between two points is a pipe; a spiral of even width on the end of it is
 * a fitting, and the heavy one is the largest shape in the silhouette, so that
 * one mistake decided how the whole figure read.
 */
interface Tendril {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly length: number;
  /** Width where the limb leaves the mass. It keeps almost none of this by the tip. */
  readonly width: number;
  /**
   * Lateral offsets partway along the run, of opposite sign, so the limb has a
   * shoulder, an elbow and a wrist instead of a straight axis.
   */
  readonly shoulderBend: number;
  readonly wristBend: number;
  /**
   * Extra thickness at the very root. A limb is fattest where it grows out of
   * something, and the swell also reads as the joint turning toward the viewer,
   * which is as close to a second plane as a flat draw can get.
   */
  readonly shoulderSwell: number;
  readonly curlTurns: number;
  readonly curlSide: number;
  readonly swayOffset: number;
  readonly curlRadius: number;
  /** How far the tip's spiral opens and closes over the idle cycle. */
  readonly unfurl: number;
}
/**
 * The heavy one comes first and is drawn last: it is a limb, not a wisp — thicker
 * at the root than the second helix, reaching down and forward out of the mass
 * toward whoever is standing in front of him, and slowly opening and closing its
 * curl. It is the whole reason the figure reads as aware rather than as scenery.
 */
const TENDRILS: readonly Tendril[] = [
  {
    x: 0.28,
    y: -0.2,
    dirX: 0.78,
    dirY: 0.63,
    length: 1.0,
    width: 0.185,
    shoulderBend: 0.115,
    wristBend: -0.062,
    shoulderSwell: 0.34,
    curlTurns: 2.2,
    curlSide: 1,
    swayOffset: 0.0,
    curlRadius: 0.115,
    unfurl: 0.3,
  },
  {
    x: -0.38,
    y: -0.5,
    dirX: -0.72,
    dirY: 0.69,
    length: 0.54,
    width: 0.075,
    shoulderBend: 0.062,
    wristBend: -0.034,
    shoulderSwell: 0.26,
    curlTurns: 1.6,
    curlSide: -1,
    swayOffset: 2.1,
    curlRadius: 0.075,
    unfurl: 0.12,
  },
  {
    x: -0.22,
    y: -0.95,
    dirX: -0.62,
    dirY: 0.71,
    length: 0.36,
    width: 0.045,
    shoulderBend: -0.042,
    wristBend: 0.024,
    shoulderSwell: 0.2,
    curlTurns: 2.0,
    curlSide: -1,
    swayOffset: 1.2,
    curlRadius: 0.05,
    unfurl: 0.2,
  },
];
/** Split in two so the spiral gets its own sample budget: at these turn counts a shared one polygonises it. */
const TENDRIL_RUN_SEGMENTS = 26;
const TENDRIL_CURL_SEGMENTS = 26;
/** Fraction of the run that is straight before the spiral begins. */
const TENDRIL_CURL_AT = 0.55;
/** The spiral closes as it turns; without this it is a circle stuck on a stick. */
const TENDRIL_CURL_TIGHTEN = 0.88;
const TENDRIL_SWAY_AMP = 0.03;
const TENDRIL_SWAY_SPEED = 0.023;
const TENDRIL_UNFURL_SPEED = 0.013;
const TENDRIL_SAG_DROP = 0.18;
/** What survives of the root width at the far end of the curl — nearly nothing. */
const TENDRIL_TIP_WIDTH_FRACTION = 0.09;
/** Above 1 the limb keeps its mass near the root and collapses through the curl, which is what a tendril does. */
const TENDRIL_TAPER_POWER = 1.25;
const TENDRIL_SHOULDER_SPREAD = 0.3;
/**
 * Growth nodes. A vine pinches where a leaf once left it; an extruded tube has
 * nothing anywhere along its length, and the eye reads that as manufacture.
 */
const TENDRIL_NODE_STATIONS: readonly number[] = [0.17, 0.4];
const TENDRIL_NODE_PINCH = 0.22;
const TENDRIL_NODE_SPREAD = 0.045;
const TENDRIL_NODE_LINE_FRACTION = 0.12;
/**
 * The node creases the shaded flank and dies out before the lit one. Run all the
 * way across at the recess value it is a black bar over a tube, which is a pipe
 * coupling — the exact read the whole rework exists to kill.
 */
const TENDRIL_NODE_FROM_FRACTION = -0.1;
const TENDRIL_NODE_TO_FRACTION = 0.78;

/**
 * The pitcher: a hanging trap where the mass is densest, on the left only. It is
 * the one organ big enough to be the figure's focal point, and it is deliberately
 * unpaired — a second one on the right would rebuild the two-armed silhouette
 * this rewrite exists to destroy.
 */
const PITCHER_HANG_X = -0.44;
const PITCHER_HANG_Y = -0.66;
const PITCHER_MOUTH_X = -0.62;
const PITCHER_MOUTH_Y = -0.34;
const PITCHER_MOUTH_RX = 0.13;
/** A pinched waist under the flared rim; without it the trap is a barrel. */
const PITCHER_WAIST_RX = 0.07;
const PITCHER_WAIST_Y = -0.17;
const PITCHER_BELLY_RX = 0.185;
const PITCHER_BELLY_Y = 0.04;
const PITCHER_BASE_Y = 0.24;
const PITCHER_BASE_RX = 0.04;
const PITCHER_PEDUNCLE_WIDTH = 0.04;
const PITCHER_RIM_RY = 0.038;
const PITCHER_THROAT_SCALE = 0.72;
/** The lid is a blade, not a disc: a disc over the mouth reads as a lid on a jar. */
const PITCHER_LID_LENGTH = 0.24;
const PITCHER_LID_WIDTH = 0.08;
const PITCHER_LID_ANGLE = -2.3;
const PITCHER_SWAY_AMP = 0.016;
const PITCHER_SWAY_SPEED = 0.019;
/** Two ribs bowing with the belly. Round blotches were tried and read as drilled holes; straight ribs read as barrel staves. */
const PITCHER_RIB_OFFSETS: readonly number[] = [-0.06, 0.045];
const PITCHER_RIB_WIDTH = 0.016;
const PITCHER_RIB_BOW = 1.45;
/** The shaded flank of the trap, so a fat organ does not read as a flat paper cut-out. */
const PITCHER_SHADE_FRACTION = 0.42;
/** Bleached out by the necrosis the trap lands within a hair of the sawdust's own value; the outline is what keeps its silhouette. */
const PITCHER_OUTLINE_WIDTH = 0.014;

/**
 * Necrotic patches over the piled wraps — dead tissue in living wood. They are
 * kept well inside the mass on purpose: a patch that reaches the silhouette is a
 * pale ellipse lying on the sawdust, and a translucent oval sitting over a plant
 * reads as a lens flare rather than as rot.
 */
const NECROTIC_BLOTCHES = [
  { x: -0.17, y: -0.42, rx: 0.14, ry: 0.075, lumpSeed: 2.3 },
  { x: 0.14, y: -0.2, rx: 0.16, ry: 0.085, lumpSeed: 5.6 },
  { x: -0.04, y: 0.02, rx: 0.11, ry: 0.06, lumpSeed: 9.4 },
  { x: 0.23, y: -0.57, rx: 0.085, ry: 0.055, lumpSeed: 3.1 },
  { x: -0.06, y: 0.19, rx: 0.15, ry: 0.07, lumpSeed: 7.2 },
] as const;
/** A rot patch has a ragged margin; a clean ellipse is always an overlay. */
const BLOTCH_OUTLINE_POINTS = 18;
const BLOTCH_LUMP_COARSE = 0.24;
const BLOTCH_LUMP_FINE = 0.14;
const BLOTCH_LUMP_COARSE_WAVES = 3;
const BLOTCH_LUMP_FINE_WAVES = 7;
const NECROSIS_ALPHA = 0.55;
/** A bleached core inside a chlorotic ring: the two-tone is what separates rot from shadow. */
const NECROSIS_CORE_SCALE = 0.55;

/** Spore motes drifting over the mass while the poison still holds him. */
const SPORE_COUNT = 7;
const SPORE_R = 0.016;
const SPORE_DRIFT_SPEED = 0.011;
const SPORE_ORBIT_RX = 0.52;
const SPORE_ORBIT_RY = 0.28;
/** An irrational vertical frequency keeps the ring from resolving into a flat oval. */
const SPORE_BOB_FREQ = 1.31;
const SPORE_ALPHA = 0.55;

/** Cure flourish — a warm bloom, a corolla opening out of the pitcher, and motes rising off it. */
const CURE_BLOOM_RADIUS = 0.62;
const CURE_BLOOM_RY_SCALE = 1.3;
const CURE_BLOOM_ALPHA = 0.34;
const CURE_LIFT = 0.06;
const COROLLA_PETAL_COUNT = 7;
const COROLLA_LENGTH = 0.24;
const COROLLA_WIDTH = 0.08;
/** The corolla is seen from above the rim, so its ring squashes vertically. */
const COROLLA_FLATTEN = 0.45;
const COROLLA_TURN = 0.4;
const COROLLA_HEART_R = 0.06;
const CURE_MOTE_COUNT = 9;
const CURE_MOTE_R = 0.014;
const CURE_MOTE_RISE_SPEED = 0.0055;
/** The motes stay inside the foliage: a sparkle that climbs past the topmost leaf drags the whole nameplate clearance up with it. */
const CURE_MOTE_RISE_SPAN = 0.78;
const CURE_MOTE_SPREAD = 0.42;
const CURE_MOTE_WAVES = 2.7;
const CURE_MOTE_ALPHA = 0.75;

/** Sag pulls the whole figure down as well as bending it. */
const SAG_BODY_DROP = 0.14;

/** How far the poison, the cure and a refused blow push the palette off healthy wood and leaf. */
const POISON_MIX_STRENGTH = 0.9;
const CURE_MIX_STRENGTH = 0.28;
const REFUSAL_FLARE_STRENGTH = 0.55;
/** How far the lit edge bleaches out as the poison takes hold. */
const RIM_BLEACHING = 0.6;
/** The colour a sun-facing edge goes once there is no chlorophyll left in it. */
const BLEACHED_EDGE = '#e2d5a4';
/**
 * Below this brightness a colour is a recess and the necrosis leaves it alone.
 * Bleaching everything lifts the near-blacks that carry the form and the sick
 * figure comes out *lighter overall* than the healthy one, which reads as better
 * lighting rather than as disease.
 */
const NECROSIS_SHADOW_FLOOR = 0.16;
/**
 * Below 1 this bends the bleach curve toward the midtones, which is where most
 * of his surface area lives. Left linear, the ropes that carry the lower half of
 * the silhouette barely change and the sickness never leaves the foliage.
 */
const NECROSIS_BLEACH_CURVE = 0.6;
/** Shaded flanks of the organs bleach far less than their lit faces, for the same reason. */
const ORGAN_SHADE_ROT_RESTRAINT = 0.28;

/**
 * Alphas below this round to nothing and the draw is skipped entirely: an
 * `rgba()` built from a very small float serialises in exponent notation
 * (`5e-17`), which node-canvas rejects outright, taking the whole colour with it.
 */
const MIN_VISIBLE_ALPHA = 0.004;
const ALPHA_DECIMALS = 3;

/**
 * The value range is the whole fight at a 32 px tile. Shadow to rim spans nearly
 * the full available range on purpose: a tasteful mid-green ramp merges every
 * rope, blade and pod into one silhouette the moment the sprite is drawn small.
 */
const LEAF_SHADOW = '#0d1a07';
const LEAF_DARK = '#22441a';
const LEAF_MID = '#54873f';
const LEAF_PALE = '#b3dd8c';
const WOOD_SHADOW = '#080e04';
const WOOD_DARK = '#1b2a10';
const WOOD_MID = '#4b5d2b';
/** The rim value. A mass this dark against the big top's tan sawdust still needs an edge, or the coils merge into one blob. */
const WOOD_LIT = '#cbd77f';
const POD_COLOR = '#6d7a34';
const POD_LIT = '#d5e08c';
const PITCHER_COLOR = '#606a30';
/** The peristome runs warm against the olive trap — the one colour on him that says carnivore. */
const PITCHER_LIT = '#d2853f';
const THORN_COLOR = '#0d1505';
const MAST_COLOR = '#6b4d2c';
const MAST_GRAIN = '#3b2a19';
const MAST_HIGHLIGHT = '#9a7449';
const MAST_SPLINTER_COLOR = '#c3a173';
/**
 * Dying plant matter goes *pale*, not dark: it loses its chlorophyll and bleaches
 * out to a jaundiced yellow-grey. Earlier passes tinted toward a darker olive and
 * the sick figure only ever read as the healthy one standing in shadow.
 */
const POISON_TINT = '#8f8a45';
/**
 * Dead tissue, and the chlorotic yellow that eats into the living green ahead of
 * it. The core is the *palest* value in a blotch and the halo sits between it and
 * the leaf: a dark core is a hole in the sprite, which is what shadow looks like.
 */
const NECROSIS_COLOR = '#c6b98a';
const NECROTIC_BLOOM = '#b0a13c';
/** Die-back starts at a margin, and a margin really does brown while the middle bleaches. */
const BROWNED_EDGE = '#6d431a';
/** Pods weep something the colour of infection, not sap. */
const WEEP_COLOR = '#b9b361';
const CURE_TINT = '#ffe9a8';
const REFUSAL_FLARE = '#ffffff';
const SPORE_COLOR = '#c8f096';
const CURE_BLOOM_COLOR = '#ffdf92';
const COROLLA_COLOR = '#ffe9a0';
const COROLLA_HEART_COLOR = '#fffbe6';

const HEX_RADIX = 16;
const HEX_PAIR_LENGTH = 2;
const CHANNEL_MAX = 255;
const FULL_CIRCLE = Math.PI * 2;
const HALF_CIRCLE = Math.PI;
const MIN_STROKE_PX = 1;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function parseHex(hex: string): Rgb {
  const digits = hex.replace('#', '');
  return {
    r: Number.parseInt(digits.slice(0, HEX_PAIR_LENGTH), HEX_RADIX),
    g: Number.parseInt(digits.slice(HEX_PAIR_LENGTH, HEX_PAIR_LENGTH * 2), HEX_RADIX),
    b: Number.parseInt(digits.slice(HEX_PAIR_LENGTH * 2, HEX_PAIR_LENGTH * 3), HEX_RADIX),
  };
}

function toHex(channel: number): string {
  const clamped = Math.max(0, Math.min(CHANNEL_MAX, Math.round(channel)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR_LENGTH, '0');
}

function mixColor(from: string, to: string, amount: number): string {
  if (amount <= 0) return from;
  const a = parseHex(from);
  const b = parseHex(to);
  const t = Math.min(1, amount);
  return `#${toHex(a.r + (b.r - a.r) * t)}${toHex(a.g + (b.g - a.g) * t)}${toHex(a.b + (b.b - a.b) * t)}`;
}

const LUMINANCE_RED = 0.299;
const LUMINANCE_GREEN = 0.587;
const LUMINANCE_BLUE = 0.114;

/** 0..1 brightness of a colour, used to keep a tint off the values that carry the form. */
function luminanceOf(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (r * LUMINANCE_RED + g * LUMINANCE_GREEN + b * LUMINANCE_BLUE) / CHANNEL_MAX;
}

/**
 * How much of a colour the necrosis is allowed to bleach. Lit and midtone
 * surfaces go pale and yellow; anything already at or under
 * {@link NECROSIS_SHADOW_FLOOR} is a recess and keeps its value, because the
 * recesses are what separate one rope from the next at a 32 px tile.
 */
function bleachableFraction(base: string): number {
  const aboveFloor = clamp01(
    (luminanceOf(base) - NECROSIS_SHADOW_FLOOR) / (1 - NECROSIS_SHADOW_FLOOR),
  );
  return Math.pow(aboveFloor, NECROSIS_BLEACH_CURVE);
}

/** `rgba()` with a fixed-decimal alpha, so a tiny value can never serialise as an exponent. */
function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha).toFixed(ALPHA_DECIMALS)})`;
}

function isVisible(alpha: number): boolean {
  return alpha >= MIN_VISIBLE_ALPHA;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * A repeatable −1..1 wobble for a given seed and index. Deformity has to be
 * baked into the shape rather than rolled per frame, or the whole plant boils.
 */
const NOISE_SEED_SCALE = 12.9898;
const NOISE_INDEX_SCALE = 78.233;
function lumpNoise(seed: number, index: number): number {
  return Math.sin(seed * NOISE_SEED_SCALE + index * NOISE_INDEX_SCALE);
}

/**
 * How far the main stem has moved at a given height, under the lean it carries
 * always and the sag the poison adds. Everything the plant carries — blades,
 * pods, tendrils, the pitcher — rides this, because anything that leans or
 * slumps on its own clock drifts off the stem it grows from and ends up floating
 * in open air next to the plant.
 */
function stemOffsetAt(y: number, sag: number): { readonly dx: number; readonly dy: number } {
  const alongStem = clamp01((y - MAIN_COIL.baseY) / (MAIN_COIL.topY - MAIN_COIL.baseY));
  const leverage = alongStem * alongStem;
  return {
    dx: MASS_LEAN_X * leverage + sag * COIL_SAG_BOW * leverage,
    dy: sag * (SAG_BODY_DROP + COIL_SAG_DROP * alongStem),
  };
}

interface Palette {
  readonly leafShadow: string;
  readonly leafDark: string;
  readonly leafMid: string;
  readonly leafPale: string;
  readonly woodShadow: string;
  readonly woodDark: string;
  readonly woodMid: string;
  readonly woodLit: string;
  readonly pod: string;
  readonly podLit: string;
  readonly pitcher: string;
  readonly pitcherLit: string;
  readonly thorn: string;
}

/**
 * The tint is baked into the fill colours rather than composited over the
 * finished silhouette: a `source-atop` pass inside a sprite draw would clip
 * against the whole world canvas underneath it, and the shared silhouette
 * compositor refuses to nest, so the paint would be dropped exactly when a
 * status effect was already compositing him.
 */
function buildPalette(poison: number, cure: number, flare: number): Palette {
  const sickly = (base: string) =>
    mixColor(base, POISON_TINT, poison * POISON_MIX_STRENGTH * bleachableFraction(base));
  const blessed = (base: string) => mixColor(base, CURE_TINT, cure * CURE_MIX_STRENGTH);
  const refused = (base: string) => mixColor(base, REFUSAL_FLARE, flare);
  const shift = (base: string) => refused(blessed(sickly(base)));
  // A dying rope loses its colour first along the edge that catches the light, so
  // the one hot green line on the whole figure is also the first thing to go
  // chalky. It stays bright: bone is bright, and dimming it here was most of why
  // the sick state read as a lighting change.
  const litEdge = refused(
    blessed(mixColor(sickly(WOOD_LIT), BLEACHED_EDGE, poison * RIM_BLEACHING)),
  );
  return {
    leafShadow: shift(LEAF_SHADOW),
    leafDark: shift(LEAF_DARK),
    leafMid: shift(LEAF_MID),
    leafPale: shift(LEAF_PALE),
    woodShadow: shift(WOOD_SHADOW),
    woodDark: shift(WOOD_DARK),
    woodMid: shift(WOOD_MID),
    woodLit: litEdge,
    pod: shift(POD_COLOR),
    podLit: shift(POD_LIT),
    pitcher: shift(PITCHER_COLOR),
    pitcherLit: shift(PITCHER_LIT),
    thorn: shift(THORN_COLOR),
  };
}

/** Half the pole's surviving width at a height, once every wrap has bitten into it. */
function mastHalfWidthsAt(y: number): { readonly left: number; readonly right: number } {
  let left = MAST_HALF_WIDTH;
  let right = MAST_HALF_WIDTH;
  for (const bite of MAST_BITES) {
    const fromBite = (y - bite.y) / bite.span;
    const closeness = Math.exp(-fromBite * fromBite);
    left -= MAST_HALF_WIDTH * bite.leftDepth * closeness;
    right -= MAST_HALF_WIDTH * bite.rightDepth * closeness;
  }
  return { left, right };
}

/** How far the crushed pole's centre line has been pushed off true at a height. */
function mastCentreAt(y: number): number {
  let centre = 0;
  for (const bite of MAST_BITES) {
    const fromBite = (y - bite.y) / bite.span;
    centre += bite.kink * Math.exp(-fromBite * fromBite);
  }
  return centre;
}

/**
 * Fill a vertical band of the pole, given as signed fractions of its half-width
 * at each height. Every band follows the same bitten profile, so a highlight
 * cannot slide off the pole where a wrap has crushed it.
 */
function fillMastBand(
  ctx: CanvasRenderingContext2D,
  gs: number,
  fromFraction: number,
  toFraction: number,
  color: string,
) {
  const edgeAt = (y: number, fraction: number) => {
    const { left, right } = mastHalfWidthsAt(y);
    const halfWidth = fraction < 0 ? left : right;
    return (mastCentreAt(y) + fraction * halfWidth) * gs;
  };
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let step = 0; step <= MAST_PROFILE_STEPS; step++) {
    const y = lerp(MAST_TOP_Y, MAST_BASE_Y, step / MAST_PROFILE_STEPS);
    const px = edgeAt(y, fromFraction);
    if (step === 0) ctx.moveTo(px, y * gs);
    else ctx.lineTo(px, y * gs);
  }
  for (let step = MAST_PROFILE_STEPS; step >= 0; step--) {
    const y = lerp(MAST_TOP_Y, MAST_BASE_Y, step / MAST_PROFILE_STEPS);
    ctx.lineTo(edgeAt(y, toFraction), y * gs);
  }
  ctx.closePath();
  ctx.fill();
}

function drawMast(ctx: CanvasRenderingContext2D, gs: number) {
  fillMastBand(ctx, gs, -1, 1, MAST_COLOR);
  fillMastBand(ctx, gs, MAST_HIGHLIGHT_FROM, MAST_HIGHLIGHT_TO, MAST_HIGHLIGHT);
  fillMastBand(ctx, gs, MAST_SHADE_FROM, MAST_SHADE_TO, MAST_GRAIN);

  ctx.lineCap = 'butt';
  for (const splinter of MAST_SPLINTERS) {
    const { left, right } = mastHalfWidthsAt(splinter.y);
    const edge = mastCentreAt(splinter.y) + splinter.side * (splinter.side < 0 ? left : right);
    ctx.strokeStyle = splinter.rise > 0 ? MAST_SPLINTER_COLOR : MAST_GRAIN;
    ctx.lineWidth = Math.max(MIN_STROKE_PX, splinter.width * gs);
    ctx.beginPath();
    ctx.moveTo(edge * gs, splinter.y * gs);
    ctx.lineTo((edge + splinter.side * splinter.length) * gs, (splinter.y + splinter.rise) * gs);
    ctx.stroke();
  }
}

/**
 * How far to shift a narrow band so it lands on a rope's edge rather than
 * somewhere across its face. A fixed offset does this correctly for exactly one
 * thickness; on a rope four times that, the same offset paints a bright stripe
 * down the middle and the whole plant turns into garden hose.
 *
 * The offset is spent equally on x and y, so the light stays at a constant
 * up-and-left angle across every part of him.
 */
function edgeBandLift(strokeWidth: number, bandFraction: number): number {
  return (strokeWidth * (1 - bandFraction)) / (2 * Math.SQRT2);
}

interface CoilPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly inFront: boolean;
}

function coilPointAt(coil: CoilSpec, t: number, gs: number, phase: number, sag: number): CoilPoint {
  const turnAngle = coil.phaseOffset + t * coil.turns * FULL_CIRCLE;
  const distanceFromSwell = (t - coil.swellAt) / coil.swellSpread;
  const swell = Math.exp(-distanceFromSwell * distanceFromSwell);
  const radius = lerp(coil.baseRadius, coil.topRadius, t) + coil.swellRadius * swell;
  const width = lerp(coil.baseWidth, coil.topWidth, t) + coil.swellWidth * swell;
  const creep = Math.sin(phase * COIL_CREEP_SPEED + t * COIL_CREEP_WAVES) * COIL_CREEP_AMP * t;
  const stemY = lerp(coil.baseY, coil.topY, t);
  const slump = stemOffsetAt(stemY, sag);
  return {
    x: (Math.sin(turnAngle) * radius + creep + slump.dx) * gs,
    y: (stemY + slump.dy) * gs,
    width: width * gs,
    // The near half of every turn passes in front of the mast; the far half goes
    // behind it, and that alternation is what makes the wrap read as gripping
    // rather than as a squiggle painted on top of a pole.
    inFront: Math.cos(turnAngle) > 0,
  };
}

/**
 * Stroke one half of a helix. Called twice per run with `wantFront` flipped, so
 * the far half can be laid down before the mast and the near half after it.
 */
function drawCoilHalf(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  palette: Palette,
  coil: CoilSpec,
  wantFront: boolean,
) {
  ctx.lineCap = 'round';
  const segmentCount = Math.max(1, Math.round(coil.turns * COIL_SEGMENTS_PER_TURN));
  const points: CoilPoint[] = [];
  for (let seg = 0; seg <= segmentCount; seg++) {
    points.push(coilPointAt(coil, seg / segmentCount, gs, phase, sag));
  }

  // Body first for the whole run, rim second. Interleaving them lets each
  // segment's body paint over the previous segment's rim, and the highlight
  // comes out as a row of dashes down the coil.
  const strokeRun = (
    color: string,
    widthOf: (point: CoilPoint) => number,
    liftOf: (point: CoilPoint) => number,
  ) => {
    ctx.strokeStyle = color;
    for (let seg = 1; seg <= segmentCount; seg++) {
      const point = points[seg];
      if (point.inFront !== wantFront) continue;
      const previous = points[seg - 1];
      const lift = liftOf(point);
      ctx.lineWidth = Math.max(MIN_STROKE_PX, widthOf(point));
      ctx.beginPath();
      ctx.moveTo(previous.x - lift, previous.y - lift);
      ctx.lineTo(point.x - lift, point.y - lift);
      ctx.stroke();
    }
  };

  // The far half is one step down from the body rather than the deepest value on
  // him. The front/back split is the largest value break on the figure and the
  // main reason a wrap reads as a wrap at tile size — but at these thicknesses a
  // pure-black back half piles into a heap of black boulders at the base and
  // swallows the roots behind it.
  if (!wantFront) {
    strokeRun(
      palette.woodShadow,
      (point) => point.width * (1 + COIL_BACKING_OUTLINE),
      () => 0,
    );
    strokeRun(
      palette.woodDark,
      (point) => point.width,
      () => 0,
    );
    return;
  }

  strokeRun(
    palette.woodShadow,
    (point) => point.width * (1 + COIL_SHADE_WIDTH_FRACTION),
    (point) => -edgeBandLift(point.width, COIL_SHADE_WIDTH_FRACTION),
  );
  strokeRun(
    palette.woodMid,
    (point) => point.width,
    () => 0,
  );
  strokeRun(
    palette.woodDark,
    (point) => point.width * COIL_SHADE_WIDTH_FRACTION,
    (point) => -edgeBandLift(point.width, COIL_SHADE_WIDTH_FRACTION),
  );
  if (coil.rimLit) {
    strokeRun(
      palette.woodLit,
      (point) => point.width * COIL_RIM_WIDTH_FRACTION,
      (point) => edgeBandLift(point.width, COIL_RIM_WIDTH_FRACTION),
    );
  }
}

function drawRecessPockets(
  ctx: CanvasRenderingContext2D,
  gs: number,
  sag: number,
  palette: Palette,
) {
  ctx.fillStyle = palette.woodShadow;
  for (const pocket of RECESS_POCKETS) {
    const slump = stemOffsetAt(pocket.y, sag);
    ctx.beginPath();
    ctx.ellipse(
      (pocket.x + slump.dx) * gs,
      (pocket.y + slump.dy) * gs,
      pocket.rx * gs,
      pocket.ry * gs,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
}

function drawTangleLoops(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  palette: Palette,
) {
  ctx.lineCap = 'round';
  const creep = Math.sin(phase * COIL_CREEP_SPEED) * COIL_CREEP_AMP * gs;
  for (let index = 0; index < TANGLE_LOOPS.length; index++) {
    const loop = TANGLE_LOOPS[index];
    const slump = stemOffsetAt(loop.y, sag);
    const centreX = (loop.x + slump.dx) * gs + creep;
    const centreY = (loop.y + slump.dy) * gs;
    const strokeLoop = (color: string, width: number, lift: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(MIN_STROKE_PX, width);
      ctx.beginPath();
      ctx.ellipse(
        centreX - lift,
        centreY - lift,
        loop.rx * gs,
        loop.ry * gs,
        loop.tilt,
        loop.fromAngle,
        loop.toAngle,
      );
      ctx.stroke();
    };
    const bodyWidth = loop.width * gs;
    strokeLoop(
      palette.woodShadow,
      bodyWidth * (1 + COIL_SHADE_WIDTH_FRACTION),
      -edgeBandLift(bodyWidth, COIL_SHADE_WIDTH_FRACTION),
    );
    strokeLoop(index % 2 === 0 ? palette.woodMid : palette.woodDark, bodyWidth, 0);
    strokeLoop(
      palette.woodLit,
      bodyWidth * COIL_RIM_WIDTH_FRACTION,
      edgeBandLift(bodyWidth, COIL_RIM_WIDTH_FRACTION),
    );
  }
}

function drawRootPlate(ctx: CanvasRenderingContext2D, gs: number, palette: Palette) {
  for (const lobe of ROOT_PLATE_LOBES) {
    // The plate's own cast shadow, then the plate: filled at the recess value it
    // came out as a row of black boulders sitting under the plant.
    ctx.fillStyle = palette.woodShadow;
    ctx.beginPath();
    ctx.ellipse(
      lobe.x * gs,
      (lobe.y + ROOT_PLATE_SHADOW_DROP) * gs,
      lobe.rx * gs,
      lobe.ry * gs,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();

    ctx.fillStyle = palette.woodDark;
    ctx.beginPath();
    ctx.ellipse(lobe.x * gs, lobe.y * gs, lobe.rx * gs, lobe.ry * gs, 0, 0, FULL_CIRCLE);
    ctx.fill();

    ctx.strokeStyle = palette.woodMid;
    ctx.lineWidth = Math.max(MIN_STROKE_PX, lobe.ry * COIL_RIM_WIDTH_FRACTION * gs);
    ctx.beginPath();
    ctx.ellipse(
      lobe.x * gs,
      lobe.y * gs,
      lobe.rx * gs,
      lobe.ry * gs,
      0,
      HALF_CIRCLE + WRAP_ARC_INSET,
      FULL_CIRCLE - WRAP_ARC_INSET,
    );
    ctx.stroke();
  }
}

function drawRootLimbs(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  palette: Palette,
) {
  ctx.lineCap = 'round';
  for (let index = 0; index < ROOT_LIMBS.length; index++) {
    const root = ROOT_LIMBS[index];
    const outward = Math.cos(root.angle) * (1 + sag * ROOT_SAG_SPLAY);
    const downward = ROOT_DROP_BASE + ROOT_DROP_SPREAD * Math.sin(root.angle) + sag * ROOT_SAG_DROP;

    const originX = Math.cos(root.angle) * ROOT_ORIGIN_SPREAD * gs;
    const joints: Point[] = [{ x: originX, y: ROOT_ORIGIN_Y * gs }];
    const widths: number[] = [root.baseWidth * gs];
    for (let seg = 1; seg <= ROOT_SEGMENT_COUNT; seg++) {
      const t = seg / ROOT_SEGMENT_COUNT;
      const sway =
        Math.sin(phase * ROOT_SWAY_SPEED + index * LIMB_PHASE_STAGGER + t * 2) *
        ROOT_SWAY_AMP *
        gs *
        t;
      const taper = Math.pow(t, ROOT_TAPER_POWER);
      joints.push({
        x: originX + outward * t * root.length * gs + sway,
        y: (ROOT_ORIGIN_Y + (downward * t + ROOT_GRIP * t * t) * root.length) * gs,
      });
      widths.push(lerp(root.baseWidth, root.tipWidth, taper) * gs);
    }

    const strokeLimb = (color: string, widthScale: number, towardsLight: boolean) => {
      ctx.strokeStyle = color;
      for (let seg = 1; seg < joints.length; seg++) {
        const bandLift = edgeBandLift(widths[seg], widthScale);
        const lift = towardsLight ? bandLift : -bandLift;
        ctx.lineWidth = Math.max(MIN_STROKE_PX, widths[seg] * widthScale);
        ctx.beginPath();
        ctx.moveTo(joints[seg - 1].x - lift, joints[seg - 1].y - lift);
        ctx.lineTo(joints[seg].x - lift, joints[seg].y - lift);
        ctx.stroke();
      }
    };

    strokeLimb(palette.woodShadow, 1 + COIL_SHADE_WIDTH_FRACTION, false);
    strokeLimb(palette.woodDark, 1, true);
    // Without a lit upper edge the whole root plate merges into one dark hill
    // and the base of the figure stops reading as limbs at all.
    strokeLimb(palette.woodMid, ROOT_MIDTONE_WIDTH_FRACTION, true);
    strokeLimb(palette.woodLit, COIL_RIM_WIDTH_FRACTION, true);

    const thornJoint = joints[Math.round(ROOT_THORN_AT * ROOT_SEGMENT_COUNT)];
    const thornSide = index % 2 === 0 ? 1 : -1;
    ctx.strokeStyle = palette.thorn;
    ctx.lineWidth = Math.max(MIN_STROKE_PX, gs * ROOT_THORN_WIDTH);
    ctx.beginPath();
    ctx.moveTo(thornJoint.x, thornJoint.y);
    ctx.lineTo(
      thornJoint.x + thornSide * ROOT_THORN_LEN * gs,
      thornJoint.y - ROOT_THORN_LEN * ROOT_THORN_RISE * gs,
    );
    ctx.stroke();
  }
}

/** A blade's geometry, in its own axis space: it grows along +x with +y as "under". */
interface LeafShape {
  readonly length: number;
  readonly width: number;
  /** 0 = a flat blade, 1 = one curled hard enough to hide its far flank. */
  readonly curl: number;
  /** Where along the blade something has eaten out of the near flank. */
  readonly biteAt: number;
  readonly biteDepth: number;
  /** Beyond this fraction the far flank is ragged rather than smooth. */
  readonly tearFrom: number;
  readonly tearDepth: number;
}

interface LeafPaint {
  readonly upper: string;
  readonly under: string;
  readonly rim: string;
  readonly vein: string;
  /** 0..1 — how far necrosis has eaten into this particular blade. */
  readonly blight: number;
}

const CLEAN_BLADE: Pick<LeafShape, 'curl' | 'biteAt' | 'biteDepth' | 'tearFrom' | 'tearDepth'> = {
  curl: 0,
  biteAt: 0,
  biteDepth: 0,
  tearFrom: 1,
  tearDepth: 0,
};

/** The spade profile: a fast rise to a broad shoulder, then a long fall to a point. */
function bladeProfileAt(t: number): number {
  if (t <= LEAF_SHOULDER_AT) return Math.pow(t / LEAF_SHOULDER_AT, LEAF_SHOULDER_RISE_POWER);
  return Math.pow((1 - t) / (1 - LEAF_SHOULDER_AT), LEAF_POINT_FALL_POWER);
}

interface BladeOutline {
  readonly axis: readonly Point[];
  readonly far: readonly Point[];
  readonly near: readonly Point[];
}

function bladeOutline(shape: LeafShape): BladeOutline {
  const axis: Point[] = [];
  const far: Point[] = [];
  const near: Point[] = [];
  for (let sample = 0; sample <= LEAF_OUTLINE_SAMPLES; sample++) {
    const t = sample / LEAF_OUTLINE_SAMPLES;
    const axisX = t * shape.length;
    const axisY = shape.length * LEAF_TIP_DROOP * t * t * (1 + shape.curl * LEAF_CURL_DROOP_GAIN);
    const half = shape.width * bladeProfileAt(t);

    const tearSpan = 1 - shape.tearFrom;
    const intoTear = tearSpan <= 0 ? 0 : clamp01((t - shape.tearFrom) / tearSpan);
    const raggedness = shape.tearDepth * intoTear * Math.abs(Math.sin(t * LEAF_TEAR_FREQUENCY));
    const farHalf = half * (1 - shape.curl * LEAF_CURL_FLANK_LOSS) * (1 - raggedness);

    const fromBite = (t - shape.biteAt) / LEAF_BITE_SPREAD;
    const bite = shape.biteDepth * Math.exp(-fromBite * fromBite);
    const nearHalf = half * (1 - bite);

    axis.push({ x: axisX, y: axisY });
    far.push({ x: axisX, y: axisY - farHalf });
    near.push({ x: axisX, y: axisY + nearHalf });
  }
  return { axis, far, near };
}

function tracePolyline(ctx: CanvasRenderingContext2D, points: readonly Point[], reverse: boolean) {
  for (let index = 0; index < points.length; index++) {
    const point = points[reverse ? points.length - 1 - index : index];
    ctx.lineTo(point.x, point.y);
  }
}

function traceBlade(ctx: CanvasRenderingContext2D, outline: BladeOutline) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  tracePolyline(ctx, outline.far, false);
  tracePolyline(ctx, outline.near, true);
  ctx.closePath();
}

/**
 * A torn, bitten, curling blade drawn along its own axis. The near half is
 * filled a second time in the shadow value: a blade that is one flat colour is
 * the fastest way to turn a plant back into wallpaper at tile size.
 */
function drawLeafBlade(ctx: CanvasRenderingContext2D, shape: LeafShape, paint: LeafPaint) {
  const outline = bladeOutline(shape);

  traceBlade(ctx, outline);
  ctx.fillStyle = paint.upper;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  tracePolyline(ctx, outline.axis, false);
  tracePolyline(ctx, outline.near, true);
  ctx.closePath();
  ctx.fillStyle = paint.under;
  ctx.fill();

  if (isVisible(paint.blight)) {
    ctx.save();
    traceBlade(ctx, outline);
    ctx.clip();
    for (let blotch = 0; blotch < LEAF_BLOTCH_COUNT; blotch++) {
      const along = lerp(0.25, 0.85, blotch / Math.max(1, LEAF_BLOTCH_COUNT - 1));
      const centre = outline.axis[Math.round(along * LEAF_OUTLINE_SAMPLES)];
      const spread = shape.width * lerp(1.6, 0.7, along) * paint.blight;
      const alpha = LEAF_BLOTCH_ALPHA * paint.blight;
      if (!isVisible(alpha)) continue;
      ctx.fillStyle = rgba(NECROTIC_BLOOM, alpha);
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, spread, spread * 0.8, 0, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.fillStyle = rgba(NECROSIS_COLOR, alpha);
      ctx.beginPath();
      ctx.ellipse(
        centre.x,
        centre.y,
        spread * NECROSIS_CORE_SCALE,
        spread * NECROSIS_CORE_SCALE * 0.8,
        0,
        0,
        FULL_CIRCLE,
      );
      ctx.fill();
    }
    ctx.restore();

    const edgeAlpha = LEAF_EDGE_BROWNING_ALPHA * paint.blight;
    if (isVisible(edgeAlpha)) {
      traceBlade(ctx, outline);
      ctx.strokeStyle = rgba(BROWNED_EDGE, edgeAlpha);
      ctx.lineWidth = Math.max(
        MIN_STROKE_PX,
        shape.width * LEAF_RIM_WIDTH * LEAF_EDGE_BROWNING_WIDTH_SCALE,
      );
      ctx.stroke();
    }
  }

  ctx.strokeStyle = paint.rim;
  ctx.lineWidth = Math.max(MIN_STROKE_PX, shape.length * LEAF_RIM_WIDTH);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  tracePolyline(ctx, outline.far, false);
  ctx.stroke();

  ctx.strokeStyle = paint.vein;
  ctx.lineWidth = Math.max(MIN_STROKE_PX, shape.length * LEAF_MIDRIB_WIDTH);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  tracePolyline(ctx, outline.axis, false);
  ctx.stroke();
}

function drawBroadLeaves(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  poison: number,
  palette: Palette,
  wantBehindMast: boolean,
) {
  for (let index = 0; index < BROAD_LEAVES.length; index++) {
    const leaf = BROAD_LEAVES[index];
    if (leaf.behindMast !== wantBehindMast) continue;

    // Rotating by the blade's own outward sign drops both sides of the plant;
    // one shared sign would wilt one flank and cock the other one up.
    const outwardSign = Math.cos(leaf.angle) >= 0 ? 1 : -1;
    const sway = Math.sin(phase * LEAF_SWAY_SPEED + index * LIMB_PHASE_STAGGER) * LEAF_SWAY_AMP;
    const droopAngle = outwardSign * (sag * LEAF_SAG_ANGLE + sway);
    const blight = poison * leaf.blightBias * LEAF_BLIGHT_CEILING;
    const wiltedCurl = leaf.curl + (1 - leaf.curl) * blight * LEAF_BLIGHT_CURL;
    const upperFace = leaf.behindMast ? palette.leafDark : palette.leafMid;

    ctx.save();
    const slump = stemOffsetAt(leaf.y, sag);
    ctx.translate((leaf.x + slump.dx) * gs, (leaf.y + slump.dy) * gs);
    ctx.rotate(leaf.angle + droopAngle);
    // A blade curls away from the plant, so the curl has to flip with the flank
    // the blade grows on or one side of him unrolls the wrong way.
    ctx.scale(1, outwardSign);
    drawLeafBlade(
      ctx,
      {
        length: leaf.length * gs,
        width: leaf.width * gs,
        curl: wiltedCurl,
        biteAt: leaf.biteAt,
        biteDepth: leaf.biteDepth,
        tearFrom: leaf.tearFrom,
        tearDepth: leaf.tearDepth,
      },
      {
        upper: upperFace,
        under: palette.leafShadow,
        rim: palette.leafPale,
        vein: mixColor(palette.leafDark, BROWNED_EDGE, blight),
        blight,
      },
    );
    ctx.restore();
  }
}

/** The malformed husk outline, in the pod's own unrotated space. */
function podOutline(pod: SeedPod, rx: number, ry: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < POD_OUTLINE_POINTS; index++) {
    const angle = (index / POD_OUTLINE_POINTS) * FULL_CIRCLE;
    const lump =
      1 +
      POD_LUMP_COARSE * Math.sin(angle * POD_LUMP_COARSE_WAVES + pod.lumpSeed) +
      POD_LUMP_FINE * lumpNoise(pod.lumpSeed, index * POD_LUMP_FINE_WAVES);
    // A spent pod caves in on one flank only; a symmetric deflation just reads as a smaller pod.
    const caveSide = Math.max(0, Math.sin(angle - 0.6));
    const collapse = 1 - pod.collapsed * POD_COLLAPSE_DEPTH * caveSide;
    points.push({
      x: Math.cos(angle) * rx * lump * collapse,
      y: Math.sin(angle) * ry * lump * collapse,
    });
  }
  return points;
}

function drawSeedPods(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  poison: number,
  palette: Palette,
) {
  const shrivel = 1 - poison * POD_SHRIVEL;
  const rot = poison * ORGAN_BLIGHT_CEILING;
  const skin = mixColor(palette.pod, NECROSIS_COLOR, rot);
  const sheen = mixColor(
    mixColor(palette.podLit, palette.pod, POD_SHEEN_RESTRAINT),
    NECROTIC_BLOOM,
    rot,
  );
  const underside = mixColor(
    mixColor(palette.pod, palette.woodShadow, POD_SHADE_DEPTH),
    NECROSIS_COLOR,
    rot * ORGAN_SHADE_ROT_RESTRAINT,
  );
  for (let index = 0; index < SEED_PODS.length; index++) {
    const pod = SEED_PODS[index];
    const breath =
      1 + Math.sin(phase * POD_BREATHE_SPEED + index * LIMB_PHASE_STAGGER) * POD_BREATHE_AMP;
    const rx = pod.radius * breath * shrivel * gs;
    const ry = rx * POD_ASPECT;
    const slump = stemOffsetAt(pod.y, sag);

    ctx.save();
    ctx.translate((pod.x + slump.dx) * gs, (pod.y + slump.dy) * gs);
    ctx.rotate(pod.tilt);

    const outline = podOutline(pod, rx, ry);
    const traceHusk = () => {
      ctx.beginPath();
      outline.forEach((point, at) => {
        if (at === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
    };

    traceHusk();
    ctx.fillStyle = skin;
    ctx.fill();

    ctx.save();
    traceHusk();
    ctx.clip();
    // The shaded flank has to stay off the husk's own far edge. Sunk to the
    // recess value across most of the pod it turns the organ into a black hole
    // with a bright bean floating in it, which is what a big specular highlight
    // on a near-black ground always becomes.
    ctx.fillStyle = underside;
    ctx.beginPath();
    ctx.ellipse(
      rx * POD_SHADE_OFFSET,
      ry * POD_SHADE_OFFSET,
      rx * POD_SHADE_SCALE,
      ry * POD_SHADE_SCALE,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
    if (isVisible(rot)) {
      ctx.fillStyle = rgba(NECROTIC_BLOOM, rot);
      ctx.beginPath();
      ctx.ellipse(-rx * 0.2, ry * 0.1, rx * 0.7, ry * 0.5, pod.lumpSeed, 0, FULL_CIRCLE);
      ctx.fill();
    }
    ctx.restore();

    traceHusk();
    ctx.strokeStyle = palette.woodShadow;
    ctx.lineWidth = Math.max(MIN_STROKE_PX, rx * POD_OUTLINE_WIDTH);
    ctx.stroke();

    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.ellipse(
      -rx * POD_HIGHLIGHT_OFFSET,
      -ry * POD_HIGHLIGHT_OFFSET,
      rx * POD_HIGHLIGHT_SCALE,
      ry * POD_HIGHLIGHT_SCALE * 1.4,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();

    if (pod.split > 0) {
      const splitLength = ry * POD_SPLIT_LENGTH * pod.split;
      const splitWidth = rx * POD_SPLIT_WIDTH * pod.split;
      ctx.fillStyle = palette.woodShadow;
      ctx.beginPath();
      ctx.moveTo(0, -splitLength);
      ctx.quadraticCurveTo(-splitWidth, 0, 0, splitLength);
      ctx.quadraticCurveTo(splitWidth, 0, 0, -splitLength);
      ctx.closePath();
      ctx.fill();

      const weepLength = ry * POD_WEEP_LENGTH * pod.split * (1 + poison * POD_WEEP_POISON_GAIN);
      ctx.strokeStyle = mixColor(WEEP_COLOR, NECROSIS_COLOR, rot);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(MIN_STROKE_PX, rx * POD_WEEP_WIDTH);
      ctx.beginPath();
      ctx.moveTo(0, splitLength * 0.4);
      ctx.lineTo(0, splitLength * 0.4 + weepLength);
      ctx.stroke();
      ctx.fillStyle = mixColor(WEEP_COLOR, NECROSIS_COLOR, rot);
      ctx.beginPath();
      ctx.arc(0, splitLength * 0.4 + weepLength, rx * POD_WEEP_BEAD_SCALE, 0, FULL_CIRCLE);
      ctx.fill();
    }

    ctx.fillStyle = palette.woodDark;
    ctx.beginPath();
    ctx.ellipse(
      0,
      -ry,
      rx * POD_CALYX_SCALE,
      rx * POD_CALYX_SCALE * POD_CALYX_ASPECT,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
    ctx.restore();
  }
}

/** A sample along a tendril, already in pixels: `t` is how far along the whole limb it sits. */
interface TendrilPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly t: number;
}

/**
 * How wide the limb is at a point along it, as a fraction of its root width.
 * Three things fight over the profile: the long taper that empties the limb into
 * its tip, the swell where it leaves the mass, and the growth nodes that pinch
 * it. A limb missing any of them reads as extruded.
 */
function tendrilWidthFraction(tendril: Tendril, t: number): number {
  const taper = lerp(1, TENDRIL_TIP_WIDTH_FRACTION, Math.pow(t, TENDRIL_TAPER_POWER));
  const fromShoulder = t / TENDRIL_SHOULDER_SPREAD;
  const shoulder = 1 + tendril.shoulderSwell * Math.exp(-fromShoulder * fromShoulder);
  let nodePinch = 1;
  for (const station of TENDRIL_NODE_STATIONS) {
    const fromNode = (t - station) / TENDRIL_NODE_SPREAD;
    nodePinch -= TENDRIL_NODE_PINCH * Math.exp(-fromNode * fromNode);
  }
  return taper * shoulder * nodePinch;
}

function tendrilPath(tendril: Tendril, gs: number, phase: number, sag: number): TendrilPoint[] {
  const sway = Math.sin(phase * TENDRIL_SWAY_SPEED + tendril.swayOffset) * TENDRIL_SWAY_AMP;
  // The curl opening and closing is the plainest "it just moved" cue available
  // to a creature with nothing on it that could ever look at anybody.
  const openness = 1 + Math.sin(phase * TENDRIL_UNFURL_SPEED + tendril.swayOffset) * tendril.unfurl;
  const curlRadius = tendril.curlRadius * openness;
  const slump = stemOffsetAt(tendril.y, sag);

  const at = (t: number, x: number, y: number): TendrilPoint => ({
    x: x * gs,
    y: y * gs,
    width: tendril.width * tendrilWidthFraction(tendril, t) * gs,
    t,
  });

  const points: TendrilPoint[] = [];
  for (let seg = 0; seg <= TENDRIL_RUN_SEGMENTS; seg++) {
    const alongStraight = seg / TENDRIL_RUN_SEGMENTS;
    const t = alongStraight * TENDRIL_CURL_AT;
    const alongRun = t * tendril.length;
    // Both bend terms return to zero at the end of the run, so the elbow moves
    // the limb's middle without dragging the tip off where the curl expects it.
    const elbow =
      tendril.shoulderBend * Math.sin(alongStraight * HALF_CIRCLE) +
      tendril.wristBend * Math.sin(alongStraight * FULL_CIRCLE);
    const lateral = elbow + Math.sin(alongStraight * HALF_CIRCLE) * sway;
    points.push(
      at(
        t,
        tendril.x + slump.dx + tendril.dirX * alongRun - tendril.dirY * lateral,
        tendril.y +
          slump.dy +
          tendril.dirY * alongRun +
          tendril.dirX * lateral +
          sag * TENDRIL_SAG_DROP * t,
      ),
    );
  }

  // The spiral winds about a centre set off to one side of the direction the run
  // actually arrives in — which the elbow has turned away from `dir` — so the
  // curl leaves the shaft tangentially instead of kinking off it.
  const runEnd = points[points.length - 1];
  const beforeEnd = points[points.length - 2];
  const arrivalX = runEnd.x - beforeEnd.x;
  const arrivalY = runEnd.y - beforeEnd.y;
  const arrivalLength = Math.hypot(arrivalX, arrivalY) || 1;
  const curlCentreX = runEnd.x - (arrivalY / arrivalLength) * tendril.curlSide * curlRadius * gs;
  const curlCentreY = runEnd.y + (arrivalX / arrivalLength) * tendril.curlSide * curlRadius * gs;
  const startAngle = Math.atan2(runEnd.y - curlCentreY, runEnd.x - curlCentreX);

  for (let seg = 1; seg <= TENDRIL_CURL_SEGMENTS; seg++) {
    const intoCurl = seg / TENDRIL_CURL_SEGMENTS;
    const t = lerp(TENDRIL_CURL_AT, 1, intoCurl);
    const spin = intoCurl * tendril.curlTurns * FULL_CIRCLE * tendril.curlSide;
    const shrinking = curlRadius * gs * (1 - intoCurl * TENDRIL_CURL_TIGHTEN);
    points.push({
      x: curlCentreX + Math.cos(startAngle + spin) * shrinking,
      y: curlCentreY + Math.sin(startAngle + spin) * shrinking,
      width: tendril.width * tendrilWidthFraction(tendril, t) * gs,
      t,
    });
  }
  return points;
}

function drawTendrils(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  palette: Palette,
) {
  ctx.lineCap = 'round';
  for (const tendril of TENDRILS) {
    const points = tendrilPath(tendril, gs, phase, sag);

    const strokeTendril = (color: string, widthScale: number, towardsLight: boolean) => {
      ctx.strokeStyle = color;
      for (let seg = 1; seg < points.length; seg++) {
        const bodyWidth = points[seg].width;
        const bandLift = edgeBandLift(bodyWidth, widthScale);
        const lift = towardsLight ? bandLift : -bandLift;
        ctx.lineWidth = Math.max(MIN_STROKE_PX, bodyWidth * widthScale);
        ctx.beginPath();
        ctx.moveTo(points[seg - 1].x - lift, points[seg - 1].y - lift);
        ctx.lineTo(points[seg].x - lift, points[seg].y - lift);
        ctx.stroke();
      }
    };

    strokeTendril(palette.woodShadow, 1 + COIL_SHADE_WIDTH_FRACTION, false);
    strokeTendril(palette.woodMid, 1, true);
    strokeTendril(palette.woodDark, COIL_SHADE_WIDTH_FRACTION, false);
    strokeTendril(palette.woodLit, COIL_RIM_WIDTH_FRACTION, true);

    ctx.strokeStyle = palette.woodDark;
    for (const station of TENDRIL_NODE_STATIONS) {
      let nearest = 1;
      for (let seg = 1; seg < points.length - 1; seg++) {
        if (Math.abs(points[seg].t - station) < Math.abs(points[nearest].t - station))
          nearest = seg;
      }
      const node = points[nearest];
      const runX = points[nearest + 1].x - points[nearest - 1].x;
      const runY = points[nearest + 1].y - points[nearest - 1].y;
      const runLength = Math.hypot(runX, runY);
      if (runLength <= 0) continue;
      const halfWidth = node.width / 2;
      const acrossX = (-runY / runLength) * halfWidth;
      const acrossY = (runX / runLength) * halfWidth;
      // The light is up and to the left everywhere on him, so the flank whose
      // offset runs down and right is the one a crease would darken.
      const shadedSign = acrossX + acrossY >= 0 ? 1 : -1;
      ctx.lineWidth = Math.max(MIN_STROKE_PX, node.width * TENDRIL_NODE_LINE_FRACTION);
      ctx.beginPath();
      ctx.moveTo(
        node.x + acrossX * shadedSign * TENDRIL_NODE_FROM_FRACTION,
        node.y + acrossY * shadedSign * TENDRIL_NODE_FROM_FRACTION,
      );
      ctx.lineTo(
        node.x + acrossX * shadedSign * TENDRIL_NODE_TO_FRACTION,
        node.y + acrossY * shadedSign * TENDRIL_NODE_TO_FRACTION,
      );
      ctx.stroke();
    }
  }
}

function drawPitcher(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  sag: number,
  poison: number,
  palette: Palette,
) {
  const swing = Math.sin(phase * PITCHER_SWAY_SPEED) * PITCHER_SWAY_AMP;
  const slump = stemOffsetAt(PITCHER_HANG_Y, sag);
  const rot = poison * ORGAN_BLIGHT_CEILING;
  const skin = mixColor(palette.pitcher, NECROSIS_COLOR, rot);
  const rim = mixColor(palette.pitcherLit, NECROSIS_COLOR, rot);

  ctx.save();
  ctx.translate((swing + slump.dx) * gs, slump.dy * gs);

  ctx.strokeStyle = palette.woodMid;
  ctx.lineWidth = Math.max(MIN_STROKE_PX, PITCHER_PEDUNCLE_WIDTH * gs);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(PITCHER_HANG_X * gs, PITCHER_HANG_Y * gs);
  ctx.quadraticCurveTo(
    (PITCHER_HANG_X - PITCHER_MOUTH_RX) * gs,
    lerp(PITCHER_HANG_Y, PITCHER_MOUTH_Y, 0.5) * gs,
    PITCHER_MOUTH_X * gs,
    PITCHER_MOUTH_Y * gs,
  );
  ctx.stroke();

  const traceTrap = () => {
    ctx.beginPath();
    ctx.moveTo((PITCHER_MOUTH_X - PITCHER_MOUTH_RX) * gs, PITCHER_MOUTH_Y * gs);
    ctx.quadraticCurveTo(
      (PITCHER_MOUTH_X - PITCHER_WAIST_RX) * gs,
      PITCHER_WAIST_Y * gs,
      (PITCHER_MOUTH_X - PITCHER_BELLY_RX) * gs,
      PITCHER_BELLY_Y * gs,
    );
    ctx.quadraticCurveTo(
      (PITCHER_MOUTH_X - PITCHER_BELLY_RX) * gs,
      PITCHER_BASE_Y * gs,
      (PITCHER_MOUTH_X - PITCHER_BASE_RX) * gs,
      PITCHER_BASE_Y * gs,
    );
    ctx.lineTo((PITCHER_MOUTH_X + PITCHER_BASE_RX) * gs, PITCHER_BASE_Y * gs);
    ctx.quadraticCurveTo(
      (PITCHER_MOUTH_X + PITCHER_BELLY_RX) * gs,
      PITCHER_BASE_Y * gs,
      (PITCHER_MOUTH_X + PITCHER_BELLY_RX) * gs,
      PITCHER_BELLY_Y * gs,
    );
    ctx.quadraticCurveTo(
      (PITCHER_MOUTH_X + PITCHER_WAIST_RX) * gs,
      PITCHER_WAIST_Y * gs,
      (PITCHER_MOUTH_X + PITCHER_MOUTH_RX) * gs,
      PITCHER_MOUTH_Y * gs,
    );
    ctx.closePath();
  };

  traceTrap();
  ctx.fillStyle = skin;
  ctx.fill();

  ctx.save();
  traceTrap();
  ctx.clip();
  ctx.fillStyle = palette.woodShadow;
  ctx.fillRect(
    (PITCHER_MOUTH_X + PITCHER_BELLY_RX * PITCHER_SHADE_FRACTION) * gs,
    PITCHER_MOUTH_Y * gs,
    PITCHER_BELLY_RX * 2 * gs,
    (PITCHER_BASE_Y - PITCHER_MOUTH_Y) * gs,
  );
  if (isVisible(rot)) {
    ctx.fillStyle = rgba(NECROTIC_BLOOM, rot);
    ctx.beginPath();
    ctx.ellipse(
      (PITCHER_MOUTH_X - PITCHER_BELLY_RX * 0.3) * gs,
      PITCHER_BELLY_Y * gs,
      PITCHER_BELLY_RX * 0.8 * gs,
      PITCHER_BELLY_RX * 0.6 * gs,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
  ctx.restore();

  traceTrap();
  ctx.strokeStyle = palette.woodShadow;
  ctx.lineWidth = Math.max(MIN_STROKE_PX, PITCHER_OUTLINE_WIDTH * gs);
  ctx.stroke();

  ctx.lineWidth = Math.max(MIN_STROKE_PX, PITCHER_RIB_WIDTH * gs);
  for (const rib of PITCHER_RIB_OFFSETS) {
    ctx.beginPath();
    ctx.moveTo((PITCHER_MOUTH_X + rib) * gs, PITCHER_WAIST_Y * gs);
    ctx.quadraticCurveTo(
      (PITCHER_MOUTH_X + rib * PITCHER_RIB_BOW) * gs,
      PITCHER_BELLY_Y * gs,
      (PITCHER_MOUTH_X + rib * PITCHER_BASE_RX) * gs,
      PITCHER_BASE_Y * gs,
    );
    ctx.stroke();
  }

  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(
    PITCHER_MOUTH_X * gs,
    PITCHER_MOUTH_Y * gs,
    PITCHER_MOUTH_RX * gs,
    PITCHER_RIM_RY * gs,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.fillStyle = palette.woodShadow;
  ctx.beginPath();
  ctx.ellipse(
    PITCHER_MOUTH_X * gs,
    PITCHER_MOUTH_Y * gs,
    PITCHER_MOUTH_RX * PITCHER_THROAT_SCALE * gs,
    PITCHER_RIM_RY * PITCHER_THROAT_SCALE * gs,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.save();
  ctx.translate((PITCHER_MOUTH_X - PITCHER_MOUTH_RX) * gs, PITCHER_MOUTH_Y * gs);
  ctx.rotate(PITCHER_LID_ANGLE);
  drawLeafBlade(
    ctx,
    {
      ...CLEAN_BLADE,
      length: PITCHER_LID_LENGTH * gs,
      width: PITCHER_LID_WIDTH * gs,
      curl: 0.25,
      biteAt: 0.6,
      biteDepth: 0.3 * poison,
      tearFrom: 0.5,
      tearDepth: 0.4 * poison,
    },
    {
      upper: mixColor(palette.leafMid, NECROSIS_COLOR, rot),
      under: palette.leafShadow,
      rim: mixColor(palette.leafPale, NECROSIS_COLOR, rot),
      vein: mixColor(palette.leafDark, BROWNED_EDGE, rot),
      blight: poison * LEAF_BLIGHT_CEILING,
    },
  );
  ctx.restore();

  ctx.restore();
}

/** A ragged closed patch, so a spreading rot never comes out as a drawn-on oval. */
function traceRaggedPatch(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  rx: number,
  ry: number,
  lumpSeed: number,
) {
  ctx.beginPath();
  for (let index = 0; index < BLOTCH_OUTLINE_POINTS; index++) {
    const angle = (index / BLOTCH_OUTLINE_POINTS) * FULL_CIRCLE;
    const lump =
      1 +
      BLOTCH_LUMP_COARSE * Math.sin(angle * BLOTCH_LUMP_COARSE_WAVES + lumpSeed) +
      BLOTCH_LUMP_FINE * lumpNoise(lumpSeed, index * BLOTCH_LUMP_FINE_WAVES);
    const x = centreX + Math.cos(angle) * rx * lump;
    const y = centreY + Math.sin(angle) * ry * lump;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawNecrosis(ctx: CanvasRenderingContext2D, gs: number, sag: number, poison: number) {
  const alpha = NECROSIS_ALPHA * poison;
  if (!isVisible(alpha)) return;
  for (const blotch of NECROTIC_BLOTCHES) {
    const slump = stemOffsetAt(blotch.y, sag);
    const centreX = (blotch.x + slump.dx) * gs;
    const centreY = (blotch.y + slump.dy) * gs;
    ctx.fillStyle = rgba(NECROTIC_BLOOM, alpha);
    traceRaggedPatch(ctx, centreX, centreY, blotch.rx * gs, blotch.ry * gs, blotch.lumpSeed);
    ctx.fill();
    ctx.fillStyle = rgba(NECROSIS_COLOR, alpha);
    traceRaggedPatch(
      ctx,
      centreX,
      centreY,
      blotch.rx * NECROSIS_CORE_SCALE * gs,
      blotch.ry * NECROSIS_CORE_SCALE * gs,
      blotch.lumpSeed + 1,
    );
    ctx.fill();
  }
}

function drawSpores(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  poison: number,
  palette: Palette,
) {
  const alpha = SPORE_ALPHA * poison;
  if (!isVisible(alpha)) return;
  ctx.fillStyle = rgba(mixColor(SPORE_COLOR, palette.leafPale, poison), alpha);
  for (let mote = 0; mote < SPORE_COUNT; mote++) {
    const angle = phase * SPORE_DRIFT_SPEED + (mote / SPORE_COUNT) * FULL_CIRCLE;
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * SPORE_ORBIT_RX * gs,
      KNOT_CENTER_Y * gs + Math.sin(angle * SPORE_BOB_FREQ) * SPORE_ORBIT_RY * gs,
      SPORE_R * gs,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
}

function drawCureFlourish(
  ctx: CanvasRenderingContext2D,
  gs: number,
  phase: number,
  cure: number,
): void {
  const bloomAlpha = CURE_BLOOM_ALPHA * cure;
  if (!isVisible(bloomAlpha)) return;

  const radius = CURE_BLOOM_RADIUS * gs;
  const bloom = ctx.createRadialGradient(0, KNOT_CENTER_Y * gs, 0, 0, KNOT_CENTER_Y * gs, radius);
  bloom.addColorStop(0, rgba(CURE_BLOOM_COLOR, bloomAlpha));
  bloom.addColorStop(1, rgba(CURE_BLOOM_COLOR, 0));
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.ellipse(0, KNOT_CENTER_Y * gs, radius, radius * CURE_BLOOM_RY_SCALE, 0, 0, FULL_CIRCLE);
  ctx.fill();

  // The trap becomes a flower: the corolla unfurls out of the pitcher's own
  // mouth, which is the only way the cure reads as this plant healing rather
  // than as a light being shone on it.
  ctx.save();
  ctx.translate(PITCHER_MOUTH_X * gs, PITCHER_MOUTH_Y * gs);
  ctx.scale(1, COROLLA_FLATTEN);
  for (let petal = 0; petal < COROLLA_PETAL_COUNT; petal++) {
    ctx.save();
    ctx.rotate(COROLLA_TURN + (petal / COROLLA_PETAL_COUNT) * FULL_CIRCLE);
    drawLeafBlade(
      ctx,
      { ...CLEAN_BLADE, length: COROLLA_LENGTH * cure * gs, width: COROLLA_WIDTH * cure * gs },
      {
        upper: rgba(COROLLA_COLOR, cure),
        under: rgba(CURE_BLOOM_COLOR, cure),
        rim: rgba(COROLLA_HEART_COLOR, cure),
        vein: rgba(COROLLA_HEART_COLOR, cure),
        blight: 0,
      },
    );
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = rgba(COROLLA_HEART_COLOR, cure);
  ctx.beginPath();
  ctx.arc(PITCHER_MOUTH_X * gs, PITCHER_MOUTH_Y * gs, COROLLA_HEART_R * cure * gs, 0, FULL_CIRCLE);
  ctx.fill();

  for (let mote = 0; mote < CURE_MOTE_COUNT; mote++) {
    const seed = mote / CURE_MOTE_COUNT;
    const climb = (phase * CURE_MOTE_RISE_SPEED + seed) % 1;
    const moteAlpha = CURE_MOTE_ALPHA * cure * (1 - climb);
    if (!isVisible(moteAlpha)) continue;
    ctx.fillStyle = rgba(CURE_BLOOM_COLOR, moteAlpha);
    ctx.beginPath();
    ctx.arc(
      Math.sin(seed * FULL_CIRCLE * CURE_MOTE_WAVES + climb * FULL_CIRCLE) * CURE_MOTE_SPREAD * gs,
      (KNOT_CENTER_Y - climb * CURE_MOTE_RISE_SPAN) * gs,
      CURE_MOTE_R * gs,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
}

/**
 * Draw Grimaldi as the giant sentient vine he became.
 *
 * @param sx screen x of the entity tile's top-left corner
 * @param sy screen y of the entity tile's top-left corner
 * @param s  tile size in pixels; the art spans {@link GRIMALDI_VINE_DRAW_SCALE} of them
 * @param phase animation accumulator, incremented each frame by the caller
 */
export function drawGrimaldiVineSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phase: number,
  state: GrimaldiVineVisualState,
): void {
  const gs = s * GRIMALDI_VINE_DRAW_SCALE;
  const cure = clamp01(state.cure);
  // The cure is the one thing that undoes the poison, so it drives both the
  // colour and the posture from a single value rather than needing the caller
  // to wind `poison` and `sag` back down in step with it.
  const poison = clamp01(state.poison) * (1 - cure);
  const sag = clamp01(state.sag) * (1 - cure);
  const flare = state.hitFlash ? REFUSAL_FLARE_STRENGTH : 0;
  const palette = buildPalette(poison, cure, flare);

  ctx.save();
  ctx.translate(sx + s / 2, sy + s / 2 - cure * CURE_LIFT * gs);

  drawCoilHalf(ctx, gs, phase, sag, palette, SECOND_COIL, false);
  drawCoilHalf(ctx, gs, phase, sag, palette, RUNNER_COIL, false);
  drawCoilHalf(ctx, gs, phase, sag, palette, MAIN_COIL, false);
  drawBroadLeaves(ctx, gs, phase, sag, poison, palette, true);

  drawMast(ctx, gs);

  drawRecessPockets(ctx, gs, sag, palette);
  drawRootPlate(ctx, gs, palette);
  drawRootLimbs(ctx, gs, phase, sag, palette);

  drawCoilHalf(ctx, gs, phase, sag, palette, RUNNER_COIL, true);
  drawCoilHalf(ctx, gs, phase, sag, palette, SECOND_COIL, true);
  drawCoilHalf(ctx, gs, phase, sag, palette, MAIN_COIL, true);
  drawTangleLoops(ctx, gs, phase, sag, palette);

  drawBroadLeaves(ctx, gs, phase, sag, poison, palette, false);
  // The rot goes down before the near organs so they break the patches up. Laid
  // over the finished figure instead, each patch stays a whole soft shape and
  // reads as a light thrown on him rather than as tissue that has died.
  drawNecrosis(ctx, gs, sag, poison);
  drawSeedPods(ctx, gs, phase, sag, poison, palette);
  drawPitcher(ctx, gs, phase, sag, poison, palette);
  drawTendrils(ctx, gs, phase, sag, palette);
  drawSpores(ctx, gs, phase, poison, palette);
  drawCureFlourish(ctx, gs, phase, cure);

  ctx.restore();
}
