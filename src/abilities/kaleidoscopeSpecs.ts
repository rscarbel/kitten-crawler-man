import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { Missile } from '../sprites/catSprite';

/*
 * Kaleidoscope copies: while the cat crawler wears gear that splits her missiles,
 * every missile of hers that lands on an enemy throws off copies of itself
 * that hunt nearby hostiles, or circle her until one turns up.
 */
/**
 * Live copies allowed at once. A fight that ends on a sub-missile volley would
 * otherwise leave dozens circling her, which is both a draw-count problem and
 * a screen nobody can read.
 */
export const KALEIDOSCOPE_LIVE_COPY_LIMIT = 12;
/** How far a copy looks for a hostile to chase, measured from the copy. */
export const KALEIDOSCOPE_SEEK_RADIUS_TILES = 4;
const KALEIDOSCOPE_SEEK_RADIUS_PX = KALEIDOSCOPE_SEEK_RADIUS_TILES * TILE_SIZE;

/**
 * A fresh copy flies straight out before it may steer or strike. It is born
 * inside the hit radius of the enemy its parent just struck, so without this
 * all three would land on that enemy on the very next frame and never be seen.
 */
const ARMING_SECONDS = 0.2;
const ARMING_FRAMES = Math.round(ARMING_SECONDS * WORLD_TICKS_PER_SECOND);
/**
 * Radians a copy may turn per frame. Tighter than a homing missile's turn,
 * because a copy starts a tile from its quarry rather than a screen away, and
 * at the homing missile's rate its turning circle is wider than that gap.
 */
const COPY_TURN_RATE = 0.15;
/**
 * A seeking copy that has not landed in this long bursts. The steer turns at a
 * fixed rate, so a copy chasing something inside its own turning circle would
 * otherwise orbit that enemy for ever.
 */
const SEEK_LIMIT_SECONDS = 5;
const SEEK_LIMIT_FRAMES = SEEK_LIMIT_SECONDS * WORLD_TICKS_PER_SECOND;
/** How long a copy circles the cat with nothing to chase before it fades. */
const ORBIT_LIFETIME_SECONDS = 30;
const ORBIT_LIFETIME_FRAMES = ORBIT_LIFETIME_SECONDS * WORLD_TICKS_PER_SECOND;
const FADE_SECONDS = 0.5;
const FADE_FRAMES = Math.round(FADE_SECONDS * WORLD_TICKS_PER_SECOND);

const ORBIT_RADIUS_TILES = 0.9;
const ORBIT_RADIUS_PX = ORBIT_RADIUS_TILES * TILE_SIZE;
/** The ring is seen from above at the game's angle, so it is squashed top to bottom. */
const ORBIT_VERTICAL_SQUASH = 0.55;
/** The cat sits low in her tile; the ring circles her body, not her feet. */
const ORBIT_CENTRE_LIFT_PX = 4;
const ORBIT_PERIOD_SECONDS = 4;
const ORBIT_TURN_PER_FRAME = (Math.PI * 2) / (ORBIT_PERIOD_SECONDS * WORLD_TICKS_PER_SECOND);
const ORBIT_BOB_PX = 3;
const ORBIT_BOB_PERIOD_SECONDS = 1.6;
const ORBIT_BOB_TURN_PER_FRAME =
  (Math.PI * 2) / (ORBIT_BOB_PERIOD_SECONDS * WORLD_TICKS_PER_SECOND);
/**
 * Successive copies take ring slots a golden angle apart, which keeps any
 * number of them spread round her without re-spacing the ones already there.
 */
/** π(3 − √5): the golden angle, in radians. */
const GOLDEN_ANGLE = 2.399963229728653;
const FULL_TURN = Math.PI * 2;
const HALF_TILE = TILE_SIZE / 2;
/** Fully opaque, for a copy that is not fading. */
const OPAQUE = 1;

export type KaleidoscopeCopyMode = 'arming' | 'seeking' | 'orbiting' | 'fading';

/** What makes a missile a copy, carried on the {@link Missile} itself. */
export interface KaleidoscopeCopy {
  mode: KaleidoscopeCopyMode;
  /** Frames spent in the current mode. */
  modeFrames: number;
  /** This copy's place on the cat's ring, in radians. */
  orbitAngle: number;
  /** Release order, so the cap retires the oldest copy first. */
  readonly serial: number;
  /** Where in its bob the copy starts, so the ring does not bob in lockstep. */
  bobPhase: number;
  /** Pixels per frame, inherited from the missile that released it. */
  readonly speed: number;
}

