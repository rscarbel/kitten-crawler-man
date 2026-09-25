/**
 * The one place a harvest node's capacity is spent, shared by crawlers and
 * thralls so the two can never disagree about how much a tree has left.
 *
 * It owns nothing durable: every node's state lives in the `nodes` map it is
 * handed, which is `BriarHollowState.nodes`, threaded across door visits. What
 * it adds is the depletion itself — felling the tree, crumbling the rock — and
 * a checkpoint that can put a crumbled rock back.
 */

import type { GameMap } from '../../map/GameMap';
import type { EventBus } from '../../core/EventBus';
import type { HarvestKind } from '../../core/craftPerks';
import type { HarvestNodeState } from '../../core/briarHollowState';
import { resourcingNodeCapacityBonus } from '../../core/craftPerks';
import type { TreeSystem } from '../TreeSystem';
import { tileKey } from '../tileKey';
import {
  createNodeState,
  crumbleRock,
  harvestKindAt,
  restoreRock,
  syncWornLook,
  tileAt,
} from './harvestNodes';

/** What depleting a node tells whoever listens for its sound. */
export interface NodeDepletion {
  readonly kind: HarvestKind;
  readonly tileX: number;
  readonly tileY: number;
}

/** A value copy of every node's state, for a death rewind. */
export type NodeLedgerCheckpoint = ReadonlyMap<string, HarvestNodeState>;

export interface NodeLedgerDeps {
  readonly gameMap: GameMap;
  readonly nodes: Map<string, HarvestNodeState>;
  /** Null off the overworld, where there are no trees to fell. */
  readonly trees: TreeSystem | null;
  readonly bus: EventBus | null;
  /** Told when a node's tile changes, so the minimap repaints it. */
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /** Rolls a fresh node's capacity. */
  readonly capacityRng: () => number;
  /** Told when a node runs out, for its sound and particles. */
  readonly onDepleted: (depletion: NodeDepletion) => void;
}

export class NodeLedger {
  constructor(private readonly deps: NodeLedgerDeps) {}

  /**
   * The state of the node at a tile, rolled the first time anyone asks, or
   * null when the tile is not a harvestable node now. A node whose recorded
   * kind no longer matches its tile — a tree burnt since it was last worked —
   * is not a node any more either. A fresh node's capacity carries the Resourcing
   * perk of `harvesterLevel`, the level of whoever is first working it.
   */
  stateAt(tileX: number, tileY: number, harvesterLevel: number): HarvestNodeState | null {
    const kind = harvestKindAt(this.deps.gameMap, tileX, tileY);
    if (kind === null) return null;
    const key = tileKey(tileX, tileY);
    const known = this.deps.nodes.get(key);
    if (known !== undefined) return known.kind === kind && known.remaining > 0 ? known : null;
    const tile = tileAt(this.deps.gameMap, tileX, tileY);
    if (tile === null) return null;
    const created = createNodeState(
      kind,
      tileX,
      tileY,
      tile.type,
      this.deps.capacityRng,
      resourcingNodeCapacityBonus(harvesterLevel),
    );
    this.deps.nodes.set(key, created);
    return created;
  }

  /** The state of a node someone has already worked, without rolling a fresh one. */
  knownStateAt(tileX: number, tileY: number): HarvestNodeState | null {
    const known = this.deps.nodes.get(tileKey(tileX, tileY));
    return known !== undefined && known.remaining > 0 ? known : null;
  }

  /**
   * Spends one harvest of the node's capacity, depleting it on the last.
   * Returns false when there was nothing there to spend.
   */
  spend(tileX: number, tileY: number, harvesterLevel: number): boolean {
    const state = this.stateAt(tileX, tileY, harvesterLevel);
    if (state === null) return false;
    state.remaining -= 1;
    if (state.remaining <= 0) this.deplete(state, tileX, tileY);
    else syncWornLook(this.deps.gameMap, state);
    return true;
  }

  private deplete(state: HarvestNodeState, tileX: number, tileY: number): void {
    state.remaining = 0;
    if (state.kind === 'wood') {
      this.deps.trees?.fellByHarvest(tileX, tileY);
    } else {
      crumbleRock(this.deps.gameMap, tileX, tileY, this.deps.onTileChanged);
    }
    this.deps.bus?.emit('resourceNodeDepleted', { kind: state.kind, x: tileX, y: tileY });
    this.deps.onDepleted({ kind: state.kind, tileX, tileY });
  }

  captureCheckpoint(): NodeLedgerCheckpoint {
    const copy = new Map<string, HarvestNodeState>();
    for (const [key, state] of this.deps.nodes) copy.set(key, { ...state });
    return copy;
  }

  /**
   * Rewinds every node. A rock that crumbled after the checkpoint stands back
   * up here, because nothing else knows it was ever a rock; a tree felled after
   * it is stood back up by `TreeSystem`'s own checkpoint.
   */
  restoreCheckpoint(snapshot: NodeLedgerCheckpoint): void {
    for (const [key, live] of this.deps.nodes) {
      const crumbled = live.kind === 'stone' && live.remaining <= 0;
      if (!crumbled) continue;
      const captured = snapshot.get(key);
      const crumbledAtCheckpoint = captured !== undefined && captured.remaining <= 0;
      if (crumbledAtCheckpoint) continue;
      restoreRock(
        this.deps.gameMap,
        live.tileX,
        live.tileY,
        live.tileType,
        this.deps.onTileChanged,
      );
    }
    const touched = [...this.deps.nodes.values()];
    this.deps.nodes.clear();
    for (const [key, state] of snapshot) this.deps.nodes.set(key, { ...state });
    // A deposit first worked after the checkpoint was untouched at it, so it
    // looks intact again; every other node takes the look of its rewound state.
    for (const state of touched) {
      const untouchedAtCheckpoint = !this.deps.nodes.has(tileKey(state.tileX, state.tileY));
      if (untouchedAtCheckpoint) {
        syncWornLook(this.deps.gameMap, { ...state, remaining: state.capacity });
      }
    }
    for (const state of this.deps.nodes.values()) syncWornLook(this.deps.gameMap, state);
  }
}
