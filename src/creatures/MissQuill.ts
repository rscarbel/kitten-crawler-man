import { Mob } from './Mob';
import type { Player } from '../Player';
import type { Remex } from './Remex';
import { drawMissQuillSprite } from '../sprites/missQuillSprite';
import { type SoulBolt, fireSoulBolt, advanceSoulBolts, renderSoulBolts } from './soulBolt';
import { Krasue } from './Krasue';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import { questMobLevel } from '../systems/questMobLevel';

const QUILL_HP = 260;
/** She holds her office floor — a headmistress does not chase. */
const QUILL_SPEED = 0;

/**
 * How far her soul bolts reach. Exported because it is half of the contract the
 * tower confrontation's spawn offsets have to satisfy — the arrival tile has to
 * sit outside it — and a gate measuring against a copied number would go green
 * the day this one moved.
 */
export const MISS_QUILL_CAST_RANGE_TILES = 8;
/** Frames between soul-bolt volleys (~1.8 s at 60 fps). */
const CAST_COOLDOWN = 110;
const CAST_ANIM_FRAMES = 26;
const BOLT_DAMAGE = 8;

/** Krasue summon cadence (~9 s at 60 fps) and the cap on simultaneous heads. */
const SUMMON_COOLDOWN_FRAMES = 540;
const MAX_LIVE_SUMMONS = 3;
const SUMMON_LEVEL = 5;
const SUMMON_SPAWN_OFFSET_TILES = 2;
const SUMMON_SPAWN_SEARCH_RADIUS_TILES = 4;

/** Frames the "hit while shielded" flash plays — feedback that damage was blocked. */
const SHIELD_HIT_FLASH_FRAMES = 8;
/** Frames the health bar stays visible after a blocked hit. */
const SHIELD_HIT_HEALTHBAR_FRAMES = 180;

const COIN_DROP_MIN = 25;
const COIN_DROP_MAX = 50;
const CENTER_OFFSET = 0.5;

/**
 * Miss Quill — the sky fowl schoolteacher revealed as the necromancer behind
 * the krasue murders, and the boss of the tower confrontation. A stationary
 * caster: soul-bolt volleys, periodic krasue summons, and — while her
 * husband-capacitor Remex stands — total invulnerability (pattern:
 * Grimaldi's tendril shield).
 */
export class MissQuill extends Mob {
  readonly xpValue = 600;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Miss Quill';
  description =
    'The sky fowl schoolteacher, prim to the last button — every krasue in the city was her handiwork.';

  private capacitor: Remex | null = null;
  private shielded = false;
  private bolts: SoulBolt[] = [];

  override clearAirborneAttacks(): void {
    this.bolts.length = 0;
  }
  private castCooldown = 0;
  private castAnimTimer = 0;
  private summonCooldown = SUMMON_COOLDOWN_FRAMES;
  private shieldHitFlashTimer = 0;
  private readonly summons: Krasue[] = [];
  private readonly addMob: (mob: Mob) => void;
  /**
   * The party level her summons are levelled against. Set by the encounter that
   * spawns her — she outlives no scene, so there is nothing to keep it current.
   */
  summonPartyLevel = 1;

  constructor(tileX: number, tileY: number, tileSize: number, addMob: (mob: Mob) => void) {
    super(tileX, tileY, tileSize, QUILL_HP, QUILL_SPEED);
    this.isBoss = true;
    this.addMob = addMob;
  }

  /** Bind the Remex capacitor — Quill's invulnerability tracks his survival. */
  setCapacitor(capacitor: Remex): void {
    this.capacitor = capacitor;
    this.shielded = capacitor.isAlive;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.shielded = this.capacitor?.isAlive ?? false;
    this.bolts = [];
    this.castCooldown = 0;
    this.castAnimTimer = 0;
    this.summonCooldown = SUMMON_COOLDOWN_FRAMES;
    this.shieldHitFlashTimer = 0;
    // The restore deletes every krasue summoned since the checkpoint, including
    // live ones. Holding those references would keep counting them against the
    // summon cap forever, until Quill stops summoning altogether.
    this.summons.length = 0;
  }

