/**
 * The Big Top maze's furniture, drawn live rather than baked into a sheet.
 *
 * Four props and one hazard, each of which is a handful of rectangles and a
 * gradient: a counterweighted gate, a boarded barricade, the two destructibles
 * that open them, the grate they hang behind, and the gas jet in the sawdust.
 * The gym equipment on floor three is drawn the same way for the same reason —
 * a sheet buys nothing for a shape with no animation of its own beyond a flicker.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
import { drawDangerTile } from './dangerTelegraph';

/** How a destructible currently looks. */
export interface MazePropState {
  /** 1 at full, 0 the moment it gives. */
  readonly integrity: number;
  readonly broken: boolean;
  /** A blow that landed. */
  readonly struck: boolean;
  /**
   * Which way the prop faces — the side the acting crawler approaches from.
   * The dividing wall it is fixed to is on the opposite side.
   */
  readonly facing: 'west' | 'east';
  /** Frame counter, for the rope sway and the jet flicker. */
  readonly phase: number;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const SANDBAG_CANVAS = '#8a7248';
const SANDBAG_CANVAS_SHADE = '#6b5836';
const SANDBAG_SEAM = '#4a3c24';
const ROPE_COLOR = '#c8b184';
const IRON_DARK = '#2f353c';
const IRON_MID = '#4c555f';
const IRON_LIGHT = '#78838e';
const PLANK_DARK = '#4a331c';
const PLANK_MID = '#6d4c28';
const PLANK_LIGHT = '#8f6835';
const NAIL_COLOR = '#c3ccd4';
const STRUCK_FLASH = 'rgba(255,246,214,0.75)';
const RUBBLE_COLOR = '#5a4a33';
const SAND_SPILL = '#b8a271';

// ── Shared geometry, as fractions of a tile ───────────────────────────────────

const SANDBAG_WIDTH = 0.58;
const SANDBAG_HEIGHT = 0.5;
const SANDBAG_TOP = 0.34;
/** How far off its tile's centre the bag sits, toward the wall it hangs on. */
const SANDBAG_WALL_HUG = 0.34;
/** Fraction of the bag's width at its tied neck and at its resting foot. */
const SANDBAG_NECK_FRACTION = 0.22;
const SANDBAG_FOOT_FRACTION = 0.4;
/** Where down the bag its widest point sits. */
const SANDBAG_BELLY_FRACTION = 0.62;
const SANDBAG_SPILL_Y = 0.84;
const SANDBAG_SPILL_WIDTH_SCALE = 0.85;
const SANDBAG_SPILL_HEIGHT = 0.09;
const SANDBAG_SKIN_Y = 0.78;
const SANDBAG_SKIN_WIDTH_SCALE = 0.5;
const SANDBAG_SKIN_HEIGHT = 0.06;
const ROPE_WIDTH = 0.055;
const ROPE_SWAY_TILES = 0.02;
const ROPE_SWAY_SPEED = 0.045;
const SEAM_COUNT = 3;
const SEAM_WIDTH = 0.02;

const BRACE_WIDTH = 0.34;
const BRACE_HEIGHT = 0.82;
const BRACE_TOP = 0.1;
const BRACE_STRUT_HEIGHT = 0.16;
const BRACE_STRUT_LENGTH = 0.42;
const NAIL_RADIUS = 0.035;

const GRATE_BAR_COUNT = 5;
const GRATE_INSET = 0.12;
const GRATE_BAR_WIDTH = 0.06;

const GATE_BAR_COUNT = 4;
const GATE_BAR_WIDTH = 0.1;
const GATE_RAIL_HEIGHT = 0.1;

const BARRICADE_PLANK_COUNT = 4;
const BARRICADE_PLANK_GAP = 0.03;

const CRACK_THRESHOLD = 0.66;
const HEAVY_CRACK_THRESHOLD = 0.33;
const CRACK_WIDTH = 0.02;

const VENT_GRILLE_SLOTS = 3;
const VENT_SLOT_WIDTH = 0.14;
const VENT_SLOT_HEIGHT = 0.44;
const VENT_RIM_INSET = 0.16;
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

/** A colour with its own opacity, for a stamp that is baked rather than composed. */
interface FlameInk {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/**
 * The heat ramp, from the grille (first) to the top of the column (last).
 *
 * A parcel picks its tier by how far it has climbed, so colour follows height
 * rather than which layer drew it. The body stays a deeply saturated orange-red
 * the whole way up and only loses opacity near the top: the big top's ground is
 * pale tan, and a pale flame over it reads as smoke. The one white-hot thing in
 * the column is the throat, which is small — brightness has to be bought with
 * value, not with area, or the burner grows an egg in it.
 */
const FLAME_BODY_TIERS: ReadonlyArray<FlameInk> = [
  { red: 255, green: 176, blue: 52, alpha: 0.95 },
  { red: 255, green: 146, blue: 26, alpha: 0.95 },
  { red: 255, green: 118, blue: 14, alpha: 0.94 },
  { red: 253, green: 96, blue: 10, alpha: 0.92 },
  { red: 244, green: 74, blue: 8, alpha: 0.88 },
  { red: 228, green: 56, blue: 8, alpha: 0.82 },
  { red: 206, green: 40, blue: 8, alpha: 0.72 },
  { red: 180, green: 28, blue: 6, alpha: 0.56 },
  { red: 150, green: 20, blue: 4, alpha: 0.34 },
  { red: 118, green: 14, blue: 2, alpha: 0.16 },
];

const FLAME_ROOT_INK: FlameInk = { red: 255, green: 142, blue: 26, alpha: 1 };
const FLAME_THROAT_INK: FlameInk = { red: 255, green: 216, blue: 132, alpha: 0.9 };
const FLAME_EMBER_INK: FlameInk = { red: 255, green: 206, blue: 118, alpha: 0.9 };
const FLAME_FUEL_INK: FlameInk = { red: 24, green: 6, blue: 0, alpha: 0.35 };
const FLAME_GLOW_INK: FlameInk = { red: 255, green: 148, blue: 44, alpha: 1 };

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
 * How hard each baked parcel shape curves, as a multiple of its own widest
 * radius, and how many half-turns of S that curve makes on the way up.
 *
 * A straight-sided teardrop is a symmetric isoceles triangle, and a field of
 * them all pointing the same way reads as a scatter of arrowheads rather than as
 * fire. A lick leans as it climbs and whips back at the tip, so the axis the
 * lobes are stacked along is an S; each parcel draws one of these variants and a
 * mirror flag from its birth hash, which keeps the cost at one stamp per parcel.
 */
const FLAME_BEND_CURVATURES: ReadonlyArray<number> = [0.3, 0.6, 0.95];
const FLAME_BEND_S_TURNS = 1.5;
/** Holds the foot on the axis while the bend builds over the parcel's length. */
const FLAME_BEND_ONSET_EXPONENT = 0.6;
/** The root's own curve: mild, because it is the part that is anchored. */
const FLAME_ROOT_CURVATURE = 0.3;

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

const TAU = Math.PI * 2;

/**
 * An alpha this small is indistinguishable from nothing on screen, and
 * `node-canvas` refuses the exponent notation JavaScript prints it in — an
 * `rgba()` carrying `5e-17` is dropped whole, which bakes a solid smear into an
 * offline render. Anything under it is simply not drawn.
 */
const MIN_VISIBLE_ALPHA = 0.004;

/**
 * A gradient stop that `node-canvas` will actually accept.
 *
 * A stop that fades out has to *exist*: dropping it — as returning null for a
 * vanishing alpha would — throws the whole gradient away and the thing it was
 * meant to draw silently disappears. A fixed-point zero is a legal `rgba()`
 * where `5e-17` is not, so a vanishing alpha is rounded down to a stop that is
 * simply invisible.
 */
function gradientStopRgba(r: number, g: number, b: number, alpha: number): string {
  const safe = alpha < MIN_VISIBLE_ALPHA ? 0 : Math.min(1, alpha);
  return `rgba(${r},${g},${b},${safe.toFixed(3)})`;
}

/** The white-out over a prop that has just been hit. */
function paintImpact(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazePropState,
): void {
  if (!state.struck) return;
  ctx.fillStyle = STRUCK_FLASH;
  ctx.fillRect(x, y, size, size);
}

/**
 * Which way the dividing wall lies from a prop's own tile: +1 east, -1 west.
 *
 * A prop faces the crawler who can reach it, so the wall it is fixed to is
 * always on the far side of that.
 */
function wallDirectionFor(facing: MazePropState['facing']): number {
  return facing === 'east' ? -1 : 1;
}

/** Splits that open across a prop as it is worked down. */
function paintCracks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  integrity: number,
): void {
  if (integrity > CRACK_THRESHOLD) return;
  ctx.strokeStyle = SANDBAG_SEAM;
  ctx.lineWidth = Math.max(1, width * CRACK_WIDTH * 2);
  ctx.beginPath();
  ctx.moveTo(x + width * 0.2, y);
  ctx.lineTo(x + width * 0.45, y + height * 0.55);
  ctx.lineTo(x + width * 0.3, y + height);
  ctx.stroke();
  if (integrity > HEAVY_CRACK_THRESHOLD) return;
  ctx.beginPath();
  ctx.moveTo(x + width * 0.8, y + height * 0.1);
  ctx.lineTo(x + width * 0.55, y + height * 0.6);
  ctx.lineTo(x + width * 0.75, y + height);
  ctx.stroke();
}

/** The floor-level grate in the dividing wall, through which the other half is visible. */
export function drawMazeGrate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const inset = size * GRATE_INSET;
  ctx.save();
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = IRON_MID;
  const barWidth = size * GRATE_BAR_WIDTH;
  const span = size - inset * 2;
  for (let i = 0; i < GRATE_BAR_COUNT; i++) {
    const bx = x + inset + (span / GRATE_BAR_COUNT) * i + (span / GRATE_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y + inset, barWidth, span);
  }
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inset, y + inset, span, span);
  ctx.restore();
}

