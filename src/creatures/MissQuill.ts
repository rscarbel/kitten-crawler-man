import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import type { Remex } from './Remex';
import { drawMissQuillSprite } from '../sprites/missQuillSprite';
import { type SoulBolt, fireSoulBolt, advanceSoulBolts, renderSoulBolts } from './soulBolt';
import { Krasue } from './Krasue';
import { findNearbyWalkableTile } from '../map/findWalkableTile';

const QUILL_HP = 260;
/** She holds her office floor — a headmistress does not chase. */
const QUILL_SPEED = 0;

const CAST_RANGE_TILES = 8;
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
 * Miss Quill — the town schoolteacher revealed as the necromancer behind the
 * krasue murders, and the boss of the tower confrontation. A stationary
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
    'The town schoolteacher, prim to the last button — every krasue in the city was her handiwork.';

  private capacitor: Remex | null = null;
  private shielded = false;
  private bolts: SoulBolt[] = [];
  private castCooldown = 0;
  private castAnimTimer = 0;
  private summonCooldown = SUMMON_COOLDOWN_FRAMES;
  private shieldHitFlashTimer = 0;
  private readonly summons: Krasue[] = [];
  private readonly addMob: (mob: Mob) => void;

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

  get isShielded(): boolean {
    return this.shielded;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    if (this.shielded) {
      this.shieldHitFlashTimer = SHIELD_HIT_FLASH_FRAMES;
      this.healthBarTimer = SHIELD_HIT_HEALTHBAR_FRAMES;
      return;
    }
    super.takeDamageFrom(amount, attacker, damageType);
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
      this.dealDamage(t, BOLT_DAMAGE),
    );

    const castRangePx = this.tileSize * CAST_RANGE_TILES;
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
          krasue.applyMobLevel(SUMMON_LEVEL);
          this.addMob(krasue);
          this.summons.push(krasue);
          this.castAnimTimer = CAST_ANIM_FRAMES;
        }
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
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

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