  get isShielded(): boolean {
    return this.shielded;
  }

  /**
   * Her krasue answer to her alone — nothing else in the boss room accounts
   * for them, so `QuillConfrontationSystem`'s reveal beat (input locked,
   * nothing hostile expected to be alive) would otherwise start with live
   * summons still on the field. Killing them through the normal damage path
   * keeps them off the mob grid and out of `resolveKills` with no special
   * casing needed elsewhere.
   */
  override dispose(): void {
    super.dispose();
    for (const krasue of this.summons) {
      if (krasue.isAlive) krasue.takeDamageFrom(krasue.hp, null, null);
    }
  }

  protected override onDamageBlocked(): void {
    this.shieldHitFlashTimer = SHIELD_HIT_FLASH_FRAMES;
    this.healthBarTimer = SHIELD_HIT_HEALTHBAR_FRAMES;
  }

  protected override get isDamageImmune(): boolean {
    return this.shielded;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.shielded = this.capacitor?.isAlive ?? false;
    if (this.shieldHitFlashTimer > 0) this.shieldHitFlashTimer--;
    if (this.castCooldown > 0) this.castCooldown--;
    if (this.castAnimTimer > 0) this.castAnimTimer--;
    if (this.summonCooldown > 0) this.summonCooldown--;
    this.isMoving = false;

    this.bolts = advanceSoulBolts(this.bolts, this.map, this.tileSize, targets, (t) =>
      this.dealRangedDamage(t, BOLT_DAMAGE),
    );

    const castRangePx = this.tileSize * MISS_QUILL_CAST_RANGE_TILES;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < castRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;
    if (!nearest) return;

    const handX = this.x + this.tileSize * CENTER_OFFSET;
    const handY = this.y + this.tileSize * CENTER_OFFSET;
    const targetCX = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCY = nearest.y + this.tileSize * CENTER_OFFSET;
    this.facingX = targetCX >= handX ? 1 : -1;

    const hasLOS = this.map ? this.map.hasLineOfSight(handX, handY, targetCX, targetCY) : true;

    if (hasLOS && this.castCooldown === 0) {
      this.bolts.push(fireSoulBolt(handX, handY, targetCX, targetCY));
      this.castCooldown = CAST_COOLDOWN;
      this.castAnimTimer = CAST_ANIM_FRAMES;
      this.projectileSoundPending = true;
    }

    if (this.summonCooldown === 0 && this.map) {
      this.summonCooldown = SUMMON_COOLDOWN_FRAMES;
      const liveSummons = this.summons.filter((k) => k.isAlive).length;
      if (liveSummons < MAX_LIVE_SUMMONS) {
        const spawnTile = findNearbyWalkableTile(
          this.map,
          Math.round(this.x / this.tileSize) + SUMMON_SPAWN_OFFSET_TILES * this.facingX,
          Math.round(this.y / this.tileSize),
          SUMMON_SPAWN_SEARCH_RADIUS_TILES,
        );
        if (spawnTile) {
          const krasue = new Krasue(spawnTile.x, spawnTile.y, this.tileSize);
          krasue.setMap(this.map);
          krasue.ignoresTownSafeZone = true;
          krasue.applyMobLevel(questMobLevel(SUMMON_LEVEL, this.summonPartyLevel));
          applyActiveDifficultyRewards(krasue);
          this.addMob(krasue);
          this.summons.push(krasue);
          this.castAnimTimer = CAST_ANIM_FRAMES;
        }
      }
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;

    renderSoulBolts(ctx, this.bolts, camX, camY);

    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0 || this.shieldHitFlashTimer > 0) {
      ctx.filter = 'brightness(3)';
    }

    const castAnim = this.castAnimTimer > 0 ? 1 - this.castAnimTimer / CAST_ANIM_FRAMES : 0;
    drawMissQuillSprite(ctx, sx, sy, tileSize, castAnim, this.shielded, this.facingX);

    if (this.damageFlash > 0 || this.shieldHitFlashTimer > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