/**
 * The sandbag counterweight: a fat canvas bag roped to the gate mechanism,
 * hanging against the grate.
 *
 * Drawn as a bulging sack rather than a box because a rectangle at this size is
 * indistinguishable from a crate, and a crate is not something a player thinks
 * to shoot.
 */
export function drawMazeSandbag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazePropState,
): void {
  ctx.save();
  const wallDirection = wallDirectionFor(state.facing);
  const bagWidth = size * SANDBAG_WIDTH;
  const bagHeight = size * SANDBAG_HEIGHT;
  // Pressed against the wall it hangs on rather than centred in its own tile.
  const centreX = x + size / 2 + (wallDirection * size * SANDBAG_WALL_HUG) / 2;
  const bagTop = y + size * SANDBAG_TOP;

  if (state.broken) {
    paintBurstSandbag(ctx, centreX, y, size, bagWidth);
    ctx.restore();
    return;
  }

  const sway = Math.sin(state.phase * ROPE_SWAY_SPEED) * size * ROPE_SWAY_TILES;
  const bagCentreX = centreX + sway;

  // The rope runs off the top of the tile: the mechanism it answers to is up in
  // the tent rigging, which is nowhere the player can reach.
  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(centreX, y);
  ctx.lineTo(bagCentreX, bagTop);
  ctx.stroke();

  const bagBottom = bagTop + bagHeight;
  const bellyY = bagTop + bagHeight * SANDBAG_BELLY_FRACTION;
  ctx.fillStyle = SANDBAG_CANVAS;
  ctx.beginPath();
  ctx.moveTo(bagCentreX - bagWidth * SANDBAG_NECK_FRACTION, bagTop);
  ctx.quadraticCurveTo(
    bagCentreX - bagWidth / 2,
    bellyY,
    bagCentreX - bagWidth * SANDBAG_FOOT_FRACTION,
    bagBottom,
  );
  ctx.lineTo(bagCentreX + bagWidth * SANDBAG_FOOT_FRACTION, bagBottom);
  ctx.quadraticCurveTo(
    bagCentreX + bagWidth / 2,
    bellyY,
    bagCentreX + bagWidth * SANDBAG_NECK_FRACTION,
    bagTop,
  );
  ctx.closePath();
  ctx.fill();

  // The underside sits in its own shadow, which is what gives a flat sack volume.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = SANDBAG_CANVAS_SHADE;
  ctx.fillRect(bagCentreX - bagWidth, bellyY, bagWidth * 2, bagBottom - bellyY);
  ctx.fillStyle = SANDBAG_SEAM;
  for (let i = 1; i <= SEAM_COUNT; i++) {
    ctx.fillRect(
      bagCentreX - bagWidth,
      bagTop + (bagHeight / (SEAM_COUNT + 1)) * i,
      bagWidth * 2,
      Math.max(1, size * SEAM_WIDTH),
    );
  }
  ctx.restore();

  // The tie at the neck, which is what makes it a sack rather than a cushion.
  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(bagCentreX - bagWidth * SANDBAG_NECK_FRACTION, bagTop);
  ctx.lineTo(bagCentreX + bagWidth * SANDBAG_NECK_FRACTION, bagTop);
  ctx.stroke();

  paintCracks(ctx, bagCentreX - bagWidth / 2, bagTop, bagWidth, bagHeight, state.integrity);
  paintImpact(ctx, x, y, size, state);
  ctx.restore();
}

