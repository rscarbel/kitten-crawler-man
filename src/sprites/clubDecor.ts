/**
 * Floor dressing for each Desperado Club area — the rug that marks a zone out as
 * its own room, its name across the top, and the scuffs and spill marks that
 * keep a large flat floor from reading as empty.
 *
 * Everything here is painted flat on the ground *before* the Y-sorted entity
 * pass, so anything standing on it (crawlers, staff, the furniture sprites in
 * `clubProps`) draws over it. The furniture itself used to live in this file as
 * primitive shapes; it is now PNG art placed by the sorted pass, which is what
 * lets a player stand in front of a counter instead of under it.
 */

import { TILE_SIZE } from '../core/constants';
import { drawText } from '../ui/TextBox';
import { drawBox } from '../ui/Box';
import { CLUB_ZONES, type ClubZone, type ClubStationId } from '../core/clubLayout';

const TS = TILE_SIZE;
const RUG_INSET = 4;
const LABEL_SIZE = 12;
const LABEL_TOP_OFFSET = 6;

/** Scuffs are flattened into ovals so they read as marks seen at the game's angle, not as circles. */
const SCUFF_FLATTEN = 0.55;

// A pool of light over each room, as if from a fixture above its centre.
const GLOW_RADIUS_RATIO = 0.5;
const GLOW_CENTER_ALPHA = 0.12;
const GLOW_EDGE_ALPHA = 0;

/** Wear marks are laid out from a fixed table so the floor never shimmers between frames. */
const SCUFF_SPOTS: ReadonlyArray<{ fx: number; fy: number; r: number }> = [
  { fx: 0.22, fy: 0.34, r: 0.5 },
  { fx: 0.68, fy: 0.28, r: 0.32 },
  { fx: 0.44, fy: 0.72, r: 0.62 },
  { fx: 0.82, fy: 0.66, r: 0.4 },
  { fx: 0.14, fy: 0.82, r: 0.28 },
];

interface Screen {
  x: number;
  y: number;
  w: number;
  h: number;
}

function zoneScreen(z: ClubZone, camX: number, camY: number): Screen {
  return {
    x: z.x0 * TS - camX,
    y: z.y0 * TS - camY,
    w: (z.x1 - z.x0 + 1) * TS,
    h: (z.y1 - z.y0 + 1) * TS,
  };
}

/** Draw every zone rug, its floor wear and its label. Call before the sorted entity pass. */
export function drawClubDecor(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
  ctx.save();
  for (const zone of CLUB_ZONES) {
    const s = zoneScreen(zone, camX, camY);
    drawZoneRug(ctx, s, zone.color);
    drawFloorWear(ctx, zone.id, s, zone.color);
    drawText(ctx, zone.label, {
      x: s.x + s.w / 2,
      y: s.y + LABEL_TOP_OFFSET,
      size: LABEL_SIZE,
      bold: true,
      color: zone.color,
      align: 'center',
      outline: true,
    });
  }
  ctx.restore();
}

function drawZoneRug(ctx: CanvasRenderingContext2D, s: Screen, color: string): void {
  drawBox(ctx, {
    x: s.x + RUG_INSET,
    y: s.y + RUG_INSET,
    width: s.w - RUG_INSET * 2,
    height: s.h - RUG_INSET * 2,
    fill: hexToRgba(color, 0.1),
    border: hexToRgba(color, 0.5),
    borderWidth: 2,
    radius: 8,
  });
}

/**
 * Spills, ash and worn patches keyed to what the room is for — the tell that a
 * floor has been used, and the cheapest way to give five identical rugs their
 * own character.
 */
function drawFloorWear(
  ctx: CanvasRenderingContext2D,
  id: ClubStationId,
  s: Screen,
  accent: string,
): void {
  const stain = FLOOR_STAIN_COLOR[id];
  ctx.save();
  for (const spot of SCUFF_SPOTS) {
    ctx.fillStyle = stain;
    ctx.beginPath();
    ctx.ellipse(
      s.x + s.w * spot.fx,
      s.y + s.h * spot.fy,
      TS * spot.r,
      TS * spot.r * SCUFF_FLATTEN,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const centerX = s.x + s.w / 2;
  const centerY = s.y + s.h / 2;
  const glowRadius = Math.max(s.w, s.h) * GLOW_RADIUS_RATIO;
  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
  glow.addColorStop(0, hexToRgba(accent, GLOW_CENTER_ALPHA));
  glow.addColorStop(1, hexToRgba(accent, GLOW_EDGE_ALPHA));
  ctx.fillStyle = glow;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.restore();
}

const FLOOR_STAIN_COLOR: Record<ClubStationId, string> = {
  bar: 'rgba(60,34,12,0.22)',
  market: 'rgba(40,30,50,0.2)',
  casino: 'rgba(12,44,26,0.22)',
  mercenary: 'rgba(52,18,14,0.22)',
  vip: 'rgba(46,14,26,0.24)',
  sledge: 'rgba(0,0,0,0.15)',
};

/** Expand a `#rrggbb` string to an `rgba()` with the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
