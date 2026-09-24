/**
 * Painters for the Iron Colosseum's live pieces: the portcullis, the pig cages,
 * the cheering crowd, the banners and the mud the ball throws. Each paints in
 * tiles about an anchor at (originX, originY), scaled by `unit` pixels per tile,
 * so the sheet plan decides the resolution and the art never does.
 */

import {
  COLOSSEUM_CAGE_DEPTH_TILES,
  COLOSSEUM_CAGE_WIDTH_TILES,
  COLOSSEUM_CROWD_SHIRTS,
  drawColosseumSpectator,
} from '../../map/tiles/bossRooms/colosseumTiles';

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/** An (x, y) offset in tiles, or an (x, y, size) blob. */
type Point = readonly [number, number];
type Blob = readonly [number, number, number];

// ── Shared iron ─────────────────────────────────────────────────────────────

const IRON = '#3c424b';
const IRON_DARK = '#1b1e23';
const IRON_LIT = '#79828e';
const IRON_EDGE = '#0c0e11';
const RIVET = '#9aa3ad';
const RUST = 'rgba(122,63,28,0.45)';
const BONE = '#d9ccb0';
const BONE_SHADE = '#9c8d70';
/** Outline and bevel width on every iron piece, in tiles. */
const LINE = 0.018;
const RIVET_SMALL = 0.022;
/** A rivet's shadow falls this share of its radius down and right. */
const RIVET_SHADOW_SHIFT = HALF;

function rivetAt(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = IRON_EDGE;
  ctx.beginPath();
  ctx.arc(x + radius * RIVET_SHADOW_SHIFT, y + radius * RIVET_SHADOW_SHIFT, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = RIVET;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.fill();
}

/** A riveted iron bar from (x, y), `w` by `h`, outlined and lit along its top. */
function ironBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lit: number,
): void {
  ctx.fillStyle = IRON_EDGE;
  ctx.fillRect(x - lit, y - lit, w + lit * 2, h + lit * 2);
  ctx.fillStyle = IRON;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = IRON_LIT;
  ctx.fillRect(x, y, w, lit);
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y + h - lit, w, lit);
}

// ── Portcullis ──────────────────────────────────────────────────────────────

/** How many frames the portcullis takes to drop, and how far down it is in each. */
export const PORTCULLIS_FRAMES = 6;
const PORTCULLIS_DROP_PROGRESS: readonly number[] = [0.1, 0.32, 0.56, 0.78, 0.94, 1];
/** The opening it closes, in tiles from its anchor: the door's two columns. */
const PORTCULLIS_OPENING_TILES = 2;
/** How tall the gate is, and where the lintel it hangs from sits above its foot. */
const GATE_HEIGHT = 0.72;
const LINTEL_BOTTOM = -0.74;
const LINTEL_TOP = -0.92;
const JAMB_WIDTH = 0.2;
/** The jambs reach a hair below the gate's foot, into the groove it lands in. */
const JAMB_FOOT = 0.06;
const JAMB_RIVETS = 3;
const JAMB_RUST_INSET = 0.3;
const JAMB_RUST_WIDTH = 0.25;
const JAMB_RUST_REACH = 0.6;
const GATE_BARS = 7;
const GATE_BAR_WIDTH = 0.07;
/** Where the crossbars run, as shares of the gate's height from its top. */
const GATE_CROSSBARS: readonly number[] = [0.28, 0.62];
const GATE_CROSSBAR_HEIGHT = 0.07;
const SPIKE_LENGTH = 0.1;
const LINTEL_RIVETS = 6;
/** The shadow on the threshold where the gate lands deepens as it comes down. */
const LANDING_SHADOW_MIN_ALPHA = 0.15;
const LANDING_SHADOW_ALPHA_RANGE = 0.25;
const LANDING_SHADOW_LIFT = 2 * LINE;

