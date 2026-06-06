import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { drawGrotesqueSpiderSprite } from '../sprites/grotesqueSpiderSprite';
import type { GrotesqueSpiderState } from '../sprites/grotesqueSpiderSprite';
import {
  drawSpitProjectile,
  drawSpitTrapSplat,
  drawSpitTrapIdle,
} from '../sprites/grotesqueSpiderSpitSprite';
import { makeStuck, makeSpitVenom } from '../core/StatusEffect';
import { normalize, randomInt } from '../utils';
import { TILE_SIZE } from '../core/constants';

const SPIDER_HP = 1200;
const SPIDER_SPEED = 2.5;
const DASH_SPEED_MULTIPLIER = 2.5;
const DASH_SPEED = SPIDER_SPEED * DASH_SPEED_MULTIPLIER; // sprint toward stuck player

const SCREECH_RANGE_TILE_MULTIPLIER = 3;
const SCREECH_RANGE_PX = TILE_SIZE * SCREECH_RANGE_TILE_MULTIPLIER;
const SLAM_RANGE_TILE_MULTIPLIER = 2;
const SLAM_RANGE_PX = TILE_SIZE * SLAM_RANGE_TILE_MULTIPLIER;
const TOUCHING_RANGE_TILE_MULTIPLIER = 1.5;
const TOUCHING_RANGE_PX = TILE_SIZE * TOUCHING_RANGE_TILE_MULTIPLIER;

// Fire at stateProgress 0.58 (sprite windup/release boundary)
const SPIT_FIRE_PROGRESS = 0.58;
export const SPIT_SPEED_PX = 8;
export const SPIT_WINDUP = 90; // ~1.7s — telegraphed enough to dodge
export const SPIT_EXECUTE = 21;
export const SPIT_ANIM_CYCLE_FRAMES = 8;
const SPIT_TTL = 110; // halved to keep same max range at double speed

const SCREECH_DAMAGE_PROGRESS = 0.5;
const SCREECH_WINDUP = 120; // ~2s — enough time to see the circle and walk clear
const SCREECH_EXECUTE = 25;

const SLAM_DAMAGE_PROGRESS = 0.55;
const SLAM_WINDUP = 110; // ~1.8s — enough frames to sidestep before legs crash
const SLAM_EXECUTE = 11;
const SLAM_LOCK_FRAME = Math.floor(SLAM_WINDUP / 2);

// Audio timing offsets: how far into each sound file the audible impact occurs.
// Subtract the windup duration so the sound starts early enough for the hit to align.
const SLAM_AUDIO_IMPACT_TIME = 0.5;
const SCREECH_AUDIO_IMPACT_TIME = 1.05;
const FRAMES_PER_SECOND = 60;
export const SLAM_AUDIO_OFFSET = Math.max(
  0,
  SLAM_AUDIO_IMPACT_TIME - SLAM_WINDUP / FRAMES_PER_SECOND,
);
export const SCREECH_AUDIO_OFFSET = Math.max(
  0,
  SCREECH_AUDIO_IMPACT_TIME - SCREECH_WINDUP / FRAMES_PER_SECOND,
);

const MIN_PURSUIT_FRAMES = 60;
const ATTACK_CHANCE_PER_FRAME = 0.04;
const COOLDOWN_MIN = 30;
const COOLDOWN_MAX = 50;

const SPIDER_LAB_ROOM_TILES_WIDE = 40;
const SPIDER_LAB_ROOM_TILES_TALL = 32;
const SPIDER_LAB_ROOM_DIAGONAL_PX =
  TILE_SIZE * Math.ceil(Math.hypot(SPIDER_LAB_ROOM_TILES_WIDE, SPIDER_LAB_ROOM_TILES_TALL));
const CHASE_ABANDON_PX = SPIDER_LAB_ROOM_DIAGONAL_PX;
const VISION_RANGE_PX = SPIDER_LAB_ROOM_DIAGONAL_PX;

const TRAP_TTL = 3600; // persists 60 s
const TRAP_SPLAT_TICKS_PER_FRAME = 6;
const TRAP_IDLE_TICKS_PER_FRAME = 8;

type SpiderState = 'idle' | 'pursuing' | 'spit' | 'screech' | 'slam' | 'cooldown';
type AttackPhase = 'windup' | 'execute';

