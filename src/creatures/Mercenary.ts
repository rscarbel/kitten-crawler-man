import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawClubNpc, type ClubNpcVariant } from '../sprites/clubNpcSprite';
import {
  getMercenaryTemplate,
  type MercenaryTemplateId,
  type MercenaryTemplate,
} from '../core/mercenaryTemplates';

/**
 * A mercenary hired at the Desperado Club's "Meat Shields" guild — a friendly
 * `Mob` that follows the active player through the overworld and auto-attacks
 * nearby hostiles, never the players.
 *
 * The AI follows the Mongo template (chase the nearest hostile within aggro
 * range of the owner, leash back when it strays too far). Unlike Mongo it does
 * **not** recall at low HP: a merc fights to the death, and its death clears the
 * roster (a coin sink with real stakes). Its owner is reassigned each frame by
 * `MercenarySystem` so it trails whichever character is active.
 */

const AGGRO_RADIUS_TILES = 12;
const STRIKE_RANGE_TILES = 0.9;
const ATTACK_COOLDOWN_FRAMES = 45;
const LEASH_RADIUS_TILES = 14;
const RETURN_THRESHOLD_TILES = 1.5;
const RETURN_STOP_TILES = 1.0;
const CENTER_OFFSET = 0.5;
const FOLLOW_STOP_RANGE_RATIO = 0.7;
const STRIKE_TRIGGER_RANGE_RATIO = 1.2;
const DAMAGE_FLASH_BRIGHTNESS = 'brightness(3)';

/** Each archetype reuses a distinct club-NPC figure until bespoke merc art lands. */
const TEMPLATE_SPRITE: Record<MercenaryTemplateId, ClubNpcVariant> = {
  bruiser: 'sledge',
  enforcer: 'vip',
  berserker: 'merchant',
};

export class Mercenary extends Mob {
  readonly xpValue = 0; // ally — no XP on death
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;
  override readonly audioTag = 'mercenary';

  /** The player this merc currently trails — reassigned each frame to the active character. */
  owner: Player;
  /** All mobs in the scene — set each frame by MercenarySystem so the merc can pick a target. */
  allMobs: Mob[] = [];

  readonly template: MercenaryTemplate;
  private readonly strikeDamage: number;
  private readonly spriteVariant: ClubNpcVariant;

  private attackCooldown = 0;
  private animPhase = 0;
  private readonly aggroRangePx: number;
  private readonly strikeRangePx: number;
  private readonly leashPx: number;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    owner: Player,
    templateId: MercenaryTemplateId,
    name: string,
  ) {
    const template = getMercenaryTemplate(templateId);
    super(tileX, tileY, tileSize, template.hp, template.speed);
    this.template = template;
    this.owner = owner;
    this.strikeDamage = template.damage;
    this.spriteVariant = TEMPLATE_SPRITE[templateId];
    this.displayName = name;
    this.description = `A hired ${template.title.toLowerCase()} from the Meat Shields guild.`;
    this.aggroRangePx = tileSize * AGGRO_RADIUS_TILES;
    this.strikeRangePx = tileSize * STRIKE_RANGE_TILES;
    this.leashPx = tileSize * LEASH_RADIUS_TILES;
  }

  /** A hired ally — never hostile to the players. */
  override get isHostile(): boolean {
    return false;
  }

  /** No loot on death — the merc is the coin sink, not a source. */
  protected override rollLootItems(): LootDrop['items'] {
    return [];
  }

  /**
   * AI: the `targets` argument is ignored — the merc builds its own list of
   * hostile mobs from `allMobs`, chasing the nearest within aggro range of the
   * owner but never straying past its leash.
   */
  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.animPhase++;
    if (this.attackCooldown > 0) this.attackCooldown--;

    const ownerCx = this.owner.x + TILE_SIZE * CENTER_OFFSET;
    const ownerCy = this.owner.y + TILE_SIZE * CENTER_OFFSET;

    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      const dOwner = Math.hypot(
        mob.x + TILE_SIZE * CENTER_OFFSET - ownerCx,
        mob.y + TILE_SIZE * CENTER_OFFSET - ownerCy,
      );
      if (dOwner > this.aggroRangePx) continue;
      const d = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = mob;
      }
    }

    const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
    if (!nearest || distToOwner > this.leashPx) {
      if (distToOwner > TILE_SIZE * RETURN_THRESHOLD_TILES) {
        this.followTargetAStar(
          this.owner.x,
          this.owner.y,
          this.speed,
          TILE_SIZE * RETURN_STOP_TILES,
        );
      } else {
        this.isMoving = false;
        this.doWander();
      }
      return;
    }

    this.updateLastKnown(nearest);
    if (nearestDist > this.strikeRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.strikeRangePx * FOLLOW_STOP_RANGE_RATIO,
      );
    } else {
      this.isMoving = false;
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      if (dx !== 0 || dy !== 0) {
        const n = normalize(dx, dy);
        this.facingX = n.x;
        this.facingY = n.y;
      }
    }

    if (
      nearestDist <= this.strikeRangePx * STRIKE_TRIGGER_RANGE_RATIO &&
      this.attackCooldown === 0
    ) {
      nearest.takeDamageFrom(this.strikeDamage, this.owner, 'melee');
      this.attackCooldown = ATTACK_COOLDOWN_FRAMES;
      this.attackSoundPending = true;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = DAMAGE_FLASH_BRIGHTNESS;
    drawClubNpc(ctx, sx, sy, tileSize, this.spriteVariant, this.animPhase, this.facingX);
    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