/** The boar's skull over the gate: its radius in tiles, and its parts in shares of that radius. */
const SKULL_RADIUS = 0.085;
const SKULL = {
  jawDrop: 0.15,
  jawWidth: 1,
  jawHeight: 0.85,
  capWidth: 0.92,
  capHeight: 0.78,
  snoutDrop: 0.45,
  snoutWidth: 0.45,
  snoutHeight: 0.32,
  eyeSpread: 0.42,
  eyeLift: 0.1,
  eyeWidth: 0.2,
  eyeHeight: 0.16,
  nostrilSpread: 0.14,
  nostrilDrop: 0.5,
  nostrilRadius: 0.07,
  tuskWidth: 0.22,
  tuskRootSpread: 0.4,
  tuskRootDrop: 0.6,
  tuskBendSpread: 1.25,
  tuskBendDrop: 0.7,
  tuskTipSpread: 1.1,
  tuskTipLift: 0.15,
} as const;

/** A boar's skull bolted over the gate: the house's crest. */
function boarSkull(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const r = SKULL_RADIUS;
  ctx.fillStyle = BONE_SHADE;
  ctx.beginPath();
  ctx.ellipse(x, y + r * SKULL.jawDrop, r * SKULL.jawWidth, r * SKULL.jawHeight, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.ellipse(x, y, r * SKULL.capWidth, r * SKULL.capHeight, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = BONE_SHADE;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y + r * SKULL.snoutDrop,
    r * SKULL.snoutWidth,
    r * SKULL.snoutHeight,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = IRON_EDGE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + side * r * SKULL.eyeSpread,
      y - r * SKULL.eyeLift,
      r * SKULL.eyeWidth,
      r * SKULL.eyeHeight,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      x + side * r * SKULL.nostrilSpread,
      y + r * SKULL.nostrilDrop,
      r * SKULL.nostrilRadius,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  ctx.strokeStyle = BONE;
  ctx.lineWidth = r * SKULL.tuskWidth;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * SKULL.tuskRootSpread, y + r * SKULL.tuskRootDrop);
    ctx.quadraticCurveTo(
      x + side * r * SKULL.tuskBendSpread,
      y + r * SKULL.tuskBendDrop,
      x + side * r * SKULL.tuskTipSpread,
      y - r * SKULL.tuskTipLift,
    );
    ctx.stroke();
  }
}

/**
 * The portcullis over the arena's door, `frame` steps into its drop (0 raised,
 * `PORTCULLIS_FRAMES - 1` down). The anchor is where the gate's foot meets the
 * door's left jamb, at the passage's outer end.
 */
