import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';
import { TILE_SIZE } from './constants';

/**
 * Manages the player party (Human + Cat). Provides a unified interface for
 * accessing players, switching the active character, and querying party state.
 *
 * Systems that previously took `(human: HumanPlayer, cat: CatPlayer)` can
 * instead accept a PlayerManager and call players(), active(), etc.
 */
export class PlayerManager {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;

  constructor(spawnX: number, spawnY: number) {
    this.human = new HumanPlayer(spawnX, spawnY, TILE_SIZE);
    this.cat = new CatPlayer(spawnX + 1, spawnY, TILE_SIZE);
    this.human.isActive = true;
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
  }

  /** True if both party members are alive. */
  get bothAlive(): boolean {
    return this.human.isAlive && this.cat.isAlive;
  }

  /** True if either player is in a safe room. */
  isAnySafe(safeRoom: { isEntityInSafeRoom(p: Player): boolean }): boolean {
    return safeRoom.isEntityInSafeRoom(this.human) || safeRoom.isEntityInSafeRoom(this.cat);
  }

  /** Set spawn positions (pixel coordinates). */
  setPositions(sx: number, sy: number): void {
    this.human.x = sx * TILE_SIZE;
    this.human.y = sy * TILE_SIZE;
    this.cat.x = (sx + 1) * TILE_SIZE;
    this.cat.y = sy * TILE_SIZE;
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
