/**
 * Wayfinding furniture — signposts, gate arches and bunting. Where the shop signs
 * say *what a building is*, these say *where you are* and *which way is out*.
 *
 * All three reach well above their own tile, so all three are drawn in the
 * Y-sorted prop pass rather than baked into the ground cache. The arch is the
 * extreme case: it spans a gate's whole opening and rises three tiles, which is
 * why `TownDecorSystem` anchors it at the gate's west jamb (face-on) or north
 * jamb (top-down) rather than at its centre — a prop is culled on its anchor, and
 * an anchor in the middle of a wide prop halves the margin available either
 * side.
 */

import { PARCHMENT, WOOD, WOOD_DARK, WOOD_LIGHT } from './townPalette';

const TWO_PI = Math.PI * 2;

/**
 * A gateway's two jambs, hoisted out of the painters that iterate them: an array
 * literal inside a `for…of` allocates every frame, and these run once per gate
 * per frame.
 */
const GATEWAY_JAMBS: ReadonlyArray<number> = [0, 1];

const IRON = '#3a3630';
const STONE = '#7d7669';
const STONE_DARK = '#544f46';
const STONE_LIGHT = '#98907f';

// ── Signpost ─────────────────────────────────────────────────────────────────

/** Geometry as fractions of a tile, from the anchor tile's top-left. */
const POST_TOP = -1.9;
const POST_BOTTOM = 0.88;
const POST_WIDTH_PX = 4;
const POST_FOOT_HALF_WIDTH = 0.16;
const POST_FOOT_HEIGHT = 0.1;
/** Where the topmost arm sits, and how far the next one hangs below it. */
const ARM_TOP = -1.7;
const ARM_PITCH = 0.4;
/**
 * Minimum arm length. The real length is whatever the label needs — every one of
 * the town's six arms overflowed a fixed 0.92-tile arm, from 125% of the board for
 * "East Gate" to 260% for "The Desperado Club", which put a tile of text out past
 * the end of the plank. An arm is a board with a name written on it, so the board
 * has to be as long as the name.
 */
const ARM_MIN_LENGTH = 0.92;
const ARM_HEIGHT = 0.3;
const ARM_POINT = 0.16;
const ARM_TEXT_INSET_PX = 3;
const ARM_TEXT_SIZE_FRACTION = 0.2;
const SIGNPOST_SHADOW_COLOR = 'rgba(0,0,0,0.24)';
const SIGNPOST_SHADOW_HALF_WIDTH = 0.24;
const SIGNPOST_SHADOW_HEIGHT = 0.07;

/** One arm of a signpost: which way it points, and what it says. */
export interface SignpostArm {
  readonly label: string;
  /** −1 for an arm pointing west, +1 for east. */
  readonly direction: -1 | 1;
}

/**
 * A fingerpost: a post with one pointed arm per destination.
 *
 * The label is drawn with the canvas's own text rather than through
 * `src/ui/TextBox`, which is for screen-space UI — this is world-space art that
 * scales with the tile and pans with the camera, and routing it through the UI
 * helper would tie a prop's lettering to the HUD's font stack.
 */
