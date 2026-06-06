import type { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { TILE_SIZE, AGGRO_PERSIST_MULTIPLIER } from '../core/constants';
import { randomInt } from '../utils';
import { drawHoarderSprite } from '../sprites/hoarderSprite';

const HOARDER_HP = 80;
const HOARDER_MASS = 10;
const HOARDER_SPEED = 0.45;
const HOARDER_SPEED_ENRAGED = 0.75;
const AGGRO_RANGE_TILE_MULTIPLIER = 10;
const FLEE_RANGE_TILE_MULTIPLIER = 8;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const FLEE_RANGE_PX = TILE_SIZE * FLEE_RANGE_TILE_MULTIPLIER;
const ENRAGE_THRESHOLD = 0.5;
const VOMIT_INTERVAL = 480;
const VOMIT_INTERVAL_ENRAGED = 240;
const VOMIT_WINDUP_FRAMES = 80;
const VOMIT_SPEED = 3.5;
const CENTER_OFFSET = 0.5;
const RETURN_TO_SPAWN_THRESHOLD_TILES = 2;
const RETURN_TO_SPAWN_SPEED_MULTIPLIER = 0.6;
const FLEE_DISTANCE_TILES = 4;
const FLEE_STUCK_THRESHOLD = 8;
const FLEE_ANGLE_CHANGE_DIVISOR = 4;
const FLEE_ANGLE_CHANGE = Math.PI / FLEE_ANGLE_CHANGE_DIVISOR;
const FLEE_BIAS_DECAY = 0.85;
const WANDER_STATIONERY_THRESHOLD = 300;
const WANDER_DISTANCE_TILES_MIN = 3;
const WANDER_DISTANCE_TILES_RANGE = 3;
const WANDER_SPEED_MULTIPLIER = 0.6;
const VOMIT_SPAWN_RANGE_TILES_MIN = 0.5;
const VOMIT_SPAWN_RANGE_TILES_RANGE = 1.5;
const VOMIT_COUNT_MIN = 3;
const VOMIT_COUNT_MAX = 5;
const COIN_DROP_MIN = 50;
const COIN_DROP_MAX = 100;

type HoarderState = 'fleeing' | 'vomit_windup';

export class TheHoarder extends Mob {
  readonly xpValue = 500;
  readonly bodyPartKey = 'hoarder';
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Hoarder';
  description = 'A hulking boss that flees while vomiting cockroaches and acid bile.';
  mass = HOARDER_MASS;

  isEnraged = false;

  private hoarderState: HoarderState = 'fleeing';
  private vomitTimer = VOMIT_INTERVAL;
  private vomitWindupTimer = 0;
  private vomitTargetX = 0;
  private vomitTargetY = 0;
  private vomitWindupTargets: Player[] = [];

  private fleeStuckFrames = 0;
  private fleeBias = 0;
  private fleeBiasSign = 1;

  private stationaryFrames = 0;
  private wanderTargetX = 0;
  private wanderTargetY = 0;
  private wanderActive = false;

  /** Set by BossRoomSystem each frame: true when cockroach cap is full. */
  cockroachAtCap = false;

  /** Pending cockroach spawn positions. BossRoomSystem drains this each frame. */
  cockroachSpawns: Array<{ x: number; y: number }> = [];

  /** Set when vomit windup completes; BossRoomSystem reads and clears this each frame. */
  pendingVomitProjectile: { x: number; y: number; dx: number; dy: number } | null = null;

  /** Set each time this boss takes damage; DungeonScene reads and clears it to play the hit sound. */
  damageSoundPending = false;
  /** Set when a vomit projectile fires; DungeonScene reads and clears it to play the vomit sound. */
  vomitSoundPending = false;

  get isWindingUp(): boolean {
    return this.hoarderState === 'vomit_windup';
  }

  get vomitWindupProgress(): number {
    return this.vomitWindupTimer > 0 ? 1 - this.vomitWindupTimer / VOMIT_WINDUP_FRAMES : 0;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, HOARDER_HP, HOARDER_SPEED);
    this.isBoss = true;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
      this.speed = HOARDER_SPEED_ENRAGED;
    }

    if (this.hoarderState === 'vomit_windup') {
      // Track player movement during windup so the shot stays accurate
      let nearestWindup: Player | null = null;
      let nearestWindupDist = Infinity;
      for (const t of this.vomitWindupTargets) {
        if (!t.isAlive) continue;
        const d = Math.hypot(t.x - this.x, t.y - this.y);
        if (d < nearestWindupDist) {
          nearestWindupDist = d;
          nearestWindup = t;
        }
      }
      if (nearestWindup !== null) {
        this.vomitTargetX = nearestWindup.x + TILE_SIZE * CENTER_OFFSET;
        this.vomitTargetY = nearestWindup.y + TILE_SIZE * CENTER_OFFSET;
      }

      this.vomitWindupTimer--;
      this.isMoving = false;
      const cx = this.x + TILE_SIZE * CENTER_OFFSET;
      const cy = this.y + TILE_SIZE * CENTER_OFFSET;
      const dx = this.vomitTargetX - cx;
      const dy = this.vomitTargetY - cy;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        this.facingX = dx / len;
        this.facingY = dy / len;
      }
      if (this.vomitWindupTimer <= 0) {
        const ndx = len > 0 ? dx / len : 1;
        const ndy = len > 0 ? dy / len : 0;
        this.pendingVomitProjectile = {
          x: cx,
          y: cy,
          dx: ndx * VOMIT_SPEED,
          dy: ndy * VOMIT_SPEED,
        };
        this.vomitSoundPending = true;
        this.hoarderState = 'fleeing';
      }
      return;
    }

    const aggroScanRange =
      this.currentTarget !== null ? AGGRO_RANGE_PX * AGGRO_PERSIST_MULTIPLIER : AGGRO_RANGE_PX;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if ((this.forceAggro || d < aggroScanRange) && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    this.vomitTimer--;
    const interval = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
    if (this.vomitTimer <= 0) {
      this.vomitTimer = interval;
      if (this.cockroachAtCap && nearest !== null) {
        this.vomitTargetX = nearest.x + TILE_SIZE * CENTER_OFFSET;
        this.vomitTargetY = nearest.y + TILE_SIZE * CENTER_OFFSET;
        this.vomitWindupTargets = targets;
        this.hoarderState = 'vomit_windup';
        this.vomitWindupTimer = VOMIT_WINDUP_FRAMES;
      } else {
        this.triggerVomit();
      }
    }

    if (!nearest) {
      this.stationaryFrames = 0;
      this.wanderActive = false;
      const toHome = Math.hypot(this.x - this.spawnX, this.y - this.spawnY);
      if (toHome > TILE_SIZE * RETURN_TO_SPAWN_THRESHOLD_TILES) {
        this.followTargetCollide(
          this.spawnX,
          this.spawnY,
          this.speed * RETURN_TO_SPAWN_SPEED_MULTIPLIER,
          TILE_SIZE,
        );
      } else {
        this.isMoving = false;
      }
      return;
    }

    this.updateLastKnown(nearest);

    if (nearestDist < FLEE_RANGE_PX) {
      this.stationaryFrames = 0;
      this.wanderActive = false;
      const dx = this.x - nearest.x;
      const dy = this.y - nearest.y;
      const len = Math.hypot(dx, dy);
      const baseAngle = len > 0 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
      const fleeAngle = baseAngle + this.fleeBias;
      const fleeTargetX = this.x + Math.cos(fleeAngle) * TILE_SIZE * FLEE_DISTANCE_TILES;
      const fleeTargetY = this.y + Math.sin(fleeAngle) * TILE_SIZE * FLEE_DISTANCE_TILES;
      const preX = this.x;
      const preY = this.y;
      this.followTargetCollide(fleeTargetX, fleeTargetY, this.speed, 0);
      if (this.x === preX && this.y === preY) {
        this.fleeStuckFrames++;
        if (this.fleeStuckFrames >= FLEE_STUCK_THRESHOLD) {
          this.fleeBias += FLEE_ANGLE_CHANGE * this.fleeBiasSign;
          this.fleeStuckFrames = 0;
          if (Math.abs(this.fleeBias) > Math.PI) {
            this.fleeBiasSign *= -1;
            this.fleeBias = 0;
          }
        }
      } else {
        this.fleeStuckFrames = 0;
        this.fleeBias *= FLEE_BIAS_DECAY;
      }
    } else {
      // Player is in aggro range but outside flee range — wander if stationary too long
      this.stationaryFrames++;
      if (this.wanderActive) {
        const preX = this.x;
        const preY = this.y;
        this.followTargetCollide(
          this.wanderTargetX,
          this.wanderTargetY,
          this.speed * WANDER_SPEED_MULTIPLIER,
          TILE_SIZE,
        );
        if (this.x !== preX || this.y !== preY) {
          this.stationaryFrames = 0;
        }
        if (this.x === preX && this.y === preY) {
          // Blocked — give up and pick a new target next cycle
          this.wanderActive = false;
        } else if (
          Math.hypot(this.x - this.wanderTargetX, this.y - this.wanderTargetY) < TILE_SIZE
        ) {
          this.wanderActive = false;
        }
      } else if (this.stationaryFrames >= WANDER_STATIONERY_THRESHOLD) {
        const angle = Math.random() * Math.PI * 2;
        const dist =
          TILE_SIZE * (WANDER_DISTANCE_TILES_MIN + Math.random() * WANDER_DISTANCE_TILES_RANGE);
        this.wanderTargetX = this.spawnX + Math.cos(angle) * dist;
        this.wanderTargetY = this.spawnY + Math.sin(angle) * dist;
        this.wanderActive = true;
        this.stationaryFrames = 0;
      } else {
        this.isMoving = false;
      }
    }
  }

  private triggerVomit(): void {
    const count = randomInt(VOMIT_COUNT_MIN, VOMIT_COUNT_MAX);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist =
        TILE_SIZE * (VOMIT_SPAWN_RANGE_TILES_MIN + Math.random() * VOMIT_SPAWN_RANGE_TILES_RANGE);
      this.cockroachSpawns.push({
        x: this.x + TILE_SIZE * CENTER_OFFSET + Math.cos(angle) * dist,
        y: this.y + TILE_SIZE * CENTER_OFFSET + Math.sin(angle) * dist,
      });
    }
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' = 'melee',
  ): void {
    const prevHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < prevHp) this.damageSoundPending = true;
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'trollskin_shirt', quantity: 1 });
    return items;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawHoarderSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.facingX,
      this.facingY,
      this.walkFrame,
      this.isMoving,
      this.isWindingUp,
      this.vomitWindupProgress,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
