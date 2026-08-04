import { TILE_SIZE, PLAYER_SPEED, WADE_SPEED_FACTOR } from '../core/constants';
import { platform } from '../core/Platform';
import { type InputManager } from '../core/InputManager';
import { normalize, clamp } from '../utils';
import { type GameMap } from '../map/GameMap';
import { CENTER_COLLISION_OFFSET, SOLE_COLLISION_OFFSET } from '../map/collisionAnchors';
import { type Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { AudioManager } from '../audio/AudioManager';
import { applyDrunkWalkWobble } from '../core/DrunkEffect';
import { frameTime } from '../utils';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { DarkKnight } from '../creatures/DarkKnight';

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
 *   8. tickTimers       — player timers, loot TTL, dynamite, smush blasts, level timer
 *   9. checkDeath       — game over conditions
 */

/** 90 seconds at 60 fps — the revival window before the run ends. */
export const KNOCKOUT_TIMEOUT_FRAMES = 5400;

// Mobile input constants
const MOBILE_TOUCH_MIN_HOLD_TIME = 150; // ms
const MOBILE_DISTANCE_THRESHOLD = 8; // px

// Diagonal movement penalty
const DIAGONAL_PENALTY = 0.7071; // 1/sqrt(2)

// Wall collision offsets
const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;
/**
 * Which part of the player is tested against walls when walking south.
 * `waist` is the long-standing behaviour; `sole` keeps feet off wall tiles and
 * is what building interiors use.
 */
export type SouthCollisionAnchor = 'waist' | 'sole';

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
 * The speed multiplier for the tile a player is *standing on*, not the one they
 * are stepping into.
 *
 * Reading the destination instead would brake a step early on the bank and
 * accelerate one step early on the way out, so the slowdown would not line up
 * with the splash or with the sprite sinking. Tested on the tile under the
 * player's centre, the same point the renderer uses to decide they are wading.
 */
function wadeSpeedFactor(player: Player, gameMap: GameMap): number {
  return isStandingInWater(player, gameMap) ? WADE_SPEED_FACTOR : 1;
}

/**
 * Whether a player's footing is river water.
 *
 * The single definition of "in the water", shared by the movement slowdown, the
 * submerged rendering and the splash effects, so the three cannot disagree about
 * where the bank is. It reads the tile under the player's centre rather than
 * their soles: the soles sit at the very bottom of the sprite box and would
 * report water for a frame while the body still visibly stands on the bank.
 *
 * A `BRIDGE` tile is its own type and is not water, so crossing a bridge is dry
 * and full speed — which is the whole point of a bridge.
 */
export function isStandingInWater(player: Player, gameMap: GameMap): boolean {
  const tileX = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
  const tileY = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
  return gameMap.isWadeable(tileX, tileY);
}

/**
 * Phase 2: Apply movement vector to player position with collision detection.
 */
export function applyMovement(
  player: Player,
  move: MovementInput,
  gameMap: GameMap,
  southAnchor: SouthCollisionAnchor = 'waist',
): void {
  let { dx, dy } = move;
  const mapPxW = (gameMap.structure[0]?.length ?? gameMap.structure.length) * TILE_SIZE;
  const mapPxH = gameMap.structure.length * TILE_SIZE;

  if (player.hasStatus('stuck')) {
    player.isMoving = false;
    return;
  }

  player.isMoving = dx !== 0 || dy !== 0;

  if (player.hasStatus('drunk')) {
    const wobbled = applyDrunkWalkWobble(dx, dy, frameTime);
    dx = wobbled.dx;
    dy = wobbled.dy;
  }

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
  dx *= PLAYER_SPEED * player.speedMultiplier * wadeSpeedFactor(player, gameMap);
  dy *= PLAYER_SPEED * player.speedMultiplier * wadeSpeedFactor(player, gameMap);

  const nextX = clamp(player.x + dx, 0, mapPxW - TILE_SIZE);
  const tileXnext =
    dx >= 0
      ? Math.floor((nextX + TILE_SIZE * LEADING_EDGE_FRONT) / TILE_SIZE)
      : Math.floor((nextX + TILE_SIZE * LEADING_EDGE_BACK) / TILE_SIZE);
  const tileYcur = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
  if (gameMap.isWalkable(tileXnext, tileYcur)) player.x = nextX;

  const nextY = clamp(player.y + dy, 0, mapPxH - TILE_SIZE);
  const tileXcur = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
  // Only the southward step moves its test point down the sprite: walking north
  // has the player's head, not their feet, leading into the wall, and testing
  // the soles there would let them back into tiles they can't stand on.
  const yAnchor =
    southAnchor === 'sole' && dy > 0 ? SOLE_COLLISION_OFFSET : CENTER_COLLISION_OFFSET;
  const tileYnext = Math.floor((nextY + TILE_SIZE * yAnchor) / TILE_SIZE);
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
  hasCollapseTimer: boolean,
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
  if (hasCollapseTimer && levelTimerFrames <= 0) return true;
  return false;
}

/** Melee reach of the human player, in tiles. */
export const HUMAN_ATTACK_RANGE_TILES = 3;
/** Attack reach of the cat player (missiles included), in tiles. */
export const CAT_ATTACK_RANGE_TILES = 5;
/** Minimum facing-direction dot product for a mob to count as "in front". */
const SNAP_DOT_PRODUCT_THRESHOLD = 0.25;
const SNAP_TILE_CENTER_OFFSET = 0.5;

/**
 * Rotate the player to face the nearest live mob in their front cone with
 * line of sight, within `range` pixels. No-op when nothing qualifies.
 */
export function snapFacingToNearestMob(
  player: HumanPlayer | CatPlayer,
  range: number,
  mobGrid: SpatialGrid<Mob>,
  gameMap: GameMap,
): void {
  const px = player.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET;
  const py = player.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET;
  let bestDist = range;
  let bestMob: Mob | null = null;
  const nearPlayer = mobGrid.queryCircle(px, py, range);
  for (const mob of nearPlayer) {
    if (!mob.isAlive) continue;
    const dx = mob.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - px;
    const dy = mob.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - py;
    const dist = Math.hypot(dx, dy);
    if (dist > range || dist === 0) continue;
    const dot = (dx / dist) * player.facingX + (dy / dist) * player.facingY;
    if (dot < SNAP_DOT_PRODUCT_THRESHOLD) continue;
    if (
      !gameMap.hasLineOfSight(
        px,
        py,
        mob.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET,
        mob.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET,
      )
    )
      continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestMob = mob;
    }
  }
  if (bestMob) {
    const dx = bestMob.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - px;
    const dy = bestMob.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - py;
    const n = normalize(dx, dy);
    player.facingX = n.x;
    player.facingY = n.y;
  }
}

