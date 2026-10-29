import { TILE_SIZE, PLAYER_SPEED, WADE_SPEED_FACTOR } from '../core/constants';
import { handWeaponSoundsOf } from '../audio/weaponSoundCues';
import { platform } from '../core/input/Platform';
import { type InputManager } from '../core/input/InputManager';
import { keybindings } from '../core/input/Keybindings';
import { normalize, clamp } from '../utils';
import { type GameMap } from '../map/GameMap';
import {
  CENTER_COLLISION_OFFSET,
  SOLE_COLLISION_OFFSET,
  tileUnderFeet,
} from '../map/collisionAnchors';
import { tileSpeedFactor } from '../map/tileSpeed';
import { type Player } from '../Player';
import { pushPlayerWithCollision } from './playerDisplacement';
import { DIAGONAL_PENALTY } from './PlayerMovementSystem';
import { knockbackStepPx } from '../core/combat/knockbackEase';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { AudioManager, PlacedCuePlayer, PlacedReach } from '../audio/AudioManager';
import { ELECTRIFIED_JOLT_SOUNDS, type SoundId } from '../audio/sounds';
import { FLOODED_PUMP_ROOM_CUES } from './bossRooms/floodedPumpRoom/floodedPumpRoomSoundCues';
import { applyIntoxicatedWalkWobble, intoxicationOf } from '../core/combat/Intoxication';
import { frameTime } from '../utils';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { TheLich } from '../creatures/TheLich';
import { DarkKnight } from '../creatures/DarkKnight';
import { BigRooster } from '../creatures/BigRooster';
import { RoosterMinion } from '../creatures/RoosterMinion';
import { TrashGremlin } from '../creatures/TrashGremlin';
import type { RoosterSoundCue } from '../creatures/creatureSoundCues';
import type { RoosterBuild } from '../sprites/roosterSprite';
import {
  ELECTRIC_GOBLIN_CUES,
  ROOSTER_CUES,
  ROOSTER_STEP_VOLUME,
  TRASH_GREMLIN_CUES,
} from './bossSoundCues';
import { ElectricGoblin } from '../creatures/ElectricGoblin';
import { Mantid } from '../creatures/Mantid';
import { AttackCow } from '../creatures/AttackCow';
import { Cow, type CowVoice } from '../creatures/Cow';
import { FuzzyNightmare, type FuzzyNightmareVoice } from '../creatures/FuzzyNightmare';
import { Deinonychus } from '../creatures/Deinonychus';
import { mobVoiceTakes } from './mobVoices';
import { Kraken } from '../creatures/Kraken';
import { KrakenTentacle } from '../creatures/KrakenTentacle';
import { playFairyCastCues } from './fairyAudioCues';
import { playUndeadCues } from './undeadAudioCues';
import { GoblinBomber } from '../creatures/GoblinBomber';
import { getWorldZoom } from '../core/rendering/Viewport';
import {
  BOMBER_GOBLIN_CUES,
  BOMBER_SOUND_CUE_PLAYS,
  CueGap,
  PACK_CACKLE_GAP_S,
} from './bomberGoblinSoundCues';

/**
 * Named phases of the game update loop, extracted from DungeonScene.updateGameplay().
 *
 * Each phase is a pure-ish function that takes the state it needs and mutates it.
 * DungeonScene calls these in order, making the update sequence explicit and
 * each phase independently understandable.
 *
 * Phase ordering:
 *   1. readMovement          — keyboard + mobile touch → dx/dy
 *   2. applyMovement         — dx/dy + collision → new player position
 *   3. applyKnockbackMotion  — hit-driven displacement, on top of applyMovement's result
 *   4. updateSafeRoom        — protection flags, safe room entry achievements
 *   5. updateSystems         — barriers, gym room, companion, spells, etc.
 *   6. updateMobAI           — activate nearby mobs, run AI, clamp bosses
 *   7. resolveCombat         — attack hits, kills, XP split, loot drops
 *   8. postCombat            — gore, larva spawns, Deinonychus
 *   9. tickTimers            — player timers, loot TTL, dynamite, seismic stomp blasts, level timer
 *   10. checkDeath           — game over conditions
 */

/** 90 seconds at 60 fps — the revival window before the run ends. */
export const KNOCKOUT_TIMEOUT_FRAMES = 5400;

