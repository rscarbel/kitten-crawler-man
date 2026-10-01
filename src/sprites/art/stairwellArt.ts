/**
 * A flight of stairs going down through the floor, seen from above.
 *
 * The picture is one-point perspective onto a real staircase rather than a
 * stack of shrinking bars: every corner is a point in the shaft — across, along
 * and below the floor — projected toward a vanishing point just past the
 * shaft's far end. The treads, the risers between them, the two side walls and
 * the courses laid in those walls are all cut from that one geometry, so they
 * recede together and the stepped foot of each wall meets the flight exactly.
 *
 * Three cues carry "down" at game size, and the light is the strongest of them:
 *
 * - **Depth falloff.** Light comes in through the opening only, so every
 *   surface is darkened by how far below the floor it lies, and the far end of
 *   the flight goes black.
 * - **Key light from the upper left**, the same light the rest of the game is
 *   lit from: the east wall's face catches it, the west wall's face is in its
 *   own shade, and the west wall throws a shadow across the treads that widens
 *   the deeper they go.
 * - **The rim.** The opening is framed by a lip at floor level that overhangs
 *   the shaft, with the shaft's walls in its shadow, so the flight is plainly
 *   below the floor the player is standing on.
 *
 * The flight descends away from the player — up the screen — so the player
 * walks onto it from the south, where the top step is flush with the floor.
 */

import { mulberry32, type Rng } from '../person/rng';

type Ctx = CanvasRenderingContext2D;
type Rgb = readonly [number, number, number];

/** Which place the stairwell is cut into, and so what it is built of. */
export type StairwellStyleId = 'cellars' | 'service_level' | 'street';

// ── Geometry, as fractions of the footprint's side ───────────────────────────

/** The opening in the floor. Inset from the footprint so the rim fits around it. */
const OPENING_LEFT = 0.13;
const OPENING_RIGHT = 0.87;
const OPENING_TOP = 0.16;
const OPENING_BOTTOM = 0.89;
/** Width of the lip framing the opening on its west, north and east sides. */
const RIM_WIDTH = 0.08;
/** Depth of the threshold slab the flight starts from, south of the opening. */
const THRESHOLD_DEPTH = 0.06;

/**
 * Where the shaft's lines converge: over the near end of the flight, where a
 * crawler standing at the top would be looking down from. From there the far
 * wall is seen face-on, the treads stack like shingles with each nosing
 * hiding the riser below it, and the flight plainly falls away.
 */
const VANISH_X = 0.5;
const VANISH_Y = 0.72;
/**
 * Depth below the floor at which the picture has shrunk to half size. Larger
 * flattens the view toward a plan; smaller makes the shaft plunge.
 */
const HALF_SCALE_DEPTH = 0.62;

const STEP_COUNT = 7;
/** Rise over run of one step: steeper than a house stair, as a service stair is. */
const STEP_PITCH = 0.95;

// ── Light ────────────────────────────────────────────────────────────────────

/** Depth over which light through the opening falls to 1/e. */
const LIGHT_FALLOFF_DEPTH = 0.45;
/** The darkest a lit surface ever gets; below this it is the shaft's own black. */
const DEPTH_LIGHT_FLOOR = 0.06;
const TREAD_LIGHT = 1.08;
/** A riser is a vertical face turned away from an overhead light. */
const RISER_LIGHT = 0.8;
/** The east wall faces the key light; the west wall stands in its own shade. */
const EAST_WALL_LIGHT = 0.86;
const WEST_WALL_LIGHT = 0.5;
/** The far wall faces away from the key light and is lit only by what bounces down. */
const NORTH_WALL_LIGHT = 0.62;
/** How far down the far wall, as a share of the shaft's depth, it starts to sink into black. */
const FOOT_FADE_START = 0.45;
/** How far the west wall's shadow reaches east across a tread, per unit of depth. */
const WALL_SHADOW_SPREAD = 0.42;
const WALL_SHADOW_ALPHA = 0.42;
/** The overhang's shadow on the shaft walls just under the rim. */
const LIP_SHADOW_DEPTH = 0.07;
const LIP_SHADOW_ALPHA = 0.55;
const NOSING_HIGHLIGHT_ALPHA = 0.85;
const NOSING_LIGHTEN = 1.4;
/** Nosing line thickness, as a share of the tread's drawn width. */
const NOSING_WIDTH = 0.022;
const STEEL_NOSING_ALPHA = 0.9;
/** A tread's heel sits under the riser above it, out of the light. */
const TREAD_HEEL_SHADE = 0.72;
/** A riser darkens toward its foot, deeper in the shaft than its nosing. */
const RISER_FOOT_SHADE = 0.6;
/** The dark crease where a riser meets the tread below it. */
const HEEL_SHADOW_ALPHA = 0.5;
const HEEL_SHADOW_SHARE = 0.28;
/** A tread is worn into a shallow dish down its middle by everyone who used it. */
const WEAR_BAND_HALF_WIDTH = 0.22;
const WEAR_LIGHTEN_ALPHA = 0.14;
const SHAFT_BLACK = '#050406';

