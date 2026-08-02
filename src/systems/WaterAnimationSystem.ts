/**
 * The river, moving.
 *
 * Terrain is **chunk-baked**, so a water tile cannot animate through the bake —
 * whatever `drawTerrainTile` paints is frozen into a chunk canvas and reused for
 * as long as the chunk lives. The river is therefore two things: a static
 * painted base in the ground sheet (the `water` material, deliberately dark and
 * calm), and this — drifting specular streaks, foam flecks, wakes around the
 * rocks and the disturbance a wader makes, drawn per frame on top. There is
 * deliberately **no bank foam**: a pale dashed line along every tile where water
 * met land read as a drawn outline round the river rather than as surf. The slow swell
 * along the channel is in there too, but as a modulation of how bright those
 * marks are rather than as anything painted in its own right; see `SWELL_DEPTH`
 * for why every version that painted it failed.
 *
 * It renders in the same slot as `TreeSystem.renderGround`: after the chunk
 * ground, beneath the Y-sorted pass, so the player and the mobs wade *in front*
 * of the highlights rather than under them. Raw `ctx` is correct here — this is
 * game-world rendering, not UI chrome.
 *
 * **The system is stateless.** Every mark is a pure function of the tile's
 * position hash, its recorded `flowDir`, and the shared `frameTime`. That is not
 * only cheap: `GameMap` outlives the scene, so walking into a town building and
 * back rebuilds every system around the same map, and anything holding per-tile
 * state here would have to reconcile itself the way `TreeSystem` does. Nothing
 * to reconcile is better than reconciling correctly.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { GameMap } from '../map/GameMap';
import { FloorTypeValue, FLOW_DIR_VECTORS, RIVER_ROCK } from '../map/tileTypes';
import { drawRiverRockTile } from '../map/tiles/decorationTiles';
import { frameTime } from '../utils';
import type { GameSystem } from './GameSystem';

/** Tiles of slack around the viewport, so a mark never pops in at the edge. */
const CULL_MARGIN_TILES = 2;

/** Position-hash mixing, the idiom used across the tile renderers. */
const HASH_MIX_X = 2654435761;
const HASH_MIX_Y = 2246822519;
const HASH_MIX_INDEX = 3266489917;
const HASH_FINAL_SHIFT = 15;
const HASH_UINT32 = 0x100000000;
/** Keeps the element index and the salt from aliasing onto each other. */
const HASH_SALT_STRIDE = 16;

const SALT_ALONG = 1;
const SALT_ACROSS = 2;
const SALT_LENGTH = 3;
const SALT_PHASE = 4;
const SALT_SPLASH = 5;

const TWO_PI = Math.PI * 2;

/**
 * Specular streaks: short bright dashes carried along the flow.
 *
 * They are what actually reads as movement. Their speed is in tiles a second and
 * is deliberately slow — a river that visibly races looks like a conveyor belt
 * at this scale.
 */
const STREAKS_PER_TILE = 2;
const STREAK_SPEED_TILES_PER_SECOND = 0.42;
const STREAK_LENGTH_MIN_PX = 4;
const STREAK_LENGTH_RANGE_PX = 7;
const STREAK_THICKNESS_PX = 1;
const STREAK_COLOR = 'rgb(150, 205, 210)';
const STREAK_ALPHA = 0.3;

/**
 * The swell: a slow travelling wave along the channel that brightens and dims
 * the drifting marks, rather than anything drawn in its own right.
 *
 * Two earlier versions painted it as light on the water and both failed for the
 * same reason — the flow direction is quantised to eight compass points and
 * changes tile to tile, so any *area* fill keyed off it lands on a different
 * axis in neighbouring tiles and the river comes out as a mosaic of rectangles.
 * A per-tile alpha was a checkerboard; sub-tile strips were smaller rectangles.
 *
 * Carrying the swell in the **brightness of the streaks and flecks** has no area
 * to be blocky with. It also removes two to four `fillRect`s per tile, which was
 * most of the overlay's cost.
 */
const SWELL_SPEED_TILES_PER_SECOND = 0.16;
const SWELL_WAVELENGTH_TILES = 2.7;
const SWELL_SECOND_WAVELENGTH_TILES = 4.3;
/** How far the swell can pull a mark's brightness down at the trough. */
const SWELL_DEPTH = 0.65;

/** Foam flecks: tiny bright dots, rarer and brighter than the streaks. */
const FLECKS_PER_TILE = 1;
const FLECK_SPEED_TILES_PER_SECOND = 0.55;
const FLECK_RADIUS_PX = 0.9;
const FLECK_COLOR = 'rgb(226, 244, 244)';
const FLECK_ALPHA = 0.42;

/**
 * Bank foam: broken dashes along the water side of an edge that meets land.
 *
 * **Dashes, not a lip.** A solid bar along every water tile's land-facing edge
 * traces the tile grid exactly, and the first version of it drew a hard
 * pixelated staircase right over the soft irregular fringe that the corner masks
 * produce — which *is* the riverbank, and the one thing on the map that must not
 * be outlined. Hash-jittered dashes read as foam catching on the bank without
 * ever describing a tile boundary.
 */

