import type { TileContent } from '../tileTypes';
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
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  SAFE_ROOM_GALLEY_FLOOR,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_LARDER,
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_RUG,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  MAP_TABLE,
  FLASH_WALL,
  PIGMENT_SHELF,
  INK_BENCH,
  GRINDING_SLAB,
  BROKEN_TABLE,
  BROKEN_CHAIR,
  BROKEN_BOOKSHELF,
  propSpriteState,
} from '../tileTypes';
import {
  counterEdges,
  drawCounterBackTile,
  drawCounterFrontFace,
} from '../../sprites/safeRoomCounter';
import {
  drawBannerTile,
  drawHerbRackTile,
  drawLanternTile,
  drawLarderTile,
  drawMenuBoardTile,
  drawRugTile,
  drawStoolTile,
  drawStoveTile,
  drawTableTile,
} from '../../sprites/safeRoomDecor';
import { drawGroundTile } from './groundTiles';
import { DUNGEON_GROUND } from '../dungeon/groundMaterials';
import { inferFloorType } from './helpers';
import { drawTerrainTile } from './terrainTiles';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import { drawTowerStaircaseTile } from '../../sprites/towerStaircase';
import { frameTime } from '../../utils';

/** Dispatches one furnishing to its own art, over ground already painted. */
function drawSafeRoomDecorProp(
  ctx: CanvasRenderingContext2D,
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
): void {
  switch (type) {
    case SAFE_ROOM_MENU_BOARD:
      drawMenuBoardTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_HERB_RACK:
      drawHerbRackTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_BANNER:
      drawBannerTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_LANTERN:
      drawLanternTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_STOVE:
      drawStoveTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_TABLE:
      drawTableTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_STOOL:
      drawStoolTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_LARDER:
      drawLarderTile(ctx, sx, sy, ts);
      return;
    case SAFE_ROOM_RUG:
      drawRugTile(ctx, sx, sy, ts, tx);
      return;
  }
}

/**
 * Paints whatever floor this prop is standing on, before the prop itself.
 *
 * A prop replaces its tile's type, so the ground under it has to be resolved
 * from a neighbour — without this the tile is a hole. Props drawn from a sprite
 * sheet skip it: those are in the decoration overlay, whose ground is already
 * laid by the chunk bake's base-only pass, and painting it twice would clip a
 * neighbouring prop's overhang out of this tile.
 */
function drawFloorBeneath(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const floorType = inferFloorType(structure, tx, ty);
  if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
    drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
  }
}

/**
 * One length of timber lying on the floor, rotated about its own centre, with a
 * pale raw break at the far end.
 *
 * The break is what makes a plank read as *snapped* rather than as a board
 * someone put down: at 32 px the silhouette alone is a brown smudge either way,
 * and the light end-grain is the only cue that survives the size.
 */
function drawFallenPlank(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  length: number,
  thickness: number,
  angleRadians: number,
  fill: string,
): void {
  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.rotate(angleRadians);
  const halfLength = length / 2;
  const halfThickness = thickness / 2;
  ctx.fillStyle = WRECK_SHADOW;
  ctx.fillRect(-halfLength, -halfThickness + thickness * WRECK_SHADOW_DROP, length, thickness);
  ctx.fillStyle = fill;
  ctx.fillRect(-halfLength, -halfThickness, length, thickness);
  ctx.fillStyle = WRECK_SPLINTER;
  const splinter = length * WRECK_SPLINTER_FRACTION;
  ctx.fillRect(halfLength - splinter, -halfThickness, splinter, thickness);
  ctx.restore();
}

/**
 * The top-left tile and tile span of the stair block that `(tx, ty)` belongs to.
 *
 * Measured from the grid rather than read from a constant, so the renderer needs
 * no knowledge of where a staircase was placed or how big it was made — only that
 * a contiguous run of same-typed stair tiles is one staircase. The tutorial map's
 * single-tile stairwell and the tower's larger blocks both come out right.
 */
