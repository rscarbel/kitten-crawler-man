/**
 * The Over City's market: the carts in the square and the people behind them.
 * Owned by `DungeonScene` and active only on the overworld. Each vendor in
 * `MARKET_VENDORS` gets a two-tile counter footprint, a stationed `Townsperson`
 * drawn at full citizen scale, and a `Browse` interaction that opens the shared
 * priced menu built by `buildVendorMenu`.
 *
 * A stall is a *single* renderable that draws three layers around its own vendor
 * (back frame → person → counter → canopy). The scene's Y-sort key is one number,
 * so a vendor registered separately could not be both behind the counter and in
 * front of the back frame; owning the order here is the only way to get it right.
 */

import { TILE_SIZE } from '../../core/constants';
import { Townsperson } from '../../creatures/Townsperson';
import type { WanderParams } from '../../creatures/townWander';
import { STALL_WIDTH_TILES, stallRippleStep, stallVariantIndex } from '../../sprites/marketStall';
import { drawTownSheetFrame } from '../../sprites/townSheetProp';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { tileKey } from '../tileKey';
import { buildVendorMenu, createVendorPurchase, type VendorGateCheck } from './vendorMenu';
import { MARKET_VENDORS, type VendorDef } from './vendorDefs';
import type { MarketStock } from './MarketStock';
import type { AudioManager } from '../../audio/AudioManager';
import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import type { PricedMenuBuilder, PricedPurchaseHandler } from '../../ui/PricedMenuPanel';
import type { GameSystem } from '../GameSystem';
import type { TownPropRenderable } from '../townPropRenderable';

// Reach for the Browse prompt, matched to the other town props: just over a
// diagonal step, so standing on any tile adjacent to either counter half counts.
const INTERACT_RADIUS_TILES = 1.6;
const INTERACT_RADIUS = TILE_SIZE * INTERACT_RADIUS_TILES;

const PROMPT_LABEL = 'Browse';

// Rings searched outward from a vendor's preferred spot for a free two-tile span.
const SPAN_SEARCH_RADIUS = 4;

// The vendor stands one tile north of their counter, so the counter art crosses
// their hips and the player faces them across it.
const VENDOR_ROW_OFFSET = -1;

// A stationed vendor never leaves their post: their wander target is their own
// standing spot, which `stepWander` resolves as "arrived" every frame — it
// counts down a pause and reports no movement, which is exactly the idle sway
// (and idle animation frames) wanted here.
const VENDOR_SPEED = 0;
const VENDOR_ARRIVE_DIST = TILE_SIZE;
const VENDOR_PAUSE_MIN = 90;
const VENDOR_PAUSE_MAX = 240;

const CENTER_OFFSET = TILE_SIZE / 2;

interface TileXY {
  x: number;
  y: number;
}

interface MarketStall {
  def: VendorDef;
  /** West and east tiles of the 2×1 counter footprint. */
  tiles: readonly [TileXY, TileXY];
  /** The stationed vendor, drawn by the stall itself so occlusion is correct. */
  vendor: Townsperson;
  /** How many times the player has browsed — rotates `def.barks`. */
  visits: number;
  /** Idle-animation clock for the canopy hem, advanced per frame. */
  phase: number;
}

/** Everything the scene needs to open a stall's panel: the rows, and the sale. */
export interface MarketBrowse {
  buildMenu: PricedMenuBuilder;
  purchase: PricedPurchaseHandler;
  /** Sounds the refusal when the player pokes a row they can't buy. */
  onBlocked: () => void;
}

export class MarketSystem implements GameSystem {
  private readonly stalls: MarketStall[] = [];
  private readonly renderables: TownPropRenderable[] = [];
  private readonly reserved = new Set<string>();

  constructor(
    private readonly gameMap: GameMap,
    private readonly stock: MarketStock,
    private readonly onBrowse: (browse: MarketBrowse) => void,
    /** Whether a stall panel is currently up — drives the vendor's held pose. */
    private readonly isBrowsing: () => boolean,
    // An accessor, not the manager itself: the market is built before the scene's
    // audio field is assigned, so the sound source is resolved lazily at use time.
    private readonly getAudio: () => AudioManager | null,
    /**
     * Whether a quest-gated line is on the counter. The market can see neither
     * the questlines nor the party's bags, so the scene answers this.
     */
    private readonly isGateOpen: VendorGateCheck,
  ) {
    this.placeStalls();
  }

  /**
   * The west counter tile of a named vendor's stall, for a questline that wants
   * to point the Journal's chevron at it. Null before the stalls are placed, or
   * where the plaza had no room for that vendor.
   */
  stallTileFor(vendorId: string): { x: number; y: number } | null {
    return this.stalls.find((stall) => stall.def.id === vendorId)?.tiles[0] ?? null;
  }

