/**
 * The village's resources coming back, so Briar Hollow never runs dry.
 *
 * Only two places regrow: the quarry's deposits (its outcrops and the dressed
 * stone of its ruined wall stubs) and the lumber yard's managed grove. A tree
 * or boulder anywhere else stays worked out — the wilds are a one-off windfall,
 * the village is a supply.
 *
 * It watches a fixed list of tiles from the site rather than listening for
 * depletions, so a grove tree brought down by a sword or a stick of dynamite
 * grows back exactly like one cut for its wood. Every timer lives on the
 * node's `HarvestNodeState` in `BriarHollowState.nodes`, so it survives a door
 * visit and rewinds with the ledger's checkpoint; the half-second grow-in
 * flourish is the only transient state here.
 *
 * Timers count fixed-timestep updates, never wall time, because the scene can
 * run two updates in one callback.
 */

import { TILE_SIZE } from '../../core/constants';
import type { HarvestNodeState } from '../../core/briarHollowState';
import type { HarvestKind } from '../../core/craftPerks';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import { ROCK_DEPOSIT, TREE, treeSpriteKeyForTile } from '../../map/tileTypes';
import { tileKey } from '../tileKey';
import type { TownPropRenderable } from '../townPropRenderable';
import { crumbleRock, regrowTree, restoreRock, tileAt, unplantTree } from './harvestNodes';

/** A worked-out quarry deposit stands again after this long. */
export const DEPOSIT_REGROW_SECONDS = 300;
/** A felled grove tree puts up a sapling after this long… */
export const GROVE_REGROW_SECONDS = 240;
/** …and the sapling is a full tree this long after that. */
export const SAPLING_GROW_SECONDS = 60;
/** A regrowth blocked by someone standing on the tile tries again after this long. */
export const REGROW_RETRY_SECONDS = 10;

const TICKS_PER_SECOND = 60;
export const DEPOSIT_REGROW_TICKS = DEPOSIT_REGROW_SECONDS * TICKS_PER_SECOND;
export const GROVE_REGROW_TICKS = GROVE_REGROW_SECONDS * TICKS_PER_SECOND;
export const SAPLING_GROW_TICKS = SAPLING_GROW_SECONDS * TICKS_PER_SECOND;
export const REGROW_RETRY_TICKS = REGROW_RETRY_SECONDS * TICKS_PER_SECOND;

/** The pop from sapling to tree: short, with a little overshoot so it reads as growth, not a swap. */
const GROW_IN_TICKS = 30;
/** How big a sapling is drawn, as a share of the grown tree. */
const SAPLING_SCALE = 0.36;
/** How much a sapling fills out over its minute before the pop. */
const SAPLING_SCALE_GAIN = 0.12;
/** Strength of the grow-in's overshoot (the standard ease-out-back constant). */
const GROW_IN_OVERSHOOT = 1.70158;
const HALF_TILE = 0.5;
const SQUARE = 2;
const CUBIC = 3;

/** One tile that regrows, and what stands on it when it has. */
interface RegrowSpot {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: HarvestKind;
  /** `ROCK_DEPOSIT` or `TREE`. */
  readonly standingType: number;
}

/** A body a regrown rock or tree must not be stood up on top of. */
export interface StandingBody {
  readonly x: number;
  readonly y: number;
}

export interface NodeRegrowthDeps {
  readonly gameMap: GameMap;
  readonly nodes: Map<string, HarvestNodeState>;
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /**
   * Everyone whose body could be standing on a regrowing tile: crawlers,
   * villagers, cows, mobs. Positions are world-pixel top-left of a one-tile body.
   */
  readonly bodies: () => Iterable<StandingBody>;
  /**
   * Whether something built or being built claims the tile — a trebuchet's
   * footprint, a snare laid on walkable ground, a job's reservation. Snares
   * never touch the tile or the block mask, so walkability alone misses them.
   */
  readonly isTileClaimed: (tileX: number, tileY: number) => boolean;
}

/** The tiles a village regrows: its quarry's deposits and stubs, and its grove. */
export function regrowSpotsOf(site: BriarHollowSite | null): RegrowSpot[] {
  if (site === null) return [];
  const stone = (tile: { x: number; y: number }): RegrowSpot => ({
    tileX: tile.x,
    tileY: tile.y,
    kind: 'stone',
    standingType: ROCK_DEPOSIT,
  });
  const wood = (tile: { x: number; y: number }): RegrowSpot => ({
    tileX: tile.x,
    tileY: tile.y,
    kind: 'wood',
    standingType: TREE,
  });
  return [
    ...site.quarry.depositTiles.map(stone),
    ...site.quarry.stubTiles.map(stone),
    ...site.lumberYard.groveTiles.map(wood),
  ];
}

