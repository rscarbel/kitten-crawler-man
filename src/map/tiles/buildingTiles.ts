import type { TileContent } from '../tileTypes';
import {
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

const WALL_FOUNDATION_HEIGHT = 3;
const WALL_CORNICE_SHADOW_DEPTH = 1;
const WALL_LIT_TOP_HEIGHT = 2;

// Half-timber facade fractions
const TIMBER_BEAM_Y_FRACTION = 0.38;
const TIMBER_VERT_X1_FRACTION = 0.28;
const TIMBER_VERT_X2_FRACTION = 0.7;

// Dressed stone facade fractions
const STONE_MORTAR_Y1_FRACTION = 0.34;
const STONE_MORTAR_Y2_FRACTION = 0.67;
const STONE_MORTAR_OFFSET_FRACTION = 0.5;
const STONE_MORTAR_SECTION_FRACTION = 0.33;
const STONE_MORTAR_GAP = 4;

// Merchant facade fractions
const MERCHANT_TRIM_Y1_FRACTION = 0.14;
const MERCHANT_TRIM_Y2_OFFSET = 6;
const MERCHANT_TRIM_HEIGHT = 2;

// Rough stone facade fractions
const ROUGH_STONE_MORTAR_Y1_FRACTION = 0.38;
const ROUGH_STONE_MORTAR_Y2_FRACTION = 0.72;
const ROUGH_STONE_HASH_X = 7;
const ROUGH_STONE_HASH_Y = 3;
const ROUGH_STONE_HALF_FRACTION = 0.5;

// Circus stripe
const CIRCUS_STRIPE_MIN_WIDTH = 3;
const CIRCUS_STRIPE_WIDTH_FRACTION = 0.25;

// Window geometry fractions
const WINDOW_WIDTH_FRACTION = 0.44;
const WINDOW_HEIGHT_FRACTION = 0.3;
const WINDOW_TOP_FRACTION = 0.2;

// Cottage window
const COTTAGE_MUNTINS_Y1_FRACTION = 0.33;
const COTTAGE_MUNTINS_Y2_FRACTION = 0.67;
const COTTAGE_GLAZING_FRACTION = 0.35;
const COTTAGE_GLAZING_FRACTION2 = 0.7;
const COTTAGE_SILL_INSET = 4;
const COTTAGE_SILL_HEIGHT = 4;
const COTTAGE_SILL_SHADOW_OFFSET = 3;
const COTTAGE_FLOWER_STRIDE = 5;
const COTTAGE_REFLECTION_WIDTH_FRACTION = 0.28;
const COTTAGE_REFLECTION_ALPHA = 0.3;

// Tower window
const TOWER_ARCH_DIVISOR = 3;
const TOWER_KEYSTONE_HALF = 2;
const TOWER_KEYSTONE_WIDTH = 4;
const TOWER_SILL_INSET = 3;
const TOWER_SILL_HEIGHT = 4;
const TOWER_SILL_WIDTH_EXTRA = 6;
const TOWER_REFLECTION_WIDTH_FRACTION = 0.28;

// Shuttered window
const SHUTTER_INSET = 4;
const SHUTTER_WIDTH = 3;
const SHUTTER_SLAT_STRIDE = 4;
const SHUTTER_SILL_INSET = 2;
const SHUTTER_SILL_HEIGHT = 4;
const SHUTTER_SILL_SHADOW_OFFSET = 3;
const SHUTTER_SILL_WIDTH_EXTRA = 4;
const SHUTTER_REFLECTION_WIDTH_FRACTION = 0.32;

// Gable roof fractions
const GABLE_PEAK_HEIGHT_FRACTION = 2.5;
const GABLE_EAVE_SHADOW_HEIGHT = 3;
const GABLE_EAVE_SHADOW_OFFSET = 2;
const GABLE_RIDGE_DOT_HALF = 1;
const GABLE_RIDGE_DOT_WIDTH = 3;
const GABLE_RIDGE_DOT_HEIGHT = 4;

// Thatch roof fractions
const THATCH_EAVE_SHADOW_DEPTH = 6;
const THATCH_BAND_STRIDE = 5;
const THATCH_BAND_HEIGHT = 2;
const THATCH_BUNDLE_HASH_X = 7;
const THATCH_DRIP_FRINGE_INSET = 5;
const THATCH_DRIP_FRINGE_HEIGHT = 2;
const THATCH_SUN_SLOPE_FRACTION = 0.48;
const THATCH_BACK_BAND_STRIDE = 5;
const THATCH_BACK_BAND_START = 3;
const THATCH_MID_BAND_STRIDE = 5;
const THATCH_MID_BAND_START = 3;
const THATCH_RIDGE_FRACTION = 0.46;
const THATCH_RIDGE_VALLEY_HEIGHT = 3;
const THATCH_RIDGE_VALLEY_OFFSET = 2;
const THATCH_CHIMNEY_HASH_X = 11;
const THATCH_CHIMNEY_HASH_Y = 7;
const THATCH_CHIMNEY_STRIDE = 19;
const THATCH_CHIMNEY_TARGET_MOD = 5;
const THATCH_CHIMNEY_X_FRACTION = 0.48;
const THATCH_CHIMNEY_Y_FRACTION = 0.28;
const THATCH_CHIMNEY_INSET = 3;
const THATCH_CHIMNEY_WIDTH = 7;
const THATCH_CHIMNEY_HEIGHT = 9;
const THATCH_CHIMNEY_DARK_SIDE_X = 5;
const THATCH_CHIMNEY_DARK_SIDE_WIDTH = 2;
const THATCH_CHIMNEY_CAP_WIDTH = 9;
const THATCH_CHIMNEY_CAP_HEIGHT = 2;
const THATCH_SMOKE_RADIUS = 3;
const THATCH_SMOKE_Y_OFFSET = 3;

// Slate roof fractions
const SLATE_EAVE_SHADOW_DEPTH = 6;
const SLATE_ROW_STRIDE = 6;
const SLATE_ROW_START = 7;
const SLATE_OFFSET_FRACTION = 0.5;
const SLATE_GUTTER_INSET = 4;
const SLATE_GUTTER_HEIGHT = 3;
const SLATE_SHEEN_FRACTION = 0.4;
const SLATE_BACK_ROW_STRIDE = 6;
const SLATE_BACK_ROW_START = 4;
const SLATE_MID_ROW_STRIDE = 6;
const SLATE_MID_ROW_START = 4;
const SLATE_RIDGE_FRACTION = 0.45;
const SLATE_RIDGE_VALLEY_HEIGHT = 3;
const SLATE_RIDGE_VALLEY_OFFSET = 2;
const SLATE_CHIMNEY_HASH_X = 13;
const SLATE_CHIMNEY_HASH_Y = 5;
const SLATE_CHIMNEY_STRIDE = 23;
const SLATE_CHIMNEY_TARGET = 7;
const SLATE_CHIMNEY_X_FRACTION = 0.42;
const SLATE_CHIMNEY_Y_FRACTION = 0.18;
const SLATE_CHIMNEY_INSET = 4;
const SLATE_CHIMNEY_WIDTH = 10;
const SLATE_CHIMNEY_HEIGHT = 13;
const SLATE_CHIMNEY_MORTAR_Y1 = 4;
const SLATE_CHIMNEY_MORTAR_Y2 = 8;
const SLATE_CHIMNEY_DARK_X = 8;
const SLATE_CHIMNEY_DARK_W = 2;
const SLATE_CHIMNEY_CAP_WIDTH = 12;
const SLATE_CHIMNEY_CAP_HEIGHT = 3;

// Red (terracotta) roof fractions
const RED_TILE_STRIDE = 7;
const RED_EAVE_SHADOW_DEPTH = 6;
const RED_EAVE_ROW_START = 7;
const RED_EAVE_HIGHLIGHT_OFFSET = 2;
const RED_EAVE_SHADOW_OFFSET = 5;
const RED_OFFSET_FRACTION = 0.5;
const RED_SHEEN_FRACTION = 0.48;
const RED_BACK_ROW_STRIDE = 7;
const RED_BACK_ROW_START = 5;
const RED_MID_ROW_STRIDE = 7;
const RED_RIDGE_FRACTION = 0.44;
const RED_RIDGE_VALLEY_HEIGHT = 3;
const RED_RIDGE_VALLEY_OFFSET = 2;
const RED_CHIMNEY_HASH_X = 9;
const RED_CHIMNEY_HASH_Y = 11;
const RED_CHIMNEY_STRIDE = 17;
const RED_CHIMNEY_TARGET = 3;
const RED_CHIMNEY_X_FRACTION = 0.54;
const RED_CHIMNEY_Y_FRACTION = 0.22;
const RED_CHIMNEY_INSET = 3;
const RED_CHIMNEY_WIDTH = 8;
const RED_CHIMNEY_HEIGHT = 10;
const RED_CHIMNEY_MORTAR_Y1 = 3;
const RED_CHIMNEY_MORTAR_Y2 = 6;
const RED_CHIMNEY_DARK_X = 6;
const RED_CHIMNEY_DARK_W = 2;
const RED_CHIMNEY_DARK_SIDE_HEIGHT = 9;
const RED_CHIMNEY_CAP_WIDTH = 10;
const RED_CHIMNEY_CAP_HEIGHT = 2;
const RED_SMOKE_RADIUS = 3;
const RED_SMOKE_CX_OFFSET = 4;
const RED_SMOKE_Y_OFFSET = 3;

// Green (mossy) roof fractions
const GREEN_EAVE_SHADOW_DEPTH = 6;
const GREEN_TUFT_HASH_X = 7;
const GREEN_TUFT_HASH_Y = 11;
const GREEN_TUFT_STRIDE = 5;
const GREEN_TUFT_X_FRACTION = 0.4;
const GREEN_TUFT_Y_FRACTION = 0.55;
const GREEN_TUFT_RADIUS_FRACTION = 0.28;
const GREEN_HORIZONTAL_Y1_FRACTION = 0.4;
const GREEN_HORIZONTAL_Y2_FRACTION = 0.7;
const GREEN_MOSS_VERTICAL_STRIDE = 5;
const GREEN_MOSS_INNER_OFFSET = 2;
const GREEN_SHEEN_FRACTION = 0.48;
const GREEN_BACK_X_FRACTION = 0.5;
const GREEN_MID_TUFT_STRIDE = 5;
const GREEN_MID_TUFT_X_FRACTION = 0.4;
const GREEN_MID_TUFT_Y_FRACTION = 0.5;
const GREEN_MID_TUFT_RADIUS_FRACTION = 0.3;
const GREEN_MID_TUFT2_HASH_X = 3;
const GREEN_MID_TUFT2_HASH_Y = 13;
const GREEN_MID_TUFT2_STRIDE = 7;
const GREEN_MID_TUFT2_X_FRACTION = 0.65;
const GREEN_MID_TUFT2_Y_FRACTION = 0.3;
const GREEN_MID_TUFT2_RADIUS_FRACTION = 0.22;
const GREEN_RIDGE_FRACTION = 0.46;
const GREEN_RIDGE_VALLEY_HEIGHT = 3;
const GREEN_RIDGE_VALLEY_OFFSET = 2;

// Circus tent fractions

// Metal wall

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
        ctx.fillRect(sx, sy + ts - WALL_FOUNDATION_HEIGHT, ts, WALL_FOUNDATION_HEIGHT);

        if (isCottage) {
          // Half-timber: dark oak beams on plaster
          ctx.fillStyle = '#3e2410';
          ctx.fillRect(sx, sy + Math.floor(ts * TIMBER_BEAM_Y_FRACTION), ts, 2);
          ctx.fillRect(
            sx + Math.floor(ts * TIMBER_VERT_X1_FRACTION),
            sy,
            2,
            ts - WALL_FOUNDATION_HEIGHT,
          );
          ctx.fillRect(
            sx + Math.floor(ts * TIMBER_VERT_X2_FRACTION),
            sy,
            2,
            ts - WALL_FOUNDATION_HEIGHT,
          );
        } else if (isTower) {
          // Dressed stone: large regular blocks
          ctx.fillStyle = '#7a7268';
          ctx.fillRect(sx, sy + Math.floor(ts * STONE_MORTAR_Y1_FRACTION), ts, 1);
          ctx.fillRect(sx, sy + Math.floor(ts * STONE_MORTAR_Y2_FRACTION), ts, 1);
          const bOff = ty % 2 === 0 ? 0 : Math.floor(ts * STONE_MORTAR_OFFSET_FRACTION);
          ctx.fillRect(
            sx + ((Math.floor(ts * STONE_MORTAR_OFFSET_FRACTION) + bOff) % ts),
            sy,
            1,
            Math.floor(ts * STONE_MORTAR_Y1_FRACTION),
          );
          ctx.fillRect(
            sx + (bOff % ts),
            sy + Math.floor(ts * STONE_MORTAR_Y1_FRACTION) + 1,
            1,
            Math.floor(ts * STONE_MORTAR_SECTION_FRACTION) - 1,
          );
          ctx.fillRect(
            sx + ((Math.floor(ts * STONE_MORTAR_OFFSET_FRACTION) + bOff) % ts),
            sy + Math.floor(ts * STONE_MORTAR_Y2_FRACTION) + 1,
            1,
            ts - Math.floor(ts * STONE_MORTAR_Y2_FRACTION) - STONE_MORTAR_GAP,
          );
        } else if (isMerchant) {
          // Painted plaster: decorative trim bands
          ctx.fillStyle = '#b07848';
          ctx.fillRect(
            sx,
            sy + Math.floor(ts * MERCHANT_TRIM_Y1_FRACTION),
            ts,
            MERCHANT_TRIM_HEIGHT,
          );
          ctx.fillRect(sx, sy + ts - MERCHANT_TRIM_Y2_OFFSET, ts, MERCHANT_TRIM_HEIGHT);
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
          const stripeW = Math.max(
            CIRCUS_STRIPE_MIN_WIDTH,
            Math.floor(ts * CIRCUS_STRIPE_WIDTH_FRACTION),
          );
          for (let si = 0; si < ts; si += stripeW * 2) {
            ctx.fillStyle = stripeColor;
            ctx.fillRect(sx + si, sy, stripeW, ts - WALL_FOUNDATION_HEIGHT);
          }
          // Gold trim at top
          ctx.fillStyle = '#ffcc22';
          ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);
        } else {
          // Rough stone: irregular coursing
          ctx.fillStyle = '#7a7060';
          ctx.fillRect(sx, sy + Math.floor(ts * ROUGH_STONE_MORTAR_Y1_FRACTION), ts, 1);
          ctx.fillRect(sx, sy + Math.floor(ts * ROUGH_STONE_MORTAR_Y2_FRACTION), ts, 1);
          const rBx =
            (tx * ROUGH_STONE_HASH_X + ty * ROUGH_STONE_HASH_Y) %
            Math.floor(ts * ROUGH_STONE_HALF_FRACTION);
          ctx.fillRect(sx + rBx, sy, 1, Math.floor(ts * ROUGH_STONE_MORTAR_Y1_FRACTION));
        }

        // Window on non-corner tiles
        const wallE2 = structure[ty]?.[tx + 1]?.type === BUILDING_WALL;
        const wallW2 = structure[ty]?.[tx - 1]?.type === BUILDING_WALL;
        if (wallE2 && wallW2 && tx % 2 === 1) {
          const ww = Math.floor(ts * WINDOW_WIDTH_FRACTION);
          const wh = Math.floor(ts * WINDOW_HEIGHT_FRACTION);
          const wx = sx + Math.floor((ts - ww) / 2);
          const wy = sy + Math.floor(ts * WINDOW_TOP_FRACTION);
          if (isCottage) {
            // Arched leaded window
            // Outer stone frame
            ctx.fillStyle = '#3a2010';
            ctx.fillRect(wx - COTTAGE_SILL_INSET, wy, ww + COTTAGE_SILL_HEIGHT * 2, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2 + COTTAGE_SILL_INSET, Math.PI, 0);
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
              wx + Math.floor(ww * COTTAGE_MUNTINS_Y1_FRACTION),
              wy - Math.floor(ww / 2),
              1,
              wh + Math.floor(ww / 2),
            );
            ctx.fillRect(
              wx + Math.floor(ww * COTTAGE_MUNTINS_Y2_FRACTION),
              wy - Math.floor(ww / 2),
              1,
              wh + Math.floor(ww / 2),
            );
            ctx.fillRect(wx, wy + Math.floor(wh * COTTAGE_GLAZING_FRACTION), ww, 1);
            ctx.fillRect(wx, wy + Math.floor(wh * COTTAGE_GLAZING_FRACTION2), ww, 1);
            // Glass reflection glint
            ctx.fillStyle = `rgba(255,255,255,${COTTAGE_REFLECTION_ALPHA})`;
            ctx.fillRect(wx + 1, wy + 1, Math.floor(ww * COTTAGE_REFLECTION_WIDTH_FRACTION), 1);
            // Wide stone sill with perspective shadow
            ctx.fillStyle = '#c8a870';
            ctx.fillRect(
              wx - COTTAGE_SILL_INSET,
              wy + wh,
              ww + COTTAGE_SILL_HEIGHT * 2,
              COTTAGE_SILL_HEIGHT,
            );
            ctx.fillStyle = '#a88858';
            ctx.fillRect(
              wx - COTTAGE_SILL_INSET,
              wy + wh + COTTAGE_SILL_SHADOW_OFFSET,
              ww + COTTAGE_SILL_HEIGHT * 2,
              1,
            ); // bottom shadow
            ctx.fillStyle = '#e0c090';
            ctx.fillRect(wx - COTTAGE_SILL_INSET, wy + wh, ww + COTTAGE_SILL_HEIGHT * 2, 1); // top highlight
          } else if (isTower) {
            // Stone arch with keystone
            const archH = Math.floor(ww / TOWER_ARCH_DIVISOR);
            ctx.fillStyle = '#888078';
            ctx.fillRect(wx - COTTAGE_SILL_INSET, wy, ww + COTTAGE_SILL_HEIGHT * 2, wh);
            ctx.beginPath();
            ctx.arc(wx + ww / 2, wy, ww / 2 + COTTAGE_SILL_INSET, Math.PI, 0);
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
            ctx.fillRect(
              wx + Math.floor(ww / 2) - TOWER_KEYSTONE_HALF,
              wy - archH,
              TOWER_KEYSTONE_WIDTH,
              archH,
            );
            // Mullion + horizontal bar
            ctx.fillStyle = '#8898a8';
            ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
            ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
            // Glass reflection
            ctx.fillStyle = 'rgba(255,255,255,0.20)';
            ctx.fillRect(wx + 1, wy + 1, Math.floor(ww * TOWER_REFLECTION_WIDTH_FRACTION), 1);
            // Stone sill with depth
            ctx.fillStyle = '#a0a098';
            ctx.fillRect(
              wx - TOWER_SILL_INSET,
              wy + wh,
              ww + TOWER_SILL_WIDTH_EXTRA,
              TOWER_SILL_HEIGHT,
            );
            ctx.fillStyle = '#c0beb8';
            ctx.fillRect(wx - TOWER_SILL_INSET, wy + wh, ww + TOWER_SILL_WIDTH_EXTRA, 1);
            ctx.fillStyle = '#707068';
            ctx.fillRect(
              wx - TOWER_SILL_INSET,
              wy + wh + TOWER_SILL_HEIGHT - 1,
              ww + TOWER_SILL_WIDTH_EXTRA,
              1,
            );
          } else {
            // Shuttered window
            ctx.fillStyle = isMerchant ? '#5a3820' : '#4a3820';
            ctx.fillRect(wx - SHUTTER_INSET, wy, SHUTTER_WIDTH, wh);
            ctx.fillRect(wx + ww + 1, wy, SHUTTER_WIDTH, wh);
            ctx.fillStyle = isMerchant ? '#7a4a28' : '#6a4a28';
            for (let sl = wy + COTTAGE_SILL_INSET; sl < wy + wh; sl += SHUTTER_SLAT_STRIDE) {
              ctx.fillRect(wx - SHUTTER_INSET, sl, SHUTTER_WIDTH, 1);
              ctx.fillRect(wx + ww + 1, sl, SHUTTER_WIDTH, 1);
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
            ctx.fillRect(wx + 1, wy + 1, Math.floor(ww * SHUTTER_REFLECTION_WIDTH_FRACTION), 1);
            // Deep sill with perspective shadow + highlight
            ctx.fillStyle = isMerchant ? '#c09060' : '#b0a090';
            ctx.fillRect(
              wx - SHUTTER_SILL_INSET,
              wy + wh,
              ww + SHUTTER_SILL_WIDTH_EXTRA,
              SHUTTER_SILL_HEIGHT,
            );
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(
              wx - SHUTTER_SILL_INSET,
              wy + wh + SHUTTER_SILL_SHADOW_OFFSET,
              ww + SHUTTER_SILL_WIDTH_EXTRA,
              1,
            ); // sill bottom shadow
            ctx.fillStyle = isMerchant ? '#e0c090' : '#d0c0a0';
            ctx.fillRect(wx - SHUTTER_SILL_INSET, wy + wh, ww + SHUTTER_SILL_WIDTH_EXTRA, 1); // sill top highlight
            if (isMerchant) {
              // Flower box
              ctx.fillStyle = '#4a2810';
              ctx.fillRect(
                wx - SHUTTER_SILL_INSET,
                wy + wh + SHUTTER_SILL_HEIGHT,
                ww + SHUTTER_SILL_WIDTH_EXTRA,
                WALL_FOUNDATION_HEIGHT,
              );
              ctx.fillStyle = '#3a6820';
              for (let fi = wx; fi < wx + ww; fi += COTTAGE_FLOWER_STRIDE) {
                ctx.fillRect(fi + 1, wy + wh + COTTAGE_FLOWER_STRIDE, 2, 2);
              }
              ctx.fillStyle = '#e04848';
              ctx.fillRect(wx + 1, wy + wh + SHUTTER_SILL_HEIGHT, 2, 2);
              ctx.fillStyle = '#e8b020';
              ctx.fillRect(wx + Math.floor(ww / 2), wy + wh + SHUTTER_SILL_HEIGHT, 2, 2);
            }
          }
        }
        // Cornice (lit top edge + subtle shadow below)
        ctx.fillStyle = litTop;
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(sx, sy + WALL_LIT_TOP_HEIGHT, ts, WALL_CORNICE_SHADOW_DEPTH);
      } else if (intS) {
        // North-facing back wall — draw wall base, then a peaked gable roof
        // extending ABOVE the tile into the screen space north of the building.
        // Tiles rendered before this one (grass/road) are correctly overpainted.
        ctx.fillStyle = '#5a5048';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#4a4038';
        ctx.fillRect(sx, sy + Math.floor(ts * STONE_MORTAR_OFFSET_FRACTION), ts, 1);
        ctx.fillStyle = '#6a6058';
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);

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
        const peakH = Math.floor(ts * GABLE_PEAK_HEIGHT_FRACTION); // gable peak height above wall top

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
            ctx.fillRect(
              Math.round(peakSX) - GABLE_RIDGE_DOT_HALF,
              sy - peakH,
              GABLE_RIDGE_DOT_WIDTH,
              GABLE_RIDGE_DOT_HEIGHT,
            );
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
          ctx.fillRect(sx, sy - GABLE_EAVE_SHADOW_HEIGHT, ts, GABLE_EAVE_SHADOW_HEIGHT);
          ctx.fillStyle = 'rgba(0,0,0,0.50)';
          ctx.fillRect(sx, sy - GABLE_EAVE_SHADOW_OFFSET, ts, GABLE_EAVE_SHADOW_OFFSET);
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
        ctx.fillRect(sx, sy, ts, THATCH_EAVE_SHADOW_DEPTH); // eave overhang shadow
        ctx.fillStyle = '#a07820';
        for (
          let gy = THATCH_EAVE_SHADOW_DEPTH + 1;
          gy < ts - THATCH_BACK_BAND_START;
          gy += THATCH_BAND_STRIDE
        ) {
          ctx.fillRect(sx, sy + gy, ts, THATCH_BAND_HEIGHT); // straw bands
        }
        ctx.fillStyle = '#b08828';
        const bxE = (((tx * THATCH_BUNDLE_HASH_X) % ts) + ts) % ts;
        ctx.fillRect(sx + bxE, sy + THATCH_EAVE_SHADOW_DEPTH, 1, ts - THATCH_CHIMNEY_HEIGHT); // straw bundle
        ctx.fillStyle = '#907018'; // eave drip fringe
        ctx.fillRect(sx, sy + ts - THATCH_DRIP_FRINGE_INSET, ts, THATCH_DRIP_FRINGE_HEIGHT);
        ctx.fillStyle = '#d0a838';
        ctx.fillRect(sx, sy + ts - WALL_FOUNDATION_HEIGHT, ts, THATCH_DRIP_FRINGE_HEIGHT);
        ctx.fillStyle = 'rgba(255,220,80,0.18)'; // sun-lit slope
        ctx.fillRect(
          sx,
          sy + THATCH_EAVE_SHADOW_DEPTH,
          ts,
          Math.floor(ts * THATCH_SUN_SLOPE_FRACTION),
        );
      } else if (thN) {
        // Back slope — deep shadow
        ctx.fillStyle = '#6a4e14';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#503c0c';
        for (let gy = THATCH_BACK_BAND_START; gy < ts; gy += THATCH_BACK_BAND_STRIDE) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        ctx.fillStyle = '#8a6420'; // slight ridge highlight at top
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);
      } else {
        // Middle / ridge zone
        ctx.fillStyle = '#b88830';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#9a7020';
        for (let gy = THATCH_MID_BAND_START; gy < ts; gy += THATCH_MID_BAND_STRIDE) {
          ctx.fillRect(sx, sy + gy, ts, THATCH_BAND_HEIGHT);
        }
        // Clean narrow ridge cap
        const thRidgeY = sy + Math.floor(ts * THATCH_RIDGE_FRACTION);
        ctx.fillStyle = '#7a5a10'; // shadow valley above ridge
        ctx.fillRect(sx, thRidgeY - THATCH_RIDGE_VALLEY_HEIGHT, ts, THATCH_RIDGE_VALLEY_HEIGHT);
        ctx.fillStyle = '#7a5a10'; // shadow valley below ridge
        ctx.fillRect(sx, thRidgeY + THATCH_RIDGE_VALLEY_OFFSET, ts, THATCH_RIDGE_VALLEY_HEIGHT);
        ctx.fillStyle = '#ffe060'; // bright ridge line
        ctx.fillRect(sx, thRidgeY, ts, THATCH_BAND_HEIGHT);
        ctx.fillStyle = '#fff088'; // apex highlight
        ctx.fillRect(sx, thRidgeY, ts, 1);
        ctx.fillStyle = '#c09838';
        const bxM = (((tx * THATCH_BUNDLE_HASH_X) % ts) + ts) % ts;
        ctx.fillRect(sx + bxM, sy, 1, ts); // straw bundle
        ctx.fillStyle = 'rgba(255,220,80,0.10)';
        ctx.fillRect(sx, sy, ts, thRidgeY - sy); // lit front half
        // Chimney (deterministic placement)
        if (
          (tx * THATCH_CHIMNEY_HASH_X + ty * THATCH_CHIMNEY_HASH_Y) % THATCH_CHIMNEY_STRIDE ===
          THATCH_CHIMNEY_TARGET_MOD
        ) {
          const chx = sx + Math.floor(ts * THATCH_CHIMNEY_X_FRACTION) - THATCH_CHIMNEY_INSET;
          const chy = sy + Math.floor(ts * THATCH_CHIMNEY_Y_FRACTION);
          ctx.fillStyle = '#4a3828';
          ctx.fillRect(chx, chy, THATCH_CHIMNEY_WIDTH, THATCH_CHIMNEY_HEIGHT);
          ctx.fillStyle = '#3a2818';
          ctx.fillRect(
            chx + THATCH_CHIMNEY_DARK_SIDE_X,
            chy + 1,
            THATCH_CHIMNEY_DARK_SIDE_WIDTH,
            THATCH_CHIMNEY_HEIGHT - 1,
          ); // dark side
          ctx.fillStyle = '#6a5840';
          ctx.fillRect(chx - 1, chy, THATCH_CHIMNEY_CAP_WIDTH, THATCH_CHIMNEY_CAP_HEIGHT); // cap
          ctx.fillStyle = 'rgba(200,200,200,0.32)';
          ctx.beginPath();
          ctx.arc(
            chx + THATCH_CHIMNEY_INSET,
            chy - THATCH_SMOKE_Y_OFFSET,
            THATCH_SMOKE_RADIUS,
            0,
            Math.PI * 2,
          );
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
        ctx.fillRect(sx, sy, ts, SLATE_EAVE_SHADOW_DEPTH); // eave shadow
        ctx.fillStyle = '#505e6e';
        for (let gy = SLATE_ROW_START; gy < ts - THATCH_BACK_BAND_START; gy += SLATE_ROW_STRIDE) {
          ctx.fillRect(sx, sy + gy, ts, 1); // slate tile rows
        }
        const sOff = ty % 2 === 0 ? 0 : Math.floor(ts * SLATE_OFFSET_FRACTION);
        ctx.fillStyle = '#586878';
        ctx.fillRect(
          sx + ((Math.floor(ts * SLATE_OFFSET_FRACTION) + sOff) % ts),
          sy + SLATE_EAVE_SHADOW_DEPTH,
          1,
          ts - THATCH_CHIMNEY_HEIGHT,
        );
        ctx.fillStyle = '#404e5e'; // gutter at bottom
        ctx.fillRect(sx, sy + ts - SLATE_GUTTER_INSET, ts, SLATE_GUTTER_HEIGHT);
        ctx.fillStyle = '#7888a0';
        ctx.fillRect(sx, sy + ts - SLATE_GUTTER_INSET, ts, 1);
        ctx.fillStyle = 'rgba(180,220,255,0.09)'; // sheen
        ctx.fillRect(sx, sy + SLATE_EAVE_SHADOW_DEPTH, ts, Math.floor(ts * SLATE_SHEEN_FRACTION));
      } else if (slN) {
        // Back slope — very dark
        ctx.fillStyle = '#343e4c';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#282e3a';
        for (let gy = SLATE_BACK_ROW_START; gy < ts; gy += SLATE_BACK_ROW_STRIDE) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        ctx.fillStyle = '#485868';
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);
      } else {
        // Middle / ridge — lead flashing
        ctx.fillStyle = '#7a8898';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#606e80';
        for (let gy = SLATE_MID_ROW_START; gy < ts; gy += SLATE_MID_ROW_STRIDE) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        // Clean narrow ridge cap
        const slRidgeY = sy + Math.floor(ts * SLATE_RIDGE_FRACTION);
        ctx.fillStyle = '#485868'; // shadow valleys
        ctx.fillRect(sx, slRidgeY - SLATE_RIDGE_VALLEY_HEIGHT, ts, SLATE_RIDGE_VALLEY_HEIGHT);
        ctx.fillRect(sx, slRidgeY + SLATE_RIDGE_VALLEY_OFFSET, ts, SLATE_RIDGE_VALLEY_HEIGHT);
        ctx.fillStyle = '#d8eeff'; // bright ridge
        ctx.fillRect(sx, slRidgeY, ts, THATCH_BAND_HEIGHT);
        ctx.fillStyle = '#f0f8ff'; // apex highlight
        ctx.fillRect(sx, slRidgeY, ts, 1);
        const sOff2 = ty % 2 === 0 ? 0 : Math.floor(ts * SLATE_OFFSET_FRACTION);
        ctx.fillStyle = '#6a7888';
        ctx.fillRect(sx + ((Math.floor(ts * SLATE_OFFSET_FRACTION) + sOff2) % ts), sy, 1, ts);
        ctx.fillStyle = '#9aaabb';
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT); // lit top
        // Chimney (brick, tower-style)
        if (
          (tx * SLATE_CHIMNEY_HASH_X + ty * SLATE_CHIMNEY_HASH_Y) % SLATE_CHIMNEY_STRIDE ===
          SLATE_CHIMNEY_TARGET
        ) {
          const chx = sx + Math.floor(ts * SLATE_CHIMNEY_X_FRACTION) - SLATE_CHIMNEY_INSET;
          const chy = sy + Math.floor(ts * SLATE_CHIMNEY_Y_FRACTION);
          ctx.fillStyle = '#7a6858';
          ctx.fillRect(chx, chy, SLATE_CHIMNEY_WIDTH, SLATE_CHIMNEY_HEIGHT);
          ctx.fillStyle = '#6a5848';
          ctx.fillRect(chx, chy + SLATE_CHIMNEY_MORTAR_Y1, SLATE_CHIMNEY_WIDTH, 1);
          ctx.fillRect(chx, chy + SLATE_CHIMNEY_MORTAR_Y2, SLATE_CHIMNEY_WIDTH, 1);
          ctx.fillStyle = '#5a4838';
          ctx.fillRect(
            chx + SLATE_CHIMNEY_DARK_X,
            chy + 1,
            SLATE_CHIMNEY_DARK_W,
            SLATE_CHIMNEY_HEIGHT - 1,
          ); // dark side
          ctx.fillStyle = '#908070';
          ctx.fillRect(chx - 1, chy, SLATE_CHIMNEY_CAP_WIDTH, SLATE_CHIMNEY_CAP_HEIGHT); // cap
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
        ctx.fillRect(sx, sy, ts, RED_EAVE_SHADOW_DEPTH); // eave shadow
        for (let gy = RED_EAVE_ROW_START; gy < ts - 2; gy += RED_TILE_STRIDE) {
          ctx.fillStyle = 'rgba(255,200,160,0.22)';
          ctx.fillRect(sx, sy + gy, ts, THATCH_BAND_HEIGHT);
          ctx.fillStyle = 'rgba(0,0,0,0.20)';
          ctx.fillRect(
            sx,
            sy + gy + RED_EAVE_HIGHLIGHT_OFFSET + THATCH_BACK_BAND_START,
            ts,
            THATCH_BAND_HEIGHT,
          );
        }
        const rOff2 = ty % 2 === 0 ? 0 : Math.floor(ts * RED_OFFSET_FRACTION);
        ctx.fillStyle = '#721e18';
        ctx.fillRect(
          sx + ((Math.floor(ts * RED_OFFSET_FRACTION) + rOff2) % ts),
          sy + RED_EAVE_SHADOW_DEPTH,
          1,
          ts - THATCH_CHIMNEY_HEIGHT,
        );
        ctx.fillStyle = '#5e1810'; // drip edge
        ctx.fillRect(sx, sy + ts - SLATE_GUTTER_INSET, ts, SLATE_GUTTER_HEIGHT);
        ctx.fillStyle = '#b83830';
        ctx.fillRect(sx, sy + ts - SLATE_GUTTER_INSET, ts, 1);
        ctx.fillStyle = 'rgba(255,140,60,0.16)'; // warm glow
        ctx.fillRect(sx, sy + RED_EAVE_SHADOW_DEPTH, ts, Math.floor(ts * RED_SHEEN_FRACTION));
      } else if (rrN) {
        // Back slope — very dark red
        ctx.fillStyle = '#4e1412';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#380e0c';
        for (let gy = RED_BACK_ROW_START; gy < ts; gy += RED_BACK_ROW_STRIDE) {
          ctx.fillRect(sx, sy + gy, ts, 1);
        }
        ctx.fillStyle = '#622018';
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);
      } else {
        // Middle / ridge — terracotta
        const redBase = ty % 2 === 0 ? '#b84838' : '#c05040';
        ctx.fillStyle = redBase;
        ctx.fillRect(sx, sy, ts, ts);
        for (let gy = 0; gy < ts; gy += RED_MID_ROW_STRIDE) {
          ctx.fillStyle = 'rgba(255,200,160,0.16)';
          ctx.fillRect(sx, sy + gy, ts, THATCH_BAND_HEIGHT);
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(sx, sy + gy + RED_EAVE_SHADOW_OFFSET, ts, THATCH_BAND_HEIGHT);
        }
        // Clean narrow ridge cap
        const rrRidgeY = sy + Math.floor(ts * RED_RIDGE_FRACTION);
        ctx.fillStyle = '#721e18'; // shadow valleys
        ctx.fillRect(sx, rrRidgeY - RED_RIDGE_VALLEY_HEIGHT, ts, RED_RIDGE_VALLEY_HEIGHT);
        ctx.fillRect(sx, rrRidgeY + RED_RIDGE_VALLEY_OFFSET, ts, RED_RIDGE_VALLEY_HEIGHT);
        ctx.fillStyle = '#ff8878'; // bright ridge
        ctx.fillRect(sx, rrRidgeY, ts, THATCH_BAND_HEIGHT);
        ctx.fillStyle = '#ffb0a0'; // apex highlight
        ctx.fillRect(sx, rrRidgeY, ts, 1);
        ctx.fillStyle = '#8a3028';
        const rOff3 = ty % 2 === 0 ? 0 : Math.floor(ts * RED_OFFSET_FRACTION);
        ctx.fillRect(sx + ((Math.floor(ts * RED_OFFSET_FRACTION) + rOff3) % ts), sy, 1, ts);
        ctx.fillStyle = 'rgba(255,160,80,0.16)';
        ctx.fillRect(sx, sy, ts, rrRidgeY - sy);
        // Chimney
        if (
          (tx * RED_CHIMNEY_HASH_X + ty * RED_CHIMNEY_HASH_Y) % RED_CHIMNEY_STRIDE ===
          RED_CHIMNEY_TARGET
        ) {
          const chx = sx + Math.floor(ts * RED_CHIMNEY_X_FRACTION) - RED_CHIMNEY_INSET;
          const chy = sy + Math.floor(ts * RED_CHIMNEY_Y_FRACTION);
          ctx.fillStyle = '#7a5040';
          ctx.fillRect(chx, chy, RED_CHIMNEY_WIDTH, RED_CHIMNEY_HEIGHT);
          ctx.fillStyle = '#6a3830';
          ctx.fillRect(chx, chy + RED_CHIMNEY_MORTAR_Y1, RED_CHIMNEY_WIDTH, 1);
          ctx.fillRect(chx, chy + RED_CHIMNEY_MORTAR_Y2, RED_CHIMNEY_WIDTH, 1);
          ctx.fillStyle = '#5a3020';
          ctx.fillRect(
            chx + RED_CHIMNEY_DARK_X,
            chy + 1,
            RED_CHIMNEY_DARK_W,
            RED_CHIMNEY_DARK_SIDE_HEIGHT,
          ); // dark side
          ctx.fillStyle = '#9a6050';
          ctx.fillRect(chx - 1, chy, RED_CHIMNEY_CAP_WIDTH, RED_CHIMNEY_CAP_HEIGHT); // cap
          ctx.fillStyle = 'rgba(200,200,200,0.28)';
          ctx.beginPath();
          ctx.arc(
            chx + RED_SMOKE_CX_OFFSET,
            chy - RED_SMOKE_Y_OFFSET,
            RED_SMOKE_RADIUS,
            0,
            Math.PI * 2,
          );
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
        ctx.fillRect(sx, sy, ts, GREEN_EAVE_SHADOW_DEPTH); // eave shadow
        if ((tx * GREEN_TUFT_HASH_X + ty * GREEN_TUFT_HASH_Y) % GREEN_TUFT_STRIDE === 0) {
          ctx.fillStyle = '#2a4c22';
          ctx.beginPath();
          ctx.arc(
            sx + Math.floor(ts * GREEN_TUFT_X_FRACTION),
            sy + Math.floor(ts * GREEN_TUFT_Y_FRACTION),
            Math.floor(ts * GREEN_TUFT_RADIUS_FRACTION),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.fillStyle = '#2a4c22';
        ctx.fillRect(sx, sy + Math.floor(ts * GREEN_HORIZONTAL_Y1_FRACTION), ts, 1);
        ctx.fillRect(sx, sy + Math.floor(ts * GREEN_HORIZONTAL_Y2_FRACTION), ts, 1);
        ctx.fillStyle = '#1e4018'; // hanging moss fringe
        for (
          let mx = sx + WALL_LIT_TOP_HEIGHT;
          mx < sx + ts - 1;
          mx += GREEN_MOSS_VERTICAL_STRIDE
        ) {
          ctx.fillRect(mx, sy + ts - GREEN_EAVE_SHADOW_DEPTH, 1, GREEN_EAVE_SHADOW_DEPTH);
          ctx.fillRect(
            mx + GREEN_MOSS_INNER_OFFSET,
            sy + ts - SLATE_GUTTER_INSET,
            1,
            SLATE_GUTTER_INSET,
          );
        }
        ctx.fillStyle = 'rgba(80,160,60,0.14)';
        ctx.fillRect(sx, sy + GREEN_EAVE_SHADOW_DEPTH, ts, Math.floor(ts * GREEN_SHEEN_FRACTION));
      } else if (rgN) {
        // Back slope — very dark green
        ctx.fillStyle = '#1c3214';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#142810';
        ctx.fillRect(sx, sy + Math.floor(ts * GREEN_BACK_X_FRACTION), ts, 1);
        ctx.fillStyle = '#284824';
        ctx.fillRect(sx, sy, ts, WALL_LIT_TOP_HEIGHT);
      } else {
        // Middle / ridge — moss
        ctx.fillStyle = '#4a7040';
        ctx.fillRect(sx, sy, ts, ts);
        if ((tx * GREEN_TUFT_HASH_X + ty * GREEN_TUFT_HASH_Y) % GREEN_MID_TUFT_STRIDE === 0) {
          ctx.fillStyle = '#3a5c30';
          ctx.beginPath();
          ctx.arc(
            sx + Math.floor(ts * GREEN_MID_TUFT_X_FRACTION),
            sy + Math.floor(ts * GREEN_MID_TUFT_Y_FRACTION),
            Math.floor(ts * GREEN_MID_TUFT_RADIUS_FRACTION),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        if (
          (tx * GREEN_MID_TUFT2_HASH_X + ty * GREEN_MID_TUFT2_HASH_Y) % GREEN_MID_TUFT2_STRIDE ===
          0
        ) {
          ctx.fillStyle = '#5a8850';
          ctx.beginPath();
          ctx.arc(
            sx + Math.floor(ts * GREEN_MID_TUFT2_X_FRACTION),
            sy + Math.floor(ts * GREEN_MID_TUFT2_Y_FRACTION),
            Math.floor(ts * GREEN_MID_TUFT2_RADIUS_FRACTION),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        // Clean narrow ridge cap
        const rgRidgeY = sy + Math.floor(ts * GREEN_RIDGE_FRACTION);
        ctx.fillStyle = '#1e4018'; // shadow valleys
        ctx.fillRect(sx, rgRidgeY - GREEN_RIDGE_VALLEY_HEIGHT, ts, GREEN_RIDGE_VALLEY_HEIGHT);
        ctx.fillRect(sx, rgRidgeY + GREEN_RIDGE_VALLEY_OFFSET, ts, GREEN_RIDGE_VALLEY_HEIGHT);
        ctx.fillStyle = '#90d870'; // bright ridge
        ctx.fillRect(sx, rgRidgeY, ts, THATCH_BAND_HEIGHT);
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
