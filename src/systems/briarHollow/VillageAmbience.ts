/**
 * The parts of Briar Hollow that move or change with the game: the bell's swing,
 * the sawmill blade, the forge's coals and the hearth fires, the tools on Oren's
 * rack, smoke from the chimneys, the lamps' glow and the laundry on its line.
 *
 * All of it is drawn live over the baked prop frames rather than baked as extra
 * sheet rows — an overlay row costs a full frame of memory per cell however
 * little of it is inked, and most of this is a glow or a wisp. Everything is a
 * pure function of the clock and a few flags, so nothing here accumulates state
 * a checkpoint would need, and each piece is culled when its prop is off screen.
 *
 * Where each piece is drawn is read off the same anchors the prop painters leave
 * room for (`BELL_PIVOT`, `SAWMILL_BLADE`, … in `villageArt.ts`), so the painted
 * half of a prop and its live half cannot drift apart.
 */

import { TILE_SIZE } from '../../core/constants';
import { TOOL_TIER_LOOKS, type ToolTier } from '../../core/toolTiers';
import type { GameMap } from '../../map/GameMap';
import { HOLLOW_WALL } from '../../map/tileTypes';
import { VILLAGE_PROPS, type VillagePropId } from '../../map/overworld/briarHollowLayout';
import type { BriarHollowSite, PropPlacement } from '../../map/overworld/briarHollowSite';
import {
  HOLLOW_POST_TILES,
  hollowDoorLanternOffset,
  hollowDoorLanternTiles,
} from '../../map/tiles/hollowWallTiles';
import {
  BELL_HEIGHT_TILES,
  BELL_PIVOT,
  BRASS,
  CLOTH,
  COOKING_CHIMNEY_TOP,
  COOKING_FIRE,
  COOKING_POT,
  FLAME,
  FORGE_CHIMNEY_TOP,
  FORGE_COALS,
  HALL_HEARTH_CHIMNEY_TOP,
  HALL_HEARTH_FIRE,
  INK,
  IRON,
  LAMP_POST_LANTERN,
  NOTICE_BOARD_POSTER,
  NOTICE_BOARD_POSTER_H_TILES,
  NOTICE_BOARD_POSTER_W_TILES,
  SAWMILL_BLADE,
  SAWMILL_BLADE_RADIUS_TILES,
  TOOL_RACK_AXE_TOP,
  TOOL_RACK_PICK_TOP,
  WOOD,
  type ClothColour,
  type OverlayAnchor,
} from '../../sprites/art/villageArt';
import { drawText } from '../../ui/TextBox';
import type { TownPropRenderable } from '../townPropRenderable';

/** A point in world pixels. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** A prop's footprint in world pixels: the left edge and the ground line of its bottom row. */
interface PropFoot {
  readonly left: number;
  readonly bottom: number;
  /** Top-left of the tile the prop Y-sorts on, for the overlay's own sort. */
  readonly sortTileY: number;
}

function footOf(placement: PropPlacement): PropFoot {
  const bottomRow = placement.y + VILLAGE_PROPS[placement.prop].h - 1;
  return {
    left: placement.x * TILE_SIZE,
    bottom: (bottomRow + 1) * TILE_SIZE,
    sortTileY: bottomRow * TILE_SIZE,
  };
}

function anchorPoint(foot: PropFoot, anchor: OverlayAnchor): WorldPoint {
  return { x: foot.left + anchor.x * TILE_SIZE, y: foot.bottom - anchor.up * TILE_SIZE };
}

/** A flame's glow and its chimney's smoke, for one hearth. */
interface Hearth {
  readonly fire: WorldPoint;
  readonly chimney: WorldPoint;
  readonly sortTileY: number;
  readonly glowRadius: number;
  /** A pot's steam, for the cooking hearth. */
  readonly steam: WorldPoint | null;
  readonly phase: number;
}

interface LaundryLine {
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly colour: ClothColour;
}

interface Anchors {
  readonly site: BriarHollowSite;
  readonly bell: { readonly pivot: WorldPoint; readonly sortTileY: number } | null;
  readonly sawmills: ReadonlyArray<{ readonly blade: WorldPoint; readonly sortTileY: number }>;
  readonly hearths: ReadonlyArray<Hearth>;
  readonly lamps: ReadonlyArray<WorldPoint>;
  readonly toolRacks: ReadonlyArray<{ readonly foot: PropFoot }>;
  readonly noticeBoards: ReadonlyArray<{ readonly poster: WorldPoint; readonly sortTileY: number }>;
  readonly laundry: LaundryLine | null;
}

// ── Tuning ────────────────────────────────────────────────────────────────────

