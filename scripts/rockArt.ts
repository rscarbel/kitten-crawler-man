/**
 * Drawing engine for the Level 3 wilderness's boulders.
 *
 * Four lithologies — granite, sandstone, basalt, limestone — crossed with four
 * forms, so a scree slope is a slope of *different rocks* rather than one rock
 * repeated. Variation comes only from a seed and a spec; nothing is hand-placed.
 *
 * ## The two things the first cut got wrong
 *
 * **A rock is a mass standing on the ground, not a plate lying on it.** The
 * first cut built the body as a hull plus a shrunk copy of itself pushed up and
 * to the left, with the shrink at 0.56 — so more than half of every boulder was
 * a big lit top face receding from the camera, and the silhouette was wider than
 * it was tall. The result read as a flat disc seen from above, sloping away at
 * the back, which is a shape a player standing behind it should be visible over.
 * The body is a **front elevation** now: a superellipse profile with straight
 * sides and a broad crown, and only a narrow lit cap where that crown turns
 * over. `CAP_HEIGHT_FRACTION` controls the read — push it down and the rock lies
 * back down again.
 *
 * **Art that overhangs its tile lets the player stand inside the rock.** Only
 * the anchor tile is non-walkable, so every solid pixel outside it is ground the
 * player can walk onto while being drawn behind the stone. The old two-tile-wide
 * large boulder put 380–490 such pixels on its neighbours. Every stone is now
 * built inside a half-width budget of `MAX_HALF_WIDTH_TILES` and *normalised* to
 * it after shear and wobble rather than merely being started below it, and
 * `generate-rock-sprites.ts` fails the bake if a solid pixel escapes anyway.
 *
 * That budget is a hard ceiling on how big a boulder can look. Within one tile
 * the large variant can only be about 30 px across, so its bulk has to come from
 * height and from a low stone tucked against its base. Three intermediate
 * attempts are worth not repeating: a single tall mass read as a headstone, that
 * mass flanked by two round stones read as a headstone between two eggs, and
 * three interlocking slabs read as crystal shards, because a stone one third of
 * a tile wide and a whole tile tall is a shard whatever is drawn on it. A
 * genuinely larger boulder needs a footprint wider than one tile, which is a
 * change to collision rather than to art.
 *
 * Everything is expressed in multiples of `tileScale`, so the sheets can be
 * baked at any resolution without hand-tuned pixel constants drifting apart.
 * Light comes from the upper left, matching every other prop in the repo.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import { mulberry32, range, rangeInt, subSeed, type Rng } from '../src/sprites/person/rng.js';

export type RockSize = 'small' | 'large';

/**
 * Rock type. Each carries its own palette *and* its own surface treatment —
 * swapping only the colours produced four recolours of the same stone, which is
 * the thing this set existed to stop.
 */
export type Lithology = 'granite' | 'sandstone' | 'basalt' | 'limestone';

/**
 * Silhouette archetype: how many corners the outline has, how sharply it tapers,
 * and whether it leans or is split by a cleft.
 */
export type RockForm = 'rounded' | 'blocky' | 'split' | 'leaning';

export interface RockSpec {
  readonly size: RockSize;
  readonly lithology: Lithology;
  readonly form: RockForm;
}

/** The cell a rock is painted into, in absolute sheet pixels. */
export interface RockFrame {
  /** Left edge of the anchor tile. */
  readonly originX: number;
  /** Top edge of the anchor tile. */
  readonly originY: number;
  /** Bottom edge of the cell — how much room the contact shadow has. */
  readonly bottomY: number;
  readonly tileScale: number;
}

const TWO_PI = Math.PI * 2;

interface Palette {
  readonly shadow: string;
  readonly body: string;
  readonly light: string;
  readonly rim: string;
  readonly crack: string;
}

/**
 * The four rock palettes.
 *
 * Granite is unchanged from the first cut and is sampled to sit beside the
 * generated `scree` ground material rather than beside anything hand-drawn — a
 * boulder on a scree slope is the commonest place one is seen.
 *
 * Nothing else depends on these values. `drawRiverRock` in `decorationTiles.ts`
 * was once described as matching granite by hand; it does not, and never did —
 * it has its own ramp, deliberately darker and bluer, because a stone standing
 * in a river is wet. These four palettes can be retuned freely.
 *
 * The other three are spaced around it in *value* as much as in hue: basalt
 * darker than the ground it stands on, limestone lighter, sandstone warmer. Two
 * rocks that differ only in hue read as the same rock under different weather.
 */
const PALETTES: Readonly<Record<Lithology, Palette>> = {
  granite: {
    shadow: '#3b3a38',
    body: '#6a6862',
    light: '#8f8c83',
    rim: '#aba69a',
    crack: '#2c2b29',
  },
  sandstone: {
    shadow: '#54402e',
    body: '#96774f',
    light: '#bf9c6b',
    rim: '#d9bd90',
    crack: '#43331f',
  },
  basalt: {
    shadow: '#212328',
    body: '#42454b',
    light: '#61646b',
    rim: '#8a8e97',
    crack: '#14161a',
  },
  limestone: {
    shadow: '#6b6d64',
    body: '#9fa094',
    light: '#c5c5b7',
    rim: '#dfdecf',
    crack: '#585a51',
  },
};

/**
 * Lichen and moss, taken **literally** from `treeArt.ts`'s foliage ramps rather
 * than picked to look about right, so a boulder in a wood and the wood around it
 * are the same green. `MOSS_DARK` is `OAK_FOLIAGE.dark` and `MOSS_LIGHT` is
 * `OAK_FOLIAGE.mid`.
 *
 * Copied rather than imported because `treeArt.ts` keeps its ramps private, and
 * exporting a tree's palette so a rock can borrow it would make every future
 * change to the forest a change to the rocks as well. The first cut *said* it
 * had done this and had not — the colours were hand-picked at hue 84°, outside
 * the 85°–120° band that file states its foliage is confined to.
 */
const MOSS_DARK = '#2c4a1f';
const MOSS_LIGHT = '#3e6529';

