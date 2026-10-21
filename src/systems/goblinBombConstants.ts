/**
 * The numbers and shapes every goblin explosive shares: the Dynamite Goblin's
 * lit stick and the Black Powder Goblin's bomb, the shot a thrower queues for
 * `GoblinBombSystem`, and where a lob is allowed to come down.
 *
 * Kept apart from the system so a creature can import its tuning and its
 * queue types without pulling in the system's renderers, and so the dodge
 * inequalities in `docs/difficulty-fairness-rules.md` can be read off one file.
 *
 * Timing and AI are tuned per difficulty ({@link BOMBER_TUNING}), read live.
 * On Crawler and Nightmare the bombers are meant to be one of the harder
 * things on a floor: every window leaves a crawler who reacts in half a
 * second a fraction of a second to spare. On Kitten they keep the slower,
 * plainer mechanics they first shipped with. The blast's damage is the same on
 * every difficulty.
 */

import type { Mob } from '../creatures/Mob';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { settings } from '../core/Settings';
import type { Difficulty } from '../core/difficultyProfiles';

/** Which explosive a goblin threw. */
export type GoblinBombKind = 'dynamite' | 'black_powder';

/** A world point in pixels. */
export interface BombPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What every throw carries, whichever explosive it is.
 *
 * Everything the blast needs is captured here on the throw frame, because a
 * stick on the ground outlives the goblin that threw it: a dead thrower's
 * level, siege multiplier and difficulty stamp are no longer there to read.
 */
export interface GoblinBombShotBase {
  /**
   * The ground point under the thrower's feet, which the landing, the range
   * cap and the thrower's self-safety are all measured from. The hand can
   * reach over the next tile, so measuring from it would let a wall beside
   * the thrower stop every lob where it starts.
   */
  readonly start: BombPoint;
  /** The ground point under the hand that let go, where the flight is drawn from. */
  readonly hand: BombPoint;
  /**
   * Where it comes down, already passed through {@link resolveGoblinBombLanding}.
   * Fixed on the throw frame for dynamite and on the first lock frame for
   * black powder; the system never moves it.
   */
  readonly landing: BombPoint;
  /**
   * Frames the explosive spends in the air: the throw-frame tuning's flight
   * for a lob, {@link GOBLIN_DYNAMITE_DROP_FLIGHT_FRAMES} for a stick dropped
   * underfoot.
   */
  readonly flightFrames: number;
  /**
   * The share of each struck body's own max HP the blast takes from a crawler
   * or a party-side mob caught in it; see {@link goblinBlastDamage}.
   */
  readonly crawlerHpShare: number;
  /** What the blast does to each wall, trebuchet and snare caught in it during a siege. */
  readonly structureDamage: number;
  /** Who threw it: names the blow on the death screen and takes the kill credit. */
  readonly thrower: Mob;
  /** How high above `hand` the bomb leaves it, in pixels; falls away over the flight. */
  readonly releaseHeightPx: number;
}

/**
 * A stick of goblin dynamite, carrying the fuse it will burn once it lands,
 * from the throw-frame tuning, so a difficulty changed while it is live never
 * re-times it.
 */
export interface GoblinDynamiteShot extends GoblinBombShotBase {
  readonly kind: 'dynamite';
  readonly fuse: StickFuse;
}

/** A black powder bomb: it bursts on landing, so it has no fuse. */
export interface BlackPowderShot extends GoblinBombShotBase {
  readonly kind: 'black_powder';
}

/** One throw, as a bomber hands it to `GoblinBombSystem`. */
export type GoblinBombShot = GoblinDynamiteShot | BlackPowderShot;

/**
 * What a mob that throws goblin explosives offers `GoblinBombSystem`. A
 * creature opts in by returning itself from `Mob.bombThrower`.
 */
export interface BombThrower {
  /**
   * Every throw released since the last call, emptied by the call. Drained
   * from the dead as well as the living, so a bomb let go on the frame its
   * thrower died still flies.
   */
  takePendingBombs(): readonly GoblinBombShot[];
  /**
   * The black powder landing this thrower has locked and not yet released, or
   * null. Marked ground for allies from the first lock frame, since the circle
   * the creature draws is the only warning the bomb gets.
   */
  readonly lockedBombLanding: BombPoint | null;
  /**
   * How far through its lock the thrower is, 0–1, while it holds a
   * {@link lockedBombLanding}: the fill of the circle drawn on that landing.
   */
  readonly lockedBombProgress: number;
  /**
   * Told once a frame how many of this thrower's own sticks are live: in the
   * air or burning on the ground.
   */
  noteLiveSticks(count: number): void;
}

