import { TILE_SIZE } from '../core/constants';
import { Mercenary } from '../creatures/Mercenary';
import { MERCENARY_ART } from '../sprites/mercenaryArt';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import { contractIsCurrent, type MercenaryRoster } from '../core/MercenaryRoster';
import type { GameSystem, SystemContext } from './GameSystem';
import type { MobRoster } from './kits/SceneWorld';

/**
 * A point-in-time copy of the spawn state, for the in-run safe-room checkpoint.
 * The hire itself is durable state and is snapshotted with the roster.
 */
export interface MercenaryCheckpoint {
  /** Stored by reference: a snapshot names the merc, it does not clone it. */
  merc: Mercenary | null;
  spawnAttempted: boolean;
}

/** How far from the tile behind its owner a hire may be put when that tile is taken. */
const SPAWN_SEARCH_RADIUS_TILES = 3;
const TILE_CENTER = 0.5;

/** How close the active crawler must stand to talk to their hireling. */
const TALK_RANGE_TILES = 1.6;

/** A scene with no gore system (or a hireling with no `goreBodyPartKey`) needs nothing done. */
const NO_OP_GORE = (): void => {
  // Falling over is the whole death for a figure with no rubble to scatter.
};

/**
 * Overworld manager for a hired mercenary (the Desperado Club's "Meat Shields"
 * desk), modelled on `MongoSystem`. Each `DungeonScene` constructs a fresh
 * instance from the persisted `MercenaryRoster`; if the roster holds a contract
 * for this floor, the merc is spawned near the active player on the first frame
 * and then follows and fights each frame like any other mob.
 *
 * A contract ends two ways. Death is final: the body plays out and fades, the
 * roster forgets the hire and remembers the name for the desk. And the floor
 * ending ends it too, which is how Meat Shields sells them — a roster that still
 * names a contract from another floor is cleared rather than respawned.
 * Building transitions call `dismiss`, which only despawns the mob, leaving the
 * roster intact so the merc respawns from the next scene's `MercenarySystem`.
 */
export class MercenarySystem implements GameSystem {
  private merc: Mercenary | null = null;
  /** A hireling that has died and is still lying there. */
  private corpse: Mercenary | null = null;
  private spawnAttempted = false;
  /** Scratch list for the hireling's allies, refilled each frame. */
  private readonly allies: Player[] = [];

  constructor(
    private readonly roster: MercenaryRoster,
    levelId: string,
    private readonly isInSafeRoom: (entity: {
      readonly x: number;
      readonly y: number;
    }) => boolean = () => false,
  ) {
    roster.floorLevelId = levelId;
  }

  /** The live mercenary mob, if one is spawned — added to the scene's extra targets so hostiles engage it. */
  get activeMerc(): Mercenary | null {
    return this.merc;
  }

  update(ctx: SystemContext): void {
    const { gameMap, active } = ctx;

    this.sweepCorpse(ctx.roster.mobs, ctx.roster.grid);

    if (!this.spawnAttempted) {
      this.spawnAttempted = this.spawn(active, gameMap, ctx.roster);
    }

    const merc = this.merc;
    if (!merc?.isAlive) return;

    merc.owner = active;
    merc.cat = ctx.cat;
    merc.allMobs = ctx.roster.mobs;
    this.allies.length = 0;
    this.allies.push(ctx.human, ctx.cat);
    for (const extra of ctx.extraTargets ?? []) {
      if (extra !== merc) this.allies.push(extra);
    }
    merc.allies = this.allies;
  }