/** What is left once the bag gives: a spill of sand and an empty skin over it. */
function paintBurstSandbag(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  y: number,
  size: number,
  bagWidth: number,
): void {
  ctx.fillStyle = SAND_SPILL;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    y + size * SANDBAG_SPILL_Y,
    bagWidth * SANDBAG_SPILL_WIDTH_SCALE,
    size * SANDBAG_SPILL_HEIGHT,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = SANDBAG_CANVAS_SHADE;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    y + size * SANDBAG_SKIN_Y,
    bagWidth * SANDBAG_SKIN_WIDTH_SCALE,
    size * SANDBAG_SKIN_HEIGHT,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** The load-bearing brace: a timber driven through the wall, strutted at its foot. */
export function drawMazeBrace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazePropState,
): void {
  ctx.save();
  const wallDirection = wallDirectionFor(state.facing);
  const braceWidth = size * BRACE_WIDTH;
  const braceX = x + size / 2 - braceWidth / 2 + (wallDirection * size * BRACE_WIDTH) / 2;
  const braceY = y + size * BRACE_TOP;
  const braceHeight = size * BRACE_HEIGHT;

  if (state.broken) {
    ctx.fillStyle = RUBBLE_COLOR;
    ctx.fillRect(braceX - braceWidth * 0.3, y + size * 0.76, braceWidth * 1.6, size * 0.16);
    ctx.fillStyle = PLANK_DARK;
    ctx.fillRect(braceX, y + size * 0.68, braceWidth, size * 0.1);
    ctx.restore();
    return;
  }

  ctx.fillStyle = PLANK_MID;
  ctx.fillRect(braceX, braceY, braceWidth, braceHeight);
  ctx.fillStyle = PLANK_LIGHT;
  ctx.fillRect(braceX, braceY, braceWidth * 0.35, braceHeight);
  ctx.fillStyle = PLANK_DARK;
  ctx.fillRect(braceX + braceWidth * 0.78, braceY, braceWidth * 0.22, braceHeight);

  // The strut into the wall, which is what makes the timber read as holding
  // something up rather than merely standing there.
  const strutY = braceY + braceHeight - size * BRACE_STRUT_HEIGHT;
  const strutLength = size * BRACE_STRUT_LENGTH;
  ctx.fillStyle = PLANK_MID;
  ctx.fillRect(
    wallDirection > 0 ? braceX + braceWidth : braceX - strutLength,
    strutY,
    strutLength,
    size * BRACE_STRUT_HEIGHT,
  );

  ctx.fillStyle = NAIL_COLOR;
  for (const nailY of [braceY + braceHeight * 0.2, braceY + braceHeight * 0.7]) {
    ctx.beginPath();
    ctx.arc(braceX + braceWidth / 2, nailY, size * NAIL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  paintCracks(ctx, braceX, braceY, braceWidth, braceHeight, state.integrity);
  paintImpact(ctx, x, y, size, state);
  ctx.restore();
}

/** A counterweighted iron gate, drawn shut. Nothing draws it open — it stops existing. */
export function drawMazeGate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = IRON_MID;
  const barWidth = size * GATE_BAR_WIDTH;
  for (let i = 0; i < GATE_BAR_COUNT; i++) {
    const bx = x + (size / GATE_BAR_COUNT) * i + (size / GATE_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y, barWidth, size);
  }
  const railHeight = size * GATE_RAIL_HEIGHT;
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y + size * 0.18, size, railHeight);
  ctx.fillRect(x, y + size * 0.7, size, railHeight);
  ctx.restore();
}

