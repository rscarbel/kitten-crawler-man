/**
 * The column of light standing over anyone worth talking to.
 *
 * The overhead `!`/`?` glyph is one head tall. Across the town plaza — sixty
 * tiles of cobble, stalls, bunting, lamps and townsfolk — it is a speck, and a
 * playtester who cannot find the quest giver never starts the quest. A beam is
 * the one thing on the map that reads from further away than the thing it marks.
 *
 * **Drawn by the creature, not by the map.** A beacon has to follow Signet, who
 * walks, so a decoration tile is out; and drawing it behind the body paint in
 * the creature's own render is what gets it Y-sorted with the figure it belongs
 * to for free, rather than as a stripe painted over everything in the overlay
 * pass.
 */

import { drawRadialGlow } from './radialGlow';

/** How tall the beam stands above the marked figure's tile, in tiles. */
const BEACON_HEIGHT_TILES = 2.8;
/** Beam width at its base, as a fraction of a tile. */
const BEACON_BASE_WIDTH_FRACTION = 0.62;
/** Beam width at its top, as a fraction of its base — a taper, not a wedge. */
const BEACON_TIP_WIDTH_FRACTION = 0.3;
/** Radius of the puddle of light at the figure's feet, in tiles. */
const BEACON_GROUND_GLOW_TILES = 0.95;
/** The ground glow's flat bright core, as a fraction of its radius. */
const BEACON_GROUND_CORE_FRACTION = 0.2;

/** One full brighten-and-dim of the beam, in milliseconds. */
const BEACON_PULSE_PERIOD_MS = 2200;
/** Alpha at the beam's base at the bottom of the pulse. */
const BEACON_ALPHA_MIN = 0.34;
/** How much brighter the top of the pulse is than {@link BEACON_ALPHA_MIN}. */
const BEACON_ALPHA_RANGE = 0.26;
/**
 * Quantization steps for the ground glow's alpha.
 *
 * The glow is a baked radial texture keyed on its colour *stop strings*, and
 * that cache is never evicted — so a continuously varying alpha bakes a fresh
 * 128×128 canvas per frame and keeps every one of them for the life of the
 * page. Both inputs to the alpha have to be quantized for that to be bounded:
 * the pulse, and the distance fade, which ramps continuously as the player walks
 * up. Quantizing only the first left the fade churning a texture a frame.
 *
 * Ten steps each is below the point where either reads as stepped, and bounds
 * the cache at a hundred entries per marker colour.
 */
const BEACON_ALPHA_STEPS = 10;

/**
 * Alphas below this are dropped rather than drawn.
 *
 * A tiny computed alpha serializes into an `rgba()` string in exponent form
 * (`3.4e-7`), which `addColorStop` rejects outright — a hard throw out of the
 * render pass for a glow nobody could have seen.
 */
const MIN_VISIBLE_ALPHA = 0.01;

/** Rounds to a fixed grid, so a continuous input cannot key an unbounded cache. */
function quantize(value: number, steps: number): number {
  return Math.round(value * steps) / steps;
}

/**
 * Inside this many tiles of the viewer the beam fades out.
 *
 * Its job is done once the player is standing at the NPC: at conversation range
 * a full-strength column of light sits between the camera and the face that is
 * talking, and during a fight around a marked NPC it is a bar across the middle
 * of the screen.
 */
const BEACON_NEAR_FADE_TILES = 2.2;
/** Beyond this the beam is at full strength; between the two it ramps. */
const BEACON_FULL_STRENGTH_TILES = 4;

/** Where the beam's own gradient reaches full transparency, going up. */
const BEAM_FADE_STOP = 0.75;

/**
 * The active player's position in world pixels, set once per rendered frame.
 *
 * A module-level viewer rather than a parameter threaded through four unrelated
 * creature classes, in the same shape as `setButtonMouseState`: every beacon in
 * a frame fades against the same player, and none of the creatures that draw one
 * otherwise has any business holding a reference to them.
 */
let viewerX = 0;
let viewerY = 0;

/** Call once per rendered frame, before anything draws a beacon. */
export function setQuestBeaconViewer(x: number, y: number): void {
  viewerX = x;
  viewerY = y;
}

