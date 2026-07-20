import type { TileContent } from '../tileTypes';
import { drawText } from '../../ui/TextBox';
import {
  STAIRS_UP,
  STAIRS_DOWN,
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  RUG,
  CHAIR,
  SAWDUST_FLOOR,
  CIRCUS_RING_EDGE,
  TENT_POLE,
  BLEACHER,
} from '../tileTypes';
import { inferFloorType } from './helpers';
import { drawTerrainTile } from './terrainTiles';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import { frameTime } from '../../utils';

export function drawInteriorTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  switch (type) {
    // Interior stairs — carpet base with stone steps and directional arrow
    case STAIRS_UP:
    case STAIRS_DOWN: {
      const isUp = type === STAIRS_UP;
      // Carpet base (matches tower carpet floor type 7)
      ctx.fillStyle = '#5a2d2d';
      ctx.fillRect(sx, sy, ts, ts);
      ctx.fillStyle = '#4a1e1e';
      ctx.fillRect(sx + 1, sy + 1, ts - 2, ts - 2);

      // Draw 4 stone steps
      const stepCount = 4;
      const stepH = Math.floor((ts - 4) / stepCount);
      for (let i = 0; i < stepCount; i++) {
        const idx = isUp ? stepCount - 1 - i : i;
        const brightness = 140 - idx * 25;
        ctx.fillStyle = `rgb(${brightness}, ${brightness - 10}, ${brightness - 20})`;
        const stepY = sy + 2 + i * stepH;
        const inset = idx * 3;
        ctx.fillRect(sx + 2 + inset, stepY, ts - 4 - inset * 2, stepH - 1);
        // Step edge highlight
        ctx.fillStyle = `rgba(255,255,255,0.12)`;
        ctx.fillRect(sx + 2 + inset, stepY, ts - 4 - inset * 2, 1);
      }

      // Pulsing amber glow border
      const stairPulse = 0.5 + Math.sin((frameTime * 1000) / 600) * 0.3;
      ctx.strokeStyle = `rgba(220, 170, 50, ${stairPulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, ts - 2, ts - 2);

      // Directional arrow
      const arrowSize = Math.floor(ts * 0.5);
      drawText(ctx, isUp ? '\u25B2' : '\u25BC', {
        x: sx + ts / 2,
        y: sy + ts * 0.65 - Math.round(arrowSize * 0.8),
        bold: true,
        size: arrowSize,
        color: `rgba(255, 230, 140, ${stairPulse + 0.2})`,
        align: 'center',
      });
      return true;
    }

    // Table — context-aware: seamless horizontal surface across adjacent TABLE tiles
    case TABLE: {
      const tableFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, tableFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, tableFloor, sx, sy, ts, tx, ty);
      }

      const tblLeft = structure[ty]?.[tx - 1]?.type === TABLE;
      const tblRight = structure[ty]?.[tx + 1]?.type === TABLE;
      const legInset = Math.floor(ts * 0.15);
      const tabTop = Math.floor(ts * 0.2);
      const tabH = Math.floor(ts * 0.6);

      // Legs only on outer edges of the table group
      ctx.fillStyle = '#5a3a1a';
      if (!tblLeft) ctx.fillRect(sx + legInset, sy + tabTop, 3, tabH);
      if (!tblRight) ctx.fillRect(sx + ts - legInset - 3, sy + tabTop, 3, tabH);

      // Table surface spans full tile width, seamless into neighbors
      const surfL = tblLeft ? 0 : legInset - 2;
      const surfR = tblRight ? 0 : legInset - 2;
      ctx.fillStyle = '#8B5E3C';
      ctx.fillRect(sx + surfL, sy + tabTop, ts - surfL - surfR, Math.floor(ts * 0.35));
      // Plank grain line
      ctx.fillStyle = '#7a5030';
      ctx.fillRect(sx + surfL, sy + tabTop + Math.floor(ts * 0.15), ts - surfL - surfR, 1);
      // Top edge highlight
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(sx + surfL, sy + tabTop, ts - surfL - surfR, 1);
      // Front edge shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(sx + surfL, sy + tabTop + Math.floor(ts * 0.35) - 1, ts - surfL - surfR, 1);
      return true;
    }

    // Bookshelf — tall wooden shelf with coloured book spines
    case BOOKSHELF: {
      const bsFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, bsFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, bsFloor, sx, sy, ts, tx, ty);
      }

      const shelfInset = 2;
      // Shelf back panel
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(sx + shelfInset, sy + 1, ts - shelfInset * 2, ts - 2);
      // Shelf horizontal dividers (3 shelves)
      ctx.fillStyle = '#7a5030';
      const shelfW = ts - shelfInset * 2;
      for (let i = 0; i < 4; i++) {
        const shelfY = sy + 1 + Math.floor(((ts - 2) * i) / 3);
        ctx.fillRect(sx + shelfInset, shelfY, shelfW, 2);
      }
      // Books on each shelf row
      const bookColors = [
        '#c0392b',
        '#2980b9',
        '#27ae60',
        '#8e44ad',
        '#d4a017',
        '#1abc9c',
        '#e67e22',
        '#6c3483',
      ];
      let colorIdx = (tx * 7 + ty * 3) % bookColors.length; // deterministic variety
      for (let row = 0; row < 3; row++) {
        const rowTop = sy + 3 + Math.floor(((ts - 2) * row) / 3);
        const rowH = Math.floor((ts - 2) / 3) - 3;
        let bx = sx + shelfInset + 2;
        const rowEnd = sx + ts - shelfInset - 2;
        while (bx + 2 < rowEnd) {
          const bw = 2 + ((colorIdx * 3) % 3); // 2–4 px wide
          ctx.fillStyle = bookColors[colorIdx % bookColors.length];
          ctx.fillRect(bx, rowTop, bw, rowH);
          // Spine highlight
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(bx, rowTop, 1, rowH);
          bx += bw + 1;
          colorIdx++;
        }
      }
      return true;
    }

    // Bed — context-aware 2×2 block: top-left=pillow, top-right=pillow, bottom=blanket
    case BED: {
      const bedFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, bedFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, bedFloor, sx, sy, ts, tx, ty);
      }

      const bedL = structure[ty]?.[tx - 1]?.type === BED;
      const bedR = structure[ty]?.[tx + 1]?.type === BED;
      const bedU = structure[ty - 1]?.[tx]?.type === BED;
      const bedD = structure[ty + 1]?.[tx]?.type === BED;
      const isTop = !bedU && bedD; // top row of bed
      const isBottom = bedU && !bedD; // bottom row of bed
      const isLeftEdge = !bedL;
      const isRightEdge = !bedR;

      // Frame edges
      const frameL = isLeftEdge ? 2 : 0;
      const frameR = isRightEdge ? 2 : 0;
      const frameT = isTop ? 2 : 0;
      const frameB = isBottom ? 2 : 0;
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(sx, sy, ts, ts);
      // Mattress fill
      ctx.fillStyle = '#f5f0e1';
      ctx.fillRect(sx + frameL, sy + frameT, ts - frameL - frameR, ts - frameT - frameB);

      if (isTop) {
        // Pillow area — cream/white pillows
        ctx.fillStyle = '#f8f4e8';
        const pw = ts - frameL - frameR - 4;
        ctx.fillRect(sx + frameL + 2, sy + frameT + 2, pw, Math.floor(ts * 0.45));
        // Pillow indent
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(sx + frameL + 4, sy + frameT + 5, pw - 4, Math.floor(ts * 0.2));
        // Blanket fold at bottom of pillow tile
        ctx.fillStyle = '#3b6ea5';
        ctx.fillRect(
          sx + frameL,
          sy + ts - Math.floor(ts * 0.3),
          ts - frameL - frameR,
          Math.floor(ts * 0.3),
        );
        ctx.fillStyle = '#2c5a8a';
        ctx.fillRect(sx + frameL, sy + ts - Math.floor(ts * 0.3), ts - frameL - frameR, 2);
      } else if (isBottom) {
        // Blanket fills entire bottom tile
        ctx.fillStyle = '#3b6ea5';
        ctx.fillRect(sx + frameL, sy, ts - frameL - frameR, ts - frameB);
        // Blanket texture lines
        ctx.fillStyle = '#2c5a8a';
        ctx.fillRect(sx + frameL, sy + Math.floor(ts * 0.3), ts - frameL - frameR, 1);
        ctx.fillRect(sx + frameL, sy + Math.floor(ts * 0.65), ts - frameL - frameR, 1);
      } else {
        // Single-tile bed fallback (no vertical neighbors)
        ctx.fillStyle = '#3b6ea5';
        ctx.fillRect(sx + 3, sy + Math.floor(ts * 0.45), ts - 6, Math.floor(ts * 0.5));
        ctx.fillStyle = '#f8f4e8';
        ctx.fillRect(sx + 5, sy + 3, ts - 10, Math.floor(ts * 0.35));
      }
      return true;
    }

    // Fireplace — context-aware: spans 2 tiles wide as one hearth
    case FIREPLACE: {
      const fpFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, fpFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, fpFloor, sx, sy, ts, tx, ty);
      }

      const fpLeft = structure[ty]?.[tx - 1]?.type === FIREPLACE;
      const fpRight = structure[ty]?.[tx + 1]?.type === FIREPLACE;
      const isLeftHalf = !fpLeft && fpRight;
      const isRightHalf = fpLeft && !fpRight;

      const t = frameTime;

      // Stone surround — extend to neighbor edge
      const stoneL = isRightHalf ? 0 : 2;
      const stoneR = isLeftHalf ? 0 : 2;
      ctx.fillStyle = '#6b6b6b';
      ctx.fillRect(sx + stoneL, sy + 1, ts - stoneL - stoneR, ts - 2);
      // Inner cavity — seamless across both tiles
      const cavL = isRightHalf ? 0 : 5;
      const cavR = isLeftHalf ? 0 : 5;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx + cavL, sy + 4, ts - cavL - cavR, ts - 7);
      // Fire glow
      const glow = 0.3 + Math.sin(t * 4.2) * 0.15;
      ctx.fillStyle = `rgba(255, 120, 20, ${glow})`;
      ctx.fillRect(sx + cavL, sy + 4, ts - cavL - cavR, ts - 7);

      // Flames — left half gets left flames, right half gets right flames
      const flameBase = sy + ts - 3;
      const flameH = Math.floor((ts - 7) * (0.5 + Math.sin(t * 6.1) * 0.2));
      ctx.fillStyle = `rgba(255, 200, 50, ${0.7 + Math.sin(t * 8.3) * 0.2})`;
      if (isLeftHalf || (!fpLeft && !fpRight)) {
        // Left/center flame
        ctx.fillRect(sx + 8, flameBase - flameH, 3, flameH);
        ctx.fillRect(
          sx + Math.floor(ts * 0.65),
          flameBase - Math.floor(flameH * 0.7),
          2,
          Math.floor(flameH * 0.7),
        );
      }
      if (isRightHalf || (!fpLeft && !fpRight)) {
        // Right/center flame
        ctx.fillRect(sx + ts - 10, flameBase - flameH * 0.85, 3, Math.floor(flameH * 0.85));
        ctx.fillRect(
          sx + Math.floor(ts * 0.3),
          flameBase - Math.floor(flameH * 0.6),
          2,
          Math.floor(flameH * 0.6),
        );
      }
      // Embers
      ctx.fillStyle = `rgba(255, 80, 0, ${0.5 + Math.sin(t * 3.7) * 0.3})`;
      ctx.fillRect(sx + cavL + 2, flameBase - 2, ts - cavL - cavR - 4, 2);
      // Stone mortar lines
      ctx.fillStyle = '#555';
      ctx.fillRect(sx + stoneL, sy + Math.floor(ts * 0.35), ts - stoneL - stoneR, 1);
      ctx.fillRect(sx + stoneL, sy + Math.floor(ts * 0.65), ts - stoneL - stoneR, 1);
      // Pillar divider only on outer edges
      if (!fpLeft) ctx.fillRect(sx + 2, sy + 1, 1, ts - 2);
      if (!fpRight) ctx.fillRect(sx + ts - 3, sy + 1, 1, ts - 2);
      return true;
    }

    // Barrel — PNG sprite with transparent background
    case BARREL: {
      const barrelFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, barrelFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, barrelFloor, sx, sy, ts, tx, ty);
      }
      drawSpriteKey(ctx, 'barrel', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Rug — decorative woven rug (walkable)
    case RUG: {
      // Floor beneath first
      const rugFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, rugFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, rugFloor, sx, sy, ts, tx, ty);
      }

      // Rug base — check if neighbors are also rugs for seamless pattern
      const rugLeft = structure[ty]?.[tx - 1]?.type === RUG;
      const rugRight = structure[ty]?.[tx + 1]?.type === RUG;
      const rugUp = structure[ty - 1]?.[tx]?.type === RUG;
      const rugDown = structure[ty + 1]?.[tx]?.type === RUG;
      const insetX = rugLeft ? 0 : 2;
      const insetR = rugRight ? 0 : 2;
      const insetY = rugUp ? 0 : 2;
      const insetB = rugDown ? 0 : 2;
      // Rug body
      ctx.fillStyle = '#8b2e2e';
      ctx.fillRect(sx + insetX, sy + insetY, ts - insetX - insetR, ts - insetY - insetB);
      // Border trim
      ctx.fillStyle = '#c4943a';
      if (!rugUp) ctx.fillRect(sx + insetX, sy + insetY, ts - insetX - insetR, 2);
      if (!rugDown) ctx.fillRect(sx + insetX, sy + ts - insetB - 2, ts - insetX - insetR, 2);
      if (!rugLeft) ctx.fillRect(sx + insetX, sy + insetY, 2, ts - insetY - insetB);
      if (!rugRight) ctx.fillRect(sx + ts - insetR - 2, sy + insetY, 2, ts - insetY - insetB);
      // Center diamond pattern
      const midX = sx + ts / 2;
      const midY = sy + ts / 2;
      ctx.fillStyle = '#d4a040';
      ctx.beginPath();
      ctx.moveTo(midX, midY - 5);
      ctx.lineTo(midX + 5, midY);
      ctx.lineTo(midX, midY + 5);
      ctx.lineTo(midX - 5, midY);
      ctx.closePath();
      ctx.fill();
      return true;
    }

    // Chair — small wooden chair
    case CHAIR: {
      const chairFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, chairFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, chairFloor, sx, sy, ts, tx, ty);
      }

      const chInset = Math.floor(ts * 0.2);
      // Chair back (top portion)
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(sx + chInset, sy + 2, ts - chInset * 2, Math.floor(ts * 0.3));
      // Back slats
      ctx.fillStyle = '#7a5030';
      const slatW = Math.floor((ts - chInset * 2) / 3);
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(sx + chInset + i * slatW + 1, sy + 3, slatW - 2, Math.floor(ts * 0.25));
      }
      // Seat
      ctx.fillStyle = '#8B5E3C';
      const seatY = sy + Math.floor(ts * 0.35);
      ctx.fillRect(sx + chInset - 1, seatY, ts - chInset * 2 + 2, Math.floor(ts * 0.25));
      // Legs
      ctx.fillStyle = '#5a3a1a';
      const legTop = seatY + Math.floor(ts * 0.25);
      const legH = ts - (legTop - sy) - 2;
      ctx.fillRect(sx + chInset, legTop, 2, legH);
      ctx.fillRect(sx + ts - chInset - 2, legTop, 2, legH);
      return true;
    }

    // Sawdust floor — packed tan arena ground with speckled shavings
    case SAWDUST_FLOOR: {
      drawSawdustBase(ctx, sx, sy, ts, tx, ty);
      return true;
    }

    // Painted circus ring border — weathered red band over the sawdust
    case CIRCUS_RING_EDGE: {
      drawSawdustBase(ctx, sx, sy, ts, tx, ty);
      const bandInset = Math.floor(ts * RING_BAND_INSET_FRACTION);
      ctx.fillStyle = '#a83430';
      ctx.fillRect(sx, sy + bandInset, ts, ts - bandInset * 2);
      ctx.fillStyle = '#e8e2d4';
      ctx.fillRect(sx, sy + bandInset, ts, RING_STRIPE_HEIGHT);
      ctx.fillRect(sx, sy + ts - bandInset - RING_STRIPE_HEIGHT, ts, RING_STRIPE_HEIGHT);
      // Paint wear — sawdust-coloured chips scraped through the band
      const wearHash = (tx * 41 + ty * 29) % 97;
      ctx.fillStyle = '#c9a86a';
      for (let i = 0; i < RING_WEAR_CHIP_COUNT; i++) {
        const px = sx + ((wearHash * (i * 7 + 3)) % (ts - 3));
        const py = sy + bandInset + ((wearHash * (i * 5 + 2)) % (ts - bandInset * 2 - 2));
        ctx.fillRect(px, py, 2, 2);
      }
      return true;
    }

    // Central tent pole — thick timber column with rope wraps
    case TENT_POLE: {
      drawSawdustBase(ctx, sx, sy, ts, tx, ty);
      const poleInset = Math.floor(ts * POLE_INSET_FRACTION);
      ctx.fillStyle = '#4a3520';
      ctx.fillRect(sx + poleInset, sy, ts - poleInset * 2, ts);
      // Wood grain
      ctx.fillStyle = '#3a2915';
      ctx.fillRect(sx + poleInset + 2, sy, 1, ts);
      ctx.fillRect(sx + ts - poleInset - 4, sy, 1, ts);
      // Lit edge
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(sx + poleInset, sy, 2, ts);
      // Rope wraps
      ctx.strokeStyle = '#a8874e';
      ctx.lineWidth = 2;
      for (let i = 0; i < POLE_ROPE_WRAP_COUNT; i++) {
        const ry = sy + Math.floor(((i + 1) * ts) / (POLE_ROPE_WRAP_COUNT + 1));
        ctx.beginPath();
        ctx.moveTo(sx + poleInset, ry);
        ctx.lineTo(sx + ts - poleInset, ry - 2);
        ctx.stroke();
      }
      return true;
    }

    // Bleacher — stacked wooden bench planks facing the ring
    case BLEACHER: {
      ctx.fillStyle = '#2a2118';
      ctx.fillRect(sx, sy, ts, ts);
      const plankHeight = Math.floor(ts / BLEACHER_PLANK_COUNT);
      for (let i = 0; i < BLEACHER_PLANK_COUNT; i++) {
        const py = sy + i * plankHeight;
        ctx.fillStyle = i % 2 === 0 ? '#7a5a34' : '#6b4e2c';
        ctx.fillRect(sx, py + 1, ts, plankHeight - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(sx, py + 1, ts, 1);
      }
      // Support post shadow on alternating tiles
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(sx + Math.floor(ts / 2) - 1, sy, 2, ts);
      }
      return true;
    }

    default:
      return false;
  }
}

const RING_BAND_INSET_FRACTION = 0.25;
const RING_STRIPE_HEIGHT = 2;
const RING_WEAR_CHIP_COUNT = 3;
const POLE_INSET_FRACTION = 0.28;
const POLE_ROPE_WRAP_COUNT = 3;
const BLEACHER_PLANK_COUNT = 4;
const SAWDUST_SPECK_COUNT = 6;

/** Packed-sawdust ground shared by the big top floor, ring, and pole tiles. */
function drawSawdustBase(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  ctx.fillStyle = '#b8985e';
  ctx.fillRect(sx, sy, ts, ts);
  const h1 = (tx * 31 + ty * 17) % 97;
  const h2 = (tx * 53 + ty * 41) % 89;
  // Darker trodden patch
  ctx.fillStyle = 'rgba(138,111,66,0.35)';
  ctx.fillRect(sx + (h1 % (ts / 2)), sy + (h2 % (ts / 2)), Math.floor(ts / 2), Math.floor(ts / 2));
  // Shaving specks
  for (let i = 0; i < SAWDUST_SPECK_COUNT; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#d4b87c' : '#8a6f42';
    const px = sx + ((h1 * (i * 13 + 5)) % ts);
    const py = sy + ((h2 * (i * 7 + 3)) % ts);
    ctx.fillRect(px, py, 1, 1);
  }
}