/** The bell at rest still stirs in the wind. */
const BELL_IDLE_SWAY_RADIANS = 0.05;
const BELL_IDLE_SWAY_RATE = 0.9;
const BELL_RING_SWING_RADIANS = 0.55;
/** Swings a second while ringing: two strokes of the clapper. */
const BELL_RING_SWINGS_PER_SECOND = 0.9;
const BELL_RING_RATE = Math.PI * 2 * BELL_RING_SWINGS_PER_SECOND;
const BELL_WIDTH_SHARE = 0.9;
const BELL_CLAPPER_SHARE = 0.22;
/** The bell's outline, as shares of its height (y) and half-width (x). */
const BELL = {
  crown: 0.1,
  crownHalfWidth: 0.45,
  waist: 0.6,
  waistHalfWidth: 0.55,
  shineOffset: 0.3,
  shineTop: 0.2,
  shineWidth: 0.22,
  shineHeight: 0.6,
  lipBand: 0.14,
  clapperLag: 0.3,
} as const;
const BELL_HANGER_PX = 2;
/** A cracked bell hangs still, a little askew on a hanger that has worked loose. */
const BELL_CRACKED_LEAN_RADIANS = 0.2;
/** Split bronze: the body dulled toward verdigris-grey. */
const BELL_CRACKED_BODY = '#5a5240';
const BELL_CRACK_WIDTH_PX = 2.5;
/** The split's lit lip, a hair to one side, so it reads as a gap rather than a scratch. */
const BELL_CRACK_EDGE_OFFSET_PX = 1;
const BELL_CRACK_EDGE = '#b8a878';
/** The split zig-zags from this far down the bell to its lip, swinging this far either side. */
const BELL_CRACK_TOP_SHARE = 0.3;
const BELL_CRACK_ZIG_SHARE = 0.3;
const BELL_CRACK_TURNS = 4;
/** The poster sorts a hair after the board it is pinned to. */
const POSTER_SORT_NUDGE_PX = 0.5;
const POSTER_TILT_RADIANS = -0.05;
const POSTER_EDGE_PX = 1;
const POSTER_SPEAR_PX = 1.5;
/** How far the spears reach toward the poster's corners, as a share of its size. */
const POSTER_SPEAR_REACH = 0.38;
/** The bell's half-size as a share of the poster's width, and its crown's width against its lip. */
const POSTER_BELL_SHARE = 0.2;
const POSTER_BELL_CROWN_SHARE = 0.5;
const POSTER_PIN_PX = 2;
const BELL_OUTLINE_PX = 1;
/** "BONG" rings: how many are in the air at once, how far they spread, how long each lives. */
const BONG_RINGS = 3;
const BONG_RING_REACH_TILES = 2.4;
const BONG_RING_SECONDS = 1.1;
const BONG_RING_WIDTH_PX = 2;
const BONG_TEXT_SIZE_PX = 12;
const BONG_TEXT_RISE_TILES = 0.9;
const BONG_COLOR = '#f4dc92';

const BLADE_BLUR_ALPHA = 0.55;
const BLADE_SPOKES = 6;
const BLADE_SPIN_RATE = 40;
const SAWDUST_PUFFS = 6;
const SAWDUST_PUFF_SECONDS = 0.8;
const SAWDUST_PUFF_REACH_TILES = 0.5;
const SAWDUST_PUFF_RADIUS_PX = 2.2;
const SAWDUST_COLOR = '#d8b47c';
/** The blur's streaks: how far out they sit, how long they are, how thick. */
const BLADE_STREAK_RADIUS_SHARE = 0.75;
const BLADE_STREAK_RADIANS = 0.4;
const BLADE_STREAK_PX = 1;
/** Sawdust is thrown off the top of the blade in a flattened arc, and rises as it goes. */
const SAWDUST_ARC_SQUASH = 0.5;
const SAWDUST_LIFT_SHARE = 0.4;
const SAWDUST_SHRINK_SHARE = 0.5;

const FORGE_GLOW_RADIUS_TILES = 0.7;
const HEARTH_GLOW_RADIUS_TILES = 0.5;
const FIRE_GLOW_ALPHA = 0.35;
/** Flicker: a sum of two sines whose rates share no common period, so it never visibly loops. */
const FLICKER_RATE_A = 7.3;
const FLICKER_RATE_B = 12.9;
const FLICKER_DEPTH = 0.3;
const FIRE_CORE_SHARE = 0.3;
const FIRE_CORE_ALPHA = 0.5;
/** Out of step with the glow round it, so the core and the glow do not pulse as one. */
const FIRE_CORE_PHASE_OFFSET = 1;
/** A bed of coals is wide and low, seen from above. */
const FIRE_CORE_SQUASH = 0.5;

const SMOKE_PUFFS = 5;
const SMOKE_PUFF_SECONDS = 3.2;
const SMOKE_RISE_TILES = 1.6;
const SMOKE_DRIFT_TILES = 0.6;
const SMOKE_RADIUS_START_PX = 3.5;
const SMOKE_RADIUS_GROWTH_PX = 8;
const SMOKE_ALPHA = 0.4;
const SMOKE_COLOR = '#b8b0a4';
const STEAM_PUFFS = 3;
const STEAM_RISE_TILES = 0.7;
const STEAM_ALPHA = 0.3;
const STEAM_COLOR = '#e8e4dc';

const LAMP_GLOW_RADIUS_TILES = 1.1;
const LAMP_GLOW_ALPHA = 0.22;
const DOOR_LANTERN_GLOW_RADIUS_TILES = 0.7;

/** How far past the view a piece may start and still reach into it. */
const CULL_MARGIN_TILES = 3;