function stairBlockBounds(
  structure: TileContent[][],
  type: number,
  tx: number,
  ty: number,
): { x: number; y: number; span: number } {
  let x = tx;
  let y = ty;
  while (structure[y]?.[x - 1]?.type === type) x--;
  while (structure[y - 1]?.[x]?.type === type) y--;
  let span = 1;
  while (structure[y]?.[x + span]?.type === type && structure[y + span]?.[x]?.type === type) span++;
  return { x, y, span };
}

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
    // Interior stairs — one spiral staircase spread across its whole tile block
    case STAIRS_UP:
    case STAIRS_DOWN: {
      // The room's own floor first: the stair is masonry standing in the tower,
      // so its tiles must be the same stone as every tile around them.
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      const stair = stairBlockBounds(structure, type, tx, ty);
      drawTowerStaircaseTile(ctx, type === STAIRS_UP, stair, sx, sy, ts, tx, ty);
      return true;
    }

    // Table — context-aware: seamless horizontal surface across adjacent TABLE tiles
    case TABLE: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);

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

    // Bookshelf — sprite only; the ground under it is drawn by the baseOnly
    // chunk pass, as for the BARREL case below. Smashable, so it picks its wear
    // state from the tile's damage stage the same way the other props do.
    case BOOKSHELF: {
      drawSpriteKey(
        ctx,
        'bookshelf',
        propSpriteState(structure[ty][tx].damageStage),
        0,
        sx,
        sy,
        ts,
      );
      return true;
    }

    // Bed — context-aware 2×2 block: top-left=pillow, top-right=pillow, bottom=blanket
    case BED: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);

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
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);

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

    // Barrel — sprite only; the ground under it is drawn by the baseOnly
    // chunk pass, and repainting it here would clip a neighbouring prop's
    // overhang into this tile.
    case BARREL: {
      drawSpriteKey(ctx, 'barrel', propSpriteState(structure[ty][tx].damageStage), 0, sx, sy, ts);
      return true;
    }

    // Rug — decorative woven rug (walkable)
    case RUG: {
      // Floor beneath first
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);

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
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);

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

    /*
     * The three wrecks. All of their art stays inside the tile they block, so a
     * repaired piece appears exactly where the rubble was and no wreck overhangs
     * floor the player is standing on.
     */

    case BROKEN_TABLE: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      const cx = sx + ts / 2;
      const cy = sy + ts / 2;
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_TABLE_NEAR_PLANK_DX,
        cy + ts * BROKEN_TABLE_NEAR_PLANK_DY,
        ts * BROKEN_TABLE_NEAR_PLANK_LENGTH,
        ts * BROKEN_TABLE_PLANK_THICKNESS,
        BROKEN_TABLE_NEAR_PLANK_ANGLE,
        WRECK_WOOD,
      );
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_TABLE_FAR_PLANK_DX,
        cy + ts * BROKEN_TABLE_FAR_PLANK_DY,
        ts * BROKEN_TABLE_FAR_PLANK_LENGTH,
        ts * BROKEN_TABLE_PLANK_THICKNESS,
        BROKEN_TABLE_FAR_PLANK_ANGLE,
        WRECK_WOOD_MID,
      );
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_TABLE_LEG_DX,
        cy + ts * BROKEN_TABLE_LEG_DY,
        ts * BROKEN_TABLE_LEG_LENGTH,
        ts * BROKEN_TABLE_LEG_THICKNESS,
        BROKEN_TABLE_LEG_ANGLE,
        WRECK_DARK_WOOD,
      );
      return true;
    }

    case BROKEN_CHAIR: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      const cx = sx + ts / 2;
      const cy = sy + ts / 2;
      // The seat is a panel rather than a plank: it is the one piece still in
      // one piece, and drawing it with a broken end would say otherwise.
      ctx.save();
      ctx.translate(cx, cy + ts * BROKEN_CHAIR_SEAT_DY);
      ctx.rotate(BROKEN_CHAIR_SEAT_ANGLE);
      const seatW = ts * BROKEN_CHAIR_SEAT_WIDTH;
      const seatH = ts * BROKEN_CHAIR_SEAT_HEIGHT;
      ctx.fillStyle = WRECK_SHADOW;
      ctx.fillRect(-seatW / 2, -seatH / 2 + seatH * WRECK_SHADOW_DROP, seatW, seatH);
      ctx.fillStyle = WRECK_WOOD;
      ctx.fillRect(-seatW / 2, -seatH / 2, seatW, seatH);
      ctx.fillStyle = WRECK_WOOD_MID;
      ctx.fillRect(-seatW / 2, -seatH / 2, seatW, seatH * BROKEN_CHAIR_SEAT_EDGE);
      ctx.restore();
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_CHAIR_SLAT_DX,
        cy + ts * BROKEN_CHAIR_SLAT_DY,
        ts * BROKEN_CHAIR_SLAT_LENGTH,
        ts * BROKEN_CHAIR_SLAT_THICKNESS,
        BROKEN_CHAIR_SLAT_ANGLE,
        WRECK_WOOD_MID,
      );
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_CHAIR_LEG_DX,
        cy + ts * BROKEN_CHAIR_LEG_DY,
        ts * BROKEN_CHAIR_LEG_LENGTH,
        ts * BROKEN_CHAIR_LEG_THICKNESS,
        BROKEN_CHAIR_LEG_ANGLE,
        WRECK_DARK_WOOD,
      );
      return true;
    }

    case BROKEN_BOOKSHELF: {
      // Unlike the intact shelf — a sprite in the decoration overlay, whose
      // ground the base pass lays for it — this heap is drawn flat here, so it
      // has to paint its own floor.
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      const cx = sx + ts / 2;
      const cy = sy + ts / 2;
      const backX = sx + ts * BROKEN_SHELF_BACK_INSET;
      const backY = sy + ts * BROKEN_SHELF_BACK_TOP;
      const backW = ts - ts * BROKEN_SHELF_BACK_INSET * 2;
      const backH = ts * BROKEN_SHELF_BACK_HEIGHT;
      ctx.fillStyle = WRECK_SHADOW;
      ctx.fillRect(backX, backY + backH * WRECK_SHADOW_DROP, backW, backH);
      ctx.fillStyle = WRECK_DARK_WOOD;
      ctx.fillRect(backX, backY, backW, backH);
      ctx.fillStyle = WRECK_SPLINTER;
      ctx.fillRect(
        backX + backW * BROKEN_SHELF_TEAR_START,
        backY,
        backW * BROKEN_SHELF_TEAR_WIDTH,
        backH,
      );
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_SHELF_UPPER_BOARD_DX,
        cy + ts * BROKEN_SHELF_UPPER_BOARD_DY,
        ts * BROKEN_SHELF_UPPER_BOARD_LENGTH,
        ts * BROKEN_SHELF_BOARD_THICKNESS,
        BROKEN_SHELF_UPPER_BOARD_ANGLE,
        WRECK_WOOD,
      );
      drawFallenPlank(
        ctx,
        cx + ts * BROKEN_SHELF_LOWER_BOARD_DX,
        cy + ts * BROKEN_SHELF_LOWER_BOARD_DY,
        ts * BROKEN_SHELF_LOWER_BOARD_LENGTH,
        ts * BROKEN_SHELF_BOARD_THICKNESS,
        BROKEN_SHELF_LOWER_BOARD_ANGLE,
        WRECK_WOOD_MID,
      );
      // Spilled books: the only saturated colour in the tile, and what tells a
      // heap of boards apart from a heap of boards that used to be a shelf.
      SPILLED_BOOKS.forEach((book, index) => {
        ctx.fillStyle = SPILLED_BOOK_COLORS[index % SPILLED_BOOK_COLORS.length];
        ctx.fillRect(
          sx + ts * book.x,
          sy + ts * book.y,
          ts * SPILLED_BOOK_WIDTH,
          ts * SPILLED_BOOK_HEIGHT,
        );
      });
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

    // Safe-room service counter — front bar, back bench, and the galley strip
    // between them. All three paint the hearth paving first rather than the
    // room's own tile: the sliver of ground each one leaves showing is on the
    // *kitchen* side of the counter, so the three tiles read as one unit instead
    // of a counter with a stripe of dining-room floor behind it. That is a
    // property of the map now — `DUNGEON_GROUND` maps all three types to
    // `bopca_hearth` — so the base is the ordinary ground pass.
    case SAFE_ROOM_COUNTER: {
      drawGroundTile(ctx, DUNGEON_GROUND, structure, sx, sy, ts, tx, ty);
      drawCounterFrontFace(ctx, sx, sy, ts, counterEdges(structure, SAFE_ROOM_COUNTER, tx, ty));
      return true;
    }

    case SAFE_ROOM_COUNTER_BACK: {
      drawGroundTile(ctx, DUNGEON_GROUND, structure, sx, sy, ts, tx, ty);
      drawCounterBackTile(
        ctx,
        sx,
        sy,
        ts,
        counterEdges(structure, SAFE_ROOM_COUNTER_BACK, tx, ty),
        tx,
      );
      return true;
    }

    case SAFE_ROOM_GALLEY_FLOOR: {
      drawGroundTile(ctx, DUNGEON_GROUND, structure, sx, sy, ts, tx, ty);
      return true;
    }

    // The stove is part of the counter run rather than a piece of loose
    // furniture: the layout stands it against the galley, and `DUNGEON_GROUND`
    // maps it to `bopca_hearth` so it continues the station's own paving instead
    // of cutting a hole of dining-room floor into it.
    case SAFE_ROOM_STOVE: {
      drawGroundTile(ctx, DUNGEON_GROUND, structure, sx, sy, ts, tx, ty);
      drawSafeRoomDecorProp(ctx, type, sx, sy, ts, tx);
      return true;
    }

    // The safe room's loose furnishings, which paint the floor they were stamped
    // over. `drawFloorBeneath` rather than the hearth palette because a safe room
    // is no longer only a dungeon room: the same furnishings now stand on a town
    // interior's boards or rushes, and `DUNGEON_GROUND` has no material for those
    // floor types — it returned without drawing at all, leaving a black tile.
    case SAFE_ROOM_MENU_BOARD:
    case SAFE_ROOM_HERB_RACK:
    case SAFE_ROOM_BANNER:
    case SAFE_ROOM_LANTERN:
    case SAFE_ROOM_TABLE:
    case SAFE_ROOM_STOOL:
    case SAFE_ROOM_LARDER:
    case SAFE_ROOM_RUG: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      drawSafeRoomDecorProp(ctx, type, sx, sy, ts, tx);
      return true;
    }

    // A pell: a post driven into the floor, wrapped in straw and sacking, and
    // hacked about. Drawn well inside its own tile — a prop wider than the tile
    // it blocks lets the player stand inside it.
    case TRAINING_DUMMY: {
      const midX = sx + ts / 2;
      const postWidth = Math.max(2, Math.floor(ts * DUMMY_POST_WIDTH_FRACTION));
      const bodyWidth = Math.floor(ts * DUMMY_BODY_WIDTH_FRACTION);
      const bodyTop = sy + Math.floor(ts * DUMMY_BODY_TOP_FRACTION);
      const bodyHeight = Math.floor(ts * DUMMY_BODY_HEIGHT_FRACTION);

      const headRadius = Math.max(2, Math.floor(ts * DUMMY_HEAD_RADIUS_FRACTION));
      ctx.fillStyle = PROP_CONTACT_SHADOW;
      ctx.fillRect(midX - bodyWidth / 2, sy + ts - 3, bodyWidth, 2);
      ctx.fillStyle = TIMBER_DARK;
      ctx.fillRect(midX - postWidth / 2, sy + 1, postWidth, ts - 3);
      const armY = bodyTop + Math.floor(ts * DUMMY_ARM_DROP_FRACTION);
      ctx.fillRect(midX - bodyWidth / 2, armY, bodyWidth, Math.max(2, postWidth - 1));

      // The head is what stops the pell reading as a signboard on a stick: a
      // torso alone is a rectangle, and a rectangle at 32px is a notice.
      ctx.fillStyle = STRAW_MID;
      ctx.beginPath();
      ctx.arc(midX, bodyTop, headRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(midX - bodyWidth / 2, bodyTop + headRadius, bodyWidth, bodyHeight);
      ctx.fillStyle = SACKING_DARK;
      ctx.fillRect(midX - bodyWidth / 2, bodyTop + headRadius, bodyWidth, 2);
      ctx.fillRect(midX - bodyWidth / 2, bodyTop + headRadius + bodyHeight - 3, bodyWidth, 2);
      ctx.fillStyle = STRAW_LIGHT;
      ctx.fillRect(midX - bodyWidth / 2, bodyTop + headRadius, 1, bodyHeight);
      // The cuts are the point: an unhacked pell is a scarecrow.
      ctx.strokeStyle = DUMMY_HACK_MARK;
      ctx.lineWidth = 1;
      for (let cut = 0; cut < DUMMY_HACK_COUNT; cut++) {
        const cutY =
          bodyTop + headRadius + Math.floor((bodyHeight * (cut + 1)) / (DUMMY_HACK_COUNT + 1));
        ctx.beginPath();
        ctx.moveTo(midX - bodyWidth / 2 + 1, cutY + 2);
        ctx.lineTo(midX + bodyWidth / 2 - 2, cutY - 2);
        ctx.stroke();
      }
      return true;
    }

    // An angled rack of spears and practice blades, standing against the wall.
    case WEAPON_RACK: {
      const frameLeft = sx + Math.floor(ts * RACK_SIDE_INSET_FRACTION);
      const frameRight = sx + ts - Math.floor(ts * RACK_SIDE_INSET_FRACTION);
      const railY = sy + Math.floor(ts * RACK_RAIL_TOP_FRACTION);
      const footY = sy + ts - 3;

      ctx.fillStyle = PROP_CONTACT_SHADOW;
      ctx.fillRect(frameLeft, footY + 1, frameRight - frameLeft, 2);
      // Shafts first, frame over them, so the rack reads as holding the spears
      // rather than as standing behind a bundle of sticks.
      for (let shaft = 0; shaft < RACK_SHAFT_COUNT; shaft++) {
        const baseX = frameLeft + ((shaft + 1) * (frameRight - frameLeft)) / (RACK_SHAFT_COUNT + 1);
        const lean = (shaft - (RACK_SHAFT_COUNT - 1) / 2) * ts * RACK_SHAFT_LEAN_FRACTION;
        ctx.strokeStyle = TIMBER_MID;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(baseX, footY);
        ctx.lineTo(baseX + lean, sy + 2);
        ctx.stroke();
        ctx.fillStyle = STEEL_LIGHT;
        ctx.fillRect(baseX + lean - 1, sy + 2, 3, Math.floor(ts * RACK_HEAD_HEIGHT_FRACTION));
      }
      ctx.fillStyle = TIMBER_DARK;
      ctx.fillRect(frameLeft, railY, frameRight - frameLeft, 3);
      ctx.fillRect(frameLeft, railY, 2, footY - railY);
      ctx.fillRect(frameRight - 2, railY, 2, footY - railY);
      ctx.fillStyle = TIMBER_HIGHLIGHT;
      ctx.fillRect(frameLeft, railY, frameRight - frameLeft, 1);
      return true;
    }

    // The garrison's standing orders, nailed up in layers. Hugs the wall behind
    // it, so the art sits in the tile's upper band rather than centred.
    case MUSTER_BOARD: {
      const boardLeft = sx + Math.floor(ts * BOARD_SIDE_INSET_FRACTION);
      const boardWidth = ts - Math.floor(ts * BOARD_SIDE_INSET_FRACTION) * 2;
      const boardTop = sy + Math.floor(ts * BOARD_TOP_FRACTION);
      const boardHeight = Math.floor(ts * BOARD_HEIGHT_FRACTION);

      ctx.fillStyle = TIMBER_DARK;
      ctx.fillRect(boardLeft, boardTop, boardWidth, boardHeight);
      ctx.fillStyle = TIMBER_MID;
      ctx.fillRect(boardLeft + 1, boardTop + 1, boardWidth - 2, boardHeight - 2);
      drawPinnedSheets(ctx, {
        left: boardLeft + 2,
        top: boardTop + 2,
        width: boardWidth - 4,
        height: boardHeight - 4,
        columns: MUSTER_SHEET_COLUMNS,
        rows: MUSTER_SHEET_ROWS,
        sheetColor: PARCHMENT_PALE,
        markColor: INK_LINE,
      });
      ctx.fillStyle = TIMBER_HIGHLIGHT;
      ctx.fillRect(boardLeft, boardTop, boardWidth, 1);
      return true;
    }

    // A campaign map pinned flat to a table, counters standing on it. Runs
    // seamlessly into its neighbours exactly as `TABLE` does.
    case MAP_TABLE: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      const joinedLeft = structure[ty]?.[tx - 1]?.type === MAP_TABLE;
      const joinedRight = structure[ty]?.[tx + 1]?.type === MAP_TABLE;
      const legInset = Math.floor(ts * MAP_TABLE_LEG_INSET_FRACTION);
      const topY = sy + Math.floor(ts * MAP_TABLE_TOP_FRACTION);
      const topHeight = Math.floor(ts * MAP_TABLE_HEIGHT_FRACTION);
      const surfaceLeft = joinedLeft ? sx : sx + legInset - 2;
      const surfaceRight = joinedRight ? sx + ts : sx + ts - legInset + 2;

      const legHeight = Math.floor(ts * MAP_TABLE_LEG_HEIGHT_FRACTION);
      ctx.fillStyle = TIMBER_DARK;
      if (!joinedLeft) ctx.fillRect(sx + legInset, topY, MAP_TABLE_LEG_WIDTH, legHeight);
      if (!joinedRight) {
        ctx.fillRect(
          sx + ts - legInset - MAP_TABLE_LEG_WIDTH,
          topY,
          MAP_TABLE_LEG_WIDTH,
          legHeight,
        );
      }
      ctx.fillStyle = TIMBER_SURFACE;
      ctx.fillRect(surfaceLeft, topY, surfaceRight - surfaceLeft, topHeight);
      ctx.fillStyle = PARCHMENT_MAP;
      ctx.fillRect(surfaceLeft + 1, topY + 2, surfaceRight - surfaceLeft - 2, topHeight - 4);
      // A coast and a river, which is all a map needs to read as a map at tile
      // size — any more line than this turns into noise.
      ctx.strokeStyle = MAP_COAST_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(surfaceLeft + 2, topY + topHeight - 4);
      ctx.lineTo(surfaceLeft + (surfaceRight - surfaceLeft) / 2, topY + 4);
      ctx.lineTo(surfaceRight - 2, topY + topHeight - 5);
      ctx.stroke();
      ctx.strokeStyle = MAP_RIVER_LINE;
      ctx.beginPath();
      ctx.moveTo(surfaceLeft + 3, topY + 3);
      ctx.lineTo(surfaceRight - 3, topY + topHeight - 3);
      ctx.stroke();
      ctx.fillStyle = MAP_COUNTER_RED;
      ctx.fillRect(surfaceLeft + 3, topY + topHeight - 6, 2, 2);
      ctx.fillStyle = MAP_COUNTER_DARK;
      ctx.fillRect(surfaceRight - 6, topY + 4, 2, 2);
      ctx.fillStyle = TIMBER_HIGHLIGHT;
      ctx.fillRect(surfaceLeft, topY, surfaceRight - surfaceLeft, 1);
      return true;
    }

    // The inking shop's flash: rows of pinned designs the customer chooses from.
    // Wall-hugging, like the muster board.
    case FLASH_WALL: {
      const backingLeft = sx + 1;
      const backingWidth = ts - 2;
      const backingTop = sy + Math.floor(ts * FLASH_TOP_FRACTION);
      const backingHeight = Math.floor(ts * FLASH_HEIGHT_FRACTION);

      ctx.fillStyle = FLASH_BACKING;
      ctx.fillRect(backingLeft, backingTop, backingWidth, backingHeight);
      drawPinnedSheets(ctx, {
        left: backingLeft + 1,
        top: backingTop + 1,
        width: backingWidth - 2,
        height: backingHeight - 2,
        columns: FLASH_SHEET_COLUMNS,
        rows: FLASH_SHEET_ROWS,
        sheetColor: PARCHMENT_PALE,
        markColor: FLASH_VIOLET,
      });
      ctx.fillStyle = FLASH_RIM;
      ctx.fillRect(backingLeft, backingTop, backingWidth, 1);
      return true;
    }

    // Stoppered jars of ground pigment on a shelf whose front edge is stained
    // through from years of them being set down wet.
    case PIGMENT_SHELF: {
      const carcassLeft = sx + 2;
      const carcassWidth = ts - 4;
      const carcassTop = sy + Math.floor(ts * SHELF_TOP_FRACTION);
      const carcassHeight = ts - (carcassTop - sy) - 2;

      ctx.fillStyle = PROP_CONTACT_SHADOW;
      ctx.fillRect(carcassLeft, sy + ts - 2, carcassWidth, 2);
      ctx.fillStyle = TIMBER_DARK;
      ctx.fillRect(carcassLeft, carcassTop, carcassWidth, carcassHeight);
      for (let board = 0; board < SHELF_BOARD_COUNT; board++) {
        const boardY =
          carcassTop + Math.floor(((board + 1) * carcassHeight) / (SHELF_BOARD_COUNT + 1));
        ctx.fillStyle = SHELF_STAINED_EDGE;
        ctx.fillRect(carcassLeft, boardY, carcassWidth, 2);
        for (let jar = 0; jar < SHELF_JARS_PER_BOARD; jar++) {
          const jarX =
            carcassLeft + 2 + jar * Math.floor((carcassWidth - 4) / SHELF_JARS_PER_BOARD);
          const jarHeight = Math.max(3, Math.floor(ts * SHELF_JAR_HEIGHT_FRACTION));
          ctx.fillStyle = PIGMENT_JAR_COLORS[(jar + board) % PIGMENT_JAR_COLORS.length];
          ctx.fillRect(jarX, boardY - jarHeight, SHELF_JAR_WIDTH, jarHeight);
          ctx.fillStyle = JAR_CORK;
          ctx.fillRect(jarX, boardY - jarHeight, SHELF_JAR_WIDTH, 1);
          ctx.fillStyle = GLAZE_GLINT;
          ctx.fillRect(jarX, boardY - jarHeight + 1, 1, jarHeight - 1);
        }
      }
      return true;
    }

    // The reclining bench the needle works over: padded, with a leather
    // headrest at the end the tattooist stands behind.
    case INK_BENCH: {
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      const joinedLeft = structure[ty]?.[tx - 1]?.type === INK_BENCH;
      const joinedRight = structure[ty]?.[tx + 1]?.type === INK_BENCH;
      const padTop = sy + Math.floor(ts * BENCH_TOP_FRACTION);
      const padHeight = Math.floor(ts * BENCH_HEIGHT_FRACTION);
      const padLeft = joinedLeft ? sx : sx + 2;
      const padRight = joinedRight ? sx + ts : sx + ts - 2;

      ctx.fillStyle = TIMBER_DARK;
      const apronHeight = Math.floor(ts * BENCH_APRON_HEIGHT_FRACTION);
      ctx.fillRect(padLeft, padTop + padHeight - 1, padRight - padLeft, apronHeight);
      ctx.fillStyle = BENCH_PADDING;
      ctx.fillRect(padLeft, padTop, padRight - padLeft, padHeight);
      ctx.fillStyle = BENCH_SEAM;
      ctx.fillRect(padLeft, padTop + Math.floor(padHeight / 2), padRight - padLeft, 1);
      if (!joinedLeft) {
        const headrestWidth = Math.floor(ts * BENCH_HEADREST_FRACTION);
        ctx.fillStyle = BENCH_HEADREST;
        ctx.fillRect(padLeft, padTop - 3, headrestWidth, padHeight + 3);
        ctx.fillStyle = BENCH_HEADREST_LIGHT;
        ctx.fillRect(padLeft, padTop - 3, headrestWidth, 1);
        ctx.fillRect(padLeft + headrestWidth - 1, padTop - 3, 1, padHeight + 3);
      }
      ctx.fillStyle = BENCH_PADDING_SHEEN;
      ctx.fillRect(padLeft, padTop, padRight - padLeft, 1);
      return true;
    }

    // Where the pigment is actually made: a stone slab with a muller, a soot pot
    // and a pestle, and a smear of what was last ground on it.
    case GRINDING_SLAB: {
      const slabLeft = sx + 2;
      const slabWidth = ts - 4;
      const slabTop = sy + Math.floor(ts * SLAB_TOP_FRACTION);
      const slabHeight = Math.floor(ts * SLAB_HEIGHT_FRACTION);

      ctx.fillStyle = PROP_CONTACT_SHADOW;
      ctx.fillRect(slabLeft, slabTop + slabHeight, slabWidth, 2);
      ctx.fillStyle = SLAB_EDGE;
      ctx.fillRect(slabLeft, slabTop, slabWidth, slabHeight);
      ctx.fillStyle = SLAB_FACE;
      ctx.fillRect(slabLeft + 1, slabTop + 1, slabWidth - 2, slabHeight - 2);
      ctx.fillStyle = SLAB_SMEAR;
      ctx.fillRect(
        slabLeft + 2,
        slabTop + slabHeight - 4,
        Math.floor(slabWidth * SLAB_SMEAR_WIDTH_FRACTION),
        2,
      );

      const mullerRadius = Math.max(2, Math.floor(ts * SLAB_MULLER_RADIUS_FRACTION));
      ctx.fillStyle = SLAB_MULLER;
      ctx.beginPath();
      ctx.arc(
        slabLeft + slabWidth * SLAB_MULLER_X_FRACTION,
        slabTop + slabHeight * SLAB_MULLER_Y_FRACTION,
        mullerRadius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = SLAB_POT;
      ctx.fillRect(
        slabLeft + Math.floor(slabWidth * SLAB_POT_X_FRACTION),
        slabTop + 2,
        Math.floor(ts * SLAB_POT_WIDTH_FRACTION),
        Math.floor(ts * SLAB_POT_HEIGHT_FRACTION),
      );
      ctx.strokeStyle = SLAB_PESTLE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(slabLeft + slabWidth * SLAB_PESTLE_BUTT_X_FRACTION, slabTop + slabHeight - 3);
      ctx.lineTo(slabLeft + slabWidth * SLAB_PESTLE_HEAD_X_FRACTION, slabTop + slabHeight - 8);
      ctx.stroke();
      ctx.fillStyle = SLAB_TOP_SHEEN;
      ctx.fillRect(slabLeft, slabTop, slabWidth, 1);
      return true;
    }

    default:
      return false;
  }
}