/** A boarded barricade, drawn shut. */
export function drawMazeBarricade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = PLANK_DARK;
  ctx.fillRect(x, y, size, size);
  const plankHeight = size / BARRICADE_PLANK_COUNT;
  for (let i = 0; i < BARRICADE_PLANK_COUNT; i++) {
    ctx.fillStyle = i % 2 === 0 ? PLANK_MID : PLANK_LIGHT;
    ctx.fillRect(
      x,
      y + plankHeight * i + size * BARRICADE_PLANK_GAP,
      size,
      plankHeight - size * BARRICADE_PLANK_GAP * 2,
    );
    ctx.fillStyle = NAIL_COLOR;
    for (const nailX of [x + size * 0.18, x + size * 0.82]) {
      ctx.beginPath();
      ctx.arc(nailX, y + plankHeight * (i + 0.5), size * NAIL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The gas jet itself, cold: an iron grille sunk into the sawdust. */
export function drawFlameVentGrille(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  // The grille is on screen from the moment the maze is, and the flame is not.
  // Baking the stamps here spends the cost on a frame with nothing at stake
  // rather than on the frame a vent lights under somebody.
  flameStamps();
  ctx.save();
  const inset = size * VENT_RIM_INSET;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = '#12161a';
  const slotWidth = size * VENT_SLOT_WIDTH;
  const slotHeight = size * VENT_SLOT_HEIGHT;
  const span = size - inset * 2;
  for (let i = 0; i < VENT_GRILLE_SLOTS; i++) {
    const sx =
      x + inset + (span / VENT_GRILLE_SLOTS) * i + (span / VENT_GRILLE_SLOTS - slotWidth) / 2;
    ctx.fillRect(sx, y + size / 2 - slotHeight / 2, slotWidth, slotHeight);
  }
  ctx.strokeStyle = IRON_MID;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inset, y + inset, span, span);
  ctx.restore();
}

/** The warning: the shared "this ground is about to hurt" language, on one tile. */
export function drawFlameVentTelegraph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
): void {
  drawDangerTile(ctx, x, y, size, Math.min(1, progress + FLAME_RAMP_FRACTION));
}

/**
 * A repeatable pseudo-random 0..1 from two integers.
 *
 * The caller holds no per-vent state — the vents are plain schedules — so every
 * parcel that has ever risen out of a grille has to be reconstructible from the
 * frame counter alone. Hashing (birth number, parcel index) gives each birth its
 * own width, brightness and sway without anything being remembered between
 * frames, and without it the parcels march in step and the column strobes.
 */
const HASH_X_STRIDE = 12.9898;
const HASH_Y_STRIDE = 78.233;
const HASH_MAGNITUDE = 43758.5453;

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

function hashUnit(a: number, b: number): number {
  const scattered = Math.sin(a * HASH_X_STRIDE + b * HASH_Y_STRIDE) * HASH_MAGNITUDE;
  return scattered - Math.floor(scattered);
}

// ── Baked flame stamps ────────────────────────────────────────────────────────

/**
 * Resolution the teardrop stamp is baked at. It is only ever drawn smaller than
 * this — a 32-pixel tile takes it down to roughly a third — and shrinking a
 * bitmap costs nothing and smooths it further.
 */
const STAMP_TEARDROP_WIDTH = 48;
const STAMP_TEARDROP_HEIGHT = 96;
const STAMP_ROUND_SIZE = 48;
const STAMP_GLOW_SIZE = 128;

/**
 * How many soft discs are stacked up the axis to build one teardrop.
 *
 * The whole point of the stamp is that fire has no crisp boundary: a filled path
 * has a hard edge no matter what curve it follows, and a column of them reads as
 * cut paper. A stack of overlapping radial falloffs has no edge anywhere.
 */
const STAMP_LOBE_COUNT = 28;
/** Above one, the stack narrows toward the tip faster than it climbs. */
const STAMP_LOBE_TAPER = 0.8;
/** The smallest disc worth stacking, in stamp pixels. */
const STAMP_MIN_LOBE_RADIUS = 1.2;
/**
 * How far the foot and tip discs are held inside the bitmap, as a share of the
 * widest radius, so neither one's falloff is clipped by the edge — a clipped
 * falloff is exactly the hard edge the stamp exists to avoid.
 */
const STAMP_FOOT_INSET = 0.55;
const STAMP_TIP_INSET = 0.25;

/** Where a disc's own falloff gives out. Softer than a gradient's default ramp. */
const STAMP_FALLOFF: ReadonlyArray<{ readonly stop: number; readonly weight: number }> = [
  { stop: 0, weight: 1 },
  { stop: 0.55, weight: 0.92 },
  { stop: 0.8, weight: 0.42 },
  { stop: 1, weight: 0 },
];

/**
 * Every soft thing in the column, baked once and stamped thereafter.
 *
 * Baking costs a few hundred fills at first light and nothing afterwards; the
 * per-tile work drops to `drawImage`, with no gradient allocated per frame.
 */
interface FlameStamps {
  /** One row of bend variants per heat tier, indexed [tier][bend]. */
  readonly body: ReadonlyArray<ReadonlyArray<CanvasSurface>>;
  readonly root: CanvasSurface;
  readonly throat: CanvasSurface;
  readonly ember: CanvasSurface;
  readonly fuel: CanvasSurface;
  readonly glow: CanvasSurface;
}

let bakedFlameStamps: FlameStamps | null = null;

function flameStamps(): FlameStamps {
  bakedFlameStamps ??= {
    body: FLAME_BODY_TIERS.map((ink) =>
      FLAME_BEND_CURVATURES.map((curvature) =>
        bakeTeardrop(ink, STAMP_TEARDROP_WIDTH, STAMP_TEARDROP_HEIGHT, curvature),
      ),
    ),
    root: bakeTeardrop(
      FLAME_ROOT_INK,
      STAMP_TEARDROP_WIDTH,
      STAMP_TEARDROP_HEIGHT,
      FLAME_ROOT_CURVATURE,
    ),
    throat: bakeDisc(FLAME_THROAT_INK, STAMP_ROUND_SIZE),
    ember: bakeDisc(FLAME_EMBER_INK, STAMP_ROUND_SIZE),
    fuel: bakeDisc(FLAME_FUEL_INK, STAMP_ROUND_SIZE),
    glow: bakeDisc(FLAME_GLOW_INK, STAMP_GLOW_SIZE),
  };
  return bakedFlameStamps;
}

/** A radial falloff in unit space, so one gradient serves every disc in a bake. */
function unitFalloff(
  ctx: CanvasRenderingContext2D,
  ink: FlameInk,
  peakAlpha: number,
): CanvasGradient {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const step of STAMP_FALLOFF) {
    gradient.addColorStop(
      step.stop,
      gradientStopRgba(ink.red, ink.green, ink.blue, peakAlpha * step.weight),
    );
  }
  return gradient;
}

