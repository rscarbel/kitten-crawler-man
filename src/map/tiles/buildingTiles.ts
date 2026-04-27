import type { TileContent } from '../tileTypes';
import {
  TREE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  METAL_WALL,
} from '../tileTypes';

export function drawBuildingTile(
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
      case TREE:
        ctx.fillStyle = '#5cc87a';
        ctx.fillRect(sx, sy, ts, ts);
        return true;
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
        return true;
      case METAL_WALL:
        ctx.fillStyle = '#1a1e22';
        ctx.fillRect(sx, sy, ts, ts);
        return true;
      default:
        return false;
    }
  }
  switch (type) {
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
          ctx.fillRect(sx + ((Math.floor(ts * 0.5) + bOff) % ts), sy, 1, Math.floor(ts * 0.34));
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
        ctx.fillRect(sx + ((Math.floor(ts * 0.5) + sOff) % ts), sy + 6, 1, ts - 9);
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
        ctx.fillRect(sx + ((Math.floor(ts * 0.5) + rOff2) % ts), sy + 6, 1, ts - 9);
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
      const stripe1 = isCircusRed ? '#cc2222' : isCircusBlue ? '#2244aa' : '#7722aa';
      const stripe2 = isCircusRed ? '#f8f0e0' : isCircusBlue ? '#ffcc22' : '#ffdd44';
      const shadowStripe = isCircusRed ? '#881414' : isCircusBlue ? '#162878' : '#4a1470';
      const ridgeColor = isCircusRed ? '#ffdd44' : isCircusBlue ? '#ffee66' : '#ffcc22';

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

    default:
      return false;
  }
  return true;
}
