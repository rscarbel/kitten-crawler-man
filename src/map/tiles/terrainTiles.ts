import type { TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  COBBLE_STREET,
  INTERIOR_BOARD_FLOOR,
  INTERIOR_COUNTER,
  INTERIOR_STONE_FLOOR,
  INTERIOR_WALL,
  LANE_STREET,
  PLAZA_STONE,
  VERGE_GRASS,
  YARD_GRAVEL,
} from '../tileTypes';
import { drawGroundTile, drawGroundMaterialTile } from './groundTiles';
import { OVERWORLD_GROUND } from '../town/groundMaterials';
import { dungeonFloorTheme } from '../dungeon/floorTheme';
import {
  INTERIOR_COUNTER_MATERIAL,
  INTERIOR_WALL_MATERIAL,
  TOWN_INTERIOR_GROUND,
} from '../town/interiorMaterials';

/** Pixel depth of the door threshold shadow strip from the overhang above. */
const DOOR_OVERHANG_SHADOW_DEPTH = 5;
/** Inset from each edge for the recessed slab panel of the door threshold. */
const DOOR_THRESHOLD_INSET = 2;
/** Total size reduction (both sides) for the door threshold inset. */
const DOOR_THRESHOLD_INSET_TOTAL = DOOR_THRESHOLD_INSET * 2;

export function drawTerrainTile(
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
    // Void (outer border)
    case VOID_TYPE: {
      ctx.fillStyle = '#000000';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }

    // Outdoors. Every one of these is a ground *material* and nothing more — the
    // material a tile draws comes from its type via `groundMaterialForTileType`,
    // so a new paving surface is one case here and one line there.
    case FloorTypeValue.grass:
    case VERGE_GRASS:
    case YARD_GRAVEL:
    case LANE_STREET:
    case COBBLE_STREET:
    case PLAZA_STONE: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      break;
    }
    case FloorTypeValue.road: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
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
        ctx.fillRect(
          sx + DOOR_THRESHOLD_INSET,
          sy + DOOR_THRESHOLD_INSET,
          ts - DOOR_THRESHOLD_INSET_TOTAL,
          ts - DOOR_THRESHOLD_INSET_TOTAL,
        );
        ctx.fillStyle = '#b0a080'; // step edge highlight
        ctx.fillRect(sx, sy, ts, 2);
        ctx.fillRect(sx, sy, 2, ts);
        ctx.fillStyle = 'rgba(0,0,0,0.24)'; // shadow from overhang above
        ctx.fillRect(sx, sy, ts, DOOR_OVERHANG_SHADOW_DEPTH);
      }
      break;
    }
    case FloorTypeValue.water: {
      ctx.fillStyle = '#2ac6ff';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }

    // Dungeon wall. Base material only: a wall has no neighbouring ground to
    // blend into, and running it through `drawGroundTile` would make the corner
    // masks bleed masonry across the floor in front of it.
    case FloorTypeValue.wall: {
      const theme = dungeonFloorTheme();
      drawGroundMaterialTile(ctx, theme.ground, theme.wallMaterial, sx, sy, ts, tx, ty);
      break;
    }

    // The four generic dungeon floors. One case, not four: `drawGroundTile`
    // reads the material from the tile itself through the active floor theme's
    // palette, which is the same lookup the fringe does for every neighbour — so
    // a caller that named a material could only disagree with it.
    //
    // No `drawWallShadow` here, unlike the retired tileset path: the ground
    // renderer's own occlusion pass already shades every side of every wall, and
    // the two together doubled the contact shading.
    case FloorTypeValue.concrete:
    case FloorTypeValue.tile_floor:
    case FloorTypeValue.carpet:
    case FloorTypeValue.wood: {
      drawGroundTile(ctx, dungeonFloorTheme().ground, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Town building interiors. Solids base-only and floors through the full
    // ground pass, exactly as the dungeon's are directly above — the only
    // difference is which palette answers, which is the whole point of these
    // having tile types of their own.
    case INTERIOR_WALL: {
      drawGroundMaterialTile(ctx, TOWN_INTERIOR_GROUND, INTERIOR_WALL_MATERIAL, sx, sy, ts, tx, ty);
      break;
    }
    case INTERIOR_COUNTER: {
      drawGroundMaterialTile(
        ctx,
        TOWN_INTERIOR_GROUND,
        INTERIOR_COUNTER_MATERIAL,
        sx,
        sy,
        ts,
        tx,
        ty,
      );
      break;
    }
    case INTERIOR_BOARD_FLOOR:
    case INTERIOR_STONE_FLOOR: {
      drawGroundTile(ctx, TOWN_INTERIOR_GROUND, structure, sx, sy, ts, tx, ty);
      break;
    }

    default:
      return false;
  }
  return true;
}
