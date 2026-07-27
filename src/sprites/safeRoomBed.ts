/**
 * The safe room's bed — the one place in the dungeon the party can sleep.
 *
 * Drawn to the game's oblique projection rather than flat from above. The
 * previous version was six top-down rectangles, which read as a decal painted on
 * the floor; what makes a bed read as *furniture* is a tall headboard with a
 * visible vertical face and a turned post at each corner, so that is the piece
 * the rest of the geometry is hung off.
 *
 * Lit up-left and shadowed down-right, matching the direction the generated
 * ground is lit from (`LIGHT_DIR` in `scripts/tilegen/materials.ts`).
 *
 * Every offset is a fraction of the tile size, so the bed is correct at the 32 px
 * the game draws at and at any size a review harness uses.
 */

// ── Palette ───────────────────────────────────────────────────────────────────
// Oiled oak matching the Bopca counter's frame, linen, and the station's own
// mossy green for the quilt band.
const FRAME_WOOD = '#6b452a';
const FRAME_WOOD_LIT = '#8a5c3a';
const FRAME_WOOD_SHADE = '#452c1b';
const POST_CAP = '#9c6a44';
const MATTRESS = '#e4dcc4';
const MATTRESS_SHADE = '#c8bfa4';
const QUILT = '#8c6f4e';
const QUILT_SHADE = '#6d5539';
const QUILT_BAND = '#546146';
const QUILT_FOLD = '#efe8d6';
const PILLOW = '#f4efe2';
const PILLOW_SHADE = '#d6cdb8';
const CONTACT_SHADOW = 'rgba(0,0,0,0.3)';
/** Warm pulse shown while the player is close enough to sleep. */
const RESTED_GLOW = '255,214,140';

// ── Geometry ──────────────────────────────────────────────────────────────────

const BED_LEFT_FRACTION = 0.14;
const BED_RIGHT_FRACTION = 0.86;
const CONTACT_SHADOW_TOP_FRACTION = 0.9;
const CONTACT_SHADOW_HEIGHT_FRACTION = 0.1;
const CONTACT_SHADOW_OVERHANG_FRACTION = 0.03;

/** The headboard's vertical face — the tallest thing on the tile. */
const HEADBOARD_TOP_FRACTION = 0.04;
const HEADBOARD_HEIGHT_FRACTION = 0.16;
const HEADBOARD_CAP_HEIGHT = 1;
const POST_WIDTH_FRACTION = 0.09;
const POST_TOP_FRACTION = 0;
const POST_CAP_HEIGHT_FRACTION = 0.05;

const FOOTBOARD_HEIGHT_FRACTION = 0.09;
const FOOTBOARD_BOTTOM_FRACTION = 0.9;

const MATTRESS_TOP_FRACTION = 0.2;
const MATTRESS_BOTTOM_FRACTION = 0.81;
const MATTRESS_INSET_FRACTION = 0.02;
/** How far the mattress crowns above its own edge, so the quilt has a fall. */
const MATTRESS_CROWN_FRACTION = 0.03;
const MATTRESS_SHADE_WIDTH_FRACTION = 0.12;

const PILLOW_TOP_FRACTION = 0.22;
const PILLOW_HEIGHT_FRACTION = 0.14;
const PILLOW_INSET_FRACTION = 0.06;
const PILLOW_SHADE_HEIGHT = 1;

const QUILT_TOP_FRACTION = 0.4;
const QUILT_BOTTOM_FRACTION = 0.79;
const QUILT_INSET_FRACTION = 0.03;
const QUILT_FOLD_HEIGHT_FRACTION = 0.05;
const QUILT_BAND_TOP_FRACTION = 0.56;
const QUILT_BAND_HEIGHT_FRACTION = 0.07;
const QUILT_SHADE_WIDTH_FRACTION = 0.14;

/** The rested pulse's brightest alpha, and how many frames one breath takes. */
const RESTED_PULSE_MAX_ALPHA = 0.22;
const RESTED_PULSE_PERIOD_FRAMES = 110;
const RESTED_GLOW_RADIUS_FRACTION = 0.9;

