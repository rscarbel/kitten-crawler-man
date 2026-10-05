/**
 * The Big Top maze's furniture, drawn live rather than baked into a sheet.
 *
 * What is left here is what the tent draws live every frame: the opened ways,
 * the act gates and exit doors, the fire itself, the lanterns' warnings and
 * pools, the name chips and the trail dressing. The act props that hold still
 * long enough to be baked live in `src/sprites/art/bigTop/`.
 *
 * The one rule that governs the whole file is the ownership language. A prop
 * Donut can act on is red-and-white striped canvas with gold trim and a gold
 * hoop drawn round it; a prop Carl can act on is deep circus blue and brass on
 * heavy timber, with brass strike chevrons. A player should be able to name the
 * prop and its owner from the colours alone at a 32-pixel tile.
 */

import { worldPlate } from '../ui/world/worldShapes';
import { worldText } from '../ui/world/worldText';
import {
  MIN_VISIBLE_ALPHA,
  flameStamps,
  gradientStopRgba,
  hashUnit,
  stampTeardrop,
  type FlameStamps,
} from './flameStamps';

// ── Palette ───────────────────────────────────────────────────────────────────

interface Ink {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Every translucent colour in the file goes through here.
 *
 * `gradientStopRgba` clamps and fixes the decimal, which is what keeps a tiny
 * computed alpha from formatting as exponent notation — a form some canvas
 * implementations reject outright, painting a solid smear where a whisper of
 * light was wanted.
 */
function inkRgba(ink: Ink, alpha: number): string {
  return gradientStopRgba(ink.r, ink.g, ink.b, alpha);
}

const STRIPE_RED_INK: Ink = { r: 198, g: 48, b: 56 };
const STRIPE_WHITE_INK: Ink = { r: 240, g: 231, b: 216 };
const GOLD_INK: Ink = { r: 240, g: 194, b: 70 };
const GOLD_DEEP_INK: Ink = { r: 170, g: 124, b: 30 };

const CIRCUS_BLUE_INK: Ink = { r: 29, g: 58, b: 116 };
const BRASS_INK: Ink = { r: 196, g: 148, b: 56 };
const BRASS_LIGHT_INK: Ink = { r: 232, g: 194, b: 116 };

const TIMBER_DARK_INK: Ink = { r: 58, g: 38, b: 18 };
const TIMBER_MID_INK: Ink = { r: 106, g: 72, b: 34 };

const IRON_DARK_INK: Ink = { r: 34, g: 39, b: 45 };
const IRON_MID_INK: Ink = { r: 76, g: 85, b: 95 };
const MASONRY_SHADE_INK: Ink = { r: 62, g: 56, b: 49 };

const ROPE_INK: Ink = { r: 200, g: 177, b: 132 };

const VELVET_INK: Ink = { r: 122, g: 22, b: 32 };
const LIMELIGHT_INK: Ink = { r: 255, g: 246, b: 214 };
const SHADOW_INK: Ink = { r: 8, g: 6, b: 10 };

/**
 * The one colour the tent uses for "this is clear, go".
 *
 * Shared by the boards a rung bell has bought and by every barrier the party has
 * opened, because they are the same promise made about two different kinds of
 * ground — and a player who has learned it once should never have to learn it
 * again in another hue.
 */
const CLEAR_GREEN_INK: Ink = { r: 138, g: 226, b: 168 };

const STRIPE_RED = inkRgba(STRIPE_RED_INK, 1);
const STRIPE_WHITE = inkRgba(STRIPE_WHITE_INK, 1);
const GOLD = inkRgba(GOLD_INK, 1);
const GOLD_DEEP = inkRgba(GOLD_DEEP_INK, 1);
const BRASS = inkRgba(BRASS_INK, 1);
const BRASS_LIGHT = inkRgba(BRASS_LIGHT_INK, 1);
const TIMBER_DARK = inkRgba(TIMBER_DARK_INK, 1);
const TIMBER_MID = inkRgba(TIMBER_MID_INK, 1);
const IRON_DARK = inkRgba(IRON_DARK_INK, 1);
const IRON_MID = inkRgba(IRON_MID_INK, 1);
const MASONRY_SHADE = inkRgba(MASONRY_SHADE_INK, 1);
const ROPE_COLOR = inkRgba(ROPE_INK, 1);
const LIMELIGHT = inkRgba(LIMELIGHT_INK, 1);

const TAU = Math.PI * 2;

// ── Shared behaviour ──────────────────────────────────────────────────────────

/**
 * The "the act wants this one" glow, at roughly one breath a second.
 *
 * Slow on purpose: a fast pulse on half a dozen props at once turns the lane
 * into a strobe, and the point of the cue is to be findable at a glance rather
 * than to be loud.
 */
const PULSE_PERIOD_FRAMES = 60;
const PULSE_RADIANS_PER_FRAME = TAU / PULSE_PERIOD_FRAMES;

const ROPE_WIDTH = 0.055;
const MASONRY_JOINT_WIDTH = 0.02;

// ── Everything the party has already opened ───────────────────────────────────

/**
 * How an opened way currently looks.
 *
 * `flare` is 1 on the frame it opened and falls to 0 over the next few seconds.
 * It exists because the crawler who opens a door is standing at the *other*
 * crawler's wall: the moment of opening is watched from the wrong side of the
 * tent, so the tile has to shout once and then go on quietly saying it forever.
 */
export interface MazeWayOpenArt {
  readonly phase: number;
  readonly flare: number;
}

/**
 * Every barrier in the tent opens a north–south passage, and the art leans on it
 * hard: the jambs are drawn on the east and west edges and the chevrons point
 * the way the party is walking. Asserted by the maze's own gate.
 */
const WAY_JAMB_WIDTH = 0.14;
const WAY_HEADER_HEIGHT = 0.16;
const WAY_LEAF_BAR_COUNT = 4;
const WAY_LEAF_BAR_WIDTH = 0.06;
const WAY_LEAF_DROP = 0.1;
const WAY_ROPE_SLACK = 0.06;
/** The threshold light, brightest at the far edge the party is walking toward. */
const WAY_THRESHOLD_NEAR_ALPHA = 0.12;
const WAY_THRESHOLD_FAR_ALPHA = 0.62;
const WAY_GLOW_ALPHA = 0.34;
const WAY_CHEVRON_COUNT = 2;
const WAY_CHEVRON_WIDTH = 0.24;
const WAY_CHEVRON_HEIGHT = 0.12;
const WAY_CHEVRON_SPACING = 0.22;
const WAY_CHEVRON_BASE_Y = 0.74;
const WAY_CHEVRON_ALPHA = 0.95;
const WAY_CHEVRON_WIDTH_SCALE = 0.09;
/** How far the chevrons drift up their own tile, and how fast. */
const WAY_CHEVRON_DRIFT = 0.1;
const WAY_CHEVRON_DRIFT_SPEED = 0.045;
const WAY_FLARE_RING_WIDTH = 0.08;
const WAY_FLARE_RING_RADIUS = 0.9;
const WAY_FLARE_WASH_ALPHA = 0.55;

/**
 * The green "go" chevrons an opened way wears, pointing north.
 *
 * The one moving thing on an otherwise static tile, because a doorway that has
 * been open for a minute still has to out-read a wall of identical cage fronts
 * from across a lane.
 */
export function paintWayChevrons(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
  alpha: number,
): void {
  const drift = ((phase * WAY_CHEVRON_DRIFT_SPEED) % 1) * size * WAY_CHEVRON_DRIFT;
  ctx.save();
  ctx.strokeStyle = inkRgba(CLEAR_GREEN_INK, alpha);
  ctx.lineWidth = Math.max(1, size * WAY_CHEVRON_WIDTH_SCALE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const centreX = x + size / 2;
  const half = (size * WAY_CHEVRON_WIDTH) / 2;
  for (let chevron = 0; chevron < WAY_CHEVRON_COUNT; chevron++) {
    const baseY = y + size * (WAY_CHEVRON_BASE_Y - WAY_CHEVRON_SPACING * chevron) - drift;
    ctx.beginPath();
    ctx.moveTo(centreX - half, baseY);
    ctx.lineTo(centreX, baseY - size * WAY_CHEVRON_HEIGHT);
    ctx.lineTo(centreX + half, baseY);
    ctx.stroke();
  }
  ctx.restore();
}

/** The wash and the ring a way throws on the frames right after it opens. */
export function paintWayFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  flare: number,
): void {
  if (flare <= 0) return;
  ctx.save();
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, WAY_FLARE_WASH_ALPHA * flare);
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = inkRgba(CLEAR_GREEN_INK, flare);
  ctx.lineWidth = Math.max(1, size * WAY_FLARE_RING_WIDTH);
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * WAY_FLARE_RING_RADIUS * (1 - flare), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * A barrier the party has opened: the leaf hauled up into the header, the jambs
 * left standing, and the floor between them marked as somewhere to walk.
 *
 * Without a mark, an opened tile reads as open ground in the fire walk's
 * narrow corridors, and in the menagerie as a one-tile gap in a wall of
 * identical cage fronts that players walk past.
 */
export function drawMazeWayOpen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeWayOpenArt,
): void {
  ctx.save();
  const jamb = size * WAY_JAMB_WIDTH;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y, jamb, size);
  ctx.fillRect(x + size - jamb, y, jamb, size);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, jamb, size * WAY_HEADER_HEIGHT);
  ctx.fillRect(x + size - jamb, y, jamb, size * WAY_HEADER_HEIGHT);

  const header = size * WAY_HEADER_HEIGHT;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y, size, header);
  ctx.fillStyle = IRON_MID;
  const barWidth = size * WAY_LEAF_BAR_WIDTH;
  for (let bar = 0; bar < WAY_LEAF_BAR_COUNT; bar++) {
    const bx = x + (size / WAY_LEAF_BAR_COUNT) * bar + (size / WAY_LEAF_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y + header, barWidth, size * WAY_LEAF_DROP);
  }

  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH * 0.7);
  ctx.beginPath();
  ctx.moveTo(x + jamb, y + header);
  ctx.quadraticCurveTo(
    x + size / 2,
    y + header + size * WAY_ROPE_SLACK,
    x + size - jamb,
    y + header,
  );
  ctx.stroke();

  // Light spilling through from the far side, then the tent's own "go" green
  // over it. Both are needed: the brightness is what separates a doorway from
  // the wall it is cut into, and the green is what says whose doing it was.
  const openingX = x + jamb;
  const openingY = y + header;
  const openingWidth = size - jamb * 2;
  const openingHeight = size - header;
  const threshold = ctx.createLinearGradient(0, y + size, 0, openingY);
  threshold.addColorStop(0, inkRgba(LIMELIGHT_INK, WAY_THRESHOLD_NEAR_ALPHA));
  threshold.addColorStop(1, inkRgba(LIMELIGHT_INK, WAY_THRESHOLD_FAR_ALPHA));
  ctx.fillStyle = threshold;
  ctx.fillRect(openingX, openingY, openingWidth, openingHeight);
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, WAY_GLOW_ALPHA);
  ctx.fillRect(openingX, openingY, openingWidth, openingHeight);

  paintWayChevrons(ctx, x, y, size, state.phase, WAY_CHEVRON_ALPHA);
  paintWayFlare(ctx, x, y, size, state.flare);
  ctx.restore();
}

