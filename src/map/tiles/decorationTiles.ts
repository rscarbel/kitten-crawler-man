import type { FenceStyle, TileContent } from '../tileTypes';
import { OVERLAY_FRAME_KEY_STRIDE, SPRITE_BUILDING_OVERLAY_FPS } from './overlayAnimation';
import {
  FloorTypeValue,
  TREE,
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
  WILDFLOWER_TUFT,
  PEBBLE_SCATTER,
  RIVER_ROCK,
  BOULDER_SMALL,
  BOULDER_LARGE,
  boulderSpriteKey,
  CAMPFIRE,
  CAMPFIRE_FLAME_FPS,
  CAMPFIRE_FLAME_FRAMES,
  GOBLIN_TENT,
  DEN_HOLLOW,
  goblinTentSpriteKey,
  CLIFF,
  FENCE,
  GARDEN_PLANTING,
  BARREL,
  BARREL_SIDE,
  BOOKSHELF,
  CRAWLER_SIGN,
  CRATE,
  BRAZIER,
  BONES,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  RUBBLE,
  TOWN_WALL,
  propSpriteState,
  treeSpriteKeyForTile,
  treeSpriteState,
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  FLASH_WALL,
  PIGMENT_SHELF,
  GRINDING_SLAB,
  HOARD_PILE,
  HOARD_TOWER,
  HOARD_BAG,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  KRAKAREN_TANK,
  KRAKAREN_CONSOLE,
  LAB_BENCH,
  LAB_SHELF,
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  TENT_POLE,
} from '../tileTypes';
import { drawHollowWallTile } from './hollowWallTiles';
import { drawHollowGateTile, drawHollowPalisadeTile } from './hollowPalisadeTiles';
import { drawHollowPropTile } from './hollowVillageTiles';
import { drawCircusStructureTile } from './circusStructureTiles';
import { drawTentPoleTile } from './tentPoleTiles';
import { drawTentPoleBaseTile } from './interiorTiles';
import { drawRockDepositTile } from './rockDepositTiles';
import { tileHash01 } from './hollowTileHash';
import { BOARD_CENTRE_X, SIGN_ARROW_CENTRE_Y_TILES } from '../../sprites/art/crawlerSignArt';
import { inferFloorType } from './helpers';
import { drawTerrainTile } from './terrainTiles';
import { drawGroundTile } from './groundTiles';
import { OVERWORLD_GROUND } from '../town/groundMaterials';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawSpriteKey, drawSprite, timeFrameIndex } from '../../core/SpriteRenderer';
import { drawFountainTileSlice } from '../../sprites/fountainSprite';
import { getSpriteDefByKey, getSpriteOverlayStatesByKey } from '../../core/SpriteLoader';
import { frameTime } from '../../utils';
import { drawCircusDecals } from './circusDecalTiles';

/** Number of broken-stone chunks drawn per RUBBLE tile. */
const RUBBLE_CHUNK_COUNT = 4;
/** Number of fine grit specks per RUBBLE tile. */
const RUBBLE_GRIT_COUNT = 6;
/** Number of grass tufts drawn over the rubble so it blends into the lawn. */
const RUBBLE_TUFT_COUNT = 3;
const RUBBLE_TUFT_HEIGHT = 6;
/** Margin keeping the dirt patch off the tile edges so grass rings the debris. */
const RUBBLE_PATCH_INSET = 4;
/** Per-tile jitter applied to the dirt-patch position. */
const RUBBLE_PATCH_JITTER = 5;
/** Extra horizontal radius making the dirt patch an oval rather than a circle. */
const RUBBLE_PATCH_RX_EXTRA = 3;
const RUBBLE_CHUNK_MIN_SIZE = 3;
const RUBBLE_CHUNK_SIZE_VARIANCE = 4;

/**
 * Long-bone geometry (the femur/tibia shape), sized well under a tile so a
 * pile of them reads as scattered debris next to the player rather than
 * looming slabs. Two colors — a pale shaft and a darker joint cap — sell the
 * knobby bone-end silhouette better than a flat rectangle does.
 */
const BONE_SHAFT_COLOR = '#d8d0b8';
const BONE_SHAFT_SHADOW_COLOR = '#a89c7c';
const BONE_JOINT_COLOR = '#c8c0a4';
const BONE_OUTLINE_COLOR = '#6b6350';
const BONE_SHADOW_COLOR = 'rgba(20,16,8,0.28)';
const BONE_OUTLINE_WIDTH = 0.75;

const BONE1_HALF_LENGTH = 6;
const BONE1_SHAFT_HALF_WIDTH = 1.1;
const BONE1_JOINT_RADIUS = 2.2;
const BONE1_SHADOW_RX = 6.5;
const BONE1_SHADOW_RY = 2.2;

const BONE2_HALF_LENGTH = 4.5;
const BONE2_SHAFT_HALF_WIDTH = 0.85;
const BONE2_JOINT_RADIUS = 1.6;
const BONE2_SHADOW_RX = 4.8;
const BONE2_SHADOW_RY = 1.7;

const BONE3_SHAFT_LENGTH = 5;
const BONE3_SHAFT_HALF_WIDTH = 0.65;
const BONE3_JOINT_RADIUS = 1;

/**
 * How far a knuckle's twin lobes sit off the bone's own axis, and how big each
 * lobe is, relative to `jointRadius`. Two smaller offset lobes per end read as
 * a flared epiphysis; one centered circle per end reads as a ball-and-stick
 * joint instead.
 */
const BONE_KNUCKLE_LOBE_OFFSET_FRAC = 0.55;
const BONE_KNUCKLE_LOBE_RADIUS_FRAC = 0.72;

/** Playback rate and frame count of the main tower's glow overlay. */
const MAIN_TOWER_GLOW_FPS = 4;
const MAIN_TOWER_GLOW_FRAMES = 4;

/** Playback rate and frame count of a torch's flame loop, at either wear stage. */
const TORCH_FLAME_FPS = 8;
const TORCH_FLAME_FRAMES = 6;

/** Playback rate and frame count of a brazier's flame loop. */
const BRAZIER_FLAME_FPS = 10;
const BRAZIER_FLAME_FRAMES = 4;

/**
 * Which animation frame a decoration tile is currently drawing, as a single
 * number. The overlay cache keys entries on it so an animated building is
 * re-rendered once per distinct frame rather than once per display frame.
 * Tiles with no animation report 0.
 */
export function decorationAnimationFrame(
  structure: TileContent[][],
  type: number,
  tx: number,
  ty: number,
): number {
  if (type === MAIN_TOWER) {
    return timeFrameIndex(frameTime, MAIN_TOWER_GLOW_FPS, MAIN_TOWER_GLOW_FRAMES);
  }
  if (type !== SPRITE_BUILDING) return 0;

  const spriteKey = structure[ty][tx].spriteKey;
  if (spriteKey === undefined) return 0;
  const def = getSpriteDefByKey(spriteKey);
  if (def === undefined) return 0;

  let key = 0;
  for (const overlayState of getSpriteOverlayStatesByKey(spriteKey)) {
    const overlayDef = def.states.get(overlayState);
    if (overlayDef === undefined) continue;
    const frame = timeFrameIndex(frameTime, SPRITE_BUILDING_OVERLAY_FPS, overlayDef.frameCount);
    key = key * OVERLAY_FRAME_KEY_STRIDE + frame;
  }
  return key;
}

/**
 * Tilled rows, as fractions of the tile.
 *
 * Fixed fractions rather than hashed positions, which is the whole point: every
 * planted tile puts its furrows at the same heights, so a run of them across a
 * garden lines up into continuous beds instead of reading as scattered tufts.
 */
const PLANTING_FURROW_FRACTIONS = [0.32, 0.68] as const;
/** Index of the furrow a crop head sits on — the lower of the two. */
const PLANTING_CROP_HEAD_FURROW = 1;
const PLANTING_FURROW_HEIGHT_PX = 2;
/**
 * Three wide clumps a furrow, not four narrow ticks: at 32 px a tile, a mark has
 * to be several pixels across in both directions before it reads as a plant.
 */
const PLANTING_CLUMPS_PER_FURROW = 3;
const PLANTING_CLUMP_RX_PX = 4;
const PLANTING_CLUMP_RY_PX = 3;
/** Sits the clump on the furrow rather than centred in it. */
const PLANTING_CLUMP_LIFT_PX = 2;
const PLANTING_CLUMP_HIGHLIGHT_LIFT_PX = 1;
const PLANTING_CLUMP_HIGHLIGHT_INSET_PX = 1;
/** Puts a clump in the middle of its slot rather than on the slot's edge. */
const PLANTING_SLOT_CENTRE = 0.5;
/** About one planted tile in five carries a full head rather than clumps alone. */
const PLANTING_CROP_HEAD_PERIOD = 5;
const PLANTING_CROP_HEAD_RADIUS_PX = 4;
const PLANTING_CROP_HEART_RADIUS_PX = 2;

/**
 * Per-tile jitter for the clumps, so a bed does not read as graph paper.
 *
 * Small odd multipliers and a prime modulus: this is decoration, not the ground
 * variant hash, so it needs to look unpatterned rather than to survive an
 * avalanche test.
 */
const PLANTING_JITTER_HASH_X = 31;
const PLANTING_JITTER_HASH_Y = 17;
const PLANTING_JITTER_MODULUS = 97;
const PLANTING_WOBBLE_FURROW_STEP = 7;
const PLANTING_WOBBLE_CLUMP_STEP = 3;
/** Wobble lands in [-1, 1] px: span 3 offset by 1. */
const PLANTING_WOBBLE_SPAN = 3;
const PLANTING_WOBBLE_CENTRE = 1;
const PLANTING_HEAD_HASH_X = 7;
const PLANTING_HEAD_HASH_Y = 13;

/**
 * Planting colours, sampled against the generated `verge` row rather than picked
 * by eye — the recurring defect of this rendering work has been a colour written
 * from memory of the retired tileset, which put mint tufts on an olive lawn.
 */
const PLANTING_SOIL_COLOR = 'rgba(58,42,24,0.24)';
const PLANTING_LEAF_COLOR = '#7c8f3e';
const PLANTING_LEAF_DARK_COLOR = '#556228';

/**
 * Fence geometry, in tile fractions so it holds at any tile size.
 *
 * The rails sit above the tile's vertical middle and the post's foot below it, so
 * the fence reads as standing on the ground rather than lying on it — without
 * drawing outside its own tile, which is what lets the chunk-cached and direct
 * render paths stay identical.
 */
const FENCE_POST_TOP_FRACTION = 0.24;
const FENCE_POST_BOTTOM_FRACTION = 0.84;
const FENCE_POST_WIDTH_PX = 4;
const FENCE_RAIL_FRACTIONS = [0.36, 0.62] as const;
const FENCE_RAIL_THICKNESS_PX = 3;

const FENCE_POST_COLOR = '#6a5334';
const FENCE_POST_SHADE_COLOR = '#4c3b24';
const FENCE_RAIL_COLOR = '#7e6642';
const FENCE_RAIL_HIGHLIGHT_COLOR = '#967d54';

/** Sawn pale colours, a shade paler than the round timber they hang on. */
const PICKET_PALE_COLOR = '#9a805a';
const PICKET_PALE_SHADE_COLOR = '#6f5a3b';
/**
 * A picket's rails are lighter than a stock fence's: the pales carry the load and
 * the rails only have to hold them.
 */
const PICKET_RAIL_THICKNESS_PX = 2;
const PICKET_PALE_WIDTH_PX = 3;
const PICKET_PALE_GAP_PX = 3;
const PICKET_PALE_TOP_FRACTION = 0.2;
const PICKET_PALE_BOTTOM_FRACTION = 0.8;
/** Height of the pointed head above the pale's shoulder. */
const PICKET_TIP_HEIGHT_PX = 3;

/** Woven hazel: greener and greyer than sawn timber, and never highlighted. */
const WATTLE_WEAVE_COLOR = '#8b7c55';
const WATTLE_WEAVE_DARK_COLOR = '#5f5438';
const WATTLE_STAKE_COLOR = '#6b5f3f';
const WATTLE_WEAVE_THICKNESS_PX = 3;
const WATTLE_WEAVE_FRACTIONS = [0.34, 0.52, 0.7] as const;
/** Width of one over-under segment of the weave. */
const WATTLE_SEGMENT_PX = 6;
const WATTLE_STAKE_WIDTH_PX = 2;
const WATTLE_STAKE_STEP_PX = 12;

/**
 * Wendell's own picket, one yard's worth: a builder's fence rather than a
 * farmer's. Squared posts (wider than the town's plain round ones) in a
 * darker, better-seasoned oak, each capped with a lighter pale — a joinery
 * detail no other yard's fence carries.
 */
const GARRISON_POST_COLOR = '#4a3a26';
const GARRISON_POST_SHADE_COLOR = '#332818';
const GARRISON_POST_CAP_COLOR = '#8a6f48';
const GARRISON_RAIL_COLOR = '#5e4a30';
const GARRISON_RAIL_HIGHLIGHT_COLOR = '#7a6244';
const GARRISON_POST_WIDTH_PX = 6;
const GARRISON_PALE_COLOR = '#6f5a3a';
const GARRISON_PALE_SHADE_COLOR = '#4a3a26';

/**
 * A fence left to rot for years and never rebuilt: rails bleached silver-grey
 * and posts gone near-black, where the post-and-rail it is replaced with is
 * warm brown throughout. The two differ in hue and in value, so a run that is
 * half rebuilt reads as old and new at a glance, before any of the damage
 * drawn on the old one resolves.
 */
const RICKETY_POST_COLOR = '#48443b';
const RICKETY_POST_SHADE_COLOR = '#282520';
const RICKETY_RAIL_COLOR = '#8e8b7e';
const RICKETY_RAIL_HIGHLIGHT_COLOR = '#b4b1a2';
/** A bleached rail's weathered underside, which keeps it reading as round timber rather than a pale stroke. */
const RICKETY_RAIL_UNDERSIDE_COLOR = '#5b584d';
const RICKETY_ROT_COLOR = '#5a5244';
const RICKETY_MOSS_COLOR = '#687a2e';
const RICKETY_WEED_COLOR = '#4a5c1f';
const RICKETY_WEED_LIGHT_COLOR = '#8a9d3c';

