import type { Player } from '../Player';
import { Mob } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import type { LootDrop } from './Mob';
import { randomInt, normalize } from '../utils';
import { drawBrindleGrubSprite, drawCowTailedGrubSprite } from '../sprites/brindleGrubSprite';
import {
  BRINDLED_VESPA_BODY_PART_KEY,
  drawAcidSpit,
  drawBrindledVespaSprite,
} from '../sprites/brindledVespaSprite';

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
/**
 * How long the Vespa rears back before the acid actually launches. Exactly
 * double the `spit_windup` row's frame count baked by
 * `scripts/generate-brindled-vespa-sprite.ts` — each baked frame is held for
 * two game ticks — tuned to read as a wasp rearing back rather than a hitch
 * in the fight's pacing.
 */
const VESPA_SPIT_WINDUP_FRAMES = 18;
const XP_STAGE3 = 22;
const XP_STAGE2 = 2;
const STAGE_COW_TAILED = 2;
const STAGE_VESPA = 3;
const CENTER_OFFSET = 0.5;
const PLAYER_HITBOX_RADIUS_RATIO = 0.52;
const STAGE2_AGGRO_TILES = 5;
const STAGE2_ATTACK_RANGE_MULTIPLIER = 1.1;
const STAGE2_FOLLOW_STOP_RANGE_RATIO = 0.8;
const STAGE2_BITE_DAMAGE = 1;
const STAGE2_BITE_COOLDOWN = 80;
/**
 * Exactly double the `attack*` row length baked by
 * `scripts/generate-brindle-grub-sprite.ts` — each baked frame is held for
 * two game ticks.
 */
const STAGE2_BITE_ANIM_FRAMES = 14;
const VESPA_FOLLOW_STOP_RANGE_RATIO = 0.8;

export type GrubStage = 1 | 2 | 3;

