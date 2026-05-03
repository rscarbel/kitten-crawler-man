import type { TileContent } from '../tileTypes';
import {
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  BONES,
} from '../tileTypes';
import { inferFloorType } from './helpers';
import { drawTerrainTile } from './terrainTiles';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawSpriteKey, timeFrameIndex } from '../../core/SpriteRenderer';
import { frameTime } from '../../utils';

export function drawDecorationTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  baseOnly = false,
  tileTime?: number,
): boolean {
  if (baseOnly) {
    switch (type) {
      case TORCH:
      case WELL:
      case FOUNTAIN:
      case BRAZIER: {
        const floorType = inferFloorType(structure, tx, ty);
        if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
          drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
        }
        return true;
      }
      default:
        return false;
    }
  }
  switch (type) {
    case FOUNTAIN: {
      const nN = structure[ty - 1]?.[tx]?.type === FOUNTAIN;
      const nS = structure[ty + 1]?.[tx]?.type === FOUNTAIN;
      const nE = structure[ty]?.[tx + 1]?.type === FOUNTAIN;
      const nW = structure[ty]?.[tx - 1]?.type === FOUNTAIN;
      const isCenter = nN && nS && nE && nW;
      const fcx = sx + ts / 2;
      const fcy = sy + ts / 2;
      const t = tileTime ?? frameTime;

      if (isCenter) {
        // === WATER BASIN FLOOR ===
        ctx.fillStyle = '#0d4a73';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#155f8f';
        ctx.fillRect(sx + 2, sy + 2, ts - 4, ts - 4);

        // Animated water shimmer glints
        for (let i = 0; i < 3; i++) {
          const gx = sx + 5 + ((i * 9 + Math.sin(t * 1.3 + i * 2.0) * 5 + 10) % (ts - 10));
          const gy = sy + 6 + ((Math.cos(t * 1.1 + i * 1.6) * 4 + 5 + i * 6) % (ts - 12));
          const ga = 0.18 + Math.sin(t * 2.5 + i) * 0.1;
          ctx.fillStyle = `rgba(120,210,255,${ga})`;
          ctx.fillRect(Math.floor(gx), Math.floor(gy), 5, 2);
        }

        // Expanding ripple rings — 3 staggered, continuously cycling
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, ts, ts);
        ctx.clip();
        for (let i = 0; i < 3; i++) {
          const phase = (t * 1.4 + i * (1 / 3)) % 1;
          const rAlpha = (1 - phase) * 0.55;
          const rRadius = phase * ts * 0.44;
          if (rAlpha > 0.03) {
            ctx.strokeStyle = `rgba(160,230,255,${rAlpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(fcx, fcy, rRadius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();

        // === CENTRAL PEDESTAL ===
        const pedW = Math.floor(ts * 0.26);
        const pedH = Math.floor(ts * 0.38);
        const pedX = Math.floor(fcx - pedW / 2);
        const pedTop = Math.floor(fcy - pedH / 2);

        // Pedestal base slab (wider)
        ctx.fillStyle = '#7a7268';
        ctx.fillRect(
          Math.floor(fcx - pedW * 0.75),
          Math.floor(fcy + pedH * 0.28),
          Math.floor(pedW * 1.5),
          Math.floor(ts * 0.18),
        );
        ctx.fillStyle = '#a09888';
        ctx.fillRect(
          Math.floor(fcx - pedW * 0.75),
          Math.floor(fcy + pedH * 0.28),
          Math.floor(pedW * 1.5),
          3,
        );

        // Pedestal column
        ctx.fillStyle = '#948c82';
        ctx.fillRect(pedX, pedTop, pedW, pedH);
        // Left highlight, right shadow
        ctx.fillStyle = '#b0a898';
        ctx.fillRect(pedX, pedTop, 3, pedH);
        ctx.fillStyle = '#706860';
        ctx.fillRect(pedX + pedW - 3, pedTop, 3, pedH);

        // Pedestal capital (wide cap)
        const capY = pedTop - 6;
        ctx.fillStyle = '#7a7268';
        ctx.fillRect(Math.floor(fcx - pedW * 0.6), capY, Math.floor(pedW * 1.2), 8);
        ctx.fillStyle = '#b0a898';
        ctx.fillRect(Math.floor(fcx - pedW * 0.6), capY, Math.floor(pedW * 1.2), 2);

        // === VERTICAL WATER JET ===
        const jetPulse = Math.sin(t * 4.2) * 0.12;
        const jetH = Math.floor(ts * 1.1 + jetPulse * ts * 0.15);
        const jetTipY = capY - jetH;

        // Soft outer glow
        for (let g = 0; g < 3; g++) {
          const gw = 3 - g;
          const ga = 0.12 - g * 0.03;
          ctx.fillStyle = `rgba(120,200,255,${ga})`;
          ctx.fillRect(Math.floor(fcx - gw - 2), jetTipY, gw * 2 + 4, jetH);
        }
        // Core stream (white-blue, slightly tapering)
        ctx.fillStyle = `rgba(230,248,255,0.90)`;
        ctx.fillRect(Math.floor(fcx - 2), jetTipY + 4, 4, jetH - 4);
        // Bright tip
        ctx.fillStyle = `rgba(255,255,255,0.95)`;
        ctx.fillRect(Math.floor(fcx - 1), jetTipY, 3, 7);

        // === ARCING WATER STREAMS (4 directions) ===
        const numArcs = 4;
        const arcRadius = ts * 0.38;
        for (let i = 0; i < numArcs; i++) {
          const angle = (i / numArcs) * Math.PI * 2 + Math.PI * 0.25;
          // Bezier control point: outward and slightly up from jet tip
          const ctrlX = fcx + Math.cos(angle) * ts * 0.18;
          const ctrlY = jetTipY + Math.floor(ts * 0.1);
          const endX = fcx + Math.cos(angle) * arcRadius;
          const endY = fcy - 3;

          const numDrops = 9;
          for (let d = 0; d < numDrops; d++) {
            const dp = (d / numDrops + t * 1.0 + i * 0.28) % 1;
            // Quadratic bezier position
            const bx = (1 - dp) * (1 - dp) * fcx + 2 * (1 - dp) * dp * ctrlX + dp * dp * endX;
            const by = (1 - dp) * (1 - dp) * jetTipY + 2 * (1 - dp) * dp * ctrlY + dp * dp * endY;
            const dAlpha = 0.5 + dp * 0.4;
            const dSize = Math.ceil(1 + dp * 1.8);
            ctx.fillStyle = `rgba(190,238,255,${dAlpha})`;
            ctx.fillRect(Math.floor(bx - dSize / 2), Math.floor(by), dSize, dSize);
          }
        }

        // === SPLASH at arc landing points ===
        for (let i = 0; i < numArcs; i++) {
          const angle = (i / numArcs) * Math.PI * 2 + Math.PI * 0.25;
          const lx = fcx + Math.cos(angle) * arcRadius;
          const ly = fcy - 3;
          const sp = (t * 1.0 + i * 0.28 + 0.85) % 1;
          const sa = sp < 0.25 ? (sp / 0.25) * 0.6 : ((1 - sp) / 0.75) * 0.5;
          if (sa > 0.05) {
            ctx.fillStyle = `rgba(210,245,255,${sa})`;
            ctx.beginPath();
            ctx.arc(lx, ly, 1.5 + sp * 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        // === STONE BASIN RIM ===
        // Outer stone face
        ctx.fillStyle = '#8a8272';
        ctx.fillRect(sx, sy, ts, ts);

        // Top and left highlights (lit face)
        ctx.fillStyle = '#b0a890';
        ctx.fillRect(sx, sy, ts, 4);
        ctx.fillStyle = '#a09880';
        ctx.fillRect(sx, sy, 3, ts);
        // Bottom and right shadow
        ctx.fillStyle = '#686058';
        ctx.fillRect(sx, sy + ts - 3, ts, 3);
        ctx.fillRect(sx + ts - 3, sy, 3, ts);

        // Stone block mortar seam lines
        ctx.fillStyle = '#706860';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.5), ts, 1);
        const bOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillRect(sx + (bOff % ts), sy, 1, Math.floor(ts * 0.5));
        ctx.fillRect(
          sx + ((bOff + Math.floor(ts * 0.5)) % ts),
          sy + Math.floor(ts * 0.5) + 1,
          1,
          ts - Math.floor(ts * 0.5) - 1,
        );

        // Inner basin faces — show stone depth + water behind
        const innerD = 8;
        if (nS) {
          // North rim tile: inner face on south side
          ctx.fillStyle = '#506878';
          ctx.fillRect(sx, sy + ts - innerD, ts, innerD);
          ctx.fillStyle = '#1a5f8a';
          ctx.fillRect(sx, sy + ts - 3, ts, 3); // water surface glimpse
          ctx.fillStyle = '#3a3228';
          ctx.fillRect(sx, sy + ts - innerD, ts, 2); // rim top shadow
        }
        if (nN) {
          // South rim tile: inner face on north side
          ctx.fillStyle = '#506878';
          ctx.fillRect(sx, sy, ts, innerD);
          ctx.fillStyle = '#1a5f8a';
          ctx.fillRect(sx, sy, ts, 3);
          ctx.fillStyle = '#3a3228';
          ctx.fillRect(sx, sy + innerD - 2, ts, 2);
        }
        if (nE) {
          // West rim tile: inner face on east side
          ctx.fillStyle = '#506878';
          ctx.fillRect(sx + ts - innerD, sy, innerD, ts);
          ctx.fillStyle = '#1a5f8a';
          ctx.fillRect(sx + ts - 3, sy, 3, ts);
          ctx.fillStyle = '#3a3228';
          ctx.fillRect(sx + ts - innerD, sy, 2, ts);
        }
        if (nW) {
          // East rim tile: inner face on west side
          ctx.fillStyle = '#506878';
          ctx.fillRect(sx, sy, innerD, ts);
          ctx.fillStyle = '#1a5f8a';
          ctx.fillRect(sx, sy, 3, ts);
          ctx.fillStyle = '#3a3228';
          ctx.fillRect(sx + innerD - 2, sy, 2, ts);
        }

        // Corner ornament: stone column posts at outer corners
        const neighborCount = [nN, nS, nE, nW].filter(Boolean).length;
        if (neighborCount <= 2) {
          // Post body
          ctx.fillStyle = '#7a7268';
          ctx.beginPath();
          ctx.arc(fcx, fcy, ts * 0.3, 0, Math.PI * 2);
          ctx.fill();
          // Post cap ring
          ctx.strokeStyle = '#585048';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(fcx, fcy, ts * 0.27, 0, Math.PI * 2);
          ctx.stroke();
          // Post highlight
          ctx.fillStyle = '#c0b8a8';
          ctx.beginPath();
          ctx.arc(fcx - ts * 0.08, fcy - ts * 0.08, ts * 0.11, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return true;
    }

    // Torch — animated PNG sprite with transparent background
    case TORCH: {
      drawSpriteKey(ctx, 'torch', 'flicker', timeFrameIndex(frameTime, 8, 6), sx, sy, ts);
      return true;
    }

    // Well — PNG sprite with transparent background
    case WELL: {
      drawSpriteKey(ctx, 'well', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Brazier — animated iron fire brazier, extends above tile
    case BRAZIER: {
      drawSpriteKey(ctx, 'brazier', 'flicker', timeFrameIndex(frameTime, 10, 4), sx, sy, ts);
      return true;
    }

    // Barrel on its side — PNG sprite, draw floor first
    case BARREL_SIDE: {
      const barrelSideFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, barrelSideFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, barrelSideFloor, sx, sy, ts, tx, ty);
      }
      drawSpriteKey(ctx, 'barrel_side', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Wooden crate — PNG sprite, draw floor first
    case CRATE: {
      const crateFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, crateFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, crateFloor, sx, sy, ts, tx, ty);
      }
      drawSpriteKey(ctx, 'crate', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Bones pile — walkable, procedural scattered bones drawn over floor
    case BONES: {
      const bonesFloor = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, bonesFloor, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, bonesFloor, sx, sy, ts, tx, ty);
      }
      // Deterministic layout per tile position
      const bh1 = (tx * 37 + ty * 23) % 97;
      const bh2 = (tx * 61 + ty * 47) % 89;
      // Long bone 1 (femur/tibia shape — rounded ends, shaft)
      const b1x = sx + 5 + (bh1 % (ts - 22));
      const b1y = sy + 8 + (bh2 % (ts - 20));
      const b1a = (bh1 % 6) * 0.5;
      ctx.save();
      ctx.translate(b1x + 9, b1y + 4);
      ctx.rotate(b1a);
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(-9, -2, 18, 4); // shaft
      ctx.beginPath();
      ctx.arc(-9, 0, 4, 0, Math.PI * 2);
      ctx.fill(); // knob left
      ctx.beginPath();
      ctx.arc(9, 0, 3.5, 0, Math.PI * 2);
      ctx.fill(); // knob right
      ctx.fillStyle = '#c0b8a0';
      ctx.fillRect(-8, -1, 16, 1); // highlight
      ctx.restore();
      // Long bone 2 (rotated opposite)
      const b2x = sx + 8 + (bh2 % (ts - 24));
      const b2y = sy + 12 + (bh1 % (ts - 24));
      const b2a = b1a + 1.1;
      ctx.save();
      ctx.translate(b2x + 8, b2y + 3);
      ctx.rotate(b2a);
      ctx.fillStyle = '#ccc4a8';
      ctx.fillRect(-7, -2, 14, 3);
      ctx.beginPath();
      ctx.arc(-7, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Small bone fragment / rib shard
      const b3x = sx + 10 + (bh1 % (ts - 20));
      const b3y = sy + 6 + (bh2 % (ts - 18));
      ctx.save();
      ctx.translate(b3x, b3y);
      ctx.rotate(bh2 * 0.15);
      ctx.fillStyle = '#e0d8c0';
      ctx.fillRect(0, -1, 10, 2);
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(10, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    }

    // Grassy weed — walkable grass tile with decorative tufts and occasional flowers
    case GRASSY_WEED: {
      // Same bright grass base
      ctx.fillStyle = '#6de89d';
      ctx.fillRect(sx, sy, ts, ts);

      // Deterministic hash from tile position
      const h1 = (tx * 31 + ty * 17) % 97;
      const h2 = (tx * 53 + ty * 41) % 89;

      // First grass tuft
      const t1x = sx + 3 + ((h1 * 7) % (ts - 12));
      const t1y = sy + 5 + ((h1 * 11) % (ts - 14));
      ctx.fillStyle = '#3aac6a';
      ctx.fillRect(t1x, t1y, 2, 7); // central blade
      ctx.fillRect(t1x - 3, t1y + 3, 2, 5); // left blade (angled out)
      ctx.fillRect(t1x + 3, t1y + 3, 2, 5); // right blade

      // Second smaller tuft
      const t2x = sx + 5 + ((h2 * 13) % (ts - 14));
      const t2y = sy + 4 + ((h2 * 7) % (ts - 14));
      ctx.fillStyle = '#32986e';
      ctx.fillRect(t2x, t2y, 2, 5);
      ctx.fillRect(t2x - 2, t2y + 2, 2, 3);
      ctx.fillRect(t2x + 2, t2y + 2, 2, 3);

      // Occasional small flower (about 1 in 9 tiles)
      if ((tx * 7 + ty * 13) % 9 === 0) {
        const fx = sx + 4 + (h1 % (ts - 10));
        const fy = sy + 4 + (h2 % (ts - 12));
        // Petals
        ctx.fillStyle = '#f0e040';
        ctx.beginPath();
        ctx.arc(fx, fy, 3, 0, Math.PI * 2);
        ctx.fill();
        // Centre
        ctx.fillStyle = '#e06010';
        ctx.beginPath();
        ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Alternate: small purple wildflower
      if ((tx * 11 + ty * 7) % 13 === 0) {
        const fx = sx + 6 + (h2 % (ts - 14));
        const fy = sy + 5 + (h1 % (ts - 13));
        ctx.fillStyle = '#c060d8';
        ctx.beginPath();
        ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0d000';
        ctx.beginPath();
        ctx.arc(fx, fy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    }

    // Dirt patch — walkable road tile with pebble and soil texture
    case DIRT_PATCH: {
      // Same road base
      ctx.fillStyle = '#bc926b';
      ctx.fillRect(sx, sy, ts, ts);

      // Deterministic hash from tile position
      const h1 = (tx * 29 + ty * 19) % 97;
      const h2 = (tx * 43 + ty * 37) % 89;

      // Darker soil blotch
      ctx.fillStyle = 'rgba(70,38,8,0.28)';
      ctx.beginPath();
      ctx.ellipse(
        sx + 5 + ((h1 * 7) % (ts - 12)),
        sy + 5 + ((h1 * 11) % (ts - 12)),
        5 + (h1 % 5),
        3 + (h1 % 4),
        (h1 % 5) * 0.3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      // Second smaller blotch
      if (h2 % 3 !== 0) {
        ctx.fillStyle = 'rgba(60,30,5,0.18)';
        ctx.beginPath();
        ctx.ellipse(
          sx + 8 + ((h2 * 11) % (ts - 16)),
          sy + 7 + ((h2 * 7) % (ts - 16)),
          3 + (h2 % 3),
          2 + (h2 % 2),
          (h2 % 4) * 0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Small pebbles
      ctx.fillStyle = '#8a6030';
      for (let i = 0; i < 3; i++) {
        const px = sx + 4 + ((h1 * (i * 7 + 3)) % (ts - 8));
        const py = sy + 4 + ((h2 * (i * 5 + 11)) % (ts - 8));
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Lighter pebble highlight
      ctx.fillStyle = '#c8a070';
      for (let i = 0; i < 2; i++) {
        const px = sx + 6 + ((h2 * (i * 9 + 5)) % (ts - 12));
        const py = sy + 6 + ((h1 * (i * 7 + 3)) % (ts - 12));
        ctx.beginPath();
        ctx.arc(px, py, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Occasional crack/groove line
      if ((tx * 13 + ty * 11) % 7 === 0) {
        ctx.fillStyle = 'rgba(55,28,5,0.32)';
        const crx = sx + 5 + (h1 % (ts - 14));
        const cry = sy + 5 + (h2 % (ts - 14));
        ctx.fillRect(crx, cry, 1, 5 + (h1 % 6));
        ctx.fillRect(crx, cry, 4 + (h2 % 5), 1);
      }
      return true;
    }

    default:
      return false;
  }
}