interface FenceStyleSpec {
  /** Fractions of a tile at which horizontal timbers run. */
  readonly railFractions: ReadonlyArray<number>;
  readonly railThicknessPx: number;
  readonly railColor: string;
  readonly railHighlightColor: string | null;
  readonly postColor: string;
  readonly postShadeColor: string;
  /** Drawn between the posts after the rails, for the styles that have infill. */
  readonly infill: 'none' | 'pales' | 'weave';
  /** Overrides `FENCE_POST_WIDTH_PX` for a style whose posts are built heavier. */
  readonly postWidthPx?: number;
  /** A lighter pale drawn across the post's own top, reading as a fitted cap rather than a stake driven into the ground. */
  readonly postCapColor?: string;
  /** Overrides the picket infill's pale colours; defaults to `PICKET_PALE_COLOR`/`PICKET_PALE_SHADE_COLOR`. */
  readonly paleColor?: string;
  readonly paleShadeColor?: string;
}

const FENCE_STYLE_SPECS: Record<FenceStyle, FenceStyleSpec> = {
  post_and_rail: {
    railFractions: FENCE_RAIL_FRACTIONS,
    railThicknessPx: FENCE_RAIL_THICKNESS_PX,
    railColor: FENCE_RAIL_COLOR,
    railHighlightColor: FENCE_RAIL_HIGHLIGHT_COLOR,
    postColor: FENCE_POST_COLOR,
    postShadeColor: FENCE_POST_SHADE_COLOR,
    infill: 'none',
  },
  picket: {
    railFractions: FENCE_RAIL_FRACTIONS,
    railThicknessPx: PICKET_RAIL_THICKNESS_PX,
    railColor: FENCE_RAIL_COLOR,
    railHighlightColor: null,
    postColor: FENCE_POST_COLOR,
    postShadeColor: FENCE_POST_SHADE_COLOR,
    infill: 'pales',
  },
  wattle: {
    railFractions: WATTLE_WEAVE_FRACTIONS,
    railThicknessPx: WATTLE_WEAVE_THICKNESS_PX,
    railColor: WATTLE_WEAVE_COLOR,
    railHighlightColor: null,
    postColor: WATTLE_STAKE_COLOR,
    postShadeColor: WATTLE_WEAVE_DARK_COLOR,
    infill: 'weave',
  },
  garrison: {
    railFractions: FENCE_RAIL_FRACTIONS,
    railThicknessPx: FENCE_RAIL_THICKNESS_PX,
    railColor: GARRISON_RAIL_COLOR,
    railHighlightColor: GARRISON_RAIL_HIGHLIGHT_COLOR,
    postColor: GARRISON_POST_COLOR,
    postShadeColor: GARRISON_POST_SHADE_COLOR,
    infill: 'pales',
    postWidthPx: GARRISON_POST_WIDTH_PX,
    postCapColor: GARRISON_POST_CAP_COLOR,
    paleColor: GARRISON_PALE_COLOR,
    paleShadeColor: GARRISON_PALE_SHADE_COLOR,
  },
  // Drawn by `drawRicketyFence`, which reads its rails and colours from here
  // but bends every one of them.
  rickety: {
    railFractions: FENCE_RAIL_FRACTIONS,
    railThicknessPx: FENCE_RAIL_THICKNESS_PX,
    railColor: RICKETY_RAIL_COLOR,
    railHighlightColor: RICKETY_RAIL_HIGHLIGHT_COLOR,
    postColor: RICKETY_POST_COLOR,
    postShadeColor: RICKETY_POST_SHADE_COLOR,
    infill: 'none',
  },
};

/**
 * The style a fence tile is drawn in. Recorded on the tile by `paintYardFences`
 * from its yard's plan entry.
 *
 * The fallback is unreachable on any generated map — `TileGrid.setFence` is the
 * only writer of `FENCE` and always sets a style — and exists because the field is
 * optional on `TileContent`, which it must be: every other tile type has no style.
 */
function fenceStyleAt(structure: TileContent[][], tx: number, ty: number): FenceStyleSpec {
  const style = structure[ty]?.[tx]?.fenceStyle;
  return FENCE_STYLE_SPECS[style ?? 'post_and_rail'];
}
/** Ground shadow cast by the fence onto its own tile. */
const FENCE_SHADOW_COLOR = 'rgba(0,0,0,0.22)';
const FENCE_SHADOW_HEIGHT_PX = 3;
/** Lit edge on a rail or post: one pixel, at any tile size. */
const FENCE_HIGHLIGHT_PX = 1;
/** Height of a style's own post cap, when it has one. */
const FENCE_POST_CAP_HEIGHT_PX = 2;

/**
 * What a fence rail may run into: another fence, or something whose art fills its
 * own tile solidly enough to nail one to.
 *
 * Terminating only at fence tiles leaves a run stopping at the centre of its last
 * tile whenever the thing closing the enclosure is not itself a fence — the town
 * wall, or the side-gate torch that closes Miller's kitchen garden, where the rail
 * ended a tile and a half short of what it was supposed to meet.
 *
 * **`SPRITE_BUILDING` and `MAIN_TOWER` are deliberately absent**, and the reason is
 * the one this whole phase keeps rediscovering: a building is *one anchor tile*,
 * and that tile is the **top-left of its art rect** — transparent sky above the
 * roof. Including them fired on two tiles in the whole town, both gate cheeks that
 * happened to sit above an anchor, and hung a rail off into open verge with the
 * roof half a tile (Miller's) and 1.84 tiles (Signet's) further down, measured by
 * alpha-scanning the rendered art. Meanwhile the 43 sides that really do abut a
 * facade were untouched, because a facade tile carries the *plan's* surface type
 * rather than `SPRITE_BUILDING`.
 *
 * **Closing those sides through the sprite footprints was tried and backed out.** `getBlockedTileOffsetsByKey` is not an opacity test either:
 * `SpriteLoader` derives a footprint from the frame's whole width and height and
 * blocks all of it bar the doorway, so transparent sky and transparent side
 * columns are "blocked" exactly as solid wall is. Measured over the real grid,
 * routing `anchorsRailAt` through it gains **6** anchored sides — far short of
 * the 43 that actually abut a facade — and alpha-scanning the art at those six
 * finds three anchoring into pixels that are 0.0%, 0.0% and 1.1% opaque, which
 * is the same rail-into-open-verge defect the paragraph above records. Closing
 * them properly needs a per-tile opacity index built from the loaded images,
 * and the measured prize for building one is three fence tiles.
 */
export const FENCE_ANCHOR_TYPES: ReadonlySet<number> = new Set<number>([
  FENCE,
  TOWN_WALL,
  TORCH,
  WELL,
  FOUNTAIN,
]);

function anchorsRailAt(structure: TileContent[][], tx: number, ty: number): boolean {
  // Off-map reads land on `undefined`, which the set simply does not hold — the
  // same idiom the neighbouring tile probes in this file use.
  return FENCE_ANCHOR_TYPES.has(structure[ty]?.[tx]?.type);
}

/**
 * A post-and-rail fence tile: a post at the tile's centre, and rails running
 * from it **only towards neighbours that are also fence**.
 *
 * Every measurement here is half a tile, from the post outwards, and that is the
 * whole design. Drawing a rail edge to edge whenever the run has *either* an east
 * or a west neighbour leaves half a tile of timber hanging into open ground at
 * every run end and every corner — 34 dangling half-rails on the town's 75 fence
 * tiles. Two tiles either side of a joint each draw their own half, so a
 * continuous run still looks continuous.
 *
 * The two axes are drawn as what they are. A run seen side-on shows two rails
 * between its posts and casts its shadow across the tile. A run seen end-on is
 * foreshortened to a single line of timber with a narrow shadow under it, and its
 * post is a cap rather than the tall upright — an upright drawn on an end-on run
 * only spans 24%–84% of the tile, so the run reads as a dashed string.
 *
 * A lone tile with no fence neighbour at all is a gate cheek — a perimeter is
 * never one tile long — and draws its post alone, with no rails to nowhere on
 * either side: a cheek is exactly where a rail stops.
 */
function drawFence(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  if (structure[ty]?.[tx]?.fenceStyle === 'rickety') {
    drawRicketyFence(ctx, structure, sx, sy, ts, tx, ty);
    return;
  }
  const style = fenceStyleAt(structure, tx, ty);
  const hasWest = anchorsRailAt(structure, tx - 1, ty);
  const hasEast = anchorsRailAt(structure, tx + 1, ty);
  const hasNorth = anchorsRailAt(structure, tx, ty - 1);
  const hasSouth = anchorsRailAt(structure, tx, ty + 1);
  const runsEastWest = hasWest || hasEast;
  const runsNorthSouth = hasNorth || hasSouth;

  const centreX = sx + Math.round(ts / 2);
  const centreY = sy + Math.round(ts / 2);
  const westEdge = hasWest ? sx : centreX;
  const eastEdge = hasEast ? sx + ts : centreX;
  const northEdge = hasNorth ? sy : centreY;
  const railX = centreX - Math.floor(FENCE_RAIL_THICKNESS_PX / 2);
  const postTop = sy + Math.round(ts * FENCE_POST_TOP_FRACTION);
  const postBottom = sy + Math.round(ts * FENCE_POST_BOTTOM_FRACTION);
  const southEdge = hasSouth ? sy + ts : centreY;
  drawFenceShadow(ctx, sx, sy, ts, { hasWest, hasEast, hasNorth, hasSouth });

  if (runsEastWest) {
    for (const railFraction of style.railFractions) {
      const railY = sy + Math.round(ts * railFraction);
      ctx.fillStyle = style.railColor;
      ctx.fillRect(westEdge, railY, eastEdge - westEdge, style.railThicknessPx);
      if (style.railHighlightColor !== null) {
        ctx.fillStyle = style.railHighlightColor;
        ctx.fillRect(westEdge, railY, eastEdge - westEdge, FENCE_HIGHLIGHT_PX);
      }
    }
    drawFenceInfill(ctx, style, sx, sy, ts, westEdge, eastEdge);
  }
  if (runsNorthSouth) {
    // An end-on run is foreshortened to one line of timber whatever the style —
    // there is no infill to see edge-on — so it takes the style's colour and
    // nothing else.
    ctx.fillStyle = style.railColor;
    ctx.fillRect(railX, northEdge, FENCE_RAIL_THICKNESS_PX, southEdge - northEdge);
    ctx.fillStyle = style.railHighlightColor ?? style.postShadeColor;
    ctx.fillRect(railX, northEdge, FENCE_HIGHLIGHT_PX, southEdge - northEdge);
  }

  const postWidthPx = style.postWidthPx ?? FENCE_POST_WIDTH_PX;
  const postX = centreX - Math.floor(postWidthPx / 2);
  // An end-on run shows the post's cap, not its full height. A corner counts as
  // side-on: it has an east-west rail to carry, so it needs the upright.
  const top = runsEastWest || !runsNorthSouth ? postTop : centreY - postWidthPx;
  const bottom = runsEastWest || !runsNorthSouth ? postBottom : centreY + postWidthPx;
  ctx.fillStyle = style.postColor;
  ctx.fillRect(postX, top, postWidthPx, bottom - top);
  ctx.fillStyle = style.postShadeColor;
  ctx.fillRect(postX + postWidthPx - FENCE_HIGHLIGHT_PX, top, FENCE_HIGHLIGHT_PX, bottom - top);
  // A fitted cap on the post's own top — the joinery detail that reads as
  // "someone finished this" rather than a stake driven into the ground.
  if (style.postCapColor !== undefined) {
    ctx.fillStyle = style.postCapColor;
    ctx.fillRect(postX - 1, top, postWidthPx + 2, FENCE_POST_CAP_HEIGHT_PX);
  }
}

interface FenceNeighbours {
  readonly hasWest: boolean;
  readonly hasEast: boolean;
  readonly hasNorth: boolean;
  readonly hasSouth: boolean;
}

/** The ground shadow a fence tile casts on its own tile, shared by every style. */
function drawFenceShadow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  { hasWest, hasEast, hasNorth, hasSouth }: FenceNeighbours,
): void {
  const runsEastWest = hasWest || hasEast;
  const runsNorthSouth = hasNorth || hasSouth;
  const centreX = sx + Math.round(ts / 2);
  const centreY = sy + Math.round(ts / 2);
  const westEdge = hasWest ? sx : centreX;
  const eastEdge = hasEast ? sx + ts : centreX;
  const northEdge = hasNorth ? sy : centreY;
  const postBottom = sy + Math.round(ts * FENCE_POST_BOTTOM_FRACTION);
  // The shadow's band, unlike the rail's, has to reach down to the east-west bar
  // on a corner, or the two leave an 8 px nick where the run turns. They are
  // drawn as one path, so the overlap costs nothing.
  const shadowSouthEdge = hasSouth ? sy + ts : runsEastWest ? postBottom : centreY;

  // One path, two rectangles: filled twice, the shared corner composites to 0.39
  // alpha against 0.22 either side and reads as a smudge. Nonzero winding fills
  // the union exactly once.
  ctx.fillStyle = FENCE_SHADOW_COLOR;
  ctx.beginPath();
  if (runsEastWest) {
    ctx.rect(
      westEdge,
      postBottom - FENCE_SHADOW_HEIGHT_PX,
      eastEdge - westEdge,
      FENCE_SHADOW_HEIGHT_PX,
    );
  }
  if (!runsEastWest && !runsNorthSouth) {
    // A gate cheek stands on its own and still needs a shadow, or it reads as
    // floating.
    ctx.rect(
      centreX - FENCE_POST_WIDTH_PX,
      postBottom - FENCE_SHADOW_HEIGHT_PX,
      FENCE_POST_WIDTH_PX * 2,
      FENCE_SHADOW_HEIGHT_PX,
    );
  }
  if (runsNorthSouth) {
    ctx.rect(
      centreX - FENCE_POST_WIDTH_PX,
      northEdge,
      FENCE_POST_WIDTH_PX * 2,
      shadowSouthEdge - northEdge,
    );
  }
  ctx.fill();
}

// ── Rickety fence ────────────────────────────────────────────────────────────

/** Salts for the rickety fence's per-tile and per-joint choices, so each varies independently. */
const RICKETY_SALT = {
  lean: 0x51c1,
  height: 0x51c2,
  propped: 0x51c3,
  twine: 0x51c4,
  sag: 0x51c5,
  damage: 0x51c6,
  wireSlack: 0x51c7,
  split: 0x51c8,
  wireSnapped: 0x51c9,
  topSag: 0x51ca,
  stump: 0x51cb,
  fallenEnd: 0x51cc,
  rotPhase: 0x51cd,
  plankTilt: 0x51ce,
  weeds: 0x51cf,
} as const;

/** How far a post's top may lean off its foot, as a fraction of the tile, either way. */
const RICKETY_MAX_LEAN_FRACTION = 0.1;
/** Extra lean on a post that has settled onto a stone. */
const RICKETY_PROPPED_LEAN_FRACTION = 0.12;
/**
 * How much shorter than a sound post a rickety one may stand, as a fraction of
 * the tile. Small enough that every whole post still reaches the top rail.
 */