/** Wakes: concentric arcs shed downstream of a rock standing in the channel. */
const WAKE_RING_COUNT = 3;
const WAKE_PERIOD_SECONDS = 1.9;
const WAKE_MAX_RADIUS_PX = 13;
const WAKE_LINE_WIDTH_PX = 1;
const WAKE_COLOR = 'rgb(196, 230, 232)';
const WAKE_MAX_ALPHA = 0.34;
/** How far downstream of the rock the rings are centred, in pixels. */
const WAKE_DOWNSTREAM_OFFSET_PX = 5;

/**
 * A wader — a player standing in the river.
 *
 * Everything below is *transient effect state*, and it is the one exception to
 * the "system is stateless" rule in this file's header. The distinction that
 * makes it safe: the stateless rule exists because `GameMap` outlives the scene,
 * so per-**tile** state here would need reconciling on every building entry.
 * These are ripples and droplets belonging to a player, and losing them on a
 * scene rebuild is not merely tolerable but correct — the player has just walked
 * through a door, and a splash that survived that would be the bug.
 */

/**
 * Waders are tracked by identity — a player or a mob — because anything that
 * walks can enter the river and the cast changes as mobs spawn and die. An entry
 * is dropped once it goes a frame without being reported, so nothing has to
 * remember to deregister a mob that died mid-stream.
 */
const WADER_PRUNE_AFTER_FRAMES = 2;

/**
 * Idle disturbance: someone *standing* in a river still breaks the flow, so
 * rings keep coming on a timer even when nobody is moving. Without this the
 * water round a stationary wader goes glassy and dead the moment the last stride
 * ripple expires — the effect visibly stops rather than settles.
 */
const IDLE_RIPPLE_PERIOD_SECONDS = 0.55;
const IDLE_RIPPLE_STRENGTH = 0.62;

/**
 * Ripples shed while walking. A new ring every `RIPPLE_SPACING_PX` of travel
 * rather than every N frames, so the wake reads as caused by the *stride* and
 * does not keep pumping out rings when the player stands still.
 */
const RIPPLE_SPACING_PX = 7;
const MAX_RIPPLES = 48;
const RIPPLE_LIFETIME_SECONDS = 1.5;
const RIPPLE_START_RADIUS_PX = 3;
const RIPPLE_GROWTH_PX = 15;
const RIPPLE_ALPHA = 0.5;
const RIPPLE_LINE_WIDTH_PX = 1;
/** How far a ripple drifts downstream over its life, in px per second. */
const RIPPLE_DRIFT_PX_PER_SECOND = 9;
/** Ripples are flattened, because the river is seen at a slight angle. */
const RIPPLE_FLATTEN = 0.55;

/**
 * The entry splash: a burst of droplets thrown up the moment a wader's footing
 * changes from bank to water.
 */
const MAX_DROPLETS = 64;
const SPLASH_DROPLET_COUNT = 18;
const SPLASH_LIFETIME_SECONDS = 0.62;
const SPLASH_SPEED_MIN_PX_PER_SECOND = 26;
const SPLASH_SPEED_RANGE_PX_PER_SECOND = 62;
/** Upward bias, so the burst is a crown rather than a flat ring. */
const SPLASH_RISE_PX_PER_SECOND = 54;
const SPLASH_GRAVITY_PX_PER_SECOND_SQUARED = 210;
const SPLASH_DROPLET_RADIUS_PX = 1.3;
/**
 * Flattens the horizontal spread of the burst. The droplets fly on a top-down
 * ground plane but are drawn on a slightly tilted one, so an unsquashed circle
 * of them reads as a flat disc lying on the water rather than a crown.
 */
const SPLASH_VERTICAL_SQUASH = 0.5;
const SPLASH_COLOR = 'rgb(232, 248, 248)';
/** A wider ring thrown out on the surface at the same moment. */
const SPLASH_RING_RADIUS_PX = 20;

/**
 * The body in the flow: a dark displaced-water pool at the waterline, and a
 * bright bow wave heaped up on the upstream side.
 *
 * This is what makes the river look like it is hitting *him* rather than passing
 * through him. The bow wave is placed by the flow direction, not by the way the
 * player is facing — a swimmer standing still in a current still has one.
 */
const DISPLACEMENT_RADIUS_PX = 9;
const DISPLACEMENT_FLATTEN = 0.45;
const DISPLACEMENT_COLOR = 'rgb(18, 52, 60)';
const DISPLACEMENT_ALPHA = 0.32;
const BOW_WAVE_RADIUS_PX = 11;
const BOW_WAVE_ALPHA = 0.55;
const BOW_WAVE_LINE_WIDTH_PX = 1.6;
/**
 * Half-angle of the bow-wave arc, as a fraction of a half turn, so it hugs the
 * upstream shoulder instead of closing into a full ring around the body.
 */
const BOW_WAVE_SWEEP_FRACTION = 0.42;
const BOW_WAVE_HALF_SWEEP = Math.PI * BOW_WAVE_SWEEP_FRACTION;
const BOW_WAVE_UPSTREAM_OFFSET_PX = 3;
/** How much the bow wave breathes, and how fast. */
const BOW_WAVE_PULSE_HZ = 1.6;
const BOW_WAVE_PULSE_DEPTH = 0.25;

