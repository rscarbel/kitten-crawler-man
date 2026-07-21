import { TILE_SIZE } from '../core/constants';
import { Mercenary } from '../creatures/Mercenary';
import type { Player } from '../Player';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import type { GameSystem, SystemContext } from './GameSystem';

/**
 * Overworld manager for a hired mercenary (the Desperado Club's "Meat Shields"
 * guild), modelled on `MongoSystem`. Each `DungeonScene` constructs a fresh
 * instance from the persisted `MercenaryRoster`; if the roster holds an active
 * hire, the merc is spawned near the active player on the first frame and then
 * follows and fights each frame like any other mob.
 *
 * A merc dies for good: when its HP reaches 0 the system despawns it and clears
 * `roster.active`, so it does not return on the next visit. Building/floor
 * transitions call `dismiss` — that only despawns the mob, leaving the roster
 * intact so the merc respawns from the new scene's `MercenarySystem`.
 */
export class MercenarySystem implements GameSystem {
  private merc: Mercenary | null = null;
  private spawnAttempted = false;

  constructor(private readonly roster: MercenaryRoster) {}

  /** The live mercenary mob, if one is spawned — added to the scene's extra targets so hostiles engage it. */
  get activeMerc(): Mercenary | null {
    return this.merc;
  }

  update(ctx: SystemContext): void {
    const { mobs, mobGrid, gameMap, active } = ctx;

    if (!this.spawnAttempted) {
      this.spawnAttempted = true;
      this.spawn(active, gameMap, mobs, mobGrid);
    }

    if (!this.merc?.isAlive) return;

    this.merc.owner = active;
    this.merc.allMobs = mobs;
  }

  /**
   * Death interception, called (like `MongoSystem.checkHealth`) after mob damage
   * resolution but *before* `resolveKills`. A fallen merc is removed from the mob
   * list here so combat resolution never processes the player's own paid ally as
   * a slain enemy (no spurious kill XP, kill-stat, gore, corpse marker, or AI
   * kill report). Its death is permanent — the roster is cleared, so it does not
   * respawn on the next visit.
   */
  checkHealth(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (!this.merc) return;
    if (this.merc.isAlive && this.merc.hp > 0) return;
    this.despawn(mobs, mobGrid);
    this.roster.active = null;
  }

  private spawn(active: Player, gameMap: GameMap, mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const hired = this.roster.active;
    if (!hired) return;

    const behindTx = Math.floor(active.x / TILE_SIZE) - Math.round(active.facingX);
    const behindTy = Math.floor(active.y / TILE_SIZE) - Math.round(active.facingY);
    const behindWalkable = gameMap.isWalkable(behindTx, behindTy);
    const spawnTx = behindWalkable ? behindTx : Math.floor(active.x / TILE_SIZE);
    const spawnTy = behindWalkable ? behindTy : Math.floor(active.y / TILE_SIZE);

    this.merc = new Mercenary(spawnTx, spawnTy, TILE_SIZE, active, hired.id, hired.name);
    this.merc.setMap(gameMap);
    mobs.push(this.merc);
    mobGrid.insert(this.merc);
  }

  private despawn(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (!this.merc) return;
    mobGrid.remove(this.merc);
    const idx = mobs.indexOf(this.merc);
    if (idx >= 0) mobs.splice(idx, 1);
    this.merc = null;
  }

  /** Despawn the merc without clearing the roster (interior/floor transitions). */
  dismiss(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    this.despawn(mobs, mobGrid);
  }
}
