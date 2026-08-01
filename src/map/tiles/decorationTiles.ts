import type { FenceStyle, TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  TREE,
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
  FENCE,
  GARDEN_PLANTING,
  BARREL,
  BARREL_SIDE,
  BOOKSHELF,
  CRATE,
  BRAZIER,
  BONES,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  RUBBLE,
  TOWN_WALL,
  propSpriteState,
} from '../tileTypes';
import { inferFloorType } from './helpers';
import { drawTerrainTile } from './terrainTiles';
import { drawGroundTile } from './groundTiles';
import { OVERWORLD_GROUND } from '../town/groundMaterials';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawSpriteKey, drawSprite, timeFrameIndex } from '../../core/SpriteRenderer';
import { drawFountainTileSlice } from '../../sprites/fountainSprite';
import { getSpriteDefByKey, getSpriteOverlayStatesByKey } from '../../core/SpriteLoader';
import { frameTime } from '../../utils';

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

/** Playback rate of animated overlay states composited onto sprite buildings. */
const SPRITE_BUILDING_OVERLAY_FPS = 8;

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
 * Radix for folding several overlay frame indices into one number. Larger than
 * any overlay's frame count, so distinct combinations never collide.
 */
const OVERLAY_FRAME_KEY_STRIDE = 16;

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
 * routing `anchorsRailAt` through it gained **6** anchored sides, not the 43 this
 * note used to predict — and alpha-scanning the art at those six found three
 * anchoring into pixels that are 0.0%, 0.0% and 1.1% opaque, which is the same
 * rail-into-open-verge defect the paragraph above records. Closing them properly
 * needs a per-tile opacity index built from the loaded images, and the measured
 * prize for building one is three fence tiles.
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
 * never one tile long — and draws its post alone. Rails to nowhere on both sides
 * are what it used to draw, and a cheek is exactly where a rail stops.
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
    // A gate cheek stands on its own and still casts a shadow. It had one before
    // the rails became directional, and losing it made the two cheeks in the town
    // read as floating.
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

  const postX = centreX - Math.floor(FENCE_POST_WIDTH_PX / 2);
  // An end-on run shows the post's cap, not its full height. A corner counts as
  // side-on: it has an east-west rail to carry, so it needs the upright.
  const top = runsEastWest || !runsNorthSouth ? postTop : centreY - FENCE_POST_WIDTH_PX;
  const bottom = runsEastWest || !runsNorthSouth ? postBottom : centreY + FENCE_POST_WIDTH_PX;
  ctx.fillStyle = style.postColor;
  ctx.fillRect(postX, top, FENCE_POST_WIDTH_PX, bottom - top);
  ctx.fillStyle = style.postShadeColor;
  ctx.fillRect(
    postX + FENCE_POST_WIDTH_PX - FENCE_HIGHLIGHT_PX,
    top,
    FENCE_HIGHLIGHT_PX,
    bottom - top,
  );
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
    // Phased off `sx` so pales line up across a tile joint instead of restarting
    // at every tile edge. `sx` is chunk-local on the baked path, so the run of
    // pales does restart at a 16-tile chunk seam — invisible at a 3-tile pale
    // period, but it is not the world column and the comment used to say it was.
    const phase = ((sx % step) + step) % step;
    for (let x = westEdge - phase; x < eastEdge; x += step) {
      const left = Math.max(x, westEdge);
      const width = Math.min(x + PICKET_PALE_WIDTH_PX, eastEdge) - left;
      if (width <= 0) continue;
      ctx.fillStyle = PICKET_PALE_COLOR;
      ctx.fillRect(left, paleTop, width, paleBottom - paleTop);
      ctx.fillStyle = PICKET_PALE_SHADE_COLOR;
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
 * **Foliage first, rows second.** The first version drew three hard full-width
 * soil bars per tile with 2 x 5 px shoots standing on them, and two review rounds
 * independently reported the same thing: at 1x a garden of them reads as lines of
 * text, not as planting. The diagnosis is that the ruled dark lines carried the
 * silhouette and the green did not — twelve tick marks a tile is a lot of marks
 * and none of them is big enough to be a plant.
 *
 * So the marks are now clumps rather than ticks: fewer, wider than they are tall,
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
      case TREE:
        // Trees are always outdoor tiles — draw grass directly rather than
        // inferring from neighbours, which fails for trees deep inside a
        // dense forest blob where all neighbours are also trees.
        drawTerrainTile(ctx, structure, FloorTypeValue.grass, sx, sy, ts, tx, ty);
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
      switch (((Math.imul(tx, 2654435761) ^ Math.imul(ty, 2246822519)) >>> 0) % 6) {
        case 0:
          drawSpriteKey(ctx, 'tree_1', 'idle', 0, sx, sy, ts);
          break;
        case 1:
          drawSpriteKey(ctx, 'tree_2', 'idle', 0, sx, sy, ts);
          break;
        case 2:
          drawSpriteKey(ctx, 'tree_3', 'idle', 0, sx, sy, ts);
          break;
        case 3:
          drawSpriteKey(ctx, 'tree_4', 'idle', 0, sx, sy, ts);
          break;
        case 4:
          drawSpriteKey(ctx, 'tree_5', 'idle', 0, sx, sy, ts);
          break;
        default:
          drawSpriteKey(ctx, 'tree_6', 'idle', 0, sx, sy, ts);
          break;
      }
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

    default:
      return false;
  }
}