// Mobile input constants
const MOBILE_TOUCH_MIN_HOLD_TIME = 150; // ms
const MOBILE_DISTANCE_THRESHOLD = 8; // px

const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;
/**
 * How close to a structure frame's corner a refused step may be and still be
 * eased around it, in tiles. The bare strips beside a trebuchet's frame are
 * narrower than a tile, so lining up with one exactly would be fiddly.
 */
const STRUCTURE_CORNER_SLIDE_TILES = 0.35;
/** Carries a corner slide one pixel past a frame's top or left edge, which count as inside it. */
const CORNER_SLIDE_CLEARANCE_PX = 1;
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
  if (keybindings.isHeld(input, 'moveUp')) dy -= 1;
  if (keybindings.isHeld(input, 'moveDown')) dy += 1;
  if (keybindings.isHeld(input, 'moveLeft')) dx -= 1;
  if (keybindings.isHeld(input, 'moveRight')) dx += 1;

  let isMobile = false;
  const touchHoldMs = mobileTapStart ? Date.now() - mobileTapStart.time : 0;
  if (
    platform.isMobile &&
    mobileMoveTarget &&
    touchHoldMs >= MOBILE_TOUCH_MIN_HOLD_TIME &&
    dx === 0 &&
    dy === 0
  ) {
    const zoom = getWorldZoom();
    const wx = mobileMoveTarget.x / zoom + camera.x;
    const wy = mobileMoveTarget.y / zoom + camera.y;
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
 * with the splash or with the sprite sinking. Read at the same feet tile as
 * {@link isStandingInWater}, the test the renderer uses.
 */
export function footingSpeedFactor(player: Player, gameMap: GameMap): number {
  const riverFactor = isStandingInWater(player, gameMap) ? WADE_SPEED_FACTOR : 1;
  const { x: tileX, y: tileY } = tileUnderFeet(player, TILE_SIZE);
  const insideMap =
    tileY >= 0 &&
    tileY < gameMap.structure.length &&
    tileX >= 0 &&
    tileX < gameMap.structure[tileY].length;
  const groundFactor = insideMap ? tileSpeedFactor(gameMap.structure[tileY][tileX].type) : 1;
  return riverFactor * groundFactor;
}

/**
 * Whether a player's footing is river water.
 *
 * The single definition of "in the water", shared by the movement slowdown, the
 * submerged rendering and the splash effects, so the three cannot disagree about
 * where the bank is. The waterline is cut from the bottom of the sprite box, so
 * the test is taken where the feet are drawn ({@link tileUnderFeet}): a body
 * reads as wading exactly when its drawn feet stand on water.
 *
 * A `BRIDGE` tile is its own type and is not water, so crossing a bridge is dry
 * and full speed — which is the whole point of a bridge.
 */
export function isStandingInWater(player: Player, gameMap: GameMap): boolean {
  const feet = tileUnderFeet(player, TILE_SIZE);
  return gameMap.isWadeable(feet.x, feet.y);
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

  if (player.hasStatus('stuck') || !player.canAct) {
    player.isMoving = false;
    return;
  }

  player.isMoving = dx !== 0 || dy !== 0;

  const intoxication = intoxicationOf(player);
  if (intoxication !== null) {
    const wobbled = applyIntoxicatedWalkWobble(intoxication, dx, dy, frameTime);
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
  const speed = PLAYER_SPEED * player.speedMultiplier * footingSpeedFactor(player, gameMap);
  dx *= speed;
  dy *= speed;

  const clampX = (x: number): number => clamp(x, 0, mapPxW - TILE_SIZE);
  const clampY = (y: number): number => clamp(y, 0, mapPxH - TILE_SIZE);

  const nextX = clampX(player.x + dx);
  if (!tryStepX(player, gameMap, nextX, dx)) {
    const probeX = leadingEdgeX(nextX, dx);
    const rowY = player.y + TILE_SIZE * CENTER_COLLISION_OFFSET;
    const frame = gameMap.structureRectAt(probeX, rowY);
    const slideY = frame === null ? 0 : cornerSlide(rowY, frame.top, frame.bottom, dy, speed);
    if (slideY !== 0) tryStepY(player, gameMap, clampY(player.y + slideY), slideY, southAnchor);
  }

  const nextY = clampY(player.y + dy);
  if (!tryStepY(player, gameMap, nextY, dy, southAnchor)) {
    const columnX = player.x + TILE_SIZE * CENTER_COLLISION_OFFSET;
    const probeY = nextY + TILE_SIZE * verticalAnchor(dy, southAnchor);
    const frame = gameMap.structureRectAt(columnX, probeY);
    const slideX = frame === null ? 0 : cornerSlide(columnX, frame.left, frame.right, dx, speed);
    if (slideX !== 0) tryStepX(player, gameMap, clampX(player.x + slideX), slideX);
  }
}

function leadingEdgeX(x: number, dx: number): number {
  return x + TILE_SIZE * (dx >= 0 ? LEADING_EDGE_FRONT : LEADING_EDGE_BACK);
}

function verticalAnchor(dy: number, southAnchor: SouthCollisionAnchor): number {
  // Only the southward step moves its test point down the sprite: walking north
  // has the player's head, not their feet, leading into the wall, and testing
  // the soles there would let them back into tiles they can't stand on.
  return southAnchor === 'sole' && dy > 0 ? SOLE_COLLISION_OFFSET : CENTER_COLLISION_OFFSET;
}

function tryStepX(player: Player, gameMap: GameMap, nextX: number, dx: number): boolean {
  const rowY = player.y + TILE_SIZE * CENTER_COLLISION_OFFSET;
  if (!gameMap.isCrawlerWalkableAt(leadingEdgeX(nextX, dx), rowY)) return false;
  player.x = nextX;
  return true;
}

function tryStepY(
  player: Player,
  gameMap: GameMap,
  nextY: number,
  dy: number,
  southAnchor: SouthCollisionAnchor,
): boolean {
  const columnX = player.x + TILE_SIZE * CENTER_COLLISION_OFFSET;
  const probeY = nextY + TILE_SIZE * verticalAnchor(dy, southAnchor);
  if (!gameMap.isCrawlerWalkableAt(columnX, probeY)) return false;
  player.y = nextY;
  return true;
}

/**
 * How far to ease a crawler along the axis perpendicular to a step a structure
 * frame refused, so it rounds the frame's nearer corner: zero when the probe is
 * not near a corner, or when the crawler is pushing the other way.
 */
function cornerSlide(
  probe: number,
  frameStart: number,
  frameEnd: number,
  perpendicularInput: number,
  speed: number,
): number {
  const toStart = probe - frameStart + CORNER_SLIDE_CLEARANCE_PX;
  const toEnd = frameEnd - probe;
  const slideReachPx = STRUCTURE_CORNER_SLIDE_TILES * TILE_SIZE;
  const towardStart = toStart <= toEnd;
  const distance = towardStart ? toStart : toEnd;
  if (distance > slideReachPx) return 0;
  const direction = towardStart ? -1 : 1;
  if (perpendicularInput * direction < 0) return 0;
  return direction * Math.min(Math.abs(speed), distance);
}

/**
 * Phase 3: Advance an in-progress knockback by one frame, on top of whatever
 * `applyMovement` already did this frame.
 *
 * Eased out by {@link knockbackStepPx}, which mobs share. Distinct from
 * `applyMovement`'s walk input, this is physical displacement and runs even
 * while the player `hasStatus('stuck')` or is frozen.
 */
export function applyKnockbackMotion(player: Player, gameMap: GameMap): void {
  if (player.knockbackFramesRemaining <= 0) return;

  const stepDistance = knockbackStepPx(player, TILE_SIZE);

  pushPlayerWithCollision(
    player,
    player.knockbackDirX * stepDistance,
    player.knockbackDirY * stepDistance,
    gameMap,
  );

  player.knockbackFramesRemaining--;
  if (player.knockbackFramesRemaining <= 0) player.clearKnockback();
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
export function checkDeath(human: HumanPlayer, cat: CatPlayer): boolean {
  // Active player death = immediate game over
  if (human.isActive && !human.isAlive) return true;
  if (cat.isActive && !cat.isAlive) return true;
  // Inactive player died without being caught by the knockout handler = game over
  if (!human.isActive && !human.isAlive && !human.isKnockedOut) return true;
  if (!cat.isActive && !cat.isAlive && !cat.isKnockedOut) return true;
  // Knocked-out timer expired
  if (human.isKnockedOut && human.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) return true;
  if (cat.isKnockedOut && cat.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) return true;
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
 * The hostile the attack's aim snap would turn to for `player` facing
 * (`facingX`, `facingY`): the nearest one in range, in sight, and inside the
 * snap cone. Shared with anything that must know where a press would really
 * aim before letting it through — a tap on a cow aims at the cow unless this
 * finds a hostile to turn to instead.
 */
export function snapTargetAlong(
  player: HumanPlayer | CatPlayer,
  facingX: number,
  facingY: number,
  range: number,
  mobGrid: SpatialGrid<Mob>,
  gameMap: GameMap,
): Mob | null {
  const px = player.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET;
  const py = player.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET;
  let bestDist = range;
  let bestMob: Mob | null = null;
  const nearPlayer = mobGrid.queryCircle(px, py, range);
  for (const mob of nearPlayer) {
    // Allies share the mob grid: turning to swing at a companion is a miss at
    // best, and a blow thrown at the one enemy beside it goes the wrong way.
    if (!mob.isHostileTarget) continue;
    const dx = mob.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - px;
    const dy = mob.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - py;
    const dist = Math.hypot(dx, dy);
    if (dist > range || dist === 0) continue;
    const dot = (dx / dist) * facingX + (dy / dist) * facingY;
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
  return bestMob;
}

/**
 * Rotate the player to face the nearest live hostile mob in their front cone
 * with line of sight, within `range` pixels, and return it. No-op returning null
 * when nothing qualifies.
 */
export function snapFacingToNearestMob(
  player: HumanPlayer | CatPlayer,
  range: number,
  mobGrid: SpatialGrid<Mob>,
  gameMap: GameMap,
): Mob | null {
  const px = player.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET;
  const py = player.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET;
  const bestMob = snapTargetAlong(player, player.facingX, player.facingY, range, mobGrid, gameMap);
  if (bestMob) {
    const dx = bestMob.x + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - px;
    const dy = bestMob.y + TILE_SIZE * SNAP_TILE_CENTER_OFFSET - py;
    const n = normalize(dx, dy);
    player.facingX = n.x;
    player.facingY = n.y;
  }
  return bestMob;
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
  // Refused before the facing snap, which would otherwise turn an encased
  // crawler toward the nearest mob.
  const attacker = human.isActive ? human : cat;
  if (!attacker.canAct) return;
  if (human.isActive) {
    const target = snapFacingToNearestMob(
      human,
      TILE_SIZE * HUMAN_ATTACK_RANGE_TILES,
      mobGrid,
      gameMap,
    );
    human.triggerAttack(target);
    if (human.pendingSlingshotFireSound) {
      human.pendingSlingshotFireSound = false;
      const slingId = human.mainHandWeaponId;
      const sling = slingId === null ? null : handWeaponSoundsOf(slingId);
      audio?.playRandom(sling?.swing.takes ?? []);
    }
  } else {
    snapFacingToNearestMob(cat, TILE_SIZE * CAT_ATTACK_RANGE_TILES, mobGrid, gameMap);
    if (cat.isMissileSlotted && cat.triggerMissile()) {
      audio?.play('cat_missile_fire');
    } else {
      cat.triggerAttack();
    }
  }
}

/**
 * The cue for a mob turning a blow aside. A stand-in from the `universal` SFX
 * group, so it is loaded on every floor a guarding mob can spawn on.
 */
const GUARD_SOUND = 'hammer_strike' satisfies SoundId;
/** A mob's cues come from the middle of its tile. */
const MOB_CENTRE_FRACTION = 0.5;
/**
 * A boss's cues carry the fight: its telegraphs must be heard from anywhere in
 * its arena, which is wider than ordinary hearing, so they keep their side but
 * not their distance. Whether a mob is a boss to the player is the kill tally's
 * rule, which also covers the bosses that have no boss room.
 */
const BOSS_CUE_REACH = 'panOnly' as const satisfies PlacedReach;

/** Shared by every bomber on the floor, so a pack lighting together gives one cackle. */
const packCackleGap = new CueGap(PACK_CACKLE_GAP_S);

/**
 * Play queued per-mob combat audio cues (attack + projectile), keyed by each
 * mob's audioTag, each from where the mob stands. Shared by DungeonScene
 * and interior combat scenes; clears
 * the pending flags even when audio is unavailable, or the creature is not
 * one the audio manager hears right now, so cues never backlog.
 */
export function playMobAudioCues(mobs: Mob[], audio: AudioManager | null): void {
  for (const mob of mobs) {
    const heard = audio?.hearsCreature(mob) === true;
    const voice = heard
      ? audio.placedAt(
          mob.x + TILE_SIZE * MOB_CENTRE_FRACTION,
          mob.y + TILE_SIZE * MOB_CENTRE_FRACTION,
          mob.countsAsBossKill ? BOSS_CUE_REACH : 'hearing',
        )
      : null;
    playCuesOf(mob, voice);
    playBomberGoblinCues(mob, voice, audio?.clockSeconds ?? 0);
    if (mob.seizureJoltSoundPending) {
      mob.seizureJoltSoundPending = false;
      voice?.playRandom(ELECTRIFIED_JOLT_SOUNDS);
    }
    // The damage cue only takes the flag down for voices that have one; a
    // creature silenced now must not bring an old cue with it once heard.
    if (!heard) mob.damageSoundPending = false;
  }
}

/**
 * The jolt of a crawler's electrified seizure, at the crawler. Every scene the
 * crawlers fight in drains it each frame, so a jolt raised in one never waits
 * to sound in the next.
 */
export function playCrawlerSeizureJolts(
  crawlers: readonly Player[],
  audio: AudioManager | null,
): void {
  for (const crawler of crawlers) {
    if (!crawler.seizureJoltSoundPending) continue;
    crawler.seizureJoltSoundPending = false;
    audio?.playRandomAt(ELECTRIFIED_JOLT_SOUNDS, crawler.x, crawler.y);
  }
}

/**
 * One take as a plain play, several as a random pick, so a single-take cue
 * never enters the fresh-take bookkeeping of a set it happens to start.
 */
function playTakes(takes: readonly SoundId[], audio: PlacedCuePlayer | null): void {
  if (takes.length === 0) return;
  if (takes.length === 1) audio?.play(takes[0]);
  else audio?.playRandom(takes);
}

function playCuesOf(mob: Mob, audio: PlacedCuePlayer | null): void {
  // Outside the voice table: a guard is the same metal-on-metal beat on every
  // creature that can raise one, whatever voice it has.
  if (mob.guardSoundPending) {
    mob.guardSoundPending = false;
    audio?.play(GUARD_SOUND);
  }
  if (mob instanceof Deinonychus && mob.targetChitterPending) {
    mob.targetChitterPending = false;
    audio?.play('deinonychus_chitter');
  }
  if (mob.attackSoundPending) {
    mob.attackSoundPending = false;
    playTakes(mobVoiceTakes(mob, 'attack'), audio);
  }
  if (mob.projectileSoundPending) {
    mob.projectileSoundPending = false;
    playTakes(mobVoiceTakes(mob, 'projectile'), audio);
  }
  if (mob.damageSoundPending) {
    // Only a voice with a hurt cue takes the flag down.
    const hurtTakes = mobVoiceTakes(mob, 'damage');
    if (hurtTakes.length > 0) {
      mob.damageSoundPending = false;
      playTakes(hurtTakes, audio);
    }
  }
  if (mob.specialSoundPending) {
    mob.specialSoundPending = false;
    playTakes(mobVoiceTakes(mob, 'special'), audio);
  }
  playMantidHiss(mob, audio);
  playCowVoice(mob, audio);
  playFuzzyNightmareVoice(mob, audio);
  playAttackCowCues(mob, audio);
  playCastWindup(mob, audio);
  playDarkKnightCues(mob, audio);
  playBigRoosterCues(mob, audio);
  playRoosterFlockCues(mob, audio);
  playTrashGremlinCues(mob, audio);
  playElectricGoblinCues(mob, audio);
  playKrakenCues(mob, audio);
  playKrakenTentacleCues(mob, audio);
  playFairyCastCues(mob, audio);
  playUndeadCues(mob, audio);
}

/**
 * Drains a bomber goblin's light, throw and shout cues every frame, heard or
 * not. A cackle waits out {@link PACK_CACKLE_GAP_S} after any bomber's last.
 */
function playBomberGoblinCues(mob: Mob, audio: PlacedCuePlayer | null, clockS: number): void {
  if (!(mob instanceof GoblinBomber)) return;
  for (const raised of mob.takeSoundCues()) {
    if (audio === null) continue;
    if (raised === 'cackle' && !packCackleGap.allows(clockS)) continue;
    for (const cue of BOMBER_SOUND_CUE_PLAYS[raised]) audio.playRandom(BOMBER_GOBLIN_CUES[cue]);
  }
}

/**
 * The Kraken's slam telegraph rise — the "look at the boss" cue at the
 * start of the 90-frame warning, ahead of the impact `kraken_ground_slam`
 * already covers.
 */
function playKrakenCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof Kraken) || !mob.slamRiseSoundPending) return;
  mob.slamRiseSoundPending = false;
  audio?.play('kraken_slam_rise');
}

/**
 * A tentacle's own cues, its slam on a raft among them. Its death
 * squelch is not one: it dies through `resolveKills`' `mobKilled` event (see
 * `AudioManager.wireEvents`) rather than a drained flag here, because by the
 * time this function would see one on a later frame `BossRoomSystem`'s
 * summon-cleanup pass may already have compacted the spent tentacle out of the
 * mob array `justDied` no longer protects.
 */
function playKrakenTentacleCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof KrakenTentacle)) return;
  if (mob.emergeSoundPending) {
    mob.emergeSoundPending = false;
    audio?.play('kraken_tentacle_emerge');
  }
  if (mob.strikeSoundPending) {
    mob.strikeSoundPending = false;
    audio?.play('kraken_tentacle_strike');
  }
  if (mob.slamSoundPending) {
    mob.slamSoundPending = false;
    playTakes(slamTakesOf(mob), audio);
  }
}