/** One soft disc, drawn by scaling the unit falloff out to the radius asked for. */
function stampDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(radius, radius);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function bakeDisc(ink: FlameInk, size: number): CanvasSurface {
  const surface = allocCanvas(size, size);
  const ctx = surfaceContext(surface);
  ctx.fillStyle = unitFalloff(ctx, ink, ink.alpha);
  stampDisc(ctx, size / 2, size / 2, size / 2);
  return surface;
}

/**
 * A teardrop: soft discs stacked up an axis, wide at the foot, pinched at the tip.
 *
 * The discs are laid down additively, and each one's alpha is divided by how
 * many of its neighbours reach the same place — otherwise the fat foot, where a
 * dozen discs overlap, saturates to a solid slab while the thin tip, where one
 * does, stays a ghost.
 */
/**
 * How far the lobe stack has wandered off the vertical at a given point up the
 * teardrop, in multiples of the widest lobe radius.
 *
 * Zero at the foot however hard the curve bends, because the foot is where the
 * parcel is anchored: a teardrop whose base has slid sideways detaches from the
 * fuel it is supposed to be leaving.
 */
function bentAxisOffset(along: number, curvature: number): number {
  const onset = Math.pow(along, FLAME_BEND_ONSET_EXPONENT);
  return curvature * onset * Math.sin(along * Math.PI * FLAME_BEND_S_TURNS);
}