  /**
   * Death interception, called (like `MongoSystem.checkHealth`) after mob damage
   * resolution but *before* `resolveKills`. The killing blow latched `justDied`;
   * clearing it here is what keeps combat resolution from processing the
   * player's own paid ally as a slain enemy — no kill XP, kill stat, or kill
   * report. The body stays in the mob list and the grid, where the corpse
   * sweep in `resolveKills` plays out its death and fade.
   *
   * Clearing `justDied` also means `mobKilled` never fires for the merc, so
   * `spawnGore` is the only chance a figure that comes apart on death (a
   * `goreBodyPartKey` set on its art, currently just Tumbledown) gets to
   * scatter its rubble — the caller is expected to be the scene's own gore
   * spawn, not the kill-XP path.
   */
  checkHealth(spawnGore: (merc: Mercenary) => void = NO_OP_GORE): void {
    const merc = this.merc;
    if (!merc) return;
    if (merc.isAlive && merc.hp > 0) return;
    merc.justDied = false;
    merc.beginDeath();
    if (merc.bodyPartKey !== null) spawnGore(merc);
    this.corpse = merc;
    this.merc = null;
    this.roster.lastDeceased = this.roster.active?.name ?? merc.displayName;
    this.roster.active = null;
  }

  /**
   * The floor is won, and the contract signed for it is over. The hireling says
   * goodbye; it is dismissed with the rest of the scene when the party leaves.
   */
  endContractForFloor(): void {
    this.merc?.bark('floor_end');
    this.roster.active = null;
  }

  /**
   * The hireling the active crawler can talk to from where they stand, if any.
   *
   * Talking is last in the Space chain, after the attack it would otherwise
   * share a key with, and the hireling stands inside talking range most of the
   * floor. So it is refused while any hostile is within reach of the crawler's
   * longest attack or of the hireling's own engage radius: with a fight on, the
   * press is a shot, never a chat.
   */
  talkTarget(active: HumanPlayer | CatPlayer, mobs: readonly Mob[]): Mercenary | null {
    const merc = this.merc;
    if (!merc?.isAlive) return null;
    const distance = Math.hypot(merc.x - active.x, merc.y - active.y);
    if (distance > TILE_SIZE * TALK_RANGE_TILES) return null;
    const clearancePx = Math.max(active.attackReachPx(), TILE_SIZE * merc.kit.engageRadiusTiles);
    const fightOn = mobs.some(
      (mob) =>
        mob.isAlive &&
        mob.isHostile &&
        Math.hypot(mob.x - active.x, mob.y - active.y) <= clearancePx,
    );
    return fightOn ? null : merc;
  }

  /** Talks to the hireling if the active crawler is beside it and no fight is on. */
  tryTalk(active: HumanPlayer | CatPlayer, mobs: readonly Mob[]): boolean {
    const merc = this.talkTarget(active, mobs);
    if (merc === null) return false;
    merc.talkTo(active);
    return true;
  }

  /** Speech bubbles for the hireling, living or fallen. Drawn over the entities. */
  renderSpeech(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.merc?.renderSpeech(ctx, camX, camY);
    this.corpse?.renderSpeech(ctx, camX, camY);
  }

  captureCheckpoint(): MercenaryCheckpoint {
    return { merc: this.merc, spawnAttempted: this.spawnAttempted };
  }

  /**
   * Rewinds the spawn state to match the restored roster.
   *
   * A merc that died after the checkpoint cannot simply be re-referenced: its
   * body is gone from the scene or on its way out. The hire lives in the
   * roster, which is rewound separately, so the honest rewind is to forget the
   * mob entirely and let the next `update` spawn a fresh one beside the player
   * from whatever the roster now says — the same path a scene rebuild takes.
   *
   * Precondition: any merc hired *after* the checkpoint, and any body, must
   * already be off the map (`dismiss`) when this runs. No mob list reaches this
   * method, so it cannot splice one out itself, and a merc left standing while
   * the roster forgets it is an orphan following the party for free.
   */
  restoreCheckpoint(snapshot: MercenaryCheckpoint): void {
    const sameMercStillStanding =
      this.merc !== null && this.merc === snapshot.merc && this.merc.isAlive;
    if (sameMercStillStanding) {
      this.spawnAttempted = snapshot.spawnAttempted;
      return;
    }
    this.merc = null;
    this.spawnAttempted = false;
  }