interface PinnedSheetGrid {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly sheetColor: string;
  readonly markColor: string;
}

/**
 * A grid of small pinned parchments over a backing board — shared by the
 * garrison's orders and the parlour's flash, which are the same object with a
 * different thing written on them.
 */
function drawPinnedSheets(ctx: CanvasRenderingContext2D, grid: PinnedSheetGrid): void {
  const cellW = grid.width / grid.columns;
  const cellH = grid.height / grid.rows;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      const x = grid.left + col * cellW + PINNED_SHEET_GAP;
      const y = grid.top + row * cellH + PINNED_SHEET_GAP;
      const w = Math.max(2, cellW - PINNED_SHEET_GAP * 2);
      const h = Math.max(2, cellH - PINNED_SHEET_GAP * 2);
      ctx.fillStyle = grid.sheetColor;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = grid.markColor;
      ctx.fillRect(x + 1, y + Math.floor(h / 2), Math.max(1, w - 2), 1);
      // The pin is what stops a pale rectangle reading as a blank tile.
      ctx.fillStyle = PIN_HEAD;
      ctx.fillRect(x + Math.floor(w / 2), y, 1, 1);
    }
  }
}

// ── The garrison's and the parlour's furniture ────────────────────────────────
//
// One shared palette across all of them, taken from the interior props that were
// already here: a chair's frame is `#5a3a1a` and its seat `#8B5E3C`, and a new
// prop drawn in its own colours reads as belonging to a different game.