const ACT_GATE_POST_WIDTH = 0.18;
const ACT_GATE_STRIPE_COUNT = 6;
const ACT_GATE_BANNER_HEIGHT = 0.26;
const ACT_GATE_BANNER_SAG = 0.08;
const ACT_GATE_RIPPLE_SPEED = 0.033;

/** The arch that closes an act: two striped posts under a sagging banner. */
export function drawMazeActGate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  ctx.fillStyle = inkRgba(SHADOW_INK, 0.55);
  ctx.fillRect(x, y, size, size);

  const postWidth = size * ACT_GATE_POST_WIDTH;
  paintStripedPost(ctx, x, y, postWidth, size, ACT_GATE_STRIPE_COUNT);
  paintStripedPost(ctx, x + size - postWidth, y, postWidth, size, ACT_GATE_STRIPE_COUNT);

  const sag = size * ACT_GATE_BANNER_SAG * (1 + Math.sin(phase * ACT_GATE_RIPPLE_SPEED));
  ctx.fillStyle = STRIPE_RED;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + size / 2, y + sag, x + size, y);
  ctx.lineTo(x + size, y + size * ACT_GATE_BANNER_HEIGHT);
  ctx.quadraticCurveTo(
    x + size / 2,
    y + size * ACT_GATE_BANNER_HEIGHT + sag,
    x,
    y + size * ACT_GATE_BANNER_HEIGHT,
  );
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(
    x,
    y + size * ACT_GATE_BANNER_HEIGHT,
    size,
    Math.max(1, size * MASONRY_JOINT_WIDTH * 2),
  );
  ctx.restore();
}