/** Light direction. Upper left, like every other prop here. */
const LIGHT_X = -0.62;
const LIGHT_Y = -0.79;

/**
 * Half-width budget, in tiles, and the only reason the player cannot stand
 * inside a boulder. `TILE_SIZE / 2` is 0.5 tiles; the margin below that is what
 * keeps antialiasing on the outermost edge from bleeding into the neighbouring
 * tile. Every stone in a cluster is placed and normalised inside this.
 */
const MAX_HALF_WIDTH_TILES = 0.46;

/**
 * Heights, in tiles, measured from the rock's base to its crown.
 *
 * These decide how much of a player standing directly behind a boulder it hides,
 * which is the complaint the rework started from. Measured on the baked sheets:
 * a small boulder ends 3–8 px *below* the top of its own tile and so hides
 * nothing at all, and a large one reaches 1–7 px into the row above and hides a
 * standing player's feet. Both are amounts the shapes plainly justify.
 *
 * Raising `SMALL_HEIGHT_TILES_MIN + SMALL_HEIGHT_TILES_RANGE` past `1 -
 * BASE_LIFT_TILES` is what would break that, by letting a knee-high stone start
 * occluding.
 */
const SMALL_HEIGHT_TILES_MIN = 0.58;
const SMALL_HEIGHT_TILES_RANGE = 0.2;
const LARGE_HEIGHT_TILES_MIN = 0.86;
const LARGE_HEIGHT_TILES_RANGE = 0.24;

/** How far a small stone falls short of the full width budget. */
const SMALL_HALF_WIDTH_SHARE_MIN = 0.78;
const SMALL_HALF_WIDTH_SHARE_RANGE = 0.16;

/** How far the rock's own base sits above the anchor tile's bottom edge. */
const BASE_LIFT_TILES = 0.14;

/**
 * Silhouette wobble: a sum of three low harmonics rather than an independent
 * draw per vertex, and that is the difference between a rock and a caltrop.
 * Per-vertex jitter of ±26% put spikes on the outline, because neighbouring
 * vertices are uncorrelated and two adjacent extremes are a spur. Harmonics vary
 * *smoothly* around the ring, so the outline stays a lump — and the angularity
 * comes from where it is meant to, which is the small number of straight edges
 * between corners.
 */
interface FormProfile {
  readonly vertices: number;
  readonly harmonics: readonly number[];
  /**
   * Superellipse exponent for the profile. 2 is a plain ellipse; above that the
   * sides stand up straighter and the crown flattens.
   *
   * This is what stops a tall rock reading as a menhir. An ellipse tall enough
   * to be a boulder rather than a plate necessarily comes to a point at the top,
   * and a pointed mass twice as tall as it is wide is a standing stone — a
   * different object with a different meaning. A boulder is broad-shouldered.
   */
  readonly squareness: number;
  /** How much narrower the crown is than the base, as a fraction of half-width. */
  readonly taper: number;
  /** Horizontal shear per pixel of height. Only `leaning` uses it. */
  readonly lean: number;
  /** Whether a cleft is cut down the face. */
  readonly cleft: boolean;
}

const FORM_PROFILES: Readonly<Record<RockForm, FormProfile>> = {
  rounded: {
    vertices: 13,
    harmonics: [0.09, 0.055, 0.03],
    squareness: 3,
    taper: 0.16,
    lean: 0,
    cleft: false,
  },
  blocky: {
    vertices: 8,
    harmonics: [0.12, 0.075, 0.04],
    squareness: 4.2,
    taper: 0.1,
    lean: 0,
    cleft: false,
  },
  split: {
    vertices: 9,
    harmonics: [0.1, 0.06, 0.035],
    squareness: 3.4,
    taper: 0.14,
    lean: 0,
    cleft: true,
  },
  leaning: {
    vertices: 9,
    harmonics: [0.1, 0.07, 0.04],
    squareness: 3.2,
    taper: 0.2,
    lean: 0.2,
    cleft: false,
  },
};

/**
 * The lit cap: where the crown turns over, and how far the seam bows toward the
 * viewer. Small is the whole point — a wide cap is a plate, and a plate is what
 * made the first cut read as sloping away at the back.
 */
const CAP_HEIGHT_FRACTION = 0.7;
const CAP_BOW_TILES = 0.09;
const CAP_SEAM_ALPHA = 0.3;
const CAP_SEAM_WIDTH_TILES = 0.02;

/**
 * How the crown breaks over into the face.
 *
 * A single smooth curve between two flat tones put a hard, near-horizontal line
 * across the middle of every rock, which read as two-tone paint rather than as a
 * form. Three things fix it together and none of them is sufficient alone: the
 * seam is a jittered polyline so the crown breaks in facets, the cap is graded
 * from its brightest at the top down to nearly the seam, and a short band below
 * the seam carries the value the rest of the way down to the face tone.
 */
const CAP_SEAM_SEGMENTS = 6;
const CAP_SEAM_JITTER_TILES = 0.035;
const CAP_GRADE_DEPTH = 0.16;
const CAP_FALLOFF_HEIGHT_FRACTION = 0.22;
const CAP_FALLOFF_LIFT = 0.13;

/**
 * How far a corner may slide along the outline, as a fraction of the even
 * spacing between corners.
 */
const CORNER_ANGLE_JITTER = 0.34;

/**
 * The three planes a rock is read from at this size: a lit top, a front face,
 * and a side turned away from the light. Five evenly-shaded vertical panels — the
 * previous attempt — averaged out to one flat colour at 30 px across; three
 * planes with a hard edge between them is the whole of the form.
 *
 * `SHOULDER_X_SHARE_MIN`/`_RANGE` place where the front turns into the side, as
 * a fraction of half-width, and `SHOULDER_DRIFT_MIN`/`_RANGE` say how far that
 * edge leans on its way down.
 */
const SIDE_PLANE_SHADE = -0.24;
const SHOULDER_X_SHARE_MIN = 0.1;
const SHOULDER_X_SHARE_RANGE = 0.34;
const SHOULDER_DRIFT_MIN = -0.24;
const SHOULDER_DRIFT_RANGE = 0.48;