function nearnessFade(
  sx: number,
  sy: number,
  tileSize: number,
  camX: number,
  camY: number,
): number {
  const distanceTiles = Math.hypot(sx + camX - viewerX, sy + camY - viewerY) / tileSize;
  if (distanceTiles >= BEACON_FULL_STRENGTH_TILES) return 1;
  if (distanceTiles <= BEACON_NEAR_FADE_TILES) return 0;
  return (
    (distanceTiles - BEACON_NEAR_FADE_TILES) / (BEACON_FULL_STRENGTH_TILES - BEACON_NEAR_FADE_TILES)
  );
}

/** Splits `#rrggbb` into the `r,g,b` triple an `rgba()` string needs. */
function rgbTripleOf(color: string): string {
  const HEX_BASE = 16;
  const HEX_PAIR = 2;
  const HEX_DIGITS = 6;
  const body = color.startsWith('#') ? color.slice(1) : color;
  if (body.length !== HEX_DIGITS) return '255,255,255';
  const channels: number[] = [];
  for (let at = 0; at < HEX_DIGITS; at += HEX_PAIR) {
    channels.push(Number.parseInt(body.slice(at, at + HEX_PAIR), HEX_BASE));
  }
  return channels.join(',');
}

/**
 * Draws the beacon for a figure whose tile's top-left corner is at screen
 * (`sx`, `sy`).
 *
 * `camX`/`camY` are needed only to turn that screen position back into a world
 * one for the distance fade — the beam itself is drawn entirely in screen space.
 *
 * Call this *before* the figure's own body paint, so the beam stands behind
 * them rather than across their face.
 */
export function drawQuestBeacon(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  camX: number,
  camY: number,
  timeMs: number,
  color: string,
): void {
  const fade = quantize(nearnessFade(sx, sy, tileSize, camX, camY), BEACON_ALPHA_STEPS);
  if (fade <= 0) return;

  const phase = (timeMs % BEACON_PULSE_PERIOD_MS) / BEACON_PULSE_PERIOD_MS;
  const wave = quantize((Math.sin(phase * Math.PI * 2) + 1) / 2, BEACON_ALPHA_STEPS);
  const alpha = (BEACON_ALPHA_MIN + wave * BEACON_ALPHA_RANGE) * fade;
  if (alpha < MIN_VISIBLE_ALPHA) return;
  const rgb = rgbTripleOf(color);

  const centreX = sx + tileSize / 2;
  const baseY = sy + tileSize;

  drawRadialGlow(
    ctx,
    centreX,
    baseY,
    tileSize * BEACON_GROUND_GLOW_TILES,
    [
      { offset: 0, color: `rgba(${rgb},${alpha})` },
      { offset: 1, color: `rgba(${rgb},0)` },
    ],
    BEACON_GROUND_CORE_FRACTION,
  );

  // A linear gradient, unlike the glow above, is allocated fresh every frame on
  // purpose: only a radial falloff is expensive enough to be worth baking, and
  // a linear one bakes its endpoints in exactly the same way — so caching it
  // would mean a cache keyed on the beam's screen position.
  const tipY = baseY - tileSize * BEACON_HEIGHT_TILES;
  const beam = ctx.createLinearGradient(centreX, baseY, centreX, tipY);
  beam.addColorStop(0, `rgba(${rgb},${alpha})`);
  beam.addColorStop(BEAM_FADE_STOP, `rgba(${rgb},${alpha * (1 - BEAM_FADE_STOP)})`);
  beam.addColorStop(1, `rgba(${rgb},0)`);

  const baseHalfWidth = (tileSize * BEACON_BASE_WIDTH_FRACTION) / 2;
  const tipHalfWidth = baseHalfWidth * BEACON_TIP_WIDTH_FRACTION;

  ctx.save();
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(centreX - baseHalfWidth, baseY);
  ctx.lineTo(centreX - tipHalfWidth, tipY);
  ctx.lineTo(centreX + tipHalfWidth, tipY);
  ctx.lineTo(centreX + baseHalfWidth, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