export function drawPortcullis(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  frame: number,
): void {
  const progress = PORTCULLIS_DROP_PROGRESS[Math.min(frame, PORTCULLIS_FRAMES - 1)];
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);
  const width = PORTCULLIS_OPENING_TILES;

  // The gate first, so the lintel hides what of it has not come down yet.
  const foot = -GATE_HEIGHT * (1 - progress);
  const top = foot - GATE_HEIGHT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, LINTEL_BOTTOM, width, JAMB_FOOT - LINTEL_BOTTOM);
  ctx.clip();
  ctx.fillStyle = `rgba(0,0,0,${LANDING_SHADOW_MIN_ALPHA + progress * LANDING_SHADOW_ALPHA_RANGE})`;
  ctx.fillRect(0, -LANDING_SHADOW_LIFT, width, SPIKE_LENGTH);
  for (const share of GATE_CROSSBARS) {
    ironBar(ctx, 0, top + GATE_HEIGHT * share, width, GATE_CROSSBAR_HEIGHT, LINE);
  }
  for (let bar = 0; bar < GATE_BARS; bar++) {
    const x = ((bar + HALF) / GATE_BARS) * width - GATE_BAR_WIDTH * HALF;
    ironBar(ctx, x, top, GATE_BAR_WIDTH, GATE_HEIGHT, LINE);
    ctx.fillStyle = IRON_LIT;
    ctx.beginPath();
    ctx.moveTo(x, foot);
    ctx.lineTo(x + GATE_BAR_WIDTH * HALF, foot + SPIKE_LENGTH);
    ctx.lineTo(x + GATE_BAR_WIDTH, foot);
    ctx.closePath();
    ctx.fill();
  }
  for (const share of GATE_CROSSBARS) {
    for (let bar = 0; bar < GATE_BARS; bar++) {
      const x = ((bar + HALF) / GATE_BARS) * width;
      rivetAt(ctx, x, top + GATE_HEIGHT * share + GATE_CROSSBAR_HEIGHT * HALF, RIVET_SMALL);
    }
  }
  ctx.restore();

  // The jambs and the lintel, which never move.
  const jambHeight = JAMB_FOOT - LINTEL_BOTTOM;
  for (const x of [-JAMB_WIDTH, width]) {
    ironBar(ctx, x, LINTEL_BOTTOM, JAMB_WIDTH, jambHeight, LINE);
    ctx.fillStyle = RUST;
    ctx.fillRect(
      x + JAMB_WIDTH * JAMB_RUST_INSET,
      LINTEL_BOTTOM,
      JAMB_WIDTH * JAMB_RUST_WIDTH,
      jambHeight * JAMB_RUST_REACH,
    );
    for (let rivet = 0; rivet < JAMB_RIVETS; rivet++) {
      const along = (rivet + HALF) / JAMB_RIVETS;
      rivetAt(ctx, x + JAMB_WIDTH * HALF, LINTEL_BOTTOM + jambHeight * along, RIVET_SMALL);
    }
  }
  const spanLeft = -JAMB_WIDTH;
  const span = width + JAMB_WIDTH * 2;
  const lintelMiddle = (LINTEL_TOP + LINTEL_BOTTOM) * HALF;
  ironBar(ctx, spanLeft, LINTEL_TOP, span, LINTEL_BOTTOM - LINTEL_TOP, LINE);
  for (let rivet = 0; rivet < LINTEL_RIVETS; rivet++) {
    rivetAt(ctx, spanLeft + ((rivet + HALF) / LINTEL_RIVETS) * span, lintelMiddle, RIVET_SMALL);
  }
  boarSkull(ctx, width * HALF, lintelMiddle);
  ctx.restore();
}

// ── Pig cages ───────────────────────────────────────────────────────────────

/** The cage's rows: a pig pacing, a pig at the bars, the doors bursting, and the empty cage. */
export const CAGE_IDLE_FRAMES = 2;
export const CAGE_RATTLE_FRAMES = 3;
export const CAGE_BURST_FRAMES = 3;

const PIG = '#e99c9a';
const PIG_SHADE = '#bb6c70';
const PIG_DARK = '#6e2f36';
const PIG_SNOUT = '#f4bcb3';
const PIG_EYE = '#1a0e10';
const PIG_SHADOW = 'rgba(0,0,0,0.4)';
const STRAW = '#b39b58';
const STRAW_DARK = '#6d5a2c';
const CAGE_FLOOR = '#1a120d';
const CAGE_FRAME = '#59616c';
const MOTION = 'rgba(245,235,215,0.8)';
const DUST = 'rgba(176,150,112,0.55)';

const CAGE_W = COLOSSEUM_CAGE_WIDTH_TILES;
const CAGE_D = COLOSSEUM_CAGE_DEPTH_TILES;
const CAGE_FRAME_WIDTH = 0.05;
/** The pair of barred doors across the cage's mouth: each half the mouth wide. */
const DOOR_LEAF = CAGE_W * HALF;
const DOOR_DEPTH = 0.1;
const DOOR_RAIL_SHARE = 0.35;
const DOOR_RAIL_LINE = 0.012;
const DOOR_BARS_PER_LEAF = 3;
const DOOR_BAR_WIDTH = 0.045;
const DOOR_BAR_OUTLINE = 0.01;