const TIMBER_DARK = '#5a3a1a';
const TIMBER_MID = '#6b4226';
const TIMBER_SURFACE = '#8B5E3C';
const TIMBER_HIGHLIGHT = 'rgba(255,255,255,0.15)';
const PROP_CONTACT_SHADOW = 'rgba(0,0,0,0.22)';
const PARCHMENT_PALE = '#d8cba6';
const PARCHMENT_MAP = '#e2d3a6';
const INK_LINE = '#4a3d2a';
const PIN_HEAD = '#d8d4c4';
const PINNED_SHEET_GAP = 1;

const STRAW_MID = '#b39750';
const STRAW_LIGHT = '#d8c184';
const SACKING_DARK = '#7f6a3a';
const DUMMY_POST_WIDTH_FRACTION = 0.1;
const DUMMY_BODY_WIDTH_FRACTION = 0.44;
const DUMMY_BODY_TOP_FRACTION = 0.18;
const DUMMY_HEAD_RADIUS_FRACTION = 0.11;
const DUMMY_BODY_HEIGHT_FRACTION = 0.4;
const DUMMY_ARM_DROP_FRACTION = 0.12;
const DUMMY_HACK_MARK = 'rgba(58,38,18,0.55)';
const DUMMY_HACK_COUNT = 3;