const DAMAGE_PROGRESS: Record<'spit' | 'screech' | 'slam', number> = {
  spit: SPIT_FIRE_PROGRESS,
  screech: SCREECH_DAMAGE_PROGRESS,
  slam: SLAM_DAMAGE_PROGRESS,
};

interface SpitProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  animFrame: number;
  ttl: number;
}

interface SpitTrap {
  x: number;
  y: number;
  phase: 'splat' | 'idle';
  frameTimer: number;
  animFrame: number;
  ttl: number;
}

const COIN_DROP_MIN = 50;
const COIN_DROP_MAX = 100;
const MASS = 6;

/** Tile center offset (0.5 of tile size). */
const TILE_CENTER = 0.5;

// Screech damage constants
const SCREECH_BLOCK_XP = 10;
const SCREECH_HP_FRACTION = 0.9;
const SCREECH_BONUS_DAMAGE = 3;

// Slam damage constants
const SLAM_HIT_RANGE_SCALE = 1.1;
const SLAM_CONE_MIN_DOT = 0.5;
const SLAM_BLOCK_XP = 8;
const SLAM_DAMAGE_MIN = 10;
const SLAM_DAMAGE_MAX = 15;

// Spit projectile and trap constants
const SHELL_BLOCK_XP = 8;
const SPIT_DAMAGE_MIN = 8;
const SPIT_DAMAGE_MAX = 12;
const SPIT_HIT_RADIUS_FRACTION = 0.75;
const TRAP_HIT_RADIUS_FRACTION = 0.9;
const SPIT_ANIM_CYCLE = SPIT_ANIM_CYCLE_FRAMES;

// Roam behavior constants
const ROAM_TIMER_MIN = 300;
const ROAM_TIMER_MAX = 600;
const ROAM_SPEED_FRACTION = 0.5;
const ROAM_PICK_ATTEMPTS = 30;
const ROAM_BORDER_MARGIN = 3;

// Render: shared
const MS_PER_SECOND = 1000;
const DANGER_FILL_ALPHA = 0.28;
const DANGER_STRIPE_ALPHA = 0.14;
const STRIPE_ANIM_DIVISOR = 120;
const DANGER_OUTLINE_ALPHA = 0.7;

// Render: screech danger zone
// Circle appears at 5% of windup (~0.1s in) and fades out exactly when damage fires at sp=0.5
const SCREECH_SP_THRESHOLD = 0.05;
const SCREECH_FADE_DIVISOR = 0.45;
const SCREECH_DASH_SEGMENT = 10;
const SCREECH_DASH_SPEED = 25;
const SCREECH_DASH_MOD = 20;

// Render: slam danger zone
const SLAM_SP_THRESHOLD = 0.15;
const SLAM_FADE_DIVISOR = 0.4;
const SLAM_ARC_DIVISOR = 3;
const SLAM_DASH_SEGMENT = 8;
const SLAM_DASH_SPEED = 20;
const SLAM_DASH_MOD = 16;

export class GrotesqueSpider extends Mob {
  readonly xpValue = 2000;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Grotesque Spider';
  description = 'An enormous arachnid horror that roams the dungeon. Run.';
  mass = MASS;
  override readonly audioTag = 'grotesque_spider';

  slamSoundPending = false;
  screechSoundPending = false;
  spitFireSoundPending = false;
  spitLandSoundPending = false;

  override get requiresEvasion(): boolean {
    return true;
  }

  private state: SpiderState = 'idle';
  private attackPhase: AttackPhase = 'windup';
  private windupTimer = 0;
  private windupTotal = 1;
  private executeTimer = 0;
  private executeTotal = 1;
  private cooldownTimer = 0;
  private pursuitTimer = 0;
  private slamFacingLocked = false;
  private lockedFacingX = 1;
  private lockedFacingY = 0;

  private dashTarget: Player | null = null;

  // Locks onto active player; grace window after character switch before retargeting
  private preferredTarget: Player | null = null;
  private retargetCooldown = 0;
  private static readonly RETARGET_DELAY = 360;

  private activeProjectile: SpitProjectile | null = null;
  private groundTraps: SpitTrap[] = [];

  private roamTarget: { tx: number; ty: number } | null = null;
  private roamTimer = 0;