/** The missile whose hit is releasing copies, as the copies inherit it. */
export interface KaleidoscopeSource {
  readonly x: number;
  readonly y: number;
  readonly abilityLevel: number;
  readonly isSubMissile: boolean;
  readonly speed: number;
  /** How many copies the landed missile splits into. */
  readonly copies: number;
}

/** What one frame of copies needs to know about the world and the cat. */
export interface KaleidoscopeFrame {
  readonly mobGrid: SpatialGrid<Mob> | undefined;
  /** The cat's centre, in world pixels. */
  readonly ownerX: number;
  readonly ownerY: number;
  /** False while she is downed or dead: nothing circles a cat who is not up. */
  readonly ownerStanding: boolean;
  readonly isOpen: (worldX: number, worldY: number) => boolean;
  /**
   * Whether a missile could fly straight between two world points. A hostile
   * behind a wall would otherwise pull every circling copy off the ring only
   * to burst it on the wall.
   */
  readonly hasClearPath: (fromX: number, fromY: number, toX: number, toY: number) => boolean;
}

/** Turns `missile` toward (`tx`, `ty`) by at most `turnRate` radians, keeping its speed. */
export function steerMissileToward(
  missile: Pick<Missile, 'x' | 'y' | 'vx' | 'vy'>,
  tx: number,
  ty: number,
  turnRate: number,
): void {
  const speed = Math.hypot(missile.vx, missile.vy);
  if (speed <= 0) return;
  const heading = Math.atan2(missile.vy, missile.vx);
  let diff = Math.atan2(ty - missile.y, tx - missile.x) - heading;
  while (diff > Math.PI) diff -= FULL_TURN;
  while (diff < -Math.PI) diff += FULL_TURN;
  const turned = heading + Math.min(Math.abs(diff), turnRate) * Math.sign(diff);
  missile.vx = Math.cos(turned) * speed;
  missile.vy = Math.sin(turned) * speed;
}

/**
 * Whether a missile may land a blow this frame. A copy strikes only while it is
 * seeking: one arming, circling the cat or fading is decoration until it picks a
 * target, and must not burst on whatever wanders through her ring.
 */
export function missileCanStrike(missile: Missile): boolean {
  return missile.kaleidoscope === undefined || missile.kaleidoscope.mode === 'seeking';
}

/**
 * Whether a missile may detonate on `mob`. A copy chose its own target rather
 * than being aimed, so it only ever hurts something hostile: a cow, a citizen
 * or a prisoner that happens to admit missile damage is not fair game for a
 * shot the player never pointed at it.
 */
export function missileMayHitMob(missile: Missile, mob: Pick<Mob, 'isHostile'>): boolean {
  return missile.kaleidoscope === undefined || mob.isHostile;
}

/**
 * Whether a missile detonates on crates, interior props and trees. A copy
 * circling the cat passes through them: she would otherwise blow up every crate
 * she stands beside and set alight every tree she walks past.
 */
export function missileStrikesScenery(missile: Missile): boolean {
  return missile.kaleidoscope === undefined || missile.kaleidoscope.mode === 'seeking';
}

/** How opaque to draw a missile: copies fade out over their last half second. */
export function missileOpacity(missile: Missile): number {
  const copy = missile.kaleidoscope;
  if (copy?.mode !== 'fading') return OPAQUE;
  return Math.max(0, 1 - copy.modeFrames / FADE_FRAMES);
}

/**
 * Releases and steers every copy in one cat's missile list. Copies live in
 * that list beside her ordinary missiles, so combat resolution, drawing and
 * floor changes treat them exactly as missiles.
 */
export class KaleidoscopeCopies {
  private nextSerial = 0;
  private nextOrbitSlot = 0;
  private readonly targetQuery = new Set<Mob>();

  /** Set when copies were released this frame; cleared by whoever plays the cue. */
  releaseCuePending = false;
  /** Set when circling copies broke off toward an enemy this frame. */
  seekCuePending = false;