const STEEL_LIGHT = '#b8c0c8';
const RACK_SIDE_INSET_FRACTION = 0.14;
const RACK_RAIL_TOP_FRACTION = 0.42;
const RACK_SHAFT_COUNT = 3;
const RACK_SHAFT_LEAN_FRACTION = 0.09;
const RACK_HEAD_HEIGHT_FRACTION = 0.18;

const BOARD_SIDE_INSET_FRACTION = 0.1;
const BOARD_TOP_FRACTION = 0.06;
const BOARD_HEIGHT_FRACTION = 0.62;
const MUSTER_SHEET_COLUMNS = 3;
const MUSTER_SHEET_ROWS = 2;

/*
 * Broken furniture. Every offset and length below is a fraction of the tile, and
 * every one is chosen so the drawn art stays inside the tile the piece blocks —
 * a splinter hanging over the neighbouring floor would let the player stand
 * inside the wreck.
 *
 * The palette is the intact furniture's own, one shade apiece, so a repaired
 * piece is recognisably the same object mended rather than a different object.
 */
const WRECK_DARK_WOOD = '#5a3a1a';
const WRECK_WOOD = '#8B5E3C';
const WRECK_WOOD_MID = '#7a5030';
/** Raw end-grain at a break — the pale flash that reads as "snapped" at 32 px. */
const WRECK_SPLINTER = '#c9a06a';
const WRECK_SHADOW = 'rgba(0,0,0,0.22)';
/** How far a piece's contact shadow sits below it, as a fraction of its own thickness. */
const WRECK_SHADOW_DROP = 0.55;
/** Share of a plank's length given over to its broken end. */
const WRECK_SPLINTER_FRACTION = 0.12;