/** Ring strength for a stride's ripple against the entry splash's. */
const STRIDE_RIPPLE_STRENGTH = 1;
const ENTRY_RIPPLE_STRENGTH = 2.1;

/** The meniscus drawn where a wader's body is cut off by the surface. */
const WATERLINE_HALF_WIDTH_PX = 9;
const WATERLINE_FLATTEN = 0.32;
const WATERLINE_FILL_COLOR = 'rgb(28, 66, 74)';
const WATERLINE_FILL_ALPHA = 0.5;
const WATERLINE_RIM_COLOR = 'rgb(206, 236, 238)';
const WATERLINE_RIM_ALPHA = 0.75;
const WATERLINE_RIM_WIDTH_PX = 1;

interface Ripple {
  x: number;
  y: number;
  bornAt: number;
  flowX: number;
  flowY: number;
  /** Scales radius and alpha, so an entry ring can be bigger than a stride's. */
  strength: number;
  alive: boolean;
}

interface Droplet {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  bornAt: number;
  alive: boolean;
}

interface WaderState {
  seenAtFrame: number;
  x: number;
  y: number;
  inWater: boolean;
  travelSinceRipple: number;
  nextIdleRippleAt: number;
  flowX: number;
  flowY: number;
}

/** Half a tile — where a tile's centre is. */
const TILE_CENTRE_FRACTION = 0.5;

/** Stable value in [0, 1) for one element of one tile's animation. */
function tileHash01(tx: number, ty: number, index: number, salt: number): number {
  const position = Math.imul(tx, HASH_MIX_X) ^ Math.imul(ty, HASH_MIX_Y);
  const salted = position ^ Math.imul(index * HASH_SALT_STRIDE + salt, HASH_MIX_INDEX);
  const mixed = Math.imul(salted, HASH_MIX_X);
  const avalanched = mixed ^ (mixed >>> HASH_FINAL_SHIFT);
  return (avalanched >>> 0) / HASH_UINT32;
}

/** Wraps a value into [0, 1), for a marker cycling along its drift. */
/**
 * A stable pseudo-random unit value for droplet `index` of a splash thrown at
 * `wader`'s position — the position-hash idiom used throughout the tile
 * renderers, so no per-droplet seed has to be stored and a burst is varied
 * rather than a perfect starburst.
 */
function splashHash01(wader: WaderState, index: number): number {
  return tileHash01(Math.round(wader.x), Math.round(wader.y), index, SALT_SPLASH);
}

function wrapUnit(value: number): number {
  return value - Math.floor(value);
}

/**
 * One visible water tile, resolved once per frame.
 *
 * The passes below each sweep this list rather than each tile being drawn
 * through all of them in turn. That is the whole performance story of this file:
 * a `fillStyle` assignment parses a CSS colour, and drawing tile-major set one
 * per mark type *per tile* — measured at 2.2 ms a frame over 212 tiles, an
 * eighth of a 60 Hz budget for one small river. Pass-major sets each colour once
 * for the whole frame and carries the varying part in `globalAlpha`, which is a
 * number assignment.
 */
interface VisibleWaterTile {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  flowX: number;
  flowY: number;
}

export class WaterAnimationSystem implements GameSystem {
  /**
   * Reused between frames so a pan across the river does not allocate a fresh
   * array of a thousand objects sixty times a second. `visibleCount` is the live
   * length; entries past it are stale and must not be read.
   */
  private readonly visible: VisibleWaterTile[] = [];
  private visibleCount = 0;
  private readonly rocks: VisibleWaterTile[] = [];
  private rockCount = 0;
  /**
   * Visible water merged into horizontal runs, used to clip every mark to the
   * river. Runs rather than one rect per tile because a river is contiguous
   * along a row, so this is usually a handful of rectangles instead of hundreds.
   */
  private readonly clipRuns: { sx: number; sy: number; width: number }[] = [];
  private clipRunCount = 0;

  private readonly waders = new Map<object, WaderState>();
  private frameCounter = 0;
  private readonly ripples: Ripple[] = [];
  private readonly droplets: Droplet[] = [];

  constructor(private readonly gameMap: GameMap) {}

