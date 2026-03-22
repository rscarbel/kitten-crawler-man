import {
  TileContent,
  STAIRS_UP,
  STAIRS_DOWN,
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  RUG,
  CHAIR,
} from '../tileTypes';
import { inferGroundColor, drawWallShadow } from './helpers';

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
      const stairPulse = 0.5 + Math.sin(performance.now() / 600) * 0.3;
      ctx.strokeStyle = `rgba(220, 170, 50, ${stairPulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, ts - 2, ts - 2);

      // Directional arrow
      ctx.fillStyle = `rgba(255, 230, 140, ${stairPulse + 0.2})`;
      ctx.font = `bold ${Math.floor(ts * 0.5)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(isUp ? '\u25B2' : '\u25BC', sx + ts / 2, sy + ts * 0.65);
      ctx.textAlign = 'left';
      return true;
    }

    // Table — context-aware: seamless horizontal surface across adjacent TABLE tiles
    case TABLE: {
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

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
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

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
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

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
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

      const fpLeft = structure[ty]?.[tx - 1]?.type === FIREPLACE;
      const fpRight = structure[ty]?.[tx + 1]?.type === FIREPLACE;
      const isLeftHalf = !fpLeft && fpRight;
      const isRightHalf = fpLeft && !fpRight;

      const t = performance.now() / 1000;

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

    // Barrel — wooden barrel with metal bands
    case BARREL: {
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

      const cx2 = sx + ts / 2;
      const cy2 = sy + ts / 2;
      const rw = Math.floor(ts * 0.38);
      const rh = Math.floor(ts * 0.42);
      // Barrel body (oval)
      ctx.fillStyle = '#8B5E3C';
      ctx.beginPath();
      ctx.ellipse(cx2, cy2, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      // Plank lines
      ctx.strokeStyle = '#7a5030';
      ctx.lineWidth = 1;
      for (let dx = -rw + 4; dx < rw; dx += 5) {
        ctx.beginPath();
        ctx.moveTo(cx2 + dx, cy2 - rh + 2);
        ctx.lineTo(cx2 + dx, cy2 + rh - 2);
        ctx.stroke();
      }
      // Metal bands
      ctx.strokeStyle = '#8a8a8a';
      ctx.lineWidth = 2;
      for (const bandOff of [-0.3, 0, 0.3]) {
        ctx.beginPath();
        const bandY = cy2 + bandOff * rh;
        ctx.ellipse(cx2, bandY, rw + 1, 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Top rim highlight
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(cx2, cy2 - rh + 1, rw - 1, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      return true;
    }

    // Rug — decorative woven rug (walkable)
    case RUG: {
      // Floor beneath first
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

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
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);

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

    default:
      return false;
  }
}