/** A run-out node with its regrowth timer running. */
type RegrowingNode = HarvestNodeState & { regrowTicksLeft: number };

function isRegrowing(node: HarvestNodeState | undefined): node is RegrowingNode {
  return node !== undefined && node.regrowTicksLeft !== null;
}

/** Whether a one-tile body at world top-left (x, y) overlaps the tile at all. */
function bodyOverlapsTile(body: StandingBody, tileX: number, tileY: number): boolean {
  const left = tileX * TILE_SIZE;
  const top = tileY * TILE_SIZE;
  return (
    body.x < left + TILE_SIZE &&
    body.x + TILE_SIZE > left &&
    body.y < top + TILE_SIZE &&
    body.y + TILE_SIZE > top
  );
}

export class NodeRegrowth {
  private readonly spots: readonly RegrowSpot[];
  /** Grow-in progress by tile key, in ticks. Transient: a rewind simply replays the pop. */
  private readonly growingIn = new Map<string, number>();

  constructor(
    private readonly deps: NodeRegrowthDeps,
    site: BriarHollowSite | null,
  ) {
    this.spots = regrowSpotsOf(site);
  }

  /** Advances every regrowing tile by one fixed-timestep update. */
  update(): void {
    for (const spot of this.spots) this.tick(spot);
  }

  private tick(spot: RegrowSpot): void {
    const tile = tileAt(this.deps.gameMap, spot.tileX, spot.tileY);
    if (tile === null) return;
    const key = tileKey(spot.tileX, spot.tileY);
    const node = this.deps.nodes.get(key);
    const standing = tile.type === spot.standingType;
    if (standing) {
      // Stood back up by something else — a rewind — so the timer is stale.
      if (isRegrowing(node)) this.deps.nodes.delete(key);
      this.growingIn.delete(key);
      return;
    }
    if (!isRegrowing(node)) {
      this.deps.nodes.set(key, this.scheduled(spot, node));
      return;
    }
    const growIn = this.growingIn.get(key);
    if (growIn !== undefined) {
      if (growIn + 1 < GROW_IN_TICKS) {
        this.growingIn.set(key, growIn + 1);
        return;
      }
      this.growingIn.delete(key);
      this.finish(spot, node, key);
      return;
    }
    node.regrowTicksLeft -= 1;
    if (node.regrowTicksLeft > 0) return;
    this.step(spot, node, key);
  }

  /** A run-out node's first wait, keeping the capacity it had if it was worked. */
  private scheduled(spot: RegrowSpot, known: HarvestNodeState | undefined): HarvestNodeState {
    return {
      kind: spot.kind,
      tileX: spot.tileX,
      tileY: spot.tileY,
      capacity: known?.capacity ?? 0,
      remaining: 0,
      tileType: spot.standingType,
      regrowTicksLeft: spot.kind === 'stone' ? DEPOSIT_REGROW_TICKS : GROVE_REGROW_TICKS,
      sapling: false,
    };
  }

  private step(spot: RegrowSpot, node: HarvestNodeState, key: string): void {
    if (spot.kind === 'wood' && !node.sapling) {
      node.sapling = true;
      node.regrowTicksLeft = SAPLING_GROW_TICKS;
      return;
    }
    if (!this.isClear(spot)) {
      node.regrowTicksLeft = REGROW_RETRY_TICKS;
      return;
    }
    if (spot.kind === 'wood') {
      this.growingIn.set(key, 0);
      return;
    }
    this.finish(spot, node, key);
  }

  /** Stands the rock or tree up — unless someone stepped onto the tile while it grew in. */
  private finish(spot: RegrowSpot, node: HarvestNodeState, key: string): void {
    if (!this.isClear(spot)) {
      node.regrowTicksLeft = REGROW_RETRY_TICKS;
      return;
    }
    const { gameMap, onTileChanged } = this.deps;
    if (spot.kind === 'stone') {
      restoreRock(gameMap, spot.tileX, spot.tileY, spot.standingType, onTileChanged);
      const tile = tileAt(gameMap, spot.tileX, spot.tileY);
      if (tile !== null) delete tile.damageStage;
    } else {
      regrowTree(gameMap, spot.tileX, spot.tileY, onTileChanged);
    }
    // A fresh node: its capacity is rolled anew the first time it is worked.
    this.deps.nodes.delete(key);
  }