// ── Masonry ─────────────────────────────────────────────────────────────────

/** Courses laid up the shaft walls, each this deep. */
const WALL_COURSE_DEPTH = 0.075;
/** Length of one block along the wall, in the plan. */
const WALL_BLOCK_LENGTH = 0.17;
/** Per-block tonal spread, so a wall reads as laid stones rather than paint. */
const BLOCK_TONE_SPREAD = 0.12;
const JOINT_ALPHA = 0.4;
const GRAIN_DOTS_PER_SURFACE = 22;
const GRAIN_ALPHA = 0.18;
const GRAIN_DOT_SIZE = 0.008;

/** Rim slabs along each side, and how much one varies from the next. */
const RIM_SLABS_PER_SIDE = 3;
const RIM_SLAB_TONE_SPREAD = 0.1;
const RIM_INNER_HIGHLIGHT = 0.012;
const RIM_JOINT_WIDTH = 0.008;
const RIM_CHIP_SIZE = 0.022;
/** Shadow the whole surround throws onto the floor south and east of it. */
const RIM_DROP_SHADOW = 0.012;
const RIM_DROP_SHADOW_ALPHA = 0.35;

// ── Kerb ────────────────────────────────────────────────────────────────────

/** The kerb's south-facing faces: the inner face over the shaft is the dimmer. */
const KERB_INNER_FACE_LIGHT = 0.62;
const KERB_END_FACE_LIGHT = 0.74;
/** A standing face darkens toward its foot, where it meets the floor. */
const KERB_FACE_FOOT_SHADE = 0.8;
/** The threshold is the most-trodden stone of all, worn a shade paler. */
const THRESHOLD_LIGHT = 1.06;
const SLAB_LIT_CORNER = 1.1;
const SLAB_SHADED_CORNER = 0.88;
const ARRIS_LIGHT = 1.3;
const ARRIS_ALPHA = 0.8;
const CHIP_SIZE_MIN = 0.5;
const CHIP_ASPECT = 0.7;
const CHIP_ALPHA = 0.7;
const HALF = 0.5;

// ── Hazard striping (service level) ─────────────────────────────────────────

const HAZARD_STRIPE_PERIOD = 0.05;
const HAZARD_BAND = 0.03;
const HAZARD_YELLOW: Rgb = [214, 168, 40];
const HAZARD_BLACK: Rgb = [28, 26, 22];
/** A painted stripe on a busy service stair is scuffed half away. */
const HAZARD_WEAR_ALPHA = 0.82;

interface StairwellStyle {
  readonly tread: Rgb;
  readonly riser: Rgb;
  readonly wall: Rgb;
  readonly rim: Rgb;
  readonly joint: Rgb;
  /** Steel nosing strips on every tread rather than a worn stone arris. */
  readonly steelNosing: boolean;
  readonly hazardStripes: boolean;
  /** How far the surround stands up off the floor. */
  readonly kerbHeight: number;
  readonly chipCount: number;
  readonly seed: number;
}

/**
 * Colours are each place's own, pitched so the rim sits at its floor's
 * brightness: the cellars' warm sandstone flags, the service level's poured
 * concrete beside its green tile, and the town terrace's grey granite.
 */
const STYLES: Readonly<Record<StairwellStyleId, StairwellStyle>> = {
  cellars: {
    tread: [150, 138, 116],
    riser: [118, 106, 88],
    wall: [124, 112, 94],
    rim: [136, 125, 106],
    joint: [52, 45, 37],
    steelNosing: false,
    hazardStripes: false,
    kerbHeight: 0.022,
    chipCount: 6,
    seed: 0x5ce11a,
  },
  service_level: {
    tread: [148, 150, 144],
    riser: [116, 120, 114],
    wall: [104, 122, 110],
    rim: [122, 126, 120],
    joint: [42, 46, 44],
    steelNosing: true,
    hazardStripes: true,
    kerbHeight: 0.035,
    chipCount: 2,
    seed: 0x5e2f1c,
  },
  street: {
    tread: [168, 166, 160],
    riser: [130, 128, 124],
    wall: [138, 135, 128],
    rim: [158, 156, 150],
    joint: [64, 62, 60],
    steelNosing: false,
    hazardStripes: false,
    kerbHeight: 0.05,
    chipCount: 1,
    seed: 0x57ee7,
  },
};

