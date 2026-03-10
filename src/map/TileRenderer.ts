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
  METAL_WALL,
  ARENA_FLOOR,
  KRAKAREN_BOSS_ROOM_FLOOR,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
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
    METAL_WALL,
    TREE,
    ROOF_THATCH,
    ROOF_SLATE,
    ROOF_RED,
    ROOF_GREEN,
    ROOF_CIRCUS_RED,
    ROOF_CIRCUS_BLUE,
    ROOF_CIRCUS_PURPLE,
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
      case BUILDING_WALL:
      case ROOF_THATCH:
      case ROOF_SLATE:
      case ROOF_RED:
      case ROOF_GREEN:
      case ROOF_CIRCUS_RED:
      case ROOF_CIRCUS_BLUE:
      case ROOF_CIRCUS_PURPLE:
        ctx.fillStyle = '#6de89d';
        ctx.fillRect(sx, sy, ts, ts);
        return;
      case METAL_WALL:
        // Draw dungeon wall base so shadows look correct beneath metal panels
        ctx.fillStyle = '#1a1e22';
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
      // Door threshold: roof interior immediately north + building wall on either side
      const rdN = structure[ty - 1]?.[tx]?.type;
      const isDoorTile =
        (rdN === ROOF_THATCH ||
          rdN === ROOF_SLATE ||
          rdN === ROOF_RED ||
          rdN === ROOF_GREEN ||
          rdN === ROOF_CIRCUS_RED ||
          rdN === ROOF_CIRCUS_BLUE ||
          rdN === ROOF_CIRCUS_PURPLE) &&
        (structure[ty]?.[tx - 1]?.type === BUILDING_WALL ||
          structure[ty]?.[tx + 1]?.type === BUILDING_WALL);
      if (isDoorTile) {
        // Stone threshold slab
        ctx.fillStyle = '#9a8870';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#8a7860';
        ctx.fillRect(sx + 2, sy + 2, ts - 4, ts - 4);
        ctx.fillStyle = '#b0a080'; // step edge highlight
        ctx.fillRect(sx, sy, ts, 2);
        ctx.fillRect(sx, sy, 2, ts);
        ctx.fillStyle = 'rgba(0,0,0,0.24)'; // shadow from overhang above
        ctx.fillRect(sx, sy, ts, 5);
      }
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

    // Krakaren Clone lair — dark wet cavern floor
    case KRAKAREN_BOSS_ROOM_FLOOR: {
      // Dark blue-grey stone base
      const cavBase = (tx + ty) % 2 === 0 ? '#1a1e24' : '#161a20';
      ctx.fillStyle = cavBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Wet sheen patches
      if ((tx * 7 + ty * 13) % 5 === 0) {
        ctx.fillStyle = 'rgba(100,140,180,0.08)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.5,
          sy + ts * 0.5,
          ts * 0.35,
          ts * 0.25,
          (tx + ty) * 0.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Crack lines
      if ((tx + ty * 3) % 7 === 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx + ts * 0.2, sy + ts * 0.3);
        ctx.lineTo(sx + ts * 0.8, sy + ts * 0.7);
        ctx.stroke();
      }
      // Pink slime drips (hints at the Krakaren)
      if ((tx * 11 + ty * 5) % 9 === 0) {
        ctx.fillStyle = 'rgba(220,100,140,0.15)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.6,
          sy + ts * 0.4,
          ts * 0.12,
          ts * 0.08,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
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
      const isRoofTile = (t: number | undefined) =>
        t === ROOF_THATCH ||
        t === ROOF_SLATE ||
        t === ROOF_RED ||
        t === ROOF_GREEN ||
        t === ROOF_CIRCUS_RED ||
        t === ROOF_CIRCUS_BLUE ||
        t === ROOF_CIRCUS_PURPLE;
      const intN = isRoofTile(structure[ty - 1]?.[tx]?.type); // south-facing facade
      const intS = isRoofTile(structure[ty + 1]?.[tx]?.type); // north-facing wall
      if (intN) {
        // South-facing facade — determine style from interior roof type
        const roofType = structure[ty - 1]?.[tx]?.type;
        const isCottage = roofType === ROOF_THATCH;
        const isTower = roofType === ROOF_SLATE;
        const isMerchant = roofType === ROOF_RED;

        let wallBase = '#c0ae98';
        let litTop = '#d4c2ac';
        let foundBase = '#9a8a78';
        if (isCottage) {
          wallBase = '#ede0c0';
          litTop = '#f5ecdc';
          foundBase = '#b8a488';
        } else if (isTower) {
          wallBase = '#b8b0a8';
          litTop = '#ccc4bc';
          foundBase = '#888078';
        } else if (isMerchant) {
          wallBase = '#d4a870';
          litTop = '#e0b880';
          foundBase = '#a07050';
        } else if (
          roofType === ROOF_CIRCUS_RED ||
          roofType === ROOF_CIRCUS_BLUE ||
          roofType === ROOF_CIRCUS_PURPLE
        ) {
          wallBase = '#f0e8d0';
          litTop = '#fff4e0';
          foundBase = '#c0a878';
        }

        ctx.fillStyle = wallBase;
        ctx.fillRect(sx, sy, ts, ts);
        // Foundation strip
        ctx.fillStyle = foundBase;
        ctx.fillRect(sx, sy + ts - 3, ts, 3);

        if (isCottage) {
          // Half-timber: dark oak beams on plaster
          ctx.fillStyle = '#3e2410';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.38), ts, 2);
          ctx.fillRect(sx + Math.floor(ts * 0.28), sy, 2, ts - 3);
          ctx.fillRect(sx + Math.floor(ts * 0.7), sy, 2, ts - 3);
        } else if (isTower) {
          // Dressed stone: large regular blocks
          ctx.fillStyle = '#7a7268';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.34), ts, 1);
          ctx.fillRect(sx, sy + Math.floor(ts * 0.67), ts, 1);
          const bOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
          ctx.fillRect(
            sx + ((Math.floor(ts * 0.5) + bOff) % ts),
            sy,
            1,
            Math.floor(ts * 0.34),
          );
          ctx.fillRect(
            sx + (bOff % ts),
            sy + Math.floor(ts * 0.34) + 1,
            1,
            Math.floor(ts * 0.33) - 1,
          );
          ctx.fillRect(
            sx + ((Math.floor(ts * 0.5) + bOff) % ts),
            sy + Math.floor(ts * 0.67) + 1,
            1,
            ts - Math.floor(ts * 0.67) - 4,
          );
        } else if (isMerchant) {
          // Painted plaster: decorative trim bands
          ctx.fillStyle = '#b07848';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.14), ts, 2);
          ctx.fillRect(sx, sy + ts - 6, ts, 2);
        } else if (
          roofType === ROOF_CIRCUS_RED ||
          roofType === ROOF_CIRCUS_BLUE ||
          roofType === ROOF_CIRCUS_PURPLE
        ) {
          // Circus tent canvas wall: alternating vertical stripes
          const stripeColor =
            roofType === ROOF_CIRCUS_RED
              ? '#cc2222'
              : roofType === ROOF_CIRCUS_BLUE
                ? '#2244aa'
                : '#7722aa';
          const stripeW = Math.max(3, Math.floor(ts * 0.25));
          for (let si = 0; si < ts; si += stripeW * 2) {
            ctx.fillStyle = stripeColor;
            ctx.fillRect(sx + si, sy, stripeW, ts - 3);
          }
          // Gold trim at top
          ctx.fillStyle = '#ffcc22';
          ctx.fillRect(sx, sy, ts, 2);
        } else {
          // Rough stone: irregular coursing
          ctx.fillStyle = '#7a7060';
          ctx.fillRect(sx, sy + Math.floor(ts * 0.38), ts, 1);
          ctx.fillRect(sx, sy + Math.floor(ts * 0.72), ts, 1);
          const rBx = (tx * 7 + ty * 3) % Math.floor(ts * 0.5);
          ctx.fillRect(sx + rBx, sy, 1, Math.floor(ts * 0.38));
        }

        // Window on non-corner tiles
        const wallE2 = structure[ty]?.[tx + 1]?.type === BUILDING_WALL;
        const wallW2 = structure[ty]?.[tx - 1]?.type === BUILDING_WALL;
        if (wallE2 && wallW2 && tx % 2 === 1) {
          const ww = Math.floor(ts * 0.44);
          const wh = Math.floor(ts * 0.3);
          const wx = sx + Math.floor((ts - ww) / 2);
          const wy = sy + Math.floor(ts * 0.2);
          if (isCottage) {
            // Arched leaded window
            // Outer stone frame
            ctx.fillStyle = '#3a2010';
            ctx.fillRect(wx - 2, wy, ww + 4, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2 + 2, Math.PI, 0);
            ctx.fill();
            // Glass + warm interior glow
            ctx.fillStyle = '#90b8cc';
            ctx.fillRect(wx, wy, ww, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,200,80,0.22)';
            ctx.fillRect(wx, wy, ww, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2, Math.PI, 0);
            ctx.fill();
            // Lead muntins: vertical thirds + horizontal thirds
            ctx.fillStyle = '#4a3018';
            ctx.fillRect(
              wx + Math.floor(ww * 0.33),
              wy - Math.floor(ww / 2),
              1,
              wh + Math.floor(ww / 2),
            );
            ctx.fillRect(
              wx + Math.floor(ww * 0.67),
              wy - Math.floor(ww / 2),
              1,
              wh + Math.floor(ww / 2),
            );
            ctx.fillRect(wx, wy + Math.floor(wh * 0.35), ww, 1);
            ctx.fillRect(wx, wy + Math.floor(wh * 0.7), ww, 1);
            // Glass reflection glint
            ctx.fillStyle = 'rgba(255,255,255,0.30)';
            ctx.fillRect(wx + 1, wy + 1, Math.floor(ww * 0.28), 1);
            // Wide stone sill with perspective shadow
            ctx.fillStyle = '#c8a870';
            ctx.fillRect(wx - 4, wy + wh, ww + 8, 4);
            ctx.fillStyle = '#a88858';
            ctx.fillRect(wx - 4, wy + wh + 3, ww + 8, 1); // bottom shadow
            ctx.fillStyle = '#e0c090';
            ctx.fillRect(wx - 4, wy + wh, ww + 8, 1); // top highlight
          } else if (isTower) {
            // Stone arch with keystone
            const archH = Math.floor(ww / 3);
            ctx.fillStyle = '#888078';
            ctx.fillRect(wx - 2, wy, ww + 4, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2 + 2, Math.PI, 0);
            ctx.fill();
            // Glass + warm glow
            ctx.fillStyle = '#7a8898';
            ctx.fillRect(wx, wy, ww, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,200,80,0.18)';
            ctx.fillRect(wx, wy, ww, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2, Math.PI, 0);
            ctx.fill();
            // Keystone
            ctx.fillStyle = '#686058';
            ctx.fillRect(wx + Math.floor(ww / 2) - 2, wy - archH, 4, archH);
            // Mullion + horizontal bar
            ctx.fillStyle = '#8898a8';
            ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
            ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
            // Glass reflection
            ctx.fillStyle = 'rgba(255,255,255,0.20)';
            ctx.fillRect(wx + 1, wy + 1, Math.floor(ww * 0.28), 1);
            // Stone sill with depth
            ctx.fillStyle = '#a0a098';
            ctx.fillRect(wx - 3, wy + wh, ww + 6, 4);
            ctx.fillStyle = '#c0beb8';
            ctx.fillRect(wx - 3, wy + wh, ww + 6, 1);
            ctx.fillStyle = '#707068';
            ctx.fillRect(wx - 3, wy + wh + 3, ww + 6, 1);
          } else {
            // Shuttered window
            ctx.fillStyle = isMerchant ? '#5a3820' : '#4a3820';
            ctx.fillRect(wx - 4, wy, 3, wh);
            ctx.fillRect(wx + ww + 1, wy, 3, wh);
            ctx.fillStyle = isMerchant ? '#7a4a28' : '#6a4a28';
            for (let sl = wy + 2; sl < wy + wh; sl += 4) {
              ctx.fillRect(wx - 4, sl, 3, 1);
              ctx.fillRect(wx + ww + 1, sl, 3, 1);
            }
            // Window frame border
            ctx.fillStyle = '#2a3a50';
            ctx.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
            // Glass + warm interior light
            ctx.fillStyle = '#b0cce0';
            ctx.fillRect(wx, wy, ww, wh);
            ctx.fillStyle = 'rgba(255,200,80,0.20)';
            ctx.fillRect(wx, wy, ww, wh);
            // Mullion cross
            ctx.fillStyle = '#6a8aa0';
            ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
            ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
            // Glass reflection glint
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(wx + 1, wy + 1, Math.floor(ww * 0.32), 1);
            // Deep sill with perspective shadow + highlight
            ctx.fillStyle = isMerchant ? '#c09060' : '#b0a090';
            ctx.fillRect(wx - 2, wy + wh, ww + 4, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(wx - 2, wy + wh + 3, ww + 4, 1); // sill bottom shadow
            ctx.fillStyle = isMerchant ? '#e0c090' : '#d0c0a0';
            ctx.fillRect(wx - 2, wy + wh, ww + 4, 1); // sill top highlight
            if (isMerchant) {
              // Flower box
              ctx.fillStyle = '#4a2810';
              ctx.fillRect(wx - 2, wy + wh + 4, ww + 4, 3);
              ctx.fillStyle = '#3a6820';
              for (let fi = wx; fi < wx + ww; fi += 5) {
                ctx.fillRect(fi + 1, wy + wh + 5, 2, 2);
              }
              ctx.fillStyle = '#e04848';
              ctx.fillRect(wx + 1, wy + wh + 4, 2, 2);
              ctx.fillStyle = '#e8b020';
              ctx.fillRect(wx + Math.floor(ww / 2), wy + wh + 4, 2, 2);
            }
          }
        }
        // Cornice (lit top edge + subtle shadow below)
        ctx.fillStyle = litTop;
        ctx.fillRect(sx, sy, ts, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(sx, sy + 2, ts, 1);
      } else if (intS) {
        // North-facing back wall — draw wall base, then a peaked gable roof
        // extending ABOVE the tile into the screen space north of the building.
        // Tiles rendered before this one (grass/road) are correctly overpainted.
        ctx.fillStyle = '#5a5048';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#4a4038';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.5), ts, 1);
        ctx.fillStyle = '#6a6058';
        ctx.fillRect(sx, sy, ts, 2);

        // Roof material from south neighbour (interior tile)
        const innerType = structure[ty + 1]?.[tx]?.type;
        let roofLit = '#b88830';
        let roofShade = '#6a4e14';
        let roofRidge = '#ffe060';
        let eaveColor = '#907018';
        if (innerType === ROOF_THATCH) {
          roofLit = '#c89840';
          roofShade = '#6a4e14';
          roofRidge = '#ffe868';
          eaveColor = '#907018';
        } else if (innerType === ROOF_SLATE) {
          roofLit = '#627080';
          roofShade = '#343e4c';
          roofRidge = '#d8eeff';
          eaveColor = '#404e5e';
        } else if (innerType === ROOF_RED) {
          roofLit = '#9a3c2c';
          roofShade = '#4e1412';
          roofRidge = '#ff8070';
          eaveColor = '#5e1810';
        } else if (innerType === ROOF_GREEN) {
          roofLit = '#3a6030';
          roofShade = '#1c3214';
          roofRidge = '#78b068';
          eaveColor = '#1e4018';
        } else if (innerType === ROOF_CIRCUS_RED) {
          roofLit = '#cc2222';
          roofShade = '#661111';
          roofRidge = '#ffdd44';
          eaveColor = '#881818';
        } else if (innerType === ROOF_CIRCUS_BLUE) {
          roofLit = '#2244aa';
          roofShade = '#112255';
          roofRidge = '#ffcc22';
          eaveColor = '#182878';
        } else if (innerType === ROOF_CIRCUS_PURPLE) {
          roofLit = '#7722aa';
          roofShade = '#3a1155';
          roofRidge = '#ffdd44';
          eaveColor = '#4a1878';
        }

        // Scan contiguous intS tiles to find building width
        let lx = tx;
        while (
          structure[ty]?.[lx - 1]?.type === BUILDING_WALL &&
          isRoofTile(structure[ty + 1]?.[lx - 1]?.type)
        )
          lx--;
        let rx = tx;
        while (
          structure[ty]?.[rx + 1]?.type === BUILDING_WALL &&
          isRoofTile(structure[ty + 1]?.[rx + 1]?.type)
        )
          rx++;

        const wallPx = (rx - lx + 1) * ts; // building width in pixels
        const posInPx = (tx - lx) * ts; // this tile's left edge, building-local
        const peakH = Math.floor(ts * 2.5); // gable peak height above wall top

        // Triangle height at pixel x from building left edge
        const triH = (x: number) =>
          Math.max(0, peakH * (1 - Math.abs(x - wallPx / 2) / (wallPx / 2)));

        const hLeft = triH(posInPx);
        const hRight = triH(posInPx + ts);
        const peakSX = sx - posInPx + wallPx / 2; // screen X of gable apex

        if (hLeft > 0 || hRight > 0) {
          const apexInTile = peakSX > sx && peakSX < sx + ts;
          if (apexInTile) {
            // Left slope (slightly lit)
            ctx.fillStyle = roofLit;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx, sy - Math.round(hLeft));
            ctx.lineTo(Math.round(peakSX), sy - peakH);
            ctx.lineTo(Math.round(peakSX), sy);
            ctx.closePath();
            ctx.fill();
            // Right slope (shadowed)
            ctx.fillStyle = roofShade;
            ctx.beginPath();
            ctx.moveTo(Math.round(peakSX), sy);
            ctx.lineTo(Math.round(peakSX), sy - peakH);
            ctx.lineTo(sx + ts, sy - Math.round(hRight));
            ctx.lineTo(sx + ts, sy);
            ctx.closePath();
            ctx.fill();
            // Ridge dot at apex
            ctx.fillStyle = roofRidge;
            ctx.fillRect(Math.round(peakSX) - 1, sy - peakH, 3, 4);
          } else {
            // Entire tile on one slope
            const isLeftSlope = peakSX >= sx + ts;
            ctx.fillStyle = isLeftSlope ? roofLit : roofShade;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx, sy - Math.round(hLeft));
            ctx.lineTo(sx + ts, sy - Math.round(hRight));
            ctx.lineTo(sx + ts, sy);
            ctx.closePath();
            ctx.fill();
          }
          // Eave shadow line at the base of the gable face
          ctx.fillStyle = eaveColor;
          ctx.fillRect(sx, sy - 3, ts, 3);
          ctx.fillStyle = 'rgba(0,0,0,0.50)';
          ctx.fillRect(sx, sy - 2, ts, 2);
        }
      } else {
        // Fallback — plain stone (shouldn't appear with side-less buildings)
        ctx.fillStyle = '#c0ae98';
        ctx.fillRect(sx, sy, ts, ts);
      }
      break;
    }

    // Thatched roof — pitched slope (eaves / ridge / back)
    case ROOF_THATCH: {
      const thS = structure[ty + 1]?.[tx]?.type === BUILDING_WALL; // eaves row
      const thN = structure[ty - 1]?.[tx]?.type === BUILDING_WALL; // back slope row
      if (thS) {
        // Front slope (eaves) — medium-bright, deep shadow at top
        ctx.fillStyle = '#c89840';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = 'rgba(40,20,0,0.50)';
        ctx.fillRect(sx, sy, ts, 6); // eave overhang shadow
        ctx.fillStyle = '#a07820';
        for (let gy = 7; gy < ts - 3; gy += 5) {
          ctx.fillRect(sx, sy + gy, ts, 2); // straw bands
        }
        ctx.fillStyle = '#b08828';
        const bxE = (((tx * 7) % ts) + ts) % ts;
        ctx.fillRect(sx + bxE, sy + 6, 1, ts - 9); // straw bundle
        ctx.fillStyle = '#907018'; // eave drip fringe
        ctx.fillRect(sx, sy + ts - 5, ts, 2);
        ctx.fillStyle = '#d0a838';
        ctx.fillRect(sx, sy + ts - 3, ts, 2);
        ctx.fillStyle = 'rgba(255,220,80,0.18)'; // sun-lit slope
        ctx.fillRect(sx, sy + 6, ts, Math.floor(ts * 0.48));
      } else if (thN) {
        // Back slope — deep shadow
        ctx.fillStyle = '#6a4e14';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#503c0c';
        for (let gy = 3; gy < ts; gy += 5) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        ctx.fillStyle = '#8a6420'; // slight ridge highlight at top
        ctx.fillRect(sx, sy, ts, 2);
      } else {
        // Middle / ridge zone
        ctx.fillStyle = '#b88830';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#9a7020';
        for (let gy = 3; gy < ts; gy += 5) {
          ctx.fillRect(sx, sy + gy, ts, 2);
        }
        // Clean narrow ridge cap
        const thRidgeY = sy + Math.floor(ts * 0.46);
        ctx.fillStyle = '#7a5a10'; // shadow valley above ridge
        ctx.fillRect(sx, thRidgeY - 3, ts, 3);
        ctx.fillStyle = '#7a5a10'; // shadow valley below ridge
        ctx.fillRect(sx, thRidgeY + 2, ts, 3);
        ctx.fillStyle = '#ffe060'; // bright ridge line
        ctx.fillRect(sx, thRidgeY, ts, 2);
        ctx.fillStyle = '#fff088'; // apex highlight
        ctx.fillRect(sx, thRidgeY, ts, 1);
        ctx.fillStyle = '#c09838';
        const bxM = (((tx * 7) % ts) + ts) % ts;
        ctx.fillRect(sx + bxM, sy, 1, ts); // straw bundle
        ctx.fillStyle = 'rgba(255,220,80,0.10)';
        ctx.fillRect(sx, sy, ts, thRidgeY - sy); // lit front half
        // Chimney (deterministic placement)
        if ((tx * 11 + ty * 7) % 19 === 5) {
          const chx = sx + Math.floor(ts * 0.48) - 3;
          const chy = sy + Math.floor(ts * 0.28);
          ctx.fillStyle = '#4a3828';
          ctx.fillRect(chx, chy, 7, 9);
          ctx.fillStyle = '#3a2818';
          ctx.fillRect(chx + 5, chy + 1, 2, 8); // dark side
          ctx.fillStyle = '#6a5840';
          ctx.fillRect(chx - 1, chy, 9, 2); // cap
          ctx.fillStyle = 'rgba(200,200,200,0.32)';
          ctx.beginPath();
          ctx.arc(chx + 3, chy - 3, 3, 0, Math.PI * 2);
          ctx.fill(); // smoke puff
        }
      }
      break;
    }

    // Slate roof — pitched slope (eaves / ridge / back)
    case ROOF_SLATE: {
      const slS = structure[ty + 1]?.[tx]?.type === BUILDING_WALL; // eaves
      const slN = structure[ty - 1]?.[tx]?.type === BUILDING_WALL; // back slope
      if (slS) {
        // Front slope — medium-dark slate
        ctx.fillStyle = '#627080';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = 'rgba(0,0,0,0.50)';
        ctx.fillRect(sx, sy, ts, 6); // eave shadow
        ctx.fillStyle = '#505e6e';
        for (let gy = 7; gy < ts - 3; gy += 6) {
          ctx.fillRect(sx, sy + gy, ts, 1); // slate tile rows
        }
        const sOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillStyle = '#586878';
        ctx.fillRect(
          sx + ((Math.floor(ts * 0.5) + sOff) % ts),
          sy + 6,
          1,
          ts - 9,
        );
        ctx.fillStyle = '#404e5e'; // gutter at bottom
        ctx.fillRect(sx, sy + ts - 4, ts, 3);
        ctx.fillStyle = '#7888a0';
        ctx.fillRect(sx, sy + ts - 4, ts, 1);
        ctx.fillStyle = 'rgba(180,220,255,0.09)'; // sheen
        ctx.fillRect(sx, sy + 6, ts, Math.floor(ts * 0.4));
      } else if (slN) {
        // Back slope — very dark
        ctx.fillStyle = '#343e4c';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#282e3a';
        for (let gy = 4; gy < ts; gy += 6) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        ctx.fillStyle = '#485868';
        ctx.fillRect(sx, sy, ts, 2);
      } else {
        // Middle / ridge — lead flashing
        ctx.fillStyle = '#7a8898';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#606e80';
        for (let gy = 4; gy < ts; gy += 6) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        // Clean narrow ridge cap
        const slRidgeY = sy + Math.floor(ts * 0.45);
        ctx.fillStyle = '#485868'; // shadow valleys
        ctx.fillRect(sx, slRidgeY - 3, ts, 3);
        ctx.fillRect(sx, slRidgeY + 2, ts, 3);
        ctx.fillStyle = '#d8eeff'; // bright ridge
        ctx.fillRect(sx, slRidgeY, ts, 2);
        ctx.fillStyle = '#f0f8ff'; // apex highlight
        ctx.fillRect(sx, slRidgeY, ts, 1);
        const sOff2 = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillStyle = '#6a7888';
        ctx.fillRect(sx + ((Math.floor(ts * 0.5) + sOff2) % ts), sy, 1, ts);
        ctx.fillStyle = '#9aaabb';
        ctx.fillRect(sx, sy, ts, 2); // lit top
        // Chimney (brick, tower-style)
        if ((tx * 13 + ty * 5) % 23 === 7) {
          const chx = sx + Math.floor(ts * 0.42) - 4;
          const chy = sy + Math.floor(ts * 0.18);
          ctx.fillStyle = '#7a6858';
          ctx.fillRect(chx, chy, 10, 13);
          ctx.fillStyle = '#6a5848';
          ctx.fillRect(chx, chy + 4, 10, 1);
          ctx.fillRect(chx, chy + 8, 10, 1);
          ctx.fillStyle = '#5a4838';
          ctx.fillRect(chx + 8, chy + 1, 2, 12); // dark side
          ctx.fillStyle = '#908070';
          ctx.fillRect(chx - 1, chy, 12, 3); // cap
        }
      }
      break;
    }

    // Terracotta tile roof — pitched slope (eaves / ridge / back)
    case ROOF_RED: {
      const rrS = structure[ty + 1]?.[tx]?.type === BUILDING_WALL; // eaves
      const rrN = structure[ty - 1]?.[tx]?.type === BUILDING_WALL; // back slope
      if (rrS) {
        // Front slope — darker terracotta, curved tile rows
        ctx.fillStyle = '#9a3c2c';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = 'rgba(40,0,0,0.52)';
        ctx.fillRect(sx, sy, ts, 6); // eave shadow
        for (let gy = 7; gy < ts - 2; gy += 7) {
          ctx.fillStyle = 'rgba(255,200,160,0.22)';
          ctx.fillRect(sx, sy + gy, ts, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.20)';
          ctx.fillRect(sx, sy + gy + 5, ts, 2);
        }
        const rOff2 = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillStyle = '#721e18';
        ctx.fillRect(
          sx + ((Math.floor(ts * 0.5) + rOff2) % ts),
          sy + 6,
          1,
          ts - 9,
        );
        ctx.fillStyle = '#5e1810'; // drip edge
        ctx.fillRect(sx, sy + ts - 4, ts, 3);
        ctx.fillStyle = '#b83830';
        ctx.fillRect(sx, sy + ts - 4, ts, 1);
        ctx.fillStyle = 'rgba(255,140,60,0.16)'; // warm glow
        ctx.fillRect(sx, sy + 6, ts, Math.floor(ts * 0.48));
      } else if (rrN) {
        // Back slope — very dark red
        ctx.fillStyle = '#4e1412';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#380e0c';
        for (let gy = 5; gy < ts; gy += 7) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        ctx.fillStyle = '#622018';
        ctx.fillRect(sx, sy, ts, 2);
      } else {
        // Middle / ridge — terracotta
        const redBase = ty % 2 === 0 ? '#b84838' : '#c05040';
        ctx.fillStyle = redBase;
        ctx.fillRect(sx, sy, ts, ts);
        for (let gy = 0; gy < ts; gy += 7) {
          ctx.fillStyle = 'rgba(255,200,160,0.16)';
          ctx.fillRect(sx, sy + gy, ts, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(sx, sy + gy + 5, ts, 2);
        }
        // Clean narrow ridge cap
        const rrRidgeY = sy + Math.floor(ts * 0.44);
        ctx.fillStyle = '#721e18'; // shadow valleys
        ctx.fillRect(sx, rrRidgeY - 3, ts, 3);
        ctx.fillRect(sx, rrRidgeY + 2, ts, 3);
        ctx.fillStyle = '#ff8878'; // bright ridge
        ctx.fillRect(sx, rrRidgeY, ts, 2);
        ctx.fillStyle = '#ffb0a0'; // apex highlight
        ctx.fillRect(sx, rrRidgeY, ts, 1);
        ctx.fillStyle = '#8a3028';
        const rOff3 = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
        ctx.fillRect(sx + ((Math.floor(ts * 0.5) + rOff3) % ts), sy, 1, ts);
        ctx.fillStyle = 'rgba(255,160,80,0.16)';
        ctx.fillRect(sx, sy, ts, rrRidgeY - sy);
        // Chimney
        if ((tx * 9 + ty * 11) % 17 === 3) {
          const chx = sx + Math.floor(ts * 0.54) - 3;
          const chy = sy + Math.floor(ts * 0.22);
          ctx.fillStyle = '#7a5040';
          ctx.fillRect(chx, chy, 8, 10);
          ctx.fillStyle = '#6a3830';
          ctx.fillRect(chx, chy + 3, 8, 1);
          ctx.fillRect(chx, chy + 6, 8, 1);
          ctx.fillStyle = '#5a3020';
          ctx.fillRect(chx + 6, chy + 1, 2, 9); // dark side
          ctx.fillStyle = '#9a6050';
          ctx.fillRect(chx - 1, chy, 10, 2); // cap
          ctx.fillStyle = 'rgba(200,200,200,0.28)';
          ctx.beginPath();
          ctx.arc(chx + 4, chy - 3, 3, 0, Math.PI * 2);
          ctx.fill(); // smoke
        }
      }
      break;
    }

    // Mossy green roof — pitched slope (eaves / ridge / back)
    case ROOF_GREEN: {
      const rgS = structure[ty + 1]?.[tx]?.type === BUILDING_WALL; // eaves
      const rgN = structure[ty - 1]?.[tx]?.type === BUILDING_WALL; // back slope
      if (rgS) {
        // Front slope — dark moss with hanging fringe
        ctx.fillStyle = '#3a6030';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = 'rgba(0,20,0,0.52)';
        ctx.fillRect(sx, sy, ts, 6); // eave shadow
        if ((tx * 7 + ty * 11) % 5 === 0) {
          ctx.fillStyle = '#2a4c22';
          ctx.beginPath();
          ctx.arc(
            sx + Math.floor(ts * 0.4),
            sy + Math.floor(ts * 0.55),
            Math.floor(ts * 0.28),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.fillStyle = '#2a4c22';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.4), ts, 1);
        ctx.fillRect(sx, sy + Math.floor(ts * 0.7), ts, 1);
        ctx.fillStyle = '#1e4018'; // hanging moss fringe
        for (let mx = sx + 2; mx < sx + ts - 1; mx += 5) {
          ctx.fillRect(mx, sy + ts - 6, 1, 6);
          ctx.fillRect(mx + 2, sy + ts - 4, 1, 4);
        }
        ctx.fillStyle = 'rgba(80,160,60,0.14)';
        ctx.fillRect(sx, sy + 6, ts, Math.floor(ts * 0.48));
      } else if (rgN) {
        // Back slope — very dark green
        ctx.fillStyle = '#1c3214';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#142810';
        ctx.fillRect(sx, sy + Math.floor(ts * 0.5), ts, 1);
        ctx.fillStyle = '#284824';
        ctx.fillRect(sx, sy, ts, 2);
      } else {
        // Middle / ridge — moss
        ctx.fillStyle = '#4a7040';
        ctx.fillRect(sx, sy, ts, ts);
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
        // Clean narrow ridge cap
        const rgRidgeY = sy + Math.floor(ts * 0.46);
        ctx.fillStyle = '#1e4018'; // shadow valleys
        ctx.fillRect(sx, rgRidgeY - 3, ts, 3);
        ctx.fillRect(sx, rgRidgeY + 2, ts, 3);
        ctx.fillStyle = '#90d870'; // bright ridge
        ctx.fillRect(sx, rgRidgeY, ts, 2);
        ctx.fillStyle = '#b0f090'; // apex highlight
        ctx.fillRect(sx, rgRidgeY, ts, 1);
        ctx.fillStyle = 'rgba(120,200,80,0.13)';
        ctx.fillRect(sx, sy, ts, rgRidgeY - sy); // lit top
      }
      break;
    }

    // Circus tent roofs — bold striped canvas
    case ROOF_CIRCUS_RED:
    case ROOF_CIRCUS_BLUE:
    case ROOF_CIRCUS_PURPLE: {
      const isCircusRed = type === ROOF_CIRCUS_RED;
      const isCircusBlue = type === ROOF_CIRCUS_BLUE;
      // Pick color palette based on tent type
      const stripe1 = isCircusRed
        ? '#cc2222'
        : isCircusBlue
          ? '#2244aa'
          : '#7722aa';
      const stripe2 = isCircusRed
        ? '#f8f0e0'
        : isCircusBlue
          ? '#ffcc22'
          : '#ffdd44';
      const shadowStripe = isCircusRed
        ? '#881414'
        : isCircusBlue
          ? '#162878'
          : '#4a1470';
      const ridgeColor = isCircusRed
        ? '#ffdd44'
        : isCircusBlue
          ? '#ffee66'
          : '#ffcc22';

      const ctS = structure[ty + 1]?.[tx]?.type === BUILDING_WALL; // eaves row
      const ctN = structure[ty - 1]?.[tx]?.type === BUILDING_WALL; // back slope row
      if (ctS) {
        // Front slope (eaves) — striped canvas
        ctx.fillStyle = stripe2;
        ctx.fillRect(sx, sy, ts, ts);
        // Bold vertical stripes
        const sw = Math.max(4, Math.floor(ts * 0.28));
        for (let si = 0; si < ts; si += sw * 2) {
          ctx.fillStyle = stripe1;
          ctx.fillRect(sx + si, sy, sw, ts);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(sx, sy, ts, 5); // eave overhang shadow
        // Scalloped eave fringe
        ctx.fillStyle = ridgeColor;
        for (let fx = sx; fx < sx + ts; fx += 8) {
          ctx.beginPath();
          ctx.arc(fx + 4, sy + ts - 2, 4, Math.PI, 0);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,200,0.12)';
        ctx.fillRect(sx, sy + 5, ts, Math.floor(ts * 0.5)); // sun-lit slope
      } else if (ctN) {
        // Back slope — darker
        ctx.fillStyle = shadowStripe;
        ctx.fillRect(sx, sy, ts, ts);
        const sw = Math.max(4, Math.floor(ts * 0.28));
        for (let si = sw; si < ts; si += sw * 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(sx + si, sy, sw, ts);
        }
        ctx.fillStyle = stripe1;
        ctx.fillRect(sx, sy, ts, 2); // ridge highlight
      } else {
        // Middle / ridge — striped canvas with peak
        ctx.fillStyle = stripe2;
        ctx.fillRect(sx, sy, ts, ts);
        const sw = Math.max(4, Math.floor(ts * 0.28));
        for (let si = 0; si < ts; si += sw * 2) {
          ctx.fillStyle = stripe1;
          ctx.fillRect(sx + si, sy, sw, ts);
        }
        // Ridge peak with gold trim
        const ridgeY = sy + Math.floor(ts * 0.45);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(sx, ridgeY - 3, ts, 3);
        ctx.fillRect(sx, ridgeY + 3, ts, 3);
        ctx.fillStyle = ridgeColor;
        ctx.fillRect(sx, ridgeY, ts, 3);
        ctx.fillStyle = '#fff8cc'; // bright apex
        ctx.fillRect(sx, ridgeY, ts, 1);
        // Tent pole finial (flag on big tent, pennant on small)
        if (isCircusRed && (tx * 11 + ty * 7) % 13 === 3) {
          // Small flag on pole
          const px = sx + Math.floor(ts * 0.5);
          const py = sy + Math.floor(ts * 0.1);
          ctx.fillStyle = '#4a2a0a';
          ctx.fillRect(px - 1, py, 3, ridgeY - py); // pole
          ctx.fillStyle = '#ffdd44';
          ctx.fillRect(px - 1, py - 2, 5, 3); // finial ball
          // Tiny pennant
          ctx.fillStyle = '#cc2222';
          ctx.beginPath();
          ctx.moveTo(px + 2, py);
          ctx.lineTo(px + 10, py + 3);
          ctx.lineTo(px + 2, py + 6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,200,0.08)';
        ctx.fillRect(sx, sy, ts, ridgeY - sy); // lit top half
      }
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
      const t = performance.now() / 1000;

      if (isCenter) {
        // === WATER BASIN FLOOR ===
        ctx.fillStyle = '#0d4a73';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#155f8f';
        ctx.fillRect(sx + 2, sy + 2, ts - 4, ts - 4);

        // Animated water shimmer glints
        for (let i = 0; i < 3; i++) {
          const gx =
            sx +
            5 +
            ((i * 9 + Math.sin(t * 1.3 + i * 2.0) * 5 + 10) % (ts - 10));
          const gy =
            sy +
            6 +
            ((Math.cos(t * 1.1 + i * 1.6) * 4 + 5 + i * 6) % (ts - 12));
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
        ctx.fillRect(
          Math.floor(fcx - pedW * 0.6),
          capY,
          Math.floor(pedW * 1.2),
          8,
        );
        ctx.fillStyle = '#b0a898';
        ctx.fillRect(
          Math.floor(fcx - pedW * 0.6),
          capY,
          Math.floor(pedW * 1.2),
          2,
        );

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
            const bx =
              (1 - dp) * (1 - dp) * fcx +
              2 * (1 - dp) * dp * ctrlX +
              dp * dp * endX;
            const by =
              (1 - dp) * (1 - dp) * jetTipY +
              2 * (1 - dp) * dp * ctrlY +
              dp * dp * endY;
            const dAlpha = 0.5 + dp * 0.4;
            const dSize = Math.ceil(1 + dp * 1.8);
            ctx.fillStyle = `rgba(190,238,255,${dAlpha})`;
            ctx.fillRect(
              Math.floor(bx - dSize / 2),
              Math.floor(by),
              dSize,
              dSize,
            );
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

    // Metal wall — dark riveted steel panels for the arena exterior
    case METAL_WALL: {
      // Base: very dark charcoal steel
      ctx.fillStyle = '#1a1e22';
      ctx.fillRect(sx, sy, ts, ts);

      // Panel plate (slightly lighter inset)
      const pad = 2;
      ctx.fillStyle = '#252c32';
      ctx.fillRect(sx + pad, sy + pad, ts - pad * 2, ts - pad * 2);

      // Horizontal weld seam in the middle
      ctx.fillStyle = '#131619';
      ctx.fillRect(sx, sy + Math.floor(ts / 2), ts, 2);

      // Vertical seam staggered by row
      const mOff = ty % 2 === 0 ? 0 : Math.floor(ts * 0.5);
      const mvx = sx + (mOff % ts);
      ctx.fillStyle = '#131619';
      ctx.fillRect(mvx, sy, 2, ts);

      // Lit top edge (simulates overhead light catching the top of the wall)
      ctx.fillStyle = '#3a444c';
      ctx.fillRect(sx, sy, ts, 2);

      // Rivets at each corner of the panel
      const rivetColor = '#3c454e';
      const rivetHighlight = '#5a6570';
      const rivetPositions: [number, number][] = [
        [sx + 4, sy + 4],
        [sx + ts - 5, sy + 4],
        [sx + 4, sy + ts - 5],
        [sx + ts - 5, sy + ts - 5],
      ];
      for (const [rx, ry] of rivetPositions) {
        ctx.fillStyle = rivetColor;
        ctx.beginPath();
        ctx.arc(rx, ry, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rivetHighlight;
        ctx.beginPath();
        ctx.arc(rx - 0.5, ry - 0.5, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Subtle sheen on left edge
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(sx, sy, 2, ts);
      break;
    }

    // Arena floor — dark steel grating with blood-stained centre
    case ARENA_FLOOR: {
      // Base: very dark steel grey
      ctx.fillStyle = '#18191f';
      ctx.fillRect(sx, sy, ts, ts);

      // Grating crosshatch lines
      ctx.strokeStyle = '#23262e';
      ctx.lineWidth = 1;
      const gridStep = Math.floor(ts / 4);
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * gridStep, sy);
        ctx.lineTo(sx + i * gridStep, sy + ts);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx, sy + i * gridStep);
        ctx.lineTo(sx + ts, sy + i * gridStep);
        ctx.stroke();
      }

      // Rivet dots at grid intersections
      const h2 = tx * 7 + ty * 13;
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = '#2e323c';
        for (let iy = 1; iy < 4; iy++) {
          for (let ix = 1; ix < 4; ix++) {
            if ((ix + iy) % 2 === 0) {
              ctx.beginPath();
              ctx.arc(
                sx + ix * gridStep,
                sy + iy * gridStep,
                1.2,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
          }
        }
      }

      // Subtle blood stain on some tiles
      const bloodSeed = (tx * 3571 + ty * 1237) & 0xffff;
      if (bloodSeed % 11 === 0) {
        ctx.globalAlpha = 0.18 + (bloodSeed % 7) * 0.03;
        ctx.fillStyle = '#6b1a1a';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.5 + ((bloodSeed % 8) - 4),
          sy + ts * 0.5 + (((bloodSeed >> 4) % 8) - 4),
          ts * (0.2 + (bloodSeed % 5) * 0.04),
          ts * (0.12 + (bloodSeed % 4) * 0.03),
          (bloodSeed % 16) * 0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      void h2;
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
        tile.type === FOUNTAIN ||
        tile.type === BUILDING_WALL ||
        tile.type === ROOF_THATCH ||
        tile.type === ROOF_SLATE ||
        tile.type === ROOF_RED ||
        tile.type === ROOF_GREEN ||
        tile.type === ROOF_CIRCUS_RED ||
        tile.type === ROOF_CIRCUS_BLUE ||
        tile.type === ROOF_CIRCUS_PURPLE;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, isDecoration);
    }
  }
}

/**
 * Draws a single decoration tile at full fidelity (used for z-sorted rendering).
 */
export function drawDecorationTileFull(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawTile(ctx, structure, structure[ty][tx].type, sx, sy, ts, tx, ty, false);
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
        tile.type !== FOUNTAIN &&
        tile.type !== BUILDING_WALL &&
        tile.type !== ROOF_THATCH &&
        tile.type !== ROOF_SLATE &&
        tile.type !== ROOF_RED &&
        tile.type !== ROOF_GREEN &&
        tile.type !== ROOF_CIRCUS_RED &&
        tile.type !== ROOF_CIRCUS_BLUE &&
        tile.type !== ROOF_CIRCUS_PURPLE
      )
        continue;
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, false);
    }
  }
}