const TOOL_HEAD_TILES = 0.16;
const TOOL_EDGE_WIDTH_PX = 1;
/** A bearded axe blade hung off the left of its handle, in head-sizes from the handle top. */
const AXE_BLADE = {
  /** The blade's back edge, where it meets the handle. */
  heelBottom: 0.45,
  /** The cutting edge's top and bottom corners: the beard hangs lower than the toe. */
  toeTop: -0.35,
  beardBottom: 0.75,
} as const;
const AXE_HEAD: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, AXE_BLADE.toeTop],
  [-1, AXE_BLADE.beardBottom],
  [0, AXE_BLADE.heelBottom],
];
const AXE_EDGE_TOP = -0.3;
const AXE_EDGE_BOTTOM = 0.7;
/** A pick's curved bar across its handle's top, in head-sizes. */
const PICK = {
  halfSpan: 0.9,
  tipDrop: 0.35,
  crownRise: 0.3,
  outlineWidth: 0.45,
  barWidth: 0.28,
} as const;
const TOOL_GLOW_ALPHA = 0.5;

const LAUNDRY_SAG_TILES = 0.18;
const LAUNDRY_ITEMS = 4;
const LAUNDRY_ITEM_W_TILES = 0.22;
const LAUNDRY_ITEM_H_TILES = 0.3;
const LAUNDRY_SWAY_RATE = 1.7;
const LAUNDRY_SWAY_PX = 1.5;
const LAUNDRY_CORD_COLOR = '#d8ccb0';
const LAUNDRY_CORD_PX = 1;
/** Every other item on the line is a shorter cloth, so the line does not read as a row of flags. */
const LAUNDRY_SHORT_ITEM_SHARE = 0.75;
const LAUNDRY_PEG_W_PX = 2;
const LAUNDRY_PEG_H_PX = 3;
/** The line is tied a little below the top of the posts it hangs from. */
const LAUNDRY_TIE_DROP_TILES = 0.15;
/** A corner post's centre, from the outer edge of its tile. */
const CORNER_POST_CENTRE_TILES = 0.25;
/** How far along a home's row to look for the wall across the lane. */
const LAUNDRY_SEARCH_TILES = 5;
/** The line spans at least the one-tile walkway, so it never hangs over a wall's own tile. */
const LAUNDRY_MIN_SPAN_TILES = 2;

export class VillageAmbience {
  /** Set while the sawmill is processing; its blade spins and throws sawdust. */
  readonly sawmill = { working: false };
  /**
   * `ringing`: the bell is being rung; it swings, and rings spread from it.
   * `cracked`: it has been beaten to nothing and hangs dead and split.
   */
  readonly bell = { ringing: false, cracked: false };
  /** Set while the siege is on: a call-to-arms poster covers the notices. */
  readonly noticeBoard = { callToArms: false };

  /** The axe and pick tiers shown on Oren's rack: the next ones he sells. */
  private axeTier: ToolTier = TOOL_TIERS_SHOWN_BY_DEFAULT;
  private pickTier: ToolTier = TOOL_TIERS_SHOWN_BY_DEFAULT;

  private seconds = 0;
  private anchors: Anchors | null = null;
  private readonly renderables: TownPropRenderable[] = [];

  /** Advances the clock and picks up the village on `gameMap`. */
  update(gameMap: GameMap, dtSeconds: number): void {
    this.seconds += dtSeconds;
    const site = gameMap.briarHollow;
    if (site === null) {
      this.anchors = null;
      this.renderables.length = 0;
      return;
    }
    if (this.anchors?.site !== site) this.rebuild(gameMap, site);
  }

  /** The tools Oren would sell next, one tier past what the party carries. */
  setToolTiers(axe: ToolTier, pick: ToolTier): void {
    this.axeTier = axe;
    this.pickTier = pick;
  }