  /**
   * Puts the hire on the ground behind its owner, if the contract is current.
   *
   * @returns whether spawning is settled for this scene: true once the hire
   *   stands, or when there is no current contract to stand; false when there
   *   was nowhere to put it this frame, so the next frame tries again.
   */
  private spawn(active: Player, gameMap: GameMap, roster: MobRoster): boolean {
    const hired = this.roster.active;
    if (!hired) return true;
    if (!contractIsCurrent(this.roster, hired)) {
      this.roster.active = null;
      return true;
    }

    const tile = findSpawnTile(active, gameMap);
    if (tile === null) return false;

    const merc = new Mercenary(tile.x, tile.y, TILE_SIZE, active, hired.id, hired.name);
    // The desk warms the figure when the contract is signed, but a hire loaded
    // from a save, or walking back out of a building whose visit let its idle
    // cells go, arrives here cold: every spawn warms it again. Warming only
    // the hired figure keeps the other hirelings' cells out of memory.
    MERCENARY_ART[merc.template.art].prewarm();
    merc.safeRoomTest = this.isInSafeRoom;
    this.merc = merc;
    roster.add(merc);
    if (!hired.introduced) {
      hired.introduced = true;
      merc.bark('hired');
    }
    return true;
  }

  /** Drops a body whose fade has finished out of the mob list; the grid already let it go. */
  private sweepCorpse(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const corpse = this.corpse;
    if (!corpse?.corpseExpired) return;
    removeMob(corpse, mobs, mobGrid);
    this.corpse = null;
  }

  /**
   * Despawn the merc and any body without touching the roster (interior/floor
   * transitions, rewinds, a recall warp).
   *
   * The next `update` spawns the hire afresh beside the party if its contract
   * still stands: a warp keeps the same scene, and a hire that is only
   * despawned there would be gone for the rest of it. Every other caller
   * either replaces the scene or rewinds the spawn state itself.
   */
  dismiss(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (this.merc) removeMob(this.merc, mobs, mobGrid);
    if (this.corpse) removeMob(this.corpse, mobs, mobGrid);
    this.merc = null;
    this.corpse = null;
    this.spawnAttempted = false;
  }
}

/**
 * The tile behind the owner if the hire can stand there, else the nearest one
 * it can, or null if there is none.
 *
 * The owner's tile is read from her centre: `floor(x / TILE_SIZE)` is the tile
 * under her sprite's top-left corner, which in a corridor is the masonry her
 * sprite overhangs. Candidates must be in her sight, or the ring search would
 * solve a blocked corridor by putting the hire in the room through the wall,
 * and must not be stairwells, which `isWalkable` admits but
 * `Mob.moveWithCollision` refuses to enter.
 */
function findSpawnTile(active: Player, gameMap: GameMap): { x: number; y: number } | null {
  const ownerCentreX = active.x + TILE_SIZE * TILE_CENTER;
  const ownerCentreY = active.y + TILE_SIZE * TILE_CENTER;
  const behindX = Math.floor(ownerCentreX / TILE_SIZE) - Math.round(active.facingX);
  const behindY = Math.floor(ownerCentreY / TILE_SIZE) - Math.round(active.facingY);
  const inOwnersSight = (x: number, y: number): boolean =>
    gameMap.hasLineOfSight(
      ownerCentreX,
      ownerCentreY,
      (x + TILE_CENTER) * TILE_SIZE,
      (y + TILE_CENTER) * TILE_SIZE,
    );
  return findNearbyWalkableTile(
    gameMap,
    behindX,
    behindY,
    SPAWN_SEARCH_RADIUS_TILES,
    (x, y) => inOwnersSight(x, y) && !gameMap.isStairwellTile(x, y),
  );
}

function removeMob(mob: Mob, mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
  mobGrid.remove(mob);
  const idx = mobs.indexOf(mob);
  if (idx >= 0) mobs.splice(idx, 1);
}
