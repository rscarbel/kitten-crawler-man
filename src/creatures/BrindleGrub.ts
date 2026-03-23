import { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { randomInt, normalize } from '../utils';
import {
  drawBrindleGrubSprite,
  drawCowTailedGrubSprite,
  drawBrindledVespaSprite,
  drawAcidSpit,
} from '../sprites/brindleGrubSprite';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE1_HP = 4;
const STAGE2_HP = 10;
const STAGE3_HP = 30;

const STAGE1_SPEED = 0.3;
const STAGE2_SPEED = 0.5;
const STAGE3_SPEED = 1.55;

/** Stage 1 evolves after 10–25 seconds (at 60 fps). */
const STAGE1_EVOLVE_MIN = 600;
const STAGE1_EVOLVE_MAX = 1500;
/** Stage 2 evolves after 20–40 seconds. */
const STAGE2_EVOLVE_MIN = 1200;
const STAGE2_EVOLVE_MAX = 2400;

const VESPA_AGGRO_TILES = 10;
const VESPA_SPIT_RANGE_TILES = 6;
const VESPA_SPIT_SPEED = 3.5;
const VESPA_SPIT_DAMAGE = 3;
const VESPA_SPIT_COOLDOWN = 100; // ~1.7 s
const VESPA_SPIT_TTL = 220;
const VESPA_HIT_FADE = 5; // TTL decrease per frame once hit

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GrubStage = 1 | 2 | 3;

export interface AcidSpit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  hit: boolean;
}

// ---------------------------------------------------------------------------
// BrindleGrub
// ---------------------------------------------------------------------------

/**
 * Three-stage lifecycle mob that spawns from enemy deaths on level 2.
 *
 *   Stage 1 – Brindle Grub      : passive worm, no damage, 4 HP, 0 XP
 *   Stage 2 – Cow-Tailed Grub   : weak melee bite, 10 HP, 2 XP
 *   Stage 3 – Brindled Vespa    : hornet, acid-spit ranged, 30 HP, 22 XP
 *                                  attacks players AND other mobs; attacked
 *                                  mobs will retaliate.
 */
export class BrindleGrub extends Mob {
  stage: GrubStage = 1;
  private evolveTimer: number;
  private spitCooldown = 0;

  /** Active acid-spit projectiles (Vespa stage only). */
  readonly spits: AcidSpit[] = [];

  /**
   * Populated each frame by DungeonScene so the Vespa can find mob targets
   * in addition to the player targets passed to updateAI.
   */
  allMobs: Mob[] = [];