  /** Renderable stalls for the scene's Y-sorted entity pass. */
  get props(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /**
   * Tiles the stalls have claimed, so `TownPropSystem` can keep its own props off
   * them. `blockTilePermanently` alone would not do: prop placement deliberately
   * tests `isWalkableIgnoringPermanent`, which ignores exactly those blocks.
   */
  get reservedTiles(): ReadonlySet<string> {
    return this.reserved;
  }

  update(): void {
    const browsing = this.isBrowsing();
    for (const stall of this.stalls) {
      // Releases whichever vendor was held facing the player once their panel is
      // gone, however it was dismissed — Space, Esc, or a tap outside.
      if (!browsing) stall.vendor.frozen = false;
      stall.vendor.update();
      stall.phase += PHASE_STEP;
    }
  }

  /**
   * Space-key handler for the scene's interaction chain. Opens the menu of the
   * stall in reach, if any, and turns its vendor to face the customer.
   */
  tryInteract(active: Player): boolean {
    const stall = this.nearestStall(active);
    if (stall === null) return false;
    stall.vendor.faceToward(active.x, active.y);
    stall.vendor.frozen = true;
    // Captured before the increment so the panel keeps one greeting for as long
    // as it's open, and the next visit gets the next line.
    const visits = stall.visits;
    stall.visits++;
    this.onBrowse({
      buildMenu: () => buildVendorMenu(stall.def, this.stock, visits, this.isGateOpen),
      purchase: createVendorPurchase(stall.def, this.stock, this.getAudio),
      onBlocked: () => this.getAudio()?.play('error_taking_action'),
    });
    return true;
  }

  /** Floats a SPACE prompt over the stall in reach, if one is. */
  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): boolean {
    const stall = this.nearestStall(active);
    if (stall === null) return false;
    const [west] = stall.tiles;
    drawInteractionPrompt(
      ctx,
      west.x * TILE_SIZE - camX,
      west.y * TILE_SIZE - camY,
      TILE_SIZE * STALL_WIDTH_TILES,
      PROMPT_LABEL,
    );
    return true;
  }

  private nearestStall(active: Player): MarketStall | null {
    const px = active.x + CENTER_OFFSET;
    const py = active.y + CENTER_OFFSET;
    for (const stall of this.stalls) {
      for (const tile of stall.tiles) {
        const dist = Math.hypot(
          px - (tile.x * TILE_SIZE + CENTER_OFFSET),
          py - (tile.y * TILE_SIZE + CENTER_OFFSET),
        );
        if (dist <= INTERACT_RADIUS) return stall;
      }
    }
    return null;
  }

  private placeStalls(): void {
    // Read from the map rather than recomputed as `gridSize / 2`, which was only
    // ever right because the plaza happened to be centred on the map.
    const centre = this.gameMap.townSquareCentre ?? {
      x: Math.floor(this.gameMap.gridSize / 2),
      y: Math.floor(this.gameMap.gridSize / 2),
    };
    for (const def of MARKET_VENDORS) {
      const span = this.findFreeSpan({
        x: centre.x + def.placement.dx,
        y: centre.y + def.placement.dy,
      });
      if (span === null) continue;
      for (const tile of [...span, ...vendorRowTiles(span)]) {
        this.gameMap.blockTilePermanently(tile.x, tile.y);
        this.reserved.add(tileKey(tile.x, tile.y));
      }
      const stall: MarketStall = {
        def,
        tiles: span,
        vendor: this.makeVendor(def, span),
        visits: 0,
        phase: 0,
      };
      this.stalls.push(stall);
      this.renderables.push(new StallProp(stall));
    }
  }