  private rebuild(gameMap: GameMap, site: BriarHollowSite): void {
    const placements: PropPlacement[] = [
      ...site.props,
      ...site.buildings.flatMap((building) => building.furniture),
    ];
    const ofKind = (prop: VillagePropId): PropPlacement[] =>
      placements.filter((placement) => placement.prop === prop);
    const bellPlacement = placements.find((placement) => placement.prop === 'bell_tower');
    const bellFoot = bellPlacement === undefined ? null : footOf(bellPlacement);
    const hearths: Hearth[] = [];
    const addHearth = (
      prop: VillagePropId,
      fire: OverlayAnchor,
      chimney: OverlayAnchor,
      glowTiles: number,
      pot: OverlayAnchor | null,
    ): void => {
      for (const [index, placement] of ofKind(prop).entries()) {
        const foot = footOf(placement);
        hearths.push({
          fire: anchorPoint(foot, fire),
          chimney: anchorPoint(foot, chimney),
          sortTileY: foot.sortTileY,
          glowRadius: glowTiles * TILE_SIZE,
          steam: pot === null ? null : anchorPoint(foot, pot),
          phase: hearths.length + index,
        });
      }
    };
    addHearth('forge_hearth', FORGE_COALS, FORGE_CHIMNEY_TOP, FORGE_GLOW_RADIUS_TILES, null);
    addHearth(
      'cooking_hearth',
      COOKING_FIRE,
      COOKING_CHIMNEY_TOP,
      HEARTH_GLOW_RADIUS_TILES,
      COOKING_POT,
    );
    addHearth('hearth', HALL_HEARTH_FIRE, HALL_HEARTH_CHIMNEY_TOP, HEARTH_GLOW_RADIUS_TILES, null);

    const lamps: WorldPoint[] = ofKind('lamp_post').map((placement) =>
      anchorPoint(footOf(placement), LAMP_POST_LANTERN),
    );
    const doorLanterns: WorldPoint[] = [];
    for (const tile of hollowDoorLanternTiles(gameMap.structure)) {
      const offset = hollowDoorLanternOffset(gameMap.structure, tile.tx, tile.ty);
      if (offset === null) continue;
      doorLanterns.push({
        x: (tile.tx + offset.x) * TILE_SIZE,
        y: (tile.ty + offset.y) * TILE_SIZE,
      });
    }

    this.anchors = {
      site,
      bell:
        bellFoot === null
          ? null
          : { pivot: anchorPoint(bellFoot, BELL_PIVOT), sortTileY: bellFoot.sortTileY },
      sawmills: ofKind('sawmill_machine').map((placement) => {
        const foot = footOf(placement);
        return { blade: anchorPoint(foot, SAWMILL_BLADE), sortTileY: foot.sortTileY };
      }),
      hearths,
      lamps: [...lamps, ...doorLanterns],
      toolRacks: ofKind('tool_rack').map((placement) => ({ foot: footOf(placement) })),
      noticeBoards: ofKind('notice_board').map((placement) => {
        const foot = footOf(placement);
        return { poster: anchorPoint(foot, NOTICE_BOARD_POSTER), sortTileY: foot.sortTileY };
      }),
      laundry: laundryLineFor(gameMap, site),
    };
    this.doorLanternCount = doorLanterns.length;
    this.buildRenderables();
  }

  private doorLanternCount = 0;

  private buildRenderables(): void {
    const anchors = this.anchors;
    this.renderables.length = 0;
    if (anchors === null) return;
    const bell = anchors.bell;
    if (bell !== null) {
      this.renderables.push({
        x: bell.pivot.x,
        y: bell.sortTileY,
        cullMarginTiles: CULL_MARGIN_TILES,
        render: (ctx, camX, camY) => this.drawBell(ctx, bell.pivot, camX, camY),
      });
    }
    for (const sawmill of anchors.sawmills) {
      this.renderables.push({
        x: sawmill.blade.x,
        y: sawmill.sortTileY,
        cullMarginTiles: CULL_MARGIN_TILES,
        render: (ctx, camX, camY) => {
          if (this.sawmill.working) this.drawSpinningBlade(ctx, sawmill.blade, camX, camY);
        },
      });
    }
    for (const hearth of anchors.hearths) {
      this.renderables.push({
        x: hearth.fire.x,
        y: hearth.sortTileY,
        cullMarginTiles: CULL_MARGIN_TILES,
        render: (ctx, camX, camY) => this.drawFireGlow(ctx, hearth, camX, camY),
      });
    }
    for (const board of anchors.noticeBoards) {
      this.renderables.push({
        x: board.poster.x,
        // Just after the board itself, so the poster is pinned on its face.
        y: board.sortTileY + POSTER_SORT_NUDGE_PX,
        cullMarginTiles: CULL_MARGIN_TILES,
        render: (ctx, camX, camY) => {
          if (this.noticeBoard.callToArms) this.drawCallToArms(ctx, board.poster, camX, camY);
        },
      });
    }
    for (const rack of anchors.toolRacks) {
      this.renderables.push({
        x: rack.foot.left,
        y: rack.foot.sortTileY,
        render: (ctx, camX, camY) => this.drawRackTools(ctx, rack.foot, camX, camY),
      });
    }
  }

  /** The live pieces that must Y-sort against bodies: merged into the scene's entity pass. */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /** Smoke, lamp glow, laundry and the bell's rings: drawn over every body. */
  renderAbove(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    const anchors = this.anchors;
    if (anchors === null) return;
    const margin = CULL_MARGIN_TILES * TILE_SIZE;
    const onScreen = (point: WorldPoint): boolean =>
      point.x > camX - margin &&
      point.x < camX + viewW + margin &&
      point.y > camY - margin &&
      point.y < camY + viewH + margin;

    for (const hearth of anchors.hearths) {
      if (onScreen(hearth.chimney)) this.drawSmoke(ctx, hearth, camX, camY);
    }
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      anchors.lamps.forEach((lamp, index) => {
        if (!onScreen(lamp)) return;
        const isDoorLantern = index >= anchors.lamps.length - this.doorLanternCount;
        const radius =
          (isDoorLantern ? DOOR_LANTERN_GLOW_RADIUS_TILES : LAMP_GLOW_RADIUS_TILES) * TILE_SIZE;
        this.drawGlow(ctx, lamp.x - camX, lamp.y - camY, radius, LAMP_GLOW_ALPHA, index);
      });
    } finally {
      ctx.restore();
    }
    const laundry = anchors.laundry;
    // The line spans several tiles, so it is culled by its whole extent: a
    // test on one end would drop the rest of the cord at the screen's edge.
    if (laundry !== null) {
      const hangPx = (LAUNDRY_SAG_TILES * 2 + LAUNDRY_ITEM_H_TILES) * TILE_SIZE;
      const lineVisible =
        laundry.to.x > camX &&
        laundry.from.x < camX + viewW &&
        laundry.from.y + hangPx > camY &&
        laundry.from.y < camY + viewH;
      if (lineVisible) this.drawLaundry(ctx, laundry, camX, camY);
    }
    const bell = anchors.bell;
    if (bell !== null && this.bell.ringing && onScreen(bell.pivot)) {
      this.drawBongRings(ctx, bell.pivot, camX, camY);
    }
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  private flicker(phase: number): number {
    const t = this.seconds;
    return (
      1 -
      FLICKER_DEPTH / 2 +
      (FLICKER_DEPTH / 2) *
        (Math.sin(t * FLICKER_RATE_A + phase) * Math.sin(t * FLICKER_RATE_B + phase * 2))
    );
  }