/** A pig seen from above, snout toward −y. Sizes in tiles. */
const PIG_BODY_WIDTH = 0.27;
const PIG_BODY_LENGTH = 0.4;
const PIG_SHADOW_OFFSET = 0.025;
const PIG_TAIL_RADIUS = 0.03;
const PIG_TAIL_WIDTH = 0.025;
const PIG_TAIL_SHIFT = 0.03;
/** The lit back sits a little up and left of the body, and a little smaller. */
const PIG_BACK_SHIFT = 0.02;
const PIG_BACK_WIDTH_SHARE = 0.82;
const PIG_BACK_LENGTH_SHARE = 0.85;
const PIG_HEAD_WIDTH = 0.085;
const PIG_HEAD_LENGTH = 0.075;
const PIG_HEAD_TUCK = 0.02;
/** One ear, for the right side of the head; the left is its mirror. The middle point is the tip. */
const PIG_EAR: readonly Point[] = [
  [0.05, 0.03],
  [0.12, -0.02],
  [0.07, -0.06],
];
const PIG_EAR_TIP = 1;
/** How much a flared ear's tip lifts per unit it spreads. */
const PIG_EAR_FLARE_LIFT = 0.3;
const PIG_EYE_SPREAD = 0.04;
const PIG_EYE_LIFT = 0.01;
const PIG_EYE_RADIUS = 0.014;
const PIG_SNOUT_REACH = 0.075;
const PIG_SNOUT_WIDTH = 0.045;
const PIG_SNOUT_LENGTH = 0.03;
const PIG_NOSTRIL_SPREAD = 0.015;
const PIG_NOSTRIL_RADIUS = 0.009;

/** Straw in the cage: position and the angle it lies at, packed toward the back. */
const CAGE_STRAW: readonly Blob[] = [
  [-0.25, 0.18, 0.3],
  [-0.08, 0.22, 2.1],
  [0.12, 0.2, 0.9],
  [0.27, 0.15, 2.6],
  [-0.2, 0.05, 1.4],
  [0.2, 0.02, 0.2],
  [0.02, 0.1, 2.9],
];
const STRAW_LENGTH = 0.12;
const STRAW_WIDTH = 0.022;

/** Idle: the pig's two poses — where it stands across the cage, how far it noses forward, ear flare. */
const IDLE_POSES: ReadonlyArray<{ x: number; nose: number; flare: number }> = [
  { x: -0.02, nose: 0, flare: 0 },
  { x: 0.02, nose: 0.025, flare: 0.02 },
];
const PIG_REST_Y = 0.05;
/** Rattle: the doors' sideways shake per frame; the pig shoves at the bars. */
const RATTLE_SHAKES: readonly number[] = [-0.035, 0.035, -0.015];
const RATTLE_DOOR_KICK = 0.05;
const RATTLE_PIG_Y = 0.02;
const RATTLE_LUNGE = 0.1;
const RATTLE_FLARE = 0.05;
/** Burst: how far the doors have swung open, and how far out the pig is, per frame. */
const BURST_SWINGS: readonly number[] = [0.6, 1.25, 1.55];
const BURST_PIG_OUT: readonly number[] = [0.22, 0.45];
const BURST_FLARE = 0.06;
const BURST_DUST_GROWTH = 0.25;
const OPEN_SWING = 1.55;

/** Motion marks flicking off the shaking doors. */
const MOTION_WIDTH = 0.02;
const MOTION_OUTSET = 0.02;
const MOTION_LENGTH = 0.05;
const MOTION_DROP = 0.1;
const MOTION_STEP = 0.03;
/** Dust kicked up at the mouth by the doors bursting: (x, y, radius) in tiles from the mouth. */
const DUST_PUFFS: readonly Blob[] = [
  [-0.2, -0.06, 0.08],
  [0.17, -0.1, 0.07],
  [0, -0.14, 0.09],
  [-0.08, -0.02, 0.06],
  [0.22, -0.03, 0.05],
];

/**
 * A pig seen from above, its snout toward −y. `lunge` pushes it forward and
 * `flare` spreads its ears, which is all a panicking pig's silhouette does.
 */
