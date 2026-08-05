import type { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import { TILE_SIZE } from '../core/constants';
import { randomInt } from '../utils';
import {
  COCKROACH_BODY_PART_KEY,
  COCKROACH_BITE_FRAMES,
  COCKROACH_BITE_IMPACT_FRAME,
  drawCockroachSprite,
} from '../sprites/cockroachSprite';

const COCKROACH_HP = 4;
const COCKROACH_SPEED = 2.2;
const AGGRO_RANGE_TILE_MULTIPLIER = 7;
const ATTACK_RANGE_TILE_MULTIPLIER = 1.3;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const ATTACK_RANGE_PX = TILE_SIZE * ATTACK_RANGE_TILE_MULTIPLIER;
const ATTACK_DAMAGE = 1;
const ATTACK_COOLDOWN = 90;
const COCKROACH_DESPAWN_TTL = 1800;
const MASS = 0.3;
const FOLLOW_STOP_RANGE_MULTIPLIER = 0.8;
const FOLLOW_STOP_RANGE_TILES = 20;
const CENTER_OFFSET = 0.5;

/**
 * How far off the straight line to the player a roach comes in. It never
 * approaches on the bearing it is standing on, so a missile aimed where it is
 * now is aimed at where it will not be.
 */
const HALF_TURN = Math.PI;
const APPROACH_BEARING_MAX_SHARE = 0.42;
const APPROACH_BEARING_MIN_SHARE = 0.08;
const APPROACH_BEARING_MAX = HALF_TURN * APPROACH_BEARING_MAX_SHARE;
const APPROACH_BEARING_MIN = HALF_TURN * APPROACH_BEARING_MIN_SHARE;
/** How long one approach bearing survives before the roach picks another. */
const BEARING_FRAMES_MIN = 24;
const BEARING_FRAMES_MAX = 70;

/** A dash is a burst of speed held for a few frames, not a constant walk. */
const BURST_FRAMES_MIN = 8;
const BURST_FRAMES_MAX = 26;
const BURST_SPEED_MIN = 0.55;
const BURST_SPEED_MAX = 1.7;

/**
 * Real vermin move in stop-start dashes, and the stops are what make one hard
 * to lead: the player's aim is already swinging when the roach stops dead.
 */
const FREEZE_CHANCE_PER_BURST = 0.3;
const FREEZE_FRAMES_MIN = 7;
const FREEZE_FRAMES_MAX = 20;

/** Per-frame sideways wobble on top of the bearing, as a share of speed. */
const SKITTER_JITTER = 0.5;
const SKITTER_TURN_RATE = 0.45;

/**
 * After a bite the roach breaks off and comes back in from somewhere else
 * rather than standing in the player's face waiting out its cooldown — which
 * is exactly the behaviour that made the old ones free targets.
 */
const REANGLE_FRAMES = 42;
const REANGLE_TURN_MIN_SHARE = 0.45;
const REANGLE_TURN_RANGE_SHARE = 0.5;
const REANGLE_TURN_MIN = HALF_TURN * REANGLE_TURN_MIN_SHARE;
const REANGLE_TURN_RANGE = HALF_TURN * REANGLE_TURN_RANGE_SHARE;
const REANGLE_SPEED_MULTIPLIER = 1.25;
const REANGLE_STANDOFF_TILES = 2.6;

/** Distance from the target that an approach point is offset around. */
const APPROACH_ARC_TILES = 1.6;

/** How many game frames each cell of the bite row is held for. */
const BITE_FRAMES_PER_CELL = 3;
const BITE_ANIMATION_FRAMES = COCKROACH_BITE_FRAMES * BITE_FRAMES_PER_CELL;
/**
 * Where in the row the lunge actually connects. The damage lands here rather
 * than on the frame the roach decides to bite: dealt up front it arrived a
 * fifth of a second before the sprite showed contact, and the row's own gate
 * asserts that this frame is the extreme of the motion.
 */
const BITE_IMPACT_FRAME_MIDPOINT = 0.5;
const BITE_IMPACT_PROGRESS =
  (COCKROACH_BITE_IMPACT_FRAME + BITE_IMPACT_FRAME_MIDPOINT) / COCKROACH_BITE_FRAMES;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Even odds either way; the two directions are what stop the swarm converging. */
const EVEN_ODDS = 0.5;

function randomSign(): number {
  return Math.random() < EVEN_ODDS ? -1 : 1;
}

export class Cockroach extends Mob {
  /** Vermin survive everything; the rarest of them leave the manual behind. */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    maybeDropSkillBook(items, 'skill_book_cockroach');
    return items;
  }
  readonly xpValue = 2;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  override readonly bodyPartKey = COCKROACH_BODY_PART_KEY;
  displayName = 'Cockroach';
  description = 'Scurries out of dark corners to overwhelm its prey.';

  mass = MASS;

  /** Frames until this cockroach despawns even if alive (30 s @ 60 fps). */
  ttl = COCKROACH_DESPAWN_TTL;

  private attackCooldown = randomInt(0, ATTACK_COOLDOWN - 1);

  /** Signed offset from the straight line to the target, in radians. */
  private approachBearing = 0;
  private bearingTimer = 0;
  private burstTimer = 0;
  private burstSpeed = 1;
  private freezeTimer = 0;
  private reangleTimer = 0;
  /** Frames left in the bite animation, or 0 when it is not biting. */
  private biteTimer = 0;
  /** True between deciding to bite and the frame the lunge connects. */
  private biteDamagePending = false;
  /** Wobble phase, advanced per frame so no two roaches weave in step. */
  private skitterPhase = Math.random() * Math.PI * 2;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, COCKROACH_HP, COCKROACH_SPEED);
    this.rollBearing();
    this.rollBurst();
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    // A spent TTL is what BossRoomSystem despawns on, so a revived roach with
    // the old countdown is culled again the same frame it stands back up.
    this.ttl = COCKROACH_DESPAWN_TTL;
    this.attackCooldown = randomInt(0, ATTACK_COOLDOWN - 1);
    this.reangleTimer = 0;
    this.freezeTimer = 0;
    this.biteTimer = 0;
    this.biteDamagePending = false;
    this.rollBearing();
    this.rollBurst();
  }

  /**
   * A committed bite is dropped rather than frozen when a fog lands on it.
   *
   * `updateAI` is skipped entirely for a confused mob, so a timer ticked there
   * stops: the roach holds one cell of its lunge for as long as the fog lasts
   * while `doWander` slides it across the floor in that pose, and the damage
   * check then fires on a frame unrelated to where the sprite is. `tickTimers`
   * is the one per-frame hook the loop runs for confused mobs too.
   */
  override tickTimers(): void {
    super.tickTimers();
    if (!this.isConfused || this.biteTimer <= 0) return;
    this.biteTimer = 0;
    // The bite is cancelled, not refunded: `attackCooldown` stands, so a roach
    // fogged mid-lunge does not come out of it biting sooner than one left alone.
    this.biteDamagePending = false;
  }

  private rollBearing(): void {
    this.approachBearing = randomSign() * randomBetween(APPROACH_BEARING_MIN, APPROACH_BEARING_MAX);
    this.bearingTimer = randomInt(BEARING_FRAMES_MIN, BEARING_FRAMES_MAX);
  }

  private rollBurst(): void {
    this.burstTimer = randomInt(BURST_FRAMES_MIN, BURST_FRAMES_MAX);
    this.burstSpeed = randomBetween(BURST_SPEED_MIN, BURST_SPEED_MAX);
    if (Math.random() < FREEZE_CHANCE_PER_BURST) {
      this.freezeTimer = randomInt(FREEZE_FRAMES_MIN, FREEZE_FRAMES_MAX);
    }
  }

  /**
   * A point beside the target rather than on it, on the roach's current
   * bearing. Chasing the target's own tile is what made a line of roaches queue
   * up on one bearing and die to one missile.
   */
  private approachPointFor(target: Player, standoffTiles: number): { x: number; y: number } {
    const centreX = target.x + TILE_SIZE * CENTER_OFFSET;
    const centreY = target.y + TILE_SIZE * CENTER_OFFSET;
    const toRoach = Math.atan2(this.y - target.y, this.x - target.x);
    const angle = toRoach + this.approachBearing;
    return {
      x: centreX + Math.cos(angle) * TILE_SIZE * standoffTiles,
      y: centreY + Math.sin(angle) * TILE_SIZE * standoffTiles,
    };
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    const nearest = this.acquireTarget(targets, AGGRO_RANGE_PX);

    this.currentTarget = nearest;
    if (this.attackCooldown > 0) this.attackCooldown--;
    this.skitterPhase += SKITTER_TURN_RATE;

    if (!nearest) {
      this.doWander();
      return;
    }

    const nearestDist = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    // Body, head, antennae and all six legs are drawn from the facing vector, so
    // a stale one points the whole animal the wrong way rather than merely
    // mirroring it. `followTargetCollide` returns before writing facing once it
    // is inside its stop range, so this cannot be left to the movement calls.
    if (nearestDist <= ATTACK_RANGE_PX) this.faceToward(nearest);

    // A lunge is played standing still and out to its end. Driven off at 1.25x
    // speed with the row still running, the roach slid backwards through its own
    // bite for the whole animation.
    if (this.biteTimer > 0) {
      this.biteTimer--;
      this.isMoving = false;
      const progress = 1 - this.biteTimer / BITE_ANIMATION_FRAMES;
      if (this.biteDamagePending && progress >= BITE_IMPACT_PROGRESS) {
        this.biteDamagePending = false;
        if (nearestDist <= ATTACK_RANGE_PX) this.dealDamage(nearest, ATTACK_DAMAGE);
      }
      if (this.biteTimer <= 0) {
        // Break off and come back in on a different line, so the window between
        // bites is spent somewhere the player is not already aiming.
        this.approachBearing +=
          randomSign() * (REANGLE_TURN_MIN + Math.random() * REANGLE_TURN_RANGE);
        this.reangleTimer = REANGLE_FRAMES;
      }
      return;
    }

    if (this.reangleTimer > 0) {
      this.reangleTimer--;
      const around = this.approachPointFor(nearest, REANGLE_STANDOFF_TILES);
      this.followTargetCollide(around.x, around.y, this.moveSpeed * REANGLE_SPEED_MULTIPLIER, 0);
      return;
    }

    if (nearestDist <= ATTACK_RANGE_PX && this.attackCooldown <= 0) {
      this.attackCooldown = ATTACK_COOLDOWN;
      this.biteTimer = BITE_ANIMATION_FRAMES;
      this.biteDamagePending = true;
      this.isMoving = false;
      return;
    }

    if (this.freezeTimer > 0) {
      this.freezeTimer--;
      this.isMoving = false;
      return;
    }

    this.bearingTimer--;
    if (this.bearingTimer <= 0) this.rollBearing();
    this.burstTimer--;
    if (this.burstTimer <= 0) this.rollBurst();

    // A wobble laid across the bearing on top of the dash. Without it the path
    // between two bearing changes is a straight line, and a straight line is
    // the one thing a manually aimed missile can hit.
    const wobble = Math.sin(this.skitterPhase) * SKITTER_JITTER;
    const speed = this.moveSpeed * this.burstSpeed;

    if (this.hasLOS(nearest)) {
      const approach = this.approachPointFor(nearest, APPROACH_ARC_TILES);
      const toTarget = Math.atan2(approach.y - this.y, approach.x - this.x);
      const heading = toTarget + wobble;
      const stepX = this.x + Math.cos(heading) * TILE_SIZE;
      const stepY = this.y + Math.sin(heading) * TILE_SIZE;
      this.followTargetCollide(stepX, stepY, speed, 0);
      return;
    }

    // Out of sight it has to path like anything else; the frantic movement is
    // only meaningful when the roach can see where it is going.
    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      speed,
      ATTACK_RANGE_PX * FOLLOW_STOP_RANGE_MULTIPLIER,
      FOLLOW_STOP_RANGE_TILES,
    );
  }

  /** Progress through the bite row, or null when it is not biting. */
  private get biteProgress(): number | null {
    if (this.biteTimer <= 0) return null;
    return 1 - this.biteTimer / BITE_ANIMATION_FRAMES;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    drawCockroachSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      biteProgress: this.biteProgress,
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