function lobeRadiusFraction(along: number, maxRadius: number): number {
  return Math.max(STAMP_MIN_LOBE_RADIUS / maxRadius, Math.pow(1 - along, STAMP_LOBE_TAPER));
}

/**
 * How wide a bent teardrop's bitmap has to be, as a multiple of the straight
 * one's, for no lobe's falloff to be clipped by the edge.
 *
 * Every teardrop is baked and drawn at this one width whatever its own bend, so
 * that a caller's requested half-width always means the same thing about the
 * foot no matter which variant it picked.
 */
function stampWidthMultiple(): number {
  const maxRadius = STAMP_TEARDROP_WIDTH / 2;
  const sharpestBend = Math.max(...FLAME_BEND_CURVATURES, FLAME_ROOT_CURVATURE);
  let widest = 1;
  for (let lobe = 0; lobe < STAMP_LOBE_COUNT; lobe++) {
    const along = lobe / (STAMP_LOBE_COUNT - 1);
    const reach =
      Math.abs(bentAxisOffset(along, sharpestBend)) + lobeRadiusFraction(along, maxRadius);
    widest = Math.max(widest, reach);
  }
  return widest;
}

const STAMP_BEND_PADDING = stampWidthMultiple();

function bakeTeardrop(
  ink: FlameInk,
  width: number,
  height: number,
  curvature: number,
): CanvasSurface {
  const maxRadius = width / 2;
  const paddedWidth = Math.ceil(width * STAMP_BEND_PADDING);
  const surface = allocCanvas(paddedWidth, height);
  const ctx = surfaceContext(surface);
  const footY = height - maxRadius * STAMP_FOOT_INSET;
  const lobeSpacing = (footY - maxRadius * STAMP_TIP_INSET) / (STAMP_LOBE_COUNT - 1);
  ctx.globalCompositeOperation = 'lighter';
  for (let lobe = 0; lobe < STAMP_LOBE_COUNT; lobe++) {
    const along = lobe / (STAMP_LOBE_COUNT - 1);
    const radius = maxRadius * lobeRadiusFraction(along, maxRadius);
    const overlapping = Math.max(1, (radius * 2) / lobeSpacing);
    ctx.fillStyle = unitFalloff(ctx, ink, ink.alpha / overlapping);
    const lobeX = paddedWidth / 2 + maxRadius * bentAxisOffset(along, curvature);
    stampDisc(ctx, lobeX, footY - lobeSpacing * lobe, radius);
  }
  return surface;
}