  // XP is stage-dependent — implemented as a getter to satisfy the abstract.
  get xpValue(): number {
    return this.stage === 3 ? 22 : this.stage === 2 ? 2 : 0;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, STAGE1_HP, STAGE1_SPEED);
    this.evolveTimer = randomInt(STAGE1_EVOLVE_MIN, STAGE1_EVOLVE_MAX);
    this.displayName = 'Brindle Grub';
    this.description = 'A harmless wriggling larva. It seems to be growing...';
  }

  /** Grubs drop nothing. */
  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Evolution
  // ---------------------------------------------------------------------------

  private evolveToStage2(): void {
    this.stage = 2;
    this.speed = STAGE2_SPEED;
    this.maxHp = STAGE2_HP;
    this.hp = STAGE2_HP;
    this.evolveTimer = randomInt(STAGE2_EVOLVE_MIN, STAGE2_EVOLVE_MAX);
    this.displayName = 'Cow-Tailed Grub';
    this.description = 'A bigger, angrier grub with a painful bite.';
  }

  private evolveToStage3(): void {
    this.stage = 3;
    this.speed = STAGE3_SPEED;
    this.maxHp = STAGE3_HP;
    this.hp = STAGE3_HP;
    this.evolveTimer = -1; // no further evolution
    this.displayName = 'Brindled Vespa';
    this.description = 'A fully-evolved hornet that spits corrosive acid at anything nearby.';
  }

  // ---------------------------------------------------------------------------
  // AI
  // ---------------------------------------------------------------------------

  /**
   * Ticks the evolution timer regardless of whether the grub is in the active
   * AI radius. Called every frame for all alive BrindleGrubs in DungeonScene.
   */
  tickEvolve(): void {
    if (!this.isAlive || this.stage >= 3) return;
    this.evolveTimer--;
    if (this.evolveTimer <= 0) {
      if (this.stage === 1) this.evolveToStage2();
      else this.evolveToStage3();
    }
  }

  updateAI(playerTargets: Player[]): void {
    if (!this.isAlive) return;

    if (this.stage < 3) {
      // evolveTimer is ticked by tickEvolve() separately (works off-screen too)

      if (this.stage === 1) {
        // Stage 1: wander passively, never attack
        this.doWander();
      } else {
        // Stage 2: weak melee chase
        this.updateStage2AI(playerTargets);
      }
      return;
    }

    // Stage 3 — Brindled Vespa
    this.updateVespaAI(playerTargets);
  }

  // ---------------------------------------------------------------------------
  // Stage 2 AI — slow weak melee
  // ---------------------------------------------------------------------------

  private updateStage2AI(playerTargets: Player[]): void {
    const ts = this.tileSize;
    const aggroRange = ts * 5;
    const attackRange = ts * 1.1;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of playerTargets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < aggroRange && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }
    this.currentTarget = nearest;

    if (!nearest) {
      this.doWander();
      return;
    }

    this.updateLastKnown(nearest);

    if (nearestDist > attackRange) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        attackRange * 0.8,
      );
    } else {
      this.isMoving = false;
      if (this.spitCooldown <= 0) {
        this.dealDamage(nearest, 1); // very weak bite
        this.spitCooldown = 80;
      }
    }

    if (this.spitCooldown > 0) this.spitCooldown--;
  }

  // ---------------------------------------------------------------------------
  // Stage 3 AI — Vespa acid spit
  // ---------------------------------------------------------------------------

  private updateVespaAI(playerTargets: Player[]): void {
    const ts = this.tileSize;

    if (this.spitCooldown > 0) this.spitCooldown--;

    // Advance projectiles
    for (const spit of this.spits) {
      if (spit.hit) {
        spit.ttl -= VESPA_HIT_FADE;
        continue;
      }
      const nx = Math.floor(spit.x / ts);
      const ny = Math.floor(spit.y / ts);
      if (this.map && !this.map.isWalkable(nx, ny)) {
        spit.hit = true;
        continue;
      }
      spit.x += spit.vx;
      spit.y += spit.vy;
      spit.ttl--;

      // Check hit against all potential targets
      const mobTargets = this.allMobs.filter((m) => m !== this && m.isAlive);
      for (const t of [...playerTargets, ...mobTargets]) {
        if (!t.isAlive) continue;
        const cx = t.x + ts * 0.5;
        const cy = t.y + ts * 0.5;
        if (Math.hypot(spit.x - cx, spit.y - cy) < ts * 0.52) {
          if (t instanceof Mob) {
            t.takeDamageFrom(VESPA_SPIT_DAMAGE, this, 'missile');
            // Mark mob to retaliate against this Vespa
            t.retaliateMob = this;
          } else {
            t.takeDamage(VESPA_SPIT_DAMAGE);
          }
          spit.hit = true;
          break;
        }
      }
    }

    // Prune dead spits
    for (let i = this.spits.length - 1; i >= 0; i--) {
      if (this.spits[i].ttl <= 0) this.spits.splice(i, 1);
    }

    // Build combined target list (players + live non-grub mobs)
    const aggroRange = ts * VESPA_AGGRO_TILES;
    const allTargets: Player[] = [
      ...playerTargets,
      ...this.allMobs.filter(
        (m) =>
          m !== this &&
          m.isAlive &&
          !(m instanceof BrindleGrub) &&
          Math.hypot(m.x - this.x, m.y - this.y) < aggroRange,
      ),
    ];

    // Find nearest target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of allTargets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < aggroRange && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }
    this.currentTarget = nearest;

    if (!nearest) {
      this.doWander();
      return;
    }

    this.updateLastKnown(nearest);

    const spitRange = ts * VESPA_SPIT_RANGE_TILES;
    if (nearestDist > spitRange) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        spitRange * 0.8,
      );
    } else {
      this.isMoving = false;
      this._faceToward(nearest);
    }

    // Fire acid spit
    if (nearestDist <= spitRange && this.spitCooldown === 0 && this.hasLOS(nearest)) {
      const cx = this.x + ts * 0.5;
      const cy = this.y + ts * 0.5;
      const tx = nearest.x + ts * 0.5;
      const ty = nearest.y + ts * 0.5;
      const dx = tx - cx;
      const dy = ty - cy;
      const n = normalize(dx, dy);
      this.spits.push({
        x: cx,
        y: cy,
        vx: n.x * VESPA_SPIT_SPEED,
        vy: n.y * VESPA_SPIT_SPEED,
        ttl: VESPA_SPIT_TTL,
        hit: false,
      });
      this.spitCooldown = VESPA_SPIT_COOLDOWN;
    }
  }

  private _faceToward(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    // Render acid spits (behind mob sprite for Vespa)
    if (this.stage === 3) {
      for (const spit of this.spits) {
        drawAcidSpit(ctx, spit.x - camX, spit.y - camY, spit.hit);
      }
    }

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    switch (this.stage) {
      case 1:
        drawBrindleGrubSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving);
        break;
      case 2:
        drawCowTailedGrubSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving);
        break;
      case 3:
        drawBrindledVespaSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving, this.facingX);
        break;
    }

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
