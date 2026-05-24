import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import {
  drawJuicerSprite,
  drawThrownDumbbell,
  drawJuicerSpeechBubble,
} from '../sprites/juicerSprite';

const JUICER_HP = 120;
const JUICER_SPEED = 1.0;
const JUICER_SPEED_ENRAGED = 1.7;
const AGGRO_RANGE_TILE_MULTIPLIER = 10;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const THROW_RANGE_MIN_TILES = 4;
const THROW_RANGE_MIN = TILE_SIZE * THROW_RANGE_MIN_TILES;
const THROW_RANGE_MAX_TILES = 9;
const THROW_RANGE_MAX = TILE_SIZE * THROW_RANGE_MAX_TILES;
const THROW_SPEED = 7;
const THROW_DAMAGE = 3;
const THROW_WINDUP_FRAMES = 60;
const THROW_COOLDOWN_FRAMES = 90;
const PROJECTILE_TTL = 240;
const THROW_BOUNCE_DAMPING = 0.7;
const ENRAGE_THRESHOLD = 0.4;
const TAUNT_INTERVAL = 300;
/** Frames without attacking before forcing an attack grab. */
const FORCE_ATTACK_FRAMES = 300; // 5 seconds at 60 fps
const COIN_DROP_MIN = 60;
const COIN_DROP_MAX = 120;
const MASS = 10;
const DUMBBELL_PICKUP_RANGE_TILES = 1.2;
const DUMBBELL_FOLLOW_STOP_RANGE_RATIO = 0.8;
const DUMBBELL_SEEK_PATHFIND_MAX = 40;
const NO_DUMBBELL_SPEED_RATIO = 0.7;
const NO_DUMBBELL_STOP_RANGE_TILES = 3;
const NO_DUMBBELL_PATHFIND_MAX = 40;
const THROW_RANGE_FORCE_ATTACK_RATIO = 0.85;
const THROW_PATHFIND_MAX = 40;
const CENTER_OFFSET = 0.5;
const HIT_RADIUS_TILES = 1.5;
const DAMAGE_FLASH = 8;
const BLOCK_XP = 5;

const TAUNT_PHRASES = [
  'Bro',
  'I need a spot, bro',
  "Excuses don't lose calories",
  'What are you doing, bro?',
  'Release the beast',
  'Come at me, bro',
  'Stop it, bro',
];

type JuicerState = 'idle' | 'seeking_dumbbell' | 'pursuing' | 'winding_up' | 'cooldown';

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}

export class Juicer extends Mob {
  readonly xpValue = 600;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Juicer';
  description = 'A roided-up gym rat who hurls dumbbells with reckless abandon.';
  mass = MASS;

  isEnraged = false;

  // State machine
  private state: JuicerState = 'idle';
  private windupTimer = 0;
  private cooldownTimer = 0;
  private framesSinceLastAttack = 0;

  // Dumbbell / throw
  heldDumbbell = false;
  /** Set to signal JuicerRoomSystem to consume a nearby dumbbell pickup. */
  requestDumbbellAt: { x: number; y: number } | null = null;
  /** Target position for the nearest dumbbell (set each frame by JuicerRoomSystem). */
  nearestDumbbellPos: { x: number; y: number } | null = null;

  /** Active thrown projectile (null if not in flight). */
  private activeThrow: Projectile | null = null;
  throwAnim = 0; // 0–1 for sprite animation

  // Taunts
  private tauntPhrases = TAUNT_PHRASES;
  private tauntIndex = 0;
  private tauntTimer = 0;
  currentTaunt: string | null = null;