const BROKEN_TABLE_PLANK_THICKNESS = 0.18;
const BROKEN_TABLE_NEAR_PLANK_DX = -0.14;
const BROKEN_TABLE_NEAR_PLANK_DY = 0.06;
const BROKEN_TABLE_NEAR_PLANK_LENGTH = 0.72;
const BROKEN_TABLE_NEAR_PLANK_ANGLE = -0.18;
const BROKEN_TABLE_FAR_PLANK_DX = 0.16;
const BROKEN_TABLE_FAR_PLANK_DY = -0.14;
const BROKEN_TABLE_FAR_PLANK_LENGTH = 0.62;
const BROKEN_TABLE_FAR_PLANK_ANGLE = 0.3;
const BROKEN_TABLE_LEG_DX = -0.28;
const BROKEN_TABLE_LEG_DY = -0.2;
const BROKEN_TABLE_LEG_LENGTH = 0.32;
const BROKEN_TABLE_LEG_THICKNESS = 0.1;
const BROKEN_TABLE_LEG_ANGLE = 1.15;

const BROKEN_CHAIR_SEAT_DY = 0.12;
const BROKEN_CHAIR_SEAT_ANGLE = 0.35;
const BROKEN_CHAIR_SEAT_WIDTH = 0.44;
const BROKEN_CHAIR_SEAT_HEIGHT = 0.3;
/** Share of the seat's height lit as its front lip, so it reads as tipped over. */
const BROKEN_CHAIR_SEAT_EDGE = 0.28;
const BROKEN_CHAIR_SLAT_DX = 0.16;
const BROKEN_CHAIR_SLAT_DY = -0.22;
const BROKEN_CHAIR_SLAT_LENGTH = 0.34;
const BROKEN_CHAIR_SLAT_THICKNESS = 0.08;
const BROKEN_CHAIR_SLAT_ANGLE = -0.55;
const BROKEN_CHAIR_LEG_DX = -0.24;
const BROKEN_CHAIR_LEG_DY = -0.12;
const BROKEN_CHAIR_LEG_LENGTH = 0.26;
const BROKEN_CHAIR_LEG_THICKNESS = 0.07;
const BROKEN_CHAIR_LEG_ANGLE = 0.95;