/** Faint sub-panels breaking each plane up, so neither reads as poster paint. */
const SUB_PANEL_COUNT_MIN = 2;
const SUB_PANEL_COUNT_RANGE = 3;
const SUB_PANEL_SHADE_RANGE = 0.09;

/** How much the wall darkens toward the ground, where the light does not reach. */
const GROUND_GLOOM_ALPHA = 0.17;
const GROUND_GLOOM_START = 0.2;

/** Cracks: dark seams running down a face. */
const CRACK_COUNT_MIN = 1;
const CRACK_COUNT_RANGE = 3;
const CRACK_WIDTH_TILES = 0.022;
const CRACK_LENGTH_MIN = 0.24;
const CRACK_LENGTH_RANGE = 0.3;
const CRACK_WANDER = 0.16;
const CRACK_ALPHA = 0.55;
const CRACK_SEGMENTS = 4;

/** Sandstone bedding: near-horizontal strata across the wall. */
const BEDDING_COUNT_MIN = 3;
const BEDDING_COUNT_RANGE = 3;
const BEDDING_WIDTH_TILES = 0.03;
const BEDDING_ALPHA = 0.22;
const BEDDING_SAG_TILES = 0.05;
/**
 * Where inside its own slot a band settles. Kept off both ends so two adjacent
 * bands cannot land on the same row and read as one thick stratum.
 */
const BEDDING_SLOT_INSET_MIN = 0.2;
const BEDDING_SLOT_INSET_MAX = 0.8;

/** Basalt fracture: vertical columnar joints. */
const FRACTURE_COUNT_MIN = 2;
const FRACTURE_COUNT_RANGE = 3;
const FRACTURE_WIDTH_TILES = 0.024;
const FRACTURE_ALPHA = 0.34;
const FRACTURE_LEAN = 0.12;
/** The span of the face one joint covers, as fractions of the stone's height. */
const FRACTURE_TOP_MIN = 0.5;
const FRACTURE_BOTTOM_MAX = 0.45;

/** Limestone: solution pits, and rain grooves running down from the crown. */
const PIT_COUNT_MIN = 5;
const PIT_COUNT_RANGE = 8;
const PIT_RADIUS_TILES_MIN = 0.018;
const PIT_RADIUS_TILES_RANGE = 0.03;
const PIT_ALPHA = 0.34;
const GROOVE_COUNT_MIN = 1;
const GROOVE_COUNT_RANGE = 2;
const GROOVE_WIDTH_TILES = 0.02;
const GROOVE_ALPHA = 0.17;

/** The cleft on a `split` rock, as a fraction of the body. */
const CLEFT_WIDTH_SHARE = 0.11;
const CLEFT_DEPTH_SHARE = 0.72;
const CLEFT_LEAN = 0.3;

/** Speckle: the mineral grain that stops a facet reading as flat colour. */
const SPECKLE_PER_TILE = 90;
const SPECKLE_RADIUS_TILES = 0.014;
const SPECKLE_ALPHA = 0.3;
/** Per-lithology grain density, as a multiple of `SPECKLE_PER_TILE`. */
const SPECKLE_DENSITY: Readonly<Record<Lithology, number>> = {
  granite: 1,
  sandstone: 0.55,
  basalt: 0.4,
  limestone: 0.7,
};

/**
 * Moss: irregular clumps.
 *
 * Each clump is nine small overlapping lobes spread wider than the patch's own
 * radius, at well under half opacity. Three earlier settings were each too
 * confident: one arc per patch drew a perfect green disc, which is the one shape
 * nothing in nature makes; five fat lobes at 0.6 alpha merged straight back into
 * a disc with a notch out of it. Lichen is a stain, not a sticker — small, many,
 * ragged, and faint enough that the granite still shows through it.
 *
 * Placement moved with the geometry. On a flat top plate the crown was the only
 * sensible place; on a standing mass the damp is at the **base and the shaded
 * side**, so that is where the clumps weight themselves now.
 */
const MOSS_COVERAGE_MIN = 0.15;
const MOSS_COVERAGE_RANGE = 0.5;
const MOSS_PATCHES_MIN = 2;
const MOSS_PATCHES_RANGE = 4;
const MOSS_PATCH_RADIUS_MIN = 0.12;
const MOSS_PATCH_RADIUS_RANGE = 0.16;
const MOSS_LOBES_PER_PATCH = 9;
const MOSS_LOBE_SPREAD = 1.15;
const MOSS_LOBE_SIZE_MIN = 0.26;
const MOSS_LOBE_SIZE_RANGE = 0.34;
const MOSS_ALPHA = 0.42;
const MOSS_SPECK_SHARE = 0.4;
/** Where on the body moss settles: 0 is the base, 1 the crown. */
const MOSS_HEIGHT_BIAS = 0.42;
const MOSS_HEIGHT_SPREAD = 0.5;

/** Rim light along the lit edge of the silhouette. */
const RIM_WIDTH_TILES = 0.045;
const RIM_ALPHA = 0.75;
/** How much of the outline is lit: the arc facing the light, and no more. */
const RIM_ARC_DOT_THRESHOLD = 0.15;

/** Contact shadow: what stops a boulder floating above its tile. */
const CONTACT_SHADOW_WIDTH_RATIO = 1.2;
const CONTACT_SHADOW_HEIGHT_RATIO = 0.3;
const CONTACT_SHADOW_ALPHA = 0.42;
const CONTACT_SHADOW_MID_STOP = 0.55;
const CONTACT_SHADOW_MID_ALPHA_FRACTION = 0.45;

/**
 * A dark seat where the rock meets the ground. `SEAT_DEEPEN` takes the shadow
 * tone further down still, since the strip a rock rests on sees no sky at all.
 */
const SEAT_ALPHA = 0.35;
const SEAT_DEPTH_TILES = 0.09;
const SEAT_DEEPEN = -0.25;