function pigFromAbove(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lunge: number,
  flare: number,
): void {
  const cy = y - lunge;
  const halfWidth = PIG_BODY_WIDTH * HALF;
  const halfLength = PIG_BODY_LENGTH * HALF;
  ctx.fillStyle = PIG_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    x + PIG_SHADOW_OFFSET,
    cy + PIG_SHADOW_OFFSET,
    halfWidth,
    halfLength,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  // Tail, then body, then head: back to front.
  ctx.strokeStyle = PIG_SHADE;
  ctx.lineWidth = PIG_TAIL_WIDTH;
  ctx.beginPath();
  ctx.arc(
    x + PIG_TAIL_SHIFT,
    cy + halfLength + PIG_TAIL_RADIUS,
    PIG_TAIL_RADIUS,
    Math.PI,
    FULL_TURN,
  );
  ctx.stroke();
  ctx.fillStyle = PIG_SHADE;
  ctx.beginPath();
  ctx.ellipse(x, cy, halfWidth, halfLength, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = PIG;
  ctx.beginPath();
  ctx.ellipse(
    x - PIG_BACK_SHIFT,
    cy - PIG_BACK_SHIFT,
    halfWidth * PIG_BACK_WIDTH_SHARE,
    halfLength * PIG_BACK_LENGTH_SHARE,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  const headY = cy - halfLength + PIG_HEAD_TUCK;
  ctx.fillStyle = PIG_DARK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    PIG_EAR.forEach(([ex, ey], index) => {
      const spread = index === PIG_EAR_TIP ? flare : 0;
      const px = x + side * (ex + spread);
      const py = headY + ey + spread * PIG_EAR_FLARE_LIFT;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = PIG;
  ctx.beginPath();
  ctx.ellipse(x, headY, PIG_HEAD_WIDTH, PIG_HEAD_LENGTH, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = PIG_EYE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + side * PIG_EYE_SPREAD, headY - PIG_EYE_LIFT, PIG_EYE_RADIUS, 0, FULL_TURN);
    ctx.fill();
  }
  const snoutY = headY - PIG_SNOUT_REACH;
  ctx.fillStyle = PIG_SNOUT;
  ctx.beginPath();
  ctx.ellipse(x, snoutY, PIG_SNOUT_WIDTH, PIG_SNOUT_LENGTH, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = PIG_DARK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + side * PIG_NOSTRIL_SPREAD, snoutY, PIG_NOSTRIL_RADIUS, 0, FULL_TURN);
    ctx.fill();
  }
}

function cageShell(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CAGE_FRAME;
  ctx.fillRect(
    -CAGE_W * HALF - CAGE_FRAME_WIDTH,
    -CAGE_D * HALF - CAGE_FRAME_WIDTH,
    CAGE_W + CAGE_FRAME_WIDTH * 2,
    CAGE_D + CAGE_FRAME_WIDTH * 2,
  );
  ctx.fillStyle = CAGE_FLOOR;
  ctx.fillRect(-CAGE_W * HALF, -CAGE_D * HALF, CAGE_W, CAGE_D);
  ctx.lineCap = 'round';
  ctx.lineWidth = STRAW_WIDTH;
  CAGE_STRAW.forEach(([sx, sy, turn], index) => {
    ctx.strokeStyle = index % 2 === 0 ? STRAW : STRAW_DARK;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(turn) * STRAW_LENGTH, sy + Math.sin(turn) * STRAW_LENGTH);
    ctx.stroke();
  });
}

/**
 * The two barred doors across the cage's mouth, each swung open about its own
 * outer hinge by `swing` radians and shaken sideways by `shake` tiles. Two
 * leaves rather than one wide door, so an open cage's doors stay beside it
 * instead of sweeping a whole tile out over the sand.
 */
function cageDoors(ctx: CanvasRenderingContext2D, swing: number, shake: number): void {
  const mouthY = -CAGE_D * HALF;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * CAGE_W * HALF + shake, mouthY);
    // Each leaf runs inward from its hinge and opens toward the pit.
    ctx.rotate(side * swing);
    ctx.scale(-side, 1);
    ironBar(ctx, 0, -DOOR_DEPTH * HALF, DOOR_LEAF, DOOR_DEPTH * DOOR_RAIL_SHARE, DOOR_RAIL_LINE);
    for (let bar = 0; bar < DOOR_BARS_PER_LEAF; bar++) {
      const x = ((bar + HALF) / DOOR_BARS_PER_LEAF) * DOOR_LEAF - DOOR_BAR_WIDTH * HALF;
      ctx.fillStyle = IRON_EDGE;
      ctx.fillRect(
        x - DOOR_BAR_OUTLINE,
        -DOOR_DEPTH * HALF - DOOR_BAR_OUTLINE,
        DOOR_BAR_WIDTH + DOOR_BAR_OUTLINE * 2,
        DOOR_DEPTH + DOOR_BAR_OUTLINE * 2,
      );
      ctx.fillStyle = IRON_LIT;
      ctx.fillRect(x, -DOOR_DEPTH * HALF, DOOR_BAR_WIDTH, DOOR_DEPTH);
    }
    ctx.restore();
  }
}