  /**
   * Tell the system where a wader is this frame, keyed by the entity itself.
   *
   * Call once per frame for every crawler and every mob near the water, whether
   * or not it is wet — the dry calls are how the system sees the moment someone
   * steps in, which is the only way to know when to splash. Stop calling and the
   * entry is pruned on its own, so a mob that dies mid-river needs no cleanup.
   *
   * Returns true on the frame the wader entered the water, so the caller can
   * play the entry sound. Reported rather than played here because only the
   * caller knows *who* this entity is, and a splash has a different voice for
   * the human, the cat and a mob.
   */
  updateWader(entity: object, x: number, y: number, inWater: boolean): boolean {
    const existing = this.waders.get(entity);
    if (existing === undefined) {
      // A wader first seen already in the water gets no splash: it did not enter,
      // it was spawned or walked in off-screen. Its idle rings start immediately.
      this.waders.set(entity, {
        seenAtFrame: this.frameCounter,
        x,
        y,
        inWater,
        travelSinceRipple: 0,
        nextIdleRippleAt: frameTime,
        flowX: 0,
        flowY: 0,
      });
      return false;
    }

    const wasInWater = existing.inWater;
    const travelled = Math.hypot(x - existing.x, y - existing.y);
    existing.seenAtFrame = this.frameCounter;
    existing.x = x;
    existing.y = y;
    existing.inWater = inWater;

    if (!inWater) {
      existing.travelSinceRipple = 0;
      return false;
    }

    const flow = this.flowAtPixel(x, y);
    existing.flowX = flow.x;
    existing.flowY = flow.y;

    if (!wasInWater) {
      this.spawnSplash(existing);
      existing.nextIdleRippleAt = frameTime + IDLE_RIPPLE_PERIOD_SECONDS;
      return true;
    }

    existing.travelSinceRipple += travelled;
    while (existing.travelSinceRipple >= RIPPLE_SPACING_PX) {
      existing.travelSinceRipple -= RIPPLE_SPACING_PX;
      this.spawnRipple(existing, STRIDE_RIPPLE_STRENGTH);
      existing.nextIdleRippleAt = frameTime + IDLE_RIPPLE_PERIOD_SECONDS;
    }

    // The standing-still case. Deliberately reset by every stride ripple above,
    // so a walker gets its wake from its stride and only a *stalled* wader falls
    // back to the timer — otherwise the two sources would double up.
    if (frameTime >= existing.nextIdleRippleAt) {
      existing.nextIdleRippleAt = frameTime + IDLE_RIPPLE_PERIOD_SECONDS;
      this.spawnRipple(existing, IDLE_RIPPLE_STRENGTH);
    }
    return false;
  }