/**
 * The stones a boulder is built from, in draw order — back to front.
 *
 * A large boulder is a broad mass with one low stone tucked against its base,
 * overlapping it rather than standing clear. The overlap is the point: a small
 * stone whose width and height are similar is an egg whatever else is done to
 * it, and an earlier version that set two such stones either side of a tall mass
 * read as a headstone flanked by eggs.
 *
 * `offsetShare` and `halfWidthShare` are fractions of the half-width budget, and
 * every member satisfies `|offsetShare| + halfWidthShare <= 1` — that is what
 * keeps the whole group inside the one tile the boulder blocks.
 */
interface ClusterMemberBase {
  readonly halfWidthShare: number;
  readonly offsetShare: number;
  readonly heightShare: number;
  /** Lifted base, in tiles, so a stone set back reads as further away. */
  readonly setBackTiles: number;
}

/** The one stone that wears the variant's own form. */
interface PrimaryMember extends ClusterMemberBase {
  readonly primary: true;
}

/**
 * A companion, whose form is fixed here because the variant's form belongs to
 * the mass the eye reads first. Split as a union rather than given an optional
 * `form` so that naming a form on the primary is a type error instead of a line
 * that looks load-bearing and is silently ignored.
 */
interface CompanionMember extends ClusterMemberBase {
  readonly primary: false;
  readonly form: RockForm;
}

type ClusterMember = PrimaryMember | CompanionMember;

const SMALL_CLUSTER: readonly ClusterMember[] = [
  { halfWidthShare: 1, offsetShare: 0, heightShare: 1, setBackTiles: 0, primary: true },
];

const LARGE_CLUSTER: readonly ClusterMember[] = [
  {
    halfWidthShare: 0.62,
    offsetShare: -0.35,
    heightShare: 0.5,
    setBackTiles: 0.07,
    primary: false,
    form: 'blocky',
  },
  {
    halfWidthShare: 0.9,
    offsetShare: 0.08,
    heightShare: 1,
    setBackTiles: 0,
    primary: true,
  },
];

/** How much a set-back stone is dulled, so it sits behind the ones in front. */
const SET_BACK_DIM = -0.16;

interface RockVertex {
  readonly x: number;
  readonly y: number;
}

/** One stone: a closed outline plus the frame of reference it was built in. */
interface Stone {
  readonly centreX: number;
  readonly baseY: number;
  readonly halfWidth: number;
  readonly height: number;
  readonly outline: ReadonlyArray<RockVertex>;
  readonly form: FormProfile;
  /** Extra shading applied to the whole stone; negative recedes. */
  readonly dim: number;
}

function parseColor(hex: string): readonly [number, number, number] {
  const HEX_RADIX = 16;
  const RED_START = 1;
  const CHANNEL_DIGITS = 2;
  const red = Number.parseInt(hex.slice(RED_START, RED_START + CHANNEL_DIGITS), HEX_RADIX);
  const green = Number.parseInt(
    hex.slice(RED_START + CHANNEL_DIGITS, RED_START + CHANNEL_DIGITS * 2),
    HEX_RADIX,
  );
  const blue = Number.parseInt(
    hex.slice(RED_START + CHANNEL_DIGITS * 2, RED_START + CHANNEL_DIGITS * 3),
    HEX_RADIX,
  );
  return [red, green, blue];
}

const CHANNEL_MAX = 255;

function shadeChannels(hex: string, amount: number): readonly [number, number, number] {
  const [red, green, blue] = parseColor(hex);
  const target = amount >= 0 ? CHANNEL_MAX : 0;
  const weight = Math.abs(amount);
  const mix = (channel: number): number => Math.round(channel + (target - channel) * weight);
  return [mix(red), mix(green), mix(blue)];
}

/** Mixes toward white for `amount > 0` and toward black for `amount < 0`. */
function shade(hex: string, amount: number): string {
  const [red, green, blue] = shadeChannels(hex, amount);
  return `rgb(${red},${green},${blue})`;
}

/**
 * The same colour at a chosen alpha.
 *
 * A gradient that fades to `rgba(0,0,0,0)` fades to transparent *black*, and
 * canvas interpolates the channels un-premultiplied — so the midpoint is a
 * half-opaque dark grey and the band reads as a dirty stripe rather than as a
 * fade. Fading to the same RGB at zero alpha is what makes it disappear.
 */