const RICKETY_HEIGHT_SPREAD_FRACTION = 0.1;
const RICKETY_POST_WIDTH_PX = 4;
/**
 * A post snapped off above the lower rail: its broken top stands this far down
 * the tile, so the lower rail still has something to hang from and the top
 * rail does not.
 */
const RICKETY_STUMP_TOP_FRACTION = 0.5;
const RICKETY_STUMP_SHARE = 0.18;
/** The split top: one shoulder of the post stands this much lower than the other. */
const RICKETY_SPLIT_DROP_PX = 3;
/** The crack down a split post's face, as a share of the post's height. */
const RICKETY_CRACK_SHARE = 0.4;
/** Share of posts propped on a stone, share carrying a twine patch, share of posts split. */
const RICKETY_PROPPED_SHARE = 0.14;
const RICKETY_TWINE_SHARE = 0.3;
const RICKETY_SPLIT_SHARE = 0.55;
/**
 * How far the lower rail sags at the middle of a span between two rickety
 * posts, as a fraction of the tile — between a floor and the floor plus a
 * spread, chosen per joint.
 */
const RICKETY_SAG_MIN_FRACTION = 0.03;
const RICKETY_SAG_SPREAD_FRACTION = 0.12;
/**
 * The top rail sags less than the lower one — it is the rail that gets leaned
 * on and re-nailed — up to this fraction of the tile at mid-span.
 */
const RICKETY_TOP_SAG_SPREAD_FRACTION = 0.05;
/**
 * What has happened to a side-on span between two rickety posts, as shares of
 * the joints: both rails gone, the top rail fallen from one post, the lower
 * rail snapped in two. The rest merely sag. Most spans are damaged on purpose —
 * a run with only the odd break reads as an old fence, not a broken one.
 */
const RICKETY_GAP_SHARE = 0.2;
const RICKETY_TOP_FALLEN_SHARE = 0.25;
const RICKETY_LOW_SNAPPED_SHARE = 0.25;
/** Which post a fallen top rail let go of, when no stump decides it. */
const RICKETY_FALLEN_AT_SECOND_SHARE = 0.5;
/** Share of end-on joints whose rail is gone, leaving only wire and a plank on the ground. */
const RICKETY_END_ON_GAP_SHARE = 0.35;
/** A snapped rail end reaches this share of the way to mid-span and hangs this far. */
const RICKETY_BROKEN_REACH_SHARE = 0.7;
const RICKETY_BROKEN_DROP_FRACTION = 0.2;
/**
 * Where a fallen rail or plank lies on the grass, as a fraction down the tile:
 * just below the posts' feet and still inside the tile, so none of it is drawn
 * over ground the player can stand on.
 */
const RICKETY_GROUND_FRACTION = 0.88;
/** A fallen plank lies askew by up to this much, end to end, either way. */
const RICKETY_PLANK_TILT_PX = 2;
/** A dropped rail end rests this far clear of the post it fell from. */
const RICKETY_FALLEN_CLEARANCE_PX = 1;
/** An end-on plank on the ground crosses its joint at this slant, in px either side of it. */
const RICKETY_END_ON_PLANK_HALF_WIDTH_PX = 4;
const RICKETY_END_ON_PLANK_HALF_HEIGHT_PX = 7;
/** A snapped end is a raw, paler break with a splinter standing proud of it. */
const RICKETY_SPLINTER_PX = 2;
/**
 * The two wire strands, as fractions down the tile: between and below the
 * rails, where they still mark the line through a span whose rails are gone.
 */
const RICKETY_WIRE_FRACTIONS = [0.46, 0.74] as const;
/** Slack in a wire strand at mid-span: a floor plus a spread, per joint. */
const RICKETY_WIRE_SLACK_MIN_FRACTION = 0.02;
const RICKETY_WIRE_SLACK_SPREAD_FRACTION = 0.05;
/** Share of wire strands that have snapped at a joint, leaving a gap in that strand. */
const RICKETY_WIRE_SNAPPED_SHARE = 0.3;
/** Old galvanised wire gone dull: dark enough to read against the grass as strands. */
const RICKETY_WIRE_COLOR = '#3f3e3a';
const RICKETY_WIRE_PX = 1;
/** Turns of wire twisted round the post where each strand is fixed. */
const RICKETY_WIRE_TWIST_TURNS = 2;
const RICKETY_WIRE_TWIST_STEP_PX = 2;
/** Twine lashed round a post-and-rail joint: a few pale turns crossing it. */
const RICKETY_TWINE_COLOR = '#d2bb82';
const RICKETY_TWINE_TURNS = 3;
const RICKETY_TWINE_STEP_PX = 2;
const RICKETY_TWINE_HALF_WIDTH_PX = 4;
const RICKETY_TWINE_SLANT_PX = 2;
/** The stone a settled post is propped on. */
const RICKETY_STONE_COLOR = '#7d837a';
const RICKETY_STONE_LIGHT_COLOR = '#a4a99e';
const RICKETY_STONE_DARK_COLOR = '#4d524b';
const RICKETY_STONE_RX_PX = 5;
const RICKETY_STONE_RY_PX = 3;
/** The stone's shaded underside shows this far below it; its lit crown is offset the same way up. */
const RICKETY_STONE_SHADE_DROP_PX = 1;
const RICKETY_STONE_LIT_SHARE = 0.5;
/** The end-on run's timber kinks off its line at the post by up to this, either way. */
const RICKETY_END_ON_WOBBLE_PX = 2;
/** An end-on run's wire strand runs this far east of its rail. */
const RICKETY_END_ON_WIRE_OFFSET_PX = 3;
/** Seen end-on, a strand's slack is foreshortened to a sideways bow of this share of it. */
const RICKETY_END_ON_BOW_SHARE = 0.5;
/**
 * Rot along a rail, drawn as a dash pattern down its length so both tiles of a
 * span, drawing the same path, put every blotch in the same place. Dash, gap,
 * dash, gap: two blotches of different lengths at uneven spacing, so the rot
 * does not read as a stripe.
 */
const RICKETY_ROT_PATTERN_PX = [2, 7, 4, 15] as const;
const RICKETY_ROT_PERIOD_PX = RICKETY_ROT_PATTERN_PX.reduce((sum, length) => sum + length, 0);
const RICKETY_ROT_WIDTH_PX = 2;
/** Moss along a rail's upper face, sparser and longer than the rot. */
const RICKETY_MOSS_DASH_PX = 4;
const RICKETY_MOSS_GAP_PX = 9;
/** Moss climbing a post from the grass. */
const RICKETY_POST_MOSS_HEIGHT_PX = 4;
/** Long grass left uncut round a post: each blade's offset from the foot and height, in px. */
const RICKETY_WEED_BLADES = [
  { offsetPx: -3, heightPx: 5 },
  { offsetPx: -1, heightPx: 7 },
  { offsetPx: 2, heightPx: 6 },
  { offsetPx: 4, heightPx: 4 },
] as const;
const RICKETY_WEED_LEAN_PX = 2;
const RICKETY_WEED_SHARE = 0.65;

/** One rickety tile's upright post, in screen pixels. */
interface RicketyPost {
  /** The post's foot, where it meets the ground. */
  readonly footX: number;
  readonly top: number;
  readonly bottom: number;
  /** How far the post's top stands off its foot, in px, east positive. */
  readonly leanPx: number;
  readonly propped: boolean;
  readonly split: boolean;
  readonly stump: boolean;
}

function isRicketyFenceAt(structure: TileContent[][], tx: number, ty: number): boolean {
  return structure[ty]?.[tx]?.type === FENCE && structure[ty]?.[tx]?.fenceStyle === 'rickety';
}

/** A signed value in [-1, 1) from a tile hash. */
function signedHash(tx: number, ty: number, salt: number): number {
  return tileHash01(tx, ty, salt) * 2 - 1;
}

/**
 * The upright post of the rickety tile at (`tx`, `ty`), whose top-left corner
 * is drawn at (`sx`, `sy`). A function of position only, so the tile beside it
 * can work out exactly where this post stands and hang a span off it.
 */
function ricketyPost(tx: number, ty: number, sx: number, sy: number, ts: number): RicketyPost {
  const propped = tileHash01(tx, ty, RICKETY_SALT.propped) < RICKETY_PROPPED_SHARE;
  const stump = tileHash01(tx, ty, RICKETY_SALT.stump) < RICKETY_STUMP_SHARE;
  const leanFraction =
    signedHash(tx, ty, RICKETY_SALT.lean) * RICKETY_MAX_LEAN_FRACTION +
    (propped ? RICKETY_PROPPED_LEAN_FRACTION : 0);
  const wholeTopFraction =
    FENCE_POST_TOP_FRACTION +
    tileHash01(tx, ty, RICKETY_SALT.height) * RICKETY_HEIGHT_SPREAD_FRACTION;
  const stoneTop = sy + Math.round(ts * FENCE_POST_BOTTOM_FRACTION) - RICKETY_STONE_RY_PX * 2;
  return {
    footX: sx + Math.round(ts / 2),
    top: sy + Math.round(ts * (stump ? RICKETY_STUMP_TOP_FRACTION : wholeTopFraction)),
    bottom: propped
      ? stoneTop + RICKETY_STONE_RY_PX
      : sy + Math.round(ts * FENCE_POST_BOTTOM_FRACTION),
    leanPx: Math.round(ts * leanFraction),
    propped,
    split: tileHash01(tx, ty, RICKETY_SALT.split) < RICKETY_SPLIT_SHARE,
    stump,
  };
}

/** Where a post's centreline crosses height `y`, allowing for its lean. */
function ricketyPostXAt(post: RicketyPost, y: number): number {
  const postHeight = Math.max(1, post.bottom - post.top);
  return post.footX + (post.leanPx * (post.bottom - y)) / postHeight;
}

type RicketyDamage = 'sagging' | 'low_snapped' | 'top_fallen' | 'gap';

/**
 * One span between two rickety tiles, and everything both sides must agree on.
 *
 * Every choice is keyed on the **joint** — hashed from the west (or north)
 * tile of the pair and an axis salt — and on the two posts, which are a
 * function of position. Each tile draws the whole span, clipped to itself, so
 * the half one tile draws meets the half its neighbour draws exactly, however
 * crooked the timber between them.
 */
interface RicketyJoint {
  readonly damage: RicketyDamage;
  /** For `top_fallen`: the top rail has let go of the second (east or south) post rather than the first. */
  readonly fallenAtSecond: boolean;
  /** How far each rail hangs below its line at mid-span, in px. */
  readonly topSagPx: number;
  readonly sagPx: number;
  /** Each wire strand's slack at mid-span, in px, or null where that strand has snapped. */
  readonly wireSlackPx: ReadonlyArray<number | null>;
  /** How far a plank on the ground lies askew, in px, signed. */
  readonly plankTiltPx: number;
  /** Where along the rails the rot pattern starts, so no two spans are blotched alike. */
  readonly rotPhasePx: number;
}

/** Keeps an east-west joint's hashes apart from a north-south joint's at the same tile. */
const RICKETY_EAST_WEST_AXIS = 0;
const RICKETY_NORTH_SOUTH_AXIS = 0x100;

/**
 * What has happened to a side-on span. A stump cannot hold a top rail, so a
 * span onto one has always lost it — dropped at the stump's end, or entirely
 * when both posts are stumps.
 */
function sideOnDamage(
  first: RicketyPost,
  second: RicketyPost,
  roll: number,
): Pick<RicketyJoint, 'damage'> & { readonly fallenAtSecond: boolean | null } {
  if (first.stump && second.stump) return { damage: 'gap', fallenAtSecond: false };
  if (first.stump || second.stump) return { damage: 'top_fallen', fallenAtSecond: second.stump };
  if (roll < RICKETY_GAP_SHARE) return { damage: 'gap', fallenAtSecond: false };
  const topFallenCeiling = RICKETY_GAP_SHARE + RICKETY_TOP_FALLEN_SHARE;
  if (roll < topFallenCeiling) return { damage: 'top_fallen', fallenAtSecond: null };
  if (roll < topFallenCeiling + RICKETY_LOW_SNAPPED_SHARE) {
    return { damage: 'low_snapped', fallenAtSecond: false };
  }
  return { damage: 'sagging', fallenAtSecond: false };
}

/**
 * The joint between two adjacent tiles, or null where either side is not
 * rickety — a rebuilt section, or the thing a run ends against — and the
 * joint is sound: the rail meets it at the standard height and no wire crosses.
 *
 * `first`/`second` are the posts either side; an end-on joint passes null,
 * because its posts are caps and it only has two outcomes.
 */
function ricketyJoint(
  structure: TileContent[][],
  firstTx: number,
  firstTy: number,
  secondTx: number,
  secondTy: number,
  axisSalt: number,
  ts: number,
  posts: { readonly first: RicketyPost; readonly second: RicketyPost } | null,
): RicketyJoint | null {
  const bothRickety =
    isRicketyFenceAt(structure, firstTx, firstTy) &&
    isRicketyFenceAt(structure, secondTx, secondTy);
  if (!bothRickety) return null;
  const hash = (salt: number): number => tileHash01(firstTx, firstTy, salt + axisSalt);
  const roll = hash(RICKETY_SALT.damage);
  let damage: RicketyDamage;
  let fallenAtSecond = hash(RICKETY_SALT.fallenEnd) < RICKETY_FALLEN_AT_SECOND_SHARE;
  if (posts === null) {
    damage = roll < RICKETY_END_ON_GAP_SHARE ? 'gap' : 'sagging';
  } else {
    const outcome = sideOnDamage(posts.first, posts.second, roll);
    damage = outcome.damage;
    fallenAtSecond = outcome.fallenAtSecond ?? fallenAtSecond;
  }
  const wireSlackPx = RICKETY_WIRE_FRACTIONS.map((_fraction, strand) => {
    // A span with no rails left keeps its first strand, or the run would
    // simply stop there and read as a gateway.
    const mustHold = damage === 'gap' && strand === 0;
    const snapped =
      !mustHold && hash(RICKETY_SALT.wireSnapped + strand) < RICKETY_WIRE_SNAPPED_SHARE;
    if (snapped) return null;
    const slackShare = hash(RICKETY_SALT.wireSlack + strand);
    return ts * (RICKETY_WIRE_SLACK_MIN_FRACTION + slackShare * RICKETY_WIRE_SLACK_SPREAD_FRACTION);
  });
  return {
    damage,
    fallenAtSecond,
    topSagPx: Math.round(ts * hash(RICKETY_SALT.topSag) * RICKETY_TOP_SAG_SPREAD_FRACTION),
    sagPx: Math.round(
      ts * (RICKETY_SAG_MIN_FRACTION + hash(RICKETY_SALT.sag) * RICKETY_SAG_SPREAD_FRACTION),
    ),
    wireSlackPx,
    plankTiltPx: Math.round(
      signedHash(firstTx, firstTy, RICKETY_SALT.plankTilt + axisSalt) * RICKETY_PLANK_TILT_PX,
    ),
    rotPhasePx: hash(RICKETY_SALT.rotPhase) * RICKETY_ROT_PERIOD_PX,
  };
}