/**
 * Stamps one baked teardrop, standing on (footX, footY) and tilted about that
 * foot — a flame is anchored where it leaves the fuel and free everywhere else.
 *
 * `mirrored` flips the baked bend about that same foot, so a handful of baked
 * curves cover twice as many apparent shapes without a second bake.
 */
function stampTeardrop(
  ctx: CanvasRenderingContext2D,
  stamp: CanvasSurface,
  footX: number,
  footY: number,
  halfWidth: number,
  height: number,
  lean: number,
  alpha: number,
  mirrored: boolean,
): void {
  ctx.save();
  ctx.translate(footX, footY);
  ctx.rotate(lean);
  if (mirrored) ctx.scale(-1, 1);
  ctx.globalAlpha = alpha;
  const drawnHalfWidth = halfWidth * STAMP_BEND_PADDING;
  ctx.drawImage(stamp, -drawnHalfWidth, -height, drawnHalfWidth * 2, height);
  ctx.restore();
}

/**
 * The eruption: a column of fire standing out of the grille.
 *
 * `progress` is 0..1 across the burn; the column ramps up over its first fifth
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
  progress: number,
  phase: number,
): void {
  const rise = Math.min(1, progress / FLAME_RAMP_FRACTION);
  const fall = Math.min(1, (1 - progress) / FLAME_RAMP_FRACTION);
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
