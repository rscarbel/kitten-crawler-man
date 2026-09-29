import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';
import { TILE_SIZE } from './constants';
import type { XpDiminishingTier } from '../levels/xpDiminishing';
import type { PartyArrivalTiles } from '../map/findWalkableTile';

/**
 * The player party (Human + Cat): a single handle systems can accept instead
 * of separate `human`/`cat` parameters.
 */
export class PlayerManager {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;

  /**
   * @param xpCurve The diminishing-returns curve of the floor the party is on,
   *   or `undefined` for a floor that has none. Required rather than optional
   *   so that no scene — an interior hanging off a floor included — can build
   *   a party that quietly earns XP at full rate.
   */
  constructor(spawnX: number, spawnY: number, xpCurve: readonly XpDiminishingTier[] | undefined) {
    this.human = new HumanPlayer(spawnX, spawnY, TILE_SIZE);
    this.cat = new CatPlayer(spawnX + 1, spawnY, TILE_SIZE);
    this.human.isActive = true;
    this.human.xpCurve = xpCurve;
    this.cat.xpCurve = xpCurve;
  }

  /** The currently player-controlled character. */
  active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  /** The AI-controlled companion character. */
  inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }

  /** Both players as an array (order: human, cat). */
  players(): [HumanPlayer, CatPlayer] {
    return [this.human, this.cat];
  }

  /** Swap which character is player-controlled. */
  switchActive(): void {
    this.human.isActive = !this.human.isActive;
    this.cat.isActive = !this.cat.isActive;
    // The companion AI prices its attacks off `getMeleeDamage` and closes to
    // reach, so a follower still holding the sling would walk into melee range
    // and swing a weapon it cannot swing. He puts it away when he stops driving.
    if (!this.human.isActive) this.human.wield(null);
  }

  /** True if both party members are alive. */
  get bothAlive(): boolean {
    return this.human.isAlive && this.cat.isAlive;
  }

  /** True if either player is in a safe room. */
  isAnySafe(safeRoom: { isEntityInSafeRoom(p: Player): boolean }): boolean {
    return safeRoom.isEntityInSafeRoom(this.human) || safeRoom.isEntityInSafeRoom(this.cat);
  }

  /**
   * Stands the driven crawler on `arrival.leader` and the other on
   * `arrival.follower` — tiles from `findPartyArrivalTiles`, which checks
   * both, rather than a fixed offset that can land inside a wall or a prop.
   */
  setPartyDown(arrival: PartyArrivalTiles): void {
    const driven = this.human.isActive ? this.human : this.cat;
    const other = driven === this.human ? this.cat : this.human;
    driven.x = arrival.leader.x * TILE_SIZE;
    driven.y = arrival.leader.y * TILE_SIZE;
    other.x = arrival.follower.x * TILE_SIZE;
    other.y = arrival.follower.y * TILE_SIZE;
  }

  /** Tick both players' timers (level-up flash, walk frame, status effects). */
  tickTimers(): void {
    this.human.tickTimers();
    this.cat.tickTimers();
  }

  /** Update safe-room protection flags. */
  updateProtection(safeRoom: { isEntityInSafeRoom(p: Player): boolean }): void {
    this.human.isProtected = safeRoom.isEntityInSafeRoom(this.human);
    this.cat.isProtected = safeRoom.isEntityInSafeRoom(this.cat);
  }
}