const STEEL: Rgb = [176, 182, 188];

function rgba(color: Rgb, light: number, alpha = 1): string {
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value * light)));
  return `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${alpha})`;
}

/** How much of the opening's light reaches a surface this far below the floor. */
function depthLight(depth: number): number {
  return Math.max(DEPTH_LIGHT_FLOOR, Math.exp(-depth / LIGHT_FALLOFF_DEPTH));
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** A point in the shaft: plan position on the floor, and depth below it, in footprint units. */
interface ShaftPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

/** Projects shaft points into the frame, `size` pixels a side with its corner at the origin. */
function projector(originX: number, originY: number, size: number): (p: ShaftPoint) => Point {
  return (p) => {
    const shrink = 1 / (1 + p.depth / HALF_SCALE_DEPTH);
    return {
      x: originX + size * (VANISH_X + (p.x - VANISH_X) * shrink),
      y: originY + size * (VANISH_Y + (p.y - VANISH_Y) * shrink),
    };
  };
}

function tracePolygon(ctx: Ctx, points: ReadonlyArray<Point>): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function fillPolygon(ctx: Ctx, points: ReadonlyArray<Point>, fill: string): void {
  tracePolygon(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
}

const STEP_RUN = (OPENING_BOTTOM - OPENING_TOP) / STEP_COUNT;
const STEP_RISE = STEP_RUN * STEP_PITCH;

/** Plan y of the south edge of step `index`'s tread — where the riser above it stands. */
function stepSouthY(index: number): number {
  return OPENING_BOTTOM - index * STEP_RUN;
}

/** Depth of step `index`'s tread below the floor. */
function stepDepth(index: number): number {
  return (index + 1) * STEP_RISE;
}

/**
 * The outline of one side wall's face, from the rim down to its stepped foot,
 * where it meets each riser and tread of the flight.
 */
function wallFace(x: number): ShaftPoint[] {
  const outline: ShaftPoint[] = [
    { x, y: OPENING_TOP, depth: 0 },
    { x, y: OPENING_BOTTOM, depth: 0 },
  ];
  for (let index = 0; index < STEP_COUNT; index++) {
    outline.push({ x, y: stepSouthY(index), depth: stepDepth(index) });
    outline.push({ x, y: stepSouthY(index + 1), depth: stepDepth(index) });
  }
  return outline;
}

function paintGrain(
  ctx: Ctx,
  rng: Rng,
  size: number,
  bounds: ReadonlyArray<Point>,
  color: Rgb,
  light: number,
): void {
  const xs = bounds.map((p) => p.x);
  const ys = bounds.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const dot = Math.max(1, size * GRAIN_DOT_SIZE);
  for (let i = 0; i < GRAIN_DOTS_PER_SURFACE; i++) {
    const lighter = rng() < 0.5;
    ctx.fillStyle = rgba(color, light * (lighter ? 1.25 : 0.7), GRAIN_ALPHA);
    ctx.fillRect(minX + rng() * spanX, minY + rng() * spanY, dot, dot);
  }
}

/**
 * One shaft wall laid in courses. Each course is a band at one depth, so it
 * carries one light level, and its bed joints converge on the vanishing point
 * the way level lines on a real wall do.
 */
function paintWall(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  size: number,
  style: StairwellStyle,
  rng: Rng,
  x: number,
  faceLight: number,
): void {
  const outline = wallFace(x).map(project);
  const deepest = stepDepth(STEP_COUNT - 1);
  const blocksAlong = Math.ceil((OPENING_BOTTOM - OPENING_TOP) / WALL_BLOCK_LENGTH);
  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();
  for (let course = 0; course * WALL_COURSE_DEPTH < deepest; course++) {
    const top = course * WALL_COURSE_DEPTH;
    const bottom = top + WALL_COURSE_DEPTH;
    const stagger = course % 2 === 0 ? 0 : WALL_BLOCK_LENGTH / 2;
    for (let block = -1; block < blocksAlong; block++) {
      const south = OPENING_BOTTOM - block * WALL_BLOCK_LENGTH - stagger;
      const north = south - WALL_BLOCK_LENGTH;
      const tone = 1 + (rng() - 0.5) * 2 * BLOCK_TONE_SPREAD;
      const light = faceLight * depthLight((top + bottom) / 2) * tone;
      const quad = [
        project({ x, y: north, depth: top }),
        project({ x, y: south, depth: top }),
        project({ x, y: south, depth: bottom }),
        project({ x, y: north, depth: bottom }),
      ];
      fillPolygon(ctx, quad, rgba(style.wall, light));
      paintGrain(ctx, rng, size, quad, style.wall, light);
      ctx.strokeStyle = rgba(style.joint, depthLight(top), JOINT_ALPHA);
      ctx.lineWidth = 1;
      tracePolygon(ctx, quad);
      ctx.stroke();
    }
  }
  paintLipShadow(ctx, project, x);
  ctx.restore();
}

/**
 * The far wall the flight runs down to, facing the viewer across the shaft.
 * Its courses are level and square to the screen; only their length shrinks
 * with depth.
 */
function paintNorthWall(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  size: number,
  style: StairwellStyle,
  rng: Rng,
): void {
  const deepest = stepDepth(STEP_COUNT - 1);
  const width = OPENING_RIGHT - OPENING_LEFT;
  const blocksAcross = Math.ceil(width / WALL_BLOCK_LENGTH) + 1;
  const outline = [
    project({ x: OPENING_LEFT, y: OPENING_TOP, depth: 0 }),
    project({ x: OPENING_RIGHT, y: OPENING_TOP, depth: 0 }),
    project({ x: OPENING_RIGHT, y: OPENING_TOP, depth: deepest }),
    project({ x: OPENING_LEFT, y: OPENING_TOP, depth: deepest }),
  ];
  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();
  for (let course = 0; course * WALL_COURSE_DEPTH < deepest; course++) {
    const top = course * WALL_COURSE_DEPTH;
    const bottom = top + WALL_COURSE_DEPTH;
    const stagger = course % 2 === 0 ? 0 : WALL_BLOCK_LENGTH / 2;
    for (let block = -1; block < blocksAcross; block++) {
      const west = OPENING_LEFT + block * WALL_BLOCK_LENGTH - stagger;
      const east = west + WALL_BLOCK_LENGTH;
      const tone = 1 + (rng() - HALF) * 2 * BLOCK_TONE_SPREAD;
      const light = NORTH_WALL_LIGHT * depthLight((top + bottom) / 2) * tone;
      const quad = [
        project({ x: west, y: OPENING_TOP, depth: top }),
        project({ x: east, y: OPENING_TOP, depth: top }),
        project({ x: east, y: OPENING_TOP, depth: bottom }),
        project({ x: west, y: OPENING_TOP, depth: bottom }),
      ];
      fillPolygon(ctx, quad, rgba(style.wall, light));
      paintGrain(ctx, rng, size, quad, style.wall, light);
      ctx.strokeStyle = rgba(style.joint, depthLight(top), JOINT_ALPHA);
      ctx.lineWidth = 1;
      tracePolygon(ctx, quad);
      ctx.stroke();
    }
  }

  const lipFoot = project({ x: OPENING_LEFT, y: OPENING_TOP, depth: LIP_SHADOW_DEPTH });
  const lip = ctx.createLinearGradient(0, outline[0].y, 0, lipFoot.y);
  lip.addColorStop(0, `rgba(0, 0, 0, ${LIP_SHADOW_ALPHA})`);
  lip.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lip;
  tracePolygon(ctx, outline);
  ctx.fill();

  paintFootDarkness(ctx, project, outline, deepest);
  ctx.restore();
}

/**
 * The foot of the far wall is where the stairs carry on, under the floor and out
 * of the light, so the wall sinks into black there rather than ending on a line.
 */
function paintFootDarkness(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  outline: ReadonlyArray<Point>,
  deepest: number,
): void {
  const fadeTop = project({ x: OPENING_LEFT, y: OPENING_TOP, depth: deepest * FOOT_FADE_START });
  const foot = project({ x: OPENING_LEFT, y: OPENING_TOP, depth: deepest });
  const fade = ctx.createLinearGradient(0, fadeTop.y, 0, foot.y);
  fade.addColorStop(0, 'rgba(5, 4, 6, 0)');
  fade.addColorStop(1, SHAFT_BLACK);
  ctx.fillStyle = fade;
  tracePolygon(ctx, outline);
  ctx.fill();
}

/** The rim's overhang darkens the top of the wall it stands over. */
function paintLipShadow(ctx: Ctx, project: (p: ShaftPoint) => Point, x: number): void {
  const rimSouth = project({ x, y: OPENING_BOTTOM, depth: 0 });
  const rimNorth = project({ x, y: OPENING_TOP, depth: 0 });
  const shadedSouth = project({ x, y: OPENING_BOTTOM, depth: LIP_SHADOW_DEPTH });
  const shadedNorth = project({ x, y: OPENING_TOP, depth: LIP_SHADOW_DEPTH });
  const gradient = ctx.createLinearGradient(rimSouth.x, rimSouth.y, shadedSouth.x, rimSouth.y);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${LIP_SHADOW_ALPHA})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  tracePolygon(ctx, [rimNorth, rimSouth, shadedSouth, shadedNorth]);
  ctx.fill();
}

/** Paints the flight, far step first, so each nearer step overlaps the one beyond it. */
function paintFlight(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  size: number,
  style: StairwellStyle,
  rng: Rng,
): void {
  for (let index = STEP_COUNT - 1; index >= 0; index--) {
    const depth = stepDepth(index);
    const riserTop = depth - STEP_RISE;
    const south = stepSouthY(index);
    const north = stepSouthY(index + 1);
    const light = depthLight(depth);

    const tread = [
      project({ x: OPENING_LEFT, y: north, depth }),
      project({ x: OPENING_RIGHT, y: north, depth }),
      project({ x: OPENING_RIGHT, y: south, depth }),
      project({ x: OPENING_LEFT, y: south, depth }),
    ];
    // Brightest at the nosing, darkest at the heel under the riser that drops
    // to it: within each step the light climbs and then falls away, which is
    // what reads as a drop rather than a climb.
    const treadGradient = ctx.createLinearGradient(0, tread[3].y, 0, tread[0].y);
    treadGradient.addColorStop(0, rgba(style.tread, TREAD_LIGHT * light * TREAD_HEEL_SHADE));
    treadGradient.addColorStop(1, rgba(style.tread, TREAD_LIGHT * light));
    ctx.fillStyle = treadGradient;
    tracePolygon(ctx, tread);
    ctx.fill();
    paintGrain(ctx, rng, size, tread, style.tread, light);
    paintTreadWear(ctx, project, style, depth, north, south, light);
    paintWallShadow(ctx, project, depth, north, south);
    paintNosing(ctx, project, style, depth, north);

    // The riser drops from the nosing of the step nearer the viewer down to this
    // tread's heel, so its foot is the edge nearer the vanishing point.
    const riser = [
      project({ x: OPENING_LEFT, y: south, depth }),
      project({ x: OPENING_RIGHT, y: south, depth }),
      project({ x: OPENING_RIGHT, y: south, depth: riserTop }),
      project({ x: OPENING_LEFT, y: south, depth: riserTop }),
    ];
    const riserGradient = ctx.createLinearGradient(0, riser[3].y, 0, riser[0].y);
    riserGradient.addColorStop(0, rgba(style.riser, RISER_LIGHT * depthLight(riserTop)));
    riserGradient.addColorStop(1, rgba(style.riser, RISER_LIGHT * light * RISER_FOOT_SHADE));
    ctx.fillStyle = riserGradient;
    tracePolygon(ctx, riser);
    ctx.fill();
    paintGrain(ctx, rng, size, riser, style.riser, RISER_LIGHT * light);
    paintHeelShadow(ctx, riser);
    if (style.hazardStripes && index === 0) paintHazardBand(ctx, riser[3], riser[2], project);
  }
}

/** The polished dish down a tread's middle, where most feet land. */
function paintTreadWear(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  style: StairwellStyle,
  depth: number,
  north: number,
  south: number,
  light: number,
): void {
  const centre = (OPENING_LEFT + OPENING_RIGHT) / 2;
  const halfWidth = (OPENING_RIGHT - OPENING_LEFT) * WEAR_BAND_HALF_WIDTH;
  const left = project({ x: centre - halfWidth, y: south, depth });
  const right = project({ x: centre + halfWidth, y: south, depth });
  const gradient = ctx.createLinearGradient(left.x, 0, right.x, 0);
  const worn = rgba(style.tread, light * 1.3, WEAR_LIGHTEN_ALPHA);
  gradient.addColorStop(0, rgba(style.tread, light, 0));
  gradient.addColorStop(0.5, worn);
  gradient.addColorStop(1, rgba(style.tread, light, 0));
  ctx.fillStyle = gradient;
  tracePolygon(ctx, [
    project({ x: centre - halfWidth, y: north, depth }),
    project({ x: centre + halfWidth, y: north, depth }),
    right,
    left,
  ]);
  ctx.fill();
}

/** The west wall's shadow on a tread: wider the deeper the tread lies. */
function paintWallShadow(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  depth: number,
  north: number,
  south: number,
): void {
  const reach = Math.min(OPENING_RIGHT - OPENING_LEFT, depth * WALL_SHADOW_SPREAD);
  const edge = OPENING_LEFT + reach;
  const fadeStart = project({ x: OPENING_LEFT, y: south, depth });
  const fadeEnd = project({ x: edge, y: south, depth });
  const gradient = ctx.createLinearGradient(fadeStart.x, 0, fadeEnd.x, 0);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${WALL_SHADOW_ALPHA})`);
  gradient.addColorStop(0.7, `rgba(0, 0, 0, ${WALL_SHADOW_ALPHA * 0.6})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  tracePolygon(ctx, [
    project({ x: OPENING_LEFT, y: north, depth }),
    project({ x: edge, y: north, depth }),
    fadeEnd,
    fadeStart,
  ]);
  ctx.fill();
}