function motionMarks(ctx: CanvasRenderingContext2D, phase: number): void {
  ctx.strokeStyle = MOTION;
  ctx.lineWidth = MOTION_WIDTH;
  ctx.lineCap = 'round';
  const mouthY = -CAGE_D * HALF;
  const drift = phase * MOTION_STEP;
  for (const side of [-1, 1]) {
    const x = side * (CAGE_W * HALF + MOTION_OUTSET);
    ctx.beginPath();
    ctx.moveTo(x, mouthY + drift);
    ctx.lineTo(x + side * MOTION_LENGTH, mouthY - MOTION_LENGTH + drift);
    ctx.moveTo(x, mouthY + MOTION_DROP - drift);
    ctx.lineTo(x + side * MOTION_LENGTH, mouthY + MOTION_DROP - drift);
    ctx.stroke();
  }
}

function dustPuff(ctx: CanvasRenderingContext2D, growth: number): void {
  ctx.fillStyle = DUST;
  const mouthY = -CAGE_D * HALF;
  for (const [px, py, radius] of DUST_PUFFS) {
    ctx.beginPath();
    ctx.arc(
      px * (1 + growth),
      mouthY + py * (1 + growth),
      radius * (1 + growth * HALF),
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
}

export type CageRow = 'idle' | 'rattle' | 'burst' | 'open';

/**
 * One cage frame, drawn about its centre with the mouth toward −y. The caller
 * turns it so −y faces the arena.
 */
export function drawCage(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  row: CageRow,
  frame: number,
): void {
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);
  cageShell(ctx);
  switch (row) {
    case 'idle': {
      const pose = IDLE_POSES[frame % IDLE_POSES.length];
      pigFromAbove(ctx, pose.x, PIG_REST_Y, pose.nose, pose.flare);
      cageDoors(ctx, 0, 0);
      break;
    }
    case 'rattle': {
      const shake = RATTLE_SHAKES[frame % RATTLE_SHAKES.length];
      pigFromAbove(ctx, shake * HALF, RATTLE_PIG_Y, RATTLE_LUNGE, RATTLE_FLARE);
      cageDoors(ctx, RATTLE_DOOR_KICK * (frame % 2 === 0 ? 1 : -1), shake);
      motionMarks(ctx, frame);
      break;
    }
    case 'burst': {
      if (frame < BURST_PIG_OUT.length) {
        pigFromAbove(ctx, 0, 0, BURST_PIG_OUT[frame], BURST_FLARE);
      }
      cageDoors(ctx, BURST_SWINGS[Math.min(frame, BURST_SWINGS.length - 1)], 0);
      dustPuff(ctx, frame * BURST_DUST_GROWTH);
      break;
    }
    case 'open':
      cageDoors(ctx, OPEN_SWING, 0);
      break;
  }
  ctx.restore();
}

// ── The crowd on its feet ───────────────────────────────────────────────────

export const CHEER_FRAMES = 2;
const ARM_LENGTH = 0.17;
const ARM_WIDTH = 0.05;
const HAND_RADIUS = 0.035;
const CROWD_SKIN = '#b98a6a';
/** Arm angles from straight up, per frame: half-raised, then flung up. */
const ARM_SPREADS: readonly number[] = [0.9, 0.35];
const SHOULDER_SPAN = 0.12;
const SHOULDER_LIFT = 0.13;

/**
 * A spectator on their feet with their arms up, feet at the anchor. The body
 * is the same painter the wall's baked crowd uses, so a cheering spectator is
 * the one that was sitting there, not a stranger.
 */
export function drawCheeringSpectator(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  variant: number,
  frame: number,
): void {
  const spread = ARM_SPREADS[Math.min(frame, ARM_SPREADS.length - 1)];
  const shirt = COLOSSEUM_CROWD_SHIRTS[variant % COLOSSEUM_CROWD_SHIRTS.length];
  ctx.save();
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const sx = originX + side * SHOULDER_SPAN * unit;
    const sy = originY - SHOULDER_LIFT * unit;
    const hx = sx + Math.sin(spread) * side * ARM_LENGTH * unit;
    const hy = sy - Math.cos(spread) * ARM_LENGTH * unit;
    ctx.strokeStyle = shirt;
    ctx.lineWidth = ARM_WIDTH * unit;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = CROWD_SKIN;
    ctx.beginPath();
    ctx.arc(hx, hy, HAND_RADIUS * unit, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.restore();
  drawColosseumSpectator(ctx, originX, originY, unit, variant);
}

// ── Banners ─────────────────────────────────────────────────────────────────

export const BANNER_FRAMES = 3;
const BANNER_WIDTH = 0.3;
const BANNER_LENGTH = 0.78;
const BANNER_CLOTH = '#6d1414';
const BANNER_CLOTH_DARK = '#420a0b';
const BANNER_TRIM = '#b8923a';
const BANNER_ROD = '#2a2d33';
const BANNER_SHADOW = 'rgba(0,0,0,0.35)';
/** How far the banner's tail swings sideways in each frame. */
const BANNER_SWAYS: readonly number[] = [-0.03, 0, 0.03];
const BANNER_NOTCH = 0.12;
const BANNER_CLOTH_TOP = 0.04;
const BANNER_TRIM_WIDTH = 0.025;
const BANNER_SHADOW_OFFSET = 0.03;
/** The fold of shade down the banner's right side: where it starts across, and how deep into the tail notch it reaches. */
const BANNER_FOLD_FROM = 0.35;
const BANNER_FOLD_NOTCH_SHARE = 0.6;
const BANNER_FOLD_TOP = 0.05;
const BANNER_ROD_OVERHANG = 0.04;
const BANNER_ROD_HEIGHT = 0.05;
/** The pig's-head crest: how far down the cloth it sits, how much of the sway it follows, and its shape. */
const CREST_DROP_SHARE = 0.38;
const CREST_SWAY_SHARE = 0.4;
const CREST_WIDTH = 0.085;
const CREST_HEIGHT = 0.075;
const CREST_EAR: readonly Point[] = [
  [0.05, -0.05],
  [0.09, -0.11],
  [0.08, -0.03],
];
const CREST_SNOUT_DROP = 0.035;
const CREST_SNOUT_WIDTH = 0.035;
const CREST_SNOUT_HEIGHT = 0.025;

/** A banner hanging from its rod at the anchor, swaying `frame` steps. */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  frame: number,
): void {
  const sway = BANNER_SWAYS[Math.min(frame, BANNER_SWAYS.length - 1)];
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);
  const half = BANNER_WIDTH * HALF;
  const outline = (inset: number): void => {
    ctx.beginPath();
    ctx.moveTo(-half + inset, BANNER_CLOTH_TOP);
    ctx.lineTo(half - inset, BANNER_CLOTH_TOP);
    ctx.lineTo(half - inset + sway, BANNER_LENGTH - inset);
    ctx.lineTo(sway, BANNER_LENGTH - BANNER_NOTCH - inset);
    ctx.lineTo(-half + inset + sway, BANNER_LENGTH - inset);
    ctx.closePath();
  };
  ctx.fillStyle = BANNER_SHADOW;
  ctx.save();
  ctx.translate(BANNER_SHADOW_OFFSET, BANNER_SHADOW_OFFSET);
  outline(0);
  ctx.fill();
  ctx.restore();
  outline(0);
  ctx.fillStyle = BANNER_TRIM;
  ctx.fill();
  outline(BANNER_TRIM_WIDTH);
  ctx.fillStyle = BANNER_CLOTH;
  ctx.fill();
  ctx.fillStyle = BANNER_CLOTH_DARK;
  ctx.beginPath();
  ctx.moveTo(half * BANNER_FOLD_FROM, BANNER_FOLD_TOP);
  ctx.lineTo(half - BANNER_TRIM_WIDTH, BANNER_FOLD_TOP);
  ctx.lineTo(half - BANNER_TRIM_WIDTH + sway, BANNER_LENGTH - BANNER_TRIM_WIDTH);
  ctx.lineTo(
    half * BANNER_FOLD_FROM + sway,
    BANNER_LENGTH - BANNER_NOTCH * BANNER_FOLD_NOTCH_SHARE,
  );
  ctx.closePath();
  ctx.fill();
  // A pig's head in the house's gold, facing out.
  const crestX = sway * CREST_SWAY_SHARE;
  const crestY = BANNER_LENGTH * CREST_DROP_SHARE;
  ctx.fillStyle = BANNER_TRIM;
  ctx.beginPath();
  ctx.ellipse(crestX, crestY, CREST_WIDTH, CREST_HEIGHT, 0, 0, FULL_TURN);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    CREST_EAR.forEach(([ex, ey], index) => {
      if (index === 0) ctx.moveTo(crestX + side * ex, crestY + ey);
      else ctx.lineTo(crestX + side * ex, crestY + ey);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = BANNER_CLOTH_DARK;
  ctx.beginPath();
  ctx.ellipse(
    crestX,
    crestY + CREST_SNOUT_DROP,
    CREST_SNOUT_WIDTH,
    CREST_SNOUT_HEIGHT,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = BANNER_ROD;
  ctx.fillRect(
    -half - BANNER_ROD_OVERHANG,
    0,
    BANNER_WIDTH + BANNER_ROD_OVERHANG * 2,
    BANNER_ROD_HEIGHT,
  );
  ctx.restore();
}

// ── Mud thrown by the ball ──────────────────────────────────────────────────

export const MUD_SPLATTER_VARIANTS = 4;
const SPLAT = '#2a1d13';
const SPLAT_WET = '#4b3726';
/** Each variant's blobs: a central slap and droplets flung round it, (x, y, radius) in tiles. */
const SPLATTER_SHAPES: ReadonlyArray<readonly Blob[]> = [
  [
    [0, 0, 0.14],
    [0.2, -0.08, 0.05],
    [-0.18, 0.1, 0.06],
    [0.05, 0.24, 0.04],
    [-0.28, -0.12, 0.035],
    [0.3, 0.14, 0.03],
  ],
  [
    [0.02, -0.02, 0.12],
    [-0.12, -0.2, 0.06],
    [0.22, 0.05, 0.07],
    [-0.25, 0.14, 0.04],
    [0.12, 0.27, 0.035],
  ],
  [
    [-0.03, 0.02, 0.15],
    [0.2, -0.18, 0.05],
    [0.28, 0.02, 0.04],
    [-0.2, -0.16, 0.045],
    [-0.1, 0.26, 0.05],
    [0.16, 0.2, 0.03],
  ],
  [
    [0, 0, 0.11],
    [0.14, 0.14, 0.07],
    [-0.16, 0.04, 0.06],
    [0.24, -0.16, 0.04],
    [-0.06, -0.26, 0.035],
  ],
];
/** Each blob is a little wider than it is tall, and lit up and left by this share of its radius. */
const SPLAT_ASPECT = 1.2;
const SPLAT_WET_SHIFT = 0.25;
const SPLAT_WET_WIDTH = 0.45;
const SPLAT_WET_HEIGHT = 0.35;

/** A splash of wallow mud thrown onto the sand, variant `variant`, centred on the anchor. */
export function drawMudSplatter(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  variant: number,
): void {
  const shape = SPLATTER_SHAPES[variant % SPLATTER_SHAPES.length];
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);
  for (const [x, y, radius] of shape) {
    const turn = Math.atan2(y, x);
    ctx.fillStyle = SPLAT;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * SPLAT_ASPECT, radius, turn, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = SPLAT_WET;
    ctx.beginPath();
    ctx.ellipse(
      x - radius * SPLAT_WET_SHIFT,
      y - radius * SPLAT_WET_SHIFT,
      radius * SPLAT_WET_WIDTH,
      radius * SPLAT_WET_HEIGHT,
      turn,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  ctx.restore();
}