/**
 * Aim the active player at the nearest mob and start their attack — the cat
 * prefers a magic missile when the tome is on the action bar. Shared by
 * DungeonScene's space action and interior-scene combat.
 */
export function triggerPlayerAttack(
  human: HumanPlayer,
  cat: CatPlayer,
  mobGrid: SpatialGrid<Mob>,
  gameMap: GameMap,
  audio: AudioManager | null,
): void {
  if (human.isActive) {
    snapFacingToNearestMob(human, TILE_SIZE * HUMAN_ATTACK_RANGE_TILES, mobGrid, gameMap);
    human.triggerAttack();
  } else {
    snapFacingToNearestMob(cat, TILE_SIZE * CAT_ATTACK_RANGE_TILES, mobGrid, gameMap);
    const hasMissileTome = cat.inventory.actionBar.slots.some(
      (s) => s?.abilityId === 'magic_missile',
    );
    if (hasMissileTome && cat.triggerMissile()) {
      audio?.play('cat_missile_fire');
    } else {
      cat.triggerAttack();
    }
  }
}

/**
 * Play queued per-mob combat audio cues (attack + projectile), keyed by each
 * mob's audioTag. Shared by DungeonScene and interior combat scenes; clears
 * the pending flags even when audio is unavailable so cues never backlog.
 */
