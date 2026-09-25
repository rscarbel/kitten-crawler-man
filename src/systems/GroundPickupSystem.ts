/**
 * GroundPickupSystem — things lying visibly in the world that the party picks
 * up by hand: a hamburger a cow dropped today, whatever a later mini-game
 * scatters tomorrow.
 *
 * Unlike floor loot (`LootSystem`), which is a labelled pile that pays out when
 * walked over, a ground pickup is a small object drawn in the world, Y-sorted
 * with the bodies around it, and collected with the interact key — one press
 * gathers every pickup within reach, so a scatter of three is one press, not a
 * hunt for each.
 *
 * ## Public API (for anything that drops a pickup)
 *
 * - {@link GroundPickupSystem.spawn} / {@link GroundPickupSystem.spawnBurgers}:
 *   scatter `count` pickups from a world-pixel centre. Each hops outward and
 *   settles on a walkable tile; a centre inside a wall still lands them on
 *   open ground nearby.
 * - {@link GroundPickupSystem.tryPickupNear}: the interact-key entry. Returns
 *   whether the press was claimed.
 * - {@link GroundPickupSystem.nearestInReach}: what the prompt floats over.
 * - {@link GroundPickupSystem.renderEntities}: Y-sort entries for the scene's
 *   entity pass; {@link GroundPickupSystem.renderFlat} for a scene without one.
 * - {@link GroundPickupSystem.renderPrompt}: the "Pick up" prompt.
 * - {@link GroundPickupSystem.captureCheckpoint} /
 *   {@link GroundPickupSystem.restoreCheckpoint}: for a death rewind, and for
 *   carrying the pickups across a scene rebuild on the same map.
 *
 * Sounds are not played here: the owning kit drains
 * {@link GroundPickupSystem.drainPickupCues} each frame, the way it drains loot.
 * Pickups are not written to a save — like floor loot, a reload clears them.
 */

import { TILE_SIZE } from '../core/constants';
import { ITEM_DEF, type ItemId } from '../core/ItemDefs';
import { playPickupGesture } from '../creatures/humanGestures';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';
import { BURGER_BASE_Y, BURGER_WIDTH_OF_CELL, groundBurgerSprite } from '../sprites/art/burgerArt';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { TownPropRenderable } from './townPropRenderable';

/** What a ground pickup can be. Grows with each new kind of visible drop. */
export type GroundPickupKind = 'hamburger';

/** The item each kind of pickup becomes in the bag. */
const PICKUP_ITEM: Record<GroundPickupKind, ItemId> = {
  hamburger: 'hamburger',
};

/** One object lying on (or hopping onto) the ground. */
export interface GroundPickup {
  readonly id: number;
  readonly kind: GroundPickupKind;
  /** World-pixel point where it touches the ground. */
  x: number;
  y: number;
  /** Ground-plane velocity while it is still settling, in pixels per frame. */
  vx: number;
  vy: number;
  /** Height above the ground, in pixels, for the landing hop. */
  hop: number;
  /** Frames of the landing hop still to run; 0 once it lies still. */
  settleFrames: number;
  /** Frames since it was dropped, for its lifetime. */
  ageFrames: number;
}

/** Everything needed to put the pickups back exactly. */
export interface GroundPickupCheckpoint {
  readonly pickups: readonly GroundPickup[];
  readonly nextId: number;
}

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const HALF = 0.5;
const FULL_CIRCLE = Math.PI * 2;

/** A press gathers every pickup this close to the crawler… */
export const GROUND_PICKUP_COLLECT_RADIUS_TILES = 3;
/** …provided at least one is this close — the reach at which the prompt shows. */
export const GROUND_PICKUP_PROMPT_RADIUS_TILES = 1.3;

const GROUND_PICKUP_TTL_MINUTES = 10;
/** How long an uncollected pickup lies there before it is gone. */
export const GROUND_PICKUP_TTL_FRAMES =
  GROUND_PICKUP_TTL_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;
const GROUND_PICKUP_BLINK_SECONDS = 10;
/** A pickup blinks for this long before it vanishes, so its going is not a surprise. */
export const GROUND_PICKUP_BLINK_FRAMES = GROUND_PICKUP_BLINK_SECONDS * FRAMES_PER_SECOND;
/** Frames per half-blink: on for this long, off for this long. */
const BLINK_HALF_PERIOD_FRAMES = 8;

/** How far a dropped pickup flies before landing, in tiles. */
const SCATTER_MIN_TILES = 0.3;
const SCATTER_MAX_TILES = 0.8;
/** The landing hop's length: about 0.4 s. */
export const GROUND_PICKUP_SETTLE_FRAMES = 24;
/** The top of the landing hop, in pixels. */
const HOP_PEAK_PX = 10;
/** Scales `t(1 - t)`, which peaks at a quarter, so the hop peaks at exactly {@link HOP_PEAK_PX}. */
const HOP_PARABOLA_SCALE = 4;
/** How far out from a blocked landing spot to search for open ground, in tiles. */
const LANDING_SEARCH_RADIUS_TILES = 4;

