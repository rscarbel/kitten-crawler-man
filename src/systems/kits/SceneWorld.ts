/**
 * The shared spine every gameplay scene stands on, and the one thing every kit
 * in this directory is constructed from.
 *
 * A **kit** is a plain class whose fields are concrete system types. Kits exist
 * so that a new environment gets "everything the dungeon has" by constructing
 * them rather than by transplanting the dungeon's wiring a second time. There is
 * deliberately no string-keyed registry and no homogeneous `GameSystem[]` loop
 * here: system `update` signatures are not uniform, so a generic loop could only
 * be reached through casts.
 */

import { MOB_GRID_CELL_SIZE } from '../../core/constants';
import { SpatialGrid } from '../../core/SpatialGrid';
import type { EventBus } from '../../core/EventBus';
import type { GameMap } from '../../map/GameMap';
import type { Mob } from '../../creatures/Mob';
import type { AudioManager } from '../../audio/AudioManager';
import type { PlayerManager } from '../../core/PlayerManager';
import type { SpellSystem } from '../SpellSystem';

/**
 * A scene's population: the render/update list and the spatial index over it,
 * kept in step by a single spawn path.
 *
 * Every mob that enters a scene goes through {@link add}. Before this existed
 * the same four-line closure was hand-written at nine call sites, and each one
 * that forgot a line produced its own bug — a mob that never receives a
 * `SpellSystem` walks through a protective shell, and one that never receives
 * the map cannot path at all.
 */
export class MobRoster {
  /**
   * Append-only during play: corpses stay in the list so they keep rendering.
   * The checkpoint rewind is the sole exception and goes through
   * {@link replaceAll}.
   */
  readonly mobs: Mob[] = [];
  private _grid = new SpatialGrid<Mob>(MOB_GRID_CELL_SIZE);

  constructor(
    private readonly map: GameMap,
    /**
     * Handed to every mob that joins, and held here rather than in the kit that
     * casts through it so the two can never end up being different instances.
     */
    readonly spells: SpellSystem,
  ) {}

  /** The spatial index over {@link mobs}. Replaced wholesale by {@link rebuildGrid}. */
  get grid(): SpatialGrid<Mob> {
    return this._grid;
  }

  /** The one true spawn path: list, grid, spells and map together, atomically. */
  add(mob: Mob): void {
    this.mobs.push(mob);
    this._grid.insert(mob);
    mob.setSpells(this.spells);
    mob.setMap(this.map);
  }

  /**
   * Swaps the whole population for `next` without replacing the array itself —
   * the per-frame `SystemContext` and several spawn closures hold a reference to
   * it, so a fresh array would strand them on the old one.
   */
  replaceAll(next: ReadonlyArray<Mob>): void {
    this.mobs.length = 0;
    for (const mob of next) this.mobs.push(mob);
  }

  /**
   * Rebuilds the index from the current roster, keeping only mobs that still
   * claim a cell.
   *
   * Rebuilt rather than patched because `belongsInMobGrid` flips for every mob a
   * checkpoint rewind revives or drops, and the grid has no bulk-update path.
   */
  rebuildGrid(): void {
    this._grid = new SpatialGrid<Mob>(MOB_GRID_CELL_SIZE);
    for (const mob of this.mobs) {
      if (mob.belongsInMobGrid) this._grid.insert(mob);
    }
  }
}

/**
 * What every kit is handed: the map it acts on, the scene's single event bus,
 * its audio manager, and its population.
 *
 * **One bus per scene.** Systems subscribe in their constructors and several
 * declare no `dispose`, so the only thing that keeps their listeners from
 * outliving the scene is `bus.clear()` at teardown — which is safe exactly
 * because the bus is not shared with anything else.
 */
export interface SceneWorld {
  readonly gameMap: GameMap;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  /** The two crawlers, and which of them the player is currently steering. */
  readonly pm: PlayerManager;
  readonly roster: MobRoster;
}