/** What a raft or pump tentacle's slam lands on: the planks of a raft, either way. */
function slamTakesOf(tentacle: KrakenTentacle): readonly SoundId[] {
  switch (tentacle.role.kind) {
    case 'raft':
    case 'pump':
      return FLOODED_PUMP_ROOM_CUES.raftSlam;
    case 'guard':
      return [];
    default: {
      const unhandled: never = tentacle.role;
      throw new Error(`unhandled tentacle role ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Big Rooster's slam landing, which `specialSoundPending` cannot carry: that one
 * boolean is already the dumbbell throw, and a slam landing on the frame he
 * winds up a throw would drop whichever cue came second. His wind-up plays
 * no cue.
 */
function playBigRoosterCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof BigRooster)) return;
  if (mob.slamImpactSoundPending) {
    mob.slamImpactSoundPending = false;
    // [STAND-IN] the Rock Golem's slam, which is the library's only fist-sized
    // impact into earth.
    audio?.play('massive_strike_with_dirt_impact');
  }
}

/** Every rooster's voice, blows and feet, Big Rooster's included, by its build. */
function playRoosterFlockCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (mob instanceof BigRooster) playRoosterCues('big', mob.takeSoundCues(), audio);
  else if (mob instanceof RoosterMinion) {
    playRoosterCues(mob.roosterBuild, mob.takeSoundCues(), audio);
  }
}

function playRoosterCues(
  build: RoosterBuild,
  cues: readonly RoosterSoundCue[],
  audio: PlacedCuePlayer | null,
): void {
  for (const cue of cues) {
    const takes = ROOSTER_CUES[build][cue];
    if (takes.length === 0) continue;
    const volume = cue === 'step' ? ROOSTER_STEP_VOLUME[build] : 1;
    audio?.playRandom(takes, { volume });
  }
}

/** The Trash Gremlin's own voice; its retch rides `specialSoundPending`. */
function playTrashGremlinCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof TrashGremlin)) return;
  for (const cue of mob.takeSoundCues()) audio?.playRandom(TRASH_GREMLIN_CUES[cue]);
}

function playElectricGoblinCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof ElectricGoblin)) return;
  for (const cue of mob.takeSoundCues()) playTakes(ELECTRIC_GOBLIN_CUES[cue], audio);
}

/** What each of a cow's voices plays; `playRandom` picks one of several takes. */
const COW_VOICE_SOUNDS: Readonly<Record<CowVoice, readonly SoundId[]>> = {
  ambient: ['cow_ambient_moo_1', 'cow_ambient_moo_2', 'cow_ambient_moo_3'],
  calf: ['calf_moo_1', 'calf_moo_2', 'calf_moo_3'],
  angry: ['cow_angry_moo_1', 'cow_angry_moo_2'],
  happy: ['cow_happy_moo'],
};

/**
 * A cow's or calf's moo. One queued voice rather than the shared pending
 * flags, because a cow has four different things to say and none of them is
 * an attack.
 */
function playCowVoice(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof Cow) || mob.voicePending === null) return;
  const voice = mob.voicePending;
  mob.voicePending = null;
  audio?.playRandom(COW_VOICE_SOUNDS[voice]);
}

const FUZZY_NIGHTMARE_VOICE_SOUNDS = {
  growl: [
    'fuzzy_nightmare_growl_1',
    'fuzzy_nightmare_growl_2',
    'fuzzy_nightmare_growl_3',
    'fuzzy_nightmare_growl_4',
    'fuzzy_nightmare_growl_5',
  ],
  grateClaw: [
    'fuzzy_nightmare_grate_claw_1',
    'fuzzy_nightmare_grate_claw_2',
    'fuzzy_nightmare_grate_claw_3',
    'fuzzy_nightmare_grate_claw_4',
    'fuzzy_nightmare_grate_claw_5',
  ],
} as const satisfies Record<FuzzyNightmareVoice, readonly SoundId[]>;

/**
 * A Fuzzy Nightmare's growl as it stalks and its claws on the grate it comes
 * up through. A queued voice rather than the shared flags: neither is the
 * swipe that `attackSoundPending` stands for.
 */
function playFuzzyNightmareVoice(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof FuzzyNightmare) || mob.voicePending === null) return;
  const voice = mob.voicePending;
  mob.voicePending = null;
  audio?.playRandom(FUZZY_NIGHTMARE_VOICE_SOUNDS[voice]);
}

const ATTACK_COW_HEADBUTT_SOUNDS: readonly SoundId[] = [
  'attack_cow_headbutt_1',
  'attack_cow_headbutt_2',
  'attack_cow_headbutt_3',
];

/**
 * The attack cow's charge cry and the thud of each headbutt that lands. Her
 * moos ride the cow voice above. Headbutts come every second or so in a long
 * fight, so the same take never plays twice running.
 */
function playAttackCowCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof AttackCow)) return;
  if (mob.chargeSoundPending) {
    mob.chargeSoundPending = false;
    audio?.play('attack_cow_charge');
  }
  if (mob.headbuttSoundPending) {
    mob.headbuttSoundPending = false;
    audio?.playRandom(ATTACK_COW_HEADBUTT_SOUNDS);
  }
}

/**
 * The Mantid's stalking hiss.
 *
 * A flag of its own rather than another `specialSoundPending` arm because it
 * fires while he walks, and the rage pause can raise that flag on the very same
 * frame — one shared boolean would drop whichever came second.
 */
function playMantidHiss(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof Mantid) || !mob.hissSoundPending) return;
  mob.hissSoundPending = false;
  audio?.playRandom([
    'mantid_hiss_1',
    'mantid_hiss_2',
    'mantid_hiss_3',
    'mantid_hiss_4',
    'mantid_hiss_5',
  ]);
}

/**
 * A soul-bolt caster's cast wind-up — a full second of gathering before the
 * bolts leave, which `projectileSoundPending` covers separately.
 */
function playCastWindup(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof SkeletonLord) && !(mob instanceof TheLich)) return;
  if (!mob.castWindupSoundPending) return;
  mob.castWindupSoundPending = false;
  audio?.play('prepare_for_magic_strike');
}

/**
 * The Dark Knight's five extra cues.
 *
 * They are separate flags rather than more `specialSoundPending` arms because
 * he fires two of them within a second of each other — the whirl as the sweep
 * winds up and the hit as it lands — and one shared flag can only carry one.
 * The two wind-ups are likewise split: a physical swing and a volley of green
 * fire have to announce themselves differently or the player cannot tell from
 * the sound alone whether to close or to break the line.
 */
function playDarkKnightCues(mob: Mob, audio: PlacedCuePlayer | null): void {
  if (!(mob instanceof DarkKnight)) return;
  if (mob.whirlSoundPending) {
    mob.whirlSoundPending = false;
    audio?.play('metal_winding_up');
  }
  if (mob.volleyWindupSoundPending) {
    mob.volleyWindupSoundPending = false;
    audio?.play('knight_magic_windup');
  }
  if (mob.slamSoundPending) {
    mob.slamSoundPending = false;
    audio?.play('massive_metal_hit');
  }
  if (mob.sweepHitSoundPending) {
    mob.sweepHitSoundPending = false;
    audio?.play('massive_weapon_strike');
  }
  if (mob.castSoundPending) {
    mob.castSoundPending = false;
    audio?.playRandom(['laser_1', 'laser_2', 'laser_3']);
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