  /**
   * Nobody is standing on the tile, nothing has been built on it, and it is
   * open ground. A solid tile stood up under a body traps it; a structure put
   * up on the rubble or stump since is not this system's to overwrite.
   * `isWalkable` rather than the tile type, because a trebuchet blocks its
   * footprint through the map's block mask without changing the tiles.
   */
  private isClear(spot: RegrowSpot): boolean {
    const { gameMap, isTileClaimed } = this.deps;
    if (!gameMap.isWalkable(spot.tileX, spot.tileY)) return false;
    if (isTileClaimed(spot.tileX, spot.tileY)) return false;
    for (const body of this.deps.bodies()) {
      if (bodyOverlapsTile(body, spot.tileX, spot.tileY)) return false;
    }
    return true;
  }

  /**
   * After the ledger's rewind: a node that was run out at the checkpoint but
   * has regrown since goes back to being run out, so the rewound timer and the
   * map agree.
   */
  reconcileAfterRestore(): void {
    this.growingIn.clear();
    const { gameMap, nodes, onTileChanged } = this.deps;
    for (const spot of this.spots) {
      const node = nodes.get(tileKey(spot.tileX, spot.tileY));
      if (node === undefined || node.remaining > 0) continue;
      // A run-out tree with no timer yet is still coming down, which the
      // forest's own rewind has already put back as it was.
      if (spot.kind === 'wood' && node.regrowTicksLeft === null) continue;
      const tile = tileAt(gameMap, spot.tileX, spot.tileY);
      if (tile?.type !== spot.standingType) continue;
      if (spot.kind === 'stone') crumbleRock(gameMap, spot.tileX, spot.tileY, onTileChanged);
      else unplantTree(gameMap, spot.tileX, spot.tileY, onTileChanged);
    }
  }

  /** The stumps of felled grove trees, which stay until their sapling comes up. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const spot of this.spots) {
      if (spot.kind !== 'wood') continue;
      const node = this.deps.nodes.get(tileKey(spot.tileX, spot.tileY));
      if (!isRegrowing(node) || node.sapling) continue;
      const tile = tileAt(this.deps.gameMap, spot.tileX, spot.tileY);
      if (tile === null || tile.type === TREE) continue;
      const x = spot.tileX * TILE_SIZE - camX;
      const y = spot.tileY * TILE_SIZE - camY;
      drawSpriteKey(ctx, 'tree_remains', 'idle', 0, x, y, TILE_SIZE);
    }
  }

  /**
   * Saplings, and the grow-in pop, for the Y-sorted pass. A sapling is the
   * tree it will become, drawn small: the same species on the same tile.
   */
  renderables(): TownPropRenderable[] {
    const out: TownPropRenderable[] = [];
    for (const spot of this.spots) {
      if (spot.kind !== 'wood') continue;
      const key = tileKey(spot.tileX, spot.tileY);
      const node = this.deps.nodes.get(key);
      if (!isRegrowing(node) || !node.sapling) continue;
      const tile = tileAt(this.deps.gameMap, spot.tileX, spot.tileY);
      if (tile === null || tile.type === TREE) continue;
      const spriteKey = treeSpriteKeyForTile(tile, spot.tileX, spot.tileY);
      const scale = this.saplingScale(node, this.growingIn.get(key));
      out.push({
        x: spot.tileX * TILE_SIZE,
        y: spot.tileY * TILE_SIZE,
        render: (ctx, camX, camY) => {
          const size = TILE_SIZE * scale;
          const footX = (spot.tileX + HALF_TILE) * TILE_SIZE - camX;
          const footY = (spot.tileY + 1) * TILE_SIZE - camY;
          drawSpriteKey(ctx, spriteKey, 'idle', 0, footX - size / 2, footY - size, size);
        },
      });
    }
    return out;
  }

  private saplingScale(node: HarvestNodeState, growIn: number | undefined): number {
    const grown = 1 - Math.max(0, node.regrowTicksLeft ?? 0) / SAPLING_GROW_TICKS;
    const sapling = SAPLING_SCALE + SAPLING_SCALE_GAIN * Math.min(1, Math.max(0, grown));
    if (growIn === undefined) return sapling;
    const progress = growIn / GROW_IN_TICKS - 1;
    const eased =
      1 + (GROW_IN_OVERSHOOT + 1) * progress ** CUBIC + GROW_IN_OVERSHOOT * progress ** SQUARE;
    return sapling + (1 - sapling) * eased;
  }
}