  private drawGlow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    phase: number,
  ): void {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const strength = alpha * this.flicker(phase);
    glow.addColorStop(0, `rgba(255,190,110,${strength})`);
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBell(
    ctx: CanvasRenderingContext2D,
    pivot: WorldPoint,
    camX: number,
    camY: number,
  ): void {
    const cracked = this.bell.cracked;
    // A cracked bell hangs dead: no ringing, and no stir in the wind either.
    const swing = cracked
      ? BELL_CRACKED_LEAN_RADIANS
      : this.bell.ringing
        ? Math.sin(this.seconds * BELL_RING_RATE) * BELL_RING_SWING_RADIANS
        : Math.sin(this.seconds * BELL_IDLE_SWAY_RATE) * BELL_IDLE_SWAY_RADIANS;
    const height = BELL_HEIGHT_TILES * TILE_SIZE;
    const halfWidth = (height * BELL_WIDTH_SHARE) / 2;
    ctx.save();
    try {
      ctx.translate(pivot.x - camX, pivot.y - camY);
      ctx.rotate(swing);
      ctx.fillStyle = IRON.dark;
      ctx.fillRect(-BELL_HANGER_PX / 2, 0, BELL_HANGER_PX, height * BELL.crown);
      // Waisted: a narrow crown flaring to a wide lip, which is what reads as
      // "bell" rather than "pot" at this size.
      ctx.beginPath();
      ctx.moveTo(-halfWidth * BELL.crownHalfWidth, height * BELL.crown);
      ctx.quadraticCurveTo(
        -halfWidth * BELL.waistHalfWidth,
        height * BELL.waist,
        -halfWidth,
        height,
      );
      ctx.lineTo(halfWidth, height);
      ctx.quadraticCurveTo(
        halfWidth * BELL.waistHalfWidth,
        height * BELL.waist,
        halfWidth * BELL.crownHalfWidth,
        height * BELL.crown,
      );
      ctx.closePath();
      ctx.fillStyle = cracked ? BELL_CRACKED_BODY : BRASS.body;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = BELL_OUTLINE_PX;
      ctx.stroke();
      if (cracked) this.drawBellCrack(ctx, halfWidth, height);
      ctx.fillStyle = BRASS.light;
      ctx.fillRect(
        -halfWidth * BELL.shineOffset,
        height * BELL.shineTop,
        halfWidth * BELL.shineWidth,
        height * BELL.shineHeight,
      );
      ctx.fillStyle = BRASS.dark;
      ctx.fillRect(-halfWidth, height * (1 - BELL.lipBand), halfWidth * 2, height * BELL.lipBand);
      // The clapper lags the swing, so it hangs toward the side the bell left.
      ctx.fillStyle = IRON.body;
      ctx.beginPath();
      ctx.arc(
        Math.sin(-swing) * halfWidth * BELL.clapperLag,
        height * (1 + BELL_CLAPPER_SHARE / 2),
        (height * BELL_CLAPPER_SHARE) / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } finally {
      ctx.restore();
    }
  }

  /** A jagged split from the shoulder to the lip, dark enough to read at a tile's size. */
  private drawBellCrack(ctx: CanvasRenderingContext2D, halfWidth: number, height: number): void {
    const trace = (offsetX: number): void => {
      ctx.beginPath();
      ctx.moveTo(offsetX, BELL_CRACK_TOP_SHARE * height);
      for (let turn = 1; turn <= BELL_CRACK_TURNS; turn++) {
        const down = BELL_CRACK_TOP_SHARE + ((1 - BELL_CRACK_TOP_SHARE) * turn) / BELL_CRACK_TURNS;
        const side = turn % 2 === 0 ? -1 : 1;
        ctx.lineTo(offsetX + side * BELL_CRACK_ZIG_SHARE * halfWidth, down * height);
      }
      ctx.stroke();
    };
    ctx.lineWidth = BELL_CRACK_WIDTH_PX;
    ctx.strokeStyle = BELL_CRACK_EDGE;
    trace(BELL_CRACK_EDGE_OFFSET_PX);
    ctx.strokeStyle = INK;
    trace(0);
  }

  /**
   * The siege's poster over the notices: crimson with a bell and two crossed
   * spears, which reads as "to arms" at the size a notice board is drawn.
   */
  private drawCallToArms(
    ctx: CanvasRenderingContext2D,
    centre: WorldPoint,
    camX: number,
    camY: number,
  ): void {
    const w = NOTICE_BOARD_POSTER_W_TILES * TILE_SIZE;
    const h = NOTICE_BOARD_POSTER_H_TILES * TILE_SIZE;
    const x = centre.x - camX;
    const y = centre.y - camY;
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.rotate(POSTER_TILT_RADIANS);
      ctx.fillStyle = CLOTH.madder.body;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = CLOTH.madder.dark;
      ctx.lineWidth = POSTER_EDGE_PX;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      // Two crossed spears behind the bell.
      ctx.strokeStyle = CLOTH.linen.light;
      ctx.lineWidth = POSTER_SPEAR_PX;
      ctx.beginPath();
      ctx.moveTo(-w * POSTER_SPEAR_REACH, -h * POSTER_SPEAR_REACH);
      ctx.lineTo(w * POSTER_SPEAR_REACH, h * POSTER_SPEAR_REACH);
      ctx.moveTo(w * POSTER_SPEAR_REACH, -h * POSTER_SPEAR_REACH);
      ctx.lineTo(-w * POSTER_SPEAR_REACH, h * POSTER_SPEAR_REACH);
      ctx.stroke();
      const bellR = w * POSTER_BELL_SHARE;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(-bellR * POSTER_BELL_CROWN_SHARE, -bellR);
      ctx.lineTo(bellR * POSTER_BELL_CROWN_SHARE, -bellR);
      ctx.lineTo(bellR, bellR);
      ctx.lineTo(-bellR, bellR);
      ctx.closePath();
      ctx.fill();
      // A pin at the top, so it reads as pinned rather than painted on.
      ctx.fillStyle = IRON.light;
      ctx.fillRect(-POSTER_PIN_PX / 2, -h / 2 - POSTER_PIN_PX / 2, POSTER_PIN_PX, POSTER_PIN_PX);
    } finally {
      ctx.restore();
    }
  }

  private drawBongRings(
    ctx: CanvasRenderingContext2D,
    pivot: WorldPoint,
    camX: number,
    camY: number,
  ): void {
    const x = pivot.x - camX;
    const y = pivot.y - camY;
    ctx.save();
    try {
      ctx.strokeStyle = BONG_COLOR;
      ctx.lineWidth = BONG_RING_WIDTH_PX;
      for (let ring = 0; ring < BONG_RINGS; ring++) {
        const age =
          ((this.seconds + (ring * BONG_RING_SECONDS) / BONG_RINGS) % BONG_RING_SECONDS) /
          BONG_RING_SECONDS;
        ctx.globalAlpha = 1 - age;
        ctx.beginPath();
        ctx.arc(x, y, age * BONG_RING_REACH_TILES * TILE_SIZE, 0, Math.PI * 2);
        ctx.stroke();
      }
      const stroke = (this.seconds % BONG_RING_SECONDS) / BONG_RING_SECONDS;
      ctx.globalAlpha = 1 - stroke;
    } finally {
      ctx.restore();
    }
    const stroke = (this.seconds % BONG_RING_SECONDS) / BONG_RING_SECONDS;
    drawText(ctx, 'BONG', {
      x,
      y: y - BONG_TEXT_RISE_TILES * TILE_SIZE * (1 + stroke),
      size: BONG_TEXT_SIZE_PX,
      color: BONG_COLOR,
      align: 'center',
      outline: true,
      alpha: 1 - stroke,
    });
  }

  private drawSpinningBlade(
    ctx: CanvasRenderingContext2D,
    blade: WorldPoint,
    camX: number,
    camY: number,
  ): void {
    const x = blade.x - camX;
    const y = blade.y - camY;
    const radius = SAWMILL_BLADE_RADIUS_TILES * TILE_SIZE;
    ctx.save();
    try {
      ctx.globalAlpha = BLADE_BLUR_ALPHA;
      ctx.fillStyle = IRON.light;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = IRON.glint;
      ctx.lineWidth = BLADE_STREAK_PX;
      const spin = this.seconds * BLADE_SPIN_RATE;
      for (let spoke = 0; spoke < BLADE_SPOKES; spoke++) {
        const angle = spin + (spoke / BLADE_SPOKES) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x, y, radius * BLADE_STREAK_RADIUS_SHARE, angle, angle + BLADE_STREAK_RADIANS);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = SAWDUST_COLOR;
      for (let puff = 0; puff < SAWDUST_PUFFS; puff++) {
        const age =
          ((this.seconds + (puff * SAWDUST_PUFF_SECONDS) / SAWDUST_PUFFS) % SAWDUST_PUFF_SECONDS) /
          SAWDUST_PUFF_SECONDS;
        const angle = (puff / SAWDUST_PUFFS) * Math.PI - Math.PI;
        const reach = age * SAWDUST_PUFF_REACH_TILES * TILE_SIZE;
        ctx.globalAlpha = 1 - age;
        ctx.beginPath();
        ctx.arc(
          x + Math.cos(angle) * (radius + reach),
          y + Math.sin(angle) * radius * SAWDUST_ARC_SQUASH - reach * SAWDUST_LIFT_SHARE,
          SAWDUST_PUFF_RADIUS_PX * (1 - age * SAWDUST_SHRINK_SHARE),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } finally {
      ctx.restore();
    }
  }

  private drawFireGlow(
    ctx: CanvasRenderingContext2D,
    hearth: Hearth,
    camX: number,
    camY: number,
  ): void {
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(
        ctx,
        hearth.fire.x - camX,
        hearth.fire.y - camY,
        hearth.glowRadius,
        FIRE_GLOW_ALPHA,
        hearth.phase,
      );
      // A hot core that flickers harder than the glow round it.
      const core = hearth.glowRadius * FIRE_CORE_SHARE;
      ctx.globalAlpha = FIRE_CORE_ALPHA * this.flicker(hearth.phase + FIRE_CORE_PHASE_OFFSET);
      ctx.fillStyle = FLAME.mid;
      ctx.beginPath();
      ctx.ellipse(
        hearth.fire.x - camX,
        hearth.fire.y - camY,
        core,
        core * FIRE_CORE_SQUASH,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } finally {
      ctx.restore();
    }
  }

  private drawSmoke(
    ctx: CanvasRenderingContext2D,
    hearth: Hearth,
    camX: number,
    camY: number,
  ): void {
    ctx.save();
    try {
      ctx.fillStyle = SMOKE_COLOR;
      this.drawWisps(
        ctx,
        hearth.chimney,
        camX,
        camY,
        SMOKE_PUFFS,
        SMOKE_RISE_TILES,
        SMOKE_ALPHA,
        hearth.phase,
      );
      if (hearth.steam !== null) {
        ctx.fillStyle = STEAM_COLOR;
        this.drawWisps(
          ctx,
          hearth.steam,
          camX,
          camY,
          STEAM_PUFFS,
          STEAM_RISE_TILES,
          STEAM_ALPHA,
          hearth.phase + 2,
        );
      }
    } finally {
      ctx.restore();
    }
  }

  private drawWisps(
    ctx: CanvasRenderingContext2D,
    origin: WorldPoint,
    camX: number,
    camY: number,
    puffs: number,
    riseTiles: number,
    alpha: number,
    phase: number,
  ): void {
    for (let puff = 0; puff < puffs; puff++) {
      const age =
        ((this.seconds + (puff * SMOKE_PUFF_SECONDS) / puffs + phase) % SMOKE_PUFF_SECONDS) /
        SMOKE_PUFF_SECONDS;
      const drift = Math.sin(age * Math.PI + phase) * SMOKE_DRIFT_TILES * TILE_SIZE * age;
      ctx.globalAlpha = alpha * Math.sin(age * Math.PI);
      ctx.beginPath();
      ctx.arc(
        origin.x - camX + drift,
        origin.y - camY - age * riseTiles * TILE_SIZE,
        SMOKE_RADIUS_START_PX + age * SMOKE_RADIUS_GROWTH_PX,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  private drawRackTools(
    ctx: CanvasRenderingContext2D,
    foot: PropFoot,
    camX: number,
    camY: number,
  ): void {
    const head = TOOL_HEAD_TILES * TILE_SIZE;
    const axe = anchorPoint(foot, TOOL_RACK_AXE_TOP);
    const pick = anchorPoint(foot, TOOL_RACK_PICK_TOP);
    const axeLook = TOOL_TIER_LOOKS[this.axeTier];
    const pickLook = TOOL_TIER_LOOKS[this.pickTier];
    ctx.save();
    try {
      ctx.lineWidth = TOOL_EDGE_WIDTH_PX;
      ctx.strokeStyle = INK;
      // Axe: a bearded blade on the handle's left.
      const ax = axe.x - camX;
      const ay = axe.y - camY;
      ctx.fillStyle = axeLook.headColor;
      ctx.beginPath();
      AXE_HEAD.forEach(([hx, hy], index) => {
        if (index === 0) ctx.moveTo(ax + hx * head, ay + hy * head);
        else ctx.lineTo(ax + hx * head, ay + hy * head);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = axeLook.edgeColor;
      ctx.beginPath();
      ctx.moveTo(ax - head, ay + AXE_EDGE_TOP * head);
      ctx.lineTo(ax - head, ay + AXE_EDGE_BOTTOM * head);
      ctx.stroke();
      // Pick: a curved bar across the handle's top.
      const px = pick.x - camX;
      const py = pick.y - camY;
      ctx.strokeStyle = INK;
      ctx.lineWidth = head * PICK.outlineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px - head * PICK.halfSpan, py + head * PICK.tipDrop);
      ctx.quadraticCurveTo(
        px,
        py - head * PICK.crownRise,
        px + head * PICK.halfSpan,
        py + head * PICK.tipDrop,
      );
      ctx.stroke();
      ctx.strokeStyle = pickLook.headColor;
      ctx.lineWidth = head * PICK.barWidth;
      ctx.stroke();
      if (pickLook.glow !== undefined || axeLook.glow !== undefined) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = TOOL_GLOW_ALPHA;
        ctx.strokeStyle = pickLook.glow ?? axeLook.glow ?? BRASS.glint;
        ctx.lineWidth = TOOL_EDGE_WIDTH_PX;
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }
  }

  private drawLaundry(
    ctx: CanvasRenderingContext2D,
    line: LaundryLine,
    camX: number,
    camY: number,
  ): void {
    const fromX = line.from.x - camX;
    const fromY = line.from.y - camY;
    const toX = line.to.x - camX;
    const toY = line.to.y - camY;
    const sag = LAUNDRY_SAG_TILES * TILE_SIZE;
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2 + sag * 2;
    // A point along the quadratic curve the cord is drawn as.
    const pointAt = (t: number): WorldPoint => {
      const u = 1 - t;
      return {
        x: u * u * fromX + 2 * u * t * midX + t * t * toX,
        y: u * u * fromY + 2 * u * t * midY + t * t * toY,
      };
    };
    ctx.save();
    try {
      ctx.strokeStyle = LAUNDRY_CORD_COLOR;
      ctx.lineWidth = LAUNDRY_CORD_PX;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.quadraticCurveTo(midX, midY, toX, toY);
      ctx.stroke();
      const cloths = [CLOTH[line.colour], CLOTH.linen, CLOTH.woad, CLOTH.weld];
      for (let item = 0; item < LAUNDRY_ITEMS; item++) {
        const at = pointAt((item + 1) / (LAUNDRY_ITEMS + 1));
        const sway = Math.sin(this.seconds * LAUNDRY_SWAY_RATE + item) * LAUNDRY_SWAY_PX;
        const w = LAUNDRY_ITEM_W_TILES * TILE_SIZE;
        const h =
          LAUNDRY_ITEM_H_TILES * TILE_SIZE * (item % 2 === 0 ? 1 : LAUNDRY_SHORT_ITEM_SHARE);
        const cloth = cloths[item % cloths.length];
        ctx.fillStyle = cloth.body;
        ctx.beginPath();
        ctx.moveTo(at.x - w / 2, at.y);
        ctx.lineTo(at.x + w / 2, at.y);
        ctx.lineTo(at.x + w / 2 + sway, at.y + h);
        ctx.lineTo(at.x - w / 2 + sway, at.y + h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = cloth.dark;
        ctx.stroke();
        ctx.fillStyle = WOOD.light;
        ctx.fillRect(
          at.x - LAUNDRY_PEG_W_PX / 2,
          at.y - LAUNDRY_PEG_W_PX / 2,
          LAUNDRY_PEG_W_PX,
          LAUNDRY_PEG_H_PX,
        );
      }
    } finally {
      ctx.restore();
    }
  }
}

/** Oren's rack shows the first tier he sells until the party's own tools say otherwise. */
const TOOL_TIERS_SHOWN_BY_DEFAULT: ToolTier = 1;

/**
 * The laundry line: strung from the laundry home's east wall across the lane to
 * the next wall along the same row, at head height — or west, if nothing stands
 * close enough to the east. Overhead, so it never blocks and is drawn above
 * everyone who walks under it.
 */
function laundryLineFor(gameMap: GameMap, site: BriarHollowSite): LaundryLine | null {
  const home = site.buildings.find((building) => building.id === site.dressing.laundryHome);
  if (home === undefined) return null;
  // Tied between the tall log posts at the back corners of two neighbouring
  // houses: the only uprights in the village high enough to hang washing from.
  const row = home.rect.y;
  const colour = site.dressing.householdColours.get(home.id) ?? 'madder';
  const wallAt = (x: number): boolean => {
    const onMap =
      row >= 0 && row < gameMap.structure.length && x >= 0 && x < gameMap.structure[row].length;
    return onMap && gameMap.structure[row][x].type === HOLLOW_WALL;
  };
  const y = (row + 1) * TILE_SIZE - (HOLLOW_POST_TILES - LAUNDRY_TIE_DROP_TILES) * TILE_SIZE;
  for (const direction of [1, -1] as const) {
    const startX = direction > 0 ? home.rect.x + home.rect.w - 1 : home.rect.x;
    for (let step = LAUNDRY_MIN_SPAN_TILES; step <= LAUNDRY_SEARCH_TILES; step++) {
      const x = startX + direction * step;
      if (!wallAt(x)) continue;
      // A corner post stands on its wall's inner half: the west half of an
      // east corner, the east half of a west one.
      const eastPost = (tile: number): number => (tile + CORNER_POST_CENTRE_TILES) * TILE_SIZE;
      const westPost = (tile: number): number => (tile + 1 - CORNER_POST_CENTRE_TILES) * TILE_SIZE;
      const fromX = direction > 0 ? eastPost(startX) : westPost(startX);
      const toX = direction > 0 ? westPost(x) : eastPost(x);
      return {
        from: { x: Math.min(fromX, toX), y },
        to: { x: Math.max(fromX, toX), y },
        colour,
      };
    }
  }
  return null;
}