/**
 * A timber stroked along a path: its weathered underside, its body, a lit top
 * edge, then rot and moss laid along it as dash patterns. `trace` draws the
 * path lifted by `liftPx`.
 */
function strokeRicketyTimber(
  ctx: CanvasRenderingContext2D,
  rotPhasePx: number,
  trace: (liftPx: number) => void,
): void {
  const halfBody = (FENCE_RAIL_THICKNESS_PX - FENCE_HIGHLIGHT_PX) / 2;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = RICKETY_RAIL_COLOR;
  ctx.lineWidth = FENCE_RAIL_THICKNESS_PX;
  ctx.beginPath();
  trace(0);
  ctx.stroke();
  ctx.strokeStyle = RICKETY_RAIL_UNDERSIDE_COLOR;
  ctx.lineWidth = FENCE_HIGHLIGHT_PX;
  ctx.beginPath();
  trace(halfBody);
  ctx.stroke();
  ctx.strokeStyle = RICKETY_RAIL_HIGHLIGHT_COLOR;
  ctx.beginPath();
  trace(-halfBody);
  ctx.stroke();

  ctx.lineDashOffset = rotPhasePx;
  ctx.setLineDash([...RICKETY_ROT_PATTERN_PX]);
  ctx.strokeStyle = RICKETY_ROT_COLOR;
  ctx.lineWidth = RICKETY_ROT_WIDTH_PX;
  ctx.beginPath();
  trace(FENCE_HIGHLIGHT_PX / 2);
  ctx.stroke();
  ctx.setLineDash([RICKETY_MOSS_DASH_PX, RICKETY_MOSS_GAP_PX]);
  ctx.strokeStyle = RICKETY_MOSS_COLOR;
  ctx.lineWidth = FENCE_HIGHLIGHT_PX;
  ctx.beginPath();
  trace(-halfBody);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/** The raw end of a snapped timber: a pale break with a splinter standing proud of it, pointing `dirX`. */
function drawRicketySplinter(
  ctx: CanvasRenderingContext2D,
  endX: number,
  endY: number,
  dirX: number,
): void {
  ctx.strokeStyle = RICKETY_RAIL_HIGHLIGHT_COLOR;
  ctx.lineWidth = FENCE_HIGHLIGHT_PX;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(endX, endY - FENCE_HIGHLIGHT_PX);
  ctx.lineTo(endX + dirX * RICKETY_SPLINTER_PX, endY - FENCE_HIGHLIGHT_PX * 2);
  ctx.moveTo(endX, endY + FENCE_HIGHLIGHT_PX);
  ctx.lineTo(endX + (dirX * RICKETY_SPLINTER_PX) / 2, endY + FENCE_HIGHLIGHT_PX);
  ctx.stroke();
}

/** A sagging timber between two points, lowest `sagPx` below them at mid-span. */
function traceSaggingSpan(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  toX: number,
  y: number,
  sagPx: number,
  liftPx: number,
): void {
  // A quadratic's midpoint sits halfway to its control point.
  const controlDrop = sagPx * 2;
  ctx.moveTo(fromX, y + liftPx);
  ctx.quadraticCurveTo((fromX + toX) / 2, y + controlDrop + liftPx, toX, y + liftPx);
}

function strokeWireSpan(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  controlX: number,
  controlY: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = RICKETY_WIRE_PX;
  ctx.strokeStyle = RICKETY_WIRE_COLOR;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(controlX, controlY, toX, toY);
  ctx.stroke();
}

/** Where a wire strand is fixed to a post: at its height, or on a stump's broken top. */
function wireFixY(post: RicketyPost, wireY: number): number {
  return Math.max(wireY, post.top + FENCE_HIGHLIGHT_PX);
}

/**
 * The whole side-on span between two rickety posts, `first` to the west. The
 * caller clips to its own tile, and the neighbour draws the same span clipped
 * to its tile, so between them the span is drawn once.
 */
function drawRicketySideOnSpan(
  ctx: CanvasRenderingContext2D,
  first: RicketyPost,
  second: RicketyPost,
  joint: RicketyJoint,
  sy: number,
  ts: number,
): void {
  const [topRailFraction, lowRailFraction] = FENCE_RAIL_FRACTIONS;
  const topRailY = sy + Math.round(ts * topRailFraction);
  const lowRailY = sy + Math.round(ts * lowRailFraction);
  const groundY = sy + Math.round(ts * RICKETY_GROUND_FRACTION);
  const postClearance = RICKETY_POST_WIDTH_PX / 2 + RICKETY_FALLEN_CLEARANCE_PX;

  if (joint.damage === 'gap') {
    const fromX = first.footX + postClearance;
    const toX = second.footX - postClearance;
    strokeRicketyTimber(ctx, joint.rotPhasePx, (liftPx) => {
      ctx.moveTo(fromX, groundY - joint.plankTiltPx + liftPx);
      ctx.lineTo(toX, groundY + joint.plankTiltPx + liftPx);
    });
  }

  RICKETY_WIRE_FRACTIONS.forEach((fraction, strand) => {
    const slackPx = joint.wireSlackPx[strand];
    if (slackPx === null) return;
    const wireY = sy + Math.round(ts * fraction);
    const fromY = wireFixY(first, wireY);
    const toY = wireFixY(second, wireY);
    const fromX = ricketyPostXAt(first, fromY);
    const toX = ricketyPostXAt(second, toY);
    strokeWireSpan(ctx, fromX, fromY, toX, toY, (fromX + toX) / 2, (fromY + toY) / 2 + slackPx * 2);
  });

  if (joint.damage === 'low_snapped') {
    for (const [post, towards] of [
      [first, second],
      [second, first],
    ] as const) {
      const postX = ricketyPostXAt(post, lowRailY);
      const midX = (postX + ricketyPostXAt(towards, lowRailY)) / 2;
      const endX = postX + (midX - postX) * RICKETY_BROKEN_REACH_SHARE;
      const endY = lowRailY + Math.round(ts * RICKETY_BROKEN_DROP_FRACTION);
      strokeRicketyTimber(ctx, joint.rotPhasePx, (liftPx) => {
        ctx.moveTo(postX, lowRailY + liftPx);
        ctx.lineTo(endX, endY + liftPx);
      });
      drawRicketySplinter(ctx, endX, endY, Math.sign(midX - postX));
    }
  } else if (joint.damage !== 'gap') {
    const fromX = ricketyPostXAt(first, lowRailY);
    const toX = ricketyPostXAt(second, lowRailY);
    strokeRicketyTimber(ctx, joint.rotPhasePx, (liftPx) =>
      traceSaggingSpan(ctx, fromX, toX, lowRailY, joint.sagPx, liftPx),
    );
  }

  if (joint.damage === 'top_fallen') {
    const held = joint.fallenAtSecond ? first : second;
    const dropped = joint.fallenAtSecond ? second : first;
    const heldX = ricketyPostXAt(held, topRailY);
    const towardsHeld = Math.sign(held.footX - dropped.footX);
    const restX = dropped.footX + towardsHeld * postClearance;
    strokeRicketyTimber(ctx, joint.rotPhasePx, (liftPx) => {
      ctx.moveTo(heldX, topRailY + liftPx);
      ctx.lineTo(restX, groundY + liftPx);
    });
  } else if (joint.damage === 'sagging' || joint.damage === 'low_snapped') {
    const fromX = ricketyPostXAt(first, topRailY);
    const toX = ricketyPostXAt(second, topRailY);
    strokeRicketyTimber(ctx, joint.rotPhasePx, (liftPx) =>
      traceSaggingSpan(ctx, fromX, toX, topRailY, joint.topSagPx, liftPx),
    );
  }
}

/**
 * Half a span from a rickety post to a sound joint — a rebuilt section, or the
 * wall a run ends against — at the standard rail heights, since that is where
 * the sound side's rails arrive. A stump holds its half of the top rail on its
 * broken top.
 */
function drawRicketySoundHalf(
  ctx: CanvasRenderingContext2D,
  post: RicketyPost,
  edgeX: number,
  sy: number,
  ts: number,
): void {
  for (const railFraction of FENCE_RAIL_FRACTIONS) {
    const railY = sy + Math.round(ts * railFraction);
    const fixY = Math.max(railY, post.top + FENCE_HIGHLIGHT_PX);
    const postX = ricketyPostXAt(post, fixY);
    strokeRicketyTimber(ctx, 0, (liftPx) => {
      ctx.moveTo(postX, fixY + liftPx);
      ctx.lineTo(edgeX, railY + liftPx);
    });
  }
}

/** The upright post itself: leaning, split or snapped off, mossed at the foot, in long grass. */
function drawRicketyUpright(
  ctx: CanvasRenderingContext2D,
  post: RicketyPost,
  tx: number,
  ty: number,
): void {
  const halfWidth = RICKETY_POST_WIDTH_PX / 2;
  const topX = post.footX + post.leanPx;
  const splitDrop = post.split ? RICKETY_SPLIT_DROP_PX : 0;
  ctx.fillStyle = RICKETY_POST_COLOR;
  ctx.beginPath();
  ctx.moveTo(post.footX - halfWidth, post.bottom);
  ctx.lineTo(post.footX + halfWidth, post.bottom);
  ctx.lineTo(topX + halfWidth, post.top + splitDrop);
  ctx.lineTo(topX - halfWidth, post.top);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = RICKETY_MOSS_COLOR;
  ctx.fillRect(
    post.footX - halfWidth,
    post.bottom - RICKETY_POST_MOSS_HEIGHT_PX,
    RICKETY_POST_WIDTH_PX - FENCE_HIGHLIGHT_PX,
    RICKETY_POST_MOSS_HEIGHT_PX,
  );

  ctx.strokeStyle = RICKETY_POST_SHADE_COLOR;
  ctx.lineWidth = FENCE_HIGHLIGHT_PX;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(post.footX + halfWidth - FENCE_HIGHLIGHT_PX / 2, post.bottom);
  ctx.lineTo(topX + halfWidth - FENCE_HIGHLIGHT_PX / 2, post.top + splitDrop);
  ctx.stroke();
  if (post.split && !post.stump) {
    const crackBottom = post.top + (post.bottom - post.top) * RICKETY_CRACK_SHARE;
    ctx.beginPath();
    ctx.moveTo(ricketyPostXAt(post, post.top), post.top);
    ctx.lineTo(ricketyPostXAt(post, crackBottom), crackBottom);
    ctx.stroke();
  }
  if (post.stump) {
    // The break is fresh wood against the grey: the one pale mark on a stump,
    // and what says "snapped" rather than "short".
    ctx.strokeStyle = RICKETY_RAIL_HIGHLIGHT_COLOR;
    ctx.beginPath();
    ctx.moveTo(topX - halfWidth, post.top + FENCE_HIGHLIGHT_PX);
    ctx.lineTo(topX - FENCE_HIGHLIGHT_PX, post.top - FENCE_HIGHLIGHT_PX);
    ctx.lineTo(topX, post.top + splitDrop);
    ctx.lineTo(topX + halfWidth, post.top + splitDrop - FENCE_HIGHLIGHT_PX);
    ctx.stroke();
  }

  if (tileHash01(tx, ty, RICKETY_SALT.weeds) >= RICKETY_WEED_SHARE) return;
  RICKETY_WEED_BLADES.forEach(({ offsetPx, heightPx }, blade) => {
    const leanPx = Math.round(
      signedHash(tx, ty, RICKETY_SALT.weeds + blade) * RICKETY_WEED_LEAN_PX,
    );
    const bladeX = post.footX + offsetPx;
    ctx.strokeStyle = blade % 2 === 0 ? RICKETY_WEED_COLOR : RICKETY_WEED_LIGHT_COLOR;
    ctx.beginPath();
    ctx.moveTo(bladeX, post.bottom);
    ctx.lineTo(bladeX + leanPx, post.bottom - heightPx);
    ctx.stroke();
  });
}

/**
 * A rickety fence tile: the pasture's old fence, before anyone rebuilds it.
 *
 * It follows every rule `drawFence` does — a post at the centre, timber only
 * towards neighbours that anchor a rail, nothing past the tile's own edge — so
 * it joins every other style the same way, and a run that is part rebuilt
 * stays one line. What it adds is age and damage, all of it seeded by position:
 *
 * - the timber is bleached grey and near-black where the rebuilt fence is warm
 *   brown, blotched with rot and moss, with long grass round the posts;
 * - posts lean off their feet, stand at different heights, some split at the
 *   top and some snapped off short;
 * - most spans are broken: rails sag, the lower one snaps and hangs in two
 *   ends, the top one drops from a post and lies slantwise to the ground, or
 *   both are gone and a plank lies in the grass;
 * - slack wire twisted round the posts droops across every span, so a span
 *   with its rails gone still reads as a boundary;
 * - some posts carry a twine patch, and a few have settled onto a stone.
 *
 * A span belongs to both tiles either side of it, and each draws the whole of
 * it clipped to itself; nothing here depends on any tile further away than a
 * neighbour, so re-baking a restyled tile's eight neighbours is enough.
 */
function drawRicketyFence(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const neighbours: FenceNeighbours = {
    hasWest: anchorsRailAt(structure, tx - 1, ty),
    hasEast: anchorsRailAt(structure, tx + 1, ty),
    hasNorth: anchorsRailAt(structure, tx, ty - 1),
    hasSouth: anchorsRailAt(structure, tx, ty + 1),
  };
  drawFenceShadow(ctx, sx, sy, ts, neighbours);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    drawRicketyFenceClipped(ctx, structure, sx, sy, ts, tx, ty, neighbours);
  } finally {
    ctx.restore();
  }
}