/** How wide the burger is drawn: a little under half a tile. */
const BURGER_WIDTH_TILES = 0.45;
/** The side of the square the burger's cell is drawn into, in pixels. */
export const GROUND_BURGER_DRAW_PX = Math.round(
  (TILE_SIZE * BURGER_WIDTH_TILES) / BURGER_WIDTH_OF_CELL,
);

const SHADOW_COLOR = 'rgba(0, 0, 0, 0.32)';
const SHADOW_HALF_WIDTH_TILES = 0.24;
const SHADOW_HALF_HEIGHT_TILES = 0.08;
/** The shadow shrinks toward this fraction of its size at the top of a hop. */
const SHADOW_MIN_SCALE_IN_AIR = 0.6;

/** A glint crosses the bun once per this many frames, offset per pickup so a pile doesn't flash in unison. */
const GLINT_PERIOD_FRAMES = 150;
const GLINT_DURATION_FRAMES = 18;
const GLINT_PHASE_PER_ID = 37;
const GLINT_ARM_PX = 3;
const GLINT_ARM_WIDTH_PX = 0.8;
const GLINT_COLOR = 'rgba(255, 250, 225, 0.95)';
/** Where the glint sits on the burger, as a fraction of the cell from its top-left. */
const GLINT_X = 0.36;
const GLINT_Y = 0.42;

/** The prompt floats over a tile-sized box; this centres that box on the pickup. */
const PROMPT_BOX_PX = TILE_SIZE;
/** How much the prompt's box sits above the pickup's ground point. */
const PROMPT_LIFT_PX = TILE_SIZE * HALF;

const BAG_FULL_NOTICE = 'Your bag is full.';

/** The sounds a frame's collecting earned, for the owning kit to play. */
export interface GroundPickupCues {
  /** Something was lifted off the ground. */
  readonly pickedUp: boolean;
  /** A press reached pickups that did not fit in the bag. */
  readonly refused: boolean;
}

function clonePickup(pickup: GroundPickup): GroundPickup {
  return { ...pickup };
}

/**
 * An entry in the scene's Y-sorted pass. `TownPropRenderable` sorts on
 * `y + TILE_SIZE`, so `y` is the ground point lifted by one tile.
 */
class GroundPickupSprite implements TownPropRenderable {
  x = 0;
  y = 0;
  readonly cullMarginTiles = 1;
  pickup: GroundPickup | null = null;

  constructor(private readonly owner: GroundPickupSystem) {}

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.pickup !== null) this.owner.drawPickup(ctx, this.pickup, camX, camY);
  }
}

export class GroundPickupSystem {
  private pickups: GroundPickup[] = [];
  private nextId = 1;
  private readonly spritePool: GroundPickupSprite[] = [];
  private readonly entityScratch: TownPropRenderable[] = [];
  private pickedUpThisFrame = false;
  private refusedThisFrame = false;

  /** Fired once per item id collected in a single press, for a fly-to-bag effect. */
  onCollected: ((itemId: ItemId, quantity: number, worldX: number, worldY: number) => void) | null =
    null;

  /**
   * @param random Source of scatter directions and distances. Injectable so a
   *   gate can make a scatter repeatable.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly random: () => number = Math.random,
  ) {}

  /** Every pickup currently in the world, settled or still landing. */
  get all(): ReadonlyArray<GroundPickup> {
    return this.pickups;
  }

  /** Scatters `count` hamburgers from a world-pixel centre. */
  spawnBurgers(cx: number, cy: number, count: number): void {
    this.spawn('hamburger', cx, cy, count);
  }