  /** Pushes this hit's copies onto `missiles`, retiring the oldest live copies past the cap. */
  release(missiles: Missile[], source: KaleidoscopeSource, explodeFrames: number): void {
    this.retireOldestFor(missiles, source.copies);
    const spread = FULL_TURN / source.copies;
    const startAngle = Math.random() * FULL_TURN;
    for (let i = 0; i < source.copies; i++) {
      const angle = startAngle + i * spread;
      missiles.push({
        x: source.x,
        y: source.y,
        vx: Math.cos(angle) * source.speed,
        vy: Math.sin(angle) * source.speed,
        distTraveled: 0,
        maxDist: Number.POSITIVE_INFINITY,
        state: 'flying',
        explodeTimer: explodeFrames,
        hit: false,
        abilityLevel: source.abilityLevel,
        isSubMissile: source.isSubMissile,
        kaleidoscope: {
          mode: 'arming',
          modeFrames: 0,
          orbitAngle: 0,
          serial: this.nextSerial++,
          bobPhase: Math.random() * FULL_TURN,
          speed: source.speed,
        },
      });
    }
    this.releaseCuePending = true;
  }

  /** True while any copy is circling the cat — what the orbit hum follows. */
  anyOrbiting(missiles: readonly Missile[]): boolean {
    return missiles.some((m) => m.state === 'flying' && m.kaleidoscope?.mode === 'orbiting');
  }

  /** Advances every copy in `missiles` by one frame. Ordinary missiles are left alone. */
  update(missiles: readonly Missile[], frame: KaleidoscopeFrame): void {
    for (const missile of missiles) {
      const copy = missile.kaleidoscope;
      if (copy === undefined || missile.state !== 'flying') continue;
      copy.modeFrames++;
      if (copy.mode === 'arming') this.updateArming(missile, copy, frame);
      else if (copy.mode === 'seeking') this.updateSeeking(missile, copy, frame);
      else if (copy.mode === 'orbiting') this.updateOrbiting(missile, copy, frame);
      else this.updateFading(missile, copy);
    }
  }

  /** Forgets the slot sequence, for a cat whose copies were all just dropped. */
  reset(): void {
    this.nextOrbitSlot = 0;
    this.releaseCuePending = false;
    this.seekCuePending = false;
  }

  private updateArming(missile: Missile, copy: KaleidoscopeCopy, frame: KaleidoscopeFrame): void {
    this.flyStraight(missile, frame);
    if (missile.state !== 'flying' || copy.modeFrames < ARMING_FRAMES) return;
    this.enter(copy, 'seeking');
  }

  private updateSeeking(missile: Missile, copy: KaleidoscopeCopy, frame: KaleidoscopeFrame): void {
    if (copy.modeFrames >= SEEK_LIMIT_FRAMES) {
      missile.state = 'exploding';
      return;
    }
    const target = this.nearestHostile(missile.x, missile.y, frame);
    if (target === null) {
      if (frame.ownerStanding) this.joinOrbit(copy);
      else this.enter(copy, 'fading');
      return;
    }
    steerMissileToward(missile, target.x + HALF_TILE, target.y + HALF_TILE, COPY_TURN_RATE);
    this.flyStraight(missile, frame);
  }

  private updateOrbiting(missile: Missile, copy: KaleidoscopeCopy, frame: KaleidoscopeFrame): void {
    if (!frame.ownerStanding || copy.modeFrames >= ORBIT_LIFETIME_FRAMES) {
      this.enter(copy, 'fading');
      return;
    }
    const target = this.nearestHostile(missile.x, missile.y, frame);
    if (target !== null) {
      const dx = target.x + HALF_TILE - missile.x;
      const dy = target.y + HALF_TILE - missile.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0) {
        missile.vx = (dx / distance) * copy.speed;
        missile.vy = (dy / distance) * copy.speed;
      }
      this.enter(copy, 'seeking');
      this.seekCuePending = true;
      return;
    }