/** A red-and-white barber's post, used by the act arches and the trail posts alike. */
function paintStripedPost(
  ctx: CanvasRenderingContext2D,
  postX: number,
  postY: number,
  width: number,
  height: number,
  stripeCount: number,
): void {
  ctx.fillStyle = STRIPE_WHITE;
  ctx.fillRect(postX, postY, width, height);
  ctx.fillStyle = STRIPE_RED;
  const stripeHeight = height / stripeCount;
  for (let stripe = 0; stripe < stripeCount; stripe += 2) {
    ctx.fillRect(postX, postY + stripeHeight * stripe, width, stripeHeight);
  }
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(postX, postY, Math.max(1, width * 0.2), height);
}

const EXIT_DOOR_INSET = 0.1;
const EXIT_DOOR_PANEL_INSET = 0.2;
const EXIT_LAMP_RADIUS = 0.1;
const EXIT_LAMP_Y = 0.16;
const EXIT_LAMP_PULSE_SPEED = 0.05;
const EXIT_LAMP_GLOW_RINGS = 3;
const EXIT_HANDLE_RADIUS = 0.05;

/** The way out of an act: a timber door under a lamp that is always lit. */
export function drawMazeExitDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  ctx.fillStyle = MASONRY_SHADE;
  ctx.fillRect(x, y, size, size);
  const inset = size * EXIT_DOOR_INSET;
  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset);
  ctx.fillStyle = TIMBER_DARK;
  const panelInset = size * EXIT_DOOR_PANEL_INSET;
  ctx.fillRect(x + panelInset, y + panelInset, size - panelInset * 2, size - panelInset);
  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(x + size * (1 - EXIT_DOOR_PANEL_INSET), y + size / 2, size * EXIT_HANDLE_RADIUS, 0, TAU);
  ctx.fill();

  const glow = 0.6 + 0.4 * Math.sin(phase * EXIT_LAMP_PULSE_SPEED);
  const lampX = x + size / 2;
  const lampY = y + size * EXIT_LAMP_Y;
  for (let ring = EXIT_LAMP_GLOW_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(LIMELIGHT_INK, (0.18 * glow) / ring);
    ctx.beginPath();
    ctx.arc(lampX, lampY, size * EXIT_LAMP_RADIUS * (1 + ring), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = LIMELIGHT;
  ctx.beginPath();
  ctx.arc(lampX, lampY, size * EXIT_LAMP_RADIUS, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ── Flame vents ───────────────────────────────────────────────────────────────

/** Below this the flame is a lick rather than a column, and rises/falls with it. */
const FLAME_RAMP_FRACTION = 0.2;

/** How far the tallest parcel gets before it has burned out, in tiles. */
const FLAME_HEIGHT_TILES = 1.55;
/** Where in its tile the column stands: a little forward of centre, on the grille. */
const FLAME_BASE_Y = 0.72;

const FLAME_BASE_GLOW_RADIUS = 0.72;
const FLAME_GLOW_ALPHA = 0.14;
/** How much of the pool of light the flicker takes away at its dimmest. */
const FLAME_GLOW_FLICKER_DEPTH = 0.28;
/**
 * Two speeds that share no common period, so the pool never settles into a
 * pulse the eye can count. Radians per frame, well under Nyquist.
 */
const FLAME_GLOW_SLOW_SPEED = 0.17;
const FLAME_GLOW_FAST_SPEED = 0.41;

/**
 * How many parcels of burning gas are in the air at once. Each is born at the
 * grille, rises, narrows and dies, and the next is born behind it — which is
 * what makes the column read as a flow rather than as a shape that wobbles.
 */
const FLAME_PARCEL_COUNT = 16;
/** How long a parcel takes to travel from the grille to the top of the column. */
const FLAME_PARCEL_LIFETIME_FRAMES = 26;
/** Half-width of a parcel at birth. */
const FLAME_PARCEL_FOOT_HALF_WIDTH = 0.22;
/**
 * Taller than it is wide by a wide margin, because the bend is baked into the
 * stamp: a squat parcel draws the same curve across a short span and the S comes
 * out as a fin sticking off the column instead of as a lick leaning over.
 */
const FLAME_PARCEL_BODY_HEIGHT = 0.78;
/**
 * How far up a parcel keeps its full girth before it starts necking in. A jet
 * out of a floor grille is violent and dense in its lower half and only comes
 * apart near the top; a parcel that tapers from birth gives a candle instead.
 */
const FLAME_PARCEL_WAIST_START = 0.5;
/**
 * Under one, width falls away more slowly than the climb does once the waist is
 * passed. A parcel that has thinned to nothing by mid-height leaves a band where
 * the column is neither body nor lick, and the eruption reads as two stacked
 * things — a glow with darts over it — instead of one flame.
 */
const FLAME_PARCEL_TAPER_EXPONENT = 0.8;
/** How much of its body height a parcel keeps once it has reached the top. */
const FLAME_PARCEL_BODY_SURVIVAL = 0.46;
/**
 * How much of the climb is acceleration rather than steady travel. Hot gas
 * speeds up as it rises, which spreads the parcels apart near the top — and that
 * spread is what lets the last few read as licks that have shed the column.
 */
const FLAME_RISE_ACCELERATION = 0.5;
/** A parcel is drawn from nothing over the first slice of its life. */
const FLAME_PARCEL_BIRTH_FRACTION = 0.08;

/** Two incommensurate sway frequencies, in radians over one parcel's whole life. */
const FLAME_SWAY_PRIMARY_CYCLE = 3.1;
const FLAME_SWAY_SECONDARY_CYCLE = 7.9;
const FLAME_SWAY_PRIMARY_TILES = 0.15;
const FLAME_SWAY_SECONDARY_TILES = 0.06;
/** The whole column's slow drift, as if a draught crossed the tent. */
const FLAME_DRAFT_TILES = 0.1;
const FLAME_DRAFT_SPEED = 0.023;
/** Narrower than this and the stamp lands on nothing; skip the draw call. */
const FLAME_MIN_STAMP_HALF_WIDTH = 0.4;

/**
 * How far a parcel is allowed to tilt off vertical, in radians, at full sway.
 *
 * Kept modest because the baked bend already supplies most of the lean: tilt and
 * curve stacking up together swing a lick past the horizontal, and a horizontal
 * lick reads as a blade stuck out of the column rather than as fire.
 */
const FLAME_MAX_LEAN_RADIANS = 0.28;

/**
 * The whole column's lean, in tiles of sideways travel at the top of the climb.
 *
 * Nothing about combustion is mirrored, and a jet whose centre of mass sits dead
 * over its burner reads as a lamp. Two incommensurate slow clocks let the lean
 * wander instead of swinging on a countable beat.
 */
const FLAME_COLUMN_LEAN_TILES = 0.26;
const FLAME_COLUMN_LEAN_SLOW_SPEED = 0.031;
const FLAME_COLUMN_LEAN_FAST_SPEED = 0.073;
const FLAME_COLUMN_LEAN_FAST_SHARE = 0.35;
/** How much of the lean the anchored parts at the burner take. */
const FLAME_ROOT_LEAN_SHARE = 0.4;
const FLAME_THROAT_LEAN_SHARE = 0.25;

/** How far the roots' centre of mass slides off the burner's centre line. */
const FLAME_ROOT_BIAS_TILES = 0.07;
const FLAME_ROOT_BIAS_SPEED = 0.047;

/**
 * How far off the centre line a parcel is allowed to root. Together with the
 * parcel's own girth this is what makes the flame leave the grille at close to
 * the full width of its tile instead of sprouting from a point.
 */
const FLAME_PARCEL_ROOT_SPREAD_TILES = 0.24;

/** How far a release may slide inside its own slot on the birth clock, 0..1. */
const FLAME_PARCEL_RELEASE_JITTER = 0.7;

/** How far a parcel's width and brightness are allowed to vary from birth to birth. */
const FLAME_PARCEL_WIDTH_JITTER = 0.4;
const FLAME_PARCEL_ALPHA_FLOOR = 0.72;

/** The cool gas at the burner, which is dark because it has not caught yet. */
const FLAME_FUEL_HALF_WIDTH = 0.2;
const FLAME_FUEL_HEIGHT = 0.05;
const FLAME_FUEL_FLICKER_DEPTH = 0.3;
const FLAME_FUEL_FLICKER_SPEED = 0.29;

/**
 * The root: the dense mass sitting on the burner mouth.
 *
 * The parcels alone leave this exact spot dim, because each one's foot travels
 * up with it and only the youngest are still down here — which puts the flame's
 * thinnest ink where a jet is at its most violent. The root is what the parcels
 * tear away from.
 */
const FLAME_ROOT_HALF_WIDTH = 0.36;
const FLAME_ROOT_HEIGHT = 0.66;
const FLAME_ROOT_LIFT = 0.03;
const FLAME_ROOT_FLICKER_DEPTH = 0.07;
const FLAME_ROOT_FLICKER_SPEED = 0.19;

/** The bright throat just above the fuel: a small hot spot, never a wide bulb. */
const FLAME_THROAT_HALF_WIDTH = 0.075;
const FLAME_THROAT_HEIGHT = 0.1;
const FLAME_THROAT_LIFT = 0.1;
const FLAME_THROAT_ALPHA = 0.5;
const FLAME_THROAT_FLICKER_DEPTH = 0.3;
const FLAME_THROAT_FLICKER_SPEED = 0.61;

/** Sparks that leave the column and burn out over it. */
const FLAME_EMBER_COUNT = 3;
const FLAME_EMBER_LIFETIME_FRAMES = 44;
/** Where up the column an ember detaches, and how far past the top it carries. */
const FLAME_EMBER_RELEASE_HEIGHT = 0.4;
const FLAME_EMBER_TRAVEL_TILES = 0.85;
const FLAME_EMBER_DRIFT_TILES = 0.26;
const FLAME_EMBER_RADIUS_TILES = 0.045;
const FLAME_EMBER_ALPHA = 0.9;
/** A spark is drawn from nothing over the first slice of its life, as a parcel is. */
const FLAME_EMBER_BIRTH_FRACTION = 0.12;

/**
 * Distinct offsets into the hash so a parcel's width, brightness, sway and root
 * are four independent draws rather than four readings of one number — reusing a
 * draw ties the shape to the lean and the column starts to look combed.
 */
const HASH_SALT_WIDTH = 101;
const HASH_SALT_BRIGHTNESS = 211;
const HASH_SALT_SWAY_PRIMARY = 307;
const HASH_SALT_SWAY_SECONDARY = 401;
const HASH_SALT_ROOT = 509;
const HASH_SALT_SPARK_LANE = 601;
const HASH_SALT_BEND = 709;
const HASH_SALT_BEND_MIRROR = 811;

/**
 * The eruption: a column of fire standing out of the grille.
 *
 * `burn` is 0..1 across the burn; the column ramps up over its first fifth
 * and falls away over its last, so the flame arrives and leaves rather than
 * blinking. `phase` is a frame accumulator, and everything below is a pure
 * function of it.
 *
 * The column is a *flow*, not a silhouette. Parcels of gas are born across the
 * whole mouth of the grille on a rolling clock, rise, neck in, cool and go out.
 * A wobbling outline reads as a flag; only travelling parcels read as combustion.
 *
 * Every piece of it is a baked soft stamp rather than a filled path. Fire has no
 * crisp boundary above the burner, and a path fill has nothing but — a dozen of
 * them stacked up reads as cut paper however the curve is shaped.
 */
export function drawFlameVentColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  burn: number,
  phase: number,
): void {
  const rise = Math.min(1, burn / FLAME_RAMP_FRACTION);
  const fall = Math.min(1, (1 - burn) / FLAME_RAMP_FRACTION);
  const intensity = Math.max(0, Math.min(rise, fall));
  if (intensity < MIN_VISIBLE_ALPHA) return;

  const stamps = flameStamps();
  const cx = x + size / 2;
  const baseY = y + size * FLAME_BASE_Y;
  const columnHeight = size * FLAME_HEIGHT_TILES * intensity;
  const draft = Math.sin(phase * FLAME_DRAFT_SPEED) * size * FLAME_DRAFT_TILES;
  const lean = columnLean(size, phase);

  ctx.save();
  paintFlameGlow(ctx, stamps, cx, baseY, size, intensity, phase);
  paintFlameRoot(ctx, stamps, cx, baseY, size, intensity, phase, lean);
  paintFuelShadow(ctx, stamps, cx, baseY, size, intensity, phase, lean);
  paintFlameParcels(ctx, stamps, cx, baseY, size, columnHeight, intensity, phase, draft, lean);
  ctx.globalCompositeOperation = 'lighter';
  paintFlameThroat(ctx, stamps, cx, baseY, size, intensity, phase, lean);
  paintFlameEmbers(ctx, stamps, cx, baseY, size, intensity, phase, draft);
  ctx.restore();
}

/**
 * How far the top of the column has slid off its burner's centre line, in
 * pixels. The parts nearer the grille take a share of it; the parts in free air
 * take all of it.
 */
function columnLean(size: number, phase: number): number {
  const slowWander = Math.sin(phase * FLAME_COLUMN_LEAN_SLOW_SPEED);
  const fastWander = Math.sin(phase * FLAME_COLUMN_LEAN_FAST_SPEED);
  const blended =
    slowWander * (1 - FLAME_COLUMN_LEAN_FAST_SHARE) + fastWander * FLAME_COLUMN_LEAN_FAST_SHARE;
  return size * FLAME_COLUMN_LEAN_TILES * blended;
}

/**
 * The pool of light the column throws on the sawdust around its grille.
 *
 * It breathes with the column rather than sitting steady: a lamp that holds
 * still under a fire that does not is the tell that the fire is a decal.
 */
function paintFlameGlow(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
): void {
  const slowBreath = Math.sin(phase * FLAME_GLOW_SLOW_SPEED);
  const fastBreath = Math.sin(phase * FLAME_GLOW_FAST_SPEED);
  const breath = 1 - FLAME_GLOW_FLICKER_DEPTH * (1 - (slowBreath + fastBreath) / 2);
  const radius = size * FLAME_BASE_GLOW_RADIUS * breath;
  ctx.globalAlpha = Math.min(1, FLAME_GLOW_ALPHA * intensity * breath);
  ctx.drawImage(stamps.glow, cx - radius, baseY - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

/**
 * The unlit gas sitting on the burner, laid down under the flame body.
 *
 * Real flame is dark where the fuel has not caught, and that darkness is what
 * makes the throat above it read as hot rather than merely as pale.
 */
function paintFuelShadow(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  lean: number,
): void {
  const unrest = 1 - FLAME_FUEL_FLICKER_DEPTH * (1 - Math.sin(phase * FLAME_FUEL_FLICKER_SPEED));
  const halfWidth = size * FLAME_FUEL_HALF_WIDTH * unrest;
  const halfHeight = size * FLAME_FUEL_HEIGHT;
  const centreX = cx + lean * FLAME_ROOT_LEAN_SHARE;
  ctx.globalAlpha = intensity;
  ctx.drawImage(
    stamps.fuel,
    centreX - halfWidth,
    baseY - halfHeight,
    halfWidth * 2,
    halfHeight * 2,
  );
  ctx.globalAlpha = 1;
}

/** The dense mass on the burner mouth that the rising parcels tear away from. */
function paintFlameRoot(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  lean: number,
): void {
  const surge = 1 - FLAME_ROOT_FLICKER_DEPTH * (1 - Math.sin(phase * FLAME_ROOT_FLICKER_SPEED));
  const rootHeight = size * FLAME_ROOT_HEIGHT * surge;
  const tilt = Math.max(
    -FLAME_MAX_LEAN_RADIANS,
    Math.min(FLAME_MAX_LEAN_RADIANS, (lean * FLAME_ROOT_LEAN_SHARE) / Math.max(rootHeight, 1)),
  );
  stampTeardrop(
    ctx,
    stamps.root,
    cx,
    baseY + size * FLAME_ROOT_LIFT,
    size * FLAME_ROOT_HALF_WIDTH * surge,
    rootHeight,
    tilt,
    intensity,
    // Never mirrored: the root's curve is a standing feature of the burner, and
    // flipping it on the sign of a wandering lean would pop as the lean crosses zero.
    false,
  );
}

/**
 * The hard-burning neck just above the fuel.
 *
 * Narrow on purpose, and additive: this is the only white-hot thing in the
 * column, and a wide one turns the burner mouth into a pale bulb. Painted rather
 * than added it reads as grey over the dark iron instead of as heat.
 */
function paintFlameThroat(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  lean: number,
): void {
  const pulse = 1 - FLAME_THROAT_FLICKER_DEPTH * (1 - Math.sin(phase * FLAME_THROAT_FLICKER_SPEED));
  const halfWidth = size * FLAME_THROAT_HALF_WIDTH * pulse;
  const halfHeight = size * FLAME_THROAT_HEIGHT * pulse;
  const centreY = baseY - size * FLAME_THROAT_LIFT - halfHeight;
  const centreX = cx + lean * FLAME_THROAT_LEAN_SHARE;
  ctx.globalAlpha = Math.min(1, FLAME_THROAT_ALPHA * intensity);
  ctx.drawImage(
    stamps.throat,
    centreX - halfWidth,
    centreY - halfHeight,
    halfWidth * 2,
    halfHeight * 2,
  );
  ctx.globalAlpha = 1;
}

/**
 * The body of the column: parcels of gas on a rolling birth clock.
 *
 * A parcel picks its colour tier from how far it has climbed, so the ramp runs
 * up the column rather than across its layers, and nothing has to be tinted at
 * draw time.
 */
function paintFlameParcels(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  columnHeight: number,
  intensity: number,
  phase: number,
  draft: number,
  lean: number,
): void {
  const clock = phase / FLAME_PARCEL_LIFETIME_FRAMES;
  const topTier = stamps.body.length - 1;
  const rootBias = size * FLAME_ROOT_BIAS_TILES * Math.sin(phase * FLAME_ROOT_BIAS_SPEED);
  for (let i = 0; i < FLAME_PARCEL_COUNT; i++) {
    // Nudged off the metronome, but only within its own slot. A free offset
    // clumps the releases, and a clumped ensemble is dense and then sparse on a
    // cycle exactly one parcel-lifetime long — the whole column throbs.
    const slot = i + (hashUnit(i, i) - 0.5) * FLAME_PARCEL_RELEASE_JITTER;
    const release = clock + slot / FLAME_PARCEL_COUNT;
    const birthNumber = Math.floor(release);
    const age = release - birthNumber;

    const widthJitter =
      1 + (hashUnit(birthNumber + HASH_SALT_WIDTH, i) - 0.5) * FLAME_PARCEL_WIDTH_JITTER;
    const brightness =
      FLAME_PARCEL_ALPHA_FLOOR +
      (1 - FLAME_PARCEL_ALPHA_FLOOR) * hashUnit(birthNumber + HASH_SALT_BRIGHTNESS, i);
    const birthFade = Math.min(1, age / FLAME_PARCEL_BIRTH_FRACTION);
    const alpha = intensity * brightness * birthFade;
    if (alpha < MIN_VISIBLE_ALPHA) continue;

    const climb = age * (1 - FLAME_RISE_ACCELERATION + FLAME_RISE_ACCELERATION * age);
    const footY = baseY - columnHeight * climb;

    const swaySeedPrimary = hashUnit(birthNumber + HASH_SALT_SWAY_PRIMARY, i) * TAU;
    const swaySeedSecondary = hashUnit(birthNumber + HASH_SALT_SWAY_SECONDARY, i) * TAU;
    const sway =
      size *
      age *
      (FLAME_SWAY_PRIMARY_TILES * Math.sin(age * FLAME_SWAY_PRIMARY_CYCLE + swaySeedPrimary) +
        FLAME_SWAY_SECONDARY_TILES *
          Math.sin(age * FLAME_SWAY_SECONDARY_CYCLE + swaySeedSecondary));
    const root =
      (hashUnit(birthNumber + HASH_SALT_ROOT, i) - 0.5) * size * FLAME_PARCEL_ROOT_SPREAD_TILES;
    const footX = cx + root + rootBias + sway + draft * age + lean * climb;

    const pastWaist = Math.max(0, age - FLAME_PARCEL_WAIST_START) / (1 - FLAME_PARCEL_WAIST_START);
    const girth = Math.pow(1 - pastWaist, FLAME_PARCEL_TAPER_EXPONENT);
    const halfWidth = size * FLAME_PARCEL_FOOT_HALF_WIDTH * widthJitter * girth;
    const bodyHeight =
      size *
      FLAME_PARCEL_BODY_HEIGHT *
      widthJitter *
      (FLAME_PARCEL_BODY_SURVIVAL + (1 - FLAME_PARCEL_BODY_SURVIVAL) * (1 - age));
    if (halfWidth < FLAME_MIN_STAMP_HALF_WIDTH) continue;

    const tier = Math.min(topTier, Math.floor(climb * stamps.body.length));
    const bends = stamps.body[tier];
    const bendChoice = hashUnit(birthNumber + HASH_SALT_BEND, i);
    const bendIndex = Math.min(bends.length - 1, Math.floor(bendChoice * bends.length));
    const stamp = bends[bendIndex];
    const mirrored = hashUnit(birthNumber + HASH_SALT_BEND_MIRROR, i) < 0.5;
    const tilt = Math.max(
      -FLAME_MAX_LEAN_RADIANS,
      Math.min(FLAME_MAX_LEAN_RADIANS, (sway + lean * climb) / Math.max(bodyHeight, 1)),
    );
    stampTeardrop(
      ctx,
      stamp,
      footX,
      footY,
      halfWidth,
      bodyHeight,
      tilt,
      Math.min(1, alpha),
      mirrored,
    );
  }
}

/**
 * Sparks that have left the column and burn out above it.
 *
 * A flame that never sheds anything reads as a solid object; the detached ink is
 * what says the thing is coming apart as it goes. Three at a time — a handful
 * more and it stops being a fire and becomes a sparkler.
 */
function paintFlameEmbers(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  draft: number,
): void {
  const clock = phase / FLAME_EMBER_LIFETIME_FRAMES;
  for (let i = 0; i < FLAME_EMBER_COUNT; i++) {
    const release = clock + i / FLAME_EMBER_COUNT + hashUnit(i, -i);
    const birthNumber = Math.floor(release);
    const age = release - birthNumber;
    const birthFade = Math.min(1, age / FLAME_EMBER_BIRTH_FRACTION);
    const alpha = intensity * FLAME_EMBER_ALPHA * (1 - age) * birthFade;
    if (alpha < MIN_VISIBLE_ALPHA) continue;

    const lane = hashUnit(birthNumber + HASH_SALT_SPARK_LANE, i) - 0.5;
    const wobble = Math.sin(age * FLAME_SWAY_SECONDARY_CYCLE + lane * TAU);
    const emberX = cx + size * FLAME_EMBER_DRIFT_TILES * (lane * 2 + wobble * age) + draft * age;
    const releaseY = baseY - size * FLAME_HEIGHT_TILES * FLAME_EMBER_RELEASE_HEIGHT * intensity;
    const emberY = releaseY - size * FLAME_EMBER_TRAVEL_TILES * age * intensity;
    const radius = size * FLAME_EMBER_RADIUS_TILES * (1 - age);

    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(stamps.ember, emberX - radius, emberY - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
}

// ── Spotlights ────────────────────────────────────────────────────────────────

/**
 * The two states of the menagerie's lanterns have to be told apart in one
 * glance, because getting them the wrong way round is a death.
 *
 * They are separated on three axes at once rather than on brightness alone:
 * the warning is amber and the strike is white-hot, the warning is a ring round
 * a nearly-empty pool and the strike is a filled disc, and the warning's edge
 * closes inward while the strike's edge is fixed. Any one of the three read on
 * its own is enough to name the state.
 */
const SPOT_WARM_INK: Ink = { r: 255, g: 176, b: 46 };
const SPOT_WARM_OUTER_RADIUS = 0.68;
const SPOT_WARM_CLOSE = 0.22;
const SPOT_WARM_FILL_ALPHA = 0.34;
/** The pool is already a warning on its first frame, so it never starts from nothing. */
const SPOT_WARM_FILL_FLOOR = 0.55;
const SPOT_WARM_RING_ALPHA = 0.95;
const SPOT_WARM_RING_WIDTH = 0.1;
/** Where the closing ring will finally land, marked from the first frame. */
const SPOT_WARM_LANDING_RADIUS = 0.46;
const SPOT_WARM_LANDING_ALPHA = 0.45;
const SPOT_WARM_LANDING_WIDTH = 0.04;

const SPOT_BEAM_RADIUS = 0.5;
const SPOT_BEAM_CORE_ALPHA = 0.72;
const SPOT_BEAM_BLOOM_RINGS = 3;
const SPOT_BEAM_BLOOM_ALPHA = 0.3;
const SPOT_BEAM_BLOOM_SPREAD = 0.3;
const SPOT_BEAM_RIM_ALPHA = 1;
const SPOT_BEAM_RIM_WIDTH = 0.07;
const SPOT_MOTE_COUNT = 5;
const SPOT_MOTE_RADIUS = 0.03;
const SPOT_MOTE_SPEED = 0.024;
const SPOT_MOTE_ALPHA = 0.55;

const SPOT_DOCK_RADIUS = 0.46;
const SPOT_DOCK_FILL_ALPHA = 0.22;
const SPOT_DOCK_ARC_WIDTH = 0.07;

/** The warning pool: an amber ring closing on the tile the lamps are about to find. */
export function drawSpotlightWarm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
): void {
  const closing = Math.max(0, Math.min(1, progress));
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;

  ctx.fillStyle = inkRgba(
    SPOT_WARM_INK,
    SPOT_WARM_FILL_ALPHA * (SPOT_WARM_FILL_FLOOR + (1 - SPOT_WARM_FILL_FLOOR) * closing),
  );
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * SPOT_WARM_LANDING_RADIUS, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = inkRgba(SPOT_WARM_INK, SPOT_WARM_LANDING_ALPHA);
  ctx.lineWidth = Math.max(1, size * SPOT_WARM_LANDING_WIDTH);
  ctx.stroke();

  ctx.strokeStyle = inkRgba(SPOT_WARM_INK, SPOT_WARM_RING_ALPHA);
  ctx.lineWidth = Math.max(2, size * SPOT_WARM_RING_WIDTH);
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * (SPOT_WARM_OUTER_RADIUS - SPOT_WARM_CLOSE * closing), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** The lamps themselves, on the floor: a hard white pool with dust turning in it. */
export function drawSpotlightBeam(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
  phase: number,
): void {
  const strength = Math.max(0, Math.min(1, progress));
  if (strength < MIN_VISIBLE_ALPHA) return;
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const radius = size * SPOT_BEAM_RADIUS;

  for (let ring = SPOT_BEAM_BLOOM_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(LIMELIGHT_INK, (SPOT_BEAM_BLOOM_ALPHA * strength) / (ring * ring));
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius * (1 + SPOT_BEAM_BLOOM_SPREAD * ring), 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = inkRgba(LIMELIGHT_INK, SPOT_BEAM_CORE_ALPHA * strength);
  ctx.beginPath();
  ctx.arc(centreX, centreY, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = inkRgba(LIMELIGHT_INK, SPOT_BEAM_RIM_ALPHA * strength);
  ctx.lineWidth = Math.max(2, size * SPOT_BEAM_RIM_WIDTH);
  ctx.stroke();

  ctx.fillStyle = inkRgba(SPOT_WARM_INK, SPOT_MOTE_ALPHA * strength);
  for (let mote = 0; mote < SPOT_MOTE_COUNT; mote++) {
    const angle = phase * SPOT_MOTE_SPEED + (TAU / SPOT_MOTE_COUNT) * mote;
    const reach = radius * (0.3 + 0.55 * hashUnit(mote, mote));
    ctx.beginPath();
    ctx.arc(
      centreX + Math.cos(angle) * reach,
      centreY + Math.sin(angle) * reach,
      size * SPOT_MOTE_RADIUS,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();
}

const SPOT_CLEAR_RADIUS = 0.42;
const SPOT_CLEAR_FILL_ALPHA = 0.16;
const SPOT_CLEAR_RING_ALPHA = 0.5;
const SPOT_CLEAR_RING_WIDTH = 0.05;
const SPOT_CLEAR_BREATH = 0.12;

/**
 * The mark on a stretch of boards whose lanterns a bell has called away.
 *
 * Deliberately cool green rather than the warning's amber, and a *shrinking*
 * ring rather than a closing one. Drawing the warning's own outline at zero
 * progress was tried first and read as "about to light" — playtesters would not
 * step onto ground they had just paid to clear, because it was still painted
 * the colour of the thing they were avoiding.
 */
export function drawSpotlightClear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const breath =
    1 - SPOT_CLEAR_BREATH + SPOT_CLEAR_BREATH * Math.sin(phase * PULSE_RADIANS_PER_FRAME);
  const radius = size * SPOT_CLEAR_RADIUS * breath;
  ctx.save();
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, SPOT_CLEAR_FILL_ALPHA);
  ctx.beginPath();
  ctx.arc(centreX, centreY, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = inkRgba(CLEAR_GREEN_INK, SPOT_CLEAR_RING_ALPHA);
  ctx.lineWidth = Math.max(1, size * SPOT_CLEAR_RING_WIDTH);
  ctx.stroke();
  ctx.restore();
}

/** The pool of light that sits on a rung bell's stand while its lanterns are held off the floor. */
export function drawSpotlightDock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  holdFraction: number,
  phase: number,
): void {
  const remaining = Math.max(0, Math.min(1, holdFraction));
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const breath = 0.85 + 0.15 * Math.sin(phase * PULSE_RADIANS_PER_FRAME);
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, SPOT_DOCK_FILL_ALPHA * breath);
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * SPOT_DOCK_RADIUS, 0, TAU);
  ctx.fill();
  // The docked lamps are the whole reason the lane is safe, so the arc that runs
  // out is the same reading as the bell's — one clock shown in two places.
  ctx.strokeStyle = inkRgba(GOLD_INK, 0.9);
  ctx.lineWidth = Math.max(2, size * SPOT_DOCK_ARC_WIDTH);
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * SPOT_DOCK_RADIUS, -TAU / 4, -TAU / 4 + TAU * remaining);
  ctx.stroke();
  ctx.restore();
}

// ── Comprehension aids ────────────────────────────────────────────────────────

const CHIP_WIDTH = 1.3;
const CHIP_HEIGHT = 0.42;
const CHIP_LIFT = 0.42;
const CHIP_RADIUS = 3;
const CHIP_BORDER_WIDTH = 1.5;
const CHIP_FILL_ALPHA = 0.9;
/**
 * Cap height as a fraction of the tile rather than a pixel count, so the chip
 * holds its proportions at any tile size — a fixed 9px label is right at 32px
 * and a speck on a zoomed render.
 */
const CHIP_TEXT_FRACTION = 0.28;
const CHIP_TEXT_MIN_SIZE = 7;
/** The text sits a hair above the box's own middle, because a cap-height run reads low. */
const CHIP_TEXT_NUDGE = 0.5;

/** A small floating chip naming whose job this is: DONUT gold-on-red, CARL brass-on-blue. */
export function drawTargetNameChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  owner: 'human' | 'cat',
): void {
  const donutOwned = owner === 'cat';
  const textSize = Math.max(CHIP_TEXT_MIN_SIZE, size * CHIP_TEXT_FRACTION);
  const width = size * CHIP_WIDTH;
  const height = size * CHIP_HEIGHT;
  const box = {
    x: x + size / 2 - width / 2,
    y: y - size * CHIP_LIFT,
    w: width,
    h: height,
  };
  const ink = donutOwned ? GOLD : BRASS_LIGHT;
  worldPlate(ctx, box, {
    fill: donutOwned
      ? inkRgba(STRIPE_RED_INK, CHIP_FILL_ALPHA)
      : inkRgba(CIRCUS_BLUE_INK, CHIP_FILL_ALPHA),
    border: ink,
    borderWidth: CHIP_BORDER_WIDTH,
    radius: CHIP_RADIUS,
  });
  worldText(ctx, donutOwned ? 'DONUT' : 'CARL', {
    x: box.x + box.w / 2,
    y: box.y + (box.h - textSize) / 2 - CHIP_TEXT_NUDGE,
    size: textSize,
    bold: true,
    align: 'center',
    color: ink,
    outline: true,
  });
}

// ── Trail dressing ────────────────────────────────────────────────────────────

const RUNNER_INSET = 0.1;
const RUNNER_BORDER_WIDTH = 0.06;
const RUNNER_WEAVE_COUNT = 4;
const RUNNER_WEAVE_ALPHA = 0.12;

/** The ring-mat runner: the carpet a crawler's own trail is laid on. */
export function drawRingMatRunner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  owner: 'human' | 'cat',
): void {
  ctx.save();
  const donutOwned = owner === 'cat';
  const inset = size * RUNNER_INSET;
  const span = size - inset * 2;
  ctx.fillStyle = donutOwned ? inkRgba(VELVET_INK, 0.85) : inkRgba(CIRCUS_BLUE_INK, 0.85);
  ctx.fillRect(x + inset, y, span, size);
  ctx.fillStyle = donutOwned ? inkRgba(GOLD_INK, 0.9) : inkRgba(BRASS_LIGHT_INK, 0.9);
  const border = Math.max(1, size * RUNNER_BORDER_WIDTH);
  ctx.fillRect(x + inset, y, border, size);
  ctx.fillRect(x + inset + span - border, y, border, size);

  ctx.fillStyle = inkRgba(SHADOW_INK, RUNNER_WEAVE_ALPHA);
  const weaveHeight = size / RUNNER_WEAVE_COUNT;
  for (let weave = 0; weave < RUNNER_WEAVE_COUNT; weave += 2) {
    ctx.fillRect(x + inset + border, y + weaveHeight * weave, span - border * 2, weaveHeight);
  }
  ctx.restore();
}

const FOOTLIGHT_HOUSING_WIDTH = 0.22;
const FOOTLIGHT_HOUSING_HEIGHT = 0.12;
const FOOTLIGHT_BULB_RADIUS = 0.09;
const FOOTLIGHT_GLOW_RINGS = 2;
const FOOTLIGHT_FLICKER_SPEED = 0.07;
const FOOTLIGHT_FLICKER_DEPTH = 0.18;

/** A footlight along the trail's edge: a brass shell and a warm bulb. */
export function drawFootlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const bulbY = y + size * 0.56;
  const glow = 1 - FOOTLIGHT_FLICKER_DEPTH * (1 - Math.sin(phase * FOOTLIGHT_FLICKER_SPEED));
  for (let ring = FOOTLIGHT_GLOW_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(GOLD_INK, (0.2 * glow) / ring);
    ctx.beginPath();
    ctx.arc(centreX, bulbY, size * FOOTLIGHT_BULB_RADIUS * (1 + ring), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = BRASS;
  ctx.fillRect(
    centreX - (size * FOOTLIGHT_HOUSING_WIDTH) / 2,
    bulbY,
    size * FOOTLIGHT_HOUSING_WIDTH,
    size * FOOTLIGHT_HOUSING_HEIGHT,
  );
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, glow);
  ctx.beginPath();
  ctx.arc(centreX, bulbY, size * FOOTLIGHT_BULB_RADIUS, 0, TAU);
  ctx.fill();
  ctx.restore();
}

const ARCH_POST_WIDTH = 0.3;
const ARCH_POST_TOP = 0.08;
const ARCH_POST_STRIPES = 7;
const ARCH_FINIAL_RADIUS = 0.1;
const ARCH_BUNTING_COUNT = 3;
const ARCH_BUNTING_HEIGHT = 0.16;
const ARCH_BUNTING_SWAY_SPEED = 0.029;
const ARCH_BUNTING_SWAY = 0.04;

/** An act arch post: a striped column with bunting strung off its head. */
export function drawActArchPost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  const postWidth = size * ARCH_POST_WIDTH;
  const postX = x + size / 2 - postWidth / 2;
  const postY = y + size * ARCH_POST_TOP;
  paintStripedPost(ctx, postX, postY, postWidth, size - size * ARCH_POST_TOP, ARCH_POST_STRIPES);

  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x + size / 2, postY, size * ARCH_FINIAL_RADIUS, 0, TAU);
  ctx.fill();

  const sway = Math.sin(phase * ARCH_BUNTING_SWAY_SPEED) * size * ARCH_BUNTING_SWAY;
  for (let flag = 0; flag < ARCH_BUNTING_COUNT; flag++) {
    const flagX = x + (size / ARCH_BUNTING_COUNT) * flag;
    const flagWidth = size / ARCH_BUNTING_COUNT;
    ctx.fillStyle = flag % 2 === 0 ? STRIPE_RED : GOLD;
    ctx.beginPath();
    ctx.moveTo(flagX, postY);
    ctx.lineTo(flagX + flagWidth, postY);
    ctx.lineTo(flagX + flagWidth / 2 + sway, postY + size * ARCH_BUNTING_HEIGHT);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