/** The crease at the foot of a riser, where the tread below meets it. */
function paintHeelShadow(ctx: Ctx, riser: ReadonlyArray<Point>): void {
  // A riser's deep edge — its heel — is the one nearer the vanishing point, so
  // it is the riser's upper edge on screen.
  const heelY = riser[0].y;
  const nosingY = riser[2].y;
  const creaseY = heelY + (nosingY - heelY) * HEEL_SHADOW_SHARE;
  const gradient = ctx.createLinearGradient(0, heelY, 0, creaseY);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${HEEL_SHADOW_ALPHA})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  tracePolygon(ctx, riser);
  ctx.fill();
}

/**
 * The lit edge where a tread drops away — the line the eye reads a step by.
 * Stone gets a worn arris; the service stair a steel strip.
 */
function paintNosing(
  ctx: Ctx,
  project: (p: ShaftPoint) => Point,
  style: StairwellStyle,
  depth: number,
  y: number,
): void {
  const left = project({ x: OPENING_LEFT, y, depth });
  const right = project({ x: OPENING_RIGHT, y, depth });
  const light = depthLight(depth);
  ctx.lineWidth = Math.max(1, (right.x - left.x) * NOSING_WIDTH);
  ctx.strokeStyle = style.steelNosing
    ? rgba(STEEL, light, STEEL_NOSING_ALPHA)
    : rgba(style.tread, light * NOSING_LIGHTEN, NOSING_HIGHLIGHT_ALPHA);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();
}