export function playMobAudioCues(mobs: Mob[], audio: AudioManager | null): void {
  for (const mob of mobs) {
    if (mob.attackSoundPending) {
      mob.attackSoundPending = false;
      switch (mob.audioTag) {
        case 'goblin':
          audio?.playRandom(['goblin_1', 'goblin_2']);
          break;
        case 'rat':
          audio?.playRandom(['rat_squeak_1', 'rat_squeak_2', 'rat_squeak_3']);
          break;
        case 'troglodyte':
          audio?.play('troglodyte_tongue');
          break;
        case 'tuskling':
          audio?.playRandom([
            'tuskling_grunt_1',
            'tuskling_grunt_2',
            'tuskling_grunt_3',
            'tuskling_grunt_4',
          ]);
          break;
        case 'skyfowl':
          audio?.playRandom(['skyfowl_1', 'skyfowl_2']);
          break;
        case 'mongo':
          // One cue for all three of his attacks. `mongo_released` is the summon
          // roar, not a chomp, so branching on the one-shot would only mean the
          // bite plays a wrong sound instead of a generic one — a bite chomp and
          // a pounce screech are a [HUMAN] item in docs/mongo-redesign-plan.md §11.
          audio?.play('mongo_slash');
          break;
        case 'mercenary':
          audio?.play('sword_attack_1');
          break;
        // [STAND-IN] No insect audio has been sourced yet; the raptorial strike
        // borrows the sharpest blade cue in the library. See docs/bounty/03-mantid.md.
        case 'mantis':
        case 'mantid':
          audio?.play('sword_attack_1');
          break;
        case 'krakaren':
          audio?.play('krakaren_ground_slam');
          break;
        // [STAND-IN] No stone-on-stone slam or stomp has been sourced yet; the
        // Krakaren's ground slam is the heaviest earth impact in the library and
        // covers both the double-fist slam and the stomp.
        // See docs/bounty/07-rock-golem.md.
        case 'rock_golem':
          audio?.play('krakaren_ground_slam');
          break;
        case 'lemur':
          audio?.play('circus_lemur_attack');
          break;
        case 'clown':
          audio?.playRandom(['clown_laughing_1', 'clown_laughing_2', 'clown_horn', 'clown_burp']);
          break;
        // Stand-ins until the Evil Clown's own audio is sourced: the horn is the
        // closest thing to the whoomph of a backhand this troupe already owns.
        case 'evil_clown':
          audio?.play('clown_horn');
          break;
        case 'krasue':
          audio?.play('krasue_attack');
          break;
        // Stand-in: `hammer_strike` is the closest thing in the library to a
        // gauntlet thud. Replace with `dark_knight_punch` if Ryan sources one.
        case 'dark_knight':
          audio?.play('hammer_strike');
          break;
        // [STAND-IN] A rusty blade whoosh has not been sourced yet; the human
        // sword swing is the closest thing in the library.
        case 'skeleton':
          audio?.play('sword_attack_1');
          break;
        case 'bear':
          audio?.play('bear_big_attack');
          break;
        case 'grimaldi':
          audio?.playRandom([
            'grimaldi_plant_moving_1',
            'grimaldi_plant_moving_2',
            'grimaldi_plant_moving_3',
          ]);
          break;
      }
    }
    if (mob.projectileSoundPending) {
      mob.projectileSoundPending = false;
      if (mob.audioTag === 'llama') audio?.play('llama_fireball');
      if (mob.audioTag === 'lemur') audio?.play('circus_lemur_sound');
      // [STAND-IN] No bow creak-and-twang and no whispered incantation exist in
      // the library yet: the wood snap stands in for the stave, and the cat's
      // magic-missile launch for the soul bolt leaving the palm.
      if (mob.audioTag === 'skeleton') audio?.play('wood_breaking_3');
      // Only the archer among the goblins ever queues one of these — the melee
      // archetypes have nothing to throw.
      if (mob.audioTag === 'goblin') audio?.play('wood_breaking_3');
      if (mob.audioTag === 'skeleton_lord') audio?.play('cat_missile_fire');
      if (mob.audioTag === 'evil_clown') audio?.play('juicer_throw');
      // [STAND-IN] An effortful heave has not been sourced; the Juicer's throw
      // is the library's only two-handed hurl.
      if (mob.audioTag === 'rock_golem') audio?.play('juicer_throw');
    }
    if (mob.damageSoundPending) {
      // Only tags handled here consume the flag.
      switch (mob.audioTag) {
        case 'grimaldi':
          mob.damageSoundPending = false;
          audio?.play('grimaldi_vine_taking_damage');
          break;
        case 'bear':
          mob.damageSoundPending = false;
          audio?.play('bear_growl_1');
          break;
        case 'hoarder':
          mob.damageSoundPending = false;
          audio?.playRandom(['hoarder_damage_1', 'hoarder_damage_2', 'hoarder_damage_3']);
          break;
        // [STAND-IN] Dry bone rattle, not yet sourced. Snapping wood is the
        // nearest dry clatter the library has.
        case 'skeleton':
        case 'skeleton_lord':
          mob.damageSoundPending = false;
          audio?.playRandom(['wood_breaking_1', 'wood_breaking_2']);
          break;
        // [STAND-IN] The golem uses this flag for the dazed groan after a
        // barrier interrupts its roll, not for taking a hit. No cracked stone
        // groan has been sourced; the bear's growl is the nearest heavy grunt.
        case 'rock_golem':
          mob.damageSoundPending = false;
          audio?.play('bear_growl_1');
          break;
      }
    }
    if (mob.specialSoundPending) {
      mob.specialSoundPending = false;
      switch (mob.audioTag) {
        case 'hoarder':
          audio?.play('hoarder_vomit');
          break;
        case 'juicer':
          audio?.play('juicer_throw');
          break;
        case 'ball_of_swine':
          audio?.play('ball_of_swine_rolling');
          break;
        // [STAND-IN] Auditioned per the plan and kept: the Ball of Swine's roll
        // is already a stone-heavy rumble, and the golem's curl, roll start and
        // uncurl all read against it. See docs/bounty/07-rock-golem.md.
        case 'rock_golem':
          audio?.play('ball_of_swine_rolling');
          break;
        case 'krakaren':
          audio?.play('krakaren_yell');
          break;
        // [STAND-IN] The rage pause wants a rising insectoid shriek; the spider's
        // screech is the only shriek in the library. See docs/bounty/03-mantid.md.
        case 'mantid':
          audio?.play('grotesque_spider_screech_attack');
          break;
        // The laugh that tells the party the vials are coming. A stand-in until
        // a slow distorted clown laugh is sourced.
        case 'evil_clown':
          audio?.playRandom(['clown_laughing_1', 'clown_laughing_2']);
          break;
        // The lord has two specials and `specialSoundPending` is one flag, so
        // which cue to play comes off the boss itself.
        // [STAND-IN] Neither "earth cracking under many dry scrapes" nor a
        // rising choral moan has been sourced; the Krakaren's ground slam and
        // its yell are the closest in kind.
        case 'skeleton_lord':
          audio?.play(
            mob instanceof SkeletonLord && mob.lastSpecial === 'summon'
              ? 'krakaren_yell'
              : 'krakaren_ground_slam',
          );
          break;
      }
    }
    playDarkKnightCues(mob, audio);
  }
}