const BROKEN_SHELF_BACK_INSET = 0.1;
const BROKEN_SHELF_BACK_TOP = 0.08;
const BROKEN_SHELF_BACK_HEIGHT = 0.3;
/** Where along the back panel a shelf board tore out, and how wide the scar is. */
const BROKEN_SHELF_TEAR_START = 0.42;
const BROKEN_SHELF_TEAR_WIDTH = 0.1;
const BROKEN_SHELF_BOARD_THICKNESS = 0.11;
const BROKEN_SHELF_UPPER_BOARD_DX = -0.06;
const BROKEN_SHELF_UPPER_BOARD_DY = 0.18;
const BROKEN_SHELF_UPPER_BOARD_LENGTH = 0.72;
const BROKEN_SHELF_UPPER_BOARD_ANGLE = -0.12;
const BROKEN_SHELF_LOWER_BOARD_DX = 0.08;
const BROKEN_SHELF_LOWER_BOARD_DY = 0.34;
const BROKEN_SHELF_LOWER_BOARD_LENGTH = 0.56;
const BROKEN_SHELF_LOWER_BOARD_ANGLE = 0.16;
const SPILLED_BOOK_WIDTH = 0.13;
const SPILLED_BOOK_HEIGHT = 0.09;
const SPILLED_BOOK_COLORS: ReadonlyArray<string> = ['#8c2f2a', '#2f5a44', '#3a4a7a'];
/** Tile-fraction corners of the fallen books, tucked between the boards. */
const SPILLED_BOOKS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0.16, y: 0.5 },
  { x: 0.66, y: 0.44 },
  { x: 0.38, y: 0.74 },
];

