import { TILE_SIZE, PLAYER_SPEED } from '../core/constants';
import { platform } from '../core/Platform';
import { InputManager } from '../core/InputManager';
import { normalize, clamp } from '../utils';
import { GameMap } from '../map/GameMap';
import { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';

/**
 * Named phases of the game update loop, extracted from DungeonScene.updateGameplay().
 *
 * Each phase is a pure-ish function that takes the state it needs and mutates it.
 * DungeonScene calls these in order, making the update sequence explicit and
 * each phase independently understandable.
 *
 * Phase ordering:
 *   1. readMovement     — keyboard + mobile touch → dx/dy
 *   2. applyMovement    — dx/dy + collision → new player position
 *   3. updateSafeRoom   — protection flags, safe room entry achievements
 *   4. updateSystems    — barriers, juicer room, companion, spells, etc.
 *   5. updateMobAI      — activate nearby mobs, run AI, clamp bosses
 *   6. resolveCombat    — attack hits, kills, XP split, loot drops
 *   7. postCombat       — gore, grub spawns, arena phases, Mongo
 *   8. tickTimers       — player timers, loot TTL, dynamite, level timer
 *   9. checkDeath       — game over conditions
 */

export interface MovementInput {
  dx: number;
  dy: number;
  isMobile: boolean;
}

/**
 * Phase 1: Read keyboard + mobile touch input into a normalized movement vector.
 */
export function readMovement(
  input: InputManager,
  mobileMoveTarget: { x: number; y: number } | null,
  mobileTapStart: { x: number; y: number; time: number } | null,
  player: Player,
  camera: { x: number; y: number },
): MovementInput {
  let dx = 0;
  let dy = 0;
  if (input.has('ArrowUp') || input.has('w')) dy -= 1;
  if (input.has('ArrowDown') || input.has('s')) dy += 1;
  if (input.has('ArrowLeft') || input.has('a')) dx -= 1;
  if (input.has('ArrowRight') || input.has('d')) dx += 1;

  let isMobile = false;
  const touchHoldMs = mobileTapStart ? Date.now() - mobileTapStart.time : 0;
  if (platform.isMobile && mobileMoveTarget && touchHoldMs >= 150 && dx === 0 && dy === 0) {
    const wx = mobileMoveTarget.x + camera.x;
    const wy = mobileMoveTarget.y + camera.y;
    const ddx = wx - (player.x + TILE_SIZE / 2);
    const ddy = wy - (player.y + TILE_SIZE / 2);
    const dist = Math.hypot(ddx, ddy);
    if (dist > 8) {
      dx = ddx / dist;
      dy = ddy / dist;
      isMobile = true;
    }
  }

  return { dx, dy, isMobile };
}

/**
 * Phase 2: Apply movement vector to player position with collision detection.
 */
export function applyMovement(player: Player, move: MovementInput, gameMap: GameMap): void {
  let { dx, dy } = move;
  const mapPxW = (gameMap.structure[0]?.length ?? gameMap.structure.length) * TILE_SIZE;
  const mapPxH = gameMap.structure.length * TILE_SIZE;

  player.isMoving = dx !== 0 || dy !== 0;

  if (dx !== 0 || dy !== 0) {
    const n = normalize(dx, dy);
    player.facingX = n.x;
    player.facingY = n.y;
  }

  // Mobile touch already gives a unit vector — skip diagonal penalty
  if (!move.isMobile && dx !== 0 && dy !== 0) {
    dx *= 0.7071;
    dy *= 0.7071;
  }
  dx *= PLAYER_SPEED;
  dy *= PLAYER_SPEED;

  const nextX = clamp(player.x + dx, 0, mapPxW - TILE_SIZE);
  const tileXnext =
    dx >= 0
      ? Math.floor((nextX + TILE_SIZE * 0.72) / TILE_SIZE)
      : Math.floor((nextX + TILE_SIZE * 0.28) / TILE_SIZE);
  const tileYcur = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
  if (gameMap.isWalkable(tileXnext, tileYcur)) player.x = nextX;

  const nextY = clamp(player.y + dy, 0, mapPxH - TILE_SIZE);
  const tileXcur = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
  const tileYnext = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
  if (gameMap.isWalkable(tileXcur, tileYnext)) player.y = nextY;
}

/**
 * Phase 9: Check death conditions.
 * Returns true if the game should end.
 */
export function checkDeath(
  human: HumanPlayer,
  cat: CatPlayer,
  isSafeLevel: boolean,
  levelTimerFrames: number,
): boolean {
  if (!human.isAlive || !cat.isAlive) return true;
  if (!isSafeLevel && levelTimerFrames <= 0) return true;
  return false;
}

/**
 * Update minimap fog of war reveal around the active player.
 */
export function revealMinimap(
  player: Player,
  miniMap: { revealAround(tx: number, ty: number): void; tickCorpseMarkers(): void },
): void {
  const ptx = Math.floor((player.x + TILE_SIZE * 0.5) / TILE_SIZE);
  const pty = Math.floor((player.y + TILE_SIZE * 0.5) / TILE_SIZE);
  miniMap.revealAround(ptx, pty);
  miniMap.tickCorpseMarkers();
}