export function drawSignpost(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  arms: ReadonlyArray<SignpostArm>,
): void {
  // `font`, `textAlign` and `textBaseline` are context state like any other, and
  // resetting them by hand is how you discover that the canvas default for
  // `textAlign` is `'start'` rather than `'left'`.
  ctx.save();
  const cx = sx + ts / 2;
  const bottom = sy + ts * POST_BOTTOM;

  ctx.fillStyle = SIGNPOST_SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    bottom + ts * POST_FOOT_HEIGHT,
    ts * SIGNPOST_SHADOW_HALF_WIDTH,
    ts * SIGNPOST_SHADOW_HEIGHT,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    cx - POST_WIDTH_PX / 2,
    sy + ts * POST_TOP,
    POST_WIDTH_PX,
    bottom - sy - ts * POST_TOP,
  );
  ctx.fillRect(
    cx - ts * POST_FOOT_HALF_WIDTH,
    bottom,
    ts * POST_FOOT_HALF_WIDTH * 2,
    ts * POST_FOOT_HEIGHT,
  );

  ctx.textBaseline = 'middle';
  // Set once per post rather than once per arm — assigning `ctx.font` reparses
  // the string every time. It has to be set before the arms are sized, because
  // their length comes from measuring the label in it.
  ctx.font = `${Math.round(ts * ARM_TEXT_SIZE_FRACTION)}px sans-serif`;
  // An indexed loop rather than `forEach`: this runs once per signpost per frame,
  // and a callback allocates a closure each time.
  for (let index = 0; index < arms.length; index++) {
    const arm = arms[index];
    const top = sy + ts * (ARM_TOP + index * ARM_PITCH);
    const height = ts * ARM_HEIGHT;
    const point = ts * ARM_POINT;
    const labelWidth = ctx.measureText(arm.label).width;
    const length = Math.max(ts * ARM_MIN_LENGTH, labelWidth + ARM_TEXT_INSET_PX * 2 + point);
    const root = cx;
    const tip = cx + arm.direction * length;

    ctx.fillStyle = WOOD;
    ctx.beginPath();
    ctx.moveTo(root, top);
    ctx.lineTo(tip - arm.direction * point, top);
    ctx.lineTo(tip, top + height / 2);
    ctx.lineTo(tip - arm.direction * point, top + height);
    ctx.lineTo(root, top + height);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(Math.min(root, tip), top, Math.abs(tip - root), 1);

    ctx.fillStyle = PARCHMENT;
    ctx.textAlign = arm.direction < 0 ? 'right' : 'left';
    ctx.fillText(
      arm.label,
      arm.direction < 0 ? root - ARM_TEXT_INSET_PX : root + ARM_TEXT_INSET_PX,
      top + height / 2,
    );
  }
  ctx.restore();
}

// ── Gate arch ────────────────────────────────────────────────────────────────

const ARCH_PIER_WIDTH = 0.7;
const ARCH_PIER_TOP = -2.4;
const ARCH_PIER_BOTTOM = 0.95;
const ARCH_SPRING_Y = -1.7;
const ARCH_CROWN_Y = -3.6;
const ARCH_BAND_HEIGHT = 0.34;
const ARCH_COURSE_HEIGHT_PX = 6;
const ARCH_COURSE_INSET_PX = 2;
const ARCH_KEYSTONE_HALF_WIDTH = 0.16;
const ARCH_KEYSTONE_HEIGHT = 0.34;
const ARCH_LANTERN_RADIUS_PX = 3;
const ARCH_LANTERN_GLOW = 'rgba(255,196,96,0.9)';
const ARCH_LANTERN_CORE = '#ffe9b0';
const ARCH_GLOW_BLUR_FRACTION = 0.3;

/** How far a top-down gatehouse's piers stand proud of the wall, in tiles. */
const GATEHOUSE_PIER_DEPTH = 0.8;
const GATEHOUSE_PIER_OVERHANG = 0.25;

/**
 * Which way a gate's opening runs, and therefore how its arch is seen.
 *
 * The town wall is drawn face-on where it runs east–west and top-down where it
 * runs north–south — `drawTownWallTile` only crenellates a run's exposed north
 * face — and a gate has to match the wall it is cut into. So these are not one
 * drawing rotated: `across` is the arch you look *through*, seen face-on, and
 * `along` is a gatehouse seen from above, which is two piers and the stone
 * between them.
 */
export type GateArchAxis = 'across' | 'along';

/**
 * A stone gateway `spanTiles` wide, drawn from the opening's west (or north) jamb.
 *
 * The piers stand *beside* the opening rather than in it — the gate is the only
 * way through the wall, and an arch that narrowed it would be a wall with a hole
 * the player has to squeeze through.
 *
 * The face-on vault rises nearly two tiles above its springing over the widest
 * gate. A first cut at 1.2 read as a bent wire across the gap rather than as
 * masonry: over a four-tile span, a shallow curve of a thin band is a line, and
 * what makes an arch an arch is that its rise is a real fraction of its span.
 */