  /**
   * Scatters `count` pickups of `kind` from the world-pixel point `cx`,`cy`.
   * Each flies 0.3–0.8 tiles in a random direction with a small hop, and lands
   * only on a walkable tile: one aimed at a wall or a fence comes down on the
   * nearest open tile instead.
   */
  spawn(kind: GroundPickupKind, cx: number, cy: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * FULL_CIRCLE;
      const scatterTiles =
        SCATTER_MIN_TILES + this.random() * (SCATTER_MAX_TILES - SCATTER_MIN_TILES);
      const aimX = cx + Math.cos(angle) * scatterTiles * TILE_SIZE;
      const aimY = cy + Math.sin(angle) * scatterTiles * TILE_SIZE;
      const landing = this.walkableLanding(aimX, aimY) ?? { x: cx, y: cy };
      this.pickups.push({
        id: this.nextId++,
        kind,
        x: cx,
        y: cy,
        vx: (landing.x - cx) / GROUND_PICKUP_SETTLE_FRAMES,
        vy: (landing.y - cy) / GROUND_PICKUP_SETTLE_FRAMES,
        hop: 0,
        settleFrames: GROUND_PICKUP_SETTLE_FRAMES,
        ageFrames: 0,
      });
    }
  }

  /**
   * `x`,`y` itself when it is on open ground, else the centre of the nearest
   * walkable tile, searched ring by ring outward. Null when nothing within the
   * search radius is walkable.
   */
  private walkableLanding(x: number, y: number): { x: number; y: number } | null {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    if (this.gameMap.isWalkable(tileX, tileY)) return { x, y };
    for (let r = 1; r <= LANDING_SEARCH_RADIUS_TILES; r++) {
      let best: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.gameMap.isWalkable(tileX + dx, tileY + dy)) continue;
          const centreX = (tileX + dx + HALF) * TILE_SIZE;
          const centreY = (tileY + dy + HALF) * TILE_SIZE;
          const dist = Math.hypot(centreX - x, centreY - y);
          if (dist < bestDist) {
            bestDist = dist;
            best = { x: centreX, y: centreY };
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** Moves hopping pickups, ages them all, and removes the expired. */
  update(): void {
    for (const pickup of this.pickups) {
      pickup.ageFrames++;
      if (pickup.settleFrames <= 0) continue;
      pickup.x += pickup.vx;
      pickup.y += pickup.vy;
      pickup.settleFrames--;
      const progress = 1 - pickup.settleFrames / GROUND_PICKUP_SETTLE_FRAMES;
      pickup.hop = HOP_PEAK_PX * HOP_PARABOLA_SCALE * progress * (1 - progress);
      if (pickup.settleFrames === 0) {
        pickup.vx = 0;
        pickup.vy = 0;
        pickup.hop = 0;
      }
    }
    this.pickups = this.pickups.filter((pickup) => pickup.ageFrames < GROUND_PICKUP_TTL_FRAMES);
  }

  /** Distance, in pixels, from the centre of `player`'s tile to where `pickup` lies. */
  private distanceTo(player: Player, pickup: GroundPickup): number {
    const px = player.x + TILE_SIZE * HALF;
    const py = player.y + TILE_SIZE * HALF;
    return Math.hypot(pickup.x - px, pickup.y - py);
  }

  /** The closest pickup within prompt reach of `player`, or null. */
  nearestInReach(player: Player): GroundPickup | null {
    const reach = GROUND_PICKUP_PROMPT_RADIUS_TILES * TILE_SIZE;
    let nearest: GroundPickup | null = null;
    let nearestDist = reach;
    for (const pickup of this.pickups) {
      const dist = this.distanceTo(player, pickup);
      if (dist <= nearestDist) {
        nearest = pickup;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  /**
   * The interact key's entry: when a pickup is within prompt reach, gathers
   * every pickup within the wider collect radius into `player`'s bag.
   *
   * Only what fits is taken. The rest stays on the ground and the player is
   * told the bag is full — `Inventory.addItem` would otherwise swallow it.
   *
   * @returns whether the press was claimed: true whenever a pickup was in
   *   prompt reach, even if none fit, so a full bag explains itself rather
   *   than the press falling through to a swing at the air.
   */
  tryPickupNear(player: Player): boolean {
    const nearest = this.nearestInReach(player);
    if (nearest === null) return false;

    const collectReach = GROUND_PICKUP_COLLECT_RADIUS_TILES * TILE_SIZE;
    const inReach = this.pickups
      .filter((pickup) => this.distanceTo(player, pickup) <= collectReach)
      .sort((a, b) => this.distanceTo(player, a) - this.distanceTo(player, b));

    const collected = new Set<number>();
    const countByItem = new Map<ItemId, number>();
    let leftBehind = false;
    for (const pickup of inReach) {
      const itemId = PICKUP_ITEM[pickup.kind];
      if (!player.inventory.hasRoomFor(itemId)) {
        leftBehind = true;
        continue;
      }
      player.inventory.addItem(itemId, 1);
      collected.add(pickup.id);
      countByItem.set(itemId, (countByItem.get(itemId) ?? 0) + 1);
    }

    if (collected.size > 0) {
      this.pickups = this.pickups.filter((pickup) => !collected.has(pickup.id));
      player.onInventoryChanged();
      playPickupGesture(player, nearest);
      for (const [itemId, count] of countByItem) {
        player.queueFloatingText(`+${count} ${ITEM_DEF[itemId].name}`, 'buff');
        this.onCollected?.(itemId, count, player.x, player.y);
      }
      this.pickedUpThisFrame = true;
    }
    if (leftBehind) {
      player.queueSystemNotice(BAG_FULL_NOTICE);
      if (collected.size === 0) this.refusedThisFrame = true;
    }
    return true;
  }

  /** What collecting earned since the last drain; resets on read. */
  drainPickupCues(): GroundPickupCues {
    const cues = { pickedUp: this.pickedUpThisFrame, refused: this.refusedThisFrame };
    this.pickedUpThisFrame = false;
    this.refusedThisFrame = false;
    return cues;
  }

  /**
   * Y-sort entries for the scene's entity pass. The returned list and its
   * entries are reused frame to frame; read them before the next call.
   */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    this.entityScratch.length = 0;
    while (this.spritePool.length < this.pickups.length) {
      this.spritePool.push(new GroundPickupSprite(this));
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const pickup = this.pickups[i];
      const sprite = this.spritePool[i];
      sprite.pickup = pickup;
      sprite.x = pickup.x - TILE_SIZE * HALF;
      sprite.y = pickup.y - TILE_SIZE;
      this.entityScratch.push(sprite);
    }
    return this.entityScratch;
  }

  /** Draws every pickup directly, for a scene with no Y-sorted entity pass. */
  renderFlat(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const pickup of this.pickups) this.drawPickup(ctx, pickup, camX, camY);
  }

  /** One pickup: its contact shadow on the ground, then the object above it. */
  drawPickup(
    ctx: CanvasRenderingContext2D,
    pickup: GroundPickup,
    camX: number,
    camY: number,
  ): void {
    const framesLeft = GROUND_PICKUP_TTL_FRAMES - pickup.ageFrames;
    const blinkingOut = framesLeft <= GROUND_PICKUP_BLINK_FRAMES;
    const blinkPhase = Math.floor(framesLeft / BLINK_HALF_PERIOD_FRAMES);
    if (blinkingOut && blinkPhase % 2 === 1) return;

    const groundX = pickup.x - camX;
    const groundY = pickup.y - camY;
    const airborne = pickup.hop / HOP_PEAK_PX;
    const shadowScale = 1 - (1 - SHADOW_MIN_SCALE_IN_AIR) * airborne;
    ctx.fillStyle = SHADOW_COLOR;
    ctx.beginPath();
    ctx.ellipse(
      groundX,
      groundY,
      TILE_SIZE * SHADOW_HALF_WIDTH_TILES * shadowScale,
      TILE_SIZE * SHADOW_HALF_HEIGHT_TILES * shadowScale,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();

    const cell = GROUND_BURGER_DRAW_PX;
    const cellX = groundX - cell * HALF;
    const cellY = groundY - pickup.hop - cell * BURGER_BASE_Y;
    ctx.drawImage(groundBurgerSprite(), cellX, cellY, cell, cell);

    const glintFrame = (pickup.ageFrames + pickup.id * GLINT_PHASE_PER_ID) % GLINT_PERIOD_FRAMES;
    if (pickup.settleFrames === 0 && glintFrame < GLINT_DURATION_FRAMES) {
      const glintProgress = glintFrame / GLINT_DURATION_FRAMES;
      const glintSize = GLINT_ARM_PX * Math.sin(glintProgress * Math.PI);
      const gx = cellX + cell * GLINT_X;
      const gy = cellY + cell * GLINT_Y;
      ctx.fillStyle = GLINT_COLOR;
      ctx.fillRect(
        gx - glintSize,
        gy - GLINT_ARM_WIDTH_PX * HALF,
        glintSize * 2,
        GLINT_ARM_WIDTH_PX,
      );
      ctx.fillRect(
        gx - GLINT_ARM_WIDTH_PX * HALF,
        gy - glintSize,
        GLINT_ARM_WIDTH_PX,
        glintSize * 2,
      );
    }
  }

  /**
   * Floats "Pick up" over the nearest pickup in reach of `active`. The caller
   * decides whether prompts show at all (a hostile in reach takes the press).
   *
   * @returns whether a prompt was drawn.
   */
  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): boolean {
    const nearest = this.nearestInReach(active);
    if (nearest === null) return false;
    const boxX = nearest.x - PROMPT_BOX_PX * HALF - camX;
    const boxY = nearest.y - PROMPT_LIFT_PX - camY;
    drawInteractionPrompt(ctx, boxX, boxY, PROMPT_BOX_PX, 'Pick up');
    return true;
  }

  captureCheckpoint(): GroundPickupCheckpoint {
    return { pickups: this.pickups.map(clonePickup), nextId: this.nextId };
  }

  /** Puts back exactly the pickups captured; anything dropped since is discarded. */
  restoreCheckpoint(snapshot: GroundPickupCheckpoint): void {
    this.pickups = snapshot.pickups.map(clonePickup);
    this.nextId = snapshot.nextId;
  }
}