  /** Set when a dumbbell is thrown; DungeonScene reads and clears it to play the throw sound. */
  throwSoundPending = false;
  private bubblePulse = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, JUICER_HP, JUICER_SPEED);
    this.isBoss = true;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.framesSinceLastAttack++;

    // Enrage check
    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
      this.speed = JUICER_SPEED_ENRAGED;
    }

    // Update thrown projectile physics
    this.updateProjectile(targets);

    // Find nearest living target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if ((this.forceAggro || d < AGGRO_RANGE_PX) && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    // Taunt cycling when aggro'd
    if (nearest) {
      this.tauntTimer++;
      this.bubblePulse++;
      if (this.tauntTimer >= TAUNT_INTERVAL || this.currentTaunt === null) {
        this.currentTaunt = this.tauntPhrases[this.tauntIndex];
        this.tauntIndex = (this.tauntIndex + 1) % this.tauntPhrases.length;
        this.tauntTimer = 0;
      }
    } else {
      this.currentTaunt = null;
      this.tauntTimer = 0;
    }

    // State machine
    switch (this.state) {
      case 'idle':
        this.doIdleState(nearest);
        break;
      case 'seeking_dumbbell':
        this.doSeekDumbbellState(nearest);
        break;
      case 'pursuing':
        this.doPursuingState(nearest, nearestDist);
        break;
      case 'winding_up':
        this.doWindupState(nearest);
        break;
      case 'cooldown':
        this.doCooldownState(nearest);
        break;
    }
  }

  private doIdleState(nearest: Player | null): void {
    if (nearest) {
      this.state = 'seeking_dumbbell';
    } else {
      this.doWander();
    }
  }

  private doSeekDumbbellState(nearest: Player | null): void {
    if (!nearest) {
      this.state = 'idle';
      return;
    }

    if (this.heldDumbbell) {
      this.state = 'pursuing';
      return;
    }

    // Navigate to nearest dumbbell position
    if (this.nearestDumbbellPos) {
      const dist = Math.hypot(
        this.nearestDumbbellPos.x - this.x,
        this.nearestDumbbellPos.y - this.y,
      );
      if (dist < TILE_SIZE * DUMBBELL_PICKUP_RANGE_TILES) {
        // Close enough — request pickup
        this.requestDumbbellAt = {
          x: this.nearestDumbbellPos.x,
          y: this.nearestDumbbellPos.y,
        };
      } else {
        this.followTargetAStar(
          this.nearestDumbbellPos.x,
          this.nearestDumbbellPos.y,
          this.speed,
          TILE_SIZE * DUMBBELL_FOLLOW_STOP_RANGE_RATIO,
          DUMBBELL_SEEK_PATHFIND_MAX,
        );
      }
    } else {
      // No dumbbell available — pursue with melee approach (wait near player)
      this.updateLastKnown(nearest);
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed * NO_DUMBBELL_SPEED_RATIO,
        TILE_SIZE * NO_DUMBBELL_STOP_RANGE_TILES,
        NO_DUMBBELL_PATHFIND_MAX,
      );
    }
  }

  private doPursuingState(nearest: Player | null, nearestDist: number): void {
    if (!nearest) {
      this.state = 'idle';
      return;
    }
    if (!this.heldDumbbell) {
      this.state = 'seeking_dumbbell';
      return;
    }

    this.updateLastKnown(nearest);

    const forceAttack = this.framesSinceLastAttack >= FORCE_ATTACK_FRAMES;

    // In throw range and has LOS → wind up (force-attack ignores minimum range)
    if (
      (nearestDist >= THROW_RANGE_MIN || forceAttack) &&
      nearestDist <= THROW_RANGE_MAX &&
      this.hasLOS(nearest)
    ) {
      this.state = 'winding_up';
      this.windupTimer = THROW_WINDUP_FRAMES;
      this.throwAnim = 0;
      return;
    }

    // Too close — back off, but only if not in force-attack mode
    if (!forceAttack && nearestDist < THROW_RANGE_MIN) {
      const dx = this.x - nearest.x;
      const dy = this.y - nearest.y;
      if (dx !== 0 || dy !== 0) {
        const n = normalize(dx, dy);
        this.moveWithCollision(n.x * this.speed, n.y * this.speed);
        this.isMoving = true;
      }
      return;
    }

    // Too far (or forced + no LOS) — chase
    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      forceAttack ? TILE_SIZE : THROW_RANGE_MAX * THROW_RANGE_FORCE_ATTACK_RATIO,
      THROW_PATHFIND_MAX,
    );
  }

  private doWindupState(nearest: Player | null): void {
    if (!nearest || !this.heldDumbbell) {
      this.state = 'idle';
      this.throwAnim = 0;
      return;
    }

    this.isMoving = false;
    this.windupTimer--;
    this.throwAnim = 1 - this.windupTimer / THROW_WINDUP_FRAMES;

    // Face the target during wind-up
    const dx = nearest.x - this.x;
    const dy = nearest.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
    }

    if (this.windupTimer <= 0) {
      this.throwDumbbell(nearest);
    }
  }

  private doCooldownState(nearest: Player | null): void {
    this.isMoving = false;
    this.throwAnim = 0;
    this.cooldownTimer--;

    if (this.cooldownTimer <= 0) {
      this.state = nearest ? 'seeking_dumbbell' : 'idle';
    }
  }

  private throwDumbbell(target: Player): void {
    this.throwSoundPending = true;
    const ts = this.tileSize;
    const ox = this.x + ts * CENTER_OFFSET;
    const oy = this.y + ts * CENTER_OFFSET;
    const tx = target.x + ts * CENTER_OFFSET;
    const ty = target.y + ts * CENTER_OFFSET;
    const d = Math.hypot(tx - ox, ty - oy);
    if (d > 0) {
      this.activeThrow = {
        x: ox,
        y: oy,
        vx: ((tx - ox) / d) * THROW_SPEED,
        vy: ((ty - oy) / d) * THROW_SPEED,
        ttl: PROJECTILE_TTL,
      };
    }
    this.heldDumbbell = false;
    this.throwAnim = 0;
    this.state = 'cooldown';
    this.cooldownTimer = THROW_COOLDOWN_FRAMES;
    this.framesSinceLastAttack = 0;
  }

  private updateProjectile(targets: Player[]): void {
    if (!this.activeThrow) return;
    const proj = this.activeThrow;

    proj.ttl--;
    if (proj.ttl <= 0) {
      this.activeThrow = null;
      return;
    }

    proj.x += proj.vx;
    proj.y += proj.vy;

    // Wall bounce
    if (this.map) {
      const ts = this.tileSize;
      const tileX = Math.floor(proj.x / ts);
      const tileY = Math.floor(proj.y / ts);

      if (!this.map.isWalkable(tileX, tileY)) {
        const prevX = proj.x - proj.vx;
        const prevY = proj.y - proj.vy;
        const prevTX = Math.floor(prevX / ts);
        const prevTY = Math.floor(prevY / ts);

        // Test each axis from the previous (walkable) position so wall-tile
        // coordinates don't corrupt the other axis's check.
        const hitsWallOnX = !this.map.isWalkable(Math.floor((prevX + proj.vx) / ts), prevTY);
        const hitsWallOnY = !this.map.isWalkable(prevTX, Math.floor((prevY + proj.vy) / ts));

        if (hitsWallOnX) proj.vx *= -THROW_BOUNCE_DAMPING;
        if (hitsWallOnY) proj.vy *= -THROW_BOUNCE_DAMPING;
        // Corner hit: neither axis test caught it individually — reflect both.
        if (!hitsWallOnX && !hitsWallOnY) {
          proj.vx *= -THROW_BOUNCE_DAMPING;
          proj.vy *= -THROW_BOUNCE_DAMPING;
        }

        proj.x = prevX + proj.vx;
        proj.y = prevY + proj.vy;

        if (!this.map.isWalkable(Math.floor(proj.x / ts), Math.floor(proj.y / ts))) {
          this.activeThrow = null;
          return;
        }
      }
    }

    // Check player hit
    const ts = this.tileSize;
    const hitRadius = ts * HIT_RADIUS_TILES;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const tcx = t.x + ts * CENTER_OFFSET;
      const tcy = t.y + ts * CENTER_OFFSET;
      const dx = proj.x - tcx;
      const dy = proj.y - tcy;
      if (Math.hypot(dx, dy) < hitRadius) {
        if (this.spells?.isPointInsideShell(tcx, tcy)) {
          this.spells.addBlockXp(BLOCK_XP);
          this.activeThrow = null;
          return;
        }
        this.dealDamage(t, THROW_DAMAGE);
        t.damageFlash = DAMAGE_FLASH;
        this.activeThrow = null;
        return;
      }
    }
  }

  /** Called by JuicerRoomSystem when it confirms a dumbbell was picked up. */
  onDumbbellPickedUp(): void {
    this.heldDumbbell = true;
    this.requestDumbbellAt = null;
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    // Guaranteed crown drop
    items.push({ id: 'enchanted_crown_sepsis_whore', quantity: 1 });
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

    drawJuicerSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      this.throwAnim,
      this.facingX,
      this.facingY,
      this.isEnraged,
      this.heldDumbbell,
    );

    ctx.filter = 'none';
    ctx.restore();

    // Speech bubble (outside save/restore so filter doesn't affect it)
    if (this.currentTaunt) {
      drawJuicerSpeechBubble(ctx, sx, sy, tileSize, this.currentTaunt, this.bubblePulse);
    }

    // Active throw projectile
    if (this.activeThrow) {
      drawThrownDumbbell(
        ctx,
        this.activeThrow.x,
        this.activeThrow.y,
        camX,
        camY,
        tileSize,
        this.activeThrow.vx,
        this.activeThrow.vy,
      );
    }

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