    copy.orbitAngle += ORBIT_TURN_PER_FRAME;
    copy.bobPhase += ORBIT_BOB_TURN_PER_FRAME;
    const bob = Math.sin(copy.bobPhase) * ORBIT_BOB_PX;
    const slotX = frame.ownerX + Math.cos(copy.orbitAngle) * ORBIT_RADIUS_PX;
    const slotY =
      frame.ownerY -
      ORBIT_CENTRE_LIFT_PX +
      Math.sin(copy.orbitAngle) * ORBIT_RADIUS_PX * ORBIT_VERTICAL_SQUASH +
      bob;
    const dx = slotX - missile.x;
    const dy = slotY - missile.y;
    const distance = Math.hypot(dx, dy);
    // Closes on its slot no faster than it flies, so a copy joining the ring
    // from across the room arrives rather than teleporting.
    const step = Math.min(distance, copy.speed);
    if (distance > 0) {
      missile.vx = (dx / distance) * step;
      missile.vy = (dy / distance) * step;
    }
    missile.x += missile.vx;
    missile.y += missile.vy;
  }

  private updateFading(missile: Missile, copy: KaleidoscopeCopy): void {
    missile.x += missile.vx;
    missile.y += missile.vy;
    if (copy.modeFrames < FADE_FRAMES) return;
    // Exploding with no burst left to play is how the cat's own sweep drops a missile.
    missile.state = 'exploding';
    missile.explodeTimer = 0;
  }

  /**
   * Moves a copy along its heading. It bursts on stepping into a wall, but only
   * from open floor: a copy peeling off the ring can start inside a wall the
   * ring passes through, and it should fly out of it rather than die in it.
   */
  private flyStraight(missile: Missile, frame: KaleidoscopeFrame): void {
    const nextX = missile.x + missile.vx;
    const nextY = missile.y + missile.vy;
    if (frame.isOpen(missile.x, missile.y) && !frame.isOpen(nextX, nextY)) {
      missile.state = 'exploding';
      return;
    }
    missile.x = nextX;
    missile.y = nextY;
    missile.distTraveled += Math.hypot(missile.vx, missile.vy);
  }

  private joinOrbit(copy: KaleidoscopeCopy): void {
    copy.orbitAngle = this.nextOrbitSlot * GOLDEN_ANGLE;
    this.nextOrbitSlot++;
    this.enter(copy, 'orbiting');
  }

  private enter(copy: KaleidoscopeCopy, mode: KaleidoscopeCopyMode): void {
    copy.mode = mode;
    copy.modeFrames = 0;
  }

  /** The nearest hostile in seek range that a copy could both reach in a straight line and hurt. */
  private nearestHostile(x: number, y: number, frame: KaleidoscopeFrame): Mob | null {
    const grid = frame.mobGrid;
    if (grid === undefined) return null;
    this.targetQuery.clear();
    // The grid keys mobs by origin and the test below measures centres, so the
    // query is a tile wider or an enemy at the edge of the radius is missed.
    const candidates = grid.queryCircle(
      x,
      y,
      KALEIDOSCOPE_SEEK_RADIUS_PX + TILE_SIZE,
      this.targetQuery,
    );
    let best: Mob | null = null;
    let bestDistSq = KALEIDOSCOPE_SEEK_RADIUS_PX * KALEIDOSCOPE_SEEK_RADIUS_PX;
    for (const mob of candidates) {
      if (!mob.isHostileTarget || !mob.takesPlayerDamage('missile')) continue;
      const mobX = mob.x + HALF_TILE;
      const mobY = mob.y + HALF_TILE;
      const dx = mobX - x;
      const dy = mobY - y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= bestDistSq) continue;
      if (!frame.hasClearPath(x, y, mobX, mobY)) continue;
      bestDistSq = distSq;
      best = mob;
    }
    return best;
  }

  /** Starts the oldest live copies fading until `incoming` more fit under the cap. */
  private retireOldestFor(missiles: readonly Missile[], incoming: number): void {
    const live = missiles
      .filter((m) => m.state === 'flying' && m.kaleidoscope !== undefined)
      .filter((m) => m.kaleidoscope?.mode !== 'fading');
    const excess = live.length + incoming - KALEIDOSCOPE_LIVE_COPY_LIMIT;
    if (excess <= 0) return;
    live.sort((a, b) => (a.kaleidoscope?.serial ?? 0) - (b.kaleidoscope?.serial ?? 0));
    for (const retired of live.slice(0, excess)) {
      if (retired.kaleidoscope !== undefined) this.enter(retired.kaleidoscope, 'fading');
    }
  }
}