  // True while the spider is chasing to a last-known player position after losing LOS.
  private chasingToLastKnown = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SPIDER_HP, SPIDER_SPEED);
  }

  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  // Maps windup/execute phases to sprite's 0→1 range, aligning damage threshold regardless of frame counts
  private get stateProgress(): number {
    const attack = this.activeAttack;
    if (!attack) return 0;
    const threshold = DAMAGE_PROGRESS[attack];

    if (this.attackPhase === 'windup') {
      const p = this.windupTotal > 0 ? (this.windupTotal - this.windupTimer) / this.windupTotal : 1;
      return p * threshold;
    }
    const p =
      this.executeTotal > 0 ? (this.executeTotal - this.executeTimer) / this.executeTotal : 1;
    return threshold + p * (1 - threshold);
  }

  private get activeAttack(): 'spit' | 'screech' | 'slam' | null {
    if (this.state === 'spit' || this.state === 'screech' || this.state === 'slam') {
      return this.state;
    }
    return null;
  }

  private get spriteState(): GrotesqueSpiderState {
    switch (this.state) {
      case 'spit':
        return 'attack_spit';
      case 'screech':
        return 'attack_screech';
      case 'slam':
        return 'attack_slam';
      case 'pursuing':
        return 'walk';
      case 'idle':
      case 'cooldown':
        return this.isMoving ? 'walk' : 'idle';
    }
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.updateProjectile(targets);
    this.updateGroundTraps(targets);

    const activePlayer = targets.find((t) => t.isActive && t.isAlive) ?? null;

    if (this.retargetCooldown > 0) {
      this.retargetCooldown--;
      if (!this.preferredTarget?.isAlive) {
        this.preferredTarget = activePlayer;
        this.retargetCooldown = 0;
      }
    } else {
      if (activePlayer && activePlayer !== this.preferredTarget) {
        if (this.hasLOS(activePlayer)) {
          this.preferredTarget = activePlayer;
        }
      } else if (!this.preferredTarget?.isAlive) {
        this.preferredTarget = activePlayer;
      }
    }

    if (
      activePlayer !== null &&
      this.preferredTarget !== null &&
      activePlayer !== this.preferredTarget &&
      this.retargetCooldown === 0
    ) {
      this.retargetCooldown = GrotesqueSpider.RETARGET_DELAY;
    }

    // Aggro any visible target; prefer locked preferred target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (this.hasLOS(t) && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    if (this.preferredTarget?.isAlive && this.hasLOS(this.preferredTarget)) {
      nearest = this.preferredTarget;
      nearestDist = Math.hypot(this.preferredTarget.x - this.x, this.preferredTarget.y - this.y);
    }

    this.currentTarget = nearest;

    // Chase persistence: keep heading toward the last known player position after losing LOS,
    // unless the last known spot is already further than the abandon threshold.
    // Clear immediately if no living targets exist at all.
    if (targets.every((t) => !t.isAlive)) {
      this.chasingToLastKnown = false;
    } else if (nearest !== null) {
      this.chasingToLastKnown = true;
    } else if (this.chasingToLastKnown) {
      // Give up once every living player has physically moved beyond the abandon range.
      // Using actual player position (not last-known) so the spider reacts to the
      // player truly escaping rather than to where they were last seen.
      let closestPlayerDist = Infinity;
      for (const t of targets) {
        if (!t.isAlive) continue;
        closestPlayerDist = Math.min(closestPlayerDist, Math.hypot(t.x - this.x, t.y - this.y));
      }
      if (closestPlayerDist > CHASE_ABANDON_PX) {
        this.chasingToLastKnown = false;
      }
    }

    if (this.dashTarget) {
      if (!this.dashTarget.isAlive || !this.dashTarget.hasStatus('stuck')) {
        this.dashTarget = null;
      }
    }

    switch (this.state) {
      case 'idle':
      case 'pursuing':
        this.doPursuingState(nearest, nearestDist);
        break;
      case 'spit':
        this.doSpitState(nearest, targets);
        break;
      case 'screech':
        this.doScreechState(nearest, targets);
        break;
      case 'slam':
        this.doSlamState(nearest, targets);
        break;
      case 'cooldown':
        this.doCooldownState(nearest);
        break;
    }
  }

  private doPursuingState(nearest: Player | null, nearestDist: number): void {
    if (!nearest) {
      if (this.chasingToLastKnown) {
        // Keep pursuing toward the last known position until we arrive.
        this.state = 'pursuing';
        this.pursuitTimer++;
        const ts = this.tileSize;
        const distToKnown = Math.hypot(
          this.lastKnownTargetX - this.x,
          this.lastKnownTargetY - this.y,
        );
        if (distToKnown < ts * 2) {
          // Arrived but player is gone — give up
          this.chasingToLastKnown = false;
          this.state = 'idle';
          this.pursuitTimer = 0;
          this.doRoam();
          return;
        }
        const dx = this.lastKnownTargetX - this.x;
        const dy = this.lastKnownTargetY - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          this.facingX = dx / d;
          this.facingY = dy / d;
        }
        this.followTargetAStar(this.lastKnownTargetX, this.lastKnownTargetY, this.speed, ts * 2);
        return;
      }
      this.state = 'idle';
      this.pursuitTimer = 0;
      this.doRoam();
      return;
    }

    this.state = 'pursuing';
    this.updateLastKnown(nearest);
    this.pursuitTimer++;

    const isTouching = nearestDist <= TOUCHING_RANGE_PX;

    if (this.pursuitTimer >= MIN_PURSUIT_FRAMES && Math.random() < ATTACK_CHANCE_PER_FRAME) {
      const attack = this.selectAttack(nearest, nearestDist, isTouching);
      if (attack) {
        this.startAttack(attack, nearest);
        return;
      }
    }

    const chaseTarget = this.dashTarget ?? nearest;
    const speed = this.dashTarget ? DASH_SPEED : this.speed;
    this.faceToward(chaseTarget);
    this.followTargetAStar(
      this.dashTarget ? this.dashTarget.x : this.lastKnownTargetX,
      this.dashTarget ? this.dashTarget.y : this.lastKnownTargetY,
      speed,
      TOUCHING_RANGE_PX,
    );
  }

  private selectAttack(
    target: Player,
    dist: number,
    isTouching: boolean,
  ): 'spit' | 'screech' | 'slam' | null {
    const available: Array<'spit' | 'screech' | 'slam'> = [];
    if (dist <= SLAM_RANGE_PX) available.push('slam');
    if (dist <= SCREECH_RANGE_PX) available.push('screech');
    if (!isTouching && !target.hasStatus('stuck')) available.push('spit');
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)] ?? null;
  }

  private startAttack(attack: 'spit' | 'screech' | 'slam', target: Player): void {
    this.state = attack;
    this.attackPhase = 'windup';
    this.pursuitTimer = 0;
    this.slamFacingLocked = false;
    this.faceToward(target);
    this.lockedFacingX = this.facingX;
    this.lockedFacingY = this.facingY;

    switch (attack) {
      case 'spit':
        this.windupTimer = SPIT_WINDUP;
        this.windupTotal = SPIT_WINDUP;
        this.executeTimer = SPIT_EXECUTE;
        this.executeTotal = SPIT_EXECUTE;
        break;
      case 'screech':
        this.windupTimer = SCREECH_WINDUP;
        this.windupTotal = SCREECH_WINDUP;
        this.executeTimer = SCREECH_EXECUTE;
        this.executeTotal = SCREECH_EXECUTE;
        this.screechSoundPending = true;
        break;
      case 'slam':
        this.windupTimer = SLAM_WINDUP;
        this.windupTotal = SLAM_WINDUP;
        this.executeTimer = SLAM_EXECUTE;
        this.executeTotal = SLAM_EXECUTE;
        this.slamSoundPending = true;
        break;
    }
  }

  private doSpitState(nearest: Player | null, targets: Player[]): void {
    if (this.attackPhase === 'windup') {
      if (nearest) {
        this.faceToward(nearest);
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          TOUCHING_RANGE_PX,
        );
      } else {
        this.isMoving = false;
      }

      this.windupTimer--;
      if (this.windupTimer <= 0) {
        this.attackPhase = 'execute';
        this.fireSpitProjectile(nearest, targets);
        this.isMoving = false;
      }
    } else {
      this.isMoving = false;
      this.executeTimer--;
      if (this.executeTimer <= 0) this.enterCooldown();
    }
  }

  private doScreechState(nearest: Player | null, targets: Player[]): void {
    if (this.attackPhase === 'windup') {
      this.isMoving = false;
      if (nearest) this.faceToward(nearest);
      this.windupTimer--;
      if (this.windupTimer <= 0) {
        this.attackPhase = 'execute';
        this.dealScreechDamage(targets);
      }
    } else {
      this.isMoving = false;
      this.executeTimer--;
      if (this.executeTimer <= 0) this.enterCooldown();
    }
  }

  private doSlamState(nearest: Player | null, targets: Player[]): void {
    if (this.attackPhase === 'windup') {
      this.isMoving = false;

      if (!this.slamFacingLocked && nearest) {
        this.faceToward(nearest);
        this.lockedFacingX = this.facingX;
        this.lockedFacingY = this.facingY;
      }
      if (this.windupTimer <= SLAM_LOCK_FRAME && !this.slamFacingLocked) {
        this.slamFacingLocked = true;
        this.facingX = this.lockedFacingX;
        this.facingY = this.lockedFacingY;
      }
      if (this.slamFacingLocked) {
        this.facingX = this.lockedFacingX;
        this.facingY = this.lockedFacingY;
      }

      this.windupTimer--;
      if (this.windupTimer <= 0) {
        this.attackPhase = 'execute';
        this.dealSlamDamage(targets);
      }
    } else {
      this.isMoving = false;
      this.executeTimer--;
      if (this.executeTimer <= 0) this.enterCooldown();
    }
  }

  private dealScreechDamage(targets: Player[]): void {
    for (const t of targets) {
      if (!t.isAlive) continue;
      if (Math.hypot(t.x - this.x, t.y - this.y) > SCREECH_RANGE_PX) continue;
      if (
        this.spells?.isPointInsideShell(
          t.x + TILE_SIZE * TILE_CENTER,
          t.y + TILE_SIZE * TILE_CENTER,
        )
      ) {
        this.spells.addBlockXp(SCREECH_BLOCK_XP);
        continue;
      }
      this.dealDamage(
        t,
        Math.ceil(t.maxHp * SCREECH_HP_FRACTION) + SCREECH_BONUS_DAMAGE,
        'screech',
      );
    }
  }

  private dealSlamDamage(targets: Player[]): void {
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SLAM_RANGE_PX * SLAM_HIT_RANGE_SCALE) continue;
      const dot =
        dist > 0 ? (dx / dist) * this.lockedFacingX + (dy / dist) * this.lockedFacingY : 0;
      if (dot < SLAM_CONE_MIN_DOT) continue;
      if (
        this.spells?.isPointInsideShell(
          t.x + TILE_SIZE * TILE_CENTER,
          t.y + TILE_SIZE * TILE_CENTER,
        )
      ) {
        this.spells.addBlockXp(SLAM_BLOCK_XP);
        continue;
      }
      this.dealDamage(t, randomInt(SLAM_DAMAGE_MIN, SLAM_DAMAGE_MAX), 'slam');
    }
  }

  private enterCooldown(): void {
    this.state = 'cooldown';
    this.cooldownTimer = randomInt(COOLDOWN_MIN, COOLDOWN_MAX);
    this.windupTimer = 0;
    this.executeTimer = 0;
  }

  private doCooldownState(nearest: Player | null): void {
    this.isMoving = false;
    this.cooldownTimer--;
    if (this.cooldownTimer <= 0) {
      this.state = nearest ? 'pursuing' : 'idle';
    }
  }

  private fireSpitProjectile(target: Player | null, _targets: Player[]): void {
    const ts = this.tileSize;
    const ox = this.x + ts * TILE_CENTER;
    const oy = this.y + ts * TILE_CENTER;

    if (!target) {
      // No live target — fire in facing direction and it will land as a trap
      this.activeProjectile = {
        x: ox,
        y: oy,
        vx: this.facingX * SPIT_SPEED_PX,
        vy: this.facingY * SPIT_SPEED_PX,
        angle: Math.atan2(this.facingY, this.facingX),
        animFrame: 0,
        ttl: SPIT_TTL,
      };
      this.spitFireSoundPending = true;
      return;
    }

    const tx = target.x + ts * TILE_CENTER;
    const ty = target.y + ts * TILE_CENTER;
    const dx = tx - ox;
    const dy = ty - oy;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      // Already on top of target — drop a trap here
      this.spawnGroundTrap(ox, oy);
      if (this.spells?.isPointInsideShell(tx, ty)) {
        this.spells.addBlockXp(SHELL_BLOCK_XP);
        return;
      }
      this.dealDamage(target, randomInt(SPIT_DAMAGE_MIN, SPIT_DAMAGE_MAX), 'spit');
      target.applyStatus(makeStuck());
      target.applyStatus(makeSpitVenom());
      this.dashTarget = target;
      return;
    }

    this.activeProjectile = {
      x: ox,
      y: oy,
      vx: (dx / d) * SPIT_SPEED_PX,
      vy: (dy / d) * SPIT_SPEED_PX,
      angle: Math.atan2(dy, dx),
      animFrame: 0,
      ttl: SPIT_TTL,
    };
    this.spitFireSoundPending = true;
  }

  private updateProjectile(targets: Player[]): void {
    if (!this.activeProjectile) return;
    const proj = this.activeProjectile;

    proj.ttl--;
    if (proj.ttl <= 0) {
      this.spawnGroundTrap(proj.x, proj.y);
      this.activeProjectile = null;
      return;
    }

    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.animFrame = (proj.animFrame + 1) % SPIT_ANIM_CYCLE;

    if (this.map) {
      const ts = this.tileSize;
      if (!this.map.isWalkable(Math.floor(proj.x / ts), Math.floor(proj.y / ts))) {
        this.spawnGroundTrap(proj.x - proj.vx, proj.y - proj.vy); // last valid position
        this.activeProjectile = null;
        return;
      }
    }

    const ts = this.tileSize;
    const hitRadius = ts * SPIT_HIT_RADIUS_FRACTION;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const tcx = t.x + ts * TILE_CENTER;
      const tcy = t.y + ts * TILE_CENTER;
      if (Math.hypot(proj.x - tcx, proj.y - tcy) < hitRadius) {
        this.spawnGroundTrap(proj.x, proj.y);
        if (this.spells?.isPointInsideShell(tcx, tcy)) {
          this.spells.addBlockXp(SHELL_BLOCK_XP);
          this.activeProjectile = null;
          return;
        }
        this.dealDamage(t, randomInt(SPIT_DAMAGE_MIN, SPIT_DAMAGE_MAX), 'spit');
        t.applyStatus(makeStuck());
        t.applyStatus(makeSpitVenom());
        this.dashTarget = t;
        this.activeProjectile = null;
        return;
      }
    }
  }

  private spawnGroundTrap(x: number, y: number): void {
    // Snap to tile center so puddles don't visually bleed into wall sprites
    const ts = this.tileSize;
    const snappedX = (Math.floor(x / ts) + TILE_CENTER) * ts;
    const snappedY = (Math.floor(y / ts) + TILE_CENTER) * ts;
    this.groundTraps.push({
      x: snappedX,
      y: snappedY,
      phase: 'splat',
      frameTimer: TRAP_SPLAT_TICKS_PER_FRAME,
      animFrame: 0,
      ttl: TRAP_TTL,
    });
    this.spitLandSoundPending = true;
  }

  private updateGroundTraps(targets: Player[]): void {
    const ts = this.tileSize;
    const hitRadius = ts * TRAP_HIT_RADIUS_FRACTION;

    this.groundTraps = this.groundTraps.filter((trap) => {
      trap.ttl--;
      if (trap.ttl <= 0) return false;

      // Advance animation frame
      trap.frameTimer--;
      if (trap.frameTimer <= 0) {
        trap.animFrame++;
        if (trap.phase === 'splat' && trap.animFrame >= SPIT_ANIM_CYCLE) {
          trap.phase = 'idle';
          trap.animFrame = 0;
          trap.frameTimer = TRAP_IDLE_TICKS_PER_FRAME;
        } else if (trap.phase === 'idle') {
          trap.animFrame = trap.animFrame % SPIT_ANIM_CYCLE;
          trap.frameTimer = TRAP_IDLE_TICKS_PER_FRAME;
        } else {
          trap.frameTimer = TRAP_SPLAT_TICKS_PER_FRAME;
        }
      }

      // Only the idle puddle catches players
      if (trap.phase !== 'idle') return true;

      for (const t of targets) {
        if (!t.isAlive || t.hasStatus('stuck')) continue;
        if (
          Math.hypot(t.x + ts * TILE_CENTER - trap.x, t.y + ts * TILE_CENTER - trap.y) < hitRadius
        ) {
          t.applyStatus(makeStuck());
          t.applyStatus(makeSpitVenom());
          // Keep the trap — it can catch both players
        }
      }

      return true;
    });
  }

  private doRoam(): void {
    this.roamTimer--;
    const ts = this.tileSize;
    if (this.map && (this.roamTimer <= 0 || !this.roamTarget || this.isNearRoamTarget())) {
      this.roamTarget = this.pickRoamTarget();
      this.roamTimer = randomInt(ROAM_TIMER_MIN, ROAM_TIMER_MAX);
    }
    if (this.roamTarget && this.map) {
      this.followTargetAStar(
        this.roamTarget.tx * ts,
        this.roamTarget.ty * ts,
        this.speed * ROAM_SPEED_FRACTION,
        ts * 1.0,
      );
    } else {
      this.isMoving = false;
    }
  }

  private isNearRoamTarget(): boolean {
    if (!this.roamTarget) return true;
    const ts = this.tileSize;
    return Math.hypot(this.roamTarget.tx * ts - this.x, this.roamTarget.ty * ts - this.y) < ts * 2;
  }

  private pickRoamTarget(): { tx: number; ty: number } | null {
    if (!this.map) return null;
    const rows = this.map.structure.length;
    const cols = this.map.structure[0]?.length ?? rows;
    for (let attempt = 0; attempt < ROAM_PICK_ATTEMPTS; attempt++) {
      const tx = randomInt(2, cols - ROAM_BORDER_MARGIN);
      const ty = randomInt(2, rows - ROAM_BORDER_MARGIN);
      if (this.map.isWalkable(tx, ty)) return { tx, ty };
    }
    return null;
  }

  protected override hasLOS(target: Player): boolean {
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    if (dist > VISION_RANGE_PX) return false;
    return super.hasLOS(target);
  }

  private faceToward(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
    }
  }

  /**
   * Aims the spider toward the given world-space direction and enters the spit
   * windup state. Called from SpiderQuestSystem to drive the cutscene spit visual.
   */
  prepareCutsceneSpit(facingX: number, facingY: number): void {
    this.state = 'spit';
    this.attackPhase = 'windup';
    this.windupTimer = SPIT_WINDUP;
    this.windupTotal = SPIT_WINDUP;
    this.executeTimer = SPIT_EXECUTE;
    this.executeTotal = SPIT_EXECUTE;
    this.facingX = facingX;
    this.facingY = facingY;
  }

  /**
   * Advances the spit animation by one frame.
   * Returns true the frame the execute phase begins — the projectile should fire at that point.
   * Called from SpiderQuestSystem._updateCutscene() instead of the normal AI path.
   */
  tickCutsceneSpit(): boolean {
    if (this.state !== 'spit') return false;
    if (this.attackPhase === 'windup') {
      this.windupTimer--;
      if (this.windupTimer <= 0) {
        this.attackPhase = 'execute';
        return true;
      }
      return false;
    }
    this.executeTimer--;
    if (this.executeTimer <= 0) {
      this.state = 'cooldown';
      this.cooldownTimer = COOLDOWN_MIN;
    }
    return false;
  }

  /**
   * Renders only the ground spit traps (puddles).
   * Must be called BEFORE entity rendering so players/mobs appear on top.
   */
  renderSpitGroundTraps(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    for (const trap of this.groundTraps) {
      const tx = trap.x - camX;
      const ty = trap.y - camY;
      if (trap.phase === 'splat') {
        drawSpitTrapSplat(ctx, tx, ty, tileSize, trap.animFrame);
      } else {
        drawSpitTrapIdle(ctx, tx, ty, tileSize, trap.animFrame);
      }
    }
  }

  /**
   * Renders only the active in-flight spit projectile.
   * Must be called AFTER entity rendering so the projectile flies over mobs/players.
   */
  renderSpitProjectile(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.activeProjectile) return;
    const proj = this.activeProjectile;
    ctx.save();
    ctx.translate(proj.x - camX, proj.y - camY);
    ctx.rotate(proj.angle);
    drawSpitProjectile(ctx, 0, 0, tileSize, proj.animFrame);
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const sp = this.stateProgress;
    const now = performance.now();
    const time = now / MS_PER_SECOND;

    if (this.state === 'screech' && this.attackPhase === 'windup' && sp > SCREECH_SP_THRESHOLD) {
      const fade = Math.sin(((sp - SCREECH_SP_THRESHOLD) / SCREECH_FADE_DIVISOR) * Math.PI);
      const cx2 = sx + tileSize * TILE_CENTER;
      const cy2 = sy + tileSize * TILE_CENTER;
      const r = SCREECH_RANGE_PX;

      // Filled danger zone + hazard stripes clipped to circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = fade * DANGER_FILL_ALPHA;
      ctx.fillStyle = '#ff1020';
      ctx.fillRect(cx2 - r, cy2 - r, r * 2, r * 2);
      ctx.globalAlpha = fade * DANGER_STRIPE_ALPHA;
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 10;
      ctx.setLineDash([]);
      const screechStripeSpacing = 28;
      const screechStripeOffset = (now / STRIPE_ANIM_DIVISOR) % screechStripeSpacing;
      for (let d = -r * 2 + screechStripeOffset; d < r * 2; d += screechStripeSpacing) {
        ctx.beginPath();
        ctx.moveTo(cx2 + d - r, cy2 - r);
        ctx.lineTo(cx2 + d + r, cy2 + r);
        ctx.stroke();
      }
      ctx.restore();

      // Animated dashed outline
      ctx.save();
      ctx.globalAlpha = fade * DANGER_OUTLINE_ALPHA;
      ctx.strokeStyle = '#ff1020';
      ctx.lineWidth = 3;
      ctx.setLineDash([SCREECH_DASH_SEGMENT, SCREECH_DASH_SEGMENT]);
      ctx.lineDashOffset = -(now / SCREECH_DASH_SPEED) % SCREECH_DASH_MOD;
      ctx.beginPath();
      ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (this.state === 'slam' && this.attackPhase === 'windup' && sp > SLAM_SP_THRESHOLD) {
      const fade = Math.min((sp - SLAM_SP_THRESHOLD) / SLAM_FADE_DIVISOR, 1);
      const facingAngle = Math.atan2(
        this.slamFacingLocked ? this.lockedFacingY : this.facingY,
        this.slamFacingLocked ? this.lockedFacingX : this.facingX,
      );
      const cx2 = sx + tileSize * TILE_CENTER;
      const cy2 = sy + tileSize * TILE_CENTER;
      const r = SLAM_RANGE_PX * SLAM_HIT_RANGE_SCALE;
      const arcStart = facingAngle - Math.PI / SLAM_ARC_DIVISOR;
      const arcEnd = facingAngle + Math.PI / SLAM_ARC_DIVISOR;

      // Filled danger zone + hazard stripes clipped to pie-slice
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx2, cy2);
      ctx.arc(cx2, cy2, r, arcStart, arcEnd);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = fade * DANGER_FILL_ALPHA;
      ctx.fillStyle = '#ff4010';
      ctx.fillRect(cx2 - r, cy2 - r, r * 2, r * 2);
      ctx.globalAlpha = fade * DANGER_STRIPE_ALPHA;
      ctx.strokeStyle = '#ff5010';
      ctx.lineWidth = 10;
      ctx.setLineDash([]);
      const slamStripeSpacing = 28;
      const slamStripeOffset = (now / STRIPE_ANIM_DIVISOR) % slamStripeSpacing;
      for (let d = -r * 2 + slamStripeOffset; d < r * 2; d += slamStripeSpacing) {
        ctx.beginPath();
        ctx.moveTo(cx2 + d - r, cy2 - r);
        ctx.lineTo(cx2 + d + r, cy2 + r);
        ctx.stroke();
      }
      ctx.restore();

      // Animated dashed outline (closed pie-slice)
      ctx.save();
      ctx.globalAlpha = fade * DANGER_OUTLINE_ALPHA;
      ctx.strokeStyle = '#ff6020';
      ctx.lineWidth = 3;
      ctx.setLineDash([SLAM_DASH_SEGMENT, SLAM_DASH_SEGMENT]);
      ctx.lineDashOffset = -(now / SLAM_DASH_SPEED) % SLAM_DASH_MOD;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2);
      ctx.arc(cx2, cy2, r, arcStart, arcEnd);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    // Sprite natural orientation faces south (+Y), so add π/2 to align facing direction
    const cx = sx + tileSize * TILE_CENTER;
    const cy = sy + tileSize * TILE_CENTER;
    const facingAngle = Math.atan2(this.facingY, this.facingX) + Math.PI / 2;
    ctx.translate(cx, cy);
    ctx.rotate(facingAngle);
    ctx.translate(-cx, -cy);

    drawGrotesqueSpiderSprite(ctx, sx, sy, tileSize, time, 0, 1, this.spriteState, sp);

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