/** Hazard paint along the foot of the top riser, where the floor drops away. */
function paintHazardBand(
  ctx: Ctx,
  left: Point,
  right: Point,
  project: (p: ShaftPoint) => Point,
): void {
  const unit = project({ x: 1, y: 0, depth: 0 }).x - project({ x: 0, y: 0, depth: 0 }).x;
  const band = unit * HAZARD_BAND;
  const period = unit * HAZARD_STRIPE_PERIOD;
  const width = right.x - left.x;
  const { x, y } = left;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y - band, width, band);
  ctx.clip();
  ctx.fillStyle = rgba(HAZARD_BLACK, 1, HAZARD_WEAR_ALPHA);
  ctx.fillRect(x, y - band, width, band);
  ctx.fillStyle = rgba(HAZARD_YELLOW, 1, HAZARD_WEAR_ALPHA);
  for (let stripeX = x - band; stripeX < x + width; stripeX += period) {
    ctx.beginPath();
    ctx.moveTo(stripeX, y);
    ctx.lineTo(stripeX + period / 2, y);
    ctx.lineTo(stripeX + period / 2 + band, y - band);
    ctx.lineTo(stripeX + band, y - band);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

interface RimSlab {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A face of the kerb that stands up off the floor and is turned toward the viewer. */
interface KerbFace extends RimSlab {
  readonly light: number;
}

/**
 * The kerb's top slabs, west, north and east of the opening, in plan. The
 * threshold the flight starts from is flush with the floor and has no kerb.
 */
function kerbSlabs(): RimSlab[] {
  const outerLeft = OPENING_LEFT - RIM_WIDTH;
  const outerRight = OPENING_RIGHT + RIM_WIDTH;
  const outerTop = OPENING_TOP - RIM_WIDTH;
  const slabs: RimSlab[] = [];
  const sideLength = (OPENING_BOTTOM - OPENING_TOP) / RIM_SLABS_PER_SIDE;
  for (let i = 0; i < RIM_SLABS_PER_SIDE; i++) {
    const y = OPENING_TOP + i * sideLength;
    slabs.push({ x: outerLeft, y, w: RIM_WIDTH, h: sideLength });
    slabs.push({ x: OPENING_RIGHT, y, w: RIM_WIDTH, h: sideLength });
  }
  const topLength = (outerRight - outerLeft) / RIM_SLABS_PER_SIDE;
  for (let i = 0; i < RIM_SLABS_PER_SIDE; i++) {
    slabs.push({ x: outerLeft + i * topLength, y: outerTop, w: topLength, h: RIM_WIDTH });
  }
  return slabs;
}

/**
 * The kerb's faces that look south, toward the viewer: the inside of the north
 * kerb, standing over the shaft, and the cut ends of the side kerbs either side
 * of the threshold. These are what make the surround stand up off the floor.
 */
function kerbFaces(height: number): KerbFace[] {
  return [
    {
      x: OPENING_LEFT,
      y: OPENING_TOP - height,
      w: OPENING_RIGHT - OPENING_LEFT,
      h: height,
      light: KERB_INNER_FACE_LIGHT,
    },
    {
      x: OPENING_LEFT - RIM_WIDTH,
      y: OPENING_BOTTOM - height,
      w: RIM_WIDTH,
      h: height,
      light: KERB_END_FACE_LIGHT,
    },
    {
      x: OPENING_RIGHT,
      y: OPENING_BOTTOM - height,
      w: RIM_WIDTH,
      h: height,
      light: KERB_END_FACE_LIGHT,
    },
  ];
}

function paintSlab(
  ctx: Ctx,
  rng: Rng,
  size: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Rgb,
  joint: Rgb,
  tone: number,
): void {
  const bevel = ctx.createLinearGradient(x, y, x + w, y + h);
  bevel.addColorStop(0, rgba(color, tone * SLAB_LIT_CORNER));
  bevel.addColorStop(1, rgba(color, tone * SLAB_SHADED_CORNER));
  ctx.fillStyle = bevel;
  ctx.fillRect(x, y, w, h);
  paintGrain(
    ctx,
    rng,
    size,
    [
      { x, y },
      { x: x + w, y: y + h },
    ],
    color,
    tone,
  );
  ctx.strokeStyle = rgba(joint, 1, JOINT_ALPHA);
  ctx.lineWidth = Math.max(1, size * RIM_JOINT_WIDTH);
  ctx.strokeRect(x, y, w, h);
}

/**
 * The kerb's shadow on the floor, thrown down and right by the key light.
 * Painted before the shaft, which covers the part of it that would otherwise
 * darken the opening.
 */
function paintKerbShadow(ctx: Ctx, originX: number, originY: number, size: number): void {
  const px = (fraction: number): number => fraction * size;
  const outerLeft = OPENING_LEFT - RIM_WIDTH;
  const outerTop = OPENING_TOP - RIM_WIDTH;
  ctx.fillStyle = `rgba(0, 0, 0, ${RIM_DROP_SHADOW_ALPHA})`;
  ctx.fillRect(
    originX + px(outerLeft + RIM_DROP_SHADOW),
    originY + px(outerTop + RIM_DROP_SHADOW),
    px(OPENING_RIGHT - OPENING_LEFT + RIM_WIDTH * 2),
    px(OPENING_BOTTOM - outerTop),
  );
}

function paintRim(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  style: StairwellStyle,
  rng: Rng,
): void {
  const px = (fraction: number): number => fraction * size;
  const lift = px(style.kerbHeight);
  const outerLeft = OPENING_LEFT - RIM_WIDTH;
  const outerWidth = OPENING_RIGHT - OPENING_LEFT + RIM_WIDTH * 2;
  paintSlab(
    ctx,
    rng,
    size,
    originX + px(outerLeft),
    originY + px(OPENING_BOTTOM),
    px(outerWidth),
    px(THRESHOLD_DEPTH),
    style.rim,
    style.joint,
    THRESHOLD_LIGHT,
  );

  for (const face of kerbFaces(style.kerbHeight)) {
    const x = originX + px(face.x);
    const y = originY + px(face.y);
    const shade = ctx.createLinearGradient(0, y, 0, y + px(face.h));
    shade.addColorStop(0, rgba(style.rim, face.light));
    shade.addColorStop(1, rgba(style.rim, face.light * KERB_FACE_FOOT_SHADE));
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, px(face.w), px(face.h));
  }

  for (const slab of kerbSlabs()) {
    const tone = 1 + (rng() - 0.5) * 2 * RIM_SLAB_TONE_SPREAD;
    paintSlab(
      ctx,
      rng,
      size,
      originX + px(slab.x),
      originY + px(slab.y) - lift,
      px(slab.w),
      px(slab.h),
      style.rim,
      style.joint,
      tone,
    );
  }

  // The arris along the opening catches the light where the kerb breaks off.
  ctx.fillStyle = rgba(style.rim, ARRIS_LIGHT, ARRIS_ALPHA);
  const arris = Math.max(1, px(RIM_INNER_HIGHLIGHT));
  const sideTop = originY + px(OPENING_TOP) - lift;
  const sideLength = px(OPENING_BOTTOM - OPENING_TOP);
  ctx.fillRect(originX + px(OPENING_LEFT) - arris, sideTop, arris, sideLength);
  ctx.fillRect(originX + px(OPENING_RIGHT), sideTop, arris, sideLength);
  ctx.fillRect(
    originX + px(OPENING_LEFT),
    sideTop - arris,
    px(OPENING_RIGHT - OPENING_LEFT),
    arris,
  );
  ctx.fillRect(originX + px(outerLeft), originY + px(OPENING_BOTTOM), px(outerWidth), arris);

  // Chips knocked out of the kerb's inner edge.
  for (let i = 0; i < style.chipCount; i++) {
    const along = rng();
    const onWest = rng() < HALF;
    const chip = px(RIM_CHIP_SIZE) * (CHIP_SIZE_MIN + rng());
    const chipX = originX + px(onWest ? OPENING_LEFT : OPENING_RIGHT) - (onWest ? chip : 0);
    const chipY = sideTop + along * sideLength;
    ctx.fillStyle = rgba(style.joint, 1, CHIP_ALPHA);
    ctx.fillRect(chipX, chipY, chip, chip * CHIP_ASPECT);
  }

  if (style.hazardStripes) paintKerbHazard(ctx, originX, originY - lift, size);
}

/** Yellow-and-black paint along the inner edge of the service stair's kerb. */
function paintKerbHazard(ctx: Ctx, originX: number, originY: number, size: number): void {
  const px = (fraction: number): number => fraction * size;
  const period = px(HAZARD_STRIPE_PERIOD);
  const runLength = OPENING_BOTTOM - OPENING_TOP + HAZARD_BAND;
  const runs: ReadonlyArray<RimSlab> = [
    { x: OPENING_LEFT - HAZARD_BAND, y: OPENING_TOP - HAZARD_BAND, w: HAZARD_BAND, h: runLength },
    { x: OPENING_RIGHT, y: OPENING_TOP - HAZARD_BAND, w: HAZARD_BAND, h: runLength },
    {
      x: OPENING_LEFT,
      y: OPENING_TOP - HAZARD_BAND,
      w: OPENING_RIGHT - OPENING_LEFT,
      h: HAZARD_BAND,
    },
  ];
  for (const run of runs) {
    const x = originX + px(run.x);
    const y = originY + px(run.y);
    const w = px(run.w);
    const h = px(run.h);
    const sweep = Math.max(w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = rgba(HAZARD_BLACK, 1, HAZARD_WEAR_ALPHA);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(HAZARD_YELLOW, 1, HAZARD_WEAR_ALPHA);
    for (let offset = -sweep; offset < w + h; offset += period) {
      ctx.beginPath();
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset + period / 2, y);
      ctx.lineTo(x + offset + period / 2 - sweep, y + sweep);
      ctx.lineTo(x + offset - sweep, y + sweep);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * Paints a whole stairwell into a `size`-pixel square whose top-left corner is
 * at (originX, originY). Deterministic: the same style always paints the same
 * stones.
 */
export function paintStairwell(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  styleId: StairwellStyleId,
): void {
  const style = STYLES[styleId];
  const rng = mulberry32(style.seed);
  const project = projector(originX, originY, size);

  paintKerbShadow(ctx, originX, originY, size);
  ctx.save();
  const shaft = [
    project({ x: OPENING_LEFT, y: OPENING_TOP, depth: 0 }),
    project({ x: OPENING_RIGHT, y: OPENING_TOP, depth: 0 }),
    project({ x: OPENING_RIGHT, y: OPENING_BOTTOM, depth: 0 }),
    project({ x: OPENING_LEFT, y: OPENING_BOTTOM, depth: 0 }),
  ];
  tracePolygon(ctx, shaft);
  ctx.clip();
  fillPolygon(ctx, shaft, SHAFT_BLACK);
  paintWall(ctx, project, size, style, rng, OPENING_LEFT, WEST_WALL_LIGHT);
  paintWall(ctx, project, size, style, rng, OPENING_RIGHT, EAST_WALL_LIGHT);
  paintNorthWall(ctx, project, size, style, rng);
  paintFlight(ctx, project, size, style, rng);
  ctx.restore();

  paintRim(ctx, originX, originY, size, style, rng);
}
