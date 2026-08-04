import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawClubNpc, type ClubNpcVariant } from '../sprites/clubNpcSprite';
import { drawRockGolemSprite, type GolemAttack } from '../sprites/rockGolemSprite';
import { GOLEM_ATTACK_TIMING, FRAMES_PER_SHEET_FRAME } from './RockGolem';
import type { GolemRockThrow } from '../systems/RockThrowSystem';
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
/** Length of the visible swing — short enough to finish well inside the cooldown. */
const STRIKE_ANIM_FRAMES = 18;
const LEASH_RADIUS_TILES = 14;
/**
 * Follow band. The merc only sets off once the owner is `RETURN_THRESHOLD_TILES`
 * away and parks at `RETURN_STOP_TILES`, so the gap between the two is real
 * hysteresis: a tighter band had it arriving, being nudged out of range by the
 * owner's next step, and re-pathing every frame — which reads on screen as the
 * sprite vibrating against the player's shoulder.
 */
const RETURN_THRESHOLD_TILES = 3.0;
const RETURN_STOP_TILES = 2.2;
const CENTER_OFFSET = 0.5;
const FOLLOW_STOP_RANGE_RATIO = 0.7;
const STRIKE_TRIGGER_RANGE_RATIO = 1.2;
const DAMAGE_FLASH_BRIGHTNESS = 'brightness(3)';
/** The golem's fists reach a little further than a swordsman's blade. */
const GOLEM_REACH_RATIO = 1.6;

/**
 * The two non-golem archetypes reuse a club-NPC figure until bespoke merc art
 * lands. The bruiser no longer appears here: it *is* a rock golem, and it draws
 * from the golem sheet with the golem's own rows.
 */
const TEMPLATE_SPRITE: Record<Exclude<MercenaryTemplateId, 'bruiser'>, ClubNpcVariant> = {
  enforcer: 'vip',
  berserker: 'merchant',
};

/**
 * The bruiser fights with the rock golem's kit — the same slam/stomp
 * alternation and the same boulder throw, off the same shared timing table.
 *
 * Per Ryan, a hired meat shield shares the golem's animations and attacks; the
 * club's Sledge is a rock golem, so the thing you hire from behind him is one
 * too. It stays a `Mercenary` rather than becoming a `RockGolem` subclass
 * because everything that makes a merc a merc — the owner it trails, the leash,
 * the roster that dies with it — lives on this class and in `MercenarySystem`,
 * and moving that under the golem hierarchy would be a far larger change than
 * driving three animation rows from here.
 */
const GOLEM_TEMPLATE = 'bruiser' as const;

/** Audio tags `playMobAudioCues` switches on. */
const MERCENARY_AUDIO_TAG = 'mercenary';
const GOLEM_AUDIO_TAG = 'rock_golem';

/** Range at which the bruiser hurls a boulder instead of closing, in tiles. */
const THROW_MIN_RANGE_TILES = 4;
const THROW_MAX_RANGE_TILES = 9;
/** Frames between the bruiser's thrown rocks. */
const THROW_COOLDOWN_FRAMES = 240;
/** Damage a thrown rock deals, scaled off the template's melee number. */
const THROW_DAMAGE_RATIO = 0.7;
/** Height and reach the boulder leaves the golem at, as fractions of a tile. */
const HAND_OFFSET_X = 0.3;
const HAND_OFFSET_Y = 0.25;
/** The golem sheet is two tiles tall, so a one-tile cull margin clips its head. */
const GOLEM_MERC_CULL_MARGIN_TILES = 2;

const EMPTY_THROWS: readonly GolemRockThrow[] = [];

/** Null for the bruiser, which is drawn from the golem sheet instead. */
function clubNpcVariantFor(templateId: MercenaryTemplateId): ClubNpcVariant | null {
  return templateId === GOLEM_TEMPLATE ? null : TEMPLATE_SPRITE[templateId];
}

export class Mercenary extends Mob {
  readonly xpValue = 0; // ally — no XP on death
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;
  /**
   * Assigned per hire rather than fixed on the class: a bruiser is a rock golem
   * and has to sound like one. Left on the swordsman's cue it plays a blade
   * swing every time it drives two stone fists into the ground.
   */
  override readonly audioTag: string;

  /** The player this merc currently trails — reassigned each frame to the active character. */
  owner: Player;
  /** All mobs in the scene — set each frame by MercenarySystem so the merc can pick a target. */
  allMobs: Mob[] = [];

  readonly template: MercenaryTemplate;
  private readonly strikeDamage: number;
  /** Null for the bruiser, which draws from the golem sheet instead. */
  private readonly spriteVariant: ClubNpcVariant | null;
  private readonly isGolem: boolean;