export interface AcidSpit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  hit: boolean;
  /** Frames elapsed since impact; drives the splash animation once `hit` is true. */
  hitAge: number;
}

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
  /** >0 while the Vespa is charging up a spit; counts down to 0, which fires it. */
  private spitWindupTimer = 0;
  /** >0 while the cow-tailed grub's bite-strike animation is playing. */
  private biteAnimTimer = 0;

  /** Active acid-spit projectiles (Vespa stage only). */
  readonly spits: AcidSpit[] = [];

  /**
   * Squishy bug stages leave no severed parts — the user's call: the generic
   * gore burst and blood puddle `GoreSystem` already fires on every death is
   * sufficient for stages 1 and 2. Only the fully-evolved Vespa gets a real
   * body-part set, set at the moment it evolves in `evolveToStage3()`.
   */
  override bodyPartKey: string | null = null;

  /**
   * Populated each frame by DungeonScene so the Vespa can find mob targets
   * in addition to the player targets passed to updateAI.
   */
  allMobs: Mob[] = [];

  // XP is stage-dependent — implemented as a getter to satisfy the abstract.
  get xpValue(): number {
    return this.stage === STAGE_VESPA ? XP_STAGE3 : this.stage === STAGE_COW_TAILED ? XP_STAGE2 : 0;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, STAGE1_HP, STAGE1_SPEED);
    this.evolveTimer = randomInt(STAGE1_EVOLVE_MIN, STAGE1_EVOLVE_MAX);
    this.displayName = 'Brindle Grub';
    this.description = 'A harmless wriggling larva. It seems to be growing...';
  }

  override get mobType(): string {
    if (this.stage === STAGE_VESPA) return 'BrindledVespa';
    if (this.stage === STAGE_COW_TAILED) return 'CowTailedGrub';
    return 'BrindleGrub';
  }

  /** Grubs drop nothing but, very rarely, the book on eating anything. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'skill_book_iron_stomach');
    return items;
  }

  private evolveToStage2(): void {
    this.stage = 2;
    this.speed = STAGE2_SPEED;
    this.setFixedMaxHp(STAGE2_HP);
    this.hp = STAGE2_HP;
    this.evolveTimer = randomInt(STAGE2_EVOLVE_MIN, STAGE2_EVOLVE_MAX);
    this.displayName = 'Cow-Tailed Grub';
    this.description = 'A bigger, angrier grub with a painful bite.';
  }

  private evolveToStage3(): void {
    this.stage = 3;
    this.speed = STAGE3_SPEED;
    this.setFixedMaxHp(STAGE3_HP);
    this.hp = STAGE3_HP;
    this.evolveTimer = -1; // no further evolution
    this.isFlying = true;
    this.displayName = 'Brindled Vespa';
    this.description = 'A fully-evolved hornet that spits corrosive acid at anything nearby.';
    this.bodyPartKey = BRINDLED_VESPA_BODY_PART_KEY;
  }

  /**
   * Ticks the evolution timer regardless of whether the grub is in the active
   * AI radius. Called every frame for all alive BrindleGrubs in DungeonScene.
   */
  tickEvolve(): void {
    if (!this.isAlive || this.stage >= STAGE_VESPA) return;
    this.evolveTimer--;
    if (this.evolveTimer <= 0) {
      if (this.stage === 1) this.evolveToStage2();
      else this.evolveToStage3();
    }
  }

  updateAI(playerTargets: Player[]): void {
    if (!this.isAlive) return;

    if (this.stage < STAGE_VESPA) {
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

  private updateStage2AI(playerTargets: Player[]): void {
    if (this.biteAnimTimer > 0) this.biteAnimTimer--;

    const ts = this.tileSize;
    const aggroRange = ts * STAGE2_AGGRO_TILES;
    const attackRange = ts * STAGE2_ATTACK_RANGE_MULTIPLIER;

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
        attackRange * STAGE2_FOLLOW_STOP_RANGE_RATIO,
      );
    } else {
      this.isMoving = false;
      if (this.spitCooldown <= 0) {
        this.dealDamage(nearest, STAGE2_BITE_DAMAGE); // very weak bite
        this.spitCooldown = STAGE2_BITE_COOLDOWN;
        this.biteAnimTimer = STAGE2_BITE_ANIM_FRAMES;
      }
    }

    if (this.spitCooldown > 0) this.spitCooldown--;
  }

  private updateVespaAI(playerTargets: Player[]): void {
    const ts = this.tileSize;

    if (this.spitCooldown > 0) this.spitCooldown--;

    // Advance projectiles
    for (const spit of this.spits) {
      if (spit.hit) {
        spit.ttl -= VESPA_HIT_FADE;
        spit.hitAge++;
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
      const mobTargets = this.allMobs.filter(
        (m) => m !== this && m.isAlive && !(m instanceof BrindleGrub),
      );
      for (const t of [...playerTargets, ...mobTargets]) {
        if (!t.isAlive) continue;
        const cx = t.x + ts * CENTER_OFFSET;
        const cy = t.y + ts * CENTER_OFFSET;
        if (Math.hypot(spit.x - cx, spit.y - cy) < ts * PLAYER_HITBOX_RADIUS_RATIO) {
          if (t instanceof Mob) {
            t.takeDamageFrom(VESPA_SPIT_DAMAGE, this, 'missile');
            // Mark mob to retaliate against this Vespa
            t.retaliateMob = this;
          } else {
            this.dealDamage(t, VESPA_SPIT_DAMAGE, 'spit');
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
        spitRange * VESPA_FOLLOW_STOP_RANGE_RATIO,
      );
    } else {
      this.isMoving = false;
      this._faceToward(nearest);
    }

    // The charge-up: once started, the Vespa holds still and keeps facing its
    // target until the wind-up completes, then the acid actually launches.
    if (this.spitWindupTimer > 0) {
      this.isMoving = false;
      this._faceToward(nearest);
      this.spitWindupTimer--;
      if (this.spitWindupTimer === 0) this._releaseAcidSpit(nearest, ts);
    } else if (nearestDist <= spitRange && this.spitCooldown === 0 && this.hasLOS(nearest)) {
      this.isMoving = false;
      this._faceToward(nearest);
      this.spitWindupTimer = VESPA_SPIT_WINDUP_FRAMES;
      this.spitCooldown = VESPA_SPIT_COOLDOWN;
    }
  }

  private _releaseAcidSpit(target: Player, tileSize: number): void {
    const cx = this.x + tileSize * CENTER_OFFSET;
    const cy = this.y + tileSize * CENTER_OFFSET;
    const tx = target.x + tileSize * CENTER_OFFSET;
    const ty = target.y + tileSize * CENTER_OFFSET;
    const n = normalize(tx - cx, ty - cy);
    this.spits.push({
      x: cx,
      y: cy,
      vx: n.x * VESPA_SPIT_SPEED,
      vy: n.y * VESPA_SPIT_SPEED,
      ttl: VESPA_SPIT_TTL,
      hit: false,
      hitAge: 0,
    });
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

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    // Render acid spits (behind mob sprite for Vespa)
    if (this.stage === STAGE_VESPA) {
      for (const spit of this.spits) {
        drawAcidSpit(
          ctx,
          spit.x - camX,
          spit.y - camY,
          tileSize,
          spit.vx,
          spit.vy,
          spit.hit,
          spit.hitAge,
        );
      }
    }

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    switch (this.stage) {
      case 1:
        drawBrindleGrubSprite(ctx, sx, sy, tileSize, {
          walkFrame: this.walkFrame,
          isMoving: this.isMoving,
          facingX: this.facingX,
          facingY: this.facingY,
        });
        break;
      case 2:
        drawCowTailedGrubSprite(ctx, sx, sy, tileSize, {
          walkFrame: this.walkFrame,
          isMoving: this.isMoving,
          facingX: this.facingX,
          facingY: this.facingY,
          biteProgress:
            this.biteAnimTimer > 0 ? 1 - this.biteAnimTimer / STAGE2_BITE_ANIM_FRAMES : null,
        });
        break;
      case STAGE_VESPA:
        drawBrindledVespaSprite(ctx, sx, sy, tileSize, {
          facingX: this.facingX,
          facingY: this.facingY,
          spitWindupProgress:
            this.spitWindupTimer > 0 ? 1 - this.spitWindupTimer / VESPA_SPIT_WINDUP_FRAMES : null,
        });
        break;
    }

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
