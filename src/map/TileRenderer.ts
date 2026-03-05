import {
  FloorTypeValue,
  TileContent,
  VOID_TYPE,
  SAFE_ROOM_FLOOR,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
  TREE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
} from './tileTypes';

/**
 * Infers the ground base colour for a decoration tile (TORCH, WELL, etc.) by
 * examining cardinal neighbours. Priority: road > safe-room cobblestone > grass.
 */
function inferGroundColor(
  structure: TileContent[][],
  tx: number,
  ty: number,
): string {
  const dirs: [number, number][] = [
    [0, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
  ];
  let hasRoad = false;
  let hasSafe = false;
  for (const [dx, dy] of dirs) {
    const n = structure[ty + dy]?.[tx + dx];
    if (!n) continue;
    if (n.type === FloorTypeValue.road || n.type === DIRT_PATCH) hasRoad = true;
    else if (n.type === SAFE_ROOM_FLOOR) hasSafe = true;
  }
  if (hasRoad) return '#bc926b';
  if (hasSafe) return (tx + ty) % 2 === 0 ? '#f0e4c8' : '#e8d8b8';
  return '#6de89d';
}

/** Draws a shadow strip on floor tiles directly below or right of a wall/building/tree. */
function drawWallShadow(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
) {
  const SHADOW_TYPES = new Set([
    FloorTypeValue.wall,
    BUILDING_WALL,
    TREE,
    ROOF_THATCH,
    ROOF_SLATE,
    ROOF_RED,
    ROOF_GREEN,
    FOUNTAIN,
    TORCH,
    WELL,
  ]);
  const above = structure[ty - 1]?.[tx];
  if (above && SHADOW_TYPES.has(above.type)) {
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(sx, sy, ts, 8);
  }
  const left = structure[ty]?.[tx - 1];
  if (left && SHADOW_TYPES.has(left.type)) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(sx, sy, 6, ts);
  }
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  baseOnly = false,
) {
  // In the first (ground) pass, decorations that extend above tile bounds only
  // draw their base fill so entities rendered between passes appear behind them.
  if (baseOnly) {
    switch (type) {
      case TORCH:
      case WELL:
      case FOUNTAIN:
        ctx.fillStyle = inferGroundColor(structure, tx, ty);
        ctx.fillRect(sx, sy, ts, ts);
        return;
      case TREE:
        ctx.fillStyle = '#5cc87a';
        ctx.fillRect(sx, sy, ts, ts);
        return;
    }
  }
  switch (type) {
    // Void (outer border)
    case VOID_TYPE: {
      ctx.fillStyle = '#000000';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }

    // Outdoors
    case FloorTypeValue.grass: {
      ctx.fillStyle = '#6de89d';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }
    case FloorTypeValue.road: {
      ctx.fillStyle = '#bc926b';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }
    case FloorTypeValue.water: {
      ctx.fillStyle = '#2ac6ff';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }

    // Dungeon wall
    case FloorTypeValue.wall: {
      // Dark brick/concrete base
      ctx.fillStyle = '#2e2420';
      ctx.fillRect(sx, sy, ts, ts);
      // Lit top face — simulates overhead light catching the wall top
      ctx.fillStyle = '#4e3e34';
      ctx.fillRect(sx, sy, ts, 3);
      // Subtle left edge highlight
      ctx.fillStyle = '#3c3028';
      ctx.fillRect(sx, sy, 2, ts);
      // Horizontal mortar seam in the middle
      ctx.fillStyle = '#1c1814';
      ctx.fillRect(sx, sy + Math.floor(ts / 2), ts, 1);
      // Staggered vertical mortar (brick bond pattern)
      const brickOff = ty % 2 === 0 ? 0 : Math.floor(ts / 2);
      const vx = sx + (brickOff % ts);
      if (vx >= sx && vx < sx + ts) {
        ctx.fillRect(vx, sy + 3, 1, Math.floor(ts / 2) - 3);
      }
      break;
    }

    // Dungeon floors

    // Poured concrete — hallways, utility rooms
    case FloorTypeValue.concrete: {
      const shade = (tx + ty) % 2 === 0 ? '#b4b0ab' : '#aaa7a2';
      ctx.fillStyle = shade;
      ctx.fillRect(sx, sy, ts, ts);
      // Expansion-joint seams every 2 tiles
      ctx.fillStyle = '#909088';
      if (tx % 2 === 0) ctx.fillRect(sx, sy, 1, ts);
      if (ty % 2 === 0) ctx.fillRect(sx, sy, ts, 1);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Ceramic tile — offices, bathrooms
    case FloorTypeValue.tile_floor: {
      const even = (tx + ty) % 2 === 0;
      ctx.fillStyle = even ? '#d8d0b8' : '#cac2aa';
      ctx.fillRect(sx, sy, ts, ts);
      // Grout lines
      ctx.fillStyle = '#9c9078';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Carpet — conference rooms, executive offices
    case FloorTypeValue.carpet: {
      const even = (tx + ty) % 2 === 0;
      ctx.fillStyle = even ? '#6e2418' : '#7a2c1e';
      ctx.fillRect(sx, sy, ts, ts);
      // Weave texture: thin cross-lines
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(sx, sy, 1, ts);
      ctx.fillRect(sx, sy, ts, 1);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Safe Room floor — warm sanctuary
    case SAFE_ROOM_FLOOR: {
      // Alternating warm cream tiles
      const safeBase = (tx + ty) % 2 === 0 ? '#f0e4c8' : '#e8d8b8';
      ctx.fillStyle = safeBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Soft golden grout lines
      ctx.fillStyle = '#c8b890';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Subtle warm glow dot at tile corners
      if (tx % 4 === 0 && ty % 4 === 0) {
        ctx.fillStyle = 'rgba(255,200,80,0.25)';
        ctx.beginPath();
        ctx.arc(sx, sy, ts * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Boss Room floor — grimy, trash-covered
    case HORDER_BOSS_ROOM_FLOOR: {
      // Dark yellowish-brown base with alternating grime variation
      const bossBase = (tx + ty) % 2 === 0 ? '#2e2010' : '#281c0c';
      ctx.fillStyle = bossBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Dark cracked grout lines
      ctx.fillStyle = '#1a1208';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Puke/grime stain blotches scattered across floor
      if ((tx * 3 + ty * 7) % 5 === 0) {
        ctx.fillStyle = 'rgba(120,140,20,0.28)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.4,
          sy + ts * 0.5,
          ts * 0.35,
          ts * 0.22,
          0.8,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if ((tx * 5 + ty * 3) % 7 === 0) {
        ctx.fillStyle = 'rgba(80,60,10,0.35)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.65,
          sy + ts * 0.35,
          ts * 0.2,
          ts * 0.14,
          -0.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Juicer Gym floor — dark rubber mat
    case JUICER_BOSS_ROOM_FLOOR: {
      // Very dark grey rubber base
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx, sy, ts, ts);
      // Subtle grid lines every tile
      ctx.fillStyle = '#222';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Rubber texture dots (deterministic pattern)
      if ((tx + ty) % 3 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.arc(sx + ts * 0.5, sy + ts * 0.5, ts * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      // Orange gym line markings every 4 tiles
      if (tx % 4 === 0) {
        ctx.fillStyle = 'rgba(249,115,22,0.18)';
        ctx.fillRect(sx, sy, 2, ts);
      }
      if (ty % 4 === 0) {
        ctx.fillStyle = 'rgba(249,115,22,0.18)';
        ctx.fillRect(sx, sy, ts, 2);
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Hardwood — break rooms, reception
    case FloorTypeValue.wood: {
      const plankGroup = Math.floor(ty / 2) % 3;
      const plankColors = ['#9e6e3a', '#8e6030', '#aa7840'] as const;
      ctx.fillStyle = plankColors[plankGroup];
      ctx.fillRect(sx, sy, ts, ts);
      // Left plank seam
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(sx, sy, 1, ts);
      // Horizontal wood grain
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      for (let g = 6; g < ts; g += 7) {
        ctx.fillRect(sx + 1, sy + g, ts - 1, 1);
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Outdoor tree — brown trunk, layered green canopy
    case TREE: {
      // Grass base underneath
      ctx.fillStyle = '#5cc87a';
      ctx.fillRect(sx, sy, ts, ts);
      // Trunk
      const trunkW = Math.max(3, Math.floor(ts * 0.16));
      const trunkH = Math.floor(ts * 0.32);
      const trunkX = sx + Math.floor((ts - trunkW) / 2);
      const trunkY = sy + ts - trunkH;
      ctx.fillStyle = '#5c3a1e';
      ctx.fillRect(trunkX, trunkY, trunkW, trunkH);
      // Dark green canopy shadow layer
      const cr = Math.floor(ts * 0.38);
      const ccx = sx + Math.floor(ts / 2);
      const ccy = sy + Math.floor(ts * 0.44);
      ctx.fillStyle = '#1e4d1e';
      ctx.beginPath();
      ctx.arc(ccx + 2, ccy + 2, cr, 0, Math.PI * 2);
      ctx.fill();
      // Main canopy
      ctx.fillStyle = '#2d6a2d';
      ctx.beginPath();
      ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = '#3d8b3d';
      ctx.beginPath();
      ctx.arc(
        ccx - Math.floor(cr * 0.35),
        ccy - Math.floor(cr * 0.3),
        Math.floor(cr * 0.45),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    }

    // Overworld building wall — context-aware facade rendering
    case BUILDING_WALL: {
      // Check if adjacent tiles are roof (interior) to determine wall facing
      const isRoof = (nx: number, ny: number) => {
        const t = structure[ny]?.[nx]?.type;
        return (
          t === ROOF_THATCH ||
          t === ROOF_SLATE ||
          t === ROOF_RED ||
          t === ROOF_GREEN
        );
      };
      const intN = isRoof(tx, ty - 1); // interior to north → this is the south-facing wall
      const intS = isRoof(tx, ty + 1); // interior to south → north-facing wall
      const intE = isRoof(tx + 1, ty); // interior to east → west-facing wall
      const intW = isRoof(tx - 1, ty); // interior to west → east-facing wall

      if (intN) {
        // South-facing wall — visible facade, lightest
        ctx.fillStyle = '#c0ae98';
        ctx.fillRect(sx, sy, ts, ts);
        // Horizontal mortar courses (staggered brick bond)
        ctx.fillStyle = '#8a7a68';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.35), ts, 2);
        ctx.fillRect(sx, sy + Math.floor(ts * 0.68), ts, 2);
        const bOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillStyle = '#9a8878';
        ctx.fillRect(
          sx + ((Math.floor(ts * 0.5) + bOff) % ts),
          sy,
          1,
          Math.floor(ts * 0.35),
        );
        ctx.fillRect(
          sx + (bOff % ts),
          sy + Math.floor(ts * 0.35) + 2,
          1,
          Math.floor(ts * 0.33) - 2,
        );
        // Window on non-corner tiles (both E and W neighbors are also walls)
        const wallE = structure[ty]?.[tx + 1]?.type === BUILDING_WALL;
        const wallW = structure[ty]?.[tx - 1]?.type === BUILDING_WALL;
        if (wallE && wallW && tx % 2 === 0) {
          const ww = Math.floor(ts * 0.5);
          const wh = Math.floor(ts * 0.38);
          const wx = sx + Math.floor((ts - ww) / 2);
          const wy = sy + Math.floor((ts - wh) / 2) - 2;
          ctx.fillStyle = '#2a3a50'; // dark frame
          ctx.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
          ctx.fillStyle = '#b0cce0'; // glass pane
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = '#6a8aa0'; // pane divider
          ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
          ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
        }
        // Lit top edge
        ctx.fillStyle = '#d4c2ac';
        ctx.fillRect(sx, sy, ts, 2);
      } else if (intS) {
        // North-facing wall — dark, shadowed
        ctx.fillStyle = '#6a5e52';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#5a4e42';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.5), ts, 1);
        ctx.fillStyle = '#7a6e62';
        ctx.fillRect(sx, sy, ts, 2);
      } else if (intE || intW) {
        // East or west-facing side wall
        ctx.fillStyle = '#9a8e82';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#7a6e60';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.35), ts, 1);
        ctx.fillRect(sx, sy + Math.floor(ts * 0.68), ts, 1);
        ctx.fillStyle = '#aea298';
        ctx.fillRect(sx, sy, ts, 2);
      } else {
        // Corner or isolated wall — general stone
        ctx.fillStyle = '#8a7e72';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#7a6e62';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.35), ts, 1);
        ctx.fillRect(sx, sy + Math.floor(ts * 0.68), ts, 1);
        ctx.fillStyle = '#9a8e82';
        ctx.fillRect(sx, sy, ts, 2);
      }
      break;
    }

    // Thatched roof — warm straw/golden cottage
    case ROOF_THATCH: {
      ctx.fillStyle = '#c89840';
      ctx.fillRect(sx, sy, ts, ts);
      // Horizontal straw bands
      ctx.fillStyle = '#a87c28';
      for (let gy = 3; gy < ts; gy += 5) {
        ctx.fillRect(sx, sy + gy, ts, 2);
      }
      // Sparse vertical dividers (straw bundles)
      ctx.fillStyle = '#b88830';
      const bx2 = (((tx * 7) % ts) + ts) % ts;
      ctx.fillRect(sx + bx2, sy, 1, ts);
      // Highlight: lighter top-left area (lit from above)
      ctx.fillStyle = 'rgba(255,220,80,0.18)';
      ctx.fillRect(sx, sy, ts, Math.floor(ts * 0.4));
      break;
    }

    // Slate roof — blue-gray inn/tower
    case ROOF_SLATE: {
      const slateBase = ty % 2 === 0 ? '#7a8898' : '#828fa0';
      ctx.fillStyle = slateBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Horizontal slate tile rows
      ctx.fillStyle = '#606e80';
      for (let gy = 4; gy < ts; gy += 6) {
        ctx.fillRect(sx, sy + gy, ts, 1);
      }
      // Staggered vertical seams
      const slateOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
      ctx.fillStyle = '#6a7888';
      ctx.fillRect(sx + ((Math.floor(ts * 0.5) + slateOff) % ts), sy, 1, ts);
      // Lit top edge
      ctx.fillStyle = '#9aaabb';
      ctx.fillRect(sx, sy, ts, 2);
      break;
    }

    // Terracotta tile roof — warm red shop
    case ROOF_RED: {
      const redBase = ty % 2 === 0 ? '#b84838' : '#c05040';
      ctx.fillStyle = redBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Horizontal tile rows with curved highlight
      for (let gy = 0; gy < ts; gy += 7) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(sx, sy + gy, ts, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(sx, sy + gy + 5, ts, 2);
      }
      // Vertical grout
      ctx.fillStyle = '#8a3028';
      const rOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
      ctx.fillRect(sx + ((Math.floor(ts * 0.5) + rOff) % ts), sy, 1, ts);
      // Warm highlight top
      ctx.fillStyle = 'rgba(255,160,80,0.2)';
      ctx.fillRect(sx, sy, ts, Math.floor(ts * 0.35));
      break;
    }

    // Mossy green roof — overgrown hut
    case ROOF_GREEN: {
      ctx.fillStyle = '#4a7040';
      ctx.fillRect(sx, sy, ts, ts);
      // Moss texture variation
      if ((tx * 7 + ty * 11) % 5 === 0) {
        ctx.fillStyle = '#3a5c30';
        ctx.beginPath();
        ctx.arc(
          sx + Math.floor(ts * 0.4),
          sy + Math.floor(ts * 0.5),
          Math.floor(ts * 0.3),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if ((tx * 3 + ty * 13) % 7 === 0) {
        ctx.fillStyle = '#5a8850';
        ctx.beginPath();
        ctx.arc(
          sx + Math.floor(ts * 0.65),
          sy + Math.floor(ts * 0.3),
          Math.floor(ts * 0.22),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Subtle horizontal moss ridges
      ctx.fillStyle = '#3e6036';
      ctx.fillRect(sx, sy + Math.floor(ts * 0.45), ts, 1);
      // Lit top
      ctx.fillStyle = 'rgba(120,200,80,0.15)';
      ctx.fillRect(sx, sy, ts, Math.floor(ts * 0.4));
      break;
    }

    // Fountain — multi-tile animated water basin
    case FOUNTAIN: {
      const nN = structure[ty - 1]?.[tx]?.type === FOUNTAIN;
      const nS = structure[ty + 1]?.[tx]?.type === FOUNTAIN;
      const nE = structure[ty]?.[tx + 1]?.type === FOUNTAIN;
      const nW = structure[ty]?.[tx - 1]?.type === FOUNTAIN;
      const isCenter = nN && nS && nE && nW;
      const fcx = sx + ts / 2;
      const fcy = sy + ts / 2;

      if (isCenter) {
        // Deep water base
        ctx.fillStyle = '#1a5c8a';
        ctx.fillRect(sx, sy, ts, ts);
        // Lighter water surface
        ctx.fillStyle = '#2478aa';
        ctx.fillRect(sx + 2, sy + 2, ts - 4, ts - 4);
        // Animated ripple ring 1 (fill-based: outer circle then mask with water colour)
        const t = performance.now() / 1000;
        const r1 = ts * 0.22 + Math.sin(t * 2.8) * ts * 0.08;
        const a1 = 0.45 + Math.sin(t * 2.8) * 0.15;
        ctx.fillStyle = `rgba(140,215,255,${a1})`;
        ctx.beginPath();
        ctx.arc(fcx, fcy, r1 + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2478aa';
        ctx.beginPath();
        ctx.arc(fcx, fcy, Math.max(1, r1 - 1), 0, Math.PI * 2);
        ctx.fill();
        // Animated ripple ring 2 (offset phase)
        const r2 = ts * 0.38 + Math.sin(t * 2.8 + Math.PI) * ts * 0.06;
        const a2 = 0.28 + Math.sin(t * 2.8 + Math.PI) * 0.1;
        ctx.fillStyle = `rgba(140,215,255,${a2})`;
        ctx.beginPath();
        ctx.arc(fcx, fcy, r2 + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2478aa';
        ctx.beginPath();
        ctx.arc(fcx, fcy, Math.max(1, r2 - 1.5), 0, Math.PI * 2);
        ctx.fill();
        // Centre spout — bright white-blue highlight, gently pulsing
        const spoutA = 0.75 + Math.sin(t * 6.5) * 0.2;
        ctx.fillStyle = `rgba(210,245,255,${spoutA})`;
        ctx.beginPath();
        ctx.arc(fcx, fcy, ts * 0.09, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Stone basin rim
        ctx.fillStyle = '#8c8c8c';
        ctx.fillRect(sx, sy, ts, ts);
        // Lit top and left edges
        ctx.fillStyle = '#b2b2b2';
        ctx.fillRect(sx, sy, ts, 4);
        ctx.fillStyle = '#a4a4a4';
        ctx.fillRect(sx, sy, 3, ts);
        // Mortar seam lines (give it a stone-block look)
        ctx.fillStyle = '#6e6e6e';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.5), ts, 1);
        const bOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillRect(sx + (bOff % ts), sy, 1, Math.floor(ts * 0.5));
        ctx.fillRect(
          sx + ((bOff + Math.floor(ts * 0.5)) % ts),
          sy + Math.floor(ts * 0.5) + 1,
          1,
          ts - Math.floor(ts * 0.5) - 1,
        );
        // Inner basin lip — darker strip on the side facing water
        ctx.fillStyle = '#686868';
        if (nS) ctx.fillRect(sx, sy + ts - 5, ts, 5);
        if (nN) ctx.fillRect(sx, sy, ts, 5);
        if (nE) ctx.fillRect(sx + ts - 5, sy, 5, ts);
        if (nW) ctx.fillRect(sx, sy, 5, ts);
        // Corner ornament: small round stone post at each outer corner
        const isCorner =
          !isCenter && [nN, nS, nE, nW].filter(Boolean).length <= 2;
        if (isCorner) {
          ctx.fillStyle = '#9a9a9a';
          ctx.beginPath();
          ctx.arc(fcx, fcy, ts * 0.28, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#b8b8b8';
          ctx.beginPath();
          ctx.arc(fcx - ts * 0.06, fcy - ts * 0.06, ts * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    // Torch — animated flame, pole not walkable
    case TORCH: {
      const t = performance.now() / 1000;
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
      ctx.ellipse(
        glowX,
        glowY + flameH * 0.08,
        flameW * 0.55,
        flameH * 0.6,
        0,
        0,
        Math.PI * 2,
      );
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
      ctx.arc(
        glowX + Math.sin(t * 2.2) * 2,
        smokeBaseY - ts * 0.05,
        2.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = `rgba(150,150,150,${0.15 + Math.sin(t * 3.3) * 0.05})`;
      ctx.beginPath();
      ctx.arc(
        glowX + Math.sin(t * 2.9) * 3,
        smokeBaseY - ts * 0.15,
        3.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = `rgba(120,120,120,0.08)`;
      ctx.beginPath();
      ctx.arc(
        glowX + Math.sin(t * 2.0) * 4,
        smokeBaseY - ts * 0.26,
        4.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
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
      ctx.fillRect(
        wcx - outerR - postW + 2,
        beamY,
        outerR * 2 + postW * 2 - 4,
        5,
      );
      ctx.fillStyle = '#7a5030';
      ctx.fillRect(
        wcx - outerR - postW + 2,
        beamY,
        outerR * 2 + postW * 2 - 4,
        2,
      );

      // Rope
      ctx.fillStyle = '#c8a050';
      ctx.fillRect(wcx - 1, beamY + 5, 2, innerR * 0.9);
      // Tiny bucket at rope bottom
      ctx.fillStyle = '#7a6040';
      ctx.fillRect(wcx - 3, beamY + 5 + innerR * 0.9 - 1, 6, 4);
      ctx.fillStyle = '#9a8060';
      ctx.fillRect(wcx - 3, beamY + 5 + innerR * 0.9 - 1, 6, 1);
      break;
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
      break;
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
      break;
    }
  }
}

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tileHeight: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
): void {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  const ts = tileHeight;
  const startX = Math.max(0, Math.floor(cameraX / ts));
  const startY = Math.max(0, Math.floor(cameraY / ts));
  const endX = Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts));
  const endY = Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts));

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const tile = structure[y][x];
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      // Decorations that should appear above entities are drawn as base-only
      // here; the full visual is drawn in renderDecorationsOverlay after entities.
      const isDecoration =
        tile.type === TORCH ||
        tile.type === WELL ||
        tile.type === TREE ||
        tile.type === FOUNTAIN;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, isDecoration);
    }
  }
}

/**
 * Second render pass: draws the full visuals for tall decoration tiles
 * (TORCH, WELL, TREE, FOUNTAIN) on top of entities so they correctly occlude
 * characters walking near them from any direction.
 */
export function renderDecorationsOverlay(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tileHeight: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
): void {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  const ts = tileHeight;
  const startX = Math.max(0, Math.floor(cameraX / ts));
  const startY = Math.max(0, Math.floor(cameraY / ts));
  const endX = Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts));
  const endY = Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts));

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const tile = structure[y][x];
      if (
        tile.type !== TORCH &&
        tile.type !== WELL &&
        tile.type !== TREE &&
        tile.type !== FOUNTAIN
      )
        continue;
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, false);
    }
  }
}