  /**
   * Spiral outward from `preferred` for the first pair of horizontally adjacent
   * free tiles whose vendor row behind them is also free. Tested against
   * `isWalkableIgnoringPermanent`, not `isWalkable`: the overworld map instance is
   * reused across building round-trips, and a stall's own permanent block would
   * otherwise make this pick drift to (and leak) new tiles every trip. That
   * predicate is stable across reconstructions, so re-placement is idempotent —
   * it re-selects the same span.
   */
  private findFreeSpan(preferred: TileXY): readonly [TileXY, TileXY] | null {
    for (let ring = 0; ring <= SPAN_SEARCH_RADIUS; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const west = { x: preferred.x + dx, y: preferred.y + dy };
          // The pair is the footprint `marketStall.ts` draws: widening the art
          // past STALL_WIDTH_TILES means widening this tuple to match, or the
          // cart overhangs a tile nothing reserved.
          const east = { x: west.x + STALL_WIDTH_TILES - 1, y: west.y };
          const span: readonly [TileXY, TileXY] = [west, east];
          // The vendor row counts too, or a placement whose north neighbour is a
          // wall would stand the vendor inside it.
          if ([...span, ...vendorRowTiles(span)].every((tile) => this.isTileFree(tile))) {
            return span;
          }
        }
      }
    }
    return null;
  }

  private isTileFree(tile: TileXY): boolean {
    if (this.reserved.has(tileKey(tile.x, tile.y))) return false;
    return this.gameMap.isWalkableIgnoringPermanent(tile.x, tile.y);
  }

  private makeVendor(def: VendorDef, span: readonly [TileXY, TileXY]): Townsperson {
    const [west, east] = span;
    const standX = ((west.x + east.x) / 2) * TILE_SIZE;
    const standY = (west.y + VENDOR_ROW_OFFSET) * TILE_SIZE;
    const wander: WanderParams = {
      pickTarget: () => ({ x: standX, y: standY }),
      arriveDist: VENDOR_ARRIVE_DIST,
      pauseMin: VENDOR_PAUSE_MIN,
      pauseMax: VENDOR_PAUSE_MAX,
    };
    return new Townsperson({
      x: standX,
      y: standY,
      role: def.role,
      seed: def.appearanceSeed,
      speed: VENDOR_SPEED,
      wander,
      initialFacing: 'down',
    });
  }
}

/**
 * Idle-clock advance per `update`, driving the canopy hem's ripple. Advanced on
 * the tick and not in `render` so a stall the camera can't see stays in step with
 * the ones it can.
 */
const PHASE_STEP = 1;

/**
 * The tiles the vendor stands on, one row north of the counter. Blocked along
 * with the counter itself so citizens route around the person as well as the
 * cart, instead of strolling through them.
 */
function vendorRowTiles(span: readonly [TileXY, TileXY]): readonly [TileXY, TileXY] {
  const [west, east] = span;
  return [
    { x: west.x, y: west.y + VENDOR_ROW_OFFSET },
    { x: east.x, y: east.y + VENDOR_ROW_OFFSET },
  ];
}

/**
 * The baked sheets the stall's three layers come from, generated by
 * `scripts/generate-townscape-sprites.ts`. All three share one frame geometry,
 * so all three blit at the same anchor.
 */
const STALL_BACK_SHEET_KEY = 'market_stall_back';
const STALL_FRONT_SHEET_KEY = 'market_stall_front';
const STALL_CANOPY_SHEET_KEY = 'market_stall_canopy';

/** The back and front layers hold still, so each is a single-state sheet. */
const STALL_STATIC_STATE = 'idle';

/**
 * One stall as a single Y-sorted entity, anchored on the counter's front (south)
 * edge, so a player standing below the cart draws over it and one standing above
 * draws behind it.
 */
class StallProp implements TownPropRenderable {
  constructor(private readonly stall: MarketStall) {}

  get x(): number {
    return this.stall.tiles[0].x * TILE_SIZE;
  }

  /**
   * The footprint's top-left, like every other prop: `RenderPipeline` adds a
   * whole tile to this for the sort key, which lands it on the counter's front
   * (south) edge. Returning the south edge here would double that offset and
   * draw the cart over anything standing in front of it.
   */
  get y(): number {
    return this.stall.tiles[0].y * TILE_SIZE;
  }

  /**
   * The cart is three baked blits with the vendor drawn live between the first
   * and the second — the person is the one part of a stall that cannot be baked,
   * because they turn to face a customer and their appearance is generated.
   */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    // The vendor is a full sprite render in the middle of this, and props render
    // back to back with no reset between them — so the stall leaves the context
    // as it found it rather than trusting what the person left behind.
    ctx.save();
    const { def, vendor, phase } = this.stall;
    const sx = this.stall.tiles[0].x * tileSize - camX;
    const sy = this.stall.tiles[0].y * tileSize - camY;
    const variantFrame = stallVariantIndex(def.style, def.motif);
    drawTownSheetFrame(
      ctx,
      STALL_BACK_SHEET_KEY,
      STALL_STATIC_STATE,
      variantFrame,
      sx,
      sy,
      tileSize,
    );
    vendor.render(ctx, camX, camY, tileSize);
    drawTownSheetFrame(
      ctx,
      STALL_FRONT_SHEET_KEY,
      STALL_STATIC_STATE,
      variantFrame,
      sx,
      sy,
      tileSize,
    );
    drawTownSheetFrame(
      ctx,
      STALL_CANOPY_SHEET_KEY,
      `ripple_${stallRippleStep(phase)}`,
      variantFrame,
      sx,
      sy,
      tileSize,
    );
    ctx.restore();
  }
}
