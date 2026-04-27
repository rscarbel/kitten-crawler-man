import type { TileContent } from '../tileTypes';
import { FOUNTAIN, TORCH, WELL, GRASSY_WEED, DIRT_PATCH } from '../tileTypes';
import { inferGroundColor } from './helpers';
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
): boolean {
  if (baseOnly) {
    switch (type) {
      case TORCH:
      case WELL:
      case FOUNTAIN:
        ctx.fillStyle = inferGroundColor(structure, tx, ty);
        ctx.fillRect(sx, sy, ts, ts);
        return true;
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
      const t = frameTime;

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

    // Torch — animated flame, pole not walkable
    case TORCH: {
      const t = frameTime;
      const flicker = Math.sin(t * 11.3) * 0.6 + Math.sin(t * 7.1) * 0.4;

      // Ground base — colour matches surrounding floor (road, cobblestone, or grass)
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);

      // Stone footing at pole base (bottom-centre)
      const footX = sx + Math.floor(ts / 2) - 4;
      const footY = sy + Math.floor(ts * 0.72);
      ctx.fillStyle = '#909090';
      ctx.fillRect(footX, footY, 8, Math.floor(ts * 0.2));
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(footX, footY, 8, 2);

      // Pole (dark iron)
      const poleX = sx + Math.floor(ts / 2) - 1;
      ctx.fillStyle = '#2e2e2e';
      ctx.fillRect(poleX, sy + Math.floor(ts * 0.22), 3, Math.floor(ts * 0.55));
      // Pole sheen
      ctx.fillStyle = '#484848';
      ctx.fillRect(poleX, sy + Math.floor(ts * 0.22), 1, Math.floor(ts * 0.55));

      // Torch head bracket
      const headY = sy + Math.floor(ts * 0.18);
      ctx.fillStyle = '#3a3020';
      ctx.fillRect(sx + Math.floor(ts / 2) - 4, headY, 9, 5);
      ctx.fillStyle = '#4e4030';
      ctx.fillRect(sx + Math.floor(ts / 2) - 4, headY, 9, 2);

      // Outer warm glow (radial gradient drawn as concentric filled arcs)
      const glowX = sx + Math.floor(ts / 2);
      const glowY = sy + Math.floor(ts * 0.12);
      const glowR = ts * 0.34 + flicker * ts * 0.04;
      ctx.fillStyle = `rgba(255,140,20,${0.18 + flicker * 0.05})`;
      ctx.beginPath();
      ctx.arc(glowX, glowY, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,180,40,${0.22 + flicker * 0.06})`;
      ctx.beginPath();
      ctx.arc(glowX, glowY, glowR * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Flame body (animated oval)
      const flameH = ts * 0.22 + flicker * ts * 0.04;
      const flameW = ts * 0.14 + flicker * ts * 0.02;
      ctx.fillStyle = `rgba(255,110,10,${0.9 + flicker * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(glowX, glowY, flameW, flameH, 0, 0, Math.PI * 2);
      ctx.fill();
      // Flame mid layer
      ctx.fillStyle = `rgba(255,200,40,${0.85 + flicker * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(glowX, glowY + flameH * 0.08, flameW * 0.55, flameH * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Flame hot core
      ctx.fillStyle = `rgba(255,255,200,${0.8 + flicker * 0.15})`;
      ctx.beginPath();
      ctx.arc(glowX, glowY + flameH * 0.1, flameW * 0.28, 0, Math.PI * 2);
      ctx.fill();

      // Smoke wisps rising above the tile
      const smokeBaseY = glowY - flameH - 2;
      ctx.fillStyle = `rgba(180,180,180,${0.28 + Math.sin(t * 4.1) * 0.08})`;
      ctx.beginPath();
      ctx.arc(glowX + Math.sin(t * 2.2) * 2, smokeBaseY - ts * 0.05, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(150,150,150,${0.15 + Math.sin(t * 3.3) * 0.05})`;
      ctx.beginPath();
      ctx.arc(glowX + Math.sin(t * 2.9) * 3, smokeBaseY - ts * 0.15, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(120,120,120,0.08)`;
      ctx.beginPath();
      ctx.arc(glowX + Math.sin(t * 2.0) * 4, smokeBaseY - ts * 0.26, 4.5, 0, Math.PI * 2);
      ctx.fill();
      return true;
    }

    // Well — stone well with wooden crossbeam, not walkable
    case WELL: {
      // Ground base — colour matches surrounding floor
      ctx.fillStyle = inferGroundColor(structure, tx, ty);
      ctx.fillRect(sx, sy, ts, ts);

      const wcx = sx + Math.floor(ts / 2);
      const wcy = sy + Math.floor(ts * 0.55);
      const outerR = Math.floor(ts * 0.4);
      const innerR = Math.floor(ts * 0.27);

      // Stone ring — outer (shadow side)
      ctx.fillStyle = '#6e6e6e';
      ctx.beginPath();
      ctx.arc(wcx + 2, wcy + 2, outerR, 0, Math.PI * 2);
      ctx.fill();
      // Stone ring — main
      ctx.fillStyle = '#909090';
      ctx.beginPath();
      ctx.arc(wcx, wcy, outerR, 0, Math.PI * 2);
      ctx.fill();
      // Stone ring — lit top arc
      ctx.fillStyle = '#b8b8b8';
      ctx.beginPath();
      ctx.arc(wcx, wcy, outerR, Math.PI * 1.1, Math.PI * 1.9);
      ctx.fill();
      ctx.fillStyle = '#909090'; // restore over the arc interior
      ctx.beginPath();
      ctx.arc(wcx, wcy, outerR - 3, Math.PI * 1.1, Math.PI * 1.9);
      ctx.fill();
      // Stone ring mortar lines (short radial dashes)
      ctx.fillStyle = '#707070';
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const r0 = outerR - 2;
        const r1 = outerR - 6;
        const ax = Math.cos(angle);
        const ay = Math.sin(angle);
        ctx.fillRect(
          wcx + ax * r1 - 0.5,
          wcy + ay * r1 - 0.5,
          Math.abs(ax) * (r0 - r1) + 1,
          Math.abs(ay) * (r0 - r1) + 1,
        );
      }

      // Deep well interior
      ctx.fillStyle = '#111828';
      ctx.beginPath();
      ctx.arc(wcx, wcy, innerR, 0, Math.PI * 2);
      ctx.fill();
      // Hint of water far below
      ctx.fillStyle = '#1a3a52';
      ctx.beginPath();
      ctx.arc(wcx, wcy + innerR * 0.5, innerR * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Wooden support posts (left and right)
      const postW = 4;
      const postH = Math.floor(ts * 0.44);
      const postTop = sy + Math.floor(ts * 0.08);
      ctx.fillStyle = '#4a2e10';
      ctx.fillRect(wcx - outerR - postW + 2, postTop, postW, postH);
      ctx.fillRect(wcx + outerR - 2, postTop, postW, postH);
      // Post highlights
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(wcx - outerR - postW + 2, postTop, 1, postH);
      ctx.fillRect(wcx + outerR - 2, postTop, 1, postH);

      // Horizontal crossbeam
      const beamY = postTop;
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(wcx - outerR - postW + 2, beamY, outerR * 2 + postW * 2 - 4, 5);
      ctx.fillStyle = '#7a5030';
      ctx.fillRect(wcx - outerR - postW + 2, beamY, outerR * 2 + postW * 2 - 4, 2);

      // Rope
      ctx.fillStyle = '#c8a050';
      ctx.fillRect(wcx - 1, beamY + 5, 2, innerR * 0.9);
      // Tiny bucket at rope bottom
      ctx.fillStyle = '#7a6040';
      ctx.fillRect(wcx - 3, beamY + 5 + innerR * 0.9 - 1, 6, 4);
      ctx.fillStyle = '#9a8060';
      ctx.fillRect(wcx - 3, beamY + 5 + innerR * 0.9 - 1, 6, 1);
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