function drawRicketyFenceClipped(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  { hasWest, hasEast, hasNorth, hasSouth }: FenceNeighbours,
): void {
  const runsEastWest = hasWest || hasEast;
  const runsNorthSouth = hasNorth || hasSouth;
  const centreX = sx + Math.round(ts / 2);
  const centreY = sy + Math.round(ts / 2);
  // A side-on post stands its full height; an end-on run shows only a cap, as
  // `drawFence` explains, and a cap has too little height to lean or snap.
  const upright = runsEastWest || !runsNorthSouth;
  const post = ricketyPost(tx, ty, sx, sy, ts);

  let anyWire = false;
  if (runsEastWest) {
    const westPost = ricketyPost(tx - 1, ty, sx - ts, sy, ts);
    const eastPost = ricketyPost(tx + 1, ty, sx + ts, sy, ts);
    const sides = [
      {
        present: hasWest,
        edgeX: sx,
        first: westPost,
        second: post,
        joint: ricketyJoint(structure, tx - 1, ty, tx, ty, RICKETY_EAST_WEST_AXIS, ts, {
          first: westPost,
          second: post,
        }),
      },
      {
        present: hasEast,
        edgeX: sx + ts,
        first: post,
        second: eastPost,
        joint: ricketyJoint(structure, tx, ty, tx + 1, ty, RICKETY_EAST_WEST_AXIS, ts, {
          first: post,
          second: eastPost,
        }),
      },
    ];
    for (const side of sides) {
      if (!side.present) continue;
      if (side.joint === null) {
        drawRicketySoundHalf(ctx, post, side.edgeX, sy, ts);
        continue;
      }
      anyWire = true;
      drawRicketySideOnSpan(ctx, side.first, side.second, side.joint, sy, ts);
    }
  }

  if (runsNorthSouth) {
    // The centre of the rail rectangle every other style draws end-on, so a
    // rebuilt neighbour's rail meets this one at the joint.
    const railX = centreX - Math.floor(FENCE_RAIL_THICKNESS_PX / 2) + FENCE_RAIL_THICKNESS_PX / 2;
    const wobblePx = Math.round(signedHash(tx, ty, RICKETY_SALT.lean) * RICKETY_END_ON_WOBBLE_PX);
    const northJoint = ricketyJoint(
      structure,
      tx,
      ty - 1,
      tx,
      ty,
      RICKETY_NORTH_SOUTH_AXIS,
      ts,
      null,
    );
    const southJoint = ricketyJoint(
      structure,
      tx,
      ty,
      tx,
      ty + 1,
      RICKETY_NORTH_SOUTH_AXIS,
      ts,
      null,
    );
    const halves = [
      { present: hasNorth, joint: northJoint, edgeY: sy },
      { present: hasSouth, joint: southJoint, edgeY: sy + ts },
    ];
    for (const { present, joint, edgeY } of halves) {
      if (!present) continue;
      if (joint?.damage === 'gap') {
        const slantX =
          joint.plankTiltPx >= 0
            ? RICKETY_END_ON_PLANK_HALF_WIDTH_PX
            : -RICKETY_END_ON_PLANK_HALF_WIDTH_PX;
        strokeRicketyTimber(ctx, joint.rotPhasePx, (liftPx) => {
          ctx.moveTo(railX - slantX, edgeY - RICKETY_END_ON_PLANK_HALF_HEIGHT_PX + liftPx);
          ctx.lineTo(railX + slantX, edgeY + RICKETY_END_ON_PLANK_HALF_HEIGHT_PX + liftPx);
        });
      } else {
        const rotPhasePx = joint?.rotPhasePx ?? 0;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = RICKETY_RAIL_COLOR;
        ctx.lineWidth = FENCE_RAIL_THICKNESS_PX;
        ctx.beginPath();
        ctx.moveTo(railX, edgeY);
        ctx.lineTo(railX + wobblePx, centreY);
        ctx.stroke();
        const shadeOffset = (FENCE_RAIL_THICKNESS_PX - FENCE_HIGHLIGHT_PX) / 2;
        ctx.lineWidth = FENCE_HIGHLIGHT_PX;
        ctx.strokeStyle = RICKETY_RAIL_HIGHLIGHT_COLOR;
        ctx.beginPath();
        ctx.moveTo(railX - shadeOffset, edgeY);
        ctx.lineTo(railX + wobblePx - shadeOffset, centreY);
        ctx.stroke();
        ctx.strokeStyle = RICKETY_RAIL_UNDERSIDE_COLOR;
        ctx.beginPath();
        ctx.moveTo(railX + shadeOffset, edgeY);
        ctx.lineTo(railX + wobblePx + shadeOffset, centreY);
        ctx.stroke();
        ctx.lineDashOffset = rotPhasePx;
        ctx.setLineDash([...RICKETY_ROT_PATTERN_PX]);
        ctx.strokeStyle = RICKETY_ROT_COLOR;
        ctx.lineWidth = RICKETY_ROT_WIDTH_PX;
        ctx.beginPath();
        ctx.moveTo(railX, edgeY);
        ctx.lineTo(railX + wobblePx, centreY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      const slackPx = joint?.wireSlackPx[0];
      if (slackPx === undefined || slackPx === null) continue;
      const wireX = railX + RICKETY_END_ON_WIRE_OFFSET_PX;
      const bowX = wireX + slackPx * RICKETY_END_ON_BOW_SHARE;
      strokeWireSpan(ctx, wireX, centreY, bowX, edgeY, bowX, (centreY + edgeY) / 2);
    }
  }

  if (post.propped && upright) {
    const stoneY = post.bottom;
    ctx.fillStyle = RICKETY_STONE_DARK_COLOR;
    ctx.beginPath();
    ctx.ellipse(
      centreX,
      stoneY + RICKETY_STONE_SHADE_DROP_PX,
      RICKETY_STONE_RX_PX,
      RICKETY_STONE_RY_PX,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = RICKETY_STONE_COLOR;
    ctx.beginPath();
    ctx.ellipse(centreX, stoneY, RICKETY_STONE_RX_PX, RICKETY_STONE_RY_PX, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = RICKETY_STONE_LIGHT_COLOR;
    ctx.beginPath();
    ctx.ellipse(
      centreX - RICKETY_STONE_SHADE_DROP_PX,
      stoneY - RICKETY_STONE_SHADE_DROP_PX,
      RICKETY_STONE_RX_PX * RICKETY_STONE_LIT_SHARE,
      RICKETY_STONE_RY_PX * RICKETY_STONE_LIT_SHARE,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const halfWidth = RICKETY_POST_WIDTH_PX / 2;
  if (upright) {
    drawRicketyUpright(ctx, post, tx, ty);
  } else {
    ctx.fillStyle = RICKETY_POST_COLOR;
    ctx.fillRect(
      centreX - halfWidth,
      centreY - RICKETY_POST_WIDTH_PX,
      RICKETY_POST_WIDTH_PX,
      RICKETY_POST_WIDTH_PX * 2,
    );
    ctx.fillStyle = RICKETY_MOSS_COLOR;
    ctx.fillRect(
      centreX - halfWidth,
      centreY - RICKETY_POST_WIDTH_PX,
      RICKETY_POST_WIDTH_PX,
      FENCE_HIGHLIGHT_PX,
    );
  }

  // Wire is twisted round the post, not stapled to it: a couple of turns
  // across the post's face wherever a strand is fixed.
  if (anyWire) {
    ctx.strokeStyle = RICKETY_WIRE_COLOR;
    ctx.lineWidth = RICKETY_WIRE_PX;
    for (const fraction of RICKETY_WIRE_FRACTIONS) {
      const wireY = wireFixY(post, sy + Math.round(ts * fraction));
      const postX = ricketyPostXAt(post, wireY);
      for (let turn = 0; turn < RICKETY_WIRE_TWIST_TURNS; turn++) {
        const turnY = wireY + turn * RICKETY_WIRE_TWIST_STEP_PX;
        ctx.beginPath();
        ctx.moveTo(postX - halfWidth, turnY + FENCE_HIGHLIGHT_PX);
        ctx.lineTo(postX + halfWidth, turnY - FENCE_HIGHLIGHT_PX);
        ctx.stroke();
      }
    }
  }

  const twined = tileHash01(tx, ty, RICKETY_SALT.twine) < RICKETY_TWINE_SHARE;
  if (twined && !post.stump) {
    const lashY = upright
      ? sy + Math.round(ts * FENCE_RAIL_FRACTIONS[0])
      : centreY - RICKETY_TWINE_STEP_PX;
    const lashX = upright ? ricketyPostXAt(post, lashY) : centreX;
    ctx.strokeStyle = RICKETY_TWINE_COLOR;
    ctx.lineWidth = FENCE_HIGHLIGHT_PX;
    const middleTurn = (RICKETY_TWINE_TURNS - 1) / 2;
    for (let turn = 0; turn < RICKETY_TWINE_TURNS; turn++) {
      const turnY = lashY + (turn - middleTurn) * RICKETY_TWINE_STEP_PX;
      ctx.beginPath();
      ctx.moveTo(lashX - RICKETY_TWINE_HALF_WIDTH_PX, turnY + RICKETY_TWINE_SLANT_PX);
      ctx.lineTo(lashX + RICKETY_TWINE_HALF_WIDTH_PX, turnY - RICKETY_TWINE_SLANT_PX);
      ctx.stroke();
    }
  }
}

/**
 * The infill between a side-on run's posts: sawn pales, or a hazel weave.
 *
 * Every mark is clipped to the run's own span rather than to the tile, so a run
 * that stops at its tile's centre (an end, or a corner) does not spill pales into
 * open ground — the same rule the rails follow, for the same reason.
 */
function drawFenceInfill(
  ctx: CanvasRenderingContext2D,
  style: FenceStyleSpec,
  sx: number,
  sy: number,
  ts: number,
  westEdge: number,
  eastEdge: number,
): void {
  if (style.infill === 'none') return;

  if (style.infill === 'pales') {
    const paleTop = sy + Math.round(ts * PICKET_PALE_TOP_FRACTION);
    const paleBottom = sy + Math.round(ts * PICKET_PALE_BOTTOM_FRACTION);
    const step = PICKET_PALE_WIDTH_PX + PICKET_PALE_GAP_PX;
    const paleColor = style.paleColor ?? PICKET_PALE_COLOR;
    const paleShadeColor = style.paleShadeColor ?? PICKET_PALE_SHADE_COLOR;
    // Phased off `sx` so pales line up across a tile joint instead of restarting
    // at every tile edge. `sx` is chunk-local on the baked path, not the world
    // column, so the run of pales does restart at a 16-tile chunk seam —
    // invisible at a 3-tile pale period.
    const phase = ((sx % step) + step) % step;
    for (let x = westEdge - phase; x < eastEdge; x += step) {
      const left = Math.max(x, westEdge);
      const width = Math.min(x + PICKET_PALE_WIDTH_PX, eastEdge) - left;
      if (width <= 0) continue;
      ctx.fillStyle = paleColor;
      ctx.fillRect(left, paleTop, width, paleBottom - paleTop);
      ctx.fillStyle = paleShadeColor;
      ctx.fillRect(left, paleTop, width, PICKET_TIP_HEIGHT_PX);
    }
    return;
  }

  const weaveTop = sy + Math.round(ts * WATTLE_WEAVE_FRACTIONS[0]);
  const weaveBottom =
    sy + Math.round(ts * WATTLE_WEAVE_FRACTIONS[WATTLE_WEAVE_FRACTIONS.length - 1]);
  ctx.fillStyle = WATTLE_STAKE_COLOR;
  const stakePhase = ((sx % WATTLE_STAKE_STEP_PX) + WATTLE_STAKE_STEP_PX) % WATTLE_STAKE_STEP_PX;
  for (let x = westEdge - stakePhase; x < eastEdge; x += WATTLE_STAKE_STEP_PX) {
    const left = Math.max(x, westEdge);
    const width = Math.min(x + WATTLE_STAKE_WIDTH_PX, eastEdge) - left;
    if (width <= 0) continue;
    ctx.fillRect(left, weaveTop, width, weaveBottom - weaveTop + WATTLE_WEAVE_THICKNESS_PX);
  }
  // The weave itself: alternate segments darkened so each course reads as passing
  // behind a stake and back in front of the next one.
  for (let course = 0; course < WATTLE_WEAVE_FRACTIONS.length; course++) {
    const y = sy + Math.round(ts * WATTLE_WEAVE_FRACTIONS[course]);
    const segmentPhase = ((sx % WATTLE_SEGMENT_PX) + WATTLE_SEGMENT_PX) % WATTLE_SEGMENT_PX;
    let segment = 0;
    for (let x = westEdge - segmentPhase; x < eastEdge; x += WATTLE_SEGMENT_PX) {
      const left = Math.max(x, westEdge);
      const width = Math.min(x + WATTLE_SEGMENT_PX, eastEdge) - left;
      segment++;
      if (width <= 0) continue;
      ctx.fillStyle = (segment + course) % 2 === 0 ? WATTLE_WEAVE_COLOR : WATTLE_WEAVE_DARK_COLOR;
      ctx.fillRect(left, y, width, WATTLE_WEAVE_THICKNESS_PX);
    }
  }
}

/**
 * A planted bed: two soft furrows of turned soil with leafy clumps growing along
 * them, and now and then a full crop head.
 *
 * **Foliage first, rows second.** Hard full-width soil bars with thin shoots
 * read at 1x as lines of text, not planting: ruled dark lines carry the
 * silhouette and the green does not, and a dozen tick marks a tile are each too
 * small to be a plant.
 *
 * So the marks are clumps rather than ticks: fewer, wider than they are tall,
 * two tones, and drawn *over* the furrow so the green wins. The furrows survive,
 * at two per tile instead of three and at about half the contrast, because they
 * are what makes a run of planted tiles read as one bed rather than as scattered
 * tufts — which is the failure the fixed fractions were chosen to avoid, and
 * still the right call.
 */
function drawGardenPlanting(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const jitter =
    (tx * PLANTING_JITTER_HASH_X + ty * PLANTING_JITTER_HASH_Y) % PLANTING_JITTER_MODULUS;

  for (let furrow = 0; furrow < PLANTING_FURROW_FRACTIONS.length; furrow++) {
    const rowY = sy + Math.round(ts * PLANTING_FURROW_FRACTIONS[furrow]);
    ctx.fillStyle = PLANTING_SOIL_COLOR;
    ctx.fillRect(sx, rowY, ts, PLANTING_FURROW_HEIGHT_PX);

    for (let clump = 0; clump < PLANTING_CLUMPS_PER_FURROW; clump++) {
      const slot = Math.round((ts * (clump + PLANTING_SLOT_CENTRE)) / PLANTING_CLUMPS_PER_FURROW);
      const wobbleSeed = furrow * PLANTING_WOBBLE_FURROW_STEP + clump * PLANTING_WOBBLE_CLUMP_STEP;
      const wobble = ((jitter * (wobbleSeed + 1)) % PLANTING_WOBBLE_SPAN) - PLANTING_WOBBLE_CENTRE;
      const clumpCX = sx + slot + wobble;
      const clumpCY = rowY + PLANTING_FURROW_HEIGHT_PX / 2 - PLANTING_CLUMP_LIFT_PX;
      // Clamped rather than skipped: a clump dropped for overhanging its tile is
      // a gap in the bed, and the gaps were the other half of the dashed look.
      const cx = Math.min(
        Math.max(clumpCX, sx + PLANTING_CLUMP_RX_PX),
        sx + ts - PLANTING_CLUMP_RX_PX,
      );
      ctx.fillStyle = PLANTING_LEAF_DARK_COLOR;
      ctx.beginPath();
      ctx.ellipse(cx, clumpCY, PLANTING_CLUMP_RX_PX, PLANTING_CLUMP_RY_PX, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PLANTING_LEAF_COLOR;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        clumpCY - PLANTING_CLUMP_HIGHLIGHT_LIFT_PX,
        PLANTING_CLUMP_RX_PX - PLANTING_CLUMP_HIGHLIGHT_INSET_PX,
        PLANTING_CLUMP_RY_PX - PLANTING_CLUMP_HIGHLIGHT_INSET_PX,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  const carriesHead =
    (tx * PLANTING_HEAD_HASH_X + ty * PLANTING_HEAD_HASH_Y) % PLANTING_CROP_HEAD_PERIOD === 0;
  if (!carriesHead) return;
  const headX = sx + Math.round(ts / 2);
  const headFurrow = PLANTING_FURROW_FRACTIONS[PLANTING_CROP_HEAD_FURROW];
  const headY = sy + Math.round(ts * headFurrow) - PLANTING_CROP_HEAD_RADIUS_PX;
  ctx.fillStyle = PLANTING_LEAF_COLOR;
  ctx.beginPath();
  ctx.arc(headX, headY, PLANTING_CROP_HEAD_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PLANTING_LEAF_DARK_COLOR;
  ctx.beginPath();
  ctx.arc(headX, headY, PLANTING_CROP_HEART_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();
}

// ── wilderness ground cover ────────────────────────────────────────────────
//
// Neither painter may put ink outside its own tile. Terrain is baked in
// 16x16-tile chunks, each clipped to its own rect, so anything that escapes is
// sliced off in a straight line every sixteen tiles — which is why the
// wildflower feet are inset by the height of the tallest bloom rather than by
// the shared margin.
//
// Both painters are position-hashed and stateless: the tile stores nothing, and
// the same tile draws the same clump every frame and after every scene rebuild.

/**
 * Avalanche mixing constants, and the salts that separate one stream from
 * another.
 *
 * A linear hash such as `(|tx*a + ty*b| % 251) / 251`, passed `tx + i` for the
 * i-th element of a clump, fails here: that expression is **linear in its
 * arguments**, so stepping `i` steps the result by a constant, and every clump
 * comes out as points on one fixed diagonal with a fixed spacing — identical in
 * shape on every tile in the map, with the seven "pebbles" overlapping into a
 * single diagonal smear. A scatter pass that draws the same motif everywhere is
 * worse than no scatter pass, because it adds a repeat instead of breaking one.
 *
 * `Math.imul` with a shift-xor finish is the idiom used throughout the tile
 * renderers, and it decorrelates the element index properly.
 */
const COVER_HASH_MIX_X = 2654435761;
const COVER_HASH_MIX_Y = 2246822519;
const COVER_HASH_MIX_INDEX = 3266489917;
const COVER_HASH_FINAL_SHIFT = 15;
const COVER_HASH_UINT32 = 0x100000000;

/** Salts, so the same tile and element can draw several independent values. */
const COVER_SALT_X = 1;
const COVER_SALT_Y = 2;
const COVER_SALT_SIZE = 3;
const COVER_SALT_SPECIES = 4;

/** Stable value in [0, 1) for one element of one tile's clump. */
function coverHash01(tx: number, ty: number, index: number, salt: number): number {
  const position = Math.imul(tx, COVER_HASH_MIX_X) ^ Math.imul(ty, COVER_HASH_MIX_Y);
  const salted = position ^ Math.imul(index * COVER_SALT_STRIDE + salt, COVER_HASH_MIX_INDEX);
  const mixed = Math.imul(salted, COVER_HASH_MIX_X);
  const avalanched = mixed ^ (mixed >>> COVER_HASH_FINAL_SHIFT);
  return (avalanched >>> 0) / COVER_HASH_UINT32;
}

/** Keeps element index and salt from aliasing onto each other. */
const COVER_SALT_STRIDE = 16;

/** Inset kept clear on every side, so a clump never touches the tile edge. */
const COVER_MARGIN_PX = 5;

/** Centre of a tile, and of a 0..1 hash. */
const TILE_CENTRE_FRACTION = 0.5;
const HALF = 0.5;

const WILDFLOWER_COUNT = 5;
const WILDFLOWER_STEM_MIN_PX = 3;
const WILDFLOWER_STEM_RANGE_PX = 4;
const WILDFLOWER_STEM_WIDTH_PX = 1;
const WILDFLOWER_HEAD_RADIUS_PX = 1.8;
const WILDFLOWER_EYE_RADIUS_PX = 0.7;
const WILDFLOWER_STEM_COLOR = '#5c6f2c';
const WILDFLOWER_EYE_COLOR = '#f2e08c';
/**
 * One clump is all one species — a meadow is patches of a flower, not a
 * mixture — so the head colour is chosen per tile rather than per bloom.
 */
const WILDFLOWER_HEAD_COLORS: ReadonlyArray<string> = [
  '#d8dce8',
  '#c4a2dc',
  '#e8d060',
  '#d87c9c',
  '#8fb6e0',
];

/**
 * Highest a bloom's ink can reach above its foot: the longest stem plus the head
 * that sits on top of it.
 *
 * The feet are inset from the tile's top by this, not by `COVER_MARGIN_PX`,
 * because a stem is drawn *upward*. With the shared margin the tallest blooms
 * put their heads up to four pixels above the tile — and terrain is baked in
 * 16x16-tile chunks, each clipped to its own rect, so every flower on a chunk's
 * top row had its head sliced off in a straight line every sixteen tiles.
 */
const WILDFLOWER_FOOT_TOP_INSET_PX =
  WILDFLOWER_STEM_MIN_PX + WILDFLOWER_STEM_RANGE_PX + WILDFLOWER_HEAD_RADIUS_PX;

function drawWildflowerTuft(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const spreadX = ts - COVER_MARGIN_PX * 2;
  const spreadY = ts - COVER_MARGIN_PX - WILDFLOWER_FOOT_TOP_INSET_PX;
  const species = Math.floor(
    coverHash01(tx, ty, 0, COVER_SALT_SPECIES) * WILDFLOWER_HEAD_COLORS.length,
  );
  const headColor = WILDFLOWER_HEAD_COLORS[Math.min(WILDFLOWER_HEAD_COLORS.length - 1, species)];

  for (let i = 0; i < WILDFLOWER_COUNT; i++) {
    const footX = sx + COVER_MARGIN_PX + coverHash01(tx, ty, i, COVER_SALT_X) * spreadX;
    const footY =
      sy + WILDFLOWER_FOOT_TOP_INSET_PX + coverHash01(tx, ty, i, COVER_SALT_Y) * spreadY;
    const stemLength =
      WILDFLOWER_STEM_MIN_PX + coverHash01(tx, ty, i, COVER_SALT_SIZE) * WILDFLOWER_STEM_RANGE_PX;

    ctx.fillStyle = WILDFLOWER_STEM_COLOR;
    ctx.fillRect(footX, footY - stemLength, WILDFLOWER_STEM_WIDTH_PX, stemLength);

    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.arc(footX, footY - stemLength, WILDFLOWER_HEAD_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = WILDFLOWER_EYE_COLOR;
    ctx.beginPath();
    ctx.arc(footX, footY - stemLength, WILDFLOWER_EYE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

const PEBBLE_COUNT = 5;
const PEBBLE_MIN_RADIUS_PX = 1.1;
const PEBBLE_RADIUS_RANGE_PX = 1.7;
/** Light comes from the upper left, as it does for every prop in the repo. */
const PEBBLE_HIGHLIGHT_OFFSET_PX = 0.5;
const PEBBLE_SHADOW_OFFSET_PX = 0.6;
/**
 * Pebbles are an accent on rock that is itself now calm and mid-toned, so the
 * three passes sit closer together than a prop's would. A full-strength drop
 * shadow and a near-white highlight on a 2 px disc is confetti at this scale —
 * legible as a pebble only if you stop and look for one.
 */
const PEBBLE_SHADOW_COLOR = 'rgba(24,22,20,0.22)';
const PEBBLE_BODY_COLOR = '#8b867d';
const PEBBLE_HIGHLIGHT_COLOR = '#a49f95';
const PEBBLE_HIGHLIGHT_RADIUS_SHARE = 0.55;

function drawPebbleScatter(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const spread = ts - COVER_MARGIN_PX * 2;
  for (let i = 0; i < PEBBLE_COUNT; i++) {
    const radius =
      PEBBLE_MIN_RADIUS_PX + coverHash01(tx, ty, i, COVER_SALT_SIZE) * PEBBLE_RADIUS_RANGE_PX;
    const cx = sx + COVER_MARGIN_PX + coverHash01(tx, ty, i, COVER_SALT_X) * spread;
    const cy = sy + COVER_MARGIN_PX + coverHash01(tx, ty, i, COVER_SALT_Y) * spread;

    ctx.fillStyle = PEBBLE_SHADOW_COLOR;
    ctx.beginPath();
    ctx.arc(cx + PEBBLE_SHADOW_OFFSET_PX, cy + PEBBLE_SHADOW_OFFSET_PX, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PEBBLE_BODY_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PEBBLE_HIGHLIGHT_COLOR;
    ctx.beginPath();
    ctx.arc(
      cx - PEBBLE_HIGHLIGHT_OFFSET_PX,
      cy - PEBBLE_HIGHLIGHT_OFFSET_PX,
      radius * PEBBLE_HIGHLIGHT_RADIUS_SHARE,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/**
 * Wet granite: darker and bluer than the dry boulders, because a rock standing
 * in a river is wet, plus a bright waterline where the surface cuts across it.
 */
const RIVER_ROCK_SHADOW_COLOR = '#2c3438';
const RIVER_ROCK_BODY_COLOR = '#4d565a';
const RIVER_ROCK_LIT_COLOR = '#6d7679';
const RIVER_ROCK_DROWNED_COLOR = 'rgba(18, 44, 50, 0.45)';

/** Lobes per rock, so a stone is a lump rather than a circle. */
const RIVER_ROCK_LOBES = 3;
const RIVER_ROCK_MIN_RADIUS_FRACTION = 0.17;
const RIVER_ROCK_RADIUS_RANGE_FRACTION = 0.12;
const RIVER_ROCK_LOBE_SPREAD_FRACTION = 0.1;
/** Light is upper-left, as everywhere else in the repo. */
const RIVER_ROCK_LIT_OFFSET_FRACTION = 0.045;
/** How far up the stone the wet darkening reaches, as a fraction of a tile. */
const RIVER_ROCK_WET_HEIGHT_FRACTION = 0.3;
/** The same hue as `RIVER_ROCK_DROWNED_COLOR` at zero alpha — see the fade note. */
const RIVER_ROCK_WET_FADE_COLOR = 'rgba(18, 44, 50, 0)';

/** One lobe of a river rock, in absolute pixels. */
interface RiverRockLobe {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * The stone's lobes, derived from the tile hash once so the body, the clip and
 * the waterline all agree about where the rock actually is.
 */
function riverRockLobes(
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): RiverRockLobe[] {
  const centreX = sx + ts * TILE_CENTRE_FRACTION;
  const centreY = sy + ts * TILE_CENTRE_FRACTION;
  const spread = ts * RIVER_ROCK_LOBE_SPREAD_FRACTION;
  const lobes: RiverRockLobe[] = [];
  for (let index = 0; index < RIVER_ROCK_LOBES; index++) {
    lobes.push({
      x: centreX + (coverHash01(tx, ty, index, COVER_SALT_X) - HALF) * spread * 2,
      y: centreY + (coverHash01(tx, ty, index, COVER_SALT_Y) - HALF) * spread * 2,
      radius:
        ts *
        (RIVER_ROCK_MIN_RADIUS_FRACTION +
          coverHash01(tx, ty, index, COVER_SALT_SIZE) * RIVER_ROCK_RADIUS_RANGE_FRACTION),
    });
  }
  return lobes;
}

/**
 * A wet rock standing in the river.
 *
 * Exported so `WaterAnimationSystem` can repaint it over its own marks — the
 * chunk bake draws it too, and the water system's second pass is what keeps the
 * drifting streaks and the rock's own wake *behind* the stone.
 */
export function drawRiverRockTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const lobes = riverRockLobes(sx, sy, ts, tx, ty);
  const lit = ts * RIVER_ROCK_LIT_OFFSET_FRACTION;

  const paintLobes = (color: string, offset: number): void => {
    ctx.fillStyle = color;
    for (const lobe of lobes) {
      ctx.beginPath();
      ctx.arc(lobe.x + offset, lobe.y + offset, lobe.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  paintLobes(RIVER_ROCK_SHADOW_COLOR, 0);
  paintLobes(RIVER_ROCK_BODY_COLOR, -lit);
  paintLobes(RIVER_ROCK_LIT_COLOR, -lit * 2);

  // Wet stone, and nothing that reads as a line.
  //
  // A rock in a river went through three waterline treatments and every one of
  // them was wrong at 32 px a tile: a bright bar across the tile, then the same
  // bar clipped to the stone (a stripe painted on the rock), then a stroked ring
  // behind it (which just looked like the rock had a hoop round it). At this size
  // a drawn surface line has nowhere to go — the stone is barely a dozen pixels
  // tall, so any line lands either across its face or ringing it. The rock reads
  // as standing in water from the wake the animation puts round it and from this
  // darkening alone, so there is no line at all now. **Do not add one back.**
  //
  // The gradient is what keeps the darkening from becoming a line in its own
  // right: a flat fill had a hard top edge, which is the same artefact again. It
  // fades at constant hue rather than to `rgba(0,0,0,0)`, because canvas
  // interpolates gradient stops un-premultiplied and a fade to transparent black
  // greys the middle of the band.
  const depth = lobes.reduce((lowest, lobe) => Math.max(lowest, lobe.y + lobe.radius), -Infinity);
  const wetTop = depth - ts * RIVER_ROCK_WET_HEIGHT_FRACTION;
  const wet = ctx.createLinearGradient(0, wetTop, 0, depth);
  wet.addColorStop(0, RIVER_ROCK_WET_FADE_COLOR);
  wet.addColorStop(1, RIVER_ROCK_DROWNED_COLOR);

  ctx.save();
  ctx.beginPath();
  for (const lobe of lobes) {
    ctx.moveTo(lobe.x + lobe.radius, lobe.y);
    ctx.arc(lobe.x, lobe.y, lobe.radius, 0, Math.PI * 2);
  }
  ctx.clip();
  ctx.fillStyle = wet;
  ctx.fillRect(sx, wetTop, ts, depth - wetTop);
  ctx.restore();
}

/** The scraped-out hollow a den is dug into: bare, dark, and picked over. */
const DEN_HOLLOW_FLOOR_COLOR = 'rgba(24,20,17,0.5)';
const DEN_HOLLOW_RIM_COLOR = 'rgba(58,52,45,0.55)';
const DEN_HOLLOW_SCRAPE_COLOR = 'rgba(14,11,9,0.45)';
const DEN_HOLLOW_RADIUS_FRACTION = 0.44;
const DEN_HOLLOW_RIM_WIDTH_PX = 2;
const DEN_HOLLOW_SCRAPES = 4;
const DEN_HOLLOW_SCRAPE_LENGTH_FRACTION = 0.3;
const DEN_HOLLOW_SCRAPE_WIDTH_PX = 1;

function drawDenHollow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const centreX = sx + ts * TILE_CENTRE_FRACTION;
  const centreY = sy + ts * TILE_CENTRE_FRACTION;
  const radius = ts * DEN_HOLLOW_RADIUS_FRACTION;

  ctx.fillStyle = DEN_HOLLOW_FLOOR_COLOR;
  ctx.beginPath();
  ctx.arc(centreX, centreY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = DEN_HOLLOW_RIM_COLOR;
  ctx.lineWidth = DEN_HOLLOW_RIM_WIDTH_PX;
  ctx.stroke();

  // Claw scrapes, hashed so a run of hollow tiles does not repeat one mark, and
  // kept **inside the hollow** rather than inside the tile.
  //
  // The first version started a scrape up to `radius` from the centre and ran it
  // a further 0.3 of a tile outward, so its ink reached 1.24 tiles from the tile
  // origin: 352 of 400 sampled tiles painted outside themselves, by up to 36 px.
  // `DEN_HOLLOW` is not a Y-sorted decoration, so that ink is baked into the
  // 16x16-tile chunk — sheared along a straight line at every chunk boundary and
  // overdrawing its neighbours everywhere else.
  ctx.strokeStyle = DEN_HOLLOW_SCRAPE_COLOR;
  ctx.lineWidth = DEN_HOLLOW_SCRAPE_WIDTH_PX;
  const scrapeLength = ts * DEN_HOLLOW_SCRAPE_LENGTH_FRACTION;
  for (let scrape = 0; scrape < DEN_HOLLOW_SCRAPES; scrape++) {
    const angle = coverHash01(tx, ty, scrape, COVER_SALT_X) * Math.PI * 2;
    // The far end is what must stay inside, so the start is drawn from whatever
    // room is left once the scrape's own length is taken off the radius.
    const reach = coverHash01(tx, ty, scrape, COVER_SALT_Y) * Math.max(0, radius - scrapeLength);
    const fromX = centreX + Math.cos(angle) * reach;
    const fromY = centreY + Math.sin(angle) * reach;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(fromX + Math.cos(angle) * scrapeLength, fromY + Math.sin(angle) * scrapeLength);
    ctx.stroke();
  }
}

// ── cliffs ─────────────────────────────────────────────────────────────────

/** Rock face, lit from the upper left like everything else here. */
const CLIFF_FACE_COLOR = '#5d5952';
const CLIFF_FACE_DARK_COLOR = '#403c37';
const CLIFF_TOP_LIP_COLOR = '#9a9488';
const CLIFF_TOP_LIP_HIGHLIGHT = '#b8b1a2';
const CLIFF_CRACK_COLOR = 'rgba(28,25,22,0.6)';
/**
 * Shade pooling at the **foot of the ledge's own face**, where the rock meets
 * the ground.
 *
 * Not the drop-shadow onto the tile below: a tile may not paint outside itself —
 * terrain is baked in 16x16-tile chunks clipped to their own rect — so the
 * shadow the *neighbour* receives is cast by the ground-AO pass instead, which
 * is why `CLIFF` is in `GROUND_OCCLUDER_TYPES`. The two together are the height
 * illusion: this darkens the base of the face, the AO darkens the ground in
 * front of it.
 */
const CLIFF_FACE_FOOT_SHADE_COLOR = 'rgba(16,14,12,0.42)';

/** Geometry, in tile fractions so it holds at any tile size. */
const CLIFF_TOP_LIP_FRACTION = 0.18;
const CLIFF_LIP_HIGHLIGHT_FRACTION = 0.06;
const CLIFF_FACE_FOOT_SHADE_FRACTION = 0.22;
const CLIFF_FACE_STEP_FRACTION = 0.3;
const CLIFF_CRACKS = 3;
const CLIFF_CRACK_WIDTH_PX = 1;

function drawCliffLedge(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const lipHeight = ts * CLIFF_TOP_LIP_FRACTION;

  // The face.
  ctx.fillStyle = CLIFF_FACE_COLOR;
  ctx.fillRect(sx, sy + lipHeight, ts, ts - lipHeight);

  // A stepped darker block, offset per tile, so a run of ledge is a broken rock
  // face rather than one flat grey band the length of the ridge.
  const stepWidth = ts * CLIFF_FACE_STEP_FRACTION;
  const stepX = sx + coverHash01(tx, ty, 0, COVER_SALT_X) * (ts - stepWidth);
  ctx.fillStyle = CLIFF_FACE_DARK_COLOR;
  ctx.fillRect(stepX, sy + lipHeight, stepWidth, ts - lipHeight);

  // The top lip: the sunlit edge of the plateau above.
  ctx.fillStyle = CLIFF_TOP_LIP_COLOR;
  ctx.fillRect(sx, sy, ts, lipHeight);
  ctx.fillStyle = CLIFF_TOP_LIP_HIGHLIGHT;
  ctx.fillRect(sx, sy, ts, ts * CLIFF_LIP_HIGHLIGHT_FRACTION);

  // Cracks down the face.
  ctx.fillStyle = CLIFF_CRACK_COLOR;
  for (let crack = 0; crack < CLIFF_CRACKS; crack++) {
    // The crack's own width is taken off the span, or one starting in the tile's
    // last column spills into the next. That mattered twice over: the cached
    // overlay entry is exactly one tile square and clipped the spill away, while
    // the uncached path drew it — so the same tile rendered differently through
    // the two paths.
    const crackX = sx + coverHash01(tx, ty, crack, COVER_SALT_Y) * (ts - CLIFF_CRACK_WIDTH_PX);
    const crackTop =
      sy + lipHeight + coverHash01(tx, ty, crack, COVER_SALT_SIZE) * (ts - lipHeight);
    ctx.fillRect(crackX, crackTop, CLIFF_CRACK_WIDTH_PX, sy + ts - crackTop);
  }

  // Shade at the foot of the face — but only where there is open ground below
  // for the ledge to be standing over. Against another ledge it would just
  // darken the top of the one underneath.
  if (structure[ty + 1]?.[tx]?.type === CLIFF) return;
  ctx.fillStyle = CLIFF_FACE_FOOT_SHADE_COLOR;
  ctx.fillRect(
    sx,
    sy + ts - ts * CLIFF_FACE_FOOT_SHADE_FRACTION,
    ts,
    ts * CLIFF_FACE_FOOT_SHADE_FRACTION,
  );
}

/**
 * A single scattered bone: a ground shadow, a shaft with a darker underside
 * stripe, and two rounded joint caps, all outlined so the shape reads clearly
 * against the floor tile beneath it instead of blending into a pale blob.
 */
function drawLongBone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  halfLength: number,
  shaftHalfWidth: number,
  jointRadius: number,
  shadowRx: number,
  shadowRy: number,
): void {
  ctx.save();
  ctx.fillStyle = BONE_SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(cx, cy + jointRadius * 0.6, shadowRx, shadowRy, angle, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.lineWidth = BONE_OUTLINE_WIDTH;
  ctx.strokeStyle = BONE_OUTLINE_COLOR;

  ctx.fillStyle = BONE_SHAFT_COLOR;
  ctx.fillRect(-halfLength, -shaftHalfWidth, halfLength * 2, shaftHalfWidth * 2);
  ctx.strokeRect(-halfLength, -shaftHalfWidth, halfLength * 2, shaftHalfWidth * 2);

  ctx.fillStyle = BONE_SHAFT_SHADOW_COLOR;
  ctx.fillRect(-halfLength, shaftHalfWidth * 0.15, halfLength * 2, shaftHalfWidth * 0.5);

  // Two smaller lobes per end, offset off-axis, flare wider than the shaft and
  // read as a knuckle; a single centered circle just reads as a ball on a stick.
  const lobeOffset = jointRadius * BONE_KNUCKLE_LOBE_OFFSET_FRAC;
  const lobeRadius = jointRadius * BONE_KNUCKLE_LOBE_RADIUS_FRAC;
  for (const endX of [-halfLength, halfLength]) {
    ctx.fillStyle = BONE_JOINT_COLOR;
    for (const lobeSide of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(endX, lobeSide * lobeOffset, lobeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Where the arrow's pivot sits on the board, in tiles down from the sign tile's top edge. */
const CRAWLER_SIGN_ARROW_PIVOT_Y_TILES = SIGN_ARROW_CENTRE_Y_TILES;
const CRAWLER_SIGN_ARROW_PIVOT_X_TILES = BOARD_CENTRE_X;

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
      case TENT_POLE:
        drawTentPoleBaseTile(ctx, structure, sx, sy, ts, tx, ty);
        return true;
      case TREE:
      // A boulder is written with `setStanding`, so like a tree it records the
      // band it was dropped on and the outdoor ground path resolves the rest.
      // Missing from here, the chunk bake drew *nothing* under the rock and
      // every boulder on the map sat in a solid black one-tile square.
      case BOULDER_SMALL:
      case BOULDER_LARGE:
      // A tent and a fire stand on the camp's beaten earth, recorded the same
      // way. Without a case here the chunk bake draws nothing under them and
      // every one sits in a solid black square — which is exactly what shipped
      // for the boulders until an in-situ render caught it.
      case CAMPFIRE:
      case GOBLIN_TENT:
      case CLIFF:
      // Briar Hollow's walls, palisade and gate stand on the village's own
      // ground the same way — recorded in `groundType`, resolved by
      // `groundMaterialUnder` rather than by the type passed here.
      case HOLLOW_WALL:
      case HOLLOW_PALISADE:
      case HOLLOW_GATE:
      // A village prop stands on a plank floor, beaten earth or a lane, and
      // records which; inferring it from the neighbours fails in the middle of
      // a stack of hay bales, where every neighbour is another bale.
      case HOLLOW_PROP_LOW:
      case HOLLOW_PROP_TALL:
        // Routed through the outdoor ground path; which material actually gets
        // drawn is resolved by `groundMaterialUnder` from the `groundType` the
        // tile recorded, not from the type passed here.
        drawTerrainTile(ctx, structure, FloorTypeValue.grass, sx, sy, ts, tx, ty);
        return true;
      // A circus structure records the lot it was pitched on the same way, and
      // the lot's decals run on under it: a vine runner is seen coming out from
      // beneath the Big Top's skirt, not starting at a tile edge.
      case CIRCUS_STRUCTURE_TALL:
      case CIRCUS_STRUCTURE_LOW:
        drawTerrainTile(ctx, structure, FloorTypeValue.grass, sx, sy, ts, tx, ty);
        drawCircusDecals(ctx, structure, sx, sy, ts, tx, ty);
        return true;
      case TORCH:
      case WELL:
      case FOUNTAIN:
      case BRAZIER:
      case MAIN_TOWER:
      case SPRITE_BUILDING:
      case BARREL:
      case BARREL_SIDE:
      case CRATE:
      case BOOKSHELF:
      case CRAWLER_SIGN:
      // The garrison's and the inking shop's props. Without a case here the
      // chunk bake draws nothing under them and every one sits in a solid black
      // square — which is exactly what shipped for the boulders once already.
      case TRAINING_DUMMY:
      case WEAPON_RACK:
      case MUSTER_BOARD:
      case FLASH_WALL:
      case PIGMENT_SHELF:
      case GRINDING_SLAB:
      case HOARD_PILE:
      case HOARD_TOWER:
      case HOARD_BAG:
      case GYM_RACK:
      case GYM_SQUAT_RACK:
      case GYM_CABLE_STACK:
      case KRAKAREN_TANK:
      case KRAKAREN_CONSOLE:
      case LAB_BENCH:
      case LAB_SHELF:
      case ROCK_DEPOSIT:
      case MODERN_DECORATION: {
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
    case TREE: {
      // Ground is already drawn by the baseOnly chunk-cache pass.
      // Re-drawing it here would wipe out the canopy-overhead of any
      // adjacent tree that already painted into this tile's space.
      const tile = structure[ty][tx];
      drawSpriteKey(
        ctx,
        treeSpriteKeyForTile(tile, tx, ty),
        treeSpriteState(tile.treeStage),
        tile.treeAnimFrame ?? 0,
        sx,
        sy,
        ts,
      );
      return true;
    }

    case FOUNTAIN: {
      // Walk to the block's origin instead of testing the four neighbours: the
      // composition is authored for a 3×3 block, so a differently-sized
      // fountain clamps into it rather than drawing nine wrong slices.
      let blockX = 0;
      while (structure[ty]?.[tx - blockX - 1]?.type === FOUNTAIN) blockX++;
      let blockY = 0;
      while (structure[ty - blockY - 1]?.[tx]?.type === FOUNTAIN) blockY++;
      drawFountainTileSlice(ctx, sx, sy, ts, blockX, blockY, frameTime);
      return true;
    }

    // Torch — sprite only; see BARREL_SIDE below for why the floor is not
    // repainted here. Smashable, so it picks its wear state the same way the
    // barrels and crates do, and keeps burning while it stands.
    case TORCH: {
      drawSpriteKey(
        ctx,
        'torch',
        propSpriteState(structure[ty][tx].damageStage),
        timeFrameIndex(frameTime, TORCH_FLAME_FPS, TORCH_FLAME_FRAMES),
        sx,
        sy,
        ts,
      );
      return true;
    }

    // Well — PNG sprite with transparent background
    case WELL: {
      drawSpriteKey(ctx, 'well', 'idle', 0, sx, sy, ts);
      return true;
    }

    // Brazier — animated iron fire brazier, extends above tile. Smashable, so
    // like the torch it picks its wear state from the tile's damage stage and
    // keeps burning while it stands.
    case BRAZIER: {
      drawSpriteKey(
        ctx,
        'brazier',
        propSpriteState(structure[ty][tx].damageStage),
        timeFrameIndex(frameTime, BRAZIER_FLAME_FPS, BRAZIER_FLAME_FRAMES),
        sx,
        sy,
        ts,
      );
      return true;
    }

    // Barrel on its side — ground is already drawn by the baseOnly chunk pass,
    // so only the sprite goes here; repainting the floor would clip the 8px
    // overhang of the prop on the neighbouring tile.
    case BARREL_SIDE: {
      drawSpriteKey(
        ctx,
        'barrel_side',
        propSpriteState(structure[ty][tx].damageStage),
        0,
        sx,
        sy,
        ts,
      );
      return true;
    }

    // Wooden crate — sprite only; see BARREL_SIDE above.
    case CRATE: {
      drawSpriteKey(ctx, 'crate', propSpriteState(structure[ty][tx].damageStage), 0, sx, sy, ts);
      return true;
    }

    case CRAWLER_SIGN: {
      const arrowAngle = structure[ty][tx].crawlerSignArrowAngle;
      if (arrowAngle === undefined) return false;
      drawSpriteKey(ctx, 'crawler_sign', 'board', 0, sx, sy, ts);
      drawSpriteKey(
        ctx,
        'crawler_sign_arrow',
        'arrow',
        0,
        sx + ts * CRAWLER_SIGN_ARROW_PIVOT_X_TILES,
        sy + ts * CRAWLER_SIGN_ARROW_PIVOT_Y_TILES,
        ts,
        { rotation: arrowAngle },
      );
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

      const b1x = sx + 6 + (bh1 % (ts - 12));
      const b1y = sy + 8 + (bh2 % (ts - 14));
      const b1a = (bh1 % 6) * 0.5;
      drawLongBone(
        ctx,
        b1x,
        b1y,
        b1a,
        BONE1_HALF_LENGTH,
        BONE1_SHAFT_HALF_WIDTH,
        BONE1_JOINT_RADIUS,
        BONE1_SHADOW_RX,
        BONE1_SHADOW_RY,
      );

      // Second, smaller bone, rotated opposite so the pile doesn't read as one repeated tile.
      const b2x = sx + 10 + (bh2 % (ts - 12));
      const b2y = sy + 16 + (bh1 % (ts - 18));
      const b2a = b1a + 1.1;
      drawLongBone(
        ctx,
        b2x,
        b2y,
        b2a,
        BONE2_HALF_LENGTH,
        BONE2_SHAFT_HALF_WIDTH,
        BONE2_JOINT_RADIUS,
        BONE2_SHADOW_RX,
        BONE2_SHADOW_RY,
      );

      // Small bone fragment / rib shard
      const b3x = sx + 14 + (bh1 % (ts - 20));
      const b3y = sy + 22 + (bh2 % (ts - 24));
      const b3a = bh2 * 0.15;
      drawLongBone(
        ctx,
        b3x,
        b3y,
        b3a,
        BONE3_SHAFT_LENGTH / 2,
        BONE3_SHAFT_HALF_WIDTH,
        BONE3_JOINT_RADIUS,
        BONE3_SHAFT_LENGTH * 0.7,
        BONE2_SHADOW_RY * 0.6,
      );
      return true;
    }

    // Grassy weed — walkable grass tile with decorative tufts and occasional flowers
    case GRASSY_WEED: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);

      // Deterministic hash from tile position
      const h1 = (tx * 31 + ty * 17) % 97;
      const h2 = (tx * 53 + ty * 41) % 89;

      // First grass tuft. The blade colours track the generated grass material,
      // which is olive — the mint greens they replaced belonged to the retired
      // tileset and read as teal dashes on the new lawn.
      const t1x = sx + 3 + ((h1 * 7) % (ts - 12));
      const t1y = sy + 5 + ((h1 * 11) % (ts - 14));
      ctx.fillStyle = '#6b7f35';
      ctx.fillRect(t1x, t1y, 2, 7); // central blade
      ctx.fillRect(t1x - 3, t1y + 3, 2, 5); // left blade (angled out)
      ctx.fillRect(t1x + 3, t1y + 3, 2, 5); // right blade

      // Second smaller tuft
      const t2x = sx + 5 + ((h2 * 13) % (ts - 14));
      const t2y = sy + 4 + ((h2 * 7) % (ts - 14));
      ctx.fillStyle = '#55692a';
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

    // Wildflower clump — walkable meadow cover out in the wilderness. Denser and
    // more colourful than `GRASSY_WEED`'s occasional single bloom, because it
    // exists to give the open country between the forests something to look at.
    case WILDFLOWER_TUFT: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawWildflowerTuft(ctx, sx, sy, ts, tx, ty);
      return true;
    }

    // Loose stones — walkable upland cover. Drawn over whatever the tile
    // recorded standing on, so the same type reads as stones on turf up on the
    // highland and as stones on rock once it reaches the scree.
    case PEBBLE_SCATTER: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawPebbleScatter(ctx, sx, sy, ts, tx, ty);
      return true;
    }

    // A wet rock standing in the river. Procedural rather than part of the baked
    // rock family: at 32 px a tile a mid-channel stone is a couple of ellipses
    // and a waterline, and it has to sit *under* the wake `WaterAnimationSystem`
    // draws around it, so the boulders' Y-sorted sprite treatment would be wrong
    // for it anyway. Its ramp is its own — see `RIVER_ROCK_BODY_COLOR` — and is
    // deliberately darker and bluer than the dry boulders', so the two are not
    // meant to match and neither needs retuning when the other moves.
    case RIVER_ROCK: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawRiverRockTile(ctx, sx, sy, ts, tx, ty);
      return true;
    }

    // Boulders. Sprite only — the ground beneath was already drawn by the
    // chunk-cache's `baseOnly` pass, and repainting it here would wipe out the
    // overhang of any neighbouring boulder that has already drawn into this
    // tile's space. (`TREE` is drawn the same way, for the same reason.)
    case BOULDER_SMALL:
    case BOULDER_LARGE: {
      drawSpriteKey(ctx, boulderSpriteKey(type, tx, ty), 'idle', 0, sx, sy, ts);
      return true;
    }

    // A goblin camp's hide tent. Sprite only — the ground beneath was drawn by
    // the chunk-cache's `baseOnly` pass.
    case GOBLIN_TENT: {
      drawSpriteKey(ctx, goblinTentSpriteKey(tx, ty), 'idle', 0, sx, sy, ts);
      return true;
    }

    // A camp's fire. Animated off the shared `frameTime`, the way a torch is,
    // which is why `CAMPFIRE` is kept out of `CACHEABLE_OVERLAY_TYPES` — a
    // cached frame is a fire that has gone out.
    case CAMPFIRE: {
      drawSpriteKey(
        ctx,
        'campfire',
        'idle',
        timeFrameIndex(frameTime, CAMPFIRE_FLAME_FPS, CAMPFIRE_FLAME_FRAMES),
        sx,
        sy,
        ts,
      );
      return true;
    }

    // The gnawed hollow at the centre of a troglodyte den: walkable ground, a
    // dark scrape in the scree rather than anything standing on it.
    case DEN_HOLLOW: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawDenHollow(ctx, sx, sy, ts, tx, ty);
      return true;
    }

    // A stone ledge along a ridge. Procedural, and neighbour-aware like the
    // fence and the bridge: what a ledge looks like depends on whether the tile
    // below it is open ground for its shadow to fall on.
    //
    // **The shading is the whole illusion.** The game has no z-axis; a cliff is
    // a non-walkable decoration, and what makes it read as height rather than as
    // a grey stripe is the bright lip along its top, the shade pooling at the
    // foot of its face, and — cast by the ground-AO pass, since a tile may not
    // paint outside itself — the band darkening the ground to its south.
    case CLIFF: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawCliffLedge(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }

    // Garden planting — walkable verge tile carrying tilled rows and shoots.
    case GARDEN_PLANTING: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawGardenPlanting(ctx, sx, sy, ts, tx, ty);
      return true;
    }

    // Yard fence — a post-and-rail line standing on whatever surface it encloses.
    case FENCE: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);
      drawFence(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }

    // Dirt patch — walkable road tile with pebble and soil texture
    case DIRT_PATCH: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);

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

    // Rubble — walkable ground clutter scattered across the Over City's ruined
    // outskirts. Drawn over the real grass sprite (like GRASSY_WEED) so the
    // debris dissolves into the surrounding lawn instead of reading as an
    // opaque square.
    case RUBBLE: {
      drawGroundTile(ctx, OVERWORLD_GROUND, structure, sx, sy, ts, tx, ty);

      const h1 = (tx * 37 + ty * 23) % 97;
      const h2 = (tx * 59 + ty * 43) % 89;

      // A faint dirt patch under the debris cluster — smaller than the tile so
      // grass stays visible around every edge.
      const patchX = sx + RUBBLE_PATCH_INSET + (h1 % RUBBLE_PATCH_JITTER);
      const patchY = sy + RUBBLE_PATCH_INSET + (h2 % RUBBLE_PATCH_JITTER);
      const patchSize = ts - RUBBLE_PATCH_INSET * 2 - RUBBLE_PATCH_JITTER;
      ctx.fillStyle = 'rgba(74,70,62,0.55)';
      ctx.beginPath();
      ctx.ellipse(
        patchX + patchSize / 2,
        patchY + patchSize / 2,
        patchSize / 2 + RUBBLE_PATCH_RX_EXTRA,
        patchSize / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // Broken-stone chunks clustered on the dirt patch, varied sizes.
      for (let i = 0; i < RUBBLE_CHUNK_COUNT; i++) {
        const cx = patchX + ((h1 * (i + 1) * 7) % patchSize);
        const cy = patchY + ((h2 * (i + 1) * 5) % patchSize);
        const cw = RUBBLE_CHUNK_MIN_SIZE + ((h1 * (i + 3)) % RUBBLE_CHUNK_SIZE_VARIANCE);
        const chHeight = RUBBLE_CHUNK_MIN_SIZE + ((h2 * (i + 2)) % RUBBLE_CHUNK_SIZE_VARIANCE);
        ctx.fillStyle = i % 2 === 0 ? '#6a655a' : '#7a6f5e';
        ctx.fillRect(cx, cy, cw, chHeight);
        ctx.fillStyle = '#847e70';
        ctx.fillRect(cx, cy, cw, 1);
      }

      // Grass blades poking up between and over the chunk edges, so the
      // debris reads as half-swallowed by the lawn — which only works while the
      // blades are the lawn's colour, not the retired tileset's mint.
      ctx.fillStyle = '#6b7f35';
      for (let i = 0; i < RUBBLE_TUFT_COUNT; i++) {
        const gx = sx + 2 + ((h2 * (i * 13 + 5)) % (ts - 6));
        const gy = sy + 3 + ((h1 * (i * 9 + 7)) % (ts - 10));
        ctx.fillRect(gx, gy, 2, RUBBLE_TUFT_HEIGHT);
        ctx.fillRect(gx + 3, gy + 2, 2, RUBBLE_TUFT_HEIGHT - 2);
      }

      // Fine grit
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < RUBBLE_GRIT_COUNT; i++) {
        const px = patchX + ((h1 * (i * 11 + 3)) % patchSize);
        const py = patchY + ((h2 * (i * 7 + 5)) % patchSize);
        ctx.fillRect(px, py, 1, 1);
      }
      return true;
    }

    // Main overworld tower — large animated sprite, anchor at door-threshold level.
    // Frame 0 is the complete base tower; frames 1-3 are glow-only overlays composited on top.
    case MAIN_TOWER: {
      drawSpriteKey(ctx, 'overworld_main_tower', 'normal', 0, sx, sy, ts);
      const glowFrame = timeFrameIndex(frameTime, MAIN_TOWER_GLOW_FPS, MAIN_TOWER_GLOW_FRAMES);
      if (glowFrame > 0) {
        drawSpriteKey(ctx, 'overworld_main_tower', 'normal', glowFrame, sx, sy, ts);
      }
      return true;
    }

    // Sprite building — PNG-based building anchor tile.
    // The spriteKey on this tile selects which house image to render.
    case SPRITE_BUILDING: {
      const spriteKey = structure[ty][tx].spriteKey;
      if (spriteKey === undefined) return true;
      const def = getSpriteDefByKey(spriteKey);
      if (def === undefined) return true;
      const stateDef = def.states.get('idle');
      if (stateDef === undefined) return true;
      drawSprite(ctx, def, stateDef, 0, sx, sy, ts);
      // Any extra state is an animated overlay authored in the same frame-local
      // space as `idle` (e.g. the blacksmith's forge flames), so it composites on
      // top of the facade at the same anchor rather than replacing it.
      for (const overlayState of getSpriteOverlayStatesByKey(spriteKey)) {
        const overlayDef = def.states.get(overlayState);
        if (overlayDef === undefined) continue;
        const frame = timeFrameIndex(frameTime, SPRITE_BUILDING_OVERLAY_FPS, overlayDef.frameCount);
        drawSprite(ctx, def, overlayDef, frame, sx, sy, ts);
      }
      return true;
    }

    // Modern prop from the shared modern_decorations sprite sheet.
    // decorationVariant = row * 10 + col selects the specific item.
    case MODERN_DECORATION: {
      const variant = structure[ty][tx].decorationVariant ?? 0;
      const row = Math.floor(variant / 10);
      const col = variant % 10;
      const def = getSpriteDefByKey('modern_decorations');
      if (def === undefined) return true;
      const stateDef = def.states.get(`row_${row}`);
      if (stateDef === undefined) return true;
      const floorType = inferFloorType(structure, tx, ty);
      if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
        drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
      }
      drawSprite(ctx, def, stateDef, col, sx, sy, ts);
      return true;
    }

    // Briar Hollow: the roofless walls, the palisade and the props, each in its own file.
    case HOLLOW_WALL: {
      drawHollowWallTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }
    case HOLLOW_PALISADE: {
      drawHollowPalisadeTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }
    case HOLLOW_GATE: {
      drawHollowGateTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }
    case HOLLOW_PROP_LOW:
    case HOLLOW_PROP_TALL: {
      drawHollowPropTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }
    case CIRCUS_STRUCTURE_TALL:
    case CIRCUS_STRUCTURE_LOW: {
      drawCircusStructureTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }
    case TENT_POLE: {
      drawTentPoleTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }
    case ROCK_DEPOSIT: {
      drawRockDepositTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    }

    default:
      return false;
  }
}