  /** Golem-kit state; inert on the two archetypes that do not use it. */
  private golemAttack: GolemAttack | null = null;
  private golemAttackFrame = 0;
  private golemAttackResolved = false;
  /** Alternates the two melee attacks, exactly as `RockGolem` does. */
  private lastMelee: GolemAttack = 'stomp';
  private throwCooldown = 0;
  /** Whatever the golem committed its swing to, so the impact frame can land it. */
  private golemVictim: Mob | null = null;
  /**
   * Rocks thrown but not yet handed to `RockThrowSystem`, which drains this
   * every frame. A merc that dies mid-throw must not take the boulder with it.
   */
  private pendingThrows: GolemRockThrow[] = [];
  private readonly throwMinRangePx: number;
  private readonly throwMaxRangePx: number;

  private attackCooldown = 0;
  private animPhase = 0;
  /** Frames left in the strike animation; drives the swing pose while it runs. */
  private strikeAnimFrames = 0;
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
    this.isGolem = templateId === GOLEM_TEMPLATE;
    this.audioTag = this.isGolem ? GOLEM_AUDIO_TAG : MERCENARY_AUDIO_TAG;
    this.spriteVariant = clubNpcVariantFor(templateId);
    this.throwMinRangePx = tileSize * THROW_MIN_RANGE_TILES;
    this.throwMaxRangePx = tileSize * THROW_MAX_RANGE_TILES;
    this.displayName = name;
    this.description = `A hired ${template.title.toLowerCase()} from the Meat Shields guild.`;
    this.aggroRangePx = tileSize * AGGRO_RADIUS_TILES;
    this.strikeRangePx = tileSize * STRIKE_RANGE_TILES;
    this.leashPx = tileSize * LEASH_RADIUS_TILES;
  }

  override get cullMarginTiles(): number {
    return this.isGolem ? GOLEM_MERC_CULL_MARGIN_TILES : super.cullMarginTiles;
  }

  /**
   * Hands over every rock thrown since the last call and clears the queue.
   * `RockThrowSystem` finds this structurally, so a bruiser's boulders fly by
   * exactly the same path a wild golem's do.
   */
  takePendingThrows(): readonly GolemRockThrow[] {
    if (this.pendingThrows.length === 0) return EMPTY_THROWS;
    const throws = this.pendingThrows;
    this.pendingThrows = [];
    return throws;
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
    if (this.strikeAnimFrames > 0) this.strikeAnimFrames--;
    if (this.throwCooldown > 0) this.throwCooldown--;

    // A golem's wind-up owns the frame it is playing on, exactly as the wild
    // ones do: it commits to the swing and finishes it.
    if (this.advanceGolemAttack()) return;

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
        // Stand at ease rather than wander: `doWander` drifts back toward the
        // merc's spawn tile, which for a bodyguard that has followed the player
        // across the floor means constantly tugging away from them.
        this.isMoving = false;
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

    if (this.attackCooldown > 0) return;

    if (this.isGolem && this.canThrowAt(nearest, nearestDist)) {
      // Committed before the wind-up starts, exactly as the melee branch does.
      // Left unset the release aims at whatever direction pathfinding happened
      // to leave the merc facing, and carries no target for the projectile
      // system to include — so the rock could never hit anything.
      this.golemVictim = nearest;
      this.beginGolemAttack('throw');
      this.throwCooldown = THROW_COOLDOWN_FRAMES;
      return;
    }
    if (nearestDist > this.strikeRangePx * STRIKE_TRIGGER_RANGE_RATIO) return;

    if (this.isGolem) {
      // The golem's melee lands on the animation's own impact frame rather than
      // instantly, so the slam a player watches is the slam that connects.
      this.golemVictim = nearest;
      this.beginGolemAttack(this.lastMelee === 'slam' ? 'stomp' : 'slam');
      return;
    }
    nearest.takeDamageFrom(this.strikeDamage, this.owner, 'melee');
    this.attackCooldown = ATTACK_COOLDOWN_FRAMES;
    this.strikeAnimFrames = STRIKE_ANIM_FRAMES;
    this.attackSoundPending = true;
  }

  private canThrowAt(victim: Mob, distance: number): boolean {
    if (this.throwCooldown > 0) return false;
    if (distance < this.throwMinRangePx || distance > this.throwMaxRangePx) return false;
    // Without this it lobs boulders into the wall it is standing behind
    // forever: the cooldown resets, the rock shatters on the same face, and the
    // merc never closes. `Mob.hasLOS` is the shared cached check the wild golem
    // uses, so the two ends of the same attack agree on what "can see" means.
    return this.hasLOS(victim);
  }

  private beginGolemAttack(attack: GolemAttack): void {
    this.golemAttack = attack;
    this.golemAttackFrame = 0;
    this.golemAttackResolved = false;
    this.attackCooldown = ATTACK_COOLDOWN_FRAMES;
    this.isMoving = false;
    if (attack !== 'throw') {
      this.lastMelee = attack;
      this.attackSoundPending = true;
    }
  }

  /**
   * Plays one frame of a golem attack. Returns true while one owns the frame,
   * so the caller does no movement or targeting of its own.
   */
  private advanceGolemAttack(): boolean {
    const attack = this.golemAttack;
    if (attack === null) return false;

    const timing = GOLEM_ATTACK_TIMING[attack];
    const sheetFrame = Math.floor(this.golemAttackFrame / FRAMES_PER_SHEET_FRAME);
    this.isMoving = false;

    // Keeps tracking until it commits, exactly as a wild golem does. A facing
    // locked from frame zero of a fifty-six frame throw sends the boulder
    // wherever pathfinding happened to leave the merc pointing.
    const victim = this.golemVictim;
    if (!this.golemAttackResolved && sheetFrame < timing.impactFrame && victim !== null) {
      const heading = normalize(victim.x - this.x, victim.y - this.y);
      this.facingX = heading.x;
      this.facingY = heading.y;
    }

    if (!this.golemAttackResolved && sheetFrame >= timing.impactFrame) {
      this.golemAttackResolved = true;
      this.resolveGolemAttack(attack);
    }

    this.golemAttackFrame++;
    if (this.golemAttackFrame >= timing.frames * FRAMES_PER_SHEET_FRAME) {
      this.golemAttack = null;
      this.golemAttackFrame = 0;
      this.golemAttackResolved = false;
      this.golemVictim = null;
    }
    return true;
  }

  private resolveGolemAttack(attack: GolemAttack): void {
    const victim = this.golemVictim;
    if (attack === 'throw') {
      this.releaseRock(victim);
      return;
    }
    if (victim?.isAlive !== true) return;
    if (Math.hypot(victim.x - this.x, victim.y - this.y) > this.strikeRangePx * GOLEM_REACH_RATIO) {
      return;
    }
    victim.takeDamageFrom(this.strikeDamage, this.owner, 'melee');
  }

  /**
   * Queues one boulder. Damage is attributed to the owner in the same way the
   * merc's melee is, so a kill it lands still credits the player who paid for it.
   */
  private releaseRock(victim: Mob | null): void {
    const facing = Math.sign(this.facingX) === 0 ? 1 : Math.sign(this.facingX);
    const handX = this.x + TILE_SIZE * (CENTER_OFFSET + HAND_OFFSET_X * facing);
    const handY = this.y + TILE_SIZE * HAND_OFFSET_Y;
    const aimX = victim ? victim.x + TILE_SIZE * CENTER_OFFSET : handX + this.facingX;
    const aimY = victim ? victim.y + TILE_SIZE * CENTER_OFFSET : handY + this.facingY;
    const dirX = aimX - handX;
    const dirY = aimY - handY;
    // A zero direction normalises to NaN and produces a rock that never moves
    // and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingThrows.push({
      x: handX,
      y: handY,
      dirX: degenerate ? facing : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: Math.max(1, Math.round(this.strikeDamage * THROW_DAMAGE_RATIO)),
      mobType: this.mobType,
      aimedAt: victim,
      thrower: this,
      // Kill credit follows the melee: whoever paid for the merc gets the XP.
      owner: this.owner,
    });
    this.projectileSoundPending = true;
  }

  /** 0→1 through the current swing, or null when the merc isn't mid-strike. */
  private strikeProgress(): number | null {
    if (this.strikeAnimFrames <= 0) return null;
    return 1 - this.strikeAnimFrames / STRIKE_ANIM_FRAMES;
  }

  private drawGolemSelf(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    const attack = this.golemAttack;
    const timing = attack === null ? null : GOLEM_ATTACK_TIMING[attack];
    drawRockGolemSprite(ctx, 'rock_golem', sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      attack,
      attackProgress:
        timing === null ? 0 : this.golemAttackFrame / (timing.frames * FRAMES_PER_SHEET_FRAME),
    });
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
    if (this.damageFlash > 0) ctx.filter = DAMAGE_FLASH_BRIGHTNESS;
    if (this.spriteVariant === null) {
      this.drawGolemSelf(ctx, sx, sy, tileSize);
    } else {
      drawClubNpc(ctx, sx, sy, tileSize, this.spriteVariant, this.animPhase, this.facingX, 0, {
        walking: this.isMoving,
        attack: this.strikeProgress(),
      });
    }
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