// ── Damage ───────────────────────────────────────────────────────────────────

/**
 * What a goblin blast takes from a body with `maxHp` that takes the whole
 * blast: `share` of that body's own max HP, at least a point. Sized off the
 * struck body rather than any reference crawler, so a blast costs Carl, with
 * his deep bar, the same share as Donut, and never grows with the thrower's
 * level. The difficulty's incoming-damage scale and any harm cap stamped on
 * the source apply on top, inside `Player.incomingDamage`.
 */
export function goblinBlastDamage(share: number, maxHp: number): number {
  return Math.max(1, Math.round(share * maxHp));
}

// ── Reach ────────────────────────────────────────────────────────────────────

export const GOBLIN_DYNAMITE_BLAST_RADIUS_TILES = 2;
export const GOBLIN_DYNAMITE_BLAST_RADIUS_PX = TILE_SIZE * GOBLIN_DYNAMITE_BLAST_RADIUS_TILES;
export const BLACK_POWDER_BLAST_RADIUS_TILES = 1.75;
export const BLACK_POWDER_BLAST_RADIUS_PX = TILE_SIZE * BLACK_POWDER_BLAST_RADIUS_TILES;

/** The blast radius of `kind`, in world pixels. */
export function goblinBombBlastRadiusPx(kind: GoblinBombKind): number {
  return kind === 'dynamite' ? GOBLIN_DYNAMITE_BLAST_RADIUS_PX : BLACK_POWDER_BLAST_RADIUS_PX;
}

/**
 * The furthest either goblin can lob, in tiles. The flight takes a fixed time,
 * so this cap is what bounds the bomb's ground speed (P2 in
 * `docs/difficulty-fairness-rules.md`).
 */
export const GOBLIN_BOMB_MAX_RANGE_TILES = 6;
export const GOBLIN_BOMB_MAX_RANGE_PX = TILE_SIZE * GOBLIN_BOMB_MAX_RANGE_TILES;

/** How high the lob arcs above the straight line to its landing, in tiles. */
export const GOBLIN_BOMB_ARC_HEIGHT_TILES = 1.75;

/**
 * Clearance past the blast radius that allies and hostiles keep from a live
 * stick or a black powder landing, so a body standing exactly on the edge is
 * not caught by rounding.
 */
export const GOBLIN_BOMB_HAZARD_MARGIN_TILES = 0.25;
export const GOBLIN_BOMB_HAZARD_MARGIN_PX = TILE_SIZE * GOBLIN_BOMB_HAZARD_MARGIN_TILES;

// ── Timing ───────────────────────────────────────────────────────────────────

/** A goblin stick's fuse, counted from the frame it first touches the ground. */
export interface StickFuse {
  readonly frames: number;
  /** The last stretch of the fuse, in which the circle pulses faster and the spark flares. */
  readonly finalStretchFrames: number;
}

/** Game frames a bomber's light and throw rows play over. */
export interface BomberActionFrames {
  readonly light: number;
  readonly throw: number;
}

/**
 * Everything about the bombers' timing and AI that the difficulty decides.
 * Read live through {@link activeBomberTuning}, so a difficulty changed
 * mid-run applies on the next frame; an explosive already thrown keeps the
 * flight and fuse it was thrown with. Never touches the blast's damage.
 */