/**
 * Draws the bed at the top-left of its tile.
 *
 * `nearPulse` is a 0..1 breath used for the "you can sleep here" cue; pass 0 when
 * the player is out of range. It only reinforces the existing `Sleep` prompt —
 * sleeping itself is still driven entirely by `SafeRoomSystem`.
 */
export function drawSafeRoomBed(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  nearPulse: number,
): void {
  const left = sx + ts * BED_LEFT_FRACTION;
  const right = sx + ts * BED_RIGHT_FRACTION;
  const width = right - left;
  const centreX = sx + ts / 2;

  if (nearPulse > 0) {
    const radius = ts * RESTED_GLOW_RADIUS_FRACTION;
    const glow = ctx.createRadialGradient(centreX, sy + ts / 2, 0, centreX, sy + ts / 2, radius);
    const alpha = nearPulse * RESTED_PULSE_MAX_ALPHA;
    glow.addColorStop(0, `rgba(${RESTED_GLOW},${alpha})`);
    glow.addColorStop(1, `rgba(${RESTED_GLOW},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(centreX - radius, sy + ts / 2 - radius, radius * 2, radius * 2);
  }

  // Contact shadow first, so the frame sits on the floor rather than over its
  // own shade.
  const shadowOverhang = ts * CONTACT_SHADOW_OVERHANG_FRACTION;
  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    sy + ts * CONTACT_SHADOW_TOP_FRACTION,
    width / 2 + shadowOverhang,
    (ts * CONTACT_SHADOW_HEIGHT_FRACTION) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  drawHeadboard(ctx, sy, ts, left, right);
  drawMattressAndBedding(ctx, sx, sy, ts, left, right);
  drawFootboard(ctx, sy, ts, left, right);
  drawPosts(ctx, sy, ts, left, right);
}

/** The tall north end: a vertical face, capped, that the bedding runs up to. */
function drawHeadboard(
  ctx: CanvasRenderingContext2D,
  sy: number,
  ts: number,
  left: number,
  right: number,
): void {
  const top = sy + ts * HEADBOARD_TOP_FRACTION;
  const height = ts * HEADBOARD_HEIGHT_FRACTION;
  ctx.fillStyle = FRAME_WOOD;
  ctx.fillRect(left, top, right - left, height);
  // Up-left lit, down-right shadowed.
  ctx.fillStyle = FRAME_WOOD_LIT;
  ctx.fillRect(left, top, right - left, HEADBOARD_CAP_HEIGHT);
  ctx.fillStyle = FRAME_WOOD_SHADE;
  ctx.fillRect(left, top + height - HEADBOARD_CAP_HEIGHT, right - left, HEADBOARD_CAP_HEIGHT);
}

function drawFootboard(
  ctx: CanvasRenderingContext2D,
  sy: number,
  ts: number,
  left: number,
  right: number,
): void {
  const height = ts * FOOTBOARD_HEIGHT_FRACTION;
  const top = sy + ts * FOOTBOARD_BOTTOM_FRACTION - height;
  ctx.fillStyle = FRAME_WOOD;
  ctx.fillRect(left, top, right - left, height);
  ctx.fillStyle = FRAME_WOOD_LIT;
  ctx.fillRect(left, top, right - left, HEADBOARD_CAP_HEIGHT);
}

/** A turned post at each corner — what stops the frame reading as a plank. */
function drawPosts(
  ctx: CanvasRenderingContext2D,
  sy: number,
  ts: number,
  left: number,
  right: number,
): void {
  const postWidth = Math.max(1, ts * POST_WIDTH_FRACTION);
  const headTop = sy + ts * POST_TOP_FRACTION;
  const headHeight = ts * (HEADBOARD_TOP_FRACTION + HEADBOARD_HEIGHT_FRACTION);
  const footHeight = ts * FOOTBOARD_HEIGHT_FRACTION;
  const footTop = sy + ts * FOOTBOARD_BOTTOM_FRACTION - footHeight;

  for (const postX of [left, right - postWidth]) {
    ctx.fillStyle = FRAME_WOOD_SHADE;
    ctx.fillRect(postX, headTop, postWidth, headHeight);
    ctx.fillStyle = POST_CAP;
    ctx.fillRect(postX, headTop, postWidth, ts * POST_CAP_HEIGHT_FRACTION);

    ctx.fillStyle = FRAME_WOOD_SHADE;
    ctx.fillRect(postX, footTop, postWidth, footHeight);
  }
}

/** Mattress, quilt with its green band and turned-down fold, and the pillow. */
function drawMattressAndBedding(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  left: number,
  right: number,
): void {
  const mattressLeft = left + ts * MATTRESS_INSET_FRACTION;
  const mattressRight = right - ts * MATTRESS_INSET_FRACTION;
  const mattressWidth = mattressRight - mattressLeft;
  const mattressTop = sy + ts * MATTRESS_TOP_FRACTION;
  const mattressBottom = sy + ts * MATTRESS_BOTTOM_FRACTION;

  // The crown is what gives the quilt somewhere to fall over: the mattress is
  // drawn a hair proud of its own edges at the centre line.
  const crown = ts * MATTRESS_CROWN_FRACTION;
  ctx.fillStyle = MATTRESS;
  ctx.beginPath();
  ctx.moveTo(mattressLeft, mattressTop + crown);
  ctx.quadraticCurveTo(sx + ts / 2, mattressTop - crown, mattressRight, mattressTop + crown);
  ctx.lineTo(mattressRight, mattressBottom);
  ctx.lineTo(mattressLeft, mattressBottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = MATTRESS_SHADE;
  ctx.fillRect(
    mattressRight - ts * MATTRESS_SHADE_WIDTH_FRACTION,
    mattressTop + crown,
    ts * MATTRESS_SHADE_WIDTH_FRACTION,
    mattressBottom - mattressTop - crown,
  );

  const quiltLeft = mattressLeft + ts * QUILT_INSET_FRACTION;
  const quiltRight = mattressRight - ts * QUILT_INSET_FRACTION;
  const quiltTop = sy + ts * QUILT_TOP_FRACTION;
  const quiltBottom = sy + ts * QUILT_BOTTOM_FRACTION;
  ctx.fillStyle = QUILT;
  ctx.fillRect(quiltLeft, quiltTop, quiltRight - quiltLeft, quiltBottom - quiltTop);
  ctx.fillStyle = QUILT_SHADE;
  ctx.fillRect(
    quiltRight - ts * QUILT_SHADE_WIDTH_FRACTION,
    quiltTop,
    ts * QUILT_SHADE_WIDTH_FRACTION,
    quiltBottom - quiltTop,
  );
  ctx.fillStyle = QUILT_BAND;
  ctx.fillRect(
    quiltLeft,
    sy + ts * QUILT_BAND_TOP_FRACTION,
    quiltRight - quiltLeft,
    ts * QUILT_BAND_HEIGHT_FRACTION,
  );
  // Turned-down fold at the head: the pale underside of the quilt, which is what
  // says the bed is made and ready rather than merely covered.
  ctx.fillStyle = QUILT_FOLD;
  ctx.fillRect(quiltLeft, quiltTop, quiltRight - quiltLeft, ts * QUILT_FOLD_HEIGHT_FRACTION);

  const pillowLeft = mattressLeft + ts * PILLOW_INSET_FRACTION;
  const pillowWidth = mattressWidth - ts * PILLOW_INSET_FRACTION * 2;
  const pillowTop = sy + ts * PILLOW_TOP_FRACTION;
  const pillowHeight = ts * PILLOW_HEIGHT_FRACTION;
  // Rounded rather than stroked: a hard outline at this size reads as a printed
  // rectangle, which is exactly what made the old bed look like a floor decal.
  ctx.fillStyle = PILLOW;
  ctx.beginPath();
  ctx.ellipse(
    pillowLeft + pillowWidth / 2,
    pillowTop + pillowHeight / 2,
    pillowWidth / 2,
    pillowHeight / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = PILLOW_SHADE;
  ctx.fillRect(
    pillowLeft,
    pillowTop + pillowHeight - PILLOW_SHADE_HEIGHT,
    pillowWidth,
    PILLOW_SHADE_HEIGHT,
  );
}

/** The bed's "you can sleep here" breath, as a 0..1 value. */
export function restedPulse(frames: number): number {
  return (1 - Math.cos((frames / RESTED_PULSE_PERIOD_FRAMES) * Math.PI * 2)) / 2;
}