function shadeAlpha(hex: string, amount: number, alpha: number): string {
  const [red, green, blue] = shadeChannels(hex, amount);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/**
 * Builds one stone's outline as a front elevation: an ellipse of the requested
 * height and half-width, wobbled by the form's harmonics, tapered toward the
 * crown, sheared if the form leans, and then **normalised** so the finished
 * outline touches exactly `halfWidth` either side of its centre and exactly
 * `height` above its base.
 *
 * The normalisation is not tidiness. Taper and shear both move vertices, so a
 * shape merely *started* inside the width budget can finish outside it — which
 * is how solid pixels reached the neighbouring, walkable tile before.
 */
function buildStone(
  centreX: number,
  baseY: number,
  halfWidth: number,
  height: number,
  form: FormProfile,
  dim: number,
  rng: Rng,
): Stone {
  const phases = form.harmonics.map(() => range(rng, 0, TWO_PI));
  // Jittering *where the corners sit* rather than how far out they reach is what
  // makes the edges uneven in length without making the outline spiky. Radius
  // jitter puts a spur wherever two neighbours disagree; angle jitter only ever
  // moves a corner along the outline it already had.
  const cornerAngles = Array.from({ length: form.vertices }, (unused, index) => {
    const even = (index / form.vertices) * TWO_PI;
    return even + range(rng, -CORNER_ANGLE_JITTER, CORNER_ANGLE_JITTER) * (TWO_PI / form.vertices);
  });
  const radiusAt = (angle: number): number => {
    let radius = 1;
    form.harmonics.forEach((amplitude, harmonic) => {
      radius += Math.sin(angle * (harmonic + 1) + phases[harmonic]) * amplitude;
    });
    return radius;
  };

  const halfHeight = height / 2;
  const centreY = baseY - halfHeight;
  const exponent = 2 / form.squareness;
  const superellipse = (value: number): number => Math.sign(value) * Math.abs(value) ** exponent;
  const raw: RockVertex[] = [];
  for (let i = 0; i < form.vertices; i++) {
    const angle = cornerAngles[i];
    const wobble = radiusAt(angle);
    // The rock sits *on* the ground, so nothing may dip below its base line —
    // otherwise a boulder reads as half-buried, and on a slope of them the
    // ground line stops being a line at all.
    const y = Math.min(baseY, centreY + superellipse(Math.sin(angle)) * halfHeight * wobble);
    const heightFraction = (baseY - y) / height;
    const taperScale = 1 - form.taper * heightFraction * heightFraction;
    const leanShift = form.lean * (baseY - y);
    const x = centreX + superellipse(Math.cos(angle)) * halfWidth * wobble * taperScale + leanShift;
    raw.push({ x, y });
  }

  let maxOffset = 0;
  let minY = baseY;
  for (const vertex of raw) {
    maxOffset = Math.max(maxOffset, Math.abs(vertex.x - centreX));
    minY = Math.min(minY, vertex.y);
  }
  const widthScale = maxOffset === 0 ? 1 : halfWidth / maxOffset;
  const reachedHeight = baseY - minY;
  const heightScale = reachedHeight === 0 ? 1 : height / reachedHeight;
  const outline = raw.map((vertex) => ({
    x: centreX + (vertex.x - centreX) * widthScale,
    y: baseY - (baseY - vertex.y) * heightScale,
  }));

  return { centreX, baseY, halfWidth, height, outline, form, dim };
}

function traceOutline(ctx: Ctx, outline: ReadonlyArray<RockVertex>): void {
  ctx.beginPath();
  outline.forEach((vertex, index) => {
    if (index === 0) ctx.moveTo(vertex.x, vertex.y);
    else ctx.lineTo(vertex.x, vertex.y);
  });
  ctx.closePath();
}

/**
 * Soft dark ellipse where the rock meets the ground.
 *
 * The gradient is built **after** the transform and centred on the local origin.
 * A canvas gradient resolves its coordinates in the user space in effect when it
 * is *painted*, not when it is created — so one built at `(cx, baseY)` and then
 * painted under `translate(cx, baseY)` lands at `(2cx, 2baseY)` and every filled
 * pixel falls past its outer stop, painting nothing at all. That exact mistake
 * shipped shadowless art on all thirteen tree sheets.
 */
function paintContactShadow(ctx: Ctx, stone: Stone, maxDropPx: number): void {
  const rx = stone.halfWidth * CONTACT_SHADOW_WIDTH_RATIO;
  const ry = Math.min(stone.halfWidth * CONTACT_SHADOW_HEIGHT_RATIO, maxDropPx);
  if (rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(stone.centreX, stone.baseY);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
  gradient.addColorStop(
    CONTACT_SHADOW_MID_STOP,
    `rgba(0,0,0,${CONTACT_SHADOW_ALPHA * CONTACT_SHADOW_MID_ALPHA_FRACTION})`,
  );
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * The wall: the base tone broken into vertical panels, each shaded by how far
 * round the mass it faces.
 *
 * Every fill here relies on the silhouette clip the caller has already set, so
 * the panels can be plain rectangles spanning well past the outline. That is
 * what keeps the panel edges straight — a panel trimmed to the outline by hand
 * would need the outline's crossings and would kink wherever a vertex fell
 * inside it.
 */
function paintWall(ctx: Ctx, stone: Stone, palette: Palette, rng: Rng): void {
  const left = stone.centreX - stone.halfWidth;
  const width = stone.halfWidth * 2;
  const top = stone.baseY - stone.height;
  const beyondRight = stone.centreX + stone.halfWidth * 2;

  ctx.fillStyle = shade(palette.body, stone.dim);
  ctx.fillRect(left, top, width, stone.height);

  const subPanels = (planeLeft: number, planeRight: number, planeShade: number): void => {
    const count = SUB_PANEL_COUNT_MIN + rangeInt(rng, 0, SUB_PANEL_COUNT_RANGE);
    for (let panel = 0; panel < count; panel++) {
      const from = range(rng, planeLeft, planeRight);
      const to = range(rng, planeLeft, planeRight);
      const shading = range(rng, -SUB_PANEL_SHADE_RANGE, SUB_PANEL_SHADE_RANGE);
      ctx.fillStyle = shade(palette.body, planeShade + shading + stone.dim);
      ctx.fillRect(Math.min(from, to), top, Math.abs(to - from), stone.height);
    }
  };

  const shoulderTopX =
    stone.centreX + stone.halfWidth * (SHOULDER_X_SHARE_MIN + rng() * SHOULDER_X_SHARE_RANGE);
  const shoulderBottomX =
    shoulderTopX + stone.halfWidth * (SHOULDER_DRIFT_MIN + rng() * SHOULDER_DRIFT_RANGE);

  subPanels(left, shoulderTopX, 0);

  // The side plane, painted as a quadrilateral running past the silhouette on
  // the right so the caller's clip decides its outer edge. Its inner edge is the
  // shoulder — the one hard value break that tells the eye this is a solid.
  ctx.fillStyle = shade(palette.body, SIDE_PLANE_SHADE + stone.dim);
  ctx.beginPath();
  ctx.moveTo(shoulderTopX, top);
  ctx.lineTo(beyondRight, top);
  ctx.lineTo(beyondRight, stone.baseY);
  ctx.lineTo(shoulderBottomX, stone.baseY);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(shoulderTopX, top);
  ctx.lineTo(beyondRight, top);
  ctx.lineTo(beyondRight, stone.baseY);
  ctx.lineTo(shoulderBottomX, stone.baseY);
  ctx.closePath();
  ctx.clip();
  subPanels(shoulderTopX, beyondRight, SIDE_PLANE_SHADE);
  ctx.restore();

  const gloomTop = stone.baseY - stone.height * GROUND_GLOOM_START;
  const gloom = ctx.createLinearGradient(0, gloomTop, 0, stone.baseY);
  gloom.addColorStop(0, 'rgba(0,0,0,0)');
  gloom.addColorStop(1, `rgba(0,0,0,${GROUND_GLOOM_ALPHA})`);
  ctx.fillStyle = gloom;
  ctx.fillRect(left, gloomTop, width, stone.baseY - gloomTop);
}

/**
 * The lit cap: everything above a seam that bows gently toward the viewer.
 *
 * Filled as a half-plane rather than as a polygon derived from the outline, for
 * the same reason the wall panels are: the caller's clip already trims it to the
 * silhouette exactly, and deriving the cap's own edge would need the outline's
 * crossings at the seam height and would gap wherever the two disagreed.
 */
function paintCap(ctx: Ctx, stone: Stone, palette: Palette, ts: number, rng: Rng): void {
  const capY = stone.baseY - stone.height * CAP_HEIGHT_FRACTION;
  const bow = ts * CAP_BOW_TILES;
  const left = stone.centreX - stone.halfWidth * 2;
  const right = stone.centreX + stone.halfWidth * 2;
  const top = stone.baseY - stone.height * 2;
  const jitter = ts * CAP_SEAM_JITTER_TILES;

  const seamPoints: RockVertex[] = [];
  for (let step = 0; step <= CAP_SEAM_SEGMENTS; step++) {
    const across = step / CAP_SEAM_SEGMENTS;
    const isEnd = step === 0 || step === CAP_SEAM_SEGMENTS;
    seamPoints.push({
      x: left + (right - left) * across,
      y: capY + Math.sin(Math.PI * across) * bow + (isEnd ? 0 : range(rng, -jitter, jitter)),
    });
  }
  const traceSeam = (): void => {
    ctx.beginPath();
    seamPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  };

  // Graded rather than flat: a top plane catches least light where it turns away
  // at the seam, and the grade is most of what keeps that edge from reading as a
  // painted line.
  const capGrade = ctx.createLinearGradient(0, top, 0, capY);
  capGrade.addColorStop(0, shade(palette.light, stone.dim));
  capGrade.addColorStop(1, shade(palette.light, stone.dim - CAP_GRADE_DEPTH));
  ctx.fillStyle = capGrade;
  traceSeam();
  ctx.lineTo(right, top);
  ctx.lineTo(left, top);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = shade(palette.shadow, stone.dim);
  ctx.lineWidth = ts * CAP_SEAM_WIDTH_TILES;
  ctx.globalAlpha = CAP_SEAM_ALPHA;
  ctx.lineCap = 'butt';
  traceSeam();
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The face immediately under the crown still catches some sky; without this
  // band the cap tone drops to the wall tone in one step and the two read as
  // separate materials rather than as two planes of one rock.
  const falloffBottom = capY + stone.height * CAP_FALLOFF_HEIGHT_FRACTION;
  const falloff = ctx.createLinearGradient(0, capY, 0, falloffBottom);
  falloff.addColorStop(0, shadeAlpha(palette.body, CAP_FALLOFF_LIFT + stone.dim, 1));
  falloff.addColorStop(1, shadeAlpha(palette.body, CAP_FALLOFF_LIFT + stone.dim, 0));
  ctx.fillStyle = falloff;
  ctx.beginPath();
  seamPoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(right, falloffBottom);
  ctx.lineTo(left, falloffBottom);
  ctx.closePath();
  ctx.fill();
}

/** A bright line along the part of the outline that faces the light. */
function paintRimLight(ctx: Ctx, stone: Stone, palette: Palette, ts: number): void {
  const { outline, centreX, baseY, height } = stone;
  const midY = baseY - height / 2;
  ctx.strokeStyle = shade(palette.rim, stone.dim);
  ctx.lineWidth = ts * RIM_WIDTH_TILES;
  ctx.globalAlpha = RIM_ALPHA;
  ctx.lineCap = 'round';
  for (let i = 0; i < outline.length; i++) {
    const from = outline[i];
    const to = outline[(i + 1) % outline.length];
    const edgeMidX = (from.x + to.x) / 2;
    const edgeMidY = (from.y + to.y) / 2;
    const outX = edgeMidX - centreX;
    const outY = edgeMidY - midY;
    const length = Math.hypot(outX, outY);
    if (length === 0) continue;
    const facing = (outX / length) * LIGHT_X + (outY / length) * LIGHT_Y;
    if (facing < RIM_ARC_DOT_THRESHOLD) continue;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Dark seams wandering down from the crown. Granite's signature. */
function paintCracks(ctx: Ctx, stone: Stone, palette: Palette, ts: number, rng: Rng): void {
  ctx.strokeStyle = palette.crack;
  ctx.lineWidth = ts * CRACK_WIDTH_TILES;
  ctx.globalAlpha = CRACK_ALPHA;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const crackCount = CRACK_COUNT_MIN + rangeInt(rng, 0, CRACK_COUNT_RANGE);
  for (let i = 0; i < crackCount; i++) {
    const startX = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth);
    const startY = stone.baseY - stone.height * range(rng, CAP_HEIGHT_FRACTION, 1);
    const length = stone.height * (CRACK_LENGTH_MIN + rng() * CRACK_LENGTH_RANGE);
    // Downward, because a seam on a standing face runs with gravity — the first
    // cut fired them at a uniformly random heading from a point on the top
    // plate, which drew a star wherever two happened to oppose.
    let angle = Math.PI / 2 + range(rng, -CRACK_WANDER, CRACK_WANDER);
    let x = startX;
    let y = startY;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let segment = 0; segment < CRACK_SEGMENTS; segment++) {
      angle += range(rng, -CRACK_WANDER, CRACK_WANDER);
      x += (Math.cos(angle) * length) / CRACK_SEGMENTS;
      y = Math.min(stone.baseY, y + (Math.sin(angle) * length) / CRACK_SEGMENTS);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Sandstone strata: near-horizontal bands sagging slightly across the face. */
function paintBedding(ctx: Ctx, stone: Stone, palette: Palette, ts: number, rng: Rng): void {
  const left = stone.centreX - stone.halfWidth * 2;
  const right = stone.centreX + stone.halfWidth * 2;
  const sag = ts * BEDDING_SAG_TILES;
  ctx.lineWidth = ts * BEDDING_WIDTH_TILES;
  ctx.globalAlpha = BEDDING_ALPHA;
  // Every stroking painter sets its own cap. Inheriting one makes a mark's shape
  // depend on which lithology drew before it — including on the *previous
  // stone*, since the context is shared across a cluster.
  ctx.lineCap = 'butt';
  const bandCount = BEDDING_COUNT_MIN + rangeInt(rng, 0, BEDDING_COUNT_RANGE);
  for (let band = 0; band < bandCount; band++) {
    const slotPosition = range(rng, BEDDING_SLOT_INSET_MIN, BEDDING_SLOT_INSET_MAX);
    const y = stone.baseY - stone.height * ((band + slotPosition) / bandCount);
    ctx.strokeStyle = band % 2 === 0 ? palette.crack : palette.rim;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.quadraticCurveTo(stone.centreX, y + sag, right, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Basalt columns: steep joints running the height of the face. */
function paintFractures(ctx: Ctx, stone: Stone, palette: Palette, ts: number, rng: Rng): void {
  ctx.lineWidth = ts * FRACTURE_WIDTH_TILES;
  ctx.globalAlpha = FRACTURE_ALPHA;
  ctx.lineCap = 'butt';
  const columnCount = FRACTURE_COUNT_MIN + rangeInt(rng, 0, FRACTURE_COUNT_RANGE);
  for (let column = 0; column < columnCount; column++) {
    const x = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth);
    const lean = range(rng, -FRACTURE_LEAN, FRACTURE_LEAN) * stone.height;
    // Joints that ran the full height turned the rock into corrugated iron —
    // every line the same length, starting and ending on the same two rows. Each
    // one now covers its own span of the face.
    const from = stone.baseY - stone.height * range(rng, FRACTURE_TOP_MIN, 1);
    const to = stone.baseY - stone.height * range(rng, 0, FRACTURE_BOTTOM_MAX);
    ctx.strokeStyle = column % 3 === 0 ? palette.light : palette.crack;
    ctx.beginPath();
    ctx.moveTo(x + lean, from);
    ctx.lineTo(x, to);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Limestone: solution pits, and rain grooves running down from the crown. */
function paintKarst(ctx: Ctx, stone: Stone, palette: Palette, ts: number, rng: Rng): void {
  ctx.globalAlpha = PIT_ALPHA;
  const pitCount = PIT_COUNT_MIN + rangeInt(rng, 0, PIT_COUNT_RANGE);
  for (let pit = 0; pit < pitCount; pit++) {
    const radius = ts * (PIT_RADIUS_TILES_MIN + rng() * PIT_RADIUS_TILES_RANGE);
    const x = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth);
    const y = stone.baseY - stone.height * rng();
    ctx.fillStyle = palette.crack;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
    // A lit lower lip is what makes a mark read as a hollow rather than a spot.
    ctx.fillStyle = palette.rim;
    ctx.beginPath();
    ctx.arc(x, y + radius / 2, radius / 2, 0, TWO_PI);
    ctx.fill();
  }

  ctx.globalAlpha = GROOVE_ALPHA;
  ctx.strokeStyle = palette.crack;
  ctx.lineWidth = ts * GROOVE_WIDTH_TILES;
  ctx.lineCap = 'round';
  const grooveCount = GROOVE_COUNT_MIN + rangeInt(rng, 0, GROOVE_COUNT_RANGE);
  const capY = stone.baseY - stone.height * CAP_HEIGHT_FRACTION;
  for (let groove = 0; groove < grooveCount; groove++) {
    const x = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth);
    ctx.beginPath();
    ctx.moveTo(x, capY);
    ctx.quadraticCurveTo(
      x + range(rng, -stone.halfWidth, stone.halfWidth) / 2,
      (capY + stone.baseY) / 2,
      x + range(rng, -stone.halfWidth, stone.halfWidth) / 3,
      stone.baseY,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A cleft splitting the mass, with a lit lip on its left shoulder. */
function paintCleft(ctx: Ctx, stone: Stone, palette: Palette, rng: Rng): void {
  const width = stone.halfWidth * 2 * CLEFT_WIDTH_SHARE;
  const topX = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth) / 2;
  const top = stone.baseY - stone.height;
  const bottomY = stone.baseY - stone.height * (1 - CLEFT_DEPTH_SHARE);
  const bottomX = topX + stone.halfWidth * range(rng, -CLEFT_LEAN, CLEFT_LEAN);

  ctx.fillStyle = shade(palette.shadow, stone.dim);
  ctx.beginPath();
  ctx.moveTo(topX - width / 2, top);
  ctx.lineTo(topX + width / 2, top);
  ctx.lineTo(bottomX, bottomY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = shade(palette.rim, stone.dim);
  ctx.lineWidth = width / 3;
  ctx.globalAlpha = RIM_ALPHA;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(topX - width / 2, top);
  ctx.lineTo(bottomX, bottomY);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function paintSpeckle(
  ctx: Ctx,
  stone: Stone,
  palette: Palette,
  lithology: Lithology,
  ts: number,
  rng: Rng,
): void {
  const areaInTiles = (stone.halfWidth * 2 * stone.height) / (ts * ts);
  const total = Math.round(SPECKLE_PER_TILE * SPECKLE_DENSITY[lithology] * areaInTiles);
  const radius = ts * SPECKLE_RADIUS_TILES;
  ctx.globalAlpha = SPECKLE_ALPHA;
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = rng() > 0.5 ? palette.light : palette.shadow;
    const x = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth);
    const y = stone.baseY - stone.height * rng();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintMoss(ctx: Ctx, stone: Stone, rng: Rng): void {
  const coverage = MOSS_COVERAGE_MIN + rng() * MOSS_COVERAGE_RANGE;
  const patchCount = Math.round(
    (MOSS_PATCHES_MIN + rangeInt(rng, 0, MOSS_PATCHES_RANGE)) * coverage,
  );
  ctx.globalAlpha = MOSS_ALPHA;
  for (let patch = 0; patch < patchCount; patch++) {
    const heightFraction = Math.min(
      1,
      Math.max(0, MOSS_HEIGHT_BIAS + range(rng, -MOSS_HEIGHT_SPREAD, MOSS_HEIGHT_SPREAD)),
    );
    const patchX = stone.centreX + range(rng, -stone.halfWidth, stone.halfWidth);
    const patchY = stone.baseY - stone.height * heightFraction;
    const radius = stone.halfWidth * (MOSS_PATCH_RADIUS_MIN + rng() * MOSS_PATCH_RADIUS_RANGE);
    ctx.fillStyle = rng() > MOSS_SPECK_SHARE ? MOSS_LIGHT : MOSS_DARK;
    // One path for the whole clump, so the overlapping lobes merge into a single
    // ragged shape rather than showing each other's outlines through the alpha.
    ctx.beginPath();
    for (let lobe = 0; lobe < MOSS_LOBES_PER_PATCH; lobe++) {
      const lobeAngle = range(rng, 0, TWO_PI);
      const lobeReach = rng() * MOSS_LOBE_SPREAD;
      const lobeX = patchX + Math.cos(lobeAngle) * radius * lobeReach;
      const lobeY = patchY + Math.sin(lobeAngle) * radius * lobeReach;
      const lobeSize = radius * (MOSS_LOBE_SIZE_MIN + rng() * MOSS_LOBE_SIZE_RANGE);
      ctx.moveTo(lobeX + lobeSize, lobeY);
      ctx.arc(lobeX, lobeY, lobeSize, 0, TWO_PI);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintSurface(
  ctx: Ctx,
  stone: Stone,
  palette: Palette,
  lithology: Lithology,
  ts: number,
  rng: Rng,
): void {
  switch (lithology) {
    case 'granite':
      paintCracks(ctx, stone, palette, ts, rng);
      return;
    case 'sandstone':
      paintBedding(ctx, stone, palette, ts, rng);
      return;
    case 'basalt':
      paintFractures(ctx, stone, palette, ts, rng);
      return;
    case 'limestone':
      paintKarst(ctx, stone, palette, ts, rng);
      return;
  }
}

/**
 * Paints one stone of a boulder.
 *
 * Every mark that lives *on* the body — wall, cap, speckle, surface, cleft,
 * moss, rim light and the seat — is drawn inside one silhouette clip. Without it
 * they spray past the outline and the rock grows a fuzzy halo.
 *
 * The clip is never lifted before the end, and the seat in particular must stay
 * inside it. The seat is a rect spanning the stone's full half-width either
 * side, but the silhouette has tapered in by the time it reaches the ground, so
 * outside the clip it paints hard square corners sticking out past the rock's
 * own outline. Measured by lifting the clip in a scratch bake: 130 pixels change
 * on `boulder_large_a`, all of them inside the blocked tile — so this is a
 * silhouette problem, not a footprint one, and `assertBodyFitsBlockedTile` would
 * not catch it.
 *
 * The contact shadow is the one thing painted outside the clip, by the caller,
 * before this runs.
 */
function paintStone(
  ctx: Ctx,
  stone: Stone,
  spec: RockSpec,
  seed: number,
  ts: number,
  maxDropPx: number,
): void {
  const palette = PALETTES[spec.lithology];
  paintContactShadow(ctx, stone, maxDropPx);

  ctx.save();
  traceOutline(ctx, stone.outline);
  ctx.clip();

  paintWall(ctx, stone, palette, mulberry32(subSeed(seed, 2)));
  paintCap(ctx, stone, palette, ts, mulberry32(subSeed(seed, 8)));
  paintSpeckle(ctx, stone, palette, spec.lithology, ts, mulberry32(subSeed(seed, 3)));
  paintSurface(ctx, stone, palette, spec.lithology, ts, mulberry32(subSeed(seed, 4)));
  if (stone.form.cleft) paintCleft(ctx, stone, palette, mulberry32(subSeed(seed, 5)));
  paintMoss(ctx, stone, mulberry32(subSeed(seed, 6)));
  // Inside the clip too, so the lit edge lands exactly on the silhouette rather
  // than a half-line outside it.
  paintRimLight(ctx, stone, palette, ts);

  ctx.fillStyle = shade(palette.shadow, SEAT_DEEPEN + stone.dim);
  ctx.globalAlpha = SEAT_ALPHA;
  ctx.fillRect(
    stone.centreX - stone.halfWidth,
    stone.baseY - ts * SEAT_DEPTH_TILES,
    stone.halfWidth * 2,
    ts * SEAT_DEPTH_TILES,
  );
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Paints one boulder into its cell. */
export function drawBoulder(ctx: Ctx, spec: RockSpec, seed: number, frame: RockFrame): void {
  const ts = frame.tileScale;
  const centreX = frame.originX + ts / 2;
  const baseY = frame.originY + ts - ts * BASE_LIFT_TILES;
  const budget = ts * MAX_HALF_WIDTH_TILES;

  const sizeRng: Rng = mulberry32(subSeed(seed, 1));
  const isLarge = spec.size === 'large';
  const height =
    ts *
    (isLarge
      ? LARGE_HEIGHT_TILES_MIN + sizeRng() * LARGE_HEIGHT_TILES_RANGE
      : SMALL_HEIGHT_TILES_MIN + sizeRng() * SMALL_HEIGHT_TILES_RANGE);
  const primaryWidthShare = isLarge
    ? 1
    : SMALL_HALF_WIDTH_SHARE_MIN + sizeRng() * SMALL_HALF_WIDTH_SHARE_RANGE;

  const cluster = isLarge ? LARGE_CLUSTER : SMALL_CLUSTER;
  cluster.forEach((member, index) => {
    const stone = buildStone(
      centreX + budget * member.offsetShare,
      baseY - ts * member.setBackTiles,
      budget * member.halfWidthShare * (member.primary ? primaryWidthShare : 1),
      height * member.heightShare,
      FORM_PROFILES[member.primary ? spec.form : member.form],
      member.setBackTiles > 0 ? SET_BACK_DIM : 0,
      mulberry32(subSeed(seed, 10 + index)),
    );
    paintStone(ctx, stone, spec, subSeed(seed, 20 + index), ts, frame.bottomY - stone.baseY);
  });
}