export interface BomberTuning {
  /** Frames a stick of goblin dynamite spends in the air. Never level-scaled. */
  readonly dynamiteFlightFrames: number;
  /** Frames a black powder bomb spends in the air. Never level-scaled. */
  readonly blackPowderFlightFrames: number;
  /**
   * A landed stick's fuse. Must outlast a reaction and a walk out of the
   * circle ({@link goblinDynamiteDodgeMarginFrames}).
   */
  readonly fuse: StickFuse;
  /**
   * How long the Black Powder Goblin holds its locked aim before it throws.
   * The landing is fixed on the first of these frames. A locked telegraph,
   * so never under `LOCKED_TELEGRAPH_MIN_FRAMES`; lock and flight together
   * must outlast a reaction and a walk out ({@link blackPowderDodgeMarginFrames}).
   */
  readonly bombardierLockFrames: number;
  /**
   * The light and throw rows' game frames. Never under a row's own frame
   * count (12 light / 12 throw for dynamite, 18 / 14 for black powder), or
   * the row would skip frames.
   */
  readonly actionFrames: Readonly<Record<GoblinBombKind, BomberActionFrames>>;
  /** Frames between throws at level 1, from one release to the next lighting. */
  readonly throwCooldownFrames: Readonly<Record<GoblinBombKind, number>>;
  /** Walk speed at level 1, in pixels per frame. */
  readonly walkSpeed: number;
  /**
   * The cap on its levelled walk speed, as a share of the player's: a kiter
   * that outruns its pursuer is unkillable.
   */
  readonly maxSpeedRatio: number;
  /**
   * How fast it backs off and scurries clear, as a share of the player's
   * speed; never slower than its own walk, so 0 backs off at a walk.
   */
  readonly retreatSpeedRatio: number;
  /** The retreat budget: it backs off this long, then stands, so it stays catchable. */
  readonly retreatMaxFrames: number;
  readonly retreatCooldownFrames: number;
  /** Frames before a bomber whose throw was cut short starts lighting again, at level 1. */
  readonly interruptedRecoveryFrames: number;
  /**
   * How much of the target's motion until the blast a lob is led by: from
   * the throw to the landing for a stick, from the first lock frame to the
   * burst for a black powder bomb. 0 throws at the feet.
   */
  readonly aimLeadShare: Readonly<Record<GoblinBombKind, number>>;
  /** The furthest ahead of a target's feet a lob is led, in tiles. */
  readonly maxAimLeadTiles: number;
  /**
   * Whether a crawler in its face gets its close-range move: the Dynamite
   * Goblin's dropped stick, the Black Powder Goblin's hop back.
   */
  readonly closeMoves: boolean;
  /**
   * Whether it still starts a throw while backing off. Without it a crawler
   * inside the band is safe from the lob for as long as the retreat lasts.
   */
  readonly throwsWhileRetreating: boolean;
}

/** Crawler's and Nightmare's bombers: fast, led and dangerous up close. */
const CRAWLER_BOMBER_TUNING: BomberTuning = {
  dynamiteFlightFrames: 35,
  blackPowderFlightFrames: 40,
  fuse: { frames: 93, finalStretchFrames: 32 },
  bombardierLockFrames: 30,
  actionFrames: {
    dynamite: { light: 23, throw: 19 },
    black_powder: { light: 31, throw: 22 },
  },
  throwCooldownFrames: { dynamite: 110, black_powder: 135 },
  walkSpeed: 1.45,
  maxSpeedRatio: 0.75,
  retreatSpeedRatio: 0.8,
  retreatMaxFrames: 80,
  retreatCooldownFrames: 120,
  interruptedRecoveryFrames: 38,
  aimLeadShare: { dynamite: 0.5, black_powder: 0.4 },
  maxAimLeadTiles: 2,
  closeMoves: true,
  throwsWhileRetreating: true,
};

/**
 * Kitten's bombers: slow lobs at the feet, a long fuse, no close-range move,
 * and no throw while backing off.
 */
const KITTEN_BOMBER_TUNING: BomberTuning = {
  dynamiteFlightFrames: 42,
  blackPowderFlightFrames: 48,
  fuse: { frames: 120, finalStretchFrames: 40 },
  bombardierLockFrames: 36,
  actionFrames: {
    dynamite: { light: 30, throw: 24 },
    black_powder: { light: 40, throw: 28 },
  },
  throwCooldownFrames: { dynamite: 150, black_powder: 180 },
  walkSpeed: 1.2,
  maxSpeedRatio: 0.7,
  retreatSpeedRatio: 0,
  retreatMaxFrames: 70,
  retreatCooldownFrames: 150,
  interruptedRecoveryFrames: 45,
  aimLeadShare: { dynamite: 0, black_powder: 0 },
  maxAimLeadTiles: 0,
  closeMoves: false,
  throwsWhileRetreating: false,
};

