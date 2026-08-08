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
  INTERIOR_RUSH_FLOOR,
  INTERIOR_EARTH_FLOOR,
  INTERIOR_FLAG_FLOOR,
  INTERIOR_INK_FLOOR,
  INTERIOR_WALL,
  LANE_STREET,
  PLAZA_STONE,
  VERGE_GRASS,
  YARD_GRAVEL,
  HIGHLAND_GRASS,
  SCREE,
  BRIDGE,
  BRIDGE_AXIS_EAST_WEST,
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

// ── bridges ────────────────────────────────────────────────────────────────

/** Timber, lit from the upper left like every other prop in the repo. */
const BRIDGE_DECK_COLOR = '#8a6a44';
const BRIDGE_DECK_LIGHT_COLOR = '#a4835a';
const BRIDGE_PLANK_GAP_COLOR = 'rgba(46,30,16,0.5)';
const BRIDGE_BEAM_COLOR = '#5f462b';
const BRIDGE_RAIL_COLOR = '#7b5c3a';
const BRIDGE_RAIL_HIGHLIGHT_COLOR = '#9a7850';
const BRIDGE_UNDERSHADOW_COLOR = 'rgba(12,22,26,0.42)';

/** Deck geometry, in tile fractions so it holds at any tile size. */
const BRIDGE_DECK_INSET_FRACTION = 0.06;
const BRIDGE_BEAM_THICKNESS_FRACTION = 0.09;
const BRIDGE_RAIL_THICKNESS_FRACTION = 0.07;
const BRIDGE_RAIL_INSET_FRACTION = 0.02;
const BRIDGE_UNDERSHADOW_FRACTION = 0.1;

/** Planks laid across the span, per tile. */
const BRIDGE_PLANKS_PER_TILE = 4;
const BRIDGE_PLANK_GAP_PX = 1;
/** Every third plank is drawn lighter, so a long deck is not one flat band. */
const BRIDGE_PLANK_HIGHLIGHT_PERIOD = 3;
/** Rail posts, spaced so a tile carries one or two of them. */
const BRIDGE_POSTS_PER_TILE = 2;
const BRIDGE_POST_WIDTH_PX = 2;

/**
 * Draws one tile of plank deck.
 *
 * The span axis is **read off the tile**, recorded there by the river painter as
 * it laid the deck. Two earlier versions inferred it from the neighbours and
 * both were wrong for the commonest crossing on the map: counting deck and water
 * neighbours together ties 2–2 in mid-channel, and counting only deck neighbours
 * ties 2–2 anywhere inside a bridge wider than one tile — which is every road
 * bridge, since the gate highways are four tiles across. Measured on the second
 * version: 113 of 299 mid-channel deck tiles drew their planks across their own
 * walkway.
 *
 * A tile with no recorded axis falls back to east-west; nothing writes `BRIDGE`
 * without one, so that is a guard rather than a case.
 */