const MAP_TABLE_LEG_INSET_FRACTION = 0.15;
const MAP_TABLE_TOP_FRACTION = 0.2;
const MAP_TABLE_HEIGHT_FRACTION = 0.4;
const MAP_TABLE_LEG_WIDTH = 3;
const MAP_TABLE_LEG_HEIGHT_FRACTION = 0.5;
const MAP_COAST_LINE = '#4e3f22';
const MAP_RIVER_LINE = '#2f5a86';
const MAP_COUNTER_RED = '#9c3428';
const MAP_COUNTER_DARK = '#2c2620';

const FLASH_BACKING = '#3a2c3c';
const FLASH_VIOLET = '#7a4a9a';
const FLASH_RIM = 'rgba(200,170,220,0.3)';
const FLASH_TOP_FRACTION = 0.05;
const FLASH_HEIGHT_FRACTION = 0.66;
const FLASH_SHEET_COLUMNS = 3;
const FLASH_SHEET_ROWS = 3;

const SHELF_TOP_FRACTION = 0.12;
const SHELF_BOARD_COUNT = 2;
const SHELF_JARS_PER_BOARD = 3;
const SHELF_JAR_WIDTH = 3;
const SHELF_JAR_HEIGHT_FRACTION = 0.16;
const SHELF_STAINED_EDGE = '#4a2f3a';
const JAR_CORK = '#c2a878';
/** The vertical catchlight down a glazed jar that stops it reading as a flat chip. */
const GLAZE_GLINT = 'rgba(255,255,255,0.28)';
/** Woad, gall black and madder — the same three the shop's floor is stained with. */
const PIGMENT_JAR_COLORS: ReadonlyArray<string> = ['#3a5a90', '#241f21', '#8e3a2e'];

const BENCH_TOP_FRACTION = 0.3;
const BENCH_HEIGHT_FRACTION = 0.34;
const BENCH_HEADREST_FRACTION = 0.28;
const BENCH_APRON_HEIGHT_FRACTION = 0.16;
const BENCH_PADDING = '#6a3436';
const BENCH_SEAM = '#4c2426';
const BENCH_HEADREST = '#33241d';
const BENCH_HEADREST_LIGHT = '#7a5b46';
/** Warm rather than white: the sheen on padding is the lamp, not daylight. */
const BENCH_PADDING_SHEEN = 'rgba(255,220,200,0.2)';

const SLAB_TOP_FRACTION = 0.3;
const SLAB_HEIGHT_FRACTION = 0.46;
const SLAB_MULLER_RADIUS_FRACTION = 0.09;
const SLAB_SMEAR_WIDTH_FRACTION = 0.5;
const SLAB_MULLER_X_FRACTION = 0.3;
const SLAB_MULLER_Y_FRACTION = 0.45;
const SLAB_POT_X_FRACTION = 0.62;
const SLAB_POT_WIDTH_FRACTION = 0.2;
const SLAB_POT_HEIGHT_FRACTION = 0.22;
const SLAB_PESTLE_BUTT_X_FRACTION = 0.55;
const SLAB_PESTLE_HEAD_X_FRACTION = 0.9;
const SLAB_TOP_SHEEN = 'rgba(255,255,255,0.2)';
const SLAB_EDGE = '#5e5a56';
const SLAB_FACE = '#8a8580';
const SLAB_MULLER = '#6e6a66';
const SLAB_POT = '#2a2422';
const SLAB_PESTLE = '#7a746e';
const SLAB_SMEAR = '#3a4a78';

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