export const BOMBER_TUNING: Readonly<Record<Difficulty, BomberTuning>> = {
  easy: KITTEN_BOMBER_TUNING,
  normal: CRAWLER_BOMBER_TUNING,
  hard: CRAWLER_BOMBER_TUNING,
};

/** The bomber tuning for the difficulty being played, read live. */
export function activeBomberTuning(): BomberTuning {
  return BOMBER_TUNING[settings.difficulty];
}

/** The flight of a `kind` lob under `tuning`. */
export function goblinBombFlightFrames(tuning: BomberTuning, kind: GoblinBombKind): number {
  return kind === 'dynamite' ? tuning.dynamiteFlightFrames : tuning.blackPowderFlightFrames;
}

/**
 * Frames a stick the Dynamite Goblin drops at its own feet spends falling:
 * a flick to the floor, not a lob. Its fuse is the same as a thrown stick's.
 */
export const GOBLIN_DYNAMITE_DROP_FLIGHT_FRAMES = 8;

/** How far from its landing point a stick may roll after its one bounce, in tiles. */
export const GOBLIN_DYNAMITE_SETTLE_TILES = 0.35;
export const GOBLIN_DYNAMITE_SETTLE_PX = TILE_SIZE * GOBLIN_DYNAMITE_SETTLE_TILES;
/** Frames the bounce from landing to settling takes. The fuse is already burning. */
export const GOBLIN_DYNAMITE_BOUNCE_FRAMES = 10;

// ── Fairness ─────────────────────────────────────────────────────────────────

/**
 * Frames a crawler standing on a landing takes to notice and choose a way out:
 * half a second, the same allowance the fairy fireball is sized against.
 */
export const GOBLIN_BOMB_DODGE_REACTION_FRAMES = 30;

/**
 * Frames to walk out of a goblin stick's blast from where it landed. The stick
 * may roll up to {@link GOBLIN_DYNAMITE_SETTLE_PX} after landing, possibly
 * toward the way the crawler is fleeing, so that roll is walked as well.
 */
export const GOBLIN_DYNAMITE_WALK_OUT_FRAMES = Math.ceil(
  (GOBLIN_DYNAMITE_BLAST_RADIUS_PX + GOBLIN_DYNAMITE_SETTLE_PX) / PLAYER_SPEED,
);
/** Frames to walk out of a black powder blast from its centre. */
export const BLACK_POWDER_WALK_OUT_FRAMES = Math.ceil(BLACK_POWDER_BLAST_RADIUS_PX / PLAYER_SPEED);

/**
 * Frames to spare for a crawler on a stick's landing who starts walking a
 * reaction after it lands: `fuse - (reaction + walk-out)`. Must stay positive
 * on every difficulty; on Crawler and Nightmare it is kept under a second on
 * purpose, so a crawler who dawdles is caught.
 */
export function goblinDynamiteDodgeMarginFrames(tuning: BomberTuning): number {
  return tuning.fuse.frames - (GOBLIN_BOMB_DODGE_REACTION_FRAMES + GOBLIN_DYNAMITE_WALK_OUT_FRAMES);
}

/**
 * Frames to spare for a crawler on a black powder landing who starts walking a
 * reaction after the lock begins: `lock + flight - (reaction + walk-out)`. The
 * circle drawn during the lock is the only warning, so lock and flight
 * together must hold a full reaction and walk-out. Must stay positive on every
 * difficulty. Where the landing is led, a crawler who keeps walking the way
 * they were going walks toward it.
 */
export function blackPowderDodgeMarginFrames(tuning: BomberTuning): number {
  return (
    tuning.bombardierLockFrames +
    tuning.blackPowderFlightFrames -
    (GOBLIN_BOMB_DODGE_REACTION_FRAMES + BLACK_POWDER_WALK_OUT_FRAMES)
  );
}

// ── Death screen ─────────────────────────────────────────────────────────────

/** Attack types the death screen names; one per explosive. */
export const GOBLIN_DYNAMITE_ATTACK_TYPE = 'goblin_dynamite_blast';
export const BLACK_POWDER_ATTACK_TYPE = 'black_powder_blast';

// ── Landing ──────────────────────────────────────────────────────────────────

/**
 * How far short of the boundary of the last open tile a pulled-back landing
 * sits, in pixels, so it lies inside that tile rather than on its edge.
 */