function drawBridgeDeck(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const runsEastWest =
    (structure[ty]?.[tx]?.bridgeAxis ?? BRIDGE_AXIS_EAST_WEST) === BRIDGE_AXIS_EAST_WEST;

  const inset = ts * BRIDGE_DECK_INSET_FRACTION;
  const beam = Math.max(1, ts * BRIDGE_BEAM_THICKNESS_FRACTION);
  const rail = Math.max(1, ts * BRIDGE_RAIL_THICKNESS_FRACTION);
  const railInset = ts * BRIDGE_RAIL_INSET_FRACTION;
  const underShadow = ts * BRIDGE_UNDERSHADOW_FRACTION;

  // Along-span extent is the full tile so consecutive tiles butt up seamlessly;
  // the across-span extent is inset, which is what leaves water showing at the
  // deck's edges and makes the crossing read as a structure over the river.
  const deckX = runsEastWest ? sx : sx + inset;
  const deckY = runsEastWest ? sy + inset : sy;
  const deckW = runsEastWest ? ts : ts - inset * 2;
  const deckH = runsEastWest ? ts - inset * 2 : ts;

  // Clamped to the tile's own edge. The shadow's depth is deeper than the deck's
  // inset, so drawn at full depth it ran past the tile — and terrain is baked in
  // 16x16-tile chunks clipped to their own rect, which slices it off at every
  // chunk seam. Measured before this: 64 escaping pixels per tile.
  ctx.fillStyle = BRIDGE_UNDERSHADOW_COLOR;
  if (runsEastWest) {
    const shadowTop = deckY + deckH;
    ctx.fillRect(sx, shadowTop, ts, Math.min(underShadow, sy + ts - shadowTop));
  } else {
    const shadowLeft = deckX + deckW;
    ctx.fillRect(shadowLeft, sy, Math.min(underShadow, sx + ts - shadowLeft), ts);
  }

  ctx.fillStyle = BRIDGE_DECK_COLOR;
  ctx.fillRect(deckX, deckY, deckW, deckH);

  // Planks run across the span, so the joints read as boards underfoot rather
  // than as stripes down the length of the crossing.
  const plankPitch = ts / BRIDGE_PLANKS_PER_TILE;
  for (let plank = 0; plank < BRIDGE_PLANKS_PER_TILE; plank++) {
    const along = plank * plankPitch;
    const isHighlit = (plank + tx + ty) % BRIDGE_PLANK_HIGHLIGHT_PERIOD === 0;
    if (isHighlit) {
      ctx.fillStyle = BRIDGE_DECK_LIGHT_COLOR;
      if (runsEastWest) ctx.fillRect(sx + along, deckY, plankPitch - BRIDGE_PLANK_GAP_PX, deckH);
      else ctx.fillRect(deckX, sy + along, deckW, plankPitch - BRIDGE_PLANK_GAP_PX);
    }
    ctx.fillStyle = BRIDGE_PLANK_GAP_COLOR;
    if (runsEastWest) ctx.fillRect(sx + along, deckY, BRIDGE_PLANK_GAP_PX, deckH);
    else ctx.fillRect(deckX, sy + along, deckW, BRIDGE_PLANK_GAP_PX);
  }

  // Edge beams: the timbers the planks are nailed to, and what stops the deck
  // reading as a painted rectangle.
  ctx.fillStyle = BRIDGE_BEAM_COLOR;
  if (runsEastWest) {
    ctx.fillRect(sx, deckY, ts, beam);
    ctx.fillRect(sx, deckY + deckH - beam, ts, beam);
  } else {
    ctx.fillRect(deckX, sy, beam, ts);
    ctx.fillRect(deckX + deckW - beam, sy, beam, ts);
  }

  // Low side railings with posts.
  ctx.fillStyle = BRIDGE_RAIL_COLOR;
  if (runsEastWest) {
    ctx.fillRect(sx, deckY - railInset, ts, rail);
    ctx.fillRect(sx, deckY + deckH + railInset - rail, ts, rail);
  } else {
    ctx.fillRect(deckX - railInset, sy, rail, ts);
    ctx.fillRect(deckX + deckW + railInset - rail, sy, rail, ts);
  }
  ctx.fillStyle = BRIDGE_RAIL_HIGHLIGHT_COLOR;
  const postPitch = ts / BRIDGE_POSTS_PER_TILE;
  for (let post = 0; post < BRIDGE_POSTS_PER_TILE; post++) {
    const along = post * postPitch;
    if (runsEastWest) {
      ctx.fillRect(sx + along, deckY - railInset, BRIDGE_POST_WIDTH_PX, rail);
      ctx.fillRect(sx + along, deckY + deckH + railInset - rail, BRIDGE_POST_WIDTH_PX, rail);
    } else {
      ctx.fillRect(deckX - railInset, sy + along, rail, BRIDGE_POST_WIDTH_PX);
      ctx.fillRect(deckX + deckW + railInset - rail, sy + along, rail, BRIDGE_POST_WIDTH_PX);
    }
  }
}

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
    case PLAZA_STONE:
    case HIGHLAND_GRASS:
    case SCREE: {
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
    // The river's static base. It is one more ground material and nothing more:
    // the flowing highlights, the ripples and the bank foam are all
    // `WaterAnimationSystem`'s, drawn per frame on top, because terrain is
    // chunk-baked and nothing baked can animate.
    //
    // Until the river existed this was a flat `#2ac6ff` fillRect standing in for
    // a material no generator ever wrote.
    case FloorTypeValue.water: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      break;
    }

    // A plank deck carrying a route over the river.
    //
    // Procedural rather than a baked sprite, following the `FENCE` idiom: what a
    // bridge tile looks like depends on which of its neighbours are also bridge,
    // and a sprite family would need one frame per neighbour combination. The
    // ground beneath comes from the tile's own record — water mid-channel, the
    // road or the turf at the abutments — so the deck's edges show the right
    // thing under them at both ends of the span.
    case BRIDGE: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawBridgeDeck(ctx, structure, sx, sy, ts, tx, ty);
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
    case INTERIOR_STONE_FLOOR:
    case INTERIOR_RUSH_FLOOR:
    case INTERIOR_EARTH_FLOOR:
    case INTERIOR_FLAG_FLOOR:
    case INTERIOR_INK_FLOOR: {
      drawGroundTile(ctx, TOWN_INTERIOR_GROUND, structure, sx, sy, ts, tx, ty);
      break;
    }

    default:
      return false;
  }
  return true;
}
