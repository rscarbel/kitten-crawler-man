import { TILE_SIZE, PLAYER_SPEED } from '../core/constants';
import { platform } from '../core/Platform';
import { type InputManager } from '../core/InputManager';
import { normalize, clamp } from '../utils';
import { type GameMap } from '../map/GameMap';
import { type Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';

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

/** 90 seconds at 60 fps — the revival window before the run ends. */
const KNOCKOUT_TIMEOUT_FRAMES = 5400;

// Mobile input constants
const MOBILE_TOUCH_MIN_HOLD_TIME = 150; // ms
const MOBILE_DISTANCE_THRESHOLD = 8; // px

// Diagonal movement penalty
const DIAGONAL_PENALTY = 0.7071; // 1/sqrt(2)

// Wall collision offsets
const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;
const CENTER_COLLISION_OFFSET = 0.5;

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
  if (
    platform.isMobile &&
    mobileMoveTarget &&
    touchHoldMs >= MOBILE_TOUCH_MIN_HOLD_TIME &&
    dx === 0 &&
    dy === 0
  ) {
    const wx = mobileMoveTarget.x + camera.x;
    const wy = mobileMoveTarget.y + camera.y;
    const ddx = wx - (player.x + TILE_SIZE / 2);
    const ddy = wy - (player.y + TILE_SIZE / 2);
    const dist = Math.hypot(ddx, ddy);
    if (dist > MOBILE_DISTANCE_THRESHOLD) {
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

  if (player.hasStatus('stuck')) {
    player.isMoving = false;
    return;
  }

  player.isMoving = dx !== 0 || dy !== 0;

  if (dx !== 0 || dy !== 0) {
    const n = normalize(dx, dy);
    player.facingX = n.x;
    player.facingY = n.y;
  }

  // Mobile touch already gives a unit vector — skip diagonal penalty
  if (!move.isMobile && dx !== 0 && dy !== 0) {
    dx *= DIAGONAL_PENALTY;
    dy *= DIAGONAL_PENALTY;
  }
  dx *= PLAYER_SPEED * player.speedMultiplier;
  dy *= PLAYER_SPEED * player.speedMultiplier;

  const nextX = clamp(player.x + dx, 0, mapPxW - TILE_SIZE);
  const tileXnext =
    dx >= 0
      ? Math.floor((nextX + TILE_SIZE * LEADING_EDGE_FRONT) / TILE_SIZE)
      : Math.floor((nextX + TILE_SIZE * LEADING_EDGE_BACK) / TILE_SIZE);
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
 *
 * Rules:
 * - Active player dying is always immediate game over.
 * - Inactive player dying enters the knocked-out state (handled in DungeonScene before this call).
 * - A knocked-out player has 90 seconds to be revived; expiry is game over.
 */
export function checkDeath(
  human: HumanPlayer,
  cat: CatPlayer,
  isSafeLevel: boolean,
  levelTimerFrames: number,
): boolean {
  // Active player death = immediate game over
  if (human.isActive && !human.isAlive) return true;
  if (cat.isActive && !cat.isAlive) return true;
  // Inactive player died without being caught by the knockout handler = game over
  if (!human.isActive && !human.isAlive && !human.isKnockedOut) return true;
  if (!cat.isActive && !cat.isAlive && !cat.isKnockedOut) return true;
  // Knocked-out timer expired
  if (human.isKnockedOut && human.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) return true;
  if (cat.isKnockedOut && cat.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) return true;
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
  const ptx = Math.floor((player.x + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  const pty = Math.floor((player.y + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  miniMap.revealAround(ptx, pty);
  miniMap.tickCorpseMarkers();
}