/**
 * The Dark Knight's three extra cues.
 *
 * They are separate flags rather than more `specialSoundPending` arms because
 * he fires two of them within a second of each other — the whirl as the sweep
 * winds up and the hit as it lands — and one shared flag can only carry one.
 *
 * Every id here is a **stand-in** for a sound Ryan has not sourced yet; the
 * substitutions are recorded in `docs/bounty/05-dark-knight.md`.
 */
function playDarkKnightCues(mob: Mob, audio: AudioManager | null): void {
  if (!(mob instanceof DarkKnight)) return;
  if (mob.whirlSoundPending) {
    mob.whirlSoundPending = false;
    audio?.play('rumble');
  }
  if (mob.slamSoundPending) {
    mob.slamSoundPending = false;
    audio?.play('krakaren_ground_slam');
  }
  if (mob.sweepHitSoundPending) {
    mob.sweepHitSoundPending = false;
    audio?.play('grotesque_spider_slam_attack');
  }
  if (mob.castSoundPending) {
    mob.castSoundPending = false;
    audio?.play('cat_missile_fire');
  }
  if (mob.overheatSoundPending) {
    mob.overheatSoundPending = false;
    // Deliberately silent. The overheat wants a cooling hiss and the library has
    // nothing close — every candidate (a fireball, an error beep) would say the
    // wrong thing about a window the player is meant to read as *their* opening.
    // The flag is drained here so the cue can be added in one line later.
  }
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