  /**
   * The visible water tile nearest a listener, in tiles, or null when no water
   * is on screen.
   *
   * Reads the list `renderGround` collected, so "on screen" is decided by the
   * same cull the marks use and the river becomes audible exactly when it
   * becomes visible. That list is one frame stale when the camera moves, which
   * is far below the ramp time of an ambient loop.
   */
  nearestVisibleWaterTile(
    listenerX: number,
    listenerY: number,
  ): { x: number; y: number; distanceTiles: number } | null {
    let bestDistanceSq = Infinity;
    let bestX = 0;
    let bestY = 0;
    const consider = (list: VisibleWaterTile[], count: number): void => {
      for (let i = 0; i < count; i++) {
        const tile = list[i];
        const centreX = (tile.tx + TILE_CENTRE_FRACTION) * TILE_SIZE;
        const centreY = (tile.ty + TILE_CENTRE_FRACTION) * TILE_SIZE;
        const distanceSq = (centreX - listenerX) ** 2 + (centreY - listenerY) ** 2;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestX = tile.tx;
          bestY = tile.ty;
        }
      }
    };
    consider(this.visible, this.visibleCount);
    consider(this.rocks, this.rockCount);
    if (bestDistanceSq === Infinity) return null;
    return { x: bestX, y: bestY, distanceTiles: Math.sqrt(bestDistanceSq) / TILE_SIZE };
  }

  /**
   * Advance the frame counter and drop waders nobody reported. Call once per
   * frame, before the `updateWader` calls for that frame.
   */
  beginFrame(): void {
    this.frameCounter++;
    for (const [entity, wader] of this.waders) {
      if (this.frameCounter - wader.seenAtFrame > WADER_PRUNE_AFTER_FRAMES) {
        this.waders.delete(entity);
      }
    }
  }

  /**
   * Draws the moving parts of every visible water tile.
   *
   * Called from the `renderGround` slot in `RenderPipeline`, not from `update` —
   * there is no per-frame state to advance, only the shared `frameTime` to read.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.collectVisible(camX, camY);
    // Nothing this method draws can appear outside the river, so with no river
    // on screen there is nothing to do — including for ripples, which are always
    // shed in water and would be clipped away regardless.
    if (this.clipRunCount === 0) return;

    const time = frameTime;
    const previousAlpha = ctx.globalAlpha;
    ctx.save();
    this.clipToWater(ctx);
    this.drawStreakPass(ctx, time);
    this.drawFleckPass(ctx, time);
    this.drawWakePass(ctx, camX, camY, time);
    this.drawWaderPass(ctx, camX, camY, time);
    ctx.restore();
    // The stones go back on top of everything the water just drew. A rock stands
    // *in* the river, so its own wake, the drifting streaks and any ripple that
    // reaches it must all pass behind it — before this they were painted across
    // the stone and read as marks on the rock rather than on the water.
    this.repaintRocks(ctx);
    ctx.globalAlpha = previousAlpha;
  }

  /** Fills `visible` and `rocks` with the water tiles inside the culled rect. */
  private collectVisible(camX: number, camY: number): void {
    const structure = this.gameMap.structure;
    const firstTileX = Math.max(0, Math.floor(camX / TILE_SIZE) - CULL_MARGIN_TILES);
    const firstTileY = Math.max(0, Math.floor(camY / TILE_SIZE) - CULL_MARGIN_TILES);
    const lastTileX = Math.min(
      structure[0].length - 1,
      Math.ceil((camX + viewportWidth()) / TILE_SIZE) + CULL_MARGIN_TILES,
    );
    const lastTileY = Math.min(
      structure.length - 1,
      Math.ceil((camY + viewportHeight()) / TILE_SIZE) + CULL_MARGIN_TILES,
    );

    this.visibleCount = 0;
    this.rockCount = 0;
    this.clipRunCount = 0;
    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      const row = structure[ty];
      let runStartTx = -1;
      const closeRun = (endTxExclusive: number): void => {
        if (runStartTx < 0) return;
        const run = this.claimClipRun();
        run.sx = runStartTx * TILE_SIZE - camX;
        run.sy = ty * TILE_SIZE - camY;
        run.width = (endTxExclusive - runStartTx) * TILE_SIZE;
        runStartTx = -1;
      };
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const type = row[tx].type;
        const isRock = type === RIVER_ROCK;
        if (!isRock && type !== FloorTypeValue.water) {
          closeRun(tx);
          continue;
        }
        if (runStartTx < 0) runStartTx = tx;
        const flow = flowVector(row[tx].flowDir ?? (isRock ? this.flowDirNear(tx, ty) : undefined));
        const list = isRock ? this.rocks : this.visible;
        const index = isRock ? this.rockCount++ : this.visibleCount++;
        const sx = tx * TILE_SIZE - camX;
        const sy = ty * TILE_SIZE - camY;
        if (index === list.length) {
          list.push({ tx, ty, sx, sy, flowX: flow.x, flowY: flow.y });
        } else {
          const entry = list[index];
          entry.tx = tx;
          entry.ty = ty;
          entry.sx = sx;
          entry.sy = sy;
          entry.flowX = flow.x;
          entry.flowY = flow.y;
        }
      }
      closeRun(lastTileX + 1);
    }
  }

  /**
   * Redraw each visible rock over the water marks.
   *
   * The rock is *also* painted into the terrain chunk, so this is a second draw
   * of the same art rather than the only one. That is deliberate: the chunk keeps
   * the rocks visible on any scene that has no water system, and rocks are few
   * enough (a handful on screen) that repainting them costs nothing measurable.
   */
  private repaintRocks(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.rockCount; i++) {
      const rock = this.rocks[i];
      drawRiverRockTile(ctx, rock.sx, rock.sy, TILE_SIZE, rock.tx, rock.ty);
    }
  }

  private claimClipRun(): { sx: number; sy: number; width: number } {
    if (this.clipRunCount === this.clipRuns.length) {
      this.clipRuns.push({ sx: 0, sy: 0, width: 0 });
    }
    return this.clipRuns[this.clipRunCount++];
  }

  /**
   * Restrict everything that follows to the river's own tiles.
   *
   * Marks are positioned by tile hash but are not *bounded* by their tile — a
   * streak has length, a rock's wake has a 13 px radius and a wader's ripple
   * grows past 30 px. On a bank tile all three spill onto the grass, which reads
   * as the river's surface painted over the land.
   */
  private clipToWater(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    for (let i = 0; i < this.clipRunCount; i++) {
      const run = this.clipRuns[i];
      ctx.rect(run.sx, run.sy, run.width, TILE_SIZE);
    }
    ctx.clip();
  }

  private drawStreakPass(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.fillStyle = STREAK_COLOR;
    for (let i = 0; i < this.visibleCount; i++) {
      const tile = this.visible[i];
      ctx.globalAlpha = STREAK_ALPHA * swellAt(tile, time);
      const isHorizontal = Math.abs(tile.flowX) >= Math.abs(tile.flowY);
      for (let mark = 0; mark < STREAKS_PER_TILE; mark++) {
        const cycle = wrapUnit(
          tileHash01(tile.tx, tile.ty, mark, SALT_ALONG) + time * STREAK_SPEED_TILES_PER_SECOND,
        );
        const length =
          STREAK_LENGTH_MIN_PX +
          tileHash01(tile.tx, tile.ty, mark, SALT_LENGTH) * STREAK_LENGTH_RANGE_PX;
        for (const offset of WRAPPED_MARK_OFFSETS) {
          const { x, y } = markPosition(tile, mark, cycle + offset);
          fillClampedToTile(
            ctx,
            tile.sx,
            tile.sy,
            x,
            y,
            isHorizontal ? length : STREAK_THICKNESS_PX,
            isHorizontal ? STREAK_THICKNESS_PX : length,
          );
        }
      }
    }
  }

  private drawFleckPass(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.fillStyle = FLECK_COLOR;
    const size = FLECK_RADIUS_PX * 2;
    for (let i = 0; i < this.visibleCount; i++) {
      const tile = this.visible[i];
      ctx.globalAlpha = FLECK_ALPHA * swellAt(tile, time);
      for (let mark = 0; mark < FLECKS_PER_TILE; mark++) {
        const cycle = wrapUnit(
          tileHash01(tile.tx, tile.ty, mark, SALT_ALONG) + time * FLECK_SPEED_TILES_PER_SECOND,
        );
        for (const offset of WRAPPED_MARK_OFFSETS) {
          const { x, y } = markPosition(tile, mark, cycle + offset);
          fillClampedToTile(
            ctx,
            tile.sx,
            tile.sy,
            x - FLECK_RADIUS_PX,
            y - FLECK_RADIUS_PX,
            size,
            size,
          );
        }
      }
    }
  }

  private drawWakePass(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    time: number,
  ): void {
    if (this.rockCount === 0) return;
    ctx.strokeStyle = WAKE_COLOR;
    ctx.lineWidth = WAKE_LINE_WIDTH_PX;
    for (let i = 0; i < this.rockCount; i++) {
      const rock = this.rocks[i];
      const centreX =
        (rock.tx + TILE_CENTRE_FRACTION) * TILE_SIZE -
        camX +
        rock.flowX * WAKE_DOWNSTREAM_OFFSET_PX;
      const centreY =
        (rock.ty + TILE_CENTRE_FRACTION) * TILE_SIZE -
        camY +
        rock.flowY * WAKE_DOWNSTREAM_OFFSET_PX;
      const phase = tileHash01(rock.tx, rock.ty, 0, SALT_PHASE);
      for (let ring = 0; ring < WAKE_RING_COUNT; ring++) {
        const age = wrapUnit(time / WAKE_PERIOD_SECONDS + phase + ring / WAKE_RING_COUNT);
        const radius = age * WAKE_MAX_RADIUS_PX;
        if (radius <= 0) continue;
        // Fades as it grows, so a ring dies at the edge instead of being cut off.
        ctx.globalAlpha = (1 - age) * WAKE_MAX_ALPHA;
        ctx.beginPath();
        ctx.arc(centreX, centreY, radius, 0, TWO_PI);
        ctx.stroke();
      }
    }
  }

  /**
   * Ripples, bow waves and displaced water for every wader.
   *
   * Drawn in `renderGround`, so all of it sits *under* the Y-sorted pass and
   * therefore under the wader's own body — which is where the surface of the
   * water is relative to someone standing in it. The airborne droplets are the
   * exception and are drawn by `renderSplashes` after the entities.
   */
  private drawWaderPass(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    time: number,
  ): void {
    this.drawRipples(ctx, camX, camY, time);

    for (const wader of this.waders.values()) {
      if (!wader.inWater) continue;
      const screenX = wader.x - camX;
      const screenY = wader.y - camY;

      ctx.globalAlpha = DISPLACEMENT_ALPHA;
      ctx.fillStyle = DISPLACEMENT_COLOR;
      ctx.beginPath();
      ctx.ellipse(
        screenX,
        screenY,
        DISPLACEMENT_RADIUS_PX,
        DISPLACEMENT_RADIUS_PX * DISPLACEMENT_FLATTEN,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();

      if (wader.flowX === 0 && wader.flowY === 0) continue;
      // The wave heaps up on the side the water arrives from, which is upstream
      // — the opposite of the flow vector.
      const upstreamAngle = Math.atan2(-wader.flowY, -wader.flowX);
      const pulse = 1 + Math.sin(time * TWO_PI * BOW_WAVE_PULSE_HZ) * BOW_WAVE_PULSE_DEPTH;
      ctx.globalAlpha = BOW_WAVE_ALPHA;
      ctx.strokeStyle = WAKE_COLOR;
      ctx.lineWidth = BOW_WAVE_LINE_WIDTH_PX;
      ctx.beginPath();
      ctx.ellipse(
        screenX - wader.flowX * BOW_WAVE_UPSTREAM_OFFSET_PX,
        screenY - wader.flowY * BOW_WAVE_UPSTREAM_OFFSET_PX,
        BOW_WAVE_RADIUS_PX * pulse,
        BOW_WAVE_RADIUS_PX * DISPLACEMENT_FLATTEN * pulse,
        0,
        upstreamAngle - BOW_WAVE_HALF_SWEEP,
        upstreamAngle + BOW_WAVE_HALF_SWEEP,
      );
      ctx.stroke();
    }
  }

  private drawRipples(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    time: number,
  ): void {
    ctx.strokeStyle = WAKE_COLOR;
    ctx.lineWidth = RIPPLE_LINE_WIDTH_PX;
    for (const ripple of this.ripples) {
      if (!ripple.alive) continue;
      const age = (time - ripple.bornAt) / RIPPLE_LIFETIME_SECONDS;
      if (age >= 1) {
        ripple.alive = false;
        continue;
      }
      const drift = age * RIPPLE_LIFETIME_SECONDS * RIPPLE_DRIFT_PX_PER_SECOND;
      const radius = (RIPPLE_START_RADIUS_PX + age * RIPPLE_GROWTH_PX) * ripple.strength;
      ctx.globalAlpha = (1 - age) * RIPPLE_ALPHA;
      ctx.beginPath();
      ctx.ellipse(
        ripple.x - camX + ripple.flowX * drift,
        ripple.y - camY + ripple.flowY * drift,
        radius,
        radius * RIPPLE_FLATTEN,
        0,
        0,
        TWO_PI,
      );
      ctx.stroke();
    }
  }

  /**
   * The airborne half of a splash, drawn *after* the entities so the droplets
   * fly in front of the body that threw them up.
   */
  renderSplashes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const time = frameTime;
    const previousAlpha = ctx.globalAlpha;
    ctx.fillStyle = SPLASH_COLOR;
    for (const droplet of this.droplets) {
      if (!droplet.alive) continue;
      const elapsed = time - droplet.bornAt;
      const age = elapsed / SPLASH_LIFETIME_SECONDS;
      if (age >= 1) {
        droplet.alive = false;
        continue;
      }
      const x = droplet.x + droplet.velocityX * elapsed;
      const y =
        droplet.y +
        droplet.velocityY * elapsed +
        (SPLASH_GRAVITY_PX_PER_SECOND_SQUARED * elapsed * elapsed) / 2;
      ctx.globalAlpha = 1 - age;
      ctx.beginPath();
      ctx.arc(x - camX, y - camY, SPLASH_DROPLET_RADIUS_PX, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = previousAlpha;
  }

  /**
   * The meniscus where a wader's body is cut off by the surface.
   *
   * Called by `RenderPipeline` straight after it draws the clipped body, so the
   * rim lands on top of the cut edge and hides the fact that it is a hard
   * horizontal line through a sprite.
   */
  renderWaterline(ctx: CanvasRenderingContext2D, screenX: number, screenY: number): void {
    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = WATERLINE_FILL_ALPHA;
    ctx.fillStyle = WATERLINE_FILL_COLOR;
    ctx.beginPath();
    ctx.ellipse(
      screenX,
      screenY,
      WATERLINE_HALF_WIDTH_PX,
      WATERLINE_HALF_WIDTH_PX * WATERLINE_FLATTEN,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.globalAlpha = WATERLINE_RIM_ALPHA;
    ctx.strokeStyle = WATERLINE_RIM_COLOR;
    ctx.lineWidth = WATERLINE_RIM_WIDTH_PX;
    ctx.stroke();
    ctx.globalAlpha = previousAlpha;
  }

  private spawnRipple(wader: WaderState, strength: number): void {
    const ripple = this.claimRipple();
    ripple.x = wader.x;
    ripple.y = wader.y;
    ripple.bornAt = frameTime;
    ripple.flowX = wader.flowX;
    ripple.flowY = wader.flowY;
    ripple.strength = strength;
    ripple.alive = true;
  }

  private spawnSplash(wader: WaderState): void {
    this.spawnRipple(wader, ENTRY_RIPPLE_STRENGTH);
    const entryRing = this.claimRipple();
    entryRing.x = wader.x;
    entryRing.y = wader.y;
    entryRing.bornAt = frameTime;
    entryRing.flowX = wader.flowX;
    entryRing.flowY = wader.flowY;
    entryRing.strength = SPLASH_RING_RADIUS_PX / RIPPLE_GROWTH_PX;
    entryRing.alive = true;

    for (let i = 0; i < SPLASH_DROPLET_COUNT; i++) {
      const droplet = this.claimDroplet();
      const angle = (i / SPLASH_DROPLET_COUNT) * TWO_PI;
      const speed =
        SPLASH_SPEED_MIN_PX_PER_SECOND + splashHash01(wader, i) * SPLASH_SPEED_RANGE_PX_PER_SECOND;
      droplet.x = wader.x;
      droplet.y = wader.y;
      droplet.velocityX = Math.cos(angle) * speed;
      droplet.velocityY =
        Math.sin(angle) * speed * SPLASH_VERTICAL_SQUASH - SPLASH_RISE_PX_PER_SECOND;
      droplet.bornAt = frameTime;
      droplet.alive = true;
    }
  }

  /**
   * Reuses the first dead slot, and once the pool is full overwrites the
   * **oldest** entry rather than dropping the new one. A wader who runs along a
   * river must keep shedding fresh ripples; silently discarding them would stop
   * the wake dead exactly when the player is moving most.
   */
  private claimRipple(): Ripple {
    for (const ripple of this.ripples) {
      if (!ripple.alive) return ripple;
    }
    if (this.ripples.length < MAX_RIPPLES) {
      const ripple: Ripple = {
        x: 0,
        y: 0,
        bornAt: 0,
        flowX: 0,
        flowY: 0,
        strength: 1,
        alive: false,
      };
      this.ripples.push(ripple);
      return ripple;
    }
    let oldest = this.ripples[0];
    for (const ripple of this.ripples) {
      if (ripple.bornAt < oldest.bornAt) oldest = ripple;
    }
    return oldest;
  }

  private claimDroplet(): Droplet {
    for (const droplet of this.droplets) {
      if (!droplet.alive) return droplet;
    }
    if (this.droplets.length < MAX_DROPLETS) {
      const droplet: Droplet = {
        x: 0,
        y: 0,
        velocityX: 0,
        velocityY: 0,
        bornAt: 0,
        alive: false,
      };
      this.droplets.push(droplet);
      return droplet;
    }
    let oldest = this.droplets[0];
    for (const droplet of this.droplets) {
      if (droplet.bornAt < oldest.bornAt) oldest = droplet;
    }
    return oldest;
  }

  /** The flow vector of the water tile under a world-pixel position. */
  private flowAtPixel(x: number, y: number): { x: number; y: number } {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const flowDir = this.gameMap.structure[ty]?.[tx]?.flowDir ?? this.flowDirNear(tx, ty);
    return flowVector(flowDir);
  }

  /**
   * The flow at a rock that has no direction of its own: the first neighbouring
   * water tile that has one.
   *
   * A **fallback, not the rule.** `scatterRiverRocks` writes with `setStanding`,
   * which touches only `type` and `groundType`, so the `flowDir` the carve wrote
   * survives on the tile — measured at 121/121 rocks across 5 maps. Consulting
   * the neighbours first ran this walk every frame for every visible rock and
   * could pick a different octant than the rock's own, offsetting its wake
   * downstream in the wrong direction.
   */
  private flowDirNear(tx: number, ty: number): number | undefined {
    for (const [dx, dy] of NEIGHBOUR_STEPS) {
      const flowDir = this.gameMap.structure[ty + dy]?.[tx + dx]?.flowDir;
      if (flowDir !== undefined) return flowDir;
    }
    return undefined;
  }

  dispose(): void {
    /* no-op — the system holds no state beyond its per-frame scratch lists */
  }
}

const NEIGHBOUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * How bright a tile's marks are right now: a slow travelling wave along the
 * channel, sampled in world space so it runs continuously from tile to tile.
 */
function swellAt(tile: VisibleWaterTile, time: number): number {
  const alongFlow = tile.tx * tile.flowX + tile.ty * tile.flowY;
  const phase = alongFlow - time * SWELL_SPEED_TILES_PER_SECOND;
  const wave =
    (Math.sin((phase / SWELL_WAVELENGTH_TILES) * TWO_PI) +
      Math.sin((phase / SWELL_SECOND_WAVELENGTH_TILES) * TWO_PI)) /
    2;
  return 1 - (SWELL_DEPTH * (1 - wave)) / 2;
}

/**
 * Where one drifting mark sits: carried `along` the flow from the tile's centre,
 * and offset across it so the marks in a tile are not stacked on one line.
 *
 * `along` is expected in [-1, 1). Each mark is drawn **twice** — once at `along`
 * and once at `along - 1` — so the copy leaving the tile downstream is replaced
 * by one entering from upstream. Both are trimmed to the tile, so the ink drawn
 * is the same as one mark's worth; what it buys is continuity.
 *
 * Drawing a single copy at `along` in [0, 1) is what the first cut did, and it
 * has two faults that only measurement finds. The upstream half of every tile
 * can then never receive a mark at all — a permanently still stripe at a *fixed
 * offset inside each tile*, which is the tile grid drawn in negative, the same
 * failure that killed the ripple bands and the solid bank lip. And each mark
 * pops into existence at the tile centre when its cycle wraps.
 */
function markPosition(
  tile: VisibleWaterTile,
  mark: number,
  along: number,
): { readonly x: number; readonly y: number } {
  const across = tileHash01(tile.tx, tile.ty, mark, SALT_ACROSS) - TILE_CENTRE_FRACTION;
  return {
    x:
      tile.sx +
      TILE_SIZE * TILE_CENTRE_FRACTION +
      (tile.flowX * along - tile.flowY * across) * TILE_SIZE,
    y:
      tile.sy +
      TILE_SIZE * TILE_CENTRE_FRACTION +
      (tile.flowY * along + tile.flowX * across) * TILE_SIZE,
  };
}

/** The two positions one drifting mark occupies — see `markPosition`. */
const WRAPPED_MARK_OFFSETS: readonly number[] = [0, -1];

/**
 * Fills a rect, trimmed to the tile that owns it.
 *
 * A streak drifts a whole tile's width over its cycle and is several pixels
 * long, so without this the ones near a bank paint bright dashes onto the grass.
 * Trimming rather than clipping because `ctx.clip()` per tile would cost a path
 * and a state save for every one of the ~1,300 tiles on screen.
 */
function fillClampedToTile(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const left = Math.max(tileX, x);
  const top = Math.max(tileY, y);
  const right = Math.min(tileX + TILE_SIZE, x + width);
  const bottom = Math.min(tileY + TILE_SIZE, y + height);
  if (right <= left || bottom <= top) return;
  ctx.fillRect(left, top, right - left, bottom - top);
}

/**
 * The unit flow vector for a tile, or a still surface when it has none.
 *
 * A missing `flowDir` is not a defect: a future pond would have no direction,
 * and a zero vector makes every marker below hold still and shimmer in place
 * rather than drift, which is what still water does.
 */
function flowVector(flowDir: number | undefined): { readonly x: number; readonly y: number } {
  if (flowDir === undefined) return STILL_WATER_FLOW;
  return FLOW_DIR_VECTORS[flowDir] ?? STILL_WATER_FLOW;
}

const STILL_WATER_FLOW = { x: 0, y: 0 } as const;