const LANDING_INSET_PX = 1;

/**
 * Where a lob from `start` aimed at `target` comes down, with no range cap:
 * the walk every lobbed explosive shares, the goblins' and the player's
 * Black Powder Bomb alike.
 *
 * The arc clears everything low or narrow — palisade segments, snares,
 * furniture, crates, trees, bodies — but not a real wall or a building
 * (`GameMap.blocksLob`): there the bomb comes down at the foot of the wall. A
 * landing on a solid prop it cleared is pulled back to the last open floor
 * before it, so an explosive never sits where nobody can stand.
 *
 * Every tile the ground track crosses is visited (an Amanatides–Woo walk, as
 * `GameMap.hasLineOfSight` does), so the track cannot slip between two walls
 * that meet at a corner.
 */
export function resolveLobLanding(
  gameMap: Pick<GameMap, 'isWalkable' | 'blocksLob'>,
  start: BombPoint,
  target: BombPoint,
): BombPoint {
  const offsetX = target.x - start.x;
  const offsetY = target.y - start.y;
  const reach = Math.hypot(offsetX, offsetY);
  if (reach === 0) return { x: start.x, y: start.y };
  const dirX = offsetX / reach;
  const dirY = offsetY / reach;
  const stepX = Math.sign(dirX);
  const stepY = Math.sign(dirY);
  let tileX = Math.floor(start.x / TILE_SIZE);
  let tileY = Math.floor(start.y / TILE_SIZE);
  // Pixels along the track between successive boundary crossings on each axis,
  // and to the first crossing on each.
  const pxPerTileX = stepX === 0 ? Infinity : TILE_SIZE / Math.abs(dirX);
  const pxPerTileY = stepY === 0 ? Infinity : TILE_SIZE / Math.abs(dirY);
  let nextCrossingX =
    stepX === 0 ? Infinity : ((stepX > 0 ? tileX + 1 : tileX) * TILE_SIZE - start.x) / dirX;
  let nextCrossingY =
    stepY === 0 ? Infinity : ((stepY > 0 ? tileY + 1 : tileY) * TILE_SIZE - start.y) / dirY;

  let enteredAt = 0;
  let landingAlong = 0;
  for (;;) {
    if (gameMap.blocksLob(tileX, tileY)) break;
    const leftAt = Math.min(nextCrossingX, nextCrossingY, reach);
    // A track through a tile's exact corner spends no distance in it, and a
    // point on that corner belongs to the tile diagonally across.
    const crossedPx = leftAt - enteredAt;
    if (crossedPx > 0 && gameMap.isWalkable(tileX, tileY)) {
      landingAlong = leftAt >= reach ? reach : leftAt - Math.min(LANDING_INSET_PX, crossedPx / 2);
    }
    if (leftAt >= reach) break;
    if (nextCrossingX < nextCrossingY) {
      tileX += stepX;
      enteredAt = nextCrossingX;
      nextCrossingX += pxPerTileX;
    } else {
      tileY += stepY;
      enteredAt = nextCrossingY;
      nextCrossingY += pxPerTileY;
    }
  }
  return { x: start.x + dirX * landingAlong, y: start.y + dirY * landingAlong };
}

/**
 * Where a goblin's lob from `start` aimed at `target` comes down:
 * {@link resolveLobLanding} with the target first pulled in to
 * {@link GOBLIN_BOMB_MAX_RANGE_PX}.
 *
 * Creatures call this when the landing is fixed (the throw frame for
 * dynamite, the first lock frame for black powder); `GoblinBombSystem` calls
 * it again on release, so no shot can come down out of range.
 */
export function resolveGoblinBombLanding(
  gameMap: Pick<GameMap, 'isWalkable' | 'blocksLob'>,
  start: BombPoint,
  target: BombPoint,
): BombPoint {
  const offsetX = target.x - start.x;
  const offsetY = target.y - start.y;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance <= GOBLIN_BOMB_MAX_RANGE_PX) return resolveLobLanding(gameMap, start, target);
  const rangeShare = GOBLIN_BOMB_MAX_RANGE_PX / distance;
  const inRange = { x: start.x + offsetX * rangeShare, y: start.y + offsetY * rangeShare };
  return resolveLobLanding(gameMap, start, inRange);
}