export function drawGateArch(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  spanTiles: number,
  axis: GateArchAxis,
): void {
  ctx.save();
  if (axis === 'across') {
    drawArchAcross(ctx, sx, sy, ts, spanTiles);
  } else {
    drawGatehouseAlong(ctx, sx, sy, ts, spanTiles);
  }
  ctx.restore();
}

/** Fills a block of coursed ashlar, which both gateway forms are built from. */
function fillCoursedStone(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = STONE;
  for (let y = top; y < top + height; y += ARCH_COURSE_HEIGHT_PX) {
    const courseHeight = Math.min(ARCH_COURSE_HEIGHT_PX - 2, top + height - y - 1);
    if (courseHeight <= 0) continue;
    ctx.fillRect(
      left + ARCH_COURSE_INSET_PX,
      y + 1,
      width - ARCH_COURSE_INSET_PX * 2,
      courseHeight,
    );
  }
}

/** A lantern hung under a gateway, with its halo. */
function drawGateLantern(ctx: CanvasRenderingContext2D, cx: number, cy: number, ts: number): void {
  ctx.save();
  ctx.shadowColor = ARCH_LANTERN_GLOW;
  ctx.shadowBlur = ts * ARCH_GLOW_BLUR_FRACTION;
  ctx.fillStyle = ARCH_LANTERN_CORE;
  ctx.beginPath();
  ctx.arc(cx, cy, ARCH_LANTERN_RADIUS_PX, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** The face-on arch: two piers, a vault between them, a keystone and a lantern. */
function drawArchAcross(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  spanTiles: number,
): void {
  const westPierRight = sx;
  const eastPierLeft = sx + ts * spanTiles;
  const pierWidth = ts * ARCH_PIER_WIDTH;
  const pierTop = sy + ts * ARCH_PIER_TOP;
  const pierBottom = sy + ts * ARCH_PIER_BOTTOM;
  const springY = sy + ts * ARCH_SPRING_Y;
  const crownY = sy + ts * ARCH_CROWN_Y;
  const centreX = (westPierRight + eastPierLeft) / 2;

  for (const jamb of GATEWAY_JAMBS) {
    const pierLeft = jamb === 0 ? westPierRight - pierWidth : eastPierLeft;
    fillCoursedStone(ctx, pierLeft, pierTop, pierWidth, pierBottom - pierTop);
  }

  // The vault: a thick quadratic band between the two springings.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = STONE_DARK;
  ctx.lineWidth = ts * ARCH_BAND_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(westPierRight - pierWidth / 2, springY);
  ctx.quadraticCurveTo(centreX, crownY, eastPierLeft + pierWidth / 2, springY);
  ctx.stroke();
  ctx.strokeStyle = STONE;
  ctx.lineWidth = ts * ARCH_BAND_HEIGHT - ARCH_COURSE_INSET_PX * 2;
  ctx.beginPath();
  ctx.moveTo(westPierRight - pierWidth / 2, springY);
  ctx.quadraticCurveTo(centreX, crownY, eastPierLeft + pierWidth / 2, springY);
  ctx.stroke();

  const crownTop = (springY + crownY) / 2;
  ctx.fillStyle = STONE_LIGHT;
  ctx.fillRect(
    centreX - ts * ARCH_KEYSTONE_HALF_WIDTH,
    crownTop - (ts * ARCH_KEYSTONE_HEIGHT) / 2,
    ts * ARCH_KEYSTONE_HALF_WIDTH * 2,
    ts * ARCH_KEYSTONE_HEIGHT,
  );

  const lanternY = crownTop + ts * ARCH_KEYSTONE_HEIGHT;
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centreX, crownTop);
  ctx.lineTo(centreX, lanternY);
  ctx.stroke();
  drawGateLantern(ctx, centreX, lanternY, ts);
}

/**
 * The gateway seen from above: a stone pier beyond each end of the opening, each
 * carrying a lantern on its inner face.
 *
 * **Nothing is drawn across the throat.** A first cut roofed the opening — a slab
 * of coursed stone over all four of its tiles — on the reasoning that a gatehouse
 * seen from above *is* its roof. What that produced was an unbroken six-tile grey
 * band embedded in the wall with no visible gate at all, and it sorted two ways at
 * once: a player on the roof's own anchor row was hidden under it, one row south
 * was drawn over it. The face-on form already states the rule this broke — an arch
 * that narrows its opening is a wall with a hole in it — and two piers say
 * "gateway" from above without covering the one tile the player has to walk
 * through.
 */
function drawGatehouseAlong(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  spanTiles: number,
): void {
  const pierDepth = ts * GATEHOUSE_PIER_DEPTH;
  const pierLeft = sx - ts * GATEHOUSE_PIER_OVERHANG;
  const pierWidth = ts * (1 + GATEHOUSE_PIER_OVERHANG * 2);
  const northPierTop = sy - pierDepth;
  const southPierTop = sy + ts * spanTiles;

  for (const jamb of GATEWAY_JAMBS) {
    const pierTop = jamb === 0 ? northPierTop : southPierTop;
    fillCoursedStone(ctx, pierLeft, pierTop, pierWidth, pierDepth);
    // The lantern hangs on the pier's inner face, over the paving rather than over
    // the stone, so the pair reads as lighting the way through.
    const lanternY = jamb === 0 ? pierTop + pierDepth : pierTop;
    drawGateLantern(ctx, sx + ts / 2, lanternY, ts);
  }
}

// ── Bunting ──────────────────────────────────────────────────────────────────

const BUNTING_HEIGHT = -1.5;
const BUNTING_SAG = 0.5;
const BUNTING_LINE_WIDTH_PX = 1;
const BUNTING_FLAGS_PER_SPAN = 7;
const BUNTING_FLAG_HALF_WIDTH_PX = 4;
const BUNTING_FLAG_DROP_PX = 9;
const BUNTING_LINE_COLOR = '#8a7a55';
/**
 * Festival colours, cycled along the line. Four rather than three so a run of
 * seven flags does not put the same colour at both ends of a span.
 */
const BUNTING_FLAG_COLORS: ReadonlyArray<string> = ['#b8443c', '#d8b45a', '#4a7f96', '#e9dcc0'];

/**
 * A string of pennants across a street, `spanTiles` wide from its anchor tile.
 *
 * Like the laundry line, the flags hang from the *sagging* rope rather than from
 * the chord between its ends — evaluating the same quadratic the rope is drawn
 * with, so a pennant in the middle of a span hangs from the middle of the dip
 * instead of floating above it.
 */
export function drawBunting(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  spanTiles: number,
  colorPhase: number,
): void {
  ctx.save();
  const startX = sx + ts / 2;
  const endX = startX + ts * spanTiles;
  const lineY = sy + ts * BUNTING_HEIGHT;
  const controlY = lineY + ts * BUNTING_SAG * 2;

  ctx.strokeStyle = BUNTING_LINE_COLOR;
  ctx.lineWidth = BUNTING_LINE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(startX, lineY);
  ctx.quadraticCurveTo((startX + endX) / 2, controlY, endX, lineY);
  ctx.stroke();

  for (let flag = 0; flag < BUNTING_FLAGS_PER_SPAN; flag++) {
    const t = (flag + 1) / (BUNTING_FLAGS_PER_SPAN + 1);
    const x = startX + (endX - startX) * t;
    const y = (1 - t) * (1 - t) * lineY + 2 * (1 - t) * t * controlY + t * t * lineY;
    ctx.fillStyle = BUNTING_FLAG_COLORS[(flag + colorPhase) % BUNTING_FLAG_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(x - BUNTING_FLAG_HALF_WIDTH_PX, y);
    ctx.lineTo(x + BUNTING_FLAG_HALF_WIDTH_PX, y);
    ctx.lineTo(x, y + BUNTING_FLAG_DROP_PX);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
